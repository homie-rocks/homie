/**
 * A BOARD SPLIT INTO THE PEOPLE WHO ARE HERE AND THE PEOPLE WHO ARE NOT.
 *
 * This is the reason to build a leaderboard for a room rather than copy one off
 * a console. A console board is a list of strangers; a board for people in one
 * room is *"you, the person next to you, and whoever set that lap in March"*.
 * Getting there needs a join between the board (names and scores) and the room
 * (seats and presence), and **the join is the trap**: the host's seat service
 * deliberately lets no profile id or device id out of the room, so a package
 * holds names on both sides and no key. Matching on names is wrong for the two
 * cases a room actually produces — two people with the same name, and anybody
 * who renamed themselves an hour ago.
 *
 * So it never does one. `here` is built from the `Place`s the game got back from
 * `Board.record` this round, where the host already resolved each seat to a
 * person. `away` is `top()` with those names removed — a name is compared
 * exactly once, and only to REMOVE a duplicate. That direction matters: a
 * surviving duplicate shows one person twice, which is cosmetic; the join the
 * other way puts the wrong face on a rank, which is not.
 *
 * ## "A held seat is not a person" — twice, in opposite directions
 *
 * **Submitting uses the held seat.** `Board.record` says so and it is right: a
 * game saving a result is naming the person who played it, and the host ignores
 * presence when it resolves a seat to a person for the same reason.
 *
 * **Showing does not.** `here` admits `playing` and `here` only, mirroring the
 * host's own rule for who counts as in the room. A seat held for thirty minutes
 * by somebody who left, and a phone sitting on a kitchen counter, are both
 * away.
 *
 * Stating both, out loud, is the design rather than an inconsistency.
 */

import type { Box } from './Box.ts';
import type { Board, Place } from './Board.ts';

/**
 * Presences that put somebody in the room's own half of the board.
 *
 * `playing` and `here`. Not `nearby` — the host's own contract says it
 * "counts for nothing" — and not `gone`.
 */
export const PRESENT_ON_A_BOARD: ReadonlySet<string> = new Set(['playing', 'here']);

/**
 * THE ROOM PALETTE, and it lives here because `Seat.colour` is the only thing
 * that can be decoded with it.
 *
 * A seat's colour is an INDEX the room issued. Only the room's own palette
 * turns it into a hue: a game that decoded it with its own art direction would
 * put a guest in a colour the TV has never called them, and it would look
 * completely fine. So `PanelSpec.palette` stays required and undefaulted — a
 * game rendering its own board still has to say what it wants — and this is
 * the answer for anybody drawing the ROOM's seats.
 *
 * ## THIS IS A COPY, AND THAT IS RECORDED, NOT HIDDEN
 *
 * The same sixteen strings are the host's own seat palette, which this package
 * cannot import. A disagreement between the two is a guest's phone tile and
 * the TV tile being different colours, so this array must match the host's
 * exactly, in order, and a check outside this package holds it to that. A
 * drifting copy is then a red check rather than a thing somebody notices in a
 * photograph.
 */
export const ROOM_PALETTE: readonly string[] = [
  '#ff6b6b', // 0  red
  '#ff9f45', // 1  orange
  '#ffd23f', // 2  yellow
  '#8fe36a', // 3  green
  '#2fd8b6', // 4  teal
  '#4fb6ff', // 5  blue
  '#a98cff', // 6  violet
  '#ff7ad1', // 7  magenta
  '#ffb3a7', // 8  blush
  '#ffd2a0', // 9  sand
  '#f4ecac', // 10 cream
  '#c3ebae', // 11 mint
  '#a5e6da', // 12 aqua
  '#b3d4f7', // 13 powder
  '#d3c6f5', // 14 lilac
  '#f7c0e0', // 15 rosewater
];

/** One seat, as the host's `people.list` answers it. */
export interface Seat {
  readonly seat: number;
  /** Guest-typed. Data. */
  readonly name: string;
  /** The palette index the room gave this person. NOT a hex string. */
  readonly colour: number;
  readonly presence: string;
}

/** A row for somebody in the room: a place, plus who and what colour they are. */
export interface RoomRow extends Place {
  readonly seat: number;
  readonly colour: number;
}

/** A row for somebody who is not: a place and a name, and no seat to point at. */
export interface AwayRow {
  readonly place: number;
  readonly sharedWith: number;
  readonly name: string;
  readonly shown: string;
}

/**
 * Ask the host who is seated.
 *
 * Asked every time, never remembered. Somebody walks in at minute four and is
 * dealt in; a cached roster is how they are not.
 */
export async function readSeats(box: Box): Promise<{ seats: readonly Seat[] } | { refused: string }> {
  const got = await box.call('people.list', {});
  if (!got.ok) return { refused: got.error };
  if (!Array.isArray(got.output)) {
    return { refused: `people.list answered with something that is not a list: ${JSON.stringify(got.output)}` };
  }
  const seats: Seat[] = [];
  for (const item of got.output) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['seat'] !== 'number' || !Number.isInteger(r['seat'])) continue;
    seats.push({
      seat: r['seat'],
      name: typeof r['name'] === 'string' ? r['name'] : '',
      colour: typeof r['colour'] === 'number' ? r['colour'] : 0,
      presence: typeof r['presence'] === 'string' ? r['presence'] : 'gone',
    });
  }
  return { seats };
}

/**
 * The board as this room should see it.
 *
 * `results` is what `Board.record` returned for each seat this round. Pass an
 * empty map for a board shown before anybody has played — everything lands in
 * `away`, which is the honest answer: nobody here has a result yet.
 *
 * `limit` bounds the AWAY half only. Everybody in the room who played is always
 * shown: a board that hides the person standing in front of it because eleven
 * strangers beat them is a board nobody looks at twice.
 */
export async function roomBoard(o: {
  board: Board;
  seats: readonly Seat[];
  results: ReadonlyMap<number, Place>;
  limit: number;
}): Promise<{ here: readonly RoomRow[]; away: readonly AwayRow[] } | { refused: string }> {
  const bySeat = new Map<number, Seat>();
  for (const s of o.seats) bySeat.set(s.seat, s);

  const here: RoomRow[] = [];
  for (const [seat, place] of o.results) {
    const who = bySeat.get(seat);
    if (!who || !PRESENT_ON_A_BOARD.has(who.presence)) continue;
    here.push({
      ...place,
      seat,
      colour: who.colour,
      // The seat's CURRENT name wins over the one the board answered with. The
      // host refreshes the stored name on every submit for exactly this reason,
      // and this is the one place a seat is available to key on, so it is the
      // one place the freshest name is knowable.
      name: who.name,
    });
  }
  here.sort((a, b) => a.place - b.place || a.seat - b.seat);

  const top = await o.board.top(o.limit + here.length);
  if ('refused' in top) return { refused: top.refused };

  const mine = new Set(here.map((r) => r.name));
  const away: AwayRow[] = [];
  for (const p of top.places) {
    if (away.length >= o.limit) break;
    if (mine.has(p.name)) continue;
    away.push({ place: p.place, sharedWith: p.sharedWith, name: p.name, shown: p.shown });
  }

  return { here, away };
}
