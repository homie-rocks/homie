/**
 * ============================================================================
 *  PinchPan — one finger drags, two fingers pan and pinch.
 * ============================================================================
 *
 *  The bookkeeping every touch camera needs and nobody enjoys writing twice:
 *  which pointers are down, where each one was last frame, how far the first
 *  one has travelled since it landed, whether that is far enough to be a drag
 *  rather than a tap, and how far apart two fingers are.
 *
 *  ## WHAT THIS DELIBERATELY DOES NOT DECIDE, AND IT IS THE IMPORTANT HALF
 *
 *  **Every sign, and every scale.** The sink is handed RAW client-space deltas
 *  in pixels — `dx` positive to the RIGHT of the screen, `dy` positive DOWN,
 *  exactly as the browser reports them — and the caller decides what that means
 *  about its camera.
 *
 *  That is not fastidiousness: correct a handedness convention exactly once, at
 *  the input boundary, and record both halves. The game this came out of has
 *  two conventions that are OPPOSITE and BOTH CORRECT — a key moves the camera,
 *  a drag moves the world — and it took fifteen iterations and a human to
 *  settle which sign belonged where. A package that negated a delta on the way
 *  out would put half of that decision somewhere the game cannot see it, and
 *  the symptom is a control that feels backwards with nothing red anywhere.
 *  That exact failure was once measured in this exact code path: **ten of
 *  twenty-six controls inverted**, every one of them an X axis, found by a
 *  harness and not by a reviewer.
 *
 *  So: pixels out, decisions in the game. The only number in here is the slop.
 *
 *  ## WHERE IT CAME FROM
 *
 *  A base-building game's input module. The question is *"does this belong in
 *  a game"*, never *"is there a twin"* — and a pointer map with a tap deadzone
 *  is not a fact about a colony game however many copies of it exist.
 * ============================================================================
 */

/** Where the caller's deltas arrive. Both are raw client-space pixels. */
export interface PinchPanSink {
  /**
   * One finger, moving, past the slop, and not locked out.
   *
   * `dx` / `dy` are this move's client-space delta. Nothing is accumulated for
   * you: a caller that wants a total keeps one.
   */
  oneFinger(dx: number, dy: number): void;
  /**
   * Two or more fingers.
   *
   * `dx` / `dy` are ONE finger's delta, HALVED — with two fingers moving
   * together each reports its own delta, so the centroid would otherwise travel
   * at twice the finger speed.
   *
   * `spread` is the change in the distance between the FIRST TWO fingers, in
   * pixels. `pinching` says whether that number is MEASURABLE: false on the
   * frame a second finger lands, and false whenever the two reference fingers
   * are on top of each other, because there is no previous distance to compare
   * against and inventing one from zero is a full-screen zoom on touch-down.
   *
   * THE TWO ARE SEPARATE AND THAT IS NOT REDUNDANT. A three-finger frame where
   * the third finger moves reports `spread: 0` WITH `pinching: true` — the
   * pinch is real and this frame's change in it happens to be nothing — and a
   * caller that anchors its zoom to the pointer needs to tell that apart from
   * "there is no pinch". Collapsing them into `spread !== 0` was the first
   * draft and a parity probe caught it: two of twenty-two gesture replays
   * disagreed with the original code on the zoom anchor.
   */
  twoFinger(dx: number, dy: number, spread: number, pinching: boolean): void;
}

/**
 * The pointer bookkeeping. No DOM listeners of its own: the caller already has
 * a `pointerdown` / `pointermove` / `pointerup` triple for the mouse and routes
 * `e.pointerType === 'touch'` in here, which keeps ONE place deciding what kind
 * of input an event is.
 */
export class PinchPan {
  readonly #host: Element;
  readonly #sink: PinchPanSink;
  /** Travel in pixels before one finger counts as a drag rather than a tap. */
  readonly #slop: number;

  /** Pointer id → where it was last seen. Insertion order is arrival order. */
  readonly #touches = new Map<number, { x: number; y: number }>();
  #pinchDist = 0;
  #travel = 0;
  #armed = false;

  /**
   * Suppress the ONE-finger path while something else owns the drag.
   *
   * A caller sets this while a cable, a lasso or a brush is armed. Two fingers
   * still pan and pinch, deliberately: taking the camera away entirely would
   * strand a player who has armed a tool and now needs to look somewhere else.
   */
  locked = false;

  /**
   * @param slop pixels of travel before one finger becomes a drag. A tap that
   *             jitters six pixels used to swing the camera and never select,
   *             the kind of defect that survives review because every
   *             reviewer is looking at stills. There is
   *             no default: a game's tap slop should match the one its own
   *             click handler uses, and a package guessing means two numbers
   *             that agree today.
   */
  constructor(host: Element, sink: PinchPanSink, slop: number) {
    if (!(slop > 0)) throw new Error(`PinchPan: slop is ${slop}; a zero deadzone makes every tap a drag`);
    this.#host = host;
    this.#sink = sink;
    this.#slop = slop;
  }

  /** How many fingers are down. */
  get fingers(): number {
    return this.#touches.size;
  }

  down(e: { pointerId: number; clientX: number; clientY: number }): void {
    this.#touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#touches.size === 1) {
      this.#travel = 0;
      this.#armed = false;
      try { (this.#host as Element & { setPointerCapture?(id: number): void }).setPointerCapture?.(e.pointerId); } catch { /* not all hosts allow it */ }
    }
    if (this.#touches.size === 2) this.#pinchDist = this.#spread();
  }

  move(e: { pointerId: number; clientX: number; clientY: number }): void {
    const prev = this.#touches.get(e.pointerId);
    if (prev === undefined) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;

    if (this.#touches.size === 1) {
      this.#travel += Math.abs(dx) + Math.abs(dy);
      if (!this.#armed) {
        if (this.#travel < this.#slop) return;
        this.#armed = true;
      }
      if (this.locked) return;
      this.#sink.oneFinger(dx, dy);
      return;
    }
    if (this.#touches.size >= 2) {
      // Armed unconditionally: two fingers is never a tap, and leaving it
      // unarmed would let the pinch that follows a two-finger landing be read
      // as a tap when one finger lifts.
      this.#armed = true;
      const d = this.#spread();
      const pinching = this.#pinchDist > 0 && d > 0;
      // The delta is taken BEFORE the reference distance is replaced. Writing
      // `this.#pinchDist = d` first and then subtracting would report zero on
      // every frame, which is a pinch that renders, arms and does nothing.
      const spread = pinching ? d - this.#pinchDist : 0;
      this.#pinchDist = d;
      this.#sink.twoFinger(dx * 0.5, dy * 0.5, spread, pinching);
    }
  }

  up(e: { pointerId: number }): void {
    this.#touches.delete(e.pointerId);
    if (this.#touches.size < 2) this.#pinchDist = 0;
    if (this.#touches.size === 0) {
      try { (this.#host as Element & { releasePointerCapture?(id: number): void }).releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
    }
  }

  /** Everything is up. A blur or a page hide; the state cannot be re-derived. */
  clear(): void {
    this.#touches.clear();
    this.#pinchDist = 0;
    this.#travel = 0;
    this.#armed = false;
  }

  /** Distance between the first two fingers, in pixels. 0 when there are not two. */
  #spread(): number {
    const it = this.#touches.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
