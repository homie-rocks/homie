/**
 * ============================================================================
 *  bayLoad — fill a rectangular bay from one end, deterministically, from a
 *  single seed.
 * ============================================================================
 *
 *  A flatbed with crates in it, a shelf with boxes on it, a rack of barrels, a
 *  pallet, a hold, a wheelbarrow. The arrangement is always the same shape:
 *  items laid ALONG the bay starting at one end, each one wandering across the
 *  bay by however much room its own size leaves, each a slightly different
 *  scale, each turned a few degrees off square.
 *
 *  ── FROM THE END, NOT FROM THE MIDDLE, AND IT IS THE WHOLE READ ────────────
 *
 *  A partial load sits against the tailgate the way a real one does. Centring
 *  it — which is what a "spread n items over the bay" loop does — puts a single
 *  crate floating in the middle of an empty tray, which reads as a prop that
 *  was placed rather than cargo that was loaded.
 *
 *  ── A SEED, NOT AN RNG, AND THAT IS THE POINT ──────────────────────────────
 *
 *  It takes a NUMBER and hashes it, rather than drawing from a stream. A load
 *  is a property of the vehicle carrying it, so it must not depend on how many
 *  other vehicles were built first, and it must be the same in two captures of
 *  the same scenario however the rest of the world was seeded. Two decorrelated
 *  values per item come out of one seed; the multipliers are the HASH and are
 *  deliberately not parameters — a caller varying them would be reaching for a
 *  different arrangement, which is what the seed is for.
 *
 *  ── ITS OWN SIZE DECIDES ITS OWN ROOM ──────────────────────────────────────
 *
 *  The cross-bay wander is clamped to `halfW - halfX * scale - inset`, floored
 *  at zero, so a scaled-up item does not hang over the side and an item wider
 *  than the bay sits dead centre instead of producing a negative range and
 *  flipping to the far side. That clamp is the one line that stops a load
 *  looking spilled.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the hash, the from-the-end stacking, the accumulating pitch, the
 *  clamp. The caller's: how many, how big the bay is, how big an item is, how
 *  much it may grow, how much gap, how far it may turn, and what an item IS.
 *  Numbers in, numbers out, no `three`, nothing imported.
 * ============================================================================
 */

/** The fractional part, for positive and negative alike. */
const fract = (x: number): number => x - Math.floor(x);

/**
 * Lay `n` items along a bay.
 *
 * @param seed   the CARRIER's seed. Hashed twice per item.
 * @param z0     the closed end of the bay, in the carrier's local frame. Item
 *               0's near face sits here.
 * @param halfW  half the bay's usable width.
 * @param halfX  half an item's width at scale 1.
 * @param halfZ  half an item's depth at scale 1.
 * @param inset  clearance kept between an item and the bay wall.
 * @param gap    smallest space between two items, along the bay.
 * @param gapJit how much more the same draw may add. It is the SAME draw as
 *               the scale, on purpose: a bigger crate wants a bigger gap and
 *               a second hash would decorrelate them into a ragged load.
 * @param scale0 smallest item scale.
 * @param scaleK how much larger it may be.
 * @param yawJit full width of the per-item turn, radians.
 * @param cb     local across-bay offset, local along-bay offset, scale, turn.
 */
export function bayLoad(
  seed: number, n: number,
  z0: number, halfW: number, halfX: number, halfZ: number, inset: number,
  gap: number, gapJit: number, scale0: number, scaleK: number, yawJit: number,
  cb: (lx: number, lz: number, scale: number, yaw: number, i: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    const a = fract(seed * (7.31 + i * 3.17));
    const b = fract(seed * (11.79 + i * 5.91));
    const sc = scale0 + a * scaleK;
    const lz = z0 + halfZ * sc + i * (2 * halfZ * sc + gap + a * gapJit);
    const lx = (b - 0.5) * 2 * Math.max(0, halfW - halfX * sc - inset);
    cb(lx, lz, sc, (b - 0.5) * yawJit, i);
  }
}
