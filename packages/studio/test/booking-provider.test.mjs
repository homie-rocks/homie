import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { providerOpen, providerCheckout, syncProviderOrder } from '../worker/booking-provider.mjs';
function db(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE shop_orders(id TEXT PRIMARY KEY,session TEXT,status TEXT,mode TEXT)");
  const prepare = (q, a = []) => ({ bind: (...b) => prepare(q, b), run: async () => ({ meta: { changes: sql.prepare(q).run(...a).changes } }), first: async () => sql.prepare(q).get(...a) ?? null });
  return { sql, DB: { prepare } };
}
test('no provider, a refusing provider or a throwing one is closed', async () => {
  assert.equal(await providerOpen({}), false);
  assert.equal(await providerOpen({ HOMIE_PAYMENTS: { bookingCheckoutOpen: async () => false } }), false);
  assert.equal(await providerOpen({ HOMIE_PAYMENTS: { bookingCheckoutOpen: async () => 'yes' } }), false);
  assert.equal(await providerOpen({ HOMIE_PAYMENTS: { bookingCheckoutOpen: async () => { throw Error('no such method'); } } }), false);
  assert.equal(await providerOpen({ HOMIE_PAYMENTS: { bookingCheckoutOpen: async () => true } }), true);
});
test('the studio\'s own Stripe key keeps its own checkout', async () => {
  assert.equal(await providerOpen({ STRIPE_KEY: 'sk_test_abc', STRIPE_CHECKOUT_MODE: 'sessions', HOMIE_PAYMENTS: { bookingCheckoutOpen: async () => true } }), false);
});
test('a refused or malformed provider session opens nothing', async t => {
  const { DB } = db(t);
  await assert.rejects(providerCheckout({ DB, HOMIE_PAYMENTS: { bookingCheckout: async () => ({ state: 'rejected', reason: 'closed' }) } }, 'ord_aaaaaaaaaaaaaaaaaaaa', {}), /not open/);
  await assert.rejects(providerCheckout({ DB, HOMIE_PAYMENTS: { bookingCheckout: async () => ({ id: 'pi_1', url: 'https://x' }) } }, 'ord_aaaaaaaaaaaaaaaaaaaa', {}), /without a session/);
  const s = await providerCheckout({ DB, HOMIE_PAYMENTS: { bookingCheckout: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc', livemode: false }) } }, 'ord_aaaaaaaaaaaaaaaaaaaa', {});
  assert.equal(s.id, 'cs_test_abc');
});
test('sync records nothing unless the provider session is this order, this mode and complete', async t => {
  const { sql, DB } = db(t), order = 'ord_bbbbbbbbbbbbbbbbbbbb';
  sql.prepare("INSERT INTO shop_orders VALUES(?,?,?,?)").run(order, 'cs_test_x', 'started', 'test');
  const env = s => ({ DB, HOMIE_PAYMENTS: { bookingSession: async () => s } });
  assert.equal(await syncProviderOrder(env({ id: 'cs_test_x', livemode: false, metadata: { order }, status: 'complete', payment_status: 'paid' }), {}, order), false, 'no provider meta');
  sql.prepare("INSERT INTO meta VALUES(?,?)").run('booking-provider:' + order, JSON.stringify({ session: 'cs_test_x' }));
  assert.equal(await syncProviderOrder(env({ id: 'cs_test_x', livemode: true, metadata: { order }, status: 'complete', payment_status: 'paid' }), {}, order), false, 'live session on a test order');
  assert.equal(await syncProviderOrder(env({ id: 'cs_test_x', livemode: false, metadata: { order: 'ord_other' }, status: 'complete', payment_status: 'paid' }), {}, order), false, 'another order');
  assert.equal(await syncProviderOrder(env({ id: 'cs_test_x', livemode: false, metadata: { order }, status: 'open', payment_status: 'unpaid' }), {}, order), false, 'unpaid');
  assert.equal(await syncProviderOrder({ DB }, {}, order), false, 'no binding');
});
