/**
 * ============================================================================
 *  Sight — what a height field hides, asked by marching rather than by pixels.
 * ============================================================================
 *
 *  Two questions every outdoor game asks of its ground, and neither is a
 *  question about geometry in a scene graph:
 *
 *    · is anything standing between these two points?
 *    · what fraction of this frustum escapes the ground entirely?
 *
 *  ── WHY NOT READ PIXELS ────────────────────────────────────────────────────
 *
 *  A pixel read cannot run without `preserveDrawingBuffer`, and even with it a
 *  reader has to guess which dark pixels are sky and which are unlit ground.
 *  Both are fatal in a hard-shadowed world with no atmosphere: the correct
 *  answer to "how much sky is in this frame" in a frame that is 96% black is
 *  still a number, and a histogram cannot produce it. A march asks the field
 *  and is right in a black frame, in a headless process, with no GL context.
 *
 *  ── THE STEPPING IS GEOMETRIC AND THAT IS THE WHOLE TRICK ──────────────────
 *
 *  `escapeFraction` spaces its samples as `reach * (i/steps)^curve`. Near the
 *  eye the ground matters at metres and far away it matters at hundreds, so a
 *  LINEAR march spends every sample on the far half and misses the hillock
 *  thirty metres ahead that is actually filling the frame. `curve` is the
 *  caller's, because how fast that transition happens is a property of a
 *  world's scale.
 *
 *  ── NOTHING HERE KNOWS WHAT A CAMERA IS ────────────────────────────────────
 *
 *  `escapeFraction` takes a `rayFor` callback rather than a camera, so this
 *  package stays free of `three` exactly as `Field.ts` and `Horizon.ts` are.
 *  The caller owns the projection — that is where the aspect, the fov and the
 *  quaternion live — and this owns the grid, the stepping and the counting.
 *
 *  A field function may return a non-finite height for ground that is not
 *  loaded yet. BOTH FUNCTIONS TREAT THAT AS "NOT BLOCKED" rather than as zero:
 *  an unloaded chunk read as sea level is a wall or a hole depending on which
 *  way the terrain went, and either way it is an answer invented from a missing
 *  measurement.
 * ============================================================================
 */

/** Somewhere to write a direction, so a march allocates nothing. */
export interface Dir3 {
  x: number;
  y: number;
  z: number;
}

/** Height of the ground at a world (x, z). Non-finite means "do not know". */
export type HeightAt = (x: number, z: number) => number;

/**
 * Is the field between two world points?
 *
 * `tolerance` is subtracted from the ground before the comparison and it is
 * required: a sampled field interpolates, so a sightline that grazes a ridge is
 * "blocked" by a few centimetres of interpolation error unless the caller says
 * how much of that it is willing to forgive. Zero is a legal answer and it is
 * the right one for a field that is exact.
 *
 * The endpoints themselves are never sampled — `i` runs 1..steps-1 — because
 * the eye and the subject are both usually sitting ON the ground.
 */
export function sightBlocked(
  height: HeightAt,
  ex: number, ey: number, ez: number,
  px: number, py: number, pz: number,
  steps: number,
  tolerance: number,
): boolean {
  for (let i = 1; i < steps; i++) {
    const s = i / steps;
    const g = height(ex + (px - ex) * s, ez + (pz - ez) * s);
    if (Number.isFinite(g) && ey + (py - ey) * s < g - tolerance) return true;
  }
  return false;
}

/** The march's shape. No defaults — see the header on `curve`. */
export interface EscapeMarch {
  /** Rays across the frame, and down it. The grid is sampled cell-centred. */
  cols: number;
  rows: number;
  /** Samples along each ray. */
  steps: number;
  /** How far a ray is followed before it counts as escaped, in world units. */
  reach: number;
  /** Exponent on the step spacing. 1 is linear; above 1 clusters near the eye. */
  curve: number;
}

/**
 * Fraction of a frustum's rays that never meet the field, in [0, 1].
 *
 * `rayFor` is handed cell-centred NDC in [-1, 1] and must write a UNIT
 * direction in world space. When `height` is null — no field yet, which is a
 * real state during boot — a ray counts as escaped only if it points upward,
 * which is the answer a flat world of unknown height gives.
 */
export function escapeFraction(
  height: HeightAt | null,
  ex: number, ey: number, ez: number,
  rayFor: (ndcX: number, ndcY: number, out: Dir3) => void,
  out: Dir3,
  m: EscapeMarch,
): number {
  let escaped = 0;
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const ndcX = ((c + 0.5) / m.cols) * 2 - 1;
      const ndcY = 1 - ((r + 0.5) / m.rows) * 2;
      rayFor(ndcX, ndcY, out);
      let hit = false;
      if (height !== null) {
        // A ray that rises still has to clear whatever is in front of it, so
        // every ray is marched and not just the descending ones.
        for (let i = 1; i <= m.steps && !hit; i++) {
          const s = m.reach * Math.pow(i / m.steps, m.curve);
          const y = ey + out.y * s;
          const g = height(ex + out.x * s, ez + out.z * s);
          if (Number.isFinite(g) && y < g) hit = true;
        }
      } else if (out.y <= 0) {
        hit = true;
      }
      if (!hit) escaped++;
    }
  }
  return escaped / (m.cols * m.rows);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  WHERE A RAY MEETS THE GROUND
 * ═══════════════════════════════════════════════════════════════════════════
 *  A cursor points at a place, and turning "this screen ray" into "this patch
 *  of dirt" is the operation every placement tool, every ping and every
 *  look-at-what-I-clicked needs.
 *
 *  ── IT IS NOT A PLANE INTERSECTION, AND THE DIFFERENCE IS VISIBLE ──────────
 *
 *  Solving against y = 0 puts the answer where the ray crosses SEA LEVEL, which
 *  on a slope is metres from where the player is pointing — uphill it lands
 *  behind the cursor, downhill in front of it, and the ghost slides away from
 *  the pointer as the camera pitches. The correct answer is where the ray meets
 *  the SURFACE.
 *
 *  ── NEWTON, NOT A MARCH ────────────────────────────────────────────────────
 *
 *  A fixed-step march either misses a thin ridge or samples the field hundreds
 *  of times per pointer move. This starts at the sea-level crossing and walks
 *  `t` by the height error divided by the ray's descent rate, which is Newton
 *  on a function that is monotone in `t` for any downward ray. Six iterations
 *  converge to under a centimetre on everything short of a cliff.
 *
 *  ── THE THREE REFUSALS ─────────────────────────────────────────────────────
 *
 *  A ray at or above the horizon has no ground answer and must say so rather
 *  than returning a point a thousand kilometres away. A `t` that goes negative
 *  or non-finite mid-solve is a divergence and is reported as a miss. And the
 *  answer is bounded to the field, because a placement outside it is a
 *  placement on nothing.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Every number the solve uses. None of them has a default. */
export interface GroundHitOptions {
  /** Iterations. Six is enough for a metre-scale field; see the header. */
  steps: number;
  /** Metres of height error below which the solve stops. */
  settle: number;
  /**
   * The ray must descend by at least this much per unit of travel. At or above
   * it the ray is level with or climbing away from the surface.
   */
  minDescent: number;
  /** Half-extent of the field on each axis. Outside it there is no ground. */
  halfExtent: number;
}

/** A point the solve writes into. `THREE.Vector3` satisfies it. */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a downward ray meets the surface. True when it landed inside the
 * field; `out` is only meaningful then.
 *
 * `origin` and `dir` are read and never written. `dir` is expected normalised,
 * but the solve only uses the ratio of its components, so a scaled direction
 * gives the same point.
 */
export function groundUnderRay(
  origin: XYZ, dir: XYZ, heightAt: HeightAt, out: XYZ, o: GroundHitOptions,
): boolean {
  if (dir.y > -o.minDescent) return false;      // level with, or above, the horizon
  let t = -origin.y / dir.y;
  if (!(t > 0) || !Number.isFinite(t)) t = 1;
  for (let i = 0; i < o.steps; i++) {
    out.x = origin.x + dir.x * t;
    out.y = origin.y + dir.y * t;
    out.z = origin.z + dir.z * t;
    const err = out.y - heightAt(out.x, out.z);
    if (Math.abs(err) < o.settle) break;
    t += err / -dir.y;
    if (!(t > 0) || !Number.isFinite(t)) return false;
  }
  out.x = origin.x + dir.x * t;
  out.y = origin.y + dir.y * t;
  out.z = origin.z + dir.z * t;
  out.y = heightAt(out.x, out.z);
  return Number.isFinite(out.x)
    && Math.abs(out.x) <= o.halfExtent && Math.abs(out.z) <= o.halfExtent;
}
