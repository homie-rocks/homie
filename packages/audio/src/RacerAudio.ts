import type { Synth } from './Synth.ts';
import { blip as blipVoice, whoosh as whooshVoice } from './Voice.ts';
import type { RigActor, RigVoice, VoiceRig } from './Rig.ts';

/**
 * ============================================================================
 *  RacerAudio — the part of both racers' audio class that is not sound design.
 * ============================================================================
 *  A kart racer and a space racer each carry a `class Audio implements System`,
 *  1,513 and 2,074 substantive lines. Moving the VOICES out of them — the rig,
 *  the patch tiers, the noise bed, the cast, the charge tone, the tier
 *  one-shots — left forty lines in each STILL byte-identical afterwards:
 *  the five-line rig facade, `init`, `bootWith`, the two one-shot wrappers with
 *  their doc, and `dispose`. Measured with a duplication scan on 2026-08-21,
 *  the two audio classes were the only pair in the codebase whose strict
 *  overlap went UP during that extraction, and this is why: an extraction ADDS
 *  identical import lines and leaves the class skeleton behind.
 *
 *  WHAT IS NOT HERE, AND MUST NEVER COME HERE. The SOUND is the game's. Both
 *  files carry a `ui()` whose switch has the same fourteen cases in the same
 *  order and not one shared number — the kart racer answers `confirm` with a
 *  660/990 Hz square pair and the space racer with a 392/587 triangle pair — and
 *  `SQUEAL_SURFACE` against `SHEAR_SURFACE` is the same table INVERTED, because
 *  a rougher surface is quieter in one game and louder in the other, and
 *  the space racer's own comment states the inversion. None of that is here.
 *  Neither is `update`, `onEvent`, or any voice class. A `mode` field on this
 *  class would be the failure.
 *
 *  `syncListener` IS NOT HERE EITHER, and that is a measured refusal rather
 *  than an oversight: it is the largest byte-identical block left in the pair
 *  (fifteen lines, twice), and every one of those lines is three.js — a world
 *  decompose into a Vector3 and a Quaternion, then `(0,0,-1)` and `(0,1,0)`
 *  through that quaternion. `@homie-rocks/audio` has NO three.js and that is
 *  deliberate: `Voice.ts` invented `Vec3Like` so that placing a listener never
 *  needs one, and the host serves this package to bundler-less pages through
 *  an import map. Buying thirty lines with a three.js edge on the audio
 *  substrate is the more expensive of the two mistakes.
 *
 *  WHY A BASE CLASS AND NOT MORE FREE FUNCTIONS. `blip` and `whoosh` already
 *  forward to free functions in `Voice.ts` — that is the whole of their bodies.
 *  They exist as METHODS to hold the arity and the three default arguments at
 *  the call sites, which their own doc below says. A free function cannot
 *  remove a wrapper whose entire job is to be a wrapper; only somewhere for the
 *  wrapper to live once can. `@homie-rocks/fx/RacerSystem` reached the
 *  same shape by the same argument.
 *
 *  THE DEFECT ONE COPY PREVENTS, concretely. These forty lines are a LIFECYCLE,
 *  and every one of them is order- or default-sensitive with no observable
 *  failure:
 *
 *    · `dispose` must free the rig BEFORE the bus subscription. Swap the two
 *      lines and a gesture arriving mid-teardown rebuilds the graph being
 *      dismantled. Nothing throws.
 *    · `init` must subscribe BEFORE `rig.listen()`, or a gesture that lands in
 *      the same tick builds a graph no events are routed to yet.
 *    · `blip` and `whoosh` hold three default arguments between them, and they
 *      are read IMPLICITLY. COUNTED on 2026-08-21 across the two games: of 54
 *      `blip` calls, 38 take the `delay = 0` default, 17 also take
 *      `slideTo = 0`, and 3 also take `type = 'square'`; 11 of the 12 `whoosh`
 *      calls take `delay = 0`. A drift in one copy's `delay` fires forty-nine
 *      one-shots late in ONE game — audible on the three staggered blips of the
 *      wrong-way alarm and on every layered pair — and it compiles, throws
 *      nothing, makes no silence, and reddens no check, because nothing
 *      here listens.
 *
 *  A probe that injects exactly those two faults sees both go red.
 *
 *  `Ctx` DOES NOT CROSS THIS SEAM AS A GOD OBJECT. `AudioCtx` names the ONE
 *  field this class reads — the bus — and nothing else. The game's own `Ctx`
 *  satisfies it structurally and is carried through as a type parameter only so
 *  that the subclass's `this.ctx` keeps the type it always had.
 *
 *  Graded by that probe against a verbatim transcription of both games' bodies
 *  as they were before this file existed.
 * ============================================================================
 */

/**
 * The context, as far as this class can see it, and it is the whole list.
 *
 * One field: the bus, subscribed to once at `init`. The volume, the race, the
 * settings, the camera and the track are all read by the subclass's own
 * `update` and `syncListener`, neither of which moved and both of which take
 * the context as an argument.
 */
export interface AudioCtx<E> {
  readonly bus: { on(fn: (e: E) => void): () => void };
}

export abstract class RacerAudio<
  V extends RigVoice,
  A extends RigActor,
  E,
  C extends AudioCtx<E>,
> {
  protected ctx: C | null = null;
  protected unsub: (() => void) | null = null;

  /**
   * The rig, CONSTRUCTED BY THE SUBCLASS because its `RigHost` is where the two
   * forks differ completely — different sends, different sub-machines, and a
   * different cull distance (150 m in the kart racer, 420 m in the space racer, which
   * runs at 142 m/s). Declared abstract here so this class can reach it.
   */
  protected abstract readonly rig: VoiceRig<V, A>;

  /** Every event variant has a voice, and which voice is entirely the game's. */
  protected abstract onEvent(e: E): void;

  protected get synth(): Synth | null { return this.rig.synth; }
  protected get voices(): V[] { return this.rig.voices; }
  protected get voiceKarts(): A[] { return this.rig.actors; }
  protected dest(kart: A | null | undefined) { return this.rig.dest(kart); }
  protected gate(key: string, minGap: number) { return this.rig.gate(key, minGap); }

  init(ctx: C) {
    this.ctx = ctx;
    this.unsub = ctx.bus.on((e) => this.onEvent(e));
    // Audio may only start from a gesture. Until then this system is inert —
    // which is exactly what the headless capture harness needs.
    this.rig.listen();
  }

  /** Diagnostic hook — see `VoiceRig.bootWith`. The game never calls it. */
  bootWith(ac: BaseAudioContext, volume = 1): Synth | null {
    return this.rig.bootWith(ac, volume);
  }

  /**
   * The two generic one-shots are `Voice.ts`'s now, and these two lines are what
   * is left of them. They are thin wrappers rather than call-site rewrites
   * deliberately: every caller in each game keeps the arity and the defaults it
   * always had, so a refactor that misses one of the ~40 call sites cannot do it
   * silently.
   *
   * THE DEFAULTS ARE WHY THIS PAIR IS IN A PACKAGE and not in two files. See
   * the header.
   */
  protected blip(
    dest: AudioNode, freq: number, dur: number, vol: number,
    type: OscillatorType = 'square', slideTo = 0, delay = 0,
  ) {
    blipVoice(this.synth!, dest, freq, dur, vol, type, slideTo, delay);
  }

  protected whoosh(dest: AudioNode, dur: number, vol: number, up: boolean, delay = 0) {
    whooshVoice(this.synth!, dest, dur, vol, up, delay);
  }

  dispose() {
    // The rig FIRST: it detaches the gestures before it drops anything, because
    // a gesture arriving mid-teardown would rebuild what we are dismantling.
    // `unwire` is what stops the music and disposes the sub-machines.
    //
    // THE ORDER IS THE WHOLE OF IT, and it was written out twice. Swap these
    // two lines and nothing throws, nothing is silent and no check changes
    // colour — a gesture listener stays live across a
    // teardown and can rebuild the graph being dismantled. Two copies of an
    // ordering invariant is two chances for somebody to tidy one of them.
    this.rig.dispose();
    this.unsub?.();
    this.unsub = null;
  }
}
