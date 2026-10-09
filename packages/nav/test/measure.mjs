import { gzipSync } from 'node:zlib';
// Run separately from the test suite to avoid competing CPU work.
import assert from 'node:assert/strict';
import { workerCpu } from './worker-cpu.mjs';
import { cpus, loadavg } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
  const t = process.cpuUsage();
  fn();
  const used = process.cpuUsage(t);
  return (used.user + used.system) / 1000;
};
const report = {
  cpu: cpus()[0].model,
  timing: 'process user + system CPU milliseconds',
  load: loadavg(),
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
report.workerd = await workerCpu(
  `
  import { makeScene } from './scale-scene.mjs';
  let scene;
  export default { fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === '/new') scene = makeScene(80, Number(u.searchParams.get('count')));
    for (let i = 0; i < Number(u.searchParams.get('n') ?? 1); i++) {
      if (u.pathname === '/tick') scene.tick();
      if (u.pathname === '/target') scene.retarget();
    }
    return Response.json({ok: true});
  }};
`,
  async (request, measure) => {
    const rows = [];
    for (const count of [100, 400, 1000]) {
      await request(`/new?count=${count}`);
      await request('/tick?n=30');
      const ticks = [],
        targets = [];
      for (let i = 0; i < 7; i++) {
        targets.push(await measure('/target'));
        ticks.push(await measure('/tick'));
      }
      rows.push({ count, targetCpu: stats(targets), tickCpu: stats(ticks) });
    }
    return rows;
  },
);
const gridBundle = await build({
  stdin: {
    contents: "export { Grid } from '@homie-rocks/nav/Grid.js';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true,
  minify: true,
  platform: 'neutral',
  format: 'esm',
  write: false,
});
const gridBytes = gridBundle.outputFiles[0].contents;
report.gridBundle = {
  minified: gridBytes.length,
  gzip: gzipSync(gridBytes).length,
};
const output = JSON.stringify(report, null, 2) + '\n';
await writeFile(new URL('measurements.json', import.meta.url), output);
console.log(output);
