/**
 * `homie-studio mcp`: the studio toolkit as a local MCP server (stdio), for the Claude desktop app's Homie extension
 * and any MCP client. Spoken to here the way a host does: newline-delimited JSON-RPC on the process's stdin/stdout.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expandHome } from '../lib/mcp-tools.mjs';
import { lastJson, toolPath } from '../lib/jobs.mjs';
import { studioPath } from '../lib/files.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-mcp-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A host's side of the stdio transport. */
function server(args, { cwd = scratch, env = {} } = {}) {
  const child = spawn(process.execPath, [CLI, 'mcp', ...args], { cwd, env: { ...process.env, HOMIE_MCP_WAIT_MS: '20000', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let seq = 0; const waiting = new Map(); const notes = []; let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else notes.push(m);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (waiting.has(id)) reject(new Error(`no answer to ${method}: ${err.slice(-800)}`)); }, 60_000);
  });
  const call = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result;
  const close = () => new Promise((r) => { child.on('close', r); child.stdin.end(); });
  return { request, call, close, notes, stderr: () => err };
}

test('handshake, tools with the remote\'s names, prompts, and the cards as MCP Apps resources', async () => {
  const s = server(['--studios', join(scratch, 'none'), '--no-install']);
  try {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'homie-studio');
    assert.match(init.result.instructions, /never ahead/);
    assert.match(init.result.instructions, /NO game/);
    const { tools } = (await s.request('tools/list')).result;
    const names = tools.map((t) => t.name);
    for (const n of ['setup_status', 'studio_scaffold', 'studio_card', 'game_demo', 'game_make', 'game_remix', 'game_port', 'game_plan', 'game_codex', 'build', 'preview_run', 'check', 'playtest', 'studio_deploy', 'studio_publish', 'build_open', 'build_progress', 'build_stop', 'file_read', 'file_write', 'file_edit', 'studio_guide']) assert.ok(names.includes(n), `tool ${n}`);
    // The same names and input shapes as the remote Homie MCP where they overlap.
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(by.game_make.inputSchema.required, ['id', 'name']);
    assert.deepEqual(by.game_remix.inputSchema.required, ['game', 'id']);
    assert.ok(by.studio_scaffold.inputSchema.properties.name && by.studio_scaffold.inputSchema.properties.folder);
    assert.ok(by.build_progress.inputSchema.properties.build);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object', t.name);
      assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} says whether it only reads`);
      assert.ok(!('run' in t));
    }
    for (const [tool, uri] of [['setup_status', 'ui://homie-studio/setup'], ['build_progress', 'ui://homie-studio/build'], ['studio_card', 'ui://homie-studio/studio'], ['game_codex', 'ui://homie-studio/codex']]) {
      assert.equal(by[tool]._meta.ui.resourceUri, uri);
      const read = (await s.request('resources/read', { uri })).result.contents[0];
      assert.equal(read.mimeType, 'text/html;profile=mcp-app');
      assert.match(read.text, /ui\/initialize/);
      assert.match(read.text, /ui\/notifications\/size-changed/);
      assert.doesNotMatch(read.text, /__name|<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/, 'one inline script, written as a file (never a function\'s source)');
      assert.deepEqual(read._meta.ui.csp.connectDomains, []);
    }
    const prompts = (await s.request('prompts/list')).result.prompts;
    assert.ok(prompts.some((p) => p.name === 'new-studio'));
    const p = (await s.request('prompts/get', { name: 'new-studio', arguments: { name: 'Paper Comets' } })).result;
    assert.match(p.messages[0].content.text, /Paper Comets/);
    assert.equal((await s.request('nope/nothing')).error.code, -32601);
  } finally { await s.close(); }
});

test('a studio made, planned, made into a game, built and tracked, all through tools; files stay inside it', async () => {
  const studios = join(scratch, 'studios');
  const s = server(['--studios', studios, '--no-install', '--homie', 'https://homie.test']);
  try {
    await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const before = await s.call('setup_status');
    assert.equal(before.structuredContent.kind, 'setup');
    assert.equal(before.structuredContent.current, null);
    assert.equal(before.structuredContent.checklist.find((x) => x.state === 'now').n, 1, 'step 1 is next');

    const made = await s.call('studio_scaffold', { name: 'Paper Comets' });
    assert.ok(!made.isError, made.content[0].text);
    const root = join(studios, 'paper-comets');
    assert.ok(existsSync(join(root, 'studio.json')));
    assert.ok(!existsSync(join(root, 'games', 'gem-rush')), 'no starter game');
    assert.match(made.content[0].text, /First game coming soon/);
    assert.equal(made.structuredContent.current.name, 'Paper Comets');
    assert.equal(made.structuredContent.checklist.find((x) => x.state === 'now').n, 2, 'see a working game is next');
    // Link the toolkit as npm install would (no network in tests).
    mkdirSync(join(root, 'node_modules', '@homie-rocks'), { recursive: true });
    symlinkSync(PKG, join(root, 'node_modules', '@homie-rocks', 'studio'));
    symlinkSync(join(REPO_NM, 'esbuild'), join(root, 'node_modules', 'esbuild'));

    // Files: inside the studio only, never a secret.
    assert.ok(!(await s.call('file_write', { path: 'posts/2026-10-01-hello.md', content: '---\ntitle: Hello\nsummary: We are making a game.\n---\n\nSoon.\n' })).isError);
    assert.match((await s.call('file_read', { path: 'posts/2026-10-01-hello.md' })).content[0].text, /We are making a game/);
    assert.ok(!(await s.call('file_edit', { path: 'posts/2026-10-01-hello.md', old: 'Soon.', new: 'Very soon.' })).isError);
    assert.match((await s.call('file_search', { pattern: 'Very soon' })).content[0].text, /posts\/2026-10-01-hello\.md:6/);
    assert.match((await s.call('file_list', { path: 'posts' })).content[0].text, /hello\.md/);
    for (const bad of ['../outside.txt', '/etc/hosts', '.env', '.git/config', 'node_modules/x.js']) {
      const r = await s.call('file_write', { path: bad, content: 'x' });
      assert.equal(r.isError, true, `${bad} is refused`);
    }
    writeFileSync(join(root, '.dev.vars'), 'SECRET=1\n');
    assert.equal((await s.call('file_read', { path: '.dev.vars' })).isError, true, 'a secret is never read');
    assert.doesNotMatch((await s.call('file_list')).content[0].text, /\.dev\.vars/);

    // The plan comes before the game: the codex starts the game's folder.
    const plan = await s.call('game_plan', { id: 'comet-crews', name: 'Comet Crews' });
    assert.ok(!plan.isError, plan.content[0].text);
    assert.ok(existsSync(join(root, 'games', 'comet-crews', 'CODEX.md')));
    assert.ok(!existsSync(join(root, 'games', 'comet-crews', 'game.json')), 'planned, not made');
    assert.match(plan.content[0].text, /two or three questions/);
    const codex = await s.call('game_codex', { id: 'comet-crews' });
    assert.ok(!codex.isError, codex.content[0].text);
    assert.equal(codex.structuredContent.kind, 'codex');
    assert.match(codex.structuredContent.html, /<h1>Comet Crews<\/h1>/);

    // The game is made around its plan, built, and the build is tracked.
    const game = await s.call('game_make', { id: 'comet-crews', name: 'Comet Crews' });
    assert.ok(!game.isError, game.content[0].text);
    assert.ok(existsSync(join(root, 'games', 'comet-crews', 'game.json')));
    assert.match(readFileSync(join(root, 'games', 'comet-crews', 'CODEX.md'), 'utf8'), /# Comet Crews/, 'the codex stays');
    const open = await s.call('build_open', { id: 'comet-crews', title: 'Comet Crews: first playable' });
    assert.ok(!open.isError, open.content[0].text);
    assert.equal(open.structuredContent.kind, 'build');
    const built = await s.call('build', {});
    assert.ok(!built.isError, built.content[0].text);
    assert.match(built.content[0].text, /comet-crews/);
    const progress = await s.call('build_progress', {});
    assert.equal(progress.structuredContent.feed.stages.find((x) => x.id === 'build').state, 'done', 'build reported into the open feed');
    const stopped = await s.call('build_stop', {});
    assert.equal(stopped.structuredContent.feed.stop.requested, true);
    const card = await s.call('studio_card', {});
    assert.equal(card.structuredContent.kind, 'studio');
    assert.deepEqual(card.structuredContent.games.map((g) => g.id), ['comet-crews']);
    const run = await s.call('studio_run', { args: ['games'] });
    assert.ok(!run.isError, run.content[0].text);
    assert.equal((await s.call('studio_run', { args: ['dev'] })).isError, true, 'the site runs through preview_run');
    const guide = await s.call('studio_guide', { topic: 'studio-setup' });
    assert.match(guide.content[0].text, /See a working game/);
    assert.match(guide.content[0].text, /call the tool of the same job/);
  } finally { await s.close(); }
});

test('helpers: the extension\'s ${HOME} folder, a long PATH, the last JSON a command printed, paths', () => {
  assert.equal(expandHome('${HOME}/Studios', '/x/me'), '/x/me/Studios');
  assert.equal(expandHome('~/studios/', '/x/me'), '/x/me/studios');
  assert.equal(expandHome('${DOCUMENTS}/S', '/x/me'), '/x/me/Documents/S');
  const p = toolPath({ PATH: '/a' }, 'darwin', '/x/me');
  assert.ok(p.startsWith('/a:'));
  assert.ok(p.includes('/opt/homebrew/bin'));
  assert.deepEqual(lastJson('noise\n{\n "ok": true\n}\n'), { ok: true });
  assert.equal(lastJson('no json'), null);
  const root = join(scratch, 'paths');
  mkdirSync(root, { recursive: true });
  assert.throws(() => studioPath(root, '../x'), /outside the studio/);
  assert.throws(() => studioPath(root, 'a/.env.local'), /secret/);
  assert.equal(studioPath(root, 'games/x/a.ts', { write: true }).rel, 'games/x/a.ts');
});

test('studio_open { repo }: a studio on GitHub, cloned with this computer\'s own sign-in; github_login is GitHub\'s device code', async () => {
  // A studio repository (standing in for github.com/octo/paper-comets) and a GitHub CLI that clones it.
  const made = join(scratch, 'made');
  const r = spawn(process.execPath, [CLI, 'new', made, '--name', 'Paper Comets', '--no-install', '--json'], { stdio: 'ignore' });
  await new Promise((res) => r.on('close', res));
  const who = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: '' };
  const git = (args, cwd) => new Promise((res) => spawn('git', args, { cwd, stdio: 'ignore', env: { ...process.env, ...who } }).on('close', res));
  await git(['add', '-A'], made);
  await git(['commit', '-qm', 'studio'], made);
  const remote = join(scratch, 'remote.git');
  await git(['clone', '-q', '--bare', made, remote], scratch);
  const bin = join(scratch, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1" in
  auth) if [ "$2" = status ]; then [ -n "$FAKE_GH_OUT" ] && exit 1; exit 0; fi; echo "! First copy your one-time code: ABCD-1234" >&2; exec sleep 20;;
  repo) exec git clone -q "${remote}" "$4";;
esac
`, { mode: 0o755 });
  const studios = join(scratch, 'from-github');
  const s = server(['--studios', studios, '--no-install'], { env: { PATH: `${bin}:${process.env.PATH}` } });
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal((await s.call('studio_open', { repo: 'homie-rocks/homie' })).isError, true, 'never Homie\'s engine repository');
    const opened = await s.call('studio_open', { repo: 'https://github.com/octo/paper-comets' });
    assert.ok(!opened.isError, opened.content[0].text);
    assert.match(opened.content[0].text, /Cloned octo\/paper-comets/);
    assert.ok(existsSync(join(studios, 'paper-comets', 'studio.json')));
    assert.equal(opened.structuredContent.name, 'Paper Comets');
    assert.equal((await s.call('studio_open', { repo: 'octo/paper-comets' })).isError, true, 'a folder of that name that is not that repository is never overwritten');
    assert.match((await s.call('github_login')).content[0].text, /signed in to GitHub already/);
  } finally { await s.close(); }
  const out = server(['--studios', studios, '--no-install'], { env: { PATH: `${bin}:${process.env.PATH}`, FAKE_GH_OUT: '1' } });
  try {
    await out.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const login = await out.call('github_login');
    assert.ok(!login.isError, login.content[0].text);
    assert.equal(login.structuredContent.deviceCode, 'ABCD-1234');
    assert.match(login.content[0].text, /github\.com\/login\/device/);
  } finally { await out.close(); }
});
