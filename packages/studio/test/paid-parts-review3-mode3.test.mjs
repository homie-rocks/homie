import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, fullOrder, bought, get, FILE, mainRecord, shopMod, PP, LIVE_KEY, TEST_KEY, offer, sync, purchaseLib } from './paid-parts-review3-common.mjs';
const acc = async (w) => { const a = await w.add(); return a.ok ? 'ok' : `no(${(a.purchase?.message ?? a.why ?? '').slice(0, 70)})`; };

test('X1 test purchase on a public site: an unapproved test buyer gets nothing protected; before and after going live', async () => {
  const w = await world('x1'); try {
    const b = await w.buy({ approveTest: false }); await w.event('checkout.session.completed', b.session); const rec = mainRecord(w.buyer);
    const g = await w.api('/api/purchases/grant', {}, rec.claim);
    const pub = { 'part.json': (await get(w, 'https://seller.example/parts/camera/0.1.0/part.json')).status, licence: (await get(w, 'https://seller.example/parts/camera/0.1.0/LICENSE.txt')).status, source: (await get(w, FILE)).status };
    console.log('X1 unapproved test order (paid with a test card): grant', g.status, g.data.message, '| public:', JSON.stringify(pub), '| order', fullOrder(w).status);
    assert.equal(g.status, 403);
    // owner approves a DIFFERENT order id / the right one
    const bad = await PP.authorizePurchaseTest(w.env, 'ord_AAAAAAAAAAAAAAAAAAAA'); const ok = await PP.authorizePurchaseTest(w.env, rec.order);
    const g2 = await w.api('/api/purchases/grant', {}, rec.claim); const dl = (await get(w, FILE, g2.data.token)).status;
    console.log('X1 approve unknown:', bad.ok, '| approve this order:', ok.ok, '| grant', g2.status, 'download', dl);
    w.env.STRIPE_KEY = LIVE_KEY;
    const g3 = await w.api('/api/purchases/grant', {}, rec.claim); const dl3 = (await get(w, FILE, g2.data.token)).status; const ap = await PP.authorizePurchaseTest(w.env, rec.order);
    const v = await w.api('/api/purchases/verify', { proof: (await (async () => { w.env.STRIPE_KEY = TEST_KEY; const x = await w.api('/api/purchases/grant', { audience: 'https://hub.example' }, rec.claim); w.env.STRIPE_KEY = LIVE_KEY; return x.data.hubProof; })()), audience: 'https://hub.example' });
    console.log('X1 shop goes LIVE: grant', g3.status, '| old 5-min token download', dl3, '| approve test order while live:', ap.ok, '| hub verify of test proof current:', v.data.current, '| offline restore still works:', (await w.add({ offline: true })).ok);
    assert.equal(g3.status, 403); assert.equal(dl3, 403); assert.equal(v.data.current, false);
  } finally { await w.close(); }
});

test('X2 a LIVE shop whose owner reconnects a TEST key (to try a new part): what happens to live buyers and live money events', async () => {
  const w = await world('x2', { key: LIVE_KEY }); try {
    const b = await bought(w); const rec = mainRecord(w.buyer); const before = await acc(w);
    w.env.STRIPE_KEY = TEST_KEY;
    const during = await acc(w); const g = await w.api('/api/purchases/grant', {}, rec.claim);
    const c = w.st.refund(b.session.payment_intent); const h = (await w.event('charge.refunded', c, undefined, true)).trim();   // owner refunds the live order in Stripe's dashboard meanwhile
    w.env.STRIPE_KEY = LIVE_KEY; const after = await acc(w);
    console.log('X2 live buyer before:', before, '| while shop is on a test key:', during, g.status, '| live refund event meanwhile:', h, '| back on live key: order', fullOrder(w).status, 'access', after);
    assert.equal(after.startsWith('no'), true, 'a live order refunded while the shop was on a test key keeps downloading for ever (the event was acknowledged and dropped)');
  } finally { await w.close(); }
});

test('X3 seller own test: what an approved test delivers; a test intent used after going live; test retirement vs live sales', async () => {
  const w = await world('x3'); try {
    const q = await w.add(); const i = await w.add({ approve: q.purchase.quote });
    w.env.STRIPE_KEY = LIVE_KEY;
    const post = await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } });
    console.log('X3 test-mode intent POSTed after the shop went live:', post.status, (await post.text()).slice(0, 80), '| sessions', w.st.sessions.size);
    w.env.STRIPE_KEY = TEST_KEY; await PP.retireResource(w.env, 'part', 'camera'); w.env.STRIPE_KEY = LIVE_KEY;
    const q2 = await w.api('/api/purchases/intent', { kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claimHash: 'b'.repeat(64), quote: q.purchase.quote, quantity: 1 });
    console.log('X3 part retired in TEST, shop now LIVE: new live intent ->', q2.status, q2.data.message ?? 'ok');
    assert.equal(post.status, 409); assert.equal(q2.status, 200);
  } finally { await w.close(); }
});
