/**
 * @homie-rocks/studio 0.7.0: the play page shares its room, and names its players.
 *
 *   - the game frame delegates fullscreen, autoplay and gamepad to its opaque origin (`*`): the bare names
 *     matched nothing in the sandboxed frame, and Safari refused the gamepad;
 *   - the room goes into the address, and a small room button at the edge shares it: Invite (the share sheet,
 *     or the link copied), Big screen (/<game>/tv of that room) and the room code;
 *   - a room code the relay cannot use (over 32 characters, or other characters) is refused on the page,
 *     never swapped for a public room;
 *   - a player who typed no name gets a two-word handle, varied per seat and per room, never "Player 1";
 *   - 0.9.0: the room button's place per device (game.json screen.share: a corner or top-center, an x / y offset, an
 *     icon-only button), so it never sits on a game's scoreboard;
 *   - 0.16.1: on a server, the server pill shares the room button's band (beside it, never under it; a dot on a phone
 *     held upright), a server room's button says "Room 2", and the vote card is opaque;
 *   - netplay revision 9: the page and its frame refuse selection, the callout and page gestures; the address's
 *     allow-listed switches are handed to the game's frame (never the room's own); the page keeps `net.prefs` for
 *     the frame, capped; it tells the frame where its own controls sit; it says the link's state, and loads the game
 *     again when a newer build is live.
 * The shell script runs here against a small stand-in page (no browser needed).
 * Run: node --test packages/studio/test/play.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { NetRoom, HANDLE_WORDS, handleFor } from '../worker/room.mjs';
import { playPage, sharePlaces } from '../worker/pages.mjs';
// The far sides of the seam: the instruments that read what this page says (the studio's check and perf, and the
// playtest skill's judge, which is a separate program that reads the same names).
import { CUT_OFF, LINK_STATES, arrivalFacts, connectionSummary, linkOf } from '../lib/check.mjs';
import { metricsOfRun, summaryOf } from '../lib/perf.mjs';
import * as playtest from '../../../plugins/homie/skills/playtest/scripts/lib/judge.mjs';

const cat = { studio: { name: 'Night Owls', theme: { accent: '#ffcf5a' } }, games: [] };
const game = { id: 'rock-race', name: 'Rock <Race>', players: { max: 6 } };

test('the game frame delegates fullscreen, autoplay and gamepad to its opaque origin', async () => {
  const html = await playPage(cat, game).text();
  assert.match(html, /<iframe class="game"[^>]* sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen \*; autoplay \*; gamepad \*"><\/iframe>/);
  assert.doesNotMatch(html, /allow="fullscreen; autoplay; gamepad"/);
});

/** The play page's shell script, run against a stand-in page at `search`. */
async function shell(search, { lobby = 'pub-3', screen = false, room = null, g = game, width = 1280, height = 800, server = null, storage = null, rects = {} } = {}) {
  const res = playPage(cat, g, { screen, room, server });
  const html = await res.text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const els = new Map();
  const el = (sel) => {
    if (sel === '[data-join]') return null;
    if (!els.has(sel)) {
      els.set(sel, {
        sel, textContent: '', hidden: /sheet|toast|results|screen/.test(sel), attrs: {}, listeners: {}, href: '', src: '', className: '',
        style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
        classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, querySelector: (s) => el(s), contains: () => false,
        append() {}, focus() {}, contentWindow: { focus() {}, postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) },
        // Where the stand-in page draws this control (the shell tells the game's frame; nothing is drawn where none is given).
        getBoundingClientRect: () => { const r = rects[sel]; return r ? { left: r[0], top: r[1], width: r[2], height: r[3] } : { left: 0, top: 0, width: 0, height: 0 }; },
        // Room chat's component (0.23.0) builds its pill and sheet into the band: a stand-in takes them.
        appendChild(c) { return c; }, insertBefore(c) { return c; }, remove() {},
      });
    }
    return els.get(sel);
  };
  const replaced = [];
  const fetched = [];
  const posted = [];
  const heard = {};
  const ctx = {
    document: { querySelector: el, createElement: () => el(`new-${Math.random()}`), addEventListener() {} },
    location: { search, origin: 'https://owls.example', pathname: `/${game.id}/${screen ? 'tv' : 'play'}`, hash: '', host: 'owls.example', protocol: 'https:' },
    history: { state: null, replaceState: (s, t, u) => replaced.push(u) },
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    WebSocket: class { constructor(u) { this.url = u; } },
    fetch: async (u, o) => { fetched.push([u, o?.method]); return { json: async () => ({ room: lobby }) }; },
    URLSearchParams, setTimeout, clearTimeout, innerWidth: width, innerHeight: height,
    addEventListener(type, fn) { (heard[type] ??= []).push(fn); },
    ...(storage ? { localStorage: storage } : {}),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  await new Promise((r) => setTimeout(r, 10));
  /** What the game's helper says to the page (postMessage from the frame). */
  const fromGame = (m) => { for (const fn of heard.message ?? []) fn({ source: el('iframe.game').contentWindow, data: { t: 'homie-net', ...m } }); };
  return { html, ctx, el, replaced, fetched, posted, heard, fromGame };
}

test('the room goes into the address, and the room button shares it: Invite, Big screen and the code', async () => {
  const html = await playPage(cat, game).text();
  assert.match(html, /<button class="pill" type="button" data-share-toggle aria-expanded="false"/);
  assert.match(html, /<div class="sheet" id="share-sheet" role="dialog" aria-label="This room" data-share-sheet hidden>/);
  assert.match(html, /data-invite>/);
  assert.match(html, /data-bigscreen target="_blank" rel="noopener" href="\/rock-race\/tv"/);
  assert.match(html, /<div class="room at-top-right" style="--dx:0px;--dy:0px" data-room-ui>/, 'at the edge, away from the thumbs and the middle');
  assert.match(html, /← Rock &lt;Race&gt;/);
  // A stranger pressing Play: the lobby's room is written into the address and into the share sheet.
  const a = await shell('');
  assert.deepEqual(a.fetched, [['/rock-race/api/lobby', 'POST']]);
  assert.deepEqual(a.replaced, ['/rock-race/play?room=pub-3']);
  // 0.13.0: the browser's room key (what an owner's kick holds out) rides along.
  // Revision 9: `pf=1` says this page keeps net.prefs for the frame.
  assert.match(a.el('iframe.game').src, /^\/rock-race\/__game\/\?room=pub-3&device=desk&want=play&b=[A-Za-z0-9_-]{16,43}&pf=1$/);
  assert.equal(a.el('[data-room-code]').textContent, 'Room 3');
  assert.equal(a.el('[data-bigscreen]').href, '/rock-race/tv?room=pub-3');
  assert.equal(a.el('[data-room-link]').textContent, 'owls.example/rock-race/play?room=pub-3');
  assert.equal(a.ctx.__shell.link, 'https://owls.example/rock-race/play?room=pub-3');
  // A friend's link: that room, no lobby, the address kept as it is (with its other switches).
  const b = await shell('?room=owl-party&hand=phone');
  assert.deepEqual(b.fetched, []);
  assert.deepEqual(b.replaced, []);
  assert.match(b.el('iframe.game').src, /room=owl-party&device=phone/);
  assert.equal(b.el('[data-room-code]').textContent, 'owl-party');
  // Invite: the share sheet when there is one, else the link copied.
  const shared = [];
  b.ctx.navigator.share = async (d) => { shared.push(d); };
  b.el('[data-invite]').listeners.click[0]();
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [{ title: 'Rock <Race>', text: 'Play Rock <Race> with me: join my room.', url: 'https://owls.example/rock-race/play?room=owl-party' }]);
  const copied = [];
  delete b.ctx.navigator.share;
  b.ctx.navigator.clipboard = { writeText: async (t) => { copied.push(t); } };
  b.el('[data-invite]').listeners.click[0]();
  assert.deepEqual(copied, ['https://owls.example/rock-race/play?room=owl-party']);
  // The big screen writes its room into its address too, so a reload keeps the same room and QR.
  const tv = await shell('', { screen: true, room: 'pub-5' });
  assert.deepEqual(tv.replaced, ['/rock-race/tv?room=pub-5']);
  assert.deepEqual(tv.fetched, []);
});

test('a room code the relay cannot use is refused on the page, never swapped for a public room', async () => {
  const long = 'a'.repeat(33);
  const s = await shell(`?room=${long}`);
  assert.deepEqual(s.fetched, [], 'no lobby: an asked room is never silently a public one');
  assert.equal(s.el('iframe.game').src, '', 'no game is started');
  assert.equal(s.el('[data-status]').textContent, 'that room link does not work');
  const ok = await shell(`?room=${'a'.repeat(32)}`);
  assert.match(ok.el('iframe.game').src, new RegExp(`room=${'a'.repeat(32)}&`));
  // The site answers the same before any script runs: the page, the big screen and the game's own page.
  const { default: worker } = await import('../worker/index.mjs');
  const catalogue = { studio: { name: 'Night Owls' }, games: [{ id: 'rock-race', name: 'Rock Race', players: { max: 6 } }] };
  const ASSETS = { fetch: async (req) => (new URL(req.url).pathname === '/games.json' ? new Response(JSON.stringify(catalogue)) : new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } })) };
  const LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(JSON.stringify({ room: 'pub-1', rooms: [] })) }) };
  const site = (p) => worker.fetch(new Request(`https://owls.example${p}`), { ASSETS, LOBBY }, { waitUntil() {} });
  for (const p of [`/rock-race/play?room=${long}`, '/rock-race/play?room=a%20b', `/rock-race/tv?room=${long}`, `/rock-race/play?screen=1&room=${long}`]) {
    const r = await site(p);
    assert.equal(r.status, 400, p);
    const html = await r.text();
    assert.match(html, /That room link does not work/);
    assert.doesNotMatch(html, /<iframe/, `${p}: no game in a room nobody asked for`);
    assert.match(html, /href="\/rock-race\/(play|tv)" data-play>Join a public room<\/a>/, 'a public room is one tap away, and said so');
  }
  const doc = await site(`/rock-race/__game/?room=${long}`);
  assert.equal(doc.status, 400);
  assert.equal((await site(`/rock-race/play?room=${'b'.repeat(32)}`)).status, 200);
});

test('handles: a player with no name gets two words, varied per seat and per room, never "Player 1"', () => {
  const names = (code, n, typed = {}) => {
    const room = new NetRoom({ code, maxPlayers: 8 });
    const out = [];
    for (let i = 0; i < n; i++) {
      const got = [];
      room.attach({ ip: `198.51.100.${i}`, send: (t) => got.push(JSON.parse(t)), close: () => {} })
        .onMessage(JSON.stringify({ t: 'hello', v: 1, device: 'phone', want: 'play', canHost: true, ...(typed[i] ? { name: typed[i] } : {}) }));
      out.push(got.find((m) => m.t === 'welcome').name);
    }
    return out;
  };
  const eight = names('pub-1', 8, { 3: 'Zed' });
  assert.equal(eight[3], 'Zed', 'a typed name is kept');
  const handles = eight.filter((_, i) => i !== 3);
  for (const h of handles) {
    assert.match(h, /^[A-Z][a-z]+ [A-Z][a-z]+$/, h);
    assert.ok(h.length <= 16, `${h} fits a game that trims names at 18`);
    assert.doesNotMatch(h, /^Player \d+$/);
  }
  assert.equal(new Set(handles).size, handles.length, 'no two seats share a handle');
  const firsts = new Set(Array.from({ length: 40 }, (_, i) => names(`pub-${i + 2}`, 1)[0]));
  assert.ok(firsts.size >= 20, `every room's first player is not the same name (${firsts.size} different in 40 rooms)`);
  assert.equal(handleFor('same-token'), handleFor('same-token'), 'a seat keeps its handle (its token names it)');
  assert.notEqual(handleFor('same-token', new Set([handleFor('same-token')])), handleFor('same-token'), 'a taken handle is skipped');
  assert.ok(HANDLE_WORDS.first.length * HANDLE_WORDS.second.length >= 1000);
});

test('the room button\'s place, per device: a corner or the top\'s middle, moved in by x / y, and an icon-only button', () => {
  const d = { at: 'top-right', x: 0, y: 0, label: true };
  assert.deepEqual(sharePlaces(undefined), { desk: d, phone: d, sideways: d }, 'the top right, as before');
  assert.deepEqual(sharePlaces('bottom-left').phone, { at: 'bottom-left', x: 0, y: 0, label: true }, 'a string is every device');
  assert.deepEqual(sharePlaces('middle'), { desk: d, phone: d, sideways: d }, 'a place that is not one is the default');
  const p = sharePlaces({ desk: 'bottom-left', phone: { at: 'top-left', y: 56 }, sideways: 'top-center' });
  assert.deepEqual(p.desk, { at: 'bottom-left', x: 0, y: 0, label: true });
  assert.deepEqual(p.phone, { at: 'top-left', x: 0, y: 56, label: true });
  assert.deepEqual(p.sideways, { at: 'top-center', x: 0, y: 0, label: true });
  assert.deepEqual(sharePlaces({ phone: 'top-left' }).sideways.at, 'top-left', 'a phone turned sideways is a phone unless it says otherwise');
  const all = sharePlaces({ at: 'top-right', y: 9999, x: -40, label: false, phone: 'top-center' });
  assert.deepEqual(all.desk, { at: 'top-right', x: 0, y: 600, label: false }, 'offsets stay on the screen: 0 to 600 from a corner');
  assert.equal(all.phone.at, 'top-center');
  assert.equal(sharePlaces({ at: 'top-center', x: -80 }).desk.x, -80, 'the top\'s middle moves either way');
});

test('the shell puts the room button where this device wants it, and keeps it a small icon when asked', async () => {
  const g = { ...game, screen: { share: { desk: 'bottom-left', phone: { at: 'top-left', y: 56, label: false }, sideways: { at: 'top-center', x: 40 } } } };
  // The page arrives with the computer's place, so a computer never sees it move.
  const html = await playPage(cat, g).text();
  assert.match(html, /<div class="room at-bottom-left" style="--dx:0px;--dy:0px" data-room-ui>/);
  assert.match(html, /<button class="pill" type="button" data-share-toggle/);
  const desk = await shell('', { g });
  assert.equal(desk.el('[data-room-ui]').className, 'room at-bottom-left');
  assert.ok(desk.el('[data-chip]').classList.contains('chip-right'), 'the status chip moves out of the button\'s corner');
  assert.deepEqual(JSON.parse(JSON.stringify(desk.ctx.__shell.share)), { device: 'desk', at: 'bottom-left', x: 0, y: 0, label: true });
  const phone = await shell('?hand=phone', { g, width: 390, height: 844 });
  assert.equal(phone.el('[data-room-ui]').className, 'room at-top-left');
  assert.equal(phone.el('[data-room-ui]').style.props['--dy'], '56px', 'below the game\'s own top line');
  assert.ok(phone.el('[data-share-toggle]').classList.contains('icon'), 'label: false keeps it the small round icon');
  assert.ok(!phone.el('[data-chip]').classList.contains('chip-right'));
  const sideways = await shell('', { g, width: 844, height: 390 });
  assert.equal(sideways.el('[data-room-ui]').className, 'room at-top-center', 'a phone turned sideways has its own place');
  assert.equal(sideways.el('[data-room-ui]').style.props['--dx'], '40px');
  assert.ok(!sideways.el('[data-share-toggle]').classList.contains('icon'));
  // The big screen has no room button (its join card has its own corner, screen.join).
  const tv = await playPage(cat, g, { screen: true, joinUrl: 'https://owls.example/rock-race/play?room=pub-5', room: 'pub-5' }).text();
  assert.doesNotMatch(tv, /<div class="room[^"]*"[^>]*data-room-ui>/);
});

test('on a server: the pill shares the room button\'s band, a server room says "Room 2", and the vote card is opaque', async () => {
  const server = { id: 'night-shift', name: 'Night Shift', badge: 'Hybrid · 2', line: 'Hybrid: 2 seats in every room are AI companions.', policy: 'hybrid', levelMax: 5 };
  const a = await shell('', { lobby: 's-night-shift-2', server });
  assert.equal(a.el('[data-room-code]').textContent, 'Room 2', 'the pill beside it names the server');
  assert.deepEqual(a.fetched[0], ['/rock-race/api/lobby?server=night-shift', 'POST']);
  // One band: both buttons in one row at the room button's place, the room button at the edge on a right corner.
  assert.match(a.html, /<div class="pills"><button class="pill" type="button" data-share-toggle[^]*?<button class="pill spill" type="button" data-server-toggle[^]*?<\/button><\/div>\s*<div class="sheet ssheet"/);
  assert.match(a.html, /\.room \.pills \{ display: flex; align-items: center; gap: 8px; \}/);
  assert.match(a.html, /\.room\.at-top-right \.pills, \.room\.at-bottom-right \.pills \{ flex-direction: row-reverse; \}/);
  // A phone held upright: the server pill is its dot from the start.
  assert.match(a.html, /@media \(max-width: 540px\) \{\s*\.spill, \.spill:hover[^{]*\{ width: 34px; padding: 0;/);
  // The vote card: nothing of the game shows through it, on any screen.
  const vote = /\n\.vote \{[^}]*\}/.exec(a.html)[0];
  assert.deepEqual([...vote.matchAll(/(?:^|[ {;])(background(?:-color)?|opacity|backdrop-filter): ([^;]+);/g)].map((m) => [m[1], m[2]]), [['background', '#080c16']]);
  // Another server's room, or a named one, is shown as it is.
  const other = await shell('', { lobby: 's-people-only-1', server });
  assert.equal(other.el('[data-room-code]').textContent, 's-people-only-1');
  const longer = await shell('', { lobby: 's-night-shift-crew-1', server });
  assert.equal(longer.el('[data-room-code]').textContent, 's-night-shift-crew-1', 'a server whose id starts the same is another server');
  const named = await shell('?room=owl-party', { server });
  assert.equal(named.el('[data-room-code]').textContent, 'owl-party');
});

test('local development: the TV view and the landing never put this computer\'s own address in a code; the share sheet and the landing say deploy to share', async () => {
  const { isLocalOrigin } = await import('../worker/qr.mjs');
  for (const o of ['http://127.0.0.1:8787', 'http://localhost:8931', 'http://[::1]:8787', 'http://0.0.0.0:80', 'http://dev.localhost']) assert.equal(isLocalOrigin(o), true, o);
  for (const o of ['https://night-owls.workers.dev', 'http://192.168.1.20:8787', 'https://homie.rocks']) assert.equal(isLocalOrigin(o), false, o);
  const cat = { studio: { name: 'Test Studio' }, games: [] };
  const game = { id: 'tiny-arena', name: 'Tiny Arena', players: { min: 1, max: 8 } };
  const local = await playPage(cat, game, { screen: true, joinUrl: 'http://127.0.0.1:8787/tiny-arena/play?room=pub-1', qr: null, local: true }).text();
  assert.doesNotMatch(local, /Scan to play|data-join>|127\.0\.0\.1:8787\/tiny-arena/);
  assert.match(local, /Deploy to share: this preview address works on this computer only/, 'the room button\'s sheet says so');
  const online = await playPage(cat, game, { screen: true, joinUrl: 'https://studio.test/tiny-arena/play?room=pub-1', qr: '<svg></svg>' }).text();
  assert.match(online, /Scan to play[\s\S]*studio\.test\/tiny-arena\/play\?room=pub-1/);
  const { gameLanding } = await import('../worker/site.mjs');
  const landing = gameLanding(cat, { ...game, landing: {} }, { origin: 'http://127.0.0.1:8787' });
  const html = typeof landing === 'string' ? landing : await landing.text();
  assert.doesNotMatch(html, /<svg[^>]*role="img"[^>]*>|Point your phone’s camera at the code/);
  assert.match(html, /Deploy to share/);
});

test('a game with an art direction: the play page\'s pills wear its paper and text (games.json ui), like its own HUD', async () => {
  const cat = { studio: { name: 'Test Studio' }, games: [] };
  const plain = await playPage(cat, { id: 'tiny', name: 'Tiny', players: { max: 4 } }).text();
  assert.doesNotMatch(plain, /\.pill, \.chip, \.pill\.dim \{ background: #/);
  const styled = await playPage(cat, { id: 'tiny', name: 'Tiny', players: { max: 4 }, ui: { paper: '#f6ecd9', text: '#1f2a24' } }).text();
  assert.match(styled, /\.pill, \.chip, \.pill\.dim \{ background: #f6ecd9e6; color: #1f2a24;/);
  const junk = await playPage(cat, { id: 'tiny', name: 'Tiny', players: { max: 4 }, ui: { paper: 'red;}body{display:none', text: '#000000' } }).text();
  assert.doesNotMatch(junk, /display:none/);
});

/* ------------------------------------------------------------------ netplay revision 9: the page around the frame */

test('the play page and its frame refuse selection, the long-press callout and page gestures', async () => {
  const { watchPage } = await import('../worker/pages.mjs');
  const html = await playPage(cat, game).text();
  const page = /\nhtml, body \{[^}]*\}/.exec(html)[0];
  for (const rule of ['touch-action: none', '-webkit-user-select: none', 'user-select: none', '-webkit-touch-callout: none', 'overscroll-behavior: none']) assert.ok(page.includes(rule), `the page: ${rule}`);
  const frame = /\niframe\.game \{[^}]*\}/.exec(html)[0];
  for (const rule of ['touch-action: none', '-webkit-user-select: none', 'user-select: none', '-webkit-touch-callout: none']) assert.ok(frame.includes(rule), `around the game's frame: ${rule}`);
  // The room's sheet keeps its text selectable (the link is there to be copied).
  assert.match(html, /\.sheet \{[^}]*user-select: text/);
  const watch = await watchPage(cat, game).text();
  assert.match(/\niframe\.game \{[^}]*\}/.exec(watch)[0], /-webkit-touch-callout: none/);
});

test('the address\'s switches reach the game\'s frame: ?debug and ?q always, the game\'s own names, never the page\'s own', async () => {
  const src = (h) => new URLSearchParams(h.el('iframe.game').src.split('?')[1]);
  const a = src(await shell('?room=owl-party&q=low&debug&seed=42&cam=top'));
  assert.equal(a.get('q'), 'low');
  assert.equal(a.get('debug'), '', 'a bare ?debug is passed on');
  assert.equal(a.get('cam'), 'top');
  assert.equal(a.get('seed'), null, 'a name the game did not declare is not passed');
  // game.json "netplay": { "params": [...] } (the catalogue row's netplay.params).
  const g = { ...game, netplay: { params: ['seed', 'room', 'k', 'name'] } };
  const h = await shell('?room=owl-party&seed=42&q=high&k=STOLEN&name=Ann', { g });
  const b = src(h);
  assert.equal(b.get('seed'), '42');
  assert.equal(b.get('q'), 'high');
  assert.equal(b.get('k'), null, 'a game can never ask for the seat\'s token');
  assert.equal(b.get('room'), 'owl-party', 'the room is the page\'s own word');
  assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.__shell.params)), { q: 'high', seed: '42' });
  // A value that is not a plain word is not passed at all.
  const c = src(await shell('?room=owl-party&q=' + encodeURIComponent('<img src=x>') + '&view=' + 'v'.repeat(49)));
  assert.equal(c.get('q'), null);
  assert.equal(c.get('view'), null);
  assert.equal(c.get('pf'), '1');
});

test('net.prefs: the page keeps a game\'s few settings for its frame, per game and capped', async () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  store.set('homie-prefs.other-game', JSON.stringify({ secret: 1 }));
  const h = await shell('?room=owl-party', { storage });
  const answer = () => h.posted.filter((m) => m.t === 'homie-prefs').at(-1);
  h.fromGame({ what: 'prefs', op: 'all', n: 1 });
  assert.deepEqual(answer(), { t: 'homie-prefs', n: 1, ok: true, all: {} }, 'nothing of another game\'s');
  h.fromGame({ what: 'prefs', op: 'set', n: 2, k: 'quality', v: 'low' });
  h.fromGame({ what: 'prefs', op: 'set', n: 3, k: 'best', v: { score: 61, at: 'cave' } });
  assert.deepEqual(answer(), { t: 'homie-prefs', n: 3, ok: true, kept: 'kept' });
  assert.deepEqual(JSON.parse(store.get('homie-prefs.rock-race')), { quality: 'low', best: { score: 61, at: 'cave' } });
  assert.deepEqual(JSON.parse(store.get('homie-prefs.other-game')), { secret: 1 }, 'another game\'s settings are untouched');
  h.fromGame({ what: 'prefs', op: 'all', n: 4 });
  assert.deepEqual(answer().all, { quality: 'low', best: { score: 61, at: 'cave' } });
  // The caps: 16 KB a game, 32 keys, 64 characters a key. A refusal changes nothing.
  h.fromGame({ what: 'prefs', op: 'set', n: 5, k: 'huge', v: 'x'.repeat(17_000) });
  assert.deepEqual([answer().ok, answer().why], [false, 'too-large']);
  h.fromGame({ what: 'prefs', op: 'set', n: 6, k: 'k'.repeat(65), v: 1 });
  assert.deepEqual([answer().ok, answer().why], [false, 'key']);
  for (let i = 0; i < 40; i += 1) h.fromGame({ what: 'prefs', op: 'set', n: 100 + i, k: `k${i}`, v: i });
  assert.equal(Object.keys(JSON.parse(store.get('homie-prefs.rock-race'))).length, 32);
  assert.equal(answer().ok, false);
  h.fromGame({ what: 'prefs', op: 'del', n: 7, k: 'quality' });
  assert.equal('quality' in JSON.parse(store.get('homie-prefs.rock-race')), false);
  // A message that is not from the game's own frame is not a prefs call.
  const before = store.get('homie-prefs.rock-race');
  for (const fn of h.heard.message) fn({ source: {}, data: { t: 'homie-net', what: 'prefs', op: 'set', n: 9, k: 'x', v: 1 } });
  assert.equal(store.get('homie-prefs.rock-race'), before);
  // A browser with no storage (a private window): kept for the visit, and the answer says so.
  const none = await shell('?room=owl-party', { storage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } } });
  none.fromGame({ what: 'prefs', op: 'set', n: 1, k: 'quality', v: 'low' });
  assert.deepEqual(none.posted.filter((m) => m.t === 'homie-prefs').at(-1), { t: 'homie-prefs', n: 1, ok: true, kept: 'memory' });
  none.fromGame({ what: 'prefs', op: 'all', n: 2 });
  assert.deepEqual(none.posted.filter((m) => m.t === 'homie-prefs').at(-1).all, { quality: 'low' });
});

test('the page tells the game\'s frame where its own controls sit, per device and the way it is held', async () => {
  const rects = { '[data-share-toggle]': [1180, 8, 92, 34], '[data-chip]': [10, 764, 132, 26], '[data-server-toggle]': [0, 0, 0, 0] };
  const h = await shell('?room=owl-party', { rects });
  assert.equal(h.posted.some((m) => m.t === 'homie-shell'), false, 'nothing before the helper attached');
  h.fromGame({ what: 'attached', v: 1, rev: 9 });
  const said = h.posted.filter((m) => m.t === 'homie-shell');
  assert.deepEqual(said, [{ t: 'homie-shell', device: 'desk', orientation: 'landscape', width: 1280, height: 800, rects: [{ id: 'room', x: 1180, y: 8, w: 92, h: 34 }, { id: 'chip', x: 10, y: 764, w: 132, h: 26, fades: true }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.__shell.rects)), said[0], 'and a check outside the frame reads the same');
  // Nothing moved: nothing is said again. The phone is turned: said again.
  for (const fn of h.heard.resize) fn();
  assert.equal(h.posted.filter((m) => m.t === 'homie-shell').length, 1);
  h.ctx.innerWidth = 390; h.ctx.innerHeight = 844;
  rects['[data-share-toggle]'] = [348, 8, 34, 34];
  for (const fn of h.heard.resize) fn();
  const turned = h.posted.filter((m) => m.t === 'homie-shell').at(-1);
  assert.deepEqual([turned.orientation, turned.width, turned.rects[0]], ['portrait', 390, { id: 'room', x: 348, y: 8, w: 34, h: 34 }]);
  const phone = await shell('?room=owl-party&hand=phone', { rects, width: 390, height: 844 });
  phone.fromGame({ what: 'attached', v: 1, rev: 9 });
  assert.equal(phone.posted.find((m) => m.t === 'homie-shell').device, 'phone');
});

test('the link and a newer build: the page says "reconnecting", and loads the game again when it must', async () => {
  const h = await shell('?room=owl-party');
  h.fromGame({ what: 'attached', v: 1, rev: 9 });
  h.fromGame({ what: 'link', state: 'reconnecting', prev: 'online', why: 'lost', hosting: true });
  assert.deepEqual([h.ctx.__shell.link.state, h.ctx.__shell.link.why, h.ctx.__shell.link.hosting], ['reconnecting', 'lost', true]);
  assert.match(h.el('[data-status]').textContent, /reconnecting/);
  h.fromGame({ what: 'link', state: 'alone', prev: 'connecting', why: 'relay-timeout', hosting: true });
  assert.match(h.el('[data-status]').textContent, /offline, reconnecting/);
  h.fromGame({ what: 'link', state: 'online', prev: 'alone', why: 'welcome', hosting: false });
  assert.doesNotMatch(h.el('[data-status]').textContent, /reconnecting/);
  // The game's own word that it was playable, after the helper had already lifted the card: readable from the page.
  h.fromGame({ what: 'ready', by: 'game', mode: 'auto', ms: 1740, lateMs: 1500 });
  assert.deepEqual([h.ctx.__shell.ready.mode, h.ctx.__shell.ready.ms, h.ctx.__shell.ready.lateMs], ['auto', 1740, 1500]);
  // A newer build is live and this tab is still in its own room: the game loads again at the round's break.
  const frame = h.el('iframe.game');
  const first = frame.src;
  frame.src = 'the-old-build';
  h.fromGame({ what: 'stale', ver: '2', mine: '1', final: false });
  assert.equal(frame.src, 'the-old-build', 'not in the middle of a round');
  assert.match(h.el('[data-toast]').textContent, /new version of Rock <Race> is ready/);
  h.fromGame({ what: 'round', round: { n: 3, phase: 'live', startedAt: 1, endsAt: 2 } });
  assert.equal(frame.src, 'the-old-build');
  h.fromGame({ what: 'round', round: { n: 3, phase: 'over', startedAt: 1, endsAt: 2, results: [] } });
  assert.equal(frame.src, first, 'at the break: the same frame address, served again by the Worker with the live build');
  assert.equal(h.ctx.__shell.reloaded, 1);
  // Kept out of a room for running the old build: loaded again at once, but never in a loop.
  const k = await shell('?room=owl-party');
  const kf = k.el('iframe.game');
  for (let i = 0; i < 5; i += 1) { kf.src = `old-${i}`; k.fromGame({ what: 'stale', ver: '2', mine: '1', final: true }); }
  assert.equal(k.ctx.__shell.reloaded, 2, 'twice a minute at most');
  assert.match(k.el('[data-toast]').textContent, /Reload the page to play the new version/);
  // The big screen has nothing to lose: at once.
  const tv = await shell('', { screen: true, room: 'pub-5' });
  const tf = tv.el('iframe.game');
  tf.src = 'the-old-build';
  tv.fromGame({ what: 'stale', ver: '2', mine: '1', final: false });
  assert.notEqual(tf.src, 'the-old-build');
});

/* ------------------------------------------------------------------ across the seam: the page says, the instruments read */

test('what the play page says about its link, its arrival and its own controls is what check, perf and the playtest read', async () => {
  const rects = { '[data-share-toggle]': [348, 8, 34, 34], '[data-chip]': [10, 800, 132, 26], '[data-share-sheet]': [20, 60, 350, 300] };
  const h = await shell('?room=owl-party&hand=phone', { rects, width: 390, height: 844 });
  const sh = h.ctx.__shell;
  // Before the helper says anything, `__shell.link` is the room's invite address (a string): not a link state.
  assert.equal(typeof sh.link, 'string');
  assert.equal(linkOf(sh.link), null);
  assert.equal(playtest.linkOf(sh.link), null);
  assert.equal(playtest.stateOf({ shell: { link: sh.link } }).link, null, 'unknown, never "online"');
  h.fromGame({ what: 'attached', v: 1, rev: 9, arrival: 'auto' });

  // THE LINK. The two instruments know the same six words and call the same four "cut off".
  assert.deepEqual(playtest.LINK_STATES, LINK_STATES);
  assert.deepEqual(playtest.CUT_OFF, CUT_OFF);
  const live = { round: { n: 2, phase: 'live', leftMs: 31_000 }, busy: 0, x: 4, y: 5, extra: { alive: true } };
  for (const state of LINK_STATES) {
    h.fromGame({ what: 'link', state, prev: 'online', why: 'lost', hosting: true });
    assert.equal(linkOf(sh.link), state, 'the studio\'s check reads the page\'s own object');
    // A live round and a free body, sampled in this link state: play only while the browser is in its room.
    const st = playtest.stateOf({ port: live, shell: { round: null, arrival: { phase: 'done' }, link: JSON.parse(JSON.stringify(sh.link)) } });
    assert.equal(st.link, state);
    const cut = CUT_OFF.includes(state);
    assert.equal(playtest.contextOf(st).kind, cut ? 'cut-off' : 'live', state);
    assert.equal(playtest.activePlay(st), !cut, `${state}: ${cut ? 'labelled, not judged as play' : 'play'}`);
    if (cut) {
      assert.match(playtest.describeState(st), new RegExp(`CUT OFF from its room \\(link ${state}\\)`));
      // A press and a UI frame taken then are BLOCKED and N/A, each with the label, never PASS or FAIL.
      const move = playtest.judgeMove([{ dir: 'right', moved: false, ms: null, before: st, after: st }]);
      assert.equal(move.verdict, 'BLOCKED');
      assert.match(move.why, new RegExp(`link ${state}`));
      const ui = playtest.judgeUi({ cover: 0.5, opaque: 0.5, centreOpaque: 0.5 }, { before: st, after: st });
      assert.deepEqual([ui.verdict, ui.screen], ['N/A', 'screen of a browser cut off from its room']);
    }
  }
  // The helper's own word (window.__homieNet.link, read in the frame) wins over what the page was last told.
  assert.equal(playtest.stateOf({ port: live, shell: { link: { state: 'online' } }, net: { link: 'alone' } }).link, 'alone');
  // A newer build is live and the helper has reconnected twice: said beside the state, in words, and not judged.
  h.fromGame({ what: 'stale', ver: '7', mine: '6', final: false });
  const aged = playtest.stateOf({ port: live, shell: { arrival: { phase: 'done' }, link: { state: 'online' }, stale: JSON.parse(JSON.stringify(sh.stale)) }, net: { link: 'online', reconnects: 2 } });
  assert.deepEqual([aged.stale, aged.reconnects, playtest.contextOf(aged).kind], ['7', 2, 'live']);
  assert.match(playtest.describeState(aged), /2 reconnects so far, this tab runs an older build \(7 is live\)/);
  // The two-browser check: a browser seen cut off was interrupted even when no counter moved or none was reported.
  const seen = [{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: null, cutOff: ['alone'] }];
  assert.deepEqual([connectionSummary(seen).uninterrupted, playtest.connectionNote(seen).uninterrupted], [false, false]);
  for (const note of [connectionSummary(seen).note, playtest.connectionNote(seen).note]) assert.match(note, /the phone was seen cut off from the room \(alone\)/);
  assert.equal(connectionSummary([{ browser: 'computer', reconnects: 0 }, { browser: 'phone', reconnects: 0 }]).uninterrupted, true);

  // THE ARRIVAL. The helper lifts the card (auto); 1.5 s later the game says it is ready. perf reports the mode and
  // the game's own time beside control-ready, from the page's real `__shell.arrival`.
  h.fromGame({ what: 'token', token: 'k', seat: 0 });
  h.fromGame({ what: 'playable', by: 'auto' });
  h.fromGame({ what: 'ready', by: 'game', mode: 'auto', ms: 1740, lateMs: 1500 });
  const a = arrivalFacts(sh.arrival);
  assert.deepEqual([a.mode, a.by, a.lateMs], ['auto', 'auto', 1500]);
  assert.ok(Number.isFinite(a.explicitMs), 'when the game itself said so, on the page\'s clock');
  const run = { device: 'phone', browsers: [{ role: 'host', frames: { p50: 16.7, p95: 18 }, load: { lookMs: 140, playableMs: 900, arrival: a, readyMs: 2400 } }] };
  assert.equal(metricsOfRun(run)['phone.host.load.ready'], 2400);
  assert.equal(metricsOfRun(run)['phone.host.load.playable'], 900);
  assert.deepEqual(summaryOf([run]).arrival, [{ device: 'phone', role: 'host', mode: 'auto', by: 'auto', lateMs: 1500 }]);
  assert.equal(arrivalFacts(null), null, 'a page with no arrival state: not known');

  // THE PAGE'S OWN CONTROLS. A HUD element under the room button is reported; under the fading chip it is a note;
  // an open sheet is a moment, not layout.
  h.el('[data-share-sheet]').hidden = false; // the room sheet is open at this moment
  for (const fn of h.heard.resize) fn();
  const layout = JSON.parse(JSON.stringify(sh.rects));
  assert.deepEqual(layout.rects.map((r) => r.id), ['room', 'chip', 'sheet']);
  const hud = [
    { label: 'div.score "Score 120"', x: 300, y: 10, w: 80, h: 30 },
    { label: 'button.fire "FIRE"', x: 280, y: 740, w: 90, h: 90, interactive: true },
    { label: 'div.hint "Drag to move"', x: 12, y: 790, w: 160, h: 40 },
    { label: 'div.timer "0:31"', x: 170, y: 10, w: 50, h: 24 },
    { label: 'div.map "Map"', x: 40, y: 100, w: 100, h: 100 }, // under the open sheet only
  ];
  const o = playtest.shellOverlaps(layout, hud);
  assert.equal(o.known, true);
  assert.deepEqual(o.overlaps.map((x) => [x.hud, x.shell, x.fades]), [['div.score "Score 120"', 'room', false], ['div.hint "Drag to move"', 'chip', true]]);
  assert.deepEqual(o.hidden.map((x) => x.shell), ['room']);
  const onlineNow = playtest.stateOf({ port: live, shell: { arrival: { phase: 'done' }, link: { state: 'online' } } });
  const clear = { cover: 0.04, opaque: 0.01, centreOpaque: 0 };
  const warned = playtest.judgeUi(clear, { before: onlineNow, after: onlineNow, overlaps: o });
  assert.equal(warned.verdict, 'WARN', 'it would pass the coverage bar, and the score is under the room button');
  assert.match(warned.why, /div\.score "Score 120" is under the page's room control \(\d+% of it covered\)/);
  assert.match(warned.why, /net\.shell/);
  // Moved clear of the room button: only the fading chip is left, which is said and does not change the verdict.
  const moved = playtest.shellOverlaps(layout, hud.map((e) => (e.label.startsWith('div.score') ? { ...e, x: 200 } : e)));
  const noted = playtest.judgeUi(clear, { before: onlineNow, after: onlineNow, overlaps: moved });
  assert.equal(noted.verdict, 'PASS');
  assert.match(noted.qualifier, /under the page's chip control .*fades after a few seconds/);
  assert.equal(playtest.judgeUi(clear, { before: onlineNow, after: onlineNow, overlaps: playtest.shellOverlaps(layout, [hud[3]]) }).qualifier, undefined);
  // A real coverage failure stays a FAIL, with the overlap said beside it.
  assert.equal(playtest.judgeUi({ cover: 0.4, opaque: 0.3, centreOpaque: 0 }, { before: onlineNow, after: onlineNow, overlaps: o }).verdict, 'FAIL');
  // An older page says no layout: not checked, and said so, never "clear".
  const none = playtest.shellOverlaps(null, hud);
  assert.equal(none.known, false);
  assert.match(playtest.judgeUi(clear, { before: onlineNow, after: onlineNow, overlaps: none }).qualifier, /reported no layout of its own controls/);
});
