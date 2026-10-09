import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
  readdir,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import * as esbuild from "esbuild";
import { buildGameFiles } from "../../studio/lib/build.mjs";
const { build } = esbuild;
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import puppeteer from "puppeteer-core";
import { findChrome, chromeArgs } from "../../studio/lib/chrome.mjs";
import "./helpers.mjs";
import { run } from "./runtime-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("compiled WASM loads in workerd and produces the exact Node snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "physics-worker-"));
  let worker;
  try {
    const require = createRequire(import.meta.url);
    const config = join(dir, "wrangler.jsonc");
    await writeFile(
      config,
      JSON.stringify({
        name: "physics-runtime-test",
        main: join(root, "test/worker-fixture.mjs"),
        compatibility_date: "2026-10-07",
        rules: [
          { type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: true },
        ],
      }),
    );
    const built = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "./bin/wrangler.js",
            "file://" + require.resolve("wrangler/package.json"),
          ),
        ),
        "deploy",
        "--dry-run",
        "--config",
        config,
        "--outdir",
        dir,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: join(dir, "wrangler.log"),
        },
        timeout: 30000,
      },
    );
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const files = await readdir(dir);
    const binary = files.find((name) => name.endsWith(".wasm"));
    const entry = files.find((name) => name === "worker-fixture.js");
    assert.ok(binary, files.join(","));
    assert.ok(entry, files.join(","));
    assert.ok(
      !(await readFile(join(dir, entry), "utf8")).includes("AGFzbQ"),
      "Worker JS must not embed a second WASM copy",
    );
    await writeFile(
      join(dir, "config.capnp"),
      `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "main", worker = (
    modules = [(name = "${entry}", esModule = embed "${entry}"),
               (name = "${binary}", wasm = embed "${binary}")],
    compatibilityDate = "2026-10-06"
  ))],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")]
);`,
    );
    worker = spawn(
      require("workerd").default,
      ["serve", join(dir, "config.capnp"), "--control-fd=1"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    worker.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("workerd startup timeout: " + stderr)),
        15000,
      );
      let buffer = "";
      worker.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const event = JSON.parse(line);
          if (event.port) {
            clearTimeout(timer);
            resolve(event.port);
          }
        }
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(stderr));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), run());
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const closed = once(worker, "exit");
      worker.kill();
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("studio-built browser loads owned WASM and produces the exact Node snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "physics-studio-"));
  const game = join(dir, "game");
  await mkdir(join(game, "src"), { recursive: true });
  const entry = `import { initPhysics } from ${JSON.stringify(join(root, "dist/Engine.js"))};
import { run } from ${JSON.stringify(join(root, "test/runtime-fixture.mjs"))};
await initPhysics();globalThis.physicsResult=run();`;
  await writeFile(join(game, "src/main.ts"), entry);
  await writeFile(
    join(game, "index.html"),
    '<script type="module" src="/src/main.ts"></script>',
  );
  const output = join(dir, "output");
  await buildGameFiles(esbuild, dir, { id: "physics", dir: game }, output);

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><title>Physics runtime test</title><script type="module" src="/assets/main.js"></script>',
        );
        return;
      }
      const path = resolve(
        output,
        "." + new URL(req.url, "http://localhost").pathname,
      );
      if (!path.startsWith(output)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        path.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      );
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      args: chromeArgs(),
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.physicsResult, {
      timeout: 60000,
    });
    const result = await page.evaluate(() => globalThis.physicsResult);
    assert.deepEqual(result, run());
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "JavaScriptCore and V8 produce identical solver snapshots",
  {
    skip:
      process.platform !== "darwin" &&
      !process.env.JSC_PATH &&
      "JSC_PATH selects a JavaScriptCore shell",
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "physics-jsc-"));
    const script = join(dir, "runtime.js");
    try {
      await build({
        stdin: {
          contents: `import {TextEncoder,TextDecoder} from '@sinonjs/text-encoding';
globalThis.TextEncoder=TextEncoder;globalThis.TextDecoder=TextDecoder;
// The bare shell lacks browser structuredClone; joint options contain plain objects and arrays.
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
globalThis.structuredClone=clone;
(async()=>{const {initPhysics}=await import('./dist/Engine.js');const {run}=await import('./test/runtime-fixture.mjs');await initPhysics(new WebAssembly.Module(readFile(${JSON.stringify(join(root, "dist/vendor/rapier.wasm"))},'binary')));
print(JSON.stringify(run()));})().catch(error=>{print(String(error)+error.stack);throw error;});`,
          resolveDir: root,
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        outfile: script,
        banner: {
          js: "globalThis.self=globalThis;globalThis.window=globalThis;globalThis.global=globalThis;",
        },
        logLevel: "silent",
      });
      const executable =
        process.env.JSC_PATH ??
        "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc";
      const result = spawnSync(executable, [script], {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.deepEqual(JSON.parse(result.stdout), run());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
