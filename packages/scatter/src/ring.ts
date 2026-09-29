/**
 * ============================================================================
 *  ringSlots / ladderFit — placing things all the way round a horizon.
 * ============================================================================
 *
 *  A backdrop is a set of concentric rings of large objects, and there are
 *  exactly two rules in it that are not about what the objects ARE.
 *
 *  ── 1. THE LADDER HAS TO FIT INSIDE THE CAMERA'S FAR PLANE ─────────────────
 *
 *  This is not a nicety, it is the failure that removed a whole layer of a
 *  world without a word. A kart racer authored its outermost range at an offset
 *  of 3400 m from a circuit whose own radius is ~318 m, against a far plane of
 *  3000. Every triangle of it was built, merged, uploaded and then CLIPPED —
 *  the layer that was supposed to be the last silhouette before the sky did
 *  not exist on screen, and "the world stops and the horizon has nothing in
 *  it" was the review note that eventually found it.
 *
 *  `ladderFit` returns the scale that brings the whole ladder inside the
 *  frustum, and it COMPRESSES rather than clamps: pinning only the far band
 *  onto the one in front of it gives four layers at three radii, which is the
 *  same failure with extra triangles. Distance in a landscape is read off
 *  angular size and aerial perspective, not off a range-finder, so a
 *  compressed ladder with the sizes and the haze retuned still reads as depth.
 *  Reading the far plane at BUILD TIME rather than baking a number is what
 *  makes it follow a camera agent that moves it later.
 *
 *  ── 2. A RING MUST NOT LOOK LIKE A RING ────────────────────────────────────
 *
 *  Slots are evenly spaced and then jittered in BEARING and in RADIUS. The
 *  radius jitter is the one that matters: it is what makes two neighbours
 *  overlap at different depths, which is where a ring stops reading as a fence
 *  of evenly spaced posts and starts reading as layered ridges receding into
 *  haze. Both jitters draw from the caller's RNG, in bearing-then-radius
 *  order, because a world that rebuilds identically depends on the draw order
 *  and not only on the seed.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *   · MECHANISM — the fit, the compression, the even spacing, the two
 *     jitters, and the arc width each slot is given.
 *   · CONTENT — every offset, every slot count, every jitter fraction, the
 *     margin left for an object's own depth, and absolutely everything the
 *     callback then builds.
 *
 *  Imports nothing, including three.
 * ============================================================================
 */

/**
 * The scale that brings a ladder of ring offsets inside a far plane.
 *
 * @param authored the OUTERMOST authored offset, in metres beyond `inner`
 * @param far      the camera's far plane
 * @param radius   the subject's own radius — the worst case is a camera on the
 *                 near side of it looking at the far side of the ring, which
 *                 is `(R + radius)` metres away
 * @param inner    where offset 0 sits, as a radius from the centre
 * @param margin   fraction of the far plane to actually use. Below 1 by
 *                 whatever room the objects' own back faces need: they are
 *                 hidden behind their fronts but still have to survive
 *                 clipping, or the mesh tears open.
 * @param floor    the smallest outermost offset worth building at all
 * @returns a scale in (0, 1]
 */
export function ladderFit(
  authored: number, far: number, radius: number, inner: number, margin: number, floor: number,
): number {
  const maxOffset = Math.max(floor, far * margin - radius - inner);
  return Math.min(1, maxOffset / authored);
}

/**
 * Walk one ring of `slots` evenly spaced bearings, jittered.
 *
 * @param radius  the ring's radius before jitter
 * @param slots   how many
 * @param spread  bearing jitter, as a fraction of the slot's own angular
 *                pitch. 0 is a perfectly regular ring.
 * @param jitter  radius jitter, as a fraction of the radius.
 * @param rng     drawn TWICE per slot, bearing first. Do not reorder.
 * @param cb      given the bearing, the jittered distance, the arc width one
 *                slot occupies at the unjittered radius, and the index.
 */
export function ringSlots(
  radius: number, slots: number, spread: number, jitter: number,
  rng: () => number,
  cb: (az: number, dist: number, arc: number, i: number) => void,
): void {
  const arc = (Math.PI * 2 * radius) / slots;
  for (let i = 0; i < slots; i++) {
    const az = (i / slots) * Math.PI * 2 + (rng() - 0.5) * (Math.PI * 2) / slots * spread;
    const dist = radius * (1 + (rng() - 0.5) * jitter);
    cb(az, dist, arc, i);
  }
}

// ===========================================================================
//  A ring of yes/no bins, and the majority filter under it
// ===========================================================================

/**
 * Majority-filter a ring of raw bins.
 *
 * NOT smoothing. It is a defence against one noisy probe: without it a single
 * disagreeing bin in the middle of a run opens a gap in whatever the run was
 * protecting. The filter reads `raw` throughout and writes somewhere else,
 * because a filter allowed to read its own partially-written output lets the
 * decision walk around the ring, and that is the whole rule.
 *
 * @param run   half-width in bins; `run <= 0` is the identity
 * @param agree how many of the `2 * run + 1` must say yes
 */
export function majorityRing(raw: Uint8Array, run: number, agree: number): Uint8Array {
  const bins = raw.length;
  const out = new Uint8Array(bins);
  if (run <= 0) { out.set(raw); return out; }
  for (let i = 0; i < bins; i++) {
    let acc = 0;
    for (let k = -run; k <= run; k++) acc += raw[(i + k + bins) % bins]!;
    out[i] = acc >= agree ? 1 : 0;
  }
  return out;
}

/**
 * A ring of yes/no bins indexed by a NORMALISED parameter in [0, 1).
 *
 * `AzimuthMask` is this same ring indexed by a bearing, and the two used to be
 * written out separately inside one file: a racing game classified backdrop
 * slots by bearing with one of them, and which side of the road the water is
 * on by lap progress with the other, each carrying its own copy of the wrap,
 * the bin lookup and the majority filter. They are one mechanism over two
 * parameters. The filter is `majorityRing` above, shared by both, and this is
 * the parameterised half.
 *
 * Every query wraps, so a caller may hand in any real number — a lap parameter
 * that has run past 1, or a negative one — without normalising first.
 *
 * WHAT IS MECHANISM AND WHAT IS NOT. The bins, the wrap and the filter are
 * here. The PREDICATE is not, and neither is what the two answers MEAN: a
 * caller that wants ±1 rather than true/false maps it at its own call site,
 * because which side of a road the water is on is a fact about that world.
 */
export class LoopMask {
  readonly bins: number;
  private readonly m: Uint8Array;

  /**
   * @param bins  how finely the loop is divided
   * @param test  called once per bin with the parameter at its LEADING EDGE,
   *              `i / bins`. Not the centre — `AzimuthMask` samples centres
   *              because a coastline classified from a bin's edge is
   *              systematically half a bin early, and this samples edges
   *              because that is what the lap survey it replaced did and a
   *              half-bin shift in where the sea is moves props. Which one a
   *              caller wants is the caller's; add the offset inside `test`.
   * @param run   half-width of the majority filter, in bins
   * @param agree how many of the `2 * run + 1` must say yes
   */
  constructor(bins: number, test: (u: number, i: number) => boolean, run = 2, agree = 3) {
    this.bins = bins;
    const raw = new Uint8Array(bins);
    for (let i = 0; i < bins; i++) raw[i] = test(i / bins, i) ? 1 : 0;
    this.m = majorityRing(raw, run, agree);
  }

  /** Is this parameter marked? */
  at(u: number): boolean {
    const n = this.bins;
    const i = Math.floor(u * n);
    return this.m[((i % n) + n) % n] === 1;
  }
}
