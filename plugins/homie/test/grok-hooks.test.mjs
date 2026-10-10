/**
 * Homie's holds in Grok ask the same module as Codex and the Claude Code mod (hooks/lib/holds.mjs, through
 * hooks/codex.mjs). Grok's own envelope (tool names, { decision, reason }) is the only thing that differs.
 * The studio below is made up, and the secret is built at run time.
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
    assert.match(said.said, new RegExp(`proceed to Homie hold ${code}`));
    assert.equal((await grokPre(payload, { dir: s.data })).decision, 'allow');
    const secret = `sk_test_${'notasecretkey'.repeat(2)}`;
    const redacted = await grokPost({
      toolName: 'run_terminal_command', toolInput: { command: 'echo hi' }, cwd: s.root, sessionId: 's2', toolResponse: `token ${secret} done`,
    }, { dir: s.data });
    assert.equal(redacted.decision, undefined, 'a PostToolUse "block" only adds a line beside the output; the output is replaced instead');
    assert.doesNotMatch(JSON.stringify(redacted), /sk_test_/);
    assert.match(redacted.hookSpecificOutput.updatedToolOutput, /hidden by Homie/);
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

/*
 * GROK'S OWN CONTRACT (its hooks guide, read at Grok 1.0.46), fed through stdin and read from stdout as Grok does:
 * the event in camelCase (`hookEventName`, `hook_event_name`, `toolName`, `toolInput`, `sessionId`, `cwd`,
 * `workspaceRoot`, `toolUseId`; after a tool `toolResult` with its `tool_response` copy), a PreToolUse answer of
 * { decision: "allow" | "deny", reason }, and a PostToolUse answer whose `hookSpecificOutput.updatedToolOutput`
 * (a string) replaces what the model reads. Any failure of a hook lets the call through, so every answer here is
 * explicit and the script exits 0.
 */
test('Grok\'s documented shapes: a pass, a hold, the person\'s proceed, a refusal and a redaction', () => {
  const s = studio();
  try {
    const marks = join(s.data, 'marks');
    const env = { ...process.env, GROK_PLUGIN_DATA: s.data, HOMIE_HOLDS_MARKS: marks, GROK_SESSION_ID: 's9' };
    const event = (name, more) => ({
      hookEventName: name.replace(/[A-Z]/g, (c, i) => `${i ? '_' : ''}${c.toLowerCase()}`), hook_event_name: name, sessionId: 's9', cwd: s.root,
      workspaceRoot: s.root, permissionMode: 'default', promptId: 'p1', timestamp: '2026-10-06T12:00:00Z', ...more,
    });
    const tool = (name, toolName, toolInput, more = {}) => event(name, { toolName, toolInput, toolUseId: 'call-1', toolInputTruncated: false, ...more });
    const run = (mode, input) => {
      const r = spawnSync(process.execPath, [SCRIPT, mode], { input: JSON.stringify(input), env, encoding: 'utf8' });
      assert.equal(r.status, 0, `${mode} exits 0: any other exit lets the call through unchecked (${r.stderr})`);
      return r.stdout ? JSON.parse(r.stdout) : null;
    };

    // A pass: exactly { decision: "allow" }.
    assert.deepEqual(run('pre', tool('PreToolUse', 'run_terminal_command', { command: 'npm test' })), { decision: 'allow' });
    assert.deepEqual(run('pre', tool('PreToolUse', 'read_file', { target_file: 'studio.json' })), { decision: 'allow' });

    // A hold: { decision: "deny", reason }, the reason carrying the code and what it holds. For the shell tool and
    // for the plugin's MCP tool under Grok's `server__tool` name.
    const deploy = tool('PreToolUse', 'run_terminal_command', { command: 'npm run deploy' });
    const held = run('pre', deploy);
    assert.deepEqual(Object.keys(held).sort(), ['decision', 'reason']);
    assert.equal(held.decision, 'deny');
    assert.match(held.reason, /Held by Homie for the person's Proceed \(hold [A-HJKMNP-Z2-9]{4}\): Deploy Night Owls to production\?/);
    assert.match(held.reason, /Run as Grok wrote it: homie-studio deploy/);
    const code = /proceed ([A-HJKMNP-Z2-9]{4})/.exec(held.reason)[1];
    const mcp = run('pre', tool('PreToolUse', 'homie__studio_deploy', {}));
    assert.equal(mcp.decision, 'deny');
    assert.match(mcp.reason, /Deploy Night Owls to production\?/);

    // The person's own message answers it. Grok discards what an allowing prompt hook prints, and would read a
    // "block" as "refuse this prompt": nothing is printed, and the same call then goes through, once.
    assert.equal(run('prompt', event('UserPromptSubmit', { prompt: 'hello there' })), null);
    assert.equal(run('prompt', event('UserPromptSubmit', { prompt: `proceed ${code}` })), null, 'the answer is recorded, nothing is printed');
    assert.deepEqual(run('pre', deploy), { decision: 'allow' });
    assert.equal(run('pre', deploy).decision, 'allow', 'approval covers retries in this task');
    run('prompt', event('UserPromptSubmit', { prompt: 'Do not deploy this again.' }));
    // The model cannot answer for the person: a proceed inside a tool call is not a prompt.
    assert.equal(run('pre', tool('PreToolUse', 'run_terminal_command', { command: `echo proceed ${code} && npm run deploy` })).decision, 'deny');

    // A refusal: a deny with no code, and nothing to proceed.
    mkdirSync(join(s.root, 'games', 'owl-rush', 'assets'), { recursive: true });
    writeFileSync(join(s.root, 'games', 'owl-rush', 'assets', 'big.bin'), Buffer.alloc(6 * 1024 * 1024));
    const refused = run('pre', tool('PreToolUse', 'run_terminal_command', { command: 'git add games/owl-rush/assets/big.bin' }));
    assert.equal(refused.decision, 'deny');
    assert.match(refused.reason, /^Refused by Homie: Not run: games\/owl-rush\/assets\/big\.bin \(6\.0 MB\) is over 5 MB/);
    assert.doesNotMatch(refused.reason, /proceed [A-HJKMNP-Z2-9]{4}/);

    // A redaction: Grok hands the shell tool's own result object (and a `tool_response` copy of it); the answer
    // replaces the model's copy with a string, which Grok takes verbatim for every tool. No "block": that would
    // only add a line beside the output and leave the secret in it.
    const secret = `sk_test_${'notasecretkey'.repeat(2)}`;
    const result = { type: 'Bash', command: 'cat .env', exit_code: 0, output_for_prompt: `STRIPE=${secret}\nready` };
    const redacted = run('post', tool('PostToolUse', 'run_terminal_command', { command: 'cat .env' }, { toolResult: result, tool_response: result, toolResultTruncated: false }));
    assert.deepEqual(Object.keys(redacted), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(redacted.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName', 'updatedToolOutput']);
    assert.equal(redacted.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.equal(typeof redacted.hookSpecificOutput.updatedToolOutput, 'string');
    assert.match(redacted.hookSpecificOutput.updatedToolOutput, /^STRIPE=.*hidden by Homie.*\nready\n/, 'the output the model would have read, with the secret out of it');
    assert.match(redacted.hookSpecificOutput.additionalContext, /out of what Grok reads/);
    assert.doesNotMatch(JSON.stringify(redacted), /sk_test_|Codex/);
    // A result too big for Grok to send typed arrives as the model-facing text itself, a string.
    const big = run('post', tool('PostToolUse', 'run_terminal_command', { command: 'cat .env' }, { toolResult: `STRIPE=${secret}`, toolResultTruncated: true }));
    assert.doesNotMatch(big.hookSpecificOutput.updatedToolOutput, /sk_test_/);
    // An MCP tool's result: the MCP spelling of the key rides along.
    const viaMcp = run('post', tool('PostToolUse', 'homie__studio_run', {}, { toolResult: { content: [{ type: 'text', text: `key ${secret}` }] } }));
    assert.equal(viaMcp.hookSpecificOutput.updatedMCPToolOutput, viaMcp.hookSpecificOutput.updatedToolOutput);
    assert.doesNotMatch(JSON.stringify(viaMcp), /sk_test_/);
    // Nothing secret: nothing printed, and the model reads the tool's own output.
    assert.equal(run('post', tool('PostToolUse', 'run_terminal_command', { command: 'ls' }, { toolResult: { type: 'Bash', command: 'ls', exit_code: 0, output_for_prompt: 'studio.json' } })), null);

    // A payload that cannot be read is not a pass: Grok lets a failed hook's call through, so the answer is an
    // explicit deny (before a call) or a replaced output (after one), still with exit 0.
    const broken = (mode) => { const r = spawnSync(process.execPath, [SCRIPT, mode], { input: '{not json', env, encoding: 'utf8' }); assert.equal(r.status, 0); return JSON.parse(r.stdout); };
    assert.equal(broken('pre').decision, 'deny');
    assert.match(broken('pre').reason, /could not check this call/);
    assert.match(broken('post').hookSpecificOutput.updatedToolOutput, /could not check this output for secrets .* so it was withheld/);
  } finally { s.done(); }
});
