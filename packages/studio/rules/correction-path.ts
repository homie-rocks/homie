import type { Vec3 } from './math.ts';

/** A bounded, incremental presentation route. Never participates in simulation.
 * Each node stores the actual safe endpoint of the body sweep, including its
 * collision skin. Never start an edge from an unswept grid coordinate. Search
 * is spread over frames so an unusual correction cannot monopolize a phone. */
export function correctionPath(start: Vec3, goal: Vec3, spacing: number) {
  type Node = { x: number; y: number; pos: Vec3; cost: number; estimate: number; parent?: Node };
  const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x,a.y-b.y);
  const first: Node = {x:0,y:0,pos:start,cost:0,estimate:distance(start,goal)};
  const open = [first], costs = new Map<string,number>([['0,0',0]]);
  let route: Vec3[] | null = null, exhausted = false;
  return {
    goal,
    advance(sweep: (from: Vec3,to: Vec3)=>Vec3): readonly Vec3[] | null {
      if (route || exhausted) return route;
      for (let budget=0;budget<128 && open.length;budget++) {
        let best=0;for(let i=1;i<open.length;i++)if(open[i].estimate<open[best].estimate)best=i;
        const node=open.splice(best,1)[0];
        const end=sweep(node.pos,goal);
        if(distance(end,goal)<.002) {
          route=[end];let n:Node|undefined=node;while(n?.parent){route.unshift(n.pos);n=n.parent;}return route;
        }
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
          const x=node.x+dx,y=node.y+dy,key=`${x},${y}`,cost=node.cost+Math.hypot(dx,dy)*spacing;
          if(cost>=(costs.get(key)??Infinity))continue;
          const candidate={x:start.x+x*spacing,y:start.y+y*spacing,z:0};
          const pos=sweep(node.pos,candidate);
          if(distance(pos,candidate)>=.002)continue;
          costs.set(key,cost);open.push({x,y,pos,cost,estimate:cost+distance(pos,goal),parent:node});
        }
        if(costs.size>4096){exhausted=true;return null;}
      }
      if(!open.length)exhausted=true;
      return null;
    },
  };
}
