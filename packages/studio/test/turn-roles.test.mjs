import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineRules,compileRules,compileMap,f} from '../rules/rules.ts';
import {createHost} from '../rules/host.ts';
import {fakeClock} from './rules-kit.mjs';

test('turn players need no physics body, owner roles never reach another seat, and room phase timers advance',()=>{
 const compiled=compileRules(defineRules({contract:2,space:{dims:2},shapes:{events:{next:{}}},shared:{phase:f.u8()},entities:{participant:{player:true,fields:{role:f.text(32,{visibility:'owner'}),secret:f.text(32,{visibility:'server'})}}},room:{start(w){w.after(2,'next',{});},on:{next(w){w.shared.phase++;w.after(2,'next',{});}},join(_w,p){return {kind:'participant',at:{x:0,y:0,z:0},fields:{role:p.seat===0?'observer':'keeper',secret:'server-only'}};}}}),{map:compileMap({bounds:{min:[-1,-1],max:[1,1]}}),seats:2});
 const host=createHost({game:'roles',compiled,clock:fakeClock(),random:()=>.42,send:()=>{}});
 try {
  for(let seat=0;seat<2;seat++)host.frame({t:'join',peer:{id:'p'+seat,seat,occ:1}});
  for(let i=0;i<6;i++)host.tickNow();
  assert.equal(host.core.stats.errors,0,host.core.stats.lastError);
  assert.equal(compiled.kinds[0].body,null);
  const raw=host.core.snapshot();assert.ok(JSON.stringify(raw).includes('server-only'));
  for(const seat of [0,1,null]) {
   const projected=JSON.stringify(host.projectSnapshot({d:raw},seat));
   assert.equal(projected.includes('server-only'),false);
   assert.equal(projected.includes('observer'),seat===0);assert.equal(projected.includes('keeper'),seat===1);
  }
  assert.ok(host.core.save().shared[0]>=2);
 }finally{host.stop();}
});
