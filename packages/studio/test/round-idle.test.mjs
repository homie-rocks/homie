import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export {createHost} from './packages/studio/rules/host.ts'; export {defineRules,defineMove,compileRules,compileMap,roomSettings,f} from './packages/studio/rules/rules.ts';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {createHost,defineRules,defineMove,compileRules,compileMap,roomSettings,f}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
for (const owner of [false,true]) {
const compiled=compileRules(defineRules({contract:2,space:{dims:2},...(owner?{move:defineMove({runner(b){b.vel={x:0,y:0,z:0};}})}:{}),shapes:{events:{hop:{},award:{}}},entities:{runner:{player:true,...(owner?{body:{shape:'box',radius:.5,maxSpeed:4,move:'validated-owner'}}:{}),fields:{score:f.u16({score:true}),settled:f.u16()},tick(world,self){if(world.tick===9)world.send(self.id,'hop',{});},on:{hop(world,self){world.send(self.id,'award',{});},award(world,self){self.score++;}},onRoom:{roundOver(world,self){self.settled++;}}}},room:{rounds:{seconds:1,breakSeconds:30},join(c,p){return {kind:'runner',at:{x:p.seat,y:0,z:0}};}}}),{seats:2,map:compileMap({bounds:{min:[-10,-10],max:[10,10]}},'main'),settings:roomSettings({tickHz:10}).settings});
test(`settled ${owner?'validated-owner catch-up':'stationary'} round freezes and resumes once after restoring its deadline`,()=>{
 let now=0,next=0;const timers=new Map(),frames=[],deadlines=[];
 const clock={now:()=>now,setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id)};
 const options={game:'idle',compiled,clock,enforceOverrun:owner,random:()=>.37,send:m=>frames.push(m),onRoundIdle:at=>deadlines.push(at)};
 const host=createHost(options);
 host.frame({t:'join',peer:{id:'p1',seat:0,name:'Player',occ:1}});
 for(let i=0;i<15&&timers.size;i++){const [id,timer]=[...timers][0];timers.delete(id);now=timer.at+(owner?350:0);timer.fn();}
 assert.equal(host.tick,12,'ten live ticks plus two scoring settlement ticks');
 assert.equal(host.running,false);assert.equal(timers.size,0);assert.equal(deadlines.length,1);
 assert.equal(frames.filter(m=>m.t==='round'&&m.round.phase==='over'&&m.round.results).length,1);
 assert.equal(host.core.round().results[0].score,1,'a score in flight at round end is counted');
 assert.equal(host.core.snapshot()[1][0][7][1],1,'roundOver handlers run before suspension');
 const until=host.roundIdleUntil,bytes=host.save();
 const restored=createHost({...options,restore:bytes,restoreEpoch:host.epoch+1});
 restored.frame({t:'join',peer:{id:'p1',seat:0,name:'Player',occ:1}});
 now=until-1;restored.wakeRound();assert.equal(restored.tick,12);assert.equal(timers.size,0);
 now=until;restored.wakeRound();restored.wakeRound();
 assert.equal(restored.core.round().n,2);assert.equal(restored.running,true);assert.equal(timers.size,1);
 const [id,timer]=[...timers][0];timers.delete(id);now=timer.at;timer.fn();
 assert.equal(restored.tick,13,'no catch-up simulation during the break');
 restored.stop();host.stop();
});

}
