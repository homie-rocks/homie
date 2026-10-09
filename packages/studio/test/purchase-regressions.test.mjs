import { test } from 'node:test';
import assert from 'node:assert/strict';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const kit = await import(`${ROOT}/packages/studio/test/paid-parts-review5-kit.mjs`);
const { card, base, say, text, orders, jobs, settlements, cron, office, netCard, cardCharges, shopMod, worker, LIVE_KEY, TEST_KEY } = kit;
const ordinary = (await import(`${ROOT}/packages/studio/worker/index.mjs`)).default;
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
const attempt = async (fn) => { try { return await text(await fn()); } catch (e) { return `THREW ${e.message}`; } };
const stripeReqs = (s, from = 0) => s.w.st.reqs.slice(from).map((r) => `${r.method} ${r.path.replace(/pi_\w+/, 'pi_*')}`);
const tally = (list) => Object.entries(list.reduce((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {})).map(([k, v]) => `${v}x ${k}`).join(', ') || 'none';
const stripeHostOf = (s) => s.w.stripeHost;
const H = 3600_000;

test('N1 the ordinary entry, bound to a bucket that holds paid files (first selling deploy uploads before the Worker changes; any rollback)', async () => {
  const s = await card('n1'); try {
    s.w.env.MEDIA = s.w.env.PURCHASE_MEDIA;
    const keys = [...s.w.objects.keys()];
    say('N1 bucket keys', keys.map((k) => k.slice(0, 40)));
    const get = async (entry, path) => { try { const r = await entry.fetch(new Request(`https://seller.example${path}`), s.w.env, ctx()); return `${r.status} ${(await r.text()).slice(0, 60).replace(/\n/g, ' ')}`; } catch (e) { return `THREW ${e.message.slice(0, 80)}`; } };
    const manifest = '/media/paid-parts/releases/camera/0.1.0.json';
    const file = `/media/${keys.find((k) => k.startsWith('paid-parts/files/'))}`;
    say('N1 selling entry  GET manifest:', await get(worker, manifest), '| file:', await get(worker, file));
    const om = await get(ordinary, manifest); const of = await get(ordinary, file);
    say('N1 ORDINARY entry GET manifest:', om, '| file:', of);
    for (const p of ['/api/purchases/resource', '/purchases/keys.json', '/openapi.json', '/api/purchases/mcp']) say('N1 ordinary entry', p, await get(ordinary, p));
    assert.ok(!om.startsWith('200') && !of.startsWith('200'), 'the ordinary Worker serves paid files to anyone');
  } finally { s.K.restore(); await s.w.close(); }
});

test('N2 selling entry on a studio that never set selling up: no payment code path takes money, no Stripe call', async () => {
  const s = await card('n2', { machine: null }); try {
    delete s.w.env.PURCHASE_MACHINE_PAYMENTS; const before = s.w.st.reqs.length;
    const r = await s.post(s.body()); say('N2 unpaid POST, no machine config:', await text(r));
    const c = await cron(s.w, 1); say('N2 cron', c, '| Stripe calls', stripeReqs(s, before));
    assert.notEqual(r.status, 402); assert.equal(s.w.st.reqs.length, before);
  } finally { s.K.restore(); await s.w.close(); }
});

test('N3 Stripe calls: 100 unpaid challenges, 20 office views, and the scheduled job', async () => {
  const s = await base('n3'); try {
    let from = s.w.st.reqs.length; const statuses = [];
    for (let i = 0; i < 100; i++) statuses.push((await s.post(s.body(i.toString(16).padStart(64, '0')))).status);
    say('N3 100 unpaid POSTs (card + Base enabled): statuses', tally(statuses.map(String)), '| Stripe calls', s.w.st.reqs.length - from, '| order rows', orders(s.w).length);
    const unpaid = s.w.st.reqs.length - from;
    from = s.w.st.reqs.length; for (let i = 0; i < 20; i++) await office(s.w);
    say('N3 20 office views: Stripe calls', s.w.st.reqs.length - from, tally(stripeReqs(s, from)));
    const views = s.w.st.reqs.length - from;
    from = s.w.st.reqs.length; const scheduledStart = from; const c = await cron(s.w, 1);
    say('N3 ONE scheduled run, nothing pending:', c, '| Stripe calls', s.w.st.reqs.length - from, ':', tally(stripeReqs(s, from)));
    from = s.w.st.reqs.length; await cron(s.w, 12);
    say('N3 12 more runs (one hour): Stripe calls', s.w.st.reqs.length - from, ':', tally(stripeReqs(s, from)));
    assert.equal(unpaid, 0); assert.equal(views, 0);
    assert.ok(s.w.st.reqs.slice(scheduledStart).every((r) => r.method === 'GET'));
    assert.ok(s.w.st.reqs.length - scheduledStart <= 3, 'one bounded read check per six hours');
  } finally { s.K.restore(); await s.w.close(); }
});

test('N4a unknown outcome: Stripe unreachable for 23 hours after a card credential was presented (no charge exists)', async (t) => {
  const s = await card('n4a'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const f = s.K.fault({ sticky: true, match: (l) => l.includes(stripeHostOf(s)), before: () => Response.json({ error: { type: 'api_error', message: 'stand-in down' } }, { status: 503 }) });
    say('N4a paid POST while Stripe is down:', await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })), '| jobs', jobs(s.w).map((j) => j.state));
    await cron(s.w, 1); say('N4a cron at +0: jobs', jobs(s.w).map((j) => `${j.state} x${j.attempts}`));
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(23 * H + 60_000);
    const posts = () => s.w.st.reqs.filter((r) => r.method === 'POST' && r.path === '/v1/payment_intents').length;
    const p0 = posts(); await cron(s.w, 2);
    say('N4a cron at +23h: jobs', jobs(s.w).map((j) => `${j.state} | ${j.error}`), '| order', orders(s.w)[0]?.status, '| charge POSTs reaching Stripe after the deadline', posts() - p0);
    s.K.faults.splice(s.K.faults.indexOf(f), 1);
    await cron(s.w, 2);
    say('N4a Stripe back, 2 more runs: jobs', jobs(s.w).map((j) => j.state), '| order', orders(s.w)[0]?.status, '| charges', cardCharges(s.w).length);
    say('N4a buyer, same claim, no credential:', await attempt(() => s.post(s.body())));
    const off = await office(s.w); const o = orders(s.w)[0];
    say('N4a office paymentRecovery', off.paymentRecovery, '| order row in office', JSON.stringify(off.orders?.find((x) => x.id === o?.id) ?? null).slice(0, 260));
    say('N4a owner refund:', JSON.stringify(await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id })).slice(0, 220));
    t.mock.timers.tick(48 * H); await cron(s.w, 2);
    const later = await attempt(() => s.post(s.body()));
    say('N4a two days later, same claim:', later, '| jobs', jobs(s.w).map((j) => j.state), '| order', orders(s.w)[0]?.status);
    const fresh = await s.post(s.body('e'.repeat(64))); say('N4a a different claim can start:', fresh.status);
    t.mock.timers.reset();
    assert.ok(!later.startsWith('503'), 'the claim is locked for ever and nothing the owner can do releases it');
  } finally { s.K.restore(); await s.w.close(); }
});

test('N4b unknown outcome: Stripe took the charge, every answer was lost for 23 hours', async (t) => {
  const s = await card('n4b'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    const f = s.K.fault({ sticky: true, match: (l) => l.includes(stripeHostOf(s)), after: () => Response.json({ error: { type: 'api_error', message: 'answer lost' } }, { status: 500 }) });
    say('N4b paid POST, answer lost:', await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })), '| Stripe charges', cardCharges(s.w).length);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(23 * H + 60_000);
    await cron(s.w, 1); s.K.faults.splice(s.K.faults.indexOf(f), 1); await cron(s.w, 3);
    const o = orders(s.w)[0];
    say('N4b +23h, Stripe healthy again, 3 runs: jobs', jobs(s.w).map((j) => `${j.state} | ${j.error}`), '| order', o?.status, 'payment', o?.payment, '| net charges', netCard(s.w));
    say('N4b buyer same claim:', await attempt(() => s.post(s.body())), '| grant', (await s.grant()).status);
    const off = await office(s.w);
    say('N4b office row', JSON.stringify(off.orders?.find((x) => x.id === o?.id) ?? null).slice(0, 200), '| owner refund', JSON.stringify(await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id })).slice(0, 200));
    const pi = cardCharges(s.w)[0];
    say('N4b late webhook payment_intent.succeeded:', await s.w.event('payment_intent.succeeded', { id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, status: 'succeeded', metadata: pi.metadata }, 'evt_n4b', true), '| order', orders(s.w)[0]?.status, '| grant', (await s.grant()).status);
    t.mock.timers.reset();
  } finally { s.K.restore(); await s.w.close(); }
});

test('N5 card charged, process dies, the key is refused (401) when recovery replays', async (t) => {
  for (const hook of [false, true]) {
    const s = await card(`n5${hook}`); try {
      const ch = await s.challengeOf(await s.post(s.body()));
      s.K.at = s.K.n + 4; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); const died = s.K.diedAt; s.K.revive();
      const pi = cardCharges(s.w)[0];
      const f = s.K.fault({ sticky: true, match: (l) => l.includes(stripeHostOf(s)), before: () => Response.json({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided: rk_live_****' } }, { status: 401 }) });
      const c1 = await cron(s.w, 1);
      say(`N5 hook=${hook} died after "${died}" | charges ${cardCharges(s.w).length} | cron with 401: ${c1} jobs`, jobs(s.w).map((j) => `${j.state} | ${j.error}`), '| order', orders(s.w)[0]?.status);
      s.K.faults.splice(s.K.faults.indexOf(f), 1);
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(6 * 60_000);
      if (hook) say('N5 webhook:', await s.w.event('payment_intent.succeeded', { id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, status: 'succeeded', metadata: pi.metadata }, `evt_n5${hook}`, true));
      await cron(s.w, 3);
      const o = orders(s.w)[0];
      say(`N5 hook=${hook} key restored, +6 min, 3 runs: order`, o?.status ?? 'ROW DELETED', '| jobs', jobs(s.w).map((j) => j.state), '| net charges', netCard(s.w), '| grant', (await s.grant()).status, '| buyer same claim:', await attempt(() => s.post(s.body())));
      if (!hook) say('N5 late webhook after the row is gone:', await s.w.event('payment_intent.succeeded', { id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, status: 'succeeded', metadata: pi.metadata }, 'evt_n5late', true), '| orders', orders(s.w).map((x) => `${x.status} ${x.payment}`), '| net charges', netCard(s.w));
      t.mock.timers.reset();
    } finally { s.K.restore(); await s.w.close(); }
  }
});

test('N6 owner-confirmed refund of an unrecorded Base transfer: what counts as proof', async () => {
  const s = await base('n6'); try {
    s.w.st.cryptoReject = 'Crypto transaction verification is not enabled on this account.';
    const r1 = await s.post(s.body()); const paid = await s.post(s.body(), await s.sign(r1));
    await cron(s.w, 1);
    const o = orders(s.w)[0]; const pay = s.C.transfers[0];
    say('N6 paid', paid.status, '| order', o.status, 'payment', o.payment, '| jobs', jobs(s.w).map((j) => `${j.state} | ${j.error?.slice(0, 60)}`));
    const need = await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id });
    say('N6 owner refund without a transaction:', JSON.stringify(need).slice(0, 420));
    const off = await office(s.w); say('N6 office row manualRefund', JSON.stringify(off.orders.find((x) => x.id === o.id)?.manualRefund ?? null).slice(0, 300));
    say('N6 buyer asks for a refund:', JSON.stringify(await s.w.api('/api/purchases/refund', {}, 'd'.repeat(64))).slice(0, 300));
    const stranger = '0x' + '9'.repeat(40);
    // a transfer of the same amount that reached the payer BEFORE the purchase, from somebody else (the payer funding the wallet)
    const old = { hash: '0x' + 'a'.repeat(64), nonce: '0x0', from: stranger, to: pay.from, value: pay.value, asset: pay.asset, block: 5 };
    s.C.transfers.push(old);
    const wrongAmount = { hash: '0x' + 'b'.repeat(64), nonce: '0x1', from: s.recipient, to: pay.from, value: String(BigInt(pay.value) - 1n), asset: pay.asset, block: 200 };
    s.C.transfers.push(wrongAmount);
    const wrongPayee = { hash: '0x' + 'e'.repeat(64), nonce: '0x2', from: s.recipient, to: stranger, value: pay.value, asset: pay.asset, block: 201 };
    s.C.transfers.push(wrongPayee);
    const tryIt = async (label, hash) => say(`N6 ${label}:`, JSON.stringify(await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id, manualTransaction: hash })).slice(0, 200), '| order', orders(s.w)[0].status);
    await tryIt('the original payment as the refund', pay.hash);
    await tryIt('one unit short', wrongAmount.hash);
    await tryIt('right amount to another address', wrongPayee.hash);
    await tryIt('unknown transaction', '0x' + 'f'.repeat(64));
    await tryIt('an OLDER transfer to the payer from a third party, made before the purchase', old.hash);
    const final = orders(s.w)[0];
    say('N6 final order', final.status, '| grant after "refund"', (await s.grant()).status);
    assert.notEqual(final.status, 'refunded', 'a transfer made before the purchase by somebody else was accepted as the refund');
  } finally { s.K.restore(); await s.w.close(); }
});

test('N7 sandbox readiness purchase: what it leaves behind, what a failure does, and live mode', async () => {
  const s = await card('n7', { key: TEST_KEY }); try {
    let from = s.w.st.reqs.length;
    s.w.st.failOnce.push({ path: '/v1/test_helpers/shared_payment/granted_tokens', status: 500 });
    const c1 = await cron(s.w, 1);
    const meta = () => JSON.parse(s.w.sql.prepare("SELECT value FROM meta WHERE key = 'purchase-test-exchange'").get()?.value ?? 'null');
    say('N7 first run, Stripe answers 500 once to the token helper:', c1, '| cached', JSON.stringify(meta()).slice(0, 200), '| orders', orders(s.w).map((o) => o.status));
    const c2 = await cron(s.w, 3);
    say('N7 three more runs with Stripe healthy: cached', JSON.stringify(meta()).slice(0, 160), '| office ready', JSON.stringify((await office(s.w)).purchases ?? (await office(s.w)).parts ?? null).slice(0, 300));
    s.w.sql.prepare("DELETE FROM meta WHERE key = 'purchase-test-exchange'").run();
    from = s.w.st.reqs.length; const c3 = await cron(s.w, 1);
    say('N7 cache cleared, one run:', c3, '| cached', JSON.stringify(meta()).slice(0, 330));
    say('N7 Stripe calls of that run:', tally(stripeReqs(s, from)));
    say('N7 left behind: orders', orders(s.w).map((o) => `${o.status} pay=${o.payment} fulfilled=${Boolean(o.fulfilled_at)}`), '| jobs', jobs(s.w).map((j) => j.state), '| receipts', s.w.sql.prepare('SELECT count(*) n FROM purchase_receipts').get().n, '| approvals', s.w.sql.prepare('SELECT count(*) n FROM purchase_test_approvals').get().n, '| grants', s.w.sql.prepare('SELECT count(*) n FROM purchase_grants').get().n, '| snapshots', s.w.sql.prepare('SELECT count(*) n FROM resource_snapshots').get().n);
    assert.equal(orders(s.w).length, 0, 'maintenance creates no sandbox sales');
    assert.equal(meta(), null, 'a sandbox check requires an explicit owner request');
    const off = await office(s.w);
    say('N7 office orders shown to the owner:', (off.orders ?? []).map((o) => `${o.item ?? o.name} ${o.status} ${o.shown ?? ''}`), '| totals', JSON.stringify(off.totals ?? null).slice(0, 160));
  } finally { s.K.restore(); await s.w.close(); }
  const l = await card('n7live'); try {
    const from = l.w.st.reqs.length; await cron(l.w, 2);
    say('N7 LIVE key, 2 runs: test helper calls', l.w.st.reqs.slice(from).filter((r) => r.path.includes('test_helpers')).length, '| orders', orders(l.w).length, '| cached', l.w.sql.prepare("SELECT count(*) n FROM meta WHERE key = 'purchase-test-exchange'").get().n);
    assert.equal(l.w.st.reqs.slice(from).filter((r) => r.path.includes('test_helpers')).length, 0); assert.equal(orders(l.w).length, 0);
  } finally { l.K.restore(); await l.w.close(); }
});

test('N8 stale capability record: the key is revoked between scheduled checks', async () => {
  const s = await base('n8'); try {
    const revoked = { sticky: true, match: (l) => l.includes(stripeHostOf(s)), before: () => Response.json({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided: rk_live_****' } }, { status: 401 }) };
    s.K.fault(revoked);
    const r1 = await s.post(s.body()); say('N8 key revoked, before the next check: unpaid POST', r1.status, '| offers', (r1.headers.get('www-authenticate') ?? '').match(/method="[^"]+"/g), '| x402', Boolean(r1.headers.get('payment-required')));
    const off0 = await office(s.w); say('N8 office before the check:', JSON.stringify(off0.purchases ?? off0.partsReadiness ?? Object.keys(off0)).slice(0, 300));
    const paid = await attempt(async () => s.post(s.body(), await s.sign(r1)));
    const o = orders(s.w)[0];
    say('N8 x402 payment in the stale window:', paid, '| USDC moved', s.C.moved(), '| order', o?.status, 'payment', o?.payment, '| jobs', jobs(s.w).map((j) => `${j.state} | ${j.error?.slice(0, 50)}`));
    const c = await cron(s.w, 1);
    const r2 = await s.post(s.body('1'.repeat(64))); say('N8 after ONE scheduled run', c, ': new buyer unpaid POST', await text(r2));
    s.K.faults.splice(s.K.faults.indexOf(revoked), 1);
    await cron(s.w, 1);
    const r3 = await s.post(s.body('2'.repeat(64))); say('N8 key works again, one run later: new buyer unpaid POST', r3.status, '| caps', s.w.sql.prepare("SELECT value FROM meta WHERE key = 'purchase-capabilities'").get()?.value.slice(0, 260));
    const o2 = orders(s.w).find((x) => x.id === o?.id);
    say('N8 the stale-window order now:', o2?.status, 'payment', o2?.payment, '| jobs', jobs(s.w).filter((j) => j.order_id === o?.id).map((j) => j.state), '| owner refund', JSON.stringify(await shopMod.performRefund(s.w.env, s.w.cat, { order: o.id })).slice(0, 160));
  } finally { s.K.restore(); await s.w.close(); }
});

test('N9 a buyer-triggered Stripe refusal whose text matches the "account refusal" pattern switches the rail off for everyone', async () => {
  const s = await card('n9'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.K.fault({ match: (l) => l.startsWith('POST') && l.endsWith('/v1/payment_intents'), before: () => Response.json({ error: { type: 'card_error', code: 'card_declined', decline_code: 'card_not_supported', message: 'Your card is not supported in this country for this purchase.' } }, { status: 402 }) });
    say('N9 one buyer, a card Stripe declines:', await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })));
    const other = await s.post(s.body('3'.repeat(64)));
    say('N9 a different buyer afterwards:', await text(other));
    await cron(s.w, 2);
    const again = await s.post(s.body('4'.repeat(64)));
    say('N9 after two scheduled checks (Stripe says the key is fine):', await text(again));
    assert.equal(again.status, 402, 'one decline closed the card rail until the owner reconnects');
  } finally { s.K.restore(); await s.w.close(); }
});

test('N10 recovery cells: paid by card, process dies before delivery; storage missing, unreachable, unbound; then restored', async () => {
  const s = await card('n10'); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    s.K.at = s.K.n + 5; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); say('N10 died after', s.K.diedAt); s.K.revive();
    const saved = new Map(s.w.objects); const media = s.w.env.PURCHASE_MEDIA;
    for (const k of [...s.w.objects.keys()]) if (k.startsWith('paid-parts/files/')) s.w.objects.delete(k);
    const row = () => { const o = orders(s.w)[0]; return `${o.status} fulfilled=${Boolean(o.fulfilled_at)} | jobs ${jobs(s.w).map((j) => `${j.state} x${j.attempts}`)} | refunds ${s.w.st.refunds.length} | net ${netCard(s.w)}`; };
    say('N10 files missing, cron', await cron(s.w, 2), ':', row(), '| grant', (await s.grant()).status);
    s.w.env.PURCHASE_MEDIA = { get: async () => { throw new Error('R2 unreachable'); } };
    say('N10 storage unreachable, cron', await cron(s.w, 2), ':', row());
    delete s.w.env.PURCHASE_MEDIA;
    say('N10 bucket unbound, cron', await cron(s.w, 2), ':', row(), '| buyer retry:', await attempt(() => s.post(s.body())));
    const off = await office(s.w); say('N10 what the owner sees:', off.paymentRecovery);
    s.w.env.PURCHASE_MEDIA = media; for (const [k, v] of saved) s.w.objects.set(k, v);
    say('N10 storage restored, cron', await cron(s.w, 1), ':', row(), '| buyer retry', (await s.post(s.body())).status);
    assert.equal(s.w.st.refunds.length, 0); assert.equal(orders(s.w)[0].status, 'fulfilled');
  } finally { s.K.restore(); await s.w.close(); }
});
