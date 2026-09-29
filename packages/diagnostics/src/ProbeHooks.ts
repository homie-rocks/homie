/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/ProbeHooks.ts — the fault protocol, once.
 * ===========================================================================
 *
 * WHAT THIS IS, AND THE MEASUREMENT THAT SAYS IT SHOULD EXIST.
 * ---------------------------------------------------------------------------
 * Every instrumented subsystem in these games speaks the same three-part
 * protocol to a probe, and on 2026-08-21 it was written out by hand in seven
 * places:
 *
 *     window.__freeze            the probe holds the frame
 *     window.__<x>Fault          the probe asks for a named defect
 *     window.__<x>FaultApplied   the code writes back FROM THE BRANCH THAT
 *                                TOOK IT, so a fault nobody implements cannot
 *                                look like a pass
 *
 * Six games' `render/PostFX.ts` each carried the same eight lines, character
 * for character, and two more games each carried their own copy of the
 * validator. Six identical copies is six chances for a fix to miss one
 * silently.
 *
 * WHY IT IS HERE AND NOT IN `@homie-rocks/postfx`.
 * ---------------------------------------------------------------------------
 * `packages/postfx/src/Chain.ts` states, at length, that it may not read
 * `window` — that is what lets a Node harness drive the identical chain
 * protocol with no DOM, and it is right. So the three `window` reads could not
 * move into the package that declared them.
 *
 * They belong HERE because this package is already the browser-facing one:
 * `Host.ts` and `Watchdog.ts` both read `globalThis`, and the thing being
 * described — "how a probe asks this page to be broken on purpose" — is a
 * diagnostics concern in every other respect. `Chain.ts` keeps its DOM-free
 * `ChainSpec`; a game satisfies the three fields with one call to
 * `probeHooks()` instead of eight lines of casts.
 *
 * NOTHING HERE KNOWS WHAT A FAULT MEANS. The allowed set is the caller's, the
 * key is the caller's, and this file cannot tell a shader fault from a clock
 * fault. That is the boundary: it owns the PROTOCOL, never the vocabulary.
 */

/**
 * The window this page's probe writes to. Declared as an index rather than as
 * named optionals so a caller can use any key it likes — `__probeFault`,
 * `__clockFault`, `__walkFault` — without this file having to know them.
 */
type ProbeWindow = Record<string, unknown>;

function probeGlobal(): ProbeWindow {
  return globalThis as unknown as ProbeWindow;
}

/**
 * Validate a fault name a probe asked for, and THROW when it answers to
 * nothing.
 *
 * THE THROW IS THE WHOLE POINT and it is not defensive programming. A fault
 * anchored on a symbol name must fail LOUDLY when the symbol is missing; a
 * fault that rots silently leaves its harness validating nothing while
 * reporting green. A misspelt `--fault=` that quietly ran the healthy path
 * would make the whole suite green for the exact reason it should be red.
 *
 * `null` and `undefined` mean "no fault asked for" and are the normal case — a
 * real session is not running a probe.
 *
 * THE EMPTY STRING THROWS, and that is a deliberate choice between the two
 * implementations this replaces. `@homie-rocks/postfx`'s `readProbeFault` threw on
 * it; one game's audio fault reader returned null. No probe ever sets it —
 * every probe writes the flag behind an `if (FAULT)` — so the only way `''`
 * reaches here is somebody setting it deliberately with a broken value, and
 * the louder of two shipped behaviours is the one to keep.
 *
 * @param asked   whatever was on the window; genuinely `unknown`
 * @param allowed the caller's complete fault set
 * @param label   what goes in the message, e.g. `audio: window.__clockFault`
 */
export function readFault<F extends string>(
  asked: unknown,
  allowed: readonly F[],
  label: string,
): F | null {
  if (asked === undefined || asked === null) return null;
  if (typeof asked !== 'string' || !allowed.includes(asked as F)) {
    throw new RangeError(
      `${label} = ${JSON.stringify(asked)} is not one of [${allowed.join(', ')}]. `
      + 'A fault nobody implements must never look like a pass.',
    );
  }
  return asked as F;
}

/** The three functions a probe-instrumented subsystem needs from its host. */
export interface ProbeHooks<F extends string> {
  /** `window.__freeze === true` — the probe is holding this frame. */
  held: () => boolean;
  /** the validated fault name, or null. Throws on a name nobody implements. */
  faultAsked: () => F | null;
  /** called FROM THE BRANCH THAT TOOK THE FAULT, never from the asking site. */
  faultApplied: (fault: F) => void;
}

/**
 * The three hooks, wired to this page's `window`.
 *
 * `key` names the pair — `probeHooks(CHAIN_FAULTS, 'probe')` reads
 * `window.__probeFault` and writes `window.__probeFaultApplied`, which is
 * exactly what the six hand-written copies did. The naming convention is
 * therefore preserved rather than invented, and no existing probe had to
 * change.
 *
 * `held` is shared across every subsystem on purpose: `__freeze` is a property
 * of the PAGE, not of a chain, and two subsystems disagreeing about whether the
 * frame is held is how a capture ends up half from one instant and half from
 * another.
 */
export function probeHooks<F extends string>(
  allowed: readonly F[],
  key: string,
): ProbeHooks<F> {
  const askKey = `__${key}Fault`;
  const ackKey = `__${key}FaultApplied`;
  const label = `window.${askKey}`;
  return {
    held: () => probeGlobal()['__freeze'] === true,
    faultAsked: () => readFault(probeGlobal()[askKey], allowed, label),
    faultApplied: (fault: F) => { probeGlobal()[ackKey] = fault; },
  };
}
