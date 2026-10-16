import assert from 'node:assert/strict';
import test from 'node:test';
import {WatchSockets} from '../worker/watch-sockets.mjs';
import {NetRoom} from '../worker/room.mjs';

function watches() {
 const values=new Map(),sockets=[];let closes=0;
 const ctx={storage:{put:async(k,v)=>values.set(k,v),list:async()=>new Map(values),delete:async k=>values.delete(k)},getWebSockets:()=>sockets,acceptWebSocket:s=>sockets.push(s)};
 const socket={attachment:null,serializeAttachment(a){this.attachment=a;},deserializeAttachment(){return this.attachment;},close(){closes++;},send(){}};
 return {values,sockets,ctx,socket,closes:()=>closes};
}
for(const status of [401,409,503])test(`rejected restore ${status} closes the transport`,async()=>{
 const f=watches(),watch=new WatchSockets(f.ctx);await watch.accept(f.socket,new Request('https://room/__net'));
 await new WatchSockets(f.ctx).restore(async()=>new Response(null,{status}));
 assert.equal(f.closes(),1);assert.equal(f.values.size,0);
});
test('restore purges abandoned watch records without retaining watcher IP or agent',async()=>{
 const f=watches(),watch=new WatchSockets(f.ctx);await watch.accept(f.socket,new Request('https://room/__watch',{headers:{'cf-connecting-ip':'192.0.2.1','user-agent':'private-agent'}}));
 assert.equal(JSON.stringify([...f.values.values()]).includes('192.0.2.1'),false);
 assert.equal(JSON.stringify([...f.values.values()]).includes('private-agent'),false);
 f.sockets.length=0;await new WatchSockets(f.ctx).restore(()=>assert.fail('no live sockets'));
 assert.equal(f.values.size,0);
});
test('close replies explicitly for older compatibility dates',async()=>{
 const f=watches(),watch=new WatchSockets(f.ctx);await watch.accept(f.socket,new Request('https://room/__watch'));
 await watch.close(f.socket);assert.equal(f.closes(),1);
});
test('restored watcher neither replays history nor resets its rate bucket',()=>{
 const room=new NetRoom({code:'test'}),sent=[],rate=Array(10).fill(Date.now());
 const watcher=room.watch({send:s=>sent.push(s),browser:'b'}, {rate});
 assert.equal(sent.length,0);watcher.onMessage(JSON.stringify({t:'vote'}));assert.equal(sent.length,0);
});

import {Table} from '../worker/table.mjs';
test('a failed Gate presence query does not stop another Gate or the round alarm',async()=>{
 let woke=0,asked=0;const table=Object.create(Table.prototype);
 Object.assign(table,{relays:new Map([['0',{url:'https://room/?game=g&room=r&gate=0',clients:new Map()}],['1',{url:'https://room/?game=g&room=r&gate=1',clients:new Map()}]]),env:{GATE:{idFromName:x=>x,get:()=>({fetch:async()=>{if(++asked===1)throw Error('restarted');return Response.json([]);}})}},hostRt:{wakeRound:()=>woke++},say(){},flushRoundRecords:async()=>{},flushFunctionEvents:async()=>{},flushBrain:async()=>{},roomAlarm:async()=>{},canSleep:()=>false});
 await table.alarm();assert.equal(woke,1);assert.equal(asked,2);
});

import {DatabaseSync} from 'node:sqlite';
import {roomSessions} from '../worker/room-sessions.mjs';
function storage(t) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let writes=0;
 return {db,get writes(){return writes;},sql:{exec(query,...args){const stmt=db.prepare(query);if(!query.startsWith('SELECT')){if(query.startsWith('INSERT')){writes++;assert.ok(args.every(x=>typeof x!=='string'||Buffer.byteLength(x)<2*1024*1024),'SQLite value limit');}stmt.run(...args);}return {toArray:()=>stmt.all(...args)};}},transactionSync:fn=>fn(),getAlarm:async()=>Date.now()+60000};
}
test('crowd sessions store one relay client per row, share Gate URL, and exclude snapshots',t=>{
 const st=storage(t),store=roomSessions(st);store.read();const room=new NetRoom({code:'crowd'});
 const url='https://room/__net?chat='+ 'a'.repeat(16000);
 for(let i=0;i<300;i++)room.clients.set(String(i),{id:String(i),lastSeen:1,conn:{}});
 room.lastSnap='s'.repeat(3*1024*1024);room.unexpected='private';
 store.write(room,{relayDescriptors:[{url,clients:[...room.clients.keys()].map(id=>[id,id,url,null,null]),pings:[]}]});
 const saved=roomSessions(st).read();assert.equal(saved.table.relayDescriptors[0].clients.length,300);
 assert.equal(saved.fields.has('lastSnap'),false);assert.equal(saved.fields.has('unexpected'),false);
 assert.ok(st.db.prepare('SELECT sum(length(value)) n FROM room_sessions').get().n<150000);
});
test('only meaningful client changes rewrite idle session rows',t=>{
 const st=storage(t),store=roomSessions(st);store.read();const room=new NetRoom({code:'idle'});
 room.clients.set('a',{id:'a',lastSeen:1,conn:{}});store.write(room);const before=st.writes;
 room.clients.get('a').lastSeen=2000;store.write(room);assert.equal(st.writes,before);
 room.clients.get('a').hidden=true;store.write(room);assert.equal(st.writes,before+1);
});

import {writeIdleChat} from '../worker/idle-chat.mjs';
test('unchanged chat does not rewrite storage or read its alarm',async t=>{
 const st=storage(t);let reads=0;st.getAlarm=async()=>{reads++;return Date.now()+60000;};
 await writeIdleChat(st,{at:1,log:[]});const before=st.writes;
 await writeIdleChat(st,{at:2000,log:[]});assert.equal(st.writes,before);assert.equal(reads,1);
 await writeIdleChat(st,{at:3000,log:[{text:'new'}]});assert.equal(st.writes,before+1);
});
test('chat statistics flush at most once per minute',async()=>{
 const table=Object.create(Table.prototype);let flushes=0;table.flushChatPending=async()=>flushes++;
 await table.flushChat();await table.flushChat();assert.equal(flushes,1);
});

import {Lobby} from '../worker/lobby.mjs';
import {lobbyFor,roomShard,LOBBY_SHARDS} from '../worker/lobby-shards.mjs';
test('matchmaking distributes rooms and repeated player reservations remain on one seat allocation',async()=>{
 const objects=new Map(),requests=new Map();const env={LOBBY:{idFromName:x=>x,get(name){if(!objects.has(name)){const values=new Map();objects.set(name,new Lobby({storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)},blockConcurrencyWhile:fn=>fn(),waitUntil(){}},env));}return {fetch:(url,init)=>{requests.set(name,(requests.get(name)??0)+1);return objects.get(name).fetch(new Request(url,init));}};}}};
 const assignments=await Promise.all(Array.from({length:2048},async(_,i)=>{
   const lobby=lobbyFor(env,'g','player-'+i),url='https://lobby/join?max=1';
   const [a,b]=await Promise.all([lobby.fetch(url),lobby.fetch(url)]);const x=await a.json(),y=await b.json();assert.equal(x.room,y.room);return x.room;
 }));
 assert.equal(new Set(assignments).size,2048);assert.ok(objects.size<=LOBBY_SHARDS*2+1);
 assert.equal(new Set(assignments.map(roomShard)).size,LOBBY_SHARDS);
 assert.ok(requests.get('g/match-policy')<=80);
 assert.ok(Math.max(...requests.values())<400,JSON.stringify([...requests]));
});

import {liveRoomSummaries} from '../worker/lobby-summary.mjs';
test('room summaries paginate beyond 500 games and aggregate shards',async()=>{
 const now=Date.now(),rows=Array.from({length:1201},(_,i)=>({game:'g'+String(i).padStart(4,'0'),updated:now,rooms:JSON.stringify([{name:'pub-1',players:1,at:now}])}));
 rows.push({game:'g1200~1',updated:now,rooms:JSON.stringify([{name:'pub-100000001',players:2,at:now}])});let queries=0;
 const DB={prepare(sql){let after='';return {bind(value){after=value;return this;},async all(){queries++;assert.match(sql,/ORDER BY game/);return {results:rows.filter(r=>r.game>after).slice(0,500)};}};}};
 const result=await liveRoomSummaries({DB,BACKGROUND:{}});assert.equal(result.size,1201);assert.equal(result.get('g1200').length,2);assert.equal(queries,3);
});

test('legacy and hidden JSON pings do not rewrite an idle client',t=>{
 const st=storage(t),store=roomSessions(st);store.read();let now=1000;
 const room=new NetRoom({code:'idle',now:()=>now});const h=room.attach({send(){}});
 h.onMessage(JSON.stringify({t:'hello',v:1,rev:12,want:'play'}));
 h.onMessage(JSON.stringify({t:'ping',c:now,hid:true}));store.write(room);const before=st.writes;
 for(let i=0;i<20;i++){now+=2000;h.onMessage(JSON.stringify({t:'ping',c:now,hid:true}));store.write(room);}
 assert.equal(st.writes,before);
});

test('Lobby eviction retains outstanding reservations and reported counts',async t=>{
 const st=storage(t);st.get=async()=>null;st.delete=async()=>true;
 let ready;const ctx={storage:st,blockConcurrencyWhile:fn=>{ready=fn();},waitUntil(){}};
 let lobby=new Lobby(ctx,{});await ready;
 const join=id=>lobby.fetch(new Request('https://lobby/join?max=1&shard=0&reservation='+id)).then(r=>r.json());
 const first=await join('one');lobby=new Lobby(ctx,{});await ready;
 const second=await join('two');assert.notEqual(first.room,second.room);
 await lobby.fetch(new Request('https://lobby/report',{method:'POST',body:JSON.stringify({room:first.room,players:1})}));
 lobby=new Lobby(ctx,{});await ready;
 assert.equal((await (await lobby.fetch(new Request('https://lobby/now'))).json()).players,1);
});

import {games} from '../worker/hosted-registry.mjs';
test('restored character transports reuse their saved lease without reacquiring',async t=>{
 games.set('avatar',{rules:{},settings:{characters:true}});t.after(()=>games.delete('avatar'));
 const room=new NetRoom({code:'r'}),table=Object.create(Table.prototype),held={account:'alice',lease:'lease',character:{}};
 Object.assign(table,{ctx:{},env:{},roomFor:()=>room,ensureHost(){},hydrateHistory:async()=>{},hostRt:{characters:new Map([['alice',held]])},characterGrants:new Map(),accountTokens:{},start(){},acquireCharacter:()=>assert.fail('restoration must not acquire'),restoringSockets:true});
 const transport={resume:{id:'saved',helloed:true},accept(){},send(){},addEventListener(){},close(){}};
 assert.equal(await table.connect(new Request('https://room/__net?game=avatar&room=r&acct=1&via=p-alice'),transport),null);
 assert.equal(table.characterGrants.get('alice'),held);
 table.hostRt.characters.clear();assert.equal((await table.connect(new Request('https://room/__net?game=avatar&room=r&acct=1&via=p-alice'),transport)).status,409);
});

test('closed Table relay is removed so the next Gate request creates a session',()=>{
 const table=Object.create(Table.prototype);Object.assign(table,{ctx:{waitUntil(){}},env:{},relays:new Map(),gateHeld:new Map(),gatePromised:new Map()});
 const url=new URL('https://room/__relay?game=g&room=r&gate=0');const old=table.relayFor(url);old.socket.close(1011,'failed');
 assert.equal(table.relays.size,0);assert.notEqual(table.relayFor(url),old);
});
for(const mode of ['relayed','browser-rules','server'])test(`2-second legacy pings do not persist transport telemetry: ${mode}`,t=>{
 const st=storage(t),store=roomSessions(st);store.read();let now=1000;const sent=[];
 const room=new NetRoom({code:'idle',now:()=>now,rules:mode!=='relayed'});
 if(mode==='server')room.setServerHost({frame(){},facts:()=>({})});
 const h=room.attach({send:s=>sent.push(JSON.parse(s))});h.onMessage(JSON.stringify({t:'hello',v:1,rev:12,want:'play',rules:mode!=='relayed'}));
 const ping=()=>{h.onMessage(JSON.stringify({t:'ping',c:now,hid:false}),mode==='relayed'?now:undefined);const c=[...room.clients.values()][0];if(mode==='server'&&c.probe){now+=10;h.onMessage(JSON.stringify({t:'probeAck',n:c.probe.n}));}};
 ping();store.write(room);const before=st.writes;for(let i=0;i<20;i++){now+=2000;ping();store.write(room);}assert.equal(st.writes,before);
});
test('relay session rows retain only QA marker from user-agent',t=>{
 const st=storage(t),store=roomSessions(st);store.read();const room=new NetRoom({code:'r'}),url='https://room/?game=g';
 store.write(room,{relayDescriptors:[{url,clients:[['a','a',url,null,'private browser'],['b','b',url,null,'private homie-house-qa browser']]}]});
 const clients=roomSessions(st).read().table.relayDescriptors[0].clients;assert.equal(clients[0][4],null);assert.equal(clients[1][4],'homie-house-qa');
});

 test('two strangers in every quiet game share the same public matching pool',async()=>{
 const objects=new Map();const env={LOBBY:{idFromName:x=>x,get(name){if(!objects.has(name)){const values=new Map();objects.set(name,new Lobby({storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)},blockConcurrencyWhile:fn=>fn(),waitUntil(){}},env));}return {fetch:(url,init)=>objects.get(name).fetch(new Request(url,init))};}}};
 for(let i=0;i<32;i++){const a=await(await lobbyFor(env,'quiet'+i,'alice'+i).fetch('https://lobby/join?max=8')).json();const b=await(await lobbyFor(env,'quiet'+i,'bob'+i).fetch('https://lobby/join?max=8')).json();assert.equal(a.room,b.room);}
 });

test('daily peak measures concurrent shard totals, survives restart, and ignores stale reports',async()=>{
 const values=new Map();const ctx={storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v))},blockConcurrencyWhile:fn=>fn(),waitUntil(){}};
 let lobby=new Lobby(ctx,{});
 const report=(shard,players,at)=>lobby.fetch(new Request('https://lobby/peak?game=g',{method:'POST',body:JSON.stringify({shard,players,room:players,at})})).then(r=>r.json());
 const now=Date.now();assert.equal((await report(0,10,now)).players,10);
 assert.equal((await report(0,0,now+1)).players,10);
 assert.equal((await report(1,12,now+2)).players,12,'nonconcurrent peaks are never added');
 assert.equal((await report(0,5,now+3)).players,17);
 assert.equal((await report(0,99,now)).players,17,'late reports cannot inflate concurrent totals');
 lobby=new Lobby(ctx,{});assert.equal((await(await lobby.fetch(new Request('https://lobby/peak?game=g'))).json()).players,17);
});

import {Gate} from '../worker/gate.mjs';
test('a failed openRelay retries without emitting a fatal channel error',async()=>{
 const gate=Object.create(Gate.prototype),pending=[],events=[];let calls=0;
 const socket={emit:name=>events.push(name),attachLive:async()=>{}};
 Object.assign(gate,{link:{},relaySocket:socket,relayEpoch:'gate',ctx:{waitUntil:p=>pending.push(p)},env:{TABLE:{idFromName:x=>x,get:()=>({fetch:async()=>{if(++calls===1)throw Error('deploy');return {headers:new Headers({'x-homie-relay-epoch':'table'}),webSocket:{accept(){}}};}})}}});
 gate.openRelay(new URL('https://room/?game=g&room=r'),socket);await Promise.all(pending);
 assert.equal(calls,2);assert.equal(events.includes('error'),false);assert.deepEqual(events,['reset']);
});

test('peak counter failure is retried by the next shard observation',async()=>{
 let attempts=0;const values=new Map(),env={DB:{prepare:()=>({bind:()=>({})}),batch:async()=>{if(++attempts===1)throw Error('unavailable');}}};
 const {LobbyPeak}=await import('../worker/lobby-peak.mjs');
 const peak=new LobbyPeak({storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)}},env);
 const report=at=>peak.fetch(new Request('https://lobby/peak?game=g',{method:'POST',body:JSON.stringify({shard:0,players:10,room:10,at})}));
 await assert.rejects(report(Date.now()),/unavailable/);await report(Date.now()+1);assert.equal(attempts,2);
});

test('matching entry eviction keeps a reservation on its original shard after load changes',async()=>{
 const {MatchRouter}=await import('../worker/match-router.mjs');const values=new Map(),seen=[];let wide=false;
 const ctx={storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)}};
 const env={LOBBY:{idFromName:x=>x,get:name=>({fetch:async url=>{if(new URL(url).pathname==='/match-policy')return Response.json({wide,until:Date.now()+10000});seen.push(name);return Response.json({room:'reserved'});}})}};
 const request=()=>new Request('https://lobby/match?game=g&reservation=player');
 await new MatchRouter(ctx,env).fetch(request());wide=true;await new MatchRouter(ctx,env).fetch(request());assert.deepEqual(seen,['g','g']);
});
