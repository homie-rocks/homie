/**
 * ===========================================================================
 *  @homie-rocks/ui/viewPanes.ts — putting DOM over the rectangles a pipeline drew.
 * ===========================================================================
 *
 * WHAT WAS MISSING. `@homie-rocks/render/views.ts` gained `ViewRect`, `layoutViews`
 * and `presentViews` on 2026-08-21, so a game can render two pictures into two
 * halves of one surface. **Nothing published the companion**: where the HUD
 * for each of those pictures goes. One split-view game wrote it by hand and its
 * comment states the defect it is guarding against:
 *
 *   *"A HUD laid out against the window looks perfect on the default layout
 *   and puts one player's gauge in the middle of the other player's chart on
 *   the other one — the shape of defect a screenshot of the default cannot find."*
 *
 * That is a familiar defect's geometry: one element positioned
 * against something other than the authority on where things are, correct in
 * the state everybody photographs and wrong in the states nobody does.
 *
 * WHY IT IS IN `@homie-rocks/ui` AND NOT IN `@homie-rocks/render`. This package's whole
 * remit is *"screen-space primitives with NO renderer dependency"*, and there
 * is none here: the parameter is a plain `{x,y,w,h}`, structurally typed, so a
 * caller passes `PipelineView.rect` with no import and a caller with no
 * pipeline at all passes whatever it computed. `views.ts` stays DOM-free,
 * which is what lets a Node harness reason about layout with no document.
 */

/** Just enough of a rectangle. Structural, so `ViewRect` satisfies it. */
export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Park each pane over its view's rectangle, and HIDE the panes with no view.
 *
 * Panes are matched to rects BY INDEX, which is the same order `presentViews`
 * draws them in. A pane whose index has no rect gets `display: none` rather
 * than being left where it was: **a stale pane is the cache-of-a-fact shape**,
 * and in that game it put a navigation chart's numbers over a fog view when
 * `?split=single` reduced two views to one. That single-view run is a real run
 * — it is what the byte-exact capture gate photographs.
 *
 * The panes must be `position: fixed` (or absolute in a full-surface
 * container); this writes `left/top/width/height` in CSS pixels and nothing
 * else, so the stylesheet keeps everything about how a pane LOOKS.
 *
 * @returns true if anything was written, false if the layout had not moved
 */
export function placeOverViews(
  panes: readonly (HTMLElement | null)[],
  rects: readonly (PaneRect | undefined)[],
  state: PaneLayoutState,
  force = false,
): boolean {
  // GUARDED ON A KEY RATHER THAN RUN EVERY FRAME. Four `style` writes a frame
  // is four style recalculations a frame on a page that is already presenting
  // two full pictures, and the rects only move when the layout does. The key
  // is the rects and not a frame count, so a layout that DOES move is picked
  // up on the frame it moves and not one later.
  let key = '';
  for (const r of rects) key += r === undefined ? '|-' : `|${r.x},${r.y},${r.w},${r.h}`;
  if (!force && key === state.placedFor) return false;
  state.placedFor = key;

  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i];
    if (pane === null || pane === undefined) continue;
    const rect = rects[i];
    if (rect === undefined) {
      pane.style.display = 'none';
      continue;
    }
    pane.style.display = '';
    pane.style.left = `${rect.x}px`;
    pane.style.top = `${rect.y}px`;
    pane.style.width = `${rect.w}px`;
    pane.style.height = `${rect.h}px`;
  }
  return true;
}

/**
 * What the panes were last placed for.
 *
 * A MUTABLE RECORD RATHER THAN STATE INSIDE THIS MODULE, because a page may
 * have more than one set of panes and module-level state would make two sets
 * silently share one guard — the second set would place once and then never
 * again. The caller holds one of these per group.
 */
export interface PaneLayoutState {
  placedFor: string;
}

/** A fresh guard. `''` can never equal a real key, which always starts `|`. */
export function paneLayoutState(): PaneLayoutState {
  return { placedFor: '' };
}
