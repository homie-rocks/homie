import * as THREE from 'three';

/**
 * ============================================================================
 *  handheld.ts — the four conventions a thing held in front of the camera has
 *  to obey, and which nothing else in a scene does.
 * ============================================================================
 *  A first-person viewmodel is not a small prop. It is parented to the camera,
 *  it lives in the nearest twenty centimetres of the frustum, and it is built
 *  out of dozens of primitives at millimetre offsets — and every one of those
 *  primitives needs the same three flags off and the same one axis convention.
 *  Getting any of them wrong produces a defect that is invisible in a still and
 *  obvious in play:
 *
 *   1. **`frustumCulled = false`.** A viewmodel's bounding sphere is computed
 *      in LOCAL space and tested against the frustum after the camera's own
 *      transform, and a mesh 4 cm from the near plane rounds in and out of that
 *      test as the player turns. The gun flickers. Nothing in a still shows it.
 *   2. **`castShadow = false`.** A held object is inside the shadow camera's
 *      near range for every cascade, so it writes a hand-shaped smear across
 *      the whole first split — the frame goes dark when you look down.
 *   3. **`receiveShadow = false`.** It is lit by its own rig, not by the world;
 *      a world shadow landing on a gun that is 20 cm from the lens reads as the
 *      gun turning off.
 *   4. **CYLINDERS RUN ALONG Z.** three.js's `CylinderGeometry` is a +Y
 *      cylinder and every barrel, tube, muzzle and torch a hand holds points
 *      DOWN THE LENS. `cylinderZ` does that rotation once, in one place, with
 *      the near end named — so a caller says which radius is at the camera
 *      rather than working out which way `rotateX(PI/2)` went.
 *
 *  NOTHING HERE IS ABOUT A WEAPON. It is about being held, which is the same
 *  for a torch, a clipboard, a scanner, a mug and a pair of hands.
 * ============================================================================
 */

/** Every flag a held mesh needs off, applied to one object. */
export function heldFlags(o: THREE.Mesh): THREE.Mesh {
  o.castShadow = false;
  o.receiveShadow = false;
  o.frustumCulled = false;
  return o;
}

/**
 * A mesh posed by numbers, with the held flags already off.
 *
 * Euler order is three.js's default XYZ, deliberately unstated: a viewmodel is
 * authored by nudging one axis at a time against a frame, and an author who
 * needs a different order is building something this function is the wrong
 * shape for.
 */
export function heldMesh(
  geo: THREE.BufferGeometry, mat: THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return heldFlags(m);
}

/**
 * A cylinder lying along local Z, with `rRear` at +Z (the camera) and `rFwd`
 * at -Z (the muzzle end).
 *
 * The two radii are named by END and not by "top"/"bottom", because after the
 * rotation there is no top: a caller taping a taper on by trial and error gets
 * it right first time.
 */
export function cylinderZ(
  rRear: number, rFwd: number, len: number, seg: number, mat: THREE.Material,
  x: number, y: number, z: number,
): THREE.Mesh {
  return heldMesh(new THREE.CylinderGeometry(rRear, rFwd, len, seg), mat, x, y, z, Math.PI / 2, 0, 0);
}

/** Clear the shadow flags across a finished subtree, meshes only. */
export function heldSubtree(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
}

const _up = new THREE.Vector3(0, 1, 0);

/**
 * Put an object at `at` and rotate its local +Y to point along `at -> toward`.
 *
 * A limb, in other words: everything built along +Y — a forearm, a strap, an
 * antenna, a hose — is placed by naming both of its ends rather than by
 * solving an Euler triple by hand. `scratch` is the caller's, because this runs
 * on every pose change and a fresh Vector3 in a viewmodel is a fresh Vector3
 * sixty times a second.
 *
 * A zero-length span leaves the rotation untouched rather than producing NaN:
 * three's `setFromUnitVectors` on a zero vector yields a quaternion of NaNs
 * that propagates into the parent matrix and never comes back, and the symptom
 * is an arm that simply stops being drawn with no error anywhere.
 */
export function aimAlongY(
  o: THREE.Object3D, at: THREE.Vector3, toward: THREE.Vector3, scratch: THREE.Vector3,
): void {
  o.position.copy(at);
  scratch.copy(toward).sub(at);
  if (scratch.lengthSq() === 0) return;
  o.quaternion.setFromUnitVectors(_up, scratch.normalize());
}
