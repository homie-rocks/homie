/**
 * ============================================================================
 *  pickscene — a screen ray, and the OWNER of whatever it hit.
 * ============================================================================
 *
 *  ── THE RAY HITS A MESH; THE GAME OWNS A GROUP ─────────────────────────────
 *
 *  Anything built by a factory is a group with meshes several levels inside it,
 *  so `intersectObject(scene, true)` never returns the object a game has a
 *  record for. Every picker therefore walks UP from the hit until it finds a
 *  node it recognises — and every picker that forgets to walk up reports
 *  "nothing here" while the player is clicking directly on a building.
 *
 *  The walk is depth-capped. An unbounded parent walk on a malformed graph — a
 *  cycle, or a node re-parented into its own subtree — does not throw, it
 *  hangs, on the pointer path.
 *
 *  ── AND IT ASKS THE HITS IN ORDER ──────────────────────────────────────────
 *
 *  `intersectObject` returns hits sorted by distance. The first hit whose chain
 *  reaches a known node wins, so a piece of unowned scenery in front of a
 *  building does not swallow the click — it is skipped, and the building behind
 *  it is picked. Taking only `hits[0]` and testing that one is the other
 *  common way to write this, and it makes every structure unclickable from any
 *  angle where a rock is in the way.
 *
 *  ── THE INDEX IS THE CALLER'S ──────────────────────────────────────────────
 *
 *  `owner` is a lookup, not a Map, so a caller can key on whatever it already
 *  has and rebuild whenever its own world changes shape rather than on a clock
 *  this file would have to invent.
 *
 *  Nothing allocates per call except three's own hit array.
 */
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/** Every number the pick uses. None of them has a default. */
export interface ScenePickOptions {
  /** Cast no further than this, world units. */
  farM: number;
  /** Levels of parent to walk before giving up on one hit. */
  depth: number;
}

/**
 * Normalised device coordinates for a pointer position, against an element's
 * own box. `+1` is right and up, which is what a camera unproject wants and the
 * opposite of what the DOM reports on Y.
 *
 * Guarded against a zero-sized host: a canvas measured before layout would
 * otherwise divide by zero and hand a NaN to the raycaster, which picks nothing
 * for the rest of the session and looks exactly like a dead interface.
 */
export function pointerNDC(
  host: { getBoundingClientRect(): DOMRect },
  clientX: number, clientY: number, out: THREE.Vector2,
): THREE.Vector2 {
  const r = host.getBoundingClientRect();
  out.set(
    ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
    -(((clientY - r.top) / Math.max(1, r.height)) * 2 - 1),
  );
  return out;
}

/**
 * The first owner under a screen ray, or null.
 *
 * `owner` is asked for each node on the way up from a hit; the first non-null
 * answer is returned.
 */
export function pickOwner<T>(
  scene: THREE.Object3D, camera: THREE.Camera,
  ndcX: number, ndcY: number,
  owner: (o: THREE.Object3D) => T | null | undefined,
  o: ScenePickOptions,
): T | null {
  _ndc.set(ndcX, ndcY);
  _ray.setFromCamera(_ndc, camera);
  _ray.far = o.farM;
  const hits = _ray.intersectObject(scene, true);
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit === undefined) continue;
    let node: THREE.Object3D | null = hit.object;
    for (let d = 0; node && d < o.depth; d++) {
      const found = owner(node);
      if (found !== null && found !== undefined) return found;
      node = node.parent;
    }
  }
  return null;
}
