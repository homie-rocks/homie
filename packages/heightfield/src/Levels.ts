/**
 * ============================================================================
 *  Levels — a structure with more than one floor, as data, and the world that
 *  answers "what is under, over and in the way of this point" for all of it.
 * ============================================================================
 *
 *  WHY A HEIGHT FIELD IS NOT ENOUGH. A field has one height for each (x, z).
 *  The moment a building can be entered there are two: the room and its roof.
 *  Every game that adds an enterable building then discovers the same list,
 *  one bug at a time: a figure indoors is lifted onto the roof; a figure on
 *  the roof walks through the ceiling it should have hit from below; a shot
 *  through the doorway stops at a wall that has a hole in it; a pickup dropped
 *  indoors lands on the roof; a bot is sent to "the node at (12, 4)" and there
 *  are two.
 *
 *  ── THE CONTRACT ───────────────────────────────────────────────────────────
 *  A `Structure` is five lists in the structure's own metres, y up:
 *
 *    floors      slabs: a rectangle, the height of its top, its thickness
 *                (the underside is the ceiling of whatever is below), and
 *                holes (a stairwell)
 *    walls       vertical rectangles between two points, from y0 to y1
 *    openings    a doorway or a window: a stretch of a wall that movement and
 *                rays pass through, between a sill and a head height
 *    connectors  how a body gets from one floor to another: a stair or a ramp
 *                (a sloping walkable strip with a width) or a door (no slope;
 *                it names the opening a route uses)
 *
 *  and a `Placement` puts it in a world. Nothing here draws anything: the same
 *  file can describe a building made of a dozen meshes or of one.
 *
 *  ── ONE ANSWER SHAPE FOR EVERY LEVEL ───────────────────────────────────────
 *  `surfacesAt(x, z)` returns EVERY surface a body could stand on over that
 *  point, lowest first, each with the ceiling above it. Everything else is
 *  read off that list, which is what stops the bugs above from being separate
 *  bugs: "which floor am I on" is the highest surface not above my feet,
 *  headroom is `ceiling - y`, and "where does a marker go" is every surface
 *  with room over it rather than the top one.
 *
 *  These queries allocate (a small array a call). They are for bots thinking a
 *  few times a second, for checks, and for capture scripts. A figure moving
 *  every frame should keep the surface it stands on and ask again when it
 *  leaves it.
 * ============================================================================
 */
import type { HeightField } from './Field.ts';
import { proxiesHit, proxiesRay, proxyName, proxyTop, type Proxy } from './Proxy.ts';

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** A slab. `y` is its TOP; `y - thickness` is the ceiling of what is beneath it. */
export interface Floor extends Rect {
  id: string;
  /** A label for grouping (0 the ground floor, 1 the next, a roof last). Two slabs may share one. */
  level: number;
  y: number;
  thickness: number;
  /** Rectangles cut out of the slab: a stairwell, a hatch. */
  holes?: Rect[];
}
/** A vertical rectangle from `(x0, z0)` to `(x1, z1)`, between heights `y0` and `y1`. */
export interface Wall { id?: string; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }
/** A stretch of a wall that is open between a sill (`y0`) and a head (`y1`). It must lie along a wall. */
export interface Opening { id: string; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }
/** One end of a connector: a point, and the floor it is on (`'ground'` for the world's own ground). */
export interface ConnectorEnd { floor: string; x: number; y: number; z: number }
export interface Connector {
  id: string;
  /** `stair` and `ramp` are walkable strips between their ends; `door` is level and names a way through a wall. */
  kind: 'stair' | 'ramp' | 'door';
  from: ConnectorEnd;
  to: ConnectorEnd;
  /** Metres across. A body wider than this does not fit. */
  width: number;
}
export interface Structure {
  v: 1;
  units: 'metres';
  floors: Floor[];
  walls: Wall[];
  openings: Opening[];
  connectors: Connector[];
}
/** Where a structure stands in the world: its origin, and a turn about the vertical (a three.js `rotation.y`). */
export interface Placement { x: number; y: number; z: number; yaw: number }

/** One thing a body could stand on over a point. */
export interface Surface {
  /** Height of the surface, world metres. */
  y: number;
  /** Height of whatever is next above it, or `Infinity` under open sky. `ceiling - y` is the headroom. */
  ceiling: number;
  /** `'ground'`, a floor's id, a connector's id, or a proxy's name. */
  id: string;
  level: number;
  kind: 'ground' | 'floor' | 'connector' | 'proxy';
}

/** What the route, marker and pose modules ask of a world. A game with its own collision can implement this. */
export interface WorldQuery {
  /** Every standable surface over `(x, z)`, lowest first. */
  surfacesAt(x: number, z: number): Surface[];
  /** The surface a body with its feet at `y` is on: the highest one no more than `step` above its feet. */
  standOn(x: number, y: number, z: number, step: number): Surface | null;
  /**
   * What stops a body moving from one point to another (a wall's or a proxy's name), or null. `y0` and `y1` are
   * the bottom and top of its solid part: feet plus step, and feet plus height.
   */
  blocked(xa: number, za: number, xb: number, zb: number, y0: number, y1: number, radius?: number): string | null;
  /** Distance along a ray to the first solid thing, in multiples of the direction, or `Infinity`. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
  /** Why a body standing with its feet at `(x, y, z)` overlaps something solid, or null when it does not. */
  solidAt(x: number, y: number, z: number, radius: number, height: number, step: number): string | null;
}

export interface WorldOptions {
  /** The world's own ground. Without one, only structures and proxies can be stood on. */
  ground?: HeightField;
  proxies?: readonly Proxy[];
  structures?: readonly { structure: Structure; at?: Placement }[];
  /** Metres between samples when a ray is marched over the ground (default 0.25). */
  rayStep?: number;
}

const EPS = 0.01;
const inRect = (r: Rect, x: number, z: number): boolean => x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && z >= Math.min(r.z0, r.z1) && z <= Math.max(r.z0, r.z1);
const onFloor = (f: Floor, x: number, z: number): boolean => inRect(f, x, z) && !(f.holes ?? []).some((h) => inRect(h, x, z));

/** Where along a segment a point projects (0 to 1, unclamped) and how far to the side of it, in metres. */
function project(x0: number, z0: number, x1: number, z1: number, x: number, z: number): { t: number; side: number; len: number } {
  const ex = x1 - x0; const ez = z1 - z0; const len = Math.hypot(ex, ez);
  if (len < 1e-9) return { t: 0, side: Math.hypot(x - x0, z - z0), len: 0 };
  const t = ((x - x0) * ex + (z - z0) * ez) / (len * len);
  return { t, side: Math.abs((x - x0) * ez - (z - z0) * ex) / len, len };
}

/** Where two segments cross, as the fraction along the first, or -1. */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const rx = bx - ax; const rz = bz - az; const sx = dx - cx; const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den; const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** Whether a point on a wall is inside an opening that an interval of heights fits through, `margin` from its jambs. */
function throughOpening(s: Structure, x: number, z: number, y0: number, y1: number, margin: number): boolean {
  for (const o of s.openings) {
    const p = project(o.x0, o.z0, o.x1, o.z1, x, z);
    if (p.side > 0.06 || p.len <= 0) continue;
    const along = p.t * p.len;
    if (along >= margin - 1e-9 && along <= p.len - margin + 1e-9 && y0 >= o.y0 - 1e-9 && y1 <= o.y1 + 1e-9) return true;
  }
  return false;
}

/** The height of a stair or a ramp under a point (structure space), or NaN when the point is not on it. */
function connectorY(c: Connector, x: number, z: number): number {
  if (c.kind === 'door') return NaN;
  const p = project(c.from.x, c.from.z, c.to.x, c.to.z, x, z);
  if (p.len <= 0 || p.t < 0 || p.t > 1 || p.side > c.width / 2) return NaN;
  return c.from.y + (c.to.y - c.from.y) * p.t;
}

/** Build the world. Every argument is optional; a world of nothing has no surface anywhere. */
export function createWorld(opts: WorldOptions = {}): WorldQuery {
  const ground = opts.ground ?? null;
  const proxies = opts.proxies ?? [];
  const placed = (opts.structures ?? []).map((p) => {
    const at = p.at ?? { x: 0, y: 0, z: 0, yaw: 0 };
    return { s: p.structure, at, c: Math.cos(at.yaw), n: Math.sin(at.yaw), level: new Map(p.structure.floors.map((f) => [f.id, f.level])) };
  });
  type Placed = (typeof placed)[number];
  const toX = (p: Placed, x: number, z: number): number => (x - p.at.x) * p.c - (z - p.at.z) * p.n;
  const toZ = (p: Placed, x: number, z: number): number => (x - p.at.x) * p.n + (z - p.at.z) * p.c;
  const rayStep = opts.rayStep ?? 0.25;

  function surfacesAt(x: number, z: number): Surface[] {
    const out: Surface[] = [];
    // [bottom, top] of everything solid over this point: what a surface's ceiling is read from.
    const solids: [number, number][] = [];
    if (ground) { const y = ground.heightAt(x, z); if (Number.isFinite(y)) out.push({ y, ceiling: Infinity, id: 'ground', level: 0, kind: 'ground' }); }
    for (const p of placed) {
      const ax = toX(p, x, z); const az = toZ(p, x, z);
      for (const f of p.s.floors) if (onFloor(f, ax, az)) {
        out.push({ y: f.y + p.at.y, ceiling: Infinity, id: f.id, level: f.level, kind: 'floor' });
        solids.push([f.y - f.thickness + p.at.y, f.y + p.at.y]);
      }
      for (const c of p.s.connectors) {
        const y = connectorY(c, ax, az);
        if (!Number.isNaN(y)) out.push({ y: y + p.at.y, ceiling: Infinity, id: c.id, level: p.level.get(c.from.floor) ?? 0, kind: 'connector' });
      }
    }
    proxies.forEach((q, i) => {
      const top = proxyTop(q, x, z);
      if (top === -Infinity) return;
      if (q.walkTop !== false) out.push({ y: top, ceiling: Infinity, id: proxyName(q, i), level: 0, kind: 'proxy' });
      solids.push([q.y, top]);
    });
    out.sort((a, b) => a.y - b.y);
    for (const s of out) for (const [bottom, top] of solids) {
      // Something whose top is above this surface is over it; if its bottom is not, the surface is INSIDE it and
      // has no headroom at all (ground under a crate, terrain poking up into a slab).
      if (top > s.y + EPS) s.ceiling = Math.min(s.ceiling, Math.max(bottom, s.y));
    }
    return out;
  }

  function standOn(x: number, y: number, z: number, step: number): Surface | null {
    let best: Surface | null = null;
    for (const s of surfacesAt(x, z)) if (s.y <= y + step + 1e-9) best = s;
    return best;
  }

  function blocked(xa: number, za: number, xb: number, zb: number, y0: number, y1: number, radius = 0): string | null {
    // The body's leading edge, not its centre, is what meets a wall head-on.
    const d = Math.hypot(xb - xa, zb - za);
    const ex = d > 1e-9 ? xb + ((xb - xa) / d) * radius : xb; const ez = d > 1e-9 ? zb + ((zb - za) / d) * radius : zb;
    for (const p of placed) {
      const ax = toX(p, xa, za); const az = toZ(p, xa, za); const bx = toX(p, ex, ez); const bz = toZ(p, ex, ez);
      const l0 = y0 - p.at.y; const l1 = y1 - p.at.y;
      for (let i = 0; i < p.s.walls.length; i += 1) {
        const w = p.s.walls[i] as Wall;
        if (l1 <= w.y0 || l0 >= w.y1) continue;
        const t = cross(ax, az, bx, bz, w.x0, w.z0, w.x1, w.z1);
        if (t < 0) continue;
        if (!throughOpening(p.s, ax + (bx - ax) * t, az + (bz - az) * t, l0, l1, radius)) return w.id ?? `wall ${i}`;
      }
    }
    const hit = proxiesHit(proxies, xb, zb, radius, y0, y1);
    return hit >= 0 ? proxyName(proxies[hit] as Proxy, hit) : null;
  }

  function ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = Infinity): number {
    let best = proxiesRay(proxies, ox, oy, oz, dx, dy, dz, maxT);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) return best;
    for (const p of placed) {
      const sx = toX(p, ox, oz); const sz = toZ(p, ox, oz); const sy = oy - p.at.y;
      const ex = toX(p, ox + dx, oz + dz) - sx; const ez = toZ(p, ox + dx, oz + dz) - sz;
      for (const w of p.s.walls) {
        const wx = w.x1 - w.x0; const wz = w.z1 - w.z0;
        const den = ex * wz - ez * wx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((w.x0 - sx) * wz - (w.z0 - sz) * wx) / den; const u = ((w.x0 - sx) * ez - (w.z0 - sz) * ex) / den;
        if (t <= 1e-9 || t >= best || t > maxT || u < 0 || u > 1) continue;
        const y = sy + dy * t;
        if (y < w.y0 || y > w.y1) continue;
        if (!throughOpening(p.s, sx + ex * t, sz + ez * t, y, y, 0)) best = t;
      }
      if (Math.abs(dy) > 1e-12) for (const f of p.s.floors) for (const plane of [f.y, f.y - f.thickness]) {
        const t = (plane - sy) / dy;
        if (t > 1e-9 && t < best && t <= maxT && onFloor(f, sx + ex * t, sz + ez * t)) best = t;
      }
    }
    if (ground) {
      // March, then close in on the crossing by halving: a field has no closed form for this.
      const far = Math.min(best, maxT, 4096 / len); const dt = rayStep / len;
      let prev = 0;
      for (let t = dt; t <= far + dt; t += dt) {
        const tt = Math.min(t, far);
        const g = ground.heightAt(ox + dx * tt, oz + dz * tt);
        if (Number.isFinite(g) && oy + dy * tt < g) {
          let lo = prev; let hi = tt;
          for (let k = 0; k < 12; k += 1) { const m = (lo + hi) / 2; if (oy + dy * m < ground.heightAt(ox + dx * m, oz + dz * m)) hi = m; else lo = m; }
          if (hi < best) best = hi;
          break;
        }
        prev = tt;
        if (tt >= far) break;
      }
    }
    return best <= maxT ? best : Infinity;
  }

  function solidAt(x: number, y: number, z: number, radius: number, height: number, step: number): string | null {
    const hit = proxiesHit(proxies, x, z, radius, y + step, y + height);
    if (hit >= 0) return `inside ${proxyName(proxies[hit] as Proxy, hit)}`;
    if (ground) { const g = ground.heightAt(x, z); if (Number.isFinite(g) && g > y + step) return `inside the ground (it is ${(g - y).toFixed(2)} m above the feet here)`; }
    for (const p of placed) {
      const ax = toX(p, x, z); const az = toZ(p, x, z); const l0 = y + step - p.at.y; const l1 = y + height - p.at.y;
      for (let i = 0; i < p.s.walls.length; i += 1) {
        const w = p.s.walls[i] as Wall;
        if (l1 <= w.y0 || l0 >= w.y1) continue;
        const q = project(w.x0, w.z0, w.x1, w.z1, ax, az);
        const t = Math.max(0, Math.min(1, q.t));
        const nx = w.x0 + (w.x1 - w.x0) * t; const nz = w.z0 + (w.z1 - w.z0) * t;
        if (Math.hypot(ax - nx, az - nz) < radius && !throughOpening(p.s, nx, nz, l0, l1, radius)) return `inside ${w.id ?? `wall ${i}`}`;
      }
    }
    const s = standOn(x, y, z, step);
    if (s && s.ceiling < y + height - 1e-9) return `under a ceiling ${(s.ceiling - y).toFixed(2)} m above the feet (the body is ${height} m)`;
    return null;
  }

  return { surfacesAt, standOn, blocked, ray, solidAt };
}

/**
 * Whether a body's whole footprint has something under it: the centre and eight points on its rim each stand on a
 * surface no more than `step` above and `drop` below `y`. One sample at the centre is how a body ends up balanced
 * on a roof edge with most of itself over the street.
 */
export function supported(world: WorldQuery, x: number, y: number, z: number, radius: number, step: number, drop: number): boolean {
  for (let i = -1; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const s = i < 0 ? world.standOn(x, y, z, step) : world.standOn(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, step);
    if (!s || s.y < y - drop) return false;
  }
  return true;
}

export interface StructureNeeds {
  /** Headroom a body needs, metres: every floor, opening and connector must have this much. */
  clearance: number;
  /** The body's radius, metres: an opening or a connector narrower than twice this does not fit it. */
  radius: number;
}

/**
 * What is wrong with a structure as authored, in sentences: an empty list when nothing is. It checks the things a
 * picture cannot show: ids that collide, a connector whose end is not on the floor it names, an opening that lies
 * on no wall, a doorway a body does not fit, a stair that comes up under a slab with no hole cut for it.
 */
export function checkStructure(s: Structure, needs: StructureNeeds): string[] {
  const out: string[] = [];
  if (s.v !== 1 || s.units !== 'metres') out.push('a structure is { v: 1, units: "metres", floors, walls, openings, connectors }');
  const ids = new Set<string>();
  const once = (id: string, what: string): void => { if (ids.has(id)) out.push(`${what} ${id}: that id is used twice`); ids.add(id); };
  for (const f of s.floors) {
    once(f.id, 'floor');
    if (!(f.thickness > 0)) out.push(`floor ${f.id}: thickness must be more than 0 (its underside is the ceiling below)`);
    if (f.x0 === f.x1 || f.z0 === f.z1) out.push(`floor ${f.id}: it has no area`);
  }
  for (const o of s.openings) {
    once(o.id, 'opening');
    const mx = (o.x0 + o.x1) / 2; const mz = (o.z0 + o.z1) / 2;
    const on = s.walls.some((w) => { const p = project(w.x0, w.z0, w.x1, w.z1, mx, mz); return p.side < 0.06 && p.t >= 0 && p.t <= 1; });
    if (!on) out.push(`opening ${o.id}: it lies on no wall, so it opens nothing`);
    if (o.y1 - o.y0 < needs.clearance) out.push(`opening ${o.id}: ${(o.y1 - o.y0).toFixed(2)} m high, and a body needs ${needs.clearance} m`);
    if (Math.hypot(o.x1 - o.x0, o.z1 - o.z0) < needs.radius * 2) out.push(`opening ${o.id}: ${Math.hypot(o.x1 - o.x0, o.z1 - o.z0).toFixed(2)} m wide, and a body is ${(needs.radius * 2).toFixed(2)} m`);
  }
  const world = createWorld({ structures: [{ structure: s }] });
  for (const f of s.floors) {
    // Headroom over the middle of the slab: the commonest authoring slip is two slabs closer than a body is tall.
    const x = (f.x0 + f.x1) / 2; const z = (f.z0 + f.z1) / 2;
    const here = world.surfacesAt(x, z).find((q) => q.id === f.id);
    if (here && here.ceiling - here.y < needs.clearance) out.push(`floor ${f.id}: ${(here.ceiling - here.y).toFixed(2)} m of headroom at its middle, and a body needs ${needs.clearance} m`);
  }
  for (const c of s.connectors) {
    once(c.id, 'connector');
    if (c.width < needs.radius * 2) out.push(`connector ${c.id}: ${c.width} m wide, and a body is ${(needs.radius * 2).toFixed(2)} m`);
    for (const [end, name] of [[c.from, 'from'], [c.to, 'to']] as const) {
      if (end.floor === 'ground') continue;
      const f = s.floors.find((q) => q.id === end.floor);
      if (!f) { out.push(`connector ${c.id}: its ${name} end names floor ${end.floor}, which is not in the structure`); continue; }
      if (Math.abs(f.y - end.y) > 0.05) out.push(`connector ${c.id}: its ${name} end is at ${end.y} m and floor ${f.id} is at ${f.y} m`);
      // The end may sit in the stairwell's hole, a step from the slab's edge: look a body's width around it.
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => onFloor(f, end.x + (dx as number) * needs.radius * 2, end.z + (dz as number) * needs.radius * 2));
      if (!near) out.push(`connector ${c.id}: its ${name} end is not on floor ${f.id} or within a body's width of it`);
    }
    if (c.kind === 'door') { if (Math.abs(c.from.y - c.to.y) > 0.05) out.push(`connector ${c.id}: a door is level; use a stair or a ramp for a change of height`); continue; }
    for (let i = 1; i < 8; i += 1) {
      const t = i / 8; const x = c.from.x + (c.to.x - c.from.x) * t; const z = c.from.z + (c.to.z - c.from.z) * t;
      const here = world.surfacesAt(x, z).find((q) => q.id === c.id);
      if (here && here.ceiling - here.y < needs.clearance) {
        out.push(`connector ${c.id}: ${(here.ceiling - here.y).toFixed(2)} m of headroom ${Math.round(t * 100)}% of the way up, and a body needs ${needs.clearance} m: cut a hole in the slab above it`);
        break;
      }
    }
  }
  return out;
}
