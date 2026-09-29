/**
 * ============================================================================
 *  tileatlas — N generated tiles in one texture, with a mip chain built by
 *  hand.
 * ============================================================================
 *
 *  A set of procedural tiles that a shader picks between by uv offset: decal
 *  masks, sprite frames, greeble stamps, a sheet of icons. One texture, one
 *  bind, one draw.
 *
 *  ── WHY THE MIPS ARE BUILT HERE AND NOT BY THE DRIVER ──────────────────────
 *
 *  `generateMipmaps` on a `DataTexture` is a GPU path in some three versions
 *  and a CPU path in others, and neither is available before the texture has
 *  been uploaded — so a caller that wants the chain to exist on the frame it
 *  built the atlas has to make it itself. Doing it here also means the filter
 *  is KNOWN: a plain 2x2 box, rounded half-up, which is what the sampler's
 *  trilinear tap expects and what keeps a mask's coverage constant down the
 *  chain. A driver's own downsample is usually a box too, and "usually" is the
 *  problem.
 *
 *  ── THE COARSE LEVELS BLEED ACROSS TILE BOUNDARIES, AND THAT IS ACCEPTED ───
 *
 *  Below the level where one tile is a single texel, a box filter is averaging
 *  neighbours that belong to different tiles. There is no way around it for a
 *  grid atlas that is not either padding every tile (which costs the packing)
 *  or stopping the chain early (which costs the minification). It is only ever
 *  reached by geometry small enough that the tile is sub-pixel, and a mark that
 *  is one pixel across being the average of four marks is not a visible defect.
 *  Stated rather than discovered: a reader looking at a blurred atlas at
 *  distance should know this is the reason and not a wrap-mode bug.
 *
 *  ── LINEAR DATA OR COLOUR IS THE CALLER'S CALL, AND IT MATTERS ─────────────
 *
 *  A MASK is data — coverage, strength, a packed normal — and decoding it as
 *  sRGB applies a transfer curve to a number that is not a colour, which shows
 *  up as a mark that is too dark in its middle range and looks like a tuning
 *  problem. There is no default: `srgb` has to be answered.
 *
 *  ── EVERY OTHER NUMBER IS THE CALLER'S TOO ─────────────────────────────────
 *
 *  The grid, the tile size and the anisotropy. Anisotropy in particular is a
 *  budget decision about one game's texture memory and one platform's cap, not
 *  a property of an atlas.
 *
 *  Nothing here rasterises anything: `AtlasTile` is handed a uv in [0, 1) at
 *  the CENTRE of each texel and writes four floats. What a tile looks like is
 *  content, always.
 */
import * as THREE from 'three';

/**
 * One tile's generator. `u`/`v` are texel centres in [0, 1); write red, green,
 * blue and alpha as floats into `out`. Values outside [0, 1] are clamped on
 * the way to bytes.
 */
export type AtlasTile = (u: number, v: number, out: Float32Array) => void;

/** Every number the atlas uses. None of them has a default. */
export interface TileAtlasOptions {
  /** Tiles across. `cols * rows` must be at least `tiles.length`. */
  cols: number;
  /** Tiles down. */
  rows: number;
  /** Edge length of ONE tile, texels. A power of two, or the chain is ragged. */
  size: number;
  /** true to decode as sRGB, false for data. See the header. */
  srgb: boolean;
  /** Anisotropic sample count. A budget decision, not a property of an atlas. */
  anisotropy: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Rasterise `tiles` into one `DataTexture` laid out row-major across the grid,
 * with a complete box-filtered mip chain and `generateMipmaps` off.
 *
 * Clamped at both edges: an atlas that wrapped would sample the tile on the
 * far side of the sheet at the boundary, which is the single most common way a
 * grid atlas produces a hairline of the wrong mark along every edge.
 */
export function tileAtlas(tiles: readonly AtlasTile[], o: TileAtlasOptions): THREE.DataTexture {
  const w = o.size * o.cols, h = o.size * o.rows;
  const level0 = new Uint8Array(w * h * 4);
  const px = new Float32Array(4);
  for (let t = 0; t < tiles.length; t++) {
    const fn = tiles[t];
    if (fn === undefined) continue;
    const ox = (t % o.cols) * o.size;
    const oy = ((t / o.cols) | 0) * o.size;
    for (let y = 0; y < o.size; y++) {
      for (let x = 0; x < o.size; x++) {
        fn((x + 0.5) / o.size, (y + 0.5) / o.size, px);
        const i = ((oy + y) * w + ox + x) * 4;
        level0[i] = clamp01(px[0]!) * 255;
        level0[i + 1] = clamp01(px[1]!) * 255;
        level0[i + 2] = clamp01(px[2]!) * 255;
        level0[i + 3] = clamp01(px[3]!) * 255;
      }
    }
  }

  const mips: { data: Uint8Array; width: number; height: number }[] = [];
  let cur = level0, cw = w, ch = h;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        // Clamped taps, so an odd dimension repeats its last row or column
        // rather than reading off the end and folding the far edge in.
        const x0 = Math.min(cw - 1, x * 2), x1 = Math.min(cw - 1, x * 2 + 1);
        const y0 = Math.min(ch - 1, y * 2), y1 = Math.min(ch - 1, y * 2 + 1);
        const i = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) {
          // +2 before the shift is round-half-up. Truncating instead loses a
          // half count per level, which over a ten-level chain darkens a mask
          // by five counts at the top — invisible per level, obvious at range.
          next[i + c] = (cur[(y0 * cw + x0) * 4 + c]! + cur[(y0 * cw + x1) * 4 + c]!
            + cur[(y1 * cw + x0) * 4 + c]! + cur[(y1 * cw + x1) * 4 + c]! + 2) >> 2;
        }
      }
    }
    mips.push({ data: next, width: nw, height: nh });
    cur = next; cw = nw; ch = nh;
  }

  const tex = new THREE.DataTexture(level0, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips as unknown as THREE.DataTexture['mipmaps'];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = o.anisotropy;
  tex.needsUpdate = true;
  return tex;
}
