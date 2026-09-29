/**
 * ===========================================================================
 *  @homie-rocks/loop/Loop.ts — the frame loop a 3D game boots into.
 * ===========================================================================
 *
 * WHAT THIS IS. Two racing games' `main.ts` files were, with COMMENTS
 * STRIPPED, identical from the render-loop watchdog to the end of
 * `__loopHealth` — 350 lines, not one differing character, in two files nobody
 * had diffed. A first-person shooter ran the same loop with the same numbers,
 * four console lines fewer, and one genre noun changed (`MatchState.Live`
 * where the racers say `RaceState.Racing`).
 *
 * The common path keeps the three values that actually differ between the
 * original consumers:
 *
 *   `live()`     is this frame one the ladder may reason about? See Ladder.ts.
 *   `restore()`  the GPU resources three cannot re-derive after a context
 *                loss — each game's environment probe and its pre-warm.
 *   `systems`    the array, in the order that game's init contract requires.
 *
 * A base-building game established the second honest path. Its renderer
 * already owns a different adaptive scaler, and its display clock keeps
 * running while its speed-scaled simulation is held. It supplies those owners
 * as structures and functions: `resolution`, `clock`, `tick`, and a
 * control-only pipeline plus `present`. None is a game mode and no colony noun
 * enters this package.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS IN HERE THAT ARE LOAD-BEARING AND LOOK LIKE TIDY-UPS:
 *
 *  1. `dt = frozen ? 0 : Math.min(raw, 1/20)`. The clamp stops a backgrounded
 *     tab teleporting the simulation; the freeze is what lets a screenshot
 *     tool retry a torn capture and still photograph the same instant.
 *     BOTH terms, in that order — a `Math.min` applied to a frozen frame is a
 *     dt-floor bug this loop once had.
 *  2. The render-failure ladder. Four throws disables post; twenty-four gives
 *     up and leaves the last good frame on screen under a banner. A black
 *     rectangle with a pegged CPU is the failure it exists to prevent.
 *  3. `surfaceValid`. A hidden or collapsed `#app` is the ABSENCE of a size,
 *     not a size — resizing to it produces a 1x1 buffer and a black flash. The
 *     loop keeps simulating and withholds only the present.
 */

import { device } from '@homie-rocks/device/Device.js';
import type {
  LoopFrameSource,
  LoopPipeline,
  LoopPipelineHost,
  LoopSystem,
  LoopWorld,
  PresentDiagnostics,
  PresentWatch,
} from './Host.ts';
import {
  ResolutionLadder,
  WATCHDOG_FROM_FRAME,
  type LadderHealth,
  type PresentedFrame,
} from './Ladder.ts';

/**
 * The size a degenerate measurement has to beat before it counts as one.
 *
 * See `surface()` below: an element can measure zero (a `display:none`
 * ancestor, a collapsed pane, a background tab, or simply being read
 * mid-layout) and `Math.max(1, ...)` used to turn that into a 1x1 canvas.
 */
export const MIN_SURFACE = 16;

/** The frame `__gameReady` is published on. See `GameLoopOptions.onReady`. */
export const READY_FRAME = 8;

export type LoopHealthMetric = number | boolean;
export type LoopHealthMetrics = Readonly<Record<string, LoopHealthMetric>>;

export interface GameLoopHealth {
  frame: number;
  /** Frames that reached the pipeline without throwing. */
  presents: number;
  /** Window-clock frames withheld deliberately by `presentEvery`. */
  pacedSkips: number;
  renderFailures: number;
  suspended: boolean;
  contextLost: boolean;
  /**
   * Is something other than `window` supplying the frames right now?
   *
   * Published because `__loopHealth` is what soak and perf tests read, and a
   * frame rate measured while a headset owns the
   * clock is a reading of a different machine — 72, 90 or 120 Hz, two eyes, no
   * post chain. A number with no way to tell which of those it came from is
   * the shape this file's header calls a plausible default.
   */
  externallyDriven: boolean;
  [metric: string]: LoopHealthMetric;
}

/**
 * A resolution controller that already belongs to the caller.
 *
 * When absent, GameLoop constructs its proven `ResolutionLadder`. Supplying
 * one means the loop owns no second ladder: it only asks the real owner whether
 * to skip a present, tells it about a completed present, and publishes the
 * metrics that owner chooses to expose. Methods are optional because a scaler
 * living inside a renderer may already receive its frame and restore signals
 * there; `owner` and `health` are required so an empty object cannot silently
 * mean "turn adaptation off".
 */
export interface LoopResolutionControl {
  readonly owner: string;
  applyPin?(): void;
  reset?(): void;
  skipPresent?(): boolean;
  afterPresent?(frame: PresentedFrame): void;
  health(): LoopHealthMetrics;
}

/** The wall-clock facts from which a game derives its two clocks. */
export interface LoopClockInput {
  now: number;
  /** Seconds since the previous rAF callback. */
  raw: number;
  /** `raw`, capped at 1/20 so a backgrounded tab cannot teleport a world. */
  clamped: number;
  held: boolean;
}

/**
 * `dt` drives per-display work; `advance` is added to `ctx.time`.
 * They are equal in the default loop. A paused or time-scaled simulation may
 * keep display work alive while advancing its world by zero or by `dt * speed`.
 */
export interface LoopClockSample {
  dt: number;
  advance: number;
}

export interface LoopFrame extends LoopClockInput, LoopClockSample {}

export interface LoopReadyPolicy {
  /** The rAF tick count must reach this value. */
  minFrame: number;
  /** This many renderer submissions must have returned without throwing. */
  minSuccessfulPresents: number;
}

interface GameLoopBaseOptions<W extends LoopWorld> {
  /** The element the canvas fills — `#app`, `position: fixed; inset: 0`. */
  parent: HTMLElement;
  /** The game's own context. Structurally a `LoopWorld`; see Host.ts. */
  ctx: W;
  /** In init order. The loop calls `update`, `lateUpdate` and `resize` on each. */
  systems: LoopSystem<W>[];
  frameWatch?: PresentWatch<W> | undefined;
  diagnostics?: PresentDiagnostics<W> | undefined;
  /**
   * Rebuild what a WebGL context restore cannot: the game's own environment
   * probe and shader pre-warm. Awaited before the loop resumes. Throwing is
   * the game's business to report; the loop resumes either way, because a game
   * with a black env map is still better than a suspended one.
   */
  restore?: (() => void | Promise<void>) | undefined;
  /**
   * Called once, on READY_FRAME. The default dismisses `#boot`; a game with a
   * different curtain passes its own. `__gameReady` is set by the loop either
   * way, and it means A FRAME HAS ACTUALLY PRESENTED rather than "setup
   * returned" — gating it on setup meant screenshots of a blank canvas.
   */
  onReady?: (() => void) | undefined;
  /**
   * Default: frame 8 after at least one successful present, preserving the
   * original three games. A caller whose curtain is itself the first-frame
   * gate supplies both numbers explicitly.
   */
  readyPolicy?: LoopReadyPolicy | undefined;
  /**
   * Derive display and world deltas from one rAF interval. The default freezes
   * both and otherwise advances both by `clamped`.
   */
  clock?: ((ctx: W, input: LoopClockInput) => LoopClockSample) | undefined;
  /** Caller-owned ordered frame work, after systems.update and before lateUpdate. */
  tick?: ((ctx: W, frame: LoopFrame) => void) | undefined;
  /** `location.search`; a harness may substitute one. See Ladder.ts `?scaler=`. */
  search?: string | undefined;
  /**
   * =========================================================================
   *  HOW MANY rAF TICKS PER PRESENTED FRAME. 1 — the default — is every one.
   * =========================================================================
   *  Added 2026-08-21 for an ambient piece, the first consumer of this loop
   *  that has no player.
   *
   *  WHAT WAS MISSING. An ambient piece should not burn a 1080p panel at
   *  60 Hz while nobody is watching, and there was no supported way for it to
   *  ask for less. The only mechanism that existed is
   *  `ladder.skipRender`, which is the STALL DRAIN: the ladder owns it, its own
   *  comment says it exists to hand a backlogged GPU a whole frame with no new
   *  work, and writing to it from a game is a game reaching into a controller's
   *  private state to mean something the controller does not mean. It would
   *  also have worked, silently and by accident, which is the worse outcome.
   *
   *  READ EVERY FRAME, NEVER CACHED, for the reason `live` is: the thing it
   *  asks about — whether anybody is watching — changes under the loop.
   *
   *  Values below 1, NaN and non-integers are all rounded and clamped up to 1
   *  rather than rejected. A cadence is not a correctness-critical number: the
   *  cost of clamping a typo is that the piece runs at full rate, and the cost
   *  of throwing is a black screen in front of an audience.
   *
   *  IT DOES NOT SLOW THE SIMULATION. `update` and `lateUpdate` run on every
   *  tick exactly as they always did, so `ctx.time` is unchanged and the world
   *  is in the same place whether it was drawn or not — an experience whose
   *  clock moved with its present rate would run at a different speed depending
   *  on how many people are watching.
   */
  presentEvery?: (() => number) | undefined;
  /**
   * =========================================================================
   *  WHAT ASPECT `ctx.camera` IS GIVEN ON A RESIZE. Absent — the default —
   *  is `w / h`, the whole surface, exactly as this loop has always done.
   * =========================================================================
   *  Added 2026-08-22 for a split-screen game, the first consumer of this
   *  loop that draws two viewports into one surface.
   *
   *  WHAT WAS WRONG. `resize()` hard-wrote `ctx.camera.aspect = w / h`. That
   *  is right for every game that fills the panel with one camera and wrong
   *  for every view of a split one: on a 16:9 panel it hands a half-width view
   *  1.78 when that view's rectangle is 0.89, and the world comes back
   *  squeezed. The loop could not know better — `LoopWorld` has one camera in
   *  it and no idea a view exists — so the loop was asserting a projection it
   *  had no way to be right about.
   *
   *  WHY IT IS A PULL AND NOT A FLAG. A `boolean` saying "do not touch my
   *  camera" is a knob a game can set and then forget to honour, and the
   *  symptom of forgetting is a stretched world with nothing in the log —
   *  the least favourite shape of failure. Asking the game FOR the number
   *  makes forgetting impossible: there is exactly one write, it happens
   *  before any system's `resize()` sees the frame, and the value came from
   *  whoever actually knows the rectangle.
   *
   *  WHY NOT LEAVE IT TO `System.resize`. It would work — the systems walk
   *  runs after this write, so a system CAN overwrite it, and that game's
   *  `Views` did exactly that (per frame, guarded on the value, because its
   *  author read the loop as having no hook at all). But "the package decides
   *  wrong and the game corrects it afterwards" is the definition of a
   *  workaround, it spends a `updateProjectionMatrix()` on a matrix nobody
   *  wanted, and it leaves every system that resizes BEFORE the corrector —
   *  that game's render pipeline is systems[0] and `Views` is systems[8] —
   *  reading an aspect that is about to be thrown away.
   *
   *  READ EVERY RESIZE, NEVER CACHED, for the reason `live` and
   *  `presentEvery` are: the layout it asks about changes under the loop.
   *
   *  IT IS VALIDATED AND IT THROWS. Unlike `presentEvery`, which clamps a
   *  typo because a cadence is not correctness-critical, a non-finite or
   *  non-positive aspect makes every entry of the projection matrix NaN and
   *  the screen goes black with nothing in the console. A crash gets fixed; a
   *  plausible default gets quoted. The check covers the default arm too, so
   *  there is one rule and not two.
   */
  cameraAspect?: ((w: number, h: number) => number) | undefined;
}

type DefaultResolutionOptions = {
  resolution?: undefined;
  /** Is this presented frame one ResolutionLadder may reason about? */
  live: () => boolean;
};

type ExternalResolutionOptions = {
  resolution: LoopResolutionControl;
  /** `live` belongs to ResolutionLadder and has no meaning to another owner. */
  live?: never;
};

type WorldPipelineOptions<W> = {
  /** Common case: the pipeline renders the same world the loop advances. */
  pipeline: LoopPipeline<W>;
  present?: never;
};

type AdaptedPipelineOptions<W> = {
  /** Pipeline controls when its renderer consumes a different world shape. */
  pipeline: LoopPipelineHost;
  /** Translate the loop world into the renderer's world and submit once. */
  present: (ctx: W) => void;
};

export type GameLoopOptions<W extends LoopWorld> = GameLoopBaseOptions<W>
  & (DefaultResolutionOptions | ExternalResolutionOptions)
  & (WorldPipelineOptions<W> | AdaptedPipelineOptions<W>);

/**
 * Fades the boot curtain once a real frame is actually on screen. All three
 * games spell it identically — `#boot`, class `done`, removed after 700ms,
 * which is the transition duration in each of their `index.html`.
 */
export function dismissBootCurtain(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 700);
}

export class GameLoop<W extends LoopWorld> {
  /** Present only when GameLoop owns the default adaptive ladder. */
  readonly ladder: ResolutionLadder<W> | null;

  readonly #o: GameLoopOptions<W>;
  readonly #ctx: W;
  readonly #pipeline: LoopPipelineHost;
  readonly #present: (ctx: W) => void;
  readonly #resolution: LoopResolutionControl;
  readonly #readyPolicy: LoopReadyPolicy;

  /** Did the previous rAF tick present? An interval across a skip is not a frame. */
  #lastTickPresented = false;
  #renderFailures = 0;
  /** Set between context loss and a completed restore; nothing runs meanwhile. */
  #suspended = false;
  /**
   * True while the display surface is unusable (hidden pane, background tab,
   * mid-layout). The frame loop skips presenting rather than pushing a frame
   * built from stale or degenerate buffers.
   */
  #surfaceValid = true;
  #resizeQueued = false;
  /**
   * Ticks skipped since the last present, for `presentEvery`. Reset on every
   * present, INCLUDING the ones the ladder's stall drain or an invalid surface
   * caused — a paced counter that keeps climbing across an unrelated skip
   * would present twice in a row and then hold for three, which reads as a
   * stutter rather than as a lower frame rate.
   */
  #pacedSkips = 0;
  /** Was the tick before this present skipped by `presentEvery`? See Ladder. */
  #lastSkipWasPaced = false;
  /**
   * `performance.now()` at the last present.
   *
   * `raw` is the interval since the previous rAF TICK, which is the interval
   * between presented frames only when the previous tick presented — which is
   * exactly the condition `lastTickPresented` gates on. A paced present has by
   * definition skipped one or more ticks, so `raw` would report 16.7 ms for a
   * cadence the viewer is seeing at 33.4, and the health readout would be
   * wrong in the flattering direction. This is what the paced interval is
   * measured from instead.
   */
  #lastPresentNow = performance.now();
  #overlayHeld = false;
  #last = performance.now();
  #started = false;
  #readyPublished = false;
  #successfulPresents = 0;
  #pacedSkipsTotal = 0;

  /**
   * ==========================================================================
   *  WHO IS CALLING `#frame`, AND THERE MUST ONLY EVER BE ONE OF THEM.
   * ==========================================================================
   * `null` is `window.requestAnimationFrame`, which is every frame this loop
   * has ever run. A non-null source is something that has taken the clock — in
   * practice `renderer.setAnimationLoop` while a WebXR session is presenting;
   * see `LoopFrameSource` in Host.ts for why that is not optional in a headset.
   *
   * THE HANDLE IS KEPT BECAUSE STOPPING IS THE HARD HALF. Handing the clock
   * over is one call. Getting it back means telling the source to stop BEFORE
   * re-arming rAF, or the session's last queued callback and the first window
   * one both land and the world advances twice in one display frame. Both
   * directions are one method on one object, so neither can be half-done.
   */
  #source: LoopFrameSource | null = null;
  /**
   * The outstanding `requestAnimationFrame` id, or 0 for none.
   *
   * Tracked ONLY so a handover can cancel it. `#frame` re-arms at the top, so
   * without this there is always exactly one callback in flight that
   * `setAnimationLoop` cannot see and nothing can call off — and it would fire
   * once, from `window`, on top of the session's first frame.
   */
  #rafId = 0;

  constructor(o: GameLoopOptions<W>) {
    this.#o = o;
    this.#ctx = o.ctx;
    this.#pipeline = o.pipeline;
    if (o.present !== undefined) {
      this.#present = o.present;
    } else if ('render' in o.pipeline && typeof o.pipeline.render === 'function') {
      this.#present = (ctx) => o.pipeline.render(ctx);
    } else {
      throw new TypeError('[loop] a control-only pipeline requires present(ctx)');
    }
    this.#readyPolicy = o.readyPolicy ?? {
      minFrame: READY_FRAME,
      minSuccessfulPresents: 1,
    };
    if (!Number.isInteger(this.#readyPolicy.minFrame) || this.#readyPolicy.minFrame < 1
      || !Number.isInteger(this.#readyPolicy.minSuccessfulPresents)
      || this.#readyPolicy.minSuccessfulPresents < 1) {
      throw new RangeError(
        '[loop] readyPolicy requires positive integer minFrame and minSuccessfulPresents',
      );
    }

    if (o.resolution !== undefined) {
      this.ladder = null;
      this.#resolution = o.resolution;
    } else {
      const ladder = new ResolutionLadder<W>({
        pipeline: o.pipeline,
        world: o.ctx,
        handheld: () => device().handheld,
        search: o.search ?? (typeof location === 'undefined' ? '' : location.search),
      });
      this.ladder = ladder;
      this.#resolution = {
        owner: '@homie-rocks/loop/ResolutionLadder',
        applyPin: () => ladder.applyPin(),
        reset: () => ladder.reset(),
        skipPresent: () => {
          if (ladder.skipRender <= 0) return false;
          ladder.skipRender--;
          return true;
        },
        afterPresent: (frame) => ladder.onPresented(frame),
        health: () => ({ ...ladder.health() }),
      };
    }
  }

  // ── the surface ────────────────────────────────────────────────────────────
  /**
   * The size the canvas will actually be displayed at, in CSS pixels.
   *
   * Measured off `#app` (which is `position: fixed; inset: 0`) rather than read
   * from `innerWidth`/`innerHeight`, and that is a mobile correctness fix, not a
   * tidy-up. On iOS Safari `innerHeight` tracks the VISUAL viewport — it shrinks
   * and grows as the URL bar collapses, mid-gesture, by ~60 px — while a
   * `position: fixed` element is laid out against the LAYOUT viewport and does
   * not move. `renderer.setSize(w, h, true)` writes inline `style.width/height`
   * in pixels, which beats the stylesheet's `width: 100%`, so sizing from
   * `innerHeight` pinned the canvas to the smaller of the two and left an
   * unpainted strip along the bottom of the screen: a black band across part of
   * the frame, appearing and disappearing as the player scrolled their thumb.
   * That is one of the "black partial renders", and it is invisible on desktop
   * because there the two viewports are the same thing.
   *
   * Measuring the element we are about to fill has no such ambiguity, and on
   * desktop it returns exactly what `innerWidth`/`innerHeight` did.
   *
   * It does, however, introduce a failure the window never had: an ELEMENT can
   * measure zero. A `display:none` ancestor, a collapsed pane, a tab in the
   * background, or simply being read mid-layout all return 0, and the old
   * `Math.max(1, ...)` dutifully turned that into a 1x1 canvas — resizing the
   * drawing buffer AND every composer render target down to a single pixel.
   * Observed live: `canvas 2x2, css 1x1`. Coming back from that costs at least
   * one presented frame sourced from a one-pixel buffer, which is a black or
   * part-black flash. A `ResizeObserver` on the element fires on every one of
   * those transitions, so it happens often.
   *
   * So a degenerate measurement is not a size — it is the absence of one. Return
   * null and let the caller keep what it had.
   */
  viewportSize(): { w: number; h: number } | null {
    return viewportSize(this.#o.parent);
  }

  /**
   * Resize events are coalesced to one per animation frame and dropped entirely
   * when the size has not moved.
   *
   * iOS Safari fires `resize` continuously — dozens of events — while the URL bar
   * animates, on rotation, and whenever the on-screen keyboard appears. Each one
   * used to reach `composer.setSize`, which reallocates the HDR input and output
   * buffers, the AO targets, the entire bloom mip chain, the bokeh targets and
   * the SMAA buffers. Tens of megabytes of GPU allocation, tens of times, inside
   * one thumb gesture, on the device the player says crashes after ten seconds.
   *
   * `visualViewport` is listened to as well as `window`, because on iOS it is the
   * one that reports the URL-bar movement — and a `ResizeObserver` on `#app`
   * catches anything neither of them announces.
   */
  installResizeListeners(): void {
    const queue = () => {
      if (this.#resizeQueued) return;
      this.#resizeQueued = true;
      requestAnimationFrame(() => { this.#resizeQueued = false; this.resize(); });
    };
    addEventListener('resize', queue);
    addEventListener('orientationchange', queue);
    visualViewport?.addEventListener('resize', queue);
    if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(this.#o.parent);
  }

  /**
   * @param force push the size through even when it has not changed. Boot needs
   *   this: `ctx.width`/`ctx.height` are seeded from the same measurement, so an
   *   unconditional early-out would mean no system ever received its first
   *   `resize()` and every layout that is only computed there — the HUD's safe
   *   area, the minimap box — would keep whatever it guessed at construction.
   */
  resize(force = false): void {
    const ctx = this.#ctx;
    const size = this.viewportSize();
    if (size === null) {
      // Hidden or collapsed. Deliberately do NOT resize: tearing the buffers down
      // to 1x1 is what produced the black flash. Keep everything as it is and
      // wait to be shown again.
      this.#surfaceValid = false;
      return;
    }
    const { w, h } = size;
    const wasInvalid = !this.#surfaceValid;
    this.#surfaceValid = true;
    if (!force && !wasInvalid && w === ctx.width && h === ctx.height) return;
    ctx.width = w;
    ctx.height = h;
    // THE GAME MAY OWN THIS NUMBER. See `cameraAspect` above: the surface is
    // only the camera's rectangle when there is one camera. The write happens
    // here, before the systems walk, so nothing downstream ever reads an
    // aspect that is about to be corrected.
    const aspect = this.#o.cameraAspect === undefined ? w / h : this.#o.cameraAspect(w, h);
    if (!Number.isFinite(aspect) || aspect <= 0) {
      throw new RangeError(
        `[loop] camera aspect ${String(aspect)} is not a positive finite number ` +
        `(surface ${w}x${h}). Every entry of the projection matrix would be NaN ` +
        'and the screen would go black with nothing in the console.');
    }
    ctx.camera.aspect = aspect;
    ctx.camera.updateProjectionMatrix();
    for (const s of this.#o.systems) s.resize?.(w, h);
  }

  // ── the overlay ────────────────────────────────────────────────────────────
  /**
   * THE RENDERER IS NOT THE WHOLE PICTURE. A game's menus can be DOM, and CSS
   * keyframe animations (one title screen had four: rotating rays, a breathe,
   * a slot pulse and a stage entrance) plus the screen's transitions run off
   * the COMPOSITOR's clock, which `__freeze` cannot reach: with the simulation
   * provably still, two screenshots of the held title screen differed by mean
   * |delta| 0.33 over 9% of pixels, almost all of it the slowly rotating logo
   * rays. A hold has to stop the overlay too, or a held capture can never be
   * the same bytes twice.
   *
   * It RESETS as well as pauses, and that half is load-bearing: a hold begins at
   * whatever wall time boot happened to finish, so pausing in place would
   * photograph a different phase of a 42-second rotation on every run, and a
   * recorded baseline could never match the run after it. Infinite animations are
   * parked at zero; finite ones at their END, because a menu that has finished
   * sliding in is what that screen actually looks like — and that is also why
   * only the infinite ones are restarted on release.
   *
   * A game with no CSS animation at all outside its boot curtain gets an empty
   * `getAnimations()` and this is a no-op. That is why it is unconditional
   * rather than a flag: there is no game for which holding the world but not
   * the overlay is the correct behaviour.
   */
  #holdOverlay(hold: boolean): void {
    this.#overlayHeld = hold;
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming().endTime;
      const finite = typeof end === 'number' && Number.isFinite(end);
      try {
        if (hold) { a.currentTime = finite ? (end as number) : 0; a.pause(); }
        else if (!finite) a.play();
      } catch {
        // An animation can be cancelled by a DOM change between the list being
        // taken and this line. Nothing to hold; nothing to report.
      }
    }
  }

  // ── context loss ───────────────────────────────────────────────────────────
  /**
   * `RenderPipeline` handles the GL side — `preventDefault()` on the loss event
   * (without which the browser never offers a restore at all), tearing down the
   * composer, and rebuilding it against the new context. What is left here is
   * everything above the pipeline:
   *
   *   - the frame loop, which must stop on the same tick the context goes;
   *   - the game's `restore()`, which is the one GPU resource three cannot
   *     re-derive: the PMREM environment probe. Its texture is reallocated
   *     automatically but comes back EMPTY, because its contents were rendered
   *     once at boot — every metal, every clearcoat and every water surface in
   *     the game would come back reflecting black. The shader pre-warm goes with
   *     it, because the program cache died with the context.
   */
  installContextRecovery(): void {
    // Compose callbacks that were registered while the game built its GPU
    // resources. Replacing them made the first registrant silently disappear;
    // a base-building game's once-baked environment probe is the measured
    // counterexample.
    const priorLost = this.#pipeline.onContextLost;
    const priorRestored = this.#pipeline.onContextRestored;
    this.#pipeline.onContextLost = () => {
      try { priorLost?.(); } finally { this.#suspended = true; }
    };
    this.#pipeline.onContextRestored = async () => {
      try {
        await priorRestored?.();
      } catch (err) {
        console.error('[restore] an existing GPU-resource callback failed', err);
      }
      try {
        await this.#o.restore?.();
      } catch (err) {
        console.error('[restore] the game could not rebuild its GPU resources', err);
      }
      // Hand the simulation a fresh clock. Without this the first frame back sees
      // however many seconds the restore took as its delta — the clamp in the
      // loop stops it teleporting anything, but the watchdog would read that one
      // frame as a catastrophic stall and start skipping presents on a pipeline
      // that is in fact perfectly healthy.
      this.#last = performance.now();
      this.#lastTickPresented = false;
      this.#resolution.reset?.();
      this.#renderFailures = 0;
      this.#suspended = false;
    };
  }

  // ── the loop ───────────────────────────────────────────────────────────────
  /**
   * Apply `?scaler=` and start the rAF chain. Idempotent: a second call is a
   * no-op rather than a second loop, because two rAF chains on one context is
   * two of everything and reads as a game running at double speed.
   *
   * IT DOES NOT RE-SEED `#last`, AND THAT IS NOT AN OVERSIGHT. The games set
   * `let last = performance.now()` at MODULE scope, so the first frame's raw
   * delta spans the whole of boot and `dt` is the 1/20 clamp rather than a
   * vsync. `ctx.time` therefore starts 34 ms further on than it looks like it
   * should — and `ctx.time` is what the grade's grain, the sky and the water
   * are sampled at. Re-seeding here would shift every held frame in every game
   * by that much, which a screenshot comparison reads as a different photograph.
   * Construct the loop at module scope, as the games do, and the clock matches.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#resolution.applyPin?.();
    this.#armRaf();
  }

  /**
   * Arm the next `window` frame — and only when `window` is still the clock.
   *
   * Split out of `#frame` for one reason: the re-arm is the line that has to
   * stop happening when a source takes over, and a condition at the top of a
   * 150-line method is a condition somebody moves.
   */
  #armRaf(): void {
    if (this.#source !== null) return;
    this.#rafId = requestAnimationFrame(this.#frame);
  }

  /**
   * ==========================================================================
   *  HAND THE FRAME CLOCK TO SOMETHING ELSE, OR TAKE IT BACK.
   * ==========================================================================
   * The whole of WebXR support in this package, and it is one swap.
   *
   * `requestAnimationFrame` does not fire inside an immersive session (see
   * `LoopFrameSource`), so a game that enters VR without this simply STOPS on
   * the frame the session starts, with the last picture it drew frozen in front
   * of somebody's eyes. `@homie-rocks/render/xr.ts` calls this with the renderer on
   * `sessionstart` and with `null` on `sessionend`; nothing else in these
   * packages calls it, and a game that never enters VR never reaches this
   * method at all.
   *
   * -------------------------------------------------------------------------
   * WHY THIS IS A SWAP AND NOT `setAnimationLoop` ALL THE TIME.
   * -------------------------------------------------------------------------
   * three's `setAnimationLoop` DOES fall back to `window.requestAnimationFrame`
   * when no session is presenting — read, not assumed, in three 0.185.1's
   * source — so "use it always" would work, and it is what three's
   * own documentation advises. It is not what this does, for three measured
   * reasons:
   *
   *   1. `WebGLAnimation` re-arms AFTER the callback returns; `#frame` re-arms
   *      BEFORE. That difference decides whether a frame that overruns its
   *      budget queues the next one behind itself or beside itself, which is
   *      the exact behaviour `start()`'s header says a screenshot comparison
   *      reads as a different photograph. Changing it for every game, to
   *      benefit the one in a headset, is the trade nobody asked for.
   *   2. The loop would need a renderer before it could tick. `ctx.renderer` is
   *      null until the pipeline's `init` runs, and a Node test drives the
   *      shipped ladder against a fake renderer that has no such method.
   *   3. A game with no headset pays nothing. Non-VR is not merely unchanged,
   *      it is the same statements in the same order it has always been.
   *
   * -------------------------------------------------------------------------
   * THE CLOCK IS RE-SEEDED ON BOTH EDGES AND THAT IS NOT A TIDY-UP.
   * -------------------------------------------------------------------------
   * Entering a session takes as long as the runtime takes — hundreds of
   * milliseconds, sometimes a permission prompt. Leaving is the same. The gap
   * either side is NOT a frame interval, and handing it to the ladder is the
   * same reading `installContextRecovery` re-seeds `#last` to avoid: one frame
   * that looks like a catastrophic stall, on a pipeline that is perfectly
   * healthy, followed by presents being skipped to fix a problem nobody has.
   */
  driveWith(source: LoopFrameSource | null): void {
    if (source === this.#source) return;
    // Stop the OLD clock first, in both directions. Two live sources for one
    // tick is one tick of double-speed world, and it lands exactly on the
    // frame somebody puts a headset on — the least observable moment there is.
    if (this.#source !== null) this.#source.setAnimationLoop(null);
    if (this.#rafId !== 0) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
    this.#source = source;
    // See the header: the handover gap is not an interval anybody saw.
    this.#last = performance.now();
    this.#lastTickPresented = false;
    this.#lastSkipWasPaced = false;
    this.#pacedSkips = 0;
    this.#resolution.reset?.();
    if (source !== null) {
      source.setAnimationLoop(this.#frame);
    } else if (this.#started) {
      // Only if we were ever running. `driveWith(null)` before `start()` must
      // not quietly become a second way to start the game.
      this.#armRaf();
    }
  }

  /** Is something other than `window` supplying frames? See `driveWith`. */
  get externallyDriven(): boolean {
    return this.#source !== null;
  }

  #frame = (now: number): void => {
    this.#armRaf();
    const ctx = this.#ctx;

    /*
     * A context restore can finish between Chrome minting an rAF timestamp and
     * invoking its callback. The restore path seeds #last from performance.now,
     * so that already-queued callback is legitimately older. A frame interval
     * cannot be negative: report zero and, critically, do not move #last
     * backwards or the following frame would inherit the restore gap.
     */
    const elapsed = now - this.#last;
    const raw = Math.max(0, elapsed) / 1000;
    if (elapsed >= 0) this.#last = now;

    // Context gone, or the tab is not being composited. Do not simulate, do not
    // draw, do not allocate — just keep the rAF alive so we notice when the world
    // comes back. (A hidden tab on iOS is the single most likely moment for the
    // GPU to reclaim our context, and continuing to queue frames into a surface
    // nobody is presenting is the worst possible way to spend that window.)
    //
    // `document.hidden` IS NOT ASKED WHILE SOMETHING ELSE OWNS THE CLOCK, and
    // that exception is the difference between VR working and a black headset.
    // A browser that hands a page to a headset is entitled to call the 2D page
    // hidden — it is not on any screen a person is looking at — and some do.
    // The window's own rAF is throttled or stopped in that state, which is
    // precisely why the session supplies its own; so a callback ARRIVING from
    // the source is itself the proof that somebody is being shown these frames,
    // and it is better evidence than the flag. Asking a question whose answer is
    // about a surface we are no longer drawing to is trusting a cached fact.
    // Ask, do not remember — and here the asking is the tick.
    const composited = this.#source !== null || !document.hidden;
    if (this.#suspended || !composited || this.#pipeline.contextLost) {
      // The next tick's rAF delta spans however long we were away, which is not a
      // frame interval. Say so, or the ladder reads a backgrounded tab as a stall.
      this.#lastTickPresented = false;
      // And it is not a PACED interval either. The `intervalMs < 100` guard in
      // the ladder already rejects a ten-second hole, so this is belt and
      // braces — but a flag that says "we chose this gap" must not survive a gap
      // nobody chose, whether or not something downstream happens to catch it.
      this.#lastSkipWasPaced = false;
      this.#pacedSkips = 0;
      return;
    }

    // Clamp so a stalled tab or a breakpoint never teleports anything.
    // `__freeze` holds the simulation still while a screenshot tool retries a
    // torn capture: rendering continues, so the compositor can produce a clean
    // frame, but nothing advances — otherwise a retry lands seconds down the road
    // and the shot no longer shows what it was aimed at.
    const frozen = (window as unknown as { __freeze?: boolean }).__freeze === true;
    // Re-applied on every held frame, not just on the edge, so an element that
    // appears while the world is held is held too. Cheap: a dozen animations.
    if (frozen || this.#overlayHeld) this.#holdOverlay(frozen);
    const clamped = Math.min(raw, 1 / 20);
    const input: LoopClockInput = { now, raw, clamped, held: frozen };
    const sample = this.#o.clock?.(ctx, input) ?? {
      dt: frozen ? 0 : clamped,
      advance: frozen ? 0 : clamped,
    };
    if (!Number.isFinite(sample.dt) || sample.dt < 0 || !Number.isFinite(sample.advance)) {
      throw new RangeError(
        `[loop] clock returned dt=${String(sample.dt)}, advance=${String(sample.advance)}; ` +
        'dt must be non-negative and both values must be finite',
      );
    }
    ctx.dt = sample.dt;
    ctx.time += sample.advance;
    ctx.frame++;
    const frame: LoopFrame = { ...input, ...sample };

    const t0 = performance.now();

    for (const s of this.#o.systems) s.update?.(ctx, sample.dt);
    this.#o.tick?.(ctx, frame);
    for (const s of this.#o.systems) s.lateUpdate?.(ctx, sample.dt);

    // A screenshot tool is entitled to a present on every frozen frame — retrying a
    // torn capture is the whole reason `__freeze` exists — and so are the first
    // few frames, which is where `__gameReady` and the boot curtain are decided.
    //
    // AND SO IS EVERY FRAME A HEADSET ASKED FOR, WHICH IS A COMFORT DECISION
    // AND NOT A PERFORMANCE ONE. On a flat panel a skipped present is a dropped
    // frame: the picture is one frame old and a person notices it as judder. In
    // a headset the compositor REPROJECTS the last submitted frame to the head
    // pose it has now — so the world keeps tracking, nothing looks obviously
    // wrong, and what the person actually gets is their own movement rendered
    // at half rate against a static scene. That is the classic recipe for
    // simulator sickness, and it is invisible to every instrument here. The
    // three skip paths below all exist to spend less GPU; in a session the
    // thing being spent is somebody's stomach, so the answer is to draw the
    // frame and let the resolution ladder — which is suspended in a session
    // anyway, see `@homie-rocks/render/xr.ts` — not be the one making the trade.
    const maySkip = !frozen && this.#source === null && ctx.frame > WATCHDOG_FROM_FRAME;
    // See `GameLoopOptions.presentEvery`. Clamped up rather than rejected, and
    // resolved before the chain below so a cadence of 1 costs one call and one
    // comparison — which is what every existing consumer pays for this field.
    const askedPace = this.#o.presentEvery?.() ?? 1;
    const pace = Number.isFinite(askedPace) ? Math.max(1, Math.round(askedPace)) : 1;
    let presented = false;
    let pacedSkip = false;
    // Nothing usable can be presented onto a surface that is hidden or collapsed,
    // and attempting it is how a one-pixel buffer reaches the compositor. The
    // simulation keeps running; only the present is withheld.
    if (!this.#surfaceValid && maySkip) {
      // no present this frame
    } else if (maySkip && this.#resolution.skipPresent?.() === true) {
    } else if (pace > 1 && maySkip && this.#pacedSkips + 1 < pace) {
      // Deliberate. LAST in the skip chain on purpose: a stall drain and a
      // degenerate surface are both saying the frame cannot be presented, and
      // this one is only saying it need not be — so it must never consume the
      // turn one of those two was going to take.
      this.#pacedSkips++;
      this.#pacedSkipsTotal++;
      pacedSkip = true;
    } else {
      presented = true;
      let presentSucceeded = false;
      try {
        this.#present(ctx);
        presentSucceeded = true;
        this.#renderFailures = 0;
        this.#o.frameWatch?.afterPresent(ctx);
        // Scene draws only — the post chain's fullscreen quads always run, so
        // counting everything would mask exactly the failure we are watching for.
        this.#o.diagnostics?.afterPresent(ctx, this.#sceneDrawCalls());
      } catch (err) {
        this.#renderFailures++;
        console.error(`[frame] render threw (${this.#renderFailures} in a row)`, err);
        // A chain that throws once per frame is a black rectangle with a busy
        // CPU. Retreat to the direct render — which is a real, legible frame —
        // rather than keep failing in a more sophisticated way.
        if (this.#renderFailures === 4) {
          this.#pipeline.disablePostProcessing('render threw four frames running');
        }
        if (this.#renderFailures >= 24) {
          console.error('[frame] renderer is not recoverable; suspending the loop');
          // The last frame that did draw stays on screen underneath. A stale
          // picture of the game with an explanation over it is a far better
          // failure than a black rectangle and a pegged CPU.
          this.#pipeline.announce('Graphics stopped', 'Reload the page to start again.');
          this.#suspended = true;
        }
      }
      if (presentSucceeded) this.#successfulPresents++;
    }

    if (presented) {
      // Only a present whose gap was OURS. A present after a stall drain or a
      // hidden surface is not paced, however low the cadence is set — those are
      // the readings the ladder exists to act on.
      const paced = this.#lastSkipWasPaced;
      this.#resolution.afterPresent?.({
        cost: performance.now() - t0,
        // See `#lastPresentNow`: on a paced frame the tick interval is not the
        // interval anybody saw.
        intervalMs: paced ? now - this.#lastPresentNow : raw * 1000,
        live: this.#o.live?.() ?? false,
        lastTickPresented: this.#lastTickPresented,
        frozen,
        paced,
      });
      this.#pacedSkips = 0;
      this.#lastPresentNow = now;
    }
    this.#lastSkipWasPaced = pacedSkip;
    this.#lastTickPresented = presented;

    if (!this.#readyPublished
      && ctx.frame >= this.#readyPolicy.minFrame
      && this.#successfulPresents >= this.#readyPolicy.minSuccessfulPresents) {
      this.#readyPublished = true;
      (window as unknown as { __gameReady: boolean }).__gameReady = true;
      (this.#o.onReady ?? dismissBootCurtain)();
    }
  };

  /**
   * Draw calls attributable to the SCENE, not the post chain.
   *
   * `renderer.info.render.calls` is reset by three at the top of every
   * `render()`, and the composer's final fullscreen pass is the last one in the
   * frame — so sampling after `composer.render()` reports the quad and nothing
   * else. The pipeline records the scene-pass count for us; fall back to the raw
   * counter when there is no composer.
   */
  #sceneDrawCalls(): number {
    const recorded = this.#pipeline.lastSceneCalls;
    if (typeof recorded === 'number') return recorded;
    return this.#ctx.renderer?.info.render.calls ?? 0;
  }

  /**
   * Watchdog state, for perf and soak tests: how many frames overran,
   * and what resolution rung the adaptive scaler has settled on. Published by
   * each game as `window.__loopHealth`.
   */
  health(): GameLoopHealth {
    return {
      frame: this.#ctx.frame,
      presents: this.#successfulPresents,
      pacedSkips: this.#pacedSkipsTotal,
      ...this.#resolution.health(),
      renderFailures: this.#renderFailures,
      suspended: this.#suspended,
      contextLost: this.#pipeline.contextLost,
      externallyDriven: this.#source !== null,
    };
  }
}

/** Free function form, for `main.ts` seeding `ctx.width` before the loop exists. */
export function viewportSize(parent: HTMLElement): { w: number; h: number } | null {
  let w = Math.round(parent.clientWidth || 0);
  let h = Math.round(parent.clientHeight || 0);
  // The element measuring zero does not mean the window has; fall back before
  // giving up, which covers being read mid-layout.
  if (w < MIN_SURFACE || h < MIN_SURFACE) {
    w = Math.round(innerWidth || 0);
    h = Math.round(innerHeight || 0);
  }
  if (w < MIN_SURFACE || h < MIN_SURFACE) return null;
  return { w, h };
}

/**
 * The size to build a camera with at module scope, before anything is laid out.
 *
 * At module scope the element may not be laid out yet, and `viewportSize()`
 * correctly refuses to invent a size. A real one arrives from `resize(true)`
 * during boot; this only has to be non-degenerate so the camera can be built.
 */
export function initialViewport(parent: HTMLElement): { w: number; h: number } {
  return viewportSize(parent) ?? {
    w: Math.max(MIN_SURFACE, innerWidth || 1280),
    h: Math.max(MIN_SURFACE, innerHeight || 720),
  };
}
