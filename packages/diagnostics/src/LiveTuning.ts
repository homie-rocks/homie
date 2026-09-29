/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/LiveTuning.ts — a console handle onto a set of numbers
 *  somebody has to FEEL rather than measure.
 * ===========================================================================
 *
 * THE OUTCOME THIS FILE IS FOR, in the words of the game that wrote it first:
 *
 *   "Feel is not a thing to guess at from a measurement, so this exists to be
 *   driven: change a value, keep playing, and the rig responds on the next
 *   frame."
 *
 * That is taste, made operable. A rubric can tell you a camera swings
 * 116 deg/s; only a person holding the controller can tell you whether it
 * feels fast, and the only way they can answer is if the number moves while
 * they are holding it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS HERE AND NOT IN THREE GAMES
 * ---------------------------------------------------------------------------
 * Three games (a first-person shooter, a kart racer and a space racer) each
 * had a `Feel.ts` that ended in the SAME `installFeel()` — the four verbs, the
 * `defineProperty` loop that makes a bare read of `__feel.fovSpeed` show the
 * live value, the `console.table`, the same console line. Byte-identical
 * across three games, measured 2026-08-21.
 *
 * EARLIER DUPLICATION SWEEPS NEVER SAW IT, and the reason is instructive rather
 * than embarrassing: the three files' PARAMETER SETS are completely different
 * — six fields, six and eleven, sharing three names — so a whole-file
 * duplication score put them nowhere near each other.
 * The duplicated thing is 22 lines at the bottom, and 22 lines is under every
 * threshold a run-length census uses. The right question was never "do two
 * games have the same file", it was "is this file's MECHANISM anything to do
 * with this game", and the answer here is no: it is a console handle onto a
 * record, and it does not know what a field means.
 *
 * ---------------------------------------------------------------------------
 * WHAT DELIBERATELY DID NOT COME
 * ---------------------------------------------------------------------------
 * Every parameter, every default, every preset, and every docblock explaining
 * a derivation. `fovSpeed: 5.0` is a measurement taken on one circuit at one
 * top speed; `magStrength` names a mag-lock this package must never hear
 * about. The games keep their records whole and hand one in.
 *
 * `PUNCHY` is a PRESET AND NOT A MODE. It is a second value of the same type,
 * supplied by the game, not a flag this file branches on — and a game with
 * nothing to offer passes its shipped record twice rather than getting a
 * `Partial` and a merge.
 */

/**
 * A live-tunable record: a flat object of numbers, and nothing else.
 *
 * FLAT AND NUMERIC IS ENFORCED BY THE TYPE rather than by a convention,
 * because the `defineProperty` loop below can only forward a scalar. A nested
 * object would be handed out by reference, a write to `__feel.foo.bar` would
 * take effect without going through the setter, and the "reset" verb would
 * silently stop working on that branch — which reads as a knob that is stuck
 * rather than as a bug.
 */
export type TunableRecord = Record<string, number>;

export interface LiveTuningOptions<T extends TunableRecord> {
  /**
   * The `window` key the handle is published at, WITHOUT the underscores —
   * `'feel'` becomes `window.__feel`.
   *
   * A value because it is the word a person types while playing, and it is the
   * word the console line has to say. Nothing branches on it.
   */
  readonly name: string;
  /**
   * Exactly what the game shipped with, so the default path is a no-op.
   *
   * This object is COPIED, not held: the live record must be separable from
   * the shipped one or `reset()` would restore whatever the last edit left.
   */
  readonly shipped: T;
  /**
   * A deliberately different set, as a starting point for a conversation
   * rather than an answer. Required, and the same type as `shipped` — a game
   * with no second opinion passes `shipped` again and says so in a comment,
   * which is a stated position rather than an absent one.
   */
  readonly preset: T;
  /** Name of the preset verb, e.g. `'punchy'`. */
  readonly presetVerb: string;
  /** The one line printed at install, telling a player how to drive it. */
  readonly hint: string;
}

export interface LiveTuning<T extends TunableRecord> {
  /**
   * The LIVE record. Every consumer holds this object and reads a field per
   * frame; nothing replaces it, so a reference taken at boot stays correct.
   */
  readonly values: T;
}

/**
 * Publishes the handle and returns the live record.
 *
 * The record is returned rather than only published because a game's own
 * modules must not have to read `window` to get at it — `window.__feel` is for
 * a person at a keyboard, and an import is for code.
 */
export function installLiveTuning<T extends TunableRecord>(
  opts: LiveTuningOptions<T>,
): LiveTuning<T> {
  const values = { ...opts.shipped } as T;
  const keys = Object.keys(opts.shipped) as (keyof T & string)[];

  const show = (): string => {
    console.table(values);
    return JSON.stringify(values);
  };
  const api: Record<string, unknown> = {
    reset() { Object.assign(values, opts.shipped); return show(); },
    set(patch: Partial<T>) { Object.assign(values, patch); return show(); },
    show,
  };
  api[opts.presetVerb] = () => { Object.assign(values, opts.preset); return show(); };

  // Live view: reading `__feel.fovSpeed` should show the CURRENT value, and
  // writing it should take effect on the next frame. A plain spread of the
  // record would snapshot it — the handle would print the boot values forever
  // while the game ran on something else, which is a lie that looks like a
  // working tool.
  for (const key of keys) {
    Object.defineProperty(api, key, {
      get: () => values[key],
      set: (v: number) => { (values as Record<string, number>)[key] = v; },
      enumerable: true,
    });
  }

  (window as unknown as Record<string, unknown>)[`__${opts.name}`] = api;
  console.info(`%c[${opts.name}] ${opts.hint}`, 'color:#8ab4ff');
  return { values };
}
