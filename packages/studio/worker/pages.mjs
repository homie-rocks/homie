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
h2.section { margin: 44px 0 0; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
h2.section a { text-decoration: none; }
.card .kind { color: var(--accent); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; background: #000; display: block; }
.thumb.square { aspect-ratio: 1; }
.player { margin: 8px 0 20px; }
.player audio { width: 100%; }
.player video { width: 100%; max-height: 78vh; border-radius: 14px; background: #000; display: block; }
.player video.vertical { max-width: 420px; margin: 0 auto; }
.facts { color: var(--dim); font-size: 14px; display: flex; gap: 16px; flex-wrap: wrap; margin: 0 0 18px; }
.rights { color: var(--dim); font-size: 13px; border-top: 1px solid var(--line); padding-top: 14px; margin-top: 24px; max-width: 70ch; }
.lyrics { white-space: pre-wrap; font-size: 17px; line-height: 1.6; max-width: 60ch; }
.files { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; max-width: 560px; }
.files a { display: flex; justify-content: space-between; gap: 12px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; text-decoration: none; }
.files span { color: var(--dim); font-size: 13px; }
.cover { width: min(320px, 100%); aspect-ratio: 1; object-fit: cover; border-radius: 16px; float: right; margin: 0 0 16px 24px; }
@media (max-width: 540px) { .wrap { padding: 20px 16px 48px; } .btn { width: 100%; } .cover { float: none; margin: 0 0 16px; width: 100%; } }
`;

function page(title, body, { extraHead = '', viewport = 'width=device-width, initial-scale=1, viewport-fit=cover' } = {}) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="${viewport}">
<title>${esc(title)}</title><link rel="icon" href="data:,"><style>${BASE_CSS}</style>${extraHead}</head>
<body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const fileOf = (e, role) => (e.files ?? []).find((f) => f.role === role) ?? null;
const KIND_WORD = { song: 'Song', score: 'Score', loop: 'Loop', stem: 'Stem', sfx: 'Sound', trailer: 'Trailer', 'music-video': 'Music video', cutscene: 'Cutscene', clip: 'Clip' };

function songCard(e) {
  const cover = fileOf(e, 'cover');
  return `
    <article class="card">
      ${cover ? `<img class="thumb square" src="${esc(cover.url)}" alt="" loading="lazy">` : ''}
      <span class="kind">${esc(KIND_WORD[e.kind] ?? 'Music')}${e.duration ? ` · ${esc(fmtTime(e.duration))}` : ''}</span>
      <h2>${esc(e.title)}</h2>
      <p>${esc(e.blurb)}</p>
      <div class="row"><a class="btn" href="/music/${esc(e.slug)}/">Listen</a></div>
    </article>`;
}

function videoCard(e) {
  const poster = fileOf(e, 'poster');
  return `
    <article class="card">
      ${poster ? `<img class="thumb" src="${esc(poster.url)}" alt="" loading="lazy">` : ''}
      <span class="kind">${esc(KIND_WORD[e.kind] ?? 'Video')}${e.duration ? ` · ${esc(fmtTime(e.duration))}` : ''}</span>
      <h2>${esc(e.title)}</h2>
      <p>${esc(e.blurb)}</p>
      <div class="row"><a class="btn" href="/videos/${esc(e.slug)}/">Watch</a></div>
    </article>`;
}

export function homePage(cat, live = {}) {
  const name = cat.studio?.name ?? 'Studio';
  const games = cat.games ?? [];
  const songs = cat.songs ?? [];
  const videos = cat.videos ?? [];
  const cards = games.map((g) => `
    <article class="card">
      <h2>${esc(g.name)}</h2>
      <p>${esc(g.blurb)}</p>
      <div class="meta"><span>${esc(g.players?.max ? `up to ${g.players.max} players` : 'multiplayer')}</span>${live[g.id] ? `<span class="live">● ${live[g.id]} playing now</span>` : ''}</div>
      <div class="row"><a class="btn" href="/${esc(g.id)}/play">Play</a><a class="btn ghost" href="/${esc(g.id)}/">About</a></div>
    </article>`).join('');
  return page(name, `<div class="wrap">
    <header class="top"><a class="brand" href="/">${esc(name)}</a><span class="tag">${games.length ? 'Press Play and you are in a live room.' : 'Games, music and videos.'}</span></header>
    ${games.length ? `${songs.length || videos.length ? '<h2 class="section">Games</h2>' : ''}<section class="grid">${cards}</section>` : (songs.length || videos.length ? '' : '<p class="tag" style="margin-top:28px">Nothing published yet.</p>')}
    ${videos.length ? `<h2 class="section"><a href="/videos/">Videos</a></h2><section class="grid">${videos.map(videoCard).join('')}</section>` : ''}
    ${songs.length ? `<h2 class="section"><a href="/music/">Music</a></h2><section class="grid">${songs.map(songCard).join('')}</section>` : ''}
    <footer>${esc(name)} runs on its own Cloudflare. Made with Homie.</footer>
  </div>`);
}

/** /music/ and /videos/: every published entry of one kind. */
export function mediaIndexPage(cat, kind) {
  const name = cat.studio?.name ?? 'Studio';
  const list = (kind === 'music' ? cat.songs : cat.videos) ?? [];
  const title = kind === 'music' ? 'Music' : 'Videos';
  return page(`${title} · ${name}`, `<div class="wrap">
    <header class="top"><a class="brand" href="/" style="font-size:22px">${esc(name)}</a><span class="tag">${esc(title)}</span></header>
    ${list.length ? `<section class="grid">${list.map(kind === 'music' ? songCard : videoCard).join('')}</section>` : `<p class="tag" style="margin-top:28px">No ${kind === 'music' ? 'music' : 'videos'} published yet.</p>`}
  </div>`);
}

function rightsLine(e) {
  const bits = [];
  if (e.credits) bits.push(esc(e.credits));
  const r = e.rights;
  if (r && typeof r === 'object') {
    if (r.commercial === true) bits.push(`Licensed for commercial use${r.plan ? ` (made on the provider's ${esc(r.plan)} plan)` : ''}.`);
    else if (r.commercial === false) bits.push(`Not licensed for commercial use${r.plan ? ` (made on the provider's ${esc(r.plan)} plan)` : ''}.`);
    if (r.attribution) bits.push(esc(r.attribution));
  }
  if (e.honesty) bits.push(esc(e.honesty));
  return bits.length ? `<p class="rights">${bits.join(' ')}</p>` : '';
}

/**
 * The page's one stats beacon: when its player first starts, one POST to /api/stats/beat (a counter, nothing about
 * the listener). worker/stats.mjs says what is counted.
 */
const playedBeacon = (kind, slug) => `<script>(function(){var m=document.querySelector(${JSON.stringify(kind === 'song' ? 'audio' : 'video[data-main]')});if(!m||!navigator.sendBeacon)return;m.addEventListener('play',function(){try{navigator.sendBeacon('/api/stats/beat',${JSON.stringify(JSON.stringify({ k: kind, s: slug })).replace(/</g, '\\u003c')});}catch(e){}},{once:true});}());</script>`;

const ogTags = (props) => Object.entries(props).filter(([, v]) => v).map(([k, v]) => `<meta property="${esc(k)}" content="${esc(v)}">`).join('');

/** /music/<slug>/: the player, the facts, the words, the loops and stems another game may use. */
export function songPage(cat, e, origin = '') {
  const name = cat.studio?.name ?? 'Studio';
  const audio = fileOf(e, 'audio');
  const cover = fileOf(e, 'cover');
  const extras = (e.files ?? []).filter((f) => f.role === 'loop' || f.role === 'stem');
  const game = e.for?.game && (cat.games ?? []).find((g) => g.id === e.for.game);
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  return page(`${e.title} · ${name}`, `<div class="wrap">
    <header class="top"><a class="brand" href="/" style="font-size:22px">${esc(name)}</a><a class="tag" href="/music/">Music</a></header>
    <section class="hero">
      ${cover ? `<img class="cover" src="${esc(cover.url)}" alt="">` : ''}
      <h1>${esc(e.title)}</h1>
      ${e.blurb ? `<p>${esc(e.blurb)}</p>` : ''}
      <div class="player"><audio controls preload="metadata" src="${esc(audio.url)}"></audio></div>
      <div class="facts">${[KIND_WORD[e.kind], e.duration ? fmtTime(e.duration) : null, e.bpm ? `${e.bpm} BPM` : null, e.key].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${game ? `<a href="/${esc(game.id)}/">${esc(game.name)}</a>` : ''}</div>
    </section>
    ${e.lyrics ? `<h2 class="section">Words</h2><div class="lyrics">${esc(e.lyrics)}</div>` : ''}
    ${extras.length ? `<h2 class="section">Loops and stems</h2><ul class="files">${extras.map((f) => `<li><a href="${esc(f.url)}" download><b>${esc(f.name ?? (f.role === 'loop' ? 'Loop' : 'Stem'))}</b><span>${esc([f.role, f.bars ? `${f.bars} bars` : null, f.bytes ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : null].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>` : ''}
    ${rightsLine(e)}
  </div>${playedBeacon('song', e.slug)}`, { extraHead: ogTags({ 'og:type': 'music.song', 'og:title': e.title, 'og:description': e.blurb, 'og:audio': abs(audio.url), 'og:image': abs(cover?.url) }) });
}

/** /videos/<slug>/: the player (16:9, or the 9:16 cut on a portrait phone), captions, credits. */
export function videoPage(cat, e, origin = '') {
  const name = cat.studio?.name ?? 'Studio';
  const video = fileOf(e, 'video');
  const vertical = fileOf(e, 'vertical');
  const poster = fileOf(e, 'poster');
  const captions = fileOf(e, 'captions');
  const game = e.for?.game && (cat.games ?? []).find((g) => g.id === e.for.game);
  const song = e.for?.song && (cat.songs ?? []).find((m) => m.slug === e.for.song);
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  // A portrait phone gets the 9:16 cut when there is one; everything else the 16:9 cut.
  const pick = vertical ? `<script>(function(){var v=document.querySelector('video[data-main]');if(!v)return;if(matchMedia('(orientation: portrait) and (max-width: 700px)').matches){v.src=${JSON.stringify(vertical.url).replace(/</g, '\u003c')};v.classList.add('vertical');}}());</script>` : '';
  return page(`${e.title} · ${name}`, `<div class="wrap">
    <header class="top"><a class="brand" href="/" style="font-size:22px">${esc(name)}</a><a class="tag" href="/videos/">Videos</a></header>
    <section style="padding-top:28px">
      <div class="player"><video data-main controls playsinline preload="metadata" src="${esc(video.url)}"${poster ? ` poster="${esc(poster.url)}"` : ''}>${captions ? `<track kind="captions" src="${esc(captions.url)}" srclang="en" label="English">` : ''}</video></div>
      <h1 style="font-size:clamp(30px,6vw,56px);margin:0 0 10px;letter-spacing:-.02em">${esc(e.title)}</h1>
      ${e.blurb ? `<p class="tag" style="font-size:17px;max-width:62ch">${esc(e.blurb)}</p>` : ''}
      <div class="facts">${[KIND_WORD[e.kind], e.duration ? fmtTime(e.duration) : null].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${song ? `<a href="/music/${esc(song.slug)}/">${esc(song.title)}</a>` : ''}</div>
      ${game ? `<div class="row"><a class="btn" href="/${esc(game.id)}/play">Play ${esc(game.name)}</a>${vertical ? `<a class="btn ghost" href="${esc(vertical.url)}">Vertical cut</a>` : ''}</div>` : (vertical ? `<div class="row"><a class="btn ghost" href="${esc(vertical.url)}">Vertical cut</a></div>` : '')}
    </section>
    ${rightsLine(e)}
  </div>${pick}${playedBeacon('video', e.slug)}`, { extraHead: ogTags({ 'og:type': 'video.other', 'og:title': e.title, 'og:description': e.blurb, 'og:video': abs(video.url), 'og:image': abs(poster?.url) }) });
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
