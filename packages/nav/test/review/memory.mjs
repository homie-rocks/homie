import assert from 'node:assert/strict';
import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { config, field, tune } from '../fixtures.mjs';
if (!globalThis.gc) throw Error('Run with node --expose-gc');
globalThis.gc();
const baseline = process.memoryUsage(),
  cfg = { ...config, tileCells: 80 },
  mesh = new Mesh(cfg, [2, 2, 2]);
for (let z = 0; z < 2; z++)
  for (let x = 0; x < 2; x++)
    mesh.loadTile(
      bakeTile(
        field(() => 0, x * 20 - 2, z * 20 - 2, 97, 97),
        cfg,
        x,
        z,
      ),
    );
const crowd = new Crowd(mesh, 0.05, 0.3);
for (let i = 0; i < 300; i++) {
  const id = crowd.add([1 + (i % 15), 0.1, 1 + Math.floor(i / 15) * 1.8], tune);
  crowd.target(id, [39 - (i % 15), 0.1, 1 + Math.floor(i / 15) * 1.8]);
}
for (let i = 0; i < 30; i++) crowd.step();
globalThis.gc();
const resident = process.memoryUsage(),
  start = performance.now(),
  bytes = crowd.save(),
  saveMs = performance.now() - start,
  afterSave = process.memoryUsage();
const restoreStart = performance.now(),
  restored = Crowd.restore(bytes, mesh),
  restoreMs = performance.now() - restoreStart,
  afterRestore = process.memoryUsage();
assert.deepEqual(restored.save(), bytes);
assert.ok(bytes.length < 300 * 1000);
assert.ok(saveMs < 50);
assert.ok(restoreMs < 50);
assert.ok(
  afterRestore.heapUsed + afterRestore.arrayBuffers < 64 * 1024 * 1024,
  'leave at least half the room memory for its other state',
);
console.log(
  JSON.stringify({
    worldMetres: 40,
    tiles: 4,
    agents: 300,
    bytes: bytes.length,
    saveMs,
    restoreMs,
    residentHeapBytes: resident.heapUsed,
    residentHeapGrowth: resident.heapUsed - baseline.heapUsed,
    saveHeapGrowth: afterSave.heapUsed - resident.heapUsed,
    restoreHeapGrowth: afterRestore.heapUsed - afterSave.heapUsed,
    finalArrayBuffers: afterRestore.arrayBuffers,
    rss: afterRestore.rss,
  }),
);
