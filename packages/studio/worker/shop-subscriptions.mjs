import { linkConfig, hasStripeKey } from './shop-links.mjs';
import { KEY_SHAPE, stripeCall } from './stripe.mjs';
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
export async function bindSubscription(env, order, session, shop) {
  const subscription=idOf(session.subscription), customer=idOf(session.customer);
  if (!subscription || !customer || !/^sub_[A-Za-z0-9]+$/.test(subscription) || !/^cus_[A-Za-z0-9]+$/.test(customer)) throw new Error('Stripe subscription identity missing');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO shop_subscriptions(id,order_id,customer) VALUES(?1,?2,?3)').bind(subscription,order.id,customer),
    env.DB.prepare(`INSERT OR IGNORE INTO shop_subscription_events(id,subscription,type,invoice,amount,currency,at)
      VALUES(?1,?2,'subscription.started',NULL,?3,?4,?5)`).bind(`started:${subscription}`,subscription,order.amount,order.currency,order.paid_at),
  ]);
  await reconcileMembership(env, subscription, shop);
  if(!hasStripeKey(env)) {
    const invoice=typeof session.invoice==='string'?session.invoice:session.invoice?.id;
    if(invoice) {
      const saved=await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(`shop-invoice:${invoice}`).first();
      if(saved)await invoiceMembership(env,subscription,JSON.parse(saved.value));
    }
  }
}

/** Stripe retries unknown subscriptions until their Checkout has established ownership.
 * Ignore unrelated invoices, and never infer a successful renewal from a status update. */
export async function subscriptionEvent(env, event, shop) {
  if (!['invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) return null;
  const obj=event.data.object;
  const subscription=event.type.startsWith('customer.subscription.') ? obj.id : idOf(obj.parent?.subscription_details?.subscription ?? obj.subscription);
  if (!subscription) return 'ignored';
  let row;
  try {
    row=await env.DB.prepare('SELECT s.*,o.mode FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id WHERE s.id=?1').bind(subscription).first();
  } catch (error) {
    // Existing studios have no subscription ownership until they opt in and migrate.
    // Preserve retries for database failures other than an absent opt-in table.
    if (!/no such table: (?:main\.)?shop_subscriptions\b/.test(String(error?.message))) throw error;
  }
  if (!row) {
    const metadata=obj.parent?.subscription_details?.metadata ?? obj.subscription_details?.metadata ?? obj.metadata;
    if (metadata?.homie === 'shop-v1' || metadata?.homie === 'shop-links-v1') throw new Error('Subscription Checkout has not arrived; retry');
    return 'ignored';
  }
  if (event.livemode !== (row.mode === 'live')) return 'ignored';
  await reconcileMembership(env, subscription, shop);
  if(event.type==='invoice.paid' && !hasStripeKey(env))await invoiceMembership(env,subscription,obj);
  const at=(event.created ?? 0)*1000;
  let type, state;
  if (event.type === 'customer.subscription.deleted') { type='subscription.cancelled'; state='cancelled'; }
  else if (event.type === 'invoice.paid') { if (obj.billing_reason === 'subscription_create') return 'initial'; type='subscription.renewed'; state='active'; }
  else if (event.type === 'invoice.payment_failed') { type='subscription.failed'; state='past_due'; }
  else { return 'updated'; } // Scheduling cancellation is not cancellation; Stripe sends deleted when it ends.
  const eventId=type === 'subscription.renewed' ? `paid:${obj.id}` : event.id;
  await env.DB.batch([
    env.DB.prepare(`UPDATE shop_subscriptions SET state=?2,event_at=?3 WHERE id=?1 AND state!='cancelled' AND event_at<=?3 AND ?4=0`).bind(subscription,state,at,hasStripeKey(env)?1:0),
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
  if(!hasStripeKey(env)) {
    const url=linkConfig(env)?.portal;
    return typeof url==='string' && /^https:\/\/billing\.stripe\.com\/p\/login\//.test(url)?url:null;
  }
  const portal=await stripeCall(env,'POST','/v1/billing_portal/sessions',{customer:row.customer,return_url:`${origin}/shop/`});
  if (typeof portal?.url !== 'string' || new URL(portal.url).origin !== 'https://billing.stripe.com') throw new Error('Invalid Stripe portal response');
  return portal.url;
}

/** Reconcile membership access from current provider truth, not delivery order.
 * A subscription item stays attached to its original order line across portal plan
 * changes. Only catalogued products can supply replacement grants. Unknown plans
 * grant nothing. Financial order snapshots remain immutable.
 */
export async function reconcileMembership(env, subscription, shop) {
  if (!hasStripeKey(env)) return;
  const row = await env.DB.prepare(`SELECT s.*,o.player,o.status AS order_status,o.mode
    FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id WHERE s.id=?1`).bind(subscription).first();
  if (!row) return;
  const lines = (await env.DB.prepare(`SELECT * FROM shop_order_lines WHERE order_id=?1
    AND json_extract(snapshot,'$.interval') IS NOT NULL`).bind(row.order_id).all()).results;
  if (!lines.length) return;
  const revision = crypto.randomUUID(), syncKey = `subscription-sync:${subscription}`;
  await env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(syncKey,revision).run();
  const current = await stripeCall(env,'GET',`/v1/subscriptions/${subscription}`,{
    expand:['items.data.price.product','latest_invoice'],
  });
  if (current.id !== subscription || idOf(current.customer) !== row.customer || current.livemode !== (row.mode === 'live')) throw new Error('Subscription identity mismatch');
  if (current.items?.has_more) current.items = await allPages(env,'/v1/subscription_items',{subscription,expand:['data.price.product']});
  const invoice = current.latest_invoice;
  if (invoice?.lines?.has_more) invoice.lines = await allPages(env,`/v1/invoices/${invoice.id}/lines`);
  // Every mutation is conditional on the read generation. A slower request cannot
  // overwrite a newer reconciliation, including when Stripe events share a second.
  const guard = `EXISTS(SELECT 1 FROM meta WHERE key=?1 AND value=?2)`;
  const writes = [env.DB.prepare(`UPDATE shop_subscriptions SET state=?3 WHERE id=?4 AND ${guard}`)
    .bind(syncKey,revision,current.status,subscription)];
  const active = ['active','trialing','past_due'].includes(current.status) && row.order_status === 'paid';
  const used = new Set();
  for (const item of current.items?.data ?? []) {
    const mappingKey = `subscription-item:${subscription}:${item.id}`;
    const saved = await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(mappingKey).first();
    const product = item.price?.product;
    let line = lines.find(l => l.id === saved?.value);
    if (!line) line = lines.find(l => !used.has(l.id) && (product?.metadata?.line === l.id ||
      [product?.metadata?.item,product?.metadata?.homie_item].includes(l.item) ||
      (idOf(product) && JSON.parse(l.snapshot).stripeProduct === idOf(product))));
    if (!line) continue;
    used.add(line.id);
    writes.push(env.DB.prepare(`INSERT INTO meta(key,value) SELECT ?3,?4 WHERE ${guard} ON CONFLICT(key) DO NOTHING`).bind(syncKey,revision,mappingKey,line.id));
    const original = JSON.parse(line.snapshot);
    const originalProduct = product?.metadata?.item === original.id || product?.metadata?.homie_item === original.id || (idOf(product) && original.stripeProduct === idOf(product));
    const plan = originalProduct ? original : shop?.items?.find(p => p.interval && ((idOf(product) && p.stripeProduct === idOf(product)) || [product?.metadata?.item,product?.metadata?.homie_item].includes(p.id)));
    // A paid invoice line identifies both the price and subscription item. A
    // pending invoice/portal upgrade never creates an unpaid entitlement period.
    const paidLine = invoice?.status === 'paid' && invoice.lines?.data?.find(l =>
      (idOf(l.subscription_item ?? l.parent?.subscription_item_details?.subscription_item) === item.id) &&
      idOf(l.price ?? l.pricing?.price_details?.price) === item.price.id &&
      (l.amount ?? 0) >= 0);
    const paidEnd = Number(paidLine?.period?.end) * 1000;
    const previous = await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(`subscription-period:${subscription}:${item.id}`).first();
    const prior = previous ? JSON.parse(previous.value) : null;
    const end = Number.isSafeInteger(paidEnd) && paidEnd > 0 ? paidEnd : prior?.price === item.price.id ? prior.end : 0;
    const allowedEnd = active && plan && line.status !== 'refunded' ? Math.min(end, plan.ends ? Date.parse(plan.ends) : Infinity) : 0;
    writes.push(env.DB.prepare(`INSERT INTO meta(key,value) SELECT ?3,?4 WHERE ${guard} ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(syncKey,revision,`subscription-period:${subscription}:${item.id}`,JSON.stringify({price:item.price.id,end})));
    // Retain old rows with zero access: removing them would activate the legacy
    // aggregate fallback used by pre-line studios.
    writes.push(env.DB.prepare(`UPDATE shop_entitlement_lines SET ends_at=0 WHERE line_id=?3 AND order_id=?4 AND ${guard}`).bind(syncKey,revision,line.id,row.order_id));
    for (const key of row.player ? plan?.gives ?? [] : []) {
      writes.push(env.DB.prepare(`INSERT INTO entitlements(player,key,item,order_id,starts_at,ends_at,state,used_at)
        SELECT ?3,?4,?5,?6,0,?7,'active',NULL WHERE ${guard}
        ON CONFLICT(player,key,order_id) DO UPDATE SET state=CASE WHEN ?8 THEN 'active' ELSE entitlements.state END`)
        .bind(syncKey,revision,row.player,key,plan.id,row.order_id,allowedEnd,active?1:0));
      writes.push(env.DB.prepare(`INSERT INTO shop_entitlement_lines(player,key,item,order_id,line_id,quantity,starts_at,ends_at,state)
        SELECT ?3,?4,?5,?6,?7,?8,0,?9,'active' WHERE ${guard}
        ON CONFLICT DO UPDATE SET item=excluded.item,quantity=excluded.quantity,ends_at=excluded.ends_at`)
        .bind(syncKey,revision,row.player,key,plan.id,row.order_id,line.id,item.quantity,allowedEnd));
    }
  }
  for (const line of lines) if (!used.has(line.id)) writes.push(env.DB.prepare(`UPDATE shop_entitlement_lines SET ends_at=0 WHERE line_id=?3 AND order_id=?4 AND ${guard}`).bind(syncKey,revision,line.id,row.order_id));
  await env.DB.batch(writes);
}

async function allPages(env, path, params = {}) {
  const data=[];let after;
  for (;;) {
    const page=await stripeCall(env,'GET',path,{...params,limit:100,starting_after:after});
    data.push(...page.data);
    if (!page.has_more) return {data,has_more:false};
    const next=page.data.at(-1)?.id;
    if (!next || next===after) throw new Error('Stripe pagination did not advance');
    after=next;
  }
}

/** Paid signed invoices grant only their stated periods. Failure never extends access. */
async function invoiceMembership(env,subscription,invoice) {
  if(invoice.status!=='paid' || invoice.lines?.has_more)throw new Error('Complete paid invoice required');
  const row=await env.DB.prepare('SELECT s.*,o.player,o.status order_status FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id WHERE s.id=?1').bind(subscription).first();
  if(!row || row.state==='cancelled' || row.order_status!=='paid')return;
  const lines=(await env.DB.prepare('SELECT * FROM shop_order_lines WHERE order_id=?1').bind(row.order_id).all()).results;
  const writes=[];
  for(const l of lines) {
    const item=JSON.parse(l.snapshot);
    if(!item.interval)continue;
    const paid=invoice.lines.data.find(x=>(x.price?.id??x.pricing?.price_details?.price)===item.stripePrice && x.quantity===l.quantity && x.amount>=0);
    const end=Number(paid?.period?.end)*1000;
    if(!Number.isSafeInteger(end)||end<=0)continue;
    writes.push(env.DB.prepare('UPDATE shop_entitlement_lines SET ends_at=MAX(COALESCE(ends_at,0),?2) WHERE line_id=?1').bind(l.id,end));
  }
  if(writes.length)await env.DB.batch(writes);
}
