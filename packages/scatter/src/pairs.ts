/**
 * ============================================================================
 *  pairNearest — join things up in twos, nearest first, nothing used twice.
 * ============================================================================
 *
 *  Given a bag of anchor points, string something BETWEEN pairs of them: a
 *  washing line between two balconies, a power cable between two poles, a
 *  bunting run between two masts, a hose between two couplings, a tow between
 *  two hardpoints. The rule that makes it look deliberate rather than random
 *  is not the geometry of the thing strung — it is the matching:
 *
 *    · each anchor is used AT MOST ONCE, so nothing is a hub by accident;
 *    · a pair is only made inside a distance BAND — too short and the line has
 *      no sag to read, too long and it crosses the whole scene;
 *    · inside the band the NEAREST available partner wins, which is what makes
 *      the lines look local rather than woven.
 *
 *  This is a greedy match, not an optimal one, and that is deliberate: it is
 *  O(n²) in the anchor count with a tiny constant, it is stable under the
 *  caller's iteration order, and an optimal matching would move every line the
 *  first time somebody added an anchor.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the used-set, the band test, the nearest-wins tie-break and the
 *  cap. The caller supplies the DISTANCE — this never sees a coordinate, so it
 *  works in metres, in screen space or on a sphere — and the band, the cap and
 *  what a line IS are all its own. Draws nothing from an RNG, so it can sit in
 *  the middle of a seeded build without moving anything downstream. Numbers
 *  in, indices out, no `three`.
 * ============================================================================
 */

/**
 * @param n        how many anchors there are.
 * @param dist     distance between anchors i and j. Called O(n²) times.
 * @param minD     a pair closer than this is refused (exclusive).
 * @param maxD     a pair further than this is refused (exclusive).
 * @param maxPairs stop after this many. The loop still ends at `n`.
 * @param cb       one pair, low index first, with the distance that won.
 * @returns how many pairs were made.
 */
export function pairNearest(
  n: number,
  dist: (i: number, j: number) => number,
  minD: number,
  maxD: number,
  maxPairs: number,
  cb: (i: number, j: number, d: number) => void,
): number {
  const used = new Uint8Array(n);
  let pairs = 0;
  for (let i = 0; i < n && pairs < maxPairs; i++) {
    if (used[i]) continue;
    let best = -1;
    let bestD = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const d = dist(i, j);
      if (d > minD && d < maxD && d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) continue;
    used[i] = used[best] = 1;
    pairs++;
    cb(i, best, bestD);
  }
  return pairs;
}
