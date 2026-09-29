/**
 * ============================================================================
 *  Project — the one document a film IS, and the single gate every tool runs.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **There is one file that says what the film is, and one function that says
 *   everything wrong with it — so a capture tool, a QA tool, a storyboard and
 *   a person all read the same answer.**
 *
 * ## Why this is not five files
 *
 * One short film had the shot list in `src/film/Director.ts`, the voices in
 * `sound/eleven-cast.json`, the transcript checks in four separate
 * `eleven-scribe-qa*.json` files, the mix in a shell script, and the story in
 * nobody's head. Each of those had to be kept in agreement with the others by
 * hand, and the retrospective's list of what went wrong is mostly a list of
 * the moments they were not.
 *
 * A `FilmProject` is the manifest, the set library, the script and the story
 * blueprint in one document. `film.json` beside the package. It is plain JSON
 * so it diffs, so a model can write it, and so `checkProject` can be run by a
 * probe with nothing installed.
 *
 * ## `checkProject` is the gate, and the colours are the point
 *
 * It returns THREE lists, not a boolean:
 *
 *   · `errors`   — the film cannot be shot as written;
 *   · `warnings` — it can, and somebody should look;
 *   · `notes`    — things that were checked and are fine, or that could not be
 *                  checked at all and say which.
 *
 * That last one is a rule in a type: *"we could not measure it"* and
 * *"we measured it and it was fine"* must never render as the same colour. A
 * project with no script has not passed its dialogue checks; it has not taken
 * them, and `checkProject` says which.
 */

import type { FilmManifest } from './Timeline.ts';
import { compileFilm, FilmCompileError, validateFilm, type Film } from './Timeline.ts';
import { buildSetIndex, type SetSpec } from './Sets.ts';
import { checkContinuity, type ContinuityOptions } from './Continuity.ts';
import { scheduleScript, transcriptQA, scriptCoverage, type MixSource, type ScriptLine } from './Script.ts';
import { checkBlueprint, type Blueprint } from './Blueprint.ts';
import { resolvePath, validateLocomotion, validatePerformance, HUMAN_GAIT, type Gait } from './Acting.ts';

export interface FilmProject {
  readonly schema: 'homie.film-project/1';
  readonly manifest: FilmManifest;
  readonly sets: readonly SetSpec[];
  readonly script?: readonly ScriptLine[];
  /**
   * Everything in the mix that is not a spoken line: score, ambience, designed
   * effects. Kept beside the script rather than in a second document, because
   * the retrospective's complaint about the earlier audio path was not that any
   * one file was wrong — it was that six of them had to agree.
   */
  readonly sound?: readonly MixSource[];
  readonly blueprint?: Blueprint;
  /** Per-cast gait overrides, by cast id. A rover walks differently from a person. */
  readonly gaits?: Readonly<Record<string, Gait>>;
  /**
   * Working reach in metres, by cast id — shoulder to fingertip plus the lean a
   * body will actually give you. Defaults to 0.72, which is a 1.75 m person.
   *
   * A field rather than a constant because "the rover's arm is a different
   * length" is a fact about the film, and the alternative is somebody tuning
   * the constant until the warning goes away.
   */
  readonly armsM?: Readonly<Record<string, number>>;
  readonly continuity?: ContinuityOptions;
}

export interface ProjectFinding {
  readonly severity: 'error' | 'warning' | 'note';
  readonly pass: 'manifest' | 'sets' | 'continuity' | 'script' | 'transcript' | 'story' | 'locomotion';
  readonly code: string;
  readonly where: string;
  readonly detail: string;
}

export interface ProjectReport {
  readonly filmId: string;
  readonly film: Film | null;
  readonly findings: readonly ProjectFinding[];
  readonly errors: readonly ProjectFinding[];
  readonly warnings: readonly ProjectFinding[];
  readonly notes: readonly ProjectFinding[];
  /** What each pass actually did. `null` means it did not run, and why is a note. */
  readonly ran: Readonly<Record<ProjectFinding['pass'], boolean>>;
  readonly coverage: ReturnType<typeof scriptCoverage> | null;
}

/**
 * Everything wrong with a film, before a frame is rendered.
 *
 * Never throws for a bad film — a compile failure is a finding, because a tool
 * that dies on the first error tells a director one thing per run.
 */
export function checkProject(project: FilmProject): ProjectReport {
  const findings: ProjectFinding[] = [];
  const ran: Record<ProjectFinding['pass'], boolean> = {
    manifest: false, sets: false, continuity: false, script: false, transcript: false, story: false, locomotion: false,
  };
  const push = (severity: ProjectFinding['severity'], pass: ProjectFinding['pass'], code: string, where: string, detail: string) =>
    findings.push({ severity, pass, code, where, detail });

  /* ---- manifest ------------------------------------------------------ */
  ran.manifest = true;
  for (const problem of validateFilm(project.manifest)) {
    push(problem.severity, 'manifest', problem.code, problem.where, problem.detail);
  }

  let film: Film | null = null;
  try {
    film = compileFilm(project.manifest);
  } catch (err) {
    if (!(err instanceof FilmCompileError)) throw err;
    // The individual problems were already reported by validateFilm above, so
    // this adds only the fact that nothing downstream could run.
    push('note', 'manifest', 'not-compiled', project.manifest.id,
      'the film did not compile, so continuity, story, locomotion and script checks did NOT run — they are unmeasured, not clean');
    return finish(project, findings, null, ran, null);
  }

  /* ---- sets ---------------------------------------------------------- */
  ran.sets = true;
  const sets = buildSetIndex(project.sets);
  for (const problem of sets.problems()) push('error', 'sets', problem.code, problem.where, problem.detail);
  if (project.sets.length === 0) {
    push('warning', 'sets', 'no-sets', project.manifest.id,
      'the film declares no sets, so nothing can ask whether the cast is where the screenplay says — a film has already shipped in this state');
  }

  /* ---- continuity ---------------------------------------------------- */
  if (project.sets.length > 0) {
    ran.continuity = true;
    for (const problem of checkContinuity(film, sets, project.continuity ?? {})) {
      push(problem.severity, 'continuity', problem.code, `${problem.shot}:${problem.subject}`, problem.detail);
    }
  }

  /* ---- locomotion ---------------------------------------------------- */
  if (project.sets.length > 0) {
    ran.locomotion = true;
    for (const shot of film.shots) {
      for (const actor of shot.actors ?? []) {
        const path = resolvePath(shot, actor.blocking, sets);
        const gait = project.gaits?.[actor.id] ?? HUMAN_GAIT;
        if (actor.blocking.length >= 2) {
          for (const problem of validateLocomotion(actor.id, shot, path, film.fps, gait)) {
            push(problem.severity, 'locomotion', problem.code, `${shot.id}:${actor.id}`, problem.detail);
          }
        }
        // The arms, separately from the feet. A body standing on one mark for a
        // whole shot has no locomotion to check and can still be reaching for
        // something two metres out of its reach.
        for (const problem of validatePerformance(
          actor.id, shot, path, actor.perform,
          (markId) => sets.mark(shot.setId, markId)?.at ?? null,
          project.armsM?.[actor.id] ?? 0.72,
        )) {
          push(problem.severity, 'locomotion', problem.code, `${shot.id}:${actor.id}`, problem.detail);
        }
      }
    }
  }

  /* ---- script and transcripts ---------------------------------------- */
  let coverage: ReturnType<typeof scriptCoverage> | null = null;
  if (project.script && project.script.length > 0) {
    ran.script = true;
    const { scheduled, problems } = scheduleScript(film, project.script);
    for (const problem of problems) push(problem.severity, 'script', problem.code, problem.line, problem.detail);
    coverage = scriptCoverage(film, scheduled);

    ran.transcript = true;
    for (const qa of transcriptQA(scheduled)) {
      if (qa.verdict === 'wrong') {
        push('error', 'transcript', 'transcript-wrong', qa.id,
          `the take says "${qa.heard}" and the script says "${qa.said}" — the audience will hear one and read the other`);
      } else if (qa.verdict === 'drifted') {
        push('warning', 'transcript', 'transcript-drifted', qa.id, `${(qa.wer * 100).toFixed(0)}% of words differ from the script`);
      } else if (qa.verdict === 'unchecked') {
        push('note', 'transcript', 'transcript-unchecked', qa.id, 'no transcript: this line has NOT been checked, which is not the same as being fine');
      }
    }
  } else {
    push('note', 'script', 'no-script', project.manifest.id,
      'the project has no script, so dialogue timing, captions, transcripts and the mix were NOT checked');
  }

  /* ---- story --------------------------------------------------------- */
  if (project.blueprint) {
    ran.story = true;
    for (const problem of checkBlueprint(film, project.blueprint)) {
      push(problem.severity, 'story', problem.code, problem.where, problem.detail);
    }
  } else {
    push('note', 'story', 'no-blueprint', project.manifest.id,
      'no story blueprint, so nothing asked whether the shots form a causal trailer or whether the button was planted');
  }

  return finish(project, findings, film, ran, coverage);
}

function finish(
  project: FilmProject,
  findings: readonly ProjectFinding[],
  film: Film | null,
  ran: Record<ProjectFinding['pass'], boolean>,
  coverage: ReturnType<typeof scriptCoverage> | null,
): ProjectReport {
  return {
    filmId: project.manifest.id,
    film,
    findings,
    errors: findings.filter((f) => f.severity === 'error'),
    warnings: findings.filter((f) => f.severity === 'warning'),
    notes: findings.filter((f) => f.severity === 'note'),
    ran,
    coverage,
  };
}

/**
 * Validate an untrusted JSON blob into a project, or say what is missing.
 *
 * Deliberately shallow: the deep checking is `checkProject`, and duplicating
 * it here would give two answers to one question. This only establishes that
 * the document is the right SHAPE, so `checkProject` can assume it.
 */
export function parseFilmProject(value: unknown): FilmProject {
  const project = value as FilmProject;
  if (!project || typeof project !== 'object') throw new Error('a film project must be an object');
  if (project.schema !== 'homie.film-project/1') {
    throw new Error(`a film project must carry schema "homie.film-project/1"; got ${JSON.stringify(project.schema)}`);
  }
  if (!project.manifest || typeof project.manifest !== 'object') throw new Error('a film project needs a manifest');
  if (!Array.isArray(project.manifest.scenes)) throw new Error('a film manifest needs scenes');
  if (!Array.isArray(project.sets)) throw new Error('a film project needs a sets array — an empty one is legal and says so in the report');
  if (project.script !== undefined && !Array.isArray(project.script)) throw new Error('script must be an array of lines');
  return project;
}

/** A blank, valid, one-shot project. Somewhere to start that already compiles. */
export function emptyProject(id: string, fps = 30): FilmProject {
  return {
    schema: 'homie.film-project/1',
    manifest: {
      id, fps,
      cast: [],
      facts: {},
      scenes: [{
        id: 'opening', location: 'stage',
        shots: [{
          id: 'first', seconds: 3, purpose: 'the first thing the audience sees',
          camera: { keys: [{ p: 0, eye: [0, 1.6, -4], aim: [0, 1.2, 0], fov: 38 }] },
        }],
      }],
    },
    sets: [{
      id: 'stage', kind: 'interior',
      volume: { kind: 'box', min: [-10, -1, -10], max: [10, 6, 10] },
      marks: [{ id: 'centre', at: [0, 0, 0], kind: 'stand' }],
    }],
    // DELIBERATELY NO BLUEPRINT. A film that has not been written does not
    // fail its story checks — it has not taken them, and `checkProject` says
    // exactly that. Shipping a blueprint with no beats assigned would make a
    // blank project report ten story errors, which teaches everyone that the
    // story pass is noise. `emptyBlueprint()` in Blueprint.ts is what to add
    // when there is a story to check.
  };
}
