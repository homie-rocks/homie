/**
 * ============================================================================
 *  Kit — the three things every prop generator in this package needs, and the
 *  one place the divergence with `@homie-rocks/noise` is written down.
 * ============================================================================
 *
 *  This is not a barrel and not a dumping ground. It holds exactly three
 *  symbols, and two of them are here because moving them anywhere else would
 *  have been a behaviour change rather than a move.
 *
 *  ------------------------------------------------------------------------
 *  `smoothstep` IS NOT `@homie-rocks/noise`'s `smoothstep`, AND THAT IS DELIBERATE.
 *  ------------------------------------------------------------------------
 *  Both source games' prop modules carried this, character for character:
 *
 *      const t = clamp((x - e0) / (e1 - e0), 0, 1);
 *      return t * t * (3 - 2 * t);
 *
 *  `@homie-rocks/noise/Noise.js` carries a DIFFERENT function under the same name:
 *
 *      const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
 *
 *  The `|| 1e-6` is a divide-by-zero guard, and it changes the answer on two
 *  inputs the games can actually produce:
 *
 *    · `e1 === e0`. The games divide by zero and get ±Infinity (or NaN, when
 *      `x === e0` too), which `clamp` resolves to 1, 0 or NaN. Noise divides
 *      by 1e-6 and gets a large finite number, which `clamp01` resolves to 1
 *      or 0. NaN and 0 are not the same vertex.
 *    · A span of NEGATIVE ZERO. `-0 || 1e-6` is `1e-6`, because `-0` is falsy.
 *      The games would divide by `-0` and flip the sign of the result.
 *
 *  No call site in this package is known to hit either case today. That is
 *  exactly why swapping them would be dangerous: it would compile, it would
 *  pass every geometry fingerprint, and it would sit here waiting for the
 *  first caller that passes a degenerate span. Two functions that genuinely
 *  differ do not become one because they share a name.
 *
 *  `clamp` and `lerp` ARE `@homie-rocks/noise`'s — verified character-identical to
 *  both games' copies — so every module here imports those from the package
 *  rather than restating them. Only the one that differs lives here.
 *
 *  ------------------------------------------------------------------------
 *  `RNG` and `pick`
 *  ------------------------------------------------------------------------
 *  `RNG` is the type both games declare for `mulberry32`'s return. `@homie-rocks/noise`
 *  owns `mulberry32` but publishes no name for its type, so this package
 *  declares one rather than spelling `() => number` at forty signatures.
 *
 *  `pick` is one line and it is duplicated: each game keeps its own copy,
 *  because game code outside the moved region still calls it. When
 *  `@homie-rocks/noise` grows an RNG-helpers section this belongs there and all
 *  three copies collapse. Until then this is a known, written-down second
 *  copy rather than an unnoticed one.
 */

import { clamp } from '@homie-rocks/noise/Noise.js';

/** A deterministic 0..1 source. `mulberry32(seed)` returns one. */
export type RNG = () => number;

/** Uniform choice from a non-empty array. Consumes exactly one draw. */
export const pick = <T>(rng: RNG, arr: T[]): T => arr[(rng() * arr.length) | 0];

/** Hermite step — the GAMES' version. Read the header before touching it. */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
