/**
 * Real Chrome, driven for the server-rules comparisons (reviews/server-rules/).
 *
 *   const chrome = await launch();
 *   const p = await openPlayer(chrome, { base, game, room, lag: { delay: 150, loss: 0 } });
 *   await p.frame.evaluate(...)   // the game's own frame; p.page is the play page around it
 *
 * THE WIRE. `lag` holds every WebSocket frame of the page and its game frame for `delay` ms each way, in order. A room
 * socket is TCP, so a lost packet is not a missing message: it is a late one, and everything behind it waits. `loss` is
 * the chance a frame is that packet; it then costs one retransmission (`max(200, 2 * delay)` ms, about a round trip)
 * on top of the delay. `window.__wire` in each frame holds the live settings and counts.
 */
import { createRequire } from 'node:module';
const puppeteer = createRequire('/Users/ryan/Studios/homie-arcade-rules/package.json')('puppeteer-core');
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME_PATH ?? process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ headless = process.env.HEADFUL ? false : true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'arcade-rules-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless, userDataDir: profile, protocolTimeout: 240_000,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', ...(process.env.NOBGFLAGS ? [] : []), ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [])].filter((a) => !(process.env.NOBGFLAGS && /background|backgrounding/.test(a))),
  });
  const blank=(await browser.pages())[0];
  const gpu=await blank.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;});
  return { browser, gpu, pid: browser.process()?.pid, async close() {
    let timer;
    try { await Promise.race([browser.close().catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(timer); const child = browser.process(); if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); browser.disconnect(); rmSync(profile, { recursive: true, force: true }); }
  } };
}

/** Installed in every frame before any script: the lagged socket, and a few counters the comparisons read. */
export function wireShim(lag) {
  // pt6: a drifting clock (performance.now, Date.now and rAF stamps run at `drift` x real time)
  if (lag.drift && lag.drift !== 1) { const r = lag.drift, pn = performance.now.bind(performance), p0 = pn(); performance.now = () => p0 + (pn() - p0) * r; const dn = Date.now, d0 = dn(); Date.now = () => Math.round(d0 + (dn() - d0) * r); const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf(() => cb(performance.now())); }
  const Native = window.WebSocket;
  const wire = (window.__wire = { delay: lag.delay || 0, loss: lag.loss || 0, jitter: lag.jitter || 0, lsHold: lag.lsHold || 0, lsEvery: lag.lsEvery || 0, drift: lag.drift || 1, sent: 0, received: 0, late: 0, sockets: 0 });
  const penalty = () => Math.max(200, 2 * wire.delay);
  /** One direction of one socket: strictly first in, first out, each frame no earlier than its own due time. */
  const lane = (deliver) => {
    const q = []; let last = 0, timer = 0;
    const pump = () => {
      timer = 0;
      while (q.length && q[0].due <= performance.now()) deliver(q.shift().x);
      if (q.length) timer = setTimeout(pump, Math.max(0, q[0].due - performance.now()));
    };
    return (x) => {
      if (!wire.delay && !wire.loss && !wire.jitter && !q.length) { last = 0; deliver(x); return; }
      let due = performance.now() + Math.max(0, wire.delay + (Math.random() * 2 - 1) * wire.jitter);
      if (wire.loss && Math.random() < wire.loss) { due += penalty(); wire.late += 1; }
      due = Math.max(due, last); last = due;
      q.push({ due, x });
      if (!timer) timer = setTimeout(pump, Math.max(0, due - performance.now()));
    };
  };
  class Lagged extends Native {
    constructor(...a) {
      super(...a);
      wire.sockets += 1;
      this.__handlers = new Map(); this.__on = null;
      const incoming = lane((e) => this.__deliver(e));
      this.__out = lane((data) => { if (this.readyState === 1) super.send(data); });
      super.addEventListener('message', (e) => { wire.received += 1; incoming(e); });
    }
    __deliver(e) {
      if (this.__on) { try { this.__on.call(this, e); } catch (err) { console.error(err); } }
      for (const fn of this.__handlers.keys()) { try { typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e); } catch (err) { console.error(err); } }
    }
    addEventListener(type, fn, o) { if (type === 'message') { this.__handlers.set(fn, true); return; } super.addEventListener(type, fn, o); }
    removeEventListener(type, fn, o) { if (type === 'message') { this.__handlers.delete(fn); return; } super.removeEventListener(type, fn, o); }
    set onmessage(fn) { this.__on = fn; }
    get onmessage() { return this.__on; }
    send(data) {
      wire.sent += 1;
      if (window.__forge) { try { data = window.__forge(data); } catch (e) { console.warn('forge', e); } if (data == null) return; }
      // pt6 lag switch: outgoing frames are held for lsHold ms of every lsEvery ms, then released in order
      if (wire.lsEvery) { const held = this.__held ??= []; const holding = () => (performance.now() % wire.lsEvery) < wire.lsHold && (!wire.lsWhen || wire.lsWhen());
        if (holding() || held.length) { held.push(data); wire.lsHeld = (wire.lsHeld || 0) + 1; if (!this.__lsTimer) this.__lsTimer = setInterval(() => { if (holding()) return; while (held.length) this.__out(held.shift()); clearInterval(this.__lsTimer); this.__lsTimer = 0; }, 4); return; } }
      this.__out(data);
    }
  }
  window.WebSocket = Lagged;
}

export const VIEWPORTS = {
  computer: { width: 1280, height: 800 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  sideways: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tv: { width: 1920, height: 1080 },
};

/**
 * One player (or a big screen with `path: 'tv'`) in a context of its own, so two of them are two people.
 * Resolves when the game's frame is there and, for a player, seated.
 */
export async function openPlayer(chrome, { base, game, room = null, path = 'play', viewport = 'computer', lag = null, seat = true, timeout = 60_000, context = null, init = null, extraInit = null } = {}) {
  const ctx = context ?? await chrome.browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(VIEWPORTS[viewport] ?? viewport);
  const errors = [];
  page.on('error', e => { const message='PAGE CRASH: '+String(e?.message ?? e); errors.push(message); console.error(message); });
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.evaluateOnNewDocument(wireShim, lag ?? { delay: 0, loss: 0 });
  if (init) await page.evaluateOnNewDocument(init);
  if (extraInit) await page.evaluateOnNewDocument(extraInit);
  const url = `${base}/${game}/${path}${room ? `?room=${encodeURIComponent(room)}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const p = { ctx, page, errors, url, frame: null, viewport: VIEWPORTS[viewport] ?? viewport };
  await attach(p, { seat, timeout });
  return p;
}

/** Find the game's frame again (after a reload) and wait for the seat. */
export async function attach(p, { seat = true, timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    p.frame = p.page.frames().find((f) => /\/__game\//.test(f.url())) ?? null;
    const s = await p.page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat ?? null, role: s.stats?.role ?? null, link: s.link?.state ?? null } : null; }).catch(() => null);
    if (p.frame && s?.room && (!seat || (s.seat !== null && s.role))) { p.shell = s; return p; }
    if (Date.now() > deadline) throw new Error(`no ${seat ? 'seat' : 'room'} within ${timeout} ms at ${p.url}: ${JSON.stringify(s)}`);
    await sleep(100);
  }
}

export const shell = (p) => p.page.evaluate(() => { const s = window.__shell; return s ? { room: s.room, seat: s.seat ?? null, role: s.stats?.role ?? null, link: s.link?.state ?? null, hosted: s.stats?.hosted ?? null, facts: s.facts ?? null } : null; });
export const setLag = (p, lag) => Promise.all(p.page.frames().map((f) => f.evaluate((l) => { if (window.__wire) { window.__wire.delay = l.delay || 0; window.__wire.loss = l.loss || 0; } }, lag).catch(() => {})));

/** A real key, to the game's frame. */
export async function key(p, code, holdMs = 30) { await p.frame.focus('body').catch(() => {}); await p.page.keyboard.down(code); if (holdMs) await sleep(holdMs); await p.page.keyboard.up(code); }

/** A real touch swipe across the page (CDP touch events), from one point to another, in page pixels. */
export async function swipe(p, from, to, { steps = 6, ms = 90 } = {}) {
  const t = p.page.touchscreen;
  await t.touchStart(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) { await sleep(ms / steps); await t.touchMove(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); }
  await t.touchEnd();
}

/** Wait until `fn` (run in the game's frame) is truthy; returns its value. */
export async function until(p, fn, { timeout = 30_000, every = 50, arg = undefined, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await p.frame.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(every);
  }
}

/**
 * Installed before any script of a page under comparison, in both builds: counters for every sound a page can make,
 * and (browser-host build) a handle on the port toolkit's room so its bodies can be read as the rules build's are.
 */
export function instrument() {
  const fx = (window.__fx = { audioContexts: 0, oscillators: 0, buffers: 0, media: 0, log: [] });
  const note = (what) => { if (fx.log.length < 5000) fx.log.push([Math.round(performance.now()), what]); };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) { const W = class extends AC { constructor(...a) { super(...a); fx.audioContexts += 1; } }; window.AudioContext = W; if (window.webkitAudioContext) window.webkitAudioContext = W; }
  if (window.OscillatorNode) { const s = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { fx.oscillators += 1; note(`osc:${this.type}:${Math.round(this.frequency?.value ?? 0)}`); return s.apply(this, a); }; }
  if (window.AudioBufferSourceNode) { const s = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { fx.buffers += 1; note('buffer'); return s.apply(this, a); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { fx.media += 1; note(`media:${String(this.currentSrc || this.src).split('/').pop()}`); return play.apply(this, a); };
  let port;
  try {
    Object.defineProperty(window, 'HomiePort', { configurable: true, get: () => port, set(v) {
      port = Object.create(v);
      Object.defineProperty(port, 'createRoom', { value: (o) => { window.__roomOpts = o; return (window.__room = v.createRoom(o)); } });
    } });
  } catch { /* the rules build has no HomiePort */ }
}

/** The numbers both builds expose, under one shape. */
export const probe = (p) => p.frame.evaluate(() => {
  const i = window.__homiePort?.info?.(); if (!i) return null;
  const x = i.extra ?? {};
  return { role: i.role, seat: i.seat, round: i.round, link: i.link, reconnects: i.reconnects, fps: i.fps, errors: i.errors, lastMove: i.lastMove ?? x.lastMove ?? null, moves: i.moves ?? x.moves ?? null, score: i.score ?? x.score ?? null, extra: x, slots: i.slots, fx: window.__fx ? { ...window.__fx, log: undefined } : null };
}).catch(() => null);
