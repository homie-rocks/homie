/**
 * The wall around rules at build (lib/rules-guard.mjs; rooms-milestone-1-design.md section 10): every construct the
 * pass refuses, each with the line named in the author's own file, and what the rewrite makes of what is left.
 *
 *   - globals, methods, names and syntax are allowlists: each refused construct is a problem with its line;
 *   - a refused name is refused in every place a property is named (a.b, a?.b, a pattern, an object literal, a
 *     string-literal key);
 *   - module-level state, a write to anything module-level, and a function of the game's called at load are refused;
 *   - rules cannot contain `try`, so they cannot catch the budget;
 *   - the line named is the line in the TypeScript the author wrote, not in what removing its types left;
 *   - coin-dash passes, its linked module holds no unguarded computed key, no uncounted loop or function, no operator
 *     whose operand was not checked and no unchecked write, and a linked module that does is refused;
 *   - at run time the rewritten code is counted and guarded: a loop is charged a unit a turn, a method that is not
 *     on the list throws, a method read as a value throws, a destructured method throws;
 *   - an operator never turns a list or an object into a text: `==`, whole numbers of any size and a function under
 *     `valueOf`, `toString` or `toJSON` are refused with their lines, and what is left is checked as it runs.
 * Run: node --test packages/studio/test/rules-guard.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { guardFiles, guardRules, guardSource, problemLine } from '../lib/rules-guard.mjs';
import { COIN_DASH, PKG, esbuildOf, loadGame, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-guard-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A rules file with one line planted in a handler (line 7), or at the top level (line 3). */
const file = (inHandler = '', atTop = '') => `import { defineRules, f } from '@homie-rocks/studio/rules';
const LIMIT = 3;
${atTop}
export default defineRules({
  entities: { a: { fields: { n: f.u8() },
    tick(world, self) {
      ${inHandler}
    } } } });
`;
const problems = (code) => guardSource(code, { file: 'rules.js' }).problems;
const refused = (inHandler, re, line = 7) => {
  const list = problems(file(inHandler));
  assert.ok(list.some((p) => re.test(p.message) && p.line === line), `${inHandler}\n  expected ${re} on line ${line}, got:\n  ${list.map(problemLine).join('\n  ') || '(no problem)'}`);
};
const refusedTop = (atTop, re) => {
  const list = problems(file('', atTop));
  assert.ok(list.some((p) => re.test(p.message) && p.line === 3), `${atTop}\n  expected ${re} on line 3, got:\n  ${list.map(problemLine).join('\n  ') || '(no problem)'}`);
};
const allowed = (inHandler, atTop = '') => assert.deepEqual(problems(file(inHandler, atTop)).map(problemLine), [], inHandler || atTop);

test('globals are an allowlist of named functions: every other global is refused by name', () => {
  for (const name of ['JSON', 'BigInt', 'Uint8Array', 'Float64Array', 'Symbol', 'Date', 'Intl', 'RegExp', 'WeakRef', 'FinalizationRegistry', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'Proxy', 'Reflect', 'globalThis', 'eval', 'Function', 'fetch', 'setTimeout', 'setInterval', 'queueMicrotask', 'performance', 'crypto', 'Promise', 'console', 'window', 'process', 'structuredClone', 'someFutureGlobal']) {
    refused(`const x = ${name};`, new RegExp(`^${name} is not available in rules`));
  }
  refused('const t = Date.now();', /Date is not available in rules: rules have no wall clock: use world\.tick/);
  refused('const x = Math.sin(1);', /Math\.sin is not available in rules.*use world\.math\.sin/);
  refused('const x = Math.random();', /Math\.random is not available in rules \(Math offers sqrt, abs/);
  refused('const x = Math.PI;', /Math\.PI is not available in rules/);
  refused('const x = Math.sqrt;', /Math\.sqrt may be called, never read as a value/);
  refused('const x = Math;', /Math is not available in rules/);
  refused('const x = Object.getPrototypeOf(self);', /Object\.getPrototypeOf is not available in rules \(Object offers keys, values, entries\)/);
  refused('Object.assign(self, {});', /Object\.assign is not available/);
  refused('Object.defineProperty(self, "n", {});', /Object\.defineProperty is not available/);
  refused('const x = Object.keys;', /Object\.keys may be called, never read as a value/);
  refused('const x = new Array(5);', /rules make new values only with new Map\(\), new Set\(\) and new Error/);
  refused('const x = Array.from(self);', /Array\.from is not available in rules \(Array offers isArray\)/);
  refused('const x = String.fromCharCode(65);', /String is used in rules only as String\(x\)/);
  refused('const x = arguments[0];', /arguments is not available in rules: name the parameters/);
  refused('const x = Number.parseFloat("1");', /Number\.parseFloat is not available/);
  allowed('const x = Math.sqrt(Math.abs(Math.floor(Math.max(1, Math.min(2, Math.imul(2, 3)))))) + Math.fround(Math.sign(Math.trunc(Math.round(Math.ceil(1.2)))));');
  allowed('const x = Number.isFinite(1) && Number.isInteger(2) && !Number.isNaN(3) ? Number.MAX_SAFE_INTEGER : Number.EPSILON; const y = Number("4");');
  allowed('const k = Object.keys(self).length + Object.values(self).length + Object.entries(self).length; const ok = Array.isArray(k);');
  allowed('const s = String(self.n); const b = Boolean(s); const m = new Map(); const t = new Set(); if (!b) throw new Error("no");');
  allowed('const x = Infinity; const y = NaN; const z = undefined;');
});

test('methods are an allowlist, and a method may be called, never read as a value', () => {
  refused('self.list.toString();', /"toString" is not a method rules may call/);
  refused('self.n.toFixed(2);', /"toFixed" is not a method rules may call/);
  refused('self.fn.call(self);', /"call" is not a method rules may call/);
  refused('self.fn.apply(self, []);', /"apply" is not a method rules may call/);
  refused('self.fn.bind(self);', /"bind" is not a method rules may call/);
  refused('const s = "a".repeat(9999);', /"repeat" is not a method rules may call/);
  refused('const s = "a".padStart(9999);', /"padStart" is not a method rules may call/);
  refused('const s = "a".match("a");', /"match" is not a method rules may call/);
  refused('const a = [1].fill(0);', /"fill" is not a method rules may call/);
  refused('const a = [1].copyWithin(0, 1);', /"copyWithin" is not a method rules may call/);
  refused('self.list.length = 0;', /a list's length is not set by hand/);
  allowed('const a = [3, 1, 2]; a.push(4); a.sort((x, y) => x - y); const b = a.map((x) => x * 2).filter((x) => x > 2).slice(0, 2).concat([9]); const i = b.indexOf(9); const j = b.at(-1); const t = b.join(",").split(",").length; a.pop(); a.shift(); a.unshift(1); a.splice(0, 1); a.reverse(); const f = a.find((x) => x > 0); const g = a.findIndex((x) => x > 0); const h = a.some((x) => x > 0) && a.every((x) => x > 0) && a.includes(1); const r = a.reduce((n, x) => n + x, 0); a.forEach((x) => x); const z = [[1]].flat().flatMap((x) => [x]).lastIndexOf(1);');
  allowed('const s = "Coin Dash"; const t = s.slice(1).trim().toUpperCase().toLowerCase(); const ok = s.includes("C") && s.startsWith("C") && s.endsWith("h"); const n = s.indexOf("D") + s.charCodeAt(0) + s.split(" ").length; const c = s.at(0);');
  allowed('const m = new Map(); m.set("a", 1); const v = m.get("a"); const h = m.has("a"); m.delete("a"); m.clear(); m.forEach((x) => x); for (const k of m.keys()) { self.n += 1; } for (const x of m.values()) { self.n += x; } for (const e of m.entries()) { self.n += e[1]; } const s = new Set(); s.add(1);');
  allowed('const d = world.math.dist(self.pos, self.pos); world.send(self.id, "x", {}); for (const e of world.near(self.pos, 4, "a")) { world.sendArea({ sphere: { at: e.pos, r: 2 } }, "x", {}); } world.after(world.ticks(1), "x", {}); const r = world.random(); const p = world.map.spots("start"); world.place(self, world.map.spot("start"));');
});

test('refused names are refused in every place a property is named', () => {
  const NAME = /"constructor" is a name rules may not use/;
  refused('const c = self.constructor;', NAME);
  refused('const c = self?.constructor;', NAME);
  refused('const { constructor: c } = self;', NAME);
  refused('const { constructor } = self;', NAME);
  refused('const o = { constructor: 1 };', NAME);
  refused('const o = { "constructor": 1 };', NAME);
  refused('const c = self["constructor"];', NAME);
  refused('const o = { constructor() {} };', NAME);
  refused('const o = { __proto__: self };', /"__proto__" is a name rules may not use/);
  refused('const p = self.__proto__;', /"__proto__" is a name rules may not use/);
  refused('const p = self.prototype;', /"prototype" is a name rules may not use/);
  refused('const s = new Error("x").stack;', /"stack" is a name rules may not use/);
  refused('const n = "a".localeCompare("b");', /"localeCompare" is a name rules may not use/);
  refused('const n = self.n.toLocaleString();', /"toLocaleString" is a name rules may not use/);
  refused('const n = "a".toLocaleUpperCase();', /"toLocaleUpperCase" is a name rules may not use/);
  refused('const __homieX = 1;', /names beginning __homie are the runtime's own/);
  refused('__homie.G.left = 9e9;', /names beginning __homie are the runtime's own/);
  refused('function f({ at }) { return at; }', /take "at" out with a plain `const \{ … \} = value` declaration/);
  refused('const { [self.k]: v, ...rest } = self; for (const { [self.k]: w } of [self]) { self.n = w; }', /take "a computed key" out with a plain/);
});

test('refused syntax: each construct is named with its line', () => {
  refused('const x = await world.near(self.pos, 1);', /await is refused: a handler finishes inside its tick/);
  refused('const f = async () => 1;', /async is refused/);
  refused('function* g() { yield 1; }', /generators are refused/);
  refused('class Coin {}', /class is refused in rules/);
  refused('const C = class {};', /class is refused in rules/);
  refused('self.n = this.n;', /`this` is refused in rules/);
  refused('try { self.n = 1; } catch (e) { self.n = 2; }', /try, catch and finally are refused in rules: the runtime catches what a handler throws/);
  refused('try { self.n = 1; } finally { self.n = 2; }', /try, catch and finally are refused/);
  refused('const ok = /coin/.test("coin");', /regular expressions are refused in rules/);
  refused('const x = 2 ** 8;', /the \*\* operator is refused.*use world\.math\.pow/);
  refused('let x = 2; x **= 8;', /the \*\*= operator is refused/);
  refused('delete self.n;', /delete is refused in rules/);
  refused('const o = { get n() { return 1; } };', /getters and setters are refused/);
  refused('const o = { set n(v) {} };', /getters and setters are refused/);
  refused('const m = import("./other");', /import\(\) is refused/);
  refused('const u = import.meta.url;', /import\.meta and new\.target are refused/);
  refused('const s = String.raw`a${1}`;', /tagged templates are refused/);
  refused('debugger;', /`debugger` is refused/);
  refused('const a = self?.list?.[0].at(0);', /this optional chain is too long for the guard to follow/);
  // `with` is refused by the language itself in a module, so the file does not parse; that is said with its line too.
  const w = problems(file('with (self) { n = 1; }'));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /this file does not parse/);
  assert.equal(w[0].line, 7);
});

test('a rules module has no state of its own, and nothing of the game\'s runs at load', () => {
  refusedTop('let count = 0;', /a rules module has no state of its own: "let" at module level is refused/);
  refusedTop('var cache = {};', /a rules module has no state of its own: "var" at module level is refused/);
  refusedTop('function helper() { return 1; } const built = helper();', /nothing of the game's runs when a rules file loads/);
  refusedTop('const seed = Date.now();', /nothing of the game's runs when a rules file loads/);
  refusedTop('const table = [1, 2, 3].map((x) => x * 2);', /nothing of the game's runs when a rules file loads/);
  refusedTop('LIMIT.x = 1;', /nothing of the game's runs when a rules file loads/);
  refusedTop('if (LIMIT) { }', /nothing of the game's runs when a rules file loads/);
  refusedTop('export * from "./other";', /rules export their own declarations/);
  refusedTop('import fs from "node:fs";', /rules import only @homie-rocks\/studio\/rules and the game's own files, not "node:fs"/);
  refusedTop('import { createNetplay } from "@homie-rocks/studio/netplay";', /rules import only/);
  refusedTop('const m = new Map();', /a Map is made inside a handler only/);
  // Assignment to anything module-level, or to any member of a global, from inside a handler.
  refused('LIMIT += 1;', /"LIMIT" is declared at module level, so nothing may assign to it or to anything in it/);
  refused('LIMIT.x = 1;', /"LIMIT" is declared at module level/);
  refused('LIMIT.list[0] = 1;', /"LIMIT" is declared at module level/);
  refused('f.u8 = 1;', /"f" is declared at module level/);
  refused('Math.floor = 1;', /Math is not the game's to change/);
  refused('undeclared = 1;', /undeclared is not the game's to change/);
  refused('for (LIMIT of [1]) { self.n = 1; }', /"LIMIT" is declared at module level/);
  allowed('', 'const SPEED = 6.8; const HALF = SPEED / 2; const NAMES = ["a", "b"]; const BOX = { min: [0, 0], max: [SPEED, HALF * 2] }; const LABEL = `x${1}`; function helper(a) { return a * SPEED; } const arrow = (a) => a + HALF; export const also = { n: -1, on: !0 };');
});

test('the line named is the line the author wrote, in TypeScript', async () => {
  const esbuild = await esbuildOf();
  const dir = writeGame(scratch, 'typed', {
    rules: `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

interface Tally {
  n: number;
  names: string[];
}
type Kind = 'runner' | 'coin';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  entities: {
    runner: {
      fields: { score: f.u16() },
      tick(world: any, self: any): void {
        const tally: Tally = { n: 0, names: [] };
        const kind = 'coin' as Kind;
        self.score = Math.sin(tally.n) + kind.length;
      },
    },
  },
});
`,
    move: `import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body: any, input: any, ctx: any): void {
    const when: number = Date.now();
    body.vel = { x: when, y: 0, z: 0 };
  },
});
`,
  });
  const res = await guardRules(esbuild, scratch, dir);
  assert.equal(res.ok, false);
  assert.equal(res.code, null, 'a build with problems writes nothing');
  assert.deepEqual(res.problems.map(problemLine).sort(), [
    'typed/src/move.ts:5 Date is not available in rules: rules have no wall clock: use world.tick and world.ticks(seconds)',
    'typed/src/rules.ts:20 Math.sin is not available in rules, because browsers and servers may disagree on its last digits: use world.math.sin (ctx.math.sin in move.ts)',
  ]);
  // A file that is not the game's own is refused, and so is a syntax error, each with its file.
  const out = await guardFiles(esbuild, scratch, dir, join(PKG, 'starters', 'coin-dash', 'src', 'move.ts'));
  assert.match(out.problems[0].message, /rules import only files of their own game/);
  const broken = writeGame(scratch, 'broken', { rules: 'export default defineRules({ entities: { a: { tick(world, self) { self.n = ; } } } });\n' });
  const b = await guardRules(esbuild, scratch, broken);
  assert.match(problemLine(b.problems[0]), /^broken\/src\/rules\.ts:1 this file does not parse/);
});

test('coin-dash passes, and its linked module is the checked one: no unguarded key, no uncounted loop or function', async () => {
  const esbuild = await esbuildOf();
  const res = await guardRules(esbuild, PKG, COIN_DASH);
  assert.deepEqual(res.problems, []);
  assert.equal(res.ok, true);
  const code = res.code;
  assert.match(code, /import \* as __homie\d* from "@homie-rocks\/studio\/rules\/guard";/);
  assert.match(code, /import \{[^}]*defineRules[^}]*\} from "@homie-rocks\/studio\/rules";/);
  assert.equal([...code.matchAll(/^import /gm)].length <= 4, true, 'it imports Homie\'s rules module and the guard, and nothing else');
  assert.doesNotMatch(code.replace(/^import .*$/gm, ''), /\bimport\b|\brequire\b/);
  // Every function and loop starts by counting; every method call and computed key goes through the guard.
  assert.match(code, /tick\(world, self\) \{\n\s+__homie\d*\.t\(\);/);
  assert.match(code, /for \(const coin of __homie\d*\.c\(world, "near", \[self\.pos, 1, "coin"\], \d+\)\) \{\n\s+__homie\d*\.t\(\);/);
  const KEY = /__homie\d*\.g\(spots, (__homie\d*\.p\(self\.seat, \d+\) % __homie\d*\.p\(spots\.length, \d+\)), \d+\)/;
  assert.match(code, KEY, 'a computed key goes through the guard, and so does each operand of the % that makes it');
  assert.match(code, /__homie\d*\.w\(self, \d+\)\.score = __homie\d*\.p\(self\.score, \d+\) \+ 1;/, '`self.score += 1` is written out: the old value is checked, and the write is checked not to land on a function');
  assert.doesNotMatch(code, /world\.near\(|world\.send\(|\.sweep\(body/);
  // The linked module is read once more. One that holds a raw computed key, an uncounted loop or function, or an
  // import of anything else is refused, whoever made it.
  const again = (text) => guardSource(text, { file: 'linked', linked: true }).problems.map((p) => p.message);
  assert.deepEqual(again(code), []);
  assert.deepEqual(again(code.replace(KEY, 'spots[$1]')), ['the linked module holds a computed key the guard did not rewrite']);
  // An operator whose operand nobody checked, and a write nobody checked, are refused in the same way.
  assert.deepEqual(again(code.replace(/__homie\d*\.p\(self\.seat, \d+\) % /, 'self.seat % ')), ['the linked module holds an operator whose operand the guard did not check']);
  assert.deepEqual(again(code.replace(/__homie\d*\.p\(self\.score, \d+\) \+ 1/, 'self.score + 1')), ['the linked module holds an operator whose operand the guard did not check']);
  assert.deepEqual(again(code.replace(/__homie\d*\.w\(self, \d+\)\.score = 0;/, 'self.score = 0;')), ['the linked module holds a write to a property the guard did not check']);
  assert.deepEqual(again(code.replace(/(tick\(world, self\) \{\n\s+)__homie\d*\.t\(\);/, '$1')), ['the linked module holds a function the guard did not count']);
  assert.deepEqual(again(code.replace(/(for \(const coin of [^\n]+\{\n\s+)__homie\d*\.t\(\);/, '$1')), ['the linked module holds a loop the guard did not count']);
  assert.deepEqual(again(code.replace(/(tick\(world, self\) \{\n\s+__homie\d*\.t\(\);)/, '$1\n        const [first, ...others] = [1, 2];')), ['the linked module holds a rest (...) in a pattern that the guard did not count']);
  assert.deepEqual(again(code.replace(/(tick\(world, self\) \{\n\s+__homie\d*\.t\(\);)/, '$1\n        if (world === self) return;')), ['the linked module holds an operator whose operand the guard did not check']);
  assert.match(again(`import fs from "node:fs";\n${code}`)[0], /rules import only/);
  assert.match(again(`${code}\nvar leak = fetch("https://example.com");`).join('\n'), /fetch is not available in rules/);
});

test('at run time the rewritten code is counted and guarded', async () => {
  const dir = writeGame(scratch, 'counted', {
    rules: `import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
const move = defineMove({});
const TABLE = { a: [1, 2, 3], b: { deep: [4] } };
function total(list) { let n = 0; for (const x of list) n += x; return n; }
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: { events: {}, commands: {}, effects: {} },
  entities: {
    probe: {
      fields: { mode: f.u8(), out: f.i32(), text: f.text(64) },
      tick(world, self) {
        const mode = self.mode;
        self.out = -1;
        if (mode === 0) { let n = 0; for (let i = 0; i < 10; i += 1) n += total(TABLE.a); self.out = n; }
        if (mode === 1) { const key = 'a'; const o = { [key]: 5, b: 2 }; o[key] += 1; o.b++; const { [key]: got } = o; self.out = got + o.b + TABLE[key][1] + [...TABLE.a, ...TABLE.b.deep].length; self.text = \`\${key}\${got}\` + '!'; }
        if (mode === 2) { TABLE.a.push(4); }
        if (mode === 3) { const hit = { at: { x: 1 }, keys: 3 }; const { at } = hit; self.out = at.x + hit.keys; }
        if (mode === 4) { const list = [1, 2]; const { push } = list; self.out = 1; }
        if (mode === 5) { const list = [1, 2]; const fn = list.map; self.out = 1; }
        if (mode === 6) { const o = { n: 1 }; const k = 'missing'; self.out = o[k]; }
        if (mode === 7) { const s = new Set(); for (let i = 0; i < 70000; i += 1) s.add(i); self.out = 1; }
        if (mode === 8) { const who = self?.motion; const none = null; self.out = (none?.[mode] ?? 7) + (who ? 1 : 0); }
      },
    },
  },
  room: { start(world) { for (let i = 0; i < 9; i += 1) world.spawn('probe', { x: i, y: 0, z: 0 }, { mode: i }); } },
});
`,
  });
  const L = await loadGame(scratch, dir, 'counted');
  // A budget large enough that the size cap, not the budget, is what stops a Set of 70,000 entries.
  const c = L.R.compileRules(L.def, { map: L.R.compileMap({ bounds: { min: [-20, -20], max: [20, 20] } }), settings: L.R.roomSettings({ budget: { tick: 4_000_000 } }).settings });
  const core = L.C.createCore(c, { seed: 1 });
  const errors = new Map();
  const run = (mode) => {
    const one = L.C.createCore({ ...c, start: (world) => { world.spawn('probe', { x: 0, y: 0, z: 0 }, { mode }); } }, { seed: 1 });
    one.step(); one.step();
    errors.set(mode, one.stats.lastError);
    const e = one.snapshot()[1][0];
    return { out: e[7][1], text: e[7][2], units: one.stats.maxUnits, error: one.stats.lastError };
  };
  assert.ok(core);
  // A loop is charged a unit a turn, a function a unit a call: 10 turns, 10 calls of total(), 3 turns in each.
  const counted = run(0);
  assert.equal(counted.out, 60);
  assert.equal(counted.units, 1 + 2 * 3 + 10 + 10 * (1 + 3), 'the tick itself, the two writes to a field (three units each), ten turns, ten calls and thirty turns inside them');
  const keys = run(1);
  assert.equal(keys.error, '');
  assert.equal(keys.out, 6 + 3 + 2 + 4);
  assert.equal(keys.text, 'a6!');
  assert.match(run(2).error, /probe\.tick: .*(not extensible|read only|frozen)/i, 'a module-level constant is frozen all the way down');
  assert.deepEqual([run(3).out, run(3).error], [4, ''], 'a field named like a method (at, keys) is read as the value it is');
  assert.match(run(4).error, /a destructuring pattern took a function out of a value/);
  assert.match(run(5).error, /"map" is a function here: a method may be called, never read as a value \(line \d+\)/);
  assert.match(run(6).error, /there is no "missing" on this value/);
  assert.match(run(7).error, /holds at most 65536 entries/);
  assert.deepEqual([run(8).out, run(8).error], [8, '']);
});
