import {RECONCILE_GUARD,guardedDatabase} from './reconcile-guard.mjs';
/** Called only after raw-body signature verification. D1 owns the work; queues
 * are wakeups and may be unavailable or exhaust their daily allowance. */
export async function acceptStripeEvent(env,event,origin) {
  await env.DB.prepare('INSERT INTO stripe_intake(id,payload,origin,received) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING')
    .bind(event.id,JSON.stringify(event),origin,Date.now()).run();
  try { await env.BACKGROUND.send({v:1,type:'stripe.event',id:event.id}); }
  catch(error) { console.warn('Stripe delivery deferred to the scheduled D1 sweep:',error.message); }
  return Response.json({ok:true,queued:true});
}
async function reconcile(env,row,event,cat) {
  const {reconcileShopEvent,shopOf}=await import('./shop.mjs');
  return reconcileShopEvent(new Request(new URL('/api/shop/hook',row.origin)),env,shopOf(cat),event);
}
export async function reconcileStripeEvent(env,id,cat,{leaseMs=300000,reconcile:deliver=reconcile}={}) {
  const now=Date.now();let lease=now+leaseMs;
  const row=await env.DB.prepare('UPDATE stripe_intake SET lease=?2 WHERE id=?1 AND done IS NULL AND lease<?3 RETURNING *').bind(id,lease,now).first();
  if(!row) {
    const pending=await env.DB.prepare('SELECT done,lease FROM stripe_intake WHERE id=?1').bind(id).first();
    if(pending?.done)return;
    const error=new Error('Stripe event is missing or already being reconciled');
    if(pending?.lease>=now)error.retryAfterSeconds=Math.max(1,Math.min(301,Math.ceil((pending.lease-now)/1000)+1));
    throw error;
  }
  let renewal=Promise.resolve(),lost=null;
  const timer=setInterval(()=>{
    renewal=renewal.then(async()=>{
      if(lost)return;
      const next=Date.now()+leaseMs;
      const renewed=await env.DB.prepare('UPDATE stripe_intake SET lease=?3 WHERE id=?1 AND lease=?2 AND done IS NULL RETURNING id').bind(id,lease,next).first();
      if(!renewed)throw new Error('Stripe reconciliation lease was lost');
      lease=next;
    }).catch(error=>{lost=error;});
  },Math.max(1,Math.floor(leaseMs/3)));
  const check=async()=>{
    await renewal;
    if(lost)throw lost;
    if(Date.now()>=lease)throw new Error('Stripe reconciliation lease expired');
  };
  const guarded={...env,DB:guardedDatabase(env.DB,check),[RECONCILE_GUARD]:check};
  try {
    await check();
    const event=JSON.parse(row.payload);
    if(event.id!==id)throw new Error('Stored Stripe event id differs');
    const response=await deliver(guarded,row,event,cat);
    if(!response.ok)throw new Error('Stripe reconciliation needs retry ('+response.status+')');
    clearInterval(timer);await renewal;
    if(lost)throw lost;
    const done=await env.DB.prepare('UPDATE stripe_intake SET done=?2,lease=0 WHERE id=?1 AND lease=?3 AND lease>?2 RETURNING id').bind(id,Date.now(),lease).first();
    if(!done)throw new Error('Stripe reconciliation lease lost before completion');
  } catch(error) {
    clearInterval(timer);await renewal;
    await env.DB.prepare('UPDATE stripe_intake SET lease=?3 WHERE id=?1 AND lease=?2').bind(id,lease,Date.now()+60000).run();
    throw error;
  } finally {clearInterval(timer);}
}
export async function stripeIntakeStatus(env) {
  if(!env.DB)return {pending:0,stuck:0};
  const row=await env.DB.prepare('SELECT COUNT(*) AS pending,COALESCE(SUM(received<?1),0) AS stuck,MIN(received) AS oldest FROM stripe_intake WHERE done IS NULL').bind(Date.now()-3600000).first();
  return {...row,message:row?.stuck?'Stripe deliveries are delayed. Check Worker logs and Stripe key permissions; scheduled recovery retries unfinished events.':null};
}
export async function sweepStripeEvents(env,cat) {
  if(!env.DB)return;
  const rows=(await env.DB.prepare('SELECT id FROM stripe_intake WHERE done IS NULL AND lease<?1 ORDER BY lease,received,id LIMIT 100').bind(Date.now()).all()).results??[];
  for(const row of rows) {
    try {await reconcileStripeEvent(env,row.id,cat);}
    catch(error) {console.error('Stripe intake recovery failed',row.id,error.message);}
  }
  const status=await stripeIntakeStatus(env);
  if(status.stuck)console.error('Stripe intake needs attention',status);
  return status;
}
export async function pruneStripeEvents(env) {
  const cutoff=Date.now()-60*86400000;
  await env.DB.batch([
    ...(env.BACKGROUND?[env.DB.prepare('DELETE FROM stripe_intake WHERE id IN (SELECT id FROM stripe_intake WHERE done<?1 ORDER BY done LIMIT 1000)').bind(cutoff)]:[]),
    env.DB.prepare('DELETE FROM shop_events WHERE id IN (SELECT id FROM shop_events WHERE at<?1 ORDER BY at LIMIT 1000)').bind(cutoff),
  ]);
}
