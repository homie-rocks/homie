/**
 * Homie's holds in Codex (hooks/codex.mjs, hooks/codex.json): the hook script on a real studio folder, fed the JSON
 * Codex sends (PreToolUse, UserPromptSubmit, PostToolUse, as Codex 0.156.1 and 0.160.0 send them) and read back the
 * way Codex reads it. Codex refuses a hook answer with a field it does not know and then lets the call run, so every
 * answer here is checked against the fields Codex accepts. Also: apply_patch read into files (hooks/lib/patch.mjs),
 * the decisions coming from the same module as the Claude Code mod's (hooks/lib/holds.mjs), and the manifests that
 * make Codex run the hooks at all.
 *
 * Nothing reaches a provider: the art skill here is a stand-in whose --dry-run names a made-up price, and every key
 * below is made up and built at run time.
 *
 * Run: node --test plugins/homie/test/codex-hooks.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { answersIn, callOf, check, decide, fingerprint, post, pre, prompt } from '../hooks/codex.mjs';
import { MCP_TOOLS } from '../hooks/lib/holds.mjs';
import { applyChunks, parsePatch, patchChanges } from '../hooks/lib/patch.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(PLUGIN, 'hooks', 'codex.mjs');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
// git commits in the studios below, by nobody in particular.
const WHO = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: '' };

// What Codex accepts in each hook's answer (codex-rs/hooks/schema/generated/*.command.output.schema.json).
const TOP = { PreToolUse: ['continue', 'decision', 'hookSpecificOutput', 'reason', 'stopReason', 'suppressOutput', 'systemMessage'] };
TOP.PostToolUse = TOP.PreToolUse;
TOP.UserPromptSubmit = TOP.PreToolUse;
const INNER = {
  PreToolUse: ['additionalContext', 'hookEventName', 'permissionDecision', 'permissionDecisionReason', 'updatedInput'],
  PostToolUse: ['additionalContext', 'hookEventName', 'updatedMCPToolOutput'],
  UserPromptSubmit: ['additionalContext', 'hookEventName'],
};
function codexTakes(event, out) {
  if (out === null) return;
  for (const k of Object.keys(out)) assert.ok(TOP[event].includes(k), `${event}: Codex knows "${k}"`);
  if (out.hookSpecificOutput) {
    for (const k of Object.keys(out.hookSpecificOutput)) assert.ok(INNER[event].includes(k), `${event}.hookSpecificOutput: Codex knows "${k}"`);
    assert.equal(out.hookSpecificOutput.hookEventName, event);
  }
  // Codex 0.156.1 and 0.160.0 refuse "ask" (and "allow" without updatedInput) as unsupported, and then run the call.
  assert.ok(!['ask', 'allow'].includes(out.hookSpecificOutput?.permissionDecision), 'never "ask" or a bare "allow"');
  if (event === 'PostToolUse') assert.ok(!('updatedMCPToolOutput' in (out.hookSpecificOutput ?? {})), 'updatedMCPToolOutput is unsupported in Codex');
}

/** A studio on disk, the way a person's looks, in git. */
function studio() {
  const root = mkdtempSync(join(tmpdir(), 'homie-codex-'));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('studio.json', JSON.stringify({
    name: 'Night Owls', slug: 'night-owls', protect: ['games/*/game.json'], budget: { usd: 1 },
    cloudflare: { worker: 'night-owls', d1: 'night-owls-db', created: ['worker:night-owls', 'd1:night-owls-db'] },
  }));
  put('games/owl-rush/game.json', '{\n  "id": "owl-rush",\n  "name": "Owl Rush"\n}\n');
  put('games/owl-rush/src/main.ts', 'export const speed = 4;\n');
  put('games/owl-rush/codex/decisions.json', JSON.stringify({ v: 1, decisions: { palette: { value: ['#101820', '#ffcf5a'], state: 'locked', by: 'person' }, camera: { value: 'top', state: 'auto' } } }, null, 2));
  put('package.json', JSON.stringify({ name: 'night-owls', private: true, scripts: { deploy: 'echo Live: https://night-owls.example.invalid' } }));
  put('art/cover/budget.json', JSON.stringify({ provider: 'fal', unit: 'usd', cap: 0.5, spent: 0.3, calls: [] }));
  put('art/skyline/budget.json', JSON.stringify({ provider: 'fal', unit: 'usd', cap: 5, spent: 0, calls: [] }));
  put('skills/art/scripts/art.mjs', "if (process.argv.includes('--dry-run')) console.log(JSON.stringify({ ok: true, dryRun: true, price: { usd: 0.25, basis: 'made up' } })); else console.log('stand-in');\n");
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'start'], { env: WHO });
  const data = join(root, '.holds-data');
  return { root, data, done: () => rmSync(root, { recursive: true, force: true }) };
}

const PATCH = '*** Begin Patch\n*** Update File: games/owl-rush/game.json\n@@\n   "id": "owl-rush",\n-  "name": "Owl Rush"\n+  "name": "Owl Rush Deluxe"\n }\n*** End Patch';
const payload = (s, tool_name, tool_input, over = {}) => ({ session_id: 'session-1', turn_id: 't1', cwd: s.root, hook_event_name: 'PreToolUse', model: 'm', permission_mode: 'default', tool_name, tool_input, tool_use_id: 'call_1', transcript_path: null, ...over });
const bash = (s, command, over) => payload(s, 'Bash', { command }, over);
const codeOf = (out) => /\(hold ([A-Z0-9]{4})\)/.exec(out.hookSpecificOutput.permissionDecisionReason)?.[1];

test('patch: an update, an add, a delete and a move are read into files, and applied as Codex applies them', () => {
  const files = parsePatch(`*** Begin Patch\n*** Add File: a/new.md\n+hello\n+there\n*** Update File: b.json\n*** Move to: c.json\n@@ "x": 1,\n-  "y": 2\n+  "y": 3\n*** Delete File: old.txt\n*** End Patch`);
  assert.deepEqual(files.map((f) => [f.op, f.path, f.to]), [['add', 'a/new.md', null], ['update', 'b.json', 'c.json'], ['delete', 'old.txt', null]]);
  assert.equal(applyChunks('{\n  "x": 1,\n  "y": 2\n}\n', files[1].chunks), '{\n  "x": 1,\n  "y": 3\n}\n');
  // Codex matches a line without its trailing spaces, then trimmed; a chunk that matches nothing does not apply.
  assert.equal(applyChunks('{\n  "x": 1,  \n  "y": 2   \n}\n', files[1].chunks), '{\n  "x": 1,  \n  "y": 3\n}\n');
  assert.equal(applyChunks('{\n  "z": 9\n}\n', files[1].chunks), null);
  const changes = patchChanges(PATCH, '/s');
  assert.equal(changes[0].path, '/s/games/owl-rush/game.json');
  assert.equal(changes[0].apply('{\n  "id": "owl-rush",\n  "name": "Owl Rush"\n}\n'), '{\n  "id": "owl-rush",\n  "name": "Owl Rush Deluxe"\n}\n');
  const moved = patchChanges('*** Begin Patch\n*** Update File: x.json\n*** Move to: games/owl-rush/game.json\n@@\n-a\n+b\n*** End Patch', '/s');
  assert.deepEqual(moved.map((c) => [c.op, c.path, c.from ?? null]), [['move', '/s/x.json', null], ['move-to', '/s/games/owl-rush/game.json', '/s/x.json']]);
  assert.equal(parsePatch('not a patch'), null);
});

test('a call as Codex sends it: Bash, apply_patch (a tool or a shell heredoc) and MCP tools', () => {
  assert.deepEqual(callOf({ tool_name: 'Bash', tool_input: { command: 'npm run deploy' }, cwd: '/s' }), { kind: 'shell', command: 'npm run deploy' });
  assert.equal(callOf({ tool_name: 'apply_patch', tool_input: { command: PATCH }, cwd: '/s' }).kind, 'edit');
  assert.equal(callOf({ tool_name: 'Bash', tool_input: { command: `apply_patch <<'EOF'\n${PATCH}\nEOF` }, cwd: '/s' }).kind, 'edit');
  assert.equal(callOf({ tool_name: 'mcp__fal__run_model', tool_input: { endpoint_id: 'x' } }).kind, 'mcp');
  assert.equal(callOf({ tool_name: 'web_search', tool_input: {} }), null);
});

test('a protected file: held with a code; the person\'s own "proceed <code>" lets that exact patch through once', async () => {
  const s = studio();
  try {
    const p = payload(s, 'apply_patch', { command: PATCH });
    const held = await pre(p, { dir: s.data });
    codexTakes('PreToolUse', held);
    assert.equal(held.hookSpecificOutput.permissionDecision, 'deny');
    const reason = held.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /Held by Homie for the person's Proceed \(hold [A-Z0-9]{4}\): Change games\/owl-rush\/game\.json, which the studio protects\?/);
    assert.match(reason, /Rule: studio\.json "protect": "games\/\*\/game\.json"/);
    assert.match(reason, /-  "name": "Owl Rush"\n.*\+  "name": "Owl Rush Deluxe"/s);
    const code = codeOf(held);
    assert.match(held.systemMessage, new RegExp(`Reply "proceed ${code}"`));
    // The same call again, unanswered: the same code, still held.
    assert.equal(codeOf(await pre(p, { dir: s.data })), code);
    // Only the person's own message answers it; in the same session.
    assert.equal(await prompt({ session_id: 'session-2', prompt: `proceed ${code}` }, { dir: s.data }), null, 'another session cannot answer it');
    const said = await prompt({ session_id: 'session-1', prompt: `Yes, proceed ${code.toLowerCase()}` }, { dir: s.data });
    codexTakes('UserPromptSubmit', said);
    assert.match(said.hookSpecificOutput.additionalContext, /The person said proceed to Homie hold/);
    // A different patch is not the one they said yes to.
    const other = payload(s, 'apply_patch', { command: PATCH.replace('Deluxe', 'Supreme') });
    assert.equal((await pre(other, { dir: s.data })).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(await pre(p, { dir: s.data }), null, 'the exact patch goes through');
    assert.notEqual(codeOf(await pre(p, { dir: s.data })), code, 'once: the next one is a new hold');
    // An unprotected file is not held.
    assert.equal(await pre(payload(s, 'apply_patch', { command: '*** Begin Patch\n*** Update File: games/owl-rush/src/main.ts\n@@\n-export const speed = 4;\n+export const speed = 5;\n*** End Patch' }), { dir: s.data }), null);
  } finally { s.done(); }
});

test('cancel refuses it with the mod\'s words; a bare "proceed" answers only when one hold waits', async () => {
  const s = studio();
  try {
    const p = bash(s, 'npx wrangler d1 delete night-owls-db');
    const held = await pre(p, { dir: s.data });
    assert.match(held.hookSpecificOutput.permissionDecisionReason, /Delete something on Cloudflare for Night Owls, outside the studio's deploy\?/);
    assert.match(held.hookSpecificOutput.permissionDecisionReason, /Studio's own: D1 database night-owls-db/);
    await prompt({ session_id: 'session-1', prompt: `cancel ${codeOf(held)}` }, { dir: s.data });
    const no = await pre(p, { dir: s.data });
    assert.match(no.hookSpecificOutput.permissionDecisionReason, /^Refused by Homie: The person said no to this Cloudflare change \(wrangler d1 delete\)/);
    assert.ok(!/\.$/.test(no.hookSpecificOutput.permissionDecisionReason), 'no full stop: Codex adds ". Command: …"');

    const a = bash(s, 'npm run deploy');
    await pre(a, { dir: s.data });
    assert.ok((await prompt({ session_id: 'session-1', prompt: 'proceed' }, { dir: s.data })).hookSpecificOutput.additionalContext.includes('Deploy Night Owls'));
    assert.equal(await pre(a, { dir: s.data }), null);
    await pre(bash(s, 'npm run deploy'), { dir: s.data });
    await pre(bash(s, 'npx wrangler secret put STRIPE_KEY'), { dir: s.data });
    assert.equal(await prompt({ session_id: 'session-1', prompt: 'proceed' }, { dir: s.data }), null, 'two waiting: a bare proceed answers neither');
    assert.deepEqual(answersIn('ok, proceed H7K2 and cancel ZZ34'), [{ verb: 'proceed', code: 'H7K2' }, { verb: 'cancel', code: 'ZZ34' }]);
    assert.deepEqual(answersIn('please proceed with the plan'), [], 'a code has no I, L, O, 0 or 1');
    assert.deepEqual(answersIn('Proceed.'), [{ verb: 'proceed', code: null }]);
    assert.deepEqual(answersIn('how do I proceed?'), []);
  } finally { s.done(); }
});

test('refused outright, nobody asked: a locked decision, an unlicensed asset in a deploy, a big file into git, a Stripe webhook secret', async () => {
  const s = studio();
  try {
    const lock = await pre(payload(s, 'apply_patch', { command: '*** Begin Patch\n*** Update File: games/owl-rush/codex/decisions.json\n@@\n-      "#ffcf5a"\n+      "#ff0000"\n*** End Patch' }), { dir: s.data });
    assert.match(lock.hookSpecificOutput.permissionDecisionReason, /^Refused by Homie: palette is locked by the person; change it with homie-studio style set owl-rush palette/);
    assert.ok(!lock.systemMessage, 'a refusal has no code to answer');
    const gone = await pre(payload(s, 'apply_patch', { command: '*** Begin Patch\n*** Delete File: games/owl-rush/codex/decisions.json\n*** End Patch' }), { dir: s.data });
    assert.match(gone.hookSpecificOutput.permissionDecisionReason, /would leave it unreadable/);

    mkdirSync(join(s.root, 'games/owl-rush/assets'), { recursive: true });
    writeFileSync(join(s.root, 'games/owl-rush/assets/manifest.json'), JSON.stringify({ v: 1, assets: [{ id: 'knight', file: 'knight.glb', licence: { kind: 'turbosquid' } }] }));
    const deploy = await pre(bash(s, 'npm run deploy'), { dir: s.data });
    assert.match(deploy.hookSpecificOutput.permissionDecisionReason, /^Refused by Homie: Not deployed: 1 asset in a public game has no allowed licence/);

    writeFileSync(join(s.root, 'games/owl-rush/big.glb'), Buffer.alloc(6 * 1024 * 1024));
    const big = await pre(bash(s, 'git add games/owl-rush/big.glb'), { dir: s.data });
    assert.match(big.hookSpecificOutput.permissionDecisionReason, /games\/owl-rush\/big\.glb \(6\.0 MB\) is over 5 MB under games\//);

    const hook = await pre(payload(s, 'mcp__plugin_stripe_stripe__stripe_api_write', { method: 'POST', path: '/v1/webhook_endpoints', params: { url: 'https://night-owls.example.invalid/api/shop/hook' } }), { dir: s.data });
    assert.match(hook.hookSpecificOutput.permissionDecisionReason, /homie-studio shop connect/);
  } finally { s.done(); }
});

test('paid calls: past the budget held with the skill\'s own price, inside it through with a line for the person, a provider\'s own CLI or MCP run held', async () => {
  const s = studio();
  try {
    const over = await pre(bash(s, 'node skills/art/scripts/art.mjs gen cover --model fal-ai/flux/dev --input in.json --out cover.png --yes'), { dir: s.data });
    assert.match(over.hookSpecificOutput.permissionDecisionReason, /Spend about \$0\.25 at fal, past the budget\?/);
    assert.match(over.hookSpecificOutput.permissionDecisionReason, /Budget: this job's cap \(art\/cover\): \$0\.30 of \$0\.50 spent → \$0\.55, over by \$0\.05/);
    const inside = await pre(bash(s, 'node skills/art/scripts/art.mjs gen skyline --model fal-ai/flux/dev --input in.json --out sky.png --yes'), { dir: s.data });
    codexTakes('PreToolUse', inside);
    assert.deepEqual(Object.keys(inside), ['systemMessage']);
    assert.match(inside.systemMessage, /^Homie: fal: about \$0\.25/);
    assert.equal(await pre(bash(s, 'node skills/art/scripts/art.mjs gen skyline --model fal-ai/flux/dev'), { dir: s.data }), null, 'without --yes it only prices');
    for (const command of ['fal api fal-ai/flux/dev prompt="an owl"', 'elevenlabs music compose --format json --json -', 'curl -X POST https://queue.fal.run/fal-ai/flux/dev -d @in.json']) {
      assert.match((await pre(bash(s, command), { dir: s.data })).hookSpecificOutput.permissionDecisionReason, /whose cost could not be read first\?/, command);
    }
    assert.match((await pre(payload(s, 'mcp__fal__run_model', { endpoint_id: 'fal-ai/flux/dev', input: { prompt: 'an owl' } }), { dir: s.data })).hookSpecificOutput.permissionDecisionReason, /Make a paid fal call/);
    assert.equal(await pre(payload(s, 'mcp__fal__get_pricing', { endpoint_id: 'fal-ai/flux/dev' }), { dir: s.data }), null);
    assert.match((await pre(bash(s, 'ollama pull clef-flash'), { dir: s.data })).hookSpecificOutput.permissionDecisionReason, /Download clef-flash \(about 11 GB\) to this computer with Ollama\?/);
  } finally { s.done(); }
});

test('Cloudflare\'s MCP: a delete or a write held, a read through; and the switches turn each part off', async () => {
  const s = studio();
  try {
    const del = await pre(payload(s, 'mcp__cloudflare__execute', { code: 'async () => cloudflare.request({ method: "DELETE", path: `/accounts/${id}/workers/scripts/night-owls` })' }), { dir: s.data });
    assert.match(del.hookSpecificOutput.permissionDecisionReason, /Delete something on Cloudflare for Night Owls/);
    assert.match(del.hookSpecificOutput.permissionDecisionReason, /Studio's own: Worker night-owls/);
    assert.equal(await pre(payload(s, 'mcp__cloudflare__execute', { code: 'cloudflare.request({ method: "GET", path: "/x" })' }), { dir: s.data }), null);
    assert.equal(await pre(payload(s, 'mcp__claude_ai_Cloudflare_Developer_Platform__workers_list', {}), { dir: s.data }), null);
    const off = { guardFiles: false, guardDeploys: false, guardSpend: false };
    for (const p of [payload(s, 'apply_patch', { command: PATCH }), bash(s, 'npm run deploy'), bash(s, 'npx wrangler d1 delete night-owls-db'), bash(s, 'fal api x')]) {
      assert.equal(await pre(p, { dir: s.data, guards: off }), null, p.tool_input.command);
    }
    // Outside a studio, a deploy and a Cloudflare change are not Homie's to hold (a paid call still is).
    const elsewhere = { ...s, root: tmpdir() };
    assert.equal(await pre(bash(elsewhere, 'npx wrangler d1 delete something'), { dir: s.data }), null);
  } finally { s.done(); }
});

test('secrets out of what the model reads: a shell result and an MCP result, in the answer Codex takes', async () => {
  const s = studio();
  try {
    const fal = ['0'.repeat(8), '1'.repeat(4), '2'.repeat(4), '3'.repeat(4), '4'.repeat(12)].join('-') + ':' + 'f'.repeat(32);
    const office = `hsk_${'0123456789abcdef'.repeat(3)}`;
    const out = await post({ ...bash(s, 'npx --no-install homie-studio office key'), hook_event_name: 'PostToolUse', tool_response: `Office key: ${office}\nFAL_KEY=${fal}\n` }, { dir: s.data });
    codexTakes('PostToolUse', out);
    assert.equal(out.continue, false, 'continue:false + reason: Codex hands the model `reason` in place of the output, and the turn goes on');
    assert.ok(!out.reason.includes(office) && !out.reason.includes(fal));
    assert.match(out.reason, /\[office key hidden by Homie\][\s\S]*FAL_KEY=\[fal key hidden by Homie\]/);
    assert.match(out.reason, /took secrets \(office key, fal key\)/);
    const link = `https://night-owls.example.invalid/_studio/signin?k=${office}`;
    const mcp = await post({ ...payload(s, 'mcp__homie__studio_office', {}), hook_event_name: 'PostToolUse', tool_response: { content: [{ type: 'text', text: `Open ${link}` }] } }, { dir: s.data });
    assert.ok(!mcp.reason.includes(office));
    assert.match(mcp.reason, /one-time owner link is in the command's own output on the person's screen/);
    assert.equal(await post({ ...bash(s, 'ls'), hook_event_name: 'PostToolUse', tool_response: 'game.json\n' }, { dir: s.data }), null);
    assert.equal(await post({ ...bash(s, 'cat .env'), hook_event_name: 'PostToolUse', tool_response: `FAL_KEY=${fal}` }, { dir: s.data, redactSecrets: false }), null);
  } finally { s.done(); }
});

test('a deploy that went live is remembered, so the next deploy\'s hold says what changed since', async () => {
  const s = studio();
  try {
    await post({ ...bash(s, 'npm run deploy'), hook_event_name: 'PostToolUse', tool_response: '\n> deploy\nLive: https://night-owls.example.invalid\n' }, { dir: s.data });
    const state = json(join(s.data, 'holds.json'));
    assert.match(state.deployed[s.root].commit, /^[0-9a-f]{40}$/);
    writeFileSync(join(s.root, 'games/owl-rush/src/main.ts'), 'export const speed = 6;\n');
    execFileSync('git', ['-C', s.root, 'commit', '-qam', 'Faster owls'], { env: WHO });
    const held = await pre(bash(s, 'npm run deploy'), { dir: s.data });
    assert.match(held.hookSpecificOutput.permissionDecisionReason, /Commits: 1 since then: Faster owls/);
    assert.match(held.hookSpecificOutput.permissionDecisionReason, /Run as Codex wrote it: homie-studio deploy/);
  } finally { s.done(); }
});

test('through stdin and stdout as Codex runs it; a check that fails refuses the call (Codex would run it)', () => {
  const s = studio();
  try {
    // The mark that the hooks ran goes to a folder of this test's, never to the cache of whoever runs the tests.
    const marks = join(s.data, 'marks');
    const env = { ...process.env, PLUGIN_DATA: s.data, HOMIE_HOLDS_MARKS: marks };
    const run = (mode, input) => spawnSync(process.execPath, [SCRIPT, mode], { input, env, encoding: 'utf8' });
    const before = Date.now();
    const held = run('pre', JSON.stringify(payload(s, 'apply_patch', { command: PATCH })));
    assert.equal(held.status, 0);
    // Every run leaves the dated mark `homie-studio setup status` reads: the app, the time and the hook, nothing else.
    const left = json(join(marks, 'codex.json'));
    assert.deepEqual(Object.keys(left).sort(), ['app', 'at', 'event', 'v']);
    assert.deepEqual({ v: left.v, app: left.app, event: left.event }, { v: 1, app: 'codex', event: 'pre' });
    assert.ok(left.at >= before && left.at <= Date.now(), 'dated now');
    assert.ok(!JSON.stringify(left).includes(s.root), 'no folder in it');
    run('prompt', JSON.stringify({ session_id: 'session-1', prompt: 'hello' }));
    assert.equal(json(join(marks, 'codex.json')).event, 'prompt', 'a message marks it too');
    const out = JSON.parse(held.stdout);
    codexTakes('PreToolUse', out);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(json(join(s.data, 'holds.json')).holds[0].fp, fingerprint('apply_patch', { command: PATCH }, s.root));
    assert.equal(run('pre', JSON.stringify(bash(s, 'ls'))).stdout, '', 'nothing to say: Codex lets it through');
    const broken = JSON.parse(run('pre', 'not json').stdout);
    codexTakes('PreToolUse', broken);
    assert.match(broken.hookSpecificOutput.permissionDecisionReason, /could not check this call/);
    const unchecked = JSON.parse(run('post', '{').stdout);
    codexTakes('PostToolUse', unchecked);
    assert.match(unchecked.reason, /withheld/);
    // `check` is a person or a skill asking, not Codex running the hooks: it leaves no mark.
    rmSync(marks, { recursive: true, force: true });
    const words = spawnSync(process.execPath, [SCRIPT, 'check', '--', 'npm', 'run', 'deploy'], { cwd: s.root, env, encoding: 'utf8' }).stdout;
    assert.match(words, /^Held for the person's Proceed:\n⚠ Deploy Night Owls/);
    assert.equal(existsSync(join(marks, 'codex.json')), false);
    // A mark that cannot be written (its folder's place is a file) stops nothing: the call is still checked.
    writeFileSync(marks, 'a file where the folder would go');
    assert.equal(JSON.parse(run('pre', JSON.stringify(payload(s, 'apply_patch', { command: PATCH }))).stdout).hookSpecificOutput.permissionDecision, 'deny');
  } finally { s.done(); }
});

test('Tell Homie in Codex: a note is sent only after the person\'s own "proceed <code>", with its words in the hold; a draft is never held', async () => {
  const s = studio();
  try {
    const note = { kind: 'confusing', text: 'The deploy asked for a workers.dev subdomain and I did not know what that was.', step: 'studio-setup: put it online', offered: true, app: 'codex' };
    const tool = 'mcp__homie__homie_feedback';
    assert.equal(await pre(payload(s, tool, note), { dir: s.data }), null, 'a draft sends nothing, so nothing holds it');
    assert.equal(await pre(payload(s, tool, { action: 'decline', draft: 'fd_0123456789abcdef01234567' }), { dir: s.data }), null);
    const p = payload(s, tool, { ...note, action: 'send', draft: 'fd_0123456789abcdef01234567' });
    const held = await pre(p, { dir: s.data });
    codexTakes('PreToolUse', held);
    const reason = held.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /Held by Homie for the person's Proceed \(hold [A-Z0-9]{4}\): Send this note to Homie\?/);
    assert.ok(reason.includes(note.text), 'the hold carries the note\'s exact words');
    assert.match(reason, /With it: the step \(studio-setup: put it online\) · Codex · that Claude offered it\. No reply address\./);
    const code = codeOf(held);
    await prompt({ session_id: 'session-1', prompt: `proceed ${code}` }, { dir: s.data });
    // Other words are not the note the person said yes to.
    assert.equal((await pre(payload(s, tool, { ...note, text: `${note.text} And more.`, action: 'send', draft: 'fd_0123456789abcdef01234567' }), { dir: s.data })).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(await pre(p, { dir: s.data }), null, 'the exact note goes, once');
    // A note with nothing to show is refused, never sent blind.
    const blind = await pre(payload(s, tool, { action: 'send', draft: 'fd_0123456789abcdef01234567' }), { dir: s.data });
    assert.match(blind.hookSpecificOutput.permissionDecisionReason, /Refused by Homie: Not sent: send the note with its kind and text/);
  } finally { s.done(); }
});

test('one module decides for both apps: the mod\'s tool filters are lib/holds.mjs\'s, and the mod asks lib/holds.mjs', async () => {
  const src = readFileSync(join(PLUGIN, 'hooks', 'homie.mjs'), 'utf8');
  for (const [name, re] of Object.entries(MCP_TOOLS)) {
    assert.ok(src.includes(`on('tool.call', { tool: ${re.toString()} }`), `the mod's ${name} filter is ${re}`);
  }
  for (const fn of ['editDecision', 'shellDecision', 'mcpDeployDecision', 'stripeDecision', 'paidMcpDecision', 'cloudflareMcpDecision', 'feedbackDecision']) {
    assert.ok(src.includes(`${fn}(`), `the mod decides with lib/holds.mjs ${fn}`);
  }
  assert.ok(!/\b(protectedBy|paidOf|deployOf|cloudflareChangeOf|modelPullOf|gitStagesOf)\(/.test(src), 'the mod reads no command or edit itself');
  const codex = readFileSync(SCRIPT, 'utf8');
  for (const fn of ['editDecision', 'shellDecision', 'mcpDecision']) assert.ok(codex.includes(`${fn}(`), `hooks/codex.mjs decides with ${fn}`);
  // The same call gets the same question from both: here, the words the mod's own tests check.
  const s = studio();
  try {
    const d = await decide(payload(s, 'Edit', { file_path: join(s.root, 'games/owl-rush/game.json'), old_string: '"Owl Rush"', new_string: '"Owl Rush Deluxe"' }));
    assert.equal(d.hold.question, 'Change games/owl-rush/game.json, which the studio protects?');
  } finally { s.done(); }
});

test('Codex runs the hooks: .codex-plugin names hooks/codex.json, and the root plugin.json declares no $schema', () => {
  const codex = json(join(PLUGIN, '.codex-plugin', 'plugin.json'));
  const standard = json(join(PLUGIN, 'plugin.json'));
  assert.equal(codex.hooks, './hooks/codex.json');
  assert.equal(standard.extensions['com.openai'].hooks, './hooks/codex.json', 'where Codex\'s docs put it, for when Codex reads it there');
  // Codex reads a root plugin.json only when it declares the Agent Plugins $schema, and then runs none of the
  // plugin's hooks (0.156.1 and 0.160.0, tested); without it, Codex reads .codex-plugin/plugin.json and runs them.
  assert.equal(standard.$schema, undefined);
  const hooks = json(join(PLUGIN, codex.hooks));
  assert.deepEqual(Object.keys(hooks).sort(), ['description', 'hooks'], 'Codex takes only description and hooks');
  const modes = { PreToolUse: 'pre', UserPromptSubmit: 'prompt', PostToolUse: 'post' };
  assert.deepEqual(Object.keys(hooks.hooks).sort(), Object.keys(modes).sort());
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const g of groups) for (const h of g.hooks) {
      assert.equal(h.type, 'command');
      assert.equal(h.command, `node "\${PLUGIN_ROOT}/hooks/codex.mjs" ${modes[event]}`);
      assert.ok(h.timeout > 0 && h.timeout <= 120);
    }
  }
  const matcher = new RegExp(hooks.hooks.PreToolUse[0].matcher);
  for (const tool of ['Bash', 'apply_patch', 'mcp__fal__run_model', 'mcp__plugin_cloudflare_cloudflare__execute']) assert.ok(matcher.test(tool), tool);
  for (const tool of ['web_search', 'view_image', 'write_stdin']) assert.ok(!matcher.test(tool), tool);
  // Claude Code's hooks.json is the mod's, and Codex never reads it (an explicit hooks path replaces discovery).
  assert.deepEqual(json(join(PLUGIN, 'hooks', 'hooks.json')).modules, ['./homie.mjs']);
});
