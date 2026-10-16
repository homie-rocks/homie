import test from 'node:test';
import assert from 'node:assert/strict';
import {Gate} from '../worker/gate.mjs';
import {Table} from '../worker/table.mjs';
import {Lobby} from '../worker/lobby.mjs';
import {LobbyPeak} from '../worker/lobby-peak.mjs';
import {lobbyFor,roomShard} from '../worker/lobby-shards.mjs';
import {virtualTime} from './virtual-time.mjs';

for(const failure of ['idle','invalid frame'])test(`a new relay link seats and accepts inputs after ${failure}`,async t=>{
 const clock=virtualTime(t),pending=[],accepted=[],relay={session:{reset(){}}};
 const table=Object.create(Table.prototype);Object.assign(table,{relayFor:()=>relay,relayInput:async(_relay,data)=>accepted.push(...JSON.parse(data))});
 const ctx={waitUntil:p=>pending.push(p)};
 const gate=new Gate(ctx,{TABLE:{idFromName:x=>x,get:()=>({fetch:(url,init)=>table.fetch(new Request(url,init))})}});
 gate.openRelay=()=>{};
 const client=()=>{const handlers={};return {send(){},close(){handlers.close?.();},addEventListener:(n,fn)=>handlers[n]=fn,emit:data=>handlers.message({data})};};
 const request=new Request('https://room/__net?game=g&room=r&relay=1');
 const a=client();await gate.connect(request,a);a.emit('{"t":"hello"}');await clock.wait(60);a.emit('{"t":"in","n":1}');await clock.wait(60);
 if(failure==='idle'){a.close();await clock.wait(10001);}else gate.relaySocket.emit('message',{data:'invalid'});
 const before=accepted.length,b=client();await gate.connect(request,b);b.emit('{"t":"hello"}');await clock.wait(60);b.emit('{"t":"in","n":2}');await clock.wait(60);await Promise.all(pending);
 assert.ok(accepted.slice(before).some(row=>row[0]==='open'),'new player admission reaches Table');
 assert.ok(accepted.slice(before).some(row=>row[0]==='data'&&row[2].includes('"n":2')),'new inputs reach Table');
 b.close();gate.rest();
});
function matching(){
 const objects=new Map(),requests=new Map();const env={LOBBY:{idFromName:x=>x,get(name){if(!objects.has(name)){const values=new Map();objects.set(name,new Lobby({storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v))},blockConcurrencyWhile:fn=>fn(),waitUntil(){}},env));}return {fetch:(url,init)=>{requests.set(name,(requests.get(name)??0)+1);return objects.get(name).fetch(new Request(url,init));}};}}};
 const join=id=>lobbyFor(env,'g',id).fetch('https://lobby/join?max=8').then(r=>r.json());
 const report=(room,players)=>lobbyFor(env,'g').fetch('https://lobby/report',{method:'POST',body:JSON.stringify({room,players})});
 return {env,objects,requests,join,report};
}
test('twenty arrivals over a minute fill shared eight-seat rooms',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000000});const f=matching(),counts=new Map();
 for(let i=0;i<20;i++){const row=await f.join('player-'+i);counts.set(row.room,(counts.get(row.room)??0)+1);await f.report(row.room,counts.get(row.room));t.mock.timers.tick(i%5===4?15000:1);}
 assert.deepEqual([...counts.values()],[8,8,4]);
});
test('quiet joins find open rooms in every previously busy pool',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000000});const f=matching();
 for(let shard=1;shard<16;shard++){
  const stub=f.env.LOBBY.get('g/shard/'+shard),row=await(await stub.fetch('https://lobby/join?max=8&shard='+shard)).json();
  await f.report(row.room,7);
  const joined=await f.join('quiet-'+shard);assert.equal(joined.room,row.room);await f.report(row.room,8);
 }
});
test('unchanged peaks write nothing and a burst of rises is coalesced',async t=>{
 const clock=virtualTime(t),values=new Map(),pending=[];let writes=0;
 const peak=new LobbyPeak({storage:{get:async k=>values.get(k),put:async(k,v)=>{writes++;values.set(k,structuredClone(v));}},waitUntil:p=>pending.push(p)},{});
 const report=(players,at)=>peak.fetch(new Request('https://lobby/peak?game=g',{method:'POST',body:JSON.stringify({shard:0,players,room:players,at})}));
 for(let i=1;i<=16;i++)await report(i,Date.now()+i);
 await clock.wait(1100);await Promise.all(pending);assert.equal(writes,1);
 for(let i=1;i<=32;i++)await report(1,Date.now()+i);
 await clock.wait(1100);await Promise.all(pending);assert.equal(writes,1);
 assert.equal(values.get('concurrent-peak').players,16);
});
