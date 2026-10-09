/**
 * @homie-rocks/studio 0.19.0: `homie-studio perf` — the judgement and the bookkeeping, without a browser.
 *
 *   - perf compare calls a change better only beyond the noise: a rank test (exact), a bootstrap interval of the
 *     change in medians, and a smallest change that counts; a guard that got worse makes the verdict worse; runs taken
 *     on a busy computer or blocked are left out, and too few left is `blocked`, never a verdict;
 *   - a CPU profile is summed per function, idle kept apart, and a minified bundle read back through its source map
 *     (`draw (src/main.ts:12)`, a real esbuild map);
 *   - `build --maps` keeps the map and the module sizes in .studio/maps/<id>/, never in site/dist, and the bundle is
 *     byte for byte what a plain build makes; `perf sizes` reads it, and ignores a map left from another build;
 *   - 0.19.1: `perf sizes` tells a minified script from an unminified one by its code, never by how well it gzips: a
 *     real minified three.js bundle (fixtures/three-bundles, small) is minified with its GLSL shader source counted
 *     apart, the same bundle unminified is not, and so are three.js's own builds when node_modules has them.
 * The browsers themselves need Chrome on a GPU (`homie-studio perf` against `homie-studio dev`; the perf skill).
 * Run: node --test packages/studio/test/perf.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { bootstrapChange, judge, judgePaired, quantile, rankTest, signedRankTest, summarize } from '../lib/perf-stats.mjs';
import { decodeMappings, sourceMapLookup, summarizeProfile } from '../lib/perf-profile.mjs';
import { DEFAULT_GOAL, defaultGuards, deviceLabel, metricsOfRun, perfCompare, perfRun, perfSizes, prePlayTransfer, renderCostOf, summaryOf } from '../lib/perf.mjs';
import { readCode } from '../lib/perf-code.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-perf-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('quantiles and summaries: interpolated, empty-safe, the spread as a share of the median', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
  const s = summarize([10, 11, 12, 13, 14]);
  assert.deepEqual([s.n, s.median, s.q1, s.q3, s.min, s.max], [5, 12, 11, 13, 10, 14]);
  assert.equal(s.spread, 0.1667);
});

test('the rank test is exact for small runs: five clearly lower after-runs give p = 1/252, ties share ranks', () => {
  const t = rankTest([10, 11, 12, 13, 14], [5, 6, 7, 8, 9]);
  assert.equal(t.exact, true);
  assert.equal(t.less, round5(1 / 252), 'every after-run below every before-run: the one arrangement of 252');
  assert.equal(t.greater, 1);
  const same = rankTest([16.7, 16.7, 16.7], [16.7, 16.7, 16.7]);
  assert.equal(same.less, 1, 'all tied: nothing is lower');
  const big = rankTest(Array.from({ length: 30 }, (_, i) => 100 + i), Array.from({ length: 30 }, (_, i) => 50 + i));
  assert.equal(big.exact, false, '30 + 30 runs: the normal approximation');
  assert.ok(big.less < 1e-6);
});
const round5 = (x) => Number(x.toFixed(5));

test('the bootstrap interval is seeded: the same runs give the same interval', () => {
  const a = [10, 11, 12, 13, 14];
  const b = [8, 9, 9.5, 10, 11];
  assert.deepEqual(bootstrapChange(a, b), bootstrapChange(a, b));
  const [lo, hi] = bootstrapChange(a, b);
  assert.ok(lo < 0 && hi <= 0 && lo < hi);
});

test('judge: better only beyond the noise, worse on the stricter bar, the same otherwise; a fixed number has no noise', () => {
  const before = [1.10, 0.95, 1.20, 1.05, 0.98];
  const better = judge(before, [0.80, 0.78, 0.85, 0.82, 0.79], { unit: ' ms' });
  assert.equal(better.verdict, 'better');
  assert.ok(better.change < -0.2);
  assert.match(better.why, /p = 0\.00397 better/, '1 of 252 arrangements');
  const noise = judge(before, [1.02, 1.12, 0.93, 1.08, 0.99]);
  assert.equal(noise.verdict, 'same');
  assert.match(noise.why, /within the noise/);
  const tiny = judge([100, 100.5, 101, 101.5, 102], [98, 98.2, 98.4, 98.6, 98.8], { min: 0.03 });
  assert.equal(tiny.verdict, 'same', 'clearly lower but under the 3% that counts');
  assert.match(tiny.why, /smaller than the 3%/);
  const worse = judge(before, [1.5, 1.6, 1.55, 1.7, 1.65]);
  assert.equal(worse.verdict, 'worse');
  const bytes = judge([59_000], [41_000], { unit: ' B' });
  assert.equal(bytes.verdict, 'better');
  assert.equal(bytes.exact, true);
  assert.equal(judge([59_000], [59_100]).verdict, 'same', 'under 1% of a fixed number is the same');
  assert.equal(judge([], [1, 2, 3]).verdict, 'unknown');
});

test('pairs run side by side: a computer drifting busier cancels, which comparing every run with every run cannot see', () => {
  // Measured on a shared Mac: the SAME build's main thread per frame rose 0.88 → 1.25 ms over five runs as the load
  // went from 4 to 7.6. A change 8% faster, measured in turns through that drift:
  const drift = [0.88, 0.97, 1.09, 1.19, 1.25, 1.31];
  const before = drift;
  const after = drift.map((x, i) => x * 0.92 * (1 + 0.01 * ((i % 3) - 1)));
  assert.equal(judge(before, after).verdict, 'same', 'every run against every run: the drift swamps 8%');
  const paired = judgePaired(before, after, { unit: ' ms' });
  assert.equal(paired.verdict, 'better', paired.why);
  assert.equal(paired.wins, 6);
  assert.equal(paired.p, Number((1 / 64).toFixed(5)), 'all six pairs: 1 of 64 sign patterns');
  assert.match(paired.why, /after was lower in 6 of 6 pairs/);
  const t = signedRankTest([-0.1, -0.2, -0.05, -0.3, -0.15, 0.01]);
  assert.equal(t.wins, 5);
  assert.ok(t.less < 0.05, 'five wins and the smallest loss still counts with six pairs');
  assert.equal(signedRankTest([-0.1, 0.2, -0.05, 0.3, -0.15, 0.01]).less > 0.05, true);
  // A guard with few pairs: worse only when after was worse in every pair (and by 5% or more).
  const worse = judgePaired(drift, drift.map((x) => x * 1.12));
  assert.equal(worse.verdict, 'worse');
  const mostly = judgePaired(drift, drift.map((x, i) => x * (i === 2 ? 0.99 : 1.12)));
  assert.equal(mostly.verdict, 'same', 'worse in five of six pairs is not enough for a guard');
  assert.equal(judgePaired([1, 2], [1, 2]).verdict, 'unknown');
});

/** A run as `homie-studio perf` writes it, with a host and a replica, from a few numbers. */
function fakeRun(device, k, { p95 = 16.7, busy = 1.2, playable = 500, heap = 2, kbOut = 9, loaded = false, blocked = null } = {}) {
  const browser = (role, f) => ({
    role,
    load: { firstFrameMs: playable - 100, seatedMs: playable, playableMs: playable, gameKb: 23 },
    frames: { n: 900, fps: 60, p50: 16.7, p95: p95 * f, p99: 16.8, max: 17, over33: 0, over50: 0 },
    work: { p50: 0.5, p95: 1, mean: busy * 0.4 * f },
    main: { busyPerFrame: busy * f, scriptMsPerS: 30 },
    heap: { afterGcMb: heap, gcGrowthMbPerMin: 0.1 },
    net: { msgsOut: 21, msgsIn: 20, kbOut: role === 'host' ? kbOut : 1.2, kbIn: role === 'host' ? 1.4 : kbOut },
  });
  return { v: 1, kind: 'homie-perf-run', game: 'gem-rush', device, k, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4)', loaded, blocked, load: { before: { load1: loaded ? 9 : 3 }, after: { load1: 3 } }, browsers: [browser('host', 1), browser('replica', 0.95)] };
}
function writeRuns(dir, runs) {
  mkdirSync(dir, { recursive: true });
  for (const [i, r] of runs.entries()) writeFileSync(join(dir, `${r.device}-${i + 1}.json`), JSON.stringify(r));
  return dir;
}

test('metrics are flat names per device and role, all lower is better; the summary leaves out busy and blocked runs', () => {
  const m = metricsOfRun(fakeRun('phone', 1));
  for (const k of ['phone.host.frame.p95', 'phone.replica.busy', 'phone.host.load.playable', 'phone.host.heap', 'phone.host.net.kbOut', 'phone.replica.work.mean']) assert.ok(Number.isFinite(m[k]), k);
  const s = summaryOf([fakeRun('phone', 1), fakeRun('phone', 2, { loaded: true }), fakeRun('phone', 3, { blocked: 'software renderer' })]);
  assert.equal(s.runs, 3);
  assert.equal(s.counted, 1);
  assert.equal(s.metrics['phone.host.busy'].n, 1);
  assert.match(deviceLabel('phone', 6), /CPU throttle at 6x \(each run measures/);
  assert.equal(DEFAULT_GOAL, 'phone.host.frame.p95');
  assert.ok(!defaultGuards(['phone'], 'phone.host.busy').includes('phone.host.busy'), 'the goal is never its own guard');
});

test('perf compare: a better goal is kept, a guard that got worse wins over it, busy runs are left out, too few is blocked', () => {
  const dir = join(scratch, 'compare');
  const busy = [1.10, 0.95, 1.20, 1.05, 0.98];
  const before = writeRuns(join(dir, 'a'), busy.map((b, i) => fakeRun('phone', i + 1, { busy: b })));
  const after = writeRuns(join(dir, 'b'), [0.80, 0.78, 0.85, 0.82, 0.79].map((b, i) => fakeRun('phone', i + 1, { busy: b })));
  const kept = perfCompare(before, after, { goal: 'phone.host.busy' });
  assert.equal(kept.verdict, 'better', kept.why);
  assert.ok(existsSync(join(after, 'compare.json')));
  assert.ok(kept.guards.some((g) => g.metric === 'phone.replica.busy'));
  // The same gain, but the time to playable got a third worse: not kept.
  const slower = writeRuns(join(dir, 'c'), [0.80, 0.78, 0.85, 0.82, 0.79].map((b, i) => fakeRun('phone', i + 1, { busy: b, playable: 660 + i })));
  const traded = perfCompare(before, slower, { goal: 'phone.host.busy' });
  assert.equal(traded.verdict, 'worse');
  assert.match(traded.why, /phone\.host\.load\.playable got worse/);
  // Within the noise: the same.
  const same = writeRuns(join(dir, 'd'), [1.02, 1.12, 0.93, 1.08, 0.99].map((b, i) => fakeRun('phone', i + 1, { busy: b })));
  assert.equal(perfCompare(before, same, { goal: 'phone.host.busy' }).verdict, 'same');
  // Three of five after-runs started on a busy computer: two left, too few to judge.
  const loaded = writeRuns(join(dir, 'e'), [0.8, 0.8, 0.8, 0.8, 0.8].map((b, i) => fakeRun('phone', i + 1, { busy: b, loaded: i < 3 })));
  const blocked = perfCompare(before, loaded, { goal: 'phone.host.busy' });
  assert.equal(blocked.verdict, 'blocked');
  assert.deepEqual(blocked.left, { before: 0, after: 3 });
  assert.match(blocked.why, /too few runs that count/);
  // `also` holds another metric as a guard.
  assert.ok(perfCompare(before, after, { goal: 'phone.host.busy', also: ['phone.host.frame.p99'] }).guards.some((g) => g.metric === 'phone.host.frame.p99'));
  assert.equal(perfCompare(join(dir, 'nothing'), after).ok, false);
  assert.match(kept.test, /^unpaired/);
  // The same runs labelled in pairs (taken side by side): judged as pairs; the newest usable run of a label counts.
  const label = (runs) => runs.map((r, i) => ({ ...r, pair: `phone-${i + 1}`, at: `2026-10-02T10:0${i}:00Z` }));
  const pbefore = writeRuns(join(dir, 'pa'), label(busy.map((b, i) => fakeRun('phone', i + 1, { busy: b }))));
  const pafter = writeRuns(join(dir, 'pb'), [...label([0.80, 0.78, 0.85, 0.82, 0.79].map((b, i) => fakeRun('phone', i + 1, { busy: b }))), { ...fakeRun('phone', 6, { busy: 0.5, loaded: true }), pair: 'phone-1', at: '2026-10-02T11:00:00Z' }]);
  const pairs = perfCompare(pbefore, pafter, { goal: 'phone.host.busy' });
  assert.match(pairs.test, /^paired: 5 pairs/);
  assert.equal(pairs.goal.paired, true);
  assert.equal(pairs.verdict, 'better', pairs.why);
  assert.equal(pairs.goal.after.median, 0.8, 'the busy rerun of phone-1 is left out, not counted as its pair');
});

test('a CPU profile summed per function: idle apart, self and total, a minified bundle read through its esbuild source map', async () => {
  const esbuild = await import(join(REPO_NM, 'esbuild', 'lib', 'main.js')).then((m) => m.default ?? m);
  const src = join(scratch, 'prof');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'main.ts'), [
    'export function draw(n: number): number {',
    '  let s = 0;',
    '  for (let i = 0; i < n; i++) s += Math.sqrt(i);',
    '  return s;',
    '}',
    'const stepHost = (dt: number): number => draw(dt * 2) + 1;',
    'export function frame(t: number): number { return stepHost(t) + [1, 2].map((x) => x * t).length; }',
    '',
  ].join('\n'));
  const res = await esbuild.build({ entryPoints: [join(src, 'main.ts')], bundle: true, minify: true, format: 'esm', sourcemap: 'external', write: false, outdir: join(src, 'out'), absWorkingDir: src, logLevel: 'silent' });
  const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const map = JSON.parse(res.outputFiles.find((f) => f.path.endsWith('.map')).text);
  assert.ok(decodeMappings(map.mappings).some((line) => line.length), 'the mappings decode');
  // Where V8 would put each function: `function <name>(` for a declaration, the arrow's first parameter for an arrow.
  const lines = js.split('\n');
  const at = (re) => { for (const [i, l] of lines.entries()) { const m = re.exec(l); if (m) return [i, m.index + (m[1] ? m[0].indexOf(m[1]) : 0)]; } return null; };
  const lookup = sourceMapLookup(map);
  const drawAt = at(/function (\w+)\(\w+\)\{let/);
  const hit = lookup(drawAt[0], drawAt[1]);
  assert.equal(hit.source, 'main.ts');
  assert.equal(hit.line, 1);
  assert.equal(hit.name, 'draw');
  const url = 'http://127.0.0.1:8787/gem-rush/__game/assets/main.js';
  const cf = (functionName, [lineNumber, columnNumber], u = url) => ({ functionName, url: u, lineNumber, columnNumber, scriptId: '1' });
  const minDraw = /function (\w+)\(/.exec(js)[1];
  const profile = {
    nodes: [
      { id: 1, callFrame: cf('(root)', [0, 0], ''), children: [2, 3, 6] },
      { id: 2, callFrame: cf('(idle)', [0, 0], ''), children: [] },
      { id: 3, callFrame: cf('frame', [0, 0]), children: [4] },
      { id: 4, callFrame: cf('stepHost', [0, 0]), children: [5] },
      { id: 5, callFrame: cf(minDraw, drawAt), children: [] },
      { id: 6, callFrame: cf('(garbage collector)', [0, 0], ''), children: [] },
    ],
    samples: [2, 2, 2, 2, 5, 5, 5, 4, 6, 2],
    timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
  };
  const s = summarizeProfile(profile, { maps: [{ match: (u) => u === url, lookup }], game: (u) => /__game/.test(u) });
  assert.equal(s.ms, 10);
  assert.equal(s.idlePct, 50, 'idle is kept apart');
  assert.equal(s.gcPct, 20);
  const top = s.top[0];
  assert.equal(top.name, 'draw', 'the minified name read back through the map');
  assert.equal(top.minified, minDraw);
  assert.equal(top.where, 'main.ts:1');
  assert.equal(top.selfPct, 60);
  assert.equal(s.top.find((t) => t.name === 'frame' || t.minified === 'frame')?.totalPct, 80, 'frame: its own time and its callees\'');
  assert.equal(s.gamePct, 80);
});

test('build --maps: the map and module sizes go to .studio/maps/<id>/, never into site/dist, and the bundle is the same bytes', () => {
  const dir = join(scratch, 'maps');
  const r = run(['new', dir, '--name', 'Perf Test', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  assert.equal(run(['game', 'new', 'gem-rush', '--from', 'gem-rush'], dir).status, 0);
  assert.equal(run(['build', 'gem-rush'], dir).status, 0);
  // The bundle is named by its content: bundle.json beside the page says which file it is.
  const gameDir = join(dir, 'site', 'dist', 'games', 'gem-rush');
  const bundle = JSON.parse(readFileSync(join(gameDir, 'bundle.json'), 'utf8')).bundle;
  const main = join(gameDir, bundle);
  const plain = readFileSync(main);
  assert.ok(!existsSync(join(dir, '.studio', 'maps', 'gem-rush')), 'a plain build keeps no map');
  const built = JSON.parse(run(['build', 'gem-rush', '--maps'], dir).stdout);
  assert.equal(built.ok, true);
  assert.equal(JSON.parse(readFileSync(join(gameDir, 'bundle.json'), 'utf8')).bundle, bundle, 'the same name: a map changes no byte of it');
  assert.equal(sha(readFileSync(main)), sha(plain), 'the bundle is byte for byte the plain build\'s');
  assert.deepEqual(readdirSync(join(gameDir, 'assets')).filter((f) => f.endsWith('.map')), [], 'no map of any name in site/dist');
  assert.ok(!existsSync(`${main}.map`), 'no map in site/dist: a deploy never ships it');
  assert.doesNotMatch(readFileSync(main, 'utf8'), /sourceMappingURL/);
  const maps = join(dir, '.studio', 'maps', 'gem-rush');
  for (const f of ['main.js.map', 'meta.json', 'main.js.sha256']) assert.ok(existsSync(join(maps, f)), f);
  assert.equal(readFileSync(join(maps, 'main.js.sha256'), 'utf8').trim(), sha(plain));
  const sizes = perfSizes(dir, 'gem-rush');
  assert.equal(sizes.ok, true);
  assert.ok(sizes.js.bytes > 20_000 && sizes.js.gzip < sizes.js.bytes);
  assert.ok(sizes.biggest.some((file) => file.path === bundle), 'the entry is listed beside the shared rules/runtime chunks');
  assert.equal(sizes.biggest[0].code.minified, true, 'a studio build is minified, and perf sizes reads it so');
  const meta = JSON.parse(readFileSync(join(maps, 'meta.json'), 'utf8'));
  assert.ok(Object.values(meta.outputs).some((out) => Object.keys(out.inputs).some((name) => /netplay\/netplay\.ts$/.test(name))), 'the netplay helper is in a built chunk');
  assert.ok(sizes.modules.top.some((m) => /games\/gem-rush\/src\/view\.ts$/.test(m.module)));
  assert.match(sizes.apart.note, /never loaded by the game/, 'what the game never loads is listed apart');
  // The CLI says the same, as paths and numbers.
  const cli = JSON.parse(run(['perf', 'sizes', 'gem-rush'], dir).stdout);
  assert.equal(cli.total.bytes, sizes.total.bytes);
  // A map from another build is never used.
  writeFileSync(join(maps, 'main.js.sha256'), `${'0'.repeat(64)}\n`);
  assert.equal(perfSizes(dir, 'gem-rush').modules, null);
  assert.equal(perfSizes(dir, 'no-such-game').ok, false);
  // perf without a site to measure says what to start, and never opens a browser.
  const none = JSON.parse(run(['perf', 'gem-rush', '--url', 'http://127.0.0.1:9'], dir).stdout);
  assert.equal(none.ok, false);
  assert.match(none.why, /does not answer: start the site|no Chrome|puppeteer/);
});

/* ------------------------------------------------------------------------------------------------- minified or not */

const THREE_FIX = join(PKG, 'test', 'fixtures', 'three-bundles');
const ratio = (buf) => gzipSync(buf, { level: 6 }).length / buf.length;

test('a minified three.js bundle reads as minified, its shaders apart; the same bundle unminified does not; gzip could not tell', () => {
  const min = readFileSync(join(THREE_FIX, 'three-shaders.min.js'));
  const src = readFileSync(join(THREE_FIX, 'three-shaders.js'));
  // What 0.19.0 read: "compresses like source text" (gzip over 17% of the bytes). Both files do, so it flagged both.
  assert.ok(ratio(min) > 0.17 && ratio(src) > 0.17, `gzip ratios ${ratio(min).toFixed(3)} and ${ratio(src).toFixed(3)}`);
  const m = readCode(min.toString('utf8'));
  assert.equal(m.minified, true, m.why);
  assert.equal(m.mangled, true, m.why);
  assert.ok(m.whitespacePct < 3, `whitespace ${m.whitespacePct}%`);
  assert.ok(m.shaderPct > 30 && m.shaderPct <= m.stringPct, `shader ${m.shaderPct}% of ${m.stringPct}% strings`);
  assert.match(m.why, /^minified, names shortened .*GLSL shader source/);
  const u = readCode(src.toString('utf8'));
  assert.equal(u.minified, false, u.why);
  assert.ok(u.whitespacePct > 15, `whitespace ${u.whitespacePct}%`);
  assert.ok(u.commentPct > 10, `comments ${u.commentPct}%`);
  assert.match(u.why, /^not minified/);
  // The same shaders in both: a minifier never touches a string.
  assert.ok(Math.abs((m.shaderPct / 100) * min.length - (u.shaderPct / 100) * src.length) < 0.02 * src.length, 'the same GLSL bytes in both');
  // The licence comment a minifier keeps is not counted against it.
  assert.ok(m.licencePct > 0 && m.commentPct === 0);
});

test('minified with its names kept (whitespace and syntax only) is minified; esbuild\'s own output reads the same', async () => {
  const esbuild = await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'));
  const src = readFileSync(join(THREE_FIX, 'three-shaders.js'), 'utf8');
  const kept = (await esbuild.transform(src, { minifyWhitespace: true, minifySyntax: true, format: 'esm', legalComments: 'inline' })).code;
  const r = readCode(kept);
  assert.equal(r.minified, true, r.why);
  assert.equal(r.mangled, false, `three.js's names are still there: ${r.why}`);
  const full = readCode((await esbuild.transform(src, { minify: true, format: 'esm' })).code);
  assert.equal(full.minified && full.mangled, true, full.why);
  assert.ok(r.nameLength > full.nameLength + 1 && r.shortNamesPct < full.shortNamesPct - 20, `names ${r.nameLength} vs ${full.nameLength} characters`);
});

test('the reader keeps code, strings, templates, regular expressions and comments apart', () => {
  const shader = '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif\n';
  const code = [
    'const quote = /[\'"`]/g; // a backtick in a regular expression is not a template',
    'if (ok) /`/.test(s) && go();',
    'const half = width / 2 / scale, rate = (a + b) / c;',
    `const fog = \`${shader}\`;`,
    'const nested = `a${`b${c}d`}e`;',
    'const obj = { alpha: 1, beta: { gamma: 2 } }; /* a note */',
  ].join('\n');
  const r = readCode(code);
  // The shader template is read as a string (and as shader source); the regular expressions' backticks never opened one.
  assert.ok(r.shaderPct > 0, 'the GLSL template is shader source');
  const shaderShare = shader.length / code.length;
  assert.ok(Math.abs(r.shaderPct / 100 - shaderShare) < 0.01, `shader ${r.shaderPct}% vs ${(shaderShare * 100).toFixed(1)}%`);
  // Names that a minifier renames are counted (quote, ok, s, go, half, width, scale ...); keys and properties are not.
  assert.ok(r.names >= 14 && r.names <= 20, `${r.names} names`);
  assert.equal(r.minified, false, 'indented with comments');
  // An empty file, and a string left open at the end of its line, are read without throwing.
  assert.equal(readCode('').minified, false);
  const open = readCode('"left open\nconst after = 1;\n');
  assert.ok(open.stringPct > 0 && open.names === 1, 'the string stops at its line; the next line is code');
});

test('three.js\'s own builds: the plain files are not minified, the .min.js ones are, whatever gzip says', { skip: !existsSync(join(REPO_NM, 'three', 'build', 'three.module.min.js')) && 'node_modules has no three' }, () => {
  const b = (f) => readFileSync(join(REPO_NM, 'three', 'build', f));
  for (const f of ['three.core.js', 'three.module.js']) {
    const r = readCode(b(f).toString('utf8'));
    assert.equal(r.minified, false, `${f}: ${r.why}`);
    assert.ok(ratio(b(f)) > 0.17, `${f} gzips like text`);
  }
  for (const f of ['three.core.min.js', 'three.module.min.js']) {
    const r = readCode(b(f).toString('utf8'));
    assert.equal(r.minified, true, `${f}: ${r.why}`);
    assert.equal(r.mangled, true, `${f}: ${r.why}`);
    assert.ok(ratio(b(f)) > 0.2, `${f} gzips at ${ratio(b(f)).toFixed(3)} minified, more than its source`);
  }
  // three.module.js carries the renderer and its shaders: about two fifths of the minified file is GLSL.
  const mod = readCode(b('three.module.min.js').toString('utf8'));
  assert.ok(mod.shaderPct > 30, `shader ${mod.shaderPct}%`);
  assert.ok(readCode(b('three.core.min.js').toString('utf8')).shaderPct < 2, 'the core has no shaders');
});

test('perf sizes says which big scripts are minified (code), from the files themselves', () => {
  const dir = join(scratch, 'sizes-code');
  const dist = join(dir, 'site', 'dist', 'games', 'sky-race');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'games', 'sky-race'), { recursive: true });
  writeFileSync(join(dir, 'studio.json'), '{"name":"Sizes","slug":"sizes"}\n');
  writeFileSync(join(dir, 'games', 'sky-race', 'game.json'), '{"id":"sky-race"}\n');
  cpSync(join(THREE_FIX, 'three-shaders.min.js'), join(dist, 'assets', 'index-a1b2.js'));
  cpSync(join(THREE_FIX, 'three-shaders.js'), join(dist, 'vendor.js'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><script type="module" src="./assets/index-a1b2.js"></script>\n');
  writeFileSync(join(dist, 'small.js'), 'export const x = 1;\n');
  const s = perfSizes(dir, 'sky-race');
  const by = Object.fromEntries(s.biggest.map((f) => [f.path, f]));
  assert.equal(by['assets/index-a1b2.js'].code.minified, true);
  assert.ok(by['assets/index-a1b2.js'].code.shaderPct > 30);
  assert.equal(by['vendor.js'].code.minified, false);
  assert.equal(by['small.js'].code, undefined, 'a small script is not read');
  assert.equal(by['index.html'].code, undefined);
  const cli = run(['perf', 'sizes', 'sky-race'], dir);
  assert.equal(JSON.parse(cli.stdout).biggest.find((f) => f.path === 'vendor.js').code.minified, false);
  const text = spawnSync(process.execPath, [CLI, 'perf', 'sizes', 'sky-race'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } }).stdout;
  assert.match(text, /assets\/index-a1b2\.js .*minified, \d+(\.\d)?% GLSL shader source in strings/);
  assert.match(text, /vendor\.js .*NOT minified/);
});

test('measured pre-play transfer: what was really fetched up to playable, in-flight bytes included, absent when never playable', () => {
  // The fault this guards: a total of the built folder (unused models, streamed music) read as "downloaded before the
  // first round". Here only what the browser asked for by then counts, and a file still arriving counts what arrived.
  const requests = [
    { url: 'http://127.0.0.1:8787/gem/play', bytes: 4096, got: 4096, done: true },
    { url: 'http://127.0.0.1:8787/gem/__game/assets/main.js', bytes: 204_800, got: 204_800, done: true },
    { url: 'http://127.0.0.1:8787/gem/__game/assets/hero.glb', bytes: 0, got: 51_200, done: false },
  ];
  assert.deepEqual(prePlayTransfer(requests), { requests: 3, finished: 2, inFlight: 1, kb: 254, gameRequests: 2, gameKb: 250 });
  assert.equal(prePlayTransfer(requests, { playable: false }), null, 'never playable: no "before play" to measure');
  const run = { device: 'phone', browsers: [{ role: 'host', load: { playableMs: 1700, gameKb: 200, prePlay: prePlayTransfer(requests) }, render: renderCostOf([{ drawCalls: 212, triangles: 105_442 }]) }, { role: 'replica', load: { playableMs: null, prePlay: null }, render: { samples: 0, drawCalls: null, triangles: null } }] };
  const m = metricsOfRun(run);
  assert.equal(m['phone.host.load.prePlayKb'], 254);
  assert.equal(m['phone.host.render.calls'], 212);
  assert.equal(m['phone.host.render.triangles'], 105_442);
  assert.ok(!('phone.replica.load.prePlayKb' in m) && !('phone.replica.render.calls' in m), 'not measured is absent, never 0');
});

test('measured renderer cost: medians of what the game exposes; a game that exposes nothing has none', () => {
  assert.deepEqual(renderCostOf([{ drawCalls: 212, triangles: 105_442 }, { drawCalls: 213, triangles: 119_148 }, { drawCalls: 25, triangles: 9000 }]), { samples: 3, drawCalls: { median: 212, max: 213 }, triangles: { median: 105_442, max: 119_148 } });
  assert.equal(renderCostOf([null, { drawCalls: NaN, triangles: NaN }]), null);
});

test('perf: a name this process cannot resolve is a blocked preflight, not "the site is down"', async (t) => {
  // The fault: Node's resolver fails for the public address (.invalid never resolves; no network is needed to fail).
  const r = await perfRun({ url: 'http://homie-perf.invalid', game: 'gem' });
  if (/no Chrome|puppeteer-core/.test(r.why ?? '')) { t.skip('no Chrome on this machine: the preflight is never reached'); return; }
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'BLOCKED');
  assert.match(r.why, /^BLOCKED network preflight failed, before any page or game was opened: this computer's Node\.js could not look up homie-perf\.invalid/);
  assert.match(r.why, /127\.0\.0\.1:8787/);
});

test('server rooms default to a replica goal and guard the second replica against regressions', () => {
  const server = (k, p95, secondBusy = 1) => {
    const r = fakeRun('phone', k, { p95 });
    r.room = { hosted: 'server' };
    r.browsers[0].role = 'replica'; r.browsers[1].role = 'replica-2';
    r.browsers[1].main.busyPerFrame = secondBusy;
    return r;
  };
  const before = writeRuns(join(scratch, 'server-before'), [1,2,3,4,5,6].map((k) => server(k, 30)));
  const after = writeRuns(join(scratch, 'server-after'), [1,2,3,4,5,6].map((k) => server(k, 20, 4)));
  const result = perfCompare(before, after);
  assert.equal(result.goal.metric, 'phone.replica.frame.p95');
  assert.equal(result.goal.verdict, 'better');
  assert.equal(result.verdict, 'worse');
  assert.ok(result.guards.some((g) => g.metric === 'phone.replica-2.busy' && g.verdict === 'worse'));
  assert.ok(!result.guards.some((g) => g.metric.includes('.host.')));
});
