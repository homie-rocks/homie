import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drainStatus,drainSince,isAdmission} from '../worker/move-drain.mjs';
const env=(clients=0,pending=0)=>({DB:{prepare:()=>({first:async()=>({value:'1000'}),bind:()=>({first:async()=>({value:'1000'}),all:async()=>({results:[]})})})},LOBBY:{idFromName:s=>s,get:()=>({fetch:async()=>Response.json({rooms:[{name:'private-room'}]})})},TABLE:{idFromName:s=>s,get:()=>({fetch:async()=>Response.json({clients,pending})})}});
test('drain waits for existing clients, pending records, and in-flight admissions to settle',async()=>{
 const cat={games:[{id:'private-game'}]};
 assert.equal((await drainStatus(env(),cat,{now:2000})).drained,false);
 assert.equal((await drainStatus(env(1),cat,{now:300000})).drained,false);
 assert.equal((await drainStatus(env(0,1),cat,{now:300000})).drained,false);
 assert.equal((await drainStatus(env(),cat,{now:300000})).drained,true);
});
test('drain never treats an unreachable shard or room as empty',async()=>{
 const e=env();e.LOBBY.get=()=>({fetch:async()=>new Response('',{status:503})});
 await assert.rejects(drainStatus(e,{games:[{id:'game'}]}),/Cannot measure/);
 const f=env();f.TABLE.get=()=>({fetch:async()=>Response.json({})});
 await assert.rejects(drainStatus(f,{games:[{id:'game'}]}),/Invalid room/);
});
test('admission includes named sockets and matchmakers; ordinary pages keep answering',()=>{
 for(const path of ['/game/__net','/game/__watch'])assert.equal(isAdmission(new Request('https://studio.test'+path,{headers:{upgrade:'websocket'}})),true);
 assert.equal(isAdmission(new Request('https://studio.test/game/api/lobby')),true);
 assert.equal(isAdmission(new Request('https://studio.test/game/play')),false);
});
