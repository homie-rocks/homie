/**
 * ============================================================================
 *  Curve.ts — the two things a tone curve has to be, checked rather than
 *  argued, plus the shoulder fit that stops a white point being a guess.
 * ============================================================================
 *
 * ## Why a curve gets audited at all
 *
 * Both ways a tone curve fails are INVISIBLE IN A SCREENSHOT and both have cost
 * an iteration on other projects:
 *
 *   **A non-monotonic curve puts a dark ring around every bright source.** It
 *   is not a subtle artefact — it is a hard black outline on every emitter —
 *   and nobody reviewing stills ever names it, because it reads as an authored
 *   edge rather than as a bug.
 *
 *   **A curve that reaches an emissive ladder collapses it.** A game that
 *   authors five distinct brightness tiers and then runs them through a curve
 *   whose shoulder starts too low gets five tiers of one white, and every
 *   argument about which tier a thing should be becomes meaningless.
 *
 * Neither is detectable by looking at the curve's parameters. Both fall out of
 * SAMPLING it, which is all `auditTransfer` does.
 *
 * ## The minimum slope, and why it is reported rather than only its sign
 *
 * A weighted contrast pull whose weight RISES across the band it pulls in
 * subtracts `(s(u) − u) · w'(u)` from the derivative. So a window that is too
 * narrow does not merely flatten the curve — it FOLDS it, and a fold is the
 * dark ring above. Reporting the margin means the next person to narrow a
 * window by two hundredths can see how close the shape already was, instead of
 * finding out by shipping it.
 *
 * ## Nothing here knows what a curve is FOR
 *
 * `auditTransfer` takes a function. It does not know about toes, pivots,
 * shoulders or windows, and it holds no opinion about what a legal minimum
 * slope is — a caller decides whether 0.05 is a warning or an error, because
 * that depends on how much of the frame sits in the band. The `probes` are the
 * caller's ladder in the caller's own input units, and the `encode` is the
 * caller's transfer to display. There are no defaults for any of them.
 */

/**
 * The ACES RRT+ODT fit's own white point, in the units its polynomial takes.
 *
 * The value at which the Narkowicz/Hill fit reaches 1.0 — not a tuning knob and
 * not this or any game's number. It is a property of the polynomial, and it is
 * here so `fitShoulderExponent` can be exact rather than fitted.
 */
export const ACES_WHITE_V = 25.668;

/**
 * The exponent of a power-law highlight shoulder, DERIVED so that scene-linear
 * `white` lands exactly on display white at `exposure`.
 *
 * The shoulder is `v <= knee ? v : knee · (v/knee)^exp`, and this solves `exp`
 * for the one value that makes the ACES fit downstream reach 1.0 at `white`.
 *
 * THIS IS THE BUG ANOTHER GAME SHIPPED FOR AN ITERATION. A hand-typed exponent
 * put display white at ~15,100 scene-linear — nothing in that game ever reached
 * it, so every hot thing ceilinged in the same five percent of range, and a
 * bloom and its own source became the same milky value. Deriving it means the
 * white point and the shoulder CANNOT disagree, which is the only property that
 * matters here: either number can move and the other follows.
 *
 * `knee` and `white` and `exposure` are all the caller's. `knee` in particular
 * is art direction — it is the level above which a game is willing to compress,
 * and a game that puts it below diffuse white is compressing its own sunlight.
 */
export function fitShoulderExponent(knee: number, white: number, exposure: number): number {
  const targetC = (ACES_WHITE_V * 0.6) / exposure;
  return Math.log(targetC / knee) / Math.log(white / knee);
}

export interface TransferAudit {
  /** True if the curve never decreases over `[0, 1]` at the sampled rate. */
  mono: boolean;
  /** The smallest first difference seen, scaled to a per-unit slope. */
  minSlope: number;
  /** `encode(f(probe))`, one per probe, in display counts. */
  rungs: number[];
  /** Last rung minus first. A collapsed ladder is a small span. */
  span: number;
}

export interface TransferSpec {
  /**
   * Samples over `[0, 1]`. Required, because the right number depends on how
   * sharp the curve's sharpest feature is: a fold narrower than the sample
   * spacing is a fold this does not see, and a caller with a tight ramp needs
   * more samples than one without.
   */
  samples: number;
  /** The caller's ladder, in the curve's own INPUT units. */
  probes: number[];
  /** Scene value to display count. The caller's transfer, not an assumption. */
  encode: (v: number) => number;
}

/**
 * Sample `f` over `[0, 1]` and report the two properties above plus the ladder.
 *
 * `mono` uses a `-1e-9` tolerance rather than a strict compare: the curve is
 * evaluated in double precision and a genuinely flat segment can step by a
 * negative ulp, which is not the defect this is looking for. A real fold is
 * orders of magnitude larger.
 *
 * The first difference is scaled by `samples` so `minSlope` is a slope in the
 * curve's own units and does not change meaning when a caller samples finer.
 */
export function auditTransfer(f: (x: number) => number, spec: TransferSpec): TransferAudit {
  let prev = -1;
  let mono = true;
  let minSlope = Infinity;
  for (let i = 0; i <= spec.samples; i++) {
    const y = f(i / spec.samples);
    if (y < prev - 1e-9) mono = false;
    if (i > 0) minSlope = Math.min(minSlope, (y - prev) * spec.samples);
    prev = y;
  }
  const rungs = spec.probes.map((v) => spec.encode(f(v)));
  return {
    mono,
    minSlope,
    rungs,
    span: (rungs[rungs.length - 1] ?? 0) - (rungs[0] ?? 0),
  };
}

/**
 * Blend every numeric field of two same-shaped presets into `out`, clamped.
 *
 * A per-field `lerp` written out by hand is nine correct lines and one field
 * that somebody forgot to add when they added the field — and the symptom is a
 * dawn frame in which one term of the grade is pinned at the night value while
 * the other eight ramp, which reads as a colour bug in the ramp rather than as
 * a missing line. Keying off `Object.keys(a)` means a new field is blended the
 * moment it exists.
 *
 * `out` is reused so this can run per frame. Fields present on `out` but not on
 * `a` are left alone; fields on `a` that are not numbers are skipped, so a
 * preset carrying a label survives a blend unchanged rather than becoming NaN.
 */
export function lerpFields<T extends object>(a: T, b: T, t: number, out: T): T {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const A = a as Record<string, unknown>;
  const B = b as Record<string, unknown>;
  const O = out as Record<string, unknown>;
  for (const key of Object.keys(A)) {
    const av = A[key];
    const bv = B[key];
    if (typeof av !== 'number' || typeof bv !== 'number') continue;
    O[key] = av + (bv - av) * k;
  }
  return out;
}
