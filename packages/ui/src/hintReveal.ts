/**
 * ============================================================================
 *  hintReveal — show the reason for a moment, and get out of the way the
 *  instant the player starts playing.
 * ============================================================================
 *
 *  A flyout, a tooltip, an explanation that appears when something changes and
 *  is not wanted a second longer than it is read. Three properties, and each of
 *  them is a defect somebody has shipped:
 *
 *  ── IT RETIRES ON THE FIRST INPUT, NOT ON THE TIMER ────────────────────────
 *
 *  A fourteen-second hold is thirteen seconds too many for a player who has
 *  already read it and reached for the mouse. So the first pointer press or key
 *  anywhere retires the automatic showing. It listens in the CAPTURE phase on
 *  `window`, so a click that lands on the canvas, on another panel, or on
 *  nothing at all counts equally — the player has started acting, and that is
 *  the whole signal.
 *
 *  ── A DELIBERATE PIN SURVIVES EVERY PRESS AFTER IT ─────────────────────────
 *
 *  Without a pinned state distinct from the timed one, the button that OPENS
 *  the reason closes it again on the next click the player makes, which reads
 *  as a broken control. So a pin is a separate state and the first-input retire
 *  ignores it.
 *
 *  ── AND IT CAN BE QUIESCED FOR A CAPTURE ───────────────────────────────────
 *
 *  A timed reveal is a transient on the REAL clock, and a capture harness that
 *  settles on a fixed simulation step never reaches the end of one. Two runs of
 *  the identical tree then differ by whether the flyout happened to be up,
 *  which is a determinism failure that renders as an art regression. `quiesce`
 *  is the harness's way to have nothing in flight; a player never reaches it.
 *
 *  ── NO DOM, NO WORDS, NO CSS, AND NO OPINION ABOUT ROOM ────────────────────
 *
 *  It owns a countdown and a state, and it calls back with `true` or `false`.
 *  What that means on screen — an attribute, a class, a transition — is the
 *  caller's, because a package that wrote `data-why` would require every
 *  stylesheet to spell it that way.
 *
 *  WHETHER THERE IS ROOM IS ALSO THE CALLER'S, and deliberately not a hook
 *  here. A layer that measures its flyout against the panel it would run into
 *  usually has to publish that verdict as an attribute anyway — because HOVER
 *  is the other way in and CSS cannot measure a wrapped column — so the test
 *  has to run on a poll the package cannot see the reason for. Taking a
 *  `hasRoom` callback would put half of that decision here and half of it
 *  there, which is how the two halves end up disagreeing for a frame.
 */

/** Every number and hook the reveal uses. None has a default. */
export interface HintRevealSpec {
  /** Seconds an automatic showing holds. */
  hold: number;
  /** Called whenever the shown state changes, and on every explicit request. */
  onShow(shown: boolean): void;
}

export interface HintReveal {
  /** True while the reveal is PINNED rather than merely timed. */
  readonly pinned: boolean;
  /** Start an automatic showing. Call it when the thing being explained changed. */
  reveal(): void;
  /** Pin it open, or unpin. Returns the new pinned state. */
  togglePin(): boolean;
  /** Hide now, whatever state it was in. */
  hide(): void;
  /** Real seconds. */
  update(dt: number): void;
  /** Retire every transient, for a capture. See the header. */
  quiesce(): void;
  /** Drop the two capture-phase listeners. */
  dispose(): void;
}

export function hintReveal(spec: HintRevealSpec): HintReveal {
  /**
   * Seconds left on the automatic showing. The PIN is `Infinity` rather than a
   * flag, so one number answers "is anything showing" and "is it deliberate"
   * without the two ever disagreeing.
   */
  let left = 0;

  const onFirstInput = (): void => {
    if (left <= 0 || left === Infinity) return;   // idle, or deliberately pinned
    left = 0;
    spec.onShow(false);
  };
  addEventListener('pointerdown', onFirstInput, true);
  addEventListener('keydown', onFirstInput, true);

  return {
    get pinned() { return left === Infinity; },
    reveal(): void { left = spec.hold; spec.onShow(true); },
    togglePin(): boolean {
      if (left === Infinity) { left = 0; spec.onShow(false); return false; }
      left = Infinity;
      spec.onShow(true);
      return true;
    },
    hide(): void { left = 0; spec.onShow(false); },
    update(dt: number): void {
      if (left <= 0 || left === Infinity) return;
      left -= dt;
      if (left <= 0) spec.onShow(false);
    },
    quiesce(): void { left = 0; spec.onShow(false); },
    dispose(): void {
      removeEventListener('pointerdown', onFirstInput, true);
      removeEventListener('keydown', onFirstInput, true);
    },
  };
}
