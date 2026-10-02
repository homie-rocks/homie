/**
 * `homie-studio perf <game> --url <site>` — how fast a game runs, measured the same way every time, so a change can be
 * judged against the build before it (`perf compare`, lib/perf-stats.mjs).
 *
 * ONE RUN is two browsers in a fresh room of their own (`?room=perf-…`): the first to arrive is the host (it runs the
 * rules, the bots and the snapshots), the second a replica. Both are the same device:
 *
 *   computer   1280x800 at 2x, this machine's CPU and GPU
 *   phone      390x844 at 3x, touch, a phone's user agent, Chrome's CPU throttle at 4x (`--cpu`) and a 4G connection
 *              (9 Mbit/s down, 85 ms): an EMULATED phone, on this computer's GPU. It ranks changes; it is not a phone's
 *              frame rate. The throttle suspends the page's thread in slices, so it stretches work less than its
 *              rate on a fast computer (on an Apple M4, "4x" measured between 2.4x and 3.8x): each run times the same
 *              loop of arithmetic before and after the throttle and records the real slow-down as `cpuMeasured`.
 *
 * Each browser plays (the same seeded presses every run) through a warm-up and then a measured window, and the run
 * writes, per browser (host and replica):
 *
 *   load     ms from opening the page to the game's first animation frame, to a seat, and to playable (seated with a
 *            body that the game's port probe reports, or seated and drawing when it has none); what the game's own
 *            files weighed on the wire, the biggest first
 *   frames   the time between animation frames: median, 95th and 99th percentile, the worst, and the share of frames
 *            over 33 ms (a dropped frame at 60 Hz, twice) and over 50 ms (a hitch anyone sees)
 *   work     the game's JavaScript inside each animation frame (every requestAnimationFrame callback, timed)
 *   busy     the page's whole main thread per frame (Chrome's TaskDuration: scripts, style, layout, socket messages)
 *   heap     the JavaScript heap after a forced garbage collection, at the start and the end of the window
 *   net      netplay messages and kilobytes a second, each way, on the room's socket, and the helper's own counters
 *
 * `--profile` adds a CPU profile of each browser in a second window (never the measured one: a profiler slows what it
 * watches), as a .cpuprofile (Chrome DevTools opens it) and a summary of the hottest functions, read through the
 * game's source map when the build kept one (`homie-studio build --maps`).
 *
 * LOAD. The computer is shared: before every run the 1-minute load average per core must be under `maxLoad` (0.8);
 * it waits up to 3 minutes, and a run taken anyway says `loaded: true` (compare leaves it out). Every run records the
 * load before and after and how busy all the cores were during its window.
 *
 * Software rendering (SwiftShader: a Linux VM, a cloud session) draws a WebGL game at a few frames a second: such a
 * run says `blocked` and compare leaves it out. Nothing here is judged on a software renderer.
 *
 * Results are files (one JSON per run, screenshots, profiles) under `.perf/<game>/<time>/` (git-ignored); the command
 * prints their paths and a few medians, never the data itself.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SOFTWARE_GL, chromeArgs, findChrome, noChrome } from './chrome.mjs';
import { LAUNCH_TIMEOUT_MS } from './check.mjs';
import { judge, judgePaired, round, summarize } from './perf-stats.mjs';
import { readCode } from './perf-code.mjs';
import { sourceMapLookup, summarizeProfile } from './perf-profile.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (p, ms, v = null) => Promise.race([Promise.resolve(p).catch(() => v), new Promise((r) => setTimeout(() => r(v), ms))]);

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export const PERF_DEVICES = {
  computer: {
    label: 'a computer: 1280x800 at 2x, this machine\'s CPU and GPU',
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    cpu: 1,
    network: null,
  },
  phone: {
    label: 'an emulated phone: 390x844 at 3x, touch, Chrome\'s CPU throttle at {cpu}x (each run measures what that really is here: `cpuMeasured`), 4G (9 Mbit/s down, 1.5 up, 85 ms); this computer\'s GPU, so it ranks changes and is not a real phone\'s frame rate',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    cpu: 4,
    network: { offline: false, latency: 85, downloadThroughput: Math.round(9e6 / 8), uploadThroughput: Math.round(1.5e6 / 8) },
    ua: PHONE_UA,
  },
};

/** A device's words, with the phone's CPU slow-down filled in. */
export const deviceLabel = (device, cpu = 4) => PERF_DEVICES[device].label.replace('{cpu}', String(cpu));

/** The metric compare judges when none is named, and the guards that must not get worse. */
export const DEFAULT_GOAL = 'phone.host.frame.p95';

/**
 * Runs in every frame of the page before any of its scripts (Page.addScriptToEvaluateOnNewDocument). In the game's
 * frame it times every requestAnimationFrame callback: the frame's timestamp and the milliseconds its callbacks took,
 * in a ring of 32,768 frames. A game that captured requestAnimationFrame before this ran cannot have: this runs first.
 */
const INSTRUMENT = () => {
  if (window.__perf) return;
  const game = /\/__game(?:\/|$)/.test(location.pathname);
  const N = 32768;
  const ts = new Float64Array(N);
  const work = new Float32Array(N);
  let n = 0;
  let cur = -1;
  let acc = 0;
  let first = null;
  if (game && typeof window.requestAnimationFrame === 'function') {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function requestAnimationFrame(cb) {
      return raf((t) => {
        if (t !== cur) { if (cur >= 0) { ts[n % N] = cur; work[n % N] = acc; n++; } cur = t; acc = 0; if (first === null) first = performance.timeOrigin + t; }
        const s = performance.now();
        try { cb(t); } finally { acc += performance.now() - s; }
      });
    };
  }
  let longN = 0;
  let longMs = 0;
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) { longN++; longMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch { /* no long task timing */ }
  window.__perf = {
    game,
    origin: performance.timeOrigin,
    first: () => first,
    count: () => n,
    take: (from) => { const t = []; const w = []; for (let i = Math.max(from, n - N); i < n; i++) { t.push(ts[i % N]); w.push(work[i % N]); } return { t, w }; },
    long: () => ({ n: longN, ms: longMs }),
  };
};

/** A small seeded random number generator: every run presses the same way. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const gameFrameOf = (page) => page.frames().find((f) => /\/__game(?:\/|\?|$)/.test(f.url())) ?? null;
const inGame = (h, fn, arg) => { const f = gameFrameOf(h.page); return f ? T(f.evaluate(fn, arg), 8000) : Promise.resolve(null); };
const metricsOf = async (cdp) => { const m = await T(cdp.send('Performance.getMetrics'), 8000); return m ? Object.fromEntries(m.metrics.map((x) => [x.name, x.value])) : {}; };

/** The 1-minute load average per core, waiting up to `waitMs` for it to fall under `max`. */
export async function waitCalm({ max = 0.8, waitMs = 180_000, log = () => {} } = {}) {
  const cores = cpus().length;
  const started = Date.now();
  let perCore = loadavg()[0] / cores;
  let said = false;
  while (perCore > max && Date.now() - started < waitMs) {
    if (!said) { log(`waiting for a calmer computer: load ${(perCore * cores).toFixed(1)} on ${cores} cores (under ${(max * cores).toFixed(1)} wanted)`); said = true; }
    await sleep(10_000);
    perCore = loadavg()[0] / cores;
  }
  return { perCore: round(perCore, 2), load1: round(loadavg()[0], 2), cores, waitedMs: Date.now() - started, calm: perCore <= max };
}

/** How busy every core of this computer was between two os.cpus() readings, 0-100. */
function busyBetween(a, b) {
  let idle = 0;
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const ta = a[i].times; const tb = b[i].times;
    const d = (k) => tb[k] - ta[k];
    const all = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    total += all; idle += d('idle');
  }
  return total ? round((1 - idle / total) * 100, 1) : null;
}

/** Open one browser of a run on the play page, instrumented, and wait until it is playable. */
async function openPlayer(puppeteer, chrome, device, playUrl, label, log, cpu) {
  const dev = PERF_DEVICES[device];
  const rate = device === 'phone' ? cpu : dev.cpu;
  const profileDir = mkdtempSync(join(tmpdir(), 'homie-studio-perf-'));
  const vp = dev.viewport;
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true, userDataDir: profileDir, timeout: LAUNCH_TIMEOUT_MS, protocolTimeout: 180_000,
    args: [...chromeArgs(), '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--window-size=${vp.width},${vp.height}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', '--enable-precise-memory-info'],
  });
  const h = { label, device, browser, profileDir, page: null, cdp: null, errors: [], requests: new Map(), sockets: new Map(), ws: { net: { out: 0, in: 0, outBytes: 0, inBytes: 0 }, other: { out: 0, in: 0, outBytes: 0, inBytes: 0 } } };
  try {
    const page = await browser.newPage();
    h.page = page;
    await page.setViewport(vp);
    const ua = dev.ua ?? await browser.userAgent();
    // Tagged as the house's QA, so the studio's own stats never count a perf run as a visitor.
    await page.setUserAgent(`${ua} homie-studio-check homie-studio-perf`);
    page.on('pageerror', (e) => { if (h.errors.length < 30) h.errors.push(String(e?.message ?? e).slice(0, 240)); });
    const cdp = await page.createCDPSession();
    h.cdp = cdp;
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    if (rate > 1) {
      // What the slow-down really is on this computer: the same loop of arithmetic before and after (Chrome's throttle
      // suspends the page's thread in slices, so a "4x" can stretch work less than 4 times on a fast machine).
      const loop = () => page.evaluate(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 4e6; i++) x += Math.sqrt(i); return [performance.now() - t, x > 0]; }).then(([ms]) => ms).catch(() => null);
      const fast = [await loop(), await loop(), await loop()].filter(Number.isFinite).sort((x, y) => x - y)[1] ?? null;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const slow = [await loop(), await loop(), await loop()].filter(Number.isFinite).sort((x, y) => x - y)[1] ?? null;
      h.cpuMeasured = fast && slow ? round(slow / fast, 2) : null;
    }
    if (dev.network) await cdp.send('Network.emulateNetworkConditions', dev.network);
    cdp.on('Network.requestWillBeSent', (e) => { if (!h.requests.has(e.requestId)) h.requests.set(e.requestId, { url: e.request.url, type: e.type ?? null, bytes: 0, done: false }); });
    cdp.on('Network.loadingFinished', (e) => { const r = h.requests.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.done = true; } });
    cdp.on('Network.webSocketCreated', (e) => h.sockets.set(e.requestId, /\/__net(?:\?|$)/.test(e.url) ? 'net' : 'other'));
    const wsBytes = (r) => (r.opcode === 2 ? Math.floor((String(r.payloadData).length * 3) / 4) : Buffer.byteLength(String(r.payloadData)));
    cdp.on('Network.webSocketFrameSent', (e) => { const w = h.ws[h.sockets.get(e.requestId) ?? 'other']; w.out++; w.outBytes += wsBytes(e.response); });
    cdp.on('Network.webSocketFrameReceived', (e) => { const w = h.ws[h.sockets.get(e.requestId) ?? 'other']; w.in++; w.inBytes += wsBytes(e.response); });
    await page.evaluateOnNewDocument(INSTRUMENT);
    await page.goto(playUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const origin = await T(page.evaluate(() => performance.timeOrigin), 8000);
    let seatedAt = null; let playableAt = null; let shell = null; let body = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && playableAt === null) {
      shell = await T(page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat, role: s.stats?.role ?? null } : null; }), 5000);
      const now = Date.now();
      if (seatedAt === null && shell?.room && Number.isInteger(shell.seat) && shell.role) seatedAt = now;
      const g = await inGame(h, () => {
        const p = window.__homiePort;
        let self = null;
        if (p && p.view !== 'board') { const r = p.rows(p.now() - 400); const last = r[r.length - 1]; self = last ? Number.isFinite(last[1]) : false; }
        return { first: window.__perf?.first?.() ?? null, port: Boolean(p), view: p?.view ?? null, self };
      });
      if (seatedAt !== null && g?.first !== null && g?.first !== undefined) {
        // A body the game reports (its port probe), or no body to wait for (a board, or a game with no probe).
        if (!g.port || g.view === 'board' || g.self) { playableAt = now; body = g.port && g.view !== 'board' ? 'reported' : 'none to report'; }
        else if (now - seatedAt > 10_000) { playableAt = null; body = 'never reported by the port probe in 10 s'; break; }
      }
      await sleep(50);
    }
    const g = await inGame(h, () => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
      let renderer = null;
      try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); renderer = gl ? String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; } catch { renderer = null; }
      return { origin: performance.timeOrigin, first: window.__perf?.first?.() ?? null, dcl: nav ? nav.domContentLoadedEventEnd : null, loaded: nav ? nav.loadEventEnd : null, fcp: paint['first-contentful-paint'] ?? null, renderer, keys: window.__homiePort?.keys ?? null, thumb: window.__homiePort?.thumb ?? null, view: window.__homiePort?.view ?? null };
    });
    const at = (epoch) => (epoch && origin ? Math.round(epoch - origin) : null);
    const files = [...h.requests.values()].filter((r) => r.done);
    const gameFiles = files.filter((r) => /\/__game\//.test(r.url));
    h.loadInfo = {
      firstFrameMs: at(g?.first),
      seatedMs: at(seatedAt),
      playableMs: at(playableAt),
      body,
      gameDomReadyMs: g?.dcl !== null && g?.dcl !== undefined && g?.origin ? at(g.origin + g.dcl) : null,
      gameFirstPaintMs: g?.fcp !== null && g?.fcp !== undefined && g?.origin ? at(g.origin + g.fcp) : null,
      requests: files.length,
      kb: round(files.reduce((s, r) => s + r.bytes, 0) / 1024, 1),
      gameRequests: gameFiles.length,
      gameKb: round(gameFiles.reduce((s, r) => s + r.bytes, 0) / 1024, 1),
      biggest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((r) => ({ path: pathOf(r.url), type: r.type, kb: round(r.bytes / 1024, 1) })),
    };
    h.shell = shell;
    h.renderer = g?.renderer ?? null;
    h.keys = g?.keys ?? null;
    h.thumb = g?.thumb ?? null;
    h.view = g?.view ?? null;
    h.requestsAtPlayable = h.requests.size;
    log(`${label}: ${shell?.role ?? 'no role'} in room ${shell?.room ?? '?'}, playable at ${h.loadInfo.playableMs ?? '?'} ms`);
    return h;
  } catch (error) {
    await closePlayer(h);
    throw error;
  }
}

async function closePlayer(h) {
  try { await T(h.browser.close(), 8000); } catch { /* */ }
  try { h.browser.process()?.kill('SIGKILL'); } catch { /* */ }
  rmSync(h.profileDir, { recursive: true, force: true });
}

const pathOf = (url) => { try { return new URL(url).pathname; } catch { return String(url).slice(0, 120); } };

/** Play the same way every run: hold a direction most of a second, now and then the action, until `stop.on` is false. */
async function drive(h, seed, stop) {
  const r = rng(seed);
  const keys = h.keys ?? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const dirs = ['up', 'right', 'down', 'left'];
  const vp = PERF_DEVICES[h.device].viewport;
  const touch = Boolean(vp.hasTouch);
  const [fx, fy] = Array.isArray(h.thumb) ? h.thumb : [0.24, 0.74];
  while (stop.on) {
    const d = dirs[Math.floor(r() * 4)];
    const hold = 400 + Math.floor(r() * 700);
    try {
      if (touch) {
        const x = Math.round(vp.width * fx); const y = Math.round(vp.height * fy);
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
        await h.page.touchscreen.touchStart(x, y);
        for (let k = 1; k <= 5; k++) { await h.page.touchscreen.touchMove(x + v[0] * 14 * k, y + v[1] * 14 * k); await sleep(16); }
        await sleep(hold);
        await h.page.touchscreen.touchEnd();
        if (r() < 0.3) await h.page.touchscreen.tap(Math.round(vp.width * 0.82), Math.round(vp.height * 0.78));
      } else {
        await h.page.keyboard.down(keys[d]); await sleep(hold); await h.page.keyboard.up(keys[d]);
        if (r() < 0.3) await h.page.keyboard.press('Space');
      }
    } catch { /* a closing page */ }
    await sleep(60 + Math.floor(r() * 120));
  }
}

/** What a browser's counters say now (the start or end of the measured window). */
async function reading(h, { gc = false } = {}) {
  if (gc) await T(h.cdp.send('HeapProfiler.collectGarbage'), 10_000);
  const m = await metricsOf(h.cdp);
  const count = await inGame(h, () => window.__perf?.count?.() ?? 0);
  const long = await inGame(h, () => window.__perf?.long?.() ?? null);
  return { at: Date.now(), m, count: count ?? 0, long, ws: JSON.parse(JSON.stringify(h.ws)) };
}

/** The measured window of one browser, from two readings. */
async function windowOf(h, a, b, seconds) {
  const span = (b.at - a.at) / 1000 || seconds;
  const taken = await inGame(h, (from) => window.__perf?.take?.(from) ?? null, a.count);
  const t = taken?.t ?? [];
  const w = taken?.w ?? [];
  const gaps = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  const frames = gaps.length;
  const share = (ms) => (frames ? round((gaps.filter((g) => g > ms).length / frames) * 100, 2) : null);
  const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s.length ? round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))], 2) : null; };
  const d = (k) => (Number.isFinite(b.m[k]) && Number.isFinite(a.m[k]) ? b.m[k] - a.m[k] : null);
  const ws = (k, dir) => round((b.ws[k][dir] - a.ws[k][dir]) / span, 1);
  const wsKb = (k, dir) => round((b.ws[k][`${dir}Bytes`] - a.ws[k][`${dir}Bytes`]) / 1024 / span, 2);
  return {
    seconds: round(span, 1),
    frames: { n: frames, fps: span ? round(frames / span, 1) : null, p50: q(gaps, 0.5), p95: q(gaps, 0.95), p99: q(gaps, 0.99), max: frames ? round(Math.max(...gaps), 1) : null, over33: share(33.4), over50: share(50) },
    work: { p50: q(w, 0.5), p95: q(w, 0.95), mean: w.length ? round(w.reduce((s, x) => s + x, 0) / w.length, 3) : null, max: w.length ? round(Math.max(...w), 2) : null },
    main: {
      busyPerFrame: frames && d('TaskDuration') !== null ? round((d('TaskDuration') * 1000) / frames, 3) : null,
      busyPct: d('TaskDuration') !== null ? round((d('TaskDuration') / span) * 100, 1) : null,
      scriptMsPerS: d('ScriptDuration') !== null ? round((d('ScriptDuration') * 1000) / span, 1) : null,
      layoutMsPerS: d('LayoutDuration') !== null ? round((d('LayoutDuration') * 1000) / span, 2) : null,
      styleMsPerS: d('RecalcStyleDuration') !== null ? round((d('RecalcStyleDuration') * 1000) / span, 2) : null,
      longTasks: a.long && b.long ? { n: b.long.n - a.long.n, ms: round(b.long.ms - a.long.ms, 1) } : null,
    },
    heap: { startMb: round((a.m.JSHeapUsedSize ?? NaN) / 1048576, 2), endMb: round((b.m.JSHeapUsedSize ?? NaN) / 1048576, 2), growthMbPerMin: round((((b.m.JSHeapUsedSize ?? NaN) - (a.m.JSHeapUsedSize ?? NaN)) / 1048576) / (span / 60), 2), nodes: b.m.Nodes ?? null, listeners: b.m.JSEventListeners ?? null },
    net: { msgsOut: ws('net', 'out'), msgsIn: ws('net', 'in'), kbOut: wsKb('net', 'out'), kbIn: wsKb('net', 'in'), otherMsgs: round(ws('other', 'out') + ws('other', 'in'), 1) },
  };
}

/** A CPU profile of one browser for `seconds` (a window of its own, after the measured one). */
async function profileOf(h, seconds, file) {
  await h.cdp.send('Profiler.enable');
  await h.cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await h.cdp.send('Profiler.start');
  await sleep(seconds * 1000);
  const { profile } = await h.cdp.send('Profiler.stop');
  writeFileSync(file, JSON.stringify(profile));
  return profile;
}

/** The game's source map, when the build kept one for the exact main.js being served (`homie-studio build --maps`). */
function mapsFor(root, game) {
  if (!root) return [];
  const dir = join(root, '.studio', 'maps', game);
  const mapFile = join(dir, 'main.js.map');
  const built = join(root, 'site', 'dist', 'games', game, 'assets', 'main.js');
  if (!existsSync(mapFile) || !existsSync(built)) return [];
  try {
    const want = readFileSync(join(dir, 'main.js.sha256'), 'utf8').trim();
    if (sha256(readFileSync(built)) !== want) return [];
    const lookup = sourceMapLookup(JSON.parse(readFileSync(mapFile, 'utf8')));
    return [{ match: (url) => new RegExp(`/${game}/__game/assets/main\\.js(?:\\?|$)`).test(url), lookup }];
  } catch { return []; }
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** One digest of a built game's files (site/dist/games/<id>), so a run says exactly which build it measured. */
export function buildDigest(root, game) {
  const dir = root ? join(root, 'site', 'dist', 'games', game) : null;
  if (!dir || !existsSync(dir)) return null;
  const h = createHash('sha256');
  for (const f of listFiles(dir).filter((f) => !f.startsWith('_landing/')).sort()) h.update(`${f}\0${sha256(readFileSync(join(dir, f)))}\n`);
  return h.digest('hex').slice(0, 16);
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, p)); else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * ONE RUN on one device: two browsers in a fresh room, a warm-up, the measured window, then (with `profile`) a
 * profiling window. Writes `<out>/<device>-<k>.json` and its screenshots; returns the run.
 */
async function oneRun({ puppeteer, chrome, root, url, game, device, k, seconds, warm, profile, out, maxLoad, waitLoadMs, log, cpu, pair }) {
  const calm = await waitCalm({ max: maxLoad, waitMs: waitLoadMs, log });
  const room = `perf-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const playUrl = `${url}/${game}/play?room=${room}`;
  const build = buildDigest(root, game);
  const hs = [];
  const stop = { on: true };
  const name = `${device}-${k}`;
  const run = { v: 1, kind: 'homie-perf-run', game, url, device, deviceLabel: deviceLabel(device, cpu), cpu: device === 'phone' ? cpu : 1, ...(pair ? { pair: String(pair).slice(0, 40) } : {}), room, at: new Date().toISOString(), seconds, warm, build, machine: machine(), load: { before: calm }, blocked: null, browsers: [] };
  try {
    hs.push(await openPlayer(puppeteer, chrome, device, playUrl, 'first browser', log, cpu));
    hs.push(await openPlayer(puppeteer, chrome, device, playUrl, 'second browser', log, cpu));
    run.chrome = await T(hs[0].browser.version(), 5000);
    if (hs[0].cpuMeasured) run.cpuMeasured = hs[0].cpuMeasured;
    run.renderer = hs[0].renderer;
    if (run.renderer && SOFTWARE_GL.test(run.renderer)) run.blocked = `software renderer (${run.renderer}): a frame rate here is not a person's; nothing in this run is judged`;
    if (hs[0].shell?.room !== hs[1].shell?.room) run.blocked = `the two browsers landed in different rooms (${hs[0].shell?.room}, ${hs[1].shell?.room})`;
    const players = hs.map((h, i) => drive(h, 1000 + i * 7919 + k * 31, stop));
    await sleep(warm * 1000);
    // A garbage collection before the window (outside it), so the heap's growth over the window is the game's own.
    const a = await Promise.all(hs.map((h) => reading(h, { gc: true })));
    const cpu0 = cpus();
    await sleep(seconds * 1000);
    const cpu1 = cpus();
    const b = await Promise.all(hs.map((h) => reading(h)));
    const after = await Promise.all(hs.map((h) => reading(h, { gc: true })));
    run.load.busyPct = busyBetween(cpu0, cpu1);
    for (const [i, h] of hs.entries()) {
      const win = await windowOf(h, a[i], b[i], seconds);
      win.heap.afterGcMb = round((after[i].m.JSHeapUsedSize ?? NaN) / 1048576, 2);
      win.heap.gcGrowthMbPerMin = round((((after[i].m.JSHeapUsedSize ?? NaN) - (a[i].m.JSHeapUsedSize ?? NaN)) / 1048576) / (win.seconds / 60), 2);
      const shell = await T(h.page.evaluate(() => { const s = window.__shell; if (!s) return null; const t = s.stats ?? {}; return { role: t.role ?? null, seat: s.seat ?? null, peers: t.peers ?? null, snapHzOut: t.snapHzOut ?? null, snapHzIn: t.snapHzIn ?? null, inputHzOut: t.inputHzOut ?? null, inputHzIn: t.inputHzIn ?? null, lastSnapBytes: t.lastSnapBytes ?? null, maxSnapBytes: t.maxSnapBytes ?? null, bytesOutPerS: t.bytesOutPerS ?? null, bytesInPerS: t.bytesInPerS ?? null, rtt: t.rtt ?? null, interpDelay: t.interpDelay ?? null, starvedPct: t.starvedPct ?? null, reconnects: t.reconnects ?? null }; }), 5000);
      const role = shell?.role === 'host' ? 'host' : 'replica';
      const shot = join(out, `${name}-${role}.png`);
      const vp = PERF_DEVICES[device].viewport;
      const scale = Math.min(1, 640 / (vp.width * vp.deviceScaleFactor));
      await T(h.page.screenshot({ path: shot, type: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale } }), 15_000);
      run.browsers.push({ role, seat: shell?.seat ?? null, load: h.loadInfo, ...win, netplay: shell, errors: h.errors.slice(0, 10), screenshot: existsSync(shot) ? relative(out, shot) : null });
    }
    if (!run.browsers.some((x) => x.role === 'host')) run.blocked ??= 'neither browser became the room\'s host';
    if (profile) {
      // A window of its own, still playing: a profiler slows what it watches, so the measured window above never has one.
      const maps = mapsFor(root, game);
      const isGame = (u) => /\/__game\//.test(u);
      const secs = Math.min(10, seconds);
      const profs = await Promise.all(hs.map((h, i) => profileOf(h, secs, join(out, `${name}-${run.browsers[i].role}.cpuprofile`))));
      for (const [i, p] of profs.entries()) run.browsers[i].profile = { file: `${name}-${run.browsers[i].role}.cpuprofile`, seconds: secs, mapped: maps.length > 0, ...summarizeProfile(p, { maps, game: isGame }) };
    }
    stop.on = false;
    await Promise.all(players);
  } finally {
    stop.on = false;
    for (const h of hs) await closePlayer(h);
  }
  run.load.after = { load1: round(loadavg()[0], 2), perCore: round(loadavg()[0] / cpus().length, 2) };
  run.loaded = !calm.calm;
  const file = join(out, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 1)}\n`);
  return { file, run };
}

function machine() {
  const c = cpus();
  return { cpu: c[0]?.model ?? null, cores: c.length, memGb: Math.round(totalmem() / 1073741824), platform: process.platform };
}

/** Add `.perf/` to the studio's .gitignore once (runs are this computer's own). */
function ignorePerf(root) {
  if (!root) return;
  const gi = join(root, '.gitignore');
  const text = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!/^\.perf\/?$/m.test(text)) appendFileSync(gi, `${text.endsWith('\n') || !text ? '' : '\n'}# Performance runs (homie-studio perf): numbers, screenshots and CPU profiles of each run.\n.perf/\n`);
}

/**
 * `homie-studio perf <game>`: `runs` runs on each device, written under `out`. Returns paths and medians only.
 */
export async function perfRun({ root = null, url, game, devices = ['computer', 'phone'], runs = 1, seconds = 15, warm = 3, profile = false, out = null, maxLoad = 0.8, waitLoadMs = 180_000, cpu = 4, pair = null, log = () => {} }) {
  if (!url || !game) return { ok: false, command: 'perf', why: 'usage: homie-studio perf <game> --url <site> (the local dev address, or the live site)' };
  const base = String(url).replace(/\/+$/, '');
  const bad = devices.filter((d) => !PERF_DEVICES[d]);
  if (bad.length) return { ok: false, command: 'perf', why: `unknown device ${bad.join(', ')} (computer, phone)` };
  const chrome = findChrome();
  if (!chrome) return { ok: false, command: 'perf', why: noChrome() };
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return { ok: false, command: 'perf', why: 'puppeteer-core is not installed (it comes with @homie-rocks/studio; run npm install)' }; }
  const alive = await fetch(`${base}/${game}/play`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok).catch(() => false);
  if (!alive) return { ok: false, command: 'perf', why: `${base}/${game}/play does not answer: start the site (npm run dev, as a background task) or check the address` };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = resolve(out ?? join(root ?? process.cwd(), '.perf', game, stamp));
  mkdirSync(dir, { recursive: true });
  ignorePerf(root);
  if (root && existsSync(join(root, 'site', 'dist', 'games', game))) writeFileSync(join(dir, 'sizes.json'), `${JSON.stringify(perfSizes(root, game), null, 1)}\n`);
  const files = [];
  const done = [];
  for (const device of devices) {
    for (let k = 1; k <= runs; k++) {
      const n = nextIndex(dir, device, k);
      log(`… ${device} run ${k} of ${runs}`);
      const r = await oneRun({ puppeteer, chrome, root, url: base, game, device, k: n, seconds, warm, profile, out: dir, maxLoad, waitLoadMs, log, cpu, pair: pair && runs === 1 ? pair : null });
      files.push(r.file);
      done.push(r.run);
    }
  }
  const summary = summaryOf(done);
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  const blocked = done.filter((r) => r.blocked);
  const loaded = done.filter((r) => r.loaded);
  return {
    ok: blocked.length < done.length,
    command: 'perf',
    game,
    out: dir,
    runs: files.map((f) => relative(process.cwd(), f) || f),
    summary: join(dir, 'summary.json'),
    sizes: existsSync(join(dir, 'sizes.json')) ? join(dir, 'sizes.json') : null,
    headline: headlineOf(summary),
    ...(blocked.length ? { blocked: `${blocked.length} of ${done.length} runs could not be judged: ${blocked[0].blocked}` } : {}),
    ...(loaded.length ? { loaded: `${loaded.length} of ${done.length} runs started on a busy computer (load over ${maxLoad} per core): compare leaves them out` } : {}),
    profiles: profile ? done.flatMap((r) => r.browsers.map((b) => (b.profile ? join(dir, b.profile.file) : null))).filter(Boolean) : undefined,
  };
}

/** The next free run number for a device in a folder (runs can be added to a folder later). */
function nextIndex(dir, device, k) {
  let n = k;
  while (existsSync(join(dir, `${device}-${n}.json`))) n++;
  return n;
}

/** Every number a run gives, flat: `phone.host.frame.p95`, `computer.replica.net.msgsIn`, … (all lower is better). */
export function metricsOfRun(run) {
  const out = {};
  for (const b of run.browsers ?? []) {
    const p = `${run.device}.${b.role}`;
    const put = (k, v) => { if (Number.isFinite(v)) out[`${p}.${k}`] = v; };
    put('frame.p50', b.frames?.p50); put('frame.p95', b.frames?.p95); put('frame.p99', b.frames?.p99); put('frame.max', b.frames?.max);
    put('frame.over33', b.frames?.over33); put('frame.over50', b.frames?.over50);
    put('work.p50', b.work?.p50); put('work.p95', b.work?.p95); put('work.mean', b.work?.mean);
    put('busy', b.main?.busyPerFrame); put('script', b.main?.scriptMsPerS);
    put('heap', b.heap?.afterGcMb); put('heap.growth', b.heap?.gcGrowthMbPerMin);
    put('load.firstFrame', b.load?.firstFrameMs); put('load.seated', b.load?.seatedMs); put('load.playable', b.load?.playableMs); put('load.gameKb', b.load?.gameKb);
    put('net.msgsOut', b.net?.msgsOut); put('net.msgsIn', b.net?.msgsIn); put('net.kbOut', b.net?.kbOut); put('net.kbIn', b.net?.kbIn);
  }
  return out;
}

/** Medians of every metric over the runs that count (not blocked, not loaded), per metric. */
export function summaryOf(runs) {
  const counted = runs.filter((r) => !r.blocked && !r.loaded);
  const by = {};
  for (const r of counted) for (const [k, v] of Object.entries(metricsOfRun(r))) (by[k] ??= []).push(v);
  const metrics = Object.fromEntries(Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([k, xs]) => [k, summarize(xs)]));
  const renderers = [...new Set(runs.map((r) => r.renderer).filter(Boolean))];
  return { v: 1, kind: 'homie-perf-summary', runs: runs.length, counted: counted.length, devices: [...new Set(runs.map((r) => r.device))], renderers, load: runs.map((r) => ({ device: r.device, before: r.load?.before?.load1 ?? null, after: r.load?.after?.load1 ?? null, busyPct: r.load?.busyPct ?? null, loaded: Boolean(r.loaded) })), metrics };
}

/** A few medians for a person: frame time, the game's work per frame and time to playable, per device and role. */
function headlineOf(summary) {
  const out = [];
  for (const device of summary.devices) {
    for (const role of ['host', 'replica']) {
      const m = (k) => summary.metrics[`${device}.${role}.${k}`]?.median;
      if (m('frame.p50') === undefined) continue;
      out.push(`${device} ${role}: frames ${m('frame.p50')} ms median, ${m('frame.p95')} ms p95, ${m('frame.over50') ?? 0}% over 50 ms; game JS ${m('work.p50')} ms a frame (p95 ${m('work.p95')}); main thread ${m('busy')} ms a frame; playable at ${m('load.playable') ?? '?'} ms; netplay ${m('net.msgsOut')} out / ${m('net.msgsIn')} in a second; heap ${m('heap')} MB`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------- sizes */

const KIND = [[/\.(m?js)$/i, 'js'], [/\.css$/i, 'css'], [/\.html?$/i, 'html'], [/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i, 'image'], [/\.(mp3|ogg|wav|m4a|flac|opus)$/i, 'audio'], [/\.(mp4|webm|mov)$/i, 'video'], [/\.(glb|gltf|bin|obj|fbx|hdr|ktx2|basis)$/i, 'model'], [/\.(woff2?|ttf|otf)$/i, 'font'], [/\.(json|txt|md)$/i, 'data']];
const kindOf = (f) => KIND.find(([re]) => re.test(f))?.[1] ?? 'other';
const COMPRESSIBLE = new Set(['js', 'css', 'html', 'data', 'model']);

/**
 * `homie-studio perf sizes <game>`: what a player downloads, from the built game (site/dist/games/<id>): every file,
 * raw and gzipped (what a server sends when the browser accepts it), the biggest first, and with a build that kept its
 * map (`build --maps`) which source modules make up the bundle. `source.json` (for remixers), `_landing/`, `hero/` and
 * the cover (the landing page's) are listed apart: the game itself never loads them. What a browser really fetched is
 * in each run (`load`).
 *
 * Each of the biggest JavaScript files (20 KB or more) carries `code`: whether it is minified, read from its code
 * (whitespace, comments and names outside its strings: lib/perf-code.mjs), and how much of it is strings and GLSL
 * shader source. A bundle with three.js in it gzips like text even minified (its shaders are source in strings), so
 * how well a file compresses never says it is unminified.
 */
export function perfSizes(root, game) {
  const dir = join(root, 'site', 'dist', 'games', game);
  if (!existsSync(dir)) return { ok: false, command: 'perf sizes', why: `no build of ${game}: run npm run build first` };
  let cover = null;
  try { cover = JSON.parse(readFileSync(join(root, 'games', game, 'game.json'), 'utf8')).cover ?? null; } catch { /* none */ }
  const files = listFiles(dir).map((f) => {
    const buf = readFileSync(join(dir, f));
    const kind = kindOf(f);
    // Never loaded by the game itself: the remix source, and the landing page's art (hero footage, the cover).
    return { path: f, kind, bytes: buf.length, gzip: COMPRESSIBLE.has(kind) ? gzipSync(buf, { level: 6 }).length : buf.length, apart: f === 'source.json' || f.startsWith('_landing/') || f.startsWith('hero/') || f === cover };
  });
  const game_ = files.filter((f) => !f.apart);
  const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  const byKind = {};
  for (const f of game_) { const k = (byKind[f.kind] ??= { files: 0, bytes: 0, gzip: 0 }); k.files++; k.bytes += f.bytes; k.gzip += f.gzip; }
  let modules = null;
  const mapDir = join(root, '.studio', 'maps', game);
  const main = join(dir, 'assets', 'main.js');
  if (existsSync(join(mapDir, 'meta.json')) && existsSync(main)) {
    try {
      const want = readFileSync(join(mapDir, 'main.js.sha256'), 'utf8').trim();
      if (want === sha256(readFileSync(main))) {
        const meta = JSON.parse(readFileSync(join(mapDir, 'meta.json'), 'utf8'));
        const outKey = Object.keys(meta.outputs ?? {}).find((k) => k.endsWith('main.js'));
        const inputs = Object.entries(meta.outputs?.[outKey]?.inputs ?? {}).map(([p, v]) => ({ module: p.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, 'node_modules/'), bytes: v.bytesInOutput })).sort((a, b) => b.bytes - a.bytes);
        modules = { total: inputs.reduce((s, x) => s + x.bytes, 0), top: inputs.slice(0, 12) };
      }
    } catch { modules = null; }
  }
  return {
    ok: true,
    command: 'perf sizes',
    game,
    total: { files: game_.length, bytes: sum(game_, 'bytes'), gzip: sum(game_, 'gzip') },
    js: { bytes: byKind.js?.bytes ?? 0, gzip: byKind.js?.gzip ?? 0 },
    byKind,
    biggest: [...game_].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map(({ apart, ...f }) => (f.kind === 'js' && f.bytes >= 20 * 1024 ? { ...f, code: codeOf(join(dir, f.path)) } : f)),
    apart: files.filter((f) => f.apart).length ? { files: files.filter((f) => f.apart).length, bytes: sum(files.filter((f) => f.apart), 'bytes'), note: 'the remix source and the landing page\'s art (hero/, the cover): never loaded by the game' } : null,
    modules,
  };
}

/** What `perf sizes` says about one JavaScript file's code (lib/perf-code.mjs), or null when it cannot be read. */
function codeOf(file) {
  try {
    const { minified, mangled, whitespacePct, commentPct, codeCharsPerLine, nameLength, shortNamesPct, stringPct, shaderPct, why } = readCode(readFileSync(file, 'utf8'));
    return { minified, mangled, whitespacePct, commentPct, codeCharsPerLine, nameLength, shortNamesPct, stringPct, shaderPct, why };
  } catch { return null; }
}

/** Size metrics, flat like a run's: `bytes.total`, `bytes.gzip`, `bytes.js`, `bytes.jsGzip` (the same every run). */
export function metricsOfSizes(s) {
  if (!s?.ok) return {};
  return { 'bytes.total': s.total.bytes, 'bytes.gzip': s.total.gzip, 'bytes.js': s.js.bytes, 'bytes.jsGzip': s.js.gzip };
}

/* ------------------------------------------------------------------------------------------------- compare */

/** The runs in a folder (every <device>-<n>.json), and its sizes.json. */
export function readRuns(dir) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return { runs: [], sizes: null };
  const runs = readdirSync(dir).filter((f) => /^(computer|phone)-\d+\.json$/.test(f)).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } }).filter((r) => r?.kind === 'homie-perf-run');
  let sizes = null;
  try { sizes = JSON.parse(readFileSync(join(dir, 'sizes.json'), 'utf8')); } catch { /* none */ }
  return { runs, sizes };
}

/** The metrics guarded by default: frame time and main-thread work of each role, time to playable and heap. */
export function defaultGuards(devices, goal) {
  const g = [];
  for (const d of devices) for (const role of ['host', 'replica']) g.push(`${d}.${role}.frame.p95`, `${d}.${role}.busy`, `${d}.${role}.load.playable`);
  for (const d of devices) g.push(`${d}.host.heap`, `${d}.host.net.kbOut`);
  return g.filter((k) => k !== goal);
}

/**
 * `homie-studio perf compare <before> <after>`: the goal metric and the guards, before against after, from the runs
 * in two folders. A run that was blocked, taken on a busy computer or profiled is left out (and counted).
 */
export function perfCompare(beforeDir, afterDir, { goal = DEFAULT_GOAL, guards = null, also = [], min = 0.03, write = true } = {}) {
  const A = readRuns(beforeDir);
  const B = readRuns(afterDir);
  if (!A.runs.length || !B.runs.length) return { ok: false, command: 'perf compare', why: `no runs in ${!A.runs.length ? beforeDir : afterDir} (folders that homie-studio perf wrote)` };
  const usable = (r) => !r.blocked && !r.loaded;
  const left = { before: A.runs.filter((r) => !usable(r)).length, after: B.runs.filter((r) => !usable(r)).length };
  const flat = (runs, sizes) => {
    const by = {};
    for (const r of runs.filter(usable)) for (const [k, v] of Object.entries(metricsOfRun(r))) (by[k] ??= []).push(v);
    for (const [k, v] of Object.entries(metricsOfSizes(sizes))) by[k] = [v];
    return by;
  };
  const a = flat(A.runs, A.sizes);
  const b = flat(B.runs, B.sizes);
  // Runs taken side by side carry the same `pair` label on both sides (perf --pair; the perf skill's try): judge those
  // pairs, so a computer that drifted busier hits both sides of each and cancels. The newest usable run of a label wins.
  const byPair = (runs) => { const m = new Map(); for (const r of runs.filter(usable)) { const k = `${r.device}:${r.pair}`; if (r.pair && (!m.has(k) || String(r.at) > String(m.get(k).at))) m.set(k, r); } return m; };
  const pa = byPair(A.runs);
  const pb = byPair(B.runs);
  const shared = [...pa.keys()].filter((k) => pb.has(k)).sort();
  const paired = shared.length >= 3;
  const pairedOf = (k) => {
    const xs = []; const ys = [];
    for (const id of shared) { const x = metricsOfRun(pa.get(id))[k]; const y = metricsOfRun(pb.get(id))[k]; if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } }
    return [xs, ys];
  };
  const devices = [...new Set([...A.runs, ...B.runs].map((r) => r.device))];
  const unit = (k) => (k.startsWith('bytes.') ? ' B' : /\.load\.gameKb$/.test(k) ? ' KB' : /\.(frame|work)\.(p\d+|max|mean)$|\.busy$|\.load\./.test(k) ? ' ms' : /\.frame\.over\d+$/.test(k) ? '%' : /heap$/.test(k) ? ' MB' : /heap\.growth$/.test(k) ? ' MB/min' : /\.net\.kb/.test(k) ? ' KB/s' : /\.net\.msgs/.test(k) ? '/s' : /\.script$/.test(k) ? ' ms/s' : '');
  const one = (k, opts = {}) => {
    if (paired && !k.startsWith('bytes.')) { const [xs, ys] = pairedOf(k); if (xs.length >= 3) return { metric: k, ...judgePaired(xs, ys, { min, unit: unit(k), ...opts }) }; }
    return { metric: k, ...judge(a[k] ?? [], b[k] ?? [], { min, unit: unit(k), ...opts }) };
  };
  const g = one(goal);
  const enough = (k) => (a[k]?.length ?? 0) >= (k.startsWith('bytes.') ? 1 : 3) && (b[k]?.length ?? 0) >= (k.startsWith('bytes.') ? 1 : 3);
  const guardList = [...new Set([...(guards ?? defaultGuards(devices, goal)), ...also])].filter((k) => k !== goal && a[k] && b[k]).map((k) => one(k));
  const worse = guardList.filter((x) => x.verdict === 'worse');
  let verdict;
  let why;
  if (!enough(goal)) { verdict = 'blocked'; why = `${goal}: too few runs that count (${a[goal]?.length ?? 0} before, ${b[goal]?.length ?? 0} after; at least 3 each). ${left.before + left.after} run(s) were left out (blocked or on a busy computer): measure again when the computer is calmer`; }
  else if (g.verdict === 'worse') { verdict = 'worse'; why = `${goal} got worse: ${g.why}`; }
  else if (worse.length) { verdict = 'worse'; why = `${worse.map((x) => `${x.metric} got worse: ${x.why}`).join('; ')}`; }
  else if (g.verdict === 'better') { verdict = 'better'; why = `${goal} is better beyond the noise: ${g.why}`; }
  else { verdict = 'same'; why = `${goal}: ${g.why}`; }
  const result = { ok: true, command: 'perf compare', before: resolve(beforeDir), after: resolve(afterDir), goal: g, verdict, why, guards: guardList, left, min, test: paired ? `paired: ${shared.length} pairs run side by side (Wilcoxon signed-rank, exact)` : 'unpaired: every run against every run (Mann-Whitney U, exact)' };
  if (write) writeFileSync(join(afterDir, 'compare.json'), `${JSON.stringify(result, null, 1)}\n`);
  return { ...result, file: write ? join(afterDir, 'compare.json') : null };
}

