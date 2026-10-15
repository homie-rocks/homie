import {stripeCall, WEBHOOK_SECRET_SHAPE} from './stripe.mjs';
export const SHOP_EVENTS = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','refund.created','refund.updated','refund.failed','charge.dispute.created','charge.dispute.closed'];
export async function webhookSecret(env) {
 return (await env.DB?.prepare('SELECT value FROM meta WHERE key=?1').bind('stripe-webhook-secret').first())?.value || env.STRIPE_WEBHOOK_SECRET;
}
export async function setupStripeWebhook(env, origin, {call=stripeCall}={}) {
 const prior=await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind('stripe-webhook-id').first();
 if(prior && WEBHOOK_SECRET_SHAPE.test(await webhookSecret(env)))return {ok:true,webhookId:prior.value};
 const hook=await call(env,'POST','/v1/webhook_endpoints',{url:origin+'/api/shop/hook',enabled_events:SHOP_EVENTS,metadata:{homie:'studio-checkout'}},{idempotencyKey:'homie-hook-'+env.STRIPE_SETUP_CHALLENGE});
 if(!/^we_[A-Za-z0-9]+$/.test(hook.id)||!WEBHOOK_SECRET_SHAPE.test(hook.secret))throw new Error('Invalid endpoint');
 // Only this studio's Worker/database handles the plaintext signing secret.
 for(const [k,v] of [['stripe-webhook-secret',hook.secret],['stripe-webhook-id',hook.id]])await env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,v).run();
 return {ok:true,webhookId:hook.id};
}
export async function stripeBootstrapRoute(request, env) {
 try {
  const nonce=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(request.method!=='POST'||!/^[a-f0-9]{64}$/.test(nonce??''))return new Response(null,{status:403});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==env.STRIPE_SETUP_CHALLENGE)return new Response(null,{status:403});
  return Response.json(await setupStripeWebhook(env,new URL(request.url).origin),{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({ok:false},{status:503});}
}
