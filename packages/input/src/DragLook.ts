/**
 * ============================================================================
 *  @homie-rocks/input/DragLook.ts — a thumb that AIMS rather than a thumb that HOLDS.
 * ============================================================================
 *
 * WHAT THIS IS, AND WHY IT IS NOT A STICK
 * ---------------------------------------------------------------------------
 * `Stick2` publishes a POSITION: where the thumb is relative to where it
 * landed, held for as long as it is held, zero when it lifts. A look control
 * publishes a DELTA: how far the thumb has moved since the last frame read it,
 * consumed and reset, and the origin is irrelevant. Those are two different
 * quantities with two different lifetimes — a look drag that behaved like a
 * stick would keep turning the camera while a thumb rested still, and a stick
 * that behaved like a drag would stop walking the instant the thumb stopped.
 *
 * WHY IT IS IN A PACKAGE, WHICH IS THE ONLY QUESTION THAT MATTERS HERE
 * ---------------------------------------------------------------------------
 * The criterion is *"does this belong in a game"*, never *"is there a twin"*.
 * There happen to be two — a first-person shooter's touch controls and a
 * walking game's input each hand-rolled a look pointer, a last-position pair,
 * an accumulator and a consume-and-zero — but the reason this file exists is
 * that not one line of it is a fact about a shooter or about a walk. It is: a
 * pointer id, the delta between two `clientX`/`clientY` reports, and the
 * arithmetic that decides a thumb that barely moved was a TAP and not an aim.
 * All three are facts about a finger on a touchscreen.
 *
 * THE TAP IS PART OF IT, AND SEPARATING THEM WOULD BE THE BUG
 * ---------------------------------------------------------------------------
 * The walking game reads a tap on the look half as a jump. It cannot be a
 * second recogniser watching the same pointer, because then two things decide
 * what one gesture was and they can disagree — the classic shape where a jump
 * fires on a fast flick. The slop is the caller's number (the walking game
 * measured 12 px of Manhattan distance), the DECISION is one place, and
 * `tapped()` is only ever true for a pointer that also produced no meaningful
 * look.
 *
 * NOTHING HERE LISTENS
 * ---------------------------------------------------------------------------
 * Same rule `Stick2` states: a class that owned the listeners would decide
 * `passive`, decide the element and decide what a mouse means, and every one of
 * those is a call the game has to be able to make differently. `down`/`move`/
 * `up` all return false for a pointer that is not theirs, so a caller can hand
 * every event to every recogniser and let them sort it out.
 *
 * UNVERIFIED UNDER A THUMB. CDP touch events bypass the browser's gesture
 * arbitration, so a green harness and a dead control are indistinguishable from
 * a terminal. Nothing below has been felt under a real thumb.
 */

/**
 * How far a thumb may wander and still have been a tap, in CSS px of Manhattan
 * distance (|dx| + |dy|, not Euclidean — it is the cheaper test and the shape
 * both call sites already used).
 *
 * REQUIRED, with no default, for the reason `Stick2Spec` gives about its own
 * two numbers: a walk and a shooter want different slop, and a package that
 * shipped one would have picked one experience's feel for everybody and it
 * would have felt completely fine to whoever tuned it. Pass 0 for a control
 * that has no tap gesture at all, which is the honest way to say so — `tapped`
 * then only ever fires on a pointer that did not move by a single pixel, and
 * a caller that never reads it pays nothing.
 */
export interface DragLookSpec {
  tapSlop: number;
}

/**
 * A look drag.
 *
 * `dx` and `dy` are CSS PIXELS accumulated since the last `consume()`, in
 * SCREEN SPACE — `dy` positive is DOWN, because that is what a `PointerEvent`
 * reports and it is the convention `Stick2` publishes. A caller that wants
 * "pitch up" negates it, at the one place it also converts pixels into its own
 * units, so a seam never has two sides disagreeing about which way is up.
 */
export class DragLook {
  /** The pointer this drag is following, or -1 for nobody. */
  pointer = -1;

  readonly #spec: DragLookSpec;
  #dx = 0;
  #dy = 0;
  #lastX = 0;
  #lastY = 0;
  #moved = false;
  #tapped = false;

  constructor(spec: DragLookSpec) { this.#spec = spec; }

  /** True while a thumb is on it. */
  get active(): boolean { return this.pointer >= 0; }

  /**
   * A thumb landed. Ignores a second thumb while one is already down, so a hand
   * resting on the screen cannot steal the aim mid-shot.
   */
  down(pointerId: number, clientX: number, clientY: number): boolean {
    if (this.pointer >= 0) return false;
    this.pointer = pointerId;
    this.#lastX = clientX;
    this.#lastY = clientY;
    this.#moved = false;
    return true;
  }

  /**
   * The thumb moved. Accumulates; does NOT overwrite. Two moves between two
   * frames must add up, or a fast flick delivered as four events reads as only
   * its last quarter.
   */
  move(pointerId: number, clientX: number, clientY: number): boolean {
    if (pointerId !== this.pointer) return false;
    const mx = clientX - this.#lastX;
    const my = clientY - this.#lastY;
    this.#dx += mx;
    this.#dy += my;
    this.#lastX = clientX;
    this.#lastY = clientY;
    if (Math.abs(mx) + Math.abs(my) > this.#spec.tapSlop) this.#moved = true;
    return true;
  }

  /**
   * The thumb lifted, or the browser cancelled the pointer.
   *
   * A pointer that never exceeded the slop latches a TAP, which the caller
   * collects with `tapped()`. Accumulated delta is NOT cleared here: a flick
   * that ends between two frames must still be delivered, and a `pointerup`
   * that threw the movement away would drop exactly the fastest gestures.
   */
  up(pointerId: number): boolean {
    if (pointerId !== this.pointer) return false;
    if (!this.#moved) this.#tapped = true;
    this.#moved = false;
    this.pointer = -1;
    return true;
  }

  /**
   * Read the accumulated delta and zero it. Once per frame, by the one system
   * that applies it — read twice and half the turn goes missing, which is a
   * camera that stutters only when something else happens to also be looking.
   */
  consume(): { dx: number; dy: number } {
    const out = { dx: this.#dx, dy: this.#dy };
    this.#dx = 0;
    this.#dy = 0;
    return out;
  }

  /** Was the last completed drag a tap? Latched, and cleared by reading it. */
  tapped(): boolean {
    const t = this.#tapped;
    this.#tapped = false;
    return t;
  }

  /**
   * Drop everything. For `blur`, a lost context, or a game leaving the screen.
   *
   * The pending TAP goes too, unlike `up`: a page that lost focus mid-gesture
   * did not receive a deliberate press, and firing one on the way back is how a
   * player jumps off a ledge on returning to a tab.
   */
  clear(): void {
    this.pointer = -1;
    this.#dx = 0;
    this.#dy = 0;
    this.#moved = false;
    this.#tapped = false;
  }
}
