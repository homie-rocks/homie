/**
 * The studio site's pages: home, a game's page, the play shell. Plain HTML
 * from the Worker, no framework; every name a player typed is escaped.
 */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BASE_CSS = `
:root { color-scheme: dark; --bg: #07080d; --panel: #10131c; --ink: #eef1f8; --dim: #9aa3b7; --line: rgba(255,255,255,.10); --accent: #ffcf5a; --accent-ink: #1a1405; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
header.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.brand { font-weight: 800; letter-spacing: -.02em; font-size: clamp(28px, 5vw, 44px); text-decoration: none; }
.tag { color: var(--dim); font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; margin-top: 28px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; display: flex; flex-direction: column; gap: 10px; min-height: 190px; }
.card h2 { margin: 0; font-size: 22px; letter-spacing: -.01em; }
.card p { margin: 0; color: var(--dim); flex: 1; }
.meta { color: var(--dim); font-size: 13px; display: flex; gap: 12px; flex-wrap: wrap; }
.live { color: #7dffb0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 22px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-weight: 800; text-decoration: none; font-size: 17px; }
.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); font-weight: 600; }
.hero { padding: 48px 0 24px; }
.hero h1 { font-size: clamp(40px, 9vw, 88px); line-height: .95; margin: 0 0 16px; letter-spacing: -.03em; }
.hero p { color: var(--dim); max-width: 60ch; font-size: 18px; margin: 0 0 28px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
footer { margin-top: 48px; color: var(--dim); font-size: 13px; }
@media (max-width: 540px) { .wrap { padding: 20px 16px 48px; } .btn { width: 100%; } }
`;

function page(title, body, { extraHead = '', viewport = 'width=device-width, initial-scale=1, viewport-fit=cover' } = {}) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="${viewport}">
<title>${esc(title)}</title><link rel="icon" href="data:,"><style>${BASE_CSS}</style>${extraHead}</head>
<body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export function homePage(cat, live = {}) {
  const name = cat.studio?.name ?? 'Studio';
  const games = cat.games ?? [];
  const cards = games.map((g) => `
    <article class="card">
      <h2>${esc(g.name)}</h2>
      <p>${esc(g.blurb)}</p>
      <div class="meta"><span>${esc(g.players?.max ? `up to ${g.players.max} players` : 'multiplayer')}</span>${live[g.id] ? `<span class="live">● ${live[g.id]} playing now</span>` : ''}</div>
      <div class="row"><a class="btn" href="/${esc(g.id)}/play">Play</a><a class="btn ghost" href="/${esc(g.id)}/">About</a></div>
    </article>`).join('');
  return page(name, `<div class="wrap">
    <header class="top"><a class="brand" href="/">${esc(name)}</a><span class="tag">Press Play and you are in a live room.</span></header>
    ${games.length ? `<section class="grid">${cards}</section>` : '<p class="tag" style="margin-top:28px">No games published yet.</p>'}
    <footer>${esc(name)} runs on its own Cloudflare. Made with Homie.</footer>
  </div>`);
}

export function gamePage(cat, g, playing = 0) {
  const name = cat.studio?.name ?? 'Studio';
  return page(`${g.name} · ${name}`, `<div class="wrap">
    <header class="top"><a class="brand" href="/" style="font-size:22px">${esc(name)}</a><span class="tag">${playing ? `<span class="live">● ${playing} playing now</span>` : 'Anyone who presses Play joins the same room.'}</span></header>
    <section class="hero">
      <h1>${esc(g.name)}</h1>
      <p>${esc(g.blurb)}</p>
      <div class="row"><a class="btn" href="/${esc(g.id)}/play">Play now</a><a class="btn ghost" href="/${esc(g.id)}/tv">Big screen</a></div>
      <div class="meta" style="margin-top:18px"><span>${esc(g.players?.max ? `1–${g.players.max} players` : 'multiplayer')}</span>${g.roundSeconds ? `<span>${esc(g.roundSeconds)} s rounds</span>` : ''}<span>phone or computer</span></div>
    </section>
  </div>`);
}

export function notFoundPage(why) {
  const res = page('Not found', `<div class="wrap"><h1>Not found</h1><p class="tag">${esc(why)}</p><p><a class="btn ghost" href="/">Home</a></p></div>`);
  return new Response(res.body, { status: 404, headers: res.headers });
}

/**
 * The play shell. It asks the Lobby for a public room, boots the game frame at
 * once (seated, no waiting), keeps the seat token for a reload, and keeps the
 * room's facts in `window.__shell` (what a test or a big screen reads).
 */
export function playPage(cat, g, { screen = false, joinUrl = null, qr = null, room = null } = {}) {
  // The phone's glass belongs to the game: no page pan, pinch-zoom, text selection or callout under a thumb
  // (a pinch between a stick thumb and a button thumb made the browser cancel both touches).
  const css = `html, body { height: 100%; overflow: hidden; overscroll-behavior: none; background: #04060c; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
iframe.game { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #04060c; touch-action: none; }
.chip { position: fixed; left: 10px; bottom: max(10px, env(safe-area-inset-bottom)); z-index: 5; transition: opacity .6s; }
.chip.quiet { opacity: 0; }
.chip { padding: 6px 10px; border-radius: 999px; background: rgba(0,0,0,.55); color: #dfe6f5; font: 12px/1.2 ui-sans-serif, system-ui, sans-serif; pointer-events: none; backdrop-filter: blur(6px); }
.chip a { pointer-events: auto; text-decoration: none; }
.card { position: fixed; right: 12px; bottom: 12px; z-index: 4; max-width: 300px; padding: 10px 12px; border-radius: 12px; background: rgba(8,12,22,.82); border: 1px solid rgba(255,255,255,.14); color: #e8ecf5; font: 13px/1.35 ui-sans-serif, system-ui, sans-serif; }
.card h2 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #ffcf5a; }
.card ol { margin: 0; padding-left: 18px; }
.join { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 6; display: flex; gap: 14px; align-items: center; padding: 12px 14px; border-radius: 16px; background: rgba(8,12,22,.78); border: 1px solid rgba(255,255,255,.14); color: #eef1f8; font: 600 clamp(14px, 1.6vmin, 22px)/1.3 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
.join.join-top-left { top: max(16px, env(safe-area-inset-top)); left: max(16px, env(safe-area-inset-left)); right: auto; bottom: auto; }
.join.join-top-right { top: max(16px, env(safe-area-inset-top)); bottom: auto; }
.join.join-bottom-left { left: max(16px, env(safe-area-inset-left)); right: auto; }
.join .qr { width: clamp(96px, 15vmin, 220px); height: clamp(96px, 15vmin, 220px); border-radius: 8px; overflow: hidden; }
.join .qr svg { width: 100%; height: 100%; display: block; }
.join b { display: block; color: #ffcf5a; font-size: 1.15em; margin-bottom: 4px; }
.join span { opacity: .85; word-break: break-all; }
[hidden] { display: none !important; }`;
  const boot = { game: g.id, name: g.name, screen: Boolean(screen), ...(room ? { room } : {}) };
  // game.json "screen": { "join": "top-left" | "top-right" | "bottom-left" | "bottom-right" } keeps the card off the game's own HUD.
  const corner = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(g.screen?.join) ? g.screen.join : 'bottom-right';
  const joinCard = screen && joinUrl ? `<div class="join join-${corner}" data-join>${qr ? `<div class="qr">${qr}</div>` : ''}<div><b>Scan to play</b><span>${esc(joinUrl.replace(/^https?:\/\//, ''))}</span></div></div>` : '';
  return page(`${g.name} · play`, `
<iframe class="game" title="${esc(g.name)}" sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen; autoplay; gamepad"></iframe>
<div class="chip" data-chip><a href="/${esc(g.id)}/">← ${esc(g.name)}</a> · <span data-status>finding a room…</span></div>
<div class="card" data-results hidden></div>
<div class="card" data-screen hidden></div>
${joinCard}
<script>window.__HOMIE_PLAY=${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script>${SHELL_JS}</script>`, { extraHead: `<style>${css}</style>`, viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' });
}

/* The shell script (runs on the site's own origin; the game runs in the sandboxed frame). */
const SHELL_JS = String.raw`(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY;
  var params = new URLSearchParams(location.search);
  var screenMode = params.get('screen') === '1' || boot.screen === true;
  var asked = params.get('hand');
  var device = asked === 'phone' || asked === 'desk' || asked === 'tv' ? asked : Math.min(innerWidth, innerHeight) <= 540 ? 'phone' : 'desk';
  var want = screenMode ? 'screen' : 'play';
  var frame = document.querySelector('iframe.game');
  var statusEl = document.querySelector('[data-status]');
  var results = document.querySelector('[data-results]');
  var screenCard = document.querySelector('[data-screen]');
  var state = { game: boot.game, room: null, device: device, want: want, attached: false, stats: null, round: null, roster: null, facts: null, seat: null, results: [], closed: null };
  window.__shell = state;

  // The chip says who is here, then gets out of the game's way (games draw their own HUD at the top).
  var chip = document.querySelector('[data-chip]');
  var quietTimer = null;
  function say(text) {
    if (statusEl.textContent === text) return;
    statusEl.textContent = text;
    chip.classList.remove('quiet');
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { chip.classList.add('quiet'); }, 5000);
  }

  function start(room) {
    state.room = room;
    var KEY = 'homie-net.' + boot.game + '.' + room + '.' + want;
    var token = null;
    try { token = sessionStorage.getItem(KEY); } catch (e) {}
    var q = new URLSearchParams({ room: room, device: device, want: want });
    if (token) q.set('k', token);
    if (params.get('name')) q.set('name', params.get('name'));
    if (params.get('debug') === '1') q.set('debug', '1');
    // The frame cannot read this page's address (it is an opaque origin): hand it the game's own switches.
    ['touchdebug', 'cam', 'view'].forEach(function (k) { var v = params.get(k); if (v && /^[A-Za-z0-9_-]{1,16}$/.test(v)) q.set(k, v); });
    frame.src = '/' + boot.game + '/__game/?' + q.toString();
    frame.addEventListener('load', function () { try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} });
    window.addEventListener('pointerdown', function () { try { frame.focus(); } catch (e) {} }, { passive: true });
    window.addEventListener('message', function (ev) {
      if (ev.source !== frame.contentWindow) return;
      var m = ev.data;
      if (!m || typeof m !== 'object' || m.t !== 'homie-net') return;
      if (m.what === 'attached') state.attached = true;
      if (m.what === 'token' && typeof m.token === 'string') { state.seat = m.seat; try { sessionStorage.setItem(KEY, m.token); } catch (e) {} }
      if (m.what === 'stats') state.stats = m.stats;
      if (m.what === 'round') onRound(m.round);
      if (m.what === 'roster') state.roster = m.slots;
      if (m.what === 'closed') state.closed = m.why;
      paint();
    });
    watch(room);
    if (screenMode && !document.querySelector('[data-join]')) {
      var h2 = document.createElement('h2'); h2.textContent = 'Join on your phone';
      var div = document.createElement('div'); div.textContent = location.origin + '/' + boot.game + '/play';
      screenCard.append(h2, div); screenCard.hidden = false;
    }
  }

  function onRound(r) {
    if (!r) return;
    state.round = r;
    if (r.phase === 'over' && Array.isArray(r.results)) {
      // One entry per finished round (a round is its number AND its end time: an emptied room starts again at 1).
      var key = r.n + ':' + r.endsAt;
      if (!state.results.some(function (x) { return x.key === key; })) state.results.push({ key: key, n: r.n, endsAt: r.endsAt, at: Date.now(), results: r.results });
      results.textContent = '';
      var h = document.createElement('h2'); h.textContent = 'Round ' + r.n;
      var ol = document.createElement('ol');
      r.results.slice(0, 6).forEach(function (row) {
        var li = document.createElement('li');
        li.textContent = row.name + (row.bot ? ' (bot)' : '') + ' — ' + row.score;
        ol.append(li);
      });
      results.append(h, ol); results.hidden = params.get('debug') !== '1'; // the game draws its own results; the card is for ?debug=1
    } else if (r.phase === 'live') results.hidden = true;
  }

  function watch(room) {
    var ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/' + boot.game + '/__watch?room=' + encodeURIComponent(room)); }
    catch (e) { setTimeout(function () { watch(room); }, 2000); return; }
    ws.onmessage = function (ev) {
      try { state.facts = JSON.parse(ev.data); } catch (e) { return; }
      if (state.facts && state.facts.round) onRound(state.facts.round);
      paint();
    };
    ws.onclose = function () { setTimeout(function () { watch(room); }, 1500); };
  }

  function paint() {
    var f = state.facts;
    var n = f && f.counts ? f.counts.players : null;
    var bits = [];
    if (n !== null) bits.push(n + (n === 1 ? ' player' : ' players') + ' here');
    if (f && f.counts && f.counts.bots) bits.push(f.counts.bots + ' bots');
    if (state.closed) bits.push(state.closed === 'replaced' ? 'opened in another tab' : 'reconnecting');
    say(bits.join(' · ') || 'joining…');
  }

  // A named room (?room=, a friend's link, a test, the big screen's QR) skips the lobby; everyone else meets strangers.
  var askedRoom = params.get('room');
  if (boot.room) start(boot.room);
  else if (askedRoom && /^[A-Za-z0-9_-]{1,32}$/.test(askedRoom)) start(askedRoom);
  else fetch('/' + boot.game + '/api/lobby', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) { start(j.room || 'main'); })
    .catch(function () { start('main'); });
}());`;
