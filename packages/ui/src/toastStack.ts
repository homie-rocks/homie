/**
 * ============================================================================
 *  ToastStack — an alert channel that COALESCES ON THE TEMPLATE, not on the
 *  literal line.
 * ============================================================================
 *
 *  ── THE CAPABILITY, WHICH IS ONE IDEA ──────────────────────────────────────
 *
 *  Deduplicating a ticker on the exact string only catches a literal repeat,
 *  and in a game the actual duplicate is never literal. Two ships missing the
 *  same window produce
 *
 *      "SN-24 MISSED ITS WINDOW — 36 T OF LOX SHORT. ITS CREW STAY."
 *      "SN-25 MISSED ITS WINDOW — 36 T OF LOX SHORT. ITS CREW STAY."
 *
 *  and stacked as two cards those read as a debug log printed to the screen.
 *  Matched on the TEMPLATE — the line with its entity ids and its figures
 *  blanked — they are ONE event that happened twice, shown once with a ×2 on
 *  it, and the surviving line names both ships so the merge never costs the
 *  player the information it merged. That last property is what makes this
 *  different from every "collapse duplicates" a ticker has ever had.
 *
 *  ── WHY THIS IS PLATFORM, AND WHAT IS NOT IN IT ────────────────────────────
 *
 *  Coalescing toasts had always been meant for `@homie-rocks/ui`, and no
 *  package had ever held a line of it: it lived in one game, the base-building
 *  game's HUD, at 44 substantive lines.
 *
 *  This file honours an explicit warning: the kart racer's `leadToastT` and
 *  the space racer's `edgeToast` are NOT twins of this. They are one-line
 *  "show this string for 1.5 s" timers with no stack, no template, no count
 *  and no ids, and folding them in here would be a duplication signal answered
 *  by making three unlike things one, which is how a shared `solve()` gets
 *  written. They are untouched.
 *
 *  **This class renders nothing.** It never creates an element, never sets a
 *  style and never reads the document. The caller's `make` builds the card and
 *  the caller's code writes the count and the body, because a toast's look — a
 *  glyph ramp, a rule weight, a timestamp gutter — is a game's art direction
 *  and the moment a package owned it every game would get that one game's.
 *  What is general is the BOOKKEEPING: what merges with what, what the merged line
 *  says, how many fit, and when they die. All of that is here and none of it
 *  is anywhere else.
 *
 *  ── WHY `age()` HANDS BACK THE DEAD RATHER THAN REMOVING THEM ──────────────
 *
 *  A card usually leaves with an exit transition, so the element outlives the
 *  entry by a few hundred milliseconds and only the caller knows for how long.
 *  A package that removed the node would either cut the animation or have to
 *  own a timer, and owning a timer means owning what happens when the game is
 *  disposed mid-flight. Returning the list is the seam with no lifetime in it.
 */

/**
 * Entity ids a ticker talks about: `SN-24`, `PAD-3`, `HAB-11`.
 *
 * Exported as the default rather than hidden, because a game whose ids look
 * different has to pass its own and cannot know to unless it can see this one.
 * Note the `g` flag: it is used with `String.replace` and `String.match`, and
 * a caller supplying a replacement MUST set it too or the template will blank
 * only the first id and two lines that differ in their second id will fail to
 * merge — silently, and only for the lines that have two.
 */
export const DEFAULT_ID_RE = /\b[A-Z]{2,4}-\d+\b/g;

/** One live card's bookkeeping. `card` is the caller's handle and is never read. */
export interface ToastEntry<T> {
  /** Whatever `make` returned. The stack stores it and hands it back. */
  card: T;
  /** The line as printed, before any id re-join. */
  text: string;
  /** `text` with ids and figures blanked — the coalescing key. */
  tmpl: string;
  level: number;
  /** How many times this template has arrived, including the first. */
  count: number;
  /** Entity ids seen across this card's lines, in order, deduplicated. */
  ids: string[];
  /** Seconds since the last arrival that touched this card. */
  age: number;
}

export interface ToastStackOptions {
  /**
   * How many cards fit. A number, or a function called on every push — a stack
   * hanging off a top-anchored column has a cap that depends on the viewport,
   * and MEASURED on a 720 px viewport during a crisis, five cards put the
   * oldest of them 6 px below the bottom edge of the screen. A ticker that
   * scrolls off the frame is not a ticker.
   */
  cap: number | (() => number);
  /** Seconds a card survives with no repeat. */
  ttl: number;
  /** Override `DEFAULT_ID_RE`. Must carry the `g` flag — see that constant. */
  idRe?: RegExp;
}

/** What one `push` did. */
export interface ToastPush<T> {
  entry: ToastEntry<T>;
  /**
   * True when the line merged into a card that was already on screen. The
   * caller writes the new count and, if `joined` is set, the new body.
   */
  merged: boolean;
  /**
   * The surviving line with the FIRST id replaced by every id this card now
   * covers ("SN-24, SN-25 MISSED ITS WINDOW …"), or null when there is still
   * only one id and the line is unchanged. Null is not an error state; it is
   * the common case and it means "do not touch the body".
   */
  joined: string | null;
  /**
   * Cards pushed off the bottom of the cap by this arrival. Already removed
   * from the stack; the caller removes the elements. Usually empty.
   */
  retired: ToastEntry<T>[];
}

/**
 * A stack of coalescing alert cards.
 *
 * `T` is whatever the caller wants to keep beside each entry — in practice a
 * small record of the elements it will write to. The class is generic rather
 * than typed to `HTMLElement` so a harness can drive it with plain objects and
 * measure the merge logic without a DOM, which is exactly what its probe does.
 */
export class ToastStack<T> {
  /** Oldest first — the same order the cards are appended to their container. */
  readonly entries: ToastEntry<T>[] = [];
  readonly ttl: number;
  readonly #cap: number | (() => number);
  readonly #idRe: RegExp;

  constructor(opts: ToastStackOptions) {
    this.#cap = opts.cap;
    this.ttl = opts.ttl;
    this.#idRe = opts.idRe || DEFAULT_ID_RE;
  }

  /** The line with ids and figures blanked. Exposed so a probe can assert on it. */
  template(s: string): string {
    return s.replace(this.#idRe, '§').replace(/\d+(\.\d+)?/g, '#');
  }

  /**
   * Offer a line to the stack.
   *
   * `make` is called ONLY when nothing matched, so a caller does not build a
   * card it is about to throw away — which matters because building one costs a
   * handful of elements and this runs off a simulation's event queue.
   */
  push(text: string, level: number, make: (text: string, level: number) => T): ToastPush<T> {
    const tmpl = this.template(text);
    const ids = text.match(this.#idRe) || [];

    // Any card still on screen is a candidate, not only the newest, because the
    // two arrivals may be separated by an unrelated advisory. Searched from the
    // bottom so the most recent match wins when a template repeats twice.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const c = this.entries[i]!;
      if (c.tmpl !== tmpl || c.level !== level) continue;
      c.count++;
      c.age = 0;
      for (let k = 0; k < ids.length; k++) {
        if (c.ids.indexOf(ids[k]!) < 0) c.ids.push(ids[k]!);
      }
      let joined: string | null = null;
      if (c.ids.length > 1) {
        const first = c.ids[0]!;
        const all = c.ids.join(', ');
        joined = c.text.replace(this.#idRe, (m) => (m === first ? all : m));
      }
      // A repeat is news again: the merged card moves to the bottom of the
      // stack rather than staying where the eye has already been. The caller
      // re-appends the element; this keeps the model in the same order.
      this.entries.splice(i, 1);
      this.entries.push(c);
      return { entry: c, merged: true, joined, retired: [] };
    }

    const entry: ToastEntry<T> = {
      card: make(text, level), text, tmpl, level, count: 1, ids: ids.slice(), age: 0,
    };
    this.entries.push(entry);

    const cap = Math.max(1, typeof this.#cap === 'function' ? this.#cap() : this.#cap);
    const retired: ToastEntry<T>[] = [];
    while (this.entries.length > cap) retired.push(this.entries.shift()!);
    return { entry, merged: false, joined: null, retired };
  }

  /**
   * Advance every card by `dt` seconds and hand back the ones that have expired.
   * They are already out of `entries`; the caller disposes of the elements.
   */
  age(dt: number): ToastEntry<T>[] {
    const dead: ToastEntry<T>[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      e.age += dt;
      if (e.age > this.ttl) {
        this.entries.splice(i, 1);
        dead.push(e);
      }
    }
    return dead;
  }

  /** Drop everything, returning the cards so the caller can remove them. */
  clear(): ToastEntry<T>[] {
    return this.entries.splice(0, this.entries.length);
  }
}
