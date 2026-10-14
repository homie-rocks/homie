import { stripeCall } from './stripe.mjs';
/** Only verified shop Checkout sessions establish ownership. Provider customer IDs
 * stay private, and are never accepted from a browser. */
export const SUBSCRIPTIONS_MIGRATION_FILE = '0026_shop_subscriptions.sql';
export const SUBSCRIPTIONS_MIGRATION = `
CREATE TABLE shop_subscriptions (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, customer TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'active', event_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE shop_subscription_events (
 id TEXT PRIMARY KEY, subscription TEXT NOT NULL, type TEXT NOT NULL,
 invoice TEXT, amount INTEGER, currency TEXT, at INTEGER NOT NULL
);
CREATE TRIGGER shop_subscription_event AFTER INSERT ON shop_subscription_events BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'subscription:' || NEW.id,NEW.type,
 json_object('subscription',NEW.subscription,'order',s.order_id,'app',o.game,
 'reference',(SELECT value FROM meta WHERE key='shop-reference:' || o.id),
 'invoice',NEW.invoice,'amount',NEW.amount,'currency',NEW.currency,'mode',o.mode),NEW.at
 FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id
 WHERE s.id=NEW.subscription AND EXISTS(SELECT 1 FROM function_subscriptions WHERE type=NEW.type);
END;
`;
const idOf = x => typeof x === 'string' ? x : x?.id;
export async function bindSubscription(env, order, session) {
  const subscription=idOf(session.subscription), customer=idOf(session.customer);
  if (!subscription || !customer || !/^sub_[A-Za-z0-9]+$/.test(subscription) || !/^cus_[A-Za-z0-9]+$/.test(customer)) throw new Error('Stripe subscription identity missing');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO shop_subscriptions(id,order_id,customer) VALUES(?1,?2,?3)').bind(subscription,order.id,customer),
    env.DB.prepare(`INSERT OR IGNORE INTO shop_subscription_events(id,subscription,type,invoice,amount,currency,at)
      VALUES(?1,?2,'subscription.started',NULL,?3,?4,?5)`).bind(`started:${subscription}`,subscription,order.amount,order.currency,order.paid_at),
  ]);
}

/** Stripe retries unknown subscriptions until their Checkout has established ownership.
 * Ignore unrelated invoices, and never infer a successful renewal from a status update. */
export async function subscriptionEvent(env, event) {
  if (!['invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) return null;
  const obj=event.data.object;
  const subscription=event.type.startsWith('customer.subscription.') ? obj.id : idOf(obj.parent?.subscription_details?.subscription ?? obj.subscription);
  if (!subscription) return 'ignored';
  const row=await env.DB.prepare('SELECT s.*,o.mode FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id WHERE s.id=?1').bind(subscription).first();
  if (!row) {
    const metadata=obj.parent?.subscription_details?.metadata ?? obj.subscription_details?.metadata ?? obj.metadata;
    if (metadata?.homie === 'shop-v1' || metadata?.homie === 'shop-links-v1') throw new Error('Subscription Checkout has not arrived; retry');
    return 'ignored';
  }
  if (event.livemode !== (row.mode === 'live')) return 'ignored';
  const at=(event.created ?? 0)*1000;
  let type, state;
  if (event.type === 'customer.subscription.deleted') { type='subscription.cancelled'; state='cancelled'; }
  else if (event.type === 'invoice.paid') { if (obj.billing_reason === 'subscription_create') return 'initial'; type='subscription.renewed'; state='active'; }
  else if (event.type === 'invoice.payment_failed') { type='subscription.failed'; state='past_due'; }
  else { return 'updated'; } // Scheduling cancellation is not cancellation; Stripe sends deleted when it ends.
  const eventId=type === 'subscription.renewed' ? `paid:${obj.id}` : event.id;
  await env.DB.batch([
    env.DB.prepare(`UPDATE shop_subscriptions SET state=?2,event_at=?3 WHERE id=?1 AND state!='cancelled' AND event_at<=?3`).bind(subscription,state,at),
    env.DB.prepare(`INSERT OR IGNORE INTO shop_subscription_events(id,subscription,type,invoice,amount,currency,at)
      VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(eventId,subscription,type,event.type.startsWith('invoice.')?obj.id:null,obj.amount_paid??obj.amount_due??null,obj.currency??null,at),
    ...(state === 'cancelled' ? [env.DB.prepare(`UPDATE shop_entitlement_lines SET ends_at=MIN(COALESCE(ends_at,?2),?2)
      WHERE order_id=?1 AND line_id IN (SELECT id FROM shop_order_lines WHERE order_id=?1 AND json_extract(snapshot,'$.interval') IS NOT NULL)`)
      .bind(row.order_id,at)] : []),
  ]);
  return type;
}
export async function subscriptionPortal(env, player, subscription, origin) {
  const row=await env.DB.prepare(`SELECT s.customer FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id WHERE s.id=?1 AND o.player=?2`).bind(subscription,player).first();
  if (!row) return null;
  const portal=await stripeCall(env,'POST','/v1/billing_portal/sessions',{customer:row.customer,return_url:`${origin}/shop/`});
  if (typeof portal?.url !== 'string' || new URL(portal.url).origin !== 'https://billing.stripe.com') throw new Error('Invalid Stripe portal response');
  return portal.url;
}
