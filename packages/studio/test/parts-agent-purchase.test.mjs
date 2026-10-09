import { configureMachine } from './paid-parts-review4-harness.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mppx, stripe } from 'mppx/client';
import { world, LIVE_KEY, addPart, sale$, PP } from './paid-parts-review4-harness.mjs';
import { mainRecord } from './paid-parts-review3-common.mjs';
import { machineResource } from '../worker/purchase-machine.mjs';
import { payWithWallet } from '../lib/purchase-wallet.mjs';

test('agent discovers, pays through upstream MPP client, receives, verifies, updates, recovers and refunds with only seller and provider reachable', async () => {
  const w = await world('agent-exchange', { key: LIVE_KEY, saleOpts: { updates: 'all', refundWindowDays: 14 } });
  const original = globalThis.fetch;
  const hosts = new Set(); const blocked = [];
  let charged = 0; let approved = 0; let delivered;
  const client = { rawRequest() {}, paymentIntents: { async create(params) {
    charged++;
    const pi = w.st.pay(params.amount, params.metadata);
    return { ...pi, amount: params.amount, currency: params.currency, livemode: true, status: 'succeeded' };
  } } };
  await configureMachine(w, { profile: 'profile_example' });
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url); hosts.add(url.host);
    if (url.host === new URL(w.st.base).host) return original(input, init);
    if (url.host !== 'seller.example') { blocked.push(url.host); throw new Error('Host blocked'); }
    if (url.pathname === '/api/purchases/resource') return machineResource(request, w.env, url, w.cat, { client });
    return w.fetcher(request);
  };
  try {
    const wallet = Mppx.create({ polyfill: false, fetch: globalThis.fetch, methods: [stripe.charge({ paymentMethod: 'pm_example', createToken: async ({ amount, currency }) => {
      assert.equal(String(amount), '1000'); assert.equal(currency, 'usd');
      approved++; assert.equal(approved, 1, 'one approved spend'); return 'spt_example';
    } })] });
    const walletPay = async (url, body) => {
      const response = await wallet.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 200, await response.clone().text());
      delivered = await response.json(); return { data: delivered };
    };
    const add = (options = {}) => addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), wallet: 'link-cli', walletPay, ...options });
    const catalogue = await (await fetch('https://seller.example/.well-known/api-catalog')).json();
    assert.ok(catalogue.linkset);
    const quote = await add(); assert.equal(charged, 0); assert.match(quote.purchase.price, /10\.00/);
    const bought = await add({ approve: quote.purchase.quote });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.ok(delivered.proof); assert.ok(delivered.files.length > 0); assert.equal(charged, 1);
    const record = mainRecord(w.buyer);
    const grant = await w.api('/api/purchases/grant', { audience: 'https://buyer.example' }, record.claim);
    assert.equal((await w.api('/api/purchases/verify', { proof: grant.data.hubProof, audience: 'https://buyer.example' })).data.current, true);
    await w.release('0.2.0'); assert.equal((await add()).ok, true); assert.equal(charged, 1);
    assert.equal((await w.api('/api/purchases/recover', {}, record.claim)).status, 200);
    const claim = '9'.repeat(64);
    assert.equal((await PP.reissuePurchaseClaim(w.env, { order: record.order, claimHash: await sale$.digest(claim), receiptVerified: true })).ok, true);
    assert.equal((await w.api('/api/purchases/grant', {}, record.claim)).status, 401);
    assert.equal((await w.api('/api/purchases/grant', {}, claim)).status, 200);
    assert.equal((await w.api('/api/purchases/refund', {}, claim)).data.status, 'succeeded');
    assert.equal((await w.api('/api/purchases/grant', {}, claim)).status, 402);
    assert.deepEqual(blocked, []); assert.ok(hosts.has('seller.example')); assert.equal(hosts.size, 2);
  } finally { globalThis.fetch = original; await w.close(); }
});

test('Link wallet owns spend approval; retry carries its original approval challenge', async () => {
  const body = { part: 'camera', version: '0.1.0', amount: 1000 };
  const first = await payWithWallet('https://seller.example/api/purchases/resource', body, { client: 'link-cli', run: async (client, args) => {
    assert.equal(client, 'link-cli'); assert.equal(args[args.indexOf('--amount') + 1], '1000');
    assert.ok(!args.includes('--yes'));
    return { stdout: JSON.stringify({ id: 'spend_example', approval_url: 'https://link.com/approve', _next: { pay_argv: { args: ['--approved-challenge', 'challenge_example'] } } }) };
  } });
  assert.equal(first.approval, 'https://link.com/approve');
  await payWithWallet('https://seller.example/api/purchases/resource', body, { client: 'link-cli', pending: first.pending, run: async (client, args) => {
    assert.equal(args[args.indexOf('--spend-request-id') + 1], 'spend_example');
    assert.equal(args[args.indexOf('--approved-challenge') + 1], 'challenge_example');
    assert.ok(!args.includes('--amount'));
    return { stdout: JSON.stringify({ body: { order: 'order_example' } }) };
  } });
});

test('crypto clients receive the approved price through their native limits', async () => {
  for (const client of ['purl', 'tempo']) {
    await payWithWallet('https://seller.example/api/purchases/resource', { part: 'camera', version: '0.1.0', amount: 1234 }, { client, run: async (program, args) => {
      assert.equal(program, client);
      assert.equal(args[args.indexOf(client === 'purl' ? '--max-amount' : '--max-spend') + 1], client === 'purl' ? '12340000' : '12.34');
      assert.ok(!args.includes('--yes')); assert.ok(!args.includes('--private-key'));
      return { stdout: JSON.stringify({ order: 'order_example' }) };
    } });
  }
});

test('a stale provider read cannot reopen a canonically refunded purchase', async () => {
  const { recordOrderState } = await import('../worker/purchase-core.mjs');
  const w = await world('refund-race', { key: LIVE_KEY });
  try {
    const bought = await w.buy(); await w.event('checkout.session.completed', bought.session);
    assert.equal((await w.add()).ok, true);
    const record = mainRecord(w.buyer);
    const order = await PP.byId(w.env, record.order);
    await recordOrderState(w.env, order, 'refunded');
    // The stand-in deliberately still answers with its old, paid charge.
    const grant = await w.api('/api/purchases/grant', {}, record.claim);
    assert.equal(grant.status, 402); assert.match(grant.data.message, /refunded/);
  } finally { await w.close(); }
});
