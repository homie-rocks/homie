/**
 * Netplay contract revision 9: what creators met while building real games on revision 8.
 *
 *   - the link is said out loud: a page that never hears from its room plays alone and SAYS so (`link: 'alone'`), a
 *     dropped socket is `reconnecting`, and both are events, a property and a line over the game;
 *   - the wait for the room's welcome is an option (`connectOpenMaxMs`), and a game that boots for seconds can start
 *     that clock itself (`connectClock: 'game'`, `net.start()`);
 *   - a host whose frames hitch keeps the room with a heartbeat snapshot, for four seconds, and a game may name its
 *     own stall time (game.json `netplay.stallMs`, 1500 to 10000);
 *   - a room runs one build of its game at a time (game.json `netplay.version`): an older tab is told to reload, the
 *     Lobby matches within the live build, and a client or relay from before revisions ignores all of it;
 *   - per-peer `features` the relay keeps, so a new host knows them without a handshake;
 *   - `peer.occ`: a host tells "the same player came back" from "somebody new has this seat number";
 *   - createRoom: a room revived from its checkpoint runs the same takeover and adopt callbacks as a fresh join, a
 *     game chooses which body an arrival takes (`admit`), a host that reconnects as host learns who came and went,
 *     and equal scores can share a place (`ties`);
 *   - a late `net.playable()` after an automatic arrival warns, and the arrival's facts are readable;
 *   - `net.prefs`, `net.params`, `net.shell` and `guardGestures()` for the page around the frame;
 *   - the relay's lifecycle lines carry a time and a room, a failed operation is told apart from a departure, and
 *     no line carries a seat token.
 * And what a creator met on 0.31.0 with a heavy 3D game:
 *   - `reconnecting` is bounded, the line over the game says what is true, a full or closed room is said in words,
 *     and a page that was blocked for seconds does not drop a healthy socket;
 *   - seat or solo: the host seats whoever is waiting for a body, and createRoom's `fallback` decides what a
 *     body-less page does (wait, a private round with bots, watch); each way a slow page can join mid-round;
 *   - `net.prefs.number`, `boolean` and `string`: a setting that is not there never reaches a game as null.
 * Run: node --test packages/studio/test/netplay.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NET_REVISION, NetRoom, STALL, departure, featuresOf, stallOf, versionOf } from '../worker/room.mjs';
import { PLAY_PARAMS, PREFS_LIMITS, netplayRow, paramsFrom, playParams } from '../worker/seats.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-netplay-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** The helper and the port kit's createRoom, bundled once the way a game's build bundles them. */
let kit = null;
async function netplayKit() {
  if (kit) return kit;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(PKG, 'netplay', 'netplay.ts'))};\nexport { createRoom } from ${JSON.stringify(join(PKG, 'port', 'room.ts'))};\n`);
  const file = join(scratch, 'kit.mjs');
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  kit = await import(file);
  return kit;
}

/**
 * A relay in memory and sockets to it. `conn`: what the transport (the Worker's Table) says of a socket. `mute`: the
 * relay never answers (a room that is not there). `edit`: rewrite every frame the relay sends (an older relay).
 */
function rig(roomOpts = {}) {
  const lines = [];
  const room = new NetRoom({ code: 'r', maxPlayers: 4, log: (l) => lines.push(l), ...roomOpts });
  const beat = setInterval(() => room.tick(), 250);
  const sockets = [];
  const socket = ({ conn = {}, mute = false, edit = null } = {}) => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      sockets.push(this);
      if (!mute) {
        this.h = room.attach({ ...conn, send: (x) => setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: edit ? edit(x) : x }); }, 0), close: () => { setTimeout(() => this.cut(), 0); }, buffered: () => 0 });
      }
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.sent.push(x); this.h?.onMessage(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose(); }
    /** The network went: both ends learn it, nobody said goodbye. */
    cut() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose('error'); this.onclose?.({}); }
  };
  return { room, lines, sockets, socket, stop: () => clearInterval(beat) };
}
const cfg = (who, extra = {}) => ({ v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who, ...extra });

test('a rules client asks its page to reload an old build and rematch an ended room', async (t) => {
  const { createNetplay } = await netplayKit(); const clock = virtualTime(t);
  const r = rig(); r.room.setServerHost({ frame() {}, facts: () => ({}) }); r.room.setCurrent('new');
  const posts = [];
  const old = createNetplay({ rules: true, config: cfg('old', { ver: 'old' }), WebSocketImpl: r.socket(), post: (m) => posts.push(m), game: 'x' });
  await clock.wait(100);
  assert.equal(old.closedWhy, 'stale');
  assert.ok(posts.some((m) => m.what === 'stale' && m.immediate === true && m.final === true));
  r.room.ended = { why: 'state-changed', ver: 'new' };
  const fresh = createNetplay({ rules: true, config: cfg('fresh', { ver: 'new' }), WebSocketImpl: r.socket(), post: (m) => posts.push(m), game: 'x' });
  await clock.wait(100);
  assert.ok(posts.some((m) => m.what === 'rematch' && m.room === 'r'));
  assert.equal(fresh.closedWhy, 'room-over');
  const count = r.sockets.length; await clock.wait(5000); assert.equal(r.sockets.length, count, 'the page owns rematching; the old socket cannot reopen the ended room');
  fresh.close(); old.close(); r.stop();
});
/** A createRoom game small enough to read: a body is a place, a score and whether it is alive. */
const bodyGame = (extra = {}) => ({
  game: 'x', maxPlayers: 4, minBodies: 3, roundSeconds: 600,
  spawn: (_slot, i) => ({ slot: 0, seat: null, name: '', bot: true, score: 0, x: 100 + i * 10, y: 0, alive: 1 }),
  pack: (b) => [b.x, b.y, b.alive], unpack: (f, b) => { b.x = f[0]; b.y = f[1]; b.alive = f[2]; },
  ...extra,
});
/** Run every room's host loop on the virtual clock (a frame every 50 ms). */
const loop = (...rooms) => { const id = setInterval(() => { for (const r of rooms) r.update(); }, 50); return () => clearInterval(id); };

/** A document small enough for the line over the game: `lines()` is what a player reads on it right now. */
function pageDocument(t) {
  const made = [];
  const node = (tag) => ({ tag, attrs: {}, textContent: '', hidden: false, listeners: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener(type, fn) { this.listeners[type] = fn; } });
  globalThis.document = { hidden: false, head: { appendChild: (el) => made.push(el) }, body: { appendChild: (el) => made.push(el) }, createElement: (tag) => node(tag), addEventListener() {} };
  globalThis.location = { search: '', reload() {} };
  t.after(() => { delete globalThis.document; delete globalThis.location; });
  return { made, lines: () => made.filter((el) => el.tag === 'div' && !el.hidden).map((el) => [el.attrs['data-homie-link'], el.textContent]) };
}
/** What the helper said in the console during a test (and nothing printed). */
function warnings(t) {
  const said = [];
  const real = console.warn;
  console.warn = (...a) => said.push(a.map(String).join(' '));
  t.after(() => { console.warn = real; });
  return said;
}
/** A socket class whose incoming frames a test can drop: `keep(frame)` false drops it. */
const filtered = (Base, keep) => class extends Base {
  set onmessage(fn) { this.heard = fn; }
  get onmessage() { return this.heard ? (ev) => { if (keep(JSON.parse(ev.data)) !== false) this.heard(ev); } : null; }
};
/** The page is blocked for `ms` (a heavy boot, shaders compiling): its clock moves and none of its timers run; then they all run late, the oldest first, before anything that arrives now. */
const blocked = (t, ms) => t.mock.timers.setTime(Date.now() + ms);
/** Where a createRoom page stands, as a player meets it: its link, where the room says it stands, and whether it has a body to play. */
const hasBody = (room) => (room.hosting ? Boolean(room.mine()) : room.net.seat !== null && Boolean(room.net.latest()?.d?.b?.some((r) => r[1] === room.net.seat)));
const stands = (room) => ({ link: room.net.link, standing: room.standing.state, why: room.standing.why, body: hasBody(room) });

test('revision 10, and the numbers both sides share', async () => {
  const { NETPLAY_REVISION, NETPLAY_MARK, PREFS_LIMITS: helperPrefs, cleanVersion, cleanFeatures } = await netplayKit();
  assert.equal(NETPLAY_REVISION, 10);
  assert.equal(NET_REVISION, 10);
  assert.equal(NETPLAY_MARK, 'homie-netplay-rev:10');
  assert.deepEqual({ ...helperPrefs }, { ...PREFS_LIMITS }, 'the helper and the play page keep the same prefs limits');
  for (const v of ['7', 'v2.1', '2026-10-06_b', 12, '', ' x ', 'a b', 'x'.repeat(33), null, undefined, {}]) assert.equal(cleanVersion(v), versionOf(v), `the same word for ${JSON.stringify(v)}`);
  assert.equal(versionOf(12), '12');
  assert.equal(versionOf('a b'), null);
  for (const f of [['powerups', 'Rhythm2', 'x y', '', 'powerups'], 'nope', Array.from({ length: 12 }, (_, i) => `f${i}`)]) assert.deepEqual(cleanFeatures(f), featuresOf(f));
  assert.deepEqual(featuresOf(['powerups', 'Rhythm2', 'x y', 'powerups']), ['powerups', 'rhythm2']);
});

/* ------------------------------------------------------------------ the link (section 22) */

test('a page whose room never answers plays alone and SAYS so; the welcome brings it back, and a dropped socket is `reconnecting`', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  // The first sockets reach nothing (the room is not answering); later ones do.
  let dead = true;
  const Live = r.socket();
  const Dead = r.socket({ mute: true });
  const Either = function (url) { return dead ? new Dead(url) : new Live(url); };
  const posts = [];
  const links = [];
  const roles = [];
  const net = createNetplay({ config: cfg('ann'), WebSocketImpl: Either, post: (m) => posts.push(m), game: 'x', connectOpenMaxMs: 2000, staleMs: 2500 });
  net.on('link', (e) => links.push(e));
  net.on('role', (e) => roles.push(e));
  assert.equal(net.link, 'connecting');
  assert.equal(net.offline, false);
  await clock.wait(2600);
  // What used to happen in silence: an offline host, no seat, hosting a private round.
  assert.equal(net.link, 'alone');
  assert.equal(net.offline, true);
  assert.equal(net.connected, false);
  assert.equal(net.isHost, true);
  assert.deepEqual(links.map((e) => [e.prev, e.state, e.why, e.hosting]), [['connecting', 'alone', 'relay-timeout', true]]);
  assert.deepEqual(posts.filter((m) => m.what === 'link').map((m) => [m.state, m.why]), [['alone', 'relay-timeout']], 'the play page hears it too');
  assert.equal(roles.at(-1).why, 'relay-timeout');
  // The silent socket is dropped as stale and the next knock reaches the room: back in it, and said.
  dead = false;
  await clock.wait(6000);
  assert.equal(net.link, 'online');
  assert.equal(net.offline, false);
  assert.equal(net.connected, true);
  assert.equal(roles.at(-1).why, 'reconnected');
  assert.equal(links.at(-1).state, 'online');
  assert.ok(net.reconnects >= 1, 'net.reconnects counts the knocks');
  assert.equal(net.reconnects, net.stats().reconnects);
  // The network goes: `reconnecting` (it was in a room; it is not offline), then `online` again with the same seat.
  const seat = net.seat;
  const before = net.reconnects;
  r.sockets.at(-1).cut();
  assert.equal(net.link, 'reconnecting');
  assert.equal(net.offline, false, 'cut off from a room is not "no room"');
  assert.equal(net.connected, false);
  assert.equal(links.at(-1).why, 'lost');
  assert.equal(net.isHost, true, 'it still runs its rules: two browsers can both say so while one is cut off, which is why the link says it');
  await clock.wait(600);
  assert.equal(net.link, 'online');
  assert.equal(net.seat, seat);
  assert.equal(net.reconnects, before + 1);
  assert.equal(net.stats().drops, 1, 'one interruption of a link that was up');
  assert.equal(net.stats().link, 'online');
  net.close();
  assert.equal(net.link, 'closed');
});

test('the line over the game: drawn after a moment of `reconnecting`, gone when the room is back, restyled by the game or turned off', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const made = [];
  const node = (tag) => ({ tag, attrs: {}, textContent: '', hidden: false, listeners: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener(type, fn) { this.listeners[type] = fn; } });
  globalThis.document = { hidden: false, head: { appendChild: (el) => made.push(el) }, body: { appendChild: (el) => made.push(el) }, createElement: (tag) => node(tag), addEventListener() {} };
  let reloaded = 0;
  globalThis.location = { search: '', reload: () => { reloaded += 1; } };
  t.after(() => { delete globalThis.document; delete globalThis.location; });
  const flaky = rig();
  t.after(flaky.stop);
  let up = true;
  const Live = flaky.socket();
  const Gone = class { constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onerror?.({}); }, 0); } send() {} close() {} };
  const Either = function (u) { return up ? new Live(u) : new Gone(u); };
  const game = createNetplay({ config: cfg('bo'), WebSocketImpl: Either, post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(game.link, 'online');
  assert.deepEqual(made, [], 'nothing is drawn while all is well');
  // A blip: the socket goes and the first knock (250 ms later) is answered. Shorter than a blink: never drawn.
  flaky.sockets.at(-1).cut();
  assert.equal(game.link, 'reconnecting');
  await clock.wait(400);
  assert.equal(game.link, 'online');
  await clock.wait(600);
  assert.deepEqual(made, []);
  // The room is unreachable for a while: the line appears after 0.7 s.
  up = false;
  flaky.sockets.at(-1).cut();
  await clock.wait(600);
  assert.deepEqual(made, []);
  await clock.wait(300);
  const [style, line] = made;
  assert.equal(style.tag, 'style');
  assert.match(style.textContent, /^:where\(\[data-homie-link\]\)\{/, 'no specificity: any rule the game writes for [data-homie-link] wins');
  assert.deepEqual([line.attrs['data-homie-link'], line.textContent, line.hidden, line.attrs.role], ['reconnecting', 'Reconnecting…', false, 'status']);
  up = true;
  await clock.wait(5000);
  assert.equal(game.link, 'online');
  assert.equal(line.hidden, true, 'gone when the room is back');
  assert.equal(made.length, 2, 'one element, used again');
  // A newer build is live: the same line, tappable, and a tap reloads the game.
  flaky.room.setCurrent('2');
  for (const c of flaky.room.live()) { c.staleTold = true; flaky.room.send(c, { t: 'stale', ver: '2' }); }
  await clock.wait(20);
  assert.deepEqual([line.attrs['data-homie-link'], line.hidden], ['stale', false]);
  assert.match(line.textContent, /new version is ready/);
  line.listeners.click();
  assert.equal(reloaded, 1);
  await clock.wait(10_500);
  assert.equal(line.hidden, true, 'it says so for ten seconds, then gets out of the way');
  game.close();
  // linkOverlay: false: the game draws its own from the `link` event.
  made.length = 0;
  up = true;
  const own = createNetplay({ config: cfg('cy'), WebSocketImpl: Either, post: null, game: 'x', linkOverlay: false });
  const heard = [];
  own.on('link', (e) => heard.push(e.state));
  await clock.wait(100);
  up = false;
  flaky.sockets.at(-1).cut();
  await clock.wait(1500);
  assert.deepEqual(heard, ['online', 'reconnecting']);
  assert.deepEqual(made, [], 'nothing of the helper\'s is drawn');
  own.close();
});

test('the wait for the welcome is an option, and a game that boots for seconds starts the clock itself', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const Dead = r.socket({ mute: true });
  // The default is what it was: ten seconds of listening.
  const plain = createNetplay({ config: cfg('a'), WebSocketImpl: Dead, post: null, game: 'x' });
  // A longer wait, asked for.
  const patient = createNetplay({ config: cfg('b'), WebSocketImpl: Dead, post: null, game: 'x', connectOpenMaxMs: 30_000 });
  // The clock runs only once the game has booted.
  const booting = createNetplay({ config: cfg('c'), WebSocketImpl: Dead, post: null, game: 'x', connectClock: 'game', connectOpenMaxMs: 3000 });
  await clock.wait(9000);
  assert.equal(plain.link, 'connecting');
  await clock.wait(1600);
  assert.equal(plain.link, 'alone', 'the default: 10 s');
  assert.equal(patient.link, 'connecting');
  assert.equal(booting.link, 'connecting', 'a game still booting has not started its wait');
  booting.start();
  await clock.wait(2500);
  assert.equal(booting.link, 'connecting');
  await clock.wait(1200);
  assert.equal(booting.link, 'alone', 'three seconds after net.start()');
  await clock.wait(17_000);
  assert.equal(patient.link, 'alone', 'thirty seconds when asked');
  plain.close(); patient.close(); booting.close();
  // A game that never says start is not left without a role for ever.
  const silent = createNetplay({ config: cfg('d'), WebSocketImpl: Dead, post: null, game: 'x', connectClock: 'game', connectOpenMaxMs: 2000 });
  await clock.wait(59_000);
  assert.equal(silent.link, 'connecting');
  await clock.wait(4000);
  assert.equal(silent.link, 'alone');
  silent.close();
});

test('`reconnecting` is bounded: a room that does not come back is not waited for with a frozen round; the page plays alone, says so, and still finds its room', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const page = pageDocument(t);
  warnings(t);
  const r = rig();
  t.after(r.stop);
  let up = true;
  const Live = r.socket();
  const Gone = class { constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onerror?.({}); }, 0); } send() {} close() {} };
  const Either = function (u) { return up ? new Live(u) : new Gone(u); };
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: r.socket(), post: null, game: 'x' });
  const posts = [];
  const net = createNetplay({ config: cfg('ann'), WebSocketImpl: Either, post: (m) => posts.push(m), game: 'x', canHost: false, reconnectMaxMs: 5000 });
  const links = [];
  const roles = [];
  net.on('link', (e) => links.push([e.prev, e.state, e.why]));
  net.on('role', (e) => roles.push([e.prev, e.role, e.why]));
  await clock.wait(200);
  assert.deepEqual([net.link, net.role, net.seat], ['online', 'replica', 1]);
  // The room goes, and stays gone.
  up = false;
  r.sockets.at(-1).cut();
  await clock.wait(4500);
  assert.equal(net.link, 'reconnecting');
  assert.deepEqual(page.lines(), [['reconnecting', 'Reconnecting…']], 'true for a page that was in the room, for a while');
  await clock.wait(700);
  // What used to be for ever: now a private round, said plainly.
  assert.equal(net.link, 'alone', 'five seconds (reconnectMaxMs), not for ever');
  assert.deepEqual(links.at(-1), ['reconnecting', 'alone', 'reconnect-timeout']);
  assert.deepEqual(roles.at(-1), ['replica', 'host', 'reconnect-timeout'], 'the game is told as a role: it hosts a round of its own');
  assert.deepEqual([net.offline, net.isHost, net.seat], [true, true, null]);
  assert.deepEqual(page.lines(), [['alone', 'Playing on your own · the room dropped, still trying…']]);
  assert.deepEqual(posts.filter((m) => m.what === 'link').at(-1).why, 'reconnect-timeout', 'the play page hears why');
  // It never stopped knocking: the room is back, and so is the page, in the seat its token names.
  up = true;
  await clock.wait(4500);
  assert.equal(net.link, 'online');
  assert.deepEqual(roles.at(-1), ['host', 'replica', 'reconnected']);
  assert.equal(net.seat, 1);
  assert.equal(net.resumed, true);
  assert.deepEqual(page.lines(), [], 'the line goes when the link is up');
  // A reconnect that works in time never becomes `alone` (the default bound is 20 s).
  up = false;
  r.sockets.at(-1).cut();
  await clock.wait(3000);
  up = true;
  await clock.wait(4500);
  assert.equal(net.link, 'online');
  await clock.wait(6000);
  assert.equal(net.link, 'online', 'the bound was cancelled by the welcome');
  assert.equal(roles.length, 3);
  net.close(); host.close();
});

test('the line never says "reconnecting" to a page that was never connected, and a full or closed room is said in words', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const page = pageDocument(t);
  warnings(t);
  // Never answered: alone, and looking, not "reconnecting".
  const quiet = rig();
  t.after(quiet.stop);
  const lost = createNetplay({ config: cfg('a'), WebSocketImpl: quiet.socket({ mute: true }), post: null, game: 'x', connectOpenMaxMs: 2000 });
  await clock.wait(2600);
  assert.equal(lost.link, 'alone');
  assert.deepEqual(page.lines(), [['alone', 'Playing on your own · still looking for the room…']]);
  assert.doesNotMatch(page.lines()[0][1], /reconnect/i);
  lost.close();
  page.made.length = 0;
  // A room still on the old build answers every knock with `room-stale`: alone within the bound, and the line says why.
  const old = rig();
  t.after(old.stop);
  const first = createNetplay({ config: cfg('host'), WebSocketImpl: old.socket(), post: null, game: 'x', version: '1', linkOverlay: false });
  await clock.wait(100);
  old.room.setCurrent('2');
  const newer = createNetplay({ config: cfg('b'), WebSocketImpl: old.socket(), post: null, game: 'x', version: '2', connectOpenMaxMs: 3000 });
  await clock.wait(6000);
  assert.equal(newer.link, 'alone', 'not `connecting` for ever');
  assert.deepEqual(page.lines(), [['alone', 'Playing on your own · this room opens when its players have the new version']]);
  // Its players reload (here: leave); the next knock is let in.
  first.close();
  await clock.wait(5000);
  assert.equal(newer.link, 'online');
  assert.deepEqual(page.lines(), []);
  newer.close();
  page.made.length = 0;
  // Every seat is taken: in the room with no seat, and the helper says so (it said nothing before).
  const small = rig({ maxScreens: 1 });
  t.after(small.stop);
  const S = small.socket();
  const one = createNetplay({ config: cfg('one'), WebSocketImpl: S, post: null, game: 'x', maxPlayers: 2 });
  const two = createNetplay({ config: cfg('two'), WebSocketImpl: S, post: null, game: 'x', maxPlayers: 2, canHost: false });
  await clock.wait(100);
  const posts = [];
  const roles = [];
  const third = createNetplay({ config: cfg('three'), WebSocketImpl: S, post: (m) => posts.push(m), game: 'x', maxPlayers: 2, canHost: false });
  third.on('role', (e) => roles.push([e.role, e.why]));
  await clock.wait(100);
  assert.deepEqual([third.link, third.role, third.seat, third.full], ['online', 'screen', null, true]);
  assert.deepEqual(page.lines(), [['full', 'This room is full · watching until a seat is free']]);
  assert.deepEqual(posts.filter((m) => m.what === 'full').map((m) => m.full), [true], 'the play page hears it from the room, not only from the lobby');
  // Not one more socket fits: refused for good, and said as that. Never "reconnecting".
  const fourth = createNetplay({ config: cfg('four'), WebSocketImpl: S, post: null, game: 'x', maxPlayers: 2, canHost: false });
  await clock.wait(100);
  assert.deepEqual([fourth.link, fourth.closedWhy], ['closed', 'room-full']);
  assert.deepEqual(page.lines().at(-1), ['closed', 'This room is full.']);
  // It is not left on a black screen either: with nobody to wait for, it plays a round of its own, and stays `closed`.
  await clock.wait(4500);
  assert.deepEqual([fourth.link, fourth.isHost, fourth.offline], ['closed', true, true]);
  assert.deepEqual(page.lines().at(-1), ['closed', 'This room is full · playing on your own']);
  fourth.close();
  // A seat frees up: the page that was waiting has it, and its line goes.
  two.close();
  await clock.wait(600);
  assert.deepEqual([third.role, third.seat, third.full], ['replica', 1, false]);
  assert.deepEqual(roles.at(-1), ['replica', 'seated']);
  assert.deepEqual(posts.filter((m) => m.what === 'full').map((m) => m.full), [true, false]);
  assert.deepEqual(page.lines(), []);
  // The line is the game's to use too, while the link is up.
  third.line('Playing on your own until the next round');
  assert.deepEqual(page.lines(), [['seat', 'Playing on your own until the next round']]);
  third.line(null);
  assert.deepEqual(page.lines(), []);
  one.close(); third.close();
});

test('a page that was blocked for seconds does not drop a healthy socket on the word of its own late timer; a dead socket is still dropped', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig({ idleMs: 60_000 });
  t.after(r.stop);
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: r.socket(), post: null, game: 'x' });
  const beat = setInterval(() => host.snapshot({ n: 1 }), 50);
  t.after(() => clearInterval(beat));
  const net = createNetplay({ config: cfg('slow'), WebSocketImpl: r.socket(), post: null, game: 'x', canHost: false });
  const links = [];
  net.on('link', (e) => links.push([e.state, e.why]));
  await clock.wait(2500);
  assert.equal(net.link, 'online');
  // Eight seconds of shaders: nothing ran. The ping timer is the oldest thing waiting, so it runs first, and sees a
  // socket that "said nothing for eight seconds" (staleMs is six). The snapshots are queued right behind it.
  blocked(t, 8000);
  await clock.wait(600);
  assert.deepEqual(links, [['online', 'welcome']], 'no reconnect for a hitch');
  assert.deepEqual([net.link, net.stats().drops, net.reconnects], ['online', 0, 0]);
  // A socket that really went silent is dropped as before (and the bound takes over from there).
  r.sockets.at(-1).onmessage = null;
  await clock.wait(9000);
  assert.deepEqual(links.at(1), ['reconnecting', 'stale']);
  net.close(); host.close();
});

test('a host whose frames hitch keeps the room with a heartbeat, for four seconds; a frozen one is still replaced', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const S = r.socket();
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: S, post: null, game: 'x' });
  await clock.wait(100);
  const other = createNetplay({ config: cfg('other'), WebSocketImpl: S, post: null, game: 'x' });
  const got = [];
  other.on('snapshot', (s) => got.push(s));
  const roles = [];
  other.on('role', (e) => roles.push(e.role));
  await clock.wait(100);
  assert.equal(host.isHost, true);
  host.snapshot({ x: 1 }, 5, true);
  await clock.wait(50);
  assert.equal(got.length, 1);
  // The game's frames stop (a level loading): no snapshot() for three seconds, twice the relay's stall time.
  await clock.wait(3000);
  assert.equal(host.isHost, true, 'the room did not change hands for a pause');
  assert.equal(other.isHost, false);
  const beats = got.filter((s) => s.hb === 1);
  assert.ok(beats.length >= 4, `heartbeats reached the replica (${beats.length})`);
  assert.deepEqual(beats[0].d, { x: 1 }, 'the last state again');
  assert.equal(beats[0].k, 5);
  assert.ok(beats.at(-1).st > beats[0].st, 'with a fresh time stamp each time');
  assert.ok(host.stats().heartbeats >= 4);
  assert.ok(r.room.stats.heartbeats >= 4);
  // The game is back: real snapshots, and the heartbeat is quiet.
  host.snapshot({ x: 2 }, 6, true);
  await clock.wait(60);
  assert.deepEqual(got.at(-1).d, { x: 2 });
  assert.equal(got.at(-1).hb, undefined);
  // It freezes for good: four seconds of heartbeat, then the relay's own stall time, then the room is handed on.
  await clock.wait(4000 + 1500 + 600);
  assert.equal(other.isHost, true, 'a frozen host is still replaced');
  assert.equal(host.isHost, false);
  host.close(); other.close();
});

test('heartbeatMs: 0 is the old behaviour, and a game names its own stall time within bounds', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  assert.deepEqual({ ...STALL }, { ms: 1500, min: 1500, max: 10_000 });
  assert.equal(stallOf(4000), 4000);
  assert.equal(stallOf(200), 1500, 'never under the default: a shorter one swaps hosts on one slow frame');
  assert.equal(stallOf(600_000), 10_000, 'never over ten seconds');
  assert.equal(stallOf('soon'), null);
  assert.equal(stallOf(undefined), null);
  const r = rig();
  t.after(r.stop);
  assert.equal(r.room.stallMs, 1500);
  assert.equal(r.room.setStall(5000), 5000);
  assert.equal(r.room.setStall(null), 1500, 'a game that names none has the default');
  assert.equal(r.room.setStall(5000), 5000);
  assert.equal(r.room.facts().stallMs, 5000);
  const S = r.socket();
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: S, post: null, game: 'x', heartbeatMs: 0 });
  await clock.wait(100);
  const other = createNetplay({ config: cfg('other'), WebSocketImpl: S, post: null, game: 'x' });
  await clock.wait(100);
  host.snapshot({ x: 1 }, 1, true);
  await clock.wait(4000);
  assert.equal(host.isHost, true, 'four seconds without a snapshot is inside this game\'s five');
  await clock.wait(1600);
  assert.equal(other.isHost, true, 'and past it the room is handed on, with no heartbeat to hold it');
  host.close(); other.close();
});

/* ------------------------------------------------------------------ revisions (section 23) */

test('a room runs one build at a time: an older tab is told to reload, a newer one waits for an old room, and the room starts fresh', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  // The Worker's word with every socket: the build its page was served with, and the build that is live.
  const tab = (ver) => r.socket({ conn: { ver } });
  r.room.setCurrent('1');
  const a = createNetplay({ config: cfg('a', { ver: '1' }), WebSocketImpl: tab('1'), post: null, game: 'x', checkpoint: () => ({ made: 'by build 1' }) });
  const b = createNetplay({ config: cfg('b', { ver: '1' }), WebSocketImpl: tab('1'), post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(a.version, '1');
  assert.equal(r.room.gameVer, '1');
  assert.equal(r.room.facts().ver, '1');
  a.snapshot({ old: true }, 1, true);
  a.state('world', { old: true });
  await clock.wait(1200);
  assert.ok(r.room.lastCkpt, 'build 1 left a checkpoint');
  // A deploy: build 2 is live. The tabs already here keep playing together, and nothing is said to them yet.
  r.room.setCurrent('2');
  const stale = { a: [], b: [], late: [] };
  a.on('stale', (e) => stale.a.push(e));
  b.on('stale', (e) => stale.b.push(e));
  // Another tab still on build 1 (open since before the deploy) may join its own build's room, and is told.
  const late = createNetplay({ config: cfg('late', { ver: '1' }), WebSocketImpl: tab('1'), post: null, game: 'x' });
  late.on('stale', (e) => stale.late.push(e));
  await clock.wait(100);
  assert.equal(late.connected, true, 'an old tab keeps its own build\'s room');
  assert.deepEqual(stale.late, [{ ver: '2', mine: '1', final: false }]);
  assert.equal(late.stale, '2');
  // A visitor on the live build comes to this room by its link: kept out (not for good), and the old tabs are told.
  const posts = [];
  const fresh = createNetplay({ config: cfg('fresh', { ver: '2' }), WebSocketImpl: tab('2'), post: (m) => posts.push(m), game: 'x', connectOpenMaxMs: 60_000 });
  await clock.wait(100);
  assert.equal(fresh.connected, false);
  assert.equal(fresh.closedWhy, null, 'it keeps knocking: the room opens to it when the old build has left');
  assert.deepEqual(stale.a, [{ ver: '2', mine: '1', final: false }], 'the players of the old room are told once');
  assert.deepEqual(stale.b, [{ ver: '2', mine: '1', final: false }]);
  await clock.wait(3000);
  assert.equal(stale.a.length, 1, 'once, however often the newcomer knocks');
  assert.ok(r.lines.some((l) => l.ev === 'room-stale' && l.ver === '2' && l.room_ver === '1'));
  // They reload: the last one on build 1 leaves, and the newcomer's next knock is let in to a fresh room.
  a.close(); b.close(); late.close();
  await clock.wait(4500);
  assert.equal(fresh.connected, true);
  assert.equal(fresh.isHost, true);
  assert.equal(r.room.gameVer, '2');
  assert.equal(r.room.lastCkpt, null, 'nothing build 1 wrote is handed to build 2');
  assert.equal(fresh.stateOf('world'), undefined);
  assert.ok(r.lines.some((l) => l.ev === 'build-changed' && l.from === '1' && l.to === '2'));
  // And now a tab still on build 1 knocks at the live build's room: refused for good, with the word to reload.
  const oldPosts = [];
  const old = createNetplay({ config: cfg('old', { ver: '1' }), WebSocketImpl: tab('1'), post: (m) => oldPosts.push(m), game: 'x' });
  const oldStale = [];
  old.on('stale', (e) => oldStale.push(e));
  await clock.wait(100);
  assert.equal(old.closedWhy, 'stale');
  assert.equal(old.link, 'closed');
  assert.deepEqual(oldStale, [{ ver: '2', mine: '1', final: true }]);
  assert.ok(oldPosts.some((m) => m.what === 'closed' && m.why === 'stale'), 'the play page hears the refusal');
  assert.ok(oldPosts.some((m) => m.what === 'stale' && m.final === true && m.ver === '2'));
  await clock.wait(5000);
  assert.equal(r.sockets.filter((s) => s.sent.some((x) => x.includes('"name":"old"'))).length, 1, 'it does not knock again');
  fresh.close(); old.close();
});

test('revisions are ignorable: a helper from before them, a relay nobody told, and a game that names none', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  // A game with no version: nothing is partitioned, nobody is told anything.
  const plain = rig();
  t.after(plain.stop);
  plain.room.setCurrent(null);
  const P = plain.socket({ conn: { ver: null } });
  const p1 = createNetplay({ config: cfg('p1'), WebSocketImpl: P, post: null, game: 'x' });
  const p2 = createNetplay({ config: cfg('p2'), WebSocketImpl: P, post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(p1.connected && p2.connected, true);
  assert.equal(p1.version, null);
  assert.equal(p1.stale, null);
  // A helper from before revisions sends no `ver`; the socket's address still says which build its page was (the
  // Worker's word), so it is held to the same rule. Its hello is exactly revision 8's.
  const old = rig();
  t.after(old.stop);
  old.room.setCurrent('2');
  const hello8 = (name) => JSON.stringify({ t: 'hello', v: 1, rev: 8, name, device: 'desk', want: 'play', canHost: true, game: 'x', max: 4 });
  const frames = [];
  const now2 = old.room.attach({ ver: '2', send: (x) => frames.push(['now', JSON.parse(x)]), close: () => {}, buffered: () => 0 });
  now2.onMessage(hello8('now'));
  assert.equal(frames.at(-1)[1].t, 'welcome');
  const was1 = old.room.attach({ ver: '1', send: (x) => frames.push(['was', JSON.parse(x)]), close: () => {}, buffered: () => 0 });
  was1.onMessage(hello8('was'));
  const refusal = frames.filter((f) => f[0] === 'was').at(-1)[1];
  assert.deepEqual([refusal.t, refusal.code, refusal.ver], ['error', 'stale', '2'], 'an old build is kept out of the live build\'s room whatever its helper knows');
  // A relay with no Worker to tell it which build is live takes the hello's own `ver`: two builds still never share a
  // room, and nobody is called stale (it cannot know who is).
  const bare = rig();
  t.after(bare.stop);
  const B = bare.socket();
  const x1 = createNetplay({ config: cfg('x1'), WebSocketImpl: B, post: null, game: 'x', version: 'a' });
  await clock.wait(100);
  const x2 = createNetplay({ config: cfg('x2'), WebSocketImpl: B, post: null, game: 'x', version: 'b', connectOpenMaxMs: 60_000 });
  const x3 = createNetplay({ config: cfg('x3'), WebSocketImpl: B, post: null, game: 'x', version: 'a' });
  await clock.wait(200);
  assert.equal(x1.connected, true);
  assert.equal(x3.connected, true, 'the same build shares the room');
  assert.equal(x2.connected, false, 'another build does not');
  assert.equal(x2.closedWhy, null);
  assert.equal(x1.stale, null);
  assert.equal([...x1.peers.values()].find((p) => p.name === 'x3').ver, 'a', 'a peer\'s build is in its facts');
  // And a relay from before revision 9 (it ignores `ver` and `feat` in the hello, and says none of the new fields):
  // the revision-9 helper plays on it as it always did.
  const strip = (text) => { const m = JSON.parse(text); delete m.ver; delete m.stale; delete m.stall; for (const p of m.peers ?? []) { delete p.occ; delete p.ver; delete p.feat; } if (m.peer) { delete m.peer.occ; delete m.peer.ver; delete m.peer.feat; } return JSON.stringify(m); };
  const older = rig();
  t.after(older.stop);
  const O = older.socket({ edit: strip });
  const o1 = createNetplay({ config: cfg('o1'), WebSocketImpl: O, post: null, game: 'x', version: '5', features: ['powerups'] });
  await clock.wait(100);
  const o2 = createNetplay({ config: cfg('o2'), WebSocketImpl: O, post: null, game: 'x', version: '5', features: ['powerups'] });
  await clock.wait(100);
  assert.equal(o1.connected && o2.connected, true);
  assert.deepEqual(o1.featuresOf(o2.seat), [], 'an older relay keeps no features: unknown is "none"');
  assert.equal(o1.allHave('powerups'), false);
  for (const n of [p1, p2, x1, x2, x3, o1, o2]) n.close();
});

test('the Lobby matches strangers within the live build, and a room says which build it runs', async () => {
  const { Lobby } = await import('../worker/index.mjs');
  const store = new Map();
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil() {} };
  const lobby = new Lobby(ctx, { DB: { batch: async () => [], prepare: () => ({ bind: () => ({}) }) } });
  await new Promise((r) => setTimeout(r, 0));
  const join = async (ver) => (await (await lobby.fetch(new Request(`https://lobby/join?max=4${ver ? `&ver=${ver}` : ''}`, { method: 'POST' }))).json()).room;
  const report = (room, players, ver) => lobby.fetch(new Request('https://lobby/report?game=x', { method: 'POST', body: JSON.stringify({ room, players, ...(ver !== undefined ? { ver } : {}) }) }));
  const one = await join('1');
  await report(one, 2, '1');
  assert.equal(await join('1'), one, 'the same build fills the room');
  const two = await join('2');
  assert.notEqual(two, one, 'a visitor on the new build is never sent to a room of the old one');
  await report(two, 1, '2');
  assert.equal(await join('2'), two);
  assert.equal(await join('1'), one, 'and a tab of the old build still finds its own');
  // The room changed build (its old players reloaded): the Lobby follows what the room says.
  await report(one, 1, '2');
  const next = await join('2');
  assert.ok([one, two].includes(next));
  // A game that names no version is one pool, as it always was.
  const plain = new Lobby({ ...ctx, storage: { get: async () => undefined, put: async () => {} } }, { DB: { batch: async () => [] } });
  await new Promise((r) => setTimeout(r, 0));
  const pj = async () => (await (await plain.fetch(new Request('https://lobby/join?max=4', { method: 'POST' }))).json()).room;
  assert.equal(await pj(), await pj());
});

test('features: what a build can do is in its peer\'s facts, so the next host knows without asking', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const S = r.socket();
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: S, post: null, game: 'x', features: ['powerups', 'rhythm2'] });
  await clock.wait(100);
  const next = createNetplay({ config: cfg('next'), WebSocketImpl: S, post: null, game: 'x', features: ['powerups', 'rhythm2'] });
  const legacy = createNetplay({ config: cfg('legacy'), WebSocketImpl: S, post: null, game: 'x', canHost: false });
  await clock.wait(100);
  assert.deepEqual(host.featuresOf(next.seat), ['powerups', 'rhythm2']);
  assert.deepEqual(host.featuresOf(legacy.seat), [], 'a build that says nothing has none');
  assert.deepEqual(host.featuresOf(host.seat), ['powerups', 'rhythm2']);
  assert.equal(host.allHave('powerups'), false, 'one legacy player in the room: the feature stays off');
  legacy.close();
  await clock.wait(50);
  assert.equal(host.allHave('powerups'), true);
  assert.equal(host.allHave('never-heard-of'), false);
  // The host goes; its successor was never sent an acknowledgement, and needs none: the relay hands it the peers.
  const late = createNetplay({ config: cfg('late'), WebSocketImpl: S, post: null, game: 'x', features: ['powerups'] });
  await clock.wait(50);
  host.close();
  await clock.wait(100);
  assert.equal(next.isHost, true);
  assert.deepEqual(next.featuresOf(late.seat), ['powerups']);
  assert.equal(next.allHave('powerups'), true);
  assert.equal(next.allHave('rhythm2'), false, 'the late arrival\'s build is older');
  // A reconnect is a new socket id and the same facts: nothing is keyed by connection.
  r.sockets.find((s) => s.sent.some((x) => x.includes('"name":"late"'))).cut();
  await clock.wait(600);
  assert.deepEqual(next.featuresOf(late.seat), ['powerups']);
  next.close(); late.close();
});

/* ------------------------------------------------------------------ whose seat it is (section 25) */

test('peer.occ: the same player keeps the number across a reconnect; a new holder of the seat number gets a new one', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig({ holdMs: 2000 });
  t.after(r.stop);
  const S = r.socket();
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: S, post: null, game: 'x' });
  await clock.wait(100);
  let token = null;
  const one = createNetplay({ config: cfg('one'), WebSocketImpl: S, post: (m) => { if (m.what === 'token') token = m.token; }, game: 'x' });
  await clock.wait(100);
  const occ = () => [...host.peers.values()].find((p) => p.seat === 1)?.occ;
  const first = occ();
  assert.equal(typeof first, 'number');
  assert.equal(one.resumed, false, 'a new seat is not a resumed one');
  // A reload: the token brings the seat back, and it is the same stay.
  one.close();
  await clock.wait(100);
  const again = createNetplay({ config: cfg('one', { token }), WebSocketImpl: S, post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(again.seat, 1);
  assert.equal(again.resumed, true);
  assert.equal(occ(), first);
  // They leave for good; the seat is reaped; a stranger gets the same number, and a different stay.
  again.close();
  await clock.wait(2600);
  const stranger = createNetplay({ config: cfg('stranger'), WebSocketImpl: S, post: null, game: 'x' });
  await clock.wait(100);
  assert.equal(stranger.seat, 1, 'the same seat number');
  assert.notEqual(occ(), first, 'somebody else\'s stay');
  // A deploy keeps the numbers (a checkpoint may still name them).
  const saved = r.room.saved();
  const back = new NetRoom({ code: 'r', maxPlayers: 4 });
  assert.equal(back.restore(saved), true);
  assert.equal(back.seats.get(1).occ, occ());
  assert.ok(back.occSeq >= occ());
  host.close(); stranger.close();
});

test('Roster: a returning player keeps their body, a new holder of the seat is admitted like any arrival, and the game chooses the body', async () => {
  const { Roster } = await netplayKit();
  const alive = new Map([[0, true], [1, false], [2, true], [3, true]]);
  const asked = [];
  const roster = new Roster({ min: 4, max: 6, admit: (cands, who) => { asked.push([cands.map((c) => c.slot), who.seat]); return cands.find((c) => alive.get(c.slot))?.slot; } });
  // The host takes the first living body; slot 1 is dead, so the next arrival skips it.
  assert.equal(roster.claim(0, 'Host', null, 11).slot.slot, 0);
  const c = roster.claim(1, 'Ann', null, 12);
  assert.deepEqual([c.slot.slot, c.yielded, c.added, c.back], [2, true, false, false], 'not the lowest bot: the lowest LIVING one');
  assert.deepEqual(asked.at(-1), [[1, 2, 3], 1], 'asked with the bots it may take');
  assert.deepEqual(roster.occupants(), [[0, 11], [1, 12]]);
  // Ann's body dies; she reloads. She is the same stay in her seat: her own body back, dead or not, and nobody is asked.
  alive.set(2, false);
  roster.release(1);
  const n = asked.length;
  const back = roster.claim(1, 'Ann', null, 12);
  assert.deepEqual([back.slot.slot, back.back], [2, true]);
  assert.equal(asked.length, n, 'a returning player is not re-admitted');
  // A claim for a seat whose slot never left is the same slot.
  assert.deepEqual([roster.claim(1, 'Ann', null, 12).slot.slot, roster.claim(1, 'Ann', null, 12).yielded], [2, false]);
  // Ann leaves for good and a stranger gets seat 1: not her dead body, a living one.
  roster.release(1);
  const s = roster.claim(1, 'Bo', null, 13);
  assert.deepEqual([s.slot.slot, s.back], [3, false]);
  // The host never heard Ann leave (it was cut off), and seat 1 is somebody else's stay now: reconcile says so.
  const r2 = Roster.from(roster.toJSON(), { min: 4, max: 6 }, roster.occupants());
  assert.equal(r2.changedHands(1, 13), false);
  assert.equal(r2.changedHands(1, 14), true);
  assert.equal(r2.changedHands(1, undefined), false, 'a relay that does not say: the same player, as before');
  const rec = r2.reconcile([{ seat: 0, name: 'Host', occ: 11 }, { seat: 1, name: 'Cy', occ: 14 }, { seat: 2, name: 'Di', occ: 15 }]);
  assert.deepEqual(rec.claimed.map((x) => x.name).sort(), ['Cy', 'Di'], 'the new holder of seat 1 and the newcomer are both claims');
  assert.deepEqual(rec.back, []);
  assert.equal(r2.bySeat(0).name, 'Host');
  // "None of these will do": a new body while the room has space, the default one when it has none.
  const picky = new Roster({ min: 2, max: 3, admit: () => null });
  const p1 = picky.claim(0, 'A');
  assert.deepEqual([p1.added, picky.slots.length], [true, 3]);
  const p2 = picky.claim(1, 'B');
  assert.deepEqual([p2.added, p2.yielded], [false, true], 'a seated person always gets a body');
  // A seat kept for AI is never offered to a person, and an agent takes a kept one first (the reservation).
  const policy = () => ({ kind: 'hybrid', aiSeats: 1, guides: 0, bots: 'fill' });
  const offered = [];
  const hybrid = new Roster({ min: 3, max: 4, policy, admit: (cands, who) => { offered.push([who.agent, cands.map((x) => Boolean(x.agent))]); return undefined; } });
  hybrid.claim(0, 'Person');
  assert.deepEqual(offered.at(-1), [false, [false, false]], 'only plain bots for a person');
  hybrid.claim(3, 'Helper · AI', { role: 'party', hands: 'host' });
  assert.deepEqual(offered.at(-1), [true, [true]], 'the kept seat for an agent');
});

/* ------------------------------------------------------------------ createRoom (sections 25 and 26) */

test('a room revived from its checkpoint: the newcomer takes a body over (onTakeover, adopt), a returning player keeps theirs', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  for (const older of [false, true]) {
    // `older`: a relay from before revision 9 (no `occ`): the newcomer still knows its own seat was not resumed.
    const strip = (text) => { const m = JSON.parse(text); for (const p of m.peers ?? []) delete p.occ; if (m.peer) delete m.peer.occ; return JSON.stringify(m); };
    // Seats are let go after 2 s here, so the newcomer is handed the SAME seat number the player who left had.
    const r = rig({ holdMs: 2000, forgetMs: 60_000 });
    const S = r.socket(older ? { edit: strip } : {});
    let token = null;
    const first = createRoom(bodyGame({ netplay: { config: cfg('first'), WebSocketImpl: S, post: (m) => { if (m.what === 'token') token = m.token; } } }));
    const stopA = loop(first);
    await clock.wait(200);
    assert.equal(first.hosting, true);
    const mine = first.mine();
    mine.score = 7; mine.x = 555;
    await clock.wait(1300); // a checkpoint
    stopA();
    first.net.close();
    await clock.wait(3000); // the room is empty, its checkpoint kept; the seat is free again
    assert.ok(r.room.lastCkpt, 'the relay kept the round');
    // A new visitor, before the room is forgotten.
    const took = [];
    const adopted = [];
    const fresh = createRoom(bodyGame({
      netplay: { config: cfg('fresh'), WebSocketImpl: S, post: null },
      onTakeover: (b, info) => { took.push([b.slot, b.seat, b.score, info]); b.score = 0; },
      adopt: (b) => adopted.push([b.slot, b.x]),
      local: () => ({ slot: -1, seat: null, name: '', bot: false, score: 0, x: -1, y: -1, alive: 1 }),
    }));
    const stopB = loop(fresh);
    await clock.wait(300);
    assert.equal(fresh.hosting, true);
    assert.equal(fresh.net.seat, 0, 'the same seat number as the player who left');
    assert.equal(fresh.net.resumed, false);
    assert.equal(fresh.round.n, 1, 'the same round goes on');
    assert.equal(took.length, 1, `the restored claim is a takeover (${older ? 'older relay' : 'revision 9'})`);
    assert.deepEqual(took[0].slice(0, 3), [mine.slot, 0, 7], 'the old body, with the score its last player left');
    assert.deepEqual(took[0][3], { why: 'restore', own: true, back: false });
    assert.equal(fresh.mine().score, 0, 'the newcomer does not inherit a stranger\'s score');
    assert.deepEqual(adopted.at(-1), [mine.slot, 555], 'and stands where its body stands');
    assert.equal(fresh.mine().x, 555, 'not at a place it has never been');
    assert.equal(fresh.bodies.size, 3);
    assert.equal([...fresh.bodies.values()].filter((b) => !b.bot).length, 1);
    stopB();
    fresh.net.close();
    r.stop();
    // The same room, and this time the player who left comes back (a reload keeps the seat's token): nothing is
    // taken over, the score is theirs, and their game is told where their body is.
    const r2 = rig({ forgetMs: 60_000 });
    const S2 = r2.socket(older ? { edit: strip } : {});
    let token2 = null;
    const was = createRoom(bodyGame({ netplay: { config: cfg('was'), WebSocketImpl: S2, post: (m) => { if (m.what === 'token') token2 = m.token; } } }));
    const stopC = loop(was);
    await clock.wait(200);
    was.mine().score = 9; was.mine().x = 321;
    await clock.wait(1300);
    stopC();
    was.net.close();
    await clock.wait(3000);
    const took2 = [];
    const adopted2 = [];
    const again = createRoom(bodyGame({ netplay: { config: cfg('was', { token: token2 }), WebSocketImpl: S2, post: null }, onTakeover: (b, i) => took2.push(i), adopt: (b) => adopted2.push(b.x), local: () => ({ slot: -1, seat: null, name: '', bot: false, score: 0, x: -1, y: -1, alive: 1 }) }));
    const stopD = loop(again);
    await clock.wait(300);
    assert.equal(again.hosting, true);
    assert.equal(again.net.resumed, true);
    assert.deepEqual(took2, [], 'a returning player takes nothing over');
    assert.equal(again.mine().score, 9);
    assert.equal(again.mine().x, 321);
    assert.deepEqual(adopted2.at(-1), 321);
    stopD();
    again.net.close();
    r2.stop();
    assert.ok(token && token2);
  }
});

test('admit: the game chooses the body an arrival takes, for a fresh join and for a restored room alike; a returner is not re-admitted', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig({ forgetMs: 60_000 });
  t.after(r.stop);
  const S = r.socket();
  const asked = [];
  // An elimination round: a newcomer takes the lowest LIVING bot, never a dead one.
  const admit = (cands, who) => { asked.push([cands.map((b) => [b.slot, b.alive]), who.name]); return cands.find((b) => b.alive) ?? undefined; };
  const host = createRoom(bodyGame({ minBodies: 4, admit, saveWorld: () => ({}), netplay: { config: cfg('host'), WebSocketImpl: S, post: null } }));
  const stop = loop(host);
  await clock.wait(200);
  host.bodies.get(1).alive = 0; // the lowest bot is out of the round
  const resets = [];
  let token = null;
  const ann = createRoom(bodyGame({ minBodies: 4, admit, adopt: (b) => resets.push(b.slot), netplay: { config: cfg('ann'), WebSocketImpl: S, canHost: false, post: (m) => { if (m.what === 'token') token = m.token; } } }));
  await clock.wait(300);
  const annBody = [...host.bodies.values()].find((b) => b.seat === ann.net.seat);
  assert.equal(annBody.slot, 2, 'the living bot, not the dead one in the lower slot');
  assert.deepEqual(asked.at(-1), [[[1, 0], [2, 1], [3, 1]], 'ann']);
  assert.deepEqual(resets, [2], 'the joiner is reset onto its body, as always');
  assert.deepEqual(host.net.slots.find((s) => s.seat === ann.net.seat).slot, 2, 'and the roster says the same');
  // Ann is eliminated, and reloads: the same stay in her seat, so her own (dead) body, and the game is not asked.
  annBody.alive = 0;
  const before = asked.length;
  ann.net.close();
  await clock.wait(200);
  const ann2 = createRoom(bodyGame({ minBodies: 4, admit, netplay: { config: cfg('ann', { token }), WebSocketImpl: S, canHost: false, post: null } }));
  await clock.wait(300);
  assert.equal([...host.bodies.values()].find((b) => b.seat === ann2.net.seat).slot, 2);
  assert.equal(asked.length, before, 'reloading is not a way back into the round');
  // The checkpoint and the roster agree with the claim.
  await clock.wait(1200);
  const ck = r.room.lastCkpt.d;
  assert.equal(ck.roster.find((s) => s.seat === ann2.net.seat).slot, 2);
  assert.ok(ck.occ.some(([seat]) => seat === ann2.net.seat), 'whose stay each body is rides in the checkpoint');
  // Everyone leaves; a visitor revives the room: the same choice is made for the restored claim.
  stop();
  host.net.close(); ann2.net.close();
  await clock.wait(500);
  const took = [];
  const late = createRoom(bodyGame({ minBodies: 4, admit, onTakeover: (b, i) => took.push([b.slot, i.why]), netplay: { config: cfg('late'), WebSocketImpl: S, post: null } }));
  const stop2 = loop(late);
  await clock.wait(300);
  assert.equal(late.hosting, true);
  assert.equal(late.round.n, 1);
  assert.deepEqual(took, [[late.mine().slot, 'restore']]);
  assert.equal(late.mine().alive, 1, 'a living body for the newcomer of a restored round too');
  assert.equal(asked.at(-1)[1], 'late');
  stop2();
  late.net.close();
});

test('a host that reconnects as host learns who came and went meanwhile: no player without a body, no frozen body, no score lost', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const S = r.socket();
  const took = [];
  const host = createRoom(bodyGame({ minBodies: 4, onTakeover: (b, i) => { took.push([b.seat, i.why]); b.score = 0; }, netplay: { config: cfg('host'), WebSocketImpl: S, post: null } }));
  const stop = loop(host);
  t.after(stop);
  await clock.wait(200);
  // Phones that never host (a game says so with canHost: false), so the room has no other host to hand to.
  const phone = (name) => createRoom(bodyGame({ minBodies: 4, netplay: { config: cfg(name, { device: 'phone' }), WebSocketImpl: S, canHost: false, post: null } }));
  const stays = phone('stays');
  const leaves = phone('leaves');
  await clock.wait(300);
  const bodyOf = (seat) => [...host.bodies.values()].find((b) => !b.bot && b.seat === seat) ?? null;
  bodyOf(stays.net.seat).score = 5;
  const goneSeat = leaves.net.seat;
  assert.ok(bodyOf(goneSeat));
  const events = [];
  host.net.on('join', (p) => events.push(['join', p.name]));
  host.net.on('leave', (p) => events.push(['leave', p.seat, p.why]));
  const roles = [];
  host.net.on('role', (e) => roles.push(e.why));
  // The host's socket goes. While it is away: one player leaves for good, and a new one arrives.
  r.sockets.find((s) => s.sent.some((x) => x.includes('"name":"host"'))).cut();
  assert.equal(host.net.link, 'reconnecting');
  leaves.net.close();
  const arrives = phone('arrives');
  await clock.wait(900);
  // It is the host again, and nothing told it so (its role did not change): the continuing-host case.
  assert.equal(host.net.connected, true);
  assert.equal(host.hosting, true);
  assert.deepEqual(roles, [], 'no role event: for this host nothing changed');
  assert.deepEqual(events, [['leave', goneSeat, 'gone'], ['join', 'arrives']], 'what it missed is said as the events it would have been');
  assert.ok(arrives.net.seat !== null);
  const body = bodyOf(arrives.net.seat);
  assert.ok(body, 'the player who arrived while the host was away has a body');
  assert.deepEqual(took, [[stays.net.seat, 'join'], [goneSeat, 'join'], [arrives.net.seat, 'join']]);
  assert.equal(bodyOf(goneSeat) === null || goneSeat === arrives.net.seat, true, 'the body of the player who left is a bot\'s again (or the newcomer\'s)');
  assert.equal([...host.bodies.values()].filter((b) => !b.bot).length, 3, 'three people, three bodies');
  assert.equal(bodyOf(stays.net.seat).score, 5, 'the player who was here all along keeps their score');
  // The round's results have everybody in them.
  const names = host.results().filter((x) => !x.bot).map((x) => x.name).sort();
  assert.deepEqual(names, ['arrives', 'host', 'stays']);
  host.net.close(); stays.net.close(); arrives.net.close();
});

test('equal scores: the documented order by default, shared places when the game asks', async (t) => {
  const { createRoom, placesOf } = await netplayKit();
  assert.deepEqual(placesOf([9, 7, 7, 3]), [1, 2, 3, 4]);
  assert.deepEqual(placesOf([9, 7, 7, 3], 'shared'), [1, 2, 2, 4]);
  assert.deepEqual(placesOf([9, 7, 7, 3], 'dense'), [1, 2, 2, 3]);
  assert.deepEqual(placesOf([5, 5, 5], 'shared'), [1, 1, 1]);
  assert.deepEqual(placesOf([]), []);
  const clock = virtualTime(t);
  for (const [ties, places] of [[undefined, [1, 2, 3, 4]], ['shared', [1, 1, 3, 4]], ['dense', [1, 1, 2, 3]]]) {
    const room = createRoom(bodyGame({ minBodies: 4, ...(ties ? { ties } : {}), netplay: { config: null } }));
    await clock.wait(10);
    const scores = { 0: 61, 1: 61, 2: 40, 3: 12 };
    for (const b of room.bodies.values()) b.score = scores[b.slot];
    const res = room.results();
    assert.deepEqual(res.map((x) => x.place), places, `ties: ${ties ?? 'order'}`);
    assert.deepEqual(res.map((x) => x.slot), [0, 1, 2, 3], 'the order never changes: score, people before bots, the lower slot');
    assert.equal(res[0].bot, false, 'the person comes before the bot on the same score');
    room.net.close();
  }
});

/* ------------------------------------------------------------------ the arrival (section 21) */

test('a late net.playable() after an automatic arrival warns once, and the arrival\'s facts are readable', async (t) => {
  const { createNetplay } = await netplayKit();
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const S = r.socket();
  const warned = [];
  t.mock.method(console, 'warn', (...a) => warned.push(a.join(' ')));
  const posts = { auto: [], game: [], early: [] };
  // The mistake: the game calls net.playable() when its character has loaded, but never said arrival: 'game'.
  const auto = createNetplay({ config: cfg('auto'), WebSocketImpl: S, post: (m) => posts.auto.push(m), game: 'x' });
  await clock.wait(200);
  assert.deepEqual(auto.arrivalInfo.by, 'auto', 'the helper already gave the game the screen');
  await clock.wait(1500);
  auto.playable();
  auto.playable();
  const info = auto.arrivalInfo;
  assert.equal(info.mode, 'auto');
  assert.equal(info.by, 'auto');
  assert.ok(info.lateMs >= 1400 && info.lateMs <= 1800, `late by about 1.5 s (${info.lateMs})`);
  assert.equal(info.explicitMs - info.playableMs, info.lateMs);
  assert.equal(warned.filter((w) => /net\.playable\(\) came \d+ ms after the arrival card had already lifted/.test(w)).length, 1, 'said once, in the console');
  assert.match(warned.find((w) => /net\.playable/.test(w)), /arrival: 'game'/);
  const ready = posts.auto.filter((m) => m.what === 'ready');
  assert.equal(ready.length, 1);
  assert.deepEqual([ready[0].mode, ready[0].by, ready[0].lateMs], ['auto', 'game', info.lateMs], 'the play page hears when the game itself was ready');
  assert.deepEqual(globalThis.__homieNet.arrival, info, 'and a probe inside the frame reads the same');
  // Done right: arrival 'game'. No warning, and the same facts.
  const own = createNetplay({ config: cfg('own'), WebSocketImpl: S, post: (m) => posts.game.push(m), game: 'x', arrival: 'game', canHost: false });
  await clock.wait(900);
  own.playable();
  assert.deepEqual([own.arrivalInfo.mode, own.arrivalInfo.by, own.arrivalInfo.lateMs], ['game', 'game', null]);
  assert.equal(own.arrivalInfo.explicitMs, own.arrivalInfo.playableMs);
  assert.deepEqual(posts.game.filter((m) => m.what === 'ready').map((m) => [m.mode, m.lateMs]), [['game', undefined]]);
  // An automatic game that says so BEFORE the helper would have is fine too.
  const early = createNetplay({ config: cfg('early'), WebSocketImpl: r.socket({ mute: true }), post: (m) => posts.early.push(m), game: 'x' });
  early.playable();
  assert.deepEqual([early.arrivalInfo.by, early.arrivalInfo.lateMs], ['game', null]);
  assert.equal(warned.filter((w) => /net\.playable/.test(w)).length, 1);
  auto.close(); own.close(); early.close();
});

/* ------------------------------------------------------------------ seat or solo (section 28) */

test('a seat with no body is not for ever: the host seats whoever is waiting when a body frees up and at every round start, and the page says where it stands', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  const page = pageDocument(t);
  warnings(t);
  // The room seats four and the game has two bodies: the third person is seated by the relay and finds no body.
  const r = rig();
  t.after(r.stop);
  const S = r.socket();
  const two = (who, extra = {}) => createRoom(bodyGame({ maxPlayers: 2, minBodies: 2, seatWaitMs: 1000, ...extra, netplay: { config: cfg(who), WebSocketImpl: S, post: null, maxPlayers: 4, canHost: who === 'host', linkOverlay: who === 'late' } }));
  const host = two('host');
  const stop = loop(host);
  t.after(stop);
  await clock.wait(200);
  const kay = two('kay');
  await clock.wait(200);
  const adopted = [];
  const said = [];
  const late = two('late', { adopt: (b) => adopted.push(b.slot), onStanding: (st) => said.push([st.state, st.why, st.line]) });
  await clock.wait(300);
  assert.deepEqual(stands(late), { link: 'online', standing: 'joining', why: 'no-body', body: false }, 'online, seated by the relay, and no body: what used to be said nowhere');
  assert.equal(late.net.seat, 2);
  assert.deepEqual(page.lines(), [], 'a join that is merely on its way is never drawn');
  await clock.wait(600);
  assert.deepEqual(page.lines(), [['seat', 'Joining the round…']]);
  await clock.wait(500);
  // BOUNDED: after seatWaitMs the page is told where it stands (the default keeps what a game did: it waits).
  assert.deepEqual(stands(late), { link: 'online', standing: 'waiting', why: 'no-body', body: false });
  assert.deepEqual(page.lines(), [['seat', 'Waiting for a place in this round…']]);
  assert.equal(late.hosting, false);
  // A body frees up: the page that was waiting has it at once, not never.
  kay.net.close();
  await clock.wait(400);
  assert.deepEqual(stands(late), { link: 'online', standing: 'playing', why: 'seated', body: true });
  assert.equal([...host.bodies.values()].find((b) => b.seat === 2)?.bot, false);
  assert.equal(adopted.length, 1, 'and is reset onto it, like any joiner');
  assert.deepEqual(page.lines(), []);
  assert.deepEqual(said, [['joining', 'no-body', null], ['joining', 'no-body', 'Joining the round…'], ['waiting', 'no-body', 'Waiting for a place in this round…'], ['playing', 'seated', null]], 'onStanding: the same, for a game that draws its own words');
  late.net.close(); host.net.close(); stop();
  page.made.length = 0;
  // A server that kept two seats for AI stops keeping them mid-round. The relay seats people in them at once; the
  // game's roster lets those seats go at the round start, so a person who arrives in between has no body until then.
  const r2 = rig();
  t.after(r2.stop);
  r2.room.setPolicy({ ...r2.room.policy, kind: 'hybrid', aiSeats: 2, at: 1 }, { force: true });
  const short = { minBodies: 2, roundSeconds: 10, breakSeconds: 3, seatWaitMs: 1000 };
  const host2 = createRoom(bodyGame({ ...short, netplay: { config: cfg('host'), WebSocketImpl: r2.socket(), post: null, linkOverlay: false } }));
  const stop2 = loop(host2);
  t.after(stop2);
  await clock.wait(300);
  const kay2 = createRoom(bodyGame({ ...short, netplay: { config: cfg('kay'), WebSocketImpl: r2.socket(), post: null, canHost: false, linkOverlay: false } }));
  await clock.wait(300);
  assert.deepEqual([[...host2.bodies.values()].filter((b) => !b.bot).length, [...host2.bodies.values()].filter((b) => b.agent).length, host2.bodies.size], [2, 2, 4], 'two people, two seats kept for AI: every body is somebody\'s');
  r2.room.setPolicy({ ...r2.room.policy, kind: 'open', aiSeats: 0, at: 2 }, { force: true });
  await clock.wait(400);
  const adopted2 = [];
  const late2 = createRoom(bodyGame({ ...short, adopt: (b) => adopted2.push(b.slot), netplay: { config: cfg('late'), WebSocketImpl: r2.socket(), post: null, canHost: false } }));
  await clock.wait(5000);
  assert.equal(late2.net.seat, 2, 'the relay seated it');
  assert.deepEqual(stands(late2), { link: 'online', standing: 'waiting', why: 'no-body', body: false });
  await clock.wait(8500);
  assert.equal(host2.round.n, 2);
  assert.deepEqual(stands(late2), { link: 'online', standing: 'playing', why: 'seated', body: true }, 'the next round has a body for everybody who is seated');
  assert.equal(adopted2.length, 1);
  assert.deepEqual(page.lines(), []);
  late2.net.close(); kay2.net.close(); host2.net.close();
});

test('fallback: solo plays a private round with bots and moves into the room when it has a body; spectate watches; a full room says so', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  const page = pageDocument(t);
  warnings(t);
  const r = rig();
  t.after(r.stop);
  // The room of the test above: a server stopped keeping two seats for AI, and until the round start the game has no
  // body for the two people the relay seated in them.
  r.room.setPolicy({ ...r.room.policy, kind: 'hybrid', aiSeats: 2, at: 1 }, { force: true });
  const short = { minBodies: 2, roundSeconds: 10, breakSeconds: 3, seatWaitMs: 1000 };
  const heard = [];
  const host = createRoom(bodyGame({ ...short, netplay: { config: cfg('host'), WebSocketImpl: r.socket(), post: null, linkOverlay: false } }));
  host.on('event', (e) => heard.push(e.k));
  const stop = loop(host);
  t.after(stop);
  await clock.wait(300);
  const kay0 = createRoom(bodyGame({ ...short, netplay: { config: cfg('kay'), WebSocketImpl: r.socket(), post: null, canHost: false, linkOverlay: false } }));
  await clock.wait(300);
  r.room.setPolicy({ ...r.room.policy, kind: 'open', aiSeats: 0, at: 2 }, { force: true });
  await clock.wait(400);
  host.mine().x = 777;
  const adopted = [];
  const starts = [];
  const late = createRoom(bodyGame({ ...short, fallback: 'solo', adopt: (b) => adopted.push(b.x), onRoundStart: (n) => starts.push(n), netplay: { config: cfg('late'), WebSocketImpl: r.socket(), post: null, canHost: false } }));
  const eyes = createRoom(bodyGame({ ...short, fallback: 'spectate', netplay: { config: cfg('eyes'), WebSocketImpl: r.socket(), post: null, canHost: false, linkOverlay: false } }));
  const stopLate = loop(late);
  t.after(stopLate);
  await clock.wait(900);
  assert.equal(late.solo, false, 'not before seatWaitMs');
  await clock.wait(600);
  // SOLO: a round of its own, here, with bots; in the room it is still a seated replica.
  assert.deepEqual(stands(late), { link: 'online', standing: 'solo', why: 'no-body', body: true });
  assert.deepEqual([late.solo, late.hosting, late.net.role, late.net.isHost], [true, true, 'replica', false]);
  assert.deepEqual(page.lines(), [['seat', 'Playing on your own until the next round']]);
  assert.deepEqual([late.mine().seat, late.mine().bot, late.mySeat(), late.viewSeat()], [late.net.seat, false, late.net.seat, late.net.seat]);
  assert.equal(late.viewBody(), late.mine());
  assert.ok(late.view().filter((b) => b.bot).length >= 1, 'its own bots');
  assert.deepEqual(starts, [1], 'the room\'s round number, a clock of its own');
  assert.deepEqual([late.round.n, late.round.phase], [1, 'live']);
  assert.ok(late.round.startedAt > host.round.startedAt);
  const roundWas = JSON.stringify(r.room.lastRound);
  late.mine().score = 3;
  late.send('boom');
  await clock.wait(500);
  assert.equal(JSON.stringify(r.room.lastRound), roundWas, 'nothing of a private round is told to the room');
  assert.deepEqual(heard, []);
  assert.equal(late.net.roundInfo.startedAt, host.round.startedAt, 'and the room\'s own round is still what the helper knows');
  // SPECTATE: no body, the camera follows the room, and the line says until when.
  assert.deepEqual(stands(eyes), { link: 'online', standing: 'watching', why: 'no-body', body: false });
  assert.equal(eyes.standing.line, 'Watching until the next round');
  assert.equal(eyes.hosting, false);
  assert.equal(eyes.viewBody()?.x, 777, 'a person in the room, as everyone draws them');
  // The room's next round start seats both: the private round ends and the page stands where the room put it.
  await clock.wait(11_500);
  assert.equal(host.round.n, 2);
  assert.deepEqual(stands(late), { link: 'online', standing: 'playing', why: 'seated', body: true });
  assert.deepEqual([late.solo, late.hosting, late.round.n], [false, false, 2]);
  const mine = [...host.bodies.values()].find((b) => b.seat === late.net.seat);
  assert.equal(adopted.at(-1), mine.x, 'adopted onto the room\'s body, not left where the private round had it');
  assert.equal(mine.score, 0, 'a private round\'s score stays private');
  assert.deepEqual(page.lines(), []);
  assert.deepEqual(stands(eyes), { link: 'online', standing: 'playing', why: 'seated', body: true });
  assert.equal(eyes.viewBody().seat, eyes.net.seat);
  late.net.close(); eyes.net.close(); kay0.net.close(); host.net.close(); stop(); stopLate();
  page.made.length = 0;
  // A FULL room (every seat a person's): the relay lets the page in with no seat. Solo until a seat is free.
  const r2 = rig();
  t.after(r2.stop);
  const S2 = r2.socket();
  const pair = (who, extra = {}) => createRoom(bodyGame({ maxPlayers: 2, minBodies: 2, seatWaitMs: 1000, ...extra, netplay: { config: cfg(who), WebSocketImpl: S2, post: null, canHost: who === 'host', linkOverlay: who === 'third' || who === 'fourth' } }));
  const host2 = pair('host');
  const stop2 = loop(host2);
  t.after(stop2);
  await clock.wait(200);
  const kay = pair('kay');
  await clock.wait(200);
  const third = pair('third', { fallback: 'solo' });
  const stop3 = loop(third);
  t.after(stop3);
  await clock.wait(600);
  assert.deepEqual([third.net.full, third.net.seat, third.standing.state], [true, null, 'joining']);
  assert.deepEqual(page.lines(), [['full', 'This room is full · watching until a seat is free']]);
  await clock.wait(900);
  assert.deepEqual(stands(third), { link: 'online', standing: 'solo', why: 'full', body: true });
  assert.deepEqual(page.lines(), [['seat', 'This room is full · playing on your own until a seat is free']]);
  assert.equal(third.mySeat(), 0, 'seat 0 of a round of its own, as offline');
  kay.net.close();
  await clock.wait(900);
  assert.deepEqual(stands(third), { link: 'online', standing: 'playing', why: 'seated', body: true });
  assert.deepEqual([third.solo, third.net.seat, third.net.full], [false, 1, false]);
  assert.deepEqual(page.lines(), []);
  // The default in a full room: it waits, and the helper's own line says why.
  const fourth = pair('fourth');
  await clock.wait(1800);
  assert.deepEqual(stands(fourth), { link: 'online', standing: 'waiting', why: 'full', body: false });
  assert.deepEqual(page.lines(), [['full', 'This room is full · watching until a seat is free']]);
  third.net.close(); fourth.net.close(); host2.net.close();
});

test('a slow page that joins mid-round always ends somewhere a player can act: each way it can arrive, on the virtual clock', async (t) => {
  const { createRoom } = await netplayKit();
  const clock = virtualTime(t);
  const page = pageDocument(t);
  warnings(t);
  const open = async (hostExtra = {}, relay = {}) => {
    const r = rig(relay);
    t.after(r.stop);
    const host = createRoom(bodyGame({ ...hostExtra, netplay: { config: cfg('host'), WebSocketImpl: r.socket(), post: null, linkOverlay: false, ...(hostExtra.netplay ?? {}) } }));
    const stop = loop(host);
    t.after(stop);
    await clock.wait(600);
    return { r, host, stop };
  };
  const joiner = (r, extra = {}, np = {}) => {
    const adopted = [];
    const room = createRoom(bodyGame({ adopt: (b) => adopted.push(b.slot), ...extra, netplay: { config: cfg('slow'), WebSocketImpl: r.socket(), post: null, canHost: false, ...np } }));
    const stop = loop(room);
    t.after(stop);
    return { room, adopted, stop };
  };
  // 1. The welcome arrives after the page gave up waiting (connectOpenMaxMs): it was playing alone, and moves in.
  {
    const { r, host } = await open();
    let dead = true;
    const Live = r.socket(); const Dead = r.socket({ mute: true });
    const j = joiner(r, {}, { WebSocketImpl: function (u) { return dead ? new Dead(u) : new Live(u); }, connectOpenMaxMs: 2000, staleMs: 2500 });
    await clock.wait(2600);
    assert.deepEqual(stands(j.room), { link: 'alone', standing: 'solo', why: 'alone', body: true });
    assert.deepEqual(page.lines(), [['alone', 'Playing on your own · still looking for the room…']]);
    dead = false;
    await clock.wait(6000);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    assert.equal(j.adopted.length, 2, 'its own round\'s body, then the room\'s');
    assert.deepEqual(page.lines(), [], 'no line is left up once the link is');
    j.room.net.close(); host.net.close();
  }
  // 2. connectClock: 'game' and a late net.start(): a welcome that came first is used at once; the wait only starts at start().
  {
    const { r, host } = await open();
    const j = joiner(r, {}, { connectClock: 'game', connectOpenMaxMs: 2000 });
    await clock.wait(300);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true }, 'in the room before the game said it had booted');
    await clock.wait(9000);
    j.room.net.start();
    await clock.wait(3000);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    j.room.net.close();
    const k = joiner(r, {}, { WebSocketImpl: r.socket({ mute: true }), connectClock: 'game', connectOpenMaxMs: 2000 });
    await clock.wait(9000);
    assert.deepEqual(stands(k.room), { link: 'connecting', standing: 'joining', why: 'connecting', body: false }, 'still booting: not given up on');
    k.room.net.start();
    await clock.wait(2600);
    assert.deepEqual(stands(k.room), { link: 'alone', standing: 'solo', why: 'alone', body: true }, 'bounded from start()');
    k.room.net.close(); host.net.close();
    page.made.length = 0;
  }
  // 3. A join during the round break: a body at once, and the next round with everybody else.
  {
    const { r, host } = await open({ roundSeconds: 10, breakSeconds: 3 });
    await clock.wait(10_000);
    assert.equal(host.round.phase, 'over');
    const j = joiner(r, { roundSeconds: 10, breakSeconds: 3 });
    await clock.wait(500);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    await clock.wait(3500);
    assert.deepEqual([host.round.n, host.round.phase], [2, 'live']);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    assert.equal(j.adopted.length, 2);
    j.room.net.close(); host.net.close();
  }
  // 4. The host's frames have stopped (it heartbeats): the join is still answered, with a body.
  {
    const { r, host, stop } = await open();
    const other = createRoom(bodyGame({ netplay: { config: cfg('kay'), WebSocketImpl: r.socket(), post: null, canHost: false, linkOverlay: false } }));
    await clock.wait(500);
    stop();
    await clock.wait(700);
    const j = joiner(r);
    await clock.wait(1000);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    assert.ok(host.net.stats().heartbeats > 0);
    await clock.wait(6000);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    j.room.net.close(); other.net.close(); host.net.close();
  }
  // 5. The page is blocked for six seconds the moment it is welcomed (its heavy boot): its body's snapshot is queued
  //    behind its own timers. Time it could not listen is not time without a body: no private round, no reconnect.
  {
    const { r, host } = await open({}, { idleMs: 60_000 });
    const queued = [];
    let hold = true;
    const Slow = filtered(r.socket(), (m) => { if (hold && m.t === 'snap') { queued.push(m); return false; } return true; });
    const j = joiner(r, { fallback: 'solo', seatWaitMs: 1000 }, { WebSocketImpl: Slow });
    const links = [];
    j.room.net.on('link', (e) => links.push(e.state));
    await clock.wait(100);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'joining', why: 'no-body', body: false }, 'welcomed; the snapshot with its body is on its way');
    blocked(t, 6000);
    await clock.wait(1);
    // Its timers have all just run, six seconds late. The snapshots come after them.
    assert.equal(j.room.solo, false, 'six seconds it could not listen are not six seconds without a body');
    hold = false;
    const sock = r.sockets.at(-1);
    for (const m of queued) sock.heard({ data: JSON.stringify(m) });
    await clock.wait(400);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    assert.deepEqual([j.room.solo, links.join(), j.room.net.stats().drops], [false, 'online', 0]);
    assert.deepEqual(page.lines(), []);
    j.room.net.close(); host.net.close();
  }
  // 6. The room does not come back (reconnectMaxMs): a replica is not left with a frozen round; the host of a room
  //    keeps the round it was running. Both play, alone, and say so.
  {
    const { r, host } = await open({ netplay: { reconnectMaxMs: 5000 } });
    let up = true;
    const Live = r.socket();
    const Gone = class { constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onerror?.({}); }, 0); } send() {} close() {} };
    const j = joiner(r, {}, { WebSocketImpl: function (u) { return up ? new Live(u) : new Gone(u); }, reconnectMaxMs: 5000 });
    await clock.wait(500);
    assert.deepEqual(stands(j.room), { link: 'online', standing: 'playing', why: 'seated', body: true });
    up = false;
    r.sockets.at(-1).cut();
    await clock.wait(3000);
    assert.deepEqual(stands(j.room), { link: 'reconnecting', standing: 'playing', why: 'reconnecting', body: true });
    assert.equal(j.room.hosting, false, 'for these seconds the round on screen is frozen');
    await clock.wait(2500);
    assert.deepEqual(stands(j.room), { link: 'alone', standing: 'solo', why: 'alone', body: true });
    assert.deepEqual([j.room.hosting, j.room.mine().seat, j.room.view().length], [true, 0, 3], 'a round of its own, with bots');
    assert.deepEqual(page.lines(), [['alone', 'Playing on your own · the room dropped, still trying…']]);
    // The host, cut off: the same round, its own body and score, everybody else's body a bot's.
    const n = host.round.n;
    host.mine().score = 5;
    const mineSlot = host.mine().slot;
    for (const sock of r.sockets) sock.cut?.();
    r.room.attach = () => { throw new Error('gone'); };
    await clock.wait(6500);
    assert.deepEqual(stands(host), { link: 'alone', standing: 'solo', why: 'alone', body: true });
    assert.deepEqual([host.round.n, host.mine().slot, host.mine().score, host.mine().seat], [n, mineSlot, 5, 0], 'not a new round: the one it was playing');
    assert.equal([...host.bodies.values()].filter((b) => !b.bot).length, 1);
    j.room.net.close(); host.net.close();
  }
});

/* ------------------------------------------------------------------ the page around the frame (section 24) */

test('net.prefs: kept by the play page, by this document when there is no page, and for the visit when there is neither', async (t) => {
  const { createNetplay } = await netplayKit();
  warnings(t);
  // With no shell at all and no storage (a sandboxed frame on an older play page): memory, for the visit.
  const bare = createNetplay({ config: null, game: 'cave-run' });
  assert.equal(bare.prefs.where, 'memory');
  assert.equal(await bare.prefs.get('quality', 'high'), 'high');
  assert.equal(await bare.prefs.set('quality', 'low'), true);
  assert.equal(await bare.prefs.get('quality', 'high'), 'low');
  assert.equal(bare.prefs.peek('quality'), 'low');
  assert.equal(await bare.prefs.set('', 1), false, 'a key is 1 to 64 characters');
  assert.equal(await bare.prefs.set('k'.repeat(65), 1), false);
  assert.equal(await bare.prefs.set('big', 'x'.repeat(PREFS_LIMITS.bytes)), false, '16 KB a game in all');
  assert.equal(await bare.prefs.get('big', null), null);
  for (let i = 0; i < 40; i += 1) await bare.prefs.set(`k${i}`, i);
  assert.equal(Object.keys(await bare.prefs.all()).length, PREFS_LIMITS.keys, '32 keys');
  assert.equal(await bare.prefs.remove('quality'), true);
  assert.equal(await bare.prefs.get('quality', 'high'), 'high');
  bare.close();
  // A plain file or a dev server: this document's own storage, one object per game.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  t.after(() => { delete globalThis.localStorage; });
  store.set('homie-prefs.cave-run', JSON.stringify({ best: 41 }));
  const local = createNetplay({ config: null, game: 'cave-run' });
  assert.equal(local.prefs.where, 'local');
  assert.equal(await local.prefs.get('best', 0), 41);
  await local.prefs.set('best', 57);
  assert.deepEqual(JSON.parse(store.get('homie-prefs.cave-run')), { best: 57 });
  local.close();
  // In a room: the frame's own storage throws (an opaque origin), so the page keeps them. The helper asks by message.
  const listeners = [];
  const parent = { postMessage() {} };
  globalThis.parent = parent;
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  globalThis.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  t.after(() => { delete globalThis.parent; delete globalThis.addEventListener; });
  const kept = { quality: 'low' };
  const asked = [];
  const page = (m) => {
    if (m.what !== 'prefs') return;
    asked.push([m.op, m.k]);
    const out = { t: 'homie-prefs', n: m.n, ok: true };
    if (m.op === 'all') out.all = { ...kept };
    else if (m.op === 'set' && JSON.stringify(m.v).length > 100) { out.ok = false; out.why = 'too-large'; } else if (m.op === 'set') kept[m.k] = m.v; else delete kept[m.k];
    queueMicrotask(() => { for (const fn of listeners) fn({ source: parent, data: out }); });
  };
  const r = rig();
  t.after(r.stop);
  const framed = createNetplay({ config: cfg('p', { prefs: true }), WebSocketImpl: r.socket(), post: page, game: 'cave-run' });
  assert.equal(framed.prefs.where, 'page');
  assert.equal(await framed.prefs.get('quality', 'high'), 'low', 'what an earlier visit kept');
  assert.equal(await framed.prefs.set('best', 12), true);
  assert.deepEqual(kept, { quality: 'low', best: 12 });
  assert.equal(await framed.prefs.set('refused', 'y'.repeat(200)), false, 'the page\'s refusal is the answer');
  assert.equal(framed.prefs.peek('refused', null), null);
  assert.equal(await framed.prefs.remove('quality'), true);
  assert.deepEqual(kept, { best: 12 });
  assert.deepEqual(asked.map((a) => a[0]), ['all', 'set', 'set', 'del'], 'everything is read once, then only writes');
  // A message from anywhere but the page around the frame is not an answer.
  for (const fn of listeners) fn({ source: {}, data: { t: 'homie-prefs', n: 99, ok: true, all: { stolen: 1 } } });
  assert.equal(framed.prefs.peek('stolen', null), null);
  framed.close();
  // A page from before prefs never says it keeps them: memory, not a wait for an answer that never comes.
  const older = createNetplay({ config: cfg('q'), WebSocketImpl: r.socket(), post: page, game: 'cave-run' });
  assert.equal(older.prefs.where, 'memory');
  older.close();
});

test('net.prefs: a number, a switch and a word that cannot go quiet: a missing key, a null, a wrong type and a read before the prefs arrived all answer with the fallback, in words', async (t) => {
  const { createNetplay } = await netplayKit();
  const said = warnings(t);
  // THE TRAP, as it was met: a volume that was never set, and one an earlier visit kept as `null`.
  const store = new Map([['homie-prefs.loud-game', JSON.stringify({ music: null, sfx: '0.5', quality: 'ultra', mute: 0, best: 41 })]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  t.after(() => { delete globalThis.localStorage; });
  const net = createNetplay({ config: null, game: 'loud-game' });
  assert.equal(Number(null) * 0.8, 0, 'what a game did with a kept null: a volume of 0, and no error');
  assert.equal(await net.prefs.get('music', 0.8), 0.8, 'get: a kept null is nothing kept (it resolved null before, and null * x is silence)');
  assert.equal(net.prefs.number('music', 0.8), 0.8, 'a null');
  assert.equal(net.prefs.number('never-set', 0.8), 0.8, 'a key never set');
  assert.equal(net.prefs.number('sfx', 0.7), 0.7, 'a string is not a number, even one that looks like it');
  assert.equal(net.prefs.number('best', 0), 41, 'a kept number');
  assert.equal(net.prefs.number('best', 0, { max: 10 }), 10, 'held to a range');
  assert.equal(net.prefs.number('best', 0, { min: 50, max: 60 }), 50);
  assert.equal(net.prefs.number('never-set', 7, { max: 5 }), 5, 'the fallback is held to it too');
  assert.equal(net.prefs.boolean('mute', false), false, '0 is not a switch');
  assert.equal(net.prefs.boolean('never-set', true), true);
  assert.equal(net.prefs.string('quality', 'high', { oneOf: ['low', 'high'] }), 'high', 'a word that is not one of the choices');
  assert.equal(net.prefs.string('quality', 'high'), 'ultra');
  assert.equal(net.prefs.string('best', 'x'), 'x');
  // Each wrong type is said once, with the key and what was kept; a key that is simply not set says nothing.
  assert.equal(said.filter((w) => /prefs\.number\('sfx'\).*a string.*fallback \(0\.7\)/.test(w)).length, 1);
  assert.equal(net.prefs.number('sfx', 0.7), 0.7);
  assert.equal(said.filter((w) => /'sfx'/.test(w)).length, 1, 'once');
  assert.ok(said.some((w) => /prefs\.boolean\('mute'\).*a number/.test(w)));
  assert.ok(said.some((w) => /prefs\.string\('quality'\).*'ultra' is not one of \["low","high"\]/.test(w)));
  assert.equal(said.some((w) => /never-set|'music'/.test(w)), false);
  // A fallback of the wrong type is the game's own mistake: thrown, not guessed at.
  assert.throws(() => net.prefs.number('music'), /TypeError.*fallback must be a finite number, not a undefined|fallback must be a finite number/);
  assert.throws(() => net.prefs.number('music', NaN), TypeError);
  assert.throws(() => net.prefs.number('music', '0.8'), TypeError);
  assert.throws(() => net.prefs.number('music', 1, { min: 2, max: 1 }), TypeError);
  assert.throws(() => net.prefs.boolean('mute', 0), TypeError);
  assert.throws(() => net.prefs.string('quality', 'ultra', { oneOf: ['low', 'high'] }), TypeError);
  // SET: what JSON would keep as null (or not at all) is refused, said, and changes nothing.
  assert.equal(await net.prefs.set('music', 0.4), true);
  for (const bad of [NaN, Infinity, -Infinity, () => 1, { level: NaN }, [1, undefined], 10n]) assert.equal(await net.prefs.set('music', bad), false);
  const loop = { name: 'x' }; loop.self = loop;
  assert.equal(await net.prefs.set('loop', loop), false);
  assert.equal(net.prefs.number('music', 0.8), 0.4, 'what was kept stands');
  assert.equal(JSON.parse(store.get('homie-prefs.loud-game')).music, 0.4);
  assert.equal(said.filter((w) => /prefs\.set\('music'.*NaN.*cannot be kept/.test(w)).length, 1, 'said once per key, with the value\'s trouble');
  assert.ok(said.some((w) => /prefs\.set\('loop'.*a loop/.test(w)));
  assert.equal(await net.prefs.set('music', 0), true, '0 is a volume somebody chose');
  assert.equal(net.prefs.number('music', 0.8), 0);
  assert.equal(await net.prefs.set('music', null), true, 'null still removes');
  assert.equal(net.prefs.number('music', 0.8), 0.8);
  assert.equal('music' in JSON.parse(store.get('homie-prefs.loud-game')), false);
  assert.equal(net.prefs.loaded, true, 'with no page to ask, everything is read at once');
  net.close();
  delete globalThis.localStorage;

  // BEFORE THE PREFS ARRIVED: on the play page they come by message. A read before that is the fallback, and says so.
  const listeners = [];
  const parent = { postMessage() {} };
  globalThis.parent = parent;
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  t.after(() => { delete globalThis.parent; delete globalThis.addEventListener; });
  const kept = { music: 0.3, mute: true, quality: 'low', stale: null };
  const sets = [];
  let answer = null;
  const page = (m) => {
    if (m.what !== 'prefs') return;
    const out = { t: 'homie-prefs', n: m.n, ok: true };
    if (m.op === 'all') out.all = { ...kept }; else if (m.op === 'set') { sets.push(m.v); kept[m.k] = m.v; }
    const send = () => { for (const fn of listeners) fn({ source: parent, data: out }); };
    if (m.op === 'all') answer = send; else queueMicrotask(send);
  };
  const r = rig();
  t.after(r.stop);
  said.length = 0;
  const framed = createNetplay({ config: cfg('p', { prefs: true }), WebSocketImpl: r.socket(), post: page, game: 'loud-game' });
  assert.equal(framed.prefs.where, 'page');
  assert.equal(framed.prefs.loaded, false);
  assert.equal(framed.prefs.number('music', 0.8), 0.8, 'read before ready: the fallback, never undefined or 0');
  assert.equal(framed.prefs.boolean('mute', false), false);
  assert.equal(framed.prefs.string('quality', 'high', { oneOf: ['low', 'high'] }), 'high');
  assert.equal(framed.prefs.peek('music', 0.8), 0.8);
  const early = said.filter((w) => /before the prefs had arrived/.test(w));
  assert.equal(early.length, 1, 'said once');
  assert.match(early[0], /net\.prefs\.number\('music'\).*fallback \(0\.8\).*await net\.prefs\.ready/);
  assert.equal(typeof answer, 'function', 'the read itself asked the page');
  answer();
  await framed.prefs.ready;
  assert.equal(framed.prefs.loaded, true);
  assert.deepEqual([framed.prefs.number('music', 0.8), framed.prefs.boolean('mute', false), framed.prefs.string('quality', 'high', { oneOf: ['low', 'high'] })], [0.3, true, 'low'], 'after ready: what an earlier visit kept');
  assert.equal(framed.prefs.number('stale', 0.6), 0.6, 'a null an earlier build wrote for a NaN is nothing kept');
  assert.equal(await framed.prefs.get('stale', 0.6), 0.6);
  assert.equal('stale' in await framed.prefs.all(), false);
  // A value set before the read is the value, at once: no warning for reading your own write.
  assert.equal(await framed.prefs.set('music', NaN), false);
  assert.deepEqual(sets, [], 'a NaN never reaches the page');
  assert.equal(await framed.prefs.set('music', 0.9), true);
  assert.deepEqual(sets, [0.9]);
  assert.equal(framed.prefs.number('music', 0.8), 0.9);
  framed.close();
});

test('net.params: the switches the play page passed in, and only the allowed ones', async () => {
  const { createNetplay } = await netplayKit();
  // What the Worker allows: the defaults, and the names game.json declares; never one the page uses itself.
  assert.deepEqual(PLAY_PARAMS, ['debug', 'q', 'touchdebug', 'cam', 'view']);
  const meta = { netplay: { params: ['seed', 'Quality', 'room', 'k', 'token', 'x y', 'seed', 'lod'] } };
  assert.deepEqual(playParams(meta), ['debug', 'q', 'touchdebug', 'cam', 'view', 'seed', 'lod']);
  assert.deepEqual(playParams({}), [...PLAY_PARAMS]);
  const q = new URLSearchParams('q=low&debug&seed=42&lod=2.5&room=secret&k=TOKEN&t=TICKET&name=Ann&view=<script>&cam=' + 'x'.repeat(60) + '&nope=1');
  assert.deepEqual(paramsFrom(q, meta), { debug: '', q: 'low', seed: '42', lod: '2.5' }, 'a bare ?debug is passed as empty; a bad value is not passed at all');
  assert.deepEqual(paramsFrom(q, {}), { debug: '', q: 'low' });
  // What the build writes from game.json, and what it says about a field it cannot use.
  assert.deepEqual(netplayRow({ version: 7, stallMs: 4000, params: ['seed'] }), { row: { version: '7', stallMs: 4000, params: ['seed'] }, problems: [] });
  assert.deepEqual(netplayRow({ maxPlayers: 8 }), { row: null, problems: [] });
  const bad = netplayRow({ version: 'not a version!', stallMs: 200, params: ['room', 'seed'] });
  assert.deepEqual(bad.row, { stallMs: 1500, params: ['seed'] });
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems.join('\n'), /netplay\.version/);
  assert.match(bad.problems.join('\n'), /1500 to 10000/);
  assert.match(bad.problems.join('\n'), /netplay\.params/);
  // The helper hands the game what the page passed in.
  const net = createNetplay({ config: cfg('p', { params: { q: 'low', debug: '', seed: '42', bad: 7 } }), WebSocketImpl: class { constructor() { this.readyState = 0; } send() {} close() {} }, post: null, game: 'x' });
  assert.deepEqual({ ...net.params }, { q: 'low', debug: '', seed: '42' });
  assert.equal(net.param('q'), 'low');
  assert.equal(net.param('debug'), '', 'a bare switch is the empty string');
  assert.equal(net.param('missing'), null);
  assert.equal(net.param('missing', 'high'), 'high');
  assert.throws(() => { 'use strict'; net.params.q = 'high'; }, TypeError, 'read-only');
  net.close();
  // With no page at all (a plain file, a dev server) the document's own address is read.
  globalThis.location = { search: '?q=high&debug=1' };
  try {
    const solo = createNetplay({ config: null, game: 'x' });
    assert.deepEqual({ ...solo.params }, { q: 'high', debug: '1' });
    solo.close();
  } finally { delete globalThis.location; }
});

test('net.shell: where the page\'s own controls sit over the game, said by the page around the frame only', async (t) => {
  const { createNetplay } = await netplayKit();
  const listeners = [];
  const parent = { postMessage() {} };
  globalThis.parent = parent;
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  t.after(() => { delete globalThis.parent; delete globalThis.addEventListener; });
  const net = createNetplay({ config: cfg('p'), WebSocketImpl: class { constructor() { this.readyState = 0; } send() {} close() {} }, post: () => {}, game: 'x' });
  assert.equal(net.shell, null);
  const seen = [];
  net.on('shell', (s) => seen.push(s));
  const layout = { t: 'homie-shell', device: 'phone', orientation: 'portrait', width: 390, height: 844, rects: [{ id: 'room', x: 290, y: 8, w: 92, h: 34 }, { id: 'chip', x: 10, y: 800, w: 120.4, h: 26, fades: true }, { id: 'empty', x: 0, y: 0, w: 0, h: 10 }, 'junk'] };
  for (const fn of listeners) fn({ source: {}, data: layout });
  assert.equal(net.shell, null, 'not from the page around the frame: ignored');
  for (const fn of listeners) fn({ source: parent, data: layout });
  assert.deepEqual(net.shell, { device: 'phone', orientation: 'portrait', width: 390, height: 844, rects: [{ id: 'room', x: 290, y: 8, w: 92, h: 34 }, { id: 'chip', x: 10, y: 800, w: 120, h: 26, fades: true }] });
  assert.equal(seen.length, 1);
  assert.deepEqual(globalThis.__homieNet.shell, net.shell, 'a HUD check inside the frame reads the same');
  net.close();
});

test('guardGestures: gameplay surfaces never select, call out or pan; fields, links and marked text keep the browser\'s own behaviour', async () => {
  const { guardGestures } = await netplayKit();
  const listeners = {};
  const added = [];
  const doc = {
    head: { appendChild: (el) => { added.push(el); } },
    createElement: () => ({ attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } }),
    addEventListener: (type, fn, o) => { (listeners[type] ??= []).push([fn, o]); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter((x) => x[0] !== fn); },
  };
  /** An element that matches the selectors named in `is` (and so does anything inside it). */
  const el = (...is) => ({ closest: (sel) => (sel.split(',').map((s) => s.trim()).some((s) => is.some((k) => s === k || s.startsWith(`${k}:`) || s.startsWith(`${k}[`))) ? {} : null) });
  const fire = (type, target) => { const e = { target, cancelable: true, prevented: false, preventDefault() { this.prevented = true; } }; for (const [fn] of listeners[type] ?? []) fn(e); return e.prevented; };
  const off = guardGestures({ document: doc, touch: 'canvas, [data-action]' });
  const css = added[0].textContent;
  assert.match(css, /html,body\{[^}]*-webkit-touch-callout:none[^}]*-webkit-user-select:none[^}]*user-select:none/);
  assert.match(css, /canvas, \[data-action\]\{touch-action:none/);
  assert.match(css, /input,textarea,select[^{]*\{[^}]*user-select:text[^}]*-webkit-touch-callout:default/, 'editable fields keep selection and the callout');
  for (const type of ['touchstart', 'touchmove']) assert.equal(listeners[type][0][1].passive, false, `${type} is not passive: it must be able to stop the default`);
  const canvas = el('canvas');
  const action = el('[data-action]');
  const hud = el('div');
  const input = el('input');
  const button = el('button');
  const link = el('a');
  const note = el('[data-selectable]');
  // A long press anywhere in the game: no selection, no callout menu.
  for (const target of [canvas, action, hud, button]) {
    assert.equal(fire('selectstart', target), true);
    assert.equal(fire('contextmenu', target), true);
  }
  // A touch on a gameplay surface never pans or zooms; one on an ordinary button or the HUD is left alone (its click works).
  assert.equal(fire('touchstart', canvas), true);
  assert.equal(fire('touchmove', action), true);
  assert.equal(fire('touchstart', button), false);
  assert.equal(fire('touchstart', hud), false);
  assert.equal(fire('gesturestart', hud), true, 'the page never pinch-zooms');
  // Fields, links and text the game marked selectable keep the browser's behaviour.
  for (const target of [input, link, note]) {
    assert.equal(fire('selectstart', target), false);
    assert.equal(fire('contextmenu', target), false);
    assert.equal(fire('touchstart', target), false);
    assert.equal(fire('gesturestart', target), false);
  }
  // An input inside a gameplay surface is still an input.
  assert.equal(fire('touchstart', el('canvas', 'input')), false);
  off();
  assert.equal(fire('selectstart', canvas), false, 'taken off again');
  assert.equal(added[0].removed, true);
  assert.equal(typeof guardGestures({ document: null }), 'function', 'with no document it is a no-op');
});

/* ------------------------------------------------------------------ the relay's log (HOMIE.md: unattributed connection-loss errors) */

test('the relay says a departure and a failure apart: every line has a time and a room, and none a token', async (t) => {
  const clock = virtualTime(t);
  const r = rig();
  t.after(r.stop);
  const frames = { a: [], b: [] };
  const hello = (name) => JSON.stringify({ t: 'hello', v: 1, rev: 9, name, device: 'desk', want: 'play', canHost: true, game: 'x' });
  const a = r.room.attach({ send: (x) => frames.a.push(JSON.parse(x)), close: () => {}, buffered: () => 0 });
  a.onMessage(hello('a'));
  const b = r.room.attach({ send: (x) => frames.b.push(JSON.parse(x)), close: () => {}, buffered: () => 0 });
  b.onMessage(hello('b'));
  const tokens = [frames.a[0].token, frames.b[0].token];
  assert.ok(tokens.every((x) => typeof x === 'string' && x.length >= 16));
  await clock.wait(10);
  // An ordinary departure: the host's network goes (the transport learns it as the socket's error).
  a.onClose('error');
  const leave = r.lines.find((l) => l.ev === 'leave');
  assert.deepEqual([leave.room, leave.seat, leave.why, leave.via, leave.role, leave.left], ['r', 0, 'closed', 'error', 'host', 1]);
  assert.match(leave.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const elect = r.lines.find((l) => l.ev === 'elect');
  assert.deepEqual([elect.room, elect.why, elect.seat], ['r', 'host-left', 1], 'and the migration it caused, with its own line');
  assert.equal(r.lines.some((l) => l.ev === 'failed'), false, 'a departure is not a failure');
  assert.deepEqual([frames.b.at(-1).t, frames.b.at(-1).role, frames.b.at(-1).why], ['role', 'host', 'host-left'], 'the other browser is handed the room');
  // A room operation that throws: said with what the room was doing, and the transport never sees the throw.
  const real = r.room.elect;
  r.room.elect = () => { throw new Error('boom: the election broke'); };
  assert.doesNotThrow(() => b.onClose());
  r.room.elect = real;
  const failed = r.lines.find((l) => l.ev === 'failed');
  assert.deepEqual([failed.room, failed.op, failed.seat], ['r', 'close', 1]);
  assert.match(failed.error, /boom: the election broke/);
  assert.match(failed.at, /^\d{4}-/);
  assert.equal(r.room.stats.failed, 1);
  // A frame that makes the room throw: its TYPE is logged, never its contents (a hello carries the seat's token).
  const c = r.room.attach({ send: () => {}, close: () => {}, buffered: () => 0 });
  const realHello = r.room.hello;
  r.room.hello = () => { throw new Error('boom: hello'); };
  assert.doesNotThrow(() => c.onMessage(JSON.stringify({ t: 'hello', v: 1, token: tokens[0], name: 'c' })));
  r.room.hello = realHello;
  const bad = r.lines.filter((l) => l.ev === 'failed').at(-1);
  assert.deepEqual([bad.op, bad.frame], ['message', 'hello']);
  const all = JSON.stringify(r.lines);
  for (const tok of tokens) assert.equal(all.includes(tok), false, 'no log line carries a seat token');
  assert.ok(r.lines.every((l) => typeof l.at === 'string' && (l.room === 'r' || l.ev === 'restored')), 'every line: when, and which room');
  // What the runtime says when the other end simply went away is a departure; a real fault is not.
  for (const gone of ['Network connection lost.', 'WebSocket peer disconnected', 'The client disconnected', new Error('Network connection lost'), { name: 'AbortError', message: 'The operation was aborted' }]) assert.equal(departure(gone), true, String(gone?.message ?? gone));
  for (const fault of ['Cannot read properties of undefined (reading \'seat\')', new TypeError('x is not a function'), 'D1_ERROR: no such table: rounds', new RangeError('Maximum call stack size exceeded')]) assert.equal(departure(fault), false, String(fault?.message ?? fault));
  // A log that throws never takes the room with it.
  const loud = new NetRoom({ code: 'q', log: () => { throw new Error('the log is broken'); } });
  const d = loud.attach({ send: () => {}, close: () => {}, buffered: () => 0 });
  assert.doesNotThrow(() => d.onMessage(hello('d')));
  assert.equal(loud.live().length, 1);
});

test('the Worker: a room\'s lines carry the game and the room, a lost socket is a departure, and a browser that left mid-connect is not an uncaught error', async (t) => {
  const { default: worker, Table } = await import('../worker/index.mjs');
  const logs = [];
  const errors = [];
  t.mock.method(console, 'log', (x) => { try { logs.push(JSON.parse(x)); } catch { /* not a line */ } });
  t.mock.method(console, 'error', (x) => { try { errors.push(JSON.parse(x)); } catch { /* not a line */ } });
  const store = new Map();
  const doCtx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil() {} };
  const table = new Table(doCtx, { ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  await new Promise((r) => setTimeout(r, 0));
  const room = table.roomFor('cave-run', 'pub-2', 4);
  const frames = [];
  const h = room.attach({ send: (x) => frames.push(JSON.parse(x)), close: () => {}, buffered: () => 0 });
  h.onMessage(JSON.stringify({ t: 'hello', v: 1, rev: 9, name: 'a', device: 'desk', want: 'play', canHost: true }));
  const token = frames[0].token;
  const hello = logs.find((l) => l.ev === 'hello');
  assert.deepEqual([hello.game, hello.room, hello.seat, hello.role], ['cave-run', 'pub-2', 0, 'host']);
  assert.match(hello.at, /^\d{4}-\d\d-\d\dT/);
  // The runtime's "Network connection lost" on a socket: a departure, in the log with the client it was; then the leave.
  table.socketError('net', { error: new Error('Network connection lost.') }, { id: h.id, seat: 0, role: 'host' });
  h.onClose('error');
  const gone = logs.find((l) => l.ev === 'socket-gone');
  assert.deepEqual([gone.game, gone.room, gone.kind, gone.seat, gone.role], ['cave-run', 'pub-2', 'net', 0, 'host']);
  assert.match(gone.error, /Network connection lost/);
  const leave = logs.find((l) => l.ev === 'leave');
  assert.deepEqual([leave.game, leave.room, leave.via, leave.role], ['cave-run', 'pub-2', 'error', 'host']);
  assert.deepEqual(errors, [], 'nothing on the error stream for a departure');
  // A socket that really failed, and a room operation that threw: on the error stream, with the room.
  table.socketError('net', { error: new TypeError('x is not a function') }, { id: 'q', seat: 1, role: 'replica' });
  assert.deepEqual([errors[0].ev, errors[0].game, errors[0].room, errors[0].seat], ['socket-error', 'cave-run', 'pub-2', 1]);
  room.onClose = () => { throw new Error('boom in the room'); };
  const h2 = room.attach({ send: () => {}, close: () => {}, buffered: () => 0 });
  assert.doesNotThrow(() => h2.onClose());
  assert.deepEqual([errors[1].ev, errors[1].op, errors[1].room], ['failed', 'close', 'pub-2']);
  assert.equal(JSON.stringify([...logs, ...errors]).includes(token), false, 'no line carries the seat\'s token');
  // HOMIE_ROOM_LOG=0: the lifecycle is quiet, a failure is still said.
  const quiet = new Table(doCtx, { HOMIE_ROOM_LOG: '0', ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  await new Promise((r) => setTimeout(r, 0));
  const before = [logs.length, errors.length];
  quiet.roomFor('cave-run', 'pub-3', 4);
  quiet.say({ ev: 'hello', seat: 0 });
  quiet.say({ ev: 'failed', op: 'message' });
  assert.deepEqual([logs.length - before[0], errors.length - before[1]], [0, 1]);

  // The Worker in front of the room: what it hands the frame and the room, and what it says when the room's socket
  // could not be opened because the browser had already gone.
  const cat = { studio: { name: 'Owls', slug: 'owls' }, games: [{ id: 'cave-run', name: 'Cave Run', players: { min: 1, max: 4 }, netplay: { version: '7', stallMs: 4000, params: ['seed'] }, landing: {} }] };
  const files = { '/games.json': JSON.stringify(cat), '/games/cave-run/index.html': '<!doctype html><html><head><title>x</title></head><body></body></html>' };
  const asked = [];
  let fail = null;
  const env = {
    ASSETS: { fetch: async (req) => { const f = files[new URL(typeof req === 'string' ? req : req.url).pathname]; return f ? new Response(f, { headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 }); } },
    LOBBY: { idFromName: () => 'x', get: () => ({ fetch: async (u) => { asked.push(new URL(String(u.url ?? u))); return new Response(JSON.stringify({ room: 'pub-1' })); } }) },
    TABLE: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { if (fail) throw fail; asked.push(new URL(req.url)); return new Response('ok'); } }) },
  };
  const site = (path, init) => worker.fetch(new Request(`https://owls.example${path}`, init), env, { waitUntil() {} });
  const doc = await (await site('/cave-run/__game/?room=r&q=low&seed=4&nope=1&k=TOK&pf=1&debug')).text();
  const net = JSON.parse(/window\.HOMIE_NET=(\{.*?\})<\/script>/.exec(doc)[1]);
  assert.equal(net.ver, '7', 'the game\'s revision, as this page is served');
  assert.equal(net.url, 'wss://owls.example/cave-run/__net?room=r&gv=7', 'and in the socket\'s address, for a helper that predates revisions');
  assert.deepEqual(net.params, { debug: '', q: 'low', seed: '4' }, 'the allowed switches only');
  assert.equal(net.prefs, true);
  assert.equal((await site('/cave-run/__net?room=r&gv=6', { headers: { upgrade: 'websocket' } })).status, 200);
  const toRoom = asked.at(-1).searchParams;
  assert.deepEqual([toRoom.get('cur'), toRoom.get('gv'), toRoom.get('stall')], ['7', '6', '4000'], 'the live build, this socket\'s build, the game\'s stall time');
  await site('/cave-run/api/lobby', { method: 'POST' });
  assert.equal(asked.at(-1).searchParams.get('ver'), '7', 'the Lobby matches within the live build');
  fail = new Error('Network connection lost.');
  const left = await site('/cave-run/__net?room=r&gv=7', { headers: { upgrade: 'websocket' } });
  assert.equal(left.status, 499);
  const said = logs.find((l) => l.ev === 'socket-gone' && l.sub === '__net');
  assert.deepEqual([said.game, said.room], ['cave-run', 'r']);
  fail = new TypeError('the room broke');
  const broke = await site('/cave-run/__net?room=r&gv=7', { headers: { upgrade: 'websocket' } });
  assert.equal(broke.status, 503);
  assert.deepEqual([errors.at(-1).ev, errors.at(-1).game, errors.at(-1).room], ['room-unreachable', 'cave-run', 'r']);
});

test('rules reconnects spread the first attempts and back off through a prolonged outage', async (t) => {
  const { createNetplay } = await netplayKit(); const clock = virtualTime(t); const starts = [];
  t.mock.method(Math, 'random', () => 0.5);
  class Unavailable {
    constructor() { starts.push(Date.now()); queueMicrotask(() => this.onerror?.({})); }
    close() {} send() {}
  }
  const net = createNetplay({ rules: true, config: cfg('retry'), WebSocketImpl: Unavailable, post: null, game: 'x', linkOverlay: false });
  try {
    await clock.wait(45_000);
    assert.ok(starts.length >= 5 && starts.length <= 9, `${starts.length} attempts`);
    assert.ok(starts.slice(1).some((at, i) => at - starts[i] >= 8000));
  } finally { net.close(); }
});
