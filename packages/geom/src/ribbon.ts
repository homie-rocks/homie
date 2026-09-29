/**
 * ============================================================================
 *  ribbon — a baked station table, the frame on it, and the cross-section
 * ============================================================================
 *  `station.ts` next door owns the line a DRIVER steers. This file owns the
 *  SURFACE that line runs on: a closed centreline already resampled to uniform
 *  arc length, the orthonormal frame carried along it, the lateral profile cut
 *  across it, and the grid-accelerated "which station is this world point
 *  nearest" that every physics query in both racers starts with.
 *
 *  The two racing games this was extracted from each carried a track module
 *  forked from one file. One circuit is a coastal road with a hillside beside
 *  it; the other is a construction deck that rolls through 360° with vacuum
 *  beside it. Those two facts make about a third of the pair genuinely
 *  different — and left the rest byte-identical, comments included, apart from
 *  ELEVEN NUMBERS. That is what lives here.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS FILE REFUSES, AND WHY THE REFUSALS ARE THE INTERESTING PART
 * ---------------------------------------------------------------------------
 *  These five stayed in the games after being read line by line. Each is a
 *  BEHAVIOUR that differs, not a value, and a shared version of any of them
 *  would have to pick a winner and make one game wrong:
 *
 *   · `crossPoint` / `surfaceY` — the kart racer clamps the lateral term at
 *     the kerb edge and then walks outward along the HORIZONTAL right, because
 *     a hillside does not bank with the road. The space racer builds the point
 *     entirely along the deck normal, because the structure is welded to the
 *     deck. Sharing them means choosing world Y or the deck frame; wrong by
 *     the whole bank angle, and wrong in SIGN once the deck inverts.
 *   · `slopeNormal` — the kart racer crosses two frame axes and then forces
 *     the result into the upper hemisphere (`if (out.y < 0) out.negate()`).
 *     The space racer must not: on the underside of an inversion a normal
 *     that points down in world space is the CORRECT one, and flipping it
 *     sucks every ship through the plate.
 *   · `shoulderOffset` — the same three-segment ramp, but the kart racer's far
 *     target is an ABSOLUTE world height (it subtracts the shoulder edge's own
 *     world Y to get there) and the space racer's is relative to the apron in
 *     the deck frame. Same shape as the chase cameras' eye constraint: one
 *     works in world Y, the other in depth along a normal.
 *   · `probe` — the station-resolution prologue is identical and is not what
 *     makes it long. What makes it long is a sea floor and a heightfield blend
 *     on one side and a hover depth along the normal and a void section on the
 *     other.
 *   · `collideWalls` — one is a point test with a horizontal push; the other is
 *     swept at 1.2 m and pushes along the banked binormal.
 *
 *  It also refuses, on OWNERSHIP rather than on divergence: `checkpointAt`,
 *  `zoneAt`, `routeOffset`, the start grid and every surface classification.
 *  A package may know what a spline, a ribbon, a width profile and a banking
 *  angle are. It may not know what a lap is, what a checkpoint is, what a
 *  racing line is for, or what winning looks like.
 *
 * ---------------------------------------------------------------------------
 *  THE ARITHMETIC IS THE CONTRACT.
 * ---------------------------------------------------------------------------
 *  Every expression below is the games' own, in the games' own evaluation
 *  order, down to `(i + shift + cl.count) % cl.count` and the exact bucket
 *  ordering of `buildStationGrid`. Float32Array stores round; reordering two of
 *  these sums moves a probe by microns and a bake by more, and a parity test
 *  pins the result bit-exact — Object.is, with -0 kept distinct from 0, never
 *  an epsilon — against tables taken from the games' own source before
 *  extraction. Do not tidy it.
 *
 *  `three` DOES NOT CROSS THIS SEAM. The two functions that write a vector
 *  write through `Vec3Out` (three numbers and a setter), which `THREE.Vector3`
 *  satisfies structurally. There is no second copy of three.js to be an
 *  `instanceof` universe of its own.
 * ============================================================================
 */

import type { Vec3Out } from './station.ts';

/**
 * smoothstep; `a > b` is legal and gives a descending ramp.
 *
 * A LOCAL COPY ON PURPOSE, and a parity test asserts it is character-for-
 * character the games' own. Importing the games' `smoothstep` would make this
 * package depend on a game, and re-deriving it "equivalently" is how a ramp
 * ends up 1e-16 different at one end and a Float32 store rounds the other way.
 */
function ss(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

// ===========================================================================
//  The shapes. Each is exactly the fields the functions below actually read,
//  which is what lets both games satisfy them structurally with no call-site
//  change and no game context object anywhere near this package.
// ===========================================================================

/** A closed centreline cut into `count` stations `ds` metres apart. */
export interface RibbonPath {
  count: number;
  /** metres between stations */
  ds: number;
  /** arc length of the whole closed path, metres */
  length: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
}

/**
 * …plus the orthonormal frame and the width/bank profile carried along it.
 *
 * `n` is the surface "up" and `b` the surface "right". Whether they are banked,
 * rolled, or neither is the caller's business — nothing here reads world Y.
 */
export interface RibbonFrame extends RibbonPath {
  tx: Float32Array; ty: Float32Array; tz: Float32Array;
  nx: Float32Array; ny: Float32Array; nz: Float32Array;
  bx: Float32Array; by: Float32Array; bz: Float32Array;
  half: Float32Array;
  bank: Float32Array;
}

/** …plus the edge-strip blend weight the cross-section multiplies by. */
export interface RibbonProfile extends RibbonFrame {
  kerb: Float32Array;
}

/**
 * A vector whose mutators chain, which is every vector library there has ever
 * been and specifically `THREE.Vector3`. Declared standalone rather than
 * extending `Vec3Out` so the return types really are the interface and
 * `.set(…).normalize()` type-checks without a cast.
 */
export interface Vec3Chain {
  x: number; y: number; z: number;
  set(x: number, y: number, z: number): Vec3Chain;
  normalize(): Vec3Chain;
  crossVectors(a: Vec3Out, b: Vec3Out): Vec3Chain;
}

/**
 * What `sampleFrame` fills in. A caller's own sample type will carry more
 * (a roll accumulator, a solar term, a section kind); those are the caller's
 * and this function does not touch them.
 */
export interface FrameSample {
  pos: Vec3Out;
  tangent: Vec3Chain;
  normal: Vec3Chain;
  binormal: Vec3Chain;
  halfWidth: number;
  bank: number;
  distance: number;
  t: number;
}

// ===========================================================================
//  Sampling
// ===========================================================================

/**
 * The frame at normalised progress `t`, written into `s`.
 *
 * `t` is arc length over total length BY CONSTRUCTION — the station table is
 * uniform — so there is no reparameterisation LUT bolted on afterwards and
 * `distance` is a multiply.
 *
 * The frame is RE-ORTHOGONALISED rather than lerping a third vector, so it
 * stays exactly right-handed after interpolation. On a flat road that is a
 * tidiness; on a deck whose two straddling normals are 0.9° apart through an
 * inversion, a frame 1° off orthogonal is a chassis 1° off orthogonal.
 */
export function sampleFrame<S extends FrameSample>(cl: RibbonFrame, t: number, s: S): S {
  const n = cl.count;
  t = t - Math.floor(t);
  const f = t * n;
  let i = Math.floor(f);
  if (i >= n) i = n - 1;
  const u = f - i;
  const j = (i + 1) % n;
  s.pos.set(
    cl.px[i] + (cl.px[j] - cl.px[i]) * u,
    cl.py[i] + (cl.py[j] - cl.py[i]) * u,
    cl.pz[i] + (cl.pz[j] - cl.pz[i]) * u,
  );
  s.tangent.set(
    cl.tx[i] + (cl.tx[j] - cl.tx[i]) * u,
    cl.ty[i] + (cl.ty[j] - cl.ty[i]) * u,
    cl.tz[i] + (cl.tz[j] - cl.tz[i]) * u,
  ).normalize();
  s.normal.set(
    cl.nx[i] + (cl.nx[j] - cl.nx[i]) * u,
    cl.ny[i] + (cl.ny[j] - cl.ny[i]) * u,
    cl.nz[i] + (cl.nz[j] - cl.nz[i]) * u,
  ).normalize();
  s.binormal.crossVectors(s.tangent, s.normal).normalize();
  s.normal.crossVectors(s.binormal, s.tangent).normalize();
  s.halfWidth = cl.half[i] + (cl.half[j] - cl.half[i]) * u;
  s.bank = cl.bank[i] + (cl.bank[j] - cl.bank[i]) * u;
  s.distance = t * cl.length;
  s.t = t;
  return s;
}

/**
 * The station index containing `t`, wrap-safe for a negative or >1 argument.
 *
 * Deliberately NOT the same rounding as `sampleFrame`'s `i`: this one is a
 * containment test for a per-station channel, so it floors and wraps rather
 * than clamping the last station.
 */
export function stationOfT(count: number, t: number): number {
  return ((Math.floor((t - Math.floor(t)) * count) % count) + count) % count;
}

/**
 * The centreline flattened to XZ at `samples` even steps.
 *
 * Plan projection only — it drops the height, which is why it is the right
 * thing for a plan-view readout and the wrong thing for anything on the
 * surface.
 */
export function pathXZ(cl: RibbonPath, samples: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let k = 0; k < samples; k++) {
    const f = (k / samples) * cl.count;
    const i = Math.floor(f) % cl.count;
    const j = (i + 1) % cl.count;
    const u = f - Math.floor(f);
    out.push({
      x: cl.px[i] + (cl.px[j] - cl.px[i]) * u,
      z: cl.pz[i] + (cl.pz[j] - cl.pz[i]) * u,
    });
  }
  return out;
}

// ===========================================================================
//  Station lookup
// ===========================================================================

/** A plan-space bucket grid over the centreline; `buildStationGrid` fills it. */
export interface StationGrid {
  cell: number;
  x0: number; z0: number;
  w: number; h: number;
  buckets: Int32Array[];
}

/**
 * Bucket the stations by plan position so a cold lookup does not sweep the
 * whole table.
 *
 * One candidate per metre is ample: the bucket only nominates a seed and the
 * refine pass does the rest. The `+ 3` on each dimension and the one-cell
 * negative pad are what keep `Math.floor((x - x0) / cell)` in range for a point
 * exactly on the minimum corner.
 */
export function buildStationGrid(cl: RibbonPath, cell: number): StationGrid {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < cl.count; i++) {
    if (cl.px[i] < minx) minx = cl.px[i];
    if (cl.px[i] > maxx) maxx = cl.px[i];
    if (cl.pz[i] < minz) minz = cl.pz[i];
    if (cl.pz[i] > maxz) maxz = cl.pz[i];
  }
  const g: StationGrid = {
    cell,
    x0: minx - cell,
    z0: minz - cell,
    w: Math.ceil((maxx - minx) / cell) + 3,
    h: Math.ceil((maxz - minz) / cell) + 3,
    buckets: [],
  };
  const tmp: number[][] = new Array(g.w * g.h);
  const step = Math.max(1, Math.round(1 / cl.ds));
  for (let i = 0; i < cl.count; i += step) {
    const cx = Math.floor((cl.px[i] - g.x0) / cell);
    const cz = Math.floor((cl.pz[i] - g.z0) / cell);
    const k = cz * g.w + cx;
    (tmp[k] || (tmp[k] = [])).push(i);
  }
  g.buckets = new Array(g.w * g.h);
  for (let k = 0; k < tmp.length; k++) if (tmp[k]) g.buckets[k] = Int32Array.from(tmp[k]);
  return g;
}

/** Plan extent of the centreline — the same four numbers `buildStationGrid`
 *  takes, published because a caller that lays structure out beyond the ribbon
 *  needs them and must not re-walk the table to a different answer. */
export function planExtent(cl: RibbonPath): { minx: number; maxx: number; minz: number; maxz: number } {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < cl.count; i++) {
    if (cl.px[i] < minx) minx = cl.px[i];
    if (cl.px[i] > maxx) maxx = cl.px[i];
    if (cl.pz[i] < minz) minz = cl.pz[i];
    if (cl.pz[i] > maxz) maxz = cl.pz[i];
  }
  return { minx, maxx, minz, maxz };
}

/**
 * Walk `±span` stations either side of `seed` and keep the nearest.
 *
 * TWO-DIMENSIONAL OR THREE, AND `y` IS THE SWITCH. Pass `NaN` (the default) and
 * the vertical term is exactly `+ 0`, which is the coastal-road formulation to
 * the bit — a Float64 sum with a positive zero added to it is unchanged. Pass a
 * real `y` and the refine minimises true 3-D distance, which is the only
 * correct thing on a ribbon that climbs 40 m and passes over itself: two
 * stations 30 m apart vertically can be 2 m apart in plan.
 */
export function refineStation(
  cl: RibbonPath, x: number, z: number, y: number, seed: number, span: number,
): number {
  const n = cl.count;
  const use3d = y === y; // NaN-safe: NaN !== NaN, so an unsupplied y stays 2-D
  let best = seed, bestD = Infinity;
  for (let k = -span; k <= span; k++) {
    const i = (seed + k + n) % n;
    const ex = cl.px[i] - x, ez = cl.pz[i] - z;
    const ey = use3d ? cl.py[i] - y : 0;
    const d = ex * ex + ez * ez + ey * ey;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Nearest station to a world point — global, grid accelerated.
 *
 * The grid is indexed in XZ because that is what makes it cheap; the refine
 * pass is 3-D when a `y` is supplied. An unhinted lookup is only trustworthy
 * out to half the ribbon's worst self-approach — anything closer than that, and
 * everything ON the surface at speed, MUST pass a hint to `findStation`.
 */
export function nearestStation(
  cl: RibbonPath, g: StationGrid, x: number, z: number, y: number, span: number,
): number {
  let best = -1, bestD = Infinity;
  const cx = Math.floor((x - g.x0) / g.cell);
  const cz = Math.floor((z - g.z0) / g.cell);
  for (let r = 1; r <= 3 && best < 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      const zz = cz + dz;
      if (zz < 0 || zz >= g.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= g.w) continue;
        const b = g.buckets[zz * g.w + xx];
        if (!b) continue;
        for (let n = 0; n < b.length; n++) {
          const i = b[n];
          const ex = cl.px[i] - x, ez = cl.pz[i] - z;
          const d = ex * ex + ez * ez;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
  }
  if (best < 0) {
    // far outside the ribbon entirely (open sea, open vacuum): strided sweep
    for (let i = 0; i < cl.count; i += 8) {
      const ex = cl.px[i] - x, ez = cl.pz[i] - z;
      const d = ex * ex + ez * ez;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return refineStation(cl, x, z, y, best, span);
}

/**
 * The three numbers the two games disagree about on the hot lookup, and
 * nothing else. Everything not here was identical: the stride of 8, the
 * coarse-then-fine order, the half-table clamp, and the fallback to the grid.
 */
export interface FindStationOpts {
  /** metres of PROGRESS swept either side of the hint. 45 on a road at 60 m/s,
   *  60 on a deck at 165 m/s — where a two-frame-stale hint is 11 m of ribbon
   *  and a 45 m window has already given up and paid for a global search. */
  window: number;
  /** metres beyond which the hinted answer is disbelieved and retried globally */
  accept: number;
  /** `refineStation` span for the cold fallback */
  coldSpan: number;
}

/**
 * Hot path. With a hint we sweep a window of PROGRESS, coarse then fine;
 * without one, or when the hinted answer is implausibly far, we fall back to
 * the grid.
 *
 * A stale hint — a respawn, or a shell launching somebody off the surface
 * entirely — is caught by the `accept` check rather than trusted, which is the
 * whole reason the check is a distance and not a flag.
 */
export function findStation(
  cl: RibbonPath, g: StationGrid,
  x: number, y: number, z: number, hintT: number, o: FindStationOpts,
): number {
  const n = cl.count;
  if (hintT >= 0) {
    const use3d = y === y;
    const centre = Math.floor((hintT - Math.floor(hintT)) * n) % n;
    const half = Math.min(n >> 1, Math.round(o.window / cl.ds));
    let best = centre, bestD = Infinity;
    const stride = 8;
    for (let k = -half; k <= half; k += stride) {
      const i = (centre + k + n) % n;
      const ex = cl.px[i] - x, ez = cl.pz[i] - z;
      const ey = use3d ? cl.py[i] - y : 0;
      const d = ex * ex + ey * ey + ez * ez;
      if (d < bestD) { bestD = d; best = i; }
    }
    best = refineStation(cl, x, z, y, best, stride);
    const ex = cl.px[best] - x, ez = cl.pz[best] - z;
    const ey = use3d ? cl.py[best] - y : 0;
    if (ex * ex + ey * ey + ez * ez < o.accept * o.accept) return best;
  }
  return nearestStation(cl, g, x, z, y, o.coldSpan);
}

// ===========================================================================
//  Cross-section
// ===========================================================================

/**
 * The flattened outer apron on a steeply banked section, in metres of drop
 * along the surface normal.
 *
 * A banked corner puts its outer lip well "above" the centreline in the surface
 * frame, and a chase camera on the inside line sits BELOW that lip — so
 * everything outboard of the corner is occluded by the running surface's own
 * outer edge. That is a property of banking and not a bug; no amount of
 * shoulder-lowering lets a camera at 2.2 m see over a lip 4.3 m above it.
 *
 * What a real banked structure does have, and neither of these did, is a
 * flattened apron: the outer fifth of the width eases off the full cross-slope.
 * It buys lip height back, it makes the outside of the corner a genuinely
 * different surface from the fast line rather than more of the same plane, and
 * it gives running wide somewhere to go.
 *
 * Both ends of the ramp are `smoothstep`, so the surface stays C1: no crease
 * for the physics to catch on and no slope break for a gloss strip to kink
 * over. `t` clamps at 1, so the edge strip and the shoulder inherit the full
 * lip drop and ride down with the surface edge instead of leaving a step at the
 * joint.
 *
 * THE GATE IS NOT HERE. One game suppresses this wherever the surface is
 * enclosed or absent — a bore has a wall where the apron would be — and what
 * counts as enclosed is a genre fact this package must not learn. The caller
 * returns 0 before calling.
 */
export interface ApronSpec {
  /** fraction of half-width at which the apron starts easing off */
  t0: number;
  /** fraction of the outer lip's rise the apron gives back */
  frac: number;
  /** |bank| in radians at which the apron begins … */
  rampLo: number;
  /** … and at which it is fully in. 0.314 (18°) was authored against one 20°
   *  corner; a 42° deck saturates it on every corner on the lap and the ramp
   *  stops discriminating, so that one runs 0.436 (25°). A VALUE. */
  rampHi: number;
}

export function apronDrop(cl: RibbonFrame, i: number, L: number, a: ApronSpec): number {
  const bank = cl.bank[i];
  const amt = ss(a.rampLo, a.rampHi, Math.abs(bank));
  if (amt <= 0) return 0;
  const hw = cl.half[i];
  // the raised side is the one the bank sign points at
  const t = Math.min(1, (bank >= 0 ? L : -L) / hw);
  if (t <= a.t0) return 0;
  const f = ss(a.t0, 1, t);
  return amt * f * f * hw * Math.abs(Math.sin(bank)) * a.frac;
}

/**
 * The raised edge strip — a kerb on a road, a bolted-on edge band on a deck —
 * evaluated straight off the caller's `qs`/`hs` breakpoint table: a flush
 * joint, a steep inner face, a shallow bevel, a flat crown carrying the rumble
 * ripple, then the outer chamfers down to the shoulder.
 *
 * Piecewise-linear on purpose. It means the flat facet normals a mesh builder
 * derives from consecutive breakpoints are EXACT rather than a finite
 * difference smeared across creases.
 *
 * The ripple is confined to the crown so it never disturbs the face or the
 * bevel angle — those two facets are the whole point of the profile. It is
 * bounded by the named crown constants, not by positions in the breakpoint
 * table: the table gains and loses chamfers, and the ripple must not move when
 * it does. Amplitude and wavelength travel together in one spec because a mesh
 * has to sample this at better than half the wavelength and the two numbers
 * cannot be allowed to drift apart.
 */
export interface KerbSpec {
  /** width of the strip, metres */
  w: number;
  /** breakpoint abscissae, ascending, ending at `w` */
  qs: readonly number[] | Float32Array;
  /** breakpoint heights */
  hs: readonly number[] | Float32Array;
  /** where the crown window opens … */
  crown0: number;
  /** … and where it starts closing */
  crown1: number;
  /** how far past `crown1` the window takes to close. 0.14 on one, 0.10 on the
   *  other, and the only difference between the two bodies. A VALUE. */
  crownFall: number;
  /** ripple amplitude, metres */
  rippleA: number;
  /** ripple wavenumber, radians per metre of arc */
  rippleK: number;
}

export function kerbProfile(cl: RibbonPath, q0: number, i: number, k: KerbSpec): number {
  const q = q0 < 0 ? 0 : q0 > k.w ? k.w : q0;
  let n = 1;
  while (n < k.qs.length - 1 && q > k.qs[n]) n++;
  const a = k.qs[n - 1], bq = k.qs[n];
  const h = k.hs[n - 1] + (k.hs[n] - k.hs[n - 1]) * ((q - a) / (bq - a));
  const crown = ss(k.crown0 - 0.10, k.crown0, q) * (1 - ss(k.crown1, k.crown1 + k.crownFall, q));
  return h + k.rippleA * Math.sin(i * cl.ds * k.rippleK) * crown;
}

/**
 * What `crossOffset` and `crossSlope` need from the object that owns them.
 *
 * The three callbacks are the pieces that are NOT shared. `apronDrop` is the
 * caller's gated wrapper around this file's; `kerbProfile` likewise; and
 * `shoulderOffset` is the one whose two versions genuinely disagree (see the
 * refusals at the top). Both games satisfy this with the methods they already
 * had; those three must not be `private`, because TypeScript will not match a
 * `private` field structurally.
 */
export interface CrossHost {
  readonly cl: RibbonProfile;
  apronDrop(i: number, L: number): number;
  kerbProfile(q0: number, i: number): number;
  shoulderOffset(i: number, left: boolean, q: number): number;
  crossOffset(i: number, L: number): number;
}

/** The constants of the cross-section a caller owns. */
export interface CrossSpec {
  /** parabolic camber drop at the edge of the running surface, metres */
  crown: number;
  /** width of the raised edge strip, metres */
  kerbW: number;
  /** height the edge strip hands over to the shoulder at */
  kerbEnd: number;
}

/**
 * Offset of the ground from the banked plane at lateral `L`, measured along
 * whatever the caller's normal is — world up on a road, the deck normal on a
 * structure. It is the SINGLE SOURCE OF TRUTH for the shape: the mesh builder,
 * the physics probe and the collision surface all read this one function, which
 * is why they cannot disagree. Add a term HERE and every sweep follows.
 */
export function crossOffset(h: CrossHost, i: number, L: number, s: CrossSpec): number {
  const cl = h.cl;
  const a = Math.abs(L);
  const hw = cl.half[i];
  const apron = h.apronDrop(i, L);
  if (a <= hw) {
    const r = a / hw;
    return -s.crown * r * r - apron;
  }
  const kerbAmt = cl.kerb[i];
  const q0 = a - hw;
  if (q0 <= s.kerbW) return -s.crown - apron + h.kerbProfile(q0, i) * kerbAmt;
  return -s.crown - apron + s.kerbEnd * kerbAmt + h.shoulderOffset(i, L < 0, q0 - s.kerbW);
}

/**
 * d(crossOffset)/dL on the running surface: the extra lateral slope the surface
 * carries on top of the banked plane.
 *
 * Taken as a DIFFERENCE OF THE SAME FUNCTION THE VERTICES COME FROM, not
 * analytically. It used to be the exact derivative of the camber parabola,
 * which was right while the camber was the only term inside the edges. It no
 * longer is — the apron adds up to 14° of its own over the outer fifth of a
 * banked corner — and a mesh that BENDS while its shading normal does not is a
 * flat-looking dent. This is the only way the two cannot drift apart again.
 *
 * Clamped to the running surface at both ends so the difference never straddles
 * the edge junction and reports the strip's 31° face as surface slope.
 */
export function crossSlope(h: CrossHost, i: number, L: number): number {
  const hw = h.cl.half[i];
  const d = 0.2;
  const a = Math.max(-hw, Math.min(hw, L - d));
  const b = Math.max(-hw, Math.min(hw, L + d));
  if (b - a < 1e-6) return 0;
  return (h.crossOffset(i, b) - h.crossOffset(i, a)) / (b - a);
}

// ===========================================================================
//  Bulk sweeps
// ===========================================================================

/** What `sweepEnvelope` needs: a point-on-surface function and the widths. */
export interface EnvelopeHost {
  readonly cl: RibbonFrame;
  crossPoint(i: number, L: number, out: Vec3Out): Vec3Out;
}

/**
 * Both outer edges of the corridor, every `stride` stations, expanded into
 * `min`/`max`.
 *
 * Deliberately does NOT apply a vertical pad. What sits above and below the
 * ribbon — a headland, a spine, a substructure, a sea floor — is the caller's,
 * and the two games' policies are not the same operation: one clamps the floor
 * to an absolute sea level, the other expands symmetrically. Sharing the SWEEP
 * and not the ENVELOPE is the honest split.
 */
export function sweepEnvelope(
  h: EnvelopeHost, extra: number, stride: number,
  min: Vec3Out & { min(v: Vec3Out): unknown },
  max: Vec3Out & { max(v: Vec3Out): unknown },
  scratch: Vec3Out,
): void {
  const cl = h.cl;
  for (let i = 0; i < cl.count; i += stride) {
    for (let s = -1; s <= 1; s += 2) {
      h.crossPoint(i, s * (cl.half[i] + extra), scratch);
      min.min(scratch); max.max(scratch);
    }
  }
}

/**
 * Free every geometry and material hanging under an object.
 *
 * `?.dispose?.()` throughout rather than a type test: a scene graph at teardown
 * legitimately contains lights, groups and bones with no geometry at all, and a
 * teardown that throws on the first one leaks everything after it.
 */
export function disposeTree(root: { traverse(fn: (o: any) => void): unknown }): void {
  root.traverse((o: any) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
    else m?.dispose?.();
  });
}
