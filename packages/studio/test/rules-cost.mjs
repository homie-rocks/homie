#!/usr/bin/env node
/**
 * What a budget unit costs in time (not a test file: a measurement, run by hand).
 *
 * A room's rules are stopped by a count of units, not by a clock (rules/guard.ts): time inside a Worker stands still
 * while code runs. So the count is only as good as its weights. If some call does a millisecond of work for one
 * unit, a tick can run for seconds inside its budget. This tool plants one heavy handler after another, each burning
 * its share of the tick one way, runs each through the real build wall and the real host runtime, and prints how long a
 * unit took: wall time of the tick divided by the units the tick used.
 *
 *   node packages/studio/test/rules-cost.mjs                 the table, dearest first, and what it means for a tick
 *   node packages/studio/test/rules-cost.mjs --only near     the rows whose name holds "near"
 *   node packages/studio/test/rules-cost.mjs --line 25       exit 1 when any row is over 25 ns a unit
 *
 * The default `budget.tick` (rules/rules.ts `BUDGET_TICK`) was set from this table. Run it again after changing a
 * weight in rules/core.ts or rules/guard.ts, and on the machine the figures are to be quoted for. It measures this
 * computer under Node; what a unit costs on Cloudflare is for the measurement on Cloudflare to say.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COIN_DASH, COIN_MAP, hostRig, loadGame, writeGame } from './rules-kit.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? ''; };
const only = flag('--only');
const line = flag('--line') === null ? null : Number(flag('--line'));

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-cost-')));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

const MAP = { bounds: { min: [-30, -30], max: [30, 30] }, boxes: [{ min: [-1, -1], max: [1, 1] }, { min: [4, 4], max: [5, 5] }], spots: { start: [[0, 0]] } };
/** A game whose one player's `tick` is the planted handler. `rocks`: how many other entities stand around; `pre`: what the player's `arrive` does first. */
const game = (heavy, { rocks = 0, rockFields = 'n: f.u8()', rockInit = '', pre = '' } = {}) => `
import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
const move = defineMove({ pawn() {} });
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: { events: { ping: { n: f.u8() }, big: { path: f.list(f.vec3(), 64) } }, commands: {}, effects: { ding: { n: f.u8() } } },
  entities: {
    pawn: { player: true, body: { shape: 'circle', radius: 0.5, maxSpeed: 1 }, fields: { n: f.u32(), bag: f.list(f.u32(), 1024), path: f.list(f.vec3(), 64), table: f.map(f.u16(), 256), note: f.text(4096) },
      on: { arrive(world, self) { ${pre} } },
      tick(world, self) { if (world.tick < 3) return; ${heavy} } },
    rock: { body: { shape: 'circle', radius: 0.2, maxSpeed: 0 }, fields: { ${rockFields} }, on: { arrive(world, self) { ${rockInit} } } },
  },
  room: { start(world) { for (let i = 0; i < ${rocks}; i += 1) world.spawn('rock', { x: (i % 40) - 20, y: ((i - i % 40) / 40) - 20, z: 0 }, {}); }, join() { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; } },
});`;

const LIST = `const a = []; for (let i = 0; i < 4096; i += 1) a.push((i * 7919) % 4096);`;
const TEXTS = `let a = 'ab'; for (let i = 0; i < 12; i += 1) a = a + a; let b = 'ab'; for (let i = 0; i < 12; i += 1) b = b + b;`;
const LOOP = 'for (let i = 0; i < 90000000; i += 1)';
/** [name, the handler, what stands around]. Every one runs until its share of the tick is gone. */
const PLANTED = [
  ['an empty loop', `let k = 0; ${LOOP} k += 1;`],
  ['arithmetic on fields', `let k = 0; ${LOOP} k = k + self.n * 2 - i;`],
  ['calls of a function of the game\'s', `const fn = (x) => x + 1; let k = 0; ${LOOP} k = fn(k);`],
  ['a list: push', `const a = []; ${LOOP} { if (a.length > 60000) a.splice(0, 60000); a.push(i); }`],
  ['a list of 4,096: includes', `${LIST} let k = 0; ${LOOP} { if (a.includes(-1)) k += 1; }`],
  ['a list of 4,096: map', `${LIST} ${LOOP} { const b = a.map((x) => x); }`],
  ['a list of 4,096: slice and sort', `${LIST} ${LOOP} { const b = a.slice(0); b.sort((x, y) => x - y); }`],
  ['a list of 4,096: slice and a sort with no comparison', `${LIST} ${LOOP} { const b = a.slice(0); b.sort(); }`],
  ['a list of 4,096: spread', `${LIST} ${LOOP} { const b = [...a]; }`],
  ['a list read by a computed key', `${LIST} let k = 0; ${LOOP} k += a[i % 4096];`],
  ['an object read and written by a computed key', `const o = { a: 1, b: 2 }; const ks = ['a', 'b']; ${LOOP} { o[ks[i % 2]] = o[ks[(i + 1) % 2]] + 1; }`],
  ['a text joined to a text', `let s = ''; ${LOOP} { s = s + 'abcdefgh'; if (s.length > 60000) s = ''; }`],
  ['a template', `${LOOP} { const s = \`a\${i}b\${self.n}\`; }`],
  ['two long texts compared', `${TEXTS} let k = 0; ${LOOP} { if (a === b) k += 1; }`],
  ['two long texts put in order', `${TEXTS} let k = 0; ${LOOP} { if (a < b) k += 1; }`],
  ['a long text looked for in a long text', `${TEXTS} b = 'x' + b; let k = 0; ${LOOP} { if (a.includes(b)) k += 1; }`],
  ['a Map: set and get', `const m = new Map(); ${LOOP} { m.set(i % 50000, i); m.get(i % 777); }`],
  ['a Map of 4,096: keys', `const m = new Map(); for (let i = 0; i < 4096; i += 1) m.set(i, i); ${LOOP} { const k = m.keys(); }`],
  ['the keys of an object of 1,000', `const o = {}; for (let i = 0; i < 1000; i += 1) o['k' + i] = i; ${LOOP} { const k = Object.keys(o); }`],
  ['the entries of an object of 1,000', `const o = {}; for (let i = 0; i < 1000; i += 1) o['k' + i] = i; ${LOOP} { const k = Object.entries(o); }`],
  ['an object of 1,000 copied by a spread', `const o = {}; for (let i = 0; i < 1000; i += 1) o['k' + i] = i; ${LOOP} { const k = { ...o }; }`],
  ['the rest of an object of 1,000 taken by a pattern', `const o = {}; for (let i = 0; i < 1000; i += 1) o['k' + i] = i; ${LOOP} { const { k0, ...others } = o; }`],
  ['the rest of a list of 4,096 taken by a pattern', `${LIST} ${LOOP} { const [first, ...others] = a; }`],
  ['a text of 4,096 split into characters', `let s = 'abcdefgh'; for (let i = 0; i < 9; i += 1) s = s + s; ${LOOP} { const b = s.split(''); }`],
  ['a text of 4,096 split at commas', `let s = 'abcdef,h'; for (let i = 0; i < 9; i += 1) s = s + s; ${LOOP} { const b = s.split(','); }`],
  ['a text of 4,096 made upper case', `let s = 'abcdefgh'; for (let i = 0; i < 9; i += 1) s = s + s; ${LOOP} { const b = s.toUpperCase(); }`],
  ['an Error made', `${LOOP} { const e = new Error('no'); }`],
  ['a list written out', `${LOOP} { const a = [i, i, i, i, i, i, i, i]; }`],
  ['an object written out', `${LOOP} { const o = { a: i, b: i, c: i, d: i }; }`],
  ['a function made', `let k = 0; ${LOOP} { const fn = () => i; k += 1; }`],
  ['a number made into a text', `let k = 0; ${LOOP} { const s = String(i * 1.37); k += 1; }`],
  ['a template of a number', `let k = 0; ${LOOP} { const s = \`\${i * 1.37}\`; k += 1; }`],
  ['a text made into a number', `let k = 0; ${LOOP} { k += Number('12345.678'); }`],
  ['Math functions', `let k = 0; ${LOOP} { k += Math.sqrt(Math.abs(Math.floor(i * 1.5))); }`],
  ['a Set: add and has', `const m = new Set(); ${LOOP} { m.add(i % 50000); m.has(i % 777); }`],
  ['world.math', `let v = { x: 1, y: 2, z: 0 }; ${LOOP} v = world.math.norm(world.math.add(v, { x: 0.1, y: 0.2, z: 0 }));`],
  ['world.random', `let k = 0; ${LOOP} k += world.random();`],
  ['world.send', `${LOOP} world.send(self.id, 'ping', { n: 1 });`],
  ['world.send with a list of 64 vectors', `const path = []; for (let i = 0; i < 64; i += 1) path.push({ x: i, y: i, z: 0 }); ${LOOP} world.sendRoom('big', { path });`],
  ['world.emit', `${LOOP} world.emit('ding', self.pos, { n: 1 });`],
  ['world.spawn', `${LOOP} world.spawn('rock', self.pos, {});`],
  ['world.place', `${LOOP} world.place(self, { x: 1, y: 2, z: 0 });`],
  ['world.near: 10 found of 2,000', `${LOOP} world.near(self.pos, 1.5, 'rock');`, { rocks: 2000 }],
  ['world.near: 2,000 found of 2,000', `${LOOP} world.near(self.pos, 64);`, { rocks: 2000 }],
  ['world.near: 400 found, each with a list of 1,024', `${LOOP} world.near(self.pos, 64, 'rock');`, { rocks: 400, rockFields: 'bag: f.list(f.u32(), 1024)', rockInit: 'const a = []; for (let i = 0; i < 1024; i += 1) a.push(i); self.bag = a;' }],
  ['world.inBox: 2,000 found', `${LOOP} world.inBox({ min: { x: -30, y: -30, z: 0 }, max: { x: 30, y: 30, z: 0 } });`, { rocks: 2000 }],
  ['world.ray past 2,000', `${LOOP} world.ray(self.pos, { x: 1, y: 0.3, z: 0 }, 60);`, { rocks: 2000 }],
  ['world.sweep past 2,000', `${LOOP} world.sweep(self, { x: 0.001, y: 0, z: 0 });`, { rocks: 2000 }],
  ['a number written to a field', `${LOOP} self.n = i;`],
  ['a vector written to vel', `${LOOP} self.vel = { x: 1, y: 2, z: 0 };`],
  ['a text of 4,096 written to a field', `let s = 'abcdefgh'; for (let i = 0; i < 9; i += 1) s = s + s; ${LOOP} self.note = s;`],
  ['a list of 1,024 read from a field', `let k = 0; ${LOOP} k += self.bag.length;`, { pre: 'const a = []; for (let i = 0; i < 1024; i += 1) a.push(i); self.bag = a;' }],
  ['a list of 1,024 written to a field', `const a = []; for (let i = 0; i < 1024; i += 1) a.push(i); ${LOOP} self.bag = a;`],
  ['a list of 64 vectors written to a field', `const a = []; for (let i = 0; i < 64; i += 1) a.push({ x: i, y: 2, z: 0 }); ${LOOP} self.path = a;`],
  ['an object of 256 keys written to a map field', `const o = {}; for (let i = 0; i < 256; i += 1) o['k' + i] = i; ${LOOP} self.table = o;`],
  ['an object of 20,000 keys written to a map field', `const o = {}; for (let i = 0; i < 20000; i += 1) o['k' + i] = i; ${LOOP} self.table = o;`],
];

const BUDGET = 4_000_000;
const rows = [];
let n = 0;
for (const [name, heavy, opts] of PLANTED) {
  if (only && !name.includes(only)) continue;
  n += 1;
  const L = await loadGame(scratch, writeGame(scratch, `c${n}`, { rules: game(heavy, opts) }), `c${n}`);
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(MAP), settings: L.R.roomSettings({ budget: { tick: BUDGET } }).settings, seats: 2 });
  const rig = hostRig(L, c);
  rig.join(0);
  rig.ticks(6);
  const s = rig.host.core.stats;
  // The quickest of a dozen ticks: what the work costs when nothing else is in its way.
  let best = Infinity; let units = 0; let ms = 0;
  for (let i = 0; i < 12; i += 1) {
    const t0 = performance.now();
    rig.ticks(1);
    const took = performance.now() - t0;
    if (s.tickUnits > BUDGET / 16 && took / s.tickUnits < best) { best = took / s.tickUnits; units = s.tickUnits; ms = took; }
  }
  // A handler that stops itself at once (a cap it runs into) measures the tick around it, not the call: it is left out.
  if (units) rows.push({ name, units, ms, ns: best * 1e6 });
}
rows.sort((a, b) => b.ns - a.ns);
console.log('Planted handlers, each burning its share of the tick one way. Dearest unit first.\n');
console.log(`${'handler'.padEnd(52)} ${'units'.padStart(9)} ${'ms'.padStart(7)} ${'ns a unit'.padStart(10)}`);
for (const r of rows) console.log(`${r.name.padEnd(52)} ${String(r.units).padStart(9)} ${r.ms.toFixed(2).padStart(7)} ${r.ns.toFixed(1).padStart(10)}`);

if (!only && rows.length) {
  const worst = rows[0];
  const L = await loadGame(scratch, COIN_DASH, 'coin-dash');
  const D = L.R.ROOM_DEFAULTS.budget.tick;
  console.log(`\nThe dearest unit is ${worst.ns.toFixed(1)} ns ("${worst.name}").`);
  console.log(`The default budget is ${D} units a tick. A tick that uses all of it on the dearest work takes ${(D * worst.ns / 1e6).toFixed(1)} ms here;`);
  console.log(`at the very worst (a full room's move and think each taking its small share after that) ${(1.5 * D * worst.ns / 1e6).toFixed(1)} ms.`);
  console.log(`A tick lasts ${1000 / L.R.ROOM_DEFAULTS.tickHz} ms at ${L.R.ROOM_DEFAULTS.tickHz} ticks a second.\n`);
  // coin-dash, the example: its busiest tick in two and a half minutes of play, for a room of each size.
  for (const [people, seats] of [[1, 8], [8, 8], [32, 32]]) {
    const c = L.R.compileRules(L.def, { tune: { public: { speed: 6 } }, map: L.R.compileMap(COIN_MAP), settings: L.R.roomSettings({}).settings, seats });
    const rig = hostRig(L, c);
    for (let i = 0; i < people; i += 1) rig.join(i);
    let slowest = 0;
    const t0 = performance.now();
    for (let i = 0; i < 3000; i += 1) { const a = performance.now(); rig.ticks(1); slowest = Math.max(slowest, performance.now() - a); }
    const s = rig.host.core.stats;
    console.log(`coin-dash, ${people} of ${seats} seats taken (${rig.host.core.bodies().length} bodies): its busiest tick used ${s.maxTickUnits} of ${c.settings.budget.tick} units (${(100 * s.maxTickUnits / c.settings.budget.tick).toFixed(2)}%), its busiest handler ${s.maxUnits} (${s.worst}); a tick took ${((performance.now() - t0) / 3000).toFixed(3)} ms on average, ${slowest.toFixed(2)} ms at most.`);
  }
}
if (line !== null && rows.some((r) => r.ns > line)) {
  console.log(`\nOVER THE LINE of ${line} ns a unit: ${rows.filter((r) => r.ns > line).map((r) => r.name).join('; ')}`);
  process.exit(1);
}
