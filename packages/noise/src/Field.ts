/**
 * ============================================================================
 *  Octave stacking over an INJECTED basis, and noise that closes on a circle.
 * ============================================================================
 *  `Noise.ts` owns bases (simplex, perlinPeriodic) and whole baked fields.
 *  `Periodic.ts` owns value noise that wraps in one axis. Neither owns the two
 *  things terrain generators keep writing for themselves:
 *
 *    · a loop that sums octaves of SOMEBODY ELSE'S basis function, and
 *    · a 1-D noise indexed by an ANGLE, which must close at 2π or it rules a
 *      seam straight across whatever it modulates.
 *
 *  The second one is the interesting one, and it is not lunar. Sampling any
 *  non-periodic 1-D noise at `f(angle * k)` puts a discontinuity along the ray
 *  where `atan2` flips: the lattice does not wrap, so the value at −π and the
 *  value at +π are unrelated numbers. Anything azimuthal built on it — a
 *  crater rim, a treetop outline, a wheel-scuff ring, a shockwave ripple —
 *  carries a hard radial edge. A short sum of INTEGER harmonics with hashed
 *  phases is periodic by construction, costs the same, and has the few-lobed
 *  character an azimuthal profile wants anyway.
 *
 *  EVERY TUNED NUMBER IS AN ARGUMENT. The harmonic weights decide whether the
 *  result reads as lobing, as scalloping or as a symmetry artefact, and the
 *  lacunarity decides whether octaves re-align on a visible lattice. Those are
 *  art directions, so they are stated by the caller and there are no defaults
 *  to inherit by accident.
 *
 *  No `three`, no DOM, no basis of its own: `fbmOctaves` and `ridgedOctaves`
 *  take the basis as a function so a caller can hand them simplex, perlin,
 *  value noise or a lookup table.
 * ============================================================================
 */

/** Any 2-D scalar basis. Sign and range are the basis's business, not ours. */
export type Field2 = (x: number, y: number) => number;

/** Any 2-D integer hash into [0,1). See the three in this package. */
export type Hash2Fn = (x: number, y: number, seed: number) => number;

/**
 * A THIRD 2-D hash, and the third is deliberate.
 *
 * `Noise.ts`'s `hash2` runs two avalanche rounds; `Periodic.ts`'s `hash2i`
 * folds the seed with a multiply-and-add. This one runs ONE round on a
 * different multiplier triple. All three are fine hashes and all three are
 * DIFFERENT STREAMS, so they are not interchangeable: whichever one a field
 * was authored against is the one that reproduces it, and swapping is a
 * content change wearing a de-duplication costume. Published rather than
 * copied so the next generator that wants a one-round fold has somewhere to
 * get it instead of typing the constants again.
 */
export function hash2f(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Ken Perlin's quintic, edges given. Zero second derivative at both ends,
 * where `smoothstep`'s is not — which is the difference between a silhouette
 * that curves and one with a readable kink at the join.
 *
 * `Noise.ts`'s `smoothstep` is the cubic and `Periodic.ts`'s `smoothstep01` is
 * the cubic without the epsilon guard; this is the quintic, and it keeps the
 * `|| 1e-6` so a zero-width band answers 0 instead of NaN.
 */
export function smootherstep(e0: number, e1: number, x: number): number {
  const t = (x - e0) / (e1 - e0 || 1e-6);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Draw from a POWER LAW between two bounds by inverse transform: one uniform
 * in, one sample out, with cumulative N(>x) proportional to x^-exponent.
 *
 * This is the difference between a scattered population that reads as real and
 * one that reads as programmer art, and the reason is arithmetic rather than
 * taste. A uniform draw over [min, max] puts half the population in the top
 * half of the SIZE range, which is the opposite of every natural size-frequency
 * distribution — craters, boulders, islands, forest clearings, city blocks. The
 * observed lunar production function is exponent 2; a scree slope is steeper.
 *
 * `u` is the caller's uniform, so the caller keeps its own stream.
 */
export function powerLawDraw(u: number, min: number, max: number, exponent: number): number {
  const a = Math.pow(min, -exponent);
  const c = Math.pow(max, -exponent);
  return Math.pow(a - u * (a - c), -1 / exponent);
}

/** Octave stack shape. Every field is required — see the header. */
export interface Octaves {
  /** How many octaves to sum. */
  count: number;
  /** Frequency of the first octave, in the basis's own units. */
  freq: number;
  /** Amplitude multiplier per octave. */
  gain: number;
  /**
   * Frequency multiplier per octave. An INTEGER lacunarity re-aligns every
   * octave on the same lattice lines and prints a faint square grid into the
   * shading, which raking light makes very visible; callers that care pass
   * something slightly off 2.
   */
  lacunarity: number;
}

/** Fractional Brownian motion over `n`, normalised by the amplitude sum. */
export function fbmOctaves(n: Field2, x: number, y: number, o: Octaves): number {
  let a = 1, f = o.freq, s = 0, nrm = 0;
  for (let i = 0; i < o.count; i++) {
    s += a * n(x * f, y * f);
    nrm += a;
    a *= o.gain;
    f *= o.lacunarity;
  }
  return s / nrm;
}

/**
 * Ridged multifractal over `n` — sharp crests, rounded troughs, from squaring
 * the folded basis. Plain fbm gives symmetric hills and reads as dunes.
 *
 * Assumes a basis centred on zero and roughly in [−1, 1]; simplex is one.
 */
export function ridgedOctaves(n: Field2, x: number, y: number, o: Octaves): number {
  let a = 1, f = o.freq, s = 0, nrm = 0;
  for (let i = 0; i < o.count; i++) {
    const v = 1 - Math.abs(n(x * f, y * f));
    s += a * v * v;
    nrm += a;
    a *= o.gain;
    f *= o.lacunarity;
  }
  return s / nrm;
}

/**
 * The harmonic content of one azimuthal noise. All of it is art direction.
 *
 * `lobesBase` and `lobesSpan` pick the LOBE COUNT and it matters more than it
 * looks: a low-lobed term applied inside a disc draws broad radial wedges that
 * converge on the centre — a star, which reads as a symmetry artefact — while
 * the same function at 7–12 lobes reads as slumping. Outlines and rays want a
 * handful; scalloping wants many.
 */
export interface AzHarmonics {
  lobesBase: number;
  lobesSpan: number;
  /** Second and third harmonics, as offsets from the drawn lobe count. */
  step1: number;
  step2: number;
  /** Amplitudes of the three harmonics. They ride on a mean of 0.5. */
  w0: number;
  w1: number;
  w2: number;
  /** Seed salt for the three hashed phases and the lobe draw. */
  salt: number;
}

/**
 * Azimuthal noise, mean 0.5, period exactly 2π. See the header for why the
 * period is the whole point.
 *
 * Only INTEGER harmonics: a fractional one does not close at 2π and puts back
 * the seam this function exists to remove.
 */
export function azimuthalNoise(ang: number, seed: number, hash: Hash2Fn, h: AzHarmonics): number {
  const TAU = 6.283185307;
  const p1 = hash(seed, 11, h.salt) * TAU;
  const p2 = hash(seed, 23, h.salt) * TAU;
  const p3 = hash(seed, 37, h.salt) * TAU;
  const k = h.lobesBase + ((hash(seed, 51, h.salt) * h.lobesSpan) | 0);
  return 0.5 + Math.sin(ang * k + p1) * h.w0
    + Math.sin(ang * (k + h.step1) + p2) * h.w1
    + Math.sin(ang * (k + h.step2) + p3) * h.w2;
}
