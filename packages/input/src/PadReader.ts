/**
 * ============================================================================
 *  PadReader — finding a physical controller, reading its sticks and triggers,
 *  and driving its motors.
 * ============================================================================
 *  This is the half of a game's input file that is about the DEVICE. It knows
 *  a stick has a dead zone and a curve, that a trigger rests above zero, that
 *  a shoulder button may or may not have travel, and that a rumble motor has a
 *  minimum sensible gap between effects. It does not know, and must never
 *  know, what any of those numbers are FOR. The word for what a button means —
 *  throttle, brake, fire, the thing you hold to slide — stays in the game.
 *
 *  Every number is supplied by the caller as a `PadTuning`, because the two
 *  games this was harvested from disagree about all of them and both are
 *  right: a 0.15 dead zone with a 1.18 expo and a 0.10 dead zone with a 1.55
 *  expo are two different vehicles' idea of how much stick is "a little".
 *
 *  ---------------------------------------------------------------------------
 *  WHAT NO AUTOMATED HARNESS CAN TELL YOU ABOUT THIS FILE.
 *
 *  The way these games are actually played is with a PS5 DualSense in
 *  somebody's hands. **There is no automated instrument that can press one.**
 *  The Gamepad API is driven by real HID traffic; CDP has no gamepad domain,
 *  and a fake `navigator.getGamepads` proves only that the code reads the
 *  shape it was handed.
 *
 *  So the package harness measures the PURE FUNCTIONS in here — the dead zone,
 *  the rescale, the expo, the analogue-detection latch, the rumble gate — from
 *  synthetic frames, exhaustively and bit-exactly. It measures NOTHING about
 *  whether a real pad's axis 0 is the left stick, whether button 7 is R2, or
 *  whether `vibrationActuator.playEffect` does anything on the DualSense's
 *  firmware. Those are UNVERIFIED until a person holds one, in the same sense
 *  as anything touch-related, and for the same reason.
 * ============================================================================
 */

/**
 * Everything about a pad that is a TASTE rather than a fact about hardware.
 * The caller owns all of it; nothing here has a default, because a default
 * here would silently become one game's feel imposed on the other.
 */
export interface PadTuning {
  /** stick dead zone, rescaled away so the first live degree is not a jump */
  stickDeadzone: number;
  /** a worn stick that only reaches this must still be able to ask for full */
  stickSaturation: number;
  /** expo — fine control near centre without costing the mid-range */
  stickCurve: number;
  /** analogue triggers rest a little above zero on most pads */
  triggerDeadzone: number;
  triggerSaturation: number;
  /** seconds between rumble effects — a pad that is always buzzing says nothing */
  rumbleGap: number;
}

/** What `analogueAxis` decided a button was, this frame. */
export interface AnalogueRead {
  /** 0..1 absolute position, non-zero only once the button has PROVED it has travel */
  ana: number;
  /** 0 or 1, the digital reading for a button that has not proved anything */
  dig: number;
}

export class PadReader {
  private readonly t: PadTuning;
  /**
   * Called whenever the reader stops believing in a pad. The games use it to
   * drop "the stick was the last thing steering", which is theirs and not
   * ours: it decides whether a centred stick REPORTS centre or lets a key ramp
   * take over, and that is a question about the vehicle.
   */
  private readonly onLost: (() => void) | undefined;

  /**
   * WHICH PADS COUNT. Optional; absent means every connected pad counts, which
   * is what both racers do and what this class did originally.
   *
   * A first-person shooter needs it and could not adopt this class without it.
   * Its whole button table is STANDARD-MAPPING indices — button 7 is the right
   * trigger, button 10 is the left stick click — so a pad reporting
   * `mapping: ''` answers every one of those reads with something arbitrary.
   * Its own reader scanned for `mapping === 'standard'` on every frame; a
   * filter applied only at the CALL SITE is not the same thing, because `index`
   * is remembered here: a non-standard pad in slot 0 would be latched onto and
   * a real controller in slot 1 would never be found, and the symptom for a
   * player is a controller that does nothing at all.
   *
   * Consulted on BOTH paths — the remembered slot and the sweep — so a pad that
   * changes its own mapping (a DualSense that re-enumerates) is dropped rather
   * than kept.
   */
  private readonly accept: ((g: Gamepad) => boolean) | undefined;

  /** index into `navigator.getGamepads()`, or -1 */
  private index = -1;
  /** seconds until the next sweep while none is known */
  private scan = 0;
  /**
   * Buttons that have been OBSERVED reporting a value strictly between the
   * rails, and are therefore known to have travel. See `analogueAxis`.
   */
  private analogue = new Set<number>();

  private rumbleCooldown = 0;
  private rumbleStrength = 0;

  constructor(tuning: PadTuning, onLost?: () => void, accept?: (g: Gamepad) => boolean) {
    this.t = tuning;
    this.onLost = onLost;
    this.accept = accept;
  }

  /** `gamepadconnected` handler input. */
  connected(index: number) {
    this.index = index;
  }

  /**
   * `gamepaddisconnected` — the pad SAID it was going.
   *
   * The analogue set is cleared here, and here only. What was learned about
   * button 6's travel describes THAT pad; a different controller plugged into
   * the same slot inherits none of it, and inheriting "this one is analogue"
   * wrongly is the case that hurts — it would route a digital trigger's
   * instant 1.0 straight past whatever ramp the game put in front of the
   * digital path.
   */
  disconnected() {
    this.analogue.clear();
    this.lost();
  }

  /**
   * The slot went quiet without an event. NOT the same as `disconnected()`,
   * and the difference is a REPRODUCED DEFECT, not a design.
   *
   * `poll` reaches here when the slot it held stops answering — a pad that
   * slept, a tab restored from bfcache, a browser that simply forgot. Both
   * games shipped this path clearing the index and nothing else, so the
   * analogue-travel knowledge SURVIVES into whatever occupies the slot next,
   * and a digital shoulder on the replacement pad is read as an absolute
   * position with no onset. That is a latent bug and it is reproduced here
   * deliberately: an extraction that quietly fixed it would change how one
   * game feels on a swapped controller, inside a commit whose whole claim is
   * that nothing changed. The package's test harness carries a fault that
   * goes RED if someone later adds the clear on this path — the point
   * being that fixing it is a decision somebody makes on purpose, with a
   * re-pin, not a tidy-up on the way past.
   */
  private lost() {
    this.index = -1;
    this.onLost?.();
  }

  /** The slot currently believed to hold a pad, or -1. Reported, not decided on. */
  get slot(): number {
    return this.index;
  }

  /**
   * The connected pad, or null.
   *
   * `gamepadconnected` is the documented way in and is honoured, but it only
   * fires after the *first input* on some browsers, and never at all for a pad
   * that was already live when the tab was restored from bfcache. So a sweep
   * backstops it — throttled to twice a second while no pad is known, because
   * `getGamepads()` allocates a fresh array on every call and this is the hot
   * path a "zero per-frame allocation" rule is about.
   */
  poll(dt: number): Gamepad | null {
    const get = navigator.getGamepads;
    if (typeof get !== 'function') return null;
    if (this.index >= 0) {
      const g = get.call(navigator)[this.index];
      if (g && g.connected && (!this.accept || this.accept(g))) return g;
      this.lost();
    }
    this.scan -= dt;
    if (this.scan > 0) return null;
    this.scan = 0.5;
    const all = get.call(navigator);
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (g && g.connected && (!this.accept || this.accept(g))) { this.index = g.index; return g; }
    }
    return null;
  }

  /** Dead-zoned, rescaled and expo'd — an absolute command, -1..1. */
  axis(v: number): number {
    if (!Number.isFinite(v)) return 0;
    const m = Math.abs(v);
    if (m <= this.t.stickDeadzone) return 0;
    const n = Math.min(1, (m - this.t.stickDeadzone) / (this.t.stickSaturation - this.t.stickDeadzone));
    return Math.sign(v) * Math.pow(n, this.t.stickCurve);
  }

  /** Analogue trigger, 0..1, with its own (much smaller) rest dead zone. */
  trigger(b: GamepadButton | undefined): number {
    const v = b ? (b.value || (b.pressed ? 1 : 0)) : 0;
    if (!Number.isFinite(v) || v <= this.t.triggerDeadzone) return 0;
    return Math.min(1, (v - this.t.triggerDeadzone) / (this.t.triggerSaturation - this.t.triggerDeadzone));
  }

  /**
   * Read a button as an ABSOLUTE POSITION if it has proved it has one, and as
   * a plain press if it has not.
   *
   * THIS IS FEATURE DETECTION, NOT A GUESS, and it exists because the obvious
   * version has a bug that only appears on hardware the harness never sees.
   * The Gamepad API gives every button a `value`, so a DIGITAL shoulder reports
   * exactly 1.0 the instant it closes — and routing that straight into the
   * analogue channel would hand the game a full-scale command as a one-frame
   * step, which is precisely what the caller's ramp exists to prevent. The pad
   * would be the only input in the game with no onset.
   *
   * A button cannot be proved digital, but it CAN be proved analogue: report a
   * value strictly between the rails even once and it has a travel. So a button
   * is treated as digital — ramped, like a key — until it proves otherwise, and
   * from then on as an absolute position. One pull of the trigger is enough,
   * and a genuinely digital button never trips it.
   *
   * Same shape as the touch-width detection in the games' `TouchControls`, and
   * for the same reason: a platform that reports a value it does not have is
   * not distinguishable from one that does, except by watching.
   *
   * `curve` is expo on the analogue path only. 0 and 1 are fixed points of
   * `x**c`, so the rails do not move and only the trim range grows.
   */
  analogueAxis(index: number, b: GamepadButton | undefined, curve: number): AnalogueRead {
    if (!b) return { ana: 0, dig: 0 };
    const v = Number.isFinite(b.value) ? b.value : (b.pressed ? 1 : 0);
    if (v > 0.02 && v < 0.98) this.analogue.add(index);
    if (this.analogue.has(index)) {
      // A pad whose LB rests at 0.03 of electrical noise would otherwise hold a
      // permanent 3% command, and nobody would ever trace it back to the
      // controller.
      const n = v <= this.t.triggerDeadzone
        ? 0
        : Math.min(1, (v - this.t.triggerDeadzone) / (this.t.triggerSaturation - this.t.triggerDeadzone));
      return { ana: n <= 0 ? 0 : Math.pow(n, curve), dig: 0 };
    }
    return { ana: 0, dig: v > 0.5 || b.pressed ? 1 : 0 };
  }

  /**
   * Fire a rumble effect if the attached pad can. Everything is best-effort:
   * `playEffect` is absent on Safari and rejects on a pad that has lost its
   * actuator, and a rejected promise here must never reach the player.
   *
   * A PHONE IS A DIFFERENT DEVICE AND IS NOT DRIVEN FROM HERE. `strong` is a
   * dual-rumble MAGNITUDE, 0..1; `navigator.vibrate` takes a pattern in
   * milliseconds and has no magnitude at all. Conflating the two is a shipped
   * bug with a name: a game gated its phone vibration on `strong > 0.55`, so
   * the two low-magnitude events its whole feel was built on never vibrated
   * while being hit by a weapon did. See `Pulse.ts`, which is separate for
   * exactly that reason.
   */
  rumble(strong: number, weak: number, ms: number) {
    if (strong <= 0.02) return;
    // A weak effect must not cut a strong one short; a strong one may cut a
    // weak one, otherwise a big hit lands silently behind a small tick.
    if (this.rumbleCooldown > 0 && strong <= this.rumbleStrength) return;
    this.rumbleCooldown = Math.max(this.t.rumbleGap, ms / 1000);
    this.rumbleStrength = strong;

    const g = this.index >= 0 ? navigator.getGamepads?.()?.[this.index] : null;
    const act = (g as unknown as { vibrationActuator?: { playEffect?: (t: string, o: unknown) => unknown } } | null)?.vibrationActuator;
    if (act && typeof act.playEffect === 'function') {
      try {
        const p = act.playEffect('dual-rumble', {
          startDelay: 0, duration: ms,
          strongMagnitude: clamp01(strong), weakMagnitude: clamp01(weak),
        }) as { catch?: (f: () => void) => void } | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* an actuator that refuses is not an error worth surfacing */ }
    }
  }

  /** Age the rumble gate. Call once a frame. */
  tick(dt: number) {
    if (this.rumbleCooldown > 0) {
      this.rumbleCooldown -= dt;
      if (this.rumbleCooldown <= 0) this.rumbleStrength = 0;
    }
  }
}

export function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
