/**
 * ============================================================================
 *  subject — measuring the thing the rig is pointed at, and what else got in
 * ============================================================================
 *  Two readings a composition rig needs and neither of which is about any
 *  particular subject: how big the subject's box actually is, measured off the
 *  model rather than assumed, and how much of the rest of the field ended up
 *  inside the frame it built.
 *
 *  `lens.ts` already owns what to DO with the first one — `supportRadius`,
 *  `rangeForScreenHeight`, `projectedHalfHeight`. This is where the number comes
 *  from.
 */
import * as THREE from 'three';

const _toLocal = new THREE.Matrix4();
const _xf = new THREE.Matrix4();
const _b = new THREE.Box3();
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _camF = new THREE.Vector3();
const _camR = new THREE.Vector3();
const _camU = new THREE.Vector3();

/**
 * Union of every visible mesh's bounding box under `root`, expressed in
 * `root`'s OWN frame. Empty if nothing survived the filter.
 *
 * A local-frame box rather than a world AABB because a world AABB is only the
 * subject's size while the subject is upright: the same 8.8 m hull measured
 * `[9.3, 1.7, 7.3]` level and `[5.1, 4.6, 8.8]` on a banked section, and a rig
 * that solved its arm against the second one parked the lens wherever the track
 * happened to be leaning. The local box plus `supportRadius` is exact at any
 * attitude.
 *
 * `skip` is tested UP THE CHAIN, not just on the mesh: an emitter or a plume is
 * usually a group of two or three unnamed meshes under one named parent, and
 * testing the leaf alone lets the whole thing through. The walk stops AT `root`
 * and never looks above it.
 *
 * It allocates nothing per call but does `updateWorldMatrix` on the subtree, so
 * it is a milestone-frame measurement and not a per-frame one.
 */
export function localBounds(
  root: THREE.Object3D, skip: RegExp | null, out: THREE.Box3,
): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  _toLocal.copy(root.matrixWorld).invert();
  out.makeEmpty();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as unknown as { isMesh?: boolean }).isMesh || !m.visible || !m.geometry) return;
    if (skip) {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) {
        if (p.name && skip.test(p.name)) return;
        if (p === root) break;
      }
    }
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    _xf.multiplyMatrices(_toLocal, m.matrixWorld);
    out.union(_b.copy(g.boundingBox).applyMatrix4(_xf));
  });
  return out;
}

/** What `surveyTraffic` measured. Preallocate one and pass it back in. */
export interface TrafficReport {
  /** how many others were genuinely inside the rendered frustum */
  inFrame: number;
  /** distance from `self` to the nearest other, world units; 0 if alone */
  nearM: number;
  /** whether that nearest one was in front of the LENS */
  nearAhead: boolean;
}

/**
 * How much of the rest of the field is in the picture.
 *
 * Deliberately a MEASUREMENT and not a mechanism. A rig composes against one
 * subject; the frame it builds either contains the others or does not, as a
 * consequence of where they are, and both levers that would change that are
 * worse than the note they answer — pulling the arm back far enough to sweep up
 * a pursuer needs an arm that puts the hero at a twentieth of frame height, and
 * yawing off the line toward traffic spends sightline. So the honest camera-side
 * contribution is to say what the frame contained, and let whoever owns density
 * and vantage be scored on it rather than the rig being blamed for an empty
 * mirror.
 *
 * Tested with `radius` subtracted, so something straddling the frame edge counts
 * as in shot rather than being rejected on its centre.
 *
 * `nearM` is the gap to `self` and not to the lens: it is the quantity a race
 * report can be compared against, and it is signed by nothing — one 30 m ahead
 * and one 30 m behind are equally close.
 *
 * Costs: one iteration of three dot products and two divides per subject, no
 * allocation, no square roots on the reject path.
 */
export function surveyTraffic(
  camera: THREE.Camera,
  field: readonly ({ position: THREE.Vector3 } | null | undefined)[],
  self: { position: THREE.Vector3 },
  radius: number, tanH: number, tanV: number,
  out: TrafficReport,
): TrafficReport {
  out.inFrame = 0; out.nearM = 0; out.nearAhead = false;
  if (field.length < 2) return out;

  // The RENDERED basis, off the camera's own quaternion, so this stays true even
  // if something downstream of the rig ever moves the lens.
  _camF.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _camR.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _camU.set(0, 1, 0).applyQuaternion(camera.quaternion);

  let nearSq = Infinity;
  for (let i = 0; i < field.length; i++) {
    const r = field[i];
    if (!r || r === self) continue;
    _d.copy(r.position).sub(camera.position);
    const f = _d.dot(_camF);
    const gapSq = _g.copy(r.position).sub(self.position).lengthSq();
    if (gapSq < nearSq) {
      nearSq = gapSq;
      out.nearAhead = f > 0;
    }
    if (f <= 0.5) continue;                     // behind the lens, or in it
    const nx = Math.abs(_d.dot(_camR)) - radius;
    const ny = Math.abs(_d.dot(_camU)) - radius;
    if (nx < f * tanH && ny < f * tanV) out.inFrame++;
  }
  out.nearM = nearSq < Infinity ? Math.sqrt(nearSq) : 0;
  return out;
}

/**
 * What a distant body of known angular radius is doing in the frame that was
 * rendered. Preallocate one and pass it back in; nothing here allocates.
 *
 * All angles are radians. `vAng` / `hAng` are the SIGNED angles off the view
 * axis on each screen axis and are what a servo wants; `sep`/`limb`/`ndc*` are
 * what an instrument wants.
 */
export interface SkyBodySight {
  /** angle from the view axis to the body's CENTRE */
  sep: number;
  /** ...and to its nearest LIMB. Negative means the axis is inside the body. */
  limb: number;
  /** signed off-axis angles, vertical and horizontal */
  vAng: number;
  hAng: number;
  /** the body's centre in NDC. Valid only while `ahead`. */
  ndcX: number;
  ndcY: number;
  /** in front of the lens at all */
  ahead: boolean;
  /** the body intersects the frustum — its LIMB against the corner half-angle */
  inFrame: boolean;
  /** the lens's own half-angles and their tangents, so a caller solving in
   *  angle and clamping in NDC does not recompute them */
  halfV: number;
  halfH: number;
  tanV: number;
  tanH: number;
}

/**
 * Where a sky body falls in the frame, from the camera's own orientation.
 *
 * DIRECTION-ONLY: a sky body is at a fixed world bearing, so its position in
 * frame is three dot products and no parallax. `dir` must be unit.
 *
 * `atan2` against the forward component rather than `asin`, so a body BEHIND
 * the lens reports the far side of 90 degrees instead of folding onto the near
 * one — which is the difference between a servo that stands down and one that
 * swings the frame through half a turn.
 *
 * `inFrame` tests the nearest LIMB against the frame's corner half-angle, not
 * the centre against a rectangle: a 46-degree disc intersects the frustum long
 * before its centre does, and the two readings disagree for most of the time a
 * large body is on screen.
 */
export function sightSkyBody(
  quat: THREE.Quaternion, dir: THREE.Vector3, angularRadius: number,
  halfV: number, aspect: number, out: SkyBodySight,
): SkyBodySight {
  _camF.set(0, 0, -1).applyQuaternion(quat);
  _camR.set(1, 0, 0).applyQuaternion(quat);
  _camU.set(0, 1, 0).applyQuaternion(quat);

  const f = dir.dot(_camF);
  const uy = dir.dot(_camU);
  const rx = dir.dot(_camR);

  out.vAng = Math.atan2(uy, f);
  out.hAng = Math.atan2(rx, f);
  out.sep = Math.atan2(Math.hypot(uy, rx), f);
  out.limb = out.sep - angularRadius;

  const tanV = Math.tan(halfV);
  const tanH = tanV * aspect;
  out.halfV = halfV;
  out.tanV = tanV;
  out.tanH = tanH;
  out.halfH = Math.atan(tanH);

  out.ahead = f > 0;
  out.ndcX = f > 1e-4 ? rx / (f * tanH) : 0;
  out.ndcY = f > 1e-4 ? uy / (f * tanV) : 0;
  out.inFrame = out.limb < Math.hypot(halfV, out.halfH);
  return out;
}

/**
 * Elevation of a sky body's UPPER LIMB above a plane, radians. Positive means
 * clear of it.
 *
 * One dot product. A lens on one side of a plate sees nothing on the far side of
 * it except past its edges, at any height, so this is the term that decides
 * whether a frame can carry the body at all before any question of aim arises —
 * and it is signed against the plane the caller names rather than against world
 * up, so it stays true through a surface that rolls past vertical, where the
 * open sky is world DOWN.
 *
 * A DEGENERATE NORMAL DEFAULTS TO BURIED, NOT TO VISIBLE. What costs something
 * here is a NaN reaching a composition, and standing a servo down is
 * indistinguishable from its behaviour most of the time anyway.
 */
export function limbOverPlane(
  dir: THREE.Vector3, planeNormal: THREE.Vector3, angularRadius: number,
): number {
  const d = dir.dot(planeNormal);
  const a = Number.isFinite(d) ? Math.asin(d < -1 ? -1 : d > 1 ? 1 : d) : -Math.PI / 2;
  return a + angularRadius;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  WHICH ONE OF THEM IS THE SUBJECT
 * ═══════════════════════════════════════════════════════════════════════════
 *  A pose that says "push in on one of the figures" has to choose one, and the
 *  two ways of choosing are not interchangeable.
 *
 *  NEAREST TO A POINT is the honest default and the thing that stops a pose
 *  photographing the patch of dirt a figure used to stand on.
 *
 *  NEAREST WHOSE FACE IS IN THE KEY is the one a still needs, and it is a
 *  MEASURED difference rather than a nicety: the nearest figure on a busy
 *  stretch was standing in its own contact shadow with its back to the lens
 *  while the lit ones — the ones the shot was for — were eight metres
 *  further on. A resolver that only minimises distance cannot see the sun.
 *
 *  Both return an INDEX into the field, or -1. An index rather than the object
 *  so nothing allocates and so a caller keeps its own idea of what a subject
 *  is; both walk the field exactly once.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The two fields a subject pick reads. Anything carrying them satisfies it. */
export interface Placed {
  position: { x: number; z: number };
  /** Radians, same convention as the key azimuth passed alongside. */
  heading?: number;
}

/** Every number the key-lit pick uses. None of them has a default. */
export interface KeylitTuning {
  /** Squared radius around the anchor to consider at all. */
  reachSq: number;
  /**
   * Cosine of the widest angle off the key that still counts as lit. Below
   * this the face is in its own shadow and the preference has nothing to
   * offer — 0.15 is about 81 degrees.
   */
  faceMin: number;
  /** Weight on how square-on to the key the face is. */
  faceWeight: number;
  /** Score cost per world unit of distance from the anchor. */
  distWeight: number;
}

/**
 * Index of the accepted entry nearest to (ax, az), or -1 when the field holds
 * none. Squared distances throughout; no square root on any path.
 */
export function nearestIndex<T extends Placed>(
  field: readonly T[], accept: (t: T) => boolean, ax: number, az: number,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < field.length; i++) {
    const a = field[i];
    if (a === undefined || !accept(a)) continue;
    const dx = a.position.x - ax;
    const dz = a.position.z - az;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Index of the accepted entry near (ax, az) whose face is most nearly square
 * to a key at `sunAzRad`, trading squareness against distance. -1 when nothing
 * inside `reachSq` is lit at all — which is the caller's cue to fall back to
 * `nearestIndex` rather than this file inventing a subject.
 *
 * An entry with a non-finite heading is SKIPPED rather than treated as facing
 * zero: a pool leaves `heading` undefined on a spare slot, and a NaN that
 * reaches a camera quaternion blanks the frame.
 */
export function nearestKeylitIndex<T extends Placed>(
  field: readonly T[], accept: (t: T) => boolean,
  ax: number, az: number, sunAzRad: number, o: KeylitTuning,
): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const a = field[i];
    if (a === undefined || !accept(a)) continue;
    const dx = a.position.x - ax, dz = a.position.z - az;
    const d2 = dx * dx + dz * dz;
    if (d2 > o.reachSq) continue;
    const h = a.heading;
    if (h === undefined || !Number.isFinite(h)) continue;
    const faceSun = Math.cos(h - sunAzRad);
    if (faceSun < o.faceMin) continue;
    const score = faceSun * o.faceWeight - Math.sqrt(d2) * o.distWeight;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
