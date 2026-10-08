/**
 * @homie-rocks/studio 0.6.0: 32-seat rooms, and the studio's own stats.
 *
 *   - a game's netplay manifest (game.json `netplay`, or netplay.json beside it or in its build) sets its seats,
 *     up to 32; the relay seats 32 from one address (a party on one Wi-Fi) and the 33rd waits;
 *   - the netplay helper sends an idle input frame four times a second, a moving one at its input rate (on virtual
 *     time, 0.18.2: what it schedules, however busy the machine is);
 *   - createRoom (the port kit) never spawns a body that arrives mid-round at an index, so a spot, another body holds;
 *   - the site counts page opens, Play presses by where they came from, rooms, rounds and peaks, never a
 *     prefetch, a crawler or house QA; only the owner reads them (a read key, or the one-time sign-in's session);
 *   - a song's or video's start is one beacon; "played this week" is in the manifest only when the studio shares;
 *   - a studio made before 0.6.0 gets the stats migration from deploy and dev, once.
 * The D1 is node:sqlite with the studio's own migrations applied.
 * Run: node --test packages/studio/test/rooms-and-stats.test.mjs
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
import { NetRoom } from '../worker/room.mjs';
import { SEAT_MAX, perAddress, seatsOf } from '../worker/seats.mjs';
import { STATS_MIGRATION, STATS_MIGRATION_FILE, isVisit, kindOf, sourceOf } from '../worker/stats.mjs';
import { ensureStatsMigration, studioFiles } from '../lib/scaffold.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-stats-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Stat Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

/** Enough of D1: prepare/bind/first/all/run and batch, on node:sqlite with the studio's migrations. */
function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { sql.prepare(query).run(...args); return { success: true }; },
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
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    },
  };
}

test('seats: the netplay manifest sets a game\'s room size, up to 32; build says when a game asks for more', () => {
  const dir = studio('seats');
  for (const [id, meta, file] of [
    ['courier', { players: { min: 2, max: 8 } }, { v: 1, players: { max: 32 } }],
    ['crowd', { netplay: { v: 1, public: true, maxPlayers: 40, movement: 'host' } }, null],
    ['duel', { players: { min: 2, max: 2 } }, null],
    ['plain', {}, null],
  ]) {
    assert.equal(out(run(['game', 'new', id], dir)).ok, true);
    const path = join(dir, 'games', id, 'game.json');
    const g = { ...JSON.parse(readFileSync(path, 'utf8')), ...meta };
    if (!meta.players) delete g.players;
    if (meta.netplay) g.netplay = meta.netplay;
    writeFileSync(path, JSON.stringify(g));
    if (file) writeFileSync(join(dir, 'games', id, 'netplay.json'), JSON.stringify(file));
  }
  const b = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /games\/crowd asks for 40 players; a room holds at most 32/);
  const cat = JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8'));
  const seats = Object.fromEntries(cat.games.map((g) => [g.id, g.players]));
  assert.deepEqual(seats, { courier: { min: 2, max: 32 }, crowd: { min: 1, max: 32 }, duel: { min: 2, max: 2 }, plain: { min: 1, max: 8 } });
  assert.equal(cat.games.find((g) => g.id === 'crowd').movement, 'host');
  assert.equal(SEAT_MAX, 32);
  assert.deepEqual([seatsOf({ players: { max: 32 } }), seatsOf({ players: { max: 99 } }), seatsOf({}), seatsOf({ players: { max: 0 } })], [32, 32, 8, 8]);
  assert.deepEqual([perAddress(8), perAddress(16), perAddress(32)], [12, 20, 36]);
});

test('the relay at 32: one address fills every seat (a party on one Wi-Fi), the 33rd waits, and a leaver\'s seat goes to it', () => {
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 32, perIp: perAddress(32) });
  const clients = [];
  for (let i = 0; i < 33; i++) {
    const got = [];
    const conn = { ip: '203.0.113.9', send: (t) => got.push(JSON.parse(t)), close: () => {} };
    const h = room.attach(conn);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'phone', want: 'play', canHost: i === 0, max: 32 }));
    clients.push({ h, got });
  }
  const welcome = (c) => c.got.find((m) => m.t === 'welcome');
  assert.equal(clients.slice(0, 32).filter((c) => Number.isInteger(welcome(c).seat)).length, 32, 'all 32 seated from one address');
  assert.deepEqual(new Set(clients.slice(0, 32).map((c) => welcome(c).seat)).size, 32);
  assert.equal(welcome(clients[32]).full, true, 'the 33rd is a waiting spectator');
  assert.equal(welcome(clients[32]).seat, null);
  assert.equal(room.facts().counts.players, 32);
  clients[5].h.onClose();
  assert.ok(clients[32].got.some((m) => m.t === 'seat' && m.seat === 5), 'the waiting visitor takes the seat that freed');
  // A 32-seat room's checkpoint may be twice a 16-seat room's (a 32-seat courier game's reached 56 KB).
  const host = clients[0];
  const big = JSON.stringify({ t: 'ckpt', k: 1, st: Date.now(), d: { pad: 'x'.repeat(100_000) } });
  host.h.onMessage(big);
  assert.ok(!host.got.some((m) => m.t === 'error' && m.code === 'too-large'), 'a 100 KB checkpoint fits a 32-seat room');
  assert.equal(room.lastCkpt.d.pad.length, 100_000);
  const small = new NetRoom({ code: 'pub-3', maxPlayers: 16 });
  const got16 = [];
  small.attach({ send: (t) => got16.push(JSON.parse(t)), close: () => {} }).onMessage(JSON.stringify({ t: 'hello', v: 1, want: 'play' }));
  small.onMessage([...small.clients.values()][0], big);
  assert.ok(got16.some((m) => m.t === 'error' && m.code === 'too-large'), 'and not a 16-seat room\'s');
  // The old cap: 12 sockets per address in a room, whatever its size.
  const old = new NetRoom({ code: 'pub-2', maxPlayers: 32 });
  const refused = [];
  for (let i = 0; i < 14; i++) {
    const got = [];
    old.attach({ ip: '203.0.113.9', send: (t) => got.push(JSON.parse(t)), close: () => {} }).onMessage(JSON.stringify({ t: 'hello', v: 1, want: 'play' }));
    if (got.some((m) => m.t === 'error' && m.code === 'too-many')) refused.push(i);
  }
  assert.deepEqual(refused, [12, 13]);
});

test('netplay helper: an idle input frame goes out four times a second; a moving one at the input rate', async (t) => {
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'netplay.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'netplay', 'netplay.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { createNetplay } = await import(file);
  // Virtual time from here on: the frames counted are the ones the helper schedules, however busy the machine is.
  const clock = virtualTime(t);
  const room = new NetRoom({ code: 'r', maxPlayers: 4 });
  const sent = [];
  class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = room.attach({ send: (t) => setTimeout(() => this.onmessage?.({ data: t }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(t) { const m = JSON.parse(t); if (m.t === 'in') sent.push(Date.now()); this.h.onMessage(t); }
    close() { this.readyState = 3; this.h.onClose(); }
  }
  const cfg = (who) => ({ v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who });
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: MemorySocket, canHost: true, post: null, game: 'x' });
  await clock.wait(50);
  const replica = createNetplay({ config: cfg('replica'), WebSocketImpl: MemorySocket, canHost: false, post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(host.isHost, true);
  assert.equal(replica.seat, 1);
  // A game's frame loop: a frame every 16 ms for `ms`.
  const drive = async (ms, frame) => { for (let i = 0; i * 16 < ms; i++) { replica.input(frame(i), []); await clock.wait(16); } };
  const gaps = (at) => at.slice(1).map((x, i) => x - at[i]);
  sent.length = 0;
  await drive(2000, () => [10, 20, 0, 0]);
  const idle = [...sent];
  sent.length = 0;
  await drive(2000, (i) => [10 + i, 20, 1, 0]);
  const moving = [...sent];
  host.close?.(); replica.close?.();
  // Standing still: the same frame again only as a keepalive, every 250 ms (the next game frame after it is due).
  assert.ok(idle.length >= 7 && idle.length <= 9, `idle: ${idle.length} frames in 2 s (about 4 a second)`);
  for (const g of gaps(idle)) assert.ok(g >= 250 && g < 250 + 16, `an idle frame ${g} ms after the last (every 250 ms): ${gaps(idle)}`);
  // Moving: every frame differs, so one goes out at the input rate (20 a second), never faster.
  assert.ok(moving.length >= 38 && moving.length <= 41, `moving: ${moving.length} frames in 2 s (about 20 a second)`);
  for (const g of gaps(moving)) assert.ok(g >= 50 && g < 50 + 16, `a moving frame ${g} ms after the last (every 50 ms): ${gaps(moving)}`);
  assert.ok(replica.stats().idleInputsSkipped > 50);
});

test('createRoom (the port kit): a body that arrives mid-round never gets a spawn index, so a spot, another body has', async (t) => {
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'room-kit.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'room.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { createRoom } = await import(file);
  const clock = virtualTime(t);
  const relay = new NetRoom({ code: 'r', maxPlayers: 8 });
  class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = relay.attach({ send: (t) => setTimeout(() => this.onmessage?.({ data: t }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(t) { this.h.onMessage(t); }
    close() { this.readyState = 3; this.h.onClose(); }
  }
  const spawns = [];
  const make = (who) => createRoom({
    game: 'x', maxPlayers: 8, minBodies: 3, roundSeconds: 90,
    // Every spawn on a ring by its index, as Ember Vale and the recipe's coin-dash do.
    spawn: (slot, i) => { spawns.push({ who, slot: slot.slot, i }); return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, score: 0, x: Math.round(Math.cos((i / 8) * Math.PI * 2) * 160), y: Math.round(Math.sin((i / 8) * Math.PI * 2) * 120) }; },
    pack: (b) => [b.x, b.y], unpack: (f, b) => { b.x = f[0]; b.y = f[1]; },
    netplay: { config: { v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who }, WebSocketImpl: MemorySocket, canHost: who === 'host', post: null },
  });
  const host = make('host');
  await clock.wait(100);
  assert.equal(host.hosting, true);
  assert.deepEqual([...new Map(spawns.map((s) => [s.slot, s.i])).values()], [0, 1, 2], 'a round starts with the host and two bots: 0, 1, 2');
  spawns.length = 0;
  // Five people arrive one after another: two take the bots' places, three have no bot to take over.
  const rooms = [];
  for (const who of ['ann', 'ben', 'cal', 'dot', 'eve']) { rooms.push(make(who)); await clock.wait(100); }
  const bodies = [...host.bodies.values()];
  assert.equal(bodies.filter((b) => !b.bot).length, 6);
  assert.deepEqual(spawns.filter((s) => s.who === 'host').map((s) => s.i), [3, 4, 5], 'each arrival with no bot to take over: the lowest index nobody holds (it was 0 for every one)');
  const spots = new Set(bodies.map((b) => `${b.x},${b.y}`));
  assert.equal(spots.size, bodies.length, `no two bodies on one spot: ${JSON.stringify(bodies.map((b) => [b.name, b.x, b.y]))}`);
  for (const r of [host, ...rooms]) r.net.close?.();
});

test('the state the playtest and perf read is on the game side: createRoom gives the round, the typed extras carry the rest, the 3D starters say their renderer\'s counters', async (t) => {
  // ACROSS THE SEAM: the real port kit (createRoom + exposePort over the real helper and relay) on one side, the
  // playtest skill's own reader and judge and perf's renderer-cost reader on the other.
  const playtest = await import('../../../plugins/homie/skills/playtest/scripts/lib/judge.mjs');
  const { renderCostOf } = await import('../lib/perf.mjs');
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'port-kit.mjs');
  await esbuild.build({ stdin: { contents: "export { createRoom } from './room'; export { exposePort, PORT_EXTRA_NAMES } from './probe';", resolveDir: join(PKG, 'port'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { createRoom, exposePort, PORT_EXTRA_NAMES } = await import(file);
  // One list of names: what the game's author is told to set is what the instruments read.
  assert.deepEqual([...PORT_EXTRA_NAMES], playtest.EXTRA_NAMES);
  const src = readFileSync(join(PKG, 'port', 'probe.ts'), 'utf8');
  for (const name of playtest.EXTRA_NAMES) assert.match(src, new RegExp(`\\b${name}\\?: \\(\\) => (boolean|string|number);`), `PortExtra types ${name}`);

  const clock = virtualTime(t);
  const relay = new NetRoom({ code: 'r', maxPlayers: 4 });
  class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = relay.attach({ send: (x) => setTimeout(() => this.onmessage?.({ data: x }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.h.onMessage(x); }
    close() { this.readyState = 3; this.h.onClose(); }
  }
  const room = createRoom({
    game: 'x', maxPlayers: 4, minBodies: 2, roundSeconds: 90,
    spawn: (slot, i) => ({ slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, score: 0, x: 10 + i, y: 20 }),
    pack: (b) => [b.x, b.y], unpack: (f, b) => { b.x = f[0]; b.y = f[1]; },
    netplay: { config: { v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', name: 'host' }, WebSocketImpl: MemorySocket, canHost: true, post: null },
  });
  await clock.wait(100);
  assert.equal(room.hosting, true);
  // The game's frame, as far as a probe needs one. The game says only what it has: alive, a mode, its renderer.
  const had = globalThis.window;
  globalThis.window = { addEventListener() {} };
  t.after(() => { if (had === undefined) delete globalThis.window; else globalThis.window = had; });
  let hp = 3;
  const probe = exposePort(room.net, { view: 'top', self: () => ({ x: 11, y: 20 }), extra: { alive: () => hp > 0, mode: () => 'manual fire', drawCalls: () => 42, triangles: () => 9000, level: () => 7 } });
  assert.equal(globalThis.window.__homiePort, probe);
  // The round needs no hook: createRoom told the helper, and the probe reads the helper.
  const info = probe.info();
  assert.deepEqual([info.round.n, info.round.phase], [1, 'live']);
  assert.ok(info.round.leftMs > 80_000 && info.round.leftMs <= 90_000, `about 90 s left: ${info.round.leftMs}`);
  assert.deepEqual([info.link, info.reconnects], ['online', 0], 'and where the browser stands with its room');
  // The playtest's own reader (the function it runs inside the game's frame), then its judge.
  const read = playtest.readPort(playtest.EXTRA_NAMES);
  assert.deepEqual(read.extra, { alive: true, mode: 'manual fire', drawCalls: 42, triangles: 9000 }, 'the named ones, and only those');
  const st = playtest.stateOf({ at: Date.now(), port: { ...read, busy: 0, x: 11, y: 20 }, shell: null, net: { link: info.link } });
  assert.deepEqual([st.phase, st.round, st.alive, st.mode, st.source, st.link], ['live', 1, true, 'manual fire', 'probe', 'online']);
  assert.equal(playtest.contextOf(st).kind, 'live');
  hp = 0;
  assert.equal(playtest.contextOf(playtest.stateOf({ port: { ...playtest.readPort(playtest.EXTRA_NAMES), busy: 0 }, shell: null })).kind, 'spectating', 'a dead body is not a broken control');
  // perf reads the renderer's counters from the same `extra`, and the playtest's look row does too.
  const x = probe.info().extra;
  assert.deepEqual(renderCostOf([{ drawCalls: Number(x.drawCalls), triangles: Number(x.triangles) }]).drawCalls.median, 42);
  assert.equal(playtest.renderCost([read.extra]).triangles.median, 9000);
  room.net.close?.();

  // The starters set what they can. The 3D ones have a renderer: its counters, on the port probe (they were only on
  // the netplay probe, where neither perf nor the playtest looks). The one with a way to go down says `alive`.
  const port = (starter) => { const text = readFileSync(join(PKG, 'starters', starter, 'src', 'main.ts'), 'utf8'); const at = text.indexOf('exposePort(net, {'); return text.slice(at, text.indexOf('\n});', at)); };
  for (const starter of ['gem-rush-3d', 'hero-rush-3d']) assert.match(port(starter), /extra: \{ drawCalls: \(\) => renderer\.info\.render\.calls, triangles: \(\) => renderer\.info\.render\.triangles \}/, starter);
  assert.match(port('ember-vale'), /extra: \{ alive: \(\) => /);
});

test('stats: what counts as a visit, where it came from, and what a referrer is', () => {
  const req = (headers, method = 'GET') => new Request('https://owls.example/', { method, headers });
  assert.equal(isVisit(req({ 'user-agent': BROWSER, 'sec-fetch-dest': 'document' })), true);
  assert.equal(isVisit(req({ 'user-agent': BROWSER, accept: 'text/html,*/*' })), true, 'an older browser that sends no Sec-Fetch-Dest');
  assert.equal(isVisit(req({ 'user-agent': BROWSER, 'sec-fetch-dest': 'document', 'sec-purpose': 'prefetch;prerender' })), false);
  assert.equal(isVisit(req({ 'user-agent': BROWSER, 'sec-fetch-dest': 'script' })), false);
  assert.equal(isVisit(req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'sec-fetch-dest': 'document' })), false);
  assert.equal(isVisit(req({ 'user-agent': `${BROWSER} homie-house-qa`, 'sec-fetch-dest': 'document' })), false);
  assert.equal(isVisit(req({ 'user-agent': BROWSER.replace('Chrome', 'HeadlessChrome'), 'sec-fetch-dest': 'document' })), false);
  assert.equal(isVisit(req({ 'user-agent': BROWSER, 'sec-fetch-dest': 'document' }, 'HEAD')), false);
  const from = (referer, path = '/') => sourceOf(new Request(`https://owls.example${path}`, { headers: referer ? { referer } : {} }), new URL(`https://owls.example${path}`));
  assert.equal(from('https://homie.rocks/studios/some/path?q=secret'), 'homie.rocks', 'a host, never a path or query');
  assert.equal(from('https://www.example.org/'), 'example.org');
  assert.equal(from('https://owls.example/other/'), '', 'this site\'s own links');
  assert.equal(from(null, '/g/play?via=QR'), 'via:qr');
  assert.equal(from(null, '/g/play?via=<script>'), '');
  assert.deepEqual(['homie.rocks', 'arcade.homie.rocks', 'friends.example', 'www.google.com', 'news.example', 'via:qr'].map((h) => kindOf(h, new Set(['friends.example']))), ['hub', 'studio', 'studio', 'search', 'web', 'link']);
});

test('stats: the site counts, only the owner reads, and a one-time link signs the owner\'s browser in', async () => {
  const dir = studio('counts');
  assert.equal(out(run(['game', 'new', 'owl-run', '--name', 'Owl Run'], dir)).ok, true);
  mkdirSync(join(dir, 'music', 'theme'), { recursive: true });
  writeFileSync(join(dir, 'music', 'theme', 'theme.mp3'), Buffer.from('ID3-audio'));
  writeFileSync(join(dir, 'music', 'manifest.json'), JSON.stringify({ v: 1, items: [{ slug: 'theme', kind: 'song', title: 'Theme', published: true, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] }] }));
  assert.equal(out(run(['build'], dir)).ok, true);
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const DB = fakeD1(dir);
  const lobbyNow = { players: 3, rooms: 1 };
  const LOBBY = { idFromName: () => 'x', get: () => ({ fetch: async (u) => new Response(JSON.stringify(String(u).endsWith('/now') ? lobbyNow : { rooms: [] })) }) };
  const env = { ASSETS: assetsOf(dir), LOBBY, DB, STUDIO_NAME: 'Stat Owls' };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const site = async (path, init = {}) => { const r = await worker.fetch(new Request(`https://owls.example${path}`, init), env, ctx); await Promise.all(waits.splice(0)); return r; };
  const nav = (extra = {}) => ({ headers: { 'user-agent': BROWSER, 'sec-fetch-dest': 'document', ...extra } });
  await site('/', nav());
  await site('/', nav({ 'sec-purpose': 'prefetch' }));
  await site('/', { headers: { 'user-agent': 'curl/8', accept: '*/*' } });
  await site('/owl-run/', nav({ referer: 'https://homie.rocks/studios/' }));
  await site('/owl-run/play', nav({ referer: 'https://arcade.homie.rocks/' }));
  await site('/owl-run/play?via=qr', nav());
  await site('/owl-run/play', nav({ referer: 'https://owls.example/owl-run/' }));
  await site('/owl-run/tv', nav());
  await site('/music/theme/', nav());
  await site('/owl-run/__game/', nav()); // the game's own document inside the frame: not a visit
  // A song's player started: the page's one beacon (same origin only; a song this site has).
  assert.equal((await site('/api/stats/beat', { method: 'POST', headers: { origin: 'https://owls.example' }, body: JSON.stringify({ k: 'song', s: 'theme' }) })).status, 204);
  assert.equal((await site('/api/stats/beat', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ k: 'song', s: 'theme' }) })).status, 403);
  assert.equal((await site('/api/stats/beat', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ k: 'song', s: 'nope' }) })).status, 404);
  // A room opened, a round finished (with people in it), and the day's peak, from the Table and the Lobby.
  const storage = new Map();
  const doCtx = { storage: { get: async (k) => storage.get(k), put: async (k, v) => { storage.set(k, v); }, delete: async () => {} }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
  const table = new Table(doCtx, env);
  await new Promise((r) => setTimeout(r, 0));
  const seated = (qa) => new Map([['a', { helloed: true, seat: 0, conn: { qa } }], ['b', { helloed: true, seat: 1, conn: { qa: true } }]]);
  const over = { n: 3, phase: 'over', results: [{ seat: 0, bot: false }, { seat: 1, bot: false }, { seat: null, bot: true }] };
  Object.assign(table, { game: 'owl-run', code: 'pub-1', room: { lastRound: over, clients: seated(false) } });
  table.recordRound();
  table.recordRound(); // the same round twice is one round
  // A round only house QA played (homie-studio check, a probe) stays in `rounds` and out of the stats.
  const qaTable = new Table(doCtx, env);
  await new Promise((r) => setTimeout(r, 0));
  Object.assign(qaTable, { recorded: 0, game: 'owl-run', code: 'pub-9', room: { lastRound: { ...over, n: 4 }, clients: seated(true) } });
  qaTable.recordRound();
  const lobby = new Lobby(doCtx, env);
  await new Promise((r) => setTimeout(r, 0));
  for (const [room, players] of [['pub-1', 5], ['pub-2', 7], ['pub-1', 2], ['friends', 4]]) await lobby.fetch(new Request(`https://lobby/report?game=owl-run`, { method: 'POST', body: JSON.stringify({ room, players }) }));
  await Promise.all(waits.splice(0));
  const now = await (await lobby.fetch(new Request('https://lobby/now'))).json();
  assert.deepEqual([now.players, now.rooms], [13, 3], 'playing now counts named rooms too');
  const rows = DB.sql.prepare('SELECT metric, subject, source, n FROM stats_daily ORDER BY metric, subject, source').all().map((r) => `${r.metric} ${r.subject} ${r.source} ${r.n}`);
  assert.deepEqual(rows, [
    'humans owl-run  2', 'peak owl-run  13', 'peak-room owl-run  7',
    'play owl-run  1', 'play owl-run arcade.homie.rocks 1', 'play owl-run via:qr 1',
    'round owl-run people 1', 'screen owl-run  1', 'song theme  1',
    'visit home  1', 'visit music/theme  1', 'visit owl-run homie.rocks 1',
  ]);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 2, 'both rounds are in `rounds`; only the people\'s is counted');

  // Only the owner reads them.
  const denied = await site('/api/stats');
  assert.equal(denied.status, 401);
  assert.doesNotMatch(await denied.text(), /owl-run.*plays/);
  const key = `hsk_${'a1'.repeat(24)}`;
  DB.sql.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, 'read', ?)").run(sha(key), Date.now() + 60_000);
  const stats = await (await site('/api/stats?range=7d', { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(stats.ok, true);
  assert.deepEqual([stats.totals.visits, stats.totals.plays, stats.totals.screens, stats.totals.rounds, stats.totals.peopleInRounds, stats.totals.peakPlayers, stats.totals.peakInOneRoom, stats.totals.songPlays, stats.totals.playingNow], [3, 3, 1, 1, 2, 13, 7, 1, 3]);
  assert.deepEqual(stats.crossings, { fromHub: 1, fromStudios: 1, fromSearch: 0, fromWeb: 0, fromLinks: 1 });
  assert.deepEqual(stats.songs, [{ slug: 'theme', title: 'Theme', visits: 1, plays: 1 }]);
  assert.deepEqual(stats.pages, { home: 1, games: 0, rooms: 0, posts: 0, music: 0, videos: 0 });
  assert.equal(stats.days.length, 7);
  const one = await (await site('/api/stats?game=owl-run', { headers: { authorization: `Bearer ${key}` } })).json();
  assert.deepEqual([one.only, one.totals.visits, one.songs.length], [{ kind: 'game', id: 'owl-run' }, 1, 0]);
  DB.sql.prepare('UPDATE stats_keys SET expires_at = ? WHERE hash = ?').run(Date.now() - 1, sha(key));
  assert.equal((await site('/api/stats', { headers: { authorization: `Bearer ${key}` } })).status, 401, 'an ended key reads nothing');

  // The private page: locked without a session; a one-time link signs the owner's browser in (a GET spends nothing).
  assert.equal((await site('/_studio/stats')).status, 401);
  const link = `hsk_${'b2'.repeat(24)}`;
  DB.sql.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, 'signin', ?)").run(sha(link), Date.now() + 60_000);
  const shown = await site(`/_studio/signin?k=${link}`);
  assert.equal(shown.status, 200);
  assert.match(await shown.text(), /<form method="post"/);
  assert.equal((await site(`/_studio/signin?k=${link}`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403, 'another site cannot spend it');
  assert.equal((await site(`/_studio/signin?k=${link}`, { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } })).status, 403, 'nor an opaque origin from elsewhere');
  assert.equal((await site('/_studio/signin?k=x')).headers.get('referrer-policy'), 'same-origin', 'the button page\'s own POST keeps its Origin');
  // Chrome sends `Origin: null` on a form POST from a no-referrer page; Sec-Fetch-Site still says it is this site.
  const signed = await site(`/_studio/signin?k=${link}`, { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } });
  assert.equal(signed.status, 303);
  const cookie = signed.headers.get('set-cookie');
  // From 0.13.0 the owner's session lives at / (the owner is recognised in their own games); HttpOnly, never readable.
  assert.match(cookie, /^studio_owner=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  assert.equal((await site(`/_studio/signin?k=${link}`, { method: 'POST', headers: { origin: 'https://owls.example' } })).status, 403, 'the link works once');
  const session = cookie.split(';')[0];
  const pageRes = await site('/_studio/stats?range=30d', { headers: { cookie: session } });
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get('cache-control'), 'no-store, private, no-transform', 'every HTML answer is no-transform (0.7.0)');
  assert.match(pageRes.headers.get('x-robots-tag'), /noindex/);
  assert.match(pageRes.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await pageRes.text();
  assert.match(html, /Stat Owls stats/);
  assert.match(html, /Owl Run/);
  assert.match(html, /arcade\.homie\.rocks <span class="kind">another studio<\/span>/);
  assert.doesNotMatch(html, /<script/i, 'the private page runs no script');
  assert.equal((await site('/api/stats', { headers: { cookie: session } })).status, 401, 'the page session lives under /_studio/ only (the cookie is never sent to /api)');
  const out2 = await site('/_studio/signout', { method: 'POST', headers: { origin: 'https://owls.example', cookie: session } });
  assert.equal(out2.status, 303);
  assert.equal((await site('/_studio/stats', { headers: { cookie: session } })).status, 401, 'signed out');

  // "Played this week" is in the manifest only when the studio shares.
  assert.equal((await (await site('/.well-known/homie-studio.json')).json()).played, undefined);
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.deepEqual(s.stats, { share: false }, 'a new studio shares nothing');
  assert.equal(out(run(['stats', 'share', 'on'], dir)).share, true);
  assert.equal(out(run(['build'], dir)).ok, true);
  const wk = await (await site('/.well-known/homie-studio.json')).json();
  assert.deepEqual([wk.played.days, wk.played.plays, wk.played.rounds], [7, 3, 1]);
});

test('a studio made before 0.6.0 gets the stats migration once, from deploy or dev; a new studio has it', () => {
  const files = studioFiles({ name: 'X', slug: 'x', homie: 'https://homie.test' });
  assert.equal(files[`site/migrations/${STATS_MIGRATION_FILE}`], STATS_MIGRATION);
  const dir = join(scratch, 'old');
  mkdirSync(join(dir, 'site', 'migrations'), { recursive: true });
  writeFileSync(join(dir, 'site', 'migrations', '0001_studio.sql'), '-- 0.5.0');
  assert.equal(ensureStatsMigration(dir), `site/migrations/${STATS_MIGRATION_FILE}`);
  assert.equal(readFileSync(join(dir, 'site', 'migrations', STATS_MIGRATION_FILE), 'utf8'), STATS_MIGRATION);
  assert.equal(ensureStatsMigration(dir), null, 'once');
  const sql = new DatabaseSync(':memory:');
  sql.exec(STATS_MIGRATION);
  sql.exec(STATS_MIGRATION);
  assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE name = 'stats_daily'").get(), 'the migration is idempotent');
});

test('server rules round results reach Table stats once with reserved companions counted as AI', async () => {
  const { loadGame, writeGame, roomRig } = await import('./rules-kit.mjs');
  const { source, vocab } = await import('./rules-feature-kit.mjs');
  const { DEFAULT_POLICY } = await import('../worker/room.mjs');
  const { Table } = await import('../worker/index.mjs');
  const L = await loadGame(scratch, writeGame(scratch, 'stats-rules', { rules: source }), 'stats-rules');
  const r = roomRig(L, L.R.compileRules(L.def, { seats: 4 }), { maxPlayers: 4 });
  r.room.setVocabulary(vocab); r.room.setPolicy({ ...DEFAULT_POLICY, kind: 'hybrid', aiSeats: 2 });
  r.conn().hello('Player'); r.run(3100);
  const dir = studio('rules-stats'); const DB = fakeD1(dir); const waits = [];
  const table = Object.create(Table.prototype);
  Object.assign(table, { room: r.room, recorded: 0, game: 'rules-run', code: 'pub-1', env: { DB }, ctx: { storage: { put: async () => {} }, waitUntil: p => waits.push(p) } });
  table.recordRound(); table.recordRound(); await Promise.all(waits);
  const rows = DB.sql.prepare('SELECT humans, bots, results FROM rounds').all(); assert.equal(rows.length, 1); assert.equal(rows[0].humans, 1); assert.equal(rows[0].bots, 2);
  assert.equal(JSON.parse(rows[0].results).filter(x => x.agent).length, 2); r.host.stop();
});
