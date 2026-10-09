import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, PP, partsCommand, mainRecord, LIVE_KEY } from './paid-parts-review2-fixture.mjs';
import { cancelSubscription, closeCheckoutSession, refundPayment } from '../worker/stripe.mjs';
import { purchaseSessionParams } from '../worker/purchases.mjs';

for (const till of ['stripe', 'stripe-managed']) {
  test(`${till}: mutations tolerate already canceled, refunded and expired objects`, async () => {
    const w = await world(`idempotent-${till}`, { shop: { till }, saleOpts: { billing: 'month' } });
    try {
      const { session } = await w.buy(); await w.event('checkout.session.completed', session);
      const sub = w.st.subs.get(session.subscription); const payment = w.order().payment;
      await cancelSubscription(w.env, sub.id); await cancelSubscription(w.env, sub.id);
      assert.equal(w.st.calls.filter((c) => c.startsWith('DELETE ')).length, 1);
      await refundPayment(w.env, payment); await refundPayment(w.env, payment);
      assert.equal(w.st.calls.filter((c) => c === 'POST /v1/refunds').length, 1);
      session.status = 'open'; await closeCheckoutSession(w.env, session.id); await closeCheckoutSession(w.env, session.id);
      assert.equal(w.st.calls.filter((c) => c.endsWith('/expire')).length, 1);
    } finally { await w.close(); }
  });
  test(`${till}: seller settings reach only supported Checkout parameters`, () => {
    const sale = { amount: 1000, currency: 'usd', billing: 'one-time', scope: 'studio', refund: 'Ask', intentMinutes: 90, invoiceCreation: true, taxIdCollection: true, customerCreation: true, automaticTax: true, adaptivePricing: true };
    const params = purchaseSessionParams({ id: 'order', quantity: 1, expires_at: 5500, manifest: JSON.stringify({ sale }) }, 'https://seller.example', till);
    assert.equal(params.expires_at, 5500);
    for (const field of ['invoice_creation','tax_id_collection','automatic_tax','adaptive_pricing']) assert.equal(field in params, till === 'stripe');
    const defaults = purchaseSessionParams({ id: 'order', quantity: 1, manifest: JSON.stringify({ sale: { amount: 1000, currency: 'usd', billing: 'one-time' } }) }, 'https://seller.example', till);
    for (const field of ['invoice_creation','tax_id_collection','customer_creation']) assert.equal(field in defaults, false);
  });
}

test('a price change, release withdrawal and part withdrawal expire open sessions', async () => {
  for (const action of ['price', 'release', 'part']) {
    const w = await world(`expire-${action}`);
    try {
      const quote = await w.add(); const intent = await w.add({ approve: quote.purchase.quote });
      await w.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } });
      const session = [...w.st.sessions.values()][0];
      const flags = new Map(action === 'price' ? [['amount', '2500']] : action === 'release' ? [['release', '0.1.0'], ['withdraw', true]] : [['withdraw', true]]);
      await partsCommand(w.root, 'offer', ['parts', 'offer', 'camera'], flags); await w.republish();
      assert.equal((await PP.expirePurchaseCheckouts(w.env)).expired, 1);
      assert.equal(session.status, 'expired');
      assert.equal((await PP.expirePurchaseCheckouts(w.env)).expired, 0);
    } finally { await w.close(); }
  }
});

test('only explicitly retained releases stay on sale and all use the current price', async () => {
  const w = await world('keep-sale');
  try {
    await partsCommand(w.root, 'offer', ['parts', 'offer', 'camera'], new Map([['release','0.1.0'], ['keep-on-sale',true], ['amount','2500']]));
    await w.release('0.2.0');
    const rows = JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0].releases;
    assert.ok(rows.every((r) => r.onSale && r.offer.amount === 2500));
  } finally { await w.close(); }
});

test('a proration after a refunded base invoice does not buy the whole period', async () => {
  const w = await world('proration', { saleOpts: { billing: 'month' } });
  try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session);
    const sub = w.st.subs.get(session.subscription); const base = w.st.invoices.get(sub.latest_invoice);
    const charge = w.st.refund(w.order().payment); await w.event('charge.refunded', charge);
    const adjustment = w.st.invoiceFor(sub, { total: 10 }); adjustment.billing_reason = 'subscription_update';
    adjustment.lines.data[0].period = base.lines.data[0].period;
    adjustment.lines.data[0].parent.subscription_item_details.proration = true;
    await w.event('invoice.paid', adjustment);
    assert.equal((await w.add()).ok, false); assert.equal(w.order().status, 'refunded');
  } finally { await w.close(); }
});

test('self-service subscription refunds count from the payment being refunded', async () => {
  const w = await world('refund-window', { saleOpts: { billing: 'month', refundWindowDays: 7 } });
  try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session); await w.add();
    w.sql.prepare('UPDATE purchase_orders SET paid_at = ?').run(Date.now() - 40 * 86400000);
    const next = w.st.invoiceFor(w.st.subs.get(session.subscription)); await w.event('invoice.paid', next);
    const r = await w.api('/api/purchases/refund', {}, mainRecord(w.buyer).claim);
    assert.equal(r.data.ok, true); assert.equal(w.st.chargeOf(next.pi).refunded, true);
  } finally { await w.close(); }
});

test('rotation refuses transient key endpoint failure instead of replacing retained keys', async () => {
  const w = await world('key-failure');
  try {
    for (const status of [403,404,500,503]) await assert.rejects(partsCommand(w.root, 'keys', ['parts','keys'], new Map(), { fetch: async () => new Response('', { status }) }), /Cannot read/);
    await assert.rejects(partsCommand(w.root, 'keys', ['parts','keys'], new Map(), { fetch: async () => Response.json({ keys: Array(32).fill({}) }) }), /32-key/);
  } finally { await w.close(); }
});

test('retirement cancels billing but honors the completed paid period', async () => {
  const w = await world('retire-retry', { saleOpts: { billing: 'month' } });
  try {
    const { session } = await w.buy(); const sub = w.st.subs.get(session.subscription);
    await w.event('invoice.paid', w.st.invoices.get(sub.latest_invoice));
    await PP.retireResource(w.env, 'part', 'camera');
    w.st.deny = ['POST /v1/refunds'];
    assert.match(await w.event('checkout.session.completed', session), /^200/);
    const record = mainRecord(w.buyer);
    assert.equal((await w.api('/api/purchases/grant', {}, record.claim)).status, 200);
    w.st.deny = [];
    assert.match(await w.event('checkout.session.completed', session), /^200/);
    assert.equal(sub.status, 'canceled');
    assert.equal(w.order().status, 'fulfilled');
    assert.equal(w.st.chargeOf(w.order().payment).refunded, false);
  } finally { await w.close(); }
});

test('Stripe subscription status overrides a poisoned local paid-through flag', async () => {
  const w = await world('stripe-status', { saleOpts: { billing: 'month' } });
  try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session); await w.add();
    const record = mainRecord(w.buyer);
    w.st.subs.get(session.subscription).status = 'unpaid';
    w.sql.prepare('UPDATE purchase_orders SET paid_until = ?').run(Date.now() + 365 * 86400000);
    // Provider state is reconciled once per five-minute grant, never for each file.
    assert.equal((await w.fetcher('https://seller.example/parts/camera/0.1.0/src/index.ts', { headers: { authorization: `Bearer ${record.token}` } })).status, 200);
    assert.equal((await w.add()).ok, false);
  } finally { await w.close(); }
});

test('the seller may include additional upgrades without revoking promised ones', async () => {
  const w = await world('included-upgrade', { saleOpts: { updates: 'none' } });
  try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session); await w.add();
    await w.release('0.2.0'); assert.equal((await w.add()).ok, false);
    await partsCommand(w.root, 'offer', ['parts','offer','camera'], new Map([['release','0.2.0'],['upgrade','included']])); await w.republish();
    assert.equal((await w.add()).ok, true);
    await partsCommand(w.root, 'offer', ['parts','offer','camera'], new Map([['release','0.2.0'],['upgrade','paid']])); await w.republish();
    assert.equal((await w.add()).ok, true, 'an already granted release stays granted');
  } finally { await w.close(); }
});


test('live delivery needs payment, while test retirement cannot close the live offer', async () => {
  const w = await world('live-delivery', { key: LIVE_KEY });
  try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session);
    assert.equal((await w.add()).ok, true);
    assert.equal(w.sql.prepare("SELECT COUNT(*) AS n FROM purchase_test_approvals").get().n, 0);
    const rec = mainRecord(w.buyer); assert.equal(rec.mode, 'live');
  } finally { await w.close(); }
  const t = await world('test-retirement');
  try {
    await PP.retireResource(t.env, 'part', 'camera'); t.env.STRIPE_KEY = LIVE_KEY;
    const q = await t.add(); const intent = await t.add({ approve: q.purchase.quote });
    assert.ok(intent.purchase.checkout);
  } finally { await t.close(); }
});


test('a price edit does not reopen a withdrawn offer', async () => {
  const w = await world('withdraw-price');
  try {
    for (const flags of [new Map([['withdraw',true]]), new Map([['amount','2500']])]) await partsCommand(w.root, 'offer', ['parts','offer','camera'], flags);
    await w.republish();
    assert.equal(JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0].releases[0].onSale, false);
    await partsCommand(w.root, 'offer', ['parts','offer','camera'], new Map([['on-sale',true]])); await w.republish();
    assert.equal(JSON.parse(readFileSync(join(w.dist,'parts/index.json'))).parts[0].releases[0].onSale, true);
  } finally { await w.close(); }
});


test('direct guest receipts can be reissued and a fully discounted Checkout needs no PaymentIntent', async () => {
  const w = await world('guest-discount');
  try {
    const { session } = await w.buy(); session.customer = null; session.payment_intent = null; session.amount_total = 0; session.payment_status = 'no_payment_required';
    assert.match(await w.event('checkout.session.completed', session), /^200/);
    assert.equal((await w.add()).ok, true);
    assert.equal(w.order().payment, null);
    assert.equal((await PP.reissuePurchaseClaim(w.env, { order: session.metadata.order, claimHash: 'e'.repeat(64), receiptVerified: true })).ok, true);
  } finally { await w.close(); }
});
