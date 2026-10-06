/**
 * ============================================================================
 *  Markers — where a mark on the ground goes when there is more than one
 *  ground: on EVERY level a person could be standing on.
 * ============================================================================
 *
 *  A zone edge, a danger ring, an objective outline: each is drawn by dropping
 *  points onto "the surface". With one height field that is unambiguous. With
 *  a building in the way, the obvious code asks for the highest surface, draws
 *  the ring across the roof, and the player standing in the room below sees
 *  nothing at all while the zone closes on them.
 *
 *  `markerSpots` answers with every surface over a point that has room above
 *  it for a person; `ringStrips` turns a circle into one strip of points per
 *  surface it crosses, so the roof gets its arc and the room under it gets its
 *  own. `markerSeenFrom` is the fixture that keeps it true: from a given eye,
 *  is any part of the mark both near and not hidden behind a slab or a wall?
 *  A game's test stands an eye under its roof and asserts yes.
 *
 *  A surface with something solid directly on it (ground under a slab, floor
 *  under a crate) has no room and gets no mark: nobody can be there to see it.
 * ============================================================================
 */
import type { Surface, WorldQuery } from './Levels.ts';
import type { Point3 } from './Route.ts';

export interface MarkerSpot extends Point3 { id: string; level: number; kind: Surface['kind'] }

/**
 * Every place a mark over `(x, z)` belongs: one for each surface with at least `clearance` metres above it, lowest
 * first, raised `lift` metres so it does not fight the surface it lies on.
 */
export function markerSpots(world: WorldQuery, x: number, z: number, clearance: number, lift = 0.05): MarkerSpot[] {
  const out: MarkerSpot[] = [];
  for (const s of world.surfacesAt(x, z)) if (s.ceiling - s.y >= clearance) out.push({ x, y: s.y + lift, z, id: s.id, level: s.level, kind: s.kind });
  return out;
}

/** A run of points along one surface: `xyz` is three numbers a point, in order. */
export interface MarkerStrip { id: string; level: number; xyz: Float32Array }

export interface RingOptions {
  /** Points round the circle. More where the ring is large or the building's rooms are small. */
  segments: number;
  /** Headroom a surface needs to get a mark, metres: a person's height. */
  clearance: number;
  lift?: number;
}

/**
 * A circle as strips, one for each stretch of each surface it crosses. Where the circle runs under a roof there
 * are two strips over the same stretch of plan: the roof's and the floor's.
 */
export function ringStrips(world: WorldQuery, cx: number, cz: number, radius: number, opts: RingOptions): MarkerStrip[] {
  const n = Math.max(3, Math.floor(opts.segments));
  const done: MarkerStrip[] = [];
  const open = new Map<string, { level: number; pts: number[] }>();
  const close = (id: string): void => {
    const run = open.get(id);
    open.delete(id);
    if (run && run.pts.length >= 6) done.push({ id, level: run.level, xyz: new Float32Array(run.pts) });
  };
  // One point past the start, so a ring that lies wholly on one surface comes back closed.
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const spots = markerSpots(world, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, opts.clearance, opts.lift);
    for (const id of [...open.keys()]) if (!spots.some((s) => s.id === id)) close(id);
    for (const s of spots) {
      const run = open.get(s.id) ?? { level: s.level, pts: [] };
      run.pts.push(s.x, s.y, s.z);
      open.set(s.id, run);
    }
  }
  for (const id of [...open.keys()]) close(id);
  return done;
}

export interface MarkerSight {
  /** Whether any point of any strip is within `maxDist` and has a clear line from the eye. */
  seen: boolean;
  /** The surface that point is on, when seen. */
  id: string | null;
  /** Points within `maxDist`, seen or not: 0 means the mark is simply far away, not hidden. */
  near: number;
}

/**
 * The visibility fixture: from this eye, can a person see the mark? A point counts when it is within `maxDist`
 * metres and nothing solid lies between the eye and it.
 */
export function markerSeenFrom(world: WorldQuery, eye: Point3, strips: readonly MarkerStrip[], maxDist: number): MarkerSight {
  let near = 0;
  for (const s of strips) for (let k = 0; k + 2 < s.xyz.length; k += 3) {
    const dx = (s.xyz[k] as number) - eye.x; const dy = (s.xyz[k + 1] as number) - eye.y; const dz = (s.xyz[k + 2] as number) - eye.z;
    if (Math.hypot(dx, dy, dz) > maxDist) continue;
    near += 1;
    // The direction is the whole way to the point, so a hit before 1 is something in between.
    if (world.ray(eye.x, eye.y, eye.z, dx, dy, dz, 1) >= 0.999) return { seen: true, id: s.id, near };
  }
  return { seen: false, id: null, near };
}
