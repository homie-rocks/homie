import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { world, offer, index, view, offersFile, fullOrder, bought, sync, mainRecord, records, buildParts, readPart, writePart, PP, sale$, get, FILE } from './paid-parts-review3-common.mjs';

test('P1 a new release whose part.json changes non-price sale terms: what is actually sold', async () => {
  const w = await world('p1'); try {
    const logs = [];
    const q = readPart(w.dir); q.version = '0.2.0'; Object.assign(q.sale, { updates: 'none', refund: 'No refunds after 14 days.', billing: 'month', scope: 'seat', transferable: true, currency: 'eur', amount: 1000 }); writePart(w.dir, q);
    await w.publish(); buildParts(w.root, w.dist, { log: (l) => logs.push(l) });
    const r = index(w).releases.find((x) => x.version === '0.2.0');
    const diff = Object.keys(r.sale).filter((k) => JSON.stringify(r.sale[k]) !== JSON.stringify(r.offer[k]));
    console.log('P1 0.2.0 manifest sale vs offer sold, differing fields:', diff.join(','), '| sold:', sale$.priceWords(r.offer), 'updates', r.offer.updates, '| part.json says:', sale$.priceWords(r.sale), 'updates', r.sale.updates);
    console.log('P1 build warnings:', JSON.stringify(logs.filter((l) => /warn/i.test(l))));
    const quote = await w.add(); console.log('P1 buyer is quoted:', quote.purchase?.price, '| part page index.sale:', sale$.priceWords(index(w).sale));
    assert.deepEqual(diff, [], 'the seller changed billing, scope, currency, refund text and update promise for the new release; the shop silently sells the old terms, with no warning');
  } finally { await w.close(); }
});

test('P2 the buyer paid BEFORE a price change; the completion is reconciled AFTER it (late webhook, sync-offers, or grant)', async () => {
  const bad = [];
  for (const how of ['sync-offers', 'grant', 'webhook']) {
    const w = await world('p2' + how); try {
      const b = await w.buy();                        // paid on Stripe; webhook not delivered yet
      await offer(w, { amount: '2500' }); await w.republish();
      let out;
      if (how === 'sync-offers') out = JSON.stringify(await sync(w));
      if (how === 'grant') out = JSON.stringify((await w.add()).purchase?.message ?? 'added');
      if (how === 'webhook') out = await w.event('checkout.session.completed', b.session);
      const o = fullOrder(w); const a = await w.add();
      console.log(`P2 [${how}] ->`, out.trim(), '| order', o.status, '| Stripe refunds issued:', w.st.refunds.length, '| charge refunded:', w.st.chargeOf(b.session.payment_intent).refunded, '| add:', a.ok, a.purchase?.message ?? a.why ?? '');
      bad.push(`${how}:${o.status}`);
    } finally { await w.close(); }
  }
  assert.deepEqual(bad, ['sync-offers:paid', 'grant:fulfilled', 'webhook:paid'], 'a purchase paid at the accepted price before the change is refunded and voided when its completion is processed after the change');
});

test('P2b same, but the only thing that changed is a NEW RELEASE at the same price (supersession)', async () => {
  const w = await world('p2b'); try {
    const b = await w.buy();
    await w.release('0.2.0');
    const h = await w.event('checkout.session.completed', b.session); const o = fullOrder(w);
    console.log('P2b paid 0.1.0, then 0.2.0 published at the same price, then webhook:', h.trim(), '| order', o.status, '| refunds', w.st.refunds.length);
    assert.equal(o.status, 'paid');
  } finally { await w.close(); }
});

test('P2c transient failure reading the static index while a completion is reconciled', async () => {
  const w = await world('p2c'); try {
    const b = await w.buy(); const real = w.env.ASSETS.fetch;
    w.env.ASSETS.fetch = async () => new Response('', { status: 503 });
    const h = await w.event('checkout.session.completed', b.session); w.env.ASSETS.fetch = real;
    const o = fullOrder(w); const a = await w.add();
    console.log('P2c ASSETS 503 during completion:', h.trim(), '| order', o.status, '| refunds', w.st.refunds.length, '| add later:', a.ok, a.purchase?.message ?? a.why ?? '');
    assert.equal(o.status, 'paid', 'a transient asset read failure refunds a valid purchase and marks it invalid for good');
  } finally { await w.close(); }
});

test('P3 a buyer whose licence does not cover a new release: the price the assistant is told to ask about', async () => {
  const w = await world('p3', { saleOpts: { updates: 'none' } }); try {
    await bought(w);
    await offer(w, { amount: '2500' }); await w.release('0.2.0');
    const r = await w.add();
    console.log('P3 part_add for 0.2.0 ->', JSON.stringify({ message: r.purchase?.message, price: r.purchase?.price, quote: r.purchase?.quote?.slice(0, 12), checkout: r.purchase?.checkout?.slice(0, 60) }));
    const p = JSON.parse(await (await get(w, 'https://seller.example/parts/camera/0.2.0/part.json')).text());
    const trueQuote = await sale$.quoteHash(p, 1, null, index(w).releases.at(-1).offer);
    console.log('P3 that quote hash is for:', sale$.priceWords(index(w).releases.at(-1).offer), '| matches new offer quote:', r.purchase?.quote === trueQuote);
    assert.match(r.purchase?.price ?? '', /25\.00/, 'the quote to approve is the new 25.00 offer but the price shown beside it is the old 10.00');
  } finally { await w.close(); }
});

test('P4 many releases under one offer; keep-on-sale; per-release flags', async () => {
  const w = await world('p4'); try {
    await w.release('0.2.0'); await w.release('0.3.0');
    console.log('P4 three releases        :', view(w));
    await offer(w, { release: '0.1.0', 'keep-on-sale': true }); await w.republish(); console.log('P4 keep 0.1.0 on sale    :', view(w));
    await offer(w, { amount: '4000' }); await w.republish(); console.log('P4 price 40.00           :', view(w));
    await offer(w, { release: '0.1.0', upgrade: 'included' }); await w.republish(); console.log('P4 mark 0.1.0 upgrade incl:', view(w), '| entry', JSON.stringify(offersFile(w).camera.releases['0.1.0']));
    const kept = index(w).releases.find((r) => r.version === '0.1.0').onSale;
    await offer(w, { withdraw: true }); await w.republish(); console.log('P4 withdraw whole offer  :', view(w));
    await offer(w, { amount: '5000' }); await w.republish(); console.log('P4 price edit, withdrawn  :', view(w));
    await offer(w, { 'on-sale': true }); await w.republish(); console.log('P4 on-sale again         :', view(w));
    assert.equal(kept, true, 'setting --upgrade on a release silently drops its --keep-on-sale');
  } finally { await w.close(); }
});

test('P5 withdrawal and price change expire open Checkout Sessions; a completed one is not expired', async () => {
  const w = await world('p5'); try {
    const q = await w.add(); const i = await w.add({ approve: q.purchase.quote });
    const opened = await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); assert.equal(opened.status, 303);
    const s = [...w.st.sessions.values()][0]; console.log('P5 expires_at - now (s):', Number(s.form.expires_at) - Math.floor(Date.now() / 1000), '| idempotency key:', w.st.reqs.find((r) => r.path === '/v1/checkout/sessions').idem);
    await offer(w, { withdraw: true }); await w.republish();
    const r = await sync(w); console.log('P5 sync after withdraw:', JSON.stringify(r), '| session', s.status, '| order', fullOrder(w).status, '| expire idem:', w.st.reqs.find((x) => x.path.endsWith('/expire'))?.idem);
    const r2 = await sync(w); console.log('P5 sync again:', JSON.stringify(r2));
    const again = await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); console.log('P5 buyer re-posts the review page:', again.status, (await again.text()).slice(0, 90));
    assert.equal(s.status, 'expired');
  } finally { await w.close(); }
});

test('P6 buyer rights after later seller changes: updates all / major / none; withdraw; unshare; retire; rotate; included upgrade then un-included', async () => {
  for (const updates of ['all', 'major', 'none']) {
    const w = await world('p6' + updates, { saleOpts: { updates } }); try {
      await bought(w); const out = {};
      const up = async (v) => { const a = await w.add({}, w.buyer, `seller.example/camera@${v}`); return a.ok ? 'ok' : (a.purchase?.message ?? a.why ?? '?').slice(0, 44); };
      await offer(w, { amount: '9900' }); await w.release('0.2.0', { refund: 'Changed refund text for new buyers.' }); out['0.2.0 after price+terms change'] = await up('0.2.0');
      await w.release('1.0.0'); out['1.0.0'] = await up('1.0.0');
      await offer(w, { release: '1.0.0', upgrade: 'included' }); await w.republish(); out['1.0.0 marked included'] = await up('1.0.0');
      await offer(w, { release: '1.0.0', upgrade: 'paid' }); await w.republish(); out['1.0.0 back to paid (already granted?)'] = await up('1.0.0');
      await offer(w, { withdraw: true }); await w.republish(); out['bought 0.1.0 after withdraw'] = await up('0.1.0');
      await PP.retireResource(w.env, 'part', 'camera'); out['bought 0.1.0 after retire'] = await up('0.1.0');
      console.log(`P6 updates:${updates}`, JSON.stringify(out));
      assert.equal(out['bought 0.1.0 after retire'], 'ok'); assert.equal(out['1.0.0 back to paid (already granted?)'], out['1.0.0 marked included']);
      if (updates === 'all') assert.equal(out['1.0.0'], 'ok'); if (updates === 'major') { assert.equal(out['0.2.0 after price+terms change'], 'ok'); assert.notEqual(out['1.0.0'], 'ok'); }
    } finally { await w.close(); }
  }
});

test('P7 active subscriber: price change, withdrawal and a grandfathered price', async () => {
  const w = await world('p7', { saleOpts: { billing: 'month' } }); try {
    const b = await bought(w); const sub = [...w.st.subs.values()][0];
    await offer(w, { amount: '5000' }); await w.release('0.2.0'); await sync(w);
    const a = await w.add({}, w.buyer, 'seller.example/camera@0.2.0');
    console.log('P7 subscriber after list price 10 -> 50 and a new release: add', a.ok, a.why ?? a.purchase?.message ?? '', '| sub', sub.status, '| Stripe mutations since purchase:', w.st.reqs.filter((r) => r.method !== 'GET').map((r) => r.method + ' ' + r.path).slice(1).join(', ') || 'none');
    assert.equal(a.ok, true); assert.equal(sub.status, 'active');
  } finally { await w.close(); }
});

test('P2d delayed payment method (bank debit): session completes unpaid, money arrives days later, seller shipped a fix release in between', async () => {
  const w = await world('p2d'); try {
    const q = await w.add(); const i = await w.add({ approve: q.purchase.quote });
    await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } });
    const s = [...w.st.sessions.values()][0];
    const done = w.st.complete(s.id); const pending = { ...done, payment_status: 'unpaid' };
    const h1 = await w.event('checkout.session.completed', pending);
    await w.release('0.2.0');                       // same price, a bug fix
    const sy = await sync(w);
    const h2 = await w.event('checkout.session.async_payment_succeeded', done); const o = fullOrder(w);
    console.log('P2d completed(unpaid):', h1.trim(), '| deploy sync:', JSON.stringify(sy), '| async_payment_succeeded:', h2.trim(), '| order', o.status, '| refunds', w.st.refunds.length);
    assert.equal(o.status, 'paid');
  } finally { await w.close(); }
});
