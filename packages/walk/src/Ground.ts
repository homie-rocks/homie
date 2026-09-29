/**
 * ============================================================================
 *  Ground.ts — the ONE question a walk asks the world.
 * ============================================================================
 *
 *  There were three live models of "what is under a person" in this repository
 *  before this package existed and not one of them was this:
 *
 *   · a first-person shooter's collision (now `@homie-rocks/brush/Collide.ts`)
 *     — a swept capsule against axis-aligned boxes and ramps. Its own header
 *     calls the box pile "a deliberate constraint: it makes LOS, nav and
 *     physics the same data", which is exactly right for a station and has no
 *     answer for a bank.
 *   · `@homie-rocks/vehicle/travel.ts::solveCorners` — a four-corner load pass.
 *   · a third-person exploration game's terrain — a bilinear heightfield with a
 *     central-difference normal, fifty lines, written because neither of the
 *     other two is a ground plane you can walk across at any angle.
 *
 *  THE INTERFACE IS THE THIRD ONE, NARROWED TO WHAT THE CONTROLLER READS —
 *  which is the technique these packages use instead of passing a god object:
 *  list the fields the mechanism ACTUALLY touches, declare an interface of
 *  exactly those, and no call site changes. `Walker` reads `sample` and
 *  `halfSpan` and nothing else, so those are the whole of `GroundField`, and
 *  that game's `ITerrain` satisfies it structurally with no edit.
 *
 *  WHAT IS DELIBERATELY ABSENT: a capsule, a radius, a step list, a nav mesh,
 *  a material and a trigger volume. Every one of them is a thing SOME game
 *  needs and no game needs all of; a `GroundField` that carried them would be
 *  a package that had picked one game's world model. When a box world adopts
 *  this, the honest shape is a SECOND implementation of `sample` backed by its
 *  capsule sweep — not a field added here.
 * ============================================================================
 */
import type * as THREE from 'three';

/**
 * What is under a point.
 *
 * `slope` is the COSINE of the surface normal against world up, not an angle.
 * Every comparison the controller makes against it is a dot product it already
 * has; converting to degrees to compare and back to walk on is two
 * transcendentals a frame for a number nothing displays.
 *
 * `walkable` is the WORLD's decision and not the controller's, and that split is
 * load-bearing. A heightfield decides it from the slope; a station decides it
 * from what the surface is made of; a hollow could decide it from whether a
 * root is in the way. `Walker` never recomputes it — it reads it — so a world
 * with an opinion the cosine cannot express is not fighting the package.
 */
export interface GroundSample {
  y: number;
  normal: THREE.Vector3;
  /** `normal.y`. 1 is flat, 0 is a wall. */
  slope: number;
  /** true when this is ground a figure may stand on rather than scree */
  walkable: boolean;
}

/**
 * The world, as a walk sees it. Two members, and both are required.
 *
 * `sample` MUST write into `out` and MUST NOT allocate: it is called twice per
 * step, per figure, forever. Returning `out` as well is a convenience the
 * controller does not use.
 *
 * `halfSpan` is the half-extent of the square the figure may occupy, in metres.
 * A world with no boundary passes `Infinity` and the soft wall costs one
 * comparison per axis per step — `Math.abs(v) - (Infinity - wallSoft)` is
 * `-Infinity`, which is `<= 0`, so the push is skipped by the same branch that
 * skips it in the middle of a hollow. It is NOT optional, because a game that
 * forgot to state it would silently inherit somebody else's world size.
 */
export interface GroundField {
  /** Ground under `(x, z)`, written into `out`. Never allocates. */
  sample(x: number, z: number, out: GroundSample): GroundSample;
  /** Half-extent of the walkable square, metres. `Infinity` for no boundary. */
  readonly halfSpan: number;
}
