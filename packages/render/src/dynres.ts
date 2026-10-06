/**
 * ============================================================================
 *  Dynamic resolution as a state machine over frame times, and nothing else.
 * ============================================================================
 *
 *  `scaler.ts` is a rung ladder: it steps down a table when a window is slow
 *  and back up after enough good windows. This file is the controller a game
 *  reaches for when that is not enough, because it adds the three behaviours a
 *  ladder alone gets wrong on real devices:
 *
 *   1. **IT WAITS BEFORE IT DROPS, AND RECOVERS QUICKLY.** A drop is only
 *      taken after the frame time has been over `slowMs` for `holdMs` without
 *      a break (two seconds is the usual number), so a burst of effects or a
 *      shader compile never costs the player sharpness. Giving resolution back
 *      takes only `recoverMs` of fast frames, because a picture that stays
 *      soft after the load has gone is the more visible fault.
 *
 *   2. **IT TAKES A DROP BACK WHEN THE DROP DID NOT HELP.** Fewer pixels only
 *      buy time when the frame is bound by fill. When the game is bound by its
 *      own simulation or by draw calls, dropping makes the picture soft and
 *      leaves the frame time where it was. So every drop is a trial: the mean
 *      frame time after it is compared with the mean before, and if it did not
 *      improve by `helpedMs` the scale goes back and no drop is tried again
 *      for `lockoutMs`.
 *
 *   3. **IT DOES NOT OSCILLATE.** A recovery that is followed by a drop within
 *      `regretMs` was a recovery into load the device cannot carry, so the
 *      wait before the next recovery doubles each time that happens (up to
 *      `backoffMax` times `recoverMs`) and returns to normal once a recovery
 *      holds.
 *
 *  **IT IS A PURE FUNCTION OF THE FRAME TIMES IT IS FED.** No clock is read:
 *  time is the sum of the `dt` handed to `frame()`. So a test scripts a series
 *  of frame times and asserts the scale after each, with no browser and no
 *  renderer, and the game runs the same state machine the test did.
 *
 *  **RESIZE IMMEDIATELY BEFORE THE DRAW.** Changing a canvas or a render
 *  target's size clears it. A controller that resizes when it decides, and
 *  lets the draw happen wherever it happens, presents that cleared buffer on
 *  any frame where something yields in between: one black flash per change.
 *  `frame()` therefore only records a pending change, and {@link drawAtScale}
 *  (or `take()` in a hand-written loop) applies it in the same task as the
 *  draw that fills it.
 *
 *  This file imports nothing.
 * ============================================================================
 */

/** Every number the controller runs on. No defaults: they are a game's budget. */
export interface DynResSpec {
  /** Lowest scale it will go to. Below about 0.6 text and edges stop reading. */
  readonly floor: number;
  /** Highest scale, normally 1. */
  readonly ceiling: number;
  /** Multiplied into the scale on a drop (0.85), and divided out on a recovery step. */
  readonly step: number;

  /** Smoothed frame time above this is slow; below `fastMs` is fast. Leave a gap between them. */
  readonly slowMs: number;
  readonly fastMs: number;
  /** Time constant of the smoothing, ms. One frame is noise. */
  readonly smoothMs: number;
  /** A frame longer than this is a hitch (a hidden tab, a load) and is ignored entirely. */
  readonly hitchMs: number;

  /** How long it must stay slow before a drop, ms. */
  readonly holdMs: number;
  /** How long it must stay fast before a recovery step, ms. */
  readonly recoverMs: number;

  /** After a drop: frames skipped while the resize settles, then the length of the trial. */
  readonly settleMs: number;
  readonly trialMs: number;
  /** The mean frame time must improve by at least this for a drop to be kept, ms. */
  readonly helpedMs: number;
  /** After a drop is taken back, how long before another may be tried, ms. */
  readonly lockoutMs: number;

  /** A drop this soon after a recovery doubles the next recovery's wait, ms. */
  readonly regretMs: number;
  /** Ceiling on that doubling, as a multiple of `recoverMs`. */
  readonly backoffMax: number;
}

/** Why the scale last moved. `revert` is a drop taken back. */
export type DynResMove = 'drop' | 'recover' | 'revert';

export class DynamicResolution {
  private readonly spec: DynResSpec;
  /** The scale to draw at. Read it freely; change it only through the controller. */
  scale: number;
  /** Smoothed frame time, ms. 0 until the first frame. */
  smoothedMs = 0;
  /** The last move, or null if it has never moved. For a HUD or a test. */
  lastMove: DynResMove | null = null;
  /** True while a drop is on trial. */
  onTrial = false;
  /** Counted moves, for telemetry. */
  readonly moves = { drop: 0, recover: 0, revert: 0 };

  private pending = false;
  private slowFor = 0;
  private slowSum = 0;
  private slowN = 0;
  private fastFor = 0;
  private lockout = 0;
  private sinceRecover = Infinity;
  private backoff = 1;
  private trialAge = 0;
  private trialSum = 0;
  private trialN = 0;
  private beforeMs = 0;
  private beforeScale = 1;

  constructor(spec: DynResSpec) {
    if (!(spec.floor > 0 && spec.floor <= spec.ceiling)) throw new RangeError('DynamicResolution: 0 < floor <= ceiling');
    if (!(spec.step > 0 && spec.step < 1)) throw new RangeError('DynamicResolution: step is between 0 and 1');
    if (!(spec.fastMs < spec.slowMs)) throw new RangeError('DynamicResolution: fastMs must be below slowMs');
    this.spec = spec;
    this.scale = spec.ceiling;
  }

  /**
   * Fold in one frame's elapsed time, in milliseconds.
   *
   * @returns true when the scale changed. The change is PENDING: nothing has
   * been resized. Apply it with {@link take} or {@link drawAtScale}.
   */
  frame(dtMs: number): boolean {
    const o = this.spec;
    // A hitch is not load, and neither is a frame with no time in it.
    if (!(dtMs > 0) || dtMs > o.hitchMs) return false;

    this.smoothedMs = this.smoothedMs === 0
      ? dtMs
      : this.smoothedMs + (dtMs - this.smoothedMs) * (1 - Math.exp(-dtMs / o.smoothMs));
    if (this.lockout > 0) this.lockout -= dtMs;
    this.sinceRecover += dtMs;

    if (this.onTrial) return this.judge(dtMs);

    if (this.smoothedMs > o.slowMs) {
      this.fastFor = 0;
      this.slowFor += dtMs;
      this.slowSum += dtMs;
      this.slowN++;
      if (this.slowFor >= o.holdMs && this.lockout <= 0 && this.scale > o.floor) return this.drop();
      return false;
    }
    this.slowFor = 0; this.slowSum = 0; this.slowN = 0;

    if (this.smoothedMs < o.fastMs && this.scale < o.ceiling) {
      this.fastFor += dtMs;
      if (this.fastFor >= o.recoverMs * this.backoff) return this.recover();
      return false;
    }
    this.fastFor = 0;
    // A recovery that has held this long was a good one: forget the backoff.
    if (this.sinceRecover > o.regretMs) this.backoff = 1;
    return false;
  }

  /**
   * The scale to resize to, once, or null when nothing is pending. Call it
   * immediately before the draw and resize in the same breath: see the header.
   */
  take(): number | null {
    if (!this.pending) return null;
    this.pending = false;
    return this.scale;
  }

  /** Set the scale by hand (a settings menu, a tier change). Ends any trial. */
  reset(scale: number): void {
    const s = Math.min(this.spec.ceiling, Math.max(this.spec.floor, scale));
    this.pending = this.pending || s !== this.scale;
    this.scale = s;
    this.onTrial = false;
    this.slowFor = 0; this.slowSum = 0; this.slowN = 0; this.fastFor = 0;
    this.lockout = 0; this.backoff = 1; this.sinceRecover = Infinity;
  }

  private move(kind: DynResMove, scale: number): boolean {
    this.scale = scale;
    this.lastMove = kind;
    this.moves[kind]++;
    this.pending = true;
    return true;
  }

  private drop(): boolean {
    const o = this.spec;
    this.beforeMs = this.slowSum / Math.max(1, this.slowN);
    this.beforeScale = this.scale;
    if (this.sinceRecover <= o.regretMs) this.backoff = Math.min(o.backoffMax, this.backoff * 2);
    this.slowFor = 0; this.slowSum = 0; this.slowN = 0; this.fastFor = 0;
    this.onTrial = true;
    this.trialAge = 0; this.trialSum = 0; this.trialN = 0;
    return this.move('drop', Math.max(o.floor, this.scale * o.step));
  }

  private recover(): boolean {
    this.fastFor = 0;
    this.sinceRecover = 0;
    return this.move('recover', Math.min(this.spec.ceiling, this.scale / this.spec.step));
  }

  /** A drop is on trial: measure, then keep it or take it back. */
  private judge(dtMs: number): boolean {
    const o = this.spec;
    this.trialAge += dtMs;
    if (this.trialAge <= o.settleMs) return false;
    this.trialSum += dtMs;
    this.trialN++;
    if (this.trialAge < o.settleMs + o.trialMs) return false;

    this.onTrial = false;
    const after = this.trialSum / this.trialN;
    if (this.beforeMs - after >= o.helpedMs) return false;
    // Fewer pixels bought nothing: this frame is not bound by fill. Give the
    // sharpness back and stop asking for a while.
    this.lockout = o.lockoutMs;
    return this.move('revert', this.beforeScale);
  }
}

/**
 * Draw one frame, resizing first if the controller has a change pending.
 *
 * `resize` receives the new scale and sets the renderer's (and the post
 * chain's) size from it; `draw` renders. They run back to back, with nothing
 * between them, which is the whole point: the buffer a resize cleared is
 * filled before the browser can present it.
 */
export function drawAtScale(dr: DynamicResolution, resize: (scale: number) => void, draw: () => void): void {
  const s = dr.take();
  if (s !== null) resize(s);
  draw();
}

/**
 * Drawing-buffer size for a CSS size, a pixel ratio and a scale: whole, even,
 * and never below 2. Even because half-resolution effect buffers divide it,
 * and an odd size makes them shimmer by a pixel as the scale moves.
 */
export function bufferSize(
  cssWidth: number, cssHeight: number, pixelRatio: number, scale: number, out: { width: number; height: number },
): { width: number; height: number } {
  out.width = Math.max(2, Math.round((cssWidth * pixelRatio * scale) / 2) * 2);
  out.height = Math.max(2, Math.round((cssHeight * pixelRatio * scale) / 2) * 2);
  return out;
}
