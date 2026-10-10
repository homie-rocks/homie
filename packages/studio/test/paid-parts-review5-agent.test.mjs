/** Review 5, step 4: a buyer that has never heard of Homie. Only: RFC 9727 catalogue -> service-desc OpenAPI -> x-payment-info,
 *  the official mppx client, the official x402 client, the official MCP SDK client; jose for the proof. Every other host blocked. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { Mppx, stripe as stripeMethod } from 'mppx/client';
import { Receipt } from 'mppx';
import { jwtVerify, importJWK, decodeProtectedHeader } from 'jose';
import { card, base, say, text, orders, jobs, cron, office, cardCharges } from './paid-parts-review5-kit.mjs';
const O = 'https://seller.example';
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function discover(log) {
  const cat = await fetch(`${O}/.well-known/api-catalog`); const linkset = await cat.json();
  log('catalogue', cat.status, cat.headers.get('content-type'), '| links', JSON.stringify(linkset.linkset?.[0] ?? linkset).slice(0, 500));
  const entry = linkset.linkset?.find((l) => l['service-desc']) ?? linkset.linkset?.[0];
  const desc = entry?.['service-desc']?.[0]?.href; assert.ok(desc, 'no service-desc in the catalogue');
  const doc = await (await fetch(new URL(desc, O))).json();
  const found = Object.entries(doc.paths).map(([path, item]) => ({ path, op: item.post })).filter((x) => x.op?.['x-payment-info']);
  log('openapi', doc.openapi, 'servers', JSON.stringify(doc.servers), '| payable operations', found.length, '| x-payment-info', JSON.stringify(found[0]?.op['x-payment-info']), '| 402 documented', Boolean(found[0]?.op.responses?.['402']));
  const { path, op } = found[0]; const schema = op.requestBody.content['application/json'].schema;
  const body = Object.fromEntries(Object.entries(schema.properties).filter(([, v]) => v.const !== undefined).map(([k, v]) => [k, v.const]));
  for (const k of schema.required) if (!(k in body)) body[k] = randomBytes(32).toString('hex'); // the two hex secrets the schema describes
  return { doc, path, op, body, url: new URL(path, doc.servers?.[0]?.url ?? O).href };
}
async function checkDelivery(j, log) {
  let ok = 0; for (const f of j.files) { const want = j.manifest.files.find((m) => m.path === f.path); if (want && sha(Buffer.from(f.data, 'base64')) === want.sha256) ok++; }
  const keys = await (await fetch(`${O}/purchases/keys.json`)).json(); const kid = decodeProtectedHeader(j.proof).kid;
  const { payload, protectedHeader } = await jwtVerify(j.proof, await importJWK(keys.keys.find((k) => k.kid === kid), 'Ed25519'), { algorithms: ['Ed25519'], issuer: O });
  log('files', j.files.length, 'hash-verified', ok, '| proof typ', protectedHeader.typ, 'alg', protectedHeader.alg, 'claims', Object.keys(payload).join(','));
  assert.equal(ok, j.manifest.files.length);
}

test('G1 card (MPP + shared payment token), standards only', async () => {
  const s = await card('g1'); try {
    const d = await discover((...a) => say('G1', ...a));
    // price and terms from what is published
    const page = await (await fetch(`${O}/parts/camera/`)).text(); const ld = [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    say('G1 JSON-LD on the public page:', JSON.stringify(ld.map((x) => ({ type: x['@type'], price: x.offers?.price, currency: x.offers?.priceCurrency, availability: x.offers?.availability, license: x.license ?? x.offers?.license }))).slice(0, 400));
    let asked = null;
    const wallet = Mppx.create({ polyfill: false, fetch: globalThis.fetch, methods: [stripeMethod.charge({ paymentMethod: 'pm_card', createToken: async (p) => { asked = { amount: String(p.amount), currency: p.currency, networkId: p.networkId }; const t = s.spt(Number(p.amount)); return t; } })] });
    const r = await wallet.fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d.body) });
    say('G1 wallet was asked for', JSON.stringify(asked), '| answer', r.status, '| receipt', JSON.stringify(Receipt.fromResponse(r)), '| cache-control', r.headers.get('cache-control'));
    assert.equal(r.status, 200, await r.clone().text()); const j = await r.json(); await checkDelivery(j, (...a) => say('G1', ...a));
    say('G1 hosts', JSON.stringify([...s.w.hosts]), '| blocked', JSON.stringify(s.w.blocked), '| HTML pages fetched from the seller during pay:', s.w.log.filter((l) => /\/purchases\/ord_|\/shop/.test(l)).length);
    assert.deepEqual(s.w.blocked, []);
  } finally { s.K.restore(); await s.w.close(); }
});

test('G2 x402 exact on Base, standards only', async () => {
  const s = await base('g2'); try {
    const d = await discover((...a) => say('G2', ...a));
    const r1 = await fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d.body) });
    const required = s.http.getPaymentRequiredResponse((n) => r1.headers.get(n), undefined);
    say('G2 PaymentRequired', JSON.stringify({ v: required.x402Version, resource: required.resource, accepts: required.accepts.map((a) => ({ scheme: a.scheme, network: a.network, amount: a.amount, asset: a.asset, payTo: a.payTo === s.recipient ? 'studio deposit address' : a.payTo, t: a.maxTimeoutSeconds })) }));
    const headers = s.http.encodePaymentSignatureHeader(await s.http.createPaymentPayload(required));
    const r = await fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(d.body) });
    assert.equal(r.status, 200, await r.clone().text());
    say('G2 PAYMENT-RESPONSE', JSON.stringify(s.http.getPaymentSettleResponse((n) => r.headers.get(n))), '| Payment-Receipt', r.headers.get('payment-receipt') ? JSON.stringify(Receipt.fromResponse(r)) : 'absent');
    await checkDelivery(await r.json(), (...a) => say('G2', ...a));
    // a payment signed for this resource URL replayed on another claim's URL
    const other = { ...d.body, claim: randomBytes(32).toString('hex') };
    const x = await fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(other) });
    say('G2 the same signed payment on another purchase:', x.status, '| transfers', s.C.moved());
    say('G2 hosts', JSON.stringify([...s.w.hosts]), '| blocked', JSON.stringify(s.w.blocked));
    assert.deepEqual(s.w.blocked, []); assert.equal(s.C.moved(), 1);
  } finally { s.K.restore(); await s.w.close(); }
});

test('G3 MCP: official SDK client + mppx McpClient, standards only', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { McpClient } = await import('mppx/mcp-sdk/client');
  const s = await card('g3'); let client; try {
    const d = await discover((...a) => say('G3', ...a));
    client = new Client({ name: 'stranger', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/api/purchases/mcp`)));
    say('G3 server', JSON.stringify(client.getServerVersion()), 'capabilities', JSON.stringify(client.getServerCapabilities()));
    const tools = await client.listTools(); say('G3 tools', tools.tools.map((t) => `${t.name} required=${t.inputSchema.required}`));
    const unknown = await client.callTool({ name: 'nope', arguments: {} }).then((r) => `isError=${r.isError}`, (e) => `THREW ${e.code}`);
    const bad = await client.callTool({ name: 'purchase', arguments: { ...d.body, offerVersion: 'x' } }).then((r) => `isError=${r.isError} ${r.content?.[0]?.text?.slice(0, 90)}`, (e) => `THREW ${e.code} ${e.message.slice(0, 60)}`);
    say('G3 unknown tool:', unknown, '| stale offerVersion:', bad);
    const paying = McpClient.wrap(client, { methods: [stripeMethod.charge({ paymentMethod: 'pm_card', createToken: async (p) => s.spt(Number(p.amount)) })] });
    const res = await paying.callTool({ name: 'purchase', arguments: d.body });
    const receipt = res.receipt ?? res._meta?.['org.paymentauth/receipt'];
    const files = res.content.filter((c) => c.type === 'resource'); const meta = JSON.parse(res.content.find((c) => c.type === 'text').text);
    say('G3 paid: receipt', JSON.stringify(receipt), '| resources', files.length, 'distinct uris', new Set(files.map((f) => f.resource.uri)).size, '| proof', Boolean(meta.proof), '| isError', res.isError ?? false);
    const again = await client.callTool({ name: 'purchase', arguments: d.body });
    say('G3 same call again (no payment): receipt', JSON.stringify(again._meta?.['org.paymentauth/receipt']), 'resources', again.content?.filter((c) => c.type === 'resource').length, '| charges', cardCharges(s.w).length);
    assert.equal(cardCharges(s.w).length, 1); assert.deepEqual(s.w.blocked, []);
    say('G3 hosts', JSON.stringify([...s.w.hosts]));
  } finally { try { await client?.close(); } finally { s.K.restore(); await s.w.close(); } }
});

test('G4 what a stranger is told when no machine path is open (seller not configured; recurring; EUR; Managed Payments)', async () => {
  for (const [name, opts] of [['unconfigured', { machine: null }], ['monthly', { saleOpts: { billing: 'month' } }], ['eur', { saleOpts: { currency: 'eur' } }], ['managed', { shop: { till: 'stripe-managed', currency: 'usd', items: [] } }]]) {
    const s = await card(`g4${name}`, opts).catch((e) => ({ error: e })); if (s.error) { say('G4', name, 'setup THREW', s.error.message); continue; }
    try {
      const cat = await (await fetch(`${O}/.well-known/api-catalog`)).json();
      const doc = await (await fetch(`${O}/openapi.json`)).json().catch(() => null);
      const ops = Object.entries(doc?.paths ?? {}); const info = ops[0]?.[1].post?.['x-payment-info'];
      const b = { kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim: 'b'.repeat(64), offerVersion: s.offerVersion, ...(name === 'x' ? {} : {}) };
      const r = await fetch(`${O}${ops[0]?.[0] ?? '/api/purchases/resource/part/camera/0.1.0'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      const j = await r.clone().json().catch(() => ({}));
      if (['monthly','eur','managed'].includes(name)) assert.equal(j.checkout?.url, `${O}/api/purchases/intent`);
      say(`G4 ${name}: catalogue rels`, Object.keys(cat.linkset?.[0] ?? {}).join(','), '| payable ops', ops.length, 'x-payment-info', JSON.stringify(info ?? null), '| POST:', r.status, j.detail, '| machine-readable pointer to the fallback:', JSON.stringify({ link: r.headers.get('link'), checkout: j.checkout ?? j.fallback ?? null }));
    } finally { s.K.restore(); await s.w.close(); }
  }
});
