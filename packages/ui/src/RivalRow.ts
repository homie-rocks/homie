/**
 * ============================================================================
 *  RivalRow — one opponent, one chip, one always-signed interval.
 * ============================================================================
 *
 * The in-race replacement for a standings tower: instead of eight rows nobody
 * can read at speed, ONE row saying who you are actually racing and by how
 * much. The kart racer's HUD and the space racer's HUD each carried a copy —
 * `updateRival` plus `setRelState` plus four element handles plus a livery
 * table — and the copies
 * agreed line for line about everything except four values.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THE COPIES GOT RIGHT, WHICH IS WHY THEY ARE HERE VERBATIM
 * ---------------------------------------------------------------------------
 * 1. THE GAP WAS ZERO. Four captured frames read "LEAD 0.00" and one read
 *    "GAP +0.00", which made a race look like a time trial. The distance came
 *    off `raceDistance`, which is the director's placement SORT KEY and is not
 *    guaranteed to be a metric quantity the instant a racer is repositioned.
 *    The interval is integrated here from the two numbers that are always true
 *    — `lap` and the normalised progress `t` — against the track's own
 *    centreline length. `raceDistance` survives only as the fallback for a
 *    track that has not published a length yet.
 *
 * 2. THE FORMAT CHANGED PER STATE. "LEAD 12.48" / "GAP +0.13" / a labelled
 *    empty cell reading "GRID": three vocabularies for one slot, so a player
 *    had to re-read it rather than glance at it. There is one now — the
 *    rival's chip and name, and a signed delta, ALWAYS signed, so the sign is
 *    read pre-attentively. No target, or on the grid: an em dash, which is a
 *    fact rather than a number.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR DIVERGENCES, AND WHY NONE OF THEM IS A BRANCH
 * ---------------------------------------------------------------------------
 * · **The chip colour.** One game pushes the raw livery hex. The other
 *   desaturates it toward the bone/grey family at 55% chroma, because one of
 *   its teams is a saturated `#e8a02a` — its own reserved HAZARD amber — and a HUD
 *   with four reserved saturated colours cannot spend one on a name badge.
 *   That is a whole paragraph of that game's colour law, so it is that game's
 *   function: `liveryOf`, called once per roster and never per frame.
 * · **The fallback colour** when the table has no entry for a slot. A string.
 * · **The closing-speed floor** — 8 m/s in a kart race, 20 m/s where the
 *   reference class runs at 142. Both exist so a stationary racer cannot divide
 *   the interval into infinity, and both are a speed. A number.
 * · **The chip's stencil mark.** One game writes `data-mk` per grid slot
 *   because its chips are shapes rather than a fifth grey. An optional
 *   `decorateChip`, absent in the other game rather than passed as `false`.
 *
 * None of those is `if (game === 'kart')`. A `mode` parameter would have been
 * that same smell wearing a suit.
 *
 * ---------------------------------------------------------------------------
 * NO Ctx CROSSES THIS SEAM
 * ---------------------------------------------------------------------------
 * Exactly the fields the shared code reads, and nothing else:
 *
 *     race.karts[] · place · lap · t · raceDistance · stats.name
 *     race.player  · the same, plus `finished` and `forwardSpeed`
 *     the track's centreline length, as a number, passed in
 *
 * `stats.color` is NOT on the interface. Both games read it, and both read it
 * inside their own `liveryOf` — so this package never learns what a colour is,
 * and in particular never grows a three.js dependency for a `#rrggbb`.
 */
import { el, clamp, formatDelta, setText, setStyle } from './uiUtil.ts';

/**
 * Below this, the interval to the racer you are chasing is not a number anyone
 * can act on — it is the readout flickering around zero. Identical in both
 * games (0.015), and it belongs to the widget rather than to either of them:
 * it is a property of a signed readout, not of a track.
 */
const GAP_FLOOR = 0.015;

/** Exactly the racer fields this row reads. */
export interface RivalRacer {
  /** 1-based classification position */
  readonly place: number;
  readonly lap: number;
  /** normalised lap progress, [0,1) */
  readonly t: number;
  /** the director's placement sort key — the fallback distance, never the first choice */
  readonly raceDistance: number;
  readonly finished: boolean;
  /** metres per second along the racer's own forward axis */
  readonly forwardSpeed: number;
  readonly stats: { readonly name: string };
}

export interface RivalRace {
  readonly karts: readonly RivalRacer[];
  readonly player: RivalRacer;
}

export interface RivalRowOptions {
  /**
   * The chip colour for grid slot `i`, resolved ONCE per roster and cached —
   * one game desaturates and that is eight multiplies it must not pay per
   * frame. Declared with method syntax so a game may type it against its own
   * racer without a variance error.
   */
  liveryOf(k: RivalRacer, i: number): string;
  /** the chip colour when the table has no entry for that slot */
  readonly fallbackColour: string;
  /**
   * Closing-speed floor, m/s. A stationary racer must not divide the interval
   * into infinity, and the right floor is a fraction of the game's own pace.
   */
  readonly closingFloor: number;
  /** anything else the chip carries per grid slot — a stencil mark, a shape */
  decorateChip?(chip: HTMLElement, i: number): void;
  /** copy: no rival on track at all */
  readonly soloText: string;
  /** copy: the row's name field before a race has started */
  readonly gridText: string;
  /** copy: no measurable interval — on the grid, counting down, or finished */
  readonly noGapText: string;
  /** copy: genuinely alongside. A signed 0.00 is noise; this is the fact. */
  readonly levelText: string;
}

export class RivalRow {
  private readonly row: HTMLDivElement;
  private readonly chip: HTMLSpanElement;
  private readonly name: HTMLSpanElement;
  private readonly val: HTMLSpanElement;

  /** chip colour per grid slot, resolved once — see `liveryOf` */
  private liveries: string[] = [];
  /** last mark written to the chip, so a decorate costs nothing when idle */
  private mark = '';
  private state = '';

  constructor(parent: HTMLElement, private readonly opts: RivalRowOptions) {
    this.row = el('div', 'kr-rel none', parent);
    this.chip = el('span', 'kr-rel-c', this.row);
    this.name = el('span', 'kr-rel-n', this.row, opts.gridText);
    this.val = el('span', 'kr-rel-v', this.row, opts.noGapText);
  }

  /**
   * @param trackLength the track's centreline length in metres, or 0 if the
   *   track has not published one — the `raceDistance` fallback covers that.
   * @param place the player's own 1-based position, already read by the caller
   * @param counting true during the countdown, when no interval is meaningful
   */
  update(race: RivalRace, trackLength: number, place: number, counting: boolean) {
    const player = race.player;
    const karts = race.karts;
    if (this.liveries.length !== karts.length) {
      this.liveries.length = 0;
      for (let i = 0; i < karts.length; i++) this.liveries.push(this.opts.liveryOf(karts[i]!, i));
    }

    // The racer you are actually racing: the one ahead, or — if you are leading
    // — the one chasing you. That is the only gap you can act on.
    const want = place === 1 ? 2 : place - 1;
    let other: RivalRacer | null = null;
    let otherIdx = -1;
    for (let i = 0; i < karts.length; i++) {
      if (karts[i] !== player && (karts[i]!.place | 0) === want) { other = karts[i]!; otherIdx = i; break; }
    }

    if (!other) {
      this.setState('none');
      setText(this.name, this.opts.soloText);
      setText(this.val, this.opts.noGapText);
      return;
    }

    setStyle(this.chip, '--c', this.liveries[otherIdx] || this.opts.fallbackColour);
    if (this.opts.decorateChip) {
      const mk = String(otherIdx & 7);
      if (this.mark !== mk) {
        this.mark = mk;
        this.opts.decorateChip(this.chip, otherIdx);
      }
    }
    setText(this.name, other.stats.name);

    if (counting || player.finished) {
      this.setState('none');
      setText(this.val, this.opts.noGapText);
      return;
    }

    const metres = trackLength > 1
      ? ((other.lap + other.t) - (player.lap + player.t)) * trackLength
      : other.raceDistance - player.raceDistance;
    const closing = Math.max(this.opts.closingFloor, Math.abs(player.forwardSpeed));
    const secs = clamp(metres / closing, -99, 99);

    if (Math.abs(secs) < GAP_FLOOR) {
      this.setState('none');
      setText(this.val, this.opts.levelText);
      return;
    }
    this.setState(secs < 0 ? 'ahead' : 'behind');
    setText(this.val, formatDelta(secs));
  }

  /** Cached class write — this runs at 10 Hz and must cost nothing when idle. */
  private setState(s: string) {
    if (s === this.state) return;
    this.state = s;
    this.row.className = 'kr-rel ' + s;
  }
}
