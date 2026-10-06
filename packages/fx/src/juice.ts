/**
 * ============================================================================
 *  Juice: a combo counter, a hit-stop, a camera kick and a burst size.
 * ============================================================================
 *
 *  Four small pieces of feedback that every action game writes again, each a
 *  few lines, each wrong in the same way the first time:
 *
 *   - {@link Combo}: hits inside a window build a multiplier, and named
 *     thresholds fire a callout ONCE on the way up. The usual bug is a
 *     callout that fires again on every hit past the threshold.
 *
 *   - {@link HitStop}: freeze (or slow) the simulation for a few hundredths of
 *     a second on a hit. The usual bugs are stops that add up until the game
 *     stalls under a flurry, and a stop that swallows the rest of a long
 *     frame instead of only its own share of it.
 *
 *   - {@link kickImpulse}: how hard to kick the camera for a hit of a given
 *     strength at a given distance, as one number to hand to whatever spring
 *     the game's camera has (`Osc.kick` in @homie-rocks/camera/spring.js is
 *     one). A hit across the arena should not shake like one in your face.
 *
 *   - {@link burstScale}: how many particles a burst spawns and how large,
 *     by camera distance. A burst tuned up close is invisible at forty metres
 *     and a burst tuned for forty metres is a wall of quads up close; far away
 *     it should be FEWER and LARGER, and past a distance not spawned at all.
 *
 *  Each stands alone: use one and ignore the rest. They are numbers in and
 *  numbers out, driven by the `dt` they are handed and not by a clock, so they
 *  behave the same on a host and on a replica, hold still when the game is
 *  paused, and are tested in Node. Nothing here spawns a particle, moves a
 *  camera or plays a sound; the game does that with what these return.
 *
 *  This file imports nothing. No tuning has a default.
 * ============================================================================
 */

/** A threshold on the way up a combo, and what to show or say when it is reached. */
export interface ComboCallout {
  readonly at: number;
  readonly text: string;
}

export interface ComboSpec {
  /** Seconds a combo survives without a hit. */
  readonly window: number;
  /** Hits per multiplier step, the multiplier added per step, and its ceiling. */
  readonly perStep: number;
  readonly stepMult: number;
  readonly maxMult: number;
  /** Fired once each per combo, when the count reaches `at` exactly. */
  readonly callouts: readonly ComboCallout[];
}

/** What a hit did. The same object every call: read it, do not keep it. */
export interface ComboHit {
  count: number;
  multiplier: number;
  /** The callout this hit reached, or null. */
  callout: string | null;
}

export class Combo {
  private readonly spec: ComboSpec;
  private readonly result: ComboHit = { count: 0, multiplier: 1, callout: null };
  /** Hits in the current combo. */
  count = 0;
  /** What a score is multiplied by right now. 1 with no combo. */
  multiplier = 1;
  /** Seconds before the combo drops. For a HUD bar: `timeLeft / window`. */
  timeLeft = 0;
  /** The longest combo since construction or `reset(true)`. */
  best = 0;

  constructor(spec: ComboSpec) {
    this.spec = spec;
  }

  /** Register `n` hits at once (a multi-kill). The window restarts. */
  hit(n = 1): ComboHit {
    const o = this.spec;
    const before = this.count;
    this.count += n;
    if (this.count > this.best) this.best = this.count;
    this.timeLeft = o.window;
    this.multiplier = Math.min(o.maxMult, 1 + Math.floor(this.count / o.perStep) * o.stepMult);
    // The HIGHEST threshold crossed by this hit: a triple that jumps from 2 to
    // 5 announces 5 and not 3, and nothing already passed is announced again.
    let callout: string | null = null, top = before;
    for (const c of o.callouts) {
      if (c.at > before && c.at <= this.count && c.at >= top) { top = c.at; callout = c.text; }
    }
    this.result.count = this.count;
    this.result.multiplier = this.multiplier;
    this.result.callout = callout;
    return this.result;
  }

  /**
   * Advance by the game's `dt`. Returns the count of the combo that just
   * ended (to bank or announce it), or 0 on every other frame.
   */
  step(dt: number): number {
    if (this.count === 0) return 0;
    this.timeLeft -= dt;
    if (this.timeLeft > 0) return 0;
    const ended = this.count;
    this.reset(false);
    return ended;
  }

  /** Drop the combo now (the player was hit). `forgetBest` also clears the record. */
  reset(forgetBest: boolean): void {
    this.count = 0;
    this.multiplier = 1;
    this.timeLeft = 0;
    if (forgetBest) this.best = 0;
  }
}

export interface HitStopSpec {
  /** Seconds of stop per unit of hit strength, and the most one stop may last. */
  readonly seconds: number;
  readonly maxSeconds: number;
  /** Time scale while stopped: 0 is a freeze, 0.1 a crawl. */
  readonly scale: number;
}

export class HitStop {
  private readonly spec: HitStopSpec;
  /** Real seconds of stop still to run. */
  remaining = 0;

  constructor(spec: HitStopSpec) {
    this.spec = spec;
  }

  /**
   * Ask for a stop. It is the LONGER of this and what is already running, not
   * the sum: ten hits in a frame stop the game as long as the hardest one.
   */
  hit(strength: number): void {
    const want = Math.min(this.spec.maxSeconds, this.spec.seconds * strength);
    if (want > this.remaining) this.remaining = want;
  }

  get stopped(): boolean { return this.remaining > 0; }

  /**
   * Turn a real frame time into the time the SIMULATION should advance.
   * Feed the result to the game step; keep feeding the real `dt` to anything
   * that must not freeze (the camera kick, the UI, the audio).
   *
   * A frame longer than what is left of the stop gets the remainder at full
   * speed, so the total time lost to a stop is exactly its length at any
   * frame rate.
   */
  step(dt: number): number {
    if (this.remaining <= 0) return dt;
    const held = Math.min(this.remaining, dt);
    this.remaining -= held;
    if (this.remaining < 1e-9) this.remaining = 0;
    return held * this.spec.scale + (dt - held);
  }
}

export interface KickSpec {
  /** Impulse per unit of strength, in whatever the camera's spring is measured in. */
  readonly gain: number;
  /** Ceiling on the impulse. */
  readonly max: number;
  /** Distance at which a hit kicks half as hard; at twice it, a fifth. */
  readonly falloffM: number;
}

/** The impulse for a hit of `strength` at `distance` metres from the camera. */
export function kickImpulse(strength: number, distance: number, o: KickSpec): number {
  const k = distance / o.falloffM;
  return Math.min(o.max, (o.gain * strength) / (1 + k * k));
}

export interface BurstSpec {
  /** Particle count and size as authored, and the distance they were authored at. */
  readonly count: number;
  readonly size: number;
  readonly refM: number;
  /** Fewest particles a visible burst may have, and the most its size may grow by. */
  readonly minCount: number;
  readonly maxGrow: number;
  /** Past this distance the burst is not spawned. */
  readonly cullM: number;
}

/**
 * Count and size for a burst at `distance` from the camera, written to `out`.
 *
 * Up to `refM` it is exactly as authored. Past it the size grows with
 * distance (so it covers the same share of the screen, up to `maxGrow`) and
 * the count falls with the square of the growth (so the area drawn, which is
 * the cost, does not rise above what was authored, until `minCount` holds it up).
 * Past `cullM` the count is 0.
 */
export function burstScale(
  distance: number, o: BurstSpec, out: { count: number; size: number },
): { count: number; size: number } {
  if (distance > o.cullM) { out.count = 0; out.size = o.size; return out; }
  const grow = Math.min(o.maxGrow, Math.max(1, distance / o.refM));
  out.size = o.size * grow;
  out.count = Math.max(o.minCount, Math.floor(o.count / (grow * grow)));
  return out;
}
