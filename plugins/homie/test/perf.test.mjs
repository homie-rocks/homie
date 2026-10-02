/**
 * The perf skill's loop, end to end, without a browser: a studio whose `homie-studio` is a stand-in (it builds by
 * copying, passes or fails the two-browser check on cue, and "measures" a build by reading a speed the game's source
 * declares, with run-to-run noise; `perf compare` and `perf sizes` are the real ones), and a small local site that
 * serves the built game the way a studio's Worker does (its page with a HOMIE_NET line, its files as they are).
 *
 *   - baseline keeps the build and the source, runs the check, measures, and writes BASELINE.md;
 *   - a change that is faster beyond the noise is KEPT, and becomes the build to beat;
 *   - a change inside the noise is REVERTED: games/<game>/ is the kept source again (a file it added is removed);
 *   - a change the check fails on is REVERTED before anything is measured;
 *   - try without saying how it looks and plays is refused;
 *   - report writes perf/<game>/README.md, numbers.json and the kept change as a patch.
 * A real loop is `node perf.mjs baseline <game> --url <site>` in a studio (Chrome on a GPU, the perf skill).
 * Run: node --test plugins/homie/test/perf.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERF = join(HERE, '..', 'skills', 'perf', 'scripts', 'perf.mjs');
const STUDIO_LIB = join(HERE, '..', '..', '..', 'packages', 'studio', 'lib', 'perf.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-perf-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * The stand-in CLI. `perf` writes one run whose busy-per-frame is the game's declared speed (games/<g>/speed.txt, as
 * built) times a seeded wobble of +-6%, and whose playable time and frame time do not move; `check` fails when the
 * game's source says so (check.txt = fail).
 */
const FAKE = `#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { perfCompare, perfSizes } = await import(${JSON.stringify(STUDIO_LIB)});
const a = process.argv.slice(2).filter((x) => x !== '--json');
const flag = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const root = process.cwd();
const out = (o) => process.stdout.write(JSON.stringify(o));
if (a[0] === 'version') out({ ok: true, command: 'version', version: '0.19.0' });
else if (a[0] === 'build') {
  const g = a[1];
  const dist = join(root, 'site', 'dist', 'games', g);
  rmSync(dist, { recursive: true, force: true });
  cpSync(join(root, 'games', g), dist, { recursive: true });
  mkdirSync(join(root, '.studio', 'maps', g), { recursive: true });
  out({ ok: true, command: 'build', games: [{ id: g }] });
} else if (a[0] === 'check') {
  const fail = existsSync(join(root, 'site', 'dist', 'games', a[1], 'check.txt')) && readFileSync(join(root, 'site', 'dist', 'games', a[1], 'check.txt'), 'utf8').trim() === 'fail';
  out(fail ? { ok: false, command: 'check', why: 'no round finished with both browsers' } : { ok: true, command: 'check', totalMs: 1000 });
} else if (a[0] === 'perf' && a[1] === 'compare') out(perfCompare(a[2], a[3], { goal: flag('goal'), min: Number(flag('min')) / 100, also: flag('also') ? flag('also').split(',') : [] }));
else if (a[0] === 'perf' && a[1] === 'sizes') out(perfSizes(root, a[2]));
else if (a[0] === 'perf') {
  const g = a[1]; const dir = flag('out'); const device = flag('device');
  mkdirSync(dir, { recursive: true });
  let k = 1; while (existsSync(join(dir, device + '-' + k + '.json'))) k++;
  const speed = Number(readFileSync(join(root, 'site', 'dist', 'games', g, 'speed.txt'), 'utf8'));
  const n = readdirSync(dir).length + Number(process.env.PERF_SEED ?? 0);
  const wobble = 1 + 0.06 * Math.sin(n * 2.3 + (device === 'phone' ? 1 : 0));
  const b = (role) => ({ role, load: { playableMs: 500 + (n % 3), firstFrameMs: 400 }, frames: { p50: 16.7, p95: 16.7 + (n % 2) * 0.1, over50: 0 }, work: { mean: 0.4 }, main: { busyPerFrame: speed * wobble * (role === 'host' ? 1 : 0.9) }, heap: { afterGcMb: 2 + (n % 2) * 0.01 }, net: { kbOut: 9, kbIn: 1, msgsOut: 21, msgsIn: 20 } });
  const run = { v: 1, kind: 'homie-perf-run', game: g, device, deviceLabel: device, renderer: 'stand-in GPU', machine: { cpu: 'stand-in', cores: 8 }, load: { before: { load1: 1 }, after: { load1: 1 } }, loaded: false, blocked: null, browsers: [b('host'), b('replica')] };
  if (a.includes('--profile')) run.browsers[0].profile = { file: 'x.cpuprofile', seconds: 5, mapped: true, idlePct: 80, gamePct: 30, gcPct: 2, programPct: 50, top: [{ name: 'draw', where: 'src/main.ts:10', game: true, selfMs: 20, selfPct: 10, totalPct: 40 }] };
  const file = join(dir, device + '-' + k + '.json');
  writeFileSync(file, JSON.stringify(run));
  out({ ok: true, command: 'perf', runs: [file] });
} else out({ ok: false, why: 'stand-in: unknown ' + a.join(' ') });
`;

/** A site that serves site/dist/games/<g>/ the way a studio's Worker does. */
function site(root) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const m = /^\/([a-z0-9-]+)\/(play|__game\/(.*))$/.exec(u.pathname);
      if (!m) { res.writeHead(404); res.end(); return; }
      const dist = join(root, 'site', 'dist', 'games', m[1]);
      if (m[2] === 'play') { res.end('<!doctype html><title>play</title>'); return; }
      const rel = m[3] || 'index.html';
      const file = join(dist, decodeURIComponent(rel));
      if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
      let body = readFileSync(file);
      if (rel === 'index.html') body = Buffer.from(String(body).replace(/<head>/, '<head><script>window.HOMIE_NET={"v":1}</script>'));
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

const perf = (args, cwd, env = {}) => new Promise((ok) => {
  const p = spawn(process.execPath, [PERF, ...args, '--json'], { cwd, env: { ...process.env, ...env } });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* */ } ok({ code, json, out, err }); });
});

test('the perf loop: baseline, a kept change, a reverted one, a refused one, a failed check, and the report', async () => {
  const root = join(scratch, 'studio');
  const game = join(root, 'games', 'gem-rush');
  mkdirSync(join(game, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'studio.json'), '{"name":"Perf Test","slug":"perf-test"}\n');
  writeFileSync(join(game, 'game.json'), '{"id":"gem-rush","name":"Gem Rush"}\n');
  writeFileSync(join(game, 'index.html'), '<!doctype html><html><head><title>g</title></head><body></body></html>\n');
  writeFileSync(join(game, 'src', 'main.ts'), 'export const draw = () => 1;\n');
  writeFileSync(join(game, 'speed.txt'), '1.00\n');
  const bin = join(root, 'node_modules', '.bin', 'homie-studio');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  const server = await site(root);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const base = await perf(['baseline', 'gem-rush', '--url', url, '--goal', 'phone.host.busy', '--runs', '5', '--seconds', '5'], root);
    assert.equal(base.code, 0, base.out + base.err);
    assert.equal(base.json.goal, 'phone.host.busy');
    const loop = base.json.loop;
    for (const f of [['session.json'], ['BASELINE.md'], ['builds', 'base', 'manifest.json'], ['sources', 'base', 'src', 'main.ts']]) assert.ok(existsSync(join(loop, ...f)), f.join('/'));
    assert.equal(readdirSync(join(loop, 'runs', 'base')).filter((f) => /^(computer|phone)-\d+\.json$/.test(f)).length, 10, '5 runs on each device');
    const md = readFileSync(join(loop, 'BASELINE.md'), 'utf8');
    assert.match(md, /phone\.host\.busy/);
    assert.match(md, /frames already keep pace with the display/, 'a hint that reads the frame time');
    assert.match(md, /draw \(src\/main\.ts:10\)|draw \| src\/main\.ts:10/, 'the hottest function from the profile');

    const refused = await perf(['try', 'gem-rush', '--name', 'faster'], root);
    assert.equal(refused.code, 1);
    assert.match(refused.json.why, /--looks same/, 'how it looks and plays must be said');

    // 1. A change that makes the game 25% faster: kept.
    writeFileSync(join(game, 'speed.txt'), '0.75\n');
    writeFileSync(join(game, 'src', 'main.ts'), 'export const draw = () => 2; // cached\n');
    writeFileSync(join(game, 'lib.min.js'), `/* a minified library */${'x=1;'.repeat(80_000)}\n`);
    const kept = await perf(['try', 'gem-rush', '--name', 'Cache the background gradient', '--looks', 'same', '--plays', 'same'], root);
    assert.equal(kept.code, 0, kept.out + kept.err);
    assert.equal(kept.json.verdict, 'KEEP', kept.json.why);
    assert.match(kept.json.goal, /phone\.host\.busy: .*-2\d\.\d%/);
    assert.equal(JSON.parse(readFileSync(join(loop, 'session.json'), 'utf8')).kept, 'c1');
    assert.match(readFileSync(join(game, 'src', 'main.ts'), 'utf8'), /cached/, 'a kept change stays');
    const exp1 = join(loop, 'experiments', '01-cache-the-background-gradient');
    assert.match(readFileSync(join(exp1, 'change.patch'), 'utf8'), /\+\+\+ b\/games\/gem-rush\/src\/main\.ts/);
    assert.match(readFileSync(join(exp1, 'RESULT.md'), 'utf8'), /\*\*KEEP\*\*/);

    // 2. A change inside the noise (1% faster, with a new file): reverted, the file removed, the source as kept.
    writeFileSync(join(game, 'speed.txt'), '0.7425\n');
    writeFileSync(join(game, 'src', 'extra.ts'), 'export const x = 1;\n');
    const noise = await perf(['try', 'gem-rush', '--name', 'Hoist a constant', '--looks', 'same', '--plays', 'same'], root);
    assert.equal(noise.json.verdict, 'REVERT', noise.json.why);
    assert.match(noise.json.why, /not better beyond the noise/);
    assert.ok(!existsSync(join(game, 'src', 'extra.ts')), 'the file the change added is gone');
    assert.equal(readFileSync(join(game, 'speed.txt'), 'utf8'), '0.75\n', 'the kept source is back');
    assert.ok(noise.json.restored.some((r) => /removed games\/gem-rush\/src\/extra\.ts/.test(r)));
    const served = await fetch(`${url}/gem-rush/__game/speed.txt`).then((r) => r.text());
    assert.equal(served, '0.75\n', 'the kept build is served again');

    // 3. A change the two-browser check fails on: reverted before anything is measured.
    writeFileSync(join(game, 'check.txt'), 'fail\n');
    writeFileSync(join(game, 'speed.txt'), '0.4\n');
    const broken = await perf(['try', 'gem-rush', '--name', 'Skip the snapshot', '--looks', 'same', '--plays', 'same'], root);
    assert.equal(broken.json.verdict, 'REVERT');
    assert.match(broken.json.why, /two-browser check failed/);
    assert.ok(!existsSync(join(game, 'check.txt')));
    assert.ok(!existsSync(join(loop, 'experiments', '03-skip-the-snapshot', 'runs')), 'nothing measured');

    const st = await perf(['status', 'gem-rush'], root);
    assert.equal(st.json.kept, 'c1');
    assert.equal(st.json.changes.length, 3);
    assert.equal(st.json.uncommittedChange, null);

    const rep = await perf(['report', 'gem-rush'], root);
    assert.equal(rep.code, 0, rep.out + rep.err);
    const out = join(root, 'perf', 'gem-rush');
    const readme = readFileSync(join(out, 'README.md'), 'utf8');
    assert.match(readme, /1 of 3 changes kept/);
    assert.match(readme, /Cache the background gradient\*\*: KEEP/);
    assert.match(readme, /Hoist a constant\*\*: REVERT/);
    assert.match(readme, /Skip the snapshot\*\*: REVERT\. the two-browser check failed/);
    assert.match(readme, /How it looks and plays: unchanged/);
    const numbers = JSON.parse(readFileSync(join(out, 'numbers.json'), 'utf8'));
    assert.equal(numbers.goal, 'phone.host.busy');
    assert.equal(numbers.final.goal.verdict, 'better');
    assert.equal(numbers.changes.length, 3);
    // The kept change's diff is over 256 KB (a minified file): the report lists its files, sizes and hashes instead.
    const files = readFileSync(join(out, 'before-after', '01-cache-the-background-gradient.files.txt'), 'utf8');
    assert.match(files, /added +games\/gem-rush\/lib\.min\.js +- B → 3200\d\d B/);
    assert.match(files, /changed +games\/gem-rush\/src\/main\.ts/);
    assert.ok(!existsSync(join(out, 'before-after', '01-cache-the-background-gradient.patch')));
    assert.ok(!existsSync(join(out, 'before-after', 'all-kept.patch')), 'one change kept: its own patch is the whole of it');
    assert.match(readme, /The change: `before-after\/01-cache-the-background-gradient\.files\.txt`/);
  } finally {
    server.close();
  }
});

test('perf.mjs outside a studio, and its help and goals', async () => {
  const away = join(scratch, 'away');
  mkdirSync(away, { recursive: true });
  const r = await perf(['baseline', 'gem-rush', '--url', 'http://127.0.0.1:9'], away);
  assert.equal(r.code, 1);
  assert.match(r.json.why, /not inside a Homie studio/);
  const help = await perf(['help'], away);
  assert.match(help.json.usage, /baseline <game> --url <site>/);
  const goals = await perf(['goals'], away);
  assert.ok(goals.json.metrics.some((m) => /^busy:/.test(m)));
});
