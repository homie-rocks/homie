/** Review 5, step 5: does the office's readiness report match what a buyer meets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, say, text, orders, office, cardCharges, seller, instrument, LIVE_KEY, TEST_KEY, PP } from './paid-parts-review5-kit.mjs';
const probeMod = await import('../worker/payment-capabilities.mjs');
const reconnect = async (w) => { const c = await probeMod.probeMachinePayments(w.env); w.env.PURCHASE_PAYMENT_CAPABILITIES = JSON.stringify({ ...JSON.parse(w.env.PURCHASE_PAYMENT_CAPABILITIES), ...c }); w.env.PURCHASE_MACHINE_PAYMENTS = JSON.stringify({ [c.mode]: c.configuration }); return c; };
const brief = (p) => JSON.stringify({ ready: p?.ready, missing: p?.missing, methods: p?.machine?.machine, exchange: p?.exchange?.verified ?? p?.exchange?.reason });
async function tryBuy(s) {
  const r1 = await s.post(s.body()); if (r1.status !== 402) return `unpaid POST ${await text(r1)}`;
  const ch = await s.challengeOf(r1); if (!ch) return `402 without a stripe challenge (methods ${[...(r1.headers.get('www-authenticate') ?? '').matchAll(/method="([^"]+)"/g)].map((m) => m[1])})`;
  const paid = await s.post(s.body(), { authorization: s.cred(ch, s.spt()) }); return `paid POST ${(await text(paid)).slice(0, 150)}`;
}
test('U1 the toolkit path exactly (connect + parts keys + deploy), nothing set by hand', async () => {
  const s = await card('u1'); try {
    delete s.w.env.TURNSTILE_SECRET; delete s.w.env.TURNSTILE_SITE_KEY; // Optional human bot check: no extra provider credentials are required.
    await reconnect(s.w);
    const off = await office(s.w); assert.equal(off.purchases.ready,true); assert.equal(off.purchases.fallback.ready,true); say('U1 office:', brief(off.purchases));
    say('U1 buyer:', await tryBuy(s), '| charges', cardCharges(s.w).length);
  } finally { s.K.restore(); await s.w.close(); }
});
test('U2 key without PaymentIntents Write', async () => {
  const s = await card('u2'); try {
    s.w.st.denyWrite = ['/v1/payment_intents']; const c = await reconnect(s.w);
    say('U2 connect says:', JSON.stringify(c.machine), JSON.stringify(c.reasons).slice(0, 300));
    const off = await office(s.w); say('U2 office:', brief(off.purchases).slice(0, 500)); say('U2 buyer:', await tryBuy(s), '| charges', cardCharges(s.w).length);
    const doc = await (await fetch('https://seller.example/openapi.json')).json(); say('U2 published x-payment-info:', JSON.stringify(Object.values(doc.paths)[0]?.post['x-payment-info'] ?? null));
  } finally { s.K.restore(); await s.w.close(); }
});
test('U3 permission removed AFTER connect (key edited in Stripe)', async () => {
  const s = await card('u3'); try {
    s.w.st.denyWrite = ['/v1/payment_intents'];
    const off = await office(s.w); say('U3 office:', brief(off.purchases).slice(0, 400)); say('U3 buyer:', await tryBuy(s), '| charges', cardCharges(s.w).length);
    const doc = await (await fetch('https://seller.example/openapi.json')).json(); say('U3 published x-payment-info still says:', JSON.stringify(Object.values(doc.paths)[0]?.post['x-payment-info'] ?? null));
  } finally { s.K.restore(); await s.w.close(); }
});
test('U4 no business profile; stablecoins not enabled', async () => {
  const s = await card('u4'); try {
    s.w.st.deny = ['/v2/network/business_profiles', '/v1/payment_method_configurations']; const c = await reconnect(s.w);
    say('U4 connect says:', JSON.stringify(c.machine), JSON.stringify(c.reasons).slice(0, 420));
    const off = await office(s.w); say('U4 office:', brief(off.purchases).slice(0, 500)); say('U4 buyer:', await tryBuy(s));
  } finally { s.K.restore(); await s.w.close(); }
});
test('U5 account not eligible for shared payment tokens (country, or preview not granted): Stripe refuses only at confirm', async () => {
  const s = await card('u5'); try {
    await reconnect(s.w);
    s.K.fault({ sticky: true, match: (l, b) => /\/v1\/payment_intents$/.test(l) && /shared_payment_granted_token/.test(b), before: () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Shared payment tokens are not available for accounts in your country.' } }), { status: 400, headers: { 'content-type': 'application/json' } }) });
    const off = await office(s.w); say('U5 office:', brief(off.purchases), '| scope text:', off.purchases?.exchange?.scope);
    say('U5 buyer:', await tryBuy(s), '| charges', cardCharges(s.w).length);
    const off2 = await office(s.w); assert.equal(off2.purchases.ready,false); say('U5 office after the failed sale:', brief(off2.purchases), '| recovery rows', JSON.stringify(off2.paymentRecovery).slice(0, 240));
  } finally { s.K.restore(); await s.w.close(); }
});
test('U6 test mode', async () => {
  const s = await card('u6', { key: TEST_KEY }); try {
    await reconnect(s.w);
    const off = await office(s.w); say('U6 office:', brief(off.purchases));
    const r1 = await s.post(s.body()); say('U6 buyer unpaid POST:', await text(r1));
    await PP.authorizePurchaseTest(s.w.env, orders(s.w)[0].id); say('U6 after owner approval:', await tryBuy(s), '| charges', cardCharges(s.w).length);
  } finally { s.K.restore(); await s.w.close(); }
});
test('U7 what deploy writes for a studio with and without a paid part', async () => {
  const { wranglerConfig } = await import('../lib/scaffold.mjs');
  for (const paidParts of [false, true]) { const c = JSON.parse(wranglerConfig({ worker: 'w', name: 'n', d1: 'd', paidParts }).replace(/^\s*\/\/.*$/gm, '')); say(`U7 paidParts=${paidParts}: flags`, c.compatibility_flags, 'triggers', c.triggers ?? null, 'ratelimits', c.ratelimits ?? null); }
});
