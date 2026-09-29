/**
 * ============================================================================
 *  Nav.ts — a graph of standing places, and the box you are standing in.
 * ============================================================================
 *
 *  Three functions out of a first-person shooter's station builder. Each of
 *  them fits the rule of thumb for shared code exactly — you can say what it
 *  does without naming a station, a dock or a brine well:
 *
 *   · `nearestNode`  — linear scan for the closest node to a point
 *   · `bfsPath`      — breadth-first, fewest hops, from one node id to another
 *   · `linkByVisibility` — the pass that turns a list of points into a graph:
 *                      near enough, not too far vertically, and either close
 *                      enough not to bother asking or actually visible
 *   · `roomAt`       — which named box contains a point
 *
 *  THE POINTS THEMSELVES DID NOT MOVE AND MUST NOT. Where a game puts twenty
 *  standing places is the whole of its level design; the original file lists
 *  them by room name with hand-chosen coordinates and every one of them stayed
 *  in the game. What moved is the four numbers-and-a-loop that wire them.
 *
 *  THE FOUR THRESHOLDS ARE OPTIONS, DEFAULTED TO WHAT THE STATION USED. 14 m
 *  of reach, 4.5 m of vertical tolerance, an 8 m radius inside which a link is
 *  assumed rather than traced, and an eye 1.2 m above the node to trace from.
 *  Those are statements about a building — a game with 3 m ceilings and a game
 *  with 30 m ones want different ones — so the package states the mechanism
 *  and the game states the number, as everywhere else on this shelf.
 *
 *  ## BFS, NOT A*, AND THAT IS DELIBERATE
 *
 *  `bfsPath` returns FEWEST HOPS, not shortest distance. On a graph of twenty
 *  hand-placed standing places those are usually the same answer and the ones
 *  where they differ are the ones a level designer already thought about. It
 *  is kept as it shipped rather than "improved" into A*, because an AI that
 *  starts taking a different route through a building is a BEHAVIOUR change
 *  and this move is not allowed to be one. If a game wants a weighted search
 *  it is a second function here, beside this one, with its own before-and-
 *  after.
 *
 *  ## NO `three` IN THIS FILE
 *
 *  Every signature takes a bare `{ x, y, z }`, which a `THREE.Vector3`
 *  satisfies structurally with no adapter and no `instanceof` — the technique
 *  `@homie-rocks/geom/station.ts` uses for the same reason next door. Nothing here
 *  allocates a vector, so there is no copy of three.js to be a second universe
 *  of its own.
 */

/** A point in space. `THREE.Vector3` satisfies this. */
export interface NavVec {
  x: number;
  y: number;
  z: number;
}

/**
 * A standing place. The game's own node type satisfies this structurally as
 * long as it carries these three fields; anything else it hangs off a node —
 * a room name, a cover flag, an audio zone — is invisible here and stays the
 * game's.
 */
export interface NavPoint {
  id: number;
  pos: NavVec;
  links: number[];
}

/** Nearest node to a point, by squared distance. Returns node 0 on an empty graph. */
export function nearestNode(nav: readonly NavPoint[], p: NavVec): number {
  let best = 0, bestD = Infinity;
  for (const n of nav) {
    const dx = n.pos.x - p.x, dy = n.pos.y - p.y, dz = n.pos.z - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

/** Nearest of a list of places to a point, by squared distance. Null if empty. */
export function nearestPlace<T extends { pos: NavVec }>(
  places: readonly T[], p: NavVec,
): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const c of places) {
    const dx = c.pos.x - p.x, dy = c.pos.y - p.y, dz = c.pos.z - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * How much a candidate spawn is worth. Every field is required and none has a
 * default: these five numbers ARE a game's answer to "how badly do I mind
 * being shot the moment I appear", and a default here would be one game's
 * tolerance imposed on the next.
 */
export interface SpawnWeights {
  /** points of pure noise added to every candidate, so a tie is not a habit */
  jitter: number;
  /** points per metre of distance to each live body */
  perMetre: number;
  /** metres past which extra distance stops paying */
  reach: number;
  /** metres inside which a body is too close */
  crowd: number;
  /** points a body inside `crowd` costs */
  crowdCost: number;
}

/**
 * The best of a list of spawn points, given who is already standing about.
 *
 * THE SCORE IS SUMMED OVER EVERY BODY, not taken from the nearest. That is the
 * difference between "far from the closest enemy" and "not in the middle of
 * the fight", and it is the one that reads as fair: a point twelve metres from
 * one bot beats a point ten metres from four.
 *
 * `rng` is consumed ONCE PER CANDIDATE, in list order, and it is an argument
 * rather than `Math.random` so a harness can replay a spawn. Ties go to the
 * EARLIER candidate (`>` and not `>=`), which is what makes a seeded run
 * reproducible rather than order-of-iteration dependent.
 */
export function pickSpawn<T extends { pos: NavVec }>(
  points: readonly T[], bodies: Iterable<NavVec>, w: SpawnWeights, rng: () => number,
): T | null {
  if (!points.length) return null;
  let best: T | null = null, bestScore = -Infinity;
  for (const p of points) {
    let score = rng() * w.jitter;
    for (const b of bodies) {
      const dx = b.x - p.pos.x, dy = b.y - p.pos.y, dz = b.z - p.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      score += Math.min(d, w.reach) * w.perMetre;
      if (d < w.crowd) score -= w.crowdCost;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * Fewest hops from `from` to `to`.
 *
 * Returns `[from]` when there is no route rather than an empty array or a
 * throw: a chaser with a one-node path stands still, which is a visible thing
 * a person can report, where an empty array is an off-by-one somewhere else
 * three frames later.
 */
export function bfsPath(nav: readonly NavPoint[], from: number, to: number): number[] {
  if (from === to) return [from];
  const q = [from];
  const prev = new Map<number, number>();
  prev.set(from, -1);
  while (q.length) {
    const c = q.shift()!;
    if (c === to) break;
    const node = nav[c];
    if (!node) continue;
    for (const n of node.links) {
      if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
  }
  if (!prev.has(to)) return [from];
  const out: number[] = [];
  for (let c = to; c !== -1; c = prev.get(c)!) out.push(c);
  out.reverse();
  return out;
}

export interface LinkOpts {
  /** Two nodes further apart than this are never linked. Metres. */
  reach?: number;
  /** Two nodes further apart than this VERTICALLY are never linked. Metres. */
  rise?: number;
  /** Inside this radius a link is assumed without tracing. Metres. */
  freeRadius?: number;
  /** How far above a node the visibility trace starts and ends. Metres. */
  eye?: number;
}

/**
 * Fill in every node's `links` by asking the world what it can see.
 *
 * `visible(a, b)` is the caller's line-of-sight — for a box world that is
 * `CollisionWorld.raycast` returning nothing, and this file deliberately does
 * not know that. Mutates `links` in place, appending; it does not clear first,
 * because a game that hand-wires a lift shaft and then runs this expects both.
 *
 * The trace is offset by `eye` at BOTH ends. Tracing between two points ON the
 * floor is a trace along the floor, which every floor box in the world is
 * entitled to intersect.
 */
export function linkByVisibility(
  nav: readonly NavPoint[],
  visible: (a: NavVec, b: NavVec) => boolean,
  opts: LinkOpts = {},
) {
  const reach = opts.reach ?? 14;
  const rise = opts.rise ?? 4.5;
  const freeRadius = opts.freeRadius ?? 8;
  const eye = opts.eye ?? 1.2;
  for (const a of nav) {
    for (const b of nav) {
      if (a.id === b.id) continue;
      const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dyAbs = Math.abs(dy);
      if (d < reach && dyAbs < rise) {
        if (visible(
          { x: a.pos.x, y: a.pos.y + eye, z: a.pos.z },
          { x: b.pos.x, y: b.pos.y + eye, z: b.pos.z },
        ) || d < freeRadius) a.links.push(b.id);
      }
    }
  }
}

/** A named axis-aligned volume. */
export interface RoomBox {
  min: NavVec;
  max: NavVec;
}

/**
 * Which named box contains `p`, or `fallback` if none does.
 *
 * The fallback is a VALUE, not a default: "outside every room" is a place a
 * game has an opinion about — the original station answers `dock` south of
 * z=-8 and `atrium` otherwise, which is a statement about that building and
 * not about rooms.
 *
 * First match wins, in insertion order, so overlapping volumes are resolved by
 * the order the game declared them rather than by area or by depth.
 */
export function roomAt<T extends string>(
  rooms: Readonly<Record<string, RoomBox>>,
  p: NavVec,
  fallback: T,
): string {
  for (const [id, r] of Object.entries(rooms)) {
    if (p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y
      && p.z >= r.min.z && p.z <= r.max.z) return id;
  }
  return fallback;
}
