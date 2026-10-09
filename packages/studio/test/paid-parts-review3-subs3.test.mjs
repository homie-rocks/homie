import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, fullOrder, bought, inv, get, FILE, mainRecord, shopMod, PP, sync } from './paid-parts-review3-common.mjs';
const subOf = (w) => [...w.st.subs.values()][0];
const acc = async (w) => { const a = await w.add(); return a.ok ? 'ok' : `no(${(a.purchase?.message ?? a.why ?? '').slice(0, 50)})`; };
const tryEvent = (w, ...a) => w.event(...a).then((s) => s.trim());
const DAY = 86400000;

test('Q1 pause collection (status stays active, renewal invoice voided) and resume', async (t) => {
  const w = await world('q1', { saleOpts: { billing: 'month' } }); try {
    await bought(w); const sub = subOf(w); const end1 = sub.period_end * 1000;
    sub.pause_collection = { behavior: 'void' };
    t.mock.timers.enable({ apis: ['Date'], now: end1 + 3 * 3600_000 });
    const i2 = w.st.invoiceFor(sub, { status: 'void' }); i2.amount_remaining = 1000;
    const h = await tryEvent(w, 'customer.subscription.updated', sub); const during = await acc(w);
    console.log('Q1 paused, past period end + 3h:', h, '| access', during, '| order', fullOrder(w).status, 'paid_until-end(min)', (fullOrder(w).paid_until - end1) / 60000);
    assert.match(during, /^no/);
  } finally { t.mock.timers.reset(); await w.close(); }
});

test('Q2 cancel at period end, then deleted; cancel twice (retire twice); canceled sub still serves its paid period', async (t) => {
  const w = await world('q2', { saleOpts: { billing: 'month' } }); try {
    await bought(w); const sub = subOf(w); sub.cancel_at_period_end = true;
    const h1 = await tryEvent(w, 'customer.subscription.updated', sub); const a1 = await acc(w);
    const r1 = await PP.retireResource(w.env, 'part', 'camera'); const r2 = await PP.retireResource(w.env, 'part', 'camera');
    const dels = w.st.reqs.filter((r) => r.method === 'DELETE').length; const a2 = await acc(w);
    t.mock.timers.enable({ apis: ['Date'], now: sub.period_end * 1000 + 1000 }); const a3 = await acc(w);
    console.log('Q2 cancel_at_period_end:', h1, a1, '| retire x2:', r1.ok, r1.canceled, r2.ok, r2.canceled, 'DELETE calls', dels, '| in paid period after cancel:', a2, '| after period end:', a3);
    assert.equal(a2, 'ok'); assert.match(a3, /^no/); assert.equal(dels, 1);
  } finally { t.mock.timers.reset(); await w.close(); }
});

test('Q3 refund once, twice, buyer-then-owner, pending refund; idempotency keys', async () => {
  for (const billing of ['one-time', 'month']) {
    const w = await world('q3' + billing, { saleOpts: { billing, refundWindowDays: 14, refundEndsSubscription: true } }); try {
      await bought(w); const rec = mainRecord(w.buyer);
      const r1 = await w.api('/api/purchases/refund', {}, rec.claim);
      const r2 = await w.api('/api/purchases/refund', {}, rec.claim);
      let r3; try { r3 = await shopMod.refundOrder(w.env, fullOrder(w)); } catch (e) { r3 = 'THREW ' + e.message; }
      console.log(`Q3 [${billing}] buyer refund:`, r1.status, JSON.stringify(r1.data).slice(0, 110), '| again:', r2.status, JSON.stringify(r2.data).slice(0, 90), '| then owner:', JSON.stringify(r3).slice(0, 90), '| Stripe refunds', w.st.refunds.length, 'keys', w.st.refunds.map((r) => r.idem).join(','), '| order', fullOrder(w).status, '| access', await acc(w), '| sub', subOf(w)?.status ?? '-');
      assert.equal(w.st.refunds.length, 1);
    } finally { await w.close(); }
  }
  const w = await world('q3p', { saleOpts: { refundWindowDays: 14 } }); try {
    await bought(w); w.st.refundStatus = 'pending';
    const r = await shopMod.refundOrder(w.env, fullOrder(w)); const a = await acc(w);
    let again; try { again = await shopMod.refundOrder(w.env, fullOrder(w)); } catch (e) { again = 'THREW ' + e.message; }
    console.log('Q3 pending refund:', JSON.stringify(r), '| order', fullOrder(w).status, '| access while pending:', a, '| owner taps again:', JSON.stringify(again), '| Stripe refund POSTs', w.st.refunds.length);
  } finally { await w.close(); }
});

test('Q3b refundEndsSubscription: subscription is cancelled first; then the refund fails', async () => {
  const w = await world('q3b', { saleOpts: { billing: 'month', refundEndsSubscription: true } }); try {
    await bought(w); w.st.failOnce.push({ path: '/v1/refunds', status: 400, error: { type: 'invalid_request_error', code: 'insufficient_funds', message: 'Insufficient funds in Stripe account.' } });
    const r = await shopMod.refundOrder(w.env, fullOrder(w));
    console.log('Q3b refund fails after cancel:', JSON.stringify(r), '| sub', subOf(w).status, '| charge refunded', w.st.chargeOf(inv(w, subOf(w)).pi).refunded);
    assert.equal(subOf(w).status, 'active', 'the subscription was cancelled although no refund happened');
  } finally { await w.close(); }
});

test('Q4 zero-amount first invoice (100% coupon) and a fully discounted one-time purchase', async () => {
  const w = await world('q4', { saleOpts: { billing: 'month', promotionCodes: true } }); try {
    const b = await w.buy(); const sub = subOf(w); const i = inv(w, sub); w.st.pis.delete(i.pi); i.total = 0; i.amount_paid = 0; b.session.amount_total = 0;
    const h = await tryEvent(w, 'checkout.session.completed', b.session);
    console.log('Q4 sub 100% off first month:', h, '| order', fullOrder(w).status, 'payment', fullOrder(w).payment, '| access', await acc(w));
    assert.equal(await acc(w), 'ok');
  } finally { await w.close(); }
  const w2 = await world('q4b', { saleOpts: { promotionCodes: true } }); try {
    const b = await w2.buy(); b.session.payment_status = 'no_payment_required'; b.session.amount_total = 0; b.session.payment_intent = null;
    const h = await tryEvent(w2, 'checkout.session.completed', b.session); const a = await acc(w2);
    const r = await shopMod.refundOrder(w2.env, fullOrder(w2));
    console.log('Q4 one-time 100% off:', h, '| order', fullOrder(w2).status, '| access', a, '| owner refund:', JSON.stringify(r).slice(0, 120));
    assert.equal(a, 'ok');
  } finally { await w2.close(); }
});

test('Q5 disputes: subscription won/lost; one-time lost, won, warning_closed; refund after lost', async () => {
  const w = await world('q5'); try {
    const b = await bought(w); const pi = b.session.payment_intent; const c = w.st.chargeOf(pi); const out = [];
    const dp = { id: 'dp_1', object: 'dispute', payment_intent: pi, charge: c.id, status: 'warning_needs_response' }; c.disputed = true; w.st.disputes.push(dp);
    out.push(['created', await tryEvent(w, 'charge.dispute.created', dp), fullOrder(w).status, await acc(w)]);
    dp.status = 'warning_closed'; out.push(['closed warning_closed', await tryEvent(w, 'charge.dispute.closed', dp), fullOrder(w).status, await acc(w)]);
    const dp2 = { id: 'dp_2', object: 'dispute', payment_intent: pi, charge: c.id, status: 'lost' };
    out.push(['second dispute lost', await tryEvent(w, 'charge.dispute.closed', dp2), fullOrder(w).status, await acc(w)]);
    for (const o of out) console.log('Q5 one-time', ...o);
  } finally { await w.close(); }
});

test('Q6 out of order: refund events before the checkout completion; expired after completed; duplicate ids', async () => {
  const w = await world('q6'); try {
    const b = await w.buy(); const pi = b.session.payment_intent; const c = w.st.refund(pi);
    const h1 = await tryEvent(w, 'charge.refunded', c); const s1 = fullOrder(w).status;
    const h2 = await tryEvent(w, 'checkout.session.completed', b.session); const s2 = fullOrder(w).status;
    const h3 = await tryEvent(w, 'checkout.session.expired', b.session); const s3 = fullOrder(w).status;
    console.log('Q6 refunded first:', h1, s1, '| then completed:', h2, s2, '| then expired:', h3, s3, '| access', await acc(w));
    assert.equal(s3, 'refunded');
  } finally { await w.close(); }
  const w2 = await world('q6b'); try {
    const b = await w2.buy();
    const h1 = await tryEvent(w2, 'checkout.session.expired', b.session); const h2 = await tryEvent(w2, 'checkout.session.completed', b.session);
    console.log('Q6b expired then completed:', h1, h2, fullOrder(w2).status, await acc(w2));
    assert.equal(fullOrder(w2).status, 'fulfilled');
  } finally { await w2.close(); }
});

test('Q7 Stripe calls per protected file for a subscriber; Stripe down; key without Invoices permission', async () => {
  const w = await world('q7', { saleOpts: { billing: 'month' } }); try {
    await bought(w); const rec = mainRecord(w.buyer); const g = await w.api('/api/purchases/grant', {}, rec.claim);
    const n0 = w.st.calls.length; const r = await get(w, FILE, g.data.token); const per = w.st.calls.slice(n0);
    console.log('Q7 one protected file download ->', r.status, '| Stripe calls for it:', per.length, per.map((c) => c.split('?')[0]).join(', '));
    w.st.deny.push('/v1/subscriptions'); let down; try { down = (await get(w, FILE, g.data.token)).status; } catch (e) { down = 'THREW ' + e.message.slice(0, 60); }
    console.log('Q7 Stripe refuses the key (403) during a download of an already-paid period:', down);
  } finally { await w.close(); }
});

test('Q8 states the reconciler does not know: trialing, non-seat quantity 2, invoice in another currency', async () => {
  const w = await world('q8', { saleOpts: { billing: 'month' } }); try {
    await bought(w); const sub = subOf(w);
    sub.items.data[0].quantity = 2; const h = await tryEvent(w, 'customer.subscription.updated', sub); let a; try { a = await acc(w); } catch (e) { a = 'THREW ' + e.message; }
    console.log('Q8 studio-scope subscription set to quantity 2 in Stripe:', h, '| buyer access:', a);
    sub.items.data[0].quantity = 1; sub.status = 'trialing'; console.log('Q8 trialing:', await tryEvent(w, 'customer.subscription.updated', sub), await acc(w));
  } finally { await w.close(); }
});
