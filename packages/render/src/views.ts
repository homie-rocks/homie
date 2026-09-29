/**
 * ============================================================================
 *  views.ts — how many pictures this frame is, and where each one lands.
 * ============================================================================
 *
 *  WHAT THIS IS. The split-screen design settled the boundary before any
 *  code: a package MAY know that there are N views, what a viewport rectangle
 *  is, and that each view has a camera. It MAY NOT know what a PLAYER or a
 *  SEAT is — seats belong to the host and its party-game runtime, which
 *  already own seat isolation and package-origin routing. There is therefore
 *  no seat token or word for "player" anywhere in this contract.
 *
 *  WHY IT IS IN @homie-rocks/render RATHER THAN A NEW PACKAGE. Everything a view has
 *  to reconcile with already lives here: the pipeline that presents the frame
 *  and the cameras it aims. A separate views package imported back by
 *  pipeline.ts would be a cycle wearing a package name.
 *
 * ----------------------------------------------------------------------------
 *  WHAT WAS MEASURED BEFORE THIS FILE EXISTED, and it is not what the plan
 *  predicted.
 * ----------------------------------------------------------------------------
 *  The split-screen plan said: *"`PIXEL_BUDGET_MPX` is 2.2 Mpx at High and
 *  2.4 at Ultra against a renderer backstop of 4.0. TWO FULL-BUDGET VIEWS DO
 *  NOT FIT."*
 *
 *  That is true and it is answering the wrong question. Read where the budget
 *  is actually spent — `settings.ts:109`, which divides it by
 *  `innerWidth * innerHeight`, the WHOLE WINDOW — and the arithmetic for an
 *  equal-area split falls out:
 *
 *      one view    1920x1080 CSS at ratio r     ->  2.07·r² Mpx
 *      two views    960x1080 CSS at ratio r     ->  1.04·r² Mpx  EACH
 *                                               ->  2.07·r² Mpx  TOTAL
 *
 *  An equal-area split does not spend one extra fill pixel. The post chain is
 *  authored per view, so it runs twice over half the area each time, and the
 *  fill total is unchanged. What genuinely doubles is (a) the SCENE pass —
 *  the same geometry submitted twice — and (b) the fixed per-pass cost of the
 *  chain, which is real but is not measured in megapixels.
 *
 *  So the tier arithmetic is NOT "one budget per view". The budget is per
 *  FRAME: two half-window views at ratio r spend exactly the same fill as one
 *  whole-window view at ratio r. Raising each half to the ceiling it could
 *  afford alone would spend the frame budget twice. `viewCost()` below keeps
 *  that invariant executable instead of leaving it as prose.
 *
 * ----------------------------------------------------------------------------
 *  THE ORIGIN FLIP IS A REAL BUG SOURCE AND IT LIVES HERE ONCE.
 * ----------------------------------------------------------------------------
 *  A `ViewRect` is in CSS pixels with the origin at the TOP LEFT, because that
 *  is what a DOM overlay, a HUD element and a pointer event all use, and a
 *  split-screen game has one of each per view. WebGL's viewport origin is at
 *  the BOTTOM LEFT. `glRect()` is the only place in this package that
 *  converts between them; a game doing it by hand gets a picture that is
 *  correct on a symmetric layout and upside down on every other one, which is
 *  exactly the class of defect that survives a screenshot review.
 * ============================================================================
 */
import type * as THREE from 'three';

/**
 * A rectangle of the presentation surface, in CSS pixels, ORIGIN TOP LEFT.
 *
 * Not device pixels: the pixel ratio is the pipeline's business and changes
 * under the adaptive ladder, so a rect carrying device pixels would be stale
 * one rung later.
 */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The narrow shape the PIPELINE reads off a view. Two fields, no settings and
 * no destination abstraction, because the pipeline does not read either.
 *
 * This is deliberately the whole public contract. Independent phone rendering
 * is a state-sync protocol, and independent per-view effect tiers require
 * independent composers. Neither exists yet, so declaring either here would
 * make an attractive field that the renderer silently ignores.
 */
export interface PipelineView {
  readonly camera: THREE.Camera;
  /** CSS pixels, origin TOP LEFT. See `glRect`. */
  readonly rect: ViewRect;
}

/**
 * How a surface is cut up. `single` is in the list on purpose: it is the
 * identity, and it is what the byte-exact regression check renders.
 */
export type ViewLayout = 'single' | 'over-under' | 'side-by-side' | 'quad';

/**
 * Cut a surface into the rectangles a layout implies, TOP LEFT origin.
 *
 * EVERY RECT IN A RETURNED SET IS THE SAME SIZE, and that is a property the
 * pipeline depends on rather than a coincidence of these four layouts: one
 * composer serves every view, so its buffers are allocated once at the view
 * size. A layout with unequal rects would need either a reallocation per view
 * per frame — on the order of 25-30 MB of GPU churn at a handheld's buffer
 * size, per the note in `applyResolution` — or a second composer. Neither is
 * built, so the constraint is enforced instead of assumed: `presentViews`
 * checks it and says so.
 *
 * Odd sizes round DOWN and the remainder is left as an unpainted seam rather
 * than given to one view. A 1081-pixel-tall panel split over-under gives two
 * 540-pixel views and one row of background between them; the alternative is
 * two views that differ by a pixel, which breaks the equal-size property above
 * for a row nobody can see.
 */
export function layoutViews(layout: ViewLayout, w: number, h: number): ViewRect[] {
  const W = Math.max(1, Math.floor(w));
  const H = Math.max(1, Math.floor(h));
  switch (layout) {
    case 'single':
      return [{ x: 0, y: 0, w: W, h: H }];
    case 'over-under': {
      const vh = Math.floor(H / 2);
      return [
        { x: 0, y: 0, w: W, h: vh },
        { x: 0, y: H - vh, w: W, h: vh },
      ];
    }
    case 'side-by-side': {
      const vw = Math.floor(W / 2);
      return [
        { x: 0, y: 0, w: vw, h: H },
        { x: W - vw, y: 0, w: vw, h: H },
      ];
    }
    case 'quad': {
      const vw = Math.floor(W / 2);
      const vh = Math.floor(H / 2);
      return [
        { x: 0, y: 0, w: vw, h: vh },
        { x: W - vw, y: 0, w: vw, h: vh },
        { x: 0, y: H - vh, w: vw, h: vh },
        { x: W - vw, y: H - vh, w: vw, h: vh },
      ];
    }
  }
}

/**
 * Convert a top-left CSS rect to the bottom-left one `WebGLRenderer.setViewport`
 * and `setScissor` want.
 *
 * `surfaceH` is the CSS height of the whole canvas, not of the view. Both
 * arguments are CSS pixels: three multiplies by its own pixel ratio on the way
 * to GL, so handing it device pixels squares the ratio and produces a viewport
 * that is correct at dpr 1 and wrong on every retina panel — the defect that
 * only appears on the machine nobody develops on.
 */
export function glRect(rect: ViewRect, surfaceH: number): ViewRect {
  return { x: rect.x, y: Math.max(0, surfaceH - (rect.y + rect.h)), w: rect.w, h: rect.h };
}

/** True when every rect is the same size. See `layoutViews`. */
export function equalSized(rects: readonly ViewRect[]): boolean {
  const first = rects[0];
  if (first === undefined) return false;
  return rects.every((r) => r.w === first.w && r.h === first.h);
}

/**
 * What a set of views costs, in the units the budget is written in.
 *
 * Exists so the claim in this file's header is CHECKABLE rather than a
 * paragraph of prose: a split-view probe asserts that an equal-area
 * two-view split reports the same `fillMpx` as the single view it replaced,
 * and that `scenePasses` is the number that actually doubled.
 */
export interface ViewCost {
  /** total fill, all views, at the given ratio — megapixels */
  fillMpx: number;
  /** how many times the scene geometry is submitted */
  scenePasses: number;
  /** how many times the post chain runs */
  chainRuns: number;
}

export function viewCost(rects: readonly ViewRect[], ratio: number): ViewCost {
  let px = 0;
  for (const r of rects) px += r.w * r.h * ratio * ratio;
  return { fillMpx: px / 1e6, scenePasses: rects.length, chainRuns: rects.length };
}
