/**
 * ============================================================================
 *  Deterministic UI settling for capture and review.
 * ============================================================================
 *
 * Extracted from the base-building game's UI, where it was the working
 * implementation. Two captures of the same seeded tree had
 * disagreed by 309 pixels of hint text because wall-clock staging reached the
 * shutter at different points in an eased transition. This is the mechanism
 * that makes the review surface advance by a fixed amount instead.
 *
 * The package owns exactly two rules:
 *
 *  1. retire each registered transient before advancing anything; and
 *  2. advance the UI on a fixed 1/60-second step.
 *
 * It deliberately does not know which transients a game has, how many frames
 * make that game's composition quiet, or what its ordinary frame update does.
 * Those remain caller arguments. In particular, this function must never poll
 * input: a latched `pressed()` value is stable for the whole render frame, so a
 * 120-step settle would consume the same press 120 times. The caller supplies
 * its animation tick, not its action/input tick.
 */

/** A panel or deck that can retire its wall-clock transients immediately. */
export interface Quiescible {
  quiesce(): void;
}

/** The fixed review step. Exported so a probe and a consumer name one clock. */
export const CAPTURE_STEP = 1 / 60;

/**
 * Retire transient presentation state, then advance UI animation deterministically.
 *
 * `frames` intentionally preserves the original loop's JavaScript semantics:
 * a fractional positive value runs through the last partial count (2.5 means
 * three ticks), while zero and negative values run none. Capture callers use
 * integers, but silently rounding here would make extraction itself a behaviour
 * change for any harness that does not.
 */
export function settle(
  frames: number,
  tick: (dt: number) => void,
  quiescibles: readonly Quiescible[] = [],
): void {
  for (const q of quiescibles) q.quiesce();
  for (let i = 0; i < frames; i++) tick(CAPTURE_STEP);
}
