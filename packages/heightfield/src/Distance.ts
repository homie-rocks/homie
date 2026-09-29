/**
 * ============================================================================
 *  Distance.ts — how far is this cell from the nearest cell that is something,
 *  and what was standing there.
 * ============================================================================
 *
 *  Two passes over a square grid, both of them the kind of thing a world
 *  re-implements the third time it needs a coast, a blast radius or a fade to
 *  the edge of a mask, and neither of them knowing what the mask MEANS.
 *
 *   · `dilateMax` — separable max over a (2r+1) square. "What is the tallest
 *     thing within r cells of here." The separability is the whole point: a
 *     7x7 max is 14 comparisons per cell, not 49.
 *   · `chamferSweep` — a two-pass 3-4 chamfer distance transform that CARRIES
 *     AN ATTRIBUTE from the nearest seed along with the distance.
 *
 *  ── WHY THE CARRY, WHICH IS THE ONLY UNUSUAL THING HERE ────────────────────
 *
 *  A plain distance transform answers "how far to the shore". That is not
 *  enough to shade one: 24 m of water off a beach and 24 m of water at the
 *  foot of a cliff are the same distance and want completely different
 *  pictures. The question that separates them is "how far, AND how tall is the
 *  land at the place that is nearest" — so the relaxation propagates a second
 *  float in lockstep with the first, and a cell that adopts a shorter distance
 *  adopts its donor's attribute in the same statement. It costs one array.
 *
 *  ── FOUR THINGS THAT ARE NOT DETAILS ───────────────────────────────────────
 *
 *  1. `D2 = cell * Math.SQRT2`, NOT the integer 3-4 weights the algorithm is
 *     named for. 3-4 is a fixed-point approximation for grids that count in
 *     cells; this returns METRES, so the diagonal step is the true sqrt(2) and
 *     the field is a distance rather than a distance-shaped number.
 *  2. `if (dist[c] === 0) continue` SKIPS SEEDS, and it is an identity test on
 *     zero rather than a threshold. A seed must never be relaxed away by a
 *     neighbour, and `< epsilon` would eat a cell one millimetre outside the
 *     mask that legitimately holds a tiny distance.
 *  3. THE BACKWARD SWEEP ITERATES `j` AND `i` BOTH DESCENDING. Reversing only
 *     one axis is a transform that is correct along one diagonal and wrong
 *     along the other, and the error is a smooth gradient — it renders as a
 *     plausible field and is invisible without a reference.
 *  4. THE CALLER SEEDS. `dist` arrives with 0 at every seed and a large value
 *     everywhere else, `carry` arrives with the seed's attribute. What counts
 *     as a seed, what the attribute means and how big "large" is are the
 *     world's business — a threshold in metres above a datum is content, and
 *     this file must not learn a datum.
 *
 *  Pure arithmetic over Float32Array. Imports nothing, including three, so a
 *  Node harness can compare a field against a pinned one with no renderer.
 * ============================================================================
 */

/**
 * The value `chamferSweep` treats as "not reached yet". Any unseeded cell must
 * hold something at least this large, and it is exported so a caller and the
 * transform cannot disagree about it — a fill of 1e6 against a grid whose true
 * diagonal exceeds it silently freezes those cells at the fill.
 */
export const CHAMFER_FAR = 1e9;

/**
 * Separable max over a (2 * radius + 1) square, into `out`.
 *
 * `tmp` is the caller's scratch and must be `n * n`; it holds the horizontal
 * pass. Clamped at the borders — the max over a truncated window, not a
 * wrapped or mirrored one, because a heightfield's edge is an edge.
 */
export function dilateMax(
  src: Float32Array, out: Float32Array, n: number, radius: number, tmp: Float32Array,
): void {
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let m = -1e9;
      for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) m = Math.max(m, src[j * n + k]!);
      tmp[j * n + i] = m;
    }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let m = -1e9;
      for (let k = Math.max(0, j - radius); k <= Math.min(n - 1, j + radius); k++) m = Math.max(m, tmp[k * n + i]!);
      out[j * n + i] = m;
    }
}

/**
 * Two-pass 3-4 chamfer distance transform, in metres, carrying `carry` from
 * the nearest seed.
 *
 * Both arrays are edited in place and must be `n * n`. Seeds are the cells
 * where `dist` is exactly 0; everything else must hold `CHAMFER_FAR` (or more).
 * `cell` is the grid pitch in metres.
 */
export function chamferSweep(
  dist: Float32Array, carry: Float32Array, n: number, cell: number,
): void {
  const D1 = cell, D2 = cell * Math.SQRT2;
  const relax = (c: number, from: number, w: number) => {
    const d = dist[from]! + w;
    if (d < dist[c]!) { dist[c] = d; carry[c] = carry[from]!; }
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if (dist[c] === 0) continue;
      if (i > 0) relax(c, c - 1, D1);
      if (j > 0) {
        relax(c, c - n, D1);
        if (i > 0) relax(c, c - n - 1, D2);
        if (i < n - 1) relax(c, c - n + 1, D2);
      }
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const c = j * n + i;
      if (dist[c] === 0) continue;
      if (i < n - 1) relax(c, c + 1, D1);
      if (j < n - 1) {
        relax(c, c + n, D1);
        if (i < n - 1) relax(c, c + n + 1, D2);
        if (i > 0) relax(c, c + n - 1, D2);
      }
    }
  }
}
