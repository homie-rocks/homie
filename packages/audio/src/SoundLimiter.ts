/**
 * SoundLimiter — a minimum gap per sound and a cap on voices, as arithmetic.
 *
 * Forty pickups collected in one frame ask for the same chime forty times. Played,
 * that is forty copies in phase: one chime, forty times too loud, into the master
 * limiter, which ducks everything else for as long as it lasts. The fix is not a
 * better limiter, it is not playing thirty-nine of them:
 *
 *   - **A MINIMUM GAP PER SOUND.** The same sound may not start again within
 *     `minGap` seconds of its last start. A run of pickups becomes a rattle at
 *     a rate the ear can count, which also sounds like more than a pile does.
 *
 *   - **A VOICE CAP PER SOUND**, so one long sound cannot stack on itself, and
 *     **A VOICE CAP OVERALL**, so effects cannot starve the music of the
 *     synth's voices.
 *
 * `allow(id, now)` answers yes or no and, on yes, counts the voice until its
 * `seconds` have passed. It REFUSES rather than steals, for the reason
 * `VoicePool.ts` gives: cutting a sound that is playing to start another one
 * is two audible events where the listener expected one.
 *
 * `now` is the caller's clock in seconds: `AudioContext.currentTime` in a game,
 * a number in a test. Nothing here touches Web Audio, so it limits whatever
 * plays the sound (this package's synth, a sample player, an HTML audio
 * element) and it is tested in Node.
 *
 * This file imports nothing. No allocation in `allow` after a sound's first use.
 */

/** The limits for one sound. */
export interface SoundLimit {
  /** Seconds that must pass between two starts of this sound. */
  readonly minGap: number;
  /** Most copies of this sound playing at once. */
  readonly voices: number;
  /** How long one copy counts as playing, seconds. */
  readonly seconds: number;
}

export interface SoundLimiterSpec {
  /** Most sounds playing at once, across every id. */
  readonly maxVoices: number;
  /** The limits for a sound not named in `sounds`. */
  readonly fallback: SoundLimit;
  /** Limits by sound id, for the ones that differ. */
  readonly sounds: Readonly<Record<string, SoundLimit>>;
}

interface Track {
  readonly limit: SoundLimit;
  lastStart: number;
  /** End time of each playing copy; minus infinity when the slot is spare. */
  readonly ends: Float64Array;
}

export class SoundLimiter {
  private readonly spec: SoundLimiterSpec;
  private readonly tracks = new Map<string, Track>();
  /** Counted refusals by reason, for a debug overlay or a test. */
  readonly refused = { gap: 0, voices: 0, total: 0 };

  constructor(spec: SoundLimiterSpec) {
    this.spec = spec;
  }

  private track(id: string): Track {
    let t = this.tracks.get(id);
    if (!t) {
      const limit = this.spec.sounds[id] ?? this.spec.fallback;
      t = { limit, lastStart: -Infinity, ends: new Float64Array(Math.max(1, limit.voices)).fill(-Infinity) };
      this.tracks.set(id, t);
    }
    return t;
  }

  /** Copies of `id` still playing at `now`. */
  playing(id: string, now: number): number {
    const t = this.tracks.get(id);
    if (!t) return 0;
    let n = 0;
    for (let i = 0; i < t.ends.length; i++) if ((t.ends[i] as number) > now) n++;
    return n;
  }

  /** Sounds still playing at `now`, across every id. */
  active(now: number): number {
    let n = 0;
    for (const t of this.tracks.values()) {
      for (let i = 0; i < t.ends.length; i++) if ((t.ends[i] as number) > now) n++;
    }
    return n;
  }

  /**
   * May `id` start at `now`? True counts it as started: play it. False means
   * drop it, and do not queue it for later (a late hit sound is a wrong one).
   */
  allow(id: string, now: number): boolean {
    const t = this.track(id);
    if (now - t.lastStart < t.limit.minGap) { this.refused.gap++; return false; }
    let free = -1;
    for (let i = 0; i < t.ends.length; i++) {
      if ((t.ends[i] as number) <= now) { free = i; break; }
    }
    if (free < 0 || t.limit.voices < 1) { this.refused.voices++; return false; }
    if (this.active(now) >= this.spec.maxVoices) { this.refused.total++; return false; }
    t.ends[free] = now + t.limit.seconds;
    t.lastStart = now;
    return true;
  }

  /** Forget everything playing (a scene change, a context that was rebuilt). */
  reset(): void {
    for (const t of this.tracks.values()) { t.ends.fill(-Infinity); t.lastStart = -Infinity; }
  }
}
