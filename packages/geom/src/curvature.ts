/**
 * ============================================================================
 *  curvature — how hard a closed curve is turning, binned and max-filtered.
 * ============================================================================
 *  Both racers this was extracted from build this table to decide what counts
 *  as a corner: the kart racer to gate its drift charge, the space racer to
 *  gate its slide ladder. Their two copies differed only in VALUES — the
 *  half-width of the max filter (the kart racer had `4` written into the loop,
 *  the space racer named it `CORNER_SMOOTH = 10` because 512 bins over 3,240 m
 *  is a very different metre-per-bin). The arithmetic was byte-identical.
 *
 *  IT DOES NOT KNOW WHAT A TRACK IS, and that is deliberate: a game's track
 *  type carries a racing line, sectors and a width profile, and a package that
 *  imports it has imported a game. The caller passes a `tangent` CALLBACK and a
 *  length. So this measures a closed space curve, which is a thing geometry
 *  knows about, and each game keeps its own corner-table wrapper holding the
 *  cache, the track and the thresholds.
 *
 *  THE PRECISION CHAIN IS PART OF THE BEHAVIOUR. Tangents accumulate in a
 *  Float64Array, the raw curvature lands in a Float32Array, and the filtered
 *  result is a second Float32Array. Both games did exactly that and the
 *  rounding at each step is visible in the answer, so the array types below are
 *  not an implementation detail to be tidied.
 * ============================================================================
 */

/** A point's unit tangent. Three numbers, so no vector library crosses here. */
export interface Tangent {
  x: number;
  y: number;
  z: number;
}

export interface CurvatureOpts {
  /** how many samples around the closed curve */
  bins: number;
  /** arc length of the whole curve, in metres */
  length: number;
  /** unit tangent at `u` in [0,1). Called `bins` times, at build time only. */
  tangent: (u: number) => Tangent;
  /**
   * Half-width of the max filter, in BINS — so its meaning in metres depends on
   * `length / bins` and the two games' values are not comparable as numbers.
   * The kart racer uses 4 (±12.5 m of its 1,600 m circuit); the space racer
   * uses 10, which at 512 bins over 3,240 m is ±63 m, or ±0.38 s of turn-in at
   * 165 m/s. Carrying the kart's 4 over unchanged would have made a corner
   * "start" a tenth of a second before the apex.
   */
  smooth: number;
}

/**
 * Curvature per bin around a closed curve, max-filtered over `±smooth` bins.
 *
 * `|a × b|` is sin(angle) between two unit tangents, which for the angles a
 * road or a deck turns through between adjacent samples IS the angle.
 * `acos(a·b)` would be the same number computed where acos is at its least
 * accurate.
 */
export function curvatureTable(o: CurvatureOpts): Float32Array {
  const n = o.bins;
  const tan = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = o.tangent(i / n);
    tan[i * 3] = s.x;
    tan[i * 3 + 1] = s.y;
    tan[i * 3 + 2] = s.z;
  }
  const ds = Math.max(1e-3, o.length / n);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = ((i + 1) % n) * 3;
    const i3 = i * 3;
    const cx = tan[i3 + 1]! * tan[j + 2]! - tan[i3 + 2]! * tan[j + 1]!;
    const cy = tan[i3 + 2]! * tan[j]! - tan[i3]! * tan[j + 2]!;
    const cz = tan[i3]! * tan[j + 1]! - tan[i3 + 1]! * tan[j]!;
    raw[i] = Math.sqrt(cx * cx + cy * cy + cz * cz) / ds;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -o.smooth; k <= o.smooth; k++) {
      const v = raw[(i + k + n) % n]!;
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}
