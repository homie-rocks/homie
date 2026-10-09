/** Review 4: what a studio has after following the toolkit's own setup, and an older studio's key. */
import { refreshMachineCapabilities } from '../worker/payment-capabilities.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenge, Credential } from 'mppx';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateKeyPairSync } from 'node:crypto';
import { seller } from './paid-parts-review4-seller.mjs';
import { sale$, PP, shopMod } from './paid-parts-review4-harness.mjs';
const say = (...a) => console.log('#', ...a);
const URL_ = 'https://seller.example/api/purchases/resource';
const cdpSecret = () => { const { privateKey, publicKey } = generateKeyPairSync('ed25519'); return Buffer.concat([privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64'); };

test('U1 the key the connect page asks for (PaymentIntents: Read) with the card rail', async () => {
  const w = await seller('u1'); try {
    w.st.denyWrite = ['/v1/payment_intents']; await refreshMachineCapabilities(w.env);
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part) });
    const post = (h = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    const office = { purchases: await PP.purchaseReadiness(w.env, 'https://seller.example') };
    say('U1 office says parts:', JSON.stringify(office.purchases));
    const r1 = await post();
    assert.equal(office.purchases.ready, true, 'read-only configuration cannot prove a write permission');
    assert.equal(r1.status, 402);
    assert.equal(w.st.reqs.filter((r) => r.method === 'POST' && r.path === '/v1/payment_intents').length, 0);
    const challenge = Challenge.fromResponseList(r1).find((c) => c.method === 'stripe');
    await post({ authorization: Credential.serialize({ challenge, payload: { spt: 'spt_denied' } }) });
    assert.equal((await PP.purchaseReadiness(w.env, 'https://seller.example')).ready, false, 'a real account refusal invalidates readiness');
    assert.equal(w.st.pis.size, 0);
  } finally { await w.close(); }
});

test('U2 the same key with a stablecoin rail: the buyer pays on chain first', async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller('u2', { machine: { profile: 'profile_x', base: recipient }, saleOpts: { refundWindowDays: 30 } }); try {
    w.env.CDP_API_KEY_ID = 'id'; w.env.CDP_API_KEY_SECRET = cdpSecret(); w.st.denyWrite = ['/v1/payment_intents']; await refreshMachineCapabilities(w.env);
    let settled = 0;
    w.handle('api.cdp.coinbase.com', async (request) => { const u = new URL(request.url); const b = await request.json().catch(() => ({})); if (u.pathname.endsWith('/verify')) return Response.json({ isValid: true, payer: account.address }); if (u.pathname.endsWith('/settle')) { settled++; return Response.json({ success: true, transaction: `0x${'d'.repeat(64)}`, network: 'eip155:8453', payer: account.address }); } return Response.json({ kinds: [] }); });
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'c'.repeat(64), quote: await sale$.quoteHash(part) });
    const post = (h = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    const http = new x402HTTPClient(x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } }));
    const r1 = await post();
    assert.equal(r1.status, 402);
    assert.equal(r1.headers.has('payment-required'), true);
    assert.equal(w.st.reqs.filter((r) => r.method === 'POST' && r.path === '/v1/payment_intents').length, 0);
    assert.equal(settled, 0);
    assert.equal((await PP.purchaseReadiness(w.env, 'https://seller.example')).ready, true, 'configuration readiness is not proof of write permission');
  } finally { await w.close(); }
});
