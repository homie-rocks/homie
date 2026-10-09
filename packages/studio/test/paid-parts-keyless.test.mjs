import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {world} from './paid-parts-review4-harness.mjs';
import {syncPaymentLinks} from '../lib/shop-links.mjs';
import {stripeValidation} from './stripe-validation.mjs';
import {formEncode} from '../worker/stripe.mjs';
import {checkShop} from '../worker/shop-rules.mjs';

test('keyless connection syncs frozen offers, signs proofs, retries, edits and retires without a Worker API key',async()=>{
 const w=await world('keyless-setup');
 try{
  const objects={products:[],prices:[],payment_links:[],webhook_endpoints:[]};const calls=[];let n=0,receipt,secrets={};
  const api=async(method,path,params={})=>{calls.push({method,path,params});if(method==='POST')stripeValidation(path,formEncode(params),objects);const [,kind,id]=/^\/v1\/([^/]+)(?:\/(.+))?$/.exec(path);const rows=objects[kind];assert.ok(rows,path);if(method==='GET')return{data:rows,has_more:false};if(id){const row=rows.find(r=>r.id===id);assert.ok(row);Object.assign(row,params);return row;}
   const row={...params,id:params.id??`${{products:'prod',prices:'price',payment_links:'plink',webhook_endpoints:'we'}[kind]}_${++n}`,active:true};if(kind==='payment_links')row.url=`https://buy.stripe.com/test_${n}`;if(kind==='webhook_endpoints'){row.secret='whsec_'+'T'.repeat(32);row.status='enabled';}rows.push(row);return row;};
  const shop=checkShop({items:[]}).shop;
  const connect=()=>syncPaymentLinks({root:w.root,api,shop,slug:'seller',site:'https://seller.example',mode:'test',w:async(args,opts)=>{if(args[1]==='list')return{code:0,stdout:JSON.stringify(Object.keys(secrets).map(name=>({name})))};assert.deepEqual(args,['secret','bulk']);secrets={...secrets,...JSON.parse(opts.input)};return{code:0};},receipt,saveReceipt:r=>receipt=r});
  assert.equal((await connect()).ok,true);assert.equal(secrets.STRIPE_KEY,undefined);assert.equal(JSON.parse(secrets.PURCHASE_SIGNING_KEYS)[0].crv,'Ed25519');assert.equal(JSON.parse(secrets.PURCHASE_LINKS).offers.length,1);assert.ok(objects.webhook_endpoints[0].enabled_events.includes('invoice_payment.paid'));
  const writes=calls.filter(c=>c.method==='POST').length;assert.equal((await connect()).alreadyConnected,true);assert.equal(calls.filter(c=>c.method==='POST').length,writes);
  writeFileSync(join(w.root,'parts/offers.json'),JSON.stringify({camera:{price:{amount:1700},quantities:[1,5]}}));assert.equal((await connect()).ok,true);assert.equal(objects.payment_links.filter(l=>l.active).length,2);assert.deepEqual(JSON.parse(secrets.PURCHASE_LINKS).offers.map(l=>l.quantity),[1,5]);assert.equal(JSON.parse(JSON.parse(secrets.PURCHASE_LINKS).offers[0].offer).amount,1700);
  writeFileSync(join(w.root,'parts/offers.json'),JSON.stringify({camera:{active:false}}));assert.equal((await connect()).ok,true);assert.equal(JSON.parse(secrets.PURCHASE_LINKS).offers.length,0);assert.equal(objects.payment_links.filter(l=>l.active).length,0);
 }finally{await w.close();}
});


test('keyless retirement returns provider actions and observes signed cancellations without revoking paid time',async()=>{
 const w=await world('keyless-retire',{key:(await import('./paid-parts-review4-harness.mjs')).LIVE_KEY,saleOpts:{billing:'month'}});
 try {
  const bought=await w.buy();await w.event('checkout.session.completed',bought.session);
  const before=w.order(bought.intent.purchase.order);assert.ok(before.paid_until>Date.now());
  delete w.env.STRIPE_KEY;w.env.STRIPE_SHOP_LINKS=JSON.stringify({v:1,mode:'live',items:[]});
  const {retireResource}=await import('../worker/purchase-owner.mjs');const {purchasePaymentEvent}=await import('../worker/purchase-reconciliation.mjs');
  const calls=w.st.calls.length;const plan=await retireResource(w.env,'part','camera');assert.equal(plan.needs,'stripe-cancellation');assert.deepEqual(plan.subscriptions,[before.subscription]);
  await purchasePaymentEvent(w.env,{type:'customer.subscription.deleted',livemode:true,data:{object:{id:before.subscription,status:'canceled'}}});
  assert.equal((await retireResource(w.env,'part','camera')).ok,true);assert.equal(w.order(before.id).paid_until,before.paid_until);assert.equal(w.st.calls.length,calls);
 }finally{await w.close();}
});
