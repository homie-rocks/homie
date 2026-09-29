/**
 * ============================================================================
 *  BankRun — a crowd is bimodal, and a coin flip per step is not a crowd.
 * ============================================================================
 *
 *  The failure this exists to stop, written down once so nobody rediscovers
 *  it: place a figure with probability p at every step along a line and you
 *  get a Poisson scatter — isolated ones and twos with three to five metres of
 *  empty between them. It reads as sparse-even, which is the amateur tell, and
 *  turning p up just makes an evenly dense hedge. A review of a kart racer
 *  named it off a frame; the same shape turns up in a queue, a market row, a
 *  line of parked vehicles and a hedgerow.
 *
 *  What a real one does is RUN AND STOP. It packs solid in a bank of fifteen
 *  to forty at shoulder pitch, then there is genuinely nobody for a stretch,
 *  then another bank. Two states over the walk, not one probability.
 *
 *  ── THE DRAW ORDER IS PART OF THE CONTRACT ─────────────────────────────────
 *
 *  Up to four numbers come off the caller's stream per step and they come off
 *  in THIS order, only when the state machine reaches each one:
 *
 *    1. bank length      (only when a new bank opens)
 *    2. gap length       (only when a new bank opens)
 *    3. the skip roll    (only when a new bank opens)
 *    4. the porosity roll (every placing step)
 *
 *  A caller adopting this from its own inline loop gets the same world only if
 *  that order matches. It is invisible to review and obvious in a capture,
 *  which is why it is written here rather than implied.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the two states, the carry between steps, and that a corner
 *  lengthens banks rather than merely densifying them. Every number — how long
 *  a bank is, how empty a gap is, how much a corner counts for, how porous a
 *  bank is — is the caller's, and there are no defaults to inherit by
 *  accident. Numbers in, booleans out, no `three`.
 * ============================================================================
 */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** How this line of things runs and stops. Every field is the caller's. */
export interface BankShape {
  /** shortest bank, in steps */
  bankMin: number;
  /** uniform extra bank length, in steps */
  bankSpread: number;
  /** extra bank length at a full-strength corner, in steps */
  bankCorner: number;
  /** shortest empty run, in steps, BEFORE the density divisor */
  gapMin: number;
  /** uniform extra empty run, same units */
  gapSpread: number;
  /** floor on the density divisor, so a density of 0 does not make gaps infinite */
  gapFloor: number;
  /** the divisor is `max(gapFloor, density * (gapBias + corner))` */
  gapBias: number;
  /** a bank opens with probability `clamp(density * chanceGain + bias, chanceMin, chanceMax)` */
  chanceGain: number;
  chanceMin: number;
  chanceMax: number;
  /** chance a step INSIDE a bank places nothing — a crowd, not a fence */
  porosity: number;
}

/**
 * One line of things that runs and stops. Construct it per line, call `step`
 * once per walk step, place when it returns true.
 *
 * `corner` is 0..1 for "how much is happening here" and lengthens banks and
 * shortens gaps; `bias` is a constant added to the bank-open chance, which the
 * caller usually derives once from the span as a whole rather than per step.
 */
export class BankRun {
  #inBank = 0;
  #gap = 0;

  constructor(private readonly s: BankShape, private readonly rng: () => number) {}

  /** True if this step should place something. See the header on draw order. */
  step(density: number, corner: number, bias: number): boolean {
    const s = this.s;
    if (this.#inBank <= 0) {
      if (this.#gap > 0) {
        this.#gap--;
        return false;
      }
      this.#inBank = s.bankMin + ((this.rng() * s.bankSpread) | 0) + ((corner * s.bankCorner) | 0);
      this.#gap = Math.round((s.gapMin + this.rng() * s.gapSpread) / Math.max(s.gapFloor, density * (s.gapBias + corner)));
      if (this.rng() > clamp(density * s.chanceGain + bias, s.chanceMin, s.chanceMax)) {
        // this whole bank is skipped: some stretches genuinely have nothing
        this.#inBank = 0;
        return false;
      }
    }
    this.#inBank--;
    return this.rng() >= s.porosity;
  }
}
