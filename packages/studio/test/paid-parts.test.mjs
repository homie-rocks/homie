/** Real SQLite, private object storage and a local Stripe stand-in; never credentials or money. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readPart, writePart, checkPart, packPart, licenseOfPart } from '../lib/parts.mjs';
import { addPart, sharePart, findParts } from '../lib/parts-store.mjs';
import { buildParts, partsPublishReport } from '../lib/parts-build.mjs';
import { uploadPaidParts } from '../lib/parts-upload.mjs';
import { purchasePortal } from '../lib/parts-purchase.mjs';
import worker from '../worker/selling/index.mjs';
import { shopRoutes, refundOrder } from '../worker/shop.mjs';
import { purchaseSessionParams, reissuePurchaseClaim, authorizePurchaseTest } from '../worker/purchases.mjs';
import { verifyGrant } from "../worker/purchase-crypto.mjs";
import { priceWords } from "../worker/purchase-pricing.mjs";
import { coversRelease, compareVersions } from "../worker/parts-sale.mjs";
import { createCheckoutSession } from '../worker/stripe.mjs';

import { fixture, sale, KEY } from './paid-parts-fixture.mjs';

test('sale metadata accepts seller choices without a price ceiling and freezes legal terms', async () => {
  const f = await fixture('metadata'); try {
    const p = readPart(f.dir); assert.equal(checkPart(p).ok, true); assert.match(priceWords(sale), /1,250/);
    assert.equal(licenseOfPart('(MIT OR Apache-2.0) AND LicenseRef-Studio-Commercial').known, false);
    for (const scope of ['studio', 'game', 'seat']) for (const billing of ['one-time', 'month', 'year']) assert.equal(checkPart({ ...p, sale: { ...sale, scope, billing, amount: 90000000, refund: 'Seller policy', source: false } }).ok, true);
    for (const amount of [-1, 1.5, NaN]) assert.equal(checkPart({ ...p, sale: { ...sale, amount } }).ok, false);
    for (const amount of [0, 1, 49]) assert.equal(checkPart({ ...p, sale: { ...sale, amount } }).ok, true, 'shop currency rules impose no toolkit minimum');
    p.sale.amount++; writePart(f.dir, p); assert.equal(packPart(f.root, 'camera').ok, false);
    assert.equal(coversRelease(p, { ...p, version: '0.2.0' }), true);
    assert.equal(coversRelease(p, { ...p, version: '1.0.0' }), false);
    assert.equal(coversRelease(p, { ...p, version: `${p.version}-rc.1` }), false);
    assert.equal(compareVersions('1.2.3-alpha-beta', '1.2.3-alpha-alpha'), 1);
    assert.equal(coversRelease(p, { ...p, version: '0.2.0', license: 'MIT' }), true);
  } finally { await f.close(); }
});

test('paid payloads are absent from assets, public previews work, anonymous download is refused', async () => {
  const f = await fixture('delivery'); try {
    assert.equal(existsSync(join(f.dist, 'parts/camera/0.1.0/src/index.ts')), false);
    assert.equal(existsSync(join(f.dist, 'parts/camera/0.1.0/preview/index.html')), true);
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts')).status, 402);
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/preview/index.html')).status, 200);
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { method: 'HEAD' })).status, 402);
    const bad = await f.fetcher('https://seller.example/api/purchases/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claimHash: 'b'.repeat(64), quote: 'c'.repeat(64) }) }); assert.equal(bad.status, 409);
    await assert.rejects(uploadPaidParts(f.root, { bucket: null }), /storage/);
  } finally { await f.close(); }
});

test('a human checkout grants verified files, survives withdrawal and offline restore, full refunds stop downloads', async () => {
  const f = await fixture('purchase'); try {
    await f.buy();
    const mismatched = { ...f.session, currency: 'eur' }; await assert.rejects(f.event('checkout.session.completed', mismatched), /mismatch/);
    assert.equal((await f.event('checkout.session.completed')).status, 200);
    const installed = await f.add(); assert.equal(installed.ok, true, installed.why); assert.equal(installed.purchase.mode, 'test');
    mkdirSync(join(f.buyer, 'games', 'second')); writeFileSync(join(f.buyer, 'games', 'second', 'game.json'), '{}');
    assert.equal((await f.add({ game: 'second' })).ok, true, 'a studio licence covers another game without buying again');
    assert.equal(partsPublishReport(f.buyer).ok, true);
    const record = JSON.parse(readFileSync(join(f.buyer, '.homie/paid-parts', readdirSync(join(f.buyer, '.homie/paid-parts')).find((p) => !p.includes('backup') && p !== 'identity.json'))));
    assert.ok(record.token); assert.match(readFileSync(join(f.buyer, '.gitignore'), 'utf8'), /paid-parts/);
    const proof = await verifyGrant(record.token, record.jwk, { issuer: 'https://seller.example', kind: 'part', resource: 'camera', version: '0.1.0' }); assert.equal(proof.quantity, 1);
    await assert.rejects(verifyGrant(record.token, record.jwk, { issuer: 'https://other.example' }));
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { headers: { authorization: `Bearer ${record.token}` } })).status, 200);
    sharePart(f.root, 'camera', false); buildParts(f.root, f.dist);
    const again = await addPart(f.buyer, 'seller.example/camera@0.1.0', { game: 'cave', fetch: f.fetcher, npm: () => ({ status: 0 }) }); assert.equal(again.ok, true, again.why);
    const offline = await f.add({ offline: true, fetch: () => { throw new Error('offline'); } }); assert.equal(offline.ok, true, offline.why); assert.equal(offline.purchase.offline, true);
    f.charge.amount_refunded = 20;
    await f.event('refund.created', { status: 'succeeded', id: 'partial', charge: f.charge.id, payment_intent: f.charge.payment_intent });
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { headers: { authorization: `Bearer ${record.token}` } })).status, 200);
    f.charge.amount_refunded = f.charge.amount; f.charge.refunded = true;
    await f.event('charge.refunded', f.charge);
    await f.event('checkout.session.completed', f.session, 'late-completion');
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { headers: { authorization: `Bearer ${record.token}` } })).status, 403);
    const refunded = await addPart(f.buyer, 'seller.example/camera@0.1.0', { game: 'cave', fetch: f.fetcher }); assert.equal(refunded.purchase.status, 'refunded');
    assert.equal((await f.add({ offline: true })).ok, false);
    assert.equal(partsPublishReport(f.buyer).ok, false, 'a known revocation reaches the publish report');
  } finally { await f.close(); }
});

test('updates preserve tuning and purchased rights despite changed new-buyer terms; corruption writes nothing', async () => {
  const f = await fixture('updates'); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    const vendor = join(f.buyer, 'parts/_vendor/seller.example/camera'); writeFileSync(join(vendor, 'tuning.json'), '{"speed":9}');
    const p = readPart(f.dir); p.version = '0.2.0'; writePart(f.dir, p); writeFileSync(join(f.dir, 'tuning.json'), '{"speed":2}'); assert.equal(sharePart(f.root, 'camera').ok, true); buildParts(f.root, f.dist); await f.upload();
    const updated = await f.add(); assert.equal(updated.ok, true, updated.why); assert.equal(readFileSync(join(vendor, 'tuning.json'), 'utf8'), '{"speed":9}');
    p.version = '0.3.0'; p.sale.transferable = true; writePart(f.dir, p); sharePart(f.root, 'camera'); buildParts(f.root, f.dist); await f.upload();
    assert.equal((await f.add()).ok, true);
    const key = [...f.objects.keys()].find((k) => k.startsWith('paid-parts/files/') && f.objects.get(k).toString().includes('export function')); f.objects.set(key, Buffer.from('bad'));
    const corrupt = await addPart(f.buyer, 'seller.example/camera@0.2.0', { game: 'cave', fetch: f.fetcher, npm: () => ({ status: 0 }) }); assert.equal(corrupt.ok, false); assert.match(corrupt.why, /SHA-256|size|bytes/);
  } finally { await f.close(); }
});

test('subscriptions use paid periods and Stripe portal; expired grants cannot fetch or silently renew', async () => {
  const f = await fixture('recurring', { billing: 'month', onExpiry: 'terminate', renewalGraceMinutes: 0 }); try {
    await f.buy(); await f.event('checkout.session.completed');
    const added = await f.add(); assert.equal(added.ok, true, added.why); assert.ok(added.purchase.paidUntil > Date.now());
    const portal = await purchasePortal(f.buyer, 'seller.example/camera', { game: 'cave', fetch: f.fetcher }); assert.equal(portal.url, 'https://billing.stripe.com/test');
    f.env.DB.sql.prepare('UPDATE purchase_orders SET paid_until = ?').run(Date.now() - 1000); f.env.DB.sql.prepare('UPDATE purchase_payment_facts SET period_end = ?').run(Date.now() - 1000); f.invoice.status = 'open';
    const expired = await f.add(); assert.equal(expired.ok, false); assert.equal(expired.purchase.status, 'lapsed');
    f.invoice.status = 'paid'; f.invoice.lines.data[0].period.end += 86400;
    await f.event('invoice.paid', { ...f.invoice, parent: { subscription_details: { subscription: f.sub.id } } });
    assert.equal((await f.add()).ok, true);
  } finally { await f.close(); }
});

test('pending office refunds do not revoke and discovery explains paid against free', async () => {
  const f = await fixture('refund'); try {
    await f.buy(); await f.event('checkout.session.completed');
    const o = f.env.DB.sql.prepare('SELECT * FROM purchase_orders').get(); f.refundStatus = 'pending';
    const r = await refundOrder(f.env, o); assert.equal(r.pending, true); assert.equal(f.env.DB.sql.prepare('SELECT status FROM purchase_orders').get().status, 'paid');
    const part = JSON.parse(f.objects.get('paid-parts/releases/camera/0.1.0.json'));
    const found = await findParts(null, 'camera', { fetch: async () => Response.json({ parts: [{ ...part, add: 'seller.example/camera' }, { ...part, id: 'free-camera', sale: undefined, add: 'free.example/free-camera' }] }) });
    assert.equal(found.results[0].price, 'Free'); assert.equal(found.results[1].purchaseRequired, true); assert.match(found.results[1].ranking, /local first/);
  } finally { await f.close(); }
});

test('Stripe own schema accepts paid part Checkout when stripe-mock is available', { skip: !process.env.STRIPE_MOCK_URL }, async () => {
  for (const till of ['stripe', 'stripe-managed']) for (const billing of ['one-time', 'month', 'year']) {
    const manifest = { id: 'camera', name: 'Camera', version: '1.0.0', sale: { ...sale, billing, invoiceCreation: true, taxIdCollection: true, automaticTax: true, adaptivePricing: true, customerCreation: true, promotionCodes: true } };
    const params = purchaseSessionParams({ id: 'part-order', buyer: 'a'.repeat(64), quantity: 1, manifest: JSON.stringify(manifest) }, 'https://seller.example', till);
    if (till === 'stripe-managed') for (const field of ['automatic_tax', 'adaptive_pricing', 'tax_id_collection', 'invoice_creation']) assert.equal(field in params, false, field);
    assert.equal(Boolean(params.subscription_data), billing !== 'one-time');
    assert.equal(Boolean(params.payment_intent_data), billing === 'one-time');
    const session = await createCheckoutSession({ STRIPE_KEY: KEY, STRIPE_API_BASE: process.env.STRIPE_MOCK_URL }, params, { idempotencyKey: `schema-${till}-${billing}` });
    assert.ok(session.id);
  }
});


test('public media paths cannot expose private R2 even through an encoded alias', async () => {
  const f = await fixture('aliases'); try {
    const ctx = { waitUntil() {} };
    for (const path of ['/media/paid-parts/releases/camera/0.1.0.json', '/media/%70aid-parts/releases/camera/0.1.0.json']) {
      const r = await worker.fetch(new Request(`https://seller.example${path}`), f.env, ctx);
      assert.equal(r.status, 404);
    }
    const r = await f.fetcher('https://seller.example/api/purchases/grant', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', authorization: `Bearer ${'d'.repeat(64)}` } });
    assert.equal(r.status, 401);
  } finally { await f.close(); }
});

test('refund arriving before completion is terminal; failed database writes can retry the same event', async () => {
  const f = await fixture('ordering'); try {
    await f.buy(); f.charge.refunded = true; f.charge.amount_refunded = f.charge.amount;
    await f.event('charge.refunded', f.charge, 'refund-first');
    await f.event('checkout.session.completed', f.session, 'completion-last');
    assert.equal((await f.add()).purchase.status, 'refunded');
  } finally { await f.close(); }
  const g = await fixture('retry'); try {
    await g.buy(); const batch = g.env.DB.batch;
    g.env.DB.batch = async () => { throw new Error('database interrupted'); };
    await assert.rejects(g.event('checkout.session.completed', g.session, 'same-event'), /interrupted/);
    assert.equal(g.env.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_events').get().n, 0);
    g.env.DB.batch = batch;
    await g.event('checkout.session.completed', g.session, 'same-event');
    await g.event('checkout.session.completed', g.session, 'same-event');
    assert.equal((await g.add()).ok, true);
    assert.equal(g.env.DB.sql.prepare('SELECT COUNT(*) AS n FROM shop_events').get().n, 1);
  } finally { await g.close(); }
});

test('backup tampering cannot add unsigned files and a paid game licence is scoped', async () => {
  const f = await fixture('backup', { scope: 'game' }); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    mkdirSync(join(f.buyer, 'games', 'other')); writeFileSync(join(f.buyer, 'games', 'other', 'game.json'), '{}');
    const other = await f.add({ game: 'other' }); assert.equal(other.purchase.required, true); assert.match(other.why, /Ask first/);
    const privateDir = join(f.buyer, '.homie/paid-parts'); const file = join(privateDir, readdirSync(privateDir).find((p) => p.endsWith('.backup.json')));
    const backup = JSON.parse(readFileSync(file)); backup.files.push(['../../escape', Buffer.from('unsigned').toString('base64')]); writeFileSync(file, JSON.stringify(backup));
    const restored = await f.add({ offline: true }); assert.equal(restored.ok, false); assert.match(restored.why, /unlisted/);
  } finally { await f.close(); }
});


test('a subscription refund before its payment link is stored resolves through Invoice Payments', async () => {
  const f = await fixture('subscription-refund-first', { billing: 'month' }); try {
    await f.buy(); f.charge.refunded = true; f.charge.amount_refunded = f.charge.amount;
    await f.event('charge.refunded', f.charge, 'subscription-refund-first');
    await f.event('checkout.session.completed', f.session, 'subscription-completion-last');
    assert.equal((await f.add()).purchase.status, 'refunded');
  } finally { await f.close(); }
});


test('proof cannot download, expired downloads fail, and recovery revokes previous credentials', async () => {
  const f = await fixture('proof-recovery'); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    const recordFile = join(f.buyer, '.homie/paid-parts', readdirSync(join(f.buyer, '.homie/paid-parts')).find((p) => !p.includes('backup') && p !== 'identity.json'));
    const record = JSON.parse(readFileSync(recordFile));
    const file = 'https://seller.example/parts/camera/0.1.0/src/index.ts';
    const get = (token) => f.fetcher(file, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await get(record.proof)).status, 402);
    const { signGrant } = await import('../worker/purchase-crypto.mjs');
    const { signingKey } = await import('../worker/purchase-keys.mjs');
    const claims = await verifyGrant(record.token, record.jwk);
    const expired = await signGrant(await signingKey(f.env), { ...claims, exp: Math.floor(Date.now()/1000) - 1 });
    assert.equal((await get(expired)).status, 402);
    const { prepareRecovery } = await import('../lib/parts-purchase.mjs');
    assert.equal((await prepareRecovery(f.buyer, 'seller.example/camera', record.order)).ok, false);
    unlinkSync(recordFile); // Simulate losing the credential, rather than overwriting a healthy claim.
    const request = await prepareRecovery(f.buyer, 'seller.example/camera', record.order);
    assert.equal((await reissuePurchaseClaim(f.env, { ...request, receiptVerified: false })).ok, false);
    assert.equal((await reissuePurchaseClaim(f.env, { ...request, receiptVerified: true })).ok, true);
    assert.equal((await get(record.token)).status, 403);
    await authorizePurchaseTest(f.env, record.order);
    assert.equal((await f.add()).ok, true);
  } finally { await f.close(); }
});

test('a changed offer needs a new approval without changing release bytes', async () => {
  const f = await fixture('offer-price'); try {
    const before = await f.add(); const original = f.objects.get('paid-parts/releases/camera/0.1.0.json').toString();
    writeFileSync(join(f.root, 'parts/offers.json'), JSON.stringify({ camera: { price: { amount: 250000 }, active: true } }));
    buildParts(f.root, f.dist);
    const changed = await f.add({ approve: before.purchase.quote });
    assert.equal(changed.purchase.checkout, undefined); assert.notEqual(changed.purchase.quote, before.purchase.quote);
    const intent = await f.add({ approve: changed.purchase.quote });
    assert.equal((await f.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } })).status, 303);
    assert.equal(f.session.amount_subtotal, 250000);
    f.session.payment_status = 'paid'; await authorizePurchaseTest(f.env, f.session.metadata.order); await f.event('checkout.session.completed');
    assert.equal((await f.add()).ok, true);
    assert.equal(f.objects.get('paid-parts/releases/camera/0.1.0.json').toString(), original);
  } finally { await f.close(); }
});

test('tax choices, customer creation and business tax identifiers reach Checkout', () => {
  for (const automaticTax of [true, false]) for (const taxBehavior of ['inclusive', 'exclusive']) {
    const params = purchaseSessionParams({ id: 'test', quantity: 1, manifest: JSON.stringify({ id: 'camera', name: 'Camera', version: '1.0.0', sale: { ...sale, automaticTax, taxBehavior, adaptivePricing: true, promotionCodes: true, taxIdCollection: true, invoiceCreation: true, customerCreation: true } }) }, 'https://seller.example', 'stripe');
    assert.equal(params.tax_id_collection.enabled, true); assert.equal(params.customer_creation, 'always');
    assert.equal(params.automatic_tax.enabled, automaticTax); assert.equal(params.line_items[0].price_data.tax_behavior, taxBehavior);
    assert.equal(params.adaptive_pricing.enabled, true); assert.equal(params.allow_promotion_codes, true);
  }
});

test('Turnstile failure creates no rows and purchase rate limiting is opt-in', async () => {
  const f = await fixture('human-check'); try {
    const q = await f.add(); const intent = await f.add({ approve: q.purchase.quote });
    f.env.PURCHASE_VERIFY_TURNSTILE = async () => Response.json({ success: false });
    assert.equal((await f.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } })).status, 403);
    assert.equal(f.env.DB.sql.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n, 0);
    delete f.env.PURCHASE_RATE_LIMITER;
    assert.equal((await f.fetcher('https://seller.example/api/purchases/intent', { method: 'POST' })).status, 400, 'without an opted-in limiter the request reaches input validation');
  } finally { await f.close(); }
});

test('hub evidence verifies without a download capability and rejects another audience', async () => {
  const f = await fixture('hub-proof'); try {
    await f.buy(); await f.event('checkout.session.completed'); await f.add();
    const file = readdirSync(join(f.buyer, '.homie/paid-parts')).find((p) => !p.includes('backup') && p !== 'identity.json');
    const record = JSON.parse(readFileSync(join(f.buyer, '.homie/paid-parts', file)));
    const r = await f.fetcher('https://seller.example/api/purchases/grant', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${record.claim}` }, body: JSON.stringify({ audience: 'https://hub.example' }) });
    const grant = await r.json();
    await verifyGrant(grant.hubProof, record.jwk, { issuer: 'https://seller.example', proof: true, audience: 'https://hub.example' });
    await assert.rejects(verifyGrant(grant.hubProof, record.jwk, { proof: true, audience: 'https://other.example' }));
    assert.equal((await f.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { headers: { authorization: `Bearer ${grant.hubProof}` } })).status, 402);
    const checked = await f.fetcher('https://seller.example/api/purchases/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof: grant.hubProof, audience: 'https://hub.example' }) });
    assert.equal((await checked.json()).current, false, 'test purchases never count as live ratings');
  } finally { await f.close(); }
});

test('a kids catalogue preserves the separate studio till and an absent shop keeps its pages', async () => {
  const f = await fixture('kids-parts'); try {
    const { checkShop } = await import('../worker/shop-rules.mjs');
    f.cat.shop = checkShop({ till: 'stripe', currency: 'usd', items: [] }, { audience: 'kids' }).shop;
    assert.equal(f.cat.shop.purchasesTill, 'stripe');
    const q = await f.add(); assert.ok((await f.add({ approve: q.purchase.quote })).purchase.checkout);
    const req = new Request('https://seller.example/purchases/custom');
    const response = await shopRoutes(req, f.env, {}, new URL(req.url), { catalogueOf: async () => ({ studio: {}, games: [] }) });
    assert.equal(response, null);
  } finally { await f.close(); }
});

test('the studio refund window is optional and retirement stops new intents', async () => {
  const f = await fixture('refund-window', { refundWindowDays: 7 }); try {
    await f.buy(); await f.event('checkout.session.completed'); await f.add();
    const { purchasePortal } = await import('../lib/parts-purchase.mjs');
    const refund = await purchasePortal(f.buyer, 'seller.example/camera', { fetch: f.fetcher, action: 'refund' });
    assert.equal(refund.ok, true);
    const { retireResource } = await import('../worker/purchases.mjs');
    assert.equal((await retireResource(f.env, 'part', 'camera')).ok, true);
    const part = JSON.parse(f.objects.get('paid-parts/releases/camera/0.1.0.json'));
    const { quoteHash } = await import('../worker/parts-sale.mjs');
    const result = await f.fetcher('https://seller.example/api/purchases/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', quote: await quoteHash(part), buyer: 'a'.repeat(64), claimHash: 'b'.repeat(64) }) });
    assert.equal(result.status, 404);
  } finally { await f.close(); }
});


test('Stripe charge state repairs a missed subscription refund webhook', async () => {
  const f = await fixture('missed-refund', { billing: 'month', sourceTruth: true }); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    f.charge.refunded = true; f.charge.amount_refunded = f.charge.amount;
    assert.equal((await f.add()).ok, false, 'paid invoice alone cannot override its fully refunded charge');
  } finally { await f.close(); }
});


test('a price change preserves a previously purchased all-updates promise', async () => {
  const f = await fixture('mutable-update', { amount: 1000, updates: 'all' }); try {
    await f.buy(); await f.event('checkout.session.completed'); assert.equal((await f.add()).ok, true);
    const p = readPart(f.dir); p.version = '0.2.0'; writePart(f.dir, p); sharePart(f.root, 'camera');
    writeFileSync(join(f.root, 'parts/offers.json'), JSON.stringify({ camera: { '0.2.0': { amount: 500000, active: true } } }));
    buildParts(f.root, f.dist); await f.upload();
    assert.equal((await f.add()).ok, true);
  } finally { await f.close(); }
});

test('one-time licence transfer preserves payment identity and subscription payer transfer is refused', async () => {
  for (const billing of ['one-time', 'month']) {
    const f = await fixture(`transfer-${billing}`, { billing, transferable: true }); try {
      await f.buy(); await f.event('checkout.session.completed');
      const order = f.env.DB.sql.prepare('SELECT id FROM purchase_orders').get().id;
      const result = await reissuePurchaseClaim(f.env, { order, claimHash: 'a'.repeat(64), buyer: 'b'.repeat(64), receiptVerified: true });
      assert.equal(result.ok, billing === 'one-time');
      assert.equal((await f.event('checkout.session.completed', f.session, 'transfer-replay')).status, 200);
    } finally { await f.close(); }
  }
});


test('paid app, music and video parts retain discovery provenance and install into an app', async () => {
  for (const [kind, source] of [['waitlist', 'app'], ['loop', 'music'], ['video-template', 'video']]) {
    const f = await fixture(`app-media-${source}`);
    try {
      mkdirSync(join(f.root, 'apps', 'welcome'), { recursive: true });
      writeFileSync(join(f.root, 'apps', 'welcome', 'app.json'), JSON.stringify({ name: 'Welcome' }));
      mkdirSync(join(f.buyer, 'apps', 'welcome'), { recursive: true });
      writeFileSync(join(f.buyer, 'apps', 'welcome', 'app.json'), JSON.stringify({ name: 'Welcome' }));
      const p = readPart(f.dir);
      Object.assign(p, { version: '0.1.1', kind, uses: ['app', 'venue', source], from: { [source]: 'welcome', name: 'Welcome', studio: 'Part Studio' } });
      writePart(f.dir, p);
      assert.equal(sharePart(f.root, 'camera').ok, true);
      buildParts(f.root, f.dist); await f.upload();
      f.cat.games.push({ id: 'welcome', name: 'Welcome', kind: 'app' });
      const catalog = await (await f.fetcher('https://seller.example/.well-known/homie-parts.json')).json();
      assert.equal(catalog.parts[0].from[source], 'welcome');
      assert.ok(catalog.parts[0].uses.includes('app'));
      if (source === 'app') assert.equal(catalog.parts[0].from.open, 'https://seller.example/welcome/open');
      await f.buy(); await f.event('checkout.session.completed');
      const installed = await f.add({ game: 'welcome' });
      assert.equal(installed.ok, true, JSON.stringify(installed));
      assert.ok(existsSync(join(f.buyer, 'apps', 'welcome', 'credits.json')));
      assert.equal(partsPublishReport(f.buyer).ok, true);
    } finally { await f.close(); }
  }
});
