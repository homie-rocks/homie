/**
 * ============================================================================
 *  Pose — is this a place a body can actually be, and if not, where is the
 *  nearest one? For staged captures, spawn points and anything else authored
 *  as a pair of numbers on a plan.
 * ============================================================================
 *
 *  ── WHAT GOES WRONG WITHOUT IT ─────────────────────────────────────────────
 *  A capture script puts a player at an authored (x, z) for a screenshot. The
 *  spot is the corner of a cover wall. The game is correct about it: the
 *  camera, finding itself inside a wall, pulls in to nothing. The picture is a
 *  close-up of a texture, and whoever reads it files a bug against the camera
 *  or the terrain. The mistake was the position, and nothing said so.
 *
 *  So a staged position is checked before it is used, with a reason in words:
 *
 *    `groundPose`    the height of the floor there (which floor: the one
 *                    nearest the height asked for, or the highest with room)
 *    `poseProblem`   why a body cannot stand at a pose, or null
 *    `placePose`     ground it, check it, and if it is bad either say why or,
 *                    when a search distance is given, move to the nearest good
 *                    spot and say how far it moved and what was wrong
 *    `sightProblem`  why a camera at this eye cannot see its subject, or null
 *
 *  ── THE GAME'S OWN RULE ────────────────────────────────────────────────────
 *  A world knows about floors, walls and cover. It does not know that the
 *  north yard is out of bounds until round two, or that water is not a place
 *  to stand. `PoseRule` is where a game says so: a function from a position to
 *  null (fine) or a sentence (why not). It runs after the world's own checks
 *  and its sentence is reported exactly as written.
 * ============================================================================
 */
import { supported, type WorldQuery } from './Levels.ts';
import type { Point3 } from './Route.ts';

/** The body being placed, in metres. */
export interface PoseBody { radius: number; height: number; step: number }
/** The game's own rule: null when the position is allowed, else why it is not. */
export type PoseRule = (pose: Point3) => string | null;

/**
 * A position with its feet on a floor over `(x, z)`: the surface nearest `near` when a height is given, else the
 * highest one with room for the body. Null where there is no such surface.
 */
export function groundPose(world: WorldQuery, x: number, z: number, body: PoseBody, near?: number): Point3 | null {
  let best: number | null = null;
  for (const s of world.surfacesAt(x, z)) {
    if (s.ceiling - s.y < body.height) continue;
    if (best === null || near === undefined || Math.abs(s.y - near) < Math.abs(best - near)) best = s.y;
  }
  return best === null ? null : { x, y: best, z };
}

/** Why a body cannot stand at this pose, or null when it can. */
export function poseProblem(world: WorldQuery, pose: Point3, body: PoseBody, rule?: PoseRule): string | null {
  const s = world.standOn(pose.x, pose.y, pose.z, body.step);
  // No surface within a step of the feet: either the feet are buried (the world says in what), or there is none.
  if (!s) return world.solidAt(pose.x, pose.y, pose.z, body.radius, body.height, body.step) ?? 'nothing to stand on here';
  if (pose.y - s.y > 0.05) return `floating ${(pose.y - s.y).toFixed(2)} m above the surface`;
  const solid = world.solidAt(pose.x, pose.y, pose.z, body.radius, body.height, body.step);
  if (solid) return solid;
  if (!supported(world, pose.x, s.y, pose.z, body.radius, body.step, body.step)) return 'part of the body is over an edge or a step it cannot stand across';
  return rule ? rule(pose) : null;
}

export interface PlaceOptions {
  /** The game's own rule. */
  rule?: PoseRule;
  /** Metres to look around for a good spot when the authored one is bad. 0 or absent: do not move, only report. */
  search?: number;
}
export interface PlacedPose {
  ok: boolean;
  /** The pose to use (grounded, and moved when it had to be), or null when there is none. */
  pose: Point3 | null;
  /** Metres it was moved in plan. 0 when the authored spot was good. */
  moved: number;
  /** What was wrong with the authored spot, when anything was: say it in the capture's log either way. */
  why: string | null;
}

/**
 * Put a body at an authored spot, grounded. `want.y`, when given, picks the floor (a spot on the roof and one in
 * the room under it differ only by it). A bad spot is reported, or with `search` replaced by the nearest good one.
 */
export function placePose(world: WorldQuery, want: { x: number; z: number; y?: number }, body: PoseBody, opts: PlaceOptions = {}): PlacedPose {
  const at = (x: number, z: number): { pose: Point3 | null; why: string | null } => {
    const pose = groundPose(world, x, z, body, want.y);
    return pose ? { pose, why: poseProblem(world, pose, body, opts.rule) } : { pose: null, why: 'no floor with room for the body here' };
  };
  const first = at(want.x, want.z);
  if (first.pose && !first.why) return { ok: true, pose: first.pose, moved: 0, why: null };
  const reach = opts.search ?? 0;
  // Rings of twelve, a quarter metre apart, each turned half a step from the last: the same spots every run.
  for (let r = 0.25, ring = 0; r <= reach + 1e-9; r += 0.25, ring += 1) for (let i = 0; i < 12; i += 1) {
    const a = ((i + (ring % 2) / 2) / 12) * Math.PI * 2;
    const next = at(want.x + Math.cos(a) * r, want.z + Math.sin(a) * r);
    if (next.pose && !next.why) return { ok: true, pose: next.pose, moved: r, why: first.why };
  }
  return { ok: false, pose: null, moved: 0, why: first.why };
}

/** Why a camera at `eye` cannot see `subject` (it is inside something, or something is between them), or null. */
export function sightProblem(world: WorldQuery, eye: Point3, subject: Point3): string | null {
  const dx = subject.x - eye.x; const dy = subject.y - eye.y; const dz = subject.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return 'the camera is on its subject';
  const inside = world.solidAt(eye.x, eye.y, eye.z, 0.05, 0.05, 0);
  if (inside) return `the camera is ${inside}`;
  const t = world.ray(eye.x, eye.y, eye.z, dx, dy, dz, 1);
  return t < 0.999 ? `something solid is ${(t * dist).toFixed(2)} m along the ${dist.toFixed(2)} m line from the camera to its subject` : null;
}
