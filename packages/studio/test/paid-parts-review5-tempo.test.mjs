import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mppx, tempo } from 'mppx/client';
import { Challenge } from 'mppx';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { seller, instrument, say, text, orders, jobs, settlements, cron } from './paid-parts-review5-kit.mjs';
for (const KEY of ['live','test']) test(`T1 ${KEY} Tempo rail with the official mppx client`, async () => {
  const recipient = privateKeyToAccount(generatePrivateKey()).address; const account = privateKeyToAccount(generatePrivateKey());
  const { LIVE_KEY, TEST_KEY, PP } = await import('./paid-parts-review5-kit.mjs'); const w = await seller('t1'+KEY, { key: KEY === 'live' ? LIVE_KEY : TEST_KEY, machine: { profile: 'profile_x', tempo: recipient } }); const K = instrument(w);
  const rpcLog = [];
  const rpc = async (request) => { const call = await request.json(); const one = (c) => { rpcLog.push(c.method); let result = null;
      if (c.method === 'eth_chainId') result = '0x1079'; if (c.method === 'eth_getTransactionCount') result = '0x0'; if (c.method === 'eth_blockNumber') result = '0x10';
      if (c.method === 'eth_estimateGas') result = '0x30d40'; if (c.method === 'eth_gasPrice' || c.method === 'eth_maxPriorityFeePerGas') result = '0x3b9aca00';
      if (c.method === 'eth_getBlockByNumber') result = { baseFeePerGas: '0x3b9aca00', number: '0x10', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
      if (c.method === 'eth_call') result = '0x' + '0'.repeat(63) + '6';
      return { jsonrpc: '2.0', id: c.id, result }; };
    return Response.json(Array.isArray(call) ? call.map(one) : one(call)); };
  for (const h of ['rpc.tempo.xyz', 'rpc.moderato.tempo.xyz', 'rpc.presto.tempo.xyz', 'rpc.testnet.tempo.xyz']) w.handle(h, rpc);
  try {
    const listing = await fetch('https://seller.example/parts/catalog.json').then((r) => r.json()).then((c) => c.parts[0].releases[0]);
    const body = JSON.stringify({ kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'c'.repeat(64), claim: 'd'.repeat(64), offerVersion: listing.offerVersion });
    const r1 = await fetch('https://seller.example/api/purchases/resource', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    let r1b = r1; if (r1.status === 403) { await PP.authorizePurchaseTest(w.env, orders(w)[0].id); r1b = await fetch('https://seller.example/api/purchases/resource', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); } const list = Challenge.fromResponseList(r1b); assert.equal(list.some((c) => c.method === 'tempo'), false); assert.equal(rpcLog.length, 0); say('T1', KEY, 'tempo challenge', list.filter((c) => c.method === 'tempo').map((c) => c.request));
    const wallet = Mppx.create({ polyfill: false, fetch: globalThis.fetch, methods: [tempo.charge({ account })] });
    let r; try { r = await wallet.fetch('https://seller.example/api/purchases/resource', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); say('T1', KEY, 'paid', await text(r)); } catch (e) { say('T1', KEY, 'client THREW', e.message.slice(0, 260).replace(/\n/g, ' ')); }
    say('T1', KEY, 'rpc methods', rpcLog, '| hosts', [...w.hosts], '| blocked', w.blocked, '| order', orders(w), 'settlements', settlements(w), 'jobs', jobs(w).map((j) => [j.state, j.error]));
  } finally { K.restore(); await w.close(); }
});
