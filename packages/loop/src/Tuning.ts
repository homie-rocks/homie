/**
 * ============================================================================
 *  Tuning.ts — the live tuning console a 3D game installs on `window`.
 * ============================================================================
 *  WHAT THIS IS. A game holds a small record of numbers that decide how it
 *  FEELS — how far the lens opens with speed, how hard a gun kicks, how much
 *  the camera bobs. Feel is not a thing to guess at from a measurement, so a
 *  3D game publishes that record on `window` so somebody can change a value,
 *  keep playing, and have the rig respond on the next frame.
 *
 *  WHY THERE IS ONE OF THESE. Three games each wrote this console, and one
 *  implementation was clearly the best:
 *
 *                     live getters   set(patch)   returns the numbers   banner
 *   a kart racer          yes          yes            yes              yes
 *   a space racer         yes          yes            yes              yes
 *   a shooter             NO           NO             NO               NO
 *
 *  The shooter's `api` was built by SPREADING `feel` once at module scope.
 *  Spread copies values, so `__feel.mouseSens` in the console was a SNAPSHOT
 *  taken before the game booted — and `punchy()` had to
 *  `Object.assign(api, feel)` afterwards to paper over it, which fixed the
 *  read and still left writing to `__feel.bob` doing nothing at all. Somebody
 *  tuning it typed a number, saw it accepted, and played on with the shipped
 *  value. That is a defect: three implementations of one mechanism means one
 *  is best and the others are not.
 *
 *  So the accessor pattern lives here and every game gets it.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT A GAME STILL OWNS, and it is everything that is not the plumbing
 *  ---------------------------------------------------------------------------
 *   · `shipped`  the record itself, and every field name in it. This is the
 *                game — a racer's is a lens and an arm, a shooter's is a mouse
 *                and a recoil, and there is no shared vocabulary between them.
 *   · `punchy`   the stronger set, as a starting point for a conversation
 *                rather than an answer.
 *   · `banner`   what the console says when it wakes up. `null` says "nothing
 *                to announce" out loud, which is not the same as forgetting.
 *
 *  There is no optional field in `TuningSpec`. A game that forgets `punchy`
 *  should fail to compile, not inherit another game's idea of "stronger".
 *
 *  ---------------------------------------------------------------------------
 *  NOTHING HERE IMPORTS `three`, for the reason Boot.ts and Host.ts both give:
 *  two copies of three.js is two `instanceof` universes and the symptom is an
 *  object that renders as nothing with no error at all. This touches `window`
 *  and `console` and nothing else.
 * ============================================================================
 */

/** A record of tuning knobs. Numbers and booleans; the game names every field. */
export type TuningRecord = Record<string, number | boolean>;

/** What a game hands `installTuning`. No optionals — see the header. */
export interface TuningSpec<T extends TuningRecord> {
  /**
   * The name the console is published under, WITHOUT the leading underscores:
   * `'feel'` becomes `window.__feel`. A game names it because two experiences
   * in one page would otherwise fight over one handle.
   */
  handle: string;
  /**
   * The live record. This object is MUTATED IN PLACE and never replaced, which
   * is the whole contract: whatever the game already closed over keeps
   * pointing at the values the console is editing.
   */
  live: T;
  /** Exactly what the game shipped with, so `reset()` is a real answer. */
  shipped: T;
  /**
   * The knobs `punchy()` moves, AND ONLY THOSE.
   *
   * `Partial<T>` and not `T`, and this is not laxity — it is the whole
   * semantics, and a console probe caught the other reading on its first run.
   * A shooter's live record carries two fields that are a PLAYER'S
   * OWN PREFERENCE, loaded from `Prefs` at boot: their mouse sensitivity and
   * their invert-Y. A whole-record `punchy` sweeps those back to shipped, so
   * pressing "make it punchier" silently resets somebody's mouse — and it
   * looks completely fine, because every knob punchy is ABOUT did move.
   *
   * A game whose stronger set really is the whole record simply writes the
   * whole record; the kart racer does. This is not an optional field — a game
   * must state a `punchy`, and `{}` says "nothing to offer" out loud.
   */
  punchy: Partial<T>;
  /** One line on boot, or `null` to say there is nothing to announce. */
  banner: string | null;
}

/**
 * The console's own surface, past the game's own field names.
 *
 * Every method returns the current numbers rather than `void`, because the
 * point of pressing `punchy()` is to read what it did and paste it into a
 * report — a method that returns undefined makes that a second command.
 */
export interface TuningConsole<T extends TuningRecord> {
  punchy(): string;
  reset(): string;
  set(patch: Partial<T>): string;
  show(): string;
}

/**
 * Publish the console on `window` and hand it back.
 *
 * THE ACCESSORS ARE THE POINT AND THEY ARE WHY THIS IS NOT A SPREAD. Reading
 * `__feel.fovSpeed` must show the value the frame is using RIGHT NOW, and
 * writing it must take effect on the next frame. A spread of `live` gives a
 * console that reads a snapshot of boot and swallows every write — which is
 * what one game shipped, and which looks completely fine from the console because
 * the value you typed is the value that reads back.
 */
export function installTuning<T extends TuningRecord>(spec: TuningSpec<T>): TuningConsole<T> {
  const { live, shipped, punchy } = spec;

  const api: TuningConsole<T> = {
    punchy() { Object.assign(live, punchy); return api.show(); },
    reset() { Object.assign(live, shipped); return api.show(); },
    set(patch: Partial<T>) { Object.assign(live, patch); return api.show(); },
    show() {
      console.table(live);
      return JSON.stringify(live);
    },
  };

  // The keys come from `shipped` rather than from `live`, deliberately: a key
  // a previous session added to the live record at runtime is not a knob this
  // build ships, and giving it an accessor would advertise it as one.
  for (const key of Object.keys(shipped) as (keyof T & string)[]) {
    Object.defineProperty(api, key, {
      get: () => live[key],
      set: (v: T[keyof T & string]) => { live[key] = v; },
      enumerable: true,
    });
  }

  (globalThis as unknown as Record<string, unknown>)[`__${spec.handle}`] = api;
  if (spec.banner !== null) console.info(`%c${spec.banner}`, 'color:#8ab4ff');
  return api;
}
