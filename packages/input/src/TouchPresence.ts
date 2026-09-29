/**
 * ============================================================================
 *  TouchPresence — is a finger the thing driving this, and does the page get
 *  to zoom while it does.
 * ============================================================================
 *  ANYTHING TOUCH-RELATED IS UNVERIFIED UNTIL A PERSON HOLDS IT, and this file
 *  is the reason it keeps having to be said: CDP touch events bypass the
 *  browser's gesture arbitration, so a harness driving this module passes
 *  green while every control is dead under a thumb. Nothing below has been
 *  measured on a real touchscreen by any automated instrument. The mount/
 *  unmount DECISION is testable and is tested; the gesture blocking is not.
 * ============================================================================
 */

export interface TouchPresenceHooks {
  /** show the on-screen controls */
  mount(): void;
  /** take them away again */
  unmount(): void;
  /** true once a finger has actually driven them — see `onFirstKey` */
  used(): boolean;
}

export class TouchPresence {
  private readonly h: TouchPresenceHooks;
  /** true when the on-screen controls are up */
  touch = false;

  constructor(hooks: TouchPresenceHooks) {
    this.h = hooks;
  }

  /**
   * Two-stage detection, because one stage is not enough.
   *
   * Stage 1, eager: a coarse pointer or a positive touch-point count covers
   * every phone and touch laptop, and correctly ignores a phone-sized desktop
   * window. It is a media query rather than user-agent sniffing.
   *
   * Stage 2, lazy: iPadOS Safari defaults to "Request Desktop Website", under
   * which it reports `pointer: fine` and `maxTouchPoints: 0` — it claims to be
   * a Mac. Stage 1 says desktop and the controls never appear, which is exactly
   * the bug this fixes. So an actual touch, from any device however it
   * describes itself, mounts them on the spot. A real finger is the only
   * evidence that cannot be wrong.
   */
  start() {
    this.touch = (matchMedia?.('(pointer: coarse)')?.matches ?? false) ||
      navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (this.touch) this.h.mount();
    // Capture phase on window, so this runs BEFORE the controls' own
    // bubble-phase listener is consulted. Mounting here means the very touch
    // that revealed them still reaches them on the way back up, instead of
    // being swallowed and forcing the player to tap twice.
    else addEventListener('pointerdown', this.onFirstTouch, { capture: true });
    addEventListener('keydown', this.onFirstKey, { once: true });
  }

  stop() {
    removeEventListener('keydown', this.onFirstKey);
    removeEventListener('pointerdown', this.onFirstTouch, { capture: true } as EventListenerOptions);
    this.h.unmount();
  }

  /** A real finger on a device that claimed to be a desktop. Believe the finger. */
  private onFirstTouch = (e: PointerEvent) => {
    if (this.touch || e.pointerType !== 'touch') return;
    this.touch = true;
    this.h.mount();
    removeEventListener('pointerdown', this.onFirstTouch, { capture: true } as EventListenerOptions);
  };

  /**
   * A real keypress means a real keyboard, so the on-screen controls are
   * clutter — unless a finger has already used them, in which case this is a
   * tablet with a keyboard attached and taking the controls away mid-race
   * would be worse.
   */
  private onFirstKey = () => {
    if (this.touch && !this.h.used()) {
      this.touch = false;
      this.h.unmount();
    }
  };
}

/**
 * iOS Safari has ignored `user-scalable=no` since iOS 10, so the viewport meta
 * tag does not stop pinch-zoom — the page zooms under the player's thumbs
 * mid-corner. These are the parts that actually work: `touch-action: none`
 * (set on html/body in the document) kills the browser's own panning and
 * double-tap zoom, and Safari's proprietary `gesture*` events must be
 * cancelled explicitly on top of that. Install at boot rather than at control
 * mount, because a pinch can happen before the first single touch.
 *
 * These listeners are never removed, in either game this came from. That is
 * deliberate rather than an oversight: they are installed once per document
 * and a page that has stopped blocking pinch-zoom because a system was
 * disposed is a page that zooms during the next one.
 */
export function blockPageGestures() {
  const stop = (e: Event) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    addEventListener(t, stop, { passive: false });
  }
  // Belt and braces for engines that honour neither of the above: cancel any
  // multi-finger move that is not aimed at an interactive control.
  addEventListener('touchmove', (e: Event) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  }, { passive: false });
  // Double-tap-to-zoom fires as a second tap inside ~300ms.
  let lastTap = 0;
  addEventListener('touchend', (e: Event) => {
    const now = e.timeStamp;
    if (now - lastTap < 320) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}
