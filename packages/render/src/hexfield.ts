/**
 * ============================================================================
 *  hexfield — a tileable hexagonal cell field, as coverage and cell id.
 * ============================================================================
 *  A HEX GRID IS THE VORONOI OF A STAGGERED SQUARE LATTICE. That is the whole
 *  trick and it is why this is nine distance taps rather than six half-plane
 *  clips: offset every other row by half a cell, take the two nearest sites,
 *  and `(d2 - d1) / 2` is the distance to the cell wall — signed, correct at
 *  the vertices where three cells meet, and with no special case anywhere. The
 *  analytic clip is more code, is wrong at the vertices unless you handle them,
 *  and is slower.
 *
 *  TWO OUTPUTS, AND THE SECOND ONE IS THE POINT. `face` is 0 in the seam and 1
 *  in the middle of a cell, smoothstepped over `seam` texels. `cell` is WHICH
 *  cell, wrapped into `cols × rows`, so a caller can give every tile its own
 *  tone, age, or scorch without a second pass and without a second texture.
 *  A coverage field alone makes wallpaper; a coverage field plus a cell id is
 *  a surface made of individually distinguishable parts, which is the whole
 *  difference at the range these are looked at.
 *
 *  IT WRAPS, in both axes, because `cell` is taken modulo the counts and the
 *  lattice is sampled in cell units. That is what lets one small bake stand in
 *  for a field of thousands of real tiles at range.
 *
 *  THE SEAM WIDTH IS A CALLER'S NUMBER AND IT IS NOT THE REAL GAP. A one-texel
 *  seam on a map that is only ever seen minified vanishes into the first mip,
 *  and the seam is the entire reason the map exists — so it is authored wider
 *  than the article and the arithmetic for that belongs where the article's
 *  dimensions are known.
 *
 *  WHAT IS NOT HERE: any colour, any height, any albedo. This returns two
 *  fields of numbers. What a covered texel and a seam texel LOOK like is the
 *  surface's, and a package that decided it would hand the next surface the
 *  first one's ceramic.
 * ============================================================================
 */

export interface HexFieldOpts {
  /** edge of the square output, texels */
  size: number;
  /** cells across and down the tile. Both must divide the wrap cleanly. */
  cols: number;
  rows: number;
  /** half-width of the seam ramp, in TEXELS, not in cells or in metres. */
  seam: number;
  /**
   * Row stagger, in cells. 0.5 is a hex grid — anything else is a brick bond
   * or a plain square grid and is a different surface, so it is stated rather
   * than assumed.
   */
  stagger?: number;
}

export interface HexField {
  /**
   * 0 in the seam, 1 in the middle of a cell. `size * size`.
   *
   * DOUBLE PRECISION, AND THAT IS NOT AN OVERSIGHT. A caller feeds this into
   * two different consumers with two different needs: a height buffer, which
   * wants single precision because that is what a normal encoder reads, and an
   * albedo expression, which wants the value the arithmetic actually produced.
   * Rounding here forces BOTH to the narrower one, and the difference lands in
   * the last bits of every texel of albedo — invisible, unattributable, and
   * exactly the kind of drift that makes a later before-and-after unreadable.
   * A caller that wants `Float32Array` writes `Float32Array.from(face)` and has
   * said so.
   */
  face: Float64Array;
  /** which cell each texel belongs to, as `row * cols + col`. `size * size`. */
  cell: Int32Array;
}

/** `t` clamped to 0..1 and smoothstepped. Written out rather than reached for,
 *  because three's `MathUtils.smoothstep` takes its arguments in the other
 *  order and a silent argument swap here is a field with no seams at all. */
function smooth(x: number, e0: number, e1: number): number {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

export function hexFaceField(o: HexFieldOpts): HexField {
  const { size, cols, rows, seam } = o;
  const stagger = o.stagger ?? 0.5;
  const cw = size / cols;
  const ch = size / rows;
  const face = new Float64Array(size * size);
  const cell = new Int32Array(size * size);
  for (let py = 0; py < size; py++) {
    const v = py / ch;
    for (let px = 0; px < size; px++) {
      const u = px / cw;
      // The two nearest lattice sites, in texels.
      let d1 = 1e9;
      let d2 = 1e9;
      let bi = 0;
      let bj = 0;
      for (let jj = -1; jj <= 1; jj++) {
        const j = Math.floor(v) + jj;
        const off = ((j % 2) + 2) % 2 === 1 ? stagger : 0.0;
        for (let ii = -1; ii <= 1; ii++) {
          const i = Math.floor(u - off) + ii;
          const dx = (u - (i + off + 0.5)) * cw;
          const dy = (v - (j + 0.5)) * ch;
          const d = Math.hypot(dx, dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            bi = ((i % cols) + cols) % cols;
            bj = ((j % rows) + rows) % rows;
          } else if (d < d2) d2 = d;
        }
      }
      const i = py * size + px;
      face[i] = smooth((d2 - d1) * 0.5, 0.0, seam);
      cell[i] = bj * cols + bi;
    }
  }
  return { face, cell };
}
