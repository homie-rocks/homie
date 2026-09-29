/**
 * ============================================================================
 *  reticle — the marks that say "aim here", drawn round a point on the frame.
 * ============================================================================
 *
 * A dashed ring for the thing you are aiming INTO, a gapped ring for the budget
 * you have to land inside, and four ticks on the axes for the datum. Three
 * marks; a gunsight, a docking aid, a landing gate and a targeting overlay all
 * draw them and none of the three names what is being aimed at.
 *
 * ## Why the gate is gapped and the corridor is not
 *
 * A CONTINUOUS BRIGHT RING IS A TARGET PAINTED ON THE SKY. It reads as a thing
 * in the world rather than as a mark on the screen, and worse, it is a closed
 * curve, so whatever sits inside it is read as being INSIDE something rather
 * than as being measured against it. Breaking it on the axes fixes both, and it
 * also stops the mark in the middle being occluded by its own scale.
 *
 * ## The contract, and it is arcGauge's
 *
 *  · Every spec is TOTAL. No default colour, no default proportion, no `?`.
 *  · A context and a struct. No DOM, no game state, no class.
 *  · Radii arrive resolved. The projection that produced them — a solid angle,
 *    a screen-space error, a range — is the caller's and this file never learns
 *    what the ring is a ring of.
 */

const TWO_PI = Math.PI * 2;

/** A ring drawn as furniture: dashed, so it never out-weighs what is inside it. */
export interface DashedRing {
  cx: number;
  cy: number;
  r: number;
  dash: readonly number[];
  ink: string;
  width: number;
}

export function dashedRing(g: CanvasRenderingContext2D, s: DashedRing): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.setLineDash(s.dash as number[]);
  g.beginPath();
  g.arc(s.cx, s.cy, s.r, 0, TWO_PI);
  g.stroke();
  g.setLineDash([]);
}

/**
 * A ring broken into `n` arcs with a gap between each: the gate.
 *
 * `span` is the angle each segment OWNS and `gap` is how much of it is left
 * unpainted, both in radians, both the caller's. They are two fields rather
 * than one derived from `n` because a caller that has already computed its
 * quarter-turn should hand over the double it has, not one this file
 * recomputes from a count and rounds differently.
 */
export interface GappedRing {
  cx: number;
  cy: number;
  r: number;
  n: number;
  /** the angle one segment owns. */
  span: number;
  /** where segment 0 starts. */
  phase: number;
  /** how much of a segment is left unpainted. */
  gap: number;
  ink: string;
  width: number;
}

export function gappedRing(g: CanvasRenderingContext2D, s: GappedRing): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  for (let q = 0; q < s.n; q++) {
    const a0 = q * s.span + s.phase;
    g.beginPath();
    g.arc(s.cx, s.cy, s.r, a0, a0 + s.span - s.gap);
    g.stroke();
  }
}

/**
 * Four ticks on the axes, from an inner radius to an outer one: the datum.
 *
 * The only mark on a reticle that does not move, which is exactly why it is
 * separate from the rings — it is the thing they are read against, and a caller
 * that drew it in the same colour and weight as the moving marks has thrown
 * away the reading.
 */
export interface AxisTicks {
  cx: number;
  cy: number;
  /** the inner end and the outer end of each tick. */
  from: number;
  to: number;
  ink: string;
  width: number;
}

const AXES: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function axisTicks(g: CanvasRenderingContext2D, s: AxisTicks): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.beginPath();
  for (const [dx, dy] of AXES) {
    g.moveTo(s.cx + dx * s.from, s.cy + dy * s.from);
    g.lineTo(s.cx + dx * s.to, s.cy + dy * s.to);
  }
  g.stroke();
}
