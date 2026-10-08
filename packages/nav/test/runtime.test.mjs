import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { withoutClock } from './scenario.mjs';
const exec = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const chrome = process.env.CHROME_PATH;

test('core bakes, queries, carves and restores with clocks and Math.random forbidden', () => {
  assert.equal(withoutClock(), withoutClock());
});

test('browser bundle imports no renderer or platform library', async () => {
  const bundle = await build({
    entryPoints: [join(here, 'scenario.mjs')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'navTest',
    write: false,
    metafile: true,
  });
  assert.ok(
    Object.keys(bundle.metafile.inputs).every(
      (p) => !p.includes('/three/') && !p.startsWith('node:'),
    ),
  );
});

test(
  'Chrome matches Node exactly',
  { skip: !chrome && 'Set CHROME_PATH, or run test/browser-check.mjs in an existing browser' },
  async () => {
    const bundle = await build({
      entryPoints: [join(here, 'scenario.mjs')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'navTest',
      write: false,
    });
    const browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const actual = await page.evaluate(() => navTest.withoutClock());
      assert.equal(actual, withoutClock());
      console.log(`Chrome ${await browser.version()}: exact state match`);
    } finally {
      await browser.close();
    }
  },
);

test('workerd without Node compatibility bakes and restores the same bytes as Node', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nav-runtime-'));
  try {
    await build({
      stdin: {
        contents: `import { withoutClock } from './scenario.mjs';
 export default { test(_controller,
env) { const actual = withoutClock();
 if (actual !== env.EXPECTED) throw new Error('Worker differs from Node');
 console.log('workerd: exact state match');
 } };
`,
        resolveDir: here,
        sourcefile: 'worker.mjs',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      outfile: join(dir, 'worker.js'),
    });
    await writeFile(join(dir, 'expected.txt'), withoutClock());
    await writeFile(
      join(dir, 'config.capnp'),
      `using Workerd = import "/workerd/workerd.capnp";
\nconst config :Workerd.Config = (services = [(name = "nav",
worker = (modules = [(name = "worker.js",
esModule = embed "worker.js")],

compatibilityDate = "2026-10-07",
compatibilityFlags = ["disallow_eval_during_startup"],

bindings = [(name = "EXPECTED",
text = embed "expected.txt")]))]);
\n`,
    );
    const bin = fileURLToPath(new URL('../../../node_modules/.bin/workerd', import.meta.url));
    const result = await exec(bin, ['test', join(dir, 'config.capnp')], { timeout: 30000 });
    console.log(result.stdout.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'JavaScriptCore matches Node with forbidden maths and clocks',
  { skip: process.platform !== 'darwin' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nav-jsc-'));
    try {
      const bundle = await build({
        entryPoints: [join(here, 'scenario.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'navTest',
        write: false,
      });
      const input = join(dir, 'scenario.js');
      await writeFile(
        input,
        `globalThis.performance={now(){return 0;}};\n${bundle.outputFiles[0].text}\nprint(navTest.withoutClock());`,
      );
      const result = await exec(
        '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc',
        [input],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      assert.equal(result.stdout.trim(), withoutClock());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('Recast default byte-compiling loader is rejected in workerd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nav-wasm-loader-'));
  try {
    await build({
      stdin: {
        contents: `import {init} from 'recast-navigation';
 export default { async test() { let rejected=false;
try { await init();
 } catch(error) { if (!/Wasm code generation disallowed|WebAssembly.*disallowed|Wasm.*not allowed/i.test(String(error))) throw error;
rejected=true;
 }if(!rejected)throw Error('Expected runtime byte compilation to be disallowed');
 } };
`,
        resolveDir: here,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      outfile: join(dir, 'worker.js'),
    });
    await writeFile(
      join(dir, 'config.capnp'),
      `using Workerd = import "/workerd/workerd.capnp";
 const config :Workerd.Config = (services=[(name="nav",worker=(modules=[(name="worker.js",esModule=embed "worker.js")],
compatibilityDate="2026-10-07",compatibilityFlags=["disallow_eval_during_startup"]))]);
`,
    );
    await exec(
      fileURLToPath(new URL('../../../node_modules/.bin/workerd', import.meta.url)),
      ['test', join(dir, 'config.capnp')],
      { timeout: 30000 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
