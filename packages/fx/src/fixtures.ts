import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WELDING AN EFFECT TO A FIXTURE ON A RIG.
 * ----------------------------------------------------------------------------
 *  An effect that is meant to come OUT OF a specific visible part — a rack, a
 *  vent, a barrel, a lamp — has to find that part in a scene graph it did not
 *  build, group it if it is instanced, and then read its world placement fresh
 *  on every frame that uses it. Getting any of the three wrong produces the same
 *  symptom: light floating beside the machine instead of on it.
 *
 *  Lifted out of a space racer's effects system (`resolveRadiators` /
 *  `bankAt`). The names, the split threshold, the span
 *  clamp and the sanity radius are all the caller's — this file has never heard
 *  of a radiator.
 * ----------------------------------------------------------------------------
 */

const _m4 = new THREE.Matrix4();

export interface FixtureBanks {
  /** the instanced mesh the fixtures live on */
  mesh: THREE.InstancedMesh;
  /** one LOCAL centroid per non-empty bank, in the mesh's own space */
  banks: THREE.Vector3[];
  /** the measured extent of the whole fixture along z, before clamping */
  span: number;
}

/** First `InstancedMesh` under `root` whose name is one of `names`. */
export function findFixture(
  root: THREE.Object3D, names: readonly string[],
): THREE.InstancedMesh | null {
  let found: THREE.InstancedMesh | null = null;
  root.traverse((o) => {
    if (found) return;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && names.includes(o.name)) found = im;
  });
  return found;
}

/**
 * Group one instanced fixture's instances into up to three banks by their local
 * x — left of `-splitAt`, between, right of `+splitAt` — and return the local
 * centroid of each non-empty one plus the whole fixture's z extent.
 *
 * WHY BANKS RATHER THAN INSTANCES. A rack of five fins is ONE emitter as far as
 * an effect is concerned; five is five times the cost for a read nobody can
 * resolve at speed. Splitting by side is what keeps a machine with a fixture on
 * each flank from throwing one light out of its centreline.
 *
 * WHY THE SPAN IS MEASURED RATHER THAN ASSUMED. A five-element rack at 0.30 m
 * pitch and a single 1.9 m element are different objects, and sizing whatever
 * the effect throws off the measured extent rather than off a constant is what
 * keeps a roster of machines from all throwing the same one.
 *
 * Null if there is no such mesh or it has no instances — never a fabricated
 * centroid on the model's origin, because an effect with no visible fixture
 * above it is worse than no effect.
 */
export function fixtureBanks(
  root: THREE.Object3D, names: readonly string[], splitAt: number,
): FixtureBanks | null {
  const mesh = findFixture(root, names);
  if (!mesh) return null;
  // Three sums and three counts; no allocation beyond the banks that exist.
  const sx = [0, 0, 0], sy = [0, 0, 0], sz = [0, 0, 0], n = [0, 0, 0];
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _m4);
    const x = _m4.elements[12]!, y = _m4.elements[13]!, z = _m4.elements[14]!;
    const b = x < -splitAt ? 0 : x > splitAt ? 2 : 1;
    sx[b]! += x; sy[b]! += y; sz[b]! += z; n[b]!++;
    if (z < zLo) zLo = z;
    if (z > zHi) zHi = z;
  }
  const banks: THREE.Vector3[] = [];
  for (let b = 0; b < 3; b++) {
    if (n[b] === 0) continue;
    banks.push(new THREE.Vector3(sx[b]! / n[b]!, sy[b]! / n[b]!, sz[b]! / n[b]!));
  }
  if (banks.length === 0) return null;
  return { mesh, banks, span: zHi - zLo };
}

/**
 * World placement of a local point on a fixture, written into `out`.
 *
 * THROUGH THE LIVE WORLD MATRIX, every time. The fixture turns with the machine,
 * and an anchor resolved from a stale matrix is metres adrift at speed — which
 * on an effect whose whole job is to be welded to a specific part is the
 * difference between a hot fixture and a light floating beside the body.
 *
 * SANITY, NOT TASTE: false if the result lands further than `maxDist` from
 * `near`. A rig that swaps LOD shells and impostors leaves detached meshes
 * behind, and a detached mesh still answers `updateWorldMatrix` — with its LOCAL
 * matrix, which puts the effect on the world origin. Nothing bolted to a body is
 * far from it, so anything further out is a mesh that left the graph.
 */
export function fixtureWorld(
  mesh: THREE.InstancedMesh, local: THREE.Vector3, out: THREE.Vector3,
  near: THREE.Vector3, maxDist: number,
): boolean {
  mesh.updateWorldMatrix(true, false);
  out.copy(local).applyMatrix4(mesh.matrixWorld);
  return out.distanceToSquared(near) < maxDist * maxDist;
}
