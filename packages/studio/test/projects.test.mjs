/**
 * @homie-rocks/studio 0.24.3: `homie-studio setup --via stripe-projects` (lib/projects.mjs, a prototype) and where its
 * credentials are used (lib/projects-env.mjs: Wrangler's runs, the setup status, the music skill's ElevenLabs key).
 *
 *   - each step the person owns stops with `needs` and says it: no Stripe CLI or an old one, no Projects plugin, no
 *     project (Stripe's sign-in), the providers' terms (only --accept-tos passes them on), a provider to link;
 *   - free plans only: nothing paid is passed on, and an answer that names a price stops it;
 *   - the account id goes into studio.json with "auth": "stripe-projects"; the token stays in the git-ignored .env
 *     Projects wrote, and .gitignore keeps .env, .env.*, .projects/vault/ and .projects/cache/ out of git;
 *   - read-only checks with the token (Wrangler signed in, D1, Workers AI, R2), and a token that cannot do D1 stops it;
 *   - --dry-run adds nothing and writes nothing;
 *   - every Wrangler run in that studio gets the token from the .env (and an ordinary studio does not), a refused token
 *     says `stripe projects env --pull`, and the setup status says Cloudflare (and ElevenLabs) came through Projects;
 *   - the Stripe row appears in the setup status only for a studio that sells, with Stripe's agent plugin as the fix;
 *   - no value of a credential is ever in a result, a line for a person, an argument or a file of ours.
 * Stand-ins answer like the Stripe CLI's and Wrangler's --json; nothing reaches Stripe, Cloudflare or ElevenLabs, and
 * every credential here is made up.
 *
 * Run: node --test packages/studio/test/projects.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { codeOf, envNamesIn, jsonOf, paidIn, servicesIn, setupViaProjects } from '../lib/projects.mjs';
import { projectsCloudflareEnv, projectsElevenLabs, readDotenv } from '../lib/projects-env.mjs';
import { runner } from '../lib/cloudflare.mjs';
import { setupStatus, stripeAgentConfigured } from '../lib/doctor.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-projects-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

// Made-up values, built here so no credential-shaped string sits in this file (the repository's leak audit reads it).
const TOKEN = ['cfut', 'Zx9'.repeat(12)].join('_');
const ACCOUNT = 'c0ffee'.repeat(5) + '00';
const ELEVEN = ['sk', 'e1'.repeat(24)].join('_');

function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Lantern Works', '--homie', 'https://homie.test', '--no-install', '--json'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}

/** A stand-in Wrangler in the studio: it records each command and whether it got a token (never the token). */
function fakeWrangler(dir, { d1 = true, loggedIn = true } = {}) {
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, '.fake-wrangler');
  writeFileSync(join(bin, 'wrangler'), `#!/bin/sh
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then t="token:\${#CLOUDFLARE_API_TOKEN}"; else t="no-token"; fi
echo "$* $t account:\${CLOUDFLARE_ACCOUNT_ID:-none}" >> ${log}
case "$1 $2" in
  "whoami --json") echo '{"loggedIn": ${loggedIn}, "authType": "API Token", "accounts": []}' ;;
  "d1 list") ${d1 ? 'echo "[]"' : 'echo "Authentication error [code: 10000]" >&2; exit 1'} ;;
  "ai models") echo "[]" ;;
  "r2 bucket") echo "Please enable R2 through the Cloudflare Dashboard." >&2; exit 1 ;;
esac
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  return log;
}

/**
 * A stand-in Stripe CLI: answers by the command's words from a table (what the real CLI's --json says, in the shapes
 * the docs show), records every call, and on `projects add` writes the .env as Projects does (mode 600).
 */
function stripeStandIn(dir, table) {
  const calls = [];
  const exec = (cmd, args) => {
    const key = args.join(' ');
    calls.push(key);
    const hit = Object.entries(table).find(([k]) => key === k || key.startsWith(`${k} `));
    const r = typeof hit?.[1] === 'function' ? hit[1](args) : hit?.[1];
    return r ?? { code: 1, stdout: '', stderr: `unknown command: ${key}` };
  };
  return { exec, calls };
}

const VERSION = { code: 0, stdout: 'stripe version 1.45.0\n', stderr: '' };
const PLUGIN = { code: 0, stdout: '0.30.0\n', stderr: '' };
const STATUS_EMPTY = { code: 0, stdout: JSON.stringify({ project: { name: 'lantern-works', id: 'proj_test_1' }, services: [] }), stderr: '' };
const SEARCH_CF = { code: 0, stdout: JSON.stringify({ result_count: 2, results: [{ provider: 'cloudflare', service: 'workers', name: 'Workers', plans: [{ id: 'workers:free', price: { amount: 0 } }, { id: 'workers:paid', price: { amount: 500 } }] }, { provider: 'cloudflare', service: 'registrar:domain' }] }), stderr: '' };
const SEARCH_11 = { code: 0, stdout: JSON.stringify({ result_count: 1, results: [{ slug: 'elevenlabs/tts', name: 'Text to speech' }] }), stderr: '' };
const ENV_NAMES = (eleven = false) => ({ code: 0, stdout: JSON.stringify({ environment: 'default', variables: [{ name: 'CLOUDFLARE_API_TOKEN', value: '********' }, { name: 'CLOUDFLARE_ACCOUNT_ID', value: '********' }, { name: 'CLOUDFLARE_WORKER_NAME', value: '********' }, ...(eleven ? [{ name: 'ELEVENLABS_API_KEY', value: '********' }] : [])] }), stderr: '' });
const ENV_SHOW = { code: 0, stdout: JSON.stringify({ name: 'default', output: '.env', active: true }), stderr: '' };

function writeEnv(dir, { eleven = false } = {}) {
  writeFileSync(join(dir, '.env'), `# Synced by Stripe Projects\nCLOUDFLARE_API_TOKEN=${TOKEN}\nCLOUDFLARE_ACCOUNT_ID="${ACCOUNT}"\nCLOUDFLARE_WORKER_NAME=lantern-works\n${eleven ? `ELEVENLABS_API_KEY=${ELEVEN}\n` : ''}`, { mode: 0o600 });
}

const FULL = (dir, { eleven = false, addAnswer = null } = {}) => ({
  '--version': VERSION,
  'projects --version': PLUGIN,
  'projects status --json': STATUS_EMPTY,
  'projects search cloudflare --json': SEARCH_CF,
  'projects search elevenlabs --json': SEARCH_11,
  'projects add cloudflare/workers': () => { if (addAnswer) return addAnswer; writeEnv(dir, { eleven }); return { code: 0, stdout: JSON.stringify({ resource: { name: 'lantern-works', service: 'cloudflare/workers', tier: 'workers:free' }, env: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] }), stderr: '' }; },
  'projects add elevenlabs/tts': () => { writeEnv(dir, { eleven: true }); return { code: 0, stdout: JSON.stringify({ resource: { service: 'elevenlabs/tts', tier: 'free' } }), stderr: '' }; },
  'projects env --json': ENV_NAMES(eleven),
  'projects env show --json': ENV_SHOW,
  'projects env --pull': { code: 0, stdout: '', stderr: '' },
});

test('the readers: JSON after a line of words, slugs and pairs, names only, a price, the error codes', () => {
  assert.deepEqual(jsonOf('Fetching catalog…\n{"result_count": 1}\nDone.'), { result_count: 1 });
  assert.deepEqual(servicesIn(JSON.parse(SEARCH_CF.stdout)).sort(), ['cloudflare/registrar:domain', 'cloudflare/workers']);
  assert.ok(envNamesIn(JSON.parse(ENV_NAMES().stdout)).includes('CLOUDFLARE_API_TOKEN'));
  assert.equal(paidIn({ resource: { tier: 'workers:free', price: { amount: 0 } } }), false);
  assert.equal(paidIn({ resource: { tier: 'workers:paid' } }), true);
  assert.equal(paidIn({ plan: { monthly_price: 500 } }), true);
  assert.equal(codeOf({ code: 1, stdout: JSON.stringify({ ok: false, error: { code: 'PROVIDER_NOT_LINKED', message: 'link cloudflare first' } }), stderr: '' }), 'PROVIDER_NOT_LINKED');
  assert.equal(codeOf({ code: 1, stdout: '', stderr: 'Error: BROWSER_AUTH_REQUIRED: complete sign-in in your browser' }), 'BROWSER_AUTH_REQUIRED');
  assert.equal(codeOf({ code: 1, stdout: '', stderr: 'No project found in this directory. Run `stripe projects init` first.' }), 'NOT_INITIALIZED');
  assert.equal(codeOf({ code: 0, stdout: STATUS_EMPTY.stdout, stderr: '' }), null, 'a project with a "code" of its own is not an error');
  const env = join(scratch, 'dotenv');
  writeFileSync(env, 'export A=1\n# c\nB="two words"\nC=\'three\'\n bad line\n');
  assert.deepEqual(readDotenv(env), { A: '1', B: 'two words', C: 'three' });
});

test('each step that is the person\'s stops with what to do: the CLI, the plugin, Stripe\'s sign-in, the terms, a link', async () => {
  const dir = studio('steps');
  const go = (table, opts = {}) => setupViaProjects(dir, { exec: stripeStandIn(dir, table).exec, ...opts });
  assert.equal((await go({ '--version': { code: 127, stdout: '', stderr: 'not found' } })).needs.id, 'stripe-cli');
  const old = await go({ '--version': { code: 0, stdout: 'stripe version 1.37.2', stderr: '' } });
  assert.equal(old.needs.id, 'stripe-cli');
  assert.match(old.why, /1\.37\.2; Projects needs 1\.40\.0/);
  assert.equal((await go({ '--version': VERSION, 'projects --version': { code: 1, stdout: '', stderr: 'unknown command "projects"' } })).needs.run, 'stripe plugin install projects');
  const init = await go({ '--version': VERSION, 'projects --version': PLUGIN, 'projects status --json': { code: 1, stdout: '', stderr: 'No project found in this directory. Run `stripe projects init` first.' } });
  assert.equal(init.needs.id, 'projects-init');
  assert.equal(init.needs.run, 'stripe projects init --yes');
  assert.match(init.needs.say, /THEIR OWN Stripe account/);
  // The terms: the person's to accept; only then --accept-tos.
  const terms = await go(FULL(dir), { withElevenlabs: true });
  assert.equal(terms.needs.id, 'accept-terms');
  assert.equal(terms.needs.who, 'person');
  assert.match(terms.needs.say, /cloudflare\.com\/terms/);
  assert.match(terms.needs.say, /no commercial licence/);
  assert.deepEqual(terms.plan, ['stripe projects add cloudflare/workers --json --no-interactive --accept-tos', 'stripe projects add elevenlabs/tts --json --no-interactive --accept-tos']);
  // An existing Cloudflare account: Cloudflare's own approval page, through `stripe projects link`.
  const link = await go(FULL(dir, { addAnswer: { code: 1, stdout: JSON.stringify({ ok: false, error: { code: 'PROVIDER_NOT_LINKED' } }), stderr: '' } }), { acceptTos: true });
  assert.equal(link.needs.id, 'link-cloudflare');
  assert.equal(link.needs.run, 'stripe projects link cloudflare');
  // Not in the catalog: the usual way.
  const gone = await go({ ...FULL(dir), 'projects search cloudflare --json': { code: 0, stdout: '{"result_count": 0, "results": []}', stderr: '' } });
  assert.equal(gone.needs.id, 'not-in-catalog');
  assert.match(gone.needs.say, /wrangler login/);
});

test('free plans only: nothing paid is passed on, and an answer that names a price stops it', async () => {
  const dir = studio('paid');
  const s = stripeStandIn(dir, FULL(dir, { addAnswer: { code: 1, stdout: '', stderr: 'This plan requires a payment method. Pass --confirm-paid-service to confirm.' } }));
  const r = await setupViaProjects(dir, { exec: s.exec, acceptTos: true });
  assert.equal(r.needs.id, 'paid');
  assert.ok(!s.calls.some((c) => /confirm-paid-service|billing|upgrade/.test(c)), 'never a paid confirmation, billing or an upgrade');
  const priced = stripeStandIn(dir, FULL(dir, { addAnswer: { code: 0, stdout: JSON.stringify({ resource: { service: 'cloudflare/workers', tier: 'workers:paid', price: { amount: 500 } } }), stderr: '' } }));
  assert.equal((await setupViaProjects(dir, { exec: priced.exec, acceptTos: true })).needs.id, 'paid');
});

test('--dry-run adds nothing and writes nothing', async () => {
  const dir = studio('dry');
  const before = readFileSync(join(dir, 'studio.json'), 'utf8');
  const gi = readFileSync(join(dir, '.gitignore'), 'utf8').replace(/^\.env\.\*\n|^\.projects\/vault\/\n|^\.projects\/cache\/\n/gm, '');
  writeFileSync(join(dir, '.gitignore'), gi);
  const s = stripeStandIn(dir, FULL(dir));
  const r = await setupViaProjects(dir, { exec: s.exec, dryRun: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dryRun, true);
  assert.ok(!s.calls.some((c) => c.startsWith('projects add') || c.startsWith('projects link')), s.calls.join('\n'));
  assert.equal(readFileSync(join(dir, 'studio.json'), 'utf8'), before);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), gi, '.gitignore untouched');
  assert.ok(r.steps.some((x) => /would add \.env\.\*/.test(x.words)));
});

test('the whole run: the account in studio.json, the token where Projects put it, .gitignore, read-only checks; nothing printed', async () => {
  const dir = studio('whole');
  const wlog = fakeWrangler(dir);
  const s = stripeStandIn(dir, FULL(dir, { eleven: true }));
  const said = [];
  const r = await setupViaProjects(dir, { exec: s.exec, acceptTos: true, withElevenlabs: true, log: (l) => said.push(l) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.services, { cloudflare: 'cloudflare/workers', elevenlabs: 'elevenlabs/tts' });
  assert.ok(s.calls.includes('projects add cloudflare/workers --json --no-interactive --accept-tos'));
  assert.deepEqual(r.checks, { signedIn: true, d1: true, workersAi: true, r2: false });
  const sj = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(sj.cloudflare.accountId, ACCOUNT, 'the account id (not a secret) is the studio\'s');
  assert.equal(sj.cloudflare.auth, 'stripe-projects');
  assert.equal(sj.cloudflare.envFile, '.env');
  assert.deepEqual(sj.providers.elevenlabs, { via: 'stripe-projects', envKey: 'ELEVENLABS_API_KEY', envFile: '.env' });
  const gi = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n');
  for (const line of ['.env', '.env.*', '.projects/vault/', '.projects/cache/']) assert.ok(gi.includes(line), `.gitignore has ${line}`);
  // Wrangler ran with the token from the .env (its length only was recorded), the account from studio.json.
  const ran = readFileSync(wlog, 'utf8');
  assert.match(ran, new RegExp(`^whoami --json token:${TOKEN.length} account:${ACCOUNT}$`, 'm'));
  assert.match(ran, /^d1 list --json token:/m);
  const everything = JSON.stringify(r) + said.join('\n') + s.calls.join('\n') + ran + JSON.stringify(sj);
  assert.doesNotMatch(everything, new RegExp(`${TOKEN}|${ELEVEN}`), 'no credential in a result, a line, an argument or studio.json');
  assert.equal(projectsElevenLabs(dir), true);
  // An ordinary studio's Wrangler gets nothing from a .env it happens to have.
  const plain = studio('plain');
  writeEnv(plain);
  assert.deepEqual(projectsCloudflareEnv(plain), {});
});

test('a token that cannot do D1 stops it and says how to go on', async () => {
  const dir = studio('scope');
  fakeWrangler(dir, { d1: false });
  const r = await setupViaProjects(dir, { exec: stripeStandIn(dir, FULL(dir)).exec, acceptTos: true });
  assert.equal(r.needs.id, 'token-scope');
  assert.match(r.why, /D1/);
  assert.match(r.needs.say, /npx wrangler login instead/);
});

test('every Wrangler run in that studio takes the Projects token; a refused one says stripe projects env --pull', async () => {
  const dir = studio('runner');
  const wlog = fakeWrangler(dir, { loggedIn: false });
  const sj = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...sj, cloudflare: { ...sj.cloudflare, accountId: ACCOUNT, auth: 'stripe-projects', envFile: '.env' } }, null, 2));
  writeEnv(dir);
  runner(dir, {})(['whoami', '--json']);
  assert.match(readFileSync(wlog, 'utf8'), new RegExp(`^whoami --json token:${TOKEN.length} account:${ACCOUNT}$`, 'm'));
  const d = spawnSync(process.execPath, [CLI, 'deploy', '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', CLOUDFLARE_API_TOKEN: '' } });
  const out = JSON.parse(d.stdout);
  assert.equal(out.needs, 'cloudflare-login');
  assert.match(out.why, /stripe projects env --pull/);
  assert.doesNotMatch(d.stdout + d.stderr, new RegExp(TOKEN));
});

test('the setup status: Cloudflare and ElevenLabs through Projects; a Stripe row only where the studio sells', async () => {
  const dir = studio('doctor');
  fakeWrangler(dir);
  const sj = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({ ...sj, cloudflare: { ...sj.cloudflare, accountId: ACCOUNT, auth: 'stripe-projects' }, providers: { elevenlabs: { via: 'stripe-projects' } } }, null, 2));
  writeEnv(dir, { eleven: true });
  const home = join(scratch, 'home');
  mkdirSync(home, { recursive: true });
  const exec = async (cmd, args, opts) => {
    if (cmd.endsWith('wrangler')) { const r = spawnSync(cmd, args, { cwd: opts?.cwd, env: opts?.env, encoding: 'utf8' }); return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; }
    if (cmd === 'stripe') return { code: 0, stdout: 'stripe version 1.45.0', stderr: '' };
    return { code: 127, stdout: '', stderr: '' };
  };
  const reachable = async () => new Response('{}', { status: 200 });
  let r = await setupStatus({ cwd: dir, env: { HOME: home }, exec, fetchFn: reachable, chrome: () => '/x/chrome', connector: 'yes' });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.match(by.cloudflare.parts[0].detail, /through Stripe Projects/);
  assert.equal(by.cloudflare.parts[0].state, 'ok');
  assert.equal(by.elevenlabs.state, 'ok');
  assert.match(by.elevenlabs.detail, /through Stripe Projects/);
  assert.equal(by.stripe, undefined, 'no Stripe row for a studio that sells nothing');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(`${TOKEN}|${ELEVEN}|${ACCOUNT}`));
  // A studio that sells: the row, and Stripe's own agent plugin as the fix until its MCP is set up for this AI.
  writeFileSync(join(dir, 'shop.json'), JSON.stringify({ till: 'stripe', items: [] }));
  r = await setupStatus({ cwd: dir, env: { HOME: home }, exec, fetchFn: reachable, chrome: () => '/x/chrome', connector: 'yes' });
  let stripe = r.rows.find((x) => x.id === 'stripe');
  assert.equal(stripe.state, 'act');
  assert.equal(stripe.fix.run, 'npm install -g @stripe/cli@latest && stripe agent setup');
  assert.match(stripe.detail, /Stripe CLI 1\.45\.0/);
  assert.ok(r.features.some((f) => /Sell in the games/.test(f.feature)));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { stripe: { type: 'http', url: 'https://mcp.stripe.com/' } } }));
  r = await setupStatus({ cwd: dir, env: { HOME: home }, exec, fetchFn: reachable, chrome: () => '/x/chrome', connector: 'yes' });
  stripe = r.rows.find((x) => x.id === 'stripe');
  assert.equal(stripe.state, 'ok');
  assert.match(stripe.detail, /set up for Claude Code/);
  // Codex's config counts too.
  const codexHome = join(scratch, 'codex-home');
  mkdirSync(join(codexHome, '.codex'), { recursive: true });
  writeFileSync(join(codexHome, '.codex', 'config.toml'), '[mcp_servers.stripe]\nurl = "https://mcp.stripe.com"\n');
  assert.equal(stripeAgentConfigured({ root: dir, env: { HOME: codexHome } }), 'Codex');
  assert.equal(stripeAgentConfigured({ root: dir, env: { HOME: join(scratch, 'nobody') } }), null);
});

test('the CLI: setup --via stripe-projects reaches the prototype; anything else is refused', () => {
  const dir = studio('cli');
  const fake = join(dir, 'fake-stripe');
  writeFileSync(fake, '#!/bin/sh\necho "stripe version 1.37.2"\n');
  chmodSync(fake, 0o755);
  const go = (args) => JSON.parse(spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', HOMIE_STRIPE_CLI: fake } }).stdout);
  const r = go(['setup', '--via', 'stripe-projects', '--dry-run']);
  assert.equal(r.needs.id, 'stripe-cli');
  assert.match(go(['setup', '--via', 'netlify']).why, /stripe-projects is the one other way/);
  assert.match(go(['setup', '--via', 'stripe-projects', '--with', 'fal']).why, /--with takes elevenlabs/);
  assert.ok(existsSync(join(dir, 'studio.json')));
});
