/**
 * THE BOARD, ON THE SHARED SCREEN, WITHOUT THE GAME HAVING TO LAY IT OUT.
 *
 * `Panel.ts` renders the rows. On its own that was the whole of the showing
 * half, and a game adopting `@homie-rocks/scores` then had to build an element,
 * position it, define five CSS custom properties `Panel.ts` deliberately gives
 * no fallback for, ask the host who is seated, join that against `top()`, and
 * decide what to draw when any of it refused. Sixty-odd lines, per game, four
 * games — and the four would have disagreed about the refusal case, which is
 * the one that matters.
 *
 * So the host element lives once. A game writes two lines: construct it, and
 * call `show` when its run ends.
 *
 * ## THE TOKENS ARE DEFINED HERE, AND THAT DOES NOT WEAKEN `Panel.ts`'s RULE
 *
 * `boardPanelCSS` gives every colour a custom property with NO fallback on
 * purpose, so a game that forgets one renders visibly broken rather than
 * quietly wearing another game's livery. That rule is about a game rendering a
 * panel INTO ITS OWN HUD, and it is unchanged. This host element is not a
 * game's HUD: it owns its element, so it owns its tokens, and a game that wants
 * its own livery sets them on the host element and they cascade.
 *
 * ## THE REFUSAL IS THE INTERESTING STATE, NOT THE ROWS
 *
 * An empty board and a board that could not be read are the same picture, and
 * they must never be the same colour. Every path through `show` that fails
 * renders the panel with the REASON underneath it, so the screen says *"scores
 * are not being saved tonight"* rather than showing a blank list that reads as
 * "nobody has ever played this".
 *
 * ## NOTHING IS CACHED
 *
 * `show` asks the host for the roster and the board every single time. A cache
 * of a fact outlives the fact and then answers for it, and both facts here
 * change every time anybody finishes anything or walks into the room.
 */

import { boardPanel, boardPanelCSS } from './Panel.ts';
import type { Board, Place } from './Board.ts';
import type { Box } from './Box.ts';
import type { RunBoard } from './Run.ts';
import { ROOM_PALETTE, readSeats, roomBoard } from './Room.ts';

/**
 * The results of no run.
 *
 * Frozen and shared rather than a fresh `new Map()` per call: `roomBoard` only
 * ever reads it, and a mutable empty map handed out repeatedly is the shape
 * where one caller's write becomes every caller's state.
 */
const EMPTY_RESULTS: ReadonlyMap<number, Place> = new Map<number, Place>();

/**
 * How many people who are NOT in the room to list under the ones who are.
 *
 * Six. `Room.roomBoard` bounds only the away half and always shows everybody
 * here, so this is the length of the "and whoever set that in March" tail. Long
 * enough to be a history, short enough to read from a sofa at a glance.
 */
export const AWAY_ROWS = 6;

export interface OverlaySpec {
  /** The host to ask. `boxForThisPage()` in a game. */
  readonly box: Box;
  /**
   * The game's root element — and it is NOT where the host element is appended.
   *
   * It answers two questions: that this game wants a screen at all, and which
   * document it is in. The host element goes at the top of that document, and
   * the reason is measured rather than stylistic — see `MOUNT` below.
   */
  readonly screen: HTMLElement;
  /** The room's colours by index. Defaults to `ROOM_PALETTE` — see `Room.ts`. */
  readonly palette?: readonly string[];
  /** How many away rows. Defaults to `AWAY_ROWS`. */
  readonly limit?: number;
}

export class BoardOverlay {
  readonly #box: Box;
  readonly #palette: readonly string[];
  readonly #limit: number;
  readonly #host: HTMLElement;
  readonly #style: HTMLStyleElement;

  constructor(spec: OverlaySpec) {
    this.#box = spec.box;
    this.#palette = spec.palette ?? ROOM_PALETTE;
    this.#limit = spec.limit ?? AWAY_ROWS;

    const doc = spec.screen.ownerDocument;
    this.#style = doc.createElement('style');
    this.#style.textContent = boardPanelCSS + HOST_CSS;
    doc.head.append(this.#style);

    this.#host = doc.createElement('div');
    this.#host.className = 'hs-host';
    this.#host.hidden = true;
    /*
     * MOUNT: THE DOCUMENT, NOT THE GAME'S ROOT.
     *
     * Until 2026-08-21 the host element was appended to the element the game
     * passed — `#app` in all seven games it was built against — and given
     * `z-index: 6`. Each of those games also has
     * `#ui { position: fixed; inset: 0; z-index: 10 }` as a SIBLING of `#app`,
     * and `#app` is itself `position: fixed`. A fixed-position element creates a
     * stacking context, so the board's z-index was scoped INSIDE `#app` and
     * could not climb out of it at any value: `#ui` painted over the whole
     * subtree, board included. Raising 6 to 20 changed nothing at all, which is
     * how the trap was identified.
     *
     * A probe found it in decoded pixels — three games came back at luma sd
     * 6.7, 4.5 and 6.0 against a floor of 8, with the board dimmed by the menu
     * scrim painting on top of it. That probe's computed-style checks were green
     * throughout, and so was every other check. The four games where it
     * happened to look right were the four whose HUD draws nothing in the
     * bottom-right corner; they were one HUD element away from the same picture.
     *
     * So the board is a top-level layer: appended to the document body,
     * `position: fixed`, above every game HUD. A game does not have to know what
     * a stacking context is to get a leaderboard people can read.
     */
    doc.body.append(this.#host);
  }

  /**
   * Draw the board for the run just posted.
   *
   * `note` is the game's own sentence about why the board looks the way it does
   * — *"nobody reached the finish"* — and it is REPLACED by the refusal
   * when there is one, because a refusal is the more important thing to say.
   */
  async show(run: RunBoard, o: { title: string; note: string | null }): Promise<void> {
    let note = o.note;
    if (run.lastRefusal !== null) {
      console.warn('Scores could not save this result:', run.lastRefusal);
      note = 'This result could not be saved.';
    }
    await this.#render(run.board, run.results, o.title, note);
  }

  /**
   * Draw a board that is not a `RunBoard`.
   *
   * `@homie-rocks/racing` keeps its two boards as plain `Board`s — a finishing
   * place and a fastest lap are recorded for ONE seat, the driver, rather than
   * for everybody at the table, and that is right for a race. Before this
   * method neither racing game could put a leaderboard on the screen at all:
   * `RaceBoardRecorder.last` carries the comment *"for a results screen to
   * show"* and MEASURED 2026-08-21 nothing in either game read it. Three of the
   * eight games recorded a score no person in the room could ever see.
   *
   * The only thing a `RunBoard` adds here is `results` — which rows belong to
   * the run that just happened — so this takes an empty map and everything else
   * is identical. Not a second renderer: the same one, with the one field this
   * caller genuinely does not have.
   */
  async showBoard(board: Board, o: { title: string; note: string | null; refusal?: string }): Promise<void> {
    if (o.refusal !== undefined) console.warn('Scores could not save this result:', o.refusal);
    await this.#render(board, EMPTY_RESULTS, o.title, o.refusal !== undefined ? 'This result could not be saved.' : o.note);
  }

  async #render(
    board: Board,
    results: ReadonlyMap<number, Place>,
    title: string,
    note: string | null,
  ): Promise<void> {
    const seats = await readSeats(this.#box);
    if ('refused' in seats) {
      console.warn('Scores could not read the room:', seats.refused);
      return this.#draw(title, [], [], [note, 'Scores are unavailable right now.'].filter(Boolean).join(' '), true);
    }

    const built = await roomBoard({ board, seats: seats.seats, results, limit: this.#limit });
    if ('refused' in built) {
      console.warn('Scores could not load the board:', built.refused);
      return this.#draw(title, [], [], [note, 'Scores are unavailable right now.'].filter(Boolean).join(' '), true);
    }

    this.#draw(title, built.here, built.away, note);
  }

  /** Take it off the screen. The element stays, so `show` is cheap afterwards. */
  hide(): void {
    this.#host.hidden = true;
  }

  dispose(): void {
    this.#host.remove();
    this.#style.remove();
  }

  #draw(
    title: string,
    here: Parameters<typeof boardPanel>[0]['here'],
    away: Parameters<typeof boardPanel>[0]['away'],
    note: string | null,
    unavailable = false,
  ): void {
    // Game notes remain escaped data; operational diagnostics stay in the console.
    // An unavailable board must not claim that its unread scores are empty.
    this.#host.innerHTML = boardPanel({ title, here, away, palette: this.#palette, note, unavailable });
    this.#host.hidden = false;
  }
}

/**
 * Where the board sits and what colour it is.
 *
 * The prose is out here because a backtick inside the literal below would end
 * it — see `Panel.ts`'s header for what that has already cost. There are no
 * backticks below this line.
 *
 * Bottom right, because the top of the screen is where every one of these
 * games already draws its own HUD, and `pointer-events: none` because this is
 * something to read and not something to press: a panel that ate a tap would
 * be a dead control in front of a guest, which is a defect rather than a
 * cosmetic issue.
 *
 * ## `position: fixed` AND `z-index: 20`, BOTH MEASURED
 *
 * The constructor's `MOUNT` note has the whole argument: the board is appended
 * to the document body rather than into the game, because every game's `#app`
 * is `position: fixed` and therefore a stacking context the board could not
 * climb out of at any z-index.
 *
 * `fixed` follows from that mount — the body is not the game's root and has no
 * useful box, so the viewport is the only correct reference. 20 is above every
 * game HUD (all of them are `#ui` at 10) and below the 100 every one of them
 * gives its boot splash, which must stay on top: it is what a person looks
 * at while the game loads, and a leaderboard over a loading screen would be the
 * first thing in the room and the wrongest.
 */
const HOST_CSS = `
.hs-host {
  position: fixed; right: 2.2vmin; bottom: 2.2vmin; z-index: 20;
  width: min(34ch, 42vw); pointer-events: none;
  padding: 1.1vmin 1.3vmin; border-radius: .6vmin;
  background: rgba(8, 10, 16, .72); backdrop-filter: blur(6px);
  --hs-font: system-ui, -apple-system, "Segoe UI", sans-serif;
  --hs-ink: #e9edf6; --hs-ink-here: #ffffff; --hs-title: #9fb0cc;
  --hs-row: rgba(255, 255, 255, .05); --hs-row-here: rgba(255, 255, 255, .13);
  --hs-place: #8ea3c4; --hs-note: #93a2bb;
}
.hs-host[hidden] { display: none; }
`;
