import * as THREE from 'three';

/**
 * ============================================================================
 *  The procedural sprite atlas the particle systems synthesise.
 * ============================================================================
 *  `buildAtlas` was three functions — one in each of two racing games and one
 *  in a base-building game — and the third is why this file exists rather than
 *  a shared header in one of the racers: it was the SAME FUNCTION UNDER A
 *  DIFFERENT FILENAME, so every scan that compared files by name scored it as
 *  unique code. Measured before the move: the three bodies differed in four
 *  comment lines and two line wraps and in nothing else at all.
 *
 *  WHAT IS SHARED AND WHAT IS NOT. The packer, the mip chain and the two
 *  clamping helpers the tile functions are written against are one thing in
 *  three places. The TILES are not: the two racers draw the same eight shapes
 *  (see ParticleTiles.ts) and the base-building game deliberately re-authors
 *  most of them, because a vacuum plume is not a flame and a puff of regolith
 *  is not tyre smoke. So the atlas takes the tiles as an argument, which it
 *  already did.
 * ============================================================================
 */

/** RGBA in 0..1. Called per texel of a tile, with u,v in 0..1. */
export type TileFn = (u: number, v: number, out: Float32Array) => void;

export function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Packs `fns.length` tiles into a cols x rows atlas and builds the whole mip
 * chain with a box filter. Because tile edges stay power-of-two aligned at
 * every level, a plain 2x2 downsample never mixes neighbouring tiles — which
 * is the entire reason we can afford mipmaps on an atlas at all. Without mips,
 * thin sprites at distance alias, and aliasing crawl on thin geometry is an
 * automatic fail.
 */
export function buildAtlas(fns: TileFn[], cols: number, rows: number, size: number): THREE.DataTexture {
  const w = cols * size, h = rows * size;
  const level0 = new Uint8Array(w * h * 4);
  const px = new Float32Array(4);
  for (let t = 0; t < fns.length; t++) {
    const ox = (t % cols) * size;
    const oy = Math.floor(t / cols) * size;
    const fn = fns[t]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // sample at texel centres so the tile is symmetric
        fn((x + 0.5) / size, (y + 0.5) / size, px);
        const o = ((oy + y) * w + ox + x) * 4;
        level0[o] = clamp01(px[0]!) * 255;
        level0[o + 1] = clamp01(px[1]!) * 255;
        level0[o + 2] = clamp01(px[2]!) * 255;
        level0[o + 3] = clamp01(px[3]!) * 255;
      }
    }
  }

  const mips: { data: Uint8Array; width: number; height: number }[] = [{ data: level0, width: w, height: h }];
  let cur = level0, cw = w, ch = h;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(cw - 1, x * 2), x1 = Math.min(cw - 1, x * 2 + 1);
        const y0 = Math.min(ch - 1, y * 2), y1 = Math.min(ch - 1, y * 2 + 1);
        const o = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) {
          next[o + c] = (cur[(y0 * cw + x0) * 4 + c]! + cur[(y0 * cw + x1) * 4 + c]! +
            cur[(y1 * cw + x0) * 4 + c]! + cur[(y1 * cw + x1) * 4 + c]! + 2) >> 2;
        }
      }
    }
    mips.push({ data: next, width: nw, height: nh });
    cur = next; cw = nw; ch = nh;
  }

  const tex = new THREE.DataTexture(level0, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips as any;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  // Masks and tint ramps are authored as linear values, not sRGB imagery.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
