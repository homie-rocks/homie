/**
 * ============================================================================
 *  ChargeTone.ts — the continuous voice that tells a player what they are
 *  holding, and how much of it there is.
 * ============================================================================
 *
 * `Synth.ts` is the graph, `Voice.ts` is the two generic one-shots and the
 * spatial plumbing, `Rig.ts` is the voice registry. This is one voice — the
 * only one in either racer that is a whole SOUND rather than a piece of
 * scaffolding — and it is here because the two of them turned out to be one
 * thing wearing two names.
 *
 * ## The finding, for the fourth time
 *
 * The kart racer calls it `DriftCharge`; the space racer calls it `SlideTone`.
 * One is the mini-turbo building under a held drift, the other is the boost building
 * under a held air-brake. They were written months apart by two people looking
 * at two different games. Laid side by side:
 *
 *   the node graph          identical — a bandpass into a tremolo into an out
 *                           gain on `s.lead`, four oscillators (saw root, saw
 *                           +9 cents, square fifth −4 cents, saw octave +6
 *                           cents) at 0.5 / 0.34 / EPS / EPS, plus one white
 *                           noise band started 70 ms late
 *   `set`                   identical, including the `cancelScheduledValues`
 *                           re-entry that exists because chaining a new charge
 *                           straight out of a flourish is what a good player
 *                           does and the pending ramp to silence would
 *                           otherwise cut the new tone off a sixth of a second
 *                           in
 *   `flourish`              identical — the sling upward under the boost, the
 *                           1.5x level bump at 30 ms, out at 170 ms
 *   `mute` / `dispose`      identical
 *
 * **THE ENTIRE DIVERGENCE IS SIXTEEN NUMBERS**, and every one of them is a
 * frequency, a level or a Q. The two games disagree about where the tone should
 * sit in the spectrum *because they disagree about what else is in the
 * spectrum*: a kart's engine puts almost everything it has below 1.5 kHz, so
 * the band opens at `f * 2.0`; a turbine's shaft is under 220 Hz and its blade
 * tone above 1.4 kHz, so the band opens at `f * 3.0` into the hole between
 * them. That is a value the game supplies, argued at the value, which is
 * exactly the case that reduces to one shared shape with the value passed in.
 *
 * There is no flag here and there must never be one. A `mode` parameter that
 * changed the ramp order or the tier ladder would mean the two were never one
 * thing — the `solveTyre`/`solveAxle` mistake: the kart racer's tyre solve and
 * the space racer's axle solve look alike, and a shared solve makes one game
 * drive like the other while nothing goes red.
 *
 * ## What did NOT move
 *
 * The tier ladders themselves, and the sidechain that goes with them. Both
 * games duck the engine and the music while a tier is held, and both do it from
 * their own `Audio.update()` against their own `*_SIDECHAIN` table — because
 * which buses step back is a mix decision about the buses THAT game has, and
 * the rig's `s.engineSide` is not the only thing either game leans on. The tone
 * knows how loud it is; it does not know who is getting out of its way.
 *
 * Nor does the CUE move. The kart racer reads `driftDir`/`driftTier`/`driftCharge`
 * off a kart and the space racer reads a slide off a ship; both live behind `Ctx`, which may
 * not cross this seam. The game decides it is held, at which tier, and how far
 * through — five arguments, no types.
 *
 * ## This file imports only from inside the package
 *
 * `EPS` and the `Synth` type from `./Synth.ts`, `stopAndDisconnectSources` from
 * `./Voice.ts`. `packages/audio/src` imports nothing outside itself, and a
 * probe checks it, which is what makes "no game type crosses
 * this seam, `import type` included" a fact rather than a promise.
 */
import { EPS, type Synth } from './Synth.ts';
import { stopAndDisconnectSources } from './Voice.ts';

/** One entry per tier, tiers 0..3. Four is the ladder both games shipped. */
export type PerTier = readonly [number, number, number, number];

/**
 * Everything the two games disagree about, and nothing else.
 *
 * Every field is a NUMBER a game supplies. If something ever wants to be a
 * boolean here, it is not a voicing — it is a second sound, and it belongs in
 * the game that wants it.
 */
export interface ChargeVoicing {
  /** Fundamental at the BOTTOM of each tier, Hz. */
  lo: PerTier;
  /** Fundamental at the TOP of each tier, Hz. The glide runs lo→hi across it. */
  hi: PerTier;
  /** Output gain per tier. 0 is read as EPS — the voice never truly stops. */
  level: PerTier;
  /** Gain of the square fifth per tier. */
  fifth: PerTier;
  /** Gain of the saw octave per tier. */
  octave: PerTier;
  /** Tremolo depth per tier. The top tier is the one that shudders. */
  trem: PerTier;
  /** Gain of the noise band per tier — the sizzle / white core. */
  noise: PerTier;
  /** Tremolo LFO rate, Hz. */
  lfoHz: number;
  /** Q of the noise band. Narrow is a whistle, wide is air. */
  noiseQ: number;
  /**
   * The bandpass centre as a multiple of the fundamental: `f * (a + tier * b)`.
   *
   * IT SITS ABOVE THE FUNDAMENTAL ON PURPOSE, in both games, so the voice's
   * energy lands on its upper harmonics rather than on its root — that is where
   * the presence bell on the lead bus is waiting, and it is the part of the
   * spectrum the game's engine leaves empty. Opening it further with the tier
   * also makes the step up read as brighter and not merely higher.
   */
  band: readonly [number, number];
  /** Bandpass Q: `a + tier * b`. */
  bandQ: readonly [number, number];
  /** Noise band centre: `f * a + b`, Hz. */
  noiseBand: readonly [number, number];
  /** How far the flourish slings the pitch above the tier's top: a multiplier. */
  flourishLift: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Clamp a tier to a literal index.
 *
 * This is `clamp(tier | 0, floor, 3)` written so the result TYPES as an index
 * into a 4-tuple. The package builds under `noUncheckedIndexedAccess`, and the
 * alternative — `table[ti] ?? 0` — is the tolerant-lookup shape these games
 * have already been bitten by twice: a fallback that renders perfectly and is
 * wrong. There is no legitimate out-of-range tier, so there is nothing to fall
 * back to.
 */
function tierIndex(tier: number, floor: 0 | 1): 0 | 1 | 2 | 3 {
  const t = tier | 0;
  if (t <= floor) return floor;
  return t >= 3 ? 3 : (t as 1 | 2);
}

/**
 * The highest-value single sound in either racer, and until it existed the
 * charge was three one-shot pings at the tier boundaries and silence in
 * between — so between pings the player had nothing to go on but the HUD.
 *
 * It is continuous and player-only. FOUR THINGS MOVE TOGETHER as the charge
 * builds and they are redundant on purpose: any one of them read alone would be
 * ambiguous under a full-throttle engine, but a listener only has to catch one
 * of the four to know which tier they are on.
 *
 *   pitch    a clear step per tier (`lo`/`hi`), plus a glide across the tier so
 *            the approach to the next one is audible before it lands
 *   level    a step into the first tier, then a few dB per tier after it
 *   timbre   the fifth, the octave and the noise band arrive on their own
 *            tiers, so a higher tier is a different sound and not a louder one
 *   motion   only the top tier has tremolo, which is the cue that there is
 *            nothing left to charge and it is time to let go
 *
 * It lives on `s.lead`, which is presence-lifted and is never ducked, because
 * the one thing that must survive a boost, a collision and a full band is the
 * tone telling the player what they are holding. Everything else sidechains out
 * of its way besides — that is the game's business, in its own `update()`, and
 * note that making room mattered far more than level did.
 *
 * Cost: 4 oscillators plus a tremolo LFO, one noise source and two filters.
 * Built once at unlock and never rebuilt; idle, it runs into a gain of 1e-4.
 */
export class ChargeTone {
  private readonly v: ChargeVoicing;
  private readonly out: GainNode;
  private readonly bp: BiquadFilterNode;
  private readonly trem: GainNode;
  private readonly lfoDepth: GainNode;
  private readonly root: OscillatorNode;
  private readonly detune: OscillatorNode;
  private readonly fifth: OscillatorNode;
  private readonly octave: OscillatorNode;
  private readonly fifthG: GainNode;
  private readonly octaveG: GainNode;
  private readonly noiseF: BiquadFilterNode;
  private readonly noiseG: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private live = true;
  private active = false;

  constructor(s: Synth, v: ChargeVoicing) {
    this.v = v;
    const now = s.now;

    this.out = s.gain(EPS);
    this.out.connect(s.lead);

    // Tremolo sits after everything, so it modulates the whole voice and not
    // just one partial. Base 1, LFO adds ±depth.
    this.trem = s.gain(1);
    this.trem.connect(this.out);
    const lfo = s.osc('sine', v.lfoHz);
    this.lfoDepth = s.gain(EPS);
    lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.trem.gain);
    lfo.start(now);
    this.sources.push(lfo);

    // A gentle bandpass tracking the fundamental keeps the saws from getting
    // harsh at the top tier while still letting the fifth and the octave
    // through. 600 Hz here is only the value it holds until the first `set`.
    this.bp = s.biquad('bandpass', 600, 0.7);
    this.bp.connect(this.trem);

    const mk = (type: OscillatorType, f: number, cents: number, g: number) => {
      const o = s.osc(type, f, cents);
      const og = s.gain(g);
      o.connect(og);
      og.connect(this.bp);
      o.start(now);
      this.sources.push(o);
      return { o, og };
    };

    const r = mk('sawtooth', v.lo[0], 0, 0.5);
    this.root = r.o;
    // +9 cents, not unison: the beat it produces is slow enough to read as
    // "energy" rather than as an out-of-tune synth.
    const d = mk('sawtooth', v.lo[0], 9, 0.34);
    this.detune = d.o;
    const f5 = mk('square', v.lo[0] * 1.5, -4, EPS);
    this.fifth = f5.o;
    this.fifthG = f5.og;
    const o8 = mk('sawtooth', v.lo[0] * 2, 6, EPS);
    this.octave = o8.o;
    this.octaveG = o8.og;

    // THE NOISE LAYER, and it is the only part of the voice that changes COLOUR
    // CLASS rather than degree. Whichever tier a game gives it a gain on is the
    // tier that stops sounding like a bigger version of the one below it —
    // the kart racer brings it in at tier 2 as a sizzle band, the space racer waits
    // for tier 3 and matches the mag-skirt going white-cored at the same
    // instant. Started 70 ms late so it never lands on the graph's own build.
    const air = s.noise('white', true, 1.0);
    this.noiseF = s.biquad('bandpass', 2400, v.noiseQ);
    this.noiseG = s.gain(EPS);
    air.connect(this.noiseF);
    this.noiseF.connect(this.noiseG);
    this.noiseG.connect(this.trem);
    air.start(now + 0.07);
    this.sources.push(air);
  }

  /**
   * @param held   is the player holding the thing that charges
   * @param tier   0..3
   * @param charge 0..1 progress through the current tier
   */
  set(now: number, held: boolean, tier: number, charge: number, tau: number) {
    if (!this.live) return;
    if (!held) {
      if (!this.active) return;
      this.active = false;
      this.out.gain.setTargetAtTime(EPS, now, 0.05);
      this.noiseG.gain.setTargetAtTime(EPS, now, 0.05);
      this.lfoDepth.gain.setTargetAtTime(EPS, now, 0.05);
      return;
    }
    const v = this.v;
    const ti = tierIndex(tier, 0);
    const c = clamp01(charge);
    const f = v.lo[ti] + (v.hi[ti] - v.lo[ti]) * c;

    if (!this.active) {
      // Coming back from silence — and possibly from a flourish, whose ramp to
      // silence is scheduled up to 170 ms ahead. Chaining a new charge straight
      // out of a boost is exactly what a good player does, so those pending
      // events have to go or the new tone gets cut off a sixth of a second in.
      this.active = true;
      const t0 = now;
      this.out.gain.cancelScheduledValues(t0);
      this.out.gain.setValueAtTime(EPS, t0);
      for (let i = 0; i < 4; i++) {
        const o = i === 0 ? this.root : i === 1 ? this.detune : i === 2 ? this.fifth : this.octave;
        const m = i === 2 ? 1.5 : i === 3 ? 2 : 1;
        o.frequency.cancelScheduledValues(t0);
        o.frequency.setValueAtTime(f * m, t0);
      }
    }

    this.root.frequency.setTargetAtTime(f, now, tau);
    this.detune.frequency.setTargetAtTime(f, now, tau);
    this.fifth.frequency.setTargetAtTime(f * 1.5, now, tau);
    this.octave.frequency.setTargetAtTime(f * 2, now, tau);
    this.fifthG.gain.setTargetAtTime(Math.max(EPS, v.fifth[ti]), now, tau);
    this.octaveG.gain.setTargetAtTime(Math.max(EPS, v.octave[ti]), now, tau);
    this.bp.frequency.setTargetAtTime(f * (v.band[0] + ti * v.band[1]), now, tau);
    this.bp.Q.setTargetAtTime(v.bandQ[0] + ti * v.bandQ[1], now, tau);
    this.noiseF.frequency.setTargetAtTime(f * v.noiseBand[0] + v.noiseBand[1], now, tau);
    this.noiseG.gain.setTargetAtTime(Math.max(EPS, v.noise[ti]), now, tau);
    this.lfoDepth.gain.setTargetAtTime(Math.max(EPS, v.trem[ti]), now, tau);
    this.out.gain.setTargetAtTime(Math.max(EPS, v.level[ti]), now, 0.02);
  }

  /**
   * Release. The tone does not simply stop — it slings upward and out under the
   * boost, which is what ties the payoff to the thing that earned it. Without
   * this the whoosh is just a sound that happened at the same time.
   */
  flourish(now: number, tier: number) {
    if (!this.live || tier <= 0) return;
    const v = this.v;
    const ti = tierIndex(tier, 1);
    const f = v.hi[ti];
    this.active = false;
    for (let i = 0; i < 4; i++) {
      const o = i === 0 ? this.root : i === 1 ? this.detune : i === 2 ? this.fifth : this.octave;
      const m = i === 2 ? 1.5 : i === 3 ? 2 : 1;
      const p = o.frequency;
      p.cancelScheduledValues(now);
      p.setValueAtTime(Math.max(p.value, 1), now);
      p.exponentialRampToValueAtTime(f * m * v.flourishLift, now + 0.11);
    }
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, EPS), now);
    g.exponentialRampToValueAtTime(v.level[ti] * 1.5, now + 0.03);
    g.exponentialRampToValueAtTime(EPS, now + 0.17);
    this.noiseG.gain.setTargetAtTime(EPS, now, 0.06);
    this.lfoDepth.gain.setTargetAtTime(EPS, now, 0.06);
  }

  mute(now: number) {
    if (!this.live) return;
    this.active = false;
    this.out.gain.setTargetAtTime(EPS, now, 0.08);
  }

  dispose() {
    this.live = false;
    stopAndDisconnectSources(this.sources);
  }
}
