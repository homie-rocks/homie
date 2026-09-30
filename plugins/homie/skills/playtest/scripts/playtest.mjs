#!/usr/bin/env node
/**
 * playtest.mjs: play a studio's game in real browsers and come back with numbers about it:
 * how fast a stranger is in and moving, what the screen looks like on a computer and on a phone held
 * both ways, how much of it the UI covers, what the game really sounds like, and how a round goes when
 * one person plays hard and another does nothing. Then the owner tests and the two-stranger round from
 * @homie-rocks/studio. It writes pictures and a report, and a brief for a blind reviewer.
 *
 *   run <game> --url <site> [--only first,look,ui,sound,play,controls,round] [--seconds 20] [--out <dir>]
 *   review <run folder>      write REVIEW.md: the brief a fresh reviewer (a subagent that never saw the code) scores from
 *   report <run folder>      print a finished run's report again
 *
 * Headless Chrome on the GPU through puppeteer-core from the studio's node_modules (it comes with
 * @homie-rocks/studio). At most two browsers at a time. The browsers are muted: nothing plays out loud.
 * Rows say PASS, FAIL, WARN or BLOCKED; BLOCKED means this computer could not measure it (a software
 * renderer, no Chrome), which is never the same as "fine".
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStudio, readJson } from '../../music/scripts/lib/studio.mjs';
import { measure, sheetPng, warnings } from '../../sound/scripts/lib/measure.mjs';
import { wavBytes } from '../../sound/scripts/lib/synth.mjs';
import { GPU_FLAGS, chromePath, loadPuppeteer } from '../../video/scripts/lib/browser.mjs';
import { decode, motion, stats, uiCover } from './lib/pixels.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAP = readFileSync(join(HERE, '..', '..', 'video', 'scripts', 'tap.js'), 'utf8');
const argv = process.argv.slice(2);
const flags = new Map();
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags.set(k, true); else { flags.set(k, v); i++; } } else pos.push(a);
}
const JSON_OUT = flags.has('json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { if (!JSON_OUT) process.stderr.write(`${m}\n`); };
const T = (p, ms, v = null) => Promise.race([p.catch(() => v), new Promise((r) => setTimeout(() => r(v), ms))]);

const DEVICES = {
  desk: { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone-landscape': { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/* ---------------------------------------------------------------- browsers */

let puppeteer = null;
let EXE = null;
const open = [];

/** Open one muted headless GPU Chrome on the game's play page (or /tv). */
async function launch(device, url, { tap = false, autoplay = false } = {}) {
  const vp = DEVICES[device];
  const profile = mkdtempSync(join(tmpdir(), 'homie-playtest-'));
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: true, userDataDir: profile, timeout: 150_000, protocolTimeout: 120_000, // 150 s to start on a loaded computer
    args: [...GPU_FLAGS, '--mute-audio', `--window-size=${vp.width},${vp.height}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : [])],
  });
  const page = await browser.newPage();
  await page.setViewport(vp);
  const ua = vp.isMobile ? PHONE_UA : await browser.userAgent();
  await page.setUserAgent(`${ua} homie-playtest`);
  const h = { device, vp, browser, page, profile, errors: [], bad: [], t0: 0 };
  page.on('pageerror', (e) => h.errors.push(String(e?.message ?? e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') h.errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('response', (r) => { if (r.status() >= 400) h.bad.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  if (tap) await page.evaluateOnNewDocument(TAP);
  // A frame counter in every frame: rAF ticks, so a software renderer's 1-2 fps is seen before it is judged.
  await page.evaluateOnNewDocument(() => { let n = 0; const tick = () => { n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); window.__ptFrames = () => n; });
  open.push(h);
  h.t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return h;
}

async function close(h) {
  const i = open.indexOf(h);
  if (i >= 0) open.splice(i, 1);
  try { await T(h.browser.close(), 8000); } catch { /* */ }
  try { h.browser.process()?.kill('SIGKILL'); } catch { /* */ }
  rmSync(h.profile, { recursive: true, force: true });
}

const gameFrame = (h) => h.page.frames().find((f) => /\/__game\//.test(f.url())) ?? null;
async function waitFrame(h, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const f = gameFrame(h); if (f) return f; await sleep(200); }
  return null;
}
const shell = (h) => T(h.page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat, role: s.stats?.role ?? null, round: s.round, results: s.results } : null; }), 5000);
const inFrame = async (h, fn, arg) => { const f = gameFrame(h); return f ? T(f.evaluate(fn, arg), 8000) : null; };
const probeInfo = (h) => inFrame(h, () => { const p = window.__homiePort; if (!p) return null; const i = p.info(); return { view: p.view, size: p.size, keys: p.keys, thumb: p.thumb, world: p.world, info: i, now: p.now() }; });
const selfAt = (h, since) => inFrame(h, (s) => { const p = window.__homiePort; if (!p) return null; const rows = p.rows(s); return rows.length ? rows[rows.length - 1] : null; }, since);
const frameNow = (h) => inFrame(h, () => performance.now());

async function screenshot(h) { return T(h.page.screenshot({ type: 'png', captureBeyondViewport: false }), 15_000); }

/** Play like a person: hold a direction for most of a second, now and then press the action, change your mind. */
async function playFor(h, seconds, probe, { rng = Math.random } = {}) {
  const until = Date.now() + seconds * 1000;
  const keys = probe?.keys ?? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const dirs = ['up', 'right', 'down', 'left'];
  let presses = 0;
  const times = [];
  while (Date.now() < until) {
    const d = dirs[Math.floor(rng() * 4)];
    const hold = 500 + Math.floor(rng() * 900);
    times.push(Date.now());
    if (h.vp.hasTouch) await drag(h, d, hold, probe);
    else { await h.page.keyboard.down(keys[d]).catch(() => {}); await sleep(hold); await h.page.keyboard.up(keys[d]).catch(() => {}); }
    presses++;
    if (rng() < 0.3) {
      times.push(Date.now());
      if (h.vp.hasTouch) { await h.page.touchscreen.tap(Math.round(h.vp.width * 0.82), Math.round(h.vp.height * 0.78)).catch(() => {}); }
      else { await h.page.keyboard.press('Space').catch(() => {}); }
      presses++;
    }
    await sleep(80 + Math.floor(rng() * 200));
  }
  return { presses, times };
}

/** A thumb lands where the game's stick lives, slides 70 px the pressed way in small steps, holds, lifts. */
async function drag(h, dir, hold, probe) {
  const [fx, fy] = probe?.thumb ?? [0.24, 0.74];
  const x = Math.round(h.vp.width * fx); const y = Math.round(h.vp.height * fy);
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const ts = h.page.touchscreen;
  try {
    await ts.touchStart(x, y);
    for (let k = 1; k <= 6; k++) { await ts.touchMove(x + v[0] * 12 * k, y + v[1] * 12 * k); await sleep(16); }
    const until = Date.now() + hold;
    let w = 0;
    while (Date.now() < until) { w++; await ts.touchMove(x + v[0] * 72 + (w % 2), y + v[1] * 72); await sleep(60); }
    await ts.touchEnd();
  } catch { /* a closed page */ }
}

/* ---------------------------------------------------------------- rows */

const rows = [];
const row = (name, verdict, detail = {}) => { rows.push({ name, verdict, ...detail }); log(`${verdict.padEnd(7)} ${name}${detail.why ? `: ${detail.why}` : ''}`); };

/**
 * One device, one browser: the first seconds (seated, first real frame, first move), the look during play,
 * and how much of the screen the UI covers.
 */
async function deviceSession(device, base, game, out, seconds, only) {
  const h = await launch(device, `${base}/${game}/play`);
  const shots = [];
  const save = async (name, png) => { if (!png) return null; const f = join(out, `${device}-${name}.png`); writeFileSync(f, png); return f; };
  try {
    // First seconds: seated, a first frame that is a picture (not black, not one colour).
    let seatedMs = null; let firstFrameMs = null; let framePng = null;
    const marks = [1000, 3000, 5000, 10000];
    const firstShots = [];
    const until = h.t0 + 30_000;
    while (Date.now() < until && (seatedMs === null || firstFrameMs === null || marks.length)) {
      const s = await shell(h);
      if (seatedMs === null && s?.room && s.seat !== null && s.seat !== undefined && s.role) seatedMs = Date.now() - h.t0;
      const el = Date.now() - h.t0;
      if (firstFrameMs === null || (marks.length && el >= marks[0])) {
        const png = await screenshot(h);
        if (png) {
          const st = stats(decode(png, 320));
          if (firstFrameMs === null && !st.black && !st.flat) { firstFrameMs = el; framePng = png; }
          if (marks.length && el >= marks[0]) { const m = marks.shift(); firstShots.push({ at: m, file: await save(`first-${m / 1000}s`, png), ...st }); }
        }
      }
      await sleep(250);
    }
    const frame = await waitFrame(h, 5000);
    const probe = await probeInfo(h);
    const fps = frame ? await T(frame.evaluate(() => new Promise((r) => { const a = window.__ptFrames?.() ?? 0; setTimeout(() => r(((window.__ptFrames?.() ?? 0) - a) / 2), 2000); })), 6000) : null;
    const renderer = frame ? await T(frame.evaluate(() => { try { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return null; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch { return null; } }), 5000) : null;
    // First move: press one way and time until my own body moves (the port probe says where it is).
    let controlMs = null; let controlHow = 'no port probe (exposePort): not measured';
    if (probe) {
      const t0 = await frameNow(h);
      const before = await selfAt(h, t0 - 500);
      const started = Date.now();
      const press = playFor(h, 1.6, probe, { rng: () => 0.26 });
      while (Date.now() - started < 3000) {
        const now = await selfAt(h, t0);
        if (before && now && Number.isFinite(before[1]) && Math.hypot(now[1] - before[1], now[2] - before[2]) > (probe.size || 10) * 0.5) { controlMs = Date.now() - started; break; }
        await sleep(40);
      }
      await press;
      controlHow = controlMs === null ? 'a press did not move my body within 3 s' : 'from the press to my body moving half its size';
    }
    const slow = fps !== null && fps < 20;
    const soft = /swiftshader|llvmpipe|software/i.test(String(renderer ?? ''));
    if (only.has('first')) {
      const why = seatedMs === null ? 'never got a seat in 30 s' : firstFrameMs === null ? 'no real picture (black or one colour) in 30 s' : seatedMs > 10_000 ? `seated only after ${(seatedMs / 1000).toFixed(1)} s` : firstFrameMs > 10_000 ? `the first real picture came at ${(firstFrameMs / 1000).toFixed(1)} s` : controlMs === null && probe ? controlHow : controlMs !== null && controlMs > 1500 ? `the body answered a press after ${controlMs} ms` : undefined;
      const verdict = slow || soft ? 'BLOCKED' : why ? 'FAIL' : 'PASS';
      row(`first ${device}`, verdict, { why: slow || soft ? `this browser renders at ${fps} fps on "${renderer}": a software renderer makes any game look stuck, so nothing here is judged (run on a computer with a GPU)` : why, seatedMs, firstFrameMs, controlMs, controlHow, fps, renderer, shots: firstShots.map((s) => rel(out, s.file)) });
    }
    if (framePng) await save('first-frame', framePng);
    // The look, while playing like a person.
    if (only.has('look')) {
      const lookShots = [];
      const playing = playFor(h, seconds, probe);
      const every = Math.max(2500, (seconds * 1000) / 6);
      let prev = null;
      for (let t = 0; t < seconds * 1000 - 500; t += every) {
        await sleep(t === 0 ? 1500 : every);
        const png = await screenshot(h);
        if (!png) continue;
        const img = decode(png, 480);
        const st = stats(img);
        const mv = prev ? motion(prev, img) : null;
        prev = img;
        lookShots.push({ file: rel(out, await save(`look-${lookShots.length + 1}`, png)), motion: mv, ...st });
      }
      const { presses } = await playing;
      const black = lookShots.filter((s) => s.black || s.flat).length;
      const dead = lookShots.filter((s) => s.flatBlackShare > 0.05).length;
      const plain = lookShots.filter((s) => s.flatDarkShare > 0.3).length;
      const still = lookShots.filter((s) => s.motion !== null && s.motion < 0.002).length;
      const avg = (k) => +(lookShots.reduce((a, s) => a + s[k], 0) / Math.max(1, lookShots.length)).toFixed(3);
      const notes = [];
      if (avg('mean') < 40) notes.push(`dark: mean brightness ${avg('mean')} of 255`);
      if (avg('sd') < 22) notes.push(`low contrast: luma spread ${avg('sd')}`);
      if (avg('edges') < 0.03) notes.push(`little visible detail (${(avg('edges') * 100).toFixed(1)}% edge pixels): flat shapes read as unfinished`);
      if (plain >= 2) notes.push(`over 30% of the screen is one flat dark colour in ${plain} shots: an empty backdrop reads as unfinished; give the floor texture, light or props`);
      if (still >= 2) notes.push(`${still} pairs of shots barely changed while playing: is anything moving?`);
      const why = black ? `${black} of ${lookShots.length} shots were black or one colour while playing` : dead >= 2 ? `${dead} shots have pure-black holes over 5% of the screen: nothing drew there (a failed shader, a world that never loaded, the clear colour)` : undefined;
      row(`look ${device}`, slow || soft ? 'BLOCKED' : why ? 'FAIL' : notes.length ? 'WARN' : 'PASS', { why: why ?? (notes.length ? notes.join('; ') : undefined), presses, mean: avg('mean'), contrast: avg('sd'), saturation: avg('saturation'), edges: avg('edges'), shots: lookShots });
    }
    // UI cover: the world hidden, the page's background black and then white; what stays is the UI.
    if (only.has('ui') && h.vp.isMobile) {
      const world = probe?.world ?? null;
      const paint = async (bg) => {
        await T(h.page.evaluate((c) => { let s = document.getElementById('__pt_ui'); if (!s) { s = document.createElement('style'); s.id = '__pt_ui'; document.head.appendChild(s); } s.textContent = c ? `html,body,iframe.game{background:${c}!important}` : ''; }, bg), 5000);
        await inFrame(h, ([c, sel]) => { let s = document.getElementById('__pt_ui'); if (!s) { s = document.createElement('style'); s.id = '__pt_ui'; (document.head || document.documentElement).appendChild(s); } s.textContent = c ? `canvas,video${sel ? `,${sel}` : ''}{visibility:hidden!important} html,body{background:${c}!important;background-image:none!important}` : ''; }, [bg, world]);
        await sleep(350);
      };
      await playFor(h, 1.2, probe);
      // Self-check (PLAYTEST_UI_SELFCHECK=1): a known opaque panel, a third of the width square, in the middle of the game.
      if (process.env.PLAYTEST_UI_SELFCHECK) await inFrame(h, () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:33.4%;top:40%;width:33.2vw;height:33.2vw;background:#345;z-index:99999'; document.body.appendChild(d); });
      await paint('#000'); const a = await screenshot(h);
      await paint('#fff'); const b = await screenshot(h);
      await paint(null);
      if (a && b) {
        const cov = uiCover(decode(a, 390), decode(b, 390));
        await save('ui-on-black', a);
        const why = cov.cover > 0.12 ? `the UI covers ${Math.round(cov.cover * 100)}% of the screen during play (the bar is 12%)` : cov.centreOpaque > 0.02 ? `something opaque covers ${Math.round(cov.centreOpaque * 100)}% of the middle third` : undefined;
        row(`ui ${device}`, why ? 'FAIL' : 'PASS', { why, ...cov, note: 'a HUD drawn inside the canvas is not counted (it is hidden with the world); DOM panels, chips, buttons and the page shell are', shot: rel(out, join(out, `${device}-ui-on-black.png`)) });
      } else row(`ui ${device}`, 'BLOCKED', { why: 'no screenshot' });
    }
    return { errors: h.errors, bad: h.bad, probe: Boolean(probe) };
  } finally { await close(h); }
}

/** What the game really sounds like: its own Web Audio output copied off the graph for `seconds` of play. */
async function soundSession(base, game, out, seconds) {
  const h = await launch('desk', `${base}/${game}/play`, { tap: true });
  try {
    const frame = await waitFrame(h, 30_000);
    if (!frame) { row('sound', 'BLOCKED', { why: 'the game frame never opened' }); return; }
    await sleep(2500);
    const probe = await probeInfo(h);
    const pre = await inFrame(h, () => window.__homieTap?.clock?.() ?? null);
    // The first gesture: a click in the middle of the game, then keys.
    const gestureWall = Date.now();
    await h.page.mouse.click(Math.round(h.vp.width / 2), Math.round(h.vp.height / 2)).catch(() => {});
    let runningMs = null;
    for (let k = 0; k < 30; k++) { const c = await inFrame(h, () => window.__homieTap?.clock?.() ?? null); if (c?.state === 'running') { runningMs = Date.now() - gestureWall; break; } await sleep(100); }
    await inFrame(h, () => window.__homieTap?.start?.());
    const gestureClock = await inFrame(h, () => window.__homieTap?.clock?.() ?? null);
    const runs = [];
    const presses = [];
    const pull = async () => { const r = await inFrame(h, () => window.__homieTap?.take?.() ?? []); if (Array.isArray(r)) runs.push(...r); };
    const until = Date.now() + seconds * 1000;
    const keys = probe?.keys ?? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    const seq = ['right', 'up', 'left', 'down'];
    let i = 0;
    while (Date.now() < until) {
      const c = await inFrame(h, () => window.__homieTap?.clock?.() ?? null);
      const k = i % 5 === 4 ? 'Space' : keys[seq[i % 4]];
      if (c?.now !== undefined) presses.push({ ctx: c.now, key: k });
      await h.page.keyboard.down(k).catch(() => {}); await sleep(k === 'Space' ? 90 : 700); await h.page.keyboard.up(k).catch(() => {});
      i++;
      await sleep(250);
      if (i % 3 === 0) await pull();
    }
    await pull();
    const post = await inFrame(h, () => ({ clock: window.__homieTap?.clock?.() ?? null, sound: window.__homieSound?.stats ?? null }));
    const ctxs = post?.clock?.ctxs ?? 0;
    const rate = post?.clock?.rate ?? 48000;
    if (!ctxs) { row('sound', 'FAIL', { why: 'the game made no Web Audio context: it is silent (or plays only <audio> elements, which this capture cannot hear)', runningMs }); return; }
    if (!runs.length) { row('sound', 'FAIL', { why: `the game's audio never ran after the first click and keys (context ${post?.clock?.state ?? '?'})`, runningMs }); return; }
    // Lay the captured runs onto one timeline by their context frames; gaps stay silent.
    const f0 = Math.min(...runs.map((r) => r.f));
    const f1 = Math.max(...runs.map((r) => r.f + r.frames));
    const L = new Float32Array(f1 - f0); const R = new Float32Array(f1 - f0);
    for (const r of runs) {
      const b = Buffer.from(r.b64, 'base64');
      const s = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
      for (let k = 0; k < r.frames; k++) { L[r.f - f0 + k] = s[2 * k] / 32768; R[r.f - f0 + k] = s[2 * k + 1] / 32768; }
    }
    const wav = join(out, 'sound-capture.wav');
    writeFileSync(wav, wavBytes({ L, R }, { bits: 16, rate }));
    const m = measure(wav, { rate: 48000 });
    let sheet = null; try { sheet = rel(out, sheetPng(wav, join(out, 'sound-capture.png'))); } catch { /* */ }
    // Did presses answer with sound? An onset (10 ms energy 6 dB over the 300 ms before) within 250 ms of a press.
    const env = [];
    const w = Math.round(rate * 0.01);
    for (let k = 0; k + w <= L.length; k += w) { let e = 0; for (let j = k; j < k + w; j++) e += L[j] * L[j] + R[j] * R[j]; env.push(e / w); }
    const t0 = f0 / rate;
    // Movement holds owe no sound; an action (a button, the space bar) does.
    const judge = (list) => {
      let yes = 0; let n = 0;
      for (const p of list) {
        const at = Math.round((p.ctx - t0) / 0.01);
        if (at < 30 || at + 25 >= env.length) continue;
        n++;
        const before = env.slice(at - 30, at).reduce((a, v) => a + v, 0) / 30;
        const after = Math.max(...env.slice(at, at + 25));
        if (after > before * 4 && after > 1e-7) yes++;
      }
      return { yes, n };
    };
    const act = judge(presses.filter((p) => p.key === 'Space'));
    const mov = judge(presses.filter((p) => p.key !== 'Space'));
    const answered = act.yes; const judged = act.n;
    const firstLoud = (() => { const floor = 10 ** (-50 / 20); for (let k = 0; k < L.length; k++) if (Math.abs(L[k]) > floor || Math.abs(R[k]) > floor) return k; return -1; })();
    const firstSoundMs = firstLoud < 0 || !gestureClock ? null : Math.max(0, Math.round(((f0 + firstLoud) / rate - (gestureClock.now ?? 0)) * 1000));
    const warn = warnings(m, 'capture');
    const answerShare = judged ? +(answered / judged).toFixed(2) : null;
    if (answerShare !== null && answerShare < 0.5) warn.push(`only ${answered} of ${judged} action presses (space) were followed by a sound within 250 ms: give every action a sound`);
    if (m.loudness.lufs !== null && m.loudness.lufs < -32) warn.push(`very quiet: ${m.loudness.lufs} LUFS while playing (a phone at half volume will hear almost nothing)`);
    if (m.silentShare > 0.5) warn.push(`${Math.round(m.silentShare * 100)}% of the time was silent while someone played: no music bed?`);
    const verdict = m.samplePeakDb !== null && m.samplePeakDb < -60 ? 'FAIL' : m.clippedSamples > 0 ? 'FAIL' : warn.length ? 'WARN' : 'PASS';
    row('sound', verdict, {
      why: verdict === 'FAIL' ? (m.clippedSamples > 0 ? `${m.clippedSamples} clipped samples: it distorts` : 'the capture is silent after the first click') : warn.join('; ') || undefined,
      contexts: ctxs, before: pre?.state ?? null, runningAfterGestureMs: runningMs, firstSoundMs, seconds: m.seconds, actionPresses: judged, answered, answerShare, movesWithSound: `${mov.yes} of ${mov.n}`,
      loudness: m.loudness, samplePeakDb: m.samplePeakDb, clippedSamples: m.clippedSamples, silentShare: m.silentShare, gaps: m.gaps.slice(0, 5), bands: m.bands, under300Share: m.under300Share, onsetsPerSecond: m.onsetsPerSecond,
      soundJs: post?.sound ? { plays: post.sound.plays?.length ?? 0, names: [...new Set((post.sound.plays ?? []).map((p) => p.name))], missing: post.sound.missing, music: post.sound.music, errors: post.sound.errors } : null,
      capture: rel(out, wav), sheet,
    });
  } finally { await close(h); }
}

/** A round with one person playing hard (a computer) and one doing nothing (a phone), both strangers in the public room. */
async function playSession(base, game, out, roundSeconds) {
  const active = await launch('desk', `${base}/${game}/play`);
  const idle = await launch('phone', `${base}/${game}/play`);
  try {
    const seat = async (h) => { const until = Date.now() + 45_000; while (Date.now() < until) { const s = await shell(h); if (s?.room && s.seat !== null && s.seat !== undefined && s.role) return s; await sleep(300); } return null; };
    const [sa, si] = await Promise.all([seat(active), seat(idle)]);
    if (!sa || !si) { row('play', 'FAIL', { why: 'a browser never got a seat in 45 s' }); return; }
    if (sa.room !== si.room) { row('play', 'FAIL', { why: `the two browsers landed in different rooms (${sa.room}, ${si.room}): two strangers who press Play must meet` }); return; }
    const since = Date.now();
    // Only a round that STARTS after both are seated counts: a newcomer takes a bot's place mid-round and inherits
    // its body and score, so the round already running says nothing about how these two played.
    let at0 = null;
    for (let k = 0; k < 40 && !at0; k++) { at0 = (await shell(active))?.round ?? null; if (!at0) await sleep(250); }
    const minN = (at0?.n ?? 0) + 1;
    const probe = await probeInfo(active);
    const scores = [];
    let lastLive = null; let liveSeenAt = null; let overAt = null; let result = null;
    const budget = (roundSeconds * 2 + 60) * 1000;
    const playing = (async () => { while (!result && Date.now() - since < budget) await playFor(active, 4, probe); })();
    while (!result && Date.now() - since < budget) {
      const [a, b] = await Promise.all([shell(active), shell(idle)]);
      const pa = await inFrame(active, () => window.__homiePort?.info?.().score ?? null);
      const pi = await inFrame(idle, () => window.__homiePort?.info?.().score ?? null);
      if ((a?.round?.n ?? 0) >= minN) scores.push({ t: Math.round((Date.now() - since) / 1000), active: pa, idle: pi });
      const r = a?.round;
      if (r?.phase === 'live' && r.n >= minN) { if (!lastLive || lastLive.n !== r.n) liveSeenAt = Date.now(); lastLive = r; }
      const hit = (a?.results ?? []).find((x) => x.at > since && x.n >= minN && x.results.some((row0) => row0.seat === sa.seat) && x.results.some((row0) => row0.seat === si.seat));
      if (hit) { result = hit; overAt = Date.now(); }
      void b;
      await sleep(1000);
    }
    await playing.catch(() => {});
    const shot = await screenshot(active);
    if (shot) writeFileSync(join(out, 'play-round-over.png'), shot);
    if (!result) { row('play', 'FAIL', { why: `no round finished with both of them in its results within ${Math.round(budget / 1000)} s`, scores: scores.slice(-10) }); return; }
    const rowsR = result.results;
    const me = rowsR.find((x) => x.seat === sa.seat); const them = rowsR.find((x) => x.seat === si.seat);
    const planned = lastLive ? Math.round((lastLive.endsAt - lastLive.startedAt) / 1000) : null;
    const watched = liveSeenAt && overAt ? Math.round((overAt - liveSeenAt) / 1000) : null;
    let changes = 0; let lead = null;
    for (const s of scores) { if (s.active === null || s.idle === null) continue; const l = s.active > s.idle ? 'active' : s.idle > s.active ? 'idle' : lead; if (lead && l !== lead) changes++; lead = l; }
    const notes = [];
    if (me && them && them.score >= me.score) notes.push(`the player who pressed nothing scored ${them.score}, the one who played ${me.score}: input barely matters to the score`);
    if (me && me.score === 0) notes.push('a person playing hard for a whole round scored 0');
    if (planned && roundSeconds && Math.abs(planned - roundSeconds) > roundSeconds * 0.2) notes.push(`the round was set to ${planned} s but game.json says ${roundSeconds} s`);
    if (rowsR.length && rowsR.every((x) => x.score === rowsR[0].score)) notes.push('every player finished on the same score');
    const bestBot = Math.max(-Infinity, ...rowsR.filter((x) => x.bot).map((x) => x.score));
    const bestHuman = Math.max(-Infinity, ...rowsR.filter((x) => !x.bot).map((x) => x.score));
    if (Number.isFinite(bestBot) && Number.isFinite(bestHuman) && bestBot > Math.max(3 * bestHuman, bestHuman + 10)) notes.push(`a bot outscored every person ${bestBot} to ${bestHuman}: people cannot win against the bots (tune the bots to a person's pace, or rubber-band them against the leading person)`);
    row('play', notes.length ? 'WARN' : 'PASS', {
      why: notes.join('; ') || undefined, room: sa.room, round: result.n, plannedSeconds: planned, watchedSeconds: watched, players: rowsR.length, bots: rowsR.filter((x) => x.bot).length,
      active: me ? { place: me.place, score: me.score } : null, idle: them ? { place: them.place, score: them.score } : null, leadChanges: changes,
      results: rowsR.map((x) => ({ place: x.place, score: x.score, bot: x.bot, who: x.seat === sa.seat ? 'the active player' : x.seat === si.seat ? 'the idle player' : x.bot ? 'a bot' : 'another person' })),
      scoreSamples: scores.filter((_, k) => k % 5 === 0).slice(0, 40), shot: 'play-round-over.png',
    });
  } finally { await close(active); await close(idle); }
}

/** The studio's own checks, run as the creator would: the owner tests (port check) and the two-stranger round. */
function studioCheck(root, args, name, timeoutMs) {
  return new Promise((ok) => {
    const bin = join(root, 'node_modules', '.bin', 'homie-studio');
    if (!existsSync(bin)) { row(name, 'BLOCKED', { why: '@homie-rocks/studio is not installed in this studio (npm install)' }); ok(null); return; }
    const child = spawn(bin, [...args, '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let outText = '';
    child.stdout.on('data', (d) => { outText += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* */ } }, timeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      let j = null; try { j = JSON.parse(outText); } catch { /* */ }
      if (!j) { row(name, 'BLOCKED', { why: `homie-studio ${args.join(' ')} gave no result (timed out after ${Math.round(timeoutMs / 1000)} s?)` }); ok(null); return; }
      ok(j);
    });
  });
}

/* ---------------------------------------------------------------- run */

async function run() {
  const game = pos[1];
  const url = String(flags.get('url') ?? '').replace(/\/+$/, '');
  if (!game || !/^https?:\/\//.test(url)) throw new Error('usage: run <game> --url <site> (http://127.0.0.1:8787 from npm run dev, or the live site)');
  const root = findStudio();
  const only = new Set(String(flags.get('only') ?? 'first,look,ui,sound,play,controls,round').split(',').map((s) => s.trim()));
  const seconds = Math.max(8, Math.min(120, Number(flags.get('seconds') ?? 20)));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const out = resolve(String(flags.get('out') ?? (root ? join(root, '.playtest', game, stamp) : join(process.cwd(), '.playtest', game, stamp))));
  mkdirSync(out, { recursive: true });
  if (root) {
    const gi = join(root, '.gitignore');
    const text = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    if (!/^\.playtest\/?$/m.test(text)) appendFileSync(gi, `${text.endsWith('\n') || !text ? '' : '\n'}.playtest/\n`);
  }
  try { const f = statfsSync(out); if ((f.bavail * f.bsize) / 1e9 < 10) throw new Error('under 10 GB free on this disk: free some space before a playtest'); } catch (e) { if (/GB free/.test(e.message)) throw e; }
  const alive = await fetch(`${url}/${game}/play`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok).catch(() => false);
  if (!alive) throw new Error(`${url}/${game}/play does not answer: start the site (npm run dev, as a background task that outlives this command) or check the address`);
  EXE = chromePath();
  puppeteer = loadPuppeteer(root);
  if (!EXE || !puppeteer) throw new Error(!EXE ? 'no Chrome found (set CHROME_PATH to a Chrome or Chromium)' : 'puppeteer-core is not installed (it comes with @homie-rocks/studio: npm install in the studio)');
  const gameJson = root ? readJson(join(root, 'games', game, 'game.json'), {}) : {};
  const started = Date.now();
  const errors = [];
  const bad = [];
  let probed = false;
  for (const device of ['desk', 'phone', 'phone-landscape']) {
    if (!['first', 'look', 'ui'].some((k) => only.has(k))) break;
    log(`… ${device}: first seconds, the look while playing, the UI`);
    const r = await deviceSession(device, url, game, out, seconds, only);
    errors.push(...r.errors.map((e) => `${device}: ${e}`)); bad.push(...r.bad.map((e) => `${device}: ${e}`)); probed ||= r.probe;
  }
  if (only.has('sound')) { log('… sound: the game\'s own audio while someone plays'); await soundSession(url, game, out, Math.max(15, seconds)); }
  if (only.has('play')) { log('… play: a round with one person playing hard and one doing nothing'); await playSession(url, game, out, Number(gameJson.roundSeconds ?? 90)); }
  if (only.has('controls') && root) {
    log('… controls: the owner tests (homie-studio port check)');
    const pc = await studioCheck(root, ['port', 'check', game, '--url', url, '--only', 'owner-desk,owner-phone,owner-iphone,ui-cover,life,tv,audio,errors', '--shots', join(out, 'port-check')], 'controls', 9 * 60_000);
    if (pc) {
      const failed = (pc.rows ?? []).filter((x) => x.ok === false);
      // A skipped row (no WebKit for the iPhone, say) was not tested: that is never a pass.
      const skipped = (pc.rows ?? []).filter((x) => x.ok === null || x.ok === undefined);
      const verdict = failed.length ? 'FAIL' : !pc.rows?.length ? 'BLOCKED' : skipped.length ? 'WARN' : 'PASS';
      const why = failed.length ? failed.map((x) => `${x.name}: ${x.why ?? 'failed'}`).join('; ') : !pc.rows?.length ? pc.why : skipped.length ? `not tested: ${skipped.map((x) => `${x.name} (${x.why ?? 'skipped'})`).join('; ')}` : undefined;
      row('controls', verdict, { why, rows: (pc.rows ?? []).map((x) => ({ name: x.name, ok: x.ok, why: x.why ?? null })), receipt: 'port-check/receipt.json' });
    }
  }
  if (only.has('round') && root) {
    log('… round: two fresh browsers press Play and finish a round together (homie-studio check)');
    const ck = await studioCheck(root, ['check', game, '--url', url, '--shots', join(out, 'round')], 'round', 5 * 60_000);
    if (ck) row('round', ck.ok ? 'PASS' : 'FAIL', { why: ck.ok ? undefined : ck.why, room: ck.room, seats: ck.seats, round: ck.round ? { n: ck.round.n, humans: ck.round.humans, bots: ck.round.bots } : null, seconds: ck.totalMs ? Math.round(ck.totalMs / 1000) : null });
  }
  const uniq = (xs) => [...new Set(xs)].slice(0, 30);
  row('errors', errors.length ? 'FAIL' : bad.length ? 'WARN' : 'PASS', { why: errors.length ? `${errors.length} uncaught error(s) or console errors, first: ${errors[0]}` : bad.length ? `${bad.length} failed request(s), first: ${bad[0]}` : undefined, errors: uniq(errors), requests: uniq(bad) });
  const report = { v: 1, game, url, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), probe: probed, rows, weak: weakest(rows) };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(out, 'REPORT.md'), reportMd(report, out));
  await sheets(out, root);
  return { ok: !rows.some((r) => r.verdict === 'FAIL'), command: 'run', game, out, report: join(out, 'REPORT.md'), seconds: report.seconds, rows: rows.map((r) => `${r.verdict.padEnd(7)} ${r.name}${r.why ? `: ${r.why}` : ''}`), weak: report.weak, next: `node playtest.mjs review ${relative(process.cwd(), out) || '.'} (then hand REVIEW.md to a fresh reviewer)` };
}

/** What is weakest, most important first: failures, then warnings, each in one line with its evidence. */
function weakest(rs) {
  const order = { FAIL: 0, BLOCKED: 1, WARN: 2 };
  const weight = { round: 0, play: 1, controls: 2, first: 3, sound: 4, look: 5, ui: 6, errors: 7 };
  return rs.filter((r) => r.verdict !== 'PASS').sort((a, b) => order[a.verdict] - order[b.verdict] || (weight[a.name.split(' ')[0]] ?? 9) - (weight[b.name.split(' ')[0]] ?? 9)).map((r) => `${r.verdict} ${r.name}: ${r.why ?? 'see the report'}`);
}

function reportMd(rep, out) {
  const L = [`# Playtest: ${rep.game}`, '', `${rep.url} · ${rep.at} · ${rep.seconds} s · port probe: ${rep.probe ? 'yes' : 'no (owner tests cannot see the body; see the port skill)'}`, ''];
  L.push('## What is weak', '', ...(rep.weak.length ? rep.weak.map((w) => `- ${w}`) : ['- Nothing the instruments can see. That is not the same as fun: read the review.']), '');
  L.push('## Rows', '', '| row | verdict | numbers |', '| --- | --- | --- |');
  for (const r of rep.rows) {
    const nums = Object.entries(r).filter(([k, v]) => !['name', 'verdict', 'why', 'shots', 'rows', 'results', 'scoreSamples', 'errors', 'requests', 'note', 'soundJs', 'gaps', 'seats'].includes(k) && v !== null && v !== undefined && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ');
    L.push(`| ${r.name} | ${r.verdict} | ${nums.replace(/\|/g, '/')} |`);
  }
  L.push('', 'Pictures: `sheet-*.png` (contact sheets), `*-first-*.png`, `*-look-*.png`, `*-ui-on-black.png`, `sound-capture.png`, `play-round-over.png`. Look at them before believing any number here.', '');
  void out;
  return `${L.join('\n')}\n`;
}

/** Contact sheets of a run's pictures, labelled (drawn in Chrome, so no font setup). */
async function sheets(out, root) {
  const { htmlToPng } = await import('../../video/scripts/lib/browser.mjs');
  const rep = readJson(join(out, 'report.json'), { rows: [] });
  const groups = [];
  for (const device of ['desk', 'phone', 'phone-landscape']) {
    const first = rep.rows.find((r) => r.name === `first ${device}`);
    const look = rep.rows.find((r) => r.name === `look ${device}`);
    const cells = [...(first?.shots ?? []).map((f, i) => ({ file: f, label: `${device} · ${[1, 3, 5, 10][i]} s after opening` })), ...(look?.shots ?? []).map((s, i) => ({ file: s.file, label: `${device} · playing, shot ${i + 1} · brightness ${s.mean} · contrast ${s.sd} · detail ${(s.edges * 100).toFixed(1)}%` }))];
    if (cells.length) groups.push({ name: device, cells, wide: DEVICES[device].width > DEVICES[device].height });
  }
  for (const g of groups) {
    const cols = g.wide ? 3 : 5;
    const cw = g.wide ? 560 : 300;
    const ch = g.wide ? Math.round(cw * (g.name === 'desk' ? 800 / 1280 : 390 / 844)) : Math.round(cw * 844 / 390);
    const imgs = g.cells.filter((c) => c.file && existsSync(join(out, c.file))).map((c) => `<figure><img src="data:image/png;base64,${readFileSync(join(out, c.file)).toString('base64')}"><figcaption>${c.label.replace(/</g, '&lt;')}</figcaption></figure>`);
    if (!imgs.length) continue;
    const rowsN = Math.ceil(imgs.length / cols);
    const W = cols * (cw + 12) + 12; const H = rowsN * (ch + 40) + 12;
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#ddd;font:13px/1.3 system-ui,sans-serif}main{display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:12px;padding:12px}figure{margin:0}img{width:${cw}px;height:${ch}px;object-fit:contain;background:#000;display:block}figcaption{padding-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><main>${imgs.join('')}</main>`;
    try { await htmlToPng(root, html, join(out, `sheet-${g.name}.png`), { width: W, height: H }); } catch (e) { log(`sheet ${g.name}: ${e.message}`); }
  }
}

/* ---------------------------------------------------------------- review */

function review() {
  const out = resolve(String(pos[1] ?? ''));
  const rep = readJson(join(out, 'report.json'), null);
  if (!rep) throw new Error('usage: review <run folder> (the folder a run wrote, with report.json)');
  const brief = readFileSync(join(HERE, '..', 'references', 'REVIEWER.md'), 'utf8');
  const pics = ['sheet-desk.png', 'sheet-phone.png', 'sheet-phone-landscape.png', 'desk-first-frame.png', 'phone-ui-on-black.png', 'phone-landscape-ui-on-black.png', 'sound-capture.png', 'play-round-over.png'].filter((f) => existsSync(join(out, f)));
  const numbers = rep.rows.map((r) => `- ${r.verdict} ${r.name}${r.why ? `: ${r.why}` : ''}`).join('\n');
  const text = brief
    .replaceAll('{{GAME}}', rep.game)
    .replaceAll('{{URL}}', `${rep.url}/${rep.game}/play`)
    .replaceAll('{{FOLDER}}', out)
    .replaceAll('{{PICTURES}}', pics.map((p) => `- \`${join(out, p)}\``).join('\n') || '- (none: the run made no pictures)')
    .replaceAll('{{NUMBERS}}', numbers);
  writeFileSync(join(out, 'REVIEW.md'), text);
  return { ok: true, command: 'review', brief: join(out, 'REVIEW.md'), pictures: pics.length, how: 'Give the WHOLE TEXT of REVIEW.md, as it is, to a FRESH reviewer that has not seen the code, the plan or your summary (Claude Code: the Agent tool, with the file\'s full contents as the prompt, not its path or a summary of it; Codex: a new session). Add nothing about the code or what you changed. It plays the game itself and saves VERDICT.json in the run folder.' };
}

function showReport() {
  const out = resolve(String(pos[1] ?? ''));
  const rep = readJson(join(out, 'report.json'), null);
  if (!rep) throw new Error('usage: report <run folder>');
  return { ok: !rep.rows.some((r) => r.verdict === 'FAIL'), command: 'report', game: rep.game, rows: rep.rows.map((r) => `${r.verdict.padEnd(7)} ${r.name}${r.why ? `: ${r.why}` : ''}`), weak: rep.weak, report: join(out, 'REPORT.md') };
}

const rel = (out, f) => (f ? relative(out, f) : null);

async function main() {
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || flags.has('help')) {
    const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
    return { ok: true, command: 'help', usage: head.replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, '').trim() };
  }
  if (cmd === 'run') return run();
  if (cmd === 'review') return review();
  if (cmd === 'report') return showReport();
  return { ok: false, command: cmd, why: `unknown command "${cmd}" (playtest.mjs help)` };
}

const print = (o) => {
  if (JSON_OUT) { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); return; }
  if (o.ok === false && o.why) { process.stdout.write(`playtest: ${o.why}\n`); return; }
  const lines = [];
  for (const [k, v] of Object.entries(o)) if (k !== 'ok' && k !== 'command') lines.push(Array.isArray(v) ? `${k}:\n  ${v.join('\n  ')}` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  process.stdout.write(`${lines.join('\n')}\n`);
};

try {
  const r = await main();
  if (r) { print(r); if (r.ok === false) process.exitCode = 1; }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  print({ ok: false, why: /ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(msg) ? `the site stopped answering during the playtest (${msg}): is the dev server still running? Restart it as a background task (a rebuild while \`npm run dev\` runs can kill it) and run again` : msg });
  process.exitCode = 1;
} finally {
  for (const h of [...open]) await close(h);
}
