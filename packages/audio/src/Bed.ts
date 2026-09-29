/**
 * ============================================================================
 *  Bed.ts — the chassis under a continuous noise bed: three seeded sources,
 *  a duckable master, and a mute that cannot miss a layer.
 * ============================================================================
 *
 * `Synth.ts` is the graph. `Machine.ts` is the chassis under a machine that
 * MOVES. This is the chassis under the one that does not — the wide, always-on
 * texture a game lays under everything else, which every racing game this came
 * from built and then had to remember to turn off in four places.
 *
 * ## The outcome this file owns
 *
 *   **Three uncorrelated noise sources exist for the life of the bed, the whole
 *   bed can be pulled back as one thing, every layer goes quiet when the bed is
 *   muted, and a teardown stops all of it.**
 *
 * ## Why it is here
 *
 * A kart racer's `Ambience` (tarmac, gravel, sand, wind, a road hum) and a
 * space racer's `Structure` (conduction, radiator vent, wall scrape, a thermal
 * tick train) are two completely different sound designs. What they share is
 * everything that is not the sound:
 *
 *   the master gain onto `sfx`   one node, so the bed can duck as one thing
 *   the three noise sources      pink, white at 1.1x, crackle
 *   THE STAGGER                  `+0.017` and `+0.041` — see below
 *   `sources` and `dispose`      stop every source, once
 *   `setSide`                    the whole bed steps back under a held tier
 *   `mute`                       every layer to EPS, and the trap is HERE
 *
 * ### The stagger is not a detail and it is why this is one file
 *
 * `Synth.noise()` hands back a source over a SEEDED buffer, so two `white`
 * sources started at the same instant play the same samples and sum to a
 * correlated signal 6 dB up with a comb notch in it — a bed that is supposed to
 * be shapeless acquires a pitch. Starting them 17 ms and 41 ms apart
 * decorrelates them, and the two intervals are prime-ish against the buffer
 * length so the relationship never comes back around. Both games carried the
 * three magic numbers and neither wrote down why. Now one file has them and
 * this paragraph is the reason.
 *
 * ### The mute trap, which is why `layer()` exists
 *
 * `mute()` in both games was a hand-written list of the layers to silence, and
 * a hand-written list is a list somebody adds a layer without joining. The
 * symptom is not silence: it is **one band of a five-band bed left running
 * through a pause menu**, which reads as a stuck sound card rather than as a
 * bug in an audio file. So a layer is not a field here, it is a REGISTRATION:
 *
 *     this.tarmac = this.layer(s.gain(EPS));
 *
 * and `mute()` walks what was registered. A layer that exists is a layer that
 * is muted, structurally, and the compiler is not involved.
 *
 * The order `mute()` walks the layers in is registration order, which is not
 * the order either game wrote by hand. That is immaterial and deliberately so:
 * every layer is a DIFFERENT `AudioParam`, and `setTargetAtTime` on one has no
 * relationship to `setTargetAtTime` on another. The tests fingerprint per
 * node for exactly this reason.
 *
 * ## What did NOT move, and it is most of both classes
 *
 * Every filter, every band, every gain curve, the surface tables, the wind
 * model, the vent flutter LFO, the thermal tick train. Those are the sound and
 * they are two different games' sound: the kart racer's surface table makes a
 * rougher surface QUIETER (grip follows volume) and the space racer's makes it
 * LOUDER (a rough surface is a better exciter for a structure-borne sound), and
 * the comment in the space racer's says so explicitly. Merging them would be
 * exactly the `solveTyre`/`solveAxle` mistake (see `ChargeTone.ts`) with a
 * filter on it.
 */
import { EPS, type Synth } from './Synth.ts';
import { stopSources } from './Voice.ts';

/**
 * The four numbers the chassis itself uses. All required — see `Patch.ts`'s
 * note on why a default here would hand one game the other game's mix.
 */
export interface BedSpec {
  /** Playback rate of the crackle source. */
  readonly crackleRate: number;
  /** Playback rate of the white source. */
  readonly whiteRate: number;
  /** Time constant for `setSide`. */
  readonly sideGlide: number;
  /** Time constant for `mute`. */
  readonly muteGlide: number;
}

/**
 * The stagger. Module-level and shared by every bed, because two beds in one
 * game starting their `white` at the same offset is the same correlation
 * problem one level up.
 */
const WHITE_OFFSET = 0.017;
const CRACKLE_OFFSET = 0.041;

export class NoiseBed {
  /** The one node the whole bed hangs off. `setSide` writes to this and only this. */
  readonly master: GainNode;
  /** Pink: the body of anything low and wide. */
  readonly pink: AudioBufferSourceNode;
  /** White: hiss, and anything band-passed above the body. */
  readonly white: AudioBufferSourceNode;
  /** Crackle: discrete events dense enough to fuse. Stones, grit, metal. */
  readonly crackle: AudioBufferSourceNode;

  /**
   * Every source this bed owns, INCLUDING ones a subclass adds. Protected
   * rather than private because a bed with an LFO or a drone in it is normal
   * and it has to be stopped by the same `dispose`.
   */
  protected readonly sources: AudioScheduledSourceNode[] = [];

  private readonly layers: GainNode[] = [];
  private readonly spec: BedSpec;

  constructor(s: Synth, dest: AudioNode, spec: BedSpec) {
    this.spec = spec;
    const now = s.now;
    this.master = s.gain(1);
    this.master.connect(dest);

    this.pink = s.noise('pink');
    this.white = s.noise('white', true, spec.whiteRate);
    this.crackle = s.noise('crackle', true, spec.crackleRate);
    this.pink.start(now);
    this.white.start(now + WHITE_OFFSET);
    this.crackle.start(now + CRACKLE_OFFSET);
    this.sources.push(this.pink, this.white, this.crackle);
  }

  /**
   * Register a gain as a layer of this bed and hand it straight back, so the
   * declaration and the registration cannot drift apart:
   *
   *     this.gravel = this.layer(s.gain(EPS));
   */
  protected layer(g: GainNode): GainNode {
    this.layers.push(g);
    return g;
  }

  /**
   * Step the whole bed back while something else needs the spectrum.
   *
   * Measured in the kart racer: the rolling and wind bands, not the engine,
   * were most of what masked the mini-turbo tone — they are the widest-band
   * things in the mix and they sit directly on its harmonics. None of a bed is
   * information a player needs during a held charge, which is what makes it the
   * right thing to move out of the way rather than the tyres.
   */
  setSide(now: number, duck: number): void {
    this.master.gain.setTargetAtTime(Math.max(EPS, 1 - duck), now, this.spec.sideGlide);
  }

  /** Every registered layer to silence. See the mute trap in this file's note. */
  mute(now: number): void {
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i]!.gain.setTargetAtTime(EPS, now, this.spec.muteGlide);
    }
  }

  dispose(): void {
    stopSources(this.sources);
  }
}
