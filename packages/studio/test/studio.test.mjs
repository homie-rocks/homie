import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * @homie-rocks/studio: the scaffold touches only a new or empty folder and lists
 * what it writes; a game from a starter builds into the site; the Lobby puts
 * strangers in the same room; deploy never touches a Cloudflare resource the
 * studio did not create (a stand-in wrangler plays the account).
 * Run: node --test packages/studio/test/studio.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

// HOMIE_STUDIO_WARM=0: a deploy here never reads its (made-up) live site back.
const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env } });
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
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'studio.json', 'package.json', 'wrangler.jsonc', 'site/src/worker.mjs', 'site/migrations/0001_studio.sql', 'games/README.md', 'music/manifest.json', 'videos/manifest.json', 'posts/README.md', '.claude/skills/.gitkeep']) {
    assert.ok(made.wrote.includes(f), `lists ${f}`);
    assert.ok(existsSync(join(dir, f)), `wrote ${f}`);
  }
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m, 'CLAUDE.md imports AGENTS.md');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.devDependencies['@homie-rocks/studio'], /^\d+\.\d+\.\d+$/, 'pinned to one version, from registry.npmjs.org');
  assert.match(pkg.devDependencies.wrangler, /^\d+\.\d+\.\d+$/, 'wrangler pinned exactly');
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.deepEqual([s.slug, s.cloudflare.worker, s.cloudflare.d1, s.cloudflare.r2], ['night-owls', 'night-owls', 'night-owls-db', null], 'no storage until storage add');
  assert.ok(!existsSync(join(dir, 'site/wrangler.jsonc')), 'the Worker config is at the root, where Workers Builds reads it');
  const wrangler = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
  assert.doesNotMatch(wrangler, /r2_buckets/, 'a new studio binds no R2');
  assert.match(wrangler, /new_sqlite_classes/, 'SQLite-backed Durable Objects (the free plan has no other kind)');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /storage add/, 'AGENTS.md says how storage is added later');
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
  const g = out(run(['game', 'new', 'crown-thief', '--name', 'Crown Thief'], dir));
  assert.equal(g.ok, true);
  const meta = JSON.parse(readFileSync(join(dir, 'games/crown-thief/game.json'), 'utf8'));
  assert.equal(meta.id, 'crown-thief');
  assert.equal(meta.name, 'Crown Thief');
  assert.equal(meta.entry, 'src/view.ts');
  assert.match(readFileSync(join(dir, 'games/crown-thief/src/view.ts'), 'utf8'), /openRoom/);
  assert.equal(out(run(['game', 'new', 'api'], dir)).ok, false, 'a reserved id is refused');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  const dist = join(dir, 'site/dist');
  const cat = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8'));
  assert.deepEqual(cat.games.map((x) => x.id), ['crown-thief']);
  // The bundle is named by its content (bundle.json says which file); assets/main.js still loads it.
  const { bundle } = JSON.parse(readFileSync(join(dist, 'games/crown-thief/bundle.json'), 'utf8'));
  assert.match(bundle, /^assets\/main-[A-Z0-9]{8}\.js$/);
  assert.equal(cat.games[0].room.host, 'server', 'the new Gem Rush runs its rules on the server');
  assert.equal(readFileSync(join(dist, 'games/crown-thief/assets/main.js'), 'utf8'), `import"./${bundle.slice('assets/'.length)}";\n`);
  // No game is handed over whole: its source is not in the build, and neither are its assets' addresses.
  assert.ok(!existsSync(join(dist, 'games/crown-thief/source.json')));
  assert.ok(!existsSync(join(dist, 'games/crown-thief/assets.json')));
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
  browserRulesGame(dir, 'crown-thief');
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
  browserRulesGame(dir, 'crown-thief');
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
  r2) echo "r2 $*" >> $S/r2-calls; exit 9;;
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
  assert.ok(!existsSync(join(state, 'r2-calls')), 'deploy never calls R2');
});

/** A stand-in account with NO R2 (no payment method): every r2 command answers what Cloudflare answers, and is logged. */
function noCardAccount(dir, { r2Enabled = false, buckets = [] } = {}) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
S=${state}
echo "$*" >> $S/calls
case "$1" in
  whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
  versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
  d1) case "$2" in
        list) if [ -f $S/db ]; then echo '[{"uuid":"22222222-2222-2222-2222-222222222222","name":"test-studio-db"}]'; else echo '[]'; fi;;
        create) touch $S/db; echo '"database_id": "22222222-2222-2222-2222-222222222222"';;
        *) echo ok;;
      esac;;
  r2) ${r2Enabled
    ? `case "$3" in list) ${buckets.map((b) => `echo "name:           ${b}"`).join('; ') || 'echo ""'};; create) echo "Created bucket $4"; touch $S/bucket;; esac;;`
    : `echo 'Please enable R2 through the Cloudflare Dashboard. [code: 10042]' >&2; exit 1;;`}
  deploy) echo 'Deployed test-studio triggers https://test-studio.acct.workers.dev';;
  *) echo "unexpected: $*" >&2; exit 9;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  return { calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []) };
}

test('NO CREDIT CARD: a free account without R2 deploys the whole studio, and deploy never asks R2 anything', () => {
  const dir = studio('nocard');
  browserRulesGame(dir, 'crown-thief');
  const account = noCardAccount(dir);
  const plan = out(run(['deploy', '--plan'], dir));
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.deepEqual(account.calls(), [], 'the plan calls nothing');
  assert.deepEqual(plan.cloudflare.map((r) => r.kind), ['Worker', 'D1 database', 'Durable Object', 'Durable Object', 'R2 bucket']);
  assert.equal(plan.cloudflare.at(-1).name, null, 'no R2 bucket in the plan');
  assert.match(plan.cost, /Free/);
  assert.match(plan.cost, /no payment method/);
  assert.match(plan.directory.stores, /Never code, media, keys or accounts/);
  const done = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.r2, null);
  assert.match(done.announced.join(' '), /It creates: the Worker test-studio .* the D1 database test-studio-db \(rounds, and the studio's own stats: counts for the owner, never a visitor's identity\), and the Durable Objects Table and Lobby/);
  assert.match(done.announced.join(' '), /Cost: free, on the Workers Free plan; no payment method, no R2/);
  assert.match(done.announced.join(' '), /will store the site's address/);
  assert.deepEqual(out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir)).announced, [], 'a redeploy creates nothing new and says nothing');
  assert.ok(!account.calls().some((c) => c.startsWith('r2')), `no r2 call: ${account.calls().join(' | ')}`);
  const wrangler = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
  assert.doesNotMatch(wrangler, /r2_buckets/);
  assert.match(wrangler, /22222222-2222-2222-2222-222222222222/, 'the D1 id is filled in');
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.deepEqual(s.cloudflare.created, ['d1:test-studio-db', 'worker:test-studio']);
  const media = out(run(['media', 'put', join(dir, 'README.md')], dir));
  assert.equal(media.needs, 'storage');
  assert.match(media.why, /storage add/);
});

test('the workers.dev address never goes into studio.json (it names the account); a custom domain stays, and claim and publish use it', async () => {
  const { createServer } = await import('node:http');
  const asked = { claim: [], publish: [] };
  const directory = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/studio/claim') { asked.claim.push(u.searchParams.get('site')); res.end(JSON.stringify({ ok: true, claim: 'c'.repeat(40) })); return; }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { asked.publish.push(JSON.parse(body).site); res.end(JSON.stringify({ ok: true, games: [] })); });
  });
  await new Promise((r) => directory.listen(0, '127.0.0.1', r));
  const homie = `http://127.0.0.1:${directory.address().port}`;
  try {
    const dir = studio('address');
    browserRulesGame(dir, 'crown-thief');
    noCardAccount(dir);
    const runAsync = (args) => new Promise((resolve) => {
      const p = spawn(process.execPath, [CLI, ...args, '--json'], { cwd: dir, env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
      let stdout = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.on('close', () => resolve(JSON.parse(stdout)));
    });
    const first = await runAsync(['deploy', '--homie', homie]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual([first.url, first.workersDev, first.local], ['https://test-studio.acct.workers.dev', 'https://test-studio.acct.workers.dev', '.studio/local.json']);
    const committed = readFileSync(join(dir, 'studio.json'), 'utf8');
    assert.doesNotMatch(committed, /workers\.dev/, 'studio.json never names the account');
    assert.equal(JSON.parse(readFileSync(join(dir, '.studio', 'local.json'), 'utf8')).url, 'https://test-studio.acct.workers.dev');
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.studio/local.json'], { cwd: dir }).status, 0, 'git leaves .studio/ out');
    assert.deepEqual(asked.claim, [], 'deploy stores no claim by hand: the live site claims itself when it is first read');
    assert.equal((await runAsync(['publish', '--homie', homie])).ok, true);
    assert.deepEqual(asked.publish, ['https://test-studio.acct.workers.dev']);
    // The studio gets its own domain: it stays in studio.json, deploy never replaces it, claim and publish use it.
    const s = JSON.parse(committed);
    s.cloudflare.domain = 'owls.example';
    writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
    const second = await runAsync(['deploy', '--homie', homie]);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.deepEqual([second.url, second.workersDev], ['https://owls.example', 'https://test-studio.acct.workers.dev']);
    const kept = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
    assert.equal(kept.cloudflare.domain, 'owls.example');
    assert.doesNotMatch(JSON.stringify(kept), /workers\.dev/);
    assert.deepEqual(asked.claim, []);
    assert.equal((await runAsync(['publish', '--homie', homie])).ok, true);
    assert.equal(asked.publish.at(-1), 'https://owls.example');
    // A studio from 0.5.0 committed its workers.dev address as cloudflare.url: the next deploy moves it out.
    const old = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
    delete old.cloudflare.domain;
    old.cloudflare.url = 'https://test-studio.acct.workers.dev';
    writeFileSync(join(dir, 'studio.json'), JSON.stringify(old, null, 2));
    rmSync(join(dir, '.studio'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(dir, '.gitignore'), 'utf8').replace(/^.*\n\.studio\/\n/m, ''));
    assert.notEqual(spawnSync('git', ['check-ignore', '-q', '.studio/local.json'], { cwd: dir }).status, 0);
    const third = await runAsync(['deploy', '--homie', homie]);
    assert.equal(third.ok, true, JSON.stringify(third));
    assert.ok(third.steps.some((x) => /no longer keeps the workers\.dev address/.test(x.what)), 'it says so');
    assert.ok(third.steps.some((x) => /added \.studio\/ to \.gitignore/.test(x.what)));
    assert.doesNotMatch(readFileSync(join(dir, 'studio.json'), 'utf8'), /workers\.dev/);
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.studio/local.json'], { cwd: dir }).status, 0);
    // A custom address written by hand in an older studio.json's `url` is a domain too: never replaced.
    const custom = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
    custom.cloudflare.url = 'https://owls.example';
    writeFileSync(join(dir, 'studio.json'), JSON.stringify(custom, null, 2));
    const fourth = await runAsync(['deploy', '--homie', homie]);
    assert.equal(fourth.url, 'https://owls.example');
    assert.equal(JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8')).cloudflare.url, 'https://owls.example');
  } finally { directory.close(); }
});

test('storage add: refused with the dashboard link on an account without R2 (nothing created); on one with R2 it makes the bucket and deploy binds it', () => {
  const dir = studio('storage');
  browserRulesGame(dir, 'crown-thief');
  noCardAccount(dir);
  assert.equal(out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir)).ok, true);
  const refused = out(run(['storage', 'add'], dir));
  assert.equal(refused.ok, false);
  assert.equal(refused.needs, 'r2-payment-method');
  assert.match(refused.why, /payment method/);
  assert.match(refused.why, /https:\/\/dash\.cloudflare\.com\/acc1\/r2\/overview/);
  let s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(s.cloudflare.r2, null, 'nothing recorded');
  assert.equal(out(run(['storage'], dir)).storage, null);
  // Somebody else's bucket of that name: refused, untouched.
  noCardAccount(dir, { r2Enabled: true, buckets: ['test-studio-media'] });
  assert.match(out(run(['storage', 'add'], dir)).why, /already exists on this account and this studio did not create it/);
  // The person turned R2 on: the bucket is made, recorded, and the next deploy binds it.
  const account = noCardAccount(dir, { r2Enabled: true });
  const added = out(run(['storage', 'add'], dir));
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.bucket, 'test-studio-media');
  s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(s.cloudflare.r2, 'test-studio-media');
  assert.ok(s.cloudflare.created.includes('r2:test-studio-media'));
  assert.match(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), /"bucket_name": "test-studio-media"/);
  const again = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(again.r2, 'test-studio-media');
  assert.ok(account.calls().includes('r2 bucket create test-studio-media'));
});

test('dev --stop stops exactly this studio\'s dev server (Wrangler with it), and nothing else', async () => {
  const dir = studio('devstop');
  browserRulesGame(dir, 'crown-thief');
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  // A stand-in Wrangler: `dev` runs until it is stopped, like the real one.
  writeFileSync(join(bin, 'wrangler'), `#!${process.execPath}\nif (process.argv[2] === 'dev') setInterval(() => {}, 1000);\n`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  // Another project's dev server, running the very same command line a pattern would match.
  const other = spawn(join(bin, 'wrangler'), ['dev', '--local'], { stdio: 'ignore' });
  const devProc = spawn(process.execPath, [CLI, 'dev', '--port', '18989'], { cwd: dir, stdio: 'ignore' });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const file = join(dir, '.wrangler', 'homie-dev.json');
    for (let i = 0; i < 150 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(rec.pid, devProc.pid);
    const stopped = out(run(['dev', '--stop'], dir));
    assert.deepEqual([...stopped.stopped].sort(), [rec.child, rec.pid].sort());
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(alive(rec.child), false, 'Wrangler stopped');
    assert.equal(alive(devProc.pid), false, 'the dev command stopped');
    assert.equal(alive(other.pid), true, 'the other project\'s identical dev server is untouched');
    assert.equal(out(run(['dev', '--stop'], dir)).stopped.length, 0, 'nothing left to stop');
  } finally {
    // A failed assertion must not leave the dev command's own Wrangler running (SIGKILL skips its handlers).
    try { process.kill(JSON.parse(readFileSync(join(dir, '.wrangler', 'homie-dev.json'), 'utf8')).child, 'SIGKILL'); } catch { /* stopped, or never written */ }
    for (const p of [other, devProc]) try { p.kill('SIGKILL'); } catch { /* gone */ }
  }
});

test('a new account\'s first deploy says the next step: verify the email (10034), let the AI register workers.dev', async () => {
  const { explainCloudflare } = await import('../lib/cloudflare.mjs');
  const mail = explainCloudflare('X [ERROR] A request to the Cloudflare API failed. You need to verify your email address to use Workers. [code: 10034]', 'acc1');
  assert.equal(mail.needs, 'cloudflare-verify-email');
  assert.match(mail.why, /AI resumes deployment/);
  assert.doesNotMatch(mail.why, /run `npm/);
  const sub = explainCloudflare('You can either deploy your worker to one or more routes by specifying them in your wrangler.jsonc file, or register a workers.dev subdomain here:\nhttps://dash.cloudflare.com/acc1/workers/onboarding', 'acc1');
  assert.equal(sub.needs, 'workers-dev-subdomain');
  assert.match(sub.why, /dash\.cloudflare\.com\/acc1\/workers\/onboarding/);
  assert.equal(explainCloudflare('some other failure'), null);
  const dir = studio('verify');
  browserRulesGame(dir, 'crown-thief');
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
case "$1" in
  whoami) echo '{"loggedIn":true,"authType":"OAuth Token","accounts":[{"id":"acc1","name":"Test"}]}';;
  versions) echo 'This Worker does not exist on your account. [code: 10007]' >&2; exit 1;;
  d1) case "$2" in list) echo '[]';; create) echo '"database_id": "22222222-2222-2222-2222-222222222222"';; *) echo ok;; esac;;
  deploy) echo 'You need to verify your email address to use Workers. [code: 10034]' >&2; exit 1;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  const r = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(r.ok, false);
  assert.equal(r.needs, 'cloudflare-verify-email');
});

test('port: plan grades a single-player game and reads its risks; import retains the source and licence for a rules rewrite; build refuses the old host', () => {
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
  assert.deepEqual([meta.entry, meta.room.host, meta.port.licence], ['src/view.ts', 'server', 'Apache-2.0']);
  assert.equal(meta.build, undefined); assert.equal(meta.netplay, undefined);
  const html = readFileSync(join(dir, 'games/coin-dash/index.html'), 'utf8');
  assert.ok(html.indexOf('homie-port.js') > 0 && html.indexOf('homie-port.js') < html.indexOf('game.js'), 'the toolkit loads before the game');
  assert.match(html, /user-scalable=no/, 'a phone-safe viewport');
  assert.ok(existsSync(join(dir, 'games/coin-dash/LICENSE')), 'the licence travels with the game');
  assert.equal(out(run(['port', 'import', fixture, '--id', 'coin-dash'], dir)).ok, false, 'an existing id is refused');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, false);
  assert.match(b.why, /games use rules plus view/);

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

/** The studio Worker against a built site folder: ASSETS reads site/dist, MEDIA is an in-memory R2 with ranges. */
async function siteOf(dir, objects = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    },
  };
  const MEDIA = {
    async head(key) { return objects[key] ? { size: objects[key].length } : null; },
    async get(key, opts) {
      const all = objects[key];
      if (!all) return null;
      const body = opts?.range ? all.subarray(opts.range.offset, opts.range.offset + opts.range.length) : all;
      return { body, size: all.length, httpEtag: '"e"', writeHttpMetadata(h) { h.set('content-type', 'audio/mpeg'); } };
    },
  };
  const LOBBY = { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('{"rooms":[]}') }) };
  return (path, init) => worker.fetch(new Request(`https://studio.test${path}`, init), { ASSETS, MEDIA, LOBBY, STUDIO_NAME: 'Test Studio' });
}

test('media: published songs and videos from the manifests get pages, players, byte ranges and directory rows; the rest is listed as left out', async () => {
  const dir = studio('media');
  assert.equal(out(run(['game', 'new', 'music'], dir)).ok, false, 'music is a page address, not a game id');
  mkdirSync(join(dir, 'music/theme'), { recursive: true });
  mkdirSync(join(dir, 'videos/trailer'), { recursive: true });
  writeFileSync(join(dir, 'music/theme/theme.mp3'), Buffer.from('ID3-fake-audio-bytes'));
  writeFileSync(join(dir, 'music/theme/theme-master.wav'), Buffer.from('RIFF-master'));
  writeFileSync(join(dir, 'music/theme/theme-loop.ogg'), Buffer.from('OggS-loop'));
  writeFileSync(join(dir, 'videos/trailer/trailer.mp4'), Buffer.from('ftyp-16x9'));
  writeFileSync(join(dir, 'videos/trailer/trailer-9x16.mp4'), Buffer.from('ftyp-9x16'));
  writeFileSync(join(dir, 'videos/trailer/poster.jpg'), Buffer.from('jpeg'));
  writeFileSync(join(dir, 'music/manifest.json'), JSON.stringify({ v: 1, items: [
    { slug: 'theme', kind: 'song', title: 'Owl <Theme>', blurb: 'A hook.', published: true, duration: 16, bpm: 120, lyrics: 'Stay up <late>',
      files: [{ role: 'audio', path: 'music/theme/theme.mp3' }, { role: 'master', path: 'music/theme/theme-master.wav', public: false }, { role: 'loop', path: 'music/theme/theme-loop.ogg', bars: 8, name: 'Theme loop' }],
      credits: 'Made with Eleven Music.', rights: { provider: 'elevenlabs', plan: 'creator', commercial: true } },
    { slug: 'draft', title: 'Not yet', published: false, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] },
    { slug: 'cloud', title: 'In R2', published: true, files: [{ role: 'audio', path: 'music/cloud.mp3', key: 'music/cloud.mp3' }] },
    { key: 'music/old.mp3', file: 'music/old.mp3', bytes: 3 },
  ] }));
  writeFileSync(join(dir, 'videos/manifest.json'), JSON.stringify({ v: 1, items: [
    { slug: 'trailer', kind: 'trailer', title: 'Trailer', published: true, duration: 15, honesty: 'Real gameplay; bots fill empty seats.',
      files: [{ role: 'video', path: 'videos/trailer/trailer.mp4' }, { role: 'vertical', path: 'videos/trailer/trailer-9x16.mp4' }, { role: 'poster', path: 'videos/trailer/poster.jpg' }] },
  ] }));
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual([b.catalogue, b.songs, b.videos], [[], ['theme'], ['trailer']]);
  assert.ok(b.mediaSkipped.some((m) => m.item === 'draft' && /not published/.test(m.why)));
  assert.ok(b.mediaSkipped.some((m) => m.item === 'cloud' && /not on this computer/.test(m.why)), 'an R2 key without a bucket is not reachable yet');
  const dist = join(dir, 'site/dist');
  assert.ok(existsSync(join(dist, 'music/theme/theme.mp3')) && existsSync(join(dist, 'music/theme/theme-loop.ogg')));
  assert.equal(existsSync(join(dist, 'music/theme/theme-master.wav')), false, 'a file marked public: false never reaches the site');
  const list = out(run(['media', 'list'], dir));
  assert.deepEqual(list.music.pages.map((p) => p.slug), ['theme']);

  const site = await siteOf(dir);
  const home = await (await site('/')).text();
  assert.match(home, /href="\/music\/theme\/"/);
  assert.match(home, /href="\/videos\/trailer\/"/);
  assert.match(home, /Owl &lt;Theme&gt;/, 'titles are escaped');
  const song = await site('/music/theme/');
  assert.equal(song.status, 200);
  const songHtml = await song.text();
  assert.match(songHtml, /<audio controls preload="metadata" src="\/music\/theme\/theme\.mp3">/);
  assert.match(songHtml, /Stay up &lt;late&gt;/);
  assert.match(songHtml, /Licensed for commercial use \(made on the provider's creator plan\)/);
  assert.match(songHtml, /download><b>Theme loop<\/b>/);
  assert.equal((await site('/music/draft/')).status, 404, 'an unpublished song has no page');
  assert.equal((await site('/music/theme')).status, 301);
  const video = await (await site('/videos/trailer/')).text();
  assert.match(video, /<video data-main controls playsinline preload="metadata" src="\/videos\/trailer\/trailer\.mp4" poster="\/videos\/trailer\/poster\.jpg">/);
  assert.match(video, /trailer-9x16\.mp4/);
  assert.match(video, /Real gameplay; bots fill empty seats\./);
  const part = await site('/music/theme/theme.mp3', { headers: { range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 0-3/20');
  assert.equal(Buffer.from(await part.arrayBuffer()).toString(), 'ID3-');
  assert.equal((await site('/music/theme/theme-master.wav')).status, 404);
  const wk = await (await site('/.well-known/homie-studio.json')).json();
  assert.deepEqual(wk.songs.map((x) => [x.slug, x.page, x.audio]), [['theme', 'https://studio.test/music/theme/', 'https://studio.test/music/theme/theme.mp3']]);
  assert.deepEqual(wk.videos.map((x) => [x.slug, x.video, x.poster]), [['trailer', 'https://studio.test/videos/trailer/trailer.mp4', 'https://studio.test/videos/trailer/poster.jpg']]);

  // No storage is the default: everything above was served by the site itself. After `storage add` (a bucket
  // this studio made), a key is served from R2 at /media/<key>, ranges included.
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(s.cloudflare.r2, null, 'a new studio has no storage');
  s.cloudflare.r2 = 'night-owls-media';
  s.cloudflare.created = [`r2:${s.cloudflare.r2}`];
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s));
  assert.deepEqual(out(run(['build'], dir)).songs, ['theme', 'cloud'], 'the manifest order is the site order');
  const r2site = await siteOf(dir, { 'music/cloud.mp3': Buffer.from('0123456789') });
  assert.match(await (await r2site('/music/cloud/')).text(), /src="\/media\/music\/cloud\.mp3"/);
  const r2part = await r2site('/media/music/cloud.mp3', { headers: { range: 'bytes=-4' } });
  assert.equal(r2part.status, 206);
  assert.equal(r2part.headers.get('content-range'), 'bytes 6-9/10');
  assert.equal(Buffer.from(await r2part.arrayBuffer()).toString(), '6789');
  assert.equal((await r2site('/media/music/cloud.mp3', { headers: { range: 'bytes=50-60' } })).status, 416);
});
