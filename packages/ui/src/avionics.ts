/**
 * ============================================================================
 *  avionics — the four symbols an attitude display is made of.
 * ============================================================================
 *
 * A bank scale with a rolling index, a horizon bar that rolls with the airframe,
 * a fixed waterline, and a flight-path marker that shows where the velocity
 * vector actually goes. Four symbols, no fiction: an aeroplane, a lander, a
 * submarine and an anti-grav machine on a banked deck all draw the same four,
 * and what differs is the numbers.
 *
 * ## The one rule of handedness, which is worth more than the drawing
 *
 * THE TICKS ARE FIXED TO THE AIRFRAME AND THE INDEX ROLLS. The horizon is what
 * moves; the vehicle is what you are sitting in. Getting that backwards
 * produces an instrument that is not wrong so much as unreadable, and it is the
 * single most common way a hand-rolled attitude indicator fails.
 *
 * ## And the one rule of weight
 *
 * THE FIXED DATUM MUST OUT-WEIGH THE MOBILE MARKER. A viewer looking at a
 * display where the flight-path marker is the brightest thing on it will
 * correctly identify the biggest mark as the datum, and then correctly report
 * that the datum is wandering off centre. `waterline` is meant to be drawn
 * heavier than `flightPath`; this file cannot enforce it, but the two symbols
 * are separate functions with separate inks so that the choice is visible.
 *
 * ## The contract, and it is arcGauge's
 *
 *  · Every spec is TOTAL. No default colour, no default proportion, no `?`.
 *  · A context and a struct. No DOM, no game state, no class.
 *  · Angles in DEGREES where the caller reads a scale in degrees and in RADIANS
 *    where the caller has a rotation, because converting one into the other
 *    inside a package is how a package acquires an opinion about which is which.
 *  · Coordinates arrive resolved, in device pixels.
 */

const TWO_PI = Math.PI * 2;

/**
 * The bank scale: graduations on a fixed arc, and one index that rolls.
 *
 * A graduated arc is what makes an ANGULAR RATE visible. A bar rotating with
 * nothing to rotate against is a static diagonal in a still frame, whatever it
 * is doing per second, and the rate is usually the interesting half.
 */
export interface BankScale {
  cx: number;
  cy: number;
  /** the arc the tick FEET sit on. */
  r: number;
  /** the sweep, in degrees, inclusive of both ends. */
  from: number;
  to: number;
  step: number;
  /** added to every angle before it is drawn: -90 puts 0 at the top. */
  rotate: number;
  /** an angle divisible by this gets the long tick. */
  majorEvery: number;
  majorLen: number;
  minorLen: number;
  ink: string;
  width: number;
  /** where the index sits, in the same degrees the ticks are laid in. */
  at: number;
  indexR: number;
  indexInk: string;
}

export function bankScale(g: CanvasRenderingContext2D, s: BankScale): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  for (let a = s.from; a <= s.to; a += s.step) {
    // MULTIPLY THEN DIVIDE, not multiply by a pre-divided constant. The two
    // are not the same double: `(a - 90) * Math.PI / 180` and `(a - 90) *
    // (Math.PI / 180)` differ in the last place for a non-integer angle, which
    // moves the index by a fraction of a pixel and is a real difference to a
    // float-by-float comparison.
    const rad = (a + s.rotate) * Math.PI / 180;
    const len = a % s.majorEvery === 0 ? s.majorLen : s.minorLen;
    g.beginPath();
    g.moveTo(s.cx + Math.cos(rad) * s.r, s.cy + Math.sin(rad) * s.r);
    g.lineTo(s.cx + Math.cos(rad) * (s.r + len), s.cy + Math.sin(rad) * (s.r + len));
    g.stroke();
  }
  // The index is the one mark on this instrument whose POSITION is the value,
  // so it is a filled disc rather than another tick: a tick among ticks is a
  // tick, and the reading is which one of them is lit.
  const rad = (s.at + s.rotate) * Math.PI / 180;
  g.fillStyle = s.indexInk;
  g.beginPath();
  g.arc(s.cx + Math.cos(rad) * s.r, s.cy + Math.sin(rad) * s.r, s.indexR, 0, TWO_PI);
  g.fill();
}

/**
 * The horizon bar: two wings with end caps, rotated with the airframe.
 *
 * CONTINUOUS THROUGH 180°, AND LEGIBLE THERE. The end caps point AT the ground
 * plane, so "which side is down" survives being upside down; past the half turn
 * the caller sets `inboard` and each wing grows a second, shorter bar, which is
 * the mark that survives at thumbnail size. A display that degrades to the word
 * INVERTED at the one moment the picture is interesting has given up.
 *
 * `dash` exists because a broken line is legible at a glance in a way that a
 * slightly different shade of the same hue is not, and a state that is the last
 * warning before something falls needs to be legible at a glance.
 */
export interface HorizonWings {
  cx: number;
  cy: number;
  /** the airframe's roll, in radians, in the direction the context rotates. */
  angle: number;
  /** half the full span of the pair. */
  arm: number;
  /** where each wing stops on the way in, as a fraction of the arm. */
  gap: number;
  /** how far the end caps drop toward the ground plane. */
  cap: number;
  /** the inboard bars: where they sit, and how far they drop, when shown. */
  inboard: boolean;
  inboardAt: number;
  inboardCap: number;
  ink: string;
  width: number;
  /** a dash pattern, or null for a solid line. */
  dash: readonly number[] | null;
}

export function horizonWings(g: CanvasRenderingContext2D, s: HorizonWings): void {
  g.save();
  g.translate(s.cx, s.cy);
  g.rotate(s.angle);
  g.lineWidth = s.width;
  g.strokeStyle = s.ink;
  if (s.dash !== null) g.setLineDash(s.dash as number[]);
  g.beginPath();
  g.moveTo(-s.arm, 0);
  g.lineTo(-s.arm * s.gap, 0);
  g.moveTo(s.arm * s.gap, 0);
  g.lineTo(s.arm, 0);
  g.stroke();
  // Cleared unconditionally: the caps are never dashed, and a package that
  // cleared it only when it had set it would leave a caller's own dash running
  // into the next mark on the panel.
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(-s.arm, 0);
  g.lineTo(-s.arm, s.cap);
  g.moveTo(s.arm, 0);
  g.lineTo(s.arm, s.cap);
  if (s.inboard) {
    g.moveTo(-s.arm * s.inboardAt, 0);
    g.lineTo(-s.arm * s.inboardAt, s.cap * s.inboardCap);
    g.moveTo(s.arm * s.inboardAt, 0);
    g.lineTo(s.arm * s.inboardAt, s.cap * s.inboardCap);
  }
  g.stroke();
  g.restore();
}

/**
 * The waterline: where the vehicle is POINTED, bolted to the middle of the
 * screen and never moving.
 *
 * Two brackets, one either side of centre, each turning down at its inboard
 * end. It is the datum every other symbol here is read against, which is why it
 * is drawn heavier than any of them.
 */
export interface Waterline {
  cx: number;
  cy: number;
  /** how far out each bracket starts, and where it turns down. */
  outer: number;
  inner: number;
  /** how far the inboard end drops. */
  drop: number;
  ink: string;
  width: number;
}

export function waterline(g: CanvasRenderingContext2D, s: Waterline): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.beginPath();
  g.moveTo(s.cx - s.outer, s.cy);
  g.lineTo(s.cx - s.inner, s.cy);
  g.lineTo(s.cx - s.inner, s.cy + s.drop);
  g.moveTo(s.cx + s.outer, s.cy);
  g.lineTo(s.cx + s.inner, s.cy);
  g.lineTo(s.cx + s.inner, s.cy + s.drop);
  g.stroke();
}

/**
 * The flight-path marker: where the vehicle is actually GOING.
 *
 * A ring with two whiskers and a tail, at the screen position the velocity
 * vector resolves to. It MOVES — that is the whole instrument, and pinning it
 * to centre deletes the only aiming aid a display like this has.
 *
 * The two hard stops are not decoration either. A marker that flies off its own
 * scale has stopped indicating, so the caller clamps and this draws the ends it
 * is clamped to; without them a pinned marker and a marker at 90% look the same.
 */
export interface FlightPath {
  x: number;
  y: number;
  r: number;
  /** the whisker's outer end and the tail's top, as multiples of the radius. */
  whisker: number;
  tail: number;
  ink: string;
  width: number;
  /** the two ends of the scale, drawn as vertical rules. */
  stopX0: number;
  stopX1: number;
  stopY0: number;
  stopY1: number;
  stopInk: string;
  stopWidth: number;
}

export function flightPath(g: CanvasRenderingContext2D, s: FlightPath): void {
  g.strokeStyle = s.ink;
  g.lineWidth = s.width;
  g.beginPath();
  g.arc(s.x, s.y, s.r, 0, TWO_PI);
  g.moveTo(s.x - s.r * s.whisker, s.y);
  g.lineTo(s.x - s.r, s.y);
  g.moveTo(s.x + s.r, s.y);
  g.lineTo(s.x + s.r * s.whisker, s.y);
  g.moveTo(s.x, s.y - s.r);
  g.lineTo(s.x, s.y - s.r * s.tail);
  g.stroke();
  g.strokeStyle = s.stopInk;
  g.lineWidth = s.stopWidth;
  g.beginPath();
  g.moveTo(s.stopX0, s.stopY0);
  g.lineTo(s.stopX0, s.stopY1);
  g.moveTo(s.stopX1, s.stopY0);
  g.lineTo(s.stopX1, s.stopY1);
  g.stroke();
}
