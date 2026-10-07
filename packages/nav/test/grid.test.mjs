import assert from 'node:assert/strict';
import test from 'node:test';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { Random } from '@homie-rocks/nav/Random.js';

test('A* takes the shortest detour, matching an independent breadth-first oracle', () => {
  const rng = new Random(92);
  for (let run = 0; run < 30; run++) {
    const blocked = Uint8Array.from({ length: 144 }, () => rng.next() < .2 ? 1 : 0);blocked[0] = blocked[143] = 0;
    const grid = new Grid(12, 12, 1, [0, 0, 0], blocked), route = grid.path([.5, 0, .5], [11.5, 0, 11.5]);
    const q = [0], d = new Int32Array(144).fill(-1);d[0] = 0;
    for (let k = 0; k < q.length; k++) { const i = q[k];for (const j of [i % 12 ? i - 1 : -1, i % 12 < 11 ? i + 1 : -1, i - 12, i + 12]) if (j >= 0 && j < 144 && !blocked[j] && d[j] === -1) { d[j] = d[i] + 1;q.push(j); } }
    assert.equal(route.complete, d[143] >= 0);
    if (route.complete) assert.equal(route.points.length - 1, d[143]);
    for (const p of route.points) assert.equal(blocked[Math.floor(p[2]) * 12 + Math.floor(p[0])], 0);
  }
});

test('grid ray finds exact wall and refuses diagonal corner cutting', () => {
  const g = new Grid(4, 4, 1, [0, 0, 0]);g.setBlocked(2, 0, true);
  assert.deepEqual(g.raycast([.5, 0, .5], [3.5, 0, .5]), { clear: false, fraction: .5, point: [2, 0, .5] });
  g.setBlocked(1, 0, true);assert.equal(g.raycast([.5, 0, .5], [1.5, 0, 1.5]).clear, false);
  assert.equal(g.raycast([.5, 0, .5], [.5, 0, .5]).clear, true);
  assert.equal(g.raycast([.5, 0, .5], [-.5, 0, .5]).clear, false);
});

test('reachable queries, seeded choices, dynamic cells and snapshots share mesh semantics', () => {
  const g = new Grid(5, 5, 1, [0, 0, 0]); for (let z = 0; z < 5; z++) g.setBlocked(2, z, true);
  assert.equal(g.path([.5, 0, .5], [4.5, 0, .5]).complete, false);
  assert.equal(g.nearest([4.5, 0, .5], [.5, 0, .5])[0], 1.5);
  const a = new Random(1), b = new Random(1), r = Grid.restore(g.save());
  for (let i = 0; i < 30; i++) { const p = g.random([.5, 0, .5], a.next);assert.deepEqual(p, r.random([.5, 0, .5], b.next));assert.ok(p[0] < 2); }
  g.setBlocked(2, 3, false);r.setBlocked(2, 3, false);assert.deepEqual(g.save(), r.save());assert.ok(g.path([.5, 0, .5], [4.5, 0, .5]).complete);
});
