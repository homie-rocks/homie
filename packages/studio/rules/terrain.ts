/** Solid triangulated height tiles. Each source triangle is a closed vertical
 * prism; their union preserves noncoplanar samples without a convex-hull fill. */
import { charge } from './guard.ts';
import type { Vec3, MapHeightTile } from './rules.ts';
import type { Solid, Hit3 } from './collision.ts';
type Plane = { n: Vec3; c: number };
type Prism = { vertices: Vec3[]; faces: Vec3[][]; bounds: {min:Vec3;max:Vec3}[]; planes: Plane[]; edges: Vec3[] };
const cache = new WeakMap<MapHeightTile, Prism[]>();
const sub=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a:Vec3,b:Vec3,t=1):Vec3=>({x:a.x+b.x*t,y:a.y+b.y*t,z:a.z+b.z*t});
const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export function prepareTile(t:MapHeightTile):void {
  if(t.base===undefined)return;
  const top=t.heights.map((h,i)=>({x:t.at.x+(i%2)*t.size.x,y:t.at.y+(i>>1)*t.size.y,z:t.at.z+h}));
  const tris=t.diagonal==='10-01'?[[0,1,2],[1,3,2]]:[[0,1,3],[0,3,2]];
  const prisms:Prism[]=[];
  for(const tri of tris){
    const upper=tri.map(i=>top[i]),lower=upper.map(v=>({...v,z:t.at.z+t.base!}));
    if(upper.every(v=>v.z===lower[0].z))continue;
    const vertices=[...upper,...lower],faces=[upper,[...lower].reverse()];
    for(let i=0;i<3;i++){const j=(i+1)%3;faces.push([upper[i],lower[i],lower[j]],[upper[i],lower[j],upper[j]]);}
    const center=vertices.reduce((s,v)=>add(s,v,1/6),{x:0,y:0,z:0}),planes:Plane[]=[],valid:Vec3[][]=[],edges:Vec3[]=[];
    for(const face of faces){let n=cross(sub(face[1],face[0]),sub(face[2],face[0]));const len=Math.sqrt(dot(n,n));if(len<1e-12)continue;n={x:n.x/len,y:n.y/len,z:n.z/len};let c=dot(n,face[0]);if(dot(n,center)>c){n={x:-n.x,y:-n.y,z:-n.z};c=-c;}planes.push({n,c});valid.push(face);for(let i=0;i<3;i++)edges.push(sub(face[(i+1)%3],face[i]));}
    prisms.push({vertices,faces:valid,bounds:valid.map(face=>({min:{x:Math.min(...face.map(v=>v.x)),y:Math.min(...face.map(v=>v.y)),z:Math.min(...face.map(v=>v.z))},max:{x:Math.max(...face.map(v=>v.x)),y:Math.max(...face.map(v=>v.y)),z:Math.max(...face.map(v=>v.z))}})),planes,edges});
  }
  cache.set(t,prisms);
}
// Closest point on a triangle, including vertex and edge Voronoi regions.
function triangle(p:Vec3,a:Vec3,b:Vec3,c:Vec3):Vec3 {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,ab,d1/(d1-d3));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,ac,d2/(d2-d6));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,sub(c,b),(d4-d3)/(d4-d3+d5-d6));
  const den=1/(va+vb+vc);return add(add(a,ab,vb*den),ac,vc*den);
}
function segmentPair(a:Vec3,b:Vec3,c:Vec3,d:Vec3):Vec3 {
  const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);
  let s=aa?clamp((bb*ee-cc*dd)/(aa*cc-bb*bb)||0):0;
  let t=cc?clamp((bb*s+ee)/cc):0;
  s=aa?clamp((bb*t-dd)/aa):0;t=cc?clamp((bb*s+ee)/cc):0;
  return sub(add(a,u,s),add(c,v,t));
}
function clip(prism:Prism,p:Vec3,d:Vec3):Hit3|null {
  let near=0,far=1,n={x:0,y:0,z:0};
  for(const plane of prism.planes){charge(8);const gap=plane.c-dot(plane.n,p),speed=dot(plane.n,d);if(Math.abs(speed)<1e-12){if(gap< -1e-9)return null;continue;}const t=gap/speed;if(speed<0){if(t>=near){near=t;n=plane.n;}}else far=Math.min(far,t);if(near>far+1e-9)return null;}
  return near>=0&&near<=1&&far>=0?{t:near,nx:n.x,ny:n.y,nz:n.z}:null;
}
function distance(prism:Prism,a:Vec3,b:Vec3):Vec3 {
  if(clip(prism,a,sub(b,a)))return {x:0,y:0,z:0};
  let best={x:Infinity,y:Infinity,z:Infinity},sq=Infinity;
  const take=(v:Vec3)=>{const n=dot(v,v);if(n<sq){sq=n;best=v;}};
  for(let i=0;i<prism.faces.length;i++){charge(12);const bounds=prism.bounds[i];let lower=0;for(const k of ['x','y','z'] as const){const gap=Math.max(0,bounds.min[k]-Math.max(a[k],b[k]),Math.min(a[k],b[k])-bounds.max[k]);lower+=gap*gap;}if(lower>sq)continue;const [x,y,z]=prism.faces[i];charge(36);take(sub(a,triangle(a,x,y,z)));take(sub(b,triangle(b,x,y,z)));take(segmentPair(a,b,x,y));take(segmentPair(a,b,y,z));take(segmentPair(a,b,z,x));}
  return best;
}
function boxCast(prism:Prism,a:Solid,d:Vec3):Hit3|null {
  const axes:Vec3[]=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1},...prism.planes.map(p=>p.n)];
  for(const e of prism.edges)for(const k of axes.slice(0,3))axes.push(cross(e,k));
  let near=0,far=1,normal={x:0,y:0,z:0};
  for(const axis of axes){charge(16);const len=Math.sqrt(dot(axis,axis));if(len<1e-10)continue;const n={x:axis.x/len,y:axis.y/len,z:axis.z/len};let lo=Infinity,hi=-Infinity;
    for(const v of prism.vertices){const p=dot(n,v);lo=Math.min(lo,p);hi=Math.max(hi,p);}
    let amin=0,amax=0;for(const k of ['x','y','z'] as const){amin+=n[k]*(n[k]>=0?a.min[k]:a.max[k]);amax+=n[k]*(n[k]>=0?a.max[k]:a.min[k]);}
    const speed=dot(n,d);if(Math.abs(speed)<1e-12){if(amax<=lo+1e-9||amin>=hi-1e-9)return null;continue;}
    let enter=(lo-amax)/speed,exit=(hi-amin)/speed;if(enter>exit)[enter,exit]=[exit,enter];
    if(enter>=near){near=enter;normal={x:n.x*(speed>0?-1:1),y:n.y*(speed>0?-1:1),z:n.z*(speed>0?-1:1)};}far=Math.min(far,exit);if(near>far)return null;
  }
  return near<=1&&dot(normal,d)<0?{t:near,nx:normal.x,ny:normal.y,nz:normal.z}:null;
}
export function castTerrain(tile:MapHeightTile,a:Solid,d:Vec3):Hit3|null {
  charge(12);
  let best:Hit3|null=null;
  for(const prism of cache.get(tile)??[]){
    let hit:Hit3|null=null;
    if(a.r===0)hit=a.min.x===a.max.x&&a.min.y===a.max.y&&a.min.z===a.max.z?clip(prism,a.min,d):boxCast(prism,a,d);
    else {let t=0;for(let i=0;i<32;i++){charge(24);const v=distance(prism,add(a.min,d,t),add(a.max,d,t)),len=Math.sqrt(dot(v,v)),gap=len-a.r;if(i===0&&gap< -1e-7)break;if(len===0)break;const n={x:v.x/len,y:v.y/len,z:v.z/len},closing=-dot(n,d);if(closing<=1e-9)break;if(gap<=1e-7){hit={t,nx:n.x,ny:n.y,nz:n.z};break;}t+=gap/closing;if(t>1)break;if(i===31)hit={t,nx:n.x,ny:n.y,nz:n.z};}}
    if(hit&&(!best||hit.t<best.t))best=hit;
  }return best;
}
export function overlapsTerrain(tile:MapHeightTile,a:Solid):boolean {
  for(const prism of cache.get(tile)??[]){
    if(a.r>0){const v=distance(prism,a.min,a.max);if(dot(v,v)<a.r*a.r-1e-9)return true;}
    else {
      // SAT overlap uses the same face, edge and box axes as continuous casts.
      const axes=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1},...prism.planes.map(p=>p.n)];
      for(const e of prism.edges)for(const k of axes.slice(0,3))axes.push(cross(e,k));
      let separated=false;for(const n of axes){charge(16);if(dot(n,n)<1e-18)continue;const ps=prism.vertices.map(v=>dot(n,v));let lo=0,hi=0;for(const k of ['x','y','z'] as const){lo+=n[k]*(n[k]>=0?a.min[k]:a.max[k]);hi+=n[k]*(n[k]>=0?a.max[k]:a.min[k]);}if(hi<=Math.min(...ps)+1e-9||lo>=Math.max(...ps)-1e-9){separated=true;break;}}if(!separated)return true;
    }
  }return false;
}
