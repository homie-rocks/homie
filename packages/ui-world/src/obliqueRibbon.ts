/*
 * ============================================================================
 *  obliqueRibbon.ts — a framed path, laid on a panel as a depth-sorted ribbon.
 * ============================================================================
 *  Extracted from a space racer's minimap, which carried it privately under a
 *  note calling it unique — "ZERO lines in common" with any shared package.
 *
 *  THAT NOTE IS RIGHT ABOUT THE DRAWING AND WRONG ABOUT THE PROJECTION, and
 *  `./planfit.ts`'s own header already drew that line: *"the FIT is not the
 *  drawing"*. This file is the next span of the same bridge. Say what is below
 *  without naming a circuit and nothing drops out:
 *
 *    · rotate world XZ into a fitted frame, tilt the minor axis, and subtract
 *      an exaggerated elevation — an OBLIQUE projection, in which the view
 *      direction IS the minor plan axis, so the minor coordinate alone orders
 *      the whole scene by depth;
 *    · project the path's two EDGES rather than its centre, so the strip has
 *      width and twists when the frame twists;
 *    · take the extents from the projected geometry, fit them into a box that
 *      reserves a band, and give back whatever height the fit did not use;
 *    · floor the strip's on-screen width, symmetrically about the centre;
 *    · order the stations far-first.
 *
 *  WHAT DELIBERATELY STAYED IN THE GAME. Every number — the tilt, the
 *  elevation exaggeration, the margin, the band's two fractions, the width
 *  floor — and everything that is a picture: the light, the gap where there is
 *  no path, the split's two branches, the markers, the stems, the plate. There is
 *  no default for any of the numbers here, because a default is the next
 *  game's diagram inheriting the first game's camera.
 *
 *  ── WHY THE PROJECTION IS WORTH SHARING AND THE DRAWING IS NOT ──────────────
 *  A plan-view polyline is the reflex, and it is wrong for any path that rolls,
 *  gaps or splits: a roll reads as a kink, a gap reads as continuous, and two
 *  branches read as one stroke. The fix is not a special case per feature, it is
 *  to project the real frame and let all three fall out — which is a piece of
 *  arithmetic, reusable by any diagram of any banked path, and completely
 *  silent about what the path is.
 *
 *  ── THE TWO PLACES THIS IS EASY TO GET WRONG ───────────────────────────────
 *  THE WIDTH FLOOR NEEDS A CARRIED-FORWARD AXIS. Where the two edges project on
 *  top of each other — which happens exactly at the two 90° points of a full
 *  roll, when the surface is edge-on to the view — the direction to push them
 *  apart is undefined. Without carrying the previous station's axis the strip
 *  pinches to nothing and back through every twist, which is the one place the
 *  projection was supposed to be better than a polyline.
 *
 *  THE FIT IS TWO PASSES, NOT ONE. The first asks what scale the loop can reach
 *  inside its minimum box; the second gives back whatever height that scale did
 *  not use, up to a stated maximum. On a width-limited path the surplus is real
 *  and it belongs to the band rather than staying as empty plate.
 * ============================================================================
 */

/** The fitted frame plus the two numbers that make the projection oblique. */
export interface ObliqueView {
  /** cos and sin of the rotation from world XZ into the fitted frame. */
  rc: number; rs: number;
  /** the world XZ point the rotation is taken about. */
  cx: number; cz: number;
  /** the world Y that projects to zero elevation. */
  yDatum: number;
  /** cosine of the view elevation, applied to the minor plan axis. */
  tilt: number;
  /** elevation multiplier. 1 is honest and usually illegible; see the caller. */
  exag: number;
}

/** Where a point lands, before scale and offset. `d` is painter depth. */
export interface ObliquePoint { x: number; y: number; d: number }

/**
 * The path, as parallel arrays. Accessors were considered and rejected: this
 * runs once per resize over hundreds of stations and both halves of every
 * station are read four times, so two indexed calls per read would be four
 * closures deep for no gain. `./planfit.ts` takes accessors because it runs
 * over ONE channel and its two callers hold that channel in different shapes.
 */
export interface RibbonPath {
  n: number;
  /** centre of the path */
  px: Float32Array; py: Float32Array; pz: Float32Array;
  /** the across-surface unit vector — banked and rolled, not world right */
  bx: Float32Array; by: Float32Array; bz: Float32Array;
  /** half the surface's width at this station, world units */
  hw: Float32Array;
}

/** The rectangle the diagram may use, in device pixels. */
export interface RibbonBox { x: number; y: number; w: number; h: number }

export interface RibbonFit {
  /** fraction of the box reserved as margin, after the fit */
  pad: number;
  /** fraction of the box's height reserved below the loop, minimum and cap */
  bandMin: number; bandMax: number;
  /** the strip's on-screen width floor, in device pixels */
  minWidthPx: number;
}

/** One station, projected. Everything is device pixels except `depth`. */
export interface RibbonStation {
  /** projected centre */
  cx: number; cy: number;
  /** projected edges, left and right of the across-surface axis */
  lx: number; ly: number;
  rx: number; ry: number;
  /** the datum point directly "below" the centre, for a stem */
  dy: number;
  /** painter depth — larger is further away */
  depth: number;
}

export interface RibbonPlan {
  st: RibbonStation[];
  /** draw order, far first */
  order: number[];
  scale: number;
  ox: number; oy: number;
  /** height the fit gave to the band below the loop, device pixels */
  bandH: number;
}

/** World point → unrotated panel coordinates, before scale and offset. */
export function obliqueProject(
  view: ObliqueView, x: number, y: number, z: number, out: ObliquePoint,
): void {
  const dx = x - view.cx, dz = z - view.cz;
  const u = dx * view.rc - dz * view.rs;
  const v = dx * view.rs + dz * view.rc;
  out.x = u;
  out.y = v * view.tilt - (y - view.yDatum) * view.exag;
  // In an oblique projection the view direction is the minor plan axis, so `v`
  // alone orders the whole scene — including a path passing under itself, which
  // is the one place it matters.
  out.d = v;
}

/** The same projection, through a baked plan, for one live point. */
export function obliquePlace(
  view: ObliqueView, plan: { scale: number; ox: number; oy: number },
  x: number, y: number, z: number, out: { x: number; y: number },
): void {
  const p = _scratch;
  obliqueProject(view, x, y, z, p);
  out.x = plan.ox + p.x * plan.scale;
  out.y = plan.oy + p.y * plan.scale;
}
const _scratch: ObliquePoint = { x: 0, y: 0, d: 0 };

/**
 * Project the whole path, fit it into `box`, floor the strip width, and sort.
 *
 * Allocates once per call and is resize-time code; nothing here runs per frame.
 */
export function projectRibbon(
  view: ObliqueView, path: RibbonPath, box: RibbonBox, opts: RibbonFit,
): RibbonPlan {
  const n = path.n;
  const p: ObliquePoint = { x: 0, y: 0, d: 0 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

  // First pass: raw panel coordinates, and the extents of the whole RIBBON
  // (edges included) rather than of the centre line, so a wide station cannot
  // hang off the panel.
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    // The `!`s here and below are `noUncheckedIndexedAccess`, which is on in
    // this package and off in every game. `i < n` is the guard and `n` is the
    // caller's own array length; runtime is identical.
    const h = path.hw[i]!;
    const cx0 = path.px[i]!, cy0 = path.py[i]!, cz0 = path.pz[i]!;
    const ax = path.bx[i]!, ay = path.by[i]!, az = path.bz[i]!;
    const ex = cx0 + ax * h;
    const ey = cy0 + ay * h;
    const ez = cz0 + az * h;
    const wx = cx0 - ax * h;
    const wy = cy0 - ay * h;
    const wz = cz0 - az * h;

    obliqueProject(view, cx0, cy0, cz0, p);
    const cX = p.x, cY = p.y, d = p.d;
    obliqueProject(view, cx0, view.yDatum, cz0, p);
    const dY = p.y;
    obliqueProject(view, ex, ey, ez, p);
    const rX = p.x, rY = p.y;
    obliqueProject(view, wx, wy, wz, p);
    const lX = p.x, lY = p.y;

    raw.push(cX, cY, lX, lY, rX, rY, dY, d);
    for (const q of [[cX, cY], [lX, lY], [rX, rY], [cX, dY]] as [number, number][]) {
      if (q[0] < xMin) xMin = q[0]; if (q[0] > xMax) xMax = q[0];
      if (q[1] < yMin) yMin = q[1]; if (q[1] > yMax) yMax = q[1];
    }
  }

  // THE FIT, TWICE. See the header: the first pass asks what scale the loop can
  // reach inside its minimum box; the second gives back whatever height that
  // scale did not use.
  const dxT = Math.max(1, xMax - xMin), dyT = Math.max(1, yMax - yMin);
  const usableW = box.w * (1 - opts.pad * 2);
  const fit = (bandH: number) =>
    Math.min(usableW / dxT, (box.h - bandH) * (1 - opts.pad * 2) / dyT);
  const s0 = fit(box.h * opts.bandMin);
  const needH = dyT * s0 / (1 - opts.pad * 2);
  const bandH = Math.min(Math.max(box.h - needH, box.h * opts.bandMin), box.h * opts.bandMax);
  const loopH = box.h - bandH;
  const scale = fit(bandH);
  const ox = box.x + box.w * 0.5 - (xMin + xMax) * 0.5 * scale;
  const oy = box.y + loopH * 0.5 - (yMin + yMax) * 0.5 * scale;

  const st: RibbonStation[] = [];
  const minW = opts.minWidthPx;
  let axX = 1, axY = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const cx = ox + raw[o]! * scale, cy = oy + raw[o + 1]! * scale;
    let lx = ox + raw[o + 2]! * scale, ly = oy + raw[o + 3]! * scale;
    let rx = ox + raw[o + 4]! * scale, ry = oy + raw[o + 5]! * scale;
    const dx = rx - lx, dy = ry - ly;
    const len = Math.hypot(dx, dy);
    if (len > 1e-3) { axX = dx / len; axY = dy / len; }
    if (len < minW) {
      const h = minW * 0.5;
      const mx = (lx + rx) * 0.5, my = (ly + ry) * 0.5;
      lx = mx - axX * h; ly = my - axY * h;
      rx = mx + axX * h; ry = my + axY * h;
    }
    st.push({ cx, cy, lx, ly, rx, ry, dy: oy + raw[o + 6]! * scale, depth: raw[o + 7]! });
  }

  const order: number[] = [];
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  // Far first. Insertion sort on an almost-sorted array is faster than a
  // comparator sort here and, more to the point, allocates no closure.
  for (let i = 1; i < n; i++) {
    const v = order[i]!;
    const dv = st[v]!.depth;
    let j = i - 1;
    while (j >= 0 && st[order[j]!]!.depth < dv) { order[j + 1] = order[j]!; j--; }
    order[j + 1] = v;
  }

  return { st, order, scale, ox, oy, bandH };
}

/**
 * The UNWRAPPED roll of a framed closed path about the world-up datum, per
 * station, plus its range.
 *
 * The level reference at each station is world +Y with the path's tangent
 * projected out of it; the roll is the angle of the frame's across-surface
 * vector in the plane perpendicular to the tangent.
 *
 * UNWRAPPED, AND IT HAS TO BE. An inverted surface and an upright one are the
 * SAME wrapped angle, so a wrapped channel cannot show a full turn at all.
 * Accumulating the shortest step between consecutive stations turns "somewhere
 * between −180 and 180" into "360 degrees of roll, all of it here".
 *
 * A near-vertical tangent has no level frame — the projected up vector
 * collapses — so those stations HOLD the accumulator rather than producing an
 * angle from a degenerate basis. `upFloor` is the length below which the basis
 * is refused; it is the caller's, because how vertical a path is allowed to get
 * before its diagram stops reporting roll is a legibility call.
 */
export function unwrappedRoll(
  path: Pick<RibbonPath, 'n' | 'px' | 'py' | 'pz' | 'bx' | 'by' | 'bz'>,
  out: Float32Array, upFloor: number,
): { min: number; max: number } {
  const TWO_PI = Math.PI * 2;
  const n = path.n;
  let acc = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, k = (i + n - 1) % n;
    // central-difference tangent, normalised
    let tx = path.px[j]! - path.px[k]!, ty = path.py[j]! - path.py[k]!, tz = path.pz[j]! - path.pz[k]!;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // level up = +Y with the tangent projected out; level right = t x up
    const d = ty;
    let ux = -tx * d, uy = 1 - ty * d, uz = -tz * d;
    const ul = Math.hypot(ux, uy, uz);
    if (ul < upFloor) { out[i] = acc; continue; }   // degenerate: hold
    ux /= ul; uy /= ul; uz /= ul;
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    const bX = path.bx[i]!, bY = path.by[i]!, bZ = path.bz[i]!;
    const a = Math.atan2(
      bX * ux + bY * uy + bZ * uz,
      bX * rx + bY * ry + bZ * rz,
    );
    if (i === 0) { prev = a; acc = 0; } else {
      let dA = a - prev;
      dA -= TWO_PI * Math.round(dA / TWO_PI);
      acc += dA;
      prev = a;
    }
    out[i] = acc;
  }
  let min = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const v = out[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
