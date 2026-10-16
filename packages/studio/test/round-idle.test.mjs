import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export {createHost} from './packages/studio/rules/host.ts'; export {defineRules,compileRules,compileMap,roomSettings} from './packages/studio/rules/rules.ts';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {createHost,defineRules,compileRules,compileMap,roomSettings}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const compiled=compileRules(defineRules({contract:2,space:{dims:2},entities:{runner:{player:true}},room:{rounds:{seconds:1,breakSeconds:30},join(c,p){return {kind:'runner',at:{x:p.seat,y:0,z:0}};}}}),{seats:2,map:compileMap({bounds:{min:[-10,-10],max:[10,10]}},'main'),settings:roomSettings({tickHz:10}).settings});
test('settled round freezes its simulation and resumes once after restoring its deadline',()=>{
 let now=0,next=0;const timers=new Map(),frames=[],deadlines=[];
 const clock={now:()=>now,setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id)};
 const options={game:'idle',compiled,clock,random:()=>.37,send:m=>frames.push(m),onRoundIdle:at=>deadlines.push(at)};
 const host=createHost(options);
 host.frame({t:'join',peer:{id:'p1',seat:0,name:'Player',occ:1}});
 for(let i=0;i<15&&timers.size;i++){const [id,timer]=[...timers][0];timers.delete(id);now=timer.at;timer.fn();}
 assert.equal(host.tick,12,'ten live ticks plus two scoring settlement ticks');
 assert.equal(host.running,false);assert.equal(timers.size,0);assert.equal(deadlines.length,1);
 assert.equal(frames.filter(m=>m.t==='round'&&m.round.phase==='over'&&m.round.results).length,1);
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
