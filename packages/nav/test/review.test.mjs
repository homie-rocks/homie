import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bakeTile, bakeLevel, bakeHeightfield, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { pack, unpack, chunks, joinChunks } from '@homie-rocks/nav/State.js';
import { axes } from '@homie-rocks/nav/Query.js';
import { config, field, flat, tune } from './fixtures.mjs';

for (const up of ['y', 'z']) {
  const p = point => axes(point, up);
  const make = () => { const cfg = { ...config, up }; const tile = bakeTile(heightfieldTriangles({ heightAt: () => 0 }, -2, -2, 57, 57, .25, up), cfg, 0, 0); const mesh = new Mesh(cfg, p([2, 2, 2])); mesh.loadTile(tile); return { mesh, tile }; };
  test(`${up}-up: floor unload/reload and enclosing obstacle removal recover a kept target`, () => {
    const { mesh, tile } = make(), c = new Crowd(mesh, .05, .3), id = c.add(p([5, .1, 5]), tune);
    c.target(id, p([9, .1, 9])); mesh.unloadTile(0, 0);
    for (let i = 0; i < 40; i++) c.step();
    assert.equal(c.agent(id).status, 'stranded');
    mesh.loadTile(tile); for (let i = 0; i < 200; i++) c.step(); assert.ok(c.arrived(id, .3));
    c.place(id, p([5, .1, 5])); const obstacle = mesh.addObstacle({ min: p([1, -1, 1]), max: p([9, 3, 9]) });
    for (let i = 0; i < 20; i++) c.step(); assert.equal(c.agent(id).status, 'stranded');
    mesh.removeObstacle(obstacle); for (let i = 0; i < 200; i++) c.step(); assert.ok(c.arrived(id, .3));
    assert.equal(c.place(id, p([100, 0, 100])), false);
  });
  test(`${up}-up: no forbidden host maths during bake, edits, queries, step or restore`, () => {
    const saved = {}; const forbidden = ['sin','cos','tan','atan2','pow','exp','log','hypot'];
    for (const name of forbidden) { saved[name] = Math[name]; Math[name] = () => { throw Error(`forbidden Math.${name}`); }; }
    try {
      const { mesh } = make(), c = new Crowd(mesh, .05, .3), rng = new Random(2);
      for (let i = 0; i < 20; i++) { const id = c.add(p([1 + i % 4, .1, 1 + Math.floor(i / 4)]), tune); c.target(id, p([8, .1, 8])); }
      mesh.addCylinder(p([5, 0, 5]), .5, 2);
      mesh.path(p([1, .1, 1]), p([9, .1, 9])); mesh.random(p([1, .1, 1]), rng.next);
      let restored = c;
      for (let i = 0; i < 60; i++) { restored.step(); restored = Crowd.restore(restored.save(), mesh); }
      assert.equal(restored.tick, 60);
    } finally { Object.assign(Math, saved); }
  });
  test(`${up}-up: heightfield level bake, slopes, queries, cylinders and grid agree`, () => {
    const cfg = { ...config, up }, mesh = new Mesh(cfg, p([2, 2, 2]));
    for (const tile of bakeHeightfield({ heightAt: x => x * .1 }, cfg, { min: [0, 0], max: [20, 10] })) mesh.loadTile(tile.bytes);
    assert.equal(mesh.path(p([2, .2, 5]), p([18, 1.8, 5])).complete, true);
    const nearest = mesh.nearest(p([5, .5, 5])); assert.ok(Math.abs(nearest[up === 'z' ? 2 : 1] - .6) < .2);
    const obstacle = mesh.addCylinder(p([5, 0, 5]), 1, 3); assert.equal(mesh.raycast(p([2, .3, 5]), p([8, .9, 5])).clear, false); mesh.removeObstacle(obstacle);
    const grid = new Grid(10, 10, 1, p([0, 3, 0]), undefined, { up, search: 'jps' });
    const route = grid.path(p([.5, 3, .5]), p([9.5, 3, 9.5])); assert.equal(route.points.length, 2); assert.equal(route.points[1][up === 'z' ? 2 : 1], 3);
    assert.deepEqual(Grid.restore(grid.save()).path(p([.5, 3, .5]), p([9.5, 3, 9.5])), route);
  });
}

test('binary budgets, checksums, chunks, shared mesh and exact 300-agent continuation', () => {
  const cfg = { ...config, tileCells: 80 }, mesh = new Mesh(cfg, [2,2,2]);
  const input = field(() => 0, -2, -2, 97, 97);
  const staticTile = bakeTile(input, { ...cfg, retainSpans: false }, 0, 0), editable = bakeTile(input, cfg, 0, 0);
  assert.ok(staticTile.length < 2048); assert.ok(editable.length < 550 * 400);
  mesh.loadTile(editable); const c = new Crowd(mesh, .05, .3);
  for (let i=0;i<300;i++) { const id=c.add([1+i%15,.1,1+Math.floor(i/15)*.8],tune);c.target(id,[19-i%15,.1,18-Math.floor(i/15)*.8]); }
  for (let i=0;i<20;i++) c.step();
  const start=performance.now(), bytes=c.save(), saveMs=performance.now()-start;
  const restoreStart=performance.now(), r=Crowd.restore(bytes,mesh), restoreMs=performance.now()-restoreStart;
  console.log(JSON.stringify({staticTileBytes:staticTile.length,editableTileBytes:editable.length,crowdBytes:bytes.length,bytesPerAgent:bytes.length/300,saveMs,restoreMs}));
  assert.ok(bytes.length < 300*1000+8192); assert.ok(saveMs < 50, `save ${saveMs} ms`); assert.ok(restoreMs < 50, `restore ${restoreMs} ms`);
  assert.equal(r.mesh,mesh); assert.deepEqual(joinChunks(chunks(bytes,4096)),bytes);
  for(let i=0;i<30;i++){c.step();r.step();assert.deepEqual(c.save(),r.save());}
  assert.throws(()=>mesh.loadTile(new Uint8Array([1,2,3])),/^Error: nav:/);
  const corrupt=staticTile.slice();corrupt[40]^=1;assert.throws(()=>mesh.loadTile(corrupt),/nav:/);
  const malformed=unpack('tile',staticTile);malformed.baked={};assert.throws(()=>mesh.loadTile(pack('tile',malformed)),/nav:/);
  mesh.unloadTile(0,0);assert.throws(()=>Crowd.restore(bytes,mesh),/identity/);
});

test('doors toggle flags without a rebuild and missing ids consistently return false', () => {
  const box={min:[4,-1,-1],max:[6,2,11]}, cfg={...config,doorRegions:[box]}, m=new Mesh(cfg,[.2,2,.2]);m.loadTile(bakeTile(field(),cfg,0,0));
  const c=new Crowd(m,.05,.3), id=c.add([2,.1,2],tune);c.target(id,[8,.1,8]);
  const before=m.debug().triangles, door=m.addDoor(box);
  assert.equal(m.setDoorEnabled(door,false),true);assert.equal(m.path([2,.1,2],[8,.1,8]).complete,false);
  assert.deepEqual(m.debug().triangles,before);m.setDoorEnabled(door,true);assert.ok(m.path([2,.1,2],[8,.1,8]).complete);
  for(const action of [()=>m.removeLink(999),()=>m.setLinkEnabled(999,true),()=>m.removeDoor(999),()=>m.removeObstacle(999),()=>c.remove(999),()=>c.target(999,[2,.1,2]),()=>c.stop(999),()=>c.setSpeed(999,3),()=>c.place(999,[2,.1,2]),()=>c.completeLink(999)]) assert.equal(action(),false);
  assert.equal(c.setSpeed(id,2),true);assert.deepEqual(c.ids(),[id]);assert.equal(c.state,undefined);assert.equal(m.state,undefined);assert.equal(m.locate,undefined);
});

test('public link ids and manual traversal survive snapshots', () => {
  const m=flat();m.addObstacle({min:[4,-1,-1],max:[6,3,11]});
  assert.throws(()=>m.addLink([100,0,100],[3,.1,5],.5,true),/endpoint/);
  assert.throws(()=>m.addLink([3,1.5,5],[7,.1,5],.1,true),/radius/);
  const link=m.addLink([3,.1,5],[7,.1,5],.6,true);assert.ok(link>0);assert.ok(m.path([2,.1,5],[8,.1,5]).links.includes(link));
  const c=new Crowd(m,.05,.3),id=c.add([2,.1,5],{...tune,manualLinks:true});c.target(id,[8,.1,5]);
  for(let i=0;i<100&&c.agent(id).status!=='link';i++)c.step();assert.equal(c.agent(id).link,link);
  const r=Crowd.restore(c.save(),m),at=r.agent(id).position;for(let i=0;i<50;i++)r.step();assert.deepEqual(r.agent(id).position,at);
  assert.ok(r.completeLink(id));for(let i=0;i<100;i++)r.step();assert.ok(r.arrived(id,.3));
});

test('whole-level bucketing supplies halos; per-tile missing halos produce diagnostics', () => {
  const m=new Mesh(config,[2,2,2]);
  for(const tile of bakeLevel(field(()=>0,0,0,81,41),config))m.loadTile(tile.bytes);
  assert.ok(m.path([5,0,5],[15,0,5]).complete);assert.deepEqual(m.debug().seams,[]);
  const broken=new Mesh(config,[2,2,2]);broken.loadTile(bakeTile(field(()=>0,0,0,41,41),config,0,0));
  assert.ok(broken.loadTile(bakeTile(field(()=>0,10,0,41,41),config,1,0)).warnings.some(s=>s.includes('halo')));
});

test('overhead boxes use physical headroom and random seeds do not silently wrap',()=>{
  const m=flat();m.addObstacle({min:[4,1.95,0],max:[6,4,10]});assert.ok(m.path([2,.1,5],[8,.1,5]).complete);
  assert.throws(()=>new Random(2**40),/uint32/);
});

test('small mesh routes match an independent visibility graph geodesic',()=>{
  // Fixed L-shaped corridor: its reflex corner gives the exact geodesic.
  const m=flat();m.addObstacle({min:[4,-1,4],max:[11,3,11]});
  const a=[2,.1,8],b=[8,.1,2],path=m.path(a,b);assert.ok(path.complete);
  const vertices=m.debug().triangles;const candidates=[a,b];for(let i=0;i<vertices.length;i+=3)candidates.push(vertices.slice(i,i+3));
  const distances=new Array(candidates.length).fill(Infinity),used=new Set();distances[0]=0;
  const metric=(a,b)=>Math.sqrt((a[0]-b[0])**2+(a[2]-b[2])**2);
  // Clip the segment against every triangle using half-planes, then union the
  // parameter intervals. This oracle never calls the backend's raycast/path.
  const clear=(a,b)=>{
    const intervals=[];
    for(let k=0;k<vertices.length;k+=9){
      const tri=[vertices.slice(k,k+3),vertices.slice(k+3,k+6),vertices.slice(k+6,k+9)];
      const cross=(p,q,r)=>(q[0]-p[0])*(r[2]-p[2])-(q[2]-p[2])*(r[0]-p[0]);
      const sign=Math.sign(cross(...tri));let lo=0,hi=1;
      for(let e=0;e<3;e++){
        const u=tri[e],v=tri[(e+1)%3],fa=cross(u,v,a)*sign,fb=cross(u,v,b)*sign;
        if(fa < -1e-9 && fb < -1e-9){hi=-1;break;}
        if(fa<0&&fb>=0)lo=Math.max(lo,-fa/(fb-fa));
        if(fb<0&&fa>=0)hi=Math.min(hi,fa/(fa-fb));
      }
      if(lo<=hi)intervals.push([lo,hi]);
    }
    intervals.sort((a,b)=>a[0]-b[0]);let covered=0;
    for(const [lo,hi] of intervals){if(lo>covered+1e-8)return false;covered=Math.max(covered,hi);}
    return covered>=1-1e-8;
  };
  for(let pass=0;pass<candidates.length;pass++){let i=-1;for(let j=0;j<candidates.length;j++)if(!used.has(j)&&(i<0||distances[j]<distances[i]))i=j;used.add(i);for(let j=0;j<candidates.length;j++)if(clear(candidates[i],candidates[j]))distances[j]=Math.min(distances[j],distances[i]+metric(candidates[i],candidates[j]));}
  const length=path.points.slice(1).reduce((n,p,i)=>n+metric(p,path.points[i]),0);assert.ok(Math.abs(length-distances[1])<1e-6);
});

test('public declarations do not name the backend and consume their own output',async()=>{
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '--strict', '--skipLibCheck', '--noEmit', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./public-api.ts', import.meta.url))]);
  for(const module of ['Mesh','Crowd','Bake','Grid','Query'])assert.doesNotMatch(await readFile(new URL(`../dist/${module}.d.ts`,import.meta.url),'utf8'),/navcat/);
});

test('tile bytes have a fixed golden checksum and known polygon count', () => {
  const bytes=bakeTile(field(),{...config,retainSpans:false},0,0);
  assert.equal(bytes.length,739);
  assert.equal(new DataView(bytes.buffer).getUint32(12,true),2290920047);
  assert.equal(unpack('tile',bytes).baked.polys.length,1);
});

test('mesh topology snapshots exclude static spans and restore crowd salts against assets', () => {
  const tile=bakeTile(field(),config,0,0), m=new Mesh(config,[2,2,2]);m.loadTile(tile);m.unloadTile(0,0);m.loadTile(tile);
  m.addObstacle({min:[4,-1,3],max:[6,3,7]});const c=new Crowd(m,.05,.3), id=c.add([1,.1,5],tune);c.target(id,[9,.1,5]);for(let i=0;i<12;i++)c.step();
  const bytes=m.save();assert.ok(bytes.length<8192);const restoredMesh=Mesh.restore(bytes,[tile]);assert.deepEqual(restoredMesh.identity(),m.identity());
  const restored=Crowd.restore(c.save(),restoredMesh);for(let i=0;i<100;i++){c.step();restored.step();}assert.deepEqual(c.save(),restored.save());
  assert.throws(()=>Mesh.restore(bytes,[]),/missing/);
});

test('large grid saves split into storage values smaller than two megabytes', () => {
  const grid=new Grid(2048,1024,1,[0,0,0]);grid.setBlocked(123,456,true);
  const bytes=grid.save(),parts=chunks(bytes);assert.ok(bytes.length>2_000_000);assert.ok(parts.every(p=>p.length<=1_048_576));
  assert.deepEqual(Grid.restore(joinChunks(parts)).save(),bytes);
});

test('reloading an irrelevant tile does not delay active agents', () => {
  const make=()=>{const mesh=flat();const far=bakeTile(field(()=>0,28,-2),config,3,0);mesh.loadTile(far);const crowd=new Crowd(mesh,.05,.3);for(let i=0;i<10;i++){const id=crowd.add([1,.1,1+i*.75],tune);crowd.target(id,[9,.1,1+i*.75]);}return {mesh,crowd,far};};
  const a=make(),b=make();
  for(let t=0;t<150;t++){if(t%15===0)b.mesh.loadTile(b.far);a.crowd.step();b.crowd.step();for(const id of a.crowd.ids())assert.deepEqual(a.crowd.agent(id),b.crowd.agent(id));}
  assert.ok(a.crowd.ids().every(id=>a.crowd.arrived(id,.3)));
});


test('new targets on disconnected islands are rejected instead of promising arrival', () => {
  const mesh=flat();mesh.addObstacle({min:[4,-1,-1],max:[6,3,11]});const crowd=new Crowd(mesh,.05,.3),id=crowd.add([2,.1,5],tune);
  assert.equal(crowd.target(id,[8,.1,5]),false);assert.ok(mesh.nearest([8,.1,5],[2,.1,5])[0]<4);
});


test('bad options and attempts to carve static assets fail before changing state', () => {
  const cfg={...config,retainSpans:false},mesh=new Mesh(cfg,[2,2,2]);mesh.loadTile(bakeTile(field(),cfg,0,0));const before=mesh.save();
  assert.throws(()=>mesh.addObstacle({min:[4,-1,4],max:[6,3,6]}),/spans/);assert.deepEqual(mesh.save(),before);
  assert.throws(()=>mesh.addDoor({min:[4,-1,4],max:[6,3,6]}),/doorRegions/);
  assert.throws(()=>mesh.addCylinder([5,0,5],NaN,3),/radius/);
  assert.throws(()=>new Crowd(mesh,.05,.3,{searchIterations:.5}),/integer/);
  assert.throws(()=>bakeTile(field(),{...cfg,minRegionCells:-1},0,0),/region/);
  assert.throws(()=>mesh.random([1,0,1],()=>'.5'),/random/);
});


test('arrival uses the snapped floor and a displaced target returns when its floor returns', () => {
  const mesh=flat(),crowd=new Crowd(mesh,.05,.3),id=crowd.add([1,0,5],tune);crowd.target(id,[8,0,5]);
  const obstacle=mesh.addObstacle({min:[7,-1,4],max:[9,3,6]});for(let i=0;i<150;i++)crowd.step();
  mesh.removeObstacle(obstacle);for(let i=0;i<150;i++)crowd.step();assert.ok(crowd.arrived(id,.05));assert.ok(Math.abs(crowd.agent(id).position[0]-8)<.05);
});


test('structurally invalid snapshots fail at the public boundary with nav errors', () => {
  const mesh=flat();assert.throws(()=>Mesh.restore(pack('mesh',{}),[]),/^Error: nav:/);
  assert.throws(()=>Grid.restore(pack('grid',{})),/^Error: nav:/);
  assert.throws(()=>Crowd.restore(pack('crowd',{}),mesh),/^Error: nav:/);
});
