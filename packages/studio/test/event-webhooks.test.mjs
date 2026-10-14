import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Webhook} from 'standardwebhooks';
import {runFunctions,syncFunctions,emitEvent} from '../worker/functions.mjs';
import {postWebhook,webhookStatus,testWebhook} from '../worker/event-webhooks.mjs';
import {webhookSecret} from '../worker/event-webhook-config.mjs';
import {eventsWebhook} from '../lib/events-cli.mjs';
import {builtins} from '../worker/mcp-tools.mjs';
import {feedEvents} from '../worker/event-resources.mjs';
import {functionDeploymentSQL,buildFunctions} from '../lib/functions-build.mjs';
import * as esbuild from 'esbuild';
function database(){const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});return {sql,prepare:stmt,batch:async xs=>xs.map(x=>x.run())};}
const secret='whsec_'+randomBytes(32).toString('base64');
const feed={event:'record.changed',app:'cafe',collection:'bookings',audience:{app:'cafe',role:'staff'},webhook:{url:'https://receiver.example/events',id:'0123456789abcdef0123456789abcdef',secret:webhookSecret('0123456789abcdef0123456789abcdef')}};
const catalogue=()=>({games:[{id:'cafe',kind:'app',roles:{staff:{signIn:true,can:['read:bookings']}},records:{collections:{bookings:{},private:{}}}}]});
function fixture(t){const DB=database();t.after(()=>DB.sql.close());return {DB,STUDIO_EVENT_FEEDS:JSON.stringify({bookings:feed}),[feed.webhook.secret]:secret};}

test('Standard Webhooks verifier accepts exact signed bytes, rejects tampering; redirects refused',async t=>{
 const env=fixture(t),event={id:'record.with.dots:é',type:'record.changed',at:123,data:{name:'Tea ☕'}};let captured;
 await postWebhook(env,'bookings',event,{fetchFn:async(url,init)=>{captured=init;return new Response(null,{status:204});}});
 const verifier=new Webhook(secret);assert.deepEqual(verifier.verify(captured.body,captured.headers),event);
 assert.throws(()=>verifier.verify(captured.body+' ',captured.headers));
 assert.throws(()=>verifier.verify(captured.body,{...captured.headers,'webhook-id':'changed'}));
 assert.equal(captured.redirect,'manual');assert.equal(captured.headers['content-type'],'application/json');
 assert.ok(!JSON.stringify(captured).includes(secret));
});

test('durable retries back off after 5xx and timeout, stop on success; records, feeds and logs contain no key',async t=>{
 const env=fixture(t),cat=catalogue();let time=Date.now(),calls=0;const ids=[];const logs=[];
 t.mock.method(console,'error',(...a)=>logs.push(a));
 const options={now:()=>time,webhookOptions:{now:()=>time,timeoutMs:5,fetchFn:async(url,init)=>{
  calls++;ids.push(init.headers['webhook-id']);new Webhook(secret).verify(init.body,init.headers);
  if(calls===1)return new Response(secret,{status:503});
  if(calls===2)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error(secret))));
  return new Response(null,{status:204});
 }}};
 // Timestamp verification is covered above; advancing the dispatch clock does not age wire signatures.
 options.webhookOptions.now=Date.now;
 await syncFunctions(env,[]);await emitEvent(env,'record.changed',{app:'cafe',collection:'bookings',operation:'insert',data:{name:'Tea'}},{id:'booking'});
 await runFunctions(env,cat,'https://studio.example',options);
 let row=(await webhookStatus(env,'bookings')).deliveries[0];assert.equal(row.error,'Webhook HTTP 503');assert.equal(row.due,time+60000);
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
 time+=60000;await runFunctions(env,cat,'https://studio.example',options);
 row=(await webhookStatus(env,'bookings')).deliveries[0];assert.equal(row.error,'Webhook timed out');assert.equal(row.due,time+120000);
 time+=120000;await runFunctions(env,cat,'https://studio.example',options);
 row=(await webhookStatus(env,'bookings')).deliveries[0];assert.equal(row.state,'complete');assert.equal(row.attempts,3);assert.equal(row.error,null);
 time+=3600000;await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,3);assert.equal(new Set(ids).size,1);
 for(const data of [await feedEvents(env,'bookings'),await webhookStatus(env,'bookings'),logs,env.DB.sql.prepare('SELECT * FROM studio_events').all()])assert.ok(!JSON.stringify(data).includes(secret));
});

test('matches app and collection; audience permissions are checked again on retry',async t=>{
 const env=fixture(t),cat=catalogue();let calls=0,time=Date.now();const options={now:()=>time,webhookOptions:{fetchFn:async()=>{calls++;return new Response(null,{status:204});}}};
 await syncFunctions(env,[]);
 for(const [id,app,collection] of [['yes','cafe','bookings'],['private','cafe','private'],['other','other','bookings']])await emitEvent(env,'record.changed',{app,collection},{id});
 cat.games[0].roles.staff.can=[];
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,0);
 assert.equal((await webhookStatus(env,'bookings')).deliveries.length,1);
 cat.games[0].roles.staff.can=['read:bookings'];
 time+=60000;await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
 await emitEvent(env,'record.changed',{app:'cafe',collection:'bookings'},{id:'hidden'});
 cat.games[0].launch='private';
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
});

test('owner-only status and synthetic test use durable dispatcher; disabled feeds send nothing',async t=>{
 const env=fixture(t),cat=catalogue();const sent=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{sent.push(JSON.parse(init.body));return new Response(null,{status:204});});
 const tools=builtins(env,cat,'https://studio.example');
 for(const name of ['studio_events_webhook_status','studio_events_webhook_test'])await assert.rejects(()=>tools.find(x=>x.name===name).handler({feed:'bookings'},{caller:{owner:false}}),/Owner only/);
 const result=await testWebhook(env,cat,'bookings','https://studio.example');assert.equal(result.state,'complete');assert.equal(sent[0].type,'webhook.test');assert.equal(sent[0].data.test,true);assert.equal((await feedEvents(env,'bookings')).length,0);
 env.STUDIO_EVENT_FEEDS='{}';await runFunctions(env,cat,'https://studio.example');assert.equal(sent.length,1);
});

test('CLI provisions, rotates and removes Worker secrets without persisting or logging values',async t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-hook-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const studio={name:'Hooks',cloudflare:{worker:'hooks',created:['worker:hooks']},mcp:{events:{bookings:{...feed,webhook:undefined}}}};
 writeFileSync(join(root,'studio.json'),JSON.stringify(studio));const saved=new Map(),calls=[],logs=[];
 const run=async(args,{input})=>{calls.push(args);if(args[1]==='put')saved.set(args[2],input.trim());else saved.delete(args[2]);return {code:0,out:input};};
 const a=await eventsWebhook(root,'add','bookings',feed.webhook.url,{run,log:x=>logs.push(x)});const binding=JSON.parse(readFileSync(join(root,'studio.json'))).mcp.events.bookings.webhook.secret;assert.equal(saved.get(binding),a.secret);
 assert.ok(!readFileSync(join(root,'studio.json'),'utf8').includes(a.secret));
 const b=await eventsWebhook(root,'rotate','bookings',null,{run});assert.notEqual(a.secret,b.secret);assert.equal(saved.get(binding),b.secret);
 await eventsWebhook(root,'remove','bookings',null,{run});assert.equal(saved.size,0);assert.equal(JSON.parse(readFileSync(join(root,'studio.json'))).mcp.events.bookings.webhook,undefined);
 assert.ok(!JSON.stringify({logs,calls}).includes(a.secret));assert.ok(!JSON.stringify({logs,calls}).includes(b.secret));
 const before=readFileSync(join(root,'studio.json'),'utf8');await assert.rejects(()=>eventsWebhook(root,'add','bookings',feed.webhook.url,{run:async()=>({code:1,out:a.secret})}),/Worker secret update failed/);assert.equal(readFileSync(join(root,'studio.json'),'utf8'),before);
 await assert.rejects(()=>eventsWebhook(root,'add','bookings','http://example.test',{run}),/HTTPS/);
 const c=await eventsWebhook(root,'add','bookings',feed.webhook.url,{run});const next=JSON.parse(readFileSync(join(root,'studio.json'))).mcp.events.bookings.webhook;assert.notEqual(next.secret,binding);assert.equal(saved.has(binding),false);assert.equal(saved.get(next.secret),c.secret);
});

test('deployment registers new webhooks from now; remove/re-add cannot deliver the old backlog',async t=>{
 const env=fixture(t),cat=catalogue();const root=mkdtempSync(join(tmpdir(),'homie-hook-registry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let feeds={bookings:structuredClone(feed)},calls=0;
 const deploy=()=>{writeFileSync(join(root,'studio.json'),JSON.stringify({mcp:{events:feeds}}));env.DB.sql.exec(functionDeploymentSQL(root));env.STUDIO_EVENT_FEEDS=JSON.stringify(feeds);};
 const options={webhookOptions:{fetchFn:async()=>{calls++;return new Response(null,{status:503});}}};
 deploy();await emitEvent(env,'record.changed',{app:'cafe',collection:'bookings'},{id:'old'});
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
 delete feeds.bookings.webhook;deploy();await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
 const id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';feeds.bookings.webhook={url:feed.webhook.url,id,secret:webhookSecret(id)};env[webhookSecret(id)]=secret;deploy();
 await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,1);
 await emitEvent(env,'record.changed',{app:'cafe',collection:'bookings'},{id:'new'});await runFunctions(env,cat,'https://studio.example',options);assert.equal(calls,2);
 assert.deepEqual((await webhookStatus(env,'bookings')).deliveries.map(r=>r.event),['new']);
});

test('rotated keys sign pending deliveries; removal cannot sign with a missing key',async t=>{
 const env=fixture(t),event={id:'one',type:'record.changed',at:1,data:{}};const rotated='whsec_'+randomBytes(32).toString('base64');env[feed.webhook.secret]=rotated;
 await postWebhook(env,'bookings',event,{fetchFn:async(url,init)=>{assert.deepEqual(new Webhook(rotated).verify(init.body,init.headers),event);assert.throws(()=>new Webhook(secret).verify(init.body,init.headers));return new Response(null,{status:204});}});
 delete env[feed.webhook.secret];let called=false;
 await assert.rejects(()=>postWebhook(env,'bookings',event,{fetchFn:async()=>{called=true;}}),/secret unavailable/);assert.equal(called,false);
});

test('build validates webhook configuration and carries only its binding name into Worker config',async t=>{
 const {newStudio}=await import('../lib/scaffold.mjs');const root=mkdtempSync(join(tmpdir(),'homie-hook-build-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Hook build',install:false,kind:'business'});
 const file=join(root,'studio.json'),studio=JSON.parse(readFileSync(file));studio.mcp={events:{bookings:feed}};writeFileSync(file,JSON.stringify(studio));
 await buildFunctions(root,esbuild);
 const config=(await import('../lib/routes.mjs')).readConfig(root);
 assert.deepEqual(JSON.parse(config.vars.STUDIO_EVENT_FEEDS),{bookings:feed});assert.ok(config.triggers.crons.includes('* * * * *'));assert.ok(!JSON.stringify(config).includes(secret));
 studio.mcp.events.bookings=structuredClone(feed);studio.mcp.events.bookings.webhook.secret='OTHER_SECRET';writeFileSync(file,JSON.stringify(studio));await assert.rejects(()=>buildFunctions(root,esbuild),/provision/);
});
