/**
 * ============================================================================
 *  Acting — travel that is driven by the ground, and performance beats that
 *  read from ten feet away.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A character that moves from one mark to another plants its feet on the
 *   ground it crosses, and a test can prove it did without looking at a
 *   picture.**
 *
 * ## The failure
 *
 * One short film, from its retrospective: *"Early versions looked as if
 * characters were being dragged because translation and performance were not
 * coupled to a planted walk cycle. High-quality acting required many
 * hand-tuned procedural pose weights."*
 *
 * That is one specific mistake with one specific fix. The walk cycle was
 * driven by **time** — a sine wave of the animation clock — while the body was
 * driven by **position**. Any disagreement between the two is a foot moving
 * while it is on the floor, which the eye reads as skating even when it cannot
 * name what is wrong.
 *
 * So here the cycle phase is a function of **distance travelled along the
 * path**, and nothing else:
 *
 *     phase = (distance / strideLength) mod 1
 *
 * A character standing still has a constant phase and therefore does not
 * shuffle. A character that speeds up takes faster steps of the SAME LENGTH,
 * which is what a body does. And a character whose position is being sampled
 * at an arbitrary authored time — a seek — gets the correct phase, because
 * distance is a function of t and not an integration of it. The seek/reset
 * contract in `Stage.ts` is satisfied for free rather than by a `resetAt` that
 * has to guess.
 *
 * ## What this file will NOT do
 *
 * It does not pose a skeleton. It knows nothing about bones, rigs, IK solvers
 * or `three`. It answers, for a time: where the body is, which way it faces,
 * where in the gait it is, which foot is down and where that foot is planted.
 * A game maps that onto whatever its characters are made of — which for one
 * film's robot cast is a set of pose weights and for somebody else's film
 * is a glTF clip.
 *
 * Keeping the seam there is what makes {@link validateLocomotion} possible in
 * a Node test with no renderer. A foot-sliding check that needs a GPU is a
 * check that runs once, by hand, on the day somebody remembers.
 */

import type { Blocking, CompiledShot, Vec3 } from './Timeline.ts';
import type { SetIndex } from './Sets.ts';

/* ========================================================================== */
/* Travel                                                                     */
/* ========================================================================== */

/** A resolved blocking point: where, when, facing what. */
export interface PathPoint {
  readonly p: number;
  readonly at: Vec3;
  readonly facing?: Vec3;
}

/** How a particular body walks. Metres and seconds; nothing is unitless. */
export interface Gait {
  /**
   * Ground distance covered by ONE step — heel strike to the other heel
   * strike. About 0.75 m for a 1.75 m human at a normal walk.
   */
  readonly strideM: number;
  /** Half the lateral gap between the feet. */
  readonly trackM: number;
  /** How high the swing foot lifts. */
  readonly liftM: number;
  /**
   * Vertical travel of the body's centre over one step.
   *
   * A real body rises when it passes over the planted leg. Getting this wrong
   * is what makes a walk read as a hovering slide even when the feet are
   * planted correctly.
   */
  readonly bobM: number;
  /** Below this speed the character stands rather than walks. */
  readonly standingBelowMs: number;
}

export const HUMAN_GAIT: Gait = {
  strideM: 0.74,
  trackM: 0.11,
  liftM: 0.10,
  bobM: 0.028,
  standingBelowMs: 0.12,
};

/** Everything about a body at one instant. */
export interface ActorPose {
  /** Ground position of the body's root, including the bob. */
  readonly at: Vec3;
  /** Heading, radians, 0 = +Z. */
  readonly facingRad: number;
  /** Ground speed, m/s. */
  readonly speedMs: number;
  /** 0…1 through the gait cycle. Two steps per cycle. */
  readonly phase: number;
  /** Which foot is bearing weight. `none` while standing. */
  readonly planted: 'left' | 'right' | 'none';
  /** Where the planted foot is, world space. */
  readonly plantAt: Vec3;
  /** Distance travelled along the path so far, metres. */
  readonly distanceM: number;
  readonly verb: string;
  readonly intensity: number;
}

/**
 * Resolve one actor's blocking in one shot into a path with real world points.
 *
 * Marks are looked up through the shot's set. A blocking with neither a mark
 * nor a point is dropped and reported by `Continuity.ts`; silently inventing
 * the origin for it would put a character at [0,0,0], which on most maps is
 * somewhere and looks deliberate.
 */
export function resolvePath(shot: CompiledShot, blocking: readonly Blocking[], sets: SetIndex): PathPoint[] {
  const out: PathPoint[] = [];
  for (const b of blocking) {
    const at = b.at ?? (b.mark ? sets.mark(shot.setId, b.mark)?.at : undefined);
    if (!at) continue;
    let facing: Vec3 | undefined;
    if (Array.isArray(b.facing)) facing = b.facing as Vec3;
    else if (typeof b.facing === 'string') {
      const target = sets.mark(shot.setId, b.facing);
      if (target) facing = target.at;
    }
    out.push(facing ? { p: b.p, at, facing } : { p: b.p, at });
  }
  return out;
}

/**
 * Where the body is at normalised position `p` through a shot.
 *
 * Straight lines between marks, with a smoothstep on each leg so a character
 * does not start and stop with infinite acceleration. Not a spline: a
 * character walking through a wall because the curve bulged is a worse failure
 * than a character walking in a straight line, and a director who wants a
 * curve adds a mark, which is also what a director does on a real set.
 */
export function travelAt(path: readonly PathPoint[], p: number): { at: Vec3; distanceM: number; speedP: number } {
  if (path.length === 0) return { at: [0, 0, 0], distanceM: 0, speedP: 0 };
  const first = path[0]!;
  if (path.length === 1 || p <= first.p) return { at: first.at, distanceM: 0, speedP: 0 };
  const last = path[path.length - 1]!;

  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const legLength = distance(a.at, b.at);
    if (p > b.p) { travelled += legLength; continue; }
    const span = b.p - a.p;
    const raw = span > 0 ? (p - a.p) / span : 1;
    const eased = smoothstep(raw);
    // The derivative of smoothstep, which is what makes speed continuous at
    // the marks rather than a step change the eye catches as a twitch.
    const dEased = span > 0 ? 6 * raw * (1 - raw) / span : 0;
    return {
      at: lerp3(a.at, b.at, eased),
      distanceM: travelled + legLength * eased,
      speedP: legLength * dEased,
    };
  }
  return { at: last.at, distanceM: travelled, speedP: 0 };
}

/**
 * The whole pose, at a normalised position through a shot.
 *
 * `secondsPerP` converts the shot's normalised axis into real seconds so the
 * speed is in m/s and the standing threshold means something.
 */
export function poseAt(
  path: readonly PathPoint[],
  p: number,
  secondsPerP: number,
  gait: Gait = HUMAN_GAIT,
  beat: { verb: string; intensity: number } = { verb: 'idle', intensity: 0 },
): ActorPose {
  const travel = travelAt(path, p);
  const speedMs = secondsPerP > 0 ? travel.speedP / secondsPerP : 0;
  const walking = speedMs >= gait.standingBelowMs;

  // TWO steps per cycle, so `phase` runs 0…1 over a left-right pair and each
  // half is one stride. Dividing by strideM alone would make the cycle one
  // step long and swap the feet every stride, which reads as a limp.
  const phase = walking ? ((travel.distanceM / (gait.strideM * 2)) % 1 + 1) % 1 : 0;
  const planted: 'left' | 'right' | 'none' = walking ? (phase < 0.5 ? 'left' : 'right') : 'none';

  const facing = facingAt(path, p, travel.at, walking);

  // The planted foot does not move while it is planted. Its position is the
  // body's position at the moment of the plant, offset sideways by the track
  // — which is exactly what "planted" means, and exactly what the validator
  // below measures. Deriving it any other way would let the two disagree.
  const stepIndex = walking ? Math.floor(travel.distanceM / gait.strideM) : 0;
  const plantDistance = stepIndex * gait.strideM;
  const plantBody = walking ? pointAtDistance(path, plantDistance) : travel.at;
  const side = planted === 'left' ? -1 : 1;
  const right: Vec3 = [Math.cos(facing), 0, -Math.sin(facing)];
  const plantAt: Vec3 = [
    plantBody[0] + right[0] * gait.trackM * side,
    plantBody[1],
    plantBody[2] + right[2] * gait.trackM * side,
  ];

  const bob = walking ? Math.abs(Math.sin(phase * Math.PI * 2)) * gait.bobM : 0;

  return {
    at: [travel.at[0], travel.at[1] + bob, travel.at[2]],
    facingRad: facing,
    speedMs,
    phase,
    planted,
    plantAt,
    distanceM: travel.distanceM,
    verb: beat.verb,
    intensity: beat.intensity,
  };
}

/**
 * Which way the body faces.
 *
 * A walking body faces the way it is going; a standing one faces whatever the
 * nearest authored `facing` says, and if nothing says anything it keeps the
 * heading of the last leg it walked. A body that snaps to +Z when it stops is
 * the single most common tell that a character is a prop.
 */
function facingAt(path: readonly PathPoint[], p: number, here: Vec3, walking: boolean): number {
  const authored = nearestFacing(path, p);
  if (authored) {
    const dx = authored[0] - here[0];
    const dz = authored[2] - here[2];
    if (Math.hypot(dx, dz) > 1e-4) return Math.atan2(dx, dz);
  }
  if (walking) {
    const ahead = travelAt(path, Math.min(1, p + 0.01)).at;
    const dx = ahead[0] - here[0];
    const dz = ahead[2] - here[2];
    if (Math.hypot(dx, dz) > 1e-5) return Math.atan2(dx, dz);
  }
  // The heading of the last leg with any length in it.
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.at[0] - a.at[0];
    const dz = b.at[2] - a.at[2];
    if (Math.hypot(dx, dz) > 1e-5) return Math.atan2(dx, dz);
  }
  return 0;
}

function nearestFacing(path: readonly PathPoint[], p: number): Vec3 | undefined {
  let best: PathPoint | undefined;
  for (const point of path) {
    if (!point.facing) continue;
    if (point.p <= p) best = point;
    else if (!best) best = point;
  }
  return best?.facing;
}

/** Walk the path to a given ground distance. Used for the plant position. */
function pointAtDistance(path: readonly PathPoint[], target: number): Vec3 {
  if (path.length === 0) return [0, 0, 0];
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const legLength = distance(a.at, b.at);
    if (travelled + legLength >= target) {
      const f = legLength > 0 ? (target - travelled) / legLength : 0;
      return lerp3(a.at, b.at, f);
    }
    travelled += legLength;
  }
  return path[path.length - 1]!.at;
}

/* ========================================================================== */
/* Verbs                                                                      */
/* ========================================================================== */

/**
 * A performance beat's contribution at time `p`, as a 0…1 weight.
 *
 * The envelope is anticipation, hold, release — the same three-part shape the
 * earlier production's `actingBeat` used, which was right and is the one thing
 * from that file worth keeping. A beat with no readable hold reads as a twitch; a beat
 * with no anticipation reads as a snap.
 */
export function beatWeight(p: number, from: number, to: number, edge = 0.22): number {
  const span = Math.max(1e-6, to - from);
  const e = Math.min(edge, span * 0.45);
  return Math.max(0, Math.min(smoothstep((p - from) / e), smoothstep((to - p) / e)));
}

/** Which beat is active at `p`, and how strongly. */
export function beatAt(
  beats: readonly { readonly p: number; readonly verb: string; readonly intensity?: number }[] | undefined,
  p: number,
): { verb: string; intensity: number } {
  if (!beats || beats.length === 0) return { verb: 'idle', intensity: 0 };
  let active = beats[0]!;
  for (const b of beats) if (b.p <= p) active = b; else break;
  const index = beats.indexOf(active);
  const next = beats[index + 1];
  const to = next ? next.p : 1;
  const weight = beatWeight(p, active.p, to);
  return { verb: active.verb, intensity: (active.intensity ?? 1) * weight };
}

/**
 * What a verb actually asks a body to do, as named weights between 0 and 1.
 *
 * This is the seam, and where it sits is the whole design decision. A film
 * package cannot pose a skeleton — it does not know whether the character is a
 * glTF rig, an instanced robot with pose weights, or a paper cut-out. What it
 * CAN own is the meaning: `reach` is how far the arm is extended, `brace` is how
 * low the stance is, `recoil` is a startle, `attention` is the head turning
 * toward something. A game maps five numbers onto whatever its characters are
 * made of.
 *
 * The earlier production had exactly these, spelled `wCarry`, `wWeld`, `wInspect`
 * and `wHaul`, hand-tuned per shot inside a 1,573-line director, each one a
 * literal in a chain of `if (t > 11.5 && t < 14.6)` blocks. Naming them and
 * deriving them from an authored beat is what turns "many hand-tuned procedural
 * pose weights" into a table somebody can read.
 */
export interface ActingSignal {
  readonly verb: string;
  /** The beat's envelope — anticipation, hold, release. Everything else scales by it. */
  readonly weight: number;
  /** Arm extension toward the target. */
  readonly reach: number;
  /** Hand closed on something. */
  readonly grip: number;
  /** Stance lowered and widened. */
  readonly brace: number;
  /** A startle, away from the target. */
  readonly recoil: number;
  /** Head and eyes toward the target. */
  readonly attention: number;
  /** Weight settling back to neutral — the end of a movement, not the absence of one. */
  readonly settle: number;
  readonly target: string | undefined;
}

/**
 * What each verb means, at full intensity.
 *
 * A table rather than a switch so a film can read it, a probe can enumerate it,
 * and adding a verb is one row. Values are shapes, not tuning: `grab` is a
 * reach that closes; `brace` is a stance with no reach in it; `react` is a
 * recoil with the attention already on the thing. None of these is a number
 * anybody should be adjusting per shot — that is what `intensity` is for.
 */
export const VERB_SHAPES: Readonly<Record<string, Omit<ActingSignal, 'verb' | 'weight' | 'target'>>> = {
  idle:   { reach: 0,    grip: 0,    brace: 0,    recoil: 0,   attention: 0.15, settle: 1 },
  walk:   { reach: 0,    grip: 0,    brace: 0.08, recoil: 0,   attention: 0.55, settle: 0 },
  turn:   { reach: 0,    grip: 0,    brace: 0.05, recoil: 0,   attention: 0.9,  settle: 0.2 },
  look:   { reach: 0,    grip: 0,    brace: 0,    recoil: 0,   attention: 1,    settle: 0.4 },
  reach:  { reach: 1,    grip: 0.1,  brace: 0.15, recoil: 0,   attention: 0.9,  settle: 0 },
  grab:   { reach: 0.85, grip: 1,    brace: 0.25, recoil: 0,   attention: 0.85, settle: 0 },
  carry:  { reach: 0.35, grip: 1,    brace: 0.4,  recoil: 0,   attention: 0.3,  settle: 0.3 },
  brace:  { reach: 0.1,  grip: 0.35, brace: 1,    recoil: 0,   attention: 0.6,  settle: 0 },
  react:  { reach: 0,    grip: 0,    brace: 0.3,  recoil: 1,   attention: 1,    settle: 0 },
  settle: { reach: 0,    grip: 0,    brace: 0,    recoil: 0,   attention: 0.3,  settle: 1 },
};

/**
 * The blended signal at a normalised position in a shot.
 *
 * One active beat at a time, faded by its own envelope — not a sum over every
 * beat in the shot. A body doing two things at once is a directorial decision
 * and it is expressed by two ACTORS or two beats in sequence, not by a package
 * quietly averaging a brace and a grab into a shrug.
 *
 * An unknown verb falls back to `idle` and is NAMED in the returned `verb`, so
 * a typo in a manifest reads as a character standing still rather than as a
 * character doing something subtly wrong that nobody can find.
 */
export function signalAt(
  beats: readonly { readonly p: number; readonly verb: string; readonly intensity?: number; readonly target?: string }[] | undefined,
  p: number,
): ActingSignal {
  if (!beats || beats.length === 0) {
    return { verb: 'idle', weight: 1, target: undefined, ...VERB_SHAPES['idle']! };
  }
  let active = beats[0]!;
  for (const beat of beats) if (beat.p <= p) active = beat; else break;
  const index = beats.indexOf(active);
  const next = beats[index + 1];
  const envelope = beatWeight(p, active.p, next ? next.p : 1);
  const shape = VERB_SHAPES[active.verb] ?? VERB_SHAPES['idle']!;
  const scale = envelope * (active.intensity ?? 1);
  return {
    verb: active.verb,
    weight: envelope,
    target: active.target,
    reach: shape.reach * scale,
    grip: shape.grip * scale,
    brace: shape.brace * scale,
    recoil: shape.recoil * scale,
    // Attention and settle do not fall to zero between beats: a body that stops
    // looking at anything the instant a beat ends reads as a mannequin, and a
    // body with no settle weight at rest reads as one that has been paused.
    attention: shape.attention * (0.35 + 0.65 * scale),
    settle: shape.settle * (0.4 + 0.6 * (1 - scale)),
  };
}

/** Every verb this package knows. A film linter enumerates it; a game switches on it. */
export function knownVerbs(): string[] { return Object.keys(VERB_SHAPES).sort(); }

/* ========================================================================== */
/* Validation                                                                 */
/* ========================================================================== */

export interface LocomotionProblem {
  readonly severity: 'error' | 'warning';
  readonly code: 'foot-slide' | 'missed-contact' | 'impossible-acceleration' | 'backwards-walk' | 'teleport' | 'unknown-verb' | 'out-of-reach' | 'no-target';
  readonly actor: string;
  readonly shot: string;
  /** Normalised position within the shot where it happens. */
  readonly p: number;
  readonly detail: string;
}

export interface LocomotionLimits {
  /** Metres a planted foot may drift before it counts as sliding. */
  readonly slideM?: number;
  /** Hardest a body may change speed, m/s². About 4 for a person breaking into a run. */
  readonly accelMs2?: number;
  /** Steps per second above which the gait is not a walk any more. */
  readonly maxCadenceHz?: number;
}

/**
 * Sample a shot and report everything a body could not have done.
 *
 * `samples` is the number of positions taken across the shot; the default is
 * a sample per authored frame, which is what actually matters — a slide that
 * only exists between two rendered frames is not a slide anybody sees, and a
 * validator that samples finer than the film reports faults the film does not
 * have.
 */
export function validateLocomotion(
  actor: string,
  shot: CompiledShot,
  path: readonly PathPoint[],
  fps: number,
  gait: Gait = HUMAN_GAIT,
  limits: LocomotionLimits = {},
): LocomotionProblem[] {
  const slideLimit = limits.slideM ?? 0.02;
  const accelLimit = limits.accelMs2 ?? 4;
  const cadenceLimit = limits.maxCadenceHz ?? 3.2;
  const problems: LocomotionProblem[] = [];
  if (path.length < 2) return problems;

  const frames = Math.max(2, Math.round(shot.seconds * fps));
  const dt = shot.seconds / frames;
  const secondsPerP = shot.seconds;

  let previous = poseAt(path, 0, secondsPerP, gait);
  let plantAnchor = previous.plantAt;
  let plantFoot = previous.planted;

  for (let i = 1; i <= frames; i++) {
    const p = i / frames;
    const pose = poseAt(path, p, secondsPerP, gait);

    if (pose.planted !== 'none' && pose.planted === plantFoot) {
      const drift = distance(pose.plantAt, plantAnchor);
      if (drift > slideLimit) {
        problems.push({
          severity: 'error', code: 'foot-slide', actor, shot: shot.id, p,
          detail: `the ${pose.planted} foot moves ${(drift * 100).toFixed(1)} cm while it is bearing weight — this is what "being dragged" looks like, and it is why the gait must be driven by distance and not by a clock`,
        });
        plantAnchor = pose.plantAt;
      }
    } else {
      plantAnchor = pose.plantAt;
      plantFoot = pose.planted;
    }

    const accel = Math.abs(pose.speedMs - previous.speedMs) / dt;
    if (accel > accelLimit) {
      problems.push({
        severity: 'warning', code: 'impossible-acceleration', actor, shot: shot.id, p,
        detail: `changes speed by ${(pose.speedMs - previous.speedMs).toFixed(2)} m/s in one frame (${accel.toFixed(1)} m/s²) — add a mark, or give the leg more of the shot`,
      });
    }

    const cadence = pose.speedMs / gait.strideM;
    if (cadence > cadenceLimit) {
      problems.push({
        severity: 'warning', code: 'missed-contact', actor, shot: shot.id, p,
        detail: `${cadence.toFixed(1)} steps per second at ${pose.speedMs.toFixed(1)} m/s — past a walk. Either this is a run and the gait should say so, or the marks are too far apart for the time.`,
      });
    }

    previous = pose;
  }

  // One row per kind, at its FIRST occurrence, carrying how many frames it
  // affected. A slide that lasts a second otherwise produces thirty identical
  // rows and buries everything else in the report — and a report nobody reads
  // to the end is a report that only catches the first thing wrong.
  return summarise(problems);
}

function summarise(problems: readonly LocomotionProblem[]): LocomotionProblem[] {
  const first = new Map<string, LocomotionProblem>();
  const counts = new Map<string, number>();
  for (const problem of problems) {
    counts.set(problem.code, (counts.get(problem.code) ?? 0) + 1);
    if (!first.has(problem.code)) first.set(problem.code, problem);
  }
  return [...first.values()].map((problem) => {
    const n = counts.get(problem.code) ?? 1;
    return n === 1 ? problem : { ...problem, detail: `${problem.detail} (${n} frames, first at p=${problem.p.toFixed(3)})` };
  });
}

/**
 * Everything a performance asks for that a body could not do.
 *
 * Separate from {@link validateLocomotion} because these are about the ARMS and
 * the intent, not the feet, and because a film with no performance beats should
 * come back with an empty list from this rather than an unrun pass hidden
 * inside a green one.
 *
 * `armM` is the working reach — shoulder to fingertip plus the lean a body will
 * actually give you. 0.72 m for a 1.75 m person; a manifest supplies its own
 * for anything that is not a person, which is the honest way to say that a
 * rover's arm is a different length rather than tuning the constant.
 */
export function validatePerformance(
  actor: string,
  shot: CompiledShot,
  path: readonly PathPoint[],
  beats: readonly { readonly p: number; readonly verb: string; readonly intensity?: number; readonly target?: string }[] | undefined,
  targetAt: (markId: string) => Vec3 | null,
  armM = 0.72,
): LocomotionProblem[] {
  const problems: LocomotionProblem[] = [];
  if (!beats || beats.length === 0) return problems;

  for (const beat of beats) {
    if (!(beat.verb in VERB_SHAPES)) {
      problems.push({
        severity: 'error', code: 'unknown-verb', actor, shot: shot.id, p: beat.p,
        detail: `"${beat.verb}" is not a verb this layer knows (${knownVerbs().join(', ')}) — it will play as "idle", which is a character standing still where the screenplay asked for a movement`,
      });
      continue;
    }
    const shape = VERB_SHAPES[beat.verb]!;
    const wantsTarget = shape.reach > 0.5 || shape.grip > 0.5;
    if (wantsTarget && !beat.target) {
      problems.push({
        severity: 'warning', code: 'no-target', actor, shot: shot.id, p: beat.p,
        detail: `"${beat.verb}" is a movement toward something and names nothing to move toward`,
      });
      continue;
    }
    if (!beat.target) continue;
    const target = targetAt(beat.target);
    if (!target) continue;
    const body = travelAt(path, beat.p).at;
    // Horizontal distance only. A body reaches UP as easily as out and the
    // height of a shelf is not what makes it unreachable; the floor distance
    // is. Including y here would pass a shelf at head height and fail a floor
    // at the character's own feet, which is backwards.
    const distance = Math.hypot(target[0] - body[0], target[2] - body[2]);
    if (shape.reach > 0.5 && distance > armM * 1.35) {
      problems.push({
        severity: 'error', code: 'out-of-reach', actor, shot: shot.id, p: beat.p,
        detail: `"${beat.verb}" toward "${beat.target}", which is ${distance.toFixed(2)} m away — past a ${armM.toFixed(2)} m arm even leaning. The hand will close on nothing and the audience will see it.`,
      });
    }
  }
  return problems;
}

/* ========================================================================== */
/* Small arithmetic                                                           */
/* ========================================================================== */

function smoothstep(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
function lerp3(a: Vec3, b: Vec3, f: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
