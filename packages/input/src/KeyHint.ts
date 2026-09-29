/**
 * ============================================================================
 *  KeyHint.ts — the footer strip, DERIVED from the live binding table instead
 *  of typed a second time.
 * ============================================================================
 *
 * `Rebind.ts` is the table: which verbs exist, what each is called in front of
 * a player, and which codes they are on right now. `ControlsSheet` and
 * `ControlsScreen` are the full panel. This is the third surface every game
 * with a keyboard grows and the one they all hand-write — the two-or-three
 * character hint that sits under the HUD saying which key does what.
 *
 * ## Why it is a package capability and not four lines in a HUD
 *
 * Because typing it a second time is a defect with a measured symptom. In the
 * game this came out of the footer said **"Q/E ROTATE"** while the controls
 * panel, built from the live table, said **"Orbit camera left/right"**. Same
 * two keys, two different words, and ROTATE is the ambiguous one that the
 * game's own input header records as deliberately abandoned — it can mean the
 * camera turns or the world turns, both ship in real games, and the strip is
 * the more visible of the two surfaces. It drifted because it was TYPED, in a
 * second place, and a typed copy of somebody else's data is a copy that goes
 * stale on their next commit and nowhere else. Nothing goes red when it does.
 *
 * So `keys` comes from the codes actually bound to the action AT THIS MOMENT —
 * rebind orbit onto Z/C in the controls panel and the strip says Z/C — and
 * `caption` comes from the action's own label. **Nothing in this file authors a
 * word of player-facing text.** The two compactions it applies are mechanical
 * and each is stated where it happens.
 *
 * ## The source is read STRUCTURALLY and every call carries a fallback
 *
 * A game's `Ctx.input` is the game's type and widening a contract is its own
 * commit, so this asks for three optional methods by shape rather than for a
 * `Bindings` instance. `Bindings` satisfies it; so does a headless unit
 * harness's stub, which is what `fallback` is for. A silently EMPTY strip would
 * be worse than a stale one — the player would be told nothing at all.
 *
 * This file imports nothing.
 */

export interface KeyHint { keys: string; caption: string }

/** What a game's input object may additionally offer. Read STRUCTURALLY and
 *  defensively — see the header — so a stub satisfies it by accident and a
 *  `Bindings` satisfies it on purpose. */
export interface BindingSource {
  bindingsFor?(action: string): readonly string[];
  label?(code: string): string;
  actionLabel?(action: string): string;
}

/**
 * Glyph for a key, compacted for a 9px footer strip.
 *
 * The compaction is CODE-keyed, never label-keyed: "Left mouse" -> "LMB" is a
 * rendering of `Mouse0`, so it cannot disagree with the controls panel about
 * WHICH input it is, only about how much room it takes.
 */
function keyGlyph(code: string, label: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  return label.toUpperCase();
}

/**
 * The words two or more related actions AGREE on.
 *
 * "Orbit camera left" and "Orbit camera right" agree on "Orbit camera", which
 * is exactly the caption a strip that lists Q and E together wants — and it is
 * the panel's wording rather than a synonym of it. A single action keeps its
 * whole label. The `/` cut takes "Select / place" to "SELECT": the strip has
 * room for one verb, and the alternative is authoring a shorter word here,
 * which is the drift this function exists to end.
 */
function commonCaption(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  // `as` on the indexed reads: `noUncheckedIndexedAccess` is on across the
  // engine, the length has just been tested, and a `?.` in its place would be a
  // plausible default standing in for an answer.
  const words = labels.map((l) => l.split(' '));
  const first = words[0] as string[];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const w = first[i] as string;
    if (!words.every((ws) => ws[i] === w)) break;
    out.push(w);
  }
  const joined = (out.length ? out.join(' ') : first.join(' '));
  return (joined.split(' / ')[0] as string).trim().toUpperCase();
}

/**
 * One entry of the key-hint strip, derived from the live bindings.
 *
 * `fallback` is used when the input system exposes neither accessor — which is
 * a headless unit harness with a stub `IInput`, not a running game. A silently
 * empty strip would be worse than a stale one.
 */
export function keyHint(
  input: unknown, actions: readonly string[], fallback: KeyHint,
): KeyHint {
  const src = input as BindingSource | null;
  if (!src || typeof src.bindingsFor !== 'function' || typeof src.actionLabel !== 'function') {
    return fallback;
  }
  const keys: string[] = [];
  const labels: string[] = [];
  for (const a of actions) {
    const codes = src.bindingsFor(a);
    if (!codes || codes.length === 0) continue;
    // ── HOW MANY OF AN ACTION'S KEYS TO PRINT ───────────────────────────────
    // A GROUP of actions (Q and E; 1, 2 and 3) prints one key each, or the
    // strip becomes a list. A LONE action prints all of its keys, up to two,
    // because that is where the alternates live and they are worth knowing:
    // `controls` is bound to F1 AND Slash, and printing only the first turned
    // the discoverable "?" into "F1" — a function key that a laptop's own
    // firmware may well eat. Both are the table's, neither is typed here.
    const take = actions.length === 1 ? Math.min(2, codes.length) : 1;
    for (let i = 0; i < take; i++) {
      const code = codes[i] as string;
      const lab = typeof src.label === 'function' ? src.label(code) : code;
      const g = keyGlyph(code, lab);
      if (g && keys.indexOf(g) < 0) keys.push(g);
    }
    const al = src.actionLabel(a);
    if (al) labels.push(al);
  }
  if (keys.length === 0 || labels.length === 0) return fallback;
  return { keys: keys.join('/'), caption: commonCaption(labels) };
}
