/**
 * ============================================================================
 *  panelMarks — the marks a FLAT instrument is drawn out of, on a 2D canvas.
 * ============================================================================
 *
 * `arcGauge.ts` is the round instrument and it is one function, because a dial
 * is one object. A flat panel is not: it is a recess cut into a plate, a run of
 * graduations along it, a hatched band over part of it, and then whatever the
 * game's datum happens to be. Those three are the parts that recur, and the
 * argument for moving them is the argument `arcGauge`'s header already makes —
 * the SEMANTICS are the game's, the DRAWING is a drawing.
 *
 * ## The contract, and it is arcGauge's
 *
 *  · **Nothing here is optional and nothing here is remembered.** Every spec is
 *    total: no default colour, no default proportion, no `?`. A package that
 *    shipped a default rule weight would be shipping one game's plate to the
 *    next one under a noun. The panel-marks probe walks every numeric field of
 *    every spec, perturbs it alone, redraws and requires the call stream to
 *    CHANGE — an extracted option welded shut passes every other gate, and
 *    four of them once shipped exactly that way.
 *  · **It takes a context and a struct.** No DOM, no game state, no class. It
 *    can be driven by a recording stub, which is what the probe does.
 *  · **Coordinates arrive resolved.** These take pixels, not fractions, because
 *    every caller has already computed its own plate geometry and re-deriving
 *    it here from fractions would round differently and move the marks.
 *
 * ## Two marks were looked at and REFUSED, and the reasons are not "too small"
 *
 * A CHEVRON RUN — n graded chevrons marching along a direction — stands FOUR
 * times in the space racer's HUD: the boost ticks beside the velocity numeral, the
 * hull restore march, the heat rate ticks on the fill head, and the recovery
 * bearing on the lateral tape. It is not here, and the reason is arithmetic
 * rather than taste: each of the four computes its apex in a DIFFERENT CLOSED
 * FORM. One writes `y + cap * (0.24 + i * 0.26)`; a shared version has to write
 * `apexY + i * stepY`, and those two doubles differ in the last place. The
 * choices are a callback that hands the position back per index — which saves
 * nothing and is not an extraction — or a sub-ulp change to four instruments,
 * which is a behaviour change with no before-and-after anybody can look at, and
 * which would force the parity gate that guards this file to be weakened to
 * accept it. The gate is worth more than the mark.
 *
 * A FEATHERED BAND — a rect filled with a four-stop gradient that falls to
 * transparent at both ends — stands twice in the space racer's circuit diagram,
 * and the rule behind it is real and shareable ("a scrim you can find the edge
 * of is a plate"). It is not here because the only way to prove the move is to
 * execute the 220-line bake it sits inside, against a baked roll channel, a
 * fitted plan and a panel geometry, to move fourteen lines. Sized, not done.
 *
 * ## Why every endpoint is passed rather than derived
 *
 * `hatch` takes the clip rectangle AND the two y values its lines run between,
 * which looks redundant — the bottom is the top plus the height. It is not
 * redundant in floating point: a caller that has `y0` and computes `yc = y0 -
 * span * 0.25` does not get `y0` back from `yc + (y0 - yc)` in the last place,
 * and a hairline that lands half a pixel off its own clip edge is a visible
 * seam on a dark panel. The caller passes what it already has.
 */

/** An axis-aligned rectangle in device pixels. */
export interface MarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The ink of a recess: an OPAQUE floor and one inset rule around it.
 *
 * Opaque is the whole point and it is not a taste. A channel laid over a
 * translucent floor still has whatever is behind the instrument inside its own
 * interior, so the contrast of the live mark against its own well is a function
 * of the scene — which means the one number a legibility audit computes is not
 * the number that reaches the screen. Nothing behind an instrument's face is
 * information.
 */
export interface RecessInk {
  /** the floor. A colour with no alpha component. */
  floor: string;
  /** the wall, inset by half its own weight so it sits inside the floor. */
  rule: string;
  /** the wall's weight, device px. */
  width: number;
}

/**
 * Cut a recess: fill the floor, then lay the wall INSIDE it.
 *
 * The wall is inset by half its weight rather than drawn on the boundary,
 * because a stroke straddles its path: on the boundary, half of every hairline
 * is outside the well and lands on the plate, which reads as a halo rather than
 * as an edge. The unfilled part of a channel needs a wall or the live mark is
 * floating in nothing and the eye has no scale to read it against.
 */
export function recess(g: CanvasRenderingContext2D, r: MarkRect, ink: RecessInk): void {
  g.fillStyle = ink.floor;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = ink.rule;
  g.lineWidth = ink.width;
  g.strokeRect(
    r.x + ink.width * 0.5, r.y + ink.width * 0.5,
    r.w - ink.width, r.h - ink.width,
  );
}

/**
 * A run of graduations along a straight axis, in two weights.
 *
 * The feet march from `(ax, ay)` to `(bx, by)` inclusive of both ends, and each
 * tick grows from its foot along `(dx, dy)`. Every `major`th index gets the
 * long mark and the strong ink; the rest get the short one. That is the whole
 * vocabulary — there is no third series, no label and no value, because a
 * graduation that knows what it counts is a gauge and this is a plate.
 */
export interface TickRun {
  /** ticks, INCLUSIVE of both ends: `n = 21` puts one every 5% of the run. */
  n: number;
  /** every index divisible by this is a major. */
  major: number;
  /** the foot of tick 0. */
  ax: number;
  ay: number;
  /** the foot of tick n-1. */
  bx: number;
  by: number;
  /** unit direction a tick grows in from its foot. */
  dx: number;
  dy: number;
  majorLen: number;
  minorLen: number;
  majorInk: string;
  minorInk: string;
  width: number;
  /**
   * Hairline registration, per axis, or null for that axis to be left alone.
   *
   * A 1 px rule whose centre lands on an integer straddles two device rows and
   * renders as two half-lit ones; the fix is to round the coordinate and then
   * offset by half the weight when the weight is odd. It is per-axis because a
   * horizontal tick wants it on y and NOT on x — the run's own x is already an
   * integer of the plate's geometry and adding a half to it moves the whole
   * series off the channel wall it is cut into.
   */
  snapX: number | null;
  snapY: number | null;
}

export function tickRun(g: CanvasRenderingContext2D, s: TickRun): void {
  g.lineWidth = s.width;
  const steps = s.n - 1;
  for (let i = 0; i < s.n; i++) {
    const t = i / steps;
    let x = s.ax + (s.bx - s.ax) * t;
    let y = s.ay + (s.by - s.ay) * t;
    if (s.snapX !== null) x = Math.round(x) + s.snapX;
    if (s.snapY !== null) y = Math.round(y) + s.snapY;
    const isMajor = i % s.major === 0;
    const len = isMajor ? s.majorLen : s.minorLen;
    g.strokeStyle = isMajor ? s.majorInk : s.minorInk;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + s.dx * len, y + s.dy * len);
    g.stroke();
  }
}

/**
 * A 45° hatch, clipped to a rectangle.
 *
 * THE DRAWING CONVENTION THAT SAYS "THIS IS NOT A MEASUREMENT". A prediction, a
 * reserved band, a warning bracket — anything drawn at the same weight as the
 * live datum beside it claims to be as true as the datum, and hatching is the
 * mark that has meant "inferred, or reserved, or not yet" on an instrument
 * plate since instruments had plates.
 *
 * The sweep runs in the clip's own x, from `from` to `to` in steps, with each
 * line rising `rise` as it crosses. `ox` is the sweep's origin and is usually
 * OUTSIDE the clip: the leftmost lines have to start off the left edge or the
 * top-left corner of the band is a bare triangle.
 */
export interface Hatch {
  /** the clip. Nothing is drawn outside it. */
  clip: MarkRect;
  /** the sweep origin in x. Lines are laid at `ox + d`. */
  ox: number;
  /** the y a line starts at, and the y it ends at. Both passed, never derived. */
  yFrom: number;
  yTo: number;
  /** how far a line travels in x while it climbs from yFrom to yTo. */
  rise: number;
  /** the sweep, in x, relative to `ox`. */
  from: number;
  to: number;
  step: number;
  ink: string;
  width: number;
  /**
   * `globalAlpha` for the sweep, or null to leave the context's alone.
   *
   * Null is not the same as 1: a caller whose ink already carries its alpha in
   * an `rgba()` must not have two alpha writes appear in its stream, because
   * the second one is a state change every other mark on the panel then has to
   * be audited against.
   */
  alpha: number | null;
}

export function hatch(g: CanvasRenderingContext2D, s: Hatch): void {
  g.save();
  g.beginPath();
  g.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h);
  g.clip();
  g.strokeStyle = s.ink;
  if (s.alpha !== null) g.globalAlpha = s.alpha;
  g.lineWidth = s.width;
  g.beginPath();
  for (let d = s.from; d < s.to; d += s.step) {
    g.moveTo(s.ox + d, s.yFrom);
    g.lineTo(s.ox + d + s.rise, s.yTo);
  }
  g.stroke();
  g.restore();
  if (s.alpha !== null) g.globalAlpha = 1;
}

/**
 * A triangular pointer: an apex, and a base with a corner either side of it.
 *
 * The mark that says "here, on this scale". It appears pointing in all four
 * directions on one panel — inboard at a needle, down at a live error, up at a
 * predicted one — so the geometry is given as three POINTS rather than as an
 * angle and a length: the caller already has the apex and the base in the
 * coordinates its own scale is drawn in, and re-deriving them here from a
 * direction would round differently and move the mark.
 *
 * `ink` and `width` are nullable so the caller can leave the context's alone.
 * That is not a convenience: a caller drawing a filled pointer has no line
 * weight to set, and a package that wrote one anyway would put a state change
 * into the stream that every later mark on the panel has to be audited against.
 */
export interface Pointer {
  /** the point of it. */
  apexX: number;
  apexY: number;
  /** the middle of the base. */
  baseX: number;
  baseY: number;
  /** half the base, as a vector: the two corners are base ∓ this. */
  spanX: number;
  spanY: number;
  /** filled reads as a MEASUREMENT, stroked reads as a prediction. */
  fill: boolean;
  ink: string | null;
  width: number | null;
}

export function pointer(g: CanvasRenderingContext2D, s: Pointer): void {
  if (s.ink !== null) {
    if (s.fill) g.fillStyle = s.ink; else g.strokeStyle = s.ink;
  }
  if (s.width !== null) g.lineWidth = s.width;
  g.beginPath();
  g.moveTo(s.apexX, s.apexY);
  g.lineTo(s.baseX - s.spanX, s.baseY - s.spanY);
  g.lineTo(s.baseX + s.spanX, s.baseY + s.spanY);
  g.closePath();
  if (s.fill) g.fill(); else g.stroke();
}

/**
 * A dashed polyline, with the pattern cleared behind it.
 *
 * Trivial, and worth having in one place for the reason the clear is: a caller
 * that sets a dash and forgets to clear it hands the pattern to whatever the
 * panel draws next, which is a defect that appears somewhere other than where
 * it was caused. Five marks on one instrument were each spelling out
 * set-draw-clear.
 *
 * `ink` is nullable because a dashed leader between two marks usually wants the
 * colour of the mark it is leading from, which the caller has already set.
 */
/**
 * A SOLID open polyline — `dashRule`'s sibling, and the mark an instrument
 * panel is actually made of.
 *
 * Counted in one game's screen layer on 2026-08-22: fourteen sites spelling out
 * `beginPath / moveTo / lineTo… / stroke` by hand, and every one of them a
 * bracket, a datum, a threshold rule or a cap. They are the same five calls in
 * the same order every time, which is why `dashRule` was already worth having
 * and this was not noticed beside it.
 *
 * `ink` and `width` are BOTH nullable, where `dashRule`'s width is not, and the
 * difference is real: half these sites sit inside a loop that set the pen once
 * outside it, and a function that re-set the width every pass would be issuing
 * an operation the hand-written run did not. Null means "keep the pen the
 * caller is holding".
 *
 * NO DASH, NO CLOSE, NO FILL. A closed shape is `pointer` or `segmentLadder`;
 * a dashed one is `dashRule`. Folding those together would give the caller a
 * mode flag, and a mode flag on a drawing primitive is how one instrument ends
 * up drawing another's mark by passing the wrong boolean.
 */
export interface Rule {
  /** x, y, x, y … at least two points. */
  pts: readonly number[];
  /** null keeps the stroke style the caller already set. */
  ink: string | null;
  /** null keeps the line width the caller already set. */
  width: number | null;
}

export function rule(g: CanvasRenderingContext2D, s: Rule): void {
  if (s.ink !== null) g.strokeStyle = s.ink;
  if (s.width !== null) g.lineWidth = s.width;
  g.beginPath();
  // `!` for the same reason `dashRule` uses it: a two-point minimum is the
  // type's own contract, and a guard here would be a rule silently not drawn.
  const p = s.pts;
  g.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i]!, p[i + 1]!);
  g.stroke();
}

export interface DashRule {
  /** x, y, x, y … at least two points. */
  pts: readonly number[];
  dash: readonly number[];
  ink: string | null;
  width: number;
}

export function dashRule(g: CanvasRenderingContext2D, s: DashRule): void {
  if (s.ink !== null) g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.setLineDash(s.dash as number[]);
  g.beginPath();
  // `!` rather than a length guard: a two-point minimum is the type's own
  // contract and a runtime check here would be a plausible default — a rule
  // silently not drawn — where a crash is the honest outcome.
  const p = s.pts;
  g.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i]!, p[i + 1]!);
  g.stroke();
  g.setLineDash([]);
}

/**
 * A ladder of discrete cells, each a rule at its own length.
 *
 * THE OTHER SHAPE A RESOURCE CAN HAVE. A continuous column and a stack of
 * discrete frames are the two, and a panel carrying two resources should draw
 * them differently: two gauges that differ only in which edge of the screen
 * they are on are one gauge mirrored, and the layout then says nothing.
 *
 * `profile` is what stops the stack reading as n identical pips — a hull
 * section is widest amidships, a magazine is not, a battery is not — and it is
 * the caller's list because it is a picture of the thing being counted.
 *
 * A PARTIAL CELL SHORTENS RATHER THAN THINS, so a fraction reads as a frame cut
 * back rather than as a frame drawn faintly. `minFrac` is how much of it is
 * left at zero fill, which is what keeps a nearly-spent cell from vanishing
 * before it is spent.
 */
export interface SegmentLadder {
  /** the top of cell 0's box. Cells march DOWN from it and fill UP toward it. */
  y: number;
  /** the centre the rules are struck about. */
  cx: number;
  /** one cell's box, and the space between two. */
  cell: number;
  gap: number;
  /** the longest a rule gets, before the profile. */
  maxLen: number;
  /** one entry per cell, as a fraction of maxLen. Its length IS n. */
  profile: readonly number[];
  /** how many cells are lit, fractionally. */
  lit: number;
  /**
   * A cell whose fill is at or below this draws only its struck rule.
   *
   * It is a field and not a literal because it is a JUDGEMENT about the
   * quantity: a hull frame at one part in a thousand is gone, and a magazine
   * with one round in it is not. A package that picked the number would be
   * deciding for the next game what "empty" means.
   */
  dimBelow: number;
  /** the rule left where a cell is spent: absence, drawn as absence. */
  struckInk: string;
  struckWeight: number;
  /** the rule where a cell is intact. */
  litInk: string;
  litWeight: number;
  /** what is left of a rule at zero fill, as a fraction of its length. */
  minFrac: number;
  /** the sub-pixel misregistration: a display aligned with the airframe it is
   *  bolted to is a display nobody built. Null for none. */
  ghostDx: number;
  ghostDy: number;
  ghostAlpha: number | null;
}

export function segmentLadder(g: CanvasRenderingContext2D, s: SegmentLadder): void {
  const n = s.profile.length;
  for (let i = 0; i < n; i++) {
    const y = s.y + (n - 1 - i) * (s.cell + s.gap);
    const fill = s.lit - i < 0 ? 0 : s.lit - i > 1 ? 1 : s.lit - i;
    const len = s.maxLen * s.profile[i]!;
    g.fillStyle = s.struckInk;
    g.fillRect(s.cx - len * 0.5, y + s.cell * 0.5 - s.struckWeight * 0.5, len, s.struckWeight);
    if (fill <= s.dimBelow) continue;
    g.fillStyle = s.litInk;
    const fl = len * (s.minFrac + (1 - s.minFrac) * fill);
    g.fillRect(s.cx - fl * 0.5, y + s.cell * 0.5 - s.litWeight * 0.5, fl, s.litWeight);
    if (s.ghostAlpha !== null) {
      g.globalAlpha = s.ghostAlpha;
      g.fillRect(
        s.cx - fl * 0.5 + s.ghostDx, y + s.cell * 0.5 - s.litWeight * 0.5 + s.ghostDy,
        fl, s.litWeight,
      );
      g.globalAlpha = 1;
    }
  }
}
