/**
 * @homie-rocks/studio 0.16.0: servers (worker/servers.mjs), agent passes and the sit route (worker/agents.mjs).
 *
 *   - rooms and servers: pub-N is the public server's, s-<id>-<n> a server's; a policy's AI seats leave one person's
 *     seat at least, and kids caps the dial;
 *   - doors: an account door, an invite door (a server's own invite), the beginner check (new accounts, a level
 *     ceiling, mentors), the owner always, a watcher never held to the beginner check;
 *   - passes and tickets: a pass is shown once and stored hashed; an `a-` ticket round-trips; a revoked, ended or
 *     out-of-scope pass is refused; the Worker refuses an AI's socket to a humans-only server (403) before the relay;
 *   - the sit route: never a room with nobody in it, never a humans-only server; a ticket, the socket and the frame;
 *   - Lobby pools: strangers never meet across servers; a full server's visitor waits in its fullest room;
 *   - the office: creating a server happens at once; narrowing it (humans-only) from an office key is an ASK the
 *     owner confirms with one tap, and its live rooms hear the new policy; no key can confirm; removing a member asks;
 *   - the site: the Servers band, /<game>/servers/, a server's page and every door page escape the owner's words;
 *     rooms in lists say their server and their AI;
 *   - the build: a game's netplay revision (the office's "predates servers") and game.json server seeds;
 *   - 0.17.0, AI guides at the Table: the owner's consent, house guides seated, a decision on the alarm with Workers AI
 *     (a stand-in binding), its neurons in stats_daily, the office's budget and decisions, a budget of 0 going
 *     scripted, a raised dollar cap asked of the owner, AI talk off standing the guides; the build refuses a bad
 *     agents.json.
 * The D1 is node:sqlite with the studio's own migrations; the Durable Objects are the real Table and Lobby.
 * Run: node --test packages/studio/test/servers.test.mjs
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

test('rooms and servers: pub-N is the public server\'s, s-<id>-<n> a server\'s, any named room takes the public rules', () => {
  assert.equal(roomServer('pub-3'), 'public');
  assert.equal(roomServer('s-night-shift-12'), 'night-shift');
  assert.equal(roomServer('my-party'), 'public');
  for (const [server, n] of [['public', 1], ['night-shift', 7], ['a1', 999]]) assert.equal(roomServer(roomCode(server, n)), server);
  assert.equal(pooledRoom('s-night-shift-2'), true);
  assert.equal(pooledRoom('friends'), false);
  assert.ok(roomCode('abcdefghijklmnopqrst', 123456789).length <= 32, 'the longest server room still fits a room code');
});

test('a policy leaves at least one person\'s seat; kids caps the dial at 3 and keeps speech to quick lines', () => {
  const hybrid = serverOf({ id: 'night-shift', name: 'Night Shift', policy: 'hybrid', ai_seats: 12 });
  assert.equal(policyOf(hybrid, { seats: 8 }).aiSeats, 7, 'AI seats are at most the seats less one');
  const beg = serverOf({ id: 'first-light', name: 'First Light', policy: 'beginner', guides: 2, kids: 1, level_max: 5, level: 5, speech: 'game' });
  const p = policyOf(beg, { seats: 8 });
  assert.equal(p.kids, true);
  assert.equal(p.levelMax, 3);
  assert.equal(p.level, 3);
  assert.equal(p.speech, 'lines');
  assert.equal(p.guides, 2);
  const humans = serverOf({ id: 'people-only', name: 'People Only', policy: 'humans-only', ai_seats: 3 });
  assert.equal(humans.bots, 'off', 'humans-only: the game\'s bots are off unless the owner turns them on');
  assert.equal(policyOf(humans).aiSeats, 0);
  assert.equal(policyOf(humans).brain, 'off');
  assert.equal(policyOf(null, { named: true }).server, null, 'a named room takes the public server\'s rules');
  assert.equal(PUBLIC_SERVER.policy, 'open');
  const c = checkServer({ name: 'Night Shift', policy: 'hybrid', aiSeats: 2 }, { create: true });
  assert.equal(c.fields.id, 'night-shift');
  assert.equal(checkServer({ name: 'x', policy: 'chaos' }, { create: true }).ok, false);
  assert.equal(checkServer({ name: 'Public', id: 'public', policy: 'open' }, { create: true }).ok, false);
  const before = serverOf({ id: 'nn', name: 'N', policy: 'hybrid', ai_seats: 2, door: 'open', rooms_max: 4 });
  assert.equal(narrows(before, { policy: 'humans-only' }), true);
  assert.equal(narrows(before, { door: 'accounts' }), true);
  assert.equal(narrows(before, { rooms: 2 }), true);
  assert.equal(narrows(before, { aiSeats: 3, name: 'Night' }), false, 'more AI seats, a new name: at once');
  assert.equal(narrows(serverOf({ id: 'nn', name: 'N', policy: 'humans-only' }), { policy: 'hybrid' }), false, 'letting AI in widens');
  assert.equal(fillSpot(), null, 'the fill-a-spot service is a hook only (money: the owner\'s decision)');
});

/* ------------------------------------------------------------------ the Worker */

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
    writeFileSync(join(dir, 'games/rules-run/src/view.ts'), "import { openRoom } from '@homie-rocks/studio/rules/view'; openRoom();\n");
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

test('the office makes servers at once; their pages, the Servers band and the lists escape the owner\'s words', async () => {
  const { fetchSite, post, key } = await site();
  let r = await post('/_studio/api/servers', { game: 'owl-run', name: 'Night Shift', policy: 'hybrid', aiSeats: 2, blurb: EVIL });
  let j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.server.id, 'night-shift');
  assert.equal(j.server.badge, 'Hybrid · 2');
  assert.match(j.notes.join(' '), /2 seats in every room are AI companions/);
  r = await post('/_studio/api/servers', { game: 'owl-run', name: EVIL, id: 'evil', policy: 'open' });
  assert.equal(r.status, 200);
  r = await post('/_studio/api/servers', { game: 'owl-run', name: 'People Only', policy: 'humans-only' });
  assert.equal((await r.json()).server.bots, 'off');
  r = await post('/_studio/api/servers', { game: 'owl-run', name: 'Night Shift', policy: 'open' });
  assert.equal((await r.json()).error, 'exists');
  // The list, with the build's revision (a 0.16.0 build: it reads the dial) and the seed of another game.
  const list = await (await fetchSite('/_studio/api/servers', { headers: key })).json();
  const owl = list.games.find((g) => g.id === 'owl-run');
  assert.deepEqual(owl.servers.map((s) => s.id), ['public', 'night-shift', 'evil', 'people-only']);
  assert.equal(owl.build.netplayRev, 11, 'revision 11: explicit rules output (section 29)');
  assert.equal(owl.build.predates, false);
  const vale = list.games.find((g) => g.id === 'vale');
  assert.equal(vale.servers.find((s) => s.id === 'hearth').from, 'game.json');
  assert.equal(list.fillSpot.available, false, 'the fill-a-spot toggle is off: coming later');
  // Pages: escaped everywhere.
  for (const path of ['/owl-run/', '/owl-run/servers/', '/owl-run/s/evil/', '/owl-run/s/night-shift/']) {
    const res = await fetchSite(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.doesNotMatch(html, /<img src=x/, `${path} escapes the owner's words`);
    if (path === '/owl-run/') assert.match(html, /data-servers-band/);
  }
  const page = await (await fetchSite('/owl-run/s/night-shift/')).text();
  assert.match(page, /Hybrid: 2 seats in every room are AI companions, always marked AI\. Your party sets their level\./);
  assert.match(page, /\/owl-run\/s\/night-shift\/play/);
  const api = await (await fetchSite('/owl-run/api/servers')).json();
  assert.deepEqual(api.servers.map((s) => s.id), ['public', 'night-shift', 'evil', 'people-only']);
  assert.equal((await fetchSite('/owl-run/s/nope/')).status, 404);
});

test('Lobby pools: strangers never meet across servers; a full server\'s visitor waits in its fullest room', async () => {
  const { fetchSite, post, seat, servers } = await site();
  await servers();
  await post('/_studio/api/servers', { game: 'owl-run', name: 'Tiny', policy: 'open', rooms: 1 });
  const join = async (q) => (await fetchSite(`/owl-run/api/lobby${q}`, { method: 'POST' })).json();
  const a = await join('?server=night-shift');
  assert.match(a.room, /^s-night-shift-\d+$/);
  assert.equal(a.max, 6, 'a hybrid room matches people into its 6 people\'s seats (2 are the AI\'s)');
  const p = await join('');
  assert.match(p.room, /^pub-\d+$/, 'Quick play is the public server');
  // People in a room of Tiny: the next visitor joins it, and when its one room is full, waits there.
  const t1 = await join('?server=tiny');
  for (let i = 0; i < 8; i += 1) await seat('owl-run', t1.room, { browser: `browser${String(i).padStart(14, 'x')}` });
  const t2 = await join('?server=tiny');
  assert.equal(t2.room, t1.room);
  assert.equal(t2.full, true, 'its rooms are all full: the fullest one, where the visitor waits for a seat');
  assert.equal((await join('?server=nope')).error, 'no-server');
  // /api/rooms says each room's server and AI (the relay counts AI bodies apart from people).
  const rooms = await (await fetchSite('/api/rooms')).json();
  const row = rooms.rooms.find((r) => r.room === t1.room);
  assert.equal(row.server.id, 'tiny');
  assert.equal(row.policy, 'open');
  assert.equal(row.players, 8);
});

test('doors: an account door, a server\'s own invite, the beginner check (mentors in, veterans out), the owner always', async () => {
  const { env, fetchSite, post, player, owner, same } = await site();
  await post('/_studio/api/servers', { game: 'vale', name: 'Accounts Only', policy: 'open', door: 'accounts' });
  await post('/_studio/api/servers', { game: 'vale', name: 'Secret Grove', policy: 'open', door: 'invite' });
  await post('/_studio/api/servers', { game: 'vale', name: 'First Light', policy: 'beginner', guides: 2, kids: true });
  // The account door.
  let r = await fetchSite('/vale/s/accounts-only/play');
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Sign in to play on Accounts Only/);
  const acct = player(3);
  r = await fetchSite('/vale/s/accounts-only/play', { headers: { cookie: acct.cookie } });
  assert.equal(r.status, 200);
  const boot = JSON.parse(/window\.__HOMIE_PLAY=(\{.*?\});<\/script>/.exec(await r.text())[1].replace(/\\u003c/g, '<'));
  assert.equal(boot.server.id, 'accounts-only');
  assert.match(boot.t, /\.p-pl_/, 'the frame and sockets carry the account (the socket\'s door)');
  const guest = player(0, { guest: true });
  assert.equal((await fetchSite('/vale/s/accounts-only/play', { headers: { cookie: guest.cookie } })).status, 403, 'a guest is not an account');
  assert.equal((await fetchSite('/vale/s/accounts-only/play', { headers: owner })).status, 200, 'the owner always comes in');
  // The invite door: a server's own invite code is spent for this browser's pass to that server.
  r = await fetchSite('/vale/s/secret-grove/play');
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Secret Grove is invite-only/);
  const inv = await (await post('/_studio/api/invites', { game: 'vale', server: 'secret-grove', label: 'a friend' })).json();
  assert.equal(inv.invites[0].server, 'secret-grove');
  assert.match(inv.invites[0].link, /\/vale\/s\/secret-grove\/play\?invite=/);
  const code = inv.invites[0].code;
  r = await fetchSite('/vale/invite', { method: 'POST', headers: { origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${code}` });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/vale/s/secret-grove/play');
  const passCookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(passCookie, /^studio_pass_vale\.secret-grove=/);
  assert.equal((await fetchSite('/vale/s/secret-grove/play', { headers: { cookie: passCookie } })).status, 200);
  // The beginner check: a new account and a guest come in; a veteran does not; a mentor does.
  const fresh = player(2);
  const veteran = player(40);
  assert.equal((await fetchSite('/vale/s/first-light/play')).status, 200, 'a guest (no account) is new');
  assert.equal((await fetchSite('/vale/s/first-light/play', { headers: { cookie: fresh.cookie } })).status, 200);
  r = await fetchSite('/vale/s/first-light/play', { headers: { cookie: veteran.cookie } });
  assert.equal(r.status, 403);
  assert.match(await r.text(), /First Light is for new players\. You&#39;ve been playing Vale for 40 days: try another server or Quick play\./);
  const ask = await (await post('/_studio/api/servers/member', { game: 'vale', server: 'first-light', player: veteran.id, role: 'mentor' })).json();
  assert.equal(ask.ok, true, 'making a mentor happens at once');
  const mentor = await fetchSite('/vale/s/first-light/play', { headers: { cookie: veteran.cookie } });
  assert.equal(mentor.status, 200);
  assert.match(await mentor.text(), /"mentor":true/);
  assert.equal((await fetchSite('/vale/watch?room=s-first-light-1', { headers: { cookie: player(90).cookie } })).status, 200, 'a veteran may watch a beginner room');
  // The level ceiling (player stats), and a direct check of the rules.
  const env2 = { DB: env.DB };
  const srv = serverOf({ id: 'fl', name: 'FL', policy: 'beginner', beginner_level: 10 });
  env.DB.sql.prepare("INSERT INTO player_stats (player, game, name, n, updated_at) VALUES (?, 'vale', 'level', 12, ?)").run(fresh.id, Date.now());
  assert.equal((await serverAccess(env2, { game: 'vale', server: srv, holders: [`p-${fresh.id}`] })).why, 'veteran');
  assert.equal((await serverAccess(env2, { game: 'vale', server: srv, holders: ['o'] })).ok, true);
  assert.equal((await serverAccess(env2, { game: 'vale', server: { ...srv, state: 'closed' }, holders: [] })).why, 'closed');
  // The player's own servers: join, home, leave (a same-origin POST, signed in).
  r = await fetchSite('/vale/s/first-light/home', { method: 'POST', headers: { ...same, cookie: fresh.cookie }, body: JSON.stringify({ join: true, home: true }) });
  assert.equal((await r.json()).home, true);
  const me = await (await fetchSite('/api/player/me', { headers: { cookie: fresh.cookie } })).json();
  assert.deepEqual(me.player.servers.map((m) => [m.server, m.home]), [['first-light', true]]);
  assert.equal((await fetchSite('/vale/s/first-light/home', { method: 'POST', headers: { 'content-type': 'application/json', cookie: fresh.cookie }, body: '{}' })).status, 403, 'only from the site\'s own page');
  // A bare Play goes to the player's home server.
  const home = await (await fetchSite('/vale/play', { headers: { cookie: fresh.cookie } })).text();
  assert.match(home, /"server":\{"id":"first-light"/);
  // Deleting the player deletes their memberships.
  await players.remove(env, fresh.id);
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM server_members WHERE player = ?').get(fresh.id).n, 0);
});

test('passes and tickets: shown once, stored hashed; revoked, ended or out of scope refused; an a- ticket names its pass', async () => {
  const { env } = await site();
  const made = await passCreate(env, { label: 'Claude', game: 'owl-run', days: 7 });
  assert.equal(made.ok, true);
  assert.match(made.secret, /^hap_[a-f0-9]{10}_[A-Za-z0-9_-]{40}$/);
  assert.equal(made.pass.name, 'Claude · AI');
  const row = env.DB.sql.prepare('SELECT * FROM agent_passes WHERE id = ?').get(made.pass.id);
  assert.equal(row.hash, sha(made.secret), 'only the SHA-256 of the pass is kept');
  assert.doesNotMatch(JSON.stringify(row), new RegExp(made.secret.slice(-40)));
  assert.equal((await passOf(env, made.secret)).id, made.pass.id);
  assert.equal(await passOf(env, made.secret.replace(/.$/, made.secret.endsWith('a') ? 'b' : 'a')), null);
  const t = await ticketFor(env, 'owl-run', `a-${made.pass.id}`);
  assert.equal(await ticketSub(env, 'owl-run', t), `a-${made.pass.id}`);
  const humans = { kind: 'humans-only' };
  assert.equal(passRefusal(made.pass, { game: 'owl-run', server: 'people-only', policy: humans }).error, 'agents-off');
  assert.equal(passRefusal(made.pass, { game: 'vale', server: 'public', policy: { kind: 'open' } }).error, 'agent-scope');
  assert.equal(passRefusal(made.pass, { game: 'owl-run', server: 'public', policy: { kind: 'open' }, launch: 'private' }), null, 'the owner\'s own pass opens a private game');
  assert.equal((await passCreate(env, { label: 'Spot', kind: 'service' })).error, 'service', 'nothing issues fill-a-spot passes yet');
  await passRevoke(env, made.pass.id);
  assert.equal(await passOf(env, made.secret), null, 'a revoked pass seats nobody');
  env.DB.sql.prepare('UPDATE agent_passes SET revoked = 0, expires_at = ? WHERE id = ?').run(Date.now() - 1, made.pass.id);
  assert.equal(await passOf(env, made.secret), null, 'an ended pass seats nobody');
});

test('the sit route and the socket: never an empty room, never a humans-only server (403 at the Worker, again at the relay)', async () => {
  const { fetchSite, post, seat, servers } = await site();
  await servers();
  const made = await (await post('/_studio/api/agents/pass', { action: 'create', game: 'owl-run', label: 'Claude', days: 7 })).json();
  assert.equal(made.ok, true);
  assert.match(made.use, /only time the pass is shown/);
  const listed = await (await post('/_studio/api/agents/pass', { action: 'list', game: 'owl-run' })).json();
  assert.ok(listed.passes.some((p) => p.id === made.pass.id));
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(made.secret), 'a pass is never shown again');
  const sit = (body, secret = made.secret) => fetchSite('/owl-run/api/agent', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await sit({ server: 'night-shift' }, 'hap_0000000000_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).status, 401);
  let r = await sit({ server: 'night-shift' });
  assert.equal(r.status, 409, 'nobody plays on Night Shift yet: an AI never starts a room');
  assert.match((await r.json()).message, /never starts a room/);
  r = await sit({ server: 'people-only' });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).message, 'This server is for humans only');
  // People on Night Shift: the AI gets their room, its ticket, the socket and the frame.
  const room = (await (await fetchSite('/owl-run/api/lobby?server=night-shift', { method: 'POST' })).json()).room;
  const person = await seat('owl-run', room, { caps: ['agents', 'skill'] });
  r = await sit({ server: 'night-shift' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.room, room);
  assert.equal(j.name, 'Claude · AI');
  assert.match(j.ws, new RegExp(`^wss://owls\\.example/owl-run/__net\\?room=${room}&t=`));
  assert.match(j.frame, /\/owl-run\/__game\/\?room=/);
  // The frame plays as the AI; its socket carries the pass's facts and the policy to the Table.
  const frame = await (await fetchSite(new URL(j.frame).pathname + new URL(j.frame).search)).text();
  const cfg = JSON.parse(/window\.HOMIE_NET=(\{.*?\})<\/script>/.exec(frame)[1].replace(/\\u003c/g, '<'));
  assert.deepEqual(cfg.agent, { hands: 'self', role: 'party' });
  assert.equal(cfg.name, 'Claude · AI');
  // The socket: a humans-only room refuses the AI's ticket at the Worker (403) — the relay would say agents-off.
  const ticket = j.ticket;
  r = await fetchSite(`/owl-run/__net?room=s-people-only-1&t=${encodeURIComponent(ticket)}`, { headers: { upgrade: 'websocket' } });
  assert.equal(r.status, 403);
  assert.equal(await r.text(), 'This server is for humans only\n');
  assert.equal((await fetchSite(`/owl-run/__net?room=s-nowhere-1`, { headers: { upgrade: 'websocket' } })).status, 404, 'a server that does not exist has no rooms');
  void person;
});

test('the Worker hands the Table the policy and the AI\'s facts: the room applies them and seats the AI as one', async () => {
  const { env, fetchSite, seat, servers, post } = await site();
  await servers();
  const room = (await (await fetchSite('/owl-run/api/lobby?server=night-shift', { method: 'POST' })).json()).room;
  await seat('owl-run', room, { caps: ['agents'] });
  const table = env.TABLE.objs.get(`owl-run/${room}`);
  assert.equal(table.room.policy.kind, 'open', 'a room opened by a test seat has not heard from the Worker yet');
  const made = await (await post('/_studio/api/agents/pass', { action: 'create', game: 'owl-run', label: 'Claude', days: 1 })).json();
  const sat = await (await fetchSite('/owl-run/api/agent', { method: 'POST', headers: { authorization: `Bearer ${made.secret}` }, body: '{"server":"night-shift"}' })).json();
  // A socket through the Worker, as workerd would open it (Node has no WebSocketPair and no 101 Response).
  class FakeSocket { constructor() { this.listeners = {}; this.sent = []; } accept() {} send(t) { this.sent.push(JSON.parse(t)); } close() { this.closed = true; } addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); } emit(k, e) { for (const fn of this.listeners[k] ?? []) fn(e); } }
  const ends = [];
  globalThis.WebSocketPair = class { constructor() { const c = new FakeSocket(); const s2 = new FakeSocket(); ends.push(s2); return { 0: c, 1: s2 }; } };
  try {
    await fetchSite(`/owl-run/__net?room=${room}&t=${encodeURIComponent(sat.ticket)}`, { headers: { upgrade: 'websocket' } }).catch((e) => { if (!/status/.test(String(e))) throw e; });
    assert.equal(table.room.policy.kind, 'hybrid', 'the Worker\'s policy for Night Shift reached the room');
    assert.equal(table.room.policy.aiSeats, 2);
    const end = ends.at(-1);
    end.emit('message', { data: JSON.stringify({ t: 'hello', v: 1, rev: 6, want: 'play', canHost: true, name: 'Not a robot', agent: { hands: 'self', role: 'party' } }) });
    const welcome = end.sent.find((m) => m.t === 'welcome');
    assert.equal(welcome.name, 'Claude · AI', 'named by its pass, whatever its hello says');
    assert.equal(welcome.seat, 7, 'in a seat kept for AI');
    assert.equal(welcome.agent.pass, made.pass.id);
    assert.equal(welcome.policy.kind, 'hybrid');
    assert.equal(table.room.facts().counts.agents, 1);
    assert.equal(table.room.facts().counts.players, 1, 'the Lobby counts people only');
  } finally {
    delete globalThis.WebSocketPair;
    if (table.timer) { clearInterval(table.timer); table.timer = null; }
  }
});

test('the office: narrowing a server from an office key is an ASK the owner confirms with one tap, and its rooms hear it; no key can confirm', async () => {
  const { env, fetchSite, post, seat, owner, key } = await site();
  await post('/_studio/api/servers', { game: 'owl-run', name: 'Twilight', policy: 'hybrid', aiSeats: 1 });
  const room = (await (await fetchSite('/owl-run/api/lobby?server=twilight', { method: 'POST' })).json()).room;
  await seat('owl-run', room);
  let r = await post('/_studio/api/servers/set', { game: 'owl-run', server: 'twilight', policy: 'humans-only' });
  let j = await r.json();
  assert.equal(r.status, 202, JSON.stringify(j));
  assert.equal(j.needs, 'owner');
  assert.match(j.ask.what, /make it humans-only \(its AI players leave after the current round, and no AI can join\)/);
  // An office key cannot confirm it; the owner's signed-in browser does, with one tap.
  assert.equal((await fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { authorization: 'Bearer x', 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' })).status, 401);
  r = await fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { ...owner, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Done\./);
  const table = env.TABLE.objs.get(`owl-run/${room}`);
  assert.equal(table.room.policy.kind, 'humans-only', 'the live room heard the new policy (a signed control)');
  // A widening change from an office key happens at once.
  r = await post('/_studio/api/servers/set', { game: 'owl-run', server: 'twilight', policy: 'hybrid', aiSeats: 2 });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(table.room.policy.kind, 'hybrid');
  // Removing a member, and closing a server: asks.
  assert.equal((await post('/_studio/api/servers/member', { game: 'owl-run', server: 'twilight', player: 'pl_xxxxxxxxxxxxxxxxxxxxxx', remove: true })).status, 202);
  assert.equal((await post('/_studio/api/servers/close', { game: 'owl-run', server: 'twilight' })).status, 202);
  assert.equal((await post('/_studio/api/servers/close', { game: 'owl-run', server: 'twilight', reopen: true })).status, 200, 'reopening gives something back: at once');
  // The room's dial, from the office: at once.
  r = await post('/_studio/api/room-level', { game: 'owl-run', room, level: 2 });
  j = await r.json();
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.equal(table.room.policyOut().skill.name, 'Steady');
  // The office view: servers, live counts, passes (never a secret), the build, the fill-a-spot note.
  const view = await (await fetchSite('/_studio/api/office', { headers: key })).json();
  const owl = view.games.find((g) => g.id === 'owl-run');
  assert.ok(owl.servers.find((s) => s.id === 'twilight'));
  assert.equal(owl.rooms.find((x) => x.room === room).policy.levelName, 'Steady');
  assert.equal(owl.rooms.find((x) => x.room === room).server, 'twilight');
  // The first time AI guides may talk: the owner's consent.
  r = await post('/_studio/api/agents/brain', { game: 'owl-run', server: 'twilight', mode: 'workers-ai' });
  assert.equal(r.status, 202);
  assert.match((await r.json()).ask.what, /Let the AI guides on Owl Run's server twilight talk/);
  r = await post('/_studio/api/agents/brain', { game: 'owl-run', server: 'twilight', mode: 'script' });
  assert.equal(r.status, 200, 'scripted (silent) guides: at once');
});

test('the build knows a game\'s netplay revision: a build without the helper\'s mark predates servers', async () => {
  const { dir } = await site();
  const { netplayRevOf } = await import('../lib/build.mjs');
  assert.equal(netplayRevOf(join(dir, 'site', 'dist', 'games', 'owl-run')), 11);
  const old = join(scratch, 'old-build');
  mkdirSync(join(old, 'assets'), { recursive: true });
  writeFileSync(join(old, 'assets', 'main.js'), 'console.log("netplay v1, revision 5")');
  assert.equal(netplayRevOf(old), null);
  const cat = JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8'));
  assert.deepEqual(cat.games.find((g) => g.id === 'vale').servers.map((s) => s.id), ['hearth']);
  assert.ok(SERVERS_MIGRATION.includes('ALTER TABLE office_invites ADD COLUMN server TEXT;'));
});

/* ------------------------------------------------------------------ 0.17.0: AI guides at the Table */

test('AI guides at the Table: consent, house guides, a Workers AI decision on the alarm, its neurons counted, the budget, talk off', async (t) => {
  // The clock is the test's: the guides' 3 s between decisions passes when the test says, not on the wall.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { env, DB, fetchSite, seat, owner, post, waits } = await site();
  const calls = [];
  // Workers AI, stood in: Clef (the default since 0.24.4) answers typed questions with a probability for each option.
  const lean = { goal: 'quest', 'arg.quest': 'slime-hunt', say: 'quest_help' };
  const answer = (questions) => Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    if (q.type === 'noul') return [id, { type: 'noul', noul: 0.3 }];
    const keys = Object.keys(q.criteria);
    const pick = keys.includes(lean[id]) ? lean[id] : keys[0];
    return [id, { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.9 : 0.1 / (keys.length - 1)])), confidence: 0.8 }];
  }));
  env.AI = { run: async (model, input) => { calls.push({ model, input }); return input.questions ? { model: input.model, answers: answer(input.questions), usage: { input_tokens: 1000, output_tokens: 0 } } : { response: { goal: 'quest', args: { quest: 'slime-hunt' }, say: 'quest_help', sayArgs: { quest: 'slime-hunt' } }, usage: { prompt_tokens: 700, completion_tokens: 40 } }; } };
  let r = await post('/_studio/api/servers', { game: 'vale', name: 'First Steps', policy: 'beginner', guides: 2 });
  assert.equal(r.status, 200);
  assert.match((await r.json()).notes.join(' '), /agents brain vale first-steps workers-ai/, 'making the server says how its guides talk');
  r = await post('/_studio/api/agents/brain', { game: 'vale', server: 'first-steps', mode: 'workers-ai', budget: 1000 });
  let j = await r.json();
  assert.equal(r.status, 202, 'the first time AI talk is turned on is the owner\'s consent');
  assert.match(j.ask.what, /at most 1,000 neurons a day/);
  r = await fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { ...owner, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://owls.example' }, body: 'do=yes' });
  assert.equal(r.status, 200);
  const room = (await (await fetchSite('/vale/api/lobby?server=first-steps', { method: 'POST' })).json()).room;
  assert.match(room, /^s-first-steps-\d+$/);
  const host = await seat('vale', room, { caps: ['agents', 'skill'] });
  const table = host.table;
  // The policy the Worker hands every socket of this server (seat() attaches straight to the room).
  table.room.setPolicy({ ...policyOf(serverOf({ id: 'first-steps', name: 'First Steps', policy: 'beginner', guides: 2, brain: 'workers-ai', updatedAt: Date.now() }), { seats: 8 }) });
  await table.vocabRead;
  table.syncHouse();
  await Promise.all(waits.splice(0));
  const guides = table.room.live().filter((c) => c.agent);
  assert.deepEqual(guides.map((c) => c.name), ['Wren · AI', 'Ash · AI'], 'two house guides sit, named from the game\'s agents.json');
  assert.equal(table.room.facts().counts.players, 1);
  // The host shows a guide the game, and its person asks for help: the brain decides on the alarm.
  const g = guides[0].seat;
  host.h.onMessage(JSON.stringify({ t: 'ev', k: 'agent:view', to: g, d: { quests: ['slime-hunt', 'king-slime'], party: [{ seat: 0, dist: 90 }], zone: 'camp' } }));
  host.h.onMessage(JSON.stringify({ t: 'ev', k: 'ask:ask_help', to: g, d: { slot: 0, seat: g, args: { quest: 'slime-hunt' } } }));
  assert.ok(Number.isFinite(table.ctx.storage ? 1 : 0));
  await table.alarm();
  assert.equal(calls.length >= 1, true, 'Workers AI was asked');
  assert.equal(calls[0].model, '@cf/cloudflare/clef-flash');
  assert.equal(calls[0].input.model, 'clef-flash', 'the decision model is asked questions, not sent a prompt');
  assert.doesNotMatch(JSON.stringify(calls[0].input), /owls\.example|hsk_|pl_|studio_/, 'nothing about a person or the studio\'s keys in the prompt');
  const said = host.conn.sent.filter((m) => m.t === 'ev' && m.from === g).map((m) => m.k);
  assert.deepEqual(said, ['agent:do', 'say:quest_help'], 'the decision reached the host as a goal and a line');
  await table.flushBrain(true);
  const counted = Object.fromEntries(DB.sql.prepare("SELECT metric, SUM(n) AS n FROM stats_daily WHERE metric LIKE 'brain-%' GROUP BY metric").all().map((x) => [x.metric, x.n]));
  assert.equal(counted['brain-calls'], calls.length);
  assert.ok(counted['brain-neurons'] >= 4 * calls.length, JSON.stringify(counted));
  // The office: the day's budget and what it used, the room's guides and their decisions.
  const view = await (await fetchSite('/_studio/api/office', { headers: { authorization: `Bearer hsk_${'0e'.repeat(24)}` } })).json();
  assert.equal(view.brain.budget.neurons, 1000);
  assert.ok(view.brain.used.neurons >= 4);
  assert.equal(view.brain.ai, true);
  const rr = view.games.find((x) => x.id === 'vale').rooms.find((x) => x.room === room);
  assert.equal(rr.brains.brain, 'workers-ai');
  assert.equal(rr.brains.decisions.at(-1).provider, 'workers-ai');
  assert.equal(view.games.find((x) => x.id === 'vale').vocab, true);
  // A budget of 0: the guides answer from the script; Workers AI is not asked.
  r = await post('/_studio/api/agents/brain', { game: 'vale', server: 'first-steps', mode: 'workers-ai', budget: 0 });
  assert.equal(r.status, 200, 'lowering the budget happens at once');
  await table.readBrainDay();
  const before = calls.length;
  t.mock.timers.tick(3100);
  host.h.onMessage(JSON.stringify({ t: 'ev', k: 'ask:lead_me', to: g, d: { slot: 0, seat: g, args: { place: 'camp' } } }));
  await table.alarm();
  assert.equal(calls.length, before, 'no Workers AI call over budget');
  const last = table.house.decisions.at(-1);
  assert.equal(last.provider, 'script');
  assert.equal(last.goal, 'lead');
  assert.match(last.why, /budget is spent/);
  // The owner's own key: raising the day's dollar cap is the owner's to confirm; lowering it is not.
  r = await post('/_studio/api/agents/brain', { game: 'vale', server: 'first-steps', mode: 'owner-key', budget: 5 });
  assert.equal(r.status, 202, 'more of the owner\'s money: asked');
  r = await post('/_studio/api/agents/brain', { game: 'vale', server: 'first-steps', mode: 'owner-key', budget: 0.5 });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.match(j.note, /homie-studio agents brain key/, 'no key yet: how to set it, on the owner\'s own computer');
  // AI talk off: the room hears it at once and the guides stand.
  r = await post('/_studio/api/agents/brain', { game: 'vale', server: 'first-steps', mode: 'script' });
  assert.equal(r.status, 200);
  await Promise.all(waits.splice(0));
  assert.equal(table.room.policy.brain, 'script');
  assert.equal(table.room.live().filter((c) => c.agent).length, 0, 'talk off: the house guides stand at once');
});

test('the build refuses an agents.json that is not a vocabulary, and serves a good one beside the game', async () => {
  const dir = studio('vocab');
  assert.equal(run(['game', 'new', 'vale', '--from', 'ember-vale', '--name', 'Vale'], dir).status, 0);
  let b = JSON.parse(run(['build'], dir).stdout);
  assert.equal(b.ok, true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games', 'vale', 'agents.json'), 'utf8')).v, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8')).games[0].vocab, true);
  const file = join(dir, 'games', 'vale', 'agents.json');
  const v = JSON.parse(readFileSync(file, 'utf8'));
  v.goals.attack = { about: 'attack a player', args: { seat: 'player' } };
  v.lines.rude = { text: 'x'.repeat(130) };
  writeFileSync(file, JSON.stringify(v));
  b = JSON.parse(run(['build'], dir).stdout);
  assert.equal(b.ok, false);
  assert.match(b.why, /agents\.json: goals\.attack: a guide never acts against a player .*; lines\.rude: text is over 120 characters/);
});

// The socket endpoint, policy lookup, pass verification and signed controls all pass through the real Worker/Table.
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

for (const kind of ['open', 'humans-only', 'hybrid', 'beginner', 'kids']) test(`server rules through Worker: ${kind}, controls, round stats and AI-only pause`, async t => {
  const s = await rulesSockets(t);
  const spec = { game: 'rules-run', name: `Rules ${kind}`, id: `rules-${kind}`, policy: kind === 'kids' ? 'beginner' : kind, ...(kind === 'kids' ? { kids: true } : {}), ...(kind === 'hybrid' ? { aiSeats: 2 } : {}), ...(['beginner', 'kids'].includes(kind) ? { guides: 1 } : {}) };
  assert.equal((await s.post('/_studio/api/servers', spec)).status, 200);
  const room = `s-rules-${kind}-1`;
  const p = await s.socket(room); const w = p.sent.find(m => m.t === 'welcome');
  assert.equal(w.host.id, 'server'); assert.equal(w.role, 'replica'); assert.equal(w.policy.kind, spec.policy);
  if (kind === 'kids') { assert.equal(w.policy.kids, true); assert.equal(w.policy.levelMax, 3); }
  const table = s.env.TABLE.objs.get(`rules-run/${room}`); await table.vocabRead;
  const tick = n => { for (let i = 0; i < n; i++) table.hostRt.tickNow(); };
  tick(2);
  const reserved = kind === 'hybrid' ? 2 : ['beginner', 'kids'].includes(kind) ? 1 : 0;
  assert.equal(table.room.lastRoster.filter(x => x.agent).length, reserved);
  const ids = table.hostRt.core.bodies().filter(b => b.driver === 'ai').map(b => b.id);
  for (let i = 1; i < table.room.humanCap(); i++) await s.socket(room);
  const waiting = await s.socket(room); assert.equal(waiting.sent.find(m => m.t === 'welcome').full, true);
  tick(2); assert.deepEqual(table.hostRt.core.bodies().filter(b => b.driver === 'ai').map(b => b.id), ids);
  const before = table.room.policy.level;
  p.say({ t: 'ctl', op: 'level', args: { level: 5 } }); tick(1); assert.equal(table.room.policy.level, before);
  const bad = await s.env.TABLE.get(`rules-run/${room}`).fetch(`https://table/__office?game=rules-run&room=${room}`, { method: 'POST', body: JSON.stringify({ op: 'level', args: { level: 5 } }) }); assert.equal(bad.status, 403);
  const { signControl } = await import('../worker/office.mjs');
  const ctl = await signControl(s.env, { game: 'rules-run', room, op: 'level', args: { level: 2 } });
  const good = await s.env.TABLE.get(`rules-run/${room}`).fetch(`https://table/__office?game=rules-run&room=${room}`, { method: 'POST', body: JSON.stringify(ctl) }); assert.equal(good.status, 200);
  tick(61); table.recordRound(); await s.settle();
  assert.equal(s.DB.sql.prepare('SELECT COUNT(*) AS n FROM rounds WHERE game = ? AND room = ?').get('rules-run', room).n, 1);
  for (const c of [...table.room.live()]) if (!c.agent) table.room.kick(c, 'closed');
  assert.equal(table.hostRt.paused, true); const stopped = table.hostRt.tick;
  assert.equal(table.hostRt.people, 0); assert.equal(table.hostRt.tick, stopped);
});

test('server rules: Worker verifies AI passes and refuses a forged identity and humans-only admission', async t => {
  const s = await rulesSockets(t);
  for (const [id, policy] of [['companions', 'hybrid'], ['humans', 'humans-only']]) assert.equal((await s.post('/_studio/api/servers', { game: 'rules-run', name: id, id, policy, aiSeats: 2 })).status, 200);
  const p = await s.socket('s-companions-1'); const table = s.env.TABLE.objs.get('rules-run/s-companions-1'); await table.vocabRead; table.hostRt.tickNow(); table.report(); await s.settle();
  const forged = await s.socket('s-companions-1', '', { agent: { role: 'guide', hands: 'host' } }); assert.equal(forged.closed[1], 'agent-pass');
  const made = await (await s.post('/_studio/api/agents/pass', { action: 'create', game: 'rules-run', label: 'Helper', days: 1, hands: 'host' })).json();
  const sat = await (await s.fetchSite('/rules-run/api/agent', { method: 'POST', headers: { authorization: `Bearer ${made.secret}` }, body: '{"server":"companions"}' })).json();
  const ai = await s.socket(sat.room, sat.ticket, { name: 'Human', agent: { role: 'party', hands: 'host' } });
  assert.equal(ai.sent.find(m => m.t === 'welcome').name, 'Helper · AI');
  assert.equal((await s.socket('s-humans-1', sat.ticket, { agent: { role: 'party', hands: 'host' } })).status, 403);
  p.emit('close', {}); assert.equal(table.hostRt.paused, true);
  table.room.now = () => Date.now() + 61000;
  for (const c of table.room.live()) if (c.agent) c.lastSeen = table.room.now();
  table.room.tick(); assert.equal(ai.closed[1], 'agents-alone');
});

test('server rules: the Table seats a house guide with server identity', async t => {
  const s = await rulesSockets(t);
  assert.equal((await s.post('/_studio/api/servers', { game: 'rules-run', id: 'guided', name: 'Guided', policy: 'beginner', guides: 1 })).status, 200);
  const asked = await (await s.post('/_studio/api/agents/brain', { game: 'rules-run', server: 'guided', mode: 'workers-ai', budget: 1000 })).json();
  assert.ok(asked.ask);
  assert.equal((await s.fetchSite(`/_studio/confirm/${asked.ask.id}`, { method: 'POST', headers: { ...s.owner, origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' })).status, 200);
  await s.socket('s-guided-1'); const table = s.env.TABLE.objs.get('rules-run/s-guided-1'); await table.vocabRead; table.syncHouse(); await s.settle(); table.hostRt.tickNow();
  const guide = table.room.live().find(c => c.agent); assert.ok(guide); assert.equal(guide.agent.role, 'guide'); assert.equal(table.hostRt.core.bodyOf(guide.seat).driver, 'ai');
  assert.equal(table.room.lastRoster.find(s => s.agent?.seat === guide.seat).agent.role, 'guide');
});

async function changeRulesServer(s, fields) {
  const r = await s.post('/_studio/api/servers/set', { game: 'rules-run', server: 'changing', ...fields });
  if (r.status === 202) {
    const j = await r.json();
    assert.equal((await s.fetchSite(`/_studio/confirm/${j.ask.id}`, { method: 'POST', headers: { ...s.owner, origin: 'https://owls.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=yes' })).status, 200);
  } else assert.equal(r.status, 200, await r.text());
  await s.settle();
}

async function rulesPass(s, room) {
  const made = await (await s.post('/_studio/api/agents/pass', { action: 'create', game: 'rules-run', label: 'Visitor', days: 1, hands: 'host' })).json();
  const table = s.env.TABLE.objs.get(`rules-run/${room}`); table.report(); await s.settle();
  const sat = await (await s.fetchSite('/rules-run/api/agent', { method: 'POST', headers: { authorization: `Bearer ${made.secret}` }, body: JSON.stringify({ server: 'changing' }) })).json();
  assert.equal(sat.room, room);
  return sat.ticket;
}

for (const kind of ['hybrid', 'beginner']) test(`server rules live ${kind} change publishes names, roles and working ask buttons without another join`, async t => {
  const s = await rulesSockets(t);
  await s.post('/_studio/api/servers', { game: 'rules-run', id: 'changing', name: 'Changing', policy: 'open' });
  const { esbuildOf, PKG } = await import('./rules-kit.mjs');
  const { pathToFileURL } = await import('node:url');
  const file = join(scratch, `live-view-${kind}.mjs`);
  await (await esbuildOf()).build({ stdin: { contents: `export * from './rules/view.ts'; export { useAgents } from './agents/agents.ts';`, resolveDir: PKG }, bundle: true, format: 'esm', outfile: file, logLevel: 'silent' });
  const V = await import(pathToFileURL(file).href); V.setAgentFactory(V.useAgents);
  class Socket {
    constructor() { this.readyState = 0; this.bufferedAmount = 0; queueMicrotask(async () => {
      this.end = await s.socket('s-changing-1');
      const frames = this.end.sent.splice(0);
      this.end.send = text => { this.end.sent.push(JSON.parse(text)); this.onmessage?.({ data: text }); };
      this.readyState = 1; this.onopen?.({});
      for (const m of frames) this.onmessage?.({ data: JSON.stringify(m) });
    }); }
    send(text) { const m = JSON.parse(text); if (m.t !== 'hello') this.end.say(m); }
    close() { this.readyState = 3; this.end?.emit('close', {}); }
  }
  const { loadGame } = await import('./rules-kit.mjs');
  const L = await loadGame(scratch, join(built, 'games/rules-run'), `view-${kind}`);
  const manifest = { id: 'rules-run', schema: L.R.schemaOf(L.R.compileRules(L.def, { seats: 4 })), tune: {}, map: { bounds: { min: [-100, -100], max: [100, 100] } } };
  const view = V.openRoom({ game: { ...manifest, vocab }, timers: false, net: { config: { v: 1, url: 'ws://local/rules-run/__net?room=s-changing-1', room: 's-changing-1', want: 'play' }, WebSocketImpl: Socket, post: null } });
  t.after(() => view.close());
  for (let i = 0; i < 30 && !s.env.TABLE.objs.get('rules-run/s-changing-1')?.hostRt; i++) await new Promise(r => setTimeout(r, 10));
  const table = s.env.TABLE.objs.get('rules-run/s-changing-1'); await table.vocabRead;
  table.hostRt.tickNow(); table.hostRt.tickNow();
  await changeRulesServer(s, { policy: kind, aiSeats: kind === 'hybrid' ? 2 : 1, guides: kind === 'beginner' ? 1 : 0 });
  for (let i = 0; i < 4; i++) table.hostRt.tickNow();
  assert.equal(table.room.lastRoster.filter(x => x.agent).length, 2);
  for (const b of table.hostRt.core.bodies().filter(b => b.driver === 'ai')) {
    const slot = table.room.lastRoster.find(x => x.slot === b.seat);
    assert.match(slot.name, / · AI$/);
    assert.equal(slot.agent.role, kind === 'beginner' && b.seat === 3 ? 'guide' : 'party');
    assert.ok(view.askButtons(b.id).some(x => x.k === 'follow'));
    assert.ok(view.askButtons(b.id).some(x => x.k === 'visit' && x.args.place === 'camp'));
    view.ask(b.id, 'follow', { seat: 0 }); table.hostRt.tickNow();
    assert.equal(table.hostRt.core.goal(b.seat).goal, 'follow');
  }
  // Same reservation count, different roles must also publish a roster.
  await changeRulesServer(s, { policy: 'beginner', aiSeats: 0, guides: 2 }); table.hostRt.tickNow();
  assert.ok(table.room.lastRoster.filter(x => x.agent).every(x => x.agent.role === 'guide'));
  await changeRulesServer(s, { policy: 'hybrid', aiSeats: 1, guides: 0 }); table.hostRt.tickNow();
  assert.equal(table.room.lastRoster.filter(x => x.agent).length, 1);
  await changeRulesServer(s, { policy: 'open', aiSeats: 0, guides: 0 }); table.hostRt.tickNow();
  assert.equal(table.room.lastRoster.filter(x => x.agent).length, 0);
});

for (const holder of ['person', 'expired person', 'pass']) test(`server rules reserved companion forgets a departed ${holder} name`, async t => {
  const s = await rulesSockets(t); const room = 's-changing-1';
  await s.post('/_studio/api/servers', { game: 'rules-run', id: 'changing', name: 'Changing', policy: holder !== 'pass' ? 'open' : 'hybrid', aiSeats: 2 });
  await s.socket(room); const table = s.env.TABLE.objs.get(`rules-run/${room}`); await table.vocabRead;
  let seat; let leaving;
  if (holder !== 'pass') {
    await s.socket(room); await s.socket(room); const p = await s.socket(room, '', { name: 'Departed' }); seat = p.sent.find(m => m.t === 'welcome').seat; leaving = p;
    await changeRulesServer(s, { policy: 'hybrid', aiSeats: 2 });
  } else { const p = await s.socket(room, await rulesPass(s, room)); seat = p.sent.find(m => m.t === 'welcome').seat; }
  table.hostRt.tickNow();
  if (holder === 'expired person') {
    leaving.emit('close', {});
    const later = table.room.now() + table.room.holdMs + 1; table.room.now = () => later;
    for (const c of table.room.live()) c.lastSeen = later;
  } else {
  const { signControl } = await import('../worker/office.mjs');
  const ctl = await signControl(s.env, { game: 'rules-run', room, op: 'kick', args: { seat } });
  assert.equal((await s.env.TABLE.get(`rules-run/${room}`).fetch(`https://table/__office?game=rules-run&room=${room}`, { method: 'POST', body: JSON.stringify(ctl) })).status, 200);
  }
  table.room.tick(); table.hostRt.tickNow(); table.hostRt.tickNow();
  assert.equal(table.hostRt.core.bodies().find(b => b.seat === seat).owner, 'reserved');
  const slot = table.room.lastRoster.find(x => x.slot === seat);
  assert.doesNotMatch(slot.name, /Departed|Visitor/); assert.match(slot.name, / · AI$/);
  for (let i = 0; i < 65; i++) table.hostRt.tickNow();
  assert.doesNotMatch(JSON.stringify(table.room.lastRound), /Departed|Visitor/);
});

test('server rules pace a burst of one verified pass without replacing its body or flooding people', async t => {
  const s = await rulesSockets(t); const room = 's-changing-1';
  await s.post('/_studio/api/servers', { game: 'rules-run', id: 'changing', name: 'Changing', policy: 'hybrid', aiSeats: 2 });
  const person = await s.socket(room); const table = s.env.TABLE.objs.get(`rules-run/${room}`); await table.vocabRead;
  const ticket = await rulesPass(s, room); const a = await s.socket(room, ticket); const seat = a.sent.find(m => m.t === 'welcome').seat;
  table.hostRt.tickNow(); const id = table.hostRt.core.bodyOf(seat).id;
  person.sent.length = 0;
  const sockets = []; for (let i = 0; i < 40; i++) sockets.push(await s.socket(room, ticket));
  assert.equal(sockets.filter(x => x.sent.some(m => m.t === 'welcome')).length, 1);
  assert.ok(sockets.slice(1).every(x => x.sent.some(m => m.t === 'error' && m.code === 'agent-pace')));
  assert.equal(person.sent.filter(m => m.t === 'join').length, 1);
  assert.equal(person.sent.filter(m => m.t === 'leave').length, 1);
  table.hostRt.tickNow(); assert.equal(table.hostRt.core.bodyOf(seat).id, id);
  const now = table.room.now(); table.room.now = () => now + 4001;
  assert.equal((await s.socket(room, ticket)).sent.find(m => m.t === 'welcome').seat, seat);
  for (let i = 2; i < 8; i++) { table.room.now = () => now + i * 4001; assert.equal((await s.socket(room, ticket)).sent.find(m => m.t === 'welcome').seat, seat); }
  table.room.now = () => now + 8 * 4001;
  assert.ok((await s.socket(room, ticket)).sent.some(m => m.t === 'error' && m.code === 'agent-pace'));
  table.room.now = () => now + 60001;
  assert.equal((await s.socket(room, ticket)).sent.find(m => m.t === 'welcome').seat, seat);
});

test('server rules ignore a first visitor capacity and keep build seat allocation', async t => {
  const s = await rulesSockets(t); const room = 's-changing-1';
  await s.post('/_studio/api/servers', { game: 'rules-run', id: 'changing', name: 'Changing', policy: 'hybrid', aiSeats: 2 });
  const a = await s.socket(room, '', { max: 2 }); const table = s.env.TABLE.objs.get(`rules-run/${room}`); await table.vocabRead;
  assert.equal(a.sent.find(m => m.t === 'welcome').max, 4);
  assert.equal((await s.socket(room)).sent.find(m => m.t === 'welcome').seat, 1);
  assert.equal((await s.socket(room)).sent.find(m => m.t === 'welcome').full, true);
  const ai = await s.socket(room, await rulesPass(s, room)); assert.ok(ai.sent.find(m => m.t === 'welcome').seat >= 2);
  table.hostRt.tickNow(); assert.equal(table.hostRt.core.bodies().filter(b => b.driver === 'ai').length, 2);
});
