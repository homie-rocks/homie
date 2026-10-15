import {stripeCall,KEY_SHAPE} from './stripe.mjs';
/** Called only after raw-body signature verification. Keep this layer independent
 * of checkout transport and order reconciliation so either can evolve separately. */
export async function acceptStripeEvent(env,event,origin) {
  await env.DB.prepare('INSERT INTO stripe_intake(id,payload,origin,received) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING')
    .bind(event.id,JSON.stringify(event),origin,Date.now()).run();
  await env.BACKGROUND.send({v:1,type:'stripe.event',id:event.id});
  return Response.json({ok:true,queued:true});
}
export async function reconcileStripeEvent(env,id,cat) {
  const now=Date.now(),lease=now+300000;
  const row=await env.DB.prepare('UPDATE stripe_intake SET lease=?2 WHERE id=?1 AND done IS NULL AND lease<?3 RETURNING *').bind(id,lease,now).first();
  if(!row) {
    const pending=await env.DB.prepare('SELECT done,lease FROM stripe_intake WHERE id=?1').bind(id).first();
    if(pending?.done)return;
    const error=new Error('Stripe event is missing or already being reconciled');
    // After a consumer crashes, retry after its lease rather than exhausting
    // five 30-second deliveries before the five-minute lease can expire.
    if(pending?.lease>=now)error.retryAfterSeconds=Math.max(1,Math.min(301,Math.ceil((pending.lease-now)/1000)+1));
    throw error;
  }
  try {
    const event=KEY_SHAPE.test(String(env.STRIPE_KEY??''))?await stripeCall(env,'GET','/v1/events/'+encodeURIComponent(id)):JSON.parse(row.payload);
    if(event.id!==id)throw new Error('Stripe returned a different event');
    const {reconcileShopEvent,shopOf}=await import('./shop.mjs');
    const response=await reconcileShopEvent(new Request(new URL('/api/shop/hook',row.origin)),env,shopOf(cat),event);
    if(!response.ok)throw new Error('Stripe reconciliation needs retry ('+response.status+')');
    await env.DB.prepare('UPDATE stripe_intake SET done=?2,lease=0 WHERE id=?1 AND lease=?3').bind(id,Date.now(),lease).run();
  } catch(error) {
    await env.DB.prepare('UPDATE stripe_intake SET lease=0 WHERE id=?1 AND lease=?2').bind(id,lease).run();
    throw error;
  }
}
export async function pruneStripeEvents(env) {
  const cutoff=Date.now()-60*86400000;
  await env.DB.batch([
    ...(env.BACKGROUND?[env.DB.prepare('DELETE FROM stripe_intake WHERE id IN (SELECT id FROM stripe_intake WHERE done<?1 ORDER BY done LIMIT 1000)').bind(cutoff)]:[]),
    env.DB.prepare('DELETE FROM shop_events WHERE id IN (SELECT id FROM shop_events WHERE at<?1 ORDER BY at LIMIT 1000)').bind(cutoff),
  ]);
}
