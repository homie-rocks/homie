/**
 * ============================================================================
 *  principalAxisFit — lay a closed world-space path flat on a panel.
 * ============================================================================
 *
 *  WHAT THIS IS FOR. A circuit is authored at whatever angle the level layout
 *  happened to close at. Projected straight from world XZ to canvas XY it sits
 *  diagonally across the panel and wastes most of it — and the panel is the
 *  scarcest area on a television HUD. The 2x2 covariance of the path's XZ has a
 *  closed-form dominant eigenvector, so the angle that lays the path's long
 *  axis along the panel's long axis is a dozen flops and is computed ONCE.
 *
 *  THE DIRECTION TEST MATTERS AS MUCH AS THE ANGLE, and it is the half that is
 *  easy to leave out. An eigenvector has no sign: `a` and `a + PI` fit equally
 *  well, so the same circuit can bake MIRRORED between two runs of the same
 *  build. A map you have to read backwards is worse than no map. The caller
 *  hands in the direction that must run left-to-right on screen — for a race
 *  that is the racing line crossing the start line — and the fit rotates by
 *  `PI` when the eigenvector disagrees with it.
 *
 *  WHY IT IS HERE AND NOT IN A GAME. Two games computed this same fit: a kart
 *  racer's minimap (a plan-view ribbon) and a space racer's (an axonometric
 *  one). The two DRAWINGS have nothing in common and neither should ever be
 *  shared — the space racer's file argued that at length and it is right. The
 *  FIT is not the drawing. This package owns `principalAxisFit` and never owns
 *  "a minimap"; that line is the whole boundary and this file is on the
 *  correct side of it.
 *
 *  WHAT IS DELIBERATELY NOT HERE. No canvas, no colour, no sample count, no
 *  padding fraction, no choice of WHICH point downstream of the start line
 *  defines "forward". Those are legibility calls about one circuit at one panel
 *  size and they stay in the game.
 *
 *  ACCESSOR CALLBACKS, NOT AN ARRAY. The two callers hold their centreline in
 *  different shapes — an array of `{x, z}` objects and a pair of parallel
 *  `Float32Array`s — and converting either into the other's shape at boot would
 *  allocate a copy of the whole path to satisfy a signature. This runs once per
 *  build, so two indexed calls per point is free.
 * ============================================================================
 */

/** A direction in the world XZ plane. Need not be normalised. */
export interface PlanDir {
  readonly x: number;
  readonly z: number;
}

/** Where a projected point lands, in unrotated panel units. */
export interface PlanPoint {
  x: number;
  y: number;
}

/**
 * The fitted frame. Everything is world units except `rc`/`rs`, which are the
 * cosine and sine of the rotation that takes world XZ into fitted UV.
 *
 * BOTH ORIGINS ARE REPORTED, and that is not indecision. A plan view wants
 * `cx`/`cz` — the centre of the fitted BOX — because a circuit with a long spur
 * is not centred on its mean and centring it on the mean throws the spur off
 * the panel. A projection that also carries elevation, ribbon width or a
 * depth-sorted quad strip has to take its own extents from the projected
 * geometry rather than from the centreline, and wants the raw centroid
 * `mx`/`mz` so that its own pass is the one that decides the offset. Returning
 * one and making the other caller re-derive it is how the second copy of this
 * function got written in the first place.
 */
export interface PlanFit {
  /** cos of the rotation from world XZ to fitted UV */
  rc: number;
  /** sin of the rotation from world XZ to fitted UV */
  rs: number;
  /** centroid of the sampled path, world XZ */
  mx: number;
  mz: number;
  /** centre of the fitted bounding box, world XZ */
  cx: number;
  cz: number;
  /** extents of the path in fitted UV, world units. Never below 1. */
  spanU: number;
  spanV: number;
}

/**
 * Fit `n` points, indexed through `x` and `z`, and orient the result so that
 * `forward` runs toward +u.
 *
 * `n` must be at least 1; the caller decides what "enough of a path to draw" is
 * (both callers today require considerably more than one point before they will
 * bake anything, and that threshold is a legibility call, not a maths one).
 */
export function principalAxisFit(
  n: number,
  x: (i: number) => number,
  z: (i: number) => number,
  forward: PlanDir,
): PlanFit {
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) { mx += x(i); mz += z(i); }
  mx /= n;
  mz /= n;

  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < n; i++) {
    const dx = x(i) - mx;
    const dz = z(i) - mz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }

  // angle of the dominant eigenvector of [[sxx,sxz],[sxz,szz]]
  let a = 0.5 * Math.atan2(2 * sxz, sxx - szz);

  // An eigenvector has no sign. Without this the same path bakes mirrored
  // between runs — see the header.
  if (Math.cos(a) * forward.x + Math.sin(a) * forward.z < 0) a += Math.PI;

  // Rotating by -a puts the dominant axis on +u.
  const rc = Math.cos(-a);
  const rs = Math.sin(-a);

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = x(i) - mx;
    const dz = z(i) - mz;
    const u = dx * rc - dz * rs;
    const v = dx * rs + dz * rc;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }

  // Recentre on the fitted box, not on the centroid: a circuit with a long spur
  // is not centred on its mean.
  const uc = (uMin + uMax) * 0.5;
  const vc = (vMin + vMax) * 0.5;

  return {
    rc,
    rs,
    mx,
    mz,
    cx: mx + (uc * rc + vc * rs),
    cz: mz + (-uc * rs + vc * rc),
    // A degenerate path — every sample at one point, or a perfectly straight
    // run — would otherwise divide the panel by zero at fit time. Clamping the
    // SPAN rather than guarding the division keeps the failure visible as a
    // path drawn tiny in the middle of the panel instead of as a blank plate
    // with nothing in the log.
    spanU: Math.max(1, uMax - uMin),
    spanV: Math.max(1, vMax - vMin),
  };
}

/**
 * World XZ to fitted UV about `fit.cx`/`cz`, scaled and offset into panel
 * pixels. `out` is written in place: this is called once per marker per frame
 * and a returned object would be a per-frame allocation in the hot path.
 */
export function planProject(
  fit: PlanFit,
  x: number,
  z: number,
  scale: number,
  ox: number,
  oy: number,
  out: PlanPoint,
): void {
  const dx = x - fit.cx;
  const dz = z - fit.cz;
  out.x = ox + (dx * fit.rc - dz * fit.rs) * scale;
  out.y = oy + (dx * fit.rs + dz * fit.rc) * scale;
}

/**
 * Rotate a world XZ direction into fitted UV. Same rotation as `planProject`,
 * without the translation — a heading is a direction and must not be offset.
 * Getting this wrong is invisible on a path that happens to pass near the
 * origin, which is why it is one function rather than two open-coded pairs.
 */
export function planRotate(fit: PlanFit, x: number, z: number, out: PlanPoint): void {
  out.x = x * fit.rc - z * fit.rs;
  out.y = x * fit.rs + z * fit.rc;
}

/**
 * The uniform scale that fits the whole path inside `w` x `h` with `pad` of
 * each axis left as margin. `pad` is a FRACTION of the panel, per side.
 */
export function planScale(fit: PlanFit, w: number, h: number, pad: number): number {
  return Math.min((w * (1 - pad * 2)) / fit.spanU, (h * (1 - pad * 2)) / fit.spanV);
}
