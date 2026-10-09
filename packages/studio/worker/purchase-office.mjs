/** Optional resource rows in the existing shop office. */
import { hasStripeKey, shopMode } from './shop-links.mjs';
import { dashboardLink, refundPayment, cancelSubscription, redactStripe } from './stripe.mjs';
import { currentPurchaseOrder, purchaseReadiness } from './purchase-owner.mjs';
import { reconcileOrder } from './purchase-reconciliation.mjs';
import { termsOf, byId } from './purchase-store.mjs';
import { manualRefundDetails } from './payment-manual-refund.mjs';
import { jobsSQL } from './payment-policy.mjs';
import { money } from './shop-rules.mjs';
export async function refundOrder(env, order, { reason = 'requested_by_customer', by = 'owner' } = {}) {
  if (order.mode !== shopMode(env)) return { ok: false, error: 'mode', message: 'Reconnect the payment mode of this order.' };
  if (!hasStripeKey(env)) return { ok: false, error: 'stripe-dashboard', message: 'Refund in Stripe or ask your connected AI. Its signed refund event updates this purchase.', url: dashboardLink(order.mode, 'payment', order.payment) };
  let o;
  try { o = await currentPurchaseOrder(env, order.id) ?? order; } catch (error) { return {ok:false,error:'stripe-retry',message:redactStripe(error.message,env)}; }
  if (o.status === 'refunded') return { ok: true, order: o.id, status: 'succeeded', already: true };
  if (!['paid','fulfilled'].includes(o.status)) return { ok: false, error: 'state', message: `This order is ${o.status}.` };
  if (!o.payment) { const manual = await manualRefundDetails(env, o); return { ok: false, error: manual ? 'manual-refund-required' : 'no-payment', ...manual }; }
  try {
    const refund = await refundPayment(env, o.payment, { reason, metadata: { order: o.id, by } });
    await reconcileOrder(env, o);
    if (refund.status !== 'succeeded') return { ok: true, pending: true, order: o.id, status: refund.status };
    if (o.subscription && termsOf(o).refundEndsSubscription === true) await cancelSubscription(env, o.subscription);
    return { ok: true, order: o.id, refund: refund.id, status: refund.status, amount: refund.amount ?? o.amount, currency: o.currency };
  } catch (error) { return { ok: false, error: 'stripe', message: redactStripe(error.message, env) }; }
}
export async function extendOffice(env, cat, origin, out) {
  try {
    out.purchases = await purchaseReadiness(env, origin, cat);
    const rows = (await env.DB.prepare('SELECT o.*, r.manifest AS manifest FROM purchase_orders o JOIN resource_snapshots r ON r.hash=o.manifest_hash ORDER BY o.created_at DESC LIMIT 100').all()).results ?? [];
    for (const r of rows) out.orders.push({ id: r.id, status: r.status, resourceKind: r.resource_kind, resource: r.resource_id, name: JSON.parse(r.manifest).name, shown: money(r.amount,r.currency), amount:r.amount, currency:r.currency, createdAt:r.created_at, mode:r.mode, player:{name:r.buyer_label}, stripe:r.payment ? dashboardLink(r.mode,'payment',r.payment):null, refundable:hasStripeKey(env) && ['paid','fulfilled'].includes(r.status), manualRefund:await manualRefundDetails(env,r) });
    out.orders.sort((a,b)=>b.createdAt-a.createdAt);
    out.paymentRecovery = (await env.DB.prepare(`SELECT id AS request_key, order_id, state, payment, error, attempts, updated_at FROM purchase_jobs WHERE ${jobsSQL('visible')} ORDER BY updated_at`).all()).results ?? [];
    out.settlementRecovery = (await env.DB.prepare('SELECT order_id, network, state, reference, error, created_at, updated_at FROM purchase_settlements ORDER BY created_at').all()).results ?? [];
  } catch (error) { if (!/no such table/.test(error.message)) throw error; out.purchases = {ready:false,missing:['Deploy the purchase migrations']}; }
}
