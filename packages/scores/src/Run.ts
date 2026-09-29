/**
 * ONE RUN, RECORDED FOR EVERYBODY WHO WAS AT THE TABLE WHEN IT ENDED.
 *
 * `Board.ts` records ONE person's score. Every game that wanted a leaderboard
 * then had to write the same four things on top of it: a game template and
 * `@homie-rocks/racing`'s `board.ts` had already written all four, differently,
 * and the next four games would each have written them a third and fourth
 * time.
 *
 *   1. A seat the ROOM issued is a number; a keyboard seat is the string
 *      `kb:0` (`@homie-rocks/arcade`'s `Local.ts`). A board keyed by seat
 *      number has nowhere to put a string, and both available wrong answers
 *      are bad — coerce to `0` and the run lands on whoever seat 0 is tonight,
 *      or `Number('kb:0')` is `NaN` and a `NaN` row can never be beaten.
 *   2. An empty name is not a name. `@homie-rocks/arcade` fills one in for a
 *      phone that has not said who it is yet, and `Guest` sitting on a board
 *      for a month is worse than a row with no name beside it.
 *   3. `encode` throws on a value the dimension cannot represent, and it has
 *      to throw BEFORE the first write — otherwise a two-person run records
 *      one person and crashes on the second, which is the worst of both.
 *   4. A refusal has to be READ. Every method here answers with the refusals
 *      it collected and says them on the console as well, because a score that
 *      was not recorded must not look like one that was.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN DECISION, MADE HERE AND NOT PARKED: A RUN BELONGS TO THE ROOM
 * ---------------------------------------------------------------------------
 *
 * `post()` writes the SAME value for every person at the table. Not a share,
 * not a split, not the person who pressed last: everyone who was holding a
 * phone when the run ended gets the run against their name.
 *
 * That is a real choice and somebody can disagree with it in one glance, which
 * is the point. The argument for it: **a leaderboard for people in one room is
 * not a global ranking, it is "who was here and what happened"**. The four
 * games this was built for are co-operative or relayed — in one, two roles
 * must work together and neither can finish alone; in another, a queue of
 * people takes turns; in another, two jobs run at once. Splitting the credit
 * would need a model of contribution that none of them has, and awarding it to
 * one seat would put one person's name on four people's evening.
 *
 * The cost is stated too: somebody who picks up a phone thirty seconds before
 * the end is on the board for the whole run. In a shared room that is not a
 * cheat, it is what happened — they were here.
 */

import { Board } from './Board.ts';
import type { Place } from './Board.ts';
import type { Box } from './Box.ts';
import type { Dimension } from './Dimension.ts';
import { scoresFaultActive } from './faults.ts';

/**
 * Somebody at a table, as `@homie-rocks/arcade`'s `Player` happens to be shaped.
 *
 * DECLARED AS THE TWO FIELDS THIS FILE READS and not imported from
 * `@homie-rocks/arcade`. That package is a GENRE shelf and this one is
 * platform; platform importing a genre would be a dependency pointing the wrong
 * way. Structural typing means every call site passes `table.playing(ROLE)`
 * unchanged.
 */
export interface Seated {
  /** `string | number` on purpose. A local keyboard seat is a STRING. */
  readonly seat: string | number;
  readonly name: string;
}

/** Somebody the host's leaderboard can actually key on. */
export interface Attribution {
  readonly seat: number;
  /** What to write beside the score, or `null` for none. Guest-typed: DATA. */
  readonly label: string | null;
}

/**
 * The people at a table who can be recorded, in the order they were given.
 *
 * Non-numeric seats are DROPPED rather than coerced — see point 1 in the
 * header — and a seat that appears twice is taken once, because two roles held
 * by one person is one person and a board that counted them twice would show
 * the same name on two rows of the same run.
 */
export function attributable(players: readonly Seated[]): readonly Attribution[] {
  const out: Attribution[] = [];
  const seen = new Set<number>();
  for (const p of players) {
    if (typeof p.seat !== 'number' || !Number.isInteger(p.seat)) {
      // FAULT ANCHOR — `seat-guessed` coerces the keyboard seat to 0 here.
      if (scoresFaultActive('seat-guessed')) out.push({ seat: 0, label: p.name === '' ? null : p.name });
      continue;
    }
    if (seen.has(p.seat)) continue;
    seen.add(p.seat);
    out.push({ seat: p.seat, label: p.name === '' ? null : p.name });
  }
  return out;
}

/** What one run put on the board, and everything it could not. */
export interface RunRecorded {
  /** How many people the run was actually written against. */
  readonly recorded: number;
  /** One sentence per failure, each one something a person could act on. */
  readonly refused: readonly string[];
}

/**
 * A board plus the results of the run this room just played.
 *
 * `results` is what `Room.roomBoard` needs to build the here/away split, and it
 * is REPLACED by each `post` rather than accumulated: it is "what happened this
 * run", and a map that grew all evening would put somebody who went home into
 * the room's own half of the board.
 */
export class RunBoard {
  readonly board: Board;

  /** Seat to the place it took in the run just posted. Read by `Room.roomBoard`. */
  readonly results = new Map<number, Place>();

  /**
   * Why the last post did not record, or `null` when it did.
   *
   * A screen shows this instead of an empty board. *"We could not measure it"*
   * and *"we measured it and nobody has played"* must never be the same colour,
   * and an empty leaderboard is exactly what the second one looks like.
   */
  lastRefusal: string | null = null;

  #posting = false;

  constructor(dimension: Dimension, box: Box) {
    this.board = new Board(dimension, box);
  }

  /**
   * Record one finished run for everybody at the table.
   *
   * `encode` is called ONCE, here, before any write leaves the page. A value
   * this dimension cannot represent is the game's arithmetic bug and it throws
   * — uncaught, deliberately, exactly as `Board.record` does. Doing it up front
   * is what stops a four-person run recording two people and then throwing.
   *
   * Re-entrant posts are refused rather than queued. Two of these in flight
   * would race on `results` and the board would show whichever finished last,
   * which is a screen that is right by accident.
   */
  async post(players: readonly Seated[], value: number, label: string | null): Promise<RunRecorded> {
    if (this.#posting) {
      return this.#refuseAll(['a run is already being recorded, so this one was dropped']);
    }
    const who = attributable(players);
    if (who.length === 0) {
      return this.#refuseAll([
        'nobody the box knows was at the table when this run ended, so there is no person to record it against',
      ]);
    }
    // Throws on a value this board cannot hold. Before the first write. See above.
    this.board.dimension.encode(value);

    this.#posting = true;
    const refused: string[] = [];
    const places = new Map<number, Place>();
    try {
      for (const person of who) {
        const r = await this.board.record(person.seat, value, label ?? person.label);
        if ('placed' in r) places.set(person.seat, r.placed);
        else refused.push(`seat ${person.seat}: ${r.refused}`);
      }
    } finally {
      this.#posting = false;
    }

    this.results.clear();
    for (const [seat, place] of places) this.results.set(seat, place);
    this.lastRefusal = refused.length === 0 ? null : refused.join('; ');
    say(refused);
    return { recorded: places.size, refused };
  }

  /** Nothing was written. Say so, keep no stale places, and hand the reason back. */
  #refuseAll(refused: readonly string[]): RunRecorded {
    this.results.clear();
    this.lastRefusal = refused.join('; ');
    say(refused);
    return { recorded: 0, refused };
  }
}

/**
 * Say every refusal out loud.
 *
 * The console is the loudest channel a running package has to itself: a
 * plausible default gets quoted, a crash gets fixed. Silence here would make a
 * board that records nothing look identical to a board nobody has played on.
 */
function say(refused: readonly string[]): void {
  // FAULT ANCHOR — `silent-refusal` swallows every one of these.
  if (scoresFaultActive('silent-refusal')) return;
  for (const why of refused) console.warn('[board] not recorded —', why);
}
