/**
 * A build's verdict and every line it prints are the same whatever the computer is doing and whatever its clock says.
 *
 * Each game is built in a process of its own: once quietly, and once beside a thread that keeps a processor busy, with
 * every reading of the clock in that process (and in the check's worker) jumping by up to two days either way. The two
 * must print the same, byte for byte. The heavy games are the ones a clock once decided: a board every sentry reads
 * whole on every tick, which built on a fast core and was refused on a slow one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALLOWANCE } from '../lib/rules-check.mjs';
import { writeGame, COIN_DASH, PKG, REPO_NM } from './rules-kit.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-repeat-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const skew = join(root, 'skew.mjs');
writeFileSync(skew, `let s = 12345; const jump = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296 - 0.5) * 3.456e8; };
const now = Date.now.bind(Date); Date.now = () => Math.round(now() + jump());
const tick = performance.now.bind(performance); performance.now = () => tick() + jump();\n`);
const runner = join(root, 'build.mjs');
writeFileSync(runner, `import { prepareRules } from ${JSON.stringify(pathToFileURL(join(PKG, 'lib/rules-build.mjs')).href)};
import esbuild from ${JSON.stringify(pathToFileURL(join(REPO_NM, 'esbuild/lib/main.js')).href)};
const [root, id, meta] = process.argv.slice(2); const lines = []; let result;
try { const built = await prepareRules(esbuild, root, { ...JSON.parse(meta), id, dir: root + '/' + id }, { log: (line) => lines.push(line) }); result = { check: built.check, units: built.units, tickUnits: built.tickUnits, build: built.build, stateHash: built.stateHash }; }
catch (e) { result = { error: e.message }; }
process.stdout.write(JSON.stringify({ lines, result }));
await esbuild.stop?.();\n`);
async function build(id, meta, env = {}) {
  const child = spawn(process.execPath, [runner, root, id, JSON.stringify(meta)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, err);
  return out;
}
const games = [['n4-map-in-event', 'ticks'], ...(process.env.RULES_EXTENDED ? [['m1-big-map', 'units'], ['m5-forty-sentries', 'units']] : [['m5-forty-sentries', 'units']])];
for (const [id, stopped] of games) test(`the whole output of a build is the same under load and with a clock that jumps: ${id}`, async () => {
  const base = new URL(`./fixtures/rules-boundaries/${id}/`, import.meta.url);
  const read = (name, fallback) => (existsSync(new URL(name, base)) ? readFileSync(new URL(name, base), 'utf8') : fallback);
  const dir = writeGame(root, id, { rules: read('rules.ts'), move: read('move.ts', null) });
  writeFileSync(join(dir, 'src/view.ts'), read('view.ts', 'export {};'));
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), read('map.json', readFileSync(join(COIN_DASH, 'map/main.json'), 'utf8')));
  for (const name of ['agents.json', 'tunables.json']) if (existsSync(new URL(name, base))) writeFileSync(join(dir, name), read(name));
  const meta = JSON.parse(read('game.json', '{"players":{"max":8}}'));
  const quiet = await build(id, meta);
  const burner = new Worker('let x = 1; for (;;) x = Math.imul(x, 1664525) + 1013904223;', { eval: true, resourceLimits: { maxOldGenerationSizeMb: 16 } });
  let loaded;
  try { loaded = await build(id, meta, { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(skew).href}`.trim() }); } finally { await burner.terminate(); }
  assert.equal(loaded, quiet);
  const { lines, result } = JSON.parse(quiet);
  assert.equal(result.error, undefined, result.error);
  assert.ok(result.check.plays.every((p) => p.stopped === stopped), lines.join('\n'));
  // The play is counted, never timed: a heavy game ends when its units are used, well short of its ticks.
  if (stopped === 'units') assert.ok(result.check.plays[0].ticks < ALLOWANCE.ticks && result.check.plays[0].units < ALLOWANCE.units + 2 * result.tickUnits, `${result.check.ticks} ticks, ${result.check.units} units`);
});
