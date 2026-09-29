/**
 * ============================================================================
 *  viewrig.ts — the machinery around a split surface. Not which cameras.
 * ============================================================================
 *
 *  `views.ts` next door is the VOCABULARY: what a rect is, how a layout cuts a
 *  surface, the origin flip, the tier arithmetic. `pipeline.ts` PRESENTS them.
 *  Between those two there was a third thing that every split-surface game has
 *  to write and that neither of them owns — the RIG:
 *
 *    · which layout, chosen off the URL, with a name nobody implements
 *      REFUSED LOUDLY rather than falling back to the default;
 *    · the legacy arm, which is not a debug toggle but the second half of the
 *      byte-exact check;
 *    · recomputing the rectangles when — and only when — the surface or the
 *      layout has actually moved, because `setViewSize` reallocates every
 *      render target in the chain;
 *    · handing the loop the aspect of view 0, so the loop stops guessing;
 *    · publishing the view list, and publishing the tier gap as a NUMBER.
 *
 *  It came out of one game's view module, the first and so far only
 *  consumer, and every one of the five bullets above can be described
 *  without naming a bay, a keeper or a boat. What stayed in the game is what
 *  cannot: WHICH two cameras, where the second one sits, and what it frames.
 *
 * ----------------------------------------------------------------------------
 *  WHY THIS IS A PACKAGE NOW AND WAS NOT BEFORE
 * ----------------------------------------------------------------------------
 *  An earlier attempt refused to move this code, for a good reason: the largest
 *  thing in it was `syncProjections()`, a per-frame re-assert of the pilot
 *  camera's aspect that existed ONLY because `@homie-rocks/loop/Loop.ts` wrote
 *  the whole surface's aspect into `ctx.camera` on every resize. Wrapping that
 *  in a package would have published the workaround as platform.
 *
 *  `GameLoopOptions.cameraAspect` removed the workaround instead. `aspect()`
 *  below is what a game passes to it, and it is a PURE FUNCTION of the layout
 *  and the surface — it does not read `#rects`, and it must not, because the
 *  loop calls it during a resize and `sync()` has not run yet at that point.
 *  That ordering is the whole reason it is a function and not a field.
 *
 * ----------------------------------------------------------------------------
 *  THE ONE-VIEW ARM IS BIT-IDENTICAL TO NO RIG AT ALL, ON PURPOSE
 * ----------------------------------------------------------------------------
 *  `layoutViews('single', w, h)[0]` is `{ 0, 0, floor(w), floor(h) }` and the
 *  loop only ever passes integers (`viewportSize` rounds), so `aspect()` on a
 *  single layout returns exactly the `w / h` the loop used to write — the same
 *  double, not a near one. A game that adopts this rig and then runs
 *  `?split=single` has to be able to produce the same bytes as one that never
 *  heard of it, or the byte-exact check is comparing two different pictures and
 *  proving nothing.
 * ============================================================================
 */
import type * as THREE from 'three';
import type { RenderSettings } from './settings.ts';
import {
  layoutViews, viewCost,
  type PipelineView, type ViewLayout, type ViewRect,
} from './views.js';

export interface ViewRigOptions {
  /**
   * The layouts this game will accept off `?split=`. **The first is the
   * default.** A name that is not in here is REFUSED with a `RangeError`
   * rather than silently falling back: a `?split=sidebyside` that quietly gave
   * you the default would be measured, in a room, as evidence about a layout
   * nobody asked for.
   *
   * It is per-game and not the whole of `ViewLayout` because a layout is a
   * claim about the game — `quad` on a two-camera game is a black rectangle,
   * and a piece whose second view is a plan of a square bay is unplayable in a
   * 1920x540 letterbox whatever the arithmetic says.
   */
  readonly layouts: readonly ViewLayout[];
  /** `location.search`. A test substitutes one; nothing here reads a global. */
  readonly search: string;
  /**
   * The surface, PULLED and never cached. The rig is asked for rectangles from
   * two different clocks — the loop's resize and the game's frame — and a
   * surface stored at construction is stale by the first rotation.
   */
  readonly surface: () => { readonly w: number; readonly h: number };
  /**
   * The cameras, in view order, pulled for the same reason. Index 0 is the one
   * the game also hands the loop as `ctx.camera`: a dozen things inside these
   * packages read that field and none of them know a view exists, so a rig
   * that invented its own first camera would leave the post chain's AO and DoF
   * camera, the pre-warm and `ChainWorld.camera` all aimed somewhere the
   * player is not, silently.
   *
   * More cameras than the layout has rectangles is not an error — a two-camera
   * game running `?split=single` shows the first one, which is exactly what
   * the byte-exact check renders.
   */
  readonly cameras: () => readonly THREE.Camera[];
  /** The process's settings, for the frame-cost diagnostic published below. */
  readonly settings: RenderSettings;
  /**
   * Where the view list lands — `(views) => { ctx.views = views; }`.
   *
   * A callback and not a `Ctx` field, because this package may not know what a
   * game's context is. It is called from `sync()` only, which is the layout
   * path: at boot and on a real resize, never per frame.
   */
  readonly publish: (views: PipelineView[]) => void;
  /**
   * `pipeline.setViewSize` — the composer's own size, or `null` to say "use
   * the whole surface, through the single-call path".
   *
   * `null` ON THE LEGACY ARM IS LOAD-BEARING AND NOT A TIDY-UP.
   * `setViewSize({ w, h })` with the full surface's own numbers is
   * arithmetically the same size but NOT the same code: it takes the two-call
   * resize in `applyResolution` — composer at the view, canvas back to the
   * surface — where `null` takes the single call every non-split game takes.
   * The check is asking whether those two produce the same bytes, so the legacy
   * arm has to genuinely be the legacy call and not a same-numbers impostor.
   */
  readonly onLayout?: ((size: { w: number; h: number } | null) => void) | null;
  /**
   * The `window` property the diagnostics go on. Defaults to `__views`, which
   * is what the split-view probe reads.
   *
   * A PROBE ANCHORED ON A NAME IS THE THING A RENAME BREAKS SILENTLY, so the
   * default is stated here once and games do not spell it.
   */
  readonly diagnostic?: string;
}

/**
 * `?views=legacy` — RENDER THROUGH THE PATH THAT EXISTED BEFORE SPLIT SCREEN.
 *
 * The view list stays EMPTY, so `pipeline.ts` takes the branch every
 * one-camera game takes and the game becomes an ordinary one.
 *
 * IT IS THE OTHER HALF OF THE BYTE-EXACT CHECK AND IT IS NOT A DEBUG TOGGLE.
 * The split-screen design asks for a one-view render through the
 * new path to be byte-identical to no split screen at all. That claim needs
 * BOTH arms to exist, and the second arm cannot be another game — a different
 * game is a different picture and proves nothing.
 *
 * A URL parameter and not a `window.__fault`, for the reason the shipped games
 * give about `?glfail=`: nothing about it is reachable without somebody typing
 * it, and a guest's launch has never been through this branch.
 */
export function legacyAsked(search: string): boolean {
  return new URLSearchParams(search).get('views') === 'legacy';
}

/**
 * Which layout `?split=` asked for. Throws on a name the game does not
 * implement; see `ViewRigOptions.layouts`.
 */
export function askedLayout(search: string, layouts: readonly ViewLayout[]): ViewLayout {
  const fallback = layouts[0];
  if (fallback === undefined) {
    throw new RangeError('a ViewRig needs at least one accepted layout; `layouts` was empty');
  }
  const asked = new URLSearchParams(search).get('split');
  if (asked === null) return fallback;
  if (!layouts.includes(asked as ViewLayout)) {
    throw new RangeError(
      `?split=${JSON.stringify(asked)} is not one of [${layouts.join(', ')}]. ` +
      'A layout nobody implements must not look like the default.');
  }
  return asked as ViewLayout;
}

export class ViewRig {
  readonly layout: ViewLayout;
  readonly legacy: boolean;

  readonly #o: ViewRigOptions;
  #rects: ViewRect[] = [];
  /** what the last layout pass saw, so a no-op resize reallocates nothing */
  #laidFor = '';

  constructor(o: ViewRigOptions) {
    this.#o = o;
    this.legacy = legacyAsked(o.search);
    // A legacy run is one full-surface picture BY DEFINITION, so it takes the
    // 'single' rect arithmetic and simply does not publish it. Note that this
    // bypasses `askedLayout` entirely: `?views=legacy&split=over-under` is a
    // legacy run, because the whole point of the arm is "the code path that
    // existed before any of this".
    this.layout = this.legacy ? 'single' : askedLayout(o.search, o.layouts);
  }

  /** The rectangles as of the last `sync()`. Empty until the first one. */
  get rects(): readonly ViewRect[] { return this.#rects; }

  /**
   * THE ASPECT OF VIEW 0, FOR `GameLoopOptions.cameraAspect`.
   *
   * Pure in `(layout, w, h)` — see the header. Wire it as
   * `cameraAspect: (w, h) => rig.aspect(w, h)` and the loop stops writing the
   * surface's aspect into a camera that is not the size of the surface.
   *
   * `Math.max(1, …)` on the height is the same floor `layoutViews` applies to
   * the surface, restated because a zero here reaches the loop's own validator
   * as an Infinity and the error it prints should name the rig, not the game.
   */
  aspect(w: number, h: number): number {
    const first = layoutViews(this.layout, w, h)[0];
    if (first === undefined) {
      throw new RangeError(`[viewrig] layout ${this.layout} produced no rectangles`);
    }
    return first.w / Math.max(1, first.h);
  }

  /**
   * Recompute the layout if the surface or the layout has moved, and do
   * nothing at all if it has not.
   *
   * Call it from `update()`. It is guarded on a key rather than hooked to a
   * resize event because the game's own systems have their own order and this
   * has to be correct on the frame after a rotation whichever of them ran
   * first — and the guard makes the common case a string compare.
   *
   * @param force recompute even when the key matches. Boot needs it: nothing
   *   has been published yet and the key would match a surface that has never
   *   been laid out.
   */
  sync(force = false): void {
    const { w, h } = this.#o.surface();
    const key = `${this.layout}:${w}x${h}`;
    if (!force && key === this.#laidFor) return;
    this.#laidFor = key;

    this.#rects = layoutViews(this.layout, w, h);
    const cams = this.#o.cameras();
    // The shorter of the two lists. A single-view run has one rect and takes
    // the first camera; a game that has not built its second camera yet gets
    // one view rather than a hole.
    const n = Math.min(this.#rects.length, cams.length);
    this.#o.publish(this.legacy ? [] : this.#rects.slice(0, n).map((rect, i) => ({
      camera: cams[i] as THREE.Camera,
      rect,
    })));

    // TELL THE PIPELINE SEPARATELY, and only here. `setViewSize` reallocates
    // every render target in the chain — 25-30 MB of GPU churn on a handheld,
    // per the note in `applyResolution`.
    const first = this.legacy ? null : this.#rects[0] ?? null;
    this.#o.onLayout?.(first === null ? null : { w: first.w, h: first.h });

    this.#publishDiagnostic();
  }

  /** Publish the layout and its frame-wide fill/submit costs for the probe. */
  #publishDiagnostic(): void {
    if (typeof window === 'undefined') return;
    const cost = viewCost(this.#rects, this.#o.settings.maxPixelRatio);
    const name = this.#o.diagnostic ?? '__views';
    (window as unknown as Record<string, unknown>)[name] = () => ({
      layout: this.layout,
      legacy: this.legacy,
      rects: this.#rects,
      views: this.legacy ? 0 : Math.min(this.#rects.length, this.#o.cameras().length),
      maxPixelRatio: this.#o.settings.maxPixelRatio,
      fillMpx: cost.fillMpx,
      scenePasses: cost.scenePasses,
      chainRuns: cost.chainRuns,
    });
  }
}

/**
 * Left/right/top/bottom for an ORTHOGRAPHIC camera that must frame a square of
 * world without ever cropping it, in a rectangle of any aspect.
 *
 * The tighter axis gets the half-extent and the looser one is widened, which
 * is the opposite of a cover fit and is the right choice for a chart, a map or
 * a plan: a view of a place that crops the place is a view that cannot be
 * talked about. What the half-extent IS — how much of the world is worth
 * framing — is the game's, and it is the only number this does not decide.
 */
export function fitOrtho(rect: { w: number; h: number }, half: number): {
  left: number; right: number; top: number; bottom: number;
} {
  const a = rect.w / Math.max(1, rect.h);
  const hx = a >= 1 ? half * a : half;
  const hy = a >= 1 ? half : half / a;
  return { left: -hx, right: hx, top: hy, bottom: -hy };
}
