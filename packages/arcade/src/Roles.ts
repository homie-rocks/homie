/**
 * ============================================================================
 *  @homie-rocks/arcade/Roles.ts — who at this table is doing which job.
 * ============================================================================
 *
 *  ## WHY THIS FILE EXISTS, MEASURED RATHER THAN ASSERTED
 *
 *  Multiplayer should be the default, not a thing to remember — and on
 *  2026-08-21, **8 of 8 games had no seats at all.** That was checked by grep
 *  and the grep was misleading — the racers "mention seats" in six files each
 *  and every one of those is a *driver's seat* in a comment about a 3D model,
 *  or `re-seat it off the surface actually underneath` in an item spawner. Not
 *  one of those games had ever held a `homie.json`, opened `/__homie/session`,
 *  or received a seat from a host.
 *
 *  The reason is not that anybody forgot. The host's party bridge is PLUMBING
 *  — seat isolation and package-origin routing, not an experience engine — and
 *  its entire game-facing surface is `bridge.call('phone.show', { seat, view })`
 *  plus an SSE stream of untyped `{t}` records. There was no layer between
 *  that and a game, so wiring seats by hand meant a manifest, an SSE client, a
 *  seat→player map, a phone page, a press router and a fallback for running
 *  without a host — six files before a single control does anything. **A
 *  capability that takes six files to adopt is a capability most games will
 *  skip**, and all eight of them did.
 *
 *  ## THE BOUNDARY, AND IT IS NOT NEGOTIABLE
 *
 *  A package may NOT know what a SEAT is or who holds it — seats belong to the
 *  host's seat service, and `SeatId` is opaque to the package.
 *
 *  That is enforced structurally here rather than promised in a comment.
 *  `SeatId` is `string | number`, which is a type you cannot do ARITHMETIC on:
 *  nothing in this package can compute "the next seat", allocate seat 4, or
 *  decide that seat 0 is special. Seats arrive from the room, are used as map
 *  keys, and are handed back unaltered. A branded number would have been the
 *  fashionable choice and it would have been weaker — a brand is a cast away
 *  from arithmetic, and `seat + 1` would still compile after one `as`.
 *
 *  What this file DOES decide is which JOB an already-existing seat is doing,
 *  from a spec the game wrote. That is a game's business, parameterised, and
 *  it is the only reason the file is allowed to exist.
 *
 *  ## THE FIVE RULES, EACH OF WHICH IS A ROOM FAILURE
 *
 *   1. **Roles fill in declared order.** A two-role game may need its keeper
 *      before its pilot, because one person alone at the lookout can at least
 *      see the bay. First person in gets role 0.
 *
 *   2. **A seat keeps its role while it is at the table.** Never rebalanced,
 *      never optimised. A reassignment mid-round moves the world under
 *      somebody's thumb and there is no way to tell them it happened.
 *
 *   3. **A leaving seat frees its slot; nobody else is disturbed.** The two
 *      remaining people do not get renumbered. *A held seat is not a person*,
 *      and renumbering everybody because one phone slept is how a room's
 *      evening gets ruined by a network hiccup.
 *
 *   4. **A late arrival is DEALT IN, not ignored.** If a slot is free they
 *      take it immediately; if not they wait as a spectator and are promoted
 *      the moment one opens, longest-waiting first — when somebody walks in at
 *      minute four they are dealt in without being told anything. This is that
 *      sentence as code, and a seat probe asserts it as an OUTCOME at 0, 1, 3,
 *      6, 12 and 32 people rather than as message conformance — a join bug
 *      once passed conformance checks the whole time it made joining
 *      impossible.
 *
 *   5. **Overflow is a role too.** A thirty-second person at a two-role table
 *      is a spectator with a name, not an error and not a silent drop. Which
 *      is why `spectatorLabel` is REQUIRED on the spec: a game that has not
 *      thought about the twelfth person should fail to compile, not inherit
 *      another game's answer.
 *
 *  ## EVERY SPEC FIELD IS REQUIRED
 *
 *  No optionals, no defaults, anywhere in this file. The standing rule: *a
 *  game that gets a default silently inherits another game's art direction and
 *  it looks completely fine.* A default `capacity` of 1 would have made a
 *  four-instrument rhythm game — four instruments, four hands — a
 *  single-player game that compiled, booted, and was wrong in a way no probe
 *  would name.
 * ============================================================================
 */

import { arcadeFaultActive } from './faults.ts';

/**
 * A seat, exactly as the room gave it to us.
 *
 * `string | number` on purpose — see the header. The package compares these
 * for equality, uses them as map keys, and hands them back. It never orders
 * them, never adds to them, and never makes one up.
 */
export type SeatId = string | number;

/**
 * One control on one person's phone.
 *
 * Three kinds, because four games needed exactly three between them and
 * a fourth invented for symmetry would be a control nothing has ever rendered.
 *
 *   stick   two axes, -1..1 each, y positive DOWN (screen space, as
 *           `@homie-rocks/input/Stick2.ts` reports it — one seam, one convention)
 *   button  down / up, with a rising edge the game reads once
 *   slider  one axis, -1..1, which does not spring back
 *
 * `label` is what the person holding the phone reads. It is required and there
 * is no fallback to `id`: an id is a programmer's word and putting one in
 * front of a guest is a defect, as is every single thing a guest has to be
 * told.
 */
export type ControlSpec =
  | { readonly kind: 'stick'; readonly id: string; readonly label: string }
  | { readonly kind: 'button'; readonly id: string; readonly label: string }
  | { readonly kind: 'slider'; readonly id: string; readonly label: string };

/** One job at this table. */
export interface RoleSpec {
  /** The game's own word for the job. Used as a key; never shown to a guest. */
  readonly id: string;
  /** What the guest reads. `Keeper`, `Pilot`, `Kick`. */
  readonly label: string;
  /**
   * How many seats hold this job at once. Must be at least 1 — a role with
   * capacity 0 is a role that was deleted, and `defineTable` says so loudly
   * rather than quietly never filling it.
   */
  readonly capacity: number;
  /** What this job's phone shows. May be empty: a role can be a job with no controls. */
  readonly controls: readonly ControlSpec[];
}

/** The whole table. */
export interface TableSpec {
  /** In fill order. See rule 1. */
  readonly roles: readonly RoleSpec[];
  /**
   * What somebody with no seat at the table is called. Required — see rule 5.
   * `Watching`, `In the queue`, `Next up`.
   */
  readonly spectatorLabel: string;
}

/**
 * The role id reserved for everybody the table could not fit.
 *
 * Underscored so it can never collide with a role a game declared, and a collision here would silently
 * merge the overflow queue with a real job.
 */
export const SPECTATOR: string = '__spectator';

/** Where one seat is sitting, right now. */
export interface Placement {
  readonly seat: SeatId;
  /** A role id from the spec, or `SPECTATOR`. */
  readonly role: string;
  /** What the person reads. The role's label, or the table's spectator label. */
  readonly label: string;
  /**
   * 0-based index WITHIN the role, stable for as long as the seat holds it.
   *
   * This is the number a rhythm game turns into a track and a two-role game
   * ignores, and it is deliberately not the seat id: seat ids are the room's and may be
   * any integer at all, while "you are the second pair of hands" is a fact
   * about this table that a game can index an array with.
   */
  readonly slot: number;
}

/**
 * Validate a spec at the point a game writes it, and hand back the same object.
 *
 * A THROW AND NOT A REPAIR. Every mistake below is a mistake in a literal a
 * person typed, discoverable the first time the game boots — and a table that
 * silently repaired a duplicate role id would run, look completely fine, and
 * deliver one person's controls to two jobs.
 */
export function defineTable(spec: TableSpec): TableSpec {
  if (spec.roles.length === 0) {
    throw new Error('a table needs at least one role — a game with none should not have a table');
  }
  const roleIds = new Set<string>();
  for (const role of spec.roles) {
    if (role.id === SPECTATOR) throw new Error(`${SPECTATOR} is the table's own role id and a game may not declare it`);
    if (roleIds.has(role.id)) throw new Error(`two roles are called ${JSON.stringify(role.id)}`);
    roleIds.add(role.id);
    if (!Number.isInteger(role.capacity) || role.capacity < 1) {
      throw new Error(`role ${JSON.stringify(role.id)} has capacity ${role.capacity}; a role holds at least one seat`);
    }
    const controlIds = new Set<string>();
    for (const c of role.controls) {
      if (controlIds.has(c.id)) {
        throw new Error(`role ${JSON.stringify(role.id)} has two controls called ${JSON.stringify(c.id)}`);
      }
      controlIds.add(c.id);
    }
  }
  return spec;
}

/** Total seats the declared roles can hold. Spectators are on top of this. */
export function tableCapacity(spec: TableSpec): number {
  let n = 0;
  for (const role of spec.roles) n += role.capacity;
  return n;
}

/**
 * Seats in, placements out. No DOM, no network, no clock.
 *
 * Deliberately pure so a seat probe can run a thirty-two person room through
 * it in a Node process with no browser at all. What once made an occupancy
 * defect in the join flow invisible was that no harness put more than one
 * person in the room; a table nobody can populate without a browser
 * is a table nobody will populate.
 */
export class RoleTable {
  readonly spec: TableSpec;

  /** Seat → placement, in ARRIVAL order. `Map` preserves insertion order. */
  readonly #placed = new Map<SeatId, Placement>();

  /**
   * Seats waiting for a slot, longest-waiting first. Rule 4.
   *
   * Held separately from `#placed` rather than as a `role: SPECTATOR` scan,
   * because promotion order is the whole behaviour and a scan of a map that
   * also holds the seated would make it an accident of iteration.
   */
  readonly #waiting: SeatId[] = [];

  constructor(spec: TableSpec) {
    this.spec = defineTable(spec);
  }

  /** Everybody at the table, seated and waiting, in arrival order. */
  placements(): readonly Placement[] {
    return [...this.#placed.values()];
  }

  /** Where this seat is sitting, or null if the room never mentioned it. */
  placementOf(seat: SeatId): Placement | null {
    return this.#placed.get(seat) ?? null;
  }

  /** How many seats hold a real job right now. Spectators excluded. */
  get seated(): number {
    let n = 0;
    for (const p of this.#placed.values()) if (p.role !== SPECTATOR) n += 1;
    return n;
  }

  /** How many people the table knows about at all, job or not. */
  get present(): number {
    return this.#placed.size;
  }

  /** How many are waiting for a slot. */
  get waiting(): number {
    return this.#waiting.length;
  }

  /**
   * The seats holding one role, in slot order.
   *
   * Returns a fresh array: a game that held onto the internal one would see it
   * change under it on the next arrival, an aliasing bug that has already had
   * to be checked for by hand more than once.
   */
  seatsOf(roleId: string): readonly SeatId[] {
    const out: Array<{ seat: SeatId; slot: number }> = [];
    for (const p of this.#placed.values()) if (p.role === roleId) out.push({ seat: p.seat, slot: p.slot });
    out.sort((a, b) => a.slot - b.slot);
    return out.map((e) => e.seat);
  }

  /**
   * Somebody arrived, or the room re-stated somebody who was already here.
   *
   * IDEMPOTENT, and that is load-bearing rather than tidy: the bridge's
   * `hello` event carries the whole seat list, and it is re-sent on every
   * reconnect. A stream that drops for four seconds on a contended access
   * point must not re-deal the room.
   *
   * Returns the placement, which is new only when the seat was new.
   */
  arrive(seat: SeatId): Placement {
    const already = this.#placed.get(seat);
    if (already) return already;

    const open = this.#firstOpenSlot();
    if (open === null) {
      this.#waiting.push(seat);
      const p: Placement = { seat, role: SPECTATOR, label: this.spec.spectatorLabel, slot: this.#waiting.length - 1 };
      this.#placed.set(seat, p);
      return p;
    }
    const p: Placement = { seat, role: open.role.id, label: open.role.label, slot: open.slot };
    this.#placed.set(seat, p);
    return p;
  }

  /**
   * Somebody left.
   *
   * Returns the seats whose placement CHANGED as a result — the leaver is not
   * among them, because it no longer has one. In practice that is zero or one
   * seat: the spectator that got promoted into the freed slot.
   *
   * The caller needs that list because a promoted phone must be re-dressed
   * with its new role's controls, and re-dressing everybody on every departure
   * would clear a half-made input out from under thirty-one other thumbs —
   * the same failure a party-game runtime diffs its views to avoid.
   */
  leave(seat: SeatId): readonly SeatId[] {
    const gone = this.#placed.get(seat);
    if (!gone) return [];
    this.#placed.delete(seat);

    const w = this.#waiting.indexOf(seat);
    if (w >= 0) {
      this.#waiting.splice(w, 1);
      // A waiting person left. Everybody behind them moves up one place in the
      // queue, which changes their `slot` — the number a spectator card shows
      // as "you are third". Re-place them so the card is not stale.
      return this.#renumberWaiting();
    }

    /*
     * A seated person left, so their slot is open. Rule 4: the longest-waiting
     * spectator takes it. Rule 3: nobody else moves.
     *
     * FAULT ANCHOR — `never-promote` frees the slot and promotes nobody, which
     * is exactly what every one of these games does today: a person who walks
     * in at minute four watches. It is the DEFAULT behaviour dressed as a
     * fault, which is the point — the probe has to be able to tell "dealt in"
     * from "present and ignored", and those two look identical on a roster.
     */
    const next = arcadeFaultActive('never-promote') ? undefined : this.#waiting.shift();
    const moved = this.#renumberWaiting();
    if (next === undefined) return moved;
    this.#placed.set(next, { seat: next, role: gone.role, label: gone.label, slot: gone.slot });
    return [next, ...moved];
  }

  /**
   * The room re-stated its whole seat list. Reconcile without re-dealing.
   *
   * Seats we already knew keep their placement exactly (rule 2); seats we did
   * not are arrivals in the order given; seats we knew and the room no longer
   * lists have left. This is the path a reconnect takes, and it is the one
   * that must not renumber the room.
   */
  reconcile(seats: readonly SeatId[]): void {
    const now = new Set<SeatId>(seats);
    for (const seat of [...this.#placed.keys()]) if (!now.has(seat)) this.leave(seat);
    for (const seat of seats) this.arrive(seat);
  }

  /**
   * The first slot no seat is holding, scanning roles in declared order.
   *
   * A linear scan, and at 32 seats and a handful of roles that is a few
   * hundred comparisons on a departure — which happens when a person walks out
   * of a room, not per frame. An index would be faster and would have to be
   * kept true across arrive / leave / reconcile, which is three places for it
   * to disagree with the map that is actually authoritative.
   */
  #firstOpenSlot(): { role: RoleSpec; slot: number } | null {
    for (const role of this.spec.roles) {
      const taken = new Set<number>();
      for (const p of this.#placed.values()) if (p.role === role.id) taken.add(p.slot);
      for (let slot = 0; slot < role.capacity; slot += 1) {
        if (!taken.has(slot)) return { role, slot };
      }
    }
    return null;
  }

  /** Re-stamp every waiting seat's queue position. Returns the ones that moved. */
  #renumberWaiting(): SeatId[] {
    const moved: SeatId[] = [];
    for (let i = 0; i < this.#waiting.length; i += 1) {
      const seat = this.#waiting[i]!;
      const p = this.#placed.get(seat);
      if (!p || p.slot === i) continue;
      this.#placed.set(seat, { seat, role: SPECTATOR, label: this.spec.spectatorLabel, slot: i });
      moved.push(seat);
    }
    return moved;
  }
}
