/**
 * ============================================================================
 *  trailStep — has this thing moved far enough to leave another mark?
 * ============================================================================
 *
 *  `allowance.ts` in this package answers "can we AFFORD another mark". This is
 *  the question in front of it: should there be one at all. Every persistent
 *  ground layer — wheel ruts, ski tracks, a wake, a scent line, a dotted route
 *  on a map — anchors at the last mark and lays a segment when the mover has
 *  travelled far enough from it.
 *
 *  Three answers, not two, and the third is the one that is easiest to leave
 *  out.
 *
 *  ── THE JUMP ───────────────────────────────────────────────────────────────
 *
 *  A mover does not only move by moving. It is re-seated when a scenario
 *  re-seeds, teleported when it is reassigned, snapped onto a racing line,
 *  respawned.
 *  A trail that only asks "far enough?" answers yes to all of those and draws a
 *  straight line across the whole world — through buildings, over water, along
 *  a path nothing ever took. So past some multiple of the step the answer is
 *  "re-anchor and lay NOTHING", which is a different answer from both of the
 *  other two and cannot be folded into either.
 *
 *  ── THE RETURN IS A LENGTH, AND THAT IS NOT A CONVENIENCE ──────────────────
 *
 *  A caller charging a budget has to charge what the segment COSTS, and the
 *  cost of a swept band is proportional to its length. The alternative — one
 *  unit per segment — was measured on a real ground layer: eight vehicles
 *  spent 150 quads a second against a budget that believed it was spending
 *  eight, and filled a 9,000-quad ring in twenty simulated seconds. A world
 *  that erases its own history the moment you play it. Handing the length back
 *  means the caller cannot accidentally not know it.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the three answers and the jump test. The caller's: the step, the
 *  jump multiple, what a mark IS, whether this particular ground will take one,
 *  and what a metre of it costs. Numbers in, one number out. Imports nothing.
 * ============================================================================
 */

/**
 * @param ax,az    the last anchor.
 * @param x,z      where the mover is now.
 * @param step     how far it must have come before a segment is laid.
 * @param jumpK    multiples of `step` past which this is a teleport, not a
 *                 journey. A caller with a hard speed limit could compute this
 *                 from dt instead and should; `jumpK` is for the common case
 *                 where the trail does not know the frame time.
 * @returns  0    — not far enough. KEEP the anchor.
 *           -1   — a jump. RE-ANCHOR and lay nothing.
 *           d>0  — lay a segment of this length, then re-anchor.
 */
export function trailStep(
  ax: number, az: number, x: number, z: number, step: number, jumpK: number,
): number {
  const dx = x - ax, dz = z - az;
  const d2 = dx * dx + dz * dz;
  // ── A NaN POSITION COMES BACK AS NaN, AND THAT IS THE ANSWER ─────────────
  // Both comparisons are false against NaN, so a mover whose position has gone
  // bad falls through both and is handed back a NaN length. That is
  // deliberate and it is what the games this came out of already did.
  // Substituting 0 — "not far enough yet", the comfortable-looking default —
  // would be a health check that always says healthy: a broken mover would
  // report as a stationary one forever and nothing would ever say why. A NaN
  // length fails the caller's own range and budget tests, so no mark is laid
  // and the anchor is kept, and the NaN is still there to be found.
  if (d2 < step * step) return 0;
  const jump = step * jumpK;
  if (d2 > jump * jump) return -1;
  return Math.sqrt(d2);
}
