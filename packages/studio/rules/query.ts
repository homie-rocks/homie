/** Bounded, data-only ray policy. Shared by rules and predicted geometry queries. */
import { charge } from './guard.ts';
import { own, dir, vec3 } from './pack.ts';
import { castMap } from './math.ts';
import type { MapShapes } from './math.ts';
import { castMap3, castSolid, solidAt, type Solid } from './collision.ts';
import { REACH_M, type Vec3, type QueryDef } from './rules.ts';
import type { RayHit } from './types.ts';
export interface QueryTarget { at?: Vec3; id: string; kind: string; query?: QueryDef; fields: Record<string, unknown>; geometry: boolean; solid: Solid; parts?: readonly {name: string; solid: Solid}[] }
export function rayQuery(map: MapShapes, targets: readonly QueryTarget[], dims: number, from: unknown, direction: unknown, max: unknown, options?: unknown, self?: string, all = false): readonly RayHit[] {
  charge(32 + 8 * targets.length);
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0 || max > REACH_M) throw new Error(`ray reaches 0 to ${REACH_M} metres`);
  const p = vec3(from, dims), d = dir(direction,dims), delta = {x:d.x*max,y:d.y*max,z:d.z*max};
  const radiusOption=own(options,'radius'), shapeOption=own(options,'shape');
  const radius=radiusOption===undefined?0:radiusOption;
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<0||radius>100)throw new Error('ray.radius is 0 to 100 metres');
  if(shapeOption!==undefined && shapeOption!=='sphere' && shapeOption!=='box')throw new Error('ray.shape is sphere or box');
  const shape={shape:shapeOption==='box'?'box':'sphere',radius,height:2*radius};
  const start={x:p.x,y:p.y,z:p.z-radius};
  const ignore = own(options,'ignore');
  if (ignore !== undefined && (!Array.isArray(ignore) || ignore.length > 16)) throw new Error('ray.ignore holds at most 16 entity refs');
  const excluded = new Set<string>();
  if (Array.isArray(ignore)) for (let i=0;i<ignore.length;i++) { const id=own(ignore,i); if(typeof id!=='string') throw new Error('ray.ignore needs entity refs'); excluded.add(id); }
  if (self && own(options,'ignoreSelf') !== false) excluded.add(self);
  const profile=own(options,'profile');
  const layer=own(options,'layer'), kind=own(options,'kind'), tag=own(options,'tag');
  for(const v of [layer,kind,tag,profile]) if(v!==undefined && (typeof v!=='string' || v.length>32)) throw new Error('ray filters are short names');
  const where=own(options,'where');
  if(where!==undefined && (!where || typeof where!=='object' || Array.isArray(where))) throw new Error('ray.where is a field map');
  const keys=where ? Object.keys(where) : [];
  if(keys.length>16) throw new Error('ray.where holds at most 16 field tests');
  const hits: RayHit[]=[];
  const take=(h: {t:number;nx:number;ny:number;nz?:number}|null,id?:string,part?:string):void=>{
    if(!h)return; charge(32);
    if(h.t===0 && h.nx===0 && h.ny===0 && !h.nz)h={...h,nx:-d.x,ny:-d.y,nz:-d.z};
    hits.push(Object.freeze({at:vec3({x:p.x+delta.x*h.t,y:p.y+delta.y*h.t,z:p.z+delta.z*h.t},dims),normal:vec3({x:h.nx,y:h.ny,z:h.nz??0},dims),dist:max*h.t,...(id?{entity:id}:{}),...(part?{part}:{})}));
  };
  if(own(options,'entitiesOnly')!==true && (layer===undefined || layer==='geometry')) {
    if(dims===3) {const found: import('./collision.ts').Hit3[]=[];const h=castMap3(map,start,delta,shape,all?found:undefined,true);if(all)for(const h of found)take(h);else take(h);}
    else {const found: import('./math.ts').Hit[]=[];const h=castMap(map,p.x,p.y,delta.x,delta.y,radius,all?found:undefined,true,shape.shape==='box').hit;if(all)for(const h of found)take(h);else take(h);}
  }
  const point=solidAt(start,shape);
  for(const target of targets) {
    if(excluded.has(target.id) || own(options,'geometryOnly')===true&&!target.geometry || layer!==undefined && layer!==(target.query?.layer??(target.geometry?'geometry':'body')) || kind!==undefined && kind!==target.kind || tag!==undefined && !target.query?.tags?.includes(tag as string)) continue;
    let match=true;
    for(const key of keys) {
      charge(32); const actual=own(target.fields,key), condition=own(where,key);
      if(condition!==null && typeof condition==='object') {
        const operators=Object.keys(condition); if(operators.length>5)throw new Error('ray comparison holds at most five operators');
        for(const op of operators) {
          if(!['eq','gt','gte','lt','lte'].includes(op)) throw new Error('ray.where supports eq, gt, gte, lt, lte');
          const n=own(condition,op);
          if(op==='eq') {if(actual!==n)match=false;}
          else {if(typeof n!=='number'||!Number.isFinite(n))throw new Error('ray comparison needs a finite number');if(typeof actual!=='number'|| !(op==='gt'?actual>n:op==='gte'?actual>=n:op==='lt'?actual<n:actual<=n))match=false;}
        }
      } else if(actual!==condition)match=false;
    }
    if(!match)continue;
    const parts = target.at ? queryParts(target.at,target.query,profile as string | undefined) : target.parts;
    for(const part of own(options,'geometryOnly')!==true && parts?.length?parts:[{name:'',solid:target.solid}]) {
      const s=part.solid;
      const h=dims===3?castSolid(point,delta,s,true):castSolid(
        {...point,min:{...point.min,z:0},max:{...point.max,z:1}}, {...delta,z:0},
        {...s,min:{...s.min,z:-1},max:{...s.max,z:2}},true);

      take(h,target.id,part.name||undefined);
    }
  }
  charge(hits.length * (8 + Math.ceil(Math.log2(hits.length+1))));
  // Stable ties retain static-map order, then entity insertion order and declaration part order.
  hits.sort((a,b)=>a.dist-b.dist);
  return Object.freeze(all?hits:hits.slice(0,1));
}
export function queryParts(at: Vec3, query?: QueryDef, profile?: string): QueryTarget['parts'] {
  const parts=profile && query?.profiles?.[profile] ? query.profiles[profile] : query?.parts;
  if(!parts)return undefined;
  charge(24*Object.keys(parts).length);
  return Object.entries(parts).map(([name,p])=>({name,solid:solidAt({x:at.x+(p.offset?.x??0),y:at.y+(p.offset?.y??0),z:at.z+(p.offset?.z??0)},{shape:p.shape,radius:p.radius,height:p.height??2*p.radius})}));
}
