import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadGame,writeGame,hostRig} from './rules-kit.mjs';
const scratch=mkdtempSync(join(tmpdir(),'contact-latency-'));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
const L=await loadGame(scratch,writeGame(scratch,'latency',{rules:`
import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},entities:{pawn:{player:true,fields:{delay:f.fix()},tick(w,s){s.delay=w.latency(s.id);}}},room:{join(){return{kind:'pawn'};}}});
`}));
const compiled=L.R.compileRules(L.def,{seats:2});
const delay=core=>{const row=core.save().ents[0];return L.P.unpackFields(compiled.kinds[row[2]].fields,row[17],2).delay;};
test('contact latency comes only from trusted relay measurements and is bounded',()=>{
 const r=hostRig(L,compiled);r.join(0);r.ticks();assert.equal(delay(r.host.core),0);
 r.host.frame({t:'latency',seat:0,ms:600});r.ticks();assert.ok(Math.abs(delay(r.host.core)-.6)<.001);
 r.host.frame({t:'latency',seat:0,ms:10000});r.ticks();assert.equal(delay(r.host.core),2);
 r.host.frame({t:'latency',seat:0,ms:NaN});r.ticks();assert.equal(delay(r.host.core),2);
 r.host.stop();
});
test('offline cores default to zero and refuse nonfinite latency',()=>{
 for(const value of [undefined,NaN,Infinity,-1]){
  const core=L.C.createCore(compiled,{latency:()=>value});core.seatJoin({seat:0,driver:'person',owner:'test'});core.step(new Map());assert.equal(delay(core),0);
 }
});
