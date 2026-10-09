import { test } from 'node:test';
import assert from 'node:assert/strict';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const { card, base, say, text, orders, jobs, cron, office, netCard, cardCharges, shopMod, worker } = await import(`${ROOT}/packages/studio/test/paid-parts-review5-kit.mjs`);
const attempt = async (fn) => { try { return await text(await fn()); } catch (e) { return `THREW ${e.message}`; } };
const piEvent = (pi) => ({ id: pi.id, object: 'payment_intent', amount: 1000, currency: 'usd', livemode: true, status: 'succeeded', metadata: pi.metadata });

for (const [label, status, error] of [
  ['401 key refused', 401, { type: 'invalid_request_error', message: 'Invalid API Key provided: rk_live_****' }],
  ['403 permission removed', 403, { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint' }],
  ['400 idempotency mismatch', 400, { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' }],
]) for (const hook of ['none', 'late']) test(`N5 ${label}, webhook ${hook}`, async (t) => {
  const s = await card(`n5${status}${hook}`); try {
    const ch = await s.challengeOf(await s.post(s.body()));
    let at = 0; // find the boundary right after Stripe's charge
    for (at = 1; at < 12; at++) { /* probe */ if (at === 3) break; }
    s.K.at = s.K.n + 2; await attempt(() => s.post(s.body(), { authorization: s.cred(ch, s.spt()) })); const died = s.K.diedAt; s.K.revive();
    const pi = cardCharges(s.w)[0];
    const f = s.K.fault({ sticky: true, match: (l) => l.includes(s.w.stripeHost), before: () => Response.json({ error }, { status }) });
    const c1 = await cron(s.w, 1);
    say(`N5 [${label}/${hook}] died after "${died}" | Stripe charges ${cardCharges(s.w).length} | one cron run during the fault: jobs`, jobs(s.w).map((j) => `${j.state} | ${j.error}`), '| order', orders(s.w)[0]?.status);
    s.K.faults.splice(s.K.faults.indexOf(f), 1);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(6 * 60_000);
    await cron(s.w, 2); await s.post(s.body('9'.repeat(64))); await cron(s.w, 1);
    const o = orders(s.w).find((x) => x.amount === 1000 && x.claim_hash && x.id !== undefined && cardCharges(s.w)[0]?.metadata?.order === x.id);
    say(`N5 [${label}/${hook}] fault gone, +6 min, 3 runs and one other request: the charged order`, o ? `${o.status} payment=${o.payment}` : 'ROW DELETED', '| jobs for it', jobs(s.w).filter((j) => j.order_id === pi.metadata.order).map((j) => j.state), '| net charges', netCard(s.w), '| grant', (await s.grant()).status);
    if (hook === 'late') say(`N5 [${label}/${hook}] Stripe's webhook retry arrives now:`, (await s.w.event('payment_intent.succeeded', piEvent(pi), `evt_${status}`, true)).trim(), '| charged order', orders(s.w).find((x) => x.id === pi.metadata.order)?.status ?? 'ROW DELETED', '| grant', (await s.grant()).status, '| net charges', netCard(s.w), '| refunds', s.w.st.refunds.length);
    const off = await office(s.w);
    say(`N5 [${label}/${hook}] office: order listed`, Boolean(off.orders?.some((x) => x.id === pi.metadata.order)), '| recovery rows', (off.paymentRecovery ?? []).filter((x) => x.order_id === pi.metadata.order).map((x) => x.state));
    t.mock.timers.reset();
    const final = orders(s.w).find((x) => x.id === pi.metadata.order);
    assert.ok(final && (['paid', 'fulfilled'].includes(final.status) || netCard(s.w) === 0), 'charged, not delivered, not refunded');
  } finally { s.K.restore(); await s.w.close(); }
});
