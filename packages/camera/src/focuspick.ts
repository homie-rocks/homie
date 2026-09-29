/**
 * ============================================================================
 *  focuspick — what a lens pointed at the middle of frame is actually focused
 *  on.
 * ============================================================================
 *
 *  ── A RAYCAST, NOT "THE GROUND UNDER THE CROSSHAIR" ────────────────────────
 *
 *  The subject of a photograph is usually the thing in front of the ground: a
 *  50 m hull, a 1.73 m figure, a vehicle. Focusing on the terrain behind it is
 *  exactly wrong and looks like a broken control rather than a design choice.
 *
 *  ── THREE KINDS OF HIT A CAMERA CANNOT FOCUS ON ────────────────────────────
 *
 *  1. INVISIBLE ONES. `intersectObject` with `recursive` still returns meshes
 *     whose `visible` is false in some three versions and always returns ones
 *     whose PARENT is hidden; a hidden mesh is not in the picture.
 *  2. THE LENS ITSELF. A hit closer than `nearM` is the inside of a viewmodel
 *     or a ghost sitting on the camera, and focusing there blurs the world.
 *  3. ADDITIVE OVERLAYS. Anything with `depthWrite === false` and
 *     `transparent === true` is a glow, a plume or a guide — it is IN the
 *     frame but it is not a surface, and a real lens does not focus on it.
 *
 *  The FOURTH filter is the caller's and cannot be anything else: a name
 *  pattern for the things this particular world puts at infinity — its sky,
 *  its stars, its planet, its placement ghost. A package that shipped that
 *  regular expression would be naming another game's fiction.
 *
 *  ── USER-INITIATED ONLY ────────────────────────────────────────────────────
 *
 *  A full-scene recursive raycast with a mature scene on screen is not a
 *  per-frame cost worth paying. This is what an AUTOFOCUS button calls.
 */
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _mid = new THREE.Vector2(0, 0);

/** Every number and pattern the pick uses. None of them has a default. */
export interface FocusPickOptions {
  /** Cast no further than this, world units. */
  farM: number;
  /** Hits closer than this are the lens, not the subject. */
  nearM: number;
  /** Clamp on the answer, world units. */
  minM: number;
  maxM: number;
  /**
   * Names — the object's own and its parent's, joined by a pipe — that are at
   * infinity or are not really in the world. THIS GAME'S FICTION, and the
   * reason the option exists rather than a default.
   */
  skipName: RegExp;
}

/**
 * Distance to the first focusable surface under the centre of frame, or -1
 * when nothing in the scene qualifies. -1 rather than a plausible fallback:
 * "there is no subject" is a thing the caller should be able to say out loud,
 * and a lens silently focused at some default is the tolerant-default failure.
 */
export function focusUnderCentre(
  camera: THREE.Camera, scene: THREE.Object3D, o: FocusPickOptions,
): number {
  _ray.setFromCamera(_mid, camera);
  _ray.far = o.farM;
  const hits = _ray.intersectObject(scene, true);
  for (const h of hits) {
    const obj = h.object as THREE.Object3D & { material?: unknown };
    if (!obj.visible || h.distance < o.nearM) continue;
    const nm = (obj.name || '') + '|' + (obj.parent ? obj.parent.name || '' : '');
    if (o.skipName.test(nm)) continue;
    const m = obj.material as { depthWrite?: boolean; transparent?: boolean } | undefined;
    if (m && m.depthWrite === false && m.transparent === true) continue;
    return h.distance < o.minM ? o.minM : h.distance > o.maxM ? o.maxM : h.distance;
  }
  return -1;
}
