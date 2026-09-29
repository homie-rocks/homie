/**
 * ============================================================================
 *  Handle — wrap a harness handle that has not been installed yet.
 * ============================================================================
 *
 *  A capture harness drives a page through a table of names on `window`. Some
 *  layer of the page — a title screen, a boot overlay, a pause state — has to
 *  get out of the way when one of those names is called, and it is created
 *  BEFORE the subsystem that installs them. There is nothing to wrap.
 *
 *  So the assignment is intercepted instead: `defineProperty` puts an accessor
 *  in place, and the setter stores a WRAPPER around whatever the real installer
 *  assigns. The harness sees the name it always saw, calls it the way it always
 *  did, and the layer stands down first.
 *
 *  ── WHY NOT A FLAG THE HARNESS PASSES ──────────────────────────────────────
 *
 *  Because a flag a harness has to remember is a flag some harness will forget,
 *  and the failure is silent: the layer stays up, the capture photographs it,
 *  and the run reports a worse-looking game rather than a broken harness. A
 *  flag is worth having as the BRACES — an explicit `?skipTitle` that says so —
 *  and this is the belt, which is the half that needs no edit anywhere.
 *
 *  ── A NON-FUNCTION IS STORED UNWRAPPED, DELIBERATELY ───────────────────────
 *
 *  Somebody assigning a value rather than a function to one of these names is
 *  either a different contract or a mistake, and wrapping it in a callable
 *  would turn a readable value into something that throws on read. It passes
 *  through.
 *
 *  ── AND IT IS NEVER FATAL ──────────────────────────────────────────────────
 *
 *  A platform that refuses `defineProperty` on its global object loses the belt
 *  and keeps the braces. `intercept` returns false rather than throwing, so a
 *  caller can say so in a log instead of failing to construct.
 */

/** The global the handles live on. `window` in a page; injectable for a test. */
export interface HandleHost {
  [key: string]: unknown;
}

/**
 * Intercept `name` on `host`. Every function later assigned to it is replaced
 * by `wrap(fn)`; every non-function passes through untouched.
 *
 * True when the accessor was installed. False when the platform refused, which
 * is a degraded state and not an error.
 */
export function interceptHandle(
  host: HandleHost, name: string,
  wrap: (fn: (...args: unknown[]) => unknown, name: string) => (...args: unknown[]) => unknown,
): boolean {
  let real: unknown;
  try {
    Object.defineProperty(host, name, {
      configurable: true,
      enumerable: true,
      get() { return real; },
      set(fn: unknown) {
        real = typeof fn === 'function'
          ? wrap(fn as (...a: unknown[]) => unknown, name)
          : fn;
      },
    });
    return true;
  } catch {
    return false;
  }
}
