/**
 * The view library of a rules game (rules/view.ts), built as `homie-studio build` builds it and run against a real
 * relay with the server as host (worker/room.mjs, rules/host.ts), on virtual time. No browser hosts anything here.
 *
 *   - `openRoom()` needs no argument: the build handed the library the game's declarations and its guarded move;
 *   - two views land in one room, each with its own body, the roster and the round, and neither is ever host;
 *   - a player's own body answers its input at once and the server follows it, held to the body's top speed;
 *   - the other view sees that body move, interpolated; entities enter and leave, and an effect the rules emit plays;
 *   - a full round is played with bots: both views get the same results from the server, and a view that claims a
 *     host's part (a snapshot, a round with results, shared state) changes nothing anyone sees;
 *   - input goes out as steps stamped with the room's tick, at most one frame a tick, with a keepalive when idle.
 * Run: node --test packages/studio/test/rules-view.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { prepareRules, viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { COIN_DASH, PKG, esbuildOf, loadGame } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-view-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const json = (rel) => JSON.parse(readFileSync(join(COIN_DASH, rel), 'utf8'));

/** coin-dash's view library as its build bundles it (the declarations and the guarded move handed over first), and its rules for the server. */
let kit = null;
async function coinDashKit() {
  if (kit) return kit;
  const esbuild = await esbuildOf();
  const g = { ...json('game.json'), dir: COIN_DASH };
  const rules = await prepareRules(esbuild, scratch, g);
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `import { openRoom } from ${JSON.stringify(join(PKG, 'rules', 'view.ts'))};\n(globalThis as any).__openRoom = openRoom;\n`);
  const file = join(scratch, 'view.mjs');
  await esbuild.build({ entryPoints: ['homie:view'], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent', plugins: [viewPlugin(g, rules, entry)] });
  await import(pathToFileURL(file).href);
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const compiled = L.R.compileRules(L.def, { tune: json('tunables.json'), map: L.R.compileMap(json('map/main.json')), settings: L.R.roomSettings(g.room).settings, seats: 8 });
  kit = { L, compiled, openRoom: globalThis.__openRoom, bundle: readFileSync(file, 'utf8') };
  return kit;
}

/** A relay with the server as host, on the test's clock, and sockets to it. */
function rig(L, compiled) {
  const lines = [];
  const room = new NetRoom({ code: 'r', maxPlayers: 8, log: (l) => lines.push(l) });
  const host = L.H.createHost({ game: 'coin-dash', compiled, send: (m, text) => room.hostFrame(m, text), log: (l) => lines.push(l), random: () => 0.37, clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) } });
  room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  const sockets = [];
  const socket = () => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      sockets.push(this);
      this.h = room.attach({ send: (x) => setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: x }); }, 0), close: () => { setTimeout(() => this.cut(), 0); }, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.sent.push(JSON.parse(x)); this.h?.onMessage(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose(); }
    cut() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose('error'); this.onclose?.({}); }
  };
  return { room, host, lines, sockets, socket, stop: () => { clearInterval(beat); host.stop(); } };
}
const cfg = (who) => ({ v: 1, url: 'ws://relay/coin-dash/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who });

test('two views in one server-hosted room: own bodies, the roster and the round, input that the server follows, and a full round nobody can forge', async (t) => {
  const { L, compiled, openRoom, bundle } = await coinDashKit();
  assert.doesNotMatch(bundle, /world\.spawn|"take"/, 'the bundle holds no handler of the rules');
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const open = (who) => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('Ada');
  assert.equal(a.status, 'connecting', 'openRoom returns at once');
  const b = open('Bo');
  const heard = { a: { ding: 0, enter: 0, leave: 0, rounds: [], placed: 0, status: [] }, b: { ding: 0, rounds: [] } };
  a.on('ding', (e) => { heard.a.ding += 1; assert.equal(typeof e.at.x, 'number'); });
  a.on('enter', () => { heard.a.enter += 1; });
  a.on('leave', () => { heard.a.leave += 1; });
  a.on('placed', () => { heard.a.placed += 1; });
  a.on('round', (x) => heard.a.rounds.push(x));
  a.on('status', (s) => heard.a.status.push(s));
  b.on('ding', () => { heard.b.ding += 1; });
  b.on('round', (x) => heard.b.rounds.push(x));
  t.after(() => { a.close(); b.close(); });
  await clock.wait(600);

  // Both are playing, seated, and neither is host: the server is.
  assert.deepEqual([a.status, b.status], ['playing', 'playing']);
  assert.deepEqual(heard.a.status, ['playing']);
  assert.deepEqual([a.seat, b.seat], [0, 1]);
  assert.deepEqual([a.net.role, b.net.role, a.net.isHost, b.net.isHost], ['replica', 'replica', false, false]);
  assert.deepEqual(a.net.host, { id: 'server', seat: null });
  assert.equal(r.room.hostId, null);
  assert.deepEqual([a.me.kind, a.me.mine, a.me.seat, a.me.driver, a.me.score], ['runner', true, 0, 'person', 0]);
  assert.equal(b.me.seat, 1);
  assert.deepEqual(a.roster.map((x) => [x.seat, x.name, x.driver, x.me]), [[0, 'Ada', 'person', true], [1, 'Bo', 'person', false], [6, 'Echo', 'bot', false], [7, 'Wren', 'bot', false]]);
  assert.equal(a.round.phase, 'live');
  assert.equal(a.round.n, 1);
  assert.ok(a.round.secondsLeft > 58 && a.round.secondsLeft <= 60, `the clock is the room's: ${a.round.secondsLeft} s left`);
  assert.deepEqual(a.shared, {});
  assert.equal(a.map.spots.start.length, 8);
  assert.equal(a.tune.speed, 6);
  let coins = 0;
  a.each('coin', () => { coins += 1; });
  assert.ok(coins > 10 && coins <= 16, `${coins} coins are drawn`);
  assert.ok(heard.a.enter >= coins + 4);

  // Ada holds right for a second. Her own body goes at once; the server follows it, held to its top speed.
  const x0 = a.me.pos.x;
  const serverX = () => r.host.core.snapshot()[1].find((w) => w[9] === 0)[3][0];
  const sx0 = serverX();
  const sent0 = r.sockets[0].sent.filter((m) => m.t === 'in').length;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(60);
  assert.ok(a.me.pos.x > x0, 'the stick answers on the next step, without waiting for the server');
  await clock.wait(940);
  const run = a.me.pos.x - x0;
  assert.ok(run > 5.2 && run <= 6.4, `she ran ${run} m in a second at 6 m/s`);
  const frames = r.sockets[0].sent.filter((m) => m.t === 'in').slice(sent0);
  assert.ok(frames.length >= 17 && frames.length <= 21, `${frames.length} input frames in a second: at most one a tick`);
  for (const f of frames) {
    assert.equal(f.e, r.host.epoch);
    assert.equal(f.s.length, 1);
    assert.equal(f.s[0].length, 1 + 2 + 9, 'an offset, the two input fields, and the claim of an owner-moved body');
    assert.deepEqual(f.s[0].slice(0, 3), [0, 127, 0]);
  }
  assert.ok(frames.every((f, i) => i === 0 || f.k > frames[i - 1].k), 'stamps rise');
  await clock.wait(200);
  const followed = serverX() - sx0;
  assert.ok(followed > 5 && followed <= 6 * 1.25 + 0.1, `the server moved her body ${followed} m`);
  assert.equal(r.host.core.stats.errors, 0);
  assert.ok(r.room.lastSnap.c.find((row) => row[0] === 0)[2] > 0, 'her input is acknowledged by its stamp');
  // Bo's view draws her there too, a little in the past.
  let seenByBo = null;
  b.each('runner', (e) => { if (e.seat === 0) seenByBo = e; });
  assert.ok(seenByBo && !seenByBo.mine);
  assert.ok(Math.abs(seenByBo.pos.x - serverX()) < 2.5, `Bo sees her at ${seenByBo.pos.x}, the server has her at ${serverX()}`);
  // Standing still: nothing is sent but a keepalive, about four a second.
  a.input({ ax: 0, ay: 0 });
  await clock.wait(300);
  const idle0 = r.sockets[0].sent.filter((m) => m.t === 'in').length;
  await clock.wait(2000);
  const idle = r.sockets[0].sent.filter((m) => m.t === 'in').length - idle0;
  assert.ok(idle >= 6 && idle <= 10, `${idle} frames in two idle seconds`);

  // A view that says what only a host may say changes nothing: the helper will not send it, and the relay would not take it.
  const before = JSON.stringify(r.room.lastRound);
  assert.equal(a.net.snapshot([[9, 0, 0], []], 999, true), false);
  a.net.round({ n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [{ slot: 0, seat: 0, name: 'Ada', score: 999, bot: false, place: 1 }] });
  assert.equal(a.net.state('shared', [999]), false);
  r.sockets[0].send(JSON.stringify({ t: 'round', round: { n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [{ slot: 0, seat: 0, name: 'Ada', score: 999, bot: false, place: 1 }] } }));
  r.sockets[0].send(JSON.stringify({ t: 'state', k: 'shared', d: [999] }));
  await clock.wait(100);
  assert.equal(JSON.stringify(r.room.lastRound), before);
  assert.equal(b.round.phase, 'live');
  assert.ok(b.roster.every((x) => x.score < 20));

  // The rest of the round: the bots take coins (each a ding on both views), then the server's results reach both.
  await clock.wait(57_500);
  assert.ok(heard.a.ding >= 10 && heard.a.ding === heard.b.ding, `${heard.a.ding} dings on one view, ${heard.b.ding} on the other`);
  assert.ok(heard.a.leave >= 10, 'a taken coin leaves the view');
  const overA = heard.a.rounds.at(-1);
  const overB = heard.b.rounds.at(-1);
  assert.equal(overA.phase, 'over');
  assert.equal(overA.results.length, 4);
  assert.deepEqual(overA.results, overB.results, 'both views have the server\'s results');
  assert.deepEqual(overA.results, r.room.lastRound.results);
  assert.equal(overA.results.reduce((n, x) => n + x.score, 0), 16, 'every coin was scored once');
  assert.ok(overA.results.every((x) => x.score !== 999));
  assert.deepEqual(a.roster.map((x) => x.score).sort(), overA.results.map((x) => x.score).sort(), 'the board is the server\'s scores');
  // The break, then round 2: the server places every body, and each view jumps its own.
  const placed = heard.a.placed;
  await clock.wait(9000);
  assert.equal(a.round.n, 2);
  assert.equal(a.round.phase, 'live');
  assert.ok(heard.a.placed > placed, 'placed by the server at the round\'s start');
  assert.deepEqual(a.roster.filter((x) => x.driver === 'person').map((x) => x.score), [0, 0], 'the scores started again (the bots are already at the new coins)');
  const spot = a.map.spots.start[0];
  assert.ok(Math.abs(a.me.pos.x - spot.x) < 0.01 && Math.abs(a.me.pos.y - spot.y) < 0.01, 'back on her start spot');
  assert.equal(r.host.core.stats.errors, 0);
  assert.equal(r.lines.filter((l) => l.ev === 'failed').length, 0);
});

test('a watcher follows server bodies, returns to Auto on leave and follows the same seat on reconnect', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  let token;
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: (m) => { if (m.what === 'token') token = m.token; } } });
  const w = openRoom({ net: { config: { ...cfg('Watcher'), watch: true, follow: 'auto' }, WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); w.close(); });
  await clock.wait(600);
  assert.equal(w.seat, null);
  assert.equal(w.net.isHost, false);
  const id = b.me.id;
  w.follow(id);
  assert.equal(w.net.viewSeat, b.seat);
  assert.ok(w.get(id));
  b.close(); await clock.wait(100);
  assert.equal(w.net.following, 'auto');
  const back = openRoom({ net: { config: { ...cfg('Second'), token }, WebSocketImpl: r.socket(), post: null } });
  t.after(() => back.close());
  await clock.wait(600);
  assert.equal(back.me.id, id);
  assert.equal(w.net.viewSeat, back.seat);
  w.follow(null); assert.equal(w.net.viewSeat, null);
});
