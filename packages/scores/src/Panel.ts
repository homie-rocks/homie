/**
 * THE BOARD, DRAWN — once, for the TV and for a phone.
 *
 * One renderer rather than two, because the two are the same list read at
 * different distances, and two renderers grow a TV that says one thing and a
 * phone that says another. What differs is a font size and a column, and those
 * are CSS.
 *
 * ## Every name on this screen is guest-typed
 *
 * A name goes into storage as a person typed it, comes back out at the end of a
 * later evening, and is written into a document. That is the exact path an
 * injection takes, and the rule is structural rather than careful: everything a
 * guest types is DATA TO DISPLAY. So `text()` below is applied to every single
 * interpolation in this file — names, labels, formatted values, titles — and
 * there is no path through which a caller can pass markup.
 *
 * ## Two traps this file is written around, both already paid for
 *
 * **A backtick inside a template literal ends the document.** The stylesheet is
 * a template literal, and a CSS comment that quoted a property name in
 * backticks has already broken a phone-card module the same way — the module
 * simply stopped parsing, no phone in any game could render a card, and
 * node --check did not agree it was broken. There are no backticks below this
 * line inside any literal, and any comment about the CSS lives out here in the
 * prose.
 *
 * **A tolerant lookup called twice is a lie that renders perfectly.**
 * `colourOf` maps a palette index to a hex string and falls back rather than
 * rendering `undefined` in front of the room, which is right. Calling it on its
 * own result gives `Number('#8fe36a')` -> NaN -> every row the same colour, and
 * it looks completely fine. It is called exactly once per row, at the boundary,
 * and `RoomRow.colour` is an INDEX everywhere above this file for that reason.
 */

import type { AwayRow, RoomRow } from './Room.ts';

/**
 * HTML-escape. Applied to every interpolation without exception.
 *
 * Five entities, not a sanitiser: there is no attempt to decide what is "safe"
 * markup, because a half-escaped string is worse than an honestly untrusted one
 * and that judgement is what a sanitiser gets wrong.
 */
export function text(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A palette index to a hex string, tolerantly.
 *
 * Tolerant on purpose: a guest's row rendering with no colour in front of the
 * room is worse than a row wearing entry 0. Call it ONCE, on an index. See this
 * file's header for what calling it on its own answer costs.
 */
export function colourOf(palette: readonly string[], index: number): string {
  if (palette.length === 0) return '#ffffff';
  const i = Number.isInteger(index) && index >= 0 ? index % palette.length : 0;
  return palette[i] ?? palette[0] ?? '#ffffff';
}

export interface PanelSpec {
  /** A failed read is not an empty board. */
  readonly unavailable?: boolean;
  /** What this board is OF. The dimension's title, or the game's own words. */
  readonly title: string;
  readonly here: readonly RoomRow[];
  readonly away: readonly AwayRow[];
  /**
   * The room's colours, by index. REQUIRED and with no default: a board that
   * inherited a palette would silently wear another game's art direction, and it
   * would look completely fine.
   */
  readonly palette: readonly string[];
  /**
   * One line under the board saying why it is the way it is — *"nobody here has
   * a time yet"*, *"scores are not being saved tonight"*. `null` for none.
   * NEVER an empty string, which renders as a blank line on a TV.
   */
  readonly note: string | null;
}

/**
 * The board as one HTML fragment.
 *
 * Returned as a string rather than as DOM so the same call serves the TV
 * (innerHTML on an element the game owns) and a phone page, which takes a
 * whole document. Nothing here creates an element, so it runs in a Node
 * harness unchanged — which is what lets a probe assert what a guest would read
 * rather than that a function did not throw.
 */
export function boardPanel(spec: PanelSpec): string {
  const rows: string[] = [];
  for (const r of spec.here) {
    rows.push(row({
      place: r.place,
      sharedWith: r.sharedWith,
      name: r.name,
      shown: r.shown,
      colour: colourOf(spec.palette, r.colour),
      inRoom: true,
    }));
  }
  for (const r of spec.away) {
    rows.push(row({
      place: r.place,
      sharedWith: r.sharedWith,
      name: r.name,
      shown: r.shown,
      colour: null,
      inRoom: false,
    }));
  }
  if (rows.length === 0 && !spec.unavailable) {
    rows.push('<li class="hs-empty">No scores yet</li>');
  }
  const note = spec.note === null ? '' : `<p class="hs-note">${text(spec.note)}</p>`;
  return [
    '<section class="hs-board" data-board="1">',
    `<h2 class="hs-title">${text(spec.title)}</h2>`,
    `<ol class="hs-rows">${rows.join('')}</ol>`,
    note,
    '</section>',
  ].join('');
}

/**
 * One row.
 *
 * A shared place is SAID, not implied by two rows carrying the same number: two
 * 1sts on a screen reads as a rendering bug to somebody who was not watching,
 * and the whole point of sharing the place is that the room can tell what
 * happened. `=` is the mark, and the count is in the title attribute for
 * anybody close enough to the screen to care.
 */
function row(r: {
  place: number;
  sharedWith: number;
  name: string;
  shown: string;
  colour: string | null;
  inRoom: boolean;
}): string {
  const cls = r.inRoom ? 'hs-row hs-here' : 'hs-row hs-away';
  const dot = r.colour === null
    ? ''
    : `<span class="hs-dot" style="background:${text(r.colour)}"></span>`;
  const tie = r.sharedWith > 0
    ? `<span class="hs-tie" title="${text(`shared with ${r.sharedWith} other`)}">=</span>`
    : '';
  return [
    `<li class="${cls}">`,
    `<span class="hs-place">${text(r.place)}</span>`,
    tie,
    dot,
    `<span class="hs-name">${text(r.name)}</span>`,
    `<span class="hs-value">${text(r.shown)}</span>`,
    '</li>',
  ].join('');
}

/**
 * The stylesheet, as a string a caller injects where it wants it.
 *
 * Every colour is a CSS custom property with NO fallback, deliberately: a token
 * the game forgets to define renders visibly broken instead of quietly
 * inheriting the other game's livery. That is `@homie-rocks/input`'s
 * ControlsSheet rule and it holds for the same reason.
 *
 * The prose about it is up here because a backtick inside the literal below
 * would end it. See the header.
 */
export const boardPanelCSS = `
.hs-board { font: 500 1rem/1.35 var(--hs-font); color: var(--hs-ink); }
.hs-title { margin: 0 0 .5em; font-size: 1.1em; letter-spacing: .08em; text-transform: uppercase; color: var(--hs-title); }
.hs-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: .25em; }
.hs-row { display: grid; grid-template-columns: 2.2em auto 1fr auto; align-items: center; gap: .5em;
  padding: .3em .6em; border-radius: .35em; background: var(--hs-row); }
.hs-here { background: var(--hs-row-here); color: var(--hs-ink-here); }
.hs-away { opacity: .72; }
.hs-place { font-variant-numeric: tabular-nums; text-align: right; color: var(--hs-place); }
.hs-tie { font-weight: 700; color: var(--hs-place); }
.hs-dot { width: .7em; height: .7em; border-radius: 50%; display: inline-block; }
.hs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs-value { font-variant-numeric: tabular-nums; font-weight: 700; }
.hs-empty, .hs-note { margin: .4em 0 0; color: var(--hs-note); font-size: .9em; }
`;
