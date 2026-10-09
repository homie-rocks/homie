import { loadSelling } from '../worker/selling/index.mjs';
await loadSelling();
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { journalFacilitator, journalTempoClient } from '../worker/settlement-journal.mjs';
import { stripeCall } from '../worker/stripe.mjs';
import { byId } from '../worker/purchase-store.mjs';
import { reconcileRecordings, saveRecording, recordProviderResult } from '../worker/payment-recovery.mjs';
const setup = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let boundary = 0; let inBatch = false;
const stop = () => { if (inBatch) return; if (++boundary === Number(process.argv[3])) process.kill(process.pid, 'SIGKILL'); };
const sql = new DatabaseSync(setup.database);
const statement = (query, args = []) => ({
  bind: (...values) => statement(query, values),
  first: async () => sql.prepare(query).get(...args) ?? null,
  all: async () => ({ results: sql.prepare(query).all(...args) }),
  run: async () => { const result = { meta: { changes: sql.prepare(query).run(...args).changes } }; stop(); return result; },
});
const env = { ...setup.env, DB: { prepare: statement, batch: async (statements) => { sql.exec('BEGIN'); inBatch = true; const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); inBatch = false; stop(); return results; } },
  PURCHASE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async (request) => { const data = setup.assets[new URL(request.url).pathname]; return data ? new Response(data) : new Response('', { status: 404 }); } },
  PURCHASE_MEDIA: { get: async (key) => { const encoded = setup.objects[key]; if (!encoded) return null; const data = Buffer.from(encoded, 'base64'); return { size: data.length, body: data, json: async () => JSON.parse(data), arrayBuffer: async () => data }; } },
};
const original = fetch;
globalThis.fetch = async (...args) => { const response = await original(...args); stop(); return response; };
const rpc = async (method, params) => (await (await fetch(setup.chain, { method: 'POST', body: JSON.stringify({ method, params }) })).json()).result;
const facilitator = {
  verify: async () => ({ isValid: true }),
  settle: async (payload, requirements) => (await fetch(setup.chain, { method: 'POST', body: JSON.stringify({ method: 'settle', payload, requirements }) })).json(),
};
await reconcileRecordings(env, null, { rpc, facilitator });
if (process.argv[4] !== 'recover') {
  const order = await byId(env, setup.order);
  if (order.status === 'started') {
    order.challengeId = setup.challengeId;
    if (setup.rail === 'card') {
      const params = { amount: order.amount, currency: order.currency, confirm: true, shared_payment_granted_token: 'spt_crash', metadata: { homie: 'purchase-v1', order: order.id, mpp_challenge_id: setup.challengeId } };
      const options = { idempotencyKey: 'card-crash' };
      const id = await saveRecording(env, order, params, options);
      const pi = await stripeCall(env, 'POST', '/v1/payment_intents', params, options);
      await recordProviderResult(env, order, id, pi);
    } else if (setup.rail === 'tempo') {
      const client = await journalTempoClient(env, order, 4217);
      await client.request({ method: 'eth_sendRawTransaction', params: ['0x01'] });
    } else await journalFacilitator(env, order, facilitator, rpc).settle(setup.payload, setup.requirements);
    await reconcileRecordings(env, order.id, { rpc, facilitator });
  }
}
console.log(JSON.stringify({ boundary, order: sql.prepare('SELECT status,payment FROM purchase_orders LIMIT 1').get(), fulfilled: sql.prepare('SELECT fulfilled_at FROM purchase_orders LIMIT 1').get()?.fulfilled_at }));
sql.close();

process.exit(0);
