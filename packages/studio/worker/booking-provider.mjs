import { hasStripeKey } from './shop-links.mjs';
import { StripeError } from './stripe.mjs';
/**
 * A HOSTED BOOKING CHECKOUT PROVIDER (0.58.24). A host may bind HOMIE_PAYMENTS, a service that opens Stripe Checkout
 * for a studio's bookings on the host's own Stripe account (Homie's managed hosting does, in Stripe test mode, for
 * studios its operator approved). With no such binding, or with the studio's own STRIPE_KEY, nothing here changes
 * anything: the studio's own Stripe and Payment Links paths run as before. Every call fails closed: a missing method,
 * a thrown call or any answer but `true` means the provider is not open.
 *
 * Provider contract (all plain JSON):
 *   bookingCheckoutOpen() -> true when this studio may open a booking checkout now
 *   bookingCheckout(params) -> { id: 'cs_…', url: 'https://…', expires_at, livemode } from the toolkit's own
 *                              Checkout Session params (sessionParams)
 *   bookingSession(id) -> the Checkout Session (Stripe's shape, payment_intent expanded) or null
 */
const META = (order) => `booking-provider:${order}`;

export async function providerOpen(env) {
  if (!env?.HOMIE_PAYMENTS || hasStripeKey(env)) return false;
  try { return (await env.HOMIE_PAYMENTS.bookingCheckoutOpen()) === true; } catch { return false; }
}

/** Opens the session through the provider and remembers that this order belongs to it. */
export async function providerCheckout(env, orderId, params) {
  const session = await env.HOMIE_PAYMENTS.bookingCheckout(JSON.parse(JSON.stringify(params)));
  // A provider that heard Stripe say no answers { state: 'error', message, status, code }: show Stripe's reason.
  if (session?.state === 'error') throw new StripeError(Number.isInteger(session.status) ? session.status : 502, { error: { message: String(session.message ?? 'Stripe rejected the checkout').slice(0, 300), code: String(session.code ?? 'stripe').slice(0, 60) } });
  if (session?.state === 'rejected') throw Object.assign(new Error('The checkout is not open for this studio'), { code: 'closed' });
  if (typeof session?.id !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session.id)) throw new Error('The payment provider answered without a session');
  await env.DB.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?1,?2)').bind(META(orderId), JSON.stringify({ session: session.id, livemode: session.livemode === true })).run();
  return session;
}

/**
 * Asks the provider whether one booking order was paid, and records it with the shop's own `paid` checks (order,
 * buyer, currency, amount and tax must match). True when the order changed.
 */
export async function syncProviderOrder(env, cat, orderId) {
  if (typeof orderId !== 'string' || !/^ord_[A-Za-z0-9]{8,64}$/.test(orderId) || !env?.HOMIE_PAYMENTS || !env.DB) return false;
  try {
    const meta = await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(META(orderId)).first();
    if (!meta) return false;
    const saved = JSON.parse(meta.value);
    const order = await env.DB.prepare('SELECT id,session,status,mode FROM shop_orders WHERE id=?1').bind(orderId).first();
    if (!order || order.session !== saved.session || !['started', 'processing'].includes(order.status)) return false;
    const session = await env.HOMIE_PAYMENTS.bookingSession(order.session);
    if (!session || session.id !== order.session || session.livemode !== (order.mode === 'live') || session.metadata?.order !== orderId) return false;
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return false;
    const { paid, shopOf } = await import('./shop.mjs');
    const at = (session.payment_intent?.latest_charge?.created ?? session.payment_intent?.created ?? session.created ?? Math.floor(Date.now() / 1000)) * 1000;
    const outcome = await paid(env, shopOf(cat), session, at);
    return outcome !== 'mismatch' && outcome !== 'unknown-order';
  } catch (error) {
    console.warn('Booking provider sync', { order: orderId, reason: String(error?.message ?? error).slice(0, 200) });
    return false;
  }
}
