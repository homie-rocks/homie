import {stripeCall, WEBHOOK_SECRET_SHAPE, modeOf} from './stripe.mjs';
export const SHOP_EVENTS = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','refund.created','refund.updated','refund.failed','charge.dispute.created','charge.dispute.closed'];
const get = async (env, key) => (await env.DB?.prepare('SELECT value FROM meta WHERE key=?1').bind(key).first())?.value;
const put = (env, key, value) => env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
async function wrappingKey(env) {
 if (!/^[a-f0-9]{64}$/.test(env.STRIPE_WEBHOOK_WRAP_KEY ?? '')) throw new Error('Webhook secret protection unavailable');
 return crypto.subtle.importKey('raw', Uint8Array.from(env.STRIPE_WEBHOOK_WRAP_KEY.match(/../g), x => parseInt(x,16)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function webhookSecret(env) {
 const encrypted = await get(env,'stripe-webhook-encrypted');
 if (encrypted) {
  const {iv,data} = JSON.parse(encrypted);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode('homie-stripe-webhook-v1')},await wrappingKey(env),bytes(data)));
 }
 return await get(env,'stripe-webhook-secret') || env.STRIPE_WEBHOOK_SECRET;
}
async function saveSecret(env, secret) {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('homie-stripe-webhook-v1')}, await wrappingKey(env), new TextEncoder().encode(secret));
 await put(env,'stripe-webhook-encrypted',JSON.stringify({iv:base64(iv),data:base64(data)}));
 await env.DB.prepare('DELETE FROM meta WHERE key=?1').bind('stripe-webhook-secret').run();
}
export async function setupStripeWebhook(env, origin, {call=stripeCall}={}) {
 const prior = await get(env,'stripe-webhook-id');
 if (prior && WEBHOOK_SECRET_SHAPE.test(await webhookSecret(env))) {
  // Rolling a RAK must not leave a stale endpoint or reconnect marker.
  let hook;
  try { hook = await call(env,'GET','/v1/webhook_endpoints/'+prior); } catch(e) { if(e.status!==404)throw e; }
  if (hook?.url === origin+'/api/shop/hook' && hook.status === 'enabled') {
   if (await get(env,'stripe-webhook-secret')) await saveSecret(env,await webhookSecret(env));
   return {ok:true,webhookId:prior};
  }
 }
 await wrappingKey(env);
 const hook=await call(env,'POST','/v1/webhook_endpoints',{url:origin+'/api/shop/hook',enabled_events:SHOP_EVENTS,metadata:{homie:'studio-checkout'}},{idempotencyKey:'homie-hook-'+env.STRIPE_SETUP_CHALLENGE});
 if(!/^we_[A-Za-z0-9]+$/.test(hook.id)||!WEBHOOK_SECRET_SHAPE.test(hook.secret))throw new Error('Invalid endpoint');
 // Only the studio Worker sees the signing secret. D1 holds ciphertext; its
 // independent wrapping key is a Worker secret and survives RAK rotation.
 await saveSecret(env,hook.secret);
 await put(env,'stripe-webhook-id',hook.id);
 return {ok:true,webhookId:hook.id};
}
export async function stripeBootstrapRoute(request, env) {
 try {
  const nonce=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(request.method!=='POST'||!/^[a-f0-9]{64}$/.test(nonce??''))return new Response(null,{status:403});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==env.STRIPE_SETUP_CHALLENGE)return new Response(null,{status:403});
  const body = await request.json();
  if (body.action === 'disconnect') {
   const id = await get(env,'stripe-webhook-id');
   let revoked = false;
   if (id) {
    try { await stripeCall(env,'DELETE','/v1/webhook_endpoints/'+id); }
    catch (e) { if (![401,404].includes(e.status)) throw e; if (e.status === 401) revoked = true; }
   }
   for (const key of ['stripe-webhook-id','stripe-webhook-secret','stripe-webhook-encrypted']) await env.DB.prepare('DELETE FROM meta WHERE key=?1').bind(key).run();
   return Response.json(revoked ? {ok:false,needs:'remove-endpoint-in-stripe',webhookId:id} : {ok:true});
  }
  if (!/^rk_(test|live)_[A-Za-z0-9]+$/.test(env.STRIPE_KEY ?? '') || modeOf(env.STRIPE_KEY) !== body.mode) throw new Error('Wrong key mode');
  const account = await stripeCall(env,'GET','/v1/account');
  if (body.account && body.account !== account.id) throw new Error('Wrong account');
  for(const resource of ['/v1/checkout/sessions','/v1/payment_intents','/v1/charges','/v1/subscriptions','/v1/billing_portal/configurations','/v1/webhook_endpoints','/v1/disputes','/v1/invoices','/v1/products','/v1/prices']) await stripeCall(env,'GET',resource,{limit:1});
  const result = await setupStripeWebhook(env,new URL(request.url).origin);
  await env.DB.prepare('DELETE FROM meta WHERE key=?1').bind('stripe-reconnect').run();
  return Response.json({...result,account:account.id,name:account.business_profile?.name || account.settings?.dashboard?.display_name || account.id},{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({ok:false},{status:503});}
}
