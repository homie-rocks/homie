import assert from 'node:assert/strict';
import test from 'node:test';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { flat, tune } from './fixtures.mjs';
test('detach ends access to an explicitly attached crowd', () => {
  const mesh = flat();
  const c = new Crowd(mesh, .05, .3);
  const id = c.add([2, 0, 2], tune);
  c.detach();
  c.detach();
  for (const f of [() => c.step(), () => c.save(), () => c.agent(id), () => c.ids(),
    () => c.target(id, [3, 0, 3]), () => c.add([2, 0, 2], tune), () => c.stop(id),
    () => c.place(id, [2, 0, 2]), () => c.arrived(id, 1), () => c.completeLink(id)]) {
    assert.throws(f, /^Error: nav: crowd is detached$/);
  }
});
