/**
 * THE WIRING FOUR GAMES EACH WROTE SEPARATELY, WRITTEN ONCE.
 *
 * `Run.ts` records a run. `Overlay.ts` draws one. Between them sat a third
 * thing that neither package file owned and every consumer therefore had to:
 * resolve a host, build the board on it, build an overlay on the SAME host,
 * hold an unsubscribe, ask who is at the table at the moment the run ends,
 * post, show the overlay with the dimension's own title, and take all three
 * apart again on `dispose`.
 *
 * ## The measurement, and it is a finding about THIS PACKAGE
 *
 * Four games were wired to a board, and each one paid for that wiring
 * separately: adoption cost 29, 32, 37 and 37 substantive lines, against a
 * package that advertised *"four lines"*. The four boards then held **four
 * copies of the same eleven-line dance**, differing only in the private field
 * names — and what is left in a game folder should be only what makes that
 * game unique.
 *
 * A cost of a couple of dozen lines per game is not a fact about the games. It
 * is a fact about the shelf, and this file is the shelf answering for it.
 *
 * ## What a game is left holding, and it is the entire point
 *
 * The dimension, the trigger, the value, the label. Nothing else. Everything
 * below this line is the same in all four and can therefore only be wrong once.
 *
 * ## `who()` IS A METHOD AND NOT A FIELD, AND THAT IS LOAD-BEARING
 *
 * It is CALLED at the moment a run ends, never sampled at construction. A
 * player who hands the phone over on the last leg of a run must not have that
 * run recorded against them. The general case: a cache of a fact will outlive
 * the fact and then answer for it. **Ask, do not remember.** There is
 * deliberately no constructor argument that could hold a list of people, so
 * the wrong version does not compile.
 *
 * ## AND THE OVERLAY IS OPTIONAL, WHICH IS WHAT MAKES ANY OF THIS TESTABLE
 *
 * `screen: null` builds a board with no DOM at all, so a harness can drive each
 * game's real module in Node against a real `Storage` and assert what a person
 * would read afterwards. A board that could only be exercised through a browser
 * is a board nobody would exercise.
 *
 * It is `HTMLElement | null` and NOT an optional field: a game that forgot the
 * argument would silently get the no-DOM board and a screen with no
 * leaderboard on it, which looks completely fine. Saying `null` out loud is one
 * word and it is a decision.
 */

import { boxForThisPage } from './Box.ts';
import { BoardOverlay } from './Overlay.ts';
import { RunBoard } from './Run.ts';
import type { Box } from './Box.ts';
import type { Dimension } from './Dimension.ts';
import type { Seated } from './Run.ts';

/**
 * Everything a game hands the shelf that is not about what it counts.
 *
 * Identical in all four consumers, which is why it is a named type rather than
 * an inline object literal repeated four times: a fifth game copying the
 * signature by eye is how the fields drift apart.
 */
export interface BoardWiring {
  /**
   * The game's root element, or `null` for a board with no screen.
   *
   * NOT where the host is appended — `Overlay.ts`'s `MOUNT` note has the
   * measurement. It says THAT this game wants a screen and WHICH document it
   * is in; the board itself is a top-level fixed layer, because every game's
   * `#app` is a stacking context its own HUD paints over.
   */
  readonly screen: HTMLElement | null;
  /** Override the host. For harnesses; a game leaves it out. */
  readonly box?: Box;
  /** The room's colours by index. Defaults to `ROOM_PALETTE` — see `Room.ts`. */
  readonly palette?: readonly string[];
}

/**
 * A game's board, minus everything about it that is not that game's.
 *
 * Subclassed rather than composed on purpose. Composition would hand each game
 * an object it then has to remember to `dispose`, to `hide`, and to route its
 * `init`/`update`/`dispose` into — which is four more chances to miss one, in
 * exactly the four files this exists to shorten. A base class makes the game's
 * board BE the system the game already registers.
 */
export abstract class BoardSystem {
  /**
   * The board this game keeps. Public because harnesses drive it directly and
   * because `Overlay.show` needs the run's own `results` and `lastRefusal`.
   */
  readonly run: RunBoard;

  readonly #overlay: BoardOverlay | null;
  #unsub: (() => void) | null = null;

  protected constructor(dimension: Dimension, o: BoardWiring) {
    // ONE host, shared by the board and the overlay. Two calls would build two,
    // and the second would be a second `fetch` seam answering separately about
    // the same evening — the shape of a screen that disagrees with itself.
    const box = o.box ?? boxForThisPage();
    this.run = new RunBoard(dimension, box);
    this.#overlay = o.screen === null
      ? null
      : new BoardOverlay({ box, screen: o.screen, palette: o.palette });
  }

  /**
   * Whoever this run belongs to, asked NOW.
   *
   * Abstract because the answer is genuinely different per game and none of the
   * four is a special case of another: one joins two roles, one replays a
   * roster of everyone who took a turn, two ask the table. See the header for
   * why this is not a stored list.
   *
   * DECLARED HERE AND CALLED BY THE SUBCLASS, deliberately. The base cannot
   * call it because the base does not know when a run ends — that is the one
   * thing each of these games genuinely owns. What it can do is give the answer
   * one name and one rule in all four files, so a reader comparing two of them
   * is comparing the triggers rather than four spellings of the same field.
   */
  protected abstract who(): readonly Seated[];

  /**
   * Subscribe to the game's own bus, replacing any previous subscription.
   *
   * Generic in the event so each game keeps its own event type — one game's bus
   * says `kind`, others say `type`, and a shared `any`
   * here would erase the one thing a compiler can check about a listener.
   *
   * Replacing rather than adding is deliberate: `init` being called twice is a
   * game bug, and two live listeners would post the same run twice while the
   * second `dispose` released only one of them.
   */
  protected listen<E>(bus: { on(fn: (e: E) => void): () => void }, fn: (e: E) => void): void {
    this.#unsub?.();
    this.#unsub = bus.on(fn);
  }

  /**
   * Put the board on screen.
   *
   * There is deliberately no `post(value, label)` here: one thing should be
   * said once. Each game exports its own free `record*` function, which IS that
   * game's claim about its own board, is driven directly by a harness in Node,
   * and is the only place the value and the label are shaped. A `post` on this
   * class would be a second expression saying the same thing, in the four files
   * whose entire remaining job is to say it once.
   *
   * `note` is the game's own sentence about why the board reads the way it does
   * — *"nobody reached the finish"*. `Overlay.show` REPLACES it with the run's
   * refusal when there is one, because a refusal is the more important thing to
   * say; that rule lives there and is not restated here.
   *
   * The title is the dimension's, never a string the game passes: a board
   * headed with one word and ranked by another looks completely fine.
   */
  protected async reveal(note: string | null): Promise<void> {
    await this.#overlay?.show(this.run, { title: this.run.board.dimension.title, note });
  }

  /** Take it off the screen. Public: a game may hide it on the next press. */
  hide(): void {
    this.#overlay?.hide();
  }

  /**
   * Release the subscription and the DOM.
   *
   * Not `protected`: every one of these is a game `System` and the game's own
   * teardown calls this by name. A subclass that needs more overrides it and
   * calls `super.dispose()`.
   */
  dispose(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#overlay?.dispose();
  }
}
