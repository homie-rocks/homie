import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareNode, nodeHome } from '../lib/prepare.mjs';
import { studioDomain, registerWorkersAddress } from '../lib/domain.mjs';
import { newStudio } from '../lib/scaffold.mjs';
import { readConfig, keptRoutes } from '../lib/routes.mjs';
import { readStudio, configPath } from '../lib/studio.mjs';
import { StudioContext, toolDefs, _test } from '../lib/mcp-tools.mjs';
import { INSTRUCTIONS } from '../lib/mcp.mjs';
import { toolPath, npmInvocation } from '../lib/jobs.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'homie-first-steps-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('private runtime: verified archive, no shell or admin, reusable and discoverable', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const home = join(scratch, platform);
    const file = `node-v22.23.3-${platform === 'win32' ? 'win' : platform}-arm64.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
    const data = Buffer.from('stand-in archive');
    const requests = []; const calls = [];
    const r = await prepareNode({ home, platform, arch: 'arm64', fetchFn: async (url) => {
      requests.push(url);
      return new Response(url.endsWith('.txt') ? `${createHash('sha256').update(data).digest('hex')}  ${file}\n` : data);
    }, exec: (bin, args, options) => {
      calls.push({ bin, args, options });
      if (bin === 'tar') {
        const dir = join(args[3], file.replace(/\.(tar\.gz|zip)$/, ''));
        mkdirSync(join(dir, 'bin'), { recursive: true });
        writeFileSync(join(dir, platform === 'win32' ? 'node.exe' : 'bin/node'), 'stand-in');
      }
      return { status: 0, stdout: 'v22.23.3\n' };
    } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.installed, true);
    assert.equal(requests.length, 2);
    assert.ok(calls.every((c) => !c.options.shell));
    assert.ok(toolPath({}, platform, home).includes(nodeHome(home)));
    assert.equal((await prepareNode({ home, platform, fetchFn: () => { throw Error('must reuse'); } })).installed, false);
  }
});

test('runtime refuses bad checksum, unsupported platform, failed download and failed unpack without installing', async () => {
  const home = join(scratch, 'refuse');
  const bad = await prepareNode({ home, platform: 'linux', arch: 'x64', fetchFn: async (url) => new Response(url.endsWith('.txt') ? `${'a'.repeat(64)}  node-v22.23.3-linux-x64.tar.gz` : 'wrong'), exec: () => { throw Error('must not execute'); } });
  assert.equal(bad.ok, false);
  assert.match(bad.why, /checksum/);
  assert.equal(existsSync(nodeHome(home)), false);
  assert.equal((await prepareNode({ home, platform: 'other' })).ok, false);
  const down = await prepareNode({ home, fetchFn: async () => new Response('', { status: 503 }) });
  assert.equal(down.ok, false); assert.match(down.why, /503/);
});

test('requested custom domain: exact route, idempotent, existing routes preserved across deploy rewrite', () => {
  const root = join(scratch, 'domain'); newStudio(root, { name: 'Pub', install: false });
  const cfg = readConfig(root); cfg.routes = [{ pattern: 'old.example.com', custom_domain: true }];
  writeFileSync(configPath(root), JSON.stringify(cfg));
  assert.equal(studioDomain(root, 'Play.Example.com').ok, true);
  assert.equal(studioDomain(root, 'play.example.com').ok, true);
  assert.equal(readStudio(root).cloudflare.domain, 'play.example.com');
  assert.deepEqual(keptRoutes(root, readStudio(root)), [cfg.routes[0], { pattern: 'play.example.com', custom_domain: true }]);
  const before = readFileSync(configPath(root), 'utf8');
  for (const host of ['*.example.com', 'https://example.com/path', 'a..com', '-a.com', 'x.workers.dev', '']) assert.equal(studioDomain(root, host).ok, false, host);
  assert.equal(readFileSync(configPath(root), 'utf8'), before);
});

test('first-run MCP defaults the name, has no tutorial gates, and plans without asking design questions', async () => {
  const ctx = new StudioContext({ studiosDir: join(scratch, 'studios'), install: false, skillsDir: fileURLToPath(new URL('../../../plugins/homie/skills/', import.meta.url)) });
  const tools = toolDefs(ctx);
  const call = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  const made = await call('studio_scaffold');
  assert.notEqual(made.isError, true, JSON.stringify(made));
  const root = ctx.root();
  assert.equal(readStudio(root).name, 'My Studio');
  const steps = _test.checklist(ctx, root);
  assert.equal(steps.length, 5);
  assert.equal(steps.find((s) => s.state === 'now').label, 'Plan from your request');
  const plan = await call('game_plan', { id: 'pub-night', name: 'Pub Night' });
  assert.match(plan.content[0].text, /No interview unless/);
  assert.doesNotMatch(plan.content[0].text, /Now the interview|Do you want to steer the look closely/);
  const interview = await call('game_plan', { id: 'pub-night', interview: true });
  assert.match(interview.content[0].text, /Do you want to steer the look closely/);
  assert.match(INSTRUCTIONS, /business or charity/);
  assert.match(INSTRUCTIONS, /never types a command/);
  assert.equal((await call('studio_domain', { hostname: 'pub.example.com' })).isError, undefined);
});


test('GitHub missing CLI: AI starts one install, follows it, and gives one next step without a token', async () => {
  let started = 0;
  const job = { id: 'install-gh', label: 'Install GitHub CLI' };
  const opts = { state: () => ({ gh: null }), find: () => '/stand-in/brew', activeJobs: () => [], view: (j) => j,
    start: (p) => { started++; assert.deepEqual(p.args, ['install', 'gh']); return job; } };
  const ctx = { current: scratch };
  const first = await _test.githubLogin(ctx, opts);
  assert.match(first.content[0].text, /follow studio_job/);
  assert.equal(started, 1);
  await _test.githubLogin(ctx, { ...opts, activeJobs: () => [job] });
  assert.equal(started, 1, 'do not start two installs');
  const unsupported = await _test.githubLogin(ctx, { ...opts, find: () => null });
  assert.equal(unsupported.isError, true);
  assert.match(unsupported.content[0].text, /AI: install.*https:\/\/cli.github.com/);
});

test('first-run status delegates prerequisites and never assigns a key to a person', async () => {
  const { setupStatus } = await import('../lib/doctor.mjs');
  const r = await setupStatus({ cwd: scratch, env: {}, platform: 'linux', node: '0', chrome: () => null,
    exec: async () => ({ code: 127, stdout: '', stderr: '' }), fetchFn: async () => new Response('{}', { status: 405 }) });
  for (const id of ['node', 'chrome', 'ffmpeg', 'fal']) assert.equal(r.rows.find((x) => x.id === id).fix.who, 'ai', id);
  assert.doesNotMatch(r.rows.find((x) => x.id === 'fal').fix.say, /Make a key|shell profile/);
  assert.match(r.rows.find((x) => x.id === 'cloudflare').fix.say, /cloudflare_login/);
});


test('private Windows npm is run by Node without cmd.exe or a user terminal', () => {
  const r = npmInvocation({ bin: '/cache/node/node.exe', npm: '/cache/node/npm.cmd' }, 'win32');
  assert.equal(r.cmd, '/cache/node/node.exe');
  assert.deepEqual(r.args, ['/cache/node/node_modules/npm/bin/npm-cli.js', 'install', '--no-audit', '--no-fund']);
  assert.equal(npmInvocation({ bin: '/node', npm: '/npm' }, 'darwin').cmd, '/npm');
});


test('workers.dev: keep an existing address, register a missing one, never write after ambiguous failure', async () => {
  const calls = [];
  const headers = { authorization: 'Bearer stand-in' };
  const r = await registerWorkersAddress({ accountId: 'stand-in-account', slug: 'Pub', headers, fetchFn: async (url, opts) => {
    calls.push({ url, ...opts });
    return opts.method === 'PUT' ? Response.json({ success: true, result: { subdomain: JSON.parse(opts.body).subdomain } }) : Response.json({ success: true, result: null });
  } });
  assert.deepEqual(r, { ok: true, created: true });
  assert.equal(calls.length, 2);
  assert.match(JSON.parse(calls[1].body).subdomain, /^pub-[a-f0-9]{10}$/);
  for (const status of [200, 403, 500]) {
    let count = 0;
    const kept = await registerWorkersAddress({ accountId: 'stand-in', headers, fetchFn: async (_url, opts) => {
      count++; assert.equal(opts.method, undefined);
      return Response.json({ success: status === 200, result: { subdomain: 'existing' } }, { status });
    } });
    assert.equal(count, 1);
    assert.equal(kept.ok, status === 200);
  }
  assert.equal((await registerWorkersAddress({ accountId: 'stand-in', fetchFn: () => { throw Error('no auth must not call'); } })).ok, false);
});


test('first deploy retries automatically after registering workers.dev with the stand-in account', async () => {
  const { deploy } = await import('../lib/cloudflare.mjs');
  const root = join(scratch, 'address-deploy');
  newStudio(root, { name: 'Pub Night', install: false, homie: 'http://127.0.0.1:9' });
  const pkg = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(join(root, 'node_modules', '@homie-rocks'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(pkg, join(root, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(fileURLToPath(new URL('../../../node_modules/esbuild', import.meta.url)), join(root, 'node_modules', 'esbuild'));
  const marker = join(root, '.attempted');
  writeFileSync(join(root, 'node_modules', '.bin', 'wrangler'), `#!${process.execPath}
import { existsSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
switch (args[0]) {
 case 'whoami': console.log(JSON.stringify({loggedIn:true,accounts:[{id:'stand-in-account',name:'Pub'}]})); break;
 case 'versions': console.log('This Worker does not exist [code: 10007]'); process.exitCode=1; break;
 case 'auth': console.log(JSON.stringify({token:'stand-in-only'})); break;
 case 'd1': console.log(args[1] === 'create' ? '\"database_id\": \"22222222-2222-2222-2222-222222222222\"' : '[]'); break;
 case 'deploy': if (!existsSync(${JSON.stringify(marker)})) { writeFileSync(${JSON.stringify(marker)}, '1'); console.log('register a workers.dev subdomain'); process.exitCode=1; }
 else console.log('https://pub-night.stand-in.workers.dev'); break;
 default: console.log('[]');
}
`, { mode: 0o755 });
  const old = process.env.HOMIE_STUDIO_WARM;
  process.env.HOMIE_STUDIO_WARM = '0';
  const calls = [];
  try {
    const result = await deploy(root, { homie: 'http://127.0.0.1:9', fetchFn: async (url, opts = {}) => {
      assert.match(String(url), /api.cloudflare.com.*workers\/subdomain$/);
      calls.push(opts.method ?? 'GET');
      return Response.json({ success: true, result: opts.method === 'PUT' ? { subdomain: 'stand-in' } : null });
    } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls, ['GET', 'PUT']);
    assert.ok(result.steps.some((s) => /registered.*automatically/.test(s.what)));
    assert.ok(readStudio(root).cloudflare.created.includes('worker:pub-night'));
  } finally { if (old === undefined) delete process.env.HOMIE_STUDIO_WARM; else process.env.HOMIE_STUDIO_WARM = old; }
});
