/**
 * THE LOCAL MCP SERVER'S TOOLS (`homie-studio mcp`, lib/mcp.mjs): the studio toolkit as MCP tools, so the Claude
 * desktop app (through the Homie extension), Claude Code or any MCP client builds games in the SAME chat that shows
 * the cards. Where a tool overlaps the remote Homie MCP (homie.rocks/mcp) it has the same name and the same input
 * shape: studio_scaffold, studio_card, game_make, game_port, preview_run, studio_deploy,
 * studio_publish, build_open, build_progress, build_stop. The remote ones say what to run; these run it, here.
 *
 * Long work never holds a tool call: a check, a playtest, a deploy or an npm install starts as a job (lib/jobs.mjs)
 * and the call answers within about 40 s (the Claude desktop app gives a local tool call 60 s). A check, playtest
 * or deploy reports into the studio's progress feed, which the build card follows by itself.
 *
 * Every tool works in ONE studio folder: one the person named, else the one in use, else the only one there is. The
 * file tools never leave it (lib/files.mjs).
 *
 * AN AI IN A SEAT (0.17.0, lib/agent-seat.mjs): agent_sit, agent_look, agent_do and agent_stand put the person's own
 * AI in a game's guide seat, marked " · AI". This process holds the socket between turns; the game's own bot code
 * moves the body while the AI thinks; the AI chooses only the game's own goals and lines (agents.json).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { renderCodex, newCodex } from './codex.mjs';
import { demoGames, formatDemo } from './demo.mjs';
import { formatStatus, setupStatus } from './doctor.mjs';
import { editStudioFile, listFiles, readStudioFile, searchStudio, writeStudioFile } from './files.mjs';
import { cliJob, findNode, getJob, installJob, installed, jobView, runningJobs, startJob, toolEnv, waitJob, which } from './jobs.mjs';
import { Feed, currentId, publicFeed, readFeed, startProgress } from './progress.mjs';
import { newStudio, slugify } from './scaffold.mjs';
import { repoFromUrl, studioRepo } from './repo.mjs';
import { GAME_ID, PACKAGE_ROOT, findStudio, isRulesGame, listExperiences as listGames, readLocal, readStudio, siteUrl } from './studio.mjs';
import { runningDev } from './dev.mjs';
import { deployWords } from './deploy-state.mjs';
import { partsForListing, publishBefore, publishesSoFar } from './directory.mjs';
import { STUDIO_VERSION } from './version.mjs';
import { compareVersions, whatsNew, whatsNewLines } from './changelog.mjs';
import { pinnedVersion } from './upgrade.mjs';
import { AgentSeat } from './agent-seat.mjs';
import { detectLocalAi } from './local-ai.mjs';
import { LAB_PORT, runningLab } from './lab.mjs';
import { pictureFor } from './pictures.mjs';
import { ART_UI, artToolDefs } from './art-tools.mjs';
// GAME PARTS (parts/PARTS.md): parts_find, part_add, part_new and part_share are lib/parts-tools.mjs.
import { PARTS_FIRST, partsToolDefs } from './parts-tools.mjs';
import { standaloneToolDefs } from './standalone-tools.mjs';
import { partsPlanLines } from './parts-build.mjs';
import { FEEDBACK_APPS, FEEDBACK_KINDS, FEEDBACK_LIMITS, appOf, cleanNote, draftId, noteBlock, sendNote, withLine } from './feedback.mjs';

export const UI = Object.freeze({
  setup: 'ui://homie-studio/setup',
  build: 'ui://homie-studio/build',
  studio: 'ui://homie-studio/studio',
  codex: 'ui://homie-studio/codex',
  lab: 'ui://homie-studio/lab',
  feedback: 'ui://homie-studio/feedback',
  ...ART_UI,
});

/** Homie's own updates by email (0.29.0): the sign-up page on homie.rocks, double opt-in, for the first-run card. */
export const HOMIE_UPDATES = 'https://homie.rocks/updates/?from=plugin';
const inside = (base, p) => p === base || p.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** In Homie for Claude Desktop: the extension's manifest starts the server with HOMIE_STUDIO_EXTENSION=1 (desktop/manifest.json). */
export const inDesktopApp = (env = process.env) => env.HOMIE_STUDIO_EXTENSION === '1';

/*
 * A FIRST RUN IN THE CLAUDE DESKTOP APP (0.30.1). The app asks the person before every tool call of an extension:
 * about fifty requests in one filmed first build, each a click, and nothing told the person that "Always allow"
 * exists. Twice the app raised a request it did not draw (it came straight after a card, with no text between):
 * the chat showed a spinner until the request timed out four minutes later, while the request's own key still
 * answered it. That is the app's to fix; Homie's part is that the person is told, once, by the model, in its first
 * reply. Only the desktop extension says this (inDesktopApp): in Claude Code, Codex, Grok or any other MCP client
 * it would not be true.
 */
export const DESKTOP_APPROVALS = 'This is the Claude desktop app: it asks the person before each Homie Studio tool call. ONCE in a chat, in your first words to the person (skip it if you already said it in this chat), tell them in two short sentences of your own: (1) Claude will ask before it uses each Homie Studio tool, and choosing "Always allow" lets the build run without a click at every step; (2) if a step ever sits on a spinner for more than a few seconds with nothing to click, a request is waiting out of sight: Cmd+Return on a Mac (Ctrl+Enter on Windows) allows it once, and scrolling the chat can bring it into view (a request shows its keys beside its buttons). Do not repeat it later. And after a tool that shows a card (setup_status, studio_scaffold, game_codex, build_open, check, playtest, studio_deploy, …), write one short line of text before your next tool call: a request that came straight after a card, with no text between, is the one the app has failed to draw.';

/** A folder as the Claude desktop app's settings give it: `${HOME}/Studios` arrives as written, so expand it here. */
export function expandHome(value, home = homedir()) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const map = { HOME: home, DOCUMENTS: join(home, 'Documents'), DESKTOP: join(home, 'Desktop'), DOWNLOADS: join(home, 'Downloads') };
  return resolve(v.replace(/^~(?=$|[\\/])/, home).replace(/\$\{(HOME|DOCUMENTS|DESKTOP|DOWNLOADS)\}|\$HOME\b/g, (m, k) => map[k ?? 'HOME']));
}

/* ------------------------------------------------------------------ which studio */

export class StudioContext {
  constructor({ studiosDir = null, cwd = process.cwd(), skillsDir = null, waitMs = 40_000, directory = null, install = true, desktop = inDesktopApp() } = {}) {
    this.install = install;
    // Homie for Claude Desktop (the .mcpb): the one host these tools know asks the person before every call.
    this.desktop = desktop === true;
    this.studiosDir = studiosDir ? expandHome(studiosDir) : null;
    this.cwdStudio = findStudio(cwd);
    this.current = this.cwdStudio;
    this.skillsDir = skillsDir && existsSync(skillsDir) ? skillsDir : null;
    this.waitMs = waitMs;
    this.directory = directory;
    this.notes = new Map();
    this.runs = new Map();
    this.status = null;
    // Tell Homie: this session's drafts (what the person was shown), and whether an offered note was answered.
    this.feedback = { drafts: new Map(), sent: 0, offers: 0, offeredDone: false, declined: false };
    // The MCP client (initialize's clientInfo), which a note names as an app and nothing more.
    this.client = null;
  }

  note(root) { if (!this.notes.has(root)) this.notes.set(root, {}); return this.notes.get(root); }

  /** The studios in the studios folder (each a folder with studio.json). */
  studios() {
    if (!this.studiosDir || !existsSync(this.studiosDir)) return this.cwdStudio ? [this.describe(this.cwdStudio)] : [];
    const out = [];
    for (const e of readdirSync(this.studiosDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const root = join(this.studiosDir, e.name);
      if (existsSync(join(root, 'studio.json'))) out.push(this.describe(root));
    }
    if (this.cwdStudio && !out.some((s) => s.root === this.cwdStudio)) out.unshift(this.describe(this.cwdStudio));
    return out.sort((a, b) => a.folder.localeCompare(b.folder));
  }

  describe(root) {
    let studio = {};
    try { studio = readStudio(root); } catch { studio = {}; }
    let games = [];
    try { games = listGames(root).map((g) => g.id); } catch { games = []; }
    return { folder: basename(root), root, name: String(studio.name ?? basename(root)).slice(0, 60), games, installed: installed(root) };
  }

  allowed(p) {
    const real = realOr(p);
    return Boolean((this.studiosDir && inside(realOr(this.studiosDir), real)) || (this.cwdStudio && inside(realOr(this.cwdStudio), real)));
  }

  /** Where `a` (a folder name, a studio's name, or a path inside the studios folder) would be a studio, or null. */
  pathOf(a, list = this.studios()) {
    const byName = list.find((s) => s.folder === a || s.name.toLowerCase() === a.toLowerCase() || slugify(s.name) === slugify(a));
    return byName?.root ?? (isAbsolute(expandHome(a) ?? '') && (a.includes('/') || a.includes('\\') || a.startsWith('~')) ? expandHome(a) : this.studiosDir ? join(this.studiosDir, a) : null);
  }

  /** Whether `arg` names a studio that exists (as root() would find it). */
  knows(arg) {
    const path = this.pathOf(String(arg ?? '').trim());
    return Boolean(path && existsSync(join(path, 'studio.json')));
  }

  /** The studio a tool works in: `arg` (a folder name, a studio's name, or a path inside the studios folder). */
  root(arg, { need = true } = {}) {
    if (arg !== undefined && arg !== null && String(arg).trim()) {
      const a = String(arg).trim();
      const list = this.studios();
      const path = this.pathOf(a, list);
      if (!path || !existsSync(join(path, 'studio.json'))) throw new Error(`no studio "${a}"${list.length ? ` (studios here: ${list.map((s) => s.folder).join(', ')})` : ''}`);
      if (!this.allowed(path)) throw new Error(`${path} is outside the studios folder (${this.studiosDir ?? 'none is set'}); these tools only work in it`);
      this.current = realOr(path);
      return this.current;
    }
    if (this.current && existsSync(join(this.current, 'studio.json'))) return this.current;
    const list = this.studios();
    if (list.length === 1) { this.current = list[0].root; return this.current; }
    if (!need) return null;
    throw new Error(list.length ? `which studio? Pass studio: one of ${list.map((s) => `"${s.folder}"`).join(', ')}` : 'there is no studio yet: studio_scaffold makes one');
  }
}

/* ------------------------------------------------------------------ results */

const ok = (text, structured, extra = {}) => ({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}), ...extra });
const fail = (text, structured) => ({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}), isError: true });

/** Run the pinned CLI and wait a while; { ended, job, result }. */
async function cli(ctx, root, label, args, { wait = ctx.waitMs, onEnd = null, cli: bin = null } = {}) {
  const job = cliJob(root, label, args, { onEnd, ...(bin ? { cli: bin } : {}) });
  const ended = await waitJob(job, wait);
  return { ended, job, result: job.result };
}

function stillRunning(job, what) {
  return ok(`${what} is still running (job ${job.id}, ${jobView(job).seconds} s so far). studio_job { "job": "${job.id}" } says when it is done; tell the person what is happening meanwhile.`, { kind: 'job', ...jobView(job) });
}

/** A command's own words when it failed (homie-studio prints `why`). */
function whyOf(job) {
  const r = job.result;
  if (r && r.why) return r.why;
  return jobView(job, { lines: 6 }).tail.join('\n') || `exited with ${job.code}`;
}

/** The studio's npm install, when it has not been done: started once, and the tool says so. */
function needsInstall(ctx, root) {
  if (installed(root) || !ctx.install) return null;
  const running = runningJobs(root).find((j) => j.label.startsWith('npm install'));
  const job = running ?? installJob(root);
  return ok(`The studio's toolkit is still being installed (npm install, job ${job.id}; usually 20 to 60 s). Ask again in a moment, or follow it with studio_job { "job": "${job.id}" }.`, { kind: 'job', ...jobView(job) });
}

/* ------------------------------------------------------------------ the setup card */

async function statusOf(ctx, root, { fresh = false } = {}) {
  const key = root ?? '';
  if (!fresh && ctx.status && ctx.status.key === key && Date.now() - ctx.status.at < 20_000) return ctx.status.value;
  const node = findNode({ fresh });
  // Claude Code's own status line is not this host's: its row stays out (CLAUDECODE says the server runs inside it).
  const env = toolEnv();
  delete env.CLAUDECODE;
  const value = await setupStatus({ cwd: root ?? ctx.studiosDir ?? homedir(), connector: 'yes', node: node?.version ?? '0', env });
  const row = value.rows.find((r) => r.id === 'node');
  if (row) {
    if (!node) { row.detail = 'not found on this computer (22 or newer is needed)'; row.state = 'missing'; }
    else row.detail = `v${node.version}${node.npm ? ', with npm' : ', but no npm next to it'}`;
  }
  const conn = value.rows.find((r) => r.id === 'connector');
  if (conn) { conn.label = 'Homie tools'; conn.detail = `on this computer (the Homie extension, toolkit ${STUDIO_VERSION})${conn.detail.includes('directory answers') ? '; the homie.rocks directory answers' : ''}`; conn.unlocks = 'everything here: the studio, its games, the checks, deploys and the cards'; }
  ctx.status = { key, at: Date.now(), value };
  return value;
}

function checklist(ctx, root) {
  const steps = ['Setup status', 'The studio', 'See a working game', 'One small change', 'Plan your game: its Game Codex', 'Build it, with progress you can watch', 'Playtest it, then put it online'];
  const done = [true, Boolean(root)];
  if (root) {
    const games = listGames(root);
    const note = ctx.note(root);
    const codex = (() => { try { return readdirSync(join(root, 'games'), { withFileTypes: true }).some((d) => d.isDirectory() && existsSync(join(root, 'games', d.name, 'CODEX.md'))); } catch { return false; } })();
    const local = readLocal(root);
    // A build whose checks passed (any feed on disk, so it holds across the app's restarts).
    const checked = note.checked || (() => {
      try { return readdirSync(join(root, '.studio', 'progress')).some((f) => f.endsWith('.json') && readFeed(root, f.slice(0, -5))?.stages?.some((x) => x.id === 'checks' && x.state === 'done')); } catch { return false; }
    })();
    done.push(Boolean(note.demo || games.length || codex), Boolean(note.changed || codex), codex, Boolean(checked), Boolean(local.deployedAt || local.connectedAt));
  }
  // In order: a step counts as done only when every step before it is (an early file edit is not "one small change").
  for (let i = 1; i < done.length; i++) done[i] = done[i] && done[i - 1];
  let now = done.findIndex((d) => !d);
  if (now < 0) now = done.length;
  return steps.map((label, n) => ({ n, label, state: done[n] ? 'done' : n === now ? 'now' : 'todo' }));
}

async function setupCard(ctx, root, { fresh = false, made = null, install = null, wanted = null } = {}) {
  const status = await statusOf(ctx, root, { fresh });
  const studios = ctx.studios().map(({ root: r, ...s }) => s);
  const current = root ? ctx.describe(root) : null;
  const running = root ? runningJobs(root).find((j) => j.label.startsWith('npm install')) : null;
  const job = install ?? running ?? null;
  const steps = checklist(ctx, root);
  const data = {
    kind: 'setup', version: STUDIO_VERSION, studiosDir: ctx.studiosDir,
    // The name of a studio that is not made yet (setup_status asked for it by name): the card is that new studio's.
    wanted: current ? null : wanted,
    current: current ? { folder: current.folder, name: current.name, games: current.games, installed: current.installed, site: siteUrl(root) } : null,
    studios, checklist: steps,
    status: { rows: status.rows.map(({ parts, ...r }) => r), features: status.features, next: status.next, meanwhile: status.meanwhile, blocking: status.blocking },
    install: job ? jobView(job) : null, made,
    // Homie's own updates by email (0.29.0): a link the person opens and signs up at themselves (double opt-in on
    // homie.rocks). The card never asks for an address, and an agent never types one in for the person.
    updates: HOMIE_UPDATES,
  };
  const others = studios.map((s) => s.name);
  const first = (steps.find((s) => s.state === 'now')?.n ?? steps.length) <= 2;
  const text = [
    current ? `Studio: ${current.name} (${root})${current.installed ? '' : job ? ' (installing its toolkit)' : ''}`
      : wanted ? `No studio called "${wanted}" yet${ctx.studiosDir ? ` in ${ctx.studiosDir}` : ''}${others.length ? ` (the studios here: ${others.join(', ')}; this checklist is the new studio's, not theirs)` : ''}: studio_scaffold makes it.`
        : `No studio yet${ctx.studiosDir ? ` in ${ctx.studiosDir}` : ''}.`,
    '',
    `New studio${current ? `: ${current.name}` : wanted ? `: ${wanted}` : ''}`,
    ...steps.map((s) => `  ${s.state === 'done' ? '✓' : s.state === 'now' ? '→' : ' '} ${s.n}. ${s.label}`),
    '',
    formatStatus(status),
    '',
    `Homie updates by email (optional): ${HOMIE_UPDATES} (the person signs up there themselves; never type an address in for them).`,
    'The card on screen shows this; it follows the install by itself.',
    // The first minutes of a new studio in the Claude desktop app: what the person is told once (DESKTOP_APPROVALS).
    ...(ctx.desktop && first ? ['', DESKTOP_APPROVALS] : []),
  ].join('\n');
  return ok(text, data);
}

/* ------------------------------------------------------------------ the studio card */

const COVER_MAX = 80 * 1024;
function coverData(dir) {
  for (const rel of ['hero/wide.jpg', 'cover.jpg', 'cover.webp', 'cover.png', 'public/cover.jpg', 'public/cover.png']) {
    const f = join(dir, rel);
    try {
      if (existsSync(f) && statSync(f).size <= COVER_MAX) {
        const type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(f)];
        return `data:${type};base64,${readFileSync(f).toString('base64')}`;
      }
    } catch { /* none */ }
  }
  return null;
}

/** This studio's dev server when it really runs (lib/dev.mjs: a stale record, or a recycled process id, is not one). */
function devOf(root) {
  try { return runningDev(root); } catch { return null; }
}

function published(root, kind) {
  try {
    const m = JSON.parse(readFileSync(join(root, kind, 'manifest.json'), 'utf8'));
    return (Array.isArray(m.items) ? m.items : []).filter((e) => e && e.publish !== false && e.slug).map((e) => ({ slug: String(e.slug), title: String(e.title ?? e.slug).slice(0, 80) }));
  } catch { return []; }
}

/**
 * When the studio pins an older @homie-rocks/studio than this one: the pin, this version, and what's new between them
 * (this package's own CHANGELOG.md). null when it is on this version, a newer one, or a link to a checkout.
 */
export function behindOf(root) {
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { return null; }
  const pinned = pinnedVersion(pkg?.devDependencies?.['@homie-rocks/studio'] ?? pkg?.dependencies?.['@homie-rocks/studio']);
  if (!pinned || compareVersions(pinned, STUDIO_VERSION) >= 0) return null;
  return { pinned, here: STUDIO_VERSION, whatsNew: whatsNew(pinned, STUDIO_VERSION) };
}

async function studioCard(ctx, root) {
  const studio = readStudio(root);
  const dev = devOf(root);
  const site = siteUrl(root, studio);
  const live = site && /^https:\/\//.test(site) ? site : null;
  const headers = { accept: 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION} (studio card)` };
  // Which games the LIVE site has (a game made since the last deploy is only here): its own /api/games.
  let onLine = new Set();
  if (live) {
    try {
      const res = await fetch(`${live}/api/games`, { headers, signal: AbortSignal.timeout(4000) });
      const body = res.ok ? await res.json() : null;
      onLine = new Set((Array.isArray(body?.games) ? body.games : []).map((g) => String(g?.id ?? '')));
    } catch { onLine = new Set(); }
  }
  let budget = 100 * 1024;
  const games = listGames(root).slice(0, 12).map((g) => {
    const cover = budget > 0 ? coverData(g.dir) : null;
    if (cover) budget -= cover.length;
    const isLive = live && onLine.has(g.id);
    return { id: g.id, name: String(g.name ?? g.id).slice(0, 60), blurb: String(g.blurb ?? '').slice(0, 160), cover, live: Boolean(isLive), play: { dev: dev ? `${dev.url}/${g.id}/play` : null, live: isLive ? `${live}/${g.id}/play` : null }, page: isLive ? `${live}/${g.id}/` : null };
  });
  const posts = (() => { try { return readdirSync(join(root, 'posts')).filter((f) => /\.md$/.test(f) && f !== 'README.md' && !/^[_.]/.test(f)).length; } catch { return 0; } })();
  let rooms = [];
  if (live && games.length) {
    try {
      const res = await fetch(`${live}/api/rooms`, { headers, signal: AbortSignal.timeout(4000) });
      const body = res.ok ? await res.json() : null;
      rooms = (Array.isArray(body?.rooms) ? body.rooms : []).slice(0, 8).map((r) => ({ game: String(r.game ?? '').slice(0, 40), room: String(r.room ?? '').slice(0, 20), players: Number(r.players) || 0 }));
    } catch { rooms = []; }
  }
  const demo = games.length ? null : await demoGames({ timeoutMs: 4000 }).then((d) => ({ name: d.pick.name, play: d.pick.play, studio: d.studio.name })).catch(() => null);
  const data = {
    kind: 'studio', folder: basename(root), root, name: studio.name, tagline: studio.tagline ?? null,
    games, songs: published(root, 'music'), videos: published(root, 'videos'), posts,
    dev: dev ? { url: dev.url } : null, site: live, rooms, demo, installed: installed(root),
  };
  const behind = behindOf(root);
  if (behind) data.behind = { ...behind, whatsNew: behind.whatsNew ? { ...behind.whatsNew, versions: behind.whatsNew.versions.slice(0, 6).map(({ version, summary, upgrade }) => ({ version, summary, upgrade: upgrade.slice(0, 2) })) } : null };
  const text = [
    `${studio.name} (${root})`,
    games.length ? `Games: ${games.map((g) => `${g.name} (${g.id}${live ? (g.live ? ', live' : ', not deployed yet') : ''})`).join(', ')}` : 'No game yet: its home page says "First game coming soon".',
    dev ? `Running here: ${dev.url}/` : 'Not running here (preview_run starts it).',
    live ? `Live: ${live}/` : 'Not online yet (studio_deploy).',
    ...(rooms.length ? [`Live rooms: ${rooms.map((r) => `${r.game} ${r.room} (${r.players})`).join(', ')}`] : []),
    ...(demo ? [`See a working game meanwhile: ${demo.name}, ${demo.play}`] : []),
    ...(behind ? [
      `Toolkit: this studio pins @homie-rocks/studio ${behind.pinned}; this Homie is ${behind.here}. Tell the person what is new (below) and offer the upgrade: studio_run { "args": ["upgrade"] } shows the plan and changes nothing; with their yes, ["upgrade","--apply"], then studio_install.`,
      ...whatsNewLines(behind.whatsNew, { maxVersions: 6, maxNotes: 6 }),
    ] : []),
  ].join('\n');
  return ok(text, data);
}

/* ------------------------------------------------------------------ builds: the feed the card follows */

function feedFor(root, build) {
  const id = String(build ?? '').trim();
  if (!id || id === 'current') { const c = currentId(root); return c ? { id: c, doc: readFeed(root, c) } : null; }
  const doc = readFeed(root, id);
  if (doc) return { id, doc };
  // A shared build's id (hb_…) names the same feed.
  try {
    for (const f of readdirSync(join(root, '.studio', 'progress'))) {
      if (!f.endsWith('.json')) continue;
      const d = readFeed(root, f.slice(0, -5));
      if (d?.shared?.build === id) return { id: f.slice(0, -5), doc: d };
    }
  } catch { /* none */ }
  return null;
}

/** A feed for a check, a playtest or a deploy, unless the build the person is watching is open already. */
async function feedForRun(ctx, root, { id, title }) {
  const open = currentId(root);
  if (open && readFeed(root, open)?.state === 'running') return { build: open, auto: false };
  const r = await startProgress(root, { what: 'game', id: id ?? null, title });
  if (!r.ok) throw new Error(r.why);
  new Feed(root, r.build).stage('plan', 'skipped', 'run as it is');
  return { build: r.build, auto: true };
}

function endRun(root, run, state, note) {
  if (!run.auto) return;
  try {
    const feed = new Feed(root, run.build);
    const doc = feed.doc;
    if (!doc || doc.state !== 'running') return;
    feed.change((d) => { for (const s of d.stages) if (s.state === 'pending') s.state = 'skipped'; });
    feed.end(state, note);
  } catch { /* the feed stays as it was */ }
}

function buildCard(ctx, root, found) {
  const feed = publicFeed(found.doc);
  const run = ctx.runs.get(found.id);
  const jobs = (run?.jobs ?? []).map((j) => jobView(j, { lines: 4 }));
  const stage = feed.stages.find((s) => s.id === feed.stage) ?? feed.stages[0];
  const passed = feed.checks.filter((c) => c.state === 'pass').length;
  const failed = feed.checks.filter((c) => c.state === 'fail');
  const text = [
    `${feed.title}: ${feed.state === 'running' ? `running: ${stage?.label ?? ''}` : feed.state}.`,
    feed.checks.length ? `Checks: ${passed} of ${feed.checks.length} passed${failed.length ? `; failing: ${failed.map((c) => `${c.label}${c.note ? ` (${c.note})` : ''}`).join('; ')}` : ''}.` : null,
    feed.preview?.url ? `Play it: ${feed.preview.url}` : null,
    feed.error ? `Last error: ${feed.error}` : null,
    ...(run?.look ? [`Pictures of the site (file_read shows one): ${run.look.join(', ')}`] : []),
    ...jobs.filter((j) => j.state === 'failed').map((j) => `${j.label} failed: ${j.result?.why ?? j.tail.slice(-2).join(' ')}`),
    // A deploy that went through: which games it changed with each one's content hash, and anything it had to say
    // about the studio's domain or the directory (lib/cloudflare.mjs).
    ...jobs.filter((j) => j.result?.command === 'deploy' && j.result?.ok && (j.result.games ?? []).some((g) => g.hash)).map((j) => `Deployed: ${j.result.games.map((g) => `${g.id} ${deployWords(g)}`).join('; ')}.`),
    ...jobs.filter((j) => j.result?.command === 'deploy').flatMap((j) => (j.result.notes ?? []).map((n) => `Note: ${n}`)),
    feed.state === 'running' ? 'The card on screen follows it live; you need not call this again to watch it.' : null,
  ].filter(Boolean).join('\n');
  // A check, playtest or deploy inside a build the person opened (build_open) ends before the build does: say so.
  const runView = run ? { kind: run.kind, title: run.title, state: run.state, why: run.why ?? null } : null;
  const runLine = run && !run.auto && run.state !== 'running' ? `${run.title}: ${run.state}${run.why ? ` (${run.why})` : ''}; the build itself stays open until you end it (studio_run ["progress","end","passed"]).` : null;
  return ok(runLine ? `${runLine}\n${text}` : text, { kind: 'build', build: found.id, feed, jobs, run: runView, now: new Date().toISOString() });
}

/** Start a check / playtest / deploy: its feed first, then the work, and the card at once. */
async function startRun(ctx, root, { kind, game, title, steps }) {
  const run = { kind, title, state: 'running', ...(await feedForRun(ctx, root, { id: game ?? null, title })), jobs: [] };
  ctx.runs.set(run.build, run);
  const next = (i) => {
    if (i >= steps.length) { run.state = 'passed'; endRun(root, run, 'passed', `${title}: done.`); if (kind !== 'deploy') ctx.note(root).checked = true; return; }
    const step = steps[i];
    const job = cliJob(root, step.label, step.args, {
      onEnd: (j) => {
        step.after?.(j, run);
        if (j.code !== 0 && !step.soft) { run.state = 'failed'; run.why = `${step.label}: ${whyOf(j)}`; endRun(root, run, 'failed', run.why); return; }
        next(i + 1);
      },
    });
    run.jobs.push(job);
  };
  next(0);
  await new Promise((r) => setTimeout(r, 1500));
  return buildCard(ctx, root, feedFor(root, run.build));
}

async function devUrl(ctx, root, port) {
  const dev = devOf(root);
  if (dev) return dev.url;
  const r = await startDev(ctx, root, port);
  if (r.error) throw new Error(r.error);
  return r.url;
}

async function freePort(start = 8787) {
  for (let p = start; p < start + 20; p++) {
    try { await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(800) }); } catch (error) {
      if (/ECONNREFUSED|fetch failed/i.test(String(error?.cause?.code ?? error?.cause?.message ?? error?.message))) return p;
    }
  }
  return start;
}

async function startDev(ctx, root, port) {
  const at = Number(port) || await freePort();
  const job = cliJob(root, `the studio's site, here (port ${at})`, ['dev', '--port', String(at)]);
  const until = Date.now() + Math.min(ctx.waitMs, 45_000);
  while (Date.now() < until) {
    if (job.endedAt) return { error: `the dev site stopped: ${whyOf(job)}` };
    try { if ((await fetch(`http://127.0.0.1:${at}/api/games`, { signal: AbortSignal.timeout(1500) })).ok) return { url: `http://127.0.0.1:${at}`, job }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return { url: `http://127.0.0.1:${at}`, job, slow: true };
}

/* ------------------------------------------------------------------ an earlier attempt, folded in */

/** Where a person keeps projects, looked at two levels deep for an earlier folder of a studio's name. */
const PROJECT_ROOTS = ['dev', 'Developer', 'code', 'Code', 'src', 'projects', 'Projects', 'repos', 'git', 'work', 'Documents', 'Desktop'];
const TEXT_NOTES = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.html', '.css', '.js', '.mjs', '.ts', '.tsx']);
const SKIP = new Set(['node_modules', '.git', 'Library', 'dist', '.studio', '.wrangler']);

/** Folders named like the studio that are not studios: [{ path, files }] (at most 3). */
export function earlierFolders(ctx, names, own, home = homedir()) {
  const want = new Set(names.filter(Boolean).map((n) => String(n).toLowerCase()));
  const roots = [ctx.studiosDir, home, ...PROJECT_ROOTS.map((r) => join(home, r))].filter((r) => r && existsSync(r));
  const found = new Map();
  const look = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.size >= 3) return;
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (want.has(e.name.toLowerCase()) && realOr(p) !== realOr(own) && !existsSync(join(p, 'studio.json'))) {
        let files = [];
        try { files = readdirSync(p).filter((f) => !f.startsWith('.')).slice(0, 12); } catch { files = []; }
        found.set(realOr(p), { path: realOr(p), files });
      } else if (depth > 1 && entries.length < 400) look(p, depth - 1);
    }
  };
  for (const r of [...new Set(roots.map(realOr))]) look(r, r === realOr(home) ? 1 : 2);
  return [...found.values()];
}

/** studio_fold: the earlier folder's notes into notes/earlier/, or (remove) the folder into the Trash. */
async function foldEarlier(ctx, root, a) {
  const from = realOr(expandHome(a.from) ?? '');
  const known = ctx.note(root).earlier ?? earlierFolders(ctx, [readStudio(root).name, readStudio(root).slug, basename(root)], root).map((e) => e.path);
  if (!known.includes(from)) return fail(`${a.from} is not an earlier folder found for this studio (${known.join(', ') || 'none was found'}); nothing was touched`);
  if (!existsSync(from)) return fail(`${from} is not there any more`);
  if (a.remove === true) {
    const trash = join(homedir(), '.Trash');
    if (process.platform !== 'darwin' || !existsSync(trash)) return fail(`Moving a folder to the Trash works on a Mac only: the person can remove ${from} themselves.`);
    const to = join(trash, `${basename(from)} ${new Date().toISOString().slice(0, 19).replace(/:/g, '.')}`);
    try { renameSync(from, to); } catch (error) { return fail(`${from} could not be moved to the Trash (${error.code ?? error.message}): the person can remove it themselves`); }
    ctx.note(root).earlier = known.filter((p) => p !== from);
    return ok(`Moved ${from} to the Trash (as "${basename(to)}"); the person can put it back from there.`);
  }
  const dest = join(root, 'notes', 'earlier', basename(from));
  const copied = [];
  let total = 0;
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (copied.length >= 60 || total > 2 * 1024 * 1024) return;
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(p, r); continue; }
      if (!e.isFile() || !TEXT_NOTES.has(extname(e.name).toLowerCase())) continue;
      const size = statSync(p).size;
      if (size > 200 * 1024) continue;
      mkdirSync(dirname(join(dest, r)), { recursive: true });
      copyFileSync(p, join(dest, r));
      copied.push(r); total += size;
    }
  };
  walk(from, '');
  let shown = '';
  for (const r of copied.filter((f) => /\.(md|markdown|txt)$/i.test(f))) {
    if (shown.length > 30_000) break;
    shown += `\n--- ${r}\n${readFileSync(join(dest, r), 'utf8').split('\n').slice(0, 80).join('\n')}\n`;
  }
  ctx.note(root).changed = true;
  return ok(`Copied ${copied.length} note file${copied.length === 1 ? '' : 's'} from ${from} into notes/earlier/${basename(from)}/ (the old folder is unchanged). Fold its premise into the plan with the person (the game's CODEX.md), then ask whether to remove the old folder (studio_fold with remove: true moves it to the Trash).${shown ? `\n${shown}` : ''}`, { kind: 'fold', from, to: `notes/earlier/${basename(from)}`, files: copied });
}

/* ------------------------------------------------------------------ a studio from GitHub */

/** owner/name of a checkout's origin remote, lowercased, or null. */
function originOf(dir) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', timeout: 5000, env: toolEnv() });
  return r.status === 0 ? repoFromUrl(r.stdout)?.toLowerCase() ?? null : null;
}

/** Whether the GitHub CLI is here and signed in: { gh, signedIn }. */
function ghState() {
  const gh = which(process.platform === 'win32' ? 'gh.exe' : 'gh');
  if (!gh) return { gh: null, signedIn: false };
  return { gh, signedIn: spawnSync(gh, ['auth', 'status', '--hostname', 'github.com'], { encoding: 'utf8', timeout: 10_000, env: toolEnv() }).status === 0 };
}

const GITHUB_REFUSED = 'GitHub did not let this computer read that repository. Sign this computer in to GitHub (github_login: a one-time code in the browser), or check the repository\'s name; then ask again. Never paste a token into the chat.';

/** studio_open { repo }: clone a studio from GitHub into the studios folder with this computer's own sign-in. */
async function openFromGitHub(ctx, a) {
  const raw = String(a.repo ?? '').trim();
  const repo = studioRepo(raw) ?? repoFromUrl(raw);
  if (!repo) return fail('repo is the studio\'s GitHub repository: owner/name or its github.com address (never Homie\'s own engine repository)');
  if (!ctx.studiosDir) return fail('no studios folder is set: in Claude, Settings > Extensions > Homie, choose the folder your studios live in');
  mkdirSync(ctx.studiosDir, { recursive: true });
  const base = realOr(ctx.studiosDir);
  const name = basename(String(a.folder ?? '').trim() || repo.split('/')[1]);
  if (!name || name.startsWith('.')) return fail('folder is a plain folder name');
  const dir = join(base, name);
  if (existsSync(dir)) {
    if (existsSync(join(dir, 'studio.json')) && originOf(dir) === repo.toLowerCase()) {
      ctx.current = dir;
      const card = await studioCard(ctx, dir);
      card.content[0].text = `${repo} is here already, in ${dir}.\n${card.content[0].text}`;
      return card;
    }
    return fail(`a folder called ${name} is in the studios folder already: pass folder with another name`);
  }
  const { gh, signedIn } = ghState();
  // Never a prompt in a hidden terminal: git's own credential helper (the keychain, a sign-in window) or gh's sign-in.
  const env = toolEnv({ GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' });
  const job = gh && signedIn
    ? startJob({ root: base, label: `clone ${repo}`, cmd: gh, args: ['repo', 'clone', repo, dir], env })
    : startJob({ root: base, label: `clone ${repo}`, cmd: which(process.platform === 'win32' ? 'git.exe' : 'git') ?? 'git', args: ['clone', `https://github.com/${repo}.git`, dir], env });
  if (!(await waitJob(job, ctx.waitMs))) return stillRunning(job, `Cloning ${repo}`);
  if (job.code !== 0) return fail(`${GITHUB_REFUSED}\n(${jobView(job, { lines: 3 }).tail.join(' ')})`, { kind: 'job', ...jobView(job), needs: 'github' });
  if (!existsSync(join(dir, 'studio.json'))) {
    // The folder is the clone this call just made: it is not a studio, so it goes.
    rmSync(dir, { recursive: true, force: true });
    return fail(`${repo} is not a Homie studio (it has no studio.json): nothing was kept`);
  }
  ctx.current = dir;
  let install = null;
  if (ctx.install) { try { install = installJob(dir); } catch { install = null; } }
  const card = await studioCard(ctx, dir);
  card.content[0].text = `Cloned ${repo} into ${dir}${gh && signedIn ? ' (with the GitHub CLI\'s sign-in)' : ' (with git\'s own credentials)'}.${install ? ` Its toolkit is installing (job ${install.id}).` : ''}\n${card.content[0].text}`;
  return card;
}

/** github_login: GitHub's device sign-in through the GitHub CLI; the person types the one-time code in the browser. */
async function githubLogin(ctx) {
  const { gh, signedIn } = ghState();
  if (!gh) return fail('The GitHub CLI is not on this computer: it is one download from https://cli.github.com (or, on a Mac with Homebrew, brew install gh). Then ask again. No token is ever pasted anywhere.');
  if (signedIn) return ok('This computer is signed in to GitHub already.');
  const job = startJob({ root: ctx.current ?? ctx.studiosDir ?? homedir(), label: 'GitHub sign-in (gh auth login)', cmd: gh, args: ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], env: toolEnv() });
  let code = null;
  const until = Date.now() + 15_000;
  while (!job.endedAt && Date.now() < until && !code) {
    code = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(`${job.out}\n${job.err}`)?.[1] ?? null;
    if (!code) await new Promise((r) => setTimeout(r, 300));
  }
  if (job.endedAt && job.code === 0) return ok('Signed in to GitHub.');
  if (!code) return fail(`GitHub's sign-in did not start: ${jobView(job, { lines: 3 }).tail.join(' ') || 'no answer from the GitHub CLI'}`);
  ctx.status = null;
  return ok(`GitHub's sign-in is waiting for the person: open https://github.com/login/device and enter the code ${code} (job ${job.id}; studio_job says when it is done). The code is GitHub's one-time device code, not a password.`, { kind: 'job', ...jobView(job), deviceCode: code });
}

/* ------------------------------------------------------------------ Tell Homie (lib/feedback.mjs) */

/** The plugin's version, from the skills folder this server was given (the plugin's own manifest beside it). */
function pluginVersion(ctx) {
  if (!ctx.skillsDir) return null;
  for (const f of [join(ctx.skillsDir, '..', '.claude-plugin', 'plugin.json'), join(ctx.skillsDir, '..', 'plugin.json')]) {
    try { const v = JSON.parse(readFileSync(f, 'utf8')).version; if (typeof v === 'string') return v; } catch { /* not here */ }
  }
  return null;
}

/** What this server knows that a note carries: the toolkit's version (the studio's own pin, in a studio), the plugin's, the app, and where notes go. */
function feedbackFacts(ctx, studioArg) {
  let root = null;
  try { root = ctx.root(studioArg, { need: false }); } catch { root = null; }
  let studio = null;
  try { studio = root ? readStudio(root) : null; } catch { studio = null; }
  const pinned = (() => {
    try { const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); return pinnedVersion(pkg?.devDependencies?.['@homie-rocks/studio'] ?? pkg?.dependencies?.['@homie-rocks/studio']); } catch { return null; }
  })();
  const fromStudio = String(studio?.homie?.directory ?? '');
  // Where notes go: the directory this server was started with (--homie, the operator's own word), else the studio's,
  // and a studio.json (which may be a clone of somebody else's) can only name Homie's own directory or this computer.
  const loopback = (u) => u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  const started = (d) => { try { const u = new URL(d); return u.protocol === 'https:' || loopback(u); } catch { return false; } };
  const homies = (d) => { try { const u = new URL(d); return (u.protocol === 'https:' && /(^|\.)homie\.rocks$/.test(u.hostname)) || loopback(u); } catch { return false; } };
  const directory = (ctx.directory && started(ctx.directory) ? ctx.directory : null) ?? (fromStudio && homies(fromStudio) ? fromStudio : null) ?? 'https://homie.rocks';
  return { studioVersion: pinned ?? STUDIO_VERSION, pluginVersion: pluginVersion(ctx), app: appOf(ctx.client), directory: directory.replace(/\/+$/, ''), studio: root ? basename(root) : null };
}

const hostOfUrl = (u) => { try { return new URL(u).host; } catch { return 'homie.rocks'; } };

/**
 * homie_feedback: draft (shows the note exactly as it would go, sends nothing), send (only the note a draft showed,
 * after the person's yes), decline (the person said no: nothing is sent, and no note is offered again this session).
 *
 * A send is tied to its draft by the draft's id alone (a hash of the whole note), never by this process's memory: an
 * app may start a new server between the draft and the yes (a resumed session, a restart), and the remote Homie MCP
 * keeps no session at all. What this process remembers is only a convenience (a send that names just its draft) and
 * the once-a-session rule.
 */
async function feedbackTool(ctx, a) {
  const action = ['draft', 'send', 'decline'].includes(a.action) ? a.action : 'draft';
  const session = ctx.feedback;
  const facts = feedbackFacts(ctx, a.studio);
  const to = hostOfUrl(facts.directory);
  const view = (state, extra = {}) => ({ kind: 'feedback', state, to, ...extra });
  if (action === 'decline') {
    const kept = a.draft ? session.drafts.get(String(a.draft)) : null;
    session.declined = true;
    if (kept?.note.offered || !kept) session.offeredDone = true;
    if (kept) session.drafts.delete(String(a.draft));
    return ok('Not sent: nothing left this computer. Tell the person so in a few words, and do not offer to send a note again in this session.',
      view('declined', { draft: a.draft ?? null, note: kept?.note ?? null, taken: kept?.taken ?? [], with: kept ? withLine(kept.note) : null, next: 'Not sent. Say so in a few words, and do not offer to send a note again in this session.' }));
  }
  // A send of a draft this process showed sends THAT note (its facts are the ones the person saw, whichever studio is
  // in use now); words that come with it must be its own. A draft it does not know is rebuilt from the call's fields.
  const known = a.draft ? session.drafts.get(String(a.draft)) : null;
  const worded = !(a.text === undefined || a.text === null || a.text === '');
  let c;
  if (action === 'send' && known) {
    const said = worded ? cleanNote({ ...known.note, kind: a.kind ?? known.note.kind, text: a.text }) : null;
    if (said && (!said.ok || said.note.text !== known.note.text || said.note.kind !== known.note.kind)) {
      return fail('Not sent: this is not the note the person was shown (its words or kind changed since the draft). Draft it again, show them the new note, and send that one after their yes.', view('changed', { draft: String(a.draft), note: known.note, taken: known.taken, with: withLine(known.note), studio: facts.studio, why: 'changed since the draft' }));
    }
    c = { ok: true, note: known.note, taken: known.taken };
  } else {
    c = cleanNote({ kind: a.kind, text: a.text, step: a.step, email: a.email, offered: a.offered === true, studioVersion: facts.studioVersion, pluginVersion: facts.pluginVersion, app: facts.app });
  }
  if (!c.ok) return fail(`Not sent: ${c.why}.`, view('invalid', { why: c.why }));
  const id = await draftId(c.note);
  const shown = { draft: id, note: c.note, taken: c.taken, with: withLine(c.note), studio: facts.studio };
  if (action === 'draft') {
    if (c.note.offered && (session.declined || session.offeredDone)) {
      return fail(`Not drafted: ${session.declined ? 'the person said no to a note earlier in this session' : 'a note was already offered in this session'}, and Homie offers at most once a session. Do not offer again. If the person asks, in their own words, to tell Homie something, draft it with offered: false.`, view('invalid', { why: 'offered once already this session' }));
    }
    // An offer nobody answered may be reworded a few times (the person asked for a change); it is not asked over and over.
    if (c.note.offered && !session.drafts.has(id)) {
      if (session.offers >= FEEDBACK_LIMITS.offers) return fail('Not drafted: a note was offered several times in this session and the person has not said yes. Do not offer again. If they ask to tell Homie something, draft it with offered: false.', view('invalid', { why: 'offered several times already' }));
      session.offers += 1;
    }
    session.drafts.set(id, { note: c.note, taken: c.taken, at: Date.now() });
    const next = `Nothing has been sent. Show the person this note exactly as it is and ask whether to send it. Only after they say yes in their own words: homie_feedback { "action": "send", "draft": "${id}" } with the same kind and text. If they want it worded differently, draft it again in their words. If they say no: homie_feedback { "action": "decline", "draft": "${id}" }, say nothing was sent, and do not offer again in this session.`;
    return ok([
      'Nothing has been sent. Show the person this note exactly as it is (where a card shows, it has Send, Edit and Don\'t send), and ask whether to send it to Homie:',
      '',
      noteBlock(c.note, c.taken),
      '',
      `Send it only after they say yes in their own words: homie_feedback { "action": "send", "draft": "${id}" } with the same kind and text. If they want it worded differently, draft it again in their words and show the new note. If they say no: homie_feedback { "action": "decline", "draft": "${id}" }, tell them nothing was sent, and do not offer again in this session. It goes privately to the people who make Homie (${to}).`,
    ].join('\n'), view('draft', { ...shown, next }));
  }
  // send
  if (!a.draft) return fail(`Not sent: a send names the draft the person saw (homie_feedback { "action": "draft", … } first, show it, and send its "draft" id after their yes).`, view('invalid', { why: 'no draft' }));
  if (String(a.draft) !== id) return fail('Not sent: this is not the note the person was shown (its words or details changed since the draft). Draft it again, show them the new note, and send that one after their yes.', view('changed', { ...shown, why: 'changed since the draft' }));
  if (session.sent >= FEEDBACK_LIMITS.perSession) return fail(`Not sent: ${FEEDBACK_LIMITS.perSession} notes is the most one session sends.`, view('invalid', { ...shown, why: 'too many this session' }));
  const r = await sendNote(c.note, { directory: facts.directory, source: 'plugin', consent: ['card', 'dialog'].includes(a.by) ? a.by : 'chat' });
  if (!r.ok) return fail(`Not sent: ${r.why}`, view('failed', { ...shown, why: r.why }));
  session.sent += 1;
  session.drafts.delete(id);
  if (c.note.offered) session.offeredDone = true;
  return ok(`Sent to Homie${r.repeat ? ' (it had this exact note already)' : ''}: reference ${r.reference.slice(0, 8)}. Thank the person in one line. The note is private: only the people who make Homie read it. Do not offer another note in this session.`,
    view('sent', { ...shown, reference: r.reference, next: 'Sent. Thank the person in one line, and do not offer another note in this session.' }));
}

/* ------------------------------------------------------------------ guides (the plugin's skills) */

function guideTopics(ctx) {
  if (!ctx.skillsDir) return [];
  try { return readdirSync(ctx.skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ctx.skillsDir, d.name, 'SKILL.md'))).map((d) => d.name).sort(); } catch { return []; }
}

const DESKTOP_NOTE = 'In this app, where a guide says to run `npx --no-install homie-studio <command>`, call the tool of the same job (build, check, preview_run, studio_deploy, …) or studio_run with that command\'s words; where it says to edit a file, use file_read, file_edit and file_write, in few, large calls: read a file once, then make every change it needs in ONE file_edit (its edits list takes many replacements) or one file_write of a new or short file, never a call per change (every call is a step the person waits on, and a turn has only so many); a guide\'s own script (music, sound, art, video) is the tool of that name.';

/* ------------------------------------------------------------------ the tools */

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const STUDIO_ARG = { studio: str('Optional: which studio (its folder name); else the one in use') };
const ui = (uri) => ({ ui: { resourceUri: uri }, 'ui/resourceUri': uri });
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function toolDefs(ctx, avail = {}) {
  const tools = [
    {
      name: 'setup_status', title: 'Setup status',
      description: 'Step 0 of a new studio, and any time the person asks what they need or whether they are set up: what this computer and their accounts have (Node, Cloudflare signed in and email verified, Chrome for the checks, ffmpeg, and the optional GitHub, ElevenLabs and fal), what each unlocks, and the exact fix; the studios in the studios folder; and the new-studio checklist with where they are on it. For a studio that is not made yet, pass its name as studio: the checklist is then the new studio\'s, never another studio\'s that happens to be in the folder. Read-only, a few seconds. Optional rows never block anything.',
      inputSchema: { type: 'object', properties: { studio: str('Optional: which studio (its folder name or name), or the name of a new studio that is not made yet; else the one in use'), fresh: { type: 'boolean', description: 'Check again now instead of the last 20 s' } } },
      annotations: { title: 'Setup status', ...RO }, _meta: ui(UI.setup),
      run: async (a) => {
        // A name with no studio of it yet is the studio about to be made: its own checklist, from step 1.
        const named = String(a.studio ?? '').trim().slice(0, 60);
        if (named && !ctx.knows(named)) return setupCard(ctx, null, { fresh: a.fresh === true, wanted: named });
        return setupCard(ctx, ctx.root(a.studio, { need: false }), { fresh: a.fresh === true });
      },
    },
    {
      name: 'studio_scaffold', title: 'Make a studio',
      description: 'Step 1: make a new game studio ON THIS COMPUTER, in the studios folder: one folder with AGENTS.md, games/, music/, videos/, posts/ and a site that later goes online on the studio\'s own Cloudflare (free plan). It has NO game: its home page says "First game coming soon". Then installs its pinned toolkit (npm install, in the background). Never put a game in it the person did not ask for.',
      inputSchema: { type: 'object', properties: { name: str('The studio\'s name, e.g. "Night Owls"'), folder: str('Optional: the folder name inside the studios folder (default: from the name)') }, required: ['name'] },
      annotations: { title: 'Make a studio', ...RW }, _meta: ui(UI.setup),
      run: async (a) => {
        const name = String(a.name ?? '').trim().slice(0, 60);
        if (!name) return fail('name the studio, e.g. "Night Owls"');
        if (!ctx.studiosDir) return fail('no studios folder is set: in Claude, Settings > Extensions > Homie, choose the folder your studios live in');
        mkdirSync(ctx.studiosDir, { recursive: true });
        const folder = a.folder ? String(a.folder).trim() : slugify(name);
        const base = realOr(ctx.studiosDir);
        const asked = isAbsolute(folder) ? resolve(folder) : join(base, folder);
        // Compared on real paths (a temporary or linked folder may have two names).
        const dir = join(realOr(dirname(asked)), basename(asked));
        if (!inside(base, dir) || dir === base) return fail(`a studio goes in its own folder inside ${ctx.studiosDir}`);
        // An earlier attempt for this name (a folder that is not a studio: notes, a plan, a charter), here or in the
        // usual project folders: the person is offered to fold its premise in (studio_fold), never surprised by it.
        const earlier = earlierFolders(ctx, [name, slugify(name), basename(dir)], dir);
        let at = dir;
        if (existsSync(at) && readdirSync(at).some((f) => !['.DS_Store', '.git'].includes(f)) && !existsSync(join(at, 'studio.json'))) at = `${dir}-studio`;
        let made;
        try { made = newStudio(at, { name, install: false, ...(ctx.directory ? { homie: ctx.directory } : {}) }); } catch (error) { return fail(error.message); }
        ctx.current = made.dir;
        ctx.note(made.dir).earlier = earlier.map((e) => e.path);
        let install = null;
        if (ctx.install) {
          try { install = installJob(made.dir); } catch (error) { return fail(`${name} is made at ${made.dir}, but ${error.message}`); }
          await waitJob(install, Math.min(ctx.waitMs, 35_000));
        }
        const r = await setupCard(ctx, made.dir, { install, made: { dir: made.dir, wrote: made.wrote } });
        const fold = earlier.length ? `\n\nAn earlier folder for this name is on this computer, and it is not a studio: ${earlier.map((e) => `${e.path} (${e.files.join(', ') || 'empty'})`).join('; ')}. ASK the person: fold its premise into ${name}? With their yes, studio_fold { "from": "<that folder>" } copies its notes into the studio (notes/earlier/) and shows them to you, so the plan can use them. Then, only with another yes, studio_fold { "from": "<that folder>", "remove": true } moves the old folder to the Trash.` : '';
        r.content[0].text = `Made ${name} at ${made.dir} (no game yet: its home page says "First game coming soon").\nWrote: ${made.wrote.join(', ')}\n${!install ? '' : install.endedAt ? (install.code === 0 ? 'Its toolkit is installed.' : `npm install failed: ${whyOf(install)}`) : `Its toolkit is installing (job ${install.id}).`}${fold}\n\n${r.content[0].text}`;
        if (r.structuredContent) r.structuredContent.earlier = earlier;
        return r;
      },
    },
    {
      name: 'studio_fold', title: 'Fold an earlier folder into the studio',
      description: 'An earlier folder for this studio\'s name that is not a studio (one studio_scaffold found and named): copy its notes into the studio (notes/earlier/<folder>/, text files only) and read them, so its premise goes into the plan; or, with remove: true, move the old folder to the Trash. Only with the person\'s yes for each; it never touches any other folder.',
      inputSchema: { type: 'object', properties: { from: str('The earlier folder studio_scaffold named'), remove: { type: 'boolean', description: 'Move the earlier folder to the Trash (only with the person\'s yes)' }, ...STUDIO_ARG }, required: ['from'] },
      annotations: { title: 'Fold an earlier folder in', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      run: async (a) => foldEarlier(ctx, ctx.root(a.studio), a),
    },
    {
      name: 'studio_install', title: 'Install the studio\'s dependencies',
      description: 'npm install in the studio: its pinned toolkit and Wrangler, and anything its package.json gained (after an upgrade, a new pin, or a library a game needs). Runs in the background; studio_job follows it.',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG } },
      annotations: { title: 'Install dependencies', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const running = runningJobs(root).find((j) => j.label.startsWith('npm install'));
        if (running) return stillRunning(running, 'npm install');
        let job;
        try { job = installJob(root); } catch (error) { return fail(error.message); }
        if (!(await waitJob(job, ctx.waitMs))) return stillRunning(job, 'npm install');
        ctx.status = null;
        return job.code === 0 ? ok(`Installed (${jobView(job).seconds} s).`, { kind: 'job', ...jobView(job) }) : fail(`npm install failed: ${whyOf(job)}`, { kind: 'job', ...jobView(job) });
      },
    },
    {
      name: 'studio_open', title: 'Open a studio',
      description: 'Work in a studio on this computer: one in the studios folder (by its folder name or name), or, with repo, a studio that lives on GitHub (one the Claude app set up with Deploy to Cloudflare, say), cloned into the studios folder with this computer\'s own GitHub sign-in (the GitHub CLI, or git\'s own credentials). Never ask for a token: when GitHub refuses, github_login signs this computer in. Later tools use the studio until another is opened. Shows the studio card.',
      inputSchema: { type: 'object', properties: { studio: str('The studio\'s folder name or name, in the studios folder'), repo: str('Or: its GitHub repository, owner/name or its github.com address'), folder: str('Optional, with repo: the folder name in the studios folder (default: the repository\'s name)') } },
      annotations: { title: 'Open a studio', readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: ui(UI.studio),
      run: async (a) => (a.repo ? openFromGitHub(ctx, a) : studioCard(ctx, ctx.root(a.studio))),
    },
    {
      name: 'github_login', title: 'Sign in to GitHub',
      description: 'Sign this computer in to GitHub with GitHub\'s own device sign-in (the GitHub CLI): it gives a one-time code to type at github.com/login/device, in the person\'s browser. For opening a studio from GitHub and publishing changes by pull request. Never ask for, or accept, a token in the chat.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Sign in to GitHub', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async () => githubLogin(ctx),
    },
    {
      name: 'studio_card', title: 'Show a studio',
      description: 'A card for the studio: its games with Play (here, and live), songs, videos and posts, whether its site runs on this computer and online, its live rooms, and a live game to try while it has none.',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG } },
      annotations: { title: 'Show a studio', ...RO, openWorldHint: true }, _meta: ui(UI.studio),
      run: async (a) => studioCard(ctx, ctx.root(a.studio)),
    },
    {
      name: 'game_demo', title: 'See a working game',
      description: 'Step 2: a live multiplayer game on Homie Arcade to play right now, made with this same toolkit, with NOTHING copied into the studio. Give the person the Play link: THEY open it (the link in your reply, or Play on a card); never open a browser or run a command to open it yourself. Two browser tabs (or a phone and a computer) are two players in the same room; bots fill the empty seats. Copy a starter into the studio (game_make) only if they ask.',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG } },
      annotations: { title: 'See a working game', ...RO, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio, { need: false });
        const r = await demoGames();
        if (root) ctx.note(root).demo = true;
        return ok(`${formatDemo(r)}\n\nFor you, the AI: give the person this Play link in your reply; they open it themselves. Do not open a browser or run any command to open it.`, { kind: 'demo', ...r });
      },
    },
    {
      name: 'app_make', title: 'Make an app',
      description: 'Make one morphing screen with customer, staff and wall roles, lasting records and a shared 3D scene. Uses the same engines, netplay, parts and standalone builds as games. No rounds required.',
      inputSchema: { type: 'object', properties: { id: str('App id: lowercase, digits, hyphens'), name: str('Display name'), ...STUDIO_ARG }, required: ['id', 'name'] },
      annotations: { title: 'Make an app', ...RW },
      run: async (a) => {
        if (!GAME_ID.test(String(a.id ?? ''))) return fail('invalid app id');
        const root = ctx.root(a.studio);
        const r = await cli(ctx, root, `app new ${a.id}`, ['app', 'new', a.id, '--name', String(a.name ?? a.id).slice(0, 60)]);
        if (!r.ended) return stillRunning(r.job, 'Making the app');
        if (r.job.code !== 0) return fail(`Not made: ${whyOf(r.job)}`);
        let install = '';
        if (r.result?.installNeeded) {
          if (ctx.install) { const job = runningJobs(root).find((j) => j.label.startsWith('npm install')) ?? installJob(root); install = ` Dependencies are installing (job ${job.id}); wait for studio_job.`; }
          else install = ' Run studio_install for its engine dependencies.';
        }
        return ok(`apps/${a.id} is ready.${install} Build, dev --lan, then check. Follow the app skill: one screen, roles and parts.`, { kind: 'app', ...r.result });
      },
    },
    {
      name: 'game_make', title: 'Make a multiplayer game',
      description: 'Make a game in the studio from a multiplayer starter, under the id you choose, to change into the person\'s game: gem-rush (an arena: every browser renders, one hosts the rules, bots fill empty seats, rounds restart), gem-rush-3d (the same arena in three.js, dressed with free CC0 models through @homie-rocks/studio/assets: the start for a 3D game), hero-rush-3d (the arena with animated CC0 heroes that run, jump and swing through @homie-rocks/studio/animate, a shared clip library per skeleton, a jump and a swing tuned in the Game Lab: the start for a 3D game with characters) or ember-vale (a hero who lasts for days, with cloud saves: for persistent games). In a new studio only once their game is planned (game_plan), or when they ask for a copy of a working starter; never as a first step. A planned game\'s codex stays. Before writing one of its systems from scratch, look for a piece of an existing game that does it (parts_find; part_add brings it in), and for the general mechanism in the @homie-rocks/* packages.',
      inputSchema: { type: 'object', properties: { id: str('The game\'s id (lowercase, digits, hyphens): its address'), name: str('The game\'s display name'), from: str('Starter id (default gem-rush)'), ...STUDIO_ARG }, required: ['id', 'name'] },
      annotations: { title: 'Make a game', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        if (!GAME_ID.test(String(a.id ?? ''))) return fail('the id is lowercase letters, digits and hyphens, up to 40');
        const r = await cli(ctx, root, `game new ${a.id}`, ['game', 'new', a.id, '--from', String(a.from ?? 'gem-rush'), '--name', String(a.name ?? a.id).slice(0, 60)]);
        if (!r.ended) return stillRunning(r.job, 'Making the game');
        if (r.job.code !== 0) return fail(`Not made: ${whyOf(r.job)}`);
        // A starter that needs a library the studio did not have (game.json "needs", e.g. three.js): it is in the
        // studio's package.json now, and nothing builds until it is installed, so the install starts here.
        let install = '';
        if (r.result?.installNeeded) {
          const libs = (r.result.needsAdded ?? []).map((n) => `${n.name} ${n.version}`).join(', ');
          if (ctx.install) {
            const running = runningJobs(root).find((j) => j.label.startsWith('npm install'));
            let job = running ?? null;
            if (!job) { try { job = installJob(root); } catch (error) { install = ` It needs ${libs}, added to the studio's package.json, but the install did not start (${error.message}): studio_install installs it.`; } }
            if (job) install = ` It needs ${libs}, added to the studio's package.json; npm install is running (job ${job.id}): build once studio_job says it is done.`;
          } else install = ` It needs ${libs}, added to the studio's package.json: studio_install installs it before the first build.`;
        }
        const m = r.result?.models;
        const got = m ? ` Its models: ${m.fetched} from the starter library${m.missing.length ? `; ${m.missing.length} could not be fetched (${m.why ?? m.missing[0].why}), and it draws stand-ins for those` : ''}.` : '';
        return ok(`games/${a.id} is ${a.name}, from the ${a.from ?? 'gem-rush'} starter (${(r.result?.files ?? []).length} files).${got}${install} Change it in games/${a.id}/src/main.ts: file_read it once (a long file in two or three reads), decide every change, and make them in ONE file_edit with an edits list (never a call per change: twenty single edits use up a turn before the game is checked); then build and preview_run; check proves two browsers finish a round.`, { kind: 'game', ...r.result });
      },
    },
    {
      name: 'game_port', title: 'Make an existing game multiplayer',
      description: 'Read an existing single-player web game on this computer and grade how hard making it multiplayer will be (easy, medium, hard, not a fit, with its risks); with id, also bring it into the studio as games/<id>/ for the port. studio_guide { "topic": "port" } has the whole job; check (and studio_run ["port","check",…]) proves it.',
      inputSchema: { type: 'object', properties: { folder: str('The game\'s folder on this computer, as the person named it (e.g. a folder in Downloads)'), id: str('Optional: the id it gets in the studio; with it, the game is brought in'), name: str('Optional: its name'), ...STUDIO_ARG }, required: ['folder'] },
      annotations: { title: 'Port a game', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const folder = expandHome(a.folder);
        const home = realOr(homedir());
        if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) return fail(`no folder ${a.folder}`);
        const real = realOr(folder);
        if (!inside(home, real) || real === home || relative(home, real).split(sep).some((p) => p.startsWith('.'))) return fail('the game to port is a folder of its own inside the home folder (not the home folder, not a hidden folder)');
        const plan = await cli(ctx, root, 'port plan', ['port', 'plan', real]);
        if (!plan.ended) return stillRunning(plan.job, 'Reading the game');
        if (plan.job.code !== 0) return fail(`Could not read it: ${whyOf(plan.job)}`);
        const p = plan.result;
        const lines = [`Port plan for ${basename(real)}: ${String(p.grade ?? '?').toUpperCase()}`, ...(p.reasons ?? []).map((x) => `  - ${x}`), 'Risks:', ...((p.risks ?? []).length ? p.risks.map((x) => `  - ${x}`) : ['  - none found by reading'])];
        if (!a.id) return ok(`${lines.join('\n')}\n\nWith an id, game_port brings it into the studio.`, { kind: 'port', plan: p });
        if (!GAME_ID.test(String(a.id))) return fail('the id is lowercase letters, digits and hyphens');
        const imp = await cli(ctx, root, `port import ${a.id}`, ['port', 'import', real, '--id', a.id, ...(a.name ? ['--name', String(a.name).slice(0, 60)] : [])]);
        if (!imp.ended) return stillRunning(imp.job, 'Bringing the game in');
        if (imp.job.code !== 0) return fail(`${lines.join('\n')}\n\nNot brought in: ${whyOf(imp.job)}`);
        return ok(`${lines.join('\n')}\n\ngames/${a.id} is the port (${imp.result?.files ?? '?'} files).\nNext:\n${(imp.result?.next ?? []).map((n) => `  - ${n}`).join('\n')}`, { kind: 'port', plan: p, import: imp.result });
      },
    },
    {
      name: 'game_plan', title: 'Plan a game (its Game Codex)',
      description: 'Step 4: start the game\'s Game Codex (games/<id>/CODEX.md, every section) and get the plan interview to run with the person: two or three questions a message, each with options and your pick, about game type and genre, style, devices, players and rooms, art and film, music and sound, and scope. A game is planned before it is made: with no game <id> yet, this starts its folder with only the codex. Fill CODEX.md from their answers in one call (file_write of the whole file, or one file_edit with an edits list), then game_codex shows it. While planning, run `parts find` (the parts_find tool) for each system the game needs, so the plan starts from pieces of existing games and the @homie-rocks/* packages rather than from nothing; the codex\'s Built from section records what was found.',
      inputSchema: { type: 'object', properties: { id: str('The game\'s id (lowercase, digits, hyphens)'), name: str('Its name, when the game is not made yet'), ...STUDIO_ARG }, required: ['id'] },
      annotations: { title: 'Plan a game', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const file = join(root, 'games', String(a.id), 'CODEX.md');
        let made = null;
        if (!existsSync(file)) {
          made = newCodex(root, String(a.id), { name: a.name ?? null });
          if (!made.ok) return fail(made.why);
        }
        const guide = ctx.skillsDir && existsSync(join(ctx.skillsDir, 'plan', 'references', 'INTERVIEW.md')) ? readFileSync(join(ctx.skillsDir, 'plan', 'references', 'INTERVIEW.md'), 'utf8') : null;
        return ok([
          made ? `Wrote games/${a.id}/CODEX.md (every section${made.planned ? '; the game is planned here before it is made' : ''}).` : `games/${a.id}/CODEX.md is there already: change it, never replace it.`,
          'Now the interview: two or three questions a message, each with concrete options and your pick, so "yes" is an answer. Say back what you heard in one line before the next. Stop after three or four rounds; "just build it" means fill the rest with your own choices and list them under Open questions. Then fill CODEX.md in one call (file_read it once; then file_write the whole file, or one file_edit whose edits list has every section) and show it with game_codex.',
          '', PARTS_FIRST,
          ...(guide ? ['', guide] : []),
        ].join('\n'), { kind: 'plan', id: a.id, file: `games/${a.id}/CODEX.md`, created: Boolean(made) });
      },
    },
    {
      name: 'game_codex', title: 'Show a Game Codex',
      description: 'A game\'s Game Codex as a card in the game\'s own look: a tab per section, character cards, the controls table, milestones, decisions, open questions, and the build\'s status. Show it after every change to the plan.',
      inputSchema: { type: 'object', properties: { id: str('The game\'s id'), ...STUDIO_ARG }, required: ['id'] },
      annotations: { title: 'Show a Game Codex', ...RO }, _meta: ui(UI.codex),
      run: async (a) => {
        const root = ctx.root(a.studio);
        let r;
        try { r = renderCodex(root, String(a.id), { mode: 'artifact' }); } catch (error) { return fail(error.message); }
        const html = slimCodex(r.html);
        return ok([
          `The Game Codex for ${r.title}: ${r.sections.map((s) => s.title).join(' · ')}`,
          r.missing.length ? `Not decided yet: ${r.missing.join(', ')}` : 'Every section has something in it.',
          `Open questions: ${r.openQuestions}`,
          ...(html ? [] : ['(The page is too big to show here with its pictures: it is drawn without them.)']),
        ].join('\n'), { kind: 'codex', id: a.id, title: r.title, html: html ?? slimCodex(r.html, { pictures: false }), sections: r.sections, missing: r.missing, openQuestions: r.openQuestions, build: r.build });
      },
    },
    {
      name: 'build', title: 'Build the site',
      description: 'Bundle every game (or one) and the studio\'s site into site/dist. A few seconds. A running preview shows the new build on reload.',
      inputSchema: { type: 'object', properties: { game: str('Optional: only this game'), ...STUDIO_ARG } },
      annotations: { title: 'Build', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const r = await cli(ctx, root, 'build', ['build', ...(a.game ? [String(a.game)] : [])]);
        if (!r.ended) return stillRunning(r.job, 'The build');
        if (r.job.code !== 0) return fail(`The build failed: ${whyOf(r.job)}`);
        const g = r.result?.games ?? [];
        // Each game's build hash, in the words the terminal prints: the hash a deploy reports and the live site answers with.
        return ok(`Built ${g.length ? g.map((x) => `${x.id} (${Math.round(x.bytes / 1024)} KB${x.hash ? `, ${x.changed ?? 'new'}${x.changed && x.changed !== 'new' ? ' since the last build here' : ''}, build ${x.hash}` : ''})`).join(', ') : 'the home page (no game yet)'}.${devOf(root) ? ' Reload the preview to see it.' : ''}`, { kind: 'built', ...r.result });
      },
    },
    {
      name: 'preview_run', title: 'Run the site here',
      description: 'Run the studio\'s whole site on this computer (pages, public rooms, the database) and give the addresses to open: the home page, and each game\'s Play page. Two browser tabs on a game are two players in the same room. It keeps running until preview_stop (or the app quits).',
      inputSchema: { type: 'object', properties: { game: str('Optional: the game to give the Play address of'), port: { type: 'number', description: 'Optional port (default: 8787, or the next free one)' }, ...STUDIO_ARG } },
      annotations: { title: 'Run the site here', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        let url = devOf(root)?.url ?? null;
        let slow = false;
        if (!url) { const r = await startDev(ctx, root, a.port); if (r.error) return fail(r.error); url = r.url; slow = Boolean(r.slow); }
        const games = listGames(root);
        const g = a.game ? games.find((x) => x.id === a.game) : games[0];
        return ok([
          `${slow ? 'Starting' : 'Running'} here: ${url}/${games.length ? '' : ' (the home page: "First game coming soon")'}`,
          ...games.map((x) => `  ${x.name ?? x.id}: ${url}/${x.id}/play`),
          g ? `The person opens ${url}/${g.id}/play in two browser tabs: two players, one room. Give them the address; do not open a browser for them.` : 'Give the person the address; do not open a browser for them.',
        ].filter(Boolean).join('\n'), { kind: 'preview', url, games: games.map((x) => ({ id: x.id, play: `${url}/${x.id}/play` })) });
      },
    },
    {
      name: 'preview_stop', title: 'Stop the site here',
      description: 'Stop this studio\'s site on this computer (exactly its own, nothing else).',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG } },
      annotations: { title: 'Stop the site here', ...RW },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const r = await cli(ctx, root, 'dev --stop', ['dev', '--stop'], { wait: 20_000 });
        // What a server stopped another way left behind is cleaned up and said (lib/dev.mjs).
        const note = r.result?.why && (r.result?.stale || r.result?.stopped?.length) ? ` ${r.result.why[0].toUpperCase()}${r.result.why.slice(1)}.` : '';
        return ok(`${r.result?.stopped?.length ? 'Stopped the studio\'s site here.' : 'It was not running.'}${note}`, { kind: 'preview', stopped: r.result?.stopped ?? [], ...(r.result?.stale ? { stale: true } : {}) });
      },
    },
    {
      name: 'check', title: 'Two-browser check',
      description: 'Prove an app works across a wall and two phones: an action propagates and survives reconnect, with no rounds. For a game: two fresh browsers (a computer and a phone) press Play, land in the same public room and finish a round (about 70 s). Starts the site here first when it is not running. Runs in the background; the build card follows each step going green. Run it before saying a game works.',
      inputSchema: { type: 'object', properties: { game: str('The game\'s id (default: the only game)'), url: str('Optional: the site to check (default: this computer\'s preview); the live site after a deploy'), ...STUDIO_ARG } },
      annotations: { title: 'Two-browser check', ...RW }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const games = listGames(root);
        const game = a.game ?? (games.length === 1 ? games[0].id : null);
        if (!game) return fail(games.length ? `which game? ${games.map((g) => g.id).join(', ')}` : 'there is no game to check yet');
        const url = a.url ? String(a.url) : await devUrl(ctx, root);
        return startRun(ctx, root, { kind: 'check', game, title: `${games.find((g) => g.id === game)?.name ?? game}: ${games.find((g) => g.id === game)?.kind === 'app' ? 'multi-screen' : 'two-browser'} check`, steps: [
          ...(games.some((g) => g.id === game && isRulesGame(g)) ? [{ label: 'rules build check', args: ['build', game] }] : []),
          { label: 'two-browser check', args: ['check', game, '--url', url, '--shots', join('.checks', game)] },
        ] });
      },
    },
    {
      name: 'playtest', title: 'Playtest',
      description: 'Playtest a game: the two-browser check, then pictures of its landing and Play pages on a computer and a phone with what looks wrong. Runs in the background with the build card. When it ends, look at two of the pictures (file_read) and tell the person what is weak, ranked; studio_guide { "topic": "playtest" } has the whole method.',
      inputSchema: { type: 'object', properties: { game: str('The game\'s id (default: the only game)'), url: str('Optional: the site (default: this computer\'s preview)'), ...STUDIO_ARG } },
      annotations: { title: 'Playtest', ...RW }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const games = listGames(root);
        const game = a.game ?? (games.length === 1 ? games[0].id : null);
        if (!game) return fail(games.length ? `which game? ${games.map((g) => g.id).join(', ')}` : 'there is no game to playtest yet');
        const url = a.url ? String(a.url) : await devUrl(ctx, root);
        const shots = join('.checks', `${game}-look`);
        return startRun(ctx, root, { kind: 'playtest', game, title: `${games.find((g) => g.id === game)?.name ?? game}: playtest`, steps: [
          { label: 'two-browser check', args: ['check', game, '--url', url, '--shots', join('.checks', game)] },
          { label: 'pictures on a computer and a phone', soft: true, args: ['look', `/${game}/`, `/${game}/play`, '--url', url, '--only', 'computer,phone', '--shots', shots],
            // The first screen of each page first (a whole page is a tall picture): what a person sees on arrival.
            after: (j, run) => { run.look = (j.result?.rows ?? []).flatMap((r) => [r.fold, r.shot]).filter(Boolean).map((f) => relative(root, resolve(root, f))).slice(0, 8); } },
        ] });
      },
    },
    {
      name: 'game_lab', title: 'Open the Game Lab',
      description: 'The Game Lab for one mechanic of a game (a jump, a hit, a dash): one short take played in New (the working tree) beside Today (the last commit) on one clock, slowed down or a frame at a time, with its phases, graphs and live sliders that write kept values into the game\'s tunables.json. Starts the lab on this computer, plays the take headless once (New against Today: phases, peaks, whether replays match, JavaScript per frame) and answers with a card: a still of both builds at the take\'s busiest moment and Open. The game must call @homie-rocks/studio/lab (the starters do); studio_guide { "topic": "lab" } has the whole method. The person opens the lab from the card or the link; do not open a browser.',
      inputSchema: { type: 'object', properties: { game: str('The game\'s id (default: the only game)'), take: str('Optional: a take in games/<id>/lab.json (default: its default)'), today: str('Optional: the git ref Today is built from (default HEAD)'), ...STUDIO_ARG } },
      annotations: { title: 'Open the Game Lab', ...RW }, _meta: ui(UI.lab),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const games = listGames(root);
        const game = a.game ?? (games.length === 1 ? games[0].id : null);
        if (!game || !games.some((g) => g.id === game)) return fail(games.length ? `which game? ${games.map((g) => g.id).join(', ')}` : 'there is no game yet');
        const ref = a.today ? String(a.today) : 'HEAD';
        let lab = await runningLab(root);
        if (!lab) {
          const port = await freePort(LAB_PORT);
          const job = cliJob(root, `the Game Lab, here (port ${port})`, ['lab', game, '--port', String(port), ...(ref !== 'HEAD' ? ['--today', ref] : [])]);
          const until = Date.now() + 20_000;
          while (!lab && Date.now() < until && !job.endedAt) { await new Promise((r) => setTimeout(r, 400)); lab = await runningLab(root); }
          if (!lab) return fail(`the Game Lab did not start: ${whyOf(job)}`);
        }
        const q = new URLSearchParams({ ...(a.take ? { take: String(a.take) } : {}), ...(ref !== 'HEAD' ? { today: ref } : {}) }).toString();
        const url = `${lab.url}/${game}/${q ? `?${q}` : ''}`;
        const r = await cli(ctx, root, `Game Lab check of ${game}`, ['lab', 'check', game, ...(a.take ? ['--take', String(a.take)] : []), ...(ref !== 'HEAD' ? ['--today', ref] : [])]);
        if (!r.ended) return ok(`The Game Lab is running: ${url}\nIts headless check is still going (job ${r.job.id}); the person can open the lab now.`, { kind: 'lab', game, url, running: true });
        const c = r.result;
        if (!c?.ok) return fail(`The Game Lab is running at ${url}, but its check failed: ${whyOf(r.job)}`, { kind: 'lab', game, url });
        let still = null;
        try { const p = pictureFor(resolve(root, c.still), { label: c.still, max: 420 * 1024 }); still = `data:${p.mimeType};base64,${p.data}`; } catch { still = null; }
        const name = games.find((g) => g.id === game)?.name ?? game;
        const det = (x) => (x === null ? 'replays match' : `replays DIFFER from frame ${x}`);
        return ok([
          `The Game Lab for ${name}: ${url} (on this computer; the person opens it from the card or this link).`,
          `Take "${c.take ?? '(none)'}", ${c.frames} frames at ${c.fps} fps.`,
          `New: ${c.phases.new.join(' · ') || 'no phases yet'} (${det(c.deterministic.new)}; JavaScript ${c.cost.new?.mean} ms a frame, p95 ${c.cost.new?.p95}).`,
          c.phases.today ? `Today (${c.today}): ${c.phases.today.join(' · ') || 'no phases'} (${det(c.deterministic.today)}; JavaScript ${c.cost.today?.mean} ms, p95 ${c.cost.today?.p95}).` : `Today: ${c.todayNote ?? 'none'}.`,
          `Report: ${c.report}; pictures: ${c.sheet} (file_read shows it).`,
          ...(c.errors?.length ? [`Errors: ${c.errors.join('; ')}`] : []),
        ].join('\n'), { kind: 'lab', game, name, url, take: c.take, frames: c.frames, fps: c.fps, phases: c.phases, timeline: c.timeline, deterministic: c.deterministic, cost: c.cost, today: c.today, todayNote: c.todayNote, report: c.report, sheet: c.sheet, still, errors: c.errors ?? [] });
      },
    },
    {
      name: 'studio_deploy', title: 'Put the studio online',
      description: 'Put the studio\'s site online on the studio\'s OWN Cloudflare account: one Worker, one D1 database and two Durable Objects, free plan, no payment method. Call it with plan: true first and tell the person in two or three lines what it creates and costs. If Cloudflare is not signed in, cloudflare_login opens it in their browser to approve once. Runs in the background with the build card.',
      inputSchema: { type: 'object', properties: { plan: { type: 'boolean', description: 'Only say what it will create and what it costs; change nothing' }, ownRoute: { type: 'boolean', description: 'Only after the plan or a deploy warned that another site\'s route on the studio\'s custom domain covers its hostname, and the person agreed: add the studio\'s own exact-host route (the one line the warning gives) and deploy. It never edits or removes any other route' }, ...STUDIO_ARG } },
      annotations: { title: 'Put the studio online', readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        if (a.plan === true) {
          const r = await cli(ctx, root, 'deploy --plan', ['deploy', '--plan']);
          if (!r.ended) return stillRunning(r.job, 'The deploy plan');
          if (r.job.code !== 0) return fail(whyOf(r.job));
          const p = r.result;
          return ok([`What going online does for ${p.studio}:`, 'Rules rooms resume when their stored shape matches. Changes to fields, declaration order or maximum seats start a fresh match.', ...p.cloudflare.map((x) => `  ${x.kind}${x.name ? ` ${x.name}` : ''}: ${x.what} [${x.state}]`), `Cost: ${p.cost}`, `Sign-in: ${p.login}`, `The directory stores: ${p.directory?.stores ?? ''}`, ...(p.parts ? partsPlanLines(p.parts) : []), ...(p.zone?.warning ? [`Warning (say this to the person as it is): ${p.zone.warning}`] : p.zone?.why ? [p.zone.why] : []), 'The card on screen shows this plan (nothing is made yet): tell the person its gist in two or three lines, then go on.'].join('\n'), { kind: 'deploy-plan', ...p });
        }
        const studio = readStudio(root);
        return startRun(ctx, root, { kind: 'deploy', game: null, title: `${studio.name}: online`, steps: [{ label: 'deploy', args: ['deploy', ...(a.ownRoute === true ? ['--own-route'] : [])] }] });
      },
    },
    {
      name: 'stripe_login', title: 'Connect the studio to Stripe',
      description: 'Connect and sync shop.json through Stripe’s official CLI with one browser approval if needed. Creates Products, Prices, Payment Links and the webhook; installs only links and signing secret, no API key in the Worker. Repeat after edits. Follow studio_job. An existing key supports fuller checkout; manual only if explicitly chosen for those features. live only when the owner says go live.',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG, live: { type: 'boolean' }, renew: { type: 'boolean' }, manual: { type: 'boolean' } } },
      annotations: { title: 'Connect Stripe', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const args = ['shop', 'connect', ...(a.live ? ['--live'] : []), ...(a.renew ? ['--renew'] : []), ...(a.manual ? ['--manual'] : [])];
        const job = cliJob(root, 'Stripe connection', args, { cli: join(PACKAGE_ROOT, 'bin', 'homie-studio.mjs'), keep: false });
        const ended = await waitJob(job, Math.min(ctx.waitMs, 1000));
        ctx.status = null;
        if (ended && job.code !== 0) return fail(whyOf(job), { kind: 'job', ...jobView(job) });
        return ok(ended ? jobView(job).tail.join('\n') || 'Stripe connection finished; inspect the job result.' : 'Stripe connection is running. Approve Stripe in the browser when it opens. Check this job for the result and any remaining setup step.', { kind: 'job', ...jobView(job) });
      },
    },
    {
      name: 'cloudflare_login', title: 'Sign in to Cloudflare',
      description: 'Open Cloudflare in the person\'s browser to approve this computer once (Wrangler\'s own sign-in; a free account, no payment method, no key pasted anywhere). Say in one line that Cloudflare opened and they should approve it.',
      inputSchema: { type: 'object', properties: { ...STUDIO_ARG } },
      annotations: { title: 'Sign in to Cloudflare', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
        const job = startJob({ root, label: 'Cloudflare sign-in (wrangler login)', cmd: bin, args: ['login'], keep: false });
        const ended = await waitJob(job, Math.min(ctx.waitMs, 40_000));
        ctx.status = null;
        if (!ended) return ok(`Cloudflare opened in the browser: approve it there (job ${job.id}). setup_status says when it is done.`, { kind: 'job', ...jobView(job) });
        return job.code === 0 ? ok('Signed in to Cloudflare.', { kind: 'job', ...jobView(job) }) : fail(`The sign-in did not finish: ${whyOf(job)}`);
      },
    },
    {
      name: 'studio_publish', title: 'List the studio in the Homie directory',
      description: 'List a deployed studio\'s games, songs and videos in the homie.rocks directory, with their Play links (at most 12 games per studio in the beta). The beta also caps how many times a studio may publish in a day: the answer says how many are left when the directory gives the number, and before: true publishes nothing: it asks the directory how many are left and whether the site is listed (a read), and says so plainly when the directory cannot be reached.',
      inputSchema: { type: 'object', properties: { site: str('Optional: the live site address (default: the one deploy got)'), before: { type: 'boolean', description: 'Publish nothing: ask the directory (a read) whether this site is listed and how many publishes are left today, and say the parts\' licence lines. When the directory cannot be reached it says so, with what this computer has sent today' }, ...STUDIO_ARG } },
      annotations: { title: 'List in the directory', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        // The parts in the games a listing shows, in the deploy plan's own lines (licences, credits, and plainly when
        // two cannot be combined): said before the studio is listed, and again with the answer.
        const partsNow = partsForListing(root);
        const partsSaid = partsPlanLines(partsNow, { at: 'publish' });
        // before: true is `publish --before`, the same function the terminal runs (lib/directory.mjs publishBefore):
        // the directory's read-only count for this site, the parts' lines, and nothing published. Run here, by THIS
        // toolkit, never handed to the studio's pinned one: a 0.31.0 toolkit reads `publish --before` as `publish`.
        if (a.before === true) {
          const b = await publishBefore(root, { site: a.site ? String(a.site) : undefined });
          return ok(b.lines.join('\n'), { kind: 'publish-count', ...publishesSoFar(root), ...b });
        }
        const r = await cli(ctx, root, 'publish', ['publish', ...(a.site ? ['--site', String(a.site)] : [])]);
        if (!r.ended) return stillRunning(r.job, 'Listing');
        if (r.job.code !== 0) return fail(`Not listed: ${whyOf(r.job)}`, r.result?.publishes ? { kind: 'publish', ok: false, needs: r.result.needs ?? null, publishes: r.result.publishes } : undefined);
        return ok(`Listed: ${r.result?.studioPage ?? r.result?.directory ?? ''}\n${(r.result?.games ?? []).map((g) => `  ${g.name}: ${g.play}`).join('\n')}${r.result?.publishes?.line ? `\n${r.result.publishes.line}` : ''}${partsSaid.length ? `\n${partsSaid.join('\n')}` : ''}`, { kind: 'publish', ...r.result });
      },
    },
    {
      name: 'build_open', title: 'Open a build',
      description: 'Step 5: open a progress feed for one build (a game milestone from its codex, a song, a video) BEFORE the work, so its live card is on screen first: the stages (a game: plan → build → checks → deploy), each check going green, a picture, spend against a budget, and Stop. build, check and deploy report into it. Mark the plan done with studio_run ["progress","stage","plan","done","--note","<the plan in one line>"]. share: true also shows it on the Claude app on a phone (build_progress there).',
      inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['game', 'song', 'video'], description: 'What is being made (default game)' }, id: str('The game, song or video id'), title: str('One line: what this build does'), budget: { type: 'number', description: 'Optional: dollars (or credits with unit) the person agreed to' }, unit: { type: 'string', enum: ['usd', 'credits'] }, share: { type: 'boolean', description: 'Also send it to homie.rocks for the Claude app on a phone' }, ...STUDIO_ARG } },
      annotations: { title: 'Open a build', ...RW }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const r = await startProgress(root, { what: a.what ?? 'game', id: a.id ?? null, title: a.title, budget: a.budget, unit: a.unit, share: a.share === true });
        if (!r.ok) return fail(r.why);
        const card = buildCard(ctx, root, feedFor(root, r.build));
        card.content[0].text = `Build ${r.build} is open: ${r.title}.${r.shared ? ` Shared as ${r.shared.build} (build_progress on the Claude app shows it).` : ''}\n${card.content[0].text}`;
        return card;
      },
    },
    {
      name: 'build_progress', title: 'Show a build\'s progress',
      description: 'A live card for one build: its stages, each check going green, a picture and the address to play it, money spent against its budget, and Stop. Without build, the open one. The card follows it by itself until it ends.',
      inputSchema: { type: 'object', properties: { build: str('The build id (or the shared hb_… id); default: the open build'), ...STUDIO_ARG } },
      annotations: { title: 'Show a build', ...RO }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const found = feedFor(root, a.build);
        if (!found?.doc) {
          // The newest build, when none is open: what the person last watched.
          let newest = null;
          try { newest = readdirSync(join(root, '.studio', 'progress')).filter((f) => f.endsWith('.json')).sort().pop()?.slice(0, -5) ?? null; } catch { newest = null; }
          if (!a.build && newest) return buildCard(ctx, root, { id: newest, doc: readFeed(root, newest) });
          return fail(a.build ? `no build ${a.build} in this studio` : 'no build yet: build_open opens one (check, playtest and studio_deploy open their own)');
        }
        return buildCard(ctx, root, found);
      },
    },
    {
      name: 'build_stop', title: 'Stop a build',
      description: 'Ask a running build to stop at its next safe point (a check closes its browsers). The card\'s Stop button calls this; call it yourself only when the person says stop. Nothing is undone.',
      inputSchema: { type: 'object', properties: { build: str('The build id (default: the open build)'), ...STUDIO_ARG } },
      annotations: { title: 'Stop a build', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: ui(UI.build),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const found = feedFor(root, a.build);
        if (!found?.doc) return fail('no such build');
        if (found.doc.state === 'running') new Feed(root, found.id).stop('person');
        return buildCard(ctx, root, feedFor(root, found.id));
      },
    },
    {
      name: 'studio_run', title: 'Run a studio command',
      description: 'Any other homie-studio command in the studio, by its words (the guides name them): e.g. ["progress","stage","plan","done","--note","…"], ["progress","spend","0.40","--what","a cover"], ["look"], ["stats"], ["codex","link","<id>"], ["port","check","<id>","--url","…"], ["shoot","<id>","--preview"], ["build","--types"], ["assets","use","<id>","<asset>","unused"], ["upgrade"], ["storage","add"]. Runs the studio\'s own pinned toolkit; long commands hand back a job. ["upgrade"] runs with THIS Homie\'s toolkit when the studio pins an older one (that is how a studio moves up to it): it says what is new since the studio\'s version and what would change, and changes nothing; ["upgrade","--apply"] only after the person agrees, then studio_install.',
      inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'The command\'s words after `homie-studio`' }, ...STUDIO_ARG }, required: ['args'] },
      annotations: { title: 'Run a studio command', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const args = Array.isArray(a.args) ? a.args.map((x) => String(x)).filter((x) => x !== '--json') : [];
        if (!args.length) return fail('args: the command\'s words, e.g. ["look"]');
        const refused = { mcp: 'this is it', new: 'studio_scaffold makes a studio', dev: 'preview_run runs the site here, preview_stop stops it', statusline: 'only for Claude Code' }[args[0]]
          ?? (args[0] === 'lab' && !['check', 'set', 'stop'].includes(args[1] ?? '') && !args.includes('--stop') ? 'game_lab starts the Game Lab here (and answers with its card)' : null);
        if (refused) return fail(`not here: ${refused}`);
        if (!['help', 'version', 'setup', 'doctor', 'demo', 'starters', 'progress', 'codex', 'games', 'status'].includes(args[0])) { const need = needsInstall(ctx, root); if (need) return need; }
        if (args[0] === 'game' && args[1] === 'new') ctx.note(root).demo = true;
        // The upgrade is the newer toolkit's to make: the studio's own pinned copy knows nothing newer than itself.
        const own = args[0] === 'upgrade' && behindOf(root) ? { cli: join(PACKAGE_ROOT, 'bin', 'homie-studio.mjs') } : {};
        const r = await cli(ctx, root, `homie-studio ${args.slice(0, 3).join(' ')}`, args, own);
        if (!r.ended) return stillRunning(r.job, `homie-studio ${args.slice(0, 2).join(' ')}`);
        const text = r.result ? JSON.stringify(r.result, null, 1).slice(0, 12_000) : jobView(r.job, { lines: 40 }).tail.join('\n');
        return r.job.code === 0 ? ok(text, { kind: 'run', args, result: r.result }) : fail(`homie-studio ${args.join(' ')}: ${whyOf(r.job)}`, { kind: 'run', args, result: r.result });
      },
    },
    {
      name: 'agent_sit', title: 'Sit in a game as an AI guide',
      description: 'Take a guide\'s seat in a live room of one of the studio\'s games as an AI ("Claude · AI": always marked AI, never on a humans-only server, only in a room with people in it). The game\'s own bot code moves the body every frame; you choose its goal and, when the server lets its AI talk, one of the game\'s own lines (agents.json; never free text). Returns your seat, what you see (view), the asks players made of you and your choices. Then agent_look and agent_do every 20 to 40 seconds, and agent_stand when done. Uses the site running here (preview_run) or the live site; with no pass, makes a one-day guide pass with the owner\'s office key and revokes it when you stand.',
      inputSchema: { type: 'object', properties: { game: str('The game\'s id'), server: str('Optional: a server id (default: the pass\'s, else Quick play)'), pass: str('Optional: an agent pass (hap_…) the owner gave; never shown back'), label: str('Optional: the name you play under (default "Claude"; " · AI" is added)'), url: str('Optional: the site (default: this computer\'s preview, else the live site)'), brain: { type: 'string', enum: ['local'], description: 'Optional: "local" lets Cloudflare\'s Clef decision model on this computer (Ollama with clef-flash) choose every few seconds instead of you, free; agent_look shows what it chose and agent_do still overrides it. Never downloads a model: if Ollama has no clef-flash this says what the download costs, and the person decides.' }, ...STUDIO_ARG }, required: ['game'] },
      annotations: { title: 'Sit in a game as an AI guide', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        if (ctx.seat && !ctx.seat.closed) await ctx.seat.stand();
        const site = a.url ? String(a.url) : devOf(root)?.url ?? siteUrl(root);
        if (!site) return fail('the studio is not running here and has no live site: preview_run first, or studio_deploy');
        let local = null;
        if (a.brain === 'local') {
          const found = await detectLocalAi();
          if (!found.ok) return fail(`No local brain: ${found.say}`, { kind: 'agent', ok: false, error: found.why });
          local = found;
        }
        const seat = new AgentSeat({ site, game: String(a.game ?? ''), server: a.server ?? null, pass: a.pass ?? null, label: a.label ? String(a.label).slice(0, 16) : local ? 'Clef' : 'Claude', root, brain: local ? 'local' : null, local });
        const r = await seat.sit();
        if (!r.ok) return fail(`No seat: ${r.why}`, { kind: 'agent', ok: false, error: r.error ?? null });
        ctx.seat = seat;
        if (local) return ok(`Seated as ${r.name} in ${r.room} (seat ${r.seat}), thinking with ${local.model} on this computer every few seconds (free; nothing sent to Cloudflare). agent_look shows its last decisions; agent_do overrides; agent_stand ends it.`, { kind: 'agent', ...r });
        return ok(`Seated as ${r.name} in ${r.room} (seat ${r.seat}). ${r.talking ? 'This server lets its AI talk: lines from look.choices.lines, at most one every 8 s.' : 'This server\'s AI does not talk: choose goals only (say null).'} Look again with agent_look; act with agent_do { goal, args, say?, sayArgs? }.\n${JSON.stringify({ view: r.view, asks: r.asks, choices: r.choices }, null, 1).slice(0, 6000)}`, { kind: 'agent', ...r });
      },
    },
    {
      name: 'agent_look', title: 'Look as the AI guide',
      description: 'What your AI guide sees now: the view the game showed you (game state, seats, never names), the asks players made of you (answer these first), the party\'s lines, your last goal, and your choices.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Look as the AI guide', ...RO },
      run: async () => {
        if (!ctx.seat) return fail('not seated: agent_sit first');
        const l = ctx.seat.look();
        return ok(`${l.closed ? `The seat closed (${l.closed}); agent_sit again.\n` : ''}${JSON.stringify(l, null, 1).slice(0, 8000)}`, { kind: 'agent', ...l });
      },
    },
    {
      name: 'agent_do', title: 'Act as the AI guide',
      description: 'Choose your guide\'s goal (one of look.choices.goals, with argument values the view offers; a player argument is a seat number) and, if the server lets its AI talk, at most one line (look.choices.lines; never free text). The game\'s bot code carries it out at frame rate until you choose again. At most one goal every 3 s and one line every 8 s.',
      inputSchema: { type: 'object', properties: { goal: str('A goal id'), args: { type: 'object', description: 'The goal\'s arguments' }, say: str('Optional: a line id'), sayArgs: { type: 'object', description: 'The line\'s arguments' } }, required: ['goal'] },
      annotations: { title: 'Act as the AI guide', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        if (!ctx.seat) return fail('not seated: agent_sit first');
        const r = await ctx.seat.do({ goal: a.goal, args: a.args ?? {}, say: a.say ?? null, sayArgs: a.sayArgs ?? {} });
        return r.ok ? ok(`Done: ${r.sent.goal} ${JSON.stringify(r.sent.args)}${r.text ? `, saying "${r.text}"` : ''}.`, { kind: 'agent', ...r }) : fail(r.why, { kind: 'agent', ok: false });
      },
    },
    {
      name: 'agent_stand', title: 'Leave the seat',
      description: 'Your AI guide leaves the room (its seat becomes a guide the game\'s own script plays); a pass made for this sitting is revoked.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Leave the seat', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async () => {
        if (!ctx.seat) return ok('Not seated.');
        const r = await ctx.seat.stand();
        ctx.seat = null;
        return ok(`Left ${r.room}.`, { kind: 'agent', ...r });
      },
    },
    {
      name: 'studio_job', title: 'A job, so far',
      description: 'Where a job a tool handed back is (an npm install, a check, a deploy, a render, a standalone build): running or done, its last lines and its result. A result that comes with its own words for the person (a standalone build\'s) is given in those words: read them to the person. Waits up to 30 s for it to finish.',
      inputSchema: { type: 'object', properties: { job: str('The job id (j_…)') }, required: ['job'] },
      annotations: { title: 'A job', ...RO },
      run: async (a) => {
        const job = getJob(a.job);
        if (!job) return fail(`no job ${a.job} (jobs end with the app; build_progress shows a build)`);
        await waitJob(job, Math.min(ctx.waitMs, 30_000));
        const v = jobView(job, { lines: 20 });
        if (job.endedAt) ctx.status = null;
        return ok(`${v.label}: ${v.state}${v.state === 'running' ? ` (${v.seconds} s so far)` : ` after ${v.seconds} s`}${v.state === 'failed' ? `: ${whyOf(job)}` : ''}${Array.isArray(v.result?.say) && v.result.say.length ? `\n${v.result.say.join('\n').slice(0, 16_000)}` : v.result ? `\n${JSON.stringify(v.result, null, 1).slice(0, 8000)}` : v.tail.length ? `\n${v.tail.join('\n')}` : ''}`, { kind: 'job', ...v });
      },
    },
    {
      name: 'homie_feedback', title: 'Tell Homie',
      description: 'A short private note to the people who make Homie, and ONLY with the person\'s yes. action "draft" (the default) sends nothing: it shows the note exactly as it would go (a card with Send, Edit and Don\'t send; the words, the step, the studio and plugin versions and the app, after keys, paths, emails and code are taken out), and you show the same text in the chat and ask. action "send" sends that draft (its "draft" id, with the same kind and text) only after the person said yes in their own words; "decline" records their no. OFFER it (offered: true) at most once a session, at a natural moment: after an error you could not fix, when the person sounds confused or frustrated, or at the end of their first studio setup or first publish. Never nag; a no is final for the session. When the person asks to tell Homie something, draft it with offered: false. Write it in plain words from what happened (what they tried, what they expected, what they saw), never a log, a file, code, a key or someone\'s name; a reply address only if they typed it themselves.',
      inputSchema: {
        type: 'object',
        properties: {
          action: str('draft (show it; sends nothing), send (after the person\'s yes) or decline (their no)', { enum: ['draft', 'send', 'decline'] }),
          kind: str('What it is', { enum: [...FEEDBACK_KINDS] }),
          text: str(`What happened, in plain words, at most ${FEEDBACK_LIMITS.text.toLocaleString('en-US')} characters: your draft, or the person\'s own words`),
          step: str('Optional: the step or skill it is about, e.g. "studio-setup: put it online" or "publish"'),
          email: str('Optional: a reply address, only if the person typed it themselves'),
          offered: { type: 'boolean', description: 'true when you offered it; false when the person asked to tell Homie' },
          draft: str('With send or decline: the draft id the draft returned (fd_…)'),
          by: str('How the person said yes: chat (in their own words), card (the card\'s Send) or dialog (Send in Claude Code\'s own question, which the Homie mod asks)', { enum: ['chat', 'card', 'dialog'] }),
          studioVersion: str('Filled in here from the studio (the remote Homie MCP takes it from you)'),
          pluginVersion: str('Filled in here from the plugin (the remote Homie MCP takes it from you)'),
          app: str('Filled in here from this app (the remote Homie MCP takes it from you)', { enum: [...FEEDBACK_APPS] }),
          ...STUDIO_ARG,
        },
      },
      annotations: { title: 'Tell Homie', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, _meta: ui(UI.feedback),
      run: async (a) => feedbackTool(ctx, a),
    },
    {
      name: 'file_list', title: 'List studio files',
      description: 'The files and folders in the studio (or one folder of it), two levels deep. Paths are relative to the studio.',
      inputSchema: { type: 'object', properties: { path: str('A folder in the studio (default: its root)'), depth: { type: 'number', description: '1 to 4 (default 2)' }, ...STUDIO_ARG } },
      annotations: { title: 'List files', ...RO },
      run: async (a) => {
        const r = listFiles(ctx.root(a.studio), a.path ?? '.', { depth: Math.min(4, Math.max(1, Number(a.depth) || 2)) });
        return ok(`${r.path}/\n${r.entries.map((e) => `  ${e.path}${e.type === 'file' && e.size !== null ? ` (${e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`})` : ''}`).join('\n')}${r.truncated ? '\n  …' : ''}`, { kind: 'files', ...r });
      },
    },
    {
      name: 'file_read', title: 'Read a studio file',
      description: 'A file in the studio, with line numbers (offset and limit for long ones), or a picture (png, jpg, webp, gif) to look at. node_modules/@homie-rocks/studio has the toolkit\'s own guides (netplay/NETPLAY.md, site/SITE.md, media/MEDIA.md).',
      inputSchema: { type: 'object', properties: { path: str('The file, relative to the studio'), offset: { type: 'number' }, limit: { type: 'number' }, ...STUDIO_ARG }, required: ['path'] },
      annotations: { title: 'Read a file', ...RO },
      run: async (a) => {
        const r = readStudioFile(ctx.root(a.studio), a.path, { offset: a.offset, limit: a.limit });
        if (r.image) return { content: [{ type: 'image', data: r.image.data, mimeType: r.image.mimeType }, { type: 'text', text: `${r.rel} (${r.shrunk ? `a smaller JPEG copy, ${Math.round(r.bytes / 1024)} KB, of a ${Math.round(r.from / 1024)} KB picture; the file is unchanged` : `${Math.round(r.bytes / 1024)} KB`})` }] };
        return ok(`${r.rel} (lines ${r.from}-${r.to} of ${r.lines}${r.more ? '; more with offset' : ''})\n${r.text}`);
      },
    },
    {
      name: 'file_write', title: 'Write a studio file',
      description: 'Write a whole file in the studio (a new one, or replacing one you read first). For a change to part of a file, file_edit.',
      inputSchema: { type: 'object', properties: { path: str('The file, relative to the studio'), content: str('Its whole text'), ...STUDIO_ARG }, required: ['path', 'content'] },
      annotations: { title: 'Write a file', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const r = writeStudioFile(root, a.path, a.content);
        ctx.note(root).changed = true;
        return ok(`${r.created ? 'Wrote' : 'Replaced'} ${r.rel} (${r.bytes} bytes).`);
      },
    },
    {
      name: 'file_edit', title: 'Edit a studio file',
      description: 'Replace exact text in a studio file: old must match exactly once (spaces and line breaks too), or all: true for every match. Read the file first. Several changes to one file go in ONE call: edits is a list of { old, new, all? } applied in order, all of them or none (a miss says which one, and the file is left as it was). Prefer one call with every change over a call per change.',
      inputSchema: { type: 'object', properties: { path: str('The file, relative to the studio'), old: str('The exact text to replace (one change)'), new: str('What replaces it'), all: { type: 'boolean' }, edits: { type: 'array', description: 'Several changes to this file in one call, applied in order, all or none', items: { type: 'object', properties: { old: str('The exact text to replace'), new: str('What replaces it'), all: { type: 'boolean' } }, required: ['old', 'new'] } }, ...STUDIO_ARG }, required: ['path'] },
      annotations: { title: 'Edit a file', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const list = Array.isArray(a.edits) && a.edits.length ? a.edits : null;
        if (!list && (a.old === undefined || a.new === undefined)) return fail('give old and new (one change), or edits: [{ "old": "…", "new": "…" }, …] for several changes to this file in one call');
        const r = list
          ? editStudioFile(root, a.path, null, null, { edits: [...(a.old !== undefined && a.new !== undefined ? [{ old: a.old, new: a.new, all: a.all === true }] : []), ...list] })
          : editStudioFile(root, a.path, a.old, a.new, { all: a.all === true });
        ctx.note(root).changed = true;
        return ok(`Changed ${r.rel} (${r.replaced} place${r.replaced === 1 ? '' : 's'}${r.edits > 1 ? `, ${r.edits} edits in one call` : ''}).`);
      },
    },
    {
      name: 'file_search', title: 'Search studio files',
      description: 'Lines matching a regular expression in the studio\'s own text files (never node_modules, git, builds).',
      inputSchema: { type: 'object', properties: { pattern: str('A JavaScript regular expression'), path: str('Optional folder'), ignoreCase: { type: 'boolean' }, ...STUDIO_ARG }, required: ['pattern'] },
      annotations: { title: 'Search files', ...RO },
      run: async (a) => {
        const r = searchStudio(ctx.root(a.studio), a.pattern, { path: a.path ?? '.', ignoreCase: a.ignoreCase === true });
        return ok(r.matches.length ? r.matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n') + (r.truncated ? '\n…' : '') : 'No match.');
      },
    },
  ];
  // Art direction, the cast, the starter library, generated props, checks, the lineup and the rights (lib/art-tools.mjs).
  tools.push(...artToolDefs(ctx, { ok, fail, cli, stillRunning, whyOf, needsInstall, ui, str, STUDIO_ARG, RO, RW, pictureFor, findNode, startJob, waitJob }));
  tools.push(...partsToolDefs(ctx, { ok, fail, str, STUDIO_ARG, RO, RW }));
  // A game as an app of its own, for computers and phones (lib/standalone-tools.mjs).
  tools.push(...standaloneToolDefs(ctx, { ok, fail, cli, stillRunning, whyOf, needsInstall, str, STUDIO_ARG }));
  const topics = guideTopics(ctx);
  if (topics.length) {
    tools.push({
      name: 'studio_guide', title: 'Homie\'s guides',
      description: `How Homie does each job, in full: ${topics.join(', ')}. Read the one for the job before doing it (studio-setup is the new-studio checklist; game, plan, parallel, port, playtest and publish the rest of a game's life; music, sound, art and video the media).`,
      inputSchema: { type: 'object', properties: { topic: str('One of the guides', { enum: topics }), file: str('Optional: one of its references, e.g. "INTERVIEW.md"') }, required: ['topic'] },
      annotations: { title: 'Homie\'s guides', ...RO },
      run: async (a) => {
        if (!topics.includes(a.topic)) return fail(`guides: ${topics.join(', ')}`);
        const dir = join(ctx.skillsDir, a.topic);
        if (a.file) {
          const f = join(dir, 'references', basename(String(a.file)));
          if (!existsSync(f)) return fail(`no reference ${a.file} in ${a.topic}`);
          return ok(readFileSync(f, 'utf8'));
        }
        const refs = (() => { try { return readdirSync(join(dir, 'references')); } catch { return []; } })();
        return ok(`${DESKTOP_NOTE}${ctx.desktop ? `\n\n${DESKTOP_APPROVALS}` : ''}\n\n${readFileSync(join(dir, 'SKILL.md'), 'utf8')}${refs.length ? `\n\nReferences (file): ${refs.join(', ')}` : ''}`);
      },
    });
  }
  // The media skills' own scripts, where their provider (or the free tool they need) is set up on this computer.
  for (const [name, title, needs] of [['music', 'Music (ElevenLabs)', 'elevenlabs'], ['sound', 'Sound effects and a theme (free)', 'ffmpeg'], ['art', 'Art: covers, frames, painted art', 'ffmpeg'], ['video', 'Video: trailers and clips', 'ffmpeg'], ['models', 'Models: generated 3D props (paid, on your fal account)', 'node']]) {
    const script = ctx.skillsDir ? join(ctx.skillsDir, name, 'scripts', `${name}.mjs`) : null;
    if (!script || !existsSync(script) || !avail[needs]) continue;
    tools.push({
      name, title,
      description: `The ${name} guide's own script, in the studio, by its words (studio_guide { "topic": "${name}" } says which, in what order, and what costs money): e.g. ["check"]${name === 'music' ? ', ["quote","--seconds","30"]' : name === 'sound' ? ', ["sfx","pickup"]' : ''}. Paid steps are quoted first and capped by the budget the person agreed to. Long renders hand back a job.`,
      inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'The script\'s words' }, ...STUDIO_ARG }, required: ['args'] },
      annotations: { title, readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const node = findNode();
        if (!node) return fail('no Node.js 22 or newer on this computer');
        const args = (Array.isArray(a.args) ? a.args.map(String) : []).filter((x) => x !== '--json');
        const job = startJob({ root, label: `${name} ${args.slice(0, 2).join(' ')}`, cmd: node.bin, args: [script, ...args, '--json'], json: true });
        if (!(await waitJob(job, ctx.waitMs))) return stillRunning(job, `${name} ${args[0] ?? ''}`);
        const text = job.result ? JSON.stringify(job.result, null, 1).slice(0, 12_000) : jobView(job, { lines: 30 }).tail.join('\n');
        return job.code === 0 ? ok(text, { kind: name, result: job.result }) : fail(`${name} ${args.join(' ')}: ${whyOf(job)}`);
      },
    });
  }
  // Every tool says whose it is: a Claude app may also have the Homie house app's own MCP server (its room and TV
  // tools), a different server with different tools.
  for (const t of tools) if (!t.description.startsWith('Homie Studio')) t.description = `Homie Studio: ${t.description}`;
  return tools;
}

/** What the media tools need, cheaply (no network): ffmpeg on the PATH, ElevenLabs' CLI or key. */
export function availability(env = process.env) {
  return { node: true, ffmpeg: Boolean(which(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')), elevenlabs: Boolean(env.ELEVENLABS_API_KEY || which(process.platform === 'win32' ? 'elevenlabs.exe' : 'elevenlabs')) };
}

/** The codex page small enough to hand a card (a tool result over ~150,000 characters is not shown). */
export function slimCodex(html, { max = 140_000, pictures = true } = {}) {
  let h = String(html ?? '');
  if (h.length <= max && pictures) return h;
  h = h.replace(/(<img\b[^>]*?\ssrc=")data:[^"]*(")/g, '$1$2').replace(/url\((['"]?)data:[^)]*\1\)/g, 'none');
  return h.length <= max ? h : null;
}

export const _test = { checklist, feedFor, slimCodex, expandHome, feedbackFacts };
