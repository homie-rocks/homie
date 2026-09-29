/**
 * ============================================================================
 *  Deliberate faults for @homie-rocks/input's rebinding half, so a green run means
 *  something.
 * ============================================================================
 *  The same shape `packages/arcade/src/faults.ts` uses, and for the same
 *  reason: an instrument that has never been
 *  seen red is an instrument nobody has validated.
 *
 *  Read from the environment in Node and from the query string in a browser,
 *  so the same fault name works in a probe and in a hand-driven page.
 * ============================================================================
 */

export const INPUT_FAULTS: readonly string[] = [
  /**
   * `Bindings.set` writes the new code and does NOT rebuild the code index.
   *
   * This is the exact failure the moved code was carrying a `rebuildIndex()`
   * call to prevent, and it is the quiet kind: the panel re-renders showing the
   * key the player just chose, `codesFor` reports it, and the game keeps
   * responding to the OLD key while `preventDefault` is applied to neither. A
   * screenshot of the settings screen is perfect. Nothing is red.
   */
  'stale-index',
  /**
   * `labelForCode` returns the raw `KeyboardEvent.code` for every input.
   *
   * A physical position printed where a human expects a character: the
   * controls panel says `KeyW`, `Digit1`, `BracketLeft`. It renders, it lines
   * up, and it is wrong: an id is a programmer's word, and putting one in front
   * of a player is a defect.
   */
  'raw-code-labels',
];

/**
 * Which fault is active, or null.
 *
 * ONE AT A TIME, deliberately. Two faults at once make an attribution
 * ambiguous, and *"a fault going red proves the DETECTOR is live, never that
 * the TRACE is the named case"* is already the weakest link in a fault run.
 */
export function activeInputFault(): string | null {
  const env = typeof process !== 'undefined' && process.env ? process.env.HOMIE_INPUT_FAULT : undefined;
  if (typeof env === 'string' && env !== '') return env;
  const loc = typeof location !== 'undefined' ? location.search : '';
  const m = /(?:\?|&)inputFault=([a-z-]+)/.exec(loc);
  return m ? m[1]! : null;
}

/**
 * Is this named fault active?
 *
 * THROWS on a name that is not in the table. A fault anchored on a symbol that
 * no longer exists must fail LOUDLY — five rotted silently on a previous
 * project and those harnesses validated nothing while reporting green.
 */
export function inputFaultActive(name: string): boolean {
  if (!INPUT_FAULTS.includes(name)) {
    throw new Error(`inputFaultActive: ${JSON.stringify(name)} is not a declared fault — the anchor has rotted`);
  }
  return activeInputFault() === name;
}
