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
 *     held upright), a server room's button says "Room 2", and the vote card is opaque.
 * The shell script runs here against a small stand-in page (no browser needed).
 * Run: node --test packages/studio/test/play.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { NetRoom, HANDLE_WORDS, handleFor } from '../worker/room.mjs';
import { playPage, sharePlaces } from '../worker/pages.mjs';

const cat = { studio: { name: 'Night Owls', theme: { accent: '#ffcf5a' } }, games: [] };
const game = { id: 'rock-race', name: 'Rock <Race>', players: { max: 6 } };

test('the game frame delegates fullscreen, autoplay and gamepad to its opaque origin', async () => {
  const html = await playPage(cat, game).text();
  assert.match(html, /<iframe class="game"[^>]* sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen \*; autoplay \*; gamepad \*"><\/iframe>/);
  assert.doesNotMatch(html, /allow="fullscreen; autoplay; gamepad"/);
});

/** The play page's shell script, run against a stand-in page at `search`. */
async function shell(search, { lobby = 'pub-3', screen = false, room = null, g = game, width = 1280, height = 800, server = null } = {}) {
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
        append() {}, focus() {}, contentWindow: { focus() {} },
      });
    }
    return els.get(sel);
  };
  const replaced = [];
  const fetched = [];
  const ctx = {
    document: { querySelector: el, createElement: () => el(`new-${Math.random()}`), addEventListener() {} },
    location: { search, origin: 'https://owls.example', pathname: `/${game.id}/${screen ? 'tv' : 'play'}`, hash: '', host: 'owls.example', protocol: 'https:' },
    history: { state: null, replaceState: (s, t, u) => replaced.push(u) },
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    WebSocket: class { constructor(u) { this.url = u; } },
    fetch: async (u, o) => { fetched.push([u, o?.method]); return { json: async () => ({ room: lobby }) }; },
    URLSearchParams, setTimeout, clearTimeout, innerWidth: width, innerHeight: height,
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  await new Promise((r) => setTimeout(r, 10));
  return { html, ctx, el, replaced, fetched };
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
  assert.match(a.el('iframe.game').src, /^\/rock-race\/__game\/\?room=pub-3&device=desk&want=play&b=[A-Za-z0-9_-]{16,43}$/);
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
