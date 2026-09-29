/**
 * ============================================================================
 *  Rig.ts — the voice registry: one continuous voice per actor, and the four
 *  pieces of bookkeeping every game that owns one writes identically.
 * ============================================================================
 *
 * `Synth.ts` is the graph. `Voice.ts` is the two generic one-shots and the
 * spatial plumbing. `Gate.ts` is the browser's autoplay rule. This is the layer
 * above all three and no higher — it knows that a game has some number of
 * things in the world, that each of them owns a continuous voice, and that a
 * one-shot belonging to one of them needs a bus to go to. It does not know what
 * any of those things ARE.
 *
 * ## What this file is, stated as the outcome it owns
 *
 *   **A voice exists for every actor and for no actor that has gone, a one-shot
 *   fired by something far away costs nothing, the same sound cannot machine-gun
 *   itself, and none of that survives a teardown.**
 *
 * ## Why it is here — the same finding, a third time
 *
 * A kart racer's `Audio.ts` and a space racer's are forks. Every one-shot in them
 * was compared when `Voice.ts` was written and five things moved; the rest only
 * looked alike, because a `land` at 150 Hz and a `landing` at 160 Hz is two
 * people's taste and merging them merges the taste. See that file's note.
 *
 * What was NOT compared then was the SCAFFOLDING the one-shots hang off, and it
 * turned out to be byte-identical down to the comments:
 *
 *   the autoplay wiring       the `AudioGate` host object, three closures
 *   `bootWith`                the diagnostic entry an offline probe uses
 *   the try/catch around the  a refused AudioContext must never take the frame
 *     graph build             loop with it — the game plays on in silence
 *   `ensureVoices`            rebuild the row when the grid changes identity
 *   `voiceOf`                 linear scan, because eight is not a Map
 *   `dest`                    player → sfx, near rival → its own voice's send,
 *                             far rival → dropped
 *   `gate`                    per-key minimum gap on the audio clock
 *   the volume sync           one param write when the setting moved
 *
 * That is a REGISTRY, not a sound. Nothing in the list above has an opinion
 * about air, tyres, turbines or an eclipse, which is exactly why both forks
 * carried it unchanged while everything around it diverged completely.
 *
 * ## The scratch-aliasing trap this file exists to close
 *
 * Both games computed the cull distance against a MODULE-LEVEL scratch vector
 * that `syncListener` had filled earlier in the same frame, and both carried the
 * same comment saying so:
 *
 *     // `_camPos` is left holding the camera's world position ON PURPOSE:
 *     // `dest()` culls a rival's voice against it later in the same frame
 *
 * That is correct and it is also the single most fragile thing in either file —
 * `dest()` is called from the event bus, which is not the frame loop, and a
 * scratch vector that has to survive across a call is a bug waiting for someone
 * to move a function. So the rig does not borrow anyone's scratch: it holds
 * three numbers of its own, `setListener` copies them in, and the distance is
 * computed here. The arithmetic is the same arithmetic `Vector3.distanceToSquared`
 * does; what changes is that nothing outside this file can clobber it.
 *
 * ## What did NOT move, and the number, so nobody "finishes the job"
 *
 * A base-building game's audio module has a `gate` of its own — TEN lines,
 * and it is a different function wearing the same name. It runs on the WALL
 * clock rather than the audio clock, deliberately, because under a context the
 * browser has frozen the audio clock never moves and every gate would pass
 * forever; and it does not consult `s.busy`, deliberately, because a hull-breach
 * warning outranks a pad note and that game's alert builders must not be dropped
 * by a polyphony cap. Both reasons are written out beside it. A `wallClock`
 * flag here would change BEHAVIOUR inside a shared function, which is the tell
 * that the two were never one thing. Ten lines stay where they are.
 *
 * ## This file imports nothing outside the package
 *
 * `packages/audio/src` imports nothing from outside itself, and a probe
 * checks it, which is what makes "no game type crosses this seam, `import type`
 * included" a fact rather than a promise. `RigActor.position` is therefore
 * `Vec3Like` — three's `Vector3` satisfies it structurally — and the voice type
 * and the actor type are BOTH generic parameters, so a game hands the rig its
 * own `HullVoice` and its own `IKart` and gets them back with their real types
 * on, without either type ever being named here.
 */
import { AudioGate } from './Gate.ts';
import { Synth } from './Synth.ts';
import { dopplerShift, type Vec3Like } from './Voice.ts';

/**
 * What the rig needs from one continuous voice. Two members, and `sfxIn` is
 * only ever handed back to the caller — the rig never writes to it.
 */
export interface RigVoice {
  /** Where a one-shot belonging to this voice's actor is mixed. */
  readonly sfxIn: AudioNode;
  dispose(): void;
}

/**
 * What the rig needs from a thing in the world that owns a voice. Two members.
 * `IKart` in both racers satisfies this structurally and is never named here.
 */
export interface RigActor {
  readonly isPlayer: boolean;
  readonly position: Vec3Like;
}

/** The half of the lifecycle that is the game's, expressed as four closures. */
export interface RigHost<V extends RigVoice> {
  /**
   * Wire this game's sends and sub-machines onto a freshly constructed `Synth`.
   * This is where the two forks differ COMPLETELY — reverb returns, send
   * amounts, which continuous machines exist — and none of it crossed. Throwing
   * in here is handled: it is treated exactly like a refused AudioContext.
   */
  wire(s: Synth): void;
  /**
   * Drop this game's own sub-machine references. Called when `wire` or the
   * `Synth` constructor threw, and again from `dispose`. Must be idempotent.
   */
  unwire(): void;
  /** Build one continuous voice for actor `index`. */
  voice(s: Synth, isPlayer: boolean, index: number): V;
  /**
   * Master volume, or null while the host has no world yet — a gesture CAN land
   * before a system is initialised, and building against half a game is worse
   * than staying silent for one more press.
   */
  volume(): number | null;
  /**
   * Beyond this many metres a rival's one-shots are not worth a voice slot.
   * Squared once, in the constructor.
   */
  cullDistance: number;
}

export class VoiceRig<V extends RigVoice, A extends RigActor> {
  private readonly host: RigHost<V>;
  private readonly cullSq: number;

  /** The live graph, or null before the first gesture / after a teardown. */
  synth: Synth | null = null;

  /** One voice per actor, index-aligned with `actors`. */
  readonly voices: V[] = [];
  /** The actors the current row of voices was built for, in grid order. */
  readonly actors: A[] = [];

  private lastVolume = -1;
  private readonly lastAt = new Map<string, number>();

  /** The listener's world position, copied in — never a borrowed scratch. */
  private lx = 0;
  private ly = 0;
  private lz = 0;

  /**
   * THE BROWSER'S AUTOPLAY RULE, obeyed by Gate.ts. It owns the three gesture
   * listeners, the `visibilitychange` handler, the re-nudge of a context the
   * browser suspended on us, and the latch that makes a page with no audio free
   * rather than a page that retries forever.
   */
  readonly autoplay: AudioGate;

  constructor(host: RigHost<V>) {
    this.host = host;
    this.cullSq = host.cullDistance * host.cullDistance;
    this.autoplay = new AudioGate({
      context: () => this.synth?.ctx ?? null,
      volume: () => host.volume(),
      build: (ac, vol) => this.build(ac, vol),
    });
  }

  /**
   * Start listening for the gesture. Until one arrives the whole system is
   * inert — which is exactly what the headless capture harness needs, and why
   * it is not a failure state.
   */
  listen(): void {
    this.autoplay.listen();
  }

  /**
   * Diagnostic hook: bring the whole graph up against a caller-supplied context
   * — an `OfflineAudioContext` in an audio probe — with no gesture and no window
   * listeners, so the mix can be rendered and measured rather than guessed at.
   * A game never calls this; the gesture is the only production path in.
   *
   * Note for anyone writing such a harness: a game's `update()` early-outs
   * unless the context reports 'running', and an `OfflineAudioContext` reports
   * 'suspended' inside a suspend callback. Drive the voices directly, or
   * override `state`.
   */
  bootWith(ac: BaseAudioContext, volume = 1): Synth | null {
    if (this.synth) return this.synth;
    this.build(ac, volume);
    return this.synth;
  }

  /** Graph construction. Returns false if audio is unavailable at all. */
  private build(ac: BaseAudioContext | null, vol: number): boolean {
    try {
      const s = new Synth(vol, ac ?? undefined);
      this.lastVolume = vol;
      this.host.wire(s);
      this.synth = s;
      return true;
    } catch (err) {
      // A refused or exhausted AudioContext must never take the frame loop with
      // it — the game stays fully playable in silence.
      console.warn('[audio] unavailable', err);
      // Latch it in the gate: this page has no audio, and every later gesture
      // must be free rather than allocate another refused AudioContext.
      this.autoplay.fail();
      this.synth = null;
      this.host.unwire();
      return false;
    }
  }

  /**
   * The frame preamble, and the reason it is one call: THREE separate early
   * returns have to happen in this order before a game touches a voice, and
   * getting the order wrong is silent. Returns the live graph, or null if this
   * frame has no audio in it.
   */
  frame(volume: number): Synth | null {
    const s = this.synth;
    if (!s) return null;
    if (s.ctx.state !== 'running') return null;
    if (volume !== this.lastVolume) {
      this.lastVolume = volume;
      s.setMasterVolume(volume);
    }
    return s;
  }

  /**
   * The listener's world position, for the cull in `dest`. Copied by value on
   * purpose — see this file's header. Call it once a frame, from wherever the
   * game already decomposes its camera.
   */
  setListener(p: Vec3Like): void {
    this.lx = p.x;
    this.ly = p.y;
    this.lz = p.z;
  }

  /**
   * Build one voice per actor, once the world has actually populated its grid.
   *
   * The identity check is `actors[0]`, not the length: a re-race with the same
   * number of ships is a DIFFERENT row of objects and every voice has to be
   * rebuilt, while a frame in which nothing changed must not allocate.
   */
  ensureVoices(actors: readonly A[] | null | undefined): void {
    if (!actors || actors.length === 0) return;
    if (this.voices.length === actors.length && this.actors[0] === actors[0]) return;
    for (const v of this.voices) v.dispose();
    this.voices.length = 0;
    this.actors.length = 0;
    const s = this.synth!;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i] as A;
      this.voices.push(this.host.voice(s, a.isPlayer, i));
      this.actors.push(a);
    }
  }

  /** The continuous voice belonging to `actor`, or null. Linear: eight is not a Map. */
  voiceOf(actor: A | null | undefined): V | null {
    if (!actor) return null;
    for (let i = 0; i < this.actors.length; i++) {
      if (this.actors[i] === actor) return this.voices[i] ?? null;
    }
    return null;
  }

  /** Destination bus for a one-shot belonging to `actor` (null = drop it). */
  dest(actor: A | null | undefined): AudioNode | null {
    const s = this.synth;
    if (!s) return null;
    if (!actor || actor.isPlayer) return s.sfx;
    // Rivals far away do not deserve a voice slot.
    const p = actor.position;
    const dx = p.x - this.lx;
    const dy = p.y - this.ly;
    const dz = p.z - this.lz;
    if (dx * dx + dy * dy + dz * dz > this.cullSq) return null;
    const v = this.voiceOf(actor);
    return v ? v.sfxIn : s.sfx;
  }

  /**
   * The Doppler multiplier for a source, measured against the listener position
   * this rig was given — or null when the source is past `cull` metres and the
   * caller should mute its voice and skip it.
   *
   * The arithmetic is in `Voice.ts`; what is HERE is the listener position, and
   * that is the entire point of the method existing. Both racers computed this
   * against a module-level scratch vector filled earlier in the same frame,
   * which is the fragility this file's header is about. The rig already holds
   * its own copy for `dest()`; using it here means the cull in the frame loop
   * and the cull on the event bus cannot drift apart, and neither can be broken
   * by someone moving a function that touches a scratch.
   */
  doppler(
    pos: Vec3Like, vel: Vec3Like, ref: Vec3Like | null,
    cull: number, maxShift: number,
  ): number | null {
    return dopplerShift(this.lx, this.ly, this.lz, pos, vel, ref, cull, maxShift);
  }

  /** Per-key rate limit so a pile-up cannot machine-gun a single sound. */
  gate(key: string, minGap: number): boolean {
    const s = this.synth;
    if (!s || s.busy) return false;
    const now = s.now;
    const last = this.lastAt.get(key) ?? -1e9;
    if (now - last < minGap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  /**
   * Give everything back. Detaches the gesture listeners first, because a
   * gesture arriving mid-teardown would rebuild the graph we are dismantling.
   */
  dispose(): void {
    this.autoplay.release();
    for (const v of this.voices) v.dispose();
    this.voices.length = 0;
    this.actors.length = 0;
    this.lastAt.clear();
    this.host.unwire();
    this.synth?.dispose();
    this.synth = null;
    this.lastVolume = -1;
  }
}
