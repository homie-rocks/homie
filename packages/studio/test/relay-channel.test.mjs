import assert from 'node:assert/strict';
import test from 'node:test';
import {relayChannel,relayStream,readRelay} from '../worker/relay-channel.mjs';

test('detaching output preserves logical clients and drains frames in order on resume',async()=>{
 const pending=[],ctx={waitUntil:p=>pending.push(p)};let wakes=0,closes=0;
 const channel=relayStream(ctx,async()=>{wakes++;});
 channel.addEventListener('close',()=>closes++);
 const frames=[],receiver={emit:(_name,event)=>frames.push(JSON.parse(event.data))};
 channel.send(JSON.stringify([['data','a','welcome']]));
 await Promise.all(pending);
 assert.equal(wakes,1);
 const first=readRelay(new Response(channel.open()),receiver);
 channel.send(JSON.stringify([['data','a','round-over']]));
 channel.sleep();await first;
 assert.equal(closes,0,'transport detach is not a player departure');
 channel.send(JSON.stringify([['data','a','round-start']]));
 await Promise.all(pending);
 const next=readRelay(new Response(channel.open()),receiver);
 channel.sleep();await next;
 assert.equal(wakes,2);
 assert.deepEqual(frames.flat().map(row=>row[2]),['welcome','round-over','round-start']);
 assert.equal(closes,0);
});

test('a stale stream cancellation cannot disconnect its replacement',async()=>{
 const channel=relayStream({waitUntil(){}},async()=>{});
 const old=channel.open().getReader();
 const next=channel.open().getReader();
 await old.cancel();
 channel.send('[]');channel.sleep();
 assert.equal(new TextDecoder().decode((await next.read()).value),'[]\n');
 assert.equal((await next.read()).done,true);
});


test('pending input bytes are bounded even before the first binding response',async()=>{
 const pending=[];let release;
 const held=new Promise(resolve=>{release=resolve;});
 const channel=relayChannel({waitUntil:p=>pending.push(p)},async()=>{await held;return new Response(null,{status:204});});
 channel.send('x'.repeat(4*1024*1024));
 assert.throws(()=>channel.send('x'),/queue limit/);
 release();await Promise.all(pending);
 channel.send('[]');await Promise.all(pending);
});

test('a stalled Table accepts more than eight input batches without dropping the Gate',async()=>{
 const pending=[],received=[];let release;const held=new Promise(r=>release=r);
 const channel=relayChannel({waitUntil:p=>pending.push(p)},async data=>{await held;received.push(...JSON.parse(data));return new Response(null,{status:204});});
 for(let i=0;i<40;i++)assert.doesNotThrow(()=>channel.send(JSON.stringify([['data','p',String(i)]])));
 release();await Promise.all(pending);assert.equal(received.length,40);
});

test('a live socket closed during HTTP drain falls back without dropping the Gate',async()=>{
 let release,posts=0;const pending=[],held=new Promise(r=>release=r),listeners=new Map();
 const channel=relayChannel({waitUntil:p=>pending.push(p)},async()=>{posts++;await held;return new Response(null,{status:204});});
 channel.send('[]');
 const socket={readyState:1,addEventListener:(name,fn)=>listeners.set(name,fn),send(){assert.equal(this.readyState,1,'must not send on detached socket');},close(){this.readyState=3;}};
 const attached=channel.attachLive(socket);socket.close();listeners.get('close')();release();await attached;
 assert.doesNotThrow(()=>channel.send('[]'));await Promise.all(pending);assert.equal(posts,2);assert.equal(channel.isLive(),false);
});

test('transient POST failure retries the same ordered batch without closing',async()=>{
 const pending=[],received=[];let attempts=0,errors=0;
 const channel=relayChannel({waitUntil:p=>pending.push(p)},async(data,sequence)=>{
   received.push([data,sequence]);if(++attempts===1)throw Error('deploy');return new Response(null,{status:204});
 },{sleep:async()=>{}});
 channel.addEventListener('error',()=>errors++);channel.send('first');channel.send('second');
 await Promise.all(pending);assert.equal(errors,0);assert.deepEqual(received.map(x=>x[0]),['first','first','second']);
 assert.equal(received[0][1],received[1][1]);assert.notEqual(received[1][1],received[2][1]);
});
test('failed wake retries without destroying the output session',async()=>{
 const pending=[];let calls=0,errors=0;
 const stream=relayStream({waitUntil:p=>pending.push(p)},async()=>{if(++calls===1)throw Error('reset');},{sleep:async()=>{}});
 stream.addEventListener('error',()=>errors++);stream.send('hello');await Promise.all(pending);
 assert.equal(errors,0);assert.equal(calls,2);const reader=stream.open().getReader();
 assert.equal(new TextDecoder().decode((await reader.read()).value),'hello\n');await reader.cancel();
});
test('output queue exposes backpressure and resumes when drained',async()=>{
 const stream=relayStream({waitUntil(){}},async()=>{});let drains=0;stream.addEventListener('drain',()=>drains++);
 stream.send('x'.repeat(4*1024*1024-1));assert.equal(stream.canSend(2),false);
 const reader=stream.open().getReader();await reader.read();await Promise.resolve();
 assert.equal(stream.canSend(2),true);assert.ok(drains>0);await reader.cancel();
});

test('closing an active Table relay tells the Gate to reconnect its players',()=>{
 const sent=[],stream=relayStream({waitUntil(){}},async()=>{});
 stream.attachLive({readyState:1,send:s=>sent.push(JSON.parse(s)),close(){},addEventListener(){}});
 stream.close(1011,'failed');assert.deepEqual(sent,[[['link-close',1011,'failed']]]);
});
