/**
 * `homie-studio mcp`: the studio toolkit as a local MCP server (stdio), for the Claude desktop app's Homie extension
 * and any MCP client. Spoken to here the way a host does: newline-delimited JSON-RPC on the process's stdin/stdout.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expandHome } from '../lib/mcp-tools.mjs';
import { lastJson, toolPath } from '../lib/jobs.mjs';
import { studioPath } from '../lib/files.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-mcp-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A host's side of the stdio transport. */
// A home folder of the tests' own: the server looks there for earlier folders of a studio's name.
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });

function server(args, { cwd = scratch, env = {} } = {}) {
  const child = spawn(process.execPath, [CLI, 'mcp', ...args], { cwd, env: { ...process.env, HOME, HOMIE_MCP_WAIT_MS: '20000', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const timer = setTimeout(() => { if (waiting.delete(id)) reject(new Error(`no answer to ${method}: ${err.slice(-800)}`)); }, 60_000);
    waiting.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
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
    assert.match(init.result.instructions, /without a lesson or an interview/);
    assert.match(init.result.instructions, /NO game/);
    const { tools } = (await s.request('tools/list')).result;
    const names = tools.map((t) => t.name);
    for (const n of ['setup_status', 'studio_scaffold', 'studio_card', 'game_demo', 'game_make', 'game_port', 'game_plan', 'game_codex', 'build', 'preview_run', 'check', 'playtest', 'studio_deploy', 'stripe_login', 'studio_publish', 'build_open', 'build_progress', 'build_stop', 'game_lab', 'file_read', 'file_write', 'file_edit', 'studio_guide']) assert.ok(names.includes(n), `tool ${n}`);
    // The same names and input shapes as the remote Homie MCP where they overlap.
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(by.game_make.inputSchema.required, ['id', 'name']);
    // Remix was retired: no tool hands a whole game over, under that name or any other (games build on parts).
    assert.ok(!names.includes('game_remix'), 'the registry has no game_remix');
    assert.deepEqual(names.filter((n) => /remix/i.test(n)), []);
    for (const t of tools) assert.doesNotMatch(`${t.title ?? ''} ${t.description ?? ''}`, /remix/i, `${t.name} says nothing about remixing`);
    for (const n of ['parts_find', 'part_add', 'part_new', 'part_share']) assert.ok(names.includes(n), `tool ${n}`);
    assert.ok(by.studio_scaffold.inputSchema.properties.name && by.studio_scaffold.inputSchema.properties.folder);
    assert.ok(by.build_progress.inputSchema.properties.build);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object', t.name);
      assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} says whether it only reads`);
      assert.ok(!('run' in t));
    }
    for (const [tool, uri] of [['setup_status', 'ui://homie-studio/setup'], ['build_progress', 'ui://homie-studio/build'], ['studio_card', 'ui://homie-studio/studio'], ['game_codex', 'ui://homie-studio/codex'], ['game_lab', 'ui://homie-studio/lab']]) {
      assert.equal(by[tool]._meta.ui.resourceUri, uri);
      const read = (await s.request('resources/read', { uri })).result.contents[0];
      assert.equal(read.mimeType, 'text/html;profile=mcp-app');
      assert.match(read.text, /ui\/initialize/);
      assert.match(read.text, /ui\/notifications\/size-changed/);
      assert.doesNotMatch(read.text, /__name|<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/, 'one inline script, written as a file (never a function\'s source)');
      assert.deepEqual(read._meta.ui.csp.connectDomains, []);
      assert.ok(JSON.stringify(read).length < 200_000, `${uri} is small enough for one answer`);
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
    // 0.29.0: the first-run card offers Homie's updates as a link to homie.rocks's own sign-up, never a field here.
    assert.equal(before.structuredContent.updates, 'https://homie.rocks/updates/?from=plugin');
    assert.match(before.content[0].text, /Homie updates by email \(optional\): https:\/\/homie\.rocks\/updates\/\?from=plugin \(the person signs up there themselves/);
    assert.match(readFileSync(join(PKG, 'mcp', 'ui', 'setup.js'), 'utf8'), /Get Homie updates/);

    const made = await s.call('studio_scaffold', { name: 'Paper Comets' });
    assert.ok(!made.isError, made.content[0].text);
    const root = join(studios, 'paper-comets');
    assert.ok(existsSync(join(root, 'studio.json')));
    assert.ok(!existsSync(join(root, 'games', 'gem-rush')), 'no starter game');
    assert.match(made.content[0].text, /First game coming soon/);
    assert.equal(made.structuredContent.current.name, 'Paper Comets');
    assert.equal(made.structuredContent.checklist.find((x) => x.state === 'now').n, 2, 'planning from the request is next');
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
    assert.match(plan.content[0].text, /sensible defaults/);
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

test('a studio on an older toolkit: the card says what\'s new, and studio_run ["upgrade"] runs this newer one', async () => {
  const studios = join(scratch, 'behind');
  mkdirSync(studios, { recursive: true });
  const root = join(studios, 'night-owls');
  const made = spawnSync(process.execPath, [CLI, 'new', root, '--name', 'Night Owls', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.devDependencies['@homie-rocks/studio'] = '0.16.1';
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  // The studio's own pinned copy, as npm install left it: a stand-in that says it is the pinned one.
  const pinned = join(root, 'node_modules', '@homie-rocks', 'studio');
  mkdirSync(join(pinned, 'bin'), { recursive: true });
  writeFileSync(join(pinned, 'package.json'), JSON.stringify({ name: '@homie-rocks/studio', version: '0.16.1' }));
  writeFileSync(join(pinned, 'bin', 'homie-studio.mjs'), 'console.log(JSON.stringify({ ok: true, pinnedCopy: true }));\n');
  // No Android SDK for the standalone build below to find: none named, and none in this test's own home folder.
  const s = server(['--studios', studios, '--no-install'], { env: { ANDROID_HOME: '', ANDROID_SDK_ROOT: '' } });
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const card = await s.call('studio_card', { studio: 'night-owls' });
    assert.ok(!card.isError, card.content[0].text);
    const behind = card.structuredContent.behind;
    assert.equal(behind.pinned, '0.16.1');
    assert.equal(behind.here, STUDIO_VERSION);
    assert.equal(behind.whatsNew.versions[0].version, STUDIO_VERSION, 'newest first');
    assert.ok(behind.whatsNew.versions.length <= 6, 'the card carries a few versions');
    assert.match(card.content[0].text, /this studio pins @homie-rocks\/studio 0\.16\.1; this Homie is/);
    assert.match(card.content[0].text, /What's new since 0\.16\.1:/);
    // Every other command runs the studio's pinned copy; the upgrade runs this one, which knows what is newer.
    assert.equal((await s.call('studio_run', { args: ['games'] })).structuredContent.result.pinnedCopy, true);
    const plan = await s.call('studio_run', { args: ['upgrade'] });
    assert.ok(!plan.isError, plan.content[0].text);
    assert.equal(plan.structuredContent.result.to, STUDIO_VERSION);
    assert.equal(plan.structuredContent.result.whatsNew.from, '0.16.1');
    assert.ok(plan.structuredContent.result.changes.some((c) => c.kind === 'pin'), 'the plan moves the pin');
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@homie-rocks/studio'], '0.16.1', 'the plan changes nothing');
    // A standalone copy (0.32.0): the plan is this toolkit's, since the pinned one has no such command, and it says
    // what a standalone game does not have and that this studio's site cannot answer a copy until it upgrades and deploys.
    mkdirSync(join(root, 'games', 'comet-crews'), { recursive: true });
    writeFileSync(join(root, 'games', 'comet-crews', 'game.json'), JSON.stringify({ id: 'comet-crews', name: 'Comet Crews', players: { min: 1, max: 4 } }));
    const copy = await s.call('game_standalone', { game: 'comet-crews', plan: true, for: ['windows', 'linux'] });
    assert.ok(!copy.isError, copy.content[0].text);
    assert.equal(copy.structuredContent.kind, 'standalone-plan');
    // The run on a real phone is the same tool, and its description carries what that changes outside the computer.
    const described = (await s.request(['tools', 'list'].join('/'))).result.tools.find((x) => x.name === 'game_standalone');
    assert.equal(described.inputSchema.properties.device.type, 'boolean');
    assert.match(described.description, /device: true builds the game for the one phone plugged in[\s\S]*This adds the phone to your Apple team's list of development devices[\s\S]*only after the person said yes to that/);
    assert.match(described.description, /Quick play finds a room only when the studio's live site is on @homie-rocks\/studio 0\.32\.0 or later[\s\S]*a room made or joined by its code works with an older site too/);
    assert.deepEqual(copy.structuredContent.targets.map((t) => [t.target, t.state]), [['windows', 'ready'], ['linux', 'ready']]);
    assert.match(copy.structuredContent.toolkitNote, /pins @homie-rocks\/studio 0\.16\.1/);
    assert.match(copy.content[0].text, /What the standalone game does not have \(v1\):\n {2}- Player accounts and sign-in: /);
    assert.match(copy.content[0].text, /Say this to the person as it is/);
    assert.match(copy.content[0].text, /This studio pins @homie-rocks\/studio 0\.16\.1, from before standalone copies \(0\.32\.0\)[\s\S]*OFFLINE until the studio is upgraded to 0\.32\.0 or later AND deployed again/);
    const refusedCopy = await s.call('game_standalone', { game: 'comet-crews', plan: true, release: true });
    assert.equal(refusedCopy.isError, true, 'a release never guesses the app\'s id');
    assert.match(refusedCopy.content[0].text, /"appId": "rocks\.homie\./);
    // The build is a job (run by this toolkit: the pinned one has no such command). Here no Android SDK is to be
    // found, so it ends at once with the target skipped; what matters is that the words for the person are IN the
    // job's result, so studio_job says them (the list, what to do with it, the upgrade-and-deploy note) and not a
    // page of JSON, when a real build outlasts the tool's own wait.
    let tried = await s.call('game_standalone', { game: 'comet-crews', for: ['android'] });
    // A slow build legitimately outlasts the tool's wait. Follow the documented
    // job result before asserting failure; a running job is not a success claim.
    if (tried.structuredContent?.kind === 'job') {
      const job = tried.structuredContent.job;
      const deadline = Date.now() + 240_000;
      let finished;
      do {
        finished = await s.call('studio_job', { job });
      } while (finished.structuredContent.state === 'running' && Date.now() < deadline);
      assert.equal(finished.structuredContent.state, 'failed', finished.content[0].text);
      const result = finished.structuredContent.result;
      tried = { isError: result.ok === false, content: [{ type: 'text', text: result.say.join('\n') }], structuredContent: result };
    }
    assert.equal(tried.isError, true, 'a named target that was not built is not a success');
    const words = tried.content[0].text;
    assert.match(words, /○ android {2}SKIPPED: the Android SDK is not ready/);
    assert.match(words, /What the standalone game does not have \(v1\):/);
    assert.match(words, /from before standalone copies \(0\.32\.0\)/);
    assert.match(words, /NOT DONE: not built: android/);
    assert.ok(words.trimEnd().endsWith('Say this to the person as it is, before they ship anything: it is what a player of the standalone game does not get.'));
    assert.deepEqual(tried.structuredContent.say.join('\n'), words);
    const jobId = readdirSync(join(root, '.studio', 'mcp')).filter((n) => /^j_.*\.log$/.test(n)).map((n) => n.slice(0, -4)).find((id) => readFileSync(join(root, '.studio', 'mcp', `${id}.log`), 'utf8').includes(' standalone build comet-crews'));
    const later = await s.call('studio_job', { job: jobId });
    assert.match(later.content[0].text, /^standalone build comet-crews: failed after \d+ s/);
    assert.ok(later.content[0].text.includes(words), 'studio_job reads the same words out');
    assert.doesNotMatch(later.content[0].text, /"missing": \[/, 'never the raw result with the list buried in it');
  } finally { await s.close(); }
  // A studio on this version: no "behind".
  pkg.devDependencies['@homie-rocks/studio'] = STUDIO_VERSION;
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const again = server(['--studios', studios, '--no-install']);
  try {
    await again.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const card = await again.call('studio_card', { studio: 'night-owls' });
    assert.equal(card.structuredContent.behind, undefined);
    assert.doesNotMatch(card.content[0].text, /What's new/);
  } finally { await again.close(); }
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

/** A PNG of random noise (it does not compress): about 3 MB at 1000 x 1000. */
function noisePng(file, n = 1000) {
  const raw = Buffer.alloc(n * (n * 3 + 1));
  for (let y = 0; y < n; y++) { raw[y * (n * 3 + 1)] = 0; for (let i = 1; i <= n * 3; i++) raw[y * (n * 3 + 1) + i] = (Math.random() * 256) | 0; }
  const table = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const h = Buffer.alloc(13); h.writeUInt32BE(n, 0); h.writeUInt32BE(n, 4); h[8] = 8; h[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}

test('one answer stays under 1 MB: a 3 MB picture goes as a smaller copy (or is refused, naming it); the guard cuts the rest', async () => {
  const { fitResult, RESULT_MAX } = await import('../lib/mcp.mjs');
  const { shrinker, PICTURE_MAX } = await import('../lib/pictures.mjs');
  const studios = join(scratch, 'big-pictures');
  const s = server(['--studios', studios, '--no-install']);
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.ok(!(await s.call('studio_scaffold', { name: 'Big Pictures' })).isError);
    const root = join(studios, 'big-pictures');
    noisePng(join(root, 'big.png'));
    assert.ok(statSync(join(root, 'big.png')).size > 2.5 * 1024 * 1024, 'a picture of about 3 MB');
    const r = await s.call('file_read', { path: 'big.png' });
    assert.ok(JSON.stringify(r).length < RESULT_MAX, 'the answer is under the limit');
    if (shrinker()) {
      assert.ok(!r.isError, r.content?.[0]?.text);
      const img = r.content.find((c) => c.type === 'image');
      assert.equal(img.mimeType, 'image/jpeg');
      assert.ok(Buffer.from(img.data, 'base64').length <= PICTURE_MAX, 'a smaller JPEG copy, at most 600 KB');
      assert.match(r.content.find((c) => c.type === 'text').text, /smaller JPEG copy/);
    } else {
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /big\.png/, 'the refusal names the file');
    }
  } finally { await s.close(); }
  // The guard itself: a picture that cannot be shrunk, a card's big preview and 2 MB of text.
  const huge = { content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(1_400_000) }, { type: 'text', text: 'line\n'.repeat(400_000) }], structuredContent: { kind: 'build', feed: { preview: { image: `data:image/jpeg;base64,${'B'.repeat(300_000)}` } } } };
  const fit = fitResult(huge, { shrink: () => null });
  assert.ok(JSON.stringify(fit).length <= RESULT_MAX);
  assert.ok(!fit.content.some((c) => c.type === 'image'), 'the picture that could not be shrunk was left out');
  assert.equal(fit.structuredContent.feed.preview.image, null, 'the card keeps its data, without its picture');
  assert.match(fit.content.at(-1).text, /over 900 KB.*a picture was left out.*the card shows no pictures this time.*the text was cut/);
  const small = { content: [{ type: 'text', text: 'ok' }] };
  assert.equal(fitResult(small), small, 'an answer under the limit goes as it is');
});

test('an earlier folder of the studio\'s name is found, offered, folded in and (with a yes) moved to the Trash', async () => {
  const earlier = join(HOME, 'dev', 'personal', 'quiet-moons');
  mkdirSync(earlier, { recursive: true });
  writeFileSync(join(earlier, 'charter.md'), '# Quiet Moons\n\nA co-op night game about lanterns.\n');
  writeFileSync(join(earlier, 'decisions.md'), '- 2026-10-01: four players, one lantern each\n');
  const studios = join(scratch, 'fold');
  const s = server(['--studios', studios, '--no-install']);
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const made = await s.call('studio_scaffold', { name: 'Quiet Moons' });
    assert.ok(!made.isError, made.content[0].text);
    assert.match(made.content[0].text, /An earlier folder for this name/);
    assert.match(made.content[0].text, /ASK the person/);
    assert.deepEqual(made.structuredContent.earlier.map((e) => e.path), [realpathSync(earlier)]);
    assert.equal((await s.call('studio_fold', { from: join(HOME, 'Documents') })).isError, true, 'only the folder it found');
    const fold = await s.call('studio_fold', { from: earlier });
    assert.ok(!fold.isError, fold.content[0].text);
    assert.match(fold.content[0].text, /A co-op night game about lanterns/, 'the notes are read back, for the plan');
    assert.ok(existsSync(join(studios, 'quiet-moons', 'notes', 'earlier', 'quiet-moons', 'charter.md')));
    assert.ok(existsSync(join(earlier, 'charter.md')), 'copying leaves the old folder as it was');
    mkdirSync(join(HOME, '.Trash'), { recursive: true });
    const gone = await s.call('studio_fold', { from: earlier, remove: true });
    if (process.platform === 'darwin') {
      assert.ok(!gone.isError, gone.content[0].text);
      assert.ok(!existsSync(earlier), 'moved');
      assert.ok(readdirSync(join(HOME, '.Trash')).some((f) => f.startsWith('quiet-moons ')), 'into the Trash, to put back from there');
    } else assert.equal(gone.isError, true, 'elsewhere the person removes it themselves');
  } finally { await s.close(); }
});
