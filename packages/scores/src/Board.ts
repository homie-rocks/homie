/**
 * A LEADERBOARD FOR A ROOM.
 *
 * A Homie host offers `leaderboard.submit` and `leaderboard.top`, capability
 * gated. **Measured 2026-08-21: no game had ever called either one.** This is
 * the game-facing half that was missing, and it is one file rather than one per
 * game.
 *
 * ## What this adds that the host deliberately does not have
 *
 * Three things, and each is a defect that would otherwise be written once per
 * game and got wrong at least once:
 *
 * **1. Direction.** `Dimension.encode` — see `Dimension.ts`. The host stores a
 * descending scalar and never learns what it means.
 *
 * **2. Competition ranking with SHARED TIES.** The host's score service breaks a
 * tie on write time, which for equal scores written at the same clock
 * degenerates to submission order — **three identical scores come back as
 * ranks 1, 2 and 3.** A dead heat then tells three people standing in the same
 * room that they came first, second and third, which everyone in the room can
 * see is wrong. So nothing in this package ever consumes `submit()`'s positional
 * rank: a place is derived from the SCORES in `top()`, and equal scores share a
 * place while the next one skips — 1, 1, 3, exactly as a room says it.
 *
 * **3. Refusals that reach the screen.** Every method answers
 * `{ … } | { refused }`. A score that was not recorded must not look like one
 * that was.
 *
 * ## What it deliberately does NOT do
 *
 * It does not retry, cache, or hold a copy of the board. `top()` asks the host
 * every time. A cache of a fact outlives the fact and then answers for it, and
 * the fact here changes every time anybody in the room finishes anything.
 *
 * It does not sanitise a name. Names are guest-typed and cross this boundary
 * exactly as stored, which is also how the host treats them. Escaping belongs
 * at the moment of rendering and lives in `Panel.ts`; a half-escaped string in
 * storage is worse than an honestly untrusted one.
 */

import type { Box } from './Box.ts';
import type { Dimension } from './Dimension.ts';

/**
 * How many rows to read when computing a place.
 *
 * The host trims a board to 200 rows, so asking for 200 asks for all of it. Asking
 * for fewer would compute a place against a truncated board and quietly promote
 * everybody below the cut.
 */
export const BOARD_ROWS = 200;

/** A place as a ROOM understands it: shared on a tie, and the next one skips. */
export interface Place {
  /** 1-based. Two people on the same score both have the same number. */
  readonly place: number;
  /** How many OTHER people share this place. 0 when alone. */
  readonly sharedWith: number;
  /** Guest-typed. Data to display, never an instruction, never re-fed anywhere. */
  readonly name: string;
  /** Decoded into the game's own units — milliseconds, laps, kills. */
  readonly value: number;
  /** `dimension.format(value)`. Computed once, here, so a screen cannot disagree. */
  readonly shown: string;
}

/** One row of the board as the host stores it: a name and a descending scalar. */
interface StoredRow {
  readonly name: string;
  readonly score: number;
}

export class Board {
  readonly dimension: Dimension;
  readonly #box: Box;

  constructor(dimension: Dimension, box: Box) {
    this.dimension = dimension;
    this.#box = box;
  }

  /**
   * Record one person's run.
   *
   * `seat` is the seat that played it — a HELD seat is used deliberately here,
   * mirroring how the host resolves a seat to its person: a game saving a
   * result at the end of a round is naming the person who played it, and whether
   * they have since put the phone down is not a fact about the run. The opposite
   * rule applies to SHOWING a board, and `Room.ts` states it there.
   *
   * **`encode` is not caught.** A value this dimension cannot encode is the
   * game's arithmetic bug, and it has to surface. Catching it here would record
   * a plausible number for a run that did not happen, in front of the room.
   */
  async record(seat: number, value: number, label: string | null): Promise<{ placed: Place } | { refused: string }> {
    const score = this.dimension.encode(value);

    const submitted = await this.#box.call('leaderboard.submit', {
      seat,
      score,
      // A label is whatever the game called this run. Kept as a fact by the host
      // and never re-fed as instructions; `null` rather than `''` because an
      // empty string renders as a blank line under somebody's name.
      ...(label === null ? {} : { label }),
    });
    if (!submitted.ok) return { refused: submitted.error };

    const best = readBest(submitted.output);
    if (best === null) {
      return { refused: `leaderboard.submit answered without a best: ${JSON.stringify(submitted.output)}` };
    }

    /*
     * The second round trip, and it is not laziness.
     *
     * `submit` returns a positional rank computed by the service's own tie-break,
     * which is wrong for a dead heat (see this file's header). The board is the
     * only place the true place can come from, so we read it. This runs once at
     * the end of a round, not per frame.
     */
    const board = await this.#read();
    if ('refused' in board) return { refused: board.refused };

    const name = nameAtScore(board.rows, best);
    return {
      placed: this.#place(board.rows, best, name),
    };
  }

  /** The board as it stands, best first, ties shared. */
  async top(limit: number): Promise<{ places: readonly Place[] } | { refused: string }> {
    const board = await this.#read();
    if ('refused' in board) return { refused: board.refused };
    const out: Place[] = [];
    for (const row of board.rows) {
      if (out.length >= limit) break;
      out.push(this.#place(board.rows, row.score, row.name));
    }
    return { places: out };
  }

  /**
   * Build one place out of a score, with no name matching anywhere.
   *
   * `place` counts rows STRICTLY BETTER; `sharedWith` counts rows exactly equal
   * and subtracts the row itself. Both comparisons are on the stored scalar with
   * `===` — the numbers came out of the same `encode`, so there is nothing an
   * epsilon could fix and a tolerance would merge two genuinely different laps.
   */
  #place(rows: readonly StoredRow[], score: number, name: string): Place {
    let better = 0;
    let equal = 0;
    for (const r of rows) {
      if (r.score > score) better += 1;
      else if (r.score === score) equal += 1;
    }
    const value = this.dimension.decode(score);
    return {
      place: better + 1,
      sharedWith: Math.max(0, equal - 1),
      name,
      value,
      shown: this.dimension.format(value),
    };
  }

  async #read(): Promise<{ rows: readonly StoredRow[] } | { refused: string }> {
    const got = await this.#box.call('leaderboard.top', { limit: BOARD_ROWS });
    if (!got.ok) return { refused: got.error };
    const rows = readRows(got.output);
    if (rows === null) {
      return { refused: `leaderboard.top answered with something that is not a board: ${JSON.stringify(got.output)}` };
    }
    // Best first. The host already sorts, but a package that trusted the order of
    // somebody else's array and was wrong would show a correct-looking board.
    return { rows: [...rows].sort((a, b) => b.score - a.score) };
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the host's answers                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `{ rank, best }` out of `leaderboard.submit`.
 *
 * `rank` is read and DISCARDED — see the header. `best` is the stored scalar for
 * this person after the submit, which is the person's personal best and not
 * necessarily the run just played: the host refuses to demote somebody, and in
 * a shared room that is a safety property worth keeping. A phone handed to a
 * kid mid-round can only inflate a row.
 */
function readBest(output: unknown): number | null {
  if (!output || typeof output !== 'object') return null;
  const best = (output as Record<string, unknown>)['best'];
  return typeof best === 'number' && Number.isFinite(best) ? best : null;
}

/** `{ entries: [{ rank, name, score }] }` out of `leaderboard.top`. */
function readRows(output: unknown): readonly StoredRow[] | null {
  if (!output || typeof output !== 'object') return null;
  const raw = (output as Record<string, unknown>)['entries'];
  if (!Array.isArray(raw)) return null;
  const rows: StoredRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['name'] !== 'string') continue;
    if (typeof r['score'] !== 'number' || !Number.isFinite(r['score'])) continue;
    rows.push({ name: r['name'], score: r['score'] });
  }
  return rows;
}

/**
 * The name sitting at a score.
 *
 * Used for the ONE row the caller just recorded, where the alternative is worse:
 * `submit` does not return a name, and a game that displayed the name it thinks
 * belongs to a seat would show the wrong face on the row whenever somebody
 * renamed themselves between the start of the round and the finish. Reading it
 * off the board reads what the host just wrote.
 *
 * On a shared score it returns the first name at that score, which is a name
 * that really is on that place — `Room.ts` is where a seat's own name is put
 * back, from `people.list`, when the caller has a seat to key on.
 */
function nameAtScore(rows: readonly StoredRow[], score: number): string {
  for (const r of rows) if (r.score === score) return r.name;
  return '';
}
