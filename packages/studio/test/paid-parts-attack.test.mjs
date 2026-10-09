/** Real SQLite, private object storage and a local Stripe stand-in; never credentials or money. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPart, writePart } from '../lib/parts.mjs';
import { addPart, sharePart } from '../lib/parts-store.mjs';
import { buildParts } from '../lib/parts-build.mjs';
import worker from '../worker/selling/index.mjs';
import { shopRoutes } from '../worker/shop.mjs';
import { coversRelease } from "../worker/parts-sale.mjs";
import { signPayload } from '../worker/stripe.mjs';

import { fixture, sale, KEY, SECRET } from './paid-parts-fixture.mjs';
import { SignJWT, generateKeyPair, exportJWK, calculateJwkThumbprint, base64url } from 'jose';
import { signingKey } from '../worker/purchase-keys.mjs';
import { shopOffice } from '../worker/shop.mjs';
const FILE = 'https://seller.example/parts/camera/0.1.0/src/index.ts';
const tokenOf = (f) => JSON.parse(readFileSync(join(f.buyer, '.homie/paid-parts', readdirSync(join(f.buyer, '.homie/paid-parts')).find((p) => !p.includes('backup') && p !== 'identity.json')))).token;
const get = (f, url, token, init = {}) => f.fetcher(url, { ...init, headers: token ? { authorization: `Bearer ${token}` } : {} });

test('A1 forged grants: none, HS256 with the public key, foreign key, wrong typ, other part', async () => {
  const f = await fixture('forge'); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    const good = tokenOf(f); assert.equal((await get(f, FILE, good)).status, 200);
    const [h, p] = good.split('.'); const payload = JSON.parse(Buffer.from(p, 'base64url'));
    const none = `${base64url.encode(JSON.stringify({ alg: 'none', typ: 'homie-purchase-grant+jwt' }))}.${p}.`;
    const out = {};
    out.none = (await get(f, FILE, none)).status;
    const pub = (await signingKey(f.env)).publicJwk; const kid = await calculateJwkThumbprint(pub);
    const hs = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'homie-purchase-grant+jwt', kid }).sign(Buffer.from(pub.x, 'base64url'));
    out.hs256 = (await get(f, FILE, hs)).status;
    const other = await generateKeyPair('Ed25519', { extractable: true }); const ojwk = await exportJWK(other.publicKey);
    out.foreignKeySameKid = (await get(f, FILE, await new SignJWT(payload).setProtectedHeader({ alg: 'Ed25519', typ: 'homie-purchase-grant+jwt', kid }).sign(other.privateKey))).status;
    out.foreignKeyJwkHeader = (await get(f, FILE, await new SignJWT(payload).setProtectedHeader({ alg: 'Ed25519', typ: 'homie-purchase-grant+jwt', kid: await calculateJwkThumbprint(ojwk), jwk: ojwk }).sign(other.privateKey))).status;
    out.tamperedPayload = (await get(f, FILE, `${h}.${base64url.encode(JSON.stringify({ ...payload, version: '9.9.9' }))}.${good.split('.')[2]}`)).status;
    // same release bytes published as another part id: camera grant must not open it
    const rel = JSON.parse(f.objects.get('paid-parts/releases/camera/0.1.0.json')); f.objects.set('paid-parts/releases/lights/0.1.0.json', Buffer.from(JSON.stringify({ ...rel, id: 'lights' })));
    out.otherPart = (await get(f, 'https://seller.example/parts/lights/0.1.0/src/index.ts', good)).status;
    out.claimAsGrant = (await get(f, FILE, 'a'.repeat(64))).status;
    console.log('A1', JSON.stringify(out));
    for (const [k, v] of Object.entries(out)) assert.ok(v === 402 || v === 403, k + ' -> ' + v);
  } finally { await f.close(); }
});

test('A2 path traversal and R2 key guessing through the whole Worker', async () => {
  const f = await fixture('traverse'); try {
    const ctx = { waitUntil() {} }; const out = {};
    const hash = [...f.objects.keys()].find((k) => k.startsWith('paid-parts/files/')).split('/').pop();
    for (const path of ['/parts/camera/0.1.0/..%2f..%2f..%2fpaid-parts/releases/camera/0.1.0.json', '/parts/camera/0.1.0/%2e%2e/%2e%2e/src/index.ts', '/parts/camera/0.1.0/src%2findex.ts', '/parts/camera/0.1.0/src/index.ts%00.html', '/parts/camera/0.1.0/preview/../src/index.ts', '/parts/camera/0.1.0/src//index.ts', `/media/paid-parts/files/${hash}`, `/media/x/..%2fpaid-parts/files/${hash}`, `/media//paid-parts/files/${hash}`, `/media/./paid-parts/files/${hash}`, `/media/Paid-parts/files/${hash}`, `/parts/camera/0.1.0/${hash}`, '/parts/camera/0.1.0/SRC/index.ts']) {
      let r; try { r = await worker.fetch(new Request(`https://seller.example${path}`), { ...f.env, HOMIE_HUB: '' }, ctx); out[path] = r.status + (r.status === 200 ? ' LEAK ' + (await r.text()).slice(0, 40) : ''); } catch (e) { out[path] = 'threw ' + e.message.slice(0, 60); }
    }
    console.log('A2', JSON.stringify(out, null, 1));
    assert.ok(!Object.values(out).some((v) => String(v).includes('LEAK')));
  } finally { await f.close(); }
});

test('A3 subscription: one fully refunded invoice kills access for good while later invoices are still paid', async () => {
  const f = await fixture('subkill', { billing: 'month', onExpiry: 'terminate' }); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    f.charge.refunded = true; f.charge.amount_refunded = f.charge.amount;
    await f.event('charge.refunded', f.charge, 'month1-refund');
    // month 2 renews and is paid in Stripe; the subscription is still active there
    f.charge.refunded = false; f.charge.amount_refunded = 0;
    f.invoice.id = 'in_month2'; f.invoice.lines.data[0].period.end += 30 * 86400;
    const r = await f.event('invoice.paid', { ...f.invoice, parent: { subscription_details: { subscription: f.sub.id } } }, 'month2-paid');
    const row = f.env.DB.sql.prepare('SELECT o.status, o.paid_until, o.subscription FROM purchase_orders o').get();
    const again = await f.add();
    console.log('A3 hook', r.status, await r.text(), 'order', JSON.stringify(row), 'sub status in Stripe', f.sub.status, 'add ok', again.ok, again.purchase?.status, again.why);
    assert.equal(again.ok, true, 'buyer paid month 2 but has no access');
  } finally { await f.close(); }
});

test('A4 approval hash does not bind quantity or game', async () => {
  const f = await fixture('seats', { scope: 'seat', amount: 10000 }); try {
    const quote = await f.add({ quantity: 1 });
    console.log('A4 shown to the person:', quote.purchase.price);
    const intent = await f.add({ quantity: 500, approve: quote.purchase.quote });
    const o = f.env.DB.sql.prepare('SELECT amount, currency FROM purchase_orders').get();
    console.log('A4 intent prepared with the 1-seat approval:', JSON.stringify(o), intent.purchase?.price);
    assert.equal(o, undefined, 'an altered quantity must not create an order');
    assert.notEqual(intent.purchase.quote, quote.purchase.quote);
    assert.equal(intent.purchase.checkout, undefined);
  } finally { await f.close(); }
});

test('A5 intent endpoint: unauthenticated, unlimited, floods the order book and the office', async () => {
  const f = await fixture('spam'); try {
    const quote = (await f.add()).purchase.quote; let ok = 0; const statuses = new Set();
    for (let i = 0; i < 300; i++) {
      const r = await f.fetcher('https://seller.example/api/purchases/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: i.toString(16).padStart(64, '0'), claimHash: i.toString(16).padStart(64, 'f'), quote, buyerName: 'x'.repeat(80) }) });
      statuses.add(r.status); if (r.status === 200) ok++;
    }
    const n = f.env.DB.sql.prepare('SELECT COUNT(*) n, SUM(LENGTH(manifest)) bytes FROM purchase_orders').get();
    f.env.DB.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT)'); f.env.DB.sql.prepare("INSERT INTO shop_orders (id,item,amount,currency,till,mode,status,created_at,updated_at) VALUES ('ord_real','hat',500,'usd','stripe','test','paid',?,?)").run(Date.now()-3600e3, Date.now()-3600e3); const office = await shopOffice(f.env, f.cat, 'https://seller.example');
    console.log('A5 accepted', ok, [...statuses], 'rows', JSON.stringify(n), 'office rows', office.orders?.length, 'real paid order visible', office.orders?.some((o) => o.id === 'ord_real'), 'started', office.orders?.filter((o) => o.status === 'started').length);
    assert.ok(statuses.has(429), 'no rate limit on unauthenticated order creation');
  } finally { await f.close(); }
});

test('A7 a price rise is bypassed by buying the older listed version, then updating', async () => {
  const f = await fixture('oldprice', { amount: 1000, updates: 'all' }); try {
    const p = readPart(f.dir); p.version = '0.2.0'; p.sale.amount = 500000; writePart(f.dir, p); assert.equal(sharePart(f.root, 'camera').ok, true); buildParts(f.root, f.dist); await f.upload();
    const old = (ref, o = {}) => addPart(f.buyer, ref, { game: 'cave', fetch: f.fetcher, npm: () => ({ status: 0 }), ...o });
    const q = await old('seller.example/camera@0.1.0'); const intent = await old('seller.example/camera@0.1.0', { approve: q.purchase.quote });
    console.log('A7 quote for old version:', q.purchase?.price, '| intent:', intent.purchase?.checkout ? 'accepted' : intent.why);
    assert.equal(intent.ok, false); assert.equal(intent.purchase?.checkout, undefined);
    const first = JSON.parse(f.objects.get('paid-parts/releases/camera/0.1.0.json'));
    const latest = JSON.parse(f.objects.get('paid-parts/releases/camera/0.2.0.json'));
    assert.equal(coversRelease(first, latest), true, 'existing all-updates rights survive; the old release cannot be bought anew');
  } finally { await f.close(); }
});

test('A8 review page: no Origin, cross-site Origin, replay after payment, expired intent', async () => {
  const f = await fixture('review'); try {
    const quote = await f.add(); const intent = await f.add({ approve: quote.purchase.quote }); const url = intent.purchase.checkout; const out = {};
    out.noOrigin = (await f.fetcher(url, { method: 'POST' })).status;
    out.crossOrigin = (await f.fetcher(url, { method: 'POST', headers: { origin: 'https://evil.example' } })).status;
    out.page = (await (await f.fetcher(url)).text()).match(/Accept and continue to Stripe[^<]*/)?.[0];
    out.first = (await f.fetcher(url, { method: 'POST', headers: { origin: 'https://seller.example' } })).status;
    f.session.payment_status = 'paid'; await f.event('checkout.session.completed');
    out.afterPaid = (await f.fetcher(url, { method: 'POST', headers: { origin: 'https://seller.example' } })).status;
    console.log('A8', JSON.stringify(out));
    assert.deepEqual([out.noOrigin, out.crossOrigin, out.first, out.afterPaid], [403, 403, 303, 409]);
  } finally { await f.close(); }
});

test('A9 webhook: bad signature, stale timestamp, amount tamper, session swap, replay', async () => {
  const f = await fixture('hook'); try {
    await f.buy(); const out = {};
    const post = async (ev, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) => { const body = JSON.stringify(ev); const req = new Request('https://seller.example/api/shop/hook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await signPayload(body, secret, t)}` } }); try { const r = await shopRoutes(req, f.env, {}, new URL(req.url), { catalogueOf: async () => f.cat }); return r.status + ' ' + (await r.text()).slice(0, 80); } catch (e) { return 'threw ' + e.message; } };
    const ev = (obj, id) => ({ id, type: 'checkout.session.completed', livemode: false, data: { object: obj } });
    out.badSecret = await post(ev(f.session, 'e1'), { secret: 'whsec_' + 'x'.repeat(32) });
    out.stale = await post(ev(f.session, 'e2'), { t: Math.floor(Date.now() / 1000) - 3600 });
    out.cheaper = await post(ev({ ...f.session, amount_subtotal: 1 }, 'e3'));
    out.otherSession = await post(ev({ ...f.session, id: 'cs_other' }, 'e4'));
    out.unpaid = await post(ev({ ...f.session, payment_status: 'unpaid' }, 'e5'));
    out.statusAfterUnpaid = f.env.DB.sql.prepare('SELECT status FROM purchase_orders').get().status;
    out.live = await post({ ...ev(f.session, 'e6'), livemode: true });
    out.ok = await post(ev(f.session, 'e7')); out.replay = await post(ev(f.session, 'e7'));
    console.log('A9', JSON.stringify(out, null, 1));
    assert.equal(out.statusAfterUnpaid, 'started');
  } finally { await f.close(); }
});
