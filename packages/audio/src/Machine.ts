/**
 * ============================================================================
 *  Machine.ts — the chassis under a continuous, positional, machine-like voice.
 * ============================================================================
 *
 * `Synth.ts` is the graph. `Voice.ts` is the two generic one-shots and the
 * spatial plumbing. `Rig.ts` is the registry that owns one continuous voice per
 * actor. This is the thing the registry builds: the part of a continuous voice
 * that is the same in every game that has one, and NOT one line further.
 *
 * ## The outcome this file owns
 *
 *   **A continuous voice arrives on the right two buses with the right two
 *   panners for whether it is the player's or a rival's, its oscillator stack
 *   never phase-locks across a grid, and a teardown takes every source with
 *   it.**
 *
 * ## Why it is here — the fourth time the same finding has come back
 *
 * A kart racer's `KartVoice` (an engine) and a space racer's `HullVoice` (an ion
 * turbine heard through a hull) sound nothing like each other and are not
 * supposed to. Their FILTER CHAINS are where that lives, and those stay in the
 * games: the kart racer hangs a megaphone peak at 1150 Hz and a rumble at 190
 * off its drive stage, the space racer hangs two fixed hull modes at 82 and
 * 196 Hz and a sweeping formant. Those are two people's ideas about two machines and merging them
 * would merge the taste — the `land`/`landing` finding in `Voice.ts`, again.
 *
 * What was byte-identical, down to the comments, is everything AROUND the
 * chain:
 *
 *   the panner pair       rich → dry and centred; lean → HRTF for the machine,
 *                         equal-power for its one-shots
 *   `out`                 a gain opened from EPS into whichever of those two
 *                         destinations this voice got
 *   the stack builder     `osc → gain → drive`, pushed onto three parallel
 *                         arrays, started at a per-actor stagger
 *   `setPosition`         one line, both panners, via `placeVoice`
 *   `dispose`             clear `live`, stop and disconnect every source
 *
 * None of that has an opinion about tyres, blades, air or vacuum, which is
 * exactly why both forks carried it unchanged while the sound diverged
 * completely.
 *
 * ## What deliberately did NOT move
 *
 * **`mute()`.** Both games have one, both are four to seven lines, and they
 * ramp DIFFERENT SETS of gains to silence — the kart racer takes `out` and the
 * tyre bed, the space racer takes `out`, both blade gains and each of the two
 * mag-shear bands. A
 * base-class `mute()` would either have to know those node names or take a list,
 * and a list is the same file with an indirection in front of it. The shared
 * half is the `muted` latch, which is here; the ramps stay in the game.
 *
 * **`update()`.** Nothing about it is shared. `KartVoice.update` has a gearbox
 * in it and `HullVoice.update` has a spool and a void run; they do not even take
 * the same arguments. A shared race-loop `update` is refused for the same
 * reason: it would make one game play like the other.
 *
 * **`drive` and `lp`.** Declared here because every consumer has both and
 * `addOsc` needs to reach `drive` — but CONSTRUCTED by the subclass, in the
 * subclass's own order, because they are the head and the tail of the chain
 * that is the game's whole character. `drive` happens to be `s.gain(0.3)` in
 * both today; that is a coincidence of two tunings, not an agreement, and
 * building it here would silently retune whichever game changed its mind first.
 *
 * ## Node creation order is preserved, and it is load-bearing for the tests
 *
 * The base constructor creates exactly the nodes the games created first — the
 * panner pair, then `out` — and stops. Every node after that is still made by
 * the subclass, in the order it always was. A test of this package
 * fingerprints the graph by creation order, so a reordering here would be
 * visible rather than merely invisible-but-different.
 *
 * `s.now` is read ONCE, in this constructor, and handed to the subclass as
 * `this.now`. Both games read it once at the top of their constructor and used
 * it for the stack stagger and for their own `start()` calls; two reads of a
 * live `currentTime` are two different numbers, so the single read stays single.
 *
 * ## This file imports nothing outside the package
 *
 * `packages/audio/src` imports nothing from outside itself, and a probe checks
 * it. The voice type never crosses this seam and no game type is named here.
 */
import { EPS, type Synth } from './Synth.ts';
import { placeVoice, stopAndDisconnectSources } from './Voice.ts';

/**
 * The chassis. A game's continuous voice EXTENDS this, which is what keeps
 * every call site in the game reading exactly the way it read before: a
 * `KartVoice` is still a `KartVoice`, `v.setPosition(...)` is still
 * `v.setPosition(...)`, and `rig.voices[i]` still has the game's own type on it.
 */
export abstract class MachineVoice {
  /** Where one-shots belonging to this voice's actor should be sent. */
  readonly sfxIn: AudioNode;

  /**
   * The machine's own panner, or null for the player — whose voice is dry and
   * centred because it is not somewhere else in the room, it is the room.
   */
  protected readonly enginePanner: PannerNode | null;
  protected readonly sfxPanner: PannerNode | null;

  /** The voice's output, opened from EPS by the subclass's own envelope. */
  protected readonly out: GainNode;

  /**
   * The tanh stage the oscillator stack feeds. Constructed by the SUBCLASS —
   * see this file's header — but declared here because `addOsc` connects to it.
   */
  protected drive!: GainNode;
  /** The stack's low-pass. Constructed and driven entirely by the subclass. */
  protected lp!: BiquadFilterNode;

  /** The stack, and each oscillator's multiple of `baseFreq`, index-aligned. */
  protected readonly oscs: OscillatorNode[] = [];
  protected readonly mults: number[] = [];

  /** Everything a teardown has to stop. Subclasses push their own sources here. */
  protected readonly sources: AudioScheduledSourceNode[] = [];

  protected readonly s: Synth;
  /** True for the player's voice: more oscillators, no panners, full noise rig. */
  protected readonly rich: boolean;

  /** The audio clock at construction. Read ONCE — see this file's header. */
  protected readonly now: number;

  /**
   * When this voice's oscillators start, in audio-clock seconds. A per-actor
   * stagger of well under a millisecond, which is inaudible on its own and is
   * the entire reason a grid of eight identical machines does not phase-lock
   * into one enormous comb filter on the starting line.
   */
  protected readonly stagger: number;

  /**
   * The stack's root frequency in Hz. The subclass sets it before its first
   * `addOsc` — it is that game's idle fundamental (a firing rate, a shaft
   * speed) and there is no sensible default, so it starts at 0 and a stack
   * built without setting it is audibly wrong rather than quietly plausible.
   */
  protected baseFreq = 0;

  /** False once disposed: every `update` in every subclass early-outs on it. */
  protected live = true;
  /** Latched by the subclass's own `mute()` so muting a distant rival is free. */
  protected muted = false;

  constructor(s: Synth, rich: boolean, seed: number) {
    this.s = s;
    this.rich = rich;
    const now = s.now;
    this.now = now;
    this.stagger = now + seed * 0.0007;

    if (rich) {
      this.enginePanner = null;
      this.sfxPanner = null;
      this.sfxIn = s.sfx;
    } else {
      // HRTF for engines: front/back discrimination is the entire point of
      // hearing a rival. Cheap equal-power is plenty for their one-shots.
      this.enginePanner = s.panner('HRTF');
      this.sfxPanner = s.panner('equalpower');
      this.enginePanner.connect(s.engine);
      this.sfxPanner.connect(s.sfx);
      this.sfxIn = this.sfxPanner;
    }
    const engineDest: AudioNode = this.enginePanner ?? s.engine;

    this.out = s.gain(EPS);
    this.out.connect(engineDest);
  }

  /**
   * Add one oscillator to the stack: `osc → gain → drive`, at `baseFreq * mult`
   * detuned by `detune` cents, started at the per-actor stagger.
   *
   * Returns the gain, because a subclass that wants to ride one partial's level
   * (the kart racer's two harmonics, which come up with the turbo) needs the handle and
   * every other caller can drop it.
   */
  protected addOsc(
    type: OscillatorType, mult: number, detune: number, gain: number,
  ): GainNode {
    const o = this.s.osc(type, this.baseFreq * mult, detune);
    const g = this.s.gain(gain);
    o.connect(g);
    g.connect(this.drive);
    o.start(this.stagger); // tiny stagger so the fleet never phase-locks
    this.oscs.push(o);
    this.mults.push(mult);
    this.sources.push(o);
    return g;
  }

  /** Both panners, smoothed and instant respectively. See `placeVoice`. */
  setPosition(x: number, y: number, z: number, now: number): void {
    placeVoice(this.enginePanner, this.sfxPanner, x, y, z, now);
  }

  /**
   * Stop and disconnect every source this voice owns.
   *
   * `stopAndDisconnectSources` and not `stopSources`: both racers' continuous
   * voices were already in the disconnecting group, and `Voice.ts`'s note on the
   * seven-way split says which callers are in which and that the split is not
   * settled inside a de-duplication commit.
   */
  dispose(): void {
    this.live = false;
    stopAndDisconnectSources(this.sources);
  }
}
