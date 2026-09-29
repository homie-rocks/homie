/**
 * ============================================================================
 *  VoicePool.ts — a fixed row of continuous voices, lent out by id.
 * ============================================================================
 *
 * `Rig.ts` is the registry for a game whose actors are KNOWN: it walks a list
 * of racers and keeps one voice per racer, alive for as long as that racer is.
 * This is the other arrangement, and both games that needed it wrote
 * it themselves: **there is no list.** A colony has an unknown number of things
 * that might make a noise, most of them silent most of the time, and eight
 * simultaneous machines is already more than one camera can be near — so a
 * fixed row of voices is built once and lent to whichever id asks this frame.
 *
 * ## What is published and what deliberately is not
 *
 * The BOOKKEEPING is here: find the voice that already owns an id, otherwise
 * take a free one, otherwise refuse; accumulate idle time for anything nobody
 * fed this frame; silence it past one threshold and free its slot past a second.
 * None of that knows what a sound is.
 *
 * **The voice is the caller's, entirely.** Its oscillators, its filters, how it
 * responds to a load figure, and what "silence" means in its own graph are the
 * game's — `silence()` is a hook, not a gain write, precisely so that a voice
 * whose fade is 90 ms and a voice whose fade is a second are both expressible
 * without this file learning either number.
 *
 * ## The two thresholds are two decisions, not one with a fudge
 *
 * `idleKill` is when the voice goes quiet. `tail` is how much longer the SLOT
 * is held after that. They are separate because a machine that stops for three
 * frames and starts again must not be handed a different voice — that is an
 * audible click and a pan jump — while a machine that has genuinely gone must
 * not hold a slot against the next one. Collapsing them to one number makes the
 * fade and the reallocation the same instant, which is exactly the click.
 *
 * ## `claim` refuses rather than steals
 *
 * A full pool returns null and the caller drops the sound. Stealing the oldest
 * voice is the obvious alternative and it is worse: the thing you steal from is
 * by definition still being fed, so it cuts out mid-noise while the newcomer
 * fades in, and the pool audibly thrashes when the camera sits between nine
 * machines. A ninth machine is inaudible under eight.
 *
 * ## No allocation in the frame path
 *
 * `claim` is a linear scan and `releaseIdle` is an indexed loop. There is no
 * Map, no iterator and no closure per frame — the pool is eight entries, and a
 * Map over eight keys is slower than the scan as well as being an allocation
 * this can do without.
 *
 * This file imports nothing.
 */

/**
 * What the pool needs a voice to be. Everything else about it is the caller's.
 */
export interface PooledVoice {
  /** Who currently owns this voice. **−1 means free** and the pool sets it. */
  id: number;
  /** Seconds since anything fed it. The pool owns this counter; a `feed`
   *  implementation zeroes it. */
  idle: number;
  /**
   * Take this voice to silence. Called on EVERY frame the voice is past
   * `idleKill`, not once — a glide re-issued against the same target is free,
   * and a single call would be lost by any voice whose own `feed` ran later in
   * the same frame.
   */
  silence(): void;
}

export class VoicePool<V extends PooledVoice> {
  readonly voices: readonly V[];

  /** The row is built by the caller, at graph-construction time, once. */
  constructor(voices: readonly V[]) {
    this.voices = voices;
  }

  /**
   * The voice for `id`, taking a free one if this id does not have one yet.
   *
   * @returns null when every voice is spoken for. The caller drops the sound;
   *          see the header for why it does not steal one.
   */
  claim(id: number): V | null {
    // `as V` on every read: `noUncheckedIndexedAccess` is on across these packages
    // and an indexed read is `V | undefined` under it. The loop bound is the
    // array's own length, so the widening is a type-system artefact rather than
    // a case that exists — and a `?.` here would be a plausible default in the
    // per-frame path, which is the shape these packages refuse.
    const v = this.voices;
    for (let i = 0; i < v.length; i++) {
      if ((v[i] as V).id === id) return v[i] as V;
    }
    for (let i = 0; i < v.length; i++) {
      const free = v[i] as V;
      if (free.id < 0) { free.id = id; return free; }
    }
    return null;
  }

  /**
   * Age ONE voice by `dt`, silencing it past `idleKill` and freeing its slot
   * past `idleKill + tail`.
   *
   * Exposed beside `releaseIdle` because a consumer can hold a second index
   * into the same row — the game this came out of keeps a `Map` of ship id to
   * voice so a continuous rumble can be found without a scan, and that map has
   * to learn when its entry became free. Both paths must age identically or the
   * two indexes disagree about which voice is available, which is a voice
   * handed to two owners and a sound that will not stop.
   *
   * @returns true whenever the voice is PAST the release deadline — not only on
   *          the frame it crossed it. A caller holding a side index deletes its
   *          entry on the first true and stops calling; the row scan below only
   *          ever reaches a live voice, so it sees exactly one.
   */
  age(voice: V, dt: number, idleKill: number, tail: number): boolean {
    voice.idle += dt;
    if (voice.idle <= idleKill) return false;
    voice.silence();
    if (voice.idle <= idleKill + tail) return false;
    voice.id = -1;
    return true;
  }

  /**
   * Age every voice nobody fed this frame, silencing and then freeing.
   *
   * Call it once per frame AFTER every emitter has had its turn. A voice that
   * was fed has had its `idle` zeroed by its own `feed`, so this loop cannot
   * silence something that is still running.
   *
   * @param dt        seconds since the last call.
   * @param idleKill  seconds of silence before the voice is faded out.
   * @param tail      further seconds before its slot is released.
   * @returns how many slots were freed, for a caller that wants to log it.
   */
  releaseIdle(dt: number, idleKill: number, tail: number): number {
    const v = this.voices;
    let freed = 0;
    for (let i = 0; i < v.length; i++) {
      const voice = v[i] as V;
      if (voice.id < 0) continue;
      if (this.age(voice, dt, idleKill, tail)) freed++;
    }
    return freed;
  }

  /** How many voices are lent out right now. For a stats readout. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < this.voices.length; i++) if ((this.voices[i] as V).id >= 0) n++;
    return n;
  }

  /**
   * Free every slot without touching the graph.
   *
   * For a scenario reset: the ids belong to a world that no longer exists, and
   * a new world's rover 3 must not inherit the pan and the load of the old
   * one's. It deliberately does NOT call `silence()` — the caller is about to
   * tear the voices down or re-feed them, and a fade started here would fight
   * whichever it is.
   */
  clear(): void {
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i] as V;
      voice.id = -1;
      voice.idle = 0;
    }
  }
}
