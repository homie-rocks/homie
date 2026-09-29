/**
 * ============================================================================
 *  A press that arrived a frame before it was legal.
 * ============================================================================
 *  Standard in the genre and worth about a tenth of a second, and the reason it
 *  needs a mechanism rather than a flag is that THERE IS NO ACKNOWLEDGEMENT
 *  CHANNEL. The thing the press drives silently declines it — because a state
 *  machine is still arming, because the player is stunned, because the slot is
 *  empty — and returns nothing the input layer can read. So a press loosed a
 *  few frames early simply vanished.
 *
 *  What there IS, always, is PROOF AFTER THE FACT: an action that was accepted
 *  changes something observable. So the press is re-offered every frame until
 *  that fingerprint moves, or the window runs out.
 *
 *  Three properties, and each of them is a bug that this shape prevents:
 *
 *  1. **The fingerprint is the caller's.** This module never learns what the
 *     press does or what changed. `sig()` returns an integer and is only ever
 *     compared for INEQUALITY; a negative value means "cannot be read right
 *     now", which cancels the buffer rather than re-offering blindly against a
 *     signature that is not there.
 *
 *  2. **`live` is hard, not advisory.** The same edge usually doubles as
 *     CONFIRM on a menu, and a confirm that repeated for six frames walks the
 *     player through six screens. Both games this came from gate the buffer on
 *     the world actually running, and the gate is re-checked every frame rather
 *     than only at the press: a press that is buffered and then leaves the live
 *     state is dropped, not carried into whatever comes next.
 *
 *  3. **The press frame itself is never swallowed.** `offer` returns true on
 *     the frame the press happened, whatever the buffer decides. It buffers a
 *     press; it does not delay one.
 * ============================================================================
 */

export class PressBuffer {
  /** seconds a refused press keeps being re-offered */
  private readonly window: number;
  /** remaining seconds of the current offer */
  private left = 0;
  /** the fingerprint at the moment the buffered press was raised */
  private sig = -1;

  constructor(windowSeconds: number) {
    this.window = windowSeconds;
  }

  /**
   * One frame. `pressed` is this frame's rising edge; `sig` is the observable
   * proof of acceptance, called at most twice a frame and never stored.
   *
   * Returns what the caller should publish as the press.
   */
  offer(pressed: boolean, live: boolean, dt: number, sig: () => number): boolean {
    if (pressed) {
      this.left = live ? this.window : 0;
      this.sig = sig();
      return true;
    }
    if (this.left > 0) {
      this.left -= dt;
      const now = sig();
      if (!live || now < 0 || now !== this.sig) this.left = 0;
      else if (this.left > 0) return true;
    }
    return false;
  }
}
