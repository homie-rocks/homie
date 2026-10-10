import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * @homie-rocks/studio 0.11.0: a new creator's first hour, from the first outside users' feedback.
 *
 *   - `setup status` (also `doctor`): one checklist of what this computer and the person's accounts have, green,
 *     missing or "do this now", what each unlocks and its exact fix; optional rows never block; it never prints a
 *     key; it works before a studio exists;
 *   - the Game Codex: games/<id>/CODEX.md drawn as a page in the game's own look (cards, chips, stats, tables,
 *     checklists, the decision log, a Build status tab from the progress feed), escaped, with pictures and fonts
 *     only from inside the studio; the site has it for the owner only; CODEX.md never ships in public files;
 *   - the Claude Code status line: one line from the progress feed, quiet with no build, and a setting that never
 *     replaces a status line the person already has.
 * Run: node --test packages/studio/test/onboarding.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODEX_SCRIPT_HASH, codexGaps, parseCodex, parseFrontmatter, renderCodex } from '../lib/codex.mjs';
import { formatStatus, setupStatus } from '../lib/doctor.mjs';
import { summarize } from '../lib/feed-summary.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { RECENT_MS, installStatusLine, statusLine } from '../lib/statusline.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const LINE = join(PKG, 'bin', 'statusline.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-onboarding-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd, env) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: env ?? process.env });
const out = (r) => JSON.parse(r.stdout);
const sha = (s) => createHash('sha256').update(s).digest('hex');
/** A one-pixel PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function studio(name, { game = 'ember-run', gameName = 'Ember Run' } = {}) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Lantern Works', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  if (game) browserRulesGame(dir, game, gameName);
  return dir;
}

/* ------------------------------------------------------------------ setup status */

/** Stand-ins for the tools a computer may have: a map of "cmd args…" to a result. */
function fakeExec(answers) {
  const calls = [];
  const exec = async (cmd, args) => {
    const key = `${cmd.split('/').pop()} ${args.join(' ')}`;
    calls.push(key);
    for (const [pattern, r] of Object.entries(answers)) if (key.startsWith(pattern)) return { stdout: '', stderr: '', ...r };
    return { code: 127, stdout: '', stderr: 'not found' };
  };
  return { exec, calls };
}
const reachable = async () => new Response('{}', { status: 405 });

test('setup status before a studio exists: one checklist, what each row unlocks, and nothing optional blocks', async () => {
  const away = join(scratch, 'no-studio-here');
  mkdirSync(away, { recursive: true });
  const { exec } = fakeExec({ 'git --version': { code: 0 } });
  const r = await setupStatus({ cwd: away, env: {}, platform: 'linux', exec, fetchFn: reachable, chrome: () => null, node: '22.22.0' });
  assert.equal(r.ok, true);
  assert.equal(r.studio, null);
  assert.deepEqual(r.rows.map((x) => x.id), ['node', 'connector', 'cloudflare', 'chrome', 'ffmpeg', 'github', 'elevenlabs', 'fal']);
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.equal(by.node.state, 'ok');
  assert.equal(by.connector.state, 'unknown', 'only the AI knows whether its Homie tools are there');
  assert.equal(by.cloudflare.state, 'later', 'Cloudflare is checked once the studio (and its Wrangler) exists');
  assert.equal(by.cloudflare.fix.who, 'ai');
  assert.match(by.cloudflare.fix.say, /cloudflare_login/);
  assert.equal(by.chrome.state, 'act');
  assert.match(by.chrome.fix.run, /^npx -y @homie-rocks\/studio@\d+\.\d+\.\d+ chrome install$/, 'outside a studio the fix names the pinned toolkit');
  for (const id of ['github', 'elevenlabs', 'fal']) assert.equal(by[id].state, 'optional', `${id} is optional`);
  for (const row of r.rows) assert.ok(row.unlocks.length > 20, `${row.id} says what it unlocks`);
  assert.deepEqual(r.blocking, [], 'nothing is missing that blocks making a game');
  assert.ok(!r.meanwhile.some((m) => m.id === 'cloudflare'), 'do not send the person to a separate sign-up before login');
  const text = formatStatus(r);
  assert.match(text, /Setup status \(before the studio exists\)/);
  assert.match(text, /Optional rows never block anything/);
  assert.doesNotMatch(text, /Make a free one now/);
});

test('setup status in a studio: Wrangler signed in, the email proven by a deploy, providers connected, and no key printed', async () => {
  const dir = studio('doctor', { game: null });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', '.bin', 'wrangler'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const key = 'fal-key-that-must-never-be-printed-1234';
  const { exec, calls } = fakeExec({
    'wrangler whoami --json': { code: 0, stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: 'acc1', name: 'Someone' }] }) },
    'git --version': { code: 0 }, 'gh --version': { code: 0 }, 'gh auth status': { code: 0 },
    'elevenlabs --version': { code: 0 }, 'elevenlabs auth status': { code: 0, stdout: JSON.stringify({ schemes: [{ logged_in: true }] }) },
    'ffmpeg -version': { code: 0 },
  });
  const seen = [];
  const fetchFn = async (url, init) => { seen.push([String(url), init?.headers?.Authorization ?? null]); return new Response('{}', { status: String(url).includes('fal') ? 200 : 405 }); };
  mkdirSync(join(dir, '.studio'), { recursive: true });
  writeFileSync(join(dir, '.studio', 'local.json'), JSON.stringify({ deployedAt: '2026-10-01T00:00:00Z' }));
  const r = await setupStatus({ cwd: dir, env: { FAL_KEY: key, CLAUDECODE: '1' }, platform: 'darwin', exec, fetchFn, chrome: () => '/x/chrome', connector: 'yes' });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.equal(r.studio.name, 'Lantern Works');
  assert.deepEqual(['connector', 'cloudflare', 'chrome', 'ffmpeg', 'github', 'elevenlabs', 'fal'].map((id) => by[id].state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(by.cloudflare.parts.map((p) => p.state), ['ok', 'ok'], 'signed in, and the email is proven by a deploy');
  assert.equal(by.statusline.state, 'optional', 'Claude Code gets the status line offer');
  assert.ok(calls.includes('wrangler whoami --json'), 'the studio\'s own Wrangler is asked');
  assert.ok(seen.some(([u, auth]) => u.includes('fal') && auth === `Key ${key}`), 'the fal key is checked with fal itself');
  const printed = JSON.stringify(r) + formatStatus(r);
  assert.ok(!printed.includes(key), 'the key is never printed');
  assert.ok(!printed.includes('Someone') && !printed.includes('acc1'), 'nor the Cloudflare account\'s name or id');
  assert.deepEqual(r.next, []);

  // An account whose email is not verified yet: the last deploy said so, and the fix is the person's one tap.
  writeFileSync(join(dir, '.studio', 'local.json'), JSON.stringify({ needs: 'cloudflare-verify-email' }));
  const notYet = await setupStatus({ cwd: dir, env: {}, platform: 'darwin', exec: fakeExec({ 'wrangler whoami --json': { code: 0, stdout: '{"loggedIn":false}' } }).exec, fetchFn: reachable, chrome: () => '/x/chrome', connector: 'no' });
  const cf = notYet.rows.find((x) => x.id === 'cloudflare');
  assert.deepEqual(cf.parts.map((p) => p.state), ['act', 'act']);
  assert.equal(cf.fix.run, 'npx wrangler login', 'first the sign-in, which the AI runs and the person approves');
  assert.equal(notYet.rows.find((x) => x.id === 'connector').state, 'act');
  assert.match(notYet.rows.find((x) => x.id === 'connector').fix.say, /\/plugin/);
  assert.deepEqual(notYet.next.map((n) => n.id), ['connector', 'cloudflare']);
  // A studio the Claude app's setup card made (`setup attach`): Cloudflare and GitHub are connected there already.
  writeFileSync(join(dir, '.studio', 'local.json'), JSON.stringify({ url: 'https://lantern.example', connectedAt: '2026-10-01T00:00:00Z' }));
  const cloud = await setupStatus({ cwd: dir, env: {}, exec: fakeExec({ 'git --version': { code: 0 }, 'git remote get-url origin': { code: 0, stdout: 'https://github.com/someone/lantern-works.git\n' } }).exec, fetchFn: reachable, chrome: () => '/x/chrome', connector: 'yes' });
  const cloudBy = Object.fromEntries(cloud.rows.map((x) => [x.id, x]));
  assert.equal(cloudBy.cloudflare.state, 'ok');
  assert.match(cloudBy.cloudflare.detail, /setup card/);
  assert.equal(cloudBy.github.state, 'ok');
  assert.doesNotMatch(JSON.stringify(cloud), /someone/, 'the repository\'s owner is not printed');
  // A Claude Code cloud session whose network does not reach the directory: the one setting to change.
  const blocked = await setupStatus({ cwd: dir, env: {}, exec: fakeExec({}).exec, fetchFn: async () => new Response('', { status: 403, headers: { 'x-deny-reason': 'host_not_allowed' } }), chrome: () => null });
  assert.match(blocked.rows.find((x) => x.id === 'connector').fix.say, /Network access to Custom, add homie\.test/);
});

test('setup status: a server whose AI guides use Workers AI gets ONE tiny call to its model, and a plain answer when it is paid-only or gone', async () => {
  const dir = studio('doctor-brain', { game: null });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', '.bin', 'wrangler'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  mkdirSync(join(dir, '.studio'), { recursive: true });
  writeFileSync(join(dir, '.studio', 'local.json'), JSON.stringify({ deployedAt: '2026-10-01T00:00:00Z' }));
  const token = 'oauth-token-that-must-never-be-printed-5678';
  const answers = (servers = 1, accounts = [{ id: 'acc1', name: 'Someone' }]) => fakeExec({
    'wrangler whoami --json': { code: 0, stdout: JSON.stringify({ loggedIn: true, accounts }) },
    'wrangler d1 execute DB --remote --json': { code: 0, stdout: JSON.stringify([{ results: [{ n: servers }], success: true }]) },
    'wrangler auth token --json': { code: 0, stdout: JSON.stringify({ type: 'oauth', token }) },
    'git --version': { code: 0 }, 'ffmpeg -version': { code: 0 },
  });
  /** Cloudflare's Workers AI REST API, stood in: every call is kept, and none reaches the network. */
  const cloudflare = (status, body) => {
    const calls = [];
    const fetchFn = async (url, init) => {
      if (String(url).includes('/ai/run/')) { calls.push({ url: String(url), auth: init?.headers?.authorization ?? null, body: JSON.parse(init.body) }); return new Response(JSON.stringify(body), { status }); }
      return new Response('{}', { status: 405 });
    };
    return { fetchFn, calls };
  };
  const rowOf = (r) => r.rows.find((x) => x.id === 'workers-ai');
  const status = (exec, fetchFn, env = {}) => setupStatus({ cwd: dir, env, platform: 'darwin', exec, fetchFn, chrome: () => '/x/chrome', connector: 'yes' });

  // The default model (Clef, a decision model) answers: one call, one yes/no question, the studio's own sign-in; nothing printed.
  let cf = cloudflare(200, { success: true, result: { model: 'clef-flash', answers: { ok: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 300, output_tokens: 0 } }, errors: [] });
  let ex = answers();
  let r = await status(ex.exec, cf.fetchFn);
  let row = rowOf(r);
  assert.equal(row.state, 'ok', row.detail);
  assert.match(row.detail, /@cf\/cloudflare\/clef-flash answers on this studio's Cloudflare account/);
  assert.equal(cf.calls.length, 1, 'exactly one call');
  assert.match(cf.calls[0].url, /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/acc1\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
  assert.equal(cf.calls[0].auth, `Bearer ${token}`);
  assert.equal(cf.calls[0].body.model, 'clef-flash', 'a decision model is asked a question, not sent a chat message');
  assert.equal(cf.calls[0].body.questions.ok.type, 'noul', 'one yes/no: a few hundred tokens, a few of the 10,000 free neurons');
  assert.ok(ex.calls.some((c) => c.startsWith('wrangler d1 execute DB --remote --json')), 'the live database says a server uses Workers AI');
  assert.ok(r.features.some((f) => f.feature === 'AI guides that think (Workers AI)' && f.state === 'ready'));
  let printed = JSON.stringify(r) + formatStatus(r);
  assert.ok(!printed.includes(token) && !printed.includes('acc1') && !printed.includes('Someone'), 'never the token, the account\'s id or its name');
  assert.match(formatStatus(r), /Workers AI/);

  // A model Cloudflare moved to Workers Paid (403, 5035): what it means, what to do, and that the money is the person's.
  writeFileSync(join(dir, 'wrangler.jsonc'), readFileSync(join(dir, 'wrangler.jsonc'), 'utf8').replace('"vars": {', '"vars": {\n    "HOMIE_BRAIN_MODEL": "@cf/moonshotai/kimi-k2.6",'));
  cf = cloudflare(403, { success: false, result: null, errors: [{ code: 5035, message: 'This model requires the Workers Paid plan. Upgrade at https://dash.cloudflare.com/acc1/workers/plans' }] });
  r = await status(answers().exec, cf.fetchFn);
  row = rowOf(r);
  assert.equal(row.state, 'act');
  assert.match(row.detail, /@cf\/moonshotai\/kimi-k2\.6 needs the Workers Paid plan, and this account is on Workers Free: every guide on a workers-ai server answers from the game's script/);
  assert.match(row.fix.say, /set HOMIE_BRAIN_MODEL in wrangler\.jsonc "vars"/);
  assert.match(row.fix.say, /or remove it for the default, @cf\/cloudflare\/clef-flash/);
  assert.match(row.fix.say, /that is the person's money: ask them/);
  assert.equal(row.fix.open, 'https://developers.cloudflare.com/workers-ai/models/');
  assert.ok(r.next.some((n) => n.id === 'workers-ai'), 'a "do this now"');
  assert.deepEqual(r.blocking, [], 'it never blocks making games');
  printed = JSON.stringify(r) + formatStatus(r);
  assert.ok(!printed.includes('acc1'), 'Cloudflare\'s own words, without the account\'s id');

  // Retired or misspelt (400, 5007).
  cf = cloudflare(400, { success: false, errors: [{ code: 5007, message: 'No such model @cf/moonshotai/kimi-k2.6 or task' }] });
  row = rowOf(await status(answers().exec, cf.fetchFn));
  assert.equal(row.state, 'act');
  assert.match(row.detail, /Cloudflare has no model @cf\/moonshotai\/kimi-k2\.6 \(renamed or retired\)/);
  // Today's free allowance spent (429, 3036): not the model's fault, nothing to do but wait.
  cf = cloudflare(429, { success: false, errors: [{ code: 3036, message: 'You have used up your daily free allocation of 10,000 neurons.' }] });
  row = rowOf(await status(answers().exec, cf.fetchFn));
  assert.equal(row.state, 'later');
  assert.match(row.detail, /allowance .* is used up/);
  assert.equal(row.fix.who, 'person');
  // A sign-in Cloudflare refuses (10000): sign in again.
  cf = cloudflare(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
  row = rowOf(await status(answers().exec, cf.fetchFn));
  assert.equal(row.state, 'unknown');
  assert.equal(row.fix.run, 'npx wrangler login');

  // Not a model id at all: said, and no call.
  writeFileSync(join(dir, 'wrangler.jsonc'), readFileSync(join(dir, 'wrangler.jsonc'), 'utf8').replace('"@cf/moonshotai/kimi-k2.6"', '"llama please"'));
  cf = cloudflare(200, { success: true });
  row = rowOf(await status(answers().exec, cf.fetchFn));
  assert.equal(row.state, 'act');
  assert.match(row.detail, /not a Workers AI model id/);
  assert.equal(cf.calls.length, 0);
  writeFileSync(join(dir, 'wrangler.jsonc'), readFileSync(join(dir, 'wrangler.jsonc'), 'utf8').replace('\n    "HOMIE_BRAIN_MODEL": "llama please",', ''));
  assert.doesNotMatch(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), /HOMIE_BRAIN_MODEL/);

  // Several accounts and none named in studio.json: said, and no call.
  cf = cloudflare(200, { success: true });
  row = rowOf(await status(answers(1, [{ id: 'acc1' }, { id: 'acc2' }]).exec, cf.fetchFn));
  assert.equal(row.state, 'unknown');
  assert.match(row.detail, /several Cloudflare accounts/);
  assert.equal(cf.calls.length, 0);

  // No server thinks with Workers AI: no row, no call (the guides' brain is script, off or the owner's key).
  cf = cloudflare(200, { success: true });
  r = await status(answers(0).exec, cf.fetchFn);
  assert.equal(rowOf(r), undefined);
  assert.equal(cf.calls.length, 0);
  assert.ok(!r.features.some((f) => /Workers AI/.test(f.feature)));
  // A network that fails is said as it is.
  row = rowOf(await status(answers().exec, async (url) => { if (String(url).includes('/ai/run/')) throw new Error('getaddrinfo ENOTFOUND api.cloudflare.com'); return new Response('{}', { status: 405 }); }));
  assert.equal(row.state, 'unknown');
  assert.match(row.detail, /request to Cloudflare failed \(getaddrinfo ENOTFOUND api\.cloudflare\.com\)/);
  // A game.json seed in the built catalogue counts too, before the studio is live (and its database is not read).
  writeFileSync(join(dir, '.studio', 'local.json'), '{}');
  mkdirSync(join(dir, 'site', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'site', 'dist', 'games.json'), JSON.stringify({ games: [{ id: 'vale', servers: [{ id: 'first-light', brain: 'workers-ai' }] }] }));
  cf = cloudflare(200, { success: true, result: { response: 'OK' } });
  ex = answers(0);
  row = rowOf(await status(ex.exec, cf.fetchFn));
  assert.equal(row.state, 'ok');
  assert.equal(cf.calls.length, 1);
  assert.ok(!ex.calls.some((c) => c.startsWith('wrangler d1 execute')), 'no database read for a studio that is not live');
});

test('`homie-studio doctor` and `setup status` run anywhere and answer in seconds', () => {
  const away = join(scratch, 'cli-away');
  mkdirSync(away, { recursive: true });
  const started = Date.now();
  const r = run(['doctor', '--connector', 'yes', '--homie', 'http://127.0.0.1:9'], away);
  assert.equal(r.status, 0, r.stderr);
  const j = out(r);
  assert.equal(j.command, 'setup status');
  assert.ok(j.rows.length >= 8);
  assert.ok(Date.now() - started < 60_000);
  const text = spawnSync(process.execPath, [CLI, 'setup', 'status', '--homie', 'http://127.0.0.1:9'], { cwd: away, encoding: 'utf8' }).stdout;
  assert.match(text, /Node\.js/);
  assert.match(text, /unlocks/);
});

/* ------------------------------------------------------------------ the Game Codex */

const CODEX = `---
eyebrow: The Ashen Reach
tagline: Outrun the fire.   # a comment
cover: art/cover.png
palette:
  bg: "#120c0a"
  accent: "#f4b23c"
  danger: "red;}</style><script>alert(1)</script>"
fonts: { display: Press Start 2P, body: "Inter</style>", mono: fonts/mono.woff2 }
pixel: true
try: Arrows to run, Space to dash.
---

# Ember Run

A relay across a burning valley. <script>alert('pitch')</script>

## Latest

- 2026-09-30: Pixel art at 16 px.
- 2026-10-01: Rounds go to 90 seconds.

## Concept

<!-- a note for the AI that never shows -->
Grab the ember and hand it off. [Rules](javascript:alert(1)) and [docs](https://example.com/docs).

## Characters

### Kestrel
![Kestrel](art/kestrel.png)
\`C-01\` \`good: Player\` \`Runner\`
*Courier of the Reach*
Fast and light.
- **Speed:** 7 tiles/s
- **Carries:** one ember

### Cinder Wisp
![Wisp](../../../outside.png)
\`M-01\` \`Aggressive · 6 tiles\` \`gold: Rare\`
- Where: the burning floor

## Controls

| Action | Phone | Computer |
| --- | --- | --- |
| Run | drag | WASD |

## Milestones

- [x] Step 1: a working copy
- [ ] Step 2: the valley

## Open questions

- Does the fire spread faster?
- Should a steal score?
`;

test('a codex parses into its look and its sections, and says what is not decided yet', () => {
  const meta = parseFrontmatter('a: 1\nb: "x # y"\nc: plain # note\nd:\n  e: "#123456"\n  f: two words\ng: { h: 1, i: "j" }\n');
  assert.deepEqual(meta, { a: 1, b: 'x # y', c: 'plain', d: { e: '#123456', f: 'two words' }, g: { h: 1, i: 'j' } });
  const p = parseCodex(CODEX);
  assert.equal(p.title, 'Ember Run');
  assert.equal(p.meta.tagline, 'Outrun the fire.');
  assert.deepEqual(p.sections.map((s) => s.key), ['latest', 'concept', 'characters', 'controls', 'milestones', 'questions']);
  const gaps = codexGaps(p);
  assert.deepEqual(gaps.missing, ['World', 'Art direction', 'Rooms and players', 'Music and sound']);
  assert.equal(gaps.openQuestions, 2);
});

test('the codex page: cards, chips, stats, a table, a checklist, the decision log; escaped, and nothing from outside the studio', () => {
  const dir = studio('codex-page');
  const game = join(dir, 'games', 'ember-run');
  mkdirSync(join(game, 'art'), { recursive: true });
  writeFileSync(join(game, 'art', 'kestrel.png'), PNG);
  writeFileSync(join(game, 'art', 'cover.png'), PNG);
  writeFileSync(join(scratch, 'outside.png'), PNG);
  writeFileSync(join(game, 'CODEX.md'), CODEX);
  const r = renderCodex(dir, 'ember-run', { mode: 'artifact', feed: null });
  const { html } = r;
  assert.match(html, /<h1>Ember Run<\/h1>/);
  assert.match(html, /<nav class="tabs"[^>]*>.*<a href="#latest">Latest<\/a><a class="status" href="#build-status">Build status<\/a><a href="#concept">Concept<\/a>/s, 'the build\'s tab right after Latest');
  // Cards: the picture embedded, the id chip, tags by tone, the subtitle and the stats.
  assert.match(html, /<h3>Kestrel<\/h3><span class="chip id">C-01<\/span>/);
  assert.match(html, /<span class="chip good">Player<\/span><span class="chip plain">Runner<\/span>/);
  assert.match(html, /<span class="chip danger">Aggressive · 6 tiles<\/span><span class="chip gold">Rare<\/span>/);
  assert.match(html, /<p class="meta">Courier of the Reach<\/p>/);
  assert.match(html, /<dt>Speed<\/dt><dd>7 tiles\/s<\/dd><dt>Carries<\/dt><dd>one ember<\/dd>/);
  assert.match(html, /<dt>Where<\/dt><dd>the burning floor<\/dd>/);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /<table><thead><tr><th>Action<\/th><th>Phone<\/th><th>Computer<\/th>/);
  assert.match(html, /<ul class="checklist"><li class="done"><span class="tick">✓<\/span><span>Step 1: a working copy<\/span><\/li><li class=""><span class="tick"><\/span><span>Step 2: the valley/);
  assert.ok(html.indexOf('2026-10-01') < html.indexOf('2026-09-30'), 'the decision log is newest first');
  assert.match(html, /<ol class="questions">/);
  assert.match(html, /class="pixel"/);
  // Safety: no script but the page's own, no javascript: link, no style break-out, nothing from outside the studio.
  assert.equal(html.match(/<script>/g).length, 1, 'one script: the page\'s own');
  assert.doesNotMatch(html, /alert\(1\)<\/script>|javascript:|<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&#39;pitch&#39;\)&lt;\/script&gt;/, 'a script in the text is shown as text');
  assert.doesNotMatch(html, /red;\}/, 'a colour that is not a colour is left out');
  assert.match(html, /--danger:#ff5d5d/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs" rel="noopener">docs<\/a>/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Press\+Start\+2P&amp;display=swap/);
  assert.doesNotMatch(html, /Inter&lt;|Inter<\/style>|family=Inter/, 'a font name that is not a name is left out');
  assert.ok(r.warnings.some((w) => /outside\.png: not found inside the studio/.test(w)), 'a picture outside the studio is refused');
  assert.ok(r.warnings.some((w) => /fonts\/mono\.woff2/.test(w)));
  assert.match(html, /<figure class="missing|<span>Wisp<\/span>/);
  assert.doesNotMatch(html, /a note for the AI/);
  assert.match(html, /data-mode="artifact"/, 'an artifact never reloads itself (only data-mode="file" does)');
  assert.deepEqual(r.missing, ['World', 'Art direction', 'Rooms and players', 'Music and sound']);
});

test('the Build status tab follows the progress feed, and the local page redraws itself as it moves', () => {
  const dir = studio('codex-status');
  assert.equal(out(run(['codex', 'new', 'ember-run'], dir)).ok, true);
  assert.equal(out(run(['codex', 'new', 'ember-run'], dir)).ok, false, 'never replaces a codex');
  const page = out(run(['codex', 'ember-run'], dir));
  assert.equal(page.ok, true);
  assert.equal(page.file, '.studio/codex/ember-run.html');
  assert.ok(page.missing.includes('Concept'));
  const file = join(dir, page.file);
  assert.match(readFileSync(file, 'utf8'), /No build has run for this game yet/);
  assert.equal(out(run(['progress', 'start', 'ember-run', '--title', 'Step 4: the valley'], dir)).ok, true);
  run(['progress', 'stage', 'plan', 'done', '--note', 'A relay in a burning valley'], dir);
  run(['progress', 'stage', 'checks', 'running'], dir);
  run(['progress', 'check', 'seats', 'pass', '--label', 'Two browsers seated'], dir);
  run(['progress', 'check', 'round', 'running', '--label', 'A round finishes'], dir);
  run(['progress', 'preview', '--url', 'http://127.0.0.1:8787/ember-run/play'], dir);
  const html = readFileSync(file, 'utf8');
  assert.match(html, /data-start="build-status"/, 'while a build runs the page opens on its status');
  assert.match(html, /data-running="1"/);
  assert.match(html, /<div class="pct">\d+%<\/div>/);
  assert.match(html, /Two browsers seated/);
  assert.match(html, /Ready to try<\/p><p>Open <a href="http:\/\/127\.0\.0\.1:8787\/ember-run\/play">/);
  assert.match(html, /Checks: 1 of 2 passed so far/);
  assert.match(html, /<a class="status" href="#build-status">Build · \d+%<\/a>/);
  assert.match(html, /Leave this open; it refreshes by itself/);
  const s = summarize(JSON.parse(readFileSync(join(dir, '.studio', 'progress', `${readFileSync(join(dir, '.studio', 'progress', 'current'), 'utf8').trim()}.json`), 'utf8')));
  assert.ok(s.percent > 25 && s.percent < 75, `part way: ${s.percent}%`);
  run(['progress', 'end', 'passed'], dir);
  assert.match(readFileSync(file, 'utf8'), /<div class="pct">100%<\/div>/);
  assert.match(readFileSync(file, 'utf8'), /<span class="seg skipped"/, 'a passed build that never deployed skipped it');
  // A preview that is not a web address is never a link.
  run(['progress', 'start', 'ember-run'], dir);
  run(['progress', 'preview', '--url', 'javascript:alert(1)'], dir);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /href="javascript:/);
});

test('the site: the codex is the owner\'s private page, and CODEX.md never ships in a public file', async () => {
  const dir = studio('codex-site');
  writeFileSync(join(dir, 'games', 'ember-run', 'CODEX.md'), '# Ember Run\n\n## Concept\n\nA secret plan.\n');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true);
  assert.deepEqual(b.codexes, ['ember-run']);
  const dist = join(dir, 'site', 'dist');
  assert.ok(existsSync(join(dist, '_studio', 'codex', 'ember-run', 'index.html')));
  assert.ok(!existsSync(join(dist, 'games', 'ember-run', 'source.json')), 'no game\'s source is built, so the codex cannot be in one');
  assert.ok(!existsSync(join(dist, 'games', 'ember-run', 'CODEX.md')), 'and it is not among the game\'s served files');
  assert.doesNotMatch(readFileSync(join(dist, 'games.json'), 'utf8'), /codex|secret plan/i, 'the catalogue never names it');

  const { default: worker } = await import('../worker/index.mjs');
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (q, a = []) => ({ bind: (...x) => stmt(q, x), first: async () => sql.prepare(q).get(...a) ?? null, all: async () => ({ results: sql.prepare(q).all(...a) }), run: async () => { sql.prepare(q).run(...a); return {}; } });
  const DB = { prepare: (q) => stmt(q), batch: async (l) => { for (const s of l) await s.run(); return []; } };
  const ASSETS = { fetch: async (req) => { const p = decodeURIComponent(new URL(req.url).pathname); const f = join(dist, p); return f.startsWith(dist) && existsSync(f) ? new Response(readFileSync(f)) : new Response('nope', { status: 404 }); } };
  const env = { ASSETS, DB, STUDIO_NAME: 'Lantern Works', LOBBY: { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('{"rooms":[]}') }) } };
  const site = (path, init) => worker.fetch(new Request(`https://lantern.example${path}`, init), env, { waitUntil: () => {} });

  for (const path of ['/_studio/codex/ember-run/', '/_studio/codex/ember-run/index.html']) {
    const locked = await site(path);
    assert.equal(locked.status, 401, `${path} is locked`);
    assert.doesNotMatch(await locked.text(), /secret plan/);
  }
  assert.equal((await site('/_studio/codex/ember-run')).status, 301);
  // The one-time sign-in goes on to the codex (and only to a studio page).
  const link = `hsk_${'c3'.repeat(24)}`;
  sql.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, 'signin', ?)").run(sha(link), Date.now() + 60_000);
  const button = await (await site(`/_studio/signin?k=${link}&to=${encodeURIComponent('/_studio/codex/ember-run/')}`)).text();
  assert.match(button, /Open the codex/);
  assert.match(button, /&amp;to=%2F_studio%2Fcodex%2Fember-run%2F/);
  const signed = await site(`/_studio/signin?k=${link}&to=${encodeURIComponent('/_studio/codex/ember-run/')}`, { method: 'POST', headers: { origin: 'https://lantern.example' } });
  assert.equal(signed.status, 303);
  assert.equal(signed.headers.get('location'), '/_studio/codex/ember-run/');
  const cookie = signed.headers.get('set-cookie').split(';')[0];
  const page = await site('/_studio/codex/ember-run/', { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /A secret plan\./);
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.ok(page.headers.get('content-security-policy').includes(`script-src '${CODEX_SCRIPT_HASH}'`), 'the page\'s own script, by its hash, and no other');
  assert.equal((await site('/_studio/codex/no-such-game/', { headers: { cookie } })).status, 404);
  // Elsewhere the sign-in still goes to the stats; a `to` outside the studio's pages is ignored.
  const link2 = `hsk_${'d4'.repeat(24)}`;
  sql.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, 'signin', ?)").run(sha(link2), Date.now() + 60_000);
  const away = await site(`/_studio/signin?k=${link2}&to=${encodeURIComponent('https://evil.example/')}`, { method: 'POST', headers: { origin: 'https://lantern.example' } });
  assert.equal(away.headers.get('location'), '/_studio/stats');
});

test('a static game\'s folder ships as it is, except its CODEX.md', () => {
  const dir = studio('codex-static', { game: null });
  const game = join(dir, 'games', 'tiles');
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'game.json'), JSON.stringify({ id: 'tiles', name: 'Tiles', build: { mode: 'static' }, netplay: { v: 1, public: true } }));
  writeFileSync(join(game, 'index.html'), '<!doctype html><script src="./homie-port.js"></script><p>tiles</p>');
  writeFileSync(join(game, 'CODEX.md'), '# Tiles\n');
  assert.equal(out(run(['build'], dir)).ok, true);
  assert.ok(existsSync(join(dir, 'site', 'dist', 'games', 'tiles', 'index.html')));
  assert.equal(existsSync(join(dir, 'site', 'dist', 'games', 'tiles', 'CODEX.md')), false);
});

/* ------------------------------------------------------------------ the status line */

test('the status line: the studio\'s name when idle, the build when one runs, the result for a while after', () => {
  const dir = studio('line');
  assert.equal(statusLine({ dir, color: false }), '◇ Lantern Works');
  assert.equal(statusLine({ dir: scratch, color: false }), '', 'nothing outside a studio');
  run(['progress', 'start', 'ember-run', '--title', 'Hand-offs', '--budget', '2'], dir);
  run(['progress', 'stage', 'build', 'done'], dir);
  run(['progress', 'stage', 'checks', 'running'], dir);
  run(['progress', 'check', 'seats', 'pass'], dir);
  run(['progress', 'check', 'round', 'running'], dir);
  run(['progress', 'spend', '0.4', '--what', 'a cover'], dir);
  const line = statusLine({ dir, color: false, columns: 120 });
  assert.match(line, /^▶ Hand-offs · Checks [▰▱]{10} \d+% · 1\/2 checks · \$0\.40 of \$2\.00$/);
  const narrow = statusLine({ dir, color: false, columns: 50 });
  assert.ok(narrow.length <= 48, narrow);
  assert.match(narrow, /^▶ Hand-offs · Checks/);
  assert.match(statusLine({ dir, color: true, columns: 120 }), /\x1b\[32m▰/, 'colour where the terminal has it');
  // Claude Code sends the session as JSON on stdin.
  const piped = spawnSync(process.execPath, [LINE], { input: JSON.stringify({ workspace: { current_dir: join(dir, 'games') } }), encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', COLUMNS: '120' } });
  assert.equal(piped.status, 0);
  assert.equal(piped.stdout.trim(), line);
  assert.equal(spawnSync(process.execPath, [LINE], { input: 'not json', cwd: scratch, encoding: 'utf8' }).stdout, '', 'quiet when it has nothing to say');
  run(['progress', 'end', 'passed'], dir);
  assert.match(statusLine({ dir, color: false }), /^✓ Hand-offs done/);
  assert.equal(statusLine({ dir, color: false, now: Date.now() + RECENT_MS + 1000 }), '◇ Lantern Works', 'an ended build goes after a while');
});

test('statusline --install: this studio\'s local settings, never over a status line the person already has', () => {
  const dir = studio('line-install', { game: null });
  const home = join(scratch, 'claude-home');
  mkdirSync(home, { recursive: true });
  const env = { HOME: scratch, CLAUDE_CONFIG_DIR: home };
  const first = installStatusLine(dir, { env });
  assert.equal(first.ok, true);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.statusLine.type, 'command');
  assert.match(settings.statusLine.command, /^node ".*\/@homie-rocks\/studio\/bin\/statusline\.mjs"$/);
  assert.equal(settings.statusLine.refreshInterval, 5, 'it keeps moving while a long check runs');
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.claude\/settings\.local\.json$/m);
  assert.equal(installStatusLine(dir, { env }).already, true);
  assert.equal(installStatusLine(dir, { env, remove: true }).removed, true);
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')).statusLine, undefined);
  // The person's own status line, in their user settings: kept unless they say --replace.
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line.sh' } }));
  const refused = installStatusLine(dir, { env });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /already a status line/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')).statusLine, undefined, 'nothing changed');
  assert.equal(installStatusLine(dir, { env, replace: true }).ok, true);
  assert.equal(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).statusLine.command, 'my-line.sh', 'theirs stays everywhere else');
  // Claude Code started in the folder above the studio (a new studio is made as a subfolder): the setting goes
  // there, names the studio, and the line finds it from that folder.
  const above = installStatusLine(dir, { env, replace: true, project: scratch });
  assert.equal(above.ok, true, JSON.stringify(above));
  const there = JSON.parse(readFileSync(join(scratch, '.claude', 'settings.local.json'), 'utf8')).statusLine.command;
  assert.match(there, / --studio ".*line-install"$/);
  const fromAbove = spawnSync(process.execPath, [LINE, '--studio', dir], { input: JSON.stringify({ workspace: { current_dir: scratch } }), encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(fromAbove.stdout.trim(), '◇ Lantern Works');
  // Other settings in the file are kept.
  writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm run build)'] } }));
  installStatusLine(dir, { env, replace: true });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')).permissions, { allow: ['Bash(npm run build)'] });
});
