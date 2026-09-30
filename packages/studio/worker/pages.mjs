/**
 * The play shell: the page around a game's sandboxed frame at /<game>/play and /<game>/tv. Every other page is
 * worker/site.mjs. Every name a player typed is escaped.
 */
import { esc, layout } from './site.mjs';

export { homePage, mediaIndexPage, notFoundPage, songPage, videoPage } from './site.mjs';

/** A room code: 1 to 32 letters, digits, - or _. */
export const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Who may put the play page (and so the game) inside a frame: this site, plus the https origins studio.json
 * `site.frameAncestors` names (for example a hub that embeds the game). Anything else is refused by the browser.
 */
export function frameAncestors(cat) {
  const extra = (Array.isArray(cat?.studio?.site?.frameAncestors) ? cat.studio.site.frameAncestors : [])
    .map((o) => { try { const u = new URL(String(o)); return u.protocol === 'https:' && u.origin === String(o).replace(/\/+$/, '') ? u.origin : null; } catch { return null; } })
    .filter(Boolean).slice(0, 8);
  return ["'self'", ...extra].join(' ');
}

/** What a play or big-screen page answers to a room code it cannot use: said on the page, never a silent public room. */
export function badRoomPage(cat, g, raw, { screen = false } = {}) {
  const shown = String(raw ?? '').slice(0, 64);
  return layout(cat, {
    title: `That room link does not work · ${g.name}`, page: 'bad-room', status: 400,
    main: `<header class="head"><p class="kicker">${esc(g.name)}</p><h1>That room link does not work</h1>
<p class="lead">The room code in this link${shown ? ` (<span class="addr">${esc(shown)}${String(raw).length > 64 ? '…' : ''}</span>)` : ''} is not one a room can have: a code is 1 to 32 letters, digits, hyphens or underscores. Ask whoever sent it for the link again, or play in a public room.</p>
<div class="keys"><a class="btn" href="/${esc(g.id)}/${screen ? 'tv' : 'play'}" data-play>Join a public room</a><a class="ghost" href="/${esc(g.id)}/">Back to ${esc(g.name)}</a></div></header>`,
  });
}

/**
 * The play shell. It asks the Lobby for a public room, boots the game frame at once (seated, no waiting), keeps
 * the seat token for a reload, writes the room into the address (so a reload or a copied address comes back to
 * it), and keeps the room's facts in `window.__shell` (what a test or a big screen reads). A small room button at
 * the edge (game.json `screen.share` picks the corner) opens Invite, Big screen and the room code; nothing covers
 * the middle of the screen or a thumb.
 */
export function playPage(cat, g, { screen = false, joinUrl = null, qr = null, room = null } = {}) {
  const accent = cat?.studio?.theme?.accent ?? '#ffcf5a';
  const corner = (name, fallback) => (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(g.screen?.[name]) ? g.screen[name] : fallback);
  // The phone's glass belongs to the game: no page pan, pinch-zoom, text selection or callout under a thumb
  // (a pinch between a stick thumb and a button thumb made the browser cancel both touches).
  const css = `:root{--hot:${/^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#ffcf5a'}}
html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; background: #04060c; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
iframe.game { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #04060c; touch-action: none; }
.chip { position: fixed; left: max(10px, env(safe-area-inset-left)); bottom: max(10px, env(safe-area-inset-bottom)); z-index: 5; padding: 6px 10px; border-radius: 999px; background: rgba(0,0,0,.55); color: #dfe6f5; font: 12px/1.2 ui-sans-serif, system-ui, sans-serif; pointer-events: none; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); transition: opacity .6s; }
.chip.quiet { opacity: 0; }
.card { position: fixed; right: 12px; bottom: 12px; z-index: 4; max-width: 300px; padding: 10px 12px; border-radius: 12px; background: rgba(8,12,22,.82); border: 1px solid rgba(255,255,255,.14); color: #e8ecf5; font: 13px/1.35 ui-sans-serif, system-ui, sans-serif; }
.card h2 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--hot); }
.card ol { margin: 0; padding-left: 18px; }
.join { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 6; display: flex; gap: 14px; align-items: center; padding: 12px 14px; border-radius: 16px; background: rgba(8,12,22,.78); border: 1px solid rgba(255,255,255,.14); color: #eef1f8; font: 600 clamp(14px, 1.6vmin, 22px)/1.3 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
.join.join-top-left { top: max(16px, env(safe-area-inset-top)); left: max(16px, env(safe-area-inset-left)); right: auto; bottom: auto; }
.join.join-top-right { top: max(16px, env(safe-area-inset-top)); bottom: auto; }
.join.join-bottom-left { left: max(16px, env(safe-area-inset-left)); right: auto; }
.join .qr { width: clamp(96px, 15vmin, 220px); height: clamp(96px, 15vmin, 220px); border-radius: 8px; overflow: hidden; }
.join .qr svg { width: 100%; height: 100%; display: block; }
.join b { display: block; color: var(--hot); font-size: 1.15em; margin-bottom: 4px; }
.join span { opacity: .85; word-break: break-all; }
.room { position: fixed; z-index: 7; display: flex; flex-direction: column; gap: 8px; font: 600 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eef1f8; }
.room.at-top-right { top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); align-items: flex-end; }
.room.at-top-left { top: max(8px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left)); align-items: flex-start; }
.room.at-bottom-right { bottom: max(8px, env(safe-area-inset-bottom)); right: max(8px, env(safe-area-inset-right)); align-items: flex-end; flex-direction: column-reverse; }
.room.at-bottom-left { bottom: max(8px, env(safe-area-inset-bottom)); left: max(8px, env(safe-area-inset-left)); align-items: flex-start; flex-direction: column-reverse; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px 0 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(6,9,16,.62); color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: opacity .5s; }
.pill svg { width: 15px; height: 15px; flex: none; }
.pill.dim { opacity: .38; width: 34px; padding: 0; justify-content: center; }
.pill.dim span { display: none; }
.pill:hover, .pill:focus-visible, .pill[aria-expanded="true"] { opacity: 1; width: auto; padding: 0 11px 0 9px; }
.pill:hover span, .pill:focus-visible span, .pill[aria-expanded="true"] span { display: inline; }
.sheet { box-sizing: border-box; width: min(300px, calc(100vw - 16px)); padding: 12px; border-radius: 16px; background: rgba(8,12,22,.94); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 18px 50px rgba(0,0,0,.5); -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.sheet .code { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 2px 2px 10px; }
.sheet .code b { font: 800 20px/1.1 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.01em; }
.sheet .code span { color: #aab3c7; font-weight: 500; font-size: 12px; }
.sheet .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sheet .acts > * { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 42px; padding: 0 10px; border-radius: 11px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.sheet .acts .primary { background: var(--hot); color: #0b0b10; border-color: transparent; font-weight: 800; }
.sheet .acts svg { width: 16px; height: 16px; flex: none; }
.sheet .link { display: block; margin: 10px 2px 2px; color: #aab3c7; font: 500 11.5px/1.35 ui-monospace, Menlo, monospace; word-break: break-all; }
.sheet .foot { display: flex; justify-content: space-between; margin-top: 10px; font-weight: 500; }
.sheet .foot a, .sheet .foot button { color: #aab3c7; background: none; border: 0; padding: 6px 2px; font: inherit; text-decoration: none; cursor: pointer; }
.sheet .foot a:hover, .sheet .foot button:hover { color: #fff; }
.toast { position: fixed; left: 50%; top: max(12px, env(safe-area-inset-top)); z-index: 8; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: rgba(8,12,22,.9); color: #fff; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
[hidden] { display: none !important; }`;
  const boot = { game: g.id, name: g.name, screen: Boolean(screen), ...(room ? { room } : {}) };
  // game.json "screen": { "join": "top-left" | "top-right" | "bottom-left" | "bottom-right" } keeps the card off the game's own HUD.
  const joinCorner = corner('join', 'bottom-right');
  const shareCorner = corner('share', 'top-right');
  const joinCard = screen && joinUrl ? `<div class="join join-${joinCorner}" data-join>${qr ? `<div class="qr">${qr}</div>` : ''}<div><b>Scan to play</b><span>${esc(joinUrl.replace(/^https?:\/\//, ''))}</span></div></div>` : '';
  const share = screen ? '' : `<div class="room at-${shareCorner}" data-room-ui>
  <button class="pill" type="button" data-share-toggle aria-expanded="false" aria-controls="share-sheet" aria-label="Room, invite and big screen"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg><span data-room-code>Room</span></button>
  <div class="sheet" id="share-sheet" role="dialog" aria-label="This room" data-share-sheet hidden>
    <div class="code"><b data-room-label>This room</b><span data-room-count></span></div>
    <div class="acts">
      <button type="button" class="primary" data-invite><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/></svg><span data-invite-word>Invite</span></button>
      <a data-bigscreen target="_blank" rel="noopener" href="/${esc(g.id)}/tv"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8"/></svg><span>Big screen</span></a>
    </div>
    <span class="link" data-room-link></span>
    <div class="foot"><a href="/${esc(g.id)}/">← ${esc(g.name)}</a><button type="button" data-copy-link>Copy link</button></div>
  </div>
</div>
<div class="toast" data-toast role="status" hidden></div>`;
  return layoutless(`${g.name} · play`, `
<iframe class="game" title="${esc(g.name)}" sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups" allow="fullscreen *; autoplay *; gamepad *"></iframe>
<div class="chip" data-chip><span data-status>finding a room…</span></div>
<div class="card" data-results hidden></div>
<div class="card" data-screen hidden></div>
${joinCard}${share}
<script>window.__HOMIE_PLAY=${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script>${SHELL_JS}</script>`, css, frameAncestors(cat));
}

/** The play page's own document (no site chrome: the game owns the whole screen). */
function layoutless(title, body, css, ancestors = "'self'") {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${esc(title)}</title><link rel="icon" href="data:,"><style>${css}</style></head>
<body>${body}</body></html>`, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Framed only by this site and the origins studio.json names (a browser that reads CSP ignores the older header).
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy': `frame-ancestors ${ancestors}`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
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
  var state = { game: boot.game, room: null, device: device, want: want, attached: false, stats: null, round: null, roster: null, facts: null, seat: null, results: [], closed: null, link: null };
  window.__shell = state;

  // The chip says who is here, then gets out of the game's way (games draw their own HUD at the top). It never takes a touch.
  var chip = document.querySelector('[data-chip]');
  var quietTimer = null;
  function say(text) {
    if (statusEl.textContent === text) return;
    statusEl.textContent = text;
    chip.classList.remove('quiet');
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { chip.classList.add('quiet'); }, 5000);
  }

  // This room, shared: the code, Invite (the phone's share sheet, or the link copied), Big screen (the TV view of this room).
  var ui = document.querySelector('[data-room-ui]');
  var toggle = ui && ui.querySelector('[data-share-toggle]');
  var sheet = ui && ui.querySelector('[data-share-sheet]');
  var toast = document.querySelector('[data-toast]');
  var dimTimer = null;
  function labelOf(room) { var m = /^pub-(\d+)$/.exec(room); return m ? 'Room ' + m[1] : room; }
  function flash(text) { if (!toast) return; toast.textContent = text; toast.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(function () { toast.hidden = true; }, 1800); }
  function wake() { if (!toggle) return; toggle.classList.remove('dim'); clearTimeout(dimTimer); dimTimer = setTimeout(function () { if (sheet.hidden) toggle.classList.add('dim'); }, 6000); }
  function open(on) { if (!sheet) return; sheet.hidden = !on; toggle.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) wake(); else { wake(); try { frame.focus(); } catch (e) {} } }
  function copy(text, done) {
    var ok = function () { flash(done || 'Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { flash(text); });
    else flash(text);
  }
  function shareReady(room) {
    if (!ui) return;
    var link = location.origin + '/' + boot.game + '/play?room=' + encodeURIComponent(room);
    state.link = link;
    ui.querySelector('[data-room-code]').textContent = labelOf(room);
    ui.querySelector('[data-room-label]').textContent = labelOf(room);
    ui.querySelector('[data-room-link]').textContent = link.replace(/^https?:\/\//, '');
    ui.querySelector('[data-bigscreen]').href = '/' + boot.game + '/tv?room=' + encodeURIComponent(room);
    toggle.addEventListener('click', function (e) { e.stopPropagation(); open(sheet.hidden); });
    ui.querySelector('[data-invite]').addEventListener('click', function () {
      var data = { title: boot.name, text: 'Play ' + boot.name + ' with me: join my room.', url: link };
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) navigator.share(data).catch(function () {});
      else copy(link, 'Invite link copied');
    });
    ui.querySelector('[data-copy-link]').addEventListener('click', function () { copy(link); });
    document.addEventListener('pointerdown', function (e) { if (!sheet.hidden && !ui.contains(e.target)) open(false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) open(false); });
    wake();
  }

  function start(room) {
    state.room = room;
    // The room goes into the address: a reload comes back to it, and a copied address brings a friend into it.
    try {
      if (params.get('room') !== room) {
        params.set('room', room);
        history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
      }
    } catch (e) {}
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
    window.addEventListener('pointerdown', function (e) { if (ui && ui.contains(e.target)) return; try { frame.focus(); } catch (e2) {} }, { passive: true });
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
    shareReady(room);
    if (screenMode && !document.querySelector('[data-join]')) {
      var h2 = document.createElement('h2'); h2.textContent = 'Join on your phone';
      var div = document.createElement('div'); div.textContent = location.origin + '/' + boot.game + '/play?room=' + encodeURIComponent(room);
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
    var count = ui && ui.querySelector('[data-room-count]');
    if (count && n !== null) count.textContent = n + (n === 1 ? ' player here' : ' players here');
  }

  // A named room (?room=, a friend's link, a test, the big screen's QR) skips the lobby; everyone else meets strangers.
  // The page refuses a code it cannot use before it gets here, so an asked room is never swapped for a public one.
  var askedRoom = params.get('room');
  if (boot.room) start(boot.room);
  else if (askedRoom !== null && /^[A-Za-z0-9_-]{1,32}$/.test(askedRoom)) start(askedRoom);
  else if (askedRoom !== null) { say('that room link does not work'); }
  else fetch('/' + boot.game + '/api/lobby', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) { start(j.room || 'main'); })
    .catch(function () { start('main'); });
}());`;
