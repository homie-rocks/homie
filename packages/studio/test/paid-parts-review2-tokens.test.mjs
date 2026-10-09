import { test } from 'node:test'; import assert from 'node:assert/strict';
import { SignJWT, importJWK, decodeJwt, decodeProtectedHeader, generateKeyPair, calculateJwkThumbprint } from 'jose';
import { readFileSync, existsSync } from 'node:fs'; import { join } from 'node:path';
import { world, mainRecord, records, PP, purchaseLib, LIVE_KEY, TEST_KEY, newPart, readPart, writePart, partDir, sharePart, buildParts } from './paid-parts-review2-fixture.mjs';
const FILE = 'https://seller.example/parts/camera/0.1.0/src/index.ts';
const get = (w, url, token) => w.fetcher(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const bought = async (w, opts) => { const b = await w.buy(opts); await w.event('checkout.session.completed', b.session); const a = await w.add(opts); assert.equal(a.ok, true, a.why); return b; };
const signer = async (w) => { const jwk = JSON.parse(w.env.PURCHASE_SIGNING_KEYS)[0]; return importJWK(jwk, 'Ed25519'); };

test('T1 test-mode purchases: who can get the real files, and what happens to them after the shop goes live', async () => {
  const w = await world('t1'); try {
    const page = await (await get(w, 'https://seller.example/.well-known/homie-parts.json')).text();
    const b = await bought(w); const rec = mainRecord(w.buyer);
    const got = await get(w, FILE, rec.token);
    w.sql.prepare('DELETE FROM purchase_test_approvals WHERE order_id = ?').run(rec.order);
    assert.equal((await w.api('/api/purchases/grant', {}, rec.claim)).status, 403);
    assert.equal((await get(w, FILE, rec.token)).status, 403);
    await PP.authorizePurchaseTest(w.env, rec.order);
    w.env.STRIPE_KEY = LIVE_KEY; // seller finishes testing and connects live mode
    const g = await w.api('/api/purchases/grant', {}, rec.claim);
    const dl = g.data?.token ? (await get(w, FILE, g.data.token)).status : '-';
    console.log('T1 test-mode order: download', got.status, '| after shop is LIVE: grant', g.status, g.data?.ok, 'mode claim', g.data?.token ? decodeJwt(g.data.token).mode : '-', '| download with it', dl, '| order', JSON.stringify(w.order()).slice(0, 90));
    assert.equal((await get(w, FILE, rec.token)).status, 403);
    assert.notEqual(dl, 200, 'a Stripe test-card "purchase" keeps downloading the paid files from the live shop');
  } finally { await w.close(); }
});

test('K1 proof vs download token: type/audience confusion, expiry, clock skew', async (t) => {
  const w = await world('k1'); try {
    await bought(w); const rec = mainRecord(w.buyer); const out = {};
    const g = await w.api('/api/purchases/grant', { audience: 'https://hub.example' }, rec.claim);
    assert.deepEqual(Object.keys(decodeJwt(g.data.hubProof)).sort(), ['iss','aud','sub','jti','iat','kind','resource','version','mode'].sort());
    out.download = (await get(w, FILE, g.data.token)).status;
    out.proofAsDownload = (await get(w, FILE, g.data.proof)).status;
    out.hubProofAsDownload = (await get(w, FILE, g.data.hubProof)).status;
    out.tokenAtVerify = (await w.api('/api/purchases/verify', { proof: g.data.token, audience: 'https://hub.example' })).status;
    out.tokenAtVerifyAudHomieParts = (await w.api('/api/purchases/verify', { proof: g.data.token, audience: 'homie-purchases' })).status;
    out.evidenceProofAtVerify = (await w.api('/api/purchases/verify', { proof: g.data.proof, audience: 'https://hub.example' })).status;
    out.hubProofOtherHub = (await w.api('/api/purchases/verify', { proof: g.data.hubProof, audience: 'https://evil.example' })).status;
    const v = await w.api('/api/purchases/verify', { proof: g.data.hubProof, audience: 'https://hub.example' }); out.hubProofOk = `${v.status} ${JSON.stringify(v.data)}`;
    // a grant re-typed as proof with the real payload but no valid signature
    const [h, p, s] = g.data.token.split('.'); const fake = `${Buffer.from(JSON.stringify({ ...decodeProtectedHeader(g.data.token), typ: 'homie-purchase-proof+jwt' })).toString('base64url')}.${p}.${s}`;
    out.retypedHeader = (await w.api('/api/purchases/verify', { proof: fake, audience: 'homie-purchases' })).status;
    const claims = decodeJwt(g.data.token); out.lifetime = claims.exp - claims.iat; out.proofHasExp = 'exp' in decodeJwt(g.data.proof); out.proofClaims = Object.keys(decodeJwt(g.data.hubProof)).join(',');
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 299_000 }); out.at299s = (await get(w, FILE, g.data.token)).status;
    t.mock.timers.setTime(Date.now() + 2_000); out.at301s = (await get(w, FILE, g.data.token)).status;
    t.mock.timers.setTime(Date.now() - 400_000); out.clockBehind99s_tokenFromFuture = (await get(w, FILE, g.data.token)).status;
    console.log('K1', JSON.stringify(out, null, 1));
    assert.equal(out.proofAsDownload, 402); assert.equal(out.hubProofAsDownload, 402); assert.equal(out.tokenAtVerify, 401); assert.equal(out.at301s, 402); assert.equal(out.hubProofOtherHub, 401);
  } finally { await w.close(); }
});

test('K2 signed anonymous intent: forgery, tamper, expiry, cross-use, binding', async (t) => {
  const w = await world('k2'); try {
    const q = await w.add(); const i = await w.add({ approve: q.purchase.quote }); const url = new URL(i.purchase.checkout); const tok = url.searchParams.get('intent'); const out = {};
    const payload = decodeJwt(tok); out.claims = Object.keys(payload).join(','); out.header = JSON.stringify(decodeProtectedHeader(tok));
    const post = (u) => w.fetcher(u, { method: 'POST', headers: { origin: 'https://seller.example' } });
    const [h, p, s] = tok.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...payload, amount: 1 })).toString('base64url')}.${s}`;
    out.tamperedAmount = (await post(`${url.origin}${url.pathname}?intent=${tampered}`)).status;
    const other = await generateKeyPair('Ed25519'); out.foreignKey = (await post(`${url.origin}${url.pathname}?intent=${await new SignJWT(payload).setProtectedHeader({ alg: 'Ed25519', typ: 'homie-purchase-intent+jwt' }).sign(other.privateKey)}`)).status;
    out.otherOrderIdInPath = (await post(`${url.origin}/purchases/ord_${'A'.repeat(20)}?intent=${tok}`)).status;
    out.intentAsDownload = (await get(w, FILE, tok)).status;
    out.intentAtVerify = (await w.api('/api/purchases/verify', { proof: tok, audience: 'https://hub.example' })).status;
    out.noOrigin = (await w.fetcher(i.purchase.checkout, { method: 'POST' })).status; out.crossOrigin = (await w.fetcher(i.purchase.checkout, { method: 'POST', headers: { origin: 'https://evil.example' } })).status;
    out.rowsBeforeHumanPost = w.sql.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
    // someone else's buyer id with my claim: allowed? (they pay; the licence names the victim as licensee)
    const forged = await w.api('/api/purchases/intent', { kind: 'part', resource: 'camera', version: '0.1.0', buyer: payload.buyer, buyerName: '<b>Victim Studio</b>', claimHash: 'b'.repeat(64), quote: q.purchase.quote, quantity: 1 });
    out.intentForAnotherBuyerId = forged.status;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31 * 60_000 }); out.expired = (await post(i.purchase.checkout)).status; t.mock.timers.reset();
    out.firstPost = (await post(i.purchase.checkout)).status; out.replayPost = (await post(i.purchase.checkout)).status; out.sessions = w.st.sessions.size; out.rows = w.sql.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
    console.log('K2', JSON.stringify(out, null, 1));
    for (const k of ['tamperedAmount', 'foreignKey', 'expired']) assert.equal(out[k], 410, k); assert.equal(out.otherOrderIdInPath, 403); assert.equal(out.intentAsDownload, 402); assert.equal(out.sessions, 1); assert.equal(out.rows, 1);
  } finally { await w.close(); }
});

test('K3 recovery and reissue: what the service checks, old credentials, proofs, enumeration', async () => {
  const w = await world('k3', { saleOpts: { transferable: true } }); try {
    await bought(w); const rec = mainRecord(w.buyer); const order = rec.order; const out = {};
    const oldGrant = await w.api('/api/purchases/grant', { audience: 'https://hub.example' }, rec.claim);
    // An outsider who learned the order id (it is in the success URL, in every proof and hub rating row) asks for a reissue.
    out.noReceiptFlag = JSON.stringify(await PP.reissuePurchaseClaim(w.env, { order, claimHash: 'c'.repeat(64) }));
    const r = await PP.reissuePurchaseClaim(w.env, { order, claimHash: 'c'.repeat(64), receiptVerified: true }); out.reissueWithFlagOnly = JSON.stringify(r);
    out.oldClaimGrant = (await w.api('/api/purchases/grant', {}, rec.claim)).status;
    out.oldTokenDownload = (await get(w, FILE, oldGrant.data.token)).status;
    out.oldHubProofStillCurrent = JSON.stringify((await w.api('/api/purchases/verify', { proof: oldGrant.data.hubProof, audience: 'https://hub.example' })).data);
    out.unknownClaim = (await w.api('/api/purchases/recover', {}, 'd'.repeat(64))).status; out.noClaim = (await w.api('/api/purchases/recover', {})).status;
    out.verifyNoProof = JSON.stringify(await w.api('/api/purchases/verify', { proof: 'x', audience: 'https://hub.example' }));
    out.portalLoginUnset = JSON.stringify((await (await w.fetcher('https://seller.example/api/purchases/portal-login')).json()));
    console.log('K3', JSON.stringify(out, null, 1));
    // buyer side: running `parts recover` while the purchase record is healthy
    const w2 = await world('k3b'); await bought(w2); const before = mainRecord(w2.buyer);
    assert.equal((await purchaseLib.prepareRecovery(w2.buyer, 'seller.example/camera', before.order, 'cave')).ok, false); assert.equal(mainRecord(w2.buyer).claim, before.claim); const after = Object.values(records(w2.buyer)).find((x) => x?.recovery);
    console.log('K3b parts recover on a healthy record: claim kept?', after?.claim === before.claim, '| record now', JSON.stringify(Object.keys(after ?? {})), '| add:', (await w2.add()).why); await w2.close();
  } finally { await w.close(); }
});

test('R1 bindings absent in a seller studio; free parts and R2 reads; no-shop studio', async () => {
  const w = await world('r1'); try {
    const b = await bought(w); const rec = mainRecord(w.buyer); const out = {};
    delete w.env.PURCHASE_RATE_LIMITER;
    out.grantNoLimiter = (await w.api('/api/purchases/grant', {}, rec.claim)).status; out.fileNoLimiter_tokenStillWorks = (await get(w, FILE, rec.token)).status; out.jwksNoLimiter = (await get(w, 'https://seller.example/.well-known/homie-parts-jwks.json')).status;
    w.env.PURCHASE_RATE_LIMITER = { limit: async ({ key }) => { out.limiterKey = key; return { success: false }; } };
    out.limited = (await w.api('/api/purchases/grant', {}, rec.claim)).status; out.fileWhenLimited = (await get(w, FILE, rec.token)).status;
    w.env.PURCHASE_RATE_LIMITER = { limit: async () => ({ success: true }) };
    delete w.env.TURNSTILE_SECRET; const q2 = await world('r1b');
    console.log('R1', JSON.stringify(out)); await q2.close();
  } finally { await w.close(); }
});

test('R2 a studio that sells nothing: R2 reads per free part file; Stripe calls on foreign events; office', async () => {
  const w = await world('r2'); try {
    newPart(w.root, 'freebie'); const d = partDir(w.root, 'freebie'); const p = readPart(d); Object.assign(p, { license: 'MIT', attribution: 'x', summary: 'free' }); writePart(d, p);
    console.log('share free', JSON.stringify(sharePart(w.root, 'freebie')).slice(0, 120)); buildParts(w.root, w.dist);
    const idx = JSON.parse(readFileSync(join(w.dist, 'parts/index.json'), 'utf8')).parts.find((x) => x.id === 'freebie'); const f = JSON.parse(readFileSync(join(w.dist, 'parts/freebie', idx.versions.at(-1), 'part.json'), 'utf8')).files[0].path;
    w.r2.gets = 0; let ok = 0; for (let i = 0; i < 10; i++) ok += (await get(w, `https://seller.example/parts/freebie/${idx.versions.at(-1)}/${f}`)).status === 200 ? 1 : 0;
    console.log('R2 10 requests for a FREE part file:', ok, 'served; R2 GETs issued =', w.r2.gets);
    assert.equal(w.r2.gets, 0, 'every free part file request now costs an R2 read');
  } finally { await w.close(); }
});
