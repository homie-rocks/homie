/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/Fault.ts — the seam a probe injects a KNOWN DEFECT
 *  through, and the handshake that makes a green run of that probe mean
 *  something.
 * ===========================================================================
 *
 * WHY IT IS PLATFORM RATHER THAN ONE GAME'S
 * ---------------------------------------------------------------------------
 * This was extracted whole from one of the games this package serves. Nothing
 * in it ever knew which game it was in: it reads one string off `globalThis`,
 * compares it to a name, and records — from the branch that took it — that the
 * branch ran. It sat in a game for a long time for one reason: **there was no
 * second copy, so no duplication counter ever tripped on it**, and a single
 * implementation can still be 100% platform.
 *
 * When it moved (2026-08-21) three games read `__probeFault`, and every one of
 * them hand-wrote the same two `globalThis` casts.
 *
 * `@homie-rocks/postfx/Chain.ts` deliberately does NOT do the read — it takes
 * `faultAsked` / `faultApplied` as required fields of `ChainSpec` because that
 * package declares it may not see a window. That decision is correct there and
 * it is exactly why the read had nowhere to live: the *validator* was published
 * (`readProbeFault`) and the *handshake* was not, so every consumer wrote the
 * handshake again. This file is the missing half, and a `ChainSpec` can now be
 * filled in with `() => faultAsked()` and `(f) => faultActive(f)` rather than
 * two casts per game.
 *
 * ── WHY THIS IS A MODULE AND NOT THREE `globalThis` READS ──────────────────
 *
 * A fault anchored on a symbol name must fail LOUDLY when the symbol is
 * missing; a fault that rots silently leaves its harness validating nothing
 * while reporting green. On 2026-08-20 three such harnesses were caught in one
 * night, all by accident: one probe wrote `window.__probeFault` and NOTHING
 * READ IT, so all three of its faults — including the one its own header
 * called "the one that must never be green" — reported clean passes; another
 * parsed only the space-separated `--fault NAME` form while every other probe
 * writes `--fault=NAME`, so invoked the documented way it applied nothing and
 * printed PASS; a third was a tombstone that exits 0.
 *
 * So the contract here is deliberately not "the probe sets a flag and trusts
 * it". It is:
 *
 *   1. the probe writes `window.__probeFault` BEFORE the page's first script,
 *      because the world is built during boot and a fault installed afterwards
 *      is installed into a world that already exists;
 *   2. `faultActive(name)` returns true ONLY from the call site that is about
 *      to take the faulted branch, and sets `window.__probeFaultApplied` THERE;
 *   3. the probe reads `__probeFaultApplied` back and BLOCKS the whole run if
 *      it is not the fault it asked for.
 *
 * Step 2 is the load-bearing one. `__probeFaultApplied` is written by the
 * branch, never by the line that reads the flag — so a fault whose anchor has
 * been renamed, refactored past, or deleted leaves it null, and the probe
 * reports BLOCKED instead of photographing a game nothing was injected into and
 * calling the result green. An unknown fault name does the same thing, which is
 * what catches a typo in the probe rather than in this file.
 *
 * ── AND WHY IT IS SAFE TO SHIP ─────────────────────────────────────────────
 *
 * `window.__probeFault` is only ever set by a harness through CDP before the
 * first script runs. Nothing in a game, no query parameter and no saved
 * setting can reach it, so every branch guarded by `faultActive` is dead code
 * for a real player. It is read ONCE, at module load, for the same reason a
 * freeze is read once per frame rather than per subsystem: a fault that could
 * change halfway through a frame would produce a picture that is neither arm.
 *
 * ── THE ONE THING THAT IS NEW HERE, AND IT IS A TEST SEAM, NOT A FEATURE ───
 *
 * `__resetFaultForTest(asked)` exists because `ASKED` is captured at module
 * load and a Node harness cannot re-import a module to change it. Without it
 * the only way to see this file's own detector go red is to spawn a browser,
 * which is how a detector ends up never being seen red at all. It is named so
 * that nothing mistakes it for a runtime control, and this file's own test
 * probe is its only caller.
 */

/**
 * Read at module load, not per call.
 *
 * `globalThis` rather than `window` so this file stays importable from a Node
 * harness that wants to reason about it without a DOM — the same reason
 * `Host.ts` reaches for the pipeline through a handle instead of an import.
 */
let ASKED: string | null = (() => {
  const w = globalThis as unknown as { __probeFault?: unknown };
  return typeof w.__probeFault === 'string' ? w.__probeFault : null;
})();

/**
 * Is THIS fault the one that was asked for — and record, from here, that it
 * was actually taken.
 *
 * Call it AT the branch, never at the top of a function to cache into a
 * `const`: the acknowledgement has to be evidence that the faulted code path
 * ran, and a cached read is only evidence that the flag was legible.
 */
export function faultActive(name: string): boolean {
  if (ASKED !== name) return false;
  (globalThis as unknown as { __probeFaultApplied?: string }).__probeFaultApplied = name;
  return true;
}

/** What was asked for, for a diagnostic line. Never used to take a branch. */
export function faultAsked(): string | null { return ASKED; }

/** What was actually TAKEN. This is the value a probe blocks on. */
export function faultApplied(): string | null {
  const w = globalThis as unknown as { __probeFaultApplied?: unknown };
  return typeof w.__probeFaultApplied === 'string' ? w.__probeFaultApplied : null;
}

/**
 * TEST SEAM. Re-read the module-load capture with an explicit value and clear
 * the acknowledgement. Only this file's test probe calls this; a game
 * calling it would be defeating the "read once" property above.
 */
export function __resetFaultForTest(asked: string | null): void {
  ASKED = asked;
  delete (globalThis as unknown as { __probeFaultApplied?: string }).__probeFaultApplied;
}
