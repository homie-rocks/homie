import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, fullOrder, mainRecord, shopMod, PP, purchaseLib, partsCommand, flags, offer, sync, LIVE_KEY, get } from './paid-parts-review3-common.mjs';
test('I1 buy, deliver, verify, update, refund and recover with every host blocked except the seller, Stripe and Cloudflare Turnstile', async () => {
  const real = globalThis.fetch; const hosts = new Map(); const blocked = [];
  const w = await world('i1', { key: LIVE_KEY, saleOpts: { updates: 'all', refundWindowDays: 14 } });
  const stripeHost = new URL(w.st.base).host;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url); const h = u.host;
    hosts.set(h, (hosts.get(h) ?? 0) + 1);
    if (h === stripeHost) return real(input, init);
    if (h === 'seller.example') return w.fetcher(input, init);
    if (h === 'challenges.cloudflare.com') return Response.json({ success: true, hostname: 'seller.example', action: 'purchase-checkout' });
    blocked.push(u.href); throw new TypeError('fetch failed: host blocked ' + h);
  };
  try {
    delete w.env.PURCHASE_VERIFY_TURNSTILE;                       // the Worker's own default: global fetch
    const strip = ({ fetch, ...o }) => o;
    const { addPart } = await import('./paid-parts-review3-harness.mjs');
    const add = (o = {}, ref = 'seller.example/camera') => addPart(w.buyer, ref, { game: 'cave', npm: () => ({ status: 0 }), ...o });   // NO injected fetch: the buyer tool's own default
    const steps = {};
    const q = await add(); steps.quote = q.purchase?.price;
    const i = await add({ approve: q.purchase.quote }); steps.checkoutOnSeller = new URL(i.purchase.checkout).host;
    const page = await globalThis.fetch(i.purchase.checkout); steps.reviewPage = page.status; const html = await page.text();
    steps.pageLoadsFrom = [...new Set([...html.matchAll(/(?:src|href)="(https:\/\/[^/"]+)/g)].map((m) => m[1]))].join(',');
    const post = await globalThis.fetch(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' }, redirect: 'manual' }); steps.acceptRedirectsTo = new URL(post.headers.get('location')).host;
    const s = w.st.complete([...w.st.sessions.keys()][0]); steps.webhook = (await w.event('checkout.session.completed', s)).trim();
    const a = await add(); steps.deliver = a.ok ? `ok ${a.files} files verified` : a.why;
    const rec = mainRecord(w.buyer);
    const g = await w.api('/api/purchases/grant', { audience: 'https://any-hub.example' }, rec.claim);
    steps.verify = JSON.stringify((await w.api('/api/purchases/verify', { proof: g.data.hubProof, audience: 'https://any-hub.example' })).data.current);
    await w.release('0.2.0'); const up = await add(); steps.update = up.ok ? `ok ${up.was} -> ${up.version}` : (up.why ?? up.purchase?.message);
    steps.offline = (await add({ offline: true }, 'seller.example/camera@0.2.0')).ok;
    const rc = await w.api('/api/purchases/recover', {}, rec.claim); steps.recover = rc.status;
    const newClaim = 'c'.repeat(64); const re = await PP.reissuePurchaseClaim(w.env, { order: rec.order, claimHash: await (await import('./paid-parts-review3-harness.mjs')).sale$.digest(newClaim), receiptVerified: true }); steps.reissue = re.ok;
    steps.oldClaimAfterReissue = (await w.api('/api/purchases/grant', {}, rec.claim)).status; steps.newClaim = (await w.api('/api/purchases/grant', {}, newClaim)).status;
    const rf = await w.api('/api/purchases/refund', {}, newClaim); steps.refund = `${rf.status} ${rf.data.status ?? rf.data.message}`;
    steps.afterRefund = (await w.api('/api/purchases/grant', {}, newClaim)).status;
    console.log('I1 steps:', JSON.stringify(steps, null, 1).replace(/\n\s*/g, ' '));
    console.log('I1 hosts contacted:', JSON.stringify([...hosts]), '| blocked attempts:', JSON.stringify(blocked));
    console.log('I1 Stripe calls:', [...new Set(w.st.calls.map((c) => c.split('?')[0].replace(/_[0-9]{4}/g, '_N').replace(/ord_\w+/, 'ord')))].join(' ; '));
    assert.deepEqual(blocked, []); assert.match(steps.deliver, /^ok/); assert.match(String(steps.update), /^ok/); assert.equal(steps.afterRefund, 402);
  } finally { globalThis.fetch = real; await w.close(); }
});
