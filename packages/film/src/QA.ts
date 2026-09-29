/**
 * ============================================================================
 *  QA — the checks that are about a MOVIE, run against the frames that were
 *  actually rendered.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A finished film is graded against its own manifest: every shot, line and
 *   cue is in the export, nothing important is outside the safe area, a held
 *   frame is distinguishable from a stalled renderer, and the words on screen
 *   are the words in the audio.**
 *
 * ## Why a package smoke test is not this
 *
 * A smoke test that loads a package, drives its controls and captures the
 * screen is a good instrument, and it answers *"does this package run"*. The
 * retrospective is precise about the gap: *"The existing package tests are
 * useful but do not validate a movie."* A film that runs, holds a black frame
 * for nine seconds, drops its last three lines and puts its title card two
 * pixels inside the bezel passes every one of them.
 *
 * ## Everything here takes MEASUREMENTS, not files
 *
 * No decoding, no FFmpeg, no image library. The caller measures — a separate
 * tool decodes the export — and this file judges. Two reasons, and the
 * second is the important one:
 *
 *   1. it is testable in Node against synthetic measurements, including the
 *      failure cases, which is the only way to know the judgements work;
 *   2. **a harness that both measures and judges cannot fail.** If the same
 *      code decides what a frame difference is and what counts as frozen, a
 *      bug in the first is invisible to the second: the scaffolding supplies
 *      the exact thing production does not.
 */

import type { Film } from './Timeline.ts';
import type { ScheduledLine } from './Script.ts';

export interface QAProblem {
  readonly severity: 'error' | 'warning' | 'note';
  readonly code: string;
  readonly where: string;
  readonly detail: string;
  /** Authored time, when the problem has one. */
  readonly at?: number;
}

/* ========================================================================== */
/* Safe areas                                                                 */
/* ========================================================================== */

/**
 * The two rectangles every broadcast department has agreed on for fifty
 * years: 90 % for anything that matters, 80 % for anything with words in it.
 *
 * They are not superstition on a modern panel either — a television's overscan
 * is gone but a phone's notch, a player's chrome, a social platform's crop and
 * a projector's keystone all still eat the edge, and this film is delivered to
 * at least three of those.
 */
export interface SafeAreas {
  readonly action: Rect;
  readonly title: Rect;
}
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export function safeAreas(width: number, height: number): SafeAreas {
  const inset = (fraction: number): Rect => ({
    x: (width * (1 - fraction)) / 2,
    y: (height * (1 - fraction)) / 2,
    w: width * fraction,
    h: height * fraction,
  });
  return { action: inset(0.9), title: inset(0.8) };
}

export function insideRect(box: Rect, within: Rect): boolean {
  return box.x >= within.x && box.y >= within.y
    && box.x + box.w <= within.x + within.w
    && box.y + box.h <= within.y + within.h;
}

/**
 * Judge one measured element against the safe areas.
 *
 * `kind` decides which rectangle applies, and that is the whole rule: a
 * character's head may sit outside title-safe and a caption may not.
 */
export function checkSafe(
  element: { readonly id: string; readonly kind: 'title' | 'caption' | 'logo' | 'subject'; readonly box: Rect; readonly at?: number },
  areas: SafeAreas,
): QAProblem | null {
  const wordy = element.kind === 'title' || element.kind === 'caption' || element.kind === 'logo';
  const area = wordy ? areas.title : areas.action;
  if (insideRect(element.box, area)) return null;
  const base = { where: element.id, ...(element.at !== undefined ? { at: element.at } : {}) };
  return {
    severity: wordy ? 'error' : 'warning',
    code: wordy ? 'outside-title-safe' : 'outside-action-safe',
    ...base,
    detail: `${element.kind} "${element.id}" reaches outside the ${wordy ? 'title' : 'action'}-safe area — it will be cropped by at least one of the panel, the player chrome and the social crop`,
  };
}

/**
 * A subject too close to an edge, which a reviewer finds by eye and a number
 * finds every time.
 *
 * One short film's final framing review caught *"a blossom too close to
 * the top edge"* — after the render. `marginFraction` is how much of the frame
 * a subject must keep between itself and the edge it is nearest; 0.04 is about
 * what reads as deliberate at 1080p.
 */
export function checkFraming(
  subject: { readonly id: string; readonly box: Rect; readonly at?: number },
  width: number,
  height: number,
  marginFraction = 0.04,
): QAProblem[] {
  const out: QAProblem[] = [];
  const mx = width * marginFraction;
  const my = height * marginFraction;
  const at = subject.at;
  const near = (edge: string, gap: number, limit: number) => {
    if (gap >= limit) return;
    out.push({
      severity: gap < 0 ? 'error' : 'warning',
      code: gap < 0 ? 'clipped' : 'edge-crowding',
      where: subject.id,
      ...(at !== undefined ? { at } : {}),
      detail: gap < 0
        ? `runs ${Math.abs(gap).toFixed(0)}px past the ${edge} edge`
        : `sits ${gap.toFixed(0)}px from the ${edge} edge, inside the ${(marginFraction * 100).toFixed(0)}% margin — it reads as an accident rather than a composition`,
    });
  };
  near('left', subject.box.x, mx);
  near('top', subject.box.y, my);
  near('right', width - (subject.box.x + subject.box.w), mx);
  near('bottom', height - (subject.box.y + subject.box.h), my);
  return out;
}

/* ========================================================================== */
/* Freeze detection                                                           */
/* ========================================================================== */

/**
 * Tell an authored hold from a renderer that stopped.
 *
 * The measurement is a per-frame difference — any monotonic measure of "how
 * much changed", a mean absolute pixel delta being the obvious one. A run of
 * near-zero differences is a still picture. Whether that is a BUG depends
 * entirely on the manifest:
 *
 *   · a title card on black is supposed to be still;
 *   · a shot with one camera key and no actors is supposed to be still;
 *   · a shot with a camera move and four characters is not.
 *
 * Which is exactly why this takes the film. A freeze detector that does not
 * know what was authored either fails every title card or misses every stall,
 * and both of those get switched off within a week.
 */
export function detectFreezes(
  film: Film,
  differences: readonly number[],
  options: { readonly epsilon?: number; readonly minFrames?: number; readonly startFrame?: number } = {},
): QAProblem[] {
  const epsilon = options.epsilon ?? 1e-4;
  const minFrames = options.minFrames ?? Math.max(2, Math.round(film.fps * 0.4));
  const start = options.startFrame ?? 0;
  const problems: QAProblem[] = [];

  let runStart = -1;
  const closeRun = (endExclusive: number): void => {
    if (runStart < 0) return;
    const length = endExclusive - runStart;
    if (length >= minFrames) {
      const at = film.timeOfFrame(start + runStart);
      const shot = film.at(at).shot;
      const authored = isAuthoredStill(film, shot.id);
      problems.push({
        severity: authored ? 'note' : 'error',
        code: authored ? 'authored-hold' : 'frozen',
        where: shot.id,
        at,
        detail: authored
          ? `${length} identical frames, which is what this shot authors: ${shot.card ? 'a title card' : 'one camera key and nothing moving'}`
          : `${length} identical frames (${(length / film.fps).toFixed(2)}s) inside a shot that authors movement — the renderer stopped, or the authored clock did`,
      });
    }
    runStart = -1;
  };

  for (let i = 0; i < differences.length; i++) {
    const still = (differences[i] ?? 0) <= epsilon;
    if (still && runStart < 0) runStart = i;
    if (!still) closeRun(i);
  }
  closeRun(differences.length);
  return problems;
}

/** Does the manifest say this shot should be a still picture? */
export function isAuthoredStill(film: Film, shotId: string): boolean {
  const shot = film.shot(shotId);
  if (!shot) return false;
  if (shot.card && shot.card.black) return true;
  const keys = shot.camera?.keys ?? [];
  const moving = keys.length > 1 && keys.some((k) => {
    const first = keys[0]!;
    return k.eye[0] !== first.eye[0] || k.eye[1] !== first.eye[1] || k.eye[2] !== first.eye[2]
      || k.aim[0] !== first.aim[0] || k.aim[1] !== first.aim[1] || k.aim[2] !== first.aim[2]
      || k.fov !== first.fov;
  });
  if (moving) return false;
  const actorsMove = (shot.actors ?? []).some((a) => a.blocking.length > 1 || (a.perform?.length ?? 0) > 0);
  if (actorsMove) return false;
  return (shot.cues ?? []).length === 0;
}

/* ========================================================================== */
/* Coverage                                                                   */
/* ========================================================================== */

/**
 * Is everything the manifest authored actually inside the delivered range?
 *
 * The failure this catches is undramatic and expensive: a master remuxed one
 * shot short, or trimmed to a round number of seconds, silently losing the
 * button. Nobody notices until it is posted.
 */
export function checkCoverage(
  film: Film,
  lines: readonly ScheduledLine[],
  delivered: { readonly seconds: number; readonly frames: number },
): QAProblem[] {
  const problems: QAProblem[] = [];
  const tolerance = 1.5 / film.fps;

  if (Math.abs(delivered.seconds - film.duration) > tolerance) {
    problems.push({
      severity: Math.abs(delivered.seconds - film.duration) > 0.5 ? 'error' : 'warning',
      code: 'duration-mismatch',
      where: film.id,
      detail: `the film is authored at ${film.duration.toFixed(3)}s and the export measures ${delivered.seconds.toFixed(3)}s`,
    });
  }
  if (delivered.frames !== film.frames) {
    problems.push({
      severity: Math.abs(delivered.frames - film.frames) > 1 ? 'error' : 'warning',
      code: 'frame-count-mismatch',
      where: film.id,
      detail: `${film.frames} authored frames, ${delivered.frames} in the export`,
    });
  }

  for (const shot of film.shots) {
    if (shot.start >= delivered.seconds) {
      problems.push({ severity: 'error', code: 'shot-missing', where: shot.id, at: shot.start, detail: 'starts after the end of the export' });
    } else if (shot.end > delivered.seconds + tolerance) {
      // The half-present shot. Worse than a missing one in practice: a master
      // trimmed to a round number of seconds ends mid-cut, which reads as the
      // file being corrupt rather than as the film being short.
      problems.push({
        severity: 'error', code: 'shot-truncated', where: shot.id, at: shot.start,
        detail: `runs to ${shot.end.toFixed(3)}s and the export ends at ${delivered.seconds.toFixed(3)}s — the last thing the audience sees is a cut that never lands`,
      });
    }
  }
  for (const line of lines) {
    if (line.absolute >= delivered.seconds) {
      problems.push({ severity: 'error', code: 'line-missing', where: line.id, at: line.absolute, detail: `"${line.text}" is spoken after the end of the export` });
    }
  }
  for (const cue of film.cues) {
    if (cue.absolute >= delivered.seconds) {
      problems.push({ severity: 'warning', code: 'cue-missing', where: cue.id, at: cue.absolute, detail: 'fires after the end of the export' });
    }
  }
  return problems;
}

/* ========================================================================== */
/* Sync                                                                       */
/* ========================================================================== */

/**
 * Does the audio start where the script says it does?
 *
 * `onsets` are measured times of speech onsets in the delivered mix. Each
 * scheduled line is matched to the nearest onset; a line whose nearest onset
 * is further away than `toleranceSeconds` is either mistimed or missing, and
 * the two are distinguished by whether ANY onset is nearby.
 *
 * The default tolerance is 120 ms. Lip sync is perceptible at about 45 ms
 * early and 125 ms late, and generated speech has a soft attack that a
 * detector will find a little after the file starts; 120 ms is the number that
 * catches a real slip without reporting every take.
 */
export function checkSync(
  lines: readonly ScheduledLine[],
  onsets: readonly number[],
  toleranceSeconds = 0.12,
): QAProblem[] {
  const problems: QAProblem[] = [];
  for (const line of lines) {
    if (!line.asset) continue;
    let best = Infinity;
    for (const onset of onsets) best = Math.min(best, Math.abs(onset - line.absolute));
    if (best === Infinity) {
      problems.push({ severity: 'error', code: 'no-audio', where: line.id, at: line.absolute, detail: 'no speech onset anywhere in the mix' });
    } else if (best > toleranceSeconds) {
      problems.push({
        severity: 'warning', code: 'av-drift', where: line.id, at: line.absolute,
        detail: `nearest speech onset is ${(best * 1000).toFixed(0)} ms from where the script places this line`,
      });
    }
  }
  return problems;
}

/* ========================================================================== */
/* The storyboard                                                             */
/* ========================================================================== */

/**
 * Which authored times to extract for a contact sheet.
 *
 * One frame per shot is not enough for a shot with a move in it and three is
 * too many for a two-second cut, so it scales: a frame at the head, and one
 * more for every `secondsPerCard` after that. Times are pulled slightly INSIDE
 * the shot because a frame taken exactly on a cut is ambiguous about which
 * shot it belongs to — and a contact sheet whose thumbnails are off by one
 * shot is worse than no contact sheet.
 */
export function storyboardTimes(film: Film, secondsPerCard = 2.5): { readonly shot: string; readonly at: number; readonly label: string }[] {
  const out: { shot: string; at: number; label: string }[] = [];
  const inset = 0.5 / film.fps;
  for (const shot of film.shots) {
    const cards = Math.max(1, Math.round(shot.seconds / secondsPerCard));
    for (let i = 0; i < cards; i++) {
      const f = cards === 1 ? 0.35 : i / (cards - 1) * 0.9 + 0.05;
      out.push({
        shot: shot.id,
        at: Math.min(shot.end - inset, shot.start + shot.seconds * f),
        label: cards === 1 ? shot.id : `${shot.id} (${i + 1}/${cards})`,
      });
    }
  }
  return out;
}

/** A one-line verdict. */
export function qaSummary(problems: readonly QAProblem[]): string {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  const notes = problems.filter((p) => p.severity === 'note').length;
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${notes} note${notes === 1 ? '' : 's'}`;
}
