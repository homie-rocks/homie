/**
 * ============================================================================
 *  Formant.ts — the third sustained instrument, and the one that is not music:
 *  a vowel, and the band a radio squeezes it through.
 * ============================================================================
 *
 * `Synth.ts` is the graph. `Patch.ts` is the two instruments a score is built
 * from. This is the one a CHARACTER is built from — the "readable non-speech
 * dialogue" technique a dozen shipping games use, where a band-limited
 * formant buzz under a subtitle reads as a person talking on a radio whose
 * words you cannot quite make out.
 *
 * ## The outcome this file owns
 *
 *   **A vowel is synthesised the same way in every game — a glottal source
 *   through three parallel bandpasses at the frequencies that DEFINE that
 *   vowel — and every number that decides who is talking is still argued in
 *   the game they belong to.**
 *
 * ## RULE 1, INHERITED FROM `Patch.ts` VERBATIM: THIS FILE NEVER CHOOSES A
 * ## NUMBER THAT DECIDES HOW SOMETHING SOUNDS.
 *
 * Every field of every spec below is REQUIRED. No optionals, no `?? 0.055`.
 * A game that forgets one fails to compile; a game that gets a DEFAULT gets
 * another game's cast, silently, and it will sound completely fine. That is
 * the failure this shape exists to make impossible.
 *
 * The ONE table that is not a taste is `VOWEL_FORMANTS`, and it is here for a
 * reason that has nothing to do with convenience: F1 and F2 do not describe a
 * vowel, they ARE the vowel. 730/1090 is "ah" in every language, every game and
 * every human throat; a game that "retuned" them would not have a different art
 * direction, it would have a different word. It is acoustics, like `mtof`.
 *
 * ## Why it is here
 *
 * One base-building game wrote this first, and its own header names the
 * technique as general — *"the trick a dozen shipping games use for readable
 * non-speech dialogue"* — beside a cast of five characters who are entirely
 * that game's. The two halves were interleaved in one class, so the vowel table
 * and the vocal tract could not be reached by anything else without taking the
 * whole cast and a 384,400 km light delay with them.
 *
 * ## WHAT DELIBERATELY DID NOT COME
 *
 * The cast: who speaks, their f0 and pitch span, which of them is on the air
 * and which is in the room, the prosody contour, the syllable count from the
 * text length, the skip probability, the dropout probability per origin, the
 * squelch tail, one character's semitone quantiser and the 47 Hz ring
 * modulator. Every one of those is a character. `ringHz` below is how a game
 * asks for the ring; nothing here knows why an AI would have one.
 *
 * The long-haul tail — a second compressor and a 9 ms comb standing in for a
 * dish structure a quarter of a million miles away — stayed in that game,
 * because a light-delay artefact is its fiction and not a radio.
 *
 * No template literals in this file.
 */
import { EPS, type AdsrSpec, type Synth } from './Synth.ts';

/**
 * Formant triples (F1, F2, F3) in Hz for five vowels.
 *
 * F1 and F2 alone determine the perceived vowel — this is the whole of vowel
 * acoustics in one table. Walking through them at syllable rate is what turns a
 * buzz into something the ear files as speech. F3 is nearly constant across
 * vowels and mostly carries speaker identity, which is why it barely moves.
 *
 * "ah", "eh", "ee", "aw", "oo", in that order. The ORDER is part of the
 * contract: a game seeds a PRNG and indexes this table, so reordering it
 * re-voices every line that game has ever recorded a capture of.
 */
export const VOWEL_FORMANTS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440], // "ah"
  [530, 1840, 2480], // "eh"
  [270, 2290, 3010], // "ee"
  [570, 840, 2410],  // "aw"
  [300, 870, 2240],  // "oo"
];

/** Everything one syllable needs and nothing it can guess. */
export interface SyllableSpec {
  /**
   * Relative level of each of the three formant bandpasses.
   *
   * Required rather than defaulted even though the shape is acoustics: 1 /
   * 0.55 / 0.22 approximates the natural formant amplitude rolloff, and equal
   * weights sound like a synthesiser doing an impression of a vowel — but how
   * far a game leans on F2 and F3 is how bright its cast is, and brightness is
   * a mix decision.
   */
  readonly weights: readonly [number, number, number];
  /** Q of F1, and Q of F2/F3. F1 is broader because it carries the body. */
  readonly q1: number;
  readonly q23: number;
  /**
   * The pitch glide WITHIN one syllable, as multiples of f0 at the start and
   * the end. Static pitch inside a syllable is the second-biggest tell that
   * this is a synthesiser, after the missing gaps between syllables.
   */
  readonly glide: readonly [number, number];
  /**
   * The breath layer: a white-noise band at F2, and how loud.
   *
   * Voiced speech is not purely periodic and a purely periodic vowel sounds
   * like a chiptune. The Q and the level are both a voice's texture.
   */
  readonly breathQ: number;
  readonly breathGain: number;
  /** Scale applied to `amp` before the envelope. */
  readonly ampScale: number;
  /**
   * The envelope. A consonantless syllable needs a slow-ish attack — 12 ms
   * reads as a vowel onset and 1 ms reads as a click — but where a game puts
   * that line is its own.
   */
  readonly env: AdsrSpec;
  /** Seconds the sources are left running past `dur`, for the release tail. */
  readonly tailPad: number;
  /**
   * Ring-modulator frequency in Hz, or 0 for none.
   *
   * NOT A BOOLEAN AND NOT DEFAULTED. A game that wants a synthetic roughness
   * says how rough; a game that does not, passes 0. Low enough and it reads as
   * texture rather than as a pitch, which is what keeps it from becoming a
   * robot-voice cliché — but that judgement is the game's, about its own
   * character, and a number chosen here would make every AI in the studio
   * sound like the first one.
   */
  readonly ringHz: number;
  /** Level of the ring modulator's depth, ignored when `ringHz` is 0. */
  readonly ringDepth: number;
}

/**
 * One syllable: a glottal pulse train through three bandpass formants.
 *
 * The source is a sawtooth, not a pulse train, because a saw's -6 dB/oct
 * spectrum is close enough to a real glottal source and costs one oscillator.
 * The three parallel bandpasses ARE the vocal tract.
 *
 * @param dest  where the voiced signal goes. Usually the radio bus.
 * @param room  a second, parallel destination — the dry tap a game crossfades
 *              to when the listener is inside the space the speaker is in.
 *              Pass the same node twice if a game has only one path.
 * @param vowel an INDEX into `VOWEL_FORMANTS`, taken modulo its length. The
 *              game picks the vowel because the game owns the PRNG that makes
 *              a line reproducible across captures.
 */
export function syllable(
  s: Synth, dest: AudioNode, room: AudioNode,
  t: number, f0: number, dur: number, vowel: number, amp: number, spec: SyllableSpec,
): void {
  if (s.busy) return;
  const F = VOWEL_FORMANTS[vowel % VOWEL_FORMANTS.length]!;

  const g = s.gain(EPS);
  g.connect(dest);
  g.connect(room);

  const src = s.osc('sawtooth', f0);
  src.frequency.setValueAtTime(f0 * spec.glide[0], t);
  src.frequency.linearRampToValueAtTime(f0 * spec.glide[1], t + dur);

  const nodes: AudioNode[] = [g];
  for (let i = 0; i < 3; i++) {
    const bp = s.biquad('bandpass', F[i]!, i === 0 ? spec.q1 : spec.q23);
    const bg = s.gain(spec.weights[i]!);
    src.connect(bp);
    bp.connect(bg);
    bg.connect(g);
    nodes.push(bp, bg);
  }

  const br = s.noise('white', true, 1.0);
  const brBP = s.biquad('bandpass', F[1]!, spec.breathQ);
  const brG = s.gain(spec.breathGain);
  br.connect(brBP);
  brBP.connect(brG);
  brG.connect(g);
  nodes.push(brBP, brG);

  let ring: OscillatorNode | null = null;
  if (spec.ringHz > 0) {
    const rg = s.gain(spec.ringDepth);
    ring = s.osc('sine', spec.ringHz);
    ring.connect(rg.gain);
    g.connect(rg);
    rg.connect(dest);
    nodes.push(rg);
    ring.start(t);
  }

  s.adsr(g.gain, t, amp * spec.ampScale, dur, spec.env);
  const end = t + dur + spec.tailPad;
  src.start(t);
  // The breath is offset into its own buffer by a function of the pitch, so two
  // syllables at the same f0 do not start on the same noise sample and phase
  // together into an audible click.
  br.start(t, (f0 % 7) * 0.13);
  src.stop(end);
  br.stop(end);
  if (ring) ring.stop(end);
  s.retireIn(src, end - s.now, ...nodes);
  s.retireIn(br, end - s.now);
  if (ring) s.retireIn(ring, end - s.now);
}

/** Everything a link dropout needs and nothing it can guess. */
export interface DropoutSpec {
  /** Seconds: the shortest dropout, and how much longer a random one may be. */
  readonly minLen: number;
  readonly lenSpread: number;
  /** Playback rate of the crackle buffer, and its random spread. */
  readonly rate: number;
  readonly rateSpread: number;
  /** Centre of the hash band, its random spread, and its Q. */
  readonly bandHz: number;
  readonly bandSpread: number;
  readonly bandQ: number;
  readonly peak: number;
  readonly attack: number;
  /** Seconds the source is left running past the burst. */
  readonly tailPad: number;
}

/**
 * A dropout: the link loses the packet. Returns the new schedule head.
 *
 * THE NOISE BURST IS THE POINT AND IT IS NOT DECORATION. A dropout that is only
 * silence reads as the game stalling. A dropout that is silence WITH a scrape of
 * digital hash reads as the link, which is the whole reason to put one in.
 *
 * @param rnd the game's own seeded generator, so a replayed line is identical.
 */
export function linkDropout(
  s: Synth, dest: AudioNode, t: number, rnd: () => number, spec: DropoutSpec,
): number {
  const len = spec.minLen + rnd() * spec.lenSpread;
  const n = s.noise('crackle', false, spec.rate + rnd() * spec.rateSpread);
  const bp = s.biquad('bandpass', spec.bandHz + rnd() * spec.bandSpread, spec.bandQ);
  const g = s.gain(EPS);
  n.connect(bp);
  bp.connect(g);
  g.connect(dest);
  s.perc(g.gain, t, spec.peak, spec.attack, len);
  n.start(t, rnd() * 2);
  n.stop(t + len + spec.tailPad);
  s.retireIn(n, t + len + spec.tailPad - s.now, bp, g);
  return t + len;
}

/** Everything a press-to-talk click needs and nothing it can guess. */
export interface ClickSpec {
  readonly bandHz: number;
  readonly bandQ: number;
  readonly peak: number;
  readonly attack: number;
  readonly decay: number;
  /** Offset into the noise buffer, so the click is the same click every time. */
  readonly offset: number;
  readonly tailPad: number;
}

/** PTT key-down/up. A few milliseconds of filtered impulse — felt, not heard. */
export function pttClick(
  s: Synth, dest: AudioNode, t: number, level: number, spec: ClickSpec,
): void {
  if (s.busy) return;
  const n = s.noise('white', false, 1.0);
  const bp = s.biquad('bandpass', spec.bandHz, spec.bandQ);
  const g = s.gain(EPS);
  n.connect(bp);
  bp.connect(g);
  g.connect(dest);
  s.perc(g.gain, t, spec.peak * level, spec.attack, spec.decay);
  n.start(t, spec.offset);
  n.stop(t + spec.tailPad);
  s.retireIn(n, spec.tailPad * 2, bp, g);
}

/** Everything the band-limited link needs and nothing it can guess. */
export interface RadioBandSpec {
  /** Bottom and top of the passband, and the Q of all four poles. */
  readonly hpHz: number;
  readonly lpHz: number;
  readonly poleQ: number;
  /**
   * The intelligibility bump: a peaking bell in the consonant band. A real
   * handset does this in the earpiece.
   */
  readonly articHz: number;
  readonly articQ: number;
  readonly articDb: number;
  /** The link compressor. A link clips its peaks; it does not distort. */
  readonly comp: {
    readonly threshold: number; readonly knee: number; readonly ratio: number;
    readonly attack: number; readonly release: number;
  };
  /** Waveshaper drive. Gentle, not obvious. */
  readonly drive: number;
}

/** The nodes a caller has to keep hold of after `radioBand` builds the chain. */
export interface RadioBand {
  /** Feed the voice in here. */
  readonly input: BiquadFilterNode;
  /** The FIRST pole of each end, whose corner a caller sweeps. See below. */
  readonly hp: BiquadFilterNode;
  readonly lp: BiquadFilterNode;
  /**
   * The compressor's output, BEFORE the level gain — the tap a game hangs its
   * own long-haul processing off, so a second path hears the same compressed
   * signal rather than a second compression of it.
   */
  readonly tap: DynamicsCompressorNode;
  /** The end of the chain. Connect it to wherever dialogue belongs. */
  readonly output: WaveShaperNode;
}

/**
 * The band a radio squeezes a voice through: two poles each side, a bell in the
 * consonant band, a compressor and a touch of drive.
 *
 * TWO POLES EACH SIDE AND NOT ONE, and that is the whole difference between
 * this and a lowpass. A single biquad rolls off at 12 dB/oct, which leaves
 * audible chest below the corner and audible air above it — and audible air is
 * exactly what makes a filtered voice sound like a filtered voice instead of
 * like a radio.
 *
 * ONLY THE FIRST POLE OF EACH END IS RETURNED FOR SWEEPING, which is deliberate
 * and is how the original game's interior crossfade already worked: sweeping
 * one pole of a cascaded pair opens the band while keeping the second pole's
 * shoulder, so the transition is heard as the channel OPENING rather than as
 * one filter being dragged across the signal.
 */
export function radioBand(s: Synth, spec: RadioBandSpec): RadioBand {
  const hp = s.biquad('highpass', spec.hpHz, spec.poleQ);
  const hp2 = s.biquad('highpass', spec.hpHz, spec.poleQ);
  const lp = s.biquad('lowpass', spec.lpHz, spec.poleQ);
  const lp2 = s.biquad('lowpass', spec.lpHz, spec.poleQ);
  const artic = s.biquad('peaking', spec.articHz, spec.articQ, spec.articDb);

  const comp = s.ctx.createDynamicsCompressor();
  comp.threshold.value = spec.comp.threshold;
  comp.knee.value = spec.comp.knee;
  comp.ratio.value = spec.comp.ratio;
  comp.attack.value = spec.comp.attack;
  comp.release.value = spec.comp.release;

  const crunch = s.shaper(spec.drive);

  hp.connect(hp2);
  hp2.connect(lp);
  lp.connect(lp2);
  lp2.connect(artic);
  artic.connect(comp);
  comp.connect(crunch);

  return { input: hp, hp, lp, tap: comp, output: crunch };
}

/**
 * Stable 32-bit hash of a string. FNV-1a.
 *
 * Here because the thing it is FOR is here: a line of dialogue seeds its own
 * voice from its id, so the same line sounds identical on every boot and two
 * capture rounds are comparable. A `Math.random()` seed makes a blind A/B judge
 * compare two different performances and call it a rendering difference.
 */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
