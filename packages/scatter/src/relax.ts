/**
 * ============================================================================
 *  relaxOverlap — push bodies apart until they stop occupying each other.
 * ============================================================================
 *
 *  `keepout.ts` REFUSES a spot that is already taken; this is the other half,
 *  for the case where refusing is not available. A crowd walks. Two figures
 *  each heading somewhere reasonable arrive at the same square metre, and the
 *  reader's eye finds two bodies interpenetrating faster than it finds almost
 *  anything else in a frame — it is the one artefact that makes a population
 *  read as sprites rather than as people.
 *
 *  ── WHY IT IS PAIRWISE AND WHY THAT IS NOT A BUG ───────────────────────────
 *
 *  O(n²) with a tiny constant beats a spatial hash for the counts a crowd
 *  actually runs at — a hundred and fifty bodies is eleven thousand distance
 *  tests of eight flops each, once per frame, against a grid that has to be
 *  rebuilt every frame because everything in it moved. The crossover is a long
 *  way above any population that fits in one draw call. A caller with ten
 *  thousand agents wants `discindex.ts`, and should say so.
 *
 *  ── THE SPLIT, AND WHY 0.5 IS BAKED AND THE DAMPING IS NOT ─────────────────
 *
 *  Each of the two bodies moves half the overlap. That is the mechanism: it is
 *  what makes the pass symmetric, so the result does not depend on which of
 *  the two the caller happened to store first. The DAMPING is the caller's,
 *  because it is a frame-rate policy — `min(1, dt * k)` resolves an overlap
 *  over a fixed wall-clock time rather than a fixed number of frames, and what
 *  `k` should be depends on how fast the caller's bodies move.
 *
 *  ── ONE PASS, NOT A SOLVER ─────────────────────────────────────────────────
 *
 *  A single relaxation sweep per frame, not iterated to convergence. A crowd
 *  is not a rigid-body simulation and does not want to be: a knot of six
 *  people easing apart over a third of a second is what a knot of six people
 *  does, and a solver that separates them within one frame produces a visible
 *  pop. The damping is therefore load-bearing rather than a stability guard.
 *
 *  Accessors rather than an array of vectors, so this never sees a coordinate
 *  layout and never allocates. Imports nothing, including three.
 * ============================================================================
 */

/**
 * One symmetric separation sweep over `n` bodies.
 *
 * @param n      how many.
 * @param x,z    read body i's position on the ground plane.
 * @param push   move body i by this much. Called twice per overlapping pair,
 *               with equal and opposite deltas.
 * @param radius bodies closer together than this are overlapping.
 * @param damp   fraction of the correction to apply this sweep, in (0, 1].
 *               `Math.min(1, dt * k)` at every caller so far.
 */
export function relaxOverlap(
  n: number,
  x: (i: number) => number,
  z: (i: number) => number,
  push: (i: number, dx: number, dz: number) => void,
  radius: number,
  damp: number,
): void {
  const R2 = radius * radius;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // `i`'s position is re-read on EVERY pair and not hoisted out of the
      // inner loop, because the previous pair may have moved it. Hoisting is
      // the obvious tidy-up and it changes the answer: a body caught between
      // two others would be pushed off a stale position twice and end up on
      // the far side of one of them.
      const dx = x(j) - x(i);
      const dz = z(j) - z(i);
      const d2 = dx * dx + dz * dz;
      // `d2 < 1e-6` and not a zero test: two bodies at EXACTLY the same point
      // have no separation direction, and normalising by `d` there produces a
      // NaN that propagates into a position and never comes back out. Leaving
      // them coincident for one frame is survivable; a NaN is not.
      if (d2 > R2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const p = (radius - d) * 0.5 * damp;
      const nx = dx / d, nz = dz / d;
      push(i, -(nx * p), -(nz * p));
      push(j, nx * p, nz * p);
    }
  }
}
