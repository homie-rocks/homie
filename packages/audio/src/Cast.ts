/**
 * ============================================================================
 *  Cast.ts — the per-frame bookkeeping above a grid of continuous voices: who
 *  gets updated this frame, how fast they are going, and how far away.
 * ============================================================================
 *
 * `Machine.ts` is one continuous voice. `Rig.ts` is the registry that owns one
 * per actor. This is the FRAME over that registry, and it is the last piece of
 * either racer's `Audio.update()` that was not already shared.
 *
 * ## The outcome this file owns
 *
 *   **Every actor's voice is refreshed at the right rate with the right
 *   smoothing, a rival's effort is inferred rather than guessed, and a voice
 *   too far away to hear costs nothing and is silenced rather than left
 *   hanging.**
 *
 * ## Why it is here
 *
 * A kart racer's `Audio.update()` and a space racer's were 165 and 224 lines and
 * the two of them open with the SAME FIFTY-SEVEN, down to this comment:
 *
 *     // Rivals refresh at 20 Hz with a longer smoothing constant: inaudible,
 *     // and it keeps param-event traffic to roughly a third.
 *
 * The whole divergence is nine numbers and one clause. The numbers are in
 * `CastTuning` — the stride, the two smoothing constants, the two ends of the
 * throttle inference, the rival's level, the cull distance and the Doppler
 * clamp, and how high off the ground a voice sits. Two of them are worth
 * reading twice:
 *
 *   the inference gain      0.14 in a kart, 0.06 in a ship. AI throttle is not
 *                           on the actor interface, so it is inferred from
 *                           acceleration; a ship accelerates harder for the
 *                           same effort and would otherwise read as flat out
 *                           the whole time.
 *   the Doppler clamp       ±0.05 against ±0.08. Closing speeds reach 30 m/s in
 *                           one game and 60 in the other.
 *
 * ## THE CLAUSE, AND WHY THIS IS TWO FUNCTIONS AND NOT ONE
 *
 * Between inferring the throttle and scaling it for the menu, each game damps
 * it for its own reason and **they do not damp it the same way**:
 *
 *     kart racer    if (k.stunTime > 0) throttle = 0.08;
 *     space racer   if (k.stunTime > 0 || k.thermalTrip > 0) throttle = Math.min(throttle, 0.32);
 *
 * An assignment against a clamp. Those are not the same operation — a coasting
 * kart whose inferred throttle is already below 0.08 gets RAISED by the first
 * and left alone by the second — so they stay in the games, and the shared work
 * is split either side of them. A `stunThrottle: number` field would have
 * merged an assignment into a clamp silently, which is the
 * `solveTyre`/`solveAxle` mistake (see `ChargeTone.ts`) with a pedal on it.
 *
 * That is also why there is no callback here. A closure per actor per frame on
 * the hottest path in the game, to save four lines, is the wrong trade; two
 * calls with the game's own four lines between them is the right one.
 *
 * ## What did NOT move
 *
 * Everything after the voice update: the tyre-slip and mag-shear blocks (they
 * resolve the slip angle against world up in one game and the SHIP'S OWN RIGHT
 * VECTOR in the other, because on the deck's underside a world-up cross product
 * points the wrong way — merging those is wrong by the whole bank angle), the
 * tunnel and the pressure switch, the void run, the charge ladder and its
 * sidechain, both ambience beds, and the music.
 *
 * ## `Ctx` does not cross this seam, and neither does any game type
 *
 * The interfaces below list the fields the code ACTUALLY READS and nothing
 * else: five on an actor, three on a voice, one method on the rig. `IKart`,
 * `KartVoice`, `HullVoice` and `VoiceRig` all satisfy them structurally, so no
 * call site declares a type and no `import type` crosses the boundary.
 */
import type { Vec3Like } from './Voice.ts';

/** The five fields of an actor this file reads. `IKart` satisfies it. */
export interface CastActor {
  readonly isPlayer: boolean;
  /** Signed; only its magnitude is used. */
  readonly forwardSpeed: number;
  /** Seconds of boost left. Any amount at all pins the inferred throttle open. */
  readonly boostTime: number;
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
}

/** The three members of a continuous voice this file touches. */
export interface CastVoice {
  /** Last frame's speed, kept here because the inference is a difference. */
  prevSpeed: number;
  mute(now: number): void;
  setPosition(x: number, y: number, z: number, now: number): void;
}

/** The one method of the registry this file calls. `VoiceRig` satisfies it. */
export interface CastRig {
  doppler(
    pos: Vec3Like, vel: Vec3Like, ref: Vec3Like | null,
    cull: number, maxShift: number,
  ): number | null;
}

/** What the game's input layer offers, when there is a person holding it. */
export interface CastInput {
  readonly accel: number;
  readonly brake: number;
}

/** The nine numbers the two games disagree on. All required — see `Patch.ts`. */
export interface CastTuning {
  /** Refresh every Nth frame for a rival. 3 is 20 Hz at 60, and inaudible. */
  readonly stride: number;
  readonly playerTau: number;
  readonly rivalTau: number;
  /** Inferred throttle is `clamp01(inferBase + acceleration * inferGain)`. */
  readonly inferBase: number;
  readonly inferGain: number;
  /** How loud a rival is against the player's own 1. */
  readonly rivalLevel: number;
  /** Past this the panner has it far enough down to skip the voice entirely. */
  readonly cullDistance: number;
  readonly dopplerClamp: number;
  /** How far above the actor's origin its voice sits, in metres. */
  readonly voiceHeight: number;
}

/**
 * One actor's frame, filled in place. Allocated once by the caller and reused
 * for every actor — nothing on this path allocates.
 */
export interface CastFrame {
  step: number;
  tau: number;
  speed: number;
  speedNorm: number;
  throttle: number;
  brake: number;
  boost: number;
  level: number;
  doppler: number;
}

/** A zeroed frame, to hold as a field. */
export function castFrame(): CastFrame {
  return {
    step: 0, tau: 0, speed: 0, speedNorm: 0,
    throttle: 0, brake: 0, boost: 0, level: 1, doppler: 1,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * WHAT THE ACTOR IS DOING. Fills `step`, `tau`, `speed`, `speedNorm`,
 * `throttle`, `brake` and `boost`, and advances the voice's `prevSpeed`.
 *
 * @param top the actor's own top speed, so `speedNorm` means the same thing for
 *            a light machine and a heavy one. The stat table is the game's.
 * @param input the player's pad, or null when nobody is holding one — an
 *              unattended player falls back to the same inference a rival gets.
 * @returns false when the stride skips this actor this frame. The caller
 *          `continue`s; NOTHING has been written and `prevSpeed` is untouched,
 *          which is what makes the inference a difference over `step` rather
 *          than over one frame.
 */
export function castDrive(
  out: CastFrame, actor: CastActor, voice: CastVoice,
  index: number, frame: number, dt: number, top: number,
  input: CastInput | null, tuning: CastTuning,
): boolean {
  const isPlayer = actor.isPlayer;
  // Rivals refresh at 20 Hz with a longer smoothing constant: inaudible, and it
  // keeps param-event traffic to roughly a third. Offset by index so the whole
  // grid does not land on the same frame.
  if (!isPlayer && (frame + index) % tuning.stride !== 0) return false;

  out.step = isPlayer ? dt : dt * tuning.stride;
  out.tau = isPlayer ? tuning.playerTau : tuning.rivalTau;
  out.speed = Math.abs(actor.forwardSpeed);
  out.speedNorm = out.speed / top;

  if (isPlayer && input) {
    out.throttle = input.accel;
    out.brake = input.brake;
  } else {
    // Rival throttle is not on the actor interface, so infer it from
    // acceleration. Close enough that the timbre shift on corner exit reads.
    const acc = out.step > 0 ? (out.speed - voice.prevSpeed) / out.step : 0;
    out.throttle = clamp01(tuning.inferBase + acc * tuning.inferGain);
    out.brake = 0;
  }
  voice.prevSpeed = out.speed;
  if (actor.boostTime > 0) out.throttle = 1;

  // Boost as a continuous amount, not a flag: the tail should fade out of the
  // machine rather than switch off.
  out.boost = actor.boostTime > 0 ? clamp01(actor.boostTime * 3) : 0;
  return true;
}

/**
 * WHERE IT IS AND HOW LOUD. Fills `level` and `doppler`, and places the voice.
 *
 * Manual Doppler, because the spec dropped it from `PannerNode` and a rival
 * that closes on you without pitching sounds like a recording. Past the cull
 * distance the panner has the voice far enough down that pushing a dozen param
 * events a frame at it is pure cost, so the voice is muted and the caller skips
 * the rest of its frame.
 *
 * @param levelScale the game's own trim — half in a menu, all of it in play.
 * @returns false when the voice was culled. It has already been muted.
 */
export function castPlace(
  out: CastFrame, rig: CastRig, actor: CastActor, voice: CastVoice,
  now: number, playerVel: Vec3Like | null,
  paused: boolean, levelScale: number, tuning: CastTuning,
): boolean {
  const isPlayer = actor.isPlayer;
  out.level = (paused ? 0 : isPlayer ? 1 : tuning.rivalLevel) * levelScale;
  out.doppler = 1;
  if (isPlayer) return true;

  // Against the rig's OWN copy of the listener rather than a module scratch —
  // see VoiceRig.doppler and the scratch-aliasing note in Rig.ts.
  const shift = rig.doppler(
    actor.position, actor.velocity, playerVel, tuning.cullDistance, tuning.dopplerClamp,
  );
  if (shift === null) {
    voice.mute(now);
    return false;
  }
  out.doppler = shift;
  voice.setPosition(
    actor.position.x, actor.position.y + tuning.voiceHeight, actor.position.z, now,
  );
  return true;
}
