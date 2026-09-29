/**
 * ============================================================================
 *  staging — stand somewhere the crowd is not on the subject's silhouette.
 * ============================================================================
 *
 *  A close pose derived from the subject alone — "its heading plus two hundred
 *  degrees" — decides whether a second figure lands on the subject's outline by
 *  accident, and in a crowd it lands there about half the time. The measured
 *  failure reads as "the two figures overlap almost exactly, and the rear one's
 *  head, shoulder and torso merge into the front one's silhouette, producing a
 *  confused two-headed mass at thumbnail size".
 *
 *  ── HOW IT PICKS ───────────────────────────────────────────────────────────
 *
 *  A lens at `dist` from the subject on bearing `b` sees a neighbour at world
 *  offset (dx, dz) at a horizontal angle off the view axis of
 *
 *      atan2( (P - eye) . right,  (P - eye) . forward )
 *
 *  and the subject fills roughly `atan(halfWidth / dist)` either side of the
 *  axis. A neighbour is "on the silhouette" when its angle is inside about
 *  `bandK` times that, and the score to maximise is the SMALLEST such angle
 *  over every neighbour inside the overlap radius. Ties break toward the
 *  smallest offset, so an empty scene gets the first rung of the ladder and the
 *  ladder only moves when something is actually in the way. Both signs are
 *  offered because a pair standing shoulder to shoulder is clear from one side
 *  and merged from the other, and there is no way to know which without asking.
 *
 *  The separation is CLAMPED before it is scored: past `sepCapK` subject-widths
 *  a neighbour is simply not on the silhouette any more and a further degree
 *  buys nothing, so the tie-break decides rather than the ladder running to its
 *  end.
 *
 *  ── IT IS NOT "HIDE THE OTHERS" ────────────────────────────────────────────
 *
 *  Overlap is depth and a crowd is the point. What must not happen is an
 *  overlap the eye cannot separate; a neighbour more than about `bandK`
 *  shoulder-widths off axis is the other thing.
 *
 *  ── THE KEY PREFERENCE IS OPTIONAL AND OFF BY DEFAULT ──────────────────────
 *
 *  Given a key azimuth and the subject's heading, a small bonus pulls the pick
 *  toward the sun-side three-quarter — enough to break a tie, not enough to
 *  beat an occlusion. Pass `keyAzDeg` or `headingDeg` as NaN (night, or a
 *  subject with no facing) and the term is skipped entirely rather than
 *  contributing a quiet zero.
 *
 *  ── EVERY NUMBER IS THE CALLER'S ───────────────────────────────────────────
 *
 *  There is no default ladder, no default shoulder width and no default radius.
 *  A shoulder span is a fact about one game's figures and an overlap radius is
 *  a fact about its focal lengths; a package that shipped either would compose
 *  the next game's crowd around this one's.
 */

/**
 * A neighbour, read positionally. Same shape `subject.ts`'s pickers read, so a
 * game hands one field to all three.
 */
export interface StagingNeighbour {
  position: { x: number; z: number };
}

/** Every number the solve uses. None of them has a default. */
export interface StagingTuning {
  /** Half the subject's width across the shoulders, world units. */
  halfWidthM: number;
  /** Multiplier on the subject's half-angle that counts as "on the silhouette". */
  bandK: number;
  /** Separation is clamped to this many subject half-angles before scoring. */
  sepCapK: number;
  /** Score penalty per degree of offset, so ties break toward the first rung. */
  tiePenaltyPerDeg: number;
  /** Squared radius below which a neighbour is the subject itself. */
  selfSq: number;
  /** Squared radius past which a neighbour cannot overlap at this focal length. */
  reachSq: number;
  /** Score bonus at a perfect sun-side three-quarter. 0 disables the term. */
  keyBonus: number;
}

/**
 * The bearing offset, in degrees, to add to `baseDeg`. Always one of
 * `offsetsDeg`; never empty-handed.
 *
 * `neighbours` is walked once per rung and nothing is allocated. `accept` is
 * called on each one so a caller can filter by kind without building an array
 * — return false for anything that is not a body the lens can trip over.
 */
export function pickStagingOffset<T extends StagingNeighbour>(
  subject: { x: number; z: number },
  baseDeg: number, dist: number,
  offsetsDeg: readonly number[],
  neighbours: readonly T[],
  accept: (n: T) => boolean,
  keyAzDeg: number, headingDeg: number,
  o: StagingTuning,
): number {
  const first = offsetsDeg[0];
  if (first === undefined) return 0;
  if (neighbours.length === 0) return first;
  // Half the subject's angular width, radians, widened into the band that
  // counts as an unreadable overlap.
  const halfSubject = Math.atan(o.halfWidthM / Math.max(0.5, dist)) * o.bandK;
  let bestOff = first;
  let bestScore = -Infinity;
  for (const off of offsetsDeg) {
    const b = (baseDeg + off) * Math.PI / 180;
    const fx = Math.sin(b), fz = Math.cos(b);
    // Camera right — forward rotated minus ninety about +Y. Same relation
    // `frame.ts` states once for the whole package.
    const rx = -Math.cos(b), rz = Math.sin(b);
    const ex = subject.x - fx * dist, ez = subject.z - fz * dist;
    let worst = Math.PI;
    for (const a of neighbours) {
      if (!accept(a)) continue;
      const sx = a.position.x - subject.x, sz = a.position.z - subject.z;
      const near = sx * sx + sz * sz;
      if (near < o.selfSq || near > o.reachSq) continue;   // itself, or too far
      const px = a.position.x - ex, pz = a.position.z - ez;
      const along = px * fx + pz * fz;
      if (along <= 0) continue;                            // behind the lens
      const ang = Math.abs(Math.atan2(px * rx + pz * rz, along));
      if (ang < worst) worst = ang;
    }
    const sep = Math.min(worst, halfSubject * o.sepCapK);
    let score = sep - Math.abs(off) * o.tiePenaltyPerDeg;
    if (Number.isFinite(keyAzDeg) && Number.isFinite(headingDeg)) {
      const want = keyAzDeg - headingDeg;
      const d = (off - want) * Math.PI / 180;
      score += o.keyBonus * Math.cos(d);
    }
    if (score > bestScore) { bestScore = score; bestOff = off; }
  }
  return bestOff;
}
