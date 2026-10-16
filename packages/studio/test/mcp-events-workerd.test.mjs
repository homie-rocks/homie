import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {Webhook} from 'standardwebhooks';
import {randomBytes} from 'node:crypto';
import {jsonSseReader,nextSseJson} from './sse-fixture.mjs';

test('workerd advertises Events, serves protocol methods, pushes SSE and delivers signed webhooks',{timeout:60000},async()=>{
 const secret='whsec_'+randomBytes(32).toString('base64'),received=[];
 const cat={studio:{name:'Events'},games:[]};
 const bundled=await build({stdin:{resolveDir:new URL('../worker/',import.meta.url).pathname,contents:`
 import {remoteMcp} from './mcp.mjs';
 import {syncFunctions,emitEvent,runFunctions} from './functions.mjs';
 import {EventStreams} from './event-resources.mjs';
 import {DurableObject} from 'cloudflare:workers';
 export class Hub extends DurableObject {constructor(ctx,env){super(ctx,env);this.streams=new EventStreams(env,ctx);}fetch(req){return this.streams.fetch(req);}}
 const cat=${JSON.stringify(cat)};
 export default {async fetch(req,env,ctx){await syncFunctions(env,[]);if(new URL(req.url).pathname==='/emit'){await emitEvent(env,'sample.event',{value:1},{id:crypto.randomUUID()});ctx.waitUntil(runFunctions(env,cat,'http://localhost'));return Response.json({ok:true});}return remoteMcp(req,env,ctx,{catalogueOf:async()=>cat});}};
 `},bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
 const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'events',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},exports:{Hub:{type:'durable-object',storage:'sqlite'}},env:{DB:{type:'d1',id:'events'},LOBBY:{type:'durable-object',worker:'events',exportName:'Hub'},HOMIE_LOCAL_TEST_SECRET:{type:'json',value:'local-only'},STUDIO_EVENT_FEEDS:{type:'json',value:JSON.stringify({sample:{event:'sample.event',receivers:['https://receiver.example/events']}})}}},dev:{outboundService:{type:'fetcher',handler:async req=>{received.push(new Webhook(secret).verify(await req.text(),Object.fromEntries(req.headers)));return new Response(null,{status:204});}}}}]});
 const readers=[];
 try{
  const db=await mf.getD1Database('DB');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())for(const sql of readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(sql.trim())await db.prepare(sql).run();
  const rpc=(method,params={},auth=true)=>mf.dispatchFetch('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(auth?{authorization:'Bearer local-only'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const decode=async response=>{if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();const reader=jsonSseReader(response.body);try{return await nextSseJson(reader);}finally{await reader.cancel();}};
  const init=await decode(await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'conformance',version:'1'}}));assert.deepEqual(init.result.capabilities.events,{listChanged:true});assert.equal(init.result.capabilities.resources.subscribe,true);
  const list=await (await rpc('events/list')).json();assert.equal(list.result.events[0].name,'sample');assert.deepEqual(list.result.events[0].delivery,['poll','push','webhook']);
  assert.equal((await (await rpc('events/subscribe',{name:'sample'},false)).json()).error.code,-32024);
  const initial=await (await rpc('events/poll',{name:'sample'})).json();assert.deepEqual(initial.result.events,[]);
  const sub=await (await rpc('events/subscribe',{name:'sample',delivery:{url:'https://receiver.example/events',secret},ttlMs:600000})).json();assert.ok(sub.result.id);
  const stream=await rpc('events/stream',{name:'sample'});assert.match(stream.headers.get('content-type'),/text\/event-stream/);const reader=jsonSseReader(stream.body);readers.push(reader);
  const next=()=>nextSseJson(reader);
  assert.equal((await next()).method,'notifications/events/active');assert.equal((await next()).method,'notifications/events/heartbeat');
  await mf.dispatchFetch('http://localhost/emit');
  // A slow consumer lets workerd coalesce the event and following heartbeats.
  await new Promise(r=>setTimeout(r,25));const event=await next();assert.equal(event.method,'notifications/events/event');assert.equal(event.params.name,'sample');assert.equal(event.params._meta['io.modelcontextprotocol/subscriptionId'],1);
  assert.equal((await next()).method,'notifications/events/heartbeat');
  const poll=await (await rpc('events/poll',{name:'sample',cursor:initial.result.cursor})).json();assert.equal(poll.result.events[0].eventId,event.params.eventId);
  // Subscribe refresh runs the same durable delivery engine; no second publisher path.
  await rpc('events/subscribe',{name:'sample',delivery:{url:'https://receiver.example/events',secret},cursor:sub.result.cursor});
  for(let i=0;i<100&&!received.length;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(received[0].eventId,event.params.eventId);
  assert.equal((await (await rpc('events/unsubscribe',{name:'sample',delivery:{url:'https://receiver.example/events'}})).json()).error,undefined);
 }finally{await Promise.all(readers.map(r=>r.cancel()));await mf.dispose();}
});
