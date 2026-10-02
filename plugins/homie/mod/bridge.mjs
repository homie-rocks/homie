#!/usr/bin/env node
/**
 * THE HOMIE MOD'S GAME BRIDGE: a real browser seat (or a watcher) in a live Homie room, for a Claude Code pane.
 *
 * Claude Code's mods run in a worker with no network sockets and no browser, so a pane cannot open a netplay room
 * itself. This small Node process does it the way a person's browser does: it starts a headless Chrome on this
 * computer, opens the game's own page (`/<game>/play`, or `/<game>/watch?room=<id>`), and the game runs there for
 * real: it sits in a public room with strangers and bots, and hosts the room when nobody else can, exactly as the
 * play page in a tab would. The mod draws what Chrome shows and sends the keys the person presses in the pane.
 *
 *   node bridge.mjs --url <https://studio/game/play> [--cols 80] [--rows 24] [--fps 8] [--format cells|png|jpeg]
 *
 * It speaks JSON lines on stdout (the mod reads them through `$.process.spawn`):
 *   { t: 'ready', sock }                         the Unix socket the mod sends to (a private folder in /tmp)
 *   { t: 'status', room, seat, role, players, ... } about once a second
 *   { t: 'frame', n, cols, rows, cells }         cells: the Raster's packed cells ('▀' with the two pixels it covers)
 *   { t: 'frame', n, png | jpeg, width, height } a picture, for the terminal's Image or the desktop's Svg
 *   { t: 'error', message } / { t: 'bye', why }
 * and takes, over HTTP on that socket: POST /key {key, hold?}, /size {cols, rows}, /format {format}, /pause,
 * /resume, /alive, /quit.
 *
 * Honest about cost: one headless Chrome (at the lowest priority this computer allows, a small window), a picture
 * taken `fps` times a second and only while the pane is shown; frozen (no JavaScript, no frames) while it is hidden.
 * It ends when the pane closes, when the mod stops pinging it for 45 s, or when Claude Code goes away. It needs no
 * package beyond Node 22 and a Chrome; it never reads a file of the person's, and talks only to Chrome and the
 * game's own site (through Chrome).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const args = new Map();
let URL_ = '';
let cols = 80;
let rows = 24;
let fps = 8;
let format = 'cells';
// The page is laid out for the pane's own shape (640 px wide, as tall as the cells are), so a game that adapts to a
// tall or wide screen fills the picture.
let WIDTH = 960;
let HEIGHT = 540;
const viewportFor = (c, r) => ({ width: 640, height: Math.max(320, Math.min(1280, Math.round((640 * r * 2) / c))) });

/** The command line, read when the bridge runs (importing this file for its decoders reads nothing). */
function readArgs() {
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
  }
  URL_ = String(args.get('url') ?? '');
  cols = clampInt(args.get('cols'), 20, 240, 80);
  rows = clampInt(args.get('rows'), 6, 120, 24);
  fps = clampInt(args.get('fps'), 1, 15, 8);
  format = ['cells', 'png', 'jpeg'].includes(args.get('format')) ? args.get('format') : 'cells';
  ({ width: WIDTH, height: HEIGHT } = viewportFor(cols, rows));
  return /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_);
}

function clampInt(v, lo, hi, d) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
function out(obj) { try { process.stdout.write(`${JSON.stringify(obj)}\n`); } catch { /* the mod is gone */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ Chrome */

export function findChrome() {
  const fixed = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
  ].filter(Boolean);
  const found = fixed.find((p) => existsSync(p));
  if (found) return found;
  // Chrome for Testing where `homie-studio chrome install` keeps it.
  const cache = join(homedir(), '.cache', 'homie-studio', 'chrome', 'chrome');
  try {
    for (const b of readdirSync(cache).sort().reverse()) {
      for (const rel of [['chrome-linux64', 'chrome'], ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'], ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing']]) {
        const p = join(cache, b, ...rel);
        if (existsSync(p)) return p;
      }
    }
  } catch { /* none */ }
  return null;
}

const GPU = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];

/** A tiny DevTools client over Node's own WebSocket: one page, the calls this bridge needs. */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); ws.addEventListener('message', (m) => this.onMessage(m)); }
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('DevTools did not answer')), { once: true });
    });
  }
  onMessage(m) {
    let msg; try { msg = JSON.parse(String(m.data)); } catch { return; }
    if (msg.id && this.waiting.has(msg.id)) { const { resolve, reject } = this.waiting.get(msg.id); this.waiting.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); return; }
    if (msg.method) for (const fn of this.events.get(msg.method) ?? []) fn(msg.params);
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) { this.events.set(method, [...(this.events.get(method) ?? []), fn]); }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
}

/* ------------------------------------------------------------------ PNG → cells */

/** A PNG (8-bit RGB or RGBA, not interlaced, as Chrome writes them) as { w, h, rgba }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8; let w = 0; let h = 0; let type = 0; const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at); const kind = buf.toString('latin1', at + 4, at + 8); const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG: 8-bit, not interlaced only'); type = data[9]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) throw new Error('PNG: RGB or RGBA only');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const px = Buffer.alloc(stride * h); const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0; const b = y ? px[o - stride + x] : 0; const c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) { rgba[i * 4] = px[j]; rgba[i * 4 + 1] = px[j + 1]; rgba[i * 4 + 2] = px[j + 2]; rgba[i * 4 + 3] = 255; }
  return { w, h, rgba };
}

/** A picture as a Raster's cells: `cols` by `rows` cells of '▀', each the average colour of the pixels above and below. */
export function cellsOf(img, cols, rows) {
  const th = rows * 2; const nums = new Uint32Array(cols * rows * 3);
  const avg = (x0, y0, x1, y1) => {
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.w + x) * 4; r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; n++; }
    return n ? ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0 : 0;
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * img.w) / cols); const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.w) / cols));
      const ya = Math.floor((cy * 2 * img.h) / th); const yb = Math.max(ya + 1, Math.floor(((cy * 2 + 1) * img.h) / th)); const yc = Math.max(yb + 1, Math.floor(((cy * 2 + 2) * img.h) / th));
      const k = (cy * cols + cx) * 3;
      nums[k] = 0x2580; nums[k + 1] = avg(x0, ya, x1, yb); nums[k + 2] = avg(x0, yb, x1, Math.min(img.h, yc));
    }
  }
  return Buffer.from(nums.buffer).toString('base64');
}

/* ------------------------------------------------------------------ keys */

const KEYS = {
  up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39],
  w: ['KeyW', 87, 'w'], a: ['KeyA', 65, 'a'], s: ['KeyS', 83, 's'], d: ['KeyD', 68, 'd'],
  space: ['Space', 32, ' '], enter: ['Enter', 13, '\r'], e: ['KeyE', 69, 'e'], q: ['KeyQ', 81, 'q'], x: ['KeyX', 88, 'x'], z: ['KeyZ', 90, 'z'],
};
const held = new Map();

async function press(cdp, name, holdMs) {
  const k = KEYS[name];
  if (!k) return false;
  const [code, keyCode, text] = k;
  const key = code.startsWith('Arrow') ? code : code === 'Space' ? ' ' : code === 'Enter' ? 'Enter' : text;
  const was = held.get(name);
  if (was) { clearTimeout(was); } else {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) }).catch(() => {});
  }
  // A terminal sends no key-up: a press holds the key a little, and the terminal's own repeat keeps it held.
  held.set(name, setTimeout(() => {
    held.delete(name);
    cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: keyCode }).catch(() => {});
  }, Math.max(60, Math.min(900, holdMs))));
  return true;
}

/* ------------------------------------------------------------------ the run */

let chrome = null;
let profile = null;
let server = null;
let sockDir = null;
let ended = false;

function end(why, code = 0) {
  if (ended) return;
  ended = true;
  out({ t: 'bye', why });
  try { server?.close(); } catch { /* closed */ }
  try { if (chrome && !chrome.killed) chrome.kill('SIGKILL'); } catch { /* gone */ }
  setTimeout(() => {
    for (const d of [profile, sockDir]) { try { if (d) rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } }
    process.exit(code);
  }, 300);
}

async function main() {
  if (!readArgs()) { out({ t: 'error', message: 'the bridge opens an https address, or this computer\'s own dev site' }); return end('bad-url', 2); }
  const exe = findChrome();
  if (!exe) { out({ t: 'error', message: 'no Chrome on this computer: install Google Chrome (or set CHROME_PATH)' }); return end('no-chrome', 3); }
  profile = mkdtempSync(join(tmpdir(), 'homie-mod-chrome-'));
  const argv = [`--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-networking', `--window-size=${WIDTH},${HEIGHT}`, ...GPU, 'about:blank'];
  // The lowest priority this computer gives without asking (nice 15), so Claude's own work always comes first.
  const niced = process.platform !== 'win32' && existsSync('/usr/bin/nice');
  chrome = spawn(niced ? '/usr/bin/nice' : exe, niced ? ['-n', '15', exe, ...argv] : argv, { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.on('exit', () => { if (!ended) end('chrome-exited', 4); });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start within 30 s')), 30_000);
    chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  const port = new URL(wsUrl).port;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  if (!pageWs) throw new Error('Chrome opened no page');
  const cdp = await Cdp.open(pageWs);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_ });

  // The mod's line in: a Unix socket in a private folder (a short path: socket names are short on macOS).
  sockDir = mkdtempSync('/tmp/homie-mod-');
  const sock = join(sockDir, 'b.sock');
  let paused = false;
  let lastAlive = Date.now();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let a = {};
      try { a = body ? JSON.parse(body) : {}; } catch { a = {}; }
      lastAlive = Date.now();
      let answer = { ok: true };
      switch (req.url) {
        case '/key': answer = { ok: await press(cdp, String(a.key ?? ''), Number(a.hold) || 220) }; break;
        case '/size': {
          cols = clampInt(a.cols, 20, 240, cols); rows = clampInt(a.rows, 6, 120, rows);
          const v = viewportFor(cols, rows);
          if (v.width !== WIDTH || v.height !== HEIGHT) {
            ({ width: WIDTH, height: HEIGHT } = v);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }).catch(() => {});
          }
          break;
        }
        case '/format': if (['cells', 'png', 'jpeg'].includes(a.format)) format = a.format; break;
        case '/fps': fps = clampInt(a.fps, 1, 15, fps); break;
        case '/pause': if (!paused) { paused = true; await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); } break;
        case '/resume': if (paused) { paused = false; await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); } break;
        case '/alive': break;
        case '/quit': res.end(JSON.stringify(answer)); return end('asked');
        default: answer = { ok: false, error: 'unknown' };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((r) => server.listen(sock, r));
  out({ t: 'ready', sock, width: WIDTH, height: HEIGHT });

  // Watchdogs: the mod pings while its pane is open; Claude Code going away orphans this process.
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent || process.ppid === 1) end('parent-gone');
    else if (Date.now() - lastAlive > 45_000) end('no-pane');
  }, 2000).unref();

  // Where the game is drawn: the game's own frame inside the play or watch page (the whole page until it exists).
  let clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  let focused = false;
  const look = async () => {
    const r = await cdp.evaluate(`(() => { const f = document.querySelector('iframe'); const s = window.__shell; const b = f ? f.getBoundingClientRect() : null;
      return { rect: b && b.width > 40 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null, title: document.title, href: location.href,
        room: s?.room ?? null, seat: s?.seat ?? null, role: s?.stats?.role ?? null, players: s?.facts?.counts?.players ?? null, bots: s?.facts?.counts?.bots ?? null,
        ai: s?.facts?.counts?.ai ?? null, watchers: s?.facts?.counts?.watchers ?? null, round: s?.facts?.round ?? null, closed: s?.closed ?? null }; })()`).catch(() => null);
    if (!r) return;
    if (r.rect) clip = { x: Math.max(0, r.rect.x), y: Math.max(0, r.rect.y), width: Math.min(WIDTH, r.rect.width), height: Math.min(HEIGHT, r.rect.height) };
    if (r.rect && !focused) {
      // The game takes keys once its frame has the focus, as a person's first click gives it.
      focused = true;
      const x = clip.x + clip.width / 2; const y = clip.y + clip.height / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).catch(() => {});
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }).catch(() => {});
    }
    const { rect, ...status } = r;
    out({ t: 'status', ...status, fps, paused, format });
  };
  setInterval(() => { if (!paused) look().catch(() => {}); }, 1000);

  let n = 0;
  for (;;) {
    const t0 = Date.now();
    if (!paused) {
      try {
        if (format === 'cells') {
          // Twice the cells' resolution each way, averaged down: smoother than one pixel a cell.
          const scale = Math.min(1, (cols * 4) / clip.width);
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, optimizeForSpeed: true });
          const img = decodePng(Buffer.from(shot.data, 'base64'));
          out({ t: 'frame', n: ++n, cols, rows, cells: cellsOf(img, cols, rows) });
        } else {
          const scale = Math.min(1, 480 / clip.width);
          const shot = await cdp.send('Page.captureScreenshot', { format: format === 'png' ? 'png' : 'jpeg', ...(format === 'jpeg' ? { quality: 55 } : {}), clip: { ...clip, scale }, optimizeForSpeed: true });
          out({ t: 'frame', n: ++n, [format]: shot.data, width: Math.round(clip.width * scale), height: Math.round(clip.height * scale) });
        }
      } catch (error) {
        out({ t: 'error', message: String(error?.message ?? error).slice(0, 200) });
        await sleep(1000);
      }
    }
    await sleep(Math.max(10, 1000 / fps - (Date.now() - t0)));
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  process.on('SIGTERM', () => end('signal'));
  process.on('SIGINT', () => end('signal'));
  process.on('uncaughtException', (e) => { out({ t: 'error', message: String(e?.message ?? e).slice(0, 200) }); end('crash', 1); });
  main().catch((e) => { out({ t: 'error', message: String(e?.message ?? e).slice(0, 200) }); end('failed', 1); });
}
