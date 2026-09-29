/**
 * ============================================================================
 *  decaltex.ts — five canvas bakes that are shapes, not surfaces.
 * ============================================================================
 *  `canvastex.ts` is the plumbing every procedural texture generator writes
 *  through: the canvas, the Sobel normal, the coverage mips, the value noise.
 *  `Surface.ts` and `matlib.ts` are the material end. This is the four bakes in
 *  between that are neither — a soft disc, a soft line, an open bar grate and a
 *  sheet of stencil marks. Each one is a SHAPE with a stated falloff, and each
 *  one had exactly one copy, which is why duplication counting never saw
 *  them.
 *
 *  THEY SHIP NO COLOUR AND NO CONTENT. Every tint, every strength, every count
 *  and every string is an argument. A soft disc with a game's own darkening
 *  baked in is that game's contact shadow and no use to anybody; a soft disc
 *  with a falloff exponent is a soft disc.
 *
 *  Every one of them returns a `THREE.Texture` and not a material, so a caller
 *  decides the blend, the tier and the tint. `aniso` is passed in rather than
 *  read off a renderer, so a harness can bake without a GL context in the way.
 * ============================================================================
 */
import * as THREE from 'three';
import { cv, finish, dilateRGB, coverageMips, vnoise } from './canvastex.ts';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface SoftDiscOpts {
  /** falloff exponent on `1 − r`. Above 1 the edge softens; 1.0 is linear. */
  power: number;
  /** grain floor and span, multiplied onto the alpha */
  grainFloor: number;
  grainSpan: number;
  /** value-noise cell counts and seed for the grain */
  grainCells: number;
  grainSeed: number;
}

/**
 * A soft round alpha disc — white RGB, everything in the alpha channel.
 *
 * The falloff is a POWER of `1 − r` and not a linear ramp, because a linear one
 * leaves a visible terminator ring at the edge of the quad: the derivative of
 * the alpha is discontinuous exactly where it reaches zero, and the eye finds
 * that edge on a large soft shape every time. An exponent a little under two
 * puts the discontinuity where the alpha is already almost nothing.
 *
 * The grain is what stops a hundred instances of the same quad reading as a
 * hundred copies of one decal at a glance.
 *
 * The caller owns what it MEANS. This is the shape a contact darkening, a glow
 * pool, a scorch, a puddle and a soft light cookie all share.
 */
export function softDiscAlpha(size: number, aniso: number, o: SoftDiscOpts): THREE.Texture {
  const [c, g] = cv(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 2 - 1, v = (y / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const a = Math.pow(clamp(1 - r, 0, 1), o.power)
        * (o.grainFloor + vnoise(x / size, y / size, o.grainCells, o.grainCells, o.grainSeed) * o.grainSpan);
      const oi = (y * size + x) * 4;
      d[oi] = d[oi + 1] = d[oi + 2] = 255;
      d[oi + 3] = clamp(a, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, false, aniso, false);
}

export interface SoftLineOpts {
  /** the core's own edge, as a fraction of the half-height */
  core0: number;
  core1: number;
  /** how much of the full width the halo carries */
  halo: number;
  /** longitudinal grain floor, span, cell counts and seed */
  grainFloor: number;
  grainSpan: number;
  grainCellsU: number;
  grainCellsV: number;
  grainSeed: number;
}

/**
 * A single soft-edged line, as a CROSS-SECTION: the profile varies across v and
 * the u axis carries only grain, so the map tiles along a run of any length.
 *
 * THE PROFILE IS DELIBERATELY NOT A HARD RECTANGLE. A strip whose emissive goes
 * 0 → full in one texel has no fixture and no bleed, which reads as a strip
 * drawn ON TOP of the world rather than as a light in it. The shoulder is what
 * a diffuser looks like, and the halo under it is the light the fitting spills
 * onto the surface it is recessed into.
 *
 * The longitudinal grain exists so a 200 m run is not a perfectly even bar.
 */
export function softLineAlpha(size: number, aniso: number, o: SoftLineOpts): THREE.Texture {
  const [c, g] = cv(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const v = Math.abs((y / size) * 2 - 1);
    const core = 1 - smoothstep(o.core0, o.core1, v);
    const halo = (1 - smoothstep(0.0, 1.0, v)) * o.halo;
    for (let x = 0; x < size; x++) {
      const n = o.grainFloor + vnoise(x / size, y / size, o.grainCellsU, o.grainCellsV, o.grainSeed) * o.grainSpan;
      const a = clamp((core + halo) * n, 0, 1);
      const oi = (y * size + x) * 4;
      d[oi] = 255; d[oi + 1] = 255; d[oi + 2] = 255;
      d[oi + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, false, aniso);
}

export interface BarGrateOpts {
  /** bearing-bar periods across u, and the fraction of a period that is bar */
  bars: number;
  barFrac: number;
  /** tie-rod periods along v, and the fraction of a period that is rod */
  rods: number;
  rodFrac: number;
  /** per-channel tint multiplied onto the luminance */
  tint: readonly [number, number, number];
  /** luminance floor and the span the bar's top face adds */
  lumFloor: number;
  lumSpan: number;
  /** value the flank presents where the top face is not seen */
  flank: number;
  /** how far the bar colour is flooded into the open gaps before mipping */
  dilatePasses: number;
  /** the alpha test the coverage mips must preserve */
  alphaRef: number;
}

/**
 * Open bar grating as an ALPHA-CUT map with coverage-preserving mips.
 *
 * TWO THINGS HERE ARE NOT DECORATION.
 *
 *  · THE TOP FACE IS BRIGHTER THAN THE FLANK. A bar seen from above shows its
 *    machined top; a bar seen at a raking angle shows the side, which is out of
 *    a grazing key. Baking that difference into the luminance is what stops the
 *    result reading as a printed pattern on a solid plate.
 *  · THE MIPS ARE COVERAGE-PRESERVING AND THIS IS THE SURFACE THAT NEEDS IT. A
 *    long run of open grating taken at speed is almost entirely sampled from a
 *    low mip, and a box-filtered alpha channel loses coverage at every level —
 *    so a plain mip chain makes the bars thin out and then dissolve with
 *    distance, and the floor develops holes that were never in it.
 *    `dilateRGB` floods the bar colour into the gaps FIRST, so the shrinking
 *    colour average never drags a bar toward the black of the void behind it.
 *
 * The period counts are arguments and the caller is expected to derive them
 * from a real bar pitch and a real tile size rather than choosing them by eye
 * — see `grate.ts`'s `grateRepeats`, which does exactly that conversion and
 * says what it costs when it is wrong.
 */
export function barGrateAlpha(size: number, aniso: number, o: BarGrateOpts): THREE.Texture {
  const px = new Uint8Array(size * size * 4);
  const d = px;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const bar = ((u * o.bars) % 1);
      const rod = ((v * o.rods) % 1);
      const onBar = bar < o.barFrac;
      const onRod = rod < o.rodFrac;
      const a = onBar || onRod ? 1 : 0;
      const top = onBar ? 1 - Math.abs(bar / o.barFrac - 0.5) * 1.2 : o.flank;
      const lum = o.lumFloor + top * o.lumSpan;
      const oi = (y * size + x) * 4;
      d[oi] = lum * o.tint[0] * 255;
      d[oi + 1] = lum * o.tint[1] * 255;
      d[oi + 2] = lum * o.tint[2] * 255;
      d[oi + 3] = a * 255;
    }
  }
  dilateRGB(px, size, o.dilatePasses);
  const levels = coverageMips(px, size, o.alphaRef);
  const tex = new THREE.DataTexture(levels[0]!.data, size, size, THREE.RGBAFormat);
  tex.mipmaps = levels.map((l) => ({ data: l.data, width: l.width, height: l.height })) as never;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** One cell of a stencil sheet: what it says and how big, relative to the cell. */
export type StencilCell = readonly [text: string, scale: number];

export interface StencilSheetOpts {
  /** cells, row-major. The grid is square and its side is `rows.length`. */
  rows: readonly (readonly StencilCell[])[];
  /** the paint's own colour — a CSS colour string */
  ink: string;
  font: string;
  /** the two knock-out bridges, as fractions of `cell * scale` above/below the baseline */
  bridgeAbove: number;
  bridgeBelow: number;
  /** bridge width as a fraction of the cell, with a texel floor */
  bridgeW: number;
  /** the abrasion: two octaves of value noise, and the surviving alpha range */
  wearCellsA: number; wearSeedA: number; wearMixA: number;
  wearCellsB: number; wearSeedB: number;
  wearEdge0: number; wearEdge1: number;
  wearSpan: number; wearFloor: number;
}

/**
 * A grid of stencil marks on one transparent sheet, for instanced decals.
 *
 * A STENCIL IS CUT, AND THAT IS THE WHOLE OF IT. Every letter of a real stencil
 * carries bridges, because the counters of an O and an A have to be held to the
 * rest of the plate by something. Drawing text and then knocking two bars out
 * of it across the whole cell is what makes the result read as a stencil rather
 * than as a decal of a font, and it costs two lines.
 *
 * THE ABRASION IS NOT AN EFFECT. Paint on a surface that has been walked on and
 * dragged over does not survive intact; an unbroken stencil is the tell that
 * nothing has ever happened on this floor. Two octaves — one fine, one coarse —
 * so the wear has a shape rather than a texture.
 *
 * `repeat` is FALSE on the result, deliberately: an atlas that wraps bleeds one
 * cell's glyph into the next at every mip level, and the bleed appears first at
 * exactly the distance the marks stop being readable, so it looks like dirt.
 *
 * Every string, every colour and every scale is the caller's. This function
 * knows what a stencil IS; it does not know what this floor is called.
 */
export function stencilSheet(size: number, aniso: number, o: StencilSheetOpts): THREE.Texture {
  const [c, g] = cv(size);
  g.clearRect(0, 0, size, size);
  const n = o.rows.length;
  const cell = size / n;
  for (let r = 0; r < n; r++) {
    const row = o.rows[r]!;
    for (let k = 0; k < row.length; k++) {
      const [txt, sc] = row[k]!;
      const cx = k * cell + cell / 2, cy = r * cell + cell / 2;
      g.save();
      g.translate(cx, cy);
      g.fillStyle = o.ink;
      g.strokeStyle = o.ink;
      g.font = o.font.replace('{px}', String(Math.round(cell * sc)));
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = Math.max(1.5, cell * o.bridgeW);
      g.beginPath();
      g.moveTo(-cell * 0.5, -cell * sc * o.bridgeAbove); g.lineTo(cell * 0.5, -cell * sc * o.bridgeAbove);
      g.moveTo(-cell * 0.5, cell * sc * o.bridgeBelow); g.lineTo(cell * 0.5, cell * sc * o.bridgeBelow);
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
  }
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const oi = (y * size + x) * 4;
      if (!d[oi + 3]) continue;
      const w = vnoise(x / size, y / size, o.wearCellsA, o.wearCellsA, o.wearSeedA) * o.wearMixA
        + vnoise(x / size, y / size, o.wearCellsB, o.wearCellsB, o.wearSeedB) * (1 - o.wearMixA);
      d[oi + 3]! *= clamp(smoothstep(o.wearEdge0, o.wearEdge1, w) * o.wearSpan + o.wearFloor, 0, 1);
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, true, aniso, false);
}

export interface LegendLine {
  text: string;
  /** a CSS font shorthand, complete. The caller owns the family and the weight. */
  font: string;
  /** centre of the line as a fraction of the sheet's height */
  y: number;
  /** how hard the paint went on, 0..1 */
  alpha: number;
}

export interface LegendOpts {
  width: number;
  height: number;
  /** the paint's own colour, a CSS string. Never pure white on a lit surface. */
  ink: string;
  lines: readonly LegendLine[];
}

/**
 * Painted lettering on a transparent sheet — a name and its small print.
 *
 * The wordmark on a vehicle, the designation on a pad, the plate on a door.
 * Every one of them is the same bake: a rectangular canvas, N centred lines at
 * N sizes and N alphas, and an sRGB texture that does not wrap.
 *
 * IT IS RECTANGULAR AND `cv()` IS NOT, which is the reason it makes its own
 * canvas. Lettering is wide and short — a name at 4:1 on a square sheet spends
 * three quarters of its texels on nothing, and on a decal read at forty pixels
 * the texels it does spend are the whole of the legibility.
 *
 * `repeat` is FALSE for the reason `stencilSheet` gives: a sheet that wraps
 * bleeds its last column into its first at every mip level, and the bleed
 * appears first at exactly the distance the letters stop being readable.
 *
 * NO COLOUR, NO FONT AND NO STRING OF ITS OWN. A legend that knew what it said
 * would be one game's legend; this one knows how lettering is laid out.
 */
export function paintedLegend(aniso: number, o: LegendOpts): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = o.width;
  c.height = o.height;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, o.width, o.height);
  g.fillStyle = o.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of o.lines) {
    g.font = l.font;
    g.globalAlpha = l.alpha;
    g.fillText(l.text, o.width * 0.5, o.height * l.y);
  }
  return finish(c, true, aniso, false);
}
