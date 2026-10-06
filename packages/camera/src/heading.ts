/**
 * ============================================================================
 *  The one heading this package means, and the adapter from any other.
 * ============================================================================
 *
 *  **YAW 0 FACES +Z. POSITIVE YAW TURNS TOWARD +X. RADIANS.**
 *
 *      forward = (sin yaw, cos yaw) in (x, z)        yaw = atan2(forward.x, forward.z)
 *
 *  Seen from above, +Y toward you (the way three.js draws a top view):
 *
 *                       -Z   yaw = PI
 *                        |
 *      yaw = -PI/2  -X --+-- +X  yaw = +PI/2
 *                        |
 *                       +Z   yaw = 0
 *
 *  A positive yaw turns the subject to its own LEFT, counter-clockwise in that
 *  picture. It is what `Object3D.rotation.y` means for a model built facing
 *  +Z, and it is the yaw every module here reads and writes: `FollowTarget.yaw`
 *  and `FollowState.yaw` in `follow.ts`, `armYaw`, `faceYaw` and `lagYaw` in
 *  `bearing.ts`, `rig.ts` and `chase.ts`.
 *
 *  **A GAME THAT MEASURES ITS HEADING ANY OTHER WAY MUST CONVERT, AND NOTHING
 *  WILL STOP IT IF IT DOES NOT.** An angle is a bare number. Hand a follow
 *  camera an angle measured from +X and it does not throw: it sits beside the
 *  subject, or in front of it, and looks perfectly healthy in every log. Two
 *  things here exist for that:
 *
 *   - {@link headingFrom} turns "my angle 0 faces this axis and grows toward
 *     that one" into a function from the game's angle to this package's yaw,
 *     with `.back` for the other direction. {@link headingOfVector} is the
 *     same for a game that has a forward vector and no angle.
 *
 *   - {@link stepHeadingWatch} is the check `follow.ts` runs in development:
 *     a subject that keeps travelling one way while its heading says another
 *     is the signature of a wrong convention, and it says so once.
 *
 *  No three, no renderer, no clock, no allocation per frame.
 * ============================================================================
 */
import { wrapAngle } from './spring.ts';

/** A ground axis of the world, as three.js names them. +Y is up. */
export type HeadingAxis = '+x' | '-x' | '+z' | '-z';

/** How a game measures its own heading. Say `toward` or `turn`, not both. */
export interface HeadingConvention {
  /** The axis the subject faces when the game's angle is 0. */
  readonly zero: HeadingAxis;
  /**
   * The axis the subject faces a quarter turn later, when the angle is +90
   * degrees. The form that cannot be misread: a game whose angle is
   * `Math.atan2(vz, vx)` is `{ zero: '+x', toward: '+z' }`.
   */
  readonly toward?: HeadingAxis;
  /**
   * The same thing said as a rotation, seen from above with +Y toward you:
   * `'ccw'` when a growing angle turns the subject to its own left (three.js's
   * `rotation.y`), `'cw'` when it turns it to its own right.
   */
  readonly turn?: 'cw' | 'ccw';
  /** True when the game's angle is in degrees. This package's yaw is always radians. */
  readonly degrees?: boolean;
}

/** The game's angle in, this package's yaw out (radians, wrapped to +-PI). */
export interface HeadingAdapter {
  (angle: number): number;
  /** This package's yaw in, the game's angle out, in the game's unit, wrapped to half a turn either side of 0. */
  back(yaw: number): number;
}

const AXIS_YAW: Readonly<Record<HeadingAxis, number>> = {
  '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2,
};

function axisYaw(axis: HeadingAxis, field: string): number {
  const yaw = AXIS_YAW[axis];
  if (typeof yaw !== 'number') {
    throw new TypeError(`headingFrom: ${field} must be '+x', '-x', '+z' or '-z', not ${JSON.stringify(axis)}`);
  }
  return yaw;
}

/**
 * The adapter from a game's heading to this package's yaw.
 *
 *     const toYaw = headingFrom({ zero: '+x', toward: '+z' });
 *     stepFollow(rig, tuning, { ...p, yaw: toYaw(p.angle) }, field, dt);
 *
 * Make it once, outside the frame loop. A convention that does not make sense
 * (an unknown axis, `toward` not a quarter turn from `zero`, `toward` and
 * `turn` disagreeing, neither given) throws here, when the game starts, rather
 * than producing a camera that is quietly wrong.
 */
export function headingFrom(c: HeadingConvention): HeadingAdapter {
  const zero = axisYaw(c.zero, 'zero');
  let sign = 0;
  if (c.toward !== undefined) {
    const quarter = wrapAngle(axisYaw(c.toward, 'toward') - zero);
    if (Math.abs(Math.abs(quarter) - Math.PI / 2) > 1e-9) {
      throw new TypeError(`headingFrom: toward ('${c.toward}') must be a quarter turn from zero ('${c.zero}')`);
    }
    sign = quarter > 0 ? 1 : -1;
  }
  if (c.turn !== undefined) {
    if (c.turn !== 'cw' && c.turn !== 'ccw') {
      throw new TypeError(`headingFrom: turn must be 'cw' or 'ccw', not ${JSON.stringify(c.turn)}`);
    }
    const turn = c.turn === 'ccw' ? 1 : -1;
    if (sign !== 0 && sign !== turn) {
      throw new TypeError(`headingFrom: turn '${c.turn}' disagrees with zero '${c.zero}' toward '${c.toward}'`);
    }
    sign = turn;
  }
  if (sign === 0) {
    throw new TypeError("headingFrom: say which way the angle grows, with toward (an axis) or turn ('cw' or 'ccw')");
  }
  const unit = c.degrees ? Math.PI / 180 : 1;
  const adapt = ((angle: number) => wrapAngle(zero + sign * angle * unit)) as HeadingAdapter;
  adapt.back = (yaw: number) => wrapAngle(sign * (yaw - zero)) / unit;
  return adapt;
}

/**
 * This package's yaw for a forward (or velocity) vector on the ground: the
 * world x and z of where the subject points. It need not be unit length.
 */
export function headingOfVector(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** The unit forward vector of a yaw, written into `out` as `x` and `z`. */
export function vectorOfHeading<T extends { x: number; z: number }>(yaw: number, out: T): T {
  out.x = Math.sin(yaw);
  out.z = Math.cos(yaw);
  return out;
}

// ---------------------------------------------------------------------------
//  The development check
// ---------------------------------------------------------------------------

/**
 * The thresholds of the check. Diagnostics, not feel: they decide when a
 * warning is printed and never where a lens goes.
 *
 * `off` is a sixth of a turn, not a quarter, on purpose. The commonest wrong
 * convention (an angle measured from +X fed in as it stands) is off by EXACTLY
 * a quarter turn in every direction, and a threshold of "more than 90 degrees"
 * would never see it.
 */
export interface HeadingWatchLimits {
  /** Slower than this, metres per second, the subject is not going anywhere worth reading. */
  readonly minSpeed: number;
  /** Radians between travel and heading that count as disagreeing. */
  readonly off: number;
  /** Seconds of unbroken disagreement, while moving, before it warns. */
  readonly seconds: number;
  /** Seconds of agreeing travel after which the check retires for good. */
  readonly retire: number;
}

export const HEADING_WATCH_LIMITS: HeadingWatchLimits = Object.freeze({
  minSpeed: 0.5, off: Math.PI / 3, seconds: 1, retire: 30,
});

/** The check's state. Make one with {@link headingWatch}. */
export interface HeadingWatch {
  /** Where the subject was last frame. */
  px: number;
  pz: number;
  /** False until there is a last frame to measure from. */
  has: boolean;
  /** Seconds of unbroken disagreement, and of agreeing travel in total. */
  bad: number;
  good: number;
  /** True once it has warned or retired. Nothing is computed after that. */
  done: boolean;
  /** Where the one warning goes. */
  warn: (message: string) => void;
}

export function headingWatch(warn: (message: string) => void): HeadingWatch {
  return { px: 0, pz: 0, has: false, bad: 0, good: 0, done: false, warn };
}

/** The next step has no last frame: call it on a teleport, or while the check should not look. */
export function restHeadingWatch(w: HeadingWatch): void {
  w.has = false;
}

const deg = (rad: number): string => `${Math.round((rad * 180) / Math.PI)}`;

/**
 * One frame of the check: does the heading agree with where the subject went?
 *
 * Travel is measured from the positions handed in, so it needs nothing the
 * camera was not already given. While the subject moves faster than
 * `minSpeed` and its `yaw` is more than `off` away from its direction of
 * travel, a clock runs; any agreeing frame resets it; standing still holds
 * it. At `seconds` it calls `warn` once and is finished. After `retire`
 * seconds of agreeing travel it is also finished, so a game that got it right
 * stops paying for the check half a minute in. Returns true on the frame it
 * warns.
 *
 * It cannot tell a wrong convention from a subject that really does move
 * against its heading: a vehicle in reverse, a character strafing or
 * backpedalling. Those are the caller's to exclude, by not stepping it on
 * those frames ({@link restHeadingWatch}) or by not having one at all.
 */
export function stepHeadingWatch(
  w: HeadingWatch, x: number, z: number, yaw: number, dt: number,
  limits: HeadingWatchLimits = HEADING_WATCH_LIMITS,
): boolean {
  if (w.done) return false;
  const dx = x - w.px, dz = z - w.pz;
  const had = w.has;
  w.px = x; w.pz = z; w.has = true;
  if (!had || !(dt > 0)) return false;
  const step = Math.hypot(dx, dz);
  if (!(step > limits.minSpeed * dt)) return false;
  const travel = Math.atan2(dx, dz);
  const off = wrapAngle(travel - yaw);
  if (Math.abs(off) <= limits.off) {
    w.bad = 0;
    w.good += dt;
    if (w.good >= limits.retire) w.done = true;
    return false;
  }
  w.bad += dt;
  if (w.bad < limits.seconds) return false;
  w.done = true;
  w.warn(
    `[camera] the heading does not match the motion: for ${limits.seconds} s the subject travelled toward yaw `
    + `${deg(travel)} deg while the yaw handed in said ${deg(yaw)} deg (${deg(off)} deg apart). `
    + 'This camera reads yaw 0 as facing +Z and a positive yaw as turning toward +X, in radians: '
    + 'forward = (sin yaw, cos yaw) in (x, z). If the game measures its heading another way, convert it with '
    + "headingFrom({ zero, toward }) or headingOfVector(dx, dz) from '@homie-rocks/camera/heading.js'. "
    + 'If the subject really does move against its heading (reversing, strafing), set `reversing: true` on the '
    + 'target for those frames or make the rig with followState({ headingCheck: false }). Said once.',
  );
  return true;
}

declare const process: { env: Record<string, string | undefined> };

/**
 * Is this a production build? A bundler replaces `process.env.NODE_ENV` with a
 * string, so the check and its message fall out of a production bundle; Node
 * reads the real variable; and a page with no bundler has no `process`, which
 * lands in the catch and counts as development.
 */
export function isProductionBuild(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}
