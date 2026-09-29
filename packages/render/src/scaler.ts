/**
 * ============================================================================
 *  ResolutionScaler — the adaptive rung ladder, as a state machine with no GL.
 * ============================================================================
 *
 *  The engine plan listed `ResolutionScaler` under `@homie-rocks/render` and it
 *  had never been written. A base-building game's renderer carried it inline,
 *  wound through a frame-statistics record, a composer and a film layer, which
 *  is why repeated duplication counting never saw it: it is one copy, and one
 *  copy of a mechanism is still a mechanism.
 *
 *  ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 *  IT IS NOT `@homie-rocks/loop/Ladder.ts` AND THE TWO MUST NOT MERGE. That one is a
 *  QUALITY ladder driven from a game's main loop: it watches a render-cost EMA
 *  and a live/not-live flag, drops effects and rungs together, and calls
 *  `pipeline.setDynamicScale`. This is the RESOLUTION half alone, driven from
 *  inside the renderer off wall-clock frame time, and it exists because
 *  that game's renderer owns its own buffer size. A shared `Ladder` would
 *  compile, pass everything, and quietly give one game the other's trigger.
 *
 *  IT ALSO DOES NOT TOUCH A RENDERER. `frame()` returns whether the rung moved
 *  and the caller re-applies its own resolution — so a Node test can drive a
 *  thousand synthetic frames through the exact state machine the game runs,
 *  with no browser anywhere, which is what its probe does.
 *
 *  ── THE TWO PROPERTIES THAT ARE MEASUREMENTS, NOT PREFERENCES ───────────────
 *
 *  1. THE WINDOW EXISTS BECAUSE ONE FRAME IS NOISE. At 60 Hz vsync only ever
 *     hands back ~16.7 or ~33.4 ms, so the MEDIAN frame time of a build running
 *     at 48 fps is exactly 16.70 and reads as a perfect pass. The decision is
 *     made on the MEAN of a window, and the frames that took two vsyncs are
 *     counted separately.
 *
 *  2. THE PIN IS A CORRECTNESS FEATURE AND IT MUST BE READABLE. A scaler that
 *     spends resolution to protect frame rate is right for a player and ruinous
 *     for a measurement: an optimisation that genuinely saves 2 ms lets the
 *     ladder hold a higher rung, so it draws MORE pixels and reports the same
 *     fps — the saving is real and completely invisible. `pinned` is therefore
 *     public state a test asserts rather than assumes. `held` pins it too, per
 *     frame: a capture tool holds the world still and then shoots, and a ladder
 *     that moved between the accept check and the shutter would change the
 *     resolution of the frame being judged.
 *
 *  THIS FILE IMPORTS NOTHING — not three, not the pipeline. Arrived from a
 *  base-building game; nothing in it was lunar.
 * ============================================================================
 */

/**
 * Every number the ladder runs on. No defaults, on `BootSpec`'s reasoning: a
 * game that forgets one should fail to compile rather than inherit another
 * game's rung table.
 */
export interface ScalerSpec {
  /**
   * The rungs, descending, index 0 first. Each entry multiplies the effective
   * pixel ratio; what a rung COSTS is the caller's arithmetic, not this file's.
   */
  rungs: readonly number[];
  /** Frames per decision window. */
  window: number;
  /** Window mean above this drops a rung. */
  downMs: number;
  /** Window mean below this counts as a good window. */
  upMs: number;
  /** Consecutive good windows before a rung is given back. */
  upWindows: number;
  /** Wall-clock quiet period after any move, so the ladder cannot oscillate. */
  cooldownMs: number;
  /** A frame at least this long took two vsyncs. Counted, never averaged in. */
  longFrameMs: number;
}

/** What a closed window measured. `closed` is false on every other frame. */
export interface ScalerWindow {
  closed: boolean;
  /** Mean frame time over the window, ms. Zero until the first window closes. */
  meanMs: number;
  /** Frames in the window that took two vsyncs. */
  longFrames: number;
  /** 1000 / meanMs, or 0. */
  fps: number;
  /** True when this window moved the rung — the caller must re-apply resolution. */
  moved: boolean;
}

export class ResolutionScaler {
  private readonly spec: ScalerSpec;
  private sum = 0;
  private count = 0;
  private long = 0;
  private goodWindows = 0;
  private lastMoveAt = 0;

  /** Index into `spec.rungs`. Public because a test reads it. */
  index = 0;
  /** Hard pin. See property 2 in the header; a test asserts this. */
  pinned = false;

  constructor(spec: ScalerSpec) {
    if (spec.rungs.length < 1) throw new RangeError('ResolutionScaler: no rungs');
    if (!(spec.window >= 1)) {
      throw new RangeError(`ResolutionScaler: window must be >= 1, got ${spec.window}`);
    }
    this.spec = spec;
  }

  /** The current rung's multiplier. */
  scale(): number {
    return this.spec.rungs[this.index] as number;
  }

  /**
   * Fold one frame in, and decide at the end of a window.
   *
   * `now` is wall clock in ms — the same clock `cooldownMs` is measured in —
   * and `dtMs` is that frame's real elapsed time. `held` pins the ladder for
   * this frame only; `pinned` pins it until somebody unpins it.
   *
   * A HELD FRAME IS STILL SAMPLED. The window keeps filling while the world is
   * frozen, because a capture that holds for two hundred frames should not
   * leave the ladder with a stale mean the moment it resumes — what `held`
   * suppresses is the MOVE, which is the thing that would change the resolution
   * of a frame being judged.
   */
  frame(now: number, dtMs: number, held: boolean): ScalerWindow {
    this.sum += dtMs;
    this.count++;
    if (dtMs > this.spec.longFrameMs) this.long++;
    if (this.count < this.spec.window) {
      return { closed: false, meanMs: 0, longFrames: 0, fps: 0, moved: false };
    }

    const meanMs = this.sum / this.count;
    const longFrames = this.long;
    this.sum = 0;
    this.count = 0;
    this.long = 0;

    const moved = this.decide(now, meanMs, held);
    return { closed: true, meanMs, longFrames, fps: meanMs > 0 ? 1000 / meanMs : 0, moved };
  }

  private decide(now: number, meanMs: number, held: boolean): boolean {
    if (this.pinned || held) return false;
    if (meanMs < this.spec.upMs) this.goodWindows++;
    else this.goodWindows = 0;
    if (now - this.lastMoveAt < this.spec.cooldownMs) return false;

    if (meanMs > this.spec.downMs && this.index < this.spec.rungs.length - 1) {
      this.index++;
    } else if (this.goodWindows >= this.spec.upWindows && this.index > 0) {
      this.index--;
      this.goodWindows = 0;
    } else {
      return false;
    }
    this.lastMoveAt = now;
    return true;
  }
}
