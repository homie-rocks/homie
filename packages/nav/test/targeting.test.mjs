import assert from 'node:assert/strict';
import test from 'node:test';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { flat, tune } from './fixtures.mjs';

test('target reachability never performs a synchronous path query', () => {
  const mesh = flat();
  const c = new Crowd(mesh, 0.05, 0.3);
  const id = c.add([1, 0.1, 5], tune);
  mesh.path = () => { throw new Error('synchronous path search'); };
  assert.equal(c.target(id, [9, 0.1, 5]), true);
  mesh.addObstacle({ min: [4, -1, -1], max: [6, 3, 11] });
  assert.equal(c.target(id, [9, 0.1, 5]), false);
  const link = mesh.addLink([3, 0.1, 5], [7, 0.1, 5], 0.6, false);
  assert.equal(c.target(id, [9, 0.1, 5]), true);
  c.place(id, [9, 0.1, 5]);
  assert.equal(c.target(id, [1, 0.1, 5]), false);
  mesh.setLinkEnabled(link, false);
  c.place(id, [1, 0.1, 5]);
  assert.equal(c.target(id, [9, 0.1, 5]), false);
});
