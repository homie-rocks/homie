// A studio hosted by a git host: one OAuth sign-in (RFC 9728 discovery, RFC 7591 registration,
// PKCE, RFC 8707 resource), Git's credential protocol, deploy as a push and publish on the host.
// The host here is a local stand-in: an OAuth server, an MCP endpoint and git-http-backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = mkdtempSync(join(tmpdir(), 'hm-test-hosted-home-'));
process.env.HOME = HOME;
const { connectHosted, credential, savedFor, discover, hostingOf, TOKENS_DIR } = await import('../lib/hosted.mjs');
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'homie-studio.mjs');
const env = { ...process.env, HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Owner AI', GIT_AUTHOR_EMAIL: 'ai@example.invalid', GIT_COMMITTER_NAME: 'Owner AI', GIT_COMMITTER_EMAIL: 'ai@example.invalid' };
const git = (args, cwd) => { const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' }); if (r.status) throw Error(r.stderr); return r.stdout.trim(); };
const run = (cmd, args, opts) => new Promise((resolve) => { const p = spawn(cmd, args, { env, ...opts }); let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; }); p.on('close', (status) => resolve({ status, out, err })); });

async function host(t) {
  const root = mkdtempSync(join(tmpdir(), 'hm-test-hosted-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const bare = join(root, 'studio.git'), seed = join(root, 'seed');
  git(['init', '-q', '--bare', '-b', 'main', bare]); git(['config', 'http.receivepack', 'true'], bare);
  git(['init', '-q', '-b', 'main', seed]);
  writeFileSync(join(seed, 'studio.json'), JSON.stringify({ name: 'Hosted proof' }, null, 2)); writeFileSync(join(seed, 'index.html'), '<h1>Hi</h1>\n');
  git(['add', '.'], seed); git(['commit', '-qm', 'Seed'], seed); git(['push', '-q', bare, 'HEAD:main'], seed);
  const seen = { registrations: [], authorize: [], tokens: [], mcp: [], git: [] }, codes = new Map(), access = new Map();
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin), body = await new Promise((r) => { let b = Buffer.alloc(0); req.on('data', (d) => { b = Buffer.concat([b, d]); }); req.on('end', () => r(b)); });
    const send = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
    const bearer = () => { const h = req.headers.authorization ?? ''; const t = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : h.replace(/^Bearer /, ''); return access.get(t) ?? null; };
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return send(200, { resource: origin + '/mcp', authorization_servers: [origin + '/as'], scopes_supported: ['studio:read', 'studio:write'] });
    if (url.pathname === '/.well-known/oauth-authorization-server/as') return send(200, { issuer: origin + '/as', authorization_endpoint: origin + '/as/authorize', token_endpoint: origin + '/as/token', registration_endpoint: origin + '/as/register', code_challenge_methods_supported: ['S256'] });
    if (url.pathname === '/as/register') { const c = JSON.parse(body); seen.registrations.push(c); return send(201, { ...c, client_id: 'client-' + seen.registrations.length }); }
    if (url.pathname === '/as/authorize') {
      const q = Object.fromEntries(url.searchParams); seen.authorize.push(q);
      const code = randomBytes(8).toString('hex'); codes.set(code, q);
      res.writeHead(302, { location: `${q.redirect_uri}?code=${code}&state=${q.state}` }); return res.end();
    }
    if (url.pathname === '/as/token') {
      const p = Object.fromEntries(new URLSearchParams(body.toString())); seen.tokens.push(p);
      if (p.grant_type === 'authorization_code') {
        const q = codes.get(p.code); codes.delete(p.code);
        if (!q || createHash('sha256').update(p.code_verifier).digest('base64url') !== q.code_challenge || p.resource !== origin + '/mcp') return send(400, { error: 'invalid_grant' });
      } else if (p.grant_type !== 'refresh_token' || p.refresh_token !== 'refresh-1') return send(400, { error: 'invalid_grant' });
      const token = 'access-' + seen.tokens.length; access.set(token, p.client_id);
      return send(200, { access_token: token, token_type: 'Bearer', expires_in: 900, refresh_token: 'refresh-1' });
    }
    if (url.pathname === '/mcp') {
      if (!bearer()) return send(401, {}, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      const m = JSON.parse(body); seen.mcp.push(m);
      if (!m.id) { res.writeHead(202); return res.end(); }
      if (m.method === 'initialize') return send(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'stand-in host', version: '1' } } });
      return send(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: m.params.name === 'studio_publish' ? `Waiting for the owner's tap on ${m.params.arguments.commit.slice(0, 7)}` : `Commit ${m.params.arguments.commit.slice(0, 7)} is building` }] } });
    }
    if (url.pathname.startsWith('/git/')) {
      seen.git.push({ path: url.pathname, auth: req.headers.authorization ?? null });
      if (!bearer()) return send(401, {}, { 'www-authenticate': `Basic realm="host", Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      const cgi = spawn(join(exec, 'git-http-backend'), [], { env: { GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: url.pathname.slice(4), QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '', ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] } : {}), ...(req.headers['git-protocol'] ? { GIT_PROTOCOL: req.headers['git-protocol'] } : {}), REMOTE_ADDR: '127.0.0.1', PATH: process.env.PATH } });
      cgi.stdin.end(body);
      const out = await new Promise((r) => { let b = Buffer.alloc(0); cgi.stdout.on('data', (d) => { b = Buffer.concat([b, d]); }); cgi.stdout.on('end', () => r(b)); });
      const cut = out.indexOf('\r\n\r\n'); let status = 200; const headers = {};
      for (const l of out.subarray(0, cut).toString().split('\r\n')) { const [k, ...v] = l.split(':'); if (k.toLowerCase() === 'status') status = parseInt(v.join(':')); else headers[k] = v.join(':').trim(); }
      res.writeHead(status, headers); return res.end(out.subarray(cut + 4));
    }
    send(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  return { origin, bare, root, seen, remote: origin + '/git/studio.git' };
}
// The browser: open the approval page and follow its redirect back to the loopback listener.
const approve = async (url) => { const r = await fetch(url, { redirect: 'manual' }); await fetch(r.headers.get('location')); };

test('one approval: discovery, registration, PKCE and the resource, then Git signs in through its credential helper', async (t) => {
  const h = await host(t);
  const found = await discover(h.remote);
  assert.equal(found.resource, h.origin + '/mcp');
  const folder = join(h.root, 'clone');
  const result = await connectHosted(h.remote, folder, { version: '0.0.0-test', helper: `!"${process.execPath}" "${CLI}" git-credential`, install: false, approve });
  assert.equal(result.ok, true); assert.equal(result.marked, true);
  const [auth] = h.seen.authorize;
  assert.equal(auth.code_challenge_method, 'S256'); assert.equal(auth.resource, h.origin + '/mcp'); assert.match(auth.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(h.seen.registrations[0].token_endpoint_auth_method, 'none');
  // The clone used the token only through the credential protocol: never in a URL or Git config.
  assert.ok(h.seen.git.some((x) => x.auth?.startsWith('Basic ')));
  const config = readFileSync(join(folder, '.git', 'config'), 'utf8');
  assert.doesNotMatch(config, /access-\d/); assert.match(config, /git-credential/); assert.equal(git(['remote', 'get-url', 'origin'], folder), h.remote);
  const files = readdirSync(TOKENS_DIR(HOME));
  assert.equal(files.length, 1); assert.equal(statSync(join(TOKENS_DIR(HOME), files[0])).mode & 0o777, 0o600);
  assert.deepEqual(hostingOf(JSON.parse(readFileSync(join(folder, 'studio.json'), 'utf8'))), { git: h.remote, mcp: h.origin + '/mcp', name: '127.0.0.1' });
  // The helper speaks Git's protocol, refreshes an expiring token and forgets an erased one.
  const ask = `protocol=http\nhost=${new URL(h.origin).host}\npath=git/studio.git\n`;
  assert.match(await credential('get', ask), /^username=oauth\npassword=access-\d+\npassword_expiry_utc=\d+\n$/);
  const saved = savedFor(h.remote); await credential('erase', ask + `password=${saved.access_token}\n`);
  const refreshed = await credential('get', ask);
  assert.match(refreshed, /password=access-\d+/); assert.equal(h.seen.tokens.at(-1).grant_type, 'refresh_token'); assert.equal(h.seen.tokens.at(-1).resource, h.origin + '/mcp');
  assert.equal(await credential('get', 'protocol=https\nhost=other.example\n'), '', 'no answer for another host');
});

test('a hosted studio deploys by pushing main, publishes on the host, and never touches Cloudflare', async (t) => {
  const h = await host(t);
  const folder = join(h.root, 'clone');
  await connectHosted(h.remote, folder, { version: '0.0.0-test', helper: `!"${process.execPath}" "${CLI}" git-credential`, install: false, approve });
  writeFileSync(join(folder, 'index.html'), '<h1>Changed by my AI</h1>\n');
  git(['add', '.'], folder); git(['commit', '-qm', 'Bigger title'], folder);
  const head = git(['rev-parse', 'HEAD'], folder);
  const deployed = await run(process.execPath, [CLI, 'deploy', '--json'], { cwd: folder });
  assert.equal(deployed.status, 0, deployed.err + deployed.out);
  const result = JSON.parse(deployed.out);
  assert.equal(result.hosted, true); assert.equal(result.commit, head); assert.match(result.progress, /is building/);
  assert.equal(git(['rev-parse', 'main'], h.bare), head);
  const plan = JSON.parse((await run(process.execPath, [CLI, 'deploy', '--plan', '--json'], { cwd: folder })).out);
  assert.match(plan.lines.join(' '), /never deployed to a Cloudflare account/);
  const storage = await run(process.execPath, [CLI, 'storage', 'add', '--json'], { cwd: folder });
  assert.notEqual(storage.status, 0); assert.match(JSON.parse(storage.out).why, /hosted by 127\.0\.0\.1/);
  const published = JSON.parse((await run(process.execPath, [CLI, 'publish', '--json'], { cwd: folder })).out);
  assert.match(published.answer, /Waiting for the owner's tap/);
  const call = h.seen.mcp.find((m) => m.params?.name === 'studio_publish');
  assert.deepEqual(call.params.arguments, { commit: head, expected: null });
  // The MCP tools say the same: no Cloudflare sign-in, and the plan is a push.
  const { StudioContext, toolDefs } = await import('../lib/mcp-tools.mjs');
  const tools = toolDefs(new StudioContext({ cwd: folder, install: false, desktop: false }));
  const login = await tools.find((x) => x.name === 'cloudflare_login').run({});
  assert.equal(login.isError, true); assert.match(login.content[0].text, /hosted by/);
  assert.match((await tools.find((x) => x.name === 'studio_deploy').run({ plan: true })).content[0].text, /push of this studio's main/);
});
