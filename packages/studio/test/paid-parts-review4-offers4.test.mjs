/** Review 4: offers, their published description, and the order state machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenge, Credential } from 'mppx';
import { seller, TEST_KEY } from './paid-parts-review4-seller.mjs';
import { sale$, PP, shopMod, mainRecord } from './paid-parts-review4-harness.mjs';
import { offer, sync, index, bought, fullOrder } from './paid-parts-review4-common.mjs';
const say = (...a) => console.log('#', ...a.map((x) => String(x).replace(/\n/g, ' ')));
const O = 'https://seller.example';
const ld = async () => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(await (await fetch(`${O}/parts/camera/`)).text())[1]);
const core = (w, id) => JSON.parse(w.sql.prepare('SELECT value FROM meta WHERE key LIKE ?').get(`payment:%:order:${id}`)?.value ?? 'null')?.value;

test('O1 after a price override, what do the standard descriptions say and what is charged', async () => {
  const w = await seller('o1'); try {
    await offer(w, { amount: '2500' }); await w.republish();
    const cat = (await (await fetch(`${O}/parts/catalog.json`)).json()).parts[0]; const page = await (await fetch(`${O}/parts/camera/`)).text(); const list = await (await fetch(`${O}/parts/`)).text();
    const jsonld = await ld();
    const part = await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json();
    const r = await fetch(`${O}/api/purchases/resource`, { method: 'POST', body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part, 1, null, cat.releases[0].offer) }) });
    const charged = Challenge.fromResponseList(r).find((c) => c.method === 'stripe').request.amount;
    say('O1 offer sold:', cat.releases[0].offer.amount, '| MPP challenge amount:', charged, '| JSON-LD on the page:', jsonld.offers.price, jsonld.offers.priceCurrency, '| JSON-LD in catalogue:', cat.product.offers.price, '| page Price row:', /<dt>Price<\/dt><dd>([^<]+)/.exec(page)?.[1], '| parts list card:', /USD[^<]{0,40}/.exec(list)?.[0], '| catalogue entry.sale.amount:', cat.sale.amount, '| public part.json sale.amount:', part.sale.amount);
    assert.equal(jsonld.offers.price, '25.00');
  } finally { await w.close(); }
});

test('O2 offer versions: immutable record, and what an order points at', async () => {
  const w = await seller('o2'); try {
    const b1 = await fetch(`${O}/api/purchases/resource`, { method: 'POST', body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: '1'.repeat(64), quote: await sale$.quoteHash(await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json()) }) });
    const rows = () => w.sql.prepare("SELECT ('offer:' || version) AS key, value FROM purchase_offers").all();
    const before = rows(); const listed = (await (await fetch(`${O}/parts/catalog.json`)).json()).parts[0].releases[0].offerVersion;
    say('O2 stored offer versions:', before.map((r) => r.key.slice(6, 18)).join(','), '| listed offerVersion:', listed.slice(0, 12), '| same:', before[0]?.key === `offer:${listed}`);
    // can a later write replace a stored version?
    w.sql.prepare("INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)").run(before[0].key, '{"tampered":true}');
    say('O2 INSERT OR IGNORE keeps the first version:', rows()[0].value === before[0].value);
    await offer(w, { amount: '2500' }); await w.republish();
    const cat = (await (await fetch(`${O}/parts/catalog.json`)).json()).parts[0];
    say('O2 after reprice listed offerVersion changed:', cat.releases[0].offerVersion !== listed);
    assert.notEqual(cat.releases[0].offerVersion, listed);
  } finally { await w.close(); }
});

test('O3 state table: every pair through transition(); and through recordOrderState with provider facts', async () => {
  const { states, transitions, transition, recordOrderState } = await import(`${process.env.ROOT ?? new URL('../../..', import.meta.url).pathname}/packages/studio/worker/purchase-core.mjs`);
  let legal = 0, illegal = 0; for (const a of states) for (const b of states) { try { transition(a, b); legal++; } catch { illegal++; } }
  say('O3 transition(): legal incl. identity', legal, 'illegal', illegal, '| table', JSON.stringify(transitions));
  const w = await seller('o3'); try {
    // Which facts does recordOrderState accept from each stored state without throwing, and what does it store?
    const out = {};
    for (const from of states) for (const fact of states) {
      const id = `ord_${from}_${fact}`.padEnd(24, 'x'); w.sql.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run(`payment:live:order:${id}`, JSON.stringify({ revision: 'r', value: { id, buyer: 'b', state: from } }));
      try { out[`${from}>${fact}`] = (await recordOrderState(w.env, { id, buyer: 'b', mode: 'live' }, fact)).state; } catch (e) { out[`${from}>${fact}`] = 'THROWS'; }
    }
    say('O3 recordOrderState results differing from the requested fact:', Object.entries(out).filter(([k, v]) => v !== k.split('>')[1]).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally { await w.close(); }
});

test('O4 one-time order driven by provider events in awkward orders: both state records, and delivery', async () => {
  const w = await seller('o4', { saleOpts: { refundWindowDays: 30 } }); try {
    const b = await w.buy(); const id = b.session.metadata.order; const pi = b.session.payment_intent; const ch = w.st.chargeOf(pi);
    const state = () => `${fullOrder(w, id).status}/${core(w, id)?.state}`;
    const steps = [];
    // refund event arrives before completion
    ch.refunded = true; steps.push(['charge.refunded before checkout.session.completed', await w.event('charge.refunded', { id: ch.id, payment_intent: pi, refunded: true }), state()]);
    steps.push(['checkout.session.completed (late)', await w.event('checkout.session.completed', b.session), state()]);
    const g = await w.api('/api/purchases/grant', {}, mainRecord(w.buyer).claim);
    steps.push(['grant', g.status, state()]);
    for (const s of steps) say('O4', s[0], '->', String(s[1]).slice(0, 60), '| shop/canonical', s[2]);
    assert.notEqual(g.status, 200);
  } finally { await w.close(); }
});

test('O5 dispute opened, lost, then the bank reverses (won) ; and dispute on a refunded order', async () => {
  const w = await seller('o5'); try {
    const b = await bought(w); const id = b.session.metadata.order; const pi = b.session.payment_intent; const ch = w.st.chargeOf(pi); const claim = mainRecord(w.buyer).claim;
    const state = () => `${fullOrder(w, id).status}/${core(w, id)?.state}`; const grant = async () => (await w.api('/api/purchases/grant', {}, claim)).status;
    const d = { id: 'dp_1', payment_intent: pi, status: 'needs_response' }; w.st.disputes.push(d); ch.disputed = true;
    const a = await w.event('charge.dispute.created', { id: 'dp_1', payment_intent: pi, status: 'needs_response' }); const sa = state(); const ga = await grant();
    d.status = 'lost'; const l = await w.event('charge.dispute.closed', { id: 'dp_1', payment_intent: pi, status: 'lost' }); const sl = state(); const gl = await grant();
    d.status = 'won'; const won = await w.event('charge.dispute.closed', { id: 'dp_1', payment_intent: pi, status: 'won' }, 'evt_again'); const sw = state(); const gw = await grant();
    say('O5 disputed:', a.slice(0, 40), sa, 'grant', ga, '| lost:', l.slice(0, 40), sl, 'grant', gl, '| later won:', won.slice(0, 40), sw, 'grant', gw);
  } finally { await w.close(); }
});

test('O6 duplicate, missing and out-of-order events for a machine-paid order; refund in every state', async () => {
  const w = await seller('o6', { saleOpts: { refundWindowDays: 30 } }); try {
    const part = await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json(); const claim = '7'.repeat(64);
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim, quote: await sale$.quoteHash(part) });
    const post = (h = {}) => fetch(`${O}/api/purchases/resource`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    const r1 = await post(); const chl = Challenge.fromResponseList(r1).find((c) => c.method === 'stripe'); w.st.spts.set('spt_o6', { max: 1000, currency: 'usd' });
    const refundUnpaid = await w.api('/api/purchases/refund', {}, claim);
    const paid = await post({ authorization: Credential.serialize({ challenge: chl, payload: { spt: 'spt_o6' } }) }); assert.equal(paid.status, 200);
    const o = w.order(); const pi = [...w.st.pis.values()][0];
    const state = () => `${fullOrder(w, o.id).status}/${core(w, o.id)?.state}`;
    const ev = { id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, metadata: pi.metadata };
    const e1 = await w.event('payment_intent.succeeded', ev, 'evt_dup'); const e2 = await w.event('payment_intent.succeeded', ev, 'evt_dup'); const e3 = await w.event('payment_intent.succeeded', ev, 'evt_other');
    say('O6 refund before payment:', refundUnpaid.status, refundUnpaid.data?.detail?.slice(0, 50), '| after paid:', state(), '| succeeded event:', e1.slice(0, 44), '| duplicate id:', e2.slice(0, 40), '| same fact new id:', e3.slice(0, 44), state());
    // a second PaymentIntent carrying this order's metadata (operator error or a second wallet attempt recorded at Stripe)
    const pi2 = w.st.pay(1000, pi.metadata); pi2.amount = 1000; pi2.currency = 'usd';
    const e4 = await w.event('payment_intent.succeeded', { ...ev, id: pi2.id }, 'evt_second');
    say('O6 second PaymentIntent for the same order:', e4.slice(0, 44), '| order.payment now', fullOrder(w, o.id).payment, '(first was', pi.id + ')', '| purchase_payments rows', w.sql.prepare('SELECT COUNT(*) n FROM purchase_payments WHERE order_id = ?').get(o.id).n);
    const [x, y] = await Promise.all([w.api('/api/purchases/refund', {}, claim), w.api('/api/purchases/refund', {}, claim)]);
    const z = await w.api('/api/purchases/refund', {}, claim);
    say('O6 two concurrent buyer refunds + one more:', x.data.status, y.data.status, z.data.status ?? z.data.detail, '| Stripe refunds created', w.st.refunds.length, '| keys', w.st.refunds.map((r) => r.idem.slice(0, 24)).join(' '), '| which payment was refunded', w.st.refunds.map((r) => r.pi).join(','), '| money still held: ', [...w.st.charges.values()].filter((c) => !c.refunded).length, 'unrefunded charge(s)', state());
  } finally { await w.close(); }
});
