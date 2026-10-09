/** Review 5 kit: the branch's real Worker entry (worker.fetch / worker.scheduled) over real SQLite, with a kill switch
 *  on every durable write and every external call, and one-shot or sticky faults on any external host. */
import { generateKeyPairSync } from 'node:crypto';
import { Challenge, Credential } from 'mppx';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
const T = '.';
export const { seller, LIVE_KEY, TEST_KEY } = await import(`${T}/paid-parts-review4-seller.mjs`);
export const H = await import(`${T}/paid-parts-review4-harness.mjs`);
export const { worker, PP, sale$, shopMod } = H;
import { appendFileSync } from 'node:fs';
export const say = (...a) => { const line = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); if (process.env.OUT) appendFileSync(process.env.OUT, line + '\n'); };
export const URL_ = 'https://seller.example/api/purchases/resource';
const cdpSecret = () => { const { privateKey, publicKey } = generateKeyPairSync('ed25519'); return Buffer.concat([privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64'); };

class Killed extends Error { constructor() { super('process killed'); this.killed = true; } }

/** Wrap the world's D1 and the global fetch. kill.at = N stops the "process" after the Nth boundary:
 *  a boundary is one committed D1 write (run or batch) or one completed external call (the far side did its work,
 *  the answer never reached us). After the stop nothing can touch the database or the network until revive(). */
export function instrument(w) {
  try { w.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT)'); } catch {}
  const K = { n: 0, at: 0, dead: false, trace: [], faults: [], calls: [] };
  const tick = (label) => { if (K.dead) throw new Killed(); K.n++; K.trace.push(label); if (K.at && K.n === K.at) { K.dead = true; K.diedAt = label; throw new Killed(); } };
  const gate = () => { if (K.dead) throw new Killed(); };
  const db = w.env.DB;
  const wrap = (stmt, q) => ({
    bind: (...a) => wrap(stmt.bind(...a), q),
    first: async () => { gate(); return stmt.first(); },
    all: async () => { gate(); return stmt.all(); },
    run: async () => { gate(); const r = await stmt.run(); if (!K.inBatch) tick(`db ${q.slice(0, 60)}`); return r; },
  });
  w.env.DB = {
    sql: db.sql,
    prepare: (q) => wrap(db.prepare(q), q),
    batch: async (list) => { gate(); K.inBatch = true; let r; try { r = await db.batch(list); } finally { K.inBatch = false; } tick(`db batch(${list.length})`); return r; },
  };
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const u = new URL(request.url);
    if (u.host === 'seller.example') return inner(input, init); // the buyer's own call into the Worker
    gate();
    const label = `${request.method} ${u.host}${u.pathname}`;
    K.calls.push(label);
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text().catch(() => '');
    const i = K.faults.findIndex((f) => f.match(label, body));
    if (i >= 0) {
      const f = K.faults[i]; if (!f.sticky) K.faults.splice(i, 1);
      f.hits = (f.hits ?? 0) + 1;
      if (f.before) return f.before(label, body);          // the far side never saw it
      const real = await inner(input, init);               // the far side did the work
      if (f.after) return f.after(real, label, body);      // ...and we saw something else
    }
    const r = await inner(input, init);
    tick(`net ${label}`);
    return r;
  };
  K.revive = () => { K.dead = false; K.at = 0; };
  K.fault = (f) => { K.faults.push(f); return f; };
  K.restore = () => { globalThis.fetch = inner; w.env.DB = db; };
  return K;
}
export const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
export const cron = async (w, times = 1) => { const out = []; for (let i = 0; i < times; i++) { try { await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, w.env, ctx()); out.push('ok'); } catch (e) { out.push(`THREW ${e.message}`); } } return out; };
export const office = async (w) => shopMod.shopOffice(w.env, w.cat, 'https://seller.example');
export const text = async (r) => `${r.status} ${(await r.clone().text()).replace(/"data":"[^"]{40,}"/g, '"data":"…"').slice(0, 170)}`;
export const orders = (w) => w.sql.prepare('SELECT id,status,payment,amount,transport,paid_at,fulfilled_at,refunded_at,claim_hash FROM purchase_orders ORDER BY created_at').all();
export const jobs = (w) => w.sql.prepare('SELECT id,order_id,state,payment,error,attempts FROM purchase_jobs').all();
export const settlements = (w) => w.sql.prepare('SELECT order_id,network,state,reference,error FROM purchase_settlements').all();
/** Money the buyer has actually lost: Stripe charges not refunded (card), or on-chain transfers (stablecoin). */
export const cardCharges = (w) => [...w.st.pis.values()].filter((p) => p.spt);
export const netCard = (w) => cardCharges(w).filter((p) => !w.st.charges.get(p.charge).refunded).length;

export async function card(name, opts = {}) {
  const w = await seller(name, opts);
  const K = instrument(w);
  const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
  const listing = () => fetch('https://seller.example/parts/catalog.json').then((r) => r.json()).then((c) => c.parts[0].releases.find((r) => r.version === '0.1.0'));
  const offerVersion = (await listing()).offerVersion;
  const body = (claim = 'b'.repeat(64), extra = {}) => ({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'a'.repeat(64), claim, offerVersion, ...extra });
  const post = (b, headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
  let n = 0;
  const spt = (max = 1000, o = {}) => { const t = `spt_${name}_${++n}`; w.st.spts.set(t, { max, currency: 'usd', ...o }); return t; };
  const challengeOf = async (r) => Challenge.fromResponseList(r).find((c) => c.method === 'stripe');
  const cred = (challenge, token) => Credential.serialize({ challenge, payload: { spt: token } });
  const grant = (claim = 'b'.repeat(64)) => w.api('/api/purchases/grant', { version: '0.1.0' }, claim);
  return { w, K, part, body, post, spt, challengeOf, cred, grant, listing, offerVersion };
}

/** A chain double: one USDC contract, EIP-3009 semantics (a nonce transfers once), blocks advance on demand. */
export function chain(w, { network = 'eip155:8453', live = true } = {}) {
  const C = { transfers: [], used: new Map(), block: 100, calls: [], settleCalls: 0, verifyCalls: 0, fail: null, revert: false, finalizedTime: null };
  const rpc = async (request) => {
    const call = await request.json(); C.calls.push(call.method); let result = null;
    if (call.method === 'eth_blockNumber') result = `0x${(C.block).toString(16)}`;
    if (call.method === 'eth_getLogs') { const [f] = call.params; result = [...C.used.values()].filter((t) => t.nonce === f.topics[2] && BigInt(t.block) >= BigInt(f.fromBlock)).map((t) => ({ transactionHash: t.hash })); }
    if (call.method === 'eth_getTransactionReceipt') { const t = C.transfers.find((x) => x.hash === call.params[0]); result = t ? { status: t.reverted ? '0x0' : '0x1', logs: t.reverted ? [] : [{ address: t.asset, topics: [keccak256(toHex('Transfer(address,address,uint256)')), `0x${t.from.slice(2).padStart(64, '0')}`, `0x${t.to.slice(2).padStart(64, '0')}`], data: `0x${BigInt(t.value).toString(16)}` }] } : null; }
    if (call.method === 'eth_getBlockByNumber') result = { timestamp: `0x${Math.floor((C.finalizedTime ?? Date.now()) / 1000).toString(16)}` };
    return Response.json({ jsonrpc: '2.0', id: call.id ?? 1, result });
  };
  for (const host of ['mainnet.base.org', 'sepolia.base.org']) w.handle(host, rpc);
  const facilitator = async (request) => {
    const u = new URL(request.url);
    if (u.pathname.endsWith('/supported')) return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} });
    const body = await request.json(); const auth = body.paymentPayload?.payload?.authorization;
    if (u.pathname.endsWith('/verify')) { C.verifyCalls++; return Response.json({ isValid: true, payer: auth?.from }); }
    if (u.pathname.endsWith('/settle')) {
      C.settleCalls++;
      if (C.fail) return Response.json({ success: false, errorReason: C.fail, transaction: '', network, payer: auth.from });
      if (C.used.has(auth.nonce)) return Response.json({ success: false, errorReason: 'invalid_exact_evm_payload_authorization_nonce_used', transaction: '', network, payer: auth.from });
      if (Number(auth.validBefore) < Date.now() / 1000) return Response.json({ success: false, errorReason: 'invalid_exact_evm_payload_authorization_valid_before', transaction: '', network, payer: auth.from });
      const t = { hash: `0x${String(C.transfers.length + 1).padStart(64, 'c')}`, nonce: auth.nonce, from: auth.from, to: auth.to, value: auth.value, asset: body.paymentRequirements.asset, block: ++C.block, reverted: C.revert };
      C.transfers.push(t); C.used.set(auth.nonce, t);
      return Response.json(C.revert ? { success: false, errorReason: 'transaction_reverted', transaction: t.hash, network, payer: auth.from } : { success: true, transaction: t.hash, network, payer: auth.from });
    }
    return new Response('nope', { status: 404 });
  };
  w.handle(live ? 'api.cdp.coinbase.com' : 'x402.org', facilitator);
  C.moved = () => C.transfers.filter((t) => !t.reverted).length;
  return C;
}

export async function base(name, opts = {}) {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const w = await seller(name, { machine: { profile: 'profile_x', base: recipient }, ...opts });
  w.env.CDP_API_KEY_ID = 'cdp-key-id-example'; w.env.CDP_API_KEY_SECRET = cdpSecret();
  const C = chain(w);
  const K = instrument(w);
  const listing = await fetch('https://seller.example/parts/catalog.json').then((r) => r.json()).then((c) => c.parts[0].releases.find((r) => r.version === '0.1.0'));
  const body = (claim = 'd'.repeat(64), extra = {}) => ({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim, offerVersion: listing.offerVersion, ...extra });
  const post = (b, headers = {}) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
  const core = x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '100' } }); const http = new x402HTTPClient(core);
  const sign = async (r402) => { const required = http.getPaymentRequiredResponse((n) => r402.headers.get(n), undefined); return http.encodePaymentSignatureHeader(await http.createPaymentPayload(required)); };
  const grant = (claim = 'd'.repeat(64)) => w.api('/api/purchases/grant', { version: '0.1.0' }, claim);
  return { w, K, C, account, recipient, body, post, sign, http, grant, listing };
}

/** The final verdict on one order: what the money did and what the buyer and owner can see. */
export async function verdict(s, { claim, moved, refunded }) {
  const o = orders(s.w).find((x) => true);
  const g = o ? await s.grant(claim) : { status: 0 };
  const off = await office(s.w).catch((e) => ({ error: e.message }));
  const visible = Boolean(off.orders?.some((x) => x.id === o?.id)) || Boolean(off.paymentRecovery?.some((x) => x.order_id === o?.id)) || Boolean(off.settlementRecovery?.some((x) => x.order_id === o?.id));
  return { status: o?.status ?? 'none', moved, refunded, grant: g.status, visible, jobs: jobs(s.w).map((j) => j.state).join(','), settlements: settlements(s.w).map((x) => x.state).join(',') };
}
