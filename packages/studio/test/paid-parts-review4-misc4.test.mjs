/** Review 4: storage addresses, abuse controls, key rotation, studios that do not sell. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, decodeProtectedHeader, calculateJwkThumbprint } from 'jose';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { seller, TEST_KEY } from './paid-parts-review4-seller.mjs';
import { sale$, PP, mainRecord, addPart, worker, db } from './paid-parts-review4-harness.mjs';
import { bought } from './paid-parts-review4-common.mjs';
const say = (...a) => console.log('#', ...a.map((x) => String(x).replace(/\n/g, ' ')));
const O = 'https://seller.example';

test('K1 guessing content addresses and walking paths', async () => {
  const w = await seller('k1'); try {
    const part = await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json(); const secret = part.files.find((f) => f.path === 'src/index.ts');
    const tries = [`/media/paid-parts/files/${secret.sha256}`, `/media/paid-parts%2Ffiles%2F${secret.sha256}`, `/media/%70aid-parts/files/${secret.sha256}`, `/media//paid-parts/files/${secret.sha256}`, `/media/x/../paid-parts/files/${secret.sha256}`, `/media/x/%2e%2e/paid-parts/files/${secret.sha256}`, `/media/PAID-PARTS/files/${secret.sha256}`, `/media/paid-parts/releases/camera/0.1.0.json`,
      '/parts/camera/0.1.0/src/index.ts', '/parts/camera/0.1.0/src%2Findex.ts', '/parts/camera/0.1.0/preview/..%2Fsrc/index.ts', '/parts/camera/0.1.0/preview/%2e%2e/src/index.ts', '/parts/camera/0.1.0/./src/index.ts', '/parts/camera/0.1.0//src/index.ts', '/parts/camera/0.1.0/SRC/index.ts', '/parts/camera/0.1.0/src/index.ts%00.html', '/parts/camera/0.1.0-x/src/index.ts', '/parts/camera/latest/src/index.ts', '/parts/camera/0.1.0/src/index.ts?token=x'];
    const out = []; for (const t of tries) { const r = await fetch(`${O}${t}`); const body = await r.text(); out.push(`${t.replace(secret.sha256, '<sha>')} ${r.status}${body.includes('export') ? ' LEAK' : ''}`); }
    say('K1', out.join(' | '));
    assert.ok(!out.some((x) => x.includes('LEAK') || / 200$/.test(x) && !x.includes('releases')));
    const head = await fetch(`${O}/parts/camera/0.1.0/src/index.ts`, { method: 'HEAD' }); const range = await fetch(`${O}/parts/camera/0.1.0/src/index.ts`, { headers: { range: 'bytes=0-10' } });
    say('K1 HEAD', head.status, 'Range', range.status, '| public preview', (await fetch(`${O}/parts/camera/0.1.0/preview/index.html`)).status, '| release record via media', (await fetch(`${O}/media/paid-parts/releases/camera/0.1.0.json`)).status);
  } finally { await w.close(); }
});

test('K2 rate limiter and Turnstile on each unauthenticated route', async () => {
  const w = await seller('k2'); try {
    const part = await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json(); const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part) });
    const keys = []; w.env.PURCHASE_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
    const routes = [['POST', '/api/purchases/resource'], ['POST', '/api/purchases/mcp'], ['POST', '/api/purchases/intent'], ['POST', '/api/purchases/grant'], ['POST', '/api/purchases/verify'], ['POST', '/api/purchases/refund'], ['POST', '/api/purchases/recover'], ['GET', '/api/purchases/portal-login'], ['GET', '/purchases/ord_AAAAAAAAAAAAAAAAAAAA'], ['GET', '/purchases/keys.json'], ['GET', '/parts/camera/0.1.0/src/index.ts'], ['POST', '/api/shop/hook']];
    const out = []; for (const [m, p] of routes) { const r = await fetch(`${O}${p}`, { method: m, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, ...(m === 'POST' ? { body } : {}) }); out.push(`${m} ${p} ${r.status}`); }
    say('K2 limiter refusing:', out.join(' | ')); say('K2 limiter keys:', [...new Set(keys)].join(' '));
    delete w.env.PURCHASE_RATE_LIMITER; say('K2 no limiter binding:', (await fetch(`${O}/api/purchases/resource`, { method: 'POST', body })).status, '| protected file route with no binding:', (await fetch(`${O}/parts/camera/0.1.0/src/index.ts`)).status);
    w.env.PURCHASE_RATE_LIMITER = { limit: async () => ({ success: true }) };
    // Turnstile on the human fallback through the real route (no test hook): the Worker must call Cloudflare.
    const q = await addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }) }); const intent = await addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), approve: q.purchase.quote });
    let siteverify = 0; w.handle('challenges.cloudflare.com', async (r) => { siteverify++; const f = new URLSearchParams(await r.text()); return Response.json({ success: f.get('response') === 'good', hostname: 'seller.example', action: f.get('response') === 'good' ? 'purchase-checkout' : 'other' }); });
    const post = (token, origin = O) => fetch(intent.purchase.checkout, { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'cf-turnstile-response': token }) });
    const none = await post(''); const cross = await post('good', 'https://evil.example'); const good = await post('good');
    say('K2 review POST without token:', none.status, '| cross-origin:', cross.status, '| with token:', good.status, good.headers.get('location')?.slice(0, 32), '| siteverify calls', siteverify, '| rows before a human passed:', 'n/a');
    assert.equal(none.status, 403); assert.equal(cross.status, 403); assert.equal(good.status, 303);
  } finally { await w.close(); }
});

test('K3 signing key rotation: old proofs, old download tokens, the buyer pin, a removed key', async () => {
  const w = await seller('k3'); try {
    const b = await bought(w); const rec = mainRecord(w.buyer); const g1 = await w.api('/api/purchases/grant', {}, rec.claim);
    const old = JSON.parse(w.env.PURCHASE_SIGNING_KEYS); const pair = await generateKeyPair('Ed25519', { extractable: true });
    w.env.PURCHASE_SIGNING_KEYS = JSON.stringify([await exportJWK(pair.privateKey), ...old]);
    const jwks = await (await fetch(`${O}/purchases/keys.json`)).json();
    const dl = (t) => fetch(`${O}/parts/camera/0.1.0/src/index.ts`, { headers: { authorization: `Bearer ${t}` } }).then((r) => r.status);
    const g2 = await w.api('/api/purchases/grant', {}, rec.claim);
    say('K3 key set after rotation:', jwks.keys.length, 'keys; private members published:', jwks.keys.some((k) => k.d), '| kids are thumbprints:', (await Promise.all(jwks.keys.map(async (k) => k.kid === await calculateJwkThumbprint(k)))).join(','), '| old token still downloads:', await dl(g1.data.token), '| new grant signed by new key:', decodeProtectedHeader(g2.data.token).kid === jwks.keys[0].kid, '| new token:', await dl(g2.data.token));
    const readd = await w.add(); say('K3 buyer tool after rotation:', readd.ok, readd.why ?? '', '| pinned keys now', mainRecord(w.buyer).trustedKeys?.length);
    w.env.PURCHASE_SIGNING_KEYS = JSON.stringify([await exportJWK(pair.privateKey)]);
    const offline = await addPart(w.buyer, 'seller.example/camera', { game: 'cave', npm: () => ({ status: 0 }), offline: true });
    say('K3 old key removed: old token', await dl(g1.data.token), '| hub verify of an old proof:', (await w.api('/api/purchases/verify', { proof: (await w.api('/api/purchases/grant', { audience: 'https://hub.example' }, rec.claim)).data.hubProof, audience: 'https://hub.example' })).data.current, '| offline restore with pinned old key:', offline.ok, offline.why ?? '');
    // a key whose kid is spoofed
    const evil = await generateKeyPair('Ed25519', { extractable: true }); const forged = await sale$.signGrant({ privateKey: evil.privateKey, publicJwk: jwks.keys[0] }, { iss: O, aud: 'homie-purchases', sub: rec.buyer, jti: rec.order, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, kind: 'part', resource: 'camera', version: '0.1.0', manifest: 'x', mode: 'live', claimVersion: 'x' });
    say('K3 token signed by another key under the seller kid:', await dl(forged));
    assert.notEqual(await dl(forged), 200);
  } finally { await w.close(); }
});

test('K4 a studio that sells nothing, and one with a shop but no paid parts', async () => {
  const w = await seller('k4', { machine: null }); try {
    // remove the sale: rebuild as a free part
    const { readPart, writePart, sharePart, buildParts } = await import('./paid-parts-review4-harness.mjs');
    const p = readPart(w.dir); delete p.sale; p.license = 'MIT'; delete p.licenseTerms; p.version = '0.2.0'; writePart(w.dir, p);
    const stripeCalls = () => w.st.calls.length; const before = stripeCalls(); const gets = w.r2.gets;
    const probe = async (path, init) => { const r = await fetch(`${O}${path}`, init); return `${path} ${r.status} ${r.headers.get('content-type')?.split(';')[0]}`; };
    say('K4 selling studio, for reference:', await probe('/.well-known/api-catalog'), '|', await probe('/purchases/keys.json'));
    writeFileSync(join(w.dist, 'games.json'), JSON.stringify({ studio: { name: 'Part Studio' }, games: [] }));
    delete w.env.PURCHASE_SIGNING_KEYS; delete w.env.PURCHASE_RATE_LIMITER; delete w.env.TURNSTILE_SECRET; delete w.env.PURCHASE_PAYMENT_CAPABILITIES; rmSync(join(w.dist, 'parts'), { recursive: true, force: true });
    const out = []; for (const [path, init] of [['/.well-known/api-catalog'], ['/parts/catalog.json'], ['/.well-known/homie-parts.json'], ['/purchases/keys.json'], ['/.well-known/homie-parts-jwks.json'], ['/api/purchases/resource', { method: 'POST', body: '{}' }], ['/api/purchases/mcp', { method: 'POST', body: '{}' }], ['/api/purchases/grant', { method: 'POST', body: '{}' }], ['/purchases/ord_AAAAAAAAAAAAAAAAAAAA'], ['/openapi.json']]) out.push(await probe(path, init));
    say('K4 no shop, no parts:', out.join(' | ')); say('K4 Stripe calls', stripeCalls() - before, 'R2 reads', w.r2.gets - gets);
    const cat = await (await fetch(`${O}/.well-known/api-catalog`)).json(); say('K4 api-catalog of a studio that sells nothing lists:', cat.linkset[0].item.map((i) => new URL(i.href).pathname).join(', '));
  } finally { await w.close(); }
});

test('K5 which rail takes which offer', async () => {
  for (const [label, saleOpts] of [['usd one-time', {}], ['eur one-time', { currency: 'eur' }], ['jpy one-time', { currency: 'jpy', amount: 1000 }], ['usd automatic tax', { automaticTax: true }], ['usd tax exclusive', { taxBehavior: 'exclusive' }], ['usd tax inclusive', { taxBehavior: 'inclusive' }], ['usd monthly', { billing: 'month' }], ['usd per seat x3', { scope: 'seat' }], ['usd below card minimum 0.30', { amount: 50 }]]) {
    const w = await seller(`k5${label.replace(/\W/g, '')}`, { saleOpts }); try {
      const cat = (await (await fetch(`${O}/parts/catalog.json`)).json()).parts[0]; const part = await (await fetch(`${O}/parts/camera/0.1.0/part.json`)).json(); const q = label.includes('x3') ? 3 : 1;
      const r = await fetch(`${O}/api/purchases/resource`, { method: 'POST', body: JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quantity: q, quote: await sale$.quoteHash(part, q, null, cat.releases[0].offer) }) });
      const www = r.headers.get('www-authenticate') ?? ''; const amount = /method="stripe".*?request="([^"]+)"/.exec(www)?.[1];
      say(`K5 ${label}:`, r.status, r.status === 402 ? `stripe amount ${JSON.parse(Buffer.from(amount, 'base64url')).amount}` : (await r.json()).detail, '| JSON-LD', cat.product.offers.price, cat.product.offers.priceCurrency);
    } finally { await w.close(); }
  }
});
