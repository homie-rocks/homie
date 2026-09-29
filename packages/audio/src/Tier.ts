/**
 * ============================================================================
 *  Tier.ts — the two cues either end of a held charge: the flash when a tier
 *  is reached, and the hole the payout goes through.
 * ============================================================================
 *
 * `ChargeTone.ts` is the continuous voice a player hears WHILE they hold a
 * charge, and it is already shared. This is what happens at the two moments
 * that voice does not cover — the instant a new tier lands, and the instant the
 * whole thing is let go — and it is here for the same reason `ChargeTone` is:
 * a kart racer and a space racer wrote the same three cues and disagreed only on
 * numbers.
 *
 * ## The outcome this file owns
 *
 *   **Reaching a tier is audible over a full-throttle machine without being
 *   mixed dead-centre when it belongs to somebody else, and letting go opens a
 *   hole in the mix that the payout lands in rather than fights.**
 *
 * ## Why it is here — the same finding, for the fifth time
 *
 * `ChargeTone.ts` records that the kart racer's `DriftCharge` and the space
 * racer's `SlideTone`
 * were one voice divided by sixteen numbers. The three cues around it went the
 * same way and were not compared at the time:
 *
 * **`tierFlash`** — the kart racer's `chargeTier` against the space racer's `tierFlash`,
 * laid side by side, are the SAME NINE LINES OF SCHEDULE: a bandpass into a
 * gain, a saw a fifth-and-a-bit below the tier's root sliding up to it over
 * 110 ms, a sine a fifth above sliding up an octave over 130, a percussive
 * envelope scaled by tier and halved for a rival, and both sources retired at
 * 300 ms. **The entire divergence is two numbers** — where the bandpass sits
 * relative to the root (1.6x against 2.4x) and the mix level of the sine
 * (0.42 against 0.40) — and the first of the two is the same argument
 * `ChargeTone` already makes: a kart's engine fills everything below 1.5 kHz
 * so the band opens low, a turbine leaves a hole in the middle so it opens
 * higher.
 *
 * **`releaseDuck`** — the duck pair at the top of the kart racer's `boost` and
 * the space racer's `ignite` is **BYTE-IDENTICAL, all eight numbers**, including
 * the overshoot. It is the same idea stated the same way twice: duck depth and
 * overshoot both climb with tier, so a purple release takes 8 dB out of the
 * engine for 140 ms and a blue one takes 3.5 dB for 90, and the three tiers are
 * as distinct on release as they are on the charge.
 *
 * **`releaseThump`** — the sub under the payout. Same six lines, six different
 * numbers, all of them a frequency or a duration: 62 Hz to 150+42n over 280 ms
 * in a kart, 54 Hz to 140+40n over 300 ms in a ship. A kart's sub has to get
 * out of the way of an exhaust; a ship's does not.
 *
 * ## What did NOT move
 *
 * Everything either payout does BETWEEN the duck and the thump, which is where
 * the two games actually sound different: the kart racer drives a crackle burst
 * through a shaper into a falling lowpass and then throws an air whoosh over it;
 * the space racer fires its own `crack` and a shorter whoosh. Those are two people's idea of
 * what a boost sounds like and merging them would merge the taste — the
 * `land`/`landing` finding in `Voice.ts`, again. The tier tables
 * (`CHARGE_LO` / `SLIDE_LO`), the sidechain amounts and every cue name stay in
 * the games too.
 *
 * ## RULE 1: this file never chooses a number
 *
 * Every field of every spec is required, including the twelve the two games
 * happen to agree on today. Two forks agreeing on a line is not agreement that
 * was ever tested by a requirement, and a default here would hand the next game one racer's mix
 * silently and it would sound completely fine. See `Patch.ts`'s note.
 */
import { EPS, type Synth } from './Synth.ts';

/** Everything the tier flash needs and nothing it can guess. */
export interface TierFlashSpec {
  /** Bandpass corner as a multiple of the tier's root. */
  readonly bandMul: number;
  readonly bandQ: number;
  /** The saw: starts at `root * fromMul`, slides to `root * toMul` over `glide`. */
  readonly sawFromMul: number;
  readonly sawToMul: number;
  readonly sawGlide: number;
  /** The sine, same three. It rides ABOVE the band rather than through it. */
  readonly sineFromMul: number;
  readonly sineToMul: number;
  readonly sineGlide: number;
  /** Level of the sine into the shared gain: `mixBase + tier * mixPerTier`. */
  readonly mixBase: number;
  readonly mixPerTier: number;
  /** Peak of the envelope: `(peakBase + tier * peakPerTier)`, times `rivalScale` when not prominent. */
  readonly peakBase: number;
  readonly peakPerTier: number;
  readonly rivalScale: number;
  readonly attack: number;
  readonly decay: number;
  /** How long the two sources run for. */
  readonly life: number;
}

/**
 * A tier landed.
 *
 * `prominent` is the one thing here that is not a number, and it is a ROUTE,
 * not a mode: the player's flash goes to the lead bus so it survives the same
 * full-throttle machine the charge tone has to survive, and a rival's stays on
 * their own positioned voice, where it belongs. Three machines charging behind
 * you should not all arrive dead centre and undimmed.
 *
 * @param root  the tier's root frequency in Hz. The table is the game's.
 * @param tier  ALREADY CLAMPED by the caller, which is where the game's idea of
 *              how many tiers there are lives.
 */
export function tierFlash(
  s: Synth, dest: AudioNode, t: number,
  root: number, tier: number, prominent: boolean, spec: TierFlashSpec,
): void {
  const g = s.gain(EPS);
  const bp = s.biquad('bandpass', root * spec.bandMul, spec.bandQ);
  bp.connect(g);
  g.connect(dest);
  const o = s.osc('sawtooth', root * spec.sawFromMul);
  o.frequency.setValueAtTime(root * spec.sawFromMul, t);
  o.frequency.exponentialRampToValueAtTime(root * spec.sawToMul, t + spec.sawGlide);
  const o2 = s.osc('sine', root * spec.sineFromMul);
  o2.frequency.setValueAtTime(root * spec.sineFromMul, t);
  o2.frequency.exponentialRampToValueAtTime(root * spec.sineToMul, t + spec.sineGlide);
  const og = s.gain(spec.mixBase + tier * spec.mixPerTier);
  o.connect(bp);
  o2.connect(og);
  og.connect(g);
  s.perc(
    g.gain, t,
    (spec.peakBase + tier * spec.peakPerTier) * (prominent ? 1 : spec.rivalScale),
    spec.attack, spec.decay,
  );
  o.start(t); o2.start(t);
  o.stop(t + spec.life); o2.stop(t + spec.life);
  s.retire(o, bp, g, og);
  s.retire(o2);
}

/**
 * The release duck, as `Synth.duck`'s own four arguments per bus, each a
 * `[base, perTier]` pair. Depth, hold and overshoot all climb with tier; the
 * overshoot is what sells "surging back under load" — see `Synth.duck()`.
 */
export interface TierDuckSpec {
  /** `[base, perTier]` for each of `Synth.duck`'s first four arguments, engine bus. */
  readonly engineDepth: readonly [number, number];
  readonly engineHold: readonly [number, number];
  readonly engineOver: readonly [number, number];
  readonly engineRecover: number;
  /** The same four for the music bus. */
  readonly musicDepth: readonly [number, number];
  readonly musicHold: readonly [number, number];
  readonly musicOver: readonly [number, number];
  readonly musicRecover: number;
}

/**
 * Open the hole. The engine and the music step back hard and fast so the payout
 * has somewhere to go, then come back PAST unity and settle.
 *
 * The caller decides whether this happens at all — a rival's payout does not
 * duck the player's mix, and that decision is the game's.
 */
export function releaseDuck(s: Synth, t: number, tier: number, spec: TierDuckSpec): void {
  s.duck(
    s.engineDuck.gain, t,
    spec.engineDepth[0] + tier * spec.engineDepth[1],
    spec.engineHold[0] + tier * spec.engineHold[1],
    spec.engineOver[0] + tier * spec.engineOver[1],
    spec.engineRecover,
  );
  s.duck(
    s.musicDuck.gain, t,
    spec.musicDepth[0] + tier * spec.musicDepth[1],
    spec.musicHold[0] + tier * spec.musicHold[1],
    spec.musicOver[0] + tier * spec.musicOver[1],
    spec.musicRecover,
  );
}

/** Everything the sub under a payout needs and nothing it can guess. */
export interface TierThumpSpec {
  readonly fromHz: number;
  /** Lands at `toBase + tier * toPerTier` Hz. */
  readonly toBase: number;
  readonly toPerTier: number;
  readonly glide: number;
  readonly peak: number;
  readonly attack: number;
  readonly decayBase: number;
  readonly decayPerTier: number;
  readonly life: number;
}

/**
 * The sub under the payout, so a boost is FELT as well as heard.
 *
 * @param scale the caller's own volume trim — a rival's payout is quieter and
 *              a higher tier is bigger, and both of those are the game's
 *              arithmetic, done before the call.
 */
export function releaseThump(
  s: Synth, dest: AudioNode, t: number,
  tier: number, scale: number, spec: TierThumpSpec,
): void {
  const o = s.osc('sine', spec.fromHz);
  const og = s.gain(EPS);
  o.connect(og);
  og.connect(dest);
  o.frequency.setValueAtTime(spec.fromHz, t);
  o.frequency.exponentialRampToValueAtTime(spec.toBase + tier * spec.toPerTier, t + spec.glide);
  s.perc(og.gain, t, spec.peak * scale, spec.attack, spec.decayBase + tier * spec.decayPerTier);
  o.start(t);
  o.stop(t + spec.life);
  s.retire(o, og);
}
