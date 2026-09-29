/**
 * The package-owned clock an off-screen film shutter may observe.
 *
 * This is deliberately a window seam, not a player. The package still decides
 * what its first frame, final frame and master clock mean; the platform only
 * gets an honest way to hold that work at zero and start it after recording is
 * armed. No method here contains show logic or advances a beat.
 *
 * All clock values are seconds. `ready`, `duration`, `time` and `done` are
 * synchronous because the shutter polls them together and must not create four
 * independently resolving timelines. `arm` and `start` may await decode or
 * audio setup.
 */
export interface HomieFilmClock {
  /** All assets needed for frame zero are decoded and the clock can be armed. */
  ready(): boolean;
  /** The intended released duration, finite and greater than zero. */
  duration(): number;
  /** Load the first state and hold it at exactly t=0 without audible output. */
  arm(): void | Promise<void>;
  /** Release the same master clock used by the picture (and page audio, if any). */
  start(): void | Promise<void>;
  /** Current master-clock position, monotonic from zero through `duration()`. */
  time(): number;
  /** True only after the intended final state has been presented. */
  done(): boolean;
}

export const HOMIE_FILM_CLOCK_METHODS = [
  'ready',
  'duration',
  'arm',
  'start',
  'time',
  'done',
] as const satisfies readonly (keyof HomieFilmClock)[];

export type HomieFilmClockShape =
  | { readonly ok: true; readonly clock: HomieFilmClock }
  | { readonly ok: false; readonly why: string };

/**
 * Validate only the callable shape, without starting or otherwise mutating a
 * package. Value/range checks belong to the shutter at the moment it observes
 * them: calling `arm` from a shape validator would make inspection start a
 * show, while calling `duration` here and again later would hide clock drift.
 */
export function homieFilmClock(value: unknown): HomieFilmClockShape {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return { ok: false, why: 'window.__homieFilm is absent or is not an object' };
  }
  const object = value as Record<string, unknown>;
  const missing = HOMIE_FILM_CLOCK_METHODS.filter((name) => typeof object[name] !== 'function');
  if (missing.length > 0) {
    return { ok: false, why: `window.__homieFilm is missing callable ${missing.join(', ')}` };
  }
  return { ok: true, clock: value as HomieFilmClock };
}

declare global {
  interface Window {
    /** Optional: packages without it may only use an explicitly bounded wall clock. */
    __homieFilm?: HomieFilmClock;
  }
}

