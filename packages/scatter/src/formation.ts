/**
 * ============================================================================
 *  Formations — several bodies standing as ONE thing, not N samples of a disc.
 * ============================================================================
 *
 *  Every crowd in the games this came from started as a sampler: pick a point,
 *  put a body on it, repeat. A blind review's verdict on that was "figures
 *  scattered on open ground at roughly uniform density, facing arbitrary
 *  directions, going nowhere", and every one of those words is a property of
 *  the SAMPLER rather than of the figure. A crowd reads as a crowd when its
 *  members are arranged into groups whose SHAPE says what the group is doing,
 *  and there turn out to be exactly four shapes that carry almost all of it.
 *
 *  ── THE FOUR ───────────────────────────────────────────────────────────────
 *
 *   · `fileAlong`   n bodies strung out along a bearing, all facing down it,
 *                   with a few decimetres of lateral wander so the line is a
 *                   line of people and not a ruler. Anything moving: a stream of
 *                   commuters, a column on a trail, a procession, a queue of
 *                   animals on a game path.
 *   · `arcFacing`   n bodies on ONE SIDE of an anchor, every one of them turned
 *                   toward it. NOT a ring — a crew works a face, it does not
 *                   surround it, and a full ring reads as a seance. The span
 *                   and the wobble are what stop it reading as a compass rose.
 *   · `queueFrom`   n bodies radiating outward from a radius at a rough
 *                   spacing, each stood off the previous one's shoulder so it
 *                   can see the front, all facing in. A door, a counter, a
 *                   ticket window, a water hole.
 *   · `fileBetween` n bodies in file along the segment joining two anchors,
 *                   alternating to either side of the line. Cargo visibly
 *                   moving from an origin to a destination — which is the
 *                   cheapest "these people have business here" cue there is,
 *                   because it names both ends.
 *
 *  ── DRAW ORDER IS PART OF THE CONTRACT, AND IT IS WHY `rng` IS A PARAMETER ─
 *
 *  A seeded world rebuilds identically only if every consumer of the stream
 *  draws the same number of times in the same order. Each function below
 *  states its draws per body and the order they happen in; the callback is
 *  invoked AFTER them, so a caller is free to draw again inside it (for a job,
 *  a colour, a flag) without moving anything already placed. Reordering the
 *  draws inside one of these is a behaviour change to every world that uses
 *  it, however identical the arithmetic looks.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the arrangement, the facing, the wander, and the draw order.
 *  The caller's: how many, how far apart, how wide the arc, which way is
 *  "toward the lens", and absolutely everything a body then IS. Nothing here
 *  knows about a job, a crate, a species or a road.
 *
 *  Numbers in, numbers out, no `three`, no allocation, nothing imported.
 * ============================================================================
 */

/** One placed body: where it stands, which way it looks, and its index. */
export type PlaceCb = (x: number, z: number, yaw: number, i: number) => void;

/**
 * `n` bodies along a bearing, evenly spaced, wandering laterally.
 *
 * The lateral basis is passed IN rather than derived from the direction,
 * because the two are not always the same thing: a file walking against the
 * traffic on a two-way road travels along `-d` but wanders across the road's
 * own normal, and deriving the normal from the direction of travel would flip
 * the wander with the direction and make the two directions mirror each other.
 *
 * @param x0     the first body's centreline origin — the caller folds in any
 *               sideways offset, so this stays a pure "walk the line".
 * @param dx,dz  unit direction of travel. Yaw is `atan2(dx, dz)` for all of
 *               them: a file faces where it is going.
 * @param lx,lz  the lateral basis the wander is applied along, as `+lx, -lz`.
 * @param n      how many.
 * @param gap    spacing between neighbours, along the bearing.
 * @param start  where body 0 sits relative to the origin. Negative half the
 *               run centres the file on it.
 * @param wander full width of the lateral jitter.
 * @param rng    drawn ONCE per body, before `cb`.
 */
export function fileAlong(
  x0: number, z0: number,
  dx: number, dz: number,
  lx: number, lz: number,
  n: number, gap: number, start: number, wander: number,
  rng: () => number, cb: PlaceCb,
): void {
  const yaw = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const s = start + gap * i;
    const j = (rng() - 0.5) * wander;
    cb(x0 + dx * s + lx * j, z0 + dz * s - lz * j, yaw, i);
  }
}

/**
 * `n` bodies on an arc round `(ax, az)`, all facing it.
 *
 * The arc is centred on `a0` and spans `span` radians TOTAL, so the first and
 * last bodies sit at `a0 ± span/2`; a single body sits exactly on `a0`. The
 * per-body wobble is added on top so the arrangement is not visibly regular.
 *
 * @param a0     the bearing the crew works from. The caller draws it.
 * @param span   total angular width. Narrow is the point: four people round a
 *               weld stand inside a quadrant, and a span near TAU is a ring.
 * @param wobble full width of the per-body bearing jitter.
 * @param rMin   nearest a body stands to the anchor.
 * @param rSpan  how much further out it may be.
 * @param rng    drawn TWICE per body — bearing wobble, then radius, in that
 *               order — before `cb`.
 */
export function arcFacing(
  ax: number, az: number,
  n: number, a0: number, span: number, wobble: number,
  rMin: number, rSpan: number,
  rng: () => number, cb: PlaceCb,
): void {
  for (let i = 0; i < n; i++) {
    const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * span : 0) + (rng() - 0.5) * wobble;
    const r = rMin + rng() * rSpan;
    const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
    cb(x, z, Math.atan2(ax - x, az - z), i);
  }
}

/**
 * `n` bodies strung outward from `(sx, sz)` along the bearing `(cx, cz)`,
 * all facing back down it.
 *
 * The spacing is jittered PER GAP and accumulates, which is what a real queue
 * does — the person at the back is where the seven gaps in front of them put
 * them, not at a nominal seven times the pitch. The lateral offset is what
 * stops it being a single file: people stand off each other's shoulders so
 * they can see the front.
 *
 * @param r0      distance from the anchor to body 0.
 * @param gap     nominal spacing.
 * @param gapJit  extra spacing available to each gap.
 * @param lateral full width of the shoulder offset.
 * @param yaw0    the inbound bearing, `atan2(-cx, -cz)` at almost every call.
 * @param yawJit  full width of the per-body facing jitter.
 * @param rng     drawn THREE times per body — gap, lateral, facing, in that
 *                order — before `cb`.
 */
export function queueFrom(
  sx: number, sz: number,
  cx: number, cz: number,
  n: number, r0: number, gap: number, gapJit: number, lateral: number,
  yaw0: number, yawJit: number,
  rng: () => number, cb: PlaceCb,
): void {
  for (let i = 0; i < n; i++) {
    const r = r0 + i * (gap + rng() * gapJit);
    const lat = (rng() - 0.5) * lateral;
    cb(sx + cx * r - cz * lat, sz + cz * r + cx * lat, yaw0 + (rng() - 0.5) * yawJit, i);
  }
}

/**
 * `n` bodies in file along the line from `(ax, az)` in direction `(ux, uz)`,
 * starting at arc distance `at`, alternating to either side of it.
 *
 * The alternation is `i & 1`, deterministic and not drawn: a pair carrying
 * something between them is on opposite sides of the load, and a coin flip
 * there produces two people walking in each other's way. The MAGNITUDE of the
 * offset is drawn, so the pair is not a perfect mirror.
 *
 * @param at      where body 0 sits along the line, in the same units as `gap`.
 * @param latMin  smallest offset from the line.
 * @param latSpan how much more it may be.
 * @param rng     drawn ONCE per body, before `cb`.
 */
export function fileBetween(
  ax: number, az: number,
  ux: number, uz: number,
  n: number, at: number, gap: number, latMin: number, latSpan: number,
  rng: () => number, cb: PlaceCb,
): void {
  const yaw = Math.atan2(ux, uz);
  for (let i = 0; i < n; i++) {
    const s = at + gap * i;
    const lat = (i & 1 ? 1 : -1) * (latMin + rng() * latSpan);
    cb(ax + ux * s - uz * lat, az + uz * s + ux * lat, yaw, i);
  }
}
