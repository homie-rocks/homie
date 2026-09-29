/**
 * WHAT A GAME COUNTS, AND WHICH END OF IT IS GOOD.
 *
 * The host's leaderboard service stores one number per person and sorts it
 * **descending**, keeps a personal best only when `score > mine.score`, and
 * trims the lowest rows off the bottom. Those three sentences are the host's
 * whole opinion about a score, and they are correct for a streak and
 * catastrophic for a lap time: submit `84213` milliseconds and the slowest lap
 * anybody drives all evening sits at the top of the board looking completely
 * fine.
 *
 * So a `Dimension` is the game saying what its number MEANS, and `encode` is the
 * one function that turns it into the descending scalar the host stores. After
 * that the host is right about all three of its opinions and does not have to
 * be changed — encoding around them **is** the boundary being respected, which
 * is why nothing in this package asks the host to learn about direction.
 *
 * ## Every field is REQUIRED, and that is the design
 *
 * There is no default direction, no default format and no derived `encode`.
 * A game that inherited a default ranking direction would post its lap times
 * upside down and the board would look completely fine — the failure would be a
 * correct-looking screen, the hardest kind to notice. A missing field is a
 * compile error instead.
 *
 * ## `encode` THROWS. It never clamps.
 *
 * A value outside the encodable range is a bug in the game's arithmetic — a
 * negative lap time, a NaN streak. Clamping it records a plausible score for a
 * run that did not happen. A crash gets fixed; a plausible default gets quoted,
 * and here it gets quoted off a TV in front of the room.
 */

/*
 * `formatClock` and `ordinalSuffix` come from `@homie-rocks/ui`. They are NOT
 * re-written here: `uiUtil.ts` already carries the two-digit pad table and the
 * teens case, the racing HUDs read them, and a second spelling of `11th` would
 * be a competing implementation. `formatClock` takes SECONDS — the racers'
 * unit — so the millisecond dimension below divides at the one call site rather
 * than everywhere.
 */
import { formatClock, ordinalSuffix } from '@homie-rocks/ui/uiUtil.js';

/** Which end of the number is the good end. Stated by the game, never guessed. */
export type Direction = 'high' | 'low';

export interface Dimension {
  /**
   * Part of every key this dimension's board lives under. Changing it starts a
   * NEW board rather than reinterpreting the old one, which is the only safe
   * thing to do when the meaning of a stored number changes.
   */
  readonly id: string;
  /** What the board's heading calls it. Guest-visible prose, chosen by the game. */
  readonly title: string;
  readonly direction: Direction;
  /** `"1:24.213"`, `"12 laps"`, `"48,200"`. The game owns its own units. */
  format(value: number): string;
  /**
   * Map to the single DESCENDING scalar the host stores. Required, never derived
   * from `direction`: the encoding is lossy — a lap time needs a cap, a place
   * needs a field size — and the game owns the loss.
   */
  encode(value: number): number;
  /** The inverse, for reading a board back. `decode(encode(v))` must be `v`. */
  decode(stored: number): number;
}

/** Thrown by every `encode` in this file. Never caught inside this package. */
export class UnencodableScore extends Error {
  constructor(dimension: string, value: number, why: string) {
    super(`${dimension}: cannot encode ${String(value)} — ${why}`);
    this.name = 'UnencodableScore';
  }
}

/**
 * A duration where FASTER IS BETTER — a lap, a split, a run.
 *
 * `capMs` is required and it is the lossy part: the stored scalar is
 * `capMs - ms`, so a time at or past the cap encodes to zero or below and is
 * refused rather than folded. Pick a cap comfortably past the slowest lap
 * anybody could drive on purpose; a cap chosen too tight throws in front of the
 * room, and a cap chosen too loose costs nothing at all.
 */
export function timeDimension(id: string, title: string, o: { capMs: number }): Dimension {
  const cap = o.capMs;
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new UnencodableScore(id, cap, 'capMs must be a finite positive number of milliseconds');
  }
  return {
    id,
    title,
    direction: 'low',
    // Thousandths, not hundredths. A HUD clock rounds to hundredths because a
    // digit changing sixty times a second is unreadable at three metres; a board
    // is read standing still, and hiding the thousandth shows two different laps
    // as the same time.
    format: (ms) => (Number.isFinite(ms) ? formatClock(ms / 1000, 3) : '—'),
    encode(ms) {
      if (!Number.isFinite(ms)) throw new UnencodableScore(id, ms, 'a time must be a finite number of milliseconds');
      if (ms < 0) throw new UnencodableScore(id, ms, 'a time cannot be negative');
      if (ms >= cap) throw new UnencodableScore(id, ms, `slower than this board's cap of ${cap} ms`);
      return cap - ms;
    },
    decode: (stored) => cap - stored,
  };
}

/**
 * A count where MORE IS BETTER — a streak, a kill, a coin, a crate delivered.
 *
 * The identity encoding, and it still refuses a negative: the host's `improved`
 * rule means a negative would be stored once and could then never be beaten
 * downwards, so a bug that produced one would follow a person around for the
 * life of the board.
 */
export function countDimension(id: string, title: string): Dimension {
  return {
    id,
    title,
    direction: 'high',
    format: (n) => groupDigits(Math.round(n)),
    encode(n) {
      if (!Number.isFinite(n)) throw new UnencodableScore(id, n, 'a count must be a finite number');
      if (n < 0) throw new UnencodableScore(id, n, 'a count cannot be negative');
      return Math.round(n);
    },
    decode: (stored) => stored,
  };
}

/**
 * A FINISHING POSITION, where 1 is best — a race, a heat, a round.
 *
 * `of` is the size of the field and it is required for the same reason `capMs`
 * is: the encoding is `of + 1 - place`, so first in a field of eight scores 8
 * and first in a field of four scores 4. **Two field sizes on one board are not
 * comparable**, which is why `of` belongs in the dimension's `id` when a game
 * genuinely runs both — this function will not do that silently.
 */
export function placeDimension(id: string, title: string, o: { of: number }): Dimension {
  const field = o.of;
  if (!Number.isInteger(field) || field < 1) {
    throw new UnencodableScore(id, field, 'the field size must be a whole number of racers, at least 1');
  }
  return {
    id,
    title,
    direction: 'low',
    format: (place) => `${Math.round(place)}${ordinalSuffix(Math.round(place))}`,
    encode(place) {
      if (!Number.isInteger(place)) throw new UnencodableScore(id, place, 'a finishing position is a whole number');
      if (place < 1) throw new UnencodableScore(id, place, 'the best finishing position is 1');
      if (place > field) throw new UnencodableScore(id, place, `there are only ${field} places on this board`);
      return field + 1 - place;
    },
    decode: (stored) => field + 1 - stored,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** `48,200`. Read across a room, so the separator is not decoration. */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return sign + out;
}
