/**
 * ============================================================================
 *  RebindPanel — the screen where a player changes which key does what.
 * ============================================================================
 *
 *  A hint chip in the corner, a modal card of rows, two key slots per row, a
 *  reset, a close, and a note that states the game's own conventions in the one
 *  place a confused player will look.
 *
 *  ## WHY THIS IS IN A PACKAGE AND NOT IN THE GAME THAT WROTE IT
 *
 *  It came out of a base-building game's input module, where it was ~160 lines
 *  of DOM and CSS about a settings dialog sitting inside a file about a
 *  colony's camera. Every decision in it — two slots and not three, the capture
 *  state living on the panel, `Escape` cancelling rather than binding, the
 *  46-px-ish touch targets, hiding under `body.hide-ui` — is a decision about a
 *  rebinding screen. None is a decision about that game.
 *
 *  ## WHAT THE GAME STILL SAYS, AND EVERY ONE OF THEM IS REQUIRED
 *
 *  The class PREFIX, the group ORDER, the title, the subtitle, the hint chip's
 *  words and the footer note. There are no defaults for any of them.
 *
 *  The prefix is the load-bearing one and it is worth naming why it is not
 *  hard-coded: the original game's onboarding script drives this dialog by
 *  querying `.<prefix>-row` and `.<prefix>-key`, and its stylesheet hides
 *  `.<prefix>-hint` in three states the package cannot know about (trailer,
 *  touch, title). A package that renamed those classes would leave a green
 *  typecheck, a booting game, and a harness that silently found zero rows — a
 *  green harness that prints a false sentence. So the prefix is the game's, it
 *  is required, and the game passes the same string its own stylesheet and its
 *  own harness already use.
 *
 *  ## THE SEAM WITH THE KEYBOARD, WHICH IS ONE METHOD AND NOT A FLAG
 *
 *  While a slot is capturing, the next code belongs to the PANEL, not the game
 *  — otherwise choosing `Space` for a verb also pauses the game on the way
 *  past. The caller's keydown handler asks `capture(code)` FIRST and does
 *  nothing else when it returns true. One question, one answer, no shared
 *  mutable flag for the two halves to disagree about.
 *
 *  ## NO BACKTICKS BELOW THIS LINE INSIDE THE CSS TEMPLATE
 *
 *  A backtick inside a template literal ends the string and the rest of the
 *  file parses as TypeScript, failing a hundred lines later; under Vite the
 *  module 500s and the game does not boot, which is indistinguishable from a
 *  slow load. It has cost a whole runtime module once already — a file that
 *  had no exports, which `node --check` does not even agree is broken.
 * ============================================================================
 */

import { Bindings, labelForCode } from './Rebind.ts';

/** Everything the panel cannot know for itself. No optionals, no defaults. */
export interface RebindPanelSpec<A extends string = string, G extends string = string> {
  /** The live key map. The panel reads it and writes through `set`. */
  readonly bindings: Bindings<A, G>;
  /**
   * The class-name prefix, e.g. `game-ctl`. The game's stylesheet and the
   * game's harness already name these classes; see the header.
   */
  readonly prefix: string;
  /** Headings, in the order they are shown. An action in no listed group is not rendered. */
  readonly groups: readonly G[];
  /** The card's heading. */
  readonly title: string;
  /** The line under it. Says how to use the screen. */
  readonly subtitle: string;
  /** What the corner chip says. */
  readonly hint: string;
  /** The footer paragraph: the game's own conventions, in the game's own words. */
  readonly note: string;
  /**
   * How many key slots each row offers.
   *
   * The game this came from ships 2 and its reason travels with the number:
   * more than two is a settings screen nobody uses; fewer means no room for the
   * trackpad duplicate that makes the game playable on a laptop. A game with a
   * different answer says so here rather than inheriting that one.
   */
  readonly slots: number;
  /** The player committed a new binding. Persist it and tell whoever cares. */
  onRebind(action: A, codes: readonly string[]): void;
  /** The player pressed reset. Clear the store; the panel has already restored the defaults. */
  onReset(): void;
}

/**
 * The stylesheet, with every class name carrying the caller's prefix.
 *
 * NO BACKTICKS INSIDE THE TEMPLATE BELOW. See the header: one of them ends the
 * string, the rest of the file parses as TypeScript, and the module simply
 * stops existing.
 */
function styleFor(p: string): string {
  return `
  .${p}-hint {
    position: fixed; right: 14px; bottom: 12px; z-index: 60;
    font: 500 11px/1 "SF Pro Display", system-ui, sans-serif; letter-spacing: .14em;
    text-transform: uppercase; color: #56718a; background: rgba(5,7,12,.55);
    border: 1px solid rgba(79,216,255,.18); border-radius: 6px; padding: 6px 9px;
    cursor: pointer; user-select: none; backdrop-filter: blur(6px);
  }
  .${p}-hint:hover { color: #4fd8ff; border-color: rgba(79,216,255,.45); }
  .${p} {
    position: fixed; inset: 0; z-index: 70; display: none; place-content: center;
    background: rgba(3,5,9,.72); backdrop-filter: blur(10px);
    font: 400 13px/1.5 "SF Pro Display", system-ui, sans-serif; color: #cfe0ef;
  }
  .${p}.open { display: grid; }
  .${p}-card {
    width: min(760px, 92vw); max-height: 84vh; overflow: auto;
    background: rgba(8,12,18,.94); border: 1px solid rgba(79,216,255,.20);
    border-radius: 14px; padding: 22px 26px 18px;
    box-shadow: 0 24px 70px rgba(0,0,0,.65);
  }
  .${p} h2 {
    margin: 0 0 4px; font-size: 15px; font-weight: 300; letter-spacing: .34em;
    text-indent: .34em; text-transform: uppercase; color: #e6edf5;
  }
  .${p} .sub { color: #56718a; font-size: 11px; letter-spacing: .18em;
    text-transform: uppercase; margin-bottom: 16px; }
  .${p} h3 {
    margin: 16px 0 6px; font-size: 10px; font-weight: 600; letter-spacing: .26em;
    text-transform: uppercase; color: #4fd8ff; opacity: .8;
  }
  .${p}-row {
    display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.045);
  }
  .${p}-key {
    min-width: 92px; text-align: center; padding: 4px 8px; border-radius: 6px;
    background: rgba(79,216,255,.07); border: 1px solid rgba(79,216,255,.22);
    color: #cfe0ef; font-size: 12px; cursor: pointer;
  }
  .${p}-key:hover { background: rgba(79,216,255,.16); }
  .${p}-key.capturing { background: rgba(255,180,89,.18); border-color: #ffb459; color: #ffb459; }
  .${p}-foot { display: flex; gap: 10px; justify-content: space-between;
    align-items: center; margin-top: 18px; color: #56718a; font-size: 11px; }
  .${p}-btn {
    padding: 6px 12px; border-radius: 7px; cursor: pointer; font-size: 12px;
    background: rgba(79,216,255,.10); border: 1px solid rgba(79,216,255,.28); color: #cfe0ef;
  }
  .${p}-btn:hover { background: rgba(79,216,255,.2); }
  /* The capture harness hides the interface by putting .hide-ui on <body>
     (a capture tool). Addressed by exclusion there, so anything that draws over
     the canvas has to honour it or it lands in every "no HUD" hero shot. */
  body.hide-ui .${p}, body.hide-ui .${p}-hint { display: none !important; }
  `;
}

export class RebindPanel<A extends string = string, G extends string = string> {
  readonly #spec: RebindPanelSpec<A, G>;
  #style: HTMLStyleElement | null = null;
  #hint: HTMLElement | null = null;
  #root: HTMLElement | null = null;
  /** Which action is waiting for a key, or null. See the header's seam note. */
  #capturingFor: A | null = null;
  #captureSlot = 0;

  constructor(spec: RebindPanelSpec<A, G>) {
    if (spec.prefix === '') throw new Error('RebindPanel: a class prefix is required — the game owns these class names');
    if (!Number.isInteger(spec.slots) || spec.slots < 1) {
      throw new Error(`RebindPanel: slots is ${spec.slots}; a row with no key slots is a row that cannot be rebound`);
    }
    this.#spec = spec;
    this.#mount();
  }

  /** Is the modal on screen? */
  get open(): boolean {
    return this.#root !== null && this.#root.classList.contains('open');
  }

  /** Is a slot waiting for a key right now? */
  get capturing(): boolean {
    return this.#capturingFor !== null;
  }

  /**
   * Offer a code to the panel FIRST, before the game sees it.
   *
   * Returns true when the panel took it, in which case the caller must do
   * nothing else with that code — including `preventDefault`, which the caller
   * still owns because only it knows whether it is handling a key or a mouse.
   *
   * `Escape` CANCELS rather than binding. It is the one code a player cannot
   * assign from this screen and that is deliberate: it is how you get out of a
   * capture you opened by mistake, and a game that wants Escape on a verb can
   * still declare it as a default.
   */
  capture(code: string): boolean {
    const action = this.#capturingFor;
    if (action === null) return false;
    this.#capturingFor = null;
    if (code === 'Escape') { this.render(); return true; }
    const codes = this.#spec.bindings.set(action, this.#captureSlot, code);
    this.#spec.onRebind(action, codes);
    this.render();
    return true;
  }

  /** Open, close, or toggle. */
  show(open?: boolean): void {
    if (this.#root === null) return;
    const want = open ?? !this.#root.classList.contains('open');
    this.#root.classList.toggle('open', want);
    if (!want) this.#capturingFor = null;
    this.render();
  }

  #mount(): void {
    const s = this.#spec;
    this.#style = document.createElement('style');
    this.#style.textContent = styleFor(s.prefix);
    document.head.appendChild(this.#style);

    this.#hint = document.createElement('div');
    this.#hint.className = s.prefix + '-hint';
    this.#hint.textContent = s.hint;
    this.#hint.addEventListener('click', () => this.show(true));
    document.body.appendChild(this.#hint);

    const root = document.createElement('div');
    root.className = s.prefix;
    root.addEventListener('pointerdown', (e) => {
      // Only the backdrop closes. A pointerdown that started on the card is a
      // player reaching for a key slot, and closing under it would make every
      // mis-aimed tap dismiss the screen they are trying to read.
      if (e.target === root) this.show(false);
    });
    document.body.appendChild(root);
    this.#root = root;
    this.render();
  }

  /**
   * Draw the whole card.
   *
   * A full rebuild rather than a diff, and it is safe here for a reason worth
   * writing down: this screen is opened by a person, redrawn on a click, and
   * has no live values in it. The usual case for diffing — that a rebuild
   * clears a half-made input out from under a thumb — is about a screen that
   * redraws while somebody is using it. This one has nothing to clear.
   */
  render(): void {
    const root = this.#root;
    if (root === null) return;
    const s = this.#spec;
    const p = s.prefix;

    const card = document.createElement('div');
    card.className = p + '-card';

    const h = document.createElement('h2');
    h.textContent = s.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = s.subtitle;
    card.append(h, sub);

    for (const g of s.groups) {
      const head = document.createElement('h3');
      head.textContent = g;
      card.appendChild(head);
      for (const def of s.bindings.defs) {
        if (def.group !== g) continue;
        const row = document.createElement('div');
        row.className = p + '-row';
        const name = document.createElement('div');
        name.textContent = def.label + (def.held ? '  (hold)' : '');
        row.appendChild(name);

        const codes = s.bindings.codesFor(def.action);
        for (let i = 0; i < s.slots; i++) {
          const btn = document.createElement('div');
          btn.className = p + '-key';
          const capturing = this.#capturingFor === def.action && this.#captureSlot === i;
          if (capturing) btn.classList.add('capturing');
          btn.textContent = capturing ? 'press...' : (codes[i] !== undefined ? labelForCode(codes[i]!) : '—');
          btn.addEventListener('click', () => {
            this.#capturingFor = def.action;
            this.#captureSlot = i;
            this.render();
          });
          row.appendChild(btn);
        }
        card.appendChild(row);
      }
    }

    const foot = document.createElement('div');
    foot.className = p + '-foot';
    const note = document.createElement('div');
    note.textContent = s.note;
    const reset = document.createElement('div');
    reset.className = p + '-btn';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      s.bindings.resetToDefaults();
      s.onReset();
      this.render();
    });
    const close = document.createElement('div');
    close.className = p + '-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.show(false));
    foot.append(note, reset, close);
    card.appendChild(foot);

    root.replaceChildren(card);
  }

  /** Take the whole screen back off the page. */
  dispose(): void {
    this.#root?.remove();
    this.#hint?.remove();
    this.#style?.remove();
    this.#root = null;
    this.#hint = null;
    this.#style = null;
    this.#capturingFor = null;
  }
}
