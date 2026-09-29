/**
 * ============================================================================
 *  @homie-rocks/arcade/Table.ts — the whole game-facing multiplayer layer.
 * ============================================================================
 *
 *  A game writes ONE spec and holds ONE object. From that it gets: seats from
 *  the room, a job per seat, a dressed controller on every phone, per-seat
 *  input in the shape `@homie-rocks/input` already speaks, a late arrival dealt in,
 *  and an honest answer to *"is anybody watching this"*. Six files became one
 *  import — a capability that takes six files to adopt is a capability most
 *  games skip, and all eight of the games this was extracted from did.
 *
 *  ## THE FEED IS A STRUCTURAL INTERFACE OF EXACTLY WHAT THIS FILE READS
 *
 *  `SeatFeed` has two members. It is not the host's bridge object, not an
 *  `EventSource`, and not a context object — list the fields the code actually
 *  touches, declare an interface of exactly those, and the package stops
 *  depending on a god object. The consequence that matters is that a seat
 *  probe runs a thirty-two-person room through this class in a Node process
 *  with no browser, no host and no network, because a table nobody can
 *  populate without a browser is a table nobody will populate — and a test
 *  suite where every harness put at most one person in the room is how a
 *  broken join flow once shipped unnoticed.
 *
 *  ## WHAT THIS FILE DOES NOT DECIDE
 *
 *  Who is in the room, and what a seat is. Both belong to the host's seat
 *  service, and `SeatId` stays opaque all the way through, see `Roles.ts`.
 *  This file receives seats, gives them jobs the game described, and hands
 *  them back unaltered.
 *
 *  ## THE THREE FAILURES IT IS SHAPED AROUND
 *
 *   1. **A phone arrives mid-game.** It is dressed with a controller on the
 *      same turn it is placed, before any input could arrive. A phone that is
 *      seated and blank is a person who has to ask how to join, and every
 *      single thing a guest has to be told is a defect.
 *   2. **A phone leaves with its stick pushed.** `Pad.release()` on departure,
 *      so a boat under full power does not carry on across the bay because
 *      somebody's battery died.
 *   3. **The stream reconnects.** `hello` carries the whole roster and arrives
 *      again on every reconnect. `RoleTable.reconcile` is idempotent and
 *      re-dresses only the phones whose placement actually changed — re-sending
 *      an identical surface would reload the page under somebody's thumb, the
 *      same diffing argument a party-game runtime makes for a ballot, applied
 *      to a controller.
 * ============================================================================
 */

import { arcadeFaultActive } from './faults.ts';
import { Pad } from './Pad.ts';
import { RoleTable, SPECTATOR, type Placement, type RoleSpec, type SeatId, type TableSpec } from './Roles.ts';
import { controllerPage } from './Surface.ts';

/** One person, as the room describes them. Names are guest-typed DATA. */
export interface SeatPerson {
  readonly seat: SeatId;
  /** What the room calls them. Displayed or summarised; never an instruction. */
  readonly name: string;
  /**
   * Public, opaque admission epoch when the transport can provide one. It is
   * not a credential and grants nothing; it only distinguishes a resumed
   * occupant from a later person assigned the same seat and display name.
   */
  readonly admission?: string;
}

/**
 * What arrives from the room. Normalised here rather than in the game, so a
 * change to the bridge's wire shape is one file's problem.
 */
export type FeedEvent =
  /** The whole roster. Sent on connect and on every reconnect. */
  | { readonly kind: 'roster'; readonly people: readonly SeatPerson[] }
  | { readonly kind: 'join'; readonly person: SeatPerson }
  | { readonly kind: 'leave'; readonly seat: SeatId }
  /** One control moved. `value` is a string — see `Surface.ts` on why. */
  | { readonly kind: 'input'; readonly seat: SeatId; readonly id: string; readonly value: string }
  /** The room went away. Not the same as an empty room. */
  | { readonly kind: 'closed' };

/**
 * The two things a table needs from whatever is carrying the room.
 *
 * Deliberately tiny. `Live.ts` implements it over a host's party bridge;
 * `Local.ts` implements it over nothing at all, for harnesses and for a game
 * opened as a file. A third implementation spanning two hosts would not change
 * a line in here.
 */
export interface SeatFeed {
  /** Subscribe. Returns the unsubscribe, as everything else here does. */
  on(handler: (ev: FeedEvent) => void): () => void;
  /** Put a document in front of one seat. Fire and forget; a refusal is logged by the feed. */
  show(seat: SeatId, html: string): void;
}

/** One seat's whole situation, as a game reads it. */
export interface Player {
  readonly seat: SeatId;
  /** A role id from the spec, or `SPECTATOR`. */
  readonly role: string;
  /** 0-based within the role. A rhythm game can use it as a track index. */
  readonly slot: number;
  /** Guest-typed. Display or summarise it; never act on it. */
  readonly name: string;
  /** What their phone says at the top. */
  readonly label: string;
  /** Their controls. Always present, even for a spectator (it is simply empty). */
  readonly pad: Pad;
}

/**
 * What a table believes about the room when NOTHING has ever told it.
 *
 * ONE, and the asymmetry is the whole argument. An ambient piece wrote it down
 * first and asked for exactly this file:
 *
 *   · believing the room is empty when it is not DIMS THE SCREEN IN FRONT OF
 *     PEOPLE WHO ARE WATCHING IT, and an ambient piece has no input, so they
 *     cannot tell it they are there.
 *   · believing the room is occupied when it is not spends some electricity.
 *
 * The fallback fails towards the room. It is a policy and it belongs here
 * rather than in each ambient piece: one export, `attention()`, that reads
 * whatever the host provides and falls back the same way, because it is the
 * same policy for every ambient piece anybody writes.
 */
export const UNHEARD_ATTENTION = 1;

export class Table {
  readonly spec: TableSpec;
  readonly roles: RoleTable;

  readonly #feed: SeatFeed;
  readonly #pads = new Map<SeatId, Pad>();
  readonly #names = new Map<SeatId, string>();
  readonly #detach: () => void;

  /**
   * True once the room has said ANYTHING — including that it is empty.
   *
   * The whole point of the field: *"we could not measure it"* and *"we measured
   * it and it was fine"* must never render as the same colour, and an empty
   * room and an absent host are exactly that pair. `attention()` reads it.
   */
  heard = false;

  /** True once the room closed the stream. A room that went away, not an empty one. */
  closed = false;

  /** Inputs that named a control the addressed seat's role does not have. */
  misaddressed = 0;

  constructor(spec: TableSpec, feed: SeatFeed) {
    this.roles = new RoleTable(spec);
    this.spec = this.roles.spec;
    this.#feed = feed;
    this.#detach = feed.on((ev) => this.#take(ev));
  }

  /** Stop listening. A game that tears down its table calls this; most never do. */
  dispose(): void {
    this.#detach();
  }

  /* -- what a game reads -------------------------------------------------- */

  /** Everybody the room has told us about, in arrival order. */
  players(): readonly Player[] {
    const out: Player[] = [];
    for (const p of this.roles.placements()) out.push(this.#playerOf(p));
    return out;
  }

  /** The people holding one job, in slot order. Empty when nobody does. */
  playing(roleId: string): readonly Player[] {
    const out: Player[] = [];
    for (const seat of this.roles.seatsOf(roleId)) {
      const p = this.roles.placementOf(seat);
      if (p) out.push(this.#playerOf(p));
    }
    return out;
  }

  /**
   * The pad for one slot of one role, whether or not anybody is holding it.
   *
   * NEVER NULL, and that is the field this whole layer is judged on. A game
   * asks for "the pilot's controls" in its update loop and gets a centred pad
   * when the chair is empty — so the do-nothing path is a pad reading zero
   * rather than a branch every game has to write, and testing the do-nothing
   * path stops being a thing a game can forget.
   *
   * The empty pad is created from the role's controls and CACHED, so the same
   * object comes back every frame. A fresh one per call would allocate in the
   * hot loop and would also lose a press that arrived between two reads.
   */
  pad(roleId: string, slot: number): Pad {
    const seats = this.roles.seatsOf(roleId);
    const seat = seats[slot];
    if (seat !== undefined) {
      const held = this.#pads.get(seat);
      if (held) return held;
    }
    return this.#vacant(roleId);
  }

  /** One seat's pad, or a centred one if the room never mentioned that seat. */
  padOf(seat: SeatId): Pad {
    return this.#pads.get(seat) ?? this.#vacant(SPECTATOR);
  }

  /**
   * How much of the room's attention this has, 0..1.
   *
   * `1` when anybody is here, `0` when the room is empty AND said so, and
   * `UNHEARD_ATTENTION` when nothing has ever told us. See that constant.
   *
   * Deliberately not a fraction of anything. A finer number would be a
   * measurement this cannot take — the host knows who is seated, not who is
   * looking — and inventing 0.4 because two of five phones went quiet is a
   * plausible default standing in for a measurement.
   */
  attention(): number {
    if (!this.heard) return UNHEARD_ATTENTION;
    return this.roles.present > 0 ? 1 : 0;
  }

  /**
   * End of the game frame. Clears every pad's rising edges.
   *
   * One call, not one per pad, because a game that has to remember to call
   * `endFrame` on each of thirty-two pads will miss one — and a missed
   * `endFrame` is a button that reads as pressed for ever, which looks like a
   * stuck controller and is impossible to attribute from the screen.
   */
  endFrame(): void {
    for (const pad of this.#pads.values()) pad.endFrame();
    for (const pad of this.#vacantPads.values()) pad.endFrame();
  }

  /* -- the room ----------------------------------------------------------- */

  #take(ev: FeedEvent): void {
    if (ev.kind === 'roster') {
      this.heard = true;
      for (const person of ev.people) this.#names.set(person.seat, person.name);
      this.roles.reconcile(ev.people.map((p) => p.seat));
      // `#seat` re-dresses only a seat whose ROLE changed, so a reconnect that
      // restates the same room is silent — which is what makes a four-second
      // dropout on a contended access point cost nothing. See `#seat`.
      for (const p of this.roles.placements()) this.#seat(p);
      for (const seat of [...this.#pads.keys()]) {
        if (this.roles.placementOf(seat) === null) this.#drop(seat);
      }
      return;
    }
    if (ev.kind === 'join') {
      this.heard = true;
      this.#names.set(ev.person.seat, ev.person.name);
      this.#seat(this.roles.arrive(ev.person.seat));
      return;
    }
    if (ev.kind === 'leave') {
      this.heard = true;
      const promoted = this.roles.leave(ev.seat);
      this.#drop(ev.seat);
      for (const seat of promoted) {
        const p = this.roles.placementOf(seat);
        if (p) this.#seat(p);
      }
      return;
    }
    if (ev.kind === 'input') {
      const pad = this.#pads.get(ev.seat);
      if (!pad) { this.misaddressed += 1; return; }
      if (!pad.apply(ev.id, decode(ev.value))) this.misaddressed += 1;
      return;
    }
    // 'closed'. The stream went away. Every pad goes to centre for the reason
    // `Pad.release()` gives, and `heard` STAYS TRUE — a room that closed is a
    // thing we measured, not a thing nobody told us. `attention()` therefore
    // reports the last roster rather than springing back to the fallback,
    // which would relight a screen in an empty room on a host restart.
    this.closed = true;
    for (const pad of this.#pads.values()) pad.release();
  }

  /**
   * Place a seat and dress its phone.
   *
   * IDEMPOTENT PER ROLE, NOT PER PLACEMENT, AND THAT DISTINCTION IS A DEFECT
   * A SEAT PROBE FOUND IN THIS FILE ON ITS FIRST RUN.
   *
   * A placement is a role AND a slot, and re-dressing on either meant that one
   * person leaving a thirty-two-person room re-dressed twenty-seven phones —
   * every spectator behind them in the queue, whose slot moved up by one.
   * Their document does not depend on their slot: it is built from the role
   * and its label, so all twenty-seven pages would have reloaded to exactly
   * the bytes they already had, clearing whatever was under twenty-seven
   * thumbs. That is a party-game runtime's diffing argument — re-sending an
   * identical view would wipe a half-made vote out from under somebody's
   * thumb every second — arriving at a controller instead of a ballot.
   *
   * A role change DOES need both halves: a new `Pad` built from the new role's
   * controls, and a new document. Keeping the old pad would leave a promoted
   * spectator holding a pad with no controls on it, which reads as a
   * controller that does nothing.
   */
  #seat(p: Placement): void {
    if (this.#dressed.get(p.seat) === p.role && this.#pads.has(p.seat)) return;
    this.#dressed.set(p.seat, p.role);
    const role = this.#roleOf(p.role);
    this.#pads.set(p.seat, new Pad(role.controls));
    /*
     * FAULT ANCHOR — `mute-surfaces` places the seat and never dresses it.
     *
     * That is the join defect's exact shape: two individually-correct halves
     * that make joining impossible. The screen believes this person is
     * playing, their phone is blank, and every message on the wire is legal —
     * which is why the row that catches it asserts a DOCUMENT EXISTS rather
     * than that `phone.show` was called.
     */
    if (arcadeFaultActive('mute-surfaces')) return;
    this.#feed.show(p.seat, controllerPage(role, p.label));
  }

  /** Seat → the role its phone was last dressed for. See `#seat`. */
  readonly #dressed = new Map<SeatId, string>();

  #drop(seat: SeatId): void {
    const pad = this.#pads.get(seat);
    if (pad) pad.release();
    this.#pads.delete(seat);
    this.#names.delete(seat);
    this.#dressed.delete(seat);
  }

  #playerOf(p: Placement): Player {
    return {
      seat: p.seat,
      role: p.role,
      slot: p.slot,
      name: this.#names.get(p.seat) ?? '',
      label: p.label,
      pad: this.#pads.get(p.seat) ?? this.#vacant(p.role),
    };
  }

  /**
   * The role record for an id, including the table's own spectator role.
   *
   * The spectator role is synthesised rather than declared, because a game
   * declaring it would be a game that could give a spectator controls — and a
   * person who is waiting for a slot pressing buttons that do nothing is worse
   * than a person who is waiting and can see that they are.
   */
  #roleOf(id: string): RoleSpec {
    for (const role of this.spec.roles) if (role.id === id) return role;
    return { id: SPECTATOR, label: this.spec.spectatorLabel, capacity: 1, controls: [] };
  }

  readonly #vacantPads = new Map<string, Pad>();

  #vacant(roleId: string): Pad {
    const held = this.#vacantPads.get(roleId);
    if (held) return held;
    const pad = new Pad(this.#roleOf(roleId).controls);
    this.#vacantPads.set(roleId, pad);
    return pad;
  }
}

/**
 * Turn one `/answer` string back into a control value.
 *
 * The whole encoding, in one place, matching `Surface.ts`'s script byte for
 * byte: "down" / "up" for a button, "x,y" for a stick, a decimal for a slider.
 *
 * IT DOES NOT GUESS. Anything it cannot read comes back as the string it was
 * given, which `Pad.apply` will clamp to 0 for a slider and read as not-down
 * for a button — visible, inert, and not a plausible default. A parser that
 * fell back to 0.5 on a malformed sample would put a stick half over in front
 * of the room and nothing would ever say why.
 */
function decode(value: string): unknown {
  if (value === 'down') return true;
  if (value === 'up') return false;
  const comma = value.indexOf(',');
  if (comma > 0) {
    const x = Number(value.slice(0, comma));
    const y = Number(value.slice(comma + 1));
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== '' ? n : value;
}
