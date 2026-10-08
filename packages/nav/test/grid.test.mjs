import assert from 'node:assert/strict';
import test from 'node:test';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { Random } from '@homie-rocks/nav/Random.js';

test('A* and JPS have equal octile cost against an independent Dijkstra oracle', () => {
  const rng = new Random(92);
  for (let run = 0; run < 150; run++) {
    const blocked = Uint8Array.from({ length: 144 }, () => rng.next() < .2 ? 1 : 0); blocked[0] = blocked[143] = 0;
    const grid = new Grid(12,12,1,[0,0,0],blocked);
    const costs = new Array(144).fill(Infinity), seen = new Set(); costs[0]=0;
    const free=(x,z)=>x>=0&&z>=0&&x<12&&z<12&&!blocked[z*12+x];
    for(let pass=0;pass<144;pass++) {
      let i=-1;for(let j=0;j<144;j++)if(!seen.has(j)&&(i<0||costs[j]<costs[i]))i=j;
      if(!Number.isFinite(costs[i]))break;seen.add(i);const x=i%12,z=Math.floor(i/12);
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if((dx||dz)&&free(x+dx,z+dz)&&(!dx||!dz||(free(x+dx,z)&&free(x,z+dz)))){const j=(z+dz)*12+x+dx;costs[j]=Math.min(costs[j],costs[i]+(dx&&dz?Math.SQRT2:1));}
    }
    for(const search of ['astar','jps']) {
      const route=grid.path([.5,0,.5],[11.5,0,11.5],{search,smooth:false});
      assert.equal(route.complete,Number.isFinite(costs[143]));
      if(route.complete)assert.ok(Math.abs(route.cost-costs[143])<1e-10,`${search} run ${run}`);
      const smooth=grid.path([.5,0,.5],[11.5,0,11.5],{search});
      for(let i=1;i<smooth.points.length;i++)assert.ok(grid.raycast(smooth.points[i-1],smooth.points[i]).clear);
    }
  }
});

test('grid ray finds exact wall and refuses diagonal corner cutting', () => {
  const g = new Grid(4, 4, 1, [0, 0, 0]);g.setBlocked(2, 0, true);
  assert.deepEqual(g.raycast([.5, 0, .5], [3.5, 0, .5]), { clear: false, fraction: .5, point: [2, 0, .5] });
  g.setBlocked(1, 0, true);assert.equal(g.raycast([.5, 0, .5], [1.5, 0, 1.5]).clear, false);
  assert.equal(g.raycast([.5, 0, .5], [.5, 0, .5]).clear, true);
  assert.equal(g.raycast([.5, 0, .5], [-.5, 0, .5]).clear, false);
});

test('reachable queries, seeded choices, dynamic cells and snapshots share mesh semantics', () => {
  const g = new Grid(5, 5, 1, [0, 0, 0]); for (let z = 0; z < 5; z++) g.setBlocked(2, z, true);
  assert.equal(g.path([.5, 0, .5], [4.5, 0, .5]).complete, false);
  assert.equal(g.nearest([4.5, 0, .5], [.5, 0, .5])[0], 1.5);
  const a = new Random(1), b = new Random(1), r = Grid.restore(g.save());
  for (let i = 0; i < 30; i++) { const p = g.random([.5, 0, .5], a.next);assert.deepEqual(p, r.random([.5, 0, .5], b.next));assert.ok(p[0] < 2); }
  g.setBlocked(2, 3, false);r.setBlocked(2, 3, false);assert.deepEqual(g.save(), r.save());assert.ok(g.path([.5, 0, .5], [4.5, 0, .5]).complete);
});
