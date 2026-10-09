/** The browser adapter uses the host's clock, save and guard, with the Lab's tunables and stage. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { prepareRules, viewPlugin } from '../lib/rules-build.mjs';
import { flatTunables, setLabTunables } from '../lib/lab.mjs';
import { rulesRun } from '../lib/lab-check.mjs';
import { esbuildOf, fakeClock, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-browser-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const SOURCE = `import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 }, move: defineMove({ pawn(body, input, ctx) {} }),
  shapes: { events: { bonus: { amount: f.u8() } }, commands: { add: { amount: f.u8() } }, effects: {} },
  entities: { pawn: { player: true, commands: { add(world, self, e) { self.score += e.amount; } }, on: { bonus(world, self, e) { self.score += e.amount; } }, body: { shape: 'circle', radius: 0.5, maxSpeed: 10 }, fields: { score: f.u32({ score: true }) },
    tick(world, self) { self.score += world.stage === 'dummy' ? world.tune.gain : 1; } } },
  room: { join(ctx, player) { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; } }
});`;
let bundle;
async function code(labBuild = true) {
  if (bundle && labBuild) return bundle;
  const dir = writeGame(scratch, 'local', { rules: SOURCE });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-10, -10], max: [10, 10] } }));
  writeFileSync(join(dir, 'tunables.json'), JSON.stringify({ gain: { value: 2, min: 1, max: 10 }, public: { speed: { value: 3, min: 1, max: 10 } } }));
  const g = { id: 'local', dir, room: { host: 'server', offline: false }, players: { max: 4 } };
  const esbuild = await esbuildOf();
  const rules = await prepareRules(esbuild, scratch, g);
  const result = await esbuild.build({ entryPoints: ['homie:host'], bundle: true, format: 'iife', globalName: 'factory', platform: 'neutral', write: false, plugins: [viewPlugin(g, rules, '', { lab: labBuild })] });
  const text = result.outputFiles[0].text;
  if (labBuild) bundle = text;
  return text;
}
function adapter(text, { stage = null, gain = 2, restore = null, peers = undefined } = {}) {
  const clock = fakeClock();
  const frames = [];
  const math = Object.create(Math); math.random = () => 0.37;
  const context = { Math: math, structuredClone, TextEncoder, TextDecoder, setTimeout: clock.setTimer.bind(clock), clearTimeout: clock.clearTimer.bind(clock), window: { __homieLab: { v: 1, stage, tunables: () => ({ gain, 'public.speed': 8 }) } } };
  runInNewContext(text, context);
  const host = context.factory.makeHost({ now: clock.now, restore, peers, send: (m) => frames.push(structuredClone(m)), onEnd: (why) => assert.fail(why) });
  host.sync([{ id: 'one', seat: 0, name: 'One', occ: 1 }]); host.start();
  return { host, clock, frames };
}

test('the Lab feeds private sliders and world.stage into the same guarded runtime, and each take repeats', async () => {
  const text = await code();
  const run = (options) => {
    const r = adapter(text, options);
    r.clock.advance(1000);
    const saved = structuredClone(r.host.save()); r.host.stop();
    return { saved, frames: r.frames };
  };
  const a = run({ stage: 'dummy', gain: 7 });
  const b = run({ stage: 'dummy', gain: 7 });
  assert.deepEqual(a, b, 'the same seed and clock produce identical saves and output');
  const scores = (r) => r.saved.data.core.ents.map((e) => e[17][0]);
  assert.deepEqual(scores(a), [140]);
  assert.deepEqual(scores(run({ stage: 'dummy', gain: 2 })), [40], 'a slider changes gameplay');
  assert.deepEqual(scores(run({ stage: null, gain: 7 })), [20], 'normal play has no Lab stage');
  const r = adapter(text, { stage: 'dummy', gain: 7, restore: a.saved });
  const before = r.host.tick;
  r.clock.advance(500);
  assert.equal(r.host.tick, before + 10, 'a promoted browser continues the saved tick');
  assert.deepEqual(structuredClone(r.host.save()).data.core.ents.map((e) => e[17][0]), [210]);
  r.host.stop();
  const stopped = r.host.tick; r.clock.advance(1000); assert.equal(r.host.tick, stopped, 'demotion clears the fixed-step timer');
});

test('public sliders round-trip without moving private tunables or losing their ranges', () => {
  const spec = { gain: { value: 2, min: 1, max: 10 }, public: { speed: { value: 3, min: 1, max: 10 } } };
  assert.deepEqual(Object.keys(flatTunables(spec)), ['gain', 'public.speed']);
  const r = setLabTunables(spec, { 'public.speed': 12, gain: 4 });
  assert.equal(r.spec.public.speed.value, 12); assert.equal(r.spec.public.speed.max, 12);
  assert.equal(r.spec.gain.value, 4); assert.equal(r.spec['public.speed'], undefined);
  assert.equal(spec.public.speed.value, 3);
  assert.equal(setLabTunables(spec, { 'public.unknown': 1 }).refused.length, 1);
  assert.equal(rulesRun({ hosting: true, connected: false, tick: 12, status: 'playing' }), true);
  for (const patch of [{ hosting: false }, { connected: true }, { tick: 0 }, { status: 'offline' }]) assert.equal(rulesRun({ hosting: true, connected: false, tick: 12, status: 'playing', ...patch }), false);
});

for (const delays of [Array(10).fill(1000), [30000], [6000]]) test(`browser timers recover after ${delays.join(',')} ms delays`, async () => {
  const r = adapter(await code(false));
  r.clock.advance(2000);
  for (const delay of delays) {
    r.clock.t += delay;
    const timer = r.clock.timers.shift();
    timer.fn();
  }
  const before = r.host.tick;
  r.clock.advance(1000);
  assert.equal(r.host.tick, before + 20);
  r.host.stop();
});

test('a malformed saved core is refused before restoration', async () => {
  const r = adapter(await code()); r.clock.advance(500);
  const save = structuredClone(r.host.save()); r.host.stop();
  save.data.core.tick = 'poison';
  assert.throws(() => adapter(bundle, { restore: save }), /save|checkpoint/i);
});

test('production ignores a page-defined Lab stage and tuning', async () => {
  const text = await code(false);
  assert.doesNotMatch(text, /__homieLab/);
  const r = adapter(text, { stage: 'dummy', gain: 9 });
  r.clock.advance(1000);
  assert.deepEqual(structuredClone(r.host.save()).data.core.ents.map((e) => e[17][0]), [20]);
  r.host.stop();
});

test('damaged saved commands and queued events are rejected', async () => {
  const r = adapter(await code()); r.clock.advance(1000);
  const saved = structuredClone(r.host.save()); r.host.stop();
  const e = saved.data.core.ents[0];
  e[20] = [{ name: 'add', data: { amount: 1000, extra: true } }];
  saved.data.core.queue.push([saved.data.core.tick + 1, 0, '', 1, e[0], 'ev', 'bonus', { amount: 1000 }, saved.data.core.tick, 0]);
  assert.throws(() => adapter(bundle, { restore: saved }), /saved rules state/);
});

test('a saved seat identity is replaced by the relay peer before rules run', async () => {
  const r = adapter(await code()); r.clock.advance(500);
  const saved = structuredClone(r.host.save()); r.host.stop();
  saved.data.core.ents[0][12] = 'ai'; saved.data.core.seats[0][1] = 'ai';
  saved.data.core.ents[0][15] = { goal: 'forged' };
  const restored = adapter(bundle, { restore: saved, peers: [{ id: 'one', seat: 0, occ: 1 }] });
  const core = structuredClone(restored.host.save()).data.core;
  assert.equal(core.ents[0][12], 'person'); assert.equal(core.ents[0][15], null);
  assert.equal(core.seats[0][1], 'person'); restored.host.stop();
});

test('restoration refuses exhausted counters, duplicate seats and unbounded round deadlines', async () => {
  const r = adapter(await code()); r.clock.advance(500);
  const save = structuredClone(r.host.save()); r.host.stop();
  for (const mutate of [s => { s.core.tick = Number.MAX_SAFE_INTEGER; }, s => { s.core.tick = 2 ** 32; }, s => { s.core.round[2] = Number.MAX_SAFE_INTEGER; }, s => {
    const e = structuredClone(s.core.ents[0]); e[0] = 'ezz'; e[1] = 1295; s.core.nextId = 1296; s.core.ents.push(e);
  }]) {
    const bad = structuredClone(save); mutate(bad.data);
    assert.throws(() => adapter(bundle, { restore: bad }), /save|round|counter|seat/i);
  }
});

test('the production Worker adapter enables overrun attribution', async () => {
  const { PKG, COIN_DASH, loadGame } = await import('./rules-kit.mjs');
  const L = await loadGame(scratch, COIN_DASH, 'worker-overrun');
  const clock = fakeClock(); const ended = [];
  const ctx = { TextEncoder, TextDecoder, Date: { now: clock.now }, setTimeout: clock.setTimer.bind(clock), clearTimeout: clock.clearTimer.bind(clock) };
  // The declarations are runtime branded; load the guarded game in the adapter's instance too.
  const gameFile = join(scratch, 'worker-game.mjs'); writeFileSync(gameFile, L.code);
  const compiled = await (await esbuildOf()).build({ stdin: { contents: `import def from ${JSON.stringify(gameFile)}; import { hostRules, startHost } from ${JSON.stringify(join(PKG, 'worker/hosted.mjs'))}; hostRules({ game: { rules: def, settings: ${JSON.stringify(L.R.roomSettings({}).settings)}, map: ${readFileSync(join(COIN_DASH, 'map/main.json'), 'utf8')}, tune: ${readFileSync(join(COIN_DASH, 'tunables.json'), 'utf8')}, seats: 4 } }); export { startHost };`, resolveDir: scratch }, bundle: true, format: 'iife', globalName: 'worker', write: false, plugins: [(await import('../lib/rules-build.mjs')).rulesModulesPlugin()] });
  runInNewContext(compiled.outputFiles[0].text, ctx);
  const host = ctx.worker.startHost('game', { send: m => { if (m.t === 'snap') clock.t += 120; }, onEnd: why => ended.push(why) });
  host.frame({ t: 'join', peer: { id: 'one', seat: 0, occ: 1 } });
  clock.advance(15000); host.stop();
  assert.deepEqual(ended, ['overrun']);
});

test('late browser callbacks coalesce round corrections within the relay rate', async () => {
  const r = adapter(await code(false)); r.clock.advance(1000);
  for (let i = 0; i < 80; i += 1) { r.clock.t += 170; r.clock.timers.shift().fn(); }
  const rounds = r.frames.filter(m => m.t === 'round');
  assert.ok(rounds.length <= 55, `received ${rounds.length} corrections`);
  r.host.stop();
});


for (const [grain, ticks] of [[70, 200], [100, 200], [250, 40]]) test(`a 20-tick browser host whose timers fire every ${grain} ms runs ${ticks} ticks in ten seconds`, async () => {
  // Timers land on a grid, as a busy or throttled page's do. Up to a tenth of a second late the host catches up, as
  // the server does; later than that its clock runs slow, which is what tells the relay to find a faster host.
  const r = adapter(await code(false)); const before = r.host.tick; const start = r.clock.t; const end = start + 10000;
  while (r.clock.t < end) {
    r.clock.t = Math.min(end, (Math.floor(r.clock.t / grain) + 1) * grain);
    for (const timer of r.clock.timers.filter(x => x.at <= r.clock.t)) { r.clock.timers = r.clock.timers.filter(x => x !== timer); timer.fn(); }
  }
  assert.ok(Math.abs(r.host.tick - before - ticks) <= 2, `${r.host.tick - before} ticks`);
  const announced = r.frames.filter(m => m.t === 'round' && !m.retime).length;
  assert.ok(announced <= 1, 'a late timer never announces the round again');
  r.host.stop();
});

test('a deep checkpoint is refused deliberately before cloning', async () => {
  const r = adapter(await code()); r.clock.advance(500);
  const saved = r.host.save(); r.host.stop();
  let deep = {}; for (let i = 0; i < 10000; i++) deep = { deep };
  saved.data.core.ents[0][15] = deep;
  assert.throws(() => adapter(bundle, { restore: saved }), /checkpoint.*depth/i);
});

test('hostile saved shapes are rejected rather than coerced by browser restore', async () => {
  const text = await code(false), original = adapter(text);
  original.clock.advance(1000);
  const good = structuredClone(original.host.save()); original.host.stop();
  const changes = {
    'overflowing vector': s => { s.data.core.ents[0][7] = [1e308, -1e308, 1e308]; },
    'non-goal value': s => { s.data.core.ents[0][15] = { arbitrary: true }; },
    'malformed pending ask': s => { s.data.core.asks = [null]; },
    'malformed core guide view': s => { s.data.core.guideViews = [[0, 'wrong']]; },
    'malformed host guide view': s => { s.data.guideViews = [[0, { id: 'e1', at: 'later', value: {} }]]; },
    'malformed companion table': s => { s.data.agents = { goals: 'wrong' }; },
    'unknown core key': s => { s.data.core.extra = 1; },
    'unknown envelope key': s => { s.data.extra = 1; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const saved = structuredClone(good); change(saved);
    assert.throws(() => adapter(text, { restore: saved }), /saved|checkpoint/, label);
  }
  // Large but canonical values belong to the host's state. They cannot forge relay identity,
  // and the normal movement/rules constraints still apply on every following tick.
  for (const change of [s => { s.data.core.ents[0][17][0] = 1e9; }, s => { s.data.core.ents[0][8] = [1e6, 0, 0]; }]) {
    const saved = structuredClone(good); change(saved);
    const restored = adapter(text, { restore: saved });
    assert.equal(restored.host.save().data.core.ents[0][12], 'person');
    restored.clock.advance(1000); assert.ok(restored.host.tick > good.data.core.tick);
    restored.host.stop();
  }
});
