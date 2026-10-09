/**
 * The toolkit's own requests behind a proxy, and what it says when one fails (lib/net.mjs, lib/repo.mjs).
 *
 * A Claude Code cloud session sends ALL its traffic through an HTTP CONNECT proxy (HTTPS_PROXY). curl and npm use
 * it; Node's fetch() did not, so `setup attach` and `progress attach` failed there with "did not answer", which read
 * like a blocked network (2026-09-30). Here a stand-in of that egress (a CONNECT proxy that is the only way to
 * `homie.test`, which resolves nowhere directly, and that refuses `blocked.test` with x-deny-reason
 * host_not_allowed) proves:
 *   - through the proxy, the CLI reaches the directory (it restarts itself with Node's proxy support);
 *   - without that, the error says what happened (ENOTFOUND, and that the proxy was not used), never "network";
 *   - only the proxy's own refusal names the network setting;
 *   - a directory's refusal is reported with its status and its own message;
 *   - the studio's repository comes from its remote, never the engine's, and the Worker tells its directory.
 * The stand-in needs openssl for its certificate; without it the proxy tests are skipped.
 * Run: node --test packages/studio/test/net.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canUseProxy, networkSetting, noProxyWithLoopback, request, whyFailed, whyRefused } from '../lib/net.mjs';
import { ENGINE_REPO, repoFromUrl, studioRepo } from '../lib/repo.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-net-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

function studio(name, remote = 'https://github.com/octo-studios/super-game.git') {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Super Games', '--template', '--homie', 'https://homie.test', '--no-install', '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  if (remote) spawnSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}
const cli = (args, cwd, env = {}) => new Promise((done) => {
  const p = spawn(process.execPath, [CLI, ...args, '--json'], { cwd, env: { ...process.env, HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '', NODE_USE_ENV_PROXY: '', ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => { try { done({ status, ...JSON.parse(stdout) }); } catch { done({ status, raw: stdout + stderr }); } });
});

/** The stand-in egress: a CONNECT proxy (the only way to homie.test), and the directory behind it. */
async function egress() {
  const dir = mkdtempSync(join(scratch, 'egress-'));
  spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=homie.test', '-addext', 'subjectAltName=DNS:homie.test'], { stdio: 'ignore' });
  const seen = [];
  const answers = new Map();
  const site = httpsServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(`directory ${req.method} ${req.url}`);
      const hit = [...answers.entries()].find(([re]) => re.test(req.url));
      const [status, json] = hit ? hit[1](body) : [404, { ok: false, error: 'unknown' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const proxy = httpServer((req, res) => { res.writeHead(400); res.end(); });
  proxy.on('connect', (req, sock, head) => {
    seen.push(`CONNECT ${req.url}`);
    const [host] = req.url.split(':');
    if (host === 'blocked.test') { sock.end('HTTP/1.1 403 Forbidden\r\nx-deny-reason: host_not_allowed\r\ncontent-length: 0\r\n\r\n'); return; }
    if (host !== 'homie.test') { sock.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n'); return; }
    const up = connect(site.address().port, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return {
    seen, answers,
    env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') },
    close: () => { site.close(); proxy.close(); },
  };
}

test('a refusal is said as it is: the server\'s status and words; only the proxy\'s own refusal names the network setting', async () => {
  const res = (status, headers = {}) => new Response('', { status, headers });
  assert.equal(whyRefused(res(403, { 'x-deny-reason': 'host_not_allowed' }), null, '', 'https://homie.rocks/x').needs, 'network');
  assert.match(whyRefused(res(403, { 'x-deny-reason': 'host_not_allowed' }), null, '', 'https://homie.rocks/x').why, /Network access to Custom, add homie\.rocks/);
  const refused = whyRefused(res(409), { ok: false, message: 'this setup is already octo/other\'s; a studio is one repository' }, '', 'https://homie.rocks/api/x');
  assert.equal(refused.needs, undefined, 'a directory\'s refusal is never a network problem');
  assert.equal(refused.why, 'homie.rocks answered 409: this setup is already octo/other\'s; a studio is one repository');
  assert.match(whyRefused(res(502), null, '<html>Bad gateway</html>', 'https://homie.rocks/').why, /answered 502: <html>Bad gateway<\/html>/);
  const lookup = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND homie.rocks'), { code: 'ENOTFOUND' }) });
  const direct = whyFailed(lookup, 'https://homie.rocks/x', { env: { HTTPS_PROXY: 'http://proxy:3128' }, execArgv: [] });
  assert.match(direct.why, /^could not look up homie\.rocks \(ENOTFOUND\) \(directly: this machine's proxy in HTTPS_PROXY was not used/);
  assert.equal(direct.needs, undefined);
  assert.match(whyFailed(lookup, 'https://homie.rocks/x', { env: {}, execArgv: [] }).why, /^could not look up homie\.rocks \(ENOTFOUND\)$/);
  // As Node 22's fetch nests it: TypeError > DOMException (code 0) > undici's own error.
  const tunnel = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Request was cancelled.'), { code: 0, cause: Object.assign(new Error('Proxy response (403) !== 200 when HTTP Tunneling'), { code: 'UND_ERR_ABORTED' }) }) });
  assert.equal(whyFailed(tunnel, 'https://homie.rocks/x', { env: { HTTPS_PROXY: 'http://p:1' }, execArgv: ['--use-env-proxy'] }).needs, 'network', 'a refused CONNECT is the proxy refusing');
  const ok = await request('https://homie.rocks/x', {}, { fetchFn: async () => new Response(JSON.stringify({ ok: false, message: 'no such build here' }), { status: 200 }) });
  assert.deepEqual([ok.ok, ok.why], [false, 'homie.rocks answered 200: no such build here'], 'ok: false in a 2xx answer is a refusal');
  assert.equal(noProxyWithLoopback('example.com'), 'example.com,localhost,127.0.0.1,::1');
  assert.match(networkSetting('homie.rocks'), /refused homie\.rocks/);
});

test('the run with the proxy on never outlives the CLI: a kill by process id reaches it', { skip: !canUseProxy() && 'this Node.js has no --use-env-proxy' }, async () => {
  const dir = mkdtempSync(join(scratch, 'restart-'));
  const sleeper = join(dir, 'sleeper.mjs');
  writeFileSync(sleeper, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, proxy: process.env.NODE_USE_ENV_PROXY, https: process.env.HTTPS_PROXY, lower: process.env.https_proxy ?? null })); setInterval(() => {}, 1000);`);
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, `import { restartWithProxy } from ${JSON.stringify(pathToFileURL(join(PKG, 'lib', 'net.mjs')).href)}; process.exit(await restartWithProxy({ argv: [process.execPath, ${JSON.stringify(sleeper)}, ${JSON.stringify(join(dir, 'child.json'))}], env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: '', NODE_USE_ENV_PROXY: '' } }) ?? 99);`);
  const parent = spawn(process.execPath, [runner], { stdio: 'ignore', env: { ...process.env, HOMIE_STUDIO_NO_PROXY_RESTART: '' } });
  const file = join(dir, 'child.json');
  for (let i = 0; i < 100 && !existsSync(file); i += 1) await new Promise((r) => setTimeout(r, 50));
  const child = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([child.proxy, child.https, child.lower], ['1', 'http://127.0.0.1:9', null], 'proxy support on, and an empty https_proxy (which Node would read as "none") left out');
  const exited = new Promise((r) => parent.on('exit', r));
  parent.kill('SIGTERM');
  await exited;
  let alive = true;
  for (let i = 0; i < 40 && alive; i += 1) { try { process.kill(child.pid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; } }
  if (alive) process.kill(child.pid, 'SIGKILL');
  assert.equal(alive, false, 'the restarted run ended with the CLI');
});

test('the studio\'s repository: owner/name from any remote, never a token, never the engine', () => {
  assert.equal(repoFromUrl('https://github.com/octo/super-game.git'), 'octo/super-game');
  const at = '@';
  assert.equal(repoFromUrl(`git${at}github.com:octo/super-game.git`), 'octo/super-game');
  assert.equal(repoFromUrl(`https://x-access-token:not-a-token${at}github.com/octo/super-game`), 'octo/super-game', 'only owner/name is kept');
  assert.equal(repoFromUrl('http://local_proxy@127.0.0.1:41537/git/octo/super-game'), 'octo/super-game', 'a cloud session\'s proxied remote');
  assert.equal(repoFromUrl(`https://github.com/${ENGINE_REPO}.git`), null, 'a studio is never Homie\'s engine and template');
  assert.equal(studioRepo('octo/super-game'), 'octo/super-game');
  assert.equal(studioRepo('not a repo'), null);
});

test('setup attach without a repository of its own, or in the engine\'s, refuses before it asks the directory', async () => {
  const none = studio('no-remote', null);
  const r = await cli(['setup', 'attach', `hs_${'a'.repeat(32)}`, '--homie', 'https://homie.test'], none);
  assert.equal(r.ok, false);
  assert.equal(r.needs, 'repository');
  const engine = studio('engine-remote', `https://github.com/${ENGINE_REPO}.git`);
  assert.equal((await cli(['setup', 'attach', `hs_${'a'.repeat(32)}`, '--homie', 'https://homie.test'], engine)).needs, 'repository');
});

test('behind a cloud session\'s egress proxy: the CLI goes through it; without it the error says so, and only a refusal names the network', { skip: !openssl && 'no openssl for the stand-in certificate' }, async () => {
  const e = await egress();
  try {
    const hs = `hs_${'b'.repeat(32)}`;
    e.answers.set(/\/api\/studio\/setup\/hs_b+\/attach$/, (body) => [200, { ok: true, name: 'Super Games', site: 'https://test-studio.acct.workers.dev', repo: JSON.parse(body).repo }]);
    e.answers.set(/\/api\/studio\/setup\/hs_c+\/attach$/, () => [409, { ok: false, error: 'attached', message: 'this setup is already octo-studios/other\'s; a studio is one repository' }]);
    e.answers.set(/\/api\/studio\/progress\/hb_d+\/attach$/, () => [200, { ok: true, build: `hb_${'d'.repeat(32)}`, key: `hbk_${'e'.repeat(48)}`, title: 'Super Games: first steps' }]);
    e.answers.set(/\/api\/studio\/progress\/hb_d+$/, () => [200, { ok: true, stop: false }]);
    const dir = studio('behind-proxy');
    // Through the proxy, as curl and npm go: the CLI restarts itself with Node's proxy support.
    const through = await cli(['setup', 'attach', hs, '--homie', 'https://homie.test'], dir, e.env);
    assert.equal(through.ok, true, JSON.stringify(through));
    assert.equal(through.repo, 'octo-studios/super-game');
    assert.ok(e.seen.includes('CONNECT homie.test:443'), e.seen.join(' | '));
    assert.equal(JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8')).github, 'octo-studios/super-game', 'the next deploy tells the Worker which repository it is');
    const attached = await cli(['progress', 'attach', `hb_${'d'.repeat(32)}`, '--homie', 'https://homie.test'], dir, e.env);
    assert.equal(attached.ok, true, JSON.stringify(attached));
    assert.equal(attached.shared.build, `hb_${'d'.repeat(32)}`);
    // The directory refuses: its status and its own words, never the network.
    const refused = await cli(['setup', 'attach', `hs_${'c'.repeat(32)}`, '--homie', 'https://homie.test'], studio('refused'), e.env);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 409);
    assert.equal(refused.why, 'homie.test answered 409: this setup is already octo-studios/other\'s; a studio is one repository');
    assert.equal(refused.needs, undefined);
    // Node's fetch alone (what 0.11.0 did): it never used the proxy, and now it says exactly that.
    const direct = await cli(['setup', 'attach', hs, '--homie', 'https://homie.test'], studio('direct'), { ...e.env, HOMIE_STUDIO_NO_PROXY_RESTART: '1' });
    assert.equal(direct.ok, false);
    assert.equal(direct.code, 'ENOTFOUND');
    assert.match(direct.why, /^could not look up homie\.test \(ENOTFOUND\) \(directly: this machine's proxy in HTTPS_PROXY was not used/);
    assert.equal(direct.needs, undefined, 'a lookup that never went through the proxy is no reason to change network settings');
    // The proxy itself refuses the host: then, and only then, the one network setting.
    const blocked = await cli(['setup', 'attach', hs, '--homie', 'https://blocked.test'], studio('blocked'), e.env);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.needs, 'network', JSON.stringify(blocked));
    assert.match(blocked.why, /network proxy of this machine refused blocked\.test/);
    // setup status says the same, as it is.
    const status = await cli(['setup', 'status'], studio('status'), { ...e.env, HOMIE_STUDIO_NO_PROXY_RESTART: '1' });
    const row = status.rows?.find((x) => x.id === 'connector');
    assert.match(row?.detail ?? '', /request to the directory failed: could not look up homie\.test \(ENOTFOUND\)/);
    assert.equal(row?.fix, null, 'no connector advice for a request that never left this machine');
  } finally { e.close(); }
});

test('the live Worker tells its directory its repository with its claim, and again only when it changes', async (t) => {
  const dir = studio('worker-repo');
  assert.equal(spawnSync(process.execPath, [CLI, 'build', '--json'], { cwd: dir, encoding: 'utf8' }).status, 0);
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = { async fetch(req) { const p = decodeURIComponent(new URL(req.url).pathname); const f = join(dist, p); return existsSync(f) && /\.[a-z]+$/.test(p) ? new Response(readFileSync(f)) : new Response('', { status: 404 }); } };
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (q, a = []) => ({ bind: (...x) => stmt(q, x), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }), run: async () => { sql.prepare(q).run(...a); return {}; } });
  const DB = { prepare: (q) => stmt(q), batch: async (l) => { for (const x of l) await x.run(); return []; } };
  const asked = [];
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(JSON.stringify({ ok: true, claim: 'f'.repeat(40) })); };
  const get = (env) => worker.fetch(new Request('https://super-game.example.org/.well-known/homie-studio.json'), { ASSETS, DB, LOBBY: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{"rooms":[]}') }) }, ...env }, { waitUntil() {} });
  const m = await (await get({ HOMIE_REPO: 'octo-studios/super-game' })).json();
  assert.equal(m.claim, 'f'.repeat(40));
  assert.equal(asked.length, 1);
  assert.match(asked[0], /\/api\/studio\/claim\?site=https%3A%2F%2Fsuper-game\.example\.org&repo=octo-studios%2Fsuper-game$/);
  assert.doesNotMatch(JSON.stringify(m), /octo-studios/, 'the repository is never in the public manifest');
  await get({ HOMIE_REPO: 'octo-studios/super-game' });
  assert.equal(asked.length, 1, 'said once');
  await get({ HOMIE_REPO: 'octo-studios/renamed' });
  assert.equal(asked.length, 2, 'said again when it changes');
  await get({ HOMIE_REPO: ENGINE_REPO });
  assert.equal(asked.length, 2, 'the engine\'s repository is never said');
});
