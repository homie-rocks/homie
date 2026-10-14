import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { BOOKINGS_MIGRATION, bookingStatement, moveBooking } from '../worker/booking-store.mjs';
function fixture(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`CREATE TABLE shop_orders(id TEXT PRIMARY KEY,status TEXT,updated_at INTEGER);
    CREATE TABLE app_records(app TEXT,collection TEXT,id TEXT,value TEXT,version INTEGER,updated_at INTEGER,PRIMARY KEY(app,collection,id));
    CREATE TABLE studio_events(id TEXT PRIMARY KEY,type TEXT,data TEXT,at INTEGER);
    CREATE TABLE function_subscriptions(type TEXT);
    INSERT INTO function_subscriptions VALUES('booking.held'),('booking.confirmed'),('booking.released'),('booking.moved');`);
  sql.exec(BOOKINGS_MIGRATION);
  const prepare = (q, args = []) => ({ bind: (...a) => prepare(q, a), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
  const env = { DB: { prepare } };
  const slot = (id, capacity) => sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tuning','slots',id,JSON.stringify({ capacity }));
  const hold = (id, slot = 'morning') => {
    sql.prepare('INSERT INTO shop_orders VALUES(?,?,1)').run(id, 'started');
    return bookingStatement(env, { id, app:'tuning', collection:'bookings', slots:'slots', slot, quantity:1, order:id }).run();
  };
  const state = id => sql.prepare('SELECT * FROM shop_bookings WHERE id=?').get(id);
  const pay = (id, status) => sql.prepare('UPDATE shop_orders SET status=?,updated_at=updated_at+1 WHERE id=?').run(status,id);
  return {sql,env,slot,hold,state,pay};
}
test('two buyers for the last seat: only one atomic insert wins', async t => {
  const f=fixture(t); f.slot('morning',1);
  const result=await Promise.allSettled([f.hold('alice'),f.hold('bob')]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM shop_bookings').get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM studio_events').get().n,1);
});
test('held, paid, refunded project records and durable events once',async t=>{
  const f=fixture(t);f.slot('morning',1);await f.hold('alice');
  assert.equal(f.state('alice').state,'held');f.pay('alice','paid');f.pay('alice','paid');
  assert.equal(f.state('alice').state,'confirmed');
  assert.throws(()=>f.sql.prepare("UPDATE app_records SET value='{}' WHERE collection='slots'").run(),/capacity/);
  assert.throws(()=>f.sql.prepare("DELETE FROM app_records WHERE collection='slots'").run(),/active bookings/);
  f.pay('alice','refunded');assert.equal(f.state('alice').state,'released');await f.hold('bob');
  assert.deepEqual(f.sql.prepare("SELECT type FROM studio_events WHERE id LIKE 'booking:alice:%' ORDER BY id").all().map(x=>x.type),['booking.held','booking.confirmed','booking.released']);
  assert.equal(JSON.parse(f.sql.prepare("SELECT value FROM app_records WHERE id='alice'").get().value).state,'released');
});
test('expiry after paid cannot release the confirmed seat; expiry before payment releases the hold',async t=>{
  const f=fixture(t);f.slot('morning',1);await f.hold('alice');f.pay('alice','paid');f.pay('alice','expired');
  assert.equal(f.state('alice').state,'confirmed');await assert.rejects(f.hold('bob'),/capacity/);
  f.slot('afternoon',1);await f.hold('carol','afternoon');f.pay('carol','expired');assert.equal(f.state('carol').state,'released');await f.hold('dave','afternoon');
});
test('staff move is versioned and cannot overbook or lose the original seat',async t=>{
  const f=fixture(t);f.slot('morning',1);f.slot('afternoon',1);await f.hold('alice');await f.hold('bob','afternoon');
  const move = version => moveBooking(f.env,{app:'tuning',collection:'bookings',id:'alice',slot:'afternoon',version});
  await assert.rejects(move(1),/capacity/);assert.equal(f.state('alice').slot,'morning');f.pay('bob','failed');
  assert.equal(await move(1),true);assert.equal(await move(1),false);assert.equal(f.state('alice').slot,'afternoon');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='booking.moved'").get().n,1);
});
