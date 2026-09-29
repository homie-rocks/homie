/**
 * ============================================================================
 *  TapOrDrag — was that a click on something, or the start of a camera move?
 * ============================================================================
 *
 *  One pointer, two meanings. Press, move, release: if the pointer barely moved
 *  and the press was short, the player pointed AT something. If it travelled or
 *  dwelled, the orbit rig had the gesture and the release must select nothing.
 *
 *  ── THE TOUCH SLOP IS NOT THE MOUSE SLOP, AND THAT IS MEASURED ─────────────
 *
 *  A five-pixel slop is right for a mouse and wrong for a finger. Fingers
 *  jitter: at 5 px every tap on a phone read as a drag, so the camera orbited a
 *  degree and NOTHING WAS EVER SELECTED. That is the class of defect a still
 *  cannot see — the frame is correct, the game renders, and the interface is
 *  simply dead under a thumb. Sixteen pixels is what a finger actually holds
 *  still to.
 *
 *  ── AND A LONG PRESS IS A DRAG EVEN IF IT DID NOT MOVE ─────────────────────
 *
 *  Somebody holding the button down for half a second and letting go on the
 *  same pixel is not pointing at a thing; they are a player who thought better
 *  of a camera move. Distance alone would hand that to the selection.
 *
 *  ── THE BUTTON HAS TO MATCH, TOO ───────────────────────────────────────────
 *
 *  Press left, press right without releasing, release left: two buttons, one
 *  gesture, and the release that arrives is not the one that started it.
 *  Comparing the button is what keeps a right-drag from selecting on the way
 *  out of itself.
 *
 *  ── IT DECIDES NOTHING ABOUT WHAT WAS CLICKED ──────────────────────────────
 *
 *  This answers one question — was that a tap — and takes no view on what is
 *  under the pointer, which panel is open, or what a tap should do. Anything
 *  more and it would need to know a game.
 *
 *  Every number is the caller's; there are no defaults. A slop is a statement
 *  about one interface's touch targets.
 */

/** Every number the arbiter uses. None of them has a default. */
export interface TapSlop {
  /** Manhattan pixels of travel a MOUSE press may have and still be a tap. */
  mouse: number;
  /** ...and a TOUCH press. Fingers jitter; see the header. */
  touch: number;
  /** Milliseconds past which a press is a drag however still it was. */
  ms: number;
}

/** What the press looked like. `pointerType` is the DOM's own string. */
export interface PressLike {
  clientX: number;
  clientY: number;
  button: number;
  pointerType?: string;
}

export class TapOrDrag {
  #x = 0;
  #y = 0;
  #t = 0;
  /** -1 when no press is open. Also the button that must come back. */
  #button = -1;

  readonly #slop: TapSlop;
  readonly #now: () => number;

  /**
   * `now` is injected so a harness can drive the clock. It is the one thing
   * here that is not a pure function of the two events, and a wall-clock read
   * inside a class is how a test ends up measuring the machine.
   */
  constructor(slop: TapSlop, now: () => number) {
    this.#slop = slop;
    this.#now = now;
  }

  /** A press went down. */
  down(e: PressLike): void {
    this.#x = e.clientX;
    this.#y = e.clientY;
    this.#t = this.#now();
    this.#button = e.button;
  }

  /**
   * A press came up. True when it was a TAP — same button, inside the slop for
   * its own pointer type, and inside the time limit. Closes the gesture either
   * way, so a second `up` cannot report a second tap.
   */
  up(e: PressLike): boolean {
    const moved = Math.abs(e.clientX - this.#x) + Math.abs(e.clientY - this.#y);
    const quick = this.#now() - this.#t < this.#slop.ms;
    const slop = e.pointerType === 'touch' ? this.#slop.touch : this.#slop.mouse;
    const tap = moved <= slop && quick && this.#button === e.button;
    this.#button = -1;
    return tap;
  }

  /** Abandon any open press — a blur, a cancel, a mode change. */
  clear(): void {
    this.#button = -1;
  }
}

/**
 * Is the player typing into something right now?
 *
 * A hotkey layer that does not ask this fires the game's verbs into a text
 * field: renaming a habitat "Base" pauses, opens the build menu and demolishes.
 * `contentEditable` is in here because a rich-text host is not an `<input>` and
 * every layer that forgot it learned the same way.
 *
 * BELT AND BRACES IS CORRECT HERE. A field that also stops propagation is the
 * other half, and a cleanup has removed one of the two on every project so
 * far — which is survivable precisely because there are two.
 */
export function isTextEntry(doc: Document = document): boolean {
  const a = doc.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'
    || (a as HTMLElement).isContentEditable === true);
}
