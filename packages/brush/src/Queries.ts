import * as THREE from 'three';
import type { CollisionWorld } from './Collide.ts';

/**
 * ============================================================================
 *  Queries — the seven questions a game asks a brush world every frame, in the
 *  shape a game asks them in.
 * ============================================================================
 *  `CollisionWorld` answers in ITS vocabulary: a ground record or null, a
 *  collide result, a raycast hit. A game asks in a slightly different one, and
 *  the gap between the two is the same seven small adaptations every time:
 *
 *   · **A GROUND PROBE NEVER RETURNS NULL.** A caller standing over a hole
 *     needs a number, and the number is the game's — how far down the void is,
 *     and what the surface of nothing is. `null` propagating out of a probe is
 *     an `undefined.y` in a physics step three frames later, on the one
 *     geometry nobody tested.
 *   · **THE PROBE LOOKS DOWN FROM ABOVE THE FEET.** A query started exactly at
 *     the feet misses a step the feet are already standing on. The lift is the
 *     game's, because it is a fraction of that game's capsule.
 *   · **A CAPSULE HIT IS REUSED, NEVER ALLOCATED.** Sixty a second per actor,
 *     with seven bots, is 480 objects a second out of the hot path — and the
 *     symptom of a minor GC in the wrong frame is one dropped frame while
 *     turning, which a person reads as the game stuttering when they aim.
 *   · **A LINE OF SIGHT IS SHORTENED AT THE FAR END.** Without it, a ray to a
 *     point ON a surface hits that surface and every target standing against a
 *     wall is permanently invisible. How much to give back is the game's: it is
 *     a function of how far inside its own skin that game puts an eye.
 *
 *  WHAT IS DELIBERATELY NOT HERE: what a room is called, where the nav nodes
 *  are, what a surface means, and any threshold. Those are the world.
 * ============================================================================
 */

/** What a ground query answers with. A game's own probe type satisfies this. */
export interface GroundAnswer<S extends number> {
  y: number;
  normal: THREE.Vector3;
  surface: S;
  grounded: boolean;
}

/** The reused capsule result. Every field is overwritten on every step. */
export interface CapsuleAnswer<S extends number> {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  grounded: boolean;
  normal: THREE.Vector3;
  surface: S;
  wall: THREE.Vector3 | null;
  ceiling: boolean;
  stepped: boolean;
}

/**
 * The four numbers a world has to state. None is optional and none has a
 * default: a void depth and a sight margin are measurements about one game's
 * scale, and inheriting either silently is how a figure falls to a floor that
 * belongs to somebody else's level.
 */
export interface QueryTuning<S extends number> {
  /** the y a probe answers with when there is no ground under the query */
  voidY: number;
  /** the surface a probe answers with there */
  voidSurface: S;
  /** how far ABOVE the query point the downward probe starts, metres */
  probeLift: number;
  /** how far short of the far end a line-of-sight ray stops, metres */
  sightMargin: number;
}

const _d = new THREE.Vector3();

/**
 * A brush world's query surface, bound to one `CollisionWorld` and one game's
 * four numbers.
 *
 * It holds NO nav graph and NO room table. Those live in the game, because a
 * node is a standing place somebody chose and a room has a name; the two nav
 * helpers next door in `Nav.ts` are free functions over the game's own arrays
 * for exactly that reason.
 */
export class BrushQueries<S extends number> {
  private readonly hit: CapsuleAnswer<S>;

  constructor(
    private readonly col: CollisionWorld<S>,
    private readonly t: QueryTuning<S>,
  ) {
    this.hit = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), grounded: false,
      normal: new THREE.Vector3(0, 1, 0), surface: t.voidSurface,
      wall: null, ceiling: false, stepped: false,
    };
  }

  /**
   * The ground under `p`, always. `normal` is CLONED on the hit path, because
   * the collider's own vector is reused and a caller that keeps a probe would
   * otherwise be holding a value the next query overwrites.
   */
  probe(p: THREE.Vector3): GroundAnswer<S> {
    const g = this.col.groundAt(p.x, p.z, p.y + this.t.probeLift);
    if (!g) {
      return {
        y: this.t.voidY,
        normal: new THREE.Vector3(0, 1, 0),
        surface: this.t.voidSurface,
        grounded: false,
      };
    }
    return { y: g.y, normal: g.normal.clone(), surface: g.surface, grounded: true };
  }

  /**
   * One swept-capsule step. `pos` and `vel` are advanced IN PLACE by the
   * collider; the returned record is this object's own and is valid until the
   * next call.
   */
  collideCapsule(
    pos: THREE.Vector3, vel: THREE.Vector3, radius: number, height: number, dt: number,
  ): CapsuleAnswer<S> {
    const r = this.col.collide(pos, vel, radius, height, dt);
    const h = this.hit;
    h.pos.copy(pos);
    h.vel.copy(vel);
    h.grounded = r.grounded;
    h.normal.copy(r.normal);
    h.surface = r.surface;
    h.wall = r.wall;
    h.ceiling = r.ceiling;
    h.stepped = r.stepped;
    return h;
  }

  /**
   * Unobstructed sight from `a` to `b`.
   *
   * Two points closer than a tenth of a millimetre see each other rather than
   * producing a zero-length ray: normalising that is a direction of NaNs, and a
   * hash walk with a NaN direction visits no cells and answers "clear" — which
   * is the same answer by accident, until the day the walk is changed.
   */
  los(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = _d.copy(b).sub(a);
    const dist = d.length();
    if (dist < 1e-4) return true;
    d.multiplyScalar(1 / dist);
    return !this.col.raycast(a, d, dist - this.t.sightMargin);
  }

  /** First world hit along a ray, or null. Straight through to the collider. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
    return this.col.raycast(origin, dir, maxDist);
  }
}
