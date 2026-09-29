/**
 * ============================================================================
 *  Voices and placement — the two generic one-shots, and the WebAudio spatial
 *  plumbing every consumer of `Synth` writes the same way.
 * ============================================================================
 *
 * `Synth.ts` is the graph: buses, sends, envelopes, a voice cap. This file is
 * the next layer up and no further — the sounds here have no name in any game
 * and the placement helpers know only about `PannerNode` and `AudioListener`.
 *
 * ## Why so little is in here, and why that is the finding
 *
 * The audio modules of two racing games, a kart racer and a space racer, are
 * 1,969 and 2,468 lines. Every one-shot in them was compared. FIVE THINGS were the same thing; the rest only
 * look alike. `land`/`landing` share a shape — sub thump, filtered noise burst,
 * two retires — and disagree on every number in it (150 Hz against 160, 0.12 s
 * against 0.14, a 1600 Hz corner against 1200). `bell`/`pad` share a signature
 * and are a 2-operator FM bell against a detuned saw pair. Those are the art
 * direction of two different games and merging them would be merging two
 * people's taste, so they stayed where they are.
 *
 * What moved is what was BYTE-IDENTICAL in both files:
 *
 *   blip            a filtered tone with an optional pitch slide
 *   whoosh          a band-passed noise sweep, up or down
 *   placePanner     a panner moved smoothly, with the legacy fallback
 *   placePannerAt   a panner moved instantly, with the legacy fallback
 *   placeListener   the listener's position and orientation, same fallback
 *
 * The last three are worth one copy on their own merits: `positionX` is null on
 * Safari's older `PannerNode`/`AudioListener`, the fallback is the deprecated
 * `setPosition`/`setOrientation`, and a consumer that forgets the branch gets
 * audio that is silently mono on one browser and correct on every other.
 *
 * ## This file imports nothing, and that is a checked property
 *
 * An import check holds `packages/audio/src` to importing nothing at all, which
 * is what makes "no game type crosses this seam, `import type` included" a fact
 * rather than a promise. `placeListener` therefore takes
 * `Vec3Like` rather than a `THREE.Vector3` — three's Vector3 satisfies it
 * structurally, so a caller passes the scratch vector it already has and no
 * dependency is added in either direction.
 */
import { EPS, type Synth } from './Synth.ts';

/** Anything with three numbers on it. `THREE.Vector3` satisfies this. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// One-shots
// ---------------------------------------------------------------------------

/**
 * Generic short tone — the backbone of every UI-ish sound in a game.
 *
 * The low-pass tracks the fundamental (`freq * 6 + 800`) rather than sitting at
 * a fixed corner, so one call covers a 200 Hz thud and a 2 kHz tick without
 * either being dull or thin. `slideTo > 0` adds an exponential pitch glide over
 * the whole duration; `slideTo = 0` means no glide at all rather than a slide
 * to silence, which is why it is a sentinel and not an optional.
 */
export function blip(
  s: Synth, dest: AudioNode, freq: number, dur: number, vol: number,
  type: OscillatorType = 'square', slideTo = 0, delay = 0,
): void {
  const t = s.now + delay;
  const g = s.gain(EPS);
  const lp = s.biquad('lowpass', freq * 6 + 800, 1);
  lp.connect(g);
  g.connect(dest);
  const o = s.osc(type, freq);
  if (slideTo > 0) {
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  }
  o.connect(lp);
  s.perc(g.gain, t, vol, 0.004, dur);
  o.start(t);
  o.stop(t + dur + 0.06);
  s.retire(o, lp, g);
}

/**
 * Filtered noise sweep. `up` rises 400 -> 3400 Hz, otherwise it falls
 * 3200 -> 320 Hz; the Q opens from 1.2 to 3.5 across the same span either way,
 * which is what stops the falling variant reading as a fade rather than a move.
 *
 * The noise buffer is entered at a random offset so two of these fired close
 * together do not phase against each other. That randomness is deliberate and
 * is the reason a harness rendering this has to seed `Math.random` if it wants
 * a repeatable result.
 */
export function whoosh(
  s: Synth, dest: AudioNode, dur: number, vol: number, up: boolean, delay = 0,
): void {
  const t = s.now + delay;
  const n = s.noise('white', false, 1);
  const bp = s.biquad('bandpass', 500, 1.3);
  const g = s.gain(EPS);
  n.connect(bp);
  bp.connect(g);
  g.connect(dest);
  bp.frequency.setValueAtTime(up ? 400 : 3200, t);
  bp.frequency.exponentialRampToValueAtTime(up ? 3400 : 320, t + dur);
  bp.Q.setValueAtTime(1.2, t);
  bp.Q.linearRampToValueAtTime(3.5, t + dur);
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  n.start(t, Math.random() * 1.2);
  n.stop(t + dur + 0.05);
  s.retire(n, bp, g);
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
//
// THE `positionX` TEST IS THE WHOLE POINT OF THESE THREE.
//
// The AudioParam form of PannerNode and AudioListener is the one that can be
// scheduled and smoothed; the deprecated `setPosition()` / `setOrientation()`
// form is a jump. Older Safari has only the second, and reads `positionX` as
// undefined. A consumer that writes only the modern form gets a panner that
// never moves — no error, no warning, and the symptom is a world that sounds
// centred while it looks like it is going past. A consumer that writes only the
// deprecated form gets a zipper on every move.

/**
 * Move a panner smoothly. `tau` is `setTargetAtTime`'s time constant, so the
 * value is ~63% of the way there after `tau` seconds — a moving source wants
 * one of these, not a jump.
 */
export function placePanner(
  p: PannerNode, x: number, y: number, z: number, now: number, tau: number,
): void {
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, now, tau);
    p.positionY.setTargetAtTime(y, now, tau);
    p.positionZ.setTargetAtTime(z, now, tau);
  } else {
    (p as any).setPosition(x, y, z);
  }
}

/**
 * Put a panner somewhere immediately. This is what a ONE-SHOT wants: it is
 * placed once, at the instant it fires, and a smoothed move would start it at
 * wherever the last one-shot was and slide it in.
 */
export function placePannerAt(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as any).setPosition(x, y, z);
  }
}

/**
 * The listener's position and orientation, smoothed. `fwd` and `up` are the
 * camera's own axes; the caller derives them because the camera is the caller's.
 */
export function placeListener(
  l: AudioListener, pos: Vec3Like, fwd: Vec3Like, up: Vec3Like,
  now: number, tau = 0.02,
): void {
  if (l.positionX) {
    l.positionX.setTargetAtTime(pos.x, now, tau);
    l.positionY.setTargetAtTime(pos.y, now, tau);
    l.positionZ.setTargetAtTime(pos.z, now, tau);
    l.forwardX.setTargetAtTime(fwd.x, now, tau);
    l.forwardY.setTargetAtTime(fwd.y, now, tau);
    l.forwardZ.setTargetAtTime(fwd.z, now, tau);
    l.upX.setTargetAtTime(up.x, now, tau);
    l.upY.setTargetAtTime(up.y, now, tau);
    l.upZ.setTargetAtTime(up.z, now, tau);
  } else {
    (l as any).setPosition(pos.x, pos.y, pos.z);
    (l as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}

/**
 * `PannerNode`'s `inverse` distance model, evaluated by hand.
 *
 * A game that pans its world ITSELF — equal-power stereo off the camera basis,
 * because an HRTF panner per one-shot is 3-4x the cost and buys front/back
 * discrimination that a top-down camera cannot use — still wants the falloff a
 * real panner would have applied, and this is the identity the spec gives:
 *
 *     gain = ref / (ref + rolloff * max(0, d - ref))
 *
 * `max(0, …)` is the clamp, not a guard: without it a source INSIDE the
 * reference distance returns a gain above 1 and goes to +inf at the listener.
 * `Synth.ts` sets `refDistance` and `rolloffFactor` on the panners it builds,
 * so a consumer that uses both paths gets one curve rather than two that
 * disagree about how far away is far.
 *
 * **Both numbers are the caller's and there is no default.** How loud a rover
 * is at 200 m is art direction, and a default here is how one game silently
 * inherits another's sense of distance.
 */
export function inverseDistance(ref: number, rolloff: number, d: number): number {
  return ref / (ref + rolloff * Math.max(0, d - ref));
}

// ---------------------------------------------------------------------------
// Voice placement and teardown — the two things every voice class does the same
// ---------------------------------------------------------------------------

/**
 * Put a voice's two panners where the voice is: the continuous one (engine,
 * hull) and the one-shot one (its sfx send).
 *
 * The engine follows SMOOTHLY (0.03 s) because it is continuous; the sfx panner
 * is set INSTANTLY because a one-shot is placed once, at the instant it fires,
 * and smoothing it would slide it in from the last one's position.
 *
 * THE TWO EARLY RETURNS ARE KEPT EXACTLY AS THEY WERE in both games. No engine
 * panner means no sfx panner either in this graph, and collapsing them into two
 * independent `if`s would place the sfx panner in a case where this has never
 * placed it — a behaviour change smuggled into a parity commit.
 *
 * Both are nullable because the PLAYER'S OWN voice has neither: it is mixed dry
 * to the bus, since a panner on the thing the camera is attached to is a
 * smoothing filter on zero.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TAKES TWO PANNERS AND NOT THE VOICE, WHICH WAS THE FIRST ATTEMPT
 * ---------------------------------------------------------------------------
 * The obvious shape is a structural interface — `PannedVoice { enginePanner,
 * sfxPanner }` — which both racing games' voice classes would satisfy without a
 * cast, the same trick `Vec3Like` plays above and the one that let
 * `@homie-rocks/render`'s pipeline and `@homie-rocks/diagnostics` take a game's `Ctx`
 * without ever naming it.
 *
 * IT DOES NOT WORK HERE, and the reason is worth writing down because it is a
 * hard boundary on that technique rather than a detail of these two classes:
 * both fields are `private`, and TypeScript excludes private members from
 * structural assignability outright — a class with a private `enginePanner` is
 * not assignable to an interface with a public one, no matter how identical the
 * runtime shape is. Measured, both games, TS2345.
 *
 * The fix is NOT to widen the fields to public so the seam type-checks. That
 * would loosen two classes' encapsulation to suit a helper, which is the tail
 * wagging the dog. Passing the two nodes keeps them private, keeps the call
 * site one line, and keeps this file importing nothing.
 */
export function placeVoice(
  engine: PannerNode | null, sfx: PannerNode | null,
  x: number, y: number, z: number, now: number, tau = 0.03,
): void {
  if (!engine) return;
  placePanner(engine, x, y, z, now, tau);
  if (!sfx) return;
  placePannerAt(sfx, x, y, z);
}

/**
 * Manual Doppler, plus the distance cull that comes with it.
 *
 * THE SPEC DROPPED DOPPLER FROM `PannerNode`. `dopplerFactor` and
 * `speedOfSound` were removed from the Web Audio API and nothing replaced them,
 * so a rival that closes on you without pitching sounds like a recording rather
 * than like something arriving. Both racers noticed and both wrote this, with
 * the same comment on it.
 *
 * Returns the multiplier to apply to the voice's pitch, or **null** when the
 * source is beyond `cull` metres — at which point the caller should mute the
 * voice and skip it entirely, because past that range the panner already has it
 * tens of dB down and pushing a dozen param events a frame at something
 * inaudible is the whole cost with none of the benefit.
 *
 * ## The two numbers a game supplies, and why neither is a flag
 *
 * `cull` is a distance in metres and `maxShift` is a fraction. The kart racer
 * uses 200 m and ±0.05; the space racer uses 500 m and ±0.08, because its
 * closing speeds reach 60 m/s against the karts' 30 and the same clamp would
 * flatten the cue it exists to give — and because at 165 m/s its pack strings out over
 * hundreds of metres, so 200 m of hearing is under a second of track. Two
 * values. There is no branch in here and there must not be one — see this
 * file's note on `land`/`landing`.
 *
 * ## The arithmetic is three.js's arithmetic, deliberately
 *
 * Both games computed this with `THREE.Vector3` — `copy().sub()`, `length()`,
 * `multiplyScalar(1 / d)`, `dot()` — and this function reproduces those
 * operations **in the same order, with the same associativity**, so that a
 * migration is bit-exact rather than merely close.
 *
 * `multiplyScalar(1 / d)` is NOT the same as dividing each component by `d` in
 * floating point, and normalising the wrong way moves the result in the last
 * binary digit. A test compares this against real `THREE.Vector3` calls with
 * `Object.is` and no epsilon, and carries a named fault for exactly that
 * substitution.
 *
 * ## The listener position is passed in by value, never borrowed
 *
 * Both games read a MODULE-LEVEL scratch vector that `syncListener` had filled
 * earlier in the same frame. `Rig.ts`'s header explains at length why that is
 * the most fragile thing in either file. `VoiceRig.doppler` calls this with the
 * rig's own copied `lx/ly/lz`, so nothing outside the rig can clobber it.
 *
 * @param lx,ly,lz  the listener's world position
 * @param pos       the source's world position
 * @param vel       the source's world velocity
 * @param ref       the velocity Doppler is measured RELATIVE to (the player's),
 *                  or null — in which case there is no shift, only the cull
 * @param cull      metres past which the source is not worth a voice slot
 * @param maxShift  the clamp on the shift, as a fraction of the pitch
 */
export function dopplerShift(
  lx: number, ly: number, lz: number,
  pos: Vec3Like, vel: Vec3Like, ref: Vec3Like | null,
  cull: number, maxShift: number,
): number | null {
  // `_rel.copy(pos).sub(listener)`
  let rx = pos.x - lx;
  let ry = pos.y - ly;
  let rz = pos.z - lz;
  // `_rel.length()`
  const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (d > cull) return null;
  if (d > 1e-3 && ref) {
    // `_rel.multiplyScalar(1 / d)` — the reciprocal FIRST. See above.
    const inv = 1 / d;
    rx *= inv;
    ry *= inv;
    rz *= inv;
    // `_vel.copy(vel).sub(ref)`, then `_vel.dot(_rel)`: closing speed along the
    // line of sight, positive when the source is coming at the listener.
    const vx = vel.x - ref.x;
    const vy = vel.y - ref.y;
    const vz = vel.z - ref.z;
    const closing = (vx * rx + vy * ry + vz * rz) / 343;
    return 1 - (closing < -maxShift ? -maxShift : closing > maxShift ? maxShift : closing);
  }
  return 1;
}

/**
 * Stop every scheduled source a voice owns and empty the list.
 *
 * THE `try` IS NOT DEFENSIVE PROGRAMMING AND MUST STAY. `stop()` on a source
 * that already stopped throws `InvalidStateError`, and a teardown that throws
 * half way through leaves the rest of the graph running — which on a phone is
 * its audio hardware held awake by a game nobody is playing.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO OF THESE AND NOT ONE WITH A FLAG
 * ---------------------------------------------------------------------------
 * This teardown was written SEVEN times across the two racing games' audio
 * modules, and the seven do not agree. Four of them stop AND disconnect (the
 * kart racer's engine voice and drift-charge tone, the space racer's hull voice
 * and slide tone); three of them only stop (the kart racer's ambience, the
 * space racer's induction and structure beds). Nothing in either game
 * distinguishes the two groups in a comment, and nothing noticed the split.
 *
 * A single function with a `disconnect = true` argument would be a flag that
 * changes BEHAVIOUR inside shared code, which is the definition of two things
 * wearing one name. So there are two functions, each call site keeps the one it
 * already had, and the split is now visible instead of scattered.
 *
 * WHICH GROUP IS RIGHT IS NOT SETTLED HERE. A stopped source is not collected
 * while it is still connected, so the stop-only three may well be leaking a
 * node per teardown — but they may also be relying on the bus they feed being
 * torn down with them, and deciding that inside a de-duplication commit is
 * exactly how a guard gets deleted for a reason that turns out to be wrong.
 * It is a question for whoever owns the mix, with a before and after.
 */
export function stopSources(sources: AudioScheduledSourceNode[]): void {
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  sources.length = 0;
}

/** As `stopSources`, and disconnects each source as well. See its header. */
export function stopAndDisconnectSources(sources: AudioScheduledSourceNode[]): void {
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
    try { s.disconnect(); } catch { /* already gone */ }
  }
  sources.length = 0;
}
