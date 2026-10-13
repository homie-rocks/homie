import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGame, writeGame } from './rules-kit.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'homie-substeps-'));
test.after(() => rmSync(scratch, { recursive:true, force:true }));
const source = `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,entities:{runner:{player:true,motion:{presses:f.u16()},input:{ax:f.i8(),jump:f.pulse()},body:{shape:'capsule',radius:.35,height:1.35,maxSpeed:10}}},room:{bots:{keep:0},join(c,p){return {kind:'runner',at:{x:p.seat*2,y:0,z:10}};}}});`;
const movement = `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.substeps(b,300,s=>{if(s.first&&i.jump)b.motion.presses++;b.vel={x:i.ax,y:0,z:b.vel.z-30*s.dt};c.map.sweep(b,{x:b.vel.x*s.dt,y:0,z:b.vel.z*s.dt});});}});`;

test('300 Hz substeps: seeded eight-player restore and prediction use the same guarded integration', async t => {
  const L = await loadGame(scratch, writeGame(scratch,'substeps',{rules:source,move:movement}));
  const map = L.R.compileMap({bounds:{min:[-100,-100,-100],max:[100,100,100]}});
  const c = L.R.compileRules(L.def,{map,seats:8});
  const a = L.C.createCore(c,{seed:480});
  for(let seat=0;seat<8;seat++) a.seatJoin({seat,driver:'person',owner:'p'+seat});
  a.step();
  const b = L.C.createCore(c,{restore:JSON.parse(JSON.stringify(a.save()))});
  for(let tick=0;tick<100;tick++) {
    const inputs = new Map(Array.from({length:8},(_,seat)=>[seat,{values:{ax:(tick+seat)%3-1,jump:tick%17===0?1:0}}]));
    a.step(inputs); b.step(inputs);
    assert.deepEqual(a.save(),b.save());
  }
  assert.equal(a.stats.errors,0,a.stats.lastError);
  assert.equal(a.stats.budgetStops,0);
  assert.equal(a.stats.ticksCut,0);
  const ctx = L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>.35,shape:()=>({shape:'capsule',radius:.35,height:1.35}),dims:3});
  const body = {pos:{x:0,y:0,z:10},vel:{x:0,y:0,z:0},heading:{x:1,y:0,z:0},grounded:false,motion:{presses:0}};
  const out = L.P.stepMove(L.def.move.runner,body,{ax:1,jump:1},ctx,125000,c.kinds[0].motion,3,error=>{throw error;});
  assert.equal(out.steps.length,16);
  assert.equal(out.motion.presses,1,'pulse is handled on the explicitly named first substep');
  assert.equal(out.steps[0].pos.z,10);
  assert.ok(out.steps[7].pos.z>out.steps[15].pos.z);
  assert.equal(out.steps[15].pos.z,body.pos.z);
  t.diagnostic(JSON.stringify({rate:300,players:8,peakTickUnits:a.stats.maxTickUnits,peakHandlerUnits:a.stats.maxUnits}));
});

test('invalid rates fail and a huge rate is charged before callbacks or trace allocation', async () => {
  const L = await loadGame(scratch, writeGame(scratch,'substep-budget',{rules:source,move:movement}));
  const map=L.R.compileMap({bounds:{min:[-10,-10,-10],max:[10,10,10]}});
  const ctx=L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>0,dims:3});
  for(const rate of [0,-20,21,Infinity,NaN]) assert.throws(()=>ctx.substeps({},rate,()=>{}),/integer multiple/);
  let calls=0;
  L.W.G.left=1000;
  assert.throws(()=>ctx.substeps({},2000000000,()=>calls++),/whole share/);
  L.W.G.left=Infinity;
  assert.equal(calls,0);
});
