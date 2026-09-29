import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  THE ADDITIVE ENERGY GOVERNOR, AND WHY IT IS ONE COPY NOW.
 * ----------------------------------------------------------------------------
 *  Every additive surface in a racer — particles, rings, trails, plumes, motes,
 *  shimmer and the effect lights — is multiplied by a single `gain` that falls
 *  as more bright things crowd the frame, and the emission rate is multiplied
 *  by a `density` that falls as the machine misses frames. Both curves lived
 *  in the two racers' `Effects.updateGain` / `Effects.updateLoad`,
 *  BYTE-IDENTICAL down to the last constant.
 *
 *  WHAT STAYED IN THE GAMES: the LOAD. What a boost costs, what a drift tier
 *  costs, what a radiating heat rack costs, and which of those a game even has
 *  — the kart game bills a kart standing on a boost pad, the ship game also bills
 *  an open radiator, and neither term means anything in the other game. Those
 *  are the eight lines that made `diff` call these two methods different, and
 *  they are the only lines that should have. The game adds up its own load and
 *  hands over a number.
 *
 *  THE COMMENTS BELOW ARE THE MEASUREMENT, NOT DECORATION, and they travelled
 *  unedited. The worked example cites a kart, a purple drift, a tunnel boost
 *  pad and 132 km/h because those are the frame a measured capture set
 *  actually photographed when these constants were last re-tuned. Delete the
 *  worked example and the next person re-derives the knee from fear rather
 *  than from a luma histogram, which is exactly what the retune was undoing.
 * ----------------------------------------------------------------------------
 */

const damp = (dt: number, rate: number) => 1 - Math.pow(rate, dt);

/**
 * One-pole smoothing of the frame time, so a single long frame cannot spend the
 * emission budget of the next second.
 */
export function smoothFrameTime(prev: number, dt: number): number {
  return prev + (dt - prev) * Math.min(1, dt * 2.5);
}

/**
 * Walk the emission budget down when the machine is missing frames and back up
 * when it has headroom. Returns the new scale; `prev` unchanged is the correct
 * answer in the band between the two thresholds, and that band is the point.
 */
export function stepLoadScale(prev: number, smoothDt: number, dt: number): number {
  // 18.2 ms: comfortably inside a 60 Hz budget, so a machine holding frame
  // never touches this. 14.7 ms: enough headroom that giving load back cannot
  // immediately cost the frame it was given back for.
  const HOT = 1 / 55, COOL = 1 / 68;
  if (smoothDt > HOT) return Math.max(0.30, prev - dt * 1.4);
  if (smoothDt < COOL) return Math.min(1, prev + dt * 0.09);
  return prev;
}

/**
 * How much of a distant emitter's brightness lands on the governor's bill.
 * Zero at `range` and beyond; the caller is expected to skip those outright.
 */
export function proximityLoad(distance: number, range: number): number {
  // Squared falloff, not linear: additive load is a screen-AREA problem
  // and a kart at 10 m covers roughly nine times the pixels of one at
  // 30 m. Weighting them 0.86 to 0.57 (the old linear curve) let a
  // fistful of distant effects hold the gain down while the one filling
  // the middle of the frame was undercounted.
  const t = 1 - distance / range;
  return t * t;
}

/**
 * The gain curve itself: `load` in, the new gain out, eased towards it.
 *
 * `prev` is last frame's gain and the return is this frame's, so the caller
 * assigns rather than accumulates — a governor that accumulates onto a shared
 * field is the defect `updateSignals` documents one method down.
 */
export function settleGain(prev: number, load: number, dt: number): number {
  // Knee at 0.75 rather than 1.0, and a steeper slope. Worked example, the
  // case the art direction names explicitly — the player boosting on a purple
  // drift, standing on a tunnel boost pad, at 7 m from the chase camera:
  //   w        = (1 - 7/70)^2                      = 0.81
  //   load     = (1.15 + 1.35 + 0.80) * 0.81 + 0.5 = 3.17   (0.5 = ignition)
  //   gain     = 1 / (1 + 0.5 * (3.17 - 0.75))     = 0.45
  // Every additive surface in this file — particles, rings, trails, plumes,
  // motes, shimmer, and the effect lights — is multiplied by that number, so
  // the whole stack lands at a bit under half strength and the tone mapper
  // still has headroom above it. One boosting kart alone gives load 1.15,
  // gain 0.83: the common case is barely attenuated at all.
  //
  // RE-TUNED AGAINST MEASUREMENT rather than against fear. The knee moves
  // from 0.75 to 1.05, the slope from 0.50 to 0.38 and the floor from 0.35 to
  // 0.45, which takes the worked example above from gain 0.45 to 0.55 and
  // leaves a single boosting kart completely unattenuated (load 0.93, under
  // the knee, gain 1.0) where it used to lose 17%.
  //
  // The justification is a measured capture set, which recorded the exact frame
  // this governor exists to protect: tier-3 drift + boost + the tunnel boost
  // pad, captured at 132 km/h. Mean display luma 74, 99th percentile 212,
  // 99.9th 245, and the fraction of pixels with all three channels at 250 or
  // above is 0.000%. The frame the art direction says must not white out was
  // nowhere near white — it was DARKER than the calm 55 km/h cruise (mean 91)
  // because the governor was spending a third of the additive budget defending
  // against a failure that does not occur. A conservative gain is not free:
  // it is paid for by the one frame in the game that is supposed to be
  // overwhelming. The floor still exists, the curve is still hyperbolic and
  // still monotonic, and the per-fragment Reinhard shoulders in Particles,
  // Trails and Plumes are unchanged — this only stops the governor throwing
  // away headroom the tone mapper had all along.
  const target = THREE.MathUtils.clamp(1 / (1 + 0.38 * Math.max(0, load - 1.05)), 0.45, 1);
  return prev + (target - prev) * damp(dt, 0.0015);
}

/**
 * ----------------------------------------------------------------------------
 *  THE OTHER GOVERNOR: emission DENSITY, which answers to the machine.
 * ----------------------------------------------------------------------------
 *  `settleGain` above is about how bright the frame is. This is about whether
 *  the frame arrives. The two are deliberately separate loops with separate
 *  time constants, and both games ran this one identically down to the last
 *  constant — the three curves it is built from are `smoothFrameTime`,
 *  `stepLoadScale` and nothing else.
 */
export class DensityGovernor {
  /** particle density asked for by the quality tier, before the governor */
  base = 1;

  /**
   * ADAPTIVE LOAD, 0.3..1. Multiplies both `particles.density` and every
   * continuous emission rate in an effects file.
   *
   * A quality tier is a guess made at boot from a renderer string. A phone
   * thermally throttling in lap two, or a pack fight arriving in the tunnel,
   * is not something a boot-time guess can know about, and the particle layer
   * is the right thing to give up first: it is the largest variable cost in the
   * frame and the least missed, because a shower with two thirds of its grains
   * still reads as a shower while a frame that arrives 40 ms late reads as a
   * black flash. Falls fast (half a second to the floor) and recovers slowly
   * (eight seconds back to full) so it cannot oscillate on a corner.
   */
  scale = 1;

  /**
   * The live density, i.e. `base * scale`. Emitters that hand `emit()` a count
   * let it apply this; emitters that loop over `count = 1` must apply it to
   * their RATE and then call `emitExact`, because one times any density still
   * rounds back to one.
   */
  emit = 1;

  /** Exposed rather than private so a harness can read what it settled to. */
  smoothDt = 1 / 60;

  /**
   * One step. Returns the new density; the caller assigns it to the particle
   * layer, and the caller is expected to skip the call entirely when `dt <= 0`
   * rather than have this invent an answer for a frame that did not happen.
   *
   * `pin` is the HARNESS HOOK — pin the emission density and hold the governor
   * open. Both games expose it as `window.__fx.pinDensity`, mirroring their
   * existing `__camRig` / `__drawBudget` / `__frameWatch` debug handles. Null
   * in normal play and nothing reads it unless a tool writes it.
   *
   * It exists because appearance harnesses are otherwise measuring the machine
   * rather than the effect. On a software rasteriser under load a game produces
   * a frame every second or two, this governor correctly slams `scale` to its
   * 0.30 floor, and a Low-tier density of 0.21 then lands the whole drift
   * shower at six percent of its authored count — so a test comparing two
   * builds is comparing how busy the host happened to be. Three consecutive
   * runs of the same build produced showers of 40, 4 and 25 particles for
   * exactly that reason.
   */
  step(dt: number, pin: number | null = null): number {
    if (pin !== null) {
      this.scale = 1;
      this.emit = pin;
      return this.emit;
    }
    this.smoothDt = smoothFrameTime(this.smoothDt, dt);
    this.scale = stepLoadScale(this.scale, this.smoothDt, dt);
    this.emit = this.base * this.scale;
    return this.emit;
  }
}
