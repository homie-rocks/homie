/**
 * Homie's holds in Grok ask the same module as Codex and the Claude Code mod (hooks/lib/holds.mjs, through
 * hooks/codex.mjs). Grok's own envelope (tool names, { decision, reason }) is the only thing that differs.
 * The studio below is made up, and the secret is built at run time (the leak audit reads this file).
 *
 * Run: node --test plugins/homie/test/grok-hooks.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide } from '../hooks/codex.mjs';
import { asCodex, grokPost, grokPre, grokPrompt } from '../hooks/grok.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'grok.mjs');

const WHO = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: '' };

function studio() {
  const root = mkdtempSync(join(tmpdir(), 'homie-grok-'));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('studio.json', JSON.stringify({
    name: 'Night Owls', slug: 'night-owls', protect: ['games/*/game.json'],
    cloudflare: { worker: 'night-owls', d1: 'night-owls-db', created: ['worker:night-owls', 'd1:night-owls-db'] },
  }));
  put('games/owl-rush/game.json', '{\n  "id": "owl-rush",\n  "name": "Owl Rush"\n}\n');
  put('package.json', JSON.stringify({ name: 'night-owls', private: true, scripts: { deploy: 'echo ok' } }));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'start'], { env: WHO });
  return { root, data: join(root, '.holds'), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a Grok tool name is the call Codex decides, and a protected edit is held with Grok named', async () => {
  const s = studio();
  try {
    const payload = {
      toolName: 'search_replace',
      toolInput: { path: 'games/owl-rush/game.json', old_string: '"name": "Owl Rush"', new_string: '"name": "Owl Rush Deluxe"' },
      cwd: s.root,
      sessionId: 's1',
    };
    const mapped = asCodex(payload);
    assert.equal(mapped.tool_name, 'Edit');
    assert.ok(mapped.tool_input.file_path.endsWith('/games/owl-rush/game.json'));
    const same = await decide(mapped, { dir: s.data, app: 'codex', by: 'Codex' });
    const asGrok = await decide(mapped, { dir: s.data, app: 'grok', by: 'Grok' });
    assert.equal(asGrok?.hold?.question, same?.hold?.question);
    assert.match(asGrok.hold.question, /protect/i);
    const answer = await grokPre(payload, { dir: s.data });
    assert.equal(answer.decision, 'deny');
    assert.match(answer.reason, /proceed [A-HJKMNP-Z2-9]{4}/);
    assert.match(answer.reason, /Grok/);
    const deploy = { toolName: 'run_terminal_command', toolInput: { command: 'npm run deploy' }, cwd: s.root, sessionId: 's1' };
    const heldDeploy = await decide(asCodex(deploy), { app: 'grok', by: 'Grok' });
    const heldCodex = await decide(asCodex(deploy), { app: 'codex', by: 'Codex' });
    assert.equal(heldDeploy?.hold?.kind, heldCodex?.hold?.kind);
    assert.ok(heldDeploy?.hold, 'a production deploy is held');
  } finally { s.done(); }
});

test('search_replace is an edit, a Grok MCP name is the mcp__ name the holds match, and a read is not', () => {
  const edit = asCodex({ toolName: 'search_replace', toolInput: { path: 'games/a/src/x.js', old_string: 'a', new_string: 'b' }, cwd: '/studio' });
  assert.equal(edit.tool_name, 'Edit');
  assert.equal(edit.tool_input.file_path, '/studio/games/a/src/x.js');
  assert.equal(asCodex({ toolName: 'homie__studio_deploy', toolInput: {}, cwd: '/studio' }).tool_name, 'mcp__homie__studio_deploy');
  assert.equal(asCodex({ toolName: 'read_file', toolInput: { target_file: 'README.md' } }), null);
});

test('the person\'s own proceed answers the hold, and a secret does not reach the model', async () => {
  const s = studio();
  try {
    const payload = {
      toolName: 'search_replace',
      toolInput: { path: 'games/owl-rush/game.json', old_string: '"name": "Owl Rush"', new_string: '"name": "Owl Rush Deluxe"' },
      cwd: s.root,
      sessionId: 's2',
    };
    const held = await grokPre(payload, { dir: s.data });
    const code = /proceed ([A-HJKMNP-Z2-9]{4})/.exec(held.reason)[1];
    const said = await grokPrompt({ sessionId: 's2', prompt: `proceed ${code}` }, { dir: s.data });
    assert.match(said.hookSpecificOutput.additionalContext, new RegExp(`proceed to Homie hold ${code}`));
    assert.equal((await grokPre(payload, { dir: s.data })).decision, 'allow');
    const secret = `sk_test_${'notasecretkey'.repeat(2)}`;
    const redacted = await grokPost({
      toolName: 'run_terminal_command', toolInput: { command: 'echo hi' }, cwd: s.root, sessionId: 's2', toolResponse: `token ${secret} done`,
    }, { dir: s.data });
    assert.equal(redacted.decision, 'block');
    assert.doesNotMatch(redacted.reason, /sk_test_/);
    assert.match(redacted.reason, /hidden by Homie/);
  } finally { s.done(); }
});

test('through stdin and stdout as Grok Build runs it: the answer is Grok\'s, and every run leaves the mark the setup status reads', () => {
  const s = studio();
  try {
    // The mark goes to a folder of this test's, never to the cache of whoever runs the tests.
    const marks = join(s.data, 'marks');
    const env = { ...process.env, GROK_PLUGIN_DATA: s.data, HOMIE_HOLDS_MARKS: marks };
    const run = (mode, input) => spawnSync(process.execPath, [SCRIPT, mode], { input: JSON.stringify(input), env, encoding: 'utf8' });
    const read = run('pre', { toolName: 'run_terminal_command', toolInput: { command: 'ls' }, cwd: s.root, sessionId: 's3' });
    assert.equal(read.status, 0);
    assert.deepEqual(JSON.parse(read.stdout), { decision: 'allow' });
    const left = JSON.parse(readFileSync(join(marks, 'grok.json'), 'utf8'));
    assert.deepEqual(Object.keys(left).sort(), ['app', 'at', 'event', 'v']);
    assert.deepEqual({ v: left.v, app: left.app, event: left.event }, { v: 1, app: 'grok', event: 'pre' });
    const held = JSON.parse(run('pre', { toolName: 'run_terminal_command', toolInput: { command: 'npm run deploy' }, cwd: s.root, sessionId: 's3' }).stdout);
    assert.equal(held.decision, 'deny');
    assert.match(held.reason, /proceed [A-HJKMNP-Z2-9]{4}/);
    run('prompt', { sessionId: 's3', prompt: 'hello' });
    assert.equal(JSON.parse(readFileSync(join(marks, 'grok.json'), 'utf8')).event, 'prompt');
  } finally { s.done(); }
});
