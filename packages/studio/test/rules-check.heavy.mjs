/**
 * The generated check (lib/rules-check.mjs): what refuses a build, what is only said, and that both are the same every time.
 * The design's fifteen planted faults are here too, each named at its own line.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { guardRules, problemLine } from '../lib/rules-guard.mjs';
import { ALLOWANCE, LONG_ALLOWANCE, checkRules, runRulesWorker } from '../lib/rules-check.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { esbuildOf, writeGame, COIN_MAP, COIN_DASH } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-check-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const definition = (body, top = '') => `import { defineRules, f } from '@homie-rocks/studio/rules';
${top}
export default defineRules({ contract: 2, space: { dims: 2 },
entities: { dot: { fields: { count: f.u16(), list: f.list(f.u8(), 2) }, tick(world, self) {
${body}
} } }, room: { start(world) { world.spawn('dot', { x: 0, y: 0, z: 0 }); } } });`;
async function check(source, name = 'dot', options = {}, move = null, tune = {}) {
  const dir = writeGame(scratch, name, { rules: source, move });
  const e = await esbuildOf(); const guarded = await guardRules(e, scratch, dir);
  if (!guarded.ok) throw new Error(guarded.problems.map(problemLine).join('\n'));
  const result = await checkRules(e, scratch, name, guarded.code, { map: COIN_MAP, tune, seats: 4, sites: guarded.sites }, options);
  return { result, dir };
}
const planted = readFileSync(new URL('./fixtures/rules/planted-faults.ts', import.meta.url), 'utf8');
const lines = planted.split('\n');
for (let i = 0; i < lines.length; i += 1) {
  if (!lines[i].startsWith('// fault: ')) continue;
  const name = lines[i].slice(10); const start = i + 1;
  let target = start + 1;
  while (lines[i + 1] !== '// end-fault') { i += 1; target = i + 1; }
  test(`planted fault: ${name}, author line ${target}`, async () => {
    // Keep the author's line numbers exactly: only blank the other planted faults.
    let active = true;
    const source = lines.map((line) => {
      if (line.startsWith('// fault: ')) { active = line.slice(10) === name; return ''; }
      if (line === '// end-fault') { active = true; return ''; }
      return active ? line : '';
    }).join('\n');
    await assert.rejects(check(source, `fault-${start}`), (e) => {
      assert.match(e.message, new RegExp(`src/rules\\.ts:${target}(?:\\D|$)`), e.message);
      assert.match(e.message, /not |cannot|outside|budget|too long|declared|read.only|frozen|size|constructor|prototype|module|await|load|Math|exponent|available/i);
      return true;
    });
  });
}
/** Rejects with a message that matches, from its first character: what the chat is shown. */
const refuses = (promise, pattern) => assert.rejects(promise, (e) => { assert.match(e.message, pattern); return true; });
const short = { allowance: { ticks: 400 } };
const coin = (name, change = {}) => check(change.rules ?? readFileSync(join(COIN_DASH, 'src/rules.ts'), 'utf8'), name, change.options ?? short, change.move ?? readFileSync(join(COIN_DASH, 'src/move.ts'), 'utf8'), { public: { speed: { value: 6 } } });

test('a correct game builds: one line says how much was played, and a handler that never ran is information', async () => {
  const { result } = await check(definition('self.count += 1;').replace('room: {', "room: { on: { undeliverable() {} },"), 'counts', short);
  assert.equal(result.ticks, 400);
  assert.equal(result.restores, 207, 'rebuilt from its save before each of the first 200 ticks, then before every 29th');
  assert.equal(result.information.length, 2);
  assert.match(result.information[0], /^counts\/src\/rules\.ts:3: the generated play covered 400 ticks \(20 seconds of the room's clock\), 0 rounds finished, the room rebuilt from its save and compared 207 times, stopped at its allowance of 400 ticks; it ended holding 1 entities and 0 waiting events in a save of \d+ bytes\. `homie-studio build --long-check` plays eight times as much\. Play it did not reach is not checked\.$/);
  assert.match(result.information[1], /^counts\/src\/rules\.ts:6: room\.on\.undeliverable never ran in the generated play\. This is information, not proof that play cannot reach it\.$/);
});

test('a handler that throws refuses the build with its file, line, handler and the tick of the play', async () => {
  await refuses(check(definition('if (world.tick === 30) { const none: number[] = [];\nself.count = none[3].toFixed.length; }')), /^dot\/src\/rules\.ts:6 dot\.tick: The value before \.toFixed is absent\. Check that the map spot, list entry or query result exists before reading \.toFixed\. This was tick 30 of the generated play \(1\.5 seconds in, round 1\)\.$/);
  await refuses(check(definition("world.send(self.id, 'missing', {});")), /src\/rules\.ts:5 dot\.tick: the event "missing" is not declared in shapes\. Declare the name and its payload in shapes before sending it\./);
});

test('a tick that runs out of budget refuses the build, whether one handler was stopped or many used it up together', async () => {
  await refuses(check(definition('while (true) { self.count += 0; }')), /src\/rules\.ts:5 dot\.tick: this handler ran too long: it used its whole share of the tick \(a loop that never ends, or too much work in one step\)\. Bound this loop or split the work across ticks\./);
  const many = definition('let n = 0; for (let i = 0; i < 15000; i += 1) n += i; self.count = n % 7;').replace("world.spawn('dot', { x: 0, y: 0, z: 0 });", "for (let i = 0; i < 40; i += 1) world.spawn('dot', { x: 0, y: 0, z: 0 });");
  await refuses(check(many, 'many'), /^many\/src\/rules\.ts:4 dot\.tick: this tick used its whole budget of 500000 units, so handlers were left unrun; this handler used the most \(\d+ units in one call\)\. Bound the work of each tick/);
});

test('a body whose own move outruns its declared top speed is held back by the server, and that refuses the build', async () => {
  const rules = readFileSync(join(COIN_DASH, 'src/rules.ts'), 'utf8').replace('maxSpeed: 6 }', "maxSpeed: 6, move: 'owner' }");
  const fast = readFileSync(join(COIN_DASH, 'src/move.ts'), 'utf8').replace('ctx.tune.speed', '12');
  await refuses(coin('fast', { rules, move: fast }), /^fast\/src\/move\.ts:\d+ runner\.move: the server held this body back: one step of this move, from where the server has the body, goes further than the server lets a body go in a tick \(body\.maxSpeed is 6 m\/s\)\. A player would see their character pulled back\./);
  await coin('at-speed', { rules });
});

test('a value the room had to change is a fault of the build, named at the line that wrote it; a live room stores it as it always did', async () => {
  // The write is on line 6 of a handler that ends on line 8: the write is named, not where the handler ended.
  await refuses(check(definition('const zero = world.tick * 0;\nself.count = zero / zero;\nself.count = 1;\nself.count += 1;')), /^dot\/src\/rules\.ts:6 dot\.tick: dot\.fields\.count was written NaN, which is not a number\. A live room does not stop for this: it stores 0 there, and the game plays on with a wrong value\. Check the divisor before dividing, and that every value read exists\. This was tick 2 of the generated play/);
  await refuses(check(definition('self.list = [1, 2, 3];')), /src\/rules\.ts:5 dot\.tick: dot\.fields\.list was written a list of 3 entries for a size of 2\. A live room does not stop for this: it keeps the first entries and drops the rest\. Remove old entries before adding, or declare the size the game needs\./);
  await refuses(check(definition("self.note = 'a text of more than eight';").replace('count: f.u16()', 'count: f.u16(), note: f.text(8)')), /src\/rules\.ts:5 dot\.tick: dot\.fields\.note was written a text of 25 characters for a size of 8\. A live room does not stop for this: it cuts the text to its size\. Shorten the text, or declare the size the game needs\./);
  await refuses(check(definition("self.seen = { ...self.seen, ['k' + world.tick]: 1 };").replace('count: f.u16()', 'count: f.u16(), seen: f.map(f.u8(), 3)')), /src\/rules\.ts:5 dot\.tick: dot\.fields\.seen was written a map of 4 keys for a size of 3\..*it drops the keys past its size\..*This was tick 5 of the generated play/);
  await refuses(check(definition('self.half = 1 / (world.tick - world.tick);').replace('count: f.u16()', 'count: f.u16(), half: f.fix()')), /src\/rules\.ts:5 dot\.tick: dot\.fields\.half was written Infinity, which a fraction or a vector cannot hold\. A live room does not stop for this: it stores 0 there\./);
  await refuses(check(definition("for (let i = 0; i < 300; i += 1) world.emit('spark', self.pos, {});").replace('entities:', 'shapes: { effects: { spark: {} } }, entities:')), /src\/rules\.ts:5 dot\.tick: more than 256 effects were emitted in one tick \(this one: spark\)\. A live room does not stop for this: it drops the rest/);
});

test('a collection changed in place is held to its type when the handler ends: the build names the handler and says so', async () => {
  await refuses(check(definition('const none = 0;\nself.list.push(1);\nself.count += 1;')), /^dot\/src\/rules\.ts:4 dot\.tick: dot\.fields\.list was changed in place in this handler \(not assigned\), and when the handler ended it held a list of 3 entries for a size of 2\. A live room does not stop for this: it keeps the first entries and drops the rest\..*This was tick 4 of the generated play/);
});

test('a whole number written past its range is held to the range, as a live room holds it: one line of information, and the build passes', async () => {
  const { result } = await check(definition('self.count = Infinity; self.small = world.tick;').replace('count: f.u16()', 'count: f.u16(), small: f.u8()'), 'ranged', short);
  const said = result.information.filter((line) => /outside its range/.test(line));
  assert.equal(said.length, 2, result.information.join('\n'));
  assert.match(said[0], /^ranged\/src\/rules\.ts:5: dot\.tick: dot\.fields\.count was written a whole number outside its range 399 times in this play \(the first: Infinity\), and holds the nearest end of the range, as a live room does\. This is information: nothing to change if the clamp is meant\.$/);
  assert.match(said[1], /^ranged\/src\/rules\.ts:5: dot\.tick: dot\.fields\.small was written a whole number outside its range 145 times in this play \(the first: 256\)/);
});

test('a move that leaves a position that is not a number refuses the build, whoever runs the move', async () => {
  const rules = `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({ contract: 2, space: { dims: 2 }, move,
entities: { runner: { player: OWNER, input: { ax: f.i8() }, body: { shape: 'circle', radius: 0.5, maxSpeed: 1BODY }, think() { return { ax: 1 }; } } },
room: { bots: { keep: 2 }, join() { return { kind: 'runner', at: { x: 0, y: 0, z: 0 } }; } } });`;
  const move = `import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({ runner(body, input, ctx) {
if (ctx.tick === 50) body.pos = { x: 0 / 0, y: 0, z: 0 };
} });`;
  // A present person's body is stepped by their browser (rules/pack.ts `stepMove`, the one step the browser and the check share).
  await refuses(check(rules.replace('OWNER', 'true').replace('BODY', ", move: 'owner'"), 'own-move', {}, move), /src\/move\.ts:3 runner\.move: body\.pos\.x was written NaN, which is not a number\. A live room does not stop for this: it stores 0 there/);
  await refuses(check(rules.replace('OWNER', "{ away: 'think', leave: 'bot' }").replace('BODY', ''), 'server-move', {}, move), /src\/move\.ts:3 runner\.move: body\.pos\.x was written NaN, which is not a number\./);
});

test("the browser's move the check plays for each person is counted in the same units, and the play stops at its allowance", async () => {
  const rules = `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({ contract: 2, space: { dims: 2 }, move,
entities: { runner: { player: true, input: { ax: f.i8() }, motion: { n: f.u16() }, body: { shape: 'circle', radius: 0.5, maxSpeed: 1, move: 'owner' } } },
room: { join() { return { kind: 'runner', at: { x: 0, y: 0, z: 0 } }; } } });`;
  const move = `import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({ runner(body) { let n = 0; for (let i = 0; i < 4000; i += 1) n += i; body.motion.n = n % 7; } });`;
  const allowance = { ticks: 5000, units: 2_000_000, restoreBytes: 60_000 };
  const { result } = await check(rules, 'costly-move', { allowance }, move);
  assert.equal(result.plays[0].stopped, 'units');
  assert.ok(result.ticks < 500 && result.units >= 2_000_000, `${result.ticks} ticks, ${result.units} units`);
  assert.ok(result.maxTickUnits < 5000, `the server's own ticks are light (${result.maxTickUnits}): what was counted is the move`);
  assert.match(result.information[0], /compared \d+ times, stopped at its allowance of 2000000 budget units; it ended/);
});

test('state kept outside the declared fields is caught by rebuilding the room from its save', async () => {
  // Below the static check, which refuses a module-level `let` by itself: the comparison is proven on its own.
  const source = definition('G.t("games/hidden/src/rules.ts", 5); self.count = ++memory;', 'let memory = 0;')
    .replace("import { defineRules, f }", "import * as G from '@homie-rocks/studio/rules/guard';\nimport { defineRules, f }");
  await refuses(checkRules(await esbuildOf(), scratch, 'hidden', source, { map: COIN_MAP, tune: {}, seats: 1 }),
    /^games\/hidden\/src\/rules\.ts: a room rebuilt from its save and given the same input does not play the same as the room that kept running; first difference at ents\.e1\.fields\.count \(\d+ against \d+\)\. This was tick 2 of the generated play.*Keep everything that changes in fields, motion or shared/);
});

test('the play is bounded in ticks and budget units, and the same source gives the same result every time', async () => {
  const heavy = definition('let n = 0; for (let i = 0; i < 2000; i += 1) n += i; self.count = n % 7;').replace("world.spawn('dot', { x: 0, y: 0, z: 0 });", "for (let i = 0; i < 20; i += 1) world.spawn('dot', { x: 0, y: 0, z: 0 });");
  const allowance = { ticks: 5000, units: 3_000_000, restoreBytes: 60_000 };
  const a = (await check(heavy, 'heavy', { allowance })).result;
  const b = (await check(heavy, 'heavy', { allowance })).result;
  assert.deepEqual(a, b);
  assert.equal(a.plays[0].stopped, 'units');
  assert.ok(a.ticks < 5000 && a.units >= 3_000_000 && a.units < 3_000_000 + 2 * a.maxTickUnits, `${a.ticks} ticks, ${a.units} units`);
  assert.ok(a.restores > 0 && a.restores * 300 < 60_000 + a.largestSaveBytes, 'the saves rebuilt stay inside their allowance too');
  assert.match(a.information[0], /compared \d+ times, stopped at its allowance of 3000000 budget units; it ended/);
});

test('the long check plays eight times as far: a fault past the default play is found by it, and the default says how far it went', async () => {
  const late = definition('if (world.tick === 20000) { const none: number[] = [];\nself.count = none[3].toFixed.length; }');
  const { result } = await check(late, 'late');
  assert.equal(result.ticks, ALLOWANCE.ticks);
  assert.match(result.information[0], /the generated play covered 18000 ticks \(900 seconds of the room's clock\).*stopped at its allowance of 18000 ticks.*`homie-studio build --long-check` plays eight times as much\. Play it did not reach is not checked\.$/);
  await refuses(check(late, 'late-long', { allowance: LONG_ALLOWANCE }), /^late-long\/src\/rules\.ts:6 dot\.tick: The value before \.toFixed is absent\..*This was tick 20000 of the generated play/);
});

test('an imported helper names its own author line, and a later caller names its own', async () => {
  const source = definition('help(); world.send(self.id, "missing", {});').replace('export default', 'import { help } from "./helper";\nexport default');
  const dir = writeGame(scratch, 'helper', { rules: source });
  writeFileSync(join(dir, 'src/helper.ts'), 'export function help() { const n = 1; }');
  const e = await esbuildOf(); const g = await guardRules(e, scratch, dir);
  assert.equal(g.ok, true);
  await refuses(checkRules(e, scratch, 'helper', g.code, { map: COIN_MAP, tune: {}, seats: 1 }), /helper\/src\/rules\.ts:6 dot\.tick: .*not declared/);
});

test('a round ended by a timer, and the pending end of a round, survive every rebuild', async () => {
  const source = `import { defineRules } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 }, entities: { dot: {} }, shapes: { events: { end: {} } },
room: { rounds: { seconds: 10, breakSeconds: 3 }, on: { roundStart(world) { world.after(2, 'end', {}); }, end(world) { world.round.end(); } } } });`;
  const { result } = await check(source, 'round-end', short);
  assert.ok(result.roundsPlayed >= 6, `${result.roundsPlayed} rounds`);
});

test('what stops the check itself says so, and never blames the game', async () => {
  await refuses(runRulesWorker('for (;;) {}', { id: 'stuck' }, { superviseSeconds: 1 }), /^games\/stuck: the check itself stopped after running for more than 1 seconds, before it could decide anything about this game\. This is a fault in Homie's check, not in the game's rules/);
  await refuses(runRulesWorker('const a = []; for (;;) a.push(new Array(10000).fill(1));', { id: 'memory' }, { memoryMb: 16 }), /^games\/memory: the check itself stopped when it passed its 16 MB of memory/);
});

test('strict types use fields and shapes, including dormant code and move scope', async () => {
  const source = readFileSync(join(COIN_DASH, 'src/rules.ts'), 'utf8');
  const move = readFileSync(join(COIN_DASH, 'src/move.ts'), 'utf8');
  const dir = writeGame(scratch, 'typed', { rules: source, move });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  const e = await esbuildOf(); const g = await guardRules(e, scratch, dir);
  const tune = { public: { speed: { value: 6 } } };
  const r = await checkRules(e, scratch, 'typed', g.code, { map: COIN_MAP, tune, seats: 8 }, { declarationsOnly: true });
  const game = { id: 'typed', dir };
  await typecheckRules(scratch, game, r, tune);
  const bad = [
    "self.scroe = 3;", "world.shared.missing = 3;", "world.send(self.id, 'take', { by: 4 });",
    "world.near(self.pos, 1, 'coin')[0].pos.x = 3;", "world.finish();", "world.round.end();",
  ];
  for (const text of bad) {
    writeFileSync(join(dir, 'src/rules.ts'), source.replace('self.score += 1;', text));
    await refuses(typecheckRules(scratch, game, r, tune), /src\/rules.ts:\d+:\d+ TS/);
  }
  writeFileSync(join(dir, 'src/rules.ts'), source);
  writeFileSync(join(dir, 'src/move.ts'), move.replace('const M = ctx.math;', 'ctx.random(); body.score = 2; const M = ctx.math;'));
  await refuses(typecheckRules(scratch, game, r, tune), /src\/move.ts:\d+:\d+ TS/);
});

test('the three fixed Coin Dash edit requests keep building and change what was asked', async () => {
  const { loadGame } = await import('./rules-kit.mjs');
  const original = readFileSync(join(COIN_DASH, 'src/rules.ts'), 'utf8');
  const movement = readFileSync(join(COIN_DASH, 'src/move.ts'), 'utf8');
  const trials = [
    { id: 'two-points', rules: original.replace('self.score += 1', 'self.score += 2'), speed: 6 },
    { id: 'thirty-seconds', rules: original.replace('seconds: 60, breakSeconds: 8', 'seconds: 30, breakSeconds: 5'), speed: 6 },
    { id: 'four-metres', rules: original, speed: 4 },
  ];
  for (const t of trials) {
    const dir = writeGame(scratch, t.id, { rules: t.rules, move: movement });
    writeFileSync(join(dir, 'src/view.ts'), 'export {};');
    const e = await esbuildOf(); const g = await guardRules(e, scratch, dir);
    assert.equal(g.ok, true);
    const tune = { public: { speed: { value: t.speed } } };
    const r = await checkRules(e, scratch, t.id, g.code, { map: COIN_MAP, tune, seats: 8 }, { allowance: { ticks: 1600 } });
    await typecheckRules(scratch, { id: t.id, dir }, r, tune);
    if (t.id === 'thirty-seconds') { assert.deepEqual(r.rounds, { seconds: 30, breakSeconds: 5 }); assert.equal(r.roundsPlayed, 2); }
    if (t.id === 'two-points') {
      const L = await loadGame(scratch, dir, t.id); const c = L.R.compileRules(L.def, { tune, map: L.R.compileMap(COIN_MAP) });
      const self = { score: 0 }; c.kindOf.runner.on.score({}, self, {}); assert.equal(self.score, 2);
    }
  }
});

test('prediction replays scalar motion writes with the server coercion before the next read', async () => {
  const rules = `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({ contract: 2, space: { dims: 2 }, move,
entities: { runner: { player: true, input: { ax: f.i8() }, motion: { n: f.u8() }, body: { shape: 'circle', radius: 0.5, maxSpeed: 1 } } },
room: { join() { return { kind: 'runner', at: { x: 0, y: 0, z: 0 } }; } } });`;
  const move = `import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({ runner(body, input, ctx) {
body.motion.n = 1.8;
body.vel = { x: body.motion.n, y: 0, z: 0 };
ctx.map.sweep(body, ctx.math.scale(body.vel, ctx.dt));
} });`;
  const { result } = await check(rules, 'prediction-coercion', { allowance: { ticks: 100, units: 2_000_000, restoreBytes: 60_000 } }, move);
  assert.ok(result.ticks >= 100);
});
