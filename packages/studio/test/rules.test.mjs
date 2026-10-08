/**
 * Rules on the server (NETPLAY.md section 29; rooms-milestone-1-design.md sections 3, 4 and 10): the contract, the
 * core, the host runtime and the relay's server host. Run as the runtime runs them: every game here goes through the
 * build's wall (lib/rules-guard.mjs) and is loaded with the runtime as one instance, in Node, with no Cloudflare.
 *
 *   - the maths rules are handed agrees with `Math` to 1e-12, and is the list the wall knows;
 *   - a declaration that does not fit the contract is named;
 *   - declared state is held to its type, and packs and unpacks to itself;
 *   - the host runtime steps coin-dash: bots fill, a round is played, results rank the scores, and two runs on one
 *     seed are the same tick by tick; a room packed to bytes and built back carries on the same;
 *   - the input protocol, case by case: on time, missing, early, too early, late, late past a quarter second,
 *     duplicate, another epoch, silence, and the lead figure; more frames buy no extra step; an owner's claim is held
 *     to maxSpeed;
 *   - the wall at run time: a handler that never ends, one that is slow and one that grabs memory are each stopped
 *     and named, the rest of the room carries on, and a room whose rules fail on every tick for two seconds ends;
 *   - `world` has no way out;
 *   - the room's life with the server as host: no browser is ever host, a forged score, state or round frame changes
 *     nothing, the room pauses with the last person and resumes on the tick it paused on, watchers and AI seats never
 *     keep it ticking, a seat given up becomes a bot, an empty room is forgotten, and rules that cannot start refuse
 *     joins with the reason.
 * Run: node --test packages/studio/test/rules.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ARRAY_METHODS, MAPSET_METHODS, MATH_METHODS, REFUSED_NAMES, STRING_METHODS, WORLD_METHODS } from '../lib/rules-guard.mjs';
import { COIN_DASH, COIN_MAP, fakeClock, hostRig, loadGame, roomRig, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let coin = null;
/** coin-dash, the starter, loaded once; `compile()` gives a fresh compiled copy with five-second rounds. */
async function coinDash() {
  coin ??= await loadGame(scratch, COIN_DASH, 'coin-dash');
  const L = coin;
  const compile = (room = {}, seats = 8) => L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings(room).settings, seats });
  return { L, compile };
}

/** A small game for the input protocol: the server moves the body, and its fields record what each step held. */
const PAWN = `
import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
const move = defineMove({ pawn(body, input, ctx) { body.pos = { x: body.pos.x + input.ax / 100, y: 0, z: 0 }; } });
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: { events: {}, commands: { boost: { n: f.u8() } }, effects: {} },
  entities: {
    pawn: {
      player: true,
      fields: { ax: f.i8(), waves: f.u16({ score: true }), boosts: f.u16(), steps: f.u32() },
      input: { ax: f.i8(), wave: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 100 },
      tick(world, self) { self.ax = self.input.ax; self.steps += 1; if (self.input.wave) self.waves += 1; },
      commands: { boost(world, self, c) { self.boosts += c.n; } },
    },
  },
  room: { join(ctx, player) { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; } },
});
`;
let pawn = null;
async function pawnGame() {
  pawn ??= await loadGame(scratch, writeGame(scratch, 'pawn', { rules: PAWN }), 'pawn');
  const L = pawn;
  const c = L.R.compileRules(L.def, { map: L.R.compileMap({ bounds: { min: [-500, -500], max: [500, 500] } }), settings: L.R.roomSettings({}).settings });
  const rig = hostRig(L, c);
  rig.join(0);
  rig.ticks(3);
  const me = () => rig.ents()[0];
  const send = (k, entries, extra = {}) => rig.host.frame({ t: 'in', from: 0, e: rig.host.epoch, k, s: entries, r: 0, ...extra });
  return { L, c, rig, me, send };
}

test('the maths rules are handed agrees with Math, and is the list the wall knows', async () => {
  const { L } = await coinDash();
  const { exact, math } = L.M;
  let worst = 0;
  for (let x = -40; x < 40; x += 0.0173) {
    worst = Math.max(worst, Math.abs(exact.sin(x) - Math.sin(x)), Math.abs(exact.cos(x) - Math.cos(x)), Math.abs(exact.atan(x) - Math.atan(x)), Math.abs(exact.atan2(x, 3 - x) - Math.atan2(x, 3 - x)));
    worst = Math.max(worst, Math.abs(exact.exp(x / 8) - Math.exp(x / 8)) / Math.exp(x / 8));
    if (x > 0) worst = Math.max(worst, Math.abs(exact.log(x) - Math.log(x)), Math.abs(exact.pow(x, 1.7) - x ** 1.7) / x ** 1.7);
  }
  assert.ok(worst < 1e-12, `the worst difference from Math is ${worst}`);
  assert.equal(exact.pow(1 - 14 / 60, 3), (1 - 14 / 60) * (1 - 14 / 60) * (1 - 14 / 60), 'a whole power is repeated multiplication');
  assert.deepEqual(math.norm({ x: 3, y: 4, z: 0 }), { x: 0.6, y: 0.8, z: 0 });
  assert.equal(math.len(math.clampLen({ x: 30, y: 40, z: 0 }, 1)), 1);
  // The wall's lists are the runtime's own (lib/rules-guard.mjs cannot import a .ts file from an installed package).
  assert.deepEqual([...MATH_METHODS].sort(), Object.keys(math).filter((k) => typeof math[k] === 'function').sort());
  assert.deepEqual([...ARRAY_METHODS], [...L.W.ARRAY_METHODS]);
  assert.deepEqual([...STRING_METHODS], [...L.W.STRING_METHODS]);
  assert.deepEqual([...MAPSET_METHODS], [...L.W.MAPSET_METHODS]);
  assert.deepEqual([...REFUSED_NAMES], [...L.W.REFUSED_NAMES]);
});

test('a declaration that does not fit the contract is named', async () => {
  const { L } = await coinDash();
  const { defineRules, defineMove, compileRules, f } = L.R;
  const move = defineMove({ a() {} });
  const base = () => ({ contract: 2, space: { dims: 2 }, move, shapes: { events: { hit: {} } }, entities: { a: { player: true, body: { shape: 'circle', radius: 1, maxSpeed: 1 } } }, room: { join: () => ({ kind: 'a', at: { x: 0, y: 0, z: 0 } }) } });
  const bad = (change, re) => { const d = base(); change(d); assert.throws(() => compileRules(defineRules(d)), re); };
  assert.ok(compileRules(defineRules(base())));
  bad((d) => { d.contract = 1; }, /contract: 2/);
  bad((d) => { d.space = { dims: 4 }; }, /space: \{ dims: 2 \}/);
  bad((d) => { d.entities.a.on = { boom() {} }; }, /entities\.a\.on\.boom: no event "boom" is declared in shapes\.events/);
  bad((d) => { d.entities.a.commands = { go() {} }; }, /no command "go" is declared/);
  bad((d) => { d.entities.a.fields = { pos: f.vec3() }; }, /every entity already has "pos"/);
  bad((d) => { d.entities.a.fields = { n: 5 }; }, /entities\.a\.fields\.n is not a field type/);
  bad((d) => { d.entities.a.fields = { a: f.u8({ score: true }), b: f.u8({ score: true }) }; }, /one field is the score/);
  bad((d) => { d.entities.a.fields = { p: f.press() }; }, /f\.press\(\) is for input only/);
  bad((d) => { d.entities.a.input = { v: f.vec3() }; }, /an input field is a whole number/);
  bad((d) => { d.entities.a.fields = { l: f.list(f.u8(), 0) }; }, /declares its largest size/);
  bad((d) => { d.entities.a.player = { leave: 'bot' }; }, /need a think\(world, self\) handler/);
  bad((d) => { d.entities.a.body = { shape: 'sphere', radius: 1, maxSpeed: 1 }; }, /body\.shape is 'circle' when space\.dims is 2/);
  bad((d) => { d.shapes.events.roundStart = {}; }, /an event the runtime sends itself/);
  bad((d) => { delete d.room.join; }, /room\.join\(ctx, player\) says where/);
  bad((d) => { d.move = { a() {} }; }, /defineMove/);
  assert.throws(() => compileRules({ contract: 2 }), /defineRules/);
  // Settings: every one has a default, and a value outside its limit is said.
  const s = L.R.roomSettings({ tickHz: 90, inputHz: 5, host: 'cloud', nope: 1 });
  assert.equal(s.settings.tickHz, 20);
  assert.equal(s.settings.host, 'server');
  assert.equal(s.problems.length, 3);
  assert.deepEqual(L.R.roomSettings(undefined), { settings: { host: 'server', offline: true, tickHz: 20, inputHz: 20, durability: { movementSeconds: 1 }, budget: { tick: 2_000_000 }, predict: { catchM: null, catchUp: 1.25, snapM: null, blendMs: 100, interpMs: null } }, problems: [] });
  assert.throws(() => L.R.compileMap({}), /needs "bounds"/);
});

test('declared state is held to its type, and packs and unpacks to itself', async () => {
  const { L } = await coinDash();
  const { f } = L.R;
  const { coerce, pack, unpack } = L.P;
  assert.equal(coerce(f.u8(), 300, 2), 255);
  assert.equal(coerce(f.i8(), -200.7, 2), -128);
  assert.equal(coerce(f.u16(), NaN, 2), 0);
  assert.equal(coerce(f.fix(), 1.4000001, 2), Math.round(1.4000001 * 4096) / 4096);
  assert.equal(coerce(f.text(3), 'abcdef', 2), 'abc');
  assert.deepEqual(coerce(f.vec3(), { x: 1.1, y: 2, z: 9 }, 2), { x: Math.fround(1.1), y: 2, z: 0 }, 'z is 0 when dims is 2, and numbers are 32-bit floats');
  assert.deepEqual(coerce(f.dir(), { x: 0, y: 0, z: 0 }, 2), { x: 1, y: 0, z: 0 });
  assert.deepEqual(coerce(f.list(f.u8(), 2), [1, 2, 3], 2), [1, 2]);
  assert.deepEqual(Object.keys(coerce(f.map(f.u8(), 2), { a: 1, constructor: 2, b: 3, c: 4 }, 2)), ['a', 'b'], 'a map keeps its largest size, and never a refused key');
  const shape = f.struct({ at: f.vec3(), tags: f.list(f.text(4), 3), who: f.map(f.ref(), 4), on: f.bit() });
  const v = coerce(shape, { at: { x: 1, y: 2 }, tags: ['abcdef', 'x'], who: { b: 'e2', a: 'e1' }, on: true }, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(unpack(shape, JSON.parse(JSON.stringify(pack(shape, v, 3))), 3))), JSON.parse(JSON.stringify(v)));
});

test('the host runtime steps coin-dash: bots fill, a round is played, results rank the scores', async () => {
  const { L, compile } = await coinDash();
  const c = compile({});
  const rig = hostRig(L, c);
  assert.equal(c.rounds.seconds, 60);
  rig.join(0, 'Ada');
  rig.ticks(1);
  assert.deepEqual(rig.sent.find((m) => m.t === 'caps'), { t: 'caps', caps: ['skill'] }, 'a kind with think reads the dial');
  const first = rig.snap();
  assert.deepEqual([first.t, first.from, first.k, first.e], ['snap', null, 1, rig.host.epoch]);
  assert.deepEqual(rig.ents(0).map((e) => e.driver).sort(), ['bot', 'bot', 'bot', 'person'], 'bots keep four bodies in the room');
  assert.equal(rig.ents(1).length, COIN_MAP.spots.coins.length, 'roundStart ran on tick 1 and spawned the coins: spawns join the room at the end of phase 3, before the snapshot');
  rig.ticks(1);
  const roster = rig.sent.filter((m) => m.t === 'roster').at(-1).slots;
  assert.deepEqual(roster.map((s) => [s.slot, s.seat, s.bot]), [[0, 0, false], [5, null, true], [6, null, true], [7, null, true]]);
  assert.equal(roster[0].name, 'Ada');
  assert.deepEqual(rig.sent.find((m) => m.t === 'round').round.phase, 'live');
  // The whole round: 60 s at 20 Hz, then two ticks for the results.
  rig.ticks(1201);
  const over = rig.sent.filter((m) => m.t === 'round').at(-1).round;
  assert.equal(over.phase, 'over');
  assert.equal(over.n, 1);
  assert.equal(over.results.length, 4);
  assert.equal(over.results.reduce((n, r) => n + r.score, 0), COIN_MAP.spots.coins.length, 'every coin was taken exactly once');
  assert.deepEqual(over.results.map((r) => r.place), [...over.results.map((r) => r.place)].sort((a, b) => a - b));
  for (let i = 1; i < over.results.length; i += 1) assert.equal(over.results[i].place === over.results[i - 1].place, over.results[i].score === over.results[i - 1].score, 'ties share a place');
  assert.equal(over.results.find((r) => r.seat === 0).bot, false);
  assert.ok(rig.sent.some((m) => m.t === 'ev' && m.k === 'fx' && m.d[1].length), 'a ding is an effect frame');
  assert.equal(rig.ents(1).length, 0, 'coins are gone when the round is over');
  // Through the break, everybody stands still; the next round starts by itself and resets the scores.
  rig.ticks(8 * 20);
  assert.equal(rig.sent.filter((m) => m.t === 'round').at(-1).round.n, 2);
  assert.deepEqual(rig.ents(0).map((e) => e.fields[0]), [0, 0, 0, 0]);
  assert.equal(rig.host.core.stats.errors, 0);
});

test('two runs on one seed are the same tick by tick, and a room packed to bytes carries on the same', async () => {
  const { L, compile } = await coinDash();
  const c = compile({});
  const run = () => { const core = L.C.createCore(c, { seed: 42, epoch: 7 }); core.seatJoin({ seat: 2, driver: 'person', owner: 'p1' }); return core; };
  const a = run(); const b = run();
  let moved = null;
  for (let i = 0; i < 400; i += 1) {
    a.step(); b.step();
    assert.equal(L.P.digest(a.snapshot()), L.P.digest(b.snapshot()), `tick ${a.tick}`);
    if (i === 150) {
      // Pack the whole room to bytes, build a room back from them, and carry on beside the one that never stopped.
      const bytes = L.P.toBytes(a.save());
      assert.ok(bytes instanceof Uint8Array && bytes.length > 500);
      moved = L.C.createCore(c, { restore: L.P.fromBytes(bytes) });
      assert.equal(moved.tick, a.tick);
    }
    if (moved && i > 150) { moved.step(); assert.equal(L.P.digest(moved.snapshot()), L.P.digest(a.snapshot()), `the rebuilt room at tick ${a.tick}`); assert.deepEqual(moved.save(), a.save()); }
  }
  assert.ok(a.bodies().some((x) => x.score > 0));
  // The host runtime's own save holds the names and each seat's held input too.
  const rig = hostRig(L, c);
  rig.join(0, 'Ada');
  rig.ticks(30);
  const again = hostRig(L, c, { host: { restore: rig.host.save() } });
  assert.equal(again.host.tick, rig.host.tick);
  assert.equal(again.host.epoch, rig.host.epoch);
  rig.ticks(5); again.ticks(5);
  assert.equal(L.P.digest(again.snap().d), L.P.digest(rig.snap().d));
});

test('the input protocol: on time, missing, early, too early, late, duplicate, another epoch, silence and the lead', async () => {
  const { rig, me, send } = await pawnGame();
  const AX = 0; const WAVES = 1; const STEPS = 3;
  let K = rig.host.tick;
  assert.deepEqual(rig.row(0), [0, 0, 0, -128], 'no frame has arrived: the lead says so');
  // On time: an entry stamped with the next tick is applied on that tick, and acknowledged by its stamp.
  send(K + 1, [[0, 50, 0]]);
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], 50);
  assert.deepEqual(rig.row(0).slice(0, 3), [0, 0, K]);
  assert.equal(rig.row(0)[3], 16, 'it arrived one tick before its tick was due: sixteen sixteenths');
  // Missing: a tick with no entry repeats the held values with every press cleared.
  rig.ticks(3); K += 3;
  assert.equal(me().fields[AX], 50);
  assert.equal(me().fields[WAVES], 0);
  assert.equal(rig.row(0)[2], K - 3, 'the acknowledgement is still the newest entry it had');
  assert.equal(rig.row(0)[3], -128);
  // A press fires in one step only.
  send(K + 1, [[0, 50, 1]]);
  rig.ticks(3); K += 3;
  assert.equal(me().fields[WAVES], 1);
  // Early: kept, and applied on its own tick, not before.
  send(K + 1, [[4, -30, 0]]);
  rig.ticks(4); K += 4;
  assert.equal(me().fields[AX], 50, 'not yet');
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], -30);
  // Too early: more than a second ahead. That entry and the rest of its frame are dropped.
  send(K + 1, [[25, 99, 0], [26, 98, 0]]);
  rig.ticks(30); K += 30;
  assert.equal(me().fields[AX], 0, 'neither was ever applied (and a second of silence made the input neutral)');
  // Late: its values hold from the next tick, and its press fires there, a quarter of a second being five ticks.
  send(K - 2, [[0, 70, 1]]);
  assert.equal(me().fields[AX], 0, 'nothing is applied in the past');
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], 70);
  assert.equal(me().fields[WAVES], 2, 'the late press fired on the next tick');
  assert.equal(rig.row(0)[2], K - 3, 'acknowledged by its own stamp');
  assert.ok(rig.row(0)[3] < 0, 'and the lead is negative: it was late');
  // Late past a quarter of a second: the values still hold, the press is dropped.
  rig.ticks(10); K += 10;
  send(K - 9, [[0, 20, 1]]);
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], 20);
  assert.equal(me().fields[WAVES], 2);
  // Duplicate: not above the newest stamp it has. Ignored.
  send(K - 10, [[0, 111, 1]]);
  rig.ticks(2); K += 2;
  assert.equal(me().fields[AX], 20);
  assert.equal(me().fields[WAVES], 2);
  // Another epoch: the frame is dropped.
  send(K + 1, [[0, 5, 1]], { e: rig.host.epoch + 1 });
  rig.ticks(2); K += 2;
  assert.equal(me().fields[AX], 20);
  // Values are held to their declared types, whatever was sent.
  send(K + 1, [[0, 9000, 7]]);
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], 127);
  assert.equal(me().fields[WAVES], 2, 'a press is 1 or it is not a press');
  // Silence: no frame for a second, and the input is neutral until the next entry.
  rig.ticks(19); K += 19;
  assert.equal(me().fields[AX], 127, 'a second has not quite passed');
  rig.ticks(2); K += 2;
  assert.equal(me().fields[AX], 0);
  send(K + 1, [[0, 33, 0]]);
  rig.ticks(1); K += 1;
  assert.equal(me().fields[AX], 33);
  assert.equal(me().fields[STEPS], K - 0, 'exactly one step every tick, whatever arrived');
});

test('more frames buy no extra step, a command runs once, and an owner\'s claim is held to maxSpeed', async () => {
  const { rig, me, send } = await pawnGame();
  const K = rig.host.tick;
  const x0 = me().pos.x;
  // Ten frames for one tick, and entries stamped far ahead: the body still takes one step a tick.
  for (let i = 0; i < 10; i += 1) send(K + 1, [[0, 100, 0], [1, 100, 0], [2, 100, 0]]);
  rig.ticks(1);
  assert.ok(Math.abs(me().pos.x - (x0 + 1)) < 1e-6, `one step of 1 m, not ${me().pos.x - x0}`);
  rig.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['boost', { n: 3 }], id: 'c0' });
  rig.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['nope', {}], id: 'c0' });
  rig.ticks(2);
  assert.equal(me().fields[2], 3, 'the command ran once, on the next tick');
  rig.host.frame({ t: 'ev', from: 0, k: 'say:hi', d: { text: 'hi' }, id: 'c0' });
  assert.deepEqual(rig.sent.at(-1), { t: 'ev', from: 0, k: 'say:hi', d: { text: 'hi' } }, 'a seat\'s speech is passed on unchanged');

  // coin-dash: a person's runner is owner-moved. A claim of 40 m in one tick moves it by a tick of maxSpeed.
  const { L, compile } = await coinDash();
  const c = compile({});
  const r = hostRig(L, c);
  r.join(0, 'Ada');
  r.ticks(4);
  const mine = () => r.ents(0).find((e) => e.seat === 0);
  const start = mine();
  const claim = (k, x, y, rr = start.r) => r.host.frame({ t: 'in', from: 0, e: r.host.epoch, k, s: [[0, 0, 0, x, y, 0, 600, 0, 0, 1, 0, 0]], r: rr });
  claim(r.host.tick + 1, start.pos.x + 40, start.pos.y);
  r.ticks(1);
  const moved = mine().pos.x - start.pos.x;
  assert.ok(moved > 0 && moved <= 6 * 0.25 + 0.06, `it moved ${moved} m: never more than a quarter second of maxSpeed banked`);
  const before = mine().pos.x;
  for (let i = 0; i < 20; i += 1) { claim(r.host.tick + 1, start.pos.x + 40, start.pos.y); r.ticks(1); }
  const speed = (mine().pos.x - before) / 1;
  assert.ok(speed <= 6 * 1.03, `over a second it ran at ${speed} m/s, held to maxSpeed 6`);
  // A claim made before the last placement (an older placement counter) is ignored.
  const at = mine().pos.x;
  claim(r.host.tick + 1, at + 3, start.pos.y, start.r + 5);
  r.ticks(1);
  assert.equal(mine().pos.x, at);
});

const WALL = (tick, extra = '') => `
import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
const move = defineMove({ pawn() {} });
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: { events: { ping: {} }, commands: {}, effects: {} },
  entities: {
    pawn: { player: true, body: { shape: 'circle', radius: 0.5, maxSpeed: 1 }, fields: { n: f.u32() }, tick(world, self) { self.n += 1; } },
    trouble: { fields: { n: f.u32() }, tick(world, self) { ${tick} } ${extra} },
  },
  room: { start(world) { world.spawn('trouble', { x: 1, y: 1, z: 0 }, {}); }, join() { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; } },
});
`;
async function wallGame(name, tick, extra, budget = 40_000) {
  const L = await loadGame(scratch, writeGame(scratch, name, { rules: WALL(tick, extra) }), name);
  const c = L.R.compileRules(L.def, { map: L.R.compileMap({ bounds: { min: [-9, -9], max: [9, 9] } }), settings: L.R.roomSettings({ budget: { tick: budget } }).settings });
  const rig = hostRig(L, c);
  rig.join(0);
  return { L, rig };
}

test('the wall at run time: a handler that never ends is stopped and named, the room carries on, and then the room ends', async () => {
  const { L, rig } = await wallGame('forever', 'self.n += 1; while (true) { self.n += 0; }');
  rig.ticks(5);
  const s = rig.host.core.stats;
  assert.equal(s.budgetStops, 4, 'stopped on every tick it ran (it exists from tick 2)');
  assert.match(s.lastError, /^trouble\.tick: this handler ran too long/);
  assert.equal(s.worst, 'trouble.tick');
  assert.equal(s.maxUnits, 10_000, 'it used a quarter of budget.tick and not a unit more');
  assert.equal(rig.ents(0)[0].fields[0], 5, 'the player\'s own handler ran on every tick all the same');
  assert.equal(L.W.G.left, Infinity, 'the counter is put back after every handler');
  assert.equal(rig.ended.length, 0);
  // The budget tripping on every tick for two seconds: the room ends, and the log names the kind and the handler.
  rig.ticks(40);
  assert.deepEqual(rig.ended, [{ why: 'budget', kind: 'trouble', handler: 'tick' }]);
  assert.ok(rig.lines.some((l) => l.ev === 'host-ended' && l.why === 'budget' && l.kind === 'trouble' && l.handler === 'tick'));
  const k = rig.host.tick;
  rig.ticks(3);
  assert.equal(rig.host.tick, k, 'an ended room does not tick');
});

test('the wall at run time: a slow handler and one that grabs memory are stopped and named; one that throws is counted', async () => {
  // Slow without looping forever: thousands of queries. The weighted charges stop it long before it finishes.
  const slow = await wallGame('slow', 'for (let i = 0; i < 100000; i += 1) { self.n = i; world.near(self.pos, 8); }');
  slow.rig.ticks(3);
  assert.match(slow.rig.host.core.stats.lastError, /^trouble\.tick: this handler ran too long/);
  const turns = slow.rig.ents(1)[0].fields[0];
  assert.ok(turns > 50 && turns < 600, `it was stopped after ${turns} of 100000 turns`);
  // Memory: a list doubled in a loop is refused when it would pass 65,536 entries, on its 17th turn.
  const fat = await wallGame('fat', 'let a = [1]; for (let i = 0; i < 40; i += 1) { self.n = i; a = a.concat(a); }', '', 2_000_000);
  fat.rig.ticks(3);
  assert.match(fat.rig.host.core.stats.lastError, /^trouble\.tick: a list, text, Map or Set in rules holds at most 65536 entries \(line \d+\)/);
  assert.equal(fat.rig.ents(1)[0].fields[0], 16);
  // The same for a text built with +.
  const text = await wallGame('text', 'let s = "ab"; for (let i = 0; i < 40; i += 1) { self.n = i; s = s + s; }', '', 2_000_000);
  text.rig.ticks(3);
  assert.match(text.rig.host.core.stats.lastError, /holds at most 65536 entries/);
  // A handler that throws: that run is abandoned, the error is counted, the tick continues.
  const boom = await wallGame('boom', 'self.n += 1; if (self.n > 1) throw new Error("no coins left");');
  boom.rig.ticks(6);
  assert.equal(boom.rig.host.core.stats.errors, 4);
  assert.equal(boom.rig.host.core.stats.lastError, 'trouble.tick: no coins left');
  assert.equal(boom.rig.ents(0)[0].fields[0], 6);
  assert.equal(boom.rig.ended.length, 0, 'a throw is not a budget trip: the room goes on');
  // A built key cannot reach a constructor, a prototype or a method at run time.
  const key = await wallGame('key', 'const k = "con" + "structor"; self.n = 1; const c = self[k]; self.n = 2;');
  key.rig.ticks(3);
  assert.match(key.rig.host.core.stats.lastError, /^trouble\.tick: the key "constructor" is not allowed in rules \(line \d+\)/);
  assert.equal(key.rig.ents(1)[0].fields[0], 1);
  const method = await wallGame('method', 'const list = [3, 1, 2]; const k = "so" + "rt"; self.n = 1; const fn = list[k]; self.n = 2;');
  method.rig.ticks(3);
  assert.match(method.rig.host.core.stats.lastError, /"sort" is a function: a method may be called, never read as a value/);
  // The same through an optional computed key.
  const opt = await wallGame('opt', 'const k = "proto" + "type"; self.n = 1; const p = self?.[k]; self.n = 2;');
  opt.rig.ticks(3);
  assert.match(opt.rig.host.core.stats.lastError, /^trouble\.tick: the key "prototype" is not allowed in rules/);
  // A query result is a frozen copy: a write to it throws, whatever the types said.
  const frozen = await wallGame('frozen', 'self.n = 1; const found = world.near(self.pos, 8); found[0].n = 99; self.n = 2;');
  frozen.rig.ticks(3);
  assert.match(frozen.rig.host.core.stats.lastError, /^trouble\.tick: .*(read only|read-only|not extensible|frozen)/i);
  assert.equal(frozen.rig.ents(1)[0].fields[0], 1);
  // An event sent without being declared is named.
  const undeclared = await wallGame('undeclared', 'self.n = 1; world.send(self.id, "bonus", {}); self.n = 2;');
  undeclared.rig.ticks(3);
  assert.equal(undeclared.rig.host.core.stats.lastError, 'trouble.tick: the event "bonus" is not declared in shapes');
  // When a tick has used budget.tick, handlers not yet run are skipped and events not yet run stay queued.
  const greedy = await wallGame('greedy', 'world.send(self.id, "ping", {}); world.send(self.id, "ping", {}); world.send(self.id, "ping", {}); world.send(self.id, "ping", {}); world.send(self.id, "ping", {}); world.send(self.id, "ping", {});', ', on: { ping(world, self) { self.n += 1; for (let i = 0; i < 9000; i += 1) { self.n += 0; } } }');
  greedy.rig.ticks(12);
  const st = greedy.rig.host.core.stats;
  assert.ok(st.ticksCut > 0 && st.skipped > 0, 'ticks ended early');
  const ran = greedy.rig.ents(1)[0].fields[0];
  greedy.rig.host.core.setPolicy({});
  assert.ok(ran > 10 && ran < 6 * 10, `${ran} of the queued events have run so far, four a tick, and none was lost`);
});

test('the overrun check: a room whose ticks keep starting late ends, and a room that only ran after a slow one does not', async () => {
  const { L, compile } = await coinDash();
  const c = compile({});
  // One isolate, one clock: a slow room's tick takes 120 ms of it, so the tick after it starts late, whichever room's it is.
  const clock = fakeClock();
  const fast = hostRig(L, c, { clock });
  const slow = hostRig(L, c, { clock, host: { send: (m) => { if (m.t === 'snap') clock.t += 120; } } });
  slow.join(0); fast.join(0);
  assert.ok(slow.host.running && fast.host.running);
  clock.advance(4000);
  assert.equal(slow.ended.length, 0, 'not yet: five seconds of it');
  clock.advance(12_000);
  assert.equal(slow.ended.length, 1);
  assert.equal(slow.ended[0].why, 'overrun');
  assert.ok(slow.lines.some((l) => l.ev === 'host-ended' && l.why === 'overrun' && typeof l.worst === 'string'), 'the log names the handler that used the most');
  assert.equal(fast.ended.length, 0, 'the room that ran after it was slowed, not ended');
  assert.equal(fast.host.running, true);
  // With the slow room gone the other keeps its beat: no tick starts late any more.
  const before = fast.host.facts().late;
  const tick = fast.host.tick;
  clock.advance(2000);
  assert.equal(fast.host.tick, tick + 40);
  assert.equal(fast.host.facts().late, before === 0 ? 0 : fast.host.facts().late);
  // A room that hitches once is not ended: lateness does not add up, and the clock never jumps.
  const one = hostRig(L, c);
  one.join(0);
  one.clock.advance(1000);
  one.clock.t += 1500;
  one.clock.advance(3000);
  assert.equal(one.ended.length, 0);
  assert.ok(one.host.tick >= 20 + 60 && one.host.tick <= 20 + 60 + 4, `after a 1.5 s hitch it is on tick ${one.host.tick}: the gap was not run again`);
});

test('world has no way out: everything reachable from it is plain frozen data and functions the runtime made', async () => {
  const { L, compile } = await coinDash();
  const secret = { storage: 'the Table', env: { DB: 1 } };
  const clock = { now: () => 0, setTimer: () => 0, clearTimer() {}, secret };
  const send = () => secret;
  const host = L.H.createHost({ game: 'x', compiled: compile({}), clock, send, store: secret, log: () => secret, random: () => 0.1 });
  host.frame({ t: 'join', peer: { id: 'a', seat: 0, name: 'A', occ: 1 } });
  host.tickNow(); host.tickNow();
  const world = host.core.world;
  const seen = new Set();
  const plain = new Set([Object.prototype, Function.prototype, Array.prototype, null]);
  const bad = [];
  const walk = (v, path) => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) return;
    seen.add(v);
    if (v === secret || v === clock || v === send || v === host || v === host.core) bad.push(`${path} is the runtime's own`);
    const proto = Object.getPrototypeOf(v);
    if (!plain.has(proto)) bad.push(`${path} has a prototype of its own`);
    if (typeof v === 'object' && !Object.isFrozen(v)) bad.push(`${path} is not frozen`);
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof v === 'function' && ['length', 'name', 'prototype', 'arguments', 'caller'].includes(key)) continue;
      let child;
      try { child = d.get ? d.get.call(v) : d.value; } catch { continue; }
      walk(child, `${path}.${String(key)}`);
    }
  };
  walk(world, 'world');
  assert.deepEqual(bad, []);
  assert.ok(seen.size > 40, `walked ${seen.size} values`);
  for (const name of WORLD_METHODS.filter((n) => !['end', 'spot', 'spots'].includes(n))) assert.equal(typeof world[name], 'function', `world.${name}`);
  assert.throws(() => { 'use strict'; world.tick = 5; }, TypeError);
  assert.throws(() => world.shared.x = 1, TypeError);
  assert.throws(() => world.despawn({}), /takes the entity the handler runs for/);
});

test('the room with the server as host: no browser hosts, and a forged score, state or round frame changes nothing', async () => {
  const { L, compile } = await coinDash();
  const rig = roomRig(L, compile({}));
  const a = rig.conn();
  const w = a.hello('Ada');
  assert.deepEqual([w.t, w.role, w.seat, w.rev], ['welcome', 'replica', 0, 10]);
  assert.deepEqual(w.host, { id: 'server', seat: null }, 'the host is the server, and it is not a client');
  assert.equal(w.ckpt, undefined);
  assert.equal(rig.room.hostId, null);
  assert.equal(rig.room.clients.size, 1, 'the server host is not in clients');
  const b = rig.conn();
  assert.equal(b.hello('Bo').role, 'replica');
  rig.run(1000);
  assert.ok(rig.host.running);
  assert.equal(a.of('snap').length, 20, 'a snapshot a tick');
  assert.equal(a.of('host').length + a.of('role').length, 0, 'nobody was ever elected');
  assert.deepEqual(rig.room.facts().host, { id: 'server', seat: null });
  assert.equal(rig.room.facts().hosted, 'server');
  assert.equal(rig.room.facts().ticks.tick, rig.host.tick, 'tick figures are in the room\'s watch feed');
  assert.deepEqual([...rig.room.caps], ['skill']);
  const roster = a.of('roster').at(-1).slots;
  assert.deepEqual(roster.map((s) => [s.seat, s.name, s.bot]), [[0, 'Ada', false], [1, 'Bo', false], [null, 'Echo', true], [null, 'Wren', true]]);
  // A changed browser says what a host would say. None of it reaches anybody, and none of it is kept.
  const before = { round: JSON.stringify(rig.room.lastRound), state: JSON.stringify(rig.room.stateObject()), roster: JSON.stringify(rig.room.lastRoster) };
  const seenByBo = b.sent.length;
  const tick = rig.room.lastSnap.k;
  a.say({ t: 'snap', k: 999999, st: rig.clock.now(), d: [[9, 0, 0], []], c: [] });
  a.say({ t: 'state', k: 'shared', d: [999] });
  a.say({ t: 'state', k: 'scores', d: { 0: 999 } });
  a.say({ t: 'round', round: { n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [{ slot: 0, seat: 0, name: 'Ada', score: 999, bot: false, place: 1 }] } });
  a.say({ t: 'roster', slots: [{ slot: 0, seat: 0, name: 'Ada the Winner', bot: false }] });
  a.say({ t: 'ckpt', k: 5, st: rig.clock.now(), d: { scores: [999] } });
  a.say({ t: 'caps', caps: ['agents'] });
  a.say({ t: 'yield' });
  a.say({ t: 'ev', k: 'fx', d: [1, [[0, 'e1', []]]] });
  assert.equal(b.sent.length, seenByBo, 'the other player heard nothing of it');
  assert.equal(rig.room.lastSnap.k, tick);
  assert.deepEqual({ round: JSON.stringify(rig.room.lastRound), state: JSON.stringify(rig.room.stateObject()), roster: JSON.stringify(rig.room.lastRoster) }, before);
  assert.equal(rig.room.lastCkpt, null);
  assert.deepEqual([...rig.room.caps], ['skill']);
  // A forged score inside an input frame is only numbers held to the input's types: the score field is not input.
  a.say({ t: 'in', e: rig.host.epoch, k: rig.host.tick + 1, s: [[0, 127, 0, -10, 5, 0, 0, 0, 0, 1, 0, 0, 999, 999]], r: 0, score: 999, d: { score: 999 } });
  rig.run(200);
  const bodies = rig.host.core.bodies();
  assert.ok(bodies.every((x) => x.score < 20), 'no score moved');
  assert.equal(rig.host.core.stats.errors, 0);
});

test('the life of a server-hosted room: it pauses with the last person, resumes on the tick it paused on, and is forgotten when nobody returns', async () => {
  const { L, compile } = await coinDash();
  const rig = roomRig(L, compile({}));
  assert.equal(rig.host.running, false, 'no tick before the first person');
  assert.equal(rig.clock.timers.length, 0);
  const a = rig.conn();
  const token = a.hello('Ada').token;
  const watcher = rig.conn({ watch: true });
  assert.equal(watcher.hello('Screen').seat, null);
  rig.run(2000);
  assert.equal(rig.host.tick, 40);
  // The last person's socket closes: the room pauses. The timer is cleared, and a watcher does not keep it ticking.
  a.drop();
  assert.deepEqual(rig.events, ['pause']);
  assert.equal(rig.host.paused, true);
  assert.equal(rig.clock.timers.length, 0, 'no timer is pending: nothing keeps the object awake but sockets');
  rig.run(5000);
  assert.equal(rig.host.tick, 40, 'the clock stopped');
  // An AI seat does not keep it ticking either.
  const ai = rig.conn({ agent: { pass: 'p1', role: 'party', hands: 'self', by: 'studio', name: 'Robo' } });
  assert.equal(ai.hello('Robo').seat, 7);
  rig.run(1000);
  assert.equal(rig.host.tick, 40);
  assert.equal(rig.host.people, 0);
  // The person returns within the hold: same seat, same body, and the room resumes at the tick it paused on.
  const a2 = rig.conn();
  const back = a2.hello('Ada', { token });
  assert.equal(back.seat, 0);
  assert.deepEqual(rig.events, ['pause', 'resume']);
  rig.run(50);
  assert.equal(rig.host.tick, 41, 'no tick was skipped and none ran for the gap');
  const me = rig.host.core.bodies().find((x) => x.seat === 0);
  assert.deepEqual([me.driver, me.away], ['person', false]);
  assert.equal(rig.host.core.bodies().find((x) => x.seat === 7).driver, 'ai');
  // A second person leaves for good: after the relay's hold (60 s) the seat is given up, and its body is a bot's.
  const b = rig.conn();
  assert.equal(b.hello('Bo').seat, 1);
  rig.run(500);
  b.drop();
  rig.run(1000);
  assert.deepEqual([rig.host.core.bodies().find((x) => x.seat === 1).driver, rig.host.core.bodies().find((x) => x.seat === 1).away], ['person', true], 'away while the seat is held');
  rig.run(61_000);
  assert.equal(rig.host.core.bodies().find((x) => x.seat === 1).driver, 'bot', 'leave: \'bot\' keeps the body as a bot');
  assert.equal(rig.host.running, true, 'closing one socket did not interrupt the others');
  // Everybody leaves and nobody returns: paused, then forgotten, and the host runtime is stopped.
  a2.drop();
  watcher.drop();
  assert.equal(rig.host.paused, true);
  rig.run(61_000);
  assert.ok(rig.events.includes('forgotten'));
  assert.equal(rig.room.seats.size, 0);
  assert.equal(rig.host.running, false);
  assert.equal(rig.clock.timers.length, 0);
  // The next visitor gets a fresh room: a new runtime, a new epoch, tick 1.
  const old = rig.host.epoch;
  rig.start();
  const c = rig.conn();
  assert.equal(c.hello('Cy').seat, 0);
  rig.run(100);
  assert.equal(rig.host.tick, 2);
  assert.ok(rig.host.epoch > 0 && typeof old === 'number');
});

test('rules that cannot start refuse joins and say why, and a room never falls back to a browser by itself', async () => {
  const { L, compile } = await coinDash();
  const rig = roomRig(L, compile({}));
  rig.room.failServerHost('This game\'s rules could not start: entities.runner.on.boom: no event "boom" is declared in shapes.events');
  const a = rig.conn();
  const res = a.hello('Ada');
  assert.deepEqual([res.t, res.code], ['error', 'host-failed']);
  assert.match(res.message, /no event "boom" is declared/);
  assert.deepEqual(a.closed, [1008, 'host-failed']);
  assert.equal(rig.room.hostId, null);
  assert.equal(rig.room.facts().hostFailed.length > 0, true);
  // A 3D game is declared in full and refused by this release's core with the reason.
  const flat = compile({});
  assert.throws(() => L.C.createCore({ ...flat, dims: 3 }), /this release runs rules with space\.dims: 2/);
});
