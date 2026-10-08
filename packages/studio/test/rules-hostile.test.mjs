/**
 * Hostile and careless rules against the wall (rules/pack.ts "THE BOUNDARY", rules/core.ts, rules/host.ts,
 * rules/guard.ts, lib/rules-guard.mjs; rooms-milestone-1-design.md sections 4.3 and 10). A game's rules are written by
 * an AI for somebody who is not a programmer, and they run on the server beside other rooms. Whatever such a module
 * does, three things must hold, and every test here is one way of trying to break one of them:
 *
 *   A ROOM IS NEVER FROZEN. Nothing a module hands the runtime can throw outside the try that catches a handler, and
 *   a tick that fails for any reason, the runtime's own included, never takes the timer chain down: a room that is
 *   running always has exactly one timer pending, and a room that is not has none.
 *
 *   NO CODE OF THE RULES RUNS OUTSIDE A HANDLER. The runtime reads what a module hands it as plain data: no `valueOf`,
 *   `toString`, `toJSON`, `Symbol.toPrimitive`, getter or iterator is ever called by it, even for a module that never
 *   went through the build's wall.
 *
 *   THE BUDGET IS HONEST. Every call charges for the work it does before it does it, so no module makes a tick slow
 *   without the budget stopping it; and a room whose ticks fail or run slow ends after seconds of the clock, not after
 *   a number of ticks.
 *
 * The first cases are the ones an independent review of this release found (a room frozen by a list that was handed
 * an object, a `valueOf` run with the counter off, a query that copied every field of everything it found). The rest
 * are their relatives, found by going through every place the runtime touches a value from the rules and every call a
 * module can make.
 * Run: node --test packages/studio/test/rules-hostile.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { smokeRun } from '../lib/rules-build.mjs';
import { COIN_DASH, COIN_MAP, fakeClock, hostRig, loadGame, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-hostile-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const MAP = { bounds: { min: [-30, -30], max: [30, 30] }, boxes: [{ min: [10, 10], max: [11, 11] }], spots: { start: [[0, 0]] } };
/**
 * A small game with the planted code in it. A `runner` is the player's body (the server moves it, and `think` steers
 * it when its player is away); `rock` is a second kind for the cases that need many entities.
 */
const game = ({ fields = '', tick = '', think = 'return { ax: 0, ay: 0 };', kinds = '', room = '', shapes = 'events: { poke: { n: f.u8() } }, commands: { nudge: { n: f.u8() } }, effects: { ding: {} }', move = 'runner(body, input, ctx) {}', top = '', asks = '', shared = '', on = '', commands = '' }) => ({
  rules: `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
${top}
export default defineRules({ contract: 2, space: { dims: 2 }, move, shapes: { ${shapes} },
  entities: { runner: { player: { away: 'think', leave: 'bot' }, fields: { score: f.u16({ score: true }), ${fields} }, motion: {}, input: { ax: f.i8(), ay: f.i8() },
    body: { shape: 'circle', radius: 0.5, maxSpeed: 6 },
    tick(world, self) { ${tick} },
    think(world, self) { ${think} }, on: { ${on} }, commands: { ${commands} } }, ${kinds} },
  shared: { ${shared} }, ${asks} room: { bots: { keep: 2 }, ${room} join(ctx, p) { return { kind: 'runner', at: { x: 0, y: 0, z: 0 } }; } }, map: './map' });`,
  move: `import { defineMove } from '@homie-rocks/studio/rules';\nexport const move = defineMove({ ${move} });`,
});
let made = 0;
/** The planted game through the real build wall and into the real host runtime. `refused`: the lines the build refused it with, or null. (A budget of a million units a tick unless a case names its own: room enough for a case to build what it plants before it reaches the line that matters.) */
async function plant(parts, { budget = 1_000_000, seats = 4, host = {}, clock = undefined } = {}) {
  made += 1;
  let L;
  try { L = await loadGame(scratch, writeGame(scratch, `g${made}`, game(parts)), `g${made}`); } catch (error) { return { refused: String(error.message), L: null, rig: null, c: null }; }
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(MAP, 'main'), seats, settings: L.R.roomSettings(budget ? { budget: { tick: budget } } : {}).settings });
  const rig = hostRig(L, c, { host, clock });
  rig.join(0);
  return { refused: null, L, rig, c };
}
/** Run ticks one by one on the test's clock. Returns the real time the slowest took, and whatever escaped a tick (nothing may). */
function drive(rig, ticks) {
  let slowest = 0; let escaped = null;
  for (let i = 0; i < ticks && !escaped; i += 1) { const t0 = performance.now(); try { rig.ticks(1); } catch (error) { escaped = error; } slowest = Math.max(slowest, performance.now() - t0); }
  return { slowest, escaped };
}
const stats = (rig) => rig.host.core.stats;
/** The line every room must be under: a tick of a small game, however its rules try, in real milliseconds. Hundreds of times what any of these takes when the budget holds, and far under what each took before it did. */
const SLOW_MS = 400;

/* ================================================================== a room is never frozen */

test('a list handed an object that cannot become a number freezes nothing: the room keeps its beat and its one timer', async () => {
  // The review's case. From tick 100 on (after the build's own three-second run) a handler pushes an object with no
  // usable valueOf or toString into a list of numbers. Before, that threw outside the handler's try, out of the
  // timer's callback, and the room stood still for good with its players connected.
  const clock = fakeClock();
  const uncaught = [];
  const guarded = { now: clock.now, clearTimer: clock.clearTimer, setTimer: (fn, ms) => clock.setTimer(() => { try { fn(); } catch (error) { uncaught.push(error); } }, ms) };
  const { rig, refused } = await plant({ fields: 'bag: f.list(f.u8(), 8)', tick: `if (world.tick >= 100) self.bag.push({ label: 1, toString: 1, valueOf: 1 });` }, { clock, host: { clock: guarded } });
  assert.equal(refused, null, 'a plain value under the name toString is only a field with an odd name: it builds');
  for (let ms = 0; ms < 20_000; ms += 10) clock.advance(10);
  assert.deepEqual(uncaught, [], 'nothing was thrown out of the timer');
  assert.equal(rig.host.tick, 400, 'twenty seconds at twenty ticks a second');
  assert.equal(rig.sent.filter((m) => m.t === 'snap').length, 400, 'a snapshot for every one of them');
  assert.equal(rig.host.running, true);
  assert.equal(clock.timers.length, 1, 'exactly one timer is pending');
  assert.deepEqual(rig.ended, []);
  assert.deepEqual(rig.ents(0).find((e) => e.seat === 0).fields[1], [0, 0, 0, 0, 0, 0, 0, 0], 'what is not a number is the zero of the type, and the list is held to its eight entries');
});

test('what think returns, what a handler throws and what move leaves behind are read inside the handler\'s try', async () => {
  // `think` returns an object that cannot become a number for an input field.
  const a = await plant({ think: `return { ax: { valueOf: 1, toString: 1 }, ay: 5 };` });
  const ran = drive(a.rig, 5);
  assert.equal(ran.escaped, null);
  assert.equal(a.rig.host.tick, 5);
  assert.equal(stats(a.rig).errors, 0);
  // `think` returns nothing at all, a text, a list.
  for (const back of ['', 'return 7;', 'return "left";', 'return [1, 2];', 'return world;', 'return self;']) {
    const b = await plant({ think: back });
    assert.equal(drive(b.rig, 3).escaped, null, back);
    assert.equal(stats(b.rig).errors, 0, back);
  }
  // A handler throws something that is not an Error: a map field (an object with no prototype), an object whose
  // message is one, a list, nothing. Turning any of them into a line for the log must not throw in its turn.
  for (const thrown of ['self.bag', '{ message: self.bag }', '[self.bag]', 'undefined', 'null', '7', '"plain words"', 'world', '{ message: 7 }']) {
    const t = await plant({ fields: 'bag: f.map(f.u8(), 4)', tick: `throw ${thrown};` });
    const r = drive(t.rig, 3);
    assert.equal(r.escaped, null, `throw ${thrown}`);
    assert.equal(stats(t.rig).errors, 6, `throw ${thrown}: counted for each of the two bodies on each tick`);
    assert.match(stats(t.rig).lastError, thrown === '"plain words"' ? /^runner\.tick: plain words$/ : /^runner\.tick: a handler threw a value that is not an Error$/, `throw ${thrown}`);
  }
  // `move` leaves anything at all in the body it was handed.
  for (const left of ['body.pos = { x: { valueOf: 1 }, y: [1], z: "up" };', 'body.pos = null; body.vel = 7; body.heading = "north"; body.grounded = {};', 'body.pos = [1, 2];', 'ctx.map.sweep(body, { x: { valueOf: 1 }, y: [2] });', 'ctx.map.sweep(null, null);', 'ctx.map.sweep(ctx, body);']) {
    const m = await plant({ move: `runner(body, input, ctx) { ${left} }` });
    assert.equal(drive(m.rig, 3).escaped, null, left);
    const e = m.rig.ents(0)[0];
    assert.ok(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y), `${left}: the body is still somewhere`);
  }
});

test('the tick loop cannot break: whatever throws, a running room has one timer pending and a stopped one has none', async () => {
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const c = L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings({}).settings, seats: 8 });
  // A seeded dice, so a run that fails can be run again.
  const dice = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let checks = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const roll = dice(seed);
    const clock = fakeClock();
    const uncaught = [];
    const ended = [];
    // Everything the runtime is handed may throw: the way to send a frame, the log, the callbacks, the clock itself.
    const odds = { send: seed % 4 === 0 ? 0.6 : 0.03, log: 0.2, cb: 0.5, now: seed % 5 === 0 ? 0.002 : 0, timer: seed % 7 === 0 ? 0.01 : 0, step: seed % 3 === 0 ? 0.05 : 0, clear: seed % 6 === 0 ? 0.3 : 0 };
    const maybe = (p, what) => { if (roll() < p) throw new Error(`planted: ${what}`); };
    const host = L.H.createHost({
      game: 'fuzz', build: 'b1', compiled: c,
      send: () => maybe(odds.send, 'send'),
      log: () => maybe(odds.log, 'log'),
      random: roll,
      onPause: () => maybe(odds.cb, 'onPause'), onResume: () => maybe(odds.cb, 'onResume'),
      onEnd: (why) => { ended.push(why); maybe(odds.cb, 'onEnd'); },
      clock: {
        now: () => { maybe(odds.now, 'now'); return clock.now(); },
        setTimer: (fn, ms) => { maybe(odds.timer, 'setTimer'); return clock.setTimer(() => { try { fn(); } catch (error) { uncaught.push(error); } }, ms); },
        clearTimer: (id) => { clock.clearTimer(id); maybe(odds.clear, 'clearTimer'); },
      },
    });
    // The core itself may throw in the middle of a step, as a mistake in the runtime would.
    const step = host.core.step;
    host.core.step = (inputs) => { maybe(odds.step, 'step'); return step(inputs); };
    const rule = (when) => {
      checks += 1;
      const f = host.facts();
      assert.equal(clock.timers.length, host.running ? 1 : 0, `seed ${seed}, ${when}: running=${host.running} paused=${host.paused} ended=${f.ended} with ${clock.timers.length} timers pending`);
      assert.equal(f.armed, host.running, `seed ${seed}, ${when}: the runtime's own count agrees`);
      assert.deepEqual(uncaught, [], `seed ${seed}, ${when}: nothing escaped a timer`);
    };
    const seats = new Set();
    for (let i = 0; i < 400; i += 1) {
      const r = roll();
      const seat = Math.floor(roll() * 4);
      let what = 'time';
      // A caller of the runtime never sees it throw either: the relay calls `frame` for every message.
      try {
        if (r < 0.08) { what = 'join'; seats.add(seat); host.frame({ t: 'join', peer: { id: `c${seat}`, seat, name: `P${seat}`, occ: i } }); }
        else if (r < 0.14) { what = 'leave'; seats.delete(seat); host.frame({ t: 'leave', seat }); }
        else if (r < 0.17) { what = 'free'; seats.delete(seat); host.frame({ t: 'free', seat }); }
        else if (r < 0.3) { what = 'in'; host.frame({ t: 'in', from: seat, e: host.epoch, k: host.tick + 1, s: [[0, Math.floor(roll() * 255) - 127, 0, roll() * 20, roll() * 20, 0, 0, 0, 0, 1, 0, 0]], r: 0 }); }
        else if (r < 0.33) { what = 'ev'; host.frame({ t: 'ev', from: seat, k: 'say', d: { text: 'hi' } }); }
        else if (r < 0.35) { what = 'policy'; host.frame({ t: 'policy', policy: { bots: roll() < 0.5 ? 'off' : 'fill', level: 3, levelMax: 5 } }); }
        else if (r < 0.37) { what = 'pause'; host.pause(); }
        else if (r < 0.39) { what = 'resume'; host.resume(); }
        else if (r < 0.41) { what = 'tickNow'; host.tickNow(); }
        else if (r < 0.42) { what = 'garbage'; host.frame({ t: 'in', from: seat, e: host.epoch, k: {}, s: [[{}, [], null]], r: 'x' }); host.frame({ t: 'join', peer: 7 }); host.frame({ t: 'ev', from: seat, k: 'cmd', d: [{}, {}] }); host.frame(null); }
        else clock.advance(Math.floor(roll() * 400));
      } catch (error) { assert.fail(`seed ${seed}, step ${i} (${what}): the runtime threw to its caller: ${error.message}`); }
      rule(`step ${i} (${what})`);
    }
    host.stop();
    rule('stopped');
    assert.ok(ended.length <= 1, `seed ${seed}: a room ends once`);
  }
  assert.ok(checks > 16_000);
});

test('a room whose every tick fails ends cleanly, and the log says where: the runtime\'s own faults count like the budget\'s', async () => {
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const c = L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings({}).settings, seats: 8 });
  // Sending a snapshot throws, on every tick (a relay that is broken, say).
  const a = hostRig(L, c, { host: { build: 'abc123', send: (m) => { if (m.t === 'snap') throw new Error('the socket layer fell over'); } } });
  a.join(0);
  a.clock.advance(1900);
  assert.deepEqual(a.ended, [], 'under two seconds: it is still trying');
  assert.equal(a.host.running, true);
  assert.equal(a.clock.timers.length, 1);
  a.clock.advance(400);
  assert.equal(a.ended.length, 1);
  assert.equal(a.ended[0].why, 'fault');
  assert.match(a.ended[0].error, /^tick \d+ \(snapshot\): the socket layer fell over$/, 'the fault is named with the tick and the part of the tick it was in');
  assert.equal(a.host.running, false);
  assert.equal(a.clock.timers.length, 0, 'an ended room holds no timer');
  const said = a.lines.filter((l) => l.ev === 'host-fault');
  assert.ok(said.length >= 2 && said.length <= 4, `a fault is said in the log at most once a second, not once a tick (${said.length} lines for forty faults)`);
  assert.deepEqual([said[0].game, said[0].build, typeof said[0].tick, said[0].where.replace(/\d+/, 'N')], ['test', 'abc123', 'number', 'tick N (snapshot)']);
  assert.ok(a.lines.some((l) => l.ev === 'host-ended' && l.why === 'fault' && l.build === 'abc123'));
  // One fault is not a room's end: the tick after it runs, and the count of failed ticks starts again.
  let once = 0;
  const b = hostRig(L, c, { host: { send: (m) => { if (m.t === 'snap' && (once += 1) === 10) throw new Error('once'); } } });
  b.join(0);
  b.clock.advance(10_000);
  assert.deepEqual(b.ended, []);
  assert.equal(b.host.facts().faults, 1);
  assert.equal(b.host.tick, 200);
  // A clock that will give no timer cannot keep a room: it ends, cleanly, saying so.
  const clock = fakeClock();
  let refuse = false;
  const d = hostRig(L, c, { clock, host: { clock: { now: clock.now, clearTimer: clock.clearTimer, setTimer: (fn, ms) => { if (refuse) throw new Error('no timers left'); return clock.setTimer(fn, ms); } } } });
  d.join(0);
  clock.advance(500);
  refuse = true;
  clock.advance(500);
  assert.deepEqual(d.ended.map((e) => e.why), ['clock']);
  assert.equal(d.host.running, false);
  assert.equal(clock.timers.length, 0);
  // `tickNow`, which the build's own run drives a room with, never throws either.
  const e = hostRig(L, c, { host: { send: () => { throw new Error('every frame'); } } });
  assert.doesNotThrow(() => { e.join(0); e.ticks(50); });
  assert.deepEqual(e.ended.map((x) => x.why), ['fault']);
});

/* ================================================================== no code of the rules runs outside a handler */

test('a function may not sit under valueOf, toString or toJSON: the build refuses it with its line, and what it cannot see is refused as it runs', async () => {
  const refusedAt = async (tick, re) => { const r = await plant({ tick }); assert.match(r.refused ?? '(it built)', re, tick); };
  await refusedAt('const o = { valueOf() { return 1; } };', /src\/rules\.ts:7 a function named "valueOf" is refused in rules: JavaScript would call it by itself/);
  await refusedAt('const o = { toString: () => "x" };', /a function named "toString" is refused in rules/);
  await refusedAt('const o = { toJSON: function () { return 1; } };', /a function named "toJSON" is refused in rules/);
  await refusedAt('const o = { "valueOf"() { return 1; } };', /a function named "valueOf" is refused in rules/);
  await refusedAt('const o = { get x() { return 1; } };', /getters and setters are refused in rules/);
  // The review's own case: a valueOf that loops, returned from think. It ran thirty million turns with the counter off.
  const loop = await plant({ think: `return { ax: { valueOf() { let n = 0; for (let i = 0; i < 30000000; i += 1) n += i; return 1; } }, ay: 0 };` });
  assert.match(loop.refused ?? '(it built)', /src\/rules\.ts:8 a function named "valueOf" is refused in rules/);
  // What the pass cannot see is a function is checked when the property is made.
  const runtime = async (tick, re) => {
    const r = await plant({ tick: `self.score = 1; ${tick} self.score = 2;` });
    assert.equal(r.refused, null, tick);
    assert.equal(drive(r.rig, 2).escaped, null);
    assert.match(stats(r.rig).lastError, re, tick);
    assert.equal(r.rig.ents(0)[0].fields[0], 1, `${tick}: the handler stopped there`);
  };
  const HOOK = /^runner\.tick: a function may not sit under the name valueOf, toString or toJSON: JavaScript would call it by itself, outside any handler \(line 7\)$/;
  await runtime('const fn = () => 1; const o = { valueOf: fn };', HOOK);
  await runtime('const toString = () => "x"; const o = { toString };', HOOK);
  await runtime('const fn = () => 1; const o = {}; o.toJSON = fn;', HOOK);
  await runtime('const fn = () => 1; const o = {}; const k = "value" + "Of"; o[k] = fn;', HOOK);
  await runtime('const fn = () => 1; const k = "to" + "String"; const o = { [k]: fn };', /^runner\.tick: the key "toString" is not allowed in rules \(line 7\)$/);
  // A plain value under one of those names is a field with an odd name, and harmless: nothing ever calls it.
  const plain = await plant({ fields: 'bag: f.list(f.u8(), 4)', tick: `const o = { valueOf: 3, toString: "t", toJSON: null }; const p = {}; p.valueOf = 4; self.bag = [o.valueOf, p.valueOf]; self.score = o.toString === "t" ? 5 : 0;` });
  assert.equal(plain.refused, null);
  drive(plain.rig, 2);
  assert.equal(stats(plain.rig).errors, 0, stats(plain.rig).lastError);
  assert.deepEqual(plain.rig.ents(0)[0].fields, [5, [3, 4]]);
});

test('the runtime runs no code of the rules when it reads a value, even for rules that never went through the wall', async () => {
  // The build refuses a function under valueOf, a getter and a Proxy. This test takes the build away: the module below
  // is handed to the runtime as plain JavaScript, with every hook JavaScript has planted on every value it hands
  // over, and the hooks count how often they run. The boundary's promise is its own, whatever the build did.
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  let hooks = 0;
  const hook = () => { hooks += 1; return 7; };
  /** An object with a hook for every way JavaScript turns an object into something, and getters where the runtime reads. */
  const evil = (extra = {}) => {
    const o = { valueOf: hook, toString: hook, toJSON: hook, [Symbol.toPrimitive]: hook, [Symbol.iterator]: hook, ...extra };
    for (const key of ['x', 'y', 'z', 'ax', 'ay', 'kind', 'at', 'fields', 'motion', 'heading', 'vel', 'pos', 'grounded', 'sphere', 'box', 'cone', 'min', 'max', 'r', 'dir', 'angle', 'ignore', 'message', 'n', 'by', 'name', 'length', 'a', 'b']) {
      if (!(key in extra)) Object.defineProperty(o, key, { get: hook, enumerable: true, configurable: true });
    }
    return o;
  };
  const evilList = () => { const a = [1, 2, 3]; for (const i of [0, 1, 2]) Object.defineProperty(a, i, { get: hook, enumerable: true }); a[Symbol.iterator] = hook; a.valueOf = hook; a.toString = hook; a.toJSON = hook; return a; };
  const f = L.R.f;
  let joins = 0;
  const def = L.R.defineRules({
    contract: 2, space: { dims: 2 },
    move: L.R.defineMove({ pawn(body, input, ctx) { body.pos = evil(); body.vel = evil(); body.heading = evilList(); body.grounded = evil(); ctx.map.sweep(body, evil()); body.motion.trail = evilList(); body.motion.speed = evil(); } }),
    shapes: { events: { poke: { n: f.u8(), at: f.vec3(), who: f.text(8), list: f.list(f.u8(), 4), table: f.map(f.u8(), 4), box: f.struct({ a: f.u8(), b: f.vec3() }) } }, commands: {}, effects: { ding: { n: f.u8() } } },
    entities: {
      pawn: {
        player: { away: 'think', leave: 'bot' },
        fields: { score: f.u16({ score: true }), n: f.i32(), fx: f.fix(), on: f.bit(), at: f.vec3(), way: f.dir(), who: f.ref(), note: f.text(16), bag: f.list(f.u8(), 4), spots: f.list(f.vec3(), 4), table: f.map(f.u8(), 4), box: f.struct({ a: f.u8(), b: f.vec3(), c: f.list(f.text(4), 2) }) },
        motion: { trail: f.list(f.vec3(), 4), speed: f.fix() },
        input: { ax: f.i8(), ay: f.i8() },
        body: { shape: 'circle', radius: 0.5, maxSpeed: 6 },
        think() { return evil(); },
        tick(world, self) {
          // Every kind of field, written whole and changed in place.
          self.n = evil(); self.fx = evil(); self.on = evil(); self.at = evil(); self.way = evil(); self.who = evil(); self.note = evil();
          self.bag = evilList(); self.spots = evilList(); self.table = evil(); self.box = evil({ c: evilList() });
          self.bag.push(evil()); self.spots.push(evil()); self.table.k = evil(); self.box.b = evil(); self.box.c = evilList();
          self.vel = evil(); self.heading = evil();
          // Every call that takes a value.
          const calls = [
            () => world.send(evil(), 'poke', evil({ list: evilList(), table: evil(), box: evil() })),
            () => world.send(self.id, evil(), {}),
            () => world.sendRoom('poke', evil()),
            () => world.sendArea(evil({ sphere: evil() }), 'poke', evil()),
            () => world.sendArea({ box: evil() }, 'poke', evil()),
            () => world.sendArea({ cone: evil() }, 'poke', evil()),
            () => world.after(evil(), 'poke', evil()),
            () => world.emit('ding', evil(), evil()),
            () => world.emit(evil(), self.pos, {}),
            () => world.spawn('rock', evil(), evil()),
            () => world.spawn(evil(), self.pos, {}),
            () => world.place(self, evil(), evil()),
            () => world.near(evil(), evil(), evil()),
            () => world.near(self.pos, 4, evil()),
            () => world.inBox(evil()),
            () => world.inBox({ min: evil(), max: evil() }, evil()),
            () => world.ray(evil(), evil(), evil()),
            () => world.sweep(self, evil(), evil({ ignore: evilList() })),
            () => world.ticks(evil()),
            () => world.map.spot(evil()),
            () => world.map.spots(evil()),
            () => world.ask('pick', evil()),
            () => world.ask(evil(), {}),
            () => world.despawn(evil()),
          ];
          for (const call of calls) { try { call(); } catch { /* a refusal is fine: a hook run is not */ } }
          throw evil();
        },
      },
      rock: { fields: { n: f.u8(), bag: f.list(f.u8(), 4) } },
    },
    shared: { n: f.u8(), list: f.list(f.u8(), 4) },
    asks: { pick: { state: { n: f.u8() }, questions: { q: 1 }, floor() { return evil({ deep: evilList() }); } } },
    room: {
      bots: { keep: 1 },
      start(world) { world.shared.n = evil(); world.shared.list = evilList(); world.shared.list.push(evil()); world.announce('poke', evil()); },
      // A join that works once (so there is a body to run the rest), and then hands back hooks.
      join() { joins += 1; return joins === 1 ? { kind: 'pawn', at: evil(), fields: evil(), motion: evil(), heading: evil() } : evil(); },
      on: { poke(world, e) { world.shared.n = e; world.shared.list = e; } },
    },
  });
  const c = L.R.compileRules(def, { map: L.R.compileMap(MAP), seats: 4, settings: L.R.ROOM_DEFAULTS });
  const rig = hostRig(L, c);
  rig.join(0);
  const ran = drive(rig, 12);
  assert.equal(ran.escaped, null, 'nothing escaped a tick');
  assert.equal(rig.host.tick, 12);
  assert.ok(stats(rig).handlers > 20, 'the handlers ran');
  assert.equal(hooks, 0, 'not one valueOf, toString, toJSON, Symbol.toPrimitive, iterator or getter of the rules was run by the runtime');
  assert.equal(rig.host.facts().faults, 0);
  // Everything it stored is plain data of its declared shape: the snapshot is the proof, as JSON.
  const text = JSON.stringify(rig.snap());
  assert.equal(hooks, 0);
  const pawn = rig.ents(0)[0];
  // A map keeps the names of the first four keys it was handed, as names; what sat under them was not a number, so it is 0.
  assert.deepEqual(pawn.fields, [0, 0, 0, 0, [0, 0], [1, 0], '', '', [0, 0, 0, 0], [[0, 0], [0, 0], [0, 0], [0, 0]], [['toJSON', 0], ['toString', 0], ['valueOf', 0], ['x', 0]], [0, [0, 0], ['', '']]], 'every field is the zero of its type');
  assert.doesNotMatch(text, /function|=>|\[object/, 'and nothing in it was made by turning an object into a text');
});

test('a value is held to its declared shape without throwing, whatever it is', async () => {
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const { coerce, coerceFields, est, own, num, pack } = L.P;
  const f = L.R.f;
  const boom = () => { throw new Error('a hook ran'); };
  const trapped = () => { const o = {}; for (const k of ['x', 'y', 'z', 'a', 'b', 'length', '0', '1']) Object.defineProperty(o, k, { get: boom, enumerable: true }); o.valueOf = boom; o.toString = boom; o[Symbol.toPrimitive] = boom; return o; };
  const trappedList = () => { const a = [1, 2]; Object.defineProperty(a, 1, { get: boom, enumerable: true }); a.toString = boom; return a; };
  const junk = [undefined, null, 0, -0, 1.5, NaN, Infinity, -Infinity, 1e400, '', 'x', '12', '1e3', ' 7 ', 'x'.repeat(100_000), true, false, Symbol('s'), 10n, () => 1, boom, [], [1, [2, [3]]], {}, { x: 1 }, { x: '2', y: [3], z: {} }, Object.create(null), Object.create({ x: 5, y: 5 }), new Map([[1, 2]]), new Set([1]), new Date(0), /re/, new Error('e'), trapped(), trappedList(), [trapped(), trappedList()], { a: trapped(), b: trappedList() }, new Array(200_000).fill(7), Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]))];
  const shapes = [f.u8(), f.u16(), f.u32(), f.i8(), f.i16(), f.i32(), f.bit(), f.fix(), f.vec3(), f.dir(), f.tick(), f.ticks(), f.ref(), f.text(8), f.list(f.u8(), 4), f.list(f.vec3(), 3), f.list(f.list(f.text(2), 2), 2), f.map(f.i8(), 3), f.map(f.list(f.dir(), 2), 2), f.struct({ a: f.u8(), b: f.vec3(), c: f.list(f.ref(), 2), d: f.struct({ e: f.fix() }) })];
  /** Whether a value is what its declaration says, all the way down, frozen. */
  const fits = (fd, v) => {
    if (['u8', 'u16', 'u32', 'i8', 'i16', 'i32', 'tick', 'ticks'].includes(fd.t)) return Number.isInteger(v);
    if (fd.t === 'fix') return Number.isFinite(v);
    if (fd.t === 'bit') return v === true || v === false;
    if (fd.t === 'vec3' || fd.t === 'dir') return Object.isFrozen(v) && Object.getPrototypeOf(v) === Object.prototype && [v.x, v.y, v.z].every(Number.isFinite) && Object.keys(v).join() === 'x,y,z';
    if (fd.t === 'ref') return typeof v === 'string' && v.length <= 24;
    if (fd.t === 'text') return typeof v === 'string' && v.length <= fd.max;
    if (fd.t === 'list') return Array.isArray(v) && Object.isFrozen(v) && v.length <= fd.max && v.every((x) => fits(fd.of, x));
    if (fd.t === 'map') return Object.isFrozen(v) && Object.getPrototypeOf(v) === null && Object.keys(v).length <= fd.max && Object.values(v).every((x) => fits(fd.of, x));
    return Object.isFrozen(v) && Object.keys(v).join() === Object.keys(fd.fields).join() && Object.entries(fd.fields).every(([k, sub]) => fits(sub, v[k]));
  };
  let n = 0;
  for (const fd of shapes) {
    for (const v of junk) {
      n += 1;
      let out;
      assert.doesNotThrow(() => { est(fd, v); out = coerce(fd, v, 2); }, `${fd.t} from ${typeof v}`);
      assert.ok(fits(fd, out), `${fd.t} from ${typeof v === 'symbol' ? 'a symbol' : typeof v}: ${JSON.stringify(pack(fd, out, 2))}`);
      assert.equal(coerce(fd, out, 2), fd.t === 'list' || fd.t === 'map' || fd.t === 'struct' || fd.t === 'vec3' || fd.t === 'dir' ? out : coerce(fd, out, 2), 'a value already held to this declaration is handed back as it is, not read again');
      assert.ok(est(fd, v) >= 1 && est(fd, v) <= L.R.cellsOf(fd) + 1, 'the work is bounded by the declaration, whatever was handed in');
    }
    // A record of such fields, from each piece of junk as the record itself.
    for (const v of junk) assert.doesNotThrow(() => coerceFields([['a', fd], ['b', fd]], v, 2));
  }
  assert.equal(n, shapes.length * junk.length);
  // The readers under it: a getter reads as absent, and a number is never made from an object.
  assert.equal(own(trapped(), 'x'), undefined);
  assert.equal(own({ x: 4 }, 'x'), 4);
  assert.equal(own(Object.create({ x: 4 }), 'x'), undefined, 'only what the value holds itself');
  assert.deepEqual([num(3), num(true), num('12'), num({ valueOf: () => 9 }), num([5]), num(null), num(undefined), num('x'.repeat(100))].map((x) => (Number.isNaN(x) ? 'NaN' : x)), [3, 1, 12, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN']);
  // A list longer than its declaration is read to the declaration and no further: a getter past the end never runs.
  const long = [1, 2, 3, 4];
  Object.defineProperty(long, 4, { get: boom, enumerable: true });
  assert.deepEqual(coerce(f.list(f.u8(), 4), long, 2), [1, 2, 3, 4]);
  // A contract bounds what a field may hold when it is full, so the work above has a ceiling a game can read.
  assert.equal(L.R.cellsOf(f.list(f.u32(), 1024)), 1025);
  assert.equal(L.R.cellsOf(f.list(f.vec3(), 64)), 257);
  const declare = (fields) => L.R.compileRules(L.R.defineRules({ contract: 2, space: { dims: 2 }, entities: { a: { fields } } }), {});
  assert.throws(() => declare({ grid: f.list(f.list(f.u8(), 1024), 1024) }), /entities\.a\.fields\.grid may hold 1049601 values when it is full, and one field holds 16384 at most \(a list of lists multiplies/);
  assert.throws(() => declare(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`l${i}`, f.list(f.vec3(), 1024)]))), /entities\.a: its fields and motion may hold \d+ values when they are full, and one entity holds 65536 at most/);
  assert.doesNotThrow(() => declare({ bag: f.list(f.u32(), 1024), path: f.list(f.vec3(), 1024) }));
});

test('a declaration is read as plain data too: nothing a module declares is turned into a number, walked without end or handed on as it is', async () => {
  // The contract is read once, when a room's Worker loads, with no handler running and so no budget: it must not be
  // possible to make that reading long. This module is handed over as plain JavaScript, as the one above is.
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const f = L.R.f;
  let hooks = 0;
  const hook = () => { hooks += 1; return 7; };
  // A list that holds another twice, forty levels deep: 2^40 entries to anything that walks it.
  let deep = ['x'];
  for (let i = 0; i < 40; i += 1) deep = [deep, deep];
  const evil = { valueOf: hook, toString: hook, toJSON: hook, [Symbol.toPrimitive]: hook };
  const compile = (over, env = {}) => L.R.compileRules(L.R.defineRules({ contract: 2, space: { dims: 2 }, entities: { a: { fields: { n: f.u8() } } }, ...over }), env);
  const quick = (what, fn) => { const t0 = performance.now(); const out = fn(); const ms = performance.now() - t0; assert.ok(ms < SLOW_MS, `${what} took ${ms.toFixed(0)} ms`); return out; };
  // `init`: copied as plain data of a bounded size when the declaration is read, whether it came through `f` or was written by hand.
  const c = quick('a declaration whose init is very deep', () => compile({ entities: { a: { fields: { bag: f.list(f.u8(), 4, { init: deep }), n: { t: 'u8', init: evil }, note: f.text(8, { init: evil }), at: f.vec3({ init: { x: evil, y: deep, z: 1 } }) } } } }));
  assert.equal(hooks, 0);
  const core = L.C.createCore({ ...c, start: (world) => { world.spawn('a', { x: 0, y: 0, z: 0 }, {}); } }, { seed: 1 });
  core.step();
  assert.deepEqual(core.snapshot()[1][0][7], [[0, 0], 0, '', [0, 0]], 'and each field starts as the zero of its type');
  // The declarations as a view is handed them: JSON, with nothing of the module's in it.
  const text = quick('the declarations as JSON', () => JSON.stringify(L.R.schemaOf(c)));
  assert.equal(hooks, 0);
  assert.ok(text.length < 20_000, `${text.length} characters`);
  assert.doesNotMatch(text, /function|=>/);
  // A declaration used inside itself again and again is counted once, and refused for its size before anything walks it.
  let nest = f.struct({ a: f.u8() });
  for (let i = 0; i < 40; i += 1) nest = f.struct({ a: nest, b: nest });
  assert.throws(() => quick('a struct that holds another twice, forty levels deep', () => compile({ entities: { a: { fields: { nest } } } })), /entities\.a\.fields\.nest may hold \d+ values when it is full, and one field holds 16384 at most/);
  let lists = f.u8();
  for (let i = 0; i < 40; i += 1) lists = f.list(lists, 2);
  assert.throws(() => quick('a list of lists, forty levels deep', () => compile({ entities: { a: { fields: { lists } } } })), /may hold \d+ values when it is full/);
  // A number in a declaration is a number, or the declaration is refused: it is never made from something else.
  assert.throws(() => quick('rounds', () => compile({ room: { rounds: { seconds: deep, breakSeconds: 1 } } })), /room\.rounds is \{ seconds, breakSeconds \}/);
  assert.throws(() => quick('rounds', () => compile({ room: { rounds: { seconds: evil, breakSeconds: evil } } })), /room\.rounds is \{ seconds, breakSeconds \}/);
  assert.throws(() => quick('bots', () => compile({ room: { bots: { keep: deep } } })), /room\.bots is \{ keep: n \}/);
  assert.throws(() => quick('a body', () => compile({ entities: { a: { body: { shape: 'circle', radius: deep, maxSpeed: evil } } } })), /entities\.a\.body needs radius \(metres\) and maxSpeed/);
  assert.throws(() => quick('a field', () => compile({ entities: { a: { fields: { n: { t: deep } } } } })), /entities\.a\.fields\.n is not a field type/);
  assert.throws(() => quick('a list', () => compile({ entities: { a: { fields: { n: f.list(f.u8(), deep) } } } })), /a list or a map declares its largest size/);
  assert.equal(hooks, 0, 'and no hook of the module\'s was run by any of it');
});

/* ================================================================== the budget is honest */

test('a query copies nothing: four hundred entities with full lists cost what four hundred entities cost', async () => {
  // The review's case. world.near charged 2 units an entity and then copied every field of every entity it found:
  // with 400 entities each holding a list of 1,024 numbers, a tick took about a second and the budget never noticed.
  const parts = {
    tick: `for (let i = 0; i < 40; i += 1) world.near(self.pos, 64, 'rock');`,
    kinds: `rock: { fields: { bag: f.list(f.u32(), 1024) }, on: { arrive(world, self) { for (let i = 0; i < 1024; i += 1) self.bag.push(i); } } }`,
    room: `start(world) { for (let i = 0; i < 400; i += 1) world.spawn('rock', { x: 0, y: 0, z: 0 }, {}); },`,
  };
  const { rig } = await plant(parts);
  const ran = drive(rig, 12);
  assert.equal(ran.escaped, null);
  assert.ok(ran.slowest < SLOW_MS, `the slowest of twelve ticks took ${ran.slowest.toFixed(0)} ms (it was about 1,000 ms)`);
  assert.ok(stats(rig).ticksCut > 0, 'and the budget noticed: holding and sending that much state leaves a tick little for anything else');
  // What a query hands out is the stored value itself, frozen: the same list twice, never a copy.
  const same = await plant({
    fields: 'same: f.bit(), frozen: f.bit(), len: f.u16()',
    tick: `const a = world.near(self.pos, 64, 'rock'); const b = world.near(self.pos, 64, 'rock'); if (a.length) { self.same = a[0].bag === b[0].bag; self.len = a[0].bag.length; a[0].bag.push(1); self.frozen = true; }`,
    kinds: `rock: { fields: { bag: f.list(f.u32(), 1024) }, on: { arrive(world, self) { for (let i = 0; i < 1024; i += 1) self.bag.push(i); } } }`,
    room: `start(world) { world.spawn('rock', { x: 0, y: 0, z: 0 }, {}); },`,
  });
  drive(same.rig, 4);
  assert.deepEqual(same.rig.ents(0).find((e) => e.seat === 0).fields.slice(1), [1, 0, 1024], 'the same list both times, 1,024 long, and a write to it throws');
  assert.match(stats(same.rig).lastError, /^runner\.tick: .*(not extensible|read only|frozen)/i);
  // A query is charged for every entity it scans and for each one it hands out, before it does either.
  // (What a whole tick used is compared between three games that differ only in the one call.)
  const units = async (tick) => {
    const r = await plant({ tick, kinds: `rock: { fields: { a: f.u8(), b: f.u8() } }`, room: `start(world) { for (let i = 0; i < 100; i += 1) world.spawn('rock', { x: 20, y: 20, z: 0 }, {}); },` });
    r.rig.host.core.setPolicy({ bots: 'off' });
    drive(r.rig, 4);
    assert.equal(stats(r.rig).errors, 0);
    return { units: stats(r.rig).tickUnits, VIEW: r.L.C.VIEW, CALL: r.L.W.CALL, bodies: r.rig.ents().length };
  };
  const base = await units('');
  const none = await units(`world.near(self.pos, 1, 'rock');`);
  const all = await units(`world.near(self.pos, 64, 'rock');`);
  assert.equal(none.units - base.units, none.CALL + 20 + 2 * none.bodies, 'the call, 20, and 2 for each entity scanned');
  assert.equal(all.units - none.units, 100 * (all.VIEW + 2), 'and for each of the 100 found: what an entity costs to hand out, and one more for each field it declares');
});

test('a room whose ticks run slow or fail ends after seconds of the clock, not after a number of ticks', async () => {
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const c = L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings({}).settings, seats: 8 });
  // A tick that takes a second of the clock, every time (the review measured one). The rule is five seconds of it.
  // Counted in ticks, as it was, a room at 20 ticks a second ran a hundred such ticks: a hundred seconds.
  const slow = hostRig(L, c, { host: { send: (m) => { if (m.t === 'snap') slow.clock.t += 1000; } } });
  slow.join(0);
  slow.clock.advance(60_000);
  assert.deepEqual(slow.ended.map((e) => e.why), ['overrun']);
  assert.ok(slow.host.tick >= 5 && slow.host.tick <= 7, `it ended after ${slow.host.tick} ticks of a second each`);
  assert.ok(slow.ended[0].seconds >= 5 && slow.ended[0].seconds <= 6.5, `the log says how long it ran slow: ${slow.ended[0].seconds} s`);
  assert.equal(slow.clock.timers.length, 0);
  // Ticks of 70 ms at a 50 ms period: late every time, for five seconds. That is seventy-odd ticks, not a hundred.
  const late = hostRig(L, c, { host: { send: (m) => { if (m.t === 'snap') late.clock.t += 70; } } });
  late.join(0);
  const t0 = late.clock.t;
  late.clock.advance(4800);
  assert.deepEqual(late.ended, [], 'not before five seconds');
  late.clock.advance(1000);
  assert.deepEqual(late.ended.map((e) => e.why), ['overrun']);
  assert.ok(late.clock.t - t0 <= 6000 && late.host.tick < 90, `ended on tick ${late.host.tick}`);
  // A room that is slow now and then is not ended: a run in which fewer than half the ticks were slow is a hitch, and is dropped.
  let n = 0;
  const hiccup = hostRig(L, c, { host: { send: (m) => { if (m.t === 'snap' && (n += 1) % 3 === 0) hiccup.clock.t += 120; } } });
  hiccup.join(0);
  hiccup.clock.advance(30_000);
  assert.deepEqual(hiccup.ended, []);
  // The budget's rule the same: every tick cut short for two seconds of the clock. Here each such tick also takes
  // 700 ms, so two seconds is three or four ticks, where forty were counted before.
  const { rig } = await plant({ tick: 'while (true) { self.score += 0; }' }, { host: { send: (m) => { if (m.t === 'snap') rig.clock.t += 700; } } });
  rig.clock.advance(60_000);
  assert.equal(rig.ended.length, 1);
  assert.deepEqual([rig.ended[0].why, rig.ended[0].kind, rig.ended[0].handler], ['budget', 'runner', 'tick']);
  assert.ok(rig.host.tick <= 5, `it ended after ${rig.host.tick} ticks`);
});

test('the build stops on a tick that takes longer than a tick lasts, on its own clock', async () => {
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const c = L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings({}).settings, seats: 8 });
  // A stopwatch the test turns: each tick of the three-second run "takes" what the list says.
  const stopwatch = (per) => { let t = 0; let calls = 0; return () => { calls += 1; if (calls % 2 === 0) t += per(calls / 2); return t; }; };
  const quick = smokeRun(L.H, c, 'coin-dash', { timer: stopwatch(() => 2) });
  assert.equal(quick.errors, 0);
  assert.equal(quick.slowestMs, 2);
  assert.ok(quick.maxTickUnits > 0 && quick.maxTickUnits < c.settings.budget.tick / 50, `coin-dash's busiest tick used ${quick.maxTickUnits} of ${c.settings.budget.tick} units: a fiftieth at most`);
  // One slow tick on a busy computer proves nothing.
  assert.doesNotThrow(() => smokeRun(L.H, c, 'coin-dash', { timer: stopwatch((i) => (i === 7 ? 120 : 2)) }));
  // Three ticks over the period, or one over four periods, stop the build with the handler that used the most.
  assert.throws(() => smokeRun(L.H, c, 'coin-dash', { timer: stopwatch((i) => (i % 10 === 0 ? 60 : 2)) }), /games\/coin-dash: its rules ran for three seconds with bots and were too slow: tick \d+ took 60 ms, and 6 ticks took longer than a tick lasts\. A tick lasts 50 ms at 20 ticks a second\. The handler that used the most: \w+\.[\w.]+ \(\d+ budget units\); the busiest tick used \d+ of 500000/);
  assert.throws(() => smokeRun(L.H, c, 'coin-dash', { timer: stopwatch((i) => (i === 30 ? 900 : 2)) }), /were too slow: tick 30 took 900 ms\. A tick lasts 50 ms/);
  // And on the real clock: the review's slow game, which built before, and builds now because it is no longer slow.
  assert.equal(smokeRun(L.H, c, 'coin-dash').errors, 0);
});

/** One planted line, and what must come of it: refused by the build with a line, or stopped in the handler with these words. Never slow, never out of a tick. */
const CASES = [
  // --- an operator never turns a list into a text: that walk is uncounted, and for a list of lists it has no end
  ['a list where a number belongs, in a loop', { tick: `const a = []; for (let i = 0; i < 60000; i += 1) a.push(i); let n = 0; for (let i = 0; i < 300; i += 1) { if (a < 1) n += 1; }` }, /^runner\.tick: a list was used where a number or a text belongs: name the entry or the field you mean \(line 7\)$/, 4_000_000],
  ['a list that holds itself twice, thirty levels deep, compared with ==', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; if (a == 1) self.score = 1;` }, { refused: /src\/rules\.ts:7 the == operator is refused in rules: use === \(a loose comparison turns a list into a text to compare it\)\. `x == null` is allowed/ }],
  ['the same list, subtracted from', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; self.score = a - 1;` }, /a list was used where a number or a text belongs/],
  ['the same list, negated', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; self.score = -a;` }, /a list was used where a number or a text belongs/],
  ['the same list, in a template', { tick: 'let a = ["x"]; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = `${a}`;' }, /a list was used where a number or a text belongs/],
  ['the same list, added to a text', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = 'n' + a;` }, /a list was used where a number or a text belongs/],
  ['the same list, added to a number', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = a + 1;` }, /a list was used where a number or a text belongs/],
  ['the same list, handed to String()', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = String(a);` }, /a list was used where a number or a text belongs/],
  ['the same list, handed to Number()', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = Number(a);` }, /a list was used where a number or a text belongs/],
  ['the same list, as an Error\'s message', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; throw new Error(a);` }, /a list was used where a number or a text belongs/],
  ['the same list, handed to Math.max', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; self.score = Math.max(a, 1);` }, /a list was used where a number or a text belongs/],
  ['the same list, spread into Math.max', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; self.score = Math.max(...a);` }, /a list or an object was used where a number belongs/],
  ['the same list, as the left of in', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const o = { x: 1 }; if (a in o) self.score = 1;` }, /a list was used where a number or a text belongs/],
  ['the same list, with ++', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; let b = a; b++;` }, /a list was used where a number or a text belongs/],
  ['the same list, with -=', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; let b = a; b -= 1;` }, /a list was used where a number or a text belongs/],
  ['the same list in a field of an object, with *=', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const o = { v: a }; o.v *= 2;` }, /a list was used where a number or a text belongs/],
  ['the same list under a computed key, with ++', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const o = { v: a }; const k = 'v'; o[k]++;` }, /a list was used where a number or a text belongs/],
  ['the same list, handed to a text\'s includes', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; if ('abc'.includes(a)) self.score = 1;` }, /includes\(\) was handed a list or an object where a number or a text belongs/],
  ['the same list, as where a slice starts', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const b = [1, 2].slice(a);` }, /slice\(\) was handed a list or an object/],
  ['the same list, joined', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const s = a.join(',');` }, /join\(\) takes a list of texts and numbers: this list holds a list or an object/],
  ['the same list, sorted with no comparison', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; a.sort();` }, /sort\(\) with no comparison takes a list of texts and numbers/],
  ['a comparison for sort that returns that list', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; [3, 1, 2].sort(() => a);` }, /the function handed to sort\(\) returns a number/],
  ['the same list, flattened all the way', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; const b = a.flat(Infinity);` }, /a list, text, Map or Set in rules holds at most 65536 entries/],
  ['a list of empty lists that hold each other, flattened', { tick: `let a = []; for (let i = 0; i < 30; i += 1) a = [a, a]; const b = a.flat(Infinity);` }, /a list, text, Map or Set in rules holds at most 65536 entries/],
  ['flatMap that hands back one large list every time', { tick: `const big = []; for (let i = 0; i < 60000; i += 1) big.push(i); const b = [1, 2, 3, 4].flatMap(() => big);` }, /a list, text, Map or Set in rules holds at most 65536 entries/, 4_000_000],
  ['the same list, handed to world.math', { tick: `let a = ['x']; for (let i = 0; i < 30; i += 1) a = [a, a]; self.score = world.math.clamp(a, 0, 1);` }, /^runner\.tick: math\.clamp takes a number, a number, a number: a vector is \{ x, y, z \} of numbers$/],
  ['texts where world.math adds numbers, doubling', { tick: `let p = { x: 'ab', y: 'cd', z: 'ef' }; for (let i = 0; i < 40; i += 1) p = world.math.add(p, p);` }, /^runner\.tick: math\.add takes a vector, a vector/],
  ['a whole number of any size, squared in a loop', { tick: `let b = 3n; for (let i = 0; i < 40; i += 1) b = b * b;` }, { refused: /src\/rules\.ts:7 a whole number of any size \(10n\) is refused in rules: it grows without limit/ }],
  ['a text doubled through a place the pass cannot write out', { tick: `const o = [{ s: 'ab' }]; for (let i = 0; i < 40; i += 1) o[0].s += o[0].s;` }, { refused: /src\/rules\.ts:7 this changes a place that is reached through a call or a computed key: take the object into a const first/ }],
  ['a text doubled through a plain name', { tick: `const o = { s: 'ab' }; for (let i = 0; i < 40; i += 1) o.s += o.s;` }, /a list, text, Map or Set in rules holds at most 65536 entries/, 4_000_000],
  // --- no function is ever held as a value, and nothing is kept on one
  ['state kept on a built-in function', { tick: `const h = self.hasOwnProperty; h.count = (h.count || 0) + 1; self.score = h.count;` }, /^runner\.tick: nothing is kept on a function: state lives in declared fields \(line 7\)$/],
  ['a built-in function\'s own method replaced', { tick: `const h = self.hasOwnProperty; h.call = 5;` }, /nothing is kept on a function/],
  ['a built-in function changed with ++', { tick: `const h = [].push; h.n++;` }, /a destructuring pattern took|"push" is a function here|nothing is kept on a function/],
  ['state kept on a function of the game\'s own', { tick: `const fn = () => 1; fn.count = 1;` }, /nothing is kept on a function/],
  ['a host function read as a value', { tick: `const near = world.near; self.score = 1;` }, /^runner\.tick: "near" is a function here: a method may be called, never read as a value \(line 7\)$/],
  ['a maths function read as a value', { tick: `const add = world.math.add; self.score = 1;` }, /"add" is a function here: a method may be called, never read as a value/],
  ['the host\'s functions taken out in a list', { tick: `const all = Object.values(world); self.score = all.length;` }, /^runner\.tick: world and ctx are not lists of values: call what they offer by name$/],
  ['the host\'s functions copied by a spread', { tick: `const all = { ...world.math }; self.score = 1;` }, /world and ctx are not lists of values/],
  ['a host function taken out by a pattern', { tick: `const { near } = world; self.score = 1;` }, /a destructuring pattern took a function out of a value/],
  // --- every host call charges for its work before it does it
  ['a list of sixty thousand ids to pass through, for every sweep', { tick: `const a = []; for (let i = 0; i < 60000; i += 1) a.push('e' + i); for (let i = 0; i < 100000; i += 1) world.sweep(self, { x: 0.001, y: 0, z: 0 }, { ignore: a });`, kinds: `rock: { body: { shape: 'circle', radius: 0.2, maxSpeed: 0 } }`, room: `start(world) { for (let i = 0; i < 1500; i += 1) world.spawn('rock', { x: 5, y: 5, z: 0 }, {}); },` }, /this handler ran too long/],
  ['a list of 1,024 read on every turn of a loop', { fields: 'bag: f.list(f.u32(), 1024)', on: `arrive(world, self) { for (let i = 0; i < 1024; i += 1) self.bag.push(i); }`, tick: `let n = 0; for (let i = 0; i < 9000000; i += 1) n += self.bag.length;` }, /this handler ran too long/],
  ['a list of 1,024 written whole on every turn of a loop', { fields: 'bag: f.list(f.u32(), 1024)', tick: `const a = []; for (let i = 0; i < 1024; i += 1) a.push(i); for (let i = 0; i < 9000000; i += 1) self.bag = a;` }, /this handler ran too long/],
  ['an object of sixty thousand keys handed to a map, again and again', { fields: 'table: f.map(f.u16(), 8)', tick: `const o = {}; for (let i = 0; i < 20000; i += 1) o['k' + i] = i; for (let i = 0; i < 9000000; i += 1) self.table = o;` }, /this handler ran too long/, 4_000_000],
  ['a vector written on every turn of a loop', { tick: `for (let i = 0; i < 9000000; i += 1) self.vel = { x: 1, y: 2, z: 0 };` }, /this handler ran too long/],
  ['an event with a long list, sent in a loop', { shapes: `events: { poke: { path: f.list(f.vec3(), 64) } }, commands: {}, effects: {}`, tick: `const path = []; for (let i = 0; i < 64; i += 1) path.push({ x: i, y: i, z: 0 }); for (let i = 0; i < 9000000; i += 1) world.sendRoom('poke', { path });` }, /this handler ran too long|already holds 16384 events/],
  ['an answer to world.ask that is very large', { asks: `asks: { pick: { state: {}, questions: { q: 1 }, floor(state) { const a = []; for (let i = 0; i < 20000; i += 1) a.push([i, i, i]); return { a, b: a, c: a, d: a }; } } },`, tick: `world.ask('pick', {});` }, null, 4_000_000],
  ['timers set far off, on every tick, by everyone', { tick: `for (let i = 0; i < 9000000; i += 1) world.after(100000, 'poke', { n: 1 });` }, /^runner\.tick: this room already holds 16384 events and timers that are waiting: send fewer, or set fewer timers that are far off$/],
  ['area events without end', { tick: `for (let i = 0; i < 9000000; i += 1) world.sendArea({ sphere: { at: self.pos, r: 60 } }, 'poke', { n: 1 });`, kinds: `rock: { fields: { n: f.u8() } }`, room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 1, y: 1, z: 0 }, {}); },` }, /^runner\.tick: a tick takes 64 area events at most$/],
  ['spawns without end', { tick: `for (let i = 0; i < 9000000; i += 1) world.spawn('rock', self.pos, {});`, kinds: `rock: { fields: { n: f.u8() } }` }, /^runner\.tick: a room holds at most 2048 entities$/],
  ['a Map\'s keys read out with a spread, in a loop', { tick: `const m = new Map(); for (let i = 0; i < 30000; i += 1) m.set(i, i); for (let i = 0; i < 9000000; i += 1) { const a = [...m.keys()]; }` }, /this handler ran too long/],
  ['a Map made from a long list, in a loop', { tick: `const a = []; for (let i = 0; i < 30000; i += 1) a.push([i, i]); for (let i = 0; i < 9000000; i += 1) { const m = new Map(a); }` }, /this handler ran too long/],
  ['the keys of a large constant, in a loop', { top: `const BIG = { ${Array.from({ length: 20000 }, (_, i) => `k${i}: ${i}`).join(', ')} };`, tick: `for (let i = 0; i < 9000000; i += 1) { const k = Object.keys(BIG); }` }, /this handler ran too long/],
  ['a large constant gone through with for…in, in a loop', { top: `const BIG = { ${Array.from({ length: 20000 }, (_, i) => `k${i}: ${i}`).join(', ')} };`, tick: `let n = 0; for (let i = 0; i < 9000000; i += 1) { for (const k in BIG) { n += 1; break; } }` }, /this handler ran too long/],
  ['a large constant copied by a spread, in a loop', { top: `const BIG = { ${Array.from({ length: 20000 }, (_, i) => `k${i}: ${i}`).join(', ')} };`, tick: `for (let i = 0; i < 9000000; i += 1) { const o = { ...BIG }; }` }, /this handler ran too long/],
  ['a constant list written out past the size cap', { top: `const BIG = [${Array.from({ length: 65537 }, () => 1).join(',')}];`, tick: `self.score = BIG.length;` }, { refused: /src\/rules\.ts:3 a list holds 65536 entries at most: this one is written out with 65537/ }],
  ['an iterator spread into a list', { tick: `const m = new Map([[1, 2]]); const it = m.entries(); const o = { ...it }; self.score = it.length;` }, null],
  ['thousands of announcements for every entity to hear', { kinds: `rock: { fields: { n: f.u8() }, onRoom: { poke(world, self) { self.n += 1; } } }`, room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 1, y: 1, z: 0 }, {}); }, on: { roundStart(world) { for (let i = 0; i < 9000000; i += 1) world.announce('poke', { n: 1 }); } },` }, /^room\.on\.roundStart: (this room already holds 16384 events and timers that are waiting|this handler ran too long)/],
  ['thousands of announcements nobody hears', { kinds: `rock: { fields: { n: f.u8() } }`, room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 1, y: 1, z: 0 }, {}); }, on: { roundStart(world) { for (let i = 0; i < 9000000; i += 1) world.announce('poke', { n: 1 }); } },` }, /^room\.on\.roundStart: (this room already holds 16384 events|this handler ran too long)/],
  ['the rest of a long list taken by a pattern, in a loop', { tick: `const a = []; for (let i = 0; i < 30000; i += 1) a.push(i); let n = 0; for (let i = 0; i < 9000000; i += 1) { const [first, ...others] = a; n += first; }` }, /this handler ran too long/],
  ['the rest of a large object taken by a pattern, in a loop', { tick: `const o = {}; for (let i = 0; i < 4000; i += 1) o['k' + i] = i; let n = 0; for (let i = 0; i < 9000000; i += 1) { const { k0, ...others } = o; n += k0; }` }, /this handler ran too long/],
  ['the rest of a long list taken by an assignment, in a loop', { tick: `const a = []; for (let i = 0; i < 30000; i += 1) a.push(i); let first = 0; let others = []; for (let i = 0; i < 9000000; i += 1) { [first, ...others] = a; }` }, /this handler ran too long/],
  ['a rest in a parameter', { tick: `const f = ([first, ...others]) => first; self.score = f([1, 2]);` }, { refused: /src\/rules\.ts:7 take the rest \(\.\.\.\) out of a value in a declaration of its own, `const \[first, \.\.\.others\] = list`, not in a parameter, a loop's head or inside another pattern/ }],
  ['a rest in a loop\'s head', { tick: `for (const [first, ...others] of [[1, 2]]) { self.score = first; }` }, { refused: /take the rest \(\.\.\.\) out of a value in a declaration of its own/ }],
  ['a rest inside another pattern', { tick: `const { a: [first, ...others] } = { a: [1, 2] }; self.score = first;` }, { refused: /take the rest \(\.\.\.\) out of a value in a declaration of its own/ }],
  ['the rest of world', { tick: `const { tick, ...others } = world; self.score = 1;` }, /world and ctx are not lists of values/],
  // --- a long text is read end to end by whatever compares it: that is charged too
  ['two long texts compared with ===, in a loop', { tick: `let a = 'ab'; for (let i = 0; i < 13; i += 1) a = a + a; let b = 'ab'; for (let i = 0; i < 13; i += 1) b = b + b; let n = 0; for (let i = 0; i < 9000000; i += 1) { if (a === b) n += 1; }` }, /this handler ran too long/],
  ['two long texts compared with <, in a loop', { tick: `let a = 'ab'; for (let i = 0; i < 13; i += 1) a = a + a; let b = 'ab'; for (let i = 0; i < 13; i += 1) b = b + b; let n = 0; for (let i = 0; i < 9000000; i += 1) { if (a < b) n += 1; }` }, /this handler ran too long/],
  ['a switch on a long text, in a loop', { tick: `let a = 'ab'; for (let i = 0; i < 13; i += 1) a = a + a; let b = 'ab'; for (let i = 0; i < 13; i += 1) b = b + b; let n = 0; for (let i = 0; i < 9000000; i += 1) { switch (a) { case b: n += 1; break; default: n += 2; } }` }, /this handler ran too long/],
  ['a long text turned into a number, in a loop', { tick: `let a = '12'; for (let i = 0; i < 13; i += 1) a = a + a; let n = 0; for (let i = 0; i < 9000000; i += 1) { n = a - 1; }` }, /this handler ran too long/],
  ['a long text as a Map\'s key, in a loop', { tick: `let a = 'ab'; for (let i = 0; i < 13; i += 1) a = a + a; let b = 'ab'; for (let i = 0; i < 13; i += 1) b = b + b; const m = new Map(); m.set(a, 1); let n = 0; for (let i = 0; i < 9000000; i += 1) { n += m.get(b); }` }, /this handler ran too long/],
  ['a long text looked for in a long text, in a loop', { tick: `let a = 'a'; for (let i = 0; i < 15; i += 1) a = a + a; let b = 'a'; for (let i = 0; i < 12; i += 1) b = b + b; b = 'b' + b; let n = 0; for (let i = 0; i < 9000000; i += 1) { if (a.includes(b)) n += 1; }` }, /this handler ran too long/],
  // --- the review's own budget cases, still stopped
  ['a loop that never ends', { tick: `while (true) { self.score += 0; }` }, /this handler ran too long/],
  ['a million queries', { tick: `for (let i = 0; i < 1000000; i += 1) world.near(self.pos, 1);` }, /this handler ran too long/],
  ['a list doubled with concat', { tick: `let a = [1]; for (let i = 0; i < 40; i += 1) a = a.concat(a);` }, /holds at most 65536 entries/, 4_000_000],
  ['a list doubled with a spread', { tick: `let a = [0]; for (let i = 0; i < 40; i += 1) a = [...a, ...a];` }, /holds at most 65536 entries/, 4_000_000],
];

test('every planted way of making a tick slow, holding the isolate or keeping something outside a field is refused or stopped', async () => {
  for (const [name, parts, want, budget] of CASES) {
    const r = await plant(parts, { budget });
    if (want && want.refused) { assert.match(r.refused ?? '(it built)', want.refused, name); continue; }
    assert.equal(r.refused, null, `${name}: ${r.refused}`);
    const ran = drive(r.rig, 4);
    assert.equal(ran.escaped, null, `${name}: nothing escapes a tick`);
    assert.ok(ran.slowest < SLOW_MS, `${name}: the slowest tick took ${ran.slowest.toFixed(0)} ms`);
    assert.equal(r.rig.host.facts().faults, 0, `${name}: the runtime itself did not fault`);
    assert.equal(r.L.W.G.left, Infinity, `${name}: the counter is put back`);
    if (want) assert.match(stats(r.rig).lastError, want, name);
    else assert.equal(stats(r.rig).lastError, '', name);
    assert.equal(r.rig.host.tick, 4, `${name}: the room went on`);
  }
  // Nothing was left on a built-in function by any of them.
  assert.equal(Object.hasOwn(Object.prototype.hasOwnProperty, 'count'), false);
  assert.equal(typeof Object.prototype.hasOwnProperty.call, 'function');
});

test('what world.ask is answered with is plain data of a bounded size', async () => {
  const r = await plant({
    fields: 'got: f.u16(), deep: f.u8()',
    asks: `asks: { pick: { state: { n: f.u8() }, questions: { q: 1 }, floor(state) { const a = []; for (let i = 0; i < 5000; i += 1) a.push(i); return { n: state.n + 1, text: 'hello', nested: { a: { b: { c: { d: { e: 1 } } } } }, yes: true, list: a }; } } },`,
    on: `answer(world, self, e) { self.got = e.picks.list.length; self.deep = e.picks.n; self.score = e.picks.nested.a.b.c === null ? 7 : 1; }`,
    tick: `if (world.tick === 2) world.ask('pick', { n: 4 });`,
  });
  drive(r.rig, 5);
  assert.equal(stats(r.rig).lastError, '');
  const me = r.rig.ents(0).find((e) => e.seat === 0).fields;
  assert.equal(me[2], 5, 'the game\'s own floor answered, from the state it was handed');
  assert.ok(me[1] > 100 && me[1] <= r.L.C.ANSWER_MAX, `a list of 5,000 arrived as its first ${me[1]} entries: an answer holds ${r.L.C.ANSWER_MAX} values at most`);
  assert.equal(me[0], 7, 'and four levels deep at most: what lies deeper is null');
});

test('move, think and join always run, and once the tick\'s budget is gone each is given a small share: two thousand bodies cannot take two thousand quarters', async () => {
  // Every body's `move` burns whatever it is given. Each used to be given a quarter of the budget whatever was left:
  // with 2,000 bodies, 500 budgets a tick.
  const { rig, c, L } = await plant({
    kinds: `rock: { body: { shape: 'circle', radius: 0.2, maxSpeed: 1 } }`,
    move: `runner(body, input, ctx) {}, rock(body, input, ctx) { let n = 0; for (let i = 0; i < 100000000; i += 1) n += i; }`,
    room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 5, y: 5, z: 0 }, {}); },`,
  });
  const ran = drive(rig, 4);
  assert.equal(ran.escaped, null);
  const s = stats(rig);
  const T = c.settings.budget.tick;
  assert.ok(s.maxTickUnits <= 1.5 * T + 1024, `the busiest tick used ${s.maxTickUnits} units: no more than a budget and a half (${1.5 * T}), which is where a body's move stops being run at all`);
  assert.ok(s.maxTickUnits > T, 'and it did use the whole budget');
  assert.equal(s.budgetStops >= 3 * 2000, true, 'every one of them was run, and stopped');
  assert.ok(ran.slowest < SLOW_MS, `the slowest tick took ${ran.slowest.toFixed(0)} ms`);
  assert.equal(L.C.createCore.length >= 1, true);
  // And such a room ends: its budget trips on every tick.
  rig.ticks(60);
  assert.deepEqual(rig.ended.map((e) => [e.why, e.kind, e.handler]), [['budget', 'rock', 'move']]);
});

test('once the tick\'s budget is gone, a body\'s small share buys nothing large: a constant\'s keys are paid for before they are read', async () => {
  // Two thousand bodies, each with a `move` that is run on every tick whatever is left. A call that charged for its
  // work after doing it could be made once by each of them for nothing. Every call charges first, so with the budget
  // gone none of them gets as far as the work.
  const BIG = `const BIG = { ${Array.from({ length: 30000 }, (_, i) => `k${i}: ${i}`).join(', ')} };`;
  for (const [what, line] of [['Object.keys', 'const k = Object.keys(BIG);'], ['for…in', 'for (const k in BIG) { break; }'], ['a spread', 'const o = { ...BIG };'], ['a map field', 'body.motion.table = BIG;'], ['Object.values', 'const v = Object.values(BIG);']]) {
    const move = `import { defineMove } from '@homie-rocks/studio/rules';\n${BIG}\nexport const move = defineMove({ runner(body, input, ctx) {}, rock(body, input, ctx) { ${line} } });`;
    made += 1;
    const dir = writeGame(scratch, `floor${made}`, { ...game({ kinds: `rock: { body: { shape: 'circle', radius: 0.2, maxSpeed: 1 }, motion: { table: f.map(f.u16(), 8) } }`, room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 5, y: 5, z: 0 }, {}); },`, tick: `while (true) { self.score += 0; }` }), move });
    const L = await loadGame(scratch, dir, `floor${made}`);
    const c = L.R.compileRules(L.def, { map: L.R.compileMap(MAP, 'main'), seats: 4, settings: L.R.ROOM_DEFAULTS });
    const rig = hostRig(L, c);
    rig.join(0);
    const ran = drive(rig, 6);
    assert.equal(ran.escaped, null, what);
    assert.ok(ran.slowest < SLOW_MS, `${what}: with 2,000 bodies trying it on every tick, the slowest tick took ${ran.slowest.toFixed(0)} ms`);
    assert.ok(stats(rig).budgetStops > 2000, `${what}: they were stopped (${stats(rig).budgetStops} times)`);
    assert.ok(stats(rig).maxTickUnits <= 1.5 * c.settings.budget.tick + 1024, what);
  }
});

test('a room whose handlers all throw is no slower for it, pays for it, and ends when they use up every tick', async () => {
  // Making an Error has JavaScript record where it was made, which costs thousands of loop turns; so does every Error
  // the runtime or the language throws for a mistake. In a handler none of that is recorded, and a handler that throws
  // costs its tick 512 units.
  const made = await plant({ tick: `let n = 0; for (let i = 0; i < 9000000; i += 1) { const e = new Error('no'); n += 1; }` });
  const ran = drive(made.rig, 4);
  assert.ok(ran.slowest < SLOW_MS, `a loop that makes Errors: the slowest tick took ${ran.slowest.toFixed(0)} ms (it was about 2,000 ms)`);
  assert.match(stats(made.rig).lastError, /this handler ran too long/);
  for (const [what, line, said] of [
    ['an Error of the game\'s own', `throw new Error('no coins left');`, /^rock\.tick: no coins left$/],
    ['a key read of nothing', `const o = null; self.n = o.x;`, /^rock\.tick: Cannot read properties of null/],
    ['a call the host refuses', `world.send(self.id, 'nope', {});`, /^rock\.tick: the event "nope" is not declared in shapes$/],
    ['a key the guard refuses', `const k = 'con' + 'structor'; self.n = self[k];`, /^rock\.tick: the key "constructor" is not allowed in rules/],
  ]) {
    const r = await plant({ kinds: `rock: { fields: { n: f.u8() }, tick(world, self) { ${line} } }`, room: `start(world) { for (let i = 0; i < 2000; i += 1) world.spawn('rock', { x: 1, y: 1, z: 0 }, {}); },` });
    const t = drive(r.rig, 6);
    assert.equal(t.escaped, null, what);
    assert.ok(t.slowest < SLOW_MS, `${what}: with 2,000 handlers throwing on every tick, the slowest tick took ${t.slowest.toFixed(0)} ms`);
    assert.match(stats(r.rig).lastError, said, what);
    assert.ok(stats(r.rig).ticksCut >= 4, `${what}: 2,000 throws use up a tick's budget, so the tick is cut short`);
    assert.ok(stats(r.rig).tickUnits >= r.c.settings.budget.tick, what);
    r.rig.ticks(60);
    assert.deepEqual(r.rig.ended.map((e) => [e.why, e.kind, e.handler]), [['budget', 'rock', 'tick (so many handlers threw that the tick had no budget left)']], what);
  }
  // A few handlers that throw are not a room's end: the error is counted and the room goes on.
  const few = await plant({ kinds: `rock: { fields: { n: f.u8() }, tick(world, self) { throw new Error('no'); } }`, room: `start(world) { for (let i = 0; i < 50; i += 1) world.spawn('rock', { x: 1, y: 1, z: 0 }, {}); },` });
  few.rig.ticks(200);
  assert.deepEqual(few.rig.ended, []);
  assert.equal(stats(few.rig).ticksCut, 0);
  assert.equal(stats(few.rig).errors, 50 * 199);
});

test('a room that holds more than a tick can send is charged for it, and ends', async () => {
  // The whole public state is sent every tick. 1,600 entities that each start with a full list of 1,024 numbers is
  // over a million and a half numbers a tick: the tick pays for packing them before any handler runs, and has
  // nothing left.
  const { rig } = await plant({
    top: `const FULL = [${Array.from({ length: 1024 }, (_, i) => i).join(', ')}];`,
    kinds: `rock: { fields: { bag: f.list(f.u32(), 1024, { init: FULL }) } }`,
    room: `start(world) { for (let i = 0; i < 1600; i += 1) world.spawn('rock', { x: 0, y: 0, z: 0 }, {}); },`,
  });
  rig.ticks(3);
  assert.equal(rig.ents(1).length, 1600);
  assert.equal(rig.ents(1)[7].fields[0].length, 1024);
  assert.ok(stats(rig).tickUnits > rig.host.core.snapshot()[1].length * 1024, 'the tick was charged for every number it sent');
  rig.ticks(120);
  assert.deepEqual(rig.ended.map((e) => [e.why, e.kind, e.handler]), [['budget', 'room', 'state (the room holds more than a tick can send)']]);
  assert.ok(rig.host.tick <= 4, `it ended on tick ${rig.host.tick}: such a room has no handler left to run that could make it smaller, so it is not left to grow`);
  // A long text is sent character by character, and counted so: one text of 4,096 characters written to eight fields
  // of 600 entities is one value 4,800 times over to the handler that writes it, and 19 million characters a tick to send.
  const texts = await plant({
    kinds: `rock: { fields: { a: f.text(4096), b: f.text(4096), c: f.text(4096), d: f.text(4096), e: f.text(4096), g: f.text(4096), h: f.text(4096), i: f.text(4096) }, on: { arrive(world, self) { let s = 'abcdefgh'; for (let k = 0; k < 9; k += 1) s = s + s; self.a = s; self.b = s; self.c = s; self.d = s; self.e = s; self.g = s; self.h = s; self.i = s; } } }`,
    room: `start(world) { for (let i = 0; i < 600; i += 1) world.spawn('rock', { x: 0, y: 0, z: 0 }, {}); },`,
  });
  texts.rig.ticks(40);
  assert.deepEqual(texts.rig.ended.map((e) => [e.why, e.kind, e.handler]), [['budget', 'room', 'state (the room holds more than a tick can send)']]);
});

test('with the tick\'s budget gone nothing is lost: an entity that has not arrived waits, and so does a command', async () => {
  // 300 entities whose `arrive` costs a little over a hundredth of the budget each: about ninety fit in a tick.
  const { rig } = await plant({
    fields: 'nudged: f.u16()',
    kinds: `rock: { fields: { arrived: f.u8(), ticked: f.u32() }, on: { arrive(world, self) { let n = 0; for (let i = 0; i < 11000; i += 1) n += 1; self.arrived += 1; } }, tick(world, self) { self.ticked += 1; } }`,
    room: `start(world) { for (let i = 0; i < 300; i += 1) world.spawn('rock', { x: 0, y: 0, z: 0 }, {}); },`,
    commands: `nudge(world, self, c) { let n = 0; for (let i = 0; i < 200000; i += 1) n += 1; self.nudged += c.n; }`,
  });
  // Sixteen commands in one tick, each a fifth of the budget: four or five run a tick, and none is dropped.
  rig.ticks(1);
  for (let i = 0; i < 16; i += 1) rig.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['nudge', { n: 1 }] });
  rig.ticks(1);
  const rocks = () => rig.ents(1).map((e) => e.fields);
  const after2 = rocks().filter((f) => f[0] === 1).length;
  assert.ok(after2 > 0 && after2 < 300, `after the first tick with them ${after2} of 300 had arrived`);
  assert.ok(rocks().every((f) => f[0] === 1 || f[1] === 0), 'one that has not arrived has not ticked either');
  rig.ticks(30);
  assert.ok(rocks().every((f) => f[0] === 1), 'every one arrived, once');
  assert.equal(rig.ents(0).find((e) => e.seat === 0).fields[1], 16, 'every command ran, once');
  assert.ok(stats(rig).ticksCut > 0);
});
