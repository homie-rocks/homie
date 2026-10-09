import { test } from 'node:test'; import assert from 'node:assert/strict';
import { world, mainRecord, shopMod, PP, LIVE_KEY } from './paid-parts-review2-fixture.mjs';
const started = async (w, opts) => { const b = await w.buy(opts); const h = await w.event('checkout.session.completed', b.session); const a = await w.add(opts); assert.equal(a.ok, true, a.why); return { ...b, sub: [...w.st.subs.values()][0], hook: h }; };
const inv = (w, sub) => w.st.invoices.get(sub.latest_invoice);
const fullOrder = (w) => w.sql.prepare('SELECT * FROM purchase_orders').get();

test('S1 (A3) month 1 refunded, month 2 paid: access returns', async () => {
  const w = await world('s1', { saleOpts: { billing: 'month' } }); try {
    const { sub } = await started(w); const pi1 = inv(w, sub).pi;
    const c = w.st.refund(pi1); const h1 = await w.event('charge.refunded', c);
    const mid = await w.add();
    const i2 = w.st.invoiceFor(sub); const h2 = await w.event('invoice.paid', i2);
    const again = await w.add();
    console.log('S1 refund hook:', h1, '| during refunded month add:', mid.ok, '| month2 hook:', h2, '| add:', again.ok, JSON.stringify(w.order()));
    assert.equal(mid.ok, false); assert.equal(again.ok, true);
  } finally { await w.close(); }
});

test('S2 refundEndsSubscription: one refund = charge.refunded + refund.created + refund.updated events; and a refund after the buyer already cancelled', async () => {
  const w = await world('s2', { saleOpts: { billing: 'month', refundEndsSubscription: true } }); try {
    const { sub } = await started(w); const pi = inv(w, sub).pi;
    // Seller refunds in the Stripe Dashboard. Stripe sends three events for it.
    const c = w.st.refund(pi); const refundObj = { id: 're_x', object: 'refund', charge: c.id, payment_intent: pi, status: 'succeeded' };
    const a = await w.event('charge.refunded', c); const b = await w.event('refund.created', refundObj); const d = await w.event('refund.updated', refundObj);
    console.log('S2 charge.refunded:', a, '\n#    refund.created :', b, '\n#    refund.updated :', d, '\n#    Stripe sub', sub.status, '| DELETE calls', w.st.calls.filter((x) => x.startsWith('DELETE')).length);
    assert.ok(!/THREW|^5/.test(b) && !/THREW|^5/.test(d), 'a later event of the same refund fails the webhook (Stripe retries it for days)');
  } finally { await w.close(); }
});

test('S2b refundEndsSubscription: office refund of the last payment after the buyer cancelled in the portal', async () => {
  const w = await world('s2b', { saleOpts: { billing: 'month', refundEndsSubscription: true } }); try {
    const { sub } = await started(w);
    sub.status = 'canceled'; await w.event('customer.subscription.deleted', { ...sub, latest_invoice: sub.latest_invoice });
    const r = await shopMod.refundOrder(w.env, fullOrder(w));
    console.log('S2b office refund after buyer cancel:', JSON.stringify(r), '| charge refunded in Stripe:', w.st.chargeOf(inv(w, sub).pi).refunded);
    assert.equal(r.ok, true, 'the seller cannot refund a cancelled subscriber from the office');
  } finally { await w.close(); }
});

test('S3 renewal invoice settled from customer credit balance (no payment object) keeps access', async () => {
  const w = await world('s3', { saleOpts: { billing: 'month' } }); try {
    const { sub } = await started(w);
    const i2 = w.st.invoiceFor(sub, { status: 'draft' }); i2.status = 'paid'; i2.amount_paid = 0; i2.amount_due = 0; i2.starting_balance = -1000; sub.period_end = i2.lines.data[0].period.end; // total 1000, paid by credit
    const h = await w.event('invoice.paid', i2); const a = await w.add();
    console.log('S3 hook:', h, '| add:', a.ok, a.why ?? '', JSON.stringify(w.order()));
    assert.equal(a.ok, true);
  } finally { await w.close(); }
});

test('S4 dispute on the current invoice: created, lost, then next month paid; and won', async () => {
  const w = await world('s4', { saleOpts: { billing: 'month' } }); try {
    const { sub } = await started(w); const pi = inv(w, sub).pi; const c = w.st.chargeOf(pi);
    c.disputed = true; const dp = { id: 'dp_1', object: 'dispute', payment_intent: pi, charge: c.id, status: 'needs_response' }; w.st.disputes.push(dp);
    const h1 = await w.event('charge.dispute.created', dp); const during = await w.add(); const st1 = w.order().status;
    dp.status = 'lost'; const h2 = await w.event('charge.dispute.closed', dp); const lost = await w.add(); const st2 = w.order().status;
    const i2 = w.st.invoiceFor(sub); const h3 = await w.event('invoice.paid', i2); const next = await w.add();
    console.log('S4 created:', h1, st1, 'add', during.ok, '| lost:', h2, st2, 'add', lost.ok, '| next month:', h3, w.order().status, 'add', next.ok);
    assert.equal(st2, 'lost'); assert.equal(during.ok, true); assert.equal(lost.ok, false); assert.equal(next.ok, true);
  } finally { await w.close(); }
});

test('S5 out-of-order and duplicates: invoice.paid before checkout.session.completed; subscription.deleted first; same event twice', async () => {
  const w = await world('s5', { saleOpts: { billing: 'month' } }); try {
    const b = await w.buy(); const sub = [...w.st.subs.values()][0];
    const h0 = await w.event('invoice.paid', inv(w, sub), 'evt_same'); const h0b = await w.event('invoice.paid', inv(w, sub), 'evt_same');
    const o0 = w.order();
    const h1 = await w.event('checkout.session.completed', b.session); const a = await w.add();
    console.log('S5 invoice.paid first:', h0, '| dup:', h0b, '| order then', o0.status, o0.subscription, '| completed:', h1, '| add', a.ok);
    assert.equal(a.ok, true);
  } finally { await w.close(); }
});

test('S6 failed renewal (past_due, open invoice) ends access at period end; active+draft gets bounded grace only', async (t) => {
  const w = await world('s6', { saleOpts: { billing: 'month' } }); try {
    const { sub } = await started(w); const end = w.order().paid_until;
    const i2 = w.st.invoiceFor(sub, { status: 'open' }); sub.status = 'past_due';
    const h = await w.event('invoice.payment_failed', i2);
    t.mock.timers.enable({ apis: ['Date'], now: end + 60_000 });
    const a = await w.add(); const o1 = w.order();
    sub.status = 'active'; i2.status = 'draft'; const g = await w.add(); const o2 = w.order();
    t.mock.timers.setTime(end + 121 * 60_000); const g2 = await w.add();
    sub.status = 'unpaid'; const u = await w.add();
    console.log('S6 failed hook:', h, '| after period end add:', a.ok, '| active+draft grace add:', g.ok, 'paid_until-end(min)=', (o2.paid_until - end) / 60000, '| after 121 min:', g2.ok, '| unpaid:', u.ok, w.order().paid_until);
    assert.equal(a.ok, false); assert.equal(g2.ok, false);
  } finally { await w.close(); }
});

test('S7 one-time: partial refund keeps, full refund ends, dispute won after out-of-order events', async () => {
  const w = await world('s7'); try {
    const b = await w.buy(); await w.event('checkout.session.completed', b.session); assert.equal((await w.add()).ok, true);
    const pi = b.session.payment_intent; const c = w.st.chargeOf(pi);
    c.amount_refunded = 400; const h1 = await w.event('charge.refunded', c); const s1 = w.order().status;
    const dp = { id: 'dp_2', object: 'dispute', payment_intent: pi, charge: c.id, status: 'won' };
    const h2 = await w.event('charge.dispute.closed', dp); const s2 = w.order().status;       // closed(won) arrives first
    const h3 = await w.event('charge.dispute.created', { ...dp, status: 'needs_response' }); const s3 = w.order().status; // created arrives late
    assert.equal(s3, 'fulfilled', 'late dispute creation cannot reverse won');
    console.log('S7 partial refund:', h1, s1, '| dispute won first:', h2, s2, '| created late:', h3, s3, '(stuck?)');
    c.refunded = true; c.amount_refunded = c.amount; const h4 = await w.event('charge.refunded', c); const a = await w.add();
    console.log('S7 full refund while order says', s3, ':', h4, w.order().status, 'add', a.ok);
    assert.equal(a.ok, false);
  } finally { await w.close(); }
});

test('S8 buyer self-service refund (refundWindowDays) on a one-time order and on a subscription', async () => {
  for (const billing of ['one-time', 'month']) {
    const w = await world('s8' + billing[0], { saleOpts: { billing, refundWindowDays: 14 } }); try {
      const b = await w.buy(); await w.event('checkout.session.completed', b.session); assert.equal((await w.add()).ok, true);
      const rec = mainRecord(w.buyer); let r;
      try { r = await w.api('/api/purchases/refund', {}, rec.claim); } catch (e) { r = { status: 'THREW', data: e.message }; }
      const o = w.order(); const a = await w.add();
      console.log(`S8 ${billing}: self refund ->`, r.status, JSON.stringify(r.data).slice(0, 200), '| order', o.status, o.paid_until, '| add after', a.ok, '| Stripe refunds', w.st.calls.filter((x) => x === 'POST /v1/refunds').length, 'sub', [...w.st.subs.values()][0]?.status ?? '-');
      assert.equal(a.ok, false, 'refunded buyer still downloads');
    } finally { await w.close(); }
  }
});

test('S9 office refund of a one-time part order (owner button)', async () => {
  const w = await world('s9'); try {
    const b = await w.buy(); await w.event('checkout.session.completed', b.session); assert.equal((await w.add()).ok, true);
    let r; try { r = await shopMod.refundOrder(w.env, fullOrder(w)); } catch (e) { r = 'THREW ' + e.message; }
    console.log('S9 office refund one-time:', JSON.stringify(r), w.order().status, 'add', (await w.add()).ok);
  } finally { await w.close(); }
});

test('S10 seat subscription: quantity raised in the portal; non-seat quantity 2', async () => {
  const w = await world('s10', { saleOpts: { billing: 'month', scope: 'seat' } }); try {
    const b = await w.buy({ quantity: 3 }); await w.event('checkout.session.completed', b.session); const a = await w.add({ quantity: 3 }); assert.equal(a.ok, true, a.why);
    const sub = [...w.st.subs.values()][0]; sub.items.data[0].quantity = 5; const h = await w.event('customer.subscription.updated', sub);
    const a2 = await w.add({ quantity: 3 });
    console.log('S10 seats 3->5 in portal:', h, 'order qty', w.order().quantity, 'add', a2.ok, a2.why ?? '');
  } finally { await w.close(); }
});
