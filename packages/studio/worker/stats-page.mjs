/**
 * The studio owner's private stats page (/_studio/stats) and its one-time sign-in (/_studio/signin).
 *
 * Only the owner gets in: `homie-studio stats link` (run with the studio's own Cloudflare login) mints a one-time
 * key; opening the link shows a button, and pressing it (a POST from this site) spends the key for a session
 * cookie that lives only under /_studio/ (HttpOnly, SameSite=Lax, Secure on https). A link preview or a crawler
 * that GETs the link spends nothing. Everything is drawn on the server: no script, nothing loaded from anywhere,
 * never cached, never indexed.
 */
import { OWNER_COOKIE, endSession, ownerAllowed, rangeOf, readStats, spendSignin, onlyOf } from './stats.mjs';
import { CODEX_SCRIPT } from './codex-script.mjs';

/**
 * Where a sign-in may send the owner next: the stats, one game's codex, the back office, an ask waiting for the
 * owner's tap, or one of the studio's games (a private game's own secret road for the owner's phone).
 */
const NEXT = /^\/(?:_studio\/(?:stats|office|codex\/[a-z0-9][a-z0-9-]{0,39}\/|confirm\/ask_[a-f0-9]{16})|[a-z0-9][a-z0-9-]{0,39}\/(?:play)?)$/;
const nextOf = (url) => { const to = url.searchParams.get('to') ?? ''; return NEXT.test(to) ? to : '/_studio/stats'; };
const signinWord = (to) => (to.startsWith('/_studio/codex/') ? 'Open the codex' : to === '/_studio/office' ? 'Open the office' : to.startsWith('/_studio/confirm/') ? 'Sign in and see what your AI asks' : to.startsWith('/_studio/stats') ? 'Open the stats' : 'Sign in and play');
let scriptHash = null;
async function codexScriptHash() {
  if (!scriptHash) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CODEX_SCRIPT));
    scriptHash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
  }
  return scriptHash;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const PRIVATE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow',
  // same-origin, not no-referrer: a no-referrer page's own form POST carries `Origin: null`, which the sign-in refuses.
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

const CSS = `
:root { color-scheme: dark; --bg: #07080d; --panel: #10131c; --ink: #eef1f8; --dim: #9aa3b7; --line: rgba(255,255,255,.10); --accent: #ffcf5a; --good: #7dffb0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 28px 16px 64px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--line); padding-bottom: 16px; }
h1 { margin: 0; font-size: clamp(24px, 5vw, 36px); letter-spacing: -.02em; }
h2 { margin: 36px 0 10px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.dim { color: var(--dim); }
.ranges a, .ranges b { display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); text-decoration: none; color: inherit; margin: 0 4px 6px 0; font-size: 14px; }
.ranges b { background: var(--accent); color: #1a1405; border-color: var(--accent); }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 20px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
.tile b { display: block; font-size: 26px; letter-spacing: -.02em; }
.tile span { color: var(--dim); font-size: 13px; }
.scroll { overflow-x: auto; }
a { color: #ffe08a; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.wide { min-width: 640px; }
th, td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; white-space: normal; }
th { color: var(--dim); font-weight: 600; font-size: 13px; }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 90px; margin-top: 8px; }
.bars div { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 1px; opacity: .85; }
.kind { font-size: 12px; color: var(--dim); }
.live { color: var(--good); }
form { display: inline; }
button { font: inherit; border: 0; border-radius: 999px; padding: 12px 22px; font-weight: 800; background: var(--accent); color: #1a1405; cursor: pointer; }
button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); font-weight: 600; padding: 6px 14px; }
p.note { color: var(--dim); font-size: 13px; max-width: 70ch; }
`;

function page(title, body, status = 200, extraHeaders = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`, { status, headers: { ...PRIVATE_HEADERS, ...extraHeaders } });
}

function locked(cat) {
  return page('Stats · private', `<h1>${esc(cat.studio?.name ?? 'Studio')} stats</h1>
<p class="dim">This page is for the studio's owner only.</p>
<p class="note">To open it, the owner asks their AI in the studio's folder to run <code>npx --no-install homie-studio stats link</code>. That uses the studio's own Cloudflare login, and gives a one-time link for this browser.</p>`, 401);
}

/** A POST from this site's own page: its Origin, or (when a browser sends `Origin: null` or none) Sec-Fetch-Site. */
const sameOrigin = (request, url) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
};

const KIND_WORD = { hub: 'the Homie hub', studio: 'another studio', search: 'search', web: 'the web', link: 'a ?via= link' };

function statsBody(cat, s, url) {
  const t = s.totals;
  const q = (extra) => { const p = new URLSearchParams(url.searchParams); for (const [k, v] of Object.entries(extra)) { if (v === null) p.delete(k); else p.set(k, v); } p.delete('from'); p.delete('to'); return `?${p}`; };
  const range = url.searchParams.get('range') ?? (s.range.days === 1 ? '1d' : `${s.range.days}d`);
  const ranges = ['1d', '7d', '30d', '90d'].map((r) => (r === range ? `<b>${r === '1d' ? 'Today' : `${r.replace('d', '')} days`}</b>` : `<a href="${esc(q({ range: r }))}">${r === '1d' ? 'Today' : `${r.replace('d', '')} days`}</a>`)).join('');
  const tile = (n, label, cls = '') => `<div class="tile"><b class="${cls}">${esc(fmt(n))}</b><span>${esc(label)}</span></div>`;
  const peak = Math.max(1, ...s.days.map((d) => d.plays + d.visits));
  const bars = s.days.map((d) => `<div title="${esc(d.day)}: ${esc(d.visits)} visits, ${esc(d.plays)} plays" style="height:${Math.round(((d.plays + d.visits) / peak) * 100)}%"></div>`).join('');
  const gameRows = s.games.map((g) => `<tr><td><a href="${esc(q({ game: g.id, song: null, video: null }))}">${esc(g.name)}</a> <span class="kind">${esc(g.seats ?? '?')} seats</span></td><td>${fmt(g.visits)}</td><td>${fmt(g.plays)}</td><td>${fmt(g.rooms)}</td><td>${fmt(g.rounds)}</td><td>${fmt(g.peopleInRounds)}</td><td>${fmt(g.peakPlayers)}</td><td>${fmt(g.peakInOneRoom)}</td><td class="${g.playingNow ? 'live' : ''}">${fmt(g.playingNow)}</td></tr>`).join('');
  const songRows = s.songs.map((e) => `<tr><td><a href="${esc(q({ song: e.slug, game: null, video: null }))}">${esc(e.title)}</a></td><td>${fmt(e.visits)}</td><td>${fmt(e.plays)}</td></tr>`).join('');
  const videoRows = s.videos.map((e) => `<tr><td><a href="${esc(q({ video: e.slug, game: null, song: null }))}">${esc(e.title)}</a></td><td>${fmt(e.visits)}</td><td>${fmt(e.views)}</td></tr>`).join('');
  const refRows = s.referrers.map((r) => `<tr><td>${esc(r.from)} <span class="kind">${esc(KIND_WORD[r.kind] ?? r.kind)}</span></td><td>${fmt(r.visits)}</td><td>${fmt(r.plays)}</td></tr>`).join('');
  return `<header><h1>${esc(cat.studio?.name ?? 'Studio')} stats${s.only ? ` <span class="dim">· ${esc(s.only.kind)} ${esc(s.only.id)}</span>` : ''}</h1>
<span><a href="/_studio/office">Office</a> &nbsp; <form method="post" action="/_studio/signout"><button class="ghost" type="submit">Sign out</button></form></span></header>
<p class="dim">${esc(s.range.from)} to ${esc(s.range.to)} (UTC)${s.only ? ` · <a href="${esc(q({ game: null, song: null, video: null }))}">whole studio</a>` : ''}</p>
<nav class="ranges">${ranges}</nav>
<section class="tiles">
${tile(t.visits, 'visits')}${tile(t.plays, 'Play presses')}${tile(t.rooms, 'rooms opened')}${tile(t.rounds, 'rounds finished')}
${tile(t.peopleInRounds, 'people in finished rounds')}${tile(t.peakPlayers, 'most playing at once')}${tile(t.playingNow, 'playing right now', t.playingNow ? 'live' : '')}
${tile(t.songPlays, 'songs played')}${tile(t.videoViews, 'videos watched')}
${s.players && (s.players.accounts || s.players.guests) ? `${tile(s.players.accounts, 'player accounts')}${tile(s.players.guests, 'guests with saves')}${tile(s.players.active7d, 'players this week')}` : ''}
</section>
<h2>Every day</h2><div class="bars" role="img" aria-label="visits and plays per day">${bars}</div>
<h2>Games</h2><div class="scroll"><table class="wide"><thead><tr><th>Game</th><th>Visits</th><th>Plays</th><th>Rooms</th><th>Rounds</th><th>People in rounds</th><th>Peak</th><th>Peak in a room</th><th>Now</th></tr></thead><tbody>${gameRows || '<tr><td colspan="9" class="dim">No games.</td></tr>'}</tbody></table></div>
${s.songs.length ? `<h2>Songs</h2><div class="scroll"><table><thead><tr><th>Song</th><th>Page visits</th><th>Played</th></tr></thead><tbody>${songRows}</tbody></table></div>` : ''}
${s.videos.length ? `<h2>Videos</h2><div class="scroll"><table><thead><tr><th>Video</th><th>Page visits</th><th>Watched</th></tr></thead><tbody>${videoRows}</tbody></table></div>` : ''}
<h2>Where people came from</h2>
<p class="dim">From homie.rocks: ${fmt(s.crossings.fromHub)} · from other studios: ${fmt(s.crossings.fromStudios)} · from search: ${fmt(s.crossings.fromSearch)} · from the web: ${fmt(s.crossings.fromWeb)} · from ?via= links: ${fmt(s.crossings.fromLinks)}</p>
<div class="scroll"><table><thead><tr><th>From</th><th>Visits</th><th>Plays</th></tr></thead><tbody>${refRows || '<tr><td colspan="3" class="dim">Everybody came directly, or from this site.</td></tr>'}</tbody></table></div>
<p class="note">${esc(s.note)} This page is private to the studio's owner and is never cached or indexed.</p>`;
}

/**
 * /_studio/* for the owner, or null when the path is not one of these. `catalogueOf` reads games.json;
 * `studios` names sites that are Homie studios (for the "another studio" crossing).
 */
export async function ownerRoutes(request, env, url, { catalogueOf }) {
  const path = url.pathname;
  if (!path.startsWith('/_studio/')) return null;
  const cat = await catalogueOf();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  if (path === '/_studio/signin') {
    const key = url.searchParams.get('k') ?? '';
    if (request.method === 'GET') {
      // A GET spends nothing: a chat app's link preview must not use up the owner's one-time link.
      return page('Sign in · stats', `<h1>${esc(cat.studio?.name ?? 'Studio')} stats</h1>
<p class="dim">Sign this browser in as the studio's owner: the private stats and office, and the owner's tools in your own games. The link works once.</p>
<form method="post" action="/_studio/signin?k=${esc(encodeURIComponent(key))}${nextOf(url) !== '/_studio/stats' ? `&amp;to=${esc(encodeURIComponent(nextOf(url)))}` : ''}"><button type="submit">${signinWord(nextOf(url))}</button></form>`);
    }
    if (request.method !== 'POST' || !sameOrigin(request, url)) return page('Not allowed', '<h1>Not allowed</h1>', 403);
    const session = await spendSignin(env, key);
    if (!session) return page('Link used or expired', `<h1>That link has been used or has expired</h1><p class="note">A sign-in link works once, for 30 minutes. Ask your AI for a new one: <code>npx --no-install homie-studio stats link</code>.</p>`, 403);
    // The session lives at / (0.13.0): the owner is recognised in their own games, never readable by a page or a game.
    return new Response(null, { status: 303, headers: { location: nextOf(url), 'cache-control': 'no-store', 'set-cookie': `${OWNER_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}` } });
  }
  if (path === '/_studio/signout') {
    if (request.method !== 'POST' || !sameOrigin(request, url)) return page('Not allowed', '<h1>Not allowed</h1>', 403);
    await endSession(env, request);
    const headers = new Headers({ location: '/_studio/stats', 'cache-control': 'no-store' });
    // Both places a session cookie has lived (/ from 0.13.0, /_studio/ before).
    headers.append('set-cookie', `${OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    headers.append('set-cookie', `${OWNER_COOKIE}=; Path=/_studio/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return new Response(null, { status: 303, headers });
  }
  if (path === '/_studio/stats' || path === '/_studio/stats/') {
    if (request.method !== 'GET') return page('Not allowed', '<h1>Not allowed</h1>', 405);
    if ((await ownerAllowed(request, env, { kinds: ['session'] })) !== 'session') return locked(cat);
    let stats;
    try { stats = await readStats(env, cat, { range: rangeOf(url.searchParams), only: onlyOf(url.searchParams) }); } catch (error) {
      return page('Stats', `<h1>No stats yet</h1><p class="note">The counters are not in this studio's database yet: run <code>npm run deploy</code> (it applies D1 migration 0002_studio_stats.sql). (${esc(String(error?.message ?? error).slice(0, 120))})</p>`, 503);
    }
    return page(`Stats · ${cat.studio?.name ?? 'Studio'}`, statsBody(cat, stats, url));
  }
  // A game's Game Codex (lib/codex.mjs, built into site/dist/_studio/codex/<id>/): the owner's only, never listed.
  const codex = /^\/_studio\/codex\/([a-z0-9][a-z0-9-]{0,39})(\/|\/index\.html)?$/.exec(path);
  if (codex) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return page('Not allowed', '<h1>Not allowed</h1>', 405);
    if (!codex[2]) return new Response(null, { status: 301, headers: { location: `/_studio/codex/${codex[1]}/`, 'cache-control': 'no-store' } });
    if ((await ownerAllowed(request, env, { kinds: ['session'] })) !== 'session') {
      return page('Codex · private', `<h1>${esc(cat.studio?.name ?? 'Studio')}: Game Codex</h1>
<p class="dim">A game's codex is for the studio's owner only.</p>
<p class="note">To open it, the owner asks their AI in the studio's folder to run <code>npx --no-install homie-studio codex link ${esc(codex[1])}</code>. That uses the studio's own Cloudflare login, and gives a one-time link for this browser.</p>`, 401);
    }
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(`${url.origin}/_studio/codex/${codex[1]}/index.html`)) : null;
    if (!res || !res.ok) return page('No codex yet', `<h1>No codex for this game yet</h1><p class="note">Its plan is <code>games/${esc(codex[1])}/CODEX.md</code> in the studio; the next <code>npm run deploy</code> puts it here.</p>`, 404);
    return new Response(request.method === 'HEAD' ? null : await res.text(), {
      headers: {
        ...PRIVATE_HEADERS,
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:; script-src '${await codexScriptHash()}'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
      },
    });
  }
  return page('Not found', '<h1>Not found</h1>', 404);
}
