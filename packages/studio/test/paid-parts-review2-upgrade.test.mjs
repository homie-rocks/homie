import { test } from 'node:test'; import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite'; import { readFileSync, readdirSync } from 'node:fs'; import { join } from 'node:path';
import { world, db, PP, shopMod, SHOP_MIGRATION, TEST_KEY } from './paid-parts-review2-fixture.mjs';
const H = new URL('../../..', import.meta.url).pathname;

test('U1 an existing player shop: no parts migration yet, old key; every new event type and a foreign refund', async () => {
  const w = await world('u1', { migrate: false }); try {
    w.st.deny = ['/v1/invoice_payments', '/v1/subscriptions', '/v1/invoices']; const out = {};
    const pi = w.st.pay(500, {}); const c = w.st.chargeOf(pi.id);
    for (const [type, obj] of [['charge.refunded', { ...c, refunded: true, amount_refunded: 500 }], ['refund.created', { id: 're_9', charge: c.id, payment_intent: pi.id }], ['charge.dispute.created', { id: 'dp_9', payment_intent: pi.id }], ['invoice.paid', { id: 'in_9', parent: { subscription_details: { subscription: 'sub_foreign', metadata: { order: 'x' } } } }], ['customer.subscription.deleted', { id: 'sub_foreign', metadata: {} }], ['checkout.session.completed', { id: 'cs_9', metadata: { homie: 'purchase-v1', order: 'ord_' + 'A'.repeat(20) }, payment_status: 'paid' }]]) { const before = w.st.calls.length; out[type] = `${await w.event(type, obj)} | stripe calls ${w.st.calls.length - before}`; }
    console.log('U1 (no parts tables)', JSON.stringify(out, null, 1));
    assert.ok(!Object.values(out).some((v) => /THREW|^5/.test(v)));
  } finally { await w.close(); }
  const w2 = await world('u1b'); try {  // tables exist, no part orders
    w2.st.deny = ['/v1/invoice_payments', '/v1/subscriptions', '/v1/invoices']; const pi = w2.st.pay(500, {}); const c = w2.st.chargeOf(pi.id); const before = w2.st.calls.length;
    console.log('U1b (tables, zero part orders) foreign refund:', await w2.event('charge.refunded', { ...c, refunded: true, amount_refunded: 500 }), '| stripe calls', w2.st.calls.length - before);
    // a studio WITH part orders and an old key: foreign refund
    const b = await w2.buy(); w2.st.deny = []; await w2.event('checkout.session.completed', b.session); w2.st.deny = ['/v1/invoice_payments', '/v1/subscriptions', '/v1/invoices'];
    const b2 = w2.st.calls.length; console.log('U1c (has part orders, old key) foreign refund:', await w2.event('charge.refunded', { ...c, refunded: true, amount_refunded: 500 }), '| stripe calls', w2.st.calls.slice(b2).join(', '));
  } finally { await w2.close(); }
});

test('U2 migrations: template files equal the constants; order; idempotent; half applied', async () => {
  const dir = join(H, 'template/site/migrations'); const files = readdirSync(dir).sort(); console.log('U2 template migrations:', files.join(' '));
  assert.equal(readFileSync(join(dir, '0015_purchases.sql'), 'utf8').trim(), PP.PURCHASE_MIGRATION.trim()); assert.equal(readFileSync(join(dir, '0016_purchase_facts.sql'), 'utf8').trim(), PP.PURCHASE_STATE.trim());
  const sql = new DatabaseSync(':memory:'); sql.exec(SHOP_MIGRATION); sql.exec(PP.PURCHASE_MIGRATION); sql.exec(PP.PURCHASE_MIGRATION); sql.exec(PP.PURCHASE_STATE); sql.exec(PP.PURCHASE_STATE);
  const s2 = new DatabaseSync(':memory:'); s2.exec(SHOP_MIGRATION); let e = ''; try { s2.exec(PP.PURCHASE_STATE); } catch (x) { e = x.message; } console.log('U2 0011 without 0010:', e || 'ok', '| tables created before the failure:', s2.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'part_%'").all().map((r) => r.name).join(','));
  assert.deepEqual(s2.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'part_%'").all(), []);
  s2.exec(PP.PURCHASE_MIGRATION); s2.exec(PP.PURCHASE_STATE); console.log('U2 re-run after half-apply: ok');
  console.log('U2 indexes:', sql.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name LIKE 'part_%'").all().map((r) => r.name).join(', '));
});

test('U3 office view for a shop that sells no parts: Stripe calls and added fields', async () => {
  const w = await world('u3'); try {
    w.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT)'); const cat = { ...w.cat }; const env = { ...w.env, ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
    const before = w.st.calls.length; const o = await shopMod.shopOffice(env, cat, 'https://seller.example');
    console.log('U3 no offers/no orders: parts field', JSON.stringify(o.parts), '| stripe calls', w.st.calls.length - before);
    const b2 = w.st.calls.length; const o2 = await shopMod.shopOffice(w.env, cat, 'https://seller.example');
    assert.equal(w.st.calls.length, b2, 'office load makes no permission-probe calls');
    console.log('U3 seller with an offer: parts', JSON.stringify(o2.parts), '| stripe calls per office load', w.st.calls.slice(b2).join(', '));
  } finally { await w.close(); }
});
