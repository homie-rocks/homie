/** Review 4: the owner's requirement end to end. G1 is an agent that knows only the published standards
 *  (RFC 9727, schema.org JSON-LD, MPP via the upstream mppx client, JOSE via jose); G2+ use the toolkit's own buyer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, decodeProtectedHeader, calculateJwkThumbprint } from 'jose';
import { Mppx, stripe } from 'mppx/client';
import { Receipt } from 'mppx';
import { seller, LIVE_KEY } from './paid-parts-review4-seller.mjs';
import { sale$, PP, mainRecord, addPart } from './paid-parts-review4-harness.mjs';
const say = (...a) => console.log('#', ...a);
const O = 'https://seller.example';

test('G1 standards-only agent: discover, price, pay, files + proof in one exchange, verify, update, refund; hosts counted', async () => {
  const w = await seller('g1', { saleOpts: { refundWindowDays: 14 } }); try {
    // 1. Discovery from the well-known catalogue.
    const linkset = await (await fetch(`${O}/.well-known/api-catalog`)).json();
    const items = linkset.linkset[0].item; const rels = Object.keys(linkset.linkset[0]).filter((k) => k !== 'anchor');
    say('G1 api-catalog relations:', rels.join(','), '| items:', items.map((i) => `${new URL(i.href).pathname}${i.type ? ' (' + i.type + ')' : ''}`).join('; '), '| service-desc/OpenAPI:', rels.includes('service-desc'));
    for (const path of ['/openapi.json', '/api/openapi.json', '/.well-known/x402', '/llms.txt']) say('G1 probe', path, (await fetch(`${O}${path}`)).status);
    const catalogue = await (await fetch(items.find((i) => i.type === 'application/json').href)).json();
    const entry = catalogue.parts.find((p) => p.product?.offers);
    // 2. Price and terms from schema.org.
    const page = await (await fetch(entry.product.url)).text();
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page)[1]);
    say('G1 JSON-LD:', JSON.stringify(ld));
    say('G1 licence text reachable before paying:', (await fetch(`${O}/parts/${entry.id}/${entry.version}/${entry.licenseTerms}`)).status, '| LICENSES/ REUSE file:', (await fetch(`${O}/parts/${entry.id}/${entry.version}/LICENSES/${entry.license}.txt`)).status);
    // 3. What must be POSTed? Nothing published says. Try what the standards expose.
    const endpoint = entry.purchase.http; const buyer = 'a'.repeat(64); const claim = createHash('sha256').update('agent-secret').digest('hex');
    const attempt = async (label, body) => { const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); say(`G1 unpaid POST ${label}:`, r.status, (await r.clone().json()).detail); return r; };
    await attempt('{part, version}', { kind: 'part', resource: entry.id, version: entry.version });
    await attempt('+ buyer, claim', { kind: 'part', resource: entry.id, version: entry.version, buyer, claim });
    await attempt('+ quote = published offerVersion', { kind: 'part', resource: entry.id, version: entry.version, buyer, claim, quote: entry.releases[0].offerVersion });
    // 4. Only the toolkit's private recipe produces the quote.
    const part = await (await fetch(`${O}/parts/${entry.id}/${entry.version}/part.json`)).json();
    const description = await (await fetch(linkset.linkset[0]['service-desc'][0].href)).json();
    const operation = Object.values(description.paths)[0].post;
    const properties = operation.requestBody.content['application/json'].schema.properties;
    const body = { ...Object.fromEntries(Object.entries(properties).filter(([, value]) => value.const !== undefined).map(([key, value]) => [key, value.const])), buyer, claim };
    // 5. Pay with the upstream MPP client; the wallet double stands where Link issues a shared payment token.
    let asked = null; w.st.spts.set('spt_agent_1', { max: 1000, currency: 'usd' });
    const wallet = Mppx.create({ polyfill: false, fetch: globalThis.fetch, methods: [stripe.charge({ paymentMethod: 'pm_card_person', createToken: async (p) => { asked = p; return 'spt_agent_1'; } })] });
    const paid = await wallet.fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(paid.status, 200, await paid.clone().text());
    say('G1 wallet was asked for:', JSON.stringify({ amount: String(asked.amount), currency: asked.currency, networkId: asked.networkId, expiresAt: asked.expiresAt }), '| response headers:', JSON.stringify(Object.fromEntries([...paid.headers].map(([k, v]) => [k, v.length > 50 ? v.slice(0, 50) + '…' : v]))));
    const receipt = Receipt.fromResponse(paid); const got = await paid.json();
    // 6. Verify with plain JOSE.
    const jwks = await (await fetch(entry.purchase.keys)).json();
    const header = decodeProtectedHeader(got.proof);
    const { payload } = await jwtVerify(got.proof, createLocalJWKSet(jwks), { issuer: O, algorithms: ['Ed25519'], typ: header.typ });
    say('G1 receipt', JSON.stringify(receipt), '| proof header', JSON.stringify(header), '| kid is RFC 7638 thumbprint', header.kid === await calculateJwkThumbprint(jwks.keys[0]), '| claims', Object.keys(payload).join(','), '| exp', payload.exp ?? 'none');
    const okFiles = got.files.every((f) => createHash('sha256').update(Buffer.from(f.data, 'base64')).digest('hex') === got.manifest.files.find((m) => m.path === f.path).sha256);
    say('G1 files in the same exchange:', got.files.length, 'all hashes match manifest:', okFiles, '| entitlement', JSON.stringify(got.entitlement).slice(0, 220));
    assert.ok(okFiles);
    // 7. Update.
    await w.release('0.2.0');
    const viaResource = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, version: '0.2.0' }) });
    const grant = await w.api('/api/purchases/grant', { version: '0.2.0' }, claim);
    const file = await fetch(`${O}/parts/camera/0.2.0/src/index.ts`, { headers: { authorization: `Bearer ${grant.data.token}` } });
    say('G1 update 0.2.0 by re-POSTing the paid resource:', viaResource.status, (await viaResource.json()).detail, '| by the grant route + bearer download:', grant.status, file.status, '| charges so far', [...w.st.pis.values()].length);
    // 8. Proof is not a download credential and the reverse.
    const withProof = await fetch(`${O}/parts/camera/0.2.0/src/index.ts`, { headers: { authorization: `Bearer ${grant.data.proof}` } });
    const verifyWithToken = await w.api('/api/purchases/verify', { proof: grant.data.token, audience: 'https://hub.example' });
    const hub = await w.api('/api/purchases/grant', { audience: 'https://hub.example' }, claim);
    const hubAsDownload = await fetch(`${O}/parts/camera/0.1.0/src/index.ts`, { headers: { authorization: `Bearer ${hub.data.hubProof}` } });
    const hubOther = await w.api('/api/purchases/verify', { proof: hub.data.hubProof, audience: 'https://other.example' });
    say('G1 proof as download credential:', withProof.status, '| download token as proof:', verifyWithToken.status, '| hub proof as download:', hubAsDownload.status, '| hub proof for another audience:', hubOther.status);
    assert.notEqual(withProof.status, 200); assert.notEqual(verifyWithToken.status, 200); assert.notEqual(hubAsDownload.status, 200); assert.notEqual(hubOther.status, 200);
    // 9. Refund.
    const refund = await w.api('/api/purchases/refund', {}, claim);
    const after = await w.api('/api/purchases/grant', {}, claim);
    const afterResource = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const oldToken = await fetch(`${O}/parts/camera/0.2.0/src/index.ts`, { headers: { authorization: `Bearer ${grant.data.token}` } });
    say('G1 refund:', JSON.stringify(refund.data).slice(0, 120), '| Stripe refunds', w.st.refunds.length, '| grant after:', after.status, after.data.status, '| resource after:', afterResource.status, (await afterResource.json()).detail, '| unexpired download token after refund:', oldToken.status);
    say('G1 hosts contacted:', JSON.stringify([...w.hosts]), '| blocked:', JSON.stringify(w.blocked));
    assert.deepEqual(w.blocked, []); assert.equal(w.hosts.size, 2);
  } finally { await w.close(); }
});

const walletVia = (w, tokens) => { let n = 0; const calls = [];
  const client = Mppx.create({ polyfill: false, fetch: globalThis.fetch, methods: [stripe.charge({ paymentMethod: 'pm_card_person', createToken: async () => tokens[n++] })] });
  const walletPay = async (url, body) => { calls.push(body); const r = await client.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await r.json(); return { data }; };
  return { walletPay, calls }; };

test('G2 toolkit buyer: nothing is spent without the exact quote; the default with no wallet named; a seller that never set the machine secret', async () => {
  const w = await seller('g2', { machine: null }); try {
    const { walletPay, calls } = walletVia(w, ['spt_g2_1']); w.st.spts.set('spt_g2_1', { max: 1000, currency: 'usd' });
    const add = (o = {}) => addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), ...o });
    const quote = await add({ wallet: 'link-cli', walletPay });
    say('G2 first call:', quote.why?.slice(0, 200), '| wallet calls', calls.length);
    const wrong = await add({ wallet: 'link-cli', walletPay, approve: 'f'.repeat(64) });
    say('G2 wrong approval hash -> wallet calls', calls.length, '|', wrong.why?.slice(0, 80));
    assert.equal(calls.length, 0);
    const paid = await add({ wallet: 'link-cli', walletPay, approve: quote.purchase.quote });
    say('G2 seller followed the documented connect flow (no PURCHASE_MACHINE_PAYMENTS); buyer has a wallet:', paid.ok, '|', paid.why?.slice(0, 200));
    const again = await add({ wallet: 'link-cli', walletPay, approve: quote.purchase.quote });
    say('G2 retry:', again.ok, '|', again.why?.slice(0, 160), '| purchase.checkout offered:', Boolean(again.purchase?.checkout));
    const noWallet = await addPart(`${w.buyer}`, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), approve: quote.purchase.quote });
    say('G2 same buyer, no wallet named:', noWallet.why?.slice(0, 200));
  } finally { await w.close(); }
});

test('G3 toolkit buyer: a declined card, then the person approves a new spend', async () => {
  const w = await seller('g3'); try {
    w.st.spts.set('spt_low', { max: 100, currency: 'usd' }); w.st.spts.set('spt_good', { max: 1000, currency: 'usd' }); w.st.spts.set('spt_good2', { max: 1000, currency: 'usd' });
    const { walletPay } = walletVia(w, ['spt_low', 'spt_good', 'spt_good2']);
    const add = (o = {}) => addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), wallet: 'link-cli', walletPay, ...o });
    const quote = await add(); const a = await add({ approve: quote.purchase.quote }); const b = await add({ approve: quote.purchase.quote }); const c = await add({ approve: quote.purchase.quote });
    say('G3 declined:', a.ok, a.why?.slice(0, 90), '| new token:', b.ok, b.why?.slice(0, 90), '| again:', c.ok, c.why?.slice(0, 90), '| money moved', [...w.st.pis.values()].length);
    assert.equal(b.ok || c.ok, true, 'the buyer can never complete this purchase');
  } finally { await w.close(); }
});
