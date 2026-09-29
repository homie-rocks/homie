/**
 * ============================================================================
 *  cardDeck — a short sequence of timed cards over live play, and the four
 *  ways out of it.
 * ============================================================================
 *
 *  An opening, a tip run, an end-of-round debrief: a handful of cards, each on
 *  screen for its own number of REAL seconds, each fading before it goes, and
 *  dismissable by a key, by a click on the card, by a click on a control that
 *  says so, or by simply waiting. That machine is the same every time and the
 *  words are never the same.
 *
 *  ── REAL SECONDS, NOT SIM SECONDS ──────────────────────────────────────────
 *
 *  A card is a presentation. Driving it off a simulation clock means a paused
 *  game freezes the sentence that explains the pause, and a game running at
 *  four times speed reads its own opening at four times speed. The caller
 *  passes the real delta; this never asks for a clock of its own.
 *
 *  ── IT IS NOT A CUTSCENE, AND THAT IS ENFORCED BY WHAT IS ABSENT ───────────
 *
 *  There is no input capture, no pause, no modal and no gate. The deck owns one
 *  element and a countdown. Anything that wants blocking has to write the block
 *  itself, in the open, where a reader can see it.
 *
 *  ── THE FADE IS A THIRD STATE, NOT A CLASS ─────────────────────────────────
 *
 *  `data-on` goes 0 (gone) → 1 (up) → 2 (leaving), so a stylesheet expresses
 *  the whole life of a card in one attribute selector and a harness can read
 *  which of the three it is in without knowing the class vocabulary. A boolean
 *  plus a class cannot express "leaving" without the two disagreeing for a
 *  frame somewhere.
 *
 *  ── NO WORDS ARE HERE ──────────────────────────────────────────────────────
 *
 *  `paint(index)` is the game's. It is called on every advance with the index
 *  that is now up, and it writes whatever that card says into whatever nodes
 *  it made. The deck knows only how long each one holds.
 */
import { setAttr } from './uiUtil.ts';

/** Every number the deck uses. None of them has a default. */
export interface CardDeckSpec {
  /** Seconds each card holds, in order. Its length is the deck's length. */
  holds: readonly number[];
  /** Seconds before a card's hold ends at which it moves to the leaving state. */
  fade: number;
  /** Write card `i` into the DOM. Called once per advance. */
  paint(i: number): void;
  /** The element whose `data-on` carries 0 / 1 / 2. */
  box: HTMLElement;
  /** Called once when the last card has been dismissed or has run out. */
  onFinish?(): void;
}

export interface CardDeck {
  readonly active: boolean;
  /** Index of the card on screen, or -1. */
  readonly card: number;
  /** Start at the first card. Safe to call again; it restarts. */
  begin(): void;
  /** Move to the next card, finishing past the end. */
  advance(): void;
  /** End the whole deck now. A no-op when it is not running. */
  skip(): void;
  /** Real seconds. */
  update(dt: number): void;
}

export function cardDeck(spec: CardDeckSpec): CardDeck {
  let active = false;
  let idx = -1;
  let held = 0;
  /** True while the current card is on its way out. */
  let fading = false;

  function finish(): void {
    active = false;
    idx = -1;
    setAttr(spec.box, 'data-on', '0');
    if (spec.onFinish) spec.onFinish();
  }

  function advance(): void {
    if (!active) return;
    idx++;
    held = 0;
    fading = false;
    if (idx >= spec.holds.length) { finish(); return; }
    spec.paint(idx);
    setAttr(spec.box, 'data-on', '1');
    setAttr(spec.box, 'data-card', String(idx));
  }

  return {
    get active() { return active; },
    get card() { return idx; },
    begin(): void {
      active = true;
      idx = -1;
      held = 0;
      advance();
    },
    advance,
    skip(): void { if (active) finish(); },
    update(dt: number): void {
      if (!active) return;
      held += dt;
      const hold = spec.holds[idx];
      if (hold === undefined) return;
      if (!fading && held >= hold - spec.fade) {
        fading = true;
        setAttr(spec.box, 'data-on', '2');
      }
      if (held >= hold) advance();
    },
  };
}
