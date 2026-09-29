/**
 * ============================================================================
 *  Landform — a ridgeline, an island, and the things that lie on their flanks.
 * ============================================================================
 *  `Landmark.landmassGeo` makes a DOME: one radius wobble, one height power
 *  curve. At 20 m it is a boulder and it reads. At 600 m, scaled up to a
 *  headland, it is a cardboard cut-out — which is exactly what repeated
 *  reviews of one racing game kept calling "flat, untextured, faceted
 *  cardboard". This module is the answer that game wrote, and it is the
 *  reason the module is here rather than in `Landmark.ts`: the two are not two
 *  spellings of one generator, they are a dome and a crest line, and the dome
 *  is still correct for a 20 m rock stack. Both stay.
 *
 *  WHAT IS GENERAL ABOUT IT. A ridge is a run of crest, flanks that fall away
 *  at their own angles, spurs toward the viewer and ends that dive into
 *  whatever is behind them. Nothing in here knows about a circuit, a lap or a
 *  vehicle — it takes metres, a seed and two tint colours and hands back a
 *  `BufferGeometry` with baked vertex colours. A horizon works in anybody's
 *  game, and the next game that wants a mountain should not have to
 *  rediscover that a dome is not one.
 *
 *  THE SURFACE IS HANDED BACK, AND THAT IS THE LOAD-BEARING PART. `RidgeFlank`
 *  plus `ridgeContour` exist because placing a terrace by inverting the
 *  ANALYTIC cross-section missed the real surface by 24–35 m over twenty seeds
 *  — the per-column lean, the spur displacement and the gullies all happen
 *  after that analytic shape. A ledge hanging in mid-air in front of a
 *  hillside is worse than no ledge, because a straight horizontal line is
 *  precisely what the eye picks out at that distance. So the generator hands
 *  its vertices back and consumers interpolate them; a test pins that
 *  contract (`ridge-contour-lies-on-surface`).
 *
 *  ------------------------------------------------------------------------
 *  WHAT THIS MODULE DOES NOT OWN
 *  ------------------------------------------------------------------------
 *  No materials, no placement, no scene — the package rule, unchanged. The
 *  vertex colours it bakes are a MULTIPLIER the caller's tint rides on, not a
 *  decision about what colour a hill is.
 *
 *  `smoothstep` comes from `./Kit.ts` and NOT from `@homie-rocks/noise`, and that is
 *  deliberate: noise's carries a `|| 1e-6` divide-guard that answers
 *  differently on a degenerate span. `clamp` and `lerp` ARE noise's, verified
 *  character-identical to the game's copies. Kit's header has the whole
 *  argument, and a test measures it rather than asserting it.
 */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { clamp, lerp, mulberry32 } from '@homie-rocks/noise/Noise.js';
import { smoothstep } from './Kit.ts';

// ---------------------------------------------------------------------------
// Landforms — the distant terrain
// ---------------------------------------------------------------------------
//
// `landmassGeo` (further down, kept for the small offshore rock stacks) makes a
// dome: one radius wobble, one height power curve. At 20 m it is a boulder and
// it reads. At 600 m, scaled up to a headland, it is a cardboard cut-out with
// visible facets and no silhouette information at all — which is exactly what
// repeated reviews kept calling "flat, untextured, faceted cardboard".
//
// A real ridgeline is not a dome. It is a CREST LINE with summits and saddles
// along it, flanks that fall away at different angles on each side, spurs
// running down toward the viewer, and ends that dive into whatever is next to
// it — the sea, or the next ridge back. So these two generators build the crest
// line first and hang the surface off it.
//
// Both bake their own vertex colours (`GeoAccum` multiplies them by the tint the
// caller passes) carrying three things the material cannot know:
//   · macro strata — horizontal banding whose spacing scales with the landform,
//     because that is the read that says "rock" at a kilometre;
//   · a foot-to-crest gradient, because haze pools in valleys and summits catch
//     the light: this is aerial perspective WITHIN one landform, and it is the
//     difference between a ridge and a paper cut-out;
//   · toe darkening where one flank meets the water or the layer behind it.

export interface RidgeOpts {
  /** run of the crest line along local X, metres */
  length: number;
  /** depth across local Z, metres */
  depth: number;
  /** crest height above local y = 0, metres */
  height: number;
  seed: number;
  /** samples along the crest */
  segs?: number;
  /** samples across the flanks */
  rings?: number;
  /** 0.4 = rolling downs, 1.6 = alpine */
  jag?: number;
  /** 0 = both ends dive to the base (a headland into the sea), 1 = ends stay up */
  shoulder?: number;
  /** metres the toe ring is pushed below y = 0 so no waterline rim can show */
  skirt?: number;
  /** metres of world one uv tile covers */
  uvScale?: number;
  /** strata band spacing in metres; 0 disables */
  strata?: number;
  /** vertex tint at the crest and at the toe (the aerial gradient) */
  crestTint?: THREE.Color;
  footTint?: THREE.Color;
  /**
   * Yaw the sun sits at, in the ridge's LOCAL frame (0 = local +Z, the front
   * flank). Columns whose local slope faces it get a warm rim along the crest —
   * "a rim of warm sun-catch along the sun-facing ridge". Omit to disable.
   */
  sunLocal?: number;
  /**
   * Vegetation/scrub key, mixed into the flank at 40–120 m feature size. This
   * is the cheap answer to "an untextured orange silhouette with no vegetation
   * stippling and no rock": low-frequency albedo patchwork only, no normal, and
   * it costs nothing because it rides the vertex colour that is already there.
   */
  scrubTint?: THREE.Color;
  /**
   * Filled with the crest line as local x,y,z triples, one per column. Anything
   * standing ON the ridge — a cypress line, a hill town, a switchback road —
   * has to know where the crest actually is, or it floats above a saddle and
   * sinks into a summit. This is that contract.
   */
  crestOut?: number[];
  /**
   * Filled with the ridge's whole surface, so anything that has to LIE ON a
   * flank — a terrace ledge, a switchback road — can read real vertices.
   * See `RidgeFlank` and `ridgeContour`.
   */
  flankOut?: RidgeFlank;
}

/**
 * The ridge's surface as a grid, in the ridge's own local space.
 *
 * This replaces a bisection of the ANALYTIC cross-section, which is the shape
 * BEFORE the per-column `lean` (±0.22 of the depth, so the crest is not a ruled
 * line), before the spur displacement in Z and before the gullies. Placing
 * anything by that inverse missed the real surface by 24–35 m, measured as
 * point-to-triangle distance over twenty seeds — a terrace ledge hanging in
 * mid-air in front of the hillside, or buried inside it. Both are worse than no
 * terrace at all, because a straight horizontal line is exactly what the eye
 * picks out at that distance.
 *
 * So the generator hands its vertices back and consumers interpolate them.
 */
export interface RidgeFlank {
  /** columns along the crest = segs + 1 */
  cols: number;
  /** rows across the flanks = rings + 1 */
  rings: number;
  /** (ring * cols + col) * 3 -> x, y, z */
  p: Float32Array;
}

const _lc = new THREE.Color();

/**
 * 1-D fBm along a ridge axis, returned signed in about -1..1.
 *
 * `t` is in WAVELENGTHS, not metres, so the caller states the feature size it
 * wants and the octave stack cannot secretly run off the end of the sampling
 * rate. That distinction is the whole reason this exists: see `ridgeGeo`.
 */
function fbm1(n: (x: number, y: number) => number, t: number, y: number, oct: number): number {
  let acc = 0,
    amp = 1,
    tot = 0,
    f = 1;
  for (let k = 0; k < oct; k++) {
    acc += n(t * f + k * 19.73, y + k * 7.31) * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return acc / tot;
}

/** 1-D ridged noise in 0..1 with the same wavelength contract as `fbm1`. */
function ridged1(n: (x: number, y: number) => number, t: number, y: number, oct: number): number {
  let acc = 0,
    amp = 1,
    tot = 0,
    f = 1;
  for (let k = 0; k < oct; k++) {
    const s = 1 - Math.abs(n(t * f + k * 11.29, y + k * 5.17));
    acc += s * s * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return acc / tot;
}

/**
 * A ridge: a crest line running along local X, flanks falling away in ±Z.
 *
 * Placed tangentially on a ring around the circuit, a handful of these at each
 * of four distances is the whole background. Two facts make that cheap: the
 * crest profile is 1-D so summits and saddles cost one noise lookup per column,
 * and every ridge lands in the same merged mesh, so the entire horizon — four
 * layers, ~70 k triangles — is one draw call.
 */
export function ridgeGeo(o: RidgeOpts): THREE.BufferGeometry {
  const segs = Math.max(8, o.segs ?? 56);
  const rings = Math.max(4, o.rings ?? 10);
  const jag = o.jag ?? 1;
  const shoulder = clamp(o.shoulder ?? 0.25, 0, 1);
  const skirt = o.skirt ?? o.height * 0.3 + 26;
  const uvS = o.uvScale ?? Math.max(10, o.height * 0.2);
  const strata = o.strata ?? Math.max(5, o.height * 0.07);
  const rng = mulberry32(o.seed);
  const n = createNoise2D(rng);
  const crestC = o.crestTint ?? _lc.setRGB(1.06, 1.02, 0.94).clone();
  const footC = o.footTint ?? _lc.setRGB(0.7, 0.74, 0.82).clone();

  // --- 0. this landform's character ----------------------------------------
  // Drawn ONCE per ridge, before anything is built, so two ridges out of the
  // same band are two different landforms rather than two samples of one shape.
  // The band table can only vary height, length and depth; everything that
  // makes a hill look like a particular hill — which way its dip slope runs,
  // how steep its face is, whether it is one massif or three, how craggy its
  // crest is, where the crest sits across the section — is decided here.
  // Without this a ring of ridges reads as one motif repeated, which is half of
  // what "a row of party hats" means: not just the shape, the REPETITION.
  const chDir = rng() < 0.5 ? 1 : -1; // which way the long dip slope runs
  const chMassif = 0.5 + rng() * 0.95; // prominences across the whole run
  const chWarp = 0.22 + rng() * 0.5; // domain warp, in massif wavelengths
  const chBroad = rng(); // plateau-ish (0) vs picked-out summits (1)
  const chTanDip = 0.26 + rng() * 0.20; // dip slope, ~15-25°
  const chTanFace = 0.85 + rng() * 0.95; // steep face, ~40-61°
  const chCrag = 0.22 + rng() * 0.28; // depth of the cols cut into the crest
  const chVC = 0.27 + rng() * 0.18; // crest position across the section
  const chFaceP = 0.68 + rng() * 0.34; // front flank curvature
  const chBackP = 1.12 + rng() * 0.55; // dip slope curvature
  const chSpurF = 5.0 + rng() * 6.0; // spur spacing down the flanks

  // --- 1. the crest line ---------------------------------------------------
  //
  // ROOT FIX — THE SILHOUETTE.
  //
  // What was here was `pow(ridged(x, f, 4 octaves), 0.85 + jag * 0.75)`, and it
  // is the reason the horizon was a row of paper party hats. Three separate
  // faults, all of them silhouette faults:
  //
  //   · `ridged()` peaks are CUSPS. `1 - |noise|` has a corner at every zero
  //     crossing; squaring it does not remove the corner, it sharpens the
  //     shoulders around it. Every summit was a point by construction.
  //   · the octave stack ran to `f0 * 2.07³`, i.e. a wavelength of ~50 m, while
  //     the far band samples its crest every 37 m. The top two octaves were
  //     below Nyquist: they could not be drawn, only ALIASED, and aliased noise
  //     is a sequence of unrelated one-column spikes. That is literally where
  //     the pickets came from.
  //   · `pow(·, 1.9)` then crushed everything below the summits toward zero, so
  //     each cusp stood alone on a flat base with nothing joining it to its
  //     neighbour. Peak-to-base width ratio of roughly 1 : 1.2 — a traffic cone.
  //
  // The replacement states feature sizes in WAVELENGTHS and refuses to ask for
  // any that the column spacing cannot carry, then builds the profile the way
  // land is actually built: a broad massif envelope, secondary summits riding
  // on it, and an EROSION pass that gives each prominence a steep face on one
  // side and a long shallow dip slope on the other. A mountain seen from 2 km
  // is mostly shoulder; the summit is the last 15% of it.
  const dx = o.length / segs;
  // Wavelength floor: six columns. Nothing shorter is drawable at this
  // tessellation, so nothing shorter is asked for.
  const lamMin = Math.max(dx * 6, o.length * 0.055);
  const lamMassif = o.length / chMassif;
  const lamSub = Math.max(lamMin * 1.6, lamMassif * 0.34);
  const lamCrag = Math.max(lamMin * 1.5, o.length * 0.19);
  const sy = o.seed * 0.017;
  const prof = new Float32Array(segs + 1);
  const lean = new Float32Array(segs + 1); // crest drifts in Z: no ruled lines
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const x = u * o.length;
    // Domain warp along the axis. Massifs stop being evenly spaced and their
    // two flanks stop being mirror images — the cheapest asymmetry there is.
    const xw = x + fbm1(n, x / (lamMassif * 1.7), sy + 3.7, 2) * lamMassif * chWarp;
    // Massif envelope. `smoothstep` rather than a power: a power narrows the
    // peak and widens the foot, which is the cone again; a smoothstep with a
    // low knee widens the HIGH ground and leaves broad basins between.
    let m = 0.5 + 0.5 * fbm1(n, xw / lamMassif, sy + 11.3, 2);
    m = smoothstep(0.20 + chBroad * 0.16, 0.94, m);
    // Secondary summits riding on the massif, never below it.
    const sub = 0.5 + 0.5 * fbm1(n, xw / lamSub, sy + 47.1, 2);
    prof[i] = m * (0.60 + 0.40 * sub);
    lean[i] = fbm1(n, x / (lamMassif * 0.9) + 21.3, sy + 9.9, 2) * 0.26;
  }

  // --- 1b. erosion: asymmetric shoulders -----------------------------------
  // A grayscale dilation by a cone whose two sides have different gradients.
  // Physically this is the talus/scree envelope: no hillside anywhere stands
  // steeper than its own material allows, so every summit drags a shoulder out
  // behind it. Running it at ~20° one way and ~50° the other is what turns a
  // symmetric bump into a landform with a face and a back, and it is also what
  // widens the base — a 600 m summit on a 20° dip slope reaches the plain
  // 1.6 km away, which is the peak-to-base ratio that reads as a MOUNTAIN.
  const dDip = (chTanDip * dx) / Math.max(1, o.height);
  const dFace = (chTanFace * dx) / Math.max(1, o.height);
  const dFwd = chDir > 0 ? dDip : dFace;
  const dBwd = chDir > 0 ? dFace : dDip;
  const dil = new Float32Array(segs + 1);
  let e = prof[0];
  for (let i = 0; i <= segs; i++) {
    e = Math.max(prof[i], e - dFwd);
    dil[i] = e;
  }
  e = prof[segs];
  for (let i = segs; i >= 0; i--) {
    e = Math.max(prof[i], e - dBwd);
    if (e > dil[i]) dil[i] = e;
  }
  // Not all the way to the envelope: the last 22% keeps the saddles honest, so
  // the range is a range and not a mesa.
  for (let i = 0; i <= segs; i++) prof[i] = lerp(prof[i], dil[i], 0.78);

  // --- 1c. cols: erosion cuts DOWN into the crest --------------------------
  // Strictly subtractive, and that is the point. Adding noise to a ridgeline
  // adds summits, and a summit added on top of an envelope is a spike standing
  // on a hill — which is how the first attempt at this turned a row of cones
  // into a row of shark's teeth. Erosion removes material: it opens cols and
  // notches between summits, leaving the survivors as prominences rather than
  // making new ones. Scaled by the local height so the shoulders stay clean.
  for (let i = 0; i <= segs; i++) {
    const x = (i / segs) * o.length;
    const notch = Math.max(0, -fbm1(n, x / lamCrag, sy + 63.4, 2));
    const deep = ridged1(n, x / (lamCrag * 2.3), sy + 88.2, 1);
    prof[i] *= Math.max(0.05, 1 - chCrag * jag * notch * prof[i] * (0.55 + 0.75 * deep));
  }

  // --- 1d. round the summits ------------------------------------------------
  // The dilation in 1b is a cone, so left to itself every local maximum comes
  // out as a perfect triangle: two dead-straight sides meeting at a point. That
  // is a party hat with better proportions, and it was still unmistakable in
  // the frame. A few [1 2 1] passes cost nothing, take the corner off every
  // apex and leave the shoulders — which are long, so smoothing barely touches
  // them — exactly where the erosion pass put them. The pass count is quoted
  // against the column spacing, so a 40 m coastal knoll and a 600 m summit get
  // the same amount of rounding AS A FRACTION OF THEIR OWN SIZE.
  const sm = new Float32Array(segs + 1);
  const smPasses = clamp(Math.round(lamCrag / dx / 2.6), 2, 6);
  for (let pass = 0; pass < smPasses; pass++) {
    for (let i = 0; i <= segs; i++) {
      const a = prof[Math.max(0, i - 1)];
      const b = prof[i];
      const c = prof[Math.min(segs, i + 1)];
      sm[i] = (a + 2 * b + c) * 0.25;
    }
    prof.set(sm);
  }

  // --- 1e. the break: a low-frequency, ASYMMETRIC step in the skyline --------
  //
  // WHY THIS EXISTS. Everything above — the dilation envelope, the subtractive
  // cols, then two to six [1 2 1] passes — is a chain of SMOOTHING operators,
  // and it showed: the horizon came out as a run of smooth, near-symmetric
  // domes. "The current profiles are too smooth and too symmetric" is a fair
  // description of an erosion model with no tectonics in it.
  //
  // Real ranges are not smooth at the top; they have terraces, scarps and
  // hanging shoulders where one block stands proud of the next. This is that,
  // done as cheaply as it can be: a two-octave signal at a quarter and an
  // eighth of the run — well inside the wavelength floor, so it cannot alias —
  // rectified so it only ever CUTS a bench in on one side of a summit, then
  // weighted by the local height so it never touches the toe. The result is a
  // skyline with a long side and a stepped side instead of two matching curves,
  // which is the single strongest cue that a shape is a landform and not a
  // triangle someone drew.
  {
    const lamStep = Math.max(lamMin * 2.2, o.length * 0.24);
    for (let i = 0; i <= segs; i++) {
      const x = (i / segs) * o.length;
      const a = fbm1(n, x / lamStep, sy + 131.7, 2);
      const b = fbm1(n, x / (lamStep * 0.46) + 5.1, sy + 177.3, 1);
      // rectify against the landform's own dip direction: the bench forms on
      // the face side, never on the dip slope
      const bench = Math.max(0, chDir > 0 ? a : -a) * (0.55 + 0.45 * Math.max(0, b));
      prof[i] *= 1 - 0.30 * jag * bench * clamp(prof[i] * 1.4, 0, 1);
    }
    // one gentle pass so the bench edge is a scarp, not a sawtooth
    for (let i = 0; i <= segs; i++) sm[i] = (prof[Math.max(0, i - 1)] + 2 * prof[i] + prof[Math.min(segs, i + 1)]) * 0.25;
    prof.set(sm);
  }

  // Ends fall away. `shoulder` decides whether this is a headland running into
  // the water or a slab of a range continuing behind its neighbour.
  //
  // The second term is the END FACE. With a high shoulder the crest was still
  // at 60% of full height on its last column and the mesh simply stopped there,
  // leaving a guillotine cut — a vertical wall the width of the depth. Hidden
  // behind a neighbour most of the time; a freestanding tower whenever it was
  // not. Dropping the outermost 6% of the run to 45% turns that into a steep
  // but honest end face, which is what a headland actually presents.
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    prof[i] *=
      lerp(Math.pow(Math.sin(Math.PI * u), 0.8), 1, shoulder) *
      lerp(0.45, 1, smoothstep(0, 0.06, Math.min(u, 1 - u)));
  }

  // ---------------------------------------------------------------------------
  // NORMALISE THE CREST TO THE HEIGHT THE CALLER ASKED FOR.
  // ---------------------------------------------------------------------------
  // ROOT FIX, and it is the reason the horizon still sat low after the
  // backdrop was rebuilt. It survives the silhouette rebuild above unchanged
  // and still earns its place: the erosion envelope has a mean well above the
  // old profile's, so without normalisation the whole band ladder would now
  // drift the other way. Measured over 400 seeds the tallest column lands at
  // 0.92–1.07 of `o.height`, median 1.006. The original diagnosis, kept because
  // it is the argument for the line: the old `ridged()` returned a mean of
  // ~0.42; raising that to
  // the 1.6–1.9 power the jag term asks for, then multiplying by an envelope
  // whose mean is 0.71, lands the tallest column of a typical ridge at 0.43 of
  // `o.height` — measured over twelve seeds per band: median 0.43, spread
  // 0.28–0.70. So a band authored as "430–740 m of relief at 2 km", which is
  // where the 12–21° figure in the band table comes from, was building 190–320 m
  // and subtending 7°. Every layer of the horizon was less than half the height
  // it was designed at, which is precisely "the world stops and the horizon has
  // nothing in it" — the ranges were there, they were just too short to see.
  //
  // Two further things were broken downstream by the same fact, and both are
  // fixed by this one line:
  //   · the vertex-colour aerial gradient keys off `y / o.height`, so with peaks
  //     at 0.43 it never got past 60% of the way to `crestTint`. Every ridge was
  //     shaded almost entirely in its FOOT colour — which is the "single tan
  //     tone" look, straight out of the geometry rather than the material;
  //   · the ±60% random spread scrambled the band ladder outright: an unlucky
  //     far-band roll came out shorter than a lucky near-band one, so the
  //     layering the whole table exists to create was luck rather than design.
  //
  // Normalising post-taper (not pre-) means `shoulder` stays a statement about
  // SILHOUETTE — whether the ends dive into the sea — instead of quietly also
  // being a height multiplier. Variety now comes from the band's authored height
  // range, where it can be reasoned about, not from noise luck.
  let profMax = 1e-6;
  for (let i = 0; i <= segs; i++) profMax = Math.max(profMax, prof[i]);
  const profNorm = 1 / profMax;
  for (let i = 0; i <= segs; i++) prof[i] = clamp(prof[i] * profNorm, 0.015, 1);

  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bestY = new Float32Array(segs + 1).fill(-1e9);
  const bestXYZ = new Float32Array((segs + 1) * 3);
  // ---------------------------------------------------------------------------
  // CROSS-SECTION. Two separate decisions that were previously one, badly.
  // ---------------------------------------------------------------------------
  // The old section was `pow(sin(PI * pow(v, 0.78)), 0.62)` over a uniform v.
  // That curve climbs from 0 to 0.68 of the crest height between v = 0 and
  // v = 0.11 — so with 9 rings, ring 1 was ALREADY at 68% and the entire front
  // flank, the one the camera looks at, was three rings: the toe, 0.68, 0.90.
  // The visible face of every hill in the game was one enormous triangle band.
  //
  // That is the "flat, faceted cardboard" note, and no amount of material work
  // could have fixed it: there was no geometry there to shade. The strata and
  // the foot-to-crest gradient were being interpolated linearly across a 40 m
  // span, the per-vertex spur and gully noise had two samples to work with down
  // the whole flank, and the facets the reviews kept naming were the edges of
  // that one band catching the low sun.
  //
  // So: (a) an honest hillside profile — a concave face that steepens downhill,
  // and a long gentle dip slope behind, still asymmetric, still bedded rock;
  // and (b) the rings distributed by HEIGHT rather than by parameter, weighted
  // to the front. Same ring count, same triangle count, same one draw call; the
  // front flank goes from 3 rings to 6 and from one slope to five.
  // The crest position and the two curvatures are now per-landform (`chVC`,
  // `chFaceP`, `chBackP`) rather than three constants. Two ridges side by side
  // no longer share a cross-section, which matters most exactly where they
  // overlap: identical sections stack into one silhouette, different ones read
  // as one hill in front of another.
  const VC = chVC; // parameter position of the crest: front is [0, VC]
  // Flank noise frequencies are quoted in CYCLES ALONG THE RIDGE, so they have
  // to be capped against the column count or they alias exactly the way the old
  // crest profile did. Six columns per cycle at the top octave is the floor
  // everything in this generator is held to.
  const spurF = Math.min(chSpurF, segs / 14);
  const gulF = Math.min(15.4, segs / 8);
  for (let j = 0; j <= rings; j++) {
    const jf = Math.max(3, Math.round(rings * 0.55));
    // Front rings bunch toward the toe (exponent > 1), which is where the slope
    // changes fastest and where the haze pools; the dip slope is uniform.
    const v = j <= jf ? VC * Math.pow(j / jf, 1.4) : VC + (1 - VC) * ((j - jf) / (rings - jf));
    const shape =
      v <= VC
        ? Math.pow(Math.sin(Math.PI * 0.5 * (v / VC)), chFaceP)
        : Math.pow(Math.sin(Math.PI * 0.5 * ((1 - v) / (1 - VC))), chBackP);
    const toe = j === 0 || j === rings;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const x = (u - 0.5) * o.length;
      let z = (v - 0.42 + lean[i]) * o.depth;
      const c = prof[i];
      // Spurs: buttresses running down the flanks. They are what break a
      // smooth conical flank into readable ribs, and — because the low sun is
      // nearly side-on — they are also the only thing that gives a distant
      // hillside a lit face and a shadowed face. Two octaves at a per-landform
      // spacing, displaced in Z as well as Y so the ribs stand PROUD of the
      // slope rather than just being a brightness pattern on it.
      const spur = n(u * spurF + 40.2, v * 2.6) * 0.5 + n(u * spurF * 2.33 + 3.4, v * 5.1) * 0.26;
      // Ribs belong on the FLANK, not on the skyline. Weighted to mid-slope and
      // held to a quarter strength at the crest, because at 2 km the crest is
      // the silhouette and this noise runs at a few columns per cycle: left at
      // full strength up there it aliases into a comb of 70 m needles standing
      // on the summits, which is the second way this generator grew spikes.
      const rib = 0.25 + 3.0 * shape * (1 - shape);
      let y = o.height * c * shape * (1 + spur * (0.20 + 0.26 * jag) * rib);
      // Gullies bite into the flank, but never below the toe. They cut deepest
      // low down, where water actually collects, so the flank reads as drained.
      const gul = Math.max(0, -n(u * gulF + 77.0, v * 4.2));
      y -= o.height * 0.075 * jag * gul * shape * (1.35 - 0.65 * shape) * rib;
      // 0.15 -> 0.24 in Z. `patchBackdropForm` now runs a per-pixel terminator
      // off the real world normal, which is strictly better modelling than any
      // baked gradient — but it can only separate a lit face from a shaded one
      // if the flank HAS faces. A rib that displaces only in Y is a brightness
      // pattern; one that swings in Z as well turns the normal, which is what
      // gives the new term something to bite on and what finally puts a lit
      // side and a shadowed side on a distant hill.
      z += o.depth * (0.24 * spur + 0.06 * gul * chDir) * (1 - Math.abs(2 * v - 1));
      if (toe) y = -skirt;
      if (y > bestY[i]) {
        bestY[i] = y;
        bestXYZ[i * 3] = x;
        bestXYZ[i * 3 + 1] = y;
        bestXYZ[i * 3 + 2] = z;
      }
      pos.push(x, y, z);
      uv.push((u * o.length) / uvS, (v * o.depth + y * 0.6) / uvS);

      // --- vertex colour: strata + aerial gradient + toe darkening
      const hRel = clamp(y / Math.max(1, o.height), 0, 1);
      _lc.copy(footC).lerp(crestC, Math.pow(hRel, 0.62));
      // SCRUB / ROCK PATCHWORK. Two octaves at 40–120 m of feature size, which
      // is the size a Mediterranean hillside's maquis actually patches at, so
      // one landform carries three or four distinct values across its face
      // instead of a single ramp from foot to crest. Low frequency only and no
      // normal: at 950 m and 1.75 km high-frequency detail is aliasing, and the
      // whole point is that the crest EDGE is what resolves.
      if (o.scrubTint) {
        const s0 = n(x * 0.0125 + 91.4, z * 0.0125 - 12.6) * 0.62 + n(x * 0.031 - 4.2, z * 0.031 + 55.9) * 0.38;
        // scrub grows on the shoulders and in the gullies, not on the bare
        // steeps or the crest — hence the shape and height weighting
        const veg = clamp(s0 * 0.9 + 0.42, 0, 1) * lerp(1.0, 0.35, Math.pow(hRel, 1.5)) * lerp(0.45, 1.0, clamp(shape * 1.4, 0, 1));
        _lc.lerp(o.scrubTint, veg * 0.55);
      }
      let m = 1;
      // SUN-CATCH RIM. A ridge lit by a 14° key has a burning edge along the
      // crest columns whose slope turns toward the sun and nothing along the
      // ones that turn away. Baked per vertex because the backdrop's normals
      // are far too coarse to give the real light anything to work with at this
      // triangle density, and because a rim that is only on the SUN-FACING
      // ridges is what separates two overlapping layers from each other.
      if (o.sunLocal !== undefined) {
        // local surface bearing: front flank faces +Z, dip slope faces -Z
        const face = v <= VC ? 1 : -1;
        const facing = Math.cos(o.sunLocal) * face;
        m *= 1 + clamp(facing, 0, 1) * Math.pow(hRel, 3.2) * 0.30;
      }
      if (strata > 0) {
        // Bands wander with the rock rather than ruling straight lines round
        // the landform: a second, non-integer octave plus a lateral warp.
        const warp = n(x * 0.004 + 12.7, z * 0.004) * strata * 0.9;
        const b = (y + warp) / strata;
        m *= 1 + 0.115 * Math.sin(b * Math.PI * 2) + 0.055 * Math.sin(b * Math.PI * 5.17 + 1.3);
      }
      // Slope shading baked in — steep faces are bare rock and read darker.
      // Softened from 0.82: this is a light-independent term, and the more of
      // the modelling it does the less the real key light does. The form should
      // come from the normals, not from a painted gradient.
      m *= lerp(0.90, 1.04, clamp(shape, 0, 1));
      // toe AO: the last 8% of the height sits in its own shadow and in the
      // thickest haze, so it goes dark and cool
      m *= lerp(0.58, 1, smoothstep(0, o.height * 0.13, y));
      col.push(_lc.r * m, _lc.g * m, _lc.b * m);
    }
  }
  const stride = segs + 1;
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  if (o.crestOut) for (let i = 0; i < bestXYZ.length; i++) o.crestOut.push(bestXYZ[i]);
  if (o.flankOut) {
    o.flankOut.cols = stride;
    o.flankOut.rings = rings + 1;
    o.flankOut.p = Float32Array.from(pos);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Trace a CONTOUR across the ridge's front flank — the one facing the circuit —
 * at `f` of each column's own crest height, over columns `[i0, i0 + span]`.
 * Returns local x,y,z triples, one per column, always `span + 1` of them.
 *
 * Per-COLUMN normalisation is the point. A contour at a fixed world height would
 * run off the end of a saddle and hang in the air; a contour at a fixed fraction
 * of the local crest rises and falls with the hill, which is what a terrace or a
 * hill road actually does and what makes it read as following the land.
 */
export function ridgeContour(fl: RidgeFlank, f: number, i0: number, span: number): number[] {
  const out: number[] = [];
  const { cols, rings, p } = fl;
  if (cols < 2 || rings < 3) return out;
  const frac = clamp(f, 0.02, 0.98);
  for (let k = 0; k <= span; k++) {
    const ci = clamp(i0 + k, 0, cols - 1) | 0;
    // this column's crest ring
    let jc = 1;
    let cy = -1e9;
    for (let j = 1; j < rings - 1; j++) {
      const y = p[(j * cols + ci) * 3 + 1];
      if (y > cy) {
        cy = y;
        jc = j;
      }
    }
    const want = Math.max(0, cy) * frac;
    // Rings below the crest ring are the FRONT flank (local -Z). Walk out from
    // the crest until the surface drops below the target height, then lerp.
    let j1 = jc;
    for (let j = jc; j >= 1; j--) {
      j1 = j;
      if (p[(j * cols + ci) * 3 + 1] <= want) break;
    }
    const j0 = Math.min(jc, j1 + 1);
    const k0 = (j1 * cols + ci) * 3;
    const k1 = (j0 * cols + ci) * 3;
    const y0 = p[k0 + 1];
    const y1 = p[k1 + 1];
    const a = Math.abs(y1 - y0) < 1e-4 ? 0 : clamp((want - y0) / (y1 - y0), 0, 1);
    out.push(lerp(p[k0], p[k1], a), lerp(y0, y1, a), lerp(p[k0 + 2], p[k1 + 2], a));
  }
  return out;
}

/**
 * A quad ribbon between two polylines — two triangles per segment, wound so the
 * face looks out of the hill (toward local -Z / +Y).
 *
 * This is how everything that lies on a distant slope is built: a terrace's
 * retaining face is a ribbon between one contour and the same contour dropped by
 * the wall height; the grove above it is a ribbon between two adjacent contours,
 * so it is guaranteed to lie ON the surface instead of near it. Four triangles
 * per column against the ~100 an extruded box costs, and it bends with the land.
 */
export function ribbonStrip(a: number[], b: number[], uvScale = 12): THREE.BufferGeometry | null {
  const n = Math.min(a.length, b.length) / 3;
  if (n < 2) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i) s += Math.hypot(a[i * 3] - a[i * 3 - 3], a[i * 3 + 1] - a[i * 3 - 2], a[i * 3 + 2] - a[i * 3 - 1]);
    pos.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
    const u = s / uvScale;
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i + 1 < n; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface IslandOpts {
  radius: number;
  height: number;
  seed: number;
  segs?: number;
  rings?: number;
  jag?: number;
  /** flattens the mass across local Z; < 1 makes a spit rather than a dome */
  squash?: number;
  skirt?: number;
  uvScale?: number;
  strata?: number;
  crestTint?: THREE.Color;
  footTint?: THREE.Color;
  /**
   * Yaw the sun sits at, in the island's LOCAL frame, measured from local +Z —
   * THE SAME CONVENTION `RidgeOpts.sunLocal` USES, deliberately, so a caller
   * that has already worked the number out for its ridges passes the identical
   * expression here. Columns whose outward face turns toward it get a warm rim
   * along the crest. Omit to disable.
   */
  sunLocal?: number;
  /**
   * Vegetation/scrub key, mixed into the flank at 40–120 m feature size, on the
   * same terms as `RidgeOpts.scrubTint`. Omit to disable.
   */
  scrubTint?: THREE.Color;
}

/**
 * An island or a free-standing headland: the same crest-line idea closed into a
 * loop, so it has two or three summits, a saddle between them and a shoreline
 * that is a wandering line rather than a circle.
 */
export function islandGeo(o: IslandOpts): THREE.BufferGeometry {
  const segs = Math.max(12, o.segs ?? 40);
  const rings = Math.max(4, o.rings ?? 10);
  const jag = o.jag ?? 1;
  const squash = o.squash ?? 1;
  const skirt = o.skirt ?? o.height * 0.35 + 34;
  const uvS = o.uvScale ?? Math.max(8, o.height * 0.2);
  const strata = o.strata ?? Math.max(4, o.height * 0.07);
  const rng = mulberry32(o.seed);
  const n = createNoise2D(rng);
  const crestC = o.crestTint ?? _lc.setRGB(1.06, 1.02, 0.94).clone();
  const footC = o.footTint ?? _lc.setRGB(0.7, 0.74, 0.82).clone();

  // Angular profile of the shoreline and of the summit ridge. Both are periodic
  // in the angle, sampled off a circle in the noise field so they wrap exactly.
  const shore = new Float32Array(segs + 1);
  const crown = new Float32Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cx = Math.cos(a),
      cz = Math.sin(a);
    shore[i] = 1 + n(cx * 1.6, cz * 1.6) * 0.32 * jag + n(cx * 4.3 + 11, cz * 4.3) * 0.15 * jag;
    // Two or three distinct summits with saddles between, NOT a dome — and not
    // a cone either. `pow(ridgedNoise, 1 + jag * 0.6)` was the latter: ridged
    // noise peaks at a cusp and the power then starved everything around it, so
    // an offshore mass at 2 km came out as a needle. A smoothstep on ordinary
    // noise keeps the two-summit read and gives it shoulders to stand on.
    const r0 = 0.5 + 0.5 * n(cx * 2.1 + 30, cz * 2.1);
    const r1 = 0.5 + 0.5 * n(cx * 4.6 + 71, cz * 4.6);
    crown[i] = 0.40 + 0.60 * smoothstep(0.14, 0.92, r0) * (0.72 + 0.28 * r1);
  }

  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const toe = j === 0;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // PROFILE. The old pair — radius by `sqrt(1 - 0.94 v²)`, height by
      // `v^0.7` — put the mass at HALF the shore radius already at 93% of full
      // height. Every offshore landform was therefore a plug: near-vertical
      // sides, a point on top, and at 2 km indistinguishable from the row of
      // cones the ridges used to be. This pair keeps a broad apron at the
      // waterline and reaches the summit over the inner third, which is a cape
      // or a rock stack rather than a volcano.
      const rr = o.radius * shore[i] * (1 - Math.pow(v, 1.55) * 0.9);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr * squash;
      const flank = Math.pow(v, 0.95);
      const spur = n(Math.cos(a) * 5.4 + 60, Math.sin(a) * 5.4) * 0.4 + n(a * 9.1, v * 3.3) * 0.18;
      let y = o.height * crown[i] * flank * (1 + spur * 0.26 * jag * flank);
      y -= o.height * 0.05 * jag * Math.max(0, -n(a * 13.0 + 91, v * 4.0)) * flank;
      if (toe) y = -skirt;
      pos.push(x, y, z);
      uv.push((a * o.radius) / uvS, (v * o.height + y * 0.5) / uvS);

      const hRel = clamp(y / Math.max(1, o.height), 0, 1);
      _lc.copy(footC).lerp(crestC, Math.pow(hRel, 0.62));
      // SCRUB / ROCK PATCHWORK — `ridgeGeo`'s, character for character, with
      // `flank` standing in for `shape`. The two are the same quantity in the
      // two frames: 0 at the toe, 1 at the summit, and the line below this
      // block already uses `flank` exactly where the ridge uses `shape`.
      //
      // WHY THIS IS HERE AT ALL. In the racing game's backdrop a ridge and an
      // offshore cape stand in the SAME merged mesh at the SAME distance, and
      // until this landed only one of them had vegetation on it. So the far
      // shore read as bare untextured rock beside a hillside that did not —
      // which is the review's "an untextured orange silhouette with no
      // vegetation stippling and no rock", still live on half the landforms
      // after the ridge was fixed. Absent means OFF and produces the identical
      // island it always did; the three island test cases pass neither field
      // and prove it.
      if (o.scrubTint) {
        const s0 = n(x * 0.0125 + 91.4, z * 0.0125 - 12.6) * 0.62 + n(x * 0.031 - 4.2, z * 0.031 + 55.9) * 0.38;
        const veg = clamp(s0 * 0.9 + 0.42, 0, 1) * lerp(1.0, 0.35, Math.pow(hRel, 1.5)) * lerp(0.45, 1.0, clamp(flank * 1.4, 0, 1));
        _lc.lerp(o.scrubTint, veg * 0.55);
      }
      let m = 1;
      // SUN-CATCH RIM. Same term as the ridge's, same 0.30, same `hRel^3.2`
      // weighting; only the BEARING is worked out differently, because the two
      // surfaces face different ways and there is no honest way around that.
      //
      // A ridge has exactly two faces, so it asks whether this vertex is on the
      // front flank or the dip slope and flips the sign. An island is a closed
      // loop and every column has its own outward bearing: at angle `a` the
      // surface faces (cos a, sin a) in (x, z), whose bearing measured from
      // local +Z — the convention `sunLocal` is stated in — is `π/2 - a`. So
      // the ridge's `cos(sunLocal) * face` becomes `cos(sunLocal - (π/2 - a))`,
      // which reduces to the ridge's own expression for a surface that faces
      // +Z. It is one formula evaluated in each shape's own frame, not a branch
      // on which shape it is.
      if (o.sunLocal !== undefined) {
        const facing = Math.cos(o.sunLocal - (Math.PI / 2 - a));
        m *= 1 + clamp(facing, 0, 1) * Math.pow(hRel, 3.2) * 0.30;
      }
      if (strata > 0) {
        const warp = n(x * 0.006 + 4.2, z * 0.006) * strata * 0.9;
        const b = (y + warp) / strata;
        m *= 1 + 0.115 * Math.sin(b * Math.PI * 2) + 0.055 * Math.sin(b * Math.PI * 5.17 + 1.3);
      }
      m *= lerp(0.84, 1.05, flank);
      m *= lerp(0.6, 1, smoothstep(0, o.height * 0.14, y));
      col.push(_lc.r * m, _lc.g * m, _lc.b * m);
    }
  }
  const stride = segs + 1;
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
//  The two things a FLANK is for
// ---------------------------------------------------------------------------
//  `ridgeContour` and `ribbonStrip` above exist to be used by exactly these
//  two, and for a while both consumers sat in a game while the primitives
//  they were built out of sat here. That is the shape of a half-finished move:
//  a package that publishes a tool and no worked example of it, and a game
//  that reads back into the package for two functions nobody else can find.
//
//  Both take a `RidgeFlank` — the per-column surface `ridgeGeo` hands back
//  through `flankOut` — and return GEOMETRY, not meshes. What colour a
//  retaining wall is, what a grove is worth against the haze, and how many
//  terraces a hill gets are the caller's, and neither function can see them.
//
//  THE RNG IS THE CALLER'S TOO, and neither of these touches it. Everything
//  random about a terrace run — how many rows, which columns, where each
//  contour sits — is decided outside and handed in as plain numbers, because a
//  package that quietly draws from a world's seed reseeds everything
//  downstream of it.

/** One terrace: the retaining face, and the planted band above it. */
export interface Terrace {
  face: THREE.BufferGeometry | null;
  band: THREE.BufferGeometry | null;
}

/**
 * Contour terraces cut across a flank: ledges at rising heights, each with a
 * strip of planting above it. From a few hundred metres this is what an olive
 * terrace or a vineyard looks like, and it is the cheapest possible way for a
 * landform to say "this land is farmed" rather than "this is a rock".
 *
 * ── WHY CONTOURS AND NOT BOXES ─────────────────────────────────────────────
 *
 * Built from the ridge's OWN vertices. Ruling one straight box per row at a z
 * bisected out of the analytic cross-section ignores the per-column lean, the
 * spur displacement and the gullies; measured against the real surface that
 * missed by 24–35 m, and a straight bar floating in front of a hillside is the
 * most conspicuous failure available at this distance, because a horizontal
 * line is exactly what the eye is hunting for. A contour also BENDS with the
 * land, which a box cannot, and that bend IS the read: it is what says the
 * ledge is cut into a slope rather than propped against one.
 *
 * The band is the strip between one contour and the next one up, so it lies ON
 * the surface by construction and can never detach from it.
 *
 * @param fs   one height fraction per row, 0..1 up the flank. The caller's, so
 *             the spacing and its jitter belong to the world.
 * @param th   retaining-wall height. Scale it with the landform: a 1 m kerb on
 *             a 300 m hill is invisible and a 6 m wall on a 40 m one is a dam.
 * @param gap  how far above `f` the band's top contour sits.
 */
export function flankTerraces(
  fl: RidgeFlank, i0: number, span: number, th: number, gap: number, fs: readonly number[],
): Terrace[] {
  const out: Terrace[] = [];
  const bot: number[] = [];
  const top: number[] = [];
  for (const f of fs) {
    const line = ridgeContour(fl, f, i0, span);
    if (line.length < 12) continue;
    const above = ridgeContour(fl, Math.min(0.96, f + gap), i0, span);
    if (above.length !== line.length) continue;
    bot.length = 0;
    top.length = 0;
    for (let i = 0; i < line.length; i += 3) {
      // stand the face a little proud of the rock so it never z-fights
      bot.push(line[i], line[i + 1] - th, line[i + 2] - th * 0.35);
      top.push(line[i], line[i + 1], line[i + 2] - th * 0.35);
      above[i + 2] -= th * 0.2;
    }
    out.push({
      face: ribbonStrip(bot, top, Math.max(6, th * 5)),
      band: ribbonStrip(top, above, Math.max(8, th * 8)),
    });
  }
  return out;
}

/**
 * A road switchbacking up a flank: short legs at rising heights, alternating
 * along the slope.
 *
 * At a few hundred metres a zig-zag is instantly legible as a road, and a road
 * on a distant hillside is one of the strongest scale cues there is — it says
 * "that is a mountain, and people drive on it". Each leg is a ribbon between
 * two adjacent contours, so the carriageway lies on the slope and its width is
 * the slope distance between them, which means it automatically narrows where
 * the flank steepens, the way a real cut into a hillside does.
 *
 * @param fs   one height fraction per leg, bottom to top. The caller's.
 * @param w    the leg's height in flank fraction; the carriageway's width is
 *             whatever that works out to on this slope.
 * @param step how far the alternate leg shifts along the crest. Zero stacks the
 *             legs vertically, which is a ladder and not a road.
 * @param lift how far the whole road is pulled proud of the rock.
 */
export function flankSwitchback(
  fl: RidgeFlank, i0: number, span: number, w: number, step: number, lift: number, fs: readonly number[],
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  let k = 0;
  for (const f of fs) {
    const a0 = i0 + (k++ & 1 ? step : 0);
    const hi = ridgeContour(fl, f + w, a0, span);
    const lo = ridgeContour(fl, Math.max(0.03, f), a0, span);
    if (hi.length < 12 || hi.length !== lo.length) continue;
    for (let i = 2; i < hi.length; i += 3) {
      hi[i] -= lift;
      lo[i] -= lift;
    }
    const leg = ribbonStrip(lo, hi, 16);
    if (leg) out.push(leg);
  }
  return out;
}
