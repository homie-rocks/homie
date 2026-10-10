import { prepareRuntimeFixture } from './rules-kit.mjs';
/**
 * The view library of a rules game (rules/view.ts), built as `homie-studio build` builds it and run against a real
 * relay in both hosting modes (worker/room.mjs, rules/host.ts), on virtual time, including offline play and handover.
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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { COIN_DASH, PKG, esbuildOf, loadGame } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';
import { predictionShaper } from './prediction-shaper.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-view-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const json = (rel) => JSON.parse(readFileSync(join(COIN_DASH, rel), 'utf8'));

/** coin-dash's view library as its build bundles it (the declarations and the guarded move handed over first), and its rules for the server. */
let kit = null; let viewBuild = 0;
async function coinDashKit(mode = 'server', offline = false, tickHz = 20, runaway = false, predict = {}, radiusM = null) {
  if (kit && mode === 'server' && !offline && tickHz === 20 && !runaway && radiusM === null) return kit;
  const esbuild = await esbuildOf();
  let dir = COIN_DASH;
  if (runaway) {
    dir = join(scratch, `variant-${runaway}`); cpSync(COIN_DASH, dir, { recursive: true });
    const file = join(dir, 'src/rules.ts');
    if (runaway === 'pose') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100, 0], max: [100, 100, 3] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,shapes:{commands:{launch:{}}},entities:{runner:{player:true,motion:{launch:f.tick(),phase:f.u8()},input:{az:f.i8()},body:{shape:'capsule',radius:.4,height:1.7,maxSpeed:6},commands:{launch(w,s){s.motion.launch=w.tick;}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){
        if(b.motion.launch){const age=c.tick-b.motion.launch;b.motion.phase=Math.min(20,age);if(age===1)b.pos={x:b.pos.x+4,y:0,z:0};b.grounded=age>=10;b.vel={x:0,y:0,z:age<10?1:0};b.pos={x:b.pos.x,y:0,z:age<10?age*.1:0};}
        else b.pos={x:0,y:0,z:b.pos.z+i.az/127};
      }});`);
    } else if (runaway === 'knock') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100, 0], max: [100, 100, 3] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,shapes:{commands:{launch:{}}},entities:{runner:{player:true,motion:{launch:f.tick()},body:{shape:'capsule',radius:.4,height:1.7,maxSpeed:6},commands:{launch(w,s){s.motion.launch=w.tick;}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir, 'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules'; export const move=defineMove({runner(b,i,c){
const age=c.tick-b.motion.launch; b.vel={x:b.motion.launch&&age>0&&age<=8?24:0,y:0,z:0}; b.pos=c.math.add(b.pos,c.math.scale(b.vel,c.dt));
}});`);
    } else if (runaway === 'press') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-1000, -1000], max: [1000, 1000] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,motion:{jumps:f.u8()},input:{ax:f.i8(),jump:f.press()},body:{shape:'circle',radius:.5,maxSpeed:6}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){if(i.jump)b.motion.jumps+=1;b.pos={x:b.pos.x+i.ax/127*6*c.dt,y:b.motion.jumps,z:0};}});`);
    } else if (runaway === 'push') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-1000, -1000], max: [1000, 1000] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,shapes:{commands:{bump:{}}},entities:{runner:{player:true,motion:{push:f.ticks()},input:{ax:f.i8()},body:{shape:'circle',radius:.5,maxSpeed:6},commands:{bump(world,self){self.motion.push=world.ticks(.4);}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax/127*6,y:0,z:0};if(b.motion.push>0){b.motion.push-=1;b.vel={x:0,y:12,z:0};}c.map.sweep(b,c.math.scale(b.vel,c.dt));}});`);
    } else writeFileSync(file, readFileSync(file, 'utf8').replace('commands: {},', 'commands: { boom: {} },').replace('fields: { score:', 'commands: { boom(world, self) { self.bomb = true; } }, fields: { bomb: f.bit(), score:').replace('tick(world, self) {', 'tick(world, self) { if (self.bomb) { while (true) {} }'));
  }
  const g = { ...json('game.json'), room: { host: mode, offline, tickHz, predict, view: { radiusM } }, dir };
  // This suite measures protocol outcomes on virtual time. The 60 Hz case uses the same checked fixture without
  // asking a busy parallel test runner to meet a 17 ms wall-clock build deadline (rules-build tests own that check).
  const rules = await prepareRuntimeFixture(esbuild, scratch, { ...g, room: { ...g.room, tickHz: 20 } });
  const L = await loadGame(scratch, dir, 'coin-dash');
  const compiled = L.R.compileRules(L.def, { tune: json('tunables.json'), map: L.R.compileMap(JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8'))), settings: L.R.roomSettings(g.room).settings, seats: 8 });
  rules.settings = compiled.settings;
  rules.schema = L.R.schemaOf(compiled);
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `import { openRoom, blendHeading } from ${JSON.stringify(join(PKG, 'rules', 'view.ts'))};\n(globalThis as any).__openRoom = openRoom; (globalThis as any).__blendHeading = blendHeading;\n${mode === 'browser' ? "import { makeHost } from 'homie:host'; (globalThis as any).__makeHost = makeHost;" : ''}\n`);
  const file = join(scratch, `view-${mode}-${offline}-${tickHz}-${runaway}-${++viewBuild}.mjs`);
  await esbuild.build({ entryPoints: ['homie:view'], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent', plugins: [viewPlugin(g, rules, entry)] });
  await import(pathToFileURL(file).href);
  const result = { L, compiled, openRoom: globalThis.__openRoom, makeHost: globalThis.__makeHost, bundle: readFileSync(file, 'utf8') };
  if (mode === 'server' && !offline && tickHz === 20 && !runaway && radiusM === null) kit = result;
  return result;
}

/** A relay with the server as host, on the test's clock, and sockets to it. */
function rig(L, compiled, mode = false, lag = 0, uplink = 0) {
  const browser = mode === true;
  const extra = typeof mode === "object" ? mode : {};
  const lines = [];
  const relay = () => new NetRoom({ code: 'r', rules: true, maxPlayers: compiled.seats, tickHz: compiled.settings.tickHz, log: (l) => lines.push(l) });
  let room = relay();
  const host = L.H.createHost({ game: 'coin-dash', compiled, send: (m, text) => room.hostFrame(m, text), log: (l) => lines.push(l), random: () => 0.37, clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) }, ...extra });
  if (!browser) room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  const sockets = [];
  const network = { up: true };
  const socket = () => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      this.link = sockets.length; sockets.push(this);
      this.h = room.attach({ send: (x) => { const delay = typeof lag === 'function' ? lag(JSON.parse(x), this.link) : lag; if (delay !== null) setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: x }); }, delay); }, close: () => { setTimeout(() => this.cut(), 0); }, buffered: () => 0 });
      setTimeout(() => { if (network.up) { this.readyState = 1; this.onopen?.({}); } }, 0);
    }
    send(x) { this.sent.push(JSON.parse(x)); const delay = typeof uplink === 'function' ? uplink(JSON.parse(x), this.link) : uplink; if (delay === null) return; if (delay) setTimeout(() => this.h?.onMessage(x), delay); else this.h?.onMessage(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose(); }
    cut() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose('error'); this.onclose?.({}); }
  };
  return {
    get room() { return room; }, host, lines, sockets, socket, network, stop: () => { clearInterval(beat); host.stop(); },
    /** The relay is replaced by one with no memory (a Worker restart with nothing saved) and every socket drops. */
    restart() { room = relay(); for (const s of [...sockets]) s.cut(); },
  };
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
  assert.ok(frames.length >= 3 && frames.length <= 6, `${frames.length} input frames in a second: at most one a tick`);
  for (const f of frames) {
    assert.equal(f.e, r.host.epoch);
    assert.equal(f.s.length, 1);
    assert.equal(f.s[0].length, 1 + 2, 'an offset and two input fields: the server owns the body');
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

test('a restored epoch past 32 bits reaches the view and its input reaches the host unchanged', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit(); const clock = virtualTime(t);
  const seed = rig(L, compiled); const saved = seed.host.save(); seed.stop();
  const r = rig(L, compiled, { restore: saved, restoreEpoch: 4294967296 });
  const view = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { view.close(); r.stop(); });
  await clock.wait(600); view.input({ ax: 127, ay: 0 }); await clock.wait(300);
  const inputs = r.sockets[0].sent.filter((m) => m.t === 'in');
  assert.ok(inputs.length > 0); assert.ok(inputs.every((m) => m.e === 4294967296));
  assert.ok(r.host.facts().ins > 0, 'the host accepts the untruncated epoch');
});

test('browser hosts run the same rules, hand the round to the other browser, and finish it with bots', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t);
  const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(600);
  assert.deepEqual([a.status, b.status], ['playing', 'playing']);
  assert.deepEqual([a.net.rulesHosting, b.net.rulesHosting], [true, false]);
  assert.deepEqual([a.seat, b.seat], [0, 1]);
  const x = b.me.pos.x;
  b.input({ ax: -127, ay: 0 });
  await clock.wait(1000);
  assert.ok(b.me.pos.x < x - 4);
  b.input({ ax: 0, ay: 0 });
  await clock.wait(2400);
  await clock.wait(375);
  const n = b.round.n;
  const left = b.round.secondsLeft;
  assert.ok(r.room.lastCkpt?.d?.data?.core, 'the complete runtime has a relay checkpoint');
  r.sockets[0].cut();
  a.close();
  await clock.wait(1000);
  assert.equal(b.net.rulesHosting, true);
  assert.ok(Math.abs(r.room.lastRound.endsAt - (Date.now() + (r.room.lastSnap.d[0][2] - r.room.lastSnap.k) * 50)) < 100, 'the relay deadline follows the restored tick');
  assert.equal(b.round.n, n);
  assert.ok(b.round.secondsLeft < left && b.round.secondsLeft > left - 2, 'handover keeps the round timer');
  assert.equal(b.status, 'playing');
  const rounds = [];
  b.on('round', (round) => rounds.push(round));
  await clock.wait(65_000);
  const over = rounds.find((round) => round.phase === 'over' && round.results);
  assert.ok(over, 'the elected browser finishes the round');
  assert.equal(over.results.reduce((sum, row) => sum + row.score, 0), 16);
  assert.equal(b.round.n, 2);
  assert.deepEqual(b.roster.filter((row) => row.driver === 'person').map((row) => row.seat), [1], 'the expired held seat is freed by the relay');
  assert.equal(r.lines.filter((line) => line.ev === 'failed').length, 0);
});

for (const mode of ['server', 'browser']) test(`${mode} rules play offline with a local body, input and bots`, async (t) => {
  const { openRoom } = await coinDashKit(mode, true);
  const clock = virtualTime(t);
  const a = openRoom({ net: { config: null, post: null } });
  t.after(() => a.close());
  await clock.wait(600);
  assert.equal(a.status, 'playing');
  assert.equal(a.net.rulesHosting, true);
  assert.equal(a.net.connected, false);
  assert.equal(a.me.driver, 'person');
  assert.equal(a.roster.filter((row) => row.driver === 'bot').length, 3);
  const x = a.me.pos.x;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(1000);
  assert.ok(a.me.pos.x > x + 4);
  a.input({ ax: 0, ay: 0 });
  const rounds = [];
  a.on('round', (round) => rounds.push(round));
  await clock.wait(61_000);
  assert.equal(rounds.find((round) => round.phase === 'over' && round.results)?.results.reduce((sum, row) => sum + row.score, 0), 16);
});

test('private server rules do not offer offline play', async (t) => {
  const { openRoom, bundle } = await coinDashKit();
  assert.doesNotMatch(bundle, /world\.spawn/);
  const clock = virtualTime(t);
  const a = openRoom({ net: { config: null, post: null } });
  t.after(() => a.close());
  await clock.wait(2000);
  assert.equal(a.net.rulesHosting, false);
  assert.equal(a.me, null);
  assert.equal(a.status, 'offline');
});


test('a lost server room falls back locally, reports no offline progress, then rejoins the server', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000);
  assert.equal(a.net.rulesHosting, false);
  r.network.up = false;
  r.sockets[0].cut();
  await clock.wait(6500);
  assert.equal(a.net.rulesHosting, true);
  assert.equal(a.status, 'playing');
  const frames = () => r.sockets.flatMap((s) => s.sent).filter((m) => ['snap', 'round', 'roster', 'ckpt', 'state'].includes(m.t));
  assert.deepEqual(frames(), []);
  a.input({ ax: 127, ay: 0 });
  await clock.wait(1000);
  assert.deepEqual(frames(), [], 'offline scores, state, snapshots and saves never go to the relay');
  r.network.up = true;
  // The pending silent socket times out, then the existing reconnect path opens another.
  await clock.wait(30_000);
  assert.equal(a.net.connected, true);
  assert.equal(a.net.rulesHosting, false, 'the local timer is stopped before using the server again');
  assert.equal(a.net.host.id, 'server');
  assert.deepEqual(frames(), []);
});


test('a sixty-tick browser host sends a snapshot a tick inside the relay allowance', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true, 60);
  const clock = virtualTime(t);
  const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2000);
  const before = r.room.lastSnap.k;
  const sent = r.sockets[0].sent.length;
  await clock.wait(1000);
  assert.ok(r.room.lastSnap.k - before >= 58, 'the simulation keeps sixty ticks a second');
  const snapshots = r.sockets[0].sent.slice(sent).filter((m) => m.t === 'snap');
  assert.ok(snapshots.length >= 59 && snapshots.length <= 61, `${snapshots.length} snapshots a second`);
  assert.equal(b.status, 'playing');
});


test('offline rules prefetch waits for playable and a closed view cannot start a late loader', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  let loads = 0;
  let starts = 0;
  let deliver;
  const pending = new Promise((resolve) => { deliver = resolve; });
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'server', offline: true, load: () => { loads += 1; return pending; } } } });
  t.after(() => { a.close(); r.stop(); });
  assert.equal(loads, 0);
  await clock.wait(1);
  assert.equal(loads, 0, 'a welcome is not a playable snapshot');
  await clock.wait(500);
  assert.equal(a.status, 'playing');
  assert.equal(loads, 1);
  a.close();
  deliver(() => { starts += 1; throw new Error('a closed view started a host'); });
  await clock.wait(100);
  assert.equal(starts, 0);
  const b = openRoom({ net: { config: null, post: null,
    rulesHost: { mode: 'server', offline: true, load: () => pending } } });
  b.close();
  await clock.wait(100);
  assert.equal(starts, 0, 'closing during offline startup also cancels the pending host');
});

test('promotion replaces a poisoned checkpoint and publishes the fresh round', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2200);
  r.room.lastCkpt.d.data.core.ents = {};
  r.sockets[0].cut(); a.close();
  await clock.wait(1500);
  assert.equal(b.net.rulesHosting, true);
  assert.equal(b.status, 'playing');
  assert.ok(Array.isArray(r.room.lastCkpt.d.data.core.ents));
  assert.ok(r.room.lastCkpt.k > 0);
  assert.ok(r.room.lastRound.endsAt > Date.now());
});

test('a failed browser runtime ends the room without electing its checkpoint again', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true, 20, true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1200);
  a.command('boom');
  await clock.wait(6000);
  assert.equal(r.room.hostId, null);
  assert.equal(r.room.lastCkpt, null);
  assert.equal(a.net.rulesHosting, false);
  assert.equal(b.net.rulesHosting, false);
  assert.equal(a.net.link, 'closed');
  assert.equal(b.net.link, 'closed');
  const fresh = openRoom({ net: { config: cfg('Fresh'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => fresh.close()); await clock.wait(500);
  assert.equal(fresh.net.rulesHosting, true);
  assert.equal(fresh.status, 'playing');
});

for (const offline of [true, false]) test(`a hidden solo host pauses and resumes, offline=${offline}`, async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const listeners = new Map();
  const previous = globalThis.document;
  globalThis.document = { hidden: false, removeEventListener() {}, addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]) };
  const a = openRoom({ net: { config: offline ? null : cfg('Solo'), WebSocketImpl: r.socket(), post: null } });
  let currentTick = 0; a.net.on('snapshot', (s) => { currentTick = s.k; });
  t.after(() => { a.close(); r.stop(); if (previous) globalThis.document = previous; else delete globalThis.document; });
  await clock.wait(1000);
  globalThis.document.hidden = true; listeners.get('visibilitychange').forEach((fn) => fn());
  const tick = currentTick;
  await clock.wait(10000);
  assert.equal(currentTick, tick);
  assert.equal(a.net.rulesHosting, true);
  globalThis.document.hidden = false; listeners.get('visibilitychange').forEach((fn) => fn());
  await clock.wait(1000);
  assert.equal(currentTick, tick + 20);
});

test('a module that cannot load leaves no host without a runtime', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: () => { throw new Error('module unavailable'); } } } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  assert.equal(a.net.rulesHosting, false); assert.equal(a.net.role, 'replica');
  assert.notEqual(a.net.link, 'closed'); assert.equal(r.room.hostId, null);
});

test('server reconnect survives an unavailable offline module', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t); const r = rig(L, compiled);
  const posts = [];
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: (m) => posts.push(m),
    rulesHost: { mode: 'server', offline: true, load: () => Promise.reject(new Error('offline chunk unavailable')) } } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(9000);
  assert.notEqual(a.net.link, 'closed');
  assert.match(posts.filter(m => m.what === 'line').at(-1)?.text, /needs a connection/i);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.status, 'playing');
});

for (const frameType of ['snap', 'ckpt', 'state', 'ev', 'round', 'roster']) test(`a present seat ignores a delayed free and ${frameType} size failure is visible and terminal`, async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const posts = []; const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: (m) => posts.push(m) } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000);
  r.sockets[0].onmessage({ data: JSON.stringify({ t: 'free', seat: a.seat }) });
  await clock.wait(200); assert.equal(a.me?.driver, 'person');
  r.sockets[0].send(JSON.stringify({ t: frameType, rules: true, d: 'x'.repeat(frameType === 'ckpt' ? 70000 : 17000) }));
  await clock.wait(500);
  assert.equal(a.net.rulesHosting, false); assert.equal(a.net.link, 'closed');
  assert.match(warnings.join(' '), /size cap/);
  assert.equal(b.net.link, 'closed'); assert.equal(r.room.hostId, null);
  assert.match(posts.filter(m => m.what === 'line').at(-1)?.text, /size|cap/);
});

for (const jump of [-10000, 30000]) test(`local snapshots keep rising when the wall clock moves ${jump} ms`, async (t) => {
  const { openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const wallNow = Date.now;
  let shift = 0; Date.now = () => wallNow() + shift;
  performance.now = () => wallNow() - 1000000;
  t.after(() => { Date.now = wallNow; });
  const a = openRoom({ net: { config: null, post: null } }); t.after(() => a.close());
  const snaps = []; a.net.on('snapshot', s => snaps.push(s));
  await clock.wait(1000); const before = snaps.at(-1);
  shift = jump; await clock.wait(1000);
  assert.equal(snaps.at(-1).k, before.k + 20);
  assert.ok(snaps.at(-1).st > before.st);
  assert.ok(a.net.sample().b.k >= before.k + 15, 'the rendered picture advances too');
  shift = 0; await clock.wait(1000);
  assert.equal(snaps.at(-1).k, before.k + 40);
  assert.ok(a.net.sample().b.k >= before.k + 35, 'clock correction also keeps rendering');
});

test('a solo online save survives a forgotten relay without uploading later offline progress', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('Solo'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(20000);
  r.network.up = false; r.sockets[0].cut();
  await clock.wait(6000);
  const savedTick = r.room.lastCkpt.k;
  let returnedTick = 0; a.net.on('snapshot', s => { if (r.network.up && a.net.connected && !returnedTick) returnedTick = s.k; });
  await clock.wait(65000);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.me?.driver, 'person');
  assert.ok(returnedTick >= savedTick - 30 && returnedTick < savedTick + 300, 'the pre-offline save resumes');
});

test('browser rules carry reserved guides, validated goals, asks, answers and companion pacing', async (t) => {
  const { source, vocab: baseVocab } = await import('./rules-feature-kit.mjs');
  const vocab = { ...baseVocab, asks: { ...baseVocab.asks, no_thanks: { text: 'No thanks', leave: true } } };
  const { writeGame } = await import('./rules-kit.mjs');
  const dir = writeGame(scratch, 'browser-features', { rules: source });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocab));
  const g = { id: 'browser-features', dir, players: { max: 4 }, room: { host: 'browser' } };
  const esbuild = await esbuildOf(); const rules = await prepareRuntimeFixture(esbuild, scratch, g);
  const L = await loadGame(scratch, dir, g.id);
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), settings: rules.settings, seats: 4 });
  const entry = join(scratch, 'features-view.ts'); writeFileSync(entry, `export { openRoom } from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  const file = join(scratch, 'features-view.mjs');
  await esbuild.build({ stdin: { contents: `import 'homie:game'; export { openRoom } from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: file, plugins: [viewPlugin(g, rules, entry)] });
  const { openRoom } = await import(pathToFileURL(file).href);
  const clock = virtualTime(t); const r = rig(L, c, true);
  r.room.setVocabulary(vocab); r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 1, bots: 'fill', brain: 'workers-ai' });
  r.room.decider = async () => ({ ok: true, by: 'ai', picks: { advance: false } });
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1200);
  assert.equal(a.net.rulesHosting, true);
  const saved = () => r.room.lastCkpt.d.data;
  assert.equal(saved().core.shared[1], 0, 'the remote decision reaches the rules rather than the floor');
  const guide = saved().core.ents.find(e => e[12] === 'ai' && e[11] === 3);
  assert.ok(guide); assert.equal(guide[17][2], 1, 'the reserved guide has a valid goal');
  const goals = []; a.on('goal', g => goals.push(g));
  let body; a.each('pawn', e => { if (e.seat === 3) body = e; });
  assert.ok(a.askButtons(body.id).some(b => b.k === 'visit' && b.args.place === 'camp'));
  a.ask(body.id, 'follow', { seat: 0 });
  await clock.wait(300);
  assert.ok(r.sockets[0].sent.some(m => m.k === 'agent:goal' && m.d?.goal?.goal === 'follow'));
  assert.ok(goals.some(g => g.goal?.goal === 'follow'), 'the hosting view receives its own goal');
  a.net.checkpointNow();
  const before = saved().core.ents.find(e => e[11] === 3)[17][0];
  await clock.wait(1000); a.net.checkpointNow();
  assert.equal(saved().core.ents.find(e => e[11] === 3)[17][0], before, 'an asked goal carries without repeating the floor');
});

test('a persistently slow visible browser yields to another ready player', async (t) => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('Slow'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: async () => o => makeHost({ ...o, now: () => performance.now() / 20 }) } } });
  const b = openRoom({ net: { config: cfg('Ready'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(8500);
  assert.equal(a.net.rulesHosting, false); assert.equal(b.net.rulesHosting, true);
  assert.equal(b.status, 'playing');
});

test('a failed offline runtime still reconnects to its healthy server room', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true, 20, true);
  const clock = virtualTime(t); const r = rig(L, compiled);
  const posts = [];
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(6000); assert.equal(a.net.rulesHosting, true);
  a.command('boom'); await clock.wait(3000);
  assert.equal(a.net.rulesHosting, false); assert.notEqual(a.net.link, 'closed');
  assert.match(posts.filter(m => m.what === 'line').at(-1).text, /offline|connection/i);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.status, 'playing');
});


test('two equally slow browsers keep one host after measuring both', async (t) => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: async () => o => makeHost({ ...o, now: () => performance.now() / 20 }) } } });
  const a = open('First'); const b = open('Second');
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(40000);
  assert.ok(r.room.stats.promotions <= 1, `promotions: ${r.room.stats.promotions}`);
});

test('a held person retains identity and body across browser promotion', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); const b = open('Held'); const c = open('Next');
  t.after(() => { a.close(); b.close(); c.close(); r.stop(); });
  await clock.wait(1000); const id = b.me.id;
  b.close(); await clock.wait(600); a.close(); await clock.wait(1200);
  assert.equal(c.get(id)?.driver, 'person');
  assert.equal(c.roster.find(s => s.seat === 1)?.name, 'Held');
});

async function featureKit(id, mode, mutate = s => s, tickHz = 20) {
  const { source, vocab: baseVocab } = await import('./rules-feature-kit.mjs');
  const vocab = { ...baseVocab, asks: { ...baseVocab.asks, no_thanks: { text: 'No thanks', leave: true } } };
  const { writeGame } = await import('./rules-kit.mjs');
  const dir = writeGame(scratch, id, { rules: mutate(source) });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocab));
  const g = { id, dir, players: { max: 4 }, room: { host: mode, tickHz } };
  const esbuild = await esbuildOf(); const rules = await prepareRuntimeFixture(esbuild, scratch, g);
  const L = await loadGame(scratch, dir, id);
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), settings: rules.settings, seats: 4 });
  const entry = join(scratch, `${id}.ts`); writeFileSync(entry, `export { openRoom } from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  const file = join(scratch, `${id}.mjs`);
  await esbuild.build({ stdin: { contents: `import 'homie:game'; export { openRoom } from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: file, plugins: [viewPlugin(g, rules, entry)] });
  return { L, compiled, vocab, ...(await import(pathToFileURL(file).href)) };
}

for (const maxSpeed of [0, 100]) test(`movement probes derive stationary controls from the declared player speed ${maxSpeed}`, async t => {
  const { L, compiled, openRoom } = await featureKit(`movement-probe-${maxSpeed}`, 'server', s => {
    s = s.replace('maxSpeed: 100', `maxSpeed: ${maxSpeed}`);
    return maxSpeed === 0 ? s.replace('body.pos.x + input.ax / 100', 'body.pos.x') : s;
  });
  const clock = virtualTime(t); const r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(600);
  assert.equal(globalThis.__homieNet.probe.movement(), maxSpeed === 0 ? 'stationary' : 'spatial');
  assert.equal(a.status, 'playing');
  assert.equal(a.net.role, 'replica');
  const before = a.me.pos.x;
  a.input({ ax: 100 }); await clock.wait(600);
  if (maxSpeed === 0) assert.equal(a.me.pos.x, before, 'stationary rules use a no-op move and still receive real inputs');
  else assert.ok(a.me.pos.x > before, 'moving rules remain subject to movement checks');
});

for (const path of ['server', 'replica', 'hosting']) test(`public view session has the same results through ${path}`, async t => {
  const browser = path !== 'server';
  const { L, compiled, vocab, openRoom } = await featureKit(`public-${path}`, browser ? 'browser' : 'server', s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: {} }, commands: { done: {}, ask: {} }').replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, {});"));
  const clock = virtualTime(t); const r = rig(L, compiled, browser);
  r.room.setVocabulary(vocab); r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 1, bots: 'fill', brain: 'workers-ai' });
  r.room.decider = async () => ({ ok: true, by: 'ai', picks: { advance: true } });
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); const b = open('Second'); const watcher = open('Watcher');
  const view = path === 'replica' ? b : a;
  const heard = { say: [], ask: [], goal: [], pulse: [] };
  for (const key of Object.keys(heard)) view.on(key, e => heard[key].push(e));
  const others = []; watcher.on('say', e => others.push(e));
  t.after(() => { a.close(); b.close(); watcher.close(); r.stop(); });
  await clock.wait(1200);
  let guide; view.each('pawn', e => { if (e.seat === 3) guide = e; });
  assert.ok(guide);
  assert.deepEqual(view.askButtons(guide.id).map(b => [b.k, b.args]), [['visit', { place: 'camp' }], ['follow', { seat: view.seat }], ['no_thanks', {}]]);
  assert.deepEqual(a.roster.map(s => [s.name, s.driver]), b.roster.map(s => [s.name, s.driver]));
  assert.ok(view.roster.filter(s => s.driver === 'ai').every(s => s.name.includes('AI')));
  assert.ok(heard.say.some(e => e.text === 'Hello!'));
  view.ask(guide.id, 'follow', { seat: view.seat });
  await clock.wait(300);
  assert.equal(heard.ask.at(-1).k, 'follow'); assert.equal(heard.goal.at(-1).goal.goal, 'follow');
  assert.equal(view.get(guide.id).goal.asked, true);
  view.command('ask'); await clock.wait(300); assert.ok(view.me.answered >= 1); assert.equal(view.shared.yes, true);
  assert.ok(heard.pulse.length > 20);
  let directDecision; view.net.decide({}, { ready: { type: 'noul', instructions: 'Ready?' } }, { floor: () => ({ ready: false }) }).then(r => { directDecision = r; });
  await clock.wait(100);
  assert.equal(directDecision?.why, 'not-host', 'a view never starts a second decision owner beside its runtime');
  view.net.send('say', { text: 'My own line', seat: 99 });
  await clock.wait(100);
  assert.equal(heard.say.find(e => e.text === 'My own line')?.seat, view.seat);
  assert.equal(others.find(e => e.text === 'My own line')?.seat, view.seat);
  b.net.send('say', { text: 'From second', ai: true, slot: 3 });
  await clock.wait(100);
  for (const events of [heard.say, others]) {
    const line = events.find(e => e.text === 'From second'); assert.equal(line?.seat, b.seat); assert.equal(line.ai, undefined); assert.equal(line.slot, -1, 'ordinary speech cannot impersonate an AI slot');
  }
  watcher.net.send('say', { text: 'From watcher' }); await clock.wait(100);
  assert.equal(heard.say.find(e => e.text === 'From watcher')?.seat, null);
  view.ask(guide.id, 'no_thanks'); await clock.wait(100);
  const goalsBefore = heard.goal.length;
  view.ask(guide.id, 'follow', { seat: view.seat }); await clock.wait(100);
  assert.equal(heard.goal.length, goalsBefore);
  r.room.setPolicy({ ...r.room.policy, speech: 'off' }); await clock.wait(50);
  a.net.send('say', { text: 'Muted' }); b.net.send('say', { text: 'Muted' }); await clock.wait(100);
  assert.ok(!heard.say.some(e => e.text === 'Muted'));
  const oldState = view.shared; assert.equal(view.net.state('shared', [999]), false);
  view.net.round({ n: 999 }); view.net.roster([]);
  assert.deepEqual(view.shared, oldState); assert.notEqual(view.round.n, 999);
  await clock.wait(1500);
  assert.deepEqual(a.round.results, b.round.results);
});

test('sixty ticks of effects per second reach both views without drops or elections', async t => {
  const { L, compiled, openRoom } = await featureKit('fx-sixty', 'browser', s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: { tick: f.u32() } }, commands: { done: {}, ask: {} }').replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, { tick: world.tick });").replace('seconds: 3', 'seconds: 60'), 60);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  const counts = [0, 0]; a.on('pulse', () => counts[0]++); b.on('pulse', () => counts[1]++);
  await clock.wait(20000);
  assert.equal(r.room.stats.drops, 0); assert.equal(r.room.stats.promotions, 0);
  assert.ok(counts[1] >= 1190 * 2, `${counts[1]} effects received`);
  assert.ok(Math.abs(counts[0] - counts[1]) <= 40);
});

test('shared state that grows after build stops every page with the measured cap', async t => {
  const payload = JSON.stringify(Array(1024).fill(4000000000));
  const { L, compiled, openRoom } = await featureKit('state-growth', 'browser', s => s.replace('commands: { done: {}, ask: {} }', 'events: { grow: {} }, commands: { grow: {}, done: {}, ask: {} }').replace('answers: f.u16()', 'big: f.list(f.u32(), 1024), bigger: f.list(f.u32(), 1024), answers: f.u16()').replace('commands: { done(world', `commands: { grow(world) { world.sendRoom('grow', {}); }, done(world`).replace('on: { answer(world, e)', `on: { grow(world) { world.shared.big = ${payload}; world.shared.bigger = ${payload}; }, answer(world, e)`));
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [[], []];
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: m => posts[0].push(m) } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts[1].push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000); a.command('grow'); await clock.wait(1000);
  assert.equal(a.net.link, 'closed'); assert.equal(b.net.link, 'closed'); assert.equal(r.room.stats.promotions, 0);
  for (const p of posts) assert.match(p.filter(m => m.what === 'line').at(-1).text, /state is \d+ B; the cap is 8192 B/);
});

test('runtime bursts drain without dropping output or ending the room', async t => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  let output;
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [[], []];
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: m => posts[0].push(m), rulesHost: { mode: 'browser', offline: true, load: async () => o => { output = o.send; return makeHost(o); } } } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts[1].push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000);
  for (let i = 0; i < 140; i++) output({ t: 'ev', k: 'say', d: { text: 'A burst' } });
  await clock.wait(1000);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online'); assert.equal(r.room.stats.promotions, 0);
  assert.equal(r.sockets[0].sent.filter(m => m.t === 'ev' && m.d?.text === 'A burst').length, 140);
  assert.equal(r.room.stats.drops, 0);
});

test('public browser views preserve the whole round through handover', async t => {
  const { L, compiled, vocab, openRoom } = await featureKit('public-handover', 'browser', s => s
    .replace('seconds: 3', 'seconds: 60')
    .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}')
    .replace('floors: f.u16()', 'score: f.u16({ score: true }), dice: f.u32(), floors: f.u16()')
    .replace('self.level = world.level;', 'self.level = world.level; self.score += 1; self.dice = Math.floor(world.random() * 1000000);'));
  const clock = virtualTime(t);
  t.mock.method(Math, 'random', () => 0.37);
  const runs = [false, true].map(handover => {
    const r = rig(L, compiled, true);
    r.room.setVocabulary(vocab);
    r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'workers-ai' });
    // Keep the request pending over the election; the rule's own deadline supplies its floor.
    r.room.decider = () => new Promise(() => {});
    const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
    const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
    const frames = new Map(); const lines = [];
    b.net.on('snapshot', s => frames.set(s.k, structuredClone(s.d)));
    b.on('say', e => lines.push(e.text));
    t.after(() => { a.close(); b.close(); r.stop(); });
    return { r, a, b, frames, lines, handover };
  });
  await clock.wait(600);
  for (const { a } of runs) {
    let guide; a.each('pawn', e => { if (e.seat === 3) guide = e; });
    a.ask(guide.id, 'follow', { seat: 1 });
    a.command('ask');
  }
  await clock.wait(150);
  const changed = runs[1];
  const before = { roster: changed.b.roster.map(s => [s.seat, s.name, s.driver]), round: changed.b.round.n };
  changed.a.net.checkpointNow();
  changed.r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(5500);
  assert.equal(changed.b.net.rulesHosting, true);
  assert.equal(changed.a.net.rulesHosting, false);
  assert.deepEqual(changed.b.roster.map(s => [s.seat, s.name, s.driver]), before.roster);
  assert.equal(changed.b.round.n, before.round);
  assert.ok(Math.abs(changed.b.round.endsAt - runs[0].b.round.endsAt) < 150);
  const common = [...changed.frames.keys()].filter(k => k > 16 && runs[0].frames.has(k));
  assert.ok(common.length > 15);
  for (const tick of common) assert.deepEqual(changed.frames.get(tick), runs[0].frames.get(tick), `public state at tick ${tick}: scores, dice, bodies, goals and clock`);
  assert.deepEqual(changed.b.shared, runs[0].b.shared);
  assert.ok(changed.a.me.answered > 0, 'the carried decision reaches its original body');
  assert.ok(runs[0].lines.includes('Hello!'), 'the comparison observes guide speech');
  assert.deepEqual(changed.lines, runs[0].lines, 'guide speech keeps its pacing');
});

for (const damage of ['field', 'queue', 'name', 'answer']) test(`public browser handover rejects a damaged ${damage} checkpoint and starts fresh`, async t => {
  const { L, compiled, vocab, openRoom } = await featureKit(`public-bad-${damage}`, 'browser', s => s.replace('seconds: 3', 'seconds: 60'));
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [];
  r.room.setVocabulary(vocab);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500); a.net.checkpointNow(); await clock.wait(1);
  const bad = structuredClone(r.room.lastCkpt.d);
  const save = bad.data;
  if (damage === 'field') save.core.ents[0][17][0] = -99;
  if (damage === 'queue') save.queues.push([0, { ax: 999 }, null, 1, 1]);
  if (damage === 'name') save.names[0][1] = 'x'.repeat(41);
  if (damage === 'answer') save.core.queue.push([save.core.tick + 1, 0, '', save.core.seq++, '', 'room', 'answer', { ask: 'director', by: 'ai', picks: { advance: 'forged' } }, save.core.tick, 1]);
  r.sockets[0].send(JSON.stringify({ t: 'ckpt', rules: true, k: r.room.lastCkpt.k, d: bad }));
  r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(500);
  assert.equal(b.net.rulesHosting, true); assert.equal(b.status, 'playing');
  assert.ok(posts.some(m => m.what === 'line' && /new round/i.test(m.text)));
  assert.ok(b.net.latest().k < 20, 'a damaged round is replaced, not repaired');
});

for (const kind of ['react', 'say', 'vote', 'ping', 'in', 'ev', 'unknown']) test(`hosting player's ${kind} allowance and refusal match a replica`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t), r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2100);
  const clients = [...r.room.clients.values()];
  for (const c of clients) { c.rates.clear(); c.drops = []; }
  const frame = { t: kind, k: kind === 'ev' ? 'emote:wave' : 'heart', text: 'Hello', op: 'level', value: 2, c: 1, s: [] };
  for (const socket of r.sockets.slice(0, 2)) for (let i = 0; i < 65; i++) socket.send(JSON.stringify(frame));
  assert.equal(clients[0].drops.length, clients[1].drops.length);
  assert.ok(clients[0].drops.length > 0);
  await clock.wait(500);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online');
  assert.equal(r.room.stats.promotions, 0);
});

test('faulty reliable output hands over, excess snapshots only drop', async t => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t), r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2100);
  for (let i = 0; i < 100; i++) r.sockets[0].send(JSON.stringify({ t: 'snap', rules: true, k: 1, d: [] }));
  assert.equal(r.room.stats.promotions, 0);
  for (let i = 0; i < 30; i++) r.sockets[0].send(JSON.stringify({ t: 'round', rules: true, round: { n: 1, phase: 'live' } }));
  await clock.wait(1000);
  assert.equal(r.room.stats.promotions, 1); assert.equal(b.net.rulesHosting, true);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online');
});

const pendingDecisionGame = (s) => s.replace('seconds: 3', 'seconds: 60').replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}')
  .replace('floors: f.u16()', 'score: f.u16({ score: true }), dice: f.u32(), adv: f.u8(), by: f.u8(), floors: f.u16()').replace('on: { answer(world, self, e) { self.answered += 1; } }', "on: { answer(world, self, e) { self.answered += 1; self.adv = e.picks.advance ? 2 : 1; self.by = e.by === 'ai' ? 2 : 1; } }")
  .replace('self.level = world.level;', 'self.level = world.level; self.score += 1; self.dice = Math.floor(world.random() * 1000000);');
for (const answer of ['never (the floor at its deadline)', 'the relay answers 2 s after the handover', 'the relay refuses 1 s after the handover']) test(`a decision pending at a handover is answered exactly once: ${answer}`, async (t) => {
  const { L, compiled, vocab, openRoom } = await featureKit(`once-${answer.length}`, 'browser', pendingDecisionGame);
  const clock = virtualTime(t); t.mock.method(Math, 'random', () => 0.37);
  const r = rig(L, compiled, true); r.room.setVocabulary(vocab);
  r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'workers-ai' });
  let asked = 0; let release = null;
  r.room.decider = () => { asked += 1; return new Promise((res) => { release = res; }); };
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500);
  let guide; a.each('pawn', (e) => { if (e.seat === 3) guide = e; });
  a.ask(guide.id, 'no_thanks');                  // "leave me alone" from A
  b.ask(guide.id, 'follow', { seat: b.seat });   // B's ask: an asked goal carried by pacing
  await clock.wait(400);
  a.command('ask'); await clock.wait(200);
  const before = { tick: b.net.latest().k, score: a.me.score, bscore: b.me.score, goal: b.get(guide.id).goal?.goal, asked: b.get(guide.id).goal?.asked, roster: b.roster.map((s) => [s.seat, s.name, s.driver]), round: [b.round.n, b.round.phase], answers: b.shared.answers, answered: a.me.answered, endsAt: b.round.endsAt };
  assert.equal(before.answers, 0); assert.equal(asked, 1, 'one decide reached the relay before the handover');
  a.net.checkpointNow(); r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(1000);
  assert.equal(b.net.rulesHosting, true, 'B hosts'); assert.equal(a.net.rulesHosting, false);
  if (/answers/.test(answer)) { await clock.wait(1000); release({ ok: true, by: 'ai', picks: { advance: false } }); }
  if (/refuses/.test(answer)) { release({ ok: false, why: 'pace' }); }
  await clock.wait(9000);
  const after = { tick: b.net.latest().k, score: a.me.score, bscore: b.me.score, goal: b.get(guide.id).goal?.goal, asked: b.get(guide.id).goal?.asked, roster: b.roster.map((s) => [s.seat, s.name, s.driver]), round: [b.round.n, b.round.phase], answers: b.shared.answers, answered: a.me.answered, endsAt: b.round.endsAt };
  console.log(`[${answer}] before ${JSON.stringify(before)}\n   after ${JSON.stringify(after)}; decides the relay was asked ${asked}; decide frames from B ${r.sockets[1].sent.filter((m) => m.t === 'decide').length}; yes ${b.shared.yes}`);
  assert.equal(after.answered, 1, 'the asking body heard the answer once');
  assert.deepEqual(after.roster, before.roster); assert.deepEqual(after.round, before.round);
  assert.ok(Math.abs(after.endsAt - before.endsAt) < 150, `the round's clock: ${before.endsAt} -> ${after.endsAt}`);
  assert.ok(after.score > before.score && after.bscore > before.bscore, 'scores carried on');
  assert.equal(after.score - before.score, after.tick - before.tick, 'a score that counts ticks lost none and gained none');
  // "leave me alone" survives: A's ask is still refused; B's is taken
  const goalsBefore = b.get(guide.id).goal;
  a.ask(guide.id, 'follow', { seat: a.seat }); await clock.wait(400);
  assert.notEqual(b.get(guide.id).goal?.args?.seat, a.seat, 'the guide still leaves A alone');
  console.log(`   the answer the asking body got: advance ${a.me.adv === 2} by ${a.me.by === 2 ? 'ai' : 'floor/local'}`);
  if (/answers/.test(answer)) { assert.equal(a.me.by, 2, 'the AI answer, not the floor'); assert.equal(a.me.adv, 1, 'advance: false as the AI said (the floor says true)'); } else { assert.equal(a.me.by, 1); assert.equal(a.me.adv, 2); }
});


test('a sixty-second drop retries promptly while playing offline', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t), r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Return'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(60000); assert.equal(a.net.offline, true); assert.equal(a.status, 'playing');
  r.network.up = true; await clock.wait(6500);
  assert.equal(a.net.link, 'online'); assert.equal(a.status, 'playing'); assert.equal(a.net.rulesHosting, false);
});


test('the browser online event retries a pending offline connection immediately', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t), r = rig(L, compiled);
  const previous = globalThis.addEventListener; let online;
  globalThis.addEventListener = (type, fn) => { if (type === 'online') online = fn; };
  t.after(() => { if (previous) globalThis.addEventListener = previous; else delete globalThis.addEventListener; });
  const a = openRoom({ net: { config: cfg('Return'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(60000); assert.equal(a.net.offline, true);
  r.network.up = true; online(); await clock.wait(100);
  assert.equal(a.net.link, 'online'); assert.equal(a.status, 'playing');
});

const pulses = s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: { tick: f.u32() } }, commands: { done: {}, ask: {} }')
  .replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, { tick: world.tick });")
  .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}').replace('seconds: 3', 'seconds: 120');
/** What a third page is sent: every snapshot's tick in order of arrival, and how often each tick's effects came. */
function watch(socket) {
  const seen = { ticks: [], effects: new Map() };
  const deliver = socket.onmessage;
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'snap') seen.ticks.push(m.k);
    if (m.t === 'ev' && m.k === 'fx') seen.effects.set(m.d[0], (seen.effects.get(m.d[0]) ?? 0) + 1);
    deliver.call(socket, e);
  };
  return seen;
}
const rewind = (ticks) => ticks.reduce((worst, k, i) => Math.max(worst, i ? Math.max(...ticks.slice(0, i)) - k + 1 : 0), 0);

for (const hz of [20, 30, 60]) for (const how of ['yields', 'closes']) test(`a ${hz}-tick host that ${how} hands on its last tick: no page goes back and no effect plays twice`, async t => {
  const { L, compiled, openRoom } = await featureKit(`handover-${hz}-${how}`, 'browser', pulses, hz);
  const clock = virtualTime(t);
  // Ten moments across a tick and across the snapshot's allowance, each in a room of its own.
  for (let trial = 0; trial < 10; trial++) {
    // The relay's word takes 40 ms to come back: several ticks at any of these rates.
    const r = rig(L, compiled, true, 40);
    const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
    const a = open('First'); await clock.wait(300); const b = open('Second'); const c = open('Third');
    await clock.wait(1500 + trial * 7);
    assert.equal(a.net.rulesHosting, true);
    const seen = watch(r.sockets[2]); const from = r.sockets[0].sent.length;
    if (how === 'yields') assert.equal(a.net.handOff(), true); else a.close();
    await clock.wait(2500);
    const last = r.sockets[0].sent.slice(from).filter(m => ['ckpt', 'yield', 'bye'].includes(m.t)).map(m => m.t);
    assert.deepEqual(last.slice(0, 2), ['ckpt', how === 'yields' ? 'yield' : 'bye'], 'the checkpoint is on the wire before the role is given up');
    assert.equal(b.net.rulesHosting || c.net.rulesHosting, true); assert.equal(a.net.rulesHosting, false);
    assert.equal(rewind(seen.ticks), 0, `trial ${trial}: snapshot ticks ${seen.ticks.slice(0, 12)}`);
    assert.ok(seen.ticks.length > hz * 2, 'the next host carries on');
    assert.deepEqual([...seen.effects.values()].filter(n => n !== 1), [], 'each tick\'s effects arrive once');
    const ticks = [...seen.effects.keys()];
    for (let n = 1; n < ticks.length; n++) assert.equal(ticks[n], ticks[n - 1] + 1, 'and no tick\'s effects are missing');
    assert.equal(r.room.stats.drops, 0);
    if (how === 'yields') a.close(); b.close(); c.close(); r.stop();
  }
});

test('a yield the relay refuses costs nothing: the host carries on with every tick and effect in order', async t => {
  const { L, compiled, openRoom } = await featureKit('yield-refused', 'browser', pulses, 60);
  const clock = virtualTime(t); const r = rig(L, compiled, true, 40);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(300);
  // The second page cannot host, so nobody can take the role.
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null, rulesHost: { mode: 'server', offline: false } } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500);
  const seen = watch(r.sockets[1]); const rounds = []; b.on('round', e => rounds.push(e.n));
  for (let n = 0; n < 3; n++) { assert.equal(a.net.handOff(), true); await clock.wait(700); }
  assert.equal(a.net.rulesHosting, true); assert.equal(r.room.stats.promotions, 0);
  assert.equal(rewind(seen.ticks), 0);
  assert.ok(seen.ticks.length >= 120, `${seen.ticks.length} snapshots in 2.1 s`);
  const ticks = [...seen.effects.keys()];
  assert.ok(ticks.length >= 120);
  for (let n = 1; n < ticks.length; n++) assert.equal(ticks[n], ticks[n - 1] + 1);
  assert.deepEqual([...seen.effects.values()].filter(n => n !== 1), []);
  assert.deepEqual(rounds, [], 'no round is announced again');
  assert.equal(r.room.stats.drops, 0);
});

test('a host that reconnects to a restarted relay says the round, roster and shared state again as rules output', async t => {
  const { L, compiled, openRoom } = await featureKit('relay-restart', 'browser', s => s.replace('seconds: 3, breakSeconds: 1', 'seconds: 4, breakSeconds: 1')
    .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}').replace('on: { answer(world, e) {', 'on: { roundStart(world) { world.shared.answers += 7; }, answer(world, e) {'));
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  // The same wait before each page knocks again, so the host, whose socket dropped first, is back first.
  t.mock.method(Math, 'random', () => 0.37);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); await clock.wait(800); const b = open('Second');
  let c = null;
  t.after(() => { a.close(); b.close(); c?.close(); r.stop(); });
  // Into the second round, so a relay that knew nothing would leave a replica on the first.
  await clock.wait(6500);
  assert.equal(a.net.rulesHosting, true); assert.equal(a.round.n, 2); assert.equal(a.round.phase, 'live'); assert.equal(b.round.n, 2);
  const shared = structuredClone(a.shared); assert.equal(shared.answers, 14);
  r.restart();
  await clock.wait(2500);
  assert.equal(a.net.connected, true); assert.equal(b.net.connected, true); assert.equal(a.net.rulesHosting, true); assert.equal(b.net.rulesHosting, false);
  assert.equal(a.round.n, 2, 'still the round it was');
  const held = { round: [r.room.lastRound?.n, r.room.lastRound?.phase], roster: r.room.lastRoster?.length, keys: [...r.room.state.keys()] };
  assert.deepEqual(held, { round: [a.round.n, a.round.phase], roster: a.roster.length, keys: ['shared'] }, 'the relay holds what the host holds');
  assert.equal(r.room.stats.drops, 0, 'nothing the host said was taken for a player\'s');
  assert.deepEqual([b.round.n, b.round.phase], [a.round.n, a.round.phase]); assert.deepEqual(b.shared, shared);
  assert.ok(Math.abs(b.round.endsAt - a.round.endsAt) < 100, 'the replica counts down with the host');
  c = open('Third'); await clock.wait(300);
  const welcome = r.sockets.at(-1); assert.equal(welcome.readyState, 1);
  assert.deepEqual([c.round?.n, c.round?.phase], [a.round.n, a.round.phase], 'a later joiner is welcomed with the live round');
  assert.deepEqual(c.shared, a.shared); assert.equal(c.roster.length, a.roster.length);
});

test('legacy speech keeps its published envelope even with arbitrary extra data', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const view = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => view.close());
  const heard = [];
  view.on('say', e => heard.push(e));
  await clock.wait(600);
  r.room.broadcast({ t: 'ev', from: 0, k: 'say', d: { text: 'hello', line: 42, slot: 900, seat: 900 } });
  await clock.wait(10);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].text, 'hello');
  assert.equal(heard[0].line, undefined);
  assert.equal(heard[0].seat, 0);
  assert.equal(heard[0].slot, -1);
});

for (const hz of [20, 30, 60]) for (const delay of [50, 150, 300]) test(`prediction: ${hz} ticks, ${delay} ms round trip, fresh input answers within a frame`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz);
  const clock = virtualTime(t), r = rig(L, compiled, false, delay / 2, delay / 2);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  await clock.wait(5000);
  const start = a.me.pos;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(16);
  assert.ok(a.me.pos.x > start.x, 'movement on the first drawn frame');
  const samples = [];
  for (let n = 0; n < 90; n++) { await clock.wait(16); samples.push(a.me.pos.x); }
  const backwards = samples.slice(1).filter((x, n) => x < samples[n] - 0.001);
  assert.equal(backwards.length, 0, `ordinary movement never rubber-bands: ${backwards.length} frames`);
  a.input({ ax: 0, ay: 0 }); await clock.wait(1500);
  const authoritative = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - authoritative) < 0.001, 'server result wins after input settles');
  assert.equal(r.host.core.stats.errors, 0);
});

test('prediction: a late press stays predicted once until the authoritative press catches up', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'press');
  const clock=virtualTime(t);let extra=0;
  const r=rig(L,compiled,false,45,m=>m.t==='in'?45+extra:45);t.after(()=>r.stop());
  const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(5000); extra=180;
  a.input({ax:0,jump:true});await clock.wait(60);
  assert.equal(a.me.motion.jumps,1);
  for(let i=0;i<20;i++){await clock.wait(16);assert.equal(a.me.motion.jumps,1,'a snapshot neither removes nor doubles the late press');}
  extra=0;await clock.wait(1000);
  assert.equal(a.me.motion.jumps,1);assert.equal(r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[8][0],1);
});

for (const hz of [20, 60]) for (const delay of [150, 300]) test(`prediction clock: steering is not jitter at ${hz} Hz and ${delay} ms`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz);
  const clock = virtualTime(t), r = rig(L, compiled, false, delay / 2, delay / 2);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  const probe = globalThis.__homieNet.probe.prediction;
  await clock.wait(5000);
  const initial = probe();
  for (let n = 0; n < 80; n++) {
    await clock.wait(250);
    const p = probe();
    assert.equal(p.rebases, initial.rebases, 'a steady connection does not keep rebasing');
    assert.ok(p.lead < 2, `the clock's steering did not invent ${p.lead} ticks of network jitter`);
  }
});


for (const hz of [20, 60]) test(`prediction: overlapping corrections under dropped input at ${hz} Hz slow forward movement without reversing it`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'press');
  const clock = virtualTime(t); let drops = 0, snapshots = 0;
  const r = rig(L, compiled, false, m => 300 + (m.t === 'snap' ? [0, 20, -20, 15, -15][snapshots++ % 5] : 0), m => m.t === 'in' && drops-- > 0 ? null : 300);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  await clock.wait(12000);
  drops = 2; a.input({ ax: 127 });
  let previous = a.me.pos.x, backwards = 0;
  for (let n = 0; n < 190; n++) {
    await clock.wait(16);
    const x = a.me.pos.x;
    if (x - previous < -0.01) backwards++;
    previous = x;
  }
  const p = globalThis.__homieNet.probe.prediction();
  assert.ok(p.count > 1, 'the dropped steps caused overlapping corrections');
  assert.equal(backwards, 0, JSON.stringify(p));
  a.input({ ax: 0 }); await clock.wait(2000);
  const server = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - server) < 0.001, 'the complete correction still reaches server truth');
});

for (const hz of [20, 60]) for (const seed of [417, 1, 42, 43, 60, 2026]) test(`prediction: ${hz} Hz jitter and loss remain steady, seed ${seed}`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'press');
  const clock = virtualTime(t); let rng = seed;
  const leg = hz === 20 ? 300 : 150;
  const random = () => { rng = (Math.imul(rng,1664525)+1013904223)>>>0; return rng/4294967296; };
  const shape = m => ['in','snap'].includes(m.t) ? random() < .1 ? null : leg*(.75+random()*.5) : leg;
  const r = rig(L, compiled, false, shape, shape); t.after(()=>r.stop());
  const a = openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(12000); const start = globalThis.__homieNet.probe.prediction();
  a.input({ax:127}); let x=a.me.pos.x;
  for(let n=0;n<750;n++) {
    await clock.wait(16); const next=a.me.pos.x, p=globalThis.__homieNet.probe.prediction();
    assert.equal(p.rebases,start.rebases,JSON.stringify(p));
    assert.ok(next>=x-.01,`backward ${next-x}: ${JSON.stringify(p)}`); x=next;
  }
  a.input({ax:0}); await clock.wait(3000);
  const server = r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x-server)<.001,'the eased path converges to server truth after stopping');
});

for (const hz of [20, 30, 60]) for (const delay of [50, 150, 300]) for (const ax of [0, 127]) for (const phase of [0, 19]) test(`prediction: unseen pushes stay continuous on uneven frames at ${hz} Hz, ${delay} ms, input ${ax}, phase ${phase}`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'push');
  const clock = virtualTime(t);
  let rng = 417;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const lag = m => ['in', 'snap'].includes(m.t) ? random() < .1 ? null : delay / 2 * (.75 + random() * .5) : delay / 2;
  const r = rig(L, compiled, false, lag, lag); t.after(() => r.stop());
  const other = openRoom({ timers: false, net: { config: cfg('Bo'), WebSocketImpl: r.socket(), post: null } }); t.after(() => other.close());
  await clock.wait(200);
  const a = openRoom({ timers: false, net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } }); t.after(() => a.close());
  for (let n = 0; n < 1500; n++) { await clock.wait(16); const input = { ax: n < 750 ? 0 : ax }; other.input(input); a.input(input); void other.me; void a.me; }
  await clock.wait(phase);
  a.command('bump'); let previous = a.me.pos, probeBefore = globalThis.__homieNet.probe.prediction();
  const bad = [];
  for (let n = 0; n < 120; n++) {
    const ms = [28, 5, 17, 33][n % 4]; await clock.wait(ms);
    const pos = a.me.pos, distance = Math.hypot(pos.x - previous.x, pos.y - previous.y);
    if (distance > 21 * ms / 1000 + .05) bad.push({ n, ms, distance, previous, pos, probeBefore, probe: globalThis.__homieNet.probe.prediction() });
    previous = pos; probeBefore = globalThis.__homieNet.probe.prediction();
  }
  assert.ok(a.me.pos.y > 2, 'the authoritative push wins');
  assert.deepEqual(bad, [], 'catch-up and its blend form one continuous path');
});

// Compile each fixture once; every case still opens fresh hosts, views and clocks.
const predictionKits = new Map();
async function predictionKit(mode, hz) {
  const key = `${mode}-${hz}`;
  if (!predictionKits.has(key)) predictionKits.set(key, coinDashKit(mode, false, hz, 'push'));
  return predictionKits.get(key);
}

// Same delay/loss/host matrix as the Chrome soak, on a clock independent of runner load.
for (const hz of [20, 30, 60]) for (const mode of ['server', 'browser'])
for (const delay of hz === 20 && mode === 'server' ? [50, 90, 150, 300] : [50, 150, 300])
for (const loss of delay === 90 ? [0] : [.02, .10])
for (const seed of hz === 60 && mode === 'browser' && delay === 300 && loss === .1 ? [417, 1, 42, 43, 60, 2026] : [417])
test(`prediction release matrix: ${hz} Hz ${mode}, ${delay} ms, ${loss} loss, seed ${seed}`, async t => {
  const { L, compiled, openRoom } = await predictionKit(mode, hz);
  const clock = virtualTime(t);
  const shape = predictionShaper({ delay, loss, seed, jitter: delay !== 90 });
  const r = rig(L, compiled, mode === 'browser', (m, link) => shape(m, `${link}:down`), (m, link) => shape(m, `${link}:up`));
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  assert.equal(b.status, 'playing');
  assert.equal(a.net.rulesHosting, mode === 'browser');
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  a.input({ ax: 127 }); b.input({ ax: 127 });
  let previous = b.me.pos;
  await clock.wait(16);
  assert.ok(b.me.pos.x > previous.x, 'fresh input moves on the first drawing frame');
  previous = b.me.pos;
  const failures = [];
  for (let n = 0; n < 750; n++) {
    const ms = [16, 16, 33, 5][n % 4];
    await clock.wait(ms);
    const pos = b.me.pos;
    if (pos.x < previous.x - .001 || Math.hypot(pos.x - previous.x, pos.y - previous.y) > 21 * ms / 1000 + .05)
      failures.push({ n, ms, previous, pos, probe: probe() });
    previous = pos;
  }
  t.diagnostic(JSON.stringify({ hz, mode, delay, loss, seed, corrections: probe().count, catches: probe().catches, backwards: failures.length }));
  assert.deepEqual(failures, [], 'steady drawn motion is forward and continuous');
  assert.equal(probe().rebases, start.rebases);
  b.command('bump');
  for (let n = 0; n < 120; n++) {
    const ms = [28, 5, 17, 33][n % 4]; await clock.wait(ms);
    const pos = b.me.pos;
    assert.ok(Math.hypot(pos.x - previous.x, pos.y - previous.y) <= 21 * ms / 1000 + .05, 'push remains continuous');
    previous = pos;
  }
  assert.ok(b.me.pos.y > 2, 'authoritative push wins');
  assert.equal(probe().snaps, 0);
  a.input({ ax: 0 }); b.input({ ax: 0 }); await clock.wait(4000);
  const stopped = b.me.pos;
  const authoritative = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3];
  assert.ok(Math.hypot(stopped.x - authoritative[0], stopped.y - authoritative[1]) < .001, 'drawn correction converges to host truth');
  await clock.wait(1000);
  assert.ok(Math.hypot(b.me.pos.x - stopped.x, b.me.pos.y - stopped.y) < .001, 'correction settles');
});

test('prediction catch-up boundary: replaced history stays forward, seed 1', async t => {
  const seed = 1;
  const hz = 60, delay = 300;
  const { L, compiled, openRoom } = await predictionKit('browser', hz);
  const clock = virtualTime(t);
  // Preserve the failing release shaper's shared seeded stream here: virtual time fixes
  // its packet order. Seed 1 crosses replaced history by -0.105 m before the fix.
  let rng = seed;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const shape = m => ['in', 'snap'].includes(m.t) ? random() < .1 ? null : delay / 2 * (.75 + random() * .5) : delay / 2;
  let drop = 0;
  const r = rig(L, compiled, true, (m, link) => shape(m, `${link}:down`), (m, link) => {
    if (link === 1 && m.t === 'in' && drop > 0) { drop--; return null; }
    return shape(m, `${link}:up`);
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe(); drop = 1;
  b.input({ ax: 127 });
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 250; n++) {
    const ms = [16, 33, 5, 17][n % 4]; await clock.wait(ms);
    b.input({ ax: 127 });
    const x = b.me.pos.x;
    assert.ok(x - previous <= 21 * ms / 1000 + .05, 'catch-up remains continuous');
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    previous = x;
  }
  assert.equal(probe().rebases, start.rebases);
  assert.equal(probe().snaps, 0);
  assert.ok(probe().catches > start.catches, 'lost input must exercise catch-up');
  assert.deepEqual(backwards, [], 'catch-up must not cross a discontinuity between old and replaced history');
  b.input({ ax: 0 }); await clock.wait(4000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the correction still converges to the host');
});

test('prediction clock recalibration preserves the drawn pose on a delayed browser-host input path', async t => {
  const { L, compiled, openRoom } = await predictionKit('browser', 60);
  const clock = virtualTime(t);
  let extra = 0;
  const r = rig(L, compiled, true, 150, m => 150 + (m.t === 'in' ? extra : 0));
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  b.input({ ax: 127 }); await clock.wait(2000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  extra = 200;
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 750; n++) {
    await clock.wait(16); b.input({ ax: 127 });
    const x = b.me.pos.x;
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    assert.ok(x - previous <= 21 * .016 + .05, 'recalibration remains continuous');
    previous = x;
  }
  assert.ok(probe().rebases > start.rebases, 'changed input delay must exercise recalibration');
  assert.deepEqual(backwards, [], 'a clock change must not place the drawn body back at the old snapshot');
  extra = 0; b.input({ ax: 0 }); await clock.wait(5000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the corrected body converges to the host');
});

for (const mode of ['server', 'browser']) for (const hz of [20, 30, 60])
test(`prediction transport: ${mode} delivers a snapshot every ${hz} Hz tick on virtual time`, async t => {
  const { L, compiled, openRoom } = await predictionKit(mode, hz);
  const clock = virtualTime(t), r = rig(L, compiled, mode === 'browser');
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(2000);
  const firstTick = r.room.lastSnap.k, ticks = [];
  const socket = r.sockets[1], receive = socket.onmessage;
  socket.onmessage = event => {
    const frame = JSON.parse(event.data);
    if (frame.t === 'snap') ticks.push(frame.k);
    receive.call(socket, event);
  };
  await clock.wait(1000);
  assert.equal(r.room.lastSnap.k - firstTick, hz, 'the host keeps its configured rate on a punctual clock');
  assert.deepEqual(ticks, Array.from({ length: hz }, (_, n) => firstTick + n + 1), 'every completed tick reaches the replica exactly once');
});

test('prediction recalibration offset survives lossy reconciliation on server host', async t => {
  const mode = 'server';
  // A small explicit snap limit isolates the new correction from the carried clock
  // offset. The loaded Chrome regression clipped that offset with the default limit.
  const { L, compiled, openRoom } = await coinDashKit(mode, false, 60, 'push', { snapM: .5, catchM: 10 });
  const clock = virtualTime(t);
  let extra = 0;
  const shape = predictionShaper({ delay: 300, loss: .1, seed: 417 });
  const r = rig(L, compiled, mode === 'browser', (m, link) => shape(m, `${link}:down`), (m, link) => {
    const ms = shape(m, `${link}:up`);
    return ms === null ? null : ms + (m.t === 'in' ? extra : 0);
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  b.input({ ax: 127 }); await clock.wait(2000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  extra = 200;
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 750; n++) {
    await clock.wait(16); b.input({ ax: 127 });
    const x = b.me.pos.x;
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    assert.ok(x - previous <= 21 * .016 + .05, 'recalibration remains continuous');
    previous = x;
  }
  assert.ok(probe().rebases > start.rebases, 'changed input delay must exercise recalibration');
  assert.ok(probe().max <= .5, 'new errors stay inside the explicit snap limit');
  assert.equal(probe().snaps, 0, 'small reconciliation must not clip an existing clock correction');
  assert.deepEqual(backwards, [], 'a clock change must not place the drawn body back at the old snapshot');
  extra = 0; b.input({ ax: 0 }); await clock.wait(5000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the corrected body converges to the host');
  // The cap still applies to a genuinely new large authoritative displacement.
  const socket = r.sockets[1], receive = socket.onmessage;
  let shifted = false;
  socket.onmessage = event => {
    const frame = JSON.parse(event.data);
    if (frame.t === 'snap') {
      const own = frame.d[1].find(e => e[9] === b.seat);
      own[3][0] += 10; shifted = true;
    }
    receive.call(socket, { data: JSON.stringify(frame) });
  };
  await clock.wait(500);
  assert.ok(shifted);
  assert.ok(probe().snaps > 0, 'a new ten-metre correction still exceeds the snap limit');

});

test('3D facing takes a continuous unit arc through horizontal and vertical half turns', async () => {
  await coinDashKit();
  const blend = globalThis.__blendHeading;
  for (const [a,b] of [[{x:1,y:0,z:0},{x:-1,y:0,z:0}],[{x:0,y:0,z:1},{x:0,y:0,z:-1}],[{x:1,y:0,z:0},{x:0,y:0,z:1}]]) {
    let last=a;
    for(let i=1;i<=60;i++){const v=blend(a,b,i/60,3);assert.ok(Math.abs(Math.hypot(v.x,v.y,v.z)-1)<1e-6);assert.ok(Math.hypot(v.x-last.x,v.y-last.y,v.z-last.z)<.053);last=v;}
    assert.deepEqual(last,b);
  }
});

test('seat-or-solo uses a private rules round while full, then joins the server without uploading private state', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',true);
  const clock=virtualTime(t),r=rig(L,compiled);t.after(()=>r.stop());
  const guests=Array.from({length:8},(_,i)=>openRoom({net:{config:cfg('P'+i),WebSocketImpl:r.socket(),post:null}}));
  t.after(()=>guests.forEach(g=>g.close()));await clock.wait(800);
  const waiting=openRoom({fallback:'solo',net:{config:cfg('Waiting'),WebSocketImpl:r.socket(),post:null}});t.after(()=>waiting.close());
  await clock.wait(5200);
  assert.equal(waiting.net.full,true);assert.equal(waiting.net.seat,null);assert.equal(waiting.status,'offline');assert.ok(waiting.me,'private room has its own body');
  const before=waiting.me.pos.x,wire=r.sockets.at(-1),sent=wire.sent.length;
  waiting.input({ax:127,ay:0});await clock.wait(500);assert.ok(waiting.me.pos.x>before);
  assert.equal(wire.sent.slice(sent).filter(m=>['in','snap','ckpt','state','round'].includes(m.t)).length,0,'private progress stays local');
  guests[0].close();await clock.wait(1500);
  assert.equal(waiting.status,'playing');assert.notEqual(waiting.net.seat,null);assert.equal(waiting.seat,waiting.net.seat);assert.ok(waiting.me);
  assert.equal(waiting.net.rulesHosting,false,'the waiting browser never takes over the online room');
});


test('3D prediction clamps vertical bounds and draws animation from the catch-up pose', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pose');
  const clock=virtualTime(t),r=rig(L,compiled,false,150,150);t.after(()=>r.stop());
  const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(12000);
  a.input({az:127});await clock.wait(500);
  assert.ok(Math.abs(a.me.pos.z-1.3)<.001,'predicted feet stop below the ceiling by the body height');
  a.input({az:-127});await clock.wait(500);
  assert.ok(Math.abs(a.me.pos.z)<.001,'predicted feet stop on the lower bound');
  a.input({az:0});await clock.wait(1500);a.command('launch');
  let catches=0, airborne=0;
  for(let i=0;i<100;i++){
    await clock.wait(16);const me=a.me,p=globalThis.__homieNet.probe.prediction();
    if(p.catchTick===null)continue;
    catches++;
    const age=Math.floor(p.catchTick)-me.motion.launch;
    assert.equal(me.motion.phase,Math.min(20,age),'motion belongs to the drawn historical tick');
    assert.equal(me.grounded,age>=10,'landing state belongs to the drawn path');
    if(age>=1 && age<9){airborne++;assert.equal(me.vel.z,1,'airborne velocity is not replaced by the present landing');}
  }
  assert.ok(catches>3 && airborne>0,'the unseen launch exercised airborne catch-up');
  assert.equal(r.host.core.stats.errors,0);
});

test('a late fast knock does not double its drawn speed while a large correction fades', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'knock');
  let muteUntil = 0;
  const clock = virtualTime(t), r = rig(L, compiled, false, m => m.t === 'snap' && Date.now() < muteUntil ? null : 150, 150); t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } }); t.after(() => a.close());
  await clock.wait(12000); muteUntil = Date.now() + 240; a.command('launch');
  let previous = a.me.pos.x, largest = 0, caught = false;
  for (let i = 0; i < 240; i++) {
    await clock.wait(16); const next = a.me.pos.x, p = globalThis.__homieNet.probe.prediction();
    largest = Math.max(largest, Math.abs(next - previous)); previous = next;
    caught ||= p.catchTick !== null;
  }
  t.diagnostic(`largest frame movement: ${largest} m`);
  assert.ok(caught, 'the delayed impulse requires catch-up');
  assert.ok(largest < .60, `one 16 ms frame moved ${largest} m`);
  const authoritative = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - authoritative) < .001, 'the correction converges after the knock ends');
  assert.equal(globalThis.__homieNet.probe.prediction().snaps, 0);
});

for (const phase of [5, 17, 33, 45]) test(`fresh 3D input preserves the pose at a ${phase} ms tick phase`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'pose');
  const clock = virtualTime(t), r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(12000 + phase);
  const before = a.me.pos;
  a.input({ az: 127 });
  assert.deepEqual(a.me.pos, before, 'changing the preview cannot apply new input to time already elapsed');
  await clock.wait(5);
  assert.ok(a.me.pos.z > before.z, 'the new input still moves on the first drawing frame');
  assert.ok(a.me.pos.z - before.z <= .15, 'five milliseconds cannot draw most of a fifty-millisecond step');
});


test('spatial snapshots reach real views, preserve prediction, recover a lost keyframe and reconnect', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, false, {}, 0);
  const clock = virtualTime(t);
  let lost = false;
  const r = rig(L, compiled, false, (m, link) => {
    if (link === 0 && m.t === 'snap' && Array.isArray(m.d) && m.k > 30 && !lost) { lost = true; return null; }
    return 0;
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  const prediction = globalThis.__homieNet.probe.prediction;
  const b = openRoom({ net: { config: cfg('Bo'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(600);
  assert.equal(a.status, 'playing'); assert.equal(b.status, 'playing');
  const visible = () => { const ids = []; a.each('runner', e => ids.push(e.id)); return ids; };
  assert.deepEqual(visible(), [a.me.id]);
  const start = a.me.pos.x;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(2800);
  assert.equal(lost, true);
  assert.ok(a.me.pos.x > start + 1, 'own prediction keeps moving through deltas and a lost keyframe');
  assert.deepEqual(visible(), [a.me.id]);
  const seat = a.seat;
  r.sockets[0].cut();
  for (let i = 0; i < 60 && !a.net.connected; i++) await clock.wait(50);
  assert.equal(a.net.connected, true);
  // Drop the next periodic keyframe: the welcome alone must seed the new socket.
  const nextSocket = r.sockets.at(-1);
  const incoming = nextSocket.onmessage;
  nextSocket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.t === 'snap' && Array.isArray(m.d)) return;
    incoming?.(event);
  };
  await clock.wait(150);
  assert.ok(r.host.tick - prediction().serverTick <= 1, 'new socket deltas advance the view immediately');
  const own = r.host.core.snapshot()[1].find(e => e[9] === seat);
  assert.ok(Math.abs(a.me.pos.x - own[3][0]) < 1, 'welcome baseline reconciles immediately, before another keyframe');
  assert.equal(a.seat, seat); assert.equal(a.status, 'playing');
  assert.deepEqual(visible(), [a.me.id]);
  assert.equal(r.host.core.stats.errors, 0);
});
