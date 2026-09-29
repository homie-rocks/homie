/**
 * ============================================================================
 *  markers — a pack of dots on a panel, made readable.
 * ============================================================================
 *
 *  A minimap, a radar, a tag layer over a world: the same two problems every
 *  time. Eight actors bunched into forty metres of track project into a knot of
 *  overlapping discs, and once they overlap the draw order decides who is
 *  visible — so the one marker the player is looking for can be the one
 *  underneath.
 *
 *  `spreadMarkers` fixes the first by relaxation ALONG A CALLER-SUPPLIED AXIS,
 *  which is the whole reason it is worth sharing. Pushing overlapping dots
 *  apart along the line between their centres is the obvious solve and it is
 *  wrong here: it fans a queue of racers sideways AND lengthways, so a train
 *  nose-to-tail on a straight comes apart into a smear that reads as a wide
 *  pack. Pushing them along the local track normal is what real vehicles do,
 *  and the drawing stays true.
 *
 *  `paintOrder` fixes the second: a stable descending sort by rank, so the back
 *  of the field is laid down first and the leader ends up on top.
 *
 *  MEASURED PROVENANCE. Both games with a circuit map carried their own copy of
 *  the relaxation loop — a kart racer's minimap and a space racer's minimap —
 *  and the two had already drifted:
 *
 *    THE DEFECT ONE COPY PREVENTS. The space racer's loop opened
 *    `if (dist >= minD || dist < 1e-4) continue;`. That early-out is guarding
 *    against nothing — `Math.hypot(0, 0)` is `0`, not `NaN`, and the arithmetic
 *    below is finite and signed at `dist === 0` — and it costs the case it
 *    looks like it is protecting: two actors projecting to EXACTLY the same
 *    point are the only pair that can never come apart, and that early-out is
 *    what pins them together. Two ships respawned at one checkpoint render as
 *    one dot, for as long as they stay stacked, with nothing in any log. This
 *    file takes the kart racer's version, which separates them, and a parity
 *    test holds the exact-coincidence case as a named check so the guard
 *    cannot come back.
 *
 *  WHAT IS NOT HERE. Radii, separation multiples, offset ceilings, pass counts,
 *  colours and every drawing call stay in the game. This file moves numbers it
 *  is given; it does not have an opinion about how big a dot is.
 * ============================================================================
 */

/**
 * Per-marker accumulated offset along its own axis. Module-level scratch,
 * grown on demand: this runs every frame and a fresh array per call would be a
 * per-frame allocation in the hot path.
 */
let scratchOff = new Float64Array(16);

/**
 * Relax `n` overlapping markers apart along their own axes, in place.
 *
 * @param px  marker x, panel px. WRITTEN.
 * @param py  marker y, panel px. WRITTEN.
 * @param ax  unit x of the axis marker `i` may slide along.
 * @param ay  unit y of that axis.
 * @param radius  per-marker radius, panel px.
 * @param separation  required centre-to-centre gap as a multiple of the summed
 *   radii. 1 means "just touching"; above 1 leaves visible daylight.
 * @param maxOffset  how far any one marker may be moved off its true position,
 *   panel px. THE CEILING IS THE HONESTY BUDGET: past it the drawing is lying
 *   about where somebody is, and a map that lies is worse than a crowded one.
 * @param passes  relaxation sweeps. Three is what both callers use.
 */
/** Any per-marker numeric channel. The `!`s below are this codebase's
 *  convention for it — see `@homie-rocks/racing/road.js`'s `WearPath`. */
export type NumSpan = number[] | Float32Array | Float64Array;

export function spreadMarkers(
  n: number,
  px: NumSpan,
  py: NumSpan,
  ax: NumSpan,
  ay: NumSpan,
  radius: NumSpan,
  separation: number,
  maxOffset: number,
  passes = 3,
): void {
  if (scratchOff.length < n) scratchOff = new Float64Array(n);
  const off = scratchOff;
  for (let i = 0; i < n; i++) off[i] = 0;

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const ri = radius[i]!;
      for (let j = i + 1; j < n; j++) {
        const rj = radius[j]!;
        const minD = (ri + rj) * separation;
        const dx = px[j]! - px[i]!;
        const dy = py[j]! - py[i]!;
        const dist = Math.hypot(dx, dy);
        if (dist >= minD) continue;
        const push = (minD - dist) * 0.5;
        // Which way along i's axis j lies. At dist === 0 this is `0 >= 0`, so
        // the pair still gets a deterministic direction and comes apart —
        // see THE DEFECT ONE COPY PREVENTS in the header.
        const sgn = (dx * ax[i]! + dy * ay[i]!) >= 0 ? 1 : -1;
        const oi = clampOff(off[i]! - push * sgn, maxOffset);
        const oj = clampOff(off[j]! + push * sgn, maxOffset);
        px[i] = px[i]! + (oi - off[i]!) * ax[i]!;
        py[i] = py[i]! + (oi - off[i]!) * ay[i]!;
        px[j] = px[j]! + (oj - off[j]!) * ax[j]!;
        py[j] = py[j]! + (oj - off[j]!) * ay[j]!;
        off[i] = oi;
        off[j] = oj;
      }
    }
  }
}

/**
 * `clamp(v, -m, m)`, and it is this comparison chain CHARACTER FOR CHARACTER
 * because that is `@homie-rocks/ui/uiUtil.js`'s `clamp`, which is the function both
 * callers were passing in. Copying the body rather than importing it keeps this
 * module at zero dependencies — `@homie-rocks/ui` is loaded by the phone and
 * screen pages and this one is not — and keeps a parity test bit-exact against
 * the code it replaced.
 *
 * `Math.max(-m, Math.min(m, v))` was checked and is equivalent, `NaN` included:
 * `Math.min`/`Math.max` propagate `NaN` rather than dropping it, so both forms
 * hand a broken position straight through and the marker disappears instead of
 * being quietly moved to a bound. Recorded because it is the kind of thing a
 * future reader will "simplify" without measuring, and only one of those two
 * sentences about `NaN` is true.
 */
function clampOff(v: number, m: number): number {
  return v < -m ? -m : v > m ? m : v;
}

/**
 * Fill `out[0..n)` with marker indices in PAINT order: highest `rank` first,
 * so it is drawn first and ends up at the BOTTOM of the stack.
 *
 * For a race, `rank` is the finishing position — back of the field laid down
 * first, leader last, which is the order a viewer expects and the only one that
 * keeps the leader findable in a knot.
 *
 * Insertion sort, in place, with no comparator closure: `n` is eight and a
 * closure here would be a per-frame allocation. Stable, so markers on equal
 * rank keep their roster order rather than swapping between frames — an
 * unstable sort here makes two tied dots flicker over each other.
 */
export function paintOrder(out: number[], n: number, rank: (i: number) => number): void {
  out.length = n;
  for (let i = 0; i < n; i++) out[i] = i;
  for (let i = 1; i < n; i++) {
    const v = out[i]!;
    const pv = rank(v);
    let j = i - 1;
    while (j >= 0 && rank(out[j]!) < pv) { out[j + 1] = out[j]!; j--; }
    out[j + 1] = v;
  }
}
