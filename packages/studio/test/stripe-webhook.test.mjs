import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerStripeApi,installStripeWebhook} from '../lib/stripe-webhook.mjs';
import {SHOP_EVENTS} from '../worker/stripe-events.mjs';
test('existing owner login is reused; login approval is only requested when missing',async()=>{
 for(const connected of [true,false]){
  const calls=[],opened=[];let approved=connected;
  const owner=await ownerStripeApi({root:'.',profile:'fixture',mode:'test',account:'acct_owner',open:u=>opened.push(u),process:async args=>{
   calls.push(args);
   if(args.includes('--version'))return{code:0};
   if(args.includes('--non-interactive'))return{code:0,stdout:JSON.stringify({browser_url:'https://dashboard.stripe.com/stripecli/confirm_auth',verification_code:'ready-blue',next_step:'stripe login --complete-device'})};
   if(args.includes('--complete-device')){approved=true;return{code:0};}
   return{code:approved?0:1,stdout:approved?' {"id":"acct_owner"}':''};
  }});
  assert.equal(owner.account,'acct_owner');assert.equal(opened.length,connected?0:1);
  assert.equal(calls.some(a=>a.includes('--new-session')),false);
 }
});
test('webhook retry retains idempotency and installs signing secret only over stdin',async()=>{
 let receipt={},fail=true;const requests=[],inputs=[];
 const api=async(method,path,params,idempotency)=>{requests.push({method,path,params,idempotency});return{id:'we_owner',secret:'whsec_private'};};
 const w=async(args,opts)=>{if(args[1]==='list')return{code:0,stdout:'[]'};inputs.push(opts.input);return{code:fail?1:0};};
 const options={api,account:'acct_owner',origin:'https://studio.example',mode:'test',w,save:r=>{receipt=r;assert.doesNotMatch(JSON.stringify(r),/whsec/);}};
 await assert.rejects(installStripeWebhook(options));fail=false;
 const result=await installStripeWebhook({...options,receipt});
 assert.equal(requests[0].idempotency,requests[1].idempotency);
 assert.deepEqual(requests[0].params.enabled_events,SHOP_EVENTS);
 assert.deepEqual(inputs,['whsec_private','whsec_private']);assert.equal(result.webhookId,'we_owner');
});
test('renewal retains the endpoint and secret, and removes excess event subscriptions',async()=>{
 const writes=[];
 const receipt={account:'acct_owner',mode:'test',url:'https://studio.example/api/shop/hook',webhookId:'we_owner'};
 await installStripeWebhook({account:receipt.account,mode:'test',origin:'https://studio.example',receipt,save:()=>{},
  api:async(method,path,params)=>{if(method==='GET')return{data:[{id:'we_owner',url:receipt.url,status:'enabled',enabled_events:['*']}]};writes.push(params);return{};},
  w:async args=>{assert.equal(args[1],'list');return{code:0,stdout:'[{"name":"STRIPE_WEBHOOK_SECRET"}]'};}});
 assert.deepEqual(writes,[{enabled_events:SHOP_EVENTS}]);
});
test('wrong account stops before endpoint writes',async()=>{
 await assert.rejects(ownerStripeApi({profile:'fixture',mode:'test',account:'acct_expected',process:async()=>({code:0,stdout:'{"id":"acct_other"}'}),open:()=>assert.fail('no approval required')}));
});
