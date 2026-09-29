/**
 * ===========================================================================
 *  @homie-rocks/ui/RateTracker.ts — the rate of change of a stock, for a readout
 *  that has to be worth reading.
 * ===========================================================================
 *
 * From the base-building game's HUD. Nothing about it is a colony: it takes a
 * number and a clock and answers "how fast is this moving", and the four things
 * it gets right are things any readout of any accumulating quantity gets wrong
 * the first time — a lap counter, a health bar, a download, a fuel gauge, a
 * score. It sat in a game because there was only ever one copy of it.
 *
 * WHAT IT HAS TO GET RIGHT, and the fourth is the one that matters most:
 *
 * 1. It samples on the CALLER'S clock, not the wall clock, so pausing or
 *    changing speed cannot manufacture a rate. Paused, the delta is zero and
 *    the tracker HOLDS its last reading rather than dividing by ~0 and printing
 *    an infinity.
 * 2. It integrates over a fixed window rather than per frame, so the reading
 *    does not depend on frame rate.
 * 3. The smoothing is exponential in TIME, so the answer is the same whether
 *    the window closed after two frames or twenty.
 * 4. IT REJECTS TRANSACTIONS.
 *
 * ── (4), because it decides whether an urgency colour means anything ────────
 * A purchase spends its entire cost in ONE tick. Thirty tonnes of regolith
 * leaving the pile in a single frame is a derivative of thousands of tonnes per
 * day, and a naive estimator then reports — truthfully, and uselessly — that
 * the regolith runs out in ninety seconds. The rail flashes red on every single
 * construction, and a player who sees red on every build stops reading red.
 *
 * A cost is a TRANSACTION, not a FLOW, and the two are separable: a flow
 * persists across consecutive windows and a transaction does not. So a window
 * whose derivative is far outside the established band is skipped once — the
 * baseline moves to the new level, but nothing is folded into the rate. If the
 * NEXT window is also outside the band it is accepted, because two in a row is
 * a genuine ramp and not a purchase. That costs a real change one window of
 * latency and buys back the only thing that makes an urgency colour worth
 * having.
 *
 * ── `stepFloor` IS REQUIRED, AND IT IS THE ONLY THING A GAME SUPPLIES ───────
 * It is the largest CONTINUOUS rate any single producer or consumer in the
 * game can have; anything past it is either an aggregate — which will present
 * two windows in a row and be accepted — or a transaction. That number is a
 * fact about one game's economy and there is no defensible default for it.
 *
 * So it has no default: a game that forgets a spec field should fail to
 * compile, and a game that silently gets a default inherits another game's
 * tuning and it looks completely fine. The base-building game passes 0.25 —
 * *"the largest continuous consumption any ONE building has, the He-3 strip
 * mine's regolith feed"* — and that sentence is exactly the kind of thing that
 * must not be inherited by accident.
 */
export class RateTracker {
  private last = 0;
  private lastT = 0;
  private ema = 0;
  private primed = false;
  /** True when the previous window was rejected as a transaction. See above. */
  private skipped = false;

  /**
   * @param stepFloor units per clock-second above which a SINGLE window is a
   *   candidate transaction rather than a flow. Required; see the header.
   */
  constructor(private readonly stepFloor: number) {}

  /** @returns units per clock-second. */
  sample(value: number, now: number, window = 1.0, tau = 8): number {
    if (!this.primed) {
      this.primed = true;
      this.last = value;
      this.lastT = now;
      return 0;
    }
    const dt = now - this.lastT;
    if (dt < window) return this.ema;      // window still open — hold, do not guess
    const inst = (value - this.last) / dt;

    // The band scales with the flow already established, so a base that really
    // does move a tonne a second is not permanently treated as anomalous.
    const gate = Math.max(this.stepFloor, Math.abs(this.ema) * 5);
    const big = Math.abs(inst) > gate;
    if (big && !this.skipped) {
      this.skipped = true;                 // one-window transaction: re-baseline only
    } else {
      this.skipped = big;
      const a = 1 - Math.exp(-dt / tau);
      this.ema += (inst - this.ema) * a;
    }
    this.last = value;
    this.lastT = now;
    return this.ema;
  }

  get value(): number { return this.ema; }
}
