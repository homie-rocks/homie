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
 *   - a change kept for how it feels (--measure) is MEASURED, its cost said, and never reverted;
 *   - try without saying how it looks and plays is refused;
 *   - report writes perf/<game>/README.md, numbers.json and the kept change as a patch.
 * And (plugin 0.20.1) the check that the site serves the build being measured:
 *   - a studio's own Worker that adds a script to the game page (beside HOMIE_NET) is measured, and BASELINE.md says
 *     what it adds; a stale page (another bundle's name) is still refused, and so is a Worker that changes mid-loop;
 *   - lib/page.mjs on its own: added scripts set aside, anything of the build's own page that differs refused;
 *   - what BASELINE.md says about the download, from perf sizes' reading of each script: three.js minified is
 *     minified (its shaders said apart), never "looks unminified"; three.js's plain build is not.
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
const THREE_BUILD = join(HERE, '..', '..', '..', 'node_modules', 'three', 'build');
const { gamePageCheck, sameAdditions } = await import('../skills/perf/scripts/lib/page.mjs');
const { sizeHints } = await import('../skills/perf/scripts/lib/sizes.mjs');
const { perfSizes } = await import(STUDIO_LIB);
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

/**
 * A site that serves site/dist/games/<g>/ the way a studio's Worker does. `opts.inject`: what the studio's own Worker
 * adds after the HOMIE_NET line (read on every request, so a test can change it mid-loop); `opts.page`: a function
 * that rewrites the game page (a stale one).
 */
function site(root, opts = {}) {
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
      if (rel === 'index.html') body = Buffer.from((opts.page ?? ((x) => x))(String(body).replace(/<head>/, `<head><script>window.HOMIE_NET={"v":1}</script>${opts.inject ?? ''}`)));
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

    // 4. A change kept for how a move feels (the lab skill: --measure): measured and said in numbers, never reverted.
    writeFileSync(join(game, 'speed.txt'), '0.9\n');
    writeFileSync(join(game, 'src', 'juice.ts'), 'export const sparks = 9;\n');
    const felt = await perf(['try', 'gem-rush', '--name', 'The bump lands', '--looks', 'a flash and sparks', '--plays', 'a 70 ms hit-stop', '--measure'], root);
    assert.equal(felt.code, 0, felt.out + felt.err);
    assert.equal(felt.json.verdict, 'MEASURED', felt.json.why);
    assert.match(felt.json.why, /^worse: phone\.host\.busy/, 'the cost, said');
    assert.ok(existsSync(join(game, 'src', 'juice.ts')), 'nothing reverted');
    assert.equal(readFileSync(join(game, 'speed.txt'), 'utf8'), '0.9\n');
    assert.equal(await fetch(`${url}/gem-rush/__game/speed.txt`).then((r) => r.text()), '0.9\n', 'the changed build is served');
    assert.equal(JSON.parse(readFileSync(join(loop, 'session.json'), 'utf8')).kept, 'c1', 'the build to beat is what it was');
    assert.match(readFileSync(join(loop, 'experiments', '04-the-bump-lands', 'RESULT.md'), 'utf8'), /\*\*MEASURED\*\*/);
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

/** A studio with the stand-in CLI and one game whose page loads a bundle (assets/main.js) and has an inline script. */
function studioWith(name) {
  const root = join(scratch, name);
  const game = join(root, 'games', 'gem-rush');
  mkdirSync(join(game, 'src'), { recursive: true });
  mkdirSync(join(game, 'assets'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'studio.json'), '{"name":"Perf Test","slug":"perf-test"}\n');
  writeFileSync(join(game, 'game.json'), '{"id":"gem-rush","name":"Gem Rush"}\n');
  writeFileSync(join(game, 'index.html'), '<!doctype html>\n<html>\n<head>\n<title>Gem Rush</title>\n<script>window.GAME_BUILD="b1"</script>\n<script type="module" src="./assets/main.js"></script>\n</head>\n<body></body>\n</html>\n');
  writeFileSync(join(game, 'assets', 'main.js'), 'export const draw = () => 1;\n');
  writeFileSync(join(game, 'speed.txt'), '1.00\n');
  const bin = join(root, 'node_modules', '.bin', 'homie-studio');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  return { root, game };
}

/** What a studio's own Worker might add to a game page: a small inline shim, as some do for a knock or a beacon. */
const SHIM = '<script>(function(){try{var real=window.fetch;window.fetch=function(u,i){return real.apply(this,arguments)};}catch(e){}})();</script>';

test('a game page with scripts the studio\'s own Worker adds is measured; a stale page and a Worker that changes mid-loop are not', async () => {
  const { root, game } = studioWith('injected');
  const opts = { inject: SHIM };
  const server = await site(root, opts);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const base = await perf(['baseline', 'gem-rush', '--url', url, '--devices', 'computer', '--runs', '3', '--seconds', '5'], root, { HOMIE_PERF_SERVE_WAIT_MS: '1500' });
    assert.equal(base.code, 0, base.out + base.err);
    assert.match(base.json.page, /the HOMIE_NET line, an inline script of \d+ B/);
    const md = readFileSync(join(base.json.loop, 'BASELINE.md'), 'utf8');
    assert.match(md, /The game page as the site serves it is the build's page plus the HOMIE_NET line, an inline script of \d+ B \(sha256 [0-9a-f]{16}, "\(function\(\)\{try\{var real=window\.fetch;[^"]*…"\): the site's, not the build's/);
    const session = JSON.parse(readFileSync(join(base.json.loop, 'session.json'), 'utf8'));
    assert.deepEqual(session.pageAdded.map((x) => x.kind), ['homie-net', 'inline']);

    // The studio's Worker changes in the middle of the loop: the builds it compares would be served different pages.
    opts.inject = `${SHIM}<script src="/__studio/beacon.js"></script>`;
    writeFileSync(join(game, 'speed.txt'), '0.75\n');
    const changed = await perf(['try', 'gem-rush', '--name', 'Faster', '--looks', 'same', '--plays', 'same'], root, { HOMIE_PERF_SERVE_WAIT_MS: '1500' });
    assert.equal(changed.code, 1, changed.out + changed.err);
    assert.match(changed.json.why, /did not start serving build c1 .*the site now adds the HOMIE_NET line, an inline script .*, a script from \/__studio\/beacon\.js to the game page, and added the HOMIE_NET line, an inline script .* when the loop began/);
    assert.match(changed.json.why, /start a new loop/);
  } finally { server.close(); }

  // A stale page (the site still serves the page of a build with another bundle): refused, with what differs.
  const stale = await site(root, { inject: SHIM, page: (html) => html.replace('./assets/main.js', './assets/main-0ld.js') });
  try {
    const r = await perf(['baseline', 'gem-rush', '--url', `http://127.0.0.1:${stale.address().port}`, '--devices', 'computer', '--runs', '3', '--seconds', '5'], root, { HOMIE_PERF_SERVE_WAIT_MS: '1500' });
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.json.why, /did not start serving build base within \d+ s \(index\.html: the page lacks the build's script \.\/assets\/main\.js/);
  } finally { stale.close(); }
});

test('lib/page.mjs: the scripts a site adds are set aside; anything else of the build\'s own page that differs is not', () => {
  const built = '<!doctype html>\n<html>\n<head>\n<title>Gem Rush</title>\n<script>window.GAME_BUILD="b1"</script>\n<script type="module" src="./assets/main.js"></script>\n</head>\n<body></body>\n</html>\n';
  const net = '<script>window.HOMIE_NET={"v":1,"url":"ws://127.0.0.1:8787/gem-rush/__net?room=main"}</script>';
  const withNet = built.replace('<head>', `<head>${net}`);
  // The build's page as served by any studio (HOMIE_NET only), and with a studio's own additions anywhere in it.
  assert.deepEqual(gamePageCheck(built, built), { same: true, added: [], why: null });
  const a = gamePageCheck(built, withNet);
  assert.equal(a.same, true, a.why);
  assert.deepEqual(a.added.map((x) => x.kind), ['homie-net']);
  const b = gamePageCheck(built, withNet.replace(net, `${net}${SHIM}`));
  assert.equal(b.same, true, b.why);
  assert.deepEqual(b.added.map((x) => x.kind), ['homie-net', 'inline']);
  assert.match(b.added[1].starts, /^\(function\(\)\{try\{var real=window\.fetch/);
  const c = gamePageCheck(built, withNet.replace('</body>', '\n<script src="/__studio/beacon.js" defer></script>\n</body>'));
  assert.equal(c.same, true, c.why);
  assert.deepEqual(c.added.map((x) => [x.kind, x.src ?? null]), [['homie-net', null], ['src', '/__studio/beacon.js']]);
  assert.ok(sameAdditions(a.added, gamePageCheck(built, withNet).added));
  assert.ok(!sameAdditions(a.added, b.added));
  // HOMIE_NET's words follow the game's game.json (a change may give it `movement`): the same site all the same.
  const net2 = net.replace('"v":1,', '"v":1,"movement":"free",');
  const moved = gamePageCheck(built, built.replace('<head>', `<head>${net2}${SHIM}`));
  assert.equal(moved.same, true, moved.why);
  assert.ok(sameAdditions(b.added, moved.added) && moved.added[0].sha256 !== b.added[0].sha256);
  // A different build: another bundle, a changed inline script, a script gone, changed markup. Each is refused.
  const stale = gamePageCheck(built, withNet.replace('./assets/main.js', './assets/main-0ld.js'));
  assert.equal(stale.same, false);
  assert.match(stale.why, /lacks the build's script \.\/assets\/main\.js \(1 of the build's 2 scripts there\)/);
  const inline = gamePageCheck(built, withNet.replace('"b1"', '"b0"'));
  assert.equal(inline.same, false);
  assert.match(inline.why, /lacks the build's script "window\.GAME_BUILD="b1"…"/);
  assert.equal(gamePageCheck(built, withNet.replace('<script>window.GAME_BUILD="b1"</script>\n', '')).same, false);
  const markup = gamePageCheck(built, withNet.replace('<title>Gem Rush</title>', '<title>Gem Rush (old)</title>').replace(net, `${net}${SHIM}`));
  assert.equal(markup.same, false);
  assert.match(markup.why, /markup differs from the build's at character \d+: served ".*Gem Rush \(old\).*", built ".*Gem Rush<\/title>/);
  // Scripts in another order are another page.
  const swapped = built.replace('<script>window.GAME_BUILD="b1"</script>\n<script type="module" src="./assets/main.js"></script>', '<script type="module" src="./assets/main.js"></script>\n<script>window.GAME_BUILD="b1"</script>');
  assert.equal(gamePageCheck(built, swapped).same, false);
});

test('what BASELINE.md says about the download: three.js minified is minified (its shaders said apart), three.js plain is not', { skip: !existsSync(join(THREE_BUILD, 'three.module.min.js')) && 'node_modules has no three' }, () => {
  const root = join(scratch, 'downloads');
  const dist = join(root, 'site', 'dist', 'games', 'sky-race');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'build'), { recursive: true });
  mkdirSync(join(root, 'games', 'sky-race'), { recursive: true });
  writeFileSync(join(root, 'games', 'sky-race', 'game.json'), '{"id":"sky-race"}\n');
  // A game's bundle (named as a bundler names it, so the name says nothing) that is minified three.js with its shaders.
  writeFileSync(join(dist, 'assets', 'index-a1b2.js'), readFileSync(join(THREE_BUILD, 'three.module.min.js')));
  writeFileSync(join(dist, 'build', 'three.core.js'), readFileSync(join(THREE_BUILD, 'three.core.js')));
  const sizes = perfSizes(root, 'sky-race');
  const min = sizes.biggest.find((f) => f.path === 'assets/index-a1b2.js');
  // What 0.20.0 said of it: "looks unminified (it compresses like source text)" (over 200 KB, gzip over 17%).
  assert.ok(min.bytes > 200 * 1024 && min.gzip / min.bytes > 0.17);
  const h = sizeHints(sizes);
  const said = h.join('\n');
  assert.doesNotMatch(said, /assets\/index-a1b2\.js[^\n]*(looks unminified|is not minified)/);
  assert.match(said, /assets\/index-a1b2\.js \(\d+ KB, \d+ KB gzipped\) is minified already \([\d.]+% whitespace in its code, names shortened\): minifying it again gains nothing\. \d+(\.\d)?% of its bytes are GLSL shader source in strings[^:]*: normal for three\.js/);
  assert.match(said, /build\/three\.core\.js \(\d+ KB\) is not minified: [\d.]+% of its code is whitespace and [\d.]+% of the file comments/);
  assert.match(said, /a player downloads \d+ KB of JavaScript \(gzipped\) before playing: .*Ship the unminified scripts below minified/);
  // With the plain file gone, every script is minified: the download hint no longer says to minify.
  rmSync(join(dist, 'build'), { recursive: true });
  const only = sizeHints(perfSizes(root, 'sky-race')).join('\n');
  assert.doesNotMatch(only, /[Ss]hip (the unminified scripts below )?minified|not minified/);
  // A studio before 0.19.1 (no `code`) gets no claim about minifying at all.
  const old = perfSizes(root, 'sky-race');
  for (const f of old.biggest) delete f.code;
  assert.doesNotMatch(sizeHints(old).join('\n'), /minif/i);
});
