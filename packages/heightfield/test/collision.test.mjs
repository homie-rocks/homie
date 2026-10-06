// A collider for an imported model: a height grid baked off its triangles with a checksum of the mesh it read,
// authored proxies for what a figure walks around, and a body that walks the result (src/MeshBake.ts, src/Proxy.ts,
// src/Route.ts). Run after `npm run build`: node --test packages/heightfield/test/collision.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeField, bakeMesh, bakeStale, bakeWire, meshChecksum, packBake, unpackBake } from '@homie-rocks/heightfield/MeshBake.js';
import { checkProxies, proxiesHit, proxiesRay, proxyTop } from '@homie-rocks/heightfield/Proxy.js';
import { createWorld } from '@homie-rocks/heightfield/Levels.js';
import { checkRoute, traverse } from '@homie-rocks/heightfield/Route.js';

/**
 * A landmark as a model arrives: a deck 6 m by 2 m at a height of 2 m, a ramp down from its +z edge to the ground
 * 4 m away, and a shelf 0.5 m up underneath the deck (so the top and the under side differ).
 */
function landmark() {
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const positions = new Float32Array([
    ...quad([-3, 2, -1], [3, 2, -1], [3, 2, 1], [-3, 2, 1]),
    ...quad([-3, 2, 1], [3, 2, 1], [3, 0, 5], [-3, 0, 5]),
    ...quad([-2, 0.5, -1], [2, 0.5, -1], [2, 0.5, 1], [-2, 0.5, 1]),
  ]);
  return { positions };
}
const MOVER = { radius: 0.3, height: 1.8, step: 0.3, maxDrop: 0.5, arrival: 0.4, speed: 3 };

test('a mesh bake samples the outside surface: the top from above, the underside from below', () => {
  const mesh = landmark();
  const top = bakeMesh(mesh, { cell: 0.25 });
  const f = bakeField(top);
  assert.equal(f.heightAt(0, 0), 2, 'the deck, not the shelf under it');
  assert.ok(Math.abs(f.heightAt(0, 3) - 1) < 1e-6, 'half way down the ramp');
  assert.ok(f.covered(0, 0) && !f.covered(0, 9), 'covered says where the mesh was');
  assert.equal(f.heightAt(40, 40), 0, 'off the model: the lowest point of the mesh, not a height that was never measured');
  assert.equal(top.source.triangles, 6);
  const under = bakeField(bakeMesh(mesh, { cell: 0.25, side: 'under' }));
  assert.equal(under.heightAt(0, 0), 0.5, 'from below, the shelf');
  assert.equal(under.heightAt(2.5, 0), 2, 'and the deck where no shelf is under it');
  assert.equal(bakeField(bakeMesh(mesh, { cell: 0.25, maxY: 1 })).heightAt(0, 0), 0.5, 'maxY leaves out what is wholly above it');
  assert.throws(() => bakeMesh(mesh, { cell: 0 }), /cell/);
  assert.throws(() => bakeMesh({ positions: [] }, { cell: 1 }), /no triangle/);
});

test('a bake knows which mesh it read: a changed mesh, or another cell, is stale with a reason', () => {
  const mesh = landmark();
  const bake = bakeMesh(mesh, { cell: 0.25 });
  assert.equal(bakeStale(bake, mesh), null);
  assert.equal(bakeStale(bake, landmark(), { cell: 0.25, side: 'top' }), null, 'the same numbers in another array are the same mesh');
  const moved = landmark();
  moved.positions[1] += 0.4; // one corner of the deck, 40 cm up
  assert.match(bakeStale(bake, moved), /mesh changed since the bake/);
  assert.match(bakeStale(bake, mesh, { cell: 0.5 }), /cell is 0.25 m and 0.5 m is wanted/);
  assert.notEqual(meshChecksum(mesh), meshChecksum(moved));
  assert.match(meshChecksum(mesh), /^[0-9a-f]{16}$/);
  // An indexed copy of the same triangles is a different file and reads as a different mesh.
  assert.notEqual(meshChecksum({ positions: mesh.positions, indices: Uint16Array.from({ length: 18 }, (_, i) => i) }), meshChecksum(mesh));
});

test('a bake survives a JSON file, and its overlay lies on the surface at true scale', () => {
  const bake = bakeMesh(landmark(), { cell: 0.25 });
  const back = unpackBake(JSON.parse(JSON.stringify(packBake(bake))));
  assert.equal(back.source.checksum, bake.source.checksum);
  assert.deepEqual([back.nx, back.nz, back.x0, back.z0, back.cell], [bake.nx, bake.nz, bake.x0, bake.z0, bake.cell]);
  let worst = 0;
  for (let k = 0; k < bake.heights.length; k += 1) worst = Math.max(worst, Math.abs(bake.heights[k] - back.heights[k]));
  assert.ok(worst <= 0.0006, `heights come back within a millimetre (worst ${worst})`);
  assert.deepEqual([...back.covered], [...bake.covered]);
  assert.throws(() => unpackBake({ v: 2 }), /not a version 1/);
  const wire = bakeWire(bake, 2);
  const f = bakeField(bake);
  assert.ok(wire.length > 0 && wire.length % 6 === 0);
  for (let k = 0; k < wire.length; k += 3) {
    assert.ok(wire[k] >= -3 && wire[k] <= 3 && wire[k + 2] >= -1 && wire[k + 2] <= 5, 'every overlay point is over the model, in its metres');
    assert.ok(Math.abs(f.heightAt(wire[k], wire[k + 2]) - wire[k + 1]) < 1e-5, 'and on the baked surface');
  }
});

test('authored proxies: a top to stand on, a body that overlaps, a ray that stops', () => {
  const crate = { kind: 'box', id: 'crate', x: 0, y: 2, z: 0, hx: 0.5, hz: 0.5, h: 1 };
  const pillar = { kind: 'cylinder', id: 'pillar', x: 4, y: 0, z: 0, r: 0.5, h: 3, walkTop: false };
  const ramp = { kind: 'ramp', id: 'ramp', x: 0, y: 0, z: 10, hx: 1, hz: 2, h: 1, yaw: Math.PI / 2 };
  assert.deepEqual(checkProxies([crate, pillar, ramp]), []);
  assert.match(checkProxies([{ kind: 'box', x: 0, y: 0, z: 0, hx: 0, hz: 1, h: 1 }])[0], /hx and hz/);
  assert.equal(proxyTop(crate, 0.4, 0.4), 3);
  assert.equal(proxyTop(crate, 0.6, 0), -Infinity);
  // Turned a quarter, the ramp's rise runs along world x: the same turn a three.js rotation.y gives a mesh.
  assert.ok(Math.abs(proxyTop(ramp, 2, 10) - 1) < 1e-9 && Math.abs(proxyTop(ramp, -2, 10)) < 1e-9 && Math.abs(proxyTop(ramp, 0, 10) - 0.5) < 1e-9);
  assert.equal(proxyTop(ramp, 0, 11.5), -Infinity, 'its width is across world z now');
  assert.equal(proxiesHit([crate, pillar], 0.7, 0, 0.3, 2.3, 3.8), 0, 'a body 0.3 m wide, 0.7 m from the crate\'s middle, overlaps it');
  assert.equal(proxiesHit([crate, pillar], 0.9, 0, 0.3, 2.3, 3.8), -1);
  assert.equal(proxiesHit([crate, pillar], 0, 0, 0.3, 3.0, 4.8), -1, 'standing on top of it is not inside it');
  assert.ok(Math.abs(proxiesRay([crate, pillar], -5, 2.5, 0, 1, 0, 0) - 4.5) < 1e-9, 'the crate\'s near face');
  assert.ok(Math.abs(proxiesRay([pillar], -5, 1, 0, 1, 0, 0) - 8.5) < 1e-9, 'the pillar\'s near side');
  assert.equal(proxiesRay([crate, pillar], -5, 5, 0, 1, 0, 0), Infinity, 'over both');
  assert.equal(proxiesRay([crate], -5, 2.5, 0, 1, 0, 0, 3), Infinity, 'further than the ray goes');
});

test('a sample bot walks the baked landmark: up the ramp and across the deck, and not off its side or through a crate', () => {
  const ground = bakeField(bakeMesh(landmark(), { cell: 0.25 }));
  const world = createWorld({ ground });
  const up = [{ x: 0, y: 0, z: 4.8 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }];
  assert.deepEqual(checkRoute(world, up, MOVER), []);
  const run = traverse(world, up, MOVER);
  assert.equal(run.why, 'arrived');
  assert.ok(Math.abs(run.at.y - 2) < 1e-6, 'it finishes on the deck');
  // Off the end of the deck there is nothing at its height: the static check and the walk agree.
  const off = [{ x: 0, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }];
  assert.equal(checkRoute(world, off, MOVER).some((p) => p.kind === 'unsupported' || p.kind === 'missing'), true);
  assert.equal(traverse(world, off, MOVER).why, 'fell');
  // A crate authored on the deck is in the way of the same walk.
  const crated = createWorld({ ground, proxies: [{ kind: 'box', id: 'crate', x: 1, y: 2, z: 0, hx: 0.3, hz: 0.6, h: 1, walkTop: false }] });
  assert.equal(traverse(crated, up, MOVER).why, 'blocked');
  const found = checkRoute(crated, up, MOVER).find((p) => p.kind === 'blocked');
  assert.match(found.why, /crate is in the way/);
  assert.equal(crated.solidAt(1, 2, 0, 0.3, 1.8, 0.3), 'inside crate');
  assert.ok(Math.abs(crated.ray(-2, 2.5, 0, 1, 0, 0) - 2.7) < 1e-9, 'a shot along the deck stops at the crate');
  assert.ok(Math.abs(world.ray(0, 5, 0, 0, -1, 0) - 3) < 0.01, 'a ray straight down finds the deck');
});
