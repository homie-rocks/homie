import { purchaseMcp } from '../worker/purchase-mcp.mjs';
import { configureMachine } from './paid-parts-review4-harness.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenge, Credential, Receipt } from 'mppx';
import { world, LIVE_KEY, sale$, readPart } from './paid-parts-review4-harness.mjs';
import { machineResource } from '../worker/purchase-machine.mjs';

test('MPP challenge, credential, files and proof in one exchange; retry does not charge twice', async () => {
  const w = await world('mpp', { key: LIVE_KEY });
  try {
    await configureMachine(w, { manualRefunds: true, profile: 'profile_example' });
    const part = await (await w.fetcher('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = { kind: 'part', resource: part.id, version: part.version, buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part) };
    let calls = 0;
    const client = { rawRequest() {}, paymentIntents: { async create(params) {
      calls++;
      const pi = w.st.pay(params.amount, params.metadata);
      return { ...pi, amount: params.amount, currency: params.currency, livemode: true, status: 'succeeded' };
    } } };
    const run = (authorization) => {
      const request = new Request('https://seller.example/api/purchases/resource', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
      return machineResource(request, w.env, new URL(request.url), w.cat, { client });
    };
    const challengeResponse = await run();
    assert.equal(challengeResponse.status, 402);
    const challenge = Challenge.fromResponse(challengeResponse);
    assert.equal(challenge.request.amount, '1000');
    const credential = Credential.serialize({ challenge, payload: { spt: 'spt_example' } });
    const paid = await run(credential);
    assert.equal(paid.status, 200, await paid.clone().text());
    const receipt = Receipt.fromResponse(paid);
    assert.equal(receipt.status, 'success');
    const result = await paid.json();
    assert.ok(result.proof);
    assert.equal(result.files.length, part.files.length);
    assert.equal(calls, 1);
    assert.equal((await run(credential)).status, 200);
    assert.equal(calls, 1);
  } finally { await w.close(); }
});

test('x402 exact uses a signed wallet payload and settles to the Stripe Base deposit address', async () => {
  const { x402Client } = await import('@x402/core/client');
  const { ExactEvmScheme } = await import('@x402/evm/exact/client');
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const w = await world('x402', { key: LIVE_KEY });
  try {
    await configureMachine(w, { manualRefunds: true, profile: 'profile_example', base: recipient });
    const part = await (await w.fetcher('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = { kind: 'part', resource: part.id, version: part.version, buyer: 'c'.repeat(64), claim: 'd'.repeat(64), quote: await sale$.quoteHash(part) };
    let settled = 0; let recorded; let recordingAttempts = 0;
    const facilitator = {
      async verify(payload, requirements) { assert.equal(requirements.payTo.toLowerCase(), recipient.toLowerCase()); return { isValid: true, payer: account.address }; },
      async settle(payload, requirements) { settled++; assert.equal(payload.accepted.amount, '10000000'); return { success: true, network: requirements.network, transaction: `0x${'a'.repeat(64)}`, payer: account.address }; },
    };
    const client = { rawRequest() {}, paymentIntents: { async create(params) {
      recorded = params;
      if (++recordingAttempts === 1) throw new Error('temporary provider recording failure');
      const pi = w.st.pay(params.amount, params.metadata);
      return { ...pi, amount: params.amount, currency: 'usd', livemode: true, status: 'succeeded' };
    } } };
    const run = (signature) => {
      const request = new Request('https://seller.example/api/purchases/resource', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'payment-signature': signature } : {}) }, body: JSON.stringify(body) });
      return machineResource(request, w.env, new URL(request.url), w.cat, { client, facilitator, chainRpc: async () => '0x1' });
    };
    const challenge = await run();
    assert.equal(challenge.status, 402);
    const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString());
    const wallet = x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } });
    const payload = await wallet.createPaymentPayload(required);
    const signature = Buffer.from(JSON.stringify(payload)).toString('base64');
    const interrupted = await run(signature);
    assert.equal(interrupted.status, 200, await interrupted.clone().text());
    const response = await run(signature);
    assert.equal(response.status, 200, await response.clone().text());
    assert.ok(response.headers.get('payment-response'));
    assert.equal((await response.json()).files.length, part.files.length);
    assert.equal(recorded.payment_method_options.crypto.transaction_verification_options.network, 'base');
    assert.equal(settled, 1);
    assert.ok(JSON.parse(w.sql.prepare('SELECT payload FROM purchase_settlements').get().payload).challengeId);
    assert.equal(recordingAttempts, 1);
    assert.equal(w.sql.prepare("SELECT state FROM purchase_jobs").get().state, 'complete');
    assert.equal(w.st.pis.size, 1);
    assert.equal((await run(signature)).status, 200);
    assert.equal(settled, 1);
  } finally { await w.close(); }
});

test('MCP uses the protocol binding for challenges and receipts', async () => {
  const w = await world('mcp-payment', { key: LIVE_KEY });
  try {
    await configureMachine(w, { manualRefunds: true, profile: 'profile_example' });
    const part = await (await w.fetcher('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const args = { kind: 'part', resource: part.id, version: part.version, buyer: 'e'.repeat(64), claim: 'f'.repeat(64), quote: await sale$.quoteHash(part) };
    const client = { rawRequest() {}, paymentIntents: { async create(params) {
      const pi = w.st.pay(params.amount, params.metadata);
      return { ...pi, amount: params.amount, currency: params.currency, livemode: true, status: 'succeeded' };
    } } };
    const call = async (credential) => {
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'purchase', arguments: args, ...(credential ? { _meta: { 'org.paymentauth/credential': credential } } : {}) } };
      const request = new Request('https://seller.example/api/purchases/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      request.headers.set('accept', 'application/json, text/event-stream');
      return (await purchaseMcp(request, w.env, new URL(request.url), w.cat)).json();
    };
    w.st.spts.set('spt_example', { max: 1000, currency: 'usd' });
    const unpaid = await call();
    assert.equal(unpaid.error.code, -32042);
    const challenge = unpaid.error.data.challenges[0];
    const paid = await call({ challenge, payload: { spt: 'spt_example' } });
    assert.ok(paid.result?._meta?.['org.paymentauth/receipt'], JSON.stringify(paid));
    assert.ok(JSON.parse(paid.result.content[0].text).proof);
  } finally { await w.close(); }
});

test('an unavailable paid file prevents both protocol and Checkout charges', async () => {
  const w = await world('missing-before-payment', { key: LIVE_KEY });
  try {
    await configureMachine(w, { manualRefunds: true, profile: 'profile_example' });
    const part = await (await w.fetcher('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const missing = part.files.find((file) => file.path === 'src/index.ts');
    w.objects.delete(sale$.objectKey(missing.sha256));
    const body = { kind: 'part', resource: part.id, version: part.version, buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part) };
    const request = new Request('https://seller.example/api/purchases/resource', { method: 'POST', body: JSON.stringify(body) });
    const reply = await machineResource(request, w.env, new URL(request.url), w.cat, { client: { paymentIntents: { create() { assert.fail('no charge before delivery readiness'); } } } });
    assert.equal(reply.status, 503);
    assert.equal(reply.headers.get('content-type'), 'application/problem+json');
    const quote = await w.add(); const intent = await w.add({ approve: quote.purchase.quote });
    const checkout = await w.fetcher(intent.purchase.checkout, { method: 'POST', headers: { origin: 'https://seller.example' } });
    assert.equal(checkout.status, 503); assert.equal(w.st.sessions.size, 0);
  } finally { await w.close(); }
});
