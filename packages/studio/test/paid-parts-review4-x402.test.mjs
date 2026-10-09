/** Review 4: x402 v2 with the unmodified @x402 client stack against the Worker's real route; facilitator doubled at the network edge. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { seller, LIVE_KEY, TEST_KEY } from './paid-parts-review4-seller.mjs';
import { generateKeyPairSync } from 'node:crypto';
const cdpSecret = () => { const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32); const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32); return Buffer.concat([seed, pub]).toString('base64'); };
import { sale$ } from './paid-parts-review4-harness.mjs';
const say = (...a) => console.log('#', ...a);
const URL_ = 'https://seller.example/api/purchases/resource';

function facilitator(w, host, { network }) {
  const F = { calls: [], settled: 0, auth: [] };
  for (const host of ['mainnet.base.org', 'sepolia.base.org']) w.handle(host, async () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' }));
  w.handle(host, async (request) => {
    const u = new URL(request.url); F.calls.push(`${request.method} ${u.pathname}`); F.auth.push(request.headers.get('authorization') ? 'auth' : 'none');
    if (u.pathname.endsWith('/supported')) return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} });
    const body = await request.json();
    if (u.pathname.endsWith('/verify')) return Response.json({ isValid: true, payer: body.paymentPayload?.payload?.authorization?.from });
    if (u.pathname.endsWith('/settle')) { F.settled++; F.last = body; return Response.json({ success: true, transaction: `0x${String(F.settled).padStart(64, 'c')}`, network, payer: body.paymentPayload?.payload?.authorization?.from }); }
    return new Response('nope', { status: 404 });
  });
  return F;
}

for (const mode of ['test', 'live']) test(`X1 ${mode}: unmodified x402 v2 client pays exact on Base to the configured deposit address and receives files`, async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller(`x1${mode}`, { key: mode === 'live' ? LIVE_KEY : TEST_KEY, machine: { profile: 'profile_x', base: recipient } });
  try {
    if (mode === 'live') { w.env.CDP_API_KEY_ID = 'cdp-key-id-example'; w.env.CDP_API_KEY_SECRET = cdpSecret(); }
    const network = mode === 'live' ? 'eip155:8453' : 'eip155:84532';
    const F = facilitator(w, mode === 'live' ? 'api.cdp.coinbase.com' : 'x402.org', { network });
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim: 'd'.repeat(64), quote: await sale$.quoteHash(part) });
    const post = (headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    const core = x402Client.fromConfig({ schemes: [{ network, client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } }); const http = new x402HTTPClient(core);
    if (mode === 'test') { const refused = await post(); assert.equal(refused.status, 403); await (await import('./paid-parts-review4-harness.mjs')).PP.authorizePurchaseTest(w.env, w.order().id); }
    const r1 = await post(); assert.equal(r1.status, 402);
    const required = http.getPaymentRequiredResponse((name) => r1.headers.get(name), await r1.clone().json().catch(() => undefined));
    say(`X1 ${mode} PaymentRequired: x402Version ${required.x402Version}; accepts`, JSON.stringify(required.accepts.map((a) => ({ scheme: a.scheme, network: a.network, amount: a.amount, payTo: a.payTo === recipient ? 'configured-address' : a.payTo, asset: a.asset, maxTimeoutSeconds: a.maxTimeoutSeconds }))), '| resource', JSON.stringify(required.resource));
    assert.equal(required.accepts[0].network,network);
    assert.equal(required.accepts[0].asset.toLowerCase(),mode === 'live' ? '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' : '0x036cbd53842c5426634e7929541ec2318f3dcf7e');
    const payload = await http.createPaymentPayload(required);
    const headers = http.encodePaymentSignatureHeader(payload);
    say(`X1 ${mode} client sends header(s):`, Object.keys(headers).join(','));
    const paid = await post(headers);
    const txt = await paid.clone().text();
    say(`X1 ${mode} paid:`, paid.status, txt.slice(0, 140), '| PAYMENT-RESPONSE', paid.headers.get('payment-response') ? JSON.stringify(http.getPaymentSettleResponse((n) => paid.headers.get(n))) : 'absent', '| facilitator', JSON.stringify(F.calls), F.auth.join(','), '| Stripe recording', JSON.stringify(w.st.reqs.filter((r) => r.path === '/v1/payment_intents').map((r) => ({ amount: r.form.amount, net: r.form['payment_method_options[crypto][transaction_verification_options][network]'], mode: r.form['payment_method_options[crypto][mode]'], tx: r.form['payment_method_options[crypto][transaction_verification_options][transaction_hash]']?.slice(0, 10), idem: r.idem?.slice(0, 12), order: r.form['metadata[order]'] }))));
    say(`X1 ${mode} hosts`, JSON.stringify([...w.hosts]), 'blocked', JSON.stringify(w.blocked));
    assert.equal(paid.status, 200, txt);
    assert.ok((await paid.json()).files.length);
    assert.ok(paid.headers.get('payment-response'));
    assert.ok(paid.headers.get('payment-receipt'));
    const again = await post(headers);
    say(`X1 ${mode} replay of the same signature:`, again.status, '| settlements', F.settled);
    assert.equal(F.settled, 1);
  } finally { await w.close(); }
});

test('X2 live Base rail configured but no CDP credentials: does the card rail still work?', async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const w = await seller('x2', { machine: { profile: 'profile_x', base: recipient } });
  try {
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim: 'e'.repeat(64), quote: await sale$.quoteHash(part) });
    const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    say('X2 unpaid POST:', r.status, (await r.clone().text()).slice(0, 200), '| www-authenticate methods', [...(r.headers.get('www-authenticate') ?? '').matchAll(/method="([^"]+)"/g)].map((m) => m[1]).join(','), '| payment-required', Boolean(r.headers.get('payment-required')));
  } finally { await w.close(); }
});

test('X3 settlement succeeded on chain but Stripe refuses to record it: what the buyer has', async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller('x3', { machine: { profile: 'profile_x', base: recipient } });
  try {
    w.env.CDP_API_KEY_ID = 'cdp-key-id-example'; w.env.CDP_API_KEY_SECRET = cdpSecret();
    const F = facilitator(w, 'api.cdp.coinbase.com', { network: 'eip155:8453' });
    w.st.cryptoReject = 'Crypto payments are not enabled on this account.';
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim: 'f'.repeat(64), quote: await sale$.quoteHash(part) });
    const post = (headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    const core = x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } }); const http = new x402HTTPClient(core);
    const r1 = await post(); const required = http.getPaymentRequiredResponse((n) => r1.headers.get(n), undefined);
    const headers = http.encodePaymentSignatureHeader(await http.createPaymentPayload(required));
    const a = await post(headers); const b = await post(headers); const c = await post();
    say('X3 USDC settled', F.settled, '| first:', a.status, (await a.text()).slice(0, 120), '| retry:', b.status, '| without credential:', c.status, '| order', JSON.stringify(w.order()), '| refund route:', JSON.stringify((await w.api('/api/purchases/refund', {}, 'f'.repeat(64)))).slice(0, 200));
  } finally { await w.close(); }
});

test('X4 x402 payload for one order sent on another; lowered amount; other recipient (facilitator double approves everything)', async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller('x4', { machine: { profile: 'profile_x', base: recipient } });
  try {
    w.env.CDP_API_KEY_ID = 'id'; w.env.CDP_API_KEY_SECRET = cdpSecret();
    const F = facilitator(w, 'api.cdp.coinbase.com', { network: 'eip155:8453' });
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json(); const quote = await sale$.quoteHash(part);
    const post = (claim, headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim, quote }) });
    const http = new x402HTTPClient(x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } }));
    const req = async (claim) => { const r = await post(claim); return http.getPaymentRequiredResponse((n) => r.headers.get(n), undefined); };
    const A = '1'.repeat(64), B = '2'.repeat(64), C = '3'.repeat(64), D = '4'.repeat(64);
    const payA = await http.createPaymentPayload(await req(A)); await req(B);
    const cross = await post(B, http.encodePaymentSignatureHeader(payA));
    say('X4 payload of order A on order B:', cross.status, (await cross.text()).slice(0, 110), '| settled', F.settled);
    const reqC = await req(C); const low = structuredClone(reqC); low.accepts[0].amount = '10000';
    const payLow = await http.createPaymentPayload(low); const lowR = await post(C, http.encodePaymentSignatureHeader(payLow));
    say('X4 one cent instead of ten dollars:', lowR.status, (await lowR.text()).slice(0, 110), '| settled', F.settled);
    const reqD = await req(D); const other = structuredClone(reqD); other.accepts[0].payTo = account.address;
    const payOther = await http.createPaymentPayload(other); const otherR = await post(D, http.encodePaymentSignatureHeader(payOther));
    say('X4 paying oneself:', otherR.status, (await otherR.text()).slice(0, 110), '| settled', F.settled, '| orders', JSON.stringify(w.sql.prepare('SELECT status, COUNT(*) n FROM purchase_orders GROUP BY status').all()));
    assert.equal(F.settled, 0);
  } finally { await w.close(); }
});
