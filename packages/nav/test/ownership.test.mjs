import assert from 'node:assert/strict';
import test from 'node:test';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { flat, tune } from './fixtures.mjs';
test('detach ends access to an explicitly attached crowd', () => {
  const mesh = flat();
  const c = new Crowd(mesh, 0.05, 0.3);
  const id = c.add([2, 0, 2], tune);
  c.detach();
  c.detach();
  for (const f of [
    () => c.step(),
    () => c.save(),
    () => c.agent(id),
    () => c.ids(),
    () => c.target(id, [3, 0, 3]),
    () => c.add([2, 0, 2], tune),
    () => c.stop(id),
    () => c.place(id, [2, 0, 2]),
    () => c.arrived(id, 1),
    () => c.completeLink(id),
  ]) {
    assert.throws(f, /^Error: nav: crowd is detached$/);
  }
});

test('synchronous discarded crowds do not accumulate on a static mesh', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  execFileSync(
    process.execPath,
    ['--expose-gc', fileURLToPath(new URL('full-memory.mjs', import.meta.url))],
    {
      env: { ...process.env, NAV_MEMORY_BATCH: '50' },
    },
  );
});

test('observing an agent between mesh edits does not change the next step', () => {
  const mesh = flat();
  const a = new Crowd(mesh, 0.05, 0.3);
  const id = a.add([2, 0, 2], tune);
  a.target(id, [8, 0, 8]);
  a.step();
  const b = Crowd.restore(a.save(), mesh);
  const obstacle = mesh.addObstacle({ min: [1, -1, 1], max: [3, 3, 3] });
  a.agent(id);
  a.arrived(id, 1);
  a.ids();
  mesh.removeObstacle(obstacle);
  a.step();
  b.step();
  assert.deepEqual(a.save(), b.save());
});
