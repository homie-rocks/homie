/**
 * ============================================================================
 *  BakedPlate — a 2D panel whose static half is drawn once and blitted.
 * ============================================================================
 *
 *  THE PATTERN. An instrument on a HUD is almost entirely static: the well, the
 *  ribbon, the graticule, the start line. Only a handful of marks move. Redoing
 *  the static half every frame is a few hundred canvas path operations per
 *  frame for a picture that has not changed, so it is baked once into an
 *  offscreen canvas the same size as the visible one and `drawImage`d in a
 *  single call, and only the moving marks are rasterised per frame.
 *
 *  THE THREE THINGS THAT GO WRONG, all of which this file exists to hold once:
 *
 *  1. THE TWO CANVASES DRIFT. The bake surface and the visible surface must be
 *     the same pixel size or the blit silently rescales — a soft, slightly
 *     wrong picture that no probe reads as a failure. They are resized
 *     together here or not at all.
 *
 *  2. DEVICE PIXELS AND CSS PIXELS GET CONFUSED. The backing store is CSS px
 *     times `devicePixelRatio`, capped at 2 (past that the cost is real and the
 *     gain is not visible on a television at three metres). Line widths written
 *     in device px do not survive a change of panel size; line widths written
 *     in CSS px do not survive a change of DPR. `u` is both folded together:
 *     multiply a weight authored at the reference panel height by `u` and it
 *     keeps its PROPORTIONS on a 720p panel and a 1440p one, rather than
 *     keeping its pixels.
 *
 *  3. A ZERO-SIZED BOX IS NOT A SMALL PANEL. Before layout runs,
 *     `getBoundingClientRect()` reports a box that is nearly nothing, and
 *     fitting a diagram to it bakes a picture one pixel across which then
 *     survives until the next resize. `measure` refuses a box below the floor
 *     and says so in its return value rather than baking rubbish.
 *
 *  Both circuit maps this was extracted from — a kart racer's and a space
 *  racer's — had their own copy of all three, agreeing on every number
 *  including the floor. The DRAWINGS have nothing in common and stay with
 *  their games; this is the surface under them.
 * ============================================================================
 */

/**
 * A box smaller than this in CSS px is a panel that has not been laid out yet,
 * not a small panel. Both callers arrived at the same pair independently.
 */
const MIN_CSS_W = 32;
const MIN_CSS_H = 24;

/** Above 2 the cost is real and the gain is not visible at viewing distance. */
const MAX_DPR = 2;

export class BakedPlate {
  /** the visible surface, blitted from `base` and then drawn over */
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  /** the offscreen surface the static half is baked into */
  readonly base: HTMLCanvasElement;
  readonly baseG: CanvasRenderingContext2D;

  /** backing-store size, device px */
  w = 0;
  h = 0;
  dpr = 1;
  /**
   * device px per reference CSS px — DPR folded together with panel scale.
   * Multiply every authored weight by this.
   */
  u = 1;

  /**
   * `parent` is appended to when given. The canvas carries no class of its own:
   * a package that named a class would be deciding what the panel looks like,
   * which is the game's call.
   */
  constructor(parent?: HTMLElement) {
    this.canvas = document.createElement('canvas');
    if (parent) parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.baseG = this.base.getContext('2d')!;
  }

  /**
   * Size both surfaces from a CSS box.
   *
   * @param refH  the panel height the drawing's weights were authored at.
   * @returns true when the surfaces are usable and the caller must re-bake;
   *   false when the box has not been laid out yet and NOTHING was changed —
   *   which is a different thing from "resized to nothing", and the two must
   *   not render as the same colour.
   */
  measure(cssW: number, cssH: number, refH: number, uMin: number, uMax: number): boolean {
    if (cssW < MIN_CSS_W || cssH < MIN_CSS_H) return false;
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.w = Math.round(cssW * this.dpr);
    this.h = Math.round(cssH * this.dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.base.width = this.w;
    this.base.height = this.h;
    const s = cssH / refH;
    this.u = this.dpr * (s < uMin ? uMin : s > uMax ? uMax : s);
    return true;
  }

  /**
   * Clear the bake surface and hand back its context with the transform reset.
   * Resetting the transform is the half that is easy to forget: a bake that
   * ended inside a `translate`/`rotate` leaves it set, and the NEXT bake draws
   * somewhere else entirely — once, at a resize, which is exactly when nobody
   * is looking.
   */
  beginBake(): CanvasRenderingContext2D {
    const g = this.baseG;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    return g;
  }

  /**
   * Put the baked half on the visible surface and hand back its context, ready
   * for the moving marks. Same transform reset, same reason.
   */
  blit(): CanvasRenderingContext2D {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.base, 0, 0);
    return g;
  }
}
