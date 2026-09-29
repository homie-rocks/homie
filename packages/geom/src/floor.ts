/**
 * ============================================================================
 *  floor — the highest solid surface under a point, out of a scene graph.
 * ============================================================================
 *  What is under a thing, asked by something that is not walking. A vehicle
 *  parked on a deck, a prop founded on a plinth, a crate set down on a ramp:
 *  they all need the same answer and none of them can get it from a
 *  heightfield, because the thing they are standing on was BUILT and is not in
 *  the field.
 *
 *  IT IS NOT `@homie-rocks/walk/Ground.ts` AND MUST NOT BE FOLDED INTO IT. That one
 *  is a controller's per-step sample and its whole contract is that it does not
 *  allocate and does not traverse; this one walks a scene graph and casts a
 *  ray, which is fine four times in a session and ruinous sixty times a second.
 *  Same question, opposite budget — and a shared implementation would be
 *  whichever of those two the last person needed.
 *
 *  IT IS ALSO NOT A DROP-TO-GROUND HELPER. It returns a height and takes no
 *  opinion about what to do with it. The FALLBACK is the caller's `base`, which
 *  is the honest default: a thing whose pad has not been built yet stands on
 *  the ground, and a package inventing its own fallback would be a plausible
 *  default answering for a fact it does not have.
 *
 *  ── THE FOUR FILTERS, AND EVERY ONE OF THEM IS A BUG THAT HAPPENED ──────────
 *
 *   1. A BAND. A hit has to be within reach of the caller's reference height to
 *      count. A deck is tens of centimetres; anything past the band is a
 *      building, a mast or a tank, and standing a vehicle on the roof of one is
 *      a far louder bug than the one being fixed.
 *   2. VISIBILITY, UP THE WHOLE PARENT CHAIN. A world that keeps hidden LOD
 *      copies in the graph will happily hand a ray the level nobody can see,
 *      and the result is an object a metre out with nothing in the picture to
 *      explain it.
 *   3. AN EXCLUDED SUBTREE, also up the parent chain, so a thing cannot stand
 *      on itself — including on a merged bake of itself under another parent.
 *   4. A VERTEX CEILING. A single pathological mesh can cost more than every
 *      other candidate together; this is a guard against that and not a common
 *      path, so it is generous rather than tight.
 *
 *  The world AABB test runs before any of the ray work, so the ray itself only
 *  ever meets the handful of meshes that actually straddle the query point.
 *
 *  ONE SET OF SCRATCH OBJECTS, AND THEY ARE THIS MODULE'S OWN. Borrowing a
 *  caller's shared vector is a class of bug that is slow to find: this is
 *  called from inside an update and from inside an event handler, and either
 *  may be under the other on the stack.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();
const _candidates: THREE.Object3D[] = [];
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export interface SurfaceUnderOpts {
  /** how far ABOVE `base` a hit may be and still count as the same surface */
  up: number;
  /** how far BELOW */
  down: number;
  /**
   * Subtrees that may not be stood on — one, or several. Each candidate's
   * whole parent chain is tested against every one of them.
   *
   * PLURAL because the second consumer needed two: a vehicle
   * must not stand on itself, and the effects system asking the same question
   * must not stand on its own particle meshes either. It had written its own
   * forty-five-line copy of this function rather than pass two.
   */
  exclude?: THREE.Object3D | readonly THREE.Object3D[] | null;
  /** a mesh with more vertices than this is skipped. See filter 4. */
  maxVerts?: number;
  /** a mesh whose `name` satisfies this is skipped — for a thing's own bakes. */
  skipName?: (name: string) => boolean;
}

/**
 * The highest surface under `(x, z)` within the band around `base`, or `base`
 * itself when nothing qualifies.
 */
export function surfaceUnder(
  root: THREE.Object3D,
  x: number,
  z: number,
  base: number,
  o: SurfaceUnderOpts,
): number {
  const lo = base - o.down;
  const hi = base + o.up;
  const maxVerts = o.maxVerts ?? 300000;
  const ex = o.exclude ?? null;
  const exclude: readonly THREE.Object3D[] | null =
    ex === null ? null : Array.isArray(ex) ? ex : [ex as THREE.Object3D];
  _candidates.length = 0;
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    if (o.skipName && typeof m.name === 'string' && o.skipName(m.name)) return;
    if (exclude !== null) {
      for (let p: THREE.Object3D | null = m; p !== null; p = p.parent) {
        for (let e = 0; e < exclude.length; e++) if (p === exclude[e]) return;
      }
    }
    for (let p: THREE.Object3D | null = m; p !== null; p = p.parent) if (!p.visible) return;
    const g = m.geometry;
    if (g === undefined || g === null) return;
    const pos = g.attributes.position;
    if (pos === undefined || pos.count > maxVerts) return;
    if (g.boundingBox === null) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb === null) return;
    _box.copy(bb).applyMatrix4(m.matrixWorld);
    if (x < _box.min.x || x > _box.max.x || z < _box.min.z || z > _box.max.z) return;
    if (_box.max.y < lo || _box.min.y > hi) return;
    _candidates.push(m);
  });
  if (_candidates.length === 0) return base;

  _ray.set(_origin.set(x, hi + 0.5, z), _down);
  _ray.near = 0;
  _ray.far = (hi + 0.5) - lo;
  // `false`: the candidate list is already flat, and recursing would re-test
  // every child of a merged container the AABB filter just rejected.
  const hits = _ray.intersectObjects(_candidates, false);
  let best = base;
  for (const h of hits) {
    if (h.point.y > best && h.point.y <= hi) best = h.point.y;
  }
  _candidates.length = 0;
  return best;
}
