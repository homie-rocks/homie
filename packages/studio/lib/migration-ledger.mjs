import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {readConfig} from './routes.mjs';
import {workerDir} from './studio.mjs';

/**
 * Reconcile Wrangler's migration ledger with a database that already has the schema.
 *
 * `wrangler d1 migrations apply` decides what to run from the ledger table (d1_migrations) alone. A database whose
 * schema was made some other way (provisioned in one batch from a template, restored from an export, or a ledger
 * that was lost) still lists those files as unapplied, and the first `ALTER TABLE … ADD COLUMN` stops the deploy on
 * "duplicate column name". Before applying, this works out what each migration file makes by running the studio's
 * own files, in order, on an empty in-memory SQLite (node:sqlite), and comparing the schema before and after each one:
 * tables, columns (PRAGMA table_info), indexes, triggers and views. It then reads the live schema the same way. An
 * unapplied file is recorded as applied only when everything it adds is already there and nothing it removes is; it
 * stops at the first file that is not (a file that only changes data, or a half-made schema), so Wrangler runs that one
 * and everything after it as usual. Nothing is guessed from the SQL text, and nothing in the studio's own tables is
 * changed. Any failure here leaves the ledger alone: `migrations apply` then behaves exactly as before.
 */

const OBJECTS = `SELECT 'table:'||m.name AS o FROM sqlite_master m WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'
UNION ALL SELECT 'column:'||m.name||'.'||p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'
UNION ALL SELECT m.type||':'||m.name FROM sqlite_master m WHERE m.type IN ('index','trigger','view') AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'`;
export const SCHEMA_OBJECTS_SQL = OBJECTS.replace(/\n/g, ' ');
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The studio's migration files, in Wrangler's order (by file name), with their SQL. */
export function migrationFiles(root, { config = readConfig(root) } = {}) {
  const db = config?.d1_databases?.[0];
  if (!db?.migrations_dir) return { table: db?.migrations_table ?? 'd1_migrations', files: [] };
  const dir = isAbsolute(db.migrations_dir) ? db.migrations_dir : join(workerDir(root), db.migrations_dir);
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })) : [];
  return { table: db.migrations_table ?? 'd1_migrations', files };
}

/**
 * What each file adds and removes, from running them in order on an empty database. The list ends at the first file
 * that does not run here (its effects, and those of every file after it, are unknown and never reconciled).
 */
export async function migrationEffects(files, { open = openMemory } = {}) {
  const db = await open();
  if (!db) return [];
  const effects = [];
  try {
    let before = schemaOf(db);
    for (const file of files) {
      try { db.exec(file.sql); } catch { break; }
      const after = schemaOf(db);
      effects.push({ name: file.name, adds: [...after].filter((o) => !before.has(o)), removes: [...before].filter((o) => !after.has(o)) });
      before = after;
    }
  } finally { try { db.close(); } catch { /* closed */ } }
  return effects;
}

/** The unapplied files whose schema is already all there, from the first unapplied file up to the first that is not. */
export function alreadyApplied({ effects, applied, live }) {
  const done = new Set(applied), have = new Set(live), out = [];
  for (const e of effects) {
    if (done.has(e.name)) continue;
    const changes = e.adds.length + e.removes.length;
    if (!changes || !e.adds.every((o) => have.has(o)) || e.removes.some((o) => have.has(o))) break;
    out.push(e.name);
  }
  return out;
}

/**
 * Before `migrations apply`: record the files the live database already has the schema of. `run(sql)` executes one
 * statement on the target database and resolves to its rows (or throws). Returns the names it recorded.
 */
export async function reconcileLedger({ files, table = 'd1_migrations', run, open = openMemory }) {
  if (!files.length || !NAME.test(table)) return [];
  // One read when nothing needs doing: the live schema, which also says whether the ledger table exists.
  const live = (await run(SCHEMA_OBJECTS_SQL)).map((r) => String(r.o));
  // A database with none of the schema yet (a new studio) has nothing to reconcile.
  if (!live.length) return [];
  const applied = live.includes(`table:${table}`) ? (await run(`SELECT name FROM ${table}`)).map((r) => String(r.name)) : [];
  if (files.every((f) => applied.includes(f.name))) return [];
  const names = alreadyApplied({ effects: await migrationEffects(files, { open }), applied, live });
  if (!names.length) return [];
  for (const n of names) if (!/^[\w.-]+\.sql$/.test(n)) throw new Error(`Unexpected migration file name ${n}`);
  // Wrangler's own ledger table, as `migrations apply` makes it.
  await run(`CREATE TABLE IF NOT EXISTS ${table}(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); ${names.map((n) => `INSERT OR IGNORE INTO ${table}(name) VALUES ('${n}');`).join(' ')}`);
  return names;
}

/** `wrangler d1 execute <db> --remote|--local --json --command <sql>` as rows; throws on a failed command. */
export function wranglerRows(w, database, where) {
  return async (sql) => {
    const r = w(['d1', 'execute', database, where, '--json', '--command', sql]);
    if (r.code !== 0) throw new Error(`d1 execute failed: ${String(r.out).slice(-300)}`);
    const text = r.stdout ?? r.out, start = text.indexOf('[');
    const parsed = JSON.parse(text.slice(start));
    return parsed.flatMap((x) => x?.results ?? []);
  };
}

/** The deploy step: reconcile, and say what happened. Never fails the deploy. */
export async function reconcileBeforeApply(root, w, database, { where = '--remote', step = () => {}, open = openMemory } = {}) {
  try {
    const { files, table } = migrationFiles(root);
    const names = await reconcileLedger({ files, table, run: wranglerRows(w, database, where), open });
    if (names.length) step(`recorded ${names.length} migration${names.length === 1 ? '' : 's'} the database already had the schema of (${names[0]}${names.length > 1 ? ` … ${names.at(-1)}` : ''})`);
    return names;
  } catch (error) {
    step(`migration ledger not checked (${String(error?.message ?? error).slice(0, 160)}); applying as usual`);
    return [];
  }
}

function schemaOf(db) {
  return new Set(db.prepare(SCHEMA_OBJECTS_SQL).all().map((r) => String(r.o)));
}

async function openMemory() {
  // node:sqlite needs Node 22.5+ (no flag from 22.13). Without it nothing is reconciled.
  const emit = process.emitWarning;
  try {
    process.emitWarning = (w, ...rest) => (/SQLite/i.test(String(w?.message ?? w)) ? undefined : emit.call(process, w, ...rest));
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(':memory:');
  } catch { return null; } finally { process.emitWarning = emit; }
}
