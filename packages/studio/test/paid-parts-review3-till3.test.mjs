import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, PP, stripeMod, baseSale, mainRecord, bought, fullOrder } from './paid-parts-review3-common.mjs';
const MOCK = process.env.STRIPE_MOCK_URL ?? 'http://127.0.0.1:12111';
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') flat(v, p ? `${p}.${Array.isArray(o) ? '' : ''}${k}` : k, out); else out[p ? `${p}.${k}` : k] = v; } return out; };
test('L1 every Checkout parameter sent, per till and billing, with every seller option on; accepted by stripe-mock', async () => {
  const all = { automaticTax: true, taxBehavior: 'exclusive', adaptivePricing: true, promotionCodes: true, invoiceCreation: true, customerCreation: true, taxIdCollection: true, intentMinutes: 45 };
  for (const till of ['stripe', 'stripe-managed']) for (const billing of ['one-time', 'month', 'year']) {
    const o = { id: 'ord_AAAAAAAAAAAAAAAAAAAA', buyer: 'a'.repeat(64), quantity: 1, game: null, manifest: JSON.stringify({ id: 'camera', name: 'Camera', version: '0.1.0' }), offer: JSON.stringify({ ...baseSale, ...all, billing }) };
    const params = PP.purchaseSessionParams(o, 'https://seller.example', till);
    const keys = [...new Set(Object.keys(flat(params)).map((k) => k.replace(/\.\d+\./g, '[].')))];
    let mock = 'not run';
    try { const s = await stripeMod.createCheckoutSession({ STRIPE_KEY: `sk_test_${'A1b2C3d4'.repeat(4)}`, STRIPE_API_BASE: MOCK }, params, { idempotencyKey: `l1-${till}-${billing}` }); mock = s.id ? 'accepted' : 'no id'; } catch (e) { mock = 'REFUSED ' + e.message; }
    console.log(`L1 [${till} / ${billing}] stripe-mock: ${mock}\n     ${keys.join(', ')}`);
    assert.equal(mock, 'accepted');
    if (till === 'stripe-managed') for (const banned of ['tax_id_collection', 'automatic_tax', 'adaptive_pricing', 'invoice_creation']) assert.equal(banned in params, false, banned);
  }
});
test('L2 the Managed Payments till end to end against the stand-in: portal, refund, cancel', async () => {
  const w = await world('l2', { saleOpts: { billing: 'month', refundEndsSubscription: true, refundWindowDays: 14 }, shop: { till: 'stripe-managed', currency: 'usd', items: [] } }); try {
    await bought(w); const rec = mainRecord(w.buyer);
    const form = w.st.reqs.find((r) => r.path === '/v1/checkout/sessions').form;
    console.log('L2 managed session form keys:', Object.keys(form).join(', '));
    const portal = await w.api('/api/purchases/portal', {}, rec.claim); const refund = await w.api('/api/purchases/refund', {}, rec.claim);
    console.log('L2 portal:', JSON.stringify(portal.data), '| buyer refund:', refund.status, JSON.stringify(refund.data).slice(0, 100), '| mutations:', w.st.reqs.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path} idem=${r.idem}`).join(' ; '));
  } finally { await w.close(); }
});
test('L3 a transient Stripe failure when opening Checkout, then the person presses the button again', async () => {
  const w = await world('l3'); try {
    const q = await w.add(); const i = await w.add({ approve: q.purchase.quote });
    w.st.failOnce.push({ path: '/v1/checkout/sessions', method: 'POST', status: 500 });
    let first; try { const r = await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); first = r.status; } catch (e) { first = 'THREW ' + e.message.slice(0, 50); }
    await new Promise((r) => setTimeout(r, 2100));
    let second; try { const r = await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); second = `${r.status} ${r.status === 303 ? '' : (await r.text()).slice(0, 160)}`; } catch (e) { second = 'THREW ' + e.message.slice(0, 120); }
    const sent = w.st.reqs.filter((r) => r.path === '/v1/checkout/sessions' && r.method === 'POST').map((r) => Number(r.form.expires_at) - Math.floor(Date.now() / 1000));
    console.log('L3 first press:', first, '| second press 2 s later:', second, '| expires_at minus now at each call (s), Stripe minimum 1800:', sent.join(', '), '| order', fullOrder(w)?.status);
    assert.match(String(second), /^303/, 'the stored deadline is now under Stripe\'s 30-minute minimum, so the retry can never open Checkout');
  } finally { await w.close(); }
});
