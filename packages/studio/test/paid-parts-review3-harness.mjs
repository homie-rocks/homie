/** Review-2 harness: real SQLite, in-memory R2, and a stateful Stripe stand-in with Stripe's documented semantics. */
import { generateKeyPair, exportJWK } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const H = process.env.ROOT ?? new URL('../../..', import.meta.url).pathname;
const im = (p) => import(`${H}/packages/studio/${p}`);
export const { newPart, readPart, writePart, partDir, sha256, packPart } = await im('lib/parts.mjs');
export const { addPart, sharePart, findParts } = await im('lib/parts-store.mjs');
export const { buildParts } = await im('lib/parts-build.mjs');
export const { uploadPaidParts } = await im('lib/parts-upload.mjs');
export const { partsCommand } = await im('lib/parts-cli.mjs');
export const purchaseLib = await im('lib/parts-purchase.mjs');
export const { partsRoutes } = await im('worker/parts.mjs');
export const shopMod = await im('worker/shop.mjs');
export const { SHOP_MIGRATION, SHOP_RESERVATIONS, SHOP_STATEMENTS } = await im('worker/shop-store.mjs');
export const PP = await im('worker/purchases.mjs');
export const sale$ = {...await im('worker/parts-sale.mjs'),...await im('worker/purchase-crypto.mjs'),...await im('worker/purchase-pricing.mjs')};
export const stripeMod = await im('worker/stripe.mjs');
const sellingEntry = await im('worker/selling/index.mjs');
await sellingEntry.loadSelling();
export const worker = sellingEntry.default;

const scratch = mkdtempSync(join(tmpdir(), 'pp2-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
export const TEST_KEY = `rk_test_${'A1b2C3d4'.repeat(4)}`;
export const LIVE_KEY = `rk_live_${'A1b2C3d4'.repeat(4)}`;
export const SECRET = `whsec_${'testsecretvalue0'.repeat(2)}`;
export const baseSale = { amount: 1000, currency: 'usd', billing: 'one-time', scope: 'studio', source: true, updates: 'all', taxCode: 'txcd_10000000', refund: 'Ask the selling studio.', onRefund: 'terminate', onExpiry: 'terminate', commercialUse: true, transferable: false };

export function db({ migrate = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);'); sql.exec(SHOP_MIGRATION); sql.exec(SHOP_RESERVATIONS); sql.exec(SHOP_STATEMENTS);
  if (migrate) { sql.exec(PP.PURCHASE_MIGRATION); sql.exec(PP.PURCHASE_STATE); }
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null, all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
  return { sql, prepare: stmt, batch: async (list) => { sql.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
}

/** Stripe stand-in. cancelTwiceFails mirrors Stripe: cancelling a canceled subscription is an error. */
export async function stripe({ live = false } = {}) {
  const S = { sessions: new Map(), subs: new Map(), invoices: new Map(), pis: new Map(), charges: new Map(), disputes: [], refunds: [], calls: [], reqs: [], failOnce: [], strict: true, refundStatus: 'succeeded', n: 0, cancelTwiceFails: true, deny: [] };
  const id = (p) => `${p}_${(++S.n).toString().padStart(4, '0')}`;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c; const form = new URLSearchParams(text); const u = new URL(req.url, 'http://x');
    S.calls.push(`${req.method} ${u.pathname}${u.search ? '?' + u.search.slice(1, 80) : ''}`); S.reqs.push({ method: req.method, path: u.pathname, form: Object.fromEntries(form), idem: req.headers['idempotency-key'] ?? null, version: req.headers['stripe-version'] });
    if (S.failOnce.length && u.pathname.startsWith(S.failOnce[0].path) && (!S.failOnce[0].method || S.failOnce[0].method === req.method)) { const f = S.failOnce.shift(); res.statusCode = f.status ?? 500; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: f.error ?? { type: 'api_error', message: 'stand-in transient failure' } })); }
    const send = (o, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (S.deny.some((d) => u.pathname.startsWith(d))) return send({ error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint' } }, 403);
    const seg = u.pathname.split('/').filter(Boolean);
    if (u.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
      if (S.strict && form.get('expires_at')) { const d = Number(form.get('expires_at')) - Math.floor(Date.now() / 1000); if (d < 1800 || d > 86400) return send({ error: { type: 'invalid_request_error', param: 'expires_at', message: 'The `expires_at` timestamp must be between 30 minutes and 24 hours from Checkout Session creation.' } }, 400); }
      const s = { id: id('cs'), object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/x', form: Object.fromEntries(form), mode: form.get('mode'), metadata: { homie: form.get('metadata[homie]'), order: form.get('metadata[order]') }, client_reference_id: form.get('client_reference_id'), currency: form.get('line_items[0][price_data][currency]'), quantity: Number(form.get('line_items[0][quantity]')), unit: Number(form.get('line_items[0][price_data][unit_amount]')), interval: form.get('line_items[0][price_data][recurring][interval]'), payment_status: 'unpaid', status: 'open', livemode: live, customer: null };
      s.amount_subtotal = s.unit * s.quantity; s.amount_total = s.amount_subtotal; s.total_details = { amount_tax: 0 };
      S.sessions.set(s.id, s); return send(s);
    }
    if (seg[1] === 'checkout' && seg[4] === 'expire') { const session = S.sessions.get(seg[3]); if (S.strict && session.status !== 'open') return send({ error: { type: 'invalid_request_error', message: 'Only Checkout Sessions with a status in ["open"] can be expired.' } }, 400); session.status = 'expired'; return send(session); }
    if (seg[1] === 'checkout' && seg[3]) return send(S.sessions.get(seg[3]) ?? { error: { message: 'No such session' } }, S.sessions.has(seg[3]) ? 200 : 404);
    if (u.pathname === '/v1/subscriptions') return send({ data: [] });
    if (seg[1] === 'subscriptions' && seg[2]) {
      const sub = S.subs.get(seg[2]); if (!sub) return send({ error: { code: 'resource_missing', message: `No such subscription: '${seg[2]}'` } }, 404);
      if (req.method === 'DELETE') {
        if (sub.status === 'canceled' && S.cancelTwiceFails) return send({ error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such subscription: '${seg[2]}'` } }, 404);
        sub.status = 'canceled'; return send(sub);
      }
      return send({ ...sub, latest_invoice: S.invoices.get(sub.latest_invoice) });
    }
    if (u.pathname === '/v1/invoice_payments') {
      const inv = u.searchParams.get('invoice'); const pi = u.searchParams.get('payment[payment_intent]');
      const rows = [...S.pis.values()].filter((p) => p.invoice && (inv ? p.invoice === inv : p.id === pi)).map((p) => ({ invoice: p.invoice, status: 'paid', payment: { type: 'payment_intent', payment_intent: p.id } }));
      return send({ data: rows });
    }
    if (seg[1] === 'payment_intents' && seg[2]) { const p = S.pis.get(seg[2]); return p ? send({ id: p.id, metadata: p.metadata, latest_charge: u.searchParams.get('expand[0]') === 'latest_charge' ? S.charges.get(p.charge) : p.charge }) : send({ error: { message: 'no pi' } }, 404); }
    if (u.pathname === '/v1/invoices') return send({ data: [...S.invoices.values()].filter((i) => i.parent.subscription_details.subscription === u.searchParams.get('subscription')).reverse(), has_more: false });
    if (seg[1] === 'invoices' && seg[2]) return send(S.invoices.get(seg[2]) ?? {}, S.invoices.has(seg[2]) ? 200 : 404);
    if (seg[1] === 'charges' && seg[2]) return send(S.charges.get(seg[2]) ?? {}, S.charges.has(seg[2]) ? 200 : 404);
    if (u.pathname === '/v1/disputes') return send({ data: S.disputes.filter((d) => d.payment_intent === u.searchParams.get('payment_intent')) });
    if (u.pathname === '/v1/refunds' && req.method === 'GET') { const pi = S.pis.get(u.searchParams.get('payment_intent')); const c = pi && S.charges.get(pi.charge); return send({data:(c?.amount_refunded || c?.refunded) ? [{id:'re_'+c.id,payment_intent:pi.id,amount:c.refunded ? c.amount : c.amount_refunded,currency:pi.currency,status:'succeeded'}]:[],has_more:false}); }
    if (u.pathname === '/v1/refunds' && req.method === 'POST') { const p = S.pis.get(form.get('payment_intent')); const c = S.charges.get(p.charge); if (S.strict && c.refunded) return send({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge has already been refunded.' } }, 400); if (S.refundStatus === 'succeeded') { c.refunded = true; c.amount_refunded = c.amount; } S.refunds.push({ pi: p.id, idem: req.headers['idempotency-key'] }); return send({ id: id('re'), status: S.refundStatus, payment_intent: p.id, charge: c.id }); }
    if (u.pathname === '/v1/billing_portal/sessions') return send({ url: 'https://billing.stripe.com/p/session/x' });
    if (u.pathname === '/v1/webhook_endpoints') return send({ data: [] });
    return send({ error: { message: 'stand-in: unknown ' + u.pathname } }, 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const pay = (amount, metadata, invoice = null) => { const c = { id: id('ch'), object: 'charge', amount, amount_refunded: 0, refunded: false, disputed: false }; const p = { id: id('pi'), metadata, charge: c.id, invoice }; c.payment_intent = p.id; S.charges.set(c.id, c); S.pis.set(p.id, p); return p; };
  const invoiceFor = (sub, { days = 30, status = 'paid', total = sub.amount } = {}) => {
    const start = sub.period_end ?? Math.floor(Date.now() / 1000); const end = start + days * 86400;
    const inv = { id: id('in'), object: 'invoice', status, total, created: Math.floor(Date.now()/1000), amount_remaining: 0, status_transitions: { paid_at: Math.floor(Date.now()/1000) }, billing_reason: 'subscription_cycle', currency: sub.currency, parent: { subscription_details: { subscription: sub.id, metadata: sub.metadata } }, lines: { data: [{ period: { start, end }, parent: { subscription_item_details: { subscription: sub.id } } }] } };
    S.invoices.set(inv.id, inv); sub.latest_invoice = inv.id; if (status === 'paid') { sub.period_end = end; inv.pi = pay(total, {}, inv.id).id; } return inv;
  };
  return Object.assign(S, {
    base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)), pay, invoiceFor,
    /** The person pays on Stripe's page. Returns the completed session. */
    complete(sessionId) {
      const s = S.sessions.get(sessionId); s.payment_status = 'paid'; s.status = 'complete'; s.customer = id('cus');
      if (s.mode === 'subscription') { const sub = { id: id('sub'), object: 'subscription', status: 'active', livemode: live, metadata: s.metadata, currency: s.currency, amount: s.amount_subtotal, items: { data: [{ quantity: s.quantity }] }, period_end: null }; S.subs.set(sub.id, sub); invoiceFor(sub); s.subscription = sub.id; }
      else s.payment_intent = pay(s.amount_total, s.metadata).id;
      return s;
    },
    chargeOf(piId) { return S.charges.get(S.pis.get(piId).charge); },
    refund(piId) { const c = S.charges.get(S.pis.get(piId).charge); c.refunded = true; c.amount_refunded = c.amount; return c; },
  });
}

export async function world(name, { saleOpts = {}, key = TEST_KEY, shop = { till: 'stripe', currency: 'usd', items: [] }, migrate = true, bindings = {} } = {}) {
  const root = join(scratch, name); const buyer = join(scratch, `${name}-buyer`); mkdirSync(root); mkdirSync(buyer);
  for (const dir of [root, buyer]) { writeFileSync(join(dir, 'studio.json'), JSON.stringify({ name: 'Part Studio' })); mkdirSync(join(dir, 'games', 'cave'), { recursive: true }); writeFileSync(join(dir, 'games', 'cave', 'game.json'), JSON.stringify({ name: 'Cave' })); }
  newPart(root, 'camera'); const dir = partDir(root, 'camera'); const p = readPart(dir);
  writeFileSync(join(dir, 'LICENSE.txt'), 'Commercial licence.');
  Object.assign(p, { license: 'LicenseRef-Studio-Commercial', licenseTerms: 'LICENSE.txt', attribution: 'Part Studio', summary: 'A camera.', sale: { ...baseSale, ...saleOpts } }); writePart(dir, p);
  const dist = join(root, 'dist'); const objects = new Map();
  const publish = async () => {
    const r = sharePart(root, 'camera'); if (!r.ok) throw new Error('share: ' + JSON.stringify(r).slice(0, 300));
    buildParts(root, dist);
    await uploadPaidParts(root, { bucket: 'b', put: async (k, file) => { objects.set(k.replace('b/', ''), readFileSync(file)); return { code: 0 }; }, hash: async (k) => { const b = objects.get(k.replace('b/', '')); return b ? { code: 0, bytes: b.length, sha256: sha256(b) } : { code: 1 }; } });
  };
  await publish();
  const st = await stripe({ live: /live/.test(key) });
  const pair = await generateKeyPair('Ed25519', { extractable: true });
  const database = db({ migrate }); const r2 = { gets: 0 };
  const env = { PURCHASE_SIGNING_KEYS: JSON.stringify([await exportJWK(pair.privateKey)]), PURCHASE_RATE_LIMITER: { limit: async () => ({ success: true }) }, TURNSTILE_SECRET: 'x', TURNSTILE_SITE_KEY: 'x', PURCHASE_VERIFY_TURNSTILE: async () => Response.json({ success: true, hostname: 'seller.example', action: 'purchase-checkout' }), PURCHASE_PAYMENT_CAPABILITIES: JSON.stringify({ mode: /live/.test(key) ? 'live' : 'test', key: await sale$.digest(key), recurring: true }), DB: database, STRIPE_KEY: key, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: st.base,
    PURCHASE_MEDIA: { get: async (k) => { r2.gets++; const b = objects.get(k); return b ? { body: b, size: b.length, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } : null; } },
    ASSETS: { fetch: async (request) => { const path = join(dist, decodeURIComponent(new URL(request.url).pathname)); return existsSync(path) ? new Response(readFileSync(path)) : new Response('', { status: 404 }); } }, ...bindings };
  for (const [k, v] of Object.entries(bindings)) if (v === undefined) delete env[k];
  const cat = { studio: { name: 'Part Studio' }, games: [], shop };
  const fetcher = async (url, init = {}) => { const r = url instanceof Request ? url : new Request(url, init); const u = new URL(r.url); return await PP.purchaseRoutes(r, env, u, cat, { verifyHuman: env.PURCHASE_VERIFY_TURNSTILE }) ?? await partsRoutes(r, env, u, { catalogueOf: async () => cat }) ?? new Response('', { status: 404 }); };
  const api = async (path, body, claim) => { const r = await fetcher(`https://seller.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(claim ? { authorization: `Bearer ${claim}` } : {}) }, body: JSON.stringify(body ?? {}) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const add = (opts = {}, who = buyer, ref = 'seller.example/camera') => addPart(who, ref, { game: 'cave', fetch: fetcher, npm: () => ({ status: 0 }), ...opts });
  let evn = 0;
  const event = async (type, obj, id = `evt_${name}_${++evn}`, livemode = /live/.test(key)) => {
    const body = JSON.stringify({ id, type, livemode, data: { object: obj } }); const t = Math.floor(Date.now() / 1000);
    const req = new Request('https://seller.example/api/shop/hook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await stripeMod.signPayload(body, SECRET, t)}` } });
    try { const r = await shopMod.shopRoutes(req, env, {}, new URL(req.url), { catalogueOf: async () => cat }); return `${r.status} ${await r.text()}`; } catch (e) { return `THREW ${e.message}`; }
  };
  /** quote -> approve -> human POST on review page -> human pays. Returns {intent, session}. */
  const buy = async (opts = {}, who = buyer) => {
    const quote = await add(opts, who); if (!quote.purchase?.quote) throw new Error('no quote: ' + quote.why);
    const intent = await add({ ...opts, approve: quote.purchase.quote }, who); if (!intent.purchase?.checkout) throw new Error('no checkout: ' + intent.why);
    const before = new Set(st.sessions.keys());
    const opened = await fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); if (opened.status !== 303) throw new Error('review POST ' + opened.status + ' ' + await opened.text());
    const sid = [...st.sessions.keys()].find((k) => !before.has(k)); const session = st.complete(sid);
    if (opts.approveTest !== false && !/live/.test(key)) await PP.authorizePurchaseTest(env, session.metadata.order);
    return { quote, intent, session };
  };
  const order = (id) => database.sql.prepare('SELECT o.id, o.status, o.payment, o.mode, o.amount, o.paid_until, o.subscription, o.quantity, o.buyer, o.claim_hash FROM purchase_orders o' + (id ? ' WHERE o.id = ?' : '')).get(...(id ? [id] : []));
  const record = (who = buyer) => { const d = join(who, '.homie', 'paid-parts'); return existsSync(d) ? Object.fromEntries((awaitless(d))) : {}; };
  const release = async (version, change = {}, offers) => { const q = readPart(dir); q.version = version; Object.assign(q.sale, change); writePart(dir, q); if (offers) writeFileSync(join(root, 'parts', 'offers.json'), JSON.stringify(offers)); await publish(); };
  const republish = async (offers) => { if (offers) writeFileSync(join(root, 'parts', 'offers.json'), JSON.stringify(offers)); buildParts(root, dist); };
  return { root, buyer, dir, dist, env, cat, objects, st, r2, publish, release, republish, add, api, fetcher, event, buy, order, sql: database.sql, scratch, close: async () => { database.sql.close(); await st.close(); } };
}
import { readdirSync } from 'node:fs';
function awaitless(d) { return readdirSync(d).map((f) => [f, JSON.parse(readFileSync(join(d, f), 'utf8'))]); }
export function records(who) { const d = join(who, '.homie', 'paid-parts'); return existsSync(d) ? Object.fromEntries(awaitless(d)) : {}; }
export const mainRecord = (who) => Object.values(records(who)).find((r) => r && r.claim && r.ref);
