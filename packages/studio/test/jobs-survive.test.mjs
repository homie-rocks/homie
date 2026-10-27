/**
 * A job outlives the MCP server that started it (lib/jobs.mjs, lib/job-runner.mjs): a host may run the server once
 * per tool call, so the server that hands out a job id is gone before anyone asks about it. The job goes on under its
 * own detached supervisor, its state in .studio/mcp/<job>.json, and the next server reads it. A job whose process is
 * gone without an end is never told as running.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JOB_KEPT_MS, alive, getJob, jobAlive, jobView, pruneJobs, runningJobs, startJob, stepJobs, stopAllJobs, waitJob } from '../lib/jobs.mjs';
import { endFeed } from '../lib/job-runner.mjs';

const JOBS = fileURLToPath(new URL('../lib/jobs.mjs', import.meta.url));
const NODE = process.execPath;
const studio = () => realpathSync(mkdtempSync(join(tmpdir(), 'homie-jobs-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const script = (code) => ['-e', code];

/** A one-call server: start a job, print its id, end the way lib/mcp.mjs does (stopAllJobs), and exit. */
function oneCallServer(root, spec) {
  const code = `import { startJob, stopAllJobs } from ${JSON.stringify(JOBS)};
const spec = ${JSON.stringify(spec)};
const job = startJob({ root: ${JSON.stringify(root)}, ...spec });
process.stdout.write(JSON.stringify({ id: job.id, pid: job.pid }) + '\\n');
stopAllJobs();`;
  const started = Date.now();
  const r = spawnSync(NODE, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  return { ...JSON.parse(r.stdout.trim().split('\n').at(-1)), ms: Date.now() - started };
}

/** Another server's view of a job: a fresh process that reads it by id. */
function lookup(root, id) {
  const code = `import { getJob, jobView } from ${JSON.stringify(JOBS)};
const job = getJob(${JSON.stringify(id)}, { roots: [${JSON.stringify(root)}] });
process.stdout.write(JSON.stringify(job ? jobView(job) : null));`;
  const r = spawnSync(NODE, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('a job goes on after the server that started it exits, and a later server reads its result', async () => {
  const root = studio();
  try {
    const { id, ms } = oneCallServer(root, { label: 'slow json', cmd: NODE, args: script('setTimeout(() => console.log(JSON.stringify({ ok: true, command: "slow", n: 7 })), 2000)'), json: true });
    // The server did not wait for the job (nor kill it) before exiting.
    assert.ok(ms < 2000, `the server took ${ms} ms to exit`);
    const during = lookup(root, id);
    assert.equal(during.state, 'running');
    assert.equal(during.job, id);
    const job = getJob(id, { roots: [root] });
    assert.ok(await waitJob(job, 15_000), 'the job ended');
    const v = jobView(job);
    assert.equal(v.state, 'done');
    assert.equal(v.code, 0);
    assert.deepEqual(v.result, { ok: true, command: 'slow', n: 7 });
    assert.equal(lookup(root, id).state, 'done');
    assert.match(readFileSync(v.log, 'utf8'), /"n":7/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a job whose process died without an end is told as failed, never running, and its file says so', async () => {
  const root = studio();
  try {
    const { id, pid } = oneCallServer(root, { label: 'long', cmd: NODE, args: script('setTimeout(() => {}, 60_000)') });
    assert.equal(lookup(root, id).state, 'running');
    // The supervisor and its command go (a restart, a kill -9): nothing writes the job's end.
    process.kill(-pid, 'SIGKILL');
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
    const v = lookup(root, id);
    assert.equal(v.state, 'failed');
    assert.match(v.tail.join('\n'), /ended without finishing/);
    const state = JSON.parse(readFileSync(join(root, '.studio', 'mcp', `${id}.json`), 'utf8'));
    assert.ok(state.endedAt);
    assert.equal(state.code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('in the server that started it, a job killed from outside ends at once: waitJob does not hand back a dead job as running', async () => {
  const root = studio();
  try {
    const job = startJob({ root, label: 'killed', cmd: NODE, args: script('setTimeout(() => {}, 60_000)') });
    for (let i = 0; i < 50 && !JSON.parse(readFileSync(job.stateFile, 'utf8')).steps[0].startedAt; i++) await sleep(100);
    process.kill(-job.pid, 'SIGKILL');
    const started = Date.now();
    assert.ok(await waitJob(job, 10_000));
    assert.ok(Date.now() - started < 5000);
    assert.equal(jobView(job).state, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('steps run in order under one supervisor: a soft step that fails goes on, a hard one ends the job with its words', async () => {
  const root = studio();
  try {
    const say = (o) => script(`console.log(JSON.stringify(${JSON.stringify(o)}))`);
    const job = startJob({ root, label: 'run', cmd: NODE, json: true, steps: [
      { label: 'one', args: say({ ok: true, step: 1 }), json: true },
      { label: 'soft', args: script('console.error("soft trouble"); process.exit(3)'), soft: true, json: true },
      { label: 'hard', args: script('console.log(JSON.stringify({ ok: false, why: "the round never ended" })); process.exit(1)'), json: true },
      { label: 'never', args: say({ ok: true }), json: true },
    ] });
    let ended = null;
    job.onEnd = null;
    assert.ok(await waitJob(job, 20_000));
    ended = stepJobs(job);
    assert.deepEqual(ended.map((j) => [j.label, j.code]), [['one', 0], ['soft', 3], ['hard', 1]]);
    assert.deepEqual(ended[0].result, { ok: true, step: 1 });
    assert.match(ended[1].err, /soft trouble/);
    assert.equal(job.code, 1);
    assert.equal(job.why, 'hard: the round never ended');
    assert.deepEqual(job.result, { ok: false, why: 'the round never ended' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('onEnd still runs in the server that is there when the job ends', async () => {
  const root = studio();
  try {
    let seen = null;
    const job = startJob({ root, label: 'quick', cmd: NODE, args: script('console.log("hi")'), onEnd: (j) => { seen = j.code; } });
    assert.ok(await waitJob(job, 10_000));
    assert.equal(seen, 0);
    assert.match(job.out, /hi/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a later server sees an earlier one\'s running job in a studio (one npm install, not two), and ids are only ids', async () => {
  const root = studio();
  try {
    const { id } = oneCallServer(root, { label: 'npm install (the studio\'s pinned toolkit and Wrangler)', cmd: NODE, args: script('setTimeout(() => {}, 3000)') });
    assert.ok(runningJobs(root).some((j) => j.id === id && j.label.startsWith('npm install')));
    assert.equal(getJob('../../etc/passwd', { roots: [root] }), null);
    assert.equal(getJob('j_000000000000', { roots: [root] }), null);
    assert.ok(await waitJob(getJob(id, { roots: [root] }), 15_000));
    assert.ok(!runningJobs(root).some((j) => j.id === id));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only a job that asked to end with the server is stopped when it ends, with what it started', async () => {
  const root = studio();
  try {
    const grandchild = join(root, 'grandchild.pid');
    const job = startJob({ root, label: 'tied', cmd: NODE, endsWithServer: true, args: script(`const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(grandchild)}, String(c.pid)); setTimeout(() => {}, 60_000);`) });
    const free = startJob({ root, label: 'free', cmd: NODE, args: script('setTimeout(() => {}, 60_000)') });
    for (let i = 0; i < 50 && !existsSync(grandchild); i++) await sleep(100);
    const gpid = Number(readFileSync(grandchild, 'utf8'));
    stopAllJobs();
    assert.ok(await waitJob(job, 10_000));
    for (let i = 0; i < 50 && alive(gpid); i++) await sleep(100);
    assert.equal(alive(gpid), false, 'what the job started went with it');
    assert.equal(await waitJob(free, 500), false, 'the other job goes on');
    process.kill(-free.pid, 'SIGTERM');
    assert.ok(await waitJob(free, 10_000));
    assert.equal(free.code, 143);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('endFeed ends a running feed once, pending stages skipped, and leaves an ended one alone', () => {
  const docs = [];
  class Feed {
    constructor(root, build) { this.doc = docs.find((d) => d.build === build) ?? null; }
    change(fn) { fn(this.doc); }
    end(state, note) { this.doc.state = state; this.doc.note = note; }
  }
  docs.push({ build: 'b1', state: 'running', stages: [{ state: 'done' }, { state: 'pending' }] }, { build: 'b2', state: 'passed', stages: [{ state: 'pending' }] });
  endFeed(Feed, '/x', 'b1', 'failed', 'deploy: no');
  endFeed(Feed, '/x', 'b2', 'failed', 'later');
  assert.deepEqual(docs[0], { build: 'b1', state: 'failed', note: 'deploy: no', stages: [{ state: 'done' }, { state: 'skipped' }] });
  assert.equal(docs[1].state, 'passed');
});

test('studio_job answers for a job an earlier server started in a studio', async () => {
  const root = studio();
  try {
    const { toolDefs } = await import('../lib/mcp-tools.mjs');
    const { id } = oneCallServer(root, { label: 'standalone build', cmd: NODE, args: script('setTimeout(() => console.log(JSON.stringify({ ok: true, say: ["Built it."] })), 800)'), json: true });
    const ctx = { current: null, studiosDir: null, studios: () => [{ root }], waitMs: 10_000, runs: new Map(), note: () => ({}) };
    const r = await toolDefs(ctx).find((t) => t.name === 'studio_job').run({ job: id });
    assert.ok(!r.isError, r.content[0].text);
    assert.match(r.content[0].text, /standalone build: done/);
    assert.match(r.content[0].text, /Built it\./);
    const missing = await toolDefs(ctx).find((t) => t.name === 'studio_job').run({ job: 'j_0123456789ab' });
    assert.ok(missing.isError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a run\'s feed is ended by the job itself when the server that started it is gone', async () => {
  const root = studio();
  try {
    const { startProgress, readFeed } = await import('../lib/progress.mjs');
    writeFileSync(join(root, 'studio.json'), JSON.stringify({ name: 'Feed', id: 'feed' }));
    const r = await startProgress(root, { what: 'game', id: null, title: 'Deploy' });
    assert.ok(r.ok, r.why);
    const { id } = oneCallServer(root, { label: 'Deploy', cmd: NODE, json: true, feed: { build: r.build, title: 'Deploy' }, steps: [
      { label: 'deploy', args: script('setTimeout(() => { console.log(JSON.stringify({ ok: false, why: "no route" })); process.exit(1); }, 500)'), json: true },
    ] });
    assert.equal(readFeed(root, r.build).state, 'running');
    assert.ok(await waitJob(getJob(id, { roots: [root] }), 15_000));
    for (let i = 0; i < 50 && readFeed(root, r.build).state === 'running'; i++) await sleep(100);
    const doc = readFeed(root, r.build);
    assert.equal(doc.state, 'failed');
    assert.match(JSON.stringify(doc), /no route/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a job whose pid now belongs to another process is told as failed, not running (the pid was reused)', () => {
  const root = studio();
  try {
    const dir = join(root, '.studio', 'mcp');
    mkdirSync(dir, { recursive: true });
    const id = 'j_00000000beef';
    // This test's own process is alive but is not that job's supervisor.
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ v: 1, id, label: 'reused', root, args: [], startedAt: new Date().toISOString(), endedAt: null, pid: process.pid, log: join(dir, `${id}.log`), steps: [] }));
    if (process.platform !== 'win32') assert.equal(jobAlive(process.pid, id), false);
    const v = lookup(root, id);
    if (process.platform !== 'win32') assert.equal(v.state, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('starting a job removes the files of jobs that ended more than a day ago, and nothing else', async () => {
  const root = studio();
  try {
    const dir = join(root, '.studio', 'mcp');
    mkdirSync(dir, { recursive: true });
    const now = Date.now(), old = new Date(now - JOB_KEPT_MS - 60_000).toISOString(), recent = new Date(now - 60_000).toISOString();
    const put = (id, state, extra = []) => {
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ v: 1, id, label: id, root, args: [], log: join(dir, `${id}.log`), steps: [], ...state }));
      for (const n of [`${id}.log`, ...extra]) writeFileSync(join(dir, n), 'x');
    };
    put('j_0000000000a1', { startedAt: old, endedAt: old, code: 0 }, ['j_0000000000a1.0.out', 'j_0000000000a1.0.err']);
    put('j_0000000000a2', { startedAt: old, endedAt: recent, code: 0 });
    put('j_0000000000a3', { startedAt: old, endedAt: null, pid: 2 ** 22 + 12345 });
    writeFileSync(join(dir, 'j_0000000000a4.log'), 'an older toolkit\'s log');
    utimesSync(join(dir, 'j_0000000000a4.log'), new Date(now - JOB_KEPT_MS - 60_000), new Date(now - JOB_KEPT_MS - 60_000));
    writeFileSync(join(dir, 'j_0000000000a5.log'), 'a fresh one');
    writeFileSync(join(dir, 'notes.txt'), 'not a job');
    const job = startJob({ root, label: 'new', cmd: NODE, args: script('console.log("hi")') });
    assert.ok(await waitJob(job, 10_000));
    const left = readdirSync(dir).filter((n) => !n.startsWith(job.id)).sort();
    assert.deepEqual(left, ['j_0000000000a2.json', 'j_0000000000a2.log', 'j_0000000000a5.log', 'notes.txt']);
    assert.equal(pruneJobs(dir), 0, 'the new job is kept');
    assert.ok(existsSync(job.stateFile));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
