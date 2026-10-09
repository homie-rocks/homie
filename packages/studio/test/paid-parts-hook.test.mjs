// Same test on both checkouts: ROOT=<checkout>. An existing shop (old restricted key: no Invoices permission)
// receives a refund event for a charge that is not a Homie order (same Stripe account, another product).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
const R = new URL('../worker', import.meta.url).href;
const { shopRoutes } = await import(R + '/shop.mjs');
const { SHOP_MIGRATION, SHOP_RESERVATIONS, SHOP_STATEMENTS } = await import(R + '/shop-store.mjs');
const { signPayload } = await import(R + '/stripe.mjs');
let PARTS = ''; try { PARTS = (await import(R + '/purchases.mjs')).PURCHASE_MIGRATION; } catch {}
const KEY = `rk_test_${'A1b2C3d4'.repeat(4)}`; const SECRET = `whsec_${'testsecretvalue0'.repeat(2)}`;
for (const migrated of [true, false]) test(`unrelated refund event, old key, parts migration ${migrated ? 'applied' : 'not yet applied'}`, async () => {
  const sql = new DatabaseSync(':memory:'); sql.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);'); sql.exec(SHOP_MIGRATION); sql.exec(SHOP_RESERVATIONS); sql.exec(SHOP_STATEMENTS); if (migrated && PARTS) sql.exec(PARTS);
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null, all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
  const DB = { prepare: stmt, batch: async (l) => { for (const s of l) await s.run(); } };
  const calls = [];
  const server = createServer((req, res) => { calls.push(req.method + ' ' + req.url.split('?')[0]); res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/payment_intents/')) return res.end(JSON.stringify({ id: 'pi_other', metadata: {} }));
    res.statusCode = 403; res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint' } })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { DB, STRIPE_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: `http://127.0.0.1:${server.address().port}` };
  const cat = { studio: { name: 'S' }, games: [], shop: { till: 'stripe', currency: 'usd', items: [{ id: 'hat', kind: 'cosmetic', name: 'Hat', price: 500, gives: ['hat'] }] } };
  const body = JSON.stringify({ id: 'evt_1', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_other', payment_intent: 'pi_other', refunded: true, amount: 900, amount_refunded: 900 } } });
  const t = Math.floor(Date.now() / 1000);
  const req = new Request('https://s.example/api/shop/hook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await signPayload(body, SECRET, t)}` } });
  let out; try { const r = await shopRoutes(req, env, {}, new URL(req.url), { catalogueOf: async () => cat }); out = `${r.status} ${await r.text()}`; } catch (e) { out = `THREW (Worker answers 500, Stripe retries, then disables the endpoint): ${e.message}`; }
  console.log('RESULT', out.trim(), '| Stripe calls:', calls.join(', ') || 'none');
  server.close(); assert.match(out, /^200/);
});
