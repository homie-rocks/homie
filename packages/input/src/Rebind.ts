/**
 * ============================================================================
 *  Rebind — a keyboard whose keys the player is allowed to change.
 * ============================================================================
 *
 *  ## WHAT THIS IS, AND WHY IT IS NOT `Keys.ts`
 *
 *  `Keys.ts` next door is a keyboard: codes in, held-and-latched out, and the
 *  caller decides what a code MEANS by reading it by name. That is the right
 *  shape for a racer, where `KeyW` is throttle and always will be.
 *
 *  This is the other shape: a game with two dozen verbs, a settings screen, and
 *  a player who has a laptop with no numpad or a keyboard that is not QWERTY.
 *  The unit here is an ACTION, the codes are DATA the player owns, and the
 *  index from code back to action has to be rebuilt every time they change one.
 *
 *  ## WHERE IT CAME FROM AND WHY IT MOVED
 *
 *  A base-building game's input module had all of it: a bindings map, a
 *  reverse index, a resolver that merges stored overrides over declared
 *  defaults, a `KeyboardEvent.code` → human-label translator, and a whole
 *  rebinding dialog with its own stylesheet. Nothing in any of that is a fact
 *  about a colony game. The question is *"does this belong in a game"*, never
 *  *"is there a twin"* — and that game proved the twin question is the wrong
 *  one, having carried a renderer for twelve iterations with exactly one copy
 *  of it.
 *
 *  ## THE ONE THING THAT STAYS IN THE GAME, AND IT IS REQUIRED
 *
 *  **The action table.** Which verbs exist, what each is called in front of a
 *  player, which group it sits in, and which keys it starts on. That is the
 *  game's answer and there is no default for it here — a game that inherited
 *  another game's key map would ship a controls panel that lies, and it would
 *  look completely fine doing it. `Bindings` takes the table and refuses an
 *  empty one.
 *
 *  ## THE FAILURE THIS FILE EXISTS TO PREVENT, STATED ONCE
 *
 *  `#byCode` is a CACHE OF `#codes`, and a cache of a fact will outlive the
 *  fact and then answer for it. Every write
 *  path here rebuilds it in the same statement that mutates the map, and the
 *  `stale-index` fault skips exactly that rebuild so a probe can watch the
 *  quiet version happen: the panel shows the new key, `codesFor` agrees, and
 *  the game keeps answering to the old one.
 * ============================================================================
 */

import { inputFaultActive } from './faults.ts';

/** One verb, as the game declares it. Every field is required except `held`. */
export interface RebindDef<A extends string = string, G extends string = string> {
  /** The game's own word for the verb. Never shown to a player. */
  readonly action: A;
  /** What the player reads in the controls panel. */
  readonly label: string;
  /** Which heading it sits under. The game orders the headings. */
  readonly group: G;
  /**
   * The keys it starts on, in slot order. `Mouse0` / `Mouse1` / `Mouse2` are
   * accepted alongside `KeyboardEvent.code` values, because a game that binds
   * a mouse button in the same table gets one settings screen instead of two.
   */
  readonly codes: readonly string[];
  /** Printed as "(hold)" beside the label. Presentation only; nothing here reads it. */
  readonly held?: boolean;
}

/**
 * `KeyboardEvent.code` is a PHYSICAL POSITION, not a character, so it has to be
 * translated before a person reads it.
 *
 * The cases below are the ones whose code is not simply the label with a
 * prefix. Everything else falls through as itself, which is honest: an unlisted
 * code is a key this table has not been taught, and printing `F13` is better
 * than printing nothing.
 */
export function labelForCode(code: string): string {
  if (inputFaultActive('raw-code-labels')) return code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  switch (code) {
    case 'Mouse0': return 'Left mouse';
    case 'Mouse1': return 'Middle mouse';
    case 'Mouse2': return 'Right mouse';
    case 'Space': return 'Space';
    case 'Escape': return 'Esc';
    case 'Equal': return '+';
    case 'Minus': return '-';
    case 'Slash': return '?';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    default: return code;
  }
}

/**
 * The live key map: declared defaults, the player's overrides on top, an index
 * back the other way, and what is physically down right now.
 *
 * NO DOM AND NO CLOCK. A Node harness can drive the whole thing, which is how
 * a parity probe replays a rebind against both the original game's code and
 * this one with no browser at all.
 */
export class Bindings<A extends string = string, G extends string = string> {
  /** The table the game wrote, in declaration order. Never mutated. */
  readonly defs: readonly RebindDef<A, G>[];

  /** Action → the codes it answers to, right now. */
  readonly #codes = new Map<A, string[]>();

  /** Code → the actions it fires. A CACHE of `#codes`; see the header. */
  readonly #byCode = new Map<string, A[]>();

  /** Codes physically down. Cleared wholesale on blur — see `clearHeld`. */
  readonly #held = new Set<string>();

  /**
   * @param defs   the game's action table. Empty is a throw, not an empty map:
   *               a controls panel with no rows is a screen that shipped by
   *               accident, and it renders perfectly.
   * @param stored the player's saved overrides, keyed by action. An entry that
   *               is absent, not an array, or empty falls back to the declared
   *               codes — a stored `[]` is a record of a settings file that got
   *               truncated, not a request for a verb with no keys.
   */
  constructor(defs: readonly RebindDef<A, G>[], stored: Readonly<Record<string, readonly string[] | undefined>> = {}) {
    if (defs.length === 0) throw new Error('Bindings: an empty action table is a controls panel with no rows');
    const seen = new Set<string>();
    for (const def of defs) {
      if (seen.has(def.action)) throw new Error(`Bindings: two entries declare the action ${JSON.stringify(def.action)}`);
      seen.add(def.action);
    }
    this.defs = defs;
    for (const def of defs) {
      const saved = stored[def.action];
      this.#codes.set(def.action, Array.isArray(saved) && saved.length > 0 ? saved.slice() : def.codes.slice());
    }
    this.#reindex();
  }

  /**
   * Rebuild the reverse index from the forward map.
   *
   * A linear pass over two dozen actions, run when a player changes a key —
   * which happens in a settings screen, not per frame. An incremental update
   * would be faster and would have to stay true across set / reset / construct,
   * which is three places for it to disagree with the map that is actually
   * authoritative.
   */
  #reindex(): void {
    this.#byCode.clear();
    for (const [action, codes] of this.#codes) {
      for (const c of codes) {
        const list = this.#byCode.get(c);
        if (list === undefined) this.#byCode.set(c, [action]);
        else list.push(action);
      }
    }
  }

  /** The codes this action answers to. A fresh array is never handed out; treat it as read-only. */
  codesFor(action: A): readonly string[] {
    return this.#codes.get(action) ?? [];
  }

  /**
   * The actions this code fires. Plural on purpose: two actions on one key is a
   * conflict the PLAYER made and the panel shows, and silently dropping one
   * would make the settings screen disagree with the game.
   */
  actionsFor(code: string): readonly A[] {
    return this.#byCode.get(code) ?? [];
  }

  /**
   * Does anything answer to this code?
   *
   * The caller's `preventDefault` gate. Tab moves focus and Space scrolls the
   * page, so a bound one has to be claimed — and an UNbound one must be left
   * alone, or the game swallows the browser.
   */
  claims(code: string): boolean {
    return this.#byCode.has(code);
  }

  /** The declaration for this action, or null. */
  defOf(action: A): RebindDef<A, G> | null {
    for (const d of this.defs) if (d.action === action) return d;
    return null;
  }

  /** What a player reads for this action. Falls through to the id, which is visible and therefore fixable. */
  labelOf(action: A): string {
    return this.defOf(action)?.label ?? String(action);
  }

  /**
   * The player chose a new key for one slot of one action.
   *
   * Returns the action's whole new code list, which is what a caller persists —
   * saving the single code would lose the alternate binding beside it.
   */
  set(action: A, slot: number, code: string): readonly string[] {
    const codes = (this.#codes.get(action) ?? []).slice();
    codes[slot] = code;
    this.#codes.set(action, codes);
    // FAULT ANCHOR — `stale-index` skips the rebuild. See faults.ts: the panel
    // shows the new key, `codesFor` reports it, and the game answers to the old
    // one. This is the whole reason the rebuild is in the same method as the
    // write rather than a step a caller has to remember.
    if (!inputFaultActive('stale-index')) this.#reindex();
    return codes;
  }

  /** Back to what the game declared. The caller clears its own store. */
  resetToDefaults(): void {
    for (const def of this.defs) this.#codes.set(def.action, def.codes.slice());
    this.#reindex();
  }

  /**
   * A code went down. Returns true only on the RISING edge — a key repeat and a
   * second pointer on the same button are both "already down", and a caller
   * latching every call would fire a one-shot verb on every frame it was held.
   */
  press(code: string): boolean {
    const fresh = !this.#held.has(code);
    this.#held.add(code);
    return fresh;
  }

  /** A code came up. */
  release(code: string): void {
    this.#held.delete(code);
  }

  /**
   * Everything is up.
   *
   * A window that loses focus never delivers the keyup, so a key held during an
   * alt-tab stays down forever and the camera pans until somebody notices.
   * Clearing on blur is the only fix — the state cannot be re-derived.
   */
  clearHeld(): void {
    this.#held.clear();
  }

  /** Is this code down right now? */
  heldCode(code: string): boolean {
    return this.#held.has(code);
  }

  /** Is any of this action's codes down right now? */
  isDown(action: A): boolean {
    const codes = this.#codes.get(action);
    if (codes === undefined) return false;
    for (const c of codes) if (this.#held.has(c)) return true;
    return false;
  }
}
