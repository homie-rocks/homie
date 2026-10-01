/**
 * `homie-studio setup status` (also `homie-studio doctor`): what this computer and this person's accounts have for
 * a studio, as one checklist, before anything is made. For each thing: green, missing, or "do this now", what it
 * unlocks, and the exact fix: one command the AI runs, or one page the person taps.
 *
 *   Node.js            required    the toolkit runs on it
 *   Homie connector    required    the directory, cards and the pinned toolkit's address (the AI says whether its
 *                                  Homie tools are there: --connector yes|no)
 *   Cloudflare         to go online: signed in, and the account's email verified (Cloudflare checks that at the
 *                                  first deploy; a deploy that went through proves it)
 *   Chrome             for checks  the two-browser check, the look pictures and playtests
 *   ffmpeg             recommended sound effects and the theme, trailers and hero footage
 *   GitHub             optional    a private backup, publishing by pull request, building from the Claude app
 *   ElevenLabs         optional    songs and game scores
 *   fal                optional    painted art and generated video
 *   status line        optional    (Claude Code only) the build's progress under the prompt
 *
 * It is safe at any time, inside a studio or before one exists: it only reads (local files, `--version` of a few
 * tools, `wrangler whoami`, `gh auth status`, `elevenlabs auth status`, one GET to the directory and, when a fal key
 * is set, fal's free pricing API), never changes anything, and never prints a key, a token or an account's name.
 * Every check has a time limit, so it answers in seconds even with no network.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome } from './chrome.mjs';
import { isOurs } from './statusline.mjs';
import { findStudio, readLocal, readStudio } from './studio.mjs';
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

async function reach(url, fetchFn, ms = 5000) {
  try {
    const res = await fetchFn(url, { method: 'GET', headers: { 'user-agent': `homie-studio/${STUDIO_VERSION}`, accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    const deny = res.headers?.get?.('x-deny-reason') ?? '';
    if (res.status === 403 && /host_not_allowed/i.test(deny)) return { ok: false, blocked: true };
    return { ok: true, status: res.status };
  } catch (error) { return { ok: false, why: error?.name === 'TimeoutError' ? 'did not answer in time' : 'did not answer' }; }
}

/**
 * The checklist. `connector`: what the AI knows about its own tools ('yes' when the Homie MCP tools such as
 * studio_scaffold are in its tool list, 'no' when they are not, null when unsaid). `exec` and `fetchFn` are
 * replaceable for tests.
 */
export async function setupStatus({
  cwd = process.cwd(), env = process.env, platform = process.platform, connector = null, homie = null,
  exec = defaultExec, fetchFn = globalThis.fetch, chrome = findChrome, node = process.versions.node,
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
      const r = await exec(bin, ['whoami', '--json'], { cwd: root, timeout: 25_000, env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
      if (r.code === 124) return { signedIn: null, why: 'Wrangler did not answer in time' };
      try { const d = JSON.parse(r.stdout.slice(Math.max(0, r.stdout.indexOf('{')))); return { signedIn: Boolean(d.loggedIn), accounts: Array.isArray(d.accounts) ? d.accounts.length : null }; } catch { return { signedIn: false }; }
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
      return { cli: v.code === 0, signedIn, key: Boolean(env.ELEVENLABS_API_KEY) };
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

  // The Homie connector.
  {
    const fixConnector = {
      who: 'person',
      say: 'Turn the Homie connector on. Claude Code: run /plugin, install or enable "homie" (marketplace homie-rocks/homie), then /mcp shows homie connected. Codex: install the Homie plugin from the same marketplace. The Claude app: Settings, Connectors, Add custom connector, https://homie.rocks/mcp; then its setup card (studio_setup) makes the studio on your own Cloudflare and GitHub in three taps.',
    };
    let state; let detail;
    if (net.blocked) { state = 'act'; detail = `this environment's network does not reach ${new URL(directory).host}`; }
    else if (said === 'yes') { state = 'ok'; detail = net.ok ? 'the Homie tools are here, and the directory answers' : `the Homie tools are here; ${new URL(directory).host} ${net.why ?? 'did not answer'} just now`; }
    else if (said === 'no') { state = 'act'; detail = 'the Homie tools are not in this session'; }
    else { state = net.ok ? 'unknown' : 'act'; detail = net.ok ? `${new URL(directory).host} answers; your AI knows whether its Homie tools (studio_scaffold) are here` : `${new URL(directory).host} ${net.why ?? 'did not answer'}`; }
    rows.push({
      id: 'connector', label: 'Homie connector', need: 'required', state, detail,
      unlocks: 'making the studio with the right toolkit version, listing games in the homie.rocks directory, and the cards in the Claude app',
      fix: state === 'ok' ? null : net.blocked
        ? { who: 'person', say: `In claude.ai/code, open this environment's settings, set Network access to Custom, add ${new URL(directory).host} (keep the default package managers), and start a new session.` }
        : fixConnector,
    });
  }

  // Cloudflare: signed in, and the account's email verified.
  {
    const local = root ? readLocal(root) : {};
    const created = studio?.cloudflare?.created ?? [];
    const deployed = Boolean(local.deployedAt || created.some((c) => String(c).startsWith('worker:')));
    // A studio the Claude app's setup card made (`setup attach` wrote connectedAt): Cloudflare's Deploy button made
    // it on the person's account and Workers Builds deploys every merge, so no sign-in is needed on this computer.
    const attached = Boolean(local.connectedAt);
    const signedIn = attached || who.signedIn === true ? 'ok' : who.signedIn === false ? 'act' : 'later';
    const verified = deployed || attached ? 'ok' : local.needs === 'cloudflare-verify-email' ? 'act' : 'later';
    const parts = attached ? [
      { label: 'connected', state: 'ok', detail: 'through the Claude app\'s setup card (Deploy to Cloudflare); Workers Builds deploys every merge' },
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
    id: 'elevenlabs', label: 'ElevenLabs', need: 'optional', state: eleven.signedIn || eleven.key ? 'ok' : 'optional',
    detail: eleven.signedIn ? 'the elevenlabs CLI is signed in' : eleven.key ? 'ELEVENLABS_API_KEY is set' : eleven.cli ? 'the elevenlabs CLI is here, not signed in' : 'not connected',
    unlocks: 'songs and game scores (the music skill), billed to your own ElevenLabs plan; every render is quoted first',
    fix: eleven.signedIn || eleven.key ? null : eleven.cli
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
    { feature: 'List games in the homie.rocks directory', state: ready(by.connector.state), needs: ['connector'] },
    { feature: 'Backup and pull requests', state: ready(by.github.state), needs: ['github'] },
    { feature: 'Songs and game scores', state: ready(by.elevenlabs.state), needs: ['elevenlabs'] },
    { feature: 'Painted art and generated video', state: ready(by.fal.state), needs: ['fal'] },
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
