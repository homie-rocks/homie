/**
 * The dev server, deploy and publish, as a creator's agent met them (a stand-in wrangler plays Cloudflare and the
 * local runtime; a stand-in fetch or a server on this computer plays the live site and the directory):
 *
 *   - a Node.js that is too old is refused by every command, with the version it needs;
 *   - the studio's own custom-domain and exact-host routes survive every deploy, a wildcard or catch-all route is
 *     never deployed, and a domain that answers as something else says which route is needed;
 *   - two deploys at once are refused, and a lock a killed deploy left is taken over;
 *   - a deploy says which games changed, with a content hash, and asks the directory to read a listed studio again,
 *     once, after an older toolkit's deploy offered a game's whole source (never for a studio this computer did not
 *     list);
 *   - publish says how many publishes are left;
 *   - local dev never inherits a production hostname, a stale dev record heals itself, a game added while dev
 *     runs is picked up, and room lines carry a time;
 *   - a name Node cannot look up is a network preflight failure with local testing offered.
 * Run: node --test packages/studio/test/dev-deploy.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { customHost, deploy, explainCloudflare, readLiveSite, zoneCheck } from '../lib/cloudflare.mjs';
import { DEPLOY_LOCK, LOCK_MAX_AGE_MS, compareDeploy, deployWords, gameHash, lastDeploy, lockDeploy, lockHolds } from '../lib/deploy-state.mjs';
import { gameDigest } from '../lib/build.mjs';
import { buildDigest } from '../lib/perf.mjs';
import { LOST_HINT, devConfig, devFile, devState, listenersOn, relayLines, socketOriginProblem, socketUrlIn } from '../lib/dev.mjs';
import { beforeLine, isPublishCap, listedHere, publish, publishBefore, publishesSoFar, quotaLine, quotaOf } from '../lib/directory.mjs';
import { reachSite, whyFailed } from '../lib/net.mjs';
import { NODE_MIN, nodeProblem } from '../lib/node-version.mjs';
import { exactRouteFor, keptRoutes, readConfig, readZoneRoutes, routeCovers, routeKind, shadowedDomain, sortRoutes, wideRouteRefusal, zoneCandidates, zoneFinding } from '../lib/routes.mjs';
import { wranglerConfig } from '../lib/scaffold.mjs';
import { readLocal, readStudio, writeLocal, writeStudio } from '../lib/studio.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-dev-deploy-')));
const started = [];
test.after(() => {
  for (const p of started) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(scratch, { recursive: true, force: true });
});

const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env } });
const out = (r) => JSON.parse(r.stdout);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30_000, every = 150) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); }
}
const freePort = () => new Promise((done) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

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

/** A stand-in Cloudflare account: every call is logged; `deploy` answers what Wrangler prints (or `deployOut`). */
function account(dir, { deployOut = null, deployCode = 0 } = {}) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  if (deployOut) writeFileSync(join(state, 'deploy-out'), deployOut);
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
  auth) if [ -f $S/signed-in ]; then echo '{"type":"oauth","token":"stand-in"}'; else echo 'not signed in' >&2; exit 1; fi;;
  deploy) cp wrangler.jsonc $S/deployed-config 2>/dev/null; if [ -f $S/deploy-out ]; then cat $S/deploy-out >&2; exit ${deployCode}; fi; echo 'Deployed test-studio triggers https://test-studio.acct.workers.dev';;
  *) echo "unexpected: $*" >&2; exit 9;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  return { calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []), state };
}

/** wrangler.jsonc with something added by the studio's owner (the file stays the toolkit's, comment and all). */
function editConfig(dir, change) {
  const file = join(dir, 'wrangler.jsonc');
  const json = readConfig(dir);
  change(json);
  writeFileSync(file, `// edited by the studio's owner\n${JSON.stringify(json, null, 2)}\n`);
}

/**
 * A stand-in for Cloudflare's API as the zone check reads it: the zones this sign-in has, and each one's Worker
 * routes. `asked` is every request, with its method: the check only ever reads.
 */
function cloudflareApi({ zones = {}, status = 200 } = {}) {
  const asked = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    asked.push(`${init.method ?? 'GET'} ${u.host}${u.pathname}${u.search}`);
    if (u.host !== 'api.cloudflare.com') return new Response(JSON.stringify({ v: 1, name: 'Test Studio', claim: 'ab'.repeat(12), games: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const json = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
    if (status !== 200) return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null }, status);
    if (u.pathname === '/client/v4/zones') { const name = u.searchParams.get('name'); return json({ success: true, result: zones[name] ? [{ id: `zone-${name}`, name }] : [] }); }
    const m = /^\/client\/v4\/zones\/zone-(.+)\/workers\/routes$/.exec(u.pathname);
    if (m && zones[m[1]]) return json({ success: true, result: zones[m[1]].map((r, i) => ({ id: `route-${i}`, ...r })) });
    return json({ success: false, errors: [{ code: 7003, message: 'not found' }], result: null }, 404);
  };
  return { fetchFn, asked };
}
const HEADERS = { authorization: 'Bearer stand-in' };

test('a custom domain beside another site\'s catch-all: the finding names the route, says never to edit or remove it, and gives the one line', async () => {
  const api = cloudflareApi({ zones: { 'example.com': [{ pattern: '*/*', script: 'main-site' }, { pattern: 'example.com/blog/*', script: 'blog' }] } });
  assert.deepEqual(zoneCandidates('play.example.com'), ['play.example.com', 'example.com']);
  assert.deepEqual(zoneCandidates('play.example.co.uk', { routes: [{ pattern: 'play.example.co.uk', custom_domain: true, zone_name: 'example.co.uk' }] }).slice(0, 2), ['example.co.uk', 'play.example.co.uk']);
  const read = await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: api.fetchFn });
  assert.deepEqual(read, { read: true, zone: { id: 'zone-example.com', name: 'example.com' }, routes: [{ pattern: '*/*', script: 'main-site' }, { pattern: 'example.com/blog/*', script: 'blog' }] });
  assert.deepEqual(api.asked, ['GET api.cloudflare.com/client/v4/zones?name=play.example.com', 'GET api.cloudflare.com/client/v4/zones?name=example.com', 'GET api.cloudflare.com/client/v4/zones/zone-example.com/workers/routes'], 'two kinds of read, and nothing else');

  const config = { routes: [{ pattern: 'play.example.com', custom_domain: true }] };
  const f = zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: read });
  assert.equal(f.state, 'foreign');
  assert.deepEqual(f.foreign, [{ pattern: '*/*', script: 'main-site', kind: 'catch-all' }], 'the route that covers the studio\'s hostname; the blog\'s own path does not');
  assert.deepEqual(f.route, { pattern: 'play.example.com/*', zone_name: 'example.com' });
  assert.equal(f.line, '{"pattern":"play.example.com/*","zone_name":"example.com"}');
  assert.match(f.warning, /^example\.com already has a route that covers play\.example\.com and is not this studio's: "\*\/\*" \(Worker main-site\)\./);
  assert.match(f.warning, /That route belongs to another site on this domain: it must not be edited or removed, here or in the Cloudflare dashboard, or that site stops answering\./);
  assert.match(f.warning, /the catch-all answers play\.example\.com first/);
  assert.match(f.warning, /The one safe fix is the studio's own exact-host route, which wins over a wider route for this one hostname only and which every deploy keeps\./);
  assert.ok(f.warning.includes('Add this line to "routes" in wrangler.jsonc and deploy: {"pattern":"play.example.com/*","zone_name":"example.com"}'), 'the exact line');
  assert.match(f.warning, /homie-studio deploy --own-route/);

  // A wildcard is said as a wildcard; a route with no Worker (it turns Workers off) is another site's too.
  const wild = zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: { read: true, zone: read.zone, routes: [{ pattern: '*example.com/*', script: null }] } });
  assert.equal(wild.state, 'foreign');
  assert.match(wild.warning, /"\*example\.com\/\*" \(no Worker: it turns Workers off for what it covers\)/);
  assert.match(wild.warning, /the wildcard answers play\.example\.com first/);

  // With the studio's own exact-host route (in its config, or live on its Worker): nothing to fix, and the other
  // route is still said to be left alone.
  for (const fixed of [
    zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config: { routes: [...config.routes, f.route] }, zone: read }),
    zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: { ...read, routes: [...read.routes, { pattern: 'play.example.com/*', script: 'test-studio' }] } }),
  ]) {
    assert.equal(fixed.state, 'own-route');
    assert.equal(fixed.warning, undefined);
    assert.match(fixed.why, /belongs to another site on this domain and must not be edited or removed\. The studio's own exact-host route \("play\.example\.com\/\*"\) wins over it for this one hostname, and every deploy keeps it: nothing to change\./);
  }

  // The studio's hostname itself on another Worker is not something an exact-host route fixes: only the person can.
  const taken = zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: { ...read, routes: [{ pattern: 'play.example.com/*', script: 'old-site' }] } });
  assert.equal(taken.state, 'taken');
  assert.match(taken.warning, /play\.example\.com itself is routed to another Worker on example\.com: "play\.example\.com\/\*" \(Worker old-site\)\. That route is not this studio's, so the studio does not take, edit or remove it, and neither should you/);
});

test('no catch-all: no warning; routes that cannot be read: unmeasured, never "fine"', async () => {
  const config = { routes: [{ pattern: 'play.example.com', custom_domain: true }] };
  // Other routes on the domain that do not cover the studio's hostname, and the studio's own.
  const api = cloudflareApi({ zones: { 'example.com': [{ pattern: 'example.com/*', script: 'main-site' }, { pattern: 'shop.example.com/*', script: 'shop' }, { pattern: '*.example.com/*', script: 'test-studio' }] } });
  const clear = zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: api.fetchFn }) });
  assert.deepEqual([clear.state, clear.warning, clear.why, clear.foreign], ['clear', undefined, null, []]);

  // Every way of not knowing: each says why, says it is unmeasured, and still gives the line and the rule.
  const cases = [
    [await readZoneRoutes({ hostname: 'play.example.com', headers: null, fetchFn: api.fetchFn }), /this computer has no Cloudflare sign-in to read them with/],
    [await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: cloudflareApi({ status: 403 }).fetchFn }), /this Cloudflare sign-in may not read the domain's routes/],
    [await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: cloudflareApi({ zones: {} }).fetchFn }), /no domain that play\.example\.com belongs to is on the Cloudflare account this computer is signed in to/],
    [await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } }), /Cloudflare could not be reached \(ENOTFOUND\)/],
    [await readZoneRoutes({ hostname: 'play.example.com', headers: HEADERS, fetchFn: async () => new Response('<html>busy</html>', { status: 502 }) }), /Cloudflare answered 502/],
  ];
  for (const [read, why] of cases) {
    assert.equal(read.read, false);
    const f = zoneFinding({ hostname: 'play.example.com', worker: 'test-studio', config, zone: read });
    assert.equal(f.state, 'unmeasured');
    assert.equal(f.warning, undefined);
    assert.match(f.why, /^Not checked: whether another site's route on the domain covers play\.example\.com \(/);
    assert.match(f.why, why);
    assert.match(f.why, /That is unmeasured, not a pass\./);
    assert.ok(f.why.includes('{"pattern":"play.example.com/*","zone_name":"example.com"}'));
    assert.match(f.why, /Never edit or remove a route this studio did not make\./);
    assert.doesNotMatch(f.why, /\bfine\b|no other route/);
  }
});

test('deploy and its plan warn before Wrangler changes anything, read only, and --own-route adds exactly the one line', async () => {
  const dir = studio('beside-catch-all');
  const cf = account(dir);
  writeFileSync(join(cf.state, 'signed-in'), '');
  // A studio with no custom domain is asked nothing at all.
  assert.equal(customHost(readStudio(dir)), null);
  assert.equal(await zoneCheck(dir, { fetchFn: async () => { throw new Error('not asked'); } }), null);
  assert.equal(out(run(['deploy', '--plan'], dir)).zone, undefined);

  writeStudio(dir, { ...readStudio(dir), cloudflare: { ...readStudio(dir).cloudflare, domain: 'play.example.com' } });
  editConfig(dir, (c) => { c.routes = [{ pattern: 'play.example.com', custom_domain: true }]; });
  assert.equal(customHost(readStudio(dir)), 'play.example.com');
  const api = cloudflareApi({ zones: { 'example.com': [{ pattern: '*/*', script: 'main-site' }] } });

  // The plan's own check, with the sign-in Wrangler already has.
  const planned = await zoneCheck(dir, { fetchFn: api.fetchFn });
  assert.equal(planned.state, 'foreign');
  assert.deepEqual(cf.calls(), ['auth token --json'], 'the sign-in comes from Wrangler; nothing else was run');
  // `deploy --plan` carries it (here unmeasured: the toolkit's own tests ask no real network), in JSON and in words.
  const plan = out(run(['deploy', '--plan'], dir));
  assert.deepEqual([plan.zone.state, plan.zone.host, plan.zone.line], ['unmeasured', 'play.example.com', '{"pattern":"play.example.com/*","zone_name":"example.com"}']);
  const words = spawnSync(process.execPath, [CLI, 'deploy', '--plan'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } }).stdout;
  assert.match(words, /\nNot checked: whether another site's route on the domain covers play\.example\.com \(not asked\)\. That is unmeasured, not a pass\./);

  // The deploy: the warning is a step BEFORE anything is built or deployed, a note in the result, and the
  // structured finding; only GETs went to Cloudflare; wrangler.jsonc is as the owner wrote it.
  const said = [];
  const warned = await deploy(dir, { homie: 'http://127.0.0.1:9', fetchFn: api.fetchFn, log: (line) => said.push(line) });
  assert.equal(warned.ok, true, JSON.stringify(warned));
  assert.equal(warned.zone.state, 'foreign');
  assert.deepEqual(warned.zone.foreign, [{ pattern: '*/*', worker: 'main-site', kind: 'catch-all' }]);
  assert.deepEqual(warned.zone.route, { pattern: 'play.example.com/*', zone_name: 'example.com' });
  const at = said.findIndex((l) => l.startsWith('warning: example.com already has a route that covers play.example.com'));
  assert.ok(at >= 0 && at < said.findIndex((l) => l.startsWith('built ')), 'said before the build, and so before Wrangler deploys');
  assert.ok(warned.notes.some((n) => n.includes('must not be edited or removed') && n.includes(warned.zone.line)), 'and in the result the terminal and the tool print');
  assert.deepEqual(warned.steps.find((s) => s.needs === 'cloudflare-routes')?.route, warned.zone.route);
  assert.ok(api.asked.filter((a) => a.includes('api.cloudflare.com')).length >= 2);
  assert.ok(api.asked.every((a) => a.startsWith('GET ')), `Cloudflare's API was only read: ${api.asked.join(' | ')}`);
  assert.deepEqual(readConfig(dir).routes, [{ pattern: 'play.example.com', custom_domain: true }], 'nothing was added by itself');
  // The terminal prints the note.
  const cli = spawnSync(process.execPath, [CLI, 'deploy', '--homie', 'http://127.0.0.1:9'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
  assert.match(cli.stderr + cli.stdout, /Not checked: whether another site's route on the domain covers play\.example\.com/);

  // --own-route: exactly that line joins the studio's own routes, is deployed and kept; the other site's route is
  // never written to (there is no write to Cloudflare's API at all).
  api.asked.length = 0;
  const added = await deploy(dir, { homie: 'http://127.0.0.1:9', fetchFn: api.fetchFn, ownRoute: true });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.deepEqual(readConfig(dir).routes, [{ pattern: 'play.example.com', custom_domain: true }, { pattern: 'play.example.com/*', zone_name: 'example.com' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(cf.state, 'deployed-config'), 'utf8').replace(/^\s*\/\/.*$/gm, '')).routes, readConfig(dir).routes, 'and it is in the config Wrangler deployed');
  assert.match(added.steps.map((s) => s.what).join('\n'), /added the studio's own exact-host route to "routes" in wrangler\.jsonc: \{"pattern":"play\.example\.com\/\*","zone_name":"example\.com"\}\. It covers play\.example\.com only, and every deploy keeps it; the other site's route was not touched\./);
  assert.equal(added.zone.state, 'own-route');
  assert.equal(added.notes, undefined, 'no warning once the studio has its own route');
  assert.ok(api.asked.every((a) => a.startsWith('GET ')));
  // The next plain deploy keeps it and has nothing to warn about; asking again adds nothing twice.
  const kept = await deploy(dir, { homie: 'http://127.0.0.1:9', fetchFn: api.fetchFn, ownRoute: true });
  assert.equal(kept.zone.state, 'own-route');
  assert.equal(readConfig(dir).routes.length, 2);
  assert.match(kept.steps.map((s) => s.what).join('\n'), /--own-route added nothing: the studio's own exact-host route is already there\./);

  // --own-route never guesses: with routes it could not read it adds nothing, and says why.
  const blind = studio('own-route-unread');
  account(blind);
  writeStudio(blind, { ...readStudio(blind), cloudflare: { ...readStudio(blind).cloudflare, domain: 'play.example.com' } });
  const none = await deploy(blind, { homie: 'http://127.0.0.1:9', fetchFn: api.fetchFn, ownRoute: true });
  assert.equal(none.ok, true, JSON.stringify(none));
  assert.equal(none.zone.state, 'unmeasured');
  assert.equal(readConfig(blind).routes, undefined);
  assert.match(none.steps.map((s) => s.what).join('\n'), /--own-route added nothing: the domain's routes could not be read/);
  // No catch-all on the domain: a deploy says nothing about routes at all.
  const quiet = studio('no-catch-all');
  writeFileSync(join(account(quiet).state, 'signed-in'), '');
  writeStudio(quiet, { ...readStudio(quiet), cloudflare: { ...readStudio(quiet).cloudflare, domain: 'play.example.com' } });
  const calm = await deploy(quiet, { homie: 'http://127.0.0.1:9', fetchFn: cloudflareApi({ zones: { 'example.com': [{ pattern: 'example.com/*', script: 'main-site' }] } }).fetchFn });
  assert.deepEqual([calm.ok, calm.zone.state, calm.notes], [true, 'clear', undefined]);
  assert.doesNotMatch(calm.steps.map((s) => s.what).join('\n'), /route/i);
});

/* ------------------------------------------------------------------ Node.js */

test('a Node.js that is too old is refused by every command, with the version it needs', () => {
  assert.equal(NODE_MIN, 22);
  assert.equal(nodeProblem('22.0.0'), null);
  assert.equal(nodeProblem('24.1.0'), null);
  assert.match(nodeProblem('20.11.1'), /needs Node\.js 22 or newer, and this is Node\.js 20\.11\.1\..*nvm install 22.*Nothing was started or changed/);
  assert.match(nodeProblem('18.19.0'), /Node\.js 18\.19\.0/);
  // Every command: one that needs a studio, one that needs none, and the one that used to end without a word.
  for (const args of [['dev'], ['build'], ['starters'], ['deploy', '--plan'], ['help'], ['mcp']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: scratch, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_NODE: '20.11.1' }, timeout: 20_000 });
    assert.equal(r.status, 1, `${args.join(' ')} exits 1`);
    assert.match(r.stderr, /^homie-studio: homie-studio needs Node\.js 22 or newer, and this is Node\.js 20\.11\.1\./, args.join(' '));
    assert.equal(r.stdout, '', 'nothing else was printed: no other file of the toolkit ran');
  }
  const asJson = spawnSync(process.execPath, [CLI, 'dev', '--json'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_NODE: '20.11.1' } });
  assert.equal(asJson.status, 1);
  assert.deepEqual([out(asJson).ok, out(asJson).needs], [false, 'node']);
  // This Node.js runs it as before.
  assert.equal(out(run(['version'], scratch)).ok, true);
});

/* ------------------------------------------------------------------ routes */

test('routes: the studio\'s own are told from a wildcard and a catch-all, and a config without routes is unchanged', () => {
  assert.equal(routeKind({ pattern: 'play.example.com', custom_domain: true }), 'custom-domain');
  assert.equal(routeKind({ pattern: 'play.example.com/*', zone_name: 'example.com' }), 'exact-host');
  assert.equal(routeKind({ pattern: '*example.com/*', zone_name: 'example.com' }), 'wildcard');
  assert.equal(routeKind({ pattern: '*.example.com/*' }), 'wildcard');
  assert.equal(routeKind({ pattern: '*/*', zone_name: 'example.com' }), 'catch-all');
  assert.ok(routeCovers({ pattern: '*example.com/*' }, 'play.example.com'));
  assert.ok(routeCovers({ pattern: '*/*' }, 'play.example.com'));
  assert.ok(!routeCovers({ pattern: 'other.example.com/*' }, 'play.example.com'));
  // Strings and the older single `route` are routes too.
  const sorted = sortRoutes({ routes: ['play.example.com/*', { pattern: '*/*', zone_name: 'example.com' }], route: { pattern: 'play.example.com', custom_domain: true } });
  assert.deepEqual(sorted.own.map((r) => r.pattern), ['play.example.com/*', 'play.example.com']);
  assert.deepEqual(sorted.wide.map((r) => r.pattern), ['*/*']);
  assert.deepEqual(exactRouteFor('Play.Example.com'), { pattern: 'play.example.com/*', zone_name: 'example.com' });
  const base = { worker: 'w', name: 'N', d1: 'w-db' };
  assert.equal(wranglerConfig({ ...base, routes: null }), wranglerConfig(base), 'no routes: byte for byte the config a studio always got');
  assert.doesNotMatch(wranglerConfig(base), /"routes"/);
  assert.deepEqual(JSON.parse(wranglerConfig({ ...base, routes: sorted.own }).replace(/^\s*\/\/.*$/gm, '')).routes, sorted.own);
});

test('deploy keeps the studio\'s custom-domain and exact-host routes: the rewritten wrangler.jsonc does not drop them', () => {
  const dir = studio('keeps-routes');
  const cf = account(dir);
  const routes = [{ pattern: 'play.example.com', custom_domain: true }, { pattern: 'play.example.com/*', zone_name: 'example.com' }];
  editConfig(dir, (c) => { c.routes = routes; });
  writeStudio(dir, { ...readStudio(dir), cloudflare: { ...readStudio(dir).cloudflare, domain: 'play.example.com' } });
  for (const n of [1, 2]) {
    const done = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(done.url, 'https://play.example.com');
    assert.deepEqual(done.routes, ['play.example.com', 'play.example.com/*']);
    assert.deepEqual(readConfig(dir).routes, routes, `deploy ${n}: the routes are in wrangler.jsonc exactly as written`);
    assert.deepEqual(JSON.parse(readFileSync(join(cf.state, 'deployed-config'), 'utf8').replace(/^\s*\/\/.*$/gm, '')).routes, routes, 'and in the config Wrangler deployed');
    assert.match(done.steps.map((s) => s.what).join('\n'), /kept the studio's own routes in wrangler\.jsonc: play\.example\.com, play\.example\.com\/\*/);
  }
  // The database id the deploy learned is in the same file: the routes rode along with a real rewrite.
  assert.ok(readConfig(dir).d1_databases[0].database_id);
});

test('a studio beneath a zone\'s wildcard Worker route: the deploy says which exact-host route is needed, touches no other route, and keeps the route once it is there', async () => {
  const dir = studio('beneath-wildcard');
  const cf = account(dir);
  writeStudio(dir, { ...readStudio(dir), cloudflare: { ...readStudio(dir).cloudflare, domain: 'play.example.com' } });
  editConfig(dir, (c) => { c.routes = [{ pattern: 'play.example.com', custom_domain: true }]; });
  // The zone already has "*example.com/*" on another Worker (a router for another site). It answers the studio's
  // hostname first, with its own "not found", until the studio has an exact-host route of its own.
  const zone = { exact: false, asked: [] };
  const fetchFn = async (url) => {
    zone.asked.push(String(url));
    if (!zone.exact) return new Response(JSON.stringify({ error: 'brand-not-found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ v: 1, name: 'Test Studio', claim: 'ab'.repeat(12), games: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const read = await readLiveSite('https://play.example.com', { fetchFn, tries: 1 });
  assert.deepEqual([read.state, read.status, read.said], ['other', 404, 'brand-not-found']);

  const shadowed = await deploy(dir, { homie: 'http://127.0.0.1:9', fetchFn });
  assert.equal(shadowed.ok, true, JSON.stringify(shadowed));
  assert.equal(shadowed.claim, false);
  const note = shadowed.notes.join('\n');
  assert.match(note, /https:\/\/play\.example\.com answered 404 \("brand-not-found"\), not as this studio/);
  assert.match(note, /another Worker's route on the same zone that covers it \(a wildcard like "\*example\.com\/\*", or a catch-all\)/);
  assert.match(note, /\{"pattern":"play\.example\.com\/\*","zone_name":"example\.com"\}/, 'the route that is needed, ready to paste');
  assert.match(note, /The studio does not touch that route/);
  assert.deepEqual(shadowed.steps.find((s) => s.route)?.route, { pattern: 'play.example.com/*', zone_name: 'example.com' });
  // The domain's routes are only ever read, and here they could not be (this stand-in Wrangler hands out no
  // sign-in): the deploy says that as unmeasured before it deploys, and changes no route.
  assert.deepEqual([...new Set(cf.calls().map((c) => c.split(' ')[0]))].sort(), ['auth', 'd1', 'deploy', 'versions', 'whoami']);
  assert.equal(shadowed.zone.state, 'unmeasured');
  assert.equal(zone.asked.some((u) => u.includes('api.cloudflare.com')), false, 'with no sign-in to read with, Cloudflare is asked nothing');
  assert.deepEqual(readConfig(dir).routes, [{ pattern: 'play.example.com', custom_domain: true }], 'the custom domain stayed; nothing was added by itself');

  // The owner adds the exact-host route. It is deployed, kept, and the studio answers on its own domain.
  editConfig(dir, (c) => { c.routes.push({ pattern: 'play.example.com/*', zone_name: 'example.com' }); });
  zone.exact = true;
  const fixed = await deploy(dir, { homie: 'http://127.0.0.1:9', fetchFn });
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  assert.equal(fixed.claim, true);
  assert.equal(fixed.notes, undefined);
  assert.deepEqual(readConfig(dir).routes.map((r) => r.pattern), ['play.example.com', 'play.example.com/*']);
  // With the exact route there and the domain still answering as something else, the advice is not "add a route".
  const still = shadowedDomain(readConfig(dir), 'play.example.com', { status: 404, said: 'brand-not-found' });
  assert.equal(still.shadowed, false);
  assert.match(still.why, /although wrangler\.jsonc has its exact-host route/);
});

test('a catch-all or wildcard route in the studio\'s config is never deployed: refused before Cloudflare is asked anything', () => {
  const dir = studio('catch-all');
  const cf = account(dir);
  editConfig(dir, (c) => { c.routes = [{ pattern: 'play.example.com', custom_domain: true }, { pattern: '*/*', zone_name: 'example.com' }]; });
  const before = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
  const refused = out(run(['deploy'], dir));
  assert.equal(refused.ok, false);
  assert.equal(refused.needs, 'cloudflare-routes');
  assert.deepEqual(refused.routes, ['*/*']);
  assert.match(refused.why, /a catch-all, which answers for EVERY hostname of the zone/);
  assert.match(refused.why, /another site on the same domain stops answering\), so nothing was deployed or changed on Cloudflare/);
  assert.match(refused.why, /Its own route \("play\.example\.com"\) stays/);
  assert.deepEqual(cf.calls(), [], 'not one Wrangler call');
  assert.equal(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), before, 'wrangler.jsonc is as the owner left it');
  assert.match(wideRouteRefusal({ routes: ['*example.com/*'] }).why, /a wildcard, which answers for more hostnames than the studio's own/);
  // The owner says the whole zone is the studio's: then it is theirs to deploy, and it is kept like any other.
  const whole = { cloudflare: { allowWildcardRoutes: true } };
  assert.equal(wideRouteRefusal(readConfig(dir), whole), null);
  assert.deepEqual(keptRoutes(dir, whole).map((r) => r.pattern), ['play.example.com', '*/*']);
  assert.deepEqual(keptRoutes(dir, {}).map((r) => r.pattern), ['play.example.com']);
  // A route another Worker already holds: Wrangler's refusal is said as what it is, never worked around.
  const said = explainCloudflare('Can\'t deploy routes that are assigned to another worker.\n"router" is already assigned to routes:\n  - play.example.com/*\n\nUnassign other workers from the routes you want to deploy to, and then try again.');
  assert.equal(said.needs, 'cloudflare-routes');
  assert.deepEqual(said.routes, ['play.example.com/*']);
  assert.match(said.why, /The studio never takes a route from another Worker/);
});

/* ------------------------------------------------------------------ one deploy at a time */

test('two deploys at once: the second is refused and changes nothing; a lock a killed deploy left is taken over', () => {
  const dir = studio('locks');
  const cf = account(dir);
  const first = lockDeploy(dir);
  assert.equal(first.ok, true);
  const rec = JSON.parse(readFileSync(join(dir, DEPLOY_LOCK), 'utf8'));
  assert.deepEqual([rec.pid, typeof rec.at, typeof rec.host], [process.pid, 'string', 'string'], 'the lock names its process and when it started');
  // This test process holds the lock: a deploy from the command line is another one.
  const refused = out(run(['deploy'], dir));
  assert.equal(refused.ok, false);
  assert.equal(refused.needs, 'deploy-running');
  assert.match(refused.why, new RegExp(`another deploy of this studio is already running \\(process ${process.pid}, started under a minute ago\\), so this one did not start and changed nothing`));
  assert.deepEqual(cf.calls(), [], 'the refused deploy asked Cloudflare nothing');
  assert.ok(existsSync(join(dir, DEPLOY_LOCK)), 'and left the other one\'s lock alone');
  assert.equal(lockDeploy(dir).ok, false);
  first.release();
  first.release();
  assert.ok(!existsSync(join(dir, DEPLOY_LOCK)), 'released');
  assert.equal(out(run(['deploy', '--plan'], dir)).ok, true, 'the plan needs no lock');

  // Stale: its process is gone (a deploy that was killed), it is torn, or it is older than any deploy can run.
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  writeFileSync(join(dir, DEPLOY_LOCK), `${JSON.stringify({ pid: gone, at: new Date().toISOString(), host: rec.host })}\n`);
  const after = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.ok(!existsSync(join(dir, DEPLOY_LOCK)), 'a finished deploy leaves no lock');
  writeFileSync(join(dir, DEPLOY_LOCK), '{"pid": 12');
  const torn = lockDeploy(dir);
  assert.equal(torn.ok, true, 'a torn lock is taken over');
  torn.release();
  const now = Date.now();
  assert.equal(lockHolds({ pid: process.pid, at: new Date(now - LOCK_MAX_AGE_MS - 1000).toISOString(), host: rec.host }, { now, host: rec.host }), false, 'too old to be a deploy: the id is someone else\'s by now');
  assert.equal(lockHolds({ pid: process.pid, at: new Date(now).toISOString(), host: rec.host }, { now, host: rec.host }), true);
  assert.equal(lockHolds({ pid: gone, at: new Date(now).toISOString(), host: 'another-computer' }, { now, host: rec.host }), true, 'a lock from another computer is judged by its age alone');
  // A deploy that fails lets go too.
  const failing = studio('locks-fail');
  account(failing, { deployOut: 'boom', deployCode: 1 });
  assert.equal(out(run(['deploy', '--homie', 'http://127.0.0.1:9'], failing)).ok, false);
  assert.ok(!existsSync(join(failing, DEPLOY_LOCK)));
});

/* ------------------------------------------------------------------ what changed, and the directory */

test('a deploy says which games changed with a content hash, and asks the directory to re-read a listed studio once when an older deploy offered a game\'s whole source', async () => {
  const dir = studio('hashes');
  const cf = account(dir);
  assert.equal(out(run(['game', 'new', 'crown-thief'], dir)).ok, true);
  assert.equal(out(run(['game', 'new', 'late-game'], dir)).ok, true);
  const first = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.games.map((g) => g.id), ['crown-thief', 'late-game']);
  for (const g of first.games) {
    assert.match(g.hash, /^[a-f0-9]{16}$/);
    // ACROSS THE SEAM: the deploy's hash is the build's, not a second recipe over the same folder. It is what the
    // build wrote in its report, what the built catalogue carries for the live site's manifest
    // (/.well-known/homie-studio.json games[].build.hash), and what `perf` names the build it measured by.
    assert.equal(g.hash, JSON.parse(readFileSync(join(dir, 'site', 'dist', '_site', 'build.json'), 'utf8')).games[g.id].hash, 'the hash in the build\'s own report');
    assert.equal(g.hash, JSON.parse(readFileSync(join(dir, 'site', 'dist', 'games.json'), 'utf8')).games.find((x) => x.id === g.id).built.hash, 'the hash the live manifest is made from');
    assert.equal(g.hash, gameDigest(join(dir, 'site', 'dist', 'games', g.id)));
    assert.equal(g.hash, buildDigest(dir, g.id), 'the hash a perf run names this build by');
    assert.equal(g.hash, gameHash(dir, g.id), 'and the fallback for a site built by an older toolkit is the same digest');
    assert.equal(g.change, 'first deploy from this computer');
    assert.ok(!('remix' in g), 'a deploy says nothing about remix: no game is offered whole');
  }
  assert.deepEqual(Object.keys(readLocal(dir).deployed.games), ['crown-thief', 'late-game'], 'what went live is recorded on this computer only');
  assert.doesNotMatch(readFileSync(join(dir, 'studio.json'), 'utf8'), /deployed/);
  const text = spawnSync(process.execPath, [CLI, 'deploy', '--homie', 'http://127.0.0.1:9'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
  // "Unchanged" is against the last DEPLOY from this computer (its own record), in the same words in the terminal's
  // result and in the steps; the build's own line beside it says "since the last build here".
  assert.match(text.stdout, new RegExp(`crown-thief: https://test-studio\\.acct\\.workers\\.dev/crown-thief/play {2}\\[unchanged since the last deploy from this computer, build ${first.games[0].hash}\\]`), 'the same build again: unchanged, the same hash');
  assert.match(text.stderr, new RegExp(`late-game: unchanged since the last deploy from this computer, build ${first.games[1].hash}`));
  assert.match(text.stderr, new RegExp(`late-game: unchanged since the last build here, build ${first.games[1].hash}`), 'the build names the same hash');
  assert.equal(readLocal(dir).deployed.hashes, 'build');

  // One game's code changes: that game is "changed" with a new hash; the other is untouched.
  const main = join(dir, 'games', 'crown-thief', 'src', 'main.ts');
  writeFileSync(main, `${readFileSync(main, 'utf8')}\nconsole.log('a change a player downloads');\n`);
  const changed = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.deepEqual(changed.games.map((g) => g.change), ['changed', 'unchanged']);
  assert.notEqual(changed.games[0].hash, first.games[0].hash);
  assert.equal(changed.games[1].hash, first.games[1].hash);

  for (const g of Object.values(readLocal(dir).deployed.games)) assert.deepEqual(Object.keys(g), ['hash'], 'the record keeps each game\'s hash and nothing about remix');

  // The deploy before came from a toolkit that still had remix: its record says late-game's source was open.
  // The studio is NOT listed from this computer: the directory is asked nothing.
  const asked = [];
  const fetchFn = async (url, init = {}) => {
    asked.push(`${init.method ?? 'GET'} ${url}`);
    if (String(url).endsWith('/api/studio/publish')) return new Response(JSON.stringify({ ok: true, studioPage: 'https://homie.test/studios/test-studio', games: [], remaining: 3, limit: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ v: 1, claim: 'cd'.repeat(12), games: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const olderRecord = () => { const was = readLocal(dir).deployed; writeLocal(dir, { deployed: { ...was, games: { ...was.games, 'crown-thief': { ...was.games['crown-thief'], remix: false }, 'late-game': { ...was.games['late-game'], remix: true } } } }); };
  olderRecord();
  const unlisted = await deploy(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(unlisted.ok, true, JSON.stringify(unlisted));
  assert.equal(unlisted.reread, undefined);
  assert.ok(!asked.some((a) => a.startsWith('POST')), 'a deploy never lists a studio: nothing was posted to the directory');
  assert.match(unlisted.steps.map((s) => s.what).join('\n'), /the source of late-game is no longer served \(games build on each other through parts now\); this computer has no record of listing the studio in the directory, so the directory was not asked anything \(a deploy never lists a studio\)/);
  assert.equal(listedHere(dir), null);

  // Listed from this computer (publish records it): the same deploy asks the directory to read the studio again.
  const listed = await publish(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.ok(listedHere(dir, { site: 'https://test-studio.acct.workers.dev', directory: 'https://homie.test' }));
  assert.equal(listedHere(dir, { directory: 'https://another.test' }), null, 'listed in one directory is not listed in another');
  asked.length = 0;
  olderRecord();
  const reread = await deploy(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(reread.ok, true, JSON.stringify(reread));
  assert.deepEqual(asked.filter((a) => a.startsWith('POST')), ['POST https://homie.test/api/studio/publish']);
  assert.deepEqual([reread.reread.ok, reread.reread.games], [true, ['late-game']]);
  assert.match(reread.steps.map((s) => s.what).join('\n'), /asked the directory to read the studio again: it still offered the source of late-game, and no game's source is served whole any more \(Publishes left today: 3 of 5\.\)/);
  // Once: the record that deploy wrote has no such field, so no re-read, however often it deploys.
  asked.length = 0;
  const quiet = await deploy(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(quiet.reread, undefined);
  assert.ok(!asked.some((a) => a.startsWith('POST')));
  assert.ok(cf.calls().filter((c) => c.startsWith('deploy')).length >= 6);
  // A record from before deploys read the build's hash holds another recipe's hashes: it is read as no record, so
  // the next deploy says "first deploy from this computer" instead of calling every game changed.
  writeLocal(dir, { deployed: { at: new Date().toISOString(), games: { 'crown-thief': { hash: 'abcdef012345', remix: true } } } });
  assert.equal(lastDeploy(dir), null);
  assert.deepEqual([deployWords({ hash: 'ab12', change: 'changed' }), deployWords({ hash: 'ab12', change: 'new' }), deployWords({ hash: 'ab12' })], ['changed since the last deploy from this computer, build ab12', 'new since the last deploy from this computer, build ab12', 'built, build ab12']);
  // compareDeploy on its own: a game that left the build, and one that was never deployed from here.
  const d = compareDeploy({ a: { hash: 'h1' }, c: { hash: 'h3' } }, { games: { a: { hash: 'h0', remix: false }, b: { hash: 'h2', remix: true } } });
  assert.deepEqual(d.games.map((g) => [g.id, g.change]), [['a', 'changed'], ['c', 'new']]);
  assert.deepEqual([d.removed, d.withdrawn, d.first], [['b'], ['b'], false]);
  assert.deepEqual(compareDeploy({ a: { hash: 'h1' } }, { games: { a: { hash: 'h1' } } }).withdrawn, [], 'a record this toolkit wrote withdraws nothing');
});

/* ------------------------------------------------------------------ publish: how many are left */

test('publish says how many publishes are left: before from what this computer knows, after from the directory\'s own answer', async () => {
  // Wherever the directory puts the number.
  assert.deepEqual(quotaOf({ ok: true, remaining: 2, limit: 5 }), { remaining: 2, limit: 5, resetsAt: null, retryAfter: null });
  assert.equal(quotaOf({ quota: { left: 0, perDay: 5, resetsAt: '2026-10-07T00:00:00.000Z' } }).resetsAt, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(quotaOf({ quota: { left: 0, perDay: 5 } }).remaining, 0);
  const h = new Headers({ 'x-ratelimit-remaining': '4', 'x-ratelimit-limit': '5', 'retry-after': '3600' });
  assert.deepEqual(quotaOf({}, h), { remaining: 4, limit: 5, resetsAt: null, retryAfter: 3600 });
  assert.deepEqual(quotaOf(null), { remaining: null, limit: null, resetsAt: null, retryAfter: null });
  assert.equal(quotaLine({ remaining: 2, limit: 5, resetsAt: null, retryAfter: null }), 'Publishes left today: 2 of 5.');
  assert.match(quotaLine({ remaining: null, limit: null, resetsAt: null, retryAfter: null }, { sentToday: 3 }), /^This computer has sent 3 publishes today \(UTC\); the directory has a daily cap in the beta and did not say how many are left\.$/);
  assert.ok(isPublishCap({ ok: false, status: 429 }));
  assert.ok(isPublishCap({ ok: false, status: 200, body: { message: 'The daily publish limit for the beta was reached.' } }));
  assert.ok(!isPublishCap({ ok: false, status: 400, body: { message: 'this site does not serve its claim' } }));

  const dir = studio('publishes');
  writeLocal(dir, { url: 'https://test-studio.acct.workers.dev' });
  let answer = () => new Response(JSON.stringify({ ok: true, studioPage: 'https://homie.test/studios/test-studio', games: [{ name: 'Crown Thief', play: 'https://test-studio.acct.workers.dev/crown-thief/play' }], remaining: 2, limit: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
  const said = [];
  const fetchFn = async () => answer();
  assert.match(beforeLine(publishesSoFar(dir)), /^Publishing to the directory: publish 1 from this computer today \(UTC\)\. The beta has a daily cap/);
  const one = await publish(dir, { homie: 'https://homie.test', fetchFn, log: (l) => said.push(l) });
  assert.equal(one.ok, true, JSON.stringify(one));
  assert.match(said[0], /publish 1 from this computer today/, 'said before it is sent');
  assert.deepEqual([one.publishes.remaining, one.publishes.limit, one.publishes.sentToday, one.publishes.line], [2, 5, 1, 'Publishes left today: 2 of 5.']);
  assert.deepEqual(publishesSoFar(dir), { day: new Date().toISOString().slice(0, 10), sent: 1, remaining: 2, limit: 5 });
  assert.equal(beforeLine(publishesSoFar(dir)), 'Publishing to the directory: it said 2 publishes were left today after the last one (of 5 a day).');
  assert.equal(publishesSoFar(dir, Date.now() + 2 * 86_400_000).sent, 0, 'another day starts from nothing');

  // The directory gives no number: say what this computer sent, and that the number was not given. Never a guess.
  answer = () => new Response(JSON.stringify({ ok: true, studioPage: 'https://homie.test/studios/test-studio', games: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const two = await publish(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(two.publishes.remaining, null);
  assert.match(two.publishes.line, /^This computer has sent 2 publishes today \(UTC\), of the 5 a day the directory allows\.$/);

  // The cap: said as the cap, with when it ends, never as a broken studio.
  answer = () => new Response(JSON.stringify({ ok: false, error: 'rate-limited', message: 'This studio reached today\'s publish limit for the beta.' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7200' } });
  const capped = await publish(dir, { homie: 'https://homie.test', fetchFn });
  assert.equal(capped.ok, false);
  assert.equal(capped.needs, 'publish-cap');
  assert.match(capped.why, /^This studio reached today's publish limit for the beta\.\nThe directory's daily publish cap for the beta is used up \(5 a day\)\. Try again in 120 min\. Nothing is wrong with the studio/);
  assert.match(beforeLine(publishesSoFar(dir)), /it said none were left today after the last one \(of 5 a day\), so this one may be refused until 00:00 UTC/);
  // A publish that never reached the directory is not counted against the day.
  const sent = publishesSoFar(dir).sent;
  const offline = await publish(dir, { homie: 'https://homie.test', fetchFn: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND homie.test'), { code: 'ENOTFOUND' }) }); } });
  assert.equal(offline.ok, false);
  assert.equal(publishesSoFar(dir).sent, sent);
});

test('publish from the command line and the MCP tool: the count is in what a person reads', async (t) => {
  const dir = studio('publish-cli');
  writeLocal(dir, { url: 'https://test-studio.acct.workers.dev' });
  // A directory on this computer.
  const posts = [];
  const reads = [];
  const directory = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      // The directory's read-only count (GET): whether the site is listed and how many publishes are left.
      if (req.method === 'GET') {
        reads.push(`GET ${req.url}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, site: 'https://test-studio.acct.workers.dev', listed: posts.length > 0, limit: 4, remaining: 4 - posts.length, resetsAt: '2026-10-07T00:00:00.000Z' }));
        return;
      }
      posts.push(`${req.method} ${req.url} ${body}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, studioPage: 'http://127.0.0.1/studios/test-studio', games: [{ name: 'Crown Thief', play: 'https://test-studio.acct.workers.dev/crown-thief/play' }], remaining: 4 - posts.length, limit: 4 }));
    });
  });
  await new Promise((r) => directory.listen(0, '127.0.0.1', r));
  t.after(() => directory.close());
  const homie = `http://127.0.0.1:${directory.address().port}`;
  writeStudio(dir, { ...readStudio(dir), homie: { directory: homie } });
  // Not spawnSync: the directory above lives in this process, which must stay free to answer.
  const runCli = (args) => new Promise((done) => {
    const c = spawn(process.execPath, [CLI, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = { stdout: '', stderr: '', status: null };
    c.stdout.on('data', (d) => { r.stdout += d; });
    c.stderr.on('data', (d) => { r.stderr += d; });
    c.on('close', (code) => done({ ...r, status: code }));
  });
  // `publish --before` is a preflight: it asks the directory with a read and publishes NOTHING. (0.31.0 did not
  // know the flag, read the command as `publish`, and listed the studio.) No POST, and no file written here.
  const localBefore = JSON.stringify(readLocal(dir));
  const pre = await runCli(['publish', '--before']);
  assert.equal(pre.status, 0, pre.stdout + pre.stderr);
  assert.equal(pre.stdout, 'Not published. The directory says: this site is not listed yet; publishes left today: 4 of 4. It resets at 2026-10-07T00:00:00.000Z.\n');
  assert.deepEqual(posts, [], 'publish --before sent no POST at all');
  assert.deepEqual(reads, [`GET /api/studio/publish?site=${encodeURIComponent('https://test-studio.acct.workers.dev')}`], 'one read, of the directory\'s count for this site');
  assert.equal(JSON.stringify(readLocal(dir)), localBefore, 'and wrote nothing on this computer: no count, no "listed"');
  const preJson = out(await runCli(['publish', '--before', '--json']));
  assert.deepEqual([preJson.ok, preJson.command, preJson.published, preJson.listed, preJson.publishes.remaining, preJson.publishes.limit, preJson.publishes.from], [true, 'publish before', false, false, 4, 4, 'directory']);
  assert.deepEqual(posts, []);
  // A directory that cannot be reached is said as that, with what this computer knows; still nothing is sent.
  const asked = [];
  const down = await publishBefore(dir, { homie: 'https://homie.test', fetchFn: async (url, init) => { asked.push(`${init?.method ?? 'GET'} ${url}`); throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  assert.deepEqual(asked, [`GET https://homie.test/api/studio/publish?site=${encodeURIComponent('https://test-studio.acct.workers.dev')}`]);
  assert.deepEqual([down.ok, down.published, down.publishes.from, down.publishes.remaining], [true, false, 'this computer', null]);
  assert.match(down.publishes.line, /^Not published\. The directory could not be asked how many publishes are left \(.+\), so this is only what this computer knows: this computer has sent 0 publishes today \(UTC\); a publish from another computer or from the Homie connector is not counted here\.$/);
  // An older directory with no such read answers an error: said the same way, never as a count.
  const old = await publishBefore(dir, { homie: 'https://homie.test', fetchFn: async () => new Response(JSON.stringify({ ok: false, message: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } }) });
  assert.deepEqual([old.publishes.from, old.unreached.status], ['this computer', 405]);
  assert.match(old.publishes.line, /could not be asked how many publishes are left \(method not allowed\)/);
  // A flag publish does not know stops it before anything is sent.
  const strange = await runCli(['publish', '--preflight', '--json']);
  assert.equal(strange.status, 1);
  assert.deepEqual([out(strange).ok, out(strange).needs, out(strange).flags], [false, 'flag', ['preflight']]);
  assert.deepEqual(posts, [], 'an unknown flag is never read as a plain publish');
  reads.length = 0;

  const cli = await runCli(['publish']);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /Publishing to the directory: publish 1 from this computer today \(UTC\)/, 'before');
  assert.match(cli.stdout, /Listed in the directory: .*\n {2}Crown Thief: .*\nPublishes left today: 3 of 4\./, 'after');
  assert.deepEqual(posts, ['POST /api/studio/publish {"site":"https://test-studio.acct.workers.dev"}']);

  // The MCP tool, spoken to as a host does.
  const child = spawn(process.execPath, [CLI, 'mcp', '--studios', scratch, '--no-install'], { cwd: scratch, env: { ...process.env, HOME: scratch, HOMIE_MCP_WAIT_MS: '20000' }, stdio: ['pipe', 'pipe', 'pipe'] });
  started.push(child);
  let buf = ''; let seq = 0; const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue; const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); }
  });
  const request = (method, params) => new Promise((done, fail) => { const id = ++seq; waiting.set(id, done); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); setTimeout(() => waiting.has(id) && fail(new Error(`no answer to ${method}`)), 40_000); });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const call = async (name, args) => (await request('tools/call', { name, arguments: { studio: 'publish-cli', ...args } })).result;
  const before = await call('studio_publish', { before: true });
  assert.match(before.content[0].text, /^Not published\. The directory says: this site is listed; publishes left today: 3 of 4\. It resets at 2026-10-07T00:00:00\.000Z\.$/);
  assert.deepEqual([before.structuredContent.kind, before.structuredContent.published, before.structuredContent.sent, before.structuredContent.publishes.remaining, before.structuredContent.publishes.from], ['publish-count', false, 1, 3, 'directory']);
  assert.equal(posts.length, 1, 'before: true sent no POST: the one on record is the publish above');
  assert.deepEqual(reads, [`GET /api/studio/publish?site=${encodeURIComponent('https://test-studio.acct.workers.dev')}`], 'the tool asks the same read the terminal does');
  const after = await call('studio_publish', {});
  assert.notEqual(after.isError, true, JSON.stringify(after));
  assert.match(after.content[0].text, /Listed: .*\n {2}Crown Thief: .*\nPublishes left today: 2 of 4\./);
  assert.deepEqual([after.structuredContent.publishes.remaining, after.structuredContent.publishes.sentToday], [2, 2]);
  child.stdin.end();
});

/* ------------------------------------------------------------------ a flag a command does not know */

test('a command that changes something outside this computer stops at a flag it does not know: nothing is sent', async (t) => {
  const dir = studio('strange-flags');
  const cf = account(dir);
  // Everything such a command could reach is watched: Cloudflare (the stand-in Wrangler), and one server on this
  // computer that is the studio's live site, its back office and its directory at once.
  const heard = [];
  const server = createServer((req, res) => { heard.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const here = `http://127.0.0.1:${server.address().port}`;
  writeStudio(dir, { ...readStudio(dir), homie: { directory: here } });
  writeLocal(dir, { url: here });
  const files = () => JSON.stringify([readFileSync(join(dir, 'studio.json'), 'utf8'), readLocal(dir), existsSync(join(dir, 'wrangler.jsonc')) ? readFileSync(join(dir, 'wrangler.jsonc'), 'utf8') : null]);
  const before = files();
  const ask = (args) => new Promise((done) => {
    const c = spawn(process.execPath, [CLI, ...args, '--json'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => done({ status, stdout }));
  });
  // Each command with the words it would need to run for real, and one invented flag.
  const commands = {
    publish: [], deploy: [], 'storage add': [], 'media put': ['notes.txt'], 'media move': [], 'setup attach': ['hs_made_up'], handoff: ['hb_made_up'],
    'players owner': [], 'stats key': [], 'stats link': [], 'stats revoke': [], 'stats share': ['off'],
    'office link': [], 'office key': [], 'office announce': ['back', 'soon'], 'office invite': ['crown-thief'], 'office launch': ['crown-thief', 'public'],
    'office kick': ['crown-thief', 'room-1', 'p1'], 'office mute': ['crown-thief', 'room-1', 'p1'], 'office close': ['crown-thief', 'room-1'], 'office revoke': [],
    'lounge mod': ['someone'], 'lounge remove': ['m1'], 'chat remove': ['crown-thief', 'room-1', 'm1'], 'chat budget': ['200'],
    'servers close': ['crown-thief', 'main'], 'servers level': ['crown-thief', 'main', 'two'], 'servers member': ['crown-thief', 'main', 'someone'],
    'shop connect': [], 'shop disconnect': [], 'shop refund': ['order-1'], 'shop statements': [],
    'agents pass': ['crown-thief'], 'agents revoke': ['pass-1'], 'agents brain': ['crown-thief', 'main', 'workers-ai'], 'agents sit': ['crown-thief'],
    // With --device it adds a phone to the person's Apple team and installs a game on it (0.32.1).
    'standalone run': ['crown-thief', '--for', 'ios', '--device'],
  };
  // The table in the command itself: every command in it is tried here, and none is tried that is not in it.
  const table = /const OUTWARD_FLAGS = \{([\s\S]*?)\n\};/.exec(readFileSync(CLI, 'utf8'))[1];
  const keys = [...table.matchAll(/(?:^|[\s,{])(?:'([a-z]+(?: [a-z]+)?)'|([a-z]+)): \[/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(keys.slice().sort(), Object.keys(commands).sort());
  for (const [key, words] of Object.entries(commands)) {
    const r = await ask([...key.split(' '), ...words, '--made-up-flag']);
    assert.equal(r.status, 1, `${key} exits 1`);
    const answer = JSON.parse(r.stdout);
    assert.deepEqual([answer.ok, answer.command, answer.needs, answer.flags], [false, key, 'flag', ['made-up-flag']], key);
    assert.match(answer.why, new RegExp(`^homie-studio ${key} does not take --made-up-flag, so it did not run: nothing was sent or changed\\.`), key);
    assert.match(answer.why, /It takes: (--[a-z-]+(, --[a-z-]+)*|no flags of its own) \(and --json\)\.$/, key);
    assert.deepEqual(cf.calls(), [], `${key}: Wrangler was not run`);
    assert.deepEqual(heard, [], `${key}: no request left this command`);
    assert.equal(files(), before, `${key}: no file of the studio changed`);
  }
  // A flag of another command is as unknown as an invented one: `deploy --dry-run` is not a dry run, so it is not a deploy.
  const dry = JSON.parse((await ask(['deploy', '--dry-run'])).stdout);
  assert.deepEqual([dry.ok, dry.needs, dry.flags], [false, 'flag', ['dry-run']]);
  assert.deepEqual(cf.calls(), []);
  // The flags a command does take still run it (here as far as the sign-in the stand-in account has).
  assert.equal(JSON.parse((await ask(['deploy', '--plan'])).stdout).command, 'deploy plan');
  assert.equal(JSON.parse((await ask(['publish', '--before', '--site', here])).stdout).published, false);
  assert.deepEqual(heard, [`GET /api/studio/publish?site=${encodeURIComponent(here)}`], 'and the one request was a read');
  // A command that only reads keeps ignoring a flag it does not know.
  assert.equal(JSON.parse((await ask(['storage', '--made-up-flag'])).stdout).ok, true);
});

/* ------------------------------------------------------------------ local dev */

/**
 * A stand-in for Wrangler's local runtime, faithful where it matters here:
 *   - like Wrangler, a route (or dev.host) in the config it is GIVEN makes the local Worker answer as that hostname,
 *     so the game page hands out a room socket there;
 *   - it reads the built catalogue once, at its start, and answers 404 for a game built later (a watch that did not
 *     follow a rebuild), until it is restarted;
 *   - it prints a room socket opening and a connection-loss error with no time on them.
 */
function localRuntime(dir) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  const script = join(state, 'fake-wrangler.mjs');
  writeFileSync(script, `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
const S = ${JSON.stringify(state)};
const a = process.argv.slice(2);
appendFileSync(join(S, 'calls'), a.join(' ') + '\\n');
if (a[0] !== 'dev') process.exit(0);
const port = Number(a[a.indexOf('--port') + 1]);
const file = a.includes('--config') ? a[a.indexOf('--config') + 1] : join(process.cwd(), 'wrangler.jsonc');
const cfg = JSON.parse(readFileSync(file, 'utf8').replace(/^\\s*\\/\\/.*$/gm, ''));
writeFileSync(join(S, 'dev-config.json'), JSON.stringify(cfg));
const route = (cfg.routes ?? [])[0];
const host = cfg.dev?.host ?? (route ? String(route.pattern ?? route).split('/')[0] : '127.0.0.1:' + port);
const ids = JSON.parse(readFileSync(join(resolve(dirname(file), cfg.assets.directory), 'games.json'), 'utf8')).games.map((g) => g.id);
createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const [, id, sub] = u.pathname.split('/');
  if (u.pathname === '/api/games') { res.end('{"ok":true}'); return; }
  if (!ids.includes(id)) { res.statusCode = 404; res.end('not found'); return; }
  if (sub === '__game') { res.end('<html><head><script>window.HOMIE_NET=' + JSON.stringify({ v: 1, url: (host.startsWith('127.') ? 'ws' : 'wss') + '://' + host + '/' + id + '/__net?room=' + u.searchParams.get('room'), room: 'r' }) + '</script></head></html>'); return; }
  res.end('play');
}).listen(port, '127.0.0.1', () => {
  console.log('[wrangler:info] Ready on http://127.0.0.1:' + port);
  console.log('[wrangler:info] GET /' + (ids[0] ?? 'x') + '/__net 101 Switching Protocols (2ms)');
  console.error('Uncaught Error: Network connection lost.');
});
process.on('SIGTERM', () => process.exit(0));
`);
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  return { state, config: () => JSON.parse(readFileSync(join(state, 'dev-config.json'), 'utf8')), calls: () => readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') };
}

/** `homie-studio dev` as a background task, with what it printed. */
function startDev(dir, port, extra = []) {
  const child = spawn(process.execPath, [CLI, 'dev', '--port', String(port), '--no-local-ai', ...extra], { cwd: dir, env: { ...process.env, HOMIE_STUDIO_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  started.push(child);
  const io = { out: '', err: '', code: undefined };
  child.stdout.on('data', (d) => { io.out += d; });
  child.stderr.on('data', (d) => { io.err += d; });
  child.on('close', (code) => { io.code = code; });
  return { child, io };
}

test('local dev with a custom-domain route in wrangler.jsonc: the route never reaches the local runtime, and rooms are local, port included', async () => {
  const dir = studio('dev-routes');
  const rt = localRuntime(dir);
  assert.equal(out(run(['game', 'new', 'crown-thief'], dir)).ok, true);
  // A fresh studio runs from its own wrangler.jsonc, as it always did.
  assert.deepEqual(devConfig(dir, false), { args: [], note: null, stripped: [] });
  // The studio is live on its own domain: a custom domain and the exact-host route its zone needed.
  const routes = [{ pattern: 'play.example.com', custom_domain: true }, { pattern: 'play.example.com/*', zone_name: 'example.com' }];
  editConfig(dir, (c) => { c.routes = routes; });
  const before = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
  const local = devConfig(dir, false);
  assert.deepEqual(local.stripped, ['play.example.com', 'play.example.com/*']);
  assert.match(local.note, /Local dev leaves out the production routes in wrangler\.jsonc \(play\.example\.com, play\.example\.com\/\*\): rooms here use this computer's own address/);
  assert.equal(local.args[0], '--config');
  const copy = JSON.parse(readFileSync(local.copy, 'utf8'));
  for (const k of ['routes', 'route', 'zone_id', 'zone_name']) assert.ok(!(k in copy), `${k} is not in the local config`);
  assert.equal(copy.name, readConfig(dir).name);

  const port = await freePort();
  const { child, io } = startDev(dir, port);
  const up = await until(() => /Rooms here are local/.test(io.err) || io.code !== undefined, 60_000);
  assert.ok(up && io.code === undefined, `dev is up: ${io.err}`);
  assert.match(io.err, new RegExp(`Rooms here are local: games open their room sockets at ws://127\\.0\\.0\\.1:${port}\\.`));
  assert.ok(!('routes' in rt.config()), 'the config Wrangler ran had no route');
  assert.equal(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), before, 'wrangler.jsonc itself is unchanged: the production routes are still there for deploy');
  // What a browser on this computer is handed: this computer's address, with its port.
  const page = await (await fetch(`http://127.0.0.1:${port}/crown-thief/__game/?room=two-tabs`)).text();
  assert.equal(new URL(socketUrlIn(page)).host, `127.0.0.1:${port}`);
  assert.equal(await socketOriginProblem(`http://127.0.0.1:${port}`, 'crown-thief'), null);

  // The registration file: what `dev --stop` and the MCP tools read.
  const rec = JSON.parse(readFileSync(devFile(dir), 'utf8'));
  assert.deepEqual([rec.pid, rec.port, Number.isInteger(rec.child), Number.isNaN(Date.parse(rec.at))], [child.pid, port, true, false]);
  assert.equal(devState(dir).state, 'running');
  // A second dev of the same studio is refused, and says where the first one is.
  const again = out(run(['dev', '--port', String(port + 1)], dir));
  assert.equal(again.ok, false);
  assert.equal(again.already, true);
  assert.match(again.why, new RegExp(`this studio's dev server is already running at http://127\\.0\\.0\\.1:${port}/ .*dev --stop`));

  // Room lines carry a time; other lines are as Wrangler printed them.
  assert.match(io.out, /^\[\d\d:\d\d:\d\d\.\d{3}\] \[wrangler:info\] GET \/crown-thief\/__net 101 Switching Protocols/m);
  assert.match(io.out, /^\[wrangler:info\] Ready on/m);
  assert.match(io.err, /^\[\d\d:\d\d:\d\d\.\d{3}\] Uncaught Error: Network connection lost\.\n {2}\(homie dev: the local runtime prints "Network connection lost" when a connection to a room ends abruptly/m);

  const stopped = out(run(['dev', '--stop'], dir));
  assert.deepEqual(stopped.stopped.sort(), [rec.child, rec.pid].sort());
  assert.ok(await until(() => io.code !== undefined, 10_000), 'dev ended');
  assert.ok(!existsSync(devFile(dir)));
  assert.equal(devState(dir).state, 'none');
});

test('a hostname forced on local dev is caught: the injected room socket must match the local origin, port included', async () => {
  // The page says a production socket: the check says so, with both addresses.
  const prod = async () => new Response('<html><head><script>window.HOMIE_NET={"v":1,"url":"wss://play.example.com/crown-thief/__net?room=r","room":"r"}</script></head></html>');
  const bad = await socketOriginProblem('http://127.0.0.1:8787', 'crown-thief', { fetchFn: prod });
  assert.deepEqual([bad.socket, bad.expected], ['wss://play.example.com', 'ws://127.0.0.1:8787']);
  assert.match(bad.why, /local rooms are not local: .* hands the game a room socket at wss:\/\/play\.example\.com, not at this computer's 127\.0\.0\.1:8787/);
  // The right host without its port is not right either.
  const noPort = async () => new Response('<script>window.HOMIE_NET={"url":"ws://127.0.0.1/crown-thief/__net?room=r"}</script>');
  assert.equal((await socketOriginProblem('http://127.0.0.1:8787', 'crown-thief', { fetchFn: noPort })).socket, 'ws://127.0.0.1');
  const fine = async () => new Response('<script>window.HOMIE_NET={"url":"ws://127.0.0.1:8787/crown-thief/__net?room=r"}</script>');
  assert.equal(await socketOriginProblem('http://127.0.0.1:8787', 'crown-thief', { fetchFn: fine }), null);
  assert.equal(await socketOriginProblem('http://127.0.0.1:8787', 'crown-thief', { fetchFn: async () => new Response('closed', { status: 403 }) }), null, 'a game behind a door is not judged');

  // End to end: the owner's config forces a host on local dev. dev stops and says why, instead of running wrong.
  const dir = studio('dev-host');
  localRuntime(dir);
  assert.equal(out(run(['game', 'new', 'crown-thief'], dir)).ok, true);
  editConfig(dir, (c) => { c.dev = { host: 'play.example.com' }; });
  const port = await freePort();
  const { io } = startDev(dir, port);
  assert.ok(await until(() => io.code !== undefined, 60_000), `dev ended: ${io.err}`);
  assert.equal(io.code, 1);
  assert.match(io.out, /homie-studio: local rooms are not local: .*room socket at wss:\/\/play\.example\.com.*The dev server was stopped/);
  assert.ok(!existsSync(devFile(dir)), 'and left no record behind');
});

test('stale dev state heals itself: a record whose server was stopped another way, a leftover runtime on the port, and somebody else\'s port', async (t) => {
  const dir = studio('dev-stale');
  localRuntime(dir);
  assert.equal(out(run(['game', 'new', 'crown-thief'], dir)).ok, true);
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  const port = await freePort();
  const record = (rec) => { mkdirSync(dirname(devFile(dir)), { recursive: true }); writeFileSync(devFile(dir), `${JSON.stringify(rec)}\n`); };

  // 1. The server was killed some other way: its record is still there, its processes are not.
  record({ pid: gone, child: gone, port, at: new Date().toISOString() });
  assert.equal(devState(dir).state, 'stale');
  const stale = out(run(['dev', '--stop'], dir));
  assert.deepEqual([stale.ok, stale.stopped, stale.stale], [true, [], true]);
  assert.match(stale.why, /its record was stale \(the server had been stopped another way\) and was removed/);
  assert.ok(!existsSync(devFile(dir)));
  assert.match(out(run(['dev', '--stop'], dir)).why, /no dev server of this studio is running/);

  // 2. A record that names a live process that is not this studio's (a recycled id): never signalled.
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: scratch, stdio: 'ignore' });
  started.push(stranger);
  record({ pid: stranger.pid, port, at: new Date().toISOString() });
  const left = out(run(['dev', '--stop'], dir));
  assert.deepEqual(left.stopped, []);
  assert.match(left.why, new RegExp(`process ${stranger.pid} named in the record is running but is not this studio's`));
  assert.equal(stranger.exitCode, null, 'the other process is still running');
  stranger.kill('SIGKILL');

  // 3. A wrapper script of the studio's own that registered itself: started from the studio's folder, so it counts.
  const wrapper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, stdio: 'ignore' });
  started.push(wrapper);
  record({ pid: wrapper.pid, port, at: new Date().toISOString() });
  if (devState(dir).state !== 'running') t.diagnostic('this computer cannot read a process\'s working directory (no /proc, no lsof): the wrapper case is not judged here');
  else {
    const stoppedWrapper = out(run(['dev', '--stop'], dir));
    assert.deepEqual(stoppedWrapper.stopped, [wrapper.pid], 'a wrapper that wrote the registration file is stopped by dev --stop');
    assert.ok(await until(() => wrapper.exitCode !== null || wrapper.signalCode !== null, 10_000));
  }
  wrapper.kill('SIGKILL');
  rmSync(devFile(dir), { force: true });

  // 4. A runtime of this studio left listening on the port (its dev server was killed by process id): `dev` clears
  //    it and starts; a port held by another program is named and left alone.
  const listen = (cwd, p) => { const c = spawn(process.execPath, ['-e', `require('node:http').createServer((q, s) => s.end('left')).listen(${p}, '127.0.0.1')`], { cwd, stdio: 'ignore' }); started.push(c); return c; };
  const leftover = listen(dir, port);
  assert.ok(await until(async () => (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false))));
  if (!listenersOn(port).includes(leftover.pid)) t.diagnostic('this computer cannot say which process listens on a port (no lsof, no ss): the leftover case is not judged here');
  else {
    record({ pid: gone, child: gone, port, at: new Date().toISOString() });
    const { io } = startDev(dir, port);
    assert.ok(await until(() => /Rooms here are local/.test(io.err) || io.code !== undefined, 60_000), io.err);
    assert.equal(io.code, undefined, `dev started on the port it cleared: ${io.err}${io.out}`);
    assert.match(io.err, /Cleared a stale dev record \(its server had been stopped another way\)\./);
    assert.match(io.err, new RegExp(`Stopped a leftover local runtime of this studio on port ${port} \\(process ${leftover.pid}\\)`));
    assert.equal(out(run(['dev', '--stop'], dir)).stopped.length, 2);
    assert.ok(await until(() => io.code !== undefined, 10_000));
  }
  leftover.kill('SIGKILL');
  const other = await freePort();
  const theirs = listen(scratch, other);
  assert.ok(await until(async () => (await fetch(`http://127.0.0.1:${other}/`).then((r) => r.ok).catch(() => false))));
  const busy = out(run(['dev', '--port', String(other)], dir));
  assert.equal(busy.ok, false);
  assert.equal(busy.needs, 'port');
  assert.match(busy.why, new RegExp(`port ${other} is already in use by another program.*it is not this studio's dev server, so nothing was stopped or started\\. Use another port: .*--port ${other + 1}`));
  assert.equal(theirs.exitCode, null, 'the other program still has its port');
  theirs.kill('SIGKILL');
});

test('a game added while dev runs: named while it is not built, and picked up once it is, without a hand restart', async () => {
  const dir = studio('dev-new-game');
  const rt = localRuntime(dir);
  assert.equal(out(run(['game', 'new', 'crown-thief'], dir)).ok, true);
  const port = await freePort();
  const { io } = startDev(dir, port);
  assert.ok(await until(() => /Rooms here are local/.test(io.err) || io.code !== undefined, 60_000) && io.code === undefined, io.err);
  const play = async () => (await fetch(`http://127.0.0.1:${port}/late-game/play`)).status;
  assert.equal(out(run(['game', 'new', 'late-game'], dir)).ok, true);
  assert.equal(await play(), 404, 'not built yet: the running site does not have it');
  assert.ok(await until(() => /games\/late-game is new and not built yet, so .*\/late-game\/play is a 404 for now\. Build it \(npx --no-install homie-studio build\)/.test(io.err), 15_000), io.err);
  assert.equal(out(run(['build'], dir)).ok, true);
  // The stand-in runtime read its catalogue once, as a watch that missed the rebuild would: dev restarts it.
  assert.ok(await until(() => /New game late-game is built but the running site answers 404 for it: restarting the local site to pick it up/.test(io.err), 30_000), io.err);
  assert.ok(await until(async () => (await play().catch(() => 0)) === 200, 30_000), 'the new game is served, on the same address');
  assert.ok(await until(() => /New game late-game is served here/.test(io.err), 15_000));
  assert.equal(io.code, undefined, 'the dev command itself never stopped');
  assert.equal(rt.calls().filter((c) => c.startsWith('dev ')).length, 2, 'one restart, no more');
  assert.equal(JSON.parse(readFileSync(devFile(dir), 'utf8')).port, port);
  assert.equal(out(run(['dev', '--stop'], dir)).stopped.length, 2);
  assert.ok(await until(() => io.code !== undefined, 10_000));
});

test('relay lines: a time on room sockets and errors, what a connection loss can mean said once, every line with --timestamps', () => {
  const at = new Date(2026, 9, 6, 9, 5, 7, 42);
  const state = {};
  assert.deepEqual(relayLines('[wrangler:info] GET /crown-thief/__net 101 Switching Protocols (2ms)', { at, state }), ['[09:05:07.042] [wrangler:info] GET /crown-thief/__net 101 Switching Protocols (2ms)']);
  assert.deepEqual(relayLines('[wrangler:info] GET /crown-thief/play 200 OK (4ms)', { at, state }), ['[wrangler:info] GET /crown-thief/play 200 OK (4ms)'], 'an ordinary line is as Wrangler printed it');
  assert.deepEqual(relayLines('\u001b[31mUncaught Error: Network connection lost.\u001b[0m', { at, state }), ['[09:05:07.042] \u001b[31mUncaught Error: Network connection lost.\u001b[0m', LOST_HINT]);
  assert.deepEqual(relayLines('Uncaught Error: Network connection lost.', { at, state }), ['[09:05:07.042] Uncaught Error: Network connection lost.'], 'the explanation is said once');
  assert.match(LOST_HINT, /It prints the same for a room operation that really failed/, 'never called harmless');
  assert.deepEqual(relayLines('', { at, all: true }), ['']);
  assert.deepEqual(relayLines('anything', { at, all: true }), ['[09:05:07.042] anything']);
});

/* ------------------------------------------------------------------ this computer's network */

test('a name Node.js cannot look up is a network preflight failure with local testing offered, never a game failure', async () => {
  const lookup = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND play.example.com'), { code: 'ENOTFOUND' }) });
  assert.equal(whyFailed(lookup(), 'https://play.example.com/x', { env: {}, execArgv: [] }).preflight, 'dns');
  const dns = await reachSite('https://play.example.com', { fetchFn: async () => { throw lookup(); }, env: {}, execArgv: [] });
  assert.deepEqual([dns.ok, dns.preflight, dns.code, dns.needs], [false, 'dns', 'ENOTFOUND', 'network-preflight']);
  assert.match(dns.why, /^network preflight failed, before any page or game was opened: this computer's Node\.js could not look up play\.example\.com \(ENOTFOUND\)\. A browser on the same computer may still open play\.example\.com \(browsers can use their own DNS\), so this says nothing about the site or the game/);
  assert.match(dns.instead, /run the site here \(`npx --no-install homie-studio dev`.*--url http:\/\/127\.0\.0\.1:8787/);
  const refusedConn = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  const net = await reachSite('https://play.example.com', { fetchFn: async () => { throw refusedConn(); }, env: {}, execArgv: [] });
  assert.deepEqual([net.preflight, net.needs], ['network', 'network-preflight']);
  assert.match(net.why, /not a result about the game/);
  // This computer's own address: the dev server is not running, which is a different thing to do.
  const local = await reachSite('http://127.0.0.1:8787', { fetchFn: async () => { throw refusedConn(); } });
  assert.equal(local.preflight, 'local');
  assert.match(local.why, /the site is not running here/);
  assert.deepEqual(await reachSite('https://play.example.com', { fetchFn: async () => new Response('x', { status: 404 }) }), { ok: true, status: 404 }, 'any answer is an answer: the name resolved');
  assert.equal((await reachSite('https://play.example.com', { fetchFn: async () => new Response('x', { status: 502 }) })).preflight, 'site');
  // After a deploy: the site that could not be read back is said as this computer's lookup, and asked only once.
  let asks = 0;
  const read = await readLiveSite('https://play.example.com', { fetchFn: async () => { asks += 1; throw lookup(); } });
  assert.deepEqual([read.state, read.preflight, asks], ['unreachable', 'dns', 1]);
  // perf against a public address this computer cannot look up (a reserved name: it resolves nowhere).
  const dir = studio('preflight');
  const perf = spawnSync(process.execPath, [CLI, 'perf', 'crown-thief', '--url', 'https://studio.invalid', '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '' }, timeout: 60_000 });
  const said = JSON.parse(perf.stdout);
  if (/Chrome|puppeteer/i.test(said.why ?? '')) return; // no Chrome on this computer: perf stops before it asks
  assert.equal(said.ok, false);
  assert.equal(said.preflight, 'dns', JSON.stringify(said));
  assert.match(said.why, /network preflight failed, before any page or game was opened/i);
  assert.match(said.instead, /homie-studio dev/);
});
