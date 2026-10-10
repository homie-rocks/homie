/** Solid triangulated height tiles. Each source triangle is a closed vertical
 * prism; their union preserves noncoplanar samples without a convex-hull fill. */
import { charge } from './guard.ts';
import type { Vec3, MapHeightTile } from './rules.ts';
import type { Solid, Hit3 } from './collision.ts';
type Plane = { n: Vec3; c: number };
type Prism = { vertices: Vec3[]; faces: Vec3[][]; bounds: {min:Vec3;max:Vec3}[]; planes: Plane[]; edges: Vec3[]; segments: [Vec3,Vec3][]; segmentIds: [number,number][]; boxAxes:Vec3[] };
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
    prisms.push(makePrism(upper,lower));
  }
  cache.set(t,prisms);
}
function makePrism(upper:Vec3[],lower:Vec3[]):Prism {
    const vertices=[...upper,...lower],faces=[upper,[...lower].reverse()];
    for(let i=0;i<3;i++){const j=(i+1)%3;faces.push([upper[i],lower[i],lower[j]],[upper[i],lower[j],upper[j]]);}
    const center=vertices.reduce((s,v)=>add(s,v,1/6),{x:0,y:0,z:0}),planes:Plane[]=[],valid:Vec3[][]=[],edges:Vec3[]=[];
    for(const face of faces){let n=cross(sub(face[1],face[0]),sub(face[2],face[0]));const len=Math.sqrt(dot(n,n));if(len<1e-12)continue;n={x:n.x/len,y:n.y/len,z:n.z/len};let c=dot(n,face[0]);if(dot(n,center)>c){n={x:-n.x,y:-n.y,z:-n.z};c=-c;}planes.push({n,c});valid.push(face);for(let i=0;i<3;i++)edges.push(sub(face[(i+1)%3],face[i]));}
    const segments:[Vec3,Vec3][]=[],segmentIds:[number,number][]=[];
    for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++){
      const common=planes.filter(p=>Math.abs(dot(p.n,vertices[i])-p.c)<1e-9&&Math.abs(dot(p.n,vertices[j])-p.c)<1e-9);
      if(common.some((p,k)=>common.slice(k+1).some(q=>Math.abs(dot(p.n,q.n))<1-1e-9))){segments.push([vertices[i],vertices[j]]);segmentIds.push([i,j]);}
    }
    const unique=planes.filter((p,i)=>!planes.slice(0,i).some(q=>dot(p.n,q.n)>1-1e-10&&Math.abs(p.c-q.c)<1e-9));
    const boxAxes:Vec3[]=[];
    const axis=(v:Vec3)=>{const len=Math.sqrt(dot(v,v));if(len<1e-10)return;const n={x:v.x/len,y:v.y/len,z:v.z/len};if(!boxAxes.some(a=>Math.abs(dot(a,n))>1-1e-10))boxAxes.push(n);};
    const bases=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];for(const b of bases)axis(b);for(const p of unique)axis(p.n);for(const e of edges)for(const b of bases)axis(cross(e,b));
    return {vertices,segments,segmentIds,boxAxes,faces:valid,bounds:valid.map(face=>({min:{x:Math.min(...face.map(v=>v.x)),y:Math.min(...face.map(v=>v.y)),z:Math.min(...face.map(v=>v.z))},max:{x:Math.max(...face.map(v=>v.x)),y:Math.max(...face.map(v=>v.y)),z:Math.max(...face.map(v=>v.z))}})),planes:unique,edges};
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
  // A separating plane is a distance lower bound. If its orthogonal projection
  // lies on the prism, that bound is attained: no edge search is necessary.
  let gap=0,normal:Vec3|null=null,endpoint=a;
  for(const plane of prism.planes){charge(8);const ga=dot(plane.n,a)-plane.c,gb=dot(plane.n,b)-plane.c,g=Math.min(ga,gb);if(g>gap){gap=g;normal=plane.n;endpoint=ga<=gb?a:b;}}
  if(normal){const projected=add(endpoint,normal,-gap);let inside=true;for(const plane of prism.planes){charge(8);if(dot(plane.n,projected)>plane.c+1e-10){inside=false;break;}}if(inside)return {x:normal.x*gap,y:normal.y*gap,z:normal.z*gap};}
  let best={x:Infinity,y:Infinity,z:Infinity},sq=Infinity;
  const take=(v:Vec3)=>{const n=dot(v,v);if(n<sq){sq=n;best=v;}};
  for(let i=0;i<prism.faces.length;i++){charge(12);const bounds=prism.bounds[i];let lower=0;for(const k of ['x','y','z'] as const){const gap=Math.max(0,bounds.min[k]-Math.max(a[k],b[k]),Math.min(a[k],b[k])-bounds.max[k]);lower+=gap*gap;}if(lower>sq)continue;const [x,y,z]=prism.faces[i];charge(36);take(sub(a,triangle(a,x,y,z)));take(sub(b,triangle(b,x,y,z)));take(segmentPair(a,b,x,y));take(segmentPair(a,b,y,z));take(segmentPair(a,b,z,x));}
  return best;
}
function boxCast(prism:Prism,a:Solid,d:Vec3):Hit3|null {
  const axes=prism.boxAxes;
  let near=0,far=1,normal={x:0,y:0,z:0};
  for(const n of axes){charge(16);let lo=Infinity,hi=-Infinity;
    for(const v of prism.vertices){const p=dot(n,v);lo=Math.min(lo,p);hi=Math.max(hi,p);}
    let amin=0,amax=0;for(const k of ['x','y','z'] as const){amin+=n[k]*(n[k]>=0?a.min[k]:a.max[k]);amax+=n[k]*(n[k]>=0?a.max[k]:a.min[k]);}
    const speed=dot(n,d);if(Math.abs(speed)<1e-12){if(amax<=lo+1e-9||amin>=hi-1e-9)return null;continue;}
    let enter=(lo-amax)/speed,exit=(hi-amin)/speed;if(enter>exit)[enter,exit]=[exit,enter];
    if(enter>=near){near=enter;normal={x:n.x*(speed>0?-1:1),y:n.y*(speed>0?-1:1),z:n.z*(speed>0?-1:1)};}far=Math.min(far,exit);if(near>far)return null;
  }
  return near<=1&&dot(normal,d)<0?{t:near,nx:normal.x,ny:normal.y,nz:normal.z}:null;
}
const extended = new WeakMap<Prism, Map<number, Prism>>();
function capsulePrism(prism:Prism,length:number):Prism {
  if(!length)return prism;
  let variants=extended.get(prism);if(!variants){variants=new Map();extended.set(prism,variants);}
  let result=variants.get(length);if(!result){const vertices=prism.vertices.map((p,i)=>i<3?p:{...p,z:p.z-length});
    const translate=(p:Vec3)=>vertices[prism.vertices.indexOf(p)];
    result={vertices,faces:prism.faces.map(face=>face.map(translate)),bounds:prism.bounds.map(b=>({min:{...b.min,z:b.min.z-length},max:b.max})),planes:prism.planes.map(p=>({n:p.n,c:p.c+Math.max(0,-p.n.z*length)})),edges:prism.edges,segments:prism.segmentIds.map(([i,j])=>[vertices[i],vertices[j]]),segmentIds:prism.segmentIds,boxAxes:prism.boxAxes};if(variants.size>=32)variants.clear();variants.set(length,result);}
  return result;
}
/** Downward vertical support only meets the upper triangle or its rounded rim.
 * The capsule's upper centre trails its lower centre, so no extrusion is needed. */
function downCast(prism:Prism,a:Solid,d:Vec3):Hit3|null {
  charge(24);const p=a.min,r=a.r,top=prism.vertices.slice(0,3);
  // Reject the rounded top bounds before doing any face/edge root solving.
  if(p.x+r<Math.min(...top.map(v=>v.x))||p.x-r>Math.max(...top.map(v=>v.x))||p.y+r<Math.min(...top.map(v=>v.y))||p.y-r>Math.max(...top.map(v=>v.y))||p.z+d.z-r>Math.max(...top.map(v=>v.z)))return null;
  const plane=prism.planes.find(q=>q.n.z>0);
  if(!plane)return null;
  let best:Hit3|null=null;
  const take=(t:number,n:Vec3)=>{if(t<0||t>1||best&&t>=best.t||n.z<=1e-12)return;const len=Math.sqrt(dot(n,n));best={t,nx:n.x/len,ny:n.y/len,nz:n.z/len};};
  const t=(plane.c+r-dot(plane.n,p))/(plane.n.z*d.z);
  if(t>=0&&t<=1){const q=add(add(p,d,t),plane.n,-r),near=triangle(q,top[0],top[1],top[2]),delta=sub(q,near);if(dot(delta,delta)<1e-14)return {t,nx:plane.n.x,ny:plane.n.y,nz:plane.n.z};}
  const speed2=d.z*d.z;
  for(let i=0;i<3;i++){
    const from=top[i],to=top[(i+1)%3],ba=sub(to,from),oa=sub(p,from);
    charge(8);const xy=ba.x*ba.x+ba.y*ba.y,u=xy?clamp((oa.x*ba.x+oa.y*ba.y)/xy):0;
    if((oa.x-ba.x*u)**2+(oa.y-ba.y*u)**2>r*r+1e-12)continue;
    charge(40);const ba2=dot(ba,ba),bard=ba.z*d.z,baoa=dot(ba,oa);
    const k2=ba2*speed2-bard*bard,k1=ba2*oa.z*d.z-baoa*bard,k0=ba2*dot(oa,oa)-baoa*baoa-r*r*ba2,h=k1*k1-k2*k0;
    if(k2>1e-16&&h>=0){const t=(-k1-Math.sqrt(h))/k2,y=baoa+t*bard;if(y>=0&&y<=ba2)take(t,sub(add(p,d,t),add(from,ba,y/ba2)));}
    const horizontal=oa.x*oa.x+oa.y*oa.y;if(horizontal<=r*r){const height=Math.sqrt(r*r-horizontal),t=(from.z+height-p.z)/d.z;take(t,{x:oa.x,y:oa.y,z:height});}
  }
  if(best&&dot(plane.n,p)-plane.c<r){const initial=distance(prism,a.min,a.max);if(dot(initial,initial)<r*r-1e-9)return null;}
  return best;
}
/** Exact swept sphere against a convex prism's faces and rounded edges. A
 * vertical capsule is a sphere against the prism extended down its centreline. */
function roundedCast(source:Prism,a:Solid,d:Vec3):Hit3|null {
  charge(24);
  const lo=source.vertices[3],hiZ=Math.max(source.vertices[0].z,source.vertices[1].z,source.vertices[2].z);
  if(Math.min(a.min.z,a.min.z+d.z)-a.r>hiZ||Math.max(a.max.z,a.max.z+d.z)+a.r<lo.z)return null;
  let near=0,far=1;
  for(const k of ['x','y'] as const){const low=Math.min(source.vertices[0][k],source.vertices[1][k],source.vertices[2][k])-a.r,high=Math.max(source.vertices[0][k],source.vertices[1][k],source.vertices[2][k])+a.r;if(!d[k]){if(a.min[k]<low||a.min[k]>high)return null;}else{let t=(low-a.min[k])/d[k],u=(high-a.min[k])/d[k];if(t>u)[t,u]=[u,t];near=Math.max(near,t);far=Math.min(far,u);if(near>far)return null;}}
  charge(64);const prism=capsulePrism(source,a.max.z-a.min.z),p=a.min,r=a.r;
  let entry=0,exit=1,enterPlane:Plane|null=null;
  for(const plane of prism.planes){charge(8);const gap=plane.c+r-dot(plane.n,p),speed=dot(plane.n,d);if(Math.abs(speed)<1e-12){if(gap< -1e-10)return null;}else if(speed>0)exit=Math.min(exit,gap/speed);else {const t=gap/speed;if(t>=entry){entry=t;enterPlane=plane;}}if(entry>exit+1e-10)return null;}
  if(entry>1||exit<0)return null;
  if(enterPlane){const projected=add(add(p,d,entry),enterPlane.n,-r);let inside=true;for(const plane of prism.planes){charge(8);if(dot(plane.n,projected)>plane.c+1e-10){inside=false;break;}}if(inside)return{t:Math.max(0,entry),nx:enterPlane.n.x,ny:enterPlane.n.y,nz:enterPlane.n.z};}

  const speed2=dot(d,d);if(speed2<1e-20)return null;
  let best:Hit3|null=null;
  const take=(t:number,normal:Vec3)=>{if(t< -1e-9||t>1||best&&t>=best.t)return;const len=Math.sqrt(dot(normal,normal));if(len<1e-12||dot(normal,d)>=-1e-12)return;best={t:Math.max(0,t),nx:normal.x/len,ny:normal.y/len,nz:normal.z/len};};
  const sphere=(v:Vec3)=>{const o=sub(p,v),b=dot(o,d),c=dot(o,o)-r*r,h=b*b-speed2*c;if(h<0)return;const t=(-b-Math.sqrt(h))/speed2;take(t,sub(add(p,d,t),v));};
  for(const plane of prism.planes){
    charge(40);const speed=dot(plane.n,d);
    if(speed< -1e-12){const t=(plane.c+r-dot(plane.n,p))/speed;if(t>=-1e-9&&t<=1&&(!best||t<best.t)){const hit=add(add(p,d,t),plane.n,-r);if(prism.planes.every(q=>dot(q.n,hit)<=q.c+1e-10))take(t,plane.n);}}
  }
  const sweptMin={x:Math.min(p.x,p.x+d.x)-r,y:Math.min(p.y,p.y+d.y)-r,z:Math.min(p.z,p.z+d.z)-r},sweptMax={x:Math.max(p.x,p.x+d.x)+r,y:Math.max(p.y,p.y+d.y)+r,z:Math.max(p.z,p.z+d.z)+r};
  for(const [from,to] of prism.segments){
      charge(8);if(Math.max(from.x,to.x)<sweptMin.x||Math.min(from.x,to.x)>sweptMax.x||Math.max(from.y,to.y)<sweptMin.y||Math.min(from.y,to.y)>sweptMax.y||Math.max(from.z,to.z)<sweptMin.z||Math.min(from.z,to.z)>sweptMax.z)continue;
      charge(48);const ba=sub(to,from),oa=sub(p,from),ba2=dot(ba,ba),bard=dot(ba,d),baoa=dot(ba,oa);
      const k2=ba2*speed2-bard*bard,k1=ba2*dot(oa,d)-baoa*bard,k0=ba2*dot(oa,oa)-baoa*baoa-r*r*ba2,h=k1*k1-k2*k0;
      if(k2>1e-16&&h>=0){const t=(-k1-Math.sqrt(h))/k2,y=baoa+t*bard;if(y>=0&&y<=ba2)take(t,sub(add(p,d,t),add(from,ba,y/ba2)));}
  }
  for(const v of prism.vertices){charge(4);if(v.x<sweptMin.x||v.x>sweptMax.x||v.y<sweptMin.y||v.y>sweptMax.y||v.z<sweptMin.z||v.z>sweptMax.z)continue;charge(24);sphere(v);}
  if(best&&entry===0){const initial=distance(prism,p,p);if(dot(initial,initial)<r*r-1e-9)return null;}
  return best;
}
export function castTerrain(tile:MapHeightTile,a:Solid,d:Vec3):Hit3|null {
  charge(12);
  let best:Hit3|null=null;
  for(const prism of cache.get(tile)??[]){
    let hit:Hit3|null=null;
    if(a.r===0)hit=a.min.x===a.max.x&&a.min.y===a.max.y&&a.min.z===a.max.z?clip(prism,a.min,d):boxCast(prism,a,d);
    else hit=d.x===0&&d.y===0&&d.z<0?downCast(prism,a,d):roundedCast(prism,a,d);
    if(hit&&(!best||hit.t<best.t))best=hit;
  }return best;
}
export function overlapsTerrain(tile:MapHeightTile,a:Solid):boolean {
  for(const prism of cache.get(tile)??[]){
    if(a.r>0){const v=distance(prism,a.min,a.max);if(dot(v,v)<a.r*a.r-1e-9)return true;}
    else {
      // SAT overlap uses the same face, edge and box axes as continuous casts.
      const axes=prism.boxAxes;
      let separated=false;for(const n of axes){charge(16);if(dot(n,n)<1e-18)continue;const ps=prism.vertices.map(v=>dot(n,v));let lo=0,hi=0;for(const k of ['x','y','z'] as const){lo+=n[k]*(n[k]>=0?a.min[k]:a.max[k]);hi+=n[k]*(n[k]>=0?a.max[k]:a.min[k]);}if(hi<=Math.min(...ps)+1e-9||lo>=Math.max(...ps)-1e-9){separated=true;break;}}if(!separated)return true;
    }
  }return false;
}
