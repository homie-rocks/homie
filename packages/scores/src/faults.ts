/**
 * ============================================================================
 *  Deliberate faults, so a green run means something.
 * ============================================================================
 *  The same shape `@homie-rocks/racing` and `@homie-rocks/arcade` use in
 *  their `faults.ts`, down to the `HOMIE_<PKG>_FAULT` environment name,
 *  because another convention for the same idea is another thing a reader has
 *  to learn. A harness injects each of these and requires an EXACT set of
 *  checks to redden — too few and the detector detects nothing, too many and
 *  one detector is wearing several names.
 *
 *  WHY THIS PACKAGE NEEDED ONE. Faults can also be injected by rewriting a
 *  line in a copy of `dist/`, which works. But the two defects `Run.ts` is
 *  written against cannot be reached that way from a GAME's side: whether a
 *  keyboard seat is coerced, and whether a refusal is said out loud, are both
 *  invisible in the result and perfect on the screen. A fault injected from
 *  outside would have proved the probe can see a bug the product cannot have.
 * ============================================================================
 */

export const SCORES_FAULTS: readonly string[] = [
  /**
   * `attributable` answers seat 0 for a keyboard seat.
   *
   * Seat 0 is a legitimate seat id, so the guess is indistinguishable from a
   * real result on the board afterwards: somebody's name on an evening they
   * were not in the room for, and the board looks completely fine.
   */
  'seat-guessed',
  /**
   * `RunBoard` collects its refusals and never says one.
   *
   * The concrete defect: a host with no leaderboard grant refuses every write,
   * the game shows a board with nobody on it, and *"nobody has played this
   * yet"* is exactly what *"nothing has ever been recorded"* looks like.
   */
  'silent-refusal',
];

/**
 * Which fault is active, or null.
 *
 * ONE AT A TIME, deliberately. Two faults at once make an attribution
 * ambiguous, and a fault going red proves the DETECTOR is live rather than
 * that the trace is the named case.
 */
export function activeScoresFault(): string | null {
  const env = typeof process !== 'undefined' && process.env ? process.env.HOMIE_SCORES_FAULT : undefined;
  if (typeof env === 'string' && env !== '') return env;
  const loc = typeof location !== 'undefined' ? location.search : '';
  const m = /(?:\?|&)scoresFault=([a-z-]+)/.exec(loc);
  return m ? m[1]! : null;
}

/**
 * Is this named fault active?
 *
 * THROWS on a name that is not in the table. A fault anchored on a symbol that
 * no longer exists must fail LOUDLY; otherwise it rots silently while its
 * harness reports green.
 */
export function scoresFaultActive(name: string): boolean {
  if (!SCORES_FAULTS.includes(name)) {
    throw new Error(`scoresFaultActive: ${JSON.stringify(name)} is not a declared fault — the anchor has rotted`);
  }
  return activeScoresFault() === name;
}
