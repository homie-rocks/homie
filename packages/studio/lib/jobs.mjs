/**
 * THE WORK THE LOCAL MCP SERVER STARTS (lib/mcp.mjs): every studio command runs as its own process, with the
 * studio's OWN pinned toolkit (node_modules/@homie-rocks/studio, the version its package.json names), and the
 * system's Node. A tool call waits for it a little while (under a minute: the Claude desktop app gives a local tool
 * call 60 s), then hands back a job id; `studio_job` reads it later, and a check, playtest or deploy also reports
 * into the studio's progress feed, which the build card follows.
 *
 * WHICH NODE. Inside the Claude desktop app the server may run on the app's own built-in Node, which may not start
 * another copy of itself (process.execPath is the app). A studio needs the system's Node and npm anyway (npm
 * install, Wrangler, esbuild), so commands always run with the first Node 22 or newer on the PATH. A GUI app's PATH
 * is short, so the usual places Node lives are added (Homebrew, nvm, Volta, asdf, fnm, the Node installer).
 *
 * Logs go to .studio/mcp/<job>.log in the studio (git-ignored). Nothing here ever runs a shell.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PACKAGE_ROOT } from './studio.mjs';

const WIN = process.platform === 'win32';

const byVersionDesc = (a, b) => {
  const pa = a.replace(/^v/, '').split('.').map(Number); const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

/** Where Node and npm usually live, after this process's own PATH. */
export function toolPath(env = process.env, platform = process.platform, home = homedir()) {
  const nvm = (() => {
    const dir = join(home, '.nvm', 'versions', 'node');
    try { return readdirSync(dir).filter((v) => /^v\d+\./.test(v)).sort(byVersionDesc).map((v) => join(dir, v, 'bin')); } catch { return []; }
  })();
  const extra = platform === 'win32'
    ? [join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm'), join(env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'), join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Volta', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.volta', 'bin'), join(home, '.asdf', 'shims'), join(home, '.local', 'bin'), join(home, '.fnm', 'aliases', 'default', 'bin'), join(home, '.bun', 'bin'), ...nvm, '/usr/bin', '/bin'];
  const seen = new Set();
  const out = [];
  for (const p of [...String(env.PATH ?? env.Path ?? '').split(delimiter), ...extra]) if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  return out.join(delimiter);
}

let nodeCache = null;
/** The first Node 22 or newer on the PATH (never the Claude app's own binary): { bin, version, npm } or null. */
export function findNode({ fresh = false } = {}) {
  if (nodeCache && !fresh) return nodeCache;
  const exe = WIN ? 'node.exe' : 'node';
  const candidates = [];
  // A plain Node process (Claude Code, a terminal, a test) can run itself; the Claude app's built-in one cannot.
  if (!process.versions.electron) candidates.push(process.execPath);
  for (const dir of toolPath().split(delimiter)) candidates.push(join(dir, exe));
  const tried = new Set();
  for (const bin of candidates) {
    if (tried.has(bin) || !existsSync(bin)) continue;
    tried.add(bin);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 5000, env });
    const version = String(r.stdout ?? '').trim().replace(/^v/, '');
    if (r.status === 0 && Number(version.split('.')[0]) >= 22) {
      const npmNext = join(dirname(bin), WIN ? 'npm.cmd' : 'npm');
      nodeCache = { bin, version, npm: existsSync(npmNext) ? npmNext : which(WIN ? 'npm.cmd' : 'npm') };
      return nodeCache;
    }
  }
  return null;
}

export function which(name) {
  for (const dir of toolPath().split(delimiter)) { const p = join(dir, name); if (existsSync(p)) return p; }
  return null;
}

/** The environment a studio command runs in: the long PATH (this Node's folder first), no update nags. */
export function toolEnv(extra = {}) {
  const node = findNode();
  const path = toolPath();
  const env = { ...process.env, PATH: node ? `${dirname(node.bin)}${delimiter}${path}` : path, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', WRANGLER_SEND_METRICS: 'false', ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** The studio's own pinned CLI, else this package's (a studio before its npm install). */
export function cliOf(root) {
  const pinned = join(root, 'node_modules', '@homie-rocks', 'studio', 'bin', 'homie-studio.mjs');
  return existsSync(pinned) ? pinned : join(PACKAGE_ROOT, 'bin', 'homie-studio.mjs');
}
export const installed = (root) => existsSync(join(root, 'node_modules', '@homie-rocks', 'studio', 'package.json')) && existsSync(join(root, 'node_modules', 'wrangler'));

const jobs = new Map();
const MAX_OUT = 4 * 1024 * 1024;

/**
 * Start one process for a studio. `json`: the command prints a JSON result on stdout (homie-studio --json), kept
 * as job.result. `onEnd(job)` runs once when it exits.
 */
export function startJob({ root, label, cmd, args, env = toolEnv(), json = false, onEnd = null, keep = false }) {
  const id = `j_${randomBytes(6).toString('hex')}`;
  const dir = join(root, '.studio', 'mcp');
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${id}.log`);
  appendFileSync(log, `$ ${[cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: WIN && /\.cmd$/i.test(cmd) });
  const job = { id, label, root, args, pid: child.pid ?? null, startedAt: new Date().toISOString(), endedAt: null, code: null, out: '', err: '', log, result: null, json, keep, child };
  let finish;
  job.done = new Promise((r) => { finish = r; });
  child.stdout.on('data', (d) => { if (job.out.length < MAX_OUT) job.out += d; try { appendFileSync(log, d); } catch { /* full disk: keep going */ } });
  child.stderr.on('data', (d) => { job.err = (job.err + d).slice(-64 * 1024); try { appendFileSync(log, d); } catch { /* keep going */ } });
  const end = (code) => {
    if (job.endedAt) return;
    job.code = code;
    job.endedAt = new Date().toISOString();
    if (json) job.result = lastJson(job.out);
    job.child = null;
    try { onEnd?.(job); } catch { /* the job's own result stands */ }
    finish(job);
  };
  child.on('error', (error) => { job.err += `\n${error.message}`; end(127); });
  child.on('close', (code) => end(code ?? 1));
  jobs.set(id, job);
  return job;
}

/** The last JSON document a command printed (homie-studio --json prints one, pretty). */
export function lastJson(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* look for the last top-level object */ }
  for (let i = s.lastIndexOf('\n{'); i >= 0; i = s.lastIndexOf('\n{', i - 1)) {
    try { return JSON.parse(s.slice(i + 1)); } catch { /* earlier */ }
    if (i === 0) break;
  }
  return null;
}

export const getJob = (id) => jobs.get(String(id ?? '')) ?? null;
export const runningJobs = (root) => [...jobs.values()].filter((j) => !j.endedAt && (!root || j.root === root));

/** Wait for a job at most `ms`; true when it ended. */
export async function waitJob(job, ms) {
  if (job.endedAt) return true;
  let t;
  const ended = await Promise.race([job.done.then(() => true), new Promise((r) => { t = setTimeout(() => r(false), ms); })]);
  clearTimeout(t);
  return ended;
}

/** What a person (and the model) is told about a job. */
export function jobView(job, { lines = 12 } = {}) {
  const text = `${job.err}\n${job.json ? '' : job.out}`.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return {
    job: job.id, label: job.label, state: !job.endedAt ? 'running' : job.code === 0 ? 'done' : 'failed', code: job.code,
    startedAt: job.startedAt, endedAt: job.endedAt,
    seconds: Math.round(((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000),
    tail: text.slice(-lines), log: job.log, result: job.result,
  };
}

/** Run the studio's pinned CLI as a job: `homie-studio <args> --json`. */
export function cliJob(root, label, args, { cli = null, ...opts } = {}) {
  const node = findNode();
  if (!node) throw new Error('no Node.js 22 or newer on this computer: install it from https://nodejs.org/en/download (the LTS), then ask again');
  // `cli`: another homie-studio than the studio's pinned one (this package's, for an upgrade to it).
  return startJob({ root, label, cmd: node.bin, args: [cli ?? cliOf(root), ...args, '--json'], json: true, ...opts });
}

/** `npm install` in a studio (its pinned toolkit and Wrangler). */
export function installJob(root, opts = {}) {
  const node = findNode();
  if (!node?.npm) throw new Error('npm was not found next to Node.js on this computer: install Node.js 22 or newer from https://nodejs.org/en/download, then ask again');
  return startJob({ root, label: 'npm install (the studio\'s pinned toolkit and Wrangler)', cmd: node.npm, args: ['install', '--no-audit', '--no-fund'], ...opts });
}

/** When the server ends (the app quit), nothing it started keeps running, except what asked to (none today). */
export function stopAllJobs() {
  for (const job of jobs.values()) {
    if (job.endedAt || !job.child || job.keep) continue;
    try { job.child.kill('SIGTERM'); } catch { /* gone */ }
  }
}
