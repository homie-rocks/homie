import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './place-database.mjs';
import * as intake from '../worker/stripe-intake.mjs';
import {enqueueChanges} from '../worker/background-queue.mjs';
import {readProviderPayment,saveRecording} from '../worker/payment-recovery.mjs';
import worker from '../worker/index.mjs';
const event={id:'evt_retry',type:'unhandled.fixture',data:{object:{}},livemode:false};
const fixture=t=>({DB:database(t),BACKGROUND:{send:async()=>{}},ASSETS:{fetch:async()=>Response.json({games:[],studio:{}})}});
test('restricted Stripe keys reconcile verified payloads without Events read',async t=>{
 const env={...fixture(t),STRIPE_KEY:'rk_test_'+ 'a'.repeat(32)};let fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json({error:{message:'Events permission denied'}},{status:403});});
 await intake.acceptStripeEvent(env,event,'https://studio.test');await intake.reconcileStripeEvent(env,event.id,{games:[]});
 assert.equal(fetches,0);assert.ok(env.DB.sql.prepare('SELECT done FROM stripe_intake').get().done);
});
test('queue quota failure persists Stripe work and the indexed sweep recovers it',async t=>{
 const env=fixture(t);env.BACKGROUND.send=async()=>{throw new Error('daily operations limit');};
 assert.equal((await intake.acceptStripeEvent(env,event,'https://studio.test')).status,200);
 env.DB.sql.prepare('UPDATE stripe_intake SET received=0').run();
 const status=await intake.stripeIntakeStatus(env);assert.equal(status.stuck,1);
 await intake.sweepStripeEvents(env,{games:[]});
 assert.equal((await intake.stripeIntakeStatus(env)).pending,0);
 const plan=env.DB.sql.prepare('EXPLAIN QUERY PLAN SELECT id FROM stripe_intake WHERE done IS NULL AND lease < ? ORDER BY lease,received,id LIMIT 100').all(Date.now());
 assert.match(JSON.stringify(plan),/stripe_intake_pending/);
});
test('mutation wakeup falls back inline when queue quota is exhausted',async()=>{
 await enqueueChanges({BACKGROUND:{send:async()=>{throw new Error('daily limit');}}},'https://studio.test');
});
test('replay keeps the recorded API version, params and idempotency key',async t=>{
 const env={...fixture(t),STRIPE_KEY:'rk_test_'+ 'a'.repeat(32)},order={id:'order',amount:100,currency:'usd',mode:'test'};
 const params={amount:100,currency:'usd',metadata:{order:'order'}},version='2026-03-25.dahlia';let sent;
 t.mock.method(globalThis,'fetch',async(url,init)=>{sent=init;return Response.json({id:'pi_replayed',amount:100,currency:'usd',livemode:false});});
 env.DB.sql.exec('PRAGMA foreign_keys=OFF');
 const id=await saveRecording(env,order,params,{idempotencyKey:'original',version});
 const job=env.DB.sql.prepare('SELECT * FROM purchase_jobs WHERE id=?').get(id);
 await readProviderPayment(env,order,job);
 assert.equal(sent.headers['stripe-version'],version);assert.equal(sent.headers['idempotency-key'],'original');
 assert.equal(new URLSearchParams(sent.body).get('metadata[order]'),'order');
});
test('prune failure does not skip scheduled functions',async t=>{
 const env=fixture(t),queries=[],prepare=env.DB.prepare;
 env.DB.prepare=q=>{queries.push(q);if(q.startsWith('DELETE FROM shop_events'))throw new Error('prune unavailable');return prepare(q);};
 const promises=[];await worker.scheduled({cron:'17 * * * *'},env,{waitUntil:p=>promises.push(p)});await Promise.all(promises);
 assert.ok(queries.some(q=>q.includes('function-last-scheduled')),'function scheduling still ran');
});
test('long reconcile renews its lease and rejects a lost completion claim',async t=>{
 const env=fixture(t);await intake.acceptStripeEvent(env,event,'https://studio.test');
 let entered,release;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const first=intake.reconcileStripeEvent(env,event.id,{games:[]},{leaseMs:60,reconcile:async()=>{entered();await hold;return new Response();}});
 assert.equal(await Promise.race([started.then(()=>true),first.then(()=>false)]),true,'reconcile operation is still in flight');const original=env.DB.sql.prepare('SELECT lease FROM stripe_intake').get().lease;
 await new Promise(r=>setTimeout(r,90));
 assert.ok(env.DB.sql.prepare('SELECT lease FROM stripe_intake').get().lease>original);
 await assert.rejects(intake.reconcileStripeEvent(env,event.id,{games:[]}),/already/);
 env.DB.sql.prepare('UPDATE stripe_intake SET lease=0').run();release();await assert.rejects(first,/lease/i);
 assert.equal(env.DB.sql.prepare('SELECT done FROM stripe_intake').get().done,null);
});
test('legacy recordings without an API version retain uncertainty without replay',async t=>{
 const env={...fixture(t),STRIPE_KEY:'rk_test_'+ 'a'.repeat(32)};let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({id:'pi_legacy',amount:100,currency:'usd',livemode:false});});
 await assert.rejects(readProviderPayment(env,{id:'old',amount:100,currency:'usd',mode:'test'},{id:'legacy',payload:JSON.stringify({params:{amount:100},options:{idempotencyKey:'old'},startedAt:Date.now()})}),error=>error.manualReview===true&&/version/i.test(error.message));
 assert.equal(calls,0);
});
