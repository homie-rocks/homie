/**
 * ============================================================================
 *  AzimuthMask — "may I put something on THIS BEARING out of the centre?"
 * ============================================================================
 *
 *  A backdrop is a ring. Everything on it is placed by bearing, and the one
 *  question every slot has to ask before it is built is whether that bearing
 *  is allowed — over the bay, over the void, off the end of a valley, behind
 *  the camera's back wall. This is the register for that answer.
 *
 *  ── WHY BEARING AND NOT POSITION, WHICH IS THE FINDING THIS CAME FROM ──────
 *
 *  A kart racer classified each backdrop slot by probing the terrain under it.
 *  For the two near bands that works. For the far ones the probe lands 700 m
 *  to 1.3 km outside the heightfield, which clamps at its border, so past the
 *  edge the answer stops being "is this water" and becomes "whatever the
 *  border happens to hold on this bearing" — arbitrary, and it flipped with
 *  the layout. The circuit shipped with a continuous ring of mountains right
 *  across the open sea, which is a lake.
 *
 *  A coastline does not change its mind: land or water at 400 m on a bearing
 *  is land or water at 2 km on the same bearing. So classify ONCE, close in
 *  where the field genuinely exists, and let every band share the answer. That
 *  is the whole idea, and it is not about water — the same reasoning holds for
 *  a canyon mouth, a launch corridor or a skybox seam.
 *
 *  ── THE MAJORITY FILTER IS NOT SMOOTHING ───────────────────────────────────
 *
 *  It is a defence against one noisy probe. Without it a single wet bin in the
 *  middle of a range opens a gap in it, and a single dry bin in the middle of
 *  the bay drops a 175 m headland into the water. `>= 3 of 5` is the caller's
 *  to change via `run`; the rule is that the filter reads the RAW bins, never
 *  the partially-filtered output, or the decision walks around the ring.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *   · MECHANISM — the bin count, the wrap, the two-phase filter, and the
 *     widened `near` query below.
 *   · CONTENT — the predicate. What makes a bearing unavailable, at what
 *     radii it is sampled and how many probes have to agree is a fact about
 *     that world's terrain, and none of it is in here.
 *
 *  Imports nothing but its own package's majority filter, and certainly not
 *  three. A Node script can rebuild a world's horizon mask with no scene
 *  graph.
 * ============================================================================
 */
import { majorityRing } from './ring.ts';

/**
 * A ring of yes/no bins, indexed by bearing in radians.
 *
 * Bin `i` covers `[i, i+1) / bins` of a full turn, and every query wraps, so a
 * caller may hand in any angle in any sign without normalising first — which
 * matters because half of them arrive from `Math.atan2`, in (-pi, pi].
 */
export class AzimuthMask {
  readonly bins: number;
  private readonly m: Uint8Array;

  /**
   * @param bins how finely the ring is divided
   * @param test called once per bin with the bearing at its CENTRE — `(i +
   *        0.5) / bins` of a turn, not its leading edge, because a bin
   *        classified from its edge is systematically half a bin early, and a
   *        run of them shifts the whole coastline by that much
   * @param run  half-width of the majority filter in bins, and `agree` how
   *        many of the `2 * run + 1` must say yes. Pass `run = 0` to skip the
   *        filter entirely and keep the raw classification.
   */
  constructor(bins: number, test: (az: number, i: number) => boolean, run = 2, agree = 3) {
    this.bins = bins;
    const raw = new Uint8Array(bins);
    for (let i = 0; i < bins; i++) raw[i] = test(((i + 0.5) / bins) * Math.PI * 2, i) ? 1 : 0;
    // The filter itself is `ring.ts`'s, because `LoopMask` — the same ring
    // indexed by a lap parameter instead of a bearing — needs it too and this
    // loop stood twice in one racing game's scenery file before either existed.
    this.m = majorityRing(raw, run, agree);
  }

  /** Is this bearing marked? */
  at(az: number): boolean {
    const n = this.bins;
    const i = Math.floor((az / (Math.PI * 2)) * n);
    return this.m[((i % n) + n) % n] === 1;
  }

  /**
   * Is ANY marked bearing within `clear` radians of this one?
   *
   * `at()` alone is not enough for anything that occupies an arc. A ridge is
   * an arc and a quarter long, so a slot whose CENTRE is on the last allowed
   * bearing still puts most of its mass over the forbidden one. `clear <= 0`
   * is the identity and returns false without touching the ring, so a caller
   * with a zero clearance pays nothing.
   */
  near(az: number, clear: number): boolean {
    if (clear <= 0) return false;
    const n = this.bins;
    const step = (Math.PI * 2) / n;
    const k = Math.max(1, Math.ceil(clear / step));
    const i0 = Math.floor((az / (Math.PI * 2)) * n);
    for (let d = -k; d <= k; d++) if (this.m[(((i0 + d) % n) + n) % n] === 1) return true;
    return false;
  }
}
