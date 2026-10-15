/** Manual real-sandbox acceptance; excluded from default *.test.mjs CI.
 * node test/checkout-sandbox-acceptance.mjs < private-key-source
 * stdin is never printed; only the named Homie sandbox profile is used.
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
import { shopRoutes, refundOrder } from '../worker/shop.mjs';
import { withToolIdentity } from '../worker/tool-identity.mjs';

test('real Stripe sandbox acceptance', async t => {
 const sql=new DatabaseSync(':memory:');
 const migrations=new URL('../../../template/site/migrations/',import.meta.url);
 for(const file of readdirSync(migrations).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
 const prepare=(q,args=[])=>{const runSync=()=>({meta:{changes:sql.prepare(q).run(...args).changes}});return{bind:(...a)=>prepare(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>runSync(),runSync};};
 const DB={prepare,batch:async ss=>{sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB};const deliveries=[];const cat={studio:{name:'Coldsmoke'},games:[{id:'tuning',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'tune'}},freebookings:{booking:{slots:'slots',item:'free'}}}}}],shop:{till:'stripe',currency:'cad',items:[{id:'monthly',name:'Monthly gift',price:2000,interval:'month',gives:['member:monthly']},{id:'tune',name:'Tune',price:5000},{id:'wax',name:'Wax',price:1000},{id:'deposit',kind:'deposit',name:'Deposit',price:'choose',min:100},{id:'donation',kind:'donation',name:'Gift',price:'choose',min:100},{id:'free',name:'Free assessment',price:0}]}};
 sql.exec("INSERT INTO function_subscriptions(name,type,cursor,started) VALUES('paid','order.paid',0,0)");
 for(const id of ['alice','bob'])sql.prepare('INSERT INTO players(id,name,created_at,seen_at) VALUES(?,?,1,1)').run(id,id);
 sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tuning','slots','morning',JSON.stringify({capacity:1}));
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const url=new URL(req.url,origin);const r=await shopRoutes(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})}),env,{},url,{catalogueOf:async()=>cat});if(req.url==='/api/shop/hook'&&r.ok)deliveries.push({type:JSON.parse(body).type,states:sql.prepare('SELECT status FROM shop_orders').all().map(r=>r.status)});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;t.after(()=>new Promise(r=>server.close(r)));
 const profile='homie-636e9d423df0184d0af88019';
 const cliTransport=process.argv.includes('--cli-transport');
 const restrictedKey=cliTransport?'rk_test_cliTransport':readFileSync(0,'utf8').trim();
 if(!/^rk_test_[A-Za-z0-9]+$/.test(restrictedKey))throw new Error('A sandbox restricted key must be supplied privately on stdin');
 const stripe=await startStripeSandbox({origin,profile,restrictedKey});t.after(async()=>{await stripe.close();sql.close();});Object.assign(env,stripe.bindings);
 if(cliTransport) {
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
   const req=new Request(input,init),url=new URL(req.url);
   if(url.origin!=='https://api.stripe.com')return original(input,init);
   const params=req.method==='GET'?url.searchParams:new URLSearchParams(await req.text());
   if(process.argv.includes('--delayed-only')&&req.method==='POST'&&url.pathname==='/v1/checkout/sessions')params.set('payment_method_types[0]','sepa_debit');
   try { return Response.json(await stripe.call(req.method,url.pathname,params,req.headers.get('idempotency-key'))); }
   catch { return Response.json({error:{message:'Private CLI transport failed'}},{status:502}); }
  };
  t.after(()=>{globalThis.fetch=original;});
  console.log('PASS CLI transport active - this does not prove restricted key permissions');
 }

 const call=(method,path,params={})=>stripe.call(method,path,new URLSearchParams(params));
 const wait=async fn=>{const until=Date.now()+60000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,1000));}throw new Error('Acceptance timed out');};
 const buy=async(id,body)=>{const url=new URL('/api/shop/buy',origin);const req=withToolIdentity(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{id});const r=await shopRoutes(req,env,{},url,{catalogueOf:async()=>cat});return{status:r.status,...await r.json()};};
 const complete=async (order,token='tok_visa')=>{const row=sql.prepare('SELECT * FROM shop_orders WHERE id=?').get(order);await call('GET',`/v1/payment_pages/${row.session}`);const pm=await call('POST','/v1/payment_methods',{type:'card','card[token]':token,'billing_details[email]':'stripe@example.com','billing_details[name]':'Jenny Rosen','billing_details[address][line1]':'354 Oyster Point Blvd','billing_details[address][postal_code]':'94080','billing_details[address][city]':'South San Francisco','billing_details[address][state]':'CA','billing_details[address][country]':'US'});await call('POST',`/v1/payment_pages/${row.session}/confirm`,{payment_method:pm.id,expected_amount:String(row.amount)});await wait(()=>sql.prepare('SELECT paid_at FROM shop_orders WHERE id=?').get(order).paid_at!==null);};
 if(process.argv.includes('--delayed-only')) {
  assert.equal(cliTransport,true,'SEPA fixture selection is isolated to CLI acceptance');
  cat.shop.currency='eur';
  const order=await buy('alice',{item:'wax'});assert.equal(order.ok,true);
  const row=sql.prepare('SELECT * FROM shop_orders WHERE id=?').get(order.order);
  await call('GET',`/v1/payment_pages/${row.session}`);
  // Stripe CLI's published checkout.session.async_payment_succeeded fixture.
  const pm=await call('POST','/v1/payment_methods',{type:'sepa_debit','sepa_debit[iban]':'AT611904300234573201',
   'billing_details[email]':'stripe@example.com','billing_details[name]':'Jenny Rosen','billing_details[address][country]':'GB'});
  await call('POST',`/v1/payment_pages/${row.session}/confirm`,{payment_method:pm.id,expected_amount:String(row.amount)});
  await wait(()=>deliveries.some(d=>d.type==='checkout.session.completed'));
  assert.ok(deliveries.some(d=>d.type==='checkout.session.completed'&&d.states.includes('processing')),'completion waits for asynchronous funds');
  await wait(()=>sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(order.order).status==='paid');
  assert.ok(deliveries.some(d=>d.type==='checkout.session.async_payment_succeeded'));
  console.log('PASS real delayed SEPA payment stays processing until signed async success');
  return;
 }
 if(!process.argv.includes('--lifecycle-only')) {
 const request={item:'tune',game:'tuning',booking:{collection:'bookings',slot:'morning'}};
 const a=await buy('alice',request);assert.equal(a.ok,true,JSON.stringify(a));assert.equal(sql.prepare('SELECT state FROM shop_bookings').get().state,'held');
 assert.equal((await buy('bob',request)).status,409);
 await complete(a.order);assert.equal(sql.prepare('SELECT state FROM shop_bookings').get().state,'confirmed');
 console.log('PASS real Checkout payment confirms held last seat');
 for(const [item,amount] of [['deposit',1250],['donation',2300]]) { const order=await buy('alice',{item,amount,reference:'acceptance-'+item});assert.equal(order.ok,true);await complete(order.order);assert.equal(sql.prepare('SELECT amount FROM shop_orders WHERE id=?').get(order.order).amount,amount);console.log('PASS real '+item+' Checkout with exact amount'); }

 const cart=await buy('alice',{lines:[{item:'tune',quantity:2},{item:'wax',quantity:1}],reference:'table-7'});assert.equal(cart.ok,true,JSON.stringify(cart));await complete(cart.order);
 assert.equal(sql.prepare('SELECT value FROM meta WHERE key=?').get('shop-reference:'+cart.order).value,'table-7');assert.equal(JSON.parse(sql.prepare("SELECT data FROM studio_events WHERE type='order.paid' AND json_extract(data,'$.order')=?").get(cart.order).data).reference,'table-7');console.log('PASS mixed cart payment and table-7 reference');
 sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tuning','slots','later',JSON.stringify({capacity:1}));
 const exp=await buy('bob',{...request,booking:{collection:'bookings',slot:'later'}});assert.equal(exp.ok,true);
 const exprow=sql.prepare('SELECT session FROM shop_orders WHERE id=?').get(exp.order);await call('POST',`/v1/checkout/sessions/${exprow.session}/expire`);await wait(()=>sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(exp.booking).state==='released');console.log('PASS real Checkout expiry releases seat');
 const row=sql.prepare('SELECT * FROM shop_orders WHERE id=?').get(a.order);const refund=await refundOrder(env,row);assert.equal(refund.ok,true,'Worker restricted-key refund succeeds');await wait(()=>sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(a.booking).state==='released');console.log('PASS real refund releases confirmed booking');
 // Real subscription Checkout, independently of the clock-backed lifecycle fixture.

 }
 const monthly=await buy('alice',{item:'monthly',reference:'gift-20'});assert.equal(monthly.ok,true,JSON.stringify(monthly));await complete(monthly.order);
 await wait(()=>!!sql.prepare('SELECT id FROM shop_subscriptions WHERE order_id=?').get(monthly.order));
 const bound=sql.prepare('SELECT * FROM shop_subscriptions WHERE order_id=?').get(monthly.order);
 const portal=await subscriptionPortal(env,'alice',bound.id,origin);assert.match(portal,/^https:\/\/billing.stripe.com\//);console.log('PASS real monthly Checkout, membership period and buyer portal');
 t.after(async()=>{try{await call('DELETE',`/v1/subscriptions/${bound.id}`);}catch{}});
 if(process.argv.includes('--lifecycle-only')) {
  await call('POST',`/v1/subscriptions/${bound.id}`,{billing_cycle_anchor:'now',proration_behavior:'none'});
  await wait(()=>!!sql.prepare("SELECT id FROM shop_subscription_events WHERE subscription=? AND type='subscription.renewed'").get(bound.id));
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM shop_subscription_events WHERE subscription=? AND type='subscription.renewed'").get(bound.id).n,1);
  console.log('PASS real paid renewal invoice produces one durable renewal');
  const disputed=await buy('alice',{item:'wax'});assert.equal(disputed.ok,true);
  await complete(disputed.order,'tok_createDispute');
  await wait(()=>sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(disputed.order).status==='disputed');
  const dispute=sql.prepare('SELECT dispute FROM shop_orders WHERE id=?').get(disputed.order).dispute;
  await call('POST',`/v1/disputes/${dispute}`,{'evidence[uncategorized_text]':'losing_evidence',submit:'true'});
  await wait(()=>sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(disputed.order).status==='lost');
  console.log('PASS real dispute opens then closes lost without locking the buyer');
 }

});
