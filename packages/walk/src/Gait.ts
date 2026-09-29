/**
 * ============================================================================
 *  Gait.ts — A WALK CYCLE'S CLOCK, which is not a pose rig and not a timer.
 * ============================================================================
 *
 *  ## THE SEAM THIS IS, IN ONE PARAGRAPH
 *
 *  `@homie-rocks/vehicle/pilot.ts` and `rig.ts`'s `DriverRig` are a POSE FUNCTION:
 *  scalars in — lean, steer, duck, breathe — joint angles out, and the map is
 *  MEMORYLESS. That is exactly right for a driver, because a driver's body is a
 *  function of what the machine is doing. A walk cycle is not a function of the
 *  present: the pose depends on a PHASE, the phase advances at a rate set by
 *  ground speed, and it has to survive a change of speed, a stop, a jump and a
 *  landing without a discontinuity — a foot that teleports mid-stride is the
 *  single most visible artefact in third-person animation. There is nowhere in
 *  `DriverRig` for a phase to live, and adding one would make the pose rig
 *  stateful, which is the property that makes it correct.
 *
 *  A third-person exploration game's figure module wrote that argument out and
 *  then wrote the clock underneath it, because there was nothing to import.
 *  This is that clock, and the eleven bevelled boxes it drove are still the
 *  game's — a skeleton is art direction and a phase is not.
 *
 *  ## THE THREE THINGS, AND EACH IS A DEFECT PREVENTED
 *
 *  1. **THE PHASE IS DRIVEN BY DISTANCE, NOT BY TIME.** `phase += speed * dt /
 *     stride`. A time-driven cycle runs at a constant rate while the ground
 *     moves at a variable one, and the contact foot SKATES. This is the whole
 *     difference between animation that reads as walking and animation that
 *     reads as a doll being dragged — and it is also what makes the cycle
 *     frame-rate independent for free, because `speed * dt` is metres
 *     travelled whatever the frame rate.
 *
 *  2. **THE BLEND WEIGHTS ARE FILTERED AND THEN RENORMALISED.** Four
 *     independent critically-damped filters settle at their own rates, so
 *     during a transition their SUM drifts — 1.3 is easy to reach on a
 *     take-off. Every joint is then over-rotated at once and the figure
 *     appears to convulse for a tenth of a second. The renormalisation is two
 *     lines and the bug it prevents is one nobody can reproduce on demand.
 *
 *  3. **A FOOTFALL IS A PHASE CROSSING, WRAP INCLUDED.** Not "every 0.4
 *     seconds". The phase is modulo 1, so a step across 0 shows up as a
 *     DECREASE, and a crossing test that forgets that misses one footfall in
 *     two — which sounds like a limp and reads as one. The audio, the dust and
 *     the foot are the same event by construction or they are three events
 *     that agree most of the time.
 *
 *  ## WHAT IS NOT HERE
 *
 *  No joints, no skeleton, no mesh, no material, no lantern, no squash
 *  amplitude. The game's figure module keeps all of that and should: hip swing
 *  0.72 rad, a knee that may only bend one way, and a lamp held 0.30 m out to
 *  the side because at 0.075 m it rendered as a white blob are that game's
 *  answers to that game's questions. What a package may own is WHEN.
 * ============================================================================
 */
import { damp1 } from '@homie-rocks/camera/spring.js';

/**
 * The four states a body on two legs is in, as WEIGHTS rather than as a mode.
 *
 * A mode flag would cut between poses; these are blended, and the blend is the
 * animation. The names are the ones `Stance` uses plus `idle`, because a
 * planted figure is somewhere between idle and walking and `Stance` has no word
 * for that — it is `gait`, and it is a continuum.
 */
export interface GaitWeights {
  idle: number;
  walk: number;
  air: number;
  slide: number;
}

/** The keys of `GaitWeights`, in one place, so a loop cannot miss one. */
export const GAIT_STATES = ['idle', 'walk', 'air', 'slide'] as const;
export type GaitState = (typeof GAIT_STATES)[number];

/**
 * Everything the clock cannot work out for itself. Both required.
 *
 * `stride` is METRES OF GROUND PER FULL TWO-STEP CYCLE and it is the number
 * that makes a figure look its own size: a 1.72 m stride on a 1.7 m figure is a
 * person walking, and the same phase rate on a figure half that height is a
 * child sprinting. No default, for the same reason as `WalkTune` — a game that
 * inherits one inherits another game's proportions and it looks completely fine.
 */
export interface GaitTune {
  /** metres of ground per full two-step cycle */
  stride: number;
  /** how fast a blend weight may change, as a time constant in seconds */
  blendTau: number;
}

/**
 * The clock. Feed it a stance, a speed and a gait; read a phase and four
 * weights that sum to one.
 *
 * Deliberately knows nothing about `Walker` — it takes the four numbers it
 * reads rather than the walker, so a game whose figure is driven by something
 * else entirely (a recording, a network peer, a cutscene) can still use it.
 */
export class GaitClock {
  /** 0..1 over one full two-step cycle. */
  phase = 0;
  /** Where the phase was last step, so a crossing can be detected exactly. */
  private prevPhase = 0;
  /** The live weights. Always renormalised by `step`; read after calling it. */
  readonly weights: GaitWeights = { idle: 1, walk: 0, air: 0, slide: 0 };

  private readonly raw: GaitWeights = { idle: 1, walk: 0, air: 0, slide: 0 };
  private readonly vel: Record<GaitState, { v: number }> = {
    idle: { v: 0 }, walk: { v: 0 }, air: { v: 0 }, slide: { v: 0 },
  };
  private readonly tune: GaitTune;

  constructor(tune: GaitTune) { this.tune = tune; }

  /**
   * One step.
   *
   * `planted`, `airborne` and `sliding` rather than a `Stance`, so this module
   * does not have to import one and a game with five states can map its own on
   * to these four. `gait` is 0..1 — how much of top speed — and is what
   * separates a stroll from a jog inside the walk weight.
   */
  step(dt: number, o: {
    planted: boolean; airborne: boolean; sliding: boolean; speed: number; gait: number;
  }): void {
    this.prevPhase = this.phase;
    // DISTANCE, NOT TIME — see the header. Advanced only while planted: a
    // figure in the air is not covering ground on its feet, and letting the
    // phase run through a jump means the legs keep striding in mid-air.
    if (o.planted) {
      this.phase += (o.speed * dt) / this.tune.stride;
      this.phase -= Math.floor(this.phase);
    }

    const target: GaitWeights = {
      idle: o.planted ? 1 - o.gait : 0,
      walk: o.planted ? o.gait : 0,
      air: o.airborne ? 1 : 0,
      slide: o.sliding ? 1 : 0,
    };
    if (dt > 0) {
      for (const k of GAIT_STATES) {
        this.raw[k] = damp1(this.raw[k], target[k], this.vel[k], this.tune.blendTau, dt);
      }
    }
    // Renormalise. The four filters settle independently and their sum drifts
    // during a transition; a sum of 1.3 over-rotates every joint at once and
    // the figure convulses for a tenth of a second on every take-off. Cheap,
    // and the alternative is a bug nobody can reproduce.
    const sum = this.raw.idle + this.raw.walk + this.raw.air + this.raw.slide;
    const inv = sum > 1e-4 ? 1 / sum : 1;
    for (const k of GAIT_STATES) this.weights[k] = this.raw[k] * inv;
  }

  /**
   * True when the phase passed `at` since the previous step, WRAP INCLUDED.
   *
   * The phase is modulo 1, so a step across 0 arrives as a DECREASE. A test
   * that reads `a < at && b >= at` and stops there misses exactly the crossing
   * at 0 — half of every walk's footfalls — and the symptom is a limp.
   */
  crossed(at: number): boolean {
    const a = this.prevPhase;
    const b = this.phase;
    return b < a ? a < at || b >= at : a < at && b >= at;
  }
}

/**
 * A SPEED, FOR A CLOCK WHOSE SPEED SOURCE MIGHT NOT HAVE ONE.
 *
 * `GaitClock` above takes a speed and is right to. This is what goes in front
 * of it when the figure is not yours — a simulation's worker, a network peer, a
 * recording, a replay — and the thing publishing its position may or may not
 * also publish how fast it is going.
 *
 * THE FAILURE IT PREVENTS IS THE WORST-LOOKING ONE AVAILABLE. A gait driven by
 * a speed that is always zero is a crowd of statues sliding across the ground:
 * every figure translating at full pace with its feet planted, which reads as
 * broken in a way that a wrong gait never does. And it happens by omission —
 * the source simply does not have the field, or has it as `undefined` on the
 * frames that matter, and nothing throws.
 *
 * So: take the published speed when there is a real number there, and otherwise
 * DIFFERENTIATE THE POSITION, which is always available because the figure is
 * being drawn somewhere. The first frame reports zero rather than a spike,
 * because there is no previous position to difference against and a figure's
 * first frame is exactly when it is most likely to have been teleported into
 * place.
 */
export class SpeedTracker {
  private lastX = 0;
  private lastZ = 0;
  private seen = false;

  /**
   * `published` is whatever the source offered — a number, `undefined`, `NaN`,
   * anything. `cap` is the caller's ceiling, and it is not optional: a
   * differentiated speed spikes enormously on the frame a figure is re-seated,
   * and an uncapped spike drives a stride length no skeleton can reach.
   */
  step(published: number | undefined, x: number, z: number, dt: number, cap: number): number {
    let sp = typeof published === 'number' && Number.isFinite(published) ? published : NaN;
    if (!Number.isFinite(sp)) {
      sp = this.seen && dt > 1e-5 ? Math.hypot(x - this.lastX, z - this.lastZ) / dt : 0;
    }
    this.lastX = x;
    this.lastZ = z;
    this.seen = true;
    return sp < 0 ? 0 : sp > cap ? cap : sp;
  }
}
