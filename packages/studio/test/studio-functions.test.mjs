import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emitEvent,runFunctions,useFunctions,scheduleFunctions,syncFunctions,replayFunction} from '../worker/functions.mjs';
import {FUNCTIONS_MIGRATION} from '../worker/functions-schema.mjs';
import {virtualTime} from './virtual-time.mjs';
import {callsPerMinute,rateLimit} from '../worker/mcp-store.mjs';
import {wranglerConfig} from '../lib/scaffold.mjs';
import {updateWorkerConfig} from '../lib/worker-config.mjs';
function database(){const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort()){sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));}const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});return {sql,prepare:stmt,batch:async xs=>{sql.exec('BEGIN');try{const results=[];for(const x of xs)results.push(x.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};}
test('functions retain event IDs through failures, concurrent dispatch, crash leases and virtual-time retries',async t=>{
 const DB=database();t.after(()=>DB.sql.close());const clock=virtualTime(t),env={DB},cat={games:[]};let attempts=0;const seen=[];
 const definitions=[{name:'deliver',event:'order.paid',async handler(event,ctx){attempts++;seen.push(event.id);if(attempts===1)throw new Error('secret must not enter office');await ctx.database.put(event.id,event.data);}}];
 await syncFunctions(env,definitions);
 await emitEvent(env,'order.paid',{order:'seeded-order'},{id:'seeded-event'});await emitEvent(env,'order.paid',{order:'different'},{id:'seeded-event'});
 await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});
 assert.equal(attempts,1);assert.doesNotMatch(JSON.stringify(DB.sql.prepare('SELECT * FROM function_deliveries').all()),/secret/);
 await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});assert.equal(attempts,1);
 await clock.wait(10);await Promise.all([runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10}),runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10})]);assert.equal(attempts,2);assert.deepEqual(seen,['seeded-event','seeded-event']);
 assert.equal(JSON.parse(DB.sql.prepare('SELECT value FROM tool_data').get().value).order,'seeded-order');
 await emitEvent(env,'order.paid',{order:'crash'},{id:'crash'});
 DB.sql.exec("INSERT INTO function_deliveries(event,function,state,due) VALUES('crash','deliver','running',1000020)");
 DB.sql.exec("INSERT INTO function_runs(id,function,event,trigger,started,outcome,attempt) VALUES('crashed-worker','deliver','crash','order.paid',1000010,'running',1)");
 await clock.wait(10);await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});assert.equal(attempts,3);
 const interrupted=DB.sql.prepare("SELECT * FROM function_runs WHERE id='crashed-worker'").get();assert.equal(interrupted.outcome,'interrupted');assert.equal(interrupted.finished,null);
});
test('record and tool events commit atomically; schedule retries deduplicate a named tick',async t=>{
 const DB=database();t.after(()=>DB.sql.close());virtualTime(t);const env={DB};
 await syncFunctions(env,[{name:'records',event:'record.changed'}]);
 DB.sql.exec("BEGIN;INSERT INTO app_records VALUES('app','jobs','one','{\"state\":\"new\"}',1,100);ROLLBACK");assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0);
 DB.sql.exec("INSERT INTO app_records VALUES('app','jobs','one','{\"state\":\"new\"}',1,100);UPDATE app_records SET version=2 WHERE id='one';DELETE FROM app_records WHERE id='one'");assert.equal(DB.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='record.changed'").get().n,3);
 let calls=0;useFunctions(async()=>[{name:'daily',event:'daily',schedule:'0 9 * * *',handler:()=>{calls++;}}]);
 await scheduleFunctions({cron:'0 9 * * *',scheduledTime:Date.UTC(2026,9,13,9)},env,{games:[]},'https://studio.test');await scheduleFunctions({cron:'0 9 * * *',scheduledTime:Date.UTC(2026,9,13,9)},env,{games:[]},'https://studio.test');assert.equal(calls,1);useFunctions(async()=>[]);
});
test('MCP rate policy is absent until a studio sets it',async()=>{
 assert.equal(callsPerMinute({}),null);assert.equal(await rateLimit({},'public'),true);assert.equal(callsPerMinute({studio:{mcp:{callsPerMinute:1234567}}}),1234567);
});

test('partial refund events use the provider refund ID and survive duplicate snapshots',async t=>{
 const DB=database();t.after(()=>DB.sql.close());
 await syncFunctions({DB},[{name:'refunds',event:'payment.refunded'}]);
 const {rememberMoneyEvent}=await import('../worker/shop-links.mjs');
 const event={type:'refund.updated',livemode:false,created:100,data:{object:{id:'re_seeded',payment_intent:'pi_seeded',amount:100,currency:'usd',status:'succeeded'}}};
 await rememberMoneyEvent({DB},event);await rememberMoneyEvent({DB},event);
 const rows=DB.sql.prepare("SELECT * FROM studio_events WHERE type='payment.refunded'").all();assert.equal(rows.length,1);assert.equal(rows[0].id,'refund:re_seeded');assert.equal(rows[0].at,100000);
});

test('room events survive D1 failure and interrupted acknowledgement without replacing an earlier alarm',async t=>{
 const {Table}=await import('../worker/index.mjs');const DB=database(),room=new DatabaseSync(':memory:');t.after(()=>{DB.sql.close();room.close();});const clock=virtualTime(t),pending=[];let alarm=clock.now()+100,offline=true,interruptDelete=false;
 const sql={exec(q,...args){if(interruptDelete&&q.startsWith('DELETE FROM function_outbox')){interruptDelete=false;throw new Error('interrupted acknowledgement');}const statement=room.prepare(q);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>rows};}};
 useFunctions(async()=>[{name:'joined',event:'player.joined'}]);t.after(()=>useFunctions(async()=>[]));
 await syncFunctions({DB},[{name:'joined',event:'player.joined'}]);
 const table=Object.create(Table.prototype);table.env={ASSETS:{fetch:async()=>Response.json({games:[]})},DB:{batch:DB.batch,prepare:q=>{if(offline)throw new Error('D1 unavailable');return DB.prepare(q);}}};table.ctx={storage:{sql,getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;}},waitUntil:p=>pending.push(p)};
 useFunctions(async()=>[]);table.queueFunctionEvent('unused',{});await Promise.all(pending);assert.equal(room.prepare("SELECT count(*) n FROM sqlite_master WHERE name='function_outbox'").get().n,0);useFunctions(async()=>[{name:'joined',event:'player.joined'}]);
 table.queueFunctionEvent('player.joined',{game:'seeded-game',room:'seeded-room',player:'seeded-player',seat:0});await Promise.all(pending);
 const saved=room.prepare('SELECT * FROM function_outbox').get();assert.ok(saved);assert.equal(alarm,clock.now()+100,'keep the room alarm');
 offline=false;interruptDelete=true;await table.flushFunctionEvents();assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,1);assert.ok(room.prepare('SELECT id FROM function_outbox').get());
 await table.flushFunctionEvents();assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,1);assert.equal(DB.sql.prepare('SELECT id FROM studio_events').get().id,saved.id);assert.equal(room.prepare('SELECT count(*) n FROM function_outbox').get().n,0);
});

test('refund triggers leave plain-text account signing keys writable, with and without subscribers', async t => {
 const DB=database();t.after(()=>DB.sql.close());
 for(const subscribed of [false,true]) {
  if(subscribed)await syncFunctions({DB},[{name:'refunds',event:'payment.refunded'}]);
  DB.sql.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('office_key','non-json-signing-key');
  DB.sql.prepare('UPDATE meta SET value=? WHERE key=?').run('updated-signing-key','office_key');
  DB.sql.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('shop-money:test:refund:invalid','not-json');
  assert.equal(DB.sql.prepare("SELECT value FROM meta WHERE key='office_key'").get().value,'updated-signing-key');
  assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0);
 }
});

test('a broken notification transport does not block server functions',async t=>{
 const DB=database();t.after(()=>DB.sql.close());
 const env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({orders:{event:'order.paid'}}),LOBBY:{idFromName:v=>v,get:()=>({fetch:async()=>new Response('unavailable',{status:503})})}};
 const definitions=[{name:'fulfil',event:'order.paid',handler:async(e,c)=>c.database.put(e.id,{done:true})}];
 await syncFunctions(env,definitions);
 await DB.prepare('INSERT INTO mcp_kv(key,value) VALUES(?1,?2)').bind('event-sub:test:orders',JSON.stringify({connection:'test',name:'orders',after:0})).run();
 await emitEvent(env,'order.paid',{order:'one'},{id:'one'});
 t.mock.method(console,'error',()=>{});
 await runFunctions(env,{games:[]},'https://studio.test',{definitions});
 assert.equal(JSON.parse((await DB.prepare("SELECT value FROM tool_data WHERE namespace='function:fulfil' AND key='one'").first()).value).done,true);
 assert.ok(await DB.prepare("SELECT id FROM studio_events WHERE id='one'").first(),'notification history remains available for retry');
});

test('owner run history retains failures, successful retries, pagination and next due after pruning',async t=>{
 const {functionRuns,pruneEvents}=await import('../worker/functions.mjs');const {builtins,allowed}=await import('../worker/mcp-tools.mjs');
 const DB=database();t.after(()=>DB.sql.close());const clock=virtualTime(t),env={DB,STUDIO_API_TOKEN:'private-test-token',STUDIO_FUNCTION_CRONS:'["*/15 * * * *"]'};
 let count=0;const definitions=[{name:'cleanup',event:'cleanup.tick',schedule:'*/15 * * * *',handler(){if(++count===1)throw new Error('Cleanup service unavailable: private-test-token');}}];
 useFunctions(async()=>definitions);t.after(()=>useFunctions(async()=>[]));
 const time=Date.UTC(2026,9,13,9,15);
 await scheduleFunctions({cron:'* * * * *',scheduledTime:time},env,{games:[]},'https://studio.test');
 let report=await functionRuns(env,{errors:true});assert.equal(report.runs.length,1);assert.equal(report.runs[0].error,'Cleanup service unavailable: [redacted]');assert.equal(report.runs[0].attempt,1);
 await clock.wait(60000);await runFunctions(env,{games:[]},'https://studio.test');
 report=await functionRuns(env);assert.deepEqual(report.runs.map(r=>[r.outcome,r.attempt]),[['complete',2],['failed',1]]);assert.ok(report.runs.every(r=>r.finished>=r.started));
 await pruneEvents(env);
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM function_deliveries').get().n,0,'history survives queue cleanup');
 await scheduleFunctions({cron:'0,15,30,45 * * * *',scheduledTime:time+2000},env,{games:[]},'https://studio.test');assert.equal(count,2,'same minute deduplicates across different triggers');
 await scheduleFunctions({cron:'* * * * *',scheduledTime:time+60000},env,{games:[]},'https://studio.test');assert.equal(count,2,'non-due minute does not deliver');
 assert.equal((await functionRuns(env,{name:'other'})).runs.length,0);
 const tool=builtins(env,{games:[]},'https://studio.test').find(t=>t.name==='studio_function_runs');
 assert.equal(await allowed(tool.audience,{owner:false,id:null},env),false);assert.equal(await allowed(tool.audience,{owner:false,id:'staff'},env),false);assert.equal(await allowed(tool.audience,{owner:true,id:'owner'},env),true);
 assert.equal(builtins(env,{studio:{mcp:{audiences:{studio_function_runs:'public'}}},games:[]},'https://studio.test').find(t=>t.name==='studio_function_runs').audience,'studio-staff');
 await assert.rejects(tool.handler({},{caller:{owner:false}}),/Owner or studio staff only/);
 assert.equal((await tool.handler({errors:true},{caller:{owner:true,id:'owner'}})).runs[0].outcome,'failed');
 for(let i=0;i<101;i++)DB.sql.prepare("INSERT INTO function_runs(id,function,event,trigger,started,outcome,attempt) VALUES(?,'other','event','manual',1,'complete',1)").run('page-'+i);
 const page=await functionRuns(env);assert.equal(page.runs.length,100);assert.ok(page.next);assert.equal((await functionRuns(env,{before:page.next})).runs.length,3);
});

test('studio staff can inspect scheduled attempts through MCP and revoked staff cannot',async t=>{
 const {builtins,allowed}=await import('../worker/mcp-tools.mjs');const DB=database();t.after(()=>DB.sql.close());
 DB.sql.exec("INSERT INTO app_roles(app,role,player) VALUES('*','staff','crew')");
 const env={DB},caller={id:'crew',owner:false};const tool=builtins(env,{games:[]},'https://studio.test').find(t=>t.name==='studio_function_runs');
 assert.equal(await allowed(tool.audience,caller,env),true);
 const report=await tool.handler({},{caller});assert.ok(Array.isArray(report.runs));assert.ok(Array.isArray(report.schedules));
 DB.sql.exec('DELETE FROM app_roles');assert.equal(await allowed(tool.audience,caller,env),false);await assert.rejects(()=>tool.handler({},{caller}));
});

test('function handlers can call ctx.records to create and read declared app records',async t=>{
 const DB=database();t.after(()=>DB.sql.close());const env={DB};
 const cat={games:[{id:'calendar',kind:'app',roles:{staff:{signIn:true,can:['create:notes','read:notes']}},surfaces:{phone:'staff'},records:{persist:true,collections:{notes:{fields:{message:{type:'string'}}}}}}]};
 const definitions=[{name:'record-note',event:'note.requested',async handler(event,ctx){await ctx.records({app:'calendar',collection:'notes',id:event.id,operation:'create',data:{message:'Ready'}});const saved=await ctx.records({app:'calendar',collection:'notes',id:event.id});assert.equal(saved.records[0].data.message,'Ready');}}];
 await syncFunctions(env,definitions);await emitEvent(env,'note.requested',{}, {id:'note-one'});await runFunctions(env,cat,'https://place.example',{definitions});
 assert.equal(JSON.parse(DB.sql.prepare("SELECT value FROM app_records WHERE id='note-one'").get().value).message,'Ready');
});
