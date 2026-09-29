/**
 * ============================================================================
 *  network.ts — a set of swept routes asked about ITSELF.
 * ============================================================================
 *
 * `route.ts` turns a polyline into frames and frames into geometry. It has no
 * opinion about a SECOND route. Everything here is about the second one: where
 * a new run meets the ones already standing, how close it passes, and whether
 * it is about to occupy a volume something else already owns.
 *
 * Four questions, and none of them names a place:
 *
 *   nearestOnRoutes   closest approach of a plan point to any run built so far.
 *                     A spur meeting a boulevard is an endpoint that lands
 *                     within about a road-width of an existing centreline, and
 *                     nothing else in a sane network comes that close by
 *                     accident — so the threshold is the caller's and it is the
 *                     whole test.
 *   surveyCrossings   every place a new run crosses an old one, IN PLAN,
 *                     reported as distance-along, level and the OTHER run's
 *                     heading. Surveyed before any geometry is emitted, so one
 *                     list can hole the slab, the paint and the emissive strips
 *                     together and they cannot disagree.
 *   anyCrossing       the refusal. Two pressurised runs crossing in plan is not
 *                     a graphical glitch; it is two volumes intersecting, and
 *                     the eye reads it immediately. Endpoint-sharing runs — three
 *                     corridors into one portal — meet by design, so both ends
 *                     are skipped by a distance the caller states.
 *   bowedRoute        two points and a bow. A straight run between two buildings
 *                     reads as a pipe diagram; one control point off the chord
 *                     gives a Catmull-Rom that is C1 and has no kink.
 *
 * ── WHY A SEGMENT TEST ON FRAMES IS EXACT ENOUGH ────────────────────────────
 * Two adjacent frames of a sampled route are one `spacing` apart and, at any
 * spacing a sweep can survive without faceting, effectively straight. A
 * segment-segment test between them is therefore not an approximation of the
 * curve at the scale a junction is built at; the junction apron is tens of
 * metres across and the frames are single-digit metres apart.
 *
 * ── WHAT THE CALLER OWNS, AND WHY EACH ONE IS A KNOB ────────────────────────
 * `minSep`, `skipEnds`, `maxD`, `yBias`, the bow fraction and its ceiling. Every
 * one of them is a length in the caller's world, priced against the width of
 * its own carriageway and the reach of its own machines. A default here is how
 * the next game inherits the last one's road network with every check green.
 */
import type { Frame, RoutePoint } from './route.js';
import { segCrossXZ } from './route.js';

/** Closest approach of a plan point to a set of built runs. */
export interface NearestRun {
  /** Level of the nearest sampled frame — the run's founding plane, not the ground. */
  y: number;
  /** Plan distance to it. */
  dist: number;
}

/**
 * Closest approach of a world XZ point to any run in `lines`.
 *
 * Returns null when the network is empty or nothing is within `maxD`, and the
 * two cases are deliberately the same answer: a caller asking "is there a road
 * to join here" wants "no" from both.
 *
 * Compared squared and rooted once, at the end — a hypot per frame over a
 * network of several hundred is the kind of cost that only shows up at
 * occupancy.
 */
export function nearestOnRoutes(
  lines: readonly Frame[][], x: number, z: number, maxD: number,
): NearestRun | null {
  let bd = maxD * maxD, by = 0, hit = false;
  for (const fr of lines) {
    for (let i = 0; i < fr.length; i++) {
      const p = fr[i].p;
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; by = p.y; hit = true; }
    }
  }
  return hit ? { y: by, dist: Math.sqrt(bd) } : null;
}

/** One place a new run crosses an existing one. */
export interface Crossing {
  /** Distance along the NEW run, in its own frame distances. */
  d: number;
  /** Level to build the junction at — the EXISTING run's, plus the caller's bias. */
  y: number;
  /** Heading of the EXISTING run at the crossing, radians, atan2(dz, dx). */
  heading: number;
}

export interface SurveyOpts {
  /**
   * Minimum separation, along the new run, between two reported crossings. One
   * junction per crossing: a single frame span can cross two consecutive
   * segments of the other run and produce two hits a couple of metres apart,
   * and building two aprons there is worse than building none.
   */
  minSep: number;
  /**
   * Added to the existing run's interpolated level. A junction slab founded
   * exactly on the frame plane z-fights the carriageway it is joining, so the
   * caller states how far under (or over) its own surface stack it wants to sit.
   */
  yBias?: number;
}

/**
 * Every place `f` crosses one of `others`, in plan.
 *
 * The level reported is the MAJOR road's — the one already built — so the
 * fillets and stop bars sit on the surface that actually survives at the
 * crossing rather than on the arm that is about to be holed.
 */
export function surveyCrossings(
  f: readonly Frame[], others: readonly Frame[][], o: SurveyOpts,
): Crossing[] {
  const out: Crossing[] = [];
  if (f.length < 2) return out;
  const yBias = o.yBias ?? 0;
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i].p, b2 = f[i + 1].p;
    for (const other of others) {
      for (let j = 0; j < other.length - 1; j++) {
        const c = other[j].p, d2 = other[j + 1].p;
        const t = segCrossXZ(a.x, a.z, b2.x, b2.z, c.x, c.z, d2.x, d2.z);
        if (t < 0) continue;
        const dAt = f[i].d + (f[i + 1].d - f[i].d) * t;
        if (out.some((h) => Math.abs(h.d - dAt) < o.minSep)) continue;
        out.push({
          d: dAt,
          y: c.y + (d2.y - c.y) * 0.5 + yBias,
          heading: Math.atan2(d2.z - c.z, d2.x - c.x),
        });
      }
    }
  }
  return out;
}

/**
 * Does `f` cross any run in `others`, in plan, away from either end?
 *
 * `skipEnds` is a distance in frame units, applied at BOTH ends of BOTH runs.
 * Runs that legitimately share an endpoint meet there by design and must not be
 * rejected for it; anything further in than that is two volumes in one place.
 *
 * Returns on the first hit — the answer is a refusal, not a report.
 */
export function anyCrossing(
  f: readonly Frame[], others: readonly Frame[][], skipEnds: number,
): boolean {
  if (f.length < 2) return false;
  const total = f[f.length - 1].d;
  for (let i = 0; i < f.length - 1; i++) {
    if (f[i].d < skipEnds || f[i].d > total - skipEnds) continue;
    for (const other of others) {
      if (other.length < 2) continue;
      const oTotal = other[other.length - 1].d;
      for (let j = 0; j < other.length - 1; j++) {
        if (other[j].d < skipEnds || other[j].d > oTotal - skipEnds) continue;
        if (segCrossXZ(f[i].p.x, f[i].p.z, f[i + 1].p.x, f[i + 1].p.z,
                       other[j].p.x, other[j].p.z, other[j + 1].p.x, other[j + 1].p.z) >= 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Three plan points from two: start, a control point bowed off the chord, end.
 *
 * The bow is `frac` of the chord length, capped at `max`, and it is always to
 * the LEFT of the direction of travel — which is a choice, not a symmetry: two
 * runs joining the same pair of buildings from opposite directions should bow
 * the same way and read as one corridor with a curve, not as a lens.
 */
export function bowedRoute(
  ax: number, az: number, bx: number, bz: number, frac: number, max: number,
): RoutePoint[] {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  const bow = Math.min(max, L * frac);
  return [[ax, az], [mx - (dz / L) * bow, mz + (dx / L) * bow], [bx, bz]];
}

/** Re-exported so a caller naming a plan point pulls one specifier, not two. */
export type { Frame, RoutePoint };
