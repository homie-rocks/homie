import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSettlement, resumeSettlement } from '../worker/settlement-journal.mjs';
const env = { STRIPE_KEY: 'rk_live_test' };
const payload = { payload: { payload: { authorization: { from: `0x${'1'.repeat(40)}`, to: `0x${'2'.repeat(40)}`, value: '1000000', nonce: `0x${'3'.repeat(64)}`, validBefore: '1' } } }, requirements: { asset: `0x${'4'.repeat(40)}` }, fromBlock: '0x1' };
const job = { network: 'base', mode: 'live', payload: JSON.stringify(payload) };
test('an expired authorization is unpaid only after the finalized chain proves expiry', async () => {
  for (const timestamp of [null, '0x0', '0x2']) {
    const result = await resumeSettlement(env, { ...job, created_at: 0 }, { rpc: async (method) => method === 'eth_blockNumber' ? '0x1' : method === 'eth_getLogs' ? [] : timestamp ? { timestamp } : null, facilitator: { settle: () => assert.fail('expired authorization must not be submitted') } });
    assert.equal(Boolean(result?.unpaid), timestamp === '0x2');
  }
});
test('a transaction hash or unrelated successful receipt cannot authorize delivery', async () => {
  const reference = `0x${'5'.repeat(64)}`;
  assert.equal(await findSettlement(env, { ...job, reference }, { rpc: async () => null }), null);
  await assert.rejects(findSettlement(env, { ...job, reference }, { rpc: async () => ({ status: '0x1', logs: [] }) }), /accepted transfer/);
  const reverted = await findSettlement(env, { ...job, reference }, { rpc: async () => ({ status: '0x0' }) });
  assert.equal(reverted.unpaid, true);
});


test('an expired-order cleanup cannot orphan accepted settlement or provider work', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { SHOP_MIGRATION, SHOP_RESERVATIONS, SHOP_STATEMENTS } = await import('../worker/shop-store.mjs');
  const { PURCHASE_MIGRATION, PURCHASE_STATE } = await import('../worker/purchase-store.mjs');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SHOP_MIGRATION + PURCHASE_MIGRATION + PURCHASE_STATE);
    for (const table of ['purchase_settlements', 'purchase_jobs']) {
      const row = {id:table,resource_kind:'example',resource_id:'resource',item:'example:resource',amount:1000,currency:'usd',till:'stripe',mode:'live',status:'started',created_at:0,updated_at:0,claim_hash:table,buyer:'buyer',buyer_label:'buyer',quantity:1,manifest:'',manifest_hash:'hash',offer_version:'version',transport:'machine',accepted_at:0,terms_hash:'terms',quote_hash:'quote',offer:'{}',checkout_buyer:'buyer'};
      db.prepare(`INSERT INTO purchase_orders (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
      if (table === 'purchase_settlements') db.prepare("INSERT INTO purchase_settlements (id,order_id,mode,network,payload,state,created_at,updated_at) VALUES ('accepted',?,'live','base','{}','settling',0,0)").run(table);
      else db.prepare("INSERT INTO purchase_jobs (id,order_id,mode,state,payload,updated_at) VALUES ('accepted',?,'live','submitted','{}',0)").run(table);
      assert.throws(() => db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(table), /FOREIGN KEY/);
      assert.ok(db.prepare('SELECT 1 FROM purchase_orders WHERE id = ?').get(table));
    }
    // Conversely, once cleanup wins, no intent can be inserted for a vanished order.
    assert.throws(() => db.exec("INSERT INTO purchase_settlements (id,order_id,mode,network,payload,state,created_at,updated_at) VALUES ('missing','missing','live','base','{}','settling',0,0)"), /FOREIGN KEY/);
    assert.throws(() => db.exec("INSERT INTO purchase_jobs (id,order_id,mode,state,payload,updated_at) VALUES ('missing','missing','live','submitted','{}',0)"), /FOREIGN KEY/);
  } finally { db.close(); }
});
