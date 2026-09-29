/**
 * ============================================================================
 *  The three shots that are not the chase.
 * ============================================================================
 *
 *  A countdown fly-in, a trackside finish cut and a results orbit. They were
 *  line-for-line identical in both racers' cameras — same beats, same easing, same wall
 *  query, same handover — **and the entire divergence between the two was
 *  fourteen numbers**, every one of them a length in metres. A kart is 1.5 m
 *  long and a ship is 8.8, so the finish camera stands 8.5 m off the racing
 *  line in one game and 18 m in the other, and dollies at 3.2 m/s instead of
 *  12. Nothing about the SHOT differs. That is what a shot's tuning is, and it
 *  is why every one of those numbers is a field on a struct the game owns
 *  rather than a constant in here.
 *
 *  **NOTHING IN THIS FILE KNOWS WHAT A RACE IS.** No `RaceState`, no lap, no
 *  standings, no `Ctx`. Which pose to play and when is a genre decision and it
 *  stayed in the games with the state machine that makes it — `pickPose` reads
 *  a `RaceState` enum that is a different enum in each game, and dragging that
 *  across the seam to save thirty lines would have put the two games' race
 *  state machines in a package that composes shots. What crosses is the
 *  geometry of a shot: a subject, a bearing, a time, and where to put the lens.
 *
 *  **THE OUTPUT VECTORS ARE THE CALLER'S**, passed in rather than returned, so
 *  the games keep writing into their own module-scope `_eye` / `_aim` exactly
 *  as before and the scratch-aliasing question does not arise for them. The
 *  transient scratch below IS this file's, and the games' `_tmp`, `_q`, `_dir`
 *  and `_right` are no longer clobbered by these five calls. Every call site
 *  was read: all of them write those vectors before their next read, so nothing
 *  depended on the clobber. It is written down because the failure mode is a
 *  value that survives where it used to be destroyed, and that renders
 *  perfectly.
 * ============================================================================
 */
import * as THREE from 'three';
import { smootherstep } from './spring.ts';

const _tmp = /* @__PURE__ */ new THREE.Vector3();
const _dir = /* @__PURE__ */ new THREE.Vector3();
const _right = /* @__PURE__ */ new THREE.Vector3();
const _q = /* @__PURE__ */ new THREE.Quaternion();

// ===========================================================================
//  The countdown fly-in
// ===========================================================================

/**
 * Bearing for the countdown hold, chosen once when the intro arms.
 *
 * The sun is fixed by the art bible, so the grid shot is composed AGAINST it
 * rather than in ignorance of it: score a fan of candidate bearings on how far
 * the lens points away from the sun and how close to head-on it stays, and take
 * the best. On a start straight running away from the sun this picks a
 * near-head-on 20-30 degrees; on one running into it, it swings out until the
 * sun rakes the grid from the side and rim-lights the field instead of burning
 * through it.
 *
 * Returns radians off head-on, signed. `0.5` is the fallback for both
 * degenerate inputs — a sun straight overhead and an arm parallel to the world
 * up — because a bearing has to be SOME angle and half a radian is inside the
 * fan the loop would have searched anyway.
 */
export function chooseIntroBearing(
  sunDirection: THREE.Vector3,
  arm: THREE.Vector3,
  worldUp: THREE.Vector3,
): number {
  _tmp.copy(sunDirection); _tmp.y = 0;
  if (_tmp.lengthSq() < 1e-6) return 0.5;
  _tmp.normalize();
  _right.crossVectors(arm, worldUp);
  if (_right.lengthSq() < 1e-6) return 0.5;
  _right.normalize();
  const sunFwd = _tmp.dot(arm);
  const sunRight = _tmp.dot(_right);

  let best = 0.5;
  let bestScore = -1e9;
  for (let i = 0; i < 12; i++) {
    const a = (i < 6 ? 1 : -1) * (0.34 + (i % 6) * 0.142);   // 20 to 60 degrees off head-on
    const look = -Math.cos(a) * sunFwd + Math.sin(a) * sunRight;
    const score = -Math.max(0, look - 0.30) * 7 - Math.abs(a) * 0.5;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/**
 * Where the fly-in stands, in metres. Every field is a length off the subject,
 * and every one of them is four to five times larger in the space racer because
 * the machine is.
 */
export interface IntroShot {
  /** Range at the hold, and how much of it the two beats take back. */
  readonly dist: number;
  readonly distFront: number;
  readonly distSettle: number;
  /** Height over the subject, same three-term shape. */
  readonly height: number;
  readonly heightFront: number;
  readonly heightSettle: number;
  /** Where on the machine the lens looks, and how far that rises as it settles. */
  readonly aimUp: number;
  readonly aimUpSettle: number;
  /** ...and how far BACK along the bearing, which is what keeps the grid behind
   *  the player in frame rather than just the player. */
  readonly aimBack: number;
}

/**
 * Two beats: a held front three-quarter of the grid — the shot that sells the
 * field — then a sweep round the flank landing exactly on the chase pose as the
 * lights go out. Low and near head-on, because the player is always pole: a
 * lens in front of the player is a lens in front of the whole field, and the
 * karts stack into rows instead of trailing off to a vanishing point.
 *
 * `escape` is the one thing this cannot do for itself. A kerb-height lens swung
 * well off the racing axis can end up behind a barrier and there is no arm
 * sweep out here to catch it, so the game is handed the eye and asked to put it
 * back on the tarmac with whatever its own track knows. It is called between
 * the pose and the handover lerp, which is the order both games shipped.
 */
export function poseIntro(
  eye: THREE.Vector3,
  aim: THREE.Vector3,
  subject: THREE.Vector3,
  arm: THREE.Vector3,
  worldUp: THREE.Vector3,
  introAng: number,
  p: number,
  shot: IntroShot,
  escape: (eye: THREE.Vector3) => void,
  chaseEye: THREE.Vector3,
  chaseAim: THREE.Vector3,
): void {
  const front = smootherstep(clamp01(p / 0.62));
  const settle = smootherstep(clamp01((p - 0.58) / 0.42));

  const side = introAng >= 0 ? 1 : -1;
  const hold = introAng * (0.86 + front * 0.14);
  const ang = hold + (side * 2.95 - hold) * settle;
  const dist = shot.dist - front * shot.distFront - settle * shot.distSettle;
  const height = shot.height - front * shot.heightFront - settle * shot.heightSettle;

  _q.setFromAxisAngle(worldUp, ang);
  _dir.copy(arm).applyQuaternion(_q);
  eye.copy(subject).addScaledVector(_dir, dist).addScaledVector(worldUp, height);
  aim.copy(subject).addScaledVector(worldUp, shot.aimUp + settle * shot.aimUpSettle).addScaledVector(arm, -shot.aimBack);

  escape(eye);

  // Ease home so the handover to gameplay has no seam.
  eye.lerp(chaseEye, settle);
  aim.lerp(chaseAim, settle);
}

// ===========================================================================
//  The finish
// ===========================================================================

/** Where the trackside camera stands and how it rises out of the hold. */
export interface FinishShot {
  /** Metres outboard of the racing line's edge, and up off the surface. */
  readonly side: number;
  readonly lift: number;
  /** Dolly rate, m/s, so the machine does not simply leave the frame. */
  readonly dolly: number;
  /** Where the lens looks on the machine, throughout. */
  readonly aimUp: number;
  /** The victory-lap chase it rises into: back along the bearing, and up. */
  readonly riseBack: number;
  readonly riseUp: number;
  /** ...and how far the aim leads it once it is there. */
  readonly aimLead: number;
}

/**
 * Plant the trackside camera, on the OUTSIDE of the machine.
 *
 * `lateral` is the subject's signed offset from the racing line; the sign is
 * all that is read. `s` is a track sample a little ahead of the machine, so the
 * camera is already looking at where it is about to be rather than where it is.
 */
export function captureFinishCut(
  cutPos: THREE.Vector3,
  cutTangent: THREE.Vector3,
  s: { pos: THREE.Vector3; binormal: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3; halfWidth: number },
  lateral: number,
  shot: FinishShot,
): void {
  const side = lateral >= 0 ? 1 : -1;   // stand on the outside of the machine
  cutPos.copy(s.pos)
    .addScaledVector(s.binormal, side * (s.halfWidth + shot.side))
    .addScaledVector(s.normal, shot.lift);
  cutTangent.copy(s.tangent);
}

/**
 * Hold trackside, then rise into a wide victory lap.
 *
 * The 1.6 s of the rise and the smootherstep on it are shape rather than
 * tuning: both games shipped the same easing over the same window, and a game
 * that wants a different one wants a different shot.
 */
export function poseFinish(
  eye: THREE.Vector3,
  aim: THREE.Vector3,
  subject: THREE.Vector3,
  arm: THREE.Vector3,
  worldUp: THREE.Vector3,
  cutPos: THREE.Vector3,
  cutTangent: THREE.Vector3,
  finishT: number,
  hold: number,
  shot: FinishShot,
): void {
  if (finishT < hold) {
    // Trackside, dollying gently with the machine so it does not simply leave.
    eye.copy(cutPos).addScaledVector(cutTangent, finishT * shot.dolly);
    aim.copy(subject).addScaledVector(worldUp, shot.aimUp);
  } else {
    // Then rise into a wide victory-lap chase.
    const w = smootherstep((finishT - hold) / 1.6);
    _tmp.copy(subject).addScaledVector(arm, -shot.riseBack).addScaledVector(worldUp, shot.riseUp);
    eye.copy(cutPos).addScaledVector(cutTangent, hold * shot.dolly).lerp(_tmp, w);
    aim.copy(subject).addScaledVector(worldUp, shot.aimUp).addScaledVector(arm, shot.aimLead * w);
  }
}

// ===========================================================================
//  The results orbit
// ===========================================================================

/** The two orbits — normally a tight results ring and a slower menu one. */
export interface OrbitShot {
  /** Angular speed in radians/second. The caller owns both values: no shot pace is universal. */
  readonly rate: number;
  readonly rateWide: number;
  readonly range: number;
  readonly rangeWide: number;
  readonly height: number;
  readonly heightWide: number;
  /** Amplitude of the slow vertical breathe, metres. */
  readonly bob: number;
  readonly aimUp: number;
  readonly aimUpWide: number;
}

/**
 * A ring around the subject. Returns the advanced orbit angle because the
 * accumulator is the shot's own state. Pace is caller-owned tuning, just like
 * range, height and aim; a results screen and an ambient film do not share it.
 */
export function poseOrbit(
  eye: THREE.Vector3,
  aim: THREE.Vector3,
  winner: THREE.Vector3,
  worldUp: THREE.Vector3,
  orbit: number,
  wide: boolean,
  dt: number,
  shot: OrbitShot,
): number {
  const a = orbit + dt * (wide ? shot.rateWide : shot.rate);
  _q.setFromAxisAngle(worldUp, a);
  _dir.set(0, 0, 1).applyQuaternion(_q);
  eye.copy(winner)
    .addScaledVector(_dir, wide ? shot.rangeWide : shot.range)
    .addScaledVector(worldUp, (wide ? shot.heightWide : shot.height) + Math.sin(a * 1.7) * shot.bob);
  aim.copy(winner).addScaledVector(worldUp, wide ? shot.aimUpWide : shot.aimUp);
  return a;
}

/** Local rather than imported: `clamp(x, 0, 1)` from `spring.ts` is the same
 *  three comparisons, and this file's only use of it is the 0..1 form. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
