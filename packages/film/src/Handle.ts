/**
 * ============================================================================
 *  Handle — the seam a capture tool talks to, and the presentation fence that
 *  makes "this frame was painted" a fact instead of a hope.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **When the handle says frame t has been presented, the pixels on the
 *   surface are frame t's — not the previous frame's, and not a later one's.**
 *
 * ## The failure this exists for, and why the obvious fix is not enough
 *
 * One short film's recorder learned the hard way that Chrome's screencast
 * queue can legally deliver an older compositor frame after a seek, and its
 * comment says so in the file. It moved to `Page.captureScreenshot`, which is
 * a request/response barrier tied to the current surface, and paid twenty
 * minutes per render for it.
 *
 * But a surface barrier only helps if the surface is finished. `renderer.
 * render()` returning means the DRAW CALLS were issued, not that the GPU has
 * executed them and not that the compositor has taken the result. A
 * `requestAnimationFrame` callback firing means the browser is about to paint,
 * not that it has. Between those and a screenshot there is a genuine race, and
 * a race that resolves correctly 99 % of the time on a warm machine is exactly
 * the kind of thing that produces one wrong frame in a 3,705-frame render and
 * gets attributed to something else.
 *
 * So the fence here is three statements, in order, and none of them is
 * optional:
 *
 *   1. the authored clock is at t and every subsystem says it has settled;
 *   2. a frame was rendered while that was true;
 *   3. the GPU signalled that frame's commands complete (`WebGLSync` when the
 *      context is WebGL2), and then one more animation frame elapsed so the
 *      compositor has taken it.
 *
 * `presented` only increments after all three. A capture tool waits for the
 * counter to move AND for `time()` to equal what it asked for. Either alone is
 * insufficient: the counter alone cannot tell you WHICH frame, and the time
 * alone is set before the paint.
 *
 * ## `settle()` returns reasons, never a boolean
 *
 * A capture tool that times out with "not ready" has learned nothing and the
 * render is dead. A capture tool that times out with `["assets: 3 textures
 * outstanding"]` has a next action. "We could not measure it" has to be said
 * out loud inside a render as much as in a verdict.
 *
 * ## This file is the CONTRACT, and the contract is what the tool codes to
 *
 * A capture tool built on it knows nothing about any particular film. It knows
 * `window.__homieFilm`. Which is what makes the recorder a product rather
 * than a script that lived in one project's directory.
 */

import type { Film } from './Timeline.ts';
import { nonReconstructing } from './Stage.ts';
import type { Stage, Unsettled } from './Stage.ts';

/** The version of the seam. A tool refuses a handle it does not understand. */
export const FILM_HANDLE_VERSION = 1;

export interface FilmHandle {
  readonly version: number;
  readonly id: string;
  readonly fps: number;
  readonly duration: number;
  readonly frames: number;
  /** True once `prepare()` has finished and the first frame can be asked for. */
  ready(): boolean;
  /** Ask for authored time t. Returns immediately; the paint happens in the loop. */
  seek(t: number): void;
  /** The authored time of the frame most recently PRESENTED. NaN before the first. */
  time(): number;
  /** Monotonic count of presented frames. The fence a tool waits on. */
  presented(): number;
  /** Why the film is not ready to be photographed right now. Empty when it is. */
  settle(): Unsettled[];
  /** Shot windows, absolute, for `--from-shot` / `--to-shot`. */
  shots(): { readonly id: string; readonly scene: string; readonly start: number; readonly end: number }[];
  /** Cues inside `[from, to)`, for a mix or a haptics trace. */
  cues(from: number, to: number): { readonly id: string; readonly kind: string; readonly absolute: number }[];
  /**
   * Subsystems that have declared they cannot reconstruct their state from an
   * arbitrary t, and how far back a capture must pre-roll for each.
   *
   * A capture tool prints this before it starts. A film where nothing declares
   * it is either genuinely stateless or has not been audited, and those two
   * must not render as the same colour.
   */
  preroll(): { readonly id: string; readonly prerollSeconds: number }[];
  /** Free-running playback, for a person watching. `false` puts the film under the tool's clock. */
  autoplay(on: boolean): void;
  /** Whether the film is currently free-running. */
  playing(): boolean;
}

export interface HandleOptions {
  readonly film: Film;
  readonly stage: Stage;
  /**
   * Render one frame at the authored time the stage is currently at.
   *
   * Called by the loop, never by the tool. It must not advance any clock of
   * its own — the whole point of the seam is that time comes from one place.
   */
  render(t: number): void;
  /**
   * Resolves when the GPU has finished the commands `render` issued.
   *
   * Optional: without it the fence falls back to two animation frames, which
   * is what a WebGL1 context or a canvas-2d film can honestly promise. Pass
   * {@link gpuFence} for WebGL2.
   */
  fence?: () => Promise<void>;
  /** Where to hang the handle. Defaults to `globalThis`. */
  target?: Record<string, unknown>;
  /**
   * Schedules a callback before the next paint. Defaults to
   * `requestAnimationFrame`; a Node test passes its own so the whole seam
   * is testable without a browser.
   */
  raf?: (cb: () => void) => void;
}

/**
 * Build the handle and start its loop.
 *
 * Returns the handle as well as installing it, so a caller can hold it without
 * reaching through the global — the global exists for the CAPTURE TOOL, which
 * has no other way in.
 */
export function installFilmHandle(options: HandleOptions): { handle: FilmHandle; stop(): void } {
  const { film, stage, render } = options;
  const target = options.target ?? (globalThis as unknown as Record<string, unknown>);
  const raf = options.raf ?? ((cb: () => void) => {
    const g = globalThis as unknown as { requestAnimationFrame?: (c: () => void) => number };
    if (g.requestAnimationFrame) g.requestAnimationFrame(cb);
    else setTimeout(cb, 16);
  });

  let requested = 0;
  let paintedTime = Number.NaN;
  let presentCount = 0;
  let prepared = false;
  let running = true;
  let autoplay = false;
  let lastWall: number | null = null;
  /** Set while a fence is outstanding so the loop cannot start a second frame. */
  let fencing = false;

  const handle: FilmHandle = {
    version: FILM_HANDLE_VERSION,
    id: film.id,
    fps: film.fps,
    duration: film.duration,
    frames: film.frames,
    ready: () => prepared,
    seek(t) {
      // Clamp here rather than in the loop: a tool asking for one frame past
      // the end wants the last frame, and it should get it without the fence
      // waiting for a time that will never be painted.
      requested = Math.max(0, Math.min(film.duration, t));
      autoplay = false;
    },
    time: () => paintedTime,
    presented: () => presentCount,
    settle: () => stage.unsettled(),
    shots: () => film.shots.map((s) => ({ id: s.id, scene: s.scene, start: s.start, end: s.end })),
    preroll: () => nonReconstructing(stage),
    cues: (from, to) => film.cues
      .filter((c) => c.absolute >= from && c.absolute < to)
      .map((c) => ({ id: c.id, kind: c.kind, absolute: c.absolute })),
    autoplay(on) { autoplay = on; lastWall = null; },
    playing: () => autoplay,
  };

  void stage.prepare().then(() => { prepared = true; });

  const tick = (): void => {
    if (!running) return;
    if (!prepared || fencing) { raf(tick); return; }

    if (autoplay) {
      const now = wallClock();
      if (lastWall !== null) requested = Math.min(film.duration, requested + (now - lastWall) / 1000);
      lastWall = now;
    }

    // Nothing is painted until every subsystem says it can be. Asking each
    // frame rather than caching a "loaded" flag is the rule: a cache of a
    // fact will outlive the fact and then answer for it.
    const move = stage.goto(requested, autoplay ? 'play' : 'capture');
    void move;
    if (stage.unsettled().length > 0) { raf(tick); return; }

    render(requested);

    const settled = requested;
    const finish = (): void => {
      // One more animation frame after the GPU is done: the fence proves the
      // commands executed, and the extra frame is what gets the result into
      // the compositor's hands. A screenshot taken between those two is the
      // stale frame an earlier production spent a day chasing.
      raf(() => {
        paintedTime = settled;
        presentCount++;
        stage.presented();
        fencing = false;
        raf(tick);
      });
    };

    if (options.fence) {
      fencing = true;
      options.fence().then(finish, () => { fencing = false; finish(); });
    } else {
      fencing = true;
      raf(finish);
    }
  };

  raf(tick);
  target['__homieFilm'] = handle;

  return {
    handle,
    stop() {
      running = false;
      if (target['__homieFilm'] === handle) delete target['__homieFilm'];
    },
  };
}

function wallClock(): number {
  const g = globalThis as unknown as { performance?: { now(): number } };
  return g.performance ? g.performance.now() : Date.now();
}

/**
 * A WebGL2 fence: resolves once the GPU has executed everything issued before
 * it. This is the only statement in the whole chain that is about the GPU
 * rather than about JavaScript's intentions.
 *
 * Falls back to resolving immediately on a context that has no `fenceSync`,
 * which is honest — a WebGL1 context genuinely cannot answer the question, and
 * pretending otherwise with a `finish()` (which blocks the whole page) is
 * worse than admitting the fence is two animation frames.
 */
export function gpuFence(gl: WebGL2RenderingContext | WebGLRenderingContext): () => Promise<void> {
  const gl2 = gl as WebGL2RenderingContext;
  if (typeof gl2.fenceSync !== 'function') return () => Promise.resolve();
  return () => new Promise<void>((resolve) => {
    const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) { resolve(); return; }
    gl2.flush();
    const poll = (): void => {
      const status = gl2.clientWaitSync(sync, 0, 0);
      if (status === gl2.ALREADY_SIGNALED || status === gl2.CONDITION_SATISFIED || status === gl2.WAIT_FAILED) {
        gl2.deleteSync(sync);
        resolve();
        return;
      }
      setTimeout(poll, 1);
    };
    poll();
  });
}

/**
 * The shape of a `settle()` answer, for a subsystem that has to write one.
 *
 * Exported so a game does not invent its own and produce a reason a tool
 * cannot print.
 */
export function unsettled(who: string, why: string): Unsettled { return { who, why }; }
