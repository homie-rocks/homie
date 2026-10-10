import assert from 'node:assert/strict';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { config } from './fixtures.mjs';
assert.equal(typeof global.gc, 'function', 'run with --expose-gc');
const mesh = new Mesh(config, [1, 2, 1]);
const source = new Crowd(mesh, 0.05, 0.3);
const bytes = source.save(),
  meshBytes = mesh.save();
source.detach();
const measurements = [];
const batchSize = Number(process.env.NAV_MEMORY_BATCH ?? 10000);
for (let batch = 0; batch < 21; batch++) {
  for (let i = 0; i < batchSize; i++) {
    const m = Mesh.restore(meshBytes, []);
    new Crowd(m, 0.05, 0.3).detach();
    Crowd.restore(bytes, mesh).detach();
    // Also discard without detach: the mesh must not retain this object.
    new Crowd(mesh, 0.05, 0.3);
  }
  global.gc();
  measurements.push(process.memoryUsage().heapUsed);
}
const growth = measurements.at(-1) - measurements[0];
assert.ok(growth < 4 * 1024 * 1024, `retained heap growth ${growth}`);
console.log(
  20 * batchSize,
  'synchronous create/restore/discard cycles after warmup; retained growth',
  growth,
);
