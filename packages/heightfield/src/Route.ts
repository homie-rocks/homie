/**
 * ============================================================================
 *  Route — waypoints with a HEIGHT, the check that a body can really follow
 *  them, and a small body that tries.
 * ============================================================================
 *
 *  ── THE BUG THIS FILE IS SHAPED AROUND ─────────────────────────────────────
 *  A route across a roof: every waypoint is on the roof, every straight leg
 *  between two waypoints is on the roof, and the bot still walks off the edge.
 *  The reason is the arrival radius. No bot walks to a waypoint exactly: it
 *  counts as arrived a metre or so short and turns for the next one THERE. So
 *  the line it actually walks is not leg, corner, leg; it is the chord from
 *  "a metre short of the corner" to the next waypoint, and at an inside corner
 *  of a roof that chord crosses air. The path was valid for a point and the
 *  bot is not a point, and it does not turn where the drawing says.
 *
 *  So a route is checked the way it is walked. `checkRoute` tests, with the
 *  mover's real arrival radius:
 *    · each waypoint, with the body's whole footprint supported;
 *    · each straight leg;
 *    · each CUT CHORD: from the place the body turns to the waypoint after.
 *  `traverse` then walks it, a step at a time, with the same numbers. One is a
 *  static proof and one is a physical run; a route should pass both, and the
 *  static one is the stricter (it wants the whole footprint supported, where
 *  the run only falls once the centre is over air).
 *
 *  ── TWO NODES AT ONE (X, Z) ────────────────────────────────────────────────
 *  A node's identity is its id and its position is three numbers. The room
 *  and the roof above it each have a node at the same plan position, and
 *  `nearestNode` chooses between them by the height asked from, never by plan
 *  distance alone: that is the difference between a bot indoors walking to the
 *  stair and a bot indoors pushing at a wall under the roof node.
 * ============================================================================
 */
import { supported, type WorldQuery } from './Levels.ts';

export interface Point3 { x: number; y: number; z: number }
export interface NavNode extends Point3 { id: string }
export interface NavEdge { a: string; b: string; oneWay?: boolean }
/** Nodes and the legs between them. Several nodes may share an (x, z). */
export interface Nav { nodes: NavNode[]; edges: NavEdge[] }

/** The body that follows a route, in metres and seconds. Every field is the game's own number. */
export interface Mover {
  radius: number;
  height: number;
  /** The rise it climbs without jumping. */
  step: number;
  /** The fall it accepts in one step without counting as having fallen. */
  maxDrop: number;
  /** How close (in plan) counts as having reached a waypoint. The number the bot's code really uses. */
  arrival: number;
  /** Metres a second, for `traverse`. */
  speed: number;
}

export interface RouteProblem {
  kind: 'unsupported' | 'blocked' | 'headroom' | 'missing';
  /** Which part of the route: a waypoint's index, the leg that ENDS at that index, or the chord that cuts that corner. */
  part: 'waypoint' | 'leg' | 'chord';
  index: number;
  at: Point3;
  why: string;
}

/**
 * The nearest node ON THE LEVEL ASKED FROM: among nodes within `levelTol` metres of `y` the nearest in plan, and
 * only when there is none, the nearest in three dimensions. Null on an empty graph.
 */
export function nearestNode(nav: Nav, x: number, y: number, z: number, levelTol: number): NavNode | null {
  let best: NavNode | null = null; let bd = Infinity; let any: NavNode | null = null; let ad = Infinity;
  for (const n of nav.nodes) {
    const plan = Math.hypot(n.x - x, n.z - z);
    if (Math.abs(n.y - y) <= levelTol && plan < bd) { bd = plan; best = n; }
    const d = Math.hypot(plan, n.y - y);
    if (d < ad) { ad = d; any = n; }
  }
  return best ?? any;
}

/** The shortest way from one node to another by the graph's legs (their length in three dimensions), or null. */
export function findRoute(nav: Nav, from: string, to: string): NavNode[] | null {
  const byId = new Map(nav.nodes.map((n) => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return null;
  const next = new Map<string, string[]>();
  const link = (a: string, b: string): void => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  for (const e of nav.edges) { link(e.a, e.b); if (!e.oneWay) link(e.b, e.a); }
  const dist = new Map<string, number>([[from, 0]]); const prev = new Map<string, string>(); const done = new Set<string>();
  for (;;) {
    let cur: string | null = null; let cd = Infinity;
    // Ties go to the node listed first, so a route never depends on the order a Map happened to iterate in.
    for (const n of nav.nodes) { const d = dist.get(n.id); if (d !== undefined && !done.has(n.id) && d < cd) { cd = d; cur = n.id; } }
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    const a = byId.get(cur) as NavNode;
    for (const id of next.get(cur) ?? []) {
      const b = byId.get(id);
      if (!b) continue;
      const d = cd + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d < (dist.get(id) ?? Infinity)) { dist.set(id, d); prev.set(id, cur); }
    }
  }
  const out: NavNode[] = [];
  for (let id: string | undefined = to; id !== undefined; id = prev.get(id)) out.unshift(byId.get(id) as NavNode);
  return out;
}

/** Where a body heading from `a` to `n` turns for the next waypoint: `arrival` short of `n` (or at `a`, if nearer). */
export function turnPoint(a: Point3, n: Point3, arrival: number): Point3 {
  const d = Math.hypot(n.x - a.x, n.z - a.z);
  if (d < 1e-9) return { x: n.x, y: n.y, z: n.z };
  const back = Math.min(arrival, d) / d;
  return { x: n.x + (a.x - n.x) * back, y: n.y + (a.y - n.y) * back, z: n.z + (a.z - n.z) * back };
}

/** Walk a straight line in the plan, following the surfaces under it: the first thing wrong, or null. */
function walkLine(world: WorldQuery, from: Point3, to: Point3, m: Mover): { kind: RouteProblem['kind']; at: Point3; why: string } | null {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(1, Math.ceil(d / Math.max(0.1, m.radius / 2)));
  const first = world.standOn(from.x, from.y, from.z, m.step);
  if (!first || first.y < from.y - m.maxDrop) return { kind: 'unsupported', at: from, why: 'nothing to stand on where the line starts' };
  let y = first.y; let px = from.x; let pz = from.z;
  for (let i = 1; i <= n; i += 1) {
    const x = from.x + (to.x - from.x) * (i / n); const z = from.z + (to.z - from.z) * (i / n);
    const at = { x, y, z };
    const wall = world.blocked(px, pz, x, z, y + m.step, y + m.height, m.radius);
    if (wall) return { kind: 'blocked', at, why: `${wall} is in the way` };
    const s = world.standOn(x, y, z, m.step);
    if (!s || s.y < y - m.maxDrop || !supported(world, x, s.y, z, m.radius, m.step, m.maxDrop)) return { kind: 'unsupported', at, why: 'the body is not fully over something to stand on here' };
    if (s.ceiling - s.y < m.height) return { kind: 'headroom', at: { x, y: s.y, z }, why: `${(s.ceiling - s.y).toFixed(2)} m of headroom and the body is ${m.height} m` };
    y = s.y; px = x; pz = z;
  }
  if (Math.abs(y - to.y) > m.step + m.arrival) return { kind: 'missing', at: { x: to.x, y, z: to.z }, why: `the line ends ${Math.abs(y - to.y).toFixed(2)} m ${y < to.y ? 'below' : 'above'} the waypoint: it reaches a different level` };
  return null;
}

/**
 * Everything wrong with a route for this mover: an empty list when it can be followed. See the header for why the
 * chords are checked as well as the legs.
 */
export function checkRoute(world: WorldQuery, path: readonly Point3[], m: Mover): RouteProblem[] {
  const out: RouteProblem[] = [];
  path.forEach((p, i) => {
    const s = world.standOn(p.x, p.y, p.z, m.step);
    if (!s || s.y < p.y - m.maxDrop) out.push({ kind: 'missing', part: 'waypoint', index: i, at: p, why: 'no surface at this waypoint\'s height' });
    else if (!supported(world, p.x, s.y, p.z, m.radius, m.step, m.maxDrop)) out.push({ kind: 'unsupported', part: 'waypoint', index: i, at: p, why: `the body (radius ${m.radius} m) overhangs an edge standing here` });
  });
  for (let i = 1; i < path.length; i += 1) {
    const bad = walkLine(world, path[i - 1] as Point3, path[i] as Point3, m);
    if (bad) out.push({ ...bad, part: 'leg', index: i });
  }
  for (let i = 1; i + 1 < path.length; i += 1) {
    const turn = turnPoint(path[i - 1] as Point3, path[i] as Point3, m.arrival);
    const bad = walkLine(world, turn, path[i + 1] as Point3, m);
    if (bad) out.push({ ...bad, part: 'chord', index: i, why: `turning ${m.arrival} m short of waypoint ${i}: ${bad.why}` });
  }
  return out;
}

/** `checkRoute` for a whole graph: every node, every leg, and every corner two legs make at a node, both ways. */
export function checkNav(world: WorldQuery, nav: Nav, m: Mover): RouteProblem[] {
  const out: RouteProblem[] = [];
  const byId = new Map(nav.nodes.map((n) => [n.id, n]));
  const index = new Map(nav.nodes.map((n, i) => [n.id, i]));
  const seen = new Set<string>();
  const add = (p: RouteProblem, key: string): void => { if (!seen.has(key)) { seen.add(key); out.push(p); } };
  const into = new Map<string, string[]>(); const from = new Map<string, string[]>();
  const link = (a: string, b: string): void => { (from.get(a) ?? from.set(a, []).get(a) as string[]).push(b); (into.get(b) ?? into.set(b, []).get(b) as string[]).push(a); };
  for (const e of nav.edges) {
    if (!byId.has(e.a) || !byId.has(e.b)) { out.push({ kind: 'missing', part: 'leg', index: -1, at: { x: 0, y: 0, z: 0 }, why: `a leg names node ${byId.has(e.a) ? e.b : e.a}, which is not in the graph` }); continue; }
    link(e.a, e.b); if (!e.oneWay) link(e.b, e.a);
  }
  for (const n of nav.nodes) for (const p of checkRoute(world, [n], m)) add({ ...p, index: index.get(n.id) as number, why: `node ${n.id}: ${p.why}` }, `n:${n.id}`);
  for (const [a, outs] of from) for (const b of outs) {
    const A = byId.get(a) as NavNode; const B = byId.get(b) as NavNode;
    const bad = walkLine(world, A, B, m);
    if (bad) add({ ...bad, part: 'leg', index: index.get(b) as number, why: `${a} to ${b}: ${bad.why}` }, `l:${a}>${b}`);
    for (const c of from.get(b) ?? []) {
      if (c === a) continue;
      const cut = walkLine(world, turnPoint(A, B, m.arrival), byId.get(c) as NavNode, m);
      if (cut) add({ ...cut, part: 'chord', index: index.get(b) as number, why: `${a} to ${b} to ${c}, turning ${m.arrival} m short of ${b}: ${cut.why}` }, `c:${a}>${b}>${c}`);
    }
  }
  return out;
}

export interface TraverseOptions {
  /** Seconds a step (default 1/30). */
  dt?: number;
  /** Seconds before giving up (default: four times what the route's length takes at the mover's speed, plus 5). */
  timeout?: number;
}
export interface TraverseResult {
  ok: boolean;
  /** `'arrived'`, or what stopped it: `'fell'`, `'blocked'`, `'headroom'`, `'wrong level'`, `'timeout'`. */
  why: string;
  /** The waypoint it was heading for when it stopped (the path's length when it arrived). */
  index: number;
  at: Point3;
  seconds: number;
  metres: number;
}

/**
 * A body walks the route: it heads straight for the next waypoint, counts as arrived within `arrival` of it in
 * plan, and turns there. Each step it is put on the surface under its centre; if there is none within its step
 * and drop, it fell. The same world and the same numbers as the game's own bot, with no rendering and no clock but
 * the one it counts, so a test can run it.
 */
export function traverse(world: WorldQuery, path: readonly Point3[], m: Mover, opts: TraverseOptions = {}): TraverseResult {
  const dt = opts.dt ?? 1 / 30;
  let length = 0;
  for (let i = 1; i < path.length; i += 1) length += Math.hypot((path[i] as Point3).x - (path[i - 1] as Point3).x, (path[i] as Point3).z - (path[i - 1] as Point3).z);
  const timeout = opts.timeout ?? (length / Math.max(1e-6, m.speed)) * 4 + 5;
  const start = path[0];
  if (!start) return { ok: false, why: 'the route is empty', index: 0, at: { x: 0, y: 0, z: 0 }, seconds: 0, metres: 0 };
  const s0 = world.standOn(start.x, start.y, start.z, m.step);
  let x = start.x; let z = start.z; let y = s0 ? s0.y : start.y; let k = 1; let t = 0; let metres = 0;
  const end = (ok: boolean, why: string): TraverseResult => ({ ok, why, index: k, at: { x, y, z }, seconds: t, metres });
  if (!s0 || s0.y < start.y - m.maxDrop) return end(false, 'fell');
  while (k < path.length) {
    const target = path[k] as Point3;
    const d = Math.hypot(target.x - x, target.z - z);
    if (d <= m.arrival) {
      // In plan it is there. On another level it is not: under a roof node is not on the roof.
      if (Math.abs(target.y - y) > m.step + m.arrival) return end(false, 'wrong level');
      k += 1; continue;
    }
    if (t >= timeout) return end(false, 'timeout');
    const len = Math.min(m.speed * dt, d);
    const nx = x + ((target.x - x) / d) * len; const nz = z + ((target.z - z) / d) * len;
    if (world.blocked(x, z, nx, nz, y + m.step, y + m.height, m.radius)) return end(false, 'blocked');
    const s = world.standOn(nx, y, nz, m.step);
    x = nx; z = nz; t += dt; metres += len;
    if (!s || s.y < y - m.maxDrop) return end(false, 'fell');
    y = s.y;
    if (s.ceiling - s.y < m.height) return end(false, 'headroom');
  }
  return end(true, 'arrived');
}
