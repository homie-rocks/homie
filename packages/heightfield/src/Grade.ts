/**
 * ============================================================================
 *  gradeSite — level a disc of a height field and lay the cut back at the
 *  angle of repose.
 * ============================================================================
 *
 *  The question every game that lets you BUILD on terrain has to answer, and
 *  it is not "flatten a circle". Four things have to be true at once or the
 *  result is one of four very legible failures:
 *
 *    · THE PAD SITS AT THE MEAN OF WHAT WAS THERE, so it cuts and fills
 *      equally. Founding it on the high point puts it on a plinth; on the low
 *      point it is in a hole.
 *    · THE EDGE IS A BATTER, not a cliff, and its LENGTH comes from the STEP
 *      the pad has to close divided by the tangent of the angle of repose —
 *      not from a fraction of the radius. A collar sized off the radius is
 *      1.4 x radius of skirt on flat ground and not enough on a slope, which
 *      is exactly backwards.
 *    · SOME OF THE FINE TEXTURE SURVIVES. A perfectly smooth disc in a
 *      cratered plain is a loud tell, so the pad keeps a bounded fraction of
 *      the residual above the local trend — bounded by fraction, by amplitude,
 *      and faded out entirely above a size at which the thing really is a
 *      poured slab.
 *    · THE TREND IS READ BEFORE ANYTHING IS WRITTEN. Two passes, not one. The
 *      levelling pass reads neighbours; computing the trend inline would sample
 *      ground this same call had already flattened and the levelling would eat
 *      outward one cell per row — a flat tongue running off one side of the
 *      pad and nowhere else, which reads as a noise artefact and is a
 *      loop-carried dependency.
 *
 *  ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 *
 *  Everything that says what the ground IS. Reclassifying cells, marking a
 *  "prepared" mask, dirtying chunks, telling a scatter pass to stay off: all
 *  of that is the caller's, and `gradeSite` returns the rectangle it touched
 *  so the caller can walk it once more. A grader that also owned a terrain
 *  class would be a terrain class.
 *
 *  Every number in `GradeSpec` is required. A pad's texture-retention fraction
 *  is a claim about how a particular world is built on, and a shared default
 *  would give the next game this one's construction standards.
 *
 *  No `three`: a Float32Array, a sampler and numbers, so a Node harness can
 *  grade a site and read every cell back.
 * ============================================================================
 */
import type { HeightField } from './Field.ts';
import { binomial5, boxBlur2D } from './Filter.ts';

/** Every number the grader runs on. No defaults — see the header. */
export interface GradeSpec {
  /** Tangent of the angle of repose. The batter is the step laid back at it. */
  tanRepose: number;
  /**
   * Floor on the batter's LENGTH, in world units.
   *
   * It exists because a batter shorter than about one and a half grid cells is
   * not a crisp edge, it is an UNREPRESENTABLE one, and it rasterises as a
   * staircase around the whole rim.
   */
  batterMin: number;
  /** Cap on the batter as a fraction of the radius, so a steep site still
   *  cannot grow an unbounded skirt. */
  batterMaxFrac: number;
  /** Azimuths sampled on the ring to MEASURE the step rather than assume it. */
  ringTaps: number;
  /** Trend filter spacing as a fraction of the radius, floored at the grid
   *  step: "the shape of the ground at the scale of this structure". */
  trendFrac: number;
  /** Fraction of the residual the pad keeps, and its cap in world units. */
  keep: number;
  keepCap: number;
  /** Radii between which `keep` fades to zero. Above `slabTo` the structure
   *  carries flat slab geometry of its own and retained relief under it is a
   *  floating edge. */
  slabFrom: number;
  slabTo: number;
  /**
   * Fraction of the batter over which the fine texture comes back.
   *
   * Under 1 on purpose: the trend closes over the WHOLE batter and the texture
   * returns over its first part, so the pad edge is a break in slope rather
   * than a long fade. Both weights are 1 at the pad radius, where the residual
   * term returns exactly the pad's own retained relief — which is what makes
   * the edge continuous instead of a small cliff.
   */
  textureReturn: number;
}

/** The rectangle of posts `gradeSite` wrote, inclusive, plus its outer radius. */
export interface GradeRect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  /** radius + batter. The caller's own passes want the same extent. */
  outer: number;
}

/** Grown, never shrunk: `gradeSite` runs a few hundred times while a scenario
 *  seeds and a per-call Float32Array there is a hundred needless collections. */
let _trend = new Float32Array(0);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * @param field  row-major heights, `n` posts per side, index `j * n + i`.
 * @param f      the SAMPLER for the same surface — `heightAt` in world units.
 *               Separate from `field` because the ring measurement and the
 *               trend filter both want interpolated values off the caller's
 *               own fetch, which may not be a plain bilinear.
 * @param n      posts per side.
 * @param step   world units between posts.
 * @param half   world coordinate of post 0 on both axes, negated: post i sits
 *               at `i * step - half`.
 * @returns the rectangle written, or null when the disc misses the grid.
 */
export function gradeSite(
  field: Float32Array, f: HeightField, n: number, step: number, half: number,
  x: number, z: number, radius: number, s: GradeSpec,
): GradeRect | null {
  // THE STEP IS MEASURED, NOT ASSUMED. Sampled on the ring where the batter
  // starts, off the PRE-LEVELLING surface: the mean offset from the centre plus
  // the mean absolute deviation around the ring, so a pad on a saddle gets the
  // batter a saddle needs rather than the one its mean implies.
  let sum0 = 0;
  for (let k = 0; k < s.ringTaps; k++) {
    const a = (k / s.ringTaps) * Math.PI * 2;
    sum0 += f.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
  }
  const ringMean = sum0 / s.ringTaps;
  let dev = 0;
  for (let k = 0; k < s.ringTaps; k++) {
    const a = (k / s.ringTaps) * Math.PI * 2;
    dev += Math.abs(f.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) - ringMean);
  }
  const stepH = Math.abs(ringMean - f.heightAt(x, z)) + dev / s.ringTaps;

  const batter = clamp(stepH / s.tanRepose, s.batterMin,
    Math.max(s.batterMin, radius * s.batterMaxFrac));
  const outer = radius + batter;

  const i0 = clamp(Math.floor((x - outer + half) / step), 0, n - 1);
  const i1 = clamp(Math.ceil((x + outer + half) / step), 0, n - 1);
  const j0 = clamp(Math.floor((z - outer + half) / step), 0, n - 1);
  const j1 = clamp(Math.ceil((z + outer + half) / step), 0, n - 1);
  if (i1 <= i0 || j1 <= j0) return null;

  // Target is the mean of the FOOTPRINT, so the pad cuts and fills equally.
  let sum = 0, count = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = i * step - half, pz = j * step - half;
      if ((px - x) ** 2 + (pz - z) ** 2 > radius * radius) continue;
      sum += field[j * n + i]!; count++;
    }
  }
  if (count === 0) return null;
  const target = sum / count;

  // ── PASS 1: the trend, read off the field BEFORE anything is written ───────
  const w = i1 - i0 + 1, hgt = j1 - j0 + 1;
  if (_trend.length < w * hgt) _trend = new Float32Array(w * hgt);
  const ts = Math.max(step, radius * s.trendFrac);
  for (let j = j0; j <= j1; j++) {
    const pz = j * step - half;
    for (let i = i0; i <= i1; i++) {
      // `ts` is never <= 0 (it is at least `step`), so this is always the
      // filtering path and never binomial5's identity short circuit.
      _trend[(j - j0) * w + (i - i0)] = binomial5(f, i * step - half, pz, ts);
    }
  }

  const keepK = s.keep * (1 - smoothstep(s.slabFrom, s.slabTo, radius));

  // ── PASS 2: the pad and its batter ─────────────────────────────────────────
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = i * step - half, pz = j * step - half;
      const d = Math.sqrt((px - x) ** 2 + (pz - z) ** 2);
      if (d > outer) continue;
      const c = j * n + i;
      const tr = _trend[(j - j0) * w + (i - i0)]!;
      const resid = field[c]! - tr;
      const k = clamp(resid * keepK, -s.keepCap, s.keepCap);
      if (d <= radius) {
        field[c] = target + k;
        continue;
      }
      const wT = 1 - smoothstep(radius, outer, d);
      const wR = 1 - smoothstep(radius, radius + batter * s.textureReturn, d);
      field[c] = lerp(tr, target, wT) + lerp(k, resid, 1 - wR);
    }
  }

  return { i0, i1, j0, j1, outer };
}

// ---------------------------------------------------------------------------
// ringPlaneFit — the datum a stamped feature sits on
// ---------------------------------------------------------------------------

/** What the ring fit found. `samples` is how many of the ring landed on data. */
export interface RingPlane {
  /** Height of the fitted plane at the ring's own centre. */
  base: number;
  /** dy/dx and dy/dz of the fitted plane, each clamped to ±1 (45°). */
  gx: number;
  gz: number;
  samples: number;
}

/**
 * ===========================================================================
 *  FIT A PLANE TO A HEIGHT FIELD SAMPLED ON A RING. THE DATUM, NOT A MEAN.
 * ===========================================================================
 *  Anything stamped into terrain — a crater, a pad, a pit, a pond — has to sit
 *  on the ground it landed on rather than on world Y. Sampling a ring and
 *  AVERAGING gets the height right and the TILT wrong, and the tilt is what a
 *  player sees: a flat-based bowl of radius R stamped onto a slope of angle t
 *  cuts a vertical step of about tan(t)·R on the downhill side and buries the
 *  same amount on the uphill side. On a 31° wall that is 4 m for a 5 m feature
 *  and 78 m for a 260 m one, and a vertical face also destroys a planar XZ
 *  texture projection — a wall's whole height maps to a sliver of UV, so every
 *  lit ledge dissolves into a curtain of vertical streaks. That was diagnosed
 *  as GEOMETRY rather than as a crack only because it survived trebling the
 *  LOD skirt.
 *
 *  Least squares for y = base + gx·dx + gz·dz. On a complete ring the normal
 *  equations are diagonal and the fit is two dot products; this solves the
 *  general 3×3 by Cramer anyway, because samples fall out at a map edge and a
 *  partial ring is not diagonal. A degenerate ring falls back to the plain
 *  mean, which is the answer the averaging version would have given.
 *
 *  THE GRADIENT IS CLAMPED TO 45° AND THAT IS NOT A TASTE KNOB. A ring that
 *  straddles a cliff fits an absurd gradient, and the caller then EXTRAPOLATES
 *  it across the whole feature — a spike, not a tilt. No ground a crater
 *  survives on is steeper than 45°, so the clamp costs nothing real and stops
 *  the one failure that is catastrophic rather than wrong.
 *
 *  `sampleAt` returns NaN for a point with no data; those are dropped and
 *  `samples` says how many survived. `minFit` is the fewest survivors the
 *  caller will accept a TILT from — below it the mean is returned with a zero
 *  gradient, because three points that happen to be collinear fit a plane
 *  perfectly and confidently in the wrong direction. A caller sampling a
 *  bounded grid passes a real floor; one sampling an analytic surface that
 *  cannot miss passes 1. Returns null when the whole ring missed.
 *
 *  No `three`, no field object: a centre, a radius, a sample count and a
 *  callback. Arrived from one game's crater stamper and its far-field crater
 *  set, which carried it twice — one of the two had the floor and the other did
 *  not, which is exactly the drift one copy per game buys.
 * ===========================================================================
 */
export function ringPlaneFit(
  cx: number, cz: number, radius: number, count: number, minFit: number,
  sampleAt: (x: number, z: number) => number,
): RingPlane | null {
  let n1 = 0, Sx = 0, Sz = 0, Sxx = 0, Szz = 0, Sxz = 0, Sy = 0, Sxy = 0, Szy = 0;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const dxs = Math.cos(a) * radius, dzs = Math.sin(a) * radius;
    const y = sampleAt(cx + dxs, cz + dzs);
    if (!Number.isFinite(y)) continue;
    n1++; Sx += dxs; Sz += dzs; Sxx += dxs * dxs; Szz += dzs * dzs;
    Sxz += dxs * dzs; Sy += y; Sxy += dxs * y; Szy += dzs * y;
  }
  if (n1 === 0) return null;
  let base = Sy / n1, gx = 0, gz = 0;
  const det = n1 * (Sxx * Szz - Sxz * Sxz) - Sx * (Sx * Szz - Sxz * Sz)
    + Sz * (Sx * Sxz - Sxx * Sz);
  if (n1 >= minFit && Math.abs(det) > 1e-6) {
    base = (Sy * (Sxx * Szz - Sxz * Sxz) - Sx * (Sxy * Szz - Sxz * Szy)
      + Sz * (Sxy * Sxz - Sxx * Szy)) / det;
    gx = (n1 * (Sxy * Szz - Sxz * Szy) - Sy * (Sx * Szz - Sxz * Sz)
      + Sz * (Sx * Szy - Sxy * Sz)) / det;
    gz = (n1 * (Sxx * Szy - Sxy * Sxz) - Sx * (Sx * Szy - Sxy * Sz)
      + Sy * (Sx * Sxz - Sxx * Sz)) / det;
    const g = Math.hypot(gx, gz);
    if (g > 1) { gx /= g; gz /= g; }
  }
  return { base, gx, gz, samples: n1 };
}

// ---------------------------------------------------------------------------
// smoothDisc — soften a disc of a field and feather the edge
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 *  LOW-PASS A DISC OF A HEIGHT FIELD AND BLEND IT BACK WITH A RADIAL FALLOFF.
 * ===========================================================================
 *  `gradeSite` above LEVELS ground to a datum, which is what a foundation
 *  needs. This does something different and is not a special case of it: it
 *  keeps the ground's own shape and takes the FINE detail out of it, fading
 *  back to the untouched surface between `r0` and `r1`. That is what a
 *  spawn area, an opening view or any "the player starts here and it must be
 *  navigable" region wants — flattened ground reads as a car park, softened
 *  ground reads as ground.
 *
 *  TWO RADII AND NOT ONE. A single radius makes a visible circle, and the eye
 *  finds a discontinuity in the SECOND derivative on a hillshade long before it
 *  finds one in height. The weight is `1 - smoothstep(r0, r1, d)`, so inside r0
 *  the blur is at full strength and outside r1 nothing is touched at all.
 *
 *  THE FIELD IS RE-READ ON EVERY PASS AND THAT IS TWO LOOP-CARRIED
 *  DEPENDENCIES AVOIDED, NOT ONE. `boxBlur2D`'s own header covers the first:
 *  a blur that reads and writes one array reads what this pass already wrote,
 *  the kernel grows a cell per row, and the smoothing eats outward in the scan
 *  direction — a flat tongue running off one side and nowhere else. The second
 *  is this function's: the BLEND writes back into the field, so a second pass
 *  that reused the first pass's copy would be blurring a surface the field no
 *  longer has. Both cost a copy and neither is optional.
 *
 *  EVERY RADIUS IS THE CALLER'S. How large a softened region a world wants is
 *  the loudest thing this function does — a disc centred where every hero
 *  camera looks is how a beautifully cratered map photographs as a dune field —
 *  so nothing here has a default and the numbers stay at the call site with the
 *  frame that measured them.
 *
 *  No `three`, no field object: a Float32Array, a grid description and numbers.
 * ===========================================================================
 */
export function smoothDisc(
  field: Float32Array,
  n: number, step: number, half: number,
  cx: number, cz: number,
  r0: number, r1: number,
  passes: number, rad: number,
): void {
  const i0 = clamp(Math.floor((cx - r1 + half) / step) - rad, 0, n - 1);
  const i1 = clamp(Math.ceil((cx + r1 + half) / step) + rad, 0, n - 1);
  const j0 = clamp(Math.floor((cz - r1 + half) / step) - rad, 0, n - 1);
  const j1 = clamp(Math.ceil((cz + r1 + half) / step) + rad, 0, n - 1);
  const w = i1 - i0 + 1, hgt = j1 - j0 + 1;
  // Under three cells on either axis there is no interior for a box blur to
  // read and the whole rectangle would be border. Nothing, rather than a
  // rectangle of edge-clamped mush.
  if (w < 3 || hgt < 3) return;
  const a = new Float32Array(w * hgt);
  const b = new Float32Array(w * hgt);

  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < hgt; j++) {
      for (let i = 0; i < w; i++) a[j * w + i] = field[(j0 + j) * n + (i0 + i)]!;
    }
    boxBlur2D(a, b, w, hgt, rad);
    for (let j = 0; j < hgt; j++) {
      const z = (j0 + j) * step - half;
      for (let i = 0; i < w; i++) {
        const x = (i0 + i) * step - half;
        const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        const wt = 1 - smoothstep(r0, r1, d);
        if (wt <= 0) continue;
        const c = (j0 + j) * n + (i0 + i);
        field[c] = lerp(field[c]!, a[j * w + i]!, wt);
      }
    }
  }
}
