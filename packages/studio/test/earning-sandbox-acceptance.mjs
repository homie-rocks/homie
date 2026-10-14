/** Manual real-sandbox acceptance; excluded from default *.test.mjs CI.
 * HOMIE_STRIPE_SANDBOX_PROFILE='your sandbox' node --test test/earning-sandbox-acceptance.mjs
 * Checkout confirmation follows Stripe's published CLI fixture:
 * https://github.com/stripe/stripe-cli/blob/master/pkg/fixtures/triggers/checkout.session.completed.json
 * No card numbers or exported API credentials. */
import { test } from 'node:test';
import { stripeProcess } from '../lib/stripe-connect.mjs';
import { startStripeSandbox } from '../lib/dev-stripe-sandbox.mjs';
import { bindSubscription, subscriptionPortal } from '../worker/shop-subscriptions.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { shopRoutes, shopOf, reconcileOrders } from '../worker/shop.mjs';
import { withToolIdentity } from '../worker/tool-identity.mjs';

test('real Stripe sandbox acceptance', async t => {
 const sql=new DatabaseSync(':memory:');
 const migrations=new URL('../../../template/site/migrations/',import.meta.url);
 for(const file of readdirSync(migrations).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
 const prepare=(q,args=[])=>{const runSync=()=>({meta:{changes:sql.prepare(q).run(...args).changes}});return{bind:(...a)=>prepare(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>runSync(),runSync};};
 const DB={prepare,batch:async ss=>{sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB};const cat={studio:{name:'Coldsmoke'},games:[{id:'tuning',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'tune'}},freebookings:{booking:{slots:'slots',item:'free'}}}}}],shop:{till:'stripe',currency:'cad',items:[{id:'monthly',name:'Monthly gift',price:2000,interval:'month',gives:['member:monthly']},{id:'tune',name:'Tune',price:5000},{id:'wax',name:'Wax',price:1000},{id:'free',name:'Free assessment',price:0}]}};
 sql.exec("INSERT INTO function_subscriptions(name,type,cursor,started) VALUES('paid','order.paid',0,0)");
 for(const id of ['alice','bob'])sql.prepare('INSERT INTO players(id,name,created_at,seen_at) VALUES(?,?,1,1)').run(id,id);
 sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tuning','slots','morning',JSON.stringify({capacity:1}));
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const url=new URL(req.url,origin);const r=await shopRoutes(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})}),env,{},url,{catalogueOf:async()=>cat});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;t.after(()=>new Promise(r=>server.close(r)));
 const profile=process.env.HOMIE_STRIPE_SANDBOX_PROFILE;if(!profile)throw new Error('Set HOMIE_STRIPE_SANDBOX_PROFILE to the explicitly authorised sandbox profile');
 const stripe=await startStripeSandbox({origin,profile});t.after(async()=>{await stripe.close();sql.close();});Object.assign(env,stripe.bindings);
 const call=(method,path,params={})=>stripe.call(method,path,new URLSearchParams(params));
 const wait=async fn=>{const until=Date.now()+60000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,1000));}throw new Error('Acceptance timed out');};
 const buy=async(id,body)=>{const url=new URL('/api/shop/buy',origin);const req=withToolIdentity(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{id});const r=await shopRoutes(req,env,{},url,{catalogueOf:async()=>cat});return{status:r.status,...await r.json()};};
 const complete=async order=>{const row=sql.prepare('SELECT * FROM shop_orders WHERE id=?').get(order);await call('GET',`/v1/payment_pages/${row.session}`);const pm=await call('POST','/v1/payment_methods',{type:'card','card[token]':'tok_visa','billing_details[email]':'stripe@example.com','billing_details[name]':'Jenny Rosen','billing_details[address][line1]':'354 Oyster Point Blvd','billing_details[address][postal_code]':'94080','billing_details[address][city]':'South San Francisco','billing_details[address][state]':'CA','billing_details[address][country]':'US'});await call('POST',`/v1/payment_pages/${row.session}/confirm`,{payment_method:pm.id,expected_amount:String(row.amount)});await wait(()=>sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(order).status==='paid');};
 const request={item:'tune',game:'tuning',booking:{collection:'bookings',slot:'morning'}};
 const a=await buy('alice',request);assert.equal(a.ok,true,JSON.stringify(a));assert.equal(sql.prepare('SELECT state FROM shop_bookings').get().state,'held');
 assert.equal((await buy('bob',request)).status,409);
 await complete(a.order);assert.equal(sql.prepare('SELECT state FROM shop_bookings').get().state,'confirmed');
 console.log('PASS real Checkout payment confirms held last seat');
 const cart=await buy('alice',{lines:[{item:'tune',quantity:2},{item:'wax',quantity:1}],reference:'table-7'});assert.equal(cart.ok,true,JSON.stringify(cart));await complete(cart.order);
 assert.equal(sql.prepare('SELECT value FROM meta WHERE key=?').get('shop-reference:'+cart.order).value,'table-7');assert.equal(JSON.parse(sql.prepare("SELECT data FROM studio_events WHERE type='order.paid' AND json_extract(data,'$.order')=?").get(cart.order).data).reference,'table-7');console.log('PASS mixed cart payment and table-7 reference');
 sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tuning','slots','later',JSON.stringify({capacity:1}));
 const exp=await buy('bob',{...request,booking:{collection:'bookings',slot:'later'}});assert.equal(exp.ok,true);
 const exprow=sql.prepare('SELECT session FROM shop_orders WHERE id=?').get(exp.order);await call('POST',`/v1/checkout/sessions/${exprow.session}/expire`);await wait(()=>sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(exp.booking).state==='released');console.log('PASS real Checkout expiry releases seat');
 const row=sql.prepare('SELECT payment FROM shop_orders WHERE id=?').get(a.order);await call('POST','/v1/refunds',{payment_intent:row.payment});await wait(()=>sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(a.booking).state==='released');console.log('PASS real refund releases confirmed booking');
 // Real subscription Checkout, independently of the clock-backed lifecycle fixture.

 const monthly=await buy('alice',{item:'monthly',reference:'gift-20'});assert.equal(monthly.ok,true,JSON.stringify(monthly));await complete(monthly.order);
 await wait(()=>!!sql.prepare('SELECT id FROM shop_subscriptions WHERE order_id=?').get(monthly.order));
 const bound=sql.prepare('SELECT * FROM shop_subscriptions WHERE order_id=?').get(monthly.order);
 const configuration=await call('POST','/v1/billing_portal/configurations',{'business_profile[headline]':'Homie sandbox acceptance','features[subscription_cancel][enabled]':'true'});
 // The endpoint under test uses the studio's default configuration.
 const portal=await subscriptionPortal(env,'alice',bound.id,origin);assert.match(portal,/^https:\/\/billing.stripe.com\//);console.log('PASS real monthly Checkout, membership period and buyer portal');
 await call('DELETE',`/v1/subscriptions/${bound.id}`);
 // Test clocks cannot be attached retroactively to Checkout customers. Seed a
 // separate owned fixture order from a real clock customer/subscription, then
 // exercise the same signed webhook handler through renewal/failure/cancellation.
 const frozen=Math.floor(Date.now()/1000);
 const clock=await call('POST','/v1/test_helpers/test_clocks',{frozen_time:String(frozen),name:'Homie earning acceptance'});
 t.after(async()=>{await call('DELETE',`/v1/test_helpers/test_clocks/${clock.id}`);});
 const customer=await call('POST','/v1/customers',{test_clock:clock.id,name:'Homie acceptance fixture',payment_method:'pm_card_visa','invoice_settings[default_payment_method]':'pm_card_visa'});
 const product=await call('POST','/v1/products',{name:'Monthly clock membership','metadata[item]':'monthly'});
 const price=await call('POST','/v1/prices',{product:product.id,currency:'cad',unit_amount:'2000','recurring[interval]':'month'});
 const sub=await call('POST','/v1/subscriptions',{customer:customer.id,'items[0][price]':price.id,'metadata[homie]':'shop-v1'});
 const order='clock-order';const item=cat.shop.items[0];
 sql.prepare("INSERT INTO shop_orders(id,player,item,amount,currency,status,mode,till,created_at,updated_at,paid_at) VALUES(?,'alice','monthly',2000,'cad','paid','test','stripe',?,?,?)").run(order,Date.now(),Date.now(),Date.now());
 sql.prepare("INSERT INTO shop_order_lines(id,order_id,position,item,quantity,unit_amount,amount,snapshot,status) VALUES('clock-line',?,0,'monthly',1,2000,2000,?,'paid')").run(order,JSON.stringify(item));
 for(const type of ['subscription.started','subscription.renewed','subscription.failed','subscription.cancelled'])sql.prepare('INSERT OR IGNORE INTO function_subscriptions(name,type,cursor,started) VALUES(?,?,0,0)').run(type,type);
 await bindSubscription(env,{id:order,amount:2000,currency:'cad',paid_at:Date.now()},{subscription:sub.id,customer:customer.id},shopOf(cat));
 const period=()=>sql.prepare("SELECT ends_at FROM shop_entitlement_lines WHERE order_id='clock-order'").get()?.ends_at;
 await wait(()=>period()>Date.now());const firstEnd=period();
 const advance=async time=>{await call('POST',`/v1/test_helpers/test_clocks/${clock.id}/advance`,{frozen_time:String(time)});await wait(async()=> (await call('GET',`/v1/test_helpers/test_clocks/${clock.id}`)).status==='ready');};
 await advance(Math.floor(firstEnd/1000)+1);
 await advance(Math.floor(firstEnd/1000)+7200);
 await wait(()=>period()>firstEnd);console.log('PASS test-clock paid renewal extends membership');
 const secondEnd=period();
 const declined=await call('POST','/v1/payment_methods',{type:'card','card[token]':'tok_chargeCustomerFail'});
 await call('POST',`/v1/payment_methods/${declined.id}/attach`,{customer:customer.id});
 await call('POST',`/v1/subscriptions/${sub.id}`,{default_payment_method:declined.id});
 await advance(Math.floor(secondEnd/1000)+1);
 await advance(Math.floor(secondEnd/1000)+7200);
 await wait(()=>!!sql.prepare("SELECT id FROM shop_subscription_events WHERE subscription=? AND type='subscription.failed'").get(sub.id));
 assert.ok(period()<=secondEnd);console.log('PASS test-clock failure does not extend membership');
 await call('DELETE',`/v1/subscriptions/${sub.id}`);
 await wait(()=>period()===0);console.log('PASS cancellation removes membership');

 const triggered=await stripeProcess(['--project-name',profile,'trigger','checkout.session.completed']);assert.equal(triggered.code,0,'Stripe published Checkout fixture completed');console.log('PASS Stripe CLI published trigger fixture');

});
