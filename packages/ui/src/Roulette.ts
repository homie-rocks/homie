/**
 * ============================================================================
 *  Roulette — a reel that slows to a stop, and knows nothing about what is on
 *  it.
 * ============================================================================
 *
 * A slot that spins through a list of faces and decelerates onto one. It is
 * the "you picked something up and here is the suspense" beat, and it is a
 * pure clock: it hands back an INDEX and whether this is the frame it landed.
 * What the faces are, what a face is worth, and what the widget does when it
 * lands are all the caller's.
 *
 * Both racers carried this identically — the same three fields, the same
 * cubic ease on the tick interval, the same modulo, the same
 * `t = -1`-means-stopped sentinel, in `updateItem`. Measured on 2026-08-21 the
 * whole difference between the two copies was **four numbers**:
 *
 *              time    floor    span
 *   kart       1.15    0.040    0.215
 *   space      0.95    0.035    0.200
 *
 * ---------------------------------------------------------------------------
 * THE EASE IS THE POINT, AND IT IS THE PART THAT IS EASY TO GET WRONG
 * ---------------------------------------------------------------------------
 * The gap between faces is `floor + span · f³`, where `f` is how far through
 * the spin we are. Cubic, not linear: a linear ramp reads as a reel being
 * BRAKED, and a cubic one reads as a reel running out of momentum, which is
 * the thing a slot machine actually does. The first face lasts `floor`
 * seconds and the last lasts `floor + span`, so the two numbers are "how fast
 * it starts" and "how much it slows", independently — which is why they are
 * two fields rather than one range.
 *
 * `t` is measured from the START of the spin and the interval is computed
 * against `t`, not against the last tick, so a dropped frame does not stretch
 * the reel: it skips faces instead. That is deliberate. A spin that runs long
 * because the machine hitched is a spin that is still going when the player
 * has already turned back to the road.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIELD IS REQUIRED
 * ---------------------------------------------------------------------------
 * No defaults on `RouletteTuning`. A game that forgets one would inherit the
 * other game's pacing, and pacing is the whole feel of this widget — it would
 * look completely fine and be somebody else's reel.
 * ============================================================================
 */
import { clamp } from './uiUtil.ts';

/** The three numbers that are a game's own, and none of them has a default. */
export interface RouletteTuning {
  /** how long one spin lasts, in seconds */
  time: number;
  /** the gap between the first two faces, in seconds — how fast it starts */
  floor: number;
  /** how much longer the LAST gap is than the first, in seconds */
  span: number;
}

export class Roulette {
  /**
   * Seconds since the spin began, or **-1 for "not spinning"**. The sentinel
   * is load-bearing rather than lazy: the callers use "not spinning" to decide
   * whether the slot shows the real thing you are holding, so a stopped reel
   * and a reel at t = 0 must not be the same state.
   */
  private t = -1;
  /** the `t` at which the reel advances to the next face */
  private next = 0;
  private idx = 0;

  constructor(private readonly tuning: RouletteTuning) {}

  /** true while the reel is turning. False before the first spin and after it lands. */
  get spinning() { return this.t >= 0; }

  /** which face is showing. Only meaningful while `spinning`. */
  get face() { return this.idx; }

  /** Begin. Called again mid-spin, this restarts the clock and keeps the face,
   *  which is what a second pickup during a spin should look like. */
  start() {
    this.t = 0;
    this.next = 0;
  }

  /**
   * One frame. Returns **true on the frame the reel lands**, and only that
   * frame; `spinning` is false from then on.
   *
   * `faces` is passed per call rather than held, because the list a game spins
   * through is the game's and may change between spins.
   */
  step(dt: number, faces: number): boolean {
    if (this.t < 0) return false;
    this.t += dt;
    if (this.t >= this.next) {
      this.idx = (this.idx + 1) % faces;
      const f = clamp(this.t / this.tuning.time, 0, 1);
      this.next = this.t + this.tuning.floor + this.tuning.span * f * f * f;
    }
    if (this.t >= this.tuning.time) {
      this.t = -1;
      return true;
    }
    return false;
  }
}
