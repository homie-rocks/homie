/**
 * ============================================================================
 *  screenpoint — a world point in client pixels, and the guard that stops a
 *  label appearing on the wrong side of the frame.
 * ============================================================================
 *
 *  ── THE MIRROR IS THE WHOLE REASON THIS IS A FUNCTION ──────────────────────
 *
 *  `Vector3.project` on a point BEHIND the camera does not return nothing and
 *  does not throw. The perspective divide flips both signs, so the point lands
 *  at a mirrored position ON SCREEN — a chip belonging to a ship behind the
 *  lens is drawn on the opposite side of the frame from the ship, following it
 *  the wrong way as the camera turns. Every diegetic layer written without this
 *  guard has the same ghost in it, and it reads as a placement bug rather than
 *  as a projection one.
 *
 *  NDC z is what separates the two: at or past 1 the point is beyond the far
 *  plane or behind the eye. The test is written `!(z < 1)` and not `z >= 1`
 *  deliberately, so a NaN — which compares false against everything — is
 *  rejected rather than accepted.
 *
 *  ── AND A SCREEN RADIUS IS NOT A DIVISION ──────────────────────────────────
 *
 *  "How big is a metre, here, in pixels" solved as `focal / distance` is only
 *  right on the view axis; off-axis it under-reports, and a ring drawn from it
 *  sits inside the thing it is supposed to circle at the edges of a wide frame.
 *  Projecting a second point offset along the CAMERA'S OWN RIGHT VECTOR and
 *  measuring the screen distance is exact everywhere, costs one extra project,
 *  and is independent of where the subject sits in frame.
 *
 *  Nothing here allocates and nothing here reads the DOM.
 */
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _right = new THREE.Vector3();

/** A point in client pixels. Only meaningful when the call returned true. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * World point to client pixels against a viewport `w` by `h`. False when the
 * point is behind the eye or past the far plane, in which case `out` is not
 * written and the caller must draw nothing.
 */
export function projectToScreen(
  camera: THREE.Camera, x: number, y: number, z: number,
  w: number, h: number, out: ScreenPoint,
): boolean {
  _p.set(x, y, z);
  _p.project(camera);
  if (!(_p.z < 1)) return false;
  out.x = (_p.x * 0.5 + 0.5) * w;
  out.y = (-_p.y * 0.5 + 0.5) * h;
  return true;
}

/**
 * Screen radius, in pixels, of a world-space radius `r` at a world point that
 * has already been projected to (sx, sy). 0 when the offset point is not on
 * screen — which a caller should read as "do not draw a ring", not as "the ring
 * is small".
 */
export function screenRadius(
  camera: THREE.Camera, cx: number, cy: number, cz: number, r: number,
  w: number, h: number, sx: number, sy: number, scratch: ScreenPoint,
): number {
  camera.matrixWorld.extractBasis(_right, _q, _q);
  if (!projectToScreen(
    camera, cx + _right.x * r, cy + _right.y * r, cz + _right.z * r, w, h, scratch)) {
    return 0;
  }
  const dx = scratch.x - sx, dy = scratch.y - sy;
  return Math.sqrt(dx * dx + dy * dy);
}
