/**
 * `homie-studio setup status` (also `homie-studio doctor`): what this computer and this person's accounts have for
 * a studio, as one checklist, before anything is made. For each thing: green, missing, or "do this now", what it
 * unlocks, and the exact fix: one command the AI runs, or one page the person taps.
 *
 *   Node.js            required    the toolkit runs on it
 *   Homie connector    recommended the directory's search, the cards and notes to Homie (the AI says
 *                                  whether its Homie tools are there: --connector yes|no). A session with a shell makes,
 *                                  deploys and lists a studio without it, so a missing connector never blocks. When
 *                                  the tools are missing and the app in use (Codex, Grok) has another MCP server named
 *                                  homie in its own config, the row says so: that name is the plugin's connector's
 *   Homie's holds      in Codex and Grok Build only: whether the plugin's hooks ran just now (they leave a dated
 *                                  mark, hooks/codex.mjs), so a session where nothing is held says so, and how to turn
 *                                  them on (Codex: trust them in /hooks; Grok Build: trust the plugin, which
 *                                  `grok plugin install … --trust` does). The app is the one the AI names
 *                                  (--client codex|grok) or its environment shows
 *   Cloudflare         to go online: signed in, and the account's email verified (Cloudflare checks that at the
 *                                  first deploy; a deploy that went through proves it)
 *   Workers AI         for AI guides  only when a server's guides think with Workers AI: the model they use
 *                                  (HOMIE_BRAIN_MODEL, else the default) answers on the studio's account, not paid-only
 *                                  or retired (lib/brain-probe.mjs: one tiny call, about 0.1 of the free daily neurons)
 *   Chrome             for checks  the two-browser check, the look pictures and playtests
 *   ffmpeg             recommended sound effects and the theme, trailers and hero footage
 *   GitHub             optional    a private backup, publishing by pull request, building from the Claude app
 *   ElevenLabs         optional    songs and game scores
 *   fal                optional    painted art and generated video
 *   Stripe             for selling only in a studio with shop.json: official CLI browser connection first; optional
 *                                  agent tooling is reported separately. `shop connect` names payment readiness;
 *                                  a CLI or MCP installation alone never proves the Worker can sell.
 *   Standalone builds  optional    only in a studio where a game.json has a "standalone" block: Xcode, the Android SDK
 *                                  and a JDK it builds on, Apple signing (a count of identities, never a name),
 *                                  notarization and steamcmd (lib/standalone.mjs standaloneRows)
 *   Clef locally       optional    Ollama with clef-flash: AI under dev for free (never downloaded without a yes)
 *   status line        optional    (Claude Code only) the build's progress under the prompt
 *
 * It is safe at any time, inside a studio or before one exists: it only reads (local files, `--version` of a few
 * tools, `wrangler whoami`, `gh auth status`, `elevenlabs auth status`, one GET to the directory and, when a fal key
 * is set, fal's free pricing API; when a server's AI guides use Workers AI, one read of the live database and one
 * one-word call to the model; in Codex or Grok, the `[mcp_servers.homie]` table of that app's config.toml, of which
 * it keeps only whether it is an address or a command, and the hooks' mark in this user's cache), never changes
 * anything, and never prints a key, a token, a command line or an account's name or id.
 * Every check has a time limit, so it answers in seconds even with no network.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workersAiRow } from './brain-probe.mjs';
import { studioClient } from './client.mjs';
import { detectLocalAi } from './local-ai.mjs';
import { findChrome } from './chrome.mjs';
import { whyFailed } from './net.mjs';
import { isOurs } from './statusline.mjs';
import { findStudio, listExperiences as listGames, readLocal, readStudio } from './studio.mjs';
import { standaloneRows } from './standalone.mjs';
import { projectsCloudflareEnv, projectsElevenLabs } from './projects-env.mjs';
import { STUDIO_VERSION } from './version.mjs';

/** A command's result, never throwing: code 127 when the program is not installed, 124 when it ran out of time. */
export function defaultExec(cmd, args, { cwd, timeout = 8000, env } = {}) {
  return new Promise((done) => {
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); done(r); } };
    let child;
    try { child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (error) { finish({ code: 127, stdout: '', stderr: String(error?.message ?? error) }); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ code: 124, stdout, stderr }); }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => finish({ code: error.code === 'ENOENT' ? 127 : 1, stdout, stderr: String(error.message) }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

const MARK = { ok: '✓', act: '→', missing: '✗', optional: '○', later: '…', unknown: '?' };
const RANK = { missing: 0, act: 1, unknown: 2, later: 3, optional: 4, ok: 5 };
const worst = (states) => states.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'ok');

/** Whether the directory answers at all (any status is an answer), and if not, the connection's own error. */
async function reach(url, fetchFn, ms = 5000) {
  try {
    const res = await fetchFn(url, { method: 'GET', headers: { 'user-agent': `homie-studio/${STUDIO_VERSION}`, accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    const deny = res.headers?.get?.('x-deny-reason') ?? '';
    if (res.status === 403 && /host_not_allowed/i.test(deny)) return { ok: false, blocked: true };
    return { ok: true, status: res.status };
  } catch (error) {
    const w = whyFailed(error, url);
    return { ok: false, blocked: w.needs === 'network', why: w.why, code: w.code };
  }
}

/** The apps whose own configuration this status reads: where it is, and that app's own words for a fix. */
const APPS = {
  codex: { name: 'Codex', home: (env, home) => env.CODEX_HOME || (home && join(home, '.codex')) || null, project: '.codex', add: (name, url) => `codex mcp add ${name} --url ${url}` },
  grok: { name: 'Grok', home: (env, home) => env.GROK_HOME || (home && join(home, '.grok')) || null, project: '.grok', add: (name, url) => `grok mcp add ${name} ${url}` },
};
/** The name Homie's connector takes when another MCP server already has `homie`. No underscore: Grok's hooks match on it. */
export const CONNECTOR_NAME = 'homie-rocks';

/**
 * Which app this session runs in, for the rows that differ by app: the one the AI named (`--client`, or HOMIE_CLIENT),
 * else what the app's own environment shows (Claude Code and Codex set variables of their own on the commands they
 * run). Null when neither says: never a guess.
 */
export function sessionApp(client, env = process.env) {
  const said = studioClient(client, env).id;
  if (said !== 'chat') return said;
  if (env.CLAUDECODE === '1') return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED || env.CODEX_CI) return 'codex';
  return null;
}

/**
 * Another MCP server under the name the Homie plugin's connector uses (`homie`), in the configuration of the app in
 * use: its config.toml in the app's home folder, or the one in this folder (`.codex/`, `.grok/`). The person's own
 * entry wins over a plugin's of the same name, so the plugin's tools never load. It reads only the
 * `[mcp_servers.homie]` table's `url` and `command` keys, and returns only what kind of server it is and where it
 * was found, never the command, its arguments, its environment or a header. Null when there is none, or it is
 * Homie's own address.
 */
export function connectorClash({ app, env = process.env, cwd = process.cwd(), root = null, directory = 'https://homie.rocks' } = {}) {
  const a = APPS[app];
  if (!a) return null;
  const home = env.HOME || env.USERPROFILE || '';
  const ours = new Set(['https://homie.rocks/mcp', `${String(directory).replace(/\/+$/, '')}/mcp`]);
  const places = [
    ...[...new Set([root, cwd].filter(Boolean))].map((dir) => ({ file: join(dir, a.project, 'config.toml'), where: `this folder's ${a.project}/config.toml` })),
    { file: a.home(env, home) ? join(a.home(env, home), 'config.toml') : null, where: `config.toml in ${a.name}'s home folder` },
  ];
  for (const { file, where } of places) {
    let text;
    try { if (!file || !existsSync(file)) continue; text = readFileSync(file, 'utf8'); } catch { continue; }
    if (text.length > 16 * 1024 * 1024) continue;
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s*\[\s*mcp_servers\s*\.\s*(?:"homie"|'homie'|homie)\s*\]\s*(?:#.*)?$/.test(l));
    if (at < 0) continue;
    let url = null; let command = false;
    for (let i = at + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i += 1) {
      const m = /^\s*(url|command)\s*=\s*(.*?)\s*$/.exec(lines[i]);
      if (!m) continue;
      if (m[1] === 'command') command = true;
      else url = (/^(["'])(.*?)\1/.exec(m[2])?.[2] ?? m[2]).replace(/\/+$/, '');
    }
    if (url && !command && ours.has(url)) return null;
    return { app, name: a.name, where, kind: command ? 'a local command' : url ? 'another address' : 'another server' };
  }
  return null;
}

/** How long a mark of Homie's hooks counts as "ran just now": they stamp it at every message and every tool call. */
export const HOLDS_FRESH_MS = 10 * 60_000;

/**
 * The mark Homie's hooks leave each time they run in Codex or Grok Build (the plugin's hooks/codex.mjs `mark`): a
 * small dated file in this user's cache, <app>.json, { v, app, at, event }. { at, event, ageMs } or null. HOMIE_HOLDS_MARKS
 * names another folder (the tests use it).
 */
export function holdsMark(app, { env = process.env, now = Date.now() } = {}) {
  const home = env.HOME || env.USERPROFILE || '';
  const dir = env.HOMIE_HOLDS_MARKS || (home && join(home, '.cache', 'homie-studio', 'holds'));
  if (!dir || !/^[a-z]+$/.test(String(app ?? ''))) return null;
  try {
    const m = JSON.parse(readFileSync(join(dir, `${app}.json`), 'utf8'));
    const at = Number(m?.at);
    if (!Number.isFinite(at) || at <= 0) return null;
    return { at, event: typeof m.event === 'string' ? m.event.slice(0, 20) : null, ageMs: Math.max(0, now - at) };
  } catch { return null; }
}

const ago = (ms) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : ms < 36 * 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} days`);

/**
 * The checklist. `connector`: what the AI knows about its own tools ('yes' when the Homie MCP tools such as
 * studio_scaffold are in its tool list, 'no' when they are not, null when unsaid). `client`: the app the AI says it
 * is ('claude', 'codex', 'grok'; sessionApp reads the environment when it is unsaid). `exec`, `fetchFn` and `nowMs` are
 * replaceable for tests.
 */
export async function setupStatus({
  cwd = process.cwd(), env = process.env, platform = process.platform, connector = null, homie = null, client = null,
  exec = defaultExec, fetchFn = globalThis.fetch, chrome = findChrome, node = process.versions.node, nowMs = Date.now(),
} = {}) {
  const root = findStudio(cwd);
  let studio = null;
  try { studio = root ? readStudio(root) : null; } catch { studio = null; }
  const cli = root ? 'npx --no-install homie-studio' : `npx -y @homie-rocks/studio@${STUDIO_VERSION}`;
  let directory = String(homie || (studio?.homie?.directory && typeof studio.homie.directory === 'string' ? studio.homie.directory : 'https://homie.rocks')).replace(/\/+$/, '');
  try { new URL(directory); } catch { directory = 'https://homie.rocks'; }
  const mac = platform === 'darwin';
  const win = platform === 'win32';
  const rows = [];

  // Node.js
  const major = Number(String(node).split('.')[0]);
  rows.push({
    id: 'node', label: 'Node.js', need: 'required', state: major >= 22 ? 'ok' : 'missing', detail: `v${node}${major >= 22 ? '' : ' (22 or newer is needed)'}`,
    unlocks: 'everything: the studio\'s toolkit runs on it',
    fix: major >= 22 ? null : { who: 'person', open: 'https://nodejs.org/en/download', say: 'Install Node.js 22 or newer (the LTS download), then start a new session.' },
  });

  // The Homie connector (the AI says; the network is checked here), Cloudflare, GitHub and the providers, at once.
  const said = connector === true || connector === 'yes' ? 'yes' : connector === false || connector === 'no' ? 'no' : null;
  const [net, who, gh, eleven, fal] = await Promise.all([
    reach(`${directory}/mcp`, fetchFn),
    (async () => {
      if (env.CLOUDFLARE_API_TOKEN) return { signedIn: true, how: 'an API token in the environment' };
      const bin = root ? join(root, 'node_modules', '.bin', win ? 'wrangler.cmd' : 'wrangler') : null;
      if (!bin || !existsSync(bin)) return { signedIn: null };
      // Through Stripe Projects (studio.json "auth": "stripe-projects"): Wrangler with the token Projects synced.
      const projects = projectsCloudflareEnv(root);
      const r = await exec(bin, ['whoami', '--json'], { cwd: root, timeout: 25_000, env: { ...env, ...projects, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
      if (projects.CLOUDFLARE_API_TOKEN && r.code === 0) {
        try { if (JSON.parse(r.stdout.slice(Math.max(0, r.stdout.indexOf('{')))).loggedIn) return { signedIn: true, how: 'through Stripe Projects (its token, in the studio\'s git-ignored .env; never shown)', accounts: 1, accountIds: [projects.CLOUDFLARE_ACCOUNT_ID].filter(Boolean) }; } catch { /* read below */ }
      }
      if (r.code === 124) return { signedIn: null, why: 'Wrangler did not answer in time' };
      // The accounts' ids stay in this process (the Workers AI row calls the studio's own account); never printed.
      try { const d = JSON.parse(r.stdout.slice(Math.max(0, r.stdout.indexOf('{')))); return { signedIn: Boolean(d.loggedIn), accounts: Array.isArray(d.accounts) ? d.accounts.length : null, accountIds: Array.isArray(d.accounts) ? d.accounts.map((a) => a?.id).filter(Boolean) : [] }; } catch { return { signedIn: false }; }
    })(),
    (async () => {
      const git = await exec('git', ['--version']);
      // The studio's own repository: on GitHub (a Claude app studio always is: its setup card made it there).
      const remote = root && git.code === 0 ? (await exec('git', ['remote', 'get-url', 'origin'], { cwd: root })).stdout.trim() : '';
      const onGitHub = /(^|[/@.])github\.com[/:]/i.test(remote);
      if (env.GH_TOKEN || env.GITHUB_TOKEN) return { git: git.code === 0, gh: true, signedIn: true, onGitHub };
      const v = await exec('gh', ['--version']);
      if (v.code !== 0) return { git: git.code === 0, gh: false, signedIn: false, onGitHub };
      return { git: git.code === 0, gh: true, signedIn: (await exec('gh', ['auth', 'status'], { timeout: 10_000 })).code === 0, onGitHub };
    })(),
    (async () => {
      const cliBin = env.ELEVENLABS_CLI || 'elevenlabs';
      const v = await exec(cliBin, ['--version']);
      let signedIn = false;
      if (v.code === 0) {
        const s = await exec(cliBin, ['auth', 'status', '--format', 'json'], { timeout: 10_000 });
        try { signedIn = Boolean(JSON.parse(s.stdout)?.schemes?.some((x) => x.logged_in)); } catch { signedIn = false; }
      }
      return { cli: v.code === 0, signedIn, key: Boolean(env.ELEVENLABS_API_KEY), projects: root ? projectsElevenLabs(root) : false };
    })(),
    (async () => {
      const key = String(env.FAL_KEY ?? '').trim();
      if (!key) return { key: false };
      const base = String(env.FAL_API_URL || 'https://api.fal.ai').replace(/\/+$/, '');
      try {
        const res = await fetchFn(`${base}/v1/models/pricing?endpoint_id=fal-ai/flux/dev`, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(6000) });
        return { key: true, valid: res.ok ? true : res.status === 401 || res.status === 403 ? false : null };
      } catch { return { key: true, valid: null }; }
    })(),
  ]);

  // The Homie connector. A session with a shell makes, deploys and lists a studio without it, so it never blocks.
  const app = sessionApp(client, env);
  {
    const host = new URL(directory).host;
    const fixConnector = {
      who: 'person',
      say: `Turn the Homie connector on. Claude Code: run /plugin, install or enable "homie" (marketplace homie-rocks/homie), then /mcp shows homie connected. Codex: install the Homie plugin from the same marketplace (codex plugin marketplace add homie-rocks/homie, then codex plugin add homie@homie) and start a new session. Grok Build: grok plugin install homie-rocks/homie#plugins/homie (Grok asks whether to trust it), then a new session. The Claude app, or Grok chat: add the connector https://homie.rocks/mcp; its setup card (studio_setup) makes the studio on your own Cloudflare. Grok has no Cloudflare connector: you still approve Cloudflare in the browser. A Grok Bot on this computer runs the checklist and checks in with setup attach <hs_…> --client grok. Meanwhile a session with a shell goes on without it: ${cli} ${root ? '<command>' : 'new <folder> --name "<Name>"'} makes ${root ? 'everything in the studio' : 'the studio'}.`,
    };
    // Another MCP server already called `homie` in this app's own config: the plugin's connector cannot load under it.
    const clash = said !== 'yes' ? connectorClash({ app, env, cwd, root, directory }) : null;
    const fixClash = clash ? {
      who: 'ai', run: APPS[clash.app].add(CONNECTOR_NAME, `${directory}/mcp`),
      say: `Another MCP server named homie is set up in ${clash.name} (${clash.where}). The Homie plugin's connector has the same name, and an app loads one server under a name, so the plugin's tools are missing while that one is there. This adds Homie's connector under its own name, ${CONNECTOR_NAME}, and leaves the other server as it is; you approve it, then start a new session. Until then your AI goes on with the studio's own commands.`,
    } : null;
    let state; let detail;
    if (net.blocked) { state = 'act'; detail = `the network proxy of this machine refused ${host}`; }
    else if (said === 'yes') { state = 'ok'; detail = net.ok ? 'the Homie tools are here, and the directory answers' : `the Homie tools are here; this computer's request to the directory failed just now: ${net.why}`; }
    else if (clash) { state = 'act'; detail = `${said === 'no' ? 'the Homie tools are not in this session' : 'your AI knows whether its Homie tools (studio_scaffold) are here'}; another MCP server named homie (${clash.kind}) is set up in ${clash.name}, in ${clash.where}, and it takes the name the Homie plugin's connector uses`; }
    else if (said === 'no') { state = 'act'; detail = 'the Homie tools are not in this session; a studio is still made, checked, deployed and listed with the studio\'s own commands'; }
    // The directory not answering this computer says nothing about the connector: say what failed, as it is.
    else { state = 'unknown'; detail = net.ok ? `${host} answers; your AI knows whether its Homie tools (studio_scaffold) are here` : `this computer's request to the directory failed: ${net.why}`; }
    rows.push({
      id: 'connector', label: 'Homie connector', need: 'recommended', state, detail,
      unlocks: 'searching the homie.rocks directory, the cards where your app draws them, and notes to Homie; a session with a shell makes, deploys and lists a studio without it',
      fix: state === 'ok' ? null : net.blocked
        ? { who: 'person', say: `In claude.ai/code, open this environment's settings, set Network access to Custom, add ${host} (keep the default package managers), and start a new session.` }
        : fixClash ?? (said === 'no' || net.ok ? fixConnector : null),
      ...(clash && !net.blocked ? { clash: { app: clash.app, server: 'homie', kind: clash.kind, where: clash.where, as: CONNECTOR_NAME } } : {}),
    });
  }

  // Homie's holds, in Codex and Grok Build: each app runs a plugin's hooks only once the person has trusted them
  // (Codex in /hooks, Grok by trusting the plugin), and neither says so when it skips them. The hooks leave a dated
  // mark at every message and tool call; a fresh one means they are on. (0.30.2 said Grok runs no plugin's hooks.
  // It does: the plugin's root manifest named no hooks file, so Grok loaded the Claude Code mod's and found none.)
  if (app === 'codex' || app === 'grok') {
    const name = APPS[app].name;
    const seen = holdsMark(app, { env, now: nowMs });
    const on = Boolean(seen && seen.ageMs <= HOLDS_FRESH_MS);
    rows.push({
      // Off is the person's to fix now, in either app: trust the hooks.
      id: 'holds', label: 'Homie\'s holds', need: 'recommended', state: on ? 'ok' : 'act', on, app,
      detail: on ? `on: Homie's hooks ran in ${name} ${ago(seen.ageMs)} ago`
        : seen ? `off: Homie's hooks last ran in ${name} ${ago(seen.ageMs)} ago, and not for this session's calls`
          : `off: Homie's hooks have not run in ${name} on this computer`,
      ...(seen ? { seen: { at: new Date(seen.at).toISOString(), event: seen.event } } : {}),
      unlocks: 'a wait for your own "proceed <code>" before a production deploy, an edit to a file the studio protects, a Cloudflare change outside the deploy, a paid call past the budget and a model download; and secrets taken out of what your AI reads',
      fix: on ? null : {
        who: 'person',
        say: app === 'codex'
          ? 'In Codex, open /hooks and trust Homie\'s three hooks: Codex runs no plugin\'s hooks until you do. Then run this again. Until then nothing is held, so your AI asks you before each of those itself.'
          : 'Grok runs a plugin\'s hooks only once the plugin is trusted, and only from a Homie plugin new enough to name them for Grok. Install it again with trust (grok plugin install homie-rocks/homie#plugins/homie --trust), start a new session (/hooks lists Homie\'s three), then run this again. Until then nothing is held, so your AI asks you before each of those itself.',
      },
    });
  }

  // Cloudflare: signed in, and the account's email verified.
  {
    const local = root ? readLocal(root) : {};
    const created = studio?.cloudflare?.created ?? [];
    const deployed = Boolean(local.deployedAt || created.some((c) => String(c).startsWith('worker:')));
    // A studio the setup card made (`setup attach` wrote connectedAt): Cloudflare's Deploy button made
    // it on the person's account and Workers Builds deploys every merge, so no sign-in is needed on this computer.
    const attached = Boolean(local.connectedAt);
    const signedIn = attached || who.signedIn === true ? 'ok' : who.signedIn === false ? 'act' : 'later';
    const verified = deployed || attached ? 'ok' : local.needs === 'cloudflare-verify-email' ? 'act' : 'later';
    const parts = attached ? [
      { label: 'connected', state: 'ok', detail: 'through the setup card (Deploy to Cloudflare); Workers Builds deploys every merge' },
      { label: 'email verified', state: 'ok', detail: 'the site is live' },
    ] : [
      { label: 'signed in', state: signedIn, detail: who.signedIn === true ? (who.how ?? `${who.accounts ?? 1} account${who.accounts === 1 || who.accounts === null || who.accounts === undefined ? '' : 's'}`) : who.signedIn === false ? 'not signed in' : root ? (who.why ?? 'run npm install in the studio, then this again') : 'checked once the studio exists (it brings its own Wrangler)' },
      { label: 'email verified', state: verified, detail: deployed ? 'a deploy went through' : verified === 'act' ? 'the last deploy was refused until it is' : 'Cloudflare checks it at the first deploy' },
    ];
    const fix = attached ? null : signedIn === 'act'
      ? { who: 'ai', run: 'npx wrangler login', say: 'Cloudflare opens in your browser: approve once. A free account works; no payment method.', open: 'https://dash.cloudflare.com/sign-up' }
      : verified === 'act'
        ? { who: 'person', open: 'https://dash.cloudflare.com/profile', say: 'Open the email Cloudflare sent and click its link (or Profile, "Send verification email"); then deploy again.' }
        : signedIn === 'later' || verified === 'later'
          ? { who: 'person', open: 'https://dash.cloudflare.com/sign-up', say: 'No Cloudflare account yet? Make a free one now (no payment method) and click the link in the email it sends. Your AI signs in for you later; you approve once.' }
          : null;
    rows.push({
      id: 'cloudflare', label: 'Cloudflare', need: 'to go online', state: worst(parts.map((p) => p.state)), detail: parts.map((p) => `${p.label}: ${p.detail}`).join('; '), parts,
      unlocks: 'putting the studio\'s site and public rooms online, on its own free Cloudflare account', fix,
    });
  }

  // Workers AI, only when a server's AI guides think with it: does the model they use answer on this account?
  {
    const local = root ? readLocal(root) : {};
    const live = Boolean(local.deployedAt || local.connectedAt || (studio?.cloudflare?.created ?? []).some((c) => String(c).startsWith('worker:')));
    const bin = root ? join(root, 'node_modules', '.bin', win ? 'wrangler.cmd' : 'wrangler') : null;
    const row = root ? await workersAiRow({ root, studio, env, exec, fetchFn, who, bin, remote: live && Boolean(who.signedIn || env.CLOUDFLARE_API_TOKEN), cli }) : null;
    if (row) rows.push(row);
  }

  // Chrome, for the checks.
  {
    const found = chrome();
    rows.push({
      id: 'chrome', label: 'Chrome', need: 'for checks', state: found ? 'ok' : 'act', detail: found ? 'found' : 'no Chrome on this computer',
      unlocks: 'the two-browser check, the look pictures and playtests (games build and run without it)',
      fix: found ? null : { who: 'ai', run: `${cli} chrome install`, say: 'Chrome for Testing goes into a cache folder (about 150 MB), only for the checks.', open: mac || win ? 'https://www.google.com/chrome/' : undefined },
    });
  }

  // ffmpeg.
  {
    const ok = (await exec('ffmpeg', ['-version'])).code === 0;
    rows.push({
      id: 'ffmpeg', label: 'ffmpeg', need: 'recommended', state: ok ? 'ok' : 'optional', detail: ok ? 'found' : 'not installed',
      unlocks: 'sound effects and a synthesized theme (free, on this computer), trailers, and footage in a landing page\'s hero',
      fix: ok ? null : mac ? { who: 'ai', run: 'brew install ffmpeg', say: 'about a minute with Homebrew; you approve the install.' }
        : win ? { who: 'ai', run: 'winget install --id Gyan.FFmpeg -e', say: 'you approve the install.' }
          : { who: 'person', say: 'Install your system\'s ffmpeg package (for example: sudo apt-get install -y ffmpeg).' },
    });
  }

  // Clef on this computer (0.24.4, lib/local-ai.mjs): Ollama with clef-flash. Optional, and never downloaded here: the
  // person says yes to the size first. In a studio only (it serves `dev`).
  if (root) {
    const found = await detectLocalAi({ env, fetchFn });
    rows.push({
      id: 'local-ai', label: 'Clef on this computer', need: 'optional', state: found.ok ? 'ok' : 'optional',
      detail: found.ok ? `${found.model} on Ollama ${found.version}` : found.why === 'no-model' ? `Ollama ${found.version} is here, without clef-flash` : found.why === 'old-ollama' ? `Ollama ${found.version} is too old for Clef (0.35.1 or later)` : 'no Ollama running here',
      unlocks: 'AI guides, chat review and a game\'s own decisions under `dev` with no Cloudflare and no cost, and a guide seat that thinks on this computer (agents sit --brain local)',
      fix: found.ok ? null : { who: 'person', say: found.say, ...(found.why === 'no-ollama' ? { open: 'https://ollama.com/download' } : {}) },
    });
  }

  // GitHub.
  rows.push({
    id: 'github', label: 'GitHub', need: 'optional', state: gh.signedIn || gh.onGitHub ? 'ok' : 'optional',
    detail: [gh.onGitHub ? 'this studio\'s repository is on GitHub' : null, gh.signedIn ? 'the GitHub CLI is signed in' : gh.gh ? 'the GitHub CLI is here, not signed in' : gh.git ? 'git is here; no GitHub CLI' : 'no git'].filter(Boolean).join('; '),
    unlocks: 'a private backup of the studio, publishing changes by pull request, and building from the Claude app',
    fix: gh.signedIn || gh.onGitHub ? null : gh.gh
      ? { who: 'ai', run: 'gh auth login --hostname github.com --git-protocol https --web', say: 'GitHub shows a one-time code: open https://github.com/login/device, type it and approve.' }
      : { who: 'person', open: 'https://github.com/signup', say: `Make a free GitHub account; your AI installs the GitHub CLI${mac ? ' (brew install gh)' : ''} when you want the backup.` },
  });

  // ElevenLabs.
  rows.push({
    id: 'elevenlabs', label: 'ElevenLabs', need: 'optional', state: eleven.signedIn || eleven.key || eleven.projects ? 'ok' : 'optional',
    detail: eleven.signedIn ? 'the elevenlabs CLI is signed in' : eleven.key ? 'ELEVENLABS_API_KEY is set' : eleven.projects ? 'through Stripe Projects (its key, in the studio\'s git-ignored .env; never shown)' : eleven.cli ? 'the elevenlabs CLI is here, not signed in' : 'not connected',
    unlocks: 'songs and game scores (the music skill), billed to your own ElevenLabs plan; every render is quoted first',
    fix: eleven.signedIn || eleven.key || eleven.projects ? null : eleven.cli
      ? { who: 'ai', run: 'elevenlabs auth login', say: 'ElevenLabs opens in your browser; sign in once. No key is pasted anywhere.' }
      : { who: mac ? 'ai' : 'person', run: mac ? 'brew install elevenlabs/tap/elevenlabs && elevenlabs auth login' : undefined, open: 'https://elevenlabs.io/sign-up', say: 'Make an ElevenLabs account when you want songs; your AI installs their CLI and you sign in once in the browser.' },
  });

  // fal.
  rows.push({
    id: 'fal', label: 'fal', need: 'optional', state: fal.key ? (fal.valid === false ? 'act' : 'ok') : 'optional',
    detail: !fal.key ? 'no FAL_KEY in this environment' : fal.valid === true ? 'FAL_KEY is set and fal accepts it' : fal.valid === false ? 'fal refused the FAL_KEY that is set (wrong or revoked)' : 'FAL_KEY is set (fal did not answer just now)',
    unlocks: 'painted art and backdrops (the art skill) and generated video clips (the video skill), on your own fal account under a budget; covers from a real frame and captured trailers are free',
    fix: fal.key && fal.valid !== false ? null : { who: 'person', open: 'https://fal.ai/dashboard/keys', say: 'Make a key, put FAL_KEY in the environment your AI runs in (for example a line in your shell profile), and start a new session. Never paste it into the chat.' },
  });

  // Stripe, only in a studio that sells. Installing agent tooling is not proof of Worker credentials.
  // shop connect runs browser pairing and reports the remaining steps; this read-only status never reads keys.
  if (root && existsSync(join(root, 'shop.json'))) {
    const v = await exec('stripe', ['--version']);
    const version = v.code === 0 ? /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null : null;
    const mcp = stripeAgentConfigured({ root, env });
    rows.push({
      id: 'stripe', label: 'Stripe', need: 'for selling', state: 'act',
      detail: [version ? `Stripe CLI ${version} is installed` : 'Stripe CLI is not installed', mcp ? `optional MCP is set up for ${mcp}` : 'optional MCP is not set up', 'CLI access is not proof that Worker credentials or a purchase work'].join('; '),
      unlocks: 'Connect the studio’s own Stripe with browser approval; shop connect syncs Payment Links and the webhook without a Worker API key. Verify a test purchase before calling the shop ready.',
      fix: {
        who: 'ai', run: version ? 'npx --no-install homie-studio shop connect' : 'npm install -g @stripe/cli@latest',
        say: 'Use stripe_login or shop connect. Never ask for a key in chat. Sync Products, Prices, Payment Links and the webhook through the approved CLI. The Worker needs only the signing secret; repeat connect after edits.',
        open: 'https://dashboard.stripe.com/register',
      },
    });
  }

  // Standalone copies (standalone/STANDALONE.md), only in a studio where a game has a "standalone" block: what the
  // desktop and phone builds need here. Every one is optional: a target whose tool is missing is skipped, never blocking.
  {
    let asked = false;
    try { asked = Boolean(root) && listGames(root).some((g) => g.standalone && typeof g.standalone === 'object'); } catch { asked = false; }
    if (asked) rows.push(...await standaloneRows({ platform, exec, env }));
  }

  // The Claude Code status line (only in Claude Code, only in a studio).
  if (root && env.CLAUDECODE === '1') {
    let on = false;
    try { on = isOurs(JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8')).statusLine); } catch { on = false; }
    rows.push({
      id: 'statusline', label: 'Status line', need: 'optional', state: on ? 'ok' : 'optional', detail: on ? 'on in this studio' : 'off',
      unlocks: 'the current build\'s stage and a progress bar under the prompt in Claude Code',
      fix: on ? null : { who: 'ai', run: 'npx --no-install homie-studio statusline --install', say: 'one line under the prompt; off again with --remove.' },
    });
  }

  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const ready = (state) => (state === 'ok' ? 'ready' : state === 'later' ? 'later' : 'not yet');
  const features = [
    { feature: 'Make games and play them here', state: ready(by.node.state), needs: ['node'] },
    { feature: 'Two-browser checks and playtests', state: ready(by.chrome.state), needs: ['chrome'] },
    { feature: 'Sound effects and a theme (free)', state: ready(by.ffmpeg.state), needs: ['ffmpeg'] },
    { feature: 'Put the studio online', state: ready(by.cloudflare.parts[0].state === 'ok' ? by.cloudflare.parts[1].state : by.cloudflare.parts[0].state), needs: ['cloudflare'] },
    // Listing needs the directory, not the connector: `homie-studio publish` reaches it from this computer.
    { feature: 'List games in the homie.rocks directory', state: by.connector.state === 'ok' || net.ok ? 'ready' : 'not yet', needs: ['connector'] },
    { feature: 'Backup and pull requests', state: ready(by.github.state), needs: ['github'] },
    { feature: 'Songs and game scores', state: ready(by.elevenlabs.state), needs: ['elevenlabs'] },
    { feature: 'Painted art and generated video', state: ready(by.fal.state), needs: ['fal'] },
    ...(by['workers-ai'] ? [{ feature: 'AI guides that think (Workers AI)', state: ready(by['workers-ai'].state), needs: ['workers-ai'] }] : []),
    ...(by.stripe ? [{ feature: 'Sell in the games (the shop, with Stripe\'s own tools)', state: ready(by.stripe.state), needs: ['stripe'] }] : []),
  ];
  const now = rows.filter((r) => ['missing', 'act'].includes(r.state) && r.fix);
  const meanwhile = rows.filter((r) => r.fix?.open && r.state !== 'ok' && (r.fix.who === 'person' || r.state === 'later'));
  return {
    ok: true, command: 'setup status', version: STUDIO_VERSION,
    studio: root ? { name: studio?.name ?? null, root } : null,
    rows, features,
    blocking: rows.filter((r) => r.state === 'missing').map((r) => r.id),
    next: now.map((r) => ({ id: r.id, who: r.fix.who, run: r.fix.run ?? null, open: r.fix.open ?? null, say: r.fix.say })),
    meanwhile: meanwhile.map((r) => ({ id: r.id, open: r.fix.open, say: r.fix.say })),
    note: 'Optional rows never block anything: each one is set up the first time a feature needs it.',
  };
}

/**
 * Where Stripe's MCP server (https://mcp.stripe.com) is set up for this person's AI: Claude Code (the Stripe plugin,
 * or an MCP entry in .claude.json in the home folder, or the studio's .mcp.json) or Codex (config.toml in the Codex
 * home folder). It only looks for the address or the plugin's name in those files; it never reads a key and never
 * prints what it found. Null when nowhere.
 */
export function stripeAgentConfigured({ root, env = process.env } = {}) {
  const home = env.HOME || env.USERPROFILE || '';
  const look = (file, re) => {
    try { if (!file || !existsSync(file)) return false; const t = readFileSync(file, 'utf8'); return t.length < 64 * 1024 * 1024 && re.test(t); } catch { return false; }
  };
  const mcp = /mcp\.stripe\.com/;
  if (look(home && join(home, '.claude', 'plugins', 'installed_plugins.json'), /"stripe@/) || look(home && join(home, '.claude.json'), mcp) || look(root && join(root, '.mcp.json'), mcp)) return 'Claude Code';
  if (look(join(env.CODEX_HOME || (home && join(home, '.codex')) || '', 'config.toml'), /mcp\.stripe\.com|\[mcp_servers\.stripe\]|stripe@openai-curated/)) return 'Codex';
  return null;
}

/** The checklist as a person reads it in a terminal. */
export function formatStatus(r) {
  const lines = [`Setup status${r.studio?.name ? ` for ${r.studio.name}` : ' (before the studio exists)'}`, ''];
  const pad = Math.max(...r.rows.map((x) => x.label.length)) + 2;
  for (const row of r.rows) {
    lines.push(`  ${MARK[row.state] ?? '?'} ${row.label.padEnd(pad)}${row.need === 'optional' ? '(optional) ' : row.need === 'recommended' ? '(recommended) ' : ''}${row.parts ? row.parts.map((p) => `${MARK[p.state]} ${p.label}: ${p.detail}`).join('  ') : row.detail}`);
    lines.push(`    ${''.padEnd(pad)}unlocks ${row.unlocks}`);
    if (row.fix && row.state !== 'ok') lines.push(`    ${''.padEnd(pad)}${row.fix.run ? `fix: ${row.fix.run}  ` : ''}${row.fix.open ? `${row.fix.run ? '' : 'fix: '}${row.fix.open}  ` : ''}${row.fix.say}`);
  }
  lines.push('', `Ready: ${r.features.map((f) => `${f.feature} ${f.state === 'ready' ? MARK.ok : f.state === 'later' ? MARK.later : MARK.optional}`).join(' · ')}`);
  if (r.next.length) lines.push('', 'Do this now:', ...r.next.map((n) => `  ${MARK.act} ${n.run ?? n.open ?? ''}  ${n.say}`));
  if (r.meanwhile.length) lines.push('', 'Safe to do any time, even while you wait for something else:', ...r.meanwhile.map((m) => `  ${m.open}  ${m.say}`));
  lines.push('', r.note, `(${MARK.ok} ready  ${MARK.act} do this now  ${MARK.missing} missing  ${MARK.optional} optional, not set up  ${MARK.later} checked later  ? your AI knows)`);
  return lines.join('\n');
}
