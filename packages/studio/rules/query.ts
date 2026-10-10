/** Bounded, data-only ray policy. Shared by rules and predicted geometry queries. */
import { charge, brand, plainData, put } from './guard.ts';
import { own, dir, vec3 } from './pack.ts';
import { castMap } from './math.ts';
import type { MapShapes } from './math.ts';
import { castMap3, castSolid, solidAt, type Solid } from './collision.ts';
import { RAY_REACH_M, type Vec3, type QueryDef } from './rules.ts';
import type { RayHit } from './types.ts';
export interface QueryTarget { at?: Vec3; id: string; kind: string; query?: QueryDef; fields: Record<string, unknown>; geometry: boolean; solid: Solid; parts?: readonly {name: string; solid: Solid}[] }
export function rayQuery(map: MapShapes, targets: readonly QueryTarget[], dims: number, from: unknown, direction: unknown, max: unknown, options?: unknown, self?: string, all = false, includeInside=true): readonly RayHit[] {
  charge(32 + 8 * targets.length);
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0 || max > RAY_REACH_M) throw new Error(`ray reaches 0 to ${RAY_REACH_M} metres`);
  const p = vec3(from, dims), d = dir(direction,dims), delta = {x:d.x*max,y:d.y*max,z:d.z*max};
  const radiusOption=own(options,'radius'), shapeOption=own(options,'shape');
  const radius=radiusOption===undefined?0:radiusOption;
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<0||radius>100)throw new Error('ray.radius is 0 to 100 metres');
  if(shapeOption!==undefined && !['sphere','box','capsule'].includes(shapeOption as string))throw new Error('ray.shape is sphere, box or capsule');
  const heightOption=own(options,'height'),height=heightOption===undefined?2*radius:heightOption;
  if(typeof height!=='number'||!Number.isFinite(height)||height<2*radius||height>200)throw new Error('ray.height is at least twice its radius and at most 200 metres');
  const shape={shape:shapeOption==='box'?'box':shapeOption==='capsule'?'capsule':'sphere',radius,height:shapeOption==='sphere'||shapeOption===undefined?2*radius:height};
  const start={x:p.x,y:p.y,z:p.z-shape.height/2};
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
    if(dims===3) {const found: import('./collision.ts').Hit3[]=[];const h=castMap3(map,start,delta,shape,all?found:undefined,includeInside);if(all)for(const h of found)take(h);else take(h);}
    else {const found: import('./math.ts').Hit[]=[];const h=castMap(map,p.x,p.y,delta.x,delta.y,radius,all?found:undefined,includeInside,shape.shape==='box').hit;if(all)for(const h of found)take(h);else take(h);}
  }
  const point=solidAt(start,shape);
  for(const target of targets) {
    if(excluded.has(target.id) || own(options,'geometryOnly')===true&&!target.geometry || layer!==undefined && layer!==(target.query?.layer??(target.geometry?'geometry':'body')) || kind!==undefined && kind!==target.kind || tag!==undefined && !target.query?.tags?.includes(tag as string)) continue;
    const declared = target.at ? queryParts(target.at,target.query,profile as string | undefined) : target.parts;
    const parts=(own(options,'geometryOnly')!==true && declared?.length?declared:[{name:'',solid:target.solid}]).filter(part=>{
      charge(12);let near=0,far=1;const radius=point.r+part.solid.r;
      for(const k of dims===3?['x','y','z'] as const:['x','y'] as const){const lo=part.solid.min[k]-point.max[k]-radius,hi=part.solid.max[k]-point.min[k]+radius,v=delta[k];if(v===0){if(lo>1e-9||hi< -1e-9)return false;}else{let a=lo/v,b=hi/v;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far+1e-9)return false;}}
      return true;
    });
    if(!parts.length)continue;
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
    for(const part of parts) {
      const s=part.solid;
      const h=dims===3?castSolid(point,delta,s,includeInside):castSolid(
        {...point,min:{...point.min,z:0},max:{...point.max,z:1}}, {...delta,z:0},
        {...s,min:{...s.min,z:-1},max:{...s.max,z:2}},includeInside);

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

/** A handler-local immutable query scene. Target construction is paid once;
 * every individual ray still pays for its candidates and geometry traversal. */
export function raySnapshot(map:MapShapes,targets:readonly QueryTarget[],dims:number,options:unknown,self?:string){
 const policy=plainData(options??{}, {n:1024}, 6);
 const scene=targets.map(t=>{charge(24+4*Object.keys(t.fields).length);return {...t,at:t.at?{...t.at}:undefined,fields:Object.fromEntries(Object.entries(t.fields).filter(([,v])=>typeof v==='number'||typeof v==='string'||typeof v==='boolean'))};});
 const ray=(from:unknown,direction:unknown,max:unknown)=>rayQuery(map,scene,dims,from,direction,max,policy,self)[0];
 const radius=typeof own(policy,'radius')==='number'?own(policy,'radius') as number:0,height=own(policy,'shape')==='box'||own(policy,'shape')==='capsule'?Number(own(policy,'height')??radius*2):radius*2;
 const position=(body:unknown)=>{const at=own(body,'pos');if(!at||typeof at!=='object')throw new Error('scene sweep/support takes a scratch body with a plain pos');return vec3(at,dims);};
 const support=(body:unknown,distance:unknown=.002)=>{const p=position(body);if(dims===2)return Object.freeze({at:p,normal:Object.freeze({x:0,y:0,z:1}),dist:0});if(typeof distance!=='number'||!Number.isFinite(distance)||distance<0)throw new Error('support distance is finite and nonnegative');const h=rayQuery(map,scene,dims,{x:p.x,y:p.y,z:p.z+height/2},{x:0,y:0,z:-1},distance,policy,self,false,false)[0];return h&&h.normal.z>.5?Object.freeze({...h,at:vec3({x:h.at.x,y:h.at.y,z:(h.at.z??0)-height/2},dims)}):undefined;};
 const sweep=(body:unknown,delta:unknown)=>{const p=position(body),d=vec3(delta,dims),length=Math.sqrt(d.x*d.x+d.y*d.y+d.z*d.z),h=length?rayQuery(map,scene,dims,{x:p.x,y:p.y,z:p.z+height/2},d,length,policy,self,false,false)[0]:undefined;
   const fraction=h?Math.max(0,(h.dist-.001)/length):1;put(body as object,'pos',vec3({x:p.x+d.x*fraction,y:p.y+d.y*fraction,z:p.z+d.z*fraction},dims));put(body as object,'grounded',dims===2||Boolean(support(body)));return h?Object.freeze({...h,at:vec3(own(body,'pos'),dims)}):undefined;};
 return brand(Object.freeze({ray,rayAll:(from:unknown,direction:unknown,max:unknown)=>rayQuery(map,scene,dims,from,direction,max,policy,self,true),sweep,support}));
}
