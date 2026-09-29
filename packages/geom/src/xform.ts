/**
 * ============================================================================
 *  xform — the three transform builders every merged prop assembly needs.
 * ============================================================================
 *  Extracted byte-for-byte from a base-building game's structure builder.
 *
 *  A merge accumulator takes a geometry and a matrix, so a building is written
 *  as a list of (piece, where). These are the three "where"s that come up:
 *  a place-and-turn, a place-and-tilt, and a ring. Nothing here is about a
 *  moon; `ringXf` puts ribs on a dome, mullions in a window and legs under a
 *  water tower, and none of those words appear below.
 *
 *  `trs.ts` in this package composes a single matrix from three components and
 *  is NOT the same thing: it takes a quaternion, these take an angle and an
 *  axis convention. Both stay.
 *
 *  THE SCRATCH IS THIS FILE'S OWN. In the source game these functions shared
 *  `_v` / `_v2` / `_q` / `_up` with two thousand lines of colony code. Each of
 *  the three composes into a NEW Matrix4 and `Matrix4.compose` copies, so no
 *  caller can observe the difference — but a shared mutable scratch reaching
 *  across a package boundary would be a genuine hazard rather than a
 *  theoretical one, so it does not.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();

/** Transform helper: position + Y rotation + uniform or per-axis scale. */
export function xf(x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    _v.set(x, y, z),
    _q.setFromAxisAngle(_up, ry),
    _v2.set(sx, sy, sz),
  );
}

/** Transform helper for a piece tilted about an arbitrary axis. */
export function xfAxis(x: number, y: number, z: number, axis: THREE.Vector3, angle: number, s = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    _v.set(x, y, z),
    _q.setFromAxisAngle(axis, angle),
    _v2.set(s, s, s),
  );
}

/**
 * Transform helper for a piece rotated by a full XYZ Euler triple.
 *
 * `xf` covers the common case — a piece standing upright, turned about Y — and
 * `xfAxis` covers a tilt about one named axis. This is the third thing a prop
 * generator reaches for: a dish that is both AIMED round the ring and PITCHED
 * up at the sky, which is two rotations that have to compose in a stated order.
 *
 * The order is three's default XYZ, and it is not interchangeable with an
 * equivalent-looking axis-angle pair: `Euler(-1.05, -a, 0)` pitches in the
 * piece's own frame and then yaws, which is what an alt-azimuth mount does, and
 * doing it the other way round leans the dish sideways as it goes round.
 */
export function xfEuler(
  x: number, y: number, z: number, ex: number, ey: number, ez: number, s = 1,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    _v.set(x, y, z),
    _q.setFromEuler(_e.set(ex, ey, ez)),
    _v2.set(s, s, s),
  );
}

/**
 * Transform for a piece whose LOCAL +Y is laid along `dir` — a strut, a leg, a
 * brace, a rib segment, a guy wire.
 *
 * Every generator that builds something out of struts writes this by hand and
 * every one of them writes it the same way, because there is only one way:
 * `setFromUnitVectors` from +Y. The piece is authored as a box or a cylinder
 * standing up with its centre at the origin, and this puts its midpoint at
 * `pos` pointing at `dir`.
 *
 * `dir` MUST BE NORMALISED. `setFromUnitVectors` says so in its name and
 * silently produces a rotation with a scale baked in if it is not — which
 * renders as a strut that is subtly the wrong length and is attributed to the
 * geometry rather than to the transform.
 *
 * `pos` and `dir` are read immediately: `Matrix4.compose` copies, so a caller
 * may pass its own scratch vectors and none of these needs a `.clone()`.
 */
export function xfAlign(pos: THREE.Vector3, dir: THREE.Vector3, s = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    _v.copy(pos),
    _q.setFromUnitVectors(_up, dir),
    _v2.set(s, s, s),
  );
}

/** Ring of transforms about Y — ribs, fins, legs, windows, mullions. */
export function ringXf(count: number, radius: number, y: number, opts: {
  faceOut?: boolean; startAngle?: number; scale?: number; tiltDeg?: number;
} = {}): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const s = opts.scale ?? 1;
  const tilt = ((opts.tiltDeg ?? 0) * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const a = (opts.startAngle ?? 0) + (i / count) * Math.PI * 2;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationY(opts.faceOut === false ? 0 : -a);
    if (tilt) rot.multiply(new THREE.Matrix4().makeRotationX(tilt));
    m.compose(_v.set(Math.cos(a) * radius, y, Math.sin(a) * radius), _q.setFromRotationMatrix(rot), _v2.set(s, s, s));
    out.push(m);
  }
  return out;
}
