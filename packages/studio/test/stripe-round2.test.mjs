import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stripeCall} from '../worker/stripe.mjs';
import {paid} from '../worker/shop.mjs';
test('permission denial does not revoke the whole connection; authentication denial does',async()=>{
 for(const status of [403,401]){
  const writes=[];const env={STRIPE_KEY:'rk_test_fixture',DB:{prepare:()=>({bind:(...a)=>({run:async()=>writes.push(a)})})}};
  await assert.rejects(stripeCall(env,'POST','/v1/payment_intents',{}, {fetcher:async()=>Response.json({error:{type:status===403?'permission_error':'authentication_error',message:'denied'}},{status})}));
  assert.equal(writes.length,status===401?1:0);
 }
});
test('forged paid Checkout body cannot grant without authenticated provider retrieval',async()=>{
 let reads=0;const saved=globalThis.fetch;
 globalThis.fetch=async()=>{reads++;return Response.json({id:'cs_forged',status:'open',payment_status:'unpaid'});};
 try{const env={STRIPE_KEY:'rk_test_fixture',DB:{prepare:()=>({bind:()=>({first:async()=>null})})}};
  await paid(env,{}, {id:'cs_forged',payment_status:'paid',status:'complete'});
  assert.equal(reads,1);
 }finally{globalThis.fetch=saved;}
});
test('free-only shop is ready without any Stripe connection',async()=>{
 const {readiness}=await import('../worker/shop.mjs');
 assert.equal((await readiness({DB:{prepare:()=>({first:async()=>null})}}, {till:'stripe',items:[{price:0}]})).ready,true);
});
test('Worker creates webhook using its own key and returns no signing secret',async()=>{
 const {setupStripeWebhook}=await import('../worker/stripe-bootstrap.mjs');
 const values=new Map();const DB={prepare:()=>({bind:(k,v)=>({first:async()=>values.has(k)?{value:values.get(k)}:null,run:async()=>values.set(k,v)})})};
 const env={DB,STRIPE_KEY:'rk_test_fixture',STRIPE_SETUP_CHALLENGE:'proof'};
 const response=await setupStripeWebhook(env,'https://studio.example',{call:async(e,m,p)=>{assert.equal(e.STRIPE_KEY,'rk_test_fixture');assert.equal(p,'/v1/webhook_endpoints');return{id:'we_fixture',secret:'whsec_fixture'};}});
 assert.equal(response.webhookId,'we_fixture');assert.doesNotMatch(JSON.stringify(response),/whsec/);
 assert.equal(values.get('stripe-webhook-secret'),'whsec_fixture');
});
test('all webhook purchase objects are independently retrieved before processing',async()=>{
 const {retrieveEventObject}=await import('../worker/stripe.mjs');
 const calls=[];const obj=await retrieveEventObject({}, {type:'invoice.paid',data:{object:{id:'in_fixture',paid:true}}},async(e,m,p)=>{calls.push(p);return{id:'in_fixture',paid:false};});
 assert.equal(obj.paid,false);assert.deepEqual(calls,['/v1/invoices/in_fixture']);
});
test('link-era metadata requires persisted payment or subscription binding',async()=>{
 const {legacyPurchaseBinding}=await import('../worker/purchase-reconciliation.mjs');
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,subscription TEXT);CREATE TABLE purchase_payments(payment TEXT PRIMARY KEY,order_id TEXT);INSERT INTO purchase_orders VALUES('ord_derived','sub_old');INSERT INTO purchase_payments VALUES('pi_old','ord_derived');");
 const env={DB:{prepare:q=>({bind:(...args)=>({first:async()=>db.prepare(q).get(...args)})})}};
 try{
 assert.equal(await legacyPurchaseBinding(env,{id:'ord_derived',subscription:'sub_old'},{id:'sub_old',metadata:{homie:'purchase-links-v1'}},'subscription'),true);
 assert.equal(await legacyPurchaseBinding(env,{id:'ord_derived',payment:'pi_old'},{id:'pi_old',metadata:{homie:'purchase-links-v1'}},'payment'),true);
 assert.equal(await legacyPurchaseBinding(env,{id:'ord_attacker',payment:'pi_old'},{id:'pi_old',metadata:{homie:'purchase-links-v1'}},'payment'),false);
 }finally{db.close();}
});
test('retired link webhook wrappers and version are absent from runtime API',async()=>{
 const stripe=await import('../worker/stripe.mjs'), links=await import('../worker/shop-links.mjs');
 for(const name of ['listWebhookEndpoints','createWebhookEndpoint','updateWebhookEndpoint'])assert.equal(name in stripe,false);
 assert.equal('LINKS_STRIPE_VERSION' in links,false);
});
test('sandbox acceptance is pinned to the authorized project profile',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./checkout-sandbox-acceptance.mjs',import.meta.url),'utf8');
 assert.match(source,/const profile='homie-636e9d423df0184d0af88019'/);
});
test('a succeeded notification cannot turn an unpaid retrieved PaymentIntent into payment',async()=>{
 const {purchasePaymentEvent}=await import('../worker/purchase-reconciliation.mjs');
 const env={DB:{prepare:q=>{assert.match(q,/LIMIT 0/,'unpaid PaymentIntent must not reach order writes');return{first:async()=>null};}}};
 assert.equal(await purchasePaymentEvent(env,{type:'payment_intent.succeeded',data:{object:{id:'pi_unpaid',status:'requires_payment_method',metadata:{homie:'purchase-v1',order:'ord_example'}}}}),null);
});
