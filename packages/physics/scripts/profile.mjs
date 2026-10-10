import { performance } from "node:perf_hooks";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir, loadavg } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { initPhysics } from "../dist/Engine.js";
import { profile } from "../test/profile-fixture.mjs";
await initPhysics();
const root = fileURLToPath(new URL("../", import.meta.url)),
  require = createRequire(import.meta.url);
async function measure(runtime, call) {
  const overhead = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await call({ action: "noop" });
    overhead.push(performance.now() - start);
  }
  overhead.sort((a, b) => a - b);
  const requestMs = overhead[10];
  for (const [scene, count] of ["flat", "heightfield", "pile", "sleeping"]
    .flatMap((s) => [100, 500, 2000].map((n) => [s, n]))
    .concat([
      ["characters", 100],
      ["steps", 32],
      ["tile", 0],
    ])) {
    const selected = process.env.PHYSICS_SCENES?.split(",");
    if (selected && !selected.includes(scene)) continue;
    const counts = process.env.PHYSICS_COUNTS?.split(",").map(Number);
    if (counts && !counts.includes(count)) continue;
    const loadBefore = loadavg();
    await call({ action: "setup", scene, count });
    let start = performance.now();
    await call({ action: "step", iterations: 10 });
    const coldMs = Math.max(0, performance.now() - start - requestMs) / 10;
    await call({
      action: "step",
      iterations: scene === "sleeping" ? 500 : 150,
    });
    const times = [];
    for (let i = 0; i < 20; i++) {
      start = performance.now();
      await call({ action: "step", iterations: 5 });
      times.push(Math.max(0, performance.now() - start - requestMs) / 5);
    }
    times.sort((a, b) => a - b);
    const size = await call({ action: "size" });
    start = performance.now();
    await call({ action: "query", iterations: 10000 });
    const queryUs = Math.max(0, performance.now() - start - requestMs) / 10;
    start = performance.now();
    await call({ action: "save", iterations: 20 });
    const saveMs = Math.max(0, performance.now() - start - requestMs) / 20;
    start = performance.now();
    await call({ action: "restore", iterations: 20 });
    const restoreMs = Math.max(0, performance.now() - start - requestMs) / 20;
    console.log(
      JSON.stringify({
        runtime,
        loadBefore,
        loadAfter: loadavg(),
        scene,
        count,
        coldMs,
        tickMs: (times[9] + times[10]) / 2,
        requestMs,
        maxBatchMs: times[19],
        queryUs,
        saveMs,
        restoreMs,
        ...size,
      }),
    );
  }
  await call({ action: "dispose" });
}
if (process.env.PHYSICS_RUNTIME !== "workerd")
  await measure("Node", async (args) => profile(args));
const dir = await mkdtemp(join(tmpdir(), "physics-profile-"));
let child;
try {
  const entry = join(dir, "worker.mjs");
  await writeFile(
    entry,
    `import wasm from ${JSON.stringify(join(root, "dist/vendor/rapier.wasm"))};
import {initPhysics} from ${JSON.stringify(join(root, "dist/Worker.js"))};
import {profile} from ${JSON.stringify(join(root, "test/profile-fixture.mjs"))};
await initPhysics(wasm);export default{async fetch(request){return Response.json(profile(await request.json()));}};`,
  );
  const config = join(dir, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: "physics-profile",
      main: entry,
      compatibility_date: "2026-10-07",
      rules: [
        { type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: true },
      ],
    }),
  );
  const out = join(dir, "out");
  const result = spawnSync(
    process.execPath,
    [
      join(
        dirname(require.resolve("wrangler/package.json")),
        "bin/wrangler.js",
      ),
      "deploy",
      "--dry-run",
      "--config",
      config,
      "--outdir",
      out,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: join(dir, "wrangler.log"),
      },
    },
  );
  if (result.status) throw new Error(result.stdout + result.stderr);
  const files = await readdir(out),
    binary = files.find((f) => f.endsWith(".wasm"));
  await writeFile(
    join(out, "config.capnp"),
    `using Workerd=import "/workerd/workerd.capnp";
const config:Workerd.Config=(
 services=[(name="main",worker=(
  modules=[(name="worker.js",esModule=embed "worker.js"),(name="${binary}",wasm=embed "${binary}")],
  compatibilityDate="2026-10-07"))],
 sockets=[(name="http",address="127.0.0.1:0",http=(),service="main")]);`,
  );
  child = spawn(
    require("workerd").default,
    ["serve", join(out, "config.capnp"), "--control-fd=1"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const port = await new Promise((resolve, reject) => {
    child.once("exit", () => reject(new Error("workerd exited")));
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
      for (const line of text.split("\n").slice(0, -1)) {
        const event = JSON.parse(line);
        if (event.port) resolve(event.port);
      }
    });
  });
  await measure("workerd", async (args) => {
    const r = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      // Long synchronous samples can outlive a pooled connection's idle timer.
      headers: { connection: "close" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  });
} finally {
  if (child && child.exitCode === null) {
    const closed = once(child, "exit");
    child.kill();
    await closed;
  }
  await rm(dir, { recursive: true, force: true });
}
