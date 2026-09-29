import * as THREE from 'three';

/**
 * ============================================================================
 *  cone.ts — a stable basis around a direction, and a uniform sample inside a
 *  cone about it.
 * ============================================================================
 *  Two functions. Every game that scatters anything about an axis needs both —
 *  a shotgun's pellets, a thruster's plume, a sparse ray bundle for an
 *  occlusion test, a spread of debris off a normal — and every one of them
 *  gets the same two things wrong in the same two ways.
 *
 *  1. **THE BASIS DEGENERATES AT THE POLES.** `cross(dir, +Y)` is the zero
 *     vector when `dir` IS +Y, and `normalize()` on a zero vector is NaN — in
 *     three.js it returns (0,0,0) rather than throwing, so the spread silently
 *     collapses to a single ray and the shotgun fires a slug. Straight up and
 *     straight down are exactly the two directions a player finds in the first
 *     minute. `coneBasis` picks a second reference when the first is within a
 *     hundredth of parallel; that threshold is the one both this and the
 *     shipped shooter's own version used, and it is kept rather than tightened,
 *     because tightening it changes which rays a pellet spread takes.
 *
 *  2. **THE SAMPLE BUNCHES IN THE MIDDLE.** `r = random() * radius` puts half
 *     the pellets in the inner quarter of the disc's AREA, so a wide spread
 *     reads as a tight one with a few strays. `sqrt` is what makes it uniform,
 *     and it is one character that nobody notices is missing until somebody
 *     says the shotgun "feels like a rifle".
 *
 *  RANDOMNESS IS THE CALLER'S. Both draws come in as arguments rather than
 *  being taken here, which is the whole reason this is testable: a test
 *  sweeps `u` and `v` over a grid and gets an exact answer, and a game that
 *  wants a seeded stream keeps its own. It also means the DRAW ORDER stays
 *  where the game can see it — `spread(d, r, rng(), rng())` consumes two draws
 *  in written order, and a function that drew them internally would move that
 *  decision behind a call.
 *
 *  THE ANGLE IS IN RADIANS. Both games that had this held degrees at the call
 *  site and converted; a package that took degrees would be one that has an
 *  opinion about how a designer writes a number down.
 * ============================================================================
 */

const _y = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);

/**
 * Fill `right` and `up` with an orthonormal pair perpendicular to `dir`.
 *
 * `dir` must already be unit; nothing here normalises it, because the caller
 * always just did and a second normalise is a second rounding.
 *
 * The reference flips at |dir.y| >= 0.99 and not at 1: a direction one part in
 * ten thousand off the pole still produces a near-zero cross product, and
 * "nearly NaN" is a basis whose two axes are almost the same line.
 */
export function coneBasis(dir: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
  if (Math.abs(dir.y) < 0.99) right.crossVectors(dir, _y).normalize();
  else right.crossVectors(dir, _x).normalize();
  up.crossVectors(right, dir).normalize();
}

/**
 * Perturb a unit `dir` to a uniform sample inside a cone of half-angle `rad`,
 * IN PLACE, and return it.
 *
 * `u` and `v` are two independent draws in [0, 1): `u` picks the bearing round
 * the axis and `v` the distance out, through a `sqrt` so the disc is covered
 * uniformly by AREA rather than by radius.
 *
 * A non-positive `rad` returns `dir` untouched and consumes nothing. The
 * offsets are added and the result re-normalised, which makes this a small-
 * angle approximation of a spherical cap — at the angles a weapon or a plume
 * actually uses it is indistinguishable, and it is exactly what shipped.
 */
export function spreadDir(
  dir: THREE.Vector3, rad: number, u: number, v: number,
  right: THREE.Vector3, up: THREE.Vector3,
): THREE.Vector3 {
  if (rad <= 0) return dir;
  const theta = u * Math.PI * 2;
  const r = Math.sqrt(v) * rad;
  coneBasis(dir, right, up);
  dir.addScaledVector(right, Math.cos(theta) * r);
  dir.addScaledVector(up, Math.sin(theta) * r);
  return dir.normalize();
}
