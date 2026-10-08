import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OFFICE_MIGRATION_FILE, ticketFor, ticketSub } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import {
  PUBLIC_SERVER, SERVERS_MIGRATION, SERVERS_MIGRATION_FILE, checkServer, narrows, policyOf, pooledRoom, roomCode, roomServer, serverAccess, serverOf,
} from '../worker/servers.mjs';
import { decodeFacts, fillSpot, passCreate, passOf, passRefusal, passRevoke } from '../worker/agents.mjs';
import { vocab, source } from './rules-feature-kit.mjs';
import { players } from '../worker/players.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-servers-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DAY = 86_400_000;
const EVIL = '<img src=x onerror=alert(1)>';

/* ------------------------------------------------------------------ rooms, policies, changes */
function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Server Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE, '0004_players.sql', OFFICE_MIGRATION_FILE, SERVERS_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
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
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, getAlarm: async () => store.get('__alarm') ?? null, setAlarm: async (at) => { store.set('__alarm', at); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
        objs.set(id, new Klass(ctx, envRef.env));
      }
      const o = objs.get(id);
      return { fetch: (req, init) => o.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

let built = null;
async function site() {
  if (!built) {
    const dir = studio('worker');
    assert.equal(run(['game', 'new', 'owl-run', '--from', 'gem-rush', '--name', 'Owl Run'], dir).status, 0);
    assert.equal(run(['game', 'new', 'vale', '--from', 'ember-vale', '--name', 'Vale'], dir).status, 0);
    assert.equal(run(['game', 'new', 'rules-run', '--from', 'coin-dash', '--name', 'Rules Run'], dir).status, 0);
    writeFileSync(join(dir, 'games/rules-run/src/rules.ts'), source);
    const rulesManifest = join(dir, 'games/rules-run/game.json');
    writeFileSync(rulesManifest, JSON.stringify({ ...JSON.parse(readFileSync(rulesManifest, 'utf8')), players: { min: 1, max: 4 } }));
    writeFileSync(join(dir, 'games/rules-run/agents.json'), JSON.stringify(vocab));
    // A game that ships a server in its game.json (a seed; a D1 row of the same id wins).
    const gj = join(dir, 'games', 'vale', 'game.json');
    writeFileSync(gj, JSON.stringify({ ...JSON.parse(readFileSync(gj, 'utf8')), servers: [{ id: 'hearth', name: 'Hearth', policy: 'hybrid', aiSeats: 1, blurb: 'A cosy server' }] }, null, 2));
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const { default: worker, Table, Lobby, hostRules } = await import('../worker/index.mjs');
  hostRules((await import(join(dir, 'site/src/rules/index.mjs'))).default);
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const env = { ASSETS: assetsOf(dir), DB, STUDIO_NAME: 'Server Owls' };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const fetchSite = async (path, init = {}) => {
    const r = await worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  const mint = (kind, value, ttl = 3600_000) => DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(value), kind, Date.now() + ttl);
  const session = 'f'.repeat(64);
  mint('session', session);
  const officeKey = `hsk_${'0e'.repeat(24)}`;
  mint('office', officeKey);
  /** A player account (created `days` ago) and its signed-in cookie. */
  let pn = 0;
  const player = (days = 0, { guest = false } = {}) => {
    pn += 1;
    const id = `pl_${String(pn).padStart(22, 'p')}`;
    const token = `${String(pn).padStart(43, 't')}`;
    const at = Date.now() - days * DAY;
    DB.sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, ?, 0, ?, ?)').run(id, `Player ${pn}`, guest ? 1 : 0, at, Date.now());
    DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(sha(token), id, Date.now() + DAY);
    return { id, cookie: `studio_player=${token}` };
  };
  /** Seat a person in a live room (the Table's own relay), as a browser's socket would. */
  const seat = async (game, room, { browser = 'aaaaaaaaaaaaaaaaaaaaaa', name = '', caps = [] } = {}) => {
    const stub = env.TABLE.get(`${game}/${room}`);
    await stub.fetch(`https://table/__facts?game=${game}&room=${room}&max=8`);
    const table = env.TABLE.objs.get(`${game}/${room}`);
    const conn = { sent: [], closed: null, ip: '203.0.113.5', browser, send(t) { this.sent.push(JSON.parse(t)); }, close(c, w) { this.closed = [c, w]; } };
    const h = table.room.attach(conn);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, caps, ...(name ? { name } : {}) }));
    table.report();
    await Promise.all(waits.splice(0));
    return { conn, h, table, welcome: conn.sent.find((m) => m.t === 'welcome') };
  };
  const owner = { cookie: `studio_owner=${session}` };
  const same = { origin: 'https://owls.example', 'content-type': 'application/json' };
  const key = { authorization: `Bearer ${officeKey}`, 'content-type': 'application/json' };
  const post = (path, body, headers = key) => fetchSite(path, { method: 'POST', headers, body: JSON.stringify(body) });
  /** Owl Run's servers, as the integration run makes them: Night Shift (hybrid 2) and People Only. */
  const servers = async () => {
    for (const b of [{ name: 'Night Shift', policy: 'hybrid', aiSeats: 2 }, { name: 'People Only', policy: 'humans-only' }]) {
      const r = await post('/_studio/api/servers', { game: 'owl-run', ...b });
      assert.equal(r.status, 200, await r.text());
    }
  };
  return { env, DB, fetchSite, seat, owner, same, key, post, player, waits, dir, servers };
}

async function rulesSockets(t) {
  const s = await site(); const ends = [];
  const ver = JSON.parse(readFileSync(join(s.dir, 'site/dist/games.json'), 'utf8')).games.find(g => g.id === 'rules-run').room.build;
  class Socket {
    constructor() { this.listeners = {}; this.sent = []; } accept() {} send(v) { this.sent.push(JSON.parse(v)); } close(code, why) { this.closed = [code, why]; }
    addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
    emit(k, e) { for (const fn of this.listeners[k] ?? []) fn(e); }
    say(m) { this.emit('message', { data: JSON.stringify(m) }); }
  }
  const previous = globalThis.WebSocketPair;
  globalThis.WebSocketPair = class { constructor() { const c = new Socket(); const server = new Socket(); ends.push(server); return { 0: c, 1: server }; } };
  t.after(() => { globalThis.WebSocketPair = previous; for (const table of s.env.TABLE.objs.values()) { table.hostRt?.stop(); if (table.timer) clearInterval(table.timer); } });
  const socket = async (room, ticket = '', hello = {}) => {
    const n = ends.length;
    const res = await s.fetchSite(`/rules-run/__net?room=${room}&gv=${ver}${ticket ? `&t=${encodeURIComponent(ticket)}` : ''}`, { headers: { upgrade: 'websocket' } }).catch(e => { if (!/status/.test(String(e))) throw e; });
    if (ends.length === n) return res;
    const end = ends.at(-1); end.say({ t: 'hello', v: 1, rev: 10, ver, want: 'play', name: 'Player', ...hello }); return end;
  };
  const settle = async () => { await Promise.all(s.waits.splice(0)); };
  return { ...s, socket, settle };
}

async function changeRulesServer(s, fields) {
  const r = await s.post('/_studio/api/servers/set', { game: 'rules-run', server: 'changing', ...fields });
  if (r.status === 202) {
    const j = await r.json();
    assert.equal((await s.fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { ...s.owner, origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' })).status, 200);
  } else assert.equal(r.status, 200, await r.text());
  await s.settle();
}

/* ---- Round 3: the 8 s quiet rule through the real Worker and Table, with the owner's consent to AI talk ---- */
const out = (...a) => console.log('#W3', ...a);
test('one player cannot make a kept companion speak more often than the quiet rule (ask, leave the tab, come back)', async t => {
  const s = await rulesSockets(t); const room = 's-changing-1';
  assert.equal((await s.post('/_studio/api/servers', { game: 'rules-run', id: 'changing', name: 'Changing', policy: 'hybrid', aiSeats: 2 })).status, 200);
  let r = await s.post('/_studio/api/agents/brain', { game: 'rules-run', server: 'changing', mode: 'workers-ai', budget: 1000 }); let j = await r.json(); out('AI talk asked:', r.status);
  if (r.status === 202) assert.equal((await s.fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { ...s.owner, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' })).status, 200);
  const A = await s.socket(room, '', { name: 'Ann' }); const table = s.env.TABLE.objs.get(`rules-run/${room}`); await table.vocabRead;
  let now = table.room.now(); table.room.now = () => now;
  const tick = (n) => { for (let i = 0; i < n; i++) { now += 50; table.hostRt.tickNow(); if (i % 5 === 0) { for (const c of table.room.live()) c.lastSeen = now; table.room.tick(); } } };
  let B = await s.socket(room, '', { name: 'Bob' }); let bw = B.sent.find((m) => m.t === 'welcome'); tick(200);
  out(`policy brain ${table.room.policy.brain} speech ${table.room.policy.speech}; AI bodies ${table.hostRt.core.bodies().filter((b) => b.driver === 'ai').map((b) => `${b.seat}:${b.owner}`)}; roster ${JSON.stringify(table.room.lastRoster.map((x) => [x.slot, x.name, x.agent?.role ?? '']))}`);
  const slot = table.hostRt.core.bodies().find((b) => b.owner === 'reserved')?.seat; assert.ok(Number.isInteger(slot), 'a kept companion');
  const n0 = A.sent.length; const t0 = now; let cycles = 0;
  for (let i = 0; i < 20; i++) {
    B.say({ t: 'ev', k: `ask:follow`, d: { slot, args: { seat: bw.seat } } }); tick(6); const g = table.hostRt.core.goal(slot)?.goal;
    B.emit('close', {}); tick(4);
    B = await s.socket(room, '', { name: 'Bob', token: bw.token }); bw = B.sent.find((m) => m.t === 'welcome'); if (!bw || bw.seat === null) { out('rejoin failed', JSON.stringify(B.sent.find((m) => m.t === 'error'))); break; } tick(2); cycles += 1;
    if (i < 2) out(`cycle ${i}: goal after the ask ${g}; after away and back ${table.hostRt.core.goal(slot)?.goal}`);
  }
  const says = A.sent.slice(n0).filter((m) => m.t === 'ev' && /^say:/.test(m.k) && m.d?.slot === slot); const secs = (now - t0) / 1000;
  out(`${cycles} cycles in ${secs} s of room time: lines the companion in seat ${slot} said to Ann: ${says.length}; the quiet rule allows ${Math.ceil(secs / 8)}`);
  assert.ok(says.length <= Math.ceil(secs / 8) + 1, `the companion spoke ${says.length} times in ${secs} s`);
});
