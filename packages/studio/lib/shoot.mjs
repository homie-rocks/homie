/**
 * `homie-studio shoot <game> --url <site>`: pictures of a game on a clock this command moves, and a two-client seat
 * smoke check. For a 3D game on a machine with no GPU (a cloud session, CI), where the software renderer draws two
 * frames a second and anything timed by the wall clock is fiction: here every frame is exactly one step of the
 * game's own clock, however long the computer took to draw it.
 *
 *   homie-studio shoot <game> --url <site> [--frames 60] [--fps 30] [--device computer|phone] [--out <dir>]
 *                                           [--hold <KeyboardEvent.code>] [--no-smoke] [--timeout <seconds>]
 *
 * What it does, in order, all bounded (`--timeout`, default 180 s; it stops with what it has and says `partial`):
 *
 *   1. SMOKE (unless --no-smoke): two clients, a computer and a phone, open the play page in one private room
 *      (`?room=shoot-…`, so no stranger and no earlier round is in it). PASS when both get a seat in that same room,
 *      both sockets are connected (neither fell back to playing alone offline) and the two seats differ. It does not
 *      wait for a round to finish: that is `homie-studio check`.
 *   2. FRAMES: the first client waits for its loading cover to lift (reported as `ready`), then its clocks are frozen
 *      and stepped: requestAnimationFrame, performance.now, Date, setTimeout, setInterval and CSS/Web animations all
 *      advance by exactly 1000 / fps ms per frame, in the page and in the game's frame. Each step is one picture:
 *      `<out>/frame-0001.png` … and `<out>/shoot.json` (per frame: the virtual time, the round phase and the body's
 *      position when the game exposes a port probe, the renderer's draw calls and triangles when it exposes those).
 *
 * WHAT A FROZEN CLOCK DOES NOT COVER, said in the result (`limits`): the room is still a real socket, so the other
 * players and the round's server clock arrive in real time between steps; Web Audio's own clock and <video> are not
 * stepped; a worker's timers are not stepped. A game that derives its motion from `net.now()` (server time) moves
 * by the real time that passed, not by the step. The frames are evidence of what was drawn, on this renderer; they
 * are never a frame rate.
 *
 * `--preview` (no --url): THE FRAMES HALF WITHOUT THE WHOLE SITE. It starts the light preview server itself
 * (lib/preview.mjs: the one built game's files on 127.0.0.1, no Wrangler, no rooms), opens the game's own page there
 * and shoots it. The game plays alone, offline, with its bots, which is what pictures of the game itself want. The
 * smoke is NOT RUN (there is no room to meet in: that half needs `dev`), and there is no loading cover to wait for.
 * The result says which build the frames are of (`build`: its hash, the one `build` printed) and that the page
 * really loaded that build's hashed bundle (`bundle`: lib/build.mjs bundleOf, never a guess at assets/main.js).
 *
 * Reuses the two-browser launch of lib/check.mjs's kind (lib/chrome.mjs flags, fresh profiles, the house QA user
 * agent). The video skill's recorder (record-page.mjs) records in real time off the compositor and has no virtual
 * clock, so there was nothing to import from it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleOf, gameDigest } from './build.mjs';
import { arrivalReadiness, LAUNCH_TIMEOUT_MS } from './check.mjs';
import { SOFTWARE_GL, chromeArgs, findChrome, noChrome } from './chrome.mjs';
import { reachSite, siteRefusal } from './net.mjs';
import { previewServer } from './preview.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A bounded wait whose timer is cleared: nothing here may hold the command open. */
const T = (p, ms, v = null) => { let t = null; return Promise.race([Promise.resolve(p).catch(() => v), new Promise((r) => { t = setTimeout(() => r(v), ms); })]).finally(() => clearTimeout(t)); };

export const SHOOT_DEVICES = {
  computer: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/**
 * THE VIRTUAL CLOCK, injected into every frame before any of its scripts run. Until `freeze()` it changes nothing a
 * page can see: timers and animation frames run on the real clock, through this script's own queue. After
 * `freeze()` time stands still, and `step(ms)` moves it: due timers fire in time order, then every queued animation
 * frame callback runs once with the new time. `window.__homieClock` = { freeze(), step(ms), now(), frozen, stats() }.
 *
 * One queue with two drivers (the real clock, then the steps), so a loop that was started before the freeze is the
 * same loop after it: nothing keeps running on the wall clock behind the frozen page.
 */
export const VIRTUAL_CLOCK = `(() => {
  if (window.__homieClock) return;
  const R = {
    raf: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null,
    st: window.setTimeout.bind(window), si: window.setInterval.bind(window),
    perf: performance.now.bind(performance), D: Date,
  };
  let frozen = false; let vPerf = 0; let vDate = 0; let seq = 0; let steps = 0;
  const rafs = new Map(); const timers = new Map();
  const perfNow = () => (frozen ? vPerf : R.perf());
  const dateNow = () => (frozen ? vDate : R.D.now());
  const report = (e) => { R.st(() => { throw e; }, 0); };
  const runRafs = (t) => { const run = [...rafs.values()]; rafs.clear(); for (const cb of run) { try { cb(t); } catch (e) { report(e); } } };
  const runTimers = (t) => {
    for (let guard = 0; guard < 5000; guard++) {
      let next = null;
      for (const x of timers.values()) if (x.at <= t && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) return;
      if (next.every !== null) next.at += Math.max(1, next.every); else timers.delete(next.id);
      try { next.fn.apply(window, next.args); } catch (e) { report(e); }
    }
  };
  window.requestAnimationFrame = (cb) => { const id = ++seq; rafs.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  const add = (fn, ms, args, every) => { if (typeof fn !== 'function') return 0; const id = ++seq; const d = Math.max(0, Number(ms) || 0); timers.set(id, { id, fn, args, at: perfNow() + d, every: every ? d : null }); return id; };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = (id) => { timers.delete(id); };
  window.clearInterval = (id) => { timers.delete(id); };
  performance.now = perfNow;
  window.Date = new Proxy(R.D, {
    construct(t, a) { return a.length ? new t(...a) : new t(dateNow()); },
    apply(t) { return new t(dateNow()).toString(); },
    get(t, k) { return k === 'now' ? dateNow : Reflect.get(t, k); },
  });
  // The real clock drives the queue until the freeze.
  const frame = (t) => { if (frozen) return; runRafs(t); R.raf(frame); };
  if (R.raf) R.raf(frame);
  R.si(() => { if (!frozen) runTimers(R.perf()); }, 4);
  const anims = new Set();
  const stepAnims = (ms) => {
    let list = []; try { list = document.getAnimations ? document.getAnimations() : []; } catch (e) { list = []; }
    for (const a of list) {
      try {
        if (!anims.has(a)) { anims.add(a); a.pause(); }
        if (ms > 0 && a.currentTime !== null) a.currentTime = Number(a.currentTime) + ms;
      } catch (e) { /* an animation that cannot be driven stays where it is */ }
    }
  };
  window.__homieClock = {
    get frozen() { return frozen; },
    now: perfNow,
    freeze() { if (frozen) return vPerf; /* a whole millisecond (never earlier than the last real reading): stepped time is then base + n steps exactly, with no float dust between a step asked for and the time handed out */ vPerf = Math.ceil(R.perf()); vDate = R.D.now(); frozen = true; stepAnims(0); return vPerf; },
    step(ms) {
      if (!frozen) this.freeze();
      const d = Math.max(0, Number(ms) || 0);
      vPerf += d; vDate += d; steps += 1;
      runTimers(vPerf); runRafs(vPerf); stepAnims(d);
      return vPerf;
    },
    stats() { return { frozen, steps, rafs: rafs.size, timers: timers.size, now: perfNow() }; },
  };
})();`;

/**
 * THE SMOKE VERDICT, from what each client's page said. `clients`: [{ kind, seated: { room, seat, role } | null,
 * net: { connected, offline } | null }]. PASS only when both are seated in the same room on different seats with
 * neither offline; a client whose connection state the page does not expose is said to be unknown, not assumed fine.
 */
export function judgeSmoke(clients) {
  const missing = clients.filter((c) => !c.seated).map((c) => c.kind);
  if (missing.length) return { ok: false, verdict: 'FAIL', why: `the ${missing.join(' and the ')} never got a seat` };
  const rooms = [...new Set(clients.map((c) => c.seated.room))];
  if (rooms.length > 1) return { ok: false, verdict: 'FAIL', why: `the clients landed in different rooms (${rooms.join(', ')})` };
  const offline = clients.filter((c) => c.net?.offline === true || c.net?.connected === false).map((c) => c.kind);
  if (offline.length) return { ok: false, verdict: 'FAIL', why: `the ${offline.join(' and the ')} has a seat on its own page but is playing alone offline (no room connection): two clients did not meet` };
  const seats = clients.map((c) => c.seated.seat);
  if (new Set(seats).size !== seats.length) return { ok: false, verdict: 'FAIL', why: `both clients report seat ${seats[0]}: they are not two players in one room` };
  const unknown = clients.filter((c) => !c.net).map((c) => c.kind);
  return { ok: true, verdict: 'PASS', room: rooms[0], seats, ...(unknown.length ? { note: `the ${unknown.join(' and the ')} exposes no connection state (window.__homieNet): seats and the room were measured, the socket was not` } : {}) };
}

/** The game's own frame: inside the play page it is the /__game/ frame; on the preview server the page IS the game. */
const gameFrameOf = (page) => page.frames().find((f) => /\/__game\//.test(f.url())) ?? (page.__homiePreview ? page.mainFrame() : null);

/** Open one client on `url` with the virtual clock in every frame. */
async function open(puppeteer, chrome, device, url, profiles, browsers, { preview = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'homie-studio-shoot-'));
  profiles.push(profile);
  const vp = SHOOT_DEVICES[device];
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true, userDataDir: profile, timeout: LAUNCH_TIMEOUT_MS, protocolTimeout: 180_000,
    args: [...chromeArgs(), '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', `--window-size=${vp.width},${vp.height}`, '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setViewport(vp);
  // The house's QA tag: a studio's own stats never count these visits.
  await page.setUserAgent(`${await browser.userAgent()} homie-studio-check homie-studio-shoot`);
  const errors = [];
  page.on('pageerror', (e) => { if (errors.length < 20) errors.push(String(e?.message ?? e).slice(0, 240)); });
  await page.evaluateOnNewDocument(VIRTUAL_CLOCK);
  // Every script the page really loaded, by path: the preview path checks the build's own bundle is among them.
  const loaded = new Set();
  page.on('response', (r) => { try { if (r.ok()) loaded.add(new URL(r.url()).pathname); } catch { /* not a URL */ } });
  if (preview) page.__homiePreview = true;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  return { kind: device, page, errors, loaded, t0: Date.now() };
}

const seatOf = (c) => T(c.page.evaluate(() => { const s = window.__shell; return s && s.room && s.seat !== null && s.seat !== undefined && s.stats?.role ? { room: s.room, seat: s.seat, role: s.stats.role } : null; }), 5000);
const netOf = async (c) => { const f = gameFrameOf(c.page); return f ? T(f.evaluate(() => { const n = window.__homieNet; return n ? { connected: Boolean(n.connected), offline: Boolean(n.offline) } : null; }), 5000) : null; };

/** What the game exposes about one frame (all optional): the round, the body, the renderer's counters. */
const frameFacts = (c) => { const f = gameFrameOf(c.page); return f ? T(f.evaluate(() => {
  const p = window.__homiePort; if (!p) return null;
  let i = null; try { i = p.info(); } catch (e) { i = null; }
  const r = p.rows(p.now() - 400); const last = r.length ? r[r.length - 1] : null;
  const n = (v) => (Number.isFinite(v) ? v : null);
  return { phase: i?.round?.phase ?? null, round: i?.round?.n ?? null, leftMs: n(i?.round?.leftMs), x: last ? n(last[1]) : null, y: last ? n(last[2]) : null, busy: last ? Boolean(last[8]) : null, drawCalls: n(Number(i?.extra?.drawCalls)), triangles: n(Number(i?.extra?.triangles)) };
}), 5000) : null; };

export async function shoot({ url, game, frames = 60, fps = 30, device = 'computer', out, smoke = true, hold = null, timeoutMs = 180_000, log = () => {}, preview = false, root = null }) {
  if ((!url && !preview) || !game || (preview && !root)) return { ok: false, command: 'shoot', why: 'usage: homie-studio shoot <game> --url <site> | --preview [--frames 60] [--fps 30] [--device computer|phone] [--out <dir>] [--hold <key>] [--no-smoke]' };
  if (!SHOOT_DEVICES[device]) return { ok: false, command: 'shoot', why: `unknown device ${device} (computer, phone)` };
  if (!(Number.isInteger(frames) && frames >= 1 && frames <= 1800)) return { ok: false, command: 'shoot', why: '--frames 1..1800' };
  if (!(fps >= 1 && fps <= 120)) return { ok: false, command: 'shoot', why: '--fps 1..120' };
  const chrome = findChrome();
  if (!chrome) return { ok: false, command: 'shoot', why: noChrome() };
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return { ok: false, command: 'shoot', why: 'puppeteer-core is not installed (it comes with @homie-rocks/studio; run npm install)' }; }
  // --preview: this command serves the one built game itself (no Wrangler, no rooms) and shoots that page.
  let served = null;
  if (preview) {
    served = await previewServer(root, game, { port: 0 });
    if (!served.ok) return { ...served, command: 'shoot' };
    log(`preview: serving the build of ${game} at ${served.url} (no rooms: the game plays alone, offline)`);
  }
  const base = preview ? served.url.replace(/\/+$/, '') : String(url).replace(/\/+$/, '');
  const room = preview ? null : `shoot-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
  const play = preview ? served.url : `${base}/${game}/play?room=${room}`;
  // One preflight, in the words every command uses (lib/net.mjs siteRefusal). Nothing listening on this computer
  // stops now; anything else this process was told (a name it cannot look up, an error answer) does not, because
  // the browser may still open the site, and is what the command reports if the browser cannot either.
  const cannotAsk = preview ? null : siteRefusal(await reachSite(base, { path: `/${game}/play`, timeout: 15_000 }), { command: 'shoot', play: `${base}/${game}/play` });
  if (cannotAsk?.preflight === 'local') return cannotAsk;
  mkdirSync(out, { recursive: true });
  const started = Date.now();
  const deadline = started + timeoutMs;
  const left = () => deadline - Date.now();
  const profiles = []; const browsers = [];
  const result = { ok: false, command: 'shoot', game, play, room, out, device, fps, stepMs: +(1000 / fps).toFixed(4), asked: frames, ...(preview ? { preview: true } : {}) };
  // Which build these frames are of, when this command can see the build (a studio's own site/dist): the build's
  // hash (the one `build` printed and the live site answers with) and its real bundle, by bundleOf.
  const builtDir = root ? join(root, 'site', 'dist', 'games', String(game)) : null;
  const bundle = builtDir ? bundleOf(builtDir) : null;
  if (builtDir && bundle) result.build = { hash: gameDigest(builtDir), bundle };
  try {
    let first;
    try { first = await open(puppeteer, chrome, device, play, profiles, browsers, { preview }); } catch (error) {
      if (cannotAsk) return { ...cannotAsk, play, why: `${cannotAsk.why} (The browser could not open it either: ${String(error?.message ?? error).split('\n')[0].slice(0, 120)}.)` };
      throw error;
    }
    /* ---- the two-client seat smoke */
    if (preview) {
      result.smoke = { verdict: 'NOT RUN', ok: null, why: 'the preview server has no rooms (the game plays alone, offline): two clients meeting in one room needs the whole site (homie-studio dev, then --url)' };
      // No play page, so no seat and no loading cover to wait for: the page's own load, then a moment to draw.
      await T(first.page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(30_000, Math.max(1000, left())) }), 31_000);
      await sleep(1200);
      // The page must have loaded THIS build's bundle (index.html names it; nothing here guesses at assets/main.js).
      if (bundle) {
        result.build.loaded = first.loaded.has(`/${bundle}`);
        if (!result.build.loaded) result.note = `the page did not load the build's bundle (${bundle}): these frames may not be of build ${result.build.hash}`;
      }
    } else if (smoke) {
      const second = await open(puppeteer, chrome, device === 'phone' ? 'computer' : 'phone', play, profiles, browsers);
      const clients = [first, second];
      const until = Math.min(deadline, Date.now() + 90_000);
      while (Date.now() < until) {
        for (const c of clients) c.seated ??= await seatOf(c);
        if (clients.every((c) => c.seated)) break;
        await sleep(250);
      }
      // A moment for a client that seated itself offline to be told so by the room (or to connect).
      if (clients.every((c) => c.seated)) await sleep(1500);
      for (const c of clients) c.net = c.seated ? await netOf(c) : null;
      const j = judgeSmoke(clients.map((c) => ({ kind: c.kind, seated: c.seated ?? null, net: c.net })));
      result.smoke = { ...j, clients: clients.map((c) => ({ client: c.kind, seated: c.seated ?? null, seatedMs: c.seated ? Date.now() - c.t0 : null, connection: c.net ?? 'not exposed', errors: c.errors.slice(0, 5) })) };
      log(`smoke: ${j.verdict}${j.why ? ` (${j.why})` : ''}`);
      // The second client stays in the room while the frames are shot: the pictures are of a two-player room.
    } else {
      result.smoke = { verdict: 'NOT RUN', ok: null, why: '--no-smoke' };
      const until = Math.min(deadline, Date.now() + 90_000);
      while (Date.now() < until && !(first.seated ??= await seatOf(first))) await sleep(250);
    }
    /* ---- ready: the loading cover gone (reported; the frames are shot either way, and say which they are) */
    let arrival = null; const tReady = Date.now();
    while (left() > 0 && Date.now() - tReady < 35_000) {
      arrival = await T(first.page.evaluate(() => { const a = window.__shell?.arrival; return a ? { phase: a.phase, step: a.step, liftedMs: a.liftedMs, by: a.by } : null; }), 5000);
      if (!arrival || arrival.phase === 'done') break;
      await sleep(250);
    }
    result.ready = preview ? { ready: null, by: null, liftedMs: null, waitedMs: Date.now() - tReady, why: 'the preview page is the game alone, with no play page and so no loading cover to lift: the frames start once the page had loaded' } : arrivalReadiness(arrival, { waitedMs: Date.now() - tReady });
    const gf = gameFrameOf(first.page);
    result.renderer = gf ? await T(gf.evaluate(() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return gl ? String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; } catch (e) { return null; } }), 8000) : null;
    result.software = Boolean(result.renderer && SOFTWARE_GL.test(result.renderer));
    /* ---- frames on the virtual clock */
    const all = () => first.page.frames();
    const inAll = (fn, arg) => Promise.all(all().map((f) => T(f.evaluate(fn, arg), 20_000)));
    const frozen = await inAll(() => (window.__homieClock ? (window.__homieClock.freeze(), true) : false));
    if (!frozen.some(Boolean)) { result.why = 'the virtual clock is not in the page (it was opened before the script could be injected)'; return result; }
    if (hold) await first.page.keyboard.down(hold).catch(() => {});
    const rows = [];
    for (let n = 1; n <= frames; n++) {
      if (left() < 3000) { result.partial = `stopped at frame ${n - 1} of ${frames}: the ${Math.round(timeoutMs / 1000)} s bound was reached (a slow renderer; ask for fewer frames or a longer --timeout)`; break; }
      const t = Date.now();
      // Every frame of the page steps together: the shell and the game's frame share one moment.
      const nows = await inAll((ms) => (window.__homieClock ? window.__homieClock.step(ms) : null), 1000 / fps);
      const file = `frame-${String(n).padStart(4, '0')}.png`;
      const png = await T(first.page.screenshot({ path: join(out, file), type: 'png', captureBeyondViewport: false }), 30_000);
      if (!png) { result.partial = `stopped at frame ${n - 1} of ${frames}: a screenshot did not come back in 30 s`; break; }
      rows.push({ n, file, virtualMs: +(n * (1000 / fps)).toFixed(3), clockMs: nows.find((v) => Number.isFinite(v)) ?? null, realMs: Date.now() - t, ...(await frameFacts(first) ?? {}) });
    }
    if (hold) await first.page.keyboard.up(hold).catch(() => {});
    result.frames = rows.length;
    result.realSeconds = +((Date.now() - started) / 1000).toFixed(1);
    result.virtualSeconds = +((rows.length * 1000) / fps / 1000).toFixed(3);
    result.errors = first.errors.slice(0, 10);
    result.limits = 'Stepped: requestAnimationFrame, performance.now, Date, setTimeout, setInterval, CSS and Web animations, in the page and the game\'s frame. NOT stepped: the room\'s socket and its server clock (other players and the round arrive in real time), Web Audio\'s clock, <video>, workers. These frames show what was drawn; they are not a frame rate.';
    const probed = rows.some((r) => r.phase !== undefined);
    if (!probed) result.note = [result.note, 'the game exposes no port probe (exposePort): the frames carry no round phase or position'].filter(Boolean).join('; ');
    writeFileSync(join(out, 'shoot.json'), `${JSON.stringify({ v: 1, kind: 'homie-shoot', ...result, rows }, null, 1)}\n`);
    const smokeOk = result.smoke.ok !== false;
    result.ok = rows.length === frames && smokeOk;
    if (!result.ok) result.why = !smokeOk ? `smoke: ${result.smoke.why}` : result.partial;
    return result;
  } finally {
    if (served?.server) { served.server.closeAllConnections?.(); served.server.close(); }
    for (const b of browsers) { await T(b.close(), 8000); try { b.process()?.kill('SIGKILL'); } catch { /* gone */ } }
    for (const p of profiles) rmSync(p, { recursive: true, force: true });
  }
}
