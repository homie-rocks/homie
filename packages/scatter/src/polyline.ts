/**
 * ============================================================================
 *  Polyline — where a route is at t, and which way it is going.
 * ============================================================================
 *
 *  `corridor.ts` already takes a polyline and answers "am I too close to it".
 *  This is the other question every game with a route asks: sample it. A camera
 *  aimed down a road, a bot walking a path, a prop placed a third of the way
 *  along a pier, a marker at the junction — all of them are "give me the point
 *  at normalised t" and "give me the direction there".
 *
 *  ── WHY THIS IS THREE FUNCTIONS AND NOT ONE ────────────────────────────────
 *
 *  Because the index arithmetic is what gets copied. The four lines that turn a
 *  normalised t into a segment index and a fraction —
 *
 *      const s = clamp(t, 0, 1) * (poly.length - 1);
 *      const i = Math.min(poly.length - 2, Math.floor(s));
 *      const f = s - i;
 *
 *  — were written FOUR TIMES in one file of one game before this existed, once
 *  per road and once per question, and the `min` that keeps t = 1 inside the
 *  last segment rather than indexing off the end is exactly the sort of thing
 *  that is right in three of four copies. `segmentAt` is published so a caller
 *  with its own per-vertex payload can do the lookup once and read whatever it
 *  likes at `i` and `i + 1`.
 *
 *  ── PARAMETER, NOT ARC LENGTH, AND THAT IS A CHOICE ────────────────────────
 *
 *  `t` is uniform in SEGMENT INDEX, not in distance: t = 0.5 on a four-point
 *  polyline is the midpoint of segment two whatever the segments measure. That
 *  is what a hand-authored route wants — the author placed the vertices where
 *  the interesting places are — and it is NOT what a bot at constant speed
 *  wants. A caller that needs constant speed walks `stride.ts` instead, which
 *  is arc-length by construction. Two different questions; naming the
 *  difference here is cheaper than a bot that speeds up on the long straight.
 *
 *  Numbers in, numbers out, no `three`: the caller writes its own vectors, the
 *  same line every other file in this package holds.
 * ============================================================================
 */

/** A route in some 2-D frame. The frame is the caller's business. */
export type Poly2 = readonly (readonly [number, number])[];

/** Which segment `t` lands in, and how far along it. */
export interface Segment {
  /** Index of the segment's first vertex. Always in [0, poly.length - 2]. */
  i: number;
  /** Fraction along that segment, in [0, 1]. */
  f: number;
}

/** Somewhere to write a 2-D result, so nothing here allocates. */
export interface Vec2Out {
  u: number;
  v: number;
}

/**
 * Segment index and fraction for `t` in 0..1, clamped at both ends.
 *
 * At t = 1 this reports the LAST segment at f = 1 rather than an index off the
 * end, which is the whole reason it is a function.
 */
export function segmentAt(poly: Poly2, t: number, out: Segment): Segment {
  const n = poly.length - 1;
  const s = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(s));
  out.i = i;
  out.f = s - i;
  return out;
}

/** The point at `t`, linearly interpolated within its segment. */
export function polylinePoint(poly: Poly2, t: number, out: Vec2Out): Vec2Out {
  const n = poly.length - 1;
  const s = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(s));
  const f = s - i;
  const a = poly[i] as readonly [number, number];
  const b = poly[i + 1] as readonly [number, number];
  out.u = a[0] + (b[0] - a[0]) * f;
  out.v = a[1] + (b[1] - a[1]) * f;
  return out;
}

/**
 * The LOCAL direction at `t` — the whole segment's delta, unnormalised.
 *
 * Unnormalised because the two things callers do with it are `atan2`, which
 * does not care, and a rotation into a world frame, which is linear. Dividing
 * by a length here would cost every caller a square root and change the last
 * bit of every bearing.
 */
export function polylineDelta(poly: Poly2, t: number, out: Vec2Out): Vec2Out {
  const n = poly.length - 1;
  const s = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(s));
  const a = poly[i] as readonly [number, number];
  const b = poly[i + 1] as readonly [number, number];
  out.u = b[0] - a[0];
  out.v = b[1] - a[1];
  return out;
}
