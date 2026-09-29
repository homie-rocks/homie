/**
 * ============================================================================
 *  glyphs — the two marks a plan view puts on a moving thing.
 * ============================================================================
 *
 *  `discMarker` is everyone else: a filled disc with a casing stroke, and an
 *  optional halo behind it for the one that is doing something special.
 *
 *  `headingMarker` is YOU: the same disc, larger, carrying the ONE ring in the
 *  system and a chevron struck into it in ink.
 *
 *  `caretMarker` is the same chevron with NO disc under it, for a panel whose
 *  marks have to carry heading at six pixels. A disc at that size is a dot and
 *  a dot cannot point; eight carets down a ribbon read as a pack in a way eight
 *  dots never do. It came out of a space racer's circuit diagram, which drew the
 *  identical four-point path twice — once for a rival and once for the viewer,
 *  with the SAME `tip / back / notch / spread` construction `headingMarker` was
 *  already using and no way for a fix to one to reach the other.
 *
 *  ## The rule that is worth more than the drawing
 *
 *  THERE IS EXACTLY ONE RING AND IT BELONGS TO THE VIEWER. A map that rings the
 *  player AND the two actors adjacent in some order has three ringed marks out
 *  of nine, and the one affordance the panel has for finding yourself has been
 *  destroyed. Everyone else is told apart by colour, which is what colour is
 *  for. This file cannot enforce that — it draws what it is called with — but
 *  the two functions are shaped so that the ring is not a parameter of the
 *  ordinary one, which is the closest a package can get to saying it.
 *
 *  ## And the halo, which is not decoration
 *
 *  A mark on a bright ribbon and a mark on a dark plate are two different
 *  legibility problems, and the viewer's mark is always on the bright part
 *  because that is where the viewer is. `headingMarker` lays a dark halo under
 *  itself for that reason and `discMarker` takes one only when the caller wants
 *  to say something with it.
 *
 *  ## What is not here
 *
 *  Radii, colours, weights, which mark is whose and what order they are drawn
 *  in. All arguments, no defaults. `paintOrder` in `markers.ts` is the sort.
 */

const TWO_PI = Math.PI * 2;

/**
 * The four-point caret, in the marker's own rotated frame.
 *
 * Tip forward, two back corners, and a notch between them so the trailing edge
 * is concave: a plain triangle at six pixels reads as a wedge with no front,
 * and the notch is the whole of what makes the direction unambiguous. Every
 * number is a fraction of the radius and every one is the caller's.
 */
interface CaretShape {
  tip: number;
  back: number;
  notch: number;
  spread: number;
}

function caretPath(g: CanvasRenderingContext2D, r: number, c: CaretShape): void {
  g.beginPath();
  g.moveTo(r * c.tip, 0);
  g.lineTo(-r * c.back, -r * c.spread);
  g.lineTo(-r * c.notch, 0);
  g.lineTo(-r * c.back, r * c.spread);
  g.closePath();
}

/** A disc's ink. Every field required. */
export interface DiscInk {
  fill: string;
  casing: string;
  casingWidth: number;
  /** drawn first, behind the disc, at `haloScale` times the radius */
  halo?: { fill: string; scale: number };
}

/** A flat disc with a casing, and nothing else. */
export function discMarker(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  ink: DiscInk,
): void {
  if (ink.halo) {
    g.beginPath();
    g.arc(x, y, r * ink.halo.scale, 0, Math.PI * 2);
    g.fillStyle = ink.halo.fill;
    g.fill();
  }
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = ink.fill;
  g.fill();
  g.lineWidth = ink.casingWidth;
  g.strokeStyle = ink.casing;
  g.stroke();
}

/** The viewer's mark: a disc, a ring, an outer casing and a chevron. */
export interface HeadingInk {
  fill: string;
  /** the soft dark laid under it so it survives on the bright part of the map */
  halo: string;
  haloScale: number;
  /** THE ring. Heavier than everyone else's casing, and unique. */
  ring: string;
  ringWidth: number;
  /** a thin casing outside the ring, and how far outside it sits */
  casing: string;
  casingWidth: number;
  casingGap: number;
  /** the chevron struck into the disc */
  chevron: string;
  /** tip, back corners and notch, as fractions of the radius */
  chevronTip: number;
  chevronBack: number;
  chevronSpread: number;
  chevronNotch: number;
}

/**
 * The viewer's mark, rotated to `angle` in canvas radians.
 *
 * A marker that carries heading is worth more than one that does not and it
 * costs one path, which is the whole argument for the chevron.
 */
export function headingMarker(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  ink: HeadingInk,
): void {
  g.beginPath();
  g.arc(x, y, r * ink.haloScale, 0, Math.PI * 2);
  g.fillStyle = ink.halo;
  g.fill();

  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = ink.fill;
  g.fill();
  g.lineWidth = ink.ringWidth;
  g.strokeStyle = ink.ring;
  g.stroke();
  g.lineWidth = ink.casingWidth;
  g.strokeStyle = ink.casing;
  g.beginPath();
  g.arc(x, y, r + ink.casingGap, 0, Math.PI * 2);
  g.stroke();

  g.save();
  g.translate(x, y);
  g.rotate(angle);
  caretPath(g, r, {
    tip: ink.chevronTip, back: ink.chevronBack,
    notch: ink.chevronNotch, spread: ink.chevronSpread,
  });
  g.lineJoin = 'round';
  g.fillStyle = ink.chevron;
  g.fill();
  g.restore();
}

/**
 * A caret with no disc under it: the whole mark IS the heading.
 *
 * For a panel small enough that a disc would be a dot. The halo is the same
 * legibility argument `headingMarker` makes — a mark on the bright part of the
 * map needs somewhere dark to sit — and the ring is still THE ring: it is
 * nullable here rather than mandatory precisely so that the rivals can be drawn
 * by this function without one.
 */
export interface CaretInk extends CaretShape {
  /** a soft disc laid down first, or null for no halo. */
  halo: { fill: string; scale: number } | null;
  fill: string;
  /**
   * `globalAlpha` for the fill, or null to leave the context's alone.
   *
   * Null is not 1: a caller whose fill already carries its alpha must not have
   * two alpha writes appear in its stream, because the second is a state change
   * every later mark on the panel has to be audited against.
   */
  fillAlpha: number | null;
  /** the dark outline that keeps the caret off whatever it is standing on. */
  casing: string;
  casingWidth: number;
  /** THE ring, and only the viewer gets one. Null for everybody else. */
  ring: { stroke: string; width: number; scale: number } | null;
}

export function caretMarker(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  ink: CaretInk,
): void {
  if (ink.halo !== null) {
    g.fillStyle = ink.halo.fill;
    g.beginPath();
    g.arc(x, y, r * ink.halo.scale, 0, TWO_PI);
    g.fill();
  }
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  caretPath(g, r, ink);
  g.fillStyle = ink.fill;
  if (ink.fillAlpha !== null) g.globalAlpha = ink.fillAlpha;
  g.fill();
  if (ink.fillAlpha !== null) g.globalAlpha = 1;
  g.strokeStyle = ink.casing;
  g.lineWidth = ink.casingWidth;
  g.stroke();
  g.restore();
  if (ink.ring !== null) {
    g.strokeStyle = ink.ring.stroke;
    g.lineWidth = ink.ring.width;
    g.beginPath();
    g.arc(x, y, r * ink.ring.scale, 0, TWO_PI);
    g.stroke();
  }
}

/**
 * A pin: a stalk standing OFF the path, with a square terminal head.
 *
 * The mark for something bolted to a route rather than travelling along it — a
 * berth, a checkpoint, a beacon, a repair post. It is deliberately a different
 * mark LANGUAGE from `discMarker` and `caretMarker`, and the difference is not
 * decoration: a reviewer who cannot tell a fixture from an actor on a crowded
 * arc will read the fixtures as part of the pack. Different shape, different
 * position relative to the path, and an orientation rule — normal to the route
 * rather than along it — that no moving thing can share.
 */
export interface PinInk {
  /** the foot: the point on the route the pin is attached to. */
  x: number;
  y: number;
  /** which way it stands off, un-normalised. The caller's outward vector. */
  dx: number;
  dy: number;
  /** where the stalk starts and ends, measured from the foot. */
  from: number;
  to: number;
  /** half the terminal head. */
  head: number;
  ink: string;
  width: number;
}

export function pinMarker(g: CanvasRenderingContext2D, s: PinInk): void {
  const l = Math.hypot(s.dx, s.dy) || 1;
  const ux = s.dx / l;
  const uy = s.dy / l;
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.beginPath();
  g.moveTo(s.x + ux * s.from, s.y + uy * s.from);
  g.lineTo(s.x + ux * s.to, s.y + uy * s.to);
  g.stroke();
  const hx = s.x + ux * s.to;
  const hy = s.y + uy * s.to;
  g.fillStyle = s.ink;
  g.fillRect(hx - s.head, hy - s.head, s.head * 2, s.head * 2);
}
