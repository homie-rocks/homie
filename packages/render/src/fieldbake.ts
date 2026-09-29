/**
 * ============================================================================
 *  fieldbake — noise fields in, a tiling PBR set out.
 * ============================================================================
 *
 *  THE FOURTH SURFACE GENERATOR IN THIS PACKAGE, and like the other three it
 *  earns its place on one property. `Surface.ts` paints on a real 2D context.
 *  `Textures.ts` owns the plumbing and packs ORM. `tilebake.ts` bakes from
 *  (u, v) callbacks and wraps its own central differences. This one bakes from
 *  fields the caller ALREADY HAS as flat arrays — which is what a stack of
 *  `bandField` octaves is — and keeps albedo and roughness in SEPARATE maps
 *  rather than packing ORM, because a metal that samples a probe wants a
 *  roughness map it can multiply a scalar into and has no AO term worth
 *  storing.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *  MECHANISM, and all of it is here:
 *   · one pass, three outputs. The three maps must describe the SAME physical
 *     surface; baked in separate loops they drift the moment somebody edits
 *     one expression and not the others, and the symptom is specular that does
 *     not sit on the relief — a wet patch rather than a mistake.
 *   · roughness in the GREEN channel, because that is where three samples it.
 *   · the normal off the height field with WRAPPING central differences, so
 *     the normal map tiles as exactly as the albedo does. A clamped filter
 *     leaves a seam of wrong-facing normals down every repeat, which under a
 *     low key is a lit hairline running across the surface every few metres.
 *   · the albedo is sRGB and the other two are not, applied once.
 *
 *  CONTENT: `texel`. It IS the material. It has no default and never should.
 *
 *  ── TWO THINGS ABOUT A METAL THAT ARE EASY TO GET BACKWARDS ────────────────
 *
 *  ALBEDO VARIATION IS SMALL. Bare metal is nearly uniform in albedo and gets
 *  all of its character from roughness and from what it reflects. Push the
 *  albedo gain hard and it stops looking like metal — which is why the gain is
 *  a single scalar per texel here rather than a colour: a metal that varies in
 *  HUE across a panel is a painted one.
 *
 *  THE ROUGHNESS RANGE HAS A FLOOR AND A CEILING, and both are physical.
 *  Too low and the surface starts mirroring individual PMREM texels. Too high
 *  and the high mips of a probe that is half bright ground and half black sky
 *  average together, which flattens the very split that makes a metal object
 *  read as metal in that environment. A CONSTANT roughness over a large
 *  surface is an automatic fail; so is a range wide enough to average the
 *  environment's two halves.
 *
 *  ── AND ANISOTROPY IS A FIELD PROPERTY, NOT A FILTER ───────────────────────
 *
 *  Rolled sheet is not isotropic: the mill's rolls are themselves worn in
 *  bands, so the finish varies in stripes running across the direction of
 *  travel. That is expressed by handing this function a field whose two cell
 *  counts differ — a 2 x 11 lattice is an 18:1 stretch — and NOT by a filter
 *  setting. An isotropic grain reads as CAST metal, and no amount of
 *  anisotropic filtering puts the stripes back.
 * ============================================================================
 */
import * as THREE from 'three';
import { bytesTexture, centralNormalBytes } from './Textures.ts';

export interface FieldMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

export interface FieldBakeOpts {
  /** Edge, texels. Square and power-of-two, so it mips and wraps. */
  size: number;
  /**
   * Base albedo, 0..255 per channel, in whatever space the caller wants the
   * map to carry. Multiplied by the per-texel gain and nothing else.
   */
  base: [number, number, number];
  /**
   * Per texel `i`, write three numbers into `out`:
   *   out[0]  height, in the units `normalStrength` is calibrated against
   *   out[1]  albedo gain, multiplying `base`
   *   out[2]  roughness, 0..1; values above 1 are clamped
   * It is handed a shared scratch and MUST NOT allocate — this runs a million
   * times at load.
   */
  texel(i: number, out: Float64Array): void;
  /** How steep the relief is made to look. Absorbs amplitude and texel pitch. */
  normalStrength: number;
  anisotropy: number;
}

export function bakeFieldMaps(o: FieldBakeOpts): FieldMaps {
  const size = o.size;
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const rough = new Uint8ClampedArray(n * 4);
  const height = new Float32Array(n);
  const t = new Float64Array(3);
  const [br, bg, bb] = o.base;

  for (let i = 0; i < n; i++) {
    o.texel(i, t);
    height[i] = t[0]!;
    const k = t[1]!;
    const p = i * 4;
    albedo[p] = br * k;
    albedo[p + 1] = bg * k;
    albedo[p + 2] = bb * k;
    albedo[p + 3] = 255;
    let rg = t[2]!;
    if (rg > 1) rg = 1;
    rough[p] = 0;
    rough[p + 1] = rg * 255; // three samples roughness from the GREEN channel
    rough[p + 2] = 0;
    rough[p + 3] = 255;
  }

  const nrm = centralNormalBytes(height, size, o.normalStrength);
  const toTex = (data: Uint8ClampedArray, srgb: boolean) =>
    bytesTexture(size, data, { srgb, wrap: THREE.RepeatWrapping, anisotropy: o.anisotropy });

  return {
    map: toTex(albedo, true),
    roughnessMap: toTex(rough, false),
    normalMap: toTex(nrm, false),
  };
}

/**
 * PEAK-NORMALISE a coverage field into sRGB bytes, and hand back the MEAN it
 * lost as a gain on the material colour.
 *
 * THE GAIN IS THE WHOLE POINT AND IT IS NOT A CONVENIENCE. A field with gaps
 * in it — tiles with seams, planks with joints, a grid of anything — has a
 * mean below its peak. Store it peak-normalised so nothing clips, use it as a
 * distant proxy for the geometry it stands in for, and the proxy is DARKER
 * than the real thing by exactly that ratio: the LOD swap then pops in VALUE,
 * which is a worse artefact than the missing relief the proxy exists to fake.
 * Multiplying the material colour by `peak / mean` puts the average back.
 *
 * The encode is written out rather than delegated to a colour class because
 * this is a single channel replicated to three, and a `THREE.Color` round trip
 * per texel over a 512² field is a quarter of a million allocations.
 */
export function peakNormalisedBytes(field: Float32Array, size: number): { bytes: Uint8ClampedArray; gain: number } {
  const n = size * size;
  let mean = 0;
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    mean += field[i]!;
    if (field[i]! > peak) peak = field[i]!;
  }
  mean /= n;
  const bytes = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const lin = THREE.MathUtils.clamp(field[i]! / peak, 0, 1);
    const enc = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    const o = i * 4;
    bytes[o] = bytes[o + 1] = bytes[o + 2] = enc * 255;
    bytes[o + 3] = 255;
  }
  return { bytes, gain: peak / mean };
}
