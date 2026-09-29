/**
 * ============================================================================
 *  planar — the two questions a game asks about a point and a line on the
 *  ground plane, and nothing else.
 * ============================================================================
 *  Extracted from a base-building game's audio and network code, where the
 *  same two expressions were written twice in one game — once to decide how
 *  loud a transit tube is when the camera is beside it, once to decide whether
 *  two cable ends are the same joint.
 *
 *  An earlier note in that game's audio code named this move and then declined
 *  it: *"plain geometry and belongs in @homie-rocks/geom; it is left because
 *  moving one 17-line function into a package whose nine modules all make
 *  TRIANGLES would be putting it on the wrong shelf, and the right shelf does
 *  not exist yet."* This is the shelf. The reason it is a separate module
 *  rather than a couple of exports bolted onto `prim.ts` is exactly that
 *  argument: everything else in this package emits vertex buffers, and a file
 *  that emits none should not have to be read past to find one that does.
 *
 *  ── THE PLANE IS XZ, AND THE NAMES SAY SO ──────────────────────────────────
 *  Every consumer of this so far is a world with a ground under it, where the
 *  interesting plane is the one you walk on and `y` is up. Spelling the
 *  arguments `x, z` rather than `x, y` costs a reader nothing and stops the
 *  silent transposition that a `Vector2`-shaped signature invites. A caller
 *  working in screen space passes its own pair; the arithmetic does not care.
 *
 *  ── SQUARED WHERE IT CAN BE ────────────────────────────────────────────────
 *  `dist2` exists because the overwhelming majority of call sites compare
 *  against a threshold, and comparing squares avoids a `sqrt` per pair in the
 *  O(n²) sweeps that a network rebuild and a broadphase both are. Callers that
 *  genuinely need metres take the root themselves, once.
 *
 *  Imports nothing — not even `three`. A plain Node script can reproduce a
 *  world's connectivity with it.
 * ============================================================================
 */

/**
 * A point part-way along a polyline. `followPolyline` reads it and writes it.
 *
 * IT IS DELIBERATELY NOT A `Vector3`. Every caller so far keeps its position in
 * something else — a `THREE.Vector3` on a scene node, a struct-of-arrays, a
 * flat buffer — and taking a vendor type here would make this module the
 * second copy of `three` in a test that only wanted to know where a rover
 * gets to. Four numbers in, four numbers out; the caller owns the marshalling
 * and owns the Y.
 */
export interface Traveller {
  /** index of the NEXT vertex on the path, not the last one reached */
  i: number;
  x: number; z: number;
  /** radians, `atan2(dx, dz)` — Z-forward, which is a three.js `rotation.y` */
  heading: number;
}

/**
 * Advance `t` along the flat [x, z, …] polyline `path` by up to `budget`
 * metres, consuming vertices as it passes them. Returns true when it ran out
 * of path rather than out of budget.
 *
 * ── WHY THE BUDGET IS A LENGTH AND NOT A SPEED AND A dt ────────────────────
 * Because the caller's speed is not constant across a frame in any game that
 * has terrain, congestion or a battery in it, and a follower that took `speed`
 * and `dt` would be quietly claiming otherwise. One number of metres is the
 * honest interface: whatever the caller decided this frame is worth, spend it.
 *
 * ── HEADING IS WRITTEN ON EVERY LEG, INCLUDING CONSUMED ONES ────────────────
 * A walker that crosses three short vertices in one frame ends up facing along
 * the LAST leg it touched, not the first. Writing the heading only on the
 * partial step leaves a figure moonwalking through every tight corner — it is
 * translating along a leg it is not facing — and that reads as a rendering
 * fault rather than as motion.
 *
 * ── THE 1e-4 SKIP IS NOT AN OPTIMISATION ───────────────────────────────────
 * A duplicated vertex — two path points at the same place, which every graph
 * that welds endpoints produces at a junction — has no direction, so
 * `atan2(0, 0)` would snap the heading to zero and the figure would spin to
 * face north for one frame in the middle of a corner. Skipping it costs
 * nothing and there is no distance in it to spend.
 *
 * ── ONE EXCEPTION, AND IT IS CARRIED ON PURPOSE ─────────────────────────────
 * Landing exactly ON the final vertex leaves the heading at whatever the
 * PREVIOUS leg set. The original source did that and this reproduces it float
 * for float, because a follower that quietly starts turning on arrival is a
 * behaviour change and behaviour changes get their own change and their own
 * before-and-after. It is also, in the one game that has run it, harmless:
 * every caller that cares points the figure at its work on arrival anyway. A
 * caller that does not should set its own heading when this returns true.
 */
export function followPolyline(
  path: readonly number[], t: Traveller, budget: number,
): boolean {
  let left = budget;
  let arrived = false;
  while (left > 0) {
    if (t.i * 2 >= path.length) { arrived = true; break; }
    const tx = path[t.i * 2], tz = path[t.i * 2 + 1];
    const dx = tx - t.x, dz = tz - t.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-4) { t.i++; continue; }
    if (d <= left) {
      t.x = tx; t.z = tz;
      left -= d;
      t.i++;
      if (t.i * 2 >= path.length) { arrived = true; break; }
    } else {
      const inv = left / d;
      t.x += dx * inv;
      t.z += dz * inv;
      left = 0;
    }
    t.heading = Math.atan2(dx, dz);
  }
  return arrived;
}

/** Squared distance between two points in the XZ plane. No `sqrt`. */
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * Distance from p to the nearest point ON the segment a–b, in the XZ plane.
 *
 * A DEGENERATE SEGMENT — both ends within 1e-6 of each other in SQUARED
 * metres, i.e. a millimetre apart — projects to `t = 0` rather than dividing
 * by it, so a zero-length cable stub answers "the distance to the a end"
 * instead of NaN. That guard is not decoration: NaN here does not throw, it
 * propagates into a gain node and silences a voice, or into a proximity test
 * and disconnects a grid, with nothing logged anywhere.
 */
export function distToSegment(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): number {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-6 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}
