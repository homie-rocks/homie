/**
 * The Game Lab (lib/lab.mjs, lib/lab-check.mjs, lab/): the take format; the lab's server (New from the working tree,
 * Today from git's checkout of a commit with only the game's files, the harness first in the game's page, writes
 * only from the lab page itself, tunables written back one a line); `lab set` and `lab --stop`; `game new` keeping a
 * take's saves; and, in a real Chrome when this machine has one, the harness's clock, dice, timers and presses
 * replaying a take frame for frame, a game that reads crypto dice caught replaying differently, and both starters'
 * takes replaying the same in New and Today.
 * Run: node --test packages/studio/test/lab.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkTake, expandTake, formatLabFile, formatTunables, framesOf, inputsFromRecording, readLabFile, setTunables } from '../lab/take.js';
import { labSet, labStop, startLabServer, withHarness } from '../lib/lab.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { keyFrames, firstDifference } from '../lib/lab-check.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-lab-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' }, timeout: 240_000 });
const WHO = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: '' };
const git = (cwd, ...args) => { const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...WHO } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

/** A studio with both starters, its node_modules pointing at this package and the repo's esbuild, committed once. */
function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Lab Test', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  for (const id of ['gem-rush', 'ember-vale']) assert.equal(run(['game', 'new', id, '--from', id], dir).status, 0);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'two games');
  return dir;
}

/* ------------------------------------------------------------------ takes */

test('a take: checked in words, expanded to timed presses, read back from a recording, written one input a line', () => {
  assert.deepEqual(checkTake({ seconds: 2, inputs: [{ at: 0.5, key: 'Space' }] }), []);
  const bad = checkTake({ seconds: 99, fps: 50, device: 'tv', stage: 'Not ok', inputs: [{ at: -1, key: 'Space' }, { at: 1, key: 'Space', down: 'KeyA' }, { at: 1, pointer: 'drag', x: 1, y: 2 }] });
  for (const word of ['seconds', 'fps', 'device', 'stage', 'inputs[0].at', 'exactly one', 'pointer is down']) assert.ok(bad.some((p) => p.includes(word)), `says ${word}: ${bad.join('; ')}`);

  const t = expandTake({ seconds: 2, fps: 30, seed: 7, stage: 'dummy', inputs: [{ at: 0.5, key: 'Space', hold: 0.2 }, { at: 0.1, down: 'ArrowRight' }, { at: 0.4, up: 'ArrowRight' }, { at: 1, pointer: 'down', x: 10, y: 20 }] });
  assert.equal(t.fps, 30); assert.equal(t.frames, 60); assert.equal(t.seed, 7); assert.equal(t.stage, 'dummy');
  assert.deepEqual(t.inputs.map((e) => [Math.round(e.at), e.type, e.code ?? e.ev, e.down ?? null]), [[100, 'key', 'ArrowRight', true], [400, 'key', 'ArrowRight', false], [500, 'key', 'Space', true], [700, 'key', 'Space', false], [1000, 'pointer', 'down', null]]);
  assert.equal(expandTake({ seconds: 1, inputs: [{ at: 0, key: 'Space' }] }, { fps: 12 }).inputs[1].at, 1000 / 12, 'a tap lasts a frame at least');
  assert.equal(framesOf({ seconds: 2.2 }, 60), 132);

  const rows = inputsFromRecording([{ at: 516.667, type: 'key', code: 'Space', down: true }, { at: 600, type: 'pointer', ev: 'move', x: 1, y: 2, id: 1, pt: 'touch' }, { at: 616.667, type: 'key', code: 'Space', down: false }, { at: 700, type: 'key', code: 'KeyW', down: true }]);
  assert.deepEqual(rows, [{ at: 0.5167, key: 'Space', hold: 0.1 }, { at: 0.6, pointer: 'move', x: 1, y: 2, id: 1, pt: 'touch' }, { at: 0.7, down: 'KeyW' }]);

  const file = { v: 1, default: 'a', takes: { a: { note: 'x', seconds: 1, inputs: rows }, b: { seconds: 2, inputs: [] } } };
  const text = formatLabFile(file);
  assert.deepEqual(JSON.parse(text), file);
  assert.equal(text.split('\n').filter((l) => l.includes('"at"')).length, 3, 'one input a line');
  const read = readLabFile({ v: 1, default: 'nope', takes: { good: { seconds: 1 }, 'Bad Name': { seconds: 1 }, worse: { seconds: 0 } } });
  assert.deepEqual(Object.keys(read.takes), ['good']);
  assert.equal(read.default, 'good');
  assert.equal(read.problems.length, 2);
});

test('tunables: one a line, a kept value outside its range moves the range, unknown names and non-numbers refused', () => {
  const spec = { speed: { value: 950, min: 200, max: 2000, unit: 'px/s', note: 'How "fast", in px' }, bare: 3 };
  const text = formatTunables(spec);
  assert.deepEqual(JSON.parse(text), spec);
  assert.equal(text.trim().split('\n').length, 4);
  const r = setTunables(spec, { speed: '2400', bare: 4 });
  assert.equal(r.spec.speed.value, 2400); assert.equal(r.spec.speed.max, 2400); assert.equal(r.spec.bare, 4);
  assert.deepEqual(r.changed.map((c) => [c.name, c.from, c.to]), [['speed', 950, 2400], ['bare', 3, 4]]);
  assert.equal(spec.speed.value, 950, 'the spec given is not changed');
  assert.equal(setTunables(spec, { nope: 1, speed: 'fast' }).refused.length, 2);
});

test('the harness goes first in a game page, before any of its scripts', () => {
  const page = withHarness('<!doctype html><html><head><meta charset="utf-8"><script src="./a.js"></script></head></html>');
  assert.match(page, /<head>\n<script src="\/_lab\/harness\.js"><\/script>/);
  assert.ok(page.indexOf('/_lab/harness.js') < page.indexOf('./a.js'));
  assert.match(withHarness('<html><body>x</body></html>'), /<html>\n<head><script src="\/_lab\/harness\.js"><\/script><\/head>/);
  assert.ok(withHarness('<canvas></canvas>').startsWith('<script src="/_lab/harness.js"></script>'));
  assert.deepEqual(keyFrames([{ from: 10, to: 20 }, { from: 21, to: 40 }], [{ from: 11, to: 30 }], 120, 4).length, 4);
  assert.equal(firstDifference([{ sig: 'a' }, { sig: 'b' }], [{ sig: 'a' }, { sig: 'c' }]), 2);
  assert.equal(firstDifference([{ sig: 'a' }], [{ sig: 'a' }]), null);
});

/* ------------------------------------------------------------------ the server */

test('the server: New and Today built, the checkout holds only the game, writes only from the lab page, stop cleans up', async () => {
  const dir = studio('server');
  const s = await startLabServer(dir, { port: 0, watchFiles: false });
  try {
    const st = await (await fetch(`${s.url}/_lab/api/gem-rush/state`)).json();
    assert.equal(st.new.ok, true, st.new.error);
    assert.equal(st.today.ok, true, st.today.error ?? st.today.none);
    assert.equal(st.today.commit.subject, 'two games');
    assert.equal(st.new.dirty, 0, 'New is Today: nothing changed since the commit');
    assert.equal(st.takes.default, 'knock');
    assert.ok(st.tunables.spec['public.knockRange'], 'the starter has tunables');
    assert.equal(st.tunables.today['public.knockRange'], st.tunables.spec['public.knockRange'].value);
    // git's own checkout of the commit, with the game and nothing else of the studio.
    const co = join(dir, '.studio', 'lab', 'gem-rush', 'checkout');
    assert.ok(existsSync(join(co, 'games', 'gem-rush', 'src', 'view.ts')));
    assert.ok(!existsSync(join(co, 'games', 'ember-vale')), 'only the game Today is built from');
    assert.match(spawnSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).stdout, /checkout/);

    const page = await (await fetch(`${s.url}/gem-rush/new/`)).text();
    assert.ok(page.indexOf('/_lab/harness.js') < page.indexOf('assets/main.js'), 'the harness before the game');
    assert.ok(page.indexOf('/_lab/harness.js') > -1);
    assert.equal((await fetch(`${s.url}/gem-rush/today/`)).status, 200);
    assert.equal((await fetch(`${s.url}/_lab/harness.js`)).status, 200);
    assert.equal((await fetch(`${s.url}/gem-rush/`)).headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal((await fetch(`${s.url}/gem-rush/new/%2e%2e/%2e%2e/studio.json`)).status, 404);
    assert.equal((await fetch(`${s.url}/no-such-game/`)).status, 404);

    // Writes: only the lab page (its own origin, JSON).
    const post = (path, body, headers) => fetch(`${s.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/_lab/api/gem-rush/tunables', { values: { 'public.knockRange': 2.4 } }, {})).status, 403, 'no Origin: refused');
    assert.equal((await post('/_lab/api/gem-rush/tunables', { values: { 'public.knockRange': 2.4 } }, { origin: 'https://evil.example' })).status, 403);
    const kept = await (await post('/_lab/api/gem-rush/tunables', { values: { 'public.knockRange': 2.4 } }, { origin: s.url })).json();
    assert.equal(kept.ok, true, kept.why);
    const file = readFileSync(join(dir, 'games', 'gem-rush', 'tunables.json'), 'utf8');
    assert.equal(JSON.parse(file).public.knockRange.value, 2.4);
    assert.match(file, /"knockRange":\s*\{\s*"value":\s*2\.4,/, 'public movement tunable kept');
    assert.equal((await (await fetch(`${s.url}/_lab/api/gem-rush/state`)).json()).new.dirty, 1, 'New differs from Today now');
    const take = await (await post('/_lab/api/gem-rush/take', { name: 'mine', take: { seconds: 1.5, inputs: [{ at: 0.2, key: 'Space', hold: 0.1 }] } }, { origin: s.url })).json();
    assert.equal(take.ok, true, take.why);
    const lab = JSON.parse(readFileSync(join(dir, 'games', 'gem-rush', 'lab.json'), 'utf8'));
    assert.ok(lab.takes.knock && lab.takes.mine, 'the starter\'s take kept, the new one added');
    assert.equal((await post('/_lab/api/gem-rush/take', { name: 'Bad', take: { seconds: 1 } }, { origin: s.url })).status, 400);

    // A game not in the commit has no Today, and says why.
    assert.equal(run(['game', 'new', 'fresh', '--from', 'gem-rush'], dir).status, 0);
    const fresh = await (await fetch(`${s.url}/_lab/api/fresh/state`)).json();
    assert.equal(fresh.new.ok, true);
    assert.equal(fresh.today.ok, false);
    assert.match(fresh.today.none, /not in .* yet: commit it/);

    // A commit moves Today: the next look at the state builds the new commit (and New is Today again).
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'kept a wider reach');
    const after = await (await fetch(`${s.url}/_lab/api/gem-rush/state`)).json();
    assert.equal(after.today.commit.subject, 'kept a wider reach');
    assert.equal(after.tunables.today['public.knockRange'], 2.4, 'Today\'s tunables are the new commit\'s');
    assert.equal(after.new.dirty, 0);
  } finally { await s.close(); }
  const stop = await labStop(dir);
  assert.ok(stop.removed.includes('.studio/lab/gem-rush/checkout'));
  assert.ok(!existsSync(join(dir, '.studio', 'lab', 'gem-rush', 'checkout')));
  assert.doesNotMatch(spawnSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).stdout, /checkout/, 'git forgot it');
  assert.equal(git(dir, 'status', '--porcelain', '--', '.studio'), '', '.studio is the studio\'s own, git-ignored');

  const set = labSet(dir, 'gem-rush', ['public.knockRange=1.98', 'public.ringMs=800']);
  assert.equal(set.ok, true, set.why);
  assert.equal(JSON.parse(readFileSync(join(dir, 'games', 'gem-rush', 'tunables.json'), 'utf8')).public.ringMs.value, 800);
  assert.equal(labSet(dir, 'gem-rush', ['nope=1']).ok, false);
  assert.equal(labSet(dir, 'gem-rush', ['knockRange']).ok, false);
});

test('game new copies the lab files and renames a take\'s saves to the new id', () => {
  const dir = join(scratch, 'copy');
  assert.equal(run(['new', dir, '--name', 'Copy', '--homie', 'https://homie.test', '--no-install'], scratch).status, 0);
  assert.equal(run(['game', 'new', 'my-vale', '--from', 'ember-vale'], dir).status, 0);
  const lab = readFileSync(join(dir, 'games', 'my-vale', 'lab.json'), 'utf8');
  assert.match(lab, /"homie-saves\.local\.my-vale"/);
  assert.doesNotMatch(lab, /homie-saves\.local\.ember-vale/);
  assert.ok(existsSync(join(dir, 'games', 'my-vale', 'tunables.json')));
});

/* ------------------------------------------------------------------ in a real browser */

const chrome = findChrome();
const FIXTURE = (dice) => `import { lab } from '@homie-rocks/studio/lab';
import tuning from '../tunables.json';
const T = lab.tunables(tuning);
let fired = 0; setTimeout(() => { fired = performance.now(); }, 100);
let ticks = 0; setInterval(() => { ticks += 1; }, 50);
let keys = 0; let held = 0;
addEventListener('keydown', (e) => { if (e.code === 'Space') keys += 1; if (e.code === 'ArrowRight') held = 1; });
addEventListener('keyup', (e) => { if (e.code === 'ArrowRight') held = 0; });
lab.overlay('mark', () => {});
lab.camera({ game: null, close: { zoom: 2 } });
const c = document.getElementById('c') as HTMLCanvasElement; const g = c.getContext('2d') as CanvasRenderingContext2D;
let x = 0;
function frame(t: number): void {
  const dt = lab.time.dt(t, 0.1);
  x += T.speed * dt * (held ? 2 : 1);
  lab.track('x', x, 'px'); lab.track('t', t, 'ms'); lab.track('date', Date.now() - Date.UTC(2026, 0, 1), 'ms');
  lab.track('dice', Math.floor(Math.random() * 1000)); lab.track('fired', fired); lab.track('ticks', ticks); lab.track('keys', keys);
  lab.track('stage', lab.stage === 'dummy' ? 1 : 0);
  ${dice ? "lab.track('crypto', crypto.getRandomValues(new Uint32Array(1))[0] as number);" : ''}
  lab.phase(keys ? 'PRESSED' : 'WAIT', keys ? 'after the press' : 'before it');
  g.fillStyle = '#123'; g.fillRect(0, 0, 40, 40);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;
function fixture(dir, id, dice) {
  const g = join(dir, 'games', id);
  mkdirSync(join(g, 'src'), { recursive: true });
  writeFileSync(join(g, 'game.json'), JSON.stringify({ id, name: id, entry: 'src/main.ts' }));
  writeFileSync(join(g, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="c" width="80" height="80"></canvas><script type="module" src="./assets/main.js"></script></body></html>');
  writeFileSync(join(g, 'tunables.json'), formatTunables({ speed: { value: 120, min: 0, max: 400 } }));
  writeFileSync(join(g, 'src', 'main.ts'), FIXTURE(dice));
  writeFileSync(join(g, 'lab.json'), formatLabFile({ v: 1, default: 'go', takes: { go: { seconds: 1, seed: 3, stage: 'dummy', inputs: [{ at: 0.5, key: 'Space' }, { at: 0.2, key: 'ArrowRight', hold: 0.25 }] } } }));
}

test('in Chrome: the lab\'s clock, timers, dice and presses replay a take frame for frame, at 60 and at 30 fps', { skip: !chrome && 'no Chrome on this machine', timeout: 240_000 }, () => {
  const dir = studio('browser');
  fixture(dir, 'clock', false);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'clock');
  for (const fps of [60, 30]) {
    const out = join(scratch, `clock-${fps}`);
    const r = run(['lab', 'check', 'clock', '--fps', String(fps), '--out', out], dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const sum = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    const n = sum.new.tracks;
    const step = 1000 / fps;
    assert.equal(sum.frames, fps, 'one second of frames');
    assert.deepEqual(sum.deterministic, { new: null, today: null }, 'both builds replay the same');
    assert.equal(n.t.final, Math.round(fps * step * 100) / 100, 'frame f is at f / fps seconds');
    assert.equal(n.date.final, n.t.final, 'Date.now() runs on the same clock from a fixed day');
    assert.equal(n.fired.final, 100, 'a 100 ms timeout fires at 100 ms on the lab\'s clock');
    assert.equal(n.ticks.final, Math.floor(n.t.final / 50), 'a 50 ms interval');
    assert.equal(n.keys.final, 1, 'the take\'s press reached the game once');
    assert.equal(n.stage.final, 1, 'lab.stage is the take\'s');
    // speed 120/s for (frames - 1) steps (the first dt is 0), doubled while ArrowRight was held (0.2 s to 0.45 s).
    const heldFrames = Math.round(0.45 * fps) - Math.round(0.2 * fps);
    assert.ok(Math.abs(n.x.final - 120 * ((fps - 1) / fps + heldFrames / fps)) < 120 / fps + 0.01, `x ${n.x.final}`);
    assert.equal(sum.today.tracks.dice.final, n.dice.final, 'the same dice in both builds');
    assert.deepEqual(sum.new.phases.map((p) => p.name), ['WAIT', 'PRESSED']);
    assert.equal(sum.new.phases[1].from, Math.round(0.5 * fps) + 0, 'pressed on the frame the take says');
    for (const f of ['REPORT.md', 'sheet.png', 'still.jpg', 'page.jpg']) assert.ok(existsSync(join(out, f)), f);
  }
});

test('in Chrome: a game that rolls crypto dice is caught replaying differently, and both starters replay the same', { skip: !chrome && 'no Chrome on this machine', timeout: 300_000 }, () => {
  const dir = studio('starters');
  fixture(dir, 'dice', true);
  const r = run(['lab', 'check', 'dice', '--out', join(scratch, 'dice')], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(typeof d.deterministic.new, 'number', 'the lab says where the replay differed');
  for (const game of ['gem-rush', 'ember-vale']) {
    const g = run(['lab', 'check', game, '--out', join(scratch, game)], dir);
    assert.equal(g.status, 0, g.stdout + g.stderr);
    const res = JSON.parse(g.stdout);
    assert.deepEqual(res.deterministic, { new: null, today: null }, `${game} replays the same`);
    assert.ok(res.phases.new.length >= 2, `${game} names its phases: ${res.phases.new.join(', ')}`);
    assert.deepEqual(res.phases.new, res.phases.today, `${game}: New is Today`);
    assert.deepEqual(res.errors, []);
  }
});
