import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, configureMachine, LIVE_KEY, shopMod } from './paid-parts-review4-harness.mjs';

test('office proves a dry resource exchange and explicitly distinguishes it from settlement', async () => {
  const w = await world('office-dry', { key: LIVE_KEY });
  try {
    w.sql.exec('CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT)');
    await configureMachine(w, { profile: 'profile_example' });
    const report = await shopMod.shopOffice(w.env, w.cat, 'https://seller.example');
    assert.equal(report.purchases.exchange.verified, true, JSON.stringify(report.purchases));
    assert.equal(report.purchases.exchange.challenge.realm, 'seller.example');
    assert.match(report.purchases.exchange.scope, /No wallet credential/);
    assert.match(report.purchases.exchange.scope, /refunds are not verified/);
    assert.equal(w.st.pis.size, 0);
    assert.equal(w.sql.prepare('SELECT count(*) AS n FROM purchase_orders').get().n, 0);
    const file = [...w.objects.keys()].find((key) => key.includes('/files/'));
    w.objects.delete(file);
    const missing = await shopMod.shopOffice(w.env, w.cat, 'https://seller.example');
    assert.equal(missing.purchases.exchange.verified, false);
    assert.equal(missing.purchases.ready, false);
  } finally { await w.close(); }
});

test('owner-requested sandbox readiness reads configuration and creates no sale', async () => {
  const { testPaymentExchange } = await import('../worker/payment-test-exchange.mjs');
  const w = await world('sandbox-exchange');
  try {
    await configureMachine(w, {profile:'profile_example'});
    const result = await testPaymentExchange(w.env, 'https://seller.example', w.cat);
    assert.equal(result.verified,true,JSON.stringify(result));
    assert.equal(w.st.refunds.length,0);
    assert.ok(w.st.reqs.every((r) => r.method === 'GET'));
    assert.equal(w.sql.prepare('SELECT count(*) n FROM purchase_orders').get().n,0);
    assert.ok(result.nextCheckAt > result.checkedAt);
    const calls = w.st.calls.length;
    assert.deepEqual(await testPaymentExchange(w.env,'https://seller.example',w.cat),result);
    assert.equal(w.st.calls.length,calls);
  } finally { await w.close(); }
});

test('hosted readiness and the intent route agree on invalid or missing configuration', async () => {
  const { hostedReadiness } = await import('../worker/purchase-hosted-readiness.mjs');
  for (const [setting, value] of [['STRIPE_KEY','invalid'], ['STRIPE_WEBHOOK_SECRET','invalid'], ['PURCHASE_SIGNING_KEYS','[]']]) {
    const w = await world(`hosted-${setting}`, {key:LIVE_KEY});
    try {
      const quote = await w.add();
      assert.ok(quote.purchase?.quote);
      w.env[setting] = value;
      const readiness = await hostedReadiness(w.env,w.cat);
      assert.equal(readiness.ready,false,setting);
      const result = await w.add({approve:quote.purchase.quote});
      assert.equal(result.ok,false,setting);
      assert.ok(readiness.missing.some((reason)=>result.why.includes(reason)),JSON.stringify({setting,readiness,result}));
      assert.equal(w.st.sessions.size,0);
    } finally { await w.close(); }
  }
});


test('scheduled readiness is read-only and bounded to four checks per day', async (t) => {
  const { refreshMachineCapabilities } = await import('../worker/payment-capabilities.mjs');
  const w = await world('readiness-day');
  try {
    await configureMachine(w, { profile: 'profile_example' });
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const start = w.st.reqs.length;
    for (let tick = 0; tick < 288; tick++) {
      await refreshMachineCapabilities(w.env);
      t.mock.timers.tick(300000);
    }
    const calls = w.st.reqs.slice(start);
    assert.ok(calls.every((call) => call.method === 'GET'));
    assert.equal(calls.filter((call) => call.path === '/v2/network/business_profiles/me').length, 4);
    assert.ok(calls.length <= 12);
  } finally { t.mock.timers.reset(); await w.close(); }
});

test('a sandbox readiness failure expires and the same key recovers', async (t) => {
  const { testPaymentExchange } = await import('../worker/payment-test-exchange.mjs');
  const w = await world('readiness-retry');
  const original = globalThis.fetch;
  try {
    await configureMachine(w, { profile: 'profile_example' });
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    globalThis.fetch = async () => Response.json({error:{type:'api_error',message:'Temporary provider failure'}},{status:503});
    const failed = await testPaymentExchange(w.env);
    assert.equal(failed.verified,false);
    assert.equal(failed.nextCheckAt - failed.checkedAt,300000);
    globalThis.fetch = original;
    assert.equal((await testPaymentExchange(w.env)).verified,false);
    t.mock.timers.tick(300000);
    const recovered = await testPaymentExchange(w.env);
    assert.equal(recovered.verified,true);
    assert.ok(recovered.checkedAt > failed.checkedAt);
    assert.equal(w.st.pis.size,0);
    assert.equal(w.st.refunds.length,0);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); await w.close(); }
});
