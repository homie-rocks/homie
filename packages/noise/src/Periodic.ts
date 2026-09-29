/**
 * ============================================================================
 *  Periodic value noise — the octave family that WRAPS in x.
 * ============================================================================
 *  `Noise.ts` already owns simplex (non-tiling, for scatter) and
 *  `perlinPeriodic` (gradient noise on a permutation table, tiling on a square
 *  period in BOTH axes). Neither is the thing a sphere needs.
 *
 *  A sphere baked as an equirectangular field wraps in LONGITUDE and does not
 *  wrap in LATITUDE. An octave that does not tile in x leaves a hard vertical
 *  seam at the antimeridian — dead straight, full contrast, and instantly
 *  readable as a bug — and an octave that tiles in BOTH pinches the poles into
 *  a repeat. So the period is a single axis and it is a required argument.
 *
 *  This arrived from a base-building game's star-field bake, where it baked
 *  the Milky Way band, and from its planet bake, where the same four functions
 *  bake continents, aridity belts, city lights and two cloud decks. NOTHING
 *  ABOUT ANY OF THAT IS LUNAR: it is "value noise with a period in one axis",
 *  which is what any planet, any cylinder, any looping ribbon and any seamless
 *  scrolling backdrop needs. It was a single implementation in one game, which
 *  is exactly the shape a duplication census cannot see.
 *
 *  Value noise rather than simplex on purpose. The whole point is the wrap, and
 *  wrapping value noise is four integer hashes with the x index taken modulo
 *  the period — it is one line. Wrapping simplex means owning a permutation
 *  table per period, which is what `perlinPeriodic` does and why it costs a
 *  `Uint8Array` argument.
 * ============================================================================
 */
import { clamp01, lerp as lerpN, mulberry32 } from './Noise.ts';
import { hash2f } from './Field.ts';

/**
 * `smoothstep` with the edges CLAMPED and no epsilon in the denominator.
 *
 * `Noise.ts`'s `smoothstep` guards `e1 - e0` with `|| 1e-6`, which changes the
 * answer at exactly `x === e0 === e1` (0 there, NaN here) and nowhere else.
 * Kept as its own function rather than folded into that one, because every
 * baked field below was authored against THIS curve and a texture that changes
 * by one code unit is a capture-comparison that stops being an A/B.
 */
export function smoothstep01(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Integer hash → [0,1). Cheap, well-mixed enough for value noise.
 *
 * Deliberately NOT `Noise.ts`'s `hash2`: this one folds the seed with a
 * multiply-and-add rather than an `imul`, and the two produce different
 * streams. Both are fine hashes; only one of them is the one the fields below
 * were authored against.
 */
export function hash2i(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise with a PERIOD IN X, roughly 0..1.
 *
 * The period is not a nicety — see the header. Latitude does NOT wrap and is
 * deliberately a plain axis.
 */
export function valueNoise2(x: number, y: number, periodX: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const p = Math.max(1, periodX | 0);
  const wrap = (i: number) => ((i % p) + p) % p;
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const a = hash2i(xa, y0, seed);
  const b = hash2i(xb, y0, seed);
  const c = hash2i(xa, y0 + 1, seed);
  const d = hash2i(xb, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fractal sum of `valueNoise2`, still periodic in x. Returns roughly 0..1.
 *
 * The period DOUBLES with the frequency, which is the whole reason the octaves
 * stay in phase at the seam: octave n tiles `2^n` times across the same span.
 */
export function fbm2(
  x: number, y: number, octaves: number, periodX: number, seed: number,
): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let px = periodX;
  let cx = x;
  let cy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(cx, cy, px, seed + o * 131);
    norm += amp;
    cx *= 2; cy *= 2; px *= 2; amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged variant. Dust bands and mountain chains want creases, not blobs. */
export function ridged2(
  x: number, y: number, octaves: number, periodX: number, seed: number,
): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let px = periodX;
  let cx = x;
  let cy = y;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise2(cx, cy, px, seed + o * 977) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    cx *= 2; cy *= 2; px *= 2; amp *= 0.5;
  }
  return sum / norm;
}

/**
 * ── THE OTHER VALUE-NOISE FAMILY, and why it is here too ────────────────────
 *
 * A base-building game's particle pool bakes its eight particle tiles against a
 * SECOND, differently-seeded value-noise fbm — signed −1..1, non-periodic, a
 * different integer hash, `amp *= 0.52; freq *= 2.07` instead of halving and
 * doubling. `@homie-rocks/fx/ParticleTiles.ts` has a third `fbm` of the same
 * name over simplex.
 *
 * Three noise functions called `fbm` in one repository, none of them
 * interchangeable, is exactly how a texture quietly changes underneath a
 * capture comparison. This one is named for what it is, and the tile family
 * below is named for what IT is, so a call site says which stream it wants.
 */

/** The particle-atlas hash: xor-fold of two odd multiplies against a constant seed. */
export function tileHash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed;
  n = Math.imul(n ^ (n >>> 15), 1 | n);
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

/** SIGNED value noise, −1..1, no period. The tile bakers' field. */
export function tileNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = tileHash2(ix, iy, seed), b = tileHash2(ix + 1, iy, seed);
  const c = tileHash2(ix, iy + 1, seed), d = tileHash2(ix + 1, iy + 1, seed);
  return ((a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy) * 2 - 1;
}

/**
 * Fractal sum of `tileNoise2`, −1..1.
 *
 * `0.52` and `2.07` rather than `0.5` and `2.0`: the irrational-ish lacunarity
 * is what stops the octaves from lining up into a visible grid on a 128² tile.
 */
export function tileFbm2(x: number, y: number, oct: number, seed: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * tileNoise2(x * freq, y * freq, seed);
    norm += amp;
    amp *= 0.52; freq *= 2.07;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// The TORUS family — value noise that wraps in BOTH axes.
// ---------------------------------------------------------------------------
//
// The two families above wrap in one axis (a sphere's longitude) or in none (a
// particle atlas). A repeating SURFACE texture — anything bound with
// RepeatWrapping and tiled across a wall, a road, a hull plate — has to wrap in
// both, or the tile boundary is a hard cross of discontinuity that the eye
// finds instantly at any repeat count.
//
// This arrived from a base-building game's structure builder, where it was a
// private `hashLattice`/`valueNoise`/`fbm` defined 170 lines below an import of
// `mulberry32` out of this very package — a competing implementation of the
// package that superseded it. Nothing about a torus-tiling octave is lunar; it
// is what every seamless material bake in this repository needs.
//
// THE HASH IS A THIRD STREAM AND THAT IS DELIBERATE. `hash2i` above folds with
// `+`, `tileHash2` folds with a different pair of multipliers, and this one
// xors two `imul`s against `seed * 2147483647`. All three are fine hashes and
// none of them produces the other's numbers; every baked texture in that game
// was authored against THIS one, and a texture that changes by one code unit is
// a capture comparison that has stopped being an A/B. Naming the stream is what
// lets a call site say which it wants — see the note above `tileHash2`.

/** Integer hash on a periodic lattice, so every field built on it tiles. */
export function hashTorus(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise. `period` is in lattice cells, so the texture wraps. */
export function valueNoiseTorus(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hashTorus(ix, iy, period, seed);
  const b = hashTorus(ix + 1, iy, period, seed);
  const c = hashTorus(ix, iy + 1, period, seed);
  const d = hashTorus(ix + 1, iy + 1, period, seed);
  return lerpN(lerpN(a, b, ux), lerpN(c, d, ux), uy);
}

/**
 * Tileable fbm in 0..1. `cells` is the base lattice across the whole texture,
 * and it DOUBLES with the frequency so every octave shares the same seam.
 */
export function fbmTorus(
  u: number, v: number, cells: number, octaves: number, seed: number,
): number {
  let sum = 0, amp = 0.5, norm = 0, c = cells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoiseTorus(u * c, v * c, c, seed + o * 977);
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  return sum / norm;
}

/**
 * A whole tileable value-noise FIELD, baked to a square buffer, with the two
 * axes' cell counts INDEPENDENT.
 *
 * Every other octave in this file answers one sample at a time. This one fills
 * a `size²` Float32Array in one pass off a `cellsX × cellsY` lattice, and the
 * two differences from `valueNoise2` are both the reason it exists:
 *
 *  · IT WRAPS IN BOTH AXES, because the lattice index is taken modulo the cell
 *    count on both. A map baked for a cylinder or a repeating panel has to meet
 *    itself top and bottom as well as left and right; `valueNoise2` is for a
 *    sphere, where latitude deliberately does not wrap.
 *  · THE ASPECT IS A PARAMETER. `cellsX = 2, cellsY = 11` is an 18:1 stretch,
 *    and a stretched field is what a ROLLED or BRUSHED surface actually is: the
 *    mill's rolls leave a grain along one axis, so the microsurface varies in
 *    long stripes across it. A field baked isotropic reads as cast metal
 *    however good the rest of the material is, and no amount of roughness
 *    tuning recovers it. Whoever wants stripes chooses which way they run.
 *
 * Sampled at texel centres offset by 0 — `x / size`, not `(x + 0.5) / size` —
 * because that is the convention every field baked against it was authored
 * with, and half a texel of phase is a different image.
 *
 * The lattice is drawn from `mulberry32` rather than hashed per cell so a
 * caller can reproduce a field from a seed alone, which is what makes a
 * captured before/after of a baked map comparable at all.
 */
export function bandField(
  size: number,
  cellsX: number,
  cellsY: number,
  seed: number,
): Float32Array {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cellsY;
    const y0 = Math.floor(fy) % cellsY;
    const y1 = (y0 + 1) % cellsY;
    let ty = fy - Math.floor(fy);
    ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cellsX;
      const x0 = Math.floor(fx) % cellsX;
      const x1 = (x0 + 1) % cellsX;
      let tx = fx - Math.floor(fx);
      tx = tx * tx * (3 - 2 * tx);
      const a = lat[y0 * cellsX + x0];
      const b = lat[y0 * cellsX + x1];
      const c = lat[y1 * cellsX + x0];
      const d = lat[y1 * cellsX + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/**
 * A THIRD integer hash, and the file already argues why there are three.
 *
 * `hash2i` above folds its seed with `(seed|0) * 2147483647` — an ORDINARY
 * multiply, which in JavaScript is a double and does not wrap at 32 bits. This
 * one uses `Math.imul` on all three terms, which does. Those are different
 * streams from the same shape, and neither is better; only one of them is the
 * one a given field was authored against, and re-seeding a field that was tuned
 * texel by texel is not a refactor, it is a different surface.
 *
 * The distinction matters most exactly where it is least visible: a per-cell
 * hash driving a per-panel tone or a per-ring jitter produces a plausible field
 * under any hash, so swapping one for another compiles, renders, and quietly
 * re-rolls every hand-checked piece of a model at once.
 *
 * Ranges 0..1. Two coordinates and a seed, all coerced to int32.
 */
export function hash2m(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// GRADIENT noise on the same torus — published BESIDE the value family, not
// merged into it
// ---------------------------------------------------------------------------
//
// `valueNoiseTorus` interpolates the LATTICE VALUE; this interpolates the dot
// product of a lattice GRADIENT with the offset. They are two techniques, they
// do not produce each other's numbers, and the difference is visible rather
// than academic: value noise's extrema sit ON the lattice points, so a field
// built from it has a faint grid in it at low octave counts, and gradient noise
// is zero at every lattice point, so its extrema fall between them. A surface
// baked at one texel per few millimetres shows the first as a regular quilt.
//
// So these are two functions and not a knob, the same call as
// `@homie-rocks/render`'s `cascade.ts` / `cascadederiv.ts`: a shared
// `noiseTorus(x, y, period, seed, kind)` would compile, would pass every check
// in this repository, and would quietly give one baked map the other's grain.
//
// THE HASH IS A FOURTH STREAM, and it is `@homie-rocks/noise/Field`'s `hash2f`
// rather than `hashTorus` above — the field this arrived from was authored
// against it, and a texture that changes by one code unit is a capture
// comparison that has stopped being an A/B. See the note above `tileHash2`.

/**
 * Eight unit gradients on the compass, indexed by three bits of the hash.
 *
 * Eight and not four: with four axis-aligned gradients the field has a visible
 * diagonal bias, because every cell's two extrema lie on the same two axes.
 * Eight and not a continuous angle: an 8-entry table is two array reads against
 * a sin/cos pair per corner per octave, and the difference is invisible at any
 * texel density a material is baked at.
 */
const GRAD_X = [1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071];
const GRAD_Y = [0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071];

/**
 * Tileable GRADIENT noise in 0..1. `period` is in lattice cells on BOTH axes,
 * so the field wraps in x and y — which is what a repeating surface texture
 * needs and what the equirectangular family above deliberately is not.
 *
 * 0..1 AND NOT THE CONVENTIONAL -1..1, to match `valueNoiseTorus` above: every
 * consumer in this repository sums octaves of one or the other into a 0..1
 * field, and a family where half the members are signed is a family where the
 * fbm normalisation is written twice. The remap is `raw * 0.7071 + 0.5`;
 * 0.7071 is 1/sqrt(2), the largest |dot| a unit gradient reaches over a unit
 * cell, so the range is filled without clipping. Applying it PER OCTAVE, which
 * is what `gradFbmTorus` then does, is not the same float as applying it to the
 * sum — the two differ in the last bits — so it lives here and not there.
 *
 * QUINTIC FADE, not the cubic smoothstep the value family uses. Gradient noise
 * interpolates DERIVATIVES, and a cubic fade leaves the second derivative
 * discontinuous at every lattice line: on a normal map baked off this field
 * that is a faint rectilinear crease pattern, which is precisely the artefact
 * gradient noise was chosen to avoid. The quintic is Perlin's own 2002 fix and
 * it is not interchangeable with the cubic.
 */
export function gradNoiseTorus(
  x: number, y: number, period: number, seed: number,
): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const g00 = (hash2f(x0, y0, seed) * 8) & 7;
  const g10 = (hash2f(x1, y0, seed) * 8) & 7;
  const g01 = (hash2f(x0, y1, seed) * 8) & 7;
  const g11 = (hash2f(x1, y1, seed) * 8) & 7;
  const n00 = GRAD_X[g00]! * fx + GRAD_Y[g00]! * fy;
  const n10 = GRAD_X[g10]! * (fx - 1) + GRAD_Y[g10]! * fy;
  const n01 = GRAD_X[g01]! * fx + GRAD_Y[g01]! * (fy - 1);
  const n11 = GRAD_X[g11]! * (fx - 1) + GRAD_Y[g11]! * (fy - 1);
  return lerpN(lerpN(n00, n10, ux), lerpN(n01, n11, ux), uy) * 0.7071 + 0.5;
}

/**
 * Tileable gradient fbm, NORMALISED BY THE AMPLITUDE SUM rather than by a
 * closed form.
 *
 * `u` and `v` are in 0..1 across the texture and `base` is the lattice cell
 * count at octave 0; the period DOUBLES with the frequency, so every octave
 * shares the same seam and the sum still wraps.
 *
 * `gain` is a required-looking optional with a default of 0.5 because that is
 * the value the field this arrived from was authored at, and every other
 * caller in this repository would have to state it. A caller that wants a
 * rougher spectrum passes its own; the default is the one number here that a
 * new game should look at before accepting.
 */
export function gradFbmTorus(
  u: number, v: number, base: number, octaves: number, seed: number, gain = 0.5,
): number {
  let a = 1, p = base, s = 0, nrm = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * gradNoiseTorus(u * p, v * p, p, seed + i * 131);
    nrm += a;
    a *= gain;
    p *= 2;
  }
  return s / nrm;
}
