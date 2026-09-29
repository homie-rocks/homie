/**
 * ============================================================================
 *  stencil — a 5x7 industrial stencil face as STROKES, not as an atlas.
 * ============================================================================
 *  Extracted from a base-building game's structure builder. The glyph table
 *  and the advance arithmetic are byte-for-byte; `stencilStrokes` is new and
 *  is the seam (see the bottom of this file).
 *
 *  WHY THIS IS ENGINE CODE AND NOT GAME CODE. The finding that produced it was
 *  one game's — "there is not one letter or numeral anywhere in the 3-D world
 *  across all eleven frames" — but nothing about the answer is specific to it.
 *  A game that generates its art in code and ships zero assets has the same
 *  problem and would reach the same answer: a glyph atlas needs its own
 *  material, its own UV channel and a draw call per surface, and strokes go
 *  into whatever accumulator the caller is already filling for nothing. A hull
 *  number in a racer, a bay number on an apron, a door code on a station: same
 *  table.
 *
 *  It is also one of the cheapest scale cues there is. A 1.2 m character on a
 *  wall calibrates the wall; a 12 m one on an apron calibrates the 50 m
 *  vehicle standing next to it.
 *
 *  THE GLYPHS ARE DELIBERATELY DISCONNECTED BARS. Real stencil type is a mask
 *  with bridges, sprayed on. Closed outlines would look like a font, which is
 *  the thing this is not. The face is 5x7 on a 0.62 em advance, the proportion
 *  of the wide-tracked lettering painted on aprons and hull rings.
 */


/** Stroke list per glyph: [x0, y0, x1, y1] in a 0..1 box, y up. */
const GLYPHS: Record<string, number[][]> = {
  '0': [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0], [0.15, 0.2, 0.85, 0.8]],
  '1': [[0.2, 0.78, 0.5, 1], [0.5, 1, 0.5, 0], [0.12, 0, 0.88, 0]],
  '2': [[0, 0.82, 0.18, 1], [0.18, 1, 0.82, 1], [0.82, 1, 1, 0.78], [1, 0.78, 0, 0.16], [0, 0.16, 0, 0], [0, 0, 1, 0]],
  '3': [[0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0], [0.25, 0.5, 1, 0.5]],
  '4': [[0.72, 0, 0.72, 1], [0.72, 1, 0, 0.32], [0, 0.32, 1, 0.32]],
  '5': [[1, 1, 0, 1], [0, 1, 0, 0.55], [0, 0.55, 0.8, 0.52], [0.8, 0.52, 1, 0.34], [1, 0.34, 0.8, 0], [0.8, 0, 0, 0]],
  '6': [[1, 0.86, 0.7, 1], [0.7, 1, 0.2, 1], [0.2, 1, 0, 0.7], [0, 0.7, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.5], [1, 0.5, 0, 0.5]],
  '7': [[0, 1, 1, 1], [1, 1, 0.3, 0]],
  '8': [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0], [0, 0.5, 1, 0.5]],
  '9': [[1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [0, 0.14, 0.3, 0]],
  A: [[0, 0, 0, 0.7], [0, 0.7, 0.5, 1], [0.5, 1, 1, 0.7], [1, 0.7, 1, 0], [0.05, 0.42, 0.95, 0.42]],
  B: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 1, 0.78], [1, 0.78, 0.1, 0.52], [0.1, 0.48, 1, 0.24], [1, 0.24, 0.8, 0], [0.8, 0, 0, 0]],
  C: [[1, 0.84, 0.75, 1], [0.75, 1, 0.25, 1], [0.25, 1, 0, 0.74], [0, 0.74, 0, 0.26], [0, 0.26, 0.25, 0], [0.25, 0, 0.75, 0], [0.75, 0, 1, 0.16]],
  D: [[0, 0, 0, 1], [0, 1, 0.7, 1], [0.7, 1, 1, 0.7], [1, 0.7, 1, 0.3], [1, 0.3, 0.7, 0], [0.7, 0, 0, 0]],
  E: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0.5, 0.78, 0.5]],
  F: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0.52, 0.78, 0.52]],
  G: [[1, 0.84, 0.7, 1], [0.7, 1, 0.25, 1], [0.25, 1, 0, 0.7], [0, 0.7, 0, 0.28], [0, 0.28, 0.28, 0], [0.28, 0, 1, 0], [1, 0, 1, 0.44], [1, 0.44, 0.55, 0.44]],
  H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
  I: [[0.5, 0, 0.5, 1], [0.12, 1, 0.88, 1], [0.12, 0, 0.88, 0]],
  J: [[0.85, 1, 0.85, 0.24], [0.85, 0.24, 0.6, 0], [0.6, 0, 0.25, 0], [0.25, 0, 0, 0.22]],
  K: [[0, 0, 0, 1], [1, 1, 0.06, 0.46], [0.1, 0.5, 1, 0]],
  L: [[0, 1, 0, 0], [0, 0, 1, 0]],
  M: [[0, 0, 0, 1], [0, 1, 0.5, 0.44], [0.5, 0.44, 1, 1], [1, 1, 1, 0]],
  N: [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1]],
  O: [[0.22, 1, 0.78, 1], [0.78, 1, 1, 0.74], [1, 0.74, 1, 0.26], [1, 0.26, 0.78, 0], [0.78, 0, 0.22, 0], [0.22, 0, 0, 0.26], [0, 0.26, 0, 0.74], [0, 0.74, 0.22, 1]],
  P: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 1, 0.76], [1, 0.76, 0.8, 0.5], [0.8, 0.5, 0, 0.5]],
  Q: [[0.22, 1, 0.78, 1], [0.78, 1, 1, 0.74], [1, 0.74, 1, 0.26], [1, 0.26, 0.78, 0], [0.78, 0, 0.22, 0], [0.22, 0, 0, 0.26], [0, 0.26, 0, 0.74], [0, 0.74, 0.22, 1], [0.6, 0.3, 1.05, -0.06]],
  R: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 1, 0.76], [1, 0.76, 0.8, 0.5], [0.8, 0.5, 0, 0.5], [0.42, 0.5, 1, 0]],
  S: [[1, 0.86, 0.75, 1], [0.75, 1, 0.2, 1], [0.2, 1, 0, 0.78], [0, 0.78, 1, 0.28], [1, 0.28, 0.8, 0], [0.8, 0, 0.2, 0], [0.2, 0, 0, 0.14]],
  T: [[0, 1, 1, 1], [0.5, 1, 0.5, 0]],
  U: [[0, 1, 0, 0.24], [0, 0.24, 0.24, 0], [0.24, 0, 0.76, 0], [0.76, 0, 1, 0.24], [1, 0.24, 1, 1]],
  V: [[0, 1, 0.5, 0], [0.5, 0, 1, 1]],
  W: [[0, 1, 0.22, 0], [0.22, 0, 0.5, 0.62], [0.5, 0.62, 0.78, 0], [0.78, 0, 1, 1]],
  X: [[0, 1, 1, 0], [0, 0, 1, 1]],
  Y: [[0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]],
  Z: [[0, 1, 1, 1], [1, 1, 0, 0], [0, 0, 1, 0]],
  '-': [[0.1, 0.5, 0.9, 0.5]],
  '.': [[0.38, 0, 0.62, 0]],
  '/': [[0, 0, 1, 1]],
  ' ': [],
};

/**
 * Total width of a stencil string in metres, at cap height `h`.
 *
 * Exported because a caller centring type on a 64 m apron needs it before it
 * can pick the transform, and re-deriving the advance at the call site is how
 * two places end up disagreeing about tracking.
 */
export function stencilWidth(text: string, h: number, track = 0.22): number {
  const n = text.length;
  return n <= 0 ? 0 : h * (n * 0.62 + (n - 1) * track);
}

/** One stroke of a laid-out string, in the caller's XZ plane. */
export interface StencilStroke {
  /** Centre of the stroke, along the reading direction (+X). */
  cx: number;
  /** Centre of the stroke, across it (+Z is up the cap height). */
  cz: number;
  /**
   * Length of the BOX to draw, already extended by one stroke weight so the
   * joints between strokes close. A stencil with hairline gaps at every corner
   * reads as a wireframe.
   */
  len: number;
  /** Stroke weight in metres — the box's other in-plane dimension. */
  weight: number;
  /** Rotation about Y for a box built along +X. Already negated for `xf`. */
  ry: number;
}

/**
 * Lay a string out as strokes. THIS IS THE SEAM, and it is the only part of
 * this file that is not lifted verbatim.
 *
 * In the source game the layout arithmetic and the emission were one function:
 * it walked the glyphs and called `build.add('paint', chamferBox(...), ...)`
 * inline. That version cannot move, because the builder, the `paint` material
 * key and the marking colour are the game's and not geometry's.
 *
 * So the arithmetic moves and the emission stays. A caller gets a flat list
 * and decides what a stroke is made of — a chamfered box in a merged
 * accumulator here, an instanced quad or a decal somewhere else. The numbers
 * are unchanged: 0.62 em advance, `weight` as a fraction of cap height,
 * `track` in cap heights, and a stroke shorter than 0.1 mm dropped rather than
 * emitted with an undefined angle.
 */
export function stencilStrokes(
  text: string, h: number, weightFrac = 0.16, track = 0.22,
): StencilStroke[] {
  const weight = weightFrac * h;
  const adv = h * (0.62 + track);
  const out: StencilStroke[] = [];
  let x = 0;
  for (const raw of text.toUpperCase()) {
    const strokes = GLYPHS[raw];
    if (strokes) {
      for (const s of strokes) {
        const x0 = x + s[0] * h * 0.62, z0 = s[1] * h;
        const x1 = x + s[2] * h * 0.62, z1 = s[3] * h;
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 1e-4) continue;
        const ang = Math.atan2(z1 - z0, x1 - x0);
        out.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, len: len + weight, weight, ry: -ang });
      }
    }
    x += adv;
  }
  return out;
}
