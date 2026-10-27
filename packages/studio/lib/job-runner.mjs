/**
 * THE PROCESS A JOB RUNS IN (lib/jobs.mjs starts it): a small supervisor, detached from the MCP server that started
 * it (its own process group on macOS and Linux), so a job outlives that server. A host may run the server once per
 * tool call, and the desktop app's server ends when the app quits; a check, a deploy, an npm install or the site
 * here goes on either way, and the next server reads how it went.
 *
 * Its whole state is one file, .studio/mcp/<job>.json: what it runs, the supervisor's pid, each step's start, end,
 * exit code and JSON result, and the job's own end. Each step's output goes to files beside it (<job>[.<n>].out and
 * .err) and to <job>.log. The file is replaced whole (written aside, then renamed), so a reader never sees half.
 *
 * Steps run in order; a step that fails ends the job unless it is soft. With `feed`, the build's progress feed is
 * ended when the job ends (what the MCP server would do), so a build card never stays "running" after its job.
 *
 * Usage: node job-runner.mjs <state file>. Nothing here ever runs a shell (a Windows .cmd shim aside).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
export const MAX_OUT = 4 * 1024 * 1024;

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

export function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeState(file, state) {
  const aside = `${file}.${process.pid}.tmp`;
  writeFileSync(aside, JSON.stringify(state));
  renameSync(aside, file);
}

/** The last `bytes` of a file ('' when it is not there). */
export function tailOf(file, bytes = 64 * 1024) {
  if (!file) return '';
  let fd;
  try {
    const size = statSync(file).size;
    const n = Math.min(size, bytes);
    if (!n) return '';
    const buf = Buffer.alloc(n);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
}

/** A step's own words when it failed: its `why`, else its last lines, else its exit code. */
export function stepWhy(step, { lines = 6 } = {}) {
  if (step?.result?.why) return step.result.why;
  const text = `${tailOf(step?.err, 16 * 1024)}\n${step?.json ? '' : tailOf(step?.out, 16 * 1024)}`.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return text.slice(-lines).join('\n') || `exited with ${step?.code}`;
}

/** End a build's progress feed the way the MCP server does: pending stages skipped, then its end (once). */
export function endFeed(Feed, root, build, state, note) {
  try {
    const feed = new Feed(root, build);
    const doc = feed.doc;
    if (!doc || doc.state !== 'running') return;
    feed.change((d) => { for (const s of d.stages) if (s.state === 'pending') s.state = 'skipped'; });
    feed.end(state, note);
  } catch { /* the feed stays as it was */ }
}

async function supervise(file) {
  const state = readState(file);
  if (!state) process.exit(2);
  state.pid = process.pid;
  writeState(file, state);
  let child = null;
  let stopped = false;
  const log = (d) => { try { appendFileSync(state.log, d); } catch { /* full disk: keep going */ } };
  const stop = (signal) => {
    if (stopped) return;
    stopped = true;
    try { child?.kill(signal); } catch { /* gone */ }
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
  if (!WIN) process.on('SIGHUP', () => { /* the terminal or server that started it went away: carry on */ });
  let failed = null;
  for (const step of state.steps) {
    if (stopped) break;
    step.startedAt = new Date().toISOString();
    writeState(file, state);
    const code = await new Promise((done) => {
      let outBytes = 0;
      try {
        child = spawn(step.cmd, step.args, { cwd: state.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: WIN && /\.cmd$/i.test(step.cmd) });
      } catch (error) { appendFileSync(step.err, `\n${error.message}`); done(127); return; }
      child.stdout.on('data', (d) => { if (outBytes < MAX_OUT) { outBytes += d.length; try { appendFileSync(step.out, d); } catch { /* keep going */ } } log(d); });
      child.stderr.on('data', (d) => { try { appendFileSync(step.err, d); } catch { /* keep going */ } log(d); });
      let ended = false;
      const end = (c) => { if (!ended) { ended = true; done(c); } };
      child.on('error', (error) => { try { appendFileSync(step.err, `\n${error.message}`); } catch { /* keep going */ } end(127); });
      child.on('close', (c, signal) => end(c ?? (signal ? 128 + 15 : 1)));
    });
    child = null;
    step.code = code;
    step.endedAt = new Date().toISOString();
    if (step.json) step.result = lastJson(existsSync(step.out) ? readFileSync(step.out, 'utf8') : '');
    writeState(file, state);
    if (code !== 0 && !step.soft) { failed = step; break; }
  }
  const ran = state.steps.filter((s) => s.endedAt);
  const last = failed ?? ran.at(-1) ?? null;
  state.code = stopped ? 143 : failed ? failed.code : 0;
  state.result = last?.result ?? null;
  state.stopped = stopped || undefined;
  state.why = stopped ? 'it was stopped' : failed ? `${state.steps.length > 1 ? `${failed.label}: ` : ''}${stepWhy(failed)}` : null;
  state.endedAt = new Date().toISOString();
  writeState(file, state);
  if (state.feed?.build) {
    const { Feed } = await import('./progress.mjs');
    endFeed(Feed, state.root, state.feed.build, stopped ? 'stopped' : failed ? 'failed' : 'passed', stopped ? `${state.feed.title ?? state.label}: stopped.` : failed ? state.why : `${state.feed.title ?? state.label}: done.`);
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await supervise(process.argv[2]);
