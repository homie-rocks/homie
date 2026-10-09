import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const { seller, instrument, chain, say, LIVE_KEY, TEST_KEY, URL_, PP, orders } = await import(`${ROOT}/packages/studio/test/paid-parts-review5-kit.mjs`);
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
for (const mode of ['live', 'test']) test(`B ${mode}: Base identifiers in the challenge, and a payment by the official x402 client through the route`, async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller(`bm${mode}`, { key: mode === 'live' ? LIVE_KEY : TEST_KEY, machine: { profile: 'profile_x', base: recipient } });
  w.env.CDP_API_KEY_ID = 'id'; const { privateKey, publicKey } = generateKeyPairSync('ed25519'); w.env.CDP_API_KEY_SECRET = Buffer.concat([privateKey.export({format:'der',type:'pkcs8'}).subarray(-32), publicKey.export({format:'der',type:'spki'}).subarray(-32)]).toString('base64');
  const net = mode === 'live' ? 'eip155:8453' : 'eip155:84532';
  const C = chain(w, { network: net, live: mode === 'live' }); const K = instrument(w);
  try {
    const listing = await fetch('https://seller.example/parts/catalog.json').then((r) => r.json()).then((c) => c.parts[0].releases[0]);
    const body = { kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim: 'd'.repeat(64), offerVersion: listing.offerVersion };
    const post = (h = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    let r = await post();
    if (r.status === 403 && mode === 'test') { await PP.authorizePurchaseTest(w.env, orders(w)[0].id); r = await post(); }
    const http = new x402HTTPClient(x402Client.fromConfig({ schemes: [{ network: net, client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '100' } }));
    const required = r.headers.get('payment-required') ? http.getPaymentRequiredResponse((n) => r.headers.get(n), undefined) : null;
    say(`B ${mode}: status ${r.status} accepts`, required?.accepts?.map((a) => ({ network: a.network, asset: a.asset, amount: a.amount, payTo: a.payTo === recipient ? 'deposit address' : a.payTo })));
    assert.ok(required, 'no x402 challenge');
    const want = mode === 'live' ? ['eip155:8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'] : ['eip155:84532', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'];
    assert.deepEqual([required.accepts[0].network, required.accepts[0].asset], want);
    const paid = await post(http.encodePaymentSignatureHeader(await http.createPaymentPayload(required)));
    say(`B ${mode}: paid ${paid.status} | hosts`, [...w.hosts.keys()].filter((h) => h !== 'seller.example' && !h.startsWith('127.')), '| Stripe recording network', w.st.reqs.filter((q) => q.path === '/v1/payment_intents' && q.form['payment_method_options[crypto][mode]']).map((q) => q.form['payment_method_options[crypto][transaction_verification_options][network]']), '| blocked', w.blocked);
    assert.equal(paid.status, 200);
  } finally { K.restore(); await w.close(); }
});
