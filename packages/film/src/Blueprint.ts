/**
 * ============================================================================
 *  Blueprint — the gate that asks a trailer what it is about before anybody
 *  spends twenty minutes rendering it.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Every shot can say what it advances, and the last joke was planted.**
 *
 * ## The two findings this is built from
 *
 * An independent story review of one short film found, after the film
 * existed: *"a sequence of individually cool shots did not yet form a causal
 * trailer narrative"*, and separately that *"the closing 'Four' joke had not
 * been planted or motivated"*.
 *
 * Both are real, both were caught late, and both are **structural facts about
 * the manifest**, not judgements about taste. A shot that establishes nothing
 * and needs nothing is disconnected from the story whatever is in frame. A
 * button whose setup does not exist earlier in the film is not a callback; it
 * is a non sequitur that the audience hears as a flat ending.
 *
 * So this is not an attempt to automate writing. It is the guardrail the
 * retrospective asks for, in its own words: *"a guardrail against spending
 * render time on shots that do not advance or explain the movie."* A film can
 * fail every check here and still be wonderful, and a director who means it
 * says so by declaring the beat — the point is that the decision is made and
 * visible, not that a rule wins.
 *
 * ## The causal chain is the whole mechanism
 *
 * `ShotSpec.needs` and `ShotSpec.establishes` name facts from
 * `FilmManifest.facts`. A film is causally connected when every fact a shot
 * needs was established by an EARLIER shot. That single rule catches:
 *
 *   · the unplanted button — the last shot needs a fact nothing established;
 *   · the orphan spectacle — a shot that neither needs nor establishes;
 *   · the dangling setup — a fact established and never paid off;
 *   · and the out-of-order reveal, where the payoff precedes its own setup.
 *
 * None of them requires understanding the story. All of them are the kind of
 * thing a person misses at two in the morning on the fortieth shot.
 */

import type { Film } from './Timeline.ts';

/** The beats a form is expected to hit. Not a rule; a checklist with names. */
export interface BeatSpec {
  readonly id: string;
  /** What this beat does, for the person reading the report. */
  readonly what: string;
  /** A beat a particular film may legitimately not have. */
  readonly optional?: boolean;
}

export interface Blueprint {
  readonly form: string;
  readonly beats: readonly BeatSpec[];
  /** Which shot carries each beat, by beat id. */
  readonly carries: Readonly<Record<string, string>>;
}

/**
 * The feature-trailer beats, as the retrospective lists them.
 *
 * Kept as data rather than baked into the checker so a teaser, a title
 * sequence or a thirty-second spot can declare its own shape. A form is a
 * choice; the checking is the product.
 */
export const FEATURE_TRAILER_BEATS: readonly BeatSpec[] = [
  { id: 'protagonist', what: 'whose film this is' },
  { id: 'desire', what: 'what they want' },
  { id: 'flaw', what: 'what is wrong with how they want it', optional: true },
  { id: 'world-promise', what: 'the place, and why it is worth two hours' },
  { id: 'inciting-incident', what: 'the thing that starts it' },
  { id: 'stakes', what: 'what is lost if they fail' },
  { id: 'midpoint-complication', what: 'the turn that makes the first plan wrong' },
  { id: 'choice', what: 'the decision only this character would make' },
  { id: 'feature-scale', what: 'the promise that there is a whole film of this' },
  { id: 'climax-promise', what: 'the image the audience buys a ticket for' },
  { id: 'button', what: 'the last laugh, or the last breath' },
];

export interface BlueprintProblem {
  readonly severity: 'error' | 'warning' | 'note';
  readonly code: string;
  readonly where: string;
  readonly detail: string;
}

/**
 * Judge a film against a blueprint and its own causal declarations.
 *
 * Returns everything at once. A director fixing a story wants the shape of
 * the whole problem, not the first sentence of it.
 */
export function checkBlueprint(film: Film, blueprint: Blueprint): BlueprintProblem[] {
  const problems: BlueprintProblem[] = [];
  const push = (severity: BlueprintProblem['severity'], code: string, where: string, detail: string) =>
    problems.push({ severity, code, where, detail });

  const indexOf = new Map(film.shots.map((s, i) => [s.id, i] as const));

  /* ---- the beats ----------------------------------------------------- */

  let previousIndex = -1;
  for (const beat of blueprint.beats) {
    const shotId = blueprint.carries[beat.id];
    if (!shotId) {
      push(beat.optional ? 'note' : 'error', 'beat-missing', beat.id,
        `no shot carries "${beat.id}" — ${beat.what}`);
      continue;
    }
    const index = indexOf.get(shotId);
    if (index === undefined) {
      push('error', 'beat-nowhere', beat.id, `carried by shot "${shotId}", which is not in the film`);
      continue;
    }
    if (index < previousIndex) {
      push('warning', 'beat-out-of-order', beat.id,
        `lands at shot ${index} ("${shotId}"), before the previous beat at shot ${previousIndex}. Deliberate is fine; accidental is a trailer that explains itself backwards.`);
    }
    previousIndex = Math.max(previousIndex, index);
  }

  const claimed = new Set(Object.values(blueprint.carries));

  /* ---- every shot says what it is for -------------------------------- */

  for (const shot of film.shots) {
    const hasCausality = (shot.needs?.length ?? 0) > 0 || (shot.establishes?.length ?? 0) > 0;
    if (!shot.purpose) {
      push('error', 'no-purpose', shot.id,
        'does not say what it is for. A shot with no stated purpose is a shot nobody can argue against, which is how a trailer becomes a highlight reel.');
    }
    if (!hasCausality && !claimed.has(shot.id) && !shot.card) {
      push('warning', 'orphan-shot', shot.id,
        'needs nothing, establishes nothing and carries no beat — it is spectacle between two things that are about something');
    }
  }

  /* ---- the causal chain ---------------------------------------------- */

  const establishedBy = new Map<string, string>();
  const neededBy = new Map<string, string[]>();

  for (const shot of film.shots) {
    for (const need of shot.needs ?? []) {
      const setup = establishedBy.get(need);
      if (!setup) {
        // Where the fact IS established, if anywhere, so the report can say
        // "too late" rather than the much less useful "missing".
        const later = film.shots.find((s) => (s.establishes ?? []).includes(need));
        push('error', later ? 'payoff-before-setup' : 'unplanted',
          shot.id,
          later
            ? `needs "${need}", which is not established until "${later.id}" — the payoff arrives before its own setup`
            : `needs "${need}", which nothing in the film establishes. This is the "Four" joke: a button the audience has no way to be in on.`);
      }
      const list = neededBy.get(need) ?? [];
      list.push(shot.id);
      neededBy.set(need, list);
    }
    for (const fact of shot.establishes ?? []) {
      if (!establishedBy.has(fact)) establishedBy.set(fact, shot.id);
    }
  }

  for (const [fact, shotId] of establishedBy) {
    if (!neededBy.has(fact)) {
      push('warning', 'dangling-setup', shotId,
        `establishes "${fact}", which no later shot needs. Either it pays off somewhere unstated, or the audience is being asked to remember something for nothing.`);
    }
  }

  /* ---- the button ---------------------------------------------------- */

  const buttonShotId = blueprint.carries['button'];
  if (buttonShotId) {
    const button = film.shot(buttonShotId);
    if (button && (button.needs?.length ?? 0) === 0) {
      push('error', 'unplanted-button', buttonShotId,
        'the closing beat needs nothing, so nothing set it up. A button that is not a callback is a line, and a line at the end of a trailer is where the laugh should be.');
    }
  }

  return problems;
}

/**
 * A blank blueprint for a film, with the beats it has not assigned yet.
 *
 * Written for the case that actually happens: somebody has a shot list and
 * needs to be asked, once, which shot does what. The answer is a file they
 * edit, and the diff on that file is the story conversation.
 */
export function emptyBlueprint(form = 'feature-trailer', beats = FEATURE_TRAILER_BEATS): Blueprint {
  return { form, beats, carries: {} };
}

/** A one-line verdict a shell prints and a probe asserts on. */
export function blueprintSummary(problems: readonly BlueprintProblem[]): string {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
}
