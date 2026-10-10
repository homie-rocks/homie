import { rayQuery, queryParts, type QueryTarget } from './query.ts';
import { overlapsTerrain } from './terrain.ts';
import { nearbyMap } from './map-index.ts';
/** Declared collision geometry, shared by authority and prediction. Entity fields
 * own its lifetime and dimensions; this projection contains no gameplay state. */
import type { Vec3, ColliderDef, QueryDef } from './rules.ts';
import type { MapShapes } from './math.ts';
import { charge, own } from './guard.ts';
import { castMap3, solidAt, type BodyShape } from './collision.ts';
import { sweepMap, rayBox, rayCircle } from './math.ts';

export type ColliderRow = [string, string, number, number, number, number, number, number, {kind: string; query?: QueryDef; fields: Record<string, number | string | boolean>}?];
export type CollisionRevision = [number, number, ColliderRow[]];
export function colliderRow(id: string, at: Vec3, body: BodyShape, def: ColliderDef, fields: Record<string, unknown>, kind?: string, query?: QueryDef): ColliderRow | null {
  const opts = def === true ? {} : def;
  if (opts.enabled && fields[opts.enabled] !== true) return null;
  const size = opts.size ? fields[opts.size] as Vec3 : null;
  const x = size ? size.x : body.radius * 2, y = size ? size.y : body.radius * 2, z = size ? size.z : body.height || body.radius * 2;
  if (![x, y, z].every(Number.isFinite) || x <= 0 || y <= 0 || z < 0) return null;
  const row: ColliderRow = [id, size ? 'box' : body.shape, at.x, at.y, at.z, x, y, z];
  if(kind) row.push({kind, ...(query?{query}:{}), fields:Object.fromEntries(Object.entries(fields).filter(([,v])=>['number','string','boolean'].includes(typeof v))) as Record<string,number|string|boolean>});
  return row;
}
export function colliderSolid(row: ColliderRow): ReturnType<typeof solidAt> {
  const [, shape, x, y, z, w, d, h] = row;
  return shape === 'box' ? { min: { x: x-w/2, y: y-d/2, z }, max: { x:x+w/2, y:y+d/2, z:z+h }, r:0 }
    : solidAt({x,y,z}, {shape, radius:w/2, height:h});
}
export function castCollider2(row: ColliderRow, p: Vec3, d: Vec3, radius: number) {
  const solid = colliderSolid(row);
  return row[1] === 'box' ? rayBox(p.x,p.y,d.x,d.y,solid.min,solid.max,radius) : rayCircle(p.x,p.y,d.x,d.y,row[2],row[3],row[5]/2+radius);
}
const rowsOf = new WeakMap<object, readonly ColliderRow[]>();
export function collisionTargets(map: MapShapes): QueryTarget[] {
  return (rowsOf.get(map) ?? []).map(row=>({id:row[0],kind:row[8]?.kind??'',query:row[8]?.query,fields:row[8]?.fields??{},geometry:true,solid:colliderSolid(row),parts:queryParts({x:row[2],y:row[3],z:row[4]},row[8]?.query)}));
}
export function collisionMap(map: MapShapes, rows: readonly ColliderRow[]): MapShapes {
  if (!rows.length) return map;
  const boxes: any[] = [], circles: any[] = [], spheres: any[] = [], capsules: any[] = [];
  for (const [id, shape, x, y, z, w, d, h] of rows) {
    const at = { x, y, z };
    if (shape === 'box') boxes.push({ min: { x: x - w / 2, y: y - d / 2, z }, max: { x: x + w / 2, y: y + d / 2, z: z + h }, id } as any);
    else if (shape === 'circle') circles.push({ at, r: w / 2, id } as any);
    else if (shape === 'sphere') spheres.push({ at: { x, y, z: z + w / 2 }, r: w / 2, id } as any);
    else capsules.push({ at, r: w / 2, height: h, id } as any);
  }
  const combined = { bounds: map.bounds, staticMap: map, boxes, circles, spheres, capsules };
  rowsOf.set(combined, rows);
  return combined;
}
/** Latest known revision at the requested tick. Unknown future edits are never
 * guessed: a later snapshot rebases the body and replays its pending inputs. */
export function revisionAt(history: readonly CollisionRevision[], tick: number): CollisionRevision | undefined {
  for (let i = history.length - 1; i >= 0; i--) if (history[i][1] <= tick) return history[i];
  return undefined;
}
export function collisionQueries(map: () => MapShapes, shape: () => BodyShape, dims: number): object {
  const position = (body: unknown): Vec3 => {
    const p = own(body, 'pos');
    const n = (k: string): number => { const v = own(p, k); return typeof v === 'number' && Number.isFinite(v) ? Math.fround(v) : 0; };
    return { x: n('x'), y: n('y'), z: n('z') };
  };
  return {
    ray: (from: unknown, direction: unknown, max: unknown, options?: unknown) => {const m=map();return rayQuery(m.staticMap??m,collisionTargets(m),dims,from,direction,max,options)[0];},
    rayAll: (from: unknown, direction: unknown, max: unknown, options?: unknown) => {const m=map();return rayQuery(m.staticMap??m,collisionTargets(m),dims,from,direction,max,options,undefined,true);},
    sweep: (body: unknown, delta: unknown) => sweepMap(map(), body, delta, shape().radius, dims, shape()),
    support: (body: unknown, distance: unknown = 0.002) => {
      charge(20);
      const p = position(body), m = map();
      const d = typeof distance === 'number' && Number.isFinite(distance) ? Math.max(0, Math.min(10000, distance)) : 0;
      if (dims === 2) return Object.freeze({ at: Object.freeze(p), normal: Object.freeze({ x: 0, y: 0, z: 1 }), dist: 0 });
      const h = castMap3(m, p, { x: 0, y: 0, z: -d }, shape());
      return h && h.nz > 0.5 ? Object.freeze({ at: Object.freeze({ ...p, z: p.z - d * h.t }), normal: Object.freeze({ x: h.nx, y: h.ny, z: h.nz }), dist: d * h.t, ...(h.id ? { entity: h.id } : {}) }) : undefined;
    },
    overlaps: (body: unknown) => {
      const p = position(body), s = shape(), a = solidAt(p, s), m = nearbyMap(map(), p, {x:0,y:0,z:0}, s.radius, s.height || 2*s.radius, dims);
      charge(20 + 8 * (m.boxes.length + m.circles.length + (m.spheres?.length ?? 0) + (m.capsules?.length ?? 0)));
      const overlap = (b: ReturnType<typeof solidAt>): boolean => {
        let sq = 0;
        for (const k of dims === 2 ? ['x', 'y'] as const : ['x', 'y', 'z'] as const) { const gap = Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]); sq += gap * gap; }
        return sq < (a.r + b.r) ** 2 || a.r + b.r === 0 && a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y && (dims === 2 || a.min.z < b.max.z && a.max.z > b.min.z);
      };
      return (m.heightTiles ?? []).some(t => t.base !== undefined && overlapsTerrain(t, a)) || m.boxes.some(b => overlap({ ...b, r: 0 })) || m.circles.some(b => overlap({ min: {...b.at,z:m.bounds.min.z}, max: {...b.at,z:m.bounds.max.z}, r: b.r })) || (m.spheres ?? []).some(b => overlap({ min: b.at, max: b.at, r: b.r })) || (m.capsules ?? []).some(b => overlap(solidAt(b.at, { shape: 'capsule', radius: b.r, height: b.height })));
    },
  };
}
