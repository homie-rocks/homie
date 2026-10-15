import {stripeCall, WEBHOOK_SECRET_SHAPE, modeOf} from './stripe.mjs';
export const webhookSecret = env => env.STRIPE_WEBHOOK_SECRET;
export async function stripeBootstrapRoute(request, env) {
 try {
  const nonce=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(request.method!=='POST'||!/^[a-f0-9]{64}$/.test(nonce??''))return new Response(null,{status:403});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==env.STRIPE_SETUP_CHALLENGE)return new Response(null,{status:403});
  const body = await request.json();
  if (!/^rk_(test|live)_[A-Za-z0-9]+$/.test(env.STRIPE_KEY ?? '') || modeOf(env.STRIPE_KEY) !== body.mode) throw new Error('Wrong key mode');
  const account = await stripeCall(env,'GET','/v1/account');
  if (body.account && body.account !== account.id) throw new Error('Wrong account');
  for(const resource of ['/v1/checkout/sessions','/v1/payment_intents','/v1/charges','/v1/subscriptions','/v1/billing_portal/configurations','/v1/disputes','/v1/invoices','/v1/products','/v1/prices']) await stripeCall(env,'GET',resource,{limit:1});
  if (!WEBHOOK_SECRET_SHAPE.test(env.STRIPE_WEBHOOK_SECRET ?? '')) throw new Error('Missing webhook secret');
  const result = {ok:true};
  await env.DB.prepare('DELETE FROM meta WHERE key=?1').bind('stripe-reconnect').run();
  return Response.json({...result,account:account.id,name:account.business_profile?.name || account.settings?.dashboard?.display_name || account.id},{headers:{'cache-control':'no-store'}});
 }catch(error){return Response.json({ok:false},{status:error.status===401?401:503});}
}
