/**
 * ============================================================================
 *  footprintLow — found a thing on the LOWEST ground it stands on.
 * ============================================================================
 *
 *  A pad, a plinth, a slab, a foot. Founding it on the height at its CENTRE is
 *  the obvious thing and it floats the whole object on the high side of any
 *  slope: the centre is by definition halfway up, so half the footprint is
 *  below it and hangs in the air. That bug was found on a 272 m road in a
 *  base-building game, and "nothing floats" is an automatic fail in several of
 *  the art directions this was written for.
 *
 *  This is placement POLICY and it is mechanism throughout: sample the ground
 *  at the centre and at `n` points evenly around a ring of radius `r`, take the
 *  minimum. Every number a caller passes is content — how big the footprint is,
 *  how many taps it is worth, and what "the ground" means.
 *
 *  ── WHY A RING AND NOT A DISC, AND WHY THE MINIMUM ─────────────────────────
 *
 *  The lowest point of a footprint on any surface without an interior pit is on
 *  its BOUNDARY, so a ring plus the centre is the cheap correct sample set and
 *  a disc of taps buys nothing. The minimum rather than the mean because the
 *  question is "where can this be founded without any part of it hanging", and
 *  a mean founds it in the air over the low side just as surely as the centre
 *  does — less far, which is worse, because it looks nearly right.
 *
 *  ── THE HEIGHT CALLBACK IS THE GAME'S, AND SO IS ITS NaN POLICY ────────────
 *
 *  `h` is passed in rather than a field being handed over, and the reason is
 *  the plausible-default trap: a world that returns a non-finite height for an
 *  unloaded chunk has a POLICY about that — one game substitutes 0 and says so
 *  at its own call site — and a package that quietly applied its own would be a
 *  plausible default answering for a fact it does not have. `Math.min` over a
 *  NaN is NaN, this function's `s < y` comparison lets a NaN through unchanged,
 *  and both behaviours belong to whoever wrote `h`.
 *
 *  Imports nothing, including three.
 */

/**
 * The lowest of `n + 1` ground samples: the centre, and `n` points evenly
 * spaced around a ring of radius `r`.
 *
 * The ring starts at angle 0 (positive x) and runs anticlockwise in XZ. That is
 * arbitrary and it is FIXED, because it is the difference between two runs of
 * the same world agreeing to the bit and not: `(i / n) * Math.PI * 2` is the
 * pinned expression, not `i * (Math.PI * 2 / n)`, which is a different double.
 */
export function footprintLow(
  h: (x: number, z: number) => number,
  x: number,
  z: number,
  r: number,
  n = 10,
): number {
  let y = h(x, z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = h(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (s < y) y = s;
  }
  return y;
}
