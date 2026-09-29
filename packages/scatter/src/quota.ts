/**
 * ============================================================================
 *  Quota — WHICH of the things you authored actually get built.
 * ============================================================================
 *
 *  Every populated world authors more candidates than it can afford: three
 *  hundred standing places for a hundred and thirty bodies, forty parked spots
 *  for twelve vehicles, ninety nesting sites for twenty birds. Something has
 *  to choose the subset, and the choice — not the authoring — is what decides
 *  whether the part of the picture the composition cares about is full or
 *  empty. Three rules, in the order they have to be applied.
 *
 *  ── 1. A UNIFORM SHUFFLE SPENDS THE POPULATION EVENLY, WHICH IS WRONG ──────
 *
 *  It hands the near foreground the same share as a marker four hundred metres
 *  away. `zoneTickets` weights a candidate by the zone it falls in, and the
 *  weighting is NORMALISED rather than flat: the candidates inside a zone
 *  SHARE that zone's weight, and the zoned block as a whole is scaled to take
 *  `share` of the draw against one ticket per candidate outside it.
 *
 *  Flat "+w tickets if you are in a zone" looks equivalent and is not, because
 *  it makes a zone's share depend on how many candidates happen to fall in it:
 *  a heavy zone with few candidates quietly loses and a light one with many
 *  quietly wins. That was measured, on a real shot, and cost it its entire
 *  subject.
 *
 *  ── 2. A DISTRIBUTION CAN STILL LEAVE A SMALL ZONE EMPTY ───────────────────
 *
 *  Which, for a zone that exists to put something in ONE NAMED SHOT, is not a
 *  rounding error — it is that shot failing. `quotaFirst` serves the heaviest
 *  zones first, deterministically, drawing nothing, and hands back the
 *  candidates to place before the random draw begins. It costs the draw
 *  nothing it would not have spent anyway: the same candidates with the same
 *  tickets, taken in a different order.
 *
 *  ── 3. THEN DRAW, WITHOUT REPLACEMENT, ONE AT A TIME ───────────────────────
 *
 *  `takeWeighted` is deliberately a single pull rather than a whole
 *  permutation, and that is not a style preference. A caller stops when its
 *  budget is full, which is almost always before the candidates run out — so
 *  a function that shuffled the entire list would consume draws the caller
 *  never needed, and every later consumer of that seeded stream would move.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the normalisation, the serve order, the cumulative pick. The
 *  caller's: what a candidate IS, what a zone means, `share`, the quota rate,
 *  and the budget it stops at. Numbers and indices only — nothing here ever
 *  sees a coordinate. Imports nothing, including three.
 * ============================================================================
 */

/**
 * One ticket count per candidate.
 *
 * @param zoneOf     for each candidate, the index of the zone it belongs to,
 *                   or a negative number for "outside every zone".
 * @param zoneWeight one weight per zone. A zone with no candidates in it
 *                   contributes nothing and is not scaled around.
 * @param share      the fraction of the draw the zoned candidates take
 *                   collectively. 0.5 gives them even odds with the rest.
 * @returns          tickets, parallel to `zoneOf`. Degenerates to all-ones —
 *                   a plain uniform draw — when there are no zoned candidates
 *                   or nothing outside them, which is the right answer in both
 *                   of those cases and not a guard against a bad input.
 */
export function zoneTickets(
  zoneOf: readonly number[], zoneWeight: readonly number[], share: number,
): number[] {
  const zoneN: number[] = new Array<number>(zoneWeight.length).fill(0);
  let outside = 0;
  for (const z of zoneOf) { if (z >= 0) zoneN[z] = (zoneN[z] as number) + 1; else outside++; }
  let sumW = 0;
  for (let z = 0; z < zoneWeight.length; z++) if ((zoneN[z] as number) > 0) sumW += zoneWeight[z] as number;
  const K = sumW > 0 && outside > 0 ? (share / (1 - share)) * outside / sumW : 1;
  return zoneOf.map((z) => (z >= 0 ? (K * (zoneWeight[z] as number)) / Math.max(1, zoneN[z] as number) : 1));
}

/**
 * The candidates to place BEFORE the draw, so no zone can come out empty.
 *
 * Heaviest zone first; within a zone, in the order they were authored. Draws
 * nothing from any stream, so inserting this pass in front of a weighted draw
 * does not move a single later sample.
 *
 * @param per how much weight buys one extra guaranteed candidate. Every
 *            occupied zone gets `1 + (w / per) | 0` of them.
 * @returns   candidate indices, in serve order, each at most once.
 */
export function quotaFirst(
  zoneOf: readonly number[], zoneWeight: readonly number[], per: number,
): number[] {
  const order = zoneWeight.map((w, z) => ({ z, w })).sort((a, b) => b.w - a.w);
  const out: number[] = [];
  for (const { z, w } of order) {
    let want = 1 + ((w / per) | 0);
    for (let i = 0; i < zoneOf.length && want > 0; i++) {
      if (zoneOf[i] !== z) continue;
      out.push(i);
      want--;
    }
  }
  return out;
}

/**
 * Pick one index in proportion to its ticket count.
 *
 * The caller removes the winner from its own parallel arrays and calls again;
 * that is what makes it "without replacement" and it is the caller's job
 * because the caller is the one holding the payload.
 *
 * `k < tickets.length - 1` and not `<=`: the last candidate is the fall-through
 * when floating-point accumulation leaves the target fractionally above the
 * running total, so a draw can never return an index off the end.
 */
export function takeWeighted(tickets: readonly number[], rng: () => number): number {
  let total = 0;
  for (const t of tickets) total += t;
  let t = rng() * total, k = 0;
  for (; k < tickets.length - 1; k++) { t -= tickets[k] as number; if (t <= 0) break; }
  return k;
}
