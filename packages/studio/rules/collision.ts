import { castTerrain } from './terrain.ts';
import { nearbyMap } from './map-index.ts';
/** Upright 3D collision. Positions are feet; a rounded box is a box plus a sphere.
 * Capsules are a vertical segment plus a sphere. No engine-specific maths or time.
 */
import { charge } from './guard.ts';
import type { Vec3, MapBox, MapCircle, MapHeightTile } from './rules.ts';

export interface BodyShape { shape: string; radius: number; height: number }
export interface Solid { min: Vec3; max: Vec3; r: number }
export interface Hit3 { t: number; nx: number; ny: number; nz: number; id?: string }
export interface Map3 {
  staticMap?: Map3;
  bounds: MapBox; boxes: readonly MapBox[]; circles: readonly MapCircle[];
  heightTiles?: readonly MapHeightTile[];
  spheres?: readonly MapCircle[];
  capsules?: readonly (MapCircle & { height: number })[];
}
const EPS = 1e-7;
const point = (x: number, y: number, z: number): {x: number; y: number; z: number} => ({ x, y, z });
export function solidAt(at: Vec3, body: BodyShape): Solid {
  const r = body.radius, height = body.height || 2 * r;
  if (body.shape === 'box') return { min: point(at.x - r, at.y - r, at.z), max: point(at.x + r, at.y + r, at.z + height), r: 0 };
  return { min: point(at.x, at.y, at.z + r), max: point(at.x, at.y, at.z + (body.shape === 'sphere' ? r : height - r)), r };
}
/** Closest vector between the cores of two rounded boxes. At most one core has
 * horizontal extent, except box/box, so this represents all supported pairs exactly.
 */
function separation(a: Solid, b: Solid, d: Vec3, t: number): Vec3 {
  const gap = (lo: number, hi: number, min: number, max: number): number => lo > max ? lo - max : hi < min ? hi - min : 0;
  return point(gap(a.min.x + d.x * t, a.max.x + d.x * t, b.min.x, b.max.x), gap(a.min.y + d.y * t, a.max.y + d.y * t, b.min.y, b.max.y), gap(a.min.z + d.z * t, a.max.z + d.z * t, b.min.z, b.max.z));
}
/** Continuous convex cast: each separating plane gives a lower bound on impact.
 * Every iteration is charged, and a fixed cap bounds grazing contacts as well.
 */
export function castSolid(a: Solid, d: Vec3, b: Solid): Hit3 | null {
  charge(30);
  let t = 0;
  const r = a.r + b.r;
  let normal = point(0, 0, 0);
  // Sharp boxes need the slab test: their closest vector vanishes at a face.
  if (r === 0) {
    let enter = 0, leave = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const lo = b.min[axis] - a.max[axis], hi = b.max[axis] - a.min[axis], v = d[axis];
      if (v === 0) { if (lo >= 0 || hi <= 0) return null; continue; }
      const near = (v > 0 ? lo : hi) / v, far = (v > 0 ? hi : lo) / v;
      if (near >= enter) { enter = near; normal = point(0, 0, 0); normal[axis] = v > 0 ? -1 : 1; }
      leave = Math.min(leave, far);
      if (enter > leave) return null;
    }
    return enter >= 0 && enter <= 1 && normal.x + normal.y + normal.z !== 0 ? { t: enter, nx: normal.x, ny: normal.y, nz: normal.z } : null;
  }
  for (let i = 0; i < 32; i++) {
    charge(24);
    const s = separation(a, b, d, t), length = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    const distance = length - r;
    // Let an initially overlapping body escape. Placements are not collision moves.
    if (i === 0 && distance < -EPS) return null;
    if (length > 0) normal = point(s.x / length, s.y / length, s.z / length);
    const approach = -(normal.x * d.x + normal.y * d.y + normal.z * d.z);
    if (approach <= EPS) return null;
    if (distance <= EPS) return { t, nx: normal.x, ny: normal.y, nz: normal.z };
    t += distance / approach;
    if (t > 1) return null;
  }
  // At the iteration cap, stop conservatively on the separating plane.
  return { t, nx: normal.x, ny: normal.y, nz: normal.z };
}
/** Height tiles support a body's foot point. Each tile is split along its
 * 00–11 diagonal; unlike bilinear sampling each half has a constant slope and
 * the sweep has an exact intersection. Borders are open, so a body can walk off.
 */
function castHeightTile(tile: MapHeightTile, p: Vec3, d: Vec3): Hit3 | null {
  charge(80);
  const [h00, h10, h01, h11] = tile.heights, sx = tile.size.x, sy = tile.size.y;
  const x = p.x - tile.at.x, y = p.y - tile.at.y;
  let best: Hit3 | null = null;
  for (const half of [0, 1]) {
    const alternate = tile.diagonal === '10-01';
    const gx = half === 0 ? (h10 - h00) / sx : (h11 - h01) / sx;
    const gy = alternate ? (half === 0 ? h01 - h00 : h11 - h10) / sy : (half === 0 ? h11 - h10 : h01 - h00) / sy;
    const base = alternate && half === 1 ? h10 + h01 - h11 : h00;
    const gap = p.z - tile.at.z - base - gx * x - gy * y;
    const closing = gx * d.x + gy * d.y - d.z;
    if (gap < -EPS || closing <= EPS) continue;
    const t = Math.max(0, gap / closing);
    if (t > 1 || best && t >= best.t) continue;
    const u = (x + d.x * t) / sx, v = (y + d.y * t) / sy;
    if (u < -EPS || u > 1 + EPS || v < -EPS || v > 1 + EPS || (alternate ? (half === 0 ? u + v > 1 + EPS : u + v < 1 - EPS) : (half === 0 ? v > u + EPS : u > v + EPS))) continue;
    const length = Math.sqrt(gx * gx + gy * gy + 1);
    best = { t, nx: -gx / length, ny: -gy / length, nz: 1 / length };
  }
  return best;
}

export function castMap3(map: Map3, p: Vec3, d: Vec3, body: BodyShape): Hit3 | null {
  map = nearbyMap(map, p, d, body.radius, body.height || body.radius * 2);
  charge(24);
  const a = solidAt(p, body), r = body.radius, height = body.height || r * 2;
  let best: Hit3 | null = null;
  const take = (h: Hit3 | null, id?: string): void => { if (h && h.t >= 0 && h.t <= 1 && (!best || h.t < best.t)) best = id ? {...h, id} : h; };
  for (const axis of ['x', 'y', 'z'] as const) {
    const low = map.bounds.min[axis] + (axis === 'z' ? 0 : r);
    const high = map.bounds.max[axis] - (axis === 'z' ? height : r);
    if (d[axis] === 0) continue;
    const n = point(0, 0, 0); n[axis] = d[axis] > 0 ? -1 : 1;
    take({ t: ((d[axis] > 0 ? high : low) - p[axis]) / d[axis], nx: n.x, ny: n.y, nz: n.z });
  }
  for (const tile of map.heightTiles ?? []) take(tile.base === undefined ? castHeightTile(tile, p, d) : castTerrain(tile, a, d));
  for (const b of map.boxes) take(castSolid(a, d, { ...b, r: 0 }), (b as any).id);
  // Legacy map circles are vertical columns in a 3D map.
  for (const c of map.circles) take(castSolid(a, d, { min: point(c.at.x, c.at.y, map.bounds.min.z - r), max: point(c.at.x, c.at.y, map.bounds.max.z + r), r: c.r }), (c as any).id);
  for (const s of map.spheres ?? []) take(castSolid(a, d, { min: s.at, max: s.at, r: s.r }), (s as any).id);
  for (const c of map.capsules ?? []) take(castSolid(a, d, solidAt(c.at, { shape: 'capsule', radius: c.r, height: c.height })), (c as any).id);
  return best;
}
export function restsOnMap(map: Map3, p: Vec3, body: BodyShape): boolean {
  const h = castMap3(map, p, point(0, 0, -0.002), body);
  return Boolean(h && h.nz > 0.5);
}
