/**
 * ============================================================================
 *  screenAnchor — a label pinned to a moving point that never lands under a
 *  panel and never lands on another label.
 * ============================================================================
 *
 *  A diegetic layer — the half of an interface that lives IN the frame rather
 *  than around it — hangs a chip over a ship, a ring over a structure, a
 *  nameplate under the cursor. It has exactly two ways to fail and both of them
 *  look like a rendering fault rather than a layout one:
 *
 *   1. THE CHIP LANDS UNDER A PANEL. The perimeter panels are opaque by
 *      construction, so the chip is not ugly, it is INVISIBLE — and the reader's
 *      conclusion is that the game forgot to draw it.
 *   2. TWO CHIPS LAND ON EACH OTHER. Two ships on one pad project to two points
 *      a chip-width apart. Overlapped, neither is readable, and an unreadable ID
 *      chip is worse than no chip at all.
 *
 *  Both are solved with rectangles and neither needs a camera, which is what
 *  makes this a `@homie-rocks/ui` capability. The general part of the
 *  base-building game's world tags was about 25 substantive lines, and the
 *  shape of what moved is `place(anchor, size, exclusions)`.
 *
 *  ── WHY IT IS IN `@homie-rocks/ui` AND NOT IN A WORLD-SPACE PACKAGE ──────────
 *
 *  Because after the camera is taken out there is nothing world about it. What
 *  is left is: read some element rects, test a box against them, push a box
 *  down past other boxes, write a transform. That is screen-space DOM
 *  arithmetic, which is `@homie-rocks/ui`'s stated subject *("screen-space
 *  primitives with no renderer dependency")*, and moving forty lines of it
 *  elsewhere would draw a package edge between `blocked()` and `setAttr()`.
 *
 *  ── WHAT STAYED IN THE GAME, AND WHY THAT LINE IS THERE ────────────────────
 *
 *  `project()` and `screenRadius()` did not come. They take a `THREE.Camera`,
 *  and `@homie-rocks/ui` has no `three` peer dependency and should not acquire
 *  one — two copies of three.js is two `instanceof` universes, and this package
 *  is imported by phone and host pages that have no renderer at all. Eight
 *  lines of `Vector3.project` staying next to the game's own camera is a much
 *  smaller cost than a renderer dependency on the package every screen loads.
 *
 *  Everything that decides what an anchor IS also stayed: which ships get a
 *  chip, which structure is cued, what a stranded hull means. Those are the
 *  game.
 */

/** A screen-space box in client pixels, top-left origin. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Read the live footprints of the panels a tag must dodge.
 *
 * READ OFF THE ELEMENTS, never hard-coded, so the keep-out cannot drift out of
 * step with the stylesheet the next time a gutter width changes — which is a
 * silent failure, because the tag still renders, just underneath something.
 *
 * Zero-area elements are skipped: a panel with `display:none` still answers
 * `getBoundingClientRect` with a rect at the origin, and honouring that one
 * would blank the whole top-left corner of the frame for a panel that is not
 * on screen.
 */
export function readKeepOut(ids: readonly string[], into: Rect[] = []): Rect[] {
  into.length = 0;
  for (let i = 0; i < ids.length; i++) {
    const n = document.getElementById(ids[i]!);
    if (!n) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    into.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  }
  return into;
}

/**
 * How many frames a keep-out reading is allowed to stand for.
 *
 * `getBoundingClientRect` forces a synchronous layout flush, and a diegetic
 * layer runs AFTER the HUD has written a hundred strings and a dozen inline
 * styles — so re-reading six rects every frame buys a full layout per frame for
 * information that changes a few times a minute. A tag that is a sixth of a
 * second late to notice a panel opened is not a bug; a layout flush in the hot
 * path is.
 */
export const KEEP_OUT_FRAMES = 10;

/**
 * The cadence in `KEEP_OUT_FRAMES` made callable, so the counter and the reason
 * for it live in one place instead of being re-derived per game.
 *
 * Call it once per frame with `force` true on any viewport change: a resize
 * moves every panel at once and is the one event a stale reading gets visibly
 * wrong.
 */
export class KeepOut {
  readonly rects: Rect[] = [];
  #age = 0;
  constructor(readonly ids: readonly string[], readonly everyFrames = KEEP_OUT_FRAMES) {}
  update(force: boolean): void {
    if (!force && this.#age > 0) { this.#age--; return; }
    this.#age = this.everyFrames;
    readKeepOut(this.ids, this.rects);
  }
}

/** True when a `w x h` box at `x,y` overlaps any of `keep`. */
export function blocked(
  x: number, y: number, w: number, h: number, keep: readonly Rect[],
): boolean {
  for (let i = 0; i < keep.length; i++) {
    const k = keep[i]!;
    if (x < k.x1 && x + w > k.x0 && y < k.y1 && y + h > k.y0) return true;
  }
  return false;
}

/**
 * Push a box down until it clears everything already placed, and record it.
 *
 * Returns the settled `y`. `placed` is the caller's per-frame list, cleared by
 * the caller at the top of the frame — the package does not own the frame.
 *
 * ── THE ITERATION CAP IS LOAD-BEARING ──────────────────────────────────────
 *
 * The re-test after a move is a fixed point: moving down past box A can push
 * into box B, which is why the loop restarts. With enough boxes that is
 * quadratic, and it runs inside a per-frame layout pass, so it is capped at
 * `limit` comparisons. The failure mode when it caps out is "the twelfth chip
 * on a single pad overlaps the eleventh", which nobody will ever see; the
 * failure mode without the cap is a frame that takes 40 ms during exactly the
 * crisis the chips exist for.
 */
export function stackDown(
  x: number, y: number, w: number, h: number,
  placed: Rect[], gap = 5, limit = 12,
): number {
  let yy = y;
  for (let k = 0; k < placed.length && k < limit; k++) {
    const q = placed[k]!;
    if (x < q.x1 && x + w > q.x0 && yy < q.y1 && yy + h > q.y0) {
      yy = q.y1 + gap;
      k = -1;                               // re-test against everything
    }
  }
  placed.push({ x0: x, y0: yy, x1: x + w, y1: yy + h });
  return yy;
}

/**
 * Write a tag's transform: translate to the anchor, then offset by an origin.
 *
 * One `transform` and no `left`/`top`, because a transform is composited and a
 * position write is a layout — and this runs on every visible tag every frame.
 * The percentages come first so the element is offset by its OWN size, which is
 * how the caller avoids measuring a box whose width depends on its text.
 *
 * `originX`/`originY` are CSS percentage strings ('-50%', '-100%', '0'): a
 * label hung above its anchor is `-50% / -100%`; one hung to the left of it is
 * `-100% / -50%`. Pixel values are accepted too, since the string is passed
 * straight through.
 */
export function placeTag(
  n: HTMLElement, x: number, y: number, originX: string, originY: string,
): void {
  n.style.transform = 'translate(' + originX + ', ' + originY + ') translate('
    + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px)';
}

/**
 * Hang a box on whichever side of its anchor is clear, or report that neither
 * is — which is a real answer and not a failure.
 *
 * Returns 'l', 'r', or null when BOTH sides are covered. Hiding the tag is the
 * correct outcome in that case rather than drawing it under a plate: the panel
 * covering it is, by construction, a panel that is on screen and probably
 * already naming the same subject.
 */
export function pickSide(
  ax: number, ay: number, w: number, h: number, gap: number, keep: readonly Rect[],
): 'l' | 'r' | null {
  const leftOk = !blocked(ax - gap - w, ay - h * 0.5, w, h, keep);
  if (leftOk) return 'l';
  const rightOk = !blocked(ax + gap, ay - h * 0.5, w, h, keep);
  return rightOk ? 'r' : null;
}
