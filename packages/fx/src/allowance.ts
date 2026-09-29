/**
 * ============================================================================
 *  allowance — HOW MUCH OF A RING MAY BE SPENT PER SECOND, and by whom.
 * ============================================================================
 *  `budget.ts` in this package is CAPACITY: how big the rings are, decided once
 *  at init from a quality tier. `energy.ts` is the per-frame GOVERNOR: how much
 *  of a crowded frame's work to skip. This is the third question and neither of
 *  them answers it — a persistent ring (decals, marks, scorch, footprints) is
 *  not refilled by the frame, it is OVERWRITTEN, so the thing that matters is
 *  the RATE at which the world is allowed to consume its own history.
 *
 *  Get it wrong in the generous direction and the symptom is not a dropped
 *  frame. It is a world that erases its own opening dressing the moment anyone
 *  plays it: the ring wraps, the oldest marks — which are the ones that were
 *  placed deliberately — are the first to go, and what is left is whatever
 *  happened in the last twenty seconds.
 *
 * ----------------------------------------------------------------------------
 *  THE THREE PARTS, AND THE THIRD IS THE ONE NOBODY WRITES FIRST
 * ----------------------------------------------------------------------------
 *  1. **A RATE WITH A BURST CAP.** Units per second, accumulated, ceilinged at
 *     `burst` seconds' worth. Without the ceiling a pause banks an allowance
 *     that dumps in one frame — and a capture harness fast-forwarding a
 *     thousand steps banks a very large one, so the failure lands precisely in
 *     the pictures somebody is going to judge the game by.
 *  2. **A RANGE GATE ANCHORED ON THE LENS**, tested BEFORE anything expensive.
 *     The usual caller has a few hundred candidates a frame and an answer of
 *     "too far" for most of them; two subtractions and a compare must come
 *     before any surface query, or the cost of deciding not to draw exceeds
 *     the cost of drawing.
 *  3. **A NEAR-FIELD PRIORITY BAND WITH ITS OWN ALLOWANCE.** This is the part
 *     that is always missing, and its absence is invisible in code review.
 *
 * ----------------------------------------------------------------------------
 *  WHY THE BAND IS A SEPARATE ALLOWANCE AND NOT A BIGGER ONE
 * ----------------------------------------------------------------------------
 *  One shared rate over a large radius is a LOTTERY, and the near field always
 *  loses it. Two hundred emitters spread over a wide circle, a handful of units
 *  a second between them, and the expected number of marks under the one figure
 *  the player is actually looking at is approximately zero — while the far
 *  crowd, which nobody can resolve, spends the whole allowance every frame.
 *
 *  Raising the single rate does not fix it. It spends the extra uniformly, so
 *  the far field consumes most of the increase and the ring wraps sooner. The
 *  fix is a second allowance that can ONLY be spent close to the lens, and
 *  which the caller must consult FIRST — so an emitter twelve metres from the
 *  camera is never refused because a hundred emitters at a hundred and thirty
 *  spent the second's worth before it got there. That priority inversion is
 *  the whole defect, and it renders as a near field that photographs clean.
 *
 * ----------------------------------------------------------------------------
 *  WHAT IS NOT HERE
 * ----------------------------------------------------------------------------
 *  Any test about the SURFACE. Whether a given point will take a mark — a
 *  graded road that a footprint would be buried under, water, a roof — is the
 *  world's question and the caller keeps it. `has`/`spend` are two calls rather
 *  than one for exactly that reason: the caller tests the budget, then asks its
 *  world, then spends. Folding them into a single `claim()` forces the
 *  expensive question to run before the cheap one, which is the bug in part 2.
 * ============================================================================
 */

export interface AllowanceSpec {
  /** Units per second, spendable anywhere inside `range`. */
  rate: number;
  /** Metres from the lens beyond which nothing is spent at all. */
  range: number;
  /** Units per second reserved for inside `nearRange`. Zero disables the band. */
  nearRate: number;
  /** Metres from the lens that count as the priority band. */
  nearRange: number;
  /** Seconds of rate a pause may bank. See part 1. */
  burst: number;
}

export class Allowance {
  private readonly s: AllowanceSpec;
  private readonly range2: number;
  private readonly near2: number;
  private budget = 0;
  private nearBudget = 0;
  private camX = 0;
  private camZ = 0;

  constructor(spec: AllowanceSpec) {
    this.s = spec;
    this.range2 = spec.range * spec.range;
    this.near2 = spec.nearRange * spec.nearRange;
  }

  /** Refill both allowances and re-anchor on the lens. Once per frame. */
  tick(dt: number, camX: number, camZ: number): void {
    this.camX = camX;
    this.camZ = camZ;
    this.budget = Math.min(this.s.rate * this.s.burst, this.budget + dt * this.s.rate);
    this.nearBudget = Math.min(
      this.s.nearRate * this.s.burst, this.nearBudget + dt * this.s.nearRate);
  }

  /** Is this point inside the priority band? Two subtractions and a compare. */
  isNear(x: number, z: number): boolean {
    const dx = x - this.camX, dz = z - this.camZ;
    return dx * dx + dz * dz <= this.near2;
  }

  /** Can the band afford it? Does NOT spend — see the note on the two calls. */
  hasNear(cost: number): boolean {
    return this.nearBudget >= cost;
  }

  spendNear(cost: number): void {
    this.nearBudget -= cost;
  }

  /**
   * The two CHEAP halves of the general test, in the order that matters:
   * budget first, then range, then the caller's own expensive question.
   */
  inRange(x: number, z: number, cost: number): boolean {
    if (this.budget < cost) return false;
    const dx = x - this.camX, dz = z - this.camZ;
    return dx * dx + dz * dz <= this.range2;
  }

  spend(cost: number): void {
    this.budget -= cost;
  }

  /** What is left, for a ledger or a diagnostics row. Both go negative: a claim
   *  that was granted is granted, and the overdraft is paid off by the next
   *  refill rather than by refusing a mark that has already been drawn. */
  get pool(): number { return this.budget; }
  get nearPool(): number { return this.nearBudget; }
}

/**
 * A BOUNDED allowance: one pool, spent down, never refilled by time.
 *
 * The counterpart of the above and a genuinely different question. A rate is right
 * for something that happens continuously while a world runs; this is right for
 * something that happens ONCE — a staging pass, an opening dressing, a level
 * being written into the ring before anybody sees it. What such a pass must not
 * do is wrap the ring before the deliberate content is in it, and a per-second
 * rate cannot express that at all because the pass takes no time.
 */
export class Ration {
  private left = 0;

  /** Refill to `n`. Called at the top of a staging pass, not per frame. */
  reset(n: number): void { this.left = n; }

  /** Take `n` if the whole of it is there. All or nothing, deliberately: half
   *  a staged group is worse than none of it. */
  take(n: number): boolean {
    if (this.left < n) return false;
    this.left -= n;
    return true;
  }

  get remaining(): number { return this.left; }
}
