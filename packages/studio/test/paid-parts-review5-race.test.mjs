/** Review 5, step 3: concurrency. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, base, say, text, orders, jobs, settlements, cron, office, netCard, cardCharges, PP, shopMod, H } from './paid-parts-review5-kit.mjs';
const attempt = async (fn) => { try { return await text(await fn()); } catch (e) { return `THREW ${e.message}`; } };
const short = (x) => x.slice(0, 60);

test('R1 one order, the same credential twice at once, and five times', async () => {
  const s = await card('r1'); try {
    const ch = await s.challengeOf(await s.post(s.body())); const h = { authorization: s.cred(ch, s.spt()) };
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => attempt(() => s.post(s.body(), h))));
    await cron(s.w, 2);
    say('R1', rs.map((r) => r.slice(0, 3)), '| charges', cardCharges(s.w).length, 'net', netCard(s.w), 'order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state));
    assert.equal(netCard(s.w), 1); assert.equal((await s.grant()).status, 200);
  } finally { s.K.restore(); await s.w.close(); }
});

test('R2 one order, two different approved tokens at once', async () => {
  const s = await card('r2'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const rs = await Promise.all([s.spt(), s.spt()].map((t) => attempt(() => s.post(s.body(), { authorization: s.cred(ch, t) }))));
    say('R2 answers', rs.map(short), '| charges', cardCharges(s.w).length, 'net', netCard(s.w), 'refunds', s.w.st.refunds.length, 'order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state));
    await cron(s.w, 3); const off = await office(s.w);
    say('R2 after cron: net', netCard(s.w), 'refunds', s.w.st.refunds.length, 'order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state), '| owner sees recovery rows', off.paymentRecovery.length);
    assert.equal(netCard(s.w), 1); assert.equal((await s.grant()).status, 200);
  } finally { s.K.restore(); await s.w.close(); }
});

test('R3 x402: one order, two different signed authorizations at once', async () => {
  const s = await base('r3'); try {
    const r1 = await s.post(s.body()); const h1 = await s.sign(r1); const h2 = await s.sign(r1);
    const rs = await Promise.all([h1, h2].map((h) => attempt(() => s.post(s.body(), h))));
    say('R3 answers', rs.map(short), '| USDC transfers', s.C.moved(), '| Stripe refunds', s.w.st.refunds.length, 'order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state), 'settlements', settlements(s.w).map((x) => x.state));
    await cron(s.w, 3); const off = await office(s.w);
    say('R3 after cron: transfers', s.C.moved(), 'refunds', s.w.st.refunds.length, 'jobs', jobs(s.w).map((j) => `${j.state} ${j.payment}`), '| owner recovery rows', off.paymentRecovery);
    assert.ok(s.C.moved() - s.w.st.refunds.length <= 1, 'buyer paid twice on chain and one was not returned');
  } finally { s.K.restore(); await s.w.close(); }
});

test('R4 two orders for one offer at once (two buyers)', async () => {
  const s = await card('r4'); try {
    const A = s.body('1'.repeat(64)); const B = s.body('2'.repeat(64), { buyer: 'e'.repeat(64) });
    const [ca, cb] = await Promise.all([A, B].map(async (b) => s.challengeOf(await s.post(b))));
    const rs = await Promise.all([[A, ca], [B, cb]].map(([b, c]) => attempt(() => s.post(b, { authorization: s.cred(c, s.spt()) }))));
    const cross = await attempt(() => s.post(B, { authorization: s.cred(ca, s.spt()) }));
    say('R4', rs.map((r) => r.slice(0, 3)), 'charges', cardCharges(s.w).length, 'orders', orders(s.w).map((o) => o.status), '| A\'s challenge on B (already paid):', cross.slice(0, 3));
    assert.equal(netCard(s.w), 2);
  } finally { s.K.restore(); await s.w.close(); }
});

test('R5 attempt racing expiry: the credential arrives just before and just after five minutes', async (t) => {
  for (const ms of [299_000, 301_000]) {
    const s = await card(`r5${ms}`); try {
      const ch = await s.challengeOf(await s.post(s.body())); const h = { authorization: s.cred(ch, s.spt()) };
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(ms);
      const [pay, sweep] = await Promise.all([attempt(() => s.post(s.body(), h)), cron(s.w, 1)]);
      await cron(s.w, 2); const g = await s.grant();
      say(`R5 +${ms / 1000}s: paid request`, short(pay), '| cron at the same moment', sweep, '| order', orders(s.w)[0]?.status ?? 'deleted', 'net', netCard(s.w), 'grant', g.status);
      t.mock.timers.reset();
      assert.ok((netCard(s.w) === 1) === (g.status === 200), 'money and access disagree');
    } finally { s.K.restore(); await s.w.close(); }
  }
});

test('R6 reprice and retirement racing a payment', async () => {
  const { offer, sync } = await import('./paid-parts-review4-common.mjs');
  for (const what of ['reprice', 'retire']) {
    const s = await card(`r6${what}`); try {
      const ch = await s.challengeOf(await s.post(s.body())); const h = { authorization: s.cred(ch, s.spt(5000)) };
      const change = async () => { if (what === 'reprice') { await offer(s.w, { amount: '2500' }); await s.w.republish(); return sync(s.w); } return PP.retireResource(s.w.env, 'part', 'camera'); };
      const [pay, changed] = await Promise.all([attempt(() => s.post(s.body(), h)), change()]);
      await cron(s.w, 2); const g = await s.grant(); const o = orders(s.w)[0];
      say(`R6 ${what} at the same moment as the paid request:`, short(pay), '| change', JSON.stringify(changed).slice(0, 80), '| order', o?.status ?? 'deleted', 'charged', cardCharges(s.w).map((p) => p.amount), 'net', netCard(s.w), 'grant', g.status);
      assert.ok((netCard(s.w) === 1) === (g.status === 200), 'money and access disagree');
      // after the change, the old challenge must not be payable
      const s2body = s.body('9'.repeat(64));
      const late = await attempt(() => s.post(s2body)); say(`R6 ${what}: a new claim with the old offerVersion afterwards:`, short(late));
    } finally { s.K.restore(); await s.w.close(); }
  }
});

test('R7 refund racing fulfilment (owner refund while recovery is fulfilling; buyer refund twice at once)', async () => {
  const s = await card('r7', { saleOpts: { refundWindowDays: 14 } }); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.K.at = s.K.n + 5; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); s.K.revive();
    const o = orders(s.w)[0]; say('R7 crashed with order', o.status, 'jobs', jobs(s.w).map((j) => j.state));
    const [refund, c] = await Promise.all([shopMod.performRefund(s.w.env, s.w.cat, { order: o.id }), cron(s.w, 1)]);
    await cron(s.w, 2); const g = await s.grant();
    say('R7 owner refund || cron:', JSON.stringify(refund).slice(0, 110), '| order', orders(s.w)[0].status, 'refunds', s.w.st.refunds.length, 'net', netCard(s.w), 'grant', g.status, 'jobs', jobs(s.w).map((j) => j.state));
    assert.equal(s.w.st.refunds.length, 1); assert.equal(orders(s.w)[0].status, 'refunded'); assert.notEqual(g.status, 200);
  } finally { s.K.restore(); await s.w.close(); }
  const s2 = await card('r7b', { saleOpts: { refundWindowDays: 14 } }); try {
    const ch = await s2.challengeOf(await s2.post(s2.body()));
    const paid = await s2.post(s2.body(), { authorization: s2.cred(ch, s2.spt()) }); await paid.text();
    const rs = await Promise.all([1, 2, 3].map(() => s2.w.api('/api/purchases/refund', {}, 'b'.repeat(64))));
    const again = await attempt(() => s2.post(s2.body(), { authorization: s2.cred(ch, s2.spt()) }));
    await cron(s2.w, 2); const g = await s2.grant();
    say('R7b three buyer refunds at once:', rs.map((r) => `${r.status} ${r.data?.status ?? r.data?.detail}`), '| Stripe refunds', s2.w.st.refunds.length, 'order', orders(s2.w)[0].status, '| paying the refunded order again:', short(again), 'charges', cardCharges(s2.w).length, 'grant', g.status);
    assert.equal(s2.w.st.refunds.length, 1); assert.equal(cardCharges(s2.w).length, 1); assert.notEqual(g.status, 200);
  } finally { s2.K.restore(); await s2.w.close(); }
});

test('R8 cron running twice at once over a crashed, paid order with the files gone', async () => {
  const s = await card('r8'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.K.at = s.K.n + 4; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); s.K.revive();
    for (const k of [...s.w.objects.keys()]) if (k.startsWith('paid-parts/files/')) s.w.objects.delete(k);
    await Promise.all([cron(s.w, 1), cron(s.w, 1), cron(s.w, 1)]); await cron(s.w, 1);
    say('R8 order', orders(s.w)[0].status, 'refunds', s.w.st.refunds.length, 'charges', cardCharges(s.w).length, 'jobs', jobs(s.w).map((j) => j.state));
    assert.equal(s.w.st.refunds.length, 0); assert.equal(orders(s.w)[0].status, 'paid');
  } finally { s.K.restore(); await s.w.close(); }
});
