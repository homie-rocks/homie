// lodprops.js: the bucketing and the order are a plain function over flat arrays, so
// they are tested as numbers; the two instanced meshes and the decimation are tested
// on real three objects, which need no GL to build.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { LOD_BANDS, LodProps, autoLo, decimateGeometry, lodKeeps, sortLod, triangleCount } from '@homie-rocks/render/lodprops.js';

const BANDS = { near: 2, lodAt: 20, far: 60, density: 1 };

/** Props on a line along +X, one every 5 m from the origin. */
function line(n) {
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) p[i * 3] = i * 5;
  return p;
}

test('lodprops: instances are bucketed by distance and each bucket is nearest first', () => {
  const n = 20, pos = line(n);
  const order = new Uint32Array(n), d2 = new Float32Array(n);
  // Camera at x = 50, so distances are |i*5 - 50|.
  const r = sortLod(pos, n, 50, 0, 0, BANDS, order, d2, { hi: 0, lo: 0 });
  const hi = [...order.subarray(0, r.hi)], lo = [...order.subarray(r.hi, r.hi + r.lo)];
  // Index 10 is ON the camera (inside `near`): not drawn. 6..14 otherwise are within 20 m.
  assert.deepEqual(hi, [9, 11, 8, 12, 7, 13, 6, 14]);
  // 25..50 m (60 is the limit, and the line ends at 95 = 45 m away).
  assert.deepEqual(lo, [5, 15, 4, 16, 3, 17, 2, 18, 1, 19, 0]);
  const dist = (i) => Math.abs(i * 5 - 50);
  for (const b of [hi, lo]) for (let k = 1; k < b.length; k++) assert.ok(dist(b[k]) >= dist(b[k - 1]));
});

test('lodprops: past the far distance and inside the near one nothing is drawn', () => {
  const n = 40, pos = line(n);
  const order = new Uint32Array(n), d2 = new Float32Array(n);
  const r = sortLod(pos, n, 0, 0, 0, BANDS, order, d2, { hi: 0, lo: 0 });
  // 0 is inside near; 5..20 m are full models; 25..60 m are low; 65 m and beyond are culled.
  assert.deepEqual(r, { hi: 4, lo: 8 });
  assert.ok([...order.subarray(0, 12)].every((i) => i >= 1 && i <= 12));
});

test('lodprops: a lower tier switches sooner, stops sooner, and keeps fewer of the same props', () => {
  const n = 2000, pos = new Float32Array(n * 3);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 300; pos[i * 3 + 2] = (rnd() - 0.5) * 300; }
  const order = new Uint32Array(n), d2 = new Float32Array(n);
  const drawn = {};
  for (const tier of ['high', 'medium', 'low']) {
    const r = sortLod(pos, n, 0, 0, 0, LOD_BANDS[tier], order, d2, { hi: 0, lo: 0 });
    drawn[tier] = { hi: r.hi, lo: r.lo, set: new Set(order.subarray(0, r.hi + r.lo)) };
  }
  assert.ok(drawn.high.hi > drawn.medium.hi && drawn.medium.hi > drawn.low.hi, 'fewer full models');
  assert.ok(drawn.high.set.size > drawn.medium.set.size && drawn.medium.set.size > drawn.low.set.size, 'fewer drawn at all');
  for (const i of drawn.low.set) assert.ok(drawn.high.set.has(i), 'what Low draws, High draws too');
});

test('lodprops: thinning is by a fixed hash, so the same props survive every frame, and more density only adds', () => {
  const kept = (d) => { const s = []; for (let i = 0; i < 5000; i++) if (lodKeeps(i, d)) s.push(i); return s; };
  const third = kept(0.35), again = kept(0.35), most = new Set(kept(0.8));
  assert.deepEqual(third, again);
  assert.ok(Math.abs(third.length / 5000 - 0.35) < 0.03, `about the fraction asked for: ${third.length}`);
  assert.ok(third.every((i) => most.has(i)));
  assert.equal(kept(1).length, 5000);
  assert.equal(kept(0).length, 0);
});

test('lodprops: two instanced meshes hold the two buckets, nearest first, each with its own tint', () => {
  const hiGeo = new THREE.IcosahedronGeometry(1, 3), loGeo = new THREE.IcosahedronGeometry(1, 0);
  const props = new LodProps(hiGeo, loGeo, new THREE.MeshStandardMaterial(), 16, { spread: 500 });
  const m = new THREE.Matrix4();
  const red = new THREE.Color(1, 0, 0), blue = new THREE.Color(0, 0, 1);
  for (let i = 0; i < 10; i++) props.add(m.makeTranslation(i * 10, 0, 0), i < 5 ? red : blue);
  assert.equal(props.count, 10);
  const r = props.update(0, 0, 0, { near: 0, lodAt: 35, far: 75, density: 1 });
  assert.deepEqual({ ...r }, { hi: 4, lo: 4 });
  assert.equal(props.hi.count, 4); assert.equal(props.lo.count, 4);
  const xOf = (mesh, k) => mesh.instanceMatrix.array[k * 16 + 12];
  assert.deepEqual([0, 1, 2, 3].map((k) => xOf(props.hi, k)), [0, 10, 20, 30]);
  assert.deepEqual([0, 1, 2, 3].map((k) => xOf(props.lo, k)), [40, 50, 60, 70]);
  const tintOf = (mesh, k) => [...mesh.instanceColor.array.subarray(k * 3, k * 3 + 3)];
  assert.deepEqual(tintOf(props.hi, 0), [1, 0, 0]);
  assert.deepEqual(tintOf(props.lo, 0), [1, 0, 0], 'the prop at 40 m is the fifth red one');
  assert.deepEqual(tintOf(props.lo, 1), [0, 0, 1]);
  // The camera moves to the far end: the buckets swap, and the order follows the camera.
  props.update(90, 0, 0, { near: 0, lodAt: 35, far: 75, density: 1 });
  assert.deepEqual([0, 1, 2, 3].map((k) => xOf(props.hi, k)), [90, 80, 70, 60]);
  assert.deepEqual(tintOf(props.hi, 0), [0, 0, 1]);
  // three's own culling is off, and the bounds are the caller's spread.
  assert.equal(props.hi.frustumCulled, false);
  assert.equal(props.lo.boundingSphere.radius, 500);
});

test('lodprops: a full set refuses another prop instead of overwriting one', () => {
  const g = new THREE.BoxGeometry();
  const props = new LodProps(g, g, new THREE.MeshBasicMaterial(), 2, { spread: 10 });
  const m = new THREE.Matrix4();
  assert.equal(props.add(m), 0); assert.equal(props.add(m), 1); assert.equal(props.add(m), -1);
  props.clear();
  assert.equal(props.count, 0); assert.equal(props.hi.count, 0);
});

test('lodprops: decimation makes a lower model that keeps the shape and is still closed', () => {
  const src = new THREE.IcosahedronGeometry(2, 31); // not indexed: 20 * 32 * 32 triangles
  const before = triangleCount(src);
  assert.equal(before, 20480);
  const lo = decimateGeometry(src, 0.5);
  const after = triangleCount(lo);
  assert.ok(after < before / 10 && after > 50, `far fewer triangles: ${after}`);
  // The shape survives: every vertex is still about 2 m from the centre, never outside.
  const p = lo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
    assert.ok(r > 1.7 && r <= 2 + 1e-6, `radius ${r}`);
  }
  // Closed: every edge is used by exactly two triangles.
  const edges = new Map();
  const ix = lo.index.array;
  for (let t = 0; t < ix.length; t += 3) {
    for (const [a, b] of [[ix[t], ix[t + 1]], [ix[t + 1], ix[t + 2]], [ix[t + 2], ix[t]]]) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  assert.ok([...edges.values()].every((c) => c === 2), 'no hole and no fin');
  assert.ok(lo.getAttribute('normal') && lo.getAttribute('uv'), 'normals rebuilt, uv carried');
});

test('lodprops: the automatic low model lands at or under the ratio asked for, and not far under', () => {
  const src = new THREE.TorusKnotGeometry(1, 0.35, 200, 24);
  const before = triangleCount(src);
  for (const ratio of [0.5, 0.25, 0.1]) {
    const after = triangleCount(autoLo(src, ratio));
    assert.ok(after <= before * ratio, `${ratio}: ${after} of ${before}`);
    assert.ok(after >= before * ratio * 0.5, `${ratio}: not needlessly coarse: ${after} of ${before}`);
  }
});
