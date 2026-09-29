/**
 * ============================================================================
 *  KeepOut — a disc register. "Is this spot already spoken for?"
 * ============================================================================
 *
 *  A scatter pass proposes a position; something already standing there says
 *  no. Every world this was extracted from had written that loop, each of them
 *  exactly once, so a search for duplicated code never found it. It is
 *  placement POLICY, and it was one of the most valuable things those worlds
 *  did not yet share.
 *
 *  What is mechanism here and what is not:
 *
 *    · MECHANISM — a register of claimed discs, a squared-distance test, a
 *      per-query `pad`, and the `limit` ordering rule below.
 *    · CONTENT — every radius and every pad. A colony's doorway apron is
 *      14 metres because a rover has to turn in it; a village terrace's is
 *      whatever a terrace is. Neither number belongs in here and neither is.
 *
 *  ── THE `limit` ARGUMENT IS THE ONLY SUBTLE THING IN THIS FILE ─────────────
 *
 *  A run that CLAIMS AS IT GOES — a terrace of houses, a line of masts — must
 *  be tested against the register as it stood BEFORE the run started, or its
 *  second element is rejected by its first. `limit` caps the scan at the first
 *  N entries and the caller snapshots `size` before it begins. That is how a
 *  kart racer's scenery pass already did it, and its comment said exactly
 *  this; kept because the alternative is a second register and a merge.
 *
 *  ── AND THE ORDERING RULE, WHICH IS THE OTHER HALF ─────────────────────────
 *
 *  A space racer's roof test is "protect, then cull": a wide PROTECTING disc is
 *  scanned first and wins outright, and only then is the narrower culling scan
 *  run. That is not expressible as one register and it is not meant to be —
 *  it is TWO registers consulted in an order the game chose, which is why this
 *  class has no notion of priority. Two `KeepOut`s and an `if` is the honest
 *  shape of that rule, and it is one line at the call site.
 *
 *  ── BIT-EXACTNESS IS A PROPERTY OF THIS FILE, NOT AN ASPIRATION ────────────
 *
 *  `rr = r + pad` is evaluated in that association deliberately: the original
 *  call site, in a base-building game, wrote `(radius ?? 10) + 14 + pad`, which
 *  is `((radius + 14) + pad)`, and the register stores `radius + 14`.
 *  Reassociating to `radius + (14 + pad)` is the tidy-up a reviewer would wave
 *  through and it is a DIFFERENT DOUBLE for about 22% of radius/pad pairs in
 *  this range — one ulp at 25 m, which is a rock that appears or does not when
 *  a query lands on the boundary.
 *
 *  A parity test compares this against the original source with `Object.is`
 *  and no epsilon, and injects that swap as a fault. The fault was GREEN
 *  against the test's first forty-four-building world, because for THOSE radii
 *  and the game's six real pads the two associations agree 264 times out of
 *  264; it took five chosen calibration buildings to make it fail. A fault
 *  that cannot reach the defect is a green light wired to nothing.
 *
 *  It imports nothing — not even three — so a Node script can ask whether a
 *  spot is free with no scene graph anywhere.
 */

/**
 * A list of claimed discs in the XZ plane.
 *
 * Deliberately three parallel arrays rather than an array of objects: a scatter
 * pass runs tens of thousands of queries against a few hundred entries, the
 * scan is the hot loop, and this is the layout that does not chase a pointer
 * per entry. A linear scan IS the right amount of machinery at these sizes —
 * a kart racer measured ~150 entries against ~250 queries; a base-building
 * game runs ~40 buildings against ~46,000 attempts, which is still under two million
 * comparisons on a load screen. A grid would be correct and would need its own
 * cell size, which is one more number nobody would tune.
 */
export class KeepOut {
  private xs: number[] = [];
  private zs: number[] = [];
  private rs: number[] = [];

  /** How many discs are claimed. Snapshot this before a claims-as-it-goes run
   *  and pass it back as `limit`. */
  get size(): number {
    return this.rs.length;
  }

  /** Claim a disc. `r` is the whole footprint the caller wants protected —
   *  its own radius plus whatever collar the world's rules ask for. */
  claim(x: number, z: number, r: number): void {
    this.xs.push(x);
    this.zs.push(z);
    this.rs.push(r);
  }

  /**
   * True when (x, z) falls inside a claimed disc grown by `pad`.
   *
   * STRICTLY INSIDE. A point exactly on the boundary is NOT blocked, which is
   * the convention both games that wrote this chose, and it matters because a
   * pass that steps on a grid pitch equal to a claim radius lands on the
   * boundary constantly rather than never.
   */
  blocked(x: number, z: number, pad = 0, limit = Infinity): boolean {
    const n = Math.min(this.rs.length, limit);
    for (let i = 0; i < n; i++) {
      const rr = this.rs[i]! + pad;
      const dx = this.xs[i]! - x;
      const dz = this.zs[i]! - z;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  /** The same question the other way up, because half the call sites that use
   *  this read better as `clear(...)` and a `!` at the call site is where
   *  a polarity bug hides. */
  clear(x: number, z: number, pad = 0, limit = Infinity): boolean {
    return !this.blocked(x, z, pad, limit);
  }

  /**
   * Does a claimed disc sit inside a cone opening from (x, z) along (dx, dz)?
   *
   * The same register asked the other question a placement pass has: not "is
   * this spot taken" but "is there already something in that direction". It is
   * what a coverage fallback needs — the pass that notices a bearing with
   * nothing on the horizon and inserts one, and which must not insert a second
   * mass where one already stands.
   *
   * ── THE HALF-ANGLE IS WIDENED BY THE DISC'S OWN ANGULAR RADIUS ────────────
   *
   * `atan2(r, dl)` is how wide the claimed disc APPEARS from here. Without it
   * the test is "is the centre of that thing dead ahead", and a 200 m island
   * 600 m away — which fills 19° on its own and covers the view completely —
   * fails it whenever its centre is 31° off the axis. Adding its angular
   * radius asks the question that was meant: is any of it in the cone.
   *
   * `minRange` drops discs the query is standing inside or on top of, where
   * the bearing to the centre is noise. Both it and `halfAngle` are the
   * caller's: how far away a thing has to be to count, and how much of the
   * view "ahead" means, are decisions about that world's framing.
   *
   * (dx, dz) need not be normalised.
   */
  coveredAhead(
    x: number, z: number, dx: number, dz: number, halfAngle: number, minRange = 1,
  ): boolean {
    const fl = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < this.rs.length; i++) {
      const ax = this.xs[i]! - x;
      const az = this.zs[i]! - z;
      const dl = Math.hypot(ax, az);
      if (dl < minRange) continue;
      const cosLimit = Math.cos(halfAngle + Math.atan2(this.rs[i]!, dl));
      if ((ax * dx + az * dz) / (dl * fl) >= cosLimit) return true;
    }
    return false;
  }

  /** Forget every claim. A world that is torn down and re-staged must not
   *  inherit the last one's footprints — the same accumulating-state failure a
   *  decal layer's reset exists to stop, one level up. */
  reset(): void {
    this.xs.length = 0;
    this.zs.length = 0;
    this.rs.length = 0;
  }
}
