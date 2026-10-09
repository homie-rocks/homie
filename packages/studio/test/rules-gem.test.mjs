import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PKG, loadGame } from './rules-kit.mjs';
const scratch=realpathSync(mkdtempSync(join(tmpdir(),'homie-gem-')));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
let loaded;
async function kit(){
 const dir=join(PKG,'starters/gem-rush');loaded??=await loadGame(scratch,dir,'gem-rush');const L=loaded;
 const json=p=>JSON.parse(readFileSync(join(dir,p),'utf8'));
 const c=L.R.compileRules(L.def,{tune:json('tunables.json'),map:L.R.compileMap(json('map/main.json')),seats:8});
 return {L,c};
}
test('Gem Rush: crossing and knock keep the old movement timing and distance',async()=>{
 const {L,c}=await kit(),k=c.kinds[0];let tick=0;
 const ctx=L.M.moveContext({tick:()=>tick,tickHz:20,tune:c.publicTune,map:c.map,name:'main',spots:c.map.spots,radius:()=>.44,dims:2});
 let body={pos:{x:.44,y:10,z:0},vel:{x:0,y:0,z:0},heading:{x:1,y:0,z:0},grounded:true,motion:L.P.initFields(k.motion,2)};
 const step=(input)=>{tick++;body=L.P.stepMove(k.move,body,input,ctx,125000,k.motion,2,e=>{throw e})};
 while(body.pos.x<31.56-.001&&tick<200)step({ax:127,ay:0,wave:false});
 assert.equal(tick,93);assert.ok(Math.abs(tick/20-4.633333)/4.633333<.02);
 tick=100;body.pos={x:10,y:10,z:0};body.vel={x:0,y:0,z:0};Object.assign(body.motion,{knockFrom:body.pos,knockDir:{x:1,y:0,z:0},knockAt:101.4,knockUntil:109.8});
 step({ax:-127,ay:0,wave:false});assert.equal(body.pos.x,10,'the first tick holds despite the stick');
 for(let n=0;n<8;n++)step({ax:-127,ay:0,wave:false});
 assert.ok(Math.abs(body.pos.x-13.7)<.01,'lands at the full knock distance');assert.equal(body.motion.knockAt,0);assert.equal(body.vel.x,0);
 step({ax:-127,ay:0,wave:false});assert.ok(body.pos.x<13.7,'steers again from rest');
});
test('Gem Rush: twenty rounds of Fair bots stay inside the old scoring range',async()=>{
 const {L,c}=await kit();const core=L.C.createCore(c,{seed:123});core.setPolicy({bots:'fill'});let rounds=0,total=0;
 for(let n=0;n<30000&&rounds<20;n++){core.step();for(const e of core.drain())if(e.t==='round'&&e.phase==='over'){rounds++;total+=e.results.reduce((sum,r)=>sum+r.score,0);}}
 assert.equal(rounds,20);assert.equal(core.stats.errors,0);assert.ok(Math.abs(total-3342.2)/3342.2<.15,`twenty rounds scored ${total}`);
});
