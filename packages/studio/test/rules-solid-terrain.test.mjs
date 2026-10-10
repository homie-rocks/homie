import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COIN_DASH,loadGame} from './rules-kit.mjs';
const scratch=mkdtempSync(join(tmpdir(),'solid-terrain-'));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
let loaded;const kit=()=>loaded??=loadGame(scratch,COIN_DASH);
const bounds={min:[-100,-100,-10],max:[100,100,50]},tile={at:[-2.5,5,0],size:[5,12],heights:[4,4,0,0],base:0};
const capsule={shape:'capsule',radius:.42,height:1.8};
const close=(a,b,e=.002)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function sweep(L,map,pos,delta,shape=capsule){const b={pos};const hit=L.M.sweepMap(map,b,delta,shape.radius,3,shape);return {...b,hit};}
test('solid relay ramp sides, tall end, top, underside and rays share the closed volume',async()=>{
 const L=await kit(),map=L.R.compileMap({bounds,heightTiles:[tile]});
 for(const sign of [-1,1]){const b=sweep(L,map,{x:sign*4,y:7,z:0},{x:-sign*22,y:0,z:0});close(b.pos.x,sign*2.921);assert.ok(b.hit);}
 close(sweep(L,map,{x:0,y:2,z:0},{x:0,y:22,z:0}).pos.y,4.579);
 const ray={shape:'sphere',radius:0,height:0};
 close(sweep(L,map,{x:-4,y:7,z:1},{x:8,y:0,z:0},ray).pos.x,-2.501);
 for(const y of [7,14]){const b=sweep(L,map,{x:0,y,z:10},{x:0,y:0,z:-15});assert.ok(b.hit.normal.z>.9);assert.ok(b.grounded);}
 const roof=L.R.compileMap({bounds,heightTiles:[{...tile,at:[-2.5,5,4],heights:[2,2,1,1],base:0}]});
 assert.equal(sweep(L,roof,{x:-4,y:7,z:0},{x:8,y:0,z:0}).hit,undefined,'underpass remains clear');
 const ceiling=sweep(L,roof,{x:0,y:7,z:0},{x:0,y:0,z:8});close(ceiling.pos.z,2.199);assert.equal(ceiling.hit.normal.z,-1);
 const ctx=L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>.42,shape:()=>capsule,dims:3});
 assert.equal(ctx.world.overlaps({pos:{x:0,y:7,z:1}}),true);
 assert.equal(ctx.world.overlaps({pos:{x:-4,y:7,z:1}}),false);
});
test('solid source triangulation, including the alternate diagonal, is preserved',async()=>{
 const L=await kit();
 for(const diagonal of ['00-11','10-01']){
 const map=L.R.compileMap({bounds,heightTiles:[{at:[0,0,0],size:[4,4],heights:[1,3,3,1],base:0,diagonal}]});
 const ray={shape:'sphere',radius:0,height:0};
 const b=sweep(L,map,{x:2,y:2,z:10},{x:0,y:0,z:-12},ray);close(b.pos.z,diagonal==='00-11'?1.001:3.001);
 }
});
test('100,000 static shapes: local sweep, support, overlap and diagonal ray stay bounded in 2D and 3D',async()=>{
 const L=await kit();
 const boxes=Array.from({length:100000},(_,i)=>{const x=(i%400)*4,y=Math.floor(i/400)*4;return {min:[x,y,0],max:[x+1,y+1,2]};});
 const map=L.R.compileMap({bounds:{min:[-10,-10,0],max:[2000,2000,20]},boxes});
 for(const dims of [2,3]){const ctx=L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>.42,shape:()=>capsule,dims});
 L.W.G.left=125000;
 const b={pos:{x:-2,y:.5,z:0}};
 ctx.world.sweep(b,{x:3,y:0,z:0});close(b.pos.x,-.421);assert.equal(ctx.world.overlaps(b),false);assert.ok(ctx.world.support(b));
 const used=125000-L.W.G.left;L.W.G.left=Infinity;assert.ok(used<5000, `local ${dims}D queries used ${used}`);
 console.log(`${dims}D 100000 shapes: sweep + overlap + support ${used} units`);}
 L.W.G.left=125000;
 const ray=sweep(L,map,{x:-2,y:-2,z:1},{x:600,y:600,z:0},{shape:'sphere',radius:0,height:0});
 const rayUnits=125000-L.W.G.left;L.W.G.left=Infinity;assert.ok(ray.hit);assert.ok(rayUnits<30000,`diagonal ray: ${rayUnits}`);
});

test('step clearance and ceilings use the complete body, and indexed casts agree with brute force',async()=>{
 const L=await kit();
 const step={at:[0,-2,0],size:[2,4],heights:[.25,.25,.25,.25],base:0};
 for(const ceiling of [false,true]){
  const map=L.R.compileMap({bounds,heightTiles:[step],boxes:ceiling?[{min:[-3,-3,2],max:[3,3,3]}]:[]});
  const b={pos:{x:-.6,y:0,z:0}};
  const up=L.M.sweepMap(map,b,{x:0,y:0,z:.4},.42,3,capsule);
  if(ceiling){assert.ok(up);close(b.pos.z,.199);continue;}
  assert.equal(up,undefined);L.M.sweepMap(map,b,{x:1.2,y:0,z:0},.42,3,capsule);L.M.sweepMap(map,b,{x:0,y:0,z:-.5},.42,3,capsule);close(b.pos.z,.251);assert.ok(b.grounded);
 }
 const map=L.R.compileMap({bounds,heightTiles:[tile,{...tile,at:[10,5,4]}],boxes:[{min:[-10,2,0],max:[-8,8,6]}],spheres:[{at:[5,-4,3],r:2}],capsules:[{at:[-6,-5,0],r:1,height:3}],circles:[{at:[10,-10,0],r:2}]});
 const brute={...map};let seed=743;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<300;i++){const p={x:random()*35-15,y:random()*35-15,z:random()*12},d={x:random()*40-20,y:random()*40-20,z:random()*20-10};const shape=i%3?capsule:{shape:'sphere',radius:0,height:0};assert.deepEqual(sweep(L,map,p,d,shape),sweep(L,brute,p,d,shape));}
});

test('the reference discrete rejection policy stops at -3.000 m using the same continuous collider',async()=>{
 const L=await kit(),map=L.R.compileMap({bounds,heightTiles:[tile]});const b={pos:{x:-4,y:7,z:0}};
 for(let tick=0;tick<20;tick++){const before=b.pos;if(L.M.sweepMap(map,b,{x:.2,y:0,z:0},.42,3,capsule))b.pos=before;}
 close(b.pos.x,-3,.000001);
});
