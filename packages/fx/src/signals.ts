import * as THREE from 'three';
import { proximityLoad } from './energy.ts';

/**
 * ============================================================================
 *  What the effects layer tells the rest of the frame.
 * ============================================================================
 *  Two functions, and between them they were 112 lines of which ONE was not
 *  the same in both racers — `30` against `BASE_TOP_SPEED` — plus one extra
 *  `load +=` that the ship game has and the kart game has no state for.
 *
 *  `additiveLoad` is what the energy governor is billed. `settleGain` already
 *  lives in `energy.ts` and both games already call it; what stayed behind was
 *  the LOAD, on the (correct at the time) grounds that the load is the part
 *  the two racers disagree about. They disagree about one term of it.
 *
 *  `updateSignals` is the pair of numbers the post chain and the camera read —
 *  `speedIntensity` and `fovPunch`. It does not take a `Ctx`: it takes the two
 *  fields it writes, as a `SignalSink`, and each game's own `Ctx` satisfies
 *  that structurally with no cast and no call site changed. Nothing about a
 *  race, a track, an item or a match reaches this file.
 * ============================================================================
 */

/**
 * Frame-rate-independent easing, spelled exactly as both games spell it: the
 * fraction of the gap LEFT after one second. Same expression, same operand
 * order — the extraction was checked bit-exact, and `1 - rate ** dt` is not
 * guaranteed to be `1 - Math.pow(rate, dt)` to the last bit under every engine.
 */
const damp = (dt: number, rate: number) => 1 - Math.pow(rate, dt);

/** What `additiveLoad` reads off one machine. Both games' machine types satisfy it. */
export interface LoadMachine {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly boostTime: number;
  readonly driftTier: number;
  readonly starTime: number;
}

/**
 * ADDITIVE BUDGET. Each bright effect on screen contributes load weighted by
 * how close it is to the camera; the caller feeds the total to `settleGain`,
 * which falls hyperbolically. One boosting machine is free; a top-tier drift
 * plus a boost plus a star costs about half the additive brightness, which is
 * precisely the case both art directions say must not white out.
 *
 * `onPad` is asked separately because a machine standing on a boost pad is
 * sitting on the brightest surface in the game with its own wash on top — the
 * third term of the exact worst case the art direction names (boost + drift
 * + tunnel-exit bloom) — and the surface enum is the game's, not this
 * package's. It reads LAST FRAME's surface, deliberately, exactly as it did
 * inline.
 *
 * `extra` is the same shape for anything else a game bills the governor for,
 * and it is OPTIONAL RATHER THAN DEFAULTED TO ZERO. `load += 0 * w` is not a
 * no-op you can wave through in an extraction that claims the arithmetic is
 * unchanged — it is exact for a positive `load` and not for `-0` — so a game
 * that has nothing extra runs the statement it always ran, which is none.
 * The ship game bills its radiator rack here: a deck pool plus the bank glow,
 * weighted below a boost because the pool's peak is tier 2 rather than tier 4,
 * and billed at all because the case this governor exists to survive is now
 * "the whole pack crosses the terminator together and every one opens up".
 */
export function additiveLoad<M extends LoadMachine>(
  machines: readonly M[] | null | undefined,
  cam: THREE.Vector3,
  onPad: (m: M) => boolean,
  extra?: (m: M) => number,
): number {
  let load = 0;
  if (machines) {
    for (let i = 0; i < machines.length; i++) {
      const k = machines[i]!;
      const d = cam.distanceTo(k.position);
      if (d > 70) continue;
      const w = proximityLoad(d, 70);
      if (k.boostTime > 0) load += 1.15 * w;
      if (k.driftTier > 0) load += (0.3 + 0.35 * k.driftTier) * w;
      if (k.starTime > 0) load += 0.9 * w;
      if (onPad(k)) load += 0.8 * w;
      if (extra) load += extra(k) * w;
    }
  }
  return load;
}

/** What `updateSignals` reads off the player. Both games' machine types satisfy it. */
export interface SignalMachine {
  readonly forwardSpeed: number;
  readonly boostTime: number;
  readonly driftTier: number;
  readonly stunTime: number;
  readonly stats?: { readonly topSpeedMul?: number } | undefined;
}

/**
 * The two numbers this layer publishes. Each game's `Ctx` has both as plain
 * mutable numbers, so it IS one of these; nothing else about it is visible
 * here, which is what keeps the contract out of the package.
 */
export interface SignalSink {
  speedIntensity: number;
  fovPunch: number;
}

/**
 * ONE WRITER, and the reason this is a class rather than three fields on the
 * game: both this and `Race.updateCamera` used to read-modify-write
 * `ctx.speedIntensity` and `ctx.fovPunch` every frame with different curves and
 * different time constants. Because each accumulated ONTO the shared field
 * rather than onto its own state, whichever ran last did not just win — it
 * destroyed the other's smoothing, so the eased curve degenerated into
 * whatever the last writer's instantaneous value was. The state lives here and
 * the result is ASSIGNED, so the published value is a well-formed curve no
 * matter what order the systems run in.
 */
export class SignalState {
  /**
   * Boost-ignition spike, 0..1, decaying. Owned here because the release is a
   * single moment shared by every screen-space cue. Player-only in effect:
   * `updateSignals` is the only reader that matters and it only ever looks at
   * the player.
   */
  igniteImpulse = 0;
  signalSpeed = 0;
  signalFov = 0;
}

/**
 * Drives the render/camera effect requests, once per frame, from the player.
 *
 * `racing` and `baseTopSpeed` are the caller's, and `baseTopSpeed` is the only
 * value the two racers disagree about in the whole of this function: 30 m/s in
 * the kart game and `BASE_TOP_SPEED` (142) in the ship game. That line said `30`
 * in BOTH for a while, and "a number fitted at 30 m/s is not a
 * number at 142 m/s" is what it cost — `ratio` pinned at its 1.4 ceiling from
 * about 21 m/s onward, so `want` was 1 and `speedIntensity` sat at its ceiling
 * for an entire lap, which held the reprojection shutter, the chromatic
 * aberration and the speed lines at maximum on every frame of every shot. The
 * post chain was never wrong; it was being handed a constant.
 */
export function updateSignals(
  s: SignalState,
  k: SignalMachine | null | undefined,
  racing: boolean,
  baseTopSpeed: number,
  dt: number,
  out: SignalSink,
) {
  // Decays whether or not there is a player, so it cannot survive a reset.
  // ~0.35 s to nothing: long enough to be a beat, short enough that the
  // sustained boost is what carries the rest of the run.
  s.igniteImpulse = Math.max(0, s.igniteImpulse - dt * 2.9);
  if (!k) {
    s.signalSpeed = 0; s.signalFov = 0;
    s.igniteImpulse = 0;
    out.speedIntensity = 0; out.fovPunch = 0;
    return;
  }
  const top = baseTopSpeed * (k.stats?.topSpeedMul ?? 1);
  const ratio = THREE.MathUtils.clamp(Math.abs(k.forwardSpeed) / top, 0, 1.4);
  // Speed lines only above ~70% of top speed, and they ramp, never pop.
  const want = racing ? THREE.MathUtils.clamp((ratio - 0.70) / 0.42, 0, 1) : 0;
  const boost = racing && k.boostTime > 0 ? 1 : 0;

  // CAPPED, but no longer capped BELOW the post chain's own gates.
  //
  // `speedIntensity` is the single number the post chain multiplies its radial
  // blur, its chromatic aberration and its speed lines by. An earlier tuning
  // capped it at 0.66 to stop a boost pad pinning the radial blur at 1.0 and
  // smearing the hero machine into mush. That fixed the mush and created a
  // worse problem:
  // PostFX gated its speed lines at smoothstep(speed, 0.42, 1) and its zoom
  // blur on speed^2, so a ceiling of 0.66 left the streaks at a third strength
  // and the blur at a twentieth — and on the frame that was actually
  // photographed (a boost taken below the 70%-of-top ramp entirely) the whole
  // term evaluated to zero. That is the review note verbatim: no speed lines,
  // no smear, no difference from a cruise.
  //
  // Two things changed. The mush was never caused by the magnitude, it was
  // caused by the blur being applied to the SUBJECT — which PostFX now holds
  // out with a world-space sphere around the machine — so the ceiling can come
  // up. And boost is no longer a small addend on top of the speed ramp: it is a
  // FLOOR of its own, because a boost has to read as a boost at any speed it is
  // taken at. Flat out on a boost lands at 0.89; flat out without one, at 0.37;
  // a boost from a standstill still clears 0.52.
  const speedTarget = THREE.MathUtils.clamp(want * 0.42 + boost * 0.52, 0, 0.95);
  s.signalSpeed += (speedTarget - s.signalSpeed) * damp(dt, 0.02);
  // THE IGNITION SPIKE, ADDED AFTER THE SMOOTHING rather than into it.
  //
  // Routing it through the same easing would defeat the point: the easing has a
  // ~0.1 s time constant precisely so a boost pad cannot snap the lens, and a
  // spike that is eased is a plateau that arrives late. The impulse carries its
  // own decay, so adding it here gives the published signal the shape the
  // payoff needs — a hard leading edge on the frame the player let go of the
  // button, falling back onto the sustained value within a third of a second.
  // Ceiling unchanged at 0.95, so nothing downstream sees a value it was not
  // already tuned for.
  out.speedIntensity = Math.min(0.95, s.signalSpeed + s.igniteImpulse * 0.30);

  // Punch in fast, ease out slowly — the asymmetry is the whole kick. Held here
  // rather than left to the camera so the ramp survives an ordering change, and
  // so a stun visibly pulls the frame back in.
  //
  // 8.5 on a boost, and the gap to everything else is deliberate: PostFX has no
  // boost flag of its own and RECOVERS ONE FROM THIS NUMBER (see KICK_LO /
  // KICK_HI there), so the boost band has to sit clear of the most a drift or a
  // flat-out lap can produce — 3.3 and 3.2 respectively. The sustained term is
  // 4.2 degrees, up from 3.2: a widening lens is one of the five cues that has
  // to separate a flat-out frame from a cruise and it was contributing 1.8
  // degrees, under three percent of a 62-degree base, which is below the
  // threshold of noticing. At 4.2 the chase rig opens by 3.3 (it takes 0.78 of
  // this) and pulls the arm in to match, so the machine holds its size while
  // the world stretches past it.
  //
  // The ceiling on a NON-boost frame stays a single number, deliberately: the
  // drift branch takes a max rather than adding, so nothing without a boost can
  // publish more than 4.2, against 8.5 for a boost taken from a standstill.
  let fovTarget = boost * 8.5 + want * 4.2;
  if (k.driftTier > 0 && !boost) fovTarget = Math.max(fovTarget, 1.1 * k.driftTier);
  if (k.stunTime > 0) fovTarget = -3;
  const rate = fovTarget > s.signalFov ? 12 : 4.5;
  s.signalFov += (fovTarget - s.signalFov) * Math.min(1, dt * rate);
  // Same spike, same reasoning as the speed signal. 3.4 degrees on top of the
  // 8.5 a boost already publishes: the chase rig takes 0.78 of it, so the lens
  // opens by an extra 2.7 degrees on the release frame and settles back. That
  // is a punch you feel; a step from 62 to 65 degrees held for two seconds is a
  // focal length, and the review has correctly been calling it one.
  //
  // It stays clear of PostFX's KICK_LO/KICK_HI contract by construction: this
  // only ever ADDS, and only when a boost has just been cashed, so nothing
  // without a boost can be pushed across the threshold separating the two.
  out.fovPunch = s.signalFov + s.igniteImpulse * 3.4;
}
