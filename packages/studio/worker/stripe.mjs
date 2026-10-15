import Stripe from 'stripe';
import {workerPermission} from './stripe-permissions.mjs';
/** The studio's own Stripe account, through Stripe's official SDK.
 * Credentials stay in Worker secrets; App setup owns endpoint creation.
 * STRIPE_API_BASE permits only loopback fakes in tests. */

/** The API version the kit is written against: the first one Managed Payments takes ("2025-03-31.basil or later"). */
export const STRIPE_VERSION = '2025-03-31.basil';
export const STRIPE_API = 'https://api.stripe.com';
/** Stripe's replay defense: https://docs.stripe.com/webhooks#preventing-replay-attacks */
export const TOLERANCE_S = 300;

/** Stripe key types: https://docs.stripe.com/keys — the studio chooses restricted or secret keys. */
export const KEY_SHAPE = /^(?:rk|sk)_(?:test|live)_[A-Za-z0-9]+$/;
export const WEBHOOK_SECRET_SHAPE = /^whsec_[A-Za-z0-9+/=_-]+$/;

/** test or live, from the key alone (never by calling Stripe). */
export const modeOf = (key) => (/^(?:rk|sk)_live_/.test(String(key ?? '')) ? 'live' : 'test');

/** Where the Worker sends Stripe calls: Stripe, or (tests) a loopback stand-in. */
export function apiBase(env) {
  const b = String(env?.STRIPE_API_BASE ?? '');
  if (!b) return STRIPE_API;
  try {
    const u = new URL(b);
    if (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return u.origin;
  } catch { /* not an address */ }
  return STRIPE_API;
}

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. Undefined and null are left out. */
export function formEncode(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === 'object' ? formEncode(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
  }
  return out;
}

/** Redact before truncating: provider errors can echo authorization or client secrets. */
export function redactStripe(value, env = {}) {
  let text = String(value ?? '');
  for (const secret of [env.STRIPE_KEY, env.STRIPE_WEBHOOK_SECRET]) if (secret) text = text.replaceAll(String(secret), '[redacted]');
  return text.replace(/(?:(?:sk|rk|pk|whsec|oak)_[A-Za-z0-9+/=_-]+|[A-Za-z0-9_]+_secret_[A-Za-z0-9_-]+)/g, '[redacted]');
}

export class StripeError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.message ? redactStripe(e.message).slice(0, 400) : `Stripe answered ${status}`);
    this.status = status;
    this.statusCode = status;
    this.code = redactStripe(e.code ?? e.type ?? 'stripe');
    this.type = e.type ? redactStripe(e.type) : null;
    this.param = typeof e.param === 'string' ? redactStripe(e.param).slice(0, 120) : null;
  }
}

/** Stripe has no such Product (a catalog Product the shop names, in a mode the catalog was never made in). */
export const isMissingProduct = (error) => error instanceof StripeError && error.code === 'resource_missing' && /product/.test(String(error.param ?? error.message));
/**
 * Stripe is holding the call for a person's approval: an Agent-tagged key's refund meets Stripe's approval rules
 * (docs.stripe.com/account/approvals). Nothing happened yet; it happens when someone approves it in Stripe.
 */
export const isApprovalRequired = (error) => error instanceof StripeError && error.code === 'approval_required';
/** The key may not do this (a restricted key without the permission). */
export const isPermissionError = (error) => error instanceof StripeError && (error.status === 403 || error.status === 401 || /permission|restricted key/i.test(error.message));

/**
 * The catalog Product a shop item is, the same id in a sandbox and in live mode: `homie_<studio slug>_<item id>`
 * (Stripe takes a product id of our choosing). Null without a slug or an item id.
 */
export async function productIdOf(slug, item) {
  if (!slug || !item) return null;
  const s = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  if (!s) return null;
  if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(item))) return `homie_${s}_${String(item).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(item)));
  return `homie_${s}_item_${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** One call with the studio's key. `idempotencyKey` makes a retried POST do the work once (Stripe keeps it 24 h). */
export async function stripeCall(env, method, path, params = null, { idempotencyKey = null, fetcher = fetch, version = STRIPE_VERSION, timeout = 15_000 } = {}) {
  if(!workerPermission(method,path))throw new StripeError(403,{error:{code:'permission_not_granted',message:'This capability is outside the studio Checkout permissions.'}});
  const key = String(env?.STRIPE_KEY ?? '');
  if (!KEY_SHAPE.test(key)) throw new StripeError(0, { error: { message: 'no Stripe key on this Worker', code: 'no-key' } });
  const base = new URL(apiBase(env));
  const sdk = new Stripe(key, { apiVersion: version, host: base.hostname, port: base.port || undefined,
    protocol: base.protocol.slice(0, -1), httpClient: Stripe.createFetchHttpClient(fetcher),
    timeout, maxNetworkRetries: 0, telemetry: false });
  const query = params && method !== 'POST' ? `?${formEncode(params)}` : '';
  try { return await sdk.rawRequest(method, path + query, method === 'POST' ? params : null,
    { ...(idempotencyKey ? { idempotencyKey } : {}) }); }
  catch (error) {
    if ((error.statusCode === 401) && env.DB) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), b => b.toString(16).padStart(2, '0')).join('');
      await env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('stripe-reconnect', digest).run();
    }
    throw new StripeError(error.statusCode ?? 502, { error: { message: (error.statusCode === 401) ? 'Reconnect Stripe with Homie App settings: Roll key, then Copy.' : redactStripe(error.message, env), code: error.code, type: error.type, param: error.param } });
  }
}

export const createCheckoutSession = (env, params, opts) => stripeCall(env, 'POST', '/v1/checkout/sessions', params, opts);
export const retrieveCheckoutSession = (env, id, opts) => stripeCall(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, null, opts);
export const createRefund = (env, params, opts) => stripeCall(env, 'POST', '/v1/refunds', params, opts);
export const expireCheckoutSession = (env, id, opts) => stripeCall(env, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, opts);
/* ------------------------------------------------------------------ webhooks */

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The v1 signature Stripe sends for `payload` at `t` (also what the tests sign with a test secret). */
export async function signPayload(payload, secret, t) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
}

/**
 * Check a webhook: `{ ok: true, event }` or `{ ok: false, why }`. The payload is the raw request body (never parsed
 * before the check); any v1 signature in the header may match (Stripe sends more than one while a secret rolls).
 */
export async function verifyWebhook(payload, header, secret, { now = Date.now(), tolerance = TOLERANCE_S } = {}) {
  if (!WEBHOOK_SECRET_SHAPE.test(String(secret ?? ''))) return { ok: false, why: 'no-secret' };
  if (typeof header !== 'string' || header.length > 4096) return { ok: false, why: 'no-signature' };
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't' && /^\d{1,12}$/.test(v ?? '')) t = Number(v);
    if (k === 'v1' && /^[a-f0-9]{64}$/.test(v ?? '')) sigs.push(v);
  }
  if (t === null || !sigs.length) return { ok: false, why: 'no-signature' };
  if (Math.abs(now / 1000 - t) > tolerance) return { ok: false, why: 'too-old' };
  let event;
  try {
    const sdk = new Stripe('webhook-verification-only');
    event = await sdk.webhooks.constructEventAsync(payload, header, secret, tolerance, Stripe.createSubtleCryptoProvider(), now);
  } catch (error) { return { ok: false, why: error instanceof SyntaxError ? 'json' : 'bad-signature' }; }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.type !== 'string') return { ok: false, why: 'not-an-event' };
  return { ok: true, event };
}

/** The Stripe Dashboard's own page for a thing (the office links there; it never copies Stripe's books). */
export function dashboardLink(mode, kind, id = '') {
  const base = `https://dashboard.stripe.com${mode === 'test' ? '/test' : ''}`;
  const safe = /^[A-Za-z0-9_]{1,255}$/.test(String(id)) ? id : '';
  switch (kind) {
    case 'payment': return safe ? `${base}/payments/${safe}` : `${base}/payments`;
    case 'payments': return `${base}/payments`;
    case 'refunds': return `${base}/refunds`;
    case 'dispute': return safe ? `${base}/disputes/${safe}` : `${base}/disputes`;
    case 'disputes': return `${base}/disputes`;
    case 'payouts': return `${base}/payouts`;
    case 'balance': return `${base}/balance/overview`;
    case 'tax': return `${base}/tax`;
    case 'keys': return `${base}/apikeys`;
    case 'webhooks': return `${base}/workbench/webhooks`;
    case 'invoices': return `${base}/invoices/create`;
    case 'managed-payments': return `${base}/settings/managed-payments`;
    default: return base;
  }
}

/** Stripe is authoritative; DELETE is idempotent even when a prior request already canceled it. */
export async function cancelSubscription(env, id) {
  try {
    const sub = await stripeCall(env, 'GET', `/v1/subscriptions/${encodeURIComponent(id)}`);
    if (sub.status === 'canceled') return sub;
    return await stripeCall(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(id)}`);
  } catch (error) { if (error.code === 'resource_missing') return { id, status: 'canceled' }; throw error; }
}

/** Expiration races with completion. Re-read after failure and accept only a terminal session. */
export async function closeCheckoutSession(env, id) {
  const session = await retrieveCheckoutSession(env, id);
  if (session.status !== 'open') return session;
  try { return await expireCheckoutSession(env, id, { idempotencyKey: `expire-${id}` }); }
  catch (error) {
    const current = await retrieveCheckoutSession(env, id);
    if (['expired', 'complete'].includes(current.status)) return current;
    throw error;
  }
}

export async function refundPayment(env, payment, params = {}) {
  const pi = await stripeCall(env, 'GET', `/v1/payment_intents/${encodeURIComponent(payment)}`, { expand: ['latest_charge'] });
  if (pi.latest_charge?.refunded) return { id: null, status: 'succeeded', already: true };
  try { return await createRefund(env, { payment_intent: payment }, { idempotencyKey: `purchase-refund-${payment}` }); }
  catch (error) { if (error.code === 'charge_already_refunded') return { id: null, status: 'succeeded', already: true }; throw error; }
}

/** Explicit configuration avoids a second owner visit to enable the customer portal. */
export async function portalConfiguration(env, origin) {
  const key = `stripe-portal:${modeOf(env.STRIPE_KEY)}`;
  const saved = await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(key).first();
  if (saved?.value) return saved.value;
  const config = await stripeCall(env, 'POST', '/v1/billing_portal/configurations', {
    business_profile: { headline: 'Manage your studio subscription' },
    features: { subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } },
    metadata: { homie: 'studio-checkout', origin },
  }, { idempotencyKey: `homie-portal-${origin}-${modeOf(env.STRIPE_KEY)}` });
  if (!/^bpc_[A-Za-z0-9]+$/.test(config.id ?? '')) throw new Error('Stripe portal configuration unavailable');
  await env.DB.prepare('INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, config.id).run();
  return config.id;
}

/** Webhook signatures identify a notification; the studio key establishes money truth. */
export async function retrieveEventObject(env, event, call = stripeCall) {
  const type = event.type;
  const resource = type.startsWith('checkout.session.') ? 'checkout/sessions' :
    type.startsWith('payment_intent.') ? 'payment_intents' :
    type.startsWith('invoice.') ? 'invoices' :
    type.startsWith('customer.subscription.') ? 'subscriptions' : null;
  if (!resource) return event.data?.object;
  const id = event.data?.object?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_]+$/.test(id)) throw new Error('Invalid Stripe object');
  const object = await call(env, 'GET', `/v1/${resource}/${encodeURIComponent(id)}`);
  if (object.id !== id) throw new Error('Stripe identity mismatch');
  return object;
}
