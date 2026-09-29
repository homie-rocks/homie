/**
 * ============================================================================
 *  The four voices every percussive one-shot here is built from
 * ============================================================================
 *
 * ## What this is, and why it is not `land()` and `landing()`
 *
 * Comparing every one-shot in the audio modules of two racing games, a kart
 * racer and a space racer, reached a conclusion that is written into
 * `Voice.ts`'s header: `land`/`landing` share a shape and *"disagree on every
 * number in it (150 Hz against 160, 0.12 s against 0.14, a 1600 Hz corner
 * against 1200)"*, so merging them would be merging two people's taste. **That
 * conclusion is still correct and nothing here overturns it.** There is no
 * `land()` in this file and there must never be one.
 *
 * What that comparison did not do is ask what the two one-shots are each
 * *made of*. Measured across both racers with an identifier-blind structural
 * match, the answer is four graphs and only four. Two of them appear SIXTEEN
 * times between the racers:
 *
 *   drop   an oscillator falling in pitch, through a gain, percussively
 *          enveloped, then retired.        7 sites: kart racer land / plop /
 *          explosion, space racer crack / clamp / discharge / landing
 *
 *   hit    a noise source through one filter and a gain, percussively
 *          enveloped, then retired — with the filter's centre optionally
 *          sweeping.                       9 sites: kart racer land / scrub /
 *          impact / tick, space racer crack / grain / hullBang / landing /
 *          shearBurst
 *
 * ...and two found later, which appear five times and four:
 *
 *   modes  a stack of partials at fixed ratios of one base, each through its
 *          own fixed gain into one shared destination, all started and stopped
 *          together — the ring in a struck panel.
 *                                          5 sites: kart racer impact, space
 *                                          racer hullBang / clatter /
 *                                          Structure.tick / clampRelease
 *
 *   wail   an oscillator sweeping in pitch through a filter that sweeps with
 *          it — the fourth corner of the square the first three make.
 *                                          4 sites: space racer thermalTrip /
 *                                          bleed, kart racer siren / zap
 *
 * The space racer's six sites call these, and the three in **the kart racer
 * still write the graph out** — `impact` could adopt `modes` tomorrow; `siren`
 * and `zap` could not, for the topology reason `wail` states. They are named so
 * the remainder is a job somebody can see rather than a count nobody can check.
 *
 * Every one of those twenty-five was ten lines of `connect`, `start`, `stop` and
 * `retire` bookkeeping wrapped around numbers that are the game's own. This
 * file takes the bookkeeping and **nothing else**.
 *
 * ## Every number stays at the call site, and that is the safety property
 *
 * `Bed.ts`, `Tier.ts` and `Patch.ts` take a spec object of required fields. The
 * reason those are safe is that a game which forgets a field fails to compile.
 * These four go one step further and take **no spec at all** — the numbers are
 * arguments, written at the call site, one call per sound. There is no constant
 * in this file that any game can inherit, so the failure that comparison named
 * as the one an audio extraction is genuinely dangerous for — *a default sounds
 * completely fine, and one game silently acquires the other's art direction* —
 * is not merely guarded against here. It is unrepresentable.
 *
 * ## The tuples, and why the pitch/filter arguments carry FOUR values
 *
 * The arguments are grouped into labelled tuples rather than a flat list of
 * eleven positionals, because eleven positional numbers is a transposition
 * nobody sees. TypeScript's labelled tuple elements put the names back at the
 * call site under the cursor, and the arity is checked.
 *
 * `Fall` and `Sweep` both carry a CONSTRUCTED value and a SCHEDULED value, and
 * they are separate on purpose. Five of the seven `drop` sites construct the
 * oscillator at the same frequency they then schedule; **the space racer's
 * `clamp` constructs at 96 Hz and schedules 132 Hz at `t`**, and the kart
 * racer's `scrub` builds its bandpass at 1500 Hz and sweeps it from 900. Collapsing the pair
 * would be inaudible today — the source starts at `t`, so nothing renders at
 * the constructed value — and would be a silent edit to a game's graph made
 * inside a de-duplication commit. Both values are required. The oddity is now
 * visible instead of buried.
 *
 * ## This file imports only `Synth`
 *
 * An import check holds `packages/audio/src` to importing nothing outside
 * itself. Nothing here knows what a kart, a hull, a lap or a weapon is;
 * it knows what an oscillator and a biquad are, which is the same altitude
 * `Voice.ts` sits at.
 */
import { EPS, type NoiseKind, type Synth } from './Synth.ts';

/**
 * A pitch that falls.
 *
 * `createHz` is the value `OscillatorNode.frequency` is CONSTRUCTED at;
 * `fromHz` is the value scheduled at `t`. See the header for why they are two
 * fields and not one.
 */
export type Fall = readonly [
  wave: OscillatorType,
  createHz: number,
  fromHz: number,
  toHz: number,
  seconds: number,
];

/** `Synth.perc`'s three arguments, in `Synth.perc`'s order. */
export type Perc = readonly [peak: number, attack: number, decay: number];

/**
 * A noise source. `offset` is where in the buffer it starts — every site in
 * both racers passes `Math.random()` or `Math.random() * 1.5`, so that two of
 * these fired together do not phase against each other.
 *
 * IT IS AN ARGUMENT AND NOT A DRAW MADE IN HERE. A site with two draws in it
 * (the space racer's `grain` randomises its bandpass centre as well) depends on
 * the ORDER the two are taken in, and moving one of them inside a shared
 * function would reorder it invisibly.
 */
export type Grain = readonly [kind: NoiseKind, rate: number, offset: number];

/** A filter, at the value it is constructed with. */
export type Band = readonly [type: BiquadFilterType, hz: number, q: number];

/**
 * The filter's centre moving: scheduled at `fromHz` at `t`, exponential to
 * `toHz` over `seconds`. `null` means it does not move at all — a sentinel and
 * not an optional, because "no sweep" is a decision a caller makes rather than
 * a field it forgot.
 */
export type Sweep = readonly [fromHz: number, toHz: number, seconds: number] | null;

/**
 * An oscillator falling in pitch through a percussive gain — the body of a
 * thud, a plop, the sub under an explosion, the recoil through a frame.
 *
 * `stopS` is when the source stops, measured from `t`, and the chain is retired
 * against THAT rather than against `Synth.retire`'s thirty-second fallback.
 *
 * `Synth.retire`'s own comment says the fallback is *"the safety net for
 * callers that do not know their own duration; anything that does should call
 * `retireIn`"* — and this function is handed the duration by every one of its
 * callers. All sixteen sites in both racers used the fallback before this
 * package existed, and could not easily have done otherwise: the stop time was
 * a literal buried in the middle of ten lines rather than an argument. Making
 * it an argument is what made the fix possible in one place.
 *
 * WHY IT MATTERS, and it is not a tidy-up. `sweep()` frees a voice when either
 * deadline passes, so under a clock that is not advancing only the fallback is
 * reachable — and `Synth.ts` records `ctx.currentTime` reading 0.005333 s after
 * six seconds of wall clock under Puppeteer, headless and headful. A
 * backgrounded tab and an iOS context interrupted by a phone call are in the
 * same place. Against a cap of 64, a lap of one-shots reaches it; at the cap
 * `VoiceRig.gate` returns false and **every voice in the game stops being
 * created, silently, with nothing in the console.** Measured: 8 of 40 shots
 * refused before, 0 after.
 *
 * The deadline is measured from NOW and not from `t`, because that is what
 * `retireIn` counts from — a delayed one-shot has to carry its own delay into
 * it, or a tick scheduled 600 ms out is freed 600 ms early. `retireIn` adds its
 * own half second of slack on top, so nothing is ever killed early enough to
 * click.
 */
export function drop(
  s: Synth, dest: AudioNode, t: number, fall: Fall, env: Perc, stopS: number,
): void {
  const [wave, createHz, fromHz, toHz, seconds] = fall;
  const o = s.osc(wave, createHz);
  const g = s.gain(EPS);
  o.connect(g);
  g.connect(dest);
  o.frequency.setValueAtTime(fromHz, t);
  o.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
  s.perc(g.gain, t, env[0], env[1], env[2]);
  o.start(t);
  o.stop(t + stopS);
  s.retireIn(o, t - s.now + stopS, g);
}

/**
 * A noise burst through one filter and a percussive gain — the slam under a
 * landing, a tyre scuff, a reel tick, a slug, the air in a hull strike.
 *
 * `also` is the extra nodes to retire with the chain, and it exists because
 * three of the nine sites feed an OUTER gain rather than `dest` and hand that
 * gain's chain to the same `retire` call. It is spread into the retirement
 * exactly as `Synth.retire`'s own variadic tail takes it.
 *
 * See `drop` on the retirement deadline. `also` goes into it, so the three
 * sites that hand an outer chain in get that chain freed on the same schedule
 * rather than thirty seconds later.
 */
export function hit(
  s: Synth, dest: AudioNode, t: number,
  grain: Grain, band: Band, sweep: Sweep, env: Perc, stopS: number,
  ...also: AudioNode[]
): void {
  const n = s.noise(grain[0], false, grain[1]);
  const f = s.biquad(band[0], band[1], band[2]);
  const g = s.gain(EPS);
  n.connect(f);
  f.connect(g);
  g.connect(dest);
  if (sweep) {
    f.frequency.setValueAtTime(sweep[0], t);
    f.frequency.exponentialRampToValueAtTime(sweep[1], t + sweep[2]);
  }
  s.perc(g.gain, t, env[0], env[1], env[2]);
  n.start(t, grain[2]);
  n.stop(t + stopS);
  s.retireIn(n, t - s.now + stopS, f, g, ...also);
}

/**
 * One partial of a struck body: a frequency, the gain it sits at relative to
 * the others, and the wave that makes it.
 *
 * THE WAVE IS PER-PARTIAL AND NOT PER-STACK, because three of the five sites
 * choose it per partial and disagree about how: the kart racer's `impact` uses
 * a triangle for the fundamental and squares above it, the space racer's
 * `hullBang` does the same, and its `clampRelease` picks by FREQUENCY
 * (`> 200 ? 'square' : 'sine'`).
 * A per-stack wave with a "first is different" flag would be a rule invented
 * here that two of the five callers do not follow.
 */
export type Partial = readonly [hz: number, level: number, wave: OscillatorType];

/**
 * A stack of partials into one destination — the ring in a struck panel, a
 * relay closing, a plate settling, a hull taking a hit.
 *
 * INHARMONIC RATIOS READ AS "PANEL"; HARMONIC ONES READ AS "BELL". That is the
 * one sentence every caller of this writes above its own ratio list, and the
 * ratios are the whole art direction of the sound, so not one of them is in
 * here. Nor is the base frequency, nor the level law, nor the count.
 *
 * `dest` is usually an outer gain the caller has already enveloped, so that the
 * whole stack shares one attack and decay rather than each partial carrying its
 * own — which is what makes it one body rather than a chord.
 *
 * THE SHARED CHAIN IS RETIRED WITH THE LAST REAL PARTIAL, and that is a bug
 * that has already been paid for once. `Synth.retire` increments the
 * voice counter and only decrements it in `onended`, so retiring an outer gain
 * against a dummy oscillator that is created and never started **leaks a voice
 * slot permanently** and the polyphony cap silently closes the whole mix down
 * over a few minutes. Pass the outer chain as `also`; it goes down with the
 * last partial that actually plays. If `parts` is empty nothing is created and
 * `also` is not retired — a caller with no partials still owns its own chain.
 *
 * `stopS` is measured from `t`, and the deadline from now, exactly as `drop`
 * and `hit` compute it. See `drop` for why that matters under a clock that is
 * not advancing.
 */
export function modes(
  s: Synth, dest: AudioNode, t: number, parts: readonly Partial[], stopS: number,
  ...also: AudioNode[]
): void {
  for (let i = 0; i < parts.length; i++) {
    const [hz, level, wave] = parts[i]!;
    const o = s.osc(wave, hz);
    const g = s.gain(level);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + stopS);
    const last = i === parts.length - 1;
    s.retireIn(o, t - s.now + stopS, g, ...(last ? also : []));
  }
}

/**
 * An oscillator sweeping in pitch through a filter that sweeps with it — a
 * whine spinning down, a charge spinning up, a machine giving up.
 *
 * This is the fourth corner of the square the other three make: `drop` is an
 * oscillator into a gain, `hit` is noise through a filter into a gain, and this
 * is an oscillator through a filter into a gain. It exists because the corner
 * was occupied: the space racer's `thermalTrip` and `bleed` each wrote it out in
 * fourteen lines, and both are the same fourteen lines with different numbers.
 *
 * A filter following the source is what separates this from `drop` with a tone
 * control on it. The source moving alone changes the note; the passband moving
 * with it changes the TIMBRE across the sweep, which is what a real machine
 * running down its speed range does and what a fixed filter cannot fake.
 *
 * `sweep` is `null` when the passband stays put, for the reason the type says:
 * "no sweep" is a decision a caller makes, not a field it forgot.
 *
 * TWO SITES IN THE KART RACER ARE THIS SHAPE AND ARE DELIBERATELY NOT CONVERTED.
 * Its `zap` has a waveshaper BETWEEN the oscillator and the filter, and its
 * siren has a vibrato oscillator wired into `o.frequency`, which needs the
 * source node the caller never receives. Widening this to admit either would
 * put a branch in a function whose whole safety property is that it has none.
 * They stay written out, and they are named here so that is a decision rather
 * than an oversight.
 *
 * See `drop` on the retirement deadline; `also` joins it exactly as `hit`'s does.
 */
export function wail(
  s: Synth, dest: AudioNode, t: number,
  fall: Fall, band: Band, sweep: Sweep, env: Perc, stopS: number,
  ...also: AudioNode[]
): void {
  const [wave, createHz, fromHz, toHz, seconds] = fall;
  const o = s.osc(wave, createHz);
  const f = s.biquad(band[0], band[1], band[2]);
  const g = s.gain(EPS);
  o.connect(f);
  f.connect(g);
  g.connect(dest);
  o.frequency.setValueAtTime(fromHz, t);
  o.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
  if (sweep) {
    f.frequency.setValueAtTime(sweep[0], t);
    f.frequency.exponentialRampToValueAtTime(sweep[1], t + sweep[2]);
  }
  s.perc(g.gain, t, env[0], env[1], env[2]);
  o.start(t);
  o.stop(t + stopS);
  s.retireIn(o, t - s.now + stopS, f, g, ...also);
}

/**
 * The FM pair: carrier, modulator, and the index falling away.
 *
 *   `ratio`     the modulator's frequency as a multiple of the carrier's. An
 *               IRRATIONAL ratio is what makes a bell rather than a horn — at
 *               2.0 the partials land on the harmonic series and the ear hears
 *               one pitched note; off it they are inharmonic and the ear hears
 *               a struck body.
 *   `index0/1`  the modulation index at the strike and where it falls to, both
 *               as multiples of the carrier frequency, the fall taking
 *               `indexFall` of the duration. That decay IS the strike: the
 *               bright inharmonic crash at the front and the near-sine tail
 *               behind it are one envelope on one number.
 */
export type Fm = readonly [
  hz: number, ratio: number, index0: number, index1: number, indexFall: number,
];

/**
 * A two-operator FM bell through a percussive gain and a reverb send — the
 * tonal one-shot behind anything celebratory.
 *
 * THE THIRD GRAPH, and it is the one this file's own census could not see.
 * `drop` and `hit` above were measured across both racers as the only two
 * shapes their sixteen PERCUSSIVE one-shots were built from; this is the shape
 * neither covers, because it is the only one that is PITCHED. It stood once,
 * in the kart racer's audio module, under four call sites — the lap chime and
 * the fanfare, each of which strikes it twice.
 *
 * IT TAKES NO SPEC AND SHIPS NO NUMBER, for this file's stated reason and not
 * as ceremony: a default here sounds completely fine and hands the next game
 * this game's celebration. `ratio`, both indices, the send depth and the whole
 * envelope are the caller's.
 *
 * `send` is a DEPTH and not a node: every caller wants the same bus and a
 * different amount of it, and a caller that wants none passes 0 rather than
 * discovering the parameter was optional.
 *
 * On the retirement deadline see `drop`. The sources stop at `dur + tail` from
 * `t`, and the tail is an argument because for a bell it is genuinely longer
 * than the envelope — the carrier is still ringing under the release, and
 * stopping it on the envelope clicks.
 */
export function fmBell(
  s: Synth, dest: AudioNode, t: number, fm: Fm, env: Perc,
  dur: number, tail: number, send: number,
): void {
  const [hz, ratio, index0, index1, indexFall] = fm;
  const g = s.gain(EPS);
  g.connect(dest);
  const car = s.osc('sine', hz);
  const mod = s.osc('sine', hz * ratio);
  const idx = s.gain(hz * index0);
  mod.connect(idx);
  idx.connect(car.frequency);
  idx.gain.setValueAtTime(hz * index0, t);
  idx.gain.exponentialRampToValueAtTime(hz * index1, t + dur * indexFall);
  car.connect(g);
  s.perc(g.gain, t, env[0], env[1], env[2]);
  const sn = s.send(g, s.reverbIn, send);
  car.start(t);
  mod.start(t);
  car.stop(t + dur + tail);
  mod.stop(t + dur + tail);
  s.retire(car, g, idx, sn);
  s.retire(mod);
}
