/**
 * ============================================================================
 *  Corridor — a keep-out along a polyline, not around its sample points.
 * ============================================================================
 *
 *  A road, a rail, a pipe run, a shoreline: a thing that is LONG. The keep-out
 *  around it is a capsule chain, and the distance that matters is to the
 *  SEGMENT, not to the nearest authored sample point.
 *
 *  ── WHY THAT DISTINCTION IS THE WHOLE FILE ─────────────────────────────────
 *
 *  Testing sample points is the obvious implementation and it is wrong in a way
 *  that renders perfectly. One game's boulevard is 28 chords across ~400 m, so
 *  the samples are ~14 m apart; a point-only test leaves a lens-shaped gap
 *  between every consecutive pair, sagging to about 2.4 m of clearance at the
 *  chord midpoint for a 21.65 m keep radius. A 6 m boulder fits through it. It
 *  does not fit through it OFTEN — a few placements in tens of thousands — so
 *  the failure is one rock standing in the middle of the road in one capture
 *  out of ten, which reads as a content mistake and gets "fixed" by moving the
 *  rock. The game's own comment named this: *"Segment distance, not
 *  sample-point distance — a 14 m chord would otherwise leave gaps a 6 m rock
 *  fits through."* A parity test injects that defect as a fault, and it fails
 *  the corridor check alone.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *    · MECHANISM — the projection onto each segment, the clamp of the
 *      parameter to [0, 1] that turns an infinite line into a capsule, the
 *      degenerate-segment guard, and the squared comparison.
 *    · CONTENT — the polyline itself and the keep radius. Where a road goes and
 *      how wide its batter is are the world's business, and this class is
 *      handed both.
 *
 *  ── THE DEGENERATE GUARD, AND WHAT IT PROVABLY DOES NOT BUY ────────────────
 *
 *  `ab2 > 1e-8` rather than `ab2 > 0`. A polyline sampled from a parametric
 *  curve routinely repeats a point (a closed loop's last sample, a cusp), and
 *  an ungarded `0 / 0` is NaN, and NaN fails every comparison — so an
 *  unguarded degenerate chord protects nothing rather than throwing.
 *
 *  BUT `> 0` WOULD BE ENOUGH FOR AN EXACT DUPLICATE, AND THAT IS MEASURED
 *  RATHER THAN ARGUED. The parity test runs a polyline with a duplicated point
 *  in it, and a fault that relaxed this to `> 0` came back GREEN, twice over:
 *  `ab2` is exactly `0`, so both forms take the `t = 0` branch and no NaN is
 *  ever produced — and a degenerate chord in a CHAIN is a point its two
 *  neighbours already cover, so even a chord that protected nothing would not
 *  move the predicate. The fault was withdrawn and the reasoning is written
 *  here so nobody re-derives it.
 *
 *  So the `1e-8` is insurance for the two cases that are NOT that: a two-point
 *  polyline of identical points, which has no neighbour to cover it, and a
 *  NEARLY duplicated point, where `> 0` divides by ~1e-12 and lands `t` at a
 *  clamp rather than where the geometry is. 1e-8 m² is a tenth of a millimetre
 *  of chord, which no world authors on purpose. It is a fixed value, not a
 *  parameter, because a caller choosing it is a caller who has to know what it
 *  is for.
 *
 *  Imports nothing, including three: it takes two arrays of numbers.
 */

/**
 * A capsule chain around a polyline in the XZ plane.
 *
 * The segment deltas are precomputed into `Float64Array`s in the constructor
 * rather than recomputed per query. That is exact, not merely close: a
 * `Float64Array` holds the double the subtraction produced, so
 * `xs[i + 1] - xs[i]` computed once at build time is bit-for-bit the value the
 * per-query form would have produced, whatever width the caller's points are.
 *
 * A `Float32Array` cache would NOT be, and the size of that mistake DEPENDS ON
 * THE CALLER, which is the part worth knowing. Measured on the parity test's
 * road: with `Float32Array` points in, the difference of two of them is exactly
 * representable at single precision in 27 of 29 chords, so an f32 cache is very
 * nearly invisible — an injected f32 cache passed the test's first run for
 * exactly that reason. With `Float64Array` points in it is wrong in ALL 29.
 * The game this came from happens to hand in a `Float32Array`; a class that
 * quietly depended on that would be right for one caller and silently wrong
 * for the next, so the test runs over both widths and the fault fails against
 * the second.
 */
export class Corridor {
  private readonly ax: Float64Array;
  private readonly az: Float64Array;
  private readonly bx: Float64Array;
  private readonly bz: Float64Array;
  private readonly ab2: Float64Array;

  /** Number of segments. One less than the number of points. */
  readonly segments: number;

  /**
   * @param xs   point x, in order along the corridor
   * @param zs   point z, same length
   * @param keep base keep-out radius in metres, before any per-query pad
   */
  constructor(xs: ArrayLike<number>, zs: ArrayLike<number>, readonly keep: number) {
    const n = Math.min(xs.length, zs.length);
    // A single point has no segment and protects nothing. That is a caller
    // mistake worth failing loudly on rather than a corridor that is quietly
    // never blocked — the shape where a plausible default answers for a fact
    // nobody has.
    if (n < 2) throw new Error(`Corridor needs at least 2 points, got ${n}`);
    this.segments = n - 1;
    this.ax = new Float64Array(this.segments);
    this.az = new Float64Array(this.segments);
    this.bx = new Float64Array(this.segments);
    this.bz = new Float64Array(this.segments);
    this.ab2 = new Float64Array(this.segments);
    for (let i = 0; i < this.segments; i++) {
      const ax = xs[i]!;
      const az = zs[i]!;
      const bx = xs[i + 1]! - ax;
      const bz = zs[i + 1]! - az;
      this.ax[i] = ax;
      this.az[i] = az;
      this.bx[i] = bx;
      this.bz[i] = bz;
      this.ab2[i] = bx * bx + bz * bz;
    }
  }

  /** True when (x, z) is within `keep + pad` of any segment of the corridor. */
  blocked(x: number, z: number, pad = 0): boolean {
    const keep2 = (this.keep + pad) * (this.keep + pad);
    for (let i = 0; i < this.segments; i++) {
      const ax = this.ax[i]!;
      const az = this.az[i]!;
      const bx = this.bx[i]!;
      const bz = this.bz[i]!;
      const ab2 = this.ab2[i]!;
      let t = ab2 > 1e-8 ? ((x - ax) * bx + (z - az) * bz) / ab2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = x - (ax + bx * t);
      const dz = z - (az + bz * t);
      if (dx * dx + dz * dz < keep2) return true;
    }
    return false;
  }

  /** The other polarity, for the same reason `KeepOut.clear` exists. */
  clear(x: number, z: number, pad = 0): boolean {
    return !this.blocked(x, z, pad);
  }
}
