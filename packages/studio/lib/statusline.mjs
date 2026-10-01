/**
 * THE CLAUDE CODE STATUS LINE: one quiet line under the prompt with the studio's current build, from its progress
 * feed (lib/progress.mjs), for example
 *
 *   ▶ Ember Run · Checks ▰▰▰▰▰▰▱▱▱▱ 62% · 3/5 checks · $0.40 of $2.00
 *
 * Optional, and only on the person's yes: `homie-studio statusline --install` writes the `statusLine` setting into
 * this studio's `.claude/settings.local.json` (this person, this studio; Claude Code keeps that file out of git, and
 * the studio's .gitignore does too). Claude Code runs the command after each message and, with `refreshInterval`,
 * every few seconds while a long check runs; it sends the session as JSON on stdin (`workspace.current_dir`), and
 * shows what the command prints. With no build running it shows only the studio's name, dimmed; a build that ended
 * stays for a few minutes (passed, failed or stopped), then goes.
 *
 * Plugins cannot set a status line (a plugin's settings take only `agent` and `subagentStatusLine`), so this is a
 * one-line project setting the person agrees to, never something the plugin switches on.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { currentFeedDoc, latestFeedFor, summarize } from './feed-summary.mjs';
import { PACKAGE_ROOT, findStudio } from './studio.mjs';

const ANSI = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
/** How long an ended build stays on the line. */
export const RECENT_MS = 10 * 60_000;

function bar(percent, width) {
  const full = Math.round((percent / 100) * width);
  return { done: '▰'.repeat(full), left: '▱'.repeat(Math.max(0, width - full)) };
}

/**
 * The line for the studio at or above `dir`, or '' outside a studio. Parts are dropped from the end (spend, then
 * checks) until the line fits in `columns`.
 */
export function statusLine({ dir = process.cwd(), now = Date.now(), columns = 100, color = true } = {}) {
  const root = findStudio(dir);
  if (!root) return '';
  let name = 'Studio';
  try { name = JSON.parse(readFileSync(join(root, 'studio.json'), 'utf8')).name || name; } catch { /* keep */ }
  const s = summarize(currentFeedDoc(root) ?? latestFeedFor(root, null));
  const paint = (code, text) => (color && text ? `${code}${text}${ANSI.reset}` : text);
  const fit = (parts) => {
    // parts: [[plain, painted], …]; keep the first two whole, then as many as fit.
    const width = Math.max(20, columns - 2);
    let keep = parts.length;
    const len = (n) => parts.slice(0, n).reduce((a, [plain]) => a + plain.length, 0) + (n - 1) * 3;
    while (keep > 1 && len(keep) > width) keep -= 1;
    const out = parts.slice(0, keep).map(([, painted]) => painted).join(paint(ANSI.dim, ' · '));
    const plain = parts.slice(0, keep).map(([p]) => p).join(' · ');
    return plain.length > width ? `${plain.slice(0, width - 1)}…` : out;
  };
  const ended = s && s.state !== 'running' ? Date.parse(s.endedAt ?? s.updatedAt ?? 0) : null;
  if (!s || (ended !== null && !(now - ended < RECENT_MS))) return fit([[`◇ ${name}`, paint(ANSI.dim, `◇ ${name}`)]]);

  const title = s.title.length > 40 ? `${s.title.slice(0, 39)}…` : s.title;
  if (s.state === 'passed') {
    return fit([[`✓ ${title} done`, paint(ANSI.green, `✓ ${title} done`)], ...(s.preview ? [[s.preview, paint(ANSI.dim, s.preview)]] : [])]);
  }
  if (s.state === 'failed') {
    const why = `failed${s.stage ? ` at ${s.stage.label}` : ''}${s.error ? `: ${s.error}` : ''}`;
    return fit([[`✗ ${title}`, paint(ANSI.red, `✗ ${title}`)], [why, paint(ANSI.red, why)]]);
  }
  if (s.state === 'stopped') return fit([[`■ ${title} stopped`, paint(ANSI.yellow, `■ ${title} stopped`)]]);

  const width = columns < 70 ? 6 : 10;
  const b = bar(s.percent, width);
  const stage = s.stopping ? 'stopping…' : (s.stage?.label ?? 'Starting');
  const progress = `${stage} ${b.done}${b.left} ${s.percent}%`;
  const parts = [
    [`▶ ${title}`, paint(ANSI.bold, `▶ ${title}`)],
    [progress, `${paint(ANSI.cyan, stage)} ${paint(ANSI.green, b.done)}${paint(ANSI.dim, b.left)} ${s.percent}%`],
  ];
  if (s.checks.total) {
    const text = `${s.checks.pass}/${s.checks.total} checks${s.checks.fail ? `, ${s.checks.fail} failing` : ''}`;
    parts.push([text, paint(s.checks.fail ? ANSI.red : ANSI.dim, text)]);
  }
  if (s.spend.text) parts.push([s.spend.text, paint(ANSI.dim, s.spend.text)]);
  return fit(parts);
}

/* ------------------------------------------------------------------ the setting */

const LOCAL = join('.claude', 'settings.local.json');
const readJson = (path) => { if (!existsSync(path)) return {}; return JSON.parse(readFileSync(path, 'utf8')); };
/** Our own status line: a command that runs this toolkit's statusline. */
export const isOurs = (statusLine) => typeof statusLine?.command === 'string' && /homie-studio|@homie-rocks[\\/]studio/.test(statusLine.command) && /statusline/.test(statusLine.command);

/**
 * The command the setting runs: this studio's pinned toolkit, by an absolute path (forward slashes, for Windows
 * too). Set in another folder (the one Claude Code was started in, above the studio), it names the studio too.
 */
export function statusLineCommand(root, { named = false } = {}) {
  const pinned = join(root, 'node_modules', '@homie-rocks', 'studio', 'bin', 'statusline.mjs');
  const script = existsSync(pinned) ? pinned : join(PACKAGE_ROOT, 'bin', 'statusline.mjs');
  const slash = (p) => p.replace(/\\/g, '/');
  return `node "${slash(script)}"${named ? ` --studio "${slash(root)}"` : ''}`;
}

/** Every settings file that may already hold a status line for this studio, most specific first. */
function settingsFiles(project, env) {
  const user = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, 'settings.json') : join(env.HOME || homedir(), '.claude', 'settings.json');
  return [
    { where: 'this project, this person (.claude/settings.local.json)', path: join(project, LOCAL) },
    { where: 'this project (.claude/settings.json)', path: join(project, '.claude', 'settings.json') },
    { where: 'every project of this person (the user settings)', path: user },
  ];
}

/**
 * `homie-studio statusline --install`: the status line in this studio's .claude/settings.local.json. It never
 * replaces a status line the person already has (anywhere Claude Code would read one) unless `replace`.
 * `remove`: take ours out again.
 */
export function installStatusLine(root, { replace = false, remove = false, project = null, env = process.env } = {}) {
  // Claude Code reads project settings from the folder it was started in. A studio made as a subfolder of that
  // folder is named in the command, and the setting goes where Claude Code reads it (`--project <that folder>`).
  const here = project ? resolve(project) : root;
  if (!existsSync(here)) return { ok: false, command: 'statusline install', why: `no folder ${here}` };
  const files = settingsFiles(here, env);
  const local = files[0].path;
  let mine;
  try { mine = readJson(local); } catch { return { ok: false, command: 'statusline install', why: `${LOCAL} is not valid JSON; fix it by hand first (nothing was changed)` }; }
  if (remove) {
    if (!isOurs(mine.statusLine)) return { ok: true, command: 'statusline remove', removed: false, message: 'No Homie status line in this studio; nothing changed.' };
    delete mine.statusLine;
    writeFileSync(local, `${JSON.stringify(mine, null, 2)}\n`);
    return { ok: true, command: 'statusline remove', removed: true, file: LOCAL, message: `Removed the Homie status line from ${LOCAL}.` };
  }
  const command = statusLineCommand(root, { named: here !== root });
  if (isOurs(mine.statusLine) && mine.statusLine.command === command) return { ok: true, command: 'statusline install', already: true, file: LOCAL, statusLine: mine.statusLine, message: 'The status line is already on in this studio.' };
  if (!replace) {
    for (const f of files) {
      let s = null;
      try { s = readJson(f.path).statusLine ?? null; } catch { s = null; }
      if (s && !isOurs(s)) {
        return { ok: false, command: 'statusline install', exists: { where: f.where, command: String(s.command ?? s.type ?? '').slice(0, 120) }, why: `there is already a status line (${f.where}). Nothing was changed. With --replace, this studio shows the build's progress instead (only here; the other one stays everywhere else).` };
      }
    }
  }
  mine.statusLine = { type: 'command', command, padding: 0, refreshInterval: 5 };
  mkdirSync(join(here, '.claude'), { recursive: true });
  writeFileSync(local, `${JSON.stringify(mine, null, 2)}\n`);
  // Claude Code keeps settings.local.json out of git when it makes the file; this one we made, so say it here too.
  const ignore = join(here, '.gitignore');
  let ignored = false;
  if (existsSync(ignore) || here === root) try {
    const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
    if (!/^\.claude\/settings\.local\.json\s*$/m.test(text)) { writeFileSync(ignore, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# This person's own Claude Code settings for this studio (the status line).\n.claude/settings.local.json\n`); ignored = true; }
  } catch { /* no .gitignore to keep */ }
  return {
    ok: true, command: 'statusline install', file: here === root ? LOCAL : join(here, LOCAL), statusLine: mine.statusLine, gitignore: ignored,
    message: `The status line is on ${here === root ? `in this studio (${LOCAL})` : `for Claude Code started in ${here} (${LOCAL} there)`}: one line under the prompt with the current build's stage, a progress bar, its checks and what it spent. Claude Code reloads settings by itself; it shows from the next message. Turn it off with: npx --no-install homie-studio statusline --remove`,
  };
}
