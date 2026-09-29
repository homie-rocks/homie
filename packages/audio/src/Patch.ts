/**
 * ============================================================================
 *  Patch.ts — the two sustained instruments every score in the games this was
 *  extracted from turned out to be built from, and not one number of any of
 *  them.
 * ============================================================================
 *
 * `Synth.ts` is the graph. `Transport.ts` is the clock that decides when a step
 * happens. This is what a step PLAYS, for the two patches that came back three
 * times — and it is the layer that most deserved a hard boundary, because a
 * patch is exactly where an extraction can quietly hand one game the other
 * game's art direction.
 *
 * ## The outcome this file owns
 *
 *   **A chord and a plucked note are built the same way in every game, and
 *   every number that decides how they SOUND is still argued in the game that
 *   plays them.**
 *
 * ## Why it is here — the survey said it before anybody moved a line
 *
 * A survey of the games' audio measured a kart racer's `Music.ts` against a
 * space racer's at 66% shape-identical and 43% byte-identical, and named the
 * gap:
 *
 *     The 23-point gap is pure retuned constants — the same patch, the same
 *     node graph, the same envelope, different numbers.
 *
 * and then, on the third copy, found that a base-building game had already done
 * the extraction work for the music instruments without knowing it, and that
 * its shape was the one the shared module should take.
 *
 * It is right, and this file is that shape. The base game's `pad` already takes
 * every one of its numbers off a `BedSpec`; the racers' two had theirs written
 * into the function body. Laid side by side the three build the SAME nine
 * nodes in the SAME order with the SAME six edges, and disagree on:
 *
 *   the lowpass corner        700 Hz · 600 Hz · a bed's own `padLP`
 *   how far the swell opens   1500 · 1300-or-1900 · `padLP * 1.5`
 *   the detune pair           -7/+8 cents · -8/+9 · -6/+7
 *   the third oscillator      a triangle an octave up at 0.30 · at 0.24 · a
 *                             THIRD SAW 33 cents flat at 0.50 in the cluster bed
 *   the envelope              a: 0.32 · 0.36 · a bed's own `padAttack`
 *
 * Five differences, fourteen numbers, and **every one of them is a decision
 * about what else is in that game's spectrum.** A kart's engine puts almost
 * everything below 1.5 kHz; the base game has nothing in the mix at all above the
 * comms band. Merging the numbers would merge the taste — the `land`/`landing`
 * finding in `Voice.ts` and the sixteen numbers in `ChargeTone.ts`, a third
 * time.
 *
 * ## RULE 1, AND IT IS THE WHOLE DESIGN: THIS FILE NEVER CHOOSES A NUMBER.
 *
 * Every field of every spec below is **required**. No optionals, no `?? 700`,
 * no defaults. The host platform's own audio layer states this law, and the
 * reason applies unchanged here:
 *
 *     A knob that has no "off" — a frequency, a tempo — is REFUSED with the
 *     closed set that would have worked, rather than filled in with something
 *     core picked.
 *
 * A game that forgets `lpOpenHz` fails to compile. A game that gets a DEFAULT
 * gets **the other game's art direction, silently, and it will sound completely
 * fine.** That is the failure this file is shaped to make impossible, and it is
 * the only reason the specs are as wide as they are.
 *
 * ## What deliberately did NOT move
 *
 * The note tables, the voicings, the arp order, the bar-line latch, the kit
 * (kick / snare / hat / shaker — the racers have one and the base game
 * deliberately has none), the space racer's `flatTwo` Phrygian bend and its
 * eclipse, the base game's seeded rests, and every `bass` / `sub` / `tone` /
 * `shimmer`. `sub` looks like a candidate and is not: the kart racer's is a
 * driven saw through a resonant lowpass with a 1500 Hz sweep on it and the base
 * game's is two sines and a fifth with a
 * 1.8 s attack. Same word, two instruments.
 *
 * ## THE FROZEN CLOCK, AND WHY BOTH PATCHES USE `retireIn`
 *
 * `Synth.retire()` gives a source a THIRTY-SECOND fallback deadline. That is
 * the right default for a one-shot fired by an event, and it is the wrong one
 * for a note whose length the caller already knows.
 *
 * `sweep()` releases a voice when EITHER deadline passes, and under a stalled
 * audio clock only the fallback is reachable. `Synth.ts` records the
 * measurement: `ctx.currentTime` reads 0.005333 s after six seconds of wall
 * clock under Puppeteer, headless and headful, and an iOS context interrupted
 * by an incoming call or suspended on a backgrounded tab is in exactly that
 * state. A four-note chord holds twelve voices; against a cap of 64, six bars
 * of pad and arp reach it. `busy` then goes true and **every voice in the game
 * stops being created, silently, with nothing in the console.**
 *
 * The base game had already worked this out and its `pad` retired against the
 * note. Both racers retired against the fallback. One file now does the right
 * thing for all three, and a test of this package measures it: after five
 * seconds of audio clock, a sequencer that has played six bars holds ZERO
 * voices where it used to hold every one it made.
 *
 * ## This file imports one thing, from inside the package
 *
 * `packages/audio/src` imports nothing outside itself, and a probe checks it,
 * which is what makes "no game type crosses this seam,
 * `import type` included" a fact rather than a promise.
 */
import { EPS, type AdsrSpec, type Synth } from './Synth.ts';

/**
 * The third oscillator in the pad, described rather than branched.
 *
 * Two of the three games put a triangle an octave up behind the saws; the
 * base game's cluster bed puts a THIRD SAW 33 cents flat, which is not enough to
 * be a wrong note and exactly enough to be an unpleasant beat frequency. That
 * is a physical sensation rather than a musical one and it is the whole point
 * of that bed — so it arrives here as `{ type: 'sawtooth', ratio: 1, cents: -33 }`
 * and not as a `cluster: boolean`. **A `mode` parameter is a branch wearing a
 * suit.**
 */
export interface PadColour {
  readonly type: OscillatorType;
  /** Frequency multiple of the root. 2 is an octave up; 1 is a unison detune. */
  readonly ratio: number;
  /** Detune in cents, applied on top of `ratio`. */
  readonly cents: number;
  /** Level of this oscillator alone, before the shared lowpass. */
  readonly gain: number;
}

/**
 * Everything the pad needs and nothing it can guess.
 *
 * `lpHz` and `lpFromHz` are separate on purpose and it is not redundancy: two
 * games create the filter at its starting corner and one creates it at the
 * bed's nominal corner and then schedules the swell from 72% of it. Collapsing
 * them would have silently moved the base game's first 20 ms of every chord, which
 * is a change no probe that only reads the final value could see.
 */
export interface PadSpec {
  /** Corner the `BiquadFilterNode` is CONSTRUCTED at. */
  readonly lpHz: number;
  /** Q of that filter. */
  readonly lpQ: number;
  /** Corner scheduled at `t` — usually, but not always, `lpHz`. */
  readonly lpFromHz: number;
  /** Corner the bar-long swell opens to. */
  readonly lpOpenHz: number;
  /** Fraction of `dur` at which the swell reaches `lpOpenHz`. */
  readonly lpOpenAt: number;
  /** Corner it closes back to, at `t + dur`. */
  readonly lpEndHz: number;
  /**
   * Peak level per voice is `peakPerVoice / notes.length + peakFloor`. Voices
   * are attenuated by count so a four-note chord and a three-note chord land at
   * the same level; the floor is what keeps the top voice of a dense voicing
   * from vanishing entirely.
   */
  readonly peakPerVoice: number;
  readonly peakFloor: number;
  /** Fraction of `dur` the envelope is given. */
  readonly holdFrac: number;
  /** The envelope itself. Two games state it in seconds and one states parts of it as fractions of `dur`; that arithmetic is the game's and is done before the call. */
  readonly env: AdsrSpec;
  /** Detune of the two root saws, in cents. */
  readonly detuneCents: readonly [number, number];
  /** The third oscillator. See `PadColour`. */
  readonly colour: PadColour;
}

/**
 * A chord. Two detuned saws per note plus a third oscillator, behind a lowpass
 * that opens across the bar and closes again.
 *
 * **The filter swell replaces an LFO on purpose:** an LFO has a rate, and a
 * rate is a rhythm. A one-shot swell per chord gives movement that never
 * repeats at an audible interval, which is what lets a bed sit under a game for
 * twenty minutes without becoming a thing the player is waiting for.
 *
 * `s.busy` is checked once for the whole chord rather than per note, so a
 * voice-capped moment drops a chord instead of half of one.
 *
 * @param freqs the chord, ALREADY IN HERTZ. The game does its own `mtof` and
 *              its own bends — a space racer flattens the second degree into
 *              Phrygian for 8.3 seconds a lap and that belongs to that game.
 */
export function pad(
  s: Synth, dest: AudioNode, t: number,
  freqs: readonly number[], dur: number, spec: PadSpec,
): void {
  if (s.busy) return;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]!;
    const g = s.gain(EPS);
    const lp = s.biquad('lowpass', spec.lpHz, spec.lpQ);
    lp.connect(g);
    g.connect(dest);
    lp.frequency.setValueAtTime(spec.lpFromHz, t);
    lp.frequency.linearRampToValueAtTime(spec.lpOpenHz, t + dur * spec.lpOpenAt);
    lp.frequency.linearRampToValueAtTime(spec.lpEndHz, t + dur);
    const end = s.adsr(
      g.gain, t, spec.peakPerVoice / freqs.length + spec.peakFloor,
      dur * spec.holdFrac, spec.env,
    );
    const a = s.osc('sawtooth', f, spec.detuneCents[0]);
    const b = s.osc('sawtooth', f, spec.detuneCents[1]);
    const c = s.osc(spec.colour.type, f * spec.colour.ratio, spec.colour.cents);
    const cg = s.gain(spec.colour.gain);
    a.connect(lp);
    b.connect(lp);
    c.connect(cg);
    cg.connect(lp);
    a.start(t); b.start(t); c.start(t);
    a.stop(end); b.stop(end); c.stop(end);
    // Retired against THIS NOTE'S length, not the thirty-second fallback. See
    // the note on the frozen clock at the top of this file.
    const life = end - s.now;
    s.retireIn(a, life, lp, g, cg);
    s.retireIn(b, life);
    s.retireIn(c, life);
  }
}

/** Everything the arp needs and nothing it can guess. See `PadSpec`. */
export interface ArpSpec {
  readonly lpHz: number;
  readonly lpQ: number;
  /** Corner scheduled at `t`, above `lpHz` so the pluck has a transient. */
  readonly lpFromHz: number;
  /** Corner it falls to, exponentially, at `t + decay + lpFallPad`. */
  readonly lpToHz: number;
  readonly lpFallPad: number;
  readonly peak: number;
  readonly attack: number;
  /** The second oscillator, stacked under the triangle root. */
  readonly second: { readonly type: OscillatorType; readonly cents: number; readonly gain: number };
  /** How long the sources are left running past the decay. */
  readonly tailPad: number;
}

/**
 * One plucked note: a triangle root with a second oscillator under it, through
 * a resonant lowpass that falls with the envelope.
 *
 * The falling filter and the percussive envelope are two separate curves on
 * purpose. The envelope decides how long you hear it; the filter decides
 * whether the tail sounds like the note dying or like somebody turning it down.
 *
 * @param freq ALREADY IN HERTZ, as in `pad`.
 */
export function arp(
  s: Synth, dest: AudioNode, t: number,
  freq: number, decay: number, spec: ArpSpec,
): void {
  if (s.busy) return;
  const g = s.gain(EPS);
  const lp = s.biquad('lowpass', spec.lpHz, spec.lpQ);
  lp.frequency.setValueAtTime(spec.lpFromHz, t);
  lp.frequency.exponentialRampToValueAtTime(spec.lpToHz, t + decay + spec.lpFallPad);
  lp.connect(g);
  g.connect(dest);
  s.perc(g.gain, t, spec.peak, spec.attack, decay);
  const a = s.osc('triangle', freq);
  const b = s.osc(spec.second.type, freq, spec.second.cents);
  const bg = s.gain(spec.second.gain);
  a.connect(lp);
  b.connect(bg);
  bg.connect(lp);
  const end = t + decay + spec.tailPad;
  a.start(t); b.start(t);
  a.stop(end); b.stop(end);
  const life = end - s.now;
  s.retireIn(a, life, lp, g, bg);
  s.retireIn(b, life);
}
