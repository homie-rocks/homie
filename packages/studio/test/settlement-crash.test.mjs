import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import { world, LIVE_KEY, configureMachine, sale$ } from './paid-parts-review4-harness.mjs';
import { machineResource } from '../worker/purchase-machine.mjs';

let childEntry;
const run = (file, boundary = 0, mode = '') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [childEntry, file, String(boundary), mode]);
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Child timeout at boundary ${boundary}: ${output}`)); }, 60000);
  let output = ''; child.stdout.on('data', (v) => output += v); child.stderr.on('data', (v) => output += v);
  child.on('error', reject); child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
});

for (const rail of ['base', 'tempo', 'card']) test(`${rail}: SIGKILL at each durable write and external-call boundary recovers settlement and retains paid sales during storage faults`, { timeout: 600000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'settlement-crash-'));
  childEntry = join(directory, 'child.mjs');
  const { build } = await import('esbuild');
  // Preserve the production lazy boundary: this Node settlement child never serves
  // MCP, whose Cloudflare runtime imports are exercised by the workerd tests.
  await build({ entryPoints: [new URL('./settlement-crash-child.mjs', import.meta.url).pathname], outfile: childEntry, bundle: true, platform: 'node', format: 'esm', packages: 'bundle', external: [new URL('../worker/mcp.mjs', import.meta.url).pathname] });
  const account = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const w = await world(`crash-boundaries-${rail}`, { key: LIVE_KEY });
  let settled = null; let transfers = 0;
  const reference = `0x${'a'.repeat(64)}`;
  const chain = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    const call = JSON.parse(text); let result;
    if (call.method === 'settle') { if (!settled) { settled = call; transfers++; } response.end(JSON.stringify({ success: true, transaction: reference, network: 'eip155:8453' })); return; }
    if (call.method === 'eth_sendRawTransaction' || call.method === 'eth_sendRawTransactionSync') { if (!settled) { settled = { raw: call.params[0] }; transfers++; } result = keccak256(call.params[0]); }
    if (call.method === 'eth_blockNumber') result = '0x1';
    if (call.method === 'eth_getLogs') result = settled ? [{ transactionHash: reference }] : [];
    if (call.method === 'eth_getTransactionReceipt') {
      const auth = settled?.payload?.payload.authorization;
      result = settled?.raw ? { status: '0x1', logs: [] } : settled ? { status: '0x1', logs: [{ address: settled.requirements.asset, topics: [keccak256(toHex('Transfer(address,address,uint256)')), `0x${auth.from.slice(2).padStart(64,'0')}`, `0x${auth.to.slice(2).padStart(64,'0')}`], data: `0x${BigInt(auth.value).toString(16)}` }] } : null;
    }
    response.end(JSON.stringify({ result }));
  });
  try {
    await new Promise((resolve) => chain.listen(0, '127.0.0.1', resolve));
    await configureMachine(w, { profile: 'profile_example', base: recipient });
    const part = await (await w.fetcher('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const body = { kind: 'part', resource: part.id, version: part.version, buyer: 'a'.repeat(64), claim: 'b'.repeat(64), quote: await sale$.quoteHash(part) };
    const url = 'https://seller.example/api/purchases/resource';
    const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
    const challenge = await machineResource(request, w.env, new URL(url), {}, { facilitator: { verify() {}, settle() {} } });
    const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64'));
    const wallet = x402Client.fromConfig({ schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }], spendControls: { maxAmountPerPayment: '10' } });
    const payload = await wallet.createPaymentPayload(required);
    const signature = Buffer.from(JSON.stringify(payload)).toString('base64');
    const base = join(directory, 'base.sqlite'); await backup(w.sql, base);
    w.env.PURCHASE_MACHINE_PAYMENTS = JSON.stringify({ live: { profile: 'profile_example', base: recipient, rpc: { tempo: `http://127.0.0.1:${chain.address().port}` } } });
    const setup = { rail, url, signature, body, order: w.order().id, payload, requirements: required.accepts[0], challengeId: 'crash-challenge', env: Object.fromEntries(Object.entries(w.env).filter(([, value]) => typeof value === 'string')), chain: `http://127.0.0.1:${chain.address().port}`, assets: { '/parts/index.json': readFileSync(join(w.dist, 'parts/index.json'), 'utf8') }, objects: Object.fromEntries([...w.objects].map(([key, value]) => [key, value.toString('base64')])) };
    let killed = 0;
    for (let boundary = 1; boundary <= 80; boundary++) {
      settled = null; transfers = 0; w.st.idem.clear(); w.st.pis.clear(); w.st.charges.clear(); w.st.refunds.length = 0; w.st.spts.set('spt_crash', { max: 1000, currency: 'usd' });
      const database = join(directory, `case-${boundary}.sqlite`); writeFileSync(database, readFileSync(base));
      const file = join(directory, 'input.json'); writeFileSync(file, JSON.stringify({ ...setup, database }));
      const first = await run(file, boundary);
      console.log(`Crash boundary ${boundary}: ${first.signal ?? first.code}`);
      assert.ok(first.signal === 'SIGKILL' || first.code === 0, first.output);
      if (first.signal) killed++;
      // If no intent was durably accepted, the original approved request is retried.
      const resumed = await run(file);
      assert.equal(resumed.code, 0, resumed.output);
      const finished = await run(file, 0, 'recover');
      assert.equal(finished.code, 0, finished.output);
      const db = new DatabaseSync(database);
      assert.equal(db.prepare('SELECT status FROM purchase_orders').get().status, 'fulfilled');
      assert.ok(db.prepare('SELECT fulfilled_at FROM purchase_orders').get().fulfilled_at);
      assert.equal(rail === 'card' ? w.st.pis.size : transfers, 1);
      db.close();
      // The same durable intent is recovered with missing objects: automatic refund.
      settled = null; transfers = 0; w.st.idem.clear(); w.st.pis.clear(); w.st.charges.clear(); w.st.refunds.length = 0; w.st.spts.set('spt_crash', { max: 1000, currency: 'usd' });
      writeFileSync(database, readFileSync(base)); writeFileSync(file, JSON.stringify({ ...setup, database }));
      await run(file, boundary);
      if (settled || w.st.pis.size) {
        writeFileSync(file, JSON.stringify({ ...setup, database, objects: {} }));
        const recovered = await run(file, 0, 'recover'); assert.equal(recovered.code, 0, recovered.output);
        const db = new DatabaseSync(database);
        assert.ok(['paid','fulfilled'].includes(db.prepare('SELECT status FROM purchase_orders').get().status), `boundary ${boundary}`); assert.equal(w.st.refunds.length, 0);
        assert.equal(rail === 'card' ? w.st.pis.size : transfers, 1); db.close();
      }
      if (!first.signal) break;
    }
    assert.ok(killed >= 6, `exercised ${killed} crash boundaries`);
    // Refund recovery itself must survive losing the provider response or any
    // later durable write, without refunding a different payment or paying twice.
    let refundKills = 0;
    for (let boundary = 1; boundary <= 80; boundary++) {
      settled = null; transfers = 0; w.st.idem.clear(); w.st.pis.clear(); w.st.charges.clear(); w.st.refunds.length = 0; w.st.spts.set('spt_crash', { max: 1000, currency: 'usd' });
      const database = join(directory, 'refund.sqlite'); writeFileSync(database, readFileSync(base));
      const file = join(directory, 'input.json'); writeFileSync(file, JSON.stringify({ ...setup, database }));
      const paid = await run(file); assert.equal(paid.code, 0, paid.output);
      writeFileSync(file, JSON.stringify({ ...setup, database, objects: {} }));
      const interrupted = await run(file, boundary, 'recover');
      assert.ok(interrupted.signal === 'SIGKILL' || interrupted.code === 0, interrupted.output);
      if (interrupted.signal) refundKills++;
      const resumed = await run(file, 0, 'recover'); assert.equal(resumed.code, 0, resumed.output);
      const db = new DatabaseSync(database);
      assert.equal(db.prepare('SELECT status FROM purchase_orders').get().status, 'fulfilled', `storage boundary ${boundary}`);
      assert.equal(w.st.refunds.length, 0, `no refund at boundary ${boundary}`);
      assert.equal(rail === 'card' ? w.st.pis.size : transfers, 1);
      db.close();
      if (!interrupted.signal) break;
    }
    assert.equal(refundKills, 0, 'Completed jobs perform no recovery writes or provider calls');

  } finally { chain.closeAllConnections(); await new Promise((resolve) => chain.close(resolve)); await w.close(); rmSync(directory, { recursive: true, force: true }); }
});
