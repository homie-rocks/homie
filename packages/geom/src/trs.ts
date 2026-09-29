/**
 * ============================================================================
 *  trs — a translate/rotate/scale matrix without three allocations.
 * ============================================================================
 *  Composes into module-scope scratch objects and returns the shared Matrix4.
 *  That is a deliberate exception to "immutable at the API boundary": this is
 *  called tens of thousands of times during world build, the result is consumed
 *  immediately by `GeoAccum.add` or `InstSet.add` (both of which clone or read
 *  it before returning), and contained mutation in a hot path is acceptable
 *  with a comment saying why. This is that comment.
 *
 *  THE RETURNED MATRIX IS NOT YOURS TO KEEP. The next call overwrites it.
 *
 *  Byte-identical in the two racing games it was extracted from.
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
// In the source games this was a `_v` shared with `GeoAccum`, far away in the
// same large file and used by two unrelated pieces of arithmetic — exactly the
// coupling a big file makes invisible. It is a scratch vector, written by
// `.set()` and read by `.compose()` on the very next expression with nothing in
// between, so a private one is behaviour-identical and cannot be interleaved by
// a future caller. Split, not shared.
const _tv = new THREE.Vector3();

export function trs(px: number, py: number, pz: number, ry: number, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0): THREE.Matrix4 {
  _q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return _m.compose(_tv.set(px, py, pz), _q, _s.set(sx, sy, sz)).clone();
}

/**
 * Anchor whose +Z points along `dir` — VFX emits along an anchor's forward.
 *
 * The other half of the same job as `trs` and the opposite trade: `trs` returns
 * shared scratch because it runs tens of thousands of times during world build,
 * this allocates because a machine has about a dozen anchors and each one is
 * kept for the life of the model. Nothing here is scratch and the result IS
 * yours to keep.
 *
 * Byte-identical in the two racing games it was extracted from.
 */
export function anchor(name: string, x: number, y: number, z: number, dir?: THREE.Vector3): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  if (dir) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  return o;
}
