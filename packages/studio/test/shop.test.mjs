/**
 * @homie-rocks/studio 0.24.0: the shop kit (worker/shop.mjs, shop-rules.mjs, shop-store.mjs, stripe.mjs,
 * referrals.mjs, shop-page.mjs; lib/shop.mjs; shop/shop.ts). A studio sells with ITS OWN Stripe.
 *
 *   - studio settings: optional amounts without ceilings and editable presets; the protective policy closes kids studios; who may buy (guest, the age question, under 13, 13-17, adult);
 *   - Stripe: the form encoding, the webhook signature (good, wrong, old, a rolled secret), test or live by the key;
 *   - the Worker against a stand-in Stripe at the HTTP boundary (Stripe's documented objects): closed until the key
 *     and the webhook secret are in; a kids server shows nothing and refuses a buy; a beginner server hides an item
 *     with a play advantage; an adult's Checkout Session (Stripe Tax on, or Managed Payments with a tax code and no
 *     automatic_tax); 13-17 through a parent's one-time link; the cap; the signed webhook is the only writer of paid,
 *     each event once, a test event never on a live shop; what the player owns; a supporter's badge in a room;
 *     a refund is the owner's one tap, from an office key only an ASK; a dispute never touches the account; the
 *     player's own refund of an unused item; deleting an account asks first and keeps the orders without the player;
 *     the export; the office view and CSV; the TV's code and the play shell; referrals end to end with a signed
 *     statement checked against the seller's manifest;
 *   - stripe-mock (Stripe's open-source mock, which checks every parameter against Stripe's API description), when
 *     STRIPE_MOCK_URL names one (CI starts it): both tills' Checkout Sessions and a refund are accepted;
 *   - the CLI: init, check, the build refusing a bad shop.json, and `shop connect`'s page: the key goes to the
 *     Worker secret on Wrangler's standard input and is never printed; a live key is refused on the test page;
 *   - @homie-rocks/studio/shop in a game: has, entitlements, change, open, used.
 * No real money, no live mode, no Stripe account: every key and secret here is a made-up test value.
 * Run: node --test packages/studio/test/shop.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { POLICY_PRESETS, parseAmount, amountError, currencyScale, money, bandOf, checkShop, wayFor } from '../worker/shop-rules.mjs';
import { formEncode, modeOf, apiBase, signPayload, verifyWebhook } from '../worker/stripe.mjs';
import { SHOP_MIGRATION_FILE, SHOP_RESERVATIONS_FILE, SHOP_STATEMENTS_FILE, SHOP_LINES_FILE } from '../worker/shop-store.mjs';
import { canonicalJson, resetReferrers, verifyStatement } from '../worker/referrals.mjs';
import { resetShopLimits } from '../worker/shop.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-shop-')));
const open = [];
test.after(() => { for (const x of open) x.close(); rmSync(scratch, { recursive: true, force: true }); });
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const EVIL = '<img src=x onerror=alert(1)>';
// Made-up test values in Stripe's shapes (never a real account's).
const TEST_KEY = `rk_test_${'A1b2C3d4'.repeat(4)}`;
const HOOK_SECRET = `whsec_${'testsecretvalue0'.repeat(2)}`;
const SUPPORTER = { id: 'supporter', kind: 'supporter', name: 'Supporter', price: 500, days: 365, gives: ['badge:supporter', 'credits-name'], badge: 'Supporter', blurb: 'A badge and your name in the credits.' };

/* ------------------------------------------------------------------ the rules */

test('the studio chooses its amounts, catalog and policy; only provider units and safe arithmetic constrain prices', () => {
  const raw = { till: 'stripe', currency: 'usd', items: [SUPPORTER] };
  const checked = checkShop(raw);
  assert.equal(checked.ok, true);
  assert.equal(checked.shop.capPerPlayerMonth, null);
  assert.equal(checked.shop.refundDays, null);
  assert.equal(checked.shop.policy.preset, 'custom');
  for (const [field, value] of [['capPerPlayerMonth', 10000000], ['refundDays', 10000], ['refundDays', 0], ['refundDays', 0.5]]) {
    const r = checkShop({ ...raw, [field]: value });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.shop[field], value);
  }
  const written = checkShop({ ...raw, capPerPlayerMonth: '5000', refundDays: '14', referrals: { rate: '0.1', windowDays: '30', capPerPlayer: '1000', holdDays: '30', minimumInvoice: '2500' } });
  assert.equal(written.ok, true);
  assert.equal(written.shop.capPerPlayerMonth, 5000);
  assert.equal(written.shop.refundDays, 14);
  assert.equal(written.shop.referrals.capPerPlayer, 1000);
  const large = { ...SUPPORTER, id: 'a'.repeat(500), name: 'A'.repeat(500), blurb: 'B'.repeat(1000), badge: 'C'.repeat(100), price: 1000000, days: 20000, gives: Array.from({ length: 20 }, (_, i) => `key:${i}:${'x'.repeat(100)}`) };
  const big = checkShop({ items: Array.from({ length: 100 }, (_, i) => ({ ...large, id: large.id + i })) });
  assert.equal(big.ok, true, JSON.stringify(big.errors));
  assert.equal(big.shop.items.length, 100);
  assert.equal(big.shop.items[0].name.length, 500);
  assert.equal(big.shop.items[0].blurb.length, 1000);
  assert.equal(big.shop.items[0].gives.length, 20);
  assert.equal(checkShop({ items: [{ ...SUPPORTER, days: 0.5 }] }).shop.items[0].days, 0.5);
  assert.equal(checkShop({ items: [{ ...SUPPORTER, days: 100000000 }] }).ok, false, 'JavaScript cannot represent the expiry timestamp');
  assert.equal(checkShop({ items: [{ id: 'service', kind: 'service', name: 'A service', price: 100000 }] }).ok, true);
  assert.equal(checkShop({ items: [{ ...SUPPORTER, kind: 'subscription' }] }).ok, true);
  const tip = checkShop({ items: [{ id: 'tip', name: 'A tip', kind: 'tip', min: 50 }] });
  assert.equal(tip.ok, true);
  assert.equal(tip.shop.items[0].max, null);
  assert.equal(checkShop({ items: [{ id: 'tip', name: 'A tip', kind: 'tip', min: 50, max: 10000000 }] }).ok, true);
  for (const it of [{ ...SUPPORTER, name: 'Mystery Box' }, { ...SUPPORTER, odds: 1 }, { ...SUPPORTER, countdown: 1 }, { ...SUPPORTER, gives: ['coins:500'] }, { ...SUPPORTER, advantage: true }]) {
    assert.equal(checkShop({ items: [it] }).ok, true, JSON.stringify(it));
    assert.equal(checkShop({ policy: { preset: 'custom' }, items: [it] }).ok, true, JSON.stringify(it));
  }
  assert.equal(checkShop(raw, { audience: 'kids' }).shop.open, true);
  assert.equal(checkShop({ ...raw, policy: { preset: 'protective', kidsStudio: true } }, { audience: 'kids' }).shop.open, true);
  assert.equal(checkShop({ ...raw, policy: { preset: 'typo' } }).ok, false);
  const referrals = { rate: 2, windowDays: 1000, capPerPlayer: 1000000, holdDays: 1000, minimumInvoice: 1000000, accept: ['bank-transfer'] };
  assert.deepEqual(checkShop({ ...raw, referrals }).shop.referrals, { ...referrals, basis: 'pre-tax' });
  assert.equal(checkShop({ ...raw, refundDays: 1000, referrals: { rate: 0.1, holdDays: 0 } }).ok, true);
  for (const currency of ['usd', 'jpy', 'krw', 'isk', 'ugx']) {
    assert.equal(checkShop({ currency, items: [{ ...SUPPORTER, price: 50000 }] }).ok, true, currency);
  }
  assert.equal(currencyScale('jpy'), 1);
  assert.equal(currencyScale('ugx'), 100);
  assert.match(money(500, 'jpy'), /500/);
  assert.equal(amountError(30, 'gbp'), null);
  assert.equal(amountError(0, 'usd'), null);
  assert.equal(parseAmount('0.29'), 29);
  assert.ok(Number.isNaN(parseAmount('1.001')));
  assert.ok(Number.isNaN(parseAmount('1.5', 1)));
  assert.equal(parseAmount('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(money(1045, 'huf').includes('10.45'), true);
  assert.equal(money(500, 'ugx').includes('500'), false);
  assert.equal(amountError(49, 'usd'), null);
  assert.match(checkShop({ items: [{ ...SUPPORTER, price: 49 }] }).warnings[0].message, /Stripe.*minimum/);
  assert.match(amountError(101, 'isk'), /divisible by 100/);
  for (const price of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(checkShop({ items: [{ ...SUPPORTER, price }] }).ok, false);
  assert.equal(wayFor(SUPPORTER, { player: { guest: false }, band: 'adult', spent: 10000000 }), 'checkout');
  assert.equal(wayFor(SUPPORTER, { player: { guest: false }, band: 'adult', cap: 0 }), 'cap');
  assert.equal(wayFor(SUPPORTER, { policy: POLICY_PRESETS.custom, owned: true }), 'checkout');
  assert.equal(wayFor(SUPPORTER, { policy: POLICY_PRESETS['adults-only'], player: { guest: false }, band: 'teen' }), 'no');
});

test('who may buy: the age band, a guest, under 13, 13-17, an adult, a kids or beginner server, the cap', () => {
  const protectiveWay = (item, options) => wayFor(item, { policy: POLICY_PRESETS.protective, ...options });
  const now = new Date('2026-10-02T00:00:00Z');
  assert.equal(bandOf(2020, now), 'child');
  assert.equal(bandOf(2013, now), 'child', 'born in 2013 may still be 12: a year alone never makes a child older');
  assert.equal(bandOf(2012, now), 'teen');
  assert.equal(bandOf(2008, now), 'teen');
  assert.equal(bandOf(2007, now), 'adult');
  assert.equal(bandOf(1890, now), 'adult');
  assert.equal(bandOf('soon', now), null);
  const it = { id: 'x', kind: 'cosmetic', price: 300, gives: ['skin:x'] };
  const adult = { id: 'pl_a', guest: false };
  assert.equal(protectiveWay(it, { open: false }), 'closed');
  assert.equal(protectiveWay(it, { kids: true, player: adult, band: 'adult' }), 'kids');
  assert.equal(protectiveWay({ ...it, advantage: true }, { beginner: true, player: adult, band: 'adult' }), 'beginner');
  assert.equal(protectiveWay(it, { player: null }), 'make-an-account');
  assert.equal(protectiveWay(it, { player: { id: 'pl_g', guest: true } }), 'make-an-account');
  assert.equal(protectiveWay(it, { player: adult, band: null }), 'age-question');
  assert.equal(protectiveWay(it, { player: adult, band: 'child' }), 'no');
  assert.equal(protectiveWay(it, { player: adult, band: 'teen' }), 'ask-a-parent');
  assert.equal(protectiveWay(it, { player: adult, band: 'adult' }), 'checkout');
  assert.equal(protectiveWay(it, { player: adult, band: 'adult', spent: 4900, cap: 5000 }), 'cap');
  assert.equal(protectiveWay(it, { player: adult, band: 'adult', owned: true }), 'owned');
  assert.equal(protectiveWay({ ...it, ends: '2020-01-01' }, { player: adult, band: 'adult' }), 'over');
});

/* ------------------------------------------------------------------ Stripe */

test('Stripe: the form encoding, test or live by the key, a loopback stand-in only, and the webhook signature', async () => {
  const f = formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'usd', product_data: { name: 'A b' } } }], automatic_tax: { enabled: true }, skip: null });
  assert.equal(f.get('line_items[0][price_data][product_data][name]'), 'A b');
  assert.equal(f.get('automatic_tax[enabled]'), 'true');
  assert.equal(f.has('skip'), false);
  assert.equal(modeOf('rk_live_x'), 'live');
  assert.equal(modeOf(TEST_KEY), 'test');
  assert.equal(apiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111' }), 'http://127.0.0.1:12111');
  assert.equal(apiBase({ STRIPE_API_BASE: 'https://evil.example' }), 'https://api.stripe.com', 'never anything but a loopback stand-in');
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const sig = await signPayload(payload, HOOK_SECRET, t);
  assert.equal((await verifyWebhook(payload, `t=${t},v1=${sig}`, HOOK_SECRET)).ok, true);
  assert.equal((await verifyWebhook(payload, `t=${t},v1=${'0'.repeat(64)},v1=${sig}`, HOOK_SECRET)).ok, true, 'a rolled secret: any v1 may match');
  assert.equal((await verifyWebhook(payload, `t=${t},v1=${'0'.repeat(64)}`, HOOK_SECRET)).why, 'bad-signature');
  assert.equal((await verifyWebhook(`${payload} `, `t=${t},v1=${sig}`, HOOK_SECRET)).why, 'bad-signature', 'the raw body, byte for byte');
  assert.equal((await verifyWebhook(payload, `t=${t - 600},v1=${await signPayload(payload, HOOK_SECRET, t - 600)}`, HOOK_SECRET)).why, 'too-old');
  assert.equal((await verifyWebhook(payload, 'nonsense', HOOK_SECRET)).why, 'no-signature');
  assert.equal((await verifyWebhook(payload, `t=${t},v1=${sig}`, 'not-a-secret')).why, 'no-secret');
});

/* ------------------------------------------------------------------ the Worker */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Shop Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', '0002_studio_stats.sql', '0004_players.sql', '0005_studio_office.sql', '0006_studio_servers.sql', SHOP_MIGRATION_FILE, SHOP_RESERVATIONS_FILE, SHOP_STATEMENTS_FILE, SHOP_LINES_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    runSync: () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { sql.exec('BEGIN'); try { const results = []; for (const s of list) results.push(s.runSync()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
}

function assetsOf(dir) {
  const dist = join(dir, 'site', 'dist');
  return {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
    },
  };
}

function namespace(Klass, envRef, waits) {
  const objs = new Map();
  return {
    objs,
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, setAlarm: async (at) => { store.set('__alarm', at); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
        objs.set(id, new Klass(ctx, envRef.env));
      }
      const o = objs.get(id);
      return { fetch: (req, init) => o.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

/**
 * A stand-in for Stripe's API at the HTTP boundary: it records each call (path, the form it was sent, the key's kind)
 * and answers with Stripe's documented object shapes. Nothing leaves this computer.
 */
async function fakeStripe() {
  const calls = [];
  // What the stand-in does on purpose (a test sets these): a missing catalog Product, a refund Stripe holds for
  // approval (an Agent key), a key without Webhook Endpoints, Managed Payments not on, the account's endpoints.
  const behave = { missingProduct: false, approval: false, webhookDenied: false, managedRefused: false, endpoints: [], made: [], updated: [], sessions: new Map(), refunds: new Map(), payments: new Map(), unreachable: false };
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      const form = new URLSearchParams(body);
      calls.push({ method: req.method, path: url.pathname, form, auth: String(req.headers.authorization ?? '').replace(/^Bearer (rk|sk)_(test|live)_.*/, '$1_$2'), version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] ?? null });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      n += 1;
      const denied = () => send(403, { error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint. Having the \'rak_webhook_write\' permission would allow this request to continue.' } });
      if (req.method === 'GET' && url.pathname.endsWith('/line_items')) return send(200, { data: behave.lineItems ?? [], has_more: false });
      if (req.method === 'GET' && url.pathname.startsWith('/v1/checkout/sessions/')) {
        if (behave.disconnect) return req.destroy();
        const answer = () => behave.error ? send(behave.error.status, { error: behave.error }) : behave.unreachable ? send(503, { error: { message: 'unreachable' } }) : send(200, behave.sessions.get(url.pathname.split('/').pop()) ?? {});
        return behave.delay ? setTimeout(answer, behave.delay).unref() : answer();
      }
      if (req.method === 'GET' && url.pathname === '/v1/webhook_endpoints') return behave.webhookDenied ? denied() : send(200, { object: 'list', data: behave.endpoints, has_more: false });
      if (req.method === 'POST' && url.pathname === '/v1/webhook_endpoints') {
        if (behave.webhookDenied) return denied();
        const made = { id: `we_test_${n}`, object: 'webhook_endpoint', url: form.get('url'), enabled_events: [...form].filter(([k]) => k.startsWith('enabled_events[')).map(([, v]) => v), api_version: form.get('api_version'), metadata: { homie: form.get('metadata[homie]') }, status: 'enabled', livemode: false, secret: `whsec_${'Q7'.repeat(16)}${n}` };
        behave.made.push(made);
        return send(200, made);
      }
      if (req.method === 'POST' && /^\/v1\/webhook_endpoints\/we_/.test(url.pathname)) { behave.updated.push({ id: url.pathname.split('/').pop(), disabled: form.get('disabled') }); return send(200, { id: url.pathname.split('/').pop(), object: 'webhook_endpoint', status: form.get('disabled') === 'true' ? 'disabled' : 'enabled' }); }
      if (req.method === 'POST' && /^\/v1\/checkout\/sessions\/cs_[\w]+\/expire$/.test(url.pathname)) {
        if (behave.unreachable) return send(503, { error: { message: 'unreachable' } });
        const session = behave.sessions.get(url.pathname.split('/')[4]);
        if (!session || session.status !== 'open' || session.payment_status === 'paid') return send(400, { error: { message: 'Session is not open' } });
        session.status = 'expired';
        return send(200, session);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/payment_intents/')) return send(200, behave.payments.get(url.pathname.split('/').pop()) ?? {});
      if (req.method === 'GET' && url.pathname === '/v1/disputes') return send(200, { data: behave.disputes ?? [], has_more: false });
      if (req.method === 'GET' && url.pathname === '/v1/refunds') return send(200, { data: [...behave.refunds.values()].filter((r) => r.payment_intent === url.searchParams.get('payment_intent')), has_more: false });
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions' && behave.missingProduct && form.get('line_items[0][price_data][product]')) {
        return send(400, { error: { type: 'invalid_request_error', code: 'resource_missing', param: 'line_items[0][price_data][product]', message: `No such product: '${form.get('line_items[0][price_data][product]')}'` } });
      }
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions' && behave.managedRefused && form.get('managed_payments[enabled]') === 'true') {
        return send(400, { error: { type: 'invalid_request_error', message: 'Managed Payments is not enabled on this account.' } });
      }
      if (req.method === 'POST' && url.pathname === '/v1/refunds' && behave.approval) return send(400, { error: { type: 'invalid_request_error', code: 'approval_required', message: 'This request requires approval.' } });
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions' && behave.createError) return send(502, { error: behave.createError });
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const id = `cs_test_${String(n).padStart(6, '0')}abc`;
        const session = { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, mode: 'payment', livemode: false, client_reference_id: form.get('client_reference_id'), metadata: Object.fromEntries([...form].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])), currency: form.get('line_items[0][price_data][currency]'), amount_subtotal: [...form].filter(([key]) => /^line_items\[\d+\]\[quantity\]$/.test(key)).reduce((sum, [key, quantity]) => sum + Number(quantity) * Number(form.get(key.replace('[quantity]', '[price_data][unit_amount]'))), 0), payment_status: 'unpaid', status: 'open' };
        behave.sessions.set(id, session);
        return send(200, session);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/refunds/')) { const refund = behave.refunds.get(url.pathname.split('/').pop()); if (refund && behave.existingRefundStatus) refund.status = behave.existingRefundStatus; return send(200, refund ?? { id: url.pathname.split('/').pop(), status: 'pending' }); }
      if (req.method === 'POST' && url.pathname === '/v1/refunds') {
        const payment = form.get('payment_intent');
        const remaining = (behave.payments.get(payment)?.amount ?? 500) - [...behave.refunds.values()].filter((r) => r.payment_intent === payment && !['failed', 'canceled'].includes(r.status)).reduce((n, r) => n + r.amount, 0);
        const refund = { id: `re_test_${n}`, object: 'refund', status: behave.refundStatus ?? 'succeeded', payment_intent: payment, amount: Number(form.get('amount') ?? remaining), metadata: Object.fromEntries([...form].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])) };
        behave.refunds.set(refund.id, refund);
        if (behave.onRefund) await behave.onRefund(refund);
        return send(200, refund);
      }
      if (req.method === 'GET' && url.pathname === '/v1/checkout/sessions') return send(200, { object: 'list', data: [], has_more: false });
      return send(404, { error: { type: 'invalid_request_error', message: 'No such route' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const handle = { calls, behave, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close(); } };
  open.push(handle);
  return handle;
}

let built = null;
async function site({ key = true, managed = false, catalog = null, settings = null } = {}) {
  if (!built) {
    const dir = studio('worker');
    assert.equal(run(['game', 'new', 'owl-run', '--from', 'gem-rush', '--name', 'Owl Run'], dir).status, 0);
    writeFileSync(join(dir, 'shop.json'), JSON.stringify({
      till: 'stripe', currency: 'usd', policy: { preset: 'protective' }, automaticTax: true, referralNewPlayersOnly: true, refundDays: 14, capPerPlayerMonth: 2000,
      items: [
        SUPPORTER,
        { id: 'ember', kind: 'cosmetic', game: 'owl-run', name: `Ember hull ${EVIL}`, price: 300, gives: ['skin:ember'] },
        { id: 'boost', kind: 'unlock', game: 'owl-run', name: 'Turbo wings', price: 400, gives: ['wings:turbo'], advantage: true },
        { id: 'tip', kind: 'tip', name: 'A coffee', price: 'choose', min: 200, max: 1000 },
      ],
      referrals: { rate: 0.1, windowDays: 30, capPerPlayer: 1000, holdDays: 30, minimumInvoice: 0 },
    }, null, 2));
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const variant = managed || catalog || settings;
  const mdir = join(scratch, `variant-dist-${managed ? 'managed' : 'stripe'}-${(catalog ?? []).join('-') || 'inline'}`);
  if (variant) {
    // The same build, with Managed Payments as the till and/or the catalog made in Stripe (games.json is what the
    // Worker reads).
    const cat = JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8'));
    if (settings) Object.assign(cat.shop, settings);
    if (managed) cat.shop.till = 'stripe-managed';
    if (catalog) cat.shop.catalog = catalog;
    mkdirSync(join(mdir, 'site', 'dist'), { recursive: true });
    writeFileSync(join(mdir, 'site', 'dist', 'games.json'), JSON.stringify(cat));
  }
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  resetShopLimits();
  resetReferrers();
  const stripe = await fakeStripe();
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const base = assetsOf(dir);
  const managedAssets = variant ? assetsOf(mdir) : null;
  const ASSETS = variant ? { fetch: async (req) => (new URL(req.url).pathname === '/games.json' ? managedAssets.fetch(req) : base.fetch(req)) } : base;
  const env = { ASSETS, DB, STUDIO_NAME: 'Shop Owls', STRIPE_API_BASE: stripe.base, ...(key ? { STRIPE_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: HOOK_SECRET } : {}) };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const fetchAt = async (host, path, init = {}) => {
    const r = await worker.fetch(new Request(`https://${host}${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  const fetchSite = (path, init) => fetchAt('owls.example', path, init);
  const mint = (kind, value) => DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(value), kind, Date.now() + 3600_000);
  const session = 'f'.repeat(64);
  mint('session', session);
  const officeKey = `hsk_${'0e'.repeat(24)}`;
  mint('office', officeKey);
  let pn = 0;
  const player = (days = 0, { guest = false, band = null } = {}) => {
    pn += 1;
    const id = `pl_${String(pn).padStart(22, 'p')}`;
    const token = `${String(pn).padStart(43, 't')}`;
    const at = Date.now() - days * DAY;
    DB.sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, ?, 0, ?, ?)').run(id, `Player ${pn}`, guest ? 1 : 0, at, Date.now());
    DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(sha(token), id, Date.now() + DAY);
    if (band) DB.sql.prepare('INSERT INTO player_age (player, band, asked_at) VALUES (?, ?, ?)').run(id, band, Date.now());
    return { id, cookie: `studio_player=${token}` };
  };
  const same = { origin: 'https://owls.example', 'content-type': 'application/json' };
  const as = (p) => ({ ...same, cookie: p.cookie });
  const post = (path, body, headers) => fetchSite(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const owner = { ...same, cookie: `studio_owner=${session}` };
  const key0 = { authorization: `Bearer ${officeKey}`, 'content-type': 'application/json' };
  /** Stripe's webhook, signed with the endpoint's (test) secret. */
  const hook = async (type, object, { id = `evt_${Math.random().toString(36).slice(2, 12)}`, livemode = false, secret = HOOK_SECRET, t = Math.floor(Date.now() / 1000), created = t, updateProvider = true } = {}) => {
    // Provider truth changes before delivery; duplicate deliveries do not add refunds.
    if (type.startsWith('checkout.session.') && object.payment_intent && secret === HOOK_SECRET && !livemode) {
      stripe.behave.payments.set(object.payment_intent, { ...stripe.behave.payments.get(object.payment_intent), amount: object.amount_total ?? object.amount_subtotal, metadata: object.metadata });
      const session = stripe.behave.sessions.get(object.id);
      if (session) Object.assign(session, object);
    }
    if (updateProvider && type.startsWith('refund.') && object.id) stripe.behave.refunds.set(object.id, { ...object });
    if (type === 'charge.refunded') {
      const total = [...stripe.behave.refunds.values()].filter((r) => r.payment_intent === object.payment_intent && !['failed', 'canceled'].includes(r.status)).reduce((n, r) => n + r.amount, 0);
      if (object.amount_refunded > total) stripe.behave.refunds.set('re_dashboard_' + id, { id: 're_dashboard_' + id, payment_intent: object.payment_intent, amount: object.amount_refunded - total, status: 'succeeded', metadata: {} });
    }
    const payload = JSON.stringify({ id, created, object: 'event', type, livemode, data: { object } });
    return fetchSite('/api/shop/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${await signPayload(payload, secret, t)}` }, body: payload });
  };
  /** Buy as an adult and have Stripe say it is paid: the order, its session and its payment. */
  const buyPaid = async (p, item = 'supporter', extra = {}) => {
    const r = await post('/api/shop/buy', { item, ...extra }, as(p));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    const call = stripe.calls.filter((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST').pop();
    if (j.url.includes('cs_free_')) {
      const row = DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(j.order);
      return { order: j.order, session: row.session, payment: null, hook: { did: 'paid' }, call: null };
    }
    const sid = /\/pay\/(cs_test_\w+)/.exec(j.url)[1];
    const pi = `pi_test_${sid.slice(8, 20)}`;
    const amount = Number(call.form.get('line_items[0][price_data][unit_amount]'));
    const h = await hook('checkout.session.completed', { id: sid, object: 'checkout.session', payment_status: 'paid', payment_intent: pi, client_reference_id: p.id, metadata: { order: j.order, item }, currency: call.form.get('line_items[0][price_data][currency]'), amount_subtotal: amount, amount_total: amount + (amount ? 40 : 0), total_details: { amount_tax: amount ? 40 : 0 } });
    assert.equal(h.status, 200);
    return { order: j.order, session: sid, payment: pi, hook: await h.json(), call };
  };
  return { env, DB, worker, fetchSite, fetchAt, post, player, as, owner, key0, hook, buyPaid, stripe, dir, waits, same };
}

test('closed until the key and the webhook secret are in; a Preview and a missing migration say so', async () => {
  const s = await site({ key: false });
  const j = await (await s.fetchSite('/api/shop?game=owl-run')).json();
  assert.equal(j.open, false);
  assert.deepEqual(j.missing, ['stripe-key', 'webhook-secret']);
  const p = s.player(400, { band: 'adult' });
  const r = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p));
  assert.equal(r.status, 503);
  assert.equal(s.stripe.calls.length, 0, 'nothing reaches Stripe while the shop is closed');
  // The studio chooses its Stripe key type.
  s.env.STRIPE_KEY = `sk_live_${'x'.repeat(30)}`;
  s.env.STRIPE_WEBHOOK_SECRET = HOOK_SECRET;
  assert.deepEqual((await (await s.fetchSite('/api/shop')).json()).missing, undefined);
  s.stripe.close();
});

test('an adult buys: one order, Stripe\'s own Checkout (Stripe Tax on), the signed webhook grants it, once', async () => {
  const s = await site();
  const guest = await (await s.fetchSite('/api/shop?game=owl-run')).json();
  assert.equal(guest.open, true);
  assert.equal(guest.items.find((i) => i.id === 'supporter').way, 'make-an-account');
  const p = s.player(400);
  let list = await (await s.fetchSite('/api/shop?game=owl-run', { headers: { cookie: p.cookie } })).json();
  assert.equal(list.items.find((i) => i.id === 'supporter').way, 'age-question', 'spending is off until the age question says adult');
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, 403);
  assert.equal((await s.post('/api/shop/age', { year: 1990 }, s.as(p))).status, 200);
  const again = await (await s.post('/api/shop/age', { year: 2018 }, s.as(p))).json();
  assert.equal(again.asked, true);
  assert.equal(s.DB.sql.prepare('SELECT band FROM player_age WHERE player = ?').get(p.id).band, 'adult', 'asked once: a second answer changes nothing');
  list = await (await s.fetchSite('/api/shop?game=owl-run', { headers: { cookie: p.cookie } })).json();
  assert.equal(list.items.find((i) => i.id === 'supporter').way, 'checkout');
  assert.match(list.items.find((i) => i.id === 'ember').name, /<img src=x/, 'the API gives the name as data; pages escape it');
  // Another site cannot make a player buy.
  assert.equal((await s.fetchSite('/api/shop/buy', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie: p.cookie }, body: '{"item":"supporter"}' })).status, 403);
  const b = await s.buyPaid(p);
  const f = b.call.form;
  assert.equal(f.get('mode'), 'payment');
  assert.equal(f.get('automatic_tax[enabled]'), 'true', 'Stripe Tax on by default');
  assert.equal(f.get('adaptive_pricing[enabled]'), 'false');
  assert.equal(f.has('managed_payments[enabled]'), false);
  assert.equal(f.get('client_reference_id'), p.id);
  assert.equal(f.get('metadata[order]'), b.order);
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '500');
  assert.equal(f.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(f.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.match(f.get('custom_text[submit][message]'), /withdrawal right/);
  assert.match(f.get('success_url'), /\/shop\/thanks\?session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.equal(b.call.auth, 'rk_test', 'the studio\'s own restricted key');
  assert.equal(b.call.version, '2025-03-31.basil');
  assert.equal(b.call.idem, `checkout-${b.order}`, 'a retried call opens one checkout');
  assert.equal(b.hook.did, 'paid');
  const order = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(b.order);
  assert.equal(order.status, 'paid');
  assert.equal(order.tax, 40);
  assert.equal(order.payment, b.payment);
  for (const col of Object.keys(order)) assert.doesNotMatch(String(order[col] ?? ''), /@/, 'no email in an order');
  const owns = await (await s.fetchSite('/api/player/owns?game=owl-run', { headers: { cookie: p.cookie } })).json();
  assert.deepEqual(owns.owns.sort(), ['badge:supporter', 'credits-name']);
  // The same event again does nothing; an unsigned or wrongly signed one is refused; a live event on a test shop is ignored.
  const evt = 'evt_same_one';
  const obj = { id: b.session, payment_status: 'paid', payment_intent: b.payment, client_reference_id: p.id, metadata: { order: b.order }, currency: 'usd', amount_subtotal: 500 };
  assert.equal((await (await s.hook('checkout.session.completed', obj, { id: evt })).json()).did, 'already');
  assert.equal((await (await s.hook('checkout.session.completed', obj, { id: evt })).json()).duplicate, true);
  assert.equal((await s.hook('checkout.session.completed', obj, { secret: `whsec_${'wrong'.repeat(5)}` })).status, 400);
  assert.equal((await s.fetchSite('/api/shop/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: obj } }) })).status, 400);
  assert.equal((await (await s.hook('checkout.session.completed', obj, { livemode: true })).json()).ignored, 'mode');
  // A session that does not match its order (another player, another price) grants nothing.
  const p2 = s.player(400, { band: 'adult' });
  const r2 = await (await s.post('/api/shop/buy', { item: 'ember', game: 'owl-run' }, s.as(p2))).json();
  const sid2 = /\/pay\/(cs_test_\w+)/.exec(r2.url)[1];
  assert.equal((await (await s.hook('checkout.session.completed', { id: sid2, payment_status: 'paid', payment_intent: 'pi_x', client_reference_id: p.id, metadata: { order: r2.order }, currency: 'usd', amount_subtotal: 300 })).json()).did, 'mismatch');
  assert.equal((await (await s.hook('checkout.session.completed', { id: sid2, payment_status: 'paid', payment_intent: 'pi_x', client_reference_id: p2.id, metadata: { order: r2.order }, currency: 'usd', amount_subtotal: 1 })).json()).did, 'mismatch');
  // Owned now: no second checkout.
  assert.equal((await (await s.fetchSite('/api/shop', { headers: { cookie: p.cookie } })).json()).items.find((i) => i.id === 'supporter').way, 'owned');
  // The thanks page's question: only the buyer's own account learns the state.
  assert.equal((await (await s.fetchSite(`/api/shop/order?session=${b.session}`, { headers: { cookie: p.cookie } })).json()).status, 'paid');
  assert.equal((await (await s.fetchSite(`/api/shop/order?session=${b.session}`, { headers: { cookie: p2.cookie } })).json()).status, null);
  // The badge in a room: the Worker's word only; a kids server gets none.
  const { roomBadge } = await import('../worker/shop.mjs');
  const cat = JSON.parse(readFileSync(join(s.dir, 'site', 'dist', 'games.json'), 'utf8'));
  assert.equal(await roomBadge(s.env, cat, p.id), 'Supporter');
  assert.equal(await roomBadge(s.env, cat, p.id, { kids: true }), null);
  assert.equal(await roomBadge(s.env, cat, p2.id), null);
  const { NetRoom } = await import('../worker/room.mjs');
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 4 });
  const sent = [];
  const conn = { ip: '203.0.113.9', browser: 'b'.repeat(22), player: p.id, badge: 'Supporter', send: (t) => sent.push(JSON.parse(t)), close() {} };
  room.attach(conn).onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'phone', want: 'play', canHost: true, name: 'Owl', badge: 'Fake' }));
  const peers = sent.find((m) => Array.isArray(m.peers))?.peers ?? room.peers();
  assert.equal(peers.find((x) => x.name === 'Owl' || x.seat === 0)?.badge, 'Supporter', 'the badge rides on the seat');
  const liar = { ip: '203.0.113.10', browser: 'c'.repeat(22), player: p2.id, send: () => {}, close() {} };
  room.attach(liar).onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'phone', want: 'play', canHost: true, name: 'Liar', badge: 'Supporter' }));
  assert.equal(room.peers().find((x) => x.name === 'Liar')?.badge, undefined, 'a hello never sets a badge');
  s.stripe.close();
});

test('protective policy: no shop on a kids server, no advantages on beginner servers, no purchases under 13', async () => {
  const s = await site();
  for (const b of [{ name: 'Little Ones', policy: 'beginner', kids: true }, { name: 'First Light', policy: 'beginner' }]) {
    const r = await s.fetchSite('/_studio/api/servers', { method: 'POST', headers: s.key0, body: JSON.stringify({ game: 'owl-run', ...b }) });
    assert.equal(r.status, 200, await r.text());
  }
  const adult = s.player(400, { band: 'adult' });
  const kidsList = await (await s.fetchSite('/api/shop?game=owl-run&server=little-ones', { headers: { cookie: adult.cookie } })).json();
  assert.equal(kidsList.kids, true);
  assert.deepEqual(kidsList.items, []);
  const refused = await s.post('/api/shop/buy', { item: 'supporter', game: 'owl-run', server: 'little-ones' }, s.as(adult));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'kids');
  const beginner = await (await s.fetchSite('/api/shop?game=owl-run&server=first-light', { headers: { cookie: adult.cookie } })).json();
  assert.equal(beginner.items.some((i) => i.id === 'boost'), false, 'an item with a play advantage is not offered on a beginner server');
  assert.equal((await s.post('/api/shop/buy', { item: 'boost', game: 'owl-run', server: 'first-light' }, s.as(adult))).status, 403);
  await s.buyPaid(adult, 'boost', { game: 'owl-run' });
  const there = await (await s.fetchSite('/api/player/owns?game=owl-run&server=first-light', { headers: { cookie: adult.cookie } })).json();
  assert.equal(there.owns.includes('wings:turbo'), false, 'an advantage the player owns does not count on a beginner server');
  const pub = await (await s.fetchSite('/api/player/owns?game=owl-run&server=public', { headers: { cookie: adult.cookie } })).json();
  assert.equal(pub.owns.includes('wings:turbo'), true);
  // Under 13: nothing, ever, anywhere.
  const kid = s.player(400);
  await s.post('/api/shop/age', { year: new Date().getUTCFullYear() - 9 }, s.as(kid));
  const k = await (await s.fetchSite('/api/shop', { headers: { cookie: kid.cookie } })).json();
  assert.equal(k.open, false);
  assert.deepEqual(k.items, []);
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(kid))).status, 403);
  assert.equal((await s.post('/api/shop/parent', { item: 'supporter' }, s.as(kid))).status, 403, 'not even through a parent');
  // The play page: a kids server's room has no shop in its boot; the public one does; the television shows a code.
  const kidsPlay = await (await s.fetchSite('/owl-run/s/little-ones/play')).text();
  assert.doesNotMatch(kidsPlay, /"shop":\{/);
  const play = await (await s.fetchSite('/owl-run/play')).text();
  assert.match(play, /"shop":\{"items":4/);
  assert.match(play, /data-shop-open/);
  const tv = await (await s.fetchSite('/owl-run/tv')).text();
  assert.match(tv, /"screen":true/);
  assert.match(tv, /"qr":"\\u003csvg/, 'the television gets a code to buy on a phone');
  assert.match(tv, /Nothing is sold on this screen/);
  // The game's frame knows there is a shop (the shell answers it).
  const frame = await (await s.fetchSite('/owl-run/__game/?room=pub-1')).text();
  assert.match(frame, /"shop":true/);
  s.stripe.close();
});

test('13-17: a one-time link a parent opens on their own device and pays in their own name', async () => {
  const s = await site();
  const teen = s.player(400, { band: 'teen' });
  const list = await (await s.fetchSite('/api/shop', { headers: { cookie: teen.cookie } })).json();
  assert.equal(list.items.find((i) => i.id === 'supporter').way, 'ask-a-parent');
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(teen))).status, 403, 'a teen never checks out themselves');
  const link = await (await s.post('/api/shop/parent', { item: 'supporter' }, s.as(teen))).json();
  assert.equal(link.ok, true);
  const path = new URL(link.link).pathname;
  const page = await (await s.fetchSite(path)).text();
  assert.match(page, /asked you for Supporter/);
  assert.match(page, /\$5\.00/);
  assert.doesNotMatch(page, /<script>/, 'the parent\'s page needs no script of its own: one form');
  const form = (grownup) => s.fetchSite(path, { method: 'POST', headers: { origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: grownup ? 'grownup=yes' : '', redirect: 'manual' });
  assert.match(await (await form(false)).text(), /Tick the box/);
  const go = await form(true);
  assert.equal(go.status, 303);
  assert.match(go.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
  const call = s.stripe.calls.filter((c) => c.path === '/v1/checkout/sessions').pop();
  assert.equal(call.form.get('client_reference_id'), teen.id, 'it lands on the teen\'s account');
  assert.equal(call.form.get('metadata[parent]'), '1');
  const order = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE player = ? ORDER BY created_at DESC').get(teen.id);
  assert.equal(order.parent, 1);
  assert.equal((await s.fetchSite('/shop/parent/' + 'x'.repeat(43))).status, 410);
  s.stripe.close();
});

test('refunds: the owner\'s one tap; from an office key only an ASK the owner confirms; the player\'s own unused refund', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  const a = await s.buyPaid(p);
  // The owner's AI only asks.
  const asked = await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.key0, body: JSON.stringify({ order: a.order, note: 'bought twice' }) });
  assert.equal(asked.status, 202);
  const ask = (await asked.json()).ask;
  assert.match(ask.what, /Refund order ord_\w+ \(Supporter, \$5\.00\)/);
  assert.equal(s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST').length, 0, 'nothing refunded until the owner says yes');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'paid');
  // No key can confirm an ask; the owner's browser can, once.
  assert.equal((await s.fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { ...s.key0, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' })).status, 401);
  assert.equal(s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST').length, 0, 'the office key\'s own POST is the locked page');
  const confirm = await s.fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { cookie: s.owner.cookie, origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' });
  assert.match(await confirm.text(), /Done\./);
  const refund = s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST');
  assert.equal(refund.length, 1);
  assert.equal(refund[0].form.get('payment_intent'), a.payment);
  assert.equal(refund[0].idem, `refund-${a.order}`);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'refunded');
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: { cookie: p.cookie } })).json()).owns, [], 'the item left the account');
  // Stripe's own refund event afterwards changes nothing more.
  assert.equal((await (await s.hook('charge.refunded', { id: 'ch_1', payment_intent: a.payment, refunded: true, amount: 540, amount_refunded: 540 })).json()).did, 'already');
  // The owner's own browser refunds with one tap (no ask).
  const p2 = s.player(400, { band: 'adult' });
  const b = await s.buyPaid(p2);
  const tap = await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: b.order }) });
  assert.equal(tap.status, 200, await tap.clone().text());
  assert.equal((await tap.json()).ok, true);
  // The player's own refund: an unused item within the window; a used one is not theirs to refund.
  const p3 = s.player(400, { band: 'adult' });
  const c = await s.buyPaid(p3, 'ember', { game: 'owl-run' });
  const mine = await (await s.fetchSite('/api/shop/mine', { headers: { cookie: p3.cookie } })).json();
  assert.equal(mine.orders[0].refundable, true);
  assert.equal((await s.post('/api/shop/used', { key: 'skin:ember' }, s.as(p3))).status, 200);
  assert.equal((await s.post('/api/shop/refund', { order: c.order }, s.as(p3))).status, 403, 'used: ask the studio');
  const p4 = s.player(400, { band: 'adult' });
  const d = await s.buyPaid(p4, 'ember', { game: 'owl-run' });
  assert.equal((await s.post('/api/shop/refund', { order: d.order }, s.as(p3))).status, 404, 'another player\'s order');
  const own = await s.post('/api/shop/refund', { order: d.order }, s.as(p4));
  assert.equal(own.status, 200, await own.clone().text());
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(d.order).status, 'refunded');
  // A tip is a gift: inside the same window the player cannot take it back; the studio still can, from the office.
  const p5 = s.player(400, { band: 'adult' });
  const t = await s.buyPaid(p5, 'tip', { amount: 500 });
  const tips = await (await s.fetchSite('/api/shop/mine', { headers: { cookie: p5.cookie } })).json();
  assert.equal(tips.orders[0].refundable, false, 'a tip is not offered a refund');
  assert.equal((await s.post('/api/shop/refund', { order: t.order }, s.as(p5))).status, 403, 'a tip is not the player\'s to refund');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(t.order).status, 'paid');
  s.stripe.close();
});

test('a dispute never touches the account: nothing changes while open; lost takes that one item; won keeps it', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  const a = await s.buyPaid(p);
  const b = await s.buyPaid(p, 'ember', { game: 'owl-run' });
  assert.equal((await (await s.hook('charge.dispute.created', { id: 'dp_1', payment_intent: a.payment, status: 'needs_response' })).json()).did, 'disputed');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'disputed');
  let owns = (await (await s.fetchSite('/api/player/owns', { headers: { cookie: p.cookie } })).json()).owns;
  assert.ok(owns.includes('badge:supporter'), 'open: nothing changes');
  const refused = await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: a.order }) });
  assert.equal((await refused.json()).ok, false, 'Stripe cannot refund a disputed charge');
  assert.equal((await (await s.hook('charge.dispute.closed', { id: 'dp_1', payment_intent: a.payment, status: 'lost' })).json()).did, 'lost');
  owns = (await (await s.fetchSite('/api/player/owns', { headers: { cookie: p.cookie } })).json()).owns;
  assert.deepEqual(owns, ['skin:ember'], 'lost: only that one item goes');
  assert.ok(s.DB.sql.prepare('SELECT id FROM players WHERE id = ?').get(p.id), 'the account is still there');
  assert.equal((await s.fetchSite('/api/player/me', { headers: { cookie: p.cookie } }).then((r) => r.json())).player.id, p.id, 'and still signed in');
  await s.hook('charge.dispute.created', { id: 'dp_2', payment_intent: b.payment });
  assert.equal((await (await s.hook('charge.dispute.closed', { id: 'dp_2', payment_intent: b.payment, status: 'won' })).json()).did, 'kept');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(b.order).status, 'paid');
  s.stripe.close();
});

test('the monthly cap, a tip in range, deleting an account asks first and keeps the orders without the player, the export', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  await s.buyPaid(p, 'ember', { game: 'owl-run' });
  await s.buyPaid(p, 'boost', { game: 'owl-run' });
  await s.buyPaid(p, 'supporter');
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 50 }, s.as(p))).status, 400, 'a tip below its min');
  const capped = await s.post('/api/shop/buy', { item: 'tip', amount: 900 }, s.as(p));
  assert.equal(capped.status, 403, 'past the monthly cap (2000)');
  assert.equal((await capped.json()).way, 'cap');
  const exp = await (await s.fetchSite('/api/player/export', { headers: { cookie: p.cookie } })).json();
  assert.equal(exp.shop.orders.length, 3);
  assert.equal(exp.shop.ageBand, 'adult');
  const first = await s.post('/api/player/delete', { confirm: 'delete' }, s.as(p));
  assert.equal(first.status, 409, 'it owns things: say so first');
  assert.match((await first.json()).message, /gives them up/);
  assert.equal((await s.post('/api/player/delete', { confirm: 'delete', purchases: 'forfeit' }, s.as(p))).status, 200);
  const left = s.DB.sql.prepare('SELECT player, checkout_player FROM shop_orders WHERE status = ?').all('paid');
  assert.ok(left.length >= 3 && left.every((r) => r.player === null && r.checkout_player === null), 'the orders stay, without the player');
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE player = ?').get(p.id).n, 0);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM player_age WHERE player = ?').get(p.id).n, 0);
  s.stripe.close();
});

test('the office: what is missing, the last 30 days, links to the studio\'s own Stripe, a CSV with no names', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  await s.buyPaid(p);
  assert.equal((await s.fetchSite('/_studio/api/shop')).status, 401);
  const v = await (await s.fetchSite('/_studio/api/shop', { headers: s.key0 })).json();
  assert.equal(v.ready, true);
  assert.equal(v.mode, 'test');
  assert.equal(v.totals.sales, 1);
  assert.equal(v.totals.paid, 500);
  assert.match(v.stripe.payouts, /^https:\/\/dashboard\.stripe\.com\/test\/payouts$/);
  assert.match(v.orders[0].stripe, /^https:\/\/dashboard\.stripe\.com\/test\/payments\/pi_test_/);
  assert.equal(v.orders[0].player.name, 'Player 1');
  assert.equal(v.hook, 'https://owls.example/api/shop/hook');
  const csv = await (await s.fetchSite('/_studio/api/shop/orders.csv', { headers: s.key0 })).text();
  assert.match(csv, /^order,created,paid,refunded,status,item/);
  assert.match(csv, /,paid,supporter,,5\.00,0\.40,5\.40,usd,stripe,test,/);
  assert.doesNotMatch(csv, /Player 1/, 'no names for the accountant: Stripe has the buyer');
  const page = await s.fetchSite('/_studio/office/shop', { headers: { cookie: s.owner.cookie } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'sha256-/);
  assert.match(await page.text(), /You are the seller/);
  assert.equal((await s.fetchSite('/_studio/office/shop')).status, 401, 'anyone else: the locked page');
  assert.doesNotMatch(await (await s.fetchSite('/_studio/office/shop')).text(), /You are the seller/);
  // The studio's pages: the shop, the refund policy, nothing secret in the manifest.
  const shopPage = await (await s.fetchSite('/shop/?game=owl-run')).text();
  assert.match(shopPage, /TEST MODE/);
  assert.match(shopPage, /src="\/_homie\/shop\.js"/);
  assert.match(await (await s.fetchSite('/shop/refunds/')).text(), /never deletes or locks your account/);
  const man = await (await s.fetchSite('/.well-known/homie-studio.json')).json();
  assert.equal(man.shop.open, true);
  assert.equal(man.referrals.accepts, true);
  assert.equal(man.referrals.terms.rate, 0.1);
  assert.equal(man.referrals.key.crv, 'Ed25519');
  assert.equal(man.referrals.key.d, undefined, 'never the private half');
  assert.doesNotMatch(JSON.stringify(man), /rk_test|whsec_/);
  s.stripe.close();
});

test('managed payments: Stripe is the seller of record; a tax code, no automatic_tax, no adaptive pricing', async () => {
  const s = await site({ managed: true });
  const p = s.player(400, { band: 'adult' });
  const b = await s.buyPaid(p);
  const f = b.call.form;
  assert.equal(f.get('managed_payments[enabled]'), 'true');
  assert.equal(f.has('automatic_tax[enabled]'), false, 'Managed Payments computes the tax itself');
  assert.equal(f.has('adaptive_pricing[enabled]'), false);
  assert.equal(f.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_10201001', 'a year\'s supporter pack: limited rights');
  assert.equal(s.DB.sql.prepare('SELECT till FROM shop_orders WHERE id = ?').get(b.order).till, 'stripe-managed');
  s.stripe.close();
});

test('the catalog: a checkout names the item\'s Product, at shop.json\'s price; a Product missing in this mode sells inline', async () => {
  const s = await site({ catalog: ['test'] });
  const p = s.player(400, { band: 'adult' });
  const b = await s.buyPaid(p);
  const f = b.call.form;
  assert.equal(f.get('line_items[0][price_data][product]'), 'homie_shop_owls_supporter', 'the catalog Product, by the id the catalog made');
  assert.equal(f.has('line_items[0][price_data][product_data][name]'), false);
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '500', 'the price is shop.json\'s, never one read from Stripe');
  assert.equal(b.call.idem, `checkout-${b.order}`);
  // shop.json says the catalog is made in test mode, but Stripe has no such Product (archived by hand): it still sells.
  s.stripe.behave.missingProduct = true;
  const p2 = s.player(400, { band: 'adult' });
  const r = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p2));
  assert.equal(r.status, 200, await r.clone().text());
  const tries = s.stripe.calls.filter((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST').slice(-2);
  assert.equal(tries[0].form.get('line_items[0][price_data][product]'), 'homie_shop_owls_supporter');
  assert.equal(tries[1].form.get('line_items[0][price_data][product_data][name]'), 'Supporter', 'described inline the second time');
  assert.match(tries[1].idem, /^checkout-ord_\w+-inline$/, 'a new idempotency key for different parameters');
  s.stripe.close();
  // A catalog made only in live mode: a test key's checkout describes the item inline.
  const t = await site({ catalog: ['live'] });
  const q = t.player(400, { band: 'adult' });
  const c = await t.buyPaid(q);
  assert.equal(c.call.form.has('line_items[0][price_data][product]'), false);
  assert.equal(c.call.form.get('line_items[0][price_data][product_data][name]'), 'Supporter');
  t.stripe.close();
});

test('a refund Stripe holds for approval (an Agent key) is accepted, not refused; the webhook takes the item back later', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  const a = await s.buyPaid(p);
  s.stripe.behave.approval = true;
  const tap = await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: a.order }) });
  assert.equal(tap.status, 202);
  const j = await tap.json();
  assert.equal(j.held, true);
  assert.match(j.message, /Approvals/);
  assert.match(j.message, /plain restricted key/);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'paid', 'nothing changes until Stripe refunds');
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: { cookie: p.cookie } })).json()).owns.length > 0, true);
  // Someone approves it in Stripe; Stripe refunds and says so: the item leaves the account.
  assert.equal((await (await s.hook('refund.created', { id: 're_test_held', object: 'refund', status: 'succeeded', amount: 540, payment_intent: a.payment })).json()).did, 'refunded');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'refunded');
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: { cookie: p.cookie } })).json()).owns, []);
  // A player's own refund, held the same way: plain words for the player, not Stripe's settings.
  const p2 = s.player(400, { band: 'adult' });
  s.stripe.behave.approval = false;
  const d = await s.buyPaid(p2, 'ember', { game: 'owl-run' });
  s.stripe.behave.approval = true;
  const own = await s.post('/api/shop/refund', { order: d.order }, s.as(p2));
  assert.equal(own.status, 202);
  assert.match((await own.json()).message, /approves this refund in Stripe first/);
  s.stripe.close();
});

test('shop catalog: the read, then exactly the writes Stripe still needs; in sync, shop.json records the mode', () => {
  const dir = studio('catalog');
  const TIP = { id: 'tip', kind: 'tip', name: 'A coffee', price: 'choose', min: 200, max: 1000 };
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe-managed', currency: 'usd', items: [SUPPORTER, TIP] }, null, 2));
  let r = JSON.parse(run(['shop', 'catalog'], dir).stdout);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.step, 'read');
  assert.equal(r.read.tool, 'stripe_api_read');
  assert.equal(r.read.path, '/v1/products');
  assert.deepEqual(r.products.map((x) => x.id), ['homie_shop_owls_supporter', 'homie_shop_owls_tip']);
  // An account with someone else's product only.
  const other = { id: 'prod_TheirOwn', object: 'product', name: 'Not ours', active: true, livemode: false, metadata: {} };
  const have = join(dir, 'have.json');
  writeFileSync(have, JSON.stringify({ object: 'list', data: [other], has_more: false }));
  r = JSON.parse(run(['shop', 'catalog', '--have', have], dir).stdout);
  assert.equal(r.inSync, false);
  assert.equal(r.writes.length, 2);
  const [sup, tip] = r.writes;
  assert.deepEqual([sup.tool, sup.method, sup.path], ['stripe_api_write', 'POST', '/v1/products']);
  assert.equal(sup.params.id, 'homie_shop_owls_supporter');
  assert.equal(sup.params.tax_code, 'txcd_10201001', 'a year\'s pack: video games, limited rights (eligible for Managed Payments)');
  assert.deepEqual(sup.params.default_price_data, { currency: 'usd', unit_amount: 500, tax_behavior: 'exclusive' });
  assert.deepEqual(sup.params.metadata, { homie: 'shop-v1', homie_studio: 'shop-owls', homie_item: 'supporter' });
  assert.equal(tip.params.id, 'homie_shop_owls_tip');
  assert.equal(tip.params.default_price_data, undefined, 'a tip has no fixed price');
  assert.doesNotMatch(JSON.stringify(r.writes), /prod_TheirOwn/, 'never a product this studio did not make');
  // What Stripe holds after those writes, as Stripe's MCP answers it: in sync, and shop.json records the mode.
  const product = (w, extra = {}) => ({ id: w.params.id, object: 'product', name: w.params.name, description: w.params.description ?? null, active: true, livemode: false, tax_code: w.params.tax_code, metadata: w.params.metadata, default_price: w.params.default_price_data ? { id: 'price_1Test', object: 'price', active: true, currency: 'usd', unit_amount: w.params.default_price_data.unit_amount, tax_behavior: 'exclusive' } : null, ...extra });
  writeFileSync(have, JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ object: 'list', data: [product(sup), product(tip), other] }) }] }));
  r = JSON.parse(run(['shop', 'catalog', '--have', have], dir).stdout);
  assert.equal(r.inSync, true, JSON.stringify(r.writes));
  assert.equal(r.mode, 'test');
  assert.match(r.recorded, /"catalog" now includes "test"/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8')).catalog, ['test']);
  assert.equal(JSON.parse(run(['shop', 'check'], dir).stdout).ok, true, 'shop check takes the catalog field');
  // A new price and a removed item: a new Price made the default, and the tip archived (never deleted).
  const shop = JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8'));
  shop.items = [{ ...SUPPORTER, price: 700 }];
  writeFileSync(join(dir, 'shop.json'), JSON.stringify(shop));
  const piped = spawnSync(process.execPath, [CLI, 'shop', 'catalog', '--have', '-', '--json'], { cwd: dir, encoding: 'utf8', input: readFileSync(have, 'utf8'), env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
  r = JSON.parse(piped.stdout);
  assert.deepEqual(r.writes.map((w) => `${w.method} ${w.path}`), ['POST /v1/prices', 'POST /v1/products/homie_shop_owls_supporter', 'POST /v1/products/homie_shop_owls_tip']);
  assert.equal(r.writes[0].params.unit_amount, 700);
  assert.equal(r.writes[0].params.lookup_key, 'homie_shop_owls_supporter_usd');
  assert.equal(r.writes[0].params.transfer_lookup_key, true);
  assert.deepEqual(r.writes[2].params, { active: false });
  // Test and live in one answer: one environment at a time.
  writeFileSync(have, JSON.stringify([product(sup), product(tip, { livemode: true })]));
  assert.match(JSON.parse(run(['shop', 'catalog', '--have', have], dir).stdout).why, /one environment at a time/);
  // A catalog field the rules do not know is refused.
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ ...shop, catalog: ['prod'] }));
  assert.match(JSON.stringify(JSON.parse(run(['shop', 'check'], dir).stdout).errors), /catalog/);
});

test('referrals: an arrival from another site, a new player\'s sale, a held line, a signed statement the referrer checks', async () => {
  const s = await site();
  const realFetch = globalThis.fetch;
  // The referrer's and the seller's own manifests, as each site answers them (the referrer is another studio).
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.host === 'friends.example' && u.pathname === '/.well-known/homie-studio.json') return Response.json({ v: 1, kind: 'homie-studio', referrals: { accepts: true, statements: 'https://friends.example/api/referrals/statement' } });
    if (u.host === 'owls.example') return s.fetchAt('owls.example', u.pathname + u.search, init);
    if (u.host === 'friends.example' && u.pathname === '/api/referrals/statement') return s.fetchAt('friends.example', u.pathname, init);
    return realFetch(input, init);
  };
  try {
    const nav = { 'sec-fetch-dest': 'document', accept: 'text/html' };
    // A prefetch is never an arrival; a person's page load is.
    let r = await s.fetchSite('/?via=friends.example', { headers: { ...nav, 'sec-purpose': 'prefetch' } });
    assert.equal(r.headers.get('set-cookie'), null);
    r = await s.fetchSite('/?via=owls.example', { headers: nav });
    assert.equal(r.headers.get('set-cookie'), null, 'a site is never its own referrer');
    r = await s.fetchSite('/owl-run/s/x/?via=friends.example', { headers: nav });
    assert.equal(r.headers.get('set-cookie'), null, 'never on a server\'s page');
    r = await s.fetchSite('/?via=friends.example', { headers: nav });
    const cookie = /studio_via=[^;]+/.exec(r.headers.get('set-cookie') ?? '')?.[0];
    assert.ok(cookie, 'an arrival: a signed cookie');
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await s.fetchSite('/?via=friends.example', { headers: { ...nav, cookie: 'studio_player=x' } })).headers.get('set-cookie'), null, 'a browser that has a player here is not new');
    // A player made after the arrival buys: a held line for the referrer.
    const p = s.player(0, { band: 'adult' });
    p.cookie = `${p.cookie}; ${cookie}`;
    const b = await s.buyPaid(p);
    assert.equal(b.call.form.get('metadata[via]'), 'friends.example');
    const line = s.DB.sql.prepare('SELECT * FROM referral_lines WHERE order_id = ?').get(b.order);
    assert.equal(line.via, 'friends.example');
    assert.equal(line.share, 50, '10% of the pre-tax price');
    assert.equal(line.state, 'pending');
    // A forged cookie, or an older player, brings nobody.
    const old = s.player(400, { band: 'adult' });
    old.cookie = `${old.cookie}; ${cookie}`;
    const o = await s.buyPaid(old);
    assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM referral_lines WHERE order_id = ?').get(o.order).n, 0, 'an account older than the arrival');
    const forged = s.player(0, { band: 'adult' });
    forged.cookie = `${forged.cookie}; studio_via=friends.example.${Math.floor(Date.now() / 1000)}.${'A'.repeat(22)}`;
    const fo = await s.buyPaid(forged);
    assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM referral_lines WHERE order_id = ?').get(fo.order).n, 0, 'a forged arrival');
    // The hold passes: owed. A signed statement; the referrer checks it against the seller's manifest.
    s.DB.sql.prepare('UPDATE referral_lines SET hold_until = ? WHERE order_id = ?').run(Date.now() - 1000, b.order);
    const period = new Date().toISOString().slice(0, 7);
    const st = await (await s.fetchSite(`/_studio/api/shop/statements?period=${period}`, { headers: s.key0 })).json();
    assert.equal(st.statements.length, 1);
    const env0 = st.statements[0];
    assert.equal(env0.statement.referrer, 'friends.example');
    assert.equal(env0.statement.totals.due, 50);
    assert.doesNotMatch(JSON.stringify(env0), /pl_|Player|ord_/, 'no player, name or order id: order hashes only');
    const man = await (await s.fetchSite('/.well-known/homie-studio.json')).json();
    assert.equal(await verifyStatement(env0, man.referrals.key.x), true);
    assert.equal(await verifyStatement({ ...env0, statement: { ...env0.statement, totals: { ...env0.statement.totals, due: 5000 } } }, man.referrals.key.x), false, 'a changed statement fails');
    assert.ok(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}');
    const sent = await (await s.fetchSite('/_studio/api/shop/statements/send', { method: 'POST', headers: s.key0, body: JSON.stringify({ period }) })).json();
    assert.equal(sent.sent[0].ok, true, JSON.stringify(sent));
    // The referrer kept it (the same Worker, answering as friends.example: its own D1 here).
    const got = s.DB.sql.prepare('SELECT * FROM referral_statements').get();
    assert.equal(got.seller, 'https://owls.example');
    assert.equal(got.owed, 50);
    // A statement signed by anyone else, or naming another referrer, is refused.
    const bad = await s.fetchAt('friends.example', '/api/referrals/statement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...env0, sig: env0.sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }) });
    assert.equal(bad.status, 401);
    assert.equal((await s.fetchAt('elsewhere.example', '/api/referrals/statement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(env0) })).status, 400);
    // A refund after the hold: a settled line becomes a clawback. Marking paid is an ask from an office key.
    const settle = await s.fetchSite('/_studio/api/shop/settle', { method: 'POST', headers: s.key0, body: JSON.stringify({ via: 'friends.example', currency: 'usd', ref: 'INV-1' }) });
    assert.equal(settle.status, 202);
    const done = await s.fetchSite('/_studio/api/shop/settle', { method: 'POST', headers: s.owner, body: JSON.stringify({ via: 'friends.example', currency: 'usd', ref: 'INV-1' }) });
    assert.equal((await done.json()).ok, true);
    assert.equal(s.DB.sql.prepare('SELECT state FROM referral_lines WHERE order_id = ?').get(b.order).state, 'settled');
    await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: b.order }) });
    assert.equal(s.DB.sql.prepare('SELECT state FROM referral_lines WHERE order_id = ?').get(b.order + '_refund_0').state, 'clawback');
  } finally { globalThis.fetch = realFetch; s.stripe.close(); }
});

/* ------------------------------------------------------------------ stripe-mock */

const MOCK = process.env.STRIPE_MOCK_URL;
test('stripe-mock: Stripe\'s own API description accepts both tills\' Checkout Sessions and a refund', { skip: MOCK ? false : 'STRIPE_MOCK_URL is not set (CI starts stripe-mock; locally: stripe-mock -http-port 12111)' }, async () => {
  for (const managed of [false, true]) {
    const s = await site({ managed });
    s.env.STRIPE_API_BASE = MOCK;
    const p = s.player(400, { band: 'adult' });
    const r = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p));
    const j = await r.json();
    assert.equal(r.status, 200, `stripe-mock refused the ${managed ? 'Managed Payments' : 'Stripe Tax'} session: ${JSON.stringify(j)}`);
    assert.match(j.url, /^https:\/\/checkout\.stripe\.com\//);
    const tip = await s.post('/api/shop/buy', { item: 'tip', amount: 400 }, s.as(p));
    assert.equal(tip.status, 200, JSON.stringify(await tip.clone().json()));
    // Paid (the webhook), then the owner's refund through stripe-mock.
    const order = s.DB.sql.prepare("SELECT * FROM shop_orders WHERE id = ?").get(j.order);
    await s.hook('checkout.session.completed', { id: order.session, payment_status: 'paid', payment_intent: 'pi_test_mock', client_reference_id: p.id, metadata: { order: j.order }, currency: 'usd', amount_subtotal: 500 });
    const refund = await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: j.order }) });
    assert.equal((await refund.json()).ok, true);
    s.stripe.close();
  }
});

test('stripe-mock: the catalog\'s writes, a checkout that names its Product, and the webhook the connect page makes', { skip: MOCK ? false : 'STRIPE_MOCK_URL is not set (CI starts stripe-mock; locally: stripe-mock -http-port 12111)' }, async () => {
  const { stripeCall, createWebhookEndpoint, updateWebhookEndpoint } = await import('../worker/stripe.mjs');
  const { HOOK_EVENTS } = await import('../lib/shop.mjs');
  const env = { STRIPE_KEY: TEST_KEY, STRIPE_API_BASE: MOCK };
  // The writes `shop catalog --have` lists for an empty account, then a price change, as the owner's AI sends them.
  const dir = studio('catalog-mock');
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe-managed', currency: 'usd', items: [SUPPORTER, { id: 'tip', kind: 'tip', name: 'A coffee', price: 'choose', min: 200, max: 1000 }] }));
  const have = join(dir, 'have.json');
  writeFileSync(have, JSON.stringify({ object: 'list', data: [] }));
  const plan = JSON.parse(run(['shop', 'catalog', '--have', have], dir).stdout);
  for (const w of plan.writes) await stripeCall(env, w.method, w.path, w.params);
  const sj = JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8'));
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ ...sj, items: [{ ...SUPPORTER, price: 700 }] }));
  writeFileSync(have, JSON.stringify({ object: 'list', data: [{ id: 'homie_shop_owls_supporter', object: 'product', name: 'Supporter', active: true, livemode: false, tax_code: 'txcd_10201001', metadata: { homie: 'shop-v1', homie_studio: 'shop-owls', homie_item: 'supporter' }, default_price: { id: 'price_x', object: 'price', active: true, currency: 'usd', unit_amount: 500 } }] }));
  const change = JSON.parse(run(['shop', 'catalog', '--have', have], dir).stdout);
  // The blurb (missing on Stripe's copy) first, then the new Price, then that Price made the default: in order.
  assert.deepEqual(change.writes.map((w) => w.path), ['/v1/products/homie_shop_owls_supporter', '/v1/prices', '/v1/products/homie_shop_owls_supporter']);
  await stripeCall(env, change.writes[0].method, change.writes[0].path, change.writes[0].params);
  const price = await stripeCall(env, change.writes[1].method, change.writes[1].path, change.writes[1].params);
  await stripeCall(env, 'POST', change.writes[2].path, { default_price: price.id });
  // The webhook, as the connect page makes it, and an older one turned off.
  const made = await createWebhookEndpoint(env, { url: 'https://owls.example/api/shop/hook', enabled_events: [...HOOK_EVENTS], api_version: '2025-03-31.basil', description: 'Homie shop', metadata: { homie: 'shop-v1' } });
  assert.match(String(made.id), /^we_/);
  await updateWebhookEndpoint(env, made.id, { disabled: true });
  // A checkout naming the catalog's Product, both tills.
  for (const managed of [false, true]) {
    const s = await site({ managed, catalog: ['test'] });
    s.env.STRIPE_API_BASE = MOCK;
    const p = s.player(400, { band: 'adult' });
    const r = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p));
    assert.equal(r.status, 200, `stripe-mock refused a checkout that names its Product: ${await r.clone().text()}`);
    s.stripe.close();
  }
});

/* ------------------------------------------------------------------ the CLI */

test('the CLI: init is open; arbitrary wording builds; invalid money stops the build; kids studios can sell', () => {
  const dir = studio('cli');
  let r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.absent, true);
  r = JSON.parse(run(['shop', 'init', '--supporter'], dir).stdout);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.wrote, ['shop.json', 'SELLING.md']);
  const initialized = JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8'));
  assert.equal(initialized.policy, undefined);
  assert.equal(initialized.capPerPlayerMonth, undefined);
  assert.equal(initialized.refundDays, undefined);
  assert.match(readFileSync(join(dir, 'SELLING.md'), 'utf8'), /responsible for the law/);
  r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.ok, true);
  const shop = JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8'));
  shop.items.push({ id: 'crate', kind: 'cosmetic', name: 'Mystery crate', price: 300, gives: ['skin:random'] });
  writeFileSync(join(dir, 'shop.json'), JSON.stringify(shop));
  r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.ok, true, 'any wording is accepted');
  shop.items[0].price = 1.5;
  writeFileSync(join(dir, 'shop.json'), JSON.stringify(shop));
  const b = run(['build'], dir);
  assert.notEqual(b.status, 0);
  assert.match(b.stdout + b.stderr, /shop\.json conflicts with the studio settings/);
  const studioJson = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...studioJson, audience: 'kids' }));
  rmSync(join(dir, 'shop.json'));
  r = JSON.parse(run(['shop', 'init', '--supporter'], dir).stdout);
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(run(['shop', 'check'], dir).stdout).ok, true);
  assert.ok(existsSync(join(dir, 'site', 'migrations', SHOP_MIGRATION_FILE)), 'a new studio has the shop migration');
});

/** A studio for `shop connect`, live at owls.example, with a stand-in Wrangler that records each command and how long
 * the secret on its standard input was (never the secret). */
function connectStudio(name) {
  const dir = studio(name);
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
echo "$*" >> ${state}/calls
if [ "$1" = secret ]; then wc -c | tr -d ' ' >> ${state}/stdin-bytes; echo "Success! Uploaded secret $3"; fi
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  const sj = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...sj, cloudflare: { ...sj.cloudflare, domain: 'owls.example' } }, null, 2));
  return { dir, state };
}

async function openConnect(dir, opts = {}) {
  const { shopConnect } = await import('../lib/shop.mjs');
  const said = [];
  const done = shopConnect(dir, { manual: true, log: (line) => said.push(line), wait: 20_000, ...opts });
  for (let i = 0; i < 50 && !said.length; i += 1) await new Promise((r) => setTimeout(r, 50));
  const link = /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}/.exec(said.join(' '))?.[0];
  assert.ok(link, said.join(' '));
  const page = await (await fetch(link)).text();
  const n = /name="n" value="([a-f0-9]{32})"/.exec(page)[1];
  const origin = new URL(link).origin;
  const postKey = (body) => fetch(`${origin}/key`, { method: 'POST', body: new URLSearchParams({ n, ...body }) });
  return { done, said, page, n, postKey };
}

test('shop connect: the owner pastes the key on this computer; it goes to the Worker secret and is never printed', async () => {
  const { shopConnect } = await import('../lib/shop.mjs');
  const bare = studio('connect-undeployed');
  const none = await shopConnect(bare, { manual: true, wait: 1000 });
  assert.equal(none.needs, 'deploy', 'no live address yet: Stripe has nowhere to send payments');
  const { dir, state } = connectStudio('connect');
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe', items: [SUPPORTER] }));
  const said = [];
  const done = shopConnect(dir, { manual: true, log: (line) => said.push(line), wait: 20_000, verify: false });
  for (let i = 0; i < 50 && !said.length; i += 1) await new Promise((r) => setTimeout(r, 50));
  const link = /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}/.exec(said.join(' '))?.[0];
  assert.ok(link, said.join(' '));
  const page = await (await fetch(link)).text();
  assert.match(page, /type="password"/g);
  assert.match(page, /https:\/\/owls\.example\/api\/shop\/hook/);
  assert.match(page, /Webhook Endpoints<\/b>: Write/);
  assert.match(page, /not<\/b> "Authorizing agent access"/, 'the shop\'s key is a plain restricted key, never an Agent key');
  assert.match(page, /Checkout Sessions<\/b>: Write/);
  assert.match(page, /\/api\/shop\/hook/);
  assert.match(page, /3\.5% more/, 'Managed Payments offered, with what it costs');
  assert.match(page, /seller of record/);
  assert.match(page, /not to the chat, not to a file/);
  const n = /name="n" value="([a-f0-9]{32})"/.exec(page)[1];
  const origin = new URL(link).origin;
  const postKey = (body) => fetch(`${origin}/key`, { method: 'POST', body: new URLSearchParams(body) });
  assert.equal((await postKey({ n: 'f'.repeat(32), key: TEST_KEY, hook: HOOK_SECRET })).status, 403);
  assert.match(await (await postKey({ n, key: `sk_live_${'x'.repeat(30)}`, hook: HOOK_SECRET })).text(), /TEST mode/);
  assert.match(await (await postKey({ n, key: `rk_live_${'x'.repeat(30)}`, hook: HOOK_SECRET })).text(), /TEST mode/, 'a live key on the test page');
  assert.equal((await postKey({ n, key: TEST_KEY, hook: 'nope' })).status, 400);
  const ok = await postKey({ n, key: TEST_KEY, hook: HOOK_SECRET, till: 'stripe-managed' });
  assert.equal(ok.status, 200);
  const r = await done;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mode, 'test');
  const calls = readFileSync(join(state, 'calls'), 'utf8');
  assert.match(calls, /^secret put STRIPE_KEY$/m);
  assert.match(calls, /^secret put STRIPE_WEBHOOK_SECRET$/m);
  assert.deepEqual(readFileSync(join(state, 'stdin-bytes'), 'utf8').trim().split('\n').map(Number), [TEST_KEY.length + 1, HOOK_SECRET.length + 1], 'both on Wrangler\'s standard input');
  assert.doesNotMatch(JSON.stringify(r) + said.join(' ') + calls, /rk_test_A1b2|whsec_test/, 'never printed, returned or put in an argument');
  assert.equal(JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8')).till, 'stripe-managed', 'the seller the owner picked');
  assert.equal(r.webhook.made, false, 'the owner made the webhook and pasted its secret');
});

test('shop connect: with the key alone the page makes the webhook; its secret goes straight to the Worker, an older one is turned off', async () => {
  const { dir, state } = connectStudio('connect-auto');
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe', items: [SUPPORTER] }));
  const stripe = await fakeStripe();
  stripe.behave.endpoints = [
    { id: 'we_test_older', object: 'webhook_endpoint', url: 'https://owls.example/api/shop/hook', metadata: { homie: 'shop-v1' }, status: 'enabled' },
    { id: 'we_test_theirs', object: 'webhook_endpoint', url: 'https://owls.example/api/shop/hook', metadata: {}, status: 'enabled' },
  ];
  const before = process.env.STRIPE_API_BASE;
  process.env.STRIPE_API_BASE = stripe.base;
  try {
    const c = await openConnect(dir);
    const ok = await c.postKey({ key: TEST_KEY, till: 'stripe-managed' });
    const words = await ok.text();
    assert.equal(ok.status, 200, words);
    assert.match(words, /Stripe made the webhook/);
    assert.match(words, /Managed Payments: it is on/);
    assert.match(words, /Webhook Endpoints back to None/);
    const r = await c.done;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.webhook.made, true);
    assert.equal(r.webhook.id, stripe.behave.made[0].id);
    assert.equal(r.webhook.turnedOff, 1);
    assert.equal(r.managedPayments.ok, true);
    const made = stripe.behave.made[0];
    assert.equal(made.url, 'https://owls.example/api/shop/hook');
    assert.deepEqual(made.enabled_events, ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.closed']);
    assert.equal(made.api_version, '2025-03-31.basil', 'events rendered in the version the kit reads');
    assert.equal(made.metadata.homie, 'shop-v1');
    assert.deepEqual(stripe.behave.updated, [{ id: 'we_test_older', disabled: 'true' }], 'only the kit\'s own older endpoint, turned off, never deleted');
    assert.ok(!stripe.calls.some((c2) => c2.method === 'DELETE'));
    // Managed Payments tried once in test mode: a test checkout with it, expired at once.
    const probe = stripe.calls.find((c2) => c2.path === '/v1/checkout/sessions' && c2.method === 'POST');
    assert.equal(probe.form.get('managed_payments[enabled]'), 'true');
    assert.ok(stripe.calls.some((c2) => /\/expire$/.test(c2.path)));
    const calls = readFileSync(join(state, 'calls'), 'utf8');
    assert.match(calls, /^secret put STRIPE_KEY$/m);
    assert.match(calls, /^secret put STRIPE_WEBHOOK_SECRET$/m);
    assert.deepEqual(readFileSync(join(state, 'stdin-bytes'), 'utf8').trim().split('\n').map(Number), [TEST_KEY.length + 1, made.secret.length + 1], 'Stripe\'s secret went to Wrangler\'s standard input');
    assert.doesNotMatch(JSON.stringify(r) + c.said.join(' ') + calls + words, /Q7Q7|rk_test_A1b2/, 'the webhook\'s secret and the key are never printed or returned');
  } finally {
    if (before === undefined) delete process.env.STRIPE_API_BASE; else process.env.STRIPE_API_BASE = before;
    stripe.close();
  }
});

test('shop connect: a key without Webhook Endpoints says how to fix it; the page then takes the owner\'s own webhook secret', async () => {
  const { dir, state } = connectStudio('connect-denied');
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe', items: [SUPPORTER] }));
  const stripe = await fakeStripe();
  stripe.behave.webhookDenied = true;
  stripe.behave.managedRefused = true;
  const before = process.env.STRIPE_API_BASE;
  process.env.STRIPE_API_BASE = stripe.base;
  try {
    const c = await openConnect(dir);
    const no = await c.postKey({ key: TEST_KEY });
    assert.equal(no.status, 400);
    assert.match(await no.text(), /needs Webhook Endpoints: Write/);
    assert.equal(existsSync(join(state, 'calls')), false, 'nothing saved');
    const yes = await c.postKey({ key: TEST_KEY, hook: HOOK_SECRET, till: 'stripe-managed' });
    const words = await yes.text();
    assert.equal(yes.status, 200, words);
    assert.match(words, /refused a test checkout with Managed Payments/);
    const r = await c.done;
    assert.equal(r.webhook.made, false);
    assert.equal(r.managedPayments.ok, false);
    assert.deepEqual(readFileSync(join(state, 'stdin-bytes'), 'utf8').trim().split('\n').map(Number), [TEST_KEY.length + 1, HOOK_SECRET.length + 1]);
  } finally {
    if (before === undefined) delete process.env.STRIPE_API_BASE; else process.env.STRIPE_API_BASE = before;
    stripe.close();
  }
});

/* ------------------------------------------------------------------ in a game */

test('@homie-rocks/studio/shop in a game: has, entitlements, change, open, used; without a shell, an empty closed shop', async () => {
  const { build: esbuild } = await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'));
  const file = join(scratch, 'shop-client.mjs');
  await esbuild({ entryPoints: [join(PKG, 'shop', 'shop.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { createShop } = await import(file);
  const alone = createShop();
  assert.deepEqual(await alone.ready, { open: false, kids: false, screen: false });
  assert.equal(alone.has('badge:supporter'), false);
  // A stand-in shell: it answers like the play shell does.
  const sent = [];
  const handlers = [];
  const g = globalThis;
  const before = g.addEventListener;
  g.addEventListener = (ev, fn) => { if (ev === 'message') handlers.push(fn); };
  let target;
  const deliver = (data) => handlers.forEach((fn) => fn({ data, source: target }));
  try {
    const shop = createShop({ target: target = { postMessage: (m) => { sent.push(m); if (m.op === 'hello') setTimeout(() => deliver({ t: 'homie-shop', q: m.q, ok: true, open: true, owns: ['badge:supporter'] }), 1); if (m.op === 'used' || m.op === 'checkout') setTimeout(() => deliver({ t: 'homie-shop', q: m.q, ok: true }), 1); } } });
    const st = await shop.ready;
    assert.equal(st.open, true);
    assert.equal(shop.has('badge:supporter'), true);
    const changes = [];
    shop.on('change', (owns) => changes.push(owns));
    deliver({ t: 'homie-shop', ev: 'owns', owns: ['badge:supporter', 'skin:ember'] });
    assert.deepEqual(changes, [['badge:supporter', 'skin:ember']]);
    assert.deepEqual(shop.entitlements(), ['badge:supporter', 'skin:ember']);
    shop.open('ember');
    assert.deepEqual({ op: sent.at(-1).op, item: sent.at(-1).item }, { op: 'open', item: 'ember' });
    assert.equal(await shop.used('skin:ember'), true);
    assert.equal(await shop.used('skin:not-owned'), false);
    shop.add('ember', 3); shop.add('tip', 1, 500);
    assert.equal(shop.cart().length, 2);
    assert.equal(await shop.checkout(), true);
    assert.deepEqual(sent.at(-1).lines, [{ item: 'ember', quantity: 3 }, { item: 'tip', quantity: 1, amount: 500 }]);
    assert.equal(shop.cart().length, 0);
    assert.equal(await shop.buy('ember'), true);
    assert.deepEqual(sent.at(-1).lines, [{ item: 'ember', quantity: 1 }]);
    handlers.forEach((fn) => fn({ source: {}, data: { t: 'homie-shop', ev: 'owns', owns: ['forged'] } }));
    assert.equal(shop.has('forged'), false);
  } finally { g.addEventListener = before; }
});

test('the pages\' scripts parse (the shop page, the play shell\'s store sheet, the office\'s shop page)', async () => {
  const { Script } = await import('node:vm');
  const pages = await import('../worker/shop-page.mjs');
  for (const name of ['SHOP_JS', 'SHOP_SHELL_JS', 'OFFICE_SHOP_SCRIPT']) assert.doesNotThrow(() => new Script(pages[name]), name);
});


test('custom settings reach checkout, guests, refunds, kids servers, tips and zero-decimal reports', async () => {
  const s = await site({ settings: { policy: { preset: 'custom' }, capPerPlayerMonth: null, refundDays: null, currency: 'jpy', purchaseAttemptsPerMinute: 30,
    items: [{ ...SUPPORTER, price: 100000 }, { id: 'tip', kind: 'tip', name: 'Tip', min: 50 }] } });
  const p = s.player(400, { guest: true, band: 'child' });
  const list = await (await s.fetchSite('/api/shop', { headers: { cookie: p.cookie } })).json();
  assert.equal(list.items[0].way, 'checkout');
  assert.equal(list.cap, null);
  assert.equal(list.currencyScale, 1);
  assert.match(list.items[0].shown, /100,000/);
  const b = await s.buyPaid(p);
  assert.equal(b.call.form.get('line_items[0][price_data][unit_amount]'), '100000');
  assert.equal(b.call.form.get('line_items[0][price_data][currency]'), 'jpy');
  assert.doesNotMatch(b.call.form.get('custom_text[submit][message]'), /null days/);
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, 200, 'repeat purchase allowed');
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 1000000 }, s.as(p))).status, 200, 'no tip ceiling');
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 50.5 }, s.as(p))).status, 400, 'no fractional provider units');
  assert.equal((await s.post('/api/shop/refund', { order: b.order }, s.as(p))).status, 403, 'no self-service refund window unless set');
  const csv = await (await s.fetchSite('/_studio/api/shop/orders.csv', { headers: s.owner })).text();
  assert.match(csv, /,100000,/);
  await s.fetchSite('/_studio/api/servers', { method: 'POST', headers: s.key0, body: JSON.stringify({ game: 'owl-run', name: 'Little Ones', policy: 'beginner', kids: true }) });
  const kids = await (await s.fetchSite('/api/shop?game=owl-run&server=little-ones', { headers: { cookie: p.cookie } })).json();
  assert.equal(kids.open, true);
  assert.match(await (await s.fetchSite('/owl-run/s/little-ones/play')).text(), /"shop":\{/);
  const anonymous = await s.post('/api/shop/buy', { item: 'supporter' }, s.same);
  assert.equal(anonymous.status, 200, await anonymous.clone().text());
  assert.match(anonymous.headers.get('set-cookie'), /studio_player=/);
  const cookie = anonymous.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await s.fetchSite('/api/shop', { headers: { cookie } })).json()).player.guest, true);
  s.stripe.close();
});

test('purchase flood protection uses the address and the studio can change its rate', async () => {
  const s = await site({ settings: { purchaseAttemptsPerAddressPerMinute: 2 } });
  for (let i = 0; i < 2; i++) {
    const p = s.player(400, { band: 'adult' });
    assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.as(p), 'cf-connecting-ip': '203.0.113.9' })).status, 200);
  }
  const p = s.player(400, { band: 'adult' });
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.as(p), 'cf-connecting-ip': '203.0.113.9' })).status, 429);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.as(p), 'cf-connecting-ip': '203.0.113.10' })).status, 200);
  s.stripe.close();
});


test('long identifiers and entitlement keys survive checkout, catalog generation, use and guest adoption', async () => {
  const id = 'A studio item / ' + 'x'.repeat(6000);
  const key = 'Own this / ' + 'k'.repeat(6000);
  const s = await site({ catalog: ['test'], settings: { capPerPlayerMonth: 1000000, refundDays: 400, policy: { preset: 'custom' }, items: [{ id, kind: 'service', name: 'A service', price: 60000, gives: [key] }] } });
  const guest = s.player(400, { guest: true });
  const bought = await s.buyPaid(guest, id);
  assert.match(bought.call.form.get('line_items[0][price_data][product]'), /^homie_shop_owls_item_[a-f0-9]{64}$/);
  assert.equal(bought.call.form.has('metadata[item]'), false, 'the complete identifier stays in the order, within provider metadata constraints');
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: { cookie: guest.cookie } })).json()).owns, [key]);
  assert.equal((await s.post('/api/shop/used', { key }, s.as(guest))).status, 200);
  const account = s.player(400, { band: 'adult' });
  const { adoptShopStatements } = await import('../worker/shop-store.mjs');
  await s.DB.batch(await adoptShopStatements(s.env, guest.id, account.id));
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: { cookie: account.cookie } })).json()).owns, [key]);
  assert.equal((await s.post('/api/shop/refund', { order: bought.order }, s.as(account))).status, 200, 'studio permits used refunds');
  const { wantedProducts } = await import('../lib/shop-catalog.mjs');
  const products = await wantedProducts(checkShop({ policy: { preset: 'custom' }, items: [{ id, kind: 'service', name: 'A service', price: 60000 }] }).shop, 'shop-owls');
  assert.equal(products[0].id, bought.call.form.get('line_items[0][price_data][product]'));
  s.stripe.close();
});

test('referral terms have no ceilings and omission leaves no per-player cap or hold', async () => {
  const s = await site();
  const { lineFor, booksOf } = await import('../worker/referrals.mjs');
  const shop = checkShop({ referrals: { rate: 1.5 } }).shop;
  const order = { id: 'ord_referral_large', player: 'player-ref', via: 'friends.example', amount: 1000000, currency: 'usd' };
  await s.DB.batch(await lineFor(s.env, order, shop));
  const line = s.DB.sql.prepare('SELECT * FROM referral_lines WHERE order_id = ?').get(order.id);
  assert.equal(line.share, 1500000);
  assert.ok(line.hold_until <= Date.now());
  const capped = checkShop({ referrals: { rate: 1.5, capPerPlayer: 200000 } }).shop;
  await s.DB.batch(await lineFor(s.env, { ...order, id: 'ord_referral_capped' }, capped));
  assert.equal(s.DB.sql.prepare('SELECT share FROM referral_lines WHERE order_id = ?').get('ord_referral_capped').share, 200000);
  const fixed = s.DB.sql.prepare("INSERT INTO shop_orders (id, player, item, amount, currency, till, mode, status, created_at, updated_at) VALUES (?, 'player-ref', 'supporter', 1, 'usd', 'stripe', 'test', 'paid', 1, 1)");
  const referred = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, 'friends.example', 1, 1, 1, 'usd', 'owed', '2026-10', 1, 1)");
  for (let i = 0; i < 2001; i++) { fixed.run('order-many-' + i); referred.run('order-many-' + i); }
  assert.equal((await booksOf(s.env)).books[0].due, 1702001, 'the books do not stop at 2000 sales');
  s.stripe.close();
});


test('the studio can permit parent checkout for children, including a tip chosen by the parent', async () => {
  const s = await site({ settings: { capPerPlayerMonth: null, policy: { preset: 'protective', children: 'parent' }, items: [{ id: 'tip', kind: 'tip', name: 'Tip', min: 50 }] } });
  const child = s.player(400, { band: 'child' });
  const link = await (await s.post('/api/shop/parent', { item: 'tip' }, s.as(child))).json();
  assert.equal(link.ok, true);
  const go = await s.fetchSite(new URL(link.link).pathname, { method: 'POST', headers: { origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grownup=yes&amount=123.45' });
  assert.equal(go.status, 303);
  assert.equal(s.stripe.calls.at(-1).form.get('line_items[0][price_data][unit_amount]'), '12345');
  s.stripe.close();
});

test('fractional durations, decimal amounts, provider strings and policy validation', async () => {
  for (let n = 1; n <= 1000; n++) {
    const r = checkShop({ refundDays: n / 100, items: [{ ...SUPPORTER, days: n / 100 }] });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  }
  for (const cap of ['', false, true, [], '0x10', 2500.7]) {
    const r = checkShop({ capPerPlayerMonth: cap });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].at, 'capPerPlayerMonth');
    assert.match(r.errors[0].message, /whole number of minor units/);
  }
  assert.equal(checkShop({ purchaseAttemptsPerMinute: '10' }).ok, true);
  for (const currency of ['bhd', 'jod', 'kwd', 'omr', 'tnd']) {
    assert.equal(currencyScale(currency), 1000);
    assert.equal(parseAmount('5.120', 1000), 5120);
    assert.equal(amountError(5120, currency), null);
    assert.equal(amountError(5125, currency), null);
    assert.match(money(5000, currency), /5\.000/);
  }
  for (const raw of [{ till: 'unknown' }, { items: [{ ...SUPPORTER, game: 'missing' }] }, { items: [{ ...SUPPORTER, id: '   ' }] }, { items: [{ ...SUPPORTER, name: 'x'.repeat(5001) }] }, { items: [{ ...SUPPORTER, blurb: 'x'.repeat(40001) }] }]) assert.equal(checkShop(raw, { games: ['owl-run'] }).ok, false);
  assert.equal(checkShop({ items: [{ ...SUPPORTER, name: 'Jukebox' }] }).ok, true);
  const publicItem = checkShop({ items: [{ ...SUPPORTER, supplier: 'private', internalNote: 'private' }] }).shop.items[0];
  assert.equal(publicItem.supplier, undefined);
  assert.equal(publicItem.internalNote, undefined);
  assert.equal(checkShop({ items: [SUPPORTER] }, { studioName: 'x'.repeat(1200) }).ok, false);
  const { productIdOf } = await import('../worker/stripe.mjs');
  assert.equal(await productIdOf('!!!', 'x'), null);
});

test('invalid unauthenticated requests create no guest rows; valid purchases obey player limits', async () => {
  const s = await site({ settings: { policy: { preset: 'custom' } } });
  for (let i = 0; i < 300; i++) assert.equal((await s.post('/api/shop/buy', { item: 'nonexistent' }, { ...s.same, 'cf-connecting-ip': `198.51.${Math.floor(i / 250)}.${i % 250}` })).status, 404);
  for (let i = 0; i < 20; i++) await s.post('/api/shop/age', { year: [] }, s.same);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM players').get().n, 0);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM player_sessions').get().n, 0);
  for (let i = 0; i < 300; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.same, 'cf-connecting-ip': '198.51.100.210' })).status, 200);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM players').get().n, 300);
  s.env.PLAYER_LIMIT_DAILY = '60';
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.same, 'cf-connecting-ip': '198.51.100.211' })).status, 503);
  s.stripe.close();
});

test('account flood protection survives address rotation and lets shared addresses buy', async () => {
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  for (let i = 0; i < 9; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.as(p), 'cf-connecting-ip': `198.51.100.${i}` })).status, i < 6 ? 200 : 429);
  for (let i = 0; i < 20; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.as(s.player(400, { band: 'adult' })), 'cf-connecting-ip': '198.51.100.220' })).status, 200);
  s.stripe.close();
});

test('many concurrent purchases reserve the studio cap atomically and expiry releases it', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 800, purchaseAttemptsPerMinute: 1000 } });
  const p = s.player(400, { band: 'adult' });
  const results = await Promise.all(Array.from({ length: 200 }, () => s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))));
  assert.equal(results.filter((r) => r.status === 200).length, 4);
  assert.equal(s.DB.sql.prepare("SELECT SUM(amount) AS n FROM shop_orders WHERE status = 'started'").get().n, 800);
  const order = s.DB.sql.prepare('SELECT * FROM shop_orders LIMIT 1').get();
  s.DB.sql.prepare('UPDATE shop_orders SET updated_at = 1, expires_at = ? WHERE id = ?').run(Date.now() - DAY, order.id);
  s.stripe.behave.sessions.get(order.session).status = 'expired';
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 200, 'Stripe expiry releases capacity without an event');
  await s.hook('checkout.session.expired', { id: order.session });
  s.DB.sql.prepare("UPDATE shop_orders SET created_at = ?, updated_at = 1 WHERE status = 'started'").run(Date.now() - 120000);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 200, 'a new checkout expires the buyer aged open reservation');
  s.stripe.close();
});

test('free orders can be revoked without Stripe and mismatched webhook currency grants nothing', async () => {
  const s = await site({ settings: { policy: { preset: 'custom' }, refundDays: 14, items: [{ ...SUPPORTER, price: 0 }] } });
  const p = s.player(400, { band: 'adult' });
  const b = await s.buyPaid(p);
  const before = s.stripe.calls.length;
  assert.equal((await s.post('/api/shop/refund', { order: b.order }, s.as(p))).status, 200);
  assert.equal(s.stripe.calls.length, before);
  assert.equal(s.DB.sql.prepare('SELECT state FROM entitlements LIMIT 1').get().state, 'revoked');
  const buy = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const order = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(buy.order);
  const response = await s.hook('checkout.session.completed', { id: order.session, metadata: { order: order.id }, payment_status: 'no_payment_required', currency: 'jpy', amount_subtotal: 0 });
  assert.equal((await response.json()).did, 'mismatch');
  s.stripe.close();
});

test('200000 referral rows have exact SQL totals and bounded pages and heap', async (t) => {
  const { booksOf } = await import('../worker/referrals.mjs');
  const s = await site();
  const order = s.DB.sql.prepare("INSERT INTO shop_orders (id, item, amount, currency, till, mode, status, created_at, updated_at) VALUES (?, 'supporter', 500, 'usd', 'stripe', 'test', 'paid', 1, 1)");
  const line = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, ?, 500, 0.1, 50, 'usd', 'pending', '2026-10', ?, 1)");
  s.DB.sql.exec('BEGIN');
  for (let i = 0; i < 200000; i++) { const id = `order-${String(i).padStart(6, '0')}`; order.run(id); line.run(id, `ref${i % 50}.example`, Date.now() + DAY); }
  s.DB.sql.exec('COMMIT');
  const { linesOf } = await import('../worker/referrals.mjs');
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const { books, nextCursor } = await booksOf(s.env);
  assert.equal(books.length, 50);
  assert.equal(nextCursor, null);
  assert.equal(books.reduce((n, b) => n + b.pending, 0), 10000000);
  let count = 0, sum = 0;
  for (const book of books) {
    let cursor = '';
    do {
      const page = await linesOf(s.env, { via: book.via, currency: book.currency, cursor });
      count += page.lines.length;
      sum += page.lines.reduce((n, l) => n + l.share, 0);
      assert.ok(JSON.stringify(page).length < 100000);
      cursor = page.nextCursor;
    } while (cursor);
  }
  assert.equal(count, 200000);
  assert.equal(sum, 10000000);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 15000, `full read took ${elapsed}ms`);
  const heapDelta = process.memoryUsage().heapUsed - before;
  assert.ok(heapDelta < 48 * 1024 * 1024);
  t.diagnostic(`200000 rows: exact total ${sum}; full read ${Math.round(elapsed)}ms; heap delta ${heapDelta} bytes.`);
  const { statementPage } = await import('../worker/referrals.mjs');
  let statementCursor = '', statementLines = 0, statementTotal = 0;
  const statementStart = performance.now();
  do {
    const page = await statementPage(s.env, 'https://seller.example', null, '2026-10', statementCursor);
    for (const e of page.statements) {
      assert.ok(e.statement.lines.length <= 100);
      statementLines += e.statement.lines.length;
      statementTotal += e.statement.totals?.pending ?? 0;
    }
    statementCursor = page.nextCursor;
  } while (statementCursor);
  assert.equal(statementLines, 200000);
  assert.equal(statementTotal, sum);
  t.diagnostic(`Immutable statement edition: ${statementLines} lines, ${Math.round(performance.now() - statementStart)}ms.`);
  s.stripe.close();
});

test('referral flood settings keep a global bound and cookies have persistent integer lifetimes', async () => {
  const { receiveStatement, resetReferralLimits, arrivalCookie } = await import('../worker/referrals.mjs');
  for (const setting of [undefined, -1, 0, 'text', '0x10', '1.5']) {
    resetReferralLimits();
    const statuses = [];
    for (let i = 0; i < 200; i++) statuses.push((await receiveStatement(new Request('https://owls.example/api/referrals/statement', { method: 'POST', headers: { 'cf-connecting-ip': `198.51.100.${i}` }, body: '{}' }), { REFERRAL_STATEMENTS_PER_MINUTE: setting, REFERRAL_STATEMENT_BYTES: setting }, new URL('https://owls.example/api/referrals/statement'))).status);
    assert.equal(statuses.filter((s) => s === 400).length, setting === undefined ? 30 : 0);
    assert.equal(statuses.filter((s) => s === 429).length, setting === undefined ? 170 : 0);
    if (setting !== undefined) assert.ok(statuses.every((s) => s === 503));
  }
  resetReferralLimits();
  const s = await site();
  const url = new URL('https://owls.example/?via=friends.example');
  for (const windowDays of [null, 0.07, 1000000]) {
    const cookie = await arrivalCookie(new Request(url, { headers: { 'user-agent': BROWSER, accept: 'text/html' } }), s.env, url, { open: true, referrals: { windowDays } });
    assert.match(cookie, /; Max-Age=\d+(?:;|$)/);
  }
  s.stripe.close();
});

test('catalog and referral cursor traversal exposes every row once', async () => {
  const s = await site({ settings: { policy: { preset: 'custom' }, items: Array.from({ length: 251 }, (_, i) => ({ id: `item-${i}`, kind: 'service', name: `Item ${i}`, price: 100, gives: [] })) } });
  const seen = new Set();
  let cursor = '';
  do {
    const page = await (await s.fetchSite('/api/shop?cursor=' + cursor)).json();
    assert.ok(page.items.length <= 100);
    for (const item of page.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 251);
  s.stripe.close();
});

test('fractional amount errors stop publication and name every amount setting', () => {
  const dir = studio('amount-settings');
  const raw = { items: [SUPPORTER], capPerPlayerMonth: 2500.7 };
  writeFileSync(join(dir, 'shop.json'), JSON.stringify(raw));
  const result = run(['build'], dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /capPerPlayerMonth.*2500.*2500\.7/s);
  for (const settings of [{ items: [{ ...SUPPORTER, price: 1.1 }] }, { items: [{ id: 'tip', kind: 'tip', name: 'Tip', min: 1.1 }] }, { items: [{ id: 'tip', kind: 'tip', name: 'Tip', max: 1.1 }] }, { referrals: { capPerPlayer: 1.1 } }, { referrals: { minimumInvoice: 1.1 } }]) assert.equal(checkShop(settings).ok, false);
});

test('processing payments reserve until expiry or failure; refunds release paid spending', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 500, purchaseAttemptsPerMinute: 100 } });
  const p = s.player(400, { band: 'adult' });
  const started = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const o = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(started.order);
  await s.hook('checkout.session.completed', { id: o.session, payment_status: 'unpaid' });
  s.DB.sql.prepare('UPDATE shop_orders SET created_at = ? WHERE id = ?').run(Date.now() - DAY, o.id);
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, 403);
  await s.hook('checkout.session.async_payment_failed', { id: o.session });
  const bought = await s.buyPaid(p);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 403);
  assert.equal((await s.post('/api/shop/refund', { order: bought.order }, s.as(p))).status, 200);
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, 200);
  s.stripe.close();
});

test('catalog ETags reuse validation and a changed asset invalidates it', async () => {
  const s = await site();
  const assets = s.env.ASSETS;
  let reads = 0;
  let tag = 'catalog-one';
  s.env.ASSETS = { async fetch(request) {
    const response = await assets.fetch(request);
    if (new URL(request.url).pathname === '/games.json') {
      response.headers.set('etag', tag);
      const read = response.json.bind(response);
      response.json = () => { reads++; return read(); };
    }
    return response;
  } };
  await s.fetchSite('/api/shop');
  await s.fetchSite('/api/shop');
  assert.equal(reads, 1);
  tag = 'catalog-two';
  await s.fetchSite('/api/shop');
  assert.equal(reads, 2);
  s.stripe.close();
});

test('signed statement cursor pages expose all referral lines without duplicating totals', async () => {
  const { receiveStatement, resetReferralLimits, receivedPages } = await import('../worker/referrals.mjs');
  resetReferralLimits();
  const s = await site();
  const order = s.DB.sql.prepare("INSERT INTO shop_orders (id, item, amount, currency, till, mode, status, created_at, updated_at) VALUES (?, 'supporter', 500, 'usd', 'stripe', 'test', 'paid', 1, 1)");
  const line = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, 'friends.example', 500, 0.1, 50, 'usd', 'owed', '2026-10', 1, 1)");
  for (let i = 0; i < 251; i++) { const id = `order-${String(i).padStart(6, '0')}`; order.run(id); line.run(id); }
  let cursor = '';
  const seen = new Set();
  do {
    const page = await (await s.fetchSite('/_studio/api/shop/statements?period=2026-10&cursor=' + encodeURIComponent(cursor), { headers: s.owner })).json();
    assert.equal(page.ok, true);
    for (const envelope of page.statements) {
      assert.equal(await verifyStatement(envelope, envelope.key), true);
      const received = await receiveStatement(new Request('https://friends.example/api/referrals/statement', { method: 'POST', body: JSON.stringify(envelope) }), s.env, new URL('https://friends.example/api/referrals/statement'), { fetcher: async () => Response.json({ referrals: { key: { x: envelope.key } } }) });
      assert.equal(received.status, 200);
      if (!envelope.statement.page.cursor) assert.equal(envelope.statement.totals.due, 12550);
      else assert.equal(envelope.statement.totals, undefined);
      for (const line of envelope.statement.lines) { assert.ok(!seen.has(line.order)); seen.add(line.order); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 251);
  cursor = '';
  let storedLines = 0;
  do {
    const page = await receivedPages(s.env, 'https://owls.example', '2026-10', cursor);
    storedLines += page.statements[0].statement.lines.length;
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(storedLines, 251, 'receiving a later page preserves earlier signed lines');
  s.stripe.close();
});

test('expired, sessionless and test-mode reservations are resolved without guessing', async () => {
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  for (const kind of ['lost-expiry-event', 'sessionless', 'test-mode', 'processing', 'unreachable', 'failed-bank']) {
    const s = await site({ settings: { capPerPlayerMonth: 500, purchaseAttemptsPerMinute: 100 } });
    const p = s.player(400, { band: 'adult' });
    const bought = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
    const order = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(bought.order);
    const truth = s.stripe.behave.sessions.get(order.session);
    if (['processing', 'failed-bank'].includes(kind)) {
      await s.hook('checkout.session.completed', { id: order.session, payment_status: 'unpaid' });
      truth.status = 'complete';
      truth.payment_intent = { id: 'pi_bank', status: kind === 'processing' ? 'processing' : 'requires_payment_method', last_payment_error: kind === 'failed-bank' ? { code: 'failed' } : null };
    }
    if (kind === 'unreachable') s.stripe.behave.unreachable = true;
    if (kind === 'lost-expiry-event') truth.status = 'expired';
    if (kind === 'test-mode') s.env.STRIPE_KEY = TEST_KEY.replace('_test_', '_live_');
    else s.DB.sql.prepare('UPDATE shop_orders SET updated_at = 1, expires_at = ?, session = ? WHERE id = ?').run(Date.now() - DAY, kind === 'sessionless' ? null : order.session, order.id);
    const pending = ['processing', 'unreachable'].includes(kind);
    assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, pending ? 403 : 200, kind);
    assert.equal(await spentThisMonth(s.env, p.id), 500, kind);
    if (kind === 'lost-expiry-event') {
      for (let i = 0; i < 3; i++) await s.hook('checkout.session.expired', { id: order.session });
      assert.equal(await spentThisMonth(s.env, p.id), 500);
    }
    s.stripe.close();
  }
});

test('pruning progresses past 25 owners and removes the other 500 idle guests', async () => {
  const { pruneGuests } = await import('../worker/players.mjs');
  const s = await site();
  for (let i = 0; i < 525; i++) {
    const p = s.player(400, { guest: true });
    if (i < 25) s.DB.sql.prepare("INSERT INTO entitlements (player, key, item, order_id, starts_at, state) VALUES (?, 'badge:supporter', 'supporter', ?, 1, 'active')").run(p.id, `order-prune-${i}`);
  }
  s.DB.sql.prepare('UPDATE players SET seen_at = ?').run(Date.now() - 400 * DAY);
  for (let i = 0; i < 40; i++) await pruneGuests(s.env);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM players').get().n, 25);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM entitlements').get().n, 25);
  s.stripe.close();
});

test('2000 referrers are listed once and their displayed totals equal SQL exactly', async () => {
  const { booksOf } = await import('../worker/referrals.mjs');
  const s = await site();
  const line = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, ?, 500, 0.5, 250, 'usd', 'owed', '2026-10', 1, 1)");
  for (let i = 0; i < 2000; i++) line.run(`order-${i}`, `ref${String(i).padStart(4, '0')}.example`);
  const seen = new Set();
  let cursor = '', sum = 0;
  do {
    const page = await booksOf(s.env, { cursor });
    for (const b of page.books) { assert.ok(!seen.has(b.via)); seen.add(b.via); sum += b.due; assert.equal(b.lineCount, 1); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 2000);
  assert.equal(sum, s.DB.sql.prepare('SELECT SUM(share) AS n FROM referral_lines').get().n);
  s.stripe.close();
});

test('address churn cannot reset an account, and new guest rates are configurable and positive', async () => {
  for (const value of [0, -1, false, '', '0x10', 1.5]) assert.equal(checkShop({ guestBuyersPerAddressPerHour: value }).ok, false);
  const s = await site({ settings: { capPerPlayerMonth: null } });
  const p = s.player(400, { band: 'adult' });
  for (let i = 0; i < 6; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 200);
  for (let i = 0; i < 10005; i++) await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.same, 'cf-connecting-ip': `2001:db8::${i.toString(16)}` });
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 429);
  s.stripe.close();
  const limited = await site({ settings: { policy: { preset: 'custom' }, guestBuyersPerAddressPerHour: 2 } });
  for (const status of [200, 200, 429]) assert.equal((await limited.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...limited.same, 'cf-connecting-ip': '198.51.100.222' })).status, status);
  limited.stripe.close();
});

test('a guest keeps the cookie when Stripe refuses and can answer the age question', async () => {
  const s = await site({ managed: true, settings: { policy: { preset: 'custom', ageQuestion: true } } });
  const age = await s.post('/api/shop/age', { year: new Date().getFullYear() - 30 }, s.same);
  assert.equal(age.status, 200);
  const cookie = age.headers.get('set-cookie').split(';')[0];
  s.stripe.behave.managedRefused = true;
  for (let i = 0; i < 5; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...s.same, cookie })).status, 502);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM players').get().n, 1);
  s.stripe.close();
  const noAge = await site({ managed: true, settings: { policy: { preset: 'custom' } } });
  noAge.stripe.behave.managedRefused = true;
  const refusal = await noAge.post('/api/shop/buy', { item: 'tip', amount: 200 }, { ...noAge.same, 'cf-connecting-ip': '198.51.100.223' });
  assert.equal(refusal.status, 502);
  assert.match(refusal.headers.get('set-cookie'), /studio_player=/);
  assert.match((await refusal.json()).message, /Managed Payments is not enabled/);
  noAge.stripe.close();
});

test('free items and zero tips work above a lowered cap; partial refunds retain ownership', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 500, policy: { preset: 'custom' }, items: [SUPPORTER, { id: 'free', name: 'Free', kind: 'service', price: 0 }, { id: 'tip', name: 'Tip', kind: 'tip', min: 0 }] } });
  const p = s.player(400);
  const paid = await s.buyPaid(p);
  s.DB.sql.prepare('UPDATE shop_orders SET amount = 1500 WHERE id = ?').run(paid.order);
  assert.equal((await s.post('/api/shop/buy', { item: 'free' }, s.as(p))).status, 200);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 0 }, s.as(p))).status, 200);
  await s.hook('refund.updated', { id: 're_test_partial', status: 'succeeded', amount: 100, payment_intent: paid.payment });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(paid.order).status, 'paid');
  assert.equal(s.DB.sql.prepare('SELECT state FROM entitlements WHERE order_id = ? LIMIT 1').get(paid.order).state, 'active');
  await s.hook('charge.refunded', { payment_intent: paid.payment, amount: 540, amount_refunded: 540, refunded: true });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(paid.order).status, 'refunded');
  s.stripe.close();
});

test('simultaneous referral lines share one atomic per-player cap', async () => {
  const { lineFor } = await import('../worker/referrals.mjs');
  const s = await site();
  const shop = checkShop({ referrals: { rate: 1, capPerPlayer: 800 } }).shop;
  const orders = Array.from({ length: 40 }, (_, i) => ({ id: `order-ref-concurrent-${i}`, player: 'ref-player', via: 'friends.example', amount: 300, currency: 'usd' }));
  for (const o of orders) s.DB.sql.prepare("INSERT INTO shop_orders (id, player, item, amount, currency, till, mode, status, created_at, updated_at) VALUES (?, ?, 'supporter', 300, 'usd', 'stripe', 'test', 'paid', 1, 1)").run(o.id, o.player);
  const writes = await Promise.all(orders.map((o) => lineFor(s.env, o, shop)));
  await Promise.all(writes.map((w) => s.DB.batch(w)));
  assert.equal(s.DB.sql.prepare('SELECT SUM(share) AS n FROM referral_lines').get().n, 800);
  s.stripe.close();
});

test('statement delivery continues after receiver throttling and a replacement removes stale pages', async () => {
  const { sendStatements, receiveStatement, resetReferralLimits, receivedPages, statementFor } = await import('../worker/referrals.mjs');
  const s = await site();
  resetReferralLimits();
  const line = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, 'friends.example', 100, 1, 100, 'usd', 'owed', '2026-10', 1, 1)");
  for (let i = 0; i < 251; i++) line.run(`order-${String(i).padStart(5, '0')}`);
  const envelopes = [];
  let throttle = true;
  const fetcher = async (url, init) => {
    if (!init?.body) return Response.json({ referrals: { statements: 'https://friends.example/api/referrals/statement' } });
    if (throttle) { throttle = false; return new Response('', { status: 429 }); }
    const envelope = JSON.parse(init.body);
    envelopes.push(envelope);
    return receiveStatement(new Request(url, init), s.env, new URL(url), { fetcher: async () => Response.json({ referrals: { key: { x: envelope.key } } }) });
  };
  let cursor = '', total = 0;
  do {
    s.DB.sql.exec("UPDATE meta SET value = json_set(value, '$.nextAt', 0) WHERE key LIKE 'referral-send:%'");
    const page = await sendStatements(s.env, 'https://owls.example', {}, '2026-10', { cursor, fetcher });
    if (page.retryAfter === 60) { assert.equal(page.nextCursor, 'resume'); assert.equal(page.sent.length, 0); }
    for (const result of page.sent) assert.equal(result.ok, true);
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.equal(envelopes.length, 3);
  assert.equal(envelopes.reduce((n, e) => n + (e.statement.totals?.due ?? 0), 0), 25100);
  assert.equal(envelopes.reduce((n, e) => n + e.statement.lines.length, 0), 251);
  const book = { via: 'friends.example', currency: 'usd', pending: 0, owed: 100, clawback: 0, due: 100, lines: [] };
  const replacement = await statementFor(s.env, 'https://owls.example', book, '2026-10', null);
  const receive = (envelope) => receiveStatement(new Request('https://friends.example/api/referrals/statement', { method: 'POST', body: JSON.stringify(envelope) }), s.env, new URL('https://friends.example/api/referrals/statement'), { fetcher: async () => Response.json({ referrals: { key: { x: envelope.key } } }) });
  assert.equal((await receive(envelopes[0])).status, 200);
  assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'referral-page:%'").get().n, 3, 'a late first-page replay never discards continuations');
  assert.equal((await receive(replacement)).status, 200);
  const page = await receivedPages(s.env, 'https://owls.example', '2026-10');
  assert.equal(page.nextCursor, null);
  assert.equal(page.statements[0].statement.totals.due, 100);
  assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'referral-page:%'").get().n, 1);
  const hostile = await statementFor(s.env, 'https://owls.example', { ...book, page: { cursor: 'x'.repeat(257), nextCursor: null } }, '2026-10', null);
  assert.equal((await receive(hostile)).status, 400);
  const invented = await statementFor(s.env, 'https://owls.example', { ...book, page: { cursor: 'invented', nextCursor: null } }, '2026-10', null);
  assert.equal((await receive(invented)).status, 409);
  s.stripe.close();
});

test('the game sheet reaches item 101 and one office click drains queued statement pages', async () => {
  const { runInNewContext } = await import('node:vm');
  const { SHOP_SHELL_JS, OFFICE_SHOP_SCRIPT } = await import('../worker/shop-page.mjs');
  const nodes = [];
  const element = () => {
    const node = { children: [], events: {}, setAttribute() {}, appendChild(child) { this.children.push(child); return child; }, addEventListener(name, fn) { this.events[name] = fn; }, remove() {} };
    nodes.push(node); return node;
  };
  const frame = { contentWindow: { postMessage() {} } };
  const ids = new Map();
  const document = { body: element(), createElement: element, createTextNode: (text) => ({ textContent: text }), addEventListener() {}, querySelector(selector) {
    if (selector === 'iframe.game') return frame;
    if (!ids.has(selector)) ids.set(selector, element());
    return ids.get(selector);
  } };
  const window = { __HOMIE_PLAY: { game: 'owl-run', name: 'Owl Run', shop: { policy: {} } }, addEventListener() {} };
  const paths = [];
  const fetchItems = async (path) => {
    paths.push(path);
    if (path.startsWith('/api/player/owns')) return Response.json({ owns: [] });
    const cursor = new URL(path, 'https://owls.example').searchParams.get('cursor');
    return Response.json({ ok: true, open: true, items: [{ id: cursor ? 'item-101' : 'item-1', name: cursor ? 'Item 101' : 'Item 1', kind: 'service', way: 'cap', retryWay: 'checkout', shown: '$1.00' }], nextCursor: cursor ? null : '100' });
  };
  runInNewContext(SHOP_SHELL_JS, { window, document, fetch: fetchItems, setTimeout, URL });
  window.__shell.shop.open();
  await new Promise(setImmediate);
  const next = nodes.find((n) => n.textContent === 'Next items');
  assert.ok(next);
  next.onclick();
  await new Promise(setImmediate);
  assert.ok(paths.some((p) => p.includes('cursor=100')));
  assert.ok(nodes.some((n) => n.textContent === 'Item 101'));
  assert.ok(nodes.some((n) => n.textContent === 'Buy on Stripe'), 'cap refusals still permit a purchase retry');
  const calls = [], waits = [];
  runInNewContext(OFFICE_SHOP_SCRIPT, { document, clearTimeout() {}, setTimeout(fn, ms) { waits.push(ms); fn(); }, fetch: async (path, init) => {
    if (init.method === 'GET') return Response.json({ ok: true, ready: true, mode: 'test', missing: [], stripe: {}, orders: [], referrals: { owe: [{ via: 'friends.example', currency: 'usd', due: 1, pending: 0, lineCount: 251 }], owedToUs: [] } });
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true, period: '2026-10', sent: calls.length === 2 ? [] : [{ ok: true }], nextCursor: calls.length === 1 || calls.length === 2 ? 'next' : null, retryAfter: calls.length === 2 ? 60 : undefined });
  } });
  await new Promise(setImmediate);
  const send = nodes.find((n) => n.textContent === "Send last month's signed statements");
  assert.ok(send);
  await send.events.click();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.cursor), ['', 'next', 'next']);
  assert.equal(calls[1].period, '2026-10');
  assert.ok(waits.includes(60000));
  assert.equal(send.disabled, false);
});

test('four late-webhook windows and bank-debit windows never overspend; duplicate events do nothing', async () => {
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  for (const bank of [false, true]) {
    const s = await site({ settings: { capPerPlayerMonth: 1000, purchaseAttemptsPerMinute: 100 } });
    const p = s.player(400, { band: 'adult' });
    for (let i = 0; i < 2; i++) {
      const buy = await s.post('/api/shop/buy', { item: 'tip', amount: 500 }, s.as(p));
      assert.equal(buy.status, 200);
      const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get((await buy.json()).order);
      s.stripe.behave.sessions.get(row.session).status = 'complete';
    }
    const orders = s.DB.sql.prepare('SELECT * FROM shop_orders').all();
    for (const o of orders) {
      const truth = s.stripe.behave.sessions.get(o.session);
      truth.status = 'complete';
      truth.payment_intent = { id: `pi_${o.id}`, status: bank ? 'processing' : 'succeeded' };
      if (bank) await s.hook('checkout.session.completed', truth);
      else truth.payment_status = 'paid';
    }
    for (let window = 0; window < 4; window++) {
      s.DB.sql.prepare('UPDATE shop_orders SET expires_at = ?').run(Date.now() - (window + 1) * 33 * 60000);
      assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 500 }, s.as(p))).status, 403);
      assert.equal(await spentThisMonth(s.env, p.id), 1000);
    }
    for (const o of orders) {
      const truth = s.stripe.behave.sessions.get(o.session);
      truth.payment_status = 'paid'; truth.payment_intent.status = 'succeeded';
      for (let i = 0; i < 3; i++) await s.hook('checkout.session.async_payment_succeeded', truth);
      await s.hook('checkout.session.expired', { id: o.session });
    }
    assert.equal(await spentThisMonth(s.env, p.id), 1000);
    assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE status = 'paid'").get().n, 2);
    s.stripe.close();
  }
});

test('statement failures retry identical pages, resume without caller cursors, and preserve an edition during settlement', async () => {
  const { sendStatements, receiveStatement, resetReferralLimits, settle, pendingStatementPeriod, statementsIn, statementPage } = await import('../worker/referrals.mjs');
  const s = await site();
  const receiver = await site();
  resetReferralLimits();
  const insert = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, ?, 100, 1, 100, ?, 'owed', '2026-10', 1, 1)");
  for (const host of ['a.example', 'b.example', 'c.example']) for (let i = 0; i < 201; i++) insert.run(`${host}-${i.toString().padStart(3, '0')}`, host, 'usd');
  insert.run('euro', 'c.example', 'eur');
  const bodies = [], failures = [], received = [];
  let once = true, lostReply = true, settled = false;
  const fetcher = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    const host = new URL(url).hostname;
    if (!init?.body) return Response.json({ referrals: { statements: `https://${host}/api/referrals/statement` } });
    bodies.push(init.body);
    const e = JSON.parse(init.body);
    if (host === 'a.example' && e.statement.page.cursor && once) { once = false; return new Response('', { status: 500 }); }
    if (host === 'b.example') return new Response('', { status: 500 });
    const result = await receiveStatement(new Request(url, init), host === 'a.example' ? receiver.env : s.env, new URL(url), { fetcher: async () => Response.json({ referrals: { key: { x: e.key } } }) });
    if (result.ok) received.push(e);
    if (host === 'a.example' && !settled) { settled = true; assert.equal((await settle(s.env, host, 'invoice', { currency: 'usd' })).ok, true); }
    if (host === 'a.example' && !e.statement.page.cursor && lostReply) { lostReply = false; throw new Error('response lost after acceptance'); }
    return result;
  };
  let page, calls = 0;
  do {
    s.DB.sql.exec("UPDATE meta SET value = json_set(value, '$.nextAt', 0) WHERE key LIKE 'referral-send:%'");
    // Restart with an empty or hostile cursor each time: only persisted server progress is used.
    page = await sendStatements(s.env, 'https://seller.example', {}, '2026-10', { cursor: calls++ % 2 ? '["","victim.example","usd",""]' : '', fetcher });
    failures.push(...page.sent.filter((x) => !x.ok));
    assert.equal(await pendingStatementPeriod(s.env, 'https://seller.example'), page.nextCursor === null ? null : '2026-10');
    assert.ok(calls < 25);
  } while (page.nextCursor !== null);
  assert.deepEqual(failures.map((x) => x.via), ['b.example']);
  assert.equal(bodies[0], bodies[1], 'a lost reply replays the exact first page');
  assert.equal(bodies[2], bodies[3], 'a failed continuation retries the exact page');
  const summaries = [...await statementsIn(s.env), ...await statementsIn(receiver.env)];
  assert.equal(summaries.length, 3, 'a USD, c EUR, c USD; failed b does not prevent c');
  assert.equal(summaries.find((r) => r.seller === 'https://seller.example' && r.currency === 'eur').due, 100);
  // Different receiver hosts share this test DB: inspect signed a pages separately in the observed traffic.
  const aPages = new Map(received.filter((e) => e.statement.referrer === 'a.example').map((e) => [e.statement.page.cursor, e]));
  assert.equal([...aPages.values()].flatMap((e) => e.statement.lines).length, 201);
  assert.equal([...aPages.values()][0].statement.totals.due, 20100);
  assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM referral_lines WHERE via = 'a.example' AND state = 'settled'").get().n, 201);
  for (const cursor of ['[1e308,1e308]', '["","victim.example","usd",""]', '["",5,"usd",""]']) {
    const result = await statementPage(s.env, 'https://seller.example', null, '2026-10', cursor);
    assert.equal(result.statements.length, 0);
  }
  s.stripe.close(); receiver.stripe.close();
});

test('two received currencies and currency-specific settlement remain independent', async () => {
  const { statementFor, receiveStatement, statementsIn, settle, resetReferralLimits } = await import('../worker/referrals.mjs');
  const s = await site(); resetReferralLimits();
  for (const [currency, due] of [['eur', 100], ['usd', 70]]) {
    const e = await statementFor(s.env, 'https://seller.example', { via: 'friends.example', currency, pending: 0, owed: due, clawback: 0, due, lines: [] }, '2026-10', null);
    assert.equal((await receiveStatement(new Request('https://friends.example/api/referrals/statement', { method: 'POST', body: JSON.stringify(e) }), s.env, new URL('https://friends.example'), { fetcher: async () => Response.json({ referrals: { key: { x: e.key } } }) })).status, 200);
    s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, 'friends.example', ?, 1, ?, ?, 'owed', '2026-10', 1, 1)").run(currency, due, due, currency);
  }
  assert.equal((await statementsIn(s.env)).length, 2);
  await settle(s.env, 'friends.example', 'invoice', { currency: 'eur' });
  assert.deepEqual(s.DB.sql.prepare('SELECT currency, state FROM referral_lines ORDER BY currency').all().map((x) => [x.currency, x.state]), [['eur', 'settled'], ['usd', 'owed']]);
  s.stripe.close();
});

test('missing reservation schema closes the shop; no cap avoids spending SUM; future entitlements survive pruning', async () => {
  const { pruneGuests, players } = await import('../worker/players.mjs');
  const s = await site({ settings: { capPerPlayerMonth: null, policy: { preset: 'custom' } } });
  const p = s.player(400, { band: 'adult', guest: true });
  const queries = [], prepare = s.DB.prepare;
  s.DB.prepare = (q) => { queries.push(q); return prepare(q); };
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 200);
  assert.ok(!queries.some((q) => /SELECT COALESCE\(SUM/.test(q) && !q.startsWith('INSERT')));
  s.DB.sql.prepare("INSERT INTO entitlements (player, key, item, order_id, starts_at, state) VALUES (?, 'future', 'supporter', 'future', ?, 'active')").run(p.id, Date.now() + 365 * DAY);
  s.DB.sql.prepare('UPDATE players SET seen_at = ?').run(Date.now() - 400 * DAY);
  await pruneGuests(s.env);
  assert.ok(s.DB.sql.prepare('SELECT 1 FROM players WHERE id = ?').get(p.id));
  s.DB.sql.exec('ALTER TABLE shop_orders DROP COLUMN expires_at');
  // A new binding represents the next isolate; complete schemas are cached for an isolate's lifetime.
  s.env.DB = { ...s.DB };
  const office = await (await s.fetchSite('/_studio/api/shop', { headers: s.owner })).json();
  assert.equal(office.ready, false);
  assert.match(office.missing.map((x) => x.words).join(' '), /0010_shop_reservations/);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 503);
  s.stripe.close();
});

test('guest shopping leaves the ordinary new-player address allowance intact', async () => {
  const s = await site({ settings: { policy: { preset: 'custom' } } });
  const headers = { ...s.same, 'cf-connecting-ip': '198.51.100.241' };
  for (let i = 0; i < 61; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, headers)).status, 200);
  const saved = await s.post('/api/player/saves/owl-run', { set: [{ key: 'checkpoint', value: 1, base: 0 }] }, headers);
  assert.equal(saved.status, 200, await saved.text());
  s.stripe.close();
});

test('statement CLI mints one key, renews it, reports progress and drops it once', async () => {
  const { shopStatements } = await import('../lib/shop.mjs');
  const dir = studio('statement-cli-key');
  const callsFile = join(dir, 'wrangler-calls.jsonl');
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  const fake = join(dir, 'node_modules', '.bin', 'wrangler');
  writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(fake, 0o755);
  const originalFetch = globalThis.fetch, originalNow = Date.now, originalError = console.error;
  let now = originalNow(), pages = 0;
  const progress = [], keys = new Set();
  try {
    Date.now = () => now;
    console.error = (s) => progress.push(s);
    globalThis.fetch = async (url, init) => {
      keys.add(init.headers.authorization);
      pages++;
      if (pages === 1) now += 9.5 * 60000;
      return Response.json({ ok: true, period: '2026-10', sent: [{ via: 'friends.example', ok: pages !== 2, status: pages === 2 ? 500 : 200 }], nextCursor: pages < 3 ? 'resume' : null });
    };
    const result = await shopStatements(dir, { url: 'http://127.0.0.1:8787', send: true });
    assert.equal(result.ok, true);
    assert.equal(pages, 3);
    assert.equal(keys.size, 1);
    assert.ok(progress.some((s) => /resume safely/.test(s)));
    assert.ok(progress.some((s) => /friends.example: failed: 500/.test(s)));
    const commands = readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse).map((args) => args.at(-1));
    assert.equal(commands.filter((s) => s.includes('INSERT INTO stats_keys')).length, 1);
    assert.equal(commands.filter((s) => s.startsWith('UPDATE stats_keys')).length, 1);
    assert.equal(commands.filter((s) => s.startsWith('DELETE FROM stats_keys WHERE hash')).length, 1);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; console.error = originalError; }
});

// Unresolved orders whose original checkout window has passed; no fake passage of only expires_at.
function unresolved(s, p, count, { status = 'processing', amount = 200, age = DAY } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = `ord_${String(i).padStart(20, '0')}`, session = `cs_test_pending_${i}`;
    const created = Date.now() - age;
    s.DB.sql.prepare("INSERT INTO shop_orders (id, player, item, amount, currency, till, mode, status, session, created_at, updated_at, expires_at) VALUES (?, ?, 'tip', ?, 'usd', 'stripe', 'test', ?, ?, ?, 1, ?)").run(id, p.id, amount, status, session, created, created + 1860000);
    s.DB.sql.prepare("INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount) VALUES (?, ?, 0, 'tip', 1, ?, ?)").run(id + '_0', id, amount, amount);
    const truth = { id: session, status: status === 'processing' ? 'complete' : 'open', payment_status: 'unpaid', livemode: false, metadata: { order: id }, client_reference_id: p.id, amount_subtotal: amount, currency: 'usd', payment_intent: { id: `pi_${i}`, status: 'processing' } };
    s.stripe.behave.sessions.set(session, truth);
    rows.push({ id, session, truth });
  }
  return rows;
}
const stripeReads = (s) => s.stripe.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/checkout/sessions/'));

test('shop reads reconcile old payments off the response path with bounded concurrent claims', async () => {
  const s = await site({ settings: { capPerPlayerMonth: null } });
  const p = s.player(400, { band: 'adult' });
  unresolved(s, p, 50);
  s.stripe.behave.delay = 10000;
  const background = [];
  const start = performance.now();
  const lists = await Promise.all(Array.from({ length: 300 }, () => s.worker.fetch(new Request('https://owls.example/api/shop', { headers: s.as(p) }), s.env, { waitUntil: (p) => background.push(p) })));
  assert.ok(lists.every((r) => r.status === 200));
  assert.ok(performance.now() - start < 5000, 'lists do not wait for slow Stripe');
  await Promise.all(background);
  assert.ok(stripeReads(s).length <= 50, 'each of the fifty rows is claimed at most once');
  assert.equal(new Set(stripeReads(s).map((c) => c.path)).size, stripeReads(s).length);
  s.stripe.close();
});

test('atomic reconciliation claims bound concurrent refusals and retries, including wrong answers', async () => {
  const { reconcileOrders } = await import('../worker/shop.mjs');
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  const s = await site({ settings: { capPerPlayerMonth: 1000, purchaseAttemptsPerMinute: 1000 } });
  const p = s.player(400, { band: 'adult' });
  const rows = unresolved(s, p, 2, { amount: 500 });
  s.stripe.behave.delay = 50;
  const results = await Promise.all(Array.from({ length: 200 }, () => s.post('/api/shop/buy', { item: 'tip', amount: 250 }, s.as(p))));
  assert.ok(results.every((r) => r.status === 403));
  assert.equal(stripeReads(s).length, 2);
  for (let i = 0; i < 10; i++) await reconcileOrders(s.env, { items: [] }, p.id);
  assert.equal(stripeReads(s).length, 2, 'minimum interval survives repeated attempts');
  assert.equal(await spentThisMonth(s.env, p.id), 1000);
  for (const row of rows) row.truth.status = 'expired';
  s.DB.sql.exec('UPDATE shop_orders SET updated_at = 1');
  const retry = await Promise.all(Array.from({ length: 200 }, () => s.post('/api/shop/buy', { item: 'tip', amount: 250 }, s.as(p))));
  const opened = retry.filter((r) => r.status === 200).length;
  assert.ok(opened >= 1 && opened <= 4, 'claim losers refuse while the one reader is still working');
  for (let i = opened; i < 4; i++) assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 250 }, s.as(p))).status, 200);
  assert.equal(stripeReads(s).length, 4);
  assert.ok(await spentThisMonth(s.env, p.id) <= 1000, 'replaced open sessions no longer reserve the cap');
  s.stripe.close();

  const q = await site({ settings: { capPerPlayerMonth: 800, purchaseAttemptsPerMinute: 1000 } });
  const person = q.player(400, { band: 'adult' });
  const four = unresolved(q, person, 4, { status: 'started' });
  four[0].truth.livemode = true;
  four[1].truth.id = 'wrong-session';
  q.stripe.behave.sessions.set(four[2].session, {});
  four[3].truth.status = 'expired';
  await reconcileOrders(q.env, { items: [] }, person.id);
  assert.equal(stripeReads(q).length, 3);
  await reconcileOrders(q.env, { items: [] }, person.id);
  assert.equal(stripeReads(q).length, 4, 'bad answers rotate; fourth row is reachable');
  q.stripe.close();
});

test('slow Stripe bounds a refused buy to two seconds in parallel and backs off', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 600, purchaseAttemptsPerMinute: 1000 } });
  const p = s.player(400, { band: 'adult' });
  unresolved(s, p, 3);
  s.stripe.behave.delay = 10000;
  const start = performance.now();
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 403);
  assert.ok(performance.now() - start < 3500, 'three reads run concurrently with a 2s timeout');
  assert.equal(stripeReads(s).length, 3);
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 200 }, s.as(p))).status, 403);
  assert.equal(stripeReads(s).length, 3);
  s.stripe.close();
});

test('resource_missing releases a session, other errors retain it, and late paid rows use Stripe charge time', async () => {
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  for (const error of [{ status: 404, code: 'resource_missing' }, { status: 404, code: 'unknown' }, { status: 401, code: 'resource_missing' }, { status: 429, code: 'rate_limit' }]) {
    const s = await site({ settings: { capPerPlayerMonth: 500 } });
    const p = s.player(400, { band: 'adult' });
    const [row] = unresolved(s, p, 1, { amount: 500 });
    s.stripe.behave.error = error;
    const missing = error.status === 404 && error.code === 'resource_missing';
    assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 500 }, s.as(p))).status, missing ? 200 : 403);
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(row.id).status, missing ? 'missing' : 'processing');
    await s.hook('checkout.session.expired', { id: row.session });
    // Stripe's own closing event is the truth for a row marked missing: the player stops seeing it as in progress.
    if (missing) assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(row.id).status, 'expired');
    s.stripe.close();
  }
  const s = await site({ settings: { capPerPlayerMonth: 500 } });
  const p = s.player(400, { band: 'adult' });
  const [row] = unresolved(s, p, 1, { amount: 500, age: 41 * DAY });
  const paidTime = Math.floor((Date.now() - 40 * DAY) / 1000);
  Object.assign(row.truth, { payment_status: 'paid', payment_intent: { id: 'pi_old', status: 'succeeded', latest_charge: { created: paidTime } } });
  assert.equal((await s.post('/api/shop/buy', { item: 'tip', amount: 500 }, s.as(p))).status, 200);
  assert.equal(s.DB.sql.prepare('SELECT paid_at FROM shop_orders WHERE id = ?').get(row.id).paid_at, paidTime * 1000);
  assert.equal(await spentThisMonth(s.env, p.id), 500, 'only the new checkout counts this month');
  await s.hook('checkout.session.completed', row.truth);
  assert.equal(s.DB.sql.prepare('SELECT paid_at FROM shop_orders WHERE id = ?').get(row.id).paid_at, paidTime * 1000);
  s.stripe.close();
});

test('office pages old unresolved orders and records an owner release; office keys only ask', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 500 } });
  const p = s.player(400, { band: 'adult' });
  const rows = unresolved(s, p, 101, { status: 'started' });
  const office = await (await s.fetchSite('/_studio/api/shop', { headers: s.owner })).json();
  assert.equal(office.orders.length, 100);
  assert.equal(office.nextOrdersCursor, '100');
  const second = await (await s.fetchSite('/_studio/api/shop?orderCursor=100', { headers: s.owner })).json();
  assert.equal(second.orders.length, 1);
  assert.equal(second.orders[0].releasable, true);
  const order = rows[0].id;
  assert.equal((await s.post('/_studio/api/shop/release', { order }, s.same)).status, 401);
  const ask = await s.post('/_studio/api/shop/release', { order }, s.key0);
  assert.equal(ask.status, 202);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order).status, 'started');
  const pending = (await ask.json()).ask;
  assert.match(pending.what, /expire an open Checkout Session/);
  const ownerAccount = s.player();
  s.DB.sql.prepare('UPDATE players SET owner = 1 WHERE id = ?').run(ownerAccount.id);
  const confirm = await s.fetchSite(`/_studio/confirm/${pending.id}`, { method: 'POST', headers: { ...s.as(ownerAccount), 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' });
  assert.match(await confirm.text(), /Done\./);
  assert.match(s.DB.sql.prepare('SELECT note FROM shop_orders WHERE id = ?').get(order).note, new RegExp(ownerAccount.id));
  assert.equal((await (await s.fetchSite('/api/shop/mine', { headers: s.as(p) })).json()).orders.length, 0);
  assert.equal((await (await s.fetchSite(`/api/shop/order?session=${rows[0].session}`, { headers: s.as(p) })).json()).status, 'started');
  // Another row exercises the direct legacy owner-session release.
  const direct = rows[1].id;

  assert.equal((await s.post('/_studio/api/shop/release', { order: direct }, s.owner)).status, 200);
  const released = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(direct);
  assert.equal(released.status, 'released');
  assert.match(released.note, /^Reservation released by owner session [a-f0-9]{64} at \d{4}-/);
  assert.ok(released.updated_at > Date.now() - 10000);
  assert.equal((await s.post('/_studio/api/shop/release', { order }, s.owner)).status, 400);
  await s.hook('checkout.session.completed', { ...rows[0].truth, payment_status: 'paid' });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order).status, 'paid');
  assert.ok(s.stripe.calls.some((c) => c.method === 'POST' && c.path === `/v1/checkout/sessions/${rows[0].session}/expire`));
  s.stripe.close();
});

test('read-only statements never allocate editions; complete schema probes run once and missing schemas retry', async () => {
  const { migrationNeeded } = await import('../worker/shop-store.mjs');
  const s = await site();
  const line = s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, created_at) VALUES (?, 'referrer.example', 100, 1, 100, 'usd', 'owed', '2026-09', 1, 1)");
  for (let i = 0; i < 280; i++) line.run(`line-${i}`);
  for (let i = 0; i < 10; i++) assert.equal((await s.fetchSite('/_studio/api/shop/statements?period=2026-09', { headers: s.key0 })).status, 200);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM referral_editions').get().n, 0);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM referral_edition_lines').get().n, 0);
  let probes = 0;
  const DB = { prepare: (...args) => { probes++; return s.DB.prepare(...args); } };
  assert.equal(await migrationNeeded({ DB }), null);
  const once = probes;
  for (let i = 0; i < 200; i++) assert.equal(await migrationNeeded({ DB }), null);
  assert.equal(probes, once);
  let missing = true, attempts = 0;
  const absent = { prepare: () => ({ first: async () => { attempts++; if (missing) throw new Error('missing'); } }) };
  assert.equal(await migrationNeeded({ DB: absent }), SHOP_MIGRATION_FILE);
  missing = false;
  assert.equal(await migrationNeeded({ DB: absent }), null);
  assert.ok(attempts > 1);
  s.stripe.close();
});

test('a purchase below the cap returns before background reconciliation; old rows back off longer', async () => {
  const { reconcileOrders } = await import('../worker/shop.mjs');
  const s = await site({ settings: { capPerPlayerMonth: 5000 } });
  const p = s.player(400, { band: 'adult' });
  unresolved(s, p, 3);
  s.stripe.behave.delay = 10000;
  const background = [];
  const start = performance.now();
  const response = await s.worker.fetch(new Request('https://owls.example/api/shop/buy', { method: 'POST', headers: s.as(p), body: JSON.stringify({ item: 'tip', amount: 200 }) }), s.env, { waitUntil: (promise) => background.push(promise) });
  assert.equal(response.status, 200);
  assert.ok(performance.now() - start < 1000, 'only the new checkout creation is awaited');
  assert.ok(background.length);
  await Promise.all(background);
  assert.equal(stripeReads(s).length, 3);
  s.stripe.behave.delay = 0;
  // Day-old rows have reached the one-hour maximum, even if last checked ten minutes ago.
  s.DB.sql.prepare("UPDATE shop_orders SET updated_at = ? WHERE status = 'processing'").run(Date.now() - 10 * 60000);
  await reconcileOrders(s.env, { items: [] }, p.id);
  assert.equal(stripeReads(s).length, 3);
  s.DB.sql.prepare("UPDATE shop_orders SET updated_at = ? WHERE status = 'processing'").run(Date.now() - 61 * 60000);
  await reconcileOrders(s.env, { items: [] }, p.id);
  assert.equal(stripeReads(s).length, 6);
  s.stripe.close();
});

test('at the cap a teen can request a parent link without reading Stripe; only parent payment reconciles', async () => {
  const s = await site({ settings: { capPerPlayerMonth: 500 } });
  const p = s.player(400, { band: 'teen' });
  const [row] = unresolved(s, p, 1, { amount: 500 });
  row.truth.status = 'expired';
  const list = await (await s.fetchSite('/api/shop', { headers: s.as(p) })).json();
  assert.equal(list.items[0].way, 'cap');
  assert.equal(list.items[0].retryWay, 'ask-a-parent');
  const link = await (await s.post('/api/shop/parent', { item: 'supporter' }, s.as(p))).json();
  assert.ok(link.link);
  assert.equal(stripeReads(s).length, 1);
  const path = new URL(link.link).pathname;
  await s.fetchSite(path);
  assert.equal(stripeReads(s).length, 1);
  const paid = await s.fetchSite(path, { method: 'POST', headers: { origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grownup=yes' });
  assert.equal(paid.status, 303);
  assert.equal(stripeReads(s).length, 1);
  s.stripe.close();
});

test('verified late payments grant once after missing, release, expiry or failure and remain refundable', async () => {
  const { spentThisMonth, shopDataOf } = await import('../worker/shop-store.mjs');
  for (const state of ['missing', 'released', 'expired', 'failed']) for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const s = await site({ settings: { capPerPlayerMonth: 500 } });
    const p = s.player(400, { band: 'adult' });
    const [row] = unresolved(s, p, 1, { amount: 500 });
    s.DB.sql.prepare("UPDATE shop_orders SET item = 'supporter' WHERE id = ?").run(row.id);
    s.DB.sql.prepare("UPDATE shop_order_lines SET item = 'supporter' WHERE order_id = ?").run(row.id);
    if (state === 'missing') {
      s.stripe.behave.error = { status: 404, code: 'resource_missing' };
      const { reconcileOrders } = await import('../worker/shop.mjs');
      await reconcileOrders(s.env, { items: [] }, p.id);
    } else if (state === 'released') {
      const owner = s.player();
      s.DB.sql.prepare('UPDATE players SET owner = 1 WHERE id = ?').run(owner.id);
      assert.equal((await s.post('/_studio/api/shop/release', { order: row.id, by: 'forged' }, s.as(owner))).status, 200);
      assert.match(s.DB.sql.prepare('SELECT note FROM shop_orders WHERE id = ?').get(row.id).note, new RegExp(owner.id));
    } else s.DB.sql.prepare('UPDATE shop_orders SET status = ? WHERE id = ?').run(state, row.id);
    assert.equal(await spentThisMonth(s.env, p.id), 0);
    if (['missing', 'released'].includes(state)) {
      const mine = await (await s.fetchSite('/api/shop/mine', { headers: s.as(p) })).json();
      assert.equal(mine.orders[0].status, 'processing');
      assert.equal('note' in mine.orders[0], false);
      assert.equal((await shopDataOf(s.env, p.id)).orders[0].status, 'processing');
      assert.equal((await (await s.fetchSite(`/api/shop/order?session=${row.session}`, { headers: s.as(p) })).json()).status, 'processing');
      const office = await (await s.fetchSite('/_studio/api/shop', { headers: s.owner })).json();
      assert.equal(office.orders[0].status, state);
      assert.ok(office.orders[0].note);
    }
    const paid = { ...row.truth, payment_intent: 'pi_late', ...(type.endsWith('completed') ? { payment_status: 'paid' } : {}) };
    const event = { id: 'evt_late_payment' };
    assert.equal((await (await s.hook(type, paid, event)).json()).did, 'paid');
    const before = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(row.id);
    const owns = await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json();
    assert.ok(owns.owns.length > 0);
    assert.equal(await spentThisMonth(s.env, p.id), 500);
    assert.equal((await (await s.hook(type, paid, event)).json()).duplicate, true);
    assert.equal((await (await s.hook(type, paid)).json()).did, 'already');
    assert.deepEqual(s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(row.id), before);
    assert.equal(await spentThisMonth(s.env, p.id), 500);
    assert.equal((await s.post('/_studio/api/shop/refund', { order: row.id }, s.owner)).status, 200);
    assert.equal(await spentThisMonth(s.env, p.id), 0);
    assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, []);
    assert.equal((await (await s.hook(type, paid)).json()).did, 'already', 'a duplicate cannot undo a refund');
    s.stripe.close();
  }
});

test('failed Stripe reads log their order and reason, retry soon, then use the successful interval', async () => {
  const { reconcileOrders } = await import('../worker/shop.mjs');
  const originalNow = Date.now, originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    for (const error of [{ status: 500, code: 'api_error' }, { status: 429, code: 'rate_limit' }, { disconnect: true }, { delay: 10000 }]) {
      const s = await site();
      const p = s.player();
      const [row] = unresolved(s, p, 1, { age: 3 * DAY });
      let now = originalNow();
      Date.now = () => now;
      s.stripe.behave.error = error.status ? error : null;
      s.stripe.behave.disconnect = error.disconnect;
      s.stripe.behave.delay = error.delay;
      await reconcileOrders(s.env, { items: [] }, p.id);
      assert.ok(warnings.some((args) => args[1]?.order === row.id && args[1]?.status === (error.status ?? 502) && args[1]?.reason));
      s.stripe.behave.error = null;
      s.stripe.behave.disconnect = false;
      s.stripe.behave.delay = 0;
      now += 30000;
      await reconcileOrders(s.env, { items: [] }, p.id);
      assert.equal(stripeReads(s).length, 1);
      now += 31000;
      await reconcileOrders(s.env, { items: [] }, p.id);
      assert.equal(stripeReads(s).length, 2);
      now += 61000;
      await reconcileOrders(s.env, { items: [] }, p.id);
      assert.equal(stripeReads(s).length, 2, 'successful read restores the hour interval');
      Date.now = originalNow;
      s.stripe.close();
    }
  } finally { Date.now = originalNow; console.warn = originalWarn; }
});

test('open default: only items and working payment setup sell a three-line cart twice to a guest from any page', async () => {
  const items = [
    { id: 'loot', kind: 'Mystery boxes', name: 'Random chance countdown hurry', badge: 'Lottery winner', blurb: 'Only one left! Spin the wheel.', price: 501, gives: ['badge:raffle', 'coins:100'] },
    { id: 'advantage', kind: 'supporter', name: 'Pay to win', advantage: true, price: 101, gives: ['power:win'], game: 'owl-run' },
    { id: 'free', kind: 'virtual currency', name: 'Free gems', price: 0, gives: ['gems:free'] },
  ];
  const s = await site({ settings: { items, policy: undefined, automaticTax: undefined, capPerPlayerMonth: undefined, refundDays: undefined, referrals: undefined } });
  let cookie = '';
  for (const page of ['/owl-run/tv', '/another-game/play']) {
    const buy = await s.post('/api/shop/buy', { game: 'another-game', lines: [{ item: 'loot', quantity: 2 }, { item: 'advantage', quantity: 3 }, { item: 'free', quantity: 4 }] }, { ...s.same, cookie, referer: `https://owls.example${page}` });
    assert.equal(buy.status, 200, await buy.clone().text());
    cookie ||= buy.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie);
    const { order } = await buy.json();
    const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(order);
    assert.equal(row.amount, 1305);
    const form = s.stripe.calls.at(-1).form;
    assert.equal(form.get('line_items[0][quantity]'), '2');
    assert.equal(form.get('line_items[1][quantity]'), '3');
    assert.equal(form.get('line_items[2][price_data][unit_amount]'), '0');
    assert.equal(form.has('automatic_tax[enabled]'), false);
    assert.doesNotMatch(form.get('custom_text[submit][message]'), /ends the 14-day/);
    const truth = s.stripe.behave.sessions.get(row.session);
    Object.assign(truth, { payment_status: 'paid', amount_total: 1305, payment_intent: 'pi_' + order, created: Math.floor(Date.now() / 1000) });
    const paid = await (await s.fetchSite('/api/shop/order?session=' + row.session, { headers: { cookie } })).json();
    assert.equal(paid.status, 'paid');
    assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_order_lines WHERE order_id = ? AND status = ?').get(order, 'paid').n, 3);
  }
  const guest = s.DB.sql.prepare('SELECT * FROM players').get();
  assert.equal(guest.guest, 1);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM player_age').get().n, 0);
  const owns = await (await s.fetchSite('/api/player/owns', { headers: { cookie } })).json();
  assert.equal(owns.detail.find((x) => x.key === 'coins:100').quantity, 4);
  const { adoptShopStatements, shopDataOf } = await import('../worker/shop-store.mjs');
  const account = s.player();
  await s.DB.batch(await adoptShopStatements(s.env, guest.id, account.id));
  assert.equal((await shopDataOf(s.env, account.id)).orders.length, 2);
  assert.equal((await shopDataOf(s.env, account.id)).owns.length, 4);
  s.stripe.close();
});

test('default policy cannot refuse valid purchases for age, ownership, wording, server or page', () => {
  const words = ['chance', 'odds', 'random', 'crate', 'box', 'loot', 'gacha', 'lottery', 'countdown', 'hurry', 'coins', 'currency', 'supporter'];
  for (const preset of [undefined, 'protective', 'adults-only']) for (const word of words) {
    assert.equal(checkShop({ policy: preset ? { preset } : undefined, items: [{ id: word, name: word, kind: word, badge: word, description: word, gives: [word + ':100'], advantage: true, price: 1 }] }).ok, true);
  }
  const policy = checkShop({ items: [SUPPORTER] }).shop.policy;
  for (const player of [null, { guest: true }, { guest: false }]) for (const band of [null, 'child', 'teen', 'adult']) for (const owned of [true, false]) for (const kids of [true, false]) for (const beginner of [true, false]) {
    assert.equal(wayFor({ ...SUPPORTER, advantage: true }, { player, band, owned, kids, beginner, policy }), 'checkout');
  }
  assert.equal(checkShop({ items: [SUPPORTER] }, { audience: 'kids' }).shop.open, true);
  assert.equal(policy.televisionCheckout, true);
  assert.equal(policy.withdrawalAcknowledgement, false);
});

test('each named preset applies only when chosen', async () => {
  for (const preset of ['protective', 'adults-only']) {
    const s = await site({ settings: { policy: { preset } } });
    const guest = await s.post('/api/shop/buy', { item: 'supporter' }, s.same);
    assert.equal((await guest.json()).way, 'make-an-account');
    const teen = s.player(10, { band: 'teen' });
    assert.equal((await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(teen))).json()).way, preset === 'protective' ? 'ask-a-parent' : 'no');
    const adult = s.player(10, { band: 'adult' });
    assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(adult))).status, 200);
    s.stripe.close();
  }
});

test('cart grants roll back with payment, snapshots survive edits, each line refunds independently, tips stay given', async () => {
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, refundDays: 10000, items: [
    { id: 'a', name: 'A', kind: 'skin', price: 101, gives: ['same:key'] },
    { id: 'b', name: 'B', kind: 'skin', price: 103, gives: ['same:key'] },
    { id: 'tip', name: 'Tip', kind: 'tip', price: 'choose' },
  ] } });
  const p = s.player();
  const buy = await (await s.post('/api/shop/buy', { lines: [{ item: 'a', quantity: 2 }, { item: 'b' }, { item: 'tip', amount: 200 }] }, s.as(p))).json();
  const o = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(buy.order);
  const truth = { ...s.stripe.behave.sessions.get(o.session), payment_status: 'paid', payment_intent: 'pi_cart', amount_total: 505 };
  const originalBatch = s.DB.batch;
  s.DB.batch = (writes) => originalBatch([...writes, s.DB.prepare('INSERT INTO nonexistent VALUES (1)')]);
  assert.equal((await s.hook('checkout.session.completed', truth)).status, 503);
  assert.equal(s.DB.sql.prepare('SELECT paid_at FROM shop_orders WHERE id = ?').get(o.id).paid_at, null);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM entitlements').get().n, 0);
  s.DB.batch = originalBatch;
  const oldAssets = s.env.ASSETS;
  s.env.ASSETS = { fetch: async (req) => new URL(req.url).pathname === '/games.json' ? Response.json({ studio: { name: 'Changed' }, shop: { till: 'off', items: [] } }) : oldAssets.fetch(req) };
  assert.equal((await (await s.hook('checkout.session.completed', truth)).json()).did, 'paid');
  assert.equal((await (await s.hook('checkout.session.completed', truth)).json()).did, 'already');
  s.env.ASSETS = oldAssets;
  assert.equal(s.DB.sql.prepare('SELECT SUM(quantity) AS n FROM shop_entitlement_lines').get().n, 3);
  await s.post('/api/shop/used', { key: 'same:key' }, s.as(p));
  assert.equal((await s.post('/api/shop/refund', { order: o.id, line: o.id + '_0' }, s.as(p))).status, 200, 'used items refundable by open policy');
  assert.equal(s.DB.sql.prepare("SELECT SUM(quantity) AS n FROM shop_entitlement_lines WHERE state = 'active'").get().n, 1);
  assert.equal((await s.post('/api/shop/refund', { order: o.id, line: o.id + '_2' }, s.as(p))).status, 403);
  assert.equal((await s.post('/api/shop/refund', { order: o.id }, s.as(p))).status, 403, 'whole order cannot bypass tip rule');
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id, line: o.id + '_2' }, s.owner)).status, 200);
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id }, s.owner)).status, 200);
  assert.deepEqual(s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST').map((c) => c.form.get('amount')), ['202', '200', null]);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(o.id).status, 'refunded');
  s.stripe.close();
});

test('cart caps reserve exact totals concurrently; partial refunds release only their line; referral allocation is exact', async () => {
  const { referralShare } = await import('../worker/shop-rules.mjs');
  assert.equal(referralShare(50, 0.29), 15, 'decimal multiplication rounds exactly');
  const s = await site({ settings: { policy: undefined, automaticTax: false, purchaseAttemptsPerMinute: 100, capPerPlayerMonth: 1206, items: [
    { id: 'a', name: 'A', price: 101 }, { id: 'b', name: 'B', price: 200 }, { id: 'c', name: 'C', price: 0 },
  ], referrals: { rate: 0.29 } } });
  const p = s.player();
  const cart = { lines: [{ item: 'a', quantity: 2 }, { item: 'b' }, { item: 'c' }] };
  const responses = await Promise.all(Array.from({ length: 8 }, () => s.post('/api/shop/buy', cart, s.as(p))));
  assert.equal(responses.filter((r) => r.status === 200).length, 3);
  const orders = s.DB.sql.prepare('SELECT * FROM shop_orders').all();
  assert.equal(orders.reduce((n, o) => n + o.amount, 0), 1206);
  const o = orders[0];
  s.DB.sql.prepare("UPDATE shop_orders SET via = 'friends.example' WHERE id = ?").run(o.id);
  const truth = { ...s.stripe.behave.sessions.get(o.session), payment_status: 'paid', payment_intent: 'pi_exact', amount_total: 402 };
  await Promise.all([s.hook('checkout.session.completed', truth), s.hook('checkout.session.async_payment_succeeded', truth)]);
  assert.equal(s.DB.sql.prepare('SELECT share FROM referral_lines WHERE order_id = ?').get(o.id).share, 117);
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id, line: o.id + '_0' }, s.owner)).status, 200);
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  assert.equal(await spentThisMonth(s.env, p.id), 1004);
  assert.equal(s.DB.sql.prepare('SELECT share FROM referral_lines WHERE order_id = ?').get(o.id).share, 58);
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id }, s.owner)).status, 200);
  assert.equal(s.DB.sql.prepare('SELECT share FROM referral_lines WHERE order_id = ?').get(o.id).share, 0);
  s.stripe.close();
});

test('Stripe tax totals stay with their lines and pending refunds wait for verified success', async () => {
  const s = await site({ settings: { policy: undefined, automaticTax: true, capPerPlayerMonth: null, items: [
    { id: 'a', name: 'A', price: 500, gives: ['a'] }, { id: 'b', name: 'B', price: 100, gives: ['b'] }, { id: 'c', name: 'C', price: 0, gives: ['c'] },
  ] } });
  const p = s.player();
  const { order } = await (await s.post('/api/shop/buy', { lines: [{ item: 'a' }, { item: 'b', quantity: 2 }, { item: 'c' }] }, s.as(p))).json();
  const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(order);
  s.stripe.behave.lineItems = [
    { quantity: 2, amount_subtotal: 200, amount_total: 210, price: { product: { metadata: { line: order + '_1' } } } },
    { quantity: 1, amount_subtotal: 0, amount_total: 0, price: { product: { metadata: { line: order + '_2' } } } },
    { quantity: 1, amount_subtotal: 500, amount_total: 550, price: { product: { metadata: { line: order + '_0' } } } },
  ];
  assert.equal((await (await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(row.session), payment_status: 'paid', amount_total: 760, total_details: { amount_tax: 60 }, payment_intent: 'pi_tax_cart' })).json()).did, 'paid');
  s.stripe.behave.refundStatus = 'pending';
  assert.equal((await s.post('/_studio/api/shop/refund', { order, line: order + '_1' }, s.owner)).status, 202);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_order_lines WHERE id = ?').get(order + '_1').status, 'paid');
  assert.equal(s.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/refunds').at(-1).form.get('amount'), '210');
  await s.hook('refund.updated', { id: [...s.stripe.behave.refunds.keys()][0], payment_intent: 'pi_tax_cart', status: 'succeeded', amount: 210, metadata: { order, line: order + '_1' } });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_order_lines WHERE id = ?').get(order + '_1').status, 'refunded');
  assert.deepEqual(s.DB.sql.prepare("SELECT key FROM entitlements WHERE state = 'active' ORDER BY key").all().map((r) => r.key), ['a', 'c']);
  const totals = await (await s.fetchSite('/_studio/api/shop', { headers: s.owner })).json();
  assert.equal(totals.totals.paid, 500);
  assert.equal(totals.totals.refunded, 200);
  assert.equal((await s.post('/_studio/api/shop/refund', { order, line: order + '_2' }, s.owner)).status, 200);
  await s.hook('charge.refunded', { payment_intent: 'pi_tax_cart', amount_refunded: 210 });
  assert.deepEqual(s.DB.sql.prepare("SELECT key FROM entitlements WHERE state = 'active' ORDER BY key").all().map((r) => r.key), ['a']);
  s.stripe.close();
});

test('missing line schema names its step and old order rows become one line', async () => {
  const { SHOP_MIGRATION, SHOP_RESERVATIONS, SHOP_STATEMENTS, SHOP_LINES, migrationNeeded } = await import('../worker/shop-store.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(SHOP_MIGRATION + SHOP_RESERVATIONS + SHOP_STATEMENTS);
  const DB = { prepare: (q) => ({ first: async () => db.prepare(q).get() }) };
  assert.equal(await migrationNeeded({ DB }), '0012_shop_lines.sql');
  db.prepare("INSERT INTO shop_orders (id, player, item, amount, currency, till, mode, status, created_at, updated_at) VALUES ('ord_old', 'buyer', 'skin', 501, 'usd', 'stripe', 'test', 'paid', 1, 1)").run();
  db.exec(SHOP_LINES);
  assert.equal(await migrationNeeded({ DB }), null);
  const line = db.prepare('SELECT * FROM shop_order_lines').get();
  assert.equal(line.order_id, 'ord_old');
  assert.equal(line.quantity, 1);
  assert.equal(line.amount, 501);
  db.close();
});

test('an optional parent step also checks out a cart and a fixed-price tip stays a tip', async () => {
  const s = await site({ settings: { policy: { preset: 'protective' }, referralNewPlayersOnly: false, referrals: { rate: 0.1 }, items: [SUPPORTER,
    { id: 'tip', kind: 'tip', name: 'Fixed gift', price: 200 }, { id: 'free', name: 'Free', price: 0, gives: ['free'] },
  ] } });
  const teen = s.player(20, { band: 'teen' });
  const { arrivalCookie } = await import('../worker/referrals.mjs');
  const arrivalUrl = new URL('https://owls.example/?via=friends.example');
  const cookie = await arrivalCookie(new Request(arrivalUrl, { headers: { 'user-agent': BROWSER, accept: 'text/html' } }), s.env, arrivalUrl, { open: true, referrals: { windowDays: null } });
  teen.cookie += '; ' + cookie.split(';')[0];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith('https://friends.example/') ? Response.json({ kind: 'homie-studio', referrals: { accepts: true, statements: 'https://friends.example/api/referrals/statement' } }) : originalFetch(url, init);
  let link;
  try { link = await (await s.post('/api/shop/parent', { lines: [{ item: 'supporter' }, { item: 'tip' }, { item: 'free' }] }, s.as(teen))).json(); } finally { globalThis.fetch = originalFetch; }
  assert.ok(link.link);
  const response = await s.fetchSite(new URL(link.link).pathname, { method: 'POST', headers: { origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grownup=yes' });
  assert.equal(response.status, 303);
  const form = s.stripe.calls.at(-1).form;
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '500');
  assert.equal(form.get('line_items[1][price_data][unit_amount]'), '200');
  assert.equal(form.get('metadata[via]'), 'friends.example');
  assert.equal(form.get('line_items[2][price_data][unit_amount]'), '0');
  s.stripe.close();
});

test('default shop accepts a configured preview and has no unwritten referral rate or fixed tip price restriction', async () => {
  assert.equal(checkShop({ referrals: {}, items: [{ id: 'tip', kind: 'tip', name: 'Tip', price: 100 }] }).shop.referrals.rate, 0);
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: undefined, items: [{ id: 'tip', kind: 'tip', name: 'Tip', price: 100 }] } });
  s.env.HOMIE_PREVIEW = '1';
  assert.equal((await s.post('/api/shop/buy', { item: 'tip' }, s.same)).status, 200);
  s.stripe.close();
});


test('failed Stripe refunds can be retried without repeating a pending refund', async () => {
  const s = await site({ settings: { policy: undefined, automaticTax: false } });
  const p = s.player();
  const { order } = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(order);
  const checkout = s.stripe.calls.find((c) => c.path === '/v1/checkout/sessions');
  assert.ok(Number(checkout.form.get('expires_at')) >= Math.floor(row.created_at / 1000) + 86400);
  assert.equal(row.expires_at, Number(checkout.form.get('expires_at')) * 1000);
  await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(row.session), payment_status: 'paid', amount_total: 500, payment_intent: 'pi_retry_refund' });
  s.stripe.behave.refundStatus = 'pending';
  assert.equal((await s.post('/_studio/api/shop/refund', { order }, s.owner)).status, 202);
  assert.equal((await s.post('/_studio/api/shop/refund', { order }, s.owner)).status, 202);
  assert.equal(s.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/refunds').length, 1);
  s.stripe.behave.existingRefundStatus = 'failed';
  s.stripe.behave.refundStatus = 'succeeded';
  assert.equal((await s.post('/_studio/api/shop/refund', { order }, s.owner)).status, 200);
  const calls = s.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/refunds');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].idem, calls[1].idem);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order).status, 'refunded');
  s.stripe.close();
});

// The released code a studio upgrades from: the newest release tag, and 0.32.1 and 0.33.0 by name (the two releases
// before the additive step 0012), each when this checkout has its tag. A checkout without tags (a shallow clone,
// a source archive) has no released code to build, so the test is skipped and says why; CI's Packages job checks
// out with tags (fetch-depth: 0), so it runs there.
const ROLLING_REPO = join(PKG, '..', '..');
const RELEASE_TAG = /^release-\d{4}-\d\d-\d\d-studio-(\d+)\.(\d+)\.(\d+)$/;
const releaseTags = (() => {
  const r = spawnSync('git', ['tag', '--list', 'release-*-studio-*'], { cwd: ROLLING_REPO, encoding: 'utf8' });
  const inRepo = spawnSync('git', ['rev-parse', '--show-cdup'], { cwd: ROLLING_REPO, encoding: 'utf8' });
  if (r.status !== 0 || inRepo.status !== 0 || inRepo.stdout.trim()) return [];
  const version = (t) => RELEASE_TAG.exec(t).slice(1).map(Number);
  // Newest version first; of two tags for one version, the later date.
  // Only releases older than this checkout's own version are code to upgrade FROM: on the commit a release is tagged
  // at, its own tag is this very code.
  const own = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version.split('.').map(Number);
  const older = (t) => { const v = version(t); return v[0] - own[0] || v[1] - own[1] || v[2] - own[2]; };
  return r.stdout.split('\n').map((t) => t.trim()).filter((t) => RELEASE_TAG.test(t) && older(t) < 0)
    .sort((x, y) => { const a = version(x), b = version(y); return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || (x < y ? 1 : -1); });
})();
const rollingFrom = [...new Set([releaseTags[0], ...['0.33.0', '0.32.1'].map((v) => releaseTags.find((t) => t.endsWith(`-studio-${v}`)))].filter(Boolean))];
const ROLLING = 'rolling schema upgrade: released checkout, payment and refund; new code before and after the additive step';
if (!rollingFrom.length) test(ROLLING, { skip: 'this checkout has no release-*-studio-* tag, so there is no released code to upgrade from (fetch the tags: git fetch --tags; in CI, actions/checkout with fetch-depth: 0)' }, () => {});
for (const tag of rollingFrom) test(`${ROLLING} (from ${tag})`, async () => {
  // Build the real release, not a copied reconstruction of its SQL or grant path.
  const repo = ROLLING_REPO;
  const released = join(scratch, `released-${tag}`);
  mkdirSync(released);
  const archive = spawnSync('git', ['archive', tag], { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(archive.status, 0);
  assert.equal(spawnSync('tar', ['-x', '-C', released], { input: archive.stdout }).status, 0);
  symlinkSync(REPO_NM, join(released, 'node_modules'), 'dir');
  const build = spawnSync('npm', ['run', 'build'], { cwd: released, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1536' } });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const { default: old } = await import(join(released, 'packages/studio/worker/index.mjs'));
  const releasedStore = await import(join(released, 'packages/studio/worker/shop-store.mjs'));
  const s = await site();
  const p = s.player(400, { band: 'adult' });
  const oldFetch = (path, init) => old.fetch(new Request('https://owls.example' + path, init), s.env, { waitUntil() {} });
  const oldBuy = async () => {
    const r = await oldFetch('/api/shop/buy', { method: 'POST', headers: s.as(p), body: JSON.stringify({ item: 'supporter' }) });
    assert.equal(r.status, 200, await r.clone().text());
    return s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get((await r.json()).order);
  };
  const truth = (o) => ({ id: o.session, payment_status: 'paid', payment_intent: 'pi_' + o.id, client_reference_id: p.id, metadata: { order: o.id, item: o.item }, currency: 'usd', amount_subtotal: o.amount, amount_total: o.amount });
  const oldPaid = async (o) => {
    const payload = JSON.stringify({ id: 'evt_old_' + o.id, type: 'checkout.session.completed', livemode: false, data: { object: truth(o) } });
    const t = Math.floor(Date.now() / 1000);
    const r = await oldFetch('/api/shop/hook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${await signPayload(payload, HOOK_SECRET, t)}` }, body: payload });
    assert.equal(r.status, 200, await r.clone().text());
  };
  // E: the released code opens and grants after the step. Its original primary key still works.
  let o = await oldBuy();
  await oldPaid(o);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE order_id = ?').get(o.id).n, 2);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(o.id).status, 'paid');
  assert.equal((await s.hook('checkout.session.completed', truth(o))).status, 200);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_order_lines WHERE order_id = ?').get(o.id).n, 1);
  const oldRefund = await oldFetch('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: o.id }) });
  assert.equal(oldRefund.status, 200, await oldRefund.clone().text());
  // F: older releases have no line rows; releases with the additive schema already create one.
  o = await oldBuy();
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_order_lines WHERE order_id = ?').get(o.id).n, releasedStore.SHOP_LINES_FILE ? 1 : 0);
  assert.equal((await s.hook('checkout.session.completed', truth(o))).status, 200);
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id }, s.owner)).status, 200);
  // Repair a paid legacy order missing its entitlement, and prove duplicate delivery cannot add it twice.
  const fixed = await s.buyPaid(p, 'supporter');
  s.DB.sql.prepare('DELETE FROM entitlements WHERE order_id = ?').run(fixed.order);
  const repair = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(fixed.order);
  for (let i = 0; i < 3; i++) await s.hook('checkout.session.completed', { ...truth(repair), amount_total: 540, total_details: { amount_tax: 40 } });
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE order_id = ?').get(repair.id).n, 2);
  assert.equal((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).detail[0].quantity, 1);
  // Roll back after a new cart: the released whole-order refund revokes every line's ownership.
  const cartBuyer = s.player(400, { band: 'adult' });
  const cart = await (await s.post('/api/shop/buy', { lines: [{ item: 'supporter' }, { item: 'ember' }, { item: 'boost' }] }, s.as(cartBuyer))).json();
  const cartRow = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(cart.order);
  await s.hook('checkout.session.completed', { ...truth(cartRow), client_reference_id: cartBuyer.id });
  assert.equal((await oldFetch('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: cart.order }) })).status, 200);
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(cartBuyer) })).json()).owns, []);
  // New code first: old schema keeps ownership and office refunds, but refuses new sales by named step.
  const before = await site();
  const buyer = before.player(400, { band: 'adult' });
  const purchase = await before.buyPaid(buyer);
  before.DB.sql.exec('DROP INDEX shop_orders_attention; DROP INDEX shop_orders_attention_player; ALTER TABLE shop_orders DROP COLUMN attention; ALTER TABLE shop_orders DROP COLUMN refunded_amount; ALTER TABLE shop_orders DROP COLUMN refunded_net; ALTER TABLE shop_orders DROP COLUMN refund_revision; DROP TRIGGER IF EXISTS shop_checkout_player_insert; DROP TRIGGER shop_entitlements_delete; DROP TRIGGER shop_entitlements_adopt; DROP TRIGGER shop_forget_checkout_player; DROP TABLE shop_entitlement_lines; DROP TABLE shop_order_lines; ALTER TABLE shop_orders DROP COLUMN whole_refund; ALTER TABLE shop_orders DROP COLUMN checkout_player; ALTER TABLE shop_orders DROP COLUMN referral_terms; ALTER TABLE shop_parent_links DROP COLUMN cart; ALTER TABLE referral_lines DROP COLUMN original_share;');
  before.env.DB = { ...before.DB };
  const list = await (await before.fetchSite('/api/shop', { headers: before.as(buyer) })).json();
  assert.equal(list.open, false); assert.equal(list.migration, SHOP_LINES_FILE);
  assert.equal((await (await before.fetchSite('/api/player/owns', { headers: before.as(buyer) })).json()).owns.length, 2);
  assert.equal((await (await before.fetchSite('/api/shop/mine', { headers: before.as(buyer) })).json()).orders.length, 1);
  assert.equal((await before.post('/api/shop/buy', { item: 'supporter' }, before.as(buyer))).status, 503);
  assert.equal((await before.post('/_studio/api/shop/refund', { order: purchase.order }, before.owner)).status, 200);
  assert.equal(before.DB.sql.prepare('SELECT state FROM entitlements LIMIT 1').get().state, 'revoked');
  before.DB.sql.exec(readFileSync(join(repo, 'template/site/migrations', SHOP_LINES_FILE), 'utf8'));
  assert.equal((await (await before.fetchSite('/api/player/owns', { headers: before.as(buyer) })).json()).owns.length, 0);
  s.stripe.close(); before.stripe.close();
});

test('working setup, unseen paid orders, cancellation, free carts and redacted Stripe errors', async () => {
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null, items: [SUPPORTER, { id: 'free', name: 'Free', price: 0, gives: ['free'] }] } });
  const p = s.player(400);
  delete s.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await (await s.fetchSite('/api/shop')).json()).missing.includes('webhook-secret'), true);
  assert.equal((await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).status, 503);
  assert.equal(s.stripe.calls.length, 0);
  s.env.STRIPE_WEBHOOK_SECRET = HOOK_SECRET;
  const buy = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(buy.order);
  Object.assign(s.stripe.behave.sessions.get(row.session), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_unseen', created: Math.floor(Date.now() / 1000) - 120 });
  s.DB.sql.prepare('UPDATE shop_orders SET created_at = ?, updated_at = 1 WHERE id = ?').run(Date.now() - 120000, row.id);
  await s.fetchSite('/api/player/owns', { headers: s.as(p) });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(row.id).status, 'paid');
  assert.equal((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).detail[0].quantity, 1);
  const abandoned = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  await s.fetchSite('/shop/?cancelled=1&order=' + abandoned.order, { headers: s.as(p) });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(abandoned.order).status, 'expired');
  const pending = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const pendingRow = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(pending.order);
  Object.assign(s.stripe.behave.sessions.get(pendingRow.session), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_scheduled', created: Math.floor(Date.now() / 1000) - 120 });
  s.DB.sql.prepare('UPDATE shop_orders SET created_at = ?, updated_at = 1 WHERE id = ?').run(Date.now() - 120000, pending.order);
  const scheduled = [];
  await s.worker.scheduled({}, s.env, { waitUntil: (p) => scheduled.push(p) });
  await Promise.all(scheduled);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(pending.order).status, 'paid');
  const calls = s.stripe.calls.length;
  const free = await (await s.post('/api/shop/buy', { lines: [{ item: 'free', quantity: 4 }] }, s.as(p))).json();
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(free.order).status, 'paid');
  assert.equal(s.stripe.calls.length, calls);
  const { StripeError, redactStripe } = await import('../worker/stripe.mjs');
  const secret = ['cs', 'test', 'example', 'secret', 'sensitive'].join('_');
  const error = new StripeError(502, { error: { message: `${TEST_KEY} ${HOOK_SECRET} ${secret}`, code: secret, param: TEST_KEY } });
  for (const value of [error.message, error.code, error.param, redactStripe(error.message, s.env)]) {
    for (const key of [TEST_KEY, HOOK_SECRET, secret]) assert.ok(!value.includes(key));
  }
  s.stripe.behave.createError = { message: `${TEST_KEY} ${HOOK_SECRET} ${secret}`, code: TEST_KEY };
  const refused = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p));
  assert.equal(refused.status, 502);
  const words = await refused.text();
  for (const key of [TEST_KEY, HOOK_SECRET, secret]) assert.ok(!words.includes(key));
  const note = s.DB.sql.prepare("SELECT note FROM shop_orders WHERE status = 'failed'").get().note;
  assert.ok(!note.includes(TEST_KEY));
  s.stripe.close();
});

test('early and partial Dashboard refunds converge, large carts refund in one call, and missing legacy items remain refundable', async () => {
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null, automaticTax: false, purchaseAttemptsPerMinute: 1000, items: [{ id: 'a', name: 'A', price: 100, gives: ['key:a'] }] } });
  const p = s.player();
  const opened = await (await s.post('/api/shop/buy', { lines: Array.from({ length: 100 }, () => ({ item: 'a' })) }, s.as(p))).json();
  const o = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(opened.order);
  s.stripe.behave.payments.set('pi_early', { amount: 10000, metadata: { order: o.id } });
  const early = { payment_intent: 'pi_early', amount: 10000, amount_refunded: 50 };
  assert.equal((await s.hook('charge.refunded', early, { id: 'evt_early' })).status, 503);
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_events WHERE id = ?').get('evt_early').n, 0);
  const truth = { ...s.stripe.behave.sessions.get(o.session), payment_status: 'paid', payment_intent: 'pi_early', amount_total: 10000 };
  await s.hook('checkout.session.completed', truth);
  s.DB.sql.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, original_share, currency, state, period, hold_until, created_at) VALUES (?, 'ref.example', 10000, 0.1, 1000, 1000, 'usd', 'pending', '2026-10', 1, 1)").run(o.id);
  assert.equal((await s.hook('charge.refunded', early, { id: 'evt_early' })).status, 200);
  await s.hook('charge.refunded', early);
  assert.equal(await spentThisMonth(s.env, p.id), 9950);
  assert.equal(s.DB.sql.prepare('SELECT share FROM referral_lines WHERE order_id = ?').get(o.id).share, 995);
  const count = s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST').length;
  assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id }, s.owner)).status, 200);
  assert.equal(s.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST').length - count, 1);
  assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM shop_order_lines WHERE status = 'refunded'").get().n, 100);
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, []);
  await s.hook('charge.dispute.closed', { payment_intent: 'pi_early', status: 'lost' });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(o.id).status, 'refunded');
  const disputeBuy = await (await s.post('/api/shop/buy', { lines: [{ item: 'a' }, { item: 'a' }] }, s.as(p))).json();
  const disputedRow = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(disputeBuy.order);
  await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(disputedRow.session), payment_status: 'paid', payment_intent: 'pi_dispute_lines', amount_total: 200 });
  await s.hook('charge.refunded', { payment_intent: 'pi_dispute_lines', amount: 200, amount_refunded: 100 });
  await s.hook('charge.dispute.created', { payment_intent: 'pi_dispute_lines', id: 'dp_lines' });
  await s.hook('charge.dispute.closed', { payment_intent: 'pi_dispute_lines', status: 'lost' });
  const { orderLines } = await import('../worker/shop-store.mjs');
  assert.deepEqual((await orderLines(s.env, disputedRow.id)).map((l) => l.status), ['lost', 'lost']);
  const missing = await (await s.post('/api/shop/buy', { item: 'a' }, s.as(p))).json();
  const missingRow = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(missing.order);
  s.DB.sql.prepare("UPDATE shop_orders SET item = 'removed' WHERE id = ?").run(missing.order);
  s.DB.sql.prepare('DELETE FROM shop_order_lines WHERE order_id = ?').run(missing.order);
  const paid = { ...s.stripe.behave.sessions.get(missingRow.session), payment_status: 'paid', payment_intent: 'pi_removed', amount_total: 100 };
  const response = await s.hook('checkout.session.completed', paid);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'missing-item');
  assert.match(s.DB.sql.prepare('SELECT note FROM shop_orders WHERE id = ?').get(missing.order).note, /missing-item/);
  assert.equal((await s.post('/_studio/api/shop/refund', { order: missing.order }, s.owner)).status, 200);
  for (const minutes of [30, 31, 1440]) assert.equal(checkShop({ items: [SUPPORTER], checkoutMinutes: minutes }).shop.checkoutMinutes, minutes);
  for (const minutes of [29, 1441]) assert.equal(checkShop({ items: [SUPPORTER], checkoutMinutes: minutes }).ok, false);
  s.stripe.close();
});

test('Hat and Cape refunds use Stripe IDs in every event order, including pending failure and Dashboard refunds', async () => {
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, refundDays: 14, purchaseAttemptsPerMinute: 1000, items: [
    { id: 'hat', name: 'Hat', price: 300, gives: ['hat'] }, { id: 'cape', name: 'Cape', price: 999, gives: ['cape'] },
  ] } });
  for (const scenario of ['before', 'created-before', 'after', 'duplicate', 'pending-success', 'pending-failure', 'succeeded-failure', 'player-before', 'dashboard']) {
    const p = s.player();
    const purchase = await (await s.post('/api/shop/buy', { lines: [{ item: 'hat' }, { item: 'cape' }] }, s.as(p))).json();
    const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(purchase.order);
    const payment = 'pi_' + scenario.replaceAll('-', '_');
    await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(row.session), payment_status: 'paid', payment_intent: payment, amount_total: 1299 });
    const books = async (amount, lineAmounts, owned) => {
      const order = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(row.id);
      const stripeTotal = [...s.stripe.behave.refunds.values()].filter((r) => r.payment_intent === payment && r.status === 'succeeded').reduce((n, r) => n + r.amount, 0);
      assert.equal(order.refunded_amount, stripeTotal, scenario);
      assert.equal(order.refunded_amount, amount, scenario);
      assert.equal(order.status, amount === 1299 ? 'refunded' : 'paid', scenario);
      assert.deepEqual(s.DB.sql.prepare('SELECT refunded_amount FROM shop_order_lines WHERE order_id = ? ORDER BY position').all(row.id).map((l) => l.refunded_amount), lineAmounts, scenario);
      assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns.sort(), owned.sort(), scenario);
    };
    if (scenario === 'dashboard') {
      await s.hook('refund.created', { id: 're_dashboard_partial', payment_intent: payment, amount: 999, status: 'succeeded', metadata: {} });
      await books(999, [0, 0], ['hat', 'cape']);
      await s.hook('refund.created', { id: 're_dashboard_full', payment_intent: payment, amount: 300, status: 'succeeded', metadata: {} });
      await books(1299, [300, 999], []);
      continue;
    }
    s.stripe.behave.refundStatus = scenario.startsWith('pending') ? 'pending' : 'succeeded';
    const event = async () => scenario === 'created-before' ? s.hook('refund.created', [...s.stripe.behave.refunds.values()].find((r) => r.payment_intent === payment)) : s.hook('charge.refunded', { payment_intent: payment, amount_refunded: 999 }, { id: 'evt_charge_' + scenario });
    s.stripe.behave.onRefund = scenario.endsWith('before') ? async () => { assert.equal((await event()).status, 200); await books(999, [0, 999], ['hat']); } : null;
    const result = await s.post(scenario === 'player-before' ? '/api/shop/refund' : '/_studio/api/shop/refund', { order: row.id, line: row.id + '_1' }, scenario === 'player-before' ? s.as(p) : s.owner);
    assert.equal(result.status, scenario.startsWith('pending') ? 202 : 200, await result.clone().text());
    await event();
    if (scenario === 'duplicate') await event();
    const refund = [...s.stripe.behave.refunds.values()].find((r) => r.payment_intent === payment);
    if (scenario.startsWith('pending')) await books(0, [0, 0], ['hat', 'cape']);
    else await books(999, [0, 999], ['hat']);
    if (scenario.includes('failure') || scenario === 'pending-success') {
      await s.hook('refund.updated', { ...refund, status: scenario.includes('failure') ? 'failed' : 'succeeded' });
      await books(scenario.includes('failure') ? 0 : 999, scenario.includes('failure') ? [0, 0] : [0, 999], scenario.includes('failure') ? ['hat', 'cape'] : ['hat']);
    }
    s.stripe.behave.onRefund = null;
  }
  s.stripe.close();
});

test('cancel owns its aged session, foreign events are ignored, and release grants a lost paid webhook', async () => {
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null, automaticTax: false, purchaseAttemptsPerMinute: 1000 } });
  for (const age of [3 * 60000, 3 * 3600000]) {
    const p = s.player();
    const bought = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
    s.DB.sql.prepare('UPDATE shop_orders SET created_at = ?, updated_at = 1 WHERE id = ?').run(Date.now() - age, bought.order);
    await s.fetchSite('/shop/?cancelled=1', { headers: s.as(p) });
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(bought.order).status, 'started');
    await Promise.all([s.fetchSite('/shop/?cancelled=1&order=' + bought.order, { headers: s.as(p) }), s.fetchSite('/api/player/owns', { headers: s.as(p) }), s.fetchSite('/api/shop', { headers: s.as(p) })]);
    await Promise.all(s.waits);
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(bought.order).status, 'expired');
  }
  const before = s.DB.sql.prepare('SELECT COUNT(*) n FROM shop_events').get().n;
  for (const type of ['invoice.paid', 'checkout.session.completed', 'checkout.session.expired', 'refund.created', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']) {
    for (let n = 0; n < 2; n++) {
      const response = await s.hook(type, { id: 'cs_foreign', payment_intent: 'pi_foreign', payment_status: 'paid', metadata: {}, amount_refunded: 0 });
      assert.equal(response.status, 200, type);
      assert.equal((await response.json()).did, 'ignored', type);
    }
  }
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) n FROM shop_events').get().n, before);
  const p = s.player();
  const bought = await (await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))).json();
  const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(bought.order);
  Object.assign(s.stripe.behave.sessions.get(row.session), { payment_status: 'paid', payment_intent: 'pi_release', amount_total: 500 });
  const release = await s.post('/_studio/api/shop/release', { order: row.id }, s.owner);
  assert.equal(release.status, 200, await release.clone().text());
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(row.id).status, 'paid');
  await s.hook('charge.dispute.closed', { payment_intent: 'pi_release', status: 'lost' });
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(row.id).status, 'lost');
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, []);
  s.stripe.close();
});

test('200 simultaneous checkouts never expire another successful response session', async () => {
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null, purchaseAttemptsPerMinute: 1000, purchaseAttemptsPerAddressPerMinute: 1000 } });
  const p = s.player();
  const responses = await Promise.all(Array.from({ length: 200 }, () => s.post('/api/shop/buy', { item: 'supporter' }, s.as(p))));
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    const row = s.DB.sql.prepare('SELECT session FROM shop_orders WHERE id = ?').get(body.order);
    assert.equal(s.stripe.behave.sessions.get(row.session).status, 'open');
  }
  s.stripe.close();
});

test('real Chrome without popups creates Stripe sessions from game and TV buttons and cart messages, then returns', { skip: !process.env.CHROME_PATH && 'Set CHROME_PATH to run the real-browser proof' }, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const { SHOP_SHELL_JS, SHOP_JS } = await import('../worker/shop-page.mjs');
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, purchaseAttemptsPerMinute: 1000 } });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const path of ['/owl-run/play?room=one', '/owl-run/tv?room=one']) for (const cart of [false, true]) {
      const page = await browser.newPage();
      const origin = 'https://owls.example';
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        const url = new URL(request.url());
        if (url.hostname === 'checkout.stripe.com') return request.respond({ status: 200, contentType: 'text/html', body: '<p>Stand-in Stripe Checkout</p>' });
        if (url.pathname.startsWith('/api/')) {
          const response = await s.fetchSite(url.pathname + url.search, { method: request.method(), headers: { ...request.headers(), origin }, ...(request.postData() ? { body: request.postData() } : {}) });
          return request.respond({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        }
        if (url.pathname === '/shop/thanks') return request.respond({ status: 200, contentType: 'text/html', body: '<p data-thanks-title></p><p data-thanks-line></p><script id="shop-boot" type="application/json">' + JSON.stringify({ thanks: url.searchParams.get('session_id') }) + '</script><script>' + SHOP_JS + '</script>' });
        return request.respond({ status: 200, contentType: 'text/html', body: '<iframe class="game" srcdoc="<p>Game</p>"></iframe><script>window.open=()=>null; window.__HOMIE_PLAY=' + JSON.stringify({ game: 'owl-run', screen: path.includes('/tv'), shop: { policy: { televisionCheckout: true, kidsServer: true } } }) + '</script><script>' + SHOP_SHELL_JS + '</script>' });
      });
      await page.goto(origin + path);
      const creates = s.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions').length;
      if (cart) await page.frames().find((f) => f !== page.mainFrame()).evaluate(() => parent.postMessage({ t: 'homie-shop', op: 'checkout', lines: [{ item: 'supporter', quantity: 2 }] }, '*'));
      else {
        await page.evaluate(() => window.__shell.shop.open());
        await page.waitForSelector('.buy');
        await page.click('.buy');
      }
      await page.waitForFunction(() => location.hostname === 'checkout.stripe.com');
      assert.equal(s.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions').length, creates + 1);
      const row = s.DB.sql.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 1').get();
      await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(row.session), payment_status: 'paid', payment_intent: 'pi_browser_' + row.id, amount_total: row.amount });
      await page.goto(origin + '/shop/thanks?session_id=' + row.session);
      await page.waitForFunction((expected) => location.pathname + location.search === expected, {}, path);
      await page.close();
    }
  } finally { await browser.close(); s.stripe.close(); }
});

test('no-popup game and TV scripts create a checkout and restore the exact page after success or cancel', async () => {
  const { runInNewContext } = await import('node:vm');
  const { SHOP_SHELL_JS, SHOP_JS } = await import('../worker/shop-page.mjs');
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, purchaseAttemptsPerMinute: 1000 } });
  for (const screen of [false, true]) for (const cart of [false, true]) for (const cancel of [false, true]) {
    const p = s.player(), nodes = [], events = {}, stored = new Map();
    const element = () => {
      const node = { children: [], events: {}, setAttribute() {}, appendChild(n) { this.children.push(n); return n; }, addEventListener(k, fn) { this.events[k] = fn; }, remove() {} };
      nodes.push(node); return node;
    };
    const frame = { contentWindow: { postMessage() {} } };
    const document = { cookie: '', body: element(), createElement: element, createTextNode: (textContent) => ({ textContent }), addEventListener() {}, querySelector: (q) => q === 'iframe.game' ? frame : null };
    const window = { open: () => null, __HOMIE_PLAY: { game: 'owl-run', screen, shop: { policy: { televisionCheckout: true } } }, addEventListener: (k, fn) => { events[k] = fn; } };
    const location = { origin: 'https://owls.example', pathname: screen ? '/owl-run/tv' : '/owl-run/play', search: '?room=one', hash: '#shop', href: '' };
    const original = location.pathname + location.search + location.hash;
    const sessionStorage = { setItem: (k, v) => stored.set(k, v), getItem: (k) => stored.get(k), removeItem: (k) => stored.delete(k) };
    const fetch = (path, init) => s.fetchSite(path, { ...init, headers: { ...init.headers, ...s.as(p) } });
    runInNewContext(SHOP_SHELL_JS, { document, window, fetch, location, sessionStorage, URL, setTimeout() {} });
    if (cart) events.message({ source: frame.contentWindow, data: { t: 'homie-shop', op: 'checkout', lines: [{ item: 'supporter', quantity: 2 }] } });
    else {
      window.__shell.shop.open();
      for (let i = 0; i < 1000 && !nodes.some((n) => n.textContent === 'Buy on Stripe'); i++) await new Promise((resolve) => setTimeout(resolve, 5));
      const button = nodes.find((n) => n.textContent === 'Buy on Stripe');
      assert.ok(button, 'The shop finished loading');
      button.events.click();
    }
    for (let i = 0; i < 1000 && !location.href; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(location.href, /^https:\/\/checkout.stripe.com/);
    const saved = JSON.parse(stored.get('shop-return'));
    assert.equal(saved.path, original);
    const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(saved.order);
    if (!cancel) await s.hook('checkout.session.completed', { ...s.stripe.behave.sessions.get(row.session), payment_status: 'paid', payment_intent: 'pi_script_' + row.id, amount_total: row.amount });
    else await s.fetchSite('/shop/?cancelled=1&order=' + row.id, { headers: s.as(p) });
    location.href = ''; location.pathname = cancel ? '/shop/' : '/shop/thanks'; location.search = cancel ? '?cancelled=1&order=' + row.id : '?session_id=' + row.session;
    const thanks = {};
    document.querySelector = (q) => q.startsWith('[data-thanks-') ? thanks : null;
    document.getElementById = () => ({ textContent: JSON.stringify(cancel ? {} : { thanks: row.session }) });
    runInNewContext(SHOP_JS, { document, fetch, location, sessionStorage, URL, URLSearchParams, setTimeout() {} });
    for (let i = 0; i < 1000 && !location.href; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(location.href, original);
    assert.equal(stored.size, 0);
  }
  s.stripe.close();
});

test('legacy tips, deleted players and paid 404s leave reconciliation; unknown orders are ignored at any age', async () => {
  const { reconcileOrders, shopOf } = await import('../worker/shop.mjs');
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, purchaseAttemptsPerMinute: 1000 } });
  for (const kind of ['removed-tip', 'deleted-player', 'missing-session']) {
    const p = s.player();
    const purchase = await s.buyPaid(p);
    s.stripe.behave.sessions.get(purchase.session).created = Math.floor(Date.now() / 1000) - 120;
    s.DB.sql.prepare('UPDATE shop_orders SET attention = 1, created_at = 1, updated_at = 1 WHERE id = ?').run(purchase.order);
    if (kind === 'removed-tip') {
      s.DB.sql.prepare("UPDATE shop_order_lines SET item = 'removed', snapshot = NULL WHERE order_id = ?").run(purchase.order);
    } else if (kind === 'deleted-player') s.DB.sql.prepare('UPDATE shop_orders SET player = NULL WHERE id = ?').run(purchase.order);
    else s.stripe.behave.error = { status: 404, code: 'resource_missing' };
    const shop = shopOf({ shop: { items: [SUPPORTER] } });
    await reconcileOrders(s.env, shop);
    assert.equal(s.DB.sql.prepare('SELECT attention FROM shop_orders WHERE id = ?').get(purchase.order).attention, 0, kind);
    const calls = s.stripe.calls.length;
    for (let n = 0; n < 4; n++) await reconcileOrders(s.env, shop);
    assert.equal(s.stripe.calls.length, calls, kind);
    s.stripe.behave.error = null;
  }
  const obj = { id: 'cs_early_own', metadata: { homie: 'shop-v1', origin: 'https://owls.example', order: 'ord_' + 'x'.repeat(20) }, payment_status: 'paid' };
  assert.equal((await s.hook('checkout.session.completed', obj)).status, 200);
  assert.equal((await s.hook('checkout.session.completed', obj, { created: Math.floor(Date.now() / 1000) - 16 * 60 })).status, 200);
  s.stripe.close();
});

test('refunding one free cart line keeps its sibling and a later full refund closes the order', async () => {
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null, items: [
    { id: 'a', name: 'A', price: 0, gives: ['a'] }, { id: 'b', name: 'B', price: 0, gives: ['b'] },
  ] } });
  const p = s.player();
  const { order } = await (await s.post('/api/shop/buy', { lines: [{ item: 'a' }, { item: 'b' }] }, s.as(p))).json();
  assert.equal((await s.post('/_studio/api/shop/refund', { order, line: order + '_0' }, s.owner)).status, 200);
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, ['b']);
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order).status, 'paid');
  assert.equal((await s.post('/_studio/api/shop/refund', { order }, s.owner)).status, 200);
  assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, []);
  assert.equal(s.stripe.calls.length, 0);
  s.stripe.close();
});

test('unrecorded payments recover Stripe refunds and lost disputes through every paid route and event order', async () => {
  const { reconcileOrders, shopOf } = await import('../worker/shop.mjs');
  const { spentThisMonth } = await import('../worker/shop-store.mjs');
  const settings = { policy: undefined, automaticTax: false, capPerPlayerMonth: null, purchaseAttemptsPerMinute: 10000,
    referrals: { rate: 0.1, holdDays: 0 }, items: [{ id: 'a', name: 'Hat', price: 300, gives: ['a'] }, { id: 'b', name: 'Cape', price: 999, gives: ['b'] }] };
  const s = await site({ settings });
  try {
    for (const lost of [false, true]) for (const route of ['event-first', 'charge-first', 'update-first', 'payment-first', 'buyer', 'thanks', 'scheduled', 'office', 'release']) {
      const p = s.player();
      const purchase = await (await s.post('/api/shop/buy', { lines: [{ item: 'a' }, { item: 'b' }] }, s.as(p))).json();
      const o = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(purchase.order);
      const pi = `pi_${o.id}`, at = Math.floor(Date.now() / 1000) - 1200;
      const payment = { id: pi, metadata: { order: o.id }, status: 'succeeded', latest_charge: { id: `ch_${o.id}`, created: at, disputed: lost } };
      s.stripe.behave.payments.set(pi, payment);
      const session = s.stripe.behave.sessions.get(o.session);
      Object.assign(session, { payment_status: 'paid', payment_intent: payment, amount_total: 1299, created: at });
      s.DB.sql.prepare("UPDATE shop_orders SET via = 'ref.example', created_at = ?, updated_at = 1 WHERE id = ?").run(at * 1000, o.id);
      const refund = { id: `re_${o.id}`, payment_intent: pi, amount: 1299, status: 'succeeded', metadata: {} };
      if (!lost) s.stripe.behave.refunds.set(refund.id, refund);
      s.stripe.behave.disputes = lost ? [{ id: `du_${o.id}`, payment_intent: pi, status: 'lost' }] : [];
      const event = () => s.hook(lost ? 'charge.dispute.closed' : 'refund.created', lost ? s.stripe.behave.disputes[0] : refund, { created: at });
      if (route === 'event-first') assert.equal((await event()).status, 200);
      if (route === 'charge-first' || route === 'update-first') assert.equal((await s.hook(lost ? 'charge.dispute.created' : route === 'charge-first' ? 'charge.refunded' : 'refund.updated', lost ? s.stripe.behave.disputes[0] : refund, { created: at })).status, 200);
      if (route === 'payment-first') assert.equal((await s.hook('checkout.session.completed', { ...session, payment_intent: pi })).status, 200);
      if (route === 'buyer') { await s.fetchSite('/api/player/owns', { headers: s.as(p) }); await Promise.all(s.waits); }
      if (route === 'thanks') await s.fetchSite('/api/shop/order?session=' + o.session, { headers: s.as(p) });
      if (route === 'scheduled') await reconcileOrders(s.env, shopOf({ shop: settings }));
      if (route === 'office') await s.post('/_studio/api/shop/refund', { order: o.id }, s.owner);
      if (route === 'release') await s.post('/_studio/api/shop/release', { order: o.id }, s.owner);
      const check = () => {
        const row = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(o.id);
        assert.equal(row.status, lost ? 'lost' : 'refunded', `${lost} ${route}`);
        assert.equal(row.refunded_amount, lost ? 0 : 1299);
        assert.equal(row.refunded_net, lost ? 0 : 1299);
        assert.equal(s.DB.sql.prepare("SELECT COUNT(*) n FROM entitlements WHERE order_id = ? AND state = 'active'").get(o.id).n, 0);
        assert.equal(s.DB.sql.prepare('SELECT state FROM referral_lines WHERE order_id = ?').get(o.id).state, 'void');
        if (lost) assert.equal(s.DB.sql.prepare('SELECT COUNT(*) n FROM entitlements WHERE order_id = ?').get(o.id).n, 0, 'lost charges never grant');
      };
      check();
      assert.equal(await spentThisMonth(s.env, p.id), 0);
      await event(); check();
      await s.hook('checkout.session.completed', { ...session, payment_intent: pi }); check();
      await s.hook('charge.refunded', { payment_intent: pi }); check();
    }
  } finally { s.stripe.close(); }
});

test('eligible work bypasses processing backoff and legacy paid repairs', async () => {
  const { reconcileOrders, shopOf } = await import('../worker/shop.mjs');
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null } });
  try {
    const p = s.player();
    const rows = unresolved(s, p, 4);
    for (const r of rows.slice(0, 3)) s.DB.sql.prepare("UPDATE shop_orders SET status = 'processing', created_at = 1, updated_at = ? WHERE id = ?").run(Date.now() - 600000, r.id);
    Object.assign(rows[3].truth, { payment_status: 'paid', amount_total: rows[3].truth.amount_subtotal, created: Math.floor(Date.now() / 1000) - 120 });
    const shop = shopOf({ shop: { items: [{ id: 'tip', kind: 'tip', name: 'Tip' }] } });
    await reconcileOrders(s.env, shop, p.id);
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(rows[3].id).status, 'paid');
    assert.equal(stripeReads(s).length, 1);
    for (const r of rows.slice(0, 3)) s.DB.sql.prepare("UPDATE shop_orders SET status = 'paid', updated_at = 1 WHERE id = ?").run(r.id);
    s.DB.sql.prepare("UPDATE shop_orders SET status = 'started', paid_at = NULL, attention = 1, updated_at = 1 WHERE id = ?").run(rows[3].id);
    await reconcileOrders(s.env, shop);
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(rows[3].id).status, 'paid');
  } finally { s.stripe.close(); }
});

test('simultaneous refund events do not advance unchanged books, and paid-line refunds keep the free line', async () => {
  const s = await site({ settings: { policy: undefined, automaticTax: false, capPerPlayerMonth: null, refundDays: 14, items: [
    { id: 'a', name: 'Hat', price: 300, gives: ['a'] }, { id: 'free', name: 'Free', price: 0, gives: ['free'] },
  ] } });
  try {
    const p = s.player();
    const purchase = await (await s.post('/api/shop/buy', { lines: [{ item: 'a' }, { item: 'free' }] }, s.as(p))).json();
    const o = s.DB.sql.prepare('SELECT * FROM shop_orders WHERE id = ?').get(purchase.order);
    const session = s.stripe.behave.sessions.get(o.session);
    await s.hook('checkout.session.completed', { ...session, payment_status: 'paid', payment_intent: 'pi_free_sibling', amount_total: 300 });
    s.stripe.behave.refundStatus = 'pending';
    let r = await s.post('/api/shop/refund', { order: o.id, line: o.id + '_0' }, s.as(p));
    assert.equal(r.status, 202);
    assert.match((await r.json()).message, /not completed/);
    const refund = [...s.stripe.behave.refunds.values()][0]; refund.status = 'succeeded';
    const responses = await Promise.all(Array.from({ length: 5 }, () => s.hook('refund.updated', refund)));
    assert.ok(responses.every((r) => r.status === 200));
    const revision = s.DB.sql.prepare('SELECT refund_revision FROM shop_orders WHERE id = ?').get(o.id).refund_revision;
    await Promise.all(Array.from({ length: 5 }, () => s.hook('refund.updated', refund)));
    assert.equal(s.DB.sql.prepare('SELECT refund_revision FROM shop_orders WHERE id = ?').get(o.id).refund_revision, revision);
    assert.deepEqual((await (await s.fetchSite('/api/player/owns', { headers: s.as(p) })).json()).owns, ['free']);
    assert.equal((await s.post('/_studio/api/shop/refund', { order: o.id, line: o.id + '_1' }, s.owner)).status, 200);
    assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(o.id).status, 'refunded');
  } finally { s.stripe.close(); }
});


test('foreign events need no PaymentIntent read without an unrecorded order or with foreign metadata', async () => {
  const s = await site({ settings: { policy: undefined, capPerPlayerMonth: null } });
  try {
    const events = ['charge.refunded', 'refund.created', 'refund.updated', 'charge.dispute.created', 'charge.dispute.closed'];
    for (const type of events) assert.equal((await s.hook(type, { id: 'foreign', payment_intent: 'pi_foreign' })).status, 200);
    const p = s.player();
    await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p));
    for (const type of events) assert.equal((await s.hook(type, { id: 'foreign', payment_intent: 'pi_foreign', metadata: { homie: 'shop-v1', origin: 'https://another.example', order: 'ord_' + 'z'.repeat(20) } })).status, 200);
    assert.equal(s.stripe.calls.filter(c => c.path.startsWith('/v1/payment_intents/')).length, 0);
    assert.equal(s.DB.sql.prepare('SELECT COUNT(*) n FROM shop_events').get().n, 0);
  } finally { s.stripe.close(); }
});

/** CLI stand-in uses the same HTTP-boundary Stripe as the Worker tests above. No account or network login. */
async function pairingHarness(name) {
  const { dir } = connectStudio(name);
  const { shopInit } = await import('../lib/shop.mjs');
  shopInit(dir, { supporter: true });
  const stripe = await fakeStripe();
  const state = { connected: false, oauth: false, expired: false, saveFails: false, cliCalls: [], approvals: [], logs: [], saved: null, writes: 0 };
  const key = `rk_test_${'B8'.repeat(20)}`;
  const exec = async (argv) => {
    const args = argv.slice(2); state.cliCalls.push(args);
    const okay = (body) => ({ code: 0, stdout: typeof body === 'string' ? body : JSON.stringify(body) });
    if (args[0] === '--version') return okay('stripe version 1.53.1');
    if (args[0] === 'config') return okay(state.connected && !state.oauth ? `account_id=acct_owls\ntest_mode_api_key=${key}\ntest_mode_key_expires_at=${state.expired ? '2020-01-01' : '2099-01-01'}\n` : '');
    if (args[0] === 'login' && args[1] === '--non-interactive') return okay({ browser_url: 'https://dashboard.stripe.com/stripecli/confirm?test=1', verification_code: 'owl-owl', next_step: 'stripe login --complete-device' });
    if (args[0] === 'login' && args[1] === '--complete-device') { state.connected = true; state.expired = false; return okay(`Logged in ${key}`); }
    if (!state.connected || state.expired) return { code: 1, stderr: `expired ${key}` };
    const method = args[0].toUpperCase(); const path = args[1]; const body = new URLSearchParams();
    for (let i = 2; i < args.length; i++) if (args[i] === '-d') { const data = args[++i]; const at = data.indexOf('='); body.append(data.slice(0, at), data.slice(at + 1)); }
    const r = await fetch(`${stripe.base}${path}${method === 'GET' ? `?${body}` : ''}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, ...(method === 'GET' ? {} : { body }) });
    const data = await r.json();
    if (method === 'POST' && path === '/v1/webhook_endpoints' && r.ok) stripe.behave.endpoints.push({ ...data, secret: undefined });
    if (method === 'POST' && path.startsWith('/v1/webhook_endpoints/')) { const old = stripe.behave.endpoints.find((e) => e.id === data.id); if (old) old.status = data.status; }
    return { code: r.ok ? 0 : 1, stdout: JSON.stringify(data) };
  };
  const wrangler = (args, opts) => {
    if (args[1] === 'list') return { code: 0, stdout: JSON.stringify(state.saved ? Object.keys(state.saved).map((name) => ({ name })) : []) };
    assert.deepEqual(args, ['secret', 'bulk']); state.writes++;
    if (state.saveFails) return { code: 1, out: 'private failure' };
    state.saved = JSON.parse(opts.input); return { code: 0 };
  };
  return { dir, stripe, state, opts: { storage: join(scratch, 'pairing-receipts'), exec, wrangler, open: (url) => state.approvals.push(url), log: (line) => state.logs.push(line) } };
}

test('browser pairing: first connect, existing endpoint, repeat, expiry, renewal and test then live', async () => {
  const { shopConnect } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-first');
  h.stripe.behave.endpoints.push({ id: 'we_old', url: 'https://owls.example/api/shop/hook', metadata: { homie: 'shop-v1' }, status: 'enabled' }, { id: 'we_foreign', url: 'https://other.example/api/shop/hook', metadata: { homie: 'shop-v1' }, status: 'enabled' });
  const first = await shopConnect(h.dir, h.opts);
  assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.verifiedPurchase, false);
  assert.equal(h.state.approvals.length, 1); assert.equal(h.state.writes, 1);
  assert.deepEqual(Object.keys(h.state.saved).sort(), ['STRIPE_KEY', 'STRIPE_WEBHOOK_SECRET']);
  assert.deepEqual(h.stripe.behave.updated.map((e) => e.id), ['we_old']);
  assert.doesNotMatch(JSON.stringify([first, h.state.logs]), /rk_test_|whsec_/);
  const second = await shopConnect(h.dir, h.opts);
  assert.equal(second.alreadyConnected, true); assert.equal(h.state.writes, 1); assert.equal(h.state.approvals.length, 1);
  h.state.expired = true;
  const renewed = await shopConnect(h.dir, h.opts);
  assert.equal(renewed.ok, true); assert.equal(h.state.approvals.length, 2);
  const live = await shopConnect(h.dir, { ...h.opts, live: true });
  assert.equal(live.needs, 'worker-credential'); assert.match(live.fallback, /--manual --live/);
  assert.equal(h.state.saved.STRIPE_KEY.startsWith('rk_test_'), true, 'unsupported live cannot replace test credentials');
});

test('browser pairing: connect before deploy retains approval; current OAuth does not pretend to install credentials', async () => {
  const { shopConnect } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-before-deploy');
  const file = join(h.dir, 'studio.json'); const studio = JSON.parse(readFileSync(file));
  const bare = { ...studio, cloudflare: {} }; writeFileSync(file, JSON.stringify(bare));
  const first = await shopConnect(h.dir, h.opts);
  assert.equal(first.needs, 'deploy'); assert.equal(h.state.approvals.length, 1); assert.equal(h.state.writes, 0);
  writeFileSync(file, JSON.stringify(studio));
  assert.equal((await shopConnect(h.dir, h.opts)).ok, true); assert.equal(h.state.approvals.length, 1);
  h.state.oauth = true;
  const oauth = await shopConnect(h.dir, h.opts);
  assert.equal(oauth.needs, 'worker-credential'); assert.equal(h.state.writes, 1);
});

test('browser pairing: failed storage leaves old hook active; retry recovers without another approval', async () => {
  const { shopConnect } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-save-failure');
  h.state.saveFails = true;
  const failed = await shopConnect(h.dir, h.opts);
  assert.equal(failed.needs, 'cloudflare'); assert.equal(h.stripe.behave.updated.length, 0);
  h.state.saveFails = false;
  assert.equal((await shopConnect(h.dir, h.opts)).ok, true);
  assert.equal(h.state.approvals.length, 1); assert.equal(h.stripe.behave.updated.length, 1);
  // Deleted Worker secrets invalidate the receipt even though the CLI session still works.
  h.state.saved = null;
  assert.equal((await shopConnect(h.dir, h.opts)).saved, true);
});

test('browser pairing: missing CLI, permission failure, and hostile continuation fail without exposing output', async () => {
  const { shopConnect, completionArgs, stripeProcess } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-errors');
  const managed = await shopConnect(h.dir, { ...h.opts, managed: true });
  assert.equal(managed.needs, 'shop-settings', 'a seller flag is not silently ignored');
  const missing = await shopConnect(h.dir, { ...h.opts, exec: async () => ({ code: 1, missing: true }) });
  assert.equal(missing.needs, 'stripe-cli'); assert.deepEqual(missing.next, ['npm install -g @stripe/cli@latest']);
  assert.equal(completionArgs("stripe login --complete 'https://evil.example/x'"), null);
  assert.equal(completionArgs('stripe login --complete-device; echo token'), null);
  assert.deepEqual(completionArgs("stripe login --complete 'https://dashboard.stripe.com/stripecli/auth/a'"), ['login', '--complete', 'https://dashboard.stripe.com/stripecli/auth/a']);
  h.stripe.behave.webhookDenied = true;
  const denied = await shopConnect(h.dir, h.opts);
  assert.equal(denied.needs, 'stripe-setup'); assert.equal(h.state.writes, 0);
  // Exercise real child-process transport with a fake CLI: inherited keys are never used or printed.
  const bin = join(h.dir, 'node_modules', '.bin');
  writeFileSync(join(bin, 'stripe'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({key:!!process.env.STRIPE_API_KEY,args:process.argv.slice(2)}));\n');
  chmodSync(join(bin, 'stripe'), 0o755);
  const result = await stripeProcess(['--version'], { cwd: h.dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STRIPE_API_KEY: 'must-not-use' } });
  assert.deepEqual(JSON.parse(result.stdout), { key: false, args: ['--version'] });
});

test('real browser: the explicitly chosen manual fallback submits locally and automatically installs its webhook', { skip: !process.env.CHROME_PATH && 'Set CHROME_PATH for real-browser proof' }, async () => {
  const { shopConnect } = await import('../lib/stripe-connect.mjs');
  const { default: puppeteer } = await import('puppeteer-core');
  const { dir } = connectStudio('pairing-manual-browser');
  const stripe = await fakeStripe();
  const logs = [];
  const done = shopConnect(dir, { manual: true, log: (line) => logs.push(line), wait: 20_000, fetcher: (url, options) => fetch(String(url).replace('https://api.stripe.com', stripe.base), options) });
  for (let i = 0; i < 100 && !logs.length; i++) await new Promise((r) => setTimeout(r, 10));
  const url = /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+/.exec(logs.join(' '))[0];
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage(); await page.goto(url);
    assert.match(await page.title(), /Connect.*Stripe/);
    await page.type('#key', `rk_test_${'T6'.repeat(20)}`);
    await Promise.all([page.waitForNavigation(), page.click('button')]);
    assert.match(await page.$eval('body', (el) => el.textContent), /Saved to your Worker/);
    assert.equal((await done).ok, true); assert.equal(stripe.behave.made.length, 1);
    assert.doesNotMatch(logs.join(' '), /T6T6|whsec_/);
  } finally { await browser.close(); }
});

test('real browser: Stripe pairing shows the code and one approval, with no credential field', { skip: !process.env.CHROME_PATH && 'Set CHROME_PATH for real-browser proof' }, async () => {
  const { shopConnect } = await import('../lib/stripe-connect.mjs');
  const { default: puppeteer } = await import('puppeteer-core');
  const h = await pairingHarness('pairing-browser');
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  let approve; const approved = new Promise((resolve) => { approve = resolve; });
  let opened; const ready = new Promise((resolve) => { opened = resolve; });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('approvedByOwner', approve);
    await page.setRequestInterception(true);
    page.on('request', (request) => request.respond({ status: 200, contentType: 'text/html', body: '<h1>Stripe pairing stand-in</h1><p>owl-owl</p><button onclick="approvedByOwner();this.textContent=\'Approved\'">Approve studio sandbox</button>' }));
    const done = shopConnect(h.dir, { ...h.opts, open: (url) => { page.goto(url).then(opened); }, exec: async (args, opts) => { if (args.includes('--complete-device')) await approved; return h.opts.exec(args, opts); } });
    await ready;
    assert.match(await page.$eval('body', (el) => el.textContent), /owl-owl/);
    assert.equal(await page.$$eval('input', (all) => all.length), 0);
    await page.click('button');
    const result = await done;
    assert.equal(result.saved, true); assert.equal(h.state.writes, 1);
    assert.doesNotMatch(JSON.stringify([result, h.state.logs]), /rk_test_|whsec_/);
  } finally { approve(); await browser.close(); }
});

test('browser pairing: the installed key and signing secret fulfill a purchase and office refund in the Worker', async () => {
  const { shopConnect, stripeConnectionInfo } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-purchase');
  const result = await shopConnect(h.dir, h.opts);
  assert.equal(result.saved, true);
  assert.equal(stripeConnectionInfo(h.dir, h.opts).expired, false);
  assert.equal(stripeConnectionInfo(h.dir, { ...h.opts, now: () => Date.parse('2100-01-01') }).expired, true);
  const s = await site(); Object.assign(s.env, h.state.saved);
  const p = s.player(30, { band: 'adult' });
  const buy = await s.post('/api/shop/buy', { item: 'supporter' }, s.as(p)); const order = await buy.json();
  assert.equal(buy.status, 200, JSON.stringify(order));
  const id = /\/pay\/(cs_test_\w+)/.exec(order.url)[1];
  const session = s.stripe.behave.sessions.get(id);
  const payment = `pi_test_${id.slice(8, 20)}`;
  Object.assign(session, { payment_status: 'paid', payment_intent: payment, amount_total: 500, total_details: { amount_tax: 0 } });
  s.stripe.behave.payments.set(payment, { amount: 500, metadata: session.metadata });
  const delivered = await s.hook('checkout.session.completed', session, { secret: h.state.saved.STRIPE_WEBHOOK_SECRET });
  assert.equal(delivered.status, 200, await delivered.text());
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order.order).status, 'paid');
  const refund = await s.post('/_studio/api/shop/refund', { order: order.order }, s.owner);
  assert.equal(refund.status, 200, await refund.text());
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(order.order).status, 'refunded');
});


test('browser pairing: an owner can choose the live fallback after test; no second webhook secret is requested', async () => {
  const { shopConnect, stripeConnectionInfo } = await import('../lib/stripe-connect.mjs');
  const h = await pairingHarness('pairing-live-choice');
  assert.equal((await shopConnect(h.dir, h.opts)).saved, true);
  const c = await openConnect(h.dir, { live: true, storage: h.opts.storage, fetcher: (url, options) => fetch(String(url).replace('https://api.stripe.com', h.stripe.base), options) });
  assert.match(c.page, /Live mode/);
  const saved = await c.postKey({ key: `rk_live_${'L7'.repeat(20)}`, till: 'stripe' });
  assert.equal(saved.status, 200, await saved.text());
  const result = await c.done;
  assert.equal(result.mode, 'live'); assert.equal(result.webhook.made, true);
  assert.equal(stripeConnectionInfo(h.dir, h.opts), null, 'manual replacement clears the old test receipt');
});

test('shop connect --json keeps the local approval link on stderr while waiting for the owner', async () => {
  const { dir } = connectStudio('pairing-json-link');
  const child = spawn(process.execPath, [CLI, 'shop', 'connect', '--manual', '--json'], { cwd: dir, env: { ...process.env, HOMIE_STUDIO_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { errors += b; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    for (let i = 0; i < 200 && !errors.includes('http://127.0.0.1:'); i++) await new Promise((r) => setTimeout(r, 20));
    const link = /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+/.exec(errors)?.[0];
    assert.ok(link, errors); assert.equal(output, '');
    assert.match(await (await fetch(link)).text(), /Connect.*shop to your Stripe/);
  } finally { child.kill(); await closed; }
});
