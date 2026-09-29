/**
 * ── THE JITTER SEQUENCE, ADDRESSABLE ────────────────────────────────────────
 *
 * A temporal resolve offsets the projection by a sub-pixel amount every frame
 * and accumulates the results, so over one cycle the pixel is sampled at N
 * well-spread positions instead of one. Halton is the standard low-discrepancy
 * sequence for it.
 *
 * The reason this is a module rather than a private function inside one game's
 * `PostFX.ts` is the word ADDRESSABLE. One space racer's post-processing module
 * puts it best, at the point where it separates the two callers:
 *
 *   > `nextJitter` asks "where are we?", and a capture has to be able to say
 *   > "position 3".
 *
 * A sequence that can only be advanced is reproducible if and only if the
 * compositor cooperates about how many times it advanced, which is exactly the
 * class of bug `Capture.ts` exists to remove. Everything here is a pure
 * function of its index; there is no state in this file at all.
 */

/**
 * Radical-inverse base-`b` Halton. Returns a number in [0, 1).
 *
 * Index 0 returns exactly 0 in EVERY base, which is why `jitterAt` below offsets
 * by one.
 *
 * That racer's own note calls index 0 *"a sample exactly at the pixel centre
 * with no offset"*. **That sentence is wrong and the guard it justifies is
 * right for a different reason.** `jitterAt` recentres on [-0.5, +0.5), so
 * index 0 lands on (-0.5, -0.5): not the centre, the CORNER, the single point
 * of the pixel footprint that four neighbouring pixels share. It is also the
 * only position whose x and y are equal by construction rather than by the
 * sequence, which is precisely the correlation a low-discrepancy sequence
 * exists to avoid. Measured over an eight-long cycle: with the offset, the mean
 * of the eight y-offsets is exactly 0; without it, one sample sits on the
 * corner and the mean drifts to -0.1111, i.e. the cycle is no longer centred on
 * the pixel it is meant to be sampling.
 */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * The x/y sub-pixel offset, in PIXELS, at an explicit position of a `count`-long
 * cycle. Range is [-0.5, +0.5) on each axis.
 *
 * `out` is written in place and returned. It is typed structurally as
 * `{ x: number; y: number }` and not as a `THREE.Vector2` on purpose: a
 * `Vector2` satisfies it, so a game passes its own allocation-free scratch
 * vector straight in, and this package does not have to import `three` to
 * describe two numbers. Writing into a caller-owned object is the one kind of
 * mutation worth allowing inside a frame loop — this is called once
 * per drawn frame, and per-frame allocation at 60 Hz is a GC pause a person
 * can see.
 *
 * The index is normalised into the cycle rather than asserted, because the live
 * caller advances with `(frame + 1) % count` and the capture caller passes a
 * literal — a modulo that is correct for negative inputs is cheaper than two
 * call sites each remembering.
 */
export function jitterAt(
  index: number,
  count: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  if (!Number.isFinite(count) || count < 1) {
    throw new RangeError(`@homie-rocks/postfx: jitter cycle length must be >= 1, got ${count}`);
  }
  const n = Math.floor(count);
  const i = ((Math.floor(index) % n) + n) % n;
  // ONE PLACE, so the two axes cannot drift apart and so the reason above has
  // exactly one line to be attached to. See `halton`: index 0 of the raw
  // sequence is the origin in every base, and after the recentring below that
  // is the footprint's shared corner.
  const s = i + 1;
  out.x = halton(s, 2) - 0.5;
  out.y = halton(s, 3) - 0.5;
  return out;
}

/**
 * Normalises an index into the cycle, so a pass that keeps its own `frame`
 * counter and this file agree about what "position 3" means.
 */
export function jitterIndex(index: number, count: number): number {
  const n = Math.max(1, Math.floor(count));
  return ((Math.floor(index) % n) + n) % n;
}
