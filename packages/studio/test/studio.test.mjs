/**
 * @homie-rocks/studio: the scaffold touches only a new or empty folder and lists
 * what it writes; a game from a starter builds into the site; the Lobby puts
 * strangers in the same room; deploy never touches a Cloudflare resource the
 * studio did not create (a stand-in wrangler plays the account).
 * Run: node --test packages/studio/test/studio.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const out = (r) => JSON.parse(r.stdout);

/** A studio whose node_modules point at this package and the repo's esbuild (what npm install gives it). */
function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Test Studio', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

test('new: a studio monorepo in a new folder, every file listed; a non-empty folder is refused untouched', () => {
  const dir = join(scratch, 'fresh');
  const made = out(run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch));
  assert.equal(made.ok, true);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'studio.json', 'package.json', 'site/wrangler.jsonc', 'site/src/worker.mjs', 'site/migrations/0001_studio.sql', 'games/README.md', 'music/manifest.json', 'videos/manifest.json', 'posts/README.md', '.claude/skills/.gitkeep']) {
    assert.ok(made.wrote.includes(f), `lists ${f}`);
    assert.ok(existsSync(join(dir, f)), `wrote ${f}`);
  }
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m, 'CLAUDE.md imports AGENTS.md');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.devDependencies['@homie-rocks/studio'], /^https:\/\/homie\.test\/npm\/homie-studio-\d+\.\d+\.\d+\.tgz$/, 'pinned to one tarball');
  assert.match(pkg.devDependencies.wrangler, /^\d+\.\d+\.\d+$/, 'wrangler pinned exactly');
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.deepEqual([s.slug, s.cloudflare.worker, s.cloudflare.d1, s.cloudflare.r2], ['night-owls', 'night-owls', 'night-owls-db', 'night-owls-media']);
  const busy = join(scratch, 'busy');
  mkdirSync(busy);
  writeFileSync(join(busy, 'notes.txt'), 'mine');
  const refused = out(run(['new', busy, '--name', 'X', '--no-install'], scratch));
  assert.equal(refused.ok, false);
  assert.match(refused.why, /not empty/);
  assert.deepEqual(spawnSync('ls', ['-A', busy], { encoding: 'utf8' }).stdout.trim().split('\n'), ['notes.txt']);
  assert.equal(out(run(['new'], scratch)).ok, false, 'no folder, no studio');
});

test('game new + build: the starter becomes this studio\'s game, bundled with netplay, with its source shared', () => {
  const dir = studio('builds');
  const g = out(run(['game', 'new', 'crown-thief', '--from', 'gem-rush', '--name', 'Crown Thief'], dir));
  assert.equal(g.ok, true);
  const meta = JSON.parse(readFileSync(join(dir, 'games/crown-thief/game.json'), 'utf8'));
  assert.equal(meta.id, 'crown-thief');
  assert.equal(meta.name, 'Crown Thief');
  assert.match(readFileSync(join(dir, 'games/crown-thief/src/main.ts'), 'utf8'), /game: 'crown-thief'/);
  assert.equal(out(run(['game', 'new', 'api'], dir)).ok, false, 'a reserved id is refused');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  const dist = join(dir, 'site/dist');
  const cat = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8'));
  assert.deepEqual(cat.games.map((x) => x.id), ['crown-thief']);
  const js = readFileSync(join(dist, 'games/crown-thief/assets/main.js'), 'utf8');
  assert.match(js, /homie-net/, 'the netplay helper is in the bundle');
  const src = JSON.parse(readFileSync(join(dist, 'games/crown-thief/source.json'), 'utf8'));
  assert.equal(src.kind, 'homie-game-source');
  assert.ok(src.files['game.json'] && src.files['src/main.ts']);
});

test('the Lobby: two strangers pressing Play together land in the same room; a full room opens the next', async () => {
  const { Lobby } = await import('../worker/index.mjs'); // workerd-only globals are touched at request time, not import
  const store = new Map();
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, blockConcurrencyWhile: async (fn) => fn() };
  const lobby = new Lobby(ctx);
  await new Promise((r) => setTimeout(r, 0));
  const join2 = async (max = 3) => (await (await lobby.fetch(new Request(`https://lobby/join?max=${max}`, { method: 'POST' }))).json()).room;
  const a = await join2(); const b = await join2();
  assert.equal(a, b, 'two arrivals before either connects share a room');
  await lobby.fetch(new Request('https://lobby/report', { method: 'POST', body: JSON.stringify({ room: a, players: 2 }) }));
  assert.equal(await join2(), a, 'a room with a free seat is filled first');
  await lobby.fetch(new Request('https://lobby/report', { method: 'POST', body: JSON.stringify({ room: a, players: 3 }) }));
  assert.notEqual(await join2(), a, 'a full room sends the next visitor to a new one');
});

test('deploy: never a Worker, database or bucket this studio did not create; not signed in asks for one browser approval', () => {
  const dir = studio('deploys');
  out(run(['game', 'new', 'crown-thief'], dir));
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const fake = (script) => { writeFileSync(join(bin, 'wrangler'), `#!/bin/sh\n${script}\n`); chmodSync(join(bin, 'wrangler'), 0o755); };
  fake('case "$1" in whoami) exit 1;; esac; exit 0');
  const signedOut = out(run(['deploy'], dir));
  assert.equal(signedOut.needs, 'cloudflare-login');
  assert.match(signedOut.why, /npx wrangler login/);
  // Signed in, and a Worker of the studio's name already exists on the account.
  fake(`case "$1" in
    whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
    versions) echo '[{"id":"v1"}]'; exit 0;;
    *) echo "unexpected: $*" >&2; exit 9;;
  esac`);
  const worker = out(run(['deploy'], dir));
  assert.equal(worker.ok, false);
  assert.match(worker.why, /already exists on this Cloudflare account and this studio did not create it/);
  // No Worker, but a D1 database of that name that someone else made.
  fake(`case "$1" in
    whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
    versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
    d1) echo '[{"uuid":"11111111-1111-1111-1111-111111111111","name":"test-studio-db"}]';;
    *) echo "unexpected: $*" >&2; exit 9;;
  esac`);
  const db = out(run(['deploy'], dir));
  assert.equal(db.ok, false);
  assert.match(db.why, /D1 database named "test-studio-db" already exists/);
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.deepEqual(s.cloudflare.created, [], 'nothing recorded as created');
});

test('deploy resumes after a cut: a resource it created is recorded the moment it exists', () => {
  const dir = studio('resumes');
  out(run(['game', 'new', 'crown-thief'], dir));
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const state = join(dir, '.fake-cf');
  mkdirSync(state, { recursive: true });
  // A stand-in account: D1 create works, then the login "expires" before migrations.
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
S=${state}
case "$1" in
  whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
  versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
  d1) case "$2" in
        list) if [ -f $S/db ]; then echo '[{"uuid":"22222222-2222-2222-2222-222222222222","name":"test-studio-db"}]'; else echo '[]'; fi;;
        create) touch $S/db; echo '"database_id": "22222222-2222-2222-2222-222222222222"';;
        migrations) if [ -f $S/expired ]; then echo 'Not logged in. Your auth token has expired' >&2; exit 1; fi; echo ok;;
        execute) echo ok;;
      esac;;
  r2) case "$3" in list) echo '';; create) exit 0;; esac;;
  deploy) echo 'Deployed test-studio triggers https://test-studio.acct.workers.dev';;
  *) echo "unexpected: $*" >&2; exit 9;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  writeFileSync(join(state, 'expired'), '');
  const cut = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(cut.ok, false);
  const after = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.ok(after.cloudflare.created.includes('d1:test-studio-db'), 'the database it made is recorded even though the deploy stopped');
  rmSync(join(state, 'expired'));
  const resumed = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.url, 'https://test-studio.acct.workers.dev');
});

test('port: plan grades a single-player game and reads its risks; import brings it in as a static game with the toolkit first; build ships homie-port.js', () => {
  const fixture = join(PKG, 'test', 'fixtures', 'coin-dash');
  const plan = out(run(['port', 'plan', fixture], scratch));
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.grade, 'easy');
  assert.deepEqual(plan.recommend, { movement: 'owner', view: 'top', build: 'static' });
  assert.equal(plan.licence.kind, 'Apache-2.0');
  assert.ok(plan.risks.some((r) => /localStorage/.test(r)), 'storage in a sandboxed frame is named');
  assert.ok(plan.risks.some((r) => /keyboard only/.test(r)), 'keyboard-only is named');
  const dir = studio('ports');
  const imp = out(run(['port', 'import', fixture, '--id', 'coin-dash'], dir));
  assert.equal(imp.ok, true, JSON.stringify(imp));
  const meta = JSON.parse(readFileSync(join(dir, 'games/coin-dash/game.json'), 'utf8'));
  assert.deepEqual([meta.build.mode, meta.netplay.movement, meta.port.licence], ['static', 'owner', 'Apache-2.0']);
  const html = readFileSync(join(dir, 'games/coin-dash/index.html'), 'utf8');
  assert.ok(html.indexOf('homie-port.js') > 0 && html.indexOf('homie-port.js') < html.indexOf('game.js'), 'the toolkit loads before the game');
  assert.match(html, /user-scalable=no/, 'a phone-safe viewport');
  assert.ok(existsSync(join(dir, 'games/coin-dash/LICENSE')), 'the licence travels with the game');
  assert.equal(out(run(['port', 'import', fixture, '--id', 'coin-dash'], dir)).ok, false, 'an existing id is refused');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  const port = readFileSync(join(dir, 'site/dist/games/coin-dash/homie-port.js'), 'utf8');
  assert.match(port, /HomiePort/, 'the toolkit as one classic script');
  assert.ok(existsSync(join(dir, 'site/dist/games/coin-dash/game.js')), 'the game\'s own files are served as they are');
  assert.ok(!existsSync(join(dir, 'site/dist/games/coin-dash/game.json')), 'game.json is not served');
});

test('port check judges motion on screen axes: a straight hold passes, a camera that turns or a curve fails, a wall is contact', async () => {
  const { judgeHold, judgePresses } = await import('../lib/port-check.mjs');
  const flat = (t, x, y) => [t, x, y, 1, 0, 0, -1, 0];
  const straight = Array.from({ length: 300 }, (_, i) => flat(i * 16.7, 100, 100 + Math.min(i * 4, 600)));
  const ok = judgeHold(straight, 'down', 0, 5000, 10, 'top');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.ok(ok.contactMs !== null, 'reaching the wall ends the free run');
  const turning = Array.from({ length: 300 }, (_, i) => { const a = i * 0.002; return [i * 16.7, 100, 100 + i * 4, Math.cos(a), Math.sin(a), Math.sin(a), -Math.cos(a), 0]; });
  assert.equal(judgeHold(turning, 'down', 0, 5000, 10, 'top').why, 'the camera turned by itself');
  const curve = Array.from({ length: 300 }, (_, i) => flat(i * 16.7, 100 + (i * i) / 40, 100 + i * 4));
  assert.equal(judgeHold(curve, 'down', 0, 5000, 10, 'top').ok, false);
  const presses = [];
  const rows = [];
  let x = 0; let t = 0;
  for (const [k, dir] of ['left', 'right', 'left', 'right'].entries()) {
    presses.push({ dir, a: t, b: t + 420 });
    for (let f = 0; f < 35; f++) { x += (dir === 'right' ? 4 : -4) * (f > 2 ? 1 : 0); rows.push([t, x, 0, 1, 0, 0, -1, k]); t += 16.7; }
  }
  const alt = judgePresses(rows, presses, 10, 'side');
  assert.equal(alt.ok, true, JSON.stringify(alt));
});

test('port check, maze view: a turn queued behind a wall is not a wrong turn; moving against the press is', async () => {
  const { judgePresses } = await import('../lib/port-check.mjs');
  const flat = (t, x, y) => [t, x, y, 1, 0, 0, -1, 0];
  // Running right along a corridor; "up" is pressed but the wall holds the turn: the body keeps going right.
  const queued = Array.from({ length: 40 }, (_, i) => flat(i * 16.7, i * 4, 0));
  const q = judgePresses(queued, [{ dir: 'up', a: 0, b: 420 }], 10, 'maze');
  assert.equal(q.rows[0].queued, true);
  assert.equal(q.blocked, 1, 'a queued turn counts as blocked, not wrong');
  // Pressing "left" while running right is a reversal: it must answer.
  const ignored = judgePresses(queued, [{ dir: 'left', a: 0, b: 420 }], 10, 'maze');
  assert.equal(ignored.rows[0].ok, false);
  assert.equal(ignored.rows[0].queued, false, 'a reversal that never happens is a failure');
  // The same queued turn in a top view is a wrong-way press.
  assert.equal(judgePresses(queued, [{ dir: 'up', a: 0, b: 420 }], 10, 'top').rows[0].ok, false);
});
