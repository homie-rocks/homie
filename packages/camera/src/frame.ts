/**
 * ============================================================================
 *  frame — author a layout in a reference camera's frame, not in world XZ.
 * ============================================================================
 *
 *  A shot list is a set of PICTURES. "A lit road sweeping in from bottom-left,
 *  the mass in the midground, the two verticals on the right" is a statement
 *  about the frame, and authoring it in world XZ means iterating a camera
 *  against a plan that was never made for it. So a layout is written as (u, v)
 *  in the reference camera's own frame — u to the right of frame, v into the
 *  screen — and this rotates it into the world. Change the reference bearing
 *  and the whole layout rotates with the shot.
 *
 *  ── WHY THIS IS A PACKAGE AND NOT FOUR LINES IN A GAME ─────────────────────
 *
 *  It is four lines of trigonometry and the trigonometry is not the point. The
 *  point is the SIGN CONVENTION, which was written three times in one game —
 *  in the layout seeder, in a pose builder and in a staging solver — and is
 *  exactly the sort of thing that is right in two copies of three. Screen right
 *  is forward rotated MINUS ninety degrees about +Y, and a bearing is measured
 *  from +Z toward +X so that a pose and a sun azimuth can be reasoned about in
 *  one head. Get either backwards and every position mirrors, which looks like
 *  an art-direction argument rather than a bug.
 *
 *  ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 *
 *  The bearing itself. A reference yaw is a fact about one game's art direction
 *  — it is chosen so the key rakes across the frame and the planet lands in the
 *  gap between two silhouettes — and a package that shipped a default would be
 *  handing the next world somebody else's sun. `frameBasis` takes it and keeps
 *  nothing.
 *
 *  Nothing here allocates and nothing here touches `out.y`: a caller founds the
 *  height on its own terrain, which is the one thing a frame cannot know.
 */

/** A world point with an x and a z. `THREE.Vector3` satisfies it. */
export interface XZ {
  x: number;
  z: number;
}

/** The rotation, precomputed. Build one per reference bearing and keep it. */
export interface FrameBasis {
  /** Into the screen, world x/z. */
  readonly fx: number;
  readonly fz: number;
  /** Screen right, world x/z. */
  readonly rx: number;
  readonly rz: number;
  /**
   * Frame coordinates (u right, v into the screen) into world x/z, written
   * onto `out`. `out.y` is left alone by design.
   */
  toWorld<T extends XZ>(u: number, v: number, out: T): T;
  /**
   * Compass bearing of a frame-space delta, degrees from +Z toward +X — the
   * convention a sun azimuth is usually stated in, so a pose can be given as
   * "the road's bearing plus N".
   */
  bearingDeg(du: number, dv: number): number;
}

/**
 * The basis for a reference camera looking along `yawDeg`, degrees from +Z
 * toward +X.
 */
export function frameBasis(yawDeg: number): FrameBasis {
  const yaw = yawDeg * Math.PI / 180;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  return {
    fx, fz, rx, rz,
    toWorld<T extends XZ>(u: number, v: number, out: T): T {
      out.x = u * rx + v * fx;
      out.z = u * rz + v * fz;
      return out;
    },
    bearingDeg(du: number, dv: number): number {
      return Math.atan2(du * rx + dv * fx, du * rz + dv * fz) * 180 / Math.PI;
    },
  };
}
