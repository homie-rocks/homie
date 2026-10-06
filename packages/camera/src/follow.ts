/**
 * ============================================================================
 *  A third-person follow camera with a collision guard, as numbers only.
 * ============================================================================
 *
 *  `chase.ts` and `bearing.ts` are a racing rig: a bearing sprung along a
 *  centreline, an arm with twenty-two lengths, a sweep the game writes itself.
 *  A game with a creature, a ball or a character in a cave or an arena wants
 *  far less and one thing those files do not hand over ready made:
 *
 *      a target pose  +  a question it can ask of the level  ->  where the
 *      lens is and what it looks at, never inside geometry, never inside
 *      the thing it follows.
 *
 *  That is this file. Three ideas:
 *
 *   1. **THE YAW FOLLOWS, AND CATCHES UP FASTER THE FURTHER BEHIND IT IS.** A
 *      single time constant is wrong at both ends: slow enough to be calm on a
 *      gentle curve leaves the player staring at their own flank after a hard
 *      turn, and fast enough for the hard turn makes every small correction
 *      swing the world. The time constant here blends from `yawTau` to
 *      `yawTauHard` as the error grows to `hardTurn` radians.
 *
 *   2. **SPEED PULLS THE LENS BACK.** `dist + distSpeed` at `speedFull`, eased.
 *
 *   3. **THE GUARD HAS A FIXED ORDER: SWING, THEN PULL IN, THEN CLIMB.** Every
 *      frame it tries the arm at the yaw it wants, then at steps either side,
 *      and keeps the direction that reaches furthest (the nearest to straight
 *      behind wins a tie, then the side it is already on, so it does not flap).
 *      If no direction reaches the full arm it takes the longest clear reach:
 *      that is the pull in. And when the reach is so short that the lens would
 *      sit inside the subject, it climbs until it is `headRadius` away, ending
 *      directly overhead when there is no room at all. The order matters: a
 *      swing keeps the picture, a pull in costs the framing, and a climb costs
 *      the horizon, so each is used only when the one before has run out.
 *
 *  **THE GUARD IS A CONSTRAINT, NOT A MOVE** (`constrain.ts` says why at
 *  length). Swing, reach and climb are eased so the picture does not snap, but
 *  the eased pose is checked and, when it is not clear, the solved pose is
 *  used as it stands. So after every `stepFollow` the eye is at least
 *  `lensRadius` from solid and at least `headRadius` from the subject's head,
 *  provided the subject itself stands somewhere with `lensRadius` of room.
 *  Both are asserted over a scripted run in this package's test.
 *
 *  **THE COLLISION QUESTION IS ONE FUNCTION**: `field(x, z)` answers the
 *  clearance at a point on the ground plane, in metres, negative inside solid.
 *  A signed distance field is that function already. A game with boxes or a
 *  tile map wraps its own query with {@link fieldFromBlocked}.
 *
 *  **NO three, NO renderer, NO clock.** It reads numbers and writes numbers,
 *  every filter is a closed-form exponential in `dt`, and the same inputs give
 *  the same outputs on any machine, so a test can drive a thousand frames in
 *  Node.
 *
 *  **THE HEADING: YAW 0 FACES +Z, POSITIVE YAW TURNS TOWARD +X, RADIANS.**
 *
 *      forward = (sin yaw, cos yaw) in (x, z)
 *
 *                       -Z   yaw = PI
 *                        |
 *      yaw = -PI/2  -X --+-- +X  yaw = +PI/2          (seen from above)
 *                        |
 *                       +Z   yaw = 0
 *
 *  That is `Object3D.rotation.y` for a model built facing +Z, and nothing
 *  else. A game whose heading is measured from +X, or whose model faces -Z,
 *  or that counts in degrees, converts with `headingFrom` or `headingOfVector`
 *  in `heading.ts` BEFORE it fills in {@link FollowTarget.yaw}. Feeding the
 *  wrong angle does not throw: the lens sits beside the subject or in front
 *  of it. So in a development build the rig watches for the signature of it
 *  (the subject keeps travelling one way while its yaw says another, for a
 *  second) and says so once on the console. See {@link FollowOptions}.
 *
 *  Zero allocation per frame: the answer is written into the caller's state.
 * ============================================================================
 */
import {
  headingWatch, isProductionBuild, restHeadingWatch, stepHeadingWatch, type HeadingWatch,
} from './heading.ts';
import { clamp, expApproach, smootherstep, wrapAngle } from './spring.ts';

/** Clearance at a ground point, metres. Positive is open air, negative is inside solid. */
export type FollowField = (x: number, z: number) => number;

/**
 * Wrap a yes/no query as a {@link FollowField}.
 *
 * A boolean cannot say how FAR the wall is, so the answer is all or nothing:
 * `clear` metres where the query says open (pass at least the rig's
 * `lensRadius`), and minus that where it says blocked. The guard then keeps
 * the lens on open samples, which with a `probeStep` of half the lens radius
 * is the same promise to within one step.
 */
export function fieldFromBlocked(blocked: (x: number, z: number) => boolean, clear: number): FollowField {
  return (x, z) => (blocked(x, z) ? -clear : clear);
}

/** What is being followed: where it is, which way it faces, how fast it moves. */
export interface FollowTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Heading, radians: **0 faces +Z, positive turns toward +X**, so forward is
   * `(sin yaw, cos yaw)` in (x, z). Any other convention goes through
   * `headingFrom` or `headingOfVector` (`heading.ts`) first.
   */
  readonly yaw: number;
  /** Metres per second, unsigned. */
  readonly speed: number;
  /**
   * True on a frame where the subject is meant to travel against its heading:
   * a vehicle in reverse, a character backpedalling or strafing. It changes
   * nothing about the camera; it only tells the development heading check not
   * to read that frame.
   */
  readonly reversing?: boolean;
}

/** How to make a rig. Every field is optional and none of them moves the lens. */
export interface FollowOptions {
  /**
   * The development heading check, on unless this is `false`.
   *
   * While the subject moves, its yaw is compared with its direction of travel;
   * a sixth of a turn apart for a whole second is a heading in the wrong
   * convention far more often than it is anything else, and the rig says so
   * once, naming the adapter. Turn it off for a subject that moves against its
   * heading as a matter of course (a twin-stick character, a strafing
   * shooter), or mark only those frames with {@link FollowTarget.reversing}.
   * A production bundle never runs it.
   */
  readonly headingCheck?: boolean;
  /**
   * Where the one warning goes. `console.warn` when absent. Passing one also
   * runs the check in a production build, which is how a test drives it.
   */
  readonly warn?: (message: string) => void;
}

/** Every number the rig runs on. None has a default: they are the game's feel. */
export interface FollowTuning {
  /** Arm length at rest, metres along the ground. */
  readonly dist: number;
  /** Extra arm at `speedFull`, metres. */
  readonly distSpeed: number;
  /** The speed at which the pull-back is complete, m/s. */
  readonly speedFull: number;
  /** Time constant of the arm length, seconds. */
  readonly distTau: number;
  /** Lens height above the subject's origin, metres. */
  readonly height: number;
  /** Height of the point the lens looks at, and of the head it must not enter. */
  readonly lookUp: number;

  /** Yaw time constant on a gentle turn, seconds. */
  readonly yawTau: number;
  /** Yaw time constant once the error reaches `hardTurn`. Smaller is faster. */
  readonly yawTauHard: number;
  /** Radians of yaw error at which the fast constant is fully in. */
  readonly hardTurn: number;

  /** Clearance the lens keeps from solid, metres. */
  readonly lensRadius: number;
  /** Distance the lens keeps from the head, metres. */
  readonly headRadius: number;
  /** Spacing of the samples along the arm, metres. Half the lens radius is a good start. */
  readonly probeStep: number;
  /** Radians between the directions tried either side, and the furthest tried. */
  readonly swingStep: number;
  readonly swingMax: number;
  /** Most the lens may rise above `height`, metres. */
  readonly climbMax: number;
  /** Time constants of the guard: giving way is fast, returning is slow. */
  readonly guardIn: number;
  readonly guardOut: number;
}

/** The rig's state and its answer. Make one with {@link followState}. */
export interface FollowState {
  /** Yaw the lens sits behind, before any swing. */
  yaw: number;
  /** Arm length the speed asks for, metres. */
  dist: number;
  /** The guard's three answers, eased: radians, metres along the ground, metres up. */
  swing: number;
  reach: number;
  climb: number;
  /** Which of the three the guard is using this frame, for a HUD or a test. */
  guard: 'clear' | 'swing' | 'pull' | 'climb';
  /** False until the first step, and after {@link cutFollow}: that frame snaps. */
  primed: boolean;
  /** The answer. */
  eyeX: number; eyeY: number; eyeZ: number;
  lookX: number; lookY: number; lookZ: number;
  /** The development heading check, or null when it is off. See {@link FollowOptions}. */
  heading?: HeadingWatch | null;
}

export function followState(options: FollowOptions = {}): FollowState {
  const watch = options.headingCheck === false ? null
    : options.warn ? headingWatch(options.warn)
    : isProductionBuild() ? null
    : headingWatch((message) => console.warn(message));
  return {
    yaw: 0, dist: 0, swing: 0, reach: 0, climb: 0, guard: 'clear', primed: false,
    eyeX: 0, eyeY: 0, eyeZ: 0, lookX: 0, lookY: 0, lookZ: 0,
    heading: watch,
  };
}

/** The next step snaps to the solved pose: call it on a respawn or a teleport. */
export function cutFollow(s: FollowState): void {
  s.primed = false;
}

/**
 * The longest clear reach from the subject along one direction, up to `want`.
 *
 * Walks outward. A sample inside solid ends the walk, because past it the
 * subject is hidden; a sample with at least `lensRadius` of room is somewhere
 * the lens may stop. The last such sample is the answer, and 0 means there is
 * nowhere along this direction at all.
 */
function clearReach(
  field: FollowField, x: number, z: number, dx: number, dz: number, want: number, t: FollowTuning,
): number {
  let best = 0;
  const steps = Math.max(1, Math.ceil(want / t.probeStep));
  for (let i = 1; i <= steps; i++) {
    const r = i === steps ? want : i * t.probeStep;
    const c = field(x + dx * r, z + dz * r);
    if (c <= 0) break;
    if (c >= t.lensRadius) best = r;
  }
  return best;
}

/** Height the lens needs so that a reach of `r` still leaves `headRadius` to the head. */
function climbFor(r: number, t: FollowTuning): number {
  const rise = t.height - t.lookUp;
  if (r * r + rise * rise >= t.headRadius * t.headRadius) return 0;
  return clamp(Math.sqrt(t.headRadius * t.headRadius - r * r) - rise, 0, t.climbMax);
}

/** Is a lens at this swing and reach clear of solid? The same test the solve used. */
function poseClear(
  field: FollowField, target: FollowTarget, yaw: number, reach: number, t: FollowTuning,
): boolean {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const steps = Math.max(1, Math.ceil(reach / t.probeStep));
  for (let i = 1; i < steps; i++) {
    if (field(target.x + dx * i * t.probeStep, target.z + dz * i * t.probeStep) <= 0) return false;
  }
  return field(target.x + dx * reach, target.z + dz * reach) >= t.lensRadius;
}

/**
 * Advance the rig one frame and write the eye and the look point into `s`.
 *
 * `field` is asked about `(2 * swingMax / swingStep + 1) * (arm / probeStep)`
 * points a frame at most, about a hundred and fifty with ordinary numbers, so
 * it should be a lookup or a few lines of arithmetic rather than a raycast.
 */
export function stepFollow(
  s: FollowState, t: FollowTuning, target: FollowTarget, field: FollowField, dt: number,
): FollowState {
  // 0. Development only: is this yaw in the convention the header states? A
  //    cut or a reversing frame is not evidence either way.
  const watch = s.heading;
  if (watch && !watch.done) {
    if (!s.primed || target.reversing) restHeadingWatch(watch);
    if (!target.reversing) stepHeadingWatch(watch, target.x, target.z, target.yaw, dt);
  }

  // 1. The yaw, with the time constant shortened by how far behind it is.
  const err = wrapAngle(target.yaw - s.yaw);
  const hard = smootherstep(clamp(Math.abs(err) / t.hardTurn, 0, 1));
  const tau = t.yawTau + (t.yawTauHard - t.yawTau) * hard;
  // 2. The arm the speed asks for.
  const wantDist = t.dist + t.distSpeed * clamp(target.speed / t.speedFull, 0, 1);
  if (s.primed) {
    s.yaw = wrapAngle(s.yaw + err * (1 - Math.exp(-dt / tau)));
    s.dist = expApproach(s.dist, wantDist, t.distTau, dt);
  } else {
    s.yaw = wrapAngle(target.yaw);
    s.dist = wantDist;
  }

  // 3. The guard: the direction that reaches furthest. Candidates are visited
  //    nearest to straight behind first, the side already swung to before the
  //    other, and only a strictly longer reach displaces the one held, which
  //    is the whole of the tie-break.
  const side = s.swing < 0 ? -1 : 1;
  let swing = 0;
  let reach = clearReach(field, target.x, target.z, -Math.sin(s.yaw), -Math.cos(s.yaw), s.dist, t);
  if (reach < s.dist) {
    const n = Math.floor(t.swingMax / t.swingStep + 1e-9);
    for (let i = 1; i <= n && reach < s.dist; i++) {
      for (let k = 0; k < 2 && reach < s.dist; k++) {
        const a = (k === 0 ? side : -side) * i * t.swingStep;
        const r = clearReach(field, target.x, target.z, -Math.sin(s.yaw + a), -Math.cos(s.yaw + a), s.dist, t);
        if (r > reach) { reach = r; swing = a; }
      }
    }
  }
  const climb = climbFor(reach, t);
  s.guard = climb > 0 ? 'climb' : reach < s.dist ? 'pull' : swing !== 0 ? 'swing' : 'clear';

  // 4. Ease toward the solve, giving way fast and returning slowly, then hold
  //    the eased pose to the same test. A pose that fails is replaced by the
  //    solve outright: see the header.
  if (s.primed) {
    const tight = reach < s.reach || Math.abs(swing) > Math.abs(s.swing);
    const g = tight ? t.guardIn : t.guardOut;
    const eSwing = expApproach(s.swing, swing, g, dt);
    const eReach = expApproach(s.reach, reach, g, dt);
    if (poseClear(field, target, s.yaw + eSwing, eReach, t)) {
      s.swing = eSwing;
      s.reach = eReach;
      // The head rule is exact for whatever reach was kept, so the climb may
      // only ever ease DOWN toward it.
      s.climb = Math.max(climbFor(eReach, t), expApproach(s.climb, climb, t.guardOut, dt));
    } else {
      s.swing = swing; s.reach = reach; s.climb = climb;
    }
  } else {
    s.swing = swing; s.reach = reach; s.climb = climb;
    s.primed = true;
  }

  const a = s.yaw + s.swing;
  s.eyeX = target.x - Math.sin(a) * s.reach;
  s.eyeZ = target.z - Math.cos(a) * s.reach;
  s.eyeY = target.y + t.height + s.climb;
  s.lookX = target.x;
  s.lookY = target.y + t.lookUp;
  s.lookZ = target.z;
  return s;
}
