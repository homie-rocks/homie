import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Gate, batchLink, multiplexSession, roomLayout } from '../worker/gate.mjs';
import { fakeClock } from './rules-kit.mjs';
import { seatCount, perAddress } from '../worker/seats.mjs';
import { scheduledView, snapshotEncoder, snapshotDecoder } from '../rules/interest.mjs';

function socket() {
  const events = new Map();
  return { sent: [], accept() {}, addEventListener(t, fn) { const list = events.get(t) ?? []; list.push(fn); events.set(t, list); },
    emit(t, value) { for (const fn of events.get(t) ?? []) fn(value); }, send(text) { this.sent.push(JSON.parse(text)); }, close() { this.emit('close', {}); } };
}
test('room layouts scale without imposing an admission ceiling; carrier addresses have no default limit', () => {
  assert.deepEqual(roomLayout(300), { gates: 5, concentrators: 0 });
  assert.deepEqual(roomLayout(1000), { gates: 16, concentrators: 2 });
  assert.deepEqual(roomLayout(1280), { gates: 20, concentrators: 3 });
  assert.equal(seatCount(1000), 1000);
  assert.equal(perAddress(300, true), 0);
});
test('virtual-time batches retain every input and command in order, and stop on link death', () => {
  const clock = fakeClock(), peer = socket();
  const link = batchLink(peer, { setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let i = 0; i < 300; i++) link.send(['data', String(i % 20), JSON.stringify({ t: i % 3 ? 'in' : 'ev', k: i })]);
  clock.advance(5);
  assert.deepEqual(peer.sent.flat().map(row => JSON.parse(row[2]).k), Array.from({ length: 300 }, (_, i) => i));
  link.send(['data', '0', 'pending']); link.close(); clock.advance(1000);
  assert.equal(peer.sent.flat().length, 300);
});
test('multiplex admission awaits attach, preserves commands, and closes every logical connection on Gate death', async () => {
  const peer = socket(), attached = [], messages = [], left = [];
  const session = multiplexSession(peer, async (req, conn) => {
    await Promise.resolve();
    const id = new URL(req.url).searchParams.get('id');
    attached.push(id);
    conn.addEventListener('message', event => messages.push([id, event.data]));
    conn.addEventListener('close', () => left.push(id));
  });
  const batch = [];
  for (let i = 0; i < 1000; i++) batch.push(['open', String(i), `https://table/__net?id=${i}`], ['data', String(i), 'hello'], ['data', String(i), 'command']);
  peer.emit('message', { data: JSON.stringify(batch) });
  await session.settled();
  assert.equal(attached.length, 1000); assert.equal(messages.length, 2000);
  for (let i = 0; i < 1000; i++) assert.deepEqual(messages.filter(([id]) => id === String(i)).map(([, value]) => value), ['hello', 'command']);
  peer.close(); peer.close(); assert.equal(left.length, 1000);
});
test('scheduled delivery keeps controlled state exact, updates far bodies on virtual ticks, removes exits immediately', () => {
  const own = ['a', 0, 0, [0.123456,0,0], [1,0,0], [1,0,0], 0, [], [], 0, 0];
  const far = ['b', 0, 0, [8.123456,0,0], [1,0,0], [1,0,0], 0, [], []];
  const select = scheduledView({ radiusM: 12, nearM: 4, farHz: 5, precisionM: .01 }, 20);
  const snap = (k, rows) => ({ e: 1, k, d: [[], rows], c: [] });
  const first = select(snap(1,[own,far]), 0);
  assert.deepEqual(first.d[1][0], own); assert.equal(first.d[1][1][3][0], 8.12);
  const moved = [...far]; moved[3] = [9.87654,0,0];
  assert.equal(select(snap(2,[own,moved]), 0).d[1][1][3][0], 8.12);
  assert.equal(select(snap(4,[own,moved]), 0).d[1][1][3][0], 9.88);
  moved[3] = [20,0,0]; assert.equal(select(snap(5,[own,moved]), 0).d[1].length, 1);
});
test('ordered deltas reject a missing predecessor and recover at the periodic keyframe or new epoch', () => {
  const encoder = snapshotEncoder(4, true), decoder = snapshotDecoder();
  const snap = k => ({ e: 1, k, d: [[], [['a',0,0,[k,0,0],[0,0,0],[1,0,0],0,[],[]]]], c: [] });
  decoder.decode(encoder.encode(snap(1)));
  encoder.encode(snap(2));
  assert.equal(decoder.decode(encoder.encode(snap(3))), null);
  assert.deepEqual(decoder.decode(encoder.encode(snap(5))), snap(5));
});

test('a client send failure detaches only that client, not the Gate or its neighbours', async () => {
  const upstream=socket(), received=[];
  const gate=new Gate({}, {TABLE:{idFromName:n=>n,get:()=>({fetch:async()=>({webSocket:upstream})})}});
  const broken={send(){throw new Error('closed client');},close(){},addEventListener(){}};
  const good={send:text=>received.push(text),close(){},addEventListener(){}};
  const request=()=>new Request('https://table/__net?game=g&room=r&gates=5&gate=0');
  await gate.connect(request(),broken);await gate.connect(request(),good);
  upstream.emit('message',{data:JSON.stringify([['data','1','gone'],['data','2','still here']])});
  assert.deepEqual(received,['still here']);assert.equal(gate.clients.size,1);assert.ok(gate.link);
  gate.link.disconnect();
});

test('a self-driven agent receives its own exact body through spatial scheduling', () => {
  const own=['agent',0,0,[0.123456,0,0],[1,0,0],[1,0,0],0,[],[],3,2];
  const selected=scheduledView({radiusM:0,precisionM:1},20)({e:1,k:1,d:[[],[own]],c:[[3,0,1,0]]},3);
  assert.deepEqual(selected.d[1],[own]);
});

test('the public Worker authorizes the door and routes the chosen 300/1000 capacity to Gates', async () => {
  const {default: worker} = await import('../worker/index.mjs');
  for (const seats of [300,1000]) {
    const routed=[];
    const cat={studio:{name:'Crowd test'},games:[{id:'crowd',name:'Crowd',players:{min:1,max:seats},room:{host:'server',contract:2,tickHz:20}}]};
    const env={ASSETS:{fetch:async()=>Response.json(cat)},GATE:{idFromName:n=>n,get:name=>({fetch:async request=>{routed.push({name,url:new URL(request.url)});return new Response('Gate');}})}};
    const url='https://studio.test/crowd/__net?room=pub-1&b=seeded_browser_0001&max=1&host=browser';
    const response=await worker.fetch(new Request(url,{headers:{upgrade:'websocket'}}),env,{waitUntil(){}});
    assert.equal(response.status,200,await response.text());
    assert.equal(routed.length,1);
    assert.match(routed[0].name,/^crowd\/pub-1\/\d+$/);
    assert.equal(routed[0].url.searchParams.get('max'),String(seats));
    assert.equal(routed[0].url.searchParams.get('host'),'server');
    assert.equal(routed[0].url.searchParams.get('gates'),String(roomLayout(seats).gates));
    cat.games[0].launch='private';
    const refused=await worker.fetch(new Request(url,{headers:{upgrade:'websocket'}}),env,{waitUntil(){}});
    assert.equal(refused.status,403);assert.equal(routed.length,1);
  }
});

test('named server settings preserve a studio-selected crowd capacity', async () => {
  const {serverOf,checkServer,policyOf} = await import('../worker/servers.mjs');
  const result=checkServer({name:'Crowd',policy:'hybrid',seats:1000,aiSeats:200},{create:true});
  assert.equal(result.ok,true);assert.equal(result.fields.seats,1000);
  const server=serverOf({id:'crowd',name:'Crowd',policy:'hybrid',seats:1000,aiSeats:200});
  assert.equal(server.seats,1000);assert.equal(policyOf(server,{seats:1000}).aiSeats,200);
});

test('chained and far-scheduled visual delivery preserves each live collision revision immediately', () => {
  const select=scheduledView({radiusM:0,nearM:0,farHz:1,precisionM:1},20);
  const encode=snapshotEncoder(20,true), decode=snapshotDecoder();
  const own=['person',0,0,[.123,0,0],[0,0,0],[],0,[],[],0,0];
  for(let k=1;k<=3;k++) {
    const geometry=[k,[['wall',k,0,0]]];
    const snap={e:1,k,d:[[],[own],geometry],c:[[0,0,k,0]]};
    const selected=select(snap,0), wire=encode.encode(selected);
    assert.deepEqual(decode.decode(wire).d[2],geometry);
    assert.deepEqual(selected.d[1][0][3],[.123,0,0]);
  }
});


test('a lost chained visual frame does not stall the controlled body or collision revisions', () => {
  const encode=snapshotEncoder(5,true), decode=snapshotDecoder();
  const frame=k=>({e:1,k,d:[[],[['own',0,0,[k+.123,0,0],[0,0,0],[],0,[],[],0,0],['far',0,0,[k,9,0],[0,0,0],[],0,[],[],1,0]],[k,[]]],c:[[0,0,k,0]]});
  decode.decode(encode.encode(frame(1),0));
  encode.encode(frame(2),0); // seeded loss of one predecessor
  const received=decode.decode(encode.encode(frame(3),0));
  assert.deepEqual(received.d[1].find(e=>e[0]==='own')[3],[3.123,0,0]);
  assert.deepEqual(received.d[2],[3,[]]);
  assert.deepEqual(received.c,[[0,0,3,0]]);
  assert.equal(received.d[1].find(e=>e[0]==='far')[3][0],1);
  const leave=frame(4);leave.d[1].pop();
  assert.deepEqual(decode.decode(encode.encode(leave,0)).d[1].map(e=>e[0]),['own'],'exits remain immediate while repairing the remote baseline');
  for(let k=5;k<=6;k++)decode.decode(encode.encode(frame(k),0));
  assert.deepEqual(decode.decode(encode.encode(frame(7),0)),frame(7));
});

test('a slow admission does not hold another player or their ordered inputs', async () => {
  const peer = socket(), received = []; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const session = multiplexSession(peer, async (req, client) => {
    const id = new URL(req.url).pathname;
    if (id === '/slow') await blocked;
    client.addEventListener('message', e => received.push([id,e.data]));
  });
  peer.emit('message',{data:JSON.stringify([['open','1','https://room/slow'],['data','1','hello'],['open','2','https://room/fast'],['data','2','hello'],['data','2','command']])});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.deepEqual(received,[['/fast','hello'],['/fast','command']]);
  release();await session.settled();assert.deepEqual(received.at(-1),['/slow','hello']);peer.close();
});

test('receipt flow control bounds snapshots through a long busy link without a watchdog restart', () => {
  const clock=fakeClock(), peer=socket(); let closes=0;peer.close=()=>closes++;
  const link=batchLink(peer,{receipts:true,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  link.send(['data','0','hello']);clock.advance(5);
  for(let k=1;k<=1200;k++) {
    const snap={k,d:[[],[]]};
    for(let id=0;id<1000;id++)link.send(['view',String(id),snap,id,{},20]);
    if(k===1)link.send(['data','0','command']);
    clock.advance(50);
  }
  assert.equal(peer.sent.length,1);assert.equal(link.facts().pendingViews,1000);assert.equal(closes,0);
  peer.emit('message',{data:JSON.stringify([['ack',1]])});clock.advance(5);
  const rows=peer.sent[1];assert.equal(rows[0][2],'command');
  const views=rows.filter(row=>row[0]==='views');assert.equal(views.length,1);assert.equal(views[0][1].length,1000);assert.equal(views[0][2].k,1200);
  link.close();
});

test('join storm starts logical admission with the first frame, not during handshake transit', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const upstream=socket();
  const gate=new Gate({}, {TABLE:{idFromName:n=>n,get:()=>({fetch:async()=>({webSocket:upstream})})}});
  const clients=Array.from({length:1000},socket);
  await Promise.all(clients.map(client=>gate.connect(new Request('https://table/__net?game=g&room=r&gates=5&gate=0'),client)));
  t.mock.timers.tick(4999);
  assert.equal(upstream.sent.length,0,'Table has no premature logical connections');
  for(const client of clients)client.emit('message',{data:'hello'});
  t.mock.timers.tick(1);
  const rows=upstream.sent.flat();
  assert.equal(rows.filter(row=>row[0]==='open').length,1000);
  assert.equal(rows.filter(row=>row[0]==='data').length,1000);
  assert.equal(gate.clients.size,1000);assert.equal(gate.admissions.size,0);
  gate.link.disconnect();
});

test('a reliable Gate encodes after coalescing, with a full keyframe only on connection or epoch change', async () => {
  const upstream=socket(), client=socket(), decoder=snapshotDecoder();
  const gate=new Gate({}, {TABLE:{idFromName:n=>n,get:()=>({fetch:async()=>({webSocket:upstream})})}});
  await gate.connect(new Request('https://table/__net?game=g&room=r&gates=5&gate=0'),client);
  for (const k of [1,2,4,20,21,100,101]) {
    const snap={e:k===101?2:1,k,d:[[],[['own',0,0,[k,0],[0,0],[],0,[],[],0,0]]],c:[[0,0,k,0]]};
    upstream.emit('message',{data:JSON.stringify([['views',[['1',0]],snap,{radiusM:12},20]])});
    const wire=client.sent.at(-1);
    assert.equal(Array.isArray(wire.d),k===1||k===101,'skipped unsent ticks do not break the ordered delta chain');
    const received=decoder.decode(wire);
    assert.deepEqual(received.d,snap.d);assert.deepEqual(received.c,snap.c);
  }
  gate.link.disconnect();
});

test('a thousand large welcomes wait for relay capacity while established inputs continue', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const peer=socket(), received=[], transports=new Set(); let closed=0, welcomed=0;
  peer.close=()=>closed++;
  const session=multiplexSession(peer,async(req,client)=>{
    transports.add(client.transportFacts);
    client.addEventListener('message',e=>{
      if(e.data==='hello'){welcomed++;client.send(JSON.stringify({t:'welcome',id:req.url,payload:'x'.repeat(20000)}));}
      else received.push(e.data);
    });
  });
  peer.emit('message',{data:JSON.stringify(Array.from({length:1000},(_,i)=>[['open',String(i),'https://room/'+i],['data',String(i),'hello']]).flat())});
  for(let step=0;step<2000 && welcomed<1000;step++){
    t.mock.timers.tick(5);for(let i=0;i<12;i++)await Promise.resolve();
    if(step===20){
      assert.ok(welcomed<1000,'admission stops filling the reliable queue');
      peer.emit('message',{data:JSON.stringify([['data','0','existing input']])});
    }
    if(step>30 && step%10===0)for(const frame of peer.sent.splice(0)){
      const receipt=frame.find(row=>row[0]==='receipt');
      if(receipt)peer.emit('message',{data:JSON.stringify([['ack',receipt[1]]])});
    }
  }
  await session.settled();assert.equal(welcomed,1000);assert.deepEqual(received,['existing input']);assert.equal(closed,0);assert.equal(transports.size,1,'one diagnostics sampler per link, not per player');
  session.shutdown();
});

test('a thousand-slot roster indexes live holders once, preserving names and human labels', async () => {
  const {NetRoom}=await import('../worker/room.mjs');
  const room=Object.create(NetRoom.prototype), slots=Array.from({length:1000},(_,slot)=>({slot,seat:slot,name:'untrusted',bot:true}));
  Object.assign(room,{rules:true,seatCap:1000,maxPlayers:1000,seats:new Map(),stats:{labelled:0}});
  let scans=0;room.live=()=>{scans++;return slots.map(s=>({seat:s.slot,name:'Person '+s.slot}));};
  const roster=room.labelRoster(slots);
  assert.equal(scans,1);assert.equal(roster.length,1000);
  for(const row of roster){assert.equal(row.name,'Person '+row.slot);assert.equal(row.bot,false);}
});
