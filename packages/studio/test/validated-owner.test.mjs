import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadGame,writeGame,hostRig} from './rules-kit.mjs';
const scratch=mkdtempSync(join(tmpdir(),'owner-validation-'));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
const L=await loadGame(scratch,writeGame(scratch,'owner',{rules:`
import {defineRules,defineMove,f} from '@homie-rocks/studio/rules';
const move=defineMove({pawn(b,i,c){b.vel={x:i.x*4,y:b.vel.y+10*c.dt,z:0};c.map.sweep(b,{x:b.vel.x*c.dt,y:b.vel.y*c.dt,z:0});}});
export default defineRules({contract:2,space:{dims:2},move,entities:{pawn:{player:true,input:{x:f.i8()},body:{shape:'box',radius:.5,maxSpeed:20,move:'validated-owner'}}},room:{join(){return{kind:'pawn',at:{x:0,y:0,z:0}};}}});
`}), 'owner');
const compile=()=>L.R.compileRules(L.def,{settings:L.R.roomSettings({host:'server'}).settings,seats:2,map:L.R.compileMap({bounds:{min:[-10,-10],max:[10,10]},boxes:[{min:[1,-5],max:[2,5]}]})});
function setup(){const c=compile(),core=L.C.createCore(c);core.seatJoin({seat:0,driver:'person',owner:'p'});core.step(new Map([[0,{values:{x:0},reports:[]}]]));return{core,c};}
const state=core=>{const w=core.save().ents[0];return{r:w[3],pos:{x:w[7][0],y:w[7][1],z:0},vel:{x:w[8][0],y:w[8][1],z:0}};};
const report=(core,x=.2,y=.025,vx=4,vy=.5)=>({tick:core.tick+1,base:core.tick,r:state(core).r,pos:{x,y,z:0},vel:{x:vx,y:vy,z:0},heading:{x:1,y:0,z:0},values:{x:1}});
const apply=(core,reports)=>core.step(new Map([[0,{values:{x:0},reports}]]));
test('valid report accepted, duplicate does not move again, missing reports freeze',()=>{const{core}=setup();const r=report(core);apply(core,[r]);assert.equal(state(core).r,r.r);assert.ok(Math.abs(state(core).pos.x-.2)<1e-6);apply(core,[r]);assert.ok(Math.abs(state(core).pos.x-.2)<1e-6);});
for(const [name,x,y,vx,vy] of [['speed',.8,.025,16,.5],['teleport',8,.025,4,.5],['gravity',.2,-.2,4,-4],['wall-pass',3,.025,4,.5],['NaN',NaN,.025,4,.5]])test(`reject forged ${name} as a cut`,()=>{const{core}=setup(),r=report(core,x,y,vx,vy);apply(core,[r]);assert.equal(state(core).r,(r.r+1)&65535);assert.equal(state(core).pos.x,0);});
test('out of order reports wait for missing predecessor',()=>{const{core}=setup(),a=report(core),b={...a,tick:a.tick+1,pos:{x:.4,y:.075,z:0},vel:{x:4,y:1,z:0}};apply(core,[b]);assert.equal(state(core).pos.x,0);apply(core,[a]);assert.equal(state(core).r,a.r);assert.ok(Math.abs(state(core).pos.x-.4)<1e-6);});
test('transport decodes reports and ignores claims from an old placement',()=>{const c=compile(),r=hostRig(L,c);r.join(0);r.ticks();const k=r.host.tick,start=state(r.host.core);r.host.frame({t:'in',from:0,e:r.host.epoch,k:k+1,r:start.r,s:[[0,1,.2,.025,0,4,.5,0,1,0,0,k,-471,1,0]]});r.ticks();assert.equal(state(r.host.core).r,start.r);assert.ok(Math.abs(state(r.host.core).pos.x-.2)<1e-6);r.host.stop();});
test('a burst cannot buy extra simulation time',()=>{const{core}=setup(),a={...report(core,0,.025,0,.5),values:{x:0}},b={...a,tick:a.tick+1,pos:{x:0,y:.075,z:0},vel:{x:0,y:1,z:0}},c={...a,tick:a.tick+2,pos:{x:0,y:.15,z:0},vel:{x:0,y:1.5,z:0}};apply(core,[a,b,c]);assert.ok(Math.abs(state(core).pos.y-.075)<1e-6);apply(core,[]);assert.ok(Math.abs(state(core).pos.y-.15)<1e-6);});
test('a rejected report fences all reports from the old revision',()=>{const{core}=setup(),bad=report(core,8),good=report(core);apply(core,[bad]);const r=state(core).r;apply(core,[good]);assert.equal(state(core).r,r);assert.equal(state(core).pos.x,0);});
test('report tolerance cannot accumulate into extra speed',()=>{const{core}=setup();const base=core.tick,r=state(core).r;for(let i=1;i<=2;i++)apply(core,[{tick:base+i,base,r,pos:{x:.2*i+.0019,y:.025*i*(i+1)/2,z:0},vel:{x:4,y:.5*i,z:0},heading:{x:1,y:0,z:0},values:{x:1}}]);assert.equal(state(core).r,r);assert.ok(Math.abs(state(core).pos.x-.4)<1e-6);});
test('wall crossing is rejected even at legal speed and legal one-tick distance',()=>{const{core}=setup(),a=report(core),base=a.base;apply(core,[a]);apply(core,[{...a,tick:a.tick+1,pos:{x:.4,y:.075,z:0},vel:{x:4,y:1,z:0}}]);const before=state(core);apply(core,[{...a,base,tick:a.tick+2,pos:{x:.6,y:.15,z:0},vel:{x:4,y:1.5,z:0}}]);assert.equal(state(core).r,(before.r+1)&65535);assert.equal(state(core).pos.x,before.pos.x);});

test('a fresh baseline after a pause grants one physics step, never skipped travel',()=>{const{core}=setup();const a=report(core);apply(core,[a]);for(let i=0;i<4;i++)apply(core,[]);const b={...a,tick:core.tick+1,base:core.tick,pos:{x:.4,y:.075,z:0},vel:{x:4,y:1,z:0}};apply(core,[b]);assert.equal(state(core).r,a.r);assert.ok(Math.abs(state(core).pos.x-.4)<1e-6);for(let i=0;i<4;i++)apply(core,[]);apply(core,[{...b,tick:core.tick+1,base:core.tick,pos:{x:1.4,y:.15,z:0},vel:{x:4,y:1.5,z:0}}]);assert.equal(state(core).r,(a.r+1)&65535);assert.ok(Math.abs(state(core).pos.x-.4)<1e-6);});
