import test from 'node:test';
import assert from 'node:assert/strict';
import {Gate} from '../worker/gate.mjs';
import {Table} from '../worker/table.mjs';
import {NetRoom} from '../worker/room.mjs';
import {Lobby} from '../worker/lobby.mjs';
import {LobbyPeak} from '../worker/lobby-peak.mjs';
import {lobbyFor,roomShard} from '../worker/lobby-shards.mjs';
import {virtualTime} from './virtual-time.mjs';

for(const failure of ['idle','invalid frame'])test(`a new relay link seats and accepts inputs after ${failure}`,async t=>{
 const clock=virtualTime(t),pending=[],room=new NetRoom({code:'r',rules:true}),inputs=[];
 room.setServerHost({frame:m=>{if(m.t==='in')inputs.push(m);},facts:()=>({})});
 const ctx={waitUntil:p=>pending.push(p)};
 const table=Object.create(Table.prototype);Object.assign(table,{ctx,env:{},relays:new Map(),gateHeld:new Map(),gatePromised:new Map(),canSleep:()=>false,saveSessions(){},connect(_request,transport){
   const peer=room.attach({send:text=>transport.send(text),close:(...args)=>transport.close(...args)});
   transport.addEventListener('message',e=>peer.onMessage(e.data));transport.addEventListener('close',()=>peer.onClose());
 }});
 const gate=new Gate(ctx,{TABLE:{idFromName:x=>x,get:()=>({fetch:(url,init)=>table.fetch(new Request(url,init))})}});
 gate.openRelay=(url,socket)=>table.relayFor(url).socket.attachLive({readyState:1,send:data=>socket.emit('message',{data}),addEventListener(){},close(){}});
 const client=()=>{const handlers={},frames=[];return {frames,send:text=>frames.push(JSON.parse(text)),close(){handlers.close?.();},addEventListener:(n,fn)=>handlers[n]=fn,emit:data=>handlers.message({data})};};
 const request=new Request('https://room/__net?game=g&room=r&relay=1&gate=0');
 const a=client();await gate.connect(request,a);a.emit('{"t":"hello","v":1,"rev":12,"rules":true,"want":"play"}');await clock.wait(60);a.emit('{"t":"in","k":1,"s":[]}');await clock.wait(60);
 if(failure==='idle'){a.close();await clock.wait(10001);}else gate.relaySocket.emit('message',{data:'invalid'});
 const before=inputs.length,b=client();await gate.connect(request,b);b.emit('{"t":"hello","v":1,"rev":12,"rules":true,"want":"play"}');await clock.wait(60);b.emit('{"t":"in","k":2,"s":[]}');await clock.wait(60);await Promise.all(pending);
 assert.ok(b.frames.some(m=>m.t==='welcome'&&Number.isInteger(m.seat)),'new player is seated');
 assert.equal(inputs.length,before+1,'new input accepted by room host');assert.equal(inputs.at(-1).k,2);
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


test('a server timer pause gives queued client traffic time to arrive before silence eviction',()=>{
 let now=100000;const closed=[],room=new NetRoom({code:'paused',rules:true,now:()=>now});
 room.setServerHost({frame(){},facts:()=>({})});
 const peers=[0,1].map(i=>room.attach({send(){},close:(code,reason)=>closed.push({i,code,reason})}));
 for(const peer of peers)peer.onMessage(JSON.stringify({t:'hello',v:1,rev:12,rules:true,want:'play'}));
 room.tick();now+=250;room.tick();now+=15000;room.tick();
 assert.deepEqual(closed,[],'a delayed timer is not evidence that the clients stopped sending');
 peers[0].onMessage(JSON.stringify({t:'ping',c:now}));now+=2499;room.tick();assert.deepEqual(closed,[]);
 now++;room.tick();assert.deepEqual(closed.map(c=>c.i),[1],'a genuinely silent socket still expires after bounded grace');
 for(let i=0;i<41;i++){now+=250;room.tick();}assert.ok(closed.some(c=>c.i===0),'grace cannot keep an abandoned socket forever');
});
