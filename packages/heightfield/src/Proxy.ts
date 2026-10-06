/**
 * ============================================================================
 *  Proxy — a collider somebody AUTHORED: a box, a cylinder or a ramp, in
 *  metres, beside the model it stands in for.
 * ============================================================================
 *
 *  A sampled grid (`MeshBake.ts`) is right for a surface a figure walks over
 *  and wrong for a thing a figure walks AROUND: a crate, a pillar, a cover
 *  wall. Those are three numbers and a turn, they are cheaper to test than any
 *  grid, and a person can read them in a file and see that the cover wall is
 *  1.2 m high. So they are authored, not derived.
 *
 *  ── THE THREE QUESTIONS ────────────────────────────────────────────────────
 *    `proxyTop`      how high is its top here (to stand on it)?
 *    `proxiesHit`    does a standing body overlap one (to refuse the spot)?
 *    `proxiesRay`    how far along this ray is the first one (shots, cameras)?
 *
 *  ── CONVENTIONS, ALL OF THEM ───────────────────────────────────────────────
 *  `x, y, z` is the centre of the BASE: a proxy sits on `y` and rises `h`.
 *  `yaw` is radians about the vertical with the same sense as a three.js
 *  `rotation.y`, so the numbers in a file can be given to a mesh unchanged.
 *  A ramp rises from `y` at its local -z edge to `y + h` at its local +z edge.
 *  A ray treats a ramp as its bounding box: a shot fired over the low end of a
 *  ramp stops a little early, and a camera never ends up inside one.
 * ============================================================================
 */

interface ProxyBase {
  /** A name for reports ("north cover wall"). */
  id?: string;
  /** Centre of the base, metres. */
  x: number; y: number; z: number;
  /** Height above the base, metres. */
  h: number;
  /** May a figure stand on top? Default true. A railing says false. */
  walkTop?: boolean;
}
export interface BoxProxy extends ProxyBase { kind: 'box'; hx: number; hz: number; yaw?: number }
export interface CylinderProxy extends ProxyBase { kind: 'cylinder'; r: number }
export interface RampProxy extends ProxyBase { kind: 'ramp'; hx: number; hz: number; yaw?: number }
export type Proxy = BoxProxy | CylinderProxy | RampProxy;

/** Local x of a world point in a proxy's frame (the inverse of a three.js `rotation.y`). */
const lx = (p: Proxy, x: number, z: number): number => {
  const yaw = p.kind === 'cylinder' ? 0 : p.yaw ?? 0;
  return (x - p.x) * Math.cos(yaw) - (z - p.z) * Math.sin(yaw);
};
const lz = (p: Proxy, x: number, z: number): number => {
  const yaw = p.kind === 'cylinder' ? 0 : p.yaw ?? 0;
  return (x - p.x) * Math.sin(yaw) + (z - p.z) * Math.cos(yaw);
};

/** A name for a report. */
export const proxyName = (p: Proxy, i: number): string => p.id ?? `${p.kind} ${i}`;

/** The height of a proxy's top over `(x, z)`, or `-Infinity` outside its plan. */
export function proxyTop(p: Proxy, x: number, z: number): number {
  if (p.kind === 'cylinder') return Math.hypot(x - p.x, z - p.z) <= p.r ? p.y + p.h : -Infinity;
  const ax = lx(p, x, z); const az = lz(p, x, z);
  if (Math.abs(ax) > p.hx || Math.abs(az) > p.hz) return -Infinity;
  return p.kind === 'ramp' ? p.y + p.h * ((az + p.hz) / (2 * p.hz)) : p.y + p.h;
}

/**
 * Whether a standing body overlaps one proxy: a disc of `r` at `(x, z)` whose solid part runs from `y0` to `y1`.
 * Pass `y0` as the feet plus the step the body can climb, so a kerb under the step height is not a wall.
 */
export function proxyOverlaps(p: Proxy, x: number, z: number, r: number, y0: number, y1: number): boolean {
  if (y1 <= p.y) return false;
  if (p.kind === 'cylinder') return y0 < p.y + p.h && Math.hypot(x - p.x, z - p.z) < p.r + r;
  const ax = lx(p, x, z); const az = lz(p, x, z);
  // The nearest point of the plan rectangle to the disc's centre: the disc overlaps when that point is inside it.
  const nx = Math.max(-p.hx, Math.min(p.hx, ax)); const nz = Math.max(-p.hz, Math.min(p.hz, az));
  if (Math.hypot(ax - nx, az - nz) >= r) return false;
  const top = p.kind === 'ramp' ? p.y + p.h * ((Math.min(p.hz, az + r) + p.hz) / (2 * p.hz)) : p.y + p.h;
  return y0 < top;
}

/** The first proxy a standing body overlaps, or -1. */
export function proxiesHit(list: readonly Proxy[], x: number, z: number, r: number, y0: number, y1: number): number {
  for (let i = 0; i < list.length; i += 1) if (proxyOverlaps(list[i] as Proxy, x, z, r, y0, y1)) return i;
  return -1;
}

/**
 * Distance along a ray to the first proxy, or `Infinity`. The direction need not be unit length: the answer is in
 * multiples of it, so with a unit direction it is metres.
 */
export function proxiesRay(list: readonly Proxy[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = Infinity): number {
  let best = Infinity;
  for (const p of list) {
    // Vertical extent first: it is the same slab for every kind.
    let t0 = 0; let t1 = Math.min(maxT, best);
    if (Math.abs(dy) < 1e-12) { if (oy < p.y || oy > p.y + p.h) continue; } else {
      const a = (p.y - oy) / dy; const b = (p.y + p.h - oy) / dy;
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) continue;
    }
    if (p.kind === 'cylinder') {
      const fx = ox - p.x; const fz = oz - p.z;
      const a = dx * dx + dz * dz; const b = 2 * (fx * dx + fz * dz); const c = fx * fx + fz * fz - p.r * p.r;
      if (a < 1e-12) { if (c > 0) continue; } else {
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        t0 = Math.max(t0, (-b - sq) / (2 * a)); t1 = Math.min(t1, (-b + sq) / (2 * a));
        if (t0 > t1) continue;
      }
    } else {
      const sx = lx(p, ox, oz); const sz = lz(p, ox, oz);
      const ex = lx(p, ox + dx, oz + dz) - sx; const ez = lz(p, ox + dx, oz + dz) - sz;
      let miss = false;
      for (const [s, e, half] of [[sx, ex, p.hx], [sz, ez, p.hz]] as const) {
        if (Math.abs(e) < 1e-12) { if (Math.abs(s) > half) { miss = true; break; } continue; }
        const a = (-half - s) / e; const b = (half - s) / e;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) { miss = true; break; }
      }
      if (miss) continue;
    }
    if (t0 < best) best = t0;
  }
  return best <= maxT ? best : Infinity;
}

/** What is wrong with a list of proxies as authored: an empty list when nothing is. */
export function checkProxies(list: readonly Proxy[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((p, i) => {
    const name = proxyName(p, i);
    for (const k of ['x', 'y', 'z', 'h'] as const) if (!Number.isFinite(p[k])) out.push(`${name}: ${k} is not a number`);
    if (!(p.h > 0)) out.push(`${name}: h (its height in metres) must be more than 0`);
    if (p.kind === 'cylinder') { if (!(p.r > 0)) out.push(`${name}: r (its radius in metres) must be more than 0`); }
    else if (p.kind === 'box' || p.kind === 'ramp') { if (!(p.hx > 0) || !(p.hz > 0)) out.push(`${name}: hx and hz (half its width and depth, metres) must be more than 0`); }
    else out.push(`${name}: kind is box, cylinder or ramp`);
    if (p.id !== undefined) { if (seen.has(p.id)) out.push(`${name}: two proxies have this id`); seen.add(p.id); }
  });
  return out;
}
