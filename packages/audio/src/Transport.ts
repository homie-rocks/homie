/**
 * ============================================================================
 *  Transport.ts — the look-ahead step sequencer, and nothing above it.
 * ============================================================================
 *
 * `Synth.ts` is the graph. This is the CLOCK that decides when to write to it.
 * It knows that music is a repeating grid of steps at a tempo, that a step gets
 * scheduled a little ahead of the audio clock, and that the whole thing has a
 * bus that can be faded. **It chooses no note, no chord, no bed and no
 * arrangement** — `scheduleStep` is abstract and everything musical happens
 * inside the game's implementation of it.
 *
 * ## The outcome this file owns
 *
 *   **Every step is scheduled exactly once, slightly before it is due, at the
 *   current tempo; a stalled tab does not dump a hundred notes when it comes
 *   back; and starting, stopping and ducking the bus always leave the gain
 *   somewhere it can be heard from again.**
 *
 * ## Why it is here — three games, one sequencer, three copies
 *
 * `Music.ts` in a kart racer, a space racer and a base-building game is 471,
 * 604 and 532 lines. A survey of the games' audio measured them as 66%
 * shape-identical and only 43% byte-identical and concluded — correctly — that **the 23-point
 * gap is pure retuned constants** and that the notes stay in the game.
 *
 * That finding was about the ARRANGEMENT. It was never about the transport,
 * which is the same thirty lines in all three, down to this comment:
 *
 *     // A tab stall or a breakpoint leaves nextTime far in the past; jump the
 *     // sequencer forward rather than dumping a hundred notes at once.
 *
 * The three differ in SIX NUMBERS and nothing else: how far the bus is pulled
 * back when ducked, and the three glide times. The base game ducks to 0.28 over
 * 0.35 s where the racers duck to 0.22 over 0.12, and its start and stop fades
 * are 0.6 and 1.2 s against 0.2 and 0.3 — a slow bed under a base against
 * a loop under a race. **Values, not flags.** There is no branch in here and
 * there must not be one; see `Voice.ts`'s note on `land`/`landing`.
 *
 * ## What did NOT move, and it is most of `Music.ts`
 *
 * `scheduleStep` itself, every note table, every voice, `setFull` / `isFull`
 * and the bar-line latch in the racers, `setBed` / `rollRests` / the seeded
 * generator in the base game, and `setSolar` in the space racer. Also `setFinalLap`:
 * it is five lines in two games and it multiplies the tempo by 1.075 in one and
 * 1.055 in the other, which is a tempo decision about a race, not a property of
 * a sequencer.
 *
 * ## Why this class has no constructor
 *
 * Every consumer builds its own bus graph — a gain into `s.music`, then a
 * dozen sends and sub-buses in a particular order — and `out` is created part
 * of the way through that. A base constructor would have to run FIRST and would
 * therefore reorder every node in all three games. So `s` and `out` are
 * declared here and assigned by the subclass exactly where they always were,
 * and this class is a set of methods over that state rather than an owner of
 * it. A test of this package fingerprints the schedule to prove it.
 *
 * ## The frozen clock, which is correct behaviour and reads as a bug
 *
 * Under a suspended `AudioContext` `s.now` never advances. After the first fill
 * `nextTime` sits past the window forever and `update()` schedules nothing more.
 * **That is right**: 150 ms of music is queued and the sequencer waits. The
 * failure mode it avoids is the opposite one — a loop that keeps filling a
 * window that never moves. The base game wrote this down after meeting it; the note
 * travels with the code now instead of living in one of three copies.
 *
 * ## This file imports nothing outside the package
 */
import { EPS, type Synth } from './Synth.ts';

export abstract class MusicTransport {
  /** The graph. Assigned by the subclass's constructor, where it always was. */
  protected s!: Synth;
  /** The music bus this loop fades in and out. Assigned by the subclass. */
  protected out!: GainNode;

  /** Position in the grid, wrapped at `totalSteps`. */
  protected step = 0;
  /** The audio-clock time the next step is due. */
  protected nextTime = 0;
  /** Live tempo and the tempo it is easing toward. The subclass seeds both. */
  protected bpm = 0;
  protected bpmTarget = 0;

  protected running = false;
  protected ducked = false;

  /** How many steps before the grid repeats. */
  protected abstract readonly totalSteps: number;
  /** Linear gain the bus is pulled back to while ducked. */
  protected abstract readonly duckLevel: number;
  /** Fade times, in seconds, for start, stop and duck respectively. */
  protected abstract readonly startGlide: number;
  protected abstract readonly stopGlide: number;
  protected abstract readonly duckGlide: number;

  /**
   * How far ahead of the audio clock steps are scheduled, in seconds.
   *
   * 0.15 in all three consumers, so it is a default rather than an abstract —
   * but it is overridable, because it is the one number here that is a real
   * trade: longer survives a worse frame stutter, shorter makes a tempo change
   * arrive sooner. A game that wants a different bargain says so.
   */
  protected readonly lookahead: number = 0.15;

  /** One grid step in seconds. Sixteenths, so a quarter of a beat. */
  protected get stepDur(): number {
    return 60 / this.bpm / 4;
  }

  /** The game's music. Called once per step, slightly before `t`. */
  protected abstract scheduleStep(step: number, t: number): void;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = this.s.now + 0.12;
    // stop() faded the bus out; restarting has to undo that.
    this.s.glide(this.out.gain, this.ducked ? this.duckLevel : 1, this.startGlide);
  }

  stop(): void {
    this.running = false;
    this.s.glide(this.out.gain, EPS, this.stopGlide);
  }

  /** Pull the whole loop back under a menu without stopping the clock. */
  setDuck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.s.glide(this.out.gain, on ? this.duckLevel : 1, this.duckGlide);
  }

  /**
   * Pumped once per frame. Schedules every step that falls inside the window.
   *
   * See this file's header for what happens under a frozen audio clock, and why
   * scheduling nothing is the correct answer rather than a stall.
   */
  update(): void {
    if (!this.running) return;
    const now = this.s.now;
    // A tab stall or a breakpoint leaves nextTime far in the past; jump the
    // sequencer forward rather than dumping a hundred notes at once.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
    let guard = 48;
    while (this.nextTime < now + this.lookahead && guard-- > 0) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % this.totalSteps;
    }
  }
}
