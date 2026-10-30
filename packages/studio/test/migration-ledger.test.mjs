import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {alreadyApplied,migrationEffects,reconcileBeforeApply,reconcileLedger} from '../lib/migration-ledger.mjs';

// The shape that broke deploys: the schema was made in one batch (as a template provision does), and the
// ledger does not list the files, so `migrations apply` replays an ADD COLUMN that is already there.
const files = [
  {name:'0001_base.sql', sql:'CREATE TABLE IF NOT EXISTS office_invites(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS shop_orders(id TEXT PRIMARY KEY);'},
  {name:'0006_servers.sql', sql:'ALTER TABLE office_invites ADD COLUMN server TEXT; CREATE INDEX office_invites_server ON office_invites(server);'},
  {name:'0007_seed.sql', sql:"CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES('a','b');"},
  {name:'0010_reservations.sql', sql:'ALTER TABLE shop_orders ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;'},
  {name:'0011_data.sql', sql:"UPDATE meta SET v='c';"},
  {name:'0012_more.sql', sql:'ALTER TABLE shop_orders ADD COLUMN note TEXT;'},
];
const provisioned = () => { const db = new DatabaseSync(':memory:'); for (const f of files.slice(0, 4)) db.exec(f.sql); return db; };
const runOn = (db) => async (sql) => { const s = sql.trim(); if (/^select/i.test(s)) return db.prepare(s).all(); db.exec(s); return []; };
// What `wrangler d1 migrations apply` does: run each file not in the ledger, in order, and record it.
const apply = (db) => { db.exec('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'); const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name)); for (const f of files) if (!done.has(f.name)) { db.exec(f.sql); db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(f.name); } };

test('without reconciling, a schema-first database fails on the duplicate column (the bug)', () => {
  assert.throws(() => apply(provisioned()), /duplicate column name: server/);
});

test('reconciling records the files whose schema exists, then migrations apply cleanly', async () => {
  const db = provisioned();
  const names = await reconcileLedger({files, run: runOn(db)});
  assert.deepEqual(names, ['0001_base.sql','0006_servers.sql','0007_seed.sql','0010_reservations.sql']);
  apply(db);
  assert.equal(db.prepare("SELECT v FROM meta").get().v, 'c'); // the data-only file after them still ran
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('shop_orders') WHERE name='note'").get());
});

test('a partly applied ledger: only the pending files already present are recorded', async () => {
  const db = provisioned();
  db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); INSERT INTO d1_migrations(name) VALUES ('0001_base.sql'),('0006_servers.sql')");
  assert.deepEqual(await reconcileLedger({files, run: runOn(db)}), ['0007_seed.sql','0010_reservations.sql']);
  apply(db);
});

test('nothing is recorded for an empty database, an up-to-date ledger, or a half-made migration', async () => {
  const empty = new DatabaseSync(':memory:');
  assert.deepEqual(await reconcileLedger({files, run: runOn(empty)}), []);
  apply(empty);
  assert.deepEqual(await reconcileLedger({files, run: runOn(empty)}), []);
  const effects = await migrationEffects(files);
  // 0006 adds a column and an index: with only the column there, it is left for Wrangler.
  assert.deepEqual(alreadyApplied({effects, applied:['0001_base.sql'], live:['table:office_invites','column:office_invites.id','column:office_invites.server']}), []);
  // A data-only file stops the run: it and everything after it are left to apply.
  assert.deepEqual(alreadyApplied({effects, applied:files.slice(0,4).map(f=>f.name), live:['column:shop_orders.note']}), []);
});

test('a file that does not run here ends what is known', async () => {
  const effects = await migrationEffects([files[0], {name:'0002_bad.sql', sql:'ALTER TABLE nope ADD COLUMN x;'}, files[1]]);
  assert.deepEqual(effects.map(e => e.name), ['0001_base.sql']);
});

test('the deploy step reads the migrations folder, uses d1 execute --json, and never fails the deploy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ledger-'));
  mkdirSync(join(root, 'migrations'));
  for (const f of files) writeFileSync(join(root, 'migrations', f.name), f.sql);
  writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify({name:'s', d1_databases:[{binding:'DB', database_name:'d', migrations_dir:'migrations'}]}));
  const db = provisioned(), calls = [];
  const w = (args) => { calls.push(args); const sql = args.at(-1).trim(); let rows = []; if (/^select/i.test(sql)) rows = db.prepare(sql).all(); else db.exec(sql); return {code:0, out:'', stdout:JSON.stringify([{results:rows, success:true}])}; };
  const steps = [];
  assert.equal((await reconcileBeforeApply(root, w, 'DB', {step: s => steps.push(s)})).length, 4);
  assert.ok(calls.every(a => a[0]==='d1' && a[1]==='execute' && a[2]==='DB' && a[3]==='--remote' && a[4]==='--json'));
  assert.match(steps[0], /recorded 4 migrations/);
  apply(db);
  const broken = () => ({code:1, out:'Authentication error', stdout:''});
  assert.deepEqual(await reconcileBeforeApply(root, broken, 'DB', {step: s => steps.push(s)}), []);
  assert.match(steps.at(-1), /applying as usual/);
});
