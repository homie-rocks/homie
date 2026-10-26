/** Review 5, step 3: provider errors, partial failures, later seller changes, duplicate and out-of-order events. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, base, say, text, orders, jobs, settlements, cron, office, netCard, cardCharges, PP, shopMod } from './paid-parts-review5-kit.mjs';
const attempt = async (fn) => { try { return await text(await fn()); } catch (e) { return `THREW ${e.message}`; } };
const stripeCalls = (s, from = 0) => s.w.st.reqs.slice(from).map((r) => `${r.method} ${r.path.replace(/pi_\w+/, 'pi_*')}`);
const dropFiles = (w) => { let n = 0; for (const k of [...w.objects.keys()]) if (k.startsWith('paid-parts/files/')) { w.objects.delete(k); n++; } return n; };

test('F1 crash right after Stripe DECLINED the token: the stored attempt must end, and a fresh token must work', async () => {
  const s = await card('f1'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.K.at = s.K.n + 4; const first = await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt(500)) })); // wallet limit below price
    say('F1 died after', s.K.diedAt, '| charges', cardCharges(s.w).length); s.K.revive();
    const c = await cron(s.w, 3);
    say('F1 after 3 cron runs: jobs', jobs(s.w).map((j) => ({ state: j.state, attempts: j.attempts, error: j.error })), 'order', orders(s.w)[0].status);
    const r = await s.post(s.body()); say('F1 buyer asks again (no credential):', await text(r));
    const ch2 = r.status === 402 ? await s.challengeOf(r) : ch;
    const good = await s.post(s.body(), { authorization: s.cred(ch2, s.spt()) });
    say('F1 fresh approved token:', await text(good), '| net charges', netCard(s.w));
    const off = await office(s.w); say('F1 office paymentRecovery', off.paymentRecovery);
    assert.equal(good.status, 200, 'a declined attempt that crashed locks the order');
  } finally { s.K.restore(); await s.w.close(); }
});

test('F2 a delivered sale, then the files are no longer in storage (retired part, cleaned or mis-bound bucket): cron must not refund it', async () => {
  const s = await card('f2'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const paid = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) }); assert.equal(paid.status, 200); const files = (await paid.json()).files.length;
    await cron(s.w, 2);
    say('F2 delivered', files, 'files; order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state), 'refunds', s.w.st.refunds.length);
    const before = s.w.st.reqs.length; await cron(s.w, 1);
    say('F2 Stripe calls made by ONE cron run for one long-finished order:', stripeCalls(s, before));
    const gone = dropFiles(s.w); const c = await cron(s.w, 2);
    say(`F2 ${gone} stored files removed, cron ${c.join('/')}: order`, orders(s.w)[0].status, '| Stripe refunds', s.w.st.refunds.length, '| jobs', jobs(s.w).map((j) => j.state));
    assert.equal(s.w.st.refunds.length, 0, 'a delivered sale was refunded automatically');
  } finally { s.K.restore(); await s.w.close(); }
});

test('F2b the same with the bucket binding absent for one deploy', async () => {
  const s = await card('f2b'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const paid = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) }); assert.equal(paid.status, 200); await paid.text();
    await cron(s.w, 1);
    const media = s.w.env.PURCHASE_MEDIA; delete s.w.env.PURCHASE_MEDIA; const c = await cron(s.w, 1); s.w.env.PURCHASE_MEDIA = media;
    say(`F2b MEDIA unbound for one cron run ${c.join('/')}: order`, orders(s.w)[0].status, '| refunds', s.w.st.refunds.length);
    assert.equal(s.w.st.refunds.length, 0);
  } finally { s.K.restore(); await s.w.close(); }
});

test('F3 x402: the facilitator answers "not settled" (insufficient funds), the buyer fixes it and signs again', async () => {
  const s = await base('f3'); try {
    const r1 = await s.post(s.body()); s.C.fail = 'insufficient_funds';
    const first = await s.post(s.body(), await s.sign(r1));
    say('F3 first attempt:', await text(first), '| settlements', settlements(s.w).map((x) => x.state), '| moved', s.C.moved());
    s.C.fail = null;
    const r2 = await s.post(s.body()); say('F3 buyer asks again:', await text(r2), '| facilitator settle calls so far', s.C.settleCalls);
    let second = r2; if (r2.status === 402) second = await s.post(s.body(), await s.sign(r2));
    say('F3 second attempt:', await text(second), '| moved', s.C.moved(), '| order', orders(s.w)[0].status);
    const c = await cron(s.w, 2);
    say('F3 after cron: moved', s.C.moved(), 'order', orders(s.w)[0].status, 'settle calls', s.C.settleCalls, 'settlements', settlements(s.w).map((x) => x.state));
    assert.ok(s.C.moved() <= 1);
  } finally { s.K.restore(); await s.w.close(); }
});

test('F3b x402: the facilitator stays down; what the buyer and owner have after the authorization expires', async (t) => {
  const s = await base('f3b'); try {
    const r1 = await s.post(s.body()); s.C.fail = 'facilitator_unavailable';
    const first = await s.post(s.body(), await s.sign(r1));
    say('F3b first:', await text(first));
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(20 * 60_000); s.C.finalizedTime = Date.now();
    const c = await cron(s.w, 2);
    say('F3b 20 minutes later, cron', c.join('/'), ': order', orders(s.w)[0]?.status ?? 'deleted', 'settlements', settlements(s.w).map((x) => `${x.state} ${x.error ?? ''}`), 'moved', s.C.moved());
    const again = await s.post(s.body()); say('F3b same claim again:', await text(again));
    const fresh = await s.post(s.body('e'.repeat(64))); say('F3b fresh claim:', fresh.status);
    t.mock.timers.reset();
    assert.equal(s.C.moved(), 0);
  } finally { s.K.restore(); await s.w.close(); }
});

test('F4 stablecoin settled on chain, Stripe refuses to record it for good: buyer and owner, with and without the files', async () => {
  for (const filesGone of [false, true]) {
    const s = await base(`f4${filesGone}`); try {
      s.w.st.cryptoReject = 'Crypto transaction verification is not enabled on this account.';
      const r1 = await s.post(s.body()); const headers = await s.sign(r1);
      if (filesGone) { s.K.at = s.K.n + 10; await attempt(() => s.post(s.body(), headers)); s.K.revive(); dropFiles(s.w); }
      const paid = filesGone ? null : await s.post(s.body(), headers);
      const c = await cron(s.w, 3);
      const o = orders(s.w)[0]; const g = await s.grant(); const off = await office(s.w);
      const refund = await s.w.api('/api/purchases/refund', {}, 'd'.repeat(64));
      const owner = await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id });
      say(`F4 filesGone=${filesGone}: USDC moved`, s.C.moved(), '| first answer', paid ? await text(paid) : 'crashed after settle', '| order', o.status, 'payment', o.payment, '| grant', g.status, g.data?.detail ?? '', '| buyer refund', refund.status, refund.data?.detail ?? refund.data?.message, '| owner refund', JSON.stringify(owner).slice(0, 140), '| office row refundable', off.orders.find((x) => x.id === o.id)?.refundable, '| jobs', jobs(s.w).map((j) => `${j.state} x${j.attempts} ${j.error?.slice(0, 40)}`));
      if (filesGone) { assert.equal(o.status, 'paid'); assert.equal(g.status, 503); assert.equal(owner.error, 'manual-refund-required'); const evidence = JSON.parse(s.w.sql.prepare('SELECT payload FROM purchase_settlements WHERE order_id = ?').get(o.id).payload); assert.equal(owner.transfers[0].payer, evidence.payload.payload.authorization.from); assert.equal(owner.transfers[0].amount, evidence.payload.payload.authorization.value); assert.ok(owner.transfers[0].transaction); }
    } finally { s.K.restore(); await s.w.close(); }
  }
});

test('F5 webhooks: duplicate, early, out of order, and after a refund', async () => {
  const s = await card('f5'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const o0 = orders(s.w)[0];
    // early: the webhook for a PaymentIntent arrives before the request that made it finishes
    s.K.at = s.K.n + 4; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); s.K.revive();
    const pi = cardCharges(s.w)[0]; const obj = { id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, status: 'succeeded', metadata: pi.metadata };
    say('F5 early payment_intent.succeeded:', await s.w.event('payment_intent.succeeded', obj, 'evt_a', true), '| order', orders(s.w)[0].status);
    say('F5 same event id again:', await s.w.event('payment_intent.succeeded', obj, 'evt_a', true));
    say('F5 same event, new id:', await s.w.event('payment_intent.succeeded', obj, 'evt_b', true), '| order', orders(s.w)[0].status);
    await cron(s.w, 2); say('F5 cron: order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state), 'refunds', s.w.st.refunds.length);
    assert.equal(s.w.st.refunds.length, 0); assert.equal((await s.grant()).status, 200);
    // refund at Stripe (dashboard), webhook charge.refunded, then a late duplicate payment_intent.succeeded
    s.w.st.refund(pi.id);
    say('F5 charge.refunded:', await s.w.event('charge.refunded', { id: pi.charge, object: 'charge', payment_intent: pi.id, refunded: true }, 'evt_c', true), '| order', orders(s.w)[0].status);
    say('F5 late payment_intent.succeeded after refund:', await s.w.event('payment_intent.succeeded', obj, 'evt_d', true), '| order', orders(s.w)[0].status);
    await cron(s.w, 2); const g = await s.grant();
    say('F5 cron after refund: order', orders(s.w)[0].status, '| grant', g.status, '| jobs', jobs(s.w).map((j) => j.state));
    assert.equal(orders(s.w)[0].status, 'refunded'); assert.notEqual(g.status, 200);
    // a foreign PaymentIntent that names this order with another amount
    say('F5 forged amount event:', await s.w.event('payment_intent.succeeded', { ...obj, id: 'pi_other', amount: 1 }, 'evt_e', true), '| order', orders(s.w)[0].status);
  } finally { s.K.restore(); await s.w.close(); }
});

test('F6 Stripe answers 500 / times out at each call of a paid card request (one-shot and for good)', async () => {
  const bad = [];
  for (const sticky of [false, true]) for (const where of ['before', 'after']) for (const target of ['/v1/payment_intents$', '/cancel$']) {
    const s = await card(`f6${sticky}${where}${target.length}`); try {
      const ch = await s.challengeOf(await s.post(s.body()));
      const match = (label, body) => new RegExp(target).test(label) && (target !== '/v1/payment_intents$' || /shared_payment_granted_token/.test(body));
      const boom = () => new Response(JSON.stringify({ error: { type: 'api_error', message: 'injected 500' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      const f = s.K.fault({ sticky, match, ...(where === 'before' ? { before: boom } : { after: boom }) });
      const first = await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) }));
      const c = await cron(s.w, 3);
      const mid = { order: orders(s.w)[0]?.status, net: netCard(s.w), charges: cardCharges(s.w).length };
      s.K.faults.length = 0; // provider recovers
      const c2 = await cron(s.w, 2); const again = await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) }));
      const o = orders(s.w)[0]; const g = await s.grant(); const net = netCard(s.w);
      let b = null; if (cardCharges(s.w).length > 1 && net > 1) b = 'charged twice'; else if (net === 1 && g.status !== 200) b = `charged, not delivered (${o.status})`; else if (net === 0 && g.status === 200) b = 'free';
      const line = `F6 500 ${where} Stripe did the work, ${sticky ? 'every time' : 'once'}, on ${target} (hits ${f.hits ?? 0}): first ${first.slice(0, 60)} | during outage ${JSON.stringify(mid)} | recovered: order ${o?.status} net ${net} charges ${cardCharges(s.w).length} grant ${g.status} retry ${again.slice(0, 30)} jobs ${jobs(s.w).map((j) => j.state)}${b ? ' <<< ' + b : ''}`;
      say(line); if (b) bad.push(line);
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});

test('F7 the same for x402: facilitator and chain RPC and Stripe recording fail at each call', async () => {
  const bad = [];
  for (const sticky of [false, true]) for (const where of ['before', 'after']) for (const target of ['x402/verify$', 'mainnet.base.org/$', 'x402/settle$', '/v1/payment_intents$']) {
    const s = await base(`f7${sticky}${where}${target.replace(/\W/g, "")}`); try {
      const r1 = await s.post(s.body()); const headers = await s.sign(r1);
      const match = (label, body) => new RegExp(target).test(label) && (target !== '/v1/payment_intents$' || /transaction_verification/.test(body));
      const boom = () => new Response(JSON.stringify({ error: { type: 'api_error', message: 'injected 500' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      const f = s.K.fault({ sticky, match, ...(where === 'before' ? { before: boom } : { after: boom }) });
      const first = await attempt(() => s.post(s.body(), headers));
      const c = await cron(s.w, 3);
      const mid = { order: orders(s.w)[0]?.status, moved: s.C.moved(), grant: (await s.grant()).status };
      s.K.faults.length = 0;
      const c2 = await cron(s.w, 2); const again = await attempt(() => s.post(s.body(), headers));
      const o = orders(s.w)[0]; const g = await s.grant(); const moved = s.C.moved();
      let b = null; if (moved > 1) b = 'moved twice'; else if (moved === 1 && g.status !== 200) b = `paid, not delivered (${o.status})`; else if (moved === 0 && g.status === 200) b = 'free';
      const line = `F7 500 ${where} the far side did the work, ${sticky ? 'every time' : 'once'}, on ${target} (hits ${f.hits ?? 0}): first ${first.slice(0, 70)} | during outage ${JSON.stringify(mid)} | recovered: order ${o?.status} moved ${moved} grant ${g.status} retry ${again.slice(0, 30)} jobs ${jobs(s.w).map((j) => j.state)} settlements ${settlements(s.w).map((x) => x.state)}${b ? ' <<< ' + b : ''}`;
      say(line); if (b) bad.push(line);
    } finally { s.K.restore(); await s.w.close(); }
  }
  assert.deepEqual(bad, []);
});

test('F8 a PaymentIntent that answers processing, then succeeds by webhook; and one that needs 3-D Secure', async () => {
  const s = await card('f8'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.w.st.piStatus = 'processing';
    const first = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) });
    say('F8 processing:', await text(first), '| order', orders(s.w)[0].status, 'jobs', jobs(s.w).map((j) => j.state));
    delete s.w.st.piStatus;
    const c = await cron(s.w, 1); const g = await s.grant();
    say('F8 cron after Stripe finished:', c.join('/'), 'order', orders(s.w)[0].status, 'grant', g.status, 'net', netCard(s.w));
    assert.equal(g.status, 200);
  } finally { s.K.restore(); await s.w.close(); }
  const s2 = await card('f8b'); try {
    const ch = await s2.challengeOf(await s2.post(s2.body()));
    s2.w.st.piStatus = 'requires_action';
    const first = await s2.post(s2.body(), { authorization: s2.cred(ch, s2.spt()) });
    say('F8b requires_action:', await text(first), '| order', orders(s2.w)[0].status, 'jobs', jobs(s2.w).map((j) => `${j.state} ${j.error ?? ''}`), '| Stripe calls', stripeCalls(s2).slice(-3));
    delete s2.w.st.piStatus;
    const r = await s2.post(s2.body()); const ch2 = r.status === 402 ? await s2.challengeOf(r) : null;
    const good = ch2 ? await s2.post(s2.body(), { authorization: s2.cred(ch2, s2.spt()) }) : r;
    say('F8b fresh token after the 3-D Secure refusal:', await text(good), '| net', netCard(s2.w), 'charges', cardCharges(s2.w).length);
  } finally { s2.K.restore(); await s2.w.close(); }
});

test('F9 what one unauthenticated request and one office view cost the studio in Stripe calls', async () => {
  const s = await base('f9'); try {
    let at = s.w.st.reqs.length; await (await s.post(s.body('1'.repeat(64)))).text();
    assert.equal(stripeCalls(s, at).length,0);
    say('F9 one unpaid POST (card + Base enabled):', stripeCalls(s, at).length, 'Stripe calls:', stripeCalls(s, at));
    at = s.w.st.reqs.length; await (await s.post(s.body('1'.repeat(64)))).text();
    assert.equal(stripeCalls(s, at).length,0);
    say('F9 the same claim again:', stripeCalls(s, at).length, 'Stripe calls');
    at = s.w.st.reqs.length; await office(s.w);
    assert.equal(stripeCalls(s, at).length,0);
    say('F9 one office view:', stripeCalls(s, at).length, 'Stripe calls:', stripeCalls(s, at), '| orders left by the dry exchange', orders(s.w).length - 1, '| snapshots', s.w.sql.prepare('SELECT COUNT(*) n FROM resource_snapshots').get().n);
    at = s.w.st.reqs.length; for (let i = 0; i < 20; i++) await (await s.post(s.body(String(i).padStart(64, '2')))).text();
    assert.equal(stripeCalls(s, at).length,0);
    say('F9 20 unpaid POSTs with 20 claims:', stripeCalls(s, at).filter((c) => c === 'POST /v1/payment_intents').length, 'PaymentIntents created in the studio account;', orders(s.w).length, 'order rows');
  } finally { s.K.restore(); await s.w.close(); }
});
