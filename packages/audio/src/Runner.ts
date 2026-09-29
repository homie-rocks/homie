/**
 * ============================================================================
 *  Runner.ts — RUNNING a BeatScheduler in a browser, which Beat.ts refuses to.
 * ============================================================================
 *
 * `Beat.ts` is the clock. It is deliberately inert: it reads a structure with a
 * `currentTime` on it, it has no `AudioContext`, no timer, no listener, no
 * lifecycle and no opinion about latency — *"a consumer may pump it from a
 * frame, from a `setInterval`, from a worker or from all three"*. Every one of
 * those sentences is right, and every one of them is an obligation handed to
 * whoever consumes it.
 *
 * **This is that obligation, discharged once.** It is the difference between a
 * scheduler and a machine a listener can hear.
 *
 * ## The outcome this file owns
 *
 *   **The music keeps its grid while the frame loop is dead, starts the moment
 *   the browser will let it, and reports where the listener is HEARING rather
 *   than where the scheduler is WRITING — with a device that refused to report
 *   its latency compensated by the graph term alone and never by a guess.**
 *
 * ## Why it is here, and why "one consumer" was not a reason to leave it
 *
 * Every line below started in one rhythm game's drum machine, which deferred
 * the largest piece of it in writing: *"The dual pump is a CANDIDATE … it is
 * eight lines and one consumer."* The same argument had already been wrong
 * once in the same game: its hold recogniser was deferred as *"ONE CONSUMER,
 * so not yet"*, and was later published as `@homie-rocks/input/Hold.ts` after
 * three copies were found inside that one game. Counting copies is the wrong
 * test. The question is *does this belong in a game*, and a drum machine does
 * not need to know how a browser's autoplay policy interacts with a look-ahead
 * window.
 *
 * ## The four things it owns, each of which is a measured finding
 *
 * **1. THE DUAL PUMP.** Measured in headless Chrome at 1600x900 with the
 * software rasteriser, an untouched page for thirteen seconds — *"worst gap
 * between pumps 2.197 s, dropped 79 steps, 45 resyncs"*. Both a `setInterval`
 * and a frame callback are queue entries behind the frame on the SAME main
 * thread, so neither alone is a clock. Both is not redundancy theatre: **a
 * timer is throttled in a background tab and a frame loop is stopped outright
 * in one**, by different amounts in every engine, so a foreground page gets the
 * better of the two rather than whichever one somebody happened to pick.
 * Pumping is idempotent (`Beat.ts` guarantees it), so the second pump costs a
 * comparison.
 *
 * **2. THE GATE FOR A GRAPH THAT ALREADY EXISTS.** "The host already has a
 * context, just unlock it" should be a STATED case rather than a lucky one.
 * `AudioGate`'s `GateHost.build(ac, volume)` assumes the graph is built ON the
 * gesture, and there are two independent reasons to be in the other position —
 * a clock has to be anchored before anything can be scheduled, and a test has
 * to be able to hand in an `OfflineAudioContext`. This file is the stated
 * case: `context()` answers null until the music has actually started,
 * `build()` starts it, and the gate's own contract ("must return null until
 * `build` has actually succeeded") is honoured without the gate ever owning
 * the graph.
 *
 * **3. THE ALREADY-RUNNING CONTEXT.** A context that is somehow already running
 * — an autoplay-permissive browser, a test flag, an offline render — must not
 * sit waiting for a gesture that is never coming. **Asked, not remembered**:
 * `state` is read at `init()` rather than a `hasGestured` flag being trusted.
 *
 * **4. THE COMPENSATED READOUT.** The question a picture answers is *"what is
 * the listener hearing now"*, not *"what is the scheduler writing now"*. Two
 * terms: the graph's own group delay, which nothing in the Web Audio API
 * reports and which every consumer must therefore MEASURE for itself (16.524 ms
 * on `Synth.ts`'s output chain), and the device's own `baseLatency +
 * outputLatency`, **or nothing at all** when the browser refused to say.
 *
 * ## The refusal that is the whole point of `compensation()`
 *
 * `Latency.ts` hands back `null` rather than `0` precisely so the decision has
 * to be written at a call site where somebody can see what was believed. **A
 * refusal falls back to the graph term ALONE.** Compensating by 16 ms when the
 * truth is 38 is visibly better than compensating by 0, and inventing 22 ms of
 * device latency nobody measured is how a plausible default gets quoted back as
 * a fact. There is no `try`/`catch` anywhere below for the same reason
 * `Latency.ts` has none: every branch is a property read, so there is nothing
 * to turn into a plausible default.
 *
 * ## What deliberately did NOT move, and it is most of a drum machine
 *
 * The tempo, the look-ahead, the pattern, the notes, the bar length, the
 * live-record quantise-and-skip-once, the graph delay's VALUE, and every fault
 * an experience wants to inject. `pump()` and `latency()` are ordinary methods
 * and not `#private` for exactly that last reason: a rhythm game reproduces
 * `Transport.ts`'s phase-reset and a "catching up" flam by overriding `pump()`
 * around `super.pump()`, so the package stays correct while the game's own
 * test measures a broken wiring. A package that knew the word "fault" would be
 * measuring itself.
 *
 * ## This file imports nothing outside the package
 */
import { AudioGate } from './Gate.ts';
import { BeatGrid, BeatScheduler, type AudioClock } from './Beat.ts';
import { outputLatency, latencyLine, type LatencyContext, type OutputLatency } from './Latency.ts';

/**
 * The device, as this module needs it — and it is STRUCTURAL for `Beat.ts`'s
 * reason: an `AudioContext` type drags a DOM lib into a module a Node harness
 * has to construct, and an `OfflineAudioContext`, a real context and a fake all
 * satisfy this identically.
 *
 * `state` is required here where `LatencyContext` has it optional, because this
 * module ACTS on it — `live` and the already-running start below both read it,
 * and a device that cannot say whether it is running is a device this class
 * cannot answer for.
 */
export interface RunnerDevice extends AudioClock, LatencyContext {
  readonly state: string;
  resume(): Promise<void>;
}

/**
 * Where the music is, written by the runner and read by everything that draws.
 *
 * IT IS DERIVED FROM THE AUDIO CLOCK AND NEVER FROM A FRAME CLOCK. `@homie-rocks/loop`
 * clamps its own delta, so a frame clock does not merely lag during a stall, it
 * PERMANENTLY LOSES THE TIME. A playhead driven off one slides
 * against the sound the moment the frame rate moves, and it looks completely
 * fine in a screenshot.
 */
export interface BeatReadout {
  /** Fractional step position, unbounded and monotonic. Compensated. */
  position: number;
  /** `position` folded into the loop, 0..loopSteps. */
  phase: number;
  /** Audio-clock seconds. */
  audioTime: number;
  /** Frame clock minus audio clock, seconds. NaN until observed. */
  drift: number;
  /** True once the device is actually running and the grid has been started. */
  live: boolean;
}

/** Everything a runner cannot work out for itself. No optionals but two. */
export interface BeatRunnerSpec {
  /** The device the sound comes out of. Read for `state`, latency and resume. */
  device: RunnerDevice;
  /**
   * The clock the SCHEDULER reads. Normally `device`, and kept separable
   * because `Beat.ts` takes a structure rather than a context on purpose — a
   * harness renders offline, and an experience that wants to prove which clock
   * it is on has to be able to hand over a different one.
   */
  clock: AudioClock;
  grid: BeatGrid;
  /** See `BeatSchedulerSpec.lookahead`. There is no default and must not be. */
  lookahead: number;
  maxBurst: number;
  /**
   * The music, or omitted and overridden. See `BeatRunner.onStep`.
   *
   * IT IS OPTIONAL HERE FOR A REASON THAT IS NOT TASTE: a subclass cannot pass
   * `(s, t) => this.something()` into its own `super()` call — `this` does not
   * exist until `super` returns, and TypeScript refuses it — so a derived
   * machine has to be able to answer by overriding a method instead.
   */
  onStep?: ((step: number, t: number) => void) | undefined;
  /** How often the timer pumps, milliseconds. */
  tickMs: number;
  /** false in a harness that drives `pump()` itself at times it chooses. */
  useTimer: boolean;
  /**
   * The graph's own group delay, in seconds. REQUIRED and there is no default:
   * nothing in the Web Audio API reports it, so the only honest way to produce
   * the number is to render the graph and measure it, which is a fact about one
   * experience's chain. See §4 of the header.
   */
  graphDelayS: number;
  /**
   * Master volume for the autoplay gate, or omitted to run WITHOUT a gate — an
   * offline rig, which has no window to listen on and needs no gesture.
   */
  volume?: (() => number) | undefined;
}

/**
 * A `BeatScheduler` that a listener can actually hear.
 *
 * Pumping is idempotent, so every path below may pump freely; `Beat.ts`
 * guarantees the second call in a row does nothing.
 */
export class BeatRunner {
  readonly grid: BeatGrid;
  readonly sched: BeatScheduler<AudioClock>;

  readonly #spec: BeatRunnerSpec;
  readonly #device: RunnerDevice;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** Null without a gate: an offline rig has no window and needs no gesture. */
  #gate: AudioGate | null = null;

  constructor(spec: BeatRunnerSpec) {
    this.#spec = spec;
    this.#device = spec.device;
    this.grid = spec.grid;
    this.sched = new BeatScheduler<AudioClock>({
      clock: spec.clock,
      grid: spec.grid,
      lookahead: spec.lookahead,
      maxBurst: spec.maxBurst,
      // Through `this.onStep`, never `spec.onStep` directly, so an override in
      // a subclass is the thing the scheduler reaches. The arrow captures
      // `this` lazily — `BeatRunner` is a base class, so `this` exists here —
      // and the scheduler cannot call it before `pump()`, which is after
      // construction in every path.
      onStep: (step, t) => this.onStep(step, t),
    });
  }

  /**
   * One step of the music, `t` seconds on the AUDIO clock.
   *
   * The base answers the spec's callback if there is one. A machine with music
   * of its own overrides this instead — see `BeatRunnerSpec.onStep` for why it
   * cannot simply pass a closure.
   */
  protected onStep(step: number, t: number): void {
    this.#spec.onStep?.(step, t);
  }

  /** The device this runner is speaking for. Read; never swapped. */
  get device(): RunnerDevice { return this.#device; }

  /** True once the device is actually running and the grid has been started. */
  get live(): boolean {
    return this.sched.running && this.#device.state === 'running';
  }

  // -------------------------------------------------------------------------
  //  Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Install the timer pump and the autoplay gate, and start immediately if the
   * device is already running.
   *
   * THE ORDER MATTERS AND THE LAST LINE IS THE ONE WITH THE ARGUMENT. See §3 of
   * the header: a running context waiting for a gesture that is never coming is
   * a silent machine with nothing in the log.
   */
  init(): void {
    if (this.#spec.useTimer) {
      this.#timer = setInterval(() => this.pump(), this.#spec.tickMs);
      const volume = this.#spec.volume;
      if (volume !== undefined) {
        const gate = new AudioGate({
          // `GateHost.context()` is typed `AudioContext` because the racing
          // games build theirs on the gesture. This runner reads a STRUCTURE,
          // for `Beat.ts`'s reason, and the gate only ever reads `.state` and
          // calls `.resume()` — both of which `RunnerDevice` requires. So the
          // cast is narrower than it looks, and it is written here rather than
          // by widening an interface two shipped games already implement.
          context: () => (this.sched.running ? (this.#device as unknown as AudioContext) : null),
          volume,
          build: () => { this.begin(); return true; },
        });
        gate.listen();
        this.#gate = gate;
      }
    }
    // Asked, not remembered. See §3 of the header.
    if (this.#device.state === 'running') this.begin();
  }

  /**
   * A gesture reached us. THE ONE DOOR, and it goes through the gate.
   *
   * Without a gate it starts directly. With one, the gate decides: it will not
   * retry a context this page has already been refused, which is what stops a
   * guest's tenth tap from allocating a tenth `AudioContext`.
   */
  unlock(): void {
    if (this.#gate === null) this.begin();
    else this.#gate.unlock();
  }

  /**
   * Start the music. Called from the first gesture, and idempotent.
   *
   * The scheduler is started on the NEAR side of `resume()` — which returns a
   * promise nothing awaits — so a resume that never settles (iOS, an
   * interrupted context) leaves the grid in a state a HUD can describe rather
   * than in no state at all.
   */
  begin(): void {
    if (this.sched.running) return;
    const d = this.#device;
    if (d.state !== 'running') void d.resume().catch(() => { /* `live` reports it */ });
    // Anchor the grid at the moment the player started it, so step 0 is the first
    // thing anybody hears rather than an arbitrary offset from context birth.
    this.grid.reanchor(0, d.currentTime + 0.08);
    this.sched.start(0);
    this.pump();
  }

  /**
   * Schedule everything due. Safe from anywhere, as often as you like.
   *
   * ORDINARY AND NOT `#private`. An experience overrides this to reproduce a
   * real wiring defect around `super.pump()` — see the header — and to sweep
   * its own voices. The package stays correct either way.
   */
  pump(): void {
    this.sched.pump();
  }

  /**
   * Hand over the FRAME clock, in seconds.
   *
   * A MEASUREMENT AND NOTHING ELSE. `Beat.ts` records it and never reads it
   * back; a scheduler that corrected the audio clock towards the frame clock
   * would be a scheduler whose tempo follows the GPU.
   */
  observe(frameSeconds: number): void {
    this.sched.observe(frameSeconds);
  }

  dispose(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#gate?.release();
    this.#gate = null;
    this.sched.stop();
  }

  // -------------------------------------------------------------------------
  //  Latency, and the refusal
  // -------------------------------------------------------------------------

  /**
   * The device's own account of how far behind it is, and NO FURTHER.
   *
   * Ordinary and not `#private` for the same reason `pump()` is: an experience
   * proving that a plausible default is worse than a refusal has to be able to
   * install one.
   */
  latency(): OutputLatency {
    return outputLatency(this.#device);
  }

  /**
   * How far behind the sound is, total, in seconds — and therefore how far back
   * in the grid the PICTURE has to be drawn.
   *
   * A DEVICE THAT REFUSED TO SAY IS COMPENSATED BY THE GRAPH TERM ALONE. See
   * the header: that is the honest fallback rather than a guess at the missing
   * one, and the `?? 0` below is the entire policy.
   */
  compensation(): number {
    return this.#spec.graphDelayS + (this.latency().total ?? 0);
  }

  /**
   * One line for a console, a HUD or a probe. It NAMES what it could not
   * measure, because "we could not measure it" and "we measured it and it was
   * fine" must never render as the same colour.
   */
  latencyLine(): string {
    return `${latencyLine(this.latency())}`
      + ` · graph ${(this.#spec.graphDelayS * 1000).toFixed(2)} ms`
      + ` · compensating ${(this.compensation() * 1000).toFixed(2)} ms`;
  }

  /**
   * How the transport is doing, as lines a console or a `?diag=` readout can
   * print. A player needs none of it; a person debugging at eleven at night needs
   * all of it, and needs it to be the truth rather than a plausible default.
   *
   * `NaN` IS NOT ZERO AND MUST NOT PRINT AS ONE, which is the whole reason this
   * is not three lines at a call site. `Beat.ts` returns `NaN` for a drift
   * nothing has observed yet — deliberately, "NOT zero, because zero is a
   * claim" — and `(NaN * 1000).toFixed(1)` is the string `"NaN"`, which reads
   * as a broken readout rather than as an honest one. The first consumer
   * guarded it; the second would have written the naive line, and a readout
   * that says `0.0 ms` of drift before anything has been measured is a
   * plausible default passing itself off as a measurement.
   */
  healthLines(): string[] {
    const st = this.sched.stats;
    const d = this.sched.drift;
    const drift = Number.isFinite(d) ? `${(d * 1000).toFixed(1)} ms` : 'not observed';
    return [
      this.latencyLine(),
      `drift (frame − audio) ${drift}`,
      `scheduled ${st.scheduled}  ·  dropped ${st.dropped}  ·  resyncs ${st.resyncs}`
      + `  ·  worst pump gap ${(st.worstGapS * 1000).toFixed(0)} ms`
      + `  ·  overruns ${st.overruns}`,
    ];
  }

  // -------------------------------------------------------------------------

  /**
   * Fill in where the listener is HEARING, in place.
   *
   * In place because this runs every frame and a fresh object per frame is
   * sixty allocations a second for five numbers.
   *
   * `position` is shifted back by the WHOLE latency path. Everything that draws
   * is downstream of that line: the question a picture answers is "what is the
   * listener hearing now", not "what is the scheduler writing now".
   *
   * @param loopSteps the bar length, folded into `phase`. The runner does not
   *   own it — a bar is a musical length and this class chooses no music.
   */
  readout(out: BeatReadout, loopSteps: number): void {
    const d = this.#device;
    out.audioTime = d.currentTime;
    out.drift = this.sched.drift;
    out.live = this.live;
    out.position = this.sched.running
      ? this.grid.stepAt(d.currentTime - this.compensation())
      : 0;
    const p = out.position % loopSteps;
    out.phase = p < 0 ? p + loopSteps : p;
  }
}
