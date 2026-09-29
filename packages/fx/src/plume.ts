import * as THREE from 'three';

/**
 * ============================================================================
 *  Plume sizing — the silhouette rule, and the two clamps that enforce it.
 * ============================================================================
 *  `Plumes` draws the flame. This decides how big it is allowed to be and
 *  which way it is allowed to point, and it lives here because both racers
 *  arrived at the same two guards through the same four reviews and were
 *  carrying the same explanation of them, word for word, in two files.
 *
 *  Neither game's flame is the other's: the kart game's is a petrol tongue
 *  with a blue-white root, the ship game's is an amber ion wash with shock diamonds,
 *  and their shaders have genuinely diverged. What is shared is not the look,
 *  it is the RULE the look has to obey.
 *
 *  ------------------------------------------------------------------------
 *  HARD CAP AT ~1.1x MACHINE LENGTH, and this is a silhouette rule, not a
 *  taste call.
 *  ------------------------------------------------------------------------
 *  At 2.60 + 1.40 with a 1.40 ignition multiplier the tongue reached 5.6 m —
 *  two and a half times the length of the car it was attached to — and because
 *  the model's exhaust anchor points up as well as back, a plume that long
 *  sweeps through the machine's own screen silhouette from any camera above
 *  the axis. The boost frame is the result: the driver, the roll bar, the
 *  front bumper and the front-left wheel all gone behind it. NOTHING EITHER
 *  GAME EMITS IS ALLOWED TO BE BIGGER THAN THE SUBJECT.
 *
 *  At 5.6 m the tongue also reached PAST the chase camera, which sits about
 *  six metres behind the machine — so the "plume" that frame photographed is
 *  largely its own tail sweeping through the lens at point-blank range. The
 *  readable dimension from directly behind is WIDTH, and both shaders already
 *  widen the tongue as it turns to face the eye, so a shorter plume is not a
 *  smaller one on screen — it is a plume that is behind the machine instead of
 *  over it.
 *
 *  Then partly given back, because the cure overshot. One frame lost the
 *  machine behind the flame; the verify frame lost the FLAME — a boost shot
 *  with speed lines, FOV punch and a pale wisp near the rear axle, which fails
 *  the brief as squarely as the white-out did, just quietly. THE TWO FAILURES
 *  ARE NOT SYMMETRIC IN HOW THEY READ, and that is what made the second one
 *  easy to ship.
 *
 *  What makes length safe now is not the length: it is `coneClamp` and the
 *  rearward root offset below, neither of which existed when 2.60 was
 *  dangerous. Those hold the plume BEHIND the machine regardless of how long
 *  it is, so length can go back to doing its job. Each game authors its own
 *  metres against its own hull; both then pass through `screenFit`.
 * ============================================================================
 */

/**
 * What fraction of the frame one machine's flame may occupy. One constant per
 * game, because `widen` is a property of that game's own vertex shader.
 */
export interface PlumeBudget {
  /**
   * The shader's own worst-case widening, so the budget is measured against
   * the widest the tongue can get rather than against its authored radius.
   * KEEP THIS IN STEP WITH THE GAME'S `PLUME_VERT`: if the shader's W term
   * moves and this does not, the screen budget silently stops being a budget.
   */
  readonly widen: number;
  /** fraction of frame height the tongue may subtend ACROSS its axis */
  readonly across: number;
  /** ...and ALONG it */
  readonly along: number;
}

/**
 * THE SCREEN-SPACE CLAMP. Returns a scale in (0, 1] to apply to BOTH length
 * and radius; never above 1, so it can only ever shrink what the game
 * authored.
 *
 * Everything a game authors is in metres, and metres are the wrong unit for a
 * silhouette rule. The chase rig surges IN under boost — to about 4.5 m — and
 * the shader deliberately widens the tongue as it turns to face the eye, so
 * the two effects that make the flame readable from behind are also the two
 * that make it enormous exactly when it is brightest. Measured against an
 * early boost frame with a 62-degree vertical field at 4.5 m: the tongue subtends
 * 0.29 of frame height across and 0.43 along, i.e. a 313 x 464 px cream mass
 * on a 1080p frame. It is not over-BRIGHT — nothing in that shot exceeds
 * display 249 — it is over-LARGE, and 40 000 pixels of near-white with no
 * structure in them reads as blown whatever the peak is.
 *
 * So the flame is budgeted as a fraction of the frame instead. `ppm` is the
 * fraction of frame height that one metre AT THE MACHINE subtends; the plume
 * is scaled down until it fits the budget. Beyond ~8 m the clamp is inactive
 * and the metre-authored size is what ships.
 *
 * WHY THE BUDGET IS AS GENEROUS AS IT IS. It was 0.18 / 0.40, and that was the
 * single biggest reason a reviewed boost frame had no flame in it. Worked
 * through at the distance that frame was shot from (4.5 m, 62-degree vertical
 * field, ppm = 0.185): the authored radius asked for 0.29 of frame height
 * across, the budget allowed 0.18, and the clamp therefore scaled the WHOLE
 * plume — length included — by 0.62. A 1.36 m tongue behind a 2.1 m machine,
 * at a distance where the camera is looking straight down the exhaust axis, is
 * a smudge. That budget had been set to cure the OPPOSITE failure, and it was
 * calibrated against a plume that had neither the cone clamp nor the rearward
 * root — both of which now hold the flame behind the machine geometrically,
 * whatever size it is. With those in place the screen budget is insurance
 * against a pathological camera distance, not the thing that decides the look.
 *
 * `fovDeg` is the camera's VERTICAL field, which is what three.js's
 * `PerspectiveCamera.fov` is.
 */
export function screenFit(fovDeg: number, dist: number,
                          len: number, rad: number, b: PlumeBudget): number {
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const ppm = 1 / (2 * Math.tan(fovRad * 0.5) * Math.max(dist, 1.2));
  const wantW = rad * 2 * b.widen * ppm;
  const wantL = len * ppm;
  return Math.min(1, b.across / Math.max(wantW, 1e-4), b.along / Math.max(wantL, 1e-4));
}

/**
 * 18 degrees, tightened from 25, cos/sin precomputed. The cone is what decides
 * whether the plume is BEHIND the machine or across it: at 25 degrees a 2.3 m
 * tongue ends up a metre outboard of the axis, which from the three-quarter
 * chase angle a boost shot is taken at projects straight over the rear
 * bodywork, the spoiler and the roll bar. 18 degrees keeps the tip within
 * 0.7 m of the centreline, so the machine's own silhouette occludes the root
 * (the plume is depth-tested) and the tongue trails out of the back of it.
 */
export const CONE_COS = 0.9511;
export const CONE_SIN = 0.3090;

/**
 * CONSTRAIN THE CONE ABOUT -forward. Clamps `q` (a unit axis) into a cone of
 * half-angle `acos(cosMax)` about `backward`, IN PLACE.
 *
 * A model authors its exhaust anchor's +Z for the pipe, not for the flame, and
 * a chase camera sits above the axis — so a tongue leaning up projects across
 * the bodywork instead of trailing behind it. Where the anchor is already dead
 * astern this is a guard rather than a correction, and it costs nothing; it is
 * the guard that survives a model whose bells are canted.
 *
 * `backward` must be unit and is not written. The rebuild is
 * `q = cosMax*backward + sinMax*perp`, i.e. exactly the maximum half-angle
 * rather than a lerp toward it, so a wildly-off axis lands ON the cone instead
 * of somewhere inside it.
 *
 * THE TEST IS `c < cosMax`, NOT `c >= cosMax` INVERTED. A NaN component in `q`
 * makes both comparisons false, and only this spelling then leaves the axis
 * alone — which is what the two games did before this moved.
 */
export function coneClamp(q: THREE.Vector3, backward: THREE.Vector3,
                          cosMax = CONE_COS, sinMax = CONE_SIN) {
  const c = q.dot(backward);
  if (c < cosMax) {
    q.addScaledVector(backward, -c);
    const sl = q.length();
    if (sl > 1e-5) q.multiplyScalar(sinMax / sl);
    q.addScaledVector(backward, cosMax).normalize();
  }
}
