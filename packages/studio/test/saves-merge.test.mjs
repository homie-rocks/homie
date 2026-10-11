/**
 * A guest signs in to an account that already exists: their saves are combined per key, never dropped
 * (saves/SAVES.md, "When a guest signs in to their account").
 *
 *   - the playtest case: a guest with 4 verified matches signs in to an account with 3 (one shared) and has 6;
 *   - every declared rule (mergeSaves), a game's own function, key patterns, stats;
 *   - the default: equal values, server records joined, anything else kept by the account AND reported;
 *   - exactly once: one transaction, guarded against a room writing in between, retried, and a record that lands
 *     late for the guest's id follows them to the account;
 *   - a studio that declares nothing, with no key on both sides, runs the statements it always ran;
 *   - the whole HTTP sign-in with a software passkey, and the play shell raising the game's conflict.
 * The D1 is node:sqlite with the studio's own migrations; its batch is a real transaction.
 * Run: node --test packages/studio/test/saves-merge.test.mjs
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import vm from 'node:vm';
import worker, { mergeSaves } from '../worker/index.mjs';
import { PLAYERS_MIGRATION, resetLimits } from '../worker/players.mjs';
import { adoptGuest, adoptStatements, appendServerRecord, dropPlayerData, getSave, mergeSaves as mergeSavesHere, playerData, readPlayerStats, SAVE_LIMITS, savesSummary, writeSaves, bumpPlayerStats } from '../worker/saves.mjs';
import { SAVES_SHELL_JS } from '../worker/saves-shell.mjs';
import { STATS_MIGRATION } from '../worker/stats.mjs';
import { studioFiles } from '../lib/scaffold.mjs';

const G = 'pl_guest'; const A = 'pl_account'; const GAME = 'night-run';

/** A D1 on node:sqlite. `batch` is a transaction, as D1's is; `log` lists every statement that ran. */
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(studioFiles({ name: 'Owls', slug: 'owls', homie: 'https://homie.test' })['site/migrations/0001_studio.sql']);
  sql.exec(STATS_MIGRATION);
  sql.exec(PLAYERS_MIGRATION);
  const log = [];
  const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));
  const stmt = (query, args = []) => ({
    query, args,
    bind: (...a) => stmt(query, norm(a)),
    first: async () => { log.push(query); return sql.prepare(query).get(...args) ?? null; },
    all: async () => { log.push(query); return { results: sql.prepare(query).all(...args), success: true }; },
    run: async () => { log.push(query); const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  const DB = {
    sql, log, batches: [], beforeBatch: null,
    prepare: (q) => stmt(q),
    batch: async (list) => {
      if (DB.beforeBatch) await DB.beforeBatch(list);
      DB.batches.push(list.length);
      sql.exec('BEGIN');
      try {
        const out = list.map((s) => { log.push(s.query); return { results: sql.prepare(s.query).all(...s.args), success: true }; });
        sql.exec('COMMIT');
        return out;
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
  const now = Date.now();
  sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 0, 1, 0, ?, ?)').run(G, 'Quiet Otter', now, now);
  sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, 0, 0, ?, ?)').run(A, 'Cass', now, now);
  return { sql, env: { DB }, DB };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    put: async (k, v) => { objects.set(k, String(v)); },
    get: async (k) => (objects.has(k) ? { text: async () => objects.get(k) } : null),
    delete: async (k) => { for (const x of [].concat(k)) objects.delete(x); },
  };
}

/** Put one save in place, with the time it was written. */
function put(sql, player, key, value, { game = GAME, version = 1, at = 1000 } = {}) {
  const text = JSON.stringify(value);
  sql.prepare('INSERT OR REPLACE INTO saves (player, game, key, value, bytes, version, updated_at, blob) VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(player, game, key, text, Buffer.byteLength(text), version, at);
}
const row = (sql, player, key, game = GAME) => sql.prepare('SELECT * FROM saves WHERE player = ? AND game = ? AND key = ?').get(player, game, key) ?? null;
const valueAt = (sql, player, key, game = GAME) => { const r = row(sql, player, key, game); return r ? JSON.parse(r.value) : undefined; };
const match = (id, endedAt, extra = {}) => ({ id, endedAt, place: 1, won: true, ...extra });
const dump = (sql) => JSON.stringify([sql.prepare('SELECT * FROM saves ORDER BY player, game, key').all(), sql.prepare('SELECT * FROM player_stats ORDER BY player, game, name').all(), sql.prepare('SELECT * FROM memorials ORDER BY id').all()]);

test.beforeEach(() => { mergeSaves({}); resetLimits(); });

/* ------------------------------------------------------------------ the playtest finding */

test('the playtest case, nothing declared: a guest with 4 verified matches signs in to an account with 3 (one shared) and has 6', async () => {
  const { sql, env } = database();
  for (const [id, at] of [['m1', 10], ['m2', 20], ['m3', 30]]) await appendServerRecord(env, A, GAME, 'server:career-v1', match(id, at, { kills: 1 }));
  for (const [id, at] of [['m3', 30], ['m4', 40], ['m5', 50], ['m6', 60]]) await appendServerRecord(env, G, GAME, 'server:career-v1', match(id, at, { kills: 9 }));
  const before = row(sql, A, 'server:career-v1');
  const report = await adoptGuest(env, G, A);
  const after = row(sql, A, 'server:career-v1');
  const saved = JSON.parse(after.value);
  assert.deepEqual(saved.matches.map((m) => m.id), ['m6', 'm5', 'm4', 'm3', 'm2', 'm1'], 'six, newest first, none twice');
  assert.equal(saved.matches.find((m) => m.id === 'm3').kills, 1, 'on the same id the account\'s entry stays');
  assert.equal(saved.v, 1);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.bytes, Buffer.byteLength(after.value));
  assert.equal(after.blob, 0);
  assert.deepEqual(report.merged, [{ game: GAME, key: 'server:career-v1', rule: 'union', took: 'merged' }]);
  assert.deepEqual(report.kept, []);
  assert.equal(row(sql, G, 'server:career-v1'), null, 'the guest\'s row is gone');
  assert.equal((await getSave(env, A, GAME, 'server:career-v1')).value.matches.length, 6);
});

test('the default bound of a server record is its own: the newest 100 of the two', async () => {
  const { sql, env } = database();
  put(sql, A, 'server:career', { v: 1, matches: Array.from({ length: 80 }, (_, i) => match(`a${i}`, 1000 + i)) });
  put(sql, G, 'server:career', { v: 1, matches: Array.from({ length: 80 }, (_, i) => match(`g${i}`, 2000 + i)) });
  await adoptGuest(env, G, A);
  const list = valueAt(sql, A, 'server:career').matches;
  assert.equal(list.length, 100);
  assert.equal(list[0].id, 'g79');
  assert.equal(list.at(-1).id, 'a60', 'the oldest sixty of the account\'s fell off the end');
  for (let i = 1; i < list.length; i++) assert(list[i - 1].endedAt >= list[i].endedAt);
});

test('a joined record that would not fit a save drops its oldest entries until it does', async () => {
  const { sql, env } = database();
  const fat = 'x'.repeat(900);
  put(sql, A, 'server:career', { v: 1, matches: Array.from({ length: 50 }, (_, i) => match(`a${i}`, 1000 + i, { fat })) });
  put(sql, G, 'server:career', { v: 1, matches: Array.from({ length: 50 }, (_, i) => match(`g${i}`, 2000 + i, { fat })) });
  await adoptGuest(env, G, A);
  const r = row(sql, A, 'server:career');
  assert(r.bytes <= SAVE_LIMITS.valueBytes);
  const list = JSON.parse(r.value).matches;
  assert(list.length > 50 && list.length < 100);
  assert.equal(list[0].id, 'g49', 'the newest stayed');
});

/* ------------------------------------------------------------------ the default, with nothing declared */

test('nothing declared: equal values need nothing; another value stays the account\'s and the guest\'s is reported, not dropped', async () => {
  const { sql, env } = database();
  put(sql, A, 'hero', { level: 3 }, { version: 7 }); put(sql, G, 'hero', { level: 9 });
  put(sql, A, 'settings', { volume: 4, music: true }); put(sql, G, 'settings', { music: true, volume: 4 });
  put(sql, G, 'pet', 'owl', { version: 3, at: 555 });
  put(sql, A, 'badge', 'gold');
  const report = await adoptGuest(env, G, A);
  assert.deepEqual(valueAt(sql, A, 'hero'), { level: 3 });
  assert.equal(row(sql, A, 'hero').version, 7, 'the account\'s row is untouched');
  assert.deepEqual(report.kept, [{ game: GAME, key: 'hero', value: { level: 9 } }]);
  assert.deepEqual(report.merged, []);
  assert.equal(report.moved, 1);
  const pet = row(sql, A, 'pet');
  assert.deepEqual([pet.value, pet.version, pet.updated_at], ['"owl"', 3, 555], 'a key only the guest had moves over exactly as it was');
  assert.equal(valueAt(sql, A, 'badge'), 'gold');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM saves WHERE player = ? AND game != ''").get(G).n, 0);
});

test('nothing declared and no key on both sides: one read and the same five statements as ever', async () => {
  const { sql, env, DB } = database();
  put(sql, G, 'hero', { level: 2 }); put(sql, A, 'pet', 'cat');
  sql.prepare('INSERT INTO player_stats VALUES (?, ?, ?, ?, ?)').run(G, GAME, 'kills', 2, 1);
  DB.log.length = 0;
  const plan = await adoptStatements(env, G, A);
  assert.equal(DB.log.length, 1, 'one query to plan it');
  assert.equal(plan.statements.length, 5);
  const report = await adoptGuest(env, G, A);
  assert.deepEqual(DB.batches, [5]);
  assert.deepEqual(report, { merged: [], moved: 1, kept: [], stats: { merged: [], kept: [] } });
  assert.deepEqual(valueAt(sql, A, 'hero'), { level: 2 });
  assert.deepEqual(await readPlayerStats(env, A, GAME), { kills: 2 });
});

test('the kept values in the answer stop at 256 KiB: past that a key is named without its value', async () => {
  const { sql, env } = database();
  for (let i = 0; i < 6; i++) { put(sql, A, `slot-${i}`, 'mine'); put(sql, G, `slot-${i}`, 'y'.repeat(60_000)); }
  const { kept } = await adoptGuest(env, G, A);
  assert.equal(kept.length, 6);
  assert.equal(kept.filter((k) => 'value' in k).length, 4);
  assert.deepEqual(kept.filter((k) => k.truncated).map((k) => k.key), ['slot-4', 'slot-5']);
});

/* ------------------------------------------------------------------ declared rules */

test('every built-in rule', async () => {
  const { sql, env } = database();
  mergeSaves({ [GAME]: { saves: {
    keepA: 'account', keepG: 'guest', newG: 'newer', newA: 'newer', newTie: 'newer',
    bigG: 'larger', bigA: 'larger', smallG: 'smaller', lvl: { rule: 'larger', by: 'level' }, fast: { rule: 'smaller', by: 'ms' },
    coins: 'sum', bag: 'sum', list: { union: 'runs', by: 'run', order: 'at', keep: 3 }, plainList: { union: 'items', by: 'name' }, short: 'union',
    odd: 'larger', oddSum: 'sum', oddUnion: 'union',
  } } });
  const both = (key, a, g, at = {}) => { put(sql, A, key, a, { version: 4, at: at.a ?? 1000 }); put(sql, G, key, g, { version: 2, at: at.g ?? 1000 }); };
  both('keepA', 'a', 'g'); both('keepG', 'a', 'g');
  both('newG', 'a', 'g', { a: 10, g: 20 }); both('newA', 'a', 'g', { a: 20, g: 10 }); both('newTie', 'a', 'g');
  both('bigG', 3, 8); both('bigA', 8, 3); both('smallG', 90, 61);
  both('lvl', { level: 4, name: 'A' }, { level: 9, name: 'G' }); both('fast', { ms: 500, by: 'A' }, { ms: 700, by: 'G' });
  both('coins', 30, 12);
  both('bag', { gold: 5, name: 'A', gems: 1 }, { gold: 7, name: 'G', wood: 2, title: 'guest only' });
  both('list', { v: 2, runs: [{ run: 'r1', at: 1, who: 'A' }, { run: 'r2', at: 2 }] }, { runs: [{ run: 'r1', at: 1, who: 'G' }, { run: 'r3', at: 3 }, { run: 'r4', at: 4 }] });
  both('plainList', { items: [{ name: 'sword' }] }, { items: [{ name: 'bow' }, { name: 'sword', n: 2 }] });
  both('short', { v: 1, matches: [match('x', 5)] }, { v: 1, matches: [match('y', 9)] });
  both('odd', 'text', 4); both('oddSum', [1], [2]); both('oddUnion', { matches: 'no' }, { matches: [] });
  const report = await adoptGuest(env, G, A);
  const v = (k) => valueAt(sql, A, k);
  assert.equal(v('keepA'), 'a'); assert.equal(v('keepG'), 'g');
  assert.equal(v('newG'), 'g'); assert.equal(v('newA'), 'a'); assert.equal(v('newTie'), 'a', 'a tie is the account\'s');
  assert.equal(v('bigG'), 8); assert.equal(v('bigA'), 8); assert.equal(v('smallG'), 61);
  assert.deepEqual(v('lvl'), { level: 9, name: 'G' }, 'the whole object of the larger level');
  assert.deepEqual(v('fast'), { ms: 500, by: 'A' });
  assert.equal(v('coins'), 42);
  assert.deepEqual(v('bag'), { gold: 12, name: 'A', gems: 1, wood: 2, title: 'guest only' });
  assert.deepEqual(v('list'), { v: 2, runs: [{ run: 'r4', at: 4 }, { run: 'r3', at: 3 }, { run: 'r2', at: 2 }] }, 'joined by run, newest first, cut to keep');
  assert.deepEqual(v('plainList'), { items: [{ name: 'sword' }, { name: 'bow' }] }, 'no order: the account\'s entries, then the guest\'s new ones');
  assert.deepEqual(v('short').matches.map((m) => m.id), ['y', 'x']);
  // A rule that cannot apply falls to the default: the account's stays, and the guest's is reported with why.
  assert.equal(v('odd'), 'text'); assert.deepEqual(v('oddSum'), [1]); assert.deepEqual(v('oddUnion'), { matches: 'no' });
  assert.deepEqual(report.kept.map((k) => [k.key, k.value, k.rule]), [['odd', 4, 'larger'], ['oddSum', [2], 'sum'], ['oddUnion', { matches: [] }, 'union']]);
  assert(report.kept.every((k) => typeof k.error === 'string' && k.error));
  const took = Object.fromEntries(report.merged.map((m) => [m.key, `${m.rule}:${m.took}`]));
  assert.deepEqual(took, { keepA: 'account:account', keepG: 'guest:guest', newG: 'newer:guest', newA: 'newer:account', newTie: 'newer:account', bigG: 'larger:guest', bigA: 'larger:account', smallG: 'smaller:guest', lvl: 'larger:guest', fast: 'smaller:account', coins: 'sum:merged', bag: 'sum:merged', list: 'union:merged', plainList: 'union:merged', short: 'union:merged' });
  // Whatever was written is the account's version plus one; whatever stayed is untouched.
  for (const k of ['keepG', 'newG', 'bigG', 'coins', 'bag', 'list']) { const r = row(sql, A, k); assert.equal(r.version, 5, k); assert.equal(r.bytes, Buffer.byteLength(r.value), k); assert(r.updated_at > 1000, k); }
  for (const k of ['keepA', 'newA', 'bigA', 'fast', 'odd']) assert.equal(row(sql, A, k).version, 4, k);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM saves WHERE player = ? AND game != ''").get(G).n, 0);
});

test('a game\'s own function: plain, async, throwing, returning nothing, too large; it never fails the sign-in', async () => {
  const { sql, env } = database();
  const seen = [];
  mergeSaves({ [GAME]: { saves: {
    inventory: (guest, account, ctx) => { seen.push(ctx); guest.items.push('mutated'); return { items: [...new Set([...account.items, ...guest.items])].sort() }; },
    later: async (guest, account) => { await new Promise((r) => setTimeout(r, 2)); return guest + account; },
    boom: () => { throw new Error('no such field'); },
    nothing: () => undefined,
    huge: () => 'z'.repeat(SAVE_LIMITS.valueBytes + 1),
    same: (guest, account) => account,
  } } });
  put(sql, A, 'inventory', { items: ['axe', 'rope'] }, { version: 3, at: 50 }); put(sql, G, 'inventory', { items: ['rope', 'torch'] }, { version: 8, at: 70 });
  for (const k of ['later', 'boom', 'nothing', 'huge', 'same']) { put(sql, A, k, 1); put(sql, G, k, 2); }
  const report = await adoptGuest(env, G, A);
  assert.deepEqual(valueAt(sql, A, 'inventory'), { items: ['axe', 'mutated', 'rope', 'torch'] });
  assert.deepEqual(seen, [{ game: GAME, key: 'inventory', guest: { updatedAt: 70, version: 8 }, account: { updatedAt: 50, version: 3 } }]);
  assert.equal(valueAt(sql, A, 'later'), 3);
  for (const k of ['boom', 'nothing', 'huge', 'same']) assert.equal(valueAt(sql, A, k), 1, k);
  assert.deepEqual(report.kept.map((k) => [k.key, k.value, k.rule]), [['boom', 2, 'function'], ['huge', 2, 'function'], ['nothing', 2, 'function']]);
  assert.match(report.kept[0].error, /no such field/);
  assert.deepEqual(report.merged.map((m) => `${m.key}:${m.took}`), ['inventory:merged', 'later:merged', 'same:account']);
});

test('key patterns: the exact key beats a prefix, a longer prefix beats a shorter one, and rules are per game', async () => {
  const { sql, env } = database();
  mergeSaves({ [GAME]: { saves: { 'slot-*': 'account', 'slot-auto-*': 'guest', 'slot-auto-1': 'sum', '*': 'larger' } }, other: { saves: { n: 'sum' } } });
  for (const k of ['slot-1', 'slot-auto-1', 'slot-auto-2', 'score']) { put(sql, A, k, 10); put(sql, G, k, 20); }
  put(sql, A, 'n', 10, { game: 'other' }); put(sql, G, 'n', 20, { game: 'other' });
  put(sql, A, 'n', 10, { game: 'third' }); put(sql, G, 'n', 20, { game: 'third' });
  const report = await adoptGuest(env, G, A);
  assert.deepEqual([valueAt(sql, A, 'slot-1'), valueAt(sql, A, 'slot-auto-1'), valueAt(sql, A, 'slot-auto-2'), valueAt(sql, A, 'score')], [10, 30, 20, 20]);
  assert.equal(valueAt(sql, A, 'n', 'other'), 30);
  assert.equal(valueAt(sql, A, 'n', 'third'), 10, 'a game with no rules keeps the default');
  assert.deepEqual(report.kept, [{ game: 'third', key: 'n', value: 20 }]);
});

test('a rule that is not a rule is refused when the Worker loads, by name', () => {
  assert.throws(() => mergeSaves({ [GAME]: { saves: { hero: 'biggest' } } }), /night-run\.saves\['hero'\] is not a rule/);
  assert.throws(() => mergeSaves({ [GAME]: { stats: { kills: 'union' } } }), /night-run\.stats\['kills'\] is not a rule/);
  assert.throws(() => mergeSaves({ [GAME]: { stats: { kills: () => 1 } } }), /not a rule/);
  assert.equal(mergeSaves({ a: { saves: { x: 'sum' } }, b: {} }), 2);
  assert.equal(mergeSaves(null), 0);
  assert.equal(mergeSaves, mergeSavesHere, 'the Worker entry exports the same function');
});

/* ------------------------------------------------------------------ stats */

test('stats: sum, larger, smaller, guest, account by name or prefix; with no rule the account\'s number stays and the guest\'s is reported', async () => {
  const { sql, env } = database();
  mergeSaves({ [GAME]: { stats: { kills: 'sum', level: 'larger', 'best-time': 'smaller', 'last-*': 'guest', 'last-seen': 'account', deaths: 'sum' } } });
  await bumpPlayerStats(env, A, GAME, { add: { kills: 10, level: 7, 'best-time': 80, 'last-map': 1, 'last-seen': 5, plain: 3, equal: 4, onlyA: 1 } });
  await bumpPlayerStats(env, G, GAME, { add: { kills: 2, level: 4, 'best-time': 61, 'last-map': 9, 'last-seen': 6, plain: 8, equal: 4, onlyG: 6, deaths: 5 } });
  await bumpPlayerStats(env, A, 'other', { add: { kills: 1 } }); await bumpPlayerStats(env, G, 'other', { add: { kills: 5 } });
  const report = await adoptGuest(env, G, A);
  assert.deepEqual(await readPlayerStats(env, A, GAME), { 'best-time': 61, deaths: 5, equal: 4, kills: 12, 'last-map': 9, 'last-seen': 5, level: 7, onlyA: 1, onlyG: 6, plain: 3 });
  assert.deepEqual(await readPlayerStats(env, A, 'other'), { kills: 1 });
  assert.deepEqual(report.stats.merged.map((s) => `${s.name}:${s.rule}`).sort(), ['best-time:smaller', 'kills:sum', 'last-map:guest', 'last-seen:account', 'level:larger']);
  assert.deepEqual(report.stats.kept.sort((a, b) => a.game.localeCompare(b.game)), [{ game: GAME, name: 'plain', value: 8 }, { game: 'other', name: 'kills', value: 5 }]);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM player_stats WHERE player = ?').get(G).n, 0);
});

/* ------------------------------------------------------------------ exactly once, and races */

test('exactly once: the adoption\'s statements a second time, or a second adoption, change nothing', async () => {
  const { sql, env, DB } = database();
  mergeSaves({ [GAME]: { saves: { coins: 'sum' }, stats: { kills: 'sum' } } });
  put(sql, A, 'coins', 30); put(sql, G, 'coins', 12); put(sql, G, 'pet', 'owl');
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1)); await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
  await bumpPlayerStats(env, A, GAME, { add: { kills: 10 } }); await bumpPlayerStats(env, G, GAME, { add: { kills: 2 } });
  sql.prepare('INSERT INTO memorials (player, game, character, player_name, summary, at) VALUES (?, ?, ?, ?, ?, ?)').run(G, GAME, 'Brann', 'Quiet Otter', '{}', 5);
  const plan = await adoptStatements(env, G, A);
  await DB.batch(plan.statements);
  assert.equal(valueAt(sql, A, 'coins'), 42);
  assert.deepEqual(await readPlayerStats(env, A, GAME), { kills: 12 });
  assert.equal(sql.prepare('SELECT player FROM memorials').get().player, A);
  const once = dump(sql);
  // The same statements again: the guard sees rows that are no longer the ones it was computed from.
  await assert.rejects(DB.batch(plan.statements), /malformed JSON/);
  assert.equal(dump(sql), once, 'the failed batch wrote nothing');
  // A second adoption of the same (now empty) guest.
  const again = await adoptGuest(env, G, A);
  assert.deepEqual([again.merged, again.moved, again.kept], [[], 0, []]);
  assert.equal(dump(sql), once);
  assert.equal(valueAt(sql, A, 'server:career').matches.length, 2);
});

test('the guard: a write to either player between the read and the batch fails the whole batch, and nothing is written', async () => {
  for (const who of [A, G]) {
    const { sql, env, DB } = database();
    await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1)); await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
    put(sql, G, 'pet', 'owl');
    const plan = await adoptStatements(env, G, A);
    await appendServerRecord(env, who, GAME, 'server:career', match('m3', 3));
    const before = dump(sql);
    // The sign-in's own write is in the same transaction: it is rolled back too.
    const own = env.DB.prepare('UPDATE players SET seen_at = 42 WHERE id = ?1').bind(A);
    await assert.rejects(DB.batch([own, ...plan.statements]), /malformed JSON/);
    assert.equal(dump(sql), before);
    assert.notEqual(sql.prepare('SELECT seen_at FROM players WHERE id = ?').get(A).seen_at, 42);
    assert.equal(valueAt(sql, G, 'pet'), 'owl', 'the guest still has everything');
  }
});

test('the guard: a key the account gains in between (a new clash) fails the batch too', async () => {
  const { sql, env, DB } = database();
  await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
  const plan = await adoptStatements(env, G, A);
  assert.equal(plan.statements.length, 5, 'no clash was read: no separate guard statement');
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1));
  await assert.rejects(DB.batch(plan.statements), /malformed JSON/);
  assert.equal(valueAt(sql, G, 'server:career').matches.length, 1);
  assert.equal(row(sql, G, 'server:moved', ''), null);
});

test('a room writes a record to the account while the guest signs in: the batch is retried and the record is in the result', async () => {
  const { sql, env, DB } = database();
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1)); await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
  let hit = 0;
  DB.beforeBatch = async () => { if (hit++ === 0) { DB.beforeBatch = null; await appendServerRecord(env, A, GAME, 'server:career', match('m3', 3)); DB.beforeBatch = null; } };
  const tried = [];
  const report = await adoptGuest(env, G, A, (statements) => { tried.push(statements.length); return statements; });
  assert.equal(tried.length, 2, 'read, guarded, read again');
  assert.deepEqual(valueAt(sql, A, 'server:career').matches.map((m) => m.id), ['m3', 'm2', 'm1']);
  assert.equal(report.fallback, undefined);
  assert.equal(report.merged.length, 1);
});

test('a record lands for the guest while they sign in (no clash was read): the retry joins it', async () => {
  const { sql, env, DB } = database();
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1));
  let hit = 0;
  DB.beforeBatch = async () => { if (hit++ === 0) await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2)); };
  await adoptGuest(env, G, A);
  assert.equal(hit, 2);
  assert.deepEqual(valueAt(sql, A, 'server:career').matches.map((m) => m.id), ['m2', 'm1']);
});

test('writes that never stop: after a few tries the plain statements run, the sign-in is not refused, and the answer says so', async () => {
  const { sql, env, DB } = database();
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1)); await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
  put(sql, A, 'hero', 'a'); put(sql, G, 'hero', 'g'); put(sql, G, 'pet', 'owl');
  let n = 0;
  DB.beforeBatch = async () => { n++; await appendServerRecord(env, A, GAME, 'server:career', match(`late-${n}`, 10 + n)); };
  const report = await adoptGuest(env, G, A);
  assert.equal(n, 4);
  assert.equal(report.fallback, true);
  assert.deepEqual(report.merged, []);
  assert.deepEqual(report.kept.map((k) => k.key), ['hero', 'server:career']);
  assert.deepEqual(report.kept[1].value.matches.map((m) => m.id), ['m2'], 'what the account did not take is still in the answer');
  assert.equal(valueAt(sql, A, 'pet'), 'owl');
  assert.equal(JSON.parse(row(sql, G, 'server:moved', '').value).to, A);
});

test('an error that is not the guard\'s is not retried', async () => {
  const { env, DB } = database();
  let n = 0;
  await assert.rejects(adoptGuest(env, G, A, (statements) => { n++; return [...statements, DB.prepare('INSERT INTO no_such_table VALUES (1)')]; }), /no such table/);
  assert.equal(n, 1);
});

/* ------------------------------------------------------------------ a record that lands late */

test('a record written for the guest\'s id after they signed in lands in the account, once, at the cost it always had', async () => {
  const { sql, env, DB } = database();
  await appendServerRecord(env, A, GAME, 'server:career', match('m1', 1)); await appendServerRecord(env, G, GAME, 'server:career', match('m2', 2));
  DB.log.length = 0;
  await appendServerRecord(env, A, GAME, 'server:career', match('m1b', 1.5));
  assert.equal(DB.log.length, 2, 'one read and one write, as before');
  DB.log.length = 0;
  await appendServerRecord(env, 'pl_new', GAME, 'server:career', match('n1', 1));
  assert.equal(DB.log.length, 2, 'a first record too');
  await adoptGuest(env, G, A);
  const forward = row(sql, G, 'server:moved', '');
  assert.equal(JSON.parse(forward.value).to, A);
  assert(JSON.parse(forward.value).at > 0);
  await appendServerRecord(env, G, GAME, 'server:career', match('m9', 9));
  await appendServerRecord(env, G, GAME, 'server:career', match('m9', 9, { kills: 99 }));
  await appendServerRecord(env, G, GAME, 'server:other', match('o1', 1));
  assert.deepEqual(valueAt(sql, A, 'server:career').matches.map((m) => m.id), ['m9', 'm2', 'm1b', 'm1']);
  assert.deepEqual(valueAt(sql, A, 'server:other').matches.map((m) => m.id), ['o1'], 'a key the account never had');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM saves WHERE player = ? AND game != ''").get(G).n, 0, 'nothing is left under the guest\'s id');
});

test('a record whose write races the sign-in is not left under the guest\'s id', async () => {
  const { sql, env, DB } = database();
  // The room read (the guest had no record and no forwarding row), then the sign-in finished, then the room wrote.
  const real = DB.prepare;
  let raced = false;
  DB.prepare = (q) => {
    const s = real(q);
    if (!/^INSERT INTO saves\(/.test(q) || raced) return s;
    return { ...s, bind: (...a) => { const b = s.bind(...a); return { ...b, first: async () => { raced = true; await adoptGuest(env, G, A); return b.first(); } }; } };
  };
  await appendServerRecord(env, G, GAME, 'server:career', match('m1', 1));
  assert(raced);
  assert.equal(row(sql, G, 'server:career'), null);
  assert.deepEqual(valueAt(sql, A, 'server:career').matches.map((m) => m.id), ['m1']);
});

test('a forwarding row that points nowhere useful is an error for the outbox to retry, never a loop', async () => {
  const { sql, env } = database();
  put(sql, 'pl_x', 'server:moved', { to: 'pl_y', at: 1 }, { game: '' }); put(sql, 'pl_y', 'server:moved', { to: 'pl_x', at: 1 }, { game: '' });
  await assert.rejects(appendServerRecord(env, 'pl_x', GAME, 'server:career', match('m1', 1)), /forwarding/);
  await assert.rejects(appendServerRecord(env, 'pl_x', '', 'server:moved', match('m1', 1)), /invalid server record/);
});

test('the forwarding rows are nobody\'s save: not in an export or a summary, and deleting the account removes them', async () => {
  const { sql, env } = database();
  put(sql, G, 'hero', 1);
  await adoptGuest(env, G, A);
  assert.equal(JSON.parse(row(sql, G, 'server:moved', '').value).to, A);
  assert.notEqual(row(sql, A, `server:from:${G}`, ''), null);
  assert.deepEqual(Object.keys(await playerData(env, A)), [GAME]);
  assert.deepEqual((await savesSummary(env, A)).map((g) => g.game), [GAME]);
  // A browser cannot reach either row: a save's game is one of the studio's, and `server:` keys are refused.
  assert.equal((await writeSaves(env, A, '', { set: [{ key: `server:from:${G}`, value: 0 }] })).results[0].error, 'authority');
  const data = await dropPlayerData(env, A);
  await env.DB.batch(data.statements);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM saves').get().n, 0, 'no row is left pointing at the deleted account');
});

/* ------------------------------------------------------------------ large saves (R2) */

test('large saves: the guest\'s object is kept when its row wins, both go when a merged value fits D1, the guest\'s goes when the account\'s stays', async () => {
  const { sql, env } = database();
  env.MEDIA = fakeR2();
  mergeSaves({ [GAME]: { saves: { world: 'guest', tally: 'sum', map: 'account', atlas: 'newer' } } });
  const big = (tag) => ({ tag, pad: 'p'.repeat(SAVE_LIMITS.valueBytes + 10) });
  for (const [player, tag] of [[A, 'a'], [G, 'g']]) {
    const r = await writeSaves(env, player, GAME, { set: [{ key: 'world', value: big(tag) }, { key: 'map', value: big(tag) }, { key: 'atlas', value: big(tag) }] });
    assert(r.results.every((x) => x.ok));
  }
  // `tally`: a large value on the guest's side whose sum fits D1.
  await writeSaves(env, A, GAME, { set: [{ key: 'tally', value: { n: 1 } }] });
  await env.MEDIA.put('players/guesttallyobject0000', JSON.stringify({ n: 2 }));
  sql.prepare("INSERT INTO saves (player, game, key, value, bytes, version, updated_at, blob) VALUES (?, ?, 'tally', 'r2:players/guesttallyobject0000', 7, 1, 1, 1)").run(G, GAME);
  assert.equal(env.MEDIA.objects.size, 7);
  sql.prepare("UPDATE saves SET updated_at = CASE player WHEN ? THEN 9 ELSE 5 END WHERE key = 'atlas'").run(A);
  const guestWorld = row(sql, G, 'world').value;
  const accountMap = row(sql, A, 'map').value;
  const accountAtlas = row(sql, A, 'atlas').value;
  await adoptGuest(env, G, A);
  assert.equal(row(sql, A, 'world').value, guestWorld, 'the guest\'s row, object and all');
  assert.equal((await getSave(env, A, GAME, 'world')).value.tag, 'g');
  assert.deepEqual([row(sql, A, 'tally').value, row(sql, A, 'tally').blob], ['{"n":3}', 0]);
  assert.equal(row(sql, A, 'map').value, accountMap);
  assert.equal(row(sql, A, 'atlas').value, accountAtlas, 'the newer of the two was the account\'s');
  assert.deepEqual([...env.MEDIA.objects.keys()].sort(), [guestWorld, accountMap, accountAtlas].map((v) => v.slice(3)).sort(), 'every object no row points at is gone');
});

/* ------------------------------------------------------------------ the whole sign-in over HTTP */

const ORIGIN = 'https://storm.example';
const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? enc.encode(b) : b));
const CATALOGUE = { studio: { name: 'Owls', slug: 'owls', theme: {} }, games: [{ id: GAME, name: 'Night Run', players: { min: 1, max: 8 }, saves: true, landing: { hero: {}, credits: { people: [] } } }], songs: [], videos: [], posts: [], site: { pages: [], partials: {} } };

function browser(env, ip) {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/604.1', 'cf-connecting-ip': ip, ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) };
    if (method !== 'GET') { headers.origin = ORIGIN; headers['content-type'] = 'application/json'; }
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [k, v] = c.split(';')[0].split('='); if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v); }
    return { status: res.status, body: await res.json() };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}) };
}

function cbor(v) {
  const head = (major, n) => (n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'string') { const b = enc.encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  const parts = [Uint8Array.from(head(5, v.size))]; for (const [k, x] of v) parts.push(cbor(k), cbor(x));
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}
function rawToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = [...b.slice(i)]; if (v[0] & 0x80) v = [0, ...v]; return [0x02, v.length, ...v]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
/** One passkey in software (WebCrypto P-256), as test/players.test.mjs makes it. */
async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const id = crypto.getRandomValues(new Uint8Array(16));
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const rp = await sha('storm.example');
  return {
    async create(options) {
      const client = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]);
      const authData = Uint8Array.from([...rp, 0x01 | 0x04 | 0x08 | 0x10 | 0x40, 0, 0, 0, 0, ...new Uint8Array(16), 0, id.length, ...id, ...cbor(cose)]);
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(client), attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] } };
    },
    async get(options) {
      const client = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
      const authData = Uint8Array.from([...rp, 0x01 | 0x04 | 0x08 | 0x10, 0, 0, 0, 0]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Uint8Array.from([...authData, ...await sha(client)])));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(client), authenticatorData: b64u(authData), signature: b64u(rawToDer(raw)), userHandle: null } };
    },
  };
}

test('over HTTP, with a passkey: the guest signs in, the answer says what happened to every key, and a second sign-in changes nothing', async () => {
  const { sql, env, DB } = database();
  sql.exec('DELETE FROM players');
  env.STUDIO_NAME = 'Storm';
  env.ASSETS = { fetch: async (req) => (new URL(req.url).pathname === '/games.json' ? Response.json(CATALOGUE) : new Response('missing', { status: 404 })) };
  mergeSaves({ [GAME]: { saves: { coins: 'sum' }, stats: { kills: 'sum' } } });
  const key = await authenticator();
  const home = browser(env, '198.51.100.7');
  const o = await home.post('/api/player/signup/options');
  const up = await home.post('/api/player/signup', { credential: await key.create(o.body.options), name: 'Cass' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const account = up.body.player.id;
  await home.post(`/api/player/saves/${GAME}`, { set: [{ key: 'coins', value: 30 }, { key: 'hero', value: 'account hero' }] });
  await home.post(`/api/player/stats/${GAME}`, { add: { kills: 10 } });
  for (const [id, at] of [['m1', 10], ['m2', 20], ['m3', 30]]) await appendServerRecord(env, account, GAME, 'server:career-v1', match(id, at));

  const cafe = browser(env, '192.0.2.44');
  await cafe.post(`/api/player/saves/${GAME}`, { set: [{ key: 'coins', value: 12 }, { key: 'hero', value: 'guest hero' }, { key: 'pet', value: 'owl' }] });
  await cafe.post(`/api/player/stats/${GAME}`, { add: { kills: 2, fished: 4 } });
  const guest = (await cafe.get('/api/player/me')).body.player.id;
  for (const [id, at] of [['m3', 30], ['m4', 40], ['m5', 50], ['m6', 60]]) await appendServerRecord(env, guest, GAME, 'server:career-v1', match(id, at));

  const signIn = async (b) => { const so = await b.post('/api/player/signin/options'); return b.post('/api/player/signin', { credential: await key.get(so.body.options) }); };
  DB.batches.length = 0;
  const inn = await signIn(cafe);
  assert.equal(inn.status, 200, JSON.stringify(inn.body));
  assert.equal(inn.body.ok, true);
  assert.equal(inn.body.adoptedGuest, true);
  assert.equal(inn.body.player.id, account);
  assert.deepEqual(inn.body.adopted, {
    merged: [{ game: GAME, key: 'coins', rule: 'sum', took: 'merged' }, { game: GAME, key: 'server:career-v1', rule: 'union', took: 'merged' }],
    moved: 1,
    kept: [{ game: GAME, key: 'hero', value: 'guest hero' }],
    stats: { merged: [{ game: GAME, name: 'kills', rule: 'sum' }], kept: [] },
  });
  const saves = Object.fromEntries((await cafe.get(`/api/player/saves/${GAME}?values=1`)).body.keys.map((k) => [k.key, k.value]));
  assert.equal(saves.coins, 42);
  assert.equal(saves.hero, 'account hero');
  assert.equal(saves.pet, 'owl');
  assert.deepEqual(saves['server:career-v1'].matches.map((m) => m.id), ['m6', 'm5', 'm4', 'm3', 'm2', 'm1']);
  assert.deepEqual((await cafe.get(`/api/player/stats/${GAME}`)).body.stats, { fished: 4, kills: 12 });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM players WHERE id = ?').get(guest).n, 0, 'the guest is gone');
  // The round that ended a moment before the sign-in writes its record a moment after, under the guest's id.
  await appendServerRecord(env, guest, GAME, 'server:career-v1', match('m7', 70));
  assert.equal((await cafe.get(`/api/player/saves/${GAME}/server%3Acareer-v1`)).body.value.matches[0].id, 'm7');
  // Signing in again (already the account) adopts nobody and changes nothing.
  const state = dump(sql);
  const again = await signIn(cafe);
  assert.equal(again.body.adoptedGuest, false);
  assert.equal('adopted' in again.body, false);
  assert.equal(dump(sql), state);
  // The player's export has their games and nothing of the bookkeeping.
  assert.deepEqual(Object.keys((await cafe.get('/api/player/export')).body.games ?? {}), [GAME]);
});

/* ------------------------------------------------------------------ the play shell: the game hears the conflict */

/** The play shell in a bare page: a frame to post to, localStorage, fetch answered by `answer(method, path, body)`. */
function shellPage(answer) {
  const posted = []; const store = new Map(); const made = []; let onMessage = null;
  const el = (tag) => { const e = { tag, children: [], append(...c) { e.children.push(...c); }, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, focus() {} }; made.push(e); return e; };
  const frame = { contentWindow: { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) }, focus() {} };
  const win = {
    __HOMIE_PLAY: { game: GAME, embed: false }, PublicKeyCredential: null,
    addEventListener: (ev, fn) => { if (ev === 'message') onMessage = fn; },
  };
  const requests = [];
  const sandbox = {
    window: win, document: { querySelector: (q) => (q === 'iframe.game' ? frame : null), createElement: el, body: el('body'), addEventListener() {}, visibilityState: 'visible' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { onLine: true, credentials: { get: async () => ({ id: 'cred', rawId: new ArrayBuffer(1), type: 'public-key', response: { clientDataJSON: new ArrayBuffer(1), authenticatorData: new ArrayBuffer(1), signature: new ArrayBuffer(1), userHandle: null } }) } },
    location: { pathname: `/${GAME}/play`, search: '', hostname: 'storm.example', href: '' },
    fetch: async (path, init) => { const body = init.body ? JSON.parse(init.body) : undefined; requests.push({ method: init.method, path, body }); const j = await answer(init.method, path, body); return { status: j.status ?? 200, json: async () => j }; },
    addEventListener() {}, setTimeout, clearTimeout, atob, btoa, Promise, JSON, Object, Date, Math, String, Number, Array, Uint8Array, AbortController, console,
  };
  sandbox.window.top = sandbox.window;
  vm.runInNewContext(SAVES_SHELL_JS, sandbox);
  return {
    posted, requests, made, win,
    say: (m) => onMessage({ source: frame.contentWindow, data: { t: 'homie-save', ...m } }),
  };
}
const settle = async (ms = 30) => { await new Promise((r) => setTimeout(r, ms)); };

async function signInThroughShell({ resolver, adopted }) {
  let who = { id: G, name: 'Quiet Otter', guest: true, owner: false };
  const cloud = { [G]: { hero: { value: { level: 9 }, version: 2 }, 'server:career': { value: { matches: [] }, version: 1 } }, [A]: { hero: { value: { level: 3 }, version: 7 }, 'server:career': { value: { matches: [] }, version: 4 } } };
  const page = shellPage((method, path, body) => {
    if (path === `/api/player/saves/${GAME}?values=1`) return { ok: true, player: who, keys: Object.entries(cloud[who.id]).map(([key, k]) => ({ key, value: k.value, version: k.version, updatedAt: 1 })) };
    if (path === '/api/player/signin/options' || path === '/api/player/signup/options') return { ok: true, options: { challenge: 'AAAA', rpId: 'storm.example' } };
    if (path === '/api/player/signin') { who = { id: A, name: 'Cass', guest: false, owner: false }; return { ok: true, player: who, adoptedGuest: true, adopted }; }
    if (method === 'POST' && path === `/api/player/saves/${GAME}`) return { ok: true, results: body.set.map((s) => { const cur = cloud[who.id][s.key]; if (s.base !== cur.version) return { key: s.key, ok: false, error: 'conflict', current: cur }; cur.value = s.value; cur.version++; return { key: s.key, ok: true, version: cur.version }; }) };
    return { ok: false, error: 'path', status: 404 };
  });
  await settle();
  page.say({ q: 1, op: 'hello', resolver });
  await settle();
  page.say({ q: 2, op: 'signin' });
  const button = page.made.find((e) => e.textContent === 'I have one: sign in');
  assert(button, 'the sign-in sheet is up');
  button.onclick();
  await settle(60);
  return { page, cloud };
}
const KEPT = { merged: [], moved: 0, stats: { merged: [], kept: [] }, kept: [{ game: GAME, key: 'hero', value: { level: 9 } }, { game: GAME, key: 'server:career', value: { matches: [] } }, { game: 'another-game', key: 'hero', value: 1 }] };

test('the play shell, a game with onConflict: the kept key is an ordinary conflict, and the game\'s answer is written on the account\'s version', async () => {
  const { page, cloud } = await signInThroughShell({ resolver: true, adopted: KEPT });
  const conflicts = page.posted.filter((m) => m.ev === 'conflict');
  assert.equal(conflicts.length, 1, 'this game\'s key only, and never a server: key');
  assert.deepEqual({ key: conflicts[0].key, mine: conflicts[0].mine, theirs: conflicts[0].theirs, theirsVersion: conflicts[0].theirsVersion }, { key: 'hero', mine: { level: 9 }, theirs: { level: 3 }, theirsVersion: 7 });
  assert.equal(typeof conflicts[0].ask, 'number');
  const player = page.posted.findLast((m) => m.ev === 'player' && !m.same);
  assert.equal(player.player.id, A);
  assert(page.posted.indexOf(player) < page.posted.indexOf(conflicts[0]), 'the game knows who it is before it is asked');
  page.say({ op: 'resolve', ask: conflicts[0].ask, keep: 'value', value: { level: 9, merged: true } });
  await settle(60);
  const write = page.requests.findLast((r) => r.method === 'POST' && r.path === `/api/player/saves/${GAME}`);
  assert.deepEqual(write.body.set, [{ key: 'hero', value: { level: 9, merged: true }, base: 7 }]);
  assert.deepEqual(cloud[A].hero, { value: { level: 9, merged: true }, version: 8 });
  assert.equal(page.posted.findLast((m) => m.ev === 'conflict').kept, 'game');
});

test('the play shell, a game without onConflict: the account\'s stays and the game hears the conflict, kept: theirs', async () => {
  const { page, cloud } = await signInThroughShell({ resolver: false, adopted: KEPT });
  const conflicts = page.posted.filter((m) => m.ev === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.deepEqual({ key: conflicts[0].key, mine: conflicts[0].mine, theirs: conflicts[0].theirs, kept: conflicts[0].kept }, { key: 'hero', mine: { level: 9 }, theirs: { level: 3 }, kept: 'theirs' });
  assert.equal(page.requests.filter((r) => r.method === 'POST' && r.path === `/api/player/saves/${GAME}`).length, 0, 'nothing is written');
  assert.deepEqual(cloud[A].hero, { value: { level: 3 }, version: 7 });
});

test('the play shell: a kept key whose value was too large for the answer comes from this browser\'s own copy of the guest', async () => {
  const { page } = await signInThroughShell({ resolver: true, adopted: { ...KEPT, kept: [{ game: GAME, key: 'hero', truncated: true }] } });
  const conflict = page.posted.find((m) => m.ev === 'conflict');
  assert.deepEqual(conflict.mine, { level: 9 });
});
