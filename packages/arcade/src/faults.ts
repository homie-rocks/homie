/**
 * ============================================================================
 *  Deliberate faults, so a green run means something.
 * ============================================================================
 *  An instrument that has never been seen red is an instrument nobody has
 *  validated. A seat probe injects each of these and requires an EXACT set of
 *  checks to fail — too few and the detector detects nothing, too many and
 *  one detector is wearing several names.
 *
 *  Read from the environment in Node and from the query string in a browser,
 *  so the same fault name works in a probe and in a hand-driven page.
 * ============================================================================
 */

export const ARCADE_FAULTS: readonly string[] = [
  /** `Table` places a seat and never dresses it. A placed seat gets a blank phone. */
  'mute-surfaces',
  /** `RoleTable.leave` frees the slot and promotes nobody. A late arrival waits for ever. */
  'never-promote',
  /** `Pad.apply` clears the rising edge on release. A tap between two frames is lost. */
  'no-latch',
];

/**
 * Which fault is active, or null.
 *
 * ONE AT A TIME, deliberately. Two faults at once make an attribution
 * ambiguous, and *"a fault going red proves the DETECTOR is live, never that
 * the TRACE is the named case"* is already the weakest link in a fault run.
 */
export function activeArcadeFault(): string | null {
  const env = typeof process !== 'undefined' && process.env ? process.env.HOMIE_ARCADE_FAULT : undefined;
  if (typeof env === 'string' && env !== '') return env;
  const loc = typeof location !== 'undefined' ? location.search : '';
  const m = /(?:\?|&)arcadeFault=([a-z-]+)/.exec(loc);
  return m ? m[1]! : null;
}

/**
 * Is this named fault active?
 *
 * THROWS on a name that is not in the table. A fault anchored on a symbol that
 * no longer exists must fail LOUDLY — five rotted silently on a previous
 * project and those harnesses validated nothing while reporting green.
 */
export function arcadeFaultActive(name: string): boolean {
  if (!ARCADE_FAULTS.includes(name)) {
    throw new Error(`arcadeFaultActive: ${JSON.stringify(name)} is not a declared fault — the anchor has rotted`);
  }
  return activeArcadeFault() === name;
}
