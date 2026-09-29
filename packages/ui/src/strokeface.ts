/*
 * ============================================================================
 *  strokeface.ts — set type on a 2D canvas out of polylines the caller owns.
 * ============================================================================
 *  Published out of the space racer's HUD, which carried it privately on the
 *  grounds that it was unique to that game.
 *
 *  THAT WAS RIGHT ABOUT THE GLYPHS AND WRONG ABOUT THE RENDERER, and the
 *  two are separable objects. Describe what is below without naming a ship, a
 *  circuit or a heat economy and nothing is left out: walk a string, look each
 *  character up in a table of unit-box polylines, advance by a fraction of the
 *  cap height, scale x by that same fraction, and stroke the lot as ONE path.
 *  That is a text renderer. The letterforms it draws — the barred seven, the
 *  centre-bar zero, the chamfered bowls — are art direction and they stay in
 *  the game, crossing this seam as DATA in a `StrokeFace`.
 *
 *  WHY A GAME WANTS THIS AT ALL, kept from the source because it is the reason
 *  the next game should reach for it: the engine does not ship somebody
 *  else's outlines, and a HUD set in `system-ui` is set in Helvetica Neue on
 *  one machine, Segoe on another and DejaVu on a third — so the instrument's
 *  letterforms are whatever the operating system happened to ship. Sixteen
 *  stroked glyphs is a whole numeric vocabulary and costs a dozen short
 *  polylines per draw.
 *
 *  `./face.ts` is the OTHER answer to the same rule and the two do not
 *  compete. That one writes a real TrueType binary at boot and installs it, so
 *  the DOM can be set in it; this one strokes straight into a canvas, where
 *  there is no font machinery and the caller already holds a context. A gauge
 *  numeral re-rasterised on a change-keyed canvas wants the second.
 *
 *  NOT AN SDF ATLAS, and that was a decision rather than an omission. Callers
 *  are already change-keyed, so the per-frame cost of a dozen short polylines
 *  is zero on almost every frame; an atlas buys a cheaper draw nobody is
 *  making and costs a build step, a texture and a resolution ceiling on the
 *  one numeral that is 148 px tall.
 *
 *  EVERY NUMBER IS THE CALLER'S. `adv`, `stroke`, `cap`, `join` and
 *  `miterLimit` are the face's voice — condensed or not, squared terminals or
 *  round, mitred or bevelled — and there is no default for any of them here.
 *  A default would be the engine's first shared letterform.
 * ============================================================================
 */

/** One polyline in the unit box: `x0, y0, x1, y1, …`, x and y both 0..1, y DOWN. */
export type StrokePoly = readonly number[];

/**
 * A face: the glyph table plus the five numbers that are its voice.
 *
 * `adv` and `stroke` are fractions of the CAP HEIGHT, so one face draws at any
 * size and the proportions hold. A glyph's x is multiplied by `adv` as well —
 * the unit box is the glyph's own, and the condensation is applied to it —
 * which is why a 0.62 advance draws narrower letters rather than the same
 * letters closer together.
 */
export interface StrokeFace {
  /** Unit-box polylines per character. A missing character draws nothing. */
  readonly glyphs: Readonly<Record<string, readonly StrokePoly[]>>;
  /** Advance width as a fraction of cap height, before tracking. */
  readonly adv: number;
  /** Stroke weight as a fraction of cap height. */
  readonly stroke: number;
  readonly cap: CanvasLineCap;
  readonly join: CanvasLineJoin;
  readonly miterLimit: number;
}

/** Advance of `s` at cap height `h`, including `track` (a fraction of `h`). */
export function strokeWidth(face: StrokeFace, s: string, h: number, track: number): number {
  return s.length > 0 ? s.length * h * (face.adv + track) - h * track : 0;
}

/**
 * Draw `s` at cap height `h`, left/top of the cap box at (x, y).
 *
 * `weight` multiplies the face's one stroke weight — the only licensed
 * variation, and it exists so a value can be heavier than the scale it is read
 * against without introducing a second face.
 *
 * ONE `beginPath` FOR THE WHOLE STRING, and one `stroke`. Per-glyph strokes
 * double-darken every place two polylines of the same glyph overlap, which at
 * a 0.128 weight is visible on the 8 and on any centre bar.
 *
 * `lineWidth` is floored at 1 device pixel: a hairline that rounds to zero is
 * a glyph that vanishes, which is worse than one that is a shade too heavy.
 */
export function strokeText(
  g: CanvasRenderingContext2D, face: StrokeFace, s: string,
  x: number, y: number, h: number, track: number, weight: number,
): void {
  const adv = h * (face.adv + track);
  g.lineCap = face.cap;
  g.lineJoin = face.join;
  g.miterLimit = face.miterLimit;
  g.lineWidth = Math.max(1, h * face.stroke * weight);
  g.beginPath();
  for (let i = 0; i < s.length; i++) {
    // `s[i]!` — the loop bound is the guard, but `noUncheckedIndexedAccess`
    // (on in this package, off in every game) types the read as
    // `string | undefined`. Runtime is identical.
    const gl = face.glyphs[s[i]!];
    if (!gl) continue;
    const ox = x + i * adv;
    for (let p = 0; p < gl.length; p++) {
      const poly = gl[p]!;
      for (let k = 0; k < poly.length; k += 2) {
        const px = ox + poly[k]! * h * face.adv;
        const py = y + poly[k + 1]! * h;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
    }
  }
  g.stroke();
}
