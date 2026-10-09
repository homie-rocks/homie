import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payWithWallet } from '../lib/purchase-wallet.mjs';
import { world, LIVE_KEY, addPart } from './paid-parts-review4-harness.mjs';

for (const client of ['link-cli', 'purl', 'tempo']) {
  for (const refusal of ['not authenticated', 'insufficient funds', 'spend limit exceeded', 'user rejected', 'unsupported network']) {
    test(`${client}: ${refusal} offers hosted Checkout`, async () => {
      const w = await world(`wallet-${client}-${refusal.replaceAll(' ', '-')}`, { key: LIVE_KEY });
      try {
        const walletPay = (url, body) => payWithWallet(url, body, { client, run: async () => { throw Object.assign(new Error(refusal), { stderr: refusal, code: 1 }); } });
        const add = (options = {}) => addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), fetch: w.fetcher, wallet: client, walletPay, ...options });
        const quote = await add();
        const refused = await add({ approve: quote.purchase.quote });
        assert.ok(refused.purchase.walletUnavailable, JSON.stringify(refused));
        assert.match(refused.purchase.message, /corrected wallet/);
        const hosted = await add({approve: quote.purchase.quote, wallet: null});
        assert.ok(hosted.purchase.checkout, JSON.stringify(hosted));
        assert.match(hosted.purchase.message, /Hosted Checkout fallback/);
        assert.equal(w.st.pis.size, 0);
      } finally { await w.close(); }
    });
  }
  test(`${client}: ambiguous process failures prohibit a second payment`, async () => {
    for (const failure of [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), Object.assign(new Error('bad output'), { stdout: '{' })]) {
      const result = await payWithWallet('https://seller.example/resource', { amount: 100 }, { client, run: async () => { throw failure; } });
      assert.equal(result.uncertain, true);
      assert.match(result.data.detail, /do not pay again/);
    }
  });
}

for (const [name, saleOpts] of Object.entries({ recurring: { billing: 'month' }, currency: { currency: 'eur' }, automaticTax: { automaticTax: true }, exclusiveTax: { taxBehavior: 'exclusive' } })) {
  test(`${name}: hosted Checkout is labelled and no incompatible wallet is invoked`, async () => {
    const w = await world(`fallback-${name}`, { key: LIVE_KEY, saleOpts });
    try {
      const quote = await w.add({ wallet: 'purl' });
      const result = await w.add({ approve: quote.purchase.quote, wallet: 'purl', walletPay: () => assert.fail('incompatible offer reached wallet') });
      if (result.purchase.walletUnavailable && !result.purchase.checkout) {
        const hosted = await w.add({approve:quote.purchase.quote});
        assert.ok(hosted.purchase.checkout, JSON.stringify(hosted));
      } else assert.ok(result.purchase.checkout, JSON.stringify(result));
      assert.match(result.purchase.message, /[Hh]osted Checkout fallback/);
    } finally { await w.close(); }
  });
}

for (const refusal of ['verification-failed', 'malformed-credential', 'payment-expired', 'invalid-challenge', 'payment-action-required', 'payment-method-unsupported']) {
  test(`${refusal}: a definitive protocol refusal offers hosted Checkout`, async () => {
    const w = await world(`protocol-${refusal}`, { key: LIVE_KEY });
    try {
      const quote = await w.add({ wallet: 'link-cli' });
      const result = await w.add({ approve: quote.purchase.quote, wallet: 'link-cli', walletPay: async () => ({ data: { type: `https://paymentauth.org/problems/${refusal}`, detail: refusal } }) });
      if (result.purchase.walletUnavailable && !result.purchase.checkout) {
        const hosted = await w.add({approve:quote.purchase.quote});
        assert.ok(hosted.purchase.checkout, JSON.stringify(hosted));
      } else assert.ok(result.purchase.checkout, JSON.stringify(result));
      assert.match(result.purchase.message, /[Hh]osted Checkout fallback/);
    } finally { await w.close(); }
  });
}

test('Managed Payments advertises and returns hosted Checkout without requesting a machine payment', async () => {
  const { configureMachine } = await import('./paid-parts-review4-harness.mjs');
  const w = await world('managed-fallback', { key: LIVE_KEY, shop: { till: 'stripe-managed', currency: 'usd', items: [] } });
  try {
    await configureMachine(w, { profile: 'profile_example' });
    const catalog = await (await w.fetcher('https://seller.example/parts/catalog.json')).json();
    assert.deepEqual(catalog.parts[0].purchase.methods, []);
    const quote = await w.add({ wallet: 'link-cli' });
    const result = await w.add({ approve: quote.purchase.quote, wallet: 'link-cli', walletPay: async (url, body) => ({ data: await (await w.fetcher(url, { method: 'POST', body: JSON.stringify(body) })).json() }) });
    assert.ok(result.purchase?.checkout, JSON.stringify(result));
    assert.match(result.purchase.message, /Managed Payments.*Hosted Checkout fallback/);
    assert.equal(w.st.pis.size, 0);
  } finally { await w.close(); }
});
