import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { bindSubscription, subscriptionEvent, subscriptionPortal, reconcileMembership, SUBSCRIPTIONS_MIGRATION } from '../worker/shop-subscriptions.mjs';
import { sessionParams } from '../worker/shop.mjs';
import { fullerReason } from '../worker/shop-links.mjs';
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

test('membership periods follow paid invoices, current status and portal plans without changing order snapshots',async t=>{
 const {readdirSync,readFileSync}=await import('node:fs');
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const migrations=new URL('../../../template/site/migrations/',import.meta.url);
 for(const file of readdirSync(migrations).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
 const prepare=(q,args=[])=>({bind:(...a)=>prepare(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})});
 const DB={prepare,batch:async ss=>{sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,STRIPE_KEY:'rk_test_fixture'};
 const original={id:'basic',name:'Basic',interval:'month',gives:['member:basic']};
 sql.exec("INSERT INTO players(id,name,created_at,seen_at) VALUES('alice','Alice',1,1)");
 sql.exec("INSERT INTO shop_orders(id,player,item,amount,currency,status,mode,till,created_at,updated_at,paid_at) VALUES('order','alice','basic',2000,'usd','paid','test','stripe',1,1,1)");
 sql.prepare("INSERT INTO shop_order_lines(id,order_id,position,item,quantity,unit_amount,amount,snapshot,status) VALUES('line','order',0,'basic',1,2000,2000,?,'paid')").run(JSON.stringify(original));
 sql.exec("INSERT INTO shop_subscriptions(id,order_id,customer) VALUES('sub_test','order','cus_test')");
 let current={id:'sub_test',customer:'cus_test',livemode:false,status:'active',items:{data:[{id:'si_test',quantity:1,price:{id:'price_basic',product:{id:'prod_basic',metadata:{item:'basic',line:'line'}}}}]},latest_invoice:{status:'paid',lines:{data:[{subscription_item:'si_test',price:{id:'price_basic'},period:{end:2000}}]}}};
 const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});
 globalThis.fetch=async()=>Response.json(current);
 const shop={items:[original,{id:'plus',interval:'month',gives:['member:plus']}]};
 const ends=key=>sql.prepare('SELECT ends_at FROM shop_entitlement_lines WHERE key=?').get(key)?.ends_at;
 await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:basic'),2000000);
 current.latest_invoice.lines.data[0].period.end=4000;
 await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:basic'),4000000);
 current.status='past_due';current.latest_invoice.status='open';current.latest_invoice.lines.data[0].period.end=6000;
 await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:basic'),4000000,'failure does not extend paid access');
 current.items.data[0].price={id:'price_plus',product:{id:'prod_plus',metadata:{item:'plus'}}};
 await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:basic'),0);assert.equal(ends('member:plus'),0,'unpaid plan change grants nothing');
 current.status='active';current.latest_invoice.status='paid';current.latest_invoice.lines.data[0].price.id='price_plus';
 await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:plus'),6000000);
 assert.equal(sql.prepare('SELECT snapshot FROM shop_order_lines').get().snapshot,JSON.stringify(original));
 current.status='unpaid';await reconcileMembership(env,'sub_test',shop);assert.equal(ends('member:plus'),0);
 current.status='canceled';await subscriptionEvent(env,{id:'evt_old',type:'invoice.paid',created:2,livemode:false,data:{object:{id:'in_old',subscription:'sub_test',billing_reason:'subscription_cycle'}}},shop);
 assert.equal(ends('member:plus'),0);assert.equal(sql.prepare('SELECT state FROM shop_subscriptions').get().state,'canceled');
 // A provider read already in flight must lose to a later read, even if it returns last.
 let resolveOld;let first=true;const stale=structuredClone(current);stale.status='active';
 globalThis.fetch=async()=>{if(first){first=false;return new Promise(r=>{resolveOld=()=>r(Response.json(stale));});}return Response.json(current);};
 const old=reconcileMembership(env,'sub_test',shop);
 while(!resolveOld)await new Promise(r=>setImmediate(r));
 await reconcileMembership(env,'sub_test',shop);resolveOld();await old;
 assert.equal(ends('member:plus'),0);assert.equal(sql.prepare('SELECT state FROM shop_subscriptions').get().state,'canceled');
});

test('keyless setup refuses paid membership grants that require runtime reconciliation',()=>{
 const {shop}=checkShop({till:'stripe',currency:'usd',items:[{id:'member',name:'Member',price:2000,interval:'month',gives:['member:basic']}]});
 assert.ok(fullerReason(shop));
 assert.equal(fullerReason({...shop,items:[{...shop.items[0],gives:[]}]}),null);
});
