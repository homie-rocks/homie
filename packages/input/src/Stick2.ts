/**
 * ============================================================================
 *  @homie-rocks/input/Stick2.ts — a floating stick with TWO axes.
 * ============================================================================
 *
 * WHAT WAS MISSING, MEASURED RATHER THAN ASSERTED.
 * ---------------------------------------------------------------------------
 * `@homie-rocks/device`'s `ThumbPad` is 1,501 lines and it is excellent at what it
 * does, but its output contract `PadOutput` has **one scalar `steer`**. There
 * is no second axis anywhere in the type, and the arithmetic underneath agrees:
 * `Thumb.ts`'s `thumbCurve(dx, radius, deadzone)` takes a single `dx` and
 * `thumbTravel(steer, …)` inverts a single scalar back to pixels.
 * `clampStickOrigin`'s own comment is *"the base may trail, but it may not
 * migrate out of its own half"* — one stick, one half of the screen.
 *
 * So when a walking game arrived on 2026-08-21 — the first of these games that
 * WALKS — a second stick in the other half was not a configuration of that
 * class, it was a contradiction of it, and the game wrote ninety lines by hand
 * rather than the fifteen it would have been. **This file is the fifteen.**
 *
 * WHAT IS AND IS NOT IN HERE, AND THE LINE IS THE PACKAGE'S OWN RULE.
 * ---------------------------------------------------------------------------
 * *"It knows what a stick READS, never what a button MEANS."* This file knows
 * that a thumb landed somewhere, that it has moved a certain number of pixels,
 * and how to turn that into a clamped two-axis deflection. It does not know
 * about forward, about a camera, about jumping, or about which half of the
 * screen anything is in — the caller routes pointers to sticks, because which
 * half is which is a control scheme and control schemes are a game's.
 *
 * There is no event listening here either, for the same reason `Axis.ts` has
 * no state: a class that also owned the listeners would decide `passive`,
 * decide the element, and decide what a mouse means, and every one of those is
 * a call the game has to be able to make differently.
 *
 * THE BASE TRAILS, AND THAT IS THE ONE NON-OBVIOUS BEHAVIOUR.
 * ---------------------------------------------------------------------------
 * Once the thumb travels past `radius`, the ORIGIN is dragged after it rather
 * than the deflection being clipped. Without it, a thumb that wandered north
 * while walking cannot then reach full deflection south without lifting off —
 * the stick is at full travel and the remaining range is behind the finger.
 * `ThumbPad` does the same thing for its one axis and is right to; this is that
 * behaviour minus the half-of-the-screen rule that made it unusable for two.
 *
 * UNVERIFIED AND SAYING SO. CDP touch events bypass the browser's gesture
 * arbitration, so a touch harness passes green while every button is dead
 * under a thumb, and anything touch-related is UNVERIFIED until a person holds
 * it. Nothing about moving this into a package changes that; what it changes
 * is that there is now one copy for a person to be right about.
 */

/**
 * The two numbers a stick is, and neither has a default.
 *
 * `radius` is the travel in CSS pixels that means full deflection, and
 * `deadzone` is the travel below which the stick reads exactly zero. Both are
 * required: a walk wants a bigger stick than a twin-stick shooter does, and a
 * package shipping either number would have picked one experience's feel for
 * everybody and it would have felt completely fine to whoever tuned it.
 */
export interface Stick2Spec {
  radius: number;
  deadzone: number;
}

/**
 * A floating two-axis stick.
 *
 * `x` and `y` are the deflection, each in -1..1, with the magnitude clamped to
 * 1 — a DISC, not a square, because a diagonal on a square reaches 1.41 and a
 * player who discovers that walks diagonally everywhere.
 *
 * `y` IS IN SCREEN SPACE: positive is DOWN, because that is what a
 * `PointerEvent` reports and a stick that silently flipped one axis would be a
 * seam whose two sides disagree about which way up the world is. A caller that
 * wants "forward" negates it, at the one place it also rotates into the world.
 */
export class Stick2 {
  x = 0;
  y = 0;
  /** The pointer this stick is following, or -1 for nobody. */
  pointer = -1;

  readonly #spec: Stick2Spec;
  #ox = 0;
  #oy = 0;
  #dx = 0;
  #dy = 0;

  constructor(spec: Stick2Spec) { this.#spec = spec; }

  /** True while a thumb is on it. */
  get active(): boolean { return this.pointer >= 0; }

  /**
   * Where the base currently IS, in client coordinates.
   *
   * Read-only, and it exists for exactly one caller: something that DRAWS the
   * stick. The walking game never needed it because it draws no stick at all —
   * its thumb is invisible and the figure on the screen is the feedback — so
   * the hole did not show up until `GlassPad` came to render a floating ring
   * under a thumb.
   *
   * It has to be published rather than reconstructed. The base TRAILS (see the
   * header), so "where the thumb went down" is not where the base is after a
   * long drag, and deriving it from the deflection is impossible in the other
   * direction too: inside the dead zone `x` and `y` are exactly zero for a
   * whole disc of real positions. A drawer that guessed would put the ring in
   * the wrong place only while the thumb was nearly still — which reads as the
   * ring drifting under a resting thumb, and looks like a rendering bug rather
   * than an arithmetic one.
   */
  get originX(): number { return this.#ox; }
  get originY(): number { return this.#oy; }

  /**
   * A thumb landed. The origin is wherever it landed — floating, not fixed,
   * which is the right default for the same reason `ThumbPad` chose it: a fixed
   * stick is a target a person has to look at their hands to find, and the
   * game is the thing they should be looking at.
   *
   * Ignores a second thumb while one is already down, so a hand resting on the
   * screen cannot steal a stick mid-stride.
   */
  down(pointerId: number, clientX: number, clientY: number): void {
    if (this.pointer >= 0) return;
    this.pointer = pointerId;
    this.#ox = clientX;
    this.#oy = clientY;
    this.#dx = 0;
    this.#dy = 0;
    this.x = 0;
    this.y = 0;
  }

  /**
   * The thumb moved. Returns false, and changes nothing, if this is not the
   * pointer this stick is following — so a caller can hand every `pointermove`
   * to every stick and let them sort it out.
   */
  move(pointerId: number, clientX: number, clientY: number): boolean {
    if (pointerId !== this.pointer) return false;
    this.#dx = clientX - this.#ox;
    this.#dy = clientY - this.#oy;

    // The base TRAILS past full travel. See the header for why clipping is
    // wrong: the remaining range would be behind the finger.
    const mag = Math.hypot(this.#dx, this.#dy);
    const r = this.#spec.radius;
    if (mag > r) {
      const pull = (mag - r) / mag;
      this.#ox += this.#dx * pull;
      this.#oy += this.#dy * pull;
      this.#dx -= this.#dx * pull;
      this.#dy -= this.#dy * pull;
    }
    this.#recompute();
    return true;
  }

  /**
   * The thumb lifted, or the browser cancelled the pointer. Returns false if
   * this stick was not following it.
   *
   * ZEROED, always. A stick that kept its last deflection after a
   * `pointercancel` is a figure that walks into a tree until somebody touches
   * the screen again — the touch version of the missing `blur` handler.
   */
  up(pointerId: number): boolean {
    if (pointerId !== this.pointer) return false;
    this.pointer = -1;
    this.#dx = 0;
    this.#dy = 0;
    this.x = 0;
    this.y = 0;
    return true;
  }

  /** Drop everything. For `blur`, a lost context, or a game leaving the screen. */
  clear(): void { this.up(this.pointer); this.pointer = -1; }

  #recompute(): void {
    const { radius, deadzone } = this.#spec;
    const mag = Math.hypot(this.#dx, this.#dy);
    if (mag <= deadzone) { this.x = 0; this.y = 0; return; }
    // Rescale from the EDGE of the dead zone, not from the centre: mapping
    // `mag/radius` straight through means the first pixel outside the dead zone
    // jumps to `deadzone/radius` of full deflection, which is a step a person
    // feels as the stick "catching".
    const k = Math.min(1, (mag - deadzone) / (radius - deadzone)) / mag;
    this.x = this.#dx * k;
    this.y = this.#dy * k;
  }
}
