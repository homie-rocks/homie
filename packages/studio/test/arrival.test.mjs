/**
 * @homie-rocks/studio 0.26.0: the first minute of every game.
 *
 *   - the play page and the big screen never open blank: an arrival card in the game's own look (its palette, title,
 *     pitch, key art and the controls for this device) covers the frame while the room connects and the game loads,
 *     with a progress line that says what is happening, and lifts when the game says it is playable;
 *   - the netplay helper says `playable` (the game's `net.playable()`, or by itself once seated with the room's state)
 *     and passes the game's `net.loading()` on; a game built with an older helper lifts the card once it has a seat;
 *   - a game with its own palette (style.json) and no landing colours of its own gets a landing in that palette (a
 *     bright game is no longer shown on the studio's dark page); an owner's landing.scheme or landing.theme still wins;
 *   - `homie-studio perf` reads the time to the first meaningful frame (`load.look`).
 * Run: node --test packages/studio/test/arrival.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { playPage } from '../worker/pages.mjs';
import { arrivalCard, arrivalColours } from '../worker/arrival.mjs';
import { gameLanding } from '../worker/site.mjs';
import { metricsOfRun } from '../lib/perf.mjs';
import { landingOf } from '../lib/site.mjs';
import { NetRoom } from '../worker/room.mjs';
import { virtualTime } from './virtual-time.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-arrival-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const cat = { studio: { name: 'Night <Owls>', theme: { bg: '#05070d', fg: '#dffcff', accent: '#ff3bd4', scheme: 'dark' } }, games: [] };
const bright = {
  id: 'coin-glade', name: 'Coin <Glade>', blurb: 'Knights race for coins. Second sentence.',
  ui: { paper: '#cfe6f2', text: '#1e2a38', hot: '#e8833a' },
  landing: { pitch: 'Grab the coins.', controls: { phone: 'Drag to run.', computer: 'WASD to run, Space jumps.' }, hero: { wideImage: '/games/coin-glade/_landing/wide.jpg', focus: '50% 55%' } },
};

test('the play page opens on the game\'s own look: title, pitch, art, a progress line and this device\'s controls', async () => {
  const html = await playPage(cat, bright).text();
  assert.match(html, /<div class="arrive" data-arrive data-from="game">/);
  assert.match(html, /<h1 class="arrive-title">Coin &lt;Glade&gt;<\/h1>/, 'the name, escaped');
  assert.match(html, /<p class="arrive-kicker">Night &lt;Owls&gt;<\/p>/);
  assert.match(html, /<p class="arrive-pitch">Grab the coins\.<\/p>/);
  assert.match(html, /<img src="\/games\/coin-glade\/_landing\/wide\.jpg" alt="" decoding="async" fetchpriority="high" style="object-position:50% 55%">/);
  assert.match(html, /<span data-arrive-step>Finding a room…<\/span>/);
  assert.match(html, /<p class="arrive-keys" data-for="phone">Drag to run\.<\/p>/);
  assert.match(html, /<p class="arrive-keys" data-for="desk">WASD to run, Space jumps\.<\/p>/);
  // The game's palette (style.json, through games.json ui): its paper, its ink and its accent.
  assert.match(html, /\.arrive \{ --a-bg: #cfe6f2; --a-fg: #1e2a38; --a-hot: #e8833a;/);
  // The chip waits under the card; the card's script runs before the shell's.
  assert.match(html, /<div class="chip held" data-chip>/);
  assert.ok(html.indexOf('__homieArrival = api') < html.indexOf('var A = window.__homieArrival'));
  // The big screen: the same card, bigger, with the TV's words.
  const tv = await playPage(cat, bright, { screen: true }).text();
  assert.match(tv, /<div class="arrive big" data-arrive/);
  assert.match(tv, /data-for="tv">Phones are the controllers: scan the code to play\.</);
});

test('without art or a palette the card is the studio\'s look; a landing\'s scheme or colours come before it', () => {
  const plain = { id: 'rock-race', name: 'Rock Race', blurb: 'Blast rocks. Then more.' };
  const { html } = arrivalCard(cat, plain);
  assert.match(html, /<div class="arrive-art bare" aria-hidden="true"><\/div>/);
  assert.match(html, /<p class="arrive-pitch">Blast rocks\.<\/p>/, 'the blurb\'s first sentence');
  assert.doesNotMatch(html, /arrive-keys/, 'no controls are invented');
  assert.deepEqual(arrivalColours(cat, plain), { bg: '#05070d', fg: '#dffcff', hot: '#ff3bd4', from: 'studio' });
  assert.equal(arrivalColours(cat, { ...plain, landing: { scheme: 'light' } }).bg, '#f7f6f1');
  assert.equal(arrivalColours(cat, { ...plain, landing: { theme: { accent: '#00ff00' } } }).hot, '#00ff00');
  // Nothing unsafe reaches the stylesheet or the markup.
  const bad = arrivalColours({ studio: { theme: { bg: 'red;}</style><script>', accent: 'url(x)' } } }, plain);
  assert.equal(bad.bg, '#0b0c12'); assert.equal(bad.hot, '#ffcf5a');
  assert.match(arrivalCard(cat, { ...plain, cover: 'x" onerror="y.png' }).html, /arrive-art bare/);
  assert.equal(arrivalCard(cat, plain, { off: true }).html, '');
});

/** The play page's two scripts (the card's, then the shell's) against a stand-in page. */
async function page(g, search = '') {
  const html = await playPage(cat, g).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const els = new Map();
  const el = (sel) => {
    if (sel === '[data-join]') return null;
    if (!els.has(sel)) {
      els.set(sel, {
        sel, textContent: sel === '[data-arrive-step]' ? 'Finding a room…' : '', hidden: /sheet|toast|results|screen/.test(sel), attrs: {}, listeners: {}, href: '', src: '', className: '', removed: false,
        style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
        classList: { set: new Set(sel === '[data-chip]' ? ['held'] : []), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, querySelector: (s) => el(s), contains: () => false,
        append() {}, focus() {}, contentWindow: { focus() {} }, appendChild(c) { return c; }, insertBefore(c) { return c; },
        remove() { this.removed = true; },
      });
    }
    return els.get(sel);
  };
  const listeners = {};
  const timers = [];
  const ctx = {
    document: { querySelector: el, createElement: () => el(`new-${Math.random()}`), addEventListener() {} },
    location: { search, origin: 'https://owls.example', pathname: `/${g.id}/play`, hash: '', host: 'owls.example', protocol: 'https:' },
    history: { state: null, replaceState() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    WebSocket: class { constructor(u) { this.url = u; } },
    fetch: async () => ({ json: async () => ({ room: 'pub-4' }) }),
    URLSearchParams, clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.gone = true; },
    // The card's timers are stepped by hand: `run(ms)` fires every timer due by then.
    setTimeout: (fn, ms) => { const t = { id: timers.length + 1, fn, at: (ctx.clock ?? 0) + (ms ?? 0) }; timers.push(t); return t.id; },
    clock: 0, innerWidth: 390, innerHeight: 844,
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    dispatchEvent: (e) => { for (const fn of listeners[e.type] ?? []) fn(e); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  ctx.window = ctx;
  ctx.run = (ms) => { ctx.clock += ms; for (const t of timers) if (!t.gone && !t.fired && t.at <= ctx.clock) { t.fired = true; t.fn(); } };
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  await new Promise((r) => setImmediate(r));
  ctx.run(0);
  /** A message from the game's frame (the netplay helper's postMessage). */
  const post = (m) => { const frame = el('iframe.game'); for (const fn of listeners.message ?? []) fn({ source: frame.contentWindow, data: { t: 'homie-net', ...m } }); };
  return { ctx, el, post, shell: ctx.__shell };
}

test('the card says what is happening, and lifts when the game says it is playable', async () => {
  const { ctx, el, post, shell } = await page(bright);
  const a = shell.arrival;
  assert.equal(shell.room, 'pub-4');
  assert.equal(a.phase, 'game');
  assert.equal(el('[data-arrive-step]').textContent, 'Loading the game…');
  assert.equal(el('[data-arrive-room]').textContent, 'Room 4');
  post({ what: 'attached', v: 1, rev: 8, arrival: 'game' });
  assert.equal(el('[data-arrive-step]').textContent, 'Joining Room 4…');
  post({ what: 'token', token: 'k', seat: 0 });
  post({ what: 'loading', p: 0.5, label: 'the heroes' });
  assert.equal(el('[data-arrive-step]').textContent, 'Loading the heroes… 50%');
  assert.ok(a.p > 0.7 && a.p < 0.8, `the bar moves with the game (${a.p})`);
  // While the card is up the chip stays under it; nothing lifts at a seat for a game that says when.
  ctx.run(2000);
  assert.equal(a.phase, 'world');
  assert.ok(el('[data-chip]').classList.contains('held'));
  post({ what: 'playable', by: 'game' });
  assert.equal(a.phase, 'done');
  assert.equal(a.by, 'game');
  assert.ok(el('[data-arrive]').classList.contains('lift'));
  assert.ok(Number.isFinite(a.liftedMs));
  // Whatever the frame says later changes nothing.
  post({ what: 'loading', p: 0.1 });
  assert.equal(a.phase, 'done');
});

test('a game whose helper is older lifts the card once seated; one that never says, at the cap', async () => {
  const old = await page(bright);
  old.post({ what: 'attached', v: 1, rev: 8 });
  old.post({ what: 'role', role: 'host', seat: 0 });
  assert.equal(old.shell.arrival.phase, 'world');
  old.ctx.run(700);
  assert.equal(old.shell.arrival.by, 'seated');
  const quiet = await page(bright);
  quiet.post({ what: 'attached', v: 1, rev: 8, arrival: 'game' });
  quiet.ctx.run(14_000);
  assert.equal(quiet.shell.arrival.phase, 'join', 'still joining at 14 s');
  quiet.ctx.run(1_100);
  assert.equal(quiet.shell.arrival.by, 'cap', 'lifted 15 s after the helper attached');
  const none = await page(bright);
  none.ctx.run(30_000);
  assert.equal(none.shell.arrival.by, 'timeout', 'and 30 s after the page opened, whatever happens');
  const off = await page(bright, '?arrive=0');
  assert.equal(off.el('[data-arrive]').removed, true);
  assert.equal(off.shell.arrival, null);
});

test('a late explicit ready under the automatic arrival is on the page for a probe: the mode, who lifted the card, and when the game itself said so', async () => {
  // The integration mistake: the game calls net.playable() once its character has loaded, but never said arrival: 'game'.
  const { post, shell } = await page(bright);
  const a = shell.arrival;
  assert.deepEqual([a.mode, a.explicitMs, a.lateMs], [null, null, null]);
  post({ what: 'attached', v: 1, rev: 9, arrival: 'auto' });
  post({ what: 'token', token: 'k', seat: 0 });
  post({ what: 'playable', by: 'auto' });
  assert.deepEqual([a.mode, a.by, a.phase], ['auto', 'auto', 'done'], 'the helper lifted the card: seated, the room\'s state in');
  // 1.7 s later the game's own word arrives. The card is long gone; the page still records it.
  post({ what: 'ready', by: 'game', mode: 'auto', ms: 1740, lateMs: 1700 });
  assert.equal(a.by, 'auto', 'who lifted the card does not change');
  assert.ok(Number.isFinite(a.explicitMs), 'when the game itself was ready (the page\'s clock)');
  assert.equal(a.lateMs, 1700, 'and how late that was');
  assert.deepEqual([shell.ready.mode, shell.ready.ms, shell.ready.lateMs], ['auto', 1740, 1700]);
  // Done right (arrival: 'game'): the same fields, and nothing late.
  const ok = await page(bright);
  ok.post({ what: 'attached', v: 1, rev: 9, arrival: 'game' });
  ok.post({ what: 'ready', by: 'game', mode: 'game', ms: 900 });
  ok.post({ what: 'playable', by: 'game' });
  assert.deepEqual([ok.shell.arrival.mode, ok.shell.arrival.by, ok.shell.arrival.lateMs], ['game', 'game', null]);
  assert.ok(Number.isFinite(ok.shell.arrival.explicitMs));
});

test('netplay: the helper says when the game is playable (the game\'s word, or its own) and passes loading on', async (t) => {
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const file = join(scratch, 'netplay.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'netplay', 'netplay.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  const { createNetplay } = await import(file);
  const clock = virtualTime(t);
  const room = new NetRoom({ code: 'r', maxPlayers: 4 });
  class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0;
      this.h = room.attach({ send: (x) => setTimeout(() => this.onmessage?.({ data: x }), 0), close: () => {}, buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.h.onMessage(x); }
    close() { this.readyState = 3; this.h.onClose(); }
  }
  const cfg = (who) => ({ v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who });
  const posts = { host: [], replica: [], game: [] };
  const host = createNetplay({ config: cfg('host'), WebSocketImpl: MemorySocket, post: (m) => posts.host.push(m), game: 'x' });
  await clock.wait(100);
  const replica = createNetplay({ config: cfg('replica'), WebSocketImpl: MemorySocket, canHost: false, post: (m) => posts.replica.push(m), game: 'x' });
  const own = createNetplay({ config: cfg('own'), WebSocketImpl: MemorySocket, canHost: false, post: (m) => posts.game.push(m), game: 'x', arrival: 'game' });
  await clock.wait(100);
  assert.deepEqual(posts.host.find((m) => m.what === 'attached')?.arrival, 'auto');
  assert.deepEqual(posts.game.find((m) => m.what === 'attached')?.arrival, 'game');
  assert.ok(posts.host.some((m) => m.what === 'playable' && m.by === 'auto'), 'a host is playable at once');
  assert.ok(!posts.replica.some((m) => m.what === 'playable'), 'a replica waits for the room\'s state');
  host.snapshot({ x: 1 }, 1, true);
  await clock.wait(200);
  assert.equal(posts.replica.filter((m) => m.what === 'playable').length, 1, 'then says so, once');
  assert.ok(!posts.game.some((m) => m.what === 'playable'), 'a game that says when is never said for');
  own.loading(0.2, 'the heroes'); own.loading(0.3); await clock.wait(150); own.loading(0.6, 'the heroes');
  assert.deepEqual(posts.game.filter((m) => m.what === 'loading').map((m) => m.p), [0.2, 0.6], 'at most ten a second');
  own.playable(); own.playable(); own.loading(0.9);
  assert.equal(posts.game.filter((m) => m.what === 'playable').length, 1);
  assert.equal(posts.game.filter((m) => m.what === 'loading').length, 2, 'nothing after playable');
  host.close(); replica.close(); own.close();
});

test('a game with its own palette gets a landing in it; the owner\'s scheme or colours still win', async () => {
  const landing = landingOf;
  const mk = (id, style, L = {}) => {
    const dir = join(scratch, 'games', id);
    mkdirSync(dir, { recursive: true });
    if (style) writeFileSync(join(dir, 'style.json'), JSON.stringify({ v: 1, palette: style }));
    return landing({ id, dir, name: id, landing: L }, join(scratch, 'dist', id), { videos: [], songs: [], log: () => {} });
  };
  const sky = { bg: '#cfe6f2', ink: '#1e2a38', accent: '#e8833a', accent2: '#4fa36a' };
  const own = mk('sky', sky);
  assert.equal(own.scheme, 'light');
  assert.equal(own.schemeFrom, 'style');
  assert.deepEqual({ bg: own.theme.bg, fg: own.theme.fg, accent: own.theme.accent, glow: own.theme.glow }, { bg: '#cfe6f2', fg: '#1e2a38', accent: '#e8833a', glow: '#4fa36a' });
  const night = mk('night', { bg: '#101522', ink: '#f2efe6', accent: '#ffb03b' });
  assert.equal(night.scheme, 'dark');
  // The owner's word wins: a scheme, or colours of the landing's own.
  const chose = mk('chose', sky, { scheme: 'dark' });
  assert.equal(chose.scheme, 'dark'); assert.equal(chose.schemeFrom, undefined); assert.equal(chose.theme.bg, undefined);
  const painted = mk('painted', sky, { theme: { accent: '#ff0000' } });
  assert.equal(painted.scheme, undefined); assert.deepEqual(painted.theme, { accent: '#ff0000', accentInk: '#ffffff' });
  // Ink that does not read on its paper: the accents only, on the studio's scheme, as before.
  const murky = mk('murky', { bg: '#808080', ink: '#707070', accent: '#e8833a' });
  assert.equal(murky.scheme, undefined); assert.equal(murky.theme.bg, undefined); assert.equal(murky.theme.accent, '#e8833a');
  // On the page: light, the game's own paper, and the footage kept bright.
  const html = await gameLanding(cat, { id: 'sky', name: 'Sky', blurb: 'b', landing: own }, { origin: 'https://owls.example' }).text();
  assert.match(html, /data-scheme="light" data-look="game"/);
  assert.match(html, /--bg:#cfe6f2;--fg:#1e2a38;--hot:#e8833a/);
  const dark = await gameLanding(cat, { id: 'chose', name: 'Chose', blurb: 'b', landing: chose }, { origin: 'https://owls.example' }).text();
  assert.doesNotMatch(dark, /<body[^>]*data-look=/);
  assert.match(dark, /data-scheme="dark"/);
});

test('perf: the time to the first meaningful frame is a metric', () => {
  const m = metricsOfRun({ device: 'phone', browsers: [{ role: 'host', load: { lookMs: 140, firstFrameMs: 1300, playableMs: 2100 } }] });
  assert.equal(m['phone.host.load.look'], 140);
  assert.equal(m['phone.host.load.playable'], 2100);
  assert.ok(readFileSync(join(PKG, 'lib', 'perf.mjs'), 'utf8').includes("phase === 'done'"), 'playable waits for the card to lift');
});
