import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeIo, pre, prompt } from '../hooks/codex.mjs';
import { grokPre, grokPrompt } from '../hooks/grok.mjs';
import { register } from '../hooks/homie.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/deploy-task/${name}.json`, import.meta.url)));

for (const host of ['codex', 'grok', 'claude']) test(`${host}: recorded task request, unrelated follow-up, retry, revocation and studio scope`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'homie-task-'));
  const other = mkdtempSync(join(tmpdir(), 'homie-other-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); });
  for (const path of [root, other]) writeFileSync(join(path, 'studio.json'), '{"name":"Scratch","slug":"scratch"}');
  const io = nodeIo(); const opts = { dir: join(root, 'holds'), io };
  let say, deploy;
  if (host === 'claude') {
    const handlers = [];
    register((name, filter, fn) => { handlers.push({ name, filter: typeof filter === 'function' ? null : filter, fn: fn ?? filter }); return { catch() {} }; });
    const $ = { fs: io, session: { cwd: async () => root, surfaces: async () => [] }, command: { register: async () => {} }, clock: { every() {} }, store: { get: async () => null }, process: { run: io.run }, ui: { ask: async () => null, log() {}, close() {} } };
    const next = async () => ({ result: { stdout: '' } });
    await handlers.find(h => h.name === 'session.start').fn($, { cwd: root, isInteractive: false }, next);
    say = text => handlers.find(h => h.name === 'prompt.submit').fn($, { ...fixture('claude-prompt'), text }, next);
    deploy = async (cwd = root) => (await handlers.find(h => h.name === 'tool.call' && h.filter?.tool === 'Bash').fn($, { tool: 'Bash', command: cwd === root ? 'npm run deploy' : `cd ${cwd} && npm run deploy` }, next))?.deny ? false : true;
  } else {
    const p = host === 'codex' ? fixture('codex-UserPromptSubmit') : fixture('grok-prompt');
    const call = host === 'codex' ? fixture('codex-PreToolUse') : fixture('grok-pre');
    say = text => host === 'codex' ? prompt({ ...p, cwd: root, prompt: text }, opts) : grokPrompt({ ...p, cwd: root, userPrompt: text }, opts);
    deploy = async (cwd = root) => { const out = await (host === 'codex' ? pre : grokPre)({ ...call, cwd, transcript_path: null }, opts); return host === 'codex' ? out === null : out.decision === 'allow'; };
  }
  assert.equal(await deploy(), false, 'unsolicited deploy held');
  await say(fixture('claude-prompt').text);
  assert.equal(await deploy(), true);
  await say('Fix that last check.');
  assert.equal(await deploy(), true, 'the original task still applies');
  assert.equal(await deploy(other), false, 'only the requested studio');
  await say('Do not deploy.');
  assert.equal(await deploy(), false, 'revoked');
});
