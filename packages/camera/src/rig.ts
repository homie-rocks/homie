/**
 * ============================================================================
 *  The bookkeeping a chase rig does before it can compose anything.
 * ============================================================================
 *
 *  `chase.ts` took the pose, the lens and the composition. This is the four
 *  jobs that run around them and were byte-identical, or one number away from
 *  it, in both racers' `lateUpdate`:
 *
 *   1. **The state scalars.** Nine filtered quantities read off the machine and
 *      the pad — drift, tier, boost, brake, air, calm, look — every one of them
 *      a `damp1`, none of them a boolean edge.
 *   2. **The teleport check**, and the seed that follows it. "Has the subject
 *      moved further this frame than it possibly could have?"
 *   3. **The shake**, folded into an orientation and then into a position.
 *   4. **The sightline probe**: three rays from the machine to the lens.
 *
 *  Both racers carried a near-identical copy, differing by exactly two things:
 *  the space racer filters a mag-lock loss the other game has no concept of
 *  (five lines, and they stayed in the game), and fourteen numbers. `CALM_LO`
 *  is 3 m/s for a kart and 12 for a ship; the sightline samples a kart at
 *  0.45 m and 1.1 m up and a ship at 1.0 and 2.4. Nothing about the JOB
 *  differs.
 *
 *  **THE FILTER TIME CONSTANTS ARE NOT IN THIS FILE EITHER**, and it is worth
 *  saying why, because all ten of them are the same in both racers today and it
 *  would be very easy to call that "shared". A drift that snaps in over 0.15 s
 *  and oozes out over 0.40 is a statement about how a SLIDE should read, and a
 *  third game with a heavier machine will want different ones. A package that
 *  shipped these would have picked one game's feel for every game that ever
 *  calls it — silently, and the frames would look completely fine. Same
 *  argument `lens.ts` and `blockers.ts` make; it does not get weaker because
 *  the two numbers currently agree.
 *
 *  **WHAT DID NOT COME HERE.** The `dt` handling at the top of `lateUpdate`
 *  DIVERGES DELIBERATELY and stays in the games: the kart racer passes a
 *  deliberate `dt === 0` straight through, because `damp1`/`Osc` are exact
 *  identities at zero and `buildProps` and the `__camMode` cut still have to
 *  run; the space racer returns early, because its springs divide by `dt`.
 *  Each of those was a separate fix, and a shared "clamp the frame time"
 *  helper would erase one of them to make a diff smaller.
 *
 *  Nothing here knows what a race is. No lap, no standings, no `Ctx`, no
 *  `RaceState`. What crosses is a machine's speed, a pad's two buttons, and a
 *  handful of vectors.
 * ============================================================================
 */
import * as THREE from 'three';
import { type Osc, type Vel, clamp, damp1, shakeNoise, smootherstep } from './spring.ts';

/** This file's own scratch. The games' `_tmp`, `_face`, `_q`, `_euler` and
 *  `_pt` are therefore no longer clobbered by these four calls — every call
 *  site in both files was read, and all of them write those vectors before
 *  their next read, so nothing depended on the clobber. It is written down
 *  because the failure mode is a value that SURVIVES where it used to be
 *  destroyed, and that renders perfectly. */
const _tmp = /* @__PURE__ */ new THREE.Vector3();
const _face = /* @__PURE__ */ new THREE.Vector3();
const _pt = /* @__PURE__ */ new THREE.Vector3();
const _q = /* @__PURE__ */ new THREE.Quaternion();
const _euler = /* @__PURE__ */ new THREE.Euler();

// ===========================================================================
//  1. The state scalars
// ===========================================================================

/** Exactly the nine values and nine velocities {@link updateDrive} writes. */
export interface DriveRig {
  driftSigned: number; driftVel: Vel;
  driftAmt: number;
  tierAmt: number; tierVel: Vel;
  boostAmt: number; boostVel: Vel;
  brakeAmt: number; brakeVel: Vel;
  airAmt: number; airVel: Vel;
  calm: number; calmVel: Vel;
  lookAmt: number; lookVel: Vel;
  /** Seconds left on the look-back hold. Specified as a rising edge but played
   *  as a held button; a short window makes both spellings behave sensibly. */
  lookHold: number;
}

/** Exactly the six fields {@link updateDrive} reads off a machine. Not the
 *  game's vehicle type, which carries a lap, an item slot and a driver. */
export interface DriveSubject {
  readonly forwardSpeed: number;
  readonly airborne: boolean;
  /** -1, 0 or +1. Which way the slide is going, or not going. */
  readonly driftDir: number;
  /** The mini-turbo ladder's rung. Normalised by `tierFull` below. */
  readonly driftTier: number;
  readonly boostTime: number;
}

/** Every time constant and every threshold, all of them the game's. */
export interface DriveTuning {
  /** Speed that reads as 1.0. The scalar is clamped to 1.25, not 1: a machine
   *  above its own base top speed is boosting, and the composition should know. */
  readonly topSpeed: number;
  readonly spMax: number;
  /** Snap in, ooze out: the composition changes the instant the slide catches
   *  and unwinds slowly enough that the release reads as a release. */
  readonly driftIn: number;
  readonly driftOut: number;
  readonly tierTau: number;
  /** Rung count the tier is normalised against. */
  readonly tierFull: number;
  readonly boostIn: number;
  readonly boostOut: number;
  readonly brakeTau: number;
  /** How hard the brake has to be held, and how fast the machine has to be
   *  going, before braking is a composition input rather than a parked pad. */
  readonly brakeMin: number;
  readonly brakeSpeedMin: number;
  /** Airborne as a filtered quantity, never a boolean edge: `airborne` flips on
   *  the frame a wheel finds the road, and a step in the arm on that frame is a
   *  jolt at the one moment the player is already being thrown about. */
  readonly airIn: number;
  readonly airOut: number;
  /** The band over which a machine stops being "parked or spun" and starts
   *  being "driving". Read off SIGNED speed, not magnitude: a machine reversing
   *  out of a crash is recovering, not driving, and it earns exactly as much
   *  composition as a parked one. */
  readonly calmLo: number;
  readonly calmHi: number;
  readonly calmTau: number;
  readonly lookTau: number;
  readonly lookHold: number;
}

/**
 * Advance the nine scalars the whole rest of the rig is composed from.
 *
 * `wantLook` is the game's — whether a look-back is allowed right now is a
 * question about a race state machine and a harness mode, and both of those
 * stay in the game. What crosses is the answer.
 *
 * Returns the normalised speed, because every caller wants it and computing it
 * twice is how two numbers that must agree stop agreeing.
 */
export function updateDrive(
  rig: DriveRig,
  t: DriveTuning,
  k: DriveSubject,
  brakePressed: number,
  wantLook: boolean,
  dt: number,
): number {
  const speed = Math.abs(k.forwardSpeed);
  const sp = clamp(speed / t.topSpeed, 0, t.spMax);

  const drifting = k.driftDir !== 0 && !k.airborne;
  rig.driftSigned = damp1(rig.driftSigned, drifting ? k.driftDir : 0, rig.driftVel,
    drifting ? t.driftIn : t.driftOut, dt);
  rig.driftAmt = Math.abs(rig.driftSigned);
  rig.tierAmt = damp1(rig.tierAmt, drifting ? clamp(k.driftTier / t.tierFull, 0, 1) : 0,
    rig.tierVel, t.tierTau, dt);

  const boosting = k.boostTime > 0 ? 1 : 0;
  rig.boostAmt = damp1(rig.boostAmt, boosting, rig.boostVel, boosting ? t.boostIn : t.boostOut, dt);
  const braking = brakePressed > t.brakeMin && k.forwardSpeed > t.brakeSpeedMin ? 1 : 0;
  rig.brakeAmt = damp1(rig.brakeAmt, braking, rig.brakeVel, t.brakeTau, dt);
  rig.airAmt = damp1(rig.airAmt, k.airborne ? 1 : 0, rig.airVel, k.airborne ? t.airIn : t.airOut, dt);
  rig.calm = damp1(rig.calm,
    smootherstep((Math.max(0, k.forwardSpeed) - t.calmLo) / (t.calmHi - t.calmLo)),
    rig.calmVel, t.calmTau, dt);

  rig.lookAmt = damp1(rig.lookAmt, wantLook ? 1 : 0, rig.lookVel, t.lookTau, dt);
  return sp;
}

/** The look-back hold, advanced on its own so a game can read `lookHold` before
 *  deciding whether a look-back is legal at all. Split from `updateDrive`
 *  because the ORDER matters and both games ran it first: the window is set on
 *  the frame the button arrives, and only then asked about. */
export function holdLook(rig: DriveRig, t: DriveTuning, pressed: boolean, dt: number): boolean {
  if (pressed) rig.lookHold = t.lookHold; else rig.lookHold -= dt;
  return rig.lookHold > 0;
}

// ===========================================================================
//  2. Has the subject been teleported?
// ===========================================================================

/** What {@link trackTeleport} needs to seed and re-seed a rig. */
export interface TeleportRig {
  armYaw: number;
  lagYaw: number;
  compAng: number;
  arm: THREE.Vector3;
  up: THREE.Vector3;
  prevKart: THREE.Vector3;
  ready: boolean;
  hasPrevQuat: boolean;
  /** Everything else a cut invalidates. The GAME's — the two rigs zero
   *  different sets of transients and each says why at its own declaration.
   *  {@link reseedRig} is the twelve both of them zero identically. */
  reseed(): void;
}

/**
 * The state a cut invalidates that is declared in `rigstate.ts` — twelve
 * assignments that were character-identical in both racers' `reseed()`.
 *
 * WHY IT IS A FUNCTION HERE AND NOT A METHOD ON `ChaseRigState`: that class is
 * state and nothing else, and its header says at length that the moment it
 * grows a method it has started deciding something. This decides nothing that
 * the declarations did not already decide — every field it touches is declared
 * in that file, and it puts each one back to the value that file initialises
 * it to. A game with a field of its own zeroes it in its own `reseed()`, and
 * both of them do.
 *
 * `groundY` is deliberately NOT reset with `groundInit`: `groundInit = false`
 * is what makes the next frame's probe adopt the surface outright instead of
 * rate-limiting toward it, so the stale height is never read. Zeroing it as
 * well would be a second statement of the same thing that could disagree.
 *
 * `trauma` is not here and cannot be: its bleed-off rate and bounds are the
 * game's three numbers, so `Trauma` is not in `rigstate.ts` either. Both games
 * call `this.trauma.reset()` on the line after this one.
 */
export function reseedRig(rig: ReseedRig): void {
  rig.armVel.v = 0;
  rig.lagVel.v = 0;
  rig.armFrac = 1;
  rig.armFracVel.v = 0;
  rig.groundInit = false;
  rig.camT = -1;
  rig.hasPrevEye = false;
  rig.dip.reset();
  rig.kick.reset();
  rig.surge.reset();
  // A cut drops the machine stationary on the racing line, so the calm fade
  // starts there too rather than inheriting the composition of the crash.
  rig.calm = 0;
  rig.calmVel.v = 0;
}

/** Exactly the twelve {@link reseedRig} writes, and nothing else. */
export interface ReseedRig {
  armVel: { v: number };
  lagVel: { v: number };
  armFrac: number;
  armFracVel: { v: number };
  groundInit: boolean;
  camT: number;
  hasPrevEye: boolean;
  dip: { reset(): void };
  kick: { reset(): void };
  surge: { reset(): void };
  calm: number;
  calmVel: { v: number };
}

/** Where a machine is and how fast it is going. Two vectors and a heading. */
export interface TeleportSubject {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly forward: THREE.Vector3;
}

export interface TeleportTuning {
  /** Metres in one frame that could not have been driven. Below this a step is
   *  a step, however fast the machine is going. */
  readonly minStep: number;
  /** ...and the speed-dependent half, in metres per second, plus how much of
   *  the machine's own velocity counts toward it. */
  readonly speedStep: number;
  readonly velGain: number;
  /**
   * Radians of heading change past which a teleport is a CUT.
   *
   * A respawn usually drops the machine back on the racing line pointing
   * roughly the way it was already going, and there the right answer is to
   * rebuild the pose behind it on the bearing the lens already had — the view
   * axis is then continuous through the teleport, nothing rotates at all on the
   * cut frame, and the bearing converges under the ordinary rate ceiling.
   * Reseeding the bearing on EVERY teleport instead rotates the frame by the
   * whole heading change in one frame, measured at 1800 deg/s on a routine
   * off-track recovery.
   *
   * Past this, though, the lens is pointing somewhere with no relationship to
   * the new pose, and panning 90 degrees at the comfort ceiling would take most
   * of a second with the machine off frame for all of it. That is a different
   * shot, and a cut is the honest way to get to it.
   */
  readonly turn: number;
}

/** Put the rig behind the machine, on the machine's own heading. The first
 *  frame of a race, and every cut sharp enough to need one. */
function seed(rig: TeleportRig, k: TeleportSubject, worldUp: THREE.Vector3): void {
  _face.copy(k.forward);
  _face.y = 0;
  if (_face.lengthSq() > 1e-6) {
    _face.normalize();
    rig.armYaw = Math.atan2(_face.x, _face.z);
  }
  rig.arm.set(Math.sin(rig.armYaw), 0, Math.cos(rig.armYaw));
  rig.lagYaw = rig.armYaw;
  rig.up.copy(worldUp);
  rig.hasPrevQuat = false;
  rig.reseed();
  rig.ready = true;
}

/**
 * Did the subject move further this frame than it possibly could have — and if
 * so, is this a nudge to absorb or a shot to cut to?
 *
 * Returns true when a teleport was detected, whether or not it was sharp enough
 * to reseed the bearing. `wrapAngle` is passed in rather than imported so this
 * file's only dependency stays `spring.ts`'s numeric half; both games hand it
 * the same function.
 */
export function trackTeleport(
  rig: TeleportRig,
  t: TeleportTuning,
  k: TeleportSubject,
  dt: number,
  worldUp: THREE.Vector3,
  wrapAngle: (a: number) => number,
): boolean {
  _tmp.copy(k.position).sub(rig.prevKart);
  const cut = rig.ready
    && _tmp.length() > Math.max(t.minStep, (t.speedStep + k.velocity.length() * t.velGain) * dt);
  rig.prevKart.copy(k.position);
  if (!rig.ready) { seed(rig, k, worldUp); return false; }
  if (!cut) return false;

  rig.reseed();
  _face.copy(k.forward); _face.y = 0;
  if (_face.lengthSq() > 1e-6) {
    const y = Math.atan2(_face.x, _face.z);
    if (Math.abs(wrapAngle(rig.armYaw - y)) > t.turn) {
      rig.armYaw = y;
      rig.lagYaw = y;
      rig.compAng = 0;
      rig.arm.set(_face.x, 0, _face.z).normalize();
      rig.hasPrevQuat = false;
    }
  }
  return true;
}

// ===========================================================================
//  3. The shake
// ===========================================================================

/** Five amplitudes, all of them the game's. */
export interface ShakeTuning {
  /** Radians at trauma 1.0, about each camera axis. Weighted toward ROLL,
   *  which is free: rolling about the view axis does not move the axis, so it
   *  reads as an impact without spending any of the rotation budget. Yaw and
   *  pitch are the expensive ones. */
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
  /** ...and metres of lateral and vertical displacement, applied in camera
   *  space after the orientation is final. */
  readonly x: number;
  readonly y: number;
}

/**
 * Fold the shake into an orientation, BEFORE any rate limit.
 *
 * Before, and not after, so the ceiling is a promise about the frame the player
 * sees rather than about the rig's intention. A limiter that runs first and a
 * shake that runs second is a limiter that does not limit.
 */
export function shakeOrientation(
  q: THREE.Quaternion, amount: number, time: number, t: ShakeTuning,
): void {
  _euler.set(shakeNoise(time, 1) * amount * t.pitch,
    shakeNoise(time, 2) * amount * t.yaw,
    shakeNoise(time, 3) * amount * t.roll);
  _q.setFromEuler(_euler);
  q.multiply(_q);
}

/** ...and into the position, in the FINAL camera frame, which is why it is a
 *  separate call and runs after the ceiling rather than beside the rotation. */
export function shakePosition(
  position: THREE.Vector3, orientation: THREE.Quaternion,
  amount: number, time: number, t: ShakeTuning,
): void {
  _tmp.set(shakeNoise(time, 4) * amount * t.x, shakeNoise(time, 5) * amount * t.y, 0)
    .applyQuaternion(orientation);
  position.add(_tmp);
}

// ===========================================================================
//  4. Is anything between the lens and the machine?
// ===========================================================================

/** Three heights and a floor, all of them the game's, and every one of them a
 *  length off a machine that is 1.5 m long in one racer and 8.8 in the other. */
export interface SightlineTuning {
  /** Where on the machine the three rays start: low, high, and low-but-ahead. */
  readonly low: number;
  readonly high: number;
  readonly ahead: number;
  /**
   * Below this range the shot is not occludable and the probe says so.
   *
   * It has to be longer than the near clip plus a usable window, and NO MORE.
   * One racer's floor was 20 m, which silently made this a no-op for any
   * pose closer than that — i.e. for the close plate, the one pose that came
   * back photographed from inside a girder.
   */
  readonly minRange: number;
  /** Where the ray starts and stops relative to the two ends, so it cannot hit
   *  the machine itself or the thing the lens is already inside. */
  readonly near: number;
  readonly farBack: number;
}

/**
 * Three rays from the machine to the lens: is the subject behind something?
 *
 * The list, the raycaster and the hit buffer are all the caller's, so this
 * allocates nothing and the game keeps owning which meshes count as a blocker
 * — a handrail runs along 100% of every deck edge in one racer and does not
 * exist in the other.
 */
export function subjectOccluded(
  eye: THREE.Vector3,
  position: THREE.Vector3,
  forward: THREE.Vector3,
  up: THREE.Vector3,
  t: SightlineTuning,
  list: THREE.Object3D[] | null,
  ray: THREE.Raycaster,
  hits: THREE.Intersection[],
): boolean {
  if (!list || list.length === 0) return false;
  for (let i = 0; i < 3; i++) {
    _pt.copy(position).addScaledVector(up, i === 1 ? t.high : t.low);
    if (i === 2) _pt.addScaledVector(forward, t.ahead);
    _tmp.copy(eye).sub(_pt);
    const len = _tmp.length();
    if (len < t.minRange) return false;
    _tmp.multiplyScalar(1 / len);
    ray.set(_pt, _tmp);
    ray.near = t.near;
    ray.far = len - t.farBack;
    hits.length = 0;
    ray.intersectObjects(list, false, hits);
    if (hits.length) return true;
  }
  return false;
}

// ===========================================================================
//  Cuts — the two places a rig stops being the same shot it was last frame
// ===========================================================================

/**
 * Exactly the fields a plate change invalidates. Not a camera and not a `Ctx`.
 *
 * `trackTeleport` above declares the third kind of cut — the machine moved
 * somewhere its own velocity never took it. These two are the other kinds: the
 * harness asked for a different plate, and the state machine chose a different
 * shot.
 */
export interface CutRig {
  /** The lens's own spring. Snapped, not eased, on a plate change. */
  readonly fovOsc: Osc;
  /** The plate the last frame was built for. */
  prevMode: string | null;
  hasPrevEye: boolean;
  hasPrevQuat: boolean;
}

/** The focal length each harness plate asks for, before the aspect fit. All
 *  three are the game's; this package ships no default for any of them. */
export interface PlateFov {
  readonly chase: number;
  readonly wide: number;
  readonly close: number;
}

/**
 * A harness mode change is a CUT, in both senses.
 *
 * The lens must be at its new focal length on the very first frame: the
 * composition is solved against the live FOV, and a wide plate composed against
 * a stale 50 degrees puts the subject a third of a frame off where it was asked
 * for. So the spring is SNAPPED — value and velocity — rather than eased.
 *
 * ...and the rig jumps to the new pose rather than being rate-limited across
 * the forty metres between the plate and the chase. A harness plate is a
 * different shot, so both continuity flags go.
 *
 * `fit` is the game's aspect fit, passed rather than done here: what a given
 * aspect can carry is a question about the panel, and the game owns the bounds.
 *
 * @returns whether this frame was a cut.
 */
export function cutToMode(
  rig: CutRig, mode: string, plate: PlateFov, fit: (v: number) => number,
): boolean {
  if (mode === rig.prevMode) return false;
  rig.fovOsc.v = fit(mode === 'wide' ? plate.wide : mode === 'close' ? plate.close : plate.chase);
  rig.fovOsc.vel = 0;
  rig.prevMode = mode;
  rig.hasPrevEye = false;
  rig.hasPrevQuat = false;
  return true;
}

/** Exactly the fields {@link shotChanged} touches. */
export interface ShotRig {
  /** Which pose built the last frame. */
  poseKind: number;
  hasPrevEye: boolean;
  hasPrevQuat: boolean;
}

/**
 * A change of pose SOURCE is a change of shot, and a shot change is a cut in
 * both position and orientation.
 *
 * The results orbit and the chase rig have nothing to say to each other, and
 * easing between them at the comfort ceiling spends a second and a quarter with
 * the subject off frame.
 *
 * `seamlessFrom` / `seamlessTo` name the ONE handover that is not a cut, and
 * they are the game's to name: both racers exempt intro -> chase, because the
 * fly-in lerps onto the chase pose deliberately and its handover is already
 * seamless. A game with no such shot passes two values that never both occur
 * and every change is a cut, which is the identity.
 *
 * WHICH pose, and WHEN, does not come here and is not going to. That is a
 * genre decision and it stays with the state machine that makes it —
 * `cinematics.ts` refuses it in writing and `chase.ts` refuses `pickPose` for
 * the same reason: two forks agreeing byte-for-byte is evidence they are forks,
 * not evidence the decision is shared.
 */
export function shotChanged(
  rig: ShotRig, kind: number, seamlessFrom: number, seamlessTo: number,
): void {
  if (kind === rig.poseKind) return;
  if (!(rig.poseKind === seamlessFrom && kind === seamlessTo)) {
    rig.hasPrevEye = false;
    rig.hasPrevQuat = false;
  }
  rig.poseKind = kind;
}
