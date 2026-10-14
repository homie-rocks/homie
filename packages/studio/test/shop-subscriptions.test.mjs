import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { bindSubscription, subscriptionEvent, subscriptionPortal, SUBSCRIPTIONS_MIGRATION } from '../worker/shop-subscriptions.mjs';
import { sessionParams } from '../worker/shop.mjs';
import { checkShop } from '../worker/shop-rules.mjs';
function fixture(t) {
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(`CREATE TABLE shop_orders(id TEXT PRIMARY KEY,player TEXT,game TEXT,mode TEXT);
 CREATE TABLE shop_entitlement_lines(order_id TEXT,line_id TEXT,ends_at INTEGER);
 CREATE TABLE shop_order_lines(id TEXT,order_id TEXT,snapshot TEXT);
 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE studio_events(id TEXT PRIMARY KEY,type TEXT,data TEXT,at INTEGER);
 CREATE TABLE function_subscriptions(type TEXT);
 INSERT INTO function_subscriptions VALUES('subscription.started'),('subscription.renewed'),('subscription.failed'),('subscription.cancelled');
 INSERT INTO shop_orders VALUES('order','giver','pantry','test');
 INSERT INTO meta VALUES('shop-reference:order','gift-20');`);
 sql.exec(SUBSCRIPTIONS_MIGRATION);
 const prepare=(q,args=[])=>({bind:(...a)=>prepare(q,a),first:async()=>sql.prepare(q).get(...args)??null,run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})});
 const DB={prepare,batch:async ss=>{sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{DB}};
}
test('giver-chosen $20 monthly creates subscription Checkout with a recurring line',()=>{
 const {shop,ok}=checkShop({till:'stripe',currency:'usd',giving:{receiptText:'Thank you for helping our pantry.'},items:[{id:'monthly',name:'Monthly gift',price:'choose',min:100,interval:'month'}]});assert.equal(ok,true);
 const item=shop.items[0];const params=sessionParams(shop,item,{id:'order'},{origin:'https://studio.example',amount:2000,player:'giver',lines:[{item,amount:2000,quantity:1}]});
 assert.equal(params.mode,'subscription');assert.equal(params.line_items[0].price_data.unit_amount,2000);assert.deepEqual(params.line_items[0].price_data.recurring,{interval:'month'});assert.equal(params.payment_intent_data,undefined);assert.equal(params.subscription_data.metadata.order,'order');assert.equal(params.custom_text.submit.message,'Thank you for helping our pantry.');
});
test('subscription lifecycle is durable and renewal is deduplicated by invoice',async t=>{
 const {sql,env}=fixture(t);const session={subscription:'sub_test',customer:'cus_test'};const order={id:'order',amount:2000,currency:'usd',paid_at:1};
 await bindSubscription(env,order,session);await bindSubscription(env,order,session);
 const ev=(id,type,created,obj)=>({id,type,created,livemode:false,data:{object:obj}});
 const invoice={id:'in_month2',parent:{subscription_details:{subscription:'sub_test'}},billing_reason:'subscription_cycle',amount_paid:2000,currency:'usd'};
 await subscriptionEvent(env,ev('evt_1','invoice.paid',2,invoice));await subscriptionEvent(env,ev('evt_duplicate','invoice.paid',2,invoice));
 await subscriptionEvent(env,ev('evt_2','invoice.payment_failed',3,{...invoice,id:'in_month3',amount_paid:0,amount_due:2000}));
 sql.exec(`INSERT INTO shop_order_lines VALUES('monthly-line','order','{"interval":"month"}'),('once-line','order','{}'); INSERT INTO shop_entitlement_lines VALUES('order','monthly-line',NULL),('order','once-line',NULL);`);
 await subscriptionEvent(env,ev('evt_3','customer.subscription.deleted',4,{id:'sub_test'}));
 await subscriptionEvent(env,ev('evt_old','invoice.paid',2,invoice));
 assert.equal(sql.prepare("SELECT ends_at FROM shop_entitlement_lines WHERE line_id='monthly-line'").get().ends_at,4000);
 assert.equal(sql.prepare("SELECT ends_at FROM shop_entitlement_lines WHERE line_id='once-line'").get().ends_at,null);
 assert.equal(sql.prepare('SELECT state FROM shop_subscriptions').get().state,'cancelled');
 const events=sql.prepare('SELECT type,data FROM studio_events ORDER BY at').all();assert.deepEqual(events.map(e=>e.type),['subscription.started','subscription.renewed','subscription.failed','subscription.cancelled']);
 assert.equal(JSON.parse(events[1].data).reference,'gift-20');
 assert.equal(await subscriptionPortal(env,'someone-else','sub_test','https://studio.example'),null);
});
test('portal uses the owning customer only, and rejects foreign provider URLs',async t=>{
 const {env}=fixture(t);await bindSubscription(env,{id:'order',amount:2000,currency:'usd',paid_at:1},{subscription:'sub_test',customer:'cus_test'});
 const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});env.STRIPE_KEY='rk_test_fixture';
 globalThis.fetch=async (url,options)=>{assert.equal(url,'https://api.stripe.com/v1/billing_portal/sessions');const form=new URLSearchParams(options.body);assert.equal(form.get('customer'),'cus_test');assert.equal(form.get('return_url'),'https://studio.example/shop/');return Response.json({url:'https://billing.stripe.com/p/session/test'});};
 assert.equal(await subscriptionPortal(env,'giver','sub_test','https://studio.example'),'https://billing.stripe.com/p/session/test');
 globalThis.fetch=async()=>Response.json({url:'https://example.org/steal'});await assert.rejects(subscriptionPortal(env,'giver','sub_test','https://studio.example'),/Invalid/);
});
