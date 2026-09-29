/**
 * ============================================================================
 *  nearband — WHERE, IN FRONT OF THIS LENS, IS THERE GROUND WORTH STANDING ON?
 * ============================================================================
 *
 *  A populated world composed only from world coordinates has an empty
 *  foreground, every time, because the thing the composition cares about is a
 *  region of the PICTURE and nothing in the world knows where that is. The
 *  measured version of that sentence, from one world's own crowd: 132
 *  figures placed, 13 of them in the bottom 28% of the frame, nearest one 73.6
 *  metres away — the whole near apron bare, in the one part of the picture
 *  where a two-metre figure is at its largest.
 *
 *  The fix is to ask the camera. Sweep a set of columns across the frame; for
 *  each, march outward along the ground and keep every depth whose ground point
 *  actually PROJECTS into the region you want filled.
 *
 *  ── PROJECT, DO NOT COMPUTE, AND THAT IS THE WHOLE DESIGN ──────────────────
 *
 *  The arithmetic version — a depression angle, a horizon row, a table of
 *  distance bands per pitch — was written three times before this and was
 *  quietly wrong every time, because it has to be re-derived for pitch, for
 *  roll, for field of view, for aspect and for a non-flat ground. Projecting a
 *  candidate point is exact for all five at once and it costs a few hundred
 *  probes ONCE PER CUT, not per frame. A wrong band is invisible in code review
 *  and obvious in a photograph, which is the worst possible combination, so the
 *  cheap exact method wins on more than speed.
 *
 *  ── SLANT DECIDES THE POOL, GROUND RUN DECIDES THE MARCH ───────────────────
 *
 *  These are two different distances and using one for both is a real, measured
 *  bug. A detail tier is a distance FROM THE EYE, and a staging camera is
 *  typically twelve to twenty-four metres up: a figure thirty-six metres out
 *  along the ground is forty-three from the lens and renders a tier lower than
 *  the caller thinks. Splitting the pools on ground run reported a band "inside
 *  the top tier" of which 7 of 40 actually were. The march stays on ground run,
 *  because that is what sweeps the frame evenly; only the classification uses
 *  slant.
 *
 *  ── IT IMPORTS NOTHING, INCLUDING THREE ────────────────────────────────────
 *
 *  The caller hands over two callbacks: one that says whether a spot is
 *  standable and how high the ground is there, and one that projects a world
 *  point. So the ground may be a heightfield, a graded road surface, a deck or
 *  a hull, the projection may be a perspective camera, an orthographic one or a
 *  hand-rolled matrix, and a Node harness can run the whole sweep with no
 *  renderer and no scene graph.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the column sweep, the march, the projection test, the slant
 *  split, and the recruit ordering below. The caller's: how many columns, how
 *  wide, how deep, what "the region I want filled" means in NDC, how high off
 *  the ground a body's chest is, and every consequence of a column coming back
 *  empty. Nothing here has an opinion about what stands in the band.
 * ============================================================================
 */

/** Somewhere to write a projected point. Normalised device coordinates. */
export interface NdcOut {
  x: number;
  y: number;
  z: number;
}

/** The lens, reduced to the eight numbers a ground sweep needs. */
export interface BandLens {
  /** Eye position. */
  ex: number;
  ey: number;
  ez: number;
  /** The view direction FLATTENED into the ground plane and renormalised. */
  fx: number;
  fz: number;
  /** The ground-plane right vector, `(-fz, fx)` at every caller so far. */
  rx: number;
  rz: number;
  /** `tan(fov / 2) * aspect` — metres off axis per metre of depth per unit u. */
  tanH: number;
}

/** How to sweep, and what counts as inside the picture. */
export interface BandSweep {
  /** How many columns across the frame. */
  cols: number;
  /** How much of the frame width they span, in NDC. Below 1 by the margin a
   *  body needs so it is not staged half outside the frame. */
  uSpan: number;
  /** Ground run to march over, and the step. The step is the resolution of the
   *  answer and the size of a standable island that can be missed. */
  dMin: number;
  dMax: number;
  dStep: number;
  /** How high off the ground the probe point sits — chest height, because that
   *  is the part of a figure that has to be inside the frame. */
  lift: number;
  /** Slant distance from the eye inside which a depth is `near`. */
  nearSlant: number;
  /** NDC gates. `zMax` rejects everything behind the lens; `xAbs` is the half
   *  width kept; `yLo` and `yHi` are the bottom and top of the region. */
  zMax: number;
  xAbs: number;
  yLo: number;
  yHi: number;
}

/**
 * Sweep the columns and hand back, per column, the depths that landed.
 *
 * @param standable ground height at (x, z), or NaN for a spot nothing may
 *                  stand on. Returning NaN rather than taking a separate
 *                  predicate is what keeps the caller from probing the ground
 *                  twice for every candidate.
 * @param project   write the NDC of a world point into `out`.
 * @param cb        one column: its frame-x, the depths inside `nearSlant` and
 *                  the depths outside it. BOTH ASCENDING AND DISJOINT by
 *                  construction, so a caller that wants depth order may simply
 *                  concatenate them. The two arrays are REUSED between columns
 *                  — copy them if you keep them.
 */
export function sweepGroundBand(
  lens: BandLens,
  spec: BandSweep,
  standable: (x: number, z: number) => number,
  project: (x: number, y: number, z: number, out: NdcOut) => void,
  cb: (u: number, near: number[], far: number[], i: number) => void,
): void {
  const near: number[] = [];
  const far: number[] = [];
  const ndc: NdcOut = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < spec.cols; i++) {
    // Across the frame in FRAME-X and not in world metres, so the same sweep
    // reaches both edges of a wide shot and of a long one.
    const u = (((i + 0.5) / spec.cols) * 2 - 1) * spec.uSpan;
    near.length = 0;
    far.length = 0;
    for (let d = spec.dMin; d <= spec.dMax; d += spec.dStep) {
      const px = lens.ex + lens.fx * d + lens.rx * (u * d * lens.tanH);
      const pz = lens.ez + lens.fz * d + lens.rz * (u * d * lens.tanH);
      const y = standable(px, pz);
      // `!(y === y)` and not `Number.isNaN`: a blocked spot is the common case
      // in a built world and this runs a few hundred times per cut.
      if (!(y === y)) continue;
      const py = y + spec.lift;
      project(px, py, pz, ndc);
      if (ndc.z >= spec.zMax) continue;
      if (ndc.x < -spec.xAbs || ndc.x > spec.xAbs) continue;
      if (ndc.y < spec.yLo || ndc.y > spec.yHi) continue;
      const sl = Math.hypot(px - lens.ex, py - lens.ey, pz - lens.ez);
      (sl <= spec.nearSlant ? near : far).push(d);
    }
    cb(u, near, far, i);
  }
}

/**
 * WHO MAY BE MOVED INTO THE BAND, in the order they should be taken.
 *
 * Two rules, and the second is the one that is expensive when it is missing.
 *
 *  · Anything already inside `protect` of the eye is left alone. It is already
 *    doing the band's job, and on a close pose the nearest body IS the subject
 *    — cannibalising the band to fill the band is how a portrait loses its
 *    sitter.
 *  · Farthest first, and OFF-SCREEN ALWAYS BEFORE ON-SCREEN. Moving a body the
 *    viewer is currently looking at is a body vanishing, which is worse than
 *    an empty foreground. It is an offset and not a weight on purpose: no
 *    distance may ever outrank being visible.
 *
 * @param onScreen null on a CUT. Nothing on screen before a cut is on screen
 *                 after it, so on a cut every candidate is equally free and
 *                 the ordering is plain distance. Passing a predicate that
 *                 always returns false would look equivalent and is not: it
 *                 adds 1e9 to every score and loses the far end of the
 *                 ordering into the noise of a double.
 * @returns        a new array; the input is not reordered.
 */
export function recruitOrder<T>(
  pool: readonly T[],
  x: (t: T) => number,
  z: (t: T) => number,
  ex: number,
  ez: number,
  protect: number,
  onScreen: ((t: T) => boolean) | null,
): T[] {
  const out: T[] = [];
  const score: number[] = [];
  const p2 = protect * protect;
  for (const t of pool) {
    const dx = x(t) - ex, dz = z(t) - ez;
    const d2 = dx * dx + dz * dz;
    if (d2 < p2) continue;
    out.push(t);
    score.push(onScreen === null ? d2 : (onScreen(t) ? d2 : d2 + 1e9));
  }
  // Sorted by index so the score is computed ONCE per candidate rather than
  // once per comparison — a projection inside a comparator is called O(n log n)
  // times, and on a moving camera that is the difference between a staging
  // pass costing nothing and costing a frame.
  const idx = out.map((_t, i) => i);
  idx.sort((a, b) => (score[b] as number) - (score[a] as number));
  return idx.map((i) => out[i] as T);
}
