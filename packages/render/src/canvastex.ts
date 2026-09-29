/**
 * ============================================================================
 *  canvastex — the 2D-canvas texture generator the two racers share.
 * ============================================================================
 *  This is 259 lines that stood BYTE-IDENTICAL inside the prop module of a kart
 *  racer and of a space racer. The two games are forks of each other and their
 *  PROP SETS ARE DISJOINT, which is why the 62 and 77 generators below this
 *  block in each game are staying where they are. But the generators all stand
 *  on the same substrate, and the substrate never diverged: a canvas pair, the
 *  upload settings, the alpha cut-out pipeline, an integer-lattice value noise,
 *  and two field-to-texture converters.
 *
 *  WHAT IS DELIBERATELY NOT HERE, and each omission is a trap already sprung
 *  once in this repository:
 *
 *  · `fbm`. The kart racer has it, the space racer does not, and the kart
 *    racer's carries a Nyquist guard written against a specific defect (a
 *    sponsor board fizzing at three octaves in a 512² map). One game having a
 *    function is not two games sharing one, so it stays in that game; the
 *    guard itself is published below as `fbmTile`.
 *
 *  · `@homie-rocks/noise`'s `hash2`. It has the same NAME and a different body —
 *    different multiplier constants entirely. Swapping it in would recompute
 *    every texel of every material in both games while compiling cleanly and
 *    passing every existing check. A same-named function is not the same
 *    function.
 *
 *  · `@homie-rocks/noise`'s `smoothstep`. It guards the divide (`e1 - e0 || 1e-6`)
 *    and clamps through `clamp01`; the racers' returns NaN when e0 === e1.
 *    noise's is BETTER. Adopting it is an upgrade with a before-and-after of
 *    its own, not a passenger on a parity move, so `clamp` below is the
 *    racers' own and this file does not import from noise at all.
 *
 *  THE `!` ON THE TYPED-ARRAY READS. Identical reasoning to `Textures.ts` in
 *  this same package, whose comment states it at length: the games run
 *  `strict: false`, this package runs `noUncheckedIndexedAccess`, and the
 *  three answers are loosen-the-flag (fixes the ruler to the plank), add real
 *  bounds checks (a branch per texel inside a 1024² loop, bought with
 *  nothing, and it changes what the code DOES), or assert. `!` erases at
 *  emit, so the JavaScript that ships is character-for-character what the two
 *  games shipped. Every index here is provably in range by construction —
 *  `dilateRGB` bounds-checks its four neighbours before reading, the mip loop
 *  allocates `w * w * 4` and walks exactly that, and `normalFromHeight` wraps
 *  modulo `size`. Widen one of those loops and the assertion is what you have
 *  to re-earn; the compiler will not ask you again.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * The racers' own clamp, verbatim. NOT `@homie-rocks/noise`'s — see the header. It
 * is module-private because the games keep exporting their own from their
 * prop modules, where hundreds of call sites name it.
 */
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Canvas texture generation
// ---------------------------------------------------------------------------

export function cv(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  return [c, g];
}

/** One family of parallel diagonals: which way it leans, its colour, its phase. */
export interface WeaveStrand {
  /** run over rise. +1 leans one way, -1 the other; 0 is vertical. */
  dx: number;
  /** a CSS stroke colour. Two strands at two brightnesses is what makes a weave. */
  shade: string;
  /** phase, in pixels along x, so the two families do not cross at the same points. */
  offset: number;
}

/**
 * A woven diagonal screen, drawn into a caller's context.
 *
 * Wire mesh, chain link, a grating, an expanded-metal walkway, a speaker
 * grille. Every one of them is two families of parallel diagonals leaning
 * opposite ways, and the ONLY thing that makes it read as woven rather than as
 * a printed grid is that the two families are drawn at DIFFERENT BRIGHTNESSES
 * and at different phases: the eye reads the darker family as passing under.
 * One shade and a shared phase gives a lattice, which is a different object.
 *
 * The lines run the full height and are started a canvas-height before x = 0
 * and ended a canvas-height after the right edge, so a diagonal that leaves
 * the top-right corner still enters at the bottom-left and the pattern has no
 * bald corners. That is why the loop is over `-h .. w + h` and not `0 .. w`.
 *
 * A PAINTER AND NOT A TEXTURE FACTORY, deliberately: every real use composites
 * something on top of the weave — treads, rivets, a frame, the hoops it is
 * laced to — and a function that handed back a finished texture would force
 * every one of those to draw into a second canvas and blend it.
 */
export function weaveDiagonals(
  g: CanvasRenderingContext2D, w: number, h: number,
  o: { spacing: number; width: number; strands: readonly WeaveStrand[] },
): void {
  for (const s of o.strands) {
    g.strokeStyle = s.shade;
    g.lineWidth = o.width;
    g.beginPath();
    for (let i = -h; i < w + h; i += o.spacing) {
      g.moveTo(i + s.offset, 0);
      g.lineTo(i + s.offset + s.dx * h, h);
    }
    g.stroke();
  }
}

export function finish(c: HTMLCanvasElement, srgb: boolean, aniso: number, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Alpha cut-out pipeline
// ---------------------------------------------------------------------------
//  The first leaf edges had a black fringe halo and crawled badly. Both are the
//  same bug and neither is fixed by a bigger texture:
//
//  1. A 2D canvas stores premultiplied alpha, so every fully transparent texel
//     reads back as (0,0,0,0). Bilinear filtering and mip generation then
//     average that BLACK into the leaf edge, which is the dark fringe. The fix
//     is to flood the leaf's own colour outward into the transparent region
//     before upload — the alpha still cuts the shape, but whatever the filter
//     drags in from outside is now leaf-coloured. Because putImageData would
//     re-premultiply and throw the dilated colour away again, the result has to
//     be uploaded as a DataTexture, not a CanvasTexture.
//
//  2. Box-filtering alpha halves the number of texels above alphaTest at every
//     mip level, so fronds thin out and dissolve into shimmer with distance.
//     Castano's fix is to rescale each level's alpha so the fraction of texels
//     that survive the SAME alphaTest matches level 0.
// ---------------------------------------------------------------------------

export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Flood the RGB of an alpha cut-out outward into its transparent region. */
export function dilateRGB(px: Uint8Array, size: number, passes = 8) {
  const known = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) known[i] = px[i * 4 + 3]! > 6 ? 1 : 0;
  const next = new Uint8Array(known);
  for (let p = 0; p < passes; p++) {
    let grew = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (known[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
          const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (!known[j]) continue;
          r += px[j * 4]!;
          g += px[j * 4 + 1]!;
          b += px[j * 4 + 2]!;
          n++;
        }
        if (!n) continue;
        px[i * 4] = (r / n) | 0;
        px[i * 4 + 1] = (g / n) | 0;
        px[i * 4 + 2] = (b / n) | 0;
        next[i] = 1;
        grew = true;
      }
    }
    known.set(next);
    if (!grew) break;
  }
  // Anything the flood never reached — the far corners of a sparse sheet — gets
  // the mean colour rather than staying black. Those texels only surface in the
  // bottom mips, where a whole quadrant is averaged into one texel, and that is
  // precisely where a leftover black would darken the leaf.
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < size * size; i++) {
    if (!known[i]) continue;
    r += px[i * 4]!;
    g += px[i * 4 + 1]!;
    b += px[i * 4 + 2]!;
    n++;
  }
  if (!n) return;
  r = (r / n) | 0;
  g = (g / n) | 0;
  b = (b / n) | 0;
  for (let i = 0; i < size * size; i++) {
    if (known[i]) continue;
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
  }
}

/**
 * Coverage-preserving mip chain. Colour is averaged weighted by alpha so the
 * dilated skirt never washes out the leaf; alpha is averaged flat and then
 * rescaled so `alphaTest` keeps the same silhouette area at every level.
 */
export function coverageMips(base: Uint8Array, size: number, ref: number): MipLevel[] {
  const out: MipLevel[] = [{ data: base, width: size, height: size }];
  const refB = ref * 255;
  let target = 0;
  for (let i = 0; i < size * size; i++) if (base[i * 4 + 3]! >= refB) target++;
  target /= size * size;
  let prev = base;
  let pw = size;
  while (pw > 1) {
    const w = pw >> 1;
    const dst = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          wsum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const s = ((y * 2 + dy) * pw + (x * 2 + dx)) * 4;
            const av = prev[s + 3]!;
            const wgt = av + 1;
            r += prev[s]! * wgt;
            g += prev[s + 1]! * wgt;
            b += prev[s + 2]! * wgt;
            a += av;
            wsum += wgt;
          }
        }
        const o = (y * w + x) * 4;
        dst[o] = (r / wsum) | 0;
        dst[o + 1] = (g / wsum) | 0;
        dst[o + 2] = (b / wsum) | 0;
        dst[o + 3] = (a / 4) | 0;
      }
    }
    // Castano alpha-test rescale. The bracket has to reach well below 1: a 2x2
    // box over a thin frond leaflet RAISES the fraction of texels above the
    // test as often as it lowers it, so the correction runs both ways.
    if (target > 0 && w >= 1) {
      let lo = 0.02,
        hi = 40;
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) * 0.5;
        let cov = 0;
        for (let i = 0; i < w * w; i++) if (Math.min(255, dst[i * 4 + 3]! * mid) >= refB) cov++;
        if (cov / (w * w) < target) lo = mid;
        else hi = mid;
      }
      const sc = (lo + hi) * 0.5;
      let peak = 0;
      for (let i = 0; i < w * w; i++) {
        const a = Math.min(255, (dst[i * 4 + 3]! * sc) | 0);
        dst[i * 4 + 3] = a;
        if (a > peak) peak = a;
      }
      // At 4² and below the coverage quantum is 6%, so the search can round a
      // real silhouette down to nothing and the card pops out of existence on
      // the last mip. Guarantee the strongest texel always survives the test.
      if (peak < refB) {
        const lift = refB / Math.max(1, peak);
        for (let i = 0; i < w * w; i++) dst[i * 4 + 3] = Math.min(255, Math.ceil(dst[i * 4 + 3]! * lift));
      }
    }
    out.push({ data: dst, width: w, height: w });
    prev = dst;
    pw = w;
  }
  return out;
}

/**
 * Integer-lattice value noise with an explicit period per axis, so every
 * texture wraps exactly and can have anisotropic grain (wood stretches along
 * the plank, plaster streaks with the trowel). Simplex would look marginally
 * better here but cost roughly five times as much, and at 1024² across eight
 * material sets that is seconds of boot time for detail nobody can resolve.
 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px,
    y = v * py;
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px,
    x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py,
    y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed),
    b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed),
    d = hash2(x1, y1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * Octaves of `vnoise` in [-1, 1], periods doubling each octave so the wrap
 * survives — AND STOPPING AT THE LAST OCTAVE THE MAP CAN ACTUALLY RESOLVE.
 *
 * ---------------------------------------------------------------------------
 *  THE NYQUIST GUARD, AND WHY IT IS THE FIX FOR "NOISE-MOTTLED"
 * ---------------------------------------------------------------------------
 *  `@homie-rocks/props/Landform.ts`'s ridge generator already refuses to ask for a
 *  feature its column spacing cannot carry, and says so at length. A texture
 *  generator never got the same rule, and it is asked for sub-pixel detail
 *  constantly: the kart racer's sponsor board ran `fbm(..., 192, 192, 3)` into a
 *  512² map, so its three octaves land at 2.7, 1.3 and 0.7 PIXELS per cycle.
 *  Only the first is drawable. The other two are per-texel white noise, and
 *  because this feeds `normalFromHeight` they arrive as a field of random
 *  normals — a scintillating dither up close and, once the mip chain has
 *  averaged it, a grey mush at range. That is exactly a review's "reads as
 *  texture compression artefacts rather than as weathered paint", and it is
 *  why the lettering appeared to dissolve INTO the board: the board was
 *  fizzing.
 *
 *  Four texels per cycle is the floor — below that a value-noise lattice is
 *  aliasing by construction. Callers working at 512² pass `res` so the cap
 *  follows them. Nothing that was drawable is lost; everything that was never
 *  drawable goes.
 *
 *  Published rather than left in the game that found it for the reason the
 *  guard exists at all: the next generator to ask for three octaves of grain
 *  at a map size nobody checked is in a different game, and it will fizz the
 *  same way.
 */
export function fbmTile(
  seed: number, u: number, v: number, px: number, py: number,
  oct: number, gain = 0.5, res = 1024,
): number {
  let amp = 1,
    sum = 0,
    norm = 0,
    a = px,
    b = py;
  const lim = res / 4;
  for (let o = 0; o < oct; o++) {
    if (o > 0 && (a > lim || b > lim)) break;
    sum += amp * vnoise(u, v, a | 0, b | 0, seed + o * 131);
    norm += amp;
    amp *= gain;
    a *= 2;
    b *= 2;
  }
  return (sum / norm) * 2 - 1;
}

/** What `brickCell` reports about the unit it landed in. */
export interface BrickCell {
  /**
   * Chebyshev distance from the unit's centre to its edge, normalised so 1 is
   * the mortar line: `< 1` is stone, `>= 1` is joint. Normalising by the
   * MORTAR HALF-WIDTHS rather than by 0.5 is what makes one ramp — `1 - d * d`
   * for a dome, a smoothstep near 1 for a joint darkening — work on a lattice
   * of any aspect.
   */
  d: number;
  /** A per-unit draw in [0, 1], for hue and value drift between neighbours. */
  id: number;
}

const _brick: BrickCell = { d: 0, id: 0 };

/**
 * Rounded-rect brick lattice at a UV, with alternate courses staggered.
 *
 * Cobble setts, ashlar masonry, roof pans, deck plating and floor tiling are
 * one lattice with different numbers in front of it, and the arithmetic that
 * is easy to get wrong is the same every time: the stagger has to be applied
 * AFTER the row is taken (apply it first and the row index shifts with it, so
 * the courses interleave rather than offset), and the per-unit id has to be
 * keyed off the STAGGERED column index or the two halves of a course draw the
 * same colour.
 *
 * `id` is handed the integer unit coordinates and returns that unit's draw;
 * whatever decorrelation a caller wants between the two axes is its own, and
 * so are the two mortar half-widths, because how wide a joint is is a fact
 * about the masonry and not about the lattice.
 *
 * Returns a shared scratch — read it before the next call.
 */
export function brickCell(
  u: number, v: number, cols: number, rows: number, stagger: number,
  id: (bx: number, by: number) => number,
  mortarU: number, mortarV: number,
): BrickCell {
  const gy = v * rows;
  const row = Math.floor(gy);
  const gx = u * cols + (row & 1 ? stagger : 0);
  const cx = gx - Math.floor(gx) - 0.5;
  const cy = gy - row - 0.5;
  _brick.id = id(Math.floor(gx), row);
  _brick.d = Math.max(Math.abs(cx) / (0.5 - mortarU), Math.abs(cy) / (0.5 - mortarV));
  return _brick;
}

/** Central-difference normal map out of a height field. */
export function normalFromHeight(h: Float32Array, size: number, strength: number, aniso: number): THREE.CanvasTexture {
  const [c, g] = cv(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const w = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (w(x + 1, y) - w(x - 1, y)) * strength;
      const dy = (w(x, y + 1) - w(x, y - 1)) * strength;
      // normalize(-dx, -dy, 1)
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx * l * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy * l * 0.5 + 0.5) * 255;
      d[i + 2] = (l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, false, aniso);
}

/** Grey texture from a float field — used for roughness (three reads .g). */
export function greyFromField(f: Float32Array, size: number, aniso: number): THREE.CanvasTexture {
  const [c, g] = cv(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = clamp(f[i]!, 0, 1) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c, false, aniso);
}

// ---------------------------------------------------------------------------
//  THE TWO ENDS OF A HARD-SURFACE GENERATOR
// ---------------------------------------------------------------------------
//  Every procedural generator in both racers is the same sandwich: allocate a
//  canvas, an albedo `ImageData` and two float fields; fill them in a nested
//  texel loop that is entirely that game's art; hand the three back as a
//  `MatMaps`. The FILLING is 62 disjoint prop surfaces and is not shared and
//  never will be. The BREAD is nine lines that were spelled identically at
//  twenty-one sites across the two games, and it is exactly what this file
//  exists to own: `cv`, `finish`, `normalFromHeight` and `greyFromField` are
//  already here, and these two just stop each caller from re-deriving the order
//  to call them in.
//
//  This is worth more than the lines. `roughnessMap: greyFromField(r, size,
//  this.aniso)` written out twenty-one times is twenty-one chances to pass the
//  wrong field, forget the aniso, or hand `normalFromHeight` the roughness
//  buffer — none of which fails, crashes or logs. It renders, slightly wrong,
//  on one surface, forever.
//
//  WHAT DELIBERATELY DID NOT COME WITH THEM. `g.putImageData(img, 0, 0)` is
//  NOT in `surfaceMaps`, and that is not an oversight. Several generators draw
//  onto the canvas with the 2D context AFTER the texel loop and BEFORE the
//  bake — the kart racer's plaster walks twenty-six hairline cracks over the
//  uploaded albedo and carves each one into `h` as it goes. Folding the upload
//  into the bake would silently move those strokes to the wrong side of it.

/**
 * The four buffers a hard-surface generator fills, allocated together.
 *
 * `d` is `img.data` and aliases it, exactly as every call site wrote it by
 * hand. The caller still owns `g.putImageData(img, 0, 0)` — see above.
 */
export interface SurfaceBuf {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** height field, size² floats, consumed by `normalFromHeight` */
  h: Float32Array;
  /** roughness field, size² floats, consumed by `greyFromField` */
  r: Float32Array;
  img: ImageData;
  d: Uint8ClampedArray;
}

export function surfaceBuf(size: number): SurfaceBuf {
  const [c, g] = cv(size);
  const img = g.createImageData(size, size);
  return {
    c,
    g,
    h: new Float32Array(size * size),
    r: new Float32Array(size * size),
    img,
    d: img.data,
  };
}

/**
 * Albedo + normal + roughness off one generator's canvas and two fields.
 *
 * `srgb` is always true at every call site in both games — an albedo canvas is
 * sRGB by definition — so it is not a parameter. `repeat` is: three of the
 * kart racer's atlases (the sponsor board, the sign board, the flag cloth) are
 * NOT tiling surfaces and pass `false` through to `finish`.
 */
export function surfaceMaps(
  c: HTMLCanvasElement,
  h: Float32Array,
  r: Float32Array,
  size: number,
  normalStrength: number,
  aniso: number,
  repeat = true,
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  return {
    map: finish(c, true, aniso, repeat),
    normalMap: normalFromHeight(h, size, normalStrength, aniso),
    roughnessMap: greyFromField(r, size, aniso),
  };
}

// ---------------------------------------------------------------------------
// Micro-detail: the three-channel DATA texture a surface shader tiles at
// centimetre scale to stop a large flat panel reading as a single value.
// ---------------------------------------------------------------------------
/**
 * WHY IT IS ITS OWN FUNCTION AND NOT `surfaceMaps` WITH DIFFERENT NUMBERS.
 * Everything above bakes a LOOK — an albedo canvas, a height field, a
 * roughness field, all sRGB or grey and all sized to an object. This bakes
 * three independent scalar FIELDS into R, G and B and hands them to a shader
 * to combine however it likes, in linear space with no colour management at
 * all. It is the difference between a texture and a lookup table.
 *
 * THE RANDOM STREAM IS THE CALLER'S, and that is not politeness. A game whose
 * whole build is deterministic off one seeded stream cannot have a package
 * reach for `Math.random`, and it cannot have one quietly change how many
 * numbers it draws either — every later placement in the world moves. So the
 * generator arrives as a function and the draw ORDER is part of this file's
 * contract: the coarse table first, `coarse * coarse` of them, then per texel
 * two speckle taps and one grain tap, row-major.
 */
export interface MicroDetailSpec {
  /** Texture edge in texels. */
  size: number;
  /** The caller's seeded generator. See the note on draw order. */
  rnd: () => number;
  /** Edge of the value-noise table behind the blotch channel. */
  coarse: number;
  /** The two speckle taps, summed. Their total is the channel's ceiling. */
  speckle: readonly [number, number];
  /** Brushed grain: frequency, warp frequency, warp amplitude. */
  grain: readonly [number, number, number];
  /** Grain depth as [constant, jittered share] — they should sum to 1. */
  grainDepth: readonly [number, number];
}

/**
 * R = speckle, G = brushed grain, B = blotch, A = 255.
 *
 * `colorSpace` is `NoColorSpace` and it must stay that way: this is data, not
 * colour, and an sRGB decode on the way in gamma-crushes the low end of all
 * three channels at once — which looks like a texture that is simply too weak,
 * and gets "fixed" by turning its influence up until the top end blows out.
 */
export function microDetailTexture(s: MicroDetailSpec): THREE.CanvasTexture {
  const N = s.size;
  const [c, g] = cv(N);
  const img = g.createImageData(N, N);
  const CO = s.coarse;
  const table = new Float32Array(CO * CO);
  for (let i = 0; i < table.length; i++) table[i] = s.rnd();
  // Bilinear, smoothstepped, wrapped — the blotch has to tile or the seam is
  // the most visible thing on the surface.
  const sample = (x: number, y: number) => {
    const fx = x * CO, fy = y * CO;
    const x0 = Math.floor(fx) % CO, y0 = Math.floor(fy) % CO;
    const x1 = (x0 + 1) % CO, y1 = (y0 + 1) % CO;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = table[y0 * CO + x0]!, b = table[y0 * CO + x1]!;
    const d = table[y1 * CO + x0]!, e = table[y1 * CO + x1]!;
    return (a + (b - a) * sx) + ((d + (e - d) * sx) - (a + (b - a) * sx)) * sy;
  };
  const [k0, k1] = s.speckle;
  const [gf, wf, wa] = s.grain;
  const [gd0, gd1] = s.grainDepth;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const speckle = s.rnd() * k0 + s.rnd() * k1;
      // A 1-D ridged pattern along Y, phase-warped by a slower sine so the
      // ridges are not a perfect comb, and jittered per texel so it does not
      // read as a printed line screen.
      const grain = 0.5 + 0.5 * Math.sin(x * gf + Math.sin(x * wf) * wa)
        * (gd0 + gd1 * s.rnd());
      img.data[i] = speckle * 255;
      img.data[i + 1] = grain * 255;
      img.data[i + 2] = sample(x / N, y / N) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * ---------------------------------------------------------------------------
 *  THE OTHER END: a CUT-OUT sheet, drawn on a canvas and uploaded as a
 *  DataTexture with a coverage-preserving mip chain.
 * ---------------------------------------------------------------------------
 *  `surfaceMaps` above is the hard-surface end — four buffers in, three maps
 *  out. This is the alpha end, and it was spelled out by hand in every game
 *  that has ever needed a leaf, a net, a decal or a blade of grass. Six steps,
 *  and getting any one of them wrong is invisible in a still and wrong in
 *  motion:
 *
 *    1. draw into a cleared canvas, at the caller's own size;
 *    2. FLIP THE ROWS. A DataTexture uploads with `flipY = false`, so a canvas
 *       drawn top-left-origin arrives upside down unless the rows are reversed
 *       here — and a leaf sheet is close enough to symmetric that it renders
 *       perfectly while every UV in the game means the other thing;
 *    3. `dilateRGB`, so the transparent margin carries the leaf's colour and
 *       bilinear filtering at the silhouette does not fetch black;
 *    4. `coverageMips`, so `alphaTest` keeps the same silhouette AREA at every
 *       level — without it a grass card thins out and vanishes with distance,
 *       which is the classic "the verge disappears at 40 m";
 *    5. `generateMipmaps = false` and the chain assigned by hand, because
 *       three.js would otherwise throw the coverage chain away and box-filter
 *       its own;
 *    6. clamp, not repeat: a cut-out sheet is one leaf, and repeating it
 *       bleeds the opposite edge into the silhouette in the coarse mips.
 *
 *  What is the CALLER's: the drawing, the size, the alphaTest reference and
 *  the anisotropy budget. This never sees a colour.
 */
export function alphaSheet(
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
  ref: number,
  aniso: number,
): THREE.DataTexture {
  const [c, g] = cv(size);
  g.clearRect(0, 0, size, size);
  draw(g, size);
  const src = g.getImageData(0, 0, size, size).data;
  const px = new Uint8Array(size * size * 4);
  const row = size * 4;
  for (let y = 0; y < size; y++) px.set(src.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  dilateRGB(px, size);
  const mips = coverageMips(px, size, ref);
  const tex = new THREE.DataTexture(mips[0]!.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips as unknown as THREE.Texture['mipmaps'];
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = aniso;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A soft contact-shadow blob: a radial falloff with its perfect circle broken.
 *
 * Under a low key a shadow map alone leaves every prop looking pasted onto the
 * ground, and the fix is a decal — but a DECAL THAT IS A PERFECT CIRCLE reads
 * as a stamp, which is worse than no decal at all, because the eye reads the
 * regularity before it reads the shape. `bites` erosions of random radius
 * around the rim is what turns it back into a shadow.
 *
 * White throughout: the caller's material decides what a shadow is worth.
 * `stops` is the falloff, as `[radius 0..1, alpha]` pairs from the centre out,
 * and it is the caller's because how sharply a shadow ends is the whole
 * difference between an overcast day and a low sun.
 */
export function contactBlob(
  size: number,
  stops: readonly (readonly [number, number])[],
  bites: number,
  seed: () => number,
  aniso: number,
): THREE.CanvasTexture {
  const [c, g] = cv(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [r, a] of stops) grad.addColorStop(r, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < bites; i++) {
    const a = seed() * 7,
      r = size * (0.32 + seed() * 0.2);
    g.fillStyle = `rgba(0,0,0,${0.1 + seed() * 0.25})`;
    g.beginPath();
    g.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, size * (0.06 + seed() * 0.1), 0, 7);
    g.fill();
  }
  return finish(c, false, aniso, false);
}
