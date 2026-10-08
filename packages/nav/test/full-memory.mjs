import assert from 'node:assert/strict';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { config } from './fixtures.mjs';
assert.equal(typeof global.gc, 'function', 'run with --expose-gc');
const mesh = new Mesh(config, [1, 2, 1]);
const source = new Crowd(mesh, .05, .3);
const bytes = source.save(), meshBytes = mesh.save();
source.detach();
const measurements = [];
for (let batch = 0; batch < 21; batch++) {
  for (let i = 0; i < 10000; i++) {
    const m = Mesh.restore(meshBytes, []);
    new Crowd(m, .05, .3).detach();
    Crowd.restore(bytes, mesh).detach();
    // Also discard without detach: the mesh must not retain this object.
    new Crowd(mesh, .05, .3);
  }
  global.gc();
  measurements.push(process.memoryUsage().heapUsed);
}
const growth = measurements.at(-1) - measurements[0];
assert.ok(growth < 4 * 1024 * 1024, `retained heap growth ${growth}`);
console.log('200000 synchronous create/restore/discard cycles after warmup; retained growth', growth);
