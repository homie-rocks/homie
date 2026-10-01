/**
 * @homie-rocks/studio 0.10.0: a studio works from the Claude app, with Cloudflare's own CI doing the deploys.
 *   - the template: `new --template` (and the repository's template/ folder) is what Cloudflare's "Deploy to
 *     Cloudflare" button and Workers Builds need: wrangler.jsonc at the root, Previews with their own rooms,
 *     build and deploy scripts, the toolkit pinned from registry.npmjs.org, a first game and a Connect band;
 *   - `npm run deploy` in Workers Builds only migrates and deploys (the first one makes the database as it goes);
 *   - the live site claims itself in the directory the first time it is read; a Preview never does;
 *   - a build the chat opened is attached once; a change goes out as a pull request the card can follow;
 *   - a cloud session whose network blocks the directory is told which setting lets the card follow the build;
 *   - `setup attach` names a template copy for the chat that set it up.
 * Run: node --test packages/studio/test/cloud.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { changeMark } from '../lib/progress.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PKG, '..', '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(REPO, 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-cloud-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const VERSION = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;

const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env } });
const out = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON: ${r.stdout}${r.stderr}`); } };
const runAsync = (args, cwd, env = {}) => new Promise((done) => {
  const p = spawn(process.execPath, [CLI, ...args, '--json'], { cwd, env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => done({ status, stdout, stderr }));
});
const jsonc = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));

function link(dir) {
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
}
function studio(name, extra = []) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Test Studio', '--homie', 'https://homie.test', '--no-install', ...extra], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  link(dir);
  return dir;
}
/** Every file under a folder, relative, sorted (no node_modules, no .git). */
function files(dir) {
  const list = [];
  const walk = (at) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(at, e.name);
      if (e.isDirectory()) walk(p); else list.push(relative(dir, p));
    }
  };
  walk(dir);
  return list.sort();
}
/** A stand-in directory on this computer: `routes[path]` answers (req, body) -> [status, json, headers]. */
async function directory(routes) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname;
      seen.push({ method: req.method, path, body, headers: req.headers, url: req.url });
      const route = Object.entries(routes).find(([k]) => (k.endsWith('*') ? path.startsWith(k.slice(0, -1)) : k === path));
      const [status, json, headers = {}] = route ? route[1](req, body, path) : [404, { ok: false }];
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test('the template: Deploy to Cloudflare and Workers Builds ready, and the repository\'s template/ is exactly what `new --template` writes', () => {
  const dir = join(scratch, 'template');
  const made = out(run(['new', dir, '--name', 'My Studio', '--no-install', '--template'], scratch));
  assert.equal(made.ok, true, JSON.stringify(made));
  const config = jsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.main, 'site/src/worker.mjs');
  assert.equal(config.assets.directory, './site/dist');
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.d1_databases[0].migrations_dir, 'site/migrations');
  assert.equal(config.d1_databases[0].database_id, undefined, 'no account-specific id: Wrangler and the Deploy flow create the database');
  assert.equal(config.preview_urls, true, 'every branch gets a Preview URL');
  assert.deepEqual(config.previews.durable_objects.bindings.map((b) => b.name), ['TABLE', 'LOBBY'], 'a Preview binds its own Table and Lobby namespaces');
  assert.equal(config.previews.vars.HOMIE_PREVIEW, '1');
  assert.equal(config.previews.d1_databases, undefined, 'a Preview counts nothing into the studio\'s stats and never claims');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'homie-studio build');
  assert.equal(pkg.scripts.deploy, 'homie-studio deploy');
  assert.equal(pkg.devDependencies['@homie-rocks/studio'], VERSION, 'the toolkit from registry.npmjs.org, this exact version');
  const [maj, min] = pkg.devDependencies.wrangler.split('.').map(Number);
  assert.ok(maj > 4 || (maj === 4 && min >= 135), 'Wrangler 4.135.0 or later (Worker Previews)');
  assert.match(pkg.cloudflare.bindings.STUDIO_NAME.description, /studio's name/);
  const studioJson = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(studioJson.template, true);
  assert.ok(existsSync(join(dir, 'games/gem-rush/game.json')), 'a first game: the site plays the moment it is up');
  assert.match(readFileSync(join(dir, 'site/partials/home.html'), 'utf8'), /href="\/_studio\/connect"/);
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\/homie-rocks\/homie\/tree\/main\/template/);
  // The public template is generated, never hand-edited: `node scripts/template.mjs` writes it.
  const tpl = join(REPO, 'template');
  assert.deepEqual(files(tpl), files(dir).filter((f) => f !== '.gitignore' || existsSync(join(tpl, f))), 'template/ has exactly the generated files');
  for (const f of files(tpl)) assert.equal(readFileSync(join(tpl, f), 'utf8'), readFileSync(join(dir, f), 'utf8'), `template/${f} is what \`new --template\` writes (node scripts/template.mjs)`);
});

/** A stand-in Wrangler for Workers Builds: every call is logged; the first `d1 migrations apply` finds no database. */
function workersBuilds(dir, { firstDeploy = true } = {}) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
S=${state}
echo "$*" >> $S/calls
case "$1" in
  d1) if [ "$2" = migrations ] && [ ! -f $S/deployed ] && [ "${firstDeploy ? 1 : 0}" = 1 ]; then echo "Couldn't find a D1 DB with the name or binding 'DB' in your wrangler.jsonc file." >&2; exit 1; fi; echo 'Migrations applied';;
  deploy) touch $S/deployed; echo 'Uploaded test-studio'; echo 'Deployed test-studio triggers'; echo '  https://test-studio.acct.workers.dev';;
  *) echo "Workers Builds never runs: $*" >&2; exit 9;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  return { calls: () => readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') };
}

test('Workers Builds: `npm run deploy` only migrates and deploys (by binding name); the first one makes the database as it deploys', () => {
  const dir = studio('builds');
  assert.equal(out(run(['game', 'new', 'owl-run', '--name', 'Owl Run'], dir)).ok, true);
  const before = readFileSync(join(dir, 'studio.json'), 'utf8');
  const cf = workersBuilds(dir);
  const env = { WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: 'a'.repeat(40), WORKERS_CI_BRANCH: 'main' };
  const unbuilt = out(run(['deploy'], dir, env));
  assert.equal(unbuilt.ok, false);
  assert.match(unbuilt.why, /npm run build/);
  assert.equal(out(run(['build'], dir, env)).ok, true);
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  assert.equal(cat.studio.build.commit, 'a'.repeat(40), 'the build says which commit it is');
  assert.equal(cat.studio.build.ci, 'workers-builds');
  const done = out(run(['deploy'], dir, env));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.ci, true);
  assert.equal(done.url, 'https://test-studio.acct.workers.dev');
  assert.deepEqual(cf.calls(), ['d1 migrations apply DB --remote', 'deploy', 'd1 migrations apply DB --remote'], 'no whoami, no create, no refusals: the Deploy flow made the resources');
  assert.equal(readFileSync(join(dir, 'studio.json'), 'utf8'), before, 'a CI checkout is thrown away: nothing is written back');
  const again = out(run(['deploy'], dir, env));
  assert.equal(again.ok, true);
  assert.deepEqual(cf.calls().slice(3), ['d1 migrations apply DB --remote', 'deploy'], 'later deploys: migrations first, then the Worker');
  assert.equal(out(run(['deploy', '--ci'], dir)).ci, true, '--ci does the same outside Workers Builds');
});

/** The studio Worker over a built site, with a node:sqlite D1 and a stand-in fetch for the directory. */
async function workerOf(dir, { preview = false, name = 'Test Studio' } = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = { async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const f = join(dist, p);
    if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  } };
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null, all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => { sql.prepare(q).run(...args); return { success: true }; } });
  const DB = { prepare: (q) => stmt(q), batch: async (l) => { for (const s of l) await s.run(); return []; } };
  const LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(JSON.stringify({ rooms: [] })) }) };
  const env = { ASSETS, LOBBY, DB, STUDIO_NAME: name, ...(preview ? { HOMIE_PREVIEW: '1' } : {}) };
  return { sql, get: (origin, path) => worker.fetch(new Request(`${origin}${path}`, { headers: { 'user-agent': 'homie-directory' } }), env, { waitUntil() {} }) };
}

test('the live site claims itself in the directory the first time it is read, keeps it, and a Preview never does', async (t) => {
  const dir = studio('claims', ['--template']);
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  // A change that went out as a pull request: its mark is listed once the site is built with it.
  mkdirSync(join(dir, 'changes'), { recursive: true });
  writeFileSync(join(dir, 'changes', '2026-09-30-abcdef01.json'), JSON.stringify({ v: 1, change: 'abcdef0123456789', title: 'Faster crowns', at: '2026-09-30T12:00:00.000Z' }));
  assert.equal(out(run(['build'], dir)).ok, true);
  const asked = [];
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  let answer = { ok: true, claim: 'c'.repeat(40) };
  globalThis.fetch = async (url, init) => {
    asked.push({ url: String(url), ua: new Headers(init?.headers).get('user-agent') });
    if (answer === 'down') throw new Error('offline');
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
  };
  const site = await workerOf(dir, { name: 'Night Owls' });
  const m = await (await site.get('https://claims-a.example', '/.well-known/homie-studio.json')).json();
  assert.equal(m.claim, 'c'.repeat(40), 'the claim the directory handed out, for this address');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, `https://homie.test/api/studio/claim?site=${encodeURIComponent('https://claims-a.example')}`);
  assert.match(asked[0].ua, /^homie-studio\/\d+\.\d+\.\d+ \(site claim\)$/);
  assert.equal(site.sql.prepare("SELECT value FROM meta WHERE key = 'homie_claim:https://claims-a.example'").get().value, 'c'.repeat(40), 'kept in the studio\'s own D1');
  assert.equal(m.name, 'Night Owls', 'a template copy shows the name typed in Cloudflare\'s form');
  assert.deepEqual(m.build.changes, ['abcdef0123456789'], 'the newest changes\' marks');
  await site.get('https://claims-a.example', '/.well-known/homie-studio.json');
  assert.equal(asked.length, 1, 'asked once');
  // The directory is down: no claim, and it is not asked again within the minute.
  answer = 'down';
  const down = await (await site.get('https://claims-b.example', '/.well-known/homie-studio.json')).json();
  assert.equal(down.claim, null);
  await site.get('https://claims-b.example', '/.well-known/homie-studio.json');
  assert.equal(asked.length, 2, 'a directory that did not answer is asked again at most once a minute');
  // A Preview is a branch under review: it never claims, and says it is a Preview.
  answer = { ok: true, claim: 'd'.repeat(40) };
  const preview = await workerOf(dir, { preview: true });
  const pm = await (await preview.get('https://branch-test.claims.example', '/.well-known/homie-studio.json')).json();
  assert.equal(pm.claim, null);
  assert.equal(pm.build.preview, true);
  assert.equal(asked.length, 2, 'a Preview never asks');
  // Connect to Claude: the directory's setup page, for this address.
  const connect = await site.get('https://claims-a.example', '/_studio/connect');
  assert.equal(connect.status, 302);
  assert.equal(connect.headers.get('location'), `https://homie.test/studio/setup/connect?site=${encodeURIComponent('https://claims-a.example')}`);
  // studio.json `homie.directory: false`: never asked.
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...s, homie: { ...s.homie, directory: false } }, null, 2));
  assert.equal(out(run(['build'], dir)).ok, true);
  const off = await workerOf(dir);
  assert.equal((await (await off.get('https://claims-c.example', '/.well-known/homie-studio.json')).json()).claim, null);
  assert.equal(asked.length, 2);
});

test('a build the chat opened is attached once; its change and pull request go on the card, never its key', async () => {
  const dir = studio('attach');
  assert.equal(out(run(['game', 'new', 'owl-run', '--name', 'Owl Run'], dir)).ok, true);
  const hb = `hb_${'a'.repeat(32)}`;
  let attached = 0;
  const dirx = await directory({
    [`/api/studio/progress/${hb}/attach`]: () => (attached++ ? [409, { ok: false, error: 'attached', message: 'this build is already attached' }] : [200, { ok: true, build: hb, key: `hbk_${'b'.repeat(48)}`, title: 'Crown Thief, faster crowns', expiresAt: '2026-10-01T00:00:00.000Z' }]),
    [`/api/studio/progress/${hb}`]: () => [200, { ok: true, stop: false }],
  });
  try {
    const a = out(await runAsync(['progress', 'attach', hb, '--homie', dirx.url], dir));
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.command, 'progress attach');
    assert.equal(a.shared.build, hb);
    assert.equal(a.title, 'Crown Thief, faster crowns', 'the title the person saw in the chat');
    assert.equal(readFileSync(join(dir, '.studio/progress', `${a.build}.key`), 'utf8').trim(), `hbk_${'b'.repeat(48)}`);
    const other = studio('attach-other');
    const again = out(await runAsync(['progress', 'attach', hb, '--homie', dirx.url], other));
    assert.equal(again.ok, false, 'one attach only: a second session is refused');
    assert.match(again.why, /already attached/);
    assert.ok(!existsSync(join(other, '.studio/progress/current')), 'and leaves no open feed behind');
    const change = out(await runAsync(['progress', 'change', 'Crowns spawn twice as often'], dir));
    assert.equal(change.ok, true, JSON.stringify(change));
    assert.equal(change.mark, changeMark(hb));
    const marker = JSON.parse(readFileSync(join(dir, change.file), 'utf8'));
    assert.equal(marker.change, changeMark(hb));
    assert.ok(!JSON.stringify(marker).includes(hb), 'the mark names the build without being able to read it');
    // The live address learned after the build opened (setup attach writes it): the pull request carries it to the card.
    mkdirSync(join(dir, '.studio'), { recursive: true });
    writeFileSync(join(dir, '.studio', 'local.json'), JSON.stringify({ url: 'https://test-studio.acct.workers.dev' }));
    const pr = out(await runAsync(['progress', 'pr', '--url', 'https://github.com/octo-studios/night-owls/pull/7', '--files', '3', '--additions', '41', '--deletions', '9', '--preview', 'https://example.org/preview'], dir));
    assert.equal(pr.ok, true, JSON.stringify(pr));
    assert.equal(pr.feed.change.number, 7);
    assert.equal(pr.feed.change.repo, 'octo-studios/night-owls');
    assert.equal(pr.feed.stages.find((x) => x.id === 'deploy').state, 'running', 'deploy waits for the merge');
    assert.equal(pr.feed.site, 'https://test-studio.acct.workers.dev', 'the card reads the live site for the merge');
    assert.equal(out(await runAsync(['progress', 'pr', '--url', 'https://evil.example/octo/x/pull/1'], dir)).ok, false, 'only a github.com pull request');
    assert.equal(out(run(['build'], dir)).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8')).studio.build.changes, [changeMark(hb)]);
    const puts = dirx.seen.filter((x) => x.method === 'PUT');
    assert.ok(puts.length >= 1);
    for (const p of puts) assert.ok(!p.body.includes('hbk_') && !p.body.includes(dir), 'the feed carries no key and no path');
    assert.ok(puts.some((p) => JSON.parse(p.body).change?.url === 'https://github.com/octo-studios/night-owls/pull/7'));
  } finally { dirx.close(); }
});

test('a Claude Code cloud session whose network blocks the directory: the toolkit names the setting that lets the card follow', async () => {
  const dir = studio('network');
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/octo-studios/night-owls.git'], { cwd: dir });
  const blocked = await directory({ '/api/studio/*': () => [403, { error: 'blocked' }, { 'x-deny-reason': 'host_not_allowed' }] });
  try {
    const started = out(await runAsync(['progress', 'start', '--share', '--homie', blocked.url], dir));
    assert.equal(started.ok, true, 'the build goes on with its local feed');
    assert.match(started.sharedWhy, /Network access to Custom, add 127\.0\.0\.1:\d+/);
    assert.equal(out(run(['progress', 'end', 'stopped'], dir)).ok, true);
    const setup = out(await runAsync(['setup', 'attach', `hs_${'c'.repeat(32)}`, '--homie', blocked.url], dir));
    assert.equal(setup.ok, false);
    assert.equal(setup.needs, 'network');
  } finally { blocked.close(); }
});

test('setup attach: this repository is the chat\'s studio; a template copy takes its real name and loses its Connect band', async () => {
  const dir = studio('setup', ['--template']);
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/octo-studios/night-owls.git'], { cwd: dir });
  const hs = `hs_${'e'.repeat(32)}`;
  const dirx = await directory({ [`/api/studio/setup/${hs}/attach`]: () => [200, { ok: true, name: 'Night Owls', site: 'https://test-studio.acct.workers.dev' }] });
  try {
    const r = out(await runAsync(['setup', 'attach', hs, '--homie', dirx.url], dir));
    assert.equal(r.ok, true, JSON.stringify(r));
    const sent = JSON.parse(dirx.seen[0].body);
    assert.equal(sent.repo, 'octo-studios/night-owls');
    assert.deepEqual(Object.keys(sent).sort(), ['repo', 'studio', 'version'], 'the repository, the studio\'s name and slug, and the version: nothing else');
    const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
    assert.deepEqual([s.name, s.slug, s.template], ['Night Owls', 'night-owls', undefined]);
    assert.match(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), /"STUDIO_NAME": "Night Owls"/);
    assert.ok(!existsSync(join(dir, 'site/partials/home.html')), 'the Connect band goes');
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /^# Night Owls$/m);
    assert.equal(JSON.parse(readFileSync(join(dir, '.studio/local.json'), 'utf8')).url, 'https://test-studio.acct.workers.dev');
    assert.ok(r.renamed.includes('studio.json') && r.renamed.includes('wrangler.jsonc'));
  } finally { dirx.close(); }
});

test('Chrome on Linux: SwiftShader for WebGL, container-safe as root; on a Mac, the GPU', async () => {
  const { chromeArgs, noChrome } = await import('../lib/chrome.mjs');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const uid = process.getuid;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.getuid = () => 0;
    const linux = chromeArgs();
    assert.ok(linux.includes('--enable-unsafe-swiftshader') && linux.includes('--use-angle=swiftshader'));
    assert.ok(linux.includes('--no-sandbox'), 'root in a container');
    assert.match(noChrome(), /homie-studio chrome install/);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.ok(chromeArgs().includes('--use-angle=metal'));
    assert.ok(!chromeArgs().includes('--no-sandbox'));
  } finally { Object.defineProperty(process, 'platform', platform); process.getuid = uid; }
});
