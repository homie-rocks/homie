import { imageOffsets } from './topology.mjs';
/** Immutable build-time BVH. Queries charge nodes visited and narrow-phase work,
 * never the number of shapes in the level. Live geometry is a separate overlay. */
import { charge } from './guard.ts';
import type { MapShapes } from './math.ts';
import type { Vec3 } from './rules.ts';
type Key = 'boxes' | 'circles' | 'spheres' | 'capsules' | 'heightTiles';
type Entry = { key: Key; value: any; min: Vec3; max: Vec3; order: number };
type Node = { min: Vec3; max: Vec3; left?: Node; right?: Node; entries?: Entry[] };
const indexes = new WeakMap<object, Node>();
const axes = ['x','y','z'] as const;
export function indexMap(map: MapShapes): void {
  const entries: Entry[] = [];
  for (const key of ['boxes','circles','spheres','capsules','heightTiles'] as const) for (const value of map[key] ?? []) {
    const v:any=value; let min:Vec3,max:Vec3;
    if(key==='boxes') { min=v.min;max=v.max; }
    else if(key==='heightTiles') { min={...v.at,z:v.at.z+Math.min(v.base??Infinity,...v.heights)};max={x:v.at.x+v.size.x,y:v.at.y+v.size.y,z:v.at.z+Math.max(...v.heights)}; }
    else { min={x:v.at.x-v.r,y:v.at.y-v.r,z:key==='circles'?-Infinity:key==='capsules'?v.at.z:v.at.z-v.r};max={x:v.at.x+v.r,y:v.at.y+v.r,z:key==='circles'?Infinity:key==='capsules'?v.at.z+v.height:v.at.z+v.r}; }
    entries.push({key,value,min,max,order:entries.length});
  }
  function build(es:Entry[]):Node {
    const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
    for(const e of es)for(const k of axes){min[k]=Math.min(min[k],e.min[k]);max[k]=Math.max(max[k],e.max[k]);}
    if(es.length<=8)return {min,max,entries:es};
    // Choose the widest finite axis; unbounded columns still split horizontally.
    let k: 'x' | 'y' | 'z' = max.x-min.x>=max.y-min.y?'x':'y';
    if(Number.isFinite(max.z-min.z) && max.z-min.z>max[k]-min[k])k='z';
    es.sort((a,b)=>(a.min[k]+a.max[k])-(b.min[k]+b.max[k])||a.order-b.order);
    const mid=es.length>>1;return {min,max,left:build(es.slice(0,mid)),right:build(es.slice(mid))};
  }
  indexes.set(map,build(entries));
}
/** The segment of a body's reference point against bounds expanded by its extents. */
export function nearbyMap(map: MapShapes, p:Vec3, d:Vec3, radius:number, height:number, dims=3):MapShapes {
  if (!map.wrap) return nearbyFlatMap(map,p,d,radius,height,dims);
  const bounds={min:{...map.bounds.min},max:{...map.bounds.max}};
  for(const k of axes)if(map.wrap[k]){bounds.min[k]=-Infinity;bounds.max[k]=Infinity;}
  const out:any={bounds,boxes:[],circles:[],spheres:[],capsules:[],heightTiles:[]};
  const extent={min:{...map.bounds.min},max:{...map.bounds.max}};
  const root=indexes.get(map.staticMap??map);
  if(root) for(const k of axes){if(Number.isFinite(root.min[k]))extent.min[k]=Math.min(extent.min[k],root.min[k]);if(Number.isFinite(root.max[k]))extent.max[k]=Math.max(extent.max[k],root.max[k]);}
  if(map.staticMap)for(const key of ['boxes','circles','spheres','capsules'] as const)for(const raw of map[key]??[]){
    charge(12);const v:any=raw;
    for(const k of axes){const low=key==='boxes'?v.min[k]:v.at[k]-v.r,high=key==='boxes'?v.max[k]:v.at[k]+(k==='z'&&key==='capsules'?v.height:v.r);extent.min[k]=Math.min(extent.min[k],low);extent.max[k]=Math.max(extent.max[k],high);}
  }
  for(const offset of imageOffsets(extent,map.wrap,p,d,radius,height,dims)){
    charge(48);
    const found=nearbyFlatMap(map,{x:p.x-offset.x,y:p.y-offset.y,z:p.z-offset.z},d,radius,height,dims);
    const shift=(v:Vec3)=>({x:v.x+offset.x,y:v.y+offset.y,z:v.z+offset.z});
    for(const key of ['boxes','circles','spheres','capsules','heightTiles'] as const)for(const value of found[key]??[]){
      charge(24);const v:any=value;
      out[key].push(key==='boxes'?{...v,min:shift(v.min),max:shift(v.max)}:{...v,at:shift(v.at)});
    }
  }
  return out;
}
function nearbyFlatMap(map: MapShapes, p:Vec3, d:Vec3, radius:number, height:number, dims=3):MapShapes {
  const parent=map.staticMap;
  const root=indexes.get(parent??map);
  if(!root)return map;
  const out:any={bounds:map.bounds,boxes:[],circles:[],spheres:[],capsules:[],heightTiles:[]};
  function touches(n:{min:Vec3;max:Vec3}):boolean {
    charge(12);let near=0,far=1;
    for(let axis=0;axis<(dims===2?2:3);axis++){const k=axes[axis],lo=n.min[k]-(k==='z'?height:radius),hi=n.max[k]+(k==='z'?0:radius);
      if(d[k]===0){if(p[k]<lo-1e-7||p[k]>hi+1e-7)return false;}
      else {let a=(lo-p[k])/d[k],b=(hi-p[k])/d[k];if(a>b){const swap=a;a=b;b=swap;}near=Math.max(near,a);far=Math.min(far,b);if(near>far+1e-7)return false;}
    }return true;
  }
  const found:Entry[]=[];
  function visit(n:Node){if(!touches(n))return;if(n.entries){for(let i=0;i<n.entries.length;i++){const e=n.entries[i];if(touches(e))found.push(e);}}else{visit(n.left!);visit(n.right!);}}
  visit(root);charge(found.length*Math.ceil(Math.log2(found.length+1)));
  found.sort((a,b)=>a.order-b.order);for(let i=0;i<found.length;i++){const e=found[i];out[e.key].push(e.value);}
  if(parent)for(const key of ['boxes','circles','spheres','capsules','heightTiles'] as const)for(const raw of map[key]??[]){
    const v:any=raw;let min:Vec3,max:Vec3;
    if(key==='boxes'){min=v.min;max=v.max;}
    else if(key==='heightTiles'){min={...v.at,z:v.at.z+Math.min(v.base??Infinity,...v.heights)};max={x:v.at.x+v.size.x,y:v.at.y+v.size.y,z:v.at.z+Math.max(...v.heights)};}
    else{min={x:v.at.x-v.r,y:v.at.y-v.r,z:key==='circles'?-Infinity:key==='capsules'?v.at.z:v.at.z-v.r};max={x:v.at.x+v.r,y:v.at.y+v.r,z:key==='circles'?Infinity:key==='capsules'?v.at.z+v.height:v.at.z+v.r};}
    if(touches({min,max}))out[key].push(raw);
  }
  return out;
}
