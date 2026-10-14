import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Webhook} from 'standardwebhooks';
import {syncFunctions,emitEvent,runFunctions,functionRuns} from '../worker/functions.mjs';
import {listEvents,pollEvents,subscribeEvents,unsubscribeEvents,hookFunction,eventHookSubscriptions} from '../worker/mcp-events.mjs';
import {EventsError,eventError,cursorOf,signingSecret} from '../worker/mcp-events-wire.mjs';
import {McpEventStreams} from '../worker/mcp-event-streams.mjs';
import {EventStreams} from '../worker/event-resources.mjs';
const url='https://receiver.example/events',secret=()=> 'whsec_'+randomBytes(32).toString('base64');
function fixture(t){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));
 const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});
 const DB={sql,prepare:stmt,batch:async xs=>Promise.all(xs.map(x=>x.run()))};t.after(()=>sql.close());
 sql.exec("INSERT INTO players(id,name,guest,owner,created_at,seen_at) VALUES('owner','Owner',0,1,1,1),('staff','Staff',0,0,1,1); INSERT INTO mcp_connections(id,person,client,created) VALUES('owner-connection','owner','client',1),('staff-connection','staff','client',1); INSERT INTO app_roles(app,role,player) VALUES('cafe','staff','staff');");
 const feed={event:'record.changed',app:'cafe',collection:'bookings',audience:{app:'cafe',role:'staff'},receivers:[url]};
 const env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({bookings:feed,private:{event:'tool.called',audience:'owner',receivers:[url]}})};
 const cat={games:[{id:'cafe',kind:'app',roles:{staff:{signIn:true,can:['read:bookings']}},records:{collections:{bookings:{}}}}]};
 const owner={id:'owner',owner:true,connection:'owner-connection'},staff={id:'staff',owner:false,connection:'staff-connection',roles:{cafe:['staff']}},anonymous={id:null};
 const params={name:'bookings',arguments:{},delivery:{mode:'webhook',url,secret:secret()}};
 const emit=(id,at=Date.now(),collection='bookings')=>emitEvent(env,'record.changed',{app:'cafe',collection,record:id},{id,at});
 return {env,cat,owner,staff,anonymous,params,emit};
}
const rejects=(fn,code)=>assert.rejects(fn,error=>error.code===code);

test('list and poll conform: role filtering, null bootstrap, replay, hasMore, maxAge and quiet cursor advancement',async t=>{
 const {env,cat,owner,staff,anonymous,emit}=fixture(t);await syncFunctions(env,[]);
 assert.deepEqual((await listEvents(env,cat,anonymous)).events,[]);
 assert.deepEqual((await listEvents(env,cat,staff)).events.map(e=>e.name),['bookings']);
 assert.deepEqual((await listEvents(env,cat,owner)).events[0].delivery,['poll','push','webhook']);
 await emit('old',1);const initial=await pollEvents(env,cat,staff,{name:'bookings'});assert.deepEqual(initial.events,[]);
 await emit('one',10);await emit('hidden',11,'private');await emit('two',12);
 const page=await pollEvents(env,cat,staff,{name:'bookings',cursor:initial.cursor,maxEvents:1});assert.equal(page.events[0].eventId,'one');assert.equal(page.hasMore,true);
 assert.deepEqual(await pollEvents(env,cat,staff,{name:'bookings',cursor:initial.cursor,maxEvents:1}),page);
 const rest=await pollEvents(env,cat,staff,{name:'bookings',cursor:page.cursor});assert.deepEqual(rest.events.map(e=>e.eventId),['two']);assert.equal(rest.hasMore,false);
 const bounded=await pollEvents(env,cat,staff,{name:'bookings',cursor:initial.cursor,maxAgeMs:1},13);assert.equal(bounded.truncated,true);assert.equal(bounded.events[0].eventId,'two');
 await emit('not-visible',14,'private');const quiet=await pollEvents(env,cat,staff,{name:'bookings',cursor:rest.cursor});assert.equal(quiet.events.length,0);assert.notEqual(quiet.cursor,rest.cursor);
 await rejects(()=>pollEvents(env,cat,anonymous,{name:'bookings'}),-32024);
 await rejects(()=>pollEvents(env,cat,staff,{name:'missing'}),-32023);
 for(const p of [{cursor:'bad'},{arguments:{unexpected:true}},{maxEvents:0},{maxAgeMs:-1}])await rejects(()=>pollEvents(env,cat,owner,{name:'bookings',...p}),-32602);
});

test('webhooks share durable retries, verify with Standard Webhooks, refresh/rotate/expire/unsubscribe, no secret in output',async t=>{
 const {env,cat,owner,params,emit}=fixture(t);await syncFunctions(env,[]);let time=Date.now(),calls=0;const received=[],logs=[];
 t.mock.method(console,'error',(...args)=>logs.push(args));
 const old=params.delivery.secret;const options={now:()=>time,webhookOptions:{now:Date.now,fetchFn:async(u,init)=>{assert.equal(u,url);assert.equal(init.redirect,'manual');received.push(init);calls++;return new Response(old,{status:calls===1?503:200});}}};
 const sub=await subscribeEvents(env,cat,owner,{...params,ttlMs:600000},{now:()=>time});assert.equal(Date.parse(sub.refreshBefore),time+600000);
 await emit('one');await runFunctions(env,cat,'https://studio.example',options);
 let row=env.DB.sql.prepare('SELECT * FROM function_deliveries WHERE function=?').get(hookFunction(sub.id));assert.equal(row.state,'failed');assert.equal(row.error,'http_5xx');
 const first=new Webhook(old).verify(received[0].body,received[0].headers);assert.equal(first.eventId,'one');assert.equal(first.name,'bookings');assert.equal(received[0].headers['X-MCP-Subscription-Id'],sub.id);assert.equal(first.cursor,sub.cursor);
 params.delivery.secret=secret();const fresh=await subscribeEvents(env,cat,owner,{...params,cursor:sub.cursor,ttlMs:600000},{now:()=>time});assert.equal(fresh.id,sub.id);assert.equal(fresh.deliveryStatus.lastError,'http_5xx');
 time+=60000;await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,2);
 for(const key of [old,params.delivery.secret])assert.equal(new Webhook(key).verify(received[1].body,received[1].headers).eventId,'one');
 assert.equal((await subscribeEvents(env,cat,owner,params,{now:()=>time})).deliveryStatus.lastError,null);
 const output=JSON.stringify([await functionRuns(env),received,logs,env.DB.sql.prepare('SELECT * FROM studio_events').all()]);for(const key of [old,params.delivery.secret])assert.ok(!output.includes(key));
 await unsubscribeEvents(env,owner,params);await rejects(()=>unsubscribeEvents(env,owner,params),-32023);
 const exp=await subscribeEvents(env,cat,owner,{...params,ttlMs:10},{now:()=>time});time+=11;await runFunctions(env,cat,'https://studio.example',options);assert.equal(env.DB.sql.prepare('SELECT * FROM function_subscriptions WHERE name=?').get(hookFunction(exp.id)),undefined);
});

test('webhook auth, tenant isolation, invalid secrets, unsupported modes and endpoint errors',async t=>{
 const {env,cat,owner,staff,anonymous,params}=fixture(t);await syncFunctions(env,[]);
 await rejects(()=>subscribeEvents(env,cat,anonymous,params),-32024);await rejects(()=>unsubscribeEvents(env,anonymous,params),-32024);
 const one=await subscribeEvents(env,cat,owner,params),two=await subscribeEvents(env,cat,staff,params);assert.notEqual(one.id,two.id);
 await unsubscribeEvents(env,staff,params);assert.equal((await subscribeEvents(env,cat,owner,params)).id,one.id);
 for(const value of ['secret','whsec_eA==','whsec_'+randomBytes(65).toString('base64')])assert.throws(()=>signingSecret(value),error=>error.code===-32602);
 for(const delivery of [{...params.delivery,url:'http://example.com'}, {...params.delivery,secret:'bad'}])await rejects(()=>subscribeEvents(env,cat,owner,{...params,delivery}),-32602);
 await rejects(()=>subscribeEvents(env,cat,owner,{...params,delivery:{...params.delivery,mode:'push'}}),-32026);
 await rejects(()=>subscribeEvents(env,cat,owner,{...params,delivery:{...params.delivery,url:'https://unapproved.example/'}}),-32027);
 assert.equal(eventError(new EventsError(-32025,{limit:'subscriptions'})).message,'ResourceExhausted');
 assert.ok(Date.parse((await subscribeEvents(env,cat,owner,{...params,ttlMs:null})).refreshBefore)>Date.now());
});

test('push active/event/heartbeat, resume, cancellation and revocation',async t=>{
 const {env,cat,owner,params,emit}=fixture(t);await syncFunctions(env,[]);const jobs=[];const ctx={waitUntil:p=>jobs.push(p)};
 const streams=new McpEventStreams(env,ctx);t.after(()=>{for(const s of streams.streams)streams.close(s);});
 const input={id:7,connection:owner.connection,cat,params:{name:params.name}};
 const response=await streams.open(input),reader=response.body.getReader();const next=async()=>JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]);
 const active=await next();assert.equal(active.method,'notifications/events/active');assert.equal(active.params._meta['io.modelcontextprotocol/subscriptionId'],7);
 assert.equal((await next()).method,'notifications/events/heartbeat');await Promise.all(jobs);
 await emit('live');streams.wake({cat});const event=await next();assert.equal(event.params.eventId,'live');assert.equal((await next()).method,'notifications/events/heartbeat');await Promise.all(jobs);await reader.cancel();assert.equal(streams.streams.size,0);
 await emit('offline');const resumed=await streams.open({...input,id:8,params:{name:'bookings',cursor:event.params.cursor}}),r=resumed.body.getReader();await r.read();const replay=JSON.parse(new TextDecoder().decode((await r.read()).value).split('data: ')[1]);assert.equal(replay.params.eventId,'offline');await r.read();await Promise.all(jobs);
 env.DB.sql.prepare('UPDATE mcp_connections SET revoked=1 WHERE id=?').run(owner.connection);streams.wake({cat});const ended=JSON.parse(new TextDecoder().decode((await r.read()).value).split('data: ')[1]);assert.equal(ended.method,'notifications/events/terminated');assert.equal(ended.params.error.code,-32024);const result=JSON.parse(new TextDecoder().decode((await r.read()).value).split('data: ')[1]);assert.equal(result.id,8);assert.deepEqual(result.result,{_meta:{}});await r.cancel();await Promise.all(jobs);
});

test('webhook replay watermark never skips failed delivery; permanent failures, quotas and role revocation',async t=>{
 const {env,cat,owner,staff,params,emit}=fixture(t);await syncFunctions(env,[]);
 const baseline=await pollEvents(env,cat,owner,{name:'bookings'});await emit('earlier');await emit('later');
 const sub=await subscribeEvents(env,cat,staff,{...params,cursor:baseline.cursor});const bodies=[];let time=Date.now();
 const options={now:()=>time,webhookOptions:{fetchFn:async(url,init)=>{const body=new Webhook(params.delivery.secret).verify(init.body,init.headers);bodies.push(body);return new Response(null,{status:body.eventId==='earlier'?503:204});}}};
 await runFunctions(env,cat,'https://studio.example',options);
 assert.equal(bodies.length,2);assert.equal(bodies[1].cursor,baseline.cursor,'acknowledged later event cannot skip an earlier failure');
 const refresh=await subscribeEvents(env,cat,staff,{...params,cursor:baseline.cursor});assert.equal(refresh.cursor,baseline.cursor);
 time+=60000;options.webhookOptions.fetchFn=async(url,init)=>{bodies.push(new Webhook(params.delivery.secret).verify(init.body,init.headers));return new Response(null,{status:410});};
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(env.DB.sql.prepare('SELECT state FROM function_deliveries WHERE event=? AND function=?').get('earlier',hookFunction(sub.id)).state,'complete');
 assert.notEqual((await subscribeEvents(env,cat,staff,params)).cursor,baseline.cursor);
 const feeds=JSON.parse(env.STUDIO_EVENT_FEEDS);feeds.bookings.maxSubscriptions=1;env.STUDIO_EVENT_FEEDS=JSON.stringify(feeds);
 await rejects(()=>subscribeEvents(env,cat,owner,params),-32025);
 // A revoked grant sends a signed terminal control body and drops subscription secrets.
 env.DB.sql.exec("DELETE FROM app_roles WHERE player='staff'");await runFunctions(env,cat,'https://studio.example',options);
 assert.equal(bodies.at(-1).type,'terminated');assert.equal(bodies.at(-1).error.code,-32024);
 assert.equal(env.DB.sql.prepare("SELECT COUNT(*) n FROM mcp_kv WHERE key LIKE 'mcp-event-hook:%'").get().n,0);
});

test('two independent push streams and a separate discovery channel emit only their own messages',async t=>{
 const {env,cat,owner,staff,emit}=fixture(t);await syncFunctions(env,[]);const jobs=[],ctx={waitUntil:p=>jobs.push(p)},streams=new McpEventStreams(env,ctx);
 t.after(()=>{for(const stream of streams.streams)streams.close(stream);});
 const a=await streams.open({id:'a',connection:owner.connection,cat,params:{name:'bookings'}}),b=await streams.open({id:'b',connection:owner.connection,cat,params:{name:'bookings'}});
 const ar=a.body.getReader(),br=b.body.getReader();await ar.read();await br.read();await ar.read();await br.read();await Promise.all(jobs);await ar.cancel();
 assert.equal(streams.streams.size,1);await emit('remaining');streams.wake({cat});const event=JSON.parse(new TextDecoder().decode((await br.read()).value).split('data: ')[1]);assert.equal(event.params._meta['io.modelcontextprotocol/subscriptionId'],'b');await br.read();await Promise.all(jobs);await br.cancel();await Promise.all(jobs);
 assert.equal(env.DB.sql.prepare("SELECT COUNT(*) n FROM mcp_kv WHERE key LIKE 'mcp-event-stream:%'").get().n,0);
 const legacy=new EventStreams(env,ctx);const response=await legacy.fetch(new Request('https://events/__studio_events',{method:'POST',body:JSON.stringify({op:'stream',connection:staff.connection,cat,tools:[]})}));const reader=response.body.getReader();await reader.read();await Promise.all(jobs);
 env.DB.sql.exec("DELETE FROM app_roles WHERE player='staff'");await legacy.wake({connection:staff.connection,cat,tools:[]});
 const changed=JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]);assert.equal(changed.method,'notifications/events/list_changed');assert.equal(changed.params._meta,undefined);await reader.cancel();await Promise.all(jobs);
});
