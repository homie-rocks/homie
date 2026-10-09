import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, utimesSync, symlinkSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newStudio } from '../lib/scaffold.mjs';
import { newApp, newGame, listApps, listGames, listExperiences } from '../lib/studio.mjs';
import { build } from '../lib/build.mjs';
import { webBundle } from '../lib/standalone.mjs';
import { newPart, checkPart } from '../lib/parts.mjs';
import { lanAddresses, rulesStamp } from '../lib/dev.mjs';
import { appProblems } from '../worker/app-format.mjs';
import { appRecordsRoute, appAccess } from '../worker/app-records.mjs';
import worker from '../worker/index.mjs';
import { appLink, randomId, qrSvg } from '../links/links.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'homie-app-tests-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
function studio(name) { const dir = join(scratch, name); newStudio(dir, { name, install: false }); symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules')); return dir; }
const hash = (s) => createHash('sha256').update(s).digest('hex');
function database(root) {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(join(root, 'site/migrations')).sort()) sql.exec(readFileSync(join(root, 'site/migrations', file), 'utf8'));
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null, all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
  return { sql, prepare: stmt, batch: async (statements) => Promise.all(statements.map((s) => s.run())) };
}
test('apps share discovery, build, parts and standalone without changing a game bundle', async () => {
  const root = studio('Mixed');
  await newGame(root, 'gems'); const first = await build(root);
  const old = readFileSync(join(root, 'site/dist/games/gems', first.games[0].bundle));
  await newApp(root, 'welcome');
  assert.equal(listGames(root).length, 1); assert.equal(listApps(root).length, 1); assert.equal(listExperiences(root).length, 2);
  await assert.rejects(newGame(root, 'welcome'), /owns this address/);
  await assert.rejects(newApp(root, 'gems'), /already exists/);
  const made = await build(root, { types: true });
  const gems = made.games.find((g) => g.id === 'gems');
  assert.deepEqual(readFileSync(join(root, 'site/dist/games/gems', gems.bundle)), old);
  assert.equal(gems.hash, first.games[0].hash);
  const cat = JSON.parse(readFileSync(join(root, 'site/dist/games.json')));
  assert.equal(cat.games.find((g) => g.id === 'gems').kind, undefined);
  assert.equal(cat.games.find((g) => g.id === 'welcome').kind, 'app');
  const app = listApps(root)[0];
  const stamp = rulesStamp(app); const future = new Date(Date.now() + 10000);
  utimesSync(join(app.dir, 'app.json'), future, future); assert.notEqual(rulesStamp(app), stamp, 'app metadata participates in dev rebuilds');
  webBundle(root, app, join(scratch, 'wrapped'), { target: 'ios', site: 'https://example.test' });
  assert.match(readFileSync(join(scratch, 'wrapped/web/config.js'), 'utf8'), /"kind": "app"/);
  assert.match(readFileSync(join(scratch, 'wrapped/web/shell.js'), 'utf8'), /homie-app-result/);
  assert.deepEqual(readFileSync(join(scratch, 'wrapped/web/game', made.games.find((g) => g.id === 'welcome').bundle)), readFileSync(join(root, 'site/dist/games/welcome', made.games.find((g) => g.id === 'welcome').bundle)));
  writeFileSync(join(app.dir, 'src/queue.ts'), 'export const queue = [];\n');
  assert.equal(newPart(root, 'waitlist', { from: 'welcome', paths: ['src/queue.ts'], kind: 'waitlist', uses: ['app', 'venue'] }).ok, true);
  const part = JSON.parse(readFileSync(join(root, 'parts/waitlist/part.json')));
  assert.equal(part.from.app, 'welcome'); assert.deepEqual(part.uses, ['app', 'venue']);
  assert.equal(newPart(root, 'whole', { from: 'welcome', paths: ['app.json'] }).ok, false);
  for (const kind of ['loop', 'stem', 'track', 'video-intro', 'video-template']) assert.equal(newPart(root, kind, { kind }).ok, true);
});
test('app schema, LAN addresses and public HTTP links refuse invalid input', () => {
  const meta = JSON.parse(readFileSync(new URL('../app-starters/welcome/app.json', import.meta.url)));
  assert.deepEqual(appProblems(meta), []);
  for (const roles of [null, [], { staff: null }, { staff: { can: 1 } }]) assert.ok(appProblems({ ...meta, roles }).length);
  assert.ok(appProblems({ ...meta, roles: { ...meta.roles, staff: { signIn: false, can: ['erase:anything'] } } }).length);
  assert.deepEqual(lanAddresses({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], wifi: [{ family: 'IPv4', address: '192.168.1.2', internal: false }, { family: 'IPv6', address: '::1', internal: false }] }), ['192.168.1.2']);
  const url = appLink('/welcome/open', { ticket: 'A & B', role: 'customer' }, 'http://192.168.1.2:8787');
  assert.equal(new URL(url).searchParams.get('ticket'), 'A & B');
  assert.match(qrSvg(url), /<svg/); assert.match(randomId(), /^[a-f0-9]{32}$/);
  assert.throws(() => appLink('javascript:alert(1)')); assert.throws(() => appLink('https://user:pass@example.test'));
});
test('records require account grants, survive room lifetimes, validate and compare versions; staff links are not bearer permissions', async () => {
  const root = studio('Records'); await newApp(root, 'welcome'); const meta = listApps(root)[0];
  const DB = database(root); const env = { DB }; const origin = 'https://example.test';
  const token = 'a'.repeat(64); DB.sql.prepare('INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, ?, ?)').run(hash(token), 'session', Date.now() + 3600000);
  const request = (path, method = 'GET', body, cookie = '', from = origin) => new Request(origin + path, { method, headers: { origin: from, cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const call = async (path, method, body, cookie, from) => { const req = request(path, method, body, cookie, from); return appRecordsRoute(req, env, meta, new URL(req.url), new URL(req.url).pathname.slice('/welcome/'.length)); };
  const owner = `studio_owner=${token}`;
  const issued = await call('/welcome/api/app/roles', 'POST', { role: 'staff' }, owner);
  assert.equal(issued.status, 200); const link = (await issued.json()).link; const query = new URL(link).search;
  let a = await appAccess(request('/welcome/open' + query), env, meta, new URL(link)); assert.equal(a.status, 401);
  a = await appAccess(request('/welcome/open?role=staff', 'GET', null, owner), env, meta, new URL(origin + '/welcome/open?role=staff')); assert.equal(a.status, 404);
  const id = 'pl_' + 'a'.repeat(22), session = 'b'.repeat(43), now = Date.now();
  DB.sql.prepare('INSERT INTO players (id,name,named,guest,owner,created_at,seen_at) VALUES (?,?,1,0,0,?,?)').run(id,'Test staff',now,now);
  DB.sql.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?, ?, 'session', ?)").run(hash(session), id, now+30*86400000);
  const staff = `studio_player=${session}`;
  a = await appAccess(request('/welcome/open'+query,'GET',null,staff),env,meta,new URL(link));assert.equal(a.status,403);
  assert.equal((await call('/welcome/api/app/roles','POST',{role:'staff',player:id},owner)).status,200);
  a=await appAccess(request('/welcome/open'+query,'GET',null,staff),env,meta,new URL(link));assert.equal(a.ok,true);
  const path='/welcome/api/app/records/queue/ticket';
  assert.equal((await call(path,'POST',{data:{label:'A',status:'called'}})).status,400);
  assert.equal((await call(path,'POST',{data:{label:'A',status:'waiting'}})).status,200);
  assert.equal((await call(path,'PUT',{data:{label:'A',status:'called'},version:1})).status,403);
  assert.equal((await call(path+query,'PUT',{data:{label:'A',status:'called'},version:1},staff,'https://evil.test')).status,403);
  assert.equal((await call(path+query,'PUT',{data:{label:'A',status:'called'},version:1},staff)).status,200);
  assert.equal((await call(path+query,'PUT',{data:{label:'B',status:'called'},version:1},staff)).status,409);
  const latest=await (await call(path+'?room=completely-new')).json();assert.equal(latest.records[0].data.status,'called');
  assert.equal((await call('/welcome/api/app/roles','POST',{role:'staff',player:id,revoke:true},owner)).status,200);
  assert.equal((await call(path+query,'DELETE',{version:2},staff)).status,403);
  assert.equal((await call(path+query,'DELETE',{version:2},owner)).status,200);
  assert.deepEqual((await (await call(path)).json()).records,[]);
  DB.sql.close();
});

test('app home, landing, manifest and shared watch shell use app language and public addresses', async () => {
  const root = studio('App site'); await newApp(root, 'welcome'); await build(root);
  const DB = database(root);
  const env = { DB,
    ASSETS: { fetch: async (req) => { try { const path = new URL(req.url).pathname; return new Response(readFileSync(join(root, 'site/dist', path)), { headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream' } }); } catch { return new Response('missing', { status: 404 }); } } },
    LOBBY: { idFromName: (id) => id, get: () => ({ fetch: async () => new Response(JSON.stringify({ rooms: [], players: 0 })) }) },
  };
  const get = (path) => worker.fetch(new Request('https://apps.example' + path), env, { waitUntil() {} });
  const manifest = await (await get('/.well-known/homie-studio.json')).json();
  assert.deepEqual(manifest.games, []); assert.equal(manifest.apps[0].open, 'https://apps.example/welcome/open');
  assert.equal(manifest.apps[0].wall, 'https://apps.example/welcome/tv'); assert.equal(JSON.stringify(manifest).includes('access='), false);
  for (const path of ['/', '/apps/', '/welcome/']) {
    const response = await get(path); assert.equal(response.status, 200);
    const html = await response.text(); assert.match(html, /welcome\/open/); assert.match(html, /Open/);
  }
  const roomPage = await (await get('/rooms/')).text(); assert.match(roomPage, /people here/); assert.doesNotMatch(roomPage, /bots in the empty seats/);
  const watch = await (await get('/welcome/watch?room=one')).text();
  assert.match(watch, /homie-app-result/); assert.match(watch, /"kind":"app"/); assert.match(watch, /"role":"wall"/);
  const phone = await (await get('/welcome/open?room=one')).text(); assert.match(phone, /homie-app-result/);
  assert.equal((await get('/welcome/open?role=undeclared')).status, 404);
  const wallSurface = await (await get('/welcome/__game/?room=one&surface=wall')).text();
  assert.match(wallSurface, /"params":\{[^}]*"role":"wall"/);
  const explicitRole = await (await get('/welcome/__game/?room=one&surface=wall&role=customer')).text();
  assert.match(explicitRole, /"params":\{[^}]*"role":"customer"/);
  for (const origin of ['app://game', 'capacitor://localhost', 'https://localhost', 'https://evil.example']) {
    const request = (method, suffix = '') => new Request('https://apps.example/welcome/api/app/records/queue/native' + suffix, { method, headers: { origin, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ data: { label: 'Native', status: 'waiting' } }) } : {}) });
    const preflight = await worker.fetch(request('OPTIONS'), env, { waitUntil() {} });
    const allowed = origin !== 'https://evil.example';
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowed ? origin : null);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    const create = await worker.fetch(request('POST'), env, { waitUntil() {} });
    assert.equal(create.status, allowed ? origin === 'app://game' ? 200 : 409 : 403);
    const staff = await worker.fetch(request('GET', '?role=staff'), env, { waitUntil() {} }); assert.equal(staff.status, 404);
  }
  DB.sql.close();
});

test('MCP app_make creates a starter beside game_make and exposes the app guide', async () => {
  const { mcpServer } = await import('./card-host.mjs');
  const root = studio('MCP app');
  const server = mcpServer(process.execPath, [join(ROOT, 'packages/studio/bin/homie-studio.mjs'), 'mcp', '--studios', scratch, '--no-install', '--skills', join(ROOT, 'plugins/homie/skills')], { cwd: root });
  try {
    await server.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'apps-test', version: '1' } });
    const listed = (await server.request('tools/list', {})).result.tools;
    assert.ok(listed.some((t) => t.name === 'app_make')); assert.ok(listed.some((t) => t.name === 'game_make'));
    const made = (await server.request('tools/call', { name: 'app_make', arguments: { id: 'hello', name: 'Hello' } })).result;
    assert.equal(made.isError, undefined, JSON.stringify(made)); assert.equal(listApps(root)[0].id, 'hello');
    const guide = (await server.request('tools/call', { name: 'studio_guide', arguments: { topic: 'app' } })).result;
    assert.equal(guide.isError, undefined); assert.match(guide.content[0].text, /morph/i);
  } finally { await server.close(); }
});
