/**
 * ============================================================================
 *  resclamp — the two ceilings every effective pixel ratio has to pass, and
 *  the applied-buffer record that stops a no-op resize costing anything.
 * ============================================================================
 *
 *  ── WHY THIS FILE EXISTS, AND IT IS A FINGERPRINT RATHER THAN A SIMILARITY
 *     SCORE ────────────────────────────────────────────────────────────────
 *
 *  `./pipeline.ts` and a base-building game's renderer each carried these
 *  clamps, and the comment on the second of them was shared
 *  VERBATIM between the two files, down to the sentence
 *
 *      "BOTH CLAMPS BELOW MULTIPLY `scale` BACK IN, and that is not cosmetic"
 *
 *  Comments do not converge independently. A review called that game's copy a
 *  fork of the package's and it was right; this is the mechanism half of that
 *  fork, landing once.
 *
 *  ── WHAT IS MECHANISM HERE AND WHAT STAYED WITH THE CALLER ─────────────────
 *
 *  The POLICY — which base ratio a tier asks for — is emphatically NOT here and
 *  must not come here. The two callers genuinely disagree about it and the
 *  disagreement is deliberate:
 *
 *    · the package computes `min(dpr, maxPixelRatio) * scale`, i.e. a CAP. A
 *      display reporting devicePixelRatio 1 renders at 1.0.
 *    · the base-building game computes `clamp(dpr, minRatio, maxRatio) *
 *    scale`, i.e. a
 *      supersample FLOOR. The same display renders at 1.25 on High, because
 *      MSAA is forbidden while that game's AO pass is on and the ratio IS the
 *      whole of its coverage budget on the tier its art direction targets.
 *
 *  Folding those into one `base()` would compile, pass everything, and quietly
 *  give one game the other's antialiasing. What IS shared is what happens to
 *  the number afterwards: it may not exceed what the driver can allocate, it
 *  may not exceed a total-pixel budget, and neither ceiling may eat the
 *  adaptive ladder.
 *
 *  ── THIS IS NOT A `Math.min`, AND THE FIRST DRAFT OF THIS FILE THOUGHT IT
 *     WAS ───────────────────────────────────────────────────────────────────
 *
 *  It reads like one. Each ceiling's TEST looks like its own VALUE compared
 *  against the ratio, so "apply it if it binds" and "take the smaller" look
 *  interchangeable. They are not, and the reason is the multiply-back-in below:
 *  the TEST is on the scaled ratio and the VALUE is the ceiling times the
 *  ladder scale AGAIN. At scale 0.84 on a 2560x1440 panel with a 3.2 Mpx
 *  budget, `min` returns 0.783 where the real arithmetic returns 0.840 —
 *  because 2.60 Mpx is under the budget and nothing should have fired at all.
 *  A render-parity probe caught that on its first run, which
 *  is the entire argument for writing the probe before believing the move.
 *
 *  So the ceilings are applied IN ORDER and the second sees the first's result,
 *  which is what both forks did:
 *
 *      if (longest * ratio > limit)   ratio = (limit / longest) * ladderScale
 *      if (w * h * ratio^2 > budget)  ratio = sqrt(budget / (w*h)) * ladderScale
 *
 *  ── THE ONE BEHAVIOUR THAT WAS RECONCILED ──────────────────────────────────
 *
 *  The two forks then differed, and only one of them can be right. The package
 *  RETURNED EARLY out of the driver-limit branch, so a ratio clamped by the
 *  driver was never tested against the pixel budget; the base-building game
 *  fell through and tested both. The fall-through is what survives, because the
 *  backstop is a backstop. The corner is narrow and real: a WebGL2 floor of
 *  2048 on both limits, on a near-square viewport, yields 2048^2 = 4.19 Mpx
 *  through a 4.0 Mpx budget. Stated here rather than left to be rediscovered.
 *
 *  THIS FILE IMPORTS NOTHING — not three, not the pipeline — so a Node test
 *  can drive the exact arithmetic the game runs with no browser anywhere, and
 *  so a parity probe can load it out of `dist/` without a specifier to
 *  resolve.
 * ============================================================================
 */

/** Everything a ceiling decision reads. No defaults: see `ScalerSpec`. */
export interface ResolutionAsk {
  /**
   * What the caller's POLICY asked for, with its adaptive scale already folded
   * in. This file never computes it and never second-guesses it.
   */
  ratio: number;
  /**
   * The adaptive ladder's scale, so a ceiling can multiply it back in.
   *
   * BOTH CEILINGS MULTIPLY THIS BACK IN, AND THAT IS NOT COSMETIC. `ratio`
   * already contains it; returning a bare `limit / longest` or
   * `sqrt(budget / pixels)` throws it away, so above either ceiling the
   * adaptive ladder has NO AUTHORITY OVER BUFFER SIZE AT ALL — the rung moves,
   * the resolution is re-applied, and the drawing buffer comes back
   * byte-identical. Proven on a sibling game: `--scale 1.5` and
   * `--scale 2.0` both produced exactly 2666x1500 = 4.00 Mpx. A retina
   * 1512x982 window at devicePixelRatio 2 is 5.94 Mpx, i.e. over the backstop
   * before the ladder has taken a single rung, so on the machine that game was
   * developed on the ladder's first step was silently swallowed. Multiplying
   * through keeps a ceiling a CEILING and leaves the ladder free to go below
   * it, which is the only arrangement in which both mechanisms mean what their
   * names say.
   *
   * A caller with a fault seam that wants the defect back passes 1 here; see
   * `?glfail=ladder` in pipeline.ts.
   */
  ladderScale: number;
  /** CSS pixels. The drawing buffer is these times the returned ratio. */
  width: number;
  height: number;
  /**
   * Longest drawing-buffer edge the driver will actually allocate, i.e.
   * `min(MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE)` read off the LIVE context.
   *
   * A render target whose edge exceeds either does not fail loudly — it comes
   * back incomplete and everything drawn into it is black, which is the most
   * literal possible version of the player's report. It is not hypothetical on
   * a handheld: a 2532 CSS-px landscape panel at devicePixelRatio 3 is 7596
   * drawing-buffer pixels wide, and the WebGL2 floor for both limits is 2048.
   */
  limit: number;
  /**
   * Ceiling on TOTAL drawing-buffer pixels, which is what every per-sample cost
   * in a post chain actually scales with.
   *
   * A ratio cap does not know how big the window is: the same cap that is
   * harmless on a 1280x800 laptop asks a 4K monitor for four times the fill.
   * This is a backstop rather than a policy, and how generous it is belongs to
   * the caller — a per-tier table in one, a single 4.0e6 in the other.
   */
  pixelBudget: number;
}

/**
 * The largest effective pixel ratio this ask may have, ceilings applied.
 *
 * Returns the ask unchanged when neither ceiling binds. Applies NO floor and no
 * upper bound of its own: those are the caller's policy, they differ between
 * the two consumers today, and a bound invented here would silently move one of
 * them.
 */
export function resolutionCeiling(ask: ResolutionAsk): number {
  const longest = Math.max(ask.width, ask.height);
  const area = ask.width * ask.height;
  let ratio = ask.ratio;
  if (longest * ratio > ask.limit) ratio = (ask.limit / longest) * ask.ladderScale;
  // The SECOND test reads the FIRST's result, deliberately: a ratio the driver
  // forced down can still be over the pixel budget. See the header's corner.
  if (area * ratio * ratio > ask.pixelBudget) {
    ratio = Math.sqrt(ask.pixelBudget / area) * ask.ladderScale;
  }
  return ratio;
}

/**
 * The minimal shape of a GL context this file reads. Structural on purpose:
 * naming `WebGL2RenderingContext` would pull the DOM lib into a module whose
 * whole point is that it can be imported by a Node test.
 */
export interface RenderbufferLimits {
  MAX_RENDERBUFFER_SIZE: number;
  getParameter(pname: number): unknown;
}

/**
 * `MAX_RENDERBUFFER_SIZE` off the LIVE context, with 4096 as the answer to
 * every way of not knowing.
 *
 * A THUNK RATHER THAN A CONTEXT, because both call sites can throw on the way
 * to one: `renderer.getContext()` is a method call on a renderer that may have
 * lost its device. The whole lookup is inside one `try` for that reason.
 *
 * NOT `glCapabilities()`, and this is the same distinction `Pipeline.probeDevice`
 * holds against it: `glCapabilities` opens its own throwaway 8x8 context and
 * reports ITS limits, which is the right instrument for a bring-up report and
 * the wrong one for deciding how large a buffer THIS renderer may allocate.
 *
 * 4096 rather than the WebGL2 floor of 2048: this value only ever makes a
 * ceiling, and a guess that is too small blurs a display that was fine, on
 * every device, forever. Every WebGL2 implementation these games have met
 * reports at least 8192.
 */
export function maxRenderbufferSize(gl: () => RenderbufferLimits | null | undefined): number {
  try {
    const ctx = gl();
    if (ctx === null || ctx === undefined) return 4096;
    return (ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number) || 4096;
  } catch {
    return 4096;
  }
}
