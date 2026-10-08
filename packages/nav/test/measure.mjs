// Run separately from the test suite to avoid competing CPU work.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { makeScene, gridScene } from './scale-scene.mjs';

const stats = (values) => {
  values.sort((a, b) => a - b);
  return {
    median: values[Math.floor(values.length / 2)],
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1),
  };
};
const time = (fn) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const report = {
  cpu: cpus()[0].model,
  node: process.version,
  scenes: [],
  ticks: [],
  grids: [],
  workerd: [],
};
for (const [size, pillars] of [
  [20, false],
  [20, true],
  [80, true],
  [160, true],
]) {
  let scene;
  const bakeMs = time(() => {
    scene = makeScene(size, 0, pillars);
  });
  const retained = makeScene(size, 0, pillars, true);
  const assetBytes = scene.assets.map((t) => t.bytes.length);
  const meshBytes = scene.mesh.save();
  const save = [],
    restore = [];
  for (let i = 0; i < 7; i++) {
    save.push(time(() => scene.mesh.save()));
    restore.push(
      time(() =>
        Mesh.restore(
          meshBytes,
          scene.assets.map((t) => t.bytes),
        ),
      ),
    );
  }
  const paths = [];
  for (let i = 0; i < 100; i++)
    paths.push(
      time(() => {
        assert.ok(scene.mesh.path([1, 0.1, 1], [size - 1, 0.1, size - 1]).complete);
      }),
    );
  const crowded = makeScene(size, 300, pillars);
  for (let i = 0; i < 40; i++) crowded.tick();
  const crowdBytes = crowded.crowd.save();
  const crowdSave = [],
    crowdRestore = [];
  for (let i = 0; i < 7; i++) {
    crowdSave.push(time(() => crowded.crowd.save()));
    crowdRestore.push(time(() => Crowd.restore(crowdBytes, crowded.mesh)));
  }
  report.scenes.push({
    size,
    pillars,
    tiles: assetBytes.length,
    bakeAndLoadMs: bakeMs,
    staticBytes: assetBytes.reduce((a, b) => a + b, 0),
    largestStaticBytes: Math.max(...assetBytes),
    retainedBytes: retained.assets.reduce((a, t) => a + t.bytes.length, 0),
    largestRetainedBytes: Math.max(...retained.assets.map((t) => t.bytes.length)),
    meshBytes: meshBytes.length,
    meshSave: stats(save),
    meshRestore: stats(restore),
    path: stats(paths),
    crowdAgents: 300,
    crowdBytes: crowdBytes.length,
    crowdSave: stats(crowdSave),
    crowdRestore: stats(crowdRestore),
  });
}
for (const count of [100, 400, 1000]) {
  const scene = makeScene(80, count);
  for (let i = 0; i < 30; i++) scene.tick();
  const targets = [],
    steps = [],
    ticks = [];
  for (let i = 0; i < 100; i++) {
    const a = time(scene.retarget),
      b = time(() => scene.crowd.step());
    targets.push(a);
    steps.push(b);
    ticks.push(a + b);
  }
  report.ticks.push({
    count,
    targets: stats(targets),
    step: stats(steps),
    wholeTick: stats(ticks),
  });
}
for (const kind of ['single', 'random', 'walls', 'unreachable']) {
  const grid = gridScene(kind),
    times = {};
  for (const search of ['astar', 'jps']) {
    const samples = [];
    for (let i = 0; i < 3; i++)
      samples.push(time(() => grid.path([0.5, 0, 0.5], [1999.5, 0, 1999.5], { search })));
    times[search] = stats(samples);
  }
  const bytes = grid.save();
  const firstNearest = time(() => grid.nearest([1000.5, 0, 1000.5], [0.5, 0, 0.5]));
  const repeatedNearest = [];
  for (let i = 0; i < 10; i++)
    repeatedNearest.push(time(() => grid.nearest([1000.5, 0, 1000.5], [0.5, 0, 0.5])));
  report.grids.push({
    kind,
    ...times,
    firstNearest,
    repeatedNearest: stats(repeatedNearest),
    bytes: bytes.length,
    restoreMs: time(() => Grid.restore(bytes)),
  });
}
const dir = await mkdtemp(join(tmpdir(), 'nav-measure-'));
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
let child;
try {
  const source = `
    import { makeScene } from './scale-scene.mjs';
    let scene;
    export default { fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/new') scene = makeScene(80, Number(url.searchParams.get('count')));
      if (url.pathname === '/tick') scene.tick();
      if (url.pathname === '/target') scene.retarget();
      return Response.json({ok: true});
    }};
  `;
  await build({
    stdin: { contents: source, resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: join(dir, 'worker.js'),
  });
  await writeFile(
    join(dir, 'config.capnp'),
    `
    using Workerd = import "/workerd/workerd.capnp";
    const config :Workerd.Config = (
      services=[(name="main",worker=(modules=[(name="worker.js",esModule=embed "worker.js")],compatibilityDate="2026-10-07"))],
      sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);
  `,
  );
  child = spawn(
    fileURLToPath(new URL('../../../node_modules/.bin/workerd', import.meta.url)),
    ['serve', join(dir, 'config.capnp')],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child.stderr.on('data', (b) => process.stderr.write(b));
  const request = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (!response.ok) throw Error(await response.text());
    await response.json();
  };
  for (let i = 0; i < 100; i++) {
    try {
      await request('/ping');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  for (const count of [100, 400, 1000]) {
    await request(`/new?count=${count}`);
    for (let i = 0; i < 30; i++) await request('/tick');
    const ticks = [],
      targets = [];
    for (let i = 0; i < 100; i++) {
      let t = performance.now();
      await request('/target');
      targets.push(performance.now() - t);
      t = performance.now();
      await request('/tick');
      ticks.push(performance.now() - t);
    }
    report.workerd.push({
      count,
      targetLoopIncludingHttp: stats(targets),
      tickIncludingHttp: stats(ticks),
    });
  }
} finally {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(dir, { recursive: true, force: true });
}
const output = JSON.stringify(report, null, 2) + '\n';
await writeFile(new URL('measurements.json', import.meta.url), output);
console.log(output);
