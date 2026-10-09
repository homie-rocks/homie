/**
 * THE STUDIO'S OWN STRIPE, from its Worker (@homie-rocks/studio 0.24.0). No SDK: a few form-encoded calls with the
 * studio's key (a Worker secret), and Stripe's documented webhook signature check with WebCrypto.
 *
 *   createCheckoutSession(env, params)   POST /v1/checkout/sessions (Stripe's hosted page)
 *   createRefund(env, params)            POST /v1/refunds (only ever from the owner's tap, or a confirmed ask)
 *   webhook endpoints                    list, create and turn off: only `homie-studio shop connect` calls these, on the
 *                                        owner's computer with the key the owner pasted there (0.24.3), so a new
 *                                        endpoint's signing secret goes straight to the Worker secret
 *   productIdOf(slug, item)              the catalog Product a shop item is (`homie-studio shop catalog`, 0.24.3)
 *   verifyWebhook(payload, header, secret)   the `Stripe-Signature` header: t=<seconds>,v1=<hex HMAC-SHA256 of
 *                                        "<t>.<payload>"> with the endpoint's whsec_ secret, within 5 minutes
 *
 * The key is never logged, never put in a page, never returned. STRIPE_API_BASE points the Worker at a stand-in
 * (stripe-mock in the kit's own tests; a loopback address only) and never at anything else.
 */

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
  return text.replace(/(?:[rs]k_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9+/=_-]+|[A-Za-z0-9_]+_secret_[A-Za-z0-9_-]+)/g, '[redacted]');
}

export class StripeError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.message ? redactStripe(e.message).slice(0, 300) : `Stripe answered ${status}`);
    this.status = status;
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
export async function stripeCall(env, method, path, params = null, { idempotencyKey = null, fetcher = fetch, timeout = 15_000 } = {}) {
  const key = String(env?.STRIPE_KEY ?? '');
  if (!KEY_SHAPE.test(key)) throw new StripeError(0, { error: { message: 'no Stripe key on this Worker', code: 'no-key' } });
  const body = params && method !== 'GET' ? formEncode(params).toString() : null;
  const query = params && method === 'GET' ? `?${formEncode(params).toString()}` : '';
  let res;
  try { res = await fetcher(`${apiBase(env)}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'stripe-version': STRIPE_VERSION,
      ...(body !== null ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body !== null ? { body } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  } catch (error) { throw new StripeError(502, { error: { message: redactStripe(error?.message ?? 'Stripe did not answer', env), code: 'network' } }); }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw new StripeError(res.status, JSON.parse(redactStripe(JSON.stringify(json), env)));
  return json;
}

export const createCheckoutSession = (env, params, opts) => stripeCall(env, 'POST', '/v1/checkout/sessions', params, opts);
export const retrieveCheckoutSession = (env, id, opts) => stripeCall(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, null, opts);
export const createRefund = (env, params, opts) => stripeCall(env, 'POST', '/v1/refunds', params, opts);
export const expireCheckoutSession = (env, id, opts) => stripeCall(env, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, opts);
export const listWebhookEndpoints = (env, opts) => stripeCall(env, 'GET', '/v1/webhook_endpoints', { limit: 100 }, opts);
/** The answer carries the endpoint's signing secret (`secret`), once: the caller puts it in the Worker and drops it. */
export const createWebhookEndpoint = (env, params, opts) => stripeCall(env, 'POST', '/v1/webhook_endpoints', params, opts);
export const updateWebhookEndpoint = (env, id, params, opts) => stripeCall(env, 'POST', `/v1/webhook_endpoints/${encodeURIComponent(id)}`, params, opts);

/* ------------------------------------------------------------------ webhooks */

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Constant time for equal-length strings: a wrong signature takes as long as a nearly-right one. */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

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
  const want = await signPayload(payload, secret, t);
  if (!sigs.some((s) => sameText(s, want))) return { ok: false, why: 'bad-signature' };
  let event = null;
  try { event = JSON.parse(payload); } catch { return { ok: false, why: 'json' }; }
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
