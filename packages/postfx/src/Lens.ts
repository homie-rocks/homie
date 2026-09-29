/**
 * ===========================================================================
 *  @homie-rocks/postfx/Lens.ts — how a lens responds to a world, as a value.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS, AND IT IS THE ONE SEAM TWO BUILDS FOUND INDEPENDENTLY.
 *
 * Two games built without sight of each other's code reported the same seam,
 * and an agreement like that is much stronger evidence than either report
 * alone. The first, a walking game, found that two of ChainWorld's seven
 * fields were racer vocabulary: there are no speed lines at walking pace and
 * no boost to punch the lens with. The second found that ChainWorld's own
 * comment said it was EXACTLY what build() and sync() read off the game's
 * world, and that two of the seven were a racer's.
 *
 * The second went further and named the cost: `speedIntensity` and `fovPunch`
 * were load-bearing inside `sync`, and `CA_REST`/`CA_BOOST`,
 * `STREAK_REST`/`STREAK_BOOST`, `VIGNETTE_SPEED`, `IGNITE_TAU`,
 * `SPEED_FLATOUT` and the motion-blur shutter were all functions of them — a
 * platform package that knows what a boost pad is. Its warning was the one to
 * act on: by the third non-racer consumer, those fields would still have
 * counted as platform purely because nobody had disagreed with them.
 *
 * Both builds passed zeroes and both were RIGHT to — a zero is a value, not a
 * flag, and every term settles at its rest value so the picture is correct.
 * Being right about the value did not make the interface right.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, IN ONE SENTENCE
 * ---------------------------------------------------------------------------
 * `ChainWorld` is five fields now — scene, camera, width, height, settings —
 * and every one of them is a fact about ANY three.js world. The two that were a
 * racer's became `ChainSpec.lens`, which is a REQUIRED accessor the game
 * supplies plus a REQUIRED `LensLook`, and every constant that used to be
 * hardcoded in `sync` is a field of that look.
 *
 * ---------------------------------------------------------------------------
 * ON `RACER_LENS` AND `STILL_LENS` BEING SHIPPED PRESETS
 * ---------------------------------------------------------------------------
 * A preset is a shared default and this engine is right to be suspicious of
 * those: a game that gets a default silently inherits another game's art
 * direction and it looks completely fine. Two things make these different from
 * a default, and both are structural rather than promises.
 *
 *  1. NOTHING SUPPLIES ONE. `ChainSpec.lens` is required, `LensLook` has no
 *     optional member, and no code path in this package reaches for a preset.
 *     A game must NAME the one it wants, in its own file, on a line a reviewer
 *     reads. That is the difference between "I chose the racer's lens" and "I
 *     forgot to say".
 *  2. `RACER_LENS` SAYS WHAT IT IS IN ITS NAME. The complaint was never that
 *     these numbers exist — they are good and two games ship them. It was that
 *     a seven-field interface called `ChainWorld` required a boost. A preset
 *     called `RACER_LENS` is a library of good things behaving as a library.
 *
 * A game that wants neither writes its own object. That is thirty-four numbers
 * and it should be: they are the whole response of a lens to a world.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DID NOT DO, SAID OUT LOUD
 * ---------------------------------------------------------------------------
 * `Grade.ts` STILL EXPORTS `CA_REST`, `CA_BOOST`, `VIGNETTE_SPEED`,
 * `STREAK_*`, `IGNITE_*`, `SPEED_FLATOUT` and `KICK_*`, and `RACER_LENS` below
 * is built FROM them rather than restating them. That is deliberate and it is
 * an INSTRUMENT constraint, not a design one: the chain probe holds two PINNED
 * pre-move chains that import those names and checksums them on every run so
 * nobody can "fix" a break by editing a baseline, and deleting an export those
 * files import turns the probe BLOCKED —
 * which is the colour for "we could not measure it", not for "fine". They are
 * no longer read by anything that DECIDES: `sync` reads the look.
 */
import * as THREE from 'three';
import {
  CA_REST,
  CA_BOOST,
  VIGNETTE_SPEED,
  VIGNETTE_INNER_REST,
  VIGNETTE_INNER_FAST,
  STREAK_REST,
  STREAK_BOOST,
  IGNITE_TAU,
  IGNITE_GAIN,
  SPEED_FLATOUT,
  KICK_LO,
  KICK_HI,
} from './Grade.ts';

/**
 * WHAT A GAME READS OFF ITS OWN WORLD, in units this package does not name.
 *
 * `sustain` is a 0..1 "how much is this world doing", and `impulse` is a raw
 * event magnitude in whatever unit the game measures it in — `impulseLo` and
 * `impulseHi` are what renormalise it, which is why the unit can be the game's.
 * A racer reads speed and a boost's FOV punch in degrees. A game with neither
 * returns zeroes, and a zero is a value.
 */
export interface LensInput {
  sustain: number;
  impulse: number;
}

/** Reused by a game with no motion cue. Frozen, because it is shared. */
export const LENS_AT_REST: Readonly<LensInput> = Object.freeze({ sustain: 0, impulse: 0 });

/**
 * EVERY NUMBER THE LENS RESPONSE IS MADE OF. No optionals, no defaults.
 *
 * Grouped by what they do rather than alphabetically, because the grouping is
 * the only way a reader can tell which of the thirty-four they are looking for.
 */
export interface LensLook {
  // ── the followers ────────────────────────────────────────────────────────
  /** Time constant of the sustain follower, seconds. Stops a pad snapping the lens. */
  sustainTau: number;
  /** Impulse attack, seconds. Fast in. */
  impulseAttackTau: number;
  /** Impulse release, seconds. Slower out — the lens should not snap back. */
  impulseReleaseTau: number;
  /** Time constant of the slow follower whose LAG is the ignition pulse. */
  igniteTau: number;
  /** Gain on that lag before it is clamped to 0..1. */
  igniteGain: number;
  /** Raw impulse that reads as zero. Below this the event has not happened. */
  impulseLo: number;
  /** Raw impulse that reads as one. */
  impulseHi: number;
  /** Sustain at which the renormalised driver reaches 1. */
  sustainFull: number;

  // ── chromatic aberration ─────────────────────────────────────────────────
  caRest: number;
  caBoost: number;
  /** How much of the ignition pulse rides on top of the driver. */
  caIgniteLead: number;
  /** Ceiling on (drive + ignite lead) — the overshoot IS the event, bounded. */
  caCeiling: number;

  // ── speed streaks ────────────────────────────────────────────────────────
  streakRest: number;
  streakBoost: number;
  streakIgniteLead: number;
  streakCeiling: number;

  // ── the motion-blur shutter ──────────────────────────────────────────────
  /** Shutter at rest, in 60 Hz frames. */
  shutterBase: number;
  /** Extra shutter at full sustain. */
  shutterSustain: number;

  // ── vignette ─────────────────────────────────────────────────────────────
  /** Added to the game's authored vignette per unit of drive. */
  vignetteSustain: number;
  /** Added per unit of ignition pulse — the squeeze. */
  vignetteIgnite: number;
  vignetteInnerRest: number;
  vignetteInnerFast: number;
  /** How much of the ignition pulse closes the inner radius. */
  vignetteInnerIgnite: number;

  // ── the radial rush and the speed-line comb ──────────────────────────────
  rushSustainGain: number;
  rushSustainExp: number;
  rushSpeedQuad: number;
  rushKickSpeed: number;
  rushIgnite: number;
  /** Renormalised sustain at which the comb is fully open. */
  combGateFull: number;
  /**
   * THE FOUR GATE WEIGHTS, AND THEY EXIST BECAUSE A PROBE WENT RED.
   *
   * The first draft of this file left the two comb gates as
   * `max(smoothstep(fast, 0, gateFull), kick, ignite)` and
   * `min(ceiling, kick + ignite * boostIgnite)` — no per-term weight, because
   * in a racer every weight is 1. The capability probe then drove
   * `STILL_LENS` with a signal a walking game might plausibly
   * produce and found `comb` at 1: a look that is supposed to do nothing was
   * opening a gate.
   *
   * ONE OF THE TWO WAS NOT INERT. `comb` (the grade's `rush.y`) only ever
   * multiplies `lens.z`, which `STILL_LENS` holds at zero, so it could have
   * been argued harmless. `combBoost` (`rush.z`) could not: `Grade.ts`
   * reads `travelCap = 0.0125 + 0.0105 * rush.z`, so a still look with a
   * nonzero sustain would have lengthened the motion-blur travel cap — a real
   * picture change, in a game that asked for no lens response at all, arriving
   * the first day one of the four non-racers grew a motion cue.
   *
   * The weights are 1 in `RACER_LENS`, and `x * 1` is exact in IEEE 754, so no
   * racer value moves by a bit. Fixing the LOOK rather than loosening the check
   * is the point: a threshold nudged to make a probe pass is a probe that has
   * stopped measuring.
   */
  combSustain: number;
  combKick: number;
  combIgnite: number;
  combBoostKick: number;
  combBoostIgnite: number;
  combBoostCeiling: number;

  // ── bloom ────────────────────────────────────────────────────────────────
  bloomBase: number;
  bloomSustain: number;
  bloomKick: number;
  bloomIgnite: number;
}

/**
 * THE SHIPPED RACER RESPONSE. Named for what it is.
 *
 * Every value here is measured and argued somewhere: the `Grade.ts` constants
 * carry their own paragraphs, and the coefficients that used to be literals
 * inside `sync` carry theirs at the expression that reads them, below.
 */
export const RACER_LENS: LensLook = {
  sustainTau: 0.11,
  impulseAttackTau: 0.05,
  impulseReleaseTau: 0.28,
  igniteTau: IGNITE_TAU,
  igniteGain: IGNITE_GAIN,
  impulseLo: KICK_LO,
  impulseHi: KICK_HI,
  sustainFull: SPEED_FLATOUT,

  caRest: CA_REST,
  caBoost: CA_BOOST,
  caIgniteLead: 0.55,
  caCeiling: 1.35,

  streakRest: STREAK_REST,
  streakBoost: STREAK_BOOST,
  streakIgniteLead: 0.45,
  streakCeiling: 1.30,

  shutterBase: 0.50,
  shutterSustain: 0.34,

  vignetteSustain: VIGNETTE_SPEED,
  vignetteIgnite: 0.07,
  vignetteInnerRest: VIGNETTE_INNER_REST,
  vignetteInnerFast: VIGNETTE_INNER_FAST,
  vignetteInnerIgnite: 0.6,

  rushSustainGain: 0.0165,
  rushSustainExp: 1.5,
  rushSpeedQuad: 0.0125,
  rushKickSpeed: 0.0150,
  rushIgnite: 0.0085,
  combGateFull: 0.42,
  combSustain: 1,
  combKick: 1,
  combIgnite: 1,
  combBoostKick: 1,
  combBoostIgnite: 0.55,
  combBoostCeiling: 1.25,

  bloomBase: 0.88,
  bloomSustain: 0.06,
  bloomKick: 0.14,
  bloomIgnite: 0.18,
};

/**
 * A LENS THAT DOES NOT RESPOND, for a world with no motion cue.
 *
 * The REST values are the racer's, deliberately: a resting lens is a resting
 * lens whatever the game, the four non-racer games shipped against exactly
 * these, and every frame captured so far carries them. That is not a claim
 * that any of those frames was reviewed and approved. What is zero is every
 * RESPONSE — so a world that hands this look a nonzero sustain by
 * accident gets no picture change at all, rather than a racer's aberration
 * ramp arriving in a hollow.
 *
 * THIS IS BIT-IDENTICAL TO WHAT THOSE FOUR ALREADY HAD. They passed
 * `speedIntensity: 0` and `fovPunch: 0`, every follower settled at zero and
 * every term landed on its rest value; the responses being zero as well changes
 * nothing they render and changes what happens if they ever stop passing zero.
 *
 * The followers still run on zeroes — four `Math.exp` calls and a `Math.pow`,
 * which one of those games correctly named as a cost paid for nothing. It is
 * not branched away, and that is a deliberate call: a `if (look is inert)` is a
 * mode flag, and the flag would be read sixty times a second to save about a
 * dozen floating-point operations.
 */
export const STILL_LENS: LensLook = {
  sustainTau: RACER_LENS.sustainTau,
  impulseAttackTau: RACER_LENS.impulseAttackTau,
  impulseReleaseTau: RACER_LENS.impulseReleaseTau,
  igniteTau: RACER_LENS.igniteTau,
  igniteGain: RACER_LENS.igniteGain,
  impulseLo: RACER_LENS.impulseLo,
  impulseHi: RACER_LENS.impulseHi,
  sustainFull: RACER_LENS.sustainFull,

  caRest: CA_REST,
  caBoost: CA_REST,
  caIgniteLead: 0,
  caCeiling: RACER_LENS.caCeiling,

  streakRest: STREAK_REST,
  streakBoost: STREAK_REST,
  streakIgniteLead: 0,
  streakCeiling: RACER_LENS.streakCeiling,

  // The shutter is NOT zeroed and must not be. It is the length of a camera
  // reprojection blur, which is a fact about how fast the CAMERA moved and not
  // about how fast the world is going — a fixed camera produces none of it on
  // its own, and a game that pans produces it correctly. Zeroing it here would
  // silently switch motion blur off for every non-racer that asked for it.
  shutterBase: RACER_LENS.shutterBase,
  shutterSustain: 0,

  vignetteSustain: 0,
  vignetteIgnite: 0,
  vignetteInnerRest: VIGNETTE_INNER_REST,
  vignetteInnerFast: VIGNETTE_INNER_REST,
  vignetteInnerIgnite: 0,

  rushSustainGain: 0,
  rushSustainExp: RACER_LENS.rushSustainExp,
  rushSpeedQuad: 0,
  rushKickSpeed: 0,
  rushIgnite: 0,
  combGateFull: RACER_LENS.combGateFull,
  combSustain: 0,
  combKick: 0,
  combIgnite: 0,
  combBoostKick: 0,
  combBoostIgnite: 0,
  combBoostCeiling: RACER_LENS.combBoostCeiling,

  bloomBase: RACER_LENS.bloomBase,
  bloomSustain: 0,
  bloomKick: 0,
  bloomIgnite: 0,
};

/** What one frame of lens response comes out as. Written into, never allocated. */
export interface LensOut {
  /** chromatic aberration — the grade's `lens.x` */
  ca: number;
  /** speed-line gain — the grade's `lens.z` */
  streak: number;
  /** motion-blur shutter in 60 Hz frames — the grade's `lens.w` */
  shutter: number;
  /**
   * The two vignette terms, SEPARATELY, and the caller must add them in this
   * order to the authored base: `grade.w + vignetteDrive + vignetteIgnite`.
   *
   * NOT ONE `vignetteAdd`, AND THAT IS NOT FUSSINESS — it is a measurement.
   * The first draft of this file returned their sum, so the caller computed
   * `base + (drive + ignite)` where the code it replaced computed
   * `(base + drive) + ignite`. Floating-point addition is not associative:
   * the chain probe came back with 4 of 588 values red in a first-person
   * shooter and 3 in a kart racer, at the last unit in the last place —
   * 0.15905431609382598 against 0.159054316093826 — and every other value in
   * the trace bit-identical. That is the whole reason that probe compares with
   * `Object.is` and no epsilon: an epsilon would have called this equal, this
   * paragraph would not exist, and the next re-association would have had a
   * precedent.
   */
  vignetteDrive: number;
  /** See {@link LensOut.vignetteDrive}. Added LAST. */
  vignetteIgnite: number;
  /** vignette inner radius — the grade's `vig.y` */
  vignetteInner: number;
  /** radial zoom-blur travel — the grade's `rush.x` */
  rush: number;
  /** speed-line comb gate — the grade's `rush.y` */
  comb: number;
  /** boost comb gate — the grade's `rush.z` */
  combBoost: number;
  /** the bloom effect's `intensity` */
  bloom: number;
}

/**
 * The eased state and the response, in one object with no allocation per frame.
 *
 * A CLASS AND NOT A FUNCTION because three of the values are HISTORY —
 * `sustain`, `impulse` and the slow follower whose lag is the ignition pulse —
 * and history that lives in the caller is history two callers can share by
 * accident. `reset()` is what a chain rebuild calls; without it a chain rebuilt
 * mid-boost comes back with a full-strength streak over a frame whose
 * reprojection history has just been reseeded to "no motion", which is a lens
 * that says 120 km/h over an image that says parked.
 */
export class LensFollower {
  private sustain = 0;
  private impulse = 0;
  /** slow follower of `impulse`; the difference is the ignition onset pulse */
  private impulseSlow = 0;

  readonly out: LensOut = {
    ca: 0, streak: 0, shutter: 0, vignetteDrive: 0, vignetteIgnite: 0, vignetteInner: 0,
    rush: 0, comb: 0, combBoost: 0, bloom: 0,
  };

  /** A rebuilt chain has no history. See the class note. */
  reset(): void {
    this.sustain = 0;
    this.impulse = 0;
    this.impulseSlow = 0;
  }

  /**
   * One frame. Writes `this.out` and returns it.
   *
   * @param motionBlur whether the game's settings ask for a shutter at all
   */
  update(look: LensLook, input: LensInput, dt: number, motionBlur: boolean): LensOut {
    // Ease the sustain signal so an event does not snap the lens.
    const target = THREE.MathUtils.clamp(input.sustain, 0, 1);
    this.sustain += (target - this.sustain) * (1 - Math.exp(-dt / look.sustainTau));
    const speed = this.sustain;

    // The impulse. Punches in fast and releases slowly, which is the same
    // asymmetry a boost FOV itself uses — the lens should not snap back the
    // instant the event expires.
    const kickTarget = THREE.MathUtils.clamp(
      (input.impulse - look.impulseLo) / (look.impulseHi - look.impulseLo), 0, 1);
    this.impulse += (kickTarget - this.impulse) * (1 - Math.exp(
      -dt / (kickTarget > this.impulse ? look.impulseAttackTau : look.impulseReleaseTau)));
    const kick = this.impulse;

    // Leading-edge detector on the impulse. Clamped at both ends: it is only
    // ever positive while the impulse is rising, and it is capped at 1 so a
    // pathological frame delta cannot hand the lens a number none of the terms
    // below were tuned against.
    this.impulseSlow += (kick - this.impulseSlow) * (1 - Math.exp(-dt / look.igniteTau));
    const ignite = THREE.MathUtils.clamp((kick - this.impulseSlow) * look.igniteGain, 0, 1);

    // The sustained driver, renormalised. With the racer's 0.30 this is zero at
    // ~70% of top speed, 0.44 at 90 km/h, 0.78 at 101 km/h and 1.0 flat out —
    // and it does not need a boost to get there, which is the entire point.
    const fast = Math.min(speed / look.sustainFull, 1);
    // Whichever of "genuinely fast" and "boosting" is stronger drives the lens.
    // A boost taken at half pace still fringes and still streaks; a flat-out lap
    // with no boost now does too.
    const drive = Math.max(fast, kick);

    // Shutter is normalised against a 60 Hz frame so the blur length is a
    // function of how fast the world moves, not of how fast we happen to run —
    // and it lengthens with sustain, so a 101 km/h pass integrates a longer
    // camera streak than a 55 km/h cruise at the same frame rate. The subject
    // is masked out of the velocity in the shader, so this only ever smears the
    // world around the subject, never the subject.
    const shutter = motionBlur
      ? (look.shutterBase + look.shutterSustain * fast)
        * THREE.MathUtils.clamp(1 / 60 / Math.max(dt, 1e-4), 0.2, 2)
      : 0;

    const o = this.out;
    // The ignition pulse rides on top of `drive` in every lens term, and it is
    // deliberately allowed to push each of them past its own sustained ceiling
    // for a fraction of a second — that overshoot IS the event. The aberration
    // is still capped in TEXELS inside the shader (CA_MAX_TEXELS), so the
    // fringe cannot decorrelate the channels however hard this pushes.
    o.ca = look.caRest + (look.caBoost - look.caRest)
      * Math.min(look.caCeiling, drive + ignite * look.caIgniteLead);
    o.streak = look.streakRest + (look.streakBoost - look.streakRest)
      * Math.min(look.streakCeiling, drive + ignite * look.streakIgniteLead);
    o.shutter = shutter;

    // Vignette closes in with the same signal. Nothing here moves at all below
    // the gate, so a cruising frame prints down exactly as authored. The
    // ignition squeeze — the frame closing in hard for a fraction of a second
    // and opening back out — is the cheapest cue in the whole stack, it costs
    // one multiply, and it is the one that still reads at thumbnail size.
    o.vignetteDrive = look.vignetteSustain * drive;
    o.vignetteIgnite = look.vignetteIgnite * ignite;
    o.vignetteInner = look.vignetteInnerRest
      + (look.vignetteInnerFast - look.vignetteInnerRest)
        * Math.min(1, drive + ignite * look.vignetteInnerIgnite);

    // Radial zoom-blur. The sustained term is quadratic-ish in `fast`, so it is
    // off during ordinary driving and reaches a readable edge smear flat out; it
    // is combined with `max`, NOT `+`, so the boost path keeps the value it was
    // tuned to rather than gaining the sustained term on top of it. The term is
    // radial and therefore exactly zero at frame centre, which is what leaves
    // the racing line and the vanishing point untouched.
    o.rush = shutter > 0
      ? Math.max(look.rushSustainGain * Math.pow(fast, look.rushSustainExp),
        look.rushSpeedQuad * speed * speed + look.rushKickSpeed * kick * speed)
        + look.rushIgnite * ignite
      : 0;
    // The gate on the speed-line comb, driven by the SAME renormalised ramp the
    // gain uses. Gating on the raw signal while the gain used the ramp was how
    // the two ended up multiplying each other down to nothing.
    // The three weights are 1 in `RACER_LENS` and `x * 1` is exact in IEEE 754,
    // so no racer value moves by a bit; they exist so a still look can shut the
    // gate. See the `combSustain` docblock for the probe run that produced them.
    o.comb = Math.max(
      THREE.MathUtils.smoothstep(fast, 0.0, look.combGateFull) * look.combSustain,
      kick * look.combKick, ignite * look.combIgnite);
    // The boost comb — the tighter, whiter, faster second population. Letting
    // the ignition pulse drive it above the sustained impulse is what makes the
    // first few frames of a release visibly denser than the rest, which is the
    // difference between a lens that announces an event and one that reports a
    // state.
    // `combBoostKick` is 1 in `RACER_LENS`. It is NOT decoration: this value is
    // the grade's `rush.z`, which `Grade.ts` reads as
    // `travelCap = 0.0125 + 0.0105 * rush.z` — so unlike `comb` it is not
    // multiplied by anything a still look zeroes, and a still game with a
    // nonzero sustain would have got a longer motion-blur travel cap.
    o.combBoost = Math.min(look.combBoostCeiling,
      kick * look.combBoostKick + ignite * look.combBoostIgnite);

    // A touch more glow under the event; the flame and the sparks are the
    // payload. The ignition term is TRANSIENT and the sustained terms are
    // small, deliberately: a veil that is present for the whole of a boost is a
    // defect and a lift that exists for a third of a second cannot build one.
    o.bloom = look.bloomBase + look.bloomSustain * fast
      + look.bloomKick * kick + look.bloomIgnite * ignite;
    return o;
  }
}

// ---------------------------------------------------------------------------
// CameraMotionFollower — where a game with no vehicle gets its `sustain` from
// ---------------------------------------------------------------------------
//
// `LensFollower` above takes a `LensInput` and says nothing about where it
// comes from, which is right: a racer's sustain is its own speed over its own
// flat-out speed, and no package can know that. But a game with NO vehicle has
// only one honest source — how hard the player is moving the CAMERA — and that
// is arithmetic rather than art: two pose deltas, a normalisation and a smooth.
//
// The three numbers ARE art and none of them is defaulted. What counts as a
// brisk pan is a statement about the scale of a world (a lunar plain and a
// corridor disagree by an order of magnitude), what counts as a brisk orbit is
// a statement about a control scheme, and the time constant is how quickly the
// lens is allowed to notice — a shorter one reads as a twitchy lens and a
// longer one as a lens that lags the hand.

/** Every number the follower runs on. No defaults; see the note above. */
export interface CameraMotionLook {
  /** Linear speed, world units per second, that alone saturates the scalar. */
  linearFull: number;
  /** Angular speed, radians per second, that alone saturates it. */
  angularFull: number;
  /** Exponential smoothing time constant, seconds. */
  tau: number;
}

/**
 * A 0..1 "how hard is the camera moving" scalar from successive world poses.
 *
 * LINEAR AND ANGULAR ARE SUMMED AND THEN CLAMPED, not maxed. A slow dolly while
 * whipping the view is both at once and reads as more motion than either; a
 * max() would report the whip alone and under-drive the lens through exactly
 * the shot that needs it most.
 *
 * FROZEN SNAPS TO REST RATHER THAN HOLDING. A capture harness freezes, then
 * TELEPORTS the camera to a pose, then shoots — easing through that jump would
 * put a full-strength lens response on the first frames of every shot, and
 * which frame the shutter caught would decide how much. Snapping makes the
 * captured lens state a function of the POSE ALONE, which is the whole point of
 * the freeze. The pose is still RECORDED on a frozen frame — the copy happens
 * before the branch — so the first frame after a thaw measures against where
 * the camera actually is, not against where it was before the teleport.
 *
 * `dt` must be REAL time and not sim time: a lens is a property of the camera,
 * not of the simulation, and it keeps easing while the game is paused.
 */
export class CameraMotionFollower {
  /** The smoothed scalar. Read it; `update` writes it. */
  value = 0;
  private primed = false;
  private readonly pos = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly quatPrev = new THREE.Quaternion();

  reset(): void {
    this.value = 0;
    this.primed = false;
  }

  update(camera: THREE.Object3D, dt: number, frozen: boolean, look: CameraMotionLook): number {
    camera.getWorldPosition(this.pos);
    camera.getWorldQuaternion(this.quat);
    if (!this.primed) {
      this.prev.copy(this.pos);
      this.quatPrev.copy(this.quat);
      this.primed = true;
    }
    // A floor on the step rather than on dt: a zero-length frame is a division
    // by zero, and a harness stepping by exactly 0 is not hypothetical.
    const step = Math.max(dt, 1e-4);
    const linear = this.pos.distanceTo(this.prev) / step;
    // The angle between two quaternions, taking the SHORTER arc: |dot| and not
    // dot, because q and -q are the same rotation and the sign flips freely
    // frame to frame. Without the abs, half the frames of a slow orbit report a
    // near-180-degree whip.
    const angular = 2 * Math.acos(Math.min(1, Math.abs(this.quat.dot(this.quatPrev)))) / step;
    this.prev.copy(this.pos);
    this.quatPrev.copy(this.quat);

    const target = Math.min(1, linear / look.linearFull + angular / look.angularFull);
    if (frozen) this.value = 0;
    else this.value += (target - this.value) * (1 - Math.exp(-dt / look.tau));
    return this.value;
  }
}
