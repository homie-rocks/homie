#!/usr/bin/env node
/** Public-room load probe. Two real Chrome players plus N simulated; no private admission route. */
import { Worker } from 'node:worker_threads';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import puppeteer from 'puppeteer-core';
import { Histogram } from './crowd-worker.mjs';
const opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--'))
    throw Error('Use --key value');
  opts[args[i].slice(2)] = args[++i];
}
for (const k of Object.keys(opts))
  if (
    ![
      'url',
      'n',
      'total',
      'seconds',
      'room',
      'out',
      'ramp-ms',
      'chrome',
      'rss-mb',
      'workers',
      'churn',
      'churn-at',
      'compress',
      'strict-chrome'
    ].includes(k)
  )
    throw Error('Unknown option --' + k);
const origin = new URL(opts.url ?? 'http://127.0.0.1:8787').origin,
  game = 'crowd-circuit',
  total =
    opts.total === undefined ? Number(opts.n ?? 50) + 2 : Number(opts.total),
  n = total - 2,
  seconds = Number(opts.seconds ?? 150),
  rampMs = Number(opts['ramp-ms'] ?? 50),
  workerCount = Number(opts.workers ?? 4),
  rssLimit = Number(opts['rss-mb'] ?? 1024);
if (opts.n !== undefined && opts.total !== undefined)
  throw Error('Use --n (simulated) or --total (including Chrome), not both');
if (
  !Number.isInteger(total) ||
  total < 3 ||
  total > 1000 ||
  !Number.isInteger(workerCount) ||
  workerCount < 1 ||
  workerCount > 16 ||
  !Number.isFinite(seconds) ||
  seconds < 1 ||
  seconds > 3600 ||
  !Number.isFinite(rampMs) ||
  rampMs < 10 ||
  !Number.isFinite(rssLimit) ||
  rssLimit < 128
)
  throw Error(
    'n 1..998 simulated or total 3..1000 including Chrome, workers 1..16, seconds 1..3600, ramp-ms >=10, rss-mb >=128'
  );
if (
  opts.churn !== undefined &&
  (!Number.isInteger(Number(opts.churn)) ||
    Number(opts.churn) < 0 ||
    Number(opts.churn) > n)
)
  throw Error('churn must be an integer from 0 to n');
if (
  opts['churn-at'] !== undefined &&
  (!Number.isFinite(Number(opts['churn-at'])) || Number(opts['churn-at']) < 0)
)
  throw Error('churn-at must be a nonnegative number of seconds');
const simulated = n,
  room = opts.room ?? `load-${n}-${Date.now().toString(36)}`,
  out = resolve(opts.out ?? `reports/crowd-circuit/${room}`);
if (!/^[A-Za-z0-9_-]{1,32}$/.test(room)) throw Error('Invalid room');
await mkdir(out, { recursive: true });
const sources = {};
for (const name of ['crowd-load.mjs', 'crowd-worker.mjs']) {
  const data = await readFile(new URL(name, import.meta.url));
  await writeFile(`${out}/${name}`, data);
  sources[name] = createHash('sha256').update(data).digest('hex');
}
const started = new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browsers = [],
  profiles = [],
  windows = [],
  samples = [],
  errors = new Map(),
  workers = [];
let stopReason = null,
  chromeTrouble = 0,
  measureStart = 0,
  measureEnd = 0,
  maxRss = 0,
  manifest = null,
  finals = [];
const memoryGuard = setInterval(() => {
  maxRss = Math.max(maxRss, process.memoryUsage.rss() / 1048576);
  if (maxRss > rssLimit) stop('driver RSS exceeded ' + rssLimit + ' MiB');
}, 200);
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
function problem(type, text) {
  const key = `${type}: ${String(text).slice(0, 500)}`;
  errors.set(key, (errors.get(key) ?? 0) + 1);
  if (errors.get(key) === 1)
    console.error(JSON.stringify({ phase: 'error', text: key }));
}
function stop(reason) {
  stopReason ??= reason;
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
function makeWorker(index) {
  const thread = new Worker(new URL('./crowd-worker.mjs', import.meta.url), {
    workerData: {
      origin,
      game,
      room,
      index,
      workers: workerCount,
      compress: opts.compress !== 'off'
    }
  });
  let sequence = 0;
  let failure = null;
  const pending = new Map();
  function fail(e) {
    failure = e;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    pending.clear();
  }
  thread.on('message', (m) => {
    if (m.event) {
      problem('worker' + index, m.text);
      return;
    }
    const p = pending.get(m.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error)) : p.resolve(m.value);
    }
  });
  thread.on('error', (e) => {
    fail(e);
    stop('driver worker failed');
    problem('worker', e.message);
  });
  thread.on('exit', (code) => fail(Error(`worker ${index} exited (${code})`)));
  return {
    thread,
    call(op, ...args) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++sequence,
          timer = setTimeout(() => {
            pending.delete(id);
            reject(Error(`worker ${index} ${op} timeout`));
          }, 180000);
        pending.set(id, { resolve, reject, timer });
        thread.postMessage({ id, op, args });
      });
    }
  };
}
async function chromeWindow(i) {
  const profile = await mkdtemp(`${tmpdir()}/crowd-load-`);
  profiles.push(profile);
  const browser = await puppeteer.launch({
    executablePath:
      opts.chrome ??
      process.env.CHROME_PATH ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    userDataDir: profile,
    defaultViewport: { width: 1000, height: 760 },
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--window-position=${i * 550},${i * 80}`,
      '--window-size=1020,840'
    ]
  });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setUserAgent(`${await browser.userAgent()} HomieCheck crowd-load`);
  await page.evaluateOnNewDocument(() => {
    const Native = window.WebSocket;
    window.__crowdSockets = [];
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        const path = new URL(String(args[0]), location.href).pathname;
        const record = (event) => {
          window.__crowdSockets.push({ at: Date.now(), path, ...event });
          if (window.__crowdSockets.length > 100) window.__crowdSockets.shift();
        };
        this.addEventListener('open', () => record({ type: 'open' }));
        this.addEventListener('close', (e) =>
          record({
            type: 'close',
            code: e.code,
            reason: e.reason,
            clean: e.wasClean
          })
        );
        this.addEventListener('error', () => record({ type: 'error' }));
      }
      close(code, reason) {
        const path = new URL(this.url).pathname;
        window.__crowdSockets.push({
          at: Date.now(),
          type: 'client-close',
          path,
          code,
          reason
        });
        super.close(code, reason);
      }
    };
  });
  page.on('pageerror', (e) => problem(`chrome${i}`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problem(`chrome${i}`, m.text());
  });
  await page.goto(`${origin}/${game}/play?room=${room}&name=Chrome-${i + 1}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page
    .waitForFunction(
      () =>
        window.__shell?.seat !== null &&
        window.__shell?.stats?.role === 'replica' &&
        window.__shell?.arrival?.phase === 'done',
      { timeout: 60000 }
    )
    .catch(async () => {
      await page.waitForFunction(
        () =>
          window.__shell?.stats?.role === 'replica' &&
          typeof window.__shell?.seat === 'number',
        { timeout: 15000 }
      );
    });
  const frame = page.frames().find((f) => f.url().includes('/__game/'));
  if (frame) await frame.click('canvas');
  windows.push({ page, i, frame });
  return page;
}
async function browserFacts(w) {
  return w.page.evaluate(() => {
    const s = window.__shell;
    return {
      room: s?.room,
      seat: s?.seat,
      stats: s?.stats,
      arrival: s?.arrival,
      facts: {
        toolkit: s?.facts?.toolkit,
        transport: s?.facts?.transport,
        gates: s?.facts?.gates,
        counts: s?.facts?.counts,
        hosted: s?.facts?.hosted,
        ticks: s?.facts?.ticks,
        stats: s?.facts?.stats
      },
      results: s?.results?.map((r) => ({
        n: r.n,
        at: r.at,
        own: r.results?.find((p) => p.seat === s.seat)
      }))
    };
  });
}
async function sample(phase) {
  const states = await Promise.all(workers.map((w) => w.call('summary'))),
    facts = await Promise.all(windows.map(browserFacts));
  for (const s of states) if (s.stopReason) stop(s.stopReason);
  if (new Set(states.map((s) => s.epoch).filter((e) => e !== null)).size > 1)
    stop('workers observed different room epochs');
  const rss = process.memoryUsage().rss / 1048576;
  maxRss = Math.max(maxRss, rss);
  if (rss > rssLimit) stop('driver RSS exceeded ' + rssLimit + ' MiB');
  for (const [i, f] of facts.entries())
    if (
      f.room !== room ||
      f.stats?.role !== 'replica' ||
      !f.stats?.connected ||
      f.stats?.offline ||
      f.stats?.reconnects > 0 ||
      typeof f.seat !== 'number'
    ) {
      problem(
        'browser membership',
        JSON.stringify({ i, room: f.room, seat: f.seat, stats: f.stats })
      );
      chromeTrouble++;
      // A real browser on a busy computer losing its link is a finding, and
      // no reason to throw away what a thousand other players measured:
      // the step runs on unless it was asked to stop (--strict-chrome 1).
      if (opts['strict-chrome'] === '1')
        stop('Chrome membership failed or its link reconnected');
    }
  const s = {
    phase,
    seconds: measureStart ? (performance.now() - measureStart) / 1000 : null,
    connected: states.reduce((a, s) => a + s.connected, 0),
    firstState: states.reduce((a, s) => a + s.joined, 0),
    freshState: states.reduce((a, s) => a + s.fresh, 0),
    rssMiB: rss,
    coordinatorLoopP99Ms: loop.percentile(99) / 1e6,
    workers: states,
    browsers: facts
  };
  samples.push(s);
  console.log(
    JSON.stringify({
      ...s,
      browsers: facts.map((f) => ({
        room: f.room,
        seat: f.seat,
        connected: f.stats?.connected,
        reconnects: f.stats?.reconnects
      })),
      workers: states.map((s) => ({
        worker: s.worker,
        loopP99Ms: s.loopP99Ms,
        peakTimerLagMs: s.peakTimerLagMs
      }))
    })
  );
  return s;
}
try {
  try {
    const res = await fetch(
      `${origin}/.well-known/homie-studio.json?probe=${Date.now()}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) manifest = await res.json();
  } catch (e) {
    problem('manifest', e.message);
  }
  await writeFile(`${out}/deployment.json`, JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify({
      phase: 'start',
      origin,
      room,
      n,
      total,
      simulated,
      chromePlayers: 2,
      seconds,
      workerCount,
      toolkit: manifest?.toolkit ?? null,
      manifestStudioVersion: manifest?.studio ?? null,
      sources
    })
  );
  for (let i = 0; i < 2; i++) await chromeWindow(i);
  for (let i = 0; i < workerCount; i++) workers.push(makeWorker(i));
  let ramped = false;
  const ramp = Promise.all(
    workers.map((w) => w.call('ramp', simulated, rampMs))
  ).finally(() => (ramped = true));
  ramp.catch((e) => {
    problem('ramp', e.message);
    stop('ramp failed');
  });
  while (!ramped && !stopReason) {
    await sample('ramp');
    await sleep(2000);
  }
  if (stopReason) await Promise.all(workers.map((w) => w.call('cancelRamp')));
  await ramp;
  const deadline = performance.now() + 30000;
  while (!stopReason) {
    const s = await sample('joining');
    if (s.firstState === simulated || performance.now() > deadline) break;
    await sleep(1000);
  }
  if (!stopReason) {
    await Promise.all(workers.map((w) => w.call('start')));
    measureStart = performance.now();
    let nextShot = measureStart + 5000,
      churned = false,
      keyRight = true;
    while (!stopReason && performance.now() - measureStart < seconds * 1000) {
      await sample('steady');
      for (const w of windows) {
        await w.page.keyboard.up(keyRight ? 'ArrowLeft' : 'ArrowRight');
        await w.page.keyboard.down(keyRight ? 'ArrowRight' : 'ArrowLeft');
      }
      keyRight = !keyRight;
      if (performance.now() >= nextShot) {
        for (const w of windows)
          await w.page.screenshot({ path: `${out}/chrome-${w.i + 1}.png` });
        nextShot = Infinity;
      }
      if (
        opts.churn &&
        !churned &&
        performance.now() - measureStart > Number(opts['churn-at'] ?? 60) * 1000
      ) {
        churned = true;
        await Promise.all(
          workers.map((w) => w.call('churn', Number(opts.churn)))
        );
      }
      await sleep(
        Math.min(
          5000,
          Math.max(0, seconds * 1000 - (performance.now() - measureStart))
        )
      );
    }
  }
} catch (e) {
  problem('fatal', e.stack);
  stop('fatal error');
} finally {
  measureEnd = performance.now();
  clearInterval(memoryGuard);
  try {
    await sample('final');
  } catch (e) {
    problem('final', e.message);
  }
  const results = await Promise.allSettled(
    workers.map((w) => w.call('finish'))
  );
  finals = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (finals.length !== workers.length) stop('incomplete worker results');
  for (const w of windows) {
    try {
      await w.page.screenshot({ path: `${out}/chrome-${w.i + 1}-end.png` });
      const socketEvents = await Promise.all(
        w.page.frames().map(async (f) => ({
          url: new URL(f.url()).pathname,
          events: await f.evaluate(() => window.__crowdSockets ?? [])
        }))
      );
      await writeFile(
        `${out}/chrome-${w.i + 1}-sockets.json`,
        JSON.stringify(socketEvents, null, 2)
      );
    } catch (e) {
      problem('browser capture', e.message);
    }
  }
  await Promise.allSettled(workers.map((w) => w.thread.terminate()));
  await Promise.allSettled(browsers.map((b) => b.close()));
  await Promise.allSettled(
    profiles.map((p) => rm(p, { recursive: true, force: true }))
  );
  loop.disable();
  const histograms = {};
  for (const key of ['first', 'welcome', 'ack', 'gaps', 'loops']) {
    const h = new Histogram();
    for (const f of finals) h.merge(f.histograms[key]);
    histograms[key] = h.json();
  }
  const players = finals.flatMap((f) => f.players),
    percentiles = (key) => {
      const a = players
        .filter((p) => !p.retired && Number.isFinite(p[key]))
        .map((p) => p[key])
        .sort((a, b) => a - b);
      return {
        count: a.length,
        p50: a[Math.floor(a.length / 2)] ?? null,
        min: a[0] ?? null,
        median: a[Math.floor(a.length / 2)] ?? null,
        max: a.at(-1) ?? null
      };
    },
    sum = (key) => finals.reduce((a, f) => a + (f[key] ?? 0), 0);
  const report = {
    started,
    measurementStarted: measureStart
      ? new Date(performance.timeOrigin + measureStart).toISOString()
      : null,
    ended: new Date().toISOString(),
    origin,
    room,
    n,
    total,
    simulated,
    chromePlayers: 2,
    toolkit: manifest?.toolkit ?? null,
    manifestStudioVersion: manifest?.studio ?? null,
    sources,
    requestedSeconds: seconds,
    measuredSeconds: measureStart ? (measureEnd - measureStart) / 1000 : 0,
    stopReason,
    joined: sum('joined'),
    connectedAtEnd: sum('connected'),
    disconnects: sum('disconnects'),
    firstStateMs: histograms.first,
    welcomeMs: histograms.welcome,
    inputAckMs: histograms.ack,
    receiveGapMs: histograms.gaps,
    inputLoopMs: histograms.loops,
    ackSkipped: sum('ackSkipped'),
    ackExpired: sum('ackExpired'),
    tickHz: percentiles('tickHz'),
    deliveredHz: percentiles('deliveredHz'),
    tickHzMedian: percentiles('tickHz').median,
    deliveredHzMedian: percentiles('deliveredHz').median,
    lifetime: {
      upBytes: sum('totalUp'),
      downBytes: sum('totalDown'),
      peakSampledConnected: Math.max(0, ...samples.map((s) => s.connected))
    },
    payload: {
      upBytes: sum('upBytes'),
      downBytes: sum('downBytes'),
      inputFrames: sum('inputFrames'),
      upFrames: sum('upFrames'),
      downFrames: sum('downFrames'),
      // What the uplink carried: compare with the link's measured capacity.
      wireDownBytes: sum('wireDownBytes'),
      compressedSockets: sum('compressed')
    },
    // Samples in which a Chrome player was not a connected replica of this room.
    chromeTrouble,
    // Whether the server agreed to permessage-deflate on these sockets, as a
    // browser's would be, and what it saved: decoded bytes over wire bytes.
    compression: {
      offered: opts.compress !== 'off',
      sockets: sum('compressed'),
      of: sum('attempted'),
      ratio:
        sum('wireDownBytes') > 0
          ? Math.round((sum('downBytes') / sum('wireDownBytes')) * 100) / 100
          : null
    },
    // The whole ticks ahead each player stamps its input (it starts at 3 and
    // follows what the room reports, as the toolkit's client does), and the
    // share of the room's reports that said an input missed its tick.
    inputLead: (() => {
      const a = finals.flatMap((f) => f.leadTicks ?? []).sort((x, y) => x - y);
      const reports = sum('inputReports');
      return {
        ticksMedian: a[Math.floor(a.length / 2)] ?? null,
        ticksMax: a.at(-1) ?? null,
        lateShare: reports ? Math.round((sum('inputReportsLate') / reports) * 1000) / 1000 : null
      };
    })(),
    driver: {
      workers: workerCount,
      maxRssMiB: maxRss,
      coordinatorLoopP99Ms: loop.percentile(99) / 1e6,
      workerLoopP99Ms: finals.map((f) => f.loopP99Ms),
      peakTimerLagMs: finals.map((f) => f.peakTimerLagMs)
    },
    errors: [...errors].map(([text, count]) => ({ text, count })),
    workerErrors: finals.map((f) => f.errors),
    players,
    samples,
    notes: [
      'N simulated players plus two Chrome players; --total includes Chrome and prevents exceeding capacity.',
      'Every received snapshot is fully decoded in a worker thread. No frame sampling or per-frame re-serialization.',
      'Input ack includes three-tick lead. Tick progression and delivered frame cadence are separate metrics.',
      'Clients stop input after two seconds without own state; freshness exposes reduced offered load.',
      'Cloudflare synchronous stage duration may be unavailable; never interpreted as zero CPU.'
    ]
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({ ...report, players: undefined, samples: undefined })
  );
  process.exitCode =
    stopReason ||
    report.joined !== simulated ||
    report.connectedAtEnd !== simulated ||
    report.disconnects ||
    errors.size
      ? 1
      : 0;
}
// Owned workers, sockets, Chrome and files are settled; imported browser libraries may retain timers.
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(process.exitCode ?? 0);
