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
