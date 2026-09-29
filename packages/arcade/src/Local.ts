/**
 * ============================================================================
 *  @homie-rocks/arcade/Local.ts — a room you can drive from a test, and from a sofa.
 * ============================================================================
 *
 *  Two consumers, and they are the same code for a reason worth stating.
 *
 *  **A harness.** A seat probe puts 0, 1, 3, 6, 12 and 32 people in a room
 *  inside a Node process. Occupancy is the axis nothing else varied — a join
 *  screen once put its entry point 1,637 points down a 1,080-point screen at
 *  thirty-two people, and every harness had put at most one person in the
 *  room. A feed that can only be driven by a host means occupancy is
 *  untestable, which means it will not be tested.
 *
 *  **A keyboard.** A game opened as a file, or booted by a boot probe, has no
 *  host and still has people in front of it. `keyboardSeats` gives the game
 *  the same `Table` — same roles, same pads, same late-arrival rule — driven
 *  by keys instead of phones. That is what makes adoption free: a game writes
 *  ONE control-reading path and it works with phones, with a keyboard, and
 *  with both at once.
 *
 *  ## THE BINDINGS ARE THE GAME'S AND THERE ARE NO DEFAULTS
 *
 *  `KeySeat` requires a role, a slot, and a full binding for every control the
 *  role declares — `bindKeys` THROWS on a missing one. A default WASD would
 *  have handed a two-role game the pilot's layout for its keeper as well, both
 *  players on the same four keys, and it would have compiled and booted and
 *  been discovered by two people on a sofa. The rule: *a game that gets a
 *  default silently inherits another game's art direction and it looks
 *  completely fine.*
 *
 *  ## A SYNTHETIC SEAT IS NOT A REAL ONE AND MUST NOT LOOK LIKE ONE
 *
 *  Seats here are STRINGS ("kb:0"), never numbers. A synthetic client that
 *  impersonates the real device destroys your ability to tell them apart — a
 *  test client given the real phone's viewport nearly cost a finding.
 *  `SeatId` is `string | number` precisely so a local seat is unmistakable in
 *  a log, in a roster and in a probe's output, while the package treats both
 *  identically because it never looks inside one.
 * ============================================================================
 */

import type { FeedEvent, SeatFeed, SeatPerson } from './Table.ts';
import type { ControlSpec, SeatId, TableSpec } from './Roles.ts';

/** A feed nothing is behind, plus the handle that drives it. */
export interface DrivenFeed {
  readonly feed: SeatFeed;
  /** Somebody walked in. */
  arrive(person: SeatPerson): void;
  /** Somebody walked out. */
  leave(seat: SeatId): void;
  /** One control moved. `value` is the wire string — see `Surface.ts`. */
  input(seat: SeatId, id: string, value: string): void;
  /** The room went away. Different from an empty room; `Table` keeps `heard`. */
  close(): void;
  /** Whole roster at once, the way a reconnect delivers it. */
  roster(people: readonly SeatPerson[]): void;
  /** Every document this feed was asked to put on a phone, newest last. */
  readonly shown: ReadonlyArray<{ readonly seat: SeatId; readonly html: string }>;
}

/**
 * A feed with no transport at all.
 *
 * `shown` is the record a probe asserts against, and it is the reason the
 * outcome *"a seat that was placed has a controller in front of it"* is
 * checkable without a browser. Asserting the CALL would be conformance;
 * asserting that a document exists, addressed to that seat, carrying that
 * role's controls, is the outcome.
 */
export function drivenFeed(): DrivenFeed {
  const handlers = new Set<(ev: FeedEvent) => void>();
  const shown: Array<{ seat: SeatId; html: string }> = [];
  const emit = (ev: FeedEvent): void => { for (const fn of [...handlers]) fn(ev); };

  /**
   * WHO IS HERE, SO A LATE SUBSCRIBER IS NOT BLIND. This is the whole reason
   * this feed is more than three lines, and it was added because it was
   * MISSING and a probe caught it.
   *
   * One game held its keyboard as a class FIELD and its table in the
   * CONSTRUCTOR BODY. Field initialisers run first, so `keyboardSeats(...)`
   * minted and announced both seats while nothing was listening, and
   * `new Table(...)` subscribed to a feed that had already said everything it
   * was going to say. The result: nobody at the table, both pads centred, and
   * **pressing Space did not start the game** — it booted, drew two correct
   * pictures, held a frame byte-identically and could not be started. The boot
   * probe passed all of it, because booting does not involve pressing
   * anything; a split-view probe's `playable` row is what failed, and it is an
   * OUTCOME row for exactly this reason.
   *
   * The host's phone pad bridge already keeps this pattern and says why in one
   * line — *"Last frame of each type, so a late subscriber is not blind"* —
   * and this is that note travelling to a second place.
   *
   * `said` is separate from the roster being non-empty on purpose. Replaying
   * an EMPTY roster to a new subscriber would set `Table.heard`, and *"nothing
   * has ever told us"* and *"the room told us it is empty"* are two different
   * facts that must never render as one colour.
   */
  const here = new Map<SeatId, SeatPerson>();
  let said = false;

  return {
    feed: {
      on(handler) {
        handlers.add(handler);
        if (said) handler({ kind: 'roster', people: [...here.values()] });
        return () => { handlers.delete(handler); };
      },
      show(seat, html) { shown.push({ seat, html }); },
    },
    arrive(person) { said = true; here.set(person.seat, person); emit({ kind: 'join', person }); },
    leave(seat) { said = true; here.delete(seat); emit({ kind: 'leave', seat }); },
    input(seat, id, value) { emit({ kind: 'input', seat, id, value }); },
    close() { said = true; emit({ kind: 'closed' }); },
    roster(people) {
      said = true;
      here.clear();
      for (const p of people) here.set(p.seat, p);
      emit({ kind: 'roster', people });
    },
    shown,
  };
}

/** One person at the keyboard, and every key they own. */
export interface KeySeat {
  /** What the roster calls them. Shown on the screen, never acted on. */
  readonly name: string;
  /** Which job. Must be a role id from the spec. */
  readonly role: string;
  /**
   * Binding per control id.
   *
   *   button  one `KeyboardEvent.code`
   *   slider  a pair: [down, up]
   *   stick   four: [left, right, up, down] in SCREEN space, so "up" is -y —
   *           the same convention `@homie-rocks/input/Stick2` reports and the same
   *           one `Surface.ts` sends. One convention, three transports.
   */
  readonly keys: Readonly<Record<string, string | readonly string[]>>;
}

/**
 * Wire a keyboard to a table's feed.
 *
 * Returns the driven feed plus a `poll()` the game calls once a frame. Polling
 * rather than listening-and-emitting because a key HELD produces one
 * `keydown`, and a stick that only moved on the browser's auto-repeat would
 * accelerate a boat in bursts at whatever the OS repeat rate happens to be.
 *
 * THROWS on a control with no binding, at the moment the game boots. See the
 * header: a silent default here is two people on the same four keys.
 */
/**
 * A source of seats that is IN THE ROOM rather than on the wire.
 *
 * A keyboard is one; a headset's controllers are another (`XR.ts`). Both mint
 * seats nothing on the network has ever heard of, both drive the same `Table`
 * through the same `DrivenFeed`, and both must get out of the way the moment a
 * real person walks in with a phone — which is the whole of
 * `withLocalSeats` below.
 *
 * It is the pair of members that composition needs and nothing else. `listen`
 * and `poll` are a keyboard's; `open`, `close` and a `poll` that takes an
 * argument are a headset's; neither is any business of the composition.
 */
export interface LocalSeats {
  readonly driven: DrivenFeed;
  /** The synthetic seats this source minted, in the order they were given. */
  readonly seats: readonly SeatId[];
}

export interface Keyboard extends LocalSeats {
  /** Attach the listeners. Call once, from a system's `init`. */
  listen(target: { addEventListener(type: string, fn: (e: Event) => void, opts?: unknown): void }): void;
  /** Read the keyboard and post whatever changed. Call once a frame. */
  poll(): void;
}

export function keyboardSeats(spec: TableSpec, seats: readonly KeySeat[]): Keyboard {
  const driven = drivenFeed();
  const down = new Set<string>();
  /**
   * Codes that went down at any point since the last `poll()`, whether or not
   * they are still down.
   *
   * THE LATCH, and it is the same one `@homie-rocks/input/Keys.ts` exists for: a
   * press and a release that both land between two frames would otherwise
   * never be seen at all. `Pad` has its own latch on the far side of the wire,
   * but a latch there cannot recover an edge this side never sent — the two
   * are in series, not in duplicate.
   */
  const tapped = new Set<string>();
  const swallow = new Set<string>();
  const last = new Map<string, string>();

  interface Wired { seat: SeatId; id: string; kind: ControlSpec['kind']; label: string; codes: readonly string[]; }
  const wired: Wired[] = [];
  const minted: SeatId[] = [];

  seats.forEach((who, index) => {
    const role = spec.roles.find((r) => r.id === who.role);
    if (!role) throw new Error(`keyboardSeats: no role called ${JSON.stringify(who.role)} in this table`);
    const seat: SeatId = KEY_SEAT_PREFIX + String(index);
    minted.push(seat);
    for (const c of role.controls) {
      const bound = who.keys[c.id];
      if (bound === undefined) {
        throw new Error(`keyboardSeats: ${JSON.stringify(who.name)} has no key for ${JSON.stringify(c.id)}`);
      }
      const codes = typeof bound === 'string' ? [bound] : bound;
      /*
       * A stick is FOUR keys and a slider is TWO, exactly — an axis with three
       * bindings is a typo, not a layout. A BUTTON is one OR MORE, because two
       * keys for one action is a real choice a game makes: one game's second
       * role fires on ShiftRight or ArrowUp, so a hand that has found the
       * arrows has already found the button.
       */
      const want = c.kind === 'stick' ? 4 : c.kind === 'slider' ? 2 : 1;
      const enough = c.kind === 'button' ? codes.length >= 1 : codes.length === want;
      if (!enough) {
        throw new Error(`keyboardSeats: ${JSON.stringify(c.id)} is a ${c.kind} and wants ${c.kind === 'button' ? 'at least 1' : String(want)} key(s), got ${codes.length}`);
      }
      for (const code of codes) swallow.add(code);
      wired.push({ seat, id: c.id, kind: c.kind, label: c.label, codes });
    }
    driven.arrive({ seat, name: who.name });
  });

  return {
    driven,
    seats: minted,
    listen(target) {
      target.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        // Only the codes this table claims are swallowed. A page that eats
        // every key is a page a person cannot get out of.
        if (swallow.has(k.code)) k.preventDefault();
        down.add(k.code);
        tapped.add(k.code);
      }, { passive: false });
      target.addEventListener('keyup', (e) => { down.delete((e as KeyboardEvent).code); });
      // A key held while the tab loses focus never delivers its keyup — the
      // OTHER window gets it — and the boat drives into a rock for as long as
      // somebody is reading their email.
      target.addEventListener('blur', () => { down.clear(); tapped.clear(); });
      // THE KEY MAP, SAID OUT LOUD. A game on a public web page runs with no
      // host behind it, so a stranger on a phone has no keyboard and no pad:
      // the world draws and nothing moves. A hosting page can read this and
      // draw a touch stick and labelled buttons that press these same codes
      // on this same target. Only the first seat — one phone is one person.
      const first = wired.filter((w) => w.seat === minted[0]);
      (globalThis as { __homieKeys?: unknown }).__homieKeys = first.map((w) => ({
        id: w.id, kind: w.kind, label: w.label, codes: [...w.codes],
      }));
    },
    poll() {
      for (const w of wired) {
        let value: string;
        if (w.kind === 'stick') {
          const x = (down.has(w.codes[1]!) ? 1 : 0) - (down.has(w.codes[0]!) ? 1 : 0);
          const y = (down.has(w.codes[3]!) ? 1 : 0) - (down.has(w.codes[2]!) ? 1 : 0);
          value = x.toFixed(3) + ',' + y.toFixed(3);
        } else if (w.kind === 'slider') {
          const n = (down.has(w.codes[1]!) ? 1 : 0) - (down.has(w.codes[0]!) ? 1 : 0);
          value = n.toFixed(3);
        } else {
          const held = w.codes.some((code) => down.has(code));
          // A tap that both arrived and ended since the last poll is sent as
          // TWO messages, down then up, in the same poll. `Pad` raises the
          // edge on the first and holds it until the game's `endFrame()`, so
          // the press survives — see the latch note at the top of this
          // function. Without the pair, a fast double-tap on a drum pad is one
          // hit, and it is one hit in a way nothing can attribute.
          if (!held && w.codes.some((code) => tapped.has(code))) {
            const key0 = String(w.seat) + '/' + w.id;
            driven.input(w.seat, w.id, 'down');
            last.set(key0, 'down');
          }
          value = held ? 'down' : 'up';
        }
        // Otherwise only on change: re-posting an unchanged value every frame
        // is thirty-two phones' worth of traffic saying nothing happened.
        const key = String(w.seat) + '/' + w.id;
        if (last.get(key) === value) continue;
        last.set(key, value);
        driven.input(w.seat, w.id, value);
      }
      tapped.clear();
    },
  };
}

/**
 * The prefix on every seat this file mints.
 *
 * The package's own string, not the room's — which is the one and only reason
 * `withKeyboardFallback` below is allowed to look inside a `SeatId` at all.
 * It never inspects a seat the ROOM gave it; it recognises the ones it made.
 */
export const KEY_SEAT_PREFIX = 'kb:';

/**
 * A keyboard that yields to the room the moment there is one.
 *
 * ## THE PROBLEM THIS SOLVES, AND WHY THE OBVIOUS ANSWERS ARE WRONG
 *
 * Every one of these games is a web page that plays standalone — the boot
 * probe runs all eight that way and there is no host anywhere. So the
 * keyboard has to work from the first frame. But under a host the phones are
 * the controllers, and a keyboard seat that arrived first would hold role 0
 * and push the first guest who scans the QR into the spectator queue. **The
 * fallback would have taken the game away from the room.**
 *
 * Two answers were considered and rejected:
 *
 *   · *A timer.* Wait 500 ms for a roster, then mint keyboard seats. Every
 *     failure is a race, and the one that matters — a slow host on a busy
 *     machine — produces a game that is sometimes keyboard and sometimes
 *     phones with no way to tell which.
 *   · *A flag the game sets.* Then every game has to work out whether it is
 *     under a host, which is the six-files problem this whole package exists
 *     to delete.
 *
 * ## WHAT IT DOES INSTEAD, WITH NO CLOCK AT ALL
 *
 * The keyboard seats arrive immediately, so a standalone page is playable on
 * frame one. The FIRST time the room delivers a person, every keyboard seat
 * LEAVES — before that person is placed, so they take role 0 and not a queue
 * position — and the keyboard is silent from then on.
 *
 * That failure mode is the correct behaviour rather than a compromise: under a
 * host, *"every phone is a controller"*, and somebody at a keyboard being
 * displaced by the first guest who walks in is what should happen. An EMPTY
 * roster is not a person and does not displace anybody — a host that is
 * running with nobody in the room leaves the keyboard exactly where it is.
 */
export function withKeyboardFallback(live: SeatFeed, keyboard: Keyboard): SeatFeed {
  return withLocalSeats(live, keyboard);
}

/**
 * The same rule, for however many local sources a game has.
 *
 * ## WHY VARIADIC AND NOT NESTED, WHICH IS THE OBVIOUS ANSWER AND IS WRONG
 *
 * A game with a keyboard AND a headset (see `XR.ts`) has two local sources, and
 * `withKeyboardFallback(withKeyboardFallback(live, keys), vr)` looks like it
 * composes. It does not, and the failure is silent: the outer call treats the
 * inner feed as THE ROOM, so the keyboard's own `join` — which fires at
 * construction, before anything has happened — counts as *"a real person walked
 * in"* and the headset's seats are retired before a session can ever open. The
 * whole point of the rule is that a LOCAL seat yields to a REMOTE one, and
 * nesting loses the distinction the moment there is more than one.
 *
 * So every local source is named at once, they all yield together on the first
 * person the room delivers, and none of them can displace another.
 */
export function withLocalSeats(live: SeatFeed, ...locals: readonly LocalSeats[]): SeatFeed {
  let yielded = false;
  /*
   * MEMBERSHIP, NOT A PREFIX. The old form asked whether a seat id started with
   * `kb:`, which was right when there was one source and is a growing list of
   * string literals the moment there are two. These are the seats these sources
   * actually minted — the package's own, which is the one and only reason
   * `Local.ts` is allowed to look at a `SeatId` at all. It never inspects one
   * the ROOM gave it.
   */
  const mine = new Set<SeatId>(locals.flatMap((l) => [...l.seats]));

  return {
    on(handler) {
      const offLocal = locals.map((local) => local.driven.feed.on((ev) => {
        // Once the room has people, a local source's events stop existing.
        if (yielded) return;
        handler(ev);
      }));
      const offLive = live.on((ev) => {
        const brings =
          (ev.kind === 'roster' && ev.people.length > 0) ? ev.people.length
            : ev.kind === 'join' ? 1 : 0;
        if (brings > 0 && !yielded) {
          yielded = true;
          for (const seat of mine) handler({ kind: 'leave', seat });
        }
        handler(ev);
      });
      return () => { for (const off of offLocal) off(); offLive(); };
    },
    show(seat, html) {
      // A keyboard seat has no phone, and neither does a headset. Posting a
      // controller to the host for one would address a seat the room has
      // never heard of, and the honest refusal that came back would be a
      // warning on every boot.
      if (mine.has(seat)) return;
      live.show(seat, html);
    },
  };
}
