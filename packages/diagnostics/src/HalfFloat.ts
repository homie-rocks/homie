/**
 * ============================================================================
 *  HalfFloat — forensics on a half-float render target.
 * ============================================================================
 *  This package's charter is "whether the frame a person is looking at has a
 *  picture in it". A NaN in an HDR target is the version of that question one
 *  layer back: a single non-finite texel in an environment map, a bloom
 *  mip-chain or an accumulation buffer propagates through every subsequent
 *  filter tap, and what reaches the screen is a black frame, a white frame, or
 *  — the one that costs the most time — a frame that looks completely fine except
 *  that one material's reflection is wrong.
 *
 *  THE READING THAT LIED, and the reason this is written out longhand. The
 *  first attempt asked the GPU: render the target through a shader that
 *  compares each texel to itself and reports the mismatches. That is the
 *  textbook NaN test and it returned zero on a target that provably had NaNs
 *  in it, because the driver was compiling the comparison away under fast-math.
 *  Reading the bits back and decoding binary16 on the CPU cannot be folded
 *  away by anybody.
 *
 *  It is also written out rather than routed through `Float16Array`, which
 *  Safari and several Chrome channels still lack.
 *
 *  THIS FILE IMPORTS NOTHING, three INCLUDED. `scanTarget` takes the two things
 *  it actually uses — an object that can read pixels, and a width and a height
 *  — declared structurally. That is what keeps this package free of a renderer
 *  dependency, so a headless harness can classify a buffer it loaded from disk.
 *
 *  Extracted from one game's environment-map code, where it was chasing a
 *  non-finite texel in a PMREM atlas. Nothing about it was specific to that game.
 * ============================================================================
 */

/**
 * Decode one IEEE-754 binary16 from its raw bits.
 *
 * Exponent 31 with a zero mantissa is ±Inf; exponent 31 with a non-zero
 * mantissa is NaN. Exponent 0 is the subnormal ladder and the constant is
 * 2^-24, the smallest positive binary16.
 */
export function halfToFloat(h: number): number {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 5.9604644775390625e-8 * f;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

export interface HalfStats {
  texels: number; nan: number; inf: number; neg: number;
  max: number; maxAt: number; mean: number;
  /**
   * First few offending texel indices. Comparing these BETWEEN two scans is
   * what separates "content overflowed" from "this region was never written":
   * identical index sets across two different bakes cannot be content.
   */
  badAt: number[];
  /** Bounding box of the offending texels, or null. */
  badBox: { x0: number; y0: number; x1: number; y1: number } | null;
}

/**
 * Classify an RGBA half buffer.
 *
 * Alpha is skipped: PMREM and most HDR writers put 1.0 there, and a non-finite
 * alpha cannot reach a material's irradiance anyway — counting it would make
 * every scan of a correctly-written target report a quarter of its texels bad.
 */
export function classifyHalf(buf: Uint16Array, width = 0): HalfStats {
  let nan = 0, inf = 0, neg = 0, max = 0, maxAt = -1, sum = 0, finite = 0;
  const badAt: number[] = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < buf.length; i++) {
    if ((i & 3) === 3) continue;
    const v = halfToFloat(buf[i]!);
    const bad = !Number.isFinite(v);
    if (bad) {
      if (Number.isNaN(v)) nan++; else inf++;
      const t = i >> 2;
      if (badAt.length < 8) badAt.push(t);
      if (width > 0) {
        const x = t % width, y = (t / width) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      continue;
    }
    if (v < 0) neg++;
    if (v > max) { max = v; maxAt = i >> 2; }
    sum += v; finite++;
  }
  return {
    texels: buf.length >> 2,
    nan, inf, neg,
    max: +max.toFixed(3),
    maxAt,
    mean: finite ? +(sum / finite).toFixed(5) : 0,
    badAt,
    badBox: x1 >= 0 ? { x0, y0, x1, y1 } : null,
  };
}

/** Exactly the two fields of a render target this needs. */
export interface HalfTargetLike { width: number; height: number; }

/** Exactly the one method of a renderer this needs. */
export interface PixelReaderLike {
  readRenderTargetPixels(
    rt: never, x: number, y: number, w: number, h: number, buf: Uint16Array,
  ): void;
}

export interface HalfScan extends HalfStats { name: string; w: number; h: number; }

/** Read a half-float target back off the GPU and classify it. */
export function scanTarget<T extends HalfTargetLike>(
  renderer: PixelReaderLike, rt: T, name: string,
): HalfScan {
  const buf = new Uint16Array(rt.width * rt.height * 4);
  (renderer.readRenderTargetPixels as unknown as (
    rt: T, x: number, y: number, w: number, h: number, buf: Uint16Array,
  ) => void)(rt, 0, 0, rt.width, rt.height, buf);
  return { name, w: rt.width, h: rt.height, ...classifyHalf(buf, rt.width) };
}
