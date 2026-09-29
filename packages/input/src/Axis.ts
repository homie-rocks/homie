/**
 * ============================================================================
 *  Inventing an axis for a key, and folding an assist into one that exists.
 * ============================================================================
 *  Four functions, no state. The caller owns the value; these say what the next
 *  one is. That shape is deliberate — the two games this came from both keep
 *  the command on their own `InputState` and both write to it from three other
 *  places (an assist, a floor, a publish), and a class that also held it would
 *  have made "which copy is authoritative" a question somebody has to answer at
 *  two in the morning.
 *
 *  ---------------------------------------------------------------------------
 *  AN ANALOGUE SOURCE GOES STRAIGHT THROUGH. `through()` clamps and does
 *  nothing else, and that is the whole of it. A thumb on a touchscreen and a
 *  stick in a hand are already absolute positions — they ARE the command — and
 *  whatever the caller drives with it has its own rate limit further down.
 *  Putting a second rate limiter in front of one is how steering gets described
 *  as "mushy", and it cost an iteration in both games this came from: measured
 *  lock-to-lock on the keyboard was 215 ms *before the physics had seen
 *  anything*, spent twice over on two limiters in series.
 *
 *  ---------------------------------------------------------------------------
 *  A KEY IS NOT AN AXIS, so exactly one place invents one for it — `toward()` —
 *  and `back()` returns it to centre when nothing is asking.
 *
 *  FRAME-RATE INDEPENDENCE IS THE PROPERTY, and it is why every rate here is a
 *  LINEAR ramp integrated as `rate * dt` rather than an exponential smoother.
 *  Linear in dt is EXACT at any step size: 30, 60 and 120 fps produce the same
 *  trajectory in wall-clock terms. The obvious alternative,
 *  `x += (target - x) * min(1, dt * k)`, is a first-order approximation of an
 *  exponential and is NOT step-invariant — measured in the game it was removed
 *  from, 66.7 ms to 0.9 at 30 fps against 91.7 ms at 120 fps, and a hard snap
 *  below 24 fps where the factor clamps to 1. A phone that drops to 30 fps must
 *  not quietly get quicker steering than the same phone at 120 Hz. There is no
 *  exponential smoother in this file for that reason, and there must not be one.
 *
 *  `cross` is a SECOND, faster rate for the case where the request is on the
 *  far side of centre from where the command is — a counter-flick. It is not a
 *  refinement: without it, reversing costs the full travel from one lock to the
 *  other at the normal rate, which is the input feeling "late" at exactly the
 *  moment the player is correcting.
 *
 *  ---------------------------------------------------------------------------
 *  NO DEFAULTS. `AxisRates` is supplied by the caller. The two games that ship
 *  this happen to agree on all three numbers today, and that is not a reason to
 *  bake them in: the rates are a statement about how quickly a particular
 *  vehicle may be asked to turn, the vehicles are different, and a default here
 *  would make one of them inherit the other's answer silently the first time
 *  somebody retuned it.
 * ============================================================================
 */

export interface AxisRates {
  /** units/s toward the request while a direction is held */
  rate: number;
  /** units/s while the request is on the far side of centre — a counter-flick */
  cross: number;
  /** units/s back to centre when nothing is held */
  ret: number;
}

/** An absolute source, clamped to the rails and otherwise untouched. */
export function through(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** One frame of a digital request, rate-limited. `want` is -1, 0 or +1. */
export function toward(cur: number, want: number, dt: number, r: AxisRates): number {
  const crossing = cur !== 0 && Math.sign(want) !== Math.sign(cur);
  const step = (crossing ? r.cross : r.rate) * dt;
  const delta = want - cur;
  return cur + (delta < -step ? -step : delta > step ? step : delta);
}

/** One frame with nothing asking: back toward centre, and land ON it. */
export function back(cur: number, dt: number, r: AxisRates): number {
  const d = r.ret * dt;
  return Math.abs(cur) <= d ? 0 : cur - Math.sign(cur) * d;
}

/**
 * Add a correction to a command WITHOUT ever taking the command away.
 *
 * The rule, and it is the whole function: an assist may add to what the player
 * asked for, and it may pull them back toward where it thinks they should be,
 * but it may NOT push the command through centre and command the other way. A
 * player who asked to go right and went left because of an assist has been
 * driven rather than helped, and it is not a feeling anybody misreads.
 *
 * So a correction that would cross centre lands the command exactly ON centre
 * instead. The result is clamped to the rails afterwards, in that order: an
 * assist that would have crossed cannot arrive at a rail by way of the clamp.
 */
export function fold(cmd: number, delta: number): number {
  const out = cmd + delta;
  return cmd !== 0 && Math.sign(out) !== Math.sign(cmd)
    ? 0
    : out < -1 ? -1 : out > 1 ? 1 : out;
}
