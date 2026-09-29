/**
 * ============================================================================
 *  Keys — held state and one-frame latching for a physical keyboard.
 * ============================================================================
 *  Two sets, and the second one is the whole point.
 *
 *  `held` is what is down right now. Edges derived by polling it once a frame
 *  MISS a press and release that land entirely between two frames — a 16 ms
 *  window at 60 fps, which a quick stab at a button really does hit — so
 *  `latched` records every code that went DOWN since the last `endFrame()`,
 *  whether or not it is still held. `hit()` reads both; `has()` reads only the
 *  held set, because a one-frame ghost of a held axis feels like a twitch.
 *
 *  The caller decides which of its buttons want which. In both games harvested
 *  here, steering and throttle are `has` and the edge-triggered buttons are
 *  `hit`, and getting that wrong is felt rather than seen.
 *
 *  `swallow` is the set of codes whose default the page must not get — space
 *  and the arrows scroll. It is a constructor argument and not a constant,
 *  because which keys a game owns is the game's business. Note what is
 *  deliberately absent from both games' sets: `Enter`. It is a game key in
 *  both, but swallowing it would also stop a focused menu button activating.
 * ============================================================================
 */

export class Keys {
  private readonly swallow: Set<string>;
  private held = new Set<string>();
  private latched = new Set<string>();
  private listening = false;

  constructor(swallow: Iterable<string>) {
    this.swallow = new Set(swallow);
  }

  listen() {
    if (this.listening) return;
    this.listening = true;
    addEventListener('keydown', this.onDown);
    addEventListener('keyup', this.onUp);
    addEventListener('blur', this.onBlur);
  }

  stop() {
    this.listening = false;
    removeEventListener('keydown', this.onDown);
    removeEventListener('keyup', this.onUp);
    removeEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!e.repeat) this.latched.add(e.code);
    this.held.add(e.code);
    if (this.swallow.has(e.code)) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => { this.held.delete(e.code); };

  /** Losing focus mid-corner must not leave a key stuck down. */
  private onBlur = () => { this.held.clear(); this.latched.clear(); };

  /**
   * A SECOND TRANSPORT WRITING INTO THE SAME CODE SET, and the reason it did
   * not exist at first is worth stating rather than being a gap.
   *
   * Both racers merge a phone into the game at the SEAT layer —
   * `withKeyboardFallback` displaces the local input wholesale and the keyboard
   * never sees the phone at all. A first-person shooter merges at the CODE
   * layer instead,
   * because a shooter has a mouse: `Mouse0` and `Mouse2` are held codes in the
   * same set as `KeyW`, and a phone's FIRE is the same thing arriving over the
   * wire. Its own hand-rolled keyboard therefore had `this.keys.add('Mouse0')`
   * in six places and this class could not be adopted at all.
   *
   * `down`/`up` write the HELD set; `press` raises a rising edge without a
   * hold, which is what an edge-mode button on a `GlassPad` reports. Nothing
   * here calls `preventDefault` — a synthetic code never had a default.
   */
  hold(code: string) { this.held.add(code); }

  /** Release a synthetic code. A real keyup for the same code does the same. */
  release(code: string) { this.held.delete(code); }

  /** Raise a rising edge for a code nobody is holding. Cleared by `endFrame`. */
  press(code: string) { this.latched.add(code); }

  /** Held right now. */
  has(...codes: string[]): boolean {
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  /**
   * A TRUE RISING EDGE: went down since the last `endFrame()`, and nothing
   * else. True for exactly one frame however long the key is then held.
   *
   * ADDED BECAUSE TWO PACKAGES DISAGREED ABOUT WHAT `hit` MEANS,
   * IN WRITING, AND ONE OF THEM WAS WRONG. `@homie-rocks/arcade/Pad.ts` says of its
   * own `hit`: *"A button's rising edge, true for exactly one frame. Same as
   * `Keys.hit`."* and its header says *"`has` for held, `hit` for a rising
   * edge … the names here mean exactly what `Keys` means by them. One
   * convention, two transports."* `Pad.hit` reads `#edges`, which IS an edge.
   * `hit` below reads `held || latched`, which is TRUE EVERY FRAME A KEY IS
   * HELD. They are not the same read and never were.
   *
   * WHAT THAT COSTS, CONCRETELY: a game that believes the promise writes one
   * control-reading path — `keys.hit('Space')` for a stab on the keyboard,
   * `pad.hit('jump')` for a stab on a phone — and gets a stab on the phone and
   * a machine-gun on the keyboard. Both racers already work around it by hand
   * (`const ne = b && !this.wasItem` in one racer's input module, and the same
   * shape in the other's), which is the tell: three consumers each keeping
   * their own `wasX` boolean beside a method that claims to have done it.
   * A walking game did the same for its jump and that is exactly why it could
   * not use this class at all.
   *
   * `hit` IS NOT CHANGED, and that is deliberate rather than timid: it is read
   * for held axes as well as for buttons in two shipped racers, its own comment
   * above describes what it does correctly, and quietly making it an edge would
   * change how two games steer from a package that does not own them. The name
   * is unfortunate and the fix is a second, honestly-named read.
   */
  pressed(...codes: string[]): boolean {
    for (const c of codes) if (this.latched.has(c)) return true;
    return false;
  }

  /** Held OR pressed-since-the-last-frame. NOT an edge — see `pressed`. */
  hit(...codes: string[]): boolean {
    for (const c of codes) if (this.held.has(c) || this.latched.has(c)) return true;
    return false;
  }

  /** How many keys are down — "the player did something deliberate". */
  get down(): number {
    return this.held.size;
  }

  /**
   * How many rising edges are waiting to be read this frame.
   *
   * The companion to `down` for the same question — "did the player do
   * anything" — and it exists because `down` alone answers NO for a stab that
   * landed and released between two frames, which is the case `latched` was
   * added for in the first place.
   */
  get edges(): number {
    return this.latched.size;
  }

  /** One frame of visibility per press, then gone. Call at the END of update. */
  endFrame() {
    this.latched.clear();
  }
}
