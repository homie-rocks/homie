/**
 * ===========================================================================
 *  @homie-rocks/render/held.ts — is the world being held for a photograph?
 * ===========================================================================
 *
 * One predicate, no state, no allocation, and it is the input every part of
 * the picture pipeline needs before it can be reproducible:
 * `@homie-rocks/postfx/Clock.ts`'s `advance(dt, held)` pins the grain phase on it,
 * `@homie-rocks/postfx/Capture.ts`'s `renderFrame(chain, state, held)` decides
 * whether a frame converges or presents on it, and the pipeline decides
 * whether to run either.
 *
 * BOTH OF THOSE TAKE `held` AS AN ARGUMENT AND NEITHER COMPUTES IT, on purpose
 * — `@homie-rocks/postfx` reads no `window`, and its `Chain.ts` says so in its
 * own words: *"`window.__freeze === true`, asked in the game because this
 * package may not"*. So every consumer asked it for itself, and for a long time
 * the only written-down answer lived in a space racer's renderer.
 * `@homie-rocks/render` already reads `window` and `document` all over
 * `pipeline.ts`, so this is the highest package in the graph that is allowed to
 * hold it.
 *
 * ---------------------------------------------------------------------------
 * THE CONDITION IS "THE WORLD WAS GIVEN NO TIME", AND IT IS NOT `__freeze`
 * ALONE. This is the space racer's own note, kept verbatim in substance because
 * it is the part that is easy to get wrong:
 *
 *   A frame nothing was simulated for must not depend on how many times it has
 *   been drawn, WHICHEVER MECHANISM STOPPED THE CLOCK. A capture tool raises
 *   `__freeze`; `@homie-rocks/loop`'s ladder also hands out a zero `dt`; a tab that
 *   was backgrounded does it a third way. A screenshot reads the COMPOSITOR's
 *   copy rather than the renderer's, so "either side of it" is a frame the
 *   harness can and does photograph.
 *
 * In play the two rAF timestamps either side of a frame are never equal, so
 * `dt === 0` is unreachable at speed and the cost is confined to instruments.
 *
 * `-0 === 0` IS TRUE IN JAVASCRIPT and that is the answer we want here: a
 * negative-zero `dt` is a world that was given no time just as much as a
 * positive one is. This is deliberately NOT `Object.is(dt, 0)`.
 */

/** The two overrides, and nothing that ships ever sets either. */
interface CaptureOverrides {
  /** raised by a screenshot tool or a capture harness to hold the world */
  __freeze?: unknown;
  /**
   * Forces the answer in BOTH directions, for attribution.
   *
   * `false` restores live per-draw behaviour under a hold, which is what to set
   * when the question is whether this path is the one responsible for
   * something; `true` forces it on without a hold, which is how the capture
   * protocol was A/B'd against the live chain in the first place.
   */
  __captureResolve?: unknown;
}

export function heldForCapture(dt: number): boolean {
  const w = globalThis as unknown as CaptureOverrides;
  if (typeof w.__captureResolve === 'boolean') return w.__captureResolve;
  return w.__freeze === true || dt === 0;
}
