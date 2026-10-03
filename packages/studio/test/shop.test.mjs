/**
 * @homie-rocks/studio 0.24.0: the shop kit (worker/shop.mjs, shop-rules.mjs, shop-store.mjs, stripe.mjs,
 * referrals.mjs, shop-page.mjs; lib/shop.mjs; shop/shop.ts). A studio sells with ITS OWN Stripe.
 *
 *   - the rules: real money only, nothing random, no countdowns, no gems, a cap that cannot be raised or removed, a
 *     14-day refund floor; a kids studio sells nothing; who may buy (guest, the age question, under 13, 13-17, adult);
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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAP_CEILING, bandOf, checkShop, wayFor } from '../worker/shop-rules.mjs';
import { formEncode, modeOf, apiBase, signPayload, verifyWebhook } from '../worker/stripe.mjs';
import { SHOP_MIGRATION_FILE } from '../worker/shop-store.mjs';
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

test('the rules: real money, nothing random, no countdowns or gems, the cap and the refund floor are the kit\'s', () => {
  const ok = checkShop({ till: 'stripe', currency: 'usd', items: [SUPPORTER] });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.shop.open, true);
  assert.equal(ok.shop.capPerPlayerMonth, CAP_CEILING);
  assert.equal(ok.shop.refundDays, 14);
  assert.equal(ok.shop.items[0].badge, 'Supporter');
  const bad = (raw, re, why) => { const r = checkShop(raw); assert.equal(r.ok, false, why); assert.match(r.errors.map((e) => e.message).join(' | '), re, why); };
  bad({ items: [{ ...SUPPORTER, id: 'box', name: 'Mystery Box' }] }, /paid randomness/, 'a mystery box');
  bad({ items: [{ ...SUPPORTER, blurb: 'A random skin from 40' }] }, /paid randomness/, 'random in its words');
  bad({ items: [{ ...SUPPORTER, odds: { rare: 0.01 } }] }, /odds, drops or a random pool/, 'an odds field');
  bad({ items: [{ ...SUPPORTER, kind: 'loot' }] }, /paid randomness|kind is one of/, 'a loot kind');
  bad({ items: [{ ...SUPPORTER, countdown: '2026-12-01' }] }, /countdown/, 'a countdown field');
  bad({ items: [{ ...SUPPORTER, kind: 'gems' }] }, /gems are not in version 1/, 'gems');
  bad({ items: [{ ...SUPPORTER, price: '500 gems' }] }, /real money only/, 'a price in gems');
  bad({ items: [{ ...SUPPORTER, gives: ['coins:500'] }] }, /is a currency/, 'a currency key');
  bad({ items: [{ ...SUPPORTER, kind: 'subscription' }] }, /later version/, 'subscriptions later');
  bad({ capPerPlayerMonth: 100000, items: [SUPPORTER] }, /never remove it/, 'a raised cap');
  bad({ refundDays: 3, items: [SUPPORTER] }, /at least 14 days/, 'a short refund window');
  bad({ till: 'link', items: [SUPPORTER] }, /later version/, 'another merchant of record later');
  bad({ supportHomie: 0.05, items: [SUPPORTER] }, /Homie takes no cut/, 'no cut');
  bad({ items: [{ ...SUPPORTER, advantage: true }] }, /never changes how the game plays/, 'a supporter pack is never pay-to-win');
  assert.equal(checkShop({ items: [{ ...SUPPORTER, name: 'Jukebox skin' }] }).ok, true, 'a whole word: "Jukebox" is fine');
  assert.match(checkShop({ items: [{ ...SUPPORTER, price: 99 }] }).warnings[0].message, /fees/);
  const kids = checkShop({ till: 'stripe', items: [SUPPORTER] }, { audience: 'kids' });
  assert.equal(kids.shop.till, 'off', 'a kids studio sells nothing');
  assert.equal(kids.shop.open, false);
  assert.equal(checkShop({ items: [{ ...SUPPORTER, game: 'nope' }] }, { games: ['owl-run'] }).ok, false, 'an item of a game that is not here');
});

test('who may buy: the age band, a guest, under 13, 13-17, an adult, a kids or beginner server, the cap', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  assert.equal(bandOf(2020, now), 'child');
  assert.equal(bandOf(2013, now), 'child', 'born in 2013 may still be 12: a year alone never makes a child older');
  assert.equal(bandOf(2012, now), 'teen');
  assert.equal(bandOf(2008, now), 'teen');
  assert.equal(bandOf(2007, now), 'adult');
  assert.equal(bandOf(1890, now), null);
  assert.equal(bandOf('soon', now), null);
  const it = { id: 'x', kind: 'cosmetic', price: 300, gives: ['skin:x'] };
  const adult = { id: 'pl_a', guest: false };
  assert.equal(wayFor(it, { open: false }), 'closed');
  assert.equal(wayFor(it, { kids: true, player: adult, band: 'adult' }), 'kids');
  assert.equal(wayFor({ ...it, advantage: true }, { beginner: true, player: adult, band: 'adult' }), 'beginner');
  assert.equal(wayFor(it, { player: null }), 'make-an-account');
  assert.equal(wayFor(it, { player: { id: 'pl_g', guest: true } }), 'make-an-account');
  assert.equal(wayFor(it, { player: adult, band: null }), 'age-question');
  assert.equal(wayFor(it, { player: adult, band: 'child' }), 'no');
  assert.equal(wayFor(it, { player: adult, band: 'teen' }), 'ask-a-parent');
  assert.equal(wayFor(it, { player: adult, band: 'adult' }), 'checkout');
  assert.equal(wayFor(it, { player: adult, band: 'adult', spent: 4900, cap: 5000 }), 'cap');
  assert.equal(wayFor(it, { player: adult, band: 'adult', owned: true }), 'owned');
  assert.equal(wayFor({ ...it, ends: '2020-01-01' }, { player: adult, band: 'adult' }), 'over');
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
  for (const f of ['0001_studio.sql', '0002_studio_stats.sql', '0004_players.sql', '0005_studio_office.sql', '0006_studio_servers.sql', SHOP_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { for (const s of list) await s.run(); return []; } };
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
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const form = new URLSearchParams(body);
      calls.push({ method: req.method, path: url.pathname, form, auth: String(req.headers.authorization ?? '').replace(/^Bearer (rk|sk)_(test|live)_.*/, '$1_$2'), version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] ?? null });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      n += 1;
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const id = `cs_test_${String(n).padStart(6, '0')}abc`;
        return send(200, { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, mode: 'payment', livemode: false, client_reference_id: form.get('client_reference_id'), metadata: Object.fromEntries([...form].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])), currency: form.get('line_items[0][price_data][currency]'), amount_subtotal: Number(form.get('line_items[0][price_data][unit_amount]')), payment_status: 'unpaid', status: 'open' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/refunds') return send(200, { id: `re_test_${n}`, object: 'refund', status: 'succeeded', payment_intent: form.get('payment_intent'), amount: 500 });
      if (req.method === 'GET' && url.pathname === '/v1/checkout/sessions') return send(200, { object: 'list', data: [], has_more: false });
      return send(404, { error: { type: 'invalid_request_error', message: 'No such route' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const handle = { calls, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close(); } };
  open.push(handle);
  return handle;
}

let built = null;
async function site({ key = true, managed = false } = {}) {
  if (!built) {
    const dir = studio('worker');
    assert.equal(run(['game', 'new', 'owl-run', '--from', 'gem-rush', '--name', 'Owl Run'], dir).status, 0);
    writeFileSync(join(dir, 'shop.json'), JSON.stringify({
      till: 'stripe', currency: 'usd', refundDays: 14, capPerPlayerMonth: 2000,
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
  if (managed) {
    // The same build, with Managed Payments as the till (games.json is what the Worker reads).
    const cat = JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8'));
    cat.shop.till = 'stripe-managed';
    const mdir = join(scratch, 'managed-dist');
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
  const managedAssets = managed ? assetsOf(join(scratch, 'managed-dist')) : null;
  const ASSETS = managed ? { fetch: async (req) => (new URL(req.url).pathname === '/games.json' ? managedAssets.fetch(req) : base.fetch(req)) } : base;
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
  const hook = async (type, object, { id = `evt_${Math.random().toString(36).slice(2, 12)}`, livemode = false, secret = HOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) => {
    const payload = JSON.stringify({ id, object: 'event', type, livemode, data: { object } });
    return fetchSite('/api/shop/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${await signPayload(payload, secret, t)}` }, body: payload });
  };
  /** Buy as an adult and have Stripe say it is paid: the order, its session and its payment. */
  const buyPaid = async (p, item = 'supporter', extra = {}) => {
    const r = await post('/api/shop/buy', { item, ...extra }, as(p));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    const call = stripe.calls.filter((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST').pop();
    const sid = /\/pay\/(cs_test_\w+)/.exec(j.url)[1];
    const pi = `pi_test_${sid.slice(8, 20)}`;
    const amount = Number(call.form.get('line_items[0][price_data][unit_amount]'));
    const h = await hook('checkout.session.completed', { id: sid, object: 'checkout.session', payment_status: 'paid', payment_intent: pi, client_reference_id: p.id, metadata: { order: j.order, item }, currency: 'usd', amount_subtotal: amount, amount_total: amount + 40, total_details: { amount_tax: 40 } });
    assert.equal(h.status, 200);
    return { order: j.order, session: sid, payment: pi, hook: await h.json(), call };
  };
  return { env, DB, fetchSite, fetchAt, post, player, as, owner, key0, hook, buyPaid, stripe, dir, waits, same };
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
  // A full secret key is refused: only a restricted key.
  s.env.STRIPE_KEY = `sk_live_${'x'.repeat(30)}`;
  s.env.STRIPE_WEBHOOK_SECRET = HOOK_SECRET;
  assert.deepEqual((await (await s.fetchSite('/api/shop')).json()).missing, ['restricted-key']);
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

test('kids and beginners: no shop on a kids server; an advantage is never sold or counted on a beginner server; under 13 never', async () => {
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
  assert.match(tv, /"shop":\{[^}]*"qr":"\\u003csvg/, 'the television gets a code to buy on a phone');
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
  assert.equal(s.stripe.calls.filter((c) => c.path === '/v1/refunds').length, 0, 'nothing refunded until the owner says yes');
  assert.equal(s.DB.sql.prepare('SELECT status FROM shop_orders WHERE id = ?').get(a.order).status, 'paid');
  // No key can confirm an ask; the owner's browser can, once.
  assert.equal((await s.fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { ...s.key0, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' })).status, 401);
  assert.equal(s.stripe.calls.filter((c) => c.path === '/v1/refunds').length, 0, 'the office key\'s own POST is the locked page');
  const confirm = await s.fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { cookie: s.owner.cookie, origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' });
  assert.match(await confirm.text(), /Done\./);
  const refund = s.stripe.calls.filter((c) => c.path === '/v1/refunds');
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
  assert.match((await refused.json()).message, /disputed/);
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
  const left = s.DB.sql.prepare('SELECT player FROM shop_orders WHERE status = ?').all('paid');
  assert.ok(left.length >= 3 && left.every((r) => r.player === null), 'the orders stay, without the player');
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
    const settle = await s.fetchSite('/_studio/api/shop/settle', { method: 'POST', headers: s.key0, body: JSON.stringify({ via: 'friends.example', ref: 'INV-1' }) });
    assert.equal(settle.status, 202);
    const done = await s.fetchSite('/_studio/api/shop/settle', { method: 'POST', headers: s.owner, body: JSON.stringify({ via: 'friends.example', ref: 'INV-1' }) });
    assert.equal((await done.json()).ok, true);
    assert.equal(s.DB.sql.prepare('SELECT state FROM referral_lines WHERE order_id = ?').get(b.order).state, 'settled');
    await s.fetchSite('/_studio/api/shop/refund', { method: 'POST', headers: s.owner, body: JSON.stringify({ order: b.order }) });
    assert.equal(s.DB.sql.prepare('SELECT state FROM referral_lines WHERE order_id = ?').get(b.order).state, 'clawback');
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

/* ------------------------------------------------------------------ the CLI */

test('the CLI: shop init and check; the build refuses a shop that breaks the rules; a kids studio sells nothing', () => {
  const dir = studio('cli');
  let r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.absent, true);
  r = JSON.parse(run(['shop', 'init', '--supporter'], dir).stdout);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.wrote, ['shop.json', 'SELLING.md']);
  assert.match(readFileSync(join(dir, 'SELLING.md'), 'utf8'), /not legal or tax advice/);
  r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.ok, true);
  const shop = JSON.parse(readFileSync(join(dir, 'shop.json'), 'utf8'));
  shop.items.push({ id: 'crate', kind: 'cosmetic', name: 'Mystery crate', price: 300, gives: ['skin:random'] });
  writeFileSync(join(dir, 'shop.json'), JSON.stringify(shop));
  r = JSON.parse(run(['shop', 'check'], dir).stdout);
  assert.equal(r.ok, false);
  const b = run(['build'], dir);
  assert.notEqual(b.status, 0);
  assert.match(b.stdout + b.stderr, /shop\.json breaks the shop's rules/);
  const studioJson = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...studioJson, audience: 'kids' }));
  rmSync(join(dir, 'shop.json'));
  r = JSON.parse(run(['shop', 'init', '--supporter'], dir).stdout);
  assert.equal(r.ok, false);
  assert.match(r.why, /made for children/);
  assert.ok(existsSync(join(dir, 'site', 'migrations', SHOP_MIGRATION_FILE)), 'a new studio has the shop migration');
});

test('shop connect: the owner pastes the key on this computer; it goes to the Worker secret and is never printed', async () => {
  const dir = studio('connect');
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  // A stand-in Wrangler: it records the command and how long the secret on its standard input was (never the secret).
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
echo "$*" >> ${state}/calls
if [ "$1" = secret ]; then wc -c | tr -d ' ' >> ${state}/stdin-bytes; echo "Success! Uploaded secret $3"; fi
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe', items: [SUPPORTER] }));
  const { shopConnect } = await import('../lib/shop.mjs');
  const said = [];
  const done = shopConnect(dir, { log: (line) => said.push(line), wait: 20_000, verify: false });
  for (let i = 0; i < 50 && !said.length; i += 1) await new Promise((r) => setTimeout(r, 50));
  const link = /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}/.exec(said.join(' '))?.[0];
  assert.ok(link, said.join(' '));
  const page = await (await fetch(link)).text();
  assert.match(page, /type="password"/g);
  assert.match(page, /Checkout Sessions<\/b>: Write/);
  assert.match(page, /\/api\/shop\/hook/);
  assert.match(page, /3\.5% more/, 'Managed Payments offered, with what it costs');
  assert.match(page, /seller of record/);
  assert.match(page, /not to the chat, not to a file/);
  const n = /name="n" value="([a-f0-9]{32})"/.exec(page)[1];
  const origin = new URL(link).origin;
  const postKey = (body) => fetch(`${origin}/key`, { method: 'POST', body: new URLSearchParams(body) });
  assert.equal((await postKey({ n: 'f'.repeat(32), key: TEST_KEY, hook: HOOK_SECRET })).status, 403);
  assert.match(await (await postKey({ n, key: `sk_live_${'x'.repeat(30)}`, hook: HOOK_SECRET })).text(), /RESTRICTED/);
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
  const deliver = (data) => handlers.forEach((fn) => fn({ data }));
  try {
    const shop = createShop({ target: { postMessage: (m) => { sent.push(m); if (m.op === 'hello') setTimeout(() => deliver({ t: 'homie-shop', q: m.q, ok: true, open: true, owns: ['badge:supporter'] }), 1); if (m.op === 'used') setTimeout(() => deliver({ t: 'homie-shop', q: m.q, ok: true }), 1); } } });
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
  } finally { g.addEventListener = before; }
});

test('the pages\' scripts parse (the shop page, the play shell\'s store sheet, the office\'s shop page)', async () => {
  const { Script } = await import('node:vm');
  const pages = await import('../worker/shop-page.mjs');
  for (const name of ['SHOP_JS', 'SHOP_SHELL_JS', 'OFFICE_SHOP_SCRIPT']) assert.doesNotThrow(() => new Script(pages[name]), name);
});
