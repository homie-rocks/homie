/**
 * ===========================================================================
 *  @homie-rocks/loop/Host.ts — the fields the loop reads, instead of the context.
 * ===========================================================================
 *
 * Same seam, same reason, as `@homie-rocks/diagnostics/Host.ts`. The frame
 * loop and the resolution ladder used to live in each game's `main.ts` and
 * took the game's own `Ctx`, which carries `race`, `track`, `items`, `match`,
 * `combat`, `player`, `map` and `bus`. An engine package may not know what a
 * lap is — and one `import type { Ctx }` would put every one of those nouns
 * inside the package at review time even though it costs nothing at runtime.
 *
 * So the seam is a STRUCTURE listing exactly what the loop touches:
 *
 *     LoopWorld     →  renderer, camera, width, height, time, dt, frame
 *     LoopPipelineHost → the controls the loop and ladder call
 *     LoopPipeline  →  that host plus `render(world)` for the common case
 *     LoopSystem    →  update / lateUpdate / resize, all optional
 *     LoopFrameSource → the one method something that is NOT `window` needs
 *                     in order to be where frames come from
 *
 * Every game's `Ctx` satisfies `LoopWorld` structurally, so `new GameLoop({ ctx,
 * ... })` compiles with no cast and the genre nouns stay in the game.
 *
 * NOTHING HERE IMPORTS `three`, DELIBERATELY. The loop reads `camera.aspect`,
 * calls `updateProjectionMatrix()`, calls `renderer.getContext()` and reads
 * `renderer.info.render.calls`. It uses no `instanceof`, no class and no type
 * from the library, so it cannot become the second copy of three.js — two
 * copies is two `instanceof` universes and the symptom is an object that
 * renders as nothing with no error at all. It is also what lets a Node test
 * drive the SHIPPED ladder against a fake renderer and see it descend, which
 * is the only way this controller's decisions can be watched without a GPU.
 */

/** The one thing the loop asks a renderer, plus the counter it reports. */
export interface LoopRenderer {
  /**
   * Only ever called to read `drawingBufferWidth` — the size the driver
   * actually allocated, which is what `baseCssRatio()` divides by. Optional
   * because three declares it as a method that may not exist on a lost context
   * and the games call it as `renderer?.getContext?.()`.
   */
  getContext?: () => { readonly drawingBufferWidth: number } | null | undefined;
  readonly info: { readonly render: { readonly calls: number } };
}

/**
 * ===========================================================================
 *  WHERE FRAMES COME FROM, WHEN THEY DO NOT COME FROM `window`.
 * ===========================================================================
 *
 * `requestAnimationFrame` DOES NOT FIRE INSIDE AN IMMERSIVE WebXR SESSION.
 * That is not a quirk to work around, it is the specification: while a session
 * is presenting, the headset's compositor owns the frame clock and the only
 * callback that runs at display rate is the session's own. A loop built on
 * `window.requestAnimationFrame` therefore does not merely run slowly in a
 * headset — IT STOPS, on the frame the session starts, and the last picture
 * drawn hangs in front of somebody's eyes.
 *
 * This is the seam that lets something else be the clock without this package
 * learning what a headset is. It is one method, and it is deliberately the
 * exact signature of `THREE.WebGLRenderer.setAnimationLoop`, because that is
 * the thing that actually knows: three.js routes the callback to the SESSION's
 * `requestAnimationFrame` while `renderer.xr.isPresenting`, and to `window`'s
 * otherwise. READ IN THE SOURCE OF three 0.185.1 (
 * `src/renderers/WebGLRenderer.js` and `src/renderers/webgl/WebGLAnimation.js`):
 * `setAnimationLoop` sets the callback on BOTH the window-backed
 * `WebGLAnimation` and on `xr`, and `onXRSessionStart` stops the window one —
 * so handing the loop to it is not "hoping three does the right thing", it is
 * the documented path with a read of the source behind it.
 *
 * NOTHING HERE NAMES `three`, `XRSession` OR `XRFrame`. See this file's header:
 * one type from the library and this package becomes the second copy of it.
 * A structural interface with one method costs nothing and cannot.
 */
export interface LoopFrameSource {
  /**
   * Take over the frame clock, or hand it back.
   *
   * `null` means stop: three tears down its animation, which is the ONLY way
   * to be sure the source is no longer calling — a source that keeps ticking
   * after the loop has resumed `requestAnimationFrame` is two clocks on one
   * context, which reads to a player as a game running at double speed.
   */
  setAnimationLoop(callback: ((time: number) => void) | null): void;
}

/**
 * The projection the resize path pushes a new aspect ratio into.
 *
 * WHICH aspect is `GameLoopOptions.cameraAspect`'s business, not this
 * interface's — a split-screen game's `ctx.camera` is still one perspective
 * camera, it is simply not the size of the panel.
 */
export interface LoopCamera {
  aspect: number;
  updateProjectionMatrix(): void;
}

/**
 * What a game hands the loop. Seven fields; the loop WRITES five of them
 * (`time`, `dt`, `frame`, and `width`/`height` on a resize) because they are
 * the frame's own clock and every system reads them off the same object.
 */
export interface LoopWorld {
  /** Null until the pipeline's own `init` has run. The loop tolerates that. */
  renderer: LoopRenderer | null;
  camera: LoopCamera;
  width: number;
  height: number;
  /** seconds since boot, advanced by the loop and frozen by `__freeze` */
  time: number;
  /** the clamped delta this frame, 0 while held */
  dt: number;
  /** frames the loop has run — NOT frames presented */
  frame: number;
}

/**
 * A subsystem, exactly as the games declare `System`. Every member optional:
 * the loop calls `?.` on all three and the games' arrays mix systems that
 * implement one, two or none of them.
 */
export interface LoopSystem<W = unknown> {
  update?(ctx: W, dt: number): void;
  lateUpdate?(ctx: W, dt: number): void;
  resize?(w: number, h: number): void;
}

/**
 * The render pipeline, through the eight members the loop and the ladder use.
 *
 * `lastSceneCalls` is optional because it is what `RenderPipeline` records for
 * `sceneDrawCalls()` and a pipeline without a composer legitimately has none —
 * the loop falls back to the renderer's own counter, which is correct in that
 * case and wrong in the composer case, which is why the field exists at all.
 */
export interface LoopPipelineHost {
  readonly contextLost: boolean;
  readonly dynamicScale: number;
  setDynamicScale(scale: number): void;
  disablePostProcessing(reason: string): void;
  announce(title: string, body: string): void;
  onContextLost?: (() => void) | null;
  onContextRestored?: (() => void | Promise<void>) | null;
  readonly lastSceneCalls?: number | undefined;
}

/** The common case: the loop world is also the renderer's world. */
export interface LoopPipeline<W = unknown> extends LoopPipelineHost {
  render(ctx: W): void;
}

/** `FrameWatch` — one member, called on every frame that presented. */
export interface PresentWatch<W = unknown> {
  afterPresent(ctx: W): void;
}

/** `Diagnostics` — the same hook, plus the scene-only draw-call count. */
export interface PresentDiagnostics<W = unknown> {
  afterPresent(ctx: W, sceneCalls: number): void;
}
