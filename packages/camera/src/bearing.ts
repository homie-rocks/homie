/**
 * ============================================================================
 *  WHERE THE LENS SITS — one scalar, and everything that is allowed to move it.
 * ============================================================================
 *
 *  `armYaw` is the compass direction the lens sits behind. It springs toward
 *  the machine's direction of TRAVEL, not its facing — which is what makes a
 *  drift read as a drift — and it is bounded two ways: it may never fall more
 *  than `maxLag` behind the chassis, and it may never move faster than
 *  `maxRate`. Both bounds are stated per SECOND, which is why the rig behaves
 *  identically at 30, 60 and 144 Hz.
 *
 *  Falling out of the same pass: `corner` (how hard the machine is really
 *  turning, in the units the driver's inner ear reports), `bend` (how hard the
 *  road ahead turns), and `bankAmt` (how far the surface is tilted). Three
 *  quantities the composition, the lens and the arm's climb all read, produced
 *  once from one differentiation rather than three times from three.
 *
 *  **BOTH RACERS CARRIED A COPY, 126 AND 148 LINES, AND THE DIVERGENCE WAS
 *  THREE THINGS**, none of them a behaviour:
 *
 *    · twenty-three numbers, all of them in {@link BearingTuning};
 *    · `roadFloor` — the space racer raises the follow-the-road term while its
 *      mag-lock is breaking, because a ship coming off the plate at 85 m/s has
 *      a perfectly trustworthy velocity heading that points off the deck.
 *      The kart racer passes 0 and the `Math.max` below is then the identity;
 *    · whether the caller keeps the `lost` flag. It is RETURNED rather than
 *      written, so the game that reads it can and the game that does not is
 *      not carrying a dead field.
 *
 *  **NOTHING HERE KNOWS WHAT A RACE IS.** No lap, no drift tier, no boost
 *  clock, no `Ctx`. `drift`, `calm` and `air` arrive as three numbers in
 *  {@link BearingSignals} because they are already filtered CAMERA state by the
 *  time this runs — the genre reading that produced them stayed in the game,
 *  which is where a boost time and a stun time belong.
 *
 *  **NO NUMBER IS IN THIS FILE**, for the reason `lens.ts` and `blockers.ts`
 *  both give at length. `maxLag` is 0.455 rad in both racers today and it is a
 *  field anyway: a package that ships a number two games happen to agree on has
 *  quietly picked one game's feel for every game that ever calls it, and the
 *  frames look completely fine while it does. The only literals below are
 *  thresholds on degenerate geometry — a zero-length vector, an antipodal
 *  heading — and those are not tuning.
 *
 *  **THE SCRATCH IS THIS FILE'S.** Both games' `_face`, `_vel`, `_tmp` and
 *  `_right` used to be clobbered by this pass and are not any more. Every call
 *  site was read before the move: all of them write those vectors before their
 *  next read, and `_vel` had no other user in either game and is gone from
 *  both. It is written down because the failure it would cause is a value that
 *  SURVIVES where it used to be destroyed, which renders perfectly.
 * ============================================================================
 */
import * as THREE from 'three';
import { type Vel, clamp, damp1, wrapAngle } from './spring.ts';

const _face = /* @__PURE__ */ new THREE.Vector3();
const _vel = /* @__PURE__ */ new THREE.Vector3();
const _tmp = /* @__PURE__ */ new THREE.Vector3();
const _right = /* @__PURE__ */ new THREE.Vector3();

/**
 * The rig's own bearing state. Thirteen fields, all read and written here.
 *
 * A structural interface rather than a class, deliberately: both games hold
 * these on their `ChaseCamera` alongside forty other fields that this file has
 * no business seeing, and they satisfy this by having them. Nothing had to be
 * moved into a new object, so no call site anywhere else in either rig changed.
 */
export interface BearingState {
  /** World yaw the lens sits behind, radians. */
  armYaw: number;
  /** Unit-vector form of `armYaw`, rewritten from it every frame. */
  arm: THREE.Vector3;
  /** Chassis heading, flattened. Published because the composition cancels
   *  against it. */
  faceYaw: number;
  /** Lagged copy of the travel heading, for differentiation. */
  lagYaw: number;
  armVel: Vel;
  lagVel: Vel;
  /** How hard the road AHEAD turns, -1..1, + = right. */
  bend: number;
  bendVel: Vel;
  /** How hard the machine is really turning, -1..1, + = right. */
  corner: number;
  cornerVel: Vel;
  /** |surface tilt|, 0..1. */
  bankAmt: number;
  bankVel: Vel;
}

/** Already-filtered camera signals. Not genre state: whatever read a drift
 *  tier or a boost clock to produce these stayed in the game. */
export interface BearingSignals {
  /** |slide|, 0..1. Lengthens the travel gain and the spring's time constant. */
  drift: number;
  /** 0 = parked or spun, 1 = driving. */
  calm: number;
  /** Airborne, filtered. Fades the surface tilt out. */
  air: number;
  /**
   * A FLOOR under the follow-the-road term, 0..1.
   *
   * Zero in a game where the velocity heading is trustworthy whenever it
   * exists. Raised while a hold on the surface is breaking, where the machine
   * genuinely is going somewhere the player did not ask for and the centreline
   * is the only heading worth looking at. `Math.max`, never a sum — the two are
   * alternative reasons to look at the road and adding them puts the bearing
   * past the centreline on a slow off.
   */
  roadFloor: number;
}

/** Twenty-three numbers, every one of them the game's. */
export interface BearingTuning {
  /** Fraction of the slip angle the bearing reads, and the extra while sliding. */
  travelGain: number;
  travelGainDrift: number;
  /** Ceiling on the slip the bearing will express, radians. */
  maxSlip: number;
  /** How far toward the centreline the target swings at a standstill, 0..1. */
  roadFollow: number;
  /** The bearing spring's time constant, and its three additions. The standing
   *  error of a spring tracking a target that yaws at w is w * tau, and that
   *  standing error IS the trailing lag. */
  tau: number;
  tauDrift: number;
  tauCorner: number;
  tauCalm: number;
  /** Radians the bearing may lag the CHASSIS, and the rate ceiling — lifted to
   *  `maxRateLost` while the bearing is genuinely behind. */
  maxLag: number;
  maxRate: number;
  maxRateLost: number;
  /** Differentiation window for the yaw rate, seconds. Fixed-time-constant
   *  rather than per-frame, so the noise floor is the same at 30 and 120 Hz. */
  rateTau: number;
  /** Ceiling on the heading rate the corner estimate will believe, rad/s. A
   *  COLLISION is not cornering. */
  yawRateMax: number;
  /** Metres of road looked ahead for `bend`, at a standstill and at top speed. */
  look: number;
  lookSpeed: number;
  bendTau: number;
  /** Lateral acceleration that reads as a full corner, m/s^2, and how the
   *  measured and anticipated halves are weighted. */
  gFull: number;
  measured: number;
  anticipated: number;
  cornerTau: number;
  /** Ceiling on how fast the composition itself may change, per second. */
  cornerMaxRate: number;
  /** Surface tilt that saturates `bankAmt`, radians, and its filter. */
  bankFull: number;
  bankTau: number;
}

/** Two fields of the surface sample under the machine. */
export interface BearingSurface {
  readonly tangent: THREE.Vector3;
  /** Roll of the surface about its own tangent, radians. */
  readonly bank: number;
}

/**
 * Advance the bearing and the three quantities that fall out with it.
 *
 * Returns `lost` — whether the bearing is more than `maxLag` off the chassis —
 * because the comfort ceiling on the ORIENTATION lifts on exactly this
 * condition, for exactly the reason the rate ceiling here does, and a caller
 * that wants to say so should not have to recompute it.
 *
 * `sample` is a closure so the caller keeps ownership of its own scratch
 * sample: both games pass `(t) => this.sampleFn!(t, this.smpB!)` and the
 * allocation behaviour is unchanged from the copies this replaced.
 */
export function updateBearing(
  B: BearingState,
  machine: { forward: THREE.Vector3; velocity: THREE.Vector3 },
  s: BearingSurface,
  sample: (t: number) => { tangent: THREE.Vector3 },
  t: number,
  trackLength: number,
  sig: BearingSignals,
  sp: number,
  speed: number,
  dt: number,
  T: BearingTuning,
  worldUp: THREE.Vector3,
): boolean {
  // Chassis heading, flattened. Yaw is a compass direction; slope has no
  // business leaking into it.
  _face.copy(machine.forward); _face.y = 0;
  if (_face.lengthSq() < 1e-6) _face.copy(B.arm); else _face.normalize();
  const faceYaw = Math.atan2(_face.x, _face.z);
  B.faceYaw = faceYaw;

  // --- direction of TRAVEL ------------------------------------------------
  //
  // Measured as an ANGLE and applied as a rotation of the chassis heading, not
  // as a lerp between two unit vectors. A chord lerp realises strictly less
  // than `gain * slip` degrees and saturates at the velocity vector, so there
  // is no way to express "read the slide as further sideways than it physically
  // is" — which is precisely what a racing camera is for.
  let slip = 0;
  _vel.copy(machine.velocity); _vel.y = 0;
  const vlen = _vel.length();
  if (vlen > 2) {
    _vel.multiplyScalar(1 / vlen);
    // Reversing, spun out or hit: the velocity heading would swing the rig
    // through 180 degrees, so it is trusted only while it broadly agrees with
    // where the chassis points.
    const agree = _vel.dot(_face);
    if (agree > 0.2) {
      const gain = clamp((vlen - 2) / 5, 0, 1)
        * (T.travelGain + T.travelGainDrift * sig.drift)
        * clamp((agree - 0.2) / 0.35, 0, 1);
      slip = clamp(wrapAngle(Math.atan2(_vel.x, _vel.z) - faceYaw) * gain, -T.maxSlip, T.maxSlip);
    }
  }
  let targetYaw = wrapAngle(faceYaw + slip);

  // --- below walking pace, follow the ROAD --------------------------------
  //
  // Under the calm threshold there is no velocity heading to trust, so the
  // target would be the chassis — and a chassis that has been shunted or spun
  // yaws at two to four hundred degrees a second. Lag does not help: a
  // critically-damped filter chasing a constant-rate target tracks at the SAME
  // rate and merely shifts the phase. Pointing at the centreline does help, and
  // it is also what the player needs at that moment: to see where the track
  // goes. `roadFloor` is the second, independent reason to do it — see
  // BearingSignals.
  const road = Math.max((1 - sig.calm) * T.roadFollow, sig.roadFloor);
  if (road > 1e-3) {
    _tmp.copy(s.tangent); _tmp.y = 0;
    if (_tmp.lengthSq() > 1e-6) {
      _tmp.normalize();
      // Antipodal is ambiguous — there is no short way round — so leave a
      // machine pointing backwards to the physics rather than picking a side.
      if (_tmp.dot(_face) > -0.94) {
        targetYaw = wrapAngle(targetYaw + wrapAngle(Math.atan2(_tmp.x, _tmp.z) - targetYaw) * road);
      }
    }
  }

  // --- the spring, and the two bounds -------------------------------------
  //
  // The spring is run on the ERROR rather than on the absolute angle, which is
  // what makes it wrap correctly through +-pi.
  const tau = T.tau
    + T.tauDrift * sig.drift
    + T.tauCorner * Math.abs(B.corner)
    + T.tauCalm * (1 - sig.calm);
  const err = damp1(wrapAngle(B.armYaw - targetYaw), 0, B.armVel, tau, dt);

  // Bound 1: never more than `maxLag` off the CHASSIS. Stated against the
  // chassis and not against the travel heading on purpose — the travel heading
  // is already up to `maxSlip` away, and two allowances in series is how a rig
  // ends up most of a turn behind a machine that turned a quarter of one. This
  // is the guarantee that the player can see where they are going.
  let want = wrapAngle(targetYaw + err);
  const chassisErr = wrapAngle(want - faceYaw);
  if (Math.abs(chassisErr) > T.maxLag) {
    want = wrapAngle(faceYaw + (chassisErr > 0 ? T.maxLag : -T.maxLag));
    // The spring stored the velocity that produced the excess; leaving it
    // intact means it pushes straight back out next frame.
    B.armVel.v *= 0.2;
  }

  // Bound 2: a rate ceiling, lifted while the bearing is genuinely behind.
  let step = wrapAngle(want - B.armYaw);
  const lost = Math.abs(wrapAngle(B.armYaw - faceYaw)) > T.maxLag;
  const maxStep = (lost ? T.maxRateLost : T.maxRate) * dt;
  if (step > maxStep) step = maxStep; else if (step < -maxStep) step = -maxStep;
  B.armYaw = wrapAngle(B.armYaw + step);
  B.arm.set(Math.sin(B.armYaw), 0, Math.cos(B.armYaw));

  // --- how hard are we cornering, really ----------------------------------
  //
  // The yaw rate of the travel heading times road speed is lateral acceleration
  // in m/s^2: the number the driver's inner ear reports, and therefore the
  // number the frame should be composed around. Differentiated against a
  // fixed-time-constant lag rather than against last frame, so the noise floor
  // is the same at 30 Hz and at 120.
  B.lagYaw = wrapAngle(targetYaw + damp1(wrapAngle(B.lagYaw - targetYaw), 0, B.lagVel, T.rateTau, dt));
  // + = turning right. yaw = atan2(x, z) increases to the LEFT, hence the sign
  // flip; `right` below is cross(forward, up), which is the convention three.js
  // builds its camera basis with.
  const yawRate = clamp(-wrapAngle(targetYaw - B.lagYaw) / T.rateTau, -T.yawRateMax, T.yawRateMax);

  // Blended with the bend of the road ahead so the frame starts recomposing on
  // the approach instead of at the apex.
  //
  // KNOWN LIMITATION, and it belongs here now that both games share the code.
  // This and the yaw rate above are measured in the WORLD plan frame, so
  // wherever a rig is rolled past vertical their screen sense is reversed and
  // the composition leads the wrong way. The space racer states the case it
  // has — an inverted leg, 246 m of -20 degrees — and leaves it alone on
  // purpose: `bend` there is about 0.2, the error is a couple of degrees of
  // lens lead for one second a lap, and the alternative is a handedness switch
  // on a quantity the arm's bank climb and the Dutch lean also read. A sign
  // that flips at exactly the vertical crossing is a far more expensive bug
  // than the one it fixes.
  _right.crossVectors(B.arm, worldUp);
  if (_right.lengthSq() > 1e-6) _right.normalize(); else _right.set(1, 0, 0);
  const ahead = (T.look + T.lookSpeed * sp) / Math.max(1, trackLength);
  const sA = sample(t + ahead);
  _tmp.copy(sA.tangent); _tmp.y = 0;
  const bendRaw = _tmp.lengthSq() > 1e-6 ? clamp(_tmp.normalize().dot(_right), -1, 1) : 0;
  B.bend = damp1(B.bend, bendRaw, B.bendVel, T.bendTau, dt);

  // The anticipation is faded with road speed: `bend` is a fact about the road,
  // not about the machine, so on its own it composes a full corner for a
  // machine sitting still on the entry to one.
  const target = clamp(
    (yawRate * speed / T.gFull) * T.measured + B.bend * T.anticipated * sig.calm,
    -1, 1,
  );
  const nextCorner = damp1(B.corner, target, B.cornerVel, T.cornerTau, dt);
  B.corner += clamp(nextCorner - B.corner, -T.cornerMaxRate * dt, T.cornerMaxRate * dt);

  // Surface tilt, for the arm's bank climb. Faded out in the air, where the
  // surface under the machine is not the plane it is travelling in.
  B.bankAmt = damp1(B.bankAmt, Math.min(1, Math.abs(s.bank) / T.bankFull) * (1 - sig.air),
    B.bankVel, T.bankTau, dt);

  return lost;
}
