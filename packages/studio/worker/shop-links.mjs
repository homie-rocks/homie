/** Shared setup/runtime contract. Payment Links are public; credentials never enter this value. */
import { KEY_SHAPE, modeOf } from './stripe.mjs';
// Current documented Payment Link fields, isolated from the existing keyed transport version.
export const LINKS_STRIPE_VERSION = '2026-09-30.endive';
export const hasStripeKey = (env) => KEY_SHAPE.test(String(env?.STRIPE_KEY ?? ''));
export function linkConfig(env) {
  try { const c = JSON.parse(env?.STRIPE_SHOP_LINKS ?? 'null'); return c?.v === 1 && ['test', 'live'].includes(c.mode) && Array.isArray(c.items) ? c : null; } catch { return null; }
}
export const shopMode = (env) => hasStripeKey(env) ? modeOf(env.STRIPE_KEY) : linkConfig(env)?.mode ?? 'test';
export function linkSettings(shop) {
  return JSON.stringify({ currency: shop.currency, till: shop.till, automaticTax: shop.automaticTax, policy: shop.policy,
    cap: shop.capPerPlayerMonth, checkoutMinutes: shop.checkoutMinutes, items: shop.items });
}
export function fullerReason(shop) {
  if (shop.capPerPlayerMonth !== null) return 'Reserving a spending allowance before payment needs the fuller checkout connection.';
  if (shop.checkoutMinutes !== 1440) return 'Choosing when abandoned checkouts expire needs the fuller checkout connection.';
  return null;
}
export function paymentLinkURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'buy.stripe.com' && !u.username && !u.password && !u.port; } catch { return false; }
}

/** Only signed snapshot events call this. Store financial fields, never customer/card data.
 * Existing meta is a durable KV table. One row per provider object avoids read/modify/write races.
 * Terminal failed/canceled refunds beat stale succeeded snapshots (including same-second events).
 */
export async function rememberMoneyEvent(env, event) {
  const o = event.data.object, mode = event.livemode ? 'live' : 'test';
  const put = async (kind, value, rank) => {
    if (!/^pi_\w+$/.test(value.payment_intent ?? '') || !/^(re|dp)_\w+$/.test(value.id ?? '')) return;
    const key = `shop-money:${mode}:${value.payment_intent}:${kind}:${value.id}`;
    const record = JSON.stringify({ ...value, at: event.created ?? 0, rank });
    await env.DB.prepare(`INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value
      WHERE json_extract(excluded.value, '$.rank') > json_extract(meta.value, '$.rank') OR
      (json_extract(excluded.value, '$.rank') = json_extract(meta.value, '$.rank') AND json_extract(excluded.value, '$.at') >= json_extract(meta.value, '$.at'))`).bind(key, record).run();
  };
  const refund = (r) => put('refund', { id: r.id, payment_intent: r.payment_intent ?? o.payment_intent, amount: r.amount, currency: r.currency ?? o.currency, status: r.status, metadata: r.metadata?.line ? { line: r.metadata.line } : {} }, ['failed', 'canceled'].includes(r.status) ? 3 : r.status === 'succeeded' ? 2 : 1);
  if (event.type.startsWith('refund.')) await refund(o);
  if (event.type === 'charge.refunded') for (const r of o.refunds?.data ?? []) await refund(r);
  if (event.type.startsWith('charge.dispute.')) await put('dispute', { id: o.id, payment_intent: o.payment_intent, status: o.status }, event.type.endsWith('.closed') ? 2 : 1);
}
export async function rememberedMoney(env, payment, mode) {
  const prefix = `shop-money:${mode}:${payment}:`;
  const rows = (await env.DB.prepare('SELECT value FROM meta WHERE key >= ?1 AND key < ?2').bind(prefix, prefix + '\uffff').all()).results ?? [];
  return rows.map((r) => JSON.parse(r.value));
}
