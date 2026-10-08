import assert from 'node:assert/strict';
import test from 'node:test';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { flat, doorway, tune } from './fixtures.mjs';

test('seeded inputs produce identical whole state, including a mid-search restore', () => {
  const make = () => {
    const c = new Crowd(flat(), 1/30, .3, { searchIterations: 1 }), rng = new Random(872);
    c.mesh.addObstacle({ min: [4, -1, 2], max: [6, 3, 8] });
    for (let i = 0; i < 6; i++) {
      const id = c.add([1 + rng.next(), .1, 1 + i], tune); c.target(id, [8 + rng.next(), .1, 8 - i]);
    }
    // Force sliced searches to span steps, so the heap and pool aliases matter.

    return c;
  };
  const a = make(), b = make();
  for (let i = 0; i < 20; i++) { a.step(); b.step(); }
  assert.deepEqual(a.save(), b.save());
  let resumed = Crowd.restore(a.save(), a.mesh);
  for (let i = 0; i < 12; i++) {
    a.step(); resumed.step(); assert.deepEqual(resumed.save(), a.save(), `tick ${i}`);
    resumed = Crowd.restore(resumed.save(), resumed.mesh);
  }
  for (let i = 0; i < 80; i++) { a.step(); resumed.step(); }
  assert.deepEqual(a.save(), resumed.save());
});

test('a walker arrives across a field and remains at its target', () => {
  const c = new Crowd(flat(), 1/30, .3), id = c.add([1, .1, 1], tune);
  assert.equal(c.target(id, [9, .1, 9]), true);
  for (let i = 0; i < 180; i++) c.step();
  assert.equal(c.arrived(id, .2), true);
  const at = c.agent(id).position;
  assert.ok(Math.hypot(at[0] - 9, at[2] - 9) < .2);
  for (let i = 0; i < 30; i++) c.step();
  assert.ok(c.arrived(id, .2)); assert.equal(c.remove(id), true); assert.equal(c.agent(id), null);
});

test('fifty agents cross a doorway with local avoidance and without walking through its wall', () => {
  const c = new Crowd(doorway(), 1/30, .3), ids = [];
  for (let i = 0; i < 50; i++) {
    const z = 3 + (i % 10) * 1.4, x = 1.5 + Math.floor(i / 10) * 1.3;
    const id = c.add([x, .1, z], tune); ids.push(id); c.target(id, [20 - x, .1, z]);
  }
  let minimum = Infinity;
  for (let t = 0; t < 700; t++) {
    c.step(); const agents = ids.map(id => c.agent(id).position);
    for (const p of agents) {
      assert.ok([...p].every(Number.isFinite));
      if (p[0] > 9.2 && p[0] < 10.8) assert.ok(p[2] >= 8 && p[2] <= 12, 'cross only in the doorway');
    }
    if (t % 10 === 0) for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) minimum = Math.min(minimum, Math.hypot(agents[i][0] - agents[j][0], agents[i][2] - agents[j][2]));
  }
  assert.ok(ids.every(id => c.agent(id).position[0] > 11), 'all fifty crossed');
  assert.ok(minimum > .35, `agents remain separate; closest ${minimum}`);
});

test('restore during an off-mesh traversal is exact and finishes on the other island', () => {
  const m = flat();m.addObstacle({ min: [4, -1, -1], max: [6, 3, 11] }); m.addLink([3, .1, 5], [7, .1, 5], .6, true);
  const c = new Crowd(m, 1/30, .3), id = c.add([2, .1, 5], tune);c.target(id, [8, .1, 5]);
  let found = false;
  for (let i = 0; i < 180; i++) {
    c.step(); if (c.agent(id).offMesh) {
      const restored = Crowd.restore(c.save(), c.mesh);
      for (let j = 0; j < 120; j++) { c.step(); restored.step(); }
      assert.deepEqual(c.save(), restored.save()); found = true; break;
    }
  }
  assert.ok(found, 'entered off-mesh traversal');assert.ok(c.agent(id).position[0] > 7.5);
});

test('an obstacle edit invalidates corridors and a restored crowd replans identically', () => {
  const c = new Crowd(flat(), 1/30, .3), id = c.add([1, .1, 5], tune); c.target(id, [9, .1, 5]);
  for (let i = 0; i < 10; i++) c.step();
  const obs = c.mesh.addObstacle({ min: [4, -1, 3], max: [6, 3, 7] });
  const r = Crowd.restore(c.save(), c.mesh);
  for (let i = 0; i < 150; i++) { c.step(); r.step(); }
  assert.deepEqual(c.save(), r.save()); assert.ok(c.agent(id).position[0] > 7);
  c.mesh.removeObstacle(obs);  c.step(); r.step(); assert.deepEqual(c.save(), r.save());
});
