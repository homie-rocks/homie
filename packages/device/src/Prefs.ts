/**
 * ============================================================================
 *  The preference MECHANISM. Not one preference.
 * ============================================================================
 *  Every line of code below was lifted verbatim out of the control-preferences
 *  module of two racing games that held it byte-identically — one hash over the
 *  `num` / `bool` / `oneOf` block in both — and where the storage wrapping and
 *  the parse guard were the same six lines written twice. The doc comments on
 *  the individual functions are NEW: the originals were private helpers three
 *  lines from their only call site and needed none. What is quoted rather than
 *  written is marked as quoted.
 *
 *  WHAT DID NOT COME WITH IT, AND WHY. The games' preference RECORDS stay in
 *  the games, entirely: `scheme`, `hand`, `driftAssist`, `tiltRange`,
 *  `padLayout`, `invertPitch`, `radiatorAssist`, every default value, every
 *  range, the key names, `TUTORIAL_VERSION`, the storage-key migration and
 *  `PAD_LAYOUT_RESET_V`. Those two records share a SHAPE and not a THING — they
 *  diverged by 29 lines of code and three whole fields — and the rule for these
 *  packages is that a package may know THAT a person has durable facts and may
 *  not know what any of them means. So this package supplies no defaults at
 *  all: **it refuses, it does not fill in.**
 *
 *  Two of the four rules the original header states are the reason this code
 *  exists, and they are carried here word for word because they are the asset:
 *
 *  2. **Every access is wrapped.** `localStorage.setItem` *throws* in Safari
 *     private mode and in a partitioned third-party frame — not returns false,
 *     throws — and an uncaught throw on the boot path is a black screen. It is
 *     also legal for `localStorage` itself to be absent (a `file://` document,
 *     a sandboxed iframe), so even the property read is inside the try.
 *
 *  3. **Absent or unparseable falls to defaults, silently.** A player whose
 *     storage is corrupt gets a working game with default controls, not a
 *     console error and no controls. Every field is validated individually,
 *     because a partially-written record is the realistic corruption (a tab
 *     killed mid-write), not a wholly invalid one.
 *
 *  The other two stay with the games: rule 1 ("not `Settings.ts`" — a placement
 *  rule about a game's own directories) and rule 4 (`tutorialSeen` is a version
 *  stamp, not a boolean — a statement about a field this package must never
 *  learn the name of).
 *
 *  THE ONE THING RULE 3 IS NOT, AND THIS IS THE WHOLE POINT OF THE FILE.
 *  "Falls to defaults" is per FIELD, never per record. The cheap version —
 *  `return { ...DEFAULTS, ...JSON.parse(raw) }` — reads as if it does the same
 *  job and is the false-success shape exactly: the `try` catches the *parse*
 *  and then reports success for a record it never checked. Feed it the record
 *  a half-finished settings screen actually writes, `{"panSensitivity":"fast"}`,
 *  and a string reaches arithmetic, `NaN` reaches a three.js camera matrix, and
 *  the matrix never recovers — a black screen that no in-game action escapes,
 *  only clearing site data. The package's harness carries that as the fault
 *  `tolerant-prefs` and has been watched going red on it.
 *
 *  Nothing in a boot path awaits any of this. Every function here is
 *  synchronous, none of them can throw, and each returns a complete answer.
 * ============================================================================
 */

/**
 * A finite number inside [lo, hi], or the default.
 *
 * `typeof v === 'number'` comes FIRST and is the half that does the work: the
 * realistic corruption is a string where a number belongs, and every check
 * that coerces — `!isNaN(v)`, `v >= lo`, `+v` — says yes to `''` and to `'0'`.
 * `Number.isFinite` then removes NaN and the two infinities, which is what a
 * hand-edited or half-written record produces.
 *
 * Out of range falls to the default rather than clamping. That is what both
 * games did and it is carried unchanged; do not "fix" it to a clamp inside a
 * parity commit.
 */
export function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt;
}

/** A real boolean, never a truthy one. `"false"` is a string and is rejected. */
export function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

/** A member of a closed set, or the default. The set is the game's, always. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

/**
 * A LIST of strings, copied, or a copy of `dflt`.
 *
 * All or nothing, deliberately: one bad element rejects the whole list rather
 * than being dropped from it. A list is one value and its POSITIONS carry
 * meaning to the game that stored it — a keybinding list is [primary,
 * secondary], and dropping element 0 out of `["KeyW", 7]` silently promotes the
 * secondary to primary. The package must not know that positions mean
 * anything; it must also not destroy the fact that they might.
 *
 * BOTH RETURNS COPY. The caller is handed something it may mutate: the
 * rebinding panel in a game does exactly that — read the record, assign into
 * it, write it back — and a validator that hands back the caller's own default
 * array turns the first rebind into a permanent edit of the game's defaults for
 * the rest of the session.
 */
export function strings(v: unknown, dflt: readonly string[]): string[] {
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) return dflt.slice();
  return (v as string[]).slice();
}

/**
 * A NESTED record, rebuilt key by key through a validator the caller supplies.
 * Never null, never the object it was given, and never larger than its input.
 *
 * `item` returns null for "this entry is not a value I recognise", and the
 * entry is then absent rather than present-and-wrong — so the game falls to
 * whatever it does for a key it has never seen, which it already has to have an
 * answer for. What a key MEANS is the game's, always: this function knows only
 * that a stored record can have a record inside it.
 *
 * Three things it refuses, each measured against what a browser can actually
 * put in a key:
 *
 *  · **An array is not a record.** `typeof [] === 'object'`, and a stored `[1,2,3]`
 *    spread into a record produces the keys `0`, `1`, `2`. Measured on one
 *    game's own bytes: `{"bindings":"nope"}` came back as
 *    `{"0":"n","1":"o","2":"p","3":"e"}` — four bindings that were never stored.
 *  · **`__proto__` is skipped, and this is not paranoia.** `JSON.parse` creates
 *    an OWN property for it (an object literal does not), so it arrives in
 *    `Object.keys`. Assigning it — `out['__proto__'] = value` — invokes the
 *    setter: the entry silently vanishes AND the returned map inherits from
 *    whatever was stored, so it answers for keys it does not have. A game
 *    reading `bindings[action]` would get a binding nobody ever made.
 *    (`{ ...stored }` is safe here and this loop is not, which is why the guard
 *    is written down rather than assumed.)
 *  · **Nothing is shared.** The map is fresh on every call, for the reason
 *    `strings` copies.
 */
export function mapOf<T>(v: unknown, item: (value: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const key of Object.keys(v as Record<string, unknown>)) {
    if (key === '__proto__') continue;
    const value = item((v as Record<string, unknown>)[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * The raw stored string for a key, or null. Never throws.
 *
 * The property read is inside the try, not just the call — see rule 2. A
 * `file://` document has no `localStorage` binding at all and touching it is a
 * ReferenceError, which is a different failure from a disabled store and has
 * the same fix.
 *
 * A caller that reads two keys (one game reads its own, then the older one it
 * migrates from) calls this twice rather than wrapping both in one try.
 * That is the same behaviour: `localStorage` failing is a property-level or
 * whole-store failure, so a second key cannot succeed where the first threw,
 * and both spellings end at `null` with no migration.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    /* storage disabled, partitioned, or absent — defaults are a valid answer */
    return null;
  }
}

/**
 * Best-effort write. A failure here is not an error the player can act on.
 *
 * `JSON.stringify` is called INSIDE the try, which is where the games had it.
 * Moving it to the call site would put the one operation that can throw on a
 * record outside the only guard that exists, and the boot path is the caller.
 */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota, private mode, disabled storage. The session still works. */
  }
}

/**
 * Forget a key. Never throws, for the same three reasons `readStored` does not.
 *
 * Here because a game that can WRITE a durable fact and cannot FORGET one grows
 * its own `try { localStorage.removeItem } catch {}` — which is how one game's
 * objectives panel came to hold the fourth copy of this guard. The pair is the
 * capability; publishing only half of it is what makes the other half get
 * written again.
 */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing a player can act on, and nothing a caller can do about it */
  }
}

/**
 * A stored string turned into a plain record, or null for every way that can
 * fail: absent, empty, unparseable, `null`, or a JSON value that is not an
 * object. Null means "use your defaults" and is the ONLY thing it means.
 *
 * It deliberately returns `Record<string, unknown>` and not a partial of the
 * caller's type. A `Partial<Prefs>` cast here is the lie that makes
 * `{ ...DEFAULTS, ...stored }` typecheck: every field arrives typed and none of
 * them was checked. `unknown` forces the per-field validators above to run.
 */
export function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
