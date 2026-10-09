import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { SHOP_SHELL_JS } from '../worker/shop-page.mjs';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import worker from '../worker/index.mjs';
import { gameLanding, customPage, PAGE_CSP } from '../worker/site.mjs';
import { playPage, watchPage } from '../worker/pages.mjs';
import { NetRoom } from '../worker/room.mjs';
import { EMBED_GAME_JS, PLAYER_ANCESTORS, playerOrigins } from '../worker/embed.mjs';
import { chromeArgs } from '../lib/chrome.mjs';

const game = { id: 'test', name: 'Test & play', blurb: 'Move one step.', players: { max: 4 }, cover: 'cover.png', landing: { cover: '/games/test/cover.png' }, playerImage: { src: '/games/test/cover.png', width: 1200, height: 630, bytes: 20000, format: 'png' } };
const catalogue = () => ({ studio: { name: 'Studio', site: { twitterSite: '@studio' } }, games: [{ ...game }], songs: [], videos: [] });
function fixture(cat = catalogue(), extra = {}) {
  return { ASSETS: { async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/games.json') return Response.json(cat);
    if (path === '/games/test/index.html') return new Response('<!doctype html><html><head></head><body><button id="step">Step</button><output id="result">0</output><script src="/client.js"></script></body></html>');
    return new Response('not found', { status: 404 });
  } }, LOBBY: { idFromName: x => x, get: () => ({ fetch: async u => Response.json(new URL(u).pathname === '/rooms' ? { rooms: [] } : { room: 'pub-1', players: 0, max: 4 }) }) }, ...extra };
}
const get = (env, path, origin = 'https://studio.example') => worker.fetch(new Request(origin + path, { headers: { 'user-agent': 'homie-house-qa' } }), env, { waitUntil() {} });
const tags = text => Object.fromEntries([...text.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)].map(m => [m[1], m[2]]));

test('landing, custom landing, Play and Watch carry absolute HTTPS player metadata and keep OG', async () => {
  const cat = catalogue(), origin = 'https://studio.example';
  for (const response of [gameLanding(cat, game, { origin }), playPage(cat, game, { origin }), watchPage(cat, game, { origin })]) {
    const t = tags(await response.text());
    assert.equal(t['twitter:card'], 'player');
    assert.equal(t['twitter:player'], origin + '/test/play/embed');
    assert.equal(t['twitter:image'], origin + '/games/test/cover.png');
    assert.equal(t['twitter:player:width'], '480'); assert.equal(t['twitter:player:height'], '480');
    assert.equal(t['twitter:site'], '@studio');
    assert.ok(t['twitter:title']); assert.ok(t['twitter:description']);
    assert.equal(t['og:type'], 'website'); assert.ok(t['og:image']); assert.equal(t['og:video'], undefined);
  }
  const custom = await customPage(cat, '<head><meta name="twitter:card" content="summary"><meta property="og:image" content="/my.png"></head>', { origin, playerGame: game }).text();
  assert.equal((custom.match(/name="twitter:card"/g) || []).length, 1);
  assert.equal(tags(custom)['twitter:card'], 'summary'); assert.equal(tags(custom)['og:image'], '/my.png');
});

test('studio and game switches, TV-only, private, insecure origin and missing image keep picture cards', async () => {
  for (const change of [c => { c.studio.site.playerCard = false; }, c => { c.games[0].playerCard = false; }, c => { c.games[0].screen = { singleScreen: false }; }, c => { c.games[0].launch = 'invite'; }]) {
    const c = catalogue(); change(c);
    const t = tags(await gameLanding(c, c.games[0], { origin: 'https://studio.example' }).text());
    assert.notEqual(t['twitter:card'], 'player'); assert.equal(t['twitter:player'], undefined); assert.ok(t['og:image']);
    const env = fixture(c);
    assert.equal((await get(env, '/test/play/embed')).status, 404);
    assert.equal((await get(env, '/test/__game/?embed=1&room=pub-1')).status, 404);
  }
  for (const [g, origin] of [[game, 'http://studio.example'], [{ ...game, playerImage: null }, 'https://studio.example']]) {
    assert.equal(tags(await playPage(catalogue(), g, { origin }).text())['twitter:player'], undefined);
  }
});

test('only embed and its nested game instance admit configured ancestors; preview is local only', async () => {
  const cat = catalogue(), env = fixture(cat);
  for (const path of ['/test/play/embed', '/test/__game/?embed=1&room=pub-1']) {
    const r = await get(env, path); assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    for (const origin of PLAYER_ANCESTORS) assert.ok(csp.includes(origin), csp);
    assert.equal(r.headers.get('x-frame-options'), null);
  }
  assert.equal((await get(env, '/test/')).headers.get('content-security-policy'), PAGE_CSP);
  for (const path of ['/test/play', '/test/watch', '/test/tv']) {
    const r = await get(env, path); assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'");
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  }
  assert.equal((await get(env, '/test/__game/')).headers.get('content-security-policy'), "sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups; frame-ancestors 'self'");
  const custom = catalogue(); custom.studio.site.playerCardOrigins = ['https://host.example'];
  assert.equal((await get(fixture(custom), '/test/play/embed')).headers.get('content-security-policy'), "frame-ancestors https://host.example");
  assert.deepEqual(playerOrigins(['*', 'https:', 'https://ok.example; script-src *', 'http://no.example', 'https://yes.example']), ['https://yes.example']);
  assert.equal((await get(env, '/test/play/preview')).status, 404);
  const preview = await get(fixture(cat, { HOMIE_EMBED_PREVIEW: '1' }), '/test/play/preview', 'http://127.0.0.1:8787');
  assert.match(await preview.text(), /http:\/\/localhost:8787\/test\/play\/embed/);
});

for (const kind of ['game', 'app']) test(`Chrome: ${kind} cross-origin sandbox, no storage, actual netplay seat and input, safe exits`, { timeout: 60000 }, async t => {
  if (!process.env.CHROME_PATH) { t.skip('Set CHROME_PATH for the cross-origin Chrome proof.'); return; }
  const cat = catalogue();
  const action = kind === 'app' ? 'open' : 'play';
  if (kind === 'app') Object.assign(cat.games[0], { kind, roles: { customer: { signIn: false, can: [] } }, surfaces: { phone: 'customer' }, records: { persist: false, collections: {} } });
  const room = new NetRoom({ code: 'pub-1', maxPlayers: 4 });
  const received = []; let position = 0;
  room.setServerHost({ frame(m) { if (m.t === 'in') { position += Number(m.s[0]?.[1]) || 0; room.hostFrame({ t: 'snap', k: position, d: { position } }); } }, facts: () => ({}) });
  const compiled = await build({ stdin: { contents: `import { createNetplay } from './packages/studio/netplay/netplay.ts';
    window.net = createNetplay({game:'test', rules:true});
    document.querySelector('#step').onclick = () => { net.steps(1, 1, [[1,1]], 0); };
    net.on('snapshot', e => { document.querySelector('#result').textContent = String(e.d.position); });`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const env = fixture(cat, { HOMIE_EMBED_PREVIEW: '1' });
  const server = createServer(async (req, res) => {
    try {
      const origin = 'http://' + req.headers.host;
      if (req.url === '/client.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); res.end(compiled.outputFiles[0].text); return; }
      const response = await get(env, req.url, origin);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', ws => {
    const h = room.attach({ send: x => ws.send(x), close: () => ws.close(), buffered: () => ws.bufferedAmount });
    ws.on('message', bytes => { received.push(JSON.parse(String(bytes))); h.onMessage(String(bytes)); });
    ws.on('close', () => h.onClose());
  });
  let browser;
  const beat = setInterval(() => { room.tick(); room.hostFrame({ t: 'snap', k: position, d: { position } }); }, 100);
  try {
    server.listen(0); await once(server, 'listening');
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: chromeArgs() });
    const page = await browser.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(10000); const errors = []; page.on('pageerror', e => errors.push(e.message));
    // Deny both storage getters in EVERY document. A blocked cookie getter must not affect netplay either.
    await page.evaluateOnNewDocument(() => {
      for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Blocked', 'SecurityError'); } });
      Object.defineProperty(document, 'cookie', { get() { throw new DOMException('Blocked', 'SecurityError'); }, set() { throw new DOMException('Blocked', 'SecurityError'); } });
    });
    await page.goto(`http://localhost:${server.address().port}/test/${action}/preview`);
    await page.waitForFunction(() => document.querySelector('iframe').sandbox.value === 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    let shell, inner;
    for (let n = 0; n < 100; n++) {
      shell = page.frames().find(f => f.url().includes('/' + action + '/embed'));
      inner = page.frames().find(f => f.url().includes('/__game/'));
      if (inner && await inner.evaluate(() => typeof window.net?.seat === 'number').catch(() => false)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(inner, 'nested game loads under CSP');
    await inner.waitForFunction(() => typeof net.seat === 'number', { timeout: 10000 });
    assert.match(await inner.evaluate(() => net.name), /^Guest /);
    assert.equal(await inner.evaluate(() => net.link), 'online');
    await inner.click('#step');
    await inner.waitForFunction(() => document.querySelector('#result').textContent === '1', { timeout: 10000 });
    assert.ok(received.some(m => m.t === 'in'), 'input crossed the real WebSocket');
    const popupPromise = browser.waitForTarget(target => target.opener() === page.target(), { timeout: 10000 });
    await shell.click('[data-share-toggle]');
    await shell.click('[data-studio-open]');
    const target = await popupPromise; const popup = await target.page();
    await popup.waitForFunction(action => location.pathname === '/test/' + action, {}, action);
    await popup.waitForFunction(() => !!document.querySelector('iframe.game')?.src);
    const topGame = popup.frames().find(f => f.url().includes('/__game/'));
    await topGame.waitForFunction(() => typeof net.seat === 'number');
    await topGame.click('#step');
    await topGame.waitForFunction(() => document.querySelector('#result').textContent === '2');
    assert.equal(await popup.evaluate(() => window.top === window), true);
    assert.equal((await shell.$eval('[data-studio-open]', a => a.href)).includes('room=pub-1'), true);
    await popup.close();
    await page.goto(`http://localhost:${server.address().port}/test/${action}/embed`);
    await page.waitForFunction(() => document.documentElement.classList.contains('player-top'));
    let topInner;
    for (let n = 0; n < 100; n++) { topInner = page.frames().find(f => f.url().includes('/__game/')); if (topInner) break; await new Promise(r => setTimeout(r, 50)); }
    await topInner.waitForFunction(() => typeof net.seat === 'number');
    await topInner.click('#step');
    await topInner.waitForFunction(() => document.querySelector('#result').textContent === '3');
    assert.deepEqual(errors, []);
  } finally {
    clearInterval(beat); if (browser) await browser.close();
    for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});


test('restricted APIs do not throw or reject into the game; audio waits for a press', async () => {
  const messages = [], events = {};
  class Element {
    requestPointerLock() { throw new Error('sandbox'); }
    requestFullscreen() { return Promise.reject(new Error('policy')); }
  }
  let played = 0, resumed = 0, suspended = 0;
  class Media { play() { played++; return Promise.resolve(); } }
  class Audio { resume() { resumed++; return Promise.resolve(); } suspend() { suspended++; return Promise.resolve(); } }
  const scope = { Element, HTMLMediaElement: Media, Promise, Proxy, Reflect, navigator: { getGamepads() { throw new Error('policy'); } },
    parent: { postMessage: m => messages.push(m) }, document: { addEventListener() {} }, addEventListener: (name, fn) => { events[name] = fn; } };
  scope.window = { AudioContext: Audio };
  runInNewContext(EMBED_GAME_JS, scope);
  await new Element().requestPointerLock(); await new Element().requestFullscreen();
  assert.equal(scope.navigator.getGamepads().length, 0);
  const audio = new scope.window.AudioContext(); const earlyResume = audio.resume(), earlyPlay = new Media().play();
  assert.equal(suspended, 1); assert.equal(resumed, 0); assert.equal(played, 0);
  events.pointerdown(); await earlyResume; await earlyPlay;
  assert.equal(resumed, 1); assert.equal(played, 1);
  assert.deepEqual(messages.map(m => m.feature), ['pointer lock', 'fullscreen', 'gamepad']);
});

test('shop in an embed offers a real new-tab studio link and never creates checkout', async () => {
  const nodes = [], calls = [];
  const node = tag => {
    const n = { tag, attrs: {}, children: [], setAttribute(k,v) { this.attrs[k] = v; }, appendChild(v) { this.children.push(v); }, addEventListener() {}, remove() {} };
    nodes.push(n); return n;
  };
  const frame = { contentWindow: { postMessage() {} } };
  const w = { __HOMIE_PLAY: { embed: true, game: 'test', shop: { items: 1 } }, top: {}, addEventListener() {} };
  runInNewContext(SHOP_SHELL_JS, { window: w, document: { body: node('body'), createElement: node, addEventListener() {}, querySelectorAll: () => [], querySelector: s => s === 'iframe.game' ? frame : null },
    fetch: async (url, init) => { calls.push([url, init.method]); return { json: async () => ({ owns: [] }) }; }, setTimeout, clearTimeout });
  w.__shell.shop.open('supporter');
  const link = nodes.find(n => n.tag === 'a');
  assert.equal(link.attrs.href, '/shop/?game=test&item=supporter'); assert.equal(link.attrs.target, '_blank');
  assert.equal(link.attrs.rel, 'noopener noreferrer');
  assert.match(link.textContent, /Buy on the studio/);
  await Promise.resolve(); assert.ok(calls.every(([url, method]) => method === 'GET' && url.startsWith('/api/player/owns')));
});

test('player headers match Play apart from ancestors, including normalized paths', async () => {
  const env = fixture();
  for (const path of ['/test/play/embed/', '//test/play/embed', '/test//play/embed']) {
    const r = await get(env, path);
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-frame-options'), null);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /connect-src/);
  }
  const ordinary = await get(env, '/test/__game/?room=pub-1');
  const embedded = await get(env, '/test/__game/?embed=1&room=pub-1');
  const strip = r => r.headers.get('content-security-policy').replace(/frame-ancestors[^;]*/, '');
  assert.equal(strip(ordinary), strip(embedded));
  for (const q of ['embed=1', 'embed=1&room=private', 'embed=1&room=pub-1&watch=1', 'embed=1&room=pub-1&t=ticket', 'embed=1&room=pub-1&want=screen']) {
    assert.equal((await get(env, '/test/__game/?' + q)).status, 400);
  }
});

test('origins accept punycode, bound their count, reject suffix wildcards and invalid ports', () => {
  assert.deepEqual(playerOrigins(['https://*.com', 'https://*.co.uk', 'https://x.com:99999', 'https://xn--80ak6aa92e.com']), ['https://xn--80ak6aa92e.com']);
  assert.equal(playerOrigins(Array.from({ length: 40 }, (_, i) => `https://a${i}.example`)).length, 8);
});

test('custom Twitter metadata and original landing OG pictures remain the owner’s', async () => {
  const html = '<head><meta name="twitter:card" content="summary"><meta name="twitter:image" content="/mine.svg"><meta name="twitter:title" content="Mine"><meta name="twitter:description" content="Own words"></head>';
  const result = await customPage(catalogue(), html, { origin: 'https://studio.example', playerGame: game }).text();
  assert.ok(result.includes(html));
  const tall = { ...game, landing: { hero: { tallImage: '/tall.jpg' } } };
  assert.equal(tags(await gameLanding(catalogue(), tall, { origin: 'https://studio.example' }).text())['og:image'], undefined);
});

test('a picture X would not render never advertises a player; shape and a missing handle never withhold one', async () => {
  const origin = 'https://studio.example';
  for (const image of [null, { ...game.playerImage, format: 'svg' }, { ...game.playerImage, width: 200, height: 100 }, { ...game.playerImage, bytes: 5000000 }]) {
    const t = tags(await playPage(catalogue(), { ...game, playerImage: image }, { origin }).text());
    assert.equal(t['twitter:player'], undefined);
  }
  // The two game pages whose posts showed a play button (1200×628 and 1200×800 pictures, no twitter:site), a square
  // picture, a tall one and the smallest X names: each is a player card.
  for (const [width, height] of [[1200, 628], [1200, 800], [480, 480], [450, 800], [262, 262], [350, 196]]) {
    const cat = catalogue(); delete cat.studio.site.twitterSite;
    const t = tags(await gameLanding(cat, { ...game, playerImage: { ...game.playerImage, width, height } }, { origin }).text());
    assert.equal(t['twitter:card'], 'player', `${width}×${height}`); assert.equal(t['twitter:player'], origin + '/test/play/embed');
    assert.equal(t['twitter:site'], undefined);
  }
  const odd = catalogue(); odd.studio.site.twitterSite = 'not a handle';
  const t = tags(await playPage(odd, game, { origin }).text());
  assert.equal(t['twitter:card'], 'player'); assert.equal(t['twitter:site'], undefined);
});

test('Play, Watch and the player address carry no social tags without a player card', async () => {
  const origin = 'https://studio.example', bare = { ...game, playerImage: null };
  for (const response of [playPage(catalogue(), bare, { origin }), playPage(catalogue(), bare, { origin, embed: true }), watchPage(catalogue(), bare, { origin }), playPage(catalogue(), game, { origin: 'http://studio.example' })]) {
    assert.doesNotMatch(await response.text(), /<meta (?:name|property)="(?:og|twitter):/);
  }
});

test('the player falls back to the room Play falls back to, keeps a visit, and signs in back to Play', async () => {
  const env = fixture();
  // The lobby does not answer: Play starts the room `main`, and so does the player; its game document is served.
  assert.equal((await get(env, '/test/__game/?embed=1&room=main')).status, 200);
  const page = await (await get(env, '/test/play/embed')).text();
  assert.match(page, /\.catch\(function \(\) \{ start\('main'\); \}\)/);
  // A visit's room and guest name are kept only by a page of its own, and only a public room or `main` is taken back.
  assert.match(page, /var keeps = !boot\.embed \|\| !framed;/);
  assert.match(page, /var EMBED_ROOM = \/\^\(\?:pub-\[1-9\]\[0-9\]\*\|main\)\$\/;/);
  // Signing in from the player comes back to Play in the same room.
  assert.ok(page.includes("boot.kind === 'app' ? '/open' : '/play'"));
  // The room sheet keeps to the safe area, and the way out is its first row.
  assert.match(page, /\.sheet\{position:fixed;inset:calc\(max\(8px,env\(safe-area-inset-top\)\) \+ 48px\) max\(8px,env\(safe-area-inset-right\)\)/);
  assert.ok(page.indexOf('data-studio-open') < page.indexOf('data-invite>'));
});

 test('apps share player metadata, switches and the open/embed route', async () => {
  const cat = catalogue(); const app = Object.assign(cat.games[0], { kind: 'app', name: 'Workshop', blurb: '', roles: { customer: { signIn: false, can: [] } }, surfaces: { phone: 'customer' }, records: { persist: false, collections: {} } });
  const env = fixture(cat);
  for (const path of ['/test/', '/test/open', '/test/open/embed']) {
    const res = await get(env, path); assert.equal(res.status, 200, path);
    const meta = tags(await res.text()); assert.equal(meta['twitter:player'], 'https://studio.example/test/open/embed');
    assert.equal(meta['twitter:image'], 'https://studio.example/games/test/cover.png');
    if (path !== '/test/') assert.match(meta['twitter:description'], /Open Workshop/);
  }
  app.playerCard = false;
  assert.equal((await get(fixture(cat), '/test/open/embed')).status, 404);
});
