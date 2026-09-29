/**
 * ============================================================================
 *  strideSegments — walk a span at a spacing and hand back each chord.
 * ============================================================================
 *
 *  Anything laid ALONG something: a track sweep across a heightfield, a line of
 *  posts down a verge, a cable, a hedge. The rule is arc-length stepping with
 *  a whole number of equal chords, and the reason it is not a `for (t += dt)`
 *  loop is that the two ends must land exactly on the two ends.
 *
 *  ── WHAT THIS IS FOR, IN ONE FAILURE ───────────────────────────────────────
 *
 *  A base-building game recorded a rigid 240 m span placed from a single
 *  sampled frame that left the surface by 36.8 m at BOTH ends, error growing
 *  quadratically from the anchor. A 90 m rover track laid as one quad from one
 *  ground probe is the same bug at a smaller scale, and on a cratered surface
 *  it submerges and surfaces repeatedly along its length. The fix is not a
 *  better probe, it is more chords — which makes the stepping rule the thing
 *  worth having once.
 *
 *  ── THE THREE PROPERTIES, AND WHY EACH IS NOT A DETAIL ─────────────────────
 *
 *  1. `ceil`, NOT `round`. The spacing is a MAXIMUM chord length — the length
 *     past which the chord leaves the surface — so rounding down is a chord
 *     longer than the caller said was safe. `Math.max(1, ...)` then guarantees
 *     at least one chord, so a span shorter than the spacing is still laid.
 *  2. THE FAR END IS COMPUTED, THE NEAR END IS CARRIED. Segment i's start is
 *     segment i-1's end, passed through unchanged rather than recomputed from
 *     `i / n`. Recomputing gives the identical double for every interior joint
 *     — `s0 = i / n` is character for character the previous `s1 = (i - 1 + 1) / n`
 *     — but NOT for the first, where `x0 + (x1 - x0) * 0` is `x0 + ±0` and
 *     turns a `-0` start coordinate into `0`. Carrying is both simpler and the
 *     only form that is exact, and the caller usually wants it anyway because
 *     it has already probed that joint.
 *  3. `len < minLength` AND NOT `!(len >= minLength)`. They differ on NaN, and
 *     the game this came from proceeds on NaN rather than returning. Keeping the
 *     comparison in the original direction is the difference between adopting
 *     a helper and changing behaviour while claiming not to.
 *
 *  Mechanism: the chord count, the parameterisation, the carry. Content: the
 *  spacing and the minimum length. A 2.5 m step is what a 2 m heightfield can
 *  carry; another world's is another world's.
 *
 *  Imports nothing, including three.
 */

/**
 * Step from (x0, z0) to (x1, z1) in equal chords no longer than `step`, calling
 * `cb` once per chord.
 *
 * @param minLength spans shorter than this lay nothing and return 0
 * @returns the number of chords emitted
 */
export function strideSegments(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  step: number,
  minLength: number,
  cb: (ax: number, az: number, bx: number, bz: number, i: number, n: number) => void,
): number {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < minLength) return 0;
  const n = Math.max(1, Math.ceil(len / step));
  let ax = x0;
  let az = z0;
  for (let i = 0; i < n; i++) {
    const s1 = (i + 1) / n;
    const bx = x0 + (x1 - x0) * s1;
    const bz = z0 + (z1 - z0) * s1;
    cb(ax, az, bx, bz, i, n);
    ax = bx;
    az = bz;
  }
  return n;
}

/**
 * Step OUTWARD from `d0` until a predicate first turns true, and hand back
 * where it did.
 *
 * The other half of the same rule, for the other axis. Finding a shoreline, a
 * cliff edge, the far side of a hedge, the first clear metre off a wall or the
 * point at which a slope becomes unwalkable is all this: a coarse linear scan
 * with the caller's own test, not a bisection, because the field being
 * probed is usually neither monotone nor cheap and a bisection on a
 * non-monotone field silently finds the wrong crossing.
 *
 * `step` is therefore the resolution of the answer AND the size of the feature
 * that can be missed. It is the caller's, as is the back-off it applies to the
 * result: the crossing is between `d - step` and `d`, and which end of that a
 * caller wants depends on whether it is placing something ON the boundary or
 * clear of it.
 *
 * `d < d1` and not `!(d >= d1)` — they differ on NaN, and the games this came
 * out of stop rather than loop when a probe goes bad.
 *
 * @returns the first `d` at which `pred` was true, or NaN if it never was.
 */
export function firstCrossing(
  d0: number,
  d1: number,
  step: number,
  pred: (d: number) => boolean,
): number {
  for (let d = d0; d < d1; d += step) if (pred(d)) return d;
  return NaN;
}
