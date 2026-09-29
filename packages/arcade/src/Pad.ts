/**
 * ============================================================================
 *  @homie-rocks/arcade/Pad.ts — what one person's controls read this frame.
 * ============================================================================
 *
 *  ## THIS IS THE SAME SHAPE @homie-rocks/input ALREADY SPEAKS, DELIBERATELY
 *
 *  `@homie-rocks/input/Keys.ts` is the keyboard's latch: `has` for held, `pressed`
 *  for a rising edge, `endFrame()` at the bottom of the update. Four games
 *  already read it and one of them has a comment explaining the difference
 *  between the two reads — *"a one-frame ghost of a held axis reads as a
 *  twitch on the rudder"*.
 *
 *  A phone pad that invented its own vocabulary would mean a game reading
 *  `k.pressed('KeyE')` on the keyboard and `pad.wasPressed('hail')` on the
 *  phone, which is two control schemes that have to be kept in agreement by
 *  hand. So the names here are `has` / `hit` / `endFrame`.
 *  **One convention, two transports.**
 *
 *  ## AND THE ONE PLACE THE CONVENTION DOES NOT LINE UP, SAID OUT LOUD
 *
 *  **`Pad.hit` IS AN EDGE. `Keys.hit` IS NOT.** This header used to claim they
 *  were the same read and it was WRONG: `Keys.hit` returns `held || latched`,
 *  which is true every frame a key is held down, and the equivalence was
 *  asserted in two places in this file with nothing measuring it. A game that
 *  believed it — one control-reading path, `keys.hit('Space')` for a stab and
 *  `pad.hit('jump')` for a stab — got a stab on the phone and a machine-gun on
 *  the keyboard. Both racers already carried a hand-rolled `wasX` boolean
 *  beside the call to work around it, and another game hand-rolled its whole
 *  keyboard rather than use the class.
 *
 *  `Keys.pressed` was added as the edge, and `Keys.hit` was left alone — it
 *  is read for held AXES in two shipped racers and quietly turning it into an
 *  edge would change how they steer. **`Pad.hit` pairs with `Keys.pressed`.**
 *  A keys-edge probe asserts both halves of that, including that `Keys.hit`
 *  is NOT an edge, so this paragraph cannot rot back into the sentence it
 *  replaced.
 *
 *  ## THE LATCH IS THE WHOLE FILE AND IT IS NOT AN OPTIMISATION
 *
 *  `Keys` exists because a press and a release that both land between two
 *  frames would otherwise be lost. On a phone that window is WIDER, not
 *  narrower: a press crosses a LAN, a host, an SSE stream and a browser task
 *  queue, and two of them may arrive in the same macrotask. Without the latch
 *  a double-tap on a drum pad is one hit, on the exact hardware whose entire
 *  premise is that the phone is the controller.
 *
 *  So a press raises the edge AND holds it until `endFrame()`, whatever the
 *  release did in between. `#buttons` is what the wire last said; `#edges` is
 *  what this frame gets to see.
 *
 *  ## AXES ARE NOT LATCHED, AND THAT IS THE OTHER HALF
 *
 *  A stick is a POSITION, not an event. The last value the wire delivered is
 *  the value, and a frame with no packet reads the previous one rather than
 *  springing to zero — a stick that recentred on every dropped packet is a
 *  walk that stutters on a contended access point, which is what a room full
 *  of phones is. Recentring on DISCONNECT is a different question and it
 *  belongs to `Table.ts`, which is the thing that knows a seat left.
 *
 *  ## UNVERIFIED, AND SAYING SO IS PART OF THE FILE
 *
 *  CDP touch events bypass the browser's gesture arbitration, so a touch
 *  harness passes green while every button is dead under a thumb. Anything
 *  touch-related is UNVERIFIED until a person holds it. Everything in this
 *  file is driven from a MESSAGE, not from a thumb, so the latch, the clamp
 *  and the edge are all verifiable here and the thumb that produces the
 *  message is not. The seat probe drives messages. Nobody has held this.
 * ============================================================================
 */

import { arcadeFaultActive } from './faults.ts';
import type { ControlSpec } from './Roles.ts';

/** A stick's two axes. Screen space: `y` positive is DOWN, as `Stick2` reports it. */
export interface Stick {
  x: number;
  y: number;
}

/**
 * How far off centre a wire value has to be before it counts.
 *
 * NOT A DEADZONE. `@homie-rocks/input`'s dead zone is a FEEL decision and belongs to
 * the game — `Stick2Spec.deadzone` is required for exactly that reason. This
 * is a transport floor: values below it are the JSON round trip of a thumb
 * that is not touching anything, and passing them through would make
 * `touched` — the one boolean that says whether anybody has played with this at
 * all — read a resting phone in a pocket as somebody playing, for ever.
 */
const WIRE_FLOOR = 1e-6;

function clamp1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

/**
 * One seat's controls.
 *
 * Built from a role's `ControlSpec[]`, so a pad only ever holds controls its
 * role declared. An unknown id from the wire is COUNTED and dropped — see
 * `unknown`. A pad that accepted anything would make a typo in a phone page
 * into a control that silently never fires, a field-name failure that has
 * already been paid for once.
 */
export class Pad {
  readonly #sticks = new Map<string, Stick>();
  readonly #buttons = new Map<string, boolean>();
  readonly #edges = new Set<string>();
  readonly #sliders = new Map<string, number>();

  /**
   * Messages this pad could not place. Never zero silently: a probe reads it,
   * and a game may. The alternative — dropping in silence — is the exact shape
   * that made every arrival announce itself in red.
   */
  unknown = 0;

  /** True once anything on this pad has moved, ever. Never goes back to false. */
  touched = false;

  constructor(controls: readonly ControlSpec[]) {
    for (const c of controls) {
      if (c.kind === 'stick') this.#sticks.set(c.id, { x: 0, y: 0 });
      else if (c.kind === 'button') this.#buttons.set(c.id, false);
      else this.#sliders.set(c.id, 0);
    }
  }

  /**
   * A stick, by id. Returns a FROZEN zero for an id this role does not have.
   *
   * Not null, and not a throw. A game that asks a spectator's pad for the
   * pilot's stick is asking a legitimate question — "is anybody driving" — and
   * the honest answer is "that control is centred", every frame, for ever. A
   * throw there would take the frame down because somebody walked out of the
   * room.
   */
  stick(id: string): Readonly<Stick> {
    return this.#sticks.get(id) ?? CENTRED;
  }

  /** A button, held. Same contract as `@homie-rocks/input/Keys.has`. */
  has(id: string): boolean {
    return this.#buttons.get(id) === true;
  }

  /**
   * A button's rising edge, true for exactly one frame.
   *
   * PAIRS WITH `@homie-rocks/input/Keys.pressed`, NOT with `Keys.hit` — this line
   * once said "Same as `Keys.hit`" and that was false. See the header, and
   * the keys-edge probe, which measures both.
   */
  hit(id: string): boolean {
    return this.#edges.has(id);
  }

  /** A slider, -1..1. Zero for an id this role does not have — see `stick`. */
  slider(id: string): number {
    return this.#sliders.get(id) ?? 0;
  }

  /** How many buttons are down. `Keys.down` by the same name and meaning. */
  get down(): number {
    let n = 0;
    for (const v of this.#buttons.values()) if (v) n += 1;
    return n;
  }

  /* -- the wire ----------------------------------------------------------- */

  /**
   * One control message. Returns whether it landed on a declared control.
   *
   * `value` is the payload the phone sent: `{x,y}` for a stick, a number for a
   * slider, a boolean for a button. Anything else is unknown and counted.
   */
  apply(id: string, value: unknown): boolean {
    const s = this.#sticks.get(id);
    if (s) {
      const v = value as { x?: unknown; y?: unknown } | null;
      const x = clamp1(Number(v && typeof v === 'object' ? v.x : NaN));
      const y = clamp1(Number(v && typeof v === 'object' ? v.y : NaN));
      s.x = x;
      s.y = y;
      if (Math.abs(x) > WIRE_FLOOR || Math.abs(y) > WIRE_FLOOR) this.touched = true;
      return true;
    }
    if (this.#sliders.has(id)) {
      const n = clamp1(Number(value));
      this.#sliders.set(id, n);
      if (Math.abs(n) > WIRE_FLOOR) this.touched = true;
      return true;
    }
    if (this.#buttons.has(id)) {
      const down = value === true || value === 1 || value === 'down';
      // THE LATCH. The edge is raised on the transition and is NOT cleared by a
      // release in the same frame — only `endFrame()` clears it. See the header.
      //
      // FAULT ANCHOR — `no-latch` clears the edge on release, which is the
      // shape every hand-rolled version of this has: a boolean called
      // `pressed` that tracks the wire. It is invisible on a held button and
      // it eats every double-tap, and there is no acknowledgement channel to
      // notice with — `@homie-rocks/input/PressBuffer`'s header is the same argument
      // one layer up.
      if (down && this.#buttons.get(id) !== true) this.#edges.add(id);
      if (!down && arcadeFaultActive('no-latch')) this.#edges.delete(id);
      this.#buttons.set(id, down);
      if (down) this.touched = true;
      return true;
    }
    this.unknown += 1;
    return false;
  }

  /**
   * End of this game frame. Call it once, at the bottom of the update, exactly
   * as `@homie-rocks/input/Keys.endFrame()` is called.
   */
  endFrame(): void {
    this.#edges.clear();
  }

  /**
   * Everything to zero, and the edges with it.
   *
   * Called when a seat LEAVES rather than when a packet is missed — see the
   * header. A phone that goes out of the door with its stick pushed forward
   * must not leave a boat under power in front of the room.
   */
  release(): void {
    for (const s of this.#sticks.values()) { s.x = 0; s.y = 0; }
    for (const id of [...this.#buttons.keys()]) this.#buttons.set(id, false);
    for (const id of [...this.#sliders.keys()]) this.#sliders.set(id, 0);
    this.#edges.clear();
  }
}

/**
 * The stick a pad returns for a control it does not have.
 *
 * ONE frozen instance, shared. A fresh object per call would allocate on every
 * read of every absent control on every frame, and freezing it is what stops a
 * caller writing into the shared one — which would make an absent control on
 * one pad start reading as a pushed stick on every other.
 */
const CENTRED: Readonly<Stick> = Object.freeze({ x: 0, y: 0 });
