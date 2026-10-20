import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {drainStatus,drainSince,isAdmission,DRAIN_IDLE_MS} from '../worker/move-drain.mjs';
import {Table} from '../worker/table.mjs';
import {drainCommand} from '../lib/move-drain.mjs';
const env=(clients=0,pending=0)=>({DB:{prepare:()=>({first:async()=>({value:'1000'}),bind:()=>({first:async()=>({value:'1000'}),all:async()=>({results:[]})})})},LOBBY:{idFromName:s=>s,get:()=>({fetch:async()=>Response.json({rooms:[{name:'private-room'}]})})},TABLE:{idFromName:s=>s,get:()=>({fetch:async()=>Response.json({clients,pending,idleEnded:false})})}});
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

/** One Kart Royale room on a real Table (its own SQLite and storage), the studio's D1 holding a drain that began
 * `drainAgo` ms ago, and one guest phone in it. `drainStatus` measures it through the Table's own fetch. */
async function movingRoom(t,drainAgo){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const kv=new Map(),waits=[],lobby=[];
 const storage={sql:{exec:(q,...a)=>{const st=db.prepare(q);return /^\s*SELECT/i.test(q)?{toArray:()=>st.all(...a)}:(st.run(...a),{toArray:()=>[]});}},transactionSync:fn=>fn(),getAlarm:async()=>null,setAlarm:async()=>{},get:async k=>kv.get(k),put:async(k,v)=>{kv.set(k,structuredClone(v));},delete:async k=>kv.delete(k),list:async()=>new Map()};
 const since=Date.now()-drainAgo;
 const DB={prepare:()=>({bind:()=>({first:async()=>({value:String(since)}),all:async()=>({results:[{key:'move-room:kart:100001968'}]})})})};
 const env={DB,LOBBY:{idFromName:s=>s,get:()=>({fetch:async(url,init)=>{if(init?.body)lobby.push(JSON.parse(init.body));return Response.json({ok:true,rooms:[]});}})}};
 let ready;const table=new Table({storage,waitUntil:p=>waits.push(p),blockConcurrencyWhile:fn=>{ready=fn();}},env);await ready;
 env.TABLE={idFromName:s=>s,get:()=>({fetch:(url,init)=>table.fetch(new Request(url,init))})};
 const room=table.roomFor('kart','100001968',8);
 const phone={sent:[],closed:null,send(text){this.sent.push(JSON.parse(text));},close(code,why){this.closed=[code,why];}};
 const peer=room.attach(phone);
 peer.onMessage(JSON.stringify({t:'hello',v:1,device:'phone',want:'play',canHost:true,name:'Laser Magpie'}));
 assert.equal(room.live().length,1,'the guest phone is in the room');
 const status=async()=>{const s=await drainStatus(env,{games:[{id:'kart'}]});await Promise.allSettled(waits);return s;};
 return {room,phone,peer,lobby,since,status,env};
}
test('a tab left open in a lobby is ended once the drain passes its grace period, and the drain then reports drained',async t=>{
 const f=await movingRoom(t,DRAIN_IDLE_MS+1000);
 const s=await f.status();
 assert.equal(s.clients,0);assert.equal(s.pending,0);assert.equal(s.idleLobbiesEnded,1);assert.equal(s.drained,true);
 const said=f.phone.sent.find(m=>m.t==='error');
 assert.equal(said.code,'room-over');assert.equal(said.message,'This studio is moving. Please join again shortly.');
 assert.equal(said.rematch,undefined,'final: the page does not knock on the paused door again');
 assert.deepEqual(f.phone.closed,[1000,'room-over']);
 assert.ok(f.lobby.some(r=>r.room==='100001968'&&r.ended===true),'the Lobby forgets the room');
 const again=await f.status();
 assert.equal(again.idleLobbiesEnded,1,'every later census still says why it drained');assert.equal(again.drained,true);
 const root=mkdtempSync(join(tmpdir(),'homie-drain-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Example',cloudflare:{d1:'example-db'}}));
 const cli=await drainCommand(root,'status',{fetchFn:async()=>Response.json(again),url:'https://studio.example'});
 assert.equal(cli.idleLobbiesEnded,1);assert.match(cli.message,/1 room was ended while waiting in a lobby/);
});
test('a room with a round in progress keeps playing through the drain',async t=>{
 const f=await movingRoom(t,DRAIN_IDLE_MS+1000),now=Date.now();
 f.peer.onMessage(JSON.stringify({t:'round',round:{n:1,phase:'live',startedAt:now,endsAt:now+90000}}));
 const s=await f.status();
 assert.equal(s.clients,1);assert.equal(s.idleLobbiesEnded,0);assert.equal(s.drained,false);
 assert.equal(f.phone.closed,null);assert.equal(f.room.live().length,1);
 f.peer.onMessage(JSON.stringify({t:'round',round:{n:1,phase:'over',startedAt:now,endsAt:now+8000,results:[]}}));
 assert.equal((await f.status()).clients,1,'its results are on screen for a moment first');
});
test('before the grace period a lobby is left alone',async t=>{
 const f=await movingRoom(t,DRAIN_IDLE_MS-60000);
 const s=await f.status();
 assert.equal(s.clients,1);assert.equal(s.idleLobbiesEnded,0);assert.equal(s.drained,false);
 assert.equal(f.phone.closed,null);assert.equal(f.phone.sent.some(m=>m.t==='error'),false);
});
