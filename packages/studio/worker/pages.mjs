/**
 * The play shell: the page around a game's sandboxed frame at /<game>/play and /<game>/tv. Every other page is
 * worker/site.mjs. Every name a player typed is escaped.
 */
import { esc, layout } from './site.mjs';
import { SAVES_SHELL_CSS, SAVES_SHELL_JS } from './saves-shell.mjs';

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

/** Where the room button may sit: a corner, or the middle of the top edge. */
export const SHARE_PLACES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * Where the room button sits on each device, from game.json `screen.share`, so it never covers the game's own
 * HUD (a scoreboard in the top right, a fuel bar across a phone's top):
 *
 *   "share": "top-left"                                     every device (a place from SHARE_PLACES)
 *   "share": { "at": "top-right", "y": 64 }                 moved 64 px in from its edge (x: from its side)
 *   "share": { "desk": "bottom-left", "phone": { "at": "top-left", "y": 56 }, "sideways": "top-center" }
 *   "share": { "at": "top-right", "label": false }          the button stays a small round icon (the room code is
 *                                                           in its sheet), for a corner with little room
 *
 * `desk` is a computer, `phone` a phone held upright, `sideways` a phone turned sideways (else as `phone`). For a
 * corner, `x` and `y` move the button in from its side and its edge (0 to 600 px); for top-center, `x` moves it
 * right (or left, negative) and `y` down. Anything else is the default: the top right, as before.
 */
export function sharePlaces(value) {
  const one = (v) => {
    const o = typeof v === 'string' ? { at: v } : v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    if (!o || !SHARE_PLACES.includes(o.at)) return null;
    const num = (n, lo, hi) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Math.round(Number(n)))) : 0);
    return { at: o.at, x: num(o.x, o.at === 'top-center' ? -600 : 0, 600), y: num(o.y, 0, 600), label: o.label !== false };
  };
  // A place for every device (a string, or an object with `at`), then any device's own over it.
  const all = one(value) ?? { at: 'top-right', x: 0, y: 0, label: true };
  const per = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const desk = one(per.desk) ?? all;
  const phone = one(per.phone) ?? all;
  return { desk, phone, sideways: one(per.sideways) ?? phone };
}

/**
 * The play shell. It asks the Lobby for a public room, boots the game frame at once (seated, no waiting), keeps
 * the seat token for a reload, writes the room into the address (so a reload or a copied address comes back to
 * it), and keeps the room's facts in `window.__shell` (what a test or a big screen reads). A small room button at
 * the edge (game.json `screen.share`, per device: sharePlaces) opens Invite, Big screen and the room code; nothing
 * covers the middle of the screen or a thumb.
 */
export function playPage(cat, g, { screen = false, joinUrl = null, qr = null, room = null, ticket = null, owner = false, launch = 'public' } = {}) {
  const accent = cat?.studio?.theme?.accent ?? '#ffcf5a';
  const corner = (name, fallback) => (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(g.screen?.[name]) ? g.screen[name] : fallback);
  const places = sharePlaces(g.screen?.share);
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
.room { --dx: 0px; --dy: 0px; position: fixed; z-index: 7; display: flex; flex-direction: column; gap: 8px; font: 600 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eef1f8; }
.room.at-top-right { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); right: calc(max(8px, env(safe-area-inset-right)) + var(--dx)); align-items: flex-end; }
.room.at-top-left { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); left: calc(max(8px, env(safe-area-inset-left)) + var(--dx)); align-items: flex-start; }
.room.at-top-center { top: calc(max(8px, env(safe-area-inset-top)) + var(--dy)); left: calc(50% + var(--dx)); transform: translateX(-50%); align-items: center; }
.room.at-bottom-right { bottom: calc(max(8px, env(safe-area-inset-bottom)) + var(--dy)); right: calc(max(8px, env(safe-area-inset-right)) + var(--dx)); align-items: flex-end; flex-direction: column-reverse; }
.room.at-bottom-left { bottom: calc(max(8px, env(safe-area-inset-bottom)) + var(--dy)); left: calc(max(8px, env(safe-area-inset-left)) + var(--dx)); align-items: flex-start; flex-direction: column-reverse; }
.chip.chip-right { left: auto; right: max(10px, env(safe-area-inset-right)); }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px 0 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(6,9,16,.62); color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: opacity .5s; }
.pill svg { width: 15px; height: 15px; flex: none; }
.pill.dim { opacity: .38; width: 34px; padding: 0; justify-content: center; }
.pill.dim span { display: none; }
.pill:hover, .pill:focus-visible, .pill[aria-expanded="true"] { opacity: 1; width: auto; padding: 0 11px 0 9px; }
.pill:hover span, .pill:focus-visible span, .pill[aria-expanded="true"] span { display: inline; }
/* game.json screen.share "label": false: always the small round icon, even while it is open (the code is in the sheet). */
.pill.icon, .pill.icon:hover, .pill.icon:focus-visible, .pill.icon[aria-expanded="true"] { width: 34px; padding: 0; justify-content: center; }
.pill.icon span, .pill.icon:hover span, .pill.icon:focus-visible span, .pill.icon[aria-expanded="true"] span { display: none; }
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
/* The studio's announcement (section 15): a line across the top, small, never over the middle; it goes by itself. */
.banner { box-sizing: border-box; position: fixed; left: 50%; top: calc(max(8px, env(safe-area-inset-top)) + 44px); z-index: 9; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(560px, calc(100vw - 24px)); padding: 9px 8px 9px 14px; border-radius: 14px; background: rgba(8,12,22,.9); border: 1px solid var(--hot); color: #fff; font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); touch-action: manipulation; animation: drop .35s ease-out; }
.banner b { color: var(--hot); font-weight: 800; white-space: nowrap; }
.banner span { overflow-wrap: anywhere; }
.banner button { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(255,255,255,.08); color: #fff; font: 600 16px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
@keyframes drop { from { opacity: 0; transform: translate(-50%, -8px); } }
/* A kick or a closed room: the game stops, and the page says so plainly. */
.notice { box-sizing: border-box; position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(4,6,12,.86); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: #eef1f8; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.notice .box { box-sizing: border-box; width: min(420px, 100%); padding: 22px; border-radius: 20px; background: #0d111c; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.55); }
.notice h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: -.01em; }
.notice p { margin: 0 0 10px; color: #c3cad9; }
.notice .when { color: var(--hot); font-weight: 700; }
.notice .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.notice .acts a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 12px; text-decoration: none; font-weight: 700; color: #eef1f8; border: 1px solid rgba(255,255,255,.18); }
.notice .acts a.primary { background: var(--hot); color: #0b0b10; border-color: transparent; }
[hidden] { display: none !important; }${g.saves && !screen ? SAVES_SHELL_CSS : ''}`;
  // The room button's place on each device (sharePlaces); the shell moves it to this browser's once it knows the device.
  // A ticket (a game that is not public) and the owner's overlay ride along only for the browser they are for.
  const boot = { game: g.id, name: g.name, screen: Boolean(screen), share: places, ...(room ? { room } : {}), ...(ticket ? { t: ticket } : {}), ...(owner ? { owner: true, launch } : {}) };
  // game.json "screen": { "join": "top-left" | "top-right" | "bottom-left" | "bottom-right" } keeps the card off the game's own HUD.
  const joinCorner = corner('join', 'bottom-right');
  const first = places.desk;
  const joinCard = screen && joinUrl ? `<div class="join join-${joinCorner}" data-join>${qr ? `<div class="qr">${qr}</div>` : ''}<div><b>Scan to play</b><span>${esc(joinUrl.replace(/^https?:\/\//, ''))}</span></div></div>` : '';
  const share = screen ? '' : `<div class="room at-${first.at}" style="--dx:${first.x}px;--dy:${first.y}px" data-room-ui>
  <button class="pill${first.label ? '' : ' icon'}" type="button" data-share-toggle aria-expanded="false" aria-controls="share-sheet" aria-label="Room, invite and big screen"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg><span data-room-code>Room</span></button>
  <div class="sheet" id="share-sheet" role="dialog" aria-label="This room" data-share-sheet hidden>
    <div class="code"><b data-room-label>This room</b><span data-room-count></span></div>
    <div class="acts">
      <button type="button" class="primary" data-invite><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/></svg><span data-invite-word>Invite</span></button>
      <a data-bigscreen target="_blank" rel="noopener" href="/${esc(g.id)}/tv"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8"/></svg><span>Big screen</span></a>
    </div>
    <span class="link" data-room-link></span>
    <div class="foot"><a href="/${esc(g.id)}/">← ${esc(g.name)}</a><button type="button" data-copy-link>Copy link</button></div>${g.saves ? `
    <div class="who-row" data-who hidden><span data-who-name></span><button type="button" data-who-act></button></div>` : ''}
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
<script>${SHELL_JS}</script>${g.saves && !screen ? `
<script>${SAVES_SHELL_JS}</script>` : ''}${owner ? `<style>${OWNER_CSS}</style><script>${OWNER_JS}</script>` : ''}`, css, frameAncestors(cat));
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
  var state = { game: boot.game, room: null, device: device, want: want, attached: false, stats: null, round: null, roster: null, facts: null, seat: null, results: [], closed: null, link: null, notice: null, banner: null, muted: null };
  window.__shell = state;
  // This browser's room key: random, kept in this site's own storage, and sent only to this site's rooms. It is what
  // an owner's kick holds out of a room for a while (section 15); it says nothing about who the player is.
  function rnd() {
    try { var a = new Uint8Array(16); crypto.getRandomValues(a); var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { var r = ''; while (r.length < 22) r += Math.random().toString(36).slice(2); return r.slice(0, 22); }
  }
  var roomKey = null;
  try { roomKey = localStorage.getItem('homie-b'); if (!/^[A-Za-z0-9_-]{16,43}$/.test(roomKey || '')) { roomKey = rnd(); localStorage.setItem('homie-b', roomKey); } } catch (e) { roomKey = rnd(); }

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
  // Where the button sits on THIS device (game.json screen.share, per computer, phone and phone turned sideways: a
  // corner or the top's middle, moved in by x / y), so it never sits on the game's own scoreboard or fuel bar.
  function place() {
    if (!ui || !boot.share) return;
    var key = device === 'phone' ? (innerWidth > innerHeight ? 'sideways' : 'phone') : 'desk';
    var p = boot.share[key] || boot.share.desk;
    if (!p) return;
    ui.className = 'room at-' + p.at;
    ui.style.setProperty('--dx', (p.x || 0) + 'px');
    ui.style.setProperty('--dy', (p.y || 0) + 'px');
    if (toggle) { if (p.label === false) toggle.classList.add('icon'); else toggle.classList.remove('icon'); }
    // The status chip lives at the bottom left: a button there sends it to the bottom right.
    if (p.at === 'bottom-left') chip.classList.add('chip-right'); else chip.classList.remove('chip-right');
    state.share = { device: key, at: p.at, x: p.x || 0, y: p.y || 0, label: p.label !== false };
  }
  place();
  addEventListener('resize', place);
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
        params.delete('not');
        history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
      }
    } catch (e) {}
    var KEY = 'homie-net.' + boot.game + '.' + room + '.' + want;
    var token = null;
    try { token = sessionStorage.getItem(KEY); } catch (e) {}
    var q = new URLSearchParams({ room: room, device: device, want: want });
    if (token) q.set('k', token);
    q.set('b', roomKey);
    if (boot.t) q.set('t', boot.t);
    if (params.get('name')) q.set('name', params.get('name'));
    else {
      // A player with an account (or a named guest) on this studio plays under their own name in every room.
      try { var who = JSON.parse(localStorage.getItem('homie.player') || 'null'); if (who && typeof who.name === 'string' && who.name) q.set('name', who.name.slice(0, 24)); } catch (e) {}
    }
    if (params.get('debug') === '1') q.set('debug', '1');
    // The frame cannot read this page's address (it is an opaque origin): hand it the game's own switches.
    ['touchdebug', 'cam', 'view'].forEach(function (k) { var v = params.get(k); if (v && /^[A-Za-z0-9_-]{1,16}$/.test(v)) q.set(k, v); });
    frame.src = '/' + boot.game + '/__game/?' + q.toString();
    frame.addEventListener('load', function () { try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} });
    window.addEventListener('pointerdown', function (e) { if ((ui && ui.contains(e.target)) || (e.target.closest && e.target.closest('[data-keep-focus]'))) return; try { frame.focus(); } catch (e2) {} }, { passive: true });
    window.addEventListener('message', function (ev) {
      if (ev.source !== frame.contentWindow) return;
      var m = ev.data;
      if (!m || typeof m !== 'object' || m.t !== 'homie-net') return;
      if (m.what === 'attached') state.attached = true;
      if (m.what === 'token' && typeof m.token === 'string') { state.seat = m.seat; try { sessionStorage.setItem(KEY, m.token); } catch (e) {} }
      if (m.what === 'stats') state.stats = m.stats;
      if (m.what === 'round') onRound(m.round);
      if (m.what === 'roster') state.roster = m.slots;
      if (m.what === 'closed') { state.closed = m.why; if (m.why === 'kicked' || m.why === 'room-closed') notice(m.why === 'kicked' ? 'kicked' : 'closed', m); }
      // A game's net.pickPlayer(seat): only an owner's page listens (its overlay opens that player's card).
      if (m.what === 'pick' && (m.seat === null || typeof m.seat === 'number')) { try { window.dispatchEvent(new CustomEvent('homie-pick', { detail: { seat: m.seat } })); } catch (e) {} }
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
    if (state.notice) return;
    var ws;
    var extra = '&b=' + encodeURIComponent(roomKey) + (boot.t ? '&t=' + encodeURIComponent(boot.t) : '');
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/' + boot.game + '/__watch?room=' + encodeURIComponent(room) + extra); }
    catch (e) { setTimeout(function () { watch(room); }, 2000); return; }
    state.watchSocket = ws;
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'kicked') { notice('kicked', m); return; }
      if (m.t === 'closed') { notice('closed', m); return; }
      if (m.t === 'announce') { banner(m); return; }
      if (m.t === 'muted') { mutedNote(m); return; }
      if (m.t !== 'net') return;
      state.facts = m;
      if (m.announce && m.announce.text) banner(m.announce, true);
      if (state.facts && state.facts.round) onRound(state.facts.round);
      paint();
    };
    ws.onclose = function () { if (!state.notice) setTimeout(function () { watch(room); }, 1500); };
  }

  // The studio's announcement: one line across the top until it ends (its own clock) or the player closes it.
  var shownBanners = {};
  function banner(a, quiet) {
    if (!a || typeof a !== 'object') return;
    var old = document.querySelector('[data-banner]');
    if (!a.text) { if (old && (!a.id || old.getAttribute('data-banner') === a.id)) { old.remove(); state.banner = null; } return; }
    if (quiet && shownBanners[a.id]) return;
    shownBanners[a.id] = true;
    var left = Math.max(3000, Math.min(3600000, (Number(a.until) || 0) - (Number(a.at) || 0) || 30000));
    if (state.facts && state.facts.st && a.until) left = Math.max(1000, Math.min(left, a.until - state.facts.st));
    if (old) old.remove();
    var el = document.createElement('div'); el.className = 'banner'; el.setAttribute('role', 'status'); el.setAttribute('data-banner', String(a.id || '')); el.setAttribute('data-keep-focus', '');
    var b = document.createElement('b'); b.textContent = 'Studio';
    var span = document.createElement('span'); span.textContent = String(a.text).slice(0, 280);
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.onclick = function () { el.remove(); state.banner = null; };
    el.append(b, span, x);
    document.body.appendChild(el);
    state.banner = { id: a.id, text: String(a.text) };
    setTimeout(function () { if (el.parentNode) { el.remove(); if (state.banner && state.banner.id === a.id) state.banner = null; } }, left);
  }

  function mutedNote(m) {
    var mins = m.until ? Math.max(1, Math.round((m.until - (state.facts && state.facts.st ? state.facts.st : Date.now())) / 60000)) : 0;
    state.muted = m.until ? { until: m.until } : null;
    flash(m.until ? 'The studio muted you for ' + mins + ' min: your chat and emotes reach nobody.' : 'The studio unmuted you.');
  }

  // A kick or a closed room ends play here: the game frame stops (an older game would otherwise knock again and
  // again), and the page says what happened, when they can come back, and where to play now.
  function notice(kind, m) {
    if (state.notice) return;
    state.notice = { kind: kind, until: m && m.until ? m.until : null, message: m && m.message ? String(m.message) : '' };
    try { frame.src = 'about:blank'; } catch (e) {}
    if (state.watchSocket) { try { state.watchSocket.close(); } catch (e) {} }
    if (ui) ui.hidden = true;
    var old = document.querySelector('[data-banner]'); if (old) old.remove();
    var nowAt = state.facts && state.facts.st ? state.facts.st : Date.now();
    var mins = state.notice.until ? Math.max(1, Math.ceil((state.notice.until - nowAt) / 60000)) : 0;
    var label = labelOf(state.room || '');
    var box = document.createElement('div'); box.className = 'notice'; box.setAttribute('data-notice', kind); box.setAttribute('role', 'alertdialog'); box.setAttribute('data-keep-focus', '');
    var inner = document.createElement('div'); inner.className = 'box';
    var h = document.createElement('h1'); h.textContent = kind === 'kicked' ? 'You were removed from this room' : 'This room is closed';
    var p = document.createElement('p'); p.textContent = state.notice.message || (kind === 'kicked' ? 'The studio removed you from this room.' : 'The studio closed this room. Thanks for playing!');
    var w = document.createElement('p'); w.className = 'when';
    w.textContent = mins ? (kind === 'kicked' ? 'You can come back to ' + label + ' in ' + mins + ' min.' : label + ' opens again in ' + mins + ' min.') : '';
    var acts = document.createElement('div'); acts.className = 'acts';
    var other = document.createElement('a'); other.className = 'primary'; other.href = '/' + boot.game + '/play?not=' + encodeURIComponent(state.room || ''); other.textContent = 'Play in another room';
    var back = document.createElement('a'); back.href = '/' + boot.game + '/'; back.textContent = 'Back to ' + boot.name;
    acts.append(other, back);
    inner.append(h, p, w, acts); box.appendChild(inner);
    document.body.appendChild(box);
    say(kind === 'kicked' ? 'removed from this room' : 'room closed');
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
  else fetch('/' + boot.game + '/api/lobby' + (/^[A-Za-z0-9_,-]{1,140}$/.test(params.get('not') || '') ? '?not=' + encodeURIComponent(params.get('not')) : ''), { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) { start(j.room || 'main'); })
    .catch(function () { start('main'); });
}());`;

/*
 * THE OWNER IN THEIR OWN GAME (0.13.0). Only a page served to the studio's signed-in owner carries this (the
 * Worker checks the owner's session before it adds it; nobody else's page has a byte of it): a small Owner button
 * in a corner the room button does not use, and a sheet with everyone in this room. A tap on a player shows who they
 * are, with Mute and Kick; Announce reaches this room or every room of the game. The controls go to the studio's
 * own /_studio/api with the owner's session (an HttpOnly cookie; the game's sandboxed frame can neither read it nor
 * send it). A game can open a player's card itself: `net.pickPlayer(seat)` (a click on that player's body).
 */
const OWNER_CSS = `.owner { position: fixed; z-index: 10; top: max(8px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left)); font: 600 13px/1.25 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eef1f8; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.owner.at-right { align-items: flex-end; }
.owner.up { flex-direction: column-reverse; }
.owner .opill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 9px; border-radius: 999px; border: 1px solid #c9b8ff; background: rgba(12,8,24,.7); color: #e6dcff; font: inherit; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); touch-action: manipulation; }
.owner .opill i { width: 8px; height: 8px; border-radius: 50%; background: #c9b8ff; }
.osheet { box-sizing: border-box; width: min(340px, calc(100vw - 16px)); max-height: min(560px, calc(100vh - 70px)); overflow: auto; padding: 12px; border-radius: 16px; background: rgba(10,8,20,.96); border: 1px solid rgba(201,184,255,.35); box-shadow: 0 18px 50px rgba(0,0,0,.55); -webkit-user-select: text; user-select: text; touch-action: manipulation; }
.osheet h2 { margin: 2px 2px 8px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #c9b8ff; display: flex; justify-content: space-between; gap: 8px; }
.osheet h2 a { color: #aab3c7; text-transform: none; letter-spacing: 0; font-weight: 600; text-decoration: none; }
.osheet .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 8px 10px; margin: 0 0 6px; border-radius: 11px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.osheet .row:hover { border-color: rgba(201,184,255,.5); }
.osheet .row small { color: #9aa3b7; font-weight: 500; }
.osheet .tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2); color: #aab3c7; margin-left: 6px; }
.osheet .tag.you { color: #c9b8ff; border-color: #c9b8ff; }
.osheet .tag.muted { color: #ff8a9a; border-color: rgba(255,107,125,.6); }
.osheet .bot { color: #6c7489; font-weight: 500; padding: 2px 10px 8px; }
.osheet .det { padding: 4px 2px; }
.osheet .det b { font-size: 18px; display: block; margin-bottom: 4px; overflow-wrap: anywhere; }
.osheet .det p { margin: 0 0 4px; color: #aab3c7; font-weight: 500; }
.osheet .acts { display: flex; gap: 8px; margin: 12px 0 4px; flex-wrap: wrap; }
.osheet .acts button, .osheet form button { min-height: 40px; padding: 0 14px; border-radius: 11px; font: inherit; font-weight: 800; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; }
.osheet .acts .kick { color: #ff8a9a; border-color: rgba(255,107,125,.55); }
.osheet .acts .kick.armed { background: #ff6b7d; color: #16080a; }
.osheet .acts .mute { color: #ffc27a; border-color: rgba(255,179,92,.55); }
.osheet .back { background: none; border: 0; color: #aab3c7; font: inherit; padding: 4px 0; cursor: pointer; }
.osheet form { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.10); display: grid; gap: 8px; }
.osheet textarea, .osheet select { box-sizing: border-box; width: 100%; font: 500 14px/1.35 ui-sans-serif, system-ui, sans-serif; color: inherit; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 8px 10px; }
.osheet textarea { min-height: 58px; resize: vertical; }
.osheet form button { background: #c9b8ff; color: #120a24; border-color: transparent; }
.osheet .msg { color: #aab3c7; font-weight: 500; min-height: 1.2em; margin: 6px 2px 0; }`;

const OWNER_JS = String.raw`(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY; var state = window.__shell;
  if (!boot || !boot.owner || !state || boot.screen) return;
  var HOLD = 10;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  // Beside the room button, on its inner side: the game already keeps that edge clear of its own HUD
  // (game.json screen.share), so the owner's button never sits on a scoreboard or a stick.
  var root = el('div', 'owner'); root.setAttribute('data-owner', ''); root.setAttribute('data-keep-focus', '');
  var pill = el('button', 'opill'); pill.type = 'button'; pill.setAttribute('aria-expanded', 'false'); pill.appendChild(el('i')); pill.appendChild(el('span', '', 'Owner'));
  var sheet = el('div', 'osheet'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Owner');
  root.append(pill, sheet); document.body.appendChild(root);
  var toggleEl = document.querySelector('[data-share-toggle]');
  function placeOwner() {
    var r = toggleEl ? toggleEl.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    var right = r.left + r.width / 2 > innerWidth / 2;
    var low = r.top > innerHeight / 2;
    root.classList.toggle('at-right', right); root.classList.toggle('up', low);
    root.style.top = low ? '' : Math.round(r.top) + 'px';
    root.style.bottom = low ? Math.round(innerHeight - r.bottom) + 'px' : '';
    root.style.left = right ? '' : Math.round(r.right + 8) + 'px';
    root.style.right = right ? Math.round(innerWidth - r.left + 8) + 'px' : '';
  }
  placeOwner();
  addEventListener('resize', placeOwner);
  try { new ResizeObserver(placeOwner).observe(toggleEl); } catch (e) { setInterval(placeOwner, 500); }
  var view = { pick: null, msg: '', armed: null, armedAt: 0 };
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'HTTP ' + r.status }; }); })
      .catch(function () { return { ok: false, message: 'The studio did not answer.' }; });
  }
  function clients() { var f = state.facts; return (f && Array.isArray(f.clients) ? f.clients : []).filter(function (c) { return c.seat !== null || c.waiting; }); }
  function bots() { var f = state.facts; return (f && Array.isArray(f.roster) ? f.roster : []).filter(function (s) { return s && s.bot; }); }
  function mins(ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'under a minute' : m + ' min'; }
  var drawn = '';
  function render(force) {
    if (sheet.hidden) return;
    var active = document.activeElement; if (active && sheet.contains(active) && /TEXTAREA|SELECT/.test(active.tagName)) return;
    // Redraw only when something it shows changed (a button under a finger is never swapped mid-tap).
    var armedOn = view.armed !== null && Date.now() - view.armedAt < 4000 ? view.armed : null;
    var sig = JSON.stringify([state.room, state.seat, view.pick, view.msg, armedOn, clients().map(function (c) { return [c.id, c.name, c.seat, c.muted, c.role, c.device]; }), bots().map(function (b) { return b.name; })]);
    if (!force && sig === drawn) return;
    drawn = sig;
    sheet.textContent = '';
    var h = el('h2'); h.appendChild(el('span', '', 'Owner · ' + (state.room ? (/^pub-(\d+)$/.test(state.room) ? 'Room ' + state.room.slice(4) : state.room) : 'this room')));
    var office = el('a', '', 'Office ↗'); office.href = '/_studio/office'; office.target = '_blank'; office.rel = 'noopener'; h.appendChild(office);
    sheet.appendChild(h);
    var list = clients();
    var picked = view.pick === null ? null : list.filter(function (c) { return c.id === view.pick || (typeof view.pick === 'number' && c.seat === view.pick); })[0];
    if (picked) {
      var me = picked.seat !== null && picked.seat === state.seat;
      var back = el('button', 'back', '← Everyone here'); back.type = 'button'; back.onclick = function () { view.pick = null; view.msg = ''; render(); };
      var det = el('div', 'det');
      det.appendChild(el('b', '', picked.name || 'Someone'));
      det.appendChild(el('p', '', (picked.seat !== null ? 'Seat ' + (picked.seat + 1) : 'Watching') + ' · ' + (picked.device === 'phone' ? 'on a phone' : picked.device === 'tv' ? 'a big screen' : 'on a computer') + (picked.role === 'host' ? ' · hosting the room' : '')));
      if (me) det.appendChild(el('p', '', 'This is you.'));
      if (picked.muted) det.appendChild(el('p', '', 'Muted: their chat and emotes reach nobody.'));
      sheet.append(back, det);
      if (!me) {
        var acts = el('div', 'acts');
        var mute = el('button', 'mute', picked.muted ? 'Unmute' : 'Mute ' + HOLD + ' min'); mute.type = 'button';
        mute.onclick = function () { mute.disabled = true; post('/_studio/api/mute', { game: boot.game, room: state.room, id: picked.id, minutes: HOLD, off: Boolean(picked.muted) }).then(function (r) { view.msg = r.ok ? (picked.muted ? 'Unmuted.' : 'Muted for ' + HOLD + ' min.') : (r.message || 'That did not work.'); render(); }); };
        // A kick takes a second tap within 4 s (the sheet redraws meanwhile, so the arming is remembered here).
        var armedNow = view.armed === picked.id && Date.now() - view.armedAt < 4000;
        var kick = el('button', 'kick' + (armedNow ? ' armed' : ''), armedNow ? 'Sure? Kick' : 'Kick ' + HOLD + ' min'); kick.type = 'button';
        kick.onclick = function () {
          if (!(view.armed === picked.id && Date.now() - view.armedAt < 4000)) { view.armed = picked.id; view.armedAt = Date.now(); render(); setTimeout(render, 4050); return; }
          view.armed = null;
          kick.disabled = true;
          post('/_studio/api/kick', { game: boot.game, room: state.room, id: picked.id, minutes: HOLD }).then(function (r) { view.msg = r.ok ? (picked.name || 'They') + ' was removed for ' + HOLD + ' min.' : (r.message || 'That did not work.'); if (r.ok) view.pick = null; render(); });
        };
        acts.append(mute, kick); sheet.appendChild(acts);
      }
    } else {
      if (!list.length) sheet.appendChild(el('p', 'msg', 'Nobody else is here yet.'));
      list.forEach(function (c) {
        var row = el('button', 'row'); row.type = 'button';
        var left = el('span'); left.appendChild(el('span', '', c.name || 'Someone'));
        if (c.seat !== null && c.seat === state.seat) left.appendChild(el('span', 'tag you', 'you'));
        if (c.muted) left.appendChild(el('span', 'tag muted', 'muted'));
        if (c.role === 'host') left.appendChild(el('span', 'tag', 'host'));
        row.append(left, el('small', '', c.seat !== null ? 'seat ' + (c.seat + 1) + ' · ' + (c.device === 'phone' ? 'phone' : c.device === 'tv' ? 'screen' : 'computer') : 'waiting'));
        row.onclick = function () { view.pick = c.id; view.msg = ''; render(); };
        sheet.appendChild(row);
      });
      var b = bots(); if (b.length) sheet.appendChild(el('div', 'bot', 'Bots: ' + b.map(function (s) { return s.name; }).join(', ')));
    }
    var form = el('form'); form.setAttribute('data-announce', '');
    var ta = el('textarea'); ta.maxLength = 280; ta.placeholder = 'Announce something to the players'; ta.setAttribute('aria-label', 'Announcement');
    var scope = el('select'); var o1 = el('option', '', 'This room'); o1.value = 'room'; var o2 = el('option', '', 'Every room of ' + boot.name); o2.value = 'game'; scope.append(o1, o2);
    var send = el('button', '', 'Announce'); send.type = 'submit';
    form.append(ta, scope, send);
    form.onsubmit = function (e) {
      e.preventDefault(); if (!ta.value.trim()) return; send.disabled = true;
      post('/_studio/api/announce', scope.value === 'room' ? { game: boot.game, room: state.room, text: ta.value } : { game: boot.game, text: ta.value }).then(function (r) {
        view.msg = r.ok ? 'Announced to ' + (r.people || 0) + (r.people === 1 ? ' person' : ' people') + '.' : (r.message || 'That did not work.');
        if (r.ok) ta.value = ''; send.disabled = false; ta.blur(); render();
      });
    };
    sheet.appendChild(form);
    sheet.appendChild(el('p', 'msg', view.msg));
  }
  function open(on) { sheet.hidden = !on; pill.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) render(true); }
  pill.onclick = function (e) { e.stopPropagation(); open(sheet.hidden); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) open(false); });
  // A game that knows its players' bodies opens one's card (net.pickPlayer(seat), posted by its frame).
  window.addEventListener('homie-pick', function (e) { var seat = e.detail && e.detail.seat; if (seat === null || typeof seat === 'number') { view.pick = seat; view.msg = ''; open(true); } });
  window.__ownerPick = function (seat) { view.pick = seat; view.msg = ''; open(true); };
  setInterval(render, 1500);
  window.__owner = { open: open, render: render };
}());`;
