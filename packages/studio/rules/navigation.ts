/** Deterministic routing over an authored, baked walking graph. Full searches
 * either reach the goal or return no path; never silently truncate a route. */
import {own,charge} from './guard.ts';
import type {Solid} from './collision.ts';
import {castSolid} from './collision.ts';
export type RouteNode = readonly [number,number,number,readonly number[]];
const graphs = new WeakMap<object,readonly RouteNode[]>();
const incoming = new WeakMap<object,readonly (readonly number[])[]>();
function graphOf(value: unknown, billing=true): readonly RouteNode[] {
 if(!Array.isArray(value)||value.length>8192)throw new Error('route graph has at most 8192 nodes');
 if(billing)charge(value.length*12);const cached=graphs.get(value);if(cached)return cached;
 const nodes:RouteNode[]=[];
 for(let i=0;i<value.length;i++){
  const n=own(value,i),links=own(n,3),x=own(n,0),y=own(n,1),z=own(n,2);
  if(![x,y,z].every(v=>typeof v==='number'&&Number.isFinite(v))||!Array.isArray(links)||links.length>16)throw new Error('route nodes are [x,y,z,links], at most 16 neighbours');
  const adjacent:number[]=[];for(let j=0;j<links.length;j++){const id=own(links,j);if(typeof id!=='number'||!Number.isInteger(id)||id<0||id>=value.length)throw new Error('route links name graph nodes');adjacent.push(id);}
  nodes.push(Object.freeze([x as number,y as number,z as number,Object.freeze(adjacent)]));
 }
 const result=Object.freeze(nodes);const reverse:number[][]=nodes.map(()=>[]);nodes.forEach((n,i)=>{for(const next of n[3])reverse[next].push(i);});incoming.set(result,reverse);if(Object.isFrozen(value)&&value.every(n=>Object.isFrozen(n)&&Object.isFrozen(own(n,3))))graphs.set(value,result);return result;
}
export const prepareGraph=(value:unknown):readonly RouteNode[]=>graphOf(value,false);
export function routeGraph(value: unknown, origin: unknown, destination: unknown, solids: readonly Solid[], radius: number, height: number, prepared=false): readonly number[] {
 const nodes=prepared?value as readonly RouteNode[]:graphOf(value);if(prepared)charge(16);
 if(!Number.isInteger(origin)||!Number.isInteger(destination)||Number(origin)<0||Number(destination)<0||Number(origin)>=nodes.length||Number(destination)>=nodes.length)throw new Error('route endpoints name graph nodes');
 let start=Number(origin),goal=Number(destination),end=nodes[goal];
 const buckets=new Map<string,Solid[]>();
 for(const solid of solids){const minX=Math.floor((solid.min.x-solid.r-radius)/4),maxX=Math.floor((solid.max.x+solid.r+radius)/4),minY=Math.floor((solid.min.y-solid.r-radius)/4),maxY=Math.floor((solid.max.y+solid.r+radius)/4);
  if((maxX-minX+1)*(maxY-minY+1)>65536)throw new Error('route obstacle spans too many graph cells');
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){charge(2);const key=x+','+y;const rows=buckets.get(key)??[];rows.push(solid);buckets.set(key,rows);}
 }
 const blocked=(a:RouteNode,b:RouteNode)=>{
  const from={min:{x:a[0]-radius,y:a[1]-radius,z:a[2]+.05},max:{x:a[0]+radius,y:a[1]+radius,z:a[2]+height},r:0},delta={x:b[0]-a[0],y:b[1]-a[1],z:b[2]-a[2]};
  const candidates=new Set<Solid>();
  for(let x=Math.floor(Math.min(a[0],b[0])/4);x<=Math.floor(Math.max(a[0],b[0])/4);x++)for(let y=Math.floor(Math.min(a[1],b[1])/4);y<=Math.floor(Math.max(a[1],b[1])/4);y++){charge(1);for(const solid of buckets.get(x+','+y)??[])candidates.add(solid);}
  for(const s of candidates){charge(2);if(Math.max(a[0],b[0])+radius<s.min.x-s.r||Math.min(a[0],b[0])-radius>s.max.x+s.r||Math.max(a[1],b[1])+radius<s.min.y-s.r||Math.min(a[1],b[1])-radius>s.max.y+s.r||Math.max(a[2],b[2])+height<s.min.z-s.r||Math.min(a[2],b[2])+.05>s.max.z+s.r)continue;if(s.r===0){
    charge(24);let near=0,far=1,hit=true;
    for(const axis of ['x','y','z'] as const){const low=s.min[axis]-from.max[axis],high=s.max[axis]-from.min[axis],speed=delta[axis];if(!speed){if(low>=0||high<=0){hit=false;break;}}else{let a=low/speed,b=high/speed;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far){hit=false;break;}}}
    if(hit&&far>=0)return true;
   }else if(castSolid(from,delta,s,true))return true;}
  return false;
 };
 const endpoint=(id:number,limit:number)=>{
  if(!blocked(nodes[id],nodes[id]))return id;
  const p=nodes[id];let best=-1,score=Infinity;
  for(let i=0;i<nodes.length;i++){charge(4);const q=nodes[i],distance=Math.hypot(q[0]-p[0],q[1]-p[1]);const cost=distance+Math.abs(q[2]-p[2])*2;if(distance>limit||cost>=score||!q[3].length||blocked(q,q))continue;best=i;score=cost;}
  return best;
 };
 start=endpoint(start,4);goal=endpoint(goal,Infinity);if(start<0||goal<0)return Object.freeze([]);end=nodes[goal];
 type Entry={id:number;f:number;order:number};let sequence=0;
 const before=(a:Entry,b:Entry)=>a.f<b.f||a.f===b.f&&a.order<b.order;
 const push=(heap:Entry[],id:number,f:number)=>{const item={id,f,order:sequence++};let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(!before(item,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=item;};
 const pop=(heap:Entry[])=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&before(heap[j+1],heap[j]))j++;if(!before(heap[j],last))break;heap[i]=heap[j];i=j;}heap[i]=last;}return first.id;};
 const originPoint=nodes[start],potential=(id:number)=>(Math.hypot(nodes[id][0]-end[0],nodes[id][1]-end[1])-Math.hypot(nodes[id][0]-originPoint[0],nodes[id][1]-originPoint[1]))/2;
 const heaps:Entry[][]=[[],[]],costs=[new Map([[start,0]]),new Map([[goal,0]])],parents=[new Map<number,number>(),new Map<number,number>()],closed=[new Set<number>(),new Set<number>()],reverse=incoming.get(nodes)!;
 push(heaps[0],start,potential(start));push(heaps[1],goal,-potential(goal));let best=Infinity,meet=-1;
 // Balanced bidirectional A*: either frontier can prove disconnection. No
 // expansion limit, and every returned route connects the two endpoints.
 while(heaps[0].length&&heaps[1].length){
  if(heaps[0][0].f+heaps[1][0].f>=best)break;
  const side=heaps[0][0].f<=heaps[1][0].f?0:1,other=1-side,current=pop(heaps[side]);charge(12);if(closed[side].has(current))continue;closed[side].add(current);
  const cost=costs[side].get(current)!,opposite=costs[other].get(current);if(opposite!==undefined&&cost+opposite<best){best=cost+opposite;meet=current;}
  for(const next of side?reverse[current]:nodes[current][3]){charge(4);if(closed[side].has(next))continue;const a=nodes[side?next:current],b=nodes[side?current:next];if(blocked(a,b))continue;
   const score=cost+Math.hypot(b[0]-a[0],b[1]-a[1])+Math.max(0,b[2]-a[2])*.3;if(score>=(costs[side].get(next)??Infinity))continue;
   costs[side].set(next,score);parents[side].set(next,current);push(heaps[side],next,score+(side?-potential(next):potential(next)));
   const otherCost=costs[other].get(next);if(otherCost!==undefined&&score+otherCost<best){best=score+otherCost;meet=next;}
  }
 }
 if(meet<0)return Object.freeze([]);const path=[meet];while(path[0]!==start)path.unshift(parents[0].get(path[0])!);while(path[path.length-1]!==goal)path.push(parents[1].get(path[path.length-1])!);charge(path.length);return Object.freeze(path);
}
