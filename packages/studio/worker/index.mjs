/**
 * @homie-rocks/studio/worker — a studio's own site, on the studio's own Cloudflare.
 *
 * One Worker serves the studio's pages and its public rooms (site/SITE.md: the sections, the landings, posts and
 * what a studio's site/ folder overrides):
 *
 *   /                          Home: the featured game, live rooms, games, latest posts, videos, music
 *   /games/ /rooms/ /posts/    the sections, as on homie.rocks (a section with nothing in it answers 404)
 *   /music/ /videos/           songs and videos (music/manifest.json, videos/manifest.json)
 *   /posts/<slug>/             a post (posts/*.md); /posts/feed.xml (Atom) and /posts/feed.json (JSON Feed)
 *   /<game>/                   the game's landing: hero, Play, phone / computer / TV, live rooms, how to play, credits
 *   /<game>/credits            the licence texts the game ships with
 *   /<game>/live               the landing's live line and rooms (JSON)
 *   /<game>/play               the play shell: asks the Lobby for a public room and boots the game in a
 *                              sandboxed frame, seated at once; the room goes into the address, and a small
 *                              room button shares it (Invite, Big screen, the room code)
 *   /<game>/tv                 the big screen: the same room as a spectator, with a QR code phones scan to join
 *                              (also /<game>/play?screen=1)
 *   /<game>/__game/...         the game's own files (index.html gets HOMIE_NET)
 *   /<game>/__net?room=        the room's netplay socket (Table Durable Object)
 *   /<game>/__watch?room=      the room's facts, for the shell
 *   /<game>/api/lobby          which public room to join (Lobby Durable Object)
 *   /api/games, /api/rooms     the catalogue plus live counts; every public room playing now (/api/rooms may be
 *                              cached for 15 s)
 *   /__homie/..., /<game>/__homie/...   `not-a-homie`: the answer a game with Homie's arcade controls gets when it
 *                              knocks for a Homie box, so it stops knocking (a studio site is not a box)
 *   /.well-known/homie-studio.json   what the homie.rocks directory reads
 *   /media/<key>               the studio's large media, from R2 (once `storage add` bound it), with byte ranges
 *   /api/stats                 the studio's numbers, for its owner only (a read key, or the owner's page session)
 *   /_studio/stats             the owner's private stats page (one-time sign-in link from `homie-studio stats link`)
 *   /_homie/site.js            the pages' one script
 *
 * A page in the studio's site/pages wins over the generated one at the same address. Every HTML answer is
 * `no-transform` (an edge in front of a custom domain injects nothing) and is never framed by another site.
 *
 * It counts, and never tracks (worker/stats.mjs): a page opened, a Play press, a room opened, a round finished,
 * the peak of players, a song or video started, and which site sent the visitor (a host name), as daily counters
 * in the studio's own D1. No cookie on a visitor, nothing sent anywhere.
 *
 * Bindings (site/wrangler.jsonc, written by `homie-studio new`): ASSETS (the
 * built site), TABLE and LOBBY (SQLite-backed Durable Objects, free plan
 * friendly), DB (D1: plays, finished rounds, the directory claim) and, only
 * after `homie-studio storage add` (R2 needs a payment method on the account),
 * MEDIA. Everything else runs on Cloudflare's free Workers plan.
 *
 * The relay is the netplay contract's own room.mjs (NETPLAY.md v1 rev 3), run
 * unchanged inside the Table, so a game that plays in `homie-studio dev`
 * plays the same way here.
 */
import { NetRoom } from './room.mjs';
import { ROOM_ID, badRoomPage, frameAncestors, playPage } from './pages.mjs';
import { qrSvg } from './qr.mjs';
import { SEAT_MAX, perAddress, seatsOf } from './seats.mjs';
import {
  SITE_JS, atomFeed, creditsPage, customPage, gameCover, gameLanding, gamesPage, homePage, jsonFeed, mediaArt, mediaIndexPage,
  notFoundPage, postPage, postsPage, roomView, roomsPage, sectionsOf, songPage, videoPage,
} from './site.mjs';
import { count, countVisit, counter, isQa, onlyOf, ownerAllowed, playedByGame, playedThisWeek, rangeOf, readStats, today } from './stats.mjs';
import { ownerRoutes } from './stats-page.mjs';
import { STUDIO_VERSION_TAG } from './version.mjs';

export { SEAT_MAX } from './seats.mjs';
/** For a studio's own wrapper Worker: count its own pages the way the template counts its pages. */
export { countVisit } from './stats.mjs';

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** A game's own files, framed by its play page: never x-frame-options DENY. */
const GAME_FILES = /^\/[a-z0-9][a-z0-9-]{0,39}\/__game(?:\/|$)/;
const MEDIA_FILE = /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|opus|wav|flac)$/i;

const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

/** The catalogue `homie-studio build` writes into the site (games.json). */
async function catalogue(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/games.json`));
    if (!res.ok) return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] };
    return await res.json();
  } catch { return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] }; }
}

/** The posts with their HTML (site/dist/_site/posts.json), for a post's page and the feeds. */
async function postsOf(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/_site/posts.json`));
    return res.ok ? ((await res.json()).posts ?? []) : [];
  } catch { return []; }
}

async function claimOf(env) {
  if (!env.DB) return null;
  try { return (await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('homie_claim').first())?.value ?? null; } catch { return null; }
}

/** Every public room with people in it, per game (the Lobby's list), and the number playing per game. */
async function roomsOf(env, games) {
  const rooms = [];
  const live = {};
  await Promise.all(games.map(async (g) => {
    let list = [];
    try { list = (await (await env.LOBBY.get(env.LOBBY.idFromName(g.id)).fetch('https://lobby/rooms')).json()).rooms ?? []; } catch { list = []; }
    const busy = list.filter((r) => (r.players || 0) > 0);
    live[g.id] = busy.reduce((n, r) => n + (r.players || 0), 0);
    for (const r of busy) rooms.push(roomView(g, r, seatsOf(g)));
  }));
  rooms.sort((a, b) => b.players - a.players || a.game.localeCompare(b.game) || String(a.room).localeCompare(String(b.room)));
  return { rooms, live };
}

/** Kept for a studio's own wrapper Worker that reads `/api/games`'s `live`. */
async function liveCounts(env, games) { return (await roomsOf(env, games)).live; }

const MEDIA_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `bytes=a-b`, `bytes=a-`, `bytes=-n` against a length, or null (a malformed or multi-range header is served whole). */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { unsatisfiable: true };
  return { start, end };
}

/** A media file from the site's own assets, answering a byte range (phones seek audio and video with them; Safari needs them to play a video at all). */
async function assetWithRange(request, env, url) {
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  const range = request.headers.get('range');
  if (!res.ok || !range || res.status === 206) return res;
  const body = new Uint8Array(await res.arrayBuffer());
  const r = parseRange(range, body.byteLength);
  const headers = new Headers(res.headers);
  headers.set('accept-ranges', 'bytes');
  if (!r) return new Response(body, { status: 200, headers });
  if (r.unsatisfiable) { headers.set('content-range', `bytes */${body.byteLength}`); return new Response(null, { status: 416, headers }); }
  headers.set('content-range', `bytes ${r.start}-${r.end}/${body.byteLength}`);
  headers.set('content-length', String(r.end - r.start + 1));
  return new Response(body.subarray(r.start, r.end + 1), { status: 206, headers });
}

/** A file from the studio's R2 bucket, with byte ranges. */
async function mediaObject(request, env, key) {
  const range = request.headers.get('range');
  let head = null;
  if (range) head = await env.MEDIA.head(key);
  if (range && !head) return new Response('not found', { status: 404 });
  const r = head ? parseRange(range, head.size) : null;
  if (r?.unsatisfiable) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
  const obj = await env.MEDIA.get(key, r ? { range: { offset: r.start, length: r.end - r.start + 1 } } : undefined);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('accept-ranges', 'bytes');
  if (r) {
    headers.set('content-range', `bytes ${r.start}-${r.end}/${head.size}`);
    headers.set('content-length', String(r.end - r.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

/**
 * A catalogue media row as the directory reads it (absolute addresses). A song's cover (a video's poster) is its
 * own, else the manifest's default, else the landing still of the game it was made for (site.mjs mediaArt).
 */
function mediaRow(e, origin, kind, cat) {
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u ?? null);
  const main = (e.files ?? []).find((f) => f.role === (kind === 'music' ? 'audio' : 'video'));
  return {
    slug: e.slug, kind: e.kind, title: e.title, blurb: e.blurb ?? '', duration: e.duration ?? null,
    page: `${origin}/${kind}/${e.slug}/`, [kind === 'music' ? 'audio' : 'video']: abs(main?.url), [kind === 'music' ? 'cover' : 'poster']: abs(mediaArt(e, kind, cat)),
    credits: e.credits ?? null, rights: e.rights ?? null, for: e.for ?? null,
  };
}

/**
 * THE ARCADE KNOCK, ANSWERED AT THE ROOT. A game made with Homie's arcade controls (@homie-rocks/arcade, and the
 * older builds of it that Homie's own games carry) asks its page's own origin for a Homie box with a GET on
 * /__homie/call, and a score goes there as a POST. The game's frame is /<game>/__game/, so that absolute path lands
 * on the site's ROOT, not under the game. `not-a-homie` (JSON, CORS-open, because the frame is an opaque origin) makes the knock stop for
 * good and refuses a call in words; it answers 200, so no browser logs a failed load for it, and a studio needs no
 * wrapper Worker of its own for this. A preflight (a POST's content-type) is answered too.
 */
const KNOCK_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
function notAHomie(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...KNOCK_CORS, 'cache-control': 'no-store' } });
  return json({ ok: false, error: 'not-a-homie', message: 'this is a studio site, not a Homie box; a game here plays on its own' }, 200, KNOCK_CORS);
}

/** The game's index.html with HOMIE_NET ahead of its modules, in the site's sandbox (an opaque origin). */
async function gameDocument(request, env, url, game, meta, cat) {
  const asked = url.searchParams.get('room');
  // A room code the relay cannot use is refused here too, never swapped for another room.
  if (asked !== null && !ROOM_ID.test(asked)) return new Response('That room link does not work: a room code is 1 to 32 letters, digits, - or _.\n', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/index.html`));
  if (!res.ok) return notFoundPage(`No build of "${game}" on this site yet.`, cat);
  const room = asked ?? 'main';
  const want = url.searchParams.get('want') === 'screen' ? 'screen' : 'play';
  const device = ['phone', 'desk', 'tv'].includes(url.searchParams.get('device')) ? url.searchParams.get('device') : undefined;
  const wsBase = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  const cfg = {
    v: 1,
    url: `${wsBase}/${game}/__net?room=${encodeURIComponent(room)}`,
    room,
    ...(url.searchParams.get('k') ? { token: url.searchParams.get('k').slice(0, 128) } : {}),
    ...(url.searchParams.get('name') ? { name: url.searchParams.get('name').slice(0, 24) } : {}),
    ...(device ? { device } : {}),
    want,
    debug: url.searchParams.get('debug') === '1',
    ...(meta?.movement ? { movement: meta.movement } : {}),
  };
  let html = await res.text();
  const head = `<script>window.HOMIE_NET=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${head}`) : head + html;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'access-control-allow-origin': '*',
      // The game runs in an opaque origin: it cannot read this site's storage or cookies.
      'content-security-policy': `sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups; frame-ancestors ${frameAncestors(cat)}`,
    },
  });
}

async function gameAsset(request, env, url, game, rest) {
  if (rest.includes('..')) return new Response('not found', { status: 404 });
  const target = new URL(`${url.origin}/games/${game}/${rest}`);
  const res = MEDIA_FILE.test(rest) && request.headers.get('range') ? await assetWithRange(request, env, target) : await env.ASSETS.fetch(new Request(target));
  const out = new Response(res.body, res);
  // Module scripts from the opaque-origin frame are CORS requests.
  out.headers.set('access-control-allow-origin', '*');
  return out;
}

/**
 * A studio that shares its "played this week" (studio.json `stats.share`) asks the directory to re-read its
 * manifest once a day per Worker instance: the directory reads the number from the studio's own site, so nothing
 * it is told can be forged by anyone else. Nothing else is ever sent.
 */
let sharedDay = null;
function shareDaily(cat, url, ctx) {
  if (!cat.studio?.stats?.share || url.protocol !== 'https:' || sharedDay === today()) return;
  sharedDay = today();
  const directory = String(cat.studio.directory ?? 'https://homie.rocks').replace(/\/+$/, '');
  const ping = fetch(`${directory}/api/studio/played`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: url.origin }) }).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(ping);
}

/** A song's or video's player started (the page's one beacon, sent once per page): one counter. */
async function mediaBeat(request, env, ctx, url) {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' ? origin !== url.origin : site !== 'same-origin') return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 256) return new Response(null, { status: 413 });
  let body = null;
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  const kind = body?.k === 'song' || body?.k === 'video' ? body.k : null;
  const slug = typeof body?.s === 'string' && MEDIA_SLUG.test(body.s) ? body.s : null;
  if (!kind || !slug) return new Response(null, { status: 400 });
  const cat = await catalogue(env, url.origin);
  const known = (kind === 'song' ? cat.songs : cat.videos) ?? [];
  if (!known.some((e) => e.slug === slug)) return new Response(null, { status: 404 });
  if (!isQa(request)) await count(env, ctx, { metric: kind, subject: slug }); // house QA is never counted
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/**
 * EVERY HTML ANSWER IS no-transform, AND NEVER FRAMED BY ANOTHER SITE. A custom domain on a zone with Cloudflare Web
 * Analytics' automatic setup gets a beacon injected into every HTML answer not marked no-transform, and the beacon
 * posts to /cdn-cgi/rum, which a Worker custom domain does not serve. Pages that name no frame rule get
 * x-frame-options DENY (the game's own files are framed by its play page, so they keep theirs).
 */
function finish(res, path) {
  if (!res || res.status === 101 || res.webSocket) return res;
  if (!/text\/html/i.test(res.headers.get('content-type') ?? '')) return res;
  const cache = res.headers.get('cache-control') ?? '';
  const addNt = !/no-transform/i.test(cache);
  const addXfo = !res.headers.has('x-frame-options') && !GAME_FILES.test(path);
  if (!addNt && !addXfo) return res;
  const headers = new Headers(res.headers);
  if (addNt) headers.set('cache-control', cache ? `${cache}, no-transform` : 'no-transform');
  if (addXfo) headers.set('x-frame-options', 'DENY');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    return finish(await route(request, env, ctx), new URL(request.url).pathname);
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean);
  const read = request.method === 'GET' || request.method === 'HEAD';
  let catP = null;
  const getCat = () => (catP ??= catalogue(env, url.origin));

  if (path.startsWith('/_studio/')) return ownerRoutes(request, env, url, { catalogueOf: getCat });
  if (path === '/__homie' || path.startsWith('/__homie/')) return notAHomie(request);
  if (path === '/_homie/site.js') return new Response(SITE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': url.searchParams.get('v') === STUDIO_VERSION_TAG ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  if (path === '/api/stats/beat' && request.method === 'POST') return mediaBeat(request, env, ctx, url);
  if (path === '/api/stats') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);
    if ((await ownerAllowed(request, env, { kinds: ['read'] })) !== 'read') {
      return json({ ok: false, error: 'owner-only', message: 'The studio\'s numbers are for its owner. In the studio folder: `npx --no-install homie-studio stats` prints them; `npx --no-install homie-studio stats key` gives a read key for the Homie MCP tool studio_stats.' }, 401, { 'www-authenticate': 'Bearer' });
    }
    const cat = await getCat();
    const studios = new Set(String(url.searchParams.get('studios') ?? '').split(',').filter((h) => /^[a-z0-9.-]{3,80}$/.test(h)).slice(0, 500));
    try {
      return json({ ok: true, site: url.origin, ...(await readStats(env, cat, { range: rangeOf(url.searchParams), only: onlyOf(url.searchParams), studios })) });
    } catch (error) {
      return json({ ok: false, error: 'no-stats', message: `The counters are not in this studio's D1 yet: \`npm run deploy\` applies migration 0002_studio_stats.sql. (${String(error?.message ?? error).slice(0, 120)})` }, 503);
    }
  }
  if (path === '/.well-known/homie-studio.json') {
    const cat = await getCat();
    const sharing = Boolean(cat.studio?.stats?.share);
    const [played, byGame] = sharing ? await Promise.all([playedThisWeek(env), playedByGame(env)]) : [null, null];
    // studio.json `"rooms": { "share": false }` keeps the rooms off the hub: a manifest that names no `rooms` shares none.
    const shareRooms = cat.studio?.rooms?.share !== false;
    return json({
      v: 1,
      kind: 'homie-studio',
      name: cat.studio?.name ?? env.STUDIO_NAME ?? 'Studio',
      slug: cat.studio?.slug ?? null,
      ...(cat.studio?.tagline ? { tagline: cat.studio.tagline } : {}),
      site: url.origin,
      studio: cat.studio?.version ?? null,
      claim: await claimOf(env),
      games: (cat.games ?? []).map((g) => {
        // The card picture is the landing's hero still (what the landing leads with), else the game's cover.
        const cover = gameCover(g);
        return {
          id: g.id, name: g.name, blurb: g.blurb ?? '', players: g.players ?? null, roundSeconds: g.roundSeconds ?? null,
          page: `${url.origin}/${g.id}/`, play: `${url.origin}/${g.id}/play`, cover: cover ? (cover.startsWith('/') ? `${url.origin}${cover}` : cover) : null,
          // Shared only with `stats.share`: this game's own Play presses and rounds with people, this week.
          ...(byGame ? { played: byGame[g.id] ?? { days: 7, plays: 0, rounds: 0 } } : {}),
        };
      }),
      songs: (cat.songs ?? []).map((e) => mediaRow(e, url.origin, 'music', cat)),
      videos: (cat.videos ?? []).map((e) => mediaRow(e, url.origin, 'videos', cat)),
      // The studio's posts, for the hub (the full text is in /posts/feed.json).
      posts: (cat.posts ?? []).slice(0, 20).map((p) => ({ slug: p.slug, title: p.title, date: p.date, summary: p.summary, page: `${url.origin}/posts/${p.slug}/`, image: p.image ? (p.image.startsWith('/') ? `${url.origin}${p.image}` : p.image) : null, links: p.links ?? {} })),
      ...(shareRooms ? { rooms: `${url.origin}/api/rooms` } : {}),
      // Shared only when studio.json says `stats.share`: two numbers for the whole studio, for the hub.
      ...(played ? { played } : {}),
    }, 200, { 'access-control-allow-origin': '*' });
  }
  if (path === '/api/games') {
    const cat = await getCat();
    return json({ studio: cat.studio, games: cat.games, live: await liveCounts(env, cat.games ?? []) });
  }
  if (path === '/api/rooms') {
    const cat = await getCat();
    const { rooms } = await roomsOf(env, cat.games ?? []);
    // Short-lived and cacheable: the hub reads every studio's rooms at most every 45 s, and a room's count is a
    // few seconds stale at worst. (The site's own pages ask with cache: 'no-store'.)
    return json({ ok: true, playing: rooms.reduce((n, r) => n + r.players, 0), rooms }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=15' });
  }
  if (path.startsWith('/media/')) {
    if (!env.MEDIA) return new Response('this studio keeps no media in R2 yet', { status: 404 });
    const key = decodeURIComponent(path.slice('/media/'.length));
    if (!key || key.includes('..')) return new Response('not found', { status: 404 });
    return mediaObject(request, env, key);
  }
  if (path === '/posts/feed.xml' || path === '/posts/feed.json') {
    const cat = await getCat();
    if (!(cat.posts ?? []).length) return notFoundPage('This studio has no posts yet.', cat);
    const posts = await postsOf(env, url.origin);
    return path.endsWith('.xml') ? atomFeed(cat, posts, url.origin) : jsonFeed(cat, posts, url.origin);
  }

  // A page the studio made itself (site/pages) wins at its address.
  if (read && (path.endsWith('/') || !path.includes('.'))) {
    const cat = await getCat();
    const pages = cat.site?.pages ?? [];
    const want = path.endsWith('/') ? path : `${path}/`;
    if (pages.includes(want)) {
      if (want !== path) return Response.redirect(`${url.origin}${want}${url.search}`, 301);
      const res = await env.ASSETS.fetch(new Request(`${url.origin}/_site/pages${want}index.html`));
      if (res.ok) {
        const top = parts[0] ?? '';
        const game = (cat.games ?? []).find((g) => g.id === top);
        await countVisit(request, env, ctx, parts.length === 0 ? 'home' : game && parts.length === 1 ? game.id : parts.join('/').slice(0, 80));
        const active = game ? 'games' : sectionsOf(cat).some((s) => s.key === top) ? top : null;
        return customPage(cat, await res.text(), { active });
      }
    }
  }

  if (parts[0] === 'music' || parts[0] === 'videos') {
    const kind = parts[0];
    const cat = await getCat();
    const list = (kind === 'music' ? cat.songs : cat.videos) ?? [];
    // A studio with no songs has no Music: the tab is gone and the page is not found (the same for videos).
    if (!list.length) return notFoundPage(kind === 'music' ? 'This studio has no music yet.' : 'This studio has no videos yet.', cat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${kind}/`, 301);
    if (parts.length === 1) { await countVisit(request, env, ctx, kind); return mediaIndexPage(cat, kind, { origin: url.origin }); }
    const slug = parts[1];
    const entry = MEDIA_SLUG.test(slug) ? list.find((e) => e.slug === slug) : null;
    if (parts.length === 2) {
      if (!entry) return notFoundPage(`No ${kind === 'music' ? 'song' : 'video'} called "${slug}" here.`, cat);
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${kind}/${slug}/`, 301);
      await countVisit(request, env, ctx, `${kind}/${slug}`);
      return kind === 'music' ? songPage(cat, entry, url.origin) : videoPage(cat, entry, url.origin);
    }
    if (parts.some((p) => p === '..')) return notFoundPage('Nothing here.', cat);
    const file = await assetWithRange(request, env, url);
    if (file.status === 404) return notFoundPage('Nothing here.', cat);
    return file;
  }
  if (path === '/' || path === '/index.html') {
    const cat = await getCat();
    await countVisit(request, env, ctx, 'home');
    shareDaily(cat, url, ctx);
    const { rooms, live } = await roomsOf(env, cat.games ?? []);
    return homePage(cat, { origin: url.origin, rooms, live });
  }
  if (['games', 'rooms', 'posts'].includes(parts[0]) && parts.length === 1) {
    const cat = await getCat();
    const has = sectionsOf(cat).some((s) => s.key === parts[0]);
    if (!has) return notFoundPage(parts[0] === 'posts' ? 'This studio has no posts yet.' : 'This studio has no games yet.', cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${parts[0]}/`, 301);
    await countVisit(request, env, ctx, parts[0]);
    if (parts[0] === 'posts') return postsPage(cat, { origin: url.origin });
    const { rooms, live } = await roomsOf(env, cat.games ?? []);
    return parts[0] === 'games' ? gamesPage(cat, { origin: url.origin, live }) : roomsPage(cat, { origin: url.origin, rooms });
  }
  if (parts[0] === 'posts' && parts.length === 2 && POST_SLUG.test(parts[1])) {
    const cat = await getCat();
    const posts = (cat.posts ?? []).length ? await postsOf(env, url.origin) : [];
    const post = posts.find((p) => p.slug === parts[1]);
    if (!post) return notFoundPage(`No post called "${parts[1]}" here.`, cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/posts/${post.slug}/`, 301);
    await countVisit(request, env, ctx, `posts/${post.slug}`);
    return postPage(cat, post, { origin: url.origin });
  }

  const game = parts[0];
  if (game && GAME_ID.test(game)) {
    const cat = await getCat();
    const meta = (cat.games ?? []).find((g) => g.id === game);
    if (!meta) return fallback(request, env, url, getCat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/`, 301);
    const sub = parts.slice(1).join('/');
    const max = seatsOf(meta);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName(game));
    if (sub === '') {
      await countVisit(request, env, ctx, game);
      shareDaily(cat, url, ctx);
      const { rooms, live } = await roomsOf(env, [meta]);
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      return gameLanding(cat, meta, { origin: url.origin, rooms, playing: live[game] ?? 0, week });
    }
    if (sub === 'live') {
      const { rooms, live } = await roomsOf(env, [meta]);
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      // The same shape the house brands' landings read (counted, playing, waiting, road), plus the rooms.
      return json({ ok: true, game, counted: true, playing: live[game] ?? 0, waiting: 0, max, rooms, road: { seats: 'any', start: 'now', room: 'public', big: true }, ...(week ? { week } : {}) }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'credits') {
      let texts = [];
      try { const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/_landing/credits.json`)); if (res.ok) texts = (await res.json()).texts ?? []; } catch { texts = []; }
      if (!texts.length) return notFoundPage(`${meta.name} has no licence texts to show; its credits are on its page.`, cat);
      return creditsPage(cat, meta, texts, { origin: url.origin });
    }
    if (sub === 'tv' || (sub === 'play' && url.searchParams.get('screen') === '1')) {
      const asked = url.searchParams.get('room');
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { screen: true });
      await countVisit(request, env, ctx, game, 'screen');
      // The big screen picks its room now, so the QR it shows puts every phone in that same room.
      let room = asked;
      if (!room) {
        try { room = (await (await lobby().fetch(`https://lobby/join?max=${max}`, { method: 'POST' })).json()).room ?? null; } catch { room = null; }
      }
      const joinUrl = `${url.origin}/${game}/play${room ? `?room=${encodeURIComponent(room)}` : ''}`;
      let qr = null;
      try { qr = qrSvg(joinUrl, { title: `Join ${meta.name ?? game}` }); } catch { /* too long for a QR: the address shows as text */ }
      return playPage(cat, meta, { screen: true, joinUrl, qr, room });
    }
    if (sub === 'play') {
      const asked = url.searchParams.get('room');
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked);
      await countVisit(request, env, ctx, game, 'play');
      shareDaily(cat, url, ctx);
      return playPage(cat, meta);
    }
    if (sub === 'api/lobby') return lobby().fetch(`https://lobby/join?max=${max}`, { method: 'POST' });
    if (sub === '__net' || sub === '__watch') {
      if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const room = url.searchParams.get('room') || 'main';
      if (!ROOM_ID.test(room)) return new Response('bad room', { status: 400 });
      const stub = env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
      const target = `https://table/${sub}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}`;
      return stub.fetch(new Request(target, request));
    }
    // The same knock, relative to the game's own page: the same answer (see notAHomie).
    if (sub === '__homie' || sub.startsWith('__homie/')) return notAHomie(request);
    if (sub === '__game' || sub === '__game/' || sub === '__game/index.html') return gameDocument(request, env, url, game, meta, cat);
    if (sub.startsWith('__game/')) return gameAsset(request, env, url, game, sub.slice('__game/'.length));
  }
  return fallback(request, env, url, getCat);
}

/** A game's "played this week" on its landing, when the studio shares its numbers: Play presses and rounds with people. */
async function weekOf(env, game) {
  const w = await playedThisWeek(env, game);
  if (!w) return null;
  let peak = 0;
  try { peak = (await (await env.LOBBY.get(env.LOBBY.idFromName(game)).fetch('https://lobby/now')).json()).peak?.players ?? 0; } catch { peak = 0; }
  return { plays: w.plays, rounds: w.rounds, ...(peak ? { peak } : {}) };
}

/** Everything else is a file of the built site (site/public, the games' files), with byte ranges for media. */
async function fallback(request, env, url, getCat) {
  const asset = MEDIA_FILE.test(url.pathname) && request.headers.get('range') ? await assetWithRange(request, env, url) : await env.ASSETS.fetch(request);
  if (asset.status === 404) return notFoundPage('Nothing here.', await getCat());
  return asset;
}


/**
 * TABLE — one public room: the netplay relay (room.mjs) for every browser in it.
 * It keeps nothing per frame; seats and a checkpoint go to storage (a deploy
 * keeps the room), and each finished round is one D1 row.
 */
export class Table {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.timer = null;
    this.saved = null;
    this.game = null;
    this.code = null;
    this.recorded = 0;
    this.lastReport = -1;
    /** This room was counted as opened (worker/stats.mjs `room`); cleared when its seats are all forgotten. */
    this.openCounted = false;
    ctx.blockConcurrencyWhile(async () => {
      this.saved = (await ctx.storage.get('net')) ?? null;
      this.recorded = (await ctx.storage.get('recorded')) ?? 0;
    });
  }

  roomFor(game, code, max) {
    if (this.room) return this.room;
    const storage = this.ctx.storage;
    this.game = game;
    this.code = code;
    this.room = new NetRoom({
      code,
      maxPlayers: max,
      perIp: perAddress(max),
      store: {
        save: (o) => { storage.put('net', o).catch(() => {}); },
        clear: () => { storage.delete('net').catch(() => {}); },
      },
    });
    if (this.saved) this.room.restore(this.saved);
    return this.room;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const game = url.searchParams.get('game');
    const code = url.searchParams.get('room');
    const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
    const room = this.roomFor(game, code, max);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = {
      ip: request.headers.get('cf-connecting-ip'),
      // House QA and `homie-studio check` mark their browsers; their rooms, rounds and peaks are not the studio's numbers.
      qa: isQa(request),
      send: (text) => { try { server.send(text); } catch { /* closed */ } },
      close: (c, r) => { try { server.close(c, r); } catch { /* closed */ } },
      buffered: () => 0,
    };
    if (url.pathname === '/__watch') {
      const w = room.watch(conn);
      server.addEventListener('close', () => w.onClose());
      server.addEventListener('error', () => w.onClose());
    } else {
      const h = room.attach(conn);
      // A room is OPENED when the first seat is taken in an empty one (a room restored after a deploy keeps its
      // seats, so it is not counted twice). One counter write per room.
      const fresh = room.seats.size === 0;
      server.addEventListener('message', (e) => {
        h.onMessage(typeof e.data === 'string' ? e.data : '');
        if (fresh && !this.openCounted && room.seats.size > 0) {
          this.openCounted = true;
          if (conn.qa) return;
          this.ctx.waitUntil(count(this.env, null, { metric: 'room', subject: this.game ?? '', source: /^pub-\d+$/.test(this.code ?? '') ? 'public' : 'named' }));
        }
      });
      server.addEventListener('close', () => { h.onClose(); this.report(); });
      server.addEventListener('error', () => { h.onClose(); this.report(); });
    }
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  start() {
    if (this.timer) return;
    let n = 0;
    this.timer = setInterval(() => {
      const room = this.room;
      if (!room) return;
      room.tick();
      n += 1;
      if (n % 4 === 0) { room.tellWatchers(); this.report(); this.recordRound(); }
      if (room.seats.size === 0 && room.clients.size === 0) this.openCounted = false;
      if (room.clients.size === 0 && room.watchers.size === 0) { clearInterval(this.timer); this.timer = null; this.report(); }
    }, 250);
  }

  /** Tell the Lobby how many players this room has, when it changes. */
  report() {
    const room = this.room;
    if (!room || !this.game) return;
    const players = room.facts().counts.players;
    // People for the stats: seated sockets that are not house QA (players is what the Lobby matches strangers by).
    let people = 0;
    for (const c of room.clients.values()) if (c.helloed && c.seat !== null && !c.conn?.qa) people += 1;
    // On a change, and once a minute while anybody is here (so the Lobby's "playing now" forgets a room that died).
    if (players === this.lastReport && people === this.lastPeople && (!players || Date.now() - (this.lastReportAt ?? 0) < 60_000)) return;
    this.lastReport = players;
    this.lastPeople = people;
    this.lastReportAt = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players, people }) }).catch(() => {}));
  }

  /** A round the host called over becomes one D1 row (once per round number). */
  recordRound() {
    const r = this.room?.lastRound;
    if (!r || r.phase !== 'over' || !Number.isFinite(r.n) || r.n <= this.recorded || !this.env.DB) return;
    this.recorded = r.n;
    this.ctx.storage.put('recorded', r.n).catch(() => {});
    const results = Array.isArray(r.results) ? r.results.slice(0, SEAT_MAX * 2) : [];
    const humans = results.filter((row) => row && !row.bot).length;
    // A round played only by house QA (every seated socket is marked) is kept in `rounds`, not in the stats.
    const qaOnly = [...this.room.clients.values()].filter((c) => c.helloed && c.seat !== null).every((c) => c.conn?.qa);
    const db = this.env.DB;
    const insert = db.prepare('INSERT OR IGNORE INTO rounds (game, room, n, humans, bots, results, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(this.game, this.code, r.n, humans, results.length - humans, JSON.stringify(results), new Date().toISOString());
    // The round and the people in it, on the studio's daily counters (worker/stats.mjs). One batch, per round.
    const counters = qaOnly ? [] : [counter(this.env, { metric: 'round', subject: this.game ?? '', source: humans ? 'people' : 'bots' }), humans ? counter(this.env, { metric: 'humans', subject: this.game ?? '', n: humans }) : null].filter(Boolean);
    this.ctx.waitUntil(db.batch([insert, ...counters]).catch(() => insert.run().catch(() => {})));
  }
}

/**
 * LOBBY — one per game: which public room a new visitor joins. Strangers meet:
 * the fullest room that still has a seat wins, counting visitors it just sent
 * there who have not connected yet, so two people pressing Play together land
 * in the same room.
 */
export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.rooms = new Map();
    this.next = 1;
    /** Every room of this game that reported players (public and named), for "playing now" and the day's peak. */
    this.live = new Map();
    this.peak = { day: null, players: 0, room: 0 };
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('lobby');
      if (saved) { this.next = saved.next ?? 1; for (const r of saved.rooms ?? []) this.rooms.set(r.name, { ...r, pending: [] }); }
    });
  }

  /**
   * The day's peak for this game, all rooms together and in one room: a counter write only when a new high is
   * reached (in memory per day; after an eviction the stored max still wins), so at most a few a day.
   */
  notePeak(room, players, game) {
    const now = Date.now();
    if (players > 0) this.live.set(room, { players, at: now }); else this.live.delete(room);
    for (const [name, r] of this.live) if (now - r.at > 180_000) this.live.delete(name); // a room that stopped reporting
    const day = today();
    if (this.peak.day !== day) this.peak = { day, players: 0, room: 0 };
    let all = 0;
    for (const r of this.live.values()) all += r.players;
    const writes = [];
    if (all > this.peak.players) { this.peak.players = all; writes.push(counter(this.env, { metric: 'peak', subject: game ?? this.game ?? '', n: all, day })); }
    if (players > this.peak.room) { this.peak.room = players; writes.push(counter(this.env, { metric: 'peak-room', subject: game ?? this.game ?? '', n: players, day })); }
    if (game) this.game = game;
    const list = writes.filter(Boolean);
    if (list.length) this.ctx.waitUntil(this.env.DB.batch(list).catch(() => {}));
  }

  save() { this.ctx.storage.put('lobby', { next: this.next, rooms: [...this.rooms.values()].map(({ name, players, at }) => ({ name, players, at })) }).catch(() => {}); }

  prune(now) {
    for (const [name, r] of this.rooms) {
      r.pending = r.pending.filter((t) => now - t < 20_000);
      if (r.players === 0 && !r.pending.length && now - r.at > 120_000) this.rooms.delete(name);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);
    if (url.pathname === '/join') {
      const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
      let best = null;
      for (const r of this.rooms.values()) {
        const fill = r.players + r.pending.length;
        if (fill >= max) continue;
        if (!best || fill > best.fill || (fill === best.fill && r.name < best.r.name)) best = { r, fill };
      }
      let room = best?.r;
      if (!room) {
        room = { name: `pub-${this.next}`, players: 0, at: now, pending: [] };
        this.next += 1;
        this.rooms.set(room.name, room);
      }
      room.pending.push(now);
      this.save();
      return json({ room: room.name, players: room.players, max });
    }
    if (url.pathname === '/report' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (typeof body.room !== 'string' || !ROOM_ID.test(body.room)) return json({ ok: false }, 400);
      this.notePeak(body.room, Math.max(0, Math.floor(Number(body.people ?? body.players) || 0)), url.searchParams.get('game'));
      // Only public rooms the Lobby made are matched with strangers; a named room (?room=) stays private.
      if (!this.rooms.has(body.room) && !/^pub-\d+$/.test(body.room)) return json({ ok: true, private: true });
      const r = this.rooms.get(body.room) ?? { name: body.room, players: 0, at: now, pending: [] };
      const grew = Math.max(0, (Number(body.players) || 0) - r.players);
      const changed = !this.rooms.has(r.name) || r.players !== Math.max(0, Number(body.players) || 0);
      r.pending.splice(0, grew);
      r.players = Math.max(0, Number(body.players) || 0);
      r.at = now;
      this.rooms.set(r.name, r);
      if (changed) this.save(); // the minute's "still here" report writes nothing
      return json({ ok: true });
    }
    if (url.pathname === '/rooms') return json({ rooms: [...this.rooms.values()].map(({ name, players, at }) => ({ name, players, at })) });
    if (url.pathname === '/now') {
      let players = 0;
      for (const [name, r] of this.live) { if (Date.now() - r.at > 180_000) this.live.delete(name); else players += r.players; }
      return json({ players, rooms: this.live.size, peak: this.peak.day === today() ? { players: this.peak.players, room: this.peak.room } : { players: 0, room: 0 } });
    }
    return json({ error: 'not found' }, 404);
  }
}
