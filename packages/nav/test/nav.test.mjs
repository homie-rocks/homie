import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { pack, unpack } from '@homie-rocks/nav/State.js';
import { config, field, flat } from './fixtures.mjs';

test('triangle bake repeats exactly, loads from bytes, and follows the heightfield', () => {
  const tris = field(x => x * .2), a = bakeTile(tris, config, 0, 0), b = bakeTile(tris, config, 0, 0);
  assert.deepEqual(a, b);
  const m = new Mesh(config, [2, 2, 2]); m.loadTile(a);
  const path = m.path([1, .2, 1], [9, 1.8, 9]);
  assert.equal(path.complete, true); assert.ok(path.points.at(-1)[1] > 1.7);
  assert.deepEqual(Mesh.restore(m.save()).path([1, .2, 1], [9, 1.8, 9]), path);
  assert.equal(m.raycast([1, .3, 1], [9, 1.9, 9]).clear, true);
});

test('slope and headroom reject unsuitable surfaces and radius closes a narrow passage', () => {
  const steep = new Mesh({ ...config, slopeDegrees: 10 }, [1, 1, 1]);
  steep.loadTile(bakeTile(field(x => x * .4), steep.state.config, 0, 0));
  assert.equal(steep.nearest([5, 2, 5]), null);
  const floor = field(), roof = field(() => 1.2);
  const positions = [...floor.positions, ...roof.positions], indices = [...floor.indices, ...Array.from(roof.indices, i => i + floor.positions.length / 3)];
  const m = new Mesh(config, [1, .3, 1]);m.loadTile(bakeTile({ positions, indices }, config, 0, 0));
  assert.equal(m.nearest([5, .1, 5]), null); assert.ok(m.nearest([5, 1.3, 5]));
  const n = flat(); n.addObstacle({ min: [4, -1, -1], max: [6, 4, 4.8] }); n.addObstacle({ min: [4, -1, 5.2], max: [6, 4, 11] });
  assert.equal(n.path([2, 0, 5], [8, 0, 5]).complete, false);
});

test('step height separates a kerb from a wall', () => {
  // Both sides have their own upward floor; the voxel pipeline merges adjacent spans.
  const lo = field(() => 0, -2, -2, 29, 57), hi = field(() => .6, 5, -2, 29, 57);
  const tris = { positions: [...lo.positions, ...hi.positions], indices: [...lo.indices, ...Array.from(hi.indices, i => i + lo.positions.length / 3)] };
  for (const [stepHeight, expected] of [[.2, false], [.8, true]]) {
    const c = { ...config, stepHeight }, m = new Mesh(c, [1, 1, 1]);m.loadTile(bakeTile(tris, c, 0, 0));
    assert.equal(m.path([2, 0, 5], [8, .6, 5]).complete, expected);
  }
});

test('tiles built independently stitch, unloading closes the seam, and loading reopens it', () => {
  const m = flat(), right = bakeTile(field(() => 0, 8), config, 1, 0);
  assert.equal(m.path([1, 0, 5], [19, 0, 5]).complete, false);
  m.loadTile(right); assert.equal(m.path([1, 0, 5], [19, 0, 5]).complete, true);
  assert.equal(m.raycast([1, .1, 5], [19, .1, 5]).clear, true);
  m.unloadTile(1, 0); assert.equal(m.path([1, 0, 5], [19, 0, 5]).complete, false);
  m.loadTile(right); assert.equal(m.path([1, 0, 5], [19, 0, 5]).complete, true);
  assert.throws(() => m.loadTile(bakeTile(field(), { ...config, radius: .4 }, 0, 0)), /configuration/);
});

test('obstacles carve routes, overlap correctly, survive restore, and remove cleanly', () => {
  const m = flat(), from = [1, .1, 5], to = [9, .1, 5];
  const box = { min: [4, -1, 3], max: [6, 3, 7] }, id = m.addObstacle(box), other = m.addObstacle(box);
  const p = m.path(from, to); assert.equal(p.complete, true); assert.ok(p.points.length > 2);
  const ray = m.raycast(from, to); assert.equal(ray.clear, false); assert.ok(ray.fraction > .2 && ray.fraction < .5);
  const r = Mesh.restore(m.save()); assert.deepEqual(r.path(from, to), p);
  r.removeObstacle(id); assert.equal(r.raycast(from, to).clear, false);
  r.removeObstacle(other); assert.equal(r.raycast(from, to).clear, true);
});

test('nearest and seeded random remain in the start component', () => {
  const m = flat(); m.addObstacle({ min: [4, -1, -1], max: [6, 3, 11] });
  assert.ok(m.nearest([9, .1, 5], [1, .1, 5])[0] < 4);
  const run = () => { const rng = new Random(42); return Array.from({ length: 30 }, () => m.random([1, 0, 5], rng.next)); };
  assert.deepEqual(run(), run()); assert.ok(run().every(p => p && p[0] < 4));
  assert.throws(() => m.random([1, 0, 5], () => 1), /random/);
});

test('off-mesh links connect islands, preserve direction, and doors disable', () => {
  const m = flat(); m.addObstacle({ min: [4, -1, -1], max: [6, 3, 11] });
  const a = [3, .1, 5], b = [7, .1, 5]; assert.equal(m.path(a, b).complete, false);
  const id = m.addLink(a, b, .5, false);
  assert.equal(m.path(a, b).complete, true); assert.ok(m.path(a, b).links.some(Boolean));
  assert.equal(m.path(b, a).complete, false);
  m.setLinkEnabled(id, false); assert.equal(m.path(a, b).complete, false);
  m.setLinkEnabled(id, true); assert.equal(m.path(a, b).complete, true);
  m.removeLink(id); assert.equal(m.path(a, b).complete, false);
});

test('vertical ray cannot claim a room reaches the roof', () => {
  assert.equal(flat().raycast([2, .1, 2], [2, 4, 2]).clear, false);
});

test('state bytes preserve graph aliases, IEEE values and typed arrays', () => {
  const node = { value: -0, inf: Infinity, missing: undefined, nan: NaN }, root = { a: node, b: [node], f: new Float64Array([-0, Infinity]) };
  const back = unpack('test', pack('test', root));
  assert.equal(back.a, back.b[0]); assert.deepEqual(back, root);
  assert.throws(() => unpack('mesh', pack('test', root)), /incompatible/);
  assert.throws(() => pack('test', { fn() {} }), /data only/);
});

test('malformed geometry and agent dimensions fail before baking', () => {
  assert.throws(() => bakeTile({ positions: [NaN, 0, 0] }, config, 0, 0), /triangles/);
  assert.throws(() => bakeTile({ positions: [0, 0, 0], indices: [-1, 0, 0] }, config, 0, 0), /index/);
  assert.throws(() => bakeTile(field(), { ...config, cellSize: 0 }, 0, 0), /cellSize/);
  assert.throws(() => flat().addObstacle({ min: [1, 1, 1], max: [0, 0, 0] }), /bounds/);
});

test('stacked floors stay distinct and compatible config key order does not matter', () => {
  const lower = field(), upper = field(() => 3);
  const triangles = { positions: [...lower.positions, ...upper.positions], indices: [...lower.indices, ...Array.from(upper.indices, i => i + lower.positions.length / 3)] };
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  const m = new Mesh(reordered, [1, .5, 1]);m.loadTile(bakeTile(triangles, config, 0, 0));
  assert.ok(m.nearest([5, .1, 5])[1] < .3);
  assert.ok(m.nearest([5, 3.1, 5])[1] > 3);
  assert.equal(m.path([2, .1, 2], [8, 3.1, 8]).complete, false);
  const id = m.addObstacle({ min: [4, 2.5, -1], max: [6, 6, 11] });
  assert.equal(m.path([2, .1, 5], [8, .1, 5]).complete, true);
  assert.equal(m.path([2, 3.1, 5], [8, 3.1, 5]).complete, false);
  m.removeObstacle(id);
  assert.equal(m.path([2, 3.1, 5], [8, 3.1, 5]).complete, true);
});

test('unloaded tiles apply existing obstacles and links reconnect after reloading', () => {
  const m = flat(), right = bakeTile(field(() => 0, 8), config, 1, 0);
  const box = m.addObstacle({ min: [14, -1, -1], max: [16, 4, 11] });
  m.loadTile(right);
  assert.equal(m.path([1, .1, 5], [19, .1, 5]).complete, false);
  m.addLink([13, .1, 5], [17, .1, 5], .5, true);
  assert.equal(m.path([1, .1, 5], [19, .1, 5]).complete, true);
  m.unloadTile(1, 0);m.loadTile(right);
  assert.equal(m.path([1, .1, 5], [19, .1, 5]).complete, true);
  m.removeObstacle(box);
  assert.equal(m.raycast([1, .1, 5], [19, .1, 5]).clear, true);
});
