/**
 * ============================================================================
 *  The chase pose, the chase lens, and where the subject sits in the frame.
 * ============================================================================
 *
 *  `cinematics.ts` took the three shots that are not the chase. This is the
 *  chase: the arm that hangs off the machine, the focal length that opens with
 *  speed, and the two composition offsets that decide where in the picture the
 *  machine is drawn. Between them they were `poseChase`, `applyFov`, `frameX`
 *  and `frameY` in both racers, plus the aim solve `frameSubject` is built on.
 *
 *  ## THE RIG, IN FOUR IDEAS — AND THIS IS THE ONLY COPY OF THEM
 *
 *  Both racers opened their `Camera.ts` with this description, word for word,
 *  and neither pointed at the other. It describes `bearing.ts` and this file,
 *  so it lives here now and each game's header names what IT adds instead.
 *
 *   1. **A BEARING.** One scalar — `armYaw` — is the compass direction the
 *      lens sits behind. It springs toward the machine's direction of TRAVEL
 *      (not its facing, which is what makes a drift read as a drift), and it
 *      is bounded two ways: it may never fall more than `maxLag` behind the
 *      chassis, and it may never move faster than `maxRate`. Those two bounds
 *      are the whole of the comfort story, and because both are stated per
 *      SECOND the rig behaves identically at 30, 60 and 144 Hz. `bearing.ts`.
 *
 *   2. **A POSE built from that bearing.** eye = machine - armDir * dist + up *
 *      height, with dist/height responding to speed, boost, braking, drift and
 *      air. There is no positional spring: a spring chasing a moving machine
 *      settles with a standing error of |v| * T, which silently rewrites the
 *      rig geometry at speed. All the smoothing lives in the bearing and in
 *      the scalars, where it can be reasoned about. {@link poseChase}.
 *
 *   3. **THE ORIENTATION IS SOLVED, NOT SPRUNG.** Given the final eye position
 *      — after every constraint has had its say — there is exactly one view
 *      axis that puts the machine at a chosen point on screen, and it is one
 *      rotation of the eye->machine vector by atan(ndc * tan(halfFov)). So the
 *      composition is not hoped for, it is constructed, and the subject cannot
 *      leave the frame: the lateral composition IS the machine's screen
 *      position. No aim spring, no screen-space feedback loop, no guard pass to
 *      catch what the loop missed. {@link aimAtSubject}.
 *
 *   4. **A HANDFUL OF STATE RESPONSES.** Boost drops and closes the arm on an
 *      underdamped oscillator (a dolly zoom: the lens opens by the same
 *      proportion the arm closes, so the world stretches and the machine does
 *      not shrink). Drift slides the subject across frame and leans the
 *      horizon. Landing dips. Collisions kick and shake. Banking rolls the up
 *      vector, partially, with a rate ceiling.
 *
 *  **Frame-rate independence is structural rather than audited:** every filter
 *  in these files is `damp1`/`damp3` (the analytic critically-damped spring) or
 *  `Osc` (the analytic damped harmonic oscillator), and every limit is a rate
 *  multiplied by dt. There is not one per-frame gain in the package.
 *
 *  **Zero allocation on a steady-state frame.** Every vector, quaternion and
 *  matrix is module scope or the caller's.
 *
 *  ## THE FRAME ORDER, AND THE THREE PLACES IT IS NOT ARBITRARY
 *
 *  A game's `lateUpdate` did NOT move here and is not going to — which step a
 *  racer runs is its own business, and the two rigs already diverge on a held
 *  frame (the kart racer passes `dt === 0` through so its furniture walk and
 *  its plate cut still land; the space racer returns early because its springs
 *  divide by dt). But three ORDERING constraints were written out identically in both
 *  games' bodies, and they are constraints on THESE functions, so they are
 *  stated once here and each game marks the step rather than re-arguing it:
 *
 *   1. **The hold window is advanced BEFORE it is asked about.** `holdLook`
 *      sets the window on the frame the button arrives and is only then read,
 *      and nothing between the two reads it. Whether a look-back is *allowed*
 *      is a question about a game's own race state, so that half stays out.
 *
 *   2. **The lens is solved BEFORE the composition that reads it.**
 *      {@link frameLateral} and {@link frameVertical} convert an angle to NDC
 *      against the LIVE half-field, so a focal length solved after them is a
 *      composition measured against last frame's lens.
 *
 *   3. **The eye is constrained BEFORE the orientation is solved, and the
 *      shake is folded in BEFORE the slew ceiling.** Everything that moves the
 *      lens gets to move it first, so {@link aimAtSubject} builds the axis on
 *      the pose that is actually rendered from rather than the one the rig
 *      intended — which is the only way the subject's screen position is a
 *      guarantee instead of a hope. And a ceiling that runs before the shake
 *      is a promise about the rig's intention rather than about the frame the
 *      player sees; a limiter that runs first and a shake that runs second is
 *      a limiter that does not limit.
 *
 *  **AND THE DIVERGENCE WAS, AGAIN, NUMBERS.** Every single term in
 *  `poseChase` appears in both games in the same order with the same sign and
 *  the same operand — `ARM_DIST` is 5.6 metres for a kart and 10.2 for a ship,
 *  the boost surge pulls the lens 3.0 m in one and 6.2 in the other, the
 *  landing dip is worth 6.0 and 9.0. `applyFov` is thirty lines that differ in
 *  six numbers: an intro focal length (40 / 42) and a pair of clamps (36-70 /
 *  40-72). A kart is 1.5 m long and a ship is 8.8, so all of it scales, and
 *  none of it is a different idea about what a chase camera does.
 *
 *  **THE TWO PLACES WHERE IT LOOKS LIKE A BEHAVIOUR, AND IS NOT.** Both are
 *  worth naming because both would justify leaving this in the games if they
 *  were read carelessly:
 *
 *  1. The space racer's chase arm carries a sixth term, `subjPush`, a standing
 *     correction from its screen-height solve. The kart racer has no such solve.
 *     But `push` is ADDED, so a game without one passes **0** and the term is
 *     the identity — the same shape `updateHeading` already turned out to have
 *     (a `Math.max` that a zero makes into a no-op). It is a number.
 *  2. The space racer's `frameX` and `frameY` bound the composition by the
 *     PROJECTED EDGE of the hull rather than by its centre, and add a sky
 *     anchor on top. Read as code this is a different function. Read as
 *     arithmetic it is the same function with `halfX = 0`, `anchor = 0` and a
 *     safe bound wide enough never to bind — which is exactly what a game with
 *     a 1.5 m subject and no sky anchor has. The kart racer passes those and the
 *     result is bit-identical to the four lines it used to run. See
 *     {@link frameLateral} for the arithmetic written out.
 *
 *  What did NOT come here, and is not an oversight:
 *
 *  - **`sweepArm` stays in the games.** It is handed in as a callback. It
 *    queries the track, the terrain, the bore table and the prop field — four
 *    stores with four different shapes — and the ANSWER it produces (one
 *    fraction of the arm) is the only part that is the same.
 *  - **`solveArmRange` stays in the space racer**, as the optional `settle`
 *    hook, for the same reason: it is one game's answer to one game's problem
 *    (a subject that is 8.8 m long and changes apparent size by a factor of
 *    three through a corkscrew) and the kart racer does not have the problem.
 *
 *  **THE REFUSALS, WITH THEIR LINE COUNTS, BECAUSE A REFUSAL IS A RESULT.**
 *  Every one of these is a run of near-identical code that was READ and left
 *  where it is, and the count is what leaving it costs:
 *
 *  - **`updateUp` (-32 / -87).** Not a value divergence. One game follows a
 *    corkscrew roll reference off `TrackSample.roll` that the other game's
 *    tracks do not publish, integrates a wrapped ship-roll accumulator as the
 *    fallback, and runs an analytic lag *before* the rate ceiling. Three
 *    behaviours, not three numbers. The Dutch lean and the rate ceiling ARE
 *    identical, and taking those two alone is twelve lines against a tuning
 *    struct — a seam that costs more than it saves.
 *  - **`pickPose` (-36 / -36), and it is BYTE-IDENTICAL.** Which is exactly the
 *    trap. It compares five members of a `RaceState` that is a different enum
 *    in each game and dispatches to six methods, so sharing it means a
 *    five-member state struct and six callbacks per game — fifteen lines of
 *    wiring to remove thirty-six, and a race's state machine living in a
 *    package that composes shots. `cinematics.ts` refuses that in writing and
 *    the argument has not changed: *which* pose to play and *when* is a genre
 *    decision. Two forks agreeing byte-for-byte is evidence they are forks, not
 *    evidence the decision is shared.
 *  - **`sweepArm` (-30 / -51).** Refused for the SAME reason `constrain.ts`
 *    refuses the tail of `constrainEye`, and it is the same line: one game tests
 *    `eye.y < probe.y + clear` in world Y, the other tests `probeDepth` along
 *    the deck normal. World Y is wrong by the whole bank angle and wrong in
 *    SIGN through an inversion. A clearance callback would paper over it, and
 *    the second difference — a bore test that only applies where the deck
 *    normal still points up — is a CONDITION rather than a number.
 *  - **`poseWide` (-44 / -79) and `poseClose` (-9 / -42).** Not one shot with
 *    two tunings. The close plate is nine lines in one game and forty-two in
 *    the other, and the forty-two are an alternating-side escalation search
 *    against the deck normal that the nine have no equivalent of.
 *
 *  **NO NUMBER IS IN THIS FILE.** Same rule `lens.ts` and `blockers.ts` state
 *  at length: a package that ships a number two games happen to agree on has
 *  picked one game's feel for every game that ever calls it, silently, and the
 *  frames look completely fine while it does. `BOOST_SURGE_OMEGA` is 13 in both
 *  racers today and it is still a field on a struct the game owns.
 *
 *  **THE OUTPUT VECTORS ARE THE CALLER'S.** Same rule as `cinematics.ts` and
 *  for the same reason: the games keep writing into their own module-scope
 *  `_pivot` / `_dir` / `_eye` / `_aim`, so nothing downstream in `lateUpdate`
 *  reads a vector this file owns. The four transients below ARE this file's, so
 *  both games' `_q` is no longer clobbered by `poseChase` and their `_dir`,
 *  `_right` and `_up` are no longer clobbered by `aimAtSubject`. Every site for
 *  all four was read across both files, and every one of them writes before its
 *  next read, so nothing depended on the clobber — `constrainEye`, the one thing
 *  that runs between the two `aimAtSubject` calls, touches none of them. It is
 *  written down because the failure mode is a value that SURVIVES where it used
 *  to be destroyed, and that renders perfectly.
 * ============================================================================
 */
import * as THREE from 'three';
import { type Osc, clamp, damp1, smootherstep, wrapAngle } from './spring.ts';

/** This file's scratch. See the header: deliberately NOT the games', so a
 *  caller's `_q`, `_dir`, `_right` and `_up` keep whatever the caller last put
 *  in them. */
const _q = /* @__PURE__ */ new THREE.Quaternion();
const _ray = /* @__PURE__ */ new THREE.Vector3();
const _side = /* @__PURE__ */ new THREE.Vector3();
const _lift = /* @__PURE__ */ new THREE.Vector3();

// ===========================================================================
//  The chase arm
// ===========================================================================

/**
 * Exactly the fields {@link poseChase} reads off a rig, and nothing else.
 *
 * Not a `Ctx`, not a camera, not a race. Both games' `ChaseCamera` satisfies
 * this structurally and neither had to be reshaped to say so — but note that
 * TypeScript will not match a `private` field structurally, so the fields below
 * carry no `private` keyword in either game and each says why at its
 * declaration. That is the cheap half of the trade: dropping a keyword on
 * eleven fields, against renaming forty call sites, which is how one gets
 * missed silently.
 */
export interface ChaseRig {
  /** Camera up, already rolled with the road by the game's own `updateUp`. */
  readonly up: THREE.Vector3;
  /** Unit vector form of the bearing, as `@homie-rocks/camera/bearing.js` left it. */
  readonly arm: THREE.Vector3;
  /** 0..1 look-back blend. Swings the whole rig, so it is a geometry input. */
  readonly lookAmt: number;
  readonly boostAmt: number;
  readonly brakeAmt: number;
  readonly driftAmt: number;
  readonly airAmt: number;
  readonly bankAmt: number;
  /** Usable fraction of the arm after the sweep. Written here. */
  armFrac: number;
  armFracVel: { v: number };
  /** The three transients that are not composition: the boost pull, the
   *  landing bob and the impact punch. Stepped here, kicked by the game. */
  readonly surge: Osc;
  readonly dip: Osc;
  readonly kick: Osc;
}

/**
 * Every length the chase arm is made of, in metres, and every rate it moves at.
 *
 * All twenty-two are the game's. A kart is 1.5 m long and a ship is 8.8, and
 * these are the numbers that difference turns into.
 */
export interface ArmTuning {
  /** Height above the machine's origin that the arm pivots about. */
  readonly pivotUp: number;

  /** Resting arm length, and the six things that lengthen or shorten it. */
  readonly dist: number;
  readonly distSurge: number;
  readonly distBoost: number;
  readonly distBrake: number;
  readonly distDrift: number;
  readonly distLook: number;
  /** Floor on the arm. A lens that ends up inside the machine is not a shot. */
  readonly distMin: number;

  /** Resting height up the `up` axis, and the eight things that move it. */
  readonly height: number;
  readonly heightSurge: number;
  readonly heightBoost: number;
  readonly heightBrake: number;
  readonly heightDrift: number;
  readonly heightAir: number;
  readonly heightBank: number;
  readonly heightLook: number;
  readonly heightMin: number;

  /** The boost surge's own spring. Underdamped on purpose in both games:
   *  ~16% overshoot, one visible rebound. */
  readonly surgeOmega: number;
  readonly surgeZeta: number;

  /** Asymmetric filter on the swept arm fraction: pulling IN fast is a safety
   *  response, easing back OUT slowly is what reads as a spring arm. */
  readonly fracIn: number;
  readonly fracOut: number;
  /** Floor on that fraction, below which the shot is inside the machine. */
  readonly fracMin: number;

  /** The landing dip and the impact kick: a spring each, and a gain each in
   *  metres. These sit OUTSIDE everything else because they are supposed to
   *  read as hits rather than as camera moves. */
  readonly dipOmega: number;
  readonly dipZeta: number;
  readonly dipGain: number;
  readonly kickOmega: number;
  readonly kickZeta: number;
  readonly kickGain: number;
}

/** The four per-frame quantities that are not on the rig and not tuning. */
export interface ArmFrame {
  /** Normalised speed, 0..1.25. */
  readonly sp: number;
  /** Metres of arm per unit `sp`, and metres of height per unit `sp`. Passed
   *  per frame rather than sitting in {@link ArmTuning} because both games
   *  drive them off a LIVE feel knob — a struct built once would freeze
   *  whatever the knob said at construction. */
  readonly distSpeed: number;
  readonly heightSpeed: number;
  /**
   * Standing arm extension the game has solved for itself, in metres.
   *
   * The space racer's screen-height solve writes it; the kart racer passes 0
   * and the term is the identity. It goes in HERE, with the other six, rather than
   * being added to the eye afterwards — everything below this line (the sweep,
   * the fraction) validates the arm it is handed, and an extension bolted on
   * after the sweep is an extension nothing has checked for barriers.
   */
  readonly push: number;
}

/**
 * Build the chase eye: pivot, bearing, arm length, sweep, and the two hits.
 *
 * Writes `pivotOut`, `dirOut` and `eyeOut`, which are the CALLER's vectors, and
 * advances `rig.armFrac`. Returns nothing: a rig is not a value.
 *
 * `sweep` is the game's — it queries the track, the terrain, the bore roof and
 * the furniture, and answers with the usable fraction of the arm it was asked
 * about. `settle` is the optional hook the space racer hangs its screen-height
 * solve on; it runs exactly where that game ran it, after the eye is composed
 * and before the dip and the kick, so the ORDER is preserved rather than
 * reasoned about.
 *
 * **`W` AND `S` ARE OPAQUE, WHICH IS THE WHOLE POINT.** Both games' callbacks
 * want that game's `Ctx` and its player, and the engine's rules forbid a `Ctx`
 * crossing a package seam even as an `import type` — it carries race, track, items,
 * match and colony. It does not have to. This function reads **no field** of
 * either, so they are unconstrained type parameters inferred at the call site
 * and handed straight back to the callback that asked for them. The scene walks
 * in `scene.ts` needed three fields and got a three-field interface; this needs
 * none and gets none. The alternative — a pre-bound `() => number` closure — is
 * either a closure allocated every frame, which this path may not do, or a pair
 * of mutable fields the caller must remember to set first, which is a hidden
 * ordering requirement in a file that already has enough of them.
 */
export function poseChase<W, S>(
  rig: ChaseRig,
  t: ArmTuning,
  f: ArmFrame,
  subject: THREE.Vector3,
  pivotOut: THREE.Vector3,
  dirOut: THREE.Vector3,
  eyeOut: THREE.Vector3,
  dt: number,
  world: W,
  ref: S,
  sweep: (world: W, ref: S, pivot: THREE.Vector3, dir: THREE.Vector3, dist: number, height: number) => number,
  settle?: (world: W, ref: S, dt: number) => void,
): void {
  const surge = rig.surge.step(0, t.surgeOmega, t.surgeZeta, dt);
  const boost = rig.boostAmt * (1 - rig.lookAmt);

  pivotOut.copy(subject).addScaledVector(rig.up, t.pivotUp);

  // Look-back swings the whole rig around the pivot rather than flipping the
  // aim, so coming back is a real move instead of a cut. Applied here, after
  // the bearing's bounds, because a deliberate 180 is not lag.
  dirOut.copy(rig.arm);
  if (rig.lookAmt > 1e-3) {
    _q.setFromAxisAngle(rig.up, Math.PI * rig.lookAmt);
    dirOut.applyQuaternion(_q);
  }

  let dist = t.dist + f.distSpeed * f.sp
    + f.push
    + surge * t.distSurge
    - boost * t.distBoost
    - rig.brakeAmt * t.distBrake
    + rig.driftAmt * t.distDrift
    - rig.lookAmt * t.distLook;
  let height = t.height + f.heightSpeed * f.sp
    + surge * t.heightSurge
    - boost * t.heightBoost
    - rig.brakeAmt * t.heightBrake
    + rig.driftAmt * t.heightDrift
    + rig.airAmt * t.heightAir
    + rig.bankAmt * t.heightBank * (1 - rig.lookAmt)
    + rig.lookAmt * t.heightLook;
  dist = Math.max(t.distMin, dist);
  height = Math.max(t.heightMin, height);

  // Sweep the arm against ground, barriers, the tunnel roof and furniture, and
  // shorten it to the usable fraction. Filtered so it cannot pump, and
  // asymmetrically: pulling in fast is a safety response, easing back out
  // slowly is what reads as a spring arm.
  const want = sweep(world, ref, pivotOut, dirOut, dist, height);
  rig.armFrac = damp1(rig.armFrac, want, rig.armFracVel,
    want < rig.armFrac ? t.fracIn : t.fracOut, dt);
  const fr = clamp(rig.armFrac, t.fracMin, 1);

  eyeOut.copy(pivotOut).addScaledVector(dirOut, -dist * fr).addScaledVector(rig.up, height * fr);

  // ...and now the only question the terms above never asked: how big does that
  // leave the machine in the picture? The game answers it if it has an answer.
  if (settle) settle(world, ref, dt);

  // The landing dip and the impact kick sit outside everything else, because
  // they are supposed to read as hits rather than as camera moves.
  const dip = rig.dip.step(0, t.dipOmega, t.dipZeta, dt);
  const kickV = rig.kick.step(0, t.kickOmega, t.kickZeta, dt);
  eyeOut.addScaledVector(rig.up, dip * t.dipGain).addScaledVector(dirOut, kickV * t.kickGain);
}

// ===========================================================================
//  The chase lens
// ===========================================================================

/** The four fields {@link applyChaseFov} reads off a rig. */
export interface FovRig {
  readonly lookAmt: number;
  /** -1..1, + = turning right. Only its magnitude is read. */
  readonly corner: number;
  readonly brakeAmt: number;
  /** The lens's own spring. `v` is the live focal length. */
  readonly fovOsc: Osc;
}

/** Every focal length and every rate the chase lens is made of, in degrees. */
export interface FovTuning {
  /** Resting field, and the five things that open or close it. */
  readonly base: number;
  readonly boost: number;
  readonly corner: number;
  readonly brake: number;
  readonly look: number;
  /** Bounds on the chase branch ONLY. `fitFov` still has the last word. */
  readonly min: number;
  readonly max: number;

  /** The harness plates and the results screen, each with its own spring. */
  readonly wide: number;
  readonly close: number;
  readonly settled: number;
  /** The long lens the countdown holds on before opening to `base`. The grid
   *  shot lives or dies on compression: at 40 degrees eight machines stack into
   *  rows, at 50 they fan out and stop reading as a pack. */
  readonly intro: number;

  /** Chase spring. Underdamped on purpose: the lens rubber-bands back after a
   *  boost and that overshoot is what sells it. */
  readonly omega: number;
  readonly zeta: number;
  /** ...and the critically-damped one every non-chase branch uses. */
  readonly cutOmega: number;
  readonly cutZeta: number;
  /** The intro's, which is slower again. */
  readonly introOmega: number;
  readonly introZeta: number;
}

/** What the frame is, told in terms this file understands rather than in terms
 *  of a race state machine — which is a different enum in each game and stays
 *  in each game. */
export interface FovFrame {
  /** `'chase'`, or one of the two harness plates. */
  readonly mode: 'chase' | 'wide' | 'close';
  /** The race is over or has not started: hold a long, still lens. */
  readonly settled: boolean;
  /** 0..1 through the countdown fly-in, or `null` once it is done. */
  readonly introFrac: number | null;
  readonly sp: number;
  /** Degrees of opening per unit `sp`. Live knob; see {@link ArmFrame}. */
  readonly fovSpeed: number;
  /** The game's own boost punch, in the units its own `FovTuning.boost`
   *  weights. Peaks near 10.5 degrees on a boost in the space racer. */
  readonly punch: number;
}

/**
 * Solve the chase focal length and put it on the camera.
 *
 * `fit` is the game's aspect-aware bound — `@homie-rocks/camera/lens.js`'s `fitFov`
 * closed over that game's own `FovBounds` — and it is applied to the TARGET,
 * before the spring, so the spring never chases a length the panel cannot show.
 *
 * The 0.015-degree deadband is not a micro-optimisation: `updateProjectionMatrix`
 * is what invalidates the frustum, and a lens that rewrites it every frame with
 * a change nothing can see costs the same as one that moved.
 */
export function applyChaseFov(
  rig: FovRig,
  t: FovTuning,
  f: FovFrame,
  camera: THREE.PerspectiveCamera,
  dt: number,
  fit: (v: number) => number,
): void {
  let target: number;
  let omega = t.omega;
  let zeta = t.zeta;

  if (f.mode === 'wide') { target = t.wide; omega = t.cutOmega; zeta = t.cutZeta; }
  else if (f.mode === 'close') { target = t.close; omega = t.cutOmega; zeta = t.cutZeta; }
  else if (f.settled) { target = t.settled; omega = t.introOmega; zeta = t.introZeta; }
  else if (f.introFrac !== null) {
    // A long lens on the hold beat, opening only as the rig settles.
    target = t.intro + (t.base - t.intro) * smootherstep(clamp((f.introFrac - 0.58) / 0.42, 0, 1));
    omega = t.introOmega; zeta = t.introZeta;
  } else {
    target = clamp(
      t.base
      + f.sp * f.fovSpeed
      + f.punch * t.boost
      + rig.lookAmt * t.look
      + Math.abs(rig.corner) * t.corner
      - rig.brakeAmt * t.brake,
      t.min, t.max,
    );
  }
  const fov = rig.fovOsc.step(fit(target), omega, zeta, dt);
  if (Math.abs(fov - camera.fov) > 0.015) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ===========================================================================
//  Composition — where in the picture the machine is drawn
// ===========================================================================

/** The five fields the two composition passes read off a rig. */
export interface FrameRig {
  readonly armYaw: number;
  readonly faceYaw: number;
  readonly bend: number;
  readonly calm: number;
  readonly driftSigned: number;
  readonly driftAmt: number;
  readonly tierAmt: number;
  readonly lookAmt: number;
  /** The composition, as a camera yaw offset in radians. Written here, and it
   *  is the only piece of STATE either pass owns. */
  compAng: number;
}

/** Every weight the lateral composition is made of. */
export interface FrameTuning {
  /**
   * How much of the bearing's trail is cancelled back onto the chassis.
   *
   * + = the bearing is trailing to the left of the chassis, i.e. a right-hand
   * corner. Rotating the lens by `-lagCancel` of that points it back down the
   * chassis heading.
   */
  readonly lagCancel: number;
  /**
   * Fraction of `lagCancel` that a lost grip surface takes away, times
   * {@link FrameFrame.slipping}.
   *
   * The space racer's mag-lock: while it is going, the chassis heading is no
   * longer information about where the player is going, and cancelling onto it
   * is what takes the deck out of frame. The kart racer has nothing of the kind
   * and passes `slipping = 0`, which makes this the identity — a NUMBER, not a
   * flag, and that is the whole reason both games can be here.
   */
  readonly lagCancelLost: number;
  readonly bend: number;
  readonly drift: number;
  /** Ceiling on how fast the composition itself may move, rad/s. Without it a
   *  step in the bearing becomes a whip in the picture. */
  readonly angRate: number;
  /** How far a DRIFT may throw the subject before it stops reading as the
   *  subject, in NDC. A taste bound. */
  readonly xMax: number;
  /**
   * ...and how far the subject's EDGE may go before it is off the picture, in
   * NDC. A guarantee, not a taste bound, which is why the two are separate and
   * why the anchor below is added between them.
   *
   * A game whose subject is a point and which has no anchor sets this to its
   * own `xMax` and the arithmetic collapses: `lim` becomes `xMax`, `edge`
   * becomes `xMax`, and the return is `clamp(comp, ±xMax)` — character for
   * character what the kart racer's four lines did.
   */
  readonly safeX: number;

  /**
   * The vertical composition: a rest, two gains and a taste band.
   *
   * BELOW CENTRE, and the argument for it was written out identically in both
   * racers, so it lives here: the road ahead owns the upper half of the frame
   * and the machine breaks the skyline instead of being drawn on a surface of
   * near-identical value. The harder half of the choice is the other bound —
   * every degree the axis pitches down buys foreground surface at the price of
   * sightline, so `yMin` is a taste bound and not a safety one. Both racers
   * measured -0.26 as too far (bottom third bare surface, horizon above the
   * top quarter) and both ship -0.19.
   *
   * NEITHER NUMBER IS IN THIS FILE. See the header.
   */
  readonly y: number;
  readonly ySpeed: number;
  readonly yDrift: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Vertical twin of `safeX`. A game with no anchor and a point subject sets
   *  this to `-yMin` and the clamp is the identity over the whole band. */
  readonly safeY: number;
  /** Floor on either guarantee. A subject so large that no composition fits is
   *  a frame the arm solve is already pulling out of, and answering it by
   *  welding the subject to dead centre would make a slide stop reading as a
   *  slide for the second it takes to recover. */
  readonly safeMin: number;
}

/** The per-frame inputs that are neither rig nor tuning. */
export interface FrameFrame {
  /** tan of the half-field, horizontally, off the LIVE camera. The vertical
   *  twin is NOT here: the only thing that wanted it was the projection of the
   *  subject's own radius, and that arrives already projected as `halfY`. */
  readonly tanH: number;
  /** Projected half-size of the subject in NDC, or 0 for a point subject. */
  readonly halfX: number;
  readonly halfY: number;
  /** A deliberate second-subject offset — the space racer's sky anchor — or 0. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** 0..1 loss of the grip surface. See {@link FrameTuning.lagCancelLost}. */
  readonly slipping: number;
  readonly sp: number;
}

/**
 * Where the subject sits left-to-right, in NDC, and the rate limit that gets it
 * there.
 *
 * ## DERIVED, NOT DECORATED — and this is the only copy of the argument
 *
 * Both racers carried this paragraph over their own `FRAME_LAG_CANCEL`, word
 * for word. It is an argument about THIS FUNCTION, so it lives here.
 *
 * The rule is one sentence: THE LENS POINTS WHERE THE MACHINE IS POINTING, AND
 * THE MACHINE GOES WHEREVER THAT LEAVES IT. The eye trails the direction of
 * travel by whatever the bearing spring gives it, and the lens then rotates
 * most of that trailing angle back off, so the view axis runs down the chassis
 * heading and the corner exit is in shot. The subject slides to the OUTSIDE of
 * the arc as a consequence, which is the composition a racer wants, and it
 * comes out of the geometry instead of out of a second hand-tuned curve that
 * has to be kept in agreement with the first.
 *
 * Three consequences worth stating:
 *
 *  - The measured lag between the chassis heading and the view axis is
 *    (1 - `lagCancel`) of the bearing lag, at every cornering rate. A
 *    composition keyed to a separate "how hard are we cornering" scalar
 *    cancels the lag at one speed and one radius and nowhere else.
 *  - A drift composes itself. The bearing follows travel and the chassis is
 *    yawed off it by the slip angle, so the same term swings the lens across
 *    the slide and throws the machine to the outside of frame, harder with
 *    more slip.
 *  - It cannot lose the subject: the angle is converted to NDC against the
 *    live lens and clamped there.
 *
 * At `lagCancel` = 1.0 the view axis is welded to the chassis heading and the
 * trailing eye reads as a fixed off-centre framing; at 0 the camera looks
 * straight down the arm and a corner is composed exactly like a straight.
 * Neither game ships either end, and NEITHER NUMBER IS IN THIS FILE.
 *
 * ## The three clamps
 *
 * Worth reading once, because collapsing it to one clamp would be a
 * simplification that quietly deletes a guarantee:
 *
 *   `lim`  = the taste bound, tightened by the subject's own projected edge,
 *            so what is bounded is the EDGE of the machine rather than a point
 *            inside it.
 *   `comp` = the drift composition, inside that.
 *   `edge` = the guarantee, and the anchor is added OUTSIDE `xMax` but INSIDE
 *            this. The distinction is deliberate: `xMax` says how far a slide
 *            may throw the subject, and the anchor is not a slide — it is a
 *            deliberate two-shot with the largest object in the game. What may
 *            not move is the guarantee, so the sum is re-clamped against it.
 *
 * With `halfX = 0`, `anchorX = 0` and `safeX = xMax` this is
 * `clamp(tan(compAng)/tanH, ±xMax)` exactly, which is what the kart racer ran.
 */
export function frameLateral(rig: FrameRig, t: FrameTuning, f: FrameFrame, dt: number): number {
  const cancel = t.lagCancel * (1 - t.lagCancelLost * f.slipping);
  let want = -cancel * wrapAngle(rig.armYaw - rig.faceYaw)
    - t.bend * rig.bend * rig.calm
    - t.drift * rig.driftSigned * rig.tierAmt;
  if (rig.lookAmt > 0.5) want = 0;
  rig.compAng += clamp(want - rig.compAng, -t.angRate * dt, t.angRate * dt);

  const lim = clamp(t.safeX - f.halfX, t.safeMin, t.xMax);
  const comp = clamp(Math.tan(rig.compAng) / f.tanH, -lim, lim);
  const edge = Math.max(t.safeMin, t.safeX - f.halfX);
  return clamp(comp + f.anchorX, -edge, edge);
}

/**
 * Where the subject sits top-to-bottom, in NDC.
 *
 * Same split as {@link frameLateral}. `yMin` is a taste bound on the driving
 * shot — "not further below than this, because every degree buys foreground
 * plate at the price of sightline" — and an anchor is buying something with
 * those degrees. `safeY` is the guarantee and it still holds.
 *
 * With `halfY = 0`, `anchorY = 0` and `safeY = -yMin` this is
 * `clamp(y + ySpeed*sp + yDrift*driftAmt, yMin, yMax)` exactly: the floor
 * resolves to `yMin`, and the outer clamp cannot bind because the band it is
 * clamping is `[yMin, yMax]` and the bound is `|yMin|`.
 */
export function frameVertical(rig: FrameRig, t: FrameTuning, f: FrameFrame): number {
  const floor = Math.max(t.yMin, f.halfY - t.safeY);
  const base = clamp(t.y + t.ySpeed * f.sp + t.yDrift * rig.driftAmt,
    Math.min(floor, t.yMax), t.yMax);
  const edge = Math.max(t.safeMin, t.safeY - f.halfY);
  return clamp(base + f.anchorY, -edge, edge);
}

// ===========================================================================
//  ...and where the lens actually points
// ===========================================================================

/**
 * Aim the lens so the subject lands on `(fx, fy)` in NDC, and say how far off
 * the solved axis that put it.
 *
 * THERE IS NO SEARCH AND NO FEEDBACK HERE, and the argument for that was
 * written out in full over both racers' `frameSubject`, word for word, so it
 * lives here now. A point at NDC (fx, fy) sits along the direction
 * `forward + fx*tanH*right + fy*tanV*up` in camera space, so the inverse is two
 * rotations of the eye->subject vector: yaw by atan(fx * tanH) about the camera
 * up, then pitch by -atan(fy * tanV) about the camera right. Do those and the
 * subject lands where it was asked for, on the first frame, at any aspect ratio
 * and any focal length.
 *
 * The consequence worth stating: the subject's screen position stops being an
 * emergent property of eleven filters that have never heard of it, and becomes
 * an INPUT. The lateral composition cannot be exceeded, so "the machine left
 * the screen" is not a failure mode a rig built on this has.
 *
 * The geometry was **byte-identical** in both racers. The two things that were
 * not are both at the edges rather than in the middle:
 *
 *  - **The subject POINT is the caller's.** The kart racer lifts it a fixed
 *    `SUBJ_UP` off the chassis origin; the space racer asks its own
 *    `subjectPoint`, which is the HULL's centre and not a point 1.20 m above
 *    the COM — that game's `SUBJ_LIFT` note records what the fixed constant
 *    cost it. Neither belongs in here, so what crosses is a point.
 *  - **The off-axis angle is RETURNED.** The space racer stores it as `subjSep`
 *    and spends it as headroom in the slew ceiling; the kart racer has no guard
 *    band and ignores the return. A value one caller uses, not a flag that
 *    changes what this does.
 *
 * The angle is the ARITHMETIC sum of the two rotations, not their quadrature
 * sum, and that is deliberate. They are about near-perpendicular axes so the
 * true resultant is the quadrature sum; the guard band wants an UPPER bound,
 * and reading the composition as further off-axis than it is can only make the
 * ceiling more cautious about spending it, never less.
 *
 * `aimOut` is the CALLER's vector. The three transients are this file's, so a
 * caller's `_dir` / `_right` / `_up` survive this call where they used to be
 * clobbered by it — every site in both games was read, and every one of them
 * writes those vectors before its next read.
 */
export function aimAtSubject(
  eye: THREE.Vector3,
  subject: THREE.Vector3,
  up: THREE.Vector3,
  fx: number,
  fy: number,
  tanH: number,
  tanV: number,
  aimOut: THREE.Vector3,
): number {
  _ray.copy(subject).sub(eye);
  const r = _ray.length();
  if (r < 1e-3) { aimOut.copy(subject); return 0; }
  _ray.multiplyScalar(1 / r);

  const sep = Math.abs(Math.atan(fx * tanH)) + Math.abs(Math.atan(fy * tanV));

  // Basis about the eye->subject ray, in the ROLLED frame the player sees. Not
  // the world frame: on a banked corner those are the same shot only if the
  // banking is zero.
  _side.crossVectors(_ray, up);
  if (_side.lengthSq() < 1e-6) { aimOut.copy(eye).addScaledVector(_ray, r); return sep; }
  _side.normalize();
  _lift.crossVectors(_side, _ray).normalize();

  // Yaw first, then pitch about the YAWED right vector. The two rotations do
  // not commute, but at these angles the coupling error is under a fifth of a
  // degree, which is a hundred times smaller than anything the eye reads.
  _q.setFromAxisAngle(_lift, Math.atan(fx * tanH));
  _ray.applyQuaternion(_q);
  _side.crossVectors(_ray, up);
  if (_side.lengthSq() > 1e-6) {
    _side.normalize();
    _q.setFromAxisAngle(_side, -Math.atan(fy * tanV));
    _ray.applyQuaternion(_q);
  }

  aimOut.copy(eye).addScaledVector(_ray, r);
  return sep;
}
