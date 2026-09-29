/**
 * ============================================================================
 *  databake — a procedural PBR map set baked TEXEL BY TEXEL into DataTextures.
 * ============================================================================
 *
 *  A generator writes one struct per texel — height, albedo, roughness,
 *  metalness, AO — and gets back three tiling textures: sRGB albedo, a wrapping
 *  Sobel normal, and one ORM (R = ambient occlusion, G = roughness,
 *  B = metalness) that serves three of three's material slots from one texture
 *  unit, because three reads roughness from .g and metalness from .b.
 *
 *  ## Why this stands beside `Textures.ts` rather than inside it
 *
 *  `Textures.ts` publishes the same idea against a 2D CANVAS: a `Fields` object
 *  of `Uint8ClampedArray`s, `sobelNormalBytes`, `buildMaps`. It is not this and
 *  the two are not interchangeable, in three ways that all MOVE PIXELS:
 *
 *    · The canvas path round-trips every byte through an alpha-premultiplied
 *      backing store (see the long note in `Textures.ts`); this one hands
 *      `Uint8Array` straight to `THREE.DataTexture` and never premultiplies.
 *    · The Sobel green channel comes out with the OPPOSITE sign, and the blue
 *      channel is encoded `v * 0.5 + 0.5` there and as a bare cosine here.
 *      Either convention is defensible; they are not the same normal map.
 *    · `buildMaps` scales the caller's normal strength by `size * 0.012`, so
 *      the same argument means a different relief at a different resolution.
 *
 *  Collapsing them compiles, passes everything, and re-lights every surface in
 *  whichever game loses. So they stand side by side — the same standing
 *  refusal `cascade.ts`/`cascadederiv.ts` carries — and a caller picks by which
 *  convention its textures were authored against.
 *
 *  ## The two colour helpers are the load-bearing part
 *
 *  `hexRGB` and `workingColor` look like conveniences and are not: they are the
 *  two ANSWERS to three's ColorManagement, and getting either wrong is a
 *  uniform shift across a whole palette that gets blamed on the tone map. Both
 *  arguments are written out at their declarations.
 *
 *  Arrived from a base-building game's structures module. NOTHING here names
 *  a colony: every colour is an argument, every world size is an argument, and
 *  the generators that decide what a printed regolith shell looks like stayed
 *  in the game. A parity probe compared every byte of every map against the
 *  pre-move source when it moved.
 */
import * as THREE from 'three';
import { clamp01 } from '@homie-rocks/noise/Noise.js';
import { smoothstep01 } from '@homie-rocks/noise/Periodic.js';

export interface MapSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
  /** World size in metres that one tile of this texture covers. */
  worldSize: number;
}

export interface Texel {
  /** Height in 0..1, sobel'd into the normal map. */
  h: number;
  r: number; g: number; b: number;
  rough: number;
  metal: number;
  ao: number;
}

const _texel: Texel = { h: 0, r: 0, g: 0, b: 0, rough: 0.9, metal: 0, ao: 1 };

export function bakeMaps(
  size: number,
  worldSize: number,
  normalStrength: number,
  aniso: number,
  fn: (u: number, v: number, t: Texel) => void,
): MapSet {
  const n = size * size;
  const height = new Float32Array(n);
  const alb = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      _texel.h = 0.5; _texel.r = 0.5; _texel.g = 0.5; _texel.b = 0.5;
      _texel.rough = 0.9; _texel.metal = 0; _texel.ao = 1;
      fn(x / size, y / size, _texel);
      height[i] = _texel.h;
      alb[i * 4] = _texel.r * 255; alb[i * 4 + 1] = _texel.g * 255;
      alb[i * 4 + 2] = _texel.b * 255; alb[i * 4 + 3] = 255;
      orm[i * 4] = _texel.ao * 255; orm[i * 4 + 1] = _texel.rough * 255;
      orm[i * 4 + 2] = _texel.metal * 255; orm[i * 4 + 3] = 255;
    }
  }

  // Sobel, wrapping at the edges so the normal map tiles with the albedo.
  const nrm = new Uint8Array(n * 4);
  // The `!` is the package's noUncheckedIndexedAccess and nothing else: the
  // index is wrapped into 0..size-1 on both axes before it is used.
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * normalStrength, ny = -dy * normalStrength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      nrm[i] = (nx * 0.5 + 0.5) * 255;
      nrm[i + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[i + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  }

  const mk = (data: Uint8Array, srgb: boolean) => tilingDataTexture(data, size, srgb, aniso);
  return { map: mk(alb, true), normalMap: mk(nrm, false), orm: mk(orm, false), worldSize };
}

/**
 * A square RGBA byte buffer as a REPEATING, MIPMAPPED, filtered DataTexture.
 *
 * Six property writes, and getting any one of them wrong is a defect that
 * renders — which is why this is one function and not six lines at each of the
 * places that bakes a map.
 *
 * COLOUR SPACE IS THE ARGUMENT AND NOT A DEFAULT, because it is the classic
 * silent bug in this repository: albedo is authored in sRGB and must decode,
 * while a normal map and an ORM pack are DATA and must not. Tagging a normal
 * map sRGB does not throw and does not look obviously wrong — it bends every
 * surface's shading toward flat and gets blamed on the light rig.
 *
 * `generateMipmaps` is unconditional and `minFilter` is trilinear: a repeating
 * surface texture sampled at grazing incidence without mips is the single
 * loudest aliasing source in a ground shader, and the anisotropy the caller
 * passes is what turns the resulting blur back into detail.
 */
export function tilingDataTexture(
  data: Uint8Array, size: number, srgb: boolean, aniso: number,
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * ===========================================================================
 *  A TANGENT-SPACE NORMAL MAP FROM A WRAPPING HEIGHT FIELD, BY CENTRAL
 *  DIFFERENCE — AND IT IS PUBLISHED BESIDE `bakeMaps`' SOBEL, NOT MERGED WITH
 *  IT.
 * ===========================================================================
 *  Two filters, two answers, and the difference is a look rather than a
 *  rounding error. A 3x3 Sobel low-passes across the gradient axis, so it is
 *  the right filter for a field with per-texel noise in it — it will not turn
 *  single-texel grain into a field of spikes. A two-tap central difference
 *  keeps every texel of detail and is the right filter for a field that has
 *  already been built band-limited, where a Sobel simply throws half of the
 *  authored relief away. A shared implementation would compile, pass
 *  everything, and quietly give one surface the other's microstructure. Two
 *  things that genuinely differ stay two, in a texture baker as anywhere.
 *
 *  `strength` multiplies the gradient before normalisation, so it is where a
 *  caller says how deep the field's units are relative to a texel. It scales
 *  with the texture size at the call site, not here: how many metres a texel
 *  covers is a property of the surface, not of the filter.
 *
 *  Wraps on both axes, so the map tiles with the albedo it was baked beside.
 * ===========================================================================
 */
export function centralDiffNormalBytes(
  height: Float32Array, size: number, strength: number,
): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const rc = y * size, rm = ym * size, rp = yp * size;
      // Per-texel slope, then scaled: the `* size * 0.5` converts a
      // neighbour-to-neighbour difference into a per-unit-uv gradient, which is
      // what makes `strength` independent of the resolution the map is baked at.
      const gx = (height[rc + xp]! - height[rc + xm]!) * size * 0.5;
      const gy = (height[rp + x]! - height[rm + x]!) * size * 0.5;
      const nx = -gx * strength;
      const ny = -gy * strength;
      const nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const o = (y * size + x) * 4;
      out[o] = (nx * l * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * l * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * l * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

const _c = new THREE.Color();

/**
 * A palette hex as raw sRGB 0..1, for writing into an albedo BYTE buffer.
 *
 * NoColorSpace is the load-bearing argument. three's ColorManagement is on by
 * default since r152, so `new Color(0x6b6560)` returns LINEAR components — and
 * writing those into a texture that is then tagged SRGBColorSpace has the GPU
 * decode them a second time on sample. The whole palette comes out roughly
 * gamma-squared: regolith at #6b6560 renders as #3a3631. It is a uniform
 * darkening across every generator, which is exactly why it would be blamed on
 * the exposure or the tone map and chased for days.
 */
export function hexRGB(hex: number, out: { r: number; g: number; b: number }, mul = 1) {
  _c.setHex(hex, THREE.NoColorSpace);
  out.r = clamp01(_c.r * mul); out.g = clamp01(_c.g * mul); out.b = clamp01(_c.b * mul);
}

/**
 * A palette hex in the renderer's WORKING colour space, for a vertex-colour or
 * emissive attribute (three never converts those, it assumes they are already
 * working-space).
 *
 * The guard covers both worlds: with ColorManagement on, `setHex(hex, SRGB)`
 * has already converted; with it off, nothing has, and the manual conversion is
 * required. Calling `convertSRGBToLinear()` unconditionally — which is what
 * another game's helper did — double-converts in the default configuration and
 * mutes every cyan strip in the game by about 2.5x in red.
 */
export function workingColor(hex: number, out: THREE.Color): THREE.Color {
  out.setHex(hex, THREE.SRGBColorSpace);
  if (!THREE.ColorManagement.enabled) out.convertSRGBToLinear();
  return out;
}

/**
 * Bind a `MapSet` to a standard material, deriving the repeat from `worldSize`.
 *
 * The whole point is that UVs are authored in METRES. The repeat is then the
 * reciprocal of the texture's world size, and tiling comes out correct at
 * real-world scale on every piece of geometry without any call site thinking
 * about it — which is also what makes "no visible repeat within one camera
 * frame" a property of the generator rather than of each consumer.
 *
 * All three of aoMap, roughnessMap and metalnessMap take the SAME texture; see
 * the header on why one ORM texture serves three slots and one texture unit.
 */
export function applyMaps(mat: THREE.MeshStandardMaterial, s: MapSet) {
  const r = 1 / s.worldSize;
  s.map.repeat.set(r, r); s.normalMap.repeat.set(r, r); s.orm.repeat.set(r, r);
  mat.map = s.map;
  mat.normalMap = s.normalMap;
  mat.aoMap = s.orm;
  mat.roughnessMap = s.orm;
  mat.metalnessMap = s.orm;
}

/**
 * ===========================================================================
 *  A RADIAL CONTACT DECAL — the soft darkening under a standing object.
 * ===========================================================================
 *  Two concentric falloff lobes composited into a MULTIPLY-blend texture: a
 *  tight dark core at the contact line and a wide soft skirt around it. It is
 *  the third of the three grounding cues (the other two, ambient occlusion and
 *  contact shadows, are the renderer's), and on a low quality tier where those
 *  two are off it carries the grounding alone — an object missing it reads as
 *  pasted onto the ground immediately, whatever else is right about the frame.
 *
 *  MULTIPLY CONVENTION: 255 is transparent and 0 is black, which is why the
 *  value is written as an inverse. `depth` is how far toward black the darkest
 *  texel is allowed to go, and it defaults BELOW 1 on purpose — a decal that
 *  reaches a pure black is the fastest way to break an art direction that
 *  forbids one anywhere in frame. A caller that genuinely wants black passes 1
 *  and owns it.
 *
 *  `tint` multiplies the three channels after the falloff, so a shadow can be
 *  given the hue of the sky filling it — a cool bias under a blue hemisphere,
 *  a warm one under a sodium lamp. It is a per-channel multiplier rather than a
 *  colour because the thing being tinted is a TRANSMISSION and not a paint.
 *
 *  Nothing here names a surface, a game or a light. The radii, the weights, the
 *  depth and the tint are all the caller's.
 */
export interface RadialDecalOpts {
  /** Texture edge in texels. Square, mipmapped, clamped. */
  size?: number;
  /** Smoothstep edges of the tight core lobe, in units of the half-width. */
  core?: [number, number];
  /** Smoothstep edges of the wide skirt lobe. */
  skirt?: [number, number];
  /** How much of the occlusion the core carries. */
  coreWeight?: number;
  /** How much of it the skirt carries. */
  skirtWeight?: number;
  /** Darkest value reached at full occlusion, 0..1. Under 1 keeps it off black. */
  depth?: number;
  /** Per-channel multiplier applied after the falloff. */
  tint?: [number, number, number];
}

export function bakeRadialDecal(o: RadialDecalOpts = {}): THREE.Texture {
  const S = o.size ?? 128;
  const [c0, c1] = o.core ?? [0.0, 0.42];
  const [s0, s1] = o.skirt ?? [0.2, 1.0];
  const cw = o.coreWeight ?? 0.62;
  const sw = o.skirtWeight ?? 0.3;
  const depth = o.depth ?? 0.86;
  const [tr, tg, tb] = o.tint ?? [1, 1, 1.04];
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const core = 1 - smoothstep01(c0, c1, d);
      const skirt = 1 - smoothstep01(s0, s1, d);
      const occ = clamp01(core * cw + skirt * sw);
      const v = Math.round(255 * (1 - occ * depth));
      const i = (y * S + x) * 4;
      data[i] = Math.round(v * tr); data[i + 1] = Math.round(v * tg);
      data[i + 2] = Math.round(v * tb); data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * ===========================================================================
 *  TWO PANEL SPLITS — the CPU twins of `PANEL_PARS`'s `mbSplit`.
 * ===========================================================================
 *  A uniform panel grid is an automatic fail in the art direction of every
 *  game this came from, and the two honest answers are the two below. Both
 *  tile, both are deterministic from a seed, and neither knows what is being
 *  panelised.
 *
 *  TWO, NOT ONE PARAMETERISED SPLIT, because they answer different questions.
 *  `stretcherBond` has a FIXED cell count with jittered boundaries and a
 *  per-row horizontal offset — a hand-laid facing between fixed stiffener
 *  lines, where the pitch is set by the structure and only the placement
 *  varies. `randomWidthPanels` has a VARIABLE cell count built by walking a
 *  random width at a time — a plated hull, where nothing constrains where a
 *  seam falls. Collapsing them would compile and would give one of the two
 *  surfaces the other's rhythm, which is the whole reason a surface reads as
 *  the material it is.
 *
 *  THE FIRST AND LAST BOUNDARY NEVER MOVE, in both. That is not tidiness: a
 *  jittered boundary at u = 0 or u = 1 stops the field tiling, and a texture
 *  that does not tile shows a hard seam down every surface it is applied to.
 */

/** Where one texel falls inside its cell. */
export interface PanelCell {
  /** Row and column index, for hashing a per-cell draw. */
  ri: number;
  ci: number;
  /** Position across the cell, 0..1 on each axis. */
  rowT: number;
  colT: number;
  /**
   * Distance to the nearest cell edge, RENORMALISED so a wide cell does not
   * get a wider gap than a narrow one. In units of a nominal cell.
   */
  dEdge: number;
}

export interface PanelSplit {
  /** Nominal cells per axis. A caller hashing per cell needs it as a modulus. */
  cells: number;
  /** Resolve one texel. Writes into `out` and returns it; allocates nothing. */
  at(u: number, v: number, out: PanelCell): PanelCell;
}

/**
 * A jittered lattice in a stretcher bond.
 *
 * `cells` boundaries per axis, each displaced by up to `jitter` of a cell, plus
 * a per-row horizontal offset — which is the part that matters. Jittering the
 * boundaries alone still reads as a grid, because every row shares its vertical
 * joints; the offset is what breaks the columns and turns it into brickwork.
 *
 * @param jitter total boundary displacement as a fraction of one cell, so 0.56
 *               gives cells between 72% and 128% of nominal.
 */
export function stretcherBond(cells: number, jitter: number, rng: () => number): PanelSplit {
  const NC = cells;
  const rowB = new Float32Array(NC + 1);
  const colB = new Float32Array(NC + 1);
  const rowJit = new Float32Array(NC);
  for (let i = 0; i <= NC; i++) {
    // The first and last boundary must stay put or the field stops tiling.
    const j = i === 0 || i === NC ? 0 : (rng() - 0.5) * jitter;
    rowB[i] = (i + j) / NC;
    const k = i === 0 || i === NC ? 0 : (rng() - 0.5) * jitter;
    colB[i] = (i + k) / NC;
  }
  // Per-row horizontal offset: a stretcher bond, so no two rows share a
  // vertical joint. This is what stops the jittered grid still reading as one.
  for (let i = 0; i < NC; i++) rowJit[i] = rng();
  const findCell = (x: number, b: Float32Array) => {
    let i = 0;
    while (i < NC - 1 && b[i + 1]! <= x) i++;
    return i;
  };
  return {
    cells: NC,
    at(u: number, v: number, out: PanelCell): PanelCell {
      const ri = findCell(v, rowB);
      const uu = (u + rowJit[ri]!) % 1;
      const ci = findCell(uu, colB);
      out.ri = ri;
      out.ci = ci;
      out.rowT = (v - rowB[ri]!) / (rowB[ri + 1]! - rowB[ri]!);
      out.colT = (uu - colB[ci]!) / (colB[ci + 1]! - colB[ci]!);
      out.dEdge = Math.min(
        Math.min(out.rowT, 1 - out.rowT) * (rowB[ri + 1]! - rowB[ri]!),
        Math.min(out.colT, 1 - out.colT) * (colB[ci + 1]! - colB[ci]!),
      ) * NC;
      return out;
    },
  };
}

/** One row of a `randomWidthPanels` split, plus the per-row draw it carries. */
export interface PanelRows {
  /** Row boundaries, first 0 and monotone past 1. */
  rowY: number[];
  /** Column boundaries per row. */
  rowSplit: number[][];
  /** One draw per row, for whatever the caller varies row by row. */
  rowDraw: number[];
  /** The row the caller marked as the odd one out. */
  oddRow: number;
  /** Resolve one texel. Writes into `out` and returns it; allocates nothing. */
  at(u: number, v: number, out: PanelCell): PanelCell;
}

/**
 * Rows of random height, each split into columns of random width.
 *
 * Walks a width at a time rather than displacing a fixed lattice, so the CELL
 * COUNT itself varies and no two rows have the same number of panels. That is
 * what a plated hull looks like and what a stiffened facing does not.
 *
 * `oddRow` is drawn last and is the caller's affordance for the rule every
 * game's art direction states in the same words: at least one panel visibly a
 * different age than its neighbours. It is an index, not a look — what "older"
 * means is the caller's.
 *
 * THE DRAWS COME OFF THE RNG IN A FIXED ORDER — all row heights, then every
 * row's columns in row order, then one draw per row, then the odd row. A caller
 * reproducing this stream elsewhere has to keep that order; it is why the
 * function takes the rng rather than a seed.
 */
export function randomWidthPanels(
  rowMin: number, rowRange: number, colMin: number, colRange: number, rng: () => number,
): PanelRows {
  const rowY: number[] = [0];
  while (rowY[rowY.length - 1]! < 1) rowY.push(rowY[rowY.length - 1]! + rowMin + rng() * rowRange);
  const rowSplit: number[][] = rowY.map(() => {
    const cols: number[] = [0];
    while (cols[cols.length - 1]! < 1) cols.push(cols[cols.length - 1]! + colMin + rng() * colRange);
    return cols;
  });
  const rowDraw = rowY.map(() => rng());
  const oddRow = Math.floor(rng() * rowY.length);
  return {
    rowY, rowSplit, rowDraw, oddRow,
    at(u: number, v: number, out: PanelCell): PanelCell {
      let ri = 0;
      while (ri < rowY.length - 1 && rowY[ri + 1]! < v) ri++;
      const cols = rowSplit[ri]!;
      let ci = 0;
      while (ci < cols.length - 1 && cols[ci + 1]! < u) ci++;
      out.ri = ri;
      out.ci = ci;
      // The 1e-4 floor is the last row, whose upper boundary is past 1 and is
      // read as 1: without it the final band divides by whatever the overshoot
      // happened to be and the seam field goes to infinity on one row.
      out.rowT = (v - rowY[ri]!) / Math.max(1e-4, (rowY[ri + 1] ?? 1) - rowY[ri]!);
      out.colT = (u - cols[ci]!) / Math.max(1e-4, (cols[ci + 1] ?? 1) - cols[ci]!);
      out.dEdge = Math.min(out.rowT, 1 - out.rowT, out.colT, 1 - out.colT);
      return out;
    },
  };
}
