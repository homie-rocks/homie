// Run separately from tests so CPU contention does not distort wake timings.
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { Mesh } from '../dist/Mesh.js';
import { Crowd } from '../dist/Crowd.js';
import { makeScene } from './scale-scene.mjs';
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = (fn) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const rows = [];
for (const size of [80, 160]) {
  for (const editable of [false, true]) {
    const scene = makeScene(size, 300, true, editable);
    for (const obstacles of editable ? [0, 20] : [0]) {
      for (let i = 0; i < obstacles; i++) {
        const x = 7 + ((i * 13) % (size - 12)),
          z = 7 + ((i * 17) % (size - 12));
        scene.mesh.addObstacle({ min: [x, -1, z], max: [x + 1, 3, z + 1] });
      }
      for (let i = 0; i < 40; i++) scene.tick();
      const meshBytes = scene.mesh.save(),
        crowdBytes = scene.crowd.save();
      const assets = scene.assets.map((a) => a.bytes);
      const save = [],
        restore = [],
        wake = [],
        crowd = [];
      for (let i = 0; i < 9; i++) {
        // Let discarded weakly subscribed crowds become collectible between samples.
        await new Promise(setImmediate);
        const s = time(() => scene.mesh.save());
        const r = time(() => Mesh.restore(meshBytes, assets));
        const c = time(() => Crowd.restore(crowdBytes, scene.mesh));
        const w = time(() => Crowd.restore(crowdBytes, Mesh.restore(meshBytes, assets)));
        if (i > 1) {
          save.push(s);
          restore.push(r);
          crowd.push(c);
          wake.push(w);
        }
      }
      const row = {
        size,
        tiles: assets.length,
        editable,
        obstacles,
        assets: assets.reduce((n, b) => n + b.length, 0),
        meshBytes: meshBytes.length,
        crowdBytes: crowdBytes.length,
        meshSaveMs: median(save),
        meshRestoreMs: median(restore),
        crowdRestoreMs: median(crowd),
        roomWakeMs: median(wake),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
await writeFile(
  new URL('./wake-measurements.json', import.meta.url),
  JSON.stringify(
    { cpu: cpus()[0].model, node: process.version, samples: 7, agents: 300, rows },
    null,
    2,
  ) + '\n',
);
