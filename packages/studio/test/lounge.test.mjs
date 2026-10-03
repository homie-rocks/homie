/**
 * @homie-rocks/studio 0.29.0: the Lounge and kept chat (chat/LOUNGE.md; worker/lounge.mjs, lounge-store.mjs,
 * lounge-page.mjs; NETPLAY.md section 19's `history`, `card`, `mine` and `unsay`).
 *
 *   - the rule: `history` is 0 unless an owner asks, clamped to 90 days, and 0 on a kids server, a capped room or chat
 *     off; an office key only ASKS to keep more; the build checks game.json's;
 *   - the relay: a room that keeps history hands each line (never a reaction) to the Table and each take-down too; its
 *     window is its days, not minutes; kept lines come back into the window once, never twice; a person takes their own
 *     line down (by account, or a guest's by browser) and nobody else's; a page's own lines say `mine` on its copy only;
 *     a card is a line with its link, title, studio, pitch and picture, held by the floor and the review like typing;
 *     a mute or kick from a kept line holds its sender's account;
 *   - the store: the migration applies twice; lines kept, paged, taken down, forgotten after their days, trimmed when an
 *     owner keeps fewer, a player's own exported and deleted with the account; play nights checked, listed in order,
 *     past ones gone; moderators are accounts, never guests;
 *   - studio.json "lounge": on, off, its fields, kids from a kids studio, never over a game called lounge;
 *   - the Worker: /lounge/ in the studio's own look with a Lounge tab; its socket carries a signed-in account's name and
 *     the owner's mark, and another site's page is nobody (it reacts, never types); a guest reacts and is asked to sign in
 *     to type; history from the office keeps lines in D1 and gives them back; "show what you made" makes a card from this
 *     studio's game and from another Homie studio's manifest, refuses a site that is not one, a guest and held words;
 *     reports, a person's own Delete, the keepers' Remove, Mute, Kick and slow mode (a moderator never on the owner);
 *     play nights and /lounge/api/now (CORS, rules, nights, rooms); the office's Lounge; a kids Lounge keeps nothing;
 *     deleting an account deletes its kept lines.
 * Run: node --test packages/studio/test/lounge.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHAT_LIMITS, chatProblems, checkChatRules, normalizeChat, windowMsOf } from '../worker/chat.mjs';
import { CHAT_MIGRATION_FILE } from '../worker/chat-store.mjs';
import {
  LOUNGE_CHAT, LOUNGE_LINES, LOUNGE_MIGRATION, LOUNGE_MIGRATION_FILE, addMod, addNight, checkNight, forgetLines, forgetPlayerHistory, historyOf, isMod,
  keepLines, keptLine, loungeConfig, loungeProblems, modsOf, nightsOf, playerHistory, removeMod, removeNight, trimHistory,
} from '../worker/lounge-store.mjs';
import { NetRoom } from '../worker/room.mjs';
import { OFFICE_MIGRATION_FILE, chatOpensUp } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { SERVERS_MIGRATION_FILE } from '../worker/servers.mjs';
import { LOUNGE_JS } from '../worker/lounge-page.mjs';
import { floor } from '../worker/chat.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-lounge-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DAY = 86_400_000;

/* ------------------------------------------------------------------ the rule */

test('history: nothing kept unless an owner asks, at most 90 days, never on a kids server, a capped room or chat off', () => {
  assert.equal(normalizeChat(null).history, 0);
  assert.equal(normalizeChat({ history: 14 }).history, 14);
  assert.equal(normalizeChat({ history: 400 }).history, CHAT_LIMITS.historyMax);
  assert.equal(normalizeChat({ history: -3 }).history, 0);
  assert.equal(normalizeChat({ history: 'many' }).history, 0);
  assert.equal(normalizeChat({ history: 14 }, { kids: true }).history, 0, 'a kids server keeps nothing');
  assert.equal(normalizeChat({ history: 14, mode: 'text' }, { speech: 'lines' }).history, 0, 'a beginner server (capped) keeps nothing');
  assert.equal(normalizeChat({ history: 14, mode: 'off' }).history, 0);
  assert.equal(windowMsOf(normalizeChat(null)), CHAT_LIMITS.keepMs);
  assert.equal(windowMsOf(normalizeChat({ history: 2 })), 2 * DAY);
  assert.deepEqual(checkChatRules({ history: 7 }), { ok: true, fields: { history: 7 } });
  assert.equal(checkChatRules({ history: 91 }).ok, false);
  assert.deepEqual(chatProblems({ history: 3 }), []);
  assert.match(chatProblems({ history: 'week' })[0], /number of days/);
  const before = normalizeChat({ history: 7 });
  assert.equal(chatOpensUp(before, { history: 30 }), true, 'keeping more is the owner\'s to confirm');
  assert.equal(chatOpensUp(before, { history: 1 }), false, 'keeping less happens at once');
  for (const t of Object.values(LOUNGE_LINES)) assert.equal(floor(t, { swears: 'block', links: 'block' }).ok, true, t);
});

/* ------------------------------------------------------------------ the relay */

function relay({ policy = null, clock = { t: 1_000_000_000 } } = {}) {
  const room = new NetRoom({ code: 'lounge', now: () => clock.t });
  if (policy) room.setPolicy(policy);
  const kept = [];
  const gone = [];
  room.onPublished = (r) => kept.push(r);
  room.onUnsaid = (ids) => gone.push(...ids);
  const sock = (extra = {}) => ({ sent: [], ip: '203.0.113.9', send(x) { this.sent.push(JSON.parse(x)); }, close() {}, ...extra });
  const shell = (extra = {}) => {
    const conn = sock(extra);
    const w = room.watch(conn);
    return { conn, w, say: (m) => w.onMessage(JSON.stringify(m)), got: (t) => conn.sent.filter((x) => x.t === t) };
  };
  return { room, clock, kept, gone, shell };
}
const POL = (chat, extra = {}) => ({ v: 1, at: 10, server: null, kind: 'humans-only', aiSeats: 0, guides: 0, bots: 'off', level: 3, levelMax: 5, speech: 'game', kids: false, brain: 'script', chat, ...extra });
const B1 = 'b'.repeat(20);
const B2 = 'c'.repeat(20);

test('the relay keeps what was said where history is on: lines (never reactions) to the Table, take-downs too, a window of days', () => {
  const { room, clock, kept, gone, shell } = relay({ policy: POL(normalizeChat({ ...LOUNGE_CHAT, history: 7 })) });
  const ana = shell({ browser: B1, player: 'pl_ana', acct: true, name: 'Ana' });
  ana.say({ t: 'say', text: 'hello lounge', n: 'a1' });
  ana.say({ t: 'react', kind: 'fire' });
  clock.t += 5000;
  ana.say({ t: 'say', say: 'making' });
  assert.deepEqual(kept.map((r) => r.kind), ['text', 'line'], 'a reaction is never kept');
  assert.equal(kept[0].name, 'Ana', 'a watcher is named by the account the Worker vouched for');
  assert.equal(kept[0].from.player, 'pl_ana');
  // A day later the line is still in the window (a game's window is 15 minutes).
  clock.t += DAY;
  const late = shell({ browser: B2 });
  assert.ok(late.got('lines')[0].lines.some((l) => l.text === 'hello lounge'));
  room.control('unsay', { ids: [kept[0].id] });
  assert.deepEqual(gone, [kept[0].id]);
  // Without history: nothing is handed over, and the window is minutes.
  const off = relay({ policy: POL(normalizeChat(LOUNGE_CHAT)) });
  const s = off.shell({ browser: B1, player: 'pl_ana', acct: true });
  s.say({ t: 'say', text: 'not kept' });
  assert.equal(off.kept.length, 0);
  off.clock.t += 16 * 60_000;
  assert.equal(off.shell({ browser: B2 }).got('lines')[0].lines.length, 0);
});

test('kept lines come back into the window once; a page\'s own lines say mine; a person takes down only their own', () => {
  const { room, shell, gone } = relay({ policy: POL(normalizeChat({ ...LOUNGE_CHAT, history: 7 })) });
  const old = [{ id: 'k1', at: room.now() - 3 * 3600_000, kind: 'text', text: 'from yesterday', name: 'Bo', seat: null, colour: null, by: 'watcher', bubble: false, acct: true, owner: false, from: { client: null, token: null, browser: null, player: 'pl_bo' }, kept: true }];
  assert.equal(room.hydrate(old), 1);
  assert.equal(room.hydrate(old), 0, 'never twice');
  const bo = shell({ browser: B1, player: 'pl_bo', acct: true, name: 'Bo' });
  const lines = bo.got('lines')[0].lines;
  assert.equal(lines[0].mine, true, 'Bo\'s own kept line says mine on Bo\'s page');
  assert.equal(lines[0].kept, true);
  const cy = shell({ browser: B2, player: 'pl_cy', acct: true, name: 'Cy' });
  assert.equal(cy.got('lines')[0].lines[0].mine, undefined, 'and nobody else\'s');
  cy.say({ t: 'unsay', id: 'k1' });
  assert.equal(cy.got('held').at(-1).message, 'Only its sender (or the studio) can take a message down.');
  assert.equal(room.chatLog.length, 1);
  bo.say({ t: 'unsay', id: 'k1' });
  assert.equal(room.chatLog.length, 0);
  assert.deepEqual(gone, ['k1']);
  assert.deepEqual(cy.got('unline').at(-1).ids, ['k1'], 'every page takes it down');
  // A guest's own line, by its browser, while it is in the window.
  const guest = shell({ browser: 'g'.repeat(20) });
  guest.say({ t: 'say', say: 'hi', n: 'g1' });
  const id = guest.got('line').at(-1).id;
  assert.equal(guest.got('line').at(-1).n, 'g1');
  guest.say({ t: 'unsay', id });
  assert.ok(!room.chatLog.some((r) => r.id === id));
});

test('a card is a line with its link, title, studio, pitch and picture; the floor and the review hold it like typing', async () => {
  const { room, shell, kept } = relay({ policy: POL(normalizeChat({ ...LOUNGE_CHAT, history: 7 })) });
  const page = shell({ browser: B2 });
  const card = { url: 'https://owls.example/owl-run/', title: 'Owl Run', studio: 'Chat Owls', pitch: 'Grab the gems before the owls do.', image: 'https://owls.example/games/owl-run/cover.jpg', game: 'owl-run' };
  room.review = async () => ({ ok: true, by: 'ai' });
  const r = await room.control('card', { card, note: 'My first game!', name: 'Ana', player: 'pl_ana', acct: true, browser: B1 });
  assert.equal(r.ok, true);
  const line = page.got('line').at(-1);
  assert.deepEqual(line.card, card);
  assert.equal(line.text, 'My first game!');
  assert.equal(kept.at(-1).kind, 'card');
  // No note: the text is a plain fallback any page can show.
  await room.control('card', { card, name: 'Ana', player: 'pl_ana', acct: true });
  assert.equal(page.got('line').at(-1).text, 'Made: Owl Run by Chat Owls');
  // The floor: a note with contact details.
  const held = await room.control('card', { card, note: 'add me on snap', name: 'Ana', player: 'pl_ana', acct: true });
  assert.equal(held.ok, false);
  assert.equal(held.why, 'contact');
  // The review.
  room.review = async () => ({ ok: false, why: 'insult' });
  const ai = await room.control('card', { card, note: 'look at this', name: 'Ana', player: 'pl_ana', acct: true });
  assert.equal(ai.why, 'ai');
  // A muted sender's card is held; a kept line's sender is held by their account.
  room.review = null;
  const m = room.control('mute', { line: 'zz', minutes: 10, kept: { id: 'zz', name: 'Ana', from: { player: 'pl_ana' } } });
  assert.equal(m.ok, true);
  assert.equal((await room.control('card', { card, name: 'Ana', player: 'pl_ana', acct: true })).error, 'muted');
});

/* ------------------------------------------------------------------ the store */

function d1(extra = []) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, named INTEGER NOT NULL DEFAULT 0, guest INTEGER NOT NULL DEFAULT 1, owner INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)');
  sql.exec(LOUNGE_MIGRATION);
  sql.exec(LOUNGE_MIGRATION);
  for (const x of extra) sql.exec(x);
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

test('the store: kept lines paged, taken down, forgotten after their days and trimmed; a player\'s own exported and deleted', async () => {
  const DB = d1();
  const env = { DB };
  const now = Date.now();
  const line = (id, at, player = 'pl_ana', extra = {}) => ({ id, at, kind: 'text', text: `line ${id}`, name: 'Ana', by: 'watcher', acct: true, owner: false, from: { player }, ...extra });
  await keepLines(env, '_lounge', 'lounge', [line('a', now - 10 * DAY), line('b', now - 2 * DAY), line('c', now - 60_000), { id: 'r', at: now, kind: 'react', react: 'fire', name: 'Ana', from: {} }]);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 3, 'never a reaction');
  const cols = DB.sql.prepare('PRAGMA table_info(chat_history)').all().map((c) => c.name);
  for (const bad of ['ip', 'address', 'browser', 'token', 'email']) assert.ok(!cols.includes(bad), `no ${bad} column`);
  const week = await historyOf(env, '_lounge', 'lounge', { days: 7, now });
  assert.deepEqual(week.map((r) => r.id), ['b', 'c'], 'oldest first, within the days');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 2, 'the expired one was deleted on the way');
  assert.equal(week[0].from.player, 'pl_ana');
  assert.deepEqual((await historyOf(env, '_lounge', 'lounge', { days: 7, before: now - DAY, now })).map((r) => r.id), ['b'], 'paging back');
  assert.equal((await keptLine(env, '_lounge', 'lounge', 'c')).text, 'line c');
  assert.equal(await forgetLines(env, '_lounge', 'lounge', ['c', 'nope']), 1);
  await keepLines(env, 'owl-run', 'pub-1', [line('g1', now - 3 * DAY, 'pl_bo'), line('g2', now, 'pl_bo')]);
  assert.equal(await trimHistory(env, 'owl-run', 1, now), 1, 'keeping fewer days forgets the rest now');
  assert.equal(await trimHistory(env, 'owl-run', 0, now), 1, 'keeping none forgets everything');
  await keepLines(env, '_lounge', 'lounge', [line('d', now, 'pl_bo'), line('e', now, 'pl_bo', { kind: 'card', card: { url: 'https://x.example/g/', title: 'G', studio: 'X' } })]);
  const mine = await playerHistory(env, 'pl_bo');
  assert.equal(mine.length, 2);
  assert.equal(mine.find((x) => x.id === 'e').card.title, 'G');
  assert.equal(await forgetPlayerHistory(env, 'pl_bo'), 2);
  assert.deepEqual(await playerHistory(env, 'pl_bo'), []);
  assert.deepEqual(await historyOf(env, '_lounge', 'lounge', { days: 0 }), [], 'no history, nothing read');
});

test('play nights are checked, in order, and gone a day after; moderators are accounts with a passkey, never guests', async () => {
  const DB = d1(["INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES ('pl_ana', 'Ana', 1, 0, 0, 1, 1), ('pl_gus', 'Gus', 0, 1, 0, 1, 1)"]);
  const env = { DB };
  const now = Date.now();
  assert.equal(checkNight({ title: '', at: new Date(now + DAY).toISOString() }).ok, false);
  assert.equal(checkNight({ title: 'Night', at: 'friday' }).ok, false);
  assert.equal(checkNight({ title: 'Night', at: new Date(now - 2 * DAY).toISOString() }).ok, false, 'past');
  assert.equal(checkNight({ title: 'Night', at: new Date(now + DAY).toISOString(), minutes: 5 }).ok, false);
  const n = checkNight({ title: 'Rush night', at: '2099-01-02T03:00:00-07:00', game: 'night-rush', note: 'Bring a friend' }, { now: Date.parse('2098-12-30T00:00:00Z') });
  assert.equal(n.ok, true);
  assert.equal(n.night.at, Date.parse('2099-01-02T10:00:00Z'), 'a time with its zone is kept as the moment it is');
  const later = (await addNight(env, { title: 'Later', at: now + 3 * DAY, minutes: 60, note: null, game: null })).id;
  const sooner = (await addNight(env, { title: 'Sooner', at: now + DAY, minutes: 60, note: null, game: null })).id;
  await addNight(env, { title: 'Long gone', at: now - 3 * DAY, minutes: 60, note: null, game: null });
  const on = (await addNight(env, { title: 'On now', at: now - 30 * 60_000, minutes: 120, note: null, game: null })).id;
  const list = await nightsOf(env, { now });
  assert.deepEqual(list.map((x) => x.id), [on, sooner, later]);
  assert.equal(list[0].on, true);
  assert.equal(DB.sql.prepare("SELECT COUNT(*) AS n FROM lounge_nights WHERE title = 'Long gone'").get().n, 0);
  assert.equal((await removeNight(env, later)).ok, true);
  assert.equal((await removeNight(env, 'pn_000000000000')).ok, false);
  assert.equal((await addMod(env, 'pl_gus')).error, 'guest');
  assert.equal((await addMod(env, 'pl_nobody')).error, 'no-player');
  assert.equal((await addMod(env, 'pl_ana')).ok, true);
  assert.equal(await isMod(env, 'pl_ana'), true);
  assert.deepEqual((await modsOf(env)).map((m) => [m.player, m.name, m.account]), [['pl_ana', 'Ana', true]]);
  await removeMod(env, 'pl_ana');
  assert.equal(await isMod(env, 'pl_ana'), false);
});

test('studio.json "lounge": on, off, its fields, kids from a kids studio, and never over a game called lounge', () => {
  assert.equal(loungeConfig({}), null);
  assert.equal(loungeConfig({ lounge: false }), null);
  assert.deepEqual(loungeConfig({ lounge: true }), { name: 'The Lounge', tab: 'Lounge', blurb: 'Play nights, demos and what everybody is making. Come and say hi.', kids: false, featured: 'directory' });
  assert.equal(loungeConfig({ lounge: true }, [], { audience: 'kids' }).kids, true);
  assert.equal(loungeConfig({ lounge: { kids: false } }, [], { audience: 'kids' }).kids, false);
  const c = loungeConfig({ lounge: { name: 'The Owl Nest', featured: 'studio', chat: { slow: 5 } } });
  assert.equal(c.name, 'The Owl Nest');
  assert.equal(c.featured, 'studio');
  assert.deepEqual(c.chat, { slow: 5 });
  assert.equal(loungeConfig({ lounge: true }, [{ id: 'lounge' }]), null);
  assert.match(loungeProblems({ lounge: true }, [{ id: 'lounge' }])[0], /a game is called "lounge"/);
  assert.deepEqual(loungeProblems({ lounge: { featured: 'all', colour: 'red', chat: { mode: 'shout' } } }, [], chatProblems), ['lounge.colour is not a field (name, tab, blurb, kids, featured, chat)', 'lounge.featured is directory, studio, none', 'lounge.chat.mode is off, emoji, lines or text']);
});

/* ------------------------------------------------------------------ the Worker */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Chat Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}
function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE, '0004_players.sql', OFFICE_MIGRATION_FILE, SERVERS_MIGRATION_FILE, CHAT_MIGRATION_FILE, LOUNGE_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}
function assetsOf(dir) {
  const dist = join(dir, 'site', 'dist');
  return {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
    },
  };
}
function namespace(Klass, envRef, waits) {
  const objs = new Map();
  return {
    objs,
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, setAlarm: async (at) => { store.set('__alarm', at); }, getAlarm: async () => store.get('__alarm') ?? null }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
        objs.set(id, new Klass(ctx, envRef.env));
      }
      const o = objs.get(id);
      return { fetch: (req, init) => o.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

const builtFor = new Map();
async function site({ lounge = { featured: 'studio' }, name = 'worker' } = {}) {
  if (!builtFor.has(name)) {
    const dir = studio(name);
    assert.equal(run(['game', 'new', 'owl-run', '--from', 'gem-rush', '--name', 'Owl Run'], dir).status, 0);
    const sj = join(dir, 'studio.json');
    const s = JSON.parse(readFileSync(sj, 'utf8'));
    if (lounge !== null) s.lounge = lounge;
    writeFileSync(sj, JSON.stringify(s, null, 2));
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    builtFor.set(name, dir);
  }
  const dir = builtFor.get(name);
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const env = { ASSETS: assetsOf(dir), DB, STUDIO_NAME: 'Chat Owls' };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const drain = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
  const fetchSite = async (path, init = {}) => {
    const r = await worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await drain();
    return r;
  };
  const mint = (kind, value, ttl = 3600_000) => DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(value), kind, Date.now() + ttl);
  const session = 'f'.repeat(64);
  mint('session', session);
  const officeKey = `hsk_${'0e'.repeat(24)}`;
  mint('office', officeKey);
  let pn = 0;
  const player = ({ guest = false, owner = false, name: who = null } = {}) => {
    pn += 1;
    const id = `pl_${String(pn).padStart(22, 'p')}`;
    const token = `${String(pn).padStart(43, 't')}`;
    DB.sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, ?, ?, ?, ?)').run(id, who ?? `Player ${pn}`, guest ? 1 : 0, owner ? 1 : 0, Date.now() - DAY, Date.now());
    DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(sha(token), id, Date.now() + DAY);
    return { id, cookie: `studio_player=${token}` };
  };
  const ends = [];
  class FakeSocket { constructor() { this.listeners = {}; this.sent = []; } accept() {} send(t) { this.sent.push(JSON.parse(t)); } close() { this.closed = true; } addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); } emit(k, e) { for (const fn of this.listeners[k] ?? []) fn(e); } }
  const socket = async (path, headers = {}) => {
    globalThis.WebSocketPair = class { constructor() { const c = new FakeSocket(); const s2 = new FakeSocket(); ends.push(s2); return { 0: c, 1: s2 }; } };
    try { await fetchSite(path, { headers: { upgrade: 'websocket', ...headers } }).catch((e) => { if (!/status/.test(String(e))) throw e; }); } finally { delete globalThis.WebSocketPair; }
    const end = ends.at(-1);
    return { end, say: async (m) => { end.emit('message', { data: JSON.stringify(m) }); await drain(); await new Promise((r) => setImmediate(r)); await drain(); }, got: (t) => end.sent.filter((x) => x.t === t) };
  };
  const stop = () => { for (const o of env.TABLE.objs.values()) if (o.timer) { clearInterval(o.timer); o.timer = null; } };
  const same = (cookie) => ({ origin: 'https://owls.example', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) });
  const ownerSession = { origin: 'https://owls.example', 'content-type': 'application/json', cookie: `studio_owner=${session}` };
  const key = { authorization: `Bearer ${officeKey}`, 'content-type': 'application/json' };
  const post = (path, body, headers) => fetchSite(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const room = () => env.TABLE.objs.get('_lounge/lounge')?.room ?? null;
  return { env, DB, dir, fetchSite, socket, stop, player, same, ownerSession, key, post, room, drain };
}

test('the Lounge is off until studio.json turns it on; then /lounge/ is the studio\'s own page with a Lounge tab', async () => {
  const off = await site({ lounge: null, name: 'no-lounge' });
  assert.equal((await off.fetchSite('/lounge/')).status, 404);
  assert.equal((await off.fetchSite('/lounge/api/now')).status, 404);
  assert.doesNotMatch(await (await off.fetchSite('/')).text(), /href="\/lounge\/"/);
  const on = await site();
  try {
    const res = await on.fetchSite('/lounge/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /no-store/);
    const html = await res.text();
    assert.match(html, /<h1 id="lg-title">The Lounge<\/h1>/);
    assert.match(html, /<a href="\/lounge\/" aria-current="page">/, 'the site\'s top line has the Lounge');
    assert.match(html, /<script type="application\/json" id="lounge-boot">/);
    assert.doesNotMatch(html, /<script>(?!\s*$)/, 'no inline script (the CSP allows none)');
    assert.match(html, /<script type="application\/ld\+json">[^<]*BreadcrumbList/, 'breadcrumbs, as every page but Home has');
    assert.match(html, /gone after a few minutes/, 'the page says what is kept');
    const boot = JSON.parse(/<script type="application\/json" id="lounge-boot">([^<]*)<\/script>/.exec(html)[1]);
    assert.equal(boot.me.signedIn, false);
    assert.equal(boot.rules.slow, 3);
    assert.equal(boot.rules.history, 0);
    const js = await on.fetchSite('/_homie/lounge.js');
    assert.equal(js.status, 200);
    assert.doesNotMatch(await js.text(), /__name\(/, 'no bundler helper in the page script');
    assert.doesNotThrow(() => new Function(LOUNGE_JS));
    assert.equal((await on.fetchSite('/lounge')).status, 301);
  } finally { on.stop(); off.stop(); }
});

test('the socket: a guest reacts and is asked to sign in; an account types under its name; the owner is marked; another site\'s page is nobody', async () => {
  const { socket, stop, player, room, DB } = await site();
  try {
    const guest = await socket('/lounge/__watch?b=gggggggggggggggggggg');
    assert.equal(room().chatRules().slow, 3);
    assert.equal(room().chatRules().bubbles, false);
    assert.equal(guest.got('lines').length, 1);
    await guest.say({ t: 'say', text: 'hi' });
    assert.equal(guest.got('held').at(-1).why, 'sign-in');
    await guest.say({ t: 'react', kind: 'clap' });
    await guest.say({ t: 'say', say: 'hi' });
    assert.equal(room().chatLog.at(-1).text, 'Hi all!');
    const ana = player({ name: 'Ana' });
    const a = await socket('/lounge/__watch?b=aaaaaaaaaaaaaaaaaaaa', { cookie: ana.cookie, origin: 'https://owls.example' });
    await a.say({ t: 'say', text: 'what is everyone making?', n: 'x1' });
    const said = a.got('line').at(-1);
    assert.equal(said.text, 'what is everyone making?');
    assert.equal(said.name, 'Ana');
    assert.equal(said.acct, true);
    assert.equal(said.n, 'x1');
    const boss = player({ owner: true, name: 'Owl Boss' });
    const o = await socket('/lounge/__watch?b=oooooooooooooooooooo', { cookie: boss.cookie, origin: 'https://owls.example' });
    await o.say({ t: 'say', text: 'play night on friday' });
    assert.equal(o.got('line').at(-1).owner, true);
    // A page of homie.rocks with Ana's cookies: a watcher with a handle, reacting only.
    const hub = await socket('/lounge/__watch?b=hhhhhhhhhhhhhhhhhhhh', { cookie: ana.cookie, origin: 'https://homie.rocks' });
    assert.equal(hub.got('lines').length, 1, 'it sees the Lounge');
    await hub.say({ t: 'say', text: 'typing from elsewhere' });
    assert.equal(hub.got('held').at(-1).why, 'sign-in');
    await hub.say({ t: 'react', kind: 'fire' });
    assert.equal(room().chatLog.at(-1).by, 'hub');
    assert.notEqual(room().chatLog.at(-1).name, 'Ana');
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 0, 'nothing kept while history is off');
  } finally { stop(); }
});

const FAST = { lounge: { featured: 'studio', chat: { slow: 0 } }, name: 'fast' };

test('history from the office: an office key asks, the owner turns it on, lines are kept and come back, a person deletes theirs, the account takes the rest', async () => {
  const { socket, stop, player, room, DB, post, key, ownerSession, fetchSite, same } = await site(FAST);
  try {
    const asked = await post('/_studio/api/lounge/rules', { history: 7 }, key);
    assert.equal(asked.status, 202, 'an office key only asks to keep more');
    const done = await post('/_studio/api/lounge/rules', { history: 7 }, ownerSession);
    assert.equal(done.status, 200, await done.clone().text());
    assert.equal((await done.json()).rules.history, 7);
    const ana = player({ name: 'Ana' });
    const a = await socket('/lounge/__watch?b=aaaaaaaaaaaaaaaaaaaa', { cookie: ana.cookie, origin: 'https://owls.example' });
    assert.equal(room().chatRules().history, 7, 'the live room heard it');
    await a.say({ t: 'say', text: 'kept for a week' });
    await a.say({ t: 'react', kind: 'heart' });
    const rows = DB.sql.prepare('SELECT * FROM chat_history').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].player, ana.id);
    assert.equal(rows[0].name, 'Ana');
    // The room forgets (an eviction, an empty room): the next page gets the kept lines back.
    room().chatLog = [];
    room().hydrated = false;
    const later = await socket('/lounge/__watch?b=bbbbbbbbbbbbbbbbbbbb', { cookie: ana.cookie, origin: 'https://owls.example' });
    const back = later.got('lines')[0].lines;
    assert.equal(back.at(-1).text, 'kept for a week');
    assert.equal(back.at(-1).mine, true);
    const hist = await (await fetchSite('/lounge/api/history', { headers: { cookie: ana.cookie } })).json();
    assert.equal(hist.history, 7);
    assert.equal(hist.lines.at(-1).mine, true);
    const other = player({ name: 'Bo' });
    const nope = await post('/lounge/api/delete', { id: rows[0].id }, same(other.cookie));
    assert.equal(nope.status, 403);
    const del = await post('/lounge/api/delete', { id: rows[0].id }, same(ana.cookie));
    assert.equal((await del.json()).ok, true);
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 0, 'taken down where it was kept');
    assert.deepEqual(later.got('unline').at(-1).ids, [rows[0].id]);
    await a.say({ t: 'say', text: 'one more' });
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 1);
    const gone = await post('/api/player/delete', { confirm: 'delete' }, same(ana.cookie));
    assert.equal(gone.status, 200, await gone.clone().text());
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 0, 'deleting the account deletes its lines');
    // Keeping none forgets everything at once.
    await a.say({ t: 'say', say: 'thanks' });
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 1);
    await post('/_studio/api/lounge/rules', { history: 0 }, key);
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 0, 'keeping less happens at once, and forgets');
  } finally { stop(); }
});

test('show what you made: a card from this studio\'s game and from another Homie studio; never from a site that is not one, a guest, or held words', async () => {
  const { stop, player, room, post, same, socket } = await site();
  const realFetch = globalThis.fetch;
  try {
    const ana = player({ name: 'Ana' });
    const page = await socket('/lounge/__watch?b=pppppppppppppppppppp');
    assert.equal((await post('/lounge/api/show', { url: 'https://owls.example/owl-run/' }, same())).status, 401, 'a guest signs in first');
    const own = await post('/lounge/api/show', { url: 'https://owls.example/owl-run/play', note: 'my first game!' }, same(ana.cookie));
    const j = await own.json();
    assert.equal(j.ok, true, JSON.stringify(j));
    assert.equal(j.card.title, 'Owl Run');
    assert.equal(j.card.url, 'https://owls.example/owl-run/');
    const line = page.got('line').at(-1);
    assert.equal(line.card.title, 'Owl Run');
    assert.equal(line.card.studio, 'Chat Owls');
    assert.equal(line.name, 'Ana');
    assert.equal(line.text, 'my first game!');
    // Another studio: its manifest says what the game is.
    globalThis.fetch = async (u) => {
      if (String(u) === 'https://elsewhere.example/.well-known/homie-studio.json') return new Response(JSON.stringify({ v: 1, kind: 'homie-studio', name: 'Elsewhere', games: [{ id: 'moth-dash', name: 'Moth Dash', blurb: 'Dash between the lamps.', page: 'https://elsewhere.example/moth-dash/', cover: 'https://elsewhere.example/c.jpg' }] }), { headers: { 'content-type': 'application/json' } });
      if (String(u) === 'https://plain.example/.well-known/homie-studio.json') return new Response('nope', { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    };
    const other = await (await post('/lounge/api/show', { url: 'https://elsewhere.example/moth-dash/' }, same(ana.cookie))).json();
    assert.equal(other.ok, true, JSON.stringify(other));
    assert.deepEqual(page.got('line').at(-1).card, { url: 'https://elsewhere.example/moth-dash/', title: 'Moth Dash', studio: 'Elsewhere', pitch: 'Dash between the lamps.', image: 'https://elsewhere.example/c.jpg', game: 'moth-dash' });
    assert.match((await (await post('/lounge/api/show', { url: 'https://plain.example/thing/' }, same(ana.cookie))).json()).message, /not a Homie studio/);
    assert.match((await (await post('/lounge/api/show', { url: 'http://elsewhere.example/moth-dash/' }, same(ana.cookie))).json()).message, /https/);
    const held = await (await post('/lounge/api/show', { url: 'https://owls.example/owl-run/', note: 'text me 555 123 4567' }, same(ana.cookie))).json();
    assert.equal(held.ok, false);
    assert.equal(held.why, 'contact');
    assert.equal((await post('/lounge/api/show', { url: 'https://owls.example/owl-run/' }, { 'content-type': 'application/json', cookie: ana.cookie, origin: 'https://evil.example' })).status, 403);
    assert.equal(room().chatLog.filter((r) => r.kind === 'card').length, 2);
  } finally { globalThis.fetch = realFetch; stop(); }
});

test('keeping it kind: reports, the keepers\' Remove, Mute, Kick and slow mode, and a moderator never acts on the owner', async () => {
  const { stop, player, room, post, same, socket, ownerSession, DB } = await site(FAST);
  try {
    const boss = player({ owner: true, name: 'Owl Boss' });
    const mo = player({ name: 'Mo' });
    const rude = player({ name: 'Rude' });
    const watch = await socket('/lounge/__watch?b=wwwwwwwwwwwwwwwwwwww');
    const r = await socket('/lounge/__watch?b=rrrrrrrrrrrrrrrrrrrr', { cookie: rude.cookie, origin: 'https://owls.example' });
    await r.say({ t: 'say', text: 'this game is bad' });
    const bad = room().chatLog.at(-1);
    const rep = await post('/lounge/api/report', { id: bad.id, reason: 'mean', b: 'wwwwwwwwwwwwwwwwwwww' }, same());
    assert.equal((await rep.json()).ok, true);
    const filed = DB.sql.prepare('SELECT * FROM chat_reports').get();
    assert.equal(filed.game, '_lounge');
    assert.equal(filed.text, 'this game is bad');
    assert.equal(filed.sender_player, rude.id);
    // Not a keeper yet.
    assert.equal((await post('/lounge/api/mod', { op: 'remove', line: bad.id }, same(mo.cookie))).status, 403);
    const made = await post('/_studio/api/lounge/mod', { player: mo.id, name: 'Mo' }, ownerSession);
    assert.equal((await made.json()).ok, true);
    const m = await socket('/lounge/__watch?b=mmmmmmmmmmmmmmmmmmmm', { cookie: mo.cookie, origin: 'https://owls.example' });
    await m.say({ t: 'say', text: 'be kind folks' });
    assert.equal(m.got('line').at(-1).mod, true, 'a moderator\'s lines say so');
    const rm = await (await post('/lounge/api/mod', { op: 'remove', line: bad.id }, same(mo.cookie))).json();
    assert.equal(rm.ok, true);
    assert.deepEqual(watch.got('unline').at(-1).ids, [bad.id]);
    await r.say({ t: 'say', text: 'still here' });
    const again = room().chatLog.at(-1);
    const mute = await (await post('/lounge/api/mod', { op: 'mute', line: again.id, minutes: 600 }, same(mo.cookie))).json();
    assert.equal(mute.ok, true, JSON.stringify(mute));
    assert.equal(mute.minutes, 60, 'a moderator holds someone an hour at most');
    await r.say({ t: 'say', text: 'can you hear me' });
    assert.equal(r.got('held').at(-1).why, 'muted');
    const o = await socket('/lounge/__watch?b=oooooooooooooooooooo', { cookie: boss.cookie, origin: 'https://owls.example' });
    await o.say({ t: 'say', text: 'thanks for keeping it kind' });
    const own = room().chatLog.at(-1);
    assert.equal((await (await post('/lounge/api/mod', { op: 'kick', line: own.id }, same(mo.cookie))).json()).error, 'keeper');
    const slow = await (await post('/lounge/api/mod', { op: 'slow', seconds: 30 }, same(mo.cookie))).json();
    assert.equal(slow.ok, true);
    assert.equal(room().chatRules().slow, 30, 'the live room heard slow mode');
    const spam = player({ name: 'Spam' });
    const sp = await socket('/lounge/__watch?b=ssssssssssssssssssss', { cookie: spam.cookie, origin: 'https://owls.example' });
    await sp.say({ t: 'say', text: 'buy my thing' });
    const ad = room().chatLog.at(-1);
    const kick = await (await post('/lounge/api/mod', { op: 'kick', line: ad.id, minutes: 1440 }, same(boss.cookie))).json();
    assert.equal(kick.ok, true, JSON.stringify(kick));
    assert.equal(kick.minutes, 1440, 'the owner holds for up to a day');
    assert.ok(!room().chatLog.some((x) => x.id === ad.id), 'their lines came down with them');
    const back = await socket('/lounge/__watch?b=ssssssssssssssssssss', { cookie: spam.cookie, origin: 'https://owls.example' });
    assert.equal(back.got('kicked').length, 1, 'a kicked sender hears so when they come back');
    assert.equal((await post('/lounge/api/show', { url: 'https://owls.example/owl-run/' }, same(spam.cookie))).status, 403, 'and shows no card');
  } finally { stop(); }
});

test('play nights from the office and /lounge/api/now: CORS, the rules, the nights in order, the rooms; the office\'s Lounge', async () => {
  const { stop, post, ownerSession, fetchSite, key } = await site();
  try {
    const at = new Date(Date.now() + 2 * DAY).toISOString();
    const added = await (await post('/_studio/api/lounge/night', { title: 'Owl Run night', at, minutes: 90, game: 'owl-run', note: 'Bring a friend' }, ownerSession)).json();
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.equal((await post('/_studio/api/lounge/night', { title: 'Nope', at, game: 'no-such-game' }, ownerSession)).status, 400);
    const res = await fetchSite('/lounge/api/now');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const now = await res.json();
    assert.equal(now.lounge.name, 'The Lounge');
    assert.equal(now.lounge.socket, 'wss://owls.example/lounge/__watch');
    assert.equal(now.lounge.page, 'https://owls.example/lounge/');
    assert.equal(now.lounge.rules.history, 0);
    assert.equal(now.nights[0].title, 'Owl Run night');
    assert.equal(now.nights[0].at, at);
    assert.equal(now.nights[0].game.play, 'https://owls.example/owl-run/play');
    assert.deepEqual(now.rooms, [], 'nobody is playing (featured: studio, so no directory is read)');
    // The manifest names the Lounge; the sitemap and llms.txt list its page; robots.txt keeps its socket and APIs out.
    const manifest = await (await fetchSite('/.well-known/homie-studio.json')).json();
    assert.deepEqual(manifest.lounge, { name: 'The Lounge', page: 'https://owls.example/lounge/', now: 'https://owls.example/lounge/api/now' });
    assert.match(await (await fetchSite('/sitemap.xml')).text(), /<loc>https:\/\/owls\.example\/lounge\/<\/loc>/);
    assert.match(await (await fetchSite('/llms.txt')).text(), /\[The Lounge\]\(https:\/\/owls\.example\/lounge\/\)/);
    const robots = await (await fetchSite('/robots.txt')).text();
    assert.match(robots, /Disallow: \/lounge\/api\//);
    assert.match(robots, /Disallow: \/lounge\/__/);
    const office = await (await fetchSite('/_studio/api/lounge', { headers: key })).json();
    assert.equal(office.lounge.nights[0].title, 'Owl Run night');
    const view = await (await fetchSite('/_studio/api/office', { headers: key })).json();
    assert.equal(view.lounge.name, 'The Lounge');
    const rm = await (await post('/_studio/api/lounge/night', { remove: added.id }, key)).json();
    assert.equal(rm.ok, true, 'a play night comes off at once, even from an office key');
    assert.deepEqual((await (await fetchSite('/lounge/api/now')).json()).nights, []);
  } finally { stop(); }
});

test('a kids Lounge: emoji and quick lines only, and nothing kept whatever the office says', async () => {
  const { stop, socket, player, room, post, ownerSession, DB } = await site({ lounge: { kids: true, featured: 'none' }, name: 'kids' });
  try {
    await post('/_studio/api/lounge/rules', { history: 30, mode: 'text' }, ownerSession);
    const kid = player({ name: 'Kid' });
    const k = await socket('/lounge/__watch?b=kkkkkkkkkkkkkkkkkkkk', { cookie: kid.cookie, origin: 'https://owls.example' });
    assert.equal(room().chatRules().mode, 'lines');
    assert.equal(room().chatRules().history, 0);
    await k.say({ t: 'say', text: 'where do you live' });
    assert.equal(k.got('held').at(-1).why, 'lines');
    await k.say({ t: 'say', say: 'gg' });
    assert.equal(room().chatLog.at(-1).text, 'Good game!');
    assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM chat_history').get().n, 0);
  } finally { stop(); }
});
