/**
 * ============================================================================
 *  ClockWatch.ts — the AudioContext clock is not a clock, and the two things
 *  that follow from that.
 * ============================================================================
 *
 * `Gate.ts` owns the browser's autoplay rule: no audio until a gesture. This
 * file owns the rule NOBODY WROTE DOWN, which is that a running AudioContext
 * can stop advancing `currentTime` while every other sign of life stays true —
 * `state` reads `'running'`, nodes connect, `setTargetAtTime` returns, and
 * nothing throws.
 *
 * ## The measurement this file exists because of
 *
 * A base-building game's audio module measured it and wrote it down:
 * **`ctx.currentTime` reads 0.005333 s after six seconds of wall clock under
 * Puppeteer**, in every headless mode and headful alike. The same state occurs
 * on iOS when a phone call interrupts the context. A healthy clock sits at a
 * ratio of 1.0 against wall time; that one sits at 0.00089. There is nothing in
 * between to be wrong about, which is why the threshold is 0.0002 and why there
 * is no hysteresis and no tuning to do.
 *
 * ## Why this is not four lines of `now - last`
 *
 * The advance is **accumulated per frame** rather than measured against a
 * reference taken at the top of the window, and that is the fix for a wrong
 * answer, not a refactor. With a single reference, a window that begins just
 * after a burst of audio time carries that burst inside it — so `advanced` is
 * large, the freeze is scored healthy, and detection is deferred a whole
 * window. Measured in the game this came out of: **a context frozen for 2.4 s
 * read as alive.** Summing only what happened INSIDE the window has no memory
 * of the burst.
 *
 * This is a health check that reports a plausible answer it never measured,
 * wearing an audio costume, and it is the reason
 * the detector is a published capability rather than a private habit: a
 * subsystem that cannot tell "the clock stopped" from "nothing happened to
 * schedule" will schedule into a frozen future forever, and every symptom of
 * that is silence, which looks exactly like a quiet moment.
 *
 * ## And the second thing, which is why `CueGate` is in this file
 *
 * A per-key rate limit is the standard defence against a pile-up machine-
 * gunning one sound. `@homie-rocks/audio/Rig.ts`'s `gate()` runs it on the AUDIO
 * clock, and that is correct for a racer whose context never freezes. Under a
 * frozen context the audio clock does not move, so `now - last` is 0 on every
 * call after the first and **the gate blocks its key for the rest of the
 * session** — a rate limit that has become a mute, at exactly the moment
 * (a phone call, a capture harness) when the recovery path needs to be audible
 * the instant the clock comes back.
 *
 * `CueGate` therefore runs on the WALL clock, which is the caller's — the same
 * `wallMs` it is already feeding `ClockWatch`, so the two cannot disagree about
 * what time it is. **The two gates are not merged and this is not a claim that
 * Rig's is wrong for Rig**; they are two answers to "which clock do you trust",
 * and this file is the one for a consumer that has a `ClockWatch` because it
 * has been bitten.
 *
 * ## What is NOT here
 *
 * The recovery. `ClockWatch` reports; it never calls `resume()`, never warns,
 * and never suspends anything. What a consumer does about a dead clock —
 * swallow the event backlog, keep the ambience running, retry the context — is
 * a decision about that game's frame, and the game that wrote this makes three
 * different ones in three places. A detector that also acted would be two
 * systems owning one volume.
 *
 * This file imports nothing.
 */

/**
 * Is the audio clock advancing? Fed two clocks per frame, answered once per
 * window.
 */
export class ClockWatch {
  /** Milliseconds of WALL time that must pass before a verdict is taken. */
  private readonly windowMs: number;
  /**
   * Audio-seconds per wall-millisecond below which the clock is declared dead.
   * A healthy context sits at 0.001 (one second per thousand milliseconds); the
   * measured frozen one sits at 0.00000089.
   */
  private readonly deadRatio: number;

  private audioAcc = 0;
  private wallAcc = 0;
  private lastAudio = -1;
  private lastWall = 0;
  private isDead = false;

  /**
   * @param windowMs   wall milliseconds per verdict. 1200 is the number the
   *                   game this came out of shipped and measured against.
   * @param deadRatio  audio-seconds per wall-millisecond. 0.0002 is a fifth of
   *                   a healthy clock and 225x the measured frozen one.
   */
  constructor(windowMs = 1200, deadRatio = 0.0002) {
    this.windowMs = windowMs;
    this.deadRatio = deadRatio;
  }

  /** The last verdict. False until a full window has been observed. */
  get dead(): boolean {
    return this.isDead;
  }

  /**
   * Feed one frame.
   *
   * @param audioNow  `ctx.currentTime`, seconds.
   * @param wallMs    a monotonic wall reading, milliseconds.
   * @returns true on the FRAME THE VERDICT FLIPS TO DEAD, and only then — so a
   *          caller can warn once rather than once per frame for a minute.
   */
  tick(audioNow: number, wallMs: number): boolean {
    // First frame establishes the references and contributes nothing. Taking a
    // delta against 0 here would credit the window with the whole age of the
    // context, which is the burst error this class exists to avoid.
    if (this.lastAudio < 0) {
      this.lastAudio = audioNow;
      this.lastWall = wallMs;
      return false;
    }
    // `Math.max(0, …)` because both clocks can go backwards on us: a context
    // rebuilt under our feet restarts `currentTime` at 0, and a wall clock that
    // is not monotonic exists on more machines than anyone would like.
    this.audioAcc += Math.max(0, audioNow - this.lastAudio);
    this.wallAcc += Math.max(0, wallMs - this.lastWall);
    this.lastAudio = audioNow;
    this.lastWall = wallMs;
    if (this.wallAcc <= this.windowMs) return false;

    const dead = this.audioAcc < this.wallAcc * this.deadRatio;
    const flipped = dead && !this.isDead;
    this.isDead = dead;
    this.audioAcc = 0;
    this.wallAcc = 0;
    return flipped;
  }

  /**
   * Forget everything, including the verdict.
   *
   * For a consumer that has just rebuilt its context: the old references belong
   * to a clock that no longer exists, and carrying `dead = true` across the
   * rebuild would suppress the first window of a context that is fine.
   */
  reset(): void {
    this.audioAcc = 0;
    this.wallAcc = 0;
    this.lastAudio = -1;
    this.lastWall = 0;
    this.isDead = false;
  }
}

/**
 * Per-key minimum gap, on the WALL clock. See the header for why that is not
 * the same instrument as `VoiceRig.gate`.
 */
export class CueGate {
  private readonly lastAt = new Map<string, number>();

  /**
   * @param key      what is being rate-limited. One namespace per gate.
   * @param minGap   seconds.
   * @param wallMs   the same wall reading `ClockWatch.tick` is being fed.
   * @returns true when the caller may fire, and RECORDS that it did.
   */
  allow(key: string, minGap: number, wallMs: number): boolean {
    const now = wallMs * 0.001;
    const last = this.lastAt.get(key);
    if (last !== undefined && now - last < minGap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  /**
   * Forget every key.
   *
   * A scenario reset re-seeds a world and replays its history; a gate that
   * remembers the old world suppresses the first of everything in the new one.
   */
  clear(): void {
    this.lastAt.clear();
  }
}
