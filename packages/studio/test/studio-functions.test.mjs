import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emitEvent,runFunctions,useFunctions,scheduleFunctions} from '../worker/functions.mjs';
import {FUNCTIONS_MIGRATION} from '../worker/functions-schema.mjs';
import {virtualTime} from './virtual-time.mjs';
import {callsPerMinute,rateLimit} from '../worker/mcp-store.mjs';
import {wranglerConfig} from '../lib/scaffold.mjs';
import {updateWorkerConfig} from '../lib/worker-config.mjs';
function database(){const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort()){if(file.startsWith('0018'))continue;sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));}sql.exec(FUNCTIONS_MIGRATION);const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});return {sql,prepare:stmt,batch:async xs=>{sql.exec('BEGIN');try{const results=[];for(const x of xs)results.push(await x.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};}
test('functions retain event IDs through failures, concurrent dispatch, crash leases and virtual-time retries',async t=>{
 const DB=database();t.after(()=>DB.sql.close());const clock=virtualTime(t),env={DB},cat={games:[]};let attempts=0;const seen=[];
 const definitions=[{name:'deliver',event:'order.paid',async handler(event,ctx){attempts++;seen.push(event.id);if(attempts===1)throw new Error('secret must not enter office');await ctx.database.put(event.id,event.data);}}];
 await emitEvent(env,'order.paid',{order:'seeded-order'},{id:'seeded-event'});await emitEvent(env,'order.paid',{order:'different'},{id:'seeded-event'});
 await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});
 assert.equal(attempts,1);assert.doesNotMatch(JSON.stringify(DB.sql.prepare('SELECT * FROM function_deliveries').all()),/secret/);
 await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});assert.equal(attempts,1);
 await clock.wait(10);await Promise.all([runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10}),runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10})]);assert.equal(attempts,2);assert.deepEqual(seen,['seeded-event','seeded-event']);
 assert.equal(JSON.parse(DB.sql.prepare('SELECT value FROM tool_data').get().value).order,'seeded-order');
 await emitEvent(env,'order.paid',{order:'crash'},{id:'crash'});
 DB.sql.exec("INSERT INTO function_deliveries(event,function,state,due) VALUES('crash','deliver','running',1000020)");
 await clock.wait(10);await runFunctions(env,cat,'https://studio.test',{definitions,now:clock.now,leaseMs:10});assert.equal(attempts,3);
});
test('record and tool events commit atomically; schedule retries deduplicate a named tick',async t=>{
 const DB=database();t.after(()=>DB.sql.close());virtualTime(t);const env={DB};
 DB.sql.exec("BEGIN;INSERT INTO app_records VALUES('app','jobs','one','{\"state\":\"new\"}',1,100);ROLLBACK");assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0);
 DB.sql.exec("INSERT INTO app_records VALUES('app','jobs','one','{\"state\":\"new\"}',1,100);UPDATE app_records SET version=2 WHERE id='one';DELETE FROM app_records WHERE id='one'");assert.equal(DB.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='record.changed'").get().n,3);
 let calls=0;useFunctions(async()=>[{name:'daily',event:'daily',schedule:'0 9 * * *',handler:()=>{calls++;}}]);
 await scheduleFunctions({cron:'0 9 * * *',scheduledTime:100},env,{games:[]},'https://studio.test');await scheduleFunctions({cron:'0 9 * * *',scheduledTime:100},env,{games:[]},'https://studio.test');assert.equal(calls,1);useFunctions(async()=>[]);
});
test('MCP rate policy is absent until a studio sets it',async()=>{
 assert.equal(callsPerMinute({}),null);assert.equal(await rateLimit({},'public'),true);assert.equal(callsPerMinute({studio:{mcp:{callsPerMinute:1234567}}}),1234567);
});
test('deployment configuration preserves committed order, custom bindings and repeated writes',()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-config-stable-'));try{
 writeFileSync(join(root,'studio.json'),'{}');const generated=wranglerConfig({worker:'test',name:'Test',d1:'test',d1Id:'seeded-database'});
 const original=JSON.parse(generated.replace(/^\s*\/\/.*$/gm,''));original.compatibility_flags.reverse();original.vars.CUSTOM='kept';original.services=[{binding:'MY_SERVICE',service:'own'}];original.d1_databases.push({binding:'CUSTOM_DB',database_name:'other',database_id:'other'});original.durable_objects.bindings.push({name:'CUSTOM_ROOM',class_name:'OwnRoom'});const text='// Studio comment\n'+JSON.stringify(original,null,2)+'\n';writeFileSync(join(root,'wrangler.jsonc'),text);
 updateWorkerConfig(root,generated);assert.equal(readFileSync(join(root,'wrangler.jsonc'),'utf8'),text);updateWorkerConfig(root,generated);assert.equal(readFileSync(join(root,'wrangler.jsonc'),'utf8'),text);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('partial refund events use the provider refund ID and survive duplicate snapshots',async t=>{
 const DB=database();t.after(()=>DB.sql.close());
 const {rememberMoneyEvent}=await import('../worker/shop-links.mjs');
 const event={type:'refund.updated',livemode:false,created:100,data:{object:{id:'re_seeded',payment_intent:'pi_seeded',amount:100,currency:'usd',status:'succeeded'}}};
 await rememberMoneyEvent({DB},event);await rememberMoneyEvent({DB},event);
 const rows=DB.sql.prepare("SELECT * FROM studio_events WHERE type='payment.refunded'").all();assert.equal(rows.length,1);assert.equal(rows[0].id,'refund:re_seeded');assert.equal(rows[0].at,100000);
});
