import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * @homie-rocks/studio 0.15.0: watch any player (NETPLAY.md section 16, contract revision 5).
 *
 *   - the relay: a watcher (hello.watch, or a socket the Worker opened through a watch door) never takes a seat, even
 *     when one frees up; it hosts only a room no player can host; the watch feed counts it; a game that cannot be
 *     watched refuses it (watch-off); "overview" games and a browser that holds a seat in the room are told they may
 *     not follow one player, and told again when that changes;
 *   - the helper: `watching`, `viewSeat`, `follow`, `players()`, Auto (a spotlight, else the leader of the scores
 *     probe), a followed player who leaves hands the view to Auto and gets it back on return, the page's word
 *     ("overview") and the relay's ("seated-here"), and an older relay that says nothing;
 *   - the Worker: the watch door is the play door (a private game is the owner's alone), a game that says
 *     `"watch": false` has none, the frame boots as a watcher, /api/watch names the busiest public room without
 *     reserving a seat, and every room row carries its Watch link.
 * The D1 is node:sqlite with the studio's own migrations; the Durable Objects are the real Table and Lobby.
 * Run: node --test packages/studio/test/watch.test.mjs
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
import { NET_PALETTE, NetRoom } from '../worker/room.mjs';
import { OFFICE_MIGRATION_FILE } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-watch-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbb';

/* ------------------------------------------------------------------ the relay */

function relay(opts = {}) {
  let t = 1_000_000;
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 2, now: () => t, ...opts });
  const join = (conn = {}, hello = {}) => {
    const c = { sent: [], closed: null, ip: '203.0.113.1', ...conn, send(text) { this.sent.push(JSON.parse(text)); }, close(code, why) { this.closed = [code, why]; } };
    const h = room.attach(c);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, ...hello }));
    return { conn: c, h, last: (type) => [...c.sent].reverse().find((x) => x.t === type) ?? null, all: (type) => c.sent.filter((x) => x.t === type) };
  };
  const feed = () => { const w = { sent: [], send(text) { this.sent.push(JSON.parse(text)); } }; room.watch(w); return w; };
  return { room, join, feed, advance: (ms) => { t += ms; } };
}

test('a watcher never takes a seat, not even one that frees up; the room counts it and names it a watcher', () => {
  const { room, join, feed } = relay();
  const a = join();
  const b = join();
  const w = join({}, { want: 'play', watch: true });
  const welcome = w.last('welcome');
  assert.equal(welcome.seat, null, 'a watcher asking to play is still a watcher');
  assert.equal(welcome.role, 'screen');
  assert.equal(welcome.full, undefined, 'it is not waiting for a seat');
  assert.deepEqual(welcome.watch, { follow: true });
  assert.equal(a.last('join').peer.watch, true, 'the players see a watcher join');
  // A seat frees up: a waiting visitor would take it; a watcher does not.
  const waiting = join();
  assert.equal(waiting.last('welcome').full, true);
  b.h.onClose();
  room.tick();
  assert.equal(waiting.last('seat').seat, 1, 'the waiting visitor takes the free seat');
  assert.equal(w.last('seat'), null, 'the watcher never does');
  const facts = feed().sent[0];
  assert.equal(facts.counts.watchers, 1);
  assert.equal(facts.counts.players, 2);
  assert.equal(facts.clients.find((c) => c.id === welcome.id).watch, true);
  // The Worker's word is enough: a socket opened through the watch door, whose game's helper is from before
  // revision 5 (its hello says nothing about watching), is a watcher too.
  const old = join({ watch: true }, { want: 'play' });
  assert.equal(old.last('welcome').seat, null);
  assert.deepEqual(old.last('welcome').watch, { follow: true });
  assert.equal(old.last('welcome').name, 'Watcher');
});

test('a watcher hosts only a room no player can host, and never deposes one', () => {
  const { room, join, advance } = relay({ maxPlayers: 4 });
  // Alone, a watcher runs the room (the bots go on) rather than leave it frozen.
  const w = join({}, { watch: true });
  assert.equal(w.last('welcome').role, 'host');
  // A frozen host is not deposed by a watcher's hello (a player's hello would).
  const r2 = relay({ maxPlayers: 4 });
  const host = r2.join();
  assert.equal(host.last('welcome').role, 'host');
  r2.advance(5000);
  const w2 = r2.join({}, { watch: true });
  assert.equal(w2.last('welcome').role, 'screen');
  // Election ranks every player above a watcher, whatever the watcher's tenure.
  const r3 = relay({ maxPlayers: 4 });
  const p1 = r3.join();
  const w3 = r3.join({}, { watch: true, device: 'desk' });
  r3.advance(65_000);
  for (const c of [p1, w3]) c.h.onMessage(JSON.stringify({ t: 'ping', c: 1, hid: false }));
  const p2 = r3.join({}, { device: 'phone' });
  assert.equal(p2.last('welcome').role, 'replica');
  r3.advance(1000);
  p1.h.onClose();
  assert.equal(p2.last('role')?.role, 'host', 'the phone player hosts, not the watcher who came a minute earlier');
  assert.equal(w3.last('role'), null);
  void room; void advance;
});

test('a game that cannot be watched refuses a watcher for good; an "overview" game tells it so', () => {
  const { join } = relay();
  const off = join({ watchPolicy: 'off' }, { watch: true });
  assert.equal(off.last('error').code, 'watch-off');
  assert.equal(off.last('welcome'), null);
  assert.ok(off.conn.closed);
  // The same socket as a player is fine: the rule is about watching.
  assert.equal(join({ watchPolicy: 'off' }).last('welcome').seat, 0);
  const ov = join({ watchPolicy: 'overview' }, { watch: true });
  assert.deepEqual(ov.last('welcome').watch, { follow: false, why: 'overview' });
});

test('a second tab is not a peek: a browser that holds a seat watches that room in the overview only', () => {
  const { join } = relay({ maxPlayers: 4 });
  const other = join({ browser: KEY_B });
  const w = join({ browser: KEY_A }, { watch: true });
  assert.deepEqual(w.last('welcome').watch, { follow: true });
  // The same browser takes a seat in another tab: its watching tab hears it may not follow now.
  const me = join({ browser: KEY_A });
  assert.deepEqual(w.last('watch'), { t: 'watch', follow: false, why: 'seated-here' });
  // A watcher that opens while the seat is there is told in its welcome.
  assert.deepEqual(join({ browser: KEY_A }, { watch: true }).last('welcome').watch, { follow: false, why: 'seated-here' });
  // The seat leaves: following is allowed again; somebody else's seat never mattered.
  me.h.onClose();
  assert.deepEqual(w.last('watch'), { t: 'watch', follow: true });
  assert.equal(w.all('watch').length, 2);
  void other;
});

test('the contract\'s palette is the same in the relay and the helper', () => {
  const ts = readFileSync(join(PKG, 'netplay', 'netplay.ts'), 'utf8');
  const list = JSON.parse(/export const PALETTE: readonly string\[\] = Object\.freeze\((\[[^\]]+\])\)/.exec(ts)[1].replace(/'/g, '"'));
  assert.deepEqual(list, [...NET_PALETTE]);
  assert.equal(list.length, 12);
});

/* ------------------------------------------------------------------ the helper */

let helper = null;
async function netplayModule() {
  if (helper) return helper;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'netplay.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'netplay', 'netplay.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  helper = await import(file);
  return helper;
}

/** A room and in-memory sockets to it; `conn` is what the Table would add (room key, the watch door's word). */
function memoryRoom(opts = {}, { strip = null } = {}) {
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 4, ...opts });
  const socket = (conn = {}) => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = room.attach({ ...conn, send: (t) => setTimeout(() => this.onmessage?.({ data: strip ? strip(t) : t }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(t) { this.h.onMessage(t); }
    close() { this.readyState = 3; this.h.onClose(); }
  };
  return { room, socket };
}

const cfg = (extra = {}) => ({ v: 1, url: 'ws://relay/x/__net?room=pub-1', room: 'pub-1', device: 'desk', want: 'play', ...extra });

test('netplay helper: a watcher follows a player, Auto picks one, and a player who leaves hands the view back on return', async (t) => {
  const { createNetplay } = await netplayModule();
  const { wait } = virtualTime(t);
  const { socket } = memoryRoom();
  const open = [];
  t.after(() => { for (const n of open) n.close(); });
  const make = (o, conn) => { const n = createNetplay({ post: null, game: 'x', WebSocketImpl: socket(conn), ...o }); open.push(n); return n; };
  const a = make({ config: cfg({ name: 'Ada' }) });
  await wait(40);
  let bToken = null;
  const b = make({ config: cfg({ name: 'Bo' }), post: (m) => { if (m.what === 'token') bToken = m.token; } });
  await wait(40);
  const posts = [];
  const w = make({ config: cfg({ watch: true, follow: 'auto' }), post: (m) => posts.push(m) });
  const views = [];
  w.on('view', (v) => views.push(v));
  await wait(80);
  assert.equal(w.watching, true);
  assert.equal(w.seat, null);
  assert.equal(w.role, 'screen');
  assert.deepEqual(w.players().map((p) => [p.seat, p.name]), [[0, 'Ada'], [1, 'Bo']], 'the roster, in seat order');
  assert.equal(w.canFollow, true);
  assert.equal(w.following, 'auto');
  assert.equal(w.viewSeat, 0, 'Auto with no scores and no action: the first player');
  assert.equal(a.viewSeat, 0, 'a player\'s view is their own seat');
  assert.equal(a.watching, false);
  assert.equal(a.follow(1), false, 'only a watcher follows');
  // The page is told the game draws the followed player once it reads viewSeat.
  const lastView = () => [...posts].reverse().find((m) => m.what === 'view');
  assert.equal(lastView().follows, true);
  assert.equal(lastView().canFollow, true);
  // A pick.
  assert.equal(w.follow(1), true);
  assert.equal(w.viewSeat, 1);
  assert.equal(views.at(-1).why, 'asked');
  assert.equal(lastView().following, 1);
  // The followed player leaves: Auto takes over at once...
  b.close();
  await wait(60);
  assert.equal(w.following, 'auto');
  assert.equal(w.viewSeat, 0);
  assert.equal(views.at(-1).why, 'left');
  // ...and when they come back (a reload: the same seat), their view comes back.
  const b2 = make({ config: cfg({ name: 'Bo', token: bToken }) });
  await wait(80);
  assert.equal(b2.seat, 1);
  await wait(600);
  assert.equal(w.viewSeat, 1);
  assert.equal(w.following, 1);
  assert.equal(views.at(-1).why, 'back');
  // The whole room.
  assert.equal(w.follow(null), true);
  assert.equal(w.viewSeat, null);
  // Auto from the whole room shows a player at once; from a player, it stays on them until the action moves.
  assert.equal(w.follow('auto'), true);
  assert.equal(w.viewSeat, 0);
  assert.equal(w.follow(1), true);
  assert.equal(w.follow('auto'), true);
  await wait(700);
  assert.equal(w.viewSeat, 1, 'no cut for its own sake');
});

test('netplay helper: Auto cuts to the newest spotlight after a moment, else follows the leader of the scores probe', async (t) => {
  const { createNetplay } = await netplayModule();
  const { wait } = virtualTime(t);
  const { socket } = memoryRoom();
  const open = [];
  t.after(() => { for (const n of open) n.close(); });
  const make = (o) => { const n = createNetplay({ post: null, game: 'x', WebSocketImpl: socket(), ...o }); open.push(n); return n; };
  make({ config: cfg({ name: 'Ada' }) });
  await wait(30);
  make({ config: cfg({ name: 'Bo' }) });
  await wait(30);
  make({ config: cfg({ name: 'Cy' }) });
  await wait(30);
  const w = make({ config: cfg({ watch: true }) });
  let shownAt = null;
  w.on('view', (v) => { if (v.seat === 1 && shownAt === null) shownAt = Date.now(); });
  let scores = [{ seat: 0, score: 3 }, { seat: 1, score: 9 }, { seat: 2, score: 1 }];
  w.expose({ scores: () => scores });
  await wait(80);
  assert.equal(w.viewSeat, 1, 'the leader');
  assert.ok(shownAt !== null);
  // Action on Cy: Auto has shown Bo for less than 3.5 s, so it waits, then cuts the moment Bo's time is up.
  w.spotlight(2);
  assert.equal(w.viewSeat, 1);
  await wait(shownAt + 3500 - Date.now() - 5);
  assert.equal(w.viewSeat, 1, 'the player shown keeps the view for 3.5 s');
  await wait(15);
  assert.equal(w.viewSeat, 2, 'the newest action, the moment the player shown has had 3.5 s');
  // A tie with the player shown keeps them; a new leader is looked at on the next hold.
  scores = [{ seat: 0, score: 1 }, { seat: 1, score: 1 }, { seat: 2, score: 1 }];
  w.spotlight(null);
  assert.equal(w.viewSeat, 2);
});

test('netplay helper: an "overview" game and a seat in the same browser show the whole room; an older relay says nothing', async (t) => {
  const { createNetplay } = await netplayModule();
  const { wait } = virtualTime(t);
  const open = [];
  t.after(() => { for (const n of open) n.close(); });
  {
    const { socket } = memoryRoom({}, {});
    const p = createNetplay({ post: null, config: cfg(), WebSocketImpl: socket() }); open.push(p);
    await wait(30);
    const posts = [];
    const w = createNetplay({ post: (m) => posts.push(m), config: cfg({ watch: true, follow: 0, watchPolicy: 'overview' }), WebSocketImpl: socket({ watchPolicy: 'overview' }) }); open.push(w);
    await wait(80);
    assert.equal(w.canFollow, false);
    assert.equal(w.viewSeat, null);
    assert.equal(w.follow(0), false);
    const v = [...posts].reverse().find((m) => m.what === 'view');
    assert.equal(v.canFollow, false);
    assert.equal(v.whyNot, 'overview');
  }
  {
    const { socket } = memoryRoom();
    const p = createNetplay({ post: null, config: cfg(), WebSocketImpl: socket({ browser: KEY_B }) }); open.push(p);
    await wait(30);
    const w = createNetplay({ post: null, config: cfg({ watch: true, follow: 0 }), WebSocketImpl: socket({ browser: KEY_A }) }); open.push(w);
    await wait(80);
    assert.equal(w.viewSeat, 0);
    const mine = createNetplay({ post: null, config: cfg(), WebSocketImpl: socket({ browser: KEY_A }) }); open.push(mine);
    await wait(80);
    assert.equal(w.canFollow, false, 'this browser plays in the room now');
    assert.equal(w.viewSeat, null);
    mine.close();
    await wait(80);
    assert.equal(w.canFollow, true);
    assert.equal(w.viewSeat, 0, 'and the view it asked for comes back');
  }
  {
    // A relay from before revision 5: no welcome.watch, no watch frames. Following is the page's to allow.
    const { socket } = memoryRoom({}, { strip: (t) => t.replace(/,"watch":\{[^}]*\}/, '') });
    const p = createNetplay({ post: null, config: cfg(), WebSocketImpl: socket() }); open.push(p);
    await wait(30);
    const w = createNetplay({ post: null, config: cfg({ watch: true, follow: 0 }), WebSocketImpl: socket() }); open.push(w);
    await wait(80);
    assert.equal(w.canFollow, true);
    assert.equal(w.viewSeat, 0);
  }
});

/* ------------------------------------------------------------------ the Worker */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Watch Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE, '0004_players.sql', OFFICE_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
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
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
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
    for (const [id, name, extra] of [['owl-run', 'Owl Run', {}], ['card-night', 'Card Night', { watch: 'overview' }], ['blind-duel', 'Blind Duel', { watch: false }], ['night-vault', 'Night Vault', { launch: 'private' }]]) {
      browserRulesGame(dir, id, name);
      const gj = join(dir, 'games', id, 'game.json');
      writeFileSync(gj, JSON.stringify({ ...JSON.parse(readFileSync(gj, 'utf8')), ...extra }, null, 2));
    }
    assert.equal(run(['game', 'new', 'rules-watch', '--from', 'coin-dash'], dir).status, 0);
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const env = { ASSETS: assetsOf(dir), DB, STUDIO_NAME: 'Watch Owls' };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const fetchSite = async (path, init = {}) => {
    const r = await worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  const session = 'e'.repeat(64);
  DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(session), 'session', Date.now() + 3600_000);
  /** Seat a player in a live room (the Table's own relay), as a browser's socket would. */
  const seat = async (game, room) => {
    const stub = env.TABLE.get(`${game}/${room}`);
    await stub.fetch(`https://table/__facts?game=${game}&room=${room}&max=8`);
    const table = env.TABLE.objs.get(`${game}/${room}`);
    const conn = { ver: JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8')).games.find(g => g.id === game).room.build, sent: [], ip: '203.0.113.5', send(t) { this.sent.push(JSON.parse(t)); }, close() {} };
    table.room.attach(conn).onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true }));
    table.report();
    await Promise.all(waits.splice(0));
  };
  return { env, DB, fetchSite, seat, owner: { cookie: `studio_owner=${session}` } };
}

const bootOf = (html) => JSON.parse(/window\.__HOMIE_WATCH=(\{.*?\});<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
const netOf = (html) => JSON.parse(/window\.HOMIE_NET=(\{.*?\})<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));

test('the build keeps what each game lets its watchers see', async () => {
  await site();
  const cat = JSON.parse(readFileSync(join(built, 'site', 'dist', 'games.json'), 'utf8'));
  const by = Object.fromEntries(cat.games.map((g) => [g.id, g.watch ?? 'follow']));
  assert.deepEqual(by, { 'blind-duel': 'off', 'card-night': 'overview', 'night-vault': 'follow', 'owl-run': 'follow', 'rules-watch': 'follow' });
});

test('the watch door: the game as a watcher, its frame and socket say so, and a game that says no has none', async () => {
  const { fetchSite } = await site();
  const page = await fetchSite('/owl-run/watch?room=pub-3&follow=1');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  const boot = bootOf(html);
  assert.equal(boot.game, 'owl-run');
  assert.equal(boot.policy, 'follow');
  assert.equal(boot.palette.length, 12);
  assert.match(html, /data-strip/);
  assert.match(html, /sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  // The frame boots as a watcher: a screen, following the seat the address asked for, its socket marked.
  const frame = await fetchSite(`/owl-run/__game/?room=pub-3&watch=1&follow=1&b=${KEY_A}`);
  const net = netOf(await frame.text());
  assert.equal(net.want, 'screen');
  assert.equal(net.watch, true);
  assert.equal(net.follow, 1);
  assert.equal(net.watchPolicy, 'follow');
  assert.match(net.url, new RegExp(`/owl-run/__net\\?room=pub-3&b=${KEY_A}&w=1&gv=[a-f0-9]{32}$`));
  // A bad follow is Auto; a play frame is untouched.
  assert.equal(netOf(await (await fetchSite('/owl-run/__game/?room=pub-3&watch=1&follow=<x>')).text()).follow, 'auto');
  const play = netOf(await (await fetchSite('/owl-run/__game/?room=pub-3')).text());
  assert.equal(play.want, 'play');
  assert.equal(play.watch, undefined);
  assert.doesNotMatch(play.url, /&w=1/);
  // "overview": watchable, the whole room only.
  const card = await fetchSite('/card-night/watch?room=pub-1');
  assert.equal(bootOf(await card.text()).policy, 'overview');
  assert.equal(netOf(await (await fetchSite('/card-night/__game/?room=pub-1&watch=1')).text()).watchPolicy, 'overview');
  // false: no door, no frame, no socket.
  const no = await fetchSite('/blind-duel/watch?room=pub-1');
  assert.equal(no.status, 404);
  assert.match(await no.text(), /is played, not watched/);
  assert.equal((await fetchSite('/blind-duel/__game/?room=pub-1&watch=1')).status, 403);
  assert.equal((await fetchSite('/blind-duel/__net?room=pub-1&w=1', { headers: { upgrade: 'websocket' } })).status, 403);
  assert.equal((await fetchSite('/blind-duel/api/watch')).status, 404);
  // A room code the relay cannot use is refused on the page.
  const bad = await fetchSite('/owl-run/watch?room=no%20such!');
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Watch a public room/);
});

test('a private game is watched only by whoever may play it', async () => {
  const { fetchSite, owner } = await site();
  for (const p of ['/night-vault/watch', '/night-vault/watch?room=pub-1', '/night-vault/api/watch']) assert.equal((await fetchSite(p)).status, 404, p);
  assert.equal((await fetchSite('/night-vault/__game/?room=pub-1&watch=1')).status, 403);
  assert.equal((await fetchSite('/night-vault/__net?room=pub-1&w=1', { headers: { upgrade: 'websocket' } })).status, 403);
  const mine = await fetchSite('/night-vault/watch?room=pub-1', { headers: owner });
  assert.equal(mine.status, 200);
  const boot = bootOf(await mine.text());
  assert.match(boot.t, /^[a-z0-9]+\.o\.[A-Za-z0-9_-]{32}$/, 'the owner\'s ticket rides into the frame and the sockets');
  const frame = await fetchSite(`/night-vault/__game/?room=pub-1&watch=1&t=${encodeURIComponent(boot.t)}`);
  assert.equal(frame.status, 200);
  assert.match(netOf(await frame.text()).url, /&t=.+&w=1&gv=[a-f0-9]{32}$/);
});

test('/api/watch names the busiest public room and reserves nothing; every room row carries its Watch link', async () => {
  const { fetchSite, seat, env } = await site();
  assert.deepEqual(await (await fetchSite('/owl-run/api/watch')).json(), { ok: true, game: 'owl-run', room: null, players: 0, max: 8 });
  await seat('owl-run', 'pub-1');
  await seat('owl-run', 'pub-2');
  await seat('owl-run', 'pub-2');
  await seat('card-night', 'pub-1');
  const busiest = await (await fetchSite('/owl-run/api/watch')).json();
  assert.equal(busiest.room, 'pub-2');
  assert.equal(busiest.players, 2);
  assert.equal((await (await fetchSite('/owl-run/api/watch?not=pub-2')).json()).room, 'pub-1');
  // Nothing was reserved: the Lobby still matches the next player into the fullest room with a seat.
  const lobby = await (await env.LOBBY.get('owl-run').fetch('https://lobby/rooms')).json();
  assert.deepEqual(lobby.rooms.map((r) => [r.name, r.players]).sort(), [['pub-1', 1], ['pub-2', 2]]);
  const rooms = await (await fetchSite('/api/rooms')).json();
  const row = (game, room) => rooms.rooms.find((r) => r.game === game && r.room === room);
  assert.equal(row('owl-run', 'pub-2').watch, '/owl-run/watch?room=pub-2');
  assert.equal(row('card-night', 'pub-1').watch, '/card-night/watch?room=pub-1', 'an overview game is still watched');
  const html = await (await fetchSite('/rooms/')).text();
  assert.match(html, /<a class="watchb" href="\/owl-run\/watch\?room=pub-2"[^>]*>/);
  assert.match(html, /<a class="join" href="\/owl-run\/play\?room=pub-2" data-play>Join<\/a>/);
  // The landing offers a live room to watch while somebody plays.
  const landing = await (await fetchSite('/owl-run/')).text();
  assert.match(landing, /href="\/owl-run\/watch"[^>]*>.*Watch a live room/s);
  // The watch page counts as a watch, never as a play.
  await fetchSite('/owl-run/watch?room=pub-2', { headers: { 'sec-fetch-dest': 'document' } });
  const counted = env.DB.sql.prepare("SELECT metric, n FROM stats_daily WHERE subject = 'owl-run' AND metric IN ('watch', 'play')").all();
  assert.deepEqual(counted.map((r) => [r.metric, r.n]), [['watch', 1]]);
});

test('server rules watch page and door boot a screen with no seat', async () => {
  const { fetchSite } = await site();
  const page = await fetchSite('/rules-watch/watch?room=pub-1'); assert.equal(page.status, 200);
  const boot = bootOf(await page.text());
  assert.equal(boot.game, 'rules-watch');
  const frame = await fetchSite('/rules-watch/__game/?room=pub-1&watch=1');
  assert.equal(frame.status, 200);
  const net = netOf(await frame.text()); assert.equal(net.watch, true);
});

test('server host ignores watcher inputs, commands, asks, decisions and votes', async () => {
  const { loadGame, writeGame, roomRig } = await import('./rules-kit.mjs');
  const { source, vocab } = await import('./rules-feature-kit.mjs');
  const L = await loadGame(scratch, writeGame(scratch, 'watch-rules', { rules: source }), 'watch-rules');
  const r = roomRig(L, L.R.compileRules(L.def, { seats: 4 }), { maxPlayers: 4 });
  r.room.setVocabulary(vocab); const p = r.conn(); p.hello(); const w = r.conn(); w.hello('Watcher', { watch: true, want: 'watch' }); r.run(100);
  const state = r.host.core.save();
  for (const m of [{ t: 'in', e: r.host.epoch, k: r.host.tick + 1, s: [[0, 127]] }, { t: 'ev', k: 'cmd', d: ['ask', {}] }, { t: 'ev', k: 'ask:follow', d: { slot: 3, args: { seat: 0 } } }, { t: 'ev', k: 'agent:do', d: { goal: 'guard' } }, { t: 'vote', level: 5 }]) w.say(m);
  assert.deepEqual(r.host.core.save(), state); assert.equal(r.room.vote, null); r.host.stop();
});
