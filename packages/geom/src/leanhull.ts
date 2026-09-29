/**
 * ============================================================================
 *  leanhull — how low the bodywork gets, and which corner is which.
 * ============================================================================
 *  Three pieces of scene-graph arithmetic that stood in the vehicle class of
 *  two racing games. Most of what is in those classes is genuinely per-game —
 *  one drift ladder against another's shear and heat budget, and two tyre
 *  solves that take the same arguments, guard NaN the same way and clamp in
 *  the OPPOSITE ORDER, both correct for their own game. NONE OF THAT IS HERE
 *  and none of it should ever be.
 *
 *  What is here is the part that never diverged: reducing a mesh to the few
 *  vertices that can ever be its lowest point under lean, asking that reduced
 *  set for a height, and matching four wheel nodes to four suspension corners
 *  by rest position. `lowestBody` and the corner matcher were BYTE-IDENTICAL
 *  in the two games; `buildLeanHull` differed in exactly one line, and that
 *  line is a VALUE — where the contact plane is — which is why it is a
 *  parameter and stayed in the games with its own reasoning beside it.
 *
 *  IT IS GEOMETRY AND NOT A VEHICLE. Everything below takes an `Object3D` and
 *  numbers and returns numbers. It does not know what a kart is, what a lap
 *  is, or that the thing it measured has wheels — `cornerMap` would match the
 *  four legs of a table. That is what keeps it inside this package's rule: it
 *  may know triangles, matrices, instances and cells; it may not know a prop,
 *  a track or a building.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * Shared empty hull, so the no-bodywork case allocates nothing.
 *
 * THE ANNOTATION IS LOAD-BEARING. Without it tsc infers
 * `Float32Array<ArrayBuffer>` here and `Float32Array<ArrayBufferLike>` from
 * `buildLeanHull`'s declared return, a consumer's `private leanHull =
 * EMPTY_HULL` picks up the narrow one, and the assignment one method later
 * stops compiling for a reason that has nothing to do with either.
 */
export const EMPTY_HULL: Float32Array = new Float32Array(0);

/**
 * The envelope `buildLeanHull` samples, and where the ground is. EVERY FIELD
 * IS A VALUE A GAME SUPPLIES — there is no flag here that changes what the
 * function does, and there must never be one.
 */
export interface LeanScan {
  /**
   * The contact plane, in the scanned node's own frame. The kart racer passes
   * `-bodyRestY` because its chassis origin IS the contact plane; the space
   * racer passes `-bodyRestY - minGap` because its hull origin is the emitter plane
   * and the plate is a bottomed-out suspension gap below that. The reasoning
   * for each lives in the game that holds it.
   */
  floor: number;
  /** above this height a vertex can never be the low point */
  scanY: number;
  /** within this of `floor` a vertex is interior and cannot be the low point */
  ignoreY: number;
  /** half-width of the roll envelope, radians */
  scanRoll: number;
  /** half-width of the pitch envelope, radians */
  scanPitch: number;
}

/**
 * Reduce a mesh to the few vertices that can ever be its lowest point under
 * lean. Runs once per vehicle at build time; allocation here is fine, the
 * per-frame path it feeds allocates nothing.
 *
 * The reduction is a support-function argument: for a fixed roll and pitch the
 * height of a vertex is a linear function of it, so the lowest vertex is a
 * corner of the convex hull and the set of winners over a bounded envelope of
 * angles is tiny. Sampling the envelope on a grid and keeping every winner
 * captures that set without having to build a hull.
 */
export function buildLeanHull(node: THREE.Object3D, o: LeanScan): Float32Array {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts: number[] = [];

  node.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const attr = mesh.geometry?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    local.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(local);
      if (v.y > o.scanY) continue;               // above the widest point: never lowest
      if (v.y < o.floor + o.ignoreY) continue;   // interior, see above
      pts.push(v.x, v.y, v.z);
    }
  });

  if (pts.length === 0) return EMPTY_HULL;

  const keep = new Set<number>();
  const N = 9;
  for (let a = 0; a < N; a++) {
    const roll = o.scanRoll * (-1 + (2 * a) / (N - 1));
    const sr = Math.sin(roll), cr = Math.cos(roll);
    for (let b = 0; b < N; b++) {
      const pitch = o.scanPitch * (-1 + (2 * b) / (N - 1));
      const sp = Math.sin(pitch), cp = Math.cos(pitch);
      let lo = Infinity;
      let at = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const y = -pts[i]! * sr + (pts[i + 1]! * cp - pts[i + 2]! * sp) * cr;
        if (y < lo) { lo = y; at = i; }
      }
      keep.add(at);
    }
  }

  const hull = new Float32Array(keep.size * 3);
  let j = 0;
  for (const i of keep) {
    hull[j++] = pts[i]!;
    hull[j++] = pts[i + 1]!;
    hull[j++] = pts[i + 2]!;
  }
  return hull;
}

/**
 * Height of the lowest point of a lean hull for a given lean, in the frame the
 * hull was built in — where y = 0 is the contact plane.
 *
 * The callers pose the shell as (pitch, yaw, -roll) — order ZYX on the
 * bodywork and YZX on the outer group, which differ only in where the yaw
 * sits. Either way the yaw is a rotation about the up axis and cannot change a
 * height, so the row below (the no-yaw second row, shared by both orders) is
 * exact for both. Kept in sync with those calls BY HAND, in the games; there
 * is no cheaper way to ask three.js for one row, and moving this here does not
 * change that — if a caller changes its pose order, this row is what it has to
 * come back and re-earn.
 */
export function lowestBody(hull: Float32Array, roll: number, pitch: number): number {
  if (hull.length === 0) return 0;
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  let lo = Infinity;
  for (let i = 0; i < hull.length; i += 3) {
    const y = -hull[i]! * sr + (hull[i + 1]! * cp - hull[i + 2]! * sp) * cr;
    if (y < lo) lo = y;
  }
  return lo;
}

/**
 * Match four nodes to four corners by their rest position rather than trusting
 * declaration order, so a rebuilt model cannot silently swap the steered axle
 * to the back. Corners are (sign x, sign z): FL, FR, RL, RR.
 *
 * WRITES INTO `out` rather than returning a new array. Both callers hold it as
 * `private readonly wheelMap = [0, 1, 2, 3]` and mutate in place, and handing
 * back a fresh array would have made the field assignable — a wider surface
 * bought for nothing.
 *
 * On any failure to match, `out` is left as identity 0,1,2,3: a wrong corner
 * map is a car whose front wheels steer from the back, and the identity is at
 * least the order the model author wrote.
 */
export function cornerMap(list: THREE.Object3D[], out: number[]): void {
  const want = [
    [-1, 1], [1, 1], [-1, -1], [1, -1], // FL, FR, RL, RR as (sign x, sign z)
  ];
  const used = [false, false, false, false];
  let ok = true;
  for (let c = 0; c < 4; c++) {
    let found = -1;
    for (let i = 0; i < 4; i++) {
      if (used[i]) continue;
      const p = list[i]!.position;
      if (Math.sign(p.x || want[c]![0]!) === want[c]![0] && Math.sign(p.z || want[c]![1]!) === want[c]![1]) {
        found = i;
        break;
      }
    }
    if (found < 0) { ok = false; break; }
    used[found] = true;
    out[c] = found;
  }
  if (!ok) for (let i = 0; i < 4; i++) out[i] = i;
}
