import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncFunctions,emitEvent,runFunctions,replayFunction} from '../worker/functions.mjs';
import {serviceResult} from '../worker/service-run.mjs';
import {virtualTime} from './virtual-time.mjs';
import {refreshWorkerConfig} from '../lib/worker-config.mjs';
import {customerOffer,pruneOffers,serviceTerms} from '../worker/customer-resources.mjs';
import {resourceKind} from '../worker/resource-kinds.mjs';
function database(t){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+f,import.meta.url),'utf8'));t.after(()=>sql.close());const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})});return {sql,prepare:stmt,batch:async xs=>{sql.exec('BEGIN');try{const out=xs.map(x=>x.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};}
test('new declarations start now; replay requires both declaration permission and explicit request',async t=>{
 const DB=database(t),env={DB};let calls=0;const old={name:'old',event:'order.paid',handler:()=>{throw Error('retain');}};
 await syncFunctions(env,[old]);await emitEvent(env,'order.paid',{}, {id:'past'});
 const fresh={name:'thanks',event:'order.paid',handler:()=>{calls++;}};
 await runFunctions(env,{},'https://test',{definitions:[old,fresh]});assert.equal(calls,0);
 await assert.rejects(replayFunction(env,'thanks',[fresh]),/replay: true/);
 fresh.replay=true;await runFunctions(env,{},'https://test',{definitions:[old,fresh]});assert.equal(calls,0);
 await replayFunction(env,'thanks',[fresh]);await runFunctions(env,{},'https://test',{definitions:[old,fresh]});assert.equal(calls,1);
});
test('event subscriptions avoid unused writes, index type cursors, page work and prune delivered events',async t=>{
 const DB=database(t),env={DB};await emitEvent(env,'unused',{});DB.sql.exec("INSERT INTO app_records VALUES('a','c','r','{}',1,1)");assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0);
 const retryPlan=DB.sql.prepare("EXPLAIN QUERY PLAN SELECT d.*,e.type,e.data,e.at FROM function_deliveries d JOIN studio_events e ON e.id=d.event WHERE d.function=? AND d.state IN ('pending','failed','running') AND d.due<=? ORDER BY d.due LIMIT 100").all('deliver',Date.now());assert.match(JSON.stringify(retryPlan),/function_deliveries_function_due/);assert.doesNotMatch(JSON.stringify(retryPlan),/TEMP B-TREE/);
 let calls=0;const definitions=[{name:'deliver',event:'wanted',handler:()=>{calls++;}}];await syncFunctions(env,definitions);
 for(let i=0;i<251;i++)await emitEvent(env,'wanted',{}, {id:'event-'+i});
 const plan=DB.sql.prepare('EXPLAIN QUERY PLAN SELECT seq,id,data FROM studio_events WHERE type=? AND seq>? ORDER BY seq LIMIT 100').all('wanted',0);assert.match(JSON.stringify(plan),/studio_events_type_seq/);
 await runFunctions(env,{},'https://test',{definitions});assert.equal(calls,100);
 await runFunctions(env,{},'https://test',{definitions});assert.equal(calls,200);
 await runFunctions(env,{},'https://test',{definitions});assert.equal(calls,251);
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0);assert.equal(DB.sql.prepare('SELECT count(*) n FROM function_deliveries').get().n,0);
 await emitEvent(env,'wanted',{}, {id:'later'});await runFunctions(env,{},'https://test',{definitions});assert.equal(calls,252,'sequence never resets after pruning');
});
test('long paid runs renew leases and concurrent retries return the first result exactly once',async t=>{
 const env={DB:database(t)},clock=virtualTime(t);let finish,calls=0;
 const handler=()=>{calls++;return new Promise(r=>{finish=r;});};
 const first=serviceResult(env,'paid',handler,()=>assert.fail('no refund'),{leaseMs:60});await clock.wait(1);
 await clock.wait(180);const retry=await serviceResult(env,'paid',handler,()=>assert.fail('no refund'),{leaseMs:60});assert.equal(retry.state,'running');assert.equal(calls,1);
 finish({answer:42});assert.deepEqual((await first).data,{answer:42});assert.deepEqual((await serviceResult(env,'paid',handler,()=>{}, {leaseMs:60})).data,{answer:42});assert.equal(calls,1);
});
test('failed paid handlers refund automatically and retries never execute or charge again',async t=>{
 const env={DB:database(t)};let calls=0,refunds=0;
 const run=()=>serviceResult(env,'paid',()=>{calls++;throw Error('private');},async()=>{refunds++;return {ok:true};});
 const first=await run();assert.equal(first.state,'refunded');assert.match(first.message,/automatically refunded/);assert.doesNotMatch(JSON.stringify(first),/private/);assert.deepEqual(await run(),first);assert.equal(calls,1);assert.equal(refunds,1);
});
test('unpaid offers expire and indexed pruning preserves current offers and paid snapshots',async t=>{
 const DB=database(t),env={DB},clock=virtualTime(t);const sale=serviceTerms({amount:100,currency:'usd'});
 const offer=await customerOffer(env,'service',{tool:'one',sale});assert.ok(await resourceKind('service').get(env,offer.resource,offer.version));
 DB.sql.prepare('INSERT INTO resource_snapshots(hash,manifest) SELECT ?,manifest FROM customer_offers WHERE id=?').run('paid-snapshot',offer.resource);
 t.mock.timers.tick(86400001);assert.equal(await resourceKind('service').get(env,offer.resource,offer.version),null);
 await customerOffer(env,'service',{tool:'two',sale});await pruneOffers(env);assert.equal(DB.sql.prepare('SELECT count(*) n FROM customer_offers').get().n,1);assert.equal(DB.sql.prepare("SELECT count(*) n FROM resource_snapshots WHERE hash='paid-snapshot'").get().n,1);
 assert.match(JSON.stringify(DB.sql.prepare('EXPLAIN QUERY PLAN SELECT id FROM customer_offers WHERE expires_at<=? ORDER BY expires_at LIMIT 100').all(clock.now())),/customer_offers_expiry/);
});
function studio(t){const root=mkdtempSync(join(tmpdir(),'homie-review-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const s={name:'Before',cloudflare:{worker:'test',d1:'test',d1Id:'id'}};writeFileSync(join(root,'studio.json'),JSON.stringify(s));return {root,s,read:()=>JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''))};}
test('upgrade removes the old default purchase limiter unless studio settings request it',t=>{
 const {root,s,read}=studio(t);writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify({ratelimits:[{name:'PURCHASE_RATE_LIMITER',namespace_id:'1001',simple:{limit:60,period:60}}]}));refreshWorkerConfig(root);assert.equal(read().ratelimits,undefined);
 s.cloudflare.purchaseRateLimit={name:'PURCHASE_RATE_LIMITER',namespace_id:'1001',simple:{limit:123,period:60}};writeFileSync(join(root,'studio.json'),JSON.stringify(s));writeFileSync(join(root,'shop.json'),'{}');refreshWorkerConfig(root);assert.equal(read().ratelimits[0].simple.limit,123);
});
test('config derives current name compatibility previews and observability and removes crons aliases AI stably',t=>{
 const {root,s,read}=studio(t);mkdirSync(join(root,'site/src/functions'),{recursive:true});writeFileSync(join(root,'site/src/functions/declarations.json'),JSON.stringify([{name:'daily',event:'daily',schedule:'0 9 * * *'}]));s.cloudflare.ai=true;writeFileSync(join(root,'studio.json'),JSON.stringify(s));writeFileSync(join(root,'shop.json'),'{}');writeFileSync(join(root,'wrangler.custom.json'),JSON.stringify({vars:{CUSTOM:'kept'},services:[{binding:'MY_SERVICE',service:'own'}]}));refreshWorkerConfig(root);assert.ok(read().alias);assert.ok(read().ai);assert.ok(read().triggers);
 const stale=read();stale.compatibility_date='2000-01-01';stale.observability={enabled:false};writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify(stale));s.name='Renamed';s.cloudflare.ai=false;writeFileSync(join(root,'studio.json'),JSON.stringify(s));rmSync(join(root,'shop.json'));writeFileSync(join(root,'site/src/functions/declarations.json'),'[]');refreshWorkerConfig(root);
 const config=read();assert.equal(config.vars.STUDIO_NAME,'Renamed');assert.equal(config.previews.vars.STUDIO_NAME,'Renamed');assert.equal(config.observability.enabled,true);assert.notEqual(config.compatibility_date,'2000-01-01');for(const key of ['alias','ai','triggers'])assert.equal(config[key],undefined);assert.equal(config.vars.CUSTOM,'kept');assert.equal(config.services[0].binding,'MY_SERVICE');const bytes=readFileSync(join(root,'wrangler.jsonc'),'utf8');refreshWorkerConfig(root);assert.equal(readFileSync(join(root,'wrangler.jsonc'),'utf8'),bytes);
});

test('abandoned paid work refunds without rerunning; refund outages recover on the same claim',async t=>{
 const DB=database(t),env={DB};DB.sql.exec("INSERT INTO service_results(order_id,state,due) VALUES('crashed','running',1)");let attempts=0;
 const handler=()=>assert.fail('never repeat an uncertain side effect');
 const refund=async()=>({ok:++attempts>1});
 assert.equal((await serviceResult(env,'crashed',handler,refund)).state,'refund-pending');
 assert.equal((await serviceResult(env,'crashed',handler,refund)).state,'refunded');assert.equal(attempts,2);
});
test('deployment SQL registers new functions before requests without moving existing cursors',async t=>{
 const {functionDeploymentSQL}=await import('../lib/functions-build.mjs');const {root}=studio(t),DB=database(t),env={DB};
 mkdirSync(join(root,'site/src/functions'),{recursive:true});const file=join(root,'site/src/functions/declarations.json');
 writeFileSync(file,JSON.stringify([{name:'old',event:'paid'}]));DB.sql.exec(functionDeploymentSQL(root));await emitEvent(env,'paid',{}, {id:'past'});
 writeFileSync(file,JSON.stringify([{name:'old',event:'paid'},{name:'new',event:'paid'}]));DB.sql.exec(functionDeploymentSQL(root));
 assert.equal(DB.sql.prepare("SELECT cursor FROM function_subscriptions WHERE name='old'").get().cursor,0);
 assert.equal(DB.sql.prepare("SELECT cursor FROM function_subscriptions WHERE name='new'").get().cursor,1);
 DB.sql.exec(functionDeploymentSQL(root));await syncFunctions(env,[{name:'old',event:'paid'}]);assert.equal(DB.sql.prepare("SELECT cursor FROM function_subscriptions WHERE name='new'").get().cursor,1,'old in-flight Workers cannot erase a new deployment subscription');
 const {functionCommand}=await import('../lib/functions-cli.mjs');await assert.rejects(functionCommand(root,'replay',['function','replay','new'],new Map()),/--replay/);
});

test('quote cleanup tolerates pre-offer and pre-expiry schemas during rolling upgrades',async t=>{
 const DB=database(t);DB.sql.exec('DROP TABLE customer_offers');await pruneOffers({DB});
 DB.sql.exec('CREATE TABLE customer_offers(id TEXT PRIMARY KEY,kind TEXT,manifest TEXT)');await pruneOffers({DB});
});
