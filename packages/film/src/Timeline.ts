/**
 * ============================================================================
 *  Timeline — a film as authored DATA, compiled into something that can be
 *  asked "what is true at t?" without running anything that happened before t.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Every authored fact about a film — which shot, where the lens is, who
 *   stands on which mark, what is visible, what fires — is readable at an
 *   arbitrary time t from the manifest alone, with no dependence on which
 *   frame was rendered previously.**
 *
 * That sentence is the whole reason this package exists. The measured failure
 * it replaces (a scripted short film, 2026-08-26) was a 1,573-line
 * `Director.ts` in which shot timing, camera curves, pose weights, prop
 * visibility, effects, dialogue, captions, state restoration and a dozen
 * special-case fixes were the same imperative function. Its retrospective's
 * words: *"compile a declarative film manifest into the runtime."* A film that
 * is a function cannot be linted, storyboarded, diffed, or partially
 * re-rendered. A film that is data can be all four.
 *
 * ## Durations, never absolute times — and that is not a preference
 *
 * The Director carried `at` and `to` on all forty-five shots, plus `captionAt`
 * and `captionTo` on thirty of them. Lengthening one beat by 300 ms therefore
 * meant retyping about ninety numbers, and the file shows the cost: several
 * captions are timed to a *neighbouring* shot's window (`feature-montage-b`
 * speaks a line whose caption starts 1.05 s before the shot does) because the
 * absolute numbers drifted out of agreement with the cut and nothing could say
 * so.
 *
 * Here a shot owns `seconds`, dialogue and cues are timed **shot-local**, and
 * every absolute time is DERIVED by {@link compileFilm}. Inserting a beat is
 * one number. A caption cannot silently belong to the wrong shot, because it
 * is not addressed by a number that could name another shot's window.
 *
 * ## What is NOT here
 *
 * No renderer, no `three`, no DOM, no clock. This file is arithmetic over
 * plain JSON and it runs identically in Node, in a test, in Vite and in the
 * browser. `Stage.ts` is what drives a real scene from it; `Continuity.ts`
 * is what judges it; `Handle.ts` is what a capture tool talks to. Keeping the
 * manifest inert is what lets a linter read a film that has never been built,
 * and what lets a storyboard exist before a single frame is rendered.
 *
 * There is deliberately no notion of "the current shot" held in a variable.
 * {@link Film.at} is a pure function of t. State is the thing that made the
 * previous production un-seekable and it does not get to come back in here.
 */

/* ========================================================================== */
/* The authored manifest                                                      */
/* ========================================================================== */

/** A point or a direction in world space. Three numbers, JSON-safe. */
export type Vec3 = readonly [number, number, number];

/**
 * One authored camera key inside a shot.
 *
 * `p` is the NORMALISED position of this key within its shot, 0 at the cut in
 * and 1 at the cut out — not a second count. That is what makes a shot's
 * length editable without touching its camera move, and it is why `p` rather
 * than `t`: `@homie-rocks/camera/keyframe.js` `sampleKeys` reads exactly this shape,
 * so the spline through unevenly spaced keys is the studio's, not a second
 * implementation of it living in a film package.
 */
export interface CameraKey {
  /** 0…1 within the shot. Keys must be sorted and must start at 0. */
  readonly p: number;
  /** Lens position, world space. */
  readonly eye: Vec3;
  /** What the lens points at, world space. */
  readonly aim: Vec3;
  /** Vertical field of view in degrees. */
  readonly fov: number;
  /** Roll about the view axis in degrees. Optional; 0 when absent. */
  readonly roll?: number;
}

/**
 * An actor's position within a shot, expressed as a MARK — a named place in a
 * set — rather than a world coordinate.
 *
 * This is the fix for the retrospective's "most important miss". The earlier
 * production placed characters with literal world vectors; nothing could then
 * ask whether they were inside the dome that the screenplay said they were
 * inside, and they were not. A mark belongs to a set (`Sets.ts`), a set knows
 * its interior volume, and `Continuity.ts` can therefore fail a shot whose
 * `location` is `dome.interior` and whose cast is standing on a mark outside
 * it. "Inside the dome" becomes a modelled production fact.
 *
 * A `Blocking` may still carry a raw `at` for a thing genuinely not in a set —
 * a ship on approach, a rover mid-crater — but the linter reports every one of
 * them, because the count of unmarked placements is the honest measure of how
 * much of a film is un-checkable.
 */
export interface Blocking {
  /** 0…1 within the shot, like {@link CameraKey.p}. */
  readonly p: number;
  /** A mark id declared by the shot's set, e.g. `bed-north`. */
  readonly mark?: string;
  /** A raw world position, for something no set contains. Reported by the linter. */
  readonly at?: Vec3;
  /** A mark id, an actor id or a raw point this actor faces. */
  readonly facing?: string | Vec3;
}

/** A named performance beat: what an actor is DOING, not where it is. */
export interface PerformBeat {
  readonly p: number;
  /** A verb from `Acting.ts` — `walk`, `turn`, `reach`, `grab`, `brace`, `react`, `settle`, `idle`. */
  readonly verb: string;
  /** 0…1. How hard. Drives amplitude, not timing. */
  readonly intensity?: number;
  /** Optional target mark/actor for verbs that take one. */
  readonly target?: string;
}

/** An actor's whole contribution to one shot. */
export interface ActorInShot {
  /** Cast id, e.g. `mina`. Must appear in {@link FilmManifest.cast}. */
  readonly id: string;
  readonly blocking: readonly Blocking[];
  readonly perform?: readonly PerformBeat[];
}

/**
 * A prop's state within a shot.
 *
 * `visible` is a schedule rather than a boolean because the earlier
 * production's hardest bug lived here: prewarming a later shot left future plants drawing
 * in an earlier one, and `visible = false` on the parent group did not stop
 * the batched children. A schedule is what lets `Visibility.ts` reconstruct
 * the correct answer at t from the manifest instead of from whatever the last
 * frame happened to leave behind.
 */
export interface PropInShot {
  readonly id: string;
  /** Schedule of visibility flips within the shot; `[{p:0,visible:true}]` is the common case. */
  readonly visible?: readonly { readonly p: number; readonly visible: boolean }[];
  /** A mark this prop occupies, for continuity. */
  readonly mark?: string;
  /** Free-form continuity state compared across adjacent shots — `open`, `cracked`, `carried`. */
  readonly state?: string;
}

/** Something that fires once at a moment: a sound, an effect, a light change, a haptic. */
export interface Cue {
  /** Shot-local seconds from the cut in. */
  readonly at: number;
  readonly kind: 'sfx' | 'music' | 'fx' | 'light' | 'haptic' | 'mark';
  readonly id: string;
  /** Opaque to this file. The stage's cue sink interprets it. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** How a shot arrives. `cut` is the default and costs nothing. */
export interface Transition {
  readonly kind: 'cut' | 'dissolve' | 'fade-in' | 'fade-out' | 'whip';
  /** Seconds. Ignored for `cut`. */
  readonly seconds?: number;
}

/** A full-frame title card. Kept declarative so the linter can check its safe area. */
export interface TitleCard {
  readonly kicker?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly logo?: boolean;
  /** Black out the world behind it. */
  readonly black?: boolean;
}

/** One authored shot. */
export interface ShotSpec {
  readonly id: string;
  /** Duration. Absolute in/out are derived — see the header. */
  readonly seconds: number;
  /**
   * Why this shot exists, in one clause, and what it changes.
   *
   * `Blueprint.ts` requires this on every shot of a trailer and fails the film
   * when a shot cannot say what it advances. The retrospective's own
   * finding: *"the first cut accumulated spectacle before it had a causal
   * spine"*, found by a reviewer, after the render.
   */
  readonly purpose?: string;
  /** Story facts this shot needs to already be true, by id. */
  readonly needs?: readonly string[];
  /** Story facts this shot establishes, by id. */
  readonly establishes?: readonly string[];

  readonly camera?: { readonly keys: readonly CameraKey[]; readonly ease?: { readonly head: number; readonly tail: number } };
  readonly actors?: readonly ActorInShot[];
  readonly props?: readonly PropInShot[];
  readonly cues?: readonly Cue[];
  readonly transition?: Transition;
  readonly card?: TitleCard;
  /**
   * Overrides the scene's set for this shot alone. A shot that cuts outside
   * mid-scene says so here rather than by having its cast quietly leave.
   */
  readonly location?: string;
  /** Free-form focus hint the stage may use to pick a subject. Never load-bearing. */
  readonly focus?: string;
}

/** A run of shots sharing a place and a time of day. */
export interface SceneSpec {
  readonly id: string;
  /** A set id from `Sets.ts`, e.g. `dome.interior`. */
  readonly location: string;
  /** Compared across adjacent shots by the continuity pass. */
  readonly timeOfDay?: string;
  readonly shots: readonly ShotSpec[];
}

/** A performer. Voice binding lives on the script line, not here. */
export interface CastSpec {
  readonly id: string;
  readonly name: string;
  /** Height in metres. Used by the locomotion validator to judge stride. */
  readonly heightM?: number;
}

/** The whole film, as authored. JSON-serialisable end to end. */
export interface FilmManifest {
  readonly id: string;
  /** Frames per second the film is authored at. Every derived frame time uses it. */
  readonly fps: number;
  readonly scenes: readonly SceneSpec[];
  readonly cast?: readonly CastSpec[];
  /**
   * Story facts, by id, that shots may `need` and `establish`.
   * `Blueprint.ts` walks this; nothing here interprets them.
   */
  readonly facts?: Readonly<Record<string, string>>;
}

/* ========================================================================== */
/* The compiled film                                                          */
/* ========================================================================== */

/** A shot with its derived absolute window and its inherited scene facts. */
export interface CompiledShot extends ShotSpec {
  /** Position in the film, 0-based. */
  readonly index: number;
  readonly scene: string;
  /** The set this shot is in: the shot's own `location`, else the scene's. */
  readonly setId: string;
  readonly timeOfDay: string | undefined;
  /** Absolute seconds from the head of the film. */
  readonly start: number;
  /** Absolute seconds. Exclusive: `end` belongs to the next shot. */
  readonly end: number;
}

/** Where a time falls. */
export interface Placement {
  readonly shot: CompiledShot;
  /** Seconds since this shot's cut in. */
  readonly local: number;
  /** 0…1 through the shot. `end` maps to 1 only for the final shot. */
  readonly p: number;
}

/** A cue with its absolute time, for a capture tool or a mix. */
export interface ScheduledCue extends Cue {
  readonly shot: string;
  readonly absolute: number;
}

export interface Film {
  readonly id: string;
  readonly fps: number;
  readonly duration: number;
  readonly frames: number;
  readonly shots: readonly CompiledShot[];
  readonly manifest: FilmManifest;
  /** Every cue in the film, absolute, in time order. */
  readonly cues: readonly ScheduledCue[];
  /** Which shot covers t. Pure; no memory of the last call. */
  at(t: number): Placement;
  /** A shot by id, or undefined. */
  shot(id: string): CompiledShot | undefined;
  /** Authored time of frame `i`, exactly. */
  timeOfFrame(i: number): number;
  /** The half-open frame range `[from, to)` covering a shot. */
  framesOf(shotId: string): { readonly from: number; readonly to: number };
}

/* ========================================================================== */
/* Validation                                                                 */
/* ========================================================================== */

export interface FilmProblem {
  readonly severity: 'error' | 'warning';
  /** A stable machine code, so a probe can assert on the FAULT and not on prose. */
  readonly code: string;
  readonly where: string;
  readonly detail: string;
}

/**
 * Everything wrong with a manifest that can be known without a scene.
 *
 * Returns problems rather than throwing, because a director wants the whole
 * list at once — a compiler that stops at the first error turns one pass into
 * nine. `compileFilm` throws only on the errors that make compilation
 * meaningless (no shots, non-finite durations); everything else is reported.
 */
export function validateFilm(manifest: FilmManifest): FilmProblem[] {
  const problems: FilmProblem[] = [];
  const push = (severity: 'error' | 'warning', code: string, where: string, detail: string) =>
    problems.push({ severity, code, where, detail });

  if (!Number.isFinite(manifest.fps) || manifest.fps <= 0) {
    push('error', 'fps', manifest.id, `fps must be a positive number, got ${String(manifest.fps)}`);
  }
  if (manifest.scenes.length === 0) push('error', 'empty', manifest.id, 'a film with no scenes');

  const castIds = new Set((manifest.cast ?? []).map((c) => c.id));
  const shotIds = new Set<string>();
  const sceneIds = new Set<string>();

  for (const scene of manifest.scenes) {
    if (sceneIds.has(scene.id)) push('error', 'duplicate-scene', scene.id, 'two scenes share an id');
    sceneIds.add(scene.id);
    if (!scene.location) push('error', 'no-location', scene.id, 'a scene must name the set it plays in');
    if (scene.shots.length === 0) push('warning', 'empty-scene', scene.id, 'a scene with no shots');

    for (const shot of scene.shots) {
      const where = `${scene.id}/${shot.id}`;
      if (shotIds.has(shot.id)) push('error', 'duplicate-shot', where, 'two shots share an id');
      shotIds.add(shot.id);

      if (!Number.isFinite(shot.seconds) || shot.seconds <= 0) {
        push('error', 'shot-length', where, `seconds must be positive, got ${String(shot.seconds)}`);
      }

      if (shot.camera) validateKeys(shot.camera.keys, where, push);
      else if (!shot.card) push('warning', 'no-camera', where, 'a shot with no camera and no title card shows whatever the last shot left');

      if (shot.camera?.ease) {
        const { head, tail } = shot.camera.ease;
        if (head < 0 || tail < 0 || head + tail > 1) {
          push('error', 'ease', where, `ease head+tail must be within 0…1, got ${head}+${tail}`);
        }
      }

      for (const actor of shot.actors ?? []) {
        if (castIds.size > 0 && !castIds.has(actor.id)) {
          push('error', 'unknown-actor', where, `${actor.id} is not in the cast`);
        }
        if (actor.blocking.length === 0) {
          push('error', 'no-blocking', `${where}:${actor.id}`, 'an actor in a shot with no blocking');
        }
        validateP(actor.blocking, `${where}:${actor.id}`, 'blocking', push);
        for (const b of actor.blocking) {
          if (!b.mark && !b.at) {
            push('error', 'unplaced', `${where}:${actor.id}`, 'blocking with neither a mark nor a position');
          }
          if (b.mark && b.at) {
            push('error', 'double-placed', `${where}:${actor.id}`, `blocking names mark "${b.mark}" AND a raw position; one of them is a lie`);
          }
          if (b.at && !b.mark) {
            push('warning', 'unmarked', `${where}:${actor.id}`, 'placed by raw world position, so no set can contain it and continuity cannot check it');
          }
        }
        if (actor.perform) validateP(actor.perform, `${where}:${actor.id}`, 'perform', push);
      }

      const propIds = new Set<string>();
      for (const prop of shot.props ?? []) {
        if (propIds.has(prop.id)) push('error', 'duplicate-prop', where, `${prop.id} appears twice in one shot`);
        propIds.add(prop.id);
        if (prop.visible) validateP(prop.visible, `${where}:${prop.id}`, 'visible', push);
      }

      for (const cue of shot.cues ?? []) {
        if (cue.at < 0 || cue.at > shot.seconds) {
          push('error', 'cue-outside', `${where}:${cue.id}`,
            `fires at ${cue.at}s in a ${shot.seconds}s shot — a cue timed outside its own shot is how a caption ends up belonging to a neighbour`);
        }
      }

      if (shot.transition && shot.transition.kind !== 'cut') {
        const seconds = shot.transition.seconds ?? 0;
        if (seconds <= 0) push('error', 'transition-length', where, `a ${shot.transition.kind} needs a positive length`);
        else if (seconds > shot.seconds) {
          push('error', 'transition-longer-than-shot', where,
            `a ${seconds}s ${shot.transition.kind} into a ${shot.seconds}s shot never finishes`);
        }
      }
    }
  }

  for (const scene of manifest.scenes) {
    for (const shot of scene.shots) {
      for (const need of shot.needs ?? []) {
        if (manifest.facts && !(need in manifest.facts)) {
          push('error', 'unknown-fact', `${scene.id}/${shot.id}`, `needs "${need}", which no fact declares`);
        }
      }
      for (const fact of shot.establishes ?? []) {
        if (manifest.facts && !(fact in manifest.facts)) {
          push('error', 'unknown-fact', `${scene.id}/${shot.id}`, `establishes "${fact}", which no fact declares`);
        }
      }
    }
  }

  return problems;
}

/** Camera keys: sorted, in range, and starting at the cut in. */
function validateKeys(
  keys: readonly CameraKey[],
  where: string,
  push: (s: 'error' | 'warning', c: string, w: string, d: string) => void,
): void {
  if (keys.length === 0) { push('error', 'no-keys', where, 'a camera with no keys'); return; }
  const first = keys[0]!;
  if (first.p !== 0) push('error', 'key-start', where, `the first camera key is at p=${first.p}; a shot's lens must be defined at its cut in`);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k.p < 0 || k.p > 1) push('error', 'key-range', where, `camera key p=${k.p} is outside 0…1`);
    if (!Number.isFinite(k.fov) || k.fov <= 0 || k.fov >= 180) push('error', 'key-fov', where, `fov ${k.fov} is not a lens`);
    if (i > 0 && k.p <= keys[i - 1]!.p) push('error', 'key-order', where, `camera keys are out of order at p=${k.p}`);
  }
}

/** Any schedule of `{p}`: sorted, in range. */
function validateP(
  items: readonly { readonly p: number }[],
  where: string,
  what: string,
  push: (s: 'error' | 'warning', c: string, w: string, d: string) => void,
): void {
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!.p;
    if (p < 0 || p > 1) push('error', `${what}-range`, where, `${what} p=${p} is outside 0…1`);
    if (i > 0 && p < items[i - 1]!.p) push('error', `${what}-order`, where, `${what} is out of order at p=${p}`);
  }
}

/* ========================================================================== */
/* Compilation                                                                */
/* ========================================================================== */

export class FilmCompileError extends Error {
  readonly problems: readonly FilmProblem[];
  constructor(problems: readonly FilmProblem[]) {
    super(`the film manifest has ${problems.length} error${problems.length === 1 ? '' : 's'}: ` +
      problems.map((p) => `${p.where}: ${p.code} — ${p.detail}`).join('; '));
    this.name = 'FilmCompileError';
    this.problems = problems;
  }
}

/**
 * Derive every absolute time and hand back something that can be asked about t.
 *
 * Throws {@link FilmCompileError} carrying the WHOLE error list. A director who
 * has to fix nine things wants nine lines, and a probe that has to prove the
 * compiler refuses a bad film wants a code it can name.
 */
export function compileFilm(manifest: FilmManifest): Film {
  const problems = validateFilm(manifest);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length > 0) throw new FilmCompileError(errors);

  const shots: CompiledShot[] = [];
  const cues: ScheduledCue[] = [];
  let clock = 0;
  let index = 0;

  for (const scene of manifest.scenes) {
    for (const spec of scene.shots) {
      const start = clock;
      const end = clock + spec.seconds;
      const compiled: CompiledShot = {
        ...spec,
        index,
        scene: scene.id,
        setId: spec.location ?? scene.location,
        timeOfDay: scene.timeOfDay,
        start,
        end,
      };
      shots.push(compiled);
      for (const cue of spec.cues ?? []) {
        cues.push({ ...cue, shot: spec.id, absolute: start + cue.at });
      }
      clock = end;
      index++;
    }
  }

  cues.sort((a, b) => a.absolute - b.absolute || a.id.localeCompare(b.id));

  const duration = clock;
  const fps = manifest.fps;
  // A film of exactly N seconds at 30 fps is 30N frames, and frame 30N would
  // be the first frame of the film that comes after. Rounding rather than
  // ceiling: floating-point duration sums land a few ulps either side of the
  // whole number and `ceil` would silently add a frame to half of them.
  const frames = Math.max(1, Math.round(duration * fps));

  const byId = new Map<string, CompiledShot>(shots.map((s) => [s.id, s]));

  const at = (t: number): Placement => {
    // Clamp rather than throw. A capture tool asking for one frame past the
    // end is asking a legitimate question — "hold the last frame" — and a
    // throw there turns a rounding difference into a failed render.
    const clamped = Math.max(0, Math.min(duration, t));
    // Binary search. Linear scan is fine at forty shots and wrong at four
    // hundred, and a film runtime is asked this once per frame per subsystem.
    let lo = 0;
    let hi = shots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (shots[mid]!.start <= clamped) lo = mid; else hi = mid - 1;
    }
    const shot = shots[lo]!;
    const local = clamped - shot.start;
    return { shot, local, p: shot.seconds > 0 ? Math.min(1, local / shot.seconds) : 0 };
  };

  return {
    id: manifest.id,
    fps,
    duration,
    frames,
    shots,
    manifest,
    cues,
    at,
    shot: (id) => byId.get(id),
    timeOfFrame: (i) => i / fps,
    framesOf: (shotId) => {
      const shot = byId.get(shotId);
      if (!shot) throw new Error(`no shot "${shotId}" in film "${manifest.id}"`);
      // Half-open, and derived by ROUNDING both edges to the frame grid so
      // that consecutive shots' ranges abut exactly. Truncating the head and
      // ceiling the tail double-renders the frame on every cut, which is how a
      // patched shot range comes back one frame longer than it went out.
      return { from: Math.round(shot.start * fps), to: Math.round(shot.end * fps) };
    },
  };
}
