import assert from 'node:assert/strict';
import test from 'node:test';
import {relayStream,readRelay} from '../worker/relay-channel.mjs';

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
