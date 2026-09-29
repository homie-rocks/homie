/**
 * ===========================================================================
 *  THE ADAPTIVE RESOLUTION LADDER.
 * ===========================================================================
 *
 * Lifted verbatim out of a kart racer's `main.ts`, which is where every one of
 * the measurements quoted below was taken. It was byte-identical in a space
 * racer's `main.ts` — 350 code lines with not one differing character — and
 * present in a first-person shooter's with the same numbers and a shorter set
 * of console lines.
 *
 * Everything in this file is a DECISION about a number, and every threshold
 * carries the reading that fixed it. Do not tune one without a new reading:
 * the A/B that produced `MAX_JUMP_RUNGS` scored the previous behaviour worse
 * than having no ladder at all.
 *
 * WHAT IT CANNOT SEE, AND THEREFORE WHAT THE GAME MUST SUPPLY: whether the
 * frame it is looking at is a frame the ladder is allowed to reason about.
 * `RaceState.Racing` in a racer and `MatchState.Live` in a shooter are the
 * same idea with two spellings, so the caller passes `live` per frame. That is
 * a VALUE, not a behaviour flag — the ladder does exactly the same thing with
 * it either way.
 */

import type { LoopPipelineHost, LoopWorld } from './Host.ts';

// ---------------------------------------------------------------------------
//  Render-loop watchdog
// ---------------------------------------------------------------------------
/**
 * WebGL is not synchronous. `composer.render()` returns as soon as the frame's
 * commands are queued, not when the GPU has drawn them, so a loop that keeps
 * calling it regardless of how long the last frame actually took does not
 * "run slowly" — it runs *ahead*, piling driver-side command buffers on a
 * device that is already behind. That is how a stall turns into a crash: the
 * queue is memory, and on a phone the memory is what the browser kills the tab
 * over. It is also how a frame ends up on screen half-drawn, because the
 * compositor will present whatever surface is available when its deadline
 * arrives whether or not the rasteriser has finished with it.
 *
 * So the loop is allowed to skip a present. Skipping is cheap and it is
 * self-correcting: one skipped frame hands the GPU an entire frame's worth of
 * time with no new work, which is exactly what a backlog needs.
 */
/** A single frame this long has already missed a dozen vsyncs. Let it drain. */
export const STALL_MS = 220;
/**
 * Sustained CPU cost above this (~22 fps) means the frame cannot be afforded at
 * the current resolution. The answer is FEWER PIXELS, not fewer presents.
 *
 * This used to halve the present rate, and that was the wrong trade for a
 * racing game. Presenting every other frame does not reduce the work per frame
 * at all — it just shows half of it, so a 45ms frame becomes a 90ms *picture*
 * while the simulation carries on underneath. The player reported exactly what
 * that produces: "the frame rate or something seems slower... it doesn't feel
 * as fast as the odometer". Present cadence is what the eye reads as motion.
 * Dropping internal resolution instead makes the frame genuinely cheaper and
 * keeps every frame on screen.
 *
 * It survives as the CPU-BOUND trigger only. See `FRAME_SLOW_MS` below for why
 * it cannot be the only one.
 */
export const SLOW_MS = 45;
/** Resolution rungs. Each is ~30% fewer pixels than the one above. */
export const SCALE_RUNGS = [1, 0.85, 0.72, 0.6, 0.5];

/**
 * ===========================================================================
 *  THE LADDER USED TO BE BLIND TO THE ONLY FRAME IT EXISTS FOR.
 * ===========================================================================
 *  `renderCostEma` is measured around `pipeline.render()`, and that call
 *  returns when the frame's GL commands are QUEUED, not when the GPU has drawn
 *  them. So on a GPU-bound frame it reports the SUBMISSION cost and nothing
 *  else. Measured on this build at 1920x1080: a 21.94 ms frame, of which 1.90
 *  ms was JS, gave `renderCostEma = 1.78`. Against `SLOW_MS = 45` that is not a
 *  near miss — it is two orders of magnitude away, and no amount of GPU
 *  overload can ever close it, because the queue drains on the other side of
 *  the measurement.
 *
 *  The whole ladder was therefore decoration on exactly the machine it was
 *  written for. Profiling found the same thing independently: 26.3% of frames
 *  dropped, render scale "1 -> 1 held for the whole window".
 *
 *  The honest signal is the one the player and the benchmark both read: the
 *  interval between presented frames. It is vsync-quantised — a 60 Hz display
 *  hands back 16.7 or 33.4 ms and nothing in between — so a single sample says
 *  little, but its mean is 1000/fps by construction and cannot be fooled the
 *  way the submit cost can. The frame-rate benchmark gates on precisely this
 *  statistic.
 *
 *  Both triggers are kept and ORed: `SLOW_MS` on the submit cost still catches
 *  the CPU-bound case a frame or two sooner, and it is the one that survives if
 *  a browser ever paces rAF independently of our work.
 * ===========================================================================
 */
/**
 * Frame-interval EMA above which we are missing vsyncs often enough to be worth
 * a rung. 16.7 ms is a clean 60; 18.0 is ~56 fps, which on a 60 Hz panel means
 * roughly 8% of frames took two vsyncs — already past the frame-rate
 * benchmark's 5% budget.
 *
 * Deliberately NOT a "chase the refresh rate" threshold. On a 120 Hz display a
 * healthy loop reports 8.3 ms and never trips this, which is correct: the job
 * is to protect 60, not to spend quality buying 120.
 */
export const FRAME_SLOW_MS = 18.0;
/**
 * A frame at or under this counts as clean. The gap to `FRAME_SLOW_MS` is the
 * dead band — between 17.6 and 18.0 the ladder holds still rather than chatter.
 */
export const FRAME_CLEAN_MS = 17.6;
/**
 * EMA weight for the frame interval. Low, because the samples are quantised to
 * whole vsyncs: at a true 55 fps the raw stream is a random mix of 16.7 and
 * 33.4, and a fast EMA would swing ±5 ms across the threshold on noise alone.
 * At 0.06 the EMA's own spread is under 1 ms and it converges ~97% within the
 * 60-frame cooldown below.
 */
export const FRAME_EMA_ALPHA = 0.06;
/**
 * Resolution is not a lever on a CPU-BOUND frame, and spending it there is a
 * pure quality loss for nothing.
 *
 * `renderCostEma` is update + lateUpdate + GL submission, all of which is
 * serial with the present, so the frame can never be shorter than it. When it
 * is already most of the budget, fewer pixels cannot bring the frame under
 * 16.7 ms — it is physically impossible, not merely unlikely — so the ladder
 * holds its rung and lets the frame rate miss honestly rather than shipping a
 * soft picture that misses anyway.
 *
 * Observed live: on a machine loaded to a 20-minute load average of 81 by other
 * work, JS went from 2.3 ms to 9.1 ms with no change to the game, and the
 * ladder walked all the way to the bottom rung buying nothing. That is a
 * contended CI box, but it is also exactly the shape of a thermally-throttled
 * phone, which is the case this ladder has to survive.
 *
 * The threshold is deliberately below 16.7: at 13 ms of CPU there is under
 * 4 ms of headroom for every pixel in the frame, and no rung is worth that.
 */
export const CPU_BOUND_MS = 13.0;
/**
 * ===========================================================================
 *  THE LADDER MAY ONLY SPEND RESOLUTION ON A FRAME THAT IS ACTUALLY THE GAME.
 * ===========================================================================
 *  Caught by the mobile A/B, and it is the more damaging of the two bugs a
 *  working ladder introduced. The menu, the character select and the countdown
 *  are not the race: the frame-rate benchmark measures the countdown at ~53 fps
 *  against ~42 for real racing precisely because it is a stationary vehicle
 *  under an intro camera, and boot is slower still. On a machine that is
 *  briefly busy for any reason — a cold shader cache, a contended machine, a
 *  phone still unpacking the page — the ladder was walking three rungs down
 *  before the start signal
 *  and starting the race at a resolution the race never asked for.
 *
 *  Measured on the mobile profile: the buffer reached 136x295 for a 390x844
 *  panel, which is 12% of the CSS pixel count, on a frame whose own bottleneck
 *  was JS. Every one of those rungs was spent during boot and the menu.
 *
 *  So the ladder is armed only while the caller says the frame is LIVE, and
 *  only after it has been live long enough for the first-lap uploads to be
 *  behind it.
 * ===========================================================================
 */
export const RACING_SETTLE_FRAMES = 30;
/**
 * ===========================================================================
 *  THE LADDER'S FLOOR WAS NOT MEASURING WHAT ITS COMMENT SAID IT WAS.
 * ===========================================================================
 *  It read `settings.renderScale * SCALE_RUNGS[rung] >= 0.5` and claimed that
 *  meant "never render below half linear CSS resolution". It does not, because
 *  `renderScale` is only one of THREE factors in the buffer size the renderer
 *  actually allocates:
 *
 *      ratio = min(devicePixelRatio, maxPixelRatio) * renderScale * dynamicScale
 *
 *  So the same constant meant three different things on three machines:
 *
 *      1920x1080 dpr 1  ->  base ratio 1.00, floor 0.50x CSS
 *      1512x982  dpr 2  ->  base ratio 1.42, floor 0.71x CSS
 *      390x844   dpr 3  ->  base ratio 0.70, floor 0.35x CSS  (pre-change)
 *
 *  The phone — the device with the least resolution to give away — had the
 *  loosest floor of the three, which is exactly backwards and is half of how
 *  the mobile A/B reached a 136x295 buffer.
 *
 *  The floor is now stated in the unit it always claimed: the drawing buffer's
 *  linear size as a fraction of the page's own CSS size, read back from the GL
 *  context rather than re-derived from the settings (see `baseCssRatio` — an
 *  observation cannot drift out of sync with the renderer's formula, and it
 *  picks up the MAX_TEXTURE_SIZE clamp and the 4 Mpx backstop for free).
 *
 *  Two values, and the asymmetry is the point:
 *
 *   - A HANDHELD never renders below its own CSS resolution. On a 390 px panel
 *     the compositor's upscale is the single most visible defect in the frame —
 *     it is what "0.7x CSS, visibly soft" means — and this tier has already
 *     given up shadows, AO, DoF, motion blur, volumetrics and reflections, so
 *     resolution is the last thing left that is worth protecting rather than
 *     the first thing to spend.
 *   - Everything else keeps 0.6, which drops exactly ONE rung off the old
 *     range: 0.5. That rung is not a guess — it is the one the calibrated
 *     baseline caught red-handed. Across six unpinned 20 s runs the three that
 *     walked down to 0.5 measured 25.36 and 18.71 ms against 16.71 ms for the
 *     run that held 0.85. A quarter of the pixels, running slower. A rung with
 *     no demonstrated benefit anywhere does not belong in the range.
 * ===========================================================================
 */
export const CSS_FLOOR_HANDHELD = 1.0;
export const CSS_FLOOR_DEFAULT = 0.6;
/**
 * The ladder must keep at least this many rungs of authority whatever the
 * floors above work out to, or a device with a large panel relative to its tier
 * budget ends up with a ladder that cannot move at all — which is worse than a
 * slightly soft frame, because the alternative to a rung is a dropped frame.
 * Two rungs is 0.72x linear, i.e. roughly half the pixels: enough range to
 * matter, short of the region the baseline condemned.
 */
export const MIN_LADDER_RUNGS = 2;
/**
 * How much a rung has to actually buy, in milliseconds of frame interval, to be
 * allowed to keep it.
 *
 * The ladder's whole justification is that fewer pixels means a shorter frame,
 * and the calibrated baseline says that is NOT reliably true on this build: the
 * descent to rung 0.5 was anti-correlated with frame time. A controller that
 * spends quality on an assumption has to check the assumption, so every descent
 * is now provisional — the frame EMA is recorded at the moment of the step, and
 * when the cooldown expires the step is kept only if the EMA actually came
 * down. If it did not, the rung is handed straight back and marked, so the
 * ladder stops paying for it.
 *
 * 0.6 ms is above the pinned run-to-run noise floor per frame (2.04 ms of
 * spread over a 20 s window is ~0.1 ms on an EMA this slow) and well below one
 * vsync, so a real saving registers and a wobble does not.
 */
export const DESCENT_PAYOFF_MS = 0.6;
/**
 * A rung proved useless stays out of reach for this long. Long enough that the
 * ladder is not retrying it every few seconds; short enough that a phone which
 * genuinely thermally throttles into a different regime gets to try again.
 */
export const NO_PAYOFF_LOCKOUT = 3600;
/**
 * Most rungs a single step may cross. `descendTarget()` estimates the rung it
 * needs and that estimate is only as good as the fill/fixed split it assumes —
 * the calibrated baseline puts that split at anywhere from 8.11 to 10.99 ms of
 * fill in a ~17 ms frame, so the estimate can be out by a factor of well over
 * two and it was allowed to jump straight to the floor on the strength of it.
 * Capping the leap at two rungs keeps the fast response for a genuinely
 * catastrophic frame while making an overshoot cost one cooldown instead of the
 * entire range.
 */
export const MAX_JUMP_RUNGS = 2;
/**
 * Above this the ladder stops crawling and jumps straight to the rung it
 * estimates it needs.
 *
 * One rung per cooldown is right for a small miss and badly wrong for a large
 * one. Measured: on a machine running the race at 41 ms/frame the ladder needed
 * four steps to reach the bottom rung and, at 60 frames of cooldown each, spent
 * TEN SECONDS of a twenty-second race descending — so most of the race was
 * played at a resolution already known to be unaffordable, and every rung
 * change reallocates the composer's buffers on the way. The A/B that caught it
 * scored the crawling build WORSE than no ladder at all.
 *
 * 25 ms is the frame-rate benchmark's own dropped-frame threshold and is chosen for a
 * second reason: above it the frame is genuinely full, so `frameEma -
 * renderCostEma` is real GPU cost rather than mostly vsync idle, and the
 * estimate below is trustworthy. Below it the ladder crawls, which is the safe
 * behaviour near the target.
 */
export const FRAME_JUMP_MS = 25.0;

/**
 * Frames between resolution changes. Every change reallocates the composer's
 * buffers, so reacting instantly to a transient would cost more than the
 * transient did. It must also be longer than the EMA takes to reflect the new
 * resolution, or the ladder reads its own stale average and overshoots.
 */
export const SCALE_COOLDOWN = 60;
/** Longer after a step UP: an over-eager probe is what the player sees pumping. */
export const RECOVER_COOLDOWN = 120;
/**
 * ===========================================================================
 *  WHY RECOVERY IS A PROBE AND NOT A THRESHOLD.
 * ===========================================================================
 *  The frame interval is capped by vsync, so it can tell us we are too slow but
 *  never how much headroom we have: a machine with 2 ms to spare and one with
 *  10 ms both report exactly 16.7. A symmetric "recover below X ms" rule is
 *  therefore unimplementable on this signal — the old `RECOVER_MS = 26` only
 *  looked implementable because it read the submit cost, which is not capped
 *  and also not the frame.
 *
 *  So going back up is a guess that has to be TESTED: hold the rung until a
 *  long run of clean frames says the machine is comfortable, step up one, and
 *  see. If that step is followed by a drop soon after, the guess was wrong and
 *  the next probe waits twice as long. That backoff is what keeps a machine
 *  sitting exactly on the boundary — the thermally-throttled phone this ladder
 *  cares about most — from oscillating: after three failures it is probing once
 *  a minute, which is invisible, instead of every six seconds, which is not.
 * ===========================================================================
 */
export const PROBE_FRAMES_MIN = 360;
export const PROBE_FRAMES_MAX = 3600;
/** A drop this soon after a step up means the step up caused it. */
export const PROBE_FAIL_WINDOW = 900;
/**
 * Clean frames are counted with a leak rather than reset outright, so one hitch
 * does not throw away a good streak while a steady trickle of dropped frames
 * still never accumulates: at a 10% drop rate the counter loses ground every
 * ten frames and can never reach the probe threshold.
 */
export const CLEAN_LEAK = 30;
/** The watchdog stays out of the way until the scene has settled. */
export const WATCHDOG_FROM_FRAME = 30;

/** Every field of `__loopHealth` the ladder owns. See `GameLoop.health()`. */
export interface LadderHealth {
  renderCostEma: number;
  frameEma: number;
  cleanFrames: number;
  probeFrames: number;
  racingFrames: number;
  renderScale: number;
  scaleRung: number;
  lowestRung: number;
  baseCssRatio: number;
  descentsKept: number;
  descentsReverted: number;
  noPayoffRung: number;
  scalerPinned: boolean;
  dynamicScale: number;
  stalls: number;
}

/** One presented frame, as the loop measured it. */
export interface PresentedFrame {
  /** wall-clock milliseconds spent in update + lateUpdate + submit */
  cost: number;
  /** milliseconds since the previous rAF callback */
  intervalMs: number;
  /** is this a frame the ladder is allowed to reason about? */
  live: boolean;
  /** did the previous tick present? An interval across a skip is not a frame. */
  lastTickPresented: boolean;
  /** `__freeze` — a held frame's interval describes the capture tool, not the game */
  frozen: boolean;
  /**
   * ===========================================================================
   *  THIS PRESENT CAME AFTER A TICK WE SKIPPED **ON PURPOSE**.
   * ===========================================================================
   *  Added 2026-08-21 for an ambient piece, the first consumer with no player.
   *
   *  Every other field on this record describes a machine that is struggling.
   *  This one describes a machine that is being POLITE: `GameLoopOptions.
   *  presentEvery` lets an experience present one frame in N deliberately — an
   *  ambient piece nobody is watching has no reason to burn a 1080p panel at
   *  60 Hz — and the interval that produces is not a symptom of anything.
   *
   *  Without it the ladder gets the wrong answer in BOTH directions, and the
   *  two are not symmetrical:
   *
   *    · `usable` requires `lastTickPresented`, which is false on every single
   *      paced frame, so `frameEma` is never fed and `__loopHealth()` reports
   *      16.7 ms for ever about a piece running at 33.4 — a plausible default
   *      answering for a measurement that never happened.
   *    · If the EMA IS fed without this flag, 33.4 ms sails past
   *      `FRAME_SLOW_MS` and the ladder spends resolution trying to fix a frame
   *      rate nobody asked it to protect — and `settleDescent` then finds the
   *      rung bought nothing (the interval is clock-limited, not fill-limited),
   *      hands it back, and locks it out for 3600 frames. On a two-minute
   *      lockout at 30 Hz that is a resolution wobble roughly every two
   *      minutes, for ever, with nobody watching.
   *
   *  So paced frames feed the average — the interval a viewer sees IS 33.4 and
   *  a health readout that says otherwise is worse than no readout — and are
   *  barred from moving a rung. See `onPresented`.
   *
   *  ALWAYS FALSE FOR A GAME THAT PASSES NO `presentEvery`, because it never
   *  skips a tick on purpose. The ladder's Node test omits the field entirely
   *  and reads `undefined`, which is falsy, so the frame-for-frame comparison
   *  against the pre-extraction ladder is unmoved.
   */
  paced: boolean;
}

export interface LadderOptions<W extends LoopWorld> {
  pipeline: LoopPipelineHost;
  world: W;
  /** `device().handheld`, injected so a Node test can drive both floors. */
  handheld: () => boolean;
  /**
   * `location.search`, or the query a test wants to pretend it was given.
   * Read once — `?scaler=` may not change under a running loop, because the
   * whole point of a pinned run is that it contains no rung change of its own.
   */
  search?: string;
  /** Console sink. A test swaps it to read the ladder's own account. */
  log?: Pick<Console, 'info' | 'warn'>;
}

/**
 * ===========================================================================
 *  `?scaler=` — PIN THE ADAPTIVE LADDER, SO A MEASUREMENT CAN BE ATTRIBUTED.
 * ===========================================================================
 *  The ladder exists to protect frame rate by spending resolution, and that is
 *  the right behaviour for a player. It is ruinous for a MEASUREMENT: the
 *  headline "59 fps desktop" this build reports is bought by rendering
 *  1632x918 instead of 1920x1080, and the number moves because the ladder
 *  moved, not because the frame got cheaper. Two runs of the same build landed
 *  on rungs 0.85 and 0.5 and reported 59.9 and 39.4 fps.
 *
 *  Worse, it makes the two halves of an A/B incomparable: an optimisation that
 *  genuinely saves 2 ms lets the ladder hold a HIGHER rung, so it draws more
 *  pixels and reports the same frame rate. The saving is real and completely
 *  invisible. Every A/B has to pin this or it is measuring the
 *  controller, not the change.
 *
 *      ?scaler=off     ladder never moves; stays at SCALE_RUNGS[0] = 1.0
 *      ?scaler=0.72    ladder never moves; pinned at that dynamic scale
 *
 *  `off` is the one to use for a full-quality baseline. The numeric form
 *  exists so the resolution/frame-time curve can be swept by hand, which is
 *  the only honest way to answer "is this frame fill-bound", because the
 *  ladder answering it for you is what hid the answer in the first place.
 *
 *  Deliberately NOT `?debug=`: that parameter selects one diagnostic mode and
 *  `?debug=frames` already means something else (it turns on
 *  `preserveDrawingBuffer`, which costs frame time and would poison exactly
 *  the measurement this flag is for).
 * ===========================================================================
 */
export class ResolutionLadder<W extends LoopWorld> {
  /** EMA of the CPU cost of frames we actually presented, milliseconds. */
  renderCostEma = 16.7;
  /** EMA of the interval between presented frames — what the player actually sees. */
  frameEma = 16.7;
  /** Leaky count of consecutive on-time frames; feeds the recovery probe. */
  cleanFrames = 0;
  /** Clean frames required before the next step up. Doubles on a failed probe. */
  probeFrames = PROBE_FRAMES_MIN;
  /** Frame number of the last step up, so a drop can be blamed on it. */
  lastProbeFrame = -PROBE_FAIL_WINDOW;
  /** Consecutive presented frames spent live. Arms the ladder. */
  racingFrames = 0;
  /** Frames still to skip presenting. */
  skipRender = 0;
  /** Index into SCALE_RUNGS; 0 is full resolution. */
  scaleRung = 0;
  scaleCooldown = 0;
  /**
   * The rung the last descent came FROM, or -1 when no descent is under
   * assessment. See DESCENT_PAYOFF_MS: a descent is provisional until its
   * cooldown expires and the frame EMA is compared against what it was.
   */
  descendFromRung = -1;
  /** `frameEma` at the instant of that descent — the number the rung has to beat. */
  descendFromEma = 0;
  /** Shallowest rung proved to buy nothing, or -1. See NO_PAYOFF_LOCKOUT. */
  noPayoffRung = -1;
  /** Frame the lockout above started on. */
  noPayoffFrame = 0;
  /** Descents kept / handed back, for test tools. Counts, not times. */
  descentsKept = 0;
  descentsReverted = 0;
  stallCount = 0;

  /** True when the ladder must never call `setDynamicScale` again. */
  readonly pinned: boolean;
  /**
   * The scale to hold when pinned. `off` means full resolution; a number pins
   * that value. Anything unparseable pins 1.0 rather than silently resuming
   * adaptation, because a typo must not turn a pinned run back into a moving
   * one without saying so.
   *
   * Clamped to the SAME 0.5..1 range `setDynamicScale` enforces, so the value
   * reported by `__loopHealth` is the value that was applied. To sweep below
   * 0.5 use `?scale=` (the tier's own `renderScale`, 0.25..2) together with
   * `?scaler=off` — that rebuilds the effect chain once at boot, which is
   * exactly right for a pinned run and wrong for an adaptive one.
   */
  readonly pinValue: number;

  readonly #pipeline: LoopPipelineHost;
  readonly #world: W;
  readonly #handheld: () => boolean;
  readonly #log: Pick<Console, 'info' | 'warn'>;

  constructor(opts: LadderOptions<W>) {
    this.#pipeline = opts.pipeline;
    this.#world = opts.world;
    this.#handheld = opts.handheld;
    this.#log = opts.log ?? console;
    const param = new URLSearchParams(opts.search ?? '').get('scaler');
    this.pinned = param !== null && param !== '';
    if (!this.pinned) {
      this.pinValue = 1;
    } else {
      const v = parseFloat(param as string);
      // `THREE.MathUtils.clamp(v, 0.5, 1)` written out — this package has no
      // `three` and must not acquire one for two calls to Math.
      this.pinValue = Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(1, v)) : 1;
    }
  }

  /**
   * The rung currently applied. `SCALE_RUNGS` is a plain array and
   * `noUncheckedIndexedAccess` is on, so every read goes through here rather
   * than through a `!` at eleven call sites.
   */
  rungScale(i = this.scaleRung): number {
    return SCALE_RUNGS[i] ?? 1;
  }

  /**
   * Apply the `?scaler=` pin. Called from boot rather than from the loop so
   * that the very first presented frame is already at the pinned resolution — a
   * pinned run must not contain a rung change of its own, which is the whole
   * point of pinning.
   */
  applyPin(): void {
    if (!this.pinned) return;
    this.scaleRung = 0;
    this.#pipeline.setDynamicScale(this.pinValue);
    this.#log.info(`[frame] adaptive scaler PINNED at dynamic scale ${this.pinValue} (?scaler=)`);
  }

  /**
   * The drawing buffer's linear size as a multiple of the page's own CSS size, at
   * rung 0 — i.e. what this device renders at with the ladder out of the way.
   *
   * READ BACK, NOT RE-DERIVED. `Renderer.effectivePixelRatio()` folds together
   * devicePixelRatio, `maxPixelRatio`, `renderScale`, `dynamicScale`, a
   * MAX_TEXTURE_SIZE clamp and a 4 Mpx backstop, and a copy of that expression
   * living over here would be one edit away from disagreeing with it
   * silently. Dividing the
   * buffer the driver actually allocated by the rung currently applied cannot
   * drift, because it is the same number the compositor is upscaling from.
   *
   * Falls back to 1 (the "no supersampling, no upscaling" assumption) if the
   * context is gone or the surface is degenerate, which keeps the floors below
   * conservative rather than accidentally unlocking the bottom of the range.
   */
  baseCssRatio(): number {
    const gl = this.#world.renderer?.getContext?.();
    const bufW = gl?.drawingBufferWidth ?? 0;
    const ds = this.#pipeline.dynamicScale || 1;
    if (bufW <= 0 || this.#world.width <= 0) return 1;
    return bufW / this.#world.width / ds;
  }

  /**
   * Lowest rung index the ladder may descend to on this device. See
   * CSS_FLOOR_HANDHELD / CSS_FLOOR_DEFAULT for the floors, MIN_LADDER_RUNGS for
   * why the floor cannot be allowed to lock the ladder solid, and
   * `noPayoffRung` for the rung a failed descent has taken off the table.
   */
  lowestRung(): number {
    const base = this.baseCssRatio();
    const floor = this.#handheld() ? CSS_FLOOR_HANDHELD : CSS_FLOOR_DEFAULT;
    let i = SCALE_RUNGS.length - 1;
    while (i > 0 && base * this.rungScale(i) < floor - 1e-6) i--;
    // Never fewer than MIN_LADDER_RUNGS of range, and never past the array.
    i = Math.min(SCALE_RUNGS.length - 1, Math.max(i, MIN_LADDER_RUNGS));
    // A rung that was tried and bought nothing is out of reach until the lockout
    // expires; everything below it is too, because it is on the far side of it.
    if (this.noPayoffRung > 0 && this.#world.frame - this.noPayoffFrame < NO_PAYOFF_LOCKOUT) {
      i = Math.min(i, this.noPayoffRung - 1);
    }
    return Math.max(0, i);
  }

  /**
   * The rung to drop to. See FRAME_JUMP_MS for why this is not always `+1`.
   *
   * The estimate assumes per-frame cost splits into a part that scales with the
   * pixel count and a part that does not (`renderCostEma`, which is CPU and
   * serial with everything). Fill cost goes as the SQUARE of the linear scale, so
   * the scale that would fit the remaining budget is
   * `current * sqrt(budget / pixelCost)`. It is only ever used to pick from the
   * fixed rung list, and the recovery probe walks back up if it overshoots.
   */
  descendTarget(): number {
    const floor = this.lowestRung();
    if (this.scaleRung + 1 > floor) return this.scaleRung;
    if (this.frameEma <= FRAME_JUMP_MS) return this.scaleRung + 1;
    const pixelCost = Math.max(1, this.frameEma - this.renderCostEma);
    const budget = Math.max(2, FRAME_CLEAN_MS - this.renderCostEma);
    const want = this.rungScale() * Math.sqrt(budget / pixelCost);
    let target = this.scaleRung + 1;
    while (target < floor && this.rungScale(target) > want) target++;
    // See MAX_JUMP_RUNGS. The estimate above is worth a fast response, not the
    // whole range on one reading.
    return Math.min(target, this.scaleRung + MAX_JUMP_RUNGS, floor);
  }

  /**
   * Settle the provisional descent recorded by the last step down.
   *
   * Called once, the frame the cooldown reaches zero — by which point the EMA has
   * had SCALE_COOLDOWN frames at alpha FRAME_EMA_ALPHA to converge ~97% onto the
   * new resolution, which is what that cooldown is sized for. If the rung bought
   * less than DESCENT_PAYOFF_MS it is handed straight back and locked out.
   *
   * Returns true if it changed the rung, so the caller knows to skip its own
   * decision this frame.
   */
  settleDescent(): boolean {
    if (this.descendFromRung < 0) return false;
    const from = this.descendFromRung;
    const before = this.descendFromEma;
    this.descendFromRung = -1;
    if (this.frameEma <= before - DESCENT_PAYOFF_MS) {
      this.descentsKept++;
      return false;
    }
    // It bought nothing. Give the pixels back and stop asking for a while.
    this.descentsReverted++;
    this.noPayoffRung = this.scaleRung;
    this.noPayoffFrame = this.#world.frame;
    this.scaleRung = from;
    this.scaleCooldown = RECOVER_COOLDOWN;
    this.cleanFrames = 0;
    this.#pipeline.setDynamicScale(this.rungScale());
    this.#log.warn(
      `[frame] render scale ${this.rungScale(this.noPayoffRung)} bought ` +
      `${(before - this.frameEma).toFixed(2)}ms of ${DESCENT_PAYOFF_MS}ms needed ` +
      `(${before.toFixed(1)} -> ${this.frameEma.toFixed(1)}ms); reverting to ` +
      `${this.rungScale()} and locking that rung out`,
    );
    return true;
  }

  /**
   * One presented frame's worth of evidence, and the decision it justifies.
   *
   * The order of the four blocks below is load-bearing and is exactly the order
   * they ran in inside the games' `frame()`: cost EMA, live counter, interval
   * EMA, then the single if/else chain that may move a rung. Nothing in the
   * chain may run twice in a frame, which is why it is a chain and not four
   * `if`s.
   */
  onPresented(f: PresentedFrame): void {
    this.renderCostEma += (f.cost - this.renderCostEma) * 0.12;

    // Only a live frame is a frame the ladder may reason about. Outside it the
    // averages are HELD rather than fed, so the menu's cost never reaches them
    // and a second race starts from what the first one learned.
    this.racingFrames = f.live ? this.racingFrames + 1 : 0;

    // The interval only describes a frame the player saw if the tick before it
    // also presented, the clock was running, and it is not a tab-switch hole.
    // `f.paced` stands in for `lastTickPresented` and for nothing else: the
    // tick before a paced present was skipped BY US, at a cadence we chose, so
    // the interval is a real and intended one rather than a hole. See the field.
    const usable = f.live && (f.lastTickPresented || f.paced) && !f.frozen &&
      f.intervalMs > 1 && f.intervalMs < 100;
    if (usable) {
      this.frameEma += (f.intervalMs - this.frameEma) * FRAME_EMA_ALPHA;
      this.cleanFrames = f.intervalMs <= FRAME_CLEAN_MS && this.frameEma <= FRAME_CLEAN_MS
        ? this.cleanFrames + 1
        : Math.max(0, this.cleanFrames - CLEAN_LEAK);
    }

    if (f.cost > STALL_MS) {
      this.stallCount++;
      // Log the first few and then go quiet — a stall storm must not turn into
      // a console-write storm, which is itself a stall.
      if (this.stallCount <= 5) {
        this.#log.warn(`[frame] ${Math.round(f.cost)}ms frame; skipping the next present to drain`);
      }
      this.skipRender = 1;
    } else if (this.#world.frame <= WATCHDOG_FROM_FRAME) {
      // Boot frames are enormous — shader pre-warm, first-use uploads, the
      // PMREM bake — and they poison the average. Measured: the scaler dropped
      // a rung at frame 9 off a 56ms EMA that was entirely startup cost, on a
      // machine that then ran at 8ms. Hold both averages at the target until the
      // scene has actually settled.
      this.renderCostEma = 16.7;
      this.frameEma = 16.7;
      this.cleanFrames = 0;
    } else if (this.pinned) {
      // See `?scaler=`. The averages above are still maintained, so a pinned run
      // reports the frame cost it is ACTUALLY paying via `__loopHealth`; it just
      // never spends resolution to change it.
    } else if (this.racingFrames < RACING_SETTLE_FRAMES) {
      // Not live, or not live for long enough yet. See RACING_SETTLE_FRAMES.
    } else if (this.scaleCooldown > 0) {
      // The cooldown after a step down is also its ASSESSMENT window. When it
      // expires, the rung has to justify itself or it is handed back.
      if (--this.scaleCooldown === 0) this.settleDescent();
    } else if (f.paced) {
      // A deliberately paced frame may not move a rung in either direction. See
      // `PresentedFrame.paced`: the interval it reports is the cadence the
      // experience asked for, so descending buys nothing measurable and the
      // payoff check would hand the rung straight back and lock it out.
    } else if ((this.frameEma > FRAME_SLOW_MS || this.renderCostEma > SLOW_MS) &&
               // See CPU_BOUND_MS. `SLOW_MS` is exempt because at 45ms of
               // submission the loop is running away and the rung is the least
               // of it — dropping is still the right reflex there.
               (this.renderCostEma < CPU_BOUND_MS || this.renderCostEma > SLOW_MS) &&
               // See CSS_FLOOR_*. The next rung down may not exist on this
               // device even though the array has one — and it may have been
               // locked out by a descent that bought nothing.
               this.scaleRung < this.lowestRung()) {
      // If we only just stepped up, the step up is the reason we are here. Make
      // the next probe wait twice as long before guessing again.
      if (this.#world.frame - this.lastProbeFrame < PROBE_FAIL_WINDOW) {
        this.probeFrames = Math.min(PROBE_FRAMES_MAX, this.probeFrames * 2);
      }
      // Provisional. See DESCENT_PAYOFF_MS — `settleDescent()` reads both of
      // these back when the cooldown expires and reverses the step if the
      // pixels bought nothing.
      this.descendFromRung = this.scaleRung;
      this.descendFromEma = this.frameEma;
      this.scaleRung = this.descendTarget();
      this.scaleCooldown = SCALE_COOLDOWN;
      this.cleanFrames = 0;
      this.#pipeline.setDynamicScale(this.rungScale());
      this.#log.warn(
        `[frame] ${this.frameEma.toFixed(1)}ms between presented frames ` +
        `(submit ${this.renderCostEma.toFixed(1)}ms); render scale -> ${this.rungScale()} ` +
        `(every frame still presented)`,
      );
    } else if (this.scaleRung > 0 && this.cleanFrames >= this.probeFrames) {
      this.scaleRung--;
      this.scaleCooldown = RECOVER_COOLDOWN;
      this.cleanFrames = 0;
      this.lastProbeFrame = this.#world.frame;
      this.#pipeline.setDynamicScale(this.rungScale());
      this.#log.info(
        `[frame] ${Math.round(this.probeFrames / 60)}s of clean frames at ${this.frameEma.toFixed(1)}ms; ` +
        `probing render scale -> ${this.rungScale()}`,
      );
    }
  }

  /**
   * Everything the ladder knows, back to a state that has never seen a frame.
   *
   * Called after a WebGL context restore. The provisional-descent bookkeeping
   * describes a GPU that no longer exists — carrying a lockout across a restore
   * would leave the new context permanently barred from a rung it has never
   * tried. `stallCount` and `descentsKept/Reverted` are deliberately NOT reset:
   * they are the run's tally, and a test reading them across a forced loss
   * is asking how much the run cost in total.
   */
  reset(): void {
    this.renderCostEma = 16.7;
    this.frameEma = 16.7;
    this.cleanFrames = 0;
    this.probeFrames = PROBE_FRAMES_MIN;
    this.lastProbeFrame = -PROBE_FAIL_WINDOW;
    this.racingFrames = 0;
    this.skipRender = 0;
    this.scaleRung = 0;
    this.scaleCooldown = 0;
    this.descendFromRung = -1;
    this.descendFromEma = 0;
    this.noPayoffRung = -1;
    this.noPayoffFrame = 0;
    // A restore must come back to the resolution the run was PINNED at, not to
    // 1.0 — otherwise a context-loss test and a pinned benchmark disagree about
    // what was being measured either side of the loss.
    this.#pipeline.setDynamicScale(this.pinned ? this.pinValue : 1);
  }

  health(): LadderHealth {
    return {
      renderCostEma: +this.renderCostEma.toFixed(2),
      // The signal the ladder actually acts on. `renderCostEma` is submission
      // cost and is ~1.8ms on a GPU-bound 22ms frame; this one is the frame.
      frameEma: +this.frameEma.toFixed(2),
      cleanFrames: this.cleanFrames,
      probeFrames: this.probeFrames,
      racingFrames: this.racingFrames,
      renderScale: this.rungScale(),
      scaleRung: this.scaleRung,
      // Deterministic ladder counters — counts, not milliseconds, so they are
      // readable under load. `lowestRung` is what the CSS floor works out to on
      // this device; `baseCssRatio` is the buffer/CSS ratio at rung 0, which is
      // the number "is the phone sharp?" actually asks about.
      lowestRung: this.lowestRung(),
      baseCssRatio: +this.baseCssRatio().toFixed(3),
      descentsKept: this.descentsKept,
      descentsReverted: this.descentsReverted,
      noPayoffRung: this.noPayoffRung,
      // Reported so a test can VERIFY the pin took rather than assume it.
      // A frame-rate knob wired to nothing at all has shipped before; a flag
      // whose effect cannot be read back is the same bug waiting to happen.
      scalerPinned: this.pinned,
      dynamicScale: this.#pipeline?.dynamicScale ?? 1,
      stalls: this.stallCount,
    };
  }
}
