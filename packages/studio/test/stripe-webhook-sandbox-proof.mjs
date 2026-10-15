/** Real sandbox endpoint, private stdin boundary. No Cloudflare deployment/write.
 * The Wrangler runner is captured in memory: this proves transport arguments,
 * not installation into a deployed Worker. Never print raw provider responses. */
import assert from 'node:assert/strict';
import {ownerStripeApi,installStripeWebhook} from '../lib/stripe-webhook.mjs';
import {SHOP_EVENTS} from '../worker/stripe-events.mjs';
const profile='homie-636e9d423df0184d0af88019';
let api,endpoint;
try {
 const owner=await ownerStripeApi({profile,mode:'test',account:'acct_1UMLsKDz5BcOk2Yt',open:()=>{throw new Error('Use the already approved sandbox profile');}});
 api=owner.api;let secret,receipt;
 const result=await installStripeWebhook({...owner,mode:'test',origin:'https://homie-round5-proof.invalid',
  w:async(args,options)=>{
   if(args[1]==='list')return{code:0,stdout:'[]'};
   assert.deepEqual(args,['secret','put','STRIPE_WEBHOOK_SECRET']);
   assert.match(options.input,/^whsec_[A-Za-z0-9]+$/);secret=options.input;return{code:0};
  },save:value=>{receipt=value;endpoint=value.webhookId??endpoint;assert.doesNotMatch(JSON.stringify(value),/whsec_/);}});
 endpoint=result.webhookId;
 const hook=await api('GET','/v1/webhook_endpoints/'+endpoint);
 assert.equal(hook.livemode,false);assert.equal(hook.status,'enabled');assert.deepEqual(hook.enabled_events.sort(),[...SHOP_EVENTS].sort());
 assert.ok(secret);assert.equal(receipt.webhookId,endpoint);secret=null;
 console.log('PASS real sandbox CLI endpoint creation and exact event subscription');
 console.log('PASS signing secret reached the private Wrangler stdin boundary');
 console.log('NOT RUN actual Cloudflare secret install - requires an existing test Worker');
} catch { console.log('FAIL sandbox webhook proof - private output discarded');process.exitCode=1; }
finally {if(api&&endpoint)try{await api('DELETE','/v1/webhook_endpoints/'+endpoint);console.log('PASS temporary sandbox endpoint deleted');}catch{console.log('FAIL temporary endpoint cleanup');process.exitCode=1;}}
