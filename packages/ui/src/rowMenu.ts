/**
 * ============================================================================
 *  rowMenu — a column of big keyword rows with a note under each, a cursor that
 *  the arrows and the pointer both drive, and nothing it can read out loud.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A list of choices is built the same way every time, the highlight is in
 *   one place whether a finger or an arrow key moved it, and the class names on
 *   every element are the CALLER'S — so a game's stylesheet cannot go out of
 *   step with the markup a package writes.**
 *
 * ## Why it is here: THREE COPIES INSIDE ONE DIRECTORY
 *
 * The base-building game's UI had this written out three times — the title's
 * four campaign options, the tutorial's pause menu, the trailer's film chooser —
 * each with its own `for` loop, its own `append(span, span)`, its own click
 * wiring, and only ONE of them (the title) with a keyboard cursor at all. That
 * is the argument `@homie-rocks/input/Hold.ts` made when it was published out of
 * three copies inside one file, and its header states the rule this follows:
 *
 * > "Is there a twin" is the question that called a game clean for a long
 * > time while it carried a renderer.
 *
 * A menu does not need to know what a colony is. It needs to know that a row
 * has a keyword, a note, an id and a highlight.
 *
 * ## THE CLASS NAMES ARE REQUIRED PARAMETERS AND THAT IS THE WHOLE DESIGN
 *
 * The failure this shape exists to make impossible has already shipped once:
 * a package wrote markup against class names and CSS custom properties
 * that no stylesheet defined, and every phone pad in eight games rendered
 * black-on-white for weeks with every probe green — because markup that is
 * present and unstyled looks exactly like markup that is styled, to anything
 * that is not a person or a pixel.
 *
 * So `RowSkin` has no defaults. A game states which classes it has authored,
 * a widget probe checks each of them against that game's own stylesheet, and a package that invented `.row` would be caught by a probe
 * rather than by somebody looking at a screen.
 *
 * ## What is NOT here
 *
 * Every word. What the rows say, in what order, which one is offered only when
 * a save exists, what happens when one is chosen, and whether the list is up at
 * all. `activate` is a callback the game supplies; this file never decides.
 */
import { el, setAttr } from './uiUtil.ts';

/** One choice. `id` is the game's own vocabulary and never leaves it. */
export interface Row<Id extends string = string> {
  readonly id: Id;
  /** The keyword. Set large; this is what the eye lands on. */
  readonly label: string;
  /** The note under it. One line, and it is where the honesty goes. */
  readonly note: string;
}

/**
 * Which classes this game has authored for a row. No defaults — see the header.
 *
 * `attr` is the attribute the id is written to, because two games spell that
 * differently and neither is wrong; `onAttr` is the one the highlight writes,
 * and it is written as `'1'` / `'0'` rather than toggled, so a stylesheet can
 * key on the presence of a value instead of the presence of an attribute.
 */
export interface RowSkin {
  readonly row: string;
  readonly key: string;
  readonly note: string;
  readonly attr: string;
  readonly onAttr: string;
}

export interface RowMenu<Id extends string = string> {
  readonly rows: readonly HTMLButtonElement[];
  /** Which row is highlighted, or -1 when the menu was built empty. */
  readonly cursor: number;
  /** Move the cursor by `delta`, wrapping. Repaints. */
  move(delta: number): void;
  /** Put the cursor on a row and repaint. Out-of-range is ignored. */
  focus(index: number): void;
  /** The id under the cursor, or null. */
  current(): Id | null;
  /** Fire `activate` for whatever the cursor is on. Returns false if empty. */
  confirm(): boolean;
}

/**
 * Build the column.
 *
 * THE POINTER MOVES THE CURSOR TOO, and that is not a nicety. A menu where the
 * mouse highlights one row and Enter picks a different one is a menu that
 * starts a campaign nobody chose — so `mouseenter` writes the same cursor the
 * arrows write, and there is exactly one highlighted row at any moment because
 * there is exactly one variable.
 *
 * @param activate called with the row's id, from a click or from `confirm()`.
 *                 The two paths are deliberately the same call: a game that
 *                 wired them separately would have two ways to start and one of
 *                 them would eventually stop matching the other.
 */
export function rowMenu<Id extends string>(
  into: HTMLElement, rows: readonly Row<Id>[], skin: RowSkin, activate: (id: Id) => void,
): RowMenu<Id> {
  const nodes: HTMLButtonElement[] = [];
  let cursor = rows.length > 0 ? 0 : -1;

  function paint(): void {
    for (let i = 0; i < nodes.length; i++) setAttr(nodes[i]!, skin.onAttr, i === cursor ? '1' : '0');
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const node = document.createElement('button');
    node.className = skin.row;
    node.setAttribute(skin.attr, r.id);
    node.append(el('span', skin.key, r.label), el('span', skin.note, r.note));
    const index = i;
    node.addEventListener('click', () => { cursor = index; paint(); activate(r.id); });
    node.addEventListener('mouseenter', () => { cursor = index; paint(); });
    // Appended into the caller's own container rather than into one this file
    // invents. A wrapper element is a new node in the game's cascade — every
    // `#title .tmenu { flex-direction: column }` in every stylesheet would be
    // laying out ONE child instead of four, and the menu would collapse into a
    // single row with nothing red anywhere.
    into.append(node);
    nodes.push(node);
  }
  paint();

  return {
    rows: nodes,
    get cursor() { return cursor; },
    move(delta) {
      if (nodes.length === 0) return;
      cursor = ((cursor + delta) % nodes.length + nodes.length) % nodes.length;
      paint();
    },
    focus(index) {
      if (index < 0 || index >= nodes.length) return;
      cursor = index; paint();
    },
    current() { return cursor >= 0 && cursor < rows.length ? rows[cursor]!.id : null; },
    confirm() {
      const id = this.current();
      if (id === null) return false;
      activate(id);
      return true;
    },
  };
}
