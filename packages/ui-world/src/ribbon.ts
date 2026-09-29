/**
 * ============================================================================
 *  ribbon — a closed path drawn as a road: a casing, a core, and a bar across
 *  it. None of it knows what the path is a path of.
 * ============================================================================
 *
 *  A circuit map, a patrol route, a river, a walked trail: the same three
 *  drawings every time, and the same three things that go wrong.
 *
 *  1. A SINGLE-VALUE STROKE HAS NO EDGE. A light ribbon on a dark plate reads
 *     as a soft noodle — a shoelace, in a review's own word — because the
 *     stroke and the ground are two values and a road needs three. So it is
 *     drawn twice: a wider CASING pass in the dark, then a narrower CORE over
 *     it. The casing is what makes it read as a carriageway.
 *
 *  2. A LOOP WITH NO LANDMARKS IS A GENERIC KIDNEY. `casedRibbon` takes a list
 *     of parametric SECTIONS and paints the core once per section, so the
 *     caller can shift the value along the path and turn a shape into a place.
 *     Runs overlap by one sample so the joins are invisible. What the sections
 *     ARE is the caller's — this file takes `[t0, t1, colour]` and nothing else.
 *
 *  3. THE ONE LANDMARK THAT MUST BE FINDABLE IS A HAIRLINE. A four-pixel tick
 *     at the start of a lap is invisible at real size. `crossBar` strikes a
 *     glowing bar across the ribbon's NORMAL at a sample, optionally banded, so
 *     it survives at a hundred-odd pixels.
 *
 *  ## What is not here
 *
 *  Every colour, every weight, how many samples the path has, which sample the
 *  bar is struck at and how many bands it carries. All of it arrives as an
 *  argument, and none of it has a default. A package that chose the casing
 *  colour would be choosing what the ground under the road is made of.
 *
 *  ## The projection is the caller's too
 *
 *  Everything here takes a `project(i, out)` — index in, canvas point out — so
 *  the fit (`planfit.ts`), the margin and the panel are settled before this
 *  file sees anything. It never holds a world coordinate.
 */

/** Fills `out` with the canvas position of sample `i`. */
export type ProjectSample = (i: number, out: { x: number; y: number }) => void;

/** A parametric run of the path, and what colour the core is along it. */
export interface RibbonSection {
  /** start and end as fractions of the closed path, 0..1 */
  t0: number;
  t1: number;
  col: string;
}

/**
 * Lay a path through samples `[from, to]` into the current path.
 *
 * Indices wrap, so a closed loop is `trace(g, 0, n, n, project, s, true)`.
 * Nothing is stroked here — the caller sets the width and the style, which is
 * what lets one traced path be stroked twice at two weights.
 */
export function tracePath(
  g: CanvasRenderingContext2D,
  from: number,
  to: number,
  n: number,
  project: ProjectSample,
  scratch: { x: number; y: number },
  close: boolean,
): void {
  g.beginPath();
  project(from % n, scratch);
  g.moveTo(scratch.x, scratch.y);
  for (let i = from + 1; i <= to; i++) {
    project(i % n, scratch);
    g.lineTo(scratch.x, scratch.y);
  }
  if (close) g.closePath();
}

/** The three weights and the one colour that are not per-section. */
export interface RibbonInk {
  /** the dark the core sits inside */
  casing: string;
  /** core width and casing width, both already in device pixels */
  coreWidth: number;
  casingWidth: number;
}

/**
 * The casing in one closed pass, then the core once per section.
 *
 * ONE closed pass for the casing rather than one per section: a per-section
 * casing lays a dark seam across the road at every section boundary, which is
 * the "zipper" reading a dashed centreline produces for the same reason.
 */
export function casedRibbon(
  g: CanvasRenderingContext2D,
  n: number,
  project: ProjectSample,
  scratch: { x: number; y: number },
  sections: readonly RibbonSection[],
  ink: RibbonInk,
): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';

  tracePath(g, 0, n, n, project, scratch, true);
  g.strokeStyle = ink.casing;
  g.lineWidth = ink.coreWidth + ink.casingWidth;
  g.stroke();

  for (let k = 0; k < sections.length; k++) {
    const sec = sections[k] as RibbonSection;
    const i0 = Math.floor(sec.t0 * n);
    const i1 = Math.min(n, Math.ceil(sec.t1 * n) + 1);
    if (i1 - i0 < 2) continue;
    tracePath(g, i0, i1, n, project, scratch, false);
    g.strokeStyle = sec.col;
    g.lineWidth = ink.coreWidth;
    g.stroke();
  }
}

/** Everything about the bar struck across the ribbon. */
export interface CrossBarInk {
  /** the glow laid under it, and its blur radius in device pixels */
  glow: string;
  glowBlur: number;
  /** the base bar under the bands, and its width */
  base: string;
  baseWidth: number;
  /** the bands, cycled; two entries alternate. One entry is a solid bar. */
  bands: readonly string[];
  bandWidth: number;
  /** how many bands across the bar */
  bandCount: number;
  /** half-length of the bar, in device pixels */
  half: number;
}

/**
 * Strike a bar across the path's normal at sample `at`.
 *
 * The direction is taken from `at` to `ahead` — a few samples along rather than
 * the next one, so a start line laid on a kink reports the direction of the
 * straight rather than of the kink, while still being the start line.
 */
export function crossBar(
  g: CanvasRenderingContext2D,
  at: number,
  ahead: number,
  n: number,
  project: ProjectSample,
  scratch: { x: number; y: number },
  ink: CrossBarInk,
): void {
  project(at % n, scratch);
  const ax = scratch.x, ay = scratch.y;
  project(ahead % n, scratch);
  let tx = scratch.x - ax, ty = scratch.y - ay;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;
  const nx = -ty * ink.half, ny = tx * ink.half;

  g.save();
  g.shadowColor = ink.glow;
  g.shadowBlur = ink.glowBlur;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(ax - nx, ay - ny);
  g.lineTo(ax + nx, ay + ny);
  g.lineWidth = ink.baseWidth;
  g.strokeStyle = ink.base;
  g.stroke();
  g.restore();

  g.lineCap = 'butt';
  const c = ink.bandCount;
  for (let i = 0; i < c; i++) {
    const a0 = -1 + (2 * i) / c;
    const a1 = -1 + (2 * (i + 1)) / c;
    g.beginPath();
    g.moveTo(ax + nx * a0, ay + ny * a0);
    g.lineTo(ax + nx * a1, ay + ny * a1);
    g.lineWidth = ink.bandWidth;
    g.strokeStyle = ink.bands[i % ink.bands.length] as string;
    g.stroke();
  }
  g.lineCap = 'round';
}

/**
 * Lay and STROKE a path that is allowed to have holes in it.
 *
 * `tracePath` is for a continuous run; this is for the case a diagram of a real
 * route always has — a section that is not there. A stretch of no deck, a
 * tunnel, a stretch out of radar cover, a lap that has not been driven yet: the
 * caller says which samples exist and the path simply breaks and restarts.
 *
 * IT BREAKS RATHER THAN CONNECTING, and that is the whole capability. A
 * polyline drawn straight across a gap is not merely wrong, it is the most
 * dangerous thing a map of a route with a hole in it can do, because a gap
 * drawn as continuous is a gap the reader will steer into.
 *
 * Unlike `tracePath` this one strokes. A broken path is a set of subpaths and
 * the casing-then-core idiom `casedRibbon` uses needs a continuous one, so
 * there is nothing for a caller to do between building it and painting it; a
 * package that made every caller write the stroke would be making them write
 * the same line eight times, which is what this replaced.
 *
 * Indices run `0..n` so a run crossing the seam of a closed path is laid as one
 * subpath rather than as two that meet at the start line.
 */
export function strokeGapped(
  g: CanvasRenderingContext2D,
  n: number,
  keep: (i: number) => boolean,
  project: ProjectSample,
  scratch: { x: number; y: number },
): void {
  g.beginPath();
  let started = false;
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    if (!keep(j)) { started = false; continue; }
    project(j, scratch);
    if (!started) { g.moveTo(scratch.x, scratch.y); started = true; } else g.lineTo(scratch.x, scratch.y);
  }
  g.stroke();
}
