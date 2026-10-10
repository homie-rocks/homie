import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * The progress feed (lib/progress.mjs): a build the person can watch from the Claude app.
 *   - without an open feed, build and deploy are exactly what they were (no .studio/progress at all);
 *   - an open feed takes each stage as the commands run it (plan → build → checks → deploy), the checks, a preview,
 *     money spent against the budget, and ends by itself when a deploy lands with every check green;
 *   - shared with a directory, every write goes there WITHOUT the write key, the key file is the owner's only, and
 *     a Stop pressed there stops the next command before it starts;
 *   - a feed stays inside its bounds (plain text, small pictures, a size cap).
 * Run: node --test packages/studio/test/progress.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Feed, LIMITS, imageData, publicFeed, startProgress } from '../lib/progress.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-progress-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
/** The CLI without blocking this process (a stand-in directory answers from here). */
const runAsync = (args, cwd) => new Promise((done) => {
  const p = spawn(process.execPath, [CLI, ...args, '--json'], { cwd });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => done({ status, stdout, stderr }));
});

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Test Studio', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  browserRulesGame(dir, 'crown-thief', 'Crown Thief');
  return dir;
}

/** A Cloudflare account that deploys (the stand-in Wrangler of studio.test.mjs). */
function account(dir) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
S=${state}
case "$1" in
  whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
  versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
  d1) case "$2" in
        list) if [ -f $S/db ]; then echo '[{"uuid":"22222222-2222-2222-2222-222222222222","name":"test-studio-db"}]'; else echo '[]'; fi;;
        create) touch $S/db; echo '"database_id": "22222222-2222-2222-2222-222222222222"';;
        *) echo ok;;
      esac;;
  deploy) echo 'Deployed test-studio triggers https://test-studio.acct.workers.dev';;
  *) echo "unexpected: $*" >&2; exit 9;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
}

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('no open feed: build and deploy are what they were, and nothing is written under .studio/progress', () => {
  const dir = studio('plain');
  account(dir);
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.command, 'build');
  const d = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.ok(!existsSync(join(dir, '.studio', 'progress')), 'no feed was made');
  assert.equal(out(run(['progress', 'stage', 'plan', 'done'], dir)).ok, false, 'a progress step with no open build says so');
});

test('an open feed takes each stage as it runs, the checks, a preview and the spend, and ends when the deploy lands', () => {
  const dir = studio('feed');
  account(dir);
  const s = out(run(['progress', 'start', 'crown-thief', '--title', 'Crown Thief: faster rounds', '--budget', '2'], dir));
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.deepEqual(s.stages, ['plan', 'build', 'checks', 'deploy']);
  assert.equal(s.shared, null, 'not shared unless asked');
  assert.equal(out(run(['progress', 'start', 'other'], dir)).ok, false, 'one open build at a time');
  const file = join(dir, s.file);
  const feed = () => JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(feed().stages[0].state, 'running', 'the plan runs from the start');

  assert.equal(out(run(['progress', 'stage', 'plan', 'done', '--note', 'Shorter rounds, a louder finale'], dir)).ok, true);
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(feed().stages[1].state, 'done');
  assert.match(feed().stages[1].note, /^Built crown-thief \(\d+ KB\)$/);
  assert.equal(feed().stage, 'build');

  // The AI's own steps: a check it ran itself, a preview picture, money spent.
  const png = join(dir, 'shot.png');
  writeFileSync(png, PNG);
  assert.equal(out(run(['progress', 'check', 'look', 'pass', '--label', 'Looks right on a phone'], dir)).ok, true);
  assert.equal(out(run(['progress', 'preview', '--image', png, '--caption', 'The new finale'], dir)).ok, true);
  const spent = out(run(['progress', 'spend', '0.04', '--what', 'fal cover'], dir));
  assert.equal(spent.message, 'spent $0.04 of $2.00');
  assert.match(feed().preview.image, /^data:image\/png;base64,/);
  assert.equal(feed().checks[0].state, 'pass');
  assert.equal(feed().spend.used, 0.04);
  assert.equal(out(run(['progress', 'check', 'look', 'green'], dir)).ok, false, 'a check state is one of the named ones');

  const d = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(d.ok, true, JSON.stringify(d));
  const f = feed();
  assert.equal(f.stages[3].state, 'done');
  assert.equal(f.stages[2].state, 'skipped', 'checks that never ran say so');
  assert.equal(f.preview.url, 'https://test-studio.acct.workers.dev/crown-thief/play', 'the preview is the live game');
  assert.equal(f.state, 'passed', 'deployed with every check green: done');
  assert.ok(f.endedAt);
  assert.ok(!existsSync(join(dir, '.studio', 'progress', 'current')), 'nothing is open any more');
  const shown = out(run(['progress', 'show', f.build], dir));
  assert.equal(shown.feed.state, 'passed');
  assert.equal(out(run(['progress', 'start', 'crown-thief'], dir)).ok, true, 'the next build can start');
});

test('a failed stage stays in the feed and the build goes on; the AI ends it', () => {
  const dir = studio('fails');
  const s = out(run(['progress', 'start', 'crown-thief'], dir));
  writeFileSync(join(dir, 'games', 'crown-thief', 'src', 'main.ts'), 'export const x: number = ;\n');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, false);
  const f = JSON.parse(readFileSync(join(dir, s.file), 'utf8'));
  assert.equal(f.stages[1].state, 'failed');
  assert.ok(f.error, 'the feed says what went wrong');
  assert.equal(f.state, 'running', 'a failure is not the end: the AI fixes it and builds again');
  assert.equal(out(run(['progress', 'end', 'failed', '--note', 'The build does not compile yet'], dir)).ok, true);
  assert.equal(JSON.parse(readFileSync(join(dir, s.file), 'utf8')).state, 'failed');
});

test('a stop asked in the terminal stops the next stage before it starts, and ends the build', () => {
  const dir = studio('stops');
  const s = out(run(['progress', 'start', 'crown-thief'], dir));
  assert.equal(out(run(['progress', 'stop'], dir)).ok, true);
  const c = out(run(['check', 'crown-thief', '--url', 'http://127.0.0.1:9'], dir));
  assert.equal(c.ok, false);
  assert.equal(c.stopped, true, 'the check never launched a browser');
  const f = JSON.parse(readFileSync(join(dir, s.file), 'utf8'));
  assert.equal(f.state, 'stopped');
  assert.equal(f.stages.find((x) => x.id === 'checks').state, 'stopped');
});

test('shared: the directory gets the feed and never the key; a Stop pressed there stops the next command', async () => {
  const dir = studio('shared');
  const seen = [];
  let stop = false;
  const key = `hbk_${'c'.repeat(48)}`;
  const build = `hb_${'d'.repeat(32)}`;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/studio/progress') return res.end(JSON.stringify({ ok: true, build, key, expiresAt: '2026-10-01T00:00:00Z' }));
      if (req.method === 'PUT' && req.url === `/api/studio/progress/${build}`) return res.end(JSON.stringify({ ok: true, stop }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = JSON.parse((await runAsync(['progress', 'start', 'crown-thief', '--share', '--homie', at, '--budget', '1.5'], dir)).stdout);
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(s.shared.build, build);
    assert.match(s.widget, /build_progress/);
    assert.ok(!JSON.stringify(s).includes(key), 'the key is never printed');
    const keyFile = join(dir, '.studio', 'progress', `${s.build}.key`);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600, 'the key file is the owner\'s only');
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.studio\/$/m, 'and git ignores it');

    const b = await runAsync(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    const puts = seen.filter((x) => x.method === 'PUT');
    assert.ok(puts.length >= 1, 'the build was sent');
    for (const p of puts) {
      assert.equal(p.auth, `Bearer ${key}`);
      assert.ok(!p.body.includes(key), 'the key is never in the feed');
      assert.ok(!p.body.includes(dir), 'no local path is in the feed');
      const doc = JSON.parse(p.body);
      assert.equal(doc.kind, 'homie-studio-progress');
      assert.equal(doc.build, build, 'the directory\'s id');
      assert.equal(doc.shared, undefined);
    }
    assert.equal(JSON.parse(puts.at(-1).body).stages[1].state, 'done', 'the last word is sent before the command exits');

    // The person presses Stop in the Claude app while nothing runs: the next command asks before it starts, and
    // stops without opening a browser.
    stop = true;
    const c = JSON.parse((await runAsync(['check', 'crown-thief', '--url', 'http://127.0.0.1:9'], dir)).stdout);
    assert.equal(c.stopped, true, JSON.stringify(c));
    const f = JSON.parse(readFileSync(join(dir, '.studio', 'progress', `${s.build}.json`), 'utf8'));
    assert.equal(f.state, 'stopped');
    assert.equal(f.stop.by, 'person');
    assert.equal(JSON.parse(seen.filter((x) => x.method === 'PUT').at(-1).body).state, 'stopped', 'the directory saw it end');
  } finally { server.close(); }
});

test('a directory that is not https (and not this computer) is never sent the feed; the build goes on locally', async () => {
  const dir = studio('insecure');
  const s = await startProgress(dir, { id: 'crown-thief', share: true, directory: 'http://homie.example' });
  assert.equal(s.ok, true);
  assert.equal(s.shared, null);
  assert.match(s.sharedWhy, /not https/);
  new Feed(dir, s.build).end('stopped');
});

test('bounds: plain one-line text, small pictures only, and the feed never outgrows its cap', async () => {
  const dir = studio('bounds');
  const s = await startProgress(dir, { id: 'crown-thief', title: `Line one\nline two\u0007${'x'.repeat(400)}` });
  const feed = new Feed(dir, s.build);
  const d = feed.doc;
  assert.ok(!/[\n\u0007]/.test(d.title));
  assert.ok(d.title.length <= LIMITS.title);
  assert.throws(() => imageData('data:text/html;base64,PGgxPg=='), /data:image/);
  const big = join(dir, 'big.jpg');
  writeFileSync(big, Buffer.alloc(LIMITS.image + 1));
  assert.throws(() => imageData(big), /over 96 KB/);
  for (let i = 0; i < 30; i++) feed.check(`c${i}`, 'pass');
  assert.equal(feed.doc.checks.length, LIMITS.checks);
  for (let i = 0; i < 40; i++) feed.log(`line ${i}`);
  assert.equal(feed.doc.log.length, LIMITS.logLines);
  const small = `data:image/jpeg;base64,${Buffer.alloc(LIMITS.shotImage - 200).toString('base64')}`;
  for (let i = 0; i < LIMITS.shots; i++) feed.shot(`s${i}`, 'pass', { image: small });
  assert.ok(readFileSync(join(dir, '.studio', 'progress', `${s.build}.json`), 'utf8').length <= LIMITS.doc, 'the oldest pictures gave way');
  assert.equal(publicFeed({ ...feed.doc, shared: { build: 'hb_x', directory: 'https://homie.test', key: 'nope' } }).shared.key, undefined);
  feed.end('passed');
});
