/**
 * ============================================================================
 *  chainAlongRay — a string of things thrown out from one point in one
 *  direction.
 * ============================================================================
 *
 *  The pattern: something happened HERE, and it strewed a handful of smaller
 *  somethings along a bearing, spaced out with a bit of jitter and fanning
 *  slightly as they go. Secondary craters along an ejecta ray, debris down a
 *  scree chute, wreckage along a crash line, bullet spall off an impact,
 *  footprints down a desire path made by somebody in a hurry.
 *
 *  What makes it read as a CONSEQUENCE rather than as a sprinkle is three
 *  things at once, and a caller that writes it inline usually gets two:
 *
 *    · they start at a STANDOFF, not at the origin — nothing lands on top of
 *      the thing that threw it;
 *    · the spacing is parametric in the source's own size, so a big source
 *      throws further;
 *    · the angular spread is SMALL. A wide fan is a sprinkle again.
 *
 *  ── THE DRAW ORDER IS PART OF THE CONTRACT ─────────────────────────────────
 *
 *  Two numbers come off the caller's stream per link and they come off in THIS
 *  order: the distance jitter first, the angular spread second. A caller
 *  adopting this from its own inline loop gets the same world only if the order
 *  matches, and it is the sort of thing that is invisible to review and obvious
 *  in a capture — which is why it is written down rather than implied.
 *
 *  Every number is the caller's. `standoff`, `span`, `jitter` and `spread` are
 *  what decide whether the result reads as a ray, a chute or a shotgun, and
 *  there are no defaults to inherit by accident. Numbers in, numbers out, no
 *  `three`.
 * ============================================================================
 */

/** The shape of the throw, in units of the source's own reach. */
export interface ChainThrow {
  /** Distance of the first link, as a multiple of the source's reach. */
  standoff: number;
  /** How much further the last link is than the first, same units. */
  span: number;
  /** Uniform jitter added to each link's distance, same units. */
  jitter: number;
  /** Full width of the angular fan, radians. Each link draws inside it. */
  spread: number;
}

/**
 * @param x,z     the source.
 * @param reach   the source's own size — every distance below is a multiple.
 * @param ray     bearing of the throw, radians, in the caller's own convention.
 * @param n       links.
 * @param rng     the caller's stream. TWO draws per link — see the header.
 * @param cb      one link: its position, the bearing it actually landed on,
 *                and its index. Returning nothing; the caller decides what a
 *                link IS, and this never allocates one.
 */
export function chainAlongRay(
  x: number, z: number, reach: number, ray: number, n: number,
  t: ChainThrow, rng: () => number,
  cb: (sx: number, sz: number, ang: number, j: number) => void,
): void {
  for (let j = 0; j < n; j++) {
    const d = t.standoff + (j / n) * t.span + rng() * t.jitter;
    const ang = ray + (rng() - 0.5) * t.spread;
    cb(x + Math.cos(ang) * reach * d, z + Math.sin(ang) * reach * d, ang, j);
  }
}
