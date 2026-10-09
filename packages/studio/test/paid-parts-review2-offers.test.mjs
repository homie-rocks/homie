import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { join } from 'node:path';
import { world, mainRecord, partsCommand, readPart, PP } from './paid-parts-review2-fixture.mjs';
const index = (w) => JSON.parse(readFileSync(join(w.dist, 'parts', 'index.json'), 'utf8')).parts.find((p) => p.id === 'camera');
const view = (w) => index(w).releases.map((r) => `${r.version} onSale=${r.onSale} offer=${r.offer?.amount} manifest=${r.sale?.amount}`).join(' | ');

test('O1 a price set with `parts offer` survives the next release, and the old release stops selling', async () => {
  const w = await world('o1'); try {
    console.log('O1 offer cmd:', JSON.stringify(await partsCommand(w.root, 'offer', ['parts', 'offer', 'camera'], mkflags({ amount: '2500' }), {})), readFileSync(join(w.root, 'parts', 'offers.json'), 'utf8').replace(/\s+/g, ' '), '| part.json sale.amount', readPart(w.dir).sale.amount);
    await w.republish();
    console.log('O1 after offer   :', view(w), '| index.sale', index(w).sale.amount);
    await w.release('0.2.0');   // seller ships a fix; part.json sale untouched, as the docs describe
    console.log('O1 after 0.2.0   :', view(w), '| index.sale', index(w).sale.amount);
    const rel = Object.fromEntries(index(w).releases.map((r) => [r.version, r]));
    assert.equal(rel['0.2.0'].offer.amount, 2500, 'the new release sells at the OLD manifest price, not the price the seller set');
    assert.equal(rel['0.1.0'].onSale, false, 'the superseded release is still on sale');
  } finally { await w.close(); }
});
function mkflags(o) { const m = new Map(Object.entries(o)); return m; }

test('O2 an `updates: all` buyer keeps updates when the seller changes the price for NEW buyers', async () => {
  const w = await world('o2'); try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session); assert.equal((await w.add()).ok, true);
    await w.release('0.2.0', {}, { camera: { '0.2.0': { amount: 2000, active: true } } });
    const up = await w.add({}, w.buyer, 'seller.example/camera@0.2.0');
    console.log('O2 price raised for new buyers -> existing updates:all buyer:', up.ok, up.why ?? up.purchase?.message ?? '');
    await w.republish({ camera: { '0.2.0': { amount: 500, active: true } } });
    const up2 = await w.add({}, w.buyer, 'seller.example/camera@0.2.0');
    console.log('O2 seller runs a discount       -> existing updates:all buyer:', up2.ok, up2.why ?? '');
    assert.equal(up.ok, true, 'paid for all updates, refused the update because the list price moved');
  } finally { await w.close(); }
});

test('O3 a paying subscriber gets the new release when the list price changes', async () => {
  const w = await world('o3', { saleOpts: { billing: 'month' } }); try {
    const { session } = await w.buy(); await w.event('checkout.session.completed', session); assert.equal((await w.add()).ok, true);
    await w.release('0.2.0', {}, { camera: { '0.2.0': { amount: 1500, active: true } } });
    const up = await w.add({}, w.buyer, 'seller.example/camera@0.2.0');
    console.log('O3 subscriber (active, paid) asks for 0.2.0:', up.ok, up.why ?? '', '| sub', w.st.subs.values().next().value.status);
    assert.equal(up.ok, true);
  } finally { await w.close(); }
});

test('O4 old quote and old intent after a price change', async () => {
  const w = await world('o4'); try {
    const q = await w.add(); const intent = await w.add({ approve: q.purchase.quote });
    await w.republish({ camera: { price: { amount: 9000 }, active: true } });
    const rec = mainRecord(w.buyer);
    const reuse = await w.api('/api/purchases/intent', { kind: 'part', resource: 'camera', version: '0.1.0', buyer: rec.buyer, claimHash: 'a'.repeat(64), quote: q.purchase.quote, quantity: 1 });
    const post = await w.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } });
    console.log('O4 old quote reused:', reuse.status, reuse.data.message, '| old intent POST:', post.status, (await post.text()).slice(0, 80), '| sessions', w.st.sessions.size, '| rows', w.sql.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n);
    assert.equal(reuse.status, 409); assert.equal(post.status, 410); assert.equal(w.st.sessions.size, 0);
  } finally { await w.close(); }
});

test('O5 a Checkout Session opened before a price rise / withdrawal / retirement', async () => {
  const w = await world('o5', { saleOpts: { billing: 'month' } }); try {
    const q = await w.add(); const intent = await w.add({ approve: q.purchase.quote });
    const opened = await w.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } }); assert.equal(opened.status, 303);
    const s = [...w.st.sessions.values()][0];
    console.log('O5 session params: expires_at =', s.form.expires_at ?? '(not sent: Stripe default 24h)');
    const retired = await PP.retireResource(w.env, 'part', 'camera');
    console.log('O5 retire:', JSON.stringify(retired));
    w.st.complete(s.id); const hook = await w.event('checkout.session.completed', s);
    const sub = [...w.st.subs.values()][0];
    console.log('O5 buyer pays the still-open session after retirement:', hook, '| order', JSON.stringify(w.order()), '| Stripe sub', sub.status);
    assert.notEqual(sub.status, 'active', 'a subscription started after the part was retired and nothing cancels it');
  } finally { await w.close(); }
});

test('O6 (A7) superseded release cannot be bought; newer price cannot be bypassed', async () => {
  const w = await world('o6'); try {
    await w.release('0.2.0', { amount: 500000 });
    const q = await w.add({}, w.buyer, 'seller.example/camera@0.1.0');
    const i = await w.add({ approve: q.purchase?.quote }, w.buyer, 'seller.example/camera@0.1.0');
    console.log('O6 old version quote:', q.purchase?.price, '| intent:', i.purchase?.checkout ? 'ACCEPTED' : i.why);
    assert.ok(!i.purchase?.checkout);
  } finally { await w.close(); }
});
