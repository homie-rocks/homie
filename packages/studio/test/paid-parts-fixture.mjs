import { loadSelling } from '../worker/selling/index.mjs';
await loadSelling();
import { digest } from "../worker/purchase-crypto.mjs";

import { generateKeyPair as makePartKey, exportJWK as partJwk } from 'jose';
/** Real SQLite, private object storage and a local Stripe stand-in; never credentials or money. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { newPart, readPart, writePart, partDir, sha256 } from '../lib/parts.mjs';
import { addPart, sharePart } from '../lib/parts-store.mjs';
import { buildParts } from '../lib/parts-build.mjs';
import { uploadPaidParts } from '../lib/parts-upload.mjs';
import { partsRoutes } from '../worker/parts.mjs';
import { shopRoutes } from '../worker/shop.mjs';
import { SHOP_MIGRATION, SHOP_RESERVATIONS, SHOP_STATEMENTS } from '../worker/shop-store.mjs';
import { PURCHASE_MIGRATION, PURCHASE_STATE, authorizePurchaseTest, purchaseRoutes } from '../worker/purchases.mjs';
import { signPayload } from '../worker/stripe.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'homie-paid-parts-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const KEY = `rk_test_${'A1b2C3d4'.repeat(4)}`;
const SECRET = `whsec_${'testsecretvalue0'.repeat(2)}`;
const sale = { amount: 125000, currency: 'usd', billing: 'one-time', scope: 'studio', source: true, updates: 'major', taxCode: 'txcd_10000000', refund: 'Ask the selling studio for a refund under these terms.', onRefund: 'terminate', onExpiry: 'retain', commercialUse: true, transferable: false };
function db() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);'); sql.exec(SHOP_MIGRATION); sql.exec(SHOP_RESERVATIONS); sql.exec(SHOP_STATEMENTS); sql.exec(PURCHASE_MIGRATION); sql.exec(PURCHASE_STATE);
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null, all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
  return { sql, prepare: stmt, batch: async (list) => { sql.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
}
async function fixture(name, options = {}) {
  const root = join(scratch, name); const buyer = join(scratch, `${name}-buyer`); mkdirSync(root); mkdirSync(buyer);
  for (const dir of [root, buyer]) { writeFileSync(join(dir, 'studio.json'), JSON.stringify({ name: 'Part Studio' })); mkdirSync(join(dir, 'games', 'cave'), { recursive: true }); writeFileSync(join(dir, 'games', 'cave', 'game.json'), JSON.stringify({ name: 'Cave' })); }
  newPart(root, 'camera'); const dir = partDir(root, 'camera'); const p = readPart(dir);
  writeFileSync(join(dir, 'LICENSE.txt'), 'Commercial licence for the purchased scope. Attribution required. No standalone redistribution.');
  Object.assign(p, { license: 'LicenseRef-Studio-Commercial', licenseTerms: 'LICENSE.txt', attribution: 'Part Studio', summary: 'A camera for caves.', sale: { ...sale, ...options } }); writePart(dir, p);
  assert.equal(sharePart(root, 'camera').ok, true);
  const dist = join(root, 'dist'); buildParts(root, dist);
  const objects = new Map();
  const upload = () => uploadPaidParts(root, { bucket: 'private-parts', put: async (key, file) => { objects.set(key.replace('private-parts/', ''), readFileSync(file)); return { code: 0 }; }, hash: async (key) => { const bytes = objects.get(key.replace('private-parts/', '')); return bytes ? { code: 0, bytes: bytes.length, sha256: sha256(bytes) } : { code: 1 }; } });
  await upload();
  const database = db();
  const pair = await makePartKey('Ed25519', { extractable: true });
  let requests = 0;
  const env = { PURCHASE_SIGNING_KEYS: JSON.stringify([await partJwk(pair.privateKey)]), PURCHASE_RATE_LIMITER: { limit: async () => ({ success: ++requests < 100 }) }, TURNSTILE_SECRET: 'test', TURNSTILE_SITE_KEY: 'test', PURCHASE_VERIFY_TURNSTILE: async () => Response.json({ success: true, hostname: 'seller.example', action: 'purchase-checkout' }), PURCHASE_PAYMENT_CAPABILITIES: JSON.stringify({ mode: 'test', key: await digest(KEY), recurring: true }), DB: database, STRIPE_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, PURCHASE_MEDIA: { get: async (key) => { const b = objects.get(key); return b ? { body: b, size: b.length, json: async () => JSON.parse(b) } : null; } }, ASSETS: { fetch: async (request) => { const path = join(dist, decodeURIComponent(new URL(request.url).pathname)); return existsSync(path) ? new Response(readFileSync(path)) : new Response('', { status: 404 }); } } };
  const cat = { studio: { name: 'Part Studio' }, games: [], shop: { till: 'stripe', currency: 'usd', items: [] } };
  let session; let sub; let invoice; let charge; let checkouts = 0; let refundStatus = 'succeeded';
  const server = createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c; const form = new URLSearchParams(text);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') {
      checkouts++;
      session = { id: `cs_${name}`, url: 'https://checkout.stripe.com/test', metadata: { homie: form.get('metadata[homie]'), order: form.get('metadata[order]') }, client_reference_id: form.get('client_reference_id'), currency: form.get('line_items[0][price_data][currency]'), amount_subtotal: Number(form.get('line_items[0][price_data][unit_amount]')) * Number(form.get('line_items[0][quantity]')), payment_status: 'unpaid', livemode: false, customer: `cus_${name}` };
      session.amount_total = session.amount_subtotal; session.total_details = { amount_tax: 0 };
      if (form.get('mode') === 'subscription') {
        session.subscription = `sub_${name}`;
        invoice = { parent: { subscription_details: { metadata: session.metadata } }, id: `in_${name}`, status: 'paid', subtotal: session.amount_subtotal, total: session.amount_subtotal, currency: session.currency, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 86400 } }] } };
        sub = { id: session.subscription, status: 'active', livemode: false, metadata: session.metadata, latest_invoice: invoice, items: { data: [{ quantity: Number(form.get('line_items[0][quantity]')), price: { unit_amount: Number(form.get('line_items[0][price_data][unit_amount]')), currency: session.currency, recurring: { interval: form.get('line_items[0][price_data][recurring][interval]') } } }] } };
      } else session.payment_intent = `pi_${name}`;
      charge = { id: `ch_${name}`, amount: session.amount_total, amount_refunded: 0, refunded: false, payment_intent: `pi_${name}` };
      res.end(JSON.stringify(session));
    } else if (req.url.startsWith('/v1/subscriptions?')) res.end(JSON.stringify({ data: [] }));
    else if (req.url.startsWith('/v1/checkout/sessions/')) res.end(JSON.stringify(session));
    else if (req.url.startsWith('/v1/subscriptions/')) res.end(JSON.stringify(sub));
    else if (req.url.startsWith('/v1/invoice_payments')) res.end(JSON.stringify({ data: [{ invoice: invoice?.id, status: 'paid', payment: { payment_intent: `pi_${name}` } }] }));
    else if (req.url.startsWith('/v1/payment_intents/')) res.end(JSON.stringify({ metadata: sub ? {} : session.metadata, latest_charge: charge }));
    else if (req.url.startsWith('/v1/invoices?')) res.end(JSON.stringify({ data: invoice?.status === 'paid' ? [invoice] : [], has_more: false }));
    else if (req.url.startsWith('/v1/invoices/')) res.end(JSON.stringify(invoice));
    else if (req.url.startsWith('/v1/charges/')) res.end(JSON.stringify(charge));
    else if (req.url.startsWith('/v1/refunds?') && req.method === 'GET') res.end(JSON.stringify({data:charge?.amount_refunded ? [{id:`re_${name}`,amount:charge.amount_refunded,currency:'usd',status:'succeeded'}]:[],has_more:false}));
    else if (req.url === '/v1/refunds') { if (refundStatus === 'succeeded') { charge.refunded = true; charge.amount_refunded = charge.amount; } res.end(JSON.stringify({ id: `re_${name}`, status: refundStatus })); }
    else if (req.url === '/v1/billing_portal/sessions') res.end(JSON.stringify({ url: 'https://billing.stripe.com/test' }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); env.STRIPE_API_BASE = `http://127.0.0.1:${server.address().port}`;
  const fetcher = async (url, init = {}) => {
    const r = url instanceof Request ? url : new Request(url, init); const u = new URL(r.url);
    return await purchaseRoutes(r, env, u, cat, { verifyHuman: env.PURCHASE_VERIFY_TURNSTILE }) ?? await partsRoutes(r, env, u, { catalogueOf: async () => cat }) ?? new Response('', { status: 404 });
  };
  const add = (opts = {}) => addPart(buyer, 'seller.example/camera', { game: 'cave', fetch: fetcher, npm: () => ({ status: 0 }), ...opts });
  const event = async (type, obj = session, id = `${type}-${Date.now()}`) => {
    const ev = { id, type, livemode: false, data: { object: obj } }; const body = JSON.stringify(ev); const t = Math.floor(Date.now() / 1000);
    const req = new Request('https://seller.example/api/shop/hook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await signPayload(body, SECRET, t)}` } });
    return shopRoutes(req, env, {}, new URL(req.url), { catalogueOf: async () => cat });
  };
  const buy = async () => {
    const quote = await add(); assert.equal(quote.ok, false); assert.ok(quote.purchase.quote); assert.match(quote.why, /Ask first/); assert.equal(checkouts, 0);
    const intent = await add({ approve: quote.purchase.quote }); assert.ok(intent.purchase.checkout); assert.equal(checkouts, 0);
    const opened = await fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); assert.equal(opened.status, 303); session.payment_status = 'paid'; await authorizePurchaseTest(env, session.metadata.order);
    return intent;
  };
  return { root, buyer, dir, dist, env, cat, objects, upload, add, fetcher, event, buy, get session() { return session; }, get sub() { return sub; }, get invoice() { return invoice; }, get charge() { return charge; }, set refundStatus(v) { refundStatus = v; }, close: async () => { database.sql.close(); await new Promise((r) => server.close(r)); } };
}


export { fixture, sale, KEY, SECRET };
