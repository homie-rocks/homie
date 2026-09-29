/**
 * ============================================================================
 *  @homie-rocks/arcade/XR.ts — the headset's own controllers, as a seat at the table.
 * ============================================================================
 *
 *  ## WHY THIS IS A SEAT AND NOT A NEW INPUT PATH
 *
 *  `Local.ts` already answers this exact question for a keyboard, and its
 *  answer is the reason adoption is free: *"a game writes ONE control-reading
 *  path and it works with phones, with a keyboard, and with both at once"*. A
 *  person in a headset is one more person in front of the game whose controls
 *  do not arrive over a wire, and there is nothing about them that is
 *  interestingly different from the person at the keyboard.
 *
 *  So a headset's triggers and thumbsticks are bound to a role's controls the
 *  same way keys are, post the same `input` events into the same driven feed,
 *  land in the same `Pad`, and are read by the same `pad.hit('tap')` a game
 *  already wrote. **No game's control-reading code changes and the protocol is
 *  not touched at all** — the host's protocol is the phone's wire and a VR
 *  player is not a phone.
 *
 *  ## THE SEAT MINTS WHEN A SESSION OPENS AND LEAVES WHEN IT CLOSES
 *
 *  That is the one place this differs from `keyboardSeats`, which mints at
 *  construction. A keyboard is always there; a headset is a thing somebody puts
 *  on. A seat that existed before the session would hold a role while nobody
 *  could possibly be using it, which on a full table is a chair taken from a
 *  guest who is actually in the room. `drivenFeed` replays its roster to a late
 *  subscriber, so a seat arriving minutes after the `Table` was built is
 *  ordinary rather than a race — see that function's header, which was written
 *  because exactly this ordering had already cost a game its Space bar.
 *
 *  ## SEATS ARE STRINGS, `xr:0`, FOR `Local.ts`'s REASON
 *
 *  *"A synthetic client that impersonates the real device destroys your ability
 *  to tell them apart."* A VR player is not synthetic — there is a person in
 *  there — but they are not a seat the room minted either, and a roster, a log
 *  or a probe must be able to say which is which without inspecting anything.
 *
 *  ## UNVERIFIED, AND SAYING SO IS PART OF THE FILE
 *
 *  **Nobody has worn this.** It was written without a headset. The button
 *  indices below are the WebXR standard `xr-standard` gamepad mapping, read
 *  from the specification, and the bindings a game writes against them are
 *  therefore a claim about hardware nobody here has held. Anything under a
 *  thumb is UNVERIFIED until a person holds it; a headset's trigger is under
 *  a finger and the rule is the same one.
 * ============================================================================
 */

import { drivenFeed, type DrivenFeed, type LocalSeats } from './Local.ts';
import type { ControlSpec, SeatId, TableSpec } from './Roles.ts';

/**
 * The prefix on every seat this file mints. The package's own string, never the
 * room's — same contract as `KEY_SEAT_PREFIX`.
 */
export const XR_SEAT_PREFIX = 'xr:';

/**
 * ============================================================================
 *  THE `xr-standard` GAMEPAD MAPPING, WRITTEN OUT SO NOBODY HAS TO GUESS.
 * ============================================================================
 *  WebXR gives every motion controller the same button and axis order, and a
 *  game binding to raw indices would be a game full of `buttons[3]`. These are
 *  the names the specification gives those positions, on the controller in ONE
 *  hand:
 *
 *    buttons[0]  trigger        the index finger
 *    buttons[1]  squeeze        the grip, under the middle fingers
 *    buttons[2]  touchpad       absent on Touch-style controllers
 *    buttons[3]  thumbstick     pressing the stick IN
 *    buttons[4]  primary        A on the right hand, X on the left
 *    buttons[5]  secondary      B on the right hand, Y on the left
 *
 *    axes[0..1]  touchpad x, y
 *    axes[2..3]  thumbstick x, y  — **y is NEGATIVE when pushed FORWARD**
 *
 *  THAT LAST LINE IS THE TRAP. WebXR's thumbstick y is negative away from the
 *  player, which is the OPPOSITE of `Local.ts`'s screen convention where *"up
 *  is -y"*… and therefore, by luck rather than design, the same sign. It is
 *  written out and converted explicitly below rather than left as a
 *  coincidence, because a coincidence is a thing somebody tidies.
 */
export const XR_BUTTON = Object.freeze({
  trigger: 0,
  squeeze: 1,
  touchpad: 2,
  thumbstick: 3,
  primary: 4,
  secondary: 5,
});

/** What a headset can be bound to. A stick is one thumbstick; a button is one of the six. */
export type XRBinding =
  | { readonly from: 'button'; readonly hand: 'left' | 'right'; readonly index: number }
  | { readonly from: 'stick'; readonly hand: 'left' | 'right' }
  | { readonly from: 'trigger-analogue'; readonly hand: 'left' | 'right' };

/** One person in a headset, and every control they own. */
export interface XRSeatBinding {
  /** What the roster calls them. Shown on the screen, never acted on. */
  readonly name: string;
  /** Which job. Must be a role id from the spec. */
  readonly role: string;
  /**
   * Binding per control id. THROWS on a control with no binding, at the moment
   * the game boots — `Local.ts`'s rule, for its reason: a silent default is two
   * people on the same four keys, and here it would be a control that is simply
   * dead in VR while working perfectly everywhere else.
   */
  readonly controls: Readonly<Record<string, XRBinding>>;
}

/**
 * What this file needs to know about the headset, without knowing what a
 * headset is.
 *
 * STRUCTURAL, AND IT IS THE WHOLE REASON THIS FILE CAN LIVE IN `@homie-rocks/arcade`.
 * The pointers come from `@homie-rocks/render/xr.ts`, which imports three; this
 * package must not, and does not. It reads two arrays of numbers and a string.
 */
export interface XRPointerLike {
  readonly handedness: string;
  readonly connected: boolean;
  readonly buttons: readonly boolean[];
  readonly axes: readonly number[];
}

/** The handle a game holds: the feed, the seat, and the once-a-frame read. */
export interface XRSeats extends LocalSeats {
  /** A session opened. Mints the seats. Idempotent. */
  open(): void;
  /** A session closed. The seats leave. Idempotent. */
  close(): void;
  /** Read the controllers and post whatever changed. Call once a frame. */
  poll(pointers: readonly XRPointerLike[]): void;
}

/**
 * Wire a headset's controllers to a table's feed.
 *
 * Polled rather than event-driven for `keyboardSeats`'s reason and one more: a
 * WebXR `Gamepad`'s arrays are live views the runtime rewrites under the page,
 * so there is no event to subscribe to at all — reading them once a frame IS
 * the API. `@homie-rocks/render/xr.ts` copies them before handing them over, so the
 * two reads in one frame cannot disagree.
 */
export function xrSeats(spec: TableSpec, seats: readonly XRSeatBinding[]): XRSeats {
  const driven: DrivenFeed = drivenFeed();
  const last = new Map<string, string>();
  const minted: SeatId[] = [];
  let open = false;

  interface Wired {
    seat: SeatId;
    id: string;
    kind: ControlSpec['kind'];
    binding: XRBinding;
  }
  const wired: Wired[] = [];

  seats.forEach((who, index) => {
    const role = spec.roles.find((r) => r.id === who.role);
    if (!role) throw new Error(`xrSeats: no role called ${JSON.stringify(who.role)} in this table`);
    const seat: SeatId = XR_SEAT_PREFIX + String(index);
    minted.push(seat);
    for (const c of role.controls) {
      const binding = who.controls[c.id];
      if (binding === undefined) {
        throw new Error(`xrSeats: ${JSON.stringify(who.name)} has no headset binding for ${JSON.stringify(c.id)}`);
      }
      /*
       * THE KINDS HAVE TO AGREE AND THE MISMATCH IS REFUSED AT THE DOOR.
       * A thumbstick bound to a BUTTON control would post "0.412,-0.883" as a
       * button value, `Pad` would read it as neither 'down' nor 'up', and the
       * control would be dead — with nothing thrown, in VR only, on hardware
       * nobody here has. That is precisely the class of defect that is
       * discovered by a person wearing the headset and by nothing else.
       */
      const wants = binding.from === 'stick' ? 'stick'
        : binding.from === 'trigger-analogue' ? 'slider' : 'button';
      if (wants !== c.kind) {
        throw new Error(
          `xrSeats: ${JSON.stringify(c.id)} is a ${c.kind} and ${JSON.stringify(who.name)} bound it ` +
          `to a headset ${binding.from}, which is a ${wants}`);
      }
      wired.push({ seat, id: c.id, kind: c.kind, binding });
    }
  });

  const find = (pointers: readonly XRPointerLike[], hand: string): XRPointerLike | undefined =>
    pointers.find((p) => p.connected && p.handedness === hand);

  return {
    driven,
    seats: minted,
    open() {
      if (open) return;
      open = true;
      seats.forEach((who, index) => {
        driven.arrive({ seat: minted[index]!, name: who.name });
      });
    },
    close() {
      if (!open) return;
      open = false;
      // The remembered values go with the seat. Without this, a second session
      // posts nothing at all for a stick that happens to be resting where it
      // was when the first one ended — a control that works until somebody
      // takes the headset off and then does not, which is unattributable.
      last.clear();
      for (const seat of minted) driven.leave(seat);
    },
    poll(pointers) {
      if (!open) return;
      for (const w of wired) {
        const hand = find(pointers, w.binding.hand);
        let value: string;
        if (w.binding.from === 'stick') {
          // See XR_BUTTON's header: axes[2..3] is the thumbstick and its y is
          // already negative-forward, which is the screen convention
          // `Local.ts` and `Surface.ts` both speak. Converted explicitly.
          const x = hand?.axes[2] ?? 0;
          const y = hand?.axes[3] ?? 0;
          value = clampAxis(x) + ',' + clampAxis(y);
        } else if (w.binding.from === 'trigger-analogue') {
          /*
           * A TRIGGER IS NOT A BUTTON AND THIS IS THE ONE PLACE THAT MATTERS.
           * `xr-standard` reports trigger pull as a BUTTON's `value` in 0..1,
           * which `XRPointerLike` does not carry — it carries `pressed`. A
           * slider bound here is therefore two-state today: 0 or 1. SAID OUT
           * LOUD rather than pretended: a throttle bound this way is on or off,
           * and making it analogue means widening `XRPointerLike` to carry the
           * value, which is a change `@homie-rocks/render/xr.ts` has to make first.
           * Sized, not done, and nothing here claims otherwise.
           */
          value = (hand?.buttons[XR_BUTTON.trigger] === true ? 1 : 0).toFixed(3);
        } else {
          value = hand?.buttons[w.binding.index] === true ? 'down' : 'up';
        }
        // Only on change. Re-posting an unchanged value every frame is ninety
        // messages a second saying nothing happened, and `Pad`'s latch means
        // the edge survives regardless.
        const key = String(w.seat) + '/' + w.id;
        if (last.get(key) === value) continue;
        last.set(key, value);
        driven.input(w.seat, w.id, value);
      }
    },
  };
}

/**
 * A stick axis, clamped and rounded to the wire's three places.
 *
 * NOT A DEAD ZONE. `Pad.ts` is explicit that a dead zone is a FEEL decision and
 * belongs to the game; this only stops a runtime reporting 1.0000001 — which
 * some do — from reaching a game that trusts the range.
 */
function clampAxis(v: number): string {
  if (!Number.isFinite(v)) return '0.000';
  return Math.min(1, Math.max(-1, v)).toFixed(3);
}
