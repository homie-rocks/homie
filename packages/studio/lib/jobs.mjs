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
 * A job outlives the server that started it (lib/job-runner.mjs supervises it, detached): its state is
 * .studio/mcp/<job>.json and its logs .studio/mcp/<job>.log in the studio (git-ignored), which a later server reads.
 * Nothing here ever runs a shell.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { lastJson, readState, tailOf, writeState } from './job-runner.mjs';
import { nodeHome } from './prepare.mjs';
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
  for (const p of [...String(env.PATH ?? env.Path ?? '').split(delimiter), join(nodeHome(home), platform === 'win32' ? '' : 'bin'), ...extra]) if (p && !seen.has(p)) { seen.add(p); out.push(p); }
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
  let withoutNpm = null;
  for (const bin of candidates) {
    if (tried.has(bin) || !existsSync(bin)) continue;
    tried.add(bin);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 5000, env });
    const version = String(r.stdout ?? '').trim().replace(/^v/, '');
    if (r.status === 0 && Number(version.split('.')[0]) >= 22) {
      const npmNext = join(dirname(bin), WIN ? 'npm.cmd' : 'npm');
      const found = { bin, version, npm: existsSync(npmNext) ? npmNext : which(WIN ? 'npm.cmd' : 'npm') };
      if (found.npm) { nodeCache = found; return nodeCache; }
      withoutNpm ??= found;
    }
  }
  return withoutNpm;
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
const RUNNER = fileURLToPath(new URL('./job-runner.mjs', import.meta.url));
const JOB_ID = /^j_[a-f0-9]{12}$/;
export { lastJson };

/** Is that process still there? (EPERM: it is, under another user.) */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}

/** A Node that can run the supervisor: the system's, else this one (the Claude app's own, as plain Node). */
function runnerNode(env) {
  const node = findNode();
  if (node) return { bin: node.bin, env };
  return { bin: process.execPath, env: process.versions.electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env };
}

/** A job as this process sees it: its state file read again; its output read from its files when asked. */
function jobFrom(file, extra = {}) {
  const job = { stateFile: file, child: null, done: null, onEnd: null, steps: [], ...extra };
  Object.defineProperty(job, 'out', { enumerable: true, get: () => (job.json ? '' : job.steps.map((s) => tailOf(s.out)).join('')) });
  Object.defineProperty(job, 'err', { enumerable: true, get: () => job.steps.map((s) => tailOf(s.err)).join('').slice(-64 * 1024) });
  return refreshJob(job);
}

/**
 * Read a job's state file again. A job whose supervisor is gone without having written its end (killed, or the
 * computer restarted) is ended here as failed, and its file says so: no one is handed the id of a dead job as running.
 */
export function refreshJob(job) {
  if (job.endedAt && job.final) return job;
  const s = readState(job.stateFile);
  if (!s) return job;
  Object.assign(job, { id: s.id, label: s.label, root: s.root, args: s.args, json: s.json, startedAt: s.startedAt, log: s.log, steps: s.steps, feed: s.feed ?? null, endsWithServer: Boolean(s.endsWithServer) });
  job.pid = s.pid ?? job.pid ?? null;
  if (s.endedAt) {
    Object.assign(job, { endedAt: s.endedAt, code: s.code, result: s.result ?? null, why: s.why ?? null, final: true });
    return job;
  }
  if (!job.child && job.pid && !alive(job.pid)) {
    s.code = 1;
    s.why = 'the job\'s process ended without finishing (it was stopped, or the computer restarted)';
    s.endedAt = new Date().toISOString();
    for (const st of s.steps) if (st.startedAt && !st.endedAt) { st.endedAt = s.endedAt; st.code = 1; try { appendFileSync(st.err, `\n${s.why}\n`); } catch { /* read-only */ } }
    try { writeState(job.stateFile, s); } catch { /* the view below still says it */ }
    Object.assign(job, { endedAt: s.endedAt, code: s.code, result: null, why: s.why, steps: s.steps, final: true });
  }
  return job;
}

/**
 * Start one job for a studio: one command, or `steps` run in order ([{ label, cmd, args, json, soft }]; a step that
 * fails ends the job unless it is soft). It runs under lib/job-runner.mjs, detached, so it outlives this MCP server;
 * its state is .studio/mcp/<job>.json, which any later server reads (getJob). `json`: the command prints a JSON result
 * on stdout (homie-studio --json), kept as job.result. `onEnd(job)` runs once when it ends, if this process is still
 * here then. `feed`: { build, title }, the progress feed the supervisor ends with the job. `endsWithServer`: stopped
 * when this server ends (stopAllJobs) instead.
 */
export function startJob({ root, label, cmd, args, env = toolEnv(), json = false, onEnd = null, endsWithServer = false, steps = null, feed = null }) {
  const id = `j_${randomBytes(6).toString('hex')}`;
  const dir = join(root, '.studio', 'mcp');
  mkdirSync(dir, { recursive: true });
  const base = join(dir, id);
  const log = `${base}.log`;
  const list = (steps ?? [{ label, cmd, args, json }]).map((st, n, all) => {
    const name = all.length > 1 ? `${base}.${n}` : base;
    return { label: st.label ?? label, cmd: st.cmd ?? cmd, args: st.args, json: Boolean(st.json), soft: Boolean(st.soft), out: `${name}.out`, err: `${name}.err`, startedAt: null, endedAt: null, code: null, result: null };
  });
  appendFileSync(log, list.map((st) => `$ ${[st.cmd, ...st.args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`).join(''));
  const stateFile = `${base}.json`;
  const startedAt = new Date().toISOString();
  writeState(stateFile, { v: 1, id, label, root, args: list[0].args, json: Boolean(list.at(-1).json), startedAt, endedAt: null, code: null, result: null, pid: null, log, steps: list, feed, endsWithServer });
  const node = runnerNode(env);
  const child = spawn(node.bin, [RUNNER, stateFile], { cwd: root, env: node.env, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();
  const job = jobFrom(stateFile, { child, onEnd, pid: child.pid ?? null });
  jobs.set(id, job);
  let finish;
  job.done = new Promise((r) => { finish = r; });
  const end = (code) => {
    if (job.final) { finishOnce(); return; }
    job.child = null;
    refreshJob(job);
    if (!job.endedAt) Object.assign(job, { endedAt: new Date().toISOString(), code: code === 0 ? 1 : code ?? 1, result: null, final: true });
    finishOnce();
  };
  let finished = false;
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    job.child = null;
    try { onEnd?.(job); } catch { /* the job's own result stands */ }
    finish(job);
  };
  child.on('error', (error) => { for (const st of job.steps) try { appendFileSync(st.err, `\n${error.message}`); } catch { /* keep going */ } end(127); });
  child.on('close', (code) => end(code));
  return job;
}

/** Each step of a job that has started, as a job of its own (what a build card lists); its `done` is the job's. */
export function stepJobs(job) {
  refreshJob(job);
  return (job.steps ?? []).filter((s) => s.startedAt).map((s) => {
    const step = { id: job.id, label: s.label, root: job.root, args: s.args, startedAt: s.startedAt, endedAt: s.endedAt ?? (job.endedAt && !s.endedAt ? job.endedAt : null), code: s.code ?? (job.endedAt ? job.code : null), result: s.result ?? null, json: s.json, log: job.log, steps: [s], done: job.done };
    Object.defineProperty(step, 'out', { enumerable: true, get: () => (s.json ? '' : tailOf(s.out)) });
    Object.defineProperty(step, 'err', { enumerable: true, get: () => tailOf(s.err) });
    return step;
  });
}

/** A job by its id: this server's, else one an earlier server started in one of `roots` (its .studio/mcp). */
export function getJob(id, { roots = [] } = {}) {
  const key = String(id ?? '');
  const known = jobs.get(key);
  if (known) return refreshJob(known);
  if (!JOB_ID.test(key)) return null;
  for (const root of new Set(roots.filter(Boolean))) {
    const file = join(root, '.studio', 'mcp', `${key}.json`);
    if (!existsSync(file)) continue;
    const job = jobFrom(file);
    if (!job.id) continue;
    jobs.set(key, job);
    return job;
  }
  return null;
}

/** The jobs still running: this server's, and (for a studio) any an earlier server started there. */
export function runningJobs(root) {
  if (root) {
    let names = [];
    try { names = readdirSync(join(root, '.studio', 'mcp')).filter((n) => /^j_[a-f0-9]{12}\.json$/.test(n)); } catch { /* none yet */ }
    for (const n of names) getJob(n.slice(0, -5), { roots: [root] });
  }
  return [...jobs.values()].map(refreshJob).filter((j) => !j.endedAt && (!root || j.root === root));
}

/** Wait for a job at most `ms`; true when it ended. */
export async function waitJob(job, ms) {
  const until = Date.now() + ms;
  refreshJob(job);
  while (!job.endedAt && Date.now() < until) {
    let t;
    await Promise.race([...(job.done ? [job.done] : []), new Promise((r) => { t = setTimeout(r, Math.max(1, Math.min(500, until - Date.now()))); })]);
    clearTimeout(t);
    refreshJob(job);
  }
  return Boolean(job.endedAt);
}

/** What a person (and the model) is told about a job. */
export function jobView(job, { lines = 12 } = {}) {
  const text = `${job.err}\n${job.json ? '' : job.out}`.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return {
    job: job.id, label: job.label, state: !job.endedAt ? 'running' : job.code === 0 ? 'done' : 'failed', code: job.code,
    startedAt: job.startedAt, endedAt: job.endedAt,
    seconds: Math.round(((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000),
    tail: text.slice(-lines), log: job.log, result: job.result,
    events: job.err.split('\n').filter(line=>line.startsWith('HOMIE_EVENT ')).flatMap(line=>{try{return [JSON.parse(line.slice(12))];}catch{return [];}}),
  };
}

/** Run the studio's pinned CLI as a job: `homie-studio <args> --json`. */
export function cliJob(root, label, args, { cli = null, ...opts } = {}) {
  const node = findNode();
  if (!node) throw new Error('Node.js is missing. AI: call setup_prepare, then retry this tool.');
  // `cli`: another homie-studio than the studio's pinned one (this package's, for an upgrade to it).
  return startJob({ root, label, cmd: node.bin, args: [cli ?? cliOf(root), ...args, '--json'], json: true, ...opts });
}

/** Windows command shims need a shell; run npm's JavaScript with Node instead. */
export function npmInvocation(node, platform = process.platform) {
  return platform === 'win32'
    ? { cmd: node.bin, args: [join(dirname(node.npm), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'install', '--no-audit', '--no-fund'] }
    : { cmd: node.npm, args: ['install', '--no-audit', '--no-fund'] };
}

/** `npm install` in a studio (its pinned toolkit and Wrangler). */
export function installJob(root, opts = {}) {
  const node = findNode();
  if (!node?.npm) throw new Error('npm is missing. AI: call setup_prepare, then retry studio_install.');
  return startJob({ root, label: 'npm install (the studio\'s pinned toolkit and Wrangler)', ...npmInvocation(node), ...opts });
}

/**
 * When the server ends (the app quit, or a host's one-call server is done): the jobs it started go on (each under its
 * own supervisor, lib/job-runner.mjs) and the next server reads them; only one that asked (endsWithServer) is stopped,
 * with everything it started (its process group).
 */
export function stopAllJobs() {
  for (const job of jobs.values()) {
    if (job.endedAt || !job.endsWithServer || !alive(job.pid)) continue;
    try { process.kill(WIN ? job.pid : -job.pid, 'SIGTERM'); } catch { try { process.kill(job.pid, 'SIGTERM'); } catch { /* gone */ } }
  }
}
