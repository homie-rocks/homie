/**
 * ============================================================================
 *  graphbuild — laying a navigable graph down by hand, and joining it up.
 * ============================================================================
 *
 *  `navgraph.ts` in this package is what a graph IS and how you drive on it.
 *  This is the other end: putting one there in the first place, before there is
 *  anything in the world to derive one from. A road network before the player
 *  has built a road, a patrol route, a trail system, a set of shipping routes,
 *  a fallback the game can always fall back to.
 *
 *  Two functions, and they are two because the second is the one that gets
 *  forgotten.
 *
 *  ── 1. A RUN OF NODES ALONG A SPAN ─────────────────────────────────────────
 *
 *  `nodeRun` subdivides a straight span into a whole number of equal steps and
 *  links consecutive nodes. It ROUNDS rather than ceils, and that is the
 *  opposite of `@homie-rocks/scatter`'s `strideSegments`, deliberately: a stride
 *  spacing is a MAXIMUM chord length past which geometry leaves a surface, so
 *  rounding down there is a bug — while a node spacing is a nominal pitch and a
 *  90 m road with a 26 m pitch wants three segments of 30 rather than four of
 *  22.5. Two different questions, and naming the difference is cheaper than
 *  discovering it.
 *
 *  ── 2. STITCHING, WITHOUT WHICH IT IS TWO NETWORKS ─────────────────────────
 *
 *  This is the failure. A loop laid over a set of straight runs LOOKS like a
 *  network in a debug draw and is two disconnected components, so half the
 *  traffic never meets the other half, a router silently never finds a path,
 *  and the symptom is not an error — it is a world where nothing ever goes
 *  anywhere interesting. `stitchNearest` joins each node of one set to the
 *  nearest node OUTSIDE that set, within a radius.
 *
 *  Membership is a predicate rather than a set object because the caller
 *  already knows what its subset is, and the radius is a real refusal: a stitch
 *  to something 400 m away is a road nobody would build, and leaving the
 *  component genuinely disconnected is more honest than an edge across the map.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS THE CALLER'S ─────────────────────────────
 *
 *  Mechanism: the subdivision, the consecutive linking, the nearest search and
 *  the radius refusal. The caller's: where the roads go, how wide the pitch is,
 *  how far a stitch may reach, and what a node and an edge actually are — both
 *  functions reach the graph only through callbacks, so this works on an array
 *  of indices, an adjacency map or a class with methods, and imports nothing.
 * ============================================================================
 */

/**
 * Nodes evenly spaced along the span, consecutive ones linked.
 *
 * @param pitch  nominal spacing. The real spacing is the span divided by the
 *               nearest whole number of steps, and never fewer than two — a
 *               one-segment "run" is an edge, and a caller that wanted an edge
 *               would have written one.
 * @param add    create a node at (x, z); return its id.
 * @param link   join two node ids.
 * @returns      the id of the LAST node, so a caller can chain runs, or -1 for
 *               a span that produced nothing.
 */
export function nodeRun(
  x0: number, z0: number, x1: number, z1: number, pitch: number,
  add: (x: number, z: number) => number,
  link: (a: number, b: number) => void,
): number {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.round(len / pitch));
  let prev = -1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const id = add(x0 + dx * t, z0 + dz * t);
    if (prev >= 0) link(prev, id);
    prev = id;
  }
  return prev;
}

/**
 * The biggest connected run inside a SUBSET of the graph.
 *
 * `stitchNearest` exists to stop a graph having several components. This is
 * what you need when a subset legitimately does: pick some nodes by a test that
 * knows nothing about topology — inside a band, facing the right way, on the
 * right side of a river, above the tide line — and the answer is almost never
 * one connected run. It is the one run you want plus a scatter of ones and twos
 * that happen to pass the same test somewhere else entirely.
 *
 * Taking all of them is the bug, and it is a quiet one: everything the subset
 * feeds is placed correctly, on the wrong road. Taking the LARGEST run is what
 * turns "nodes that are in front of the camera" into "the road that is in front
 * of the camera".
 *
 * An iterative flood fill, not recursion: a long route is a long chain, and a
 * recursive fill over a few thousand nodes is a stack overflow in the one build
 * where the map got bigger.
 *
 * @param members    the subset, and the only nodes that may be walked into.
 *                   Membership is by VALUE, so duplicates cost nothing.
 * @param neighbours adjacency for a node. May include ids outside `members`;
 *                   they are skipped rather than treated as an error, because
 *                   a subset by definition has edges leaving it.
 * @returns          the largest run, in the order the fill reached it — a
 *                   stack order, so a caller that wants it sorted must sort it.
 *                   Ties go to the FIRST one found, which makes the answer
 *                   depend only on `members`' order and not on the fill.
 */
export function largestComponent(
  members: readonly number[],
  neighbours: (id: number) => readonly number[],
): number[] {
  const set = new Set(members);
  const seen = new Set<number>();
  let best: number[] = [];
  for (const s of members) {
    if (seen.has(s)) continue;
    const stack = [s];
    const comp: number[] = [];
    seen.add(s);
    while (stack.length) {
      const i = stack.pop() as number;
      comp.push(i);
      const adj = neighbours(i);
      for (let e = 0; e < adj.length; e++) {
        const j = adj[e] as number;
        if (!set.has(j) || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/**
 * Join every node in `members` to its nearest non-member within `radius`.
 *
 * @param count    how many nodes the graph has in total.
 * @param members  the subset to stitch OUT of — usually a freshly laid loop.
 * @param isMember true for a node that is part of that subset and therefore
 *                 not a valid partner. A subset stitched to itself is the same
 *                 two components it started with.
 * @param x,z      node position by id.
 * @param radius   a partner further than this is refused, and the member is
 *                 left unstitched. An edge across the whole map is worse than
 *                 an honest hole.
 * @param link     join two node ids.
 * @returns        how many edges were added.
 */
export function stitchNearest(
  count: number,
  members: readonly number[],
  isMember: (id: number) => boolean,
  x: (id: number) => number,
  z: (id: number) => number,
  radius: number,
  link: (a: number, b: number) => void,
): number {
  let made = 0;
  for (const r of members) {
    let best = -1, bestD = radius * radius;
    for (let j = 0; j < count; j++) {
      if (j === r || isMember(j)) continue;
      const dx = x(r) - x(j), dz = z(r) - z(j);
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = j; }
    }
    if (best >= 0) { link(r, best); made++; }
  }
  return made;
}
