/**
 * ===========================================================================
 *  @homie-rocks/camera/compose.ts — FRAMING, as opposed to FOLLOWING.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS, AND THE COST OF ITS ABSENCE WAS MEASURED.
 * ---------------------------------------------------------------------------
 * Every other module in this package trails a moving subject: `chase.ts`,
 * `rig.ts`, `spring.ts`, `bearing.ts`, `blockers.ts`, `cinematics.ts`. On
 * 2026-08-21 an experience with a FIXED camera and a FIXED object arrived — a
 * rhythm game whose entire interface is a two-metre ring on the floor — and
 * consumed **not one of them**. The package had no notion of COMPOSE, only of
 * FOLLOW, and that was the single highest-value addition it could take.
 *
 * The cost is not theoretical. That game's first framing put the outer ring
 * **off the bottom of the screen**, and the geometry is general: the part of a
 * tilted disc nearest the camera is the part that leaves the frame first, and
 * it is where the thing a player is reading happens to be. It was found by
 * turning a panel upright, not by reading the code.
 *
 * SOLVED AGAINST THE PROJECTION, NOT AGAINST A SPHERE.
 * ---------------------------------------------------------------------------
 * The obvious implementation reserves the smaller half-angle for a bounding
 * ball of the subject. That is correct and it wastes half the panel, because a
 * flat ring seen at 47 degrees is compressed vertically on screen by roughly
 * the cosine of that angle. So the camera slides along its own direction and
 * the subject's OWN POINTS are projected at each candidate distance. A
 * bisection, because the predicate is monotone in distance and a bisection is
 * the one root-finder that cannot diverge — twenty-four turns is a distance
 * resolved to one part in sixteen million of the search span, at boot and on
 * resize only.
 *
 * NOTHING HERE IS A TUNING CONSTANT AND NOTHING HAS A DEFAULT. `lens.ts` states
 * the rule this file follows: a caller that omits a field must FAIL TO COMPILE
 * rather than inherit somebody else's art direction. A margin of 0.92 is the
 * rhythm game's judgement about a 55-inch panel across a sofa; a title card
 * wants a different one, and a shared default would have picked one of them
 * for everybody and the frames would have looked completely fine.
 *
 * `three` is a peer dependency, never a dependency. Two copies of three.js is
 * two `instanceof` universes; the symptom is an object that renders as nothing
 * with no error at all.
 */
import * as THREE from 'three';

/**
 * The ring of points that must stay inside the picture.
 *
 * A RING RATHER THAN A SPHERE, and that is the whole reason this is not four
 * lines of trigonometry. `centre`, `radius` and `height` describe a horizontal
 * circle: the extremities of a disc, a table, a track, an arena floor — the
 * shapes a composed shot is actually built around. `height` is the top of the
 * tallest thing standing on it, because that is the point that leaves the top
 * of the frame.
 *
 * `samples` is required and it is not a performance knob. The solver fits the
 * inscribed POLYGON, not the circle, so the true extremity sits outside the
 * solved bound by a factor of `1/cos(π/samples) - 1` — and that is a NUMBER
 * rather than a hand-wave:
 *
 *     samples   overshoot     at margin 0.92
 *        16     1.96 %        0.0180 of NDC
 *        32     0.48 %        0.0044
 *        48     0.21 %        0.0020
 *        96     0.05 %        0.0005
 *
 * A probe measured the rhythm game's ring at 48 samples on a
 * 820x1180 tablet: the worst point reached 0.9217 against a 0.92 target, an
 * excess of 0.0017 — inside the 0.0020 the table predicts, so the solver is
 * exact to its own resolution and the residue is the polygon. **Size the
 * margin's slack to be larger than this row**, which at 48 samples and 8% of
 * slack it is by a factor of forty. At 16 samples it would not be, and the
 * failure would read as "the framing is nearly right", which is the hardest
 * kind of wrong to see in a screenshot.
 */
export interface ComposeRing {
  centre: THREE.Vector3;
  radius: number;
  /** world Y of the highest point standing on the ring, ABSOLUTE, not relative */
  height: number;
  samples: number;
}

/**
 * How much of NDC the subject is allowed to fill, and where the camera may go.
 *
 * `margin` is a fraction of the half-extent of the frame: 0.92 means the ring
 * may reach 92% of the way from the centre of the screen to the edge, leaving
 * 8% of breathing room on every side. **It applies to both axes** — a margin
 * that only guarded the horizontal is exactly the defect that put the rhythm
 * game's ring off the bottom.
 *
 * `near`/`far` bound the bisection. They are required because the right span
 * depends entirely on the scale of the world, and a solver silently clamped at
 * a package's idea of "far" is a shot that is quietly wrong on the one panel
 * shape nobody photographed.
 */
export interface ComposeBounds {
  margin: number;
  near: number;
  far: number;
  /** bisection turns. 24 is one part in 1.7e7 of (far - near); fewer is fine. */
  steps: number;
}

/**
 * Slide `camera` along `dir` away from `ring.centre` until every sampled point
 * of the ring projects inside `bounds.margin` of NDC, and leave it there
 * looking at the centre.
 *
 * `dir` is the camera's DIRECTION and its length is ignored — the elevation and
 * bearing of a shot are art direction and stay the caller's; only the distance
 * is solved. Returns that distance, because a caller almost always has
 * something else to hang off it (see `hangFog` below, and the defect it fixes).
 *
 * THE CAMERA'S ASPECT MUST ALREADY BE CORRECT. This reads the projection it is
 * handed and does not touch `aspect`; a caller solving during a resize must do
 * it AFTER the aspect has been rebuilt, or it frames the previous panel shape.
 * The rhythm game's ring defers to the next `update` for exactly this reason
 * and says so.
 */
export function frameBounds(
  camera: THREE.PerspectiveCamera,
  dir: THREE.Vector3,
  ring: ComposeRing,
  bounds: ComposeBounds,
): number {
  const unit = _dir.copy(dir).normalize();
  let lo = bounds.near;
  let hi = bounds.far;
  for (let i = 0; i < bounds.steps; i++) {
    const mid = (lo + hi) / 2;
    place(camera, unit, ring.centre, mid);
    if (fits(camera, ring, bounds.margin)) hi = mid; else lo = mid;
  }
  // Settle on `hi`, never on `lo` or on the midpoint: `hi` is the last distance
  // the predicate said YES to, and the bisection's invariant is that `lo` is a
  // distance it said NO to. Finishing on the midpoint would ship an untested
  // candidate, which for this predicate means a frame that is cut off by less
  // than the solver's own resolution — invisible in a quick look, visible on a
  // real screen.
  place(camera, unit, ring.centre, hi);
  return hi;
}

/**
 * Hang a linear fog off a solved distance, so the two cannot disagree.
 *
 * THIS IS A SECOND-ORDER DEFECT THAT WOULD BITE ANY CONSUMER OF `frameBounds`,
 * and it was found by measurement rather than by reasoning. The rhythm game
 * shipped `Fog(16, 42)` — absolute distances, which are a statement about a
 * camera 19 units away. Turn the panel upright and the solver correctly moves the camera
 * to 35 to keep the subject in frame, at which point **the whole subject is
 * past the fog's near plane and fades to the background colour**. Measured at
 * 430x932: every element rendered at roughly a third of its intended
 * brightness and the experience looked switched off.
 *
 * A fog whose distances are absolute while its subject's distance is solved is
 * two halves that were written apart. `nearK`/`farK` are multiples of the
 * solved distance and are required, because how much of a world a fog should
 * eat is art direction and no package's business.
 *
 * Silently does nothing for a scene with no fog or an exponential one — those
 * have no distance to hang, and `FogExp2`'s density is not a distance. That is
 * a NO-OP and not a guess: guessing a density from a distance is the plausible
 * default that keeps biting.
 */
export function hangFog(scene: THREE.Scene, distance: number, nearK: number, farK: number): void {
  const fog = scene.fog;
  if (fog instanceof THREE.Fog) {
    fog.near = distance * nearK;
    fog.far = distance * farK;
  }
}

// ---------------------------------------------------------------------------

/** Reused, never allocated: `frameBounds` runs 24 times per solve. */
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();

function place(
  camera: THREE.PerspectiveCamera,
  unit: THREE.Vector3,
  centre: THREE.Vector3,
  dist: number,
): void {
  camera.position.copy(unit).multiplyScalar(dist).add(centre);
  camera.lookAt(centre);
  // BOTH matrices, and `true` on the world one. `project()` reads
  // `matrixWorldInverse` and `projectionMatrix`, and three only refreshes them
  // on its own during a render — a solver that skipped these would bisect
  // twenty-four times against the projection of the FIRST candidate and return
  // a confident number that framed nothing.
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

function fits(camera: THREE.PerspectiveCamera, ring: ComposeRing, margin: number): boolean {
  for (let i = 0; i < ring.samples; i++) {
    const a = (i / ring.samples) * Math.PI * 2;
    _pt.set(
      ring.centre.x + Math.sin(a) * ring.radius,
      ring.height,
      ring.centre.z + Math.cos(a) * ring.radius,
    ).project(camera);
    if (Math.abs(_pt.x) > margin || Math.abs(_pt.y) > margin) return false;
  }
  return true;
}
