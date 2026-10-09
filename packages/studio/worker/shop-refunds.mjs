import { hasStripeKey, rememberedMoney } from './shop-links.mjs';
import { stripeCall } from './stripe.mjs';
/** Stripe refunds, shared by player orders and licensed resources. */
export async function paymentRefunds(env, payment, o) {
  const refunds = new Map();
  let cursor;
  if (payment && !hasStripeKey(env)) {
    for (const r of await rememberedMoney(env, payment, o.mode)) if (r.id.startsWith('re_')) {
      if (r.currency !== o.currency) throw new Error('Refund currency mismatch');
      refunds.set(r.id, r);
    }
  }
  if (payment && hasStripeKey(env)) do {
    const page = await stripeCall(env, 'GET', '/v1/refunds', { payment_intent: payment, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(page.data)) throw new Error('Stripe refund list is unavailable');
    for (const refund of page.data) refunds.set(refund.id, refund);
    const next = page.has_more ? page.data.at(-1)?.id : null;
    if (page.has_more && (!next || next === cursor)) throw new Error('Stripe refund list is incomplete');
    cursor = next;
  } while (cursor);
  return refunds;
}
