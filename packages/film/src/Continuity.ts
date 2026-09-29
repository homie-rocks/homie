/**
 * ============================================================================
 *  Continuity — the pass that would have caught the thing a viewer caught.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A film whose screenplay says a scene plays inside the dome cannot be
 *   rendered with its cast standing beside the dome.**
 *
 * Everything else in here is the same idea applied to the other facts that
 * survive a cut: which way a person is facing, which side of the line the lens
 * is on, whether a prop that was open is suddenly closed, and whether a body
 * that was in one room is in another with no door between them.
 *
 * ## Why this is arithmetic and not a visual review
 *
 * The short film this package came from had two independent visual reviews
 * and they were good — they found a story with no causal spine and a plant
 * that read as glowing hardware. Neither could have found this, and no visual
 * review could: a frame of two characters beside a dome and a frame of two
 * characters inside a dome are both frames of two characters and a dome. The
 * information that distinguishes them is in the SCREENPLAY, and it was never
 * written down in a form anything could compare against. `Sets.ts` writes it
 * down; this file compares.
 *
 * When two sides of a seam are written apart, assert across it with the far
 * side's real code. The two sides here are the sentence and the vector.
 *
 * ## Severities, and why `unmarked` is a warning and not an error
 *
 * A film is allowed to place a starship on approach at a raw world coordinate;
 * no set contains the sky. What is not allowed is for that to be invisible. So
 * every raw placement is REPORTED, and the count of them is the honest measure
 * of how much of a film this pass cannot see. A pass that silently skipped
 * them would report zero problems on a film it had checked nothing about:
 * "we could not measure it" rendering as green.
 */

import type { CompiledShot, Film, Vec3 } from './Timeline.ts';
import type { Mark, SetIndex } from './Sets.ts';

export interface ContinuityProblem {
  readonly severity: 'error' | 'warning' | 'note';
  /** Stable machine code. A probe asserts on this, never on the prose. */
  readonly code: string;
  readonly shot: string;
  readonly subject: string;
  readonly detail: string;
}

export interface ContinuityOptions {
  /**
   * Metres of tolerance when testing containment.
   *
   * A body's root is at its feet and a set's floor is a surface somebody
   * modelled; 0.35 m is about a boot and a threshold. It is a parameter
   * because a set-dressing pass wants zero and a blocking pass does not.
   */
  readonly slackM?: number;
  /**
   * Fastest a character may travel between adjacent shots, m/s.
   *
   * Default 3.5 — a brisk walk. A film with a rover in it raises it or
   * exempts the vehicle by declaring it a prop, which is the correct
   * modelling: a person who covers eighty metres during a two-second cut
   * either rode something or teleported, and the film should say which.
   */
  readonly maxTravelMs?: number;
  /** Cast ids exempt from the travel check — anything that is carried or driven. */
  readonly vehicles?: readonly string[];
}

/**
 * Every continuity fact a film can be judged on without rendering it.
 *
 * Ordered by shot, then by severity, so the first line of the report is the
 * earliest thing that is wrong — which is the one a director wants, because
 * fixing it often deletes the rest.
 */
export function checkContinuity(film: Film, sets: SetIndex, options: ContinuityOptions = {}): ContinuityProblem[] {
  const slack = options.slackM ?? 0.35;
  const maxTravel = options.maxTravelMs ?? 3.5;
  const vehicles = new Set(options.vehicles ?? []);
  const problems: ContinuityProblem[] = [];
  const push = (severity: ContinuityProblem['severity'], code: string, shot: string, subject: string, detail: string) =>
    problems.push({ severity, code, shot, subject, detail });

  for (const problem of sets.problems()) {
    push('error', problem.code, '(sets)', problem.where, problem.detail);
  }

  /** Where an actor or prop is, at a normalised position in a shot. */
  const placeOf = (shot: CompiledShot, subject: string, b: { readonly mark?: string; readonly at?: Vec3 }): Vec3 | null => {
    if (b.at) return b.at;
    if (!b.mark) return null;
    const mark = sets.mark(shot.setId, b.mark);
    if (!mark) {
      push('error', 'unknown-mark', shot.id, subject,
        `stands on mark "${b.mark}", which set "${shot.setId}" does not declare — a blocking mark that does not exist places nobody`);
      return null;
    }
    return mark.at;
  };

  for (const shot of film.shots) {
    const set = sets.get(shot.setId);
    if (!set) {
      push('error', 'unknown-set', shot.id, shot.setId, `plays in set "${shot.setId}", which the set library does not declare`);
      continue;
    }

    /* ---- the containment check. This is the one. ---------------------- */

    const occupied = new Map<string, string>();
    for (const actor of shot.actors ?? []) {
      for (const b of actor.blocking) {
        const at = placeOf(shot, actor.id, b);
        if (!at) continue;
        if (b.at) {
          push('warning', 'unmarked-placement', shot.id, actor.id,
            'placed by raw world position — no set contains it, so this shot is not covered by the containment check');
        }
        if (!sets.contains(shot.setId, at, slack)) {
          const actually = sets.where(at, slack);
          push('error', 'outside-set', shot.id, actor.id,
            `the screenplay puts this shot in "${shot.setId}"; ${actor.id} stands at [${at.map((n) => n.toFixed(2)).join(', ')}], which is ` +
            (actually.length > 0 ? `in "${actually[0]!.id}"` : 'in no declared set') +
            '. Before the dome breaks, the people have to be inside it.');
        }
        if (b.mark) {
          const already = occupied.get(b.mark);
          if (already && already !== actor.id) {
            push('error', 'mark-collision', shot.id, `${already} + ${actor.id}`,
              `both stand on mark "${b.mark}" — two bodies in one place read as one body with two heads at thumbnail size`);
          }
          occupied.set(b.mark, actor.id);
        }
      }
    }

    for (const prop of shot.props ?? []) {
      if (!prop.mark) continue;
      const at = placeOf(shot, prop.id, { mark: prop.mark });
      if (at && !sets.contains(shot.setId, at, slack)) {
        push('error', 'outside-set', shot.id, prop.id,
          `prop is on mark "${prop.mark}", which is not inside "${shot.setId}" — the garden has to be in the dome too`);
      }
    }

    /* ---- the lens is a body as well ----------------------------------- */

    const eye = shot.camera?.keys[0]?.eye;
    if (eye && set.kind === 'interior' && !sets.contains(shot.setId, eye, slack)) {
      // A lens outside an interior is not automatically wrong — a shot
      // through a window is a real shot — but it is a decision, and an
      // interior scene shot entirely from outside is usually the staging bug
      // wearing a hat.
      push('warning', 'lens-outside-interior', shot.id, 'camera',
        `an interior shot with the lens outside "${shot.setId}". If this is a shot through glass, declare a portal; if it is not, the whole scene may be staged outside.`);
    }
  }

  /* ---- what survives a cut ------------------------------------------- */

  for (let i = 1; i < film.shots.length; i++) {
    const previous = film.shots[i - 1]!;
    const shot = film.shots[i]!;
    const sameScene = previous.scene === shot.scene;

    if (!sameScene && previous.setId === shot.setId && previous.timeOfDay !== shot.timeOfDay) {
      push('warning', 'time-of-day-jump', shot.id, shot.setId,
        `the same set is "${String(previous.timeOfDay)}" in scene ${previous.scene} and "${String(shot.timeOfDay)}" here`);
    }

    if (sameScene && previous.setId !== shot.setId) {
      const portal = sets.portal(previous.setId, shot.setId);
      const nested = sets.chain(shot.setId).some((s) => s.id === previous.setId)
        || sets.chain(previous.setId).some((s) => s.id === shot.setId);
      if (!portal && !nested) {
        push('error', 'no-way-through', shot.id, `${previous.setId} → ${shot.setId}`,
          'one scene moves between two sets with no portal between them and no containment relationship');
      } else if (portal && portal.passable === false) {
        push('error', 'portal-shut', shot.id, portal.id, `the only way between these sets is declared shut`);
      }
    }

    /* travel: a body cannot cover more ground than the cut allows */
    for (const actor of shot.actors ?? []) {
      if (vehicles.has(actor.id)) continue;
      const before = previous.actors?.find((a) => a.id === actor.id);
      if (!before) continue;
      const lastBefore = before.blocking[before.blocking.length - 1];
      const firstNow = actor.blocking[0];
      if (!lastBefore || !firstNow) continue;
      const a = resolve(sets, previous, lastBefore);
      const b = resolve(sets, shot, firstNow);
      if (!a || !b) continue;
      // Only inside one scene. A cut between scenes is a cut in TIME as well
      // as space and a character is allowed to be somewhere else; inside a
      // scene the cut is continuous and the distance has to be walkable.
      if (!sameScene) continue;
      const gap = Math.max(1 / film.fps, shot.start - previous.end + shot.seconds * (firstNow.p) + previous.seconds * (1 - lastBefore.p));
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (distance > maxTravel * gap) {
        push('warning', 'teleport', shot.id, actor.id,
          `covers ${distance.toFixed(1)} m across a ${gap.toFixed(2)} s cut — ${(distance / gap).toFixed(1)} m/s, faster than the ${maxTravel} m/s this film allows a body`);
      }
    }

    /* prop state: what was open must not silently be closed */
    for (const prop of shot.props ?? []) {
      const before = previous.props?.find((p) => p.id === prop.id);
      if (!before || !before.state || !prop.state || before.state === prop.state) continue;
      if (!sameScene) continue;
      const explained = (previous.cues ?? []).some((c) => c.id === prop.id || c.id.startsWith(`${prop.id}.`))
        || (shot.cues ?? []).some((c) => c.id === prop.id || c.id.startsWith(`${prop.id}.`));
      if (!explained) {
        push('warning', 'prop-state-jump', shot.id, prop.id,
          `"${before.state}" in ${previous.id} and "${prop.state}" here, with no cue between them that changes it`);
      }
    }

    /* the 180° line */
    if (sameScene) {
      const line = crossedTheLine(sets, previous, shot);
      if (line) {
        push('warning', 'crossed-the-line', shot.id, line.pair,
          `the lens crosses the line between ${line.pair} — ${line.a} was on the ${line.wasLeft ? 'left' : 'right'} of frame and is now on the ${line.wasLeft ? 'right' : 'left'}. Deliberate is fine; accidental reads as a geography error nobody can name.`);
      }
    }
  }

  /* ---- coverage ------------------------------------------------------ */

  const appeared = new Set<string>();
  for (const shot of film.shots) for (const a of shot.actors ?? []) appeared.add(a.id);
  for (const member of film.manifest.cast ?? []) {
    if (!appeared.has(member.id)) {
      push('note', 'cast-never-blocked', '(film)', member.id, 'is in the cast and appears in no shot');
    }
  }

  const order: Record<ContinuityProblem['severity'], number> = { error: 0, warning: 1, note: 2 };
  const indexOf = new Map(film.shots.map((s, i) => [s.id, i] as const));
  // An actor with three blocking points on one mark produces the same finding
  // three times, and a report where the first ten rows are one fact is a
  // report people stop reading at row three. Identity is the whole row, so two
  // genuinely different positions in one shot still both appear.
  const seen = new Set<string>();
  const unique = problems.filter((p) => {
    const key = `${p.severity}|${p.code}|${p.shot}|${p.subject}|${p.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((x, y) =>
    (indexOf.get(x.shot) ?? -1) - (indexOf.get(y.shot) ?? -1) || order[x.severity] - order[y.severity]);
}

function resolve(sets: SetIndex, shot: CompiledShot, b: { readonly mark?: string; readonly at?: Vec3 }): Vec3 | null {
  if (b.at) return b.at;
  if (!b.mark) return null;
  const mark: Mark | undefined = sets.mark(shot.setId, b.mark);
  return mark ? mark.at : null;
}

/**
 * Did the lens cross the axis between the same two bodies?
 *
 * The line is the segment between the two actors both shots share. Which side
 * the eye is on is the sign of the 2-D cross product of that segment with the
 * segment from the first actor to the eye; when the sign flips, left and right
 * swap in frame. Only the first two shared actors are considered, because a
 * three-body scene has three lines and "which line" is a directorial choice
 * this file has no business making.
 */
function crossedTheLine(
  sets: SetIndex,
  previous: CompiledShot,
  shot: CompiledShot,
): { pair: string; a: string; wasLeft: boolean } | null {
  const shared = (shot.actors ?? [])
    .map((a) => a.id)
    .filter((id) => (previous.actors ?? []).some((p) => p.id === id));
  if (shared.length < 2) return null;
  const [first, second] = [shared[0]!, shared[1]!];

  const side = (s: CompiledShot): number | null => {
    const eye = s.camera?.keys[0]?.eye;
    if (!eye) return null;
    const a = resolve(sets, s, s.actors?.find((x) => x.id === first)?.blocking[0] ?? {});
    const b = resolve(sets, s, s.actors?.find((x) => x.id === second)?.blocking[0] ?? {});
    if (!a || !b) return null;
    const abx = b[0] - a[0];
    const abz = b[2] - a[2];
    const aex = eye[0] - a[0];
    const aez = eye[2] - a[2];
    const cross = abx * aez - abz * aex;
    // A lens almost ON the line has no side, and reporting a flip there is
    // noise: the two bodies are stacked in frame anyway.
    const scale = Math.hypot(abx, abz) * Math.hypot(aex, aez);
    if (scale <= 0 || Math.abs(cross) < scale * 0.08) return null;
    return Math.sign(cross);
  };

  const was = side(previous);
  const now = side(shot);
  if (was === null || now === null || was === now) return null;
  return { pair: `${first} and ${second}`, a: first, wasLeft: was > 0 };
}

/** A one-line verdict a shell can print, and a probe can assert on. */
export function continuitySummary(problems: readonly ContinuityProblem[]): string {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  const notes = problems.filter((p) => p.severity === 'note').length;
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${notes} note${notes === 1 ? '' : 's'}`;
}
