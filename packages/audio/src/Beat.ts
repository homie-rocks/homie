/**
 * ============================================================================
 *  Beat.ts — THE OWNED AUDIO CLOCK. The other side of @homie-rocks/postfx/Clock.ts.
 * ============================================================================
 *
 * `Transport.ts` is the look-ahead step sequencer three racing games and a
 * base-building game share, and it is right for all four of them. This is not
 * a replacement for it. It is the thing `Transport.ts` deliberately does not have, and which
 * every one of its four consumers can live without because **none of them can
 * hear the difference**: a MUSICAL POSITION that is a number, convertible to
 * and from audio-device seconds in both directions, and a scheduler that never
 * moves the grid.
 *
 * ## The outcome this file owns
 *
 *   **The sound of step N happens at `grid.timeOf(N)` on the AUDIO DEVICE
 *   CLOCK, whatever the frame loop is doing — including not running at all —
 *   and a step the pump arrived too late to schedule is COUNTED AND DROPPED
 *   rather than played late.**
 *
 * ## Why the frame loop cannot be the clock, measured
 *
 * `Transport.update()` is pumped from `System.update(ctx, dt)` in all four
 * games, and its look-ahead is 0.15 s. That is a bargain with the frame loop:
 * it survives a stutter of up to 150 ms and no more. `@homie-rocks/loop/Ladder.ts`
 * exists precisely because the host's frame time is NOT a constant — `STALL_MS`
 * is 220 and `FRAME_JUMP_MS` is 25, i.e. the loop's own thresholds concede
 * gaps longer than the sequencer's whole window. For a bed under a race, a
 * missing sixteenth is inaudible. For a rhythm experience it is the product.
 *
 * So the rule this file exists to make structural:
 *
 *   **THE AUDIO SIDE MUST NOT FOLLOW THE FRAME-RATE LADDER.** `BeatScheduler`
 *   reads exactly one clock — the `currentTime` of the context the sound comes
 *   out of. `performance.now()` appears nowhere in this file. A consumer may
 *   pump it from a frame, from a `setInterval`, from a worker or from all
 *   three; pumping is idempotent, so belt and braces is free and a dropped
 *   frame is not an event this file can see.
 *
 * ## The one line of `Transport.ts` a rhythm game cannot use, and why
 *
 *     if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
 *
 * (`Transport.ts`, `update()`.) After ANY stall longer than 250 ms the whole
 * grid is re-anchored 20 ms in the future — the tempo survives and the PHASE
 * does not, and `step` is not recomputed either, so the bar line lands
 * somewhere new. The racing games and the base game cannot hear that: their music has
 * no relationship to anything on screen. An experience whose playhead, judgement
 * window and pattern all sit on the grid loses its alignment permanently, in
 * silence, on one hitch. This scheduler resyncs by ARITHMETIC instead — it
 * computes the first grid index at or after `now` — so a stall costs the notes
 * that fell inside it and nothing else. A rhythm game needs "drift correction
 * against the audio device clock"; that is this, and the correction is that
 * there is nothing to correct because nothing accumulates.
 *
 * ## What this file refuses
 *
 * It owns no tempo, no note, no pattern, no instrument, no swing, and no
 * default look-ahead. `lookahead` is required for the reason `ChainLook`'s
 * fields are required: it is a MEASUREMENT against one consumer's pump rate,
 * and a package that shipped a default would have picked one experience's
 * bargain for all of them. It also owns no `AudioContext` — it reads
 * `currentTime` off a structure, which is what lets a harness render this exact
 * scheduler into an `OfflineAudioContext` and measure the sound rather than the
 * intention.
 *
 * ## This file imports nothing at all
 *
 * Not even from inside the package. `packages/audio/src` imports nothing
 * outside itself; this one goes further because it has no reason not to, and a
 * clock with no dependencies is a clock a harness can stand up in four lines.
 */

/**
 * The only thing this file asks of the world: what time it is, at the device.
 *
 * Structural, and one field, for the same reason `@homie-rocks/loop/Host.ts` is
 * structural: an `AudioContext` type would drag a DOM lib into a module a Node
 * harness has to be able to construct, and `OfflineAudioContext`, a real
 * context and a fake all satisfy this identically.
 */
export interface AudioClock {
  readonly currentTime: number;
}

/** How a `BeatGrid` is anchored. Every field required; see the header. */
export interface BeatGridSpec {
  /** Audio-clock time, in seconds, of step 0. */
  readonly t0: number;
  readonly bpm: number;
  /** 4 for sixteenths, 3 for triplet eighths, 1 for beats. */
  readonly stepsPerBeat: number;
}

/**
 * The map between musical position and audio-device seconds, both ways.
 *
 * A step index is UNBOUNDED and monotonic — it does not wrap at a bar. That is
 * the difference between this and `Transport.step`, and it is the whole reason
 * a note can be drawn approaching a strike line: a visual needs to ask "how far
 * through step 214 are we" and get a fraction, and it needs to ask that of the
 * same object the sound came from. Wrapping is the consumer's arithmetic and
 * belongs where the bar length is known.
 */
export class BeatGrid {
  #t0: number;
  #bpm: number;
  readonly stepsPerBeat: number;

  constructor(spec: BeatGridSpec) {
    if (!(spec.bpm > 0)) throw new RangeError(`BeatGrid: bpm must be positive, got ${spec.bpm}`);
    if (!(spec.stepsPerBeat >= 1)) {
      throw new RangeError(`BeatGrid: stepsPerBeat must be at least 1, got ${spec.stepsPerBeat}`);
    }
    this.#t0 = spec.t0;
    this.#bpm = spec.bpm;
    this.stepsPerBeat = spec.stepsPerBeat;
  }

  get bpm(): number { return this.#bpm; }
  /** Audio-clock time of step 0. Moves only through `setTempo`. */
  get origin(): number { return this.#t0; }
  /** One grid step, in seconds. */
  get stepDur(): number { return 60 / this.#bpm / this.stepsPerBeat; }

  /** Audio-clock time of a step. Exact, and defined for negative and fractional steps. */
  timeOf(step: number): number { return this.#t0 + step * this.stepDur; }

  /** Fractional step position at an audio-clock time. The inverse of `timeOf`. */
  stepAt(t: number): number { return (t - this.#t0) / this.stepDur; }

  /**
   * Change tempo WITHOUT moving the music.
   *
   * The naive version rewrites `bpm` and leaves `t0` alone, which teleports
   * every future step — at 120 bpm going to 124, step 512 jumps 1.65 seconds.
   * This re-anchors `t0` so the fractional position at `atTime` is exactly what
   * it was a moment ago, and the change takes effect going forward only. A
   * consumer that has already SCHEDULED notes past `atTime` has to re-decide
   * them; this class cannot unschedule a `start()` and does not pretend to.
   */
  setTempo(bpm: number, atTime: number): void {
    if (!(bpm > 0)) throw new RangeError(`BeatGrid: bpm must be positive, got ${bpm}`);
    const held = this.stepAt(atTime);
    this.#bpm = bpm;
    this.#t0 = atTime - held * this.stepDur;
  }

  /**
   * Move the whole grid so that `step` falls at `t`. The tempo is untouched.
   *
   * THIS IS THE DESTRUCTIVE ONE and it is here because sometimes it is what you
   * mean: an external sync — a tap-tempo, a cue from the host, a
   * second machine — hands you a moment and says "the bar starts here", and the
   * only honest response is to move. Everything already scheduled past `t`
   * becomes wrong; the caller is the only one who knows what it scheduled.
   *
   * `BeatScheduler` NEVER calls this. Its resync is arithmetic on the step
   * index precisely so that a stall cannot reach the grid — see the header on
   * `Transport.ts`'s `nextTime = now + 0.02`, which is this method used as a
   * recovery, and which a rhythm game's test reintroduces as a deliberate fault
   * in order to prove a probe can see it.
   */
  reanchor(step: number, t: number): void {
    this.#t0 = t - step * this.stepDur;
  }
}

/** What a `BeatScheduler` reports about itself. Read it; do not infer it. */
export interface BeatStats {
  /** Steps handed to `onStep`. */
  scheduled: number;
  /**
   * Steps that were already in the past when the pump finally ran, and were
   * therefore DROPPED.
   *
   * A dropped note is a hole in the music and it is the honest outcome; a note
   * scheduled at a time that has passed is played by the Web Audio API
   * IMMEDIATELY, which is a flam — several notes at once at the instant the tab
   * came back. This number is the size of the hole and it exists so that "the
   * pump is keeping up" and "the pump has not run for two seconds" cannot
   * render as the same silence.
   */
  dropped: number;
  /** Pumps that found the grid had run away from them. */
  resyncs: number;
  /** The largest gap between two pumps, in AUDIO seconds. */
  worstGapS: number;
  /**
   * Pumps that hit the burst guard, i.e. asked to schedule more steps in one
   * call than `maxBurst` allows. Non-zero means `lookahead` and `maxBurst`
   * disagree and steps are being lost to the guard rather than to a stall.
   */
  overruns: number;
}

export interface BeatSchedulerSpec<C extends AudioClock> {
  clock: C;
  grid: BeatGrid;
  /**
   * How far ahead of the audio clock steps are scheduled, in seconds.
   *
   * REQUIRED, and it is the one real trade in this file: longer survives a
   * worse pump gap, shorter makes a tempo or pattern change arrive sooner. A
   * pattern edited by a player is heard `lookahead` later at worst,
   * so an experience where the players are playing the machine wants this SHORT and
   * a pump that is not the frame loop; an experience playing a fixed chart
   * wants it long. There is no number that is right for both, so there is no
   * default.
   */
  lookahead: number;
  /**
   * The most steps one pump may schedule. Bounds the loop; see `overruns`.
   * `Transport.ts` spells the same guard as a bare `let guard = 48`.
   */
  maxBurst: number;
  /**
   * The game's music. Called once per step, `t` seconds on the AUDIO clock.
   *
   * `t` is always >= `clock.currentTime` at the moment of the call. A callee
   * may pass it straight to `@homie-rocks/audio/Patch.ts` or `Oneshot.ts`, both of
   * which take an explicit `t` and schedule relative to it — which is the shape
   * a drift-corrected scheduler hands a note.
   */
  onStep(step: number, t: number): void;
}

/**
 * Look-ahead scheduling on the audio device clock, and nothing above it.
 *
 * PUMPING IS IDEMPOTENT AND CHEAP. `pump()` schedules what is due and returns;
 * calling it twice in a row does nothing the second time. That is deliberate:
 * a consumer is expected to pump from a timer AND from the frame, so that a
 * frame loop which has stopped entirely — the ladder at its lowest rung, a
 * shader compile, a garbage collection — cannot take the music with it.
 */
export class BeatScheduler<C extends AudioClock> {
  readonly grid: BeatGrid;
  readonly stats: BeatStats = {
    scheduled: 0, dropped: 0, resyncs: 0, worstGapS: 0, overruns: 0,
  };

  readonly #clock: C;
  readonly #lookahead: number;
  readonly #maxBurst: number;
  readonly #onStep: (step: number, t: number) => void;

  #running = false;
  /** The next step this scheduler has NOT yet handed to `onStep`. */
  #next = 0;
  /** Audio time of the previous pump, for `worstGapS`. NaN before the first. */
  #lastPump = Number.NaN;
  /** Frame-clock minus audio-clock, observed and never acted on. See `drift`. */
  #drift = Number.NaN;

  constructor(spec: BeatSchedulerSpec<C>) {
    if (!(spec.lookahead > 0)) {
      throw new RangeError(`BeatScheduler: lookahead must be positive, got ${spec.lookahead}`);
    }
    if (!(spec.maxBurst >= 1)) {
      throw new RangeError(`BeatScheduler: maxBurst must be at least 1, got ${spec.maxBurst}`);
    }
    this.#clock = spec.clock;
    this.grid = spec.grid;
    this.#lookahead = spec.lookahead;
    this.#maxBurst = spec.maxBurst;
    this.#onStep = spec.onStep;
  }

  get running(): boolean { return this.#running; }
  /** The next step that has not been scheduled. Musical position, not wall position. */
  get nextStep(): number { return this.#next; }

  /**
   * Begin, at a step index rather than at a time.
   *
   * `Transport.start()` says `nextTime = s.now + 0.12`, which starts the music
   * 120 ms from now and puts step 0 wherever that lands. Here the grid decides
   * where step 0 is and the scheduler joins it: start at the first step that is
   * still in the future, so the phase of a grid shared with a visual is never
   * decided by when somebody pressed play.
   */
  start(fromStep?: number): void {
    this.#running = true;
    const firstFuture = Math.ceil(this.grid.stepAt(this.#clock.currentTime));
    this.#next = fromStep ?? firstFuture;
    this.#lastPump = Number.NaN;
  }

  stop(): void { this.#running = false; }

  /**
   * Schedule every step inside the look-ahead window. Safe to call from
   * anywhere, as often as you like.
   */
  pump(): void {
    if (!this.#running) return;
    const now = this.#clock.currentTime;

    if (Number.isFinite(this.#lastPump)) {
      const gap = now - this.#lastPump;
      if (gap > this.stats.worstGapS) this.stats.worstGapS = gap;
    }
    this.#lastPump = now;

    // ---------------------------------------------------------------------
    // RESYNC BY ARITHMETIC, WHICH IS WHY THE PHASE SURVIVES.
    // ---------------------------------------------------------------------
    // Everything from `#next` up to the first grid index at or after `now` is
    // in the past. It is skipped in ONE step of arithmetic rather than by
    // iterating — a tab that was away for four minutes is 1,920 sixteenths
    // behind and a loop would either take 1,920 turns or hit the burst guard
    // and never catch up at all.
    //
    // The grid itself is untouched. `#next` moves; `t0` and `bpm` do not. That
    // is the whole difference from `Transport.ts`'s `nextTime = now + 0.02`,
    // and it is why a stall here costs exactly the notes inside it.
    const due = this.grid.stepAt(now);
    if (this.#next < due) {
      const resumeAt = Math.ceil(due);
      this.stats.dropped += resumeAt - this.#next;
      this.stats.resyncs++;
      this.#next = resumeAt;
    }

    const until = now + this.#lookahead;
    let burst = this.#maxBurst;
    while (burst > 0) {
      const t = this.grid.timeOf(this.#next);
      if (t > until) break;
      // Cannot fire: `t < now` is a note the API plays immediately. `Math.ceil`
      // above has already excluded it; this is the guard that says so out loud
      // rather than trusting the arithmetic two lines up, because the cost of
      // being wrong is an audible flam and the cost of the branch is nothing.
      if (t < now) {
        this.stats.dropped++;
      } else {
        this.#onStep(this.#next, t);
        this.stats.scheduled++;
      }
      this.#next++;
      burst--;
    }
    if (burst === 0 && this.grid.timeOf(this.#next) <= until) this.stats.overruns++;
  }

  /**
   * Record how far the frame clock has wandered from the audio clock.
   *
   * PURELY A MEASUREMENT. Nothing in this file reads `#drift` back, and that is
   * the point: a scheduler that corrected the audio clock towards the frame
   * clock would be a scheduler whose tempo follows the GPU, which is the defect
   * this module exists to prevent. It is exposed so an experience can PRINT the
   * number — the two clocks coming apart is real (a suspended context, a
   * throttled tab, and `Synth.ts`'s own measurement of `currentTime` reading
   * 0.005333 s after six seconds under Puppeteer) and players who cannot see it
   * happening read it as the game being broken.
   *
   * @param frameSeconds a monotonic frame-side clock in SECONDS, sampled as
   *   close to `clock.currentTime` as the caller can manage.
   */
  observe(frameSeconds: number): void {
    this.#drift = frameSeconds - this.#clock.currentTime;
  }

  /**
   * Frame clock minus audio clock, in seconds, at the last `observe`. NaN when
   * nothing has observed yet — NOT zero, because zero is a claim.
   */
  get drift(): number { return this.#drift; }
}
