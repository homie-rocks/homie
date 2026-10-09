import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, fullOrder, mainRecord, PP, shopMod, LIVE_KEY, get, FILE } from './paid-parts-review3-common.mjs';
test('U4 an existing shop (old restricted key: no Subscriptions/Invoices permission, old webhook events) cannot start selling a monthly part', async () => {
  const w = await world('u4', { saleOpts: { billing: 'month' }, key: LIVE_KEY }); try {
    delete w.env.PURCHASE_PAYMENT_CAPABILITIES;
    w.st.deny.push('/v1/subscriptions', '/v1/invoices', '/v1/invoice_payments');
    const ready = await PP.purchaseReadiness(w.env, 'https://seller.example');
    assert.equal(ready.ready, false);
    const quote = await w.add();
    const intent = await w.add({ approve: quote.purchase.quote });
    assert.equal(intent.ok, false);
    assert.match(intent.why, /Reconnect/);
    assert.equal(w.st.sessions.size, 0, 'An old restricted key cannot take money for an unsupported subscription');
  } finally { await w.close(); }
});
test('U5 offline restore of a purchase after the seller is gone / changed mode', async () => {
  const w = await world('u5', { key: LIVE_KEY }); try {
    const b = await w.buy(); await w.event('checkout.session.completed', b.session); const a = await w.add(); assert.equal(a.ok, true, a.why);
    const off = await w.add({ offline: true }); console.log('U5 offline restore (game cave):', off.ok, off.why ?? '');
    w.env.ASSETS.fetch = async () => { throw new Error('seller gone'); };
    const off2 = await w.add({ offline: true }); console.log('U5 offline restore with the seller unreachable:', off2.ok, off2.why ?? '');
    assert.equal(off2.ok, true);
  } finally { await w.close(); }
});
