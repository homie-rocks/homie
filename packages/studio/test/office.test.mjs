/**
 * @homie-rocks/studio 0.13.0: the studio's back office.
 *
 *   - the relay (room.mjs) applies the owner's controls: a kick holds a player out of that room for some minutes
 *     (their seat token, their browser's room key, their account; their address only when asked) and frees the
 *     seat; a mute stops their speech; an announcement reaches everyone, joiners too; a closed room lets nobody
 *     in; the room's seats change while it runs; all of it outlives an empty room and a restart;
 *   - a control is signed by the studio's Worker and checked by the room: a forged, changed, late, replayed or
 *     misaddressed one is refused;
 *   - launch states: a private game is the owner's alone, an invite-only beta lets in browsers holding a pass from
 *     an invite code, and neither is in any list, /api/rooms or the directory manifest; no game's source is served (remix
 *     was retired: its old switch is refused, its D1 column is left alone); the owner's room size reaches the Lobby and the live rooms;
 *   - the office API is the owner's: an office key looks, announces and invites, and only ASKS for a kick, a
 *     closed room or a launch change, which the owner's signed-in browser confirms with one tap; a stats read
 *     key gets nothing; a cross-site POST with the owner's cookie is refused;
 *   - the owner's own play page carries the owner overlay; nobody else's has a byte of it.
 * The D1 is node:sqlite with the studio's own migrations; the Durable Objects are the real Table and Lobby.
 * Run: node --test packages/studio/test/office.test.mjs
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
import { NetRoom, SPEECH } from '../worker/room.mjs';
import { OFFICE_MIGRATION, OFFICE_MIGRATION_FILE, signControl, ticketAllows, ticketFor, ticketSub, verifyControl } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { ensureMigrations, studioFiles } from '../lib/scaffold.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-office-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbb';

/* ------------------------------------------------------------------ the relay */

function relay(opts = {}) {
  let t = 1_000_000;
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 4, now: () => t, ...opts });
  const sock = (extra = {}) => {
    const conn = { sent: [], closed: null, ip: '203.0.113.1', ...extra, send(text) { this.sent.push(JSON.parse(text)); }, close(code, why) { this.closed = [code, why]; } };
    const h = room.attach(conn);
    return { conn, h, say: (m) => h.onMessage(JSON.stringify(m)), last: (type) => [...conn.sent].reverse().find((x) => x.t === type) ?? null };
  };
  const join = (extra = {}, hello = {}) => { const s = sock(extra); s.say({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, ...hello }); return s; };
  const watcher = (extra = {}) => { const w = { sent: [], ...extra, send(text) { this.sent.push(JSON.parse(text)); } }; room.watch(w); return w; };
  return { room, join, watcher, advance: (ms) => { t += ms; }, now: () => t };
}

test('the relay: a kick holds a player out of that room, frees their seat, and says so to their page', () => {
  const { room, join, watcher, advance } = relay();
  const a = join({ browser: KEY_A });
  const b = join({ browser: KEY_B });
  const aw = watcher({ browser: KEY_A });
  const bw = watcher({ browser: KEY_B });
  const welcome = a.last('welcome');
  assert.equal(welcome.role, 'host');
  const res = room.control('kick', { id: welcome.id, minutes: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.seat, 0);
  const err = a.last('error');
  assert.equal(err.code, 'kicked');
  assert.match(err.message, /removed you from this room/);
  assert.equal(err.until, 1_000_000 + 600_000);
  assert.deepEqual(a.conn.closed, [1008, 'kicked']);
  assert.ok(!room.seats.has(0), 'the seat is free for somebody else at once');
  assert.equal(b.last('leave').why, 'kicked', 'the room hears why the seat emptied (its host turns it back into a bot)');
  assert.equal(b.last('role')?.role, 'host', 'the kicked host handed the room on');
  assert.equal(aw.sent.find((m) => m.t === 'kicked')?.until, 1_000_000 + 600_000, 'the kicked player\'s page is told');
  assert.ok(!bw.sent.some((m) => m.t === 'kicked'), 'nobody else\'s page is');
  // Back with the same seat token, or a fresh tab of the same browser: refused, with when it ends.
  const again = join({ browser: KEY_A }, { token: welcome.token });
  assert.equal(again.last('error').code, 'kicked');
  assert.equal(again.last('welcome'), null);
  const tab = join({ browser: KEY_A });
  assert.equal(tab.last('error').code, 'kicked');
  // Its page reloading is told at once.
  assert.equal(watcher({ browser: KEY_A }).sent.at(-1).t, 'kicked');
  // Somebody else on the same network is not held (only when the owner asks for the address too).
  const c = join({ browser: 'ccccccccccccccccc' });
  assert.equal(c.last('welcome').seat, 0, 'a newcomer gets the freed seat');
  // After the hold: welcome back.
  advance(600_001);
  const back = join({ browser: KEY_A });
  assert.ok(back.last('welcome'), 'after the minutes are up the player can come back');
  // The facts the office reads name the hold; the public facts never carry a browser key or an address.
  const facts = JSON.stringify(room.facts());
  assert.doesNotMatch(facts, new RegExp(`${KEY_A}|${KEY_B}|203\\.0\\.113`));
});

test('a kick can hold the player\'s address too; a kick of nobody says so', () => {
  const { room, join } = relay();
  const a = join({ browser: KEY_A, ip: '198.51.100.9' });
  join({ browser: KEY_B, ip: '198.51.100.7' });
  assert.equal(room.control('kick', { seat: 3 }).error, 'no-player');
  assert.equal(room.control('kick', { id: a.last('welcome').id, minutes: 5, address: true }).ok, true);
  const sameNet = join({ browser: 'dddddddddddddddddd', ip: '198.51.100.9' });
  assert.equal(sameNet.last('error').code, 'kicked', 'another browser on that address is held too');
  assert.ok(room.officeFacts().office.bans[0].address);
});

test('mute: a muted player\'s speech goes nowhere, the room hears who, and it outlives a reconnect', () => {
  const { room, join, watcher } = relay();
  const host = join({ browser: KEY_A });
  const b = join({ browser: KEY_B });
  const bw = watcher({ browser: KEY_B });
  const bWelcome = b.last('welcome');
  assert.equal(room.control('mute', { id: bWelcome.id, minutes: 10 }).ok, true);
  assert.equal(host.last('mute').seat, 1);
  assert.ok(host.last('mute').until > 0);
  assert.ok(bw.sent.some((m) => m.t === 'muted' && m.until > 0), 'the muted player\'s page is told');
  assert.ok(SPEECH.test('chat:line') && SPEECH.test('emote') && SPEECH.test('say') && !SPEECH.test('jump'));
  const before = host.conn.sent.length;
  b.say({ t: 'ev', k: 'chat', d: 'hello' });
  b.say({ t: 'ev', k: 'emote', d: 'wave' });
  assert.equal(host.conn.sent.length, before, 'chat and emotes from a muted player reach nobody');
  b.say({ t: 'ev', k: 'jump', d: 1 });
  assert.equal(host.last('ev').k, 'jump', 'play goes on');
  assert.equal(room.facts().clients.find((c) => c.seat === 1).muted, true, 'the peers say who is muted');
  // A reload keeps the mute (the seat token is the same).
  b.h.onClose();
  const b2 = join({ browser: KEY_B }, { token: bWelcome.token });
  b2.say({ t: 'ev', k: 'say', d: 'again' });
  assert.notEqual(host.last('ev').k, 'say');
  assert.equal(room.control('mute', { seat: 1, off: true }).ok, true);
  b2.say({ t: 'ev', k: 'say', d: 'free' });
  assert.equal(host.last('ev').k, 'say');
});

test('announce: everyone in the room and every page hears it, a joiner gets it in its welcome, and it can come down', () => {
  const { room, join, watcher, advance } = relay();
  const a = join();
  const w = watcher();
  const res = room.control('announce', { text: '  Double gems   for the next round!\n', seconds: 60 });
  assert.equal(res.ok, true);
  assert.equal(a.last('announce').text, 'Double gems for the next round!');
  assert.equal(w.sent.find((m) => m.t === 'announce').text, 'Double gems for the next round!');
  assert.equal(room.facts().announce.text, 'Double gems for the next round!');
  const b = join();
  assert.equal(b.last('welcome').announce.text, 'Double gems for the next round!', 'a joiner sees it too');
  assert.equal(room.control('announce', { text: '' }).cleared, true);
  assert.equal(a.last('announce').text, null);
  room.control('announce', { text: 'x'.repeat(400), seconds: 10 });
  assert.equal(a.last('announce').text.length, 280, 'an announcement is one line of at most 280 characters');
  advance(11_000);
  assert.equal(room.facts().announce, null, 'and it ends by itself');
});

test('close: everyone out with a thank-you, nobody in until it opens, and its pages are told', () => {
  const { room, join, watcher, advance } = relay();
  const a = join();
  const w = watcher({ browser: KEY_A });
  const res = room.control('close', { minutes: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.people, 1);
  assert.equal(a.last('error').code, 'room-closed');
  assert.match(a.last('error').message, /Thanks for playing/);
  assert.equal(w.sent.find((m) => m.t === 'closed').until, res.until);
  assert.equal(room.seats.size, 0);
  assert.equal(join().last('error').code, 'room-closed');
  assert.equal(watcher().sent.at(-1).t, 'closed');
  assert.equal(room.control('close', { reopen: true }).reopened, true);
  assert.ok(join().last('welcome'));
  room.control('close', { seconds: 15 });
  advance(15_001);
  assert.ok(join().last('welcome'), 'a short close (a launch state change) ends by itself');
});

test('the owner\'s holds outlive an empty room and a restart; the seats change while the room runs', () => {
  const { room, join, advance } = relay({ forgetMs: 1000 });
  const a = join({ browser: KEY_A });
  room.control('kick', { id: a.last('welcome').id, minutes: 30 });
  room.control('announce', { text: 'Back soon', seconds: 600 });
  advance(2000);
  room.tick();
  assert.equal(room.seats.size, 0, 'the empty room forgot its play');
  assert.equal(join({ browser: KEY_A }).last('error').code, 'kicked', 'but not the kick');
  const saved = room.officeSaved();
  const fresh = new NetRoom({ code: 'pub-1', maxPlayers: 4, now: () => 1_000_000 + 2000 });
  fresh.restoreOffice(JSON.parse(JSON.stringify(saved)));
  const c = { sent: [], browser: KEY_A, send(t) { this.sent.push(JSON.parse(t)); }, close() {} };
  fresh.attach(c).onMessage(JSON.stringify({ t: 'hello', v: 1, want: 'play' }));
  assert.equal(c.sent.at(-1).code, 'kicked', 'a restart keeps the kick');
  assert.equal(fresh.facts().announce.text, 'Back soon');
  // Seats: lowered while it runs; seated players keep theirs, nobody new is seated above.
  const r = relay();
  const p = [r.join(), r.join(), r.join()];
  assert.equal(r.room.control('seats', { max: 2 }).max, 2);
  assert.equal(p[2].conn.closed, null, 'a player already in seat 3 keeps it');
  p[2].h.onClose();
  const late = r.join();
  assert.equal(late.last('welcome').full, true, 'nobody new is seated above the new size');
});

test('a launch change lets the round finish, then sends out only whom it leaves out; a wider one calls it off', () => {
  const { room, join, watcher, advance, now } = relay();
  const owner = join({ browser: KEY_A, via: 'o' });
  const invited = join({ browser: KEY_B, via: 'i-0123456789~p-pl_zoe', player: 'pl_zoe' });
  const guest = join({ browser: 'g'.repeat(18) });
  const gw = watcher({ browser: 'g'.repeat(18) });
  const socks = [owner, invited, guest];
  // Time passes as it does for live sockets: each pings every few seconds (a silent one is closed after 10 s).
  const wait = (ms) => { for (let left = ms; left > 0; left -= 4000) { advance(Math.min(4000, left)); for (const x of socks) if (!x.conn.closed) x.say({ t: 'ping', c: 0 }); room.tick(); } };
  owner.say({ t: 'round', round: { n: 3, phase: 'live', startedAt: now(), endsAt: now() + 60_000 } });
  const r = room.control('regate', { allow: ['o', 'i'], notice: 'Owl Run becomes an invite-only beta after this round.', message: 'Owl Run is an invite-only beta now.' });
  assert.equal(r.leaving, 1);
  assert.equal(r.afterRound, 3);
  assert.equal(guest.last('announce').text, 'Owl Run becomes an invite-only beta after this round.', 'everyone is told, in the game');
  assert.ok(room.officeFacts().office.regate, 'the office sees it waiting');
  wait(30_000);
  assert.equal(guest.conn.closed, null, 'the round is still on: nobody is sent out');
  owner.say({ t: 'round', round: { n: 3, phase: 'over', startedAt: now() - 30_000, endsAt: now(), results: [] } });
  wait(3500);
  assert.equal(guest.conn.closed, null, 'the results show for a moment');
  wait(2000);
  assert.equal(guest.last('error').code, 'room-closed');
  assert.equal(guest.last('error').message, 'Owl Run is an invite-only beta now.');
  assert.equal(guest.last('error').until, undefined, 'no reopening time: they come back through the door if they have access');
  assert.deepEqual(guest.conn.closed, [1000, 'room-closed']);
  assert.ok(gw.sent.some((m) => m.t === 'closed'), 'their page is told');
  assert.equal(invited.conn.closed, null, 'the invited play on');
  assert.equal(owner.conn.closed, null, 'the owner plays on');
  assert.equal(room.officeDirty, true, 'the room asks for its stored state to be written');
  assert.equal(room.officeSaved().regate, null, 'and what is stored no longer waits to send anyone out');
  const restarted = new NetRoom({ code: 'pub-1', maxPlayers: 4, now: () => now() + 10 * 60_000 });
  restarted.restoreOffice({ regate: { allow: ['o'], until: now() - 60_000, roundN: null, message: 'x' } });
  assert.equal(restarted.regate, null, 'a change long past is never restored');
  // Back to a wider state before the round ends: the waiting change is called off.
  const late = join({ browser: 'h'.repeat(18) });
  socks.push(late);
  owner.say({ t: 'round', round: { n: 4, phase: 'live', startedAt: now(), endsAt: now() + 60_000 } });
  assert.equal(room.control('regate', { allow: ['o'] }).leaving, 2);
  assert.equal(room.control('regate', {}).cancelled, true);
  wait(20 * 60_000);
  assert.equal(late.conn.closed, null);
  // No round running: half a minute. Private: the invited leave too, and only the owner stays.
  owner.say({ t: 'round', round: { n: 5, phase: 'over', startedAt: now() - 1000, endsAt: now(), results: [] } });
  room.control('regate', { allow: ['o'] });
  wait(28_000);
  assert.equal(late.conn.closed, null);
  wait(3000);
  assert.deepEqual(late.conn.closed, [1000, 'room-closed']);
  assert.deepEqual(invited.conn.closed, [1000, 'room-closed']);
  assert.equal(owner.conn.closed, null);
  // A room the change leaves everyone in does nothing.
  assert.equal(room.control('regate', { allow: ['o'] }).leaving, 0);
});

test('an invited player who is signed in is held by account: a kick keeps their account out on another browser', () => {
  const { room, join } = relay();
  join({ browser: KEY_A, via: 'o' });
  const zoe = join({ browser: KEY_B, via: 'i-0123456789~p-pl_zoe', player: 'pl_zoe' });
  room.control('kick', { id: zoe.last('welcome').id, minutes: 10 });
  const elsewhere = join({ browser: 'z'.repeat(20), via: 'i-0123456789~p-pl_zoe', player: 'pl_zoe' });
  assert.equal(elsewhere.last('error').code, 'kicked', 'the same account on another browser is held out');
  const someoneElse = join({ browser: 'y'.repeat(20), via: 'i-0123456789' });
  assert.ok(someoneElse.last('welcome'), 'another browser with the same invite but no account is not');
});

/* ------------------------------------------------------------------ the Worker */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Office Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
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

/** A Durable Object namespace of the real class, each object with its own storage. */
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
    assert.equal(run(['game', 'new', 'owl-run', '--from', 'gem-rush', '--name', 'Owl Run'], dir).status, 0);
    assert.equal(run(['game', 'new', 'night-vault', '--from', 'gem-rush', '--name', 'Night Vault'], dir).status, 0);
    const gj = join(dir, 'games', 'night-vault', 'game.json');
    writeFileSync(gj, JSON.stringify({ ...JSON.parse(readFileSync(gj, 'utf8')), launch: 'private' }, null, 2));
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const waits = [];
  const ref = {};
  const DB = fakeD1(dir);
  const env = { ASSETS: assetsOf(dir), DB, STUDIO_NAME: 'Office Owls' };
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
  const session = 'e'.repeat(64);
  mint('session', session);
  const officeKey = `hsk_${'0f'.repeat(24)}`;
  mint('office', officeKey);
  const readKey = `hsk_${'1e'.repeat(24)}`;
  mint('read', readKey);
  /** Seat a player in a live room (the Table's own relay), as a browser's socket would. */
  const seat = async (game, room, { browser = KEY_A, name = '' } = {}) => {
    const stub = env.TABLE.get(`${game}/${room}`);
    await stub.fetch(`https://table/__facts?game=${game}&room=${room}&max=8`);
    const table = env.TABLE.objs.get(`${game}/${room}`);
    const conn = { sent: [], closed: null, ip: '203.0.113.5', browser, send(t) { this.sent.push(JSON.parse(t)); }, close(c, w) { this.closed = [c, w]; } };
    const h = table.room.attach(conn);
    h.onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'desk', want: 'play', canHost: true, ...(name ? { name } : {}) }));
    table.report();
    await Promise.all(waits.splice(0));
    return { conn, h, table, welcome: conn.sent.find((m) => m.t === 'welcome') };
  };
  const owner = { cookie: `studio_owner=${session}` };
  const same = { origin: 'https://owls.example', 'content-type': 'application/json' };
  return { env, DB, fetchSite, seat, owner, same, officeKey, readKey, waits };
}

test('controls are signed by the studio and checked by the room: forged, changed, late, replayed or misaddressed ones are refused', async () => {
  const { env } = await site();
  const seen = new Map();
  const ctl = await signControl(env, { op: 'kick', game: 'owl-run', room: 'pub-1', args: { seat: 0, minutes: 10 } });
  assert.equal(await verifyControl(env, JSON.parse(JSON.stringify(ctl)), { game: 'owl-run', room: 'pub-1' }, seen), null);
  assert.equal(await verifyControl(env, ctl, { game: 'owl-run', room: 'pub-1' }, seen), 'replayed');
  const fresh = await signControl(env, { op: 'kick', game: 'owl-run', room: 'pub-1', args: { seat: 0, minutes: 10 } });
  assert.equal(await verifyControl(env, { ...fresh, args: { seat: 1, minutes: 10 } }, { game: 'owl-run', room: 'pub-1' }), 'signature');
  assert.equal(await verifyControl(env, fresh, { game: 'owl-run', room: 'pub-2' }), 'room');
  assert.equal(await verifyControl(env, { ...fresh, exp: Date.now() - 1 }, { game: 'owl-run', room: 'pub-1' }), 'expired');
  assert.equal(await verifyControl(env, { t: 'ctl', v: 1, op: 'kick', game: 'owl-run', room: 'pub-1', at: Date.now(), exp: Date.now() + 1000, n: '0'.repeat(16), args: {} }, { game: 'owl-run', room: 'pub-1' }), 'signature');
  // The room's Table refuses an unsigned control.
  const res = await env.TABLE.get('owl-run/pub-1').fetch(new Request('https://table/__office?game=owl-run&room=pub-1&max=8', { method: 'POST', body: JSON.stringify({ t: 'ctl', v: 1, op: 'close', game: 'owl-run', room: 'pub-1', args: {} }) }));
  assert.equal(res.status, 403);
  // Tickets: for one game, one holder, unexpired; nothing else passes.
  const t = await ticketFor(env, 'night-vault', 'o');
  assert.equal(await ticketSub(env, 'night-vault', t), 'o');
  assert.equal(await ticketSub(env, 'owl-run', t), null, 'a ticket is for its own game');
  assert.equal(await ticketSub(env, 'night-vault', t.replace(/\.o\./, '.i-0123456789.')), null, 'and its own holder');
  assert.equal(await ticketSub(env, 'night-vault', await ticketFor(env, 'night-vault', 'o', -1000)), null, 'and only until it ends');
});

test('a private game is the owner\'s alone: out of every list, the rooms and the manifest; its door, frame and sockets refuse everyone else', async () => {
  const { fetchSite, owner } = await site();
  const games = await (await fetchSite('/api/games')).json();
  assert.deepEqual(games.games.map((g) => g.id), ['owl-run']);
  const manifest = await (await fetchSite('/.well-known/homie-studio.json')).json();
  assert.deepEqual(manifest.games.map((g) => g.id), ['owl-run'], 'the directory never sees it');
  for (const k of ['remix', 'source', 'remixOf']) assert.ok(!(k in manifest.games[0]), `the manifest has no ${k}: no game is offered whole`);
  assert.doesNotMatch(await (await fetchSite('/games/')).text(), /Night Vault/);
  for (const p of ['/night-vault/', '/night-vault/play', '/night-vault/tv', '/night-vault/credits']) assert.equal((await fetchSite(p)).status, 404, p);
  assert.equal((await fetchSite('/night-vault/live')).status, 404);
  assert.equal((await fetchSite('/night-vault/api/lobby', { method: 'POST' })).status, 404);
  assert.equal((await fetchSite('/night-vault/__game/')).status, 403);
  assert.equal((await fetchSite('/night-vault/__net?room=pub-1', { headers: { upgrade: 'websocket' } })).status, 403);
  // No game's source is served, public or not: the old address says so the same way for both (it tells nobody which exist).
  for (const id of ['night-vault', 'owl-run']) {
    const gone = await fetchSite(`/games/${id}/source.json`);
    assert.equal(gone.status, 410, id);
    assert.deepEqual(await gone.json(), { retired: 'remix', see: '/parts/' });
  }
  // The owner, signed in: the game, a ticket for its frame and sockets, and the owner's overlay.
  const play = await fetchSite('/night-vault/play', { headers: owner });
  assert.equal(play.status, 200);
  const html = await play.text();
  const boot = JSON.parse(/window\.__HOMIE_PLAY=(\{.*?\});<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
  assert.match(boot.t, /^[a-z0-9]+\.o\.[A-Za-z0-9_-]{32}$/);
  assert.equal(boot.owner, true);
  const frame = await fetchSite(`/night-vault/__game/?room=pub-1&b=${KEY_A}&t=${encodeURIComponent(boot.t)}`);
  assert.equal(frame.status, 200);
  const net = JSON.parse(/window\.HOMIE_NET=(\{.*?\})<\/script>/.exec(await frame.text())[1].replace(/\\u003c/g, '<'));
  assert.match(net.url, new RegExp(`^wss://owls\\.example/night-vault/__net\\?room=pub-1&b=${KEY_A}&t=`), 'the socket carries the room key and the ticket');
  assert.equal((await fetchSite('/night-vault/', { headers: owner })).status, 200);
});

test('the owner\'s overlay is in the owner\'s own play page only', async () => {
  const { fetchSite, owner } = await site();
  const stranger = await (await fetchSite('/owl-run/play')).text();
  assert.doesNotMatch(stranger, /data-owner|__ownerPick|\/_studio\/api\/kick|"owner":true/);
  const mine = await (await fetchSite('/owl-run/play', { headers: owner })).text();
  assert.match(mine, /"owner":true/);
  assert.match(mine, /__ownerPick/);
  assert.match(mine, /\/_studio\/api\/kick/);
  // The owner's page names the owner to the room, so a game going private or invite-only keeps the owner in it.
  assert.match(mine, /"t":"[a-z0-9]+\.o\.[A-Za-z0-9_-]{32}"/);
  assert.doesNotMatch(stranger, /"t":"/, 'a stranger in a public game carries no ticket');
  // A forged cookie is nobody.
  assert.doesNotMatch(await (await fetchSite('/owl-run/play', { headers: { cookie: `studio_owner=${'f'.repeat(64)}` } })).text(), /__ownerPick/);
});

test('the office API is the owner\'s: a key looks, announces and invites, and only ASKS for a kick; the owner\'s tap does it', async () => {
  const { fetchSite, owner, same, officeKey, readKey, seat } = await site();
  assert.equal((await fetchSite('/_studio/api/office')).status, 401);
  assert.equal((await fetchSite('/_studio/api/office', { headers: { authorization: `Bearer ${readKey}` } })).status, 401, 'a stats read key is not an office key');
  const amy = await seat('owl-run', 'pub-1', { browser: KEY_A, name: 'Amy' });
  const ben = await seat('owl-run', 'pub-1', { browser: KEY_B, name: 'Ben' });
  const bearer = { authorization: `Bearer ${officeKey}` };
  const office = await (await fetchSite('/_studio/api/office', { headers: bearer })).json();
  assert.equal(office.ok, true);
  const og = office.games.find((g) => g.id === 'owl-run');
  assert.equal(og.launch, 'public');
  const room = og.rooms.find((r) => r.room === 'pub-1');
  assert.deepEqual(room.clients.map((c) => [c.name, c.seat, c.as]), [['Amy', 0, 'guest'], ['Ben', 1, 'guest']]);
  assert.ok(room.openedAt > 0);
  assert.match(room.clients[0].browser, /^[a-z0-9]{6}$/, 'a browser is a short tag, never its key');
  assert.doesNotMatch(JSON.stringify(office), new RegExp(`${KEY_A}|203\\.0\\.113`));
  assert.equal(office.games.find((g) => g.id === 'night-vault').launch, 'private');
  // Announce: at once, to the room.
  const said = await (await fetchSite('/_studio/api/announce', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ game: 'owl-run', text: 'Welcome to the beta!' }) })).json();
  assert.equal(said.ok, true);
  assert.equal(said.people, 2);
  assert.equal(amy.conn.sent.findLast((m) => m.t === 'announce').text, 'Welcome to the beta!');
  // A kick with the key: an ask, nothing done yet.
  const asked = await fetchSite('/_studio/api/kick', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ game: 'owl-run', room: 'pub-1', id: ben.welcome.id, minutes: 10 }) });
  assert.equal(asked.status, 202);
  const { ask } = await asked.json();
  assert.equal(ask.state, 'pending');
  assert.match(ask.what, /^Kick Ben \(seat 2\) out of Room 1 of Owl Run/);
  assert.equal(ask.confirm, `https://owls.example/_studio/confirm/${ask.id}`);
  assert.equal(ben.conn.closed, null, 'the key alone kicks nobody');
  // Only the owner's signed-in browser confirms, from this site, with one tap.
  assert.equal((await fetchSite(`/_studio/confirm/${ask.id}`)).status, 401);
  assert.equal((await fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: bearer, body: new URLSearchParams({ do: 'yes' }) })).status, 401, 'the key cannot say yes');
  const page = await (await fetchSite(`/_studio/confirm/${ask.id}`, { headers: owner })).text();
  assert.match(page, /Kick Ben \(seat 2\)/);
  assert.match(page, /name="do" value="yes"/);
  assert.equal((await fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { ...owner, origin: 'https://evil.example' }, body: new URLSearchParams({ do: 'yes' }) })).status, 403);
  const done = await fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { ...owner, origin: 'https://owls.example' }, body: new URLSearchParams({ do: 'yes' }) });
  assert.match(await done.text(), /<h1>Done\.<\/h1>/);
  assert.equal(ben.conn.sent.findLast((m) => m.t === 'error').code, 'kicked');
  const status = await (await fetchSite(`/_studio/api/asks/${ask.id}`, { headers: bearer })).json();
  assert.equal(status.ask.state, 'done');
  // A second tap does nothing more.
  assert.match(await (await fetchSite(`/_studio/confirm/${ask.id}`, { method: 'POST', headers: { ...owner, origin: 'https://owls.example' }, body: new URLSearchParams({ do: 'yes' }) })).text(), /<h1>Done\.<\/h1>/);
  // The owner's own session does it at once (the office page and the in-game overlay); a cross-site POST never.
  assert.equal((await fetchSite('/_studio/api/mute', { method: 'POST', headers: { ...owner, 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ game: 'owl-run', room: 'pub-1', id: amy.welcome.id }) })).status, 403);
  assert.equal((await fetchSite('/_studio/api/mute', { method: 'POST', headers: { ...owner, origin: 'https://owls.example' }, body: JSON.stringify({ game: 'owl-run', room: 'pub-1', id: amy.welcome.id }) })).status, 415, 'JSON only');
  const muted = await (await fetchSite('/_studio/api/mute', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', room: 'pub-1', id: amy.welcome.id, minutes: 5 }) })).json();
  assert.equal(muted.ok, true);
  assert.equal(amy.conn.sent.findLast((m) => m.t === 'mute').seat, 0);
  const closed = await (await fetchSite('/_studio/api/close', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', room: 'pub-1', minutes: 1 }) })).json();
  assert.equal(closed.ok, true);
  assert.equal(amy.conn.sent.findLast((m) => m.t === 'error').code, 'room-closed');
  // The Lobby sends nobody to a closed room.
  const lobby = await (await fetchSite('/owl-run/api/lobby', { method: 'POST' })).json();
  assert.notEqual(lobby.room, 'pub-1');
  const not = await (await fetchSite(`/owl-run/api/lobby?not=${lobby.room}`, { method: 'POST' })).json();
  assert.notEqual(not.room, lobby.room, 'and a browser held out of a room asks for another');
});

test('invite-only: an invite code lets a browser in with a pass for that game; a used-up or revoked invite lets nobody in', async () => {
  const { fetchSite, owner, same, seat, DB, env } = await site();
  const pub = await seat('owl-run', 'pub-7', { browser: KEY_B, name: 'Early' });
  const set = await (await fetchSite('/_studio/api/game', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', launch: 'invite' }) })).json();
  assert.equal(set.ok, true);
  assert.equal(set.launch, 'invite');
  assert.equal(set.regating, 1, 'its live room re-gates after its current round');
  assert.equal(pub.conn.closed, null, 'nobody is cut off mid-round');
  assert.match(pub.conn.sent.findLast((m) => m.t === 'announce').text, /Owl Run becomes an invite-only beta after this round/);
  pub.table.room.regate.until = 0;
  pub.table.room.tick();
  assert.equal(pub.conn.sent.findLast((m) => m.t === 'error').code, 'room-closed', 'then a player with no invite leaves with a thank-you');
  assert.match(pub.conn.sent.findLast((m) => m.t === 'error').message, /invite-only beta now/);
  assert.deepEqual((await (await fetchSite('/api/games')).json()).games.map((g) => g.id), [], 'and it leaves every list');
  const door = await fetchSite('/owl-run/');
  assert.equal(door.status, 200);
  const doorHtml = await door.text();
  assert.match(doorHtml, /invite-only beta/i);
  assert.match(doorHtml, /<form method="post" action="\/owl-run\/invite"/);
  const made = await (await fetchSite('/_studio/api/invites', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', label: 'Sam', uses: 1 }) })).json();
  assert.equal(made.ok, true);
  const inv = made.invites[0];
  assert.match(inv.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(inv.link, `https://owls.example/owl-run/?invite=${inv.code}`);
  assert.match(await (await fetchSite(`/owl-run/?invite=${inv.code}`)).text(), new RegExp(`value="${inv.code}"`), 'the link fills the code in; a link preview spends nothing');
  assert.equal((await fetchSite('/owl-run/invite', { method: 'POST', headers: { origin: 'https://evil.example' }, body: new URLSearchParams({ code: inv.code }) })).status, 403);
  const bad = await fetchSite('/owl-run/invite', { method: 'POST', headers: { origin: 'https://owls.example' }, body: new URLSearchParams({ code: 'ZZZZ-ZZZZ' }) });
  assert.equal(bad.status, 403);
  const ok = await fetchSite('/owl-run/invite', { method: 'POST', headers: { origin: 'https://owls.example' }, body: new URLSearchParams({ code: inv.code.toLowerCase() }) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/owl-run/play');
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^studio_pass_owl-run=[a-f0-9]{48}; Path=\/owl-run\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  const pass = { cookie: cookie.split(';')[0] };
  const play = await fetchSite('/owl-run/play', { headers: pass });
  assert.equal(play.status, 200);
  const boot = JSON.parse(/window\.__HOMIE_PLAY=(\{.*?\});<\/script>/.exec(await play.text())[1]);
  assert.match(boot.t, /\.i-[a-f0-9]{10}\./);
  // Signed in to a player account as well: the ticket names the invite AND the account (a kick holds both).
  const token = 'T'.repeat(43);
  DB.sql.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?, ?, 1, 0, 0, ?, ?)').run(`pl_${'z'.repeat(22)}`, 'Zoe', Date.now(), Date.now());
  DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(sha(token), `pl_${'z'.repeat(22)}`, Date.now() + 86400_000);
  const both = JSON.parse(/window\.__HOMIE_PLAY=(\{.*?\});<\/script>/.exec(await (await fetchSite('/owl-run/play', { headers: { cookie: `${pass.cookie}; studio_player=${token}` } })).text())[1]);
  assert.match(both.t, new RegExp(`\\.i-[a-f0-9]{10}~p-pl_${'z'.repeat(22)}\\.`));
  assert.match(await ticketSub(env, 'owl-run', both.t), /^i-[a-f0-9]{10}~p-pl_z+$/);
  assert.equal(await ticketAllows(env, await ticketSub(env, 'owl-run', both.t), 'invite'), true);
  assert.equal(await ticketAllows(env, `p-pl_${'z'.repeat(22)}`, 'invite'), false, 'an account alone does not open a beta');
  assert.equal(boot.owner, undefined, 'an invited player is not the owner');
  assert.equal((await fetchSite(`/owl-run/__game/?t=${encodeURIComponent(boot.t)}`)).status, 200);
  // One use: the next browser with the same code is refused.
  assert.equal((await fetchSite('/owl-run/invite', { method: 'POST', headers: { origin: 'https://owls.example' }, body: new URLSearchParams({ code: inv.code }) })).status, 403);
  // Revoked: the pass and its ticket end.
  await fetchSite('/_studio/api/invites/revoke', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', id: inv.id }) });
  assert.match(await (await fetchSite('/owl-run/play', { headers: pass })).text(), /invite-only beta/i);
  assert.equal((await fetchSite(`/owl-run/__game/?t=${encodeURIComponent(boot.t)}`)).status, 403);
  // Back to public; the owner's room size reaches the Lobby. A studio from the field has the old switch's value in
  // D1 (`office_games.remix`, here 0: its owner had withdrawn the source): an older plugin may still send `remix`
  // beside a launch state, which is left out; the column is neither read nor written, and keeps what it held.
  DB.sql.prepare('UPDATE office_games SET remix = 0 WHERE game = ?').run('owl-run');
  const back = await (await fetchSite('/_studio/api/game', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', launch: 'public', remix: true, maxPlayers: 2 }) })).json();
  assert.deepEqual([back.ok, back.launch, back.maxPlayers, 'remix' in back], [true, 'public', 2, false]);
  assert.equal(DB.sql.prepare('SELECT remix FROM office_games WHERE game = ?').get('owl-run').remix, 0, 'the column keeps what it held');
  const m = await (await fetchSite('/.well-known/homie-studio.json')).json();
  assert.ok(!('remix' in m.games[0]) && !('source' in m.games[0]));
  assert.equal((await (await fetchSite('/owl-run/api/lobby', { method: 'POST' })).json()).max, 2);
  // The switch alone is refused in a sentence that says where to go.
  const sw = await fetchSite('/_studio/api/game', { method: 'POST', headers: { ...owner, ...same }, body: JSON.stringify({ game: 'owl-run', remix: true }) });
  assert.equal(sw.status, 400);
  assert.match((await sw.json()).message, /remix was retired: a game is no longer handed over whole.*parts \(\/parts\/\)/);
  const office = await (await fetchSite('/_studio/api/office', { headers: owner })).json();
  for (const k of ['remix', 'remixBuilt', 'remixOff', 'license']) assert.ok(!(k in office.games.find((g) => g.id === 'owl-run')), `the office has no ${k}`);
  assert.equal((await fetchSite('/games/owl-run/source.json')).status, 410);
});

test('a room that opens just as its game narrows reads the launch state on its first heartbeat and re-gates', async () => {
  const { DB, seat, env } = await site();
  const early = await seat('night-vault', 'pub-3', { browser: KEY_B, name: 'Early' });
  const table = early.table;
  // Public (no row): nothing to do. Then the owner's change lands in D1 without reaching this room (the race).
  assert.equal(await table.rereadLaunch(), null);
  DB.sql.prepare('INSERT OR REPLACE INTO office_games (game, launch, remix, max_players, updated_at) VALUES (?, ?, NULL, NULL, ?)').run('night-vault', 'invite', Date.now());
  const r = await table.rereadLaunch();
  assert.equal(r.ok, true);
  assert.equal(r.leaving, 1, 'the guest without an invite will leave');
  assert.deepEqual(table.room.regate.allow, ['o', 'i']);
  assert.match(early.conn.sent.findLast((m) => m.t === 'announce').text, /invite-only beta after this round/);
  assert.equal(early.conn.closed, null, 'after the round, never before');
  assert.equal(await table.rereadLaunch(), null, 'a room already re-gating is left as it is');
  // A Preview enforces no launch state.
  const preview = Object.create(table);
  preview.env = { ...env, HOMIE_PREVIEW: '1' };
  assert.equal(await table.rereadLaunch.call(preview), null);
});

test('a sign-in lands on the office, an ask or a game; the office carries an older session to /', async () => {
  const { fetchSite, DB } = await site();
  const key = `hsk_${'ab'.repeat(24)}`;
  DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(sha(key), 'signin', Date.now() + 60_000);
  const get = await (await fetchSite(`/_studio/signin?k=${key}&to=${encodeURIComponent('/night-vault/play')}`)).text();
  assert.match(get, /Sign in and play/);
  const post = await fetchSite(`/_studio/signin?k=${key}&to=${encodeURIComponent('/night-vault/play')}`, { method: 'POST', headers: { origin: 'https://owls.example' } });
  assert.equal(post.status, 303);
  assert.equal(post.headers.get('location'), '/night-vault/play');
  const cookie = post.headers.get('set-cookie');
  assert.match(cookie, /; Path=\/; HttpOnly; SameSite=Lax;/);
  assert.equal((await fetchSite('/night-vault/play', { headers: { cookie: cookie.split(';')[0] } })).status, 200, 'the owner\'s phone opens the private game');
  const office = await fetchSite('/_studio/office', { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(office.status, 200);
  assert.match(office.headers.get('content-security-policy'), /script-src 'sha256-[A-Za-z0-9+/=]+'; connect-src 'self'/);
  assert.match(office.headers.get('set-cookie'), /; Path=\/;/);
  assert.equal((await fetchSite('/_studio/office')).status, 401);
  assert.equal((await fetchSite(`/_studio/signin?k=${key}&to=https%3A%2F%2Fevil.example%2F`)).status, 200, 'an outside address is never a destination');
});

test('a new studio has the back office\'s migration, after the players one, and it can be applied twice', () => {
  const files = studioFiles({ name: 'X', slug: 'x', homie: 'https://homie.test' });
  assert.equal(files[`site/migrations/${OFFICE_MIGRATION_FILE}`], OFFICE_MIGRATION);
  // 0.12.0 shipped 0004_players.sql: a studio upgrading from it applies this one after it, in order.
  // 0.16.0 added 0006_studio_servers.sql after it (servers and agent seats; test/servers.test.mjs), 0.23.0
  // 0007_studio_chat.sql (room chat's rules and reports; test/chat.test.mjs), 0.24.0 0008_studio_shop.sql (the shop) and
  // 0.29.0 0009_studio_lounge.sql (the Lounge and kept chat; test/lounge.test.mjs).
  assert.deepEqual(Object.keys(files).filter((f) => f.startsWith('site/migrations/')).sort(), ['site/migrations/0001_studio.sql', 'site/migrations/0002_studio_stats.sql', 'site/migrations/0004_players.sql', 'site/migrations/0005_studio_office.sql', 'site/migrations/0006_studio_servers.sql', 'site/migrations/0007_studio_chat.sql', 'site/migrations/0008_studio_shop.sql', 'site/migrations/0009_studio_lounge.sql']);
  const dir = join(scratch, 'from-012');
  mkdirSync(join(dir, 'site', 'migrations'), { recursive: true });
  for (const f of ['0001_studio.sql', '0002_studio_stats.sql', '0004_players.sql']) writeFileSync(join(dir, 'site', 'migrations', f), files[`site/migrations/${f}`]);
  assert.deepEqual(ensureMigrations(dir), [`site/migrations/${OFFICE_MIGRATION_FILE}`, 'site/migrations/0006_studio_servers.sql', 'site/migrations/0007_studio_chat.sql', 'site/migrations/0008_studio_shop.sql', 'site/migrations/0009_studio_lounge.sql'], 'a 0.12.0 studio gets the office migration, then the servers one, room chat\'s, the shop\'s and the Lounge\'s');
  assert.deepEqual(ensureMigrations(dir), []);
  const sql = new DatabaseSync(':memory:');
  sql.exec(OFFICE_MIGRATION);
  sql.exec(OFFICE_MIGRATION);
  assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE name = 'office_invites'").get());
});

test('the office tells the owner that room saves are failing while play continues', async () => {
  const { fetchSite, owner, seat } = await site();
  const player = await seat('owl-run', 'pub-1', { name: 'Player' });
  player.table.storageHealth = { ok: false, message: 'SQLITE_FULL', since: 1000 };
  const office = await (await fetchSite('/_studio/api/office', { headers: owner })).json();
  const room = office.games.find((g) => g.id === 'owl-run').rooms.find((r) => r.room === 'pub-1');
  assert.equal(room.durability?.ok, false);
  assert.match(room.durability.message, /SQLITE_FULL/);
});
