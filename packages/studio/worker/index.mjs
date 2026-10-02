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
 *   /<game>/watch?room=        watch a live room from any player's view: the game itself, rendered by this browser
 *                              as a watcher that never takes a seat, with a strip of the players to switch between
 *                              (keys 1-9, A for Auto, O for the overview); no room: the busiest public room
 *                              (NETPLAY.md section 16; game.json "watch": "overview" or false narrows it)
 *   /<game>/__game/...         the game's own files (index.html gets HOMIE_NET)
 *   /<game>/__net?room=        the room's netplay socket (Table Durable Object)
 *   /<game>/__watch?room=      the room's facts, for the shell
 *   /<game>/api/lobby          which public room to join (Lobby Durable Object); ?server=<id>: a room of that server
 *   /<game>/api/watch          which public room to watch: the busiest one now (nothing is reserved)
 *   /<game>/servers/           the game's servers (worker/servers.mjs): named, lasting room pools with their own
 *                              policy (open, humans-only, hybrid, beginner) and door; /<game>/api/servers as JSON
 *   /<game>/s/<id>/            a server's page; /<game>/s/<id>/play its door, then the play page in its pool;
 *                              POST /<game>/s/<id>/home joins it, leaves it or makes it home (a signed-in player)
 *   /<game>/api/agent          an AI's seat (POST, Bearer agent pass; worker/agents.mjs): a room with people in it,
 *                              its ticket and socket, and the frame to load (NETPLAY.md section 17)
 *   /api/games, /api/rooms     the catalogue plus live counts; every public room playing now (/api/rooms may be
 *                              cached for 15 s)
 *   /__homie/..., /<game>/__homie/...   `not-a-homie`: the answer a game with Homie's arcade controls gets when it
 *                              knocks for a Homie box, so it stops knocking (a studio site is not a box)
 *   /.well-known/homie-studio.json   what the homie.rocks directory reads
 *   /games/<id>/source.json    a public game's source for remixing, with its credit and licence (worker/license.mjs)
 *   /media/<key>               a loose file in the studio's R2 (`media put`), with byte ranges
 *   /music/<slug>/<file>, /videos/<slug>/<file>   a song's or video's files: from the site's own files, or, for a
 *                              file `media move` put in the studio's R2 (the catalogue names its key), from R2 at the
 *                              same address, with byte ranges, HEAD, ETag and the site's own cache headers
 *   /api/stats                 the studio's numbers, for its owner only (a read key, or the owner's page session)
 *   /_studio/stats             the owner's private stats page (one-time sign-in link from `homie-studio stats link`)
 *   /_studio/office            the owner's back office: live rooms and who is in them, kick, mute, announce, close,
 *                              each game's launch state (private, invite-only beta, public), remix switch, room size
 *                              and invites (worker/office.mjs); /_studio/api/* is the same as JSON
 *   /<game>/invite             an invite code spent for this browser's pass to an invite-only game
 *   /_homie/site.js            the pages' one script
 *   /account/                  a player's account: a passkey, a name, their data (worker/players.mjs, saves/SAVES.md)
 *   /api/player/...            sign in and up, saves, lifetime stats and memorials (the game's saves bridge, via the
 *                              play shell), export and delete
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
 * The relay is the netplay contract's own room.mjs (NETPLAY.md v1 rev 7), run
 * unchanged inside the Table, so a game that plays in `homie-studio dev`
 * plays the same way here. A beginner server whose AI may talk also gets the
 * Table's own house guides (worker/agents.mjs HouseAgents), whose brains run
 * on the Table's alarm: Workers AI through the optional AI binding (deploy adds
 * it when a server uses it), or the owner's own key (secret HOMIE_BRAIN_KEY).
 */
import { NetRoom, WATCH_POLICIES } from './room.mjs';
import { ROOM_ID, badRoomPage, frameAncestors, noWatchPage, playPage, watchPage } from './pages.mjs';
import {
  PUBLIC_SERVER, SERVER_ID, homeOf, memberCounts, memberOf, noteMember, policyOf, pooledRoom, roomCode, roomServer, serverAccess, serverPassOf, serverView, serversOf,
  setMembership,
} from './servers.mjs';
import { BRAIN_BUDGET, HouseAgents, agentFacts, aiName, decodeFacts, encodeFacts, passById, passRefusal, sitRoute } from './agents.mjs';
import { talks } from './brain.mjs';
import { doorPage, serverPage, serversPage } from './site.mjs';
import { qrSvg } from './qr.mjs';
import { SEAT_MAX, perAddress, seatsOf } from './seats.mjs';
import {
  SITE_JS, atomFeed, creditsPage, customPage, gameCover, gameLanding, gamesPage, homePage, jsonFeed, mediaArt, mediaIndexPage,
  notFoundPage, postPage, postsPage, roomView, roomsPage, sectionsOf, songPage, videoPage, watchOf,
} from './site.mjs';
import { cookieValues, count, countVisit, counter, isQa, onlyOf, ownerAllowed, playedByGame, playedThisWeek, rangeOf, readStats, today } from './stats.mjs';
import { ownerRoutes } from './stats-page.mjs';
import { playerRoutes, players as playerAccounts } from './players.mjs';
import {
  accessOf, accountSub, gatePage, holders, isOwner, joinHolders, launchOf, regateArgs, officeRoutes, publicCatalogue, redeemInvite, remixOf, sameOrigin, seatsFor, settingsOf, ticketAllows,
  ticketFor, ticketSub, usePlayers, verifyControl,
} from './office.mjs';

// The back office knows the studio's player accounts: a signed-in player is named in the office and held by a kick on
// every device, and the owner's own account (`homie-studio players owner`) counts as the owner.
usePlayers(playerAccounts);
import { STUDIO_VERSION_TAG } from './version.mjs';
import { licenseOf, remixAllowed, remixRow } from './license.mjs';

export { SEAT_MAX } from './seats.mjs';
/** For a studio whose Worker has player accounts: hand their server API to the back office once (worker/office.mjs). */
export { usePlayers } from './office.mjs';
/** For a studio's own wrapper Worker: count its own pages the way the template counts its pages. */
export { countVisit } from './stats.mjs';
/** Players and cloud saves (saves/SAVES.md): `players.list`, `players.get`, `players.isOwner`… for the back office. */
export { players, cleanName } from './players.mjs';

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** A game's own files, framed by its play page: never x-frame-options DENY. */
const GAME_FILES = /^\/[a-z0-9][a-z0-9-]{0,39}\/__game(?:\/|$)/;
const MEDIA_FILE = /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|opus|wav|flac)$/i;
/** A browser's room key (random, kept in the play page's own storage) and a play ticket, as they may appear in an address. */
const BROWSER_KEY = /^[A-Za-z0-9_-]{16,43}$/;
const TICKET_TEXT = /^[a-z0-9]{6,12}\.[A-Za-z0-9_~-]{1,140}\.[A-Za-z0-9_-]{32}$/;

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

/*
 * THE SITE CLAIMS ITSELF IN THE DIRECTORY (0.10.0). The homie.rocks directory lists a studio only when its site
 * serves the claim the directory handed out for that exact address, which proves the studio controls the site.
 * Before 0.10.0 `homie-studio deploy` fetched the claim and stored it in D1 from the person's computer; a site built
 * by Cloudflare's Workers Builds has no such step. So the site asks for its own claim the first time its manifest
 * is read (by the directory publishing it, or `deploy` reading it once), for the address it is being read at, and
 * keeps it in its D1 (`meta`, `homie_claim:<origin>`).
 *
 * It never asks from a Preview (HOMIE_PREVIEW: a Preview is a branch under review, not the studio), from a studio
 * whose studio.json says `homie.directory: false`, or without its D1. A directory that does not answer is asked
 * again at most once a minute per address; the page answers without a claim meanwhile.
 */
const CLAIM = /^[a-f0-9]{16,128}$/;
const claimed = new Map();
const claimMissed = new Map();

async function storedClaim(env, origin) {
  if (!env.DB) return null;
  try {
    const rows = (await env.DB.prepare('SELECT key, value FROM meta WHERE key IN (?1, ?2, ?3)').bind(`homie_claim:${origin}`, 'homie_claim', `homie_repo:${origin}`).all()).results ?? [];
    const of = (k) => rows.find((r) => r.key === k)?.value ?? null;
    return { own: of(`homie_claim:${origin}`), older: of('homie_claim'), repo: of(`homie_repo:${origin}`) };
  } catch { return null; }
}

/*
 * THE STUDIO'S GITHUB REPOSITORY (HOMIE_REPO, set by `homie-studio deploy` from the studio's own git remote or
 * studio.json "github"; lib/repo.mjs). The site tells its directory which repository it is built from, with its
 * claim, so the Claude app's hand-off opens Claude Code on the studio's own repository. It is never put in a public
 * page: only the directory hears it, from this Worker (Cloudflare's CF-Worker header names the zone it runs on),
 * and it is said again only when it changes.
 */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const repoOf = (env) => { const r = String(env.HOMIE_REPO ?? '').trim(); return REPO.test(r) && r.toLowerCase() !== 'homie-rocks/homie' ? r : null; };
const repoSaid = new Map();

export function directoryOf(cat) {
  const d = cat?.studio?.directory;
  if (d === null || d === false) return null;
  const at = String(d ?? 'https://homie.rocks').replace(/\/+$/, '');
  try {
    const u = new URL(at);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) ? u.origin : null;
  } catch { return null; }
}

/** This address's claim: kept, else asked of the directory now (and kept), else an older studio's single claim. */
async function claimOf(env, cat, url) {
  const origin = url.origin;
  const repo = repoOf(env);
  if (claimed.has(origin) && (!repo || repoSaid.get(origin) === repo)) return claimed.get(origin);
  const kept = await storedClaim(env, origin);
  if (kept?.own && (!repo || kept.repo === repo)) { claimed.set(origin, kept.own); if (repo) repoSaid.set(origin, repo); return kept.own; }
  const directory = directoryOf(cat);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  const may = directory && env.DB && env.HOMIE_PREVIEW !== '1' && (url.protocol === 'https:' || (local && directory.startsWith('http://')))
    && Date.now() - (claimMissed.get(origin) ?? 0) > 60_000;
  if (may) {
    try {
      // Asked when there is no claim yet, or to say a repository the directory has not heard from this site.
      const res = await fetch(`${directory}/api/studio/claim?site=${encodeURIComponent(origin)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`, {
        headers: { accept: 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION_TAG} (site claim)` }, signal: AbortSignal.timeout(5000),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && CLAIM.test(String(body?.claim ?? ''))) {
        await env.DB.batch([
          env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)').bind(`homie_claim:${origin}`, body.claim),
          ...(repo ? [env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)').bind(`homie_repo:${origin}`, repo)] : []),
        ]);
        claimed.set(origin, body.claim);
        if (repo) repoSaid.set(origin, repo);
        return body.claim;
      }
    } catch { /* the directory is optional for a live site */ }
    claimMissed.set(origin, Date.now());
  }
  return kept?.own ?? kept?.older ?? null;
}

/** A copy of the public template nobody has named yet shows the name typed into Cloudflare's form (STUDIO_NAME). */
function named(cat, env) {
  if (!cat?.studio?.template || !env.STUDIO_NAME) return cat;
  return { ...cat, studio: { ...cat.studio, name: String(env.STUDIO_NAME).slice(0, 60) } };
}

/**
 * Every public room with people in it, per game (the Lobby's list), and the number playing per game. A room of a
 * server (section 17) says which, its policy, and how many AI are in it; a server that is not listed, closed, or has
 * a door is left out of the lists (its own page shows its rooms to whoever it lets in).
 */
async function roomsOf(env, games, { servers = null } = {}) {
  const rooms = [];
  const live = {};
  await Promise.all(games.map(async (g) => {
    let list = [];
    try { list = (await (await env.LOBBY.get(env.LOBBY.idFromName(g.id)).fetch('https://lobby/rooms')).json()).rooms ?? []; } catch { list = []; }
    const busy = list.filter((r) => (r.players || 0) > 0);
    live[g.id] = busy.reduce((n, r) => n + (r.players || 0), 0);
    const known = busy.some((r) => r.server && r.server !== 'public') ? (servers?.[g.id] ?? await serversOf(env, g).catch(() => [])) : [];
    for (const r of busy) {
      const sid = r.server ?? roomServer(r.name);
      const srv = sid === 'public' ? (known.find((x) => x.id === 'public') ?? PUBLIC_SERVER) : known.find((x) => x.id === sid);
      if (!srv || (sid !== 'public' && (!srv.listed || srv.state !== 'open' || srv.door !== 'open'))) continue;
      rooms.push(roomView(g, r, seatsOf(g), srv));
    }
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

/** Does an If-None-Match header name this ETag (or `*`)? Weak and strong forms compare alike for a GET. */
function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const bare = (t) => String(t).trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

/**
 * A file from the studio's R2 bucket, with byte ranges (206), HEAD, and If-None-Match (304).
 * `cache`: the Cache-Control it is served with. /media/<key> keeps its hour; a song or video served at its own
 * address (media move) gets exactly what the site's static files get, `public, max-age=0, must-revalidate` with an
 * ETag, so moving a file to R2 changes nothing a browser or a phone sees. `type`: the catalogue's type, for an
 * object stored without one.
 */
async function mediaObject(request, env, key, { cache = 'public, max-age=3600', type = null } = {}) {
  const range = request.headers.get('range');
  const inm = request.headers.get('if-none-match');
  const headOnly = request.method === 'HEAD';
  let head = null;
  if (range || inm || headOnly) {
    head = await env.MEDIA.head(key);
    if (!head) return new Response('not found', { status: 404 });
  }
  const base = (obj) => {
    const headers = new Headers();
    obj.writeHttpMetadata?.(headers);
    if (!headers.get('content-type') && type) headers.set('content-type', type);
    if (obj.httpEtag) headers.set('etag', obj.httpEtag);
    if (obj.uploaded) headers.set('last-modified', new Date(obj.uploaded).toUTCString());
    headers.set('cache-control', cache);
    headers.set('accept-ranges', 'bytes');
    return headers;
  };
  if (head && inm && etagMatches(inm, head.httpEtag)) return new Response(null, { status: 304, headers: base(head) });
  const r = head && range ? parseRange(range, head.size) : null;
  if (r?.unsatisfiable) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}`, 'accept-ranges': 'bytes' } });
  if (headOnly) {
    const headers = base(head);
    headers.set('content-length', String(head.size));
    return new Response(null, { headers });
  }
  const obj = await env.MEDIA.get(key, r ? { range: { offset: r.start, length: r.end - r.start + 1 } } : undefined);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = base(obj);
  if (r) {
    headers.set('content-range', `bytes ${r.start}-${r.end}/${head.size}`);
    headers.set('content-length', String(r.end - r.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

/** The same Cache-Control the site's static files are served with (Workers static assets' default). */
const ASSET_CACHE = 'public, max-age=0, must-revalidate';

/**
 * A song's or video's file that `media move` put in R2, by the address it always had (/music/<slug>/x.mp3,
 * /videos/<slug>/x.mp4): the catalogue names its key (`r2`). Only files the catalogue lists as public are served this
 * way, never any other key of the bucket.
 */
async function heldInR2(env, getCat, path) {
  if (!env.MEDIA) return null;
  const cat = await getCat();
  let want;
  try { want = decodeURIComponent(path); } catch { return null; }
  for (const e of [...(cat.songs ?? []), ...(cat.videos ?? [])]) {
    for (const f of e.files ?? []) {
      if (typeof f.r2 !== 'string' || !f.r2 || f.r2.startsWith('players/') || typeof f.url !== 'string') continue;
      let at;
      try { at = decodeURIComponent(f.url); } catch { continue; }
      if (at === want) return f;
    }
  }
  return null;
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

/**
 * The game's index.html with HOMIE_NET ahead of its modules, in the site's sandbox (an opaque origin). `agent`: the
 * frame was opened with an agent's ticket (section 17): the game plays as that AI, named "<label> · AI".
 */
async function gameDocument(request, env, url, game, meta, cat, { agent = null } = {}) {
  const asked = url.searchParams.get('room');
  // A room code the relay cannot use is refused here too, never swapped for another room.
  if (asked !== null && !ROOM_ID.test(asked)) return new Response('That room link does not work: a room code is 1 to 32 letters, digits, - or _.\n', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/index.html`));
  if (!res.ok) return notFoundPage(`No build of "${game}" on this site yet.`, cat);
  const room = asked ?? 'main';
  // A watcher (section 16): a screen that never takes a seat, following the player the watch page asks for.
  const policy = watchOf(meta);
  const watching = !agent && url.searchParams.get('watch') === '1';
  if (watching && policy === 'off') return new Response(`${meta?.name ?? game} cannot be watched; play it instead.\n`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const follow = /^(?:auto|overview|\d{1,2})$/.test(url.searchParams.get('follow') ?? '') ? url.searchParams.get('follow') : 'auto';
  const want = !agent && (watching || url.searchParams.get('want') === 'screen') ? 'screen' : 'play';
  const device = ['phone', 'desk', 'tv'].includes(url.searchParams.get('device')) ? url.searchParams.get('device') : undefined;
  const wsBase = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  // The browser's room key (b: what a kick holds out) and the play page's ticket (t: a game that is not public) ride
  // in the socket's address, which every netplay helper opens as it is given.
  const b = BROWSER_KEY.test(url.searchParams.get('b') ?? '') ? url.searchParams.get('b') : null;
  const t = TICKET_TEXT.test(url.searchParams.get('t') ?? '') ? url.searchParams.get('t') : null;
  const cfg = {
    v: 1,
    url: `${wsBase}/${game}/__net?room=${encodeURIComponent(room)}${b ? `&b=${b}` : ''}${t ? `&t=${encodeURIComponent(t)}` : ''}${watching ? '&w=1' : ''}`,
    room,
    ...(url.searchParams.get('k') ? { token: url.searchParams.get('k').slice(0, 128) } : {}),
    ...(agent ? { name: agent.name } : url.searchParams.get('name') ? { name: url.searchParams.get('name').slice(0, 24) } : {}),
    // An AI that runs the game itself (hands `self`): its hello says so; the relay knows it from its ticket anyway.
    ...(agent ? { agent: { hands: agent.hands, role: agent.role } } : {}),
    // The play page's "Quiet AI": this browser hides AI speech (the helper's `net.hushed`).
    ...(url.searchParams.get('hush') === '1' ? { hush: true } : {}),
    ...(device ? { device } : {}),
    want,
    ...(watching ? { watch: true, follow: /^\d+$/.test(follow) ? Number(follow) : follow, watchPolicy: policy } : {}),
    debug: url.searchParams.get('debug') === '1',
    ...(meta?.movement ? { movement: meta.movement } : {}),
    // game.json "saves": the play shell around this frame answers @homie-rocks/studio/saves (saves/SAVES.md).
    ...(meta?.saves && want === 'play' ? { saves: true } : {}),
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
  let pubP = null;
  // Every game (for a game's own pages and the owner's), and the public ones (every list, the rooms, the manifest).
  const getAll = () => (catP ??= catalogue(env, url.origin).then((cat) => named(cat, env)));
  const getCat = () => (pubP ??= Promise.all([getAll(), settingsOf(env)]).then(([cat, settings]) => publicCatalogue(cat, settings, env)));

  // "Connect to Claude" (the template's first-run band): the directory's setup page, for this site's address.
  if (path === '/_studio/connect' && read) {
    const directory = directoryOf(await getCat());
    if (!directory || env.HOMIE_PREVIEW === '1') return json({ ok: false, error: 'no-directory', message: 'This studio is not connected to a directory.' }, 404);
    return Response.redirect(`${directory}/studio/setup/connect?site=${encodeURIComponent(url.origin)}`, 302);
  }
  if (path.startsWith('/_studio/')) return (await officeRoutes(request, env, url, { catalogueOf: getAll })) ?? ownerRoutes(request, env, url, { catalogueOf: getAll });
  if (path === '/__homie' || path.startsWith('/__homie/')) return notAHomie(request);
  if (path.startsWith('/api/player/') || path === '/account' || path === '/account/' || path === '/_homie/account.js') return playerRoutes(request, env, ctx, url, { catalogueOf: getCat });
  if (path === '/_homie/site.js') return new Response(SITE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': url.searchParams.get('v') === STUDIO_VERSION_TAG ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  if (path === '/api/stats/beat' && request.method === 'POST') return mediaBeat(request, env, ctx, url);
  if (path === '/api/stats') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);
    if (!(await ownerAllowed(request, env, { kinds: ['read', 'office'] }))) {
      return json({ ok: false, error: 'owner-only', message: 'The studio\'s numbers are for its owner. In the studio folder: `npx --no-install homie-studio stats` prints them; `npx --no-install homie-studio stats key` gives a read key for the Homie MCP tool studio_stats.' }, 401, { 'www-authenticate': 'Bearer' });
    }
    const cat = await getAll();
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
      claim: await claimOf(env, cat, url),
      // What is deployed: the commit, when, and the marks of the newest changes (a merged pull request is live when
      // its mark is here). A Preview says it is one.
      ...(cat.studio?.build ? { build: { commit: cat.studio.build.commit ?? null, branch: cat.studio.build.branch ?? null, at: cat.studio.build.at ?? null, changes: (cat.studio.build.changes ?? []).slice(0, 50), ...(env.HOMIE_PREVIEW === '1' ? { preview: true } : {}) } } : {}),
      // Only the public games (a private or invite-only game leaves the directory the next time it reads this).
      games: await Promise.all((cat.games ?? []).map(async (g) => {
        // The card picture is the landing's hero still (what the landing leads with), else the game's cover.
        const cover = gameCover(g);
        // Open to remix: the owner's switch is on and the licence the owner picked allows it (worker/license.mjs).
        const license = licenseOf(g.license);
        const remix = remixOf(g, await settingsOf(env)) && remixAllowed(license);
        const lineage = remixRow(g.remixOf);
        return {
          id: g.id, name: g.name, blurb: g.blurb ?? '', players: g.players ?? null, roundSeconds: g.roundSeconds ?? null,
          page: `${url.origin}/${g.id}/`, play: `${url.origin}/${g.id}/play`, cover: cover ? (cover.startsWith('/') ? `${url.origin}${cover}` : cover) : null,
          // The owner's remix switch (0.13.0): whether the source is open for other studios to remix, and where.
          remix, ...(remix ? { source: `${url.origin}/games/${g.id}/source.json` } : {}), license,
          // A remix names what it is a remix of (its game.json `remixOf`): "Remix of <name> by <studio>", linked.
          ...(lineage ? { remixOf: lineage } : {}),
          // Shared only with `stats.share`: this game's own Play presses and rounds with people, this week.
          ...(byGame ? { played: byGame[g.id] ?? { days: 7, plays: 0, rounds: 0 } } : {}),
        };
      })),
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
    // A player's large saves live under players/ in the same bucket: never served here (saves/SAVES.md).
    if (!key || key.includes('..') || key.startsWith('players/')) return new Response('not found', { status: 404 });
    return mediaObject(request, env, key);
  }
  if (path === '/posts/feed.xml' || path === '/posts/feed.json') {
    const cat = await getCat();
    if (!(cat.posts ?? []).length) return notFoundPage('This studio has no posts yet.', cat);
    const posts = await postsOf(env, url.origin);
    return path.endsWith('.xml') ? atomFeed(cat, posts, url.origin) : jsonFeed(cat, posts, url.origin);
  }

  // A game's remix source is served while the game is public and its owner has not withdrawn it (the remix switch),
  // with who made it as this site says it (the studio's name, the game's name and page here) and the owner's licence
  // (worker/license.mjs): the remix flow credits the first and refuses a game whose licence says no remix.
  const src = /^\/games\/([a-z0-9][a-z0-9-]{0,39})\/source\.json$/.exec(path);
  if (src) {
    const all = await getAll();
    const meta = (all.games ?? []).find((g) => g.id === src[1]);
    if (meta) {
      const settings = await settingsOf(env, { fresh: true });
      if (launchOf(meta, settings, env) !== 'public' || !remixOf(meta, settings)) return json({ ok: false, error: 'not-shared', message: 'This game\'s source is not shared for remixing.' }, 404);
      if (request.method === 'GET') {
        const res = await env.ASSETS.fetch(new Request(`${url.origin}${path}`));
        let body = null;
        if (res.ok) { try { body = await res.json(); } catch { body = null; } }
        if (body?.kind === 'homie-game-source' && body.files && typeof body.files === 'object') {
          const credit = { studio: all.studio?.name ?? body.credit?.studio ?? null, game: meta.name ?? body.credit?.game ?? meta.id, page: `${url.origin}/${meta.id}/` };
          const { files, ...head } = body;
          return json({ ...head, credit, license: licenseOf(body.license ?? meta.license), files }, 200, { 'access-control-allow-origin': '*' });
        }
      }
    }
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
    if (file.status === 404) {
      // Not in the site's files: a song's or video's file that lives in the studio's R2 (media move), same address.
      const held = await heldInR2(env, getCat, path);
      if (held) return mediaObject(request, env, held.r2, { cache: ASSET_CACHE, type: held.type ?? null });
      return notFoundPage('Nothing here.', cat);
    }
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
    const all = await getAll();
    const meta = (all.games ?? []).find((g) => g.id === game);
    if (!meta) return fallback(request, env, url, getCat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/`, 301);
    const cat = await getCat();
    let sub = parts.slice(1).join('/');
    // Read now, not from a Worker instance's 5 s cache: a game the owner just made private shuts at once everywhere.
    const settings = await settingsOf(env, { fresh: true });
    // The owner's launch state and room size (worker/office.mjs): a private or invite-only game lets in only those
    // with access, and the owner may have made its rooms smaller than the game's own seats.
    const launch = launchOf(meta, settings, env);
    const max = seatsFor(meta, settings);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName(game));
    if (sub === 'invite') return redeemInvite(request, env, url, cat, meta, settings);

    // SERVERS (worker/servers.mjs, NETPLAY.md section 17): which server a request is for — its path (/s/<id>/), its
    // room (s-<id>-<n>; pub-N and any named room are the public server's), or for a bare Play the signed-in player's
    // home server, else public. Every door follows the game's launch state first, as it always did.
    const servers = await serversOf(env, meta);
    const serverById = (id) => servers.find((x) => x.id === id) ?? null;
    const pathServer = /^s\/([a-z0-9][a-z0-9-]{1,19})(?:\/(play|tv|home))?\/?$/.exec(sub);
    if (/^s(?:\/|$)/.test(sub) && !pathServer) return notFoundPage(`Nothing here in ${meta.name}.`, cat);
    if (pathServer && (!serverById(pathServer[1]) || pathServer[1] === 'public' || serverById(pathServer[1]).state === 'archived')) return notFoundPage(`${meta.name} has no server called "${pathServer[1]}".`, cat);
    if (pathServer && !pathServer[2] && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/s/${pathServer[1]}/${url.search}`, 301);
    const policyFor = (srv, named = false) => policyOf(srv, { seats: max, named });
    const humanSeats = (pol) => Math.max(1, max - (pol.aiSeats + pol.guides));
    const askedRoom = url.searchParams.get('room');
    if (pathServer) sub = pathServer[2] === 'play' ? 'play' : pathServer[2] === 'tv' ? 'tv' : pathServer[2] === 'home' ? 's-home' : 's-page';

    const doorSubs = ['', 'live', 'credits', 'tv', 'play', 'watch', 'api/lobby', 'api/watch', 'servers', 'api/servers', 's-page', 's-home'];
    const door = launch !== 'public' && doorSubs.includes(sub) ? await accessOf(request, env, game, launch) : { ok: true, sub: null, owner: false };
    const shut = () => gatePage(cat, meta, launch, { code: url.searchParams.get('invite') ?? '' });
    /** A page's own door to a server: who this browser is (owner, invited, signed in) and whether it may come in. */
    const pageDoor = async (srv, { watching = false } = {}) => {
      const owner = door.owner || (launch === 'public' && await isOwner(request, env));
      const acct = await accountSub(request, env);
      const sPass = srv && srv.door === 'invite' && !owner ? await serverPassOf(request, env, game, srv.id, cookieValues) : null;
      const list = [owner ? 'o' : null, door.sub, sPass ? `i-${sPass.invite}` : null, acct].filter(Boolean).flatMap(holders);
      const access = srv ? await serverAccess(env, { game, server: srv, holders: list, watching }) : { ok: true };
      return { ...access, owner, acct, holder: joinHolders(door.sub ?? (owner ? 'o' : null), sPass ? `i-${sPass.invite}` : null, acct) };
    };
    /** The public server is hidden (closed by its owner): Play shows the other servers instead, and named rooms are off. */
    const publicHidden = () => (serverById('public') ?? PUBLIC_SERVER).state !== 'open';

    if (sub === '') {
      if (!door.ok) return shut();
      await countVisit(request, env, ctx, game);
      shareDaily(cat, url, ctx);
      const { rooms, live } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      const band = servers.some((x) => x.id !== 'public' && x.listed && x.state === 'open') ? await serverLive(env, meta, servers, url.origin, lobby) : null;
      return gameLanding(cat, meta, { origin: url.origin, rooms, playing: live[game] ?? 0, week, remix: launch === 'public' && remixOf(meta, settings), servers: band });
    }
    if (sub === 'live') {
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const { rooms, live } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      const week = cat.studio?.stats?.share ? await weekOf(env, game) : null;
      // The same shape the house brands' landings read (counted, playing, waiting, road), plus the rooms.
      return json({ ok: true, game, counted: true, playing: live[game] ?? 0, waiting: 0, max, rooms, road: { seats: 'any', start: 'now', room: launch === 'public' ? 'public' : launch, big: true }, ...(week ? { week } : {}) }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'credits') {
      if (!door.ok) return shut();
      let texts = [];
      try { const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/_landing/credits.json`)); if (res.ok) texts = (await res.json()).texts ?? []; } catch { texts = []; }
      if (!texts.length) return notFoundPage(`${meta.name} has no licence texts to show; its credits are on its page.`, cat);
      return creditsPage(cat, meta, texts, { origin: url.origin });
    }
    if (sub === 'servers') {
      if (!door.ok) return shut();
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/servers/`, 301);
      await countVisit(request, env, ctx, `${game}/servers`);
      return serversPage(cat, meta, { origin: url.origin, servers: await serverLive(env, meta, servers, url.origin, lobby), hidden: publicHidden() });
    }
    if (sub === 'api/servers') {
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const list = (await serverLive(env, meta, servers, url.origin, lobby)).filter((x) => x.id === 'public' || (x.listed && x.state === 'open'));
      return json({ ok: true, game, servers: list }, 200, { 'cache-control': 'public, max-age=15' });
    }
    if (sub === 's-page') {
      if (!door.ok) return shut();
      const srv = serverById(pathServer[1]);
      const d = await pageDoor(srv);
      const pid = d.acct?.startsWith('p-') ? d.acct.slice(2) : null;
      const member = pid ? await memberOf(env, game, srv.id, pid) : null;
      await countVisit(request, env, ctx, `${game}/s/${srv.id}`);
      const [row] = await serverLive(env, meta, [srv], url.origin, lobby);
      const { rooms } = await roomsOf(env, [meta], { servers: { [game]: servers } });
      return serverPage(cat, meta, row, { origin: url.origin, rooms: rooms.filter((r) => r.server?.id === srv.id), door: d, member, signedIn: Boolean(pid) });
    }
    if (sub === 's-home') {
      // Join this server, leave it, or make it home: the signed-in player's own choice (a same-origin JSON POST).
      if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin' }, 403);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      const srv = serverById(pathServer[1]);
      const acct = await accountSub(request, env);
      if (!acct?.startsWith('p-')) return json({ ok: false, error: 'sign-in', message: 'Sign in to the studio first (your account page).' }, 401);
      let body = {};
      try { body = JSON.parse((await request.text()) || '{}'); } catch { return json({ ok: false, error: 'json' }, 400); }
      const d = await pageDoor(srv);
      if (body.join !== false && !d.ok) return json({ ok: false, error: d.why, message: 'This server\'s door does not let you in.' }, 403);
      try { return json(await setMembership(env, game, srv.id, acct.slice(2), { join: body.join !== false, home: body.home === true })); } catch { return json({ ok: false, error: 'not-migrated', message: 'This studio\'s database has no servers yet (migration 0006).' }, 503); }
    }
    if (sub === 'tv' || sub === 'play') {
      const screen = sub === 'tv' || url.searchParams.get('screen') === '1';
      const asked = askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { screen });
      if (!door.ok) return shut();
      // Which server: the path's, the room's, else (Play) the player's home server, else public.
      let srv = pathServer ? serverById(pathServer[1]) : asked !== null ? serverById(roomServer(asked)) : null;
      if (asked !== null && !srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const named = asked !== null && !pooledRoom(asked);
      if (!srv) {
        const acct = await accountSub(request, env);
        const home = acct?.startsWith('p-') ? await homeOf(env, game, acct.slice(2)) : null;
        const h = home ? serverById(home) : null;
        srv = h && h.state === 'open' ? h : serverById('public') ?? PUBLIC_SERVER;
      }
      const d = await pageDoor(srv);
      // The owner hid the public server: Play shows the servers to pick from, and a named room is off (owner aside).
      if (srv.id === 'public' && publicHidden() && !d.owner) {
        if (named) return doorPage(cat, meta, srv, { why: 'closed' });
        return serversPage(cat, meta, { origin: url.origin, servers: await serverLive(env, meta, servers, url.origin, lobby), hidden: true, pick: true });
      }
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, days: d.days, origin: url.origin, next: `${url.pathname}${url.search}`, code: url.searchParams.get('invite') ?? '' });
      if (d.acct?.startsWith('p-') && srv.id !== 'public') ctx?.waitUntil?.(noteMember(env, game, srv.id, d.acct.slice(2)));
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      const pol = policyFor(srv, named);
      const server = srv.id === 'public' && !pol.server ? null : { ...serverView(srv, { origin: url.origin, game }), mentor: Boolean(d.mentor) };
      if (screen) {
        await countVisit(request, env, ctx, game, 'screen');
        // The big screen picks its room now, so the QR it shows puts every phone in that same room.
        let room = asked;
        if (!room) {
          try { room = (await (await lobby().fetch(`https://lobby/join?max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}`, { method: 'POST' })).json()).room ?? null; } catch { room = null; }
        }
        const joinUrl = `${url.origin}/${game}/play${room ? `?room=${encodeURIComponent(room)}` : ''}`;
        let qr = null;
        try { qr = qrSvg(joinUrl, { title: `Join ${meta.name ?? game}` }); } catch { /* too long for a QR: the address shows as text */ }
        return playPage(cat, meta, { screen: true, joinUrl, qr, room, ticket, owner: d.owner, launch, server });
      }
      await countVisit(request, env, ctx, game, 'play');
      shareDaily(cat, url, ctx);
      return playPage(cat, meta, { ticket, owner: d.owner, launch, server });
    }
    if (sub === 'watch') {
      // The same door as Play: a game that is private or an invite-only beta is watched only by whoever may play it.
      const asked = askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { watch: true });
      if (!door.ok) return shut();
      const policy = watchOf(meta);
      if (policy === 'off') return noWatchPage(cat, meta);
      // A server's door is its watch door too (an invite or an account); a beginner server is watched by anyone.
      const srv = asked !== null ? serverById(roomServer(asked)) : serverById('public') ?? PUBLIC_SERVER;
      if (!srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const d = await pageDoor(srv, { watching: true });
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, origin: url.origin, next: `${url.pathname}${url.search}`, watch: true });
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      await countVisit(request, env, ctx, game, 'watch');
      shareDaily(cat, url, ctx);
      return watchPage(cat, meta, { room: asked, ticket, policy });
    }
    if (sub === 'api/watch') {
      if (!door.ok || watchOf(meta) === 'off') return json({ ok: false, error: 'not-found' }, 404);
      // The busiest room now, to watch, of a server anyone may watch; nothing is reserved (a watcher takes no seat).
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pools = servers.filter((x) => x.state === 'open' && x.door === 'open').map((x) => x.id).join(',');
      let best = null;
      try { best = await (await lobby().fetch(`https://lobby/busiest?pools=${encodeURIComponent(pools)}${not ? `&not=${encodeURIComponent(not)}` : ''}`)).json(); } catch { best = null; }
      return json({ ok: true, game, room: best?.room ?? null, players: best?.players ?? 0, max }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'api/lobby') {
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      // ?server=<id>: a room of that server's pool (its door first); none: public. Strangers never meet across servers.
      const sid = url.searchParams.get('server') ?? 'public';
      const srv = SERVER_ID.test(sid) || sid === 'public' ? serverById(sid) : null;
      if (!srv) return json({ ok: false, error: 'no-server', message: `${meta.name} has no server called ${String(sid).slice(0, 24)}.` }, 404);
      if (srv.id === 'public' && publicHidden() && !(await pageDoor(srv)).owner) return json({ ok: false, error: 'closed', message: 'Pick a server to play on.' }, 403);
      const d = await pageDoor(srv);
      if (!d.ok) return json({ ok: false, error: d.why, message: 'This server\'s door does not let you in.' }, 403);
      // A browser held out of a room asks for any other (`not`), so the Lobby never sends it back there.
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pol = policyFor(srv);
      return lobby().fetch(`https://lobby/join?max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${not ? `&not=${encodeURIComponent(not)}` : ''}`, { method: 'POST' });
    }
    if (sub === 'api/agent') {
      // An AI's seat (worker/agents.mjs): its pass, the server's policy, a room with people in it, a ticket.
      return sitRoute(request, env, url, {
        meta, launch,
        serverOf: (id) => serverById(id),
        policyOf: (srv) => policyFor(srv),
        ticketFor: (holder) => ticketFor(env, game, holder),
        join: async (srv, pol) => {
          try {
            const reserve = pol.aiSeats + pol.guides;
            const r = await (await lobby().fetch(`https://lobby/join?max=${max}&server=${srv.id}&agent=1&ai=${reserve}`, { method: 'POST' })).json();
            return r.room ?? null;
          } catch { return null; }
        },
      });
    }
    if (sub === '__net' || sub === '__watch') {
      if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const room = url.searchParams.get('room') || 'main';
      if (!ROOM_ID.test(room)) return new Response('bad room', { status: 400 });
      // Who the ticket names: the door of a game that is not public, and in any game a signed-in player's account.
      const who = url.searchParams.get('t') ? await ticketSub(env, game, url.searchParams.get('t')) : null;
      if (launch !== 'public' && !(await ticketAllows(env, who, launch))) return new Response('this game is not open to you', { status: 403 });
      const b = BROWSER_KEY.test(url.searchParams.get('b') ?? '') ? url.searchParams.get('b') : '';
      // A watcher's socket (section 16): what the game lets watchers see goes with every socket, so a helper that only
      // says `watch` in its hello is held to it too; a game that cannot be watched refuses a watch door's socket here.
      const policy = watchOf(meta);
      const w = sub === '__net' && url.searchParams.get('w') === '1';
      if (w && policy === 'off') return new Response('this game cannot be watched', { status: 403 });
      // The room's server (section 17): its door for a person, and the policy the room applies. An AI's ticket
      // (a-<pass>) is checked against its pass and the server: a humans-only server refuses it here and again at the relay.
      const srv = serverById(roomServer(room));
      if (!srv) return new Response('this server does not exist', { status: 404 });
      const parts = holders(who);
      const agentPart = parts.find((x) => x.startsWith('a-'));
      const pol = policyFor(srv, !pooledRoom(room));
      let ag = null;
      if (agentPart && sub === '__net') {
        const pass = await passById(env, agentPart.slice(2));
        const why = passRefusal(pass, { game, server: srv.id, policy: pol, launch });
        if (why) return new Response(why.error === 'agents-off' ? 'This server is for humans only\n' : `${why.message}\n`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        ag = { ...agentFacts(pass), name: aiName(pass.label) };
      } else if (srv.state !== 'open' || srv.door !== 'open' || (srv.policy === 'beginner' && !w && sub === '__net')) {
        const access = await serverAccess(env, { game, server: srv, holders: parts, watching: w || sub === '__watch' });
        if (!access.ok) return new Response('this server is not open to you', { status: 403 });
      }
      const stub = env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
      const target = `https://table/${sub}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}${b ? `&b=${b}` : ''}${who ? `&via=${encodeURIComponent(who)}` : ''}${sub === '__net' ? `&wp=${policy}${w ? '&w=1' : ''}` : ''}&pol=${encodeFacts(pol)}${ag ? `&ag=${encodeFacts(ag)}` : ''}`;
      return stub.fetch(new Request(target, request));
    }
    // The same knock, relative to the game's own page: the same answer (see notAHomie).
    if (sub === '__homie' || sub.startsWith('__homie/')) return notAHomie(request);
    if (sub === '__game' || sub === '__game/' || sub === '__game/index.html') {
      const who = await ticketSub(env, game, url.searchParams.get('t'));
      if (launch !== 'public' && !(await ticketAllows(env, who, launch))) return new Response('This game is not open to you.\n', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      // An agent's frame (hands `self`): the game plays as that AI.
      const agentPart = holders(who).find((x) => x.startsWith('a-'));
      const pass = agentPart ? await passById(env, agentPart.slice(2)) : null;
      return gameDocument(request, env, url, game, meta, cat, { agent: pass?.live ? { name: aiName(pass.label), hands: pass.hands, role: pass.role } : null });
    }
    if (sub.startsWith('__game/')) return gameAsset(request, env, url, game, sub.slice('__game/'.length));
  }
  return fallback(request, env, url, getCat);
}

/**
 * A game's servers with what is happening on them now (the Lobby's rooms by server, one request) and how many
 * belong to each: the landing's Servers band, /<game>/servers/, a server's page and /<game>/api/servers.
 */
async function serverLive(env, meta, servers, origin, lobby) {
  let list = [];
  try { list = (await (await lobby().fetch('https://lobby/rooms')).json()).rooms ?? []; } catch { list = []; }
  const by = {};
  for (const r of list) {
    if (!(r.players > 0)) continue;
    const sid = r.server ?? roomServer(r.name);
    const b = (by[sid] ??= { playing: 0, ai: 0, rooms: 0 });
    b.playing += r.players; b.ai += Number(r.ai ?? r.agents ?? 0) || 0; b.rooms += 1;
  }
  const members = env.DB ? await memberCounts(env, meta.id) : {};
  return servers.map((s) => ({ ...serverView(s, { origin, game: meta.id }), playing: by[s.id]?.playing ?? 0, ai: by[s.id]?.ai ?? 0, live: by[s.id]?.rooms ?? 0, members: members[s.id] ?? 0 }));
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
  if (asset.status === 404) {
    // A manifest file outside music/ and videos/ that media move put in R2 keeps its address too.
    const held = (request.method === 'GET' || request.method === 'HEAD') ? await heldInR2(env, getCat, url.pathname) : null;
    if (held) return mediaObject(request, env, held.r2, { cache: ASSET_CACHE, type: held.type ?? null });
    return notFoundPage('Nothing here.', await getCat());
  }
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
    /** The owner's holds, banner and closed door (they outlive an empty room), and the controls already used. */
    this.officeSaved = null;
    this.seen = new Map();
    /** Revision 7: the game's vocabulary (agents.json, read once from the build), and the room's house guides. */
    this.vocabRead = null;
    this.house = null;
    /** The AI brains' day (worker/agents.mjs): what the studio allows a day and has used, and what is not counted yet. */
    this.brainDay = null;
    this.brainCap = { neurons: BRAIN_BUDGET.neurons, micros: BRAIN_BUDGET.usd * 1e6 };
    this.brainUsed = { neurons: 0, micros: 0 };
    this.brainPending = { calls: {}, neurons: 0, micros: 0 };
    this.brainReadAt = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.saved = (await ctx.storage.get('net')) ?? null;
      this.recorded = (await ctx.storage.get('recorded')) ?? 0;
      this.officeSaved = (await ctx.storage.get('office')) ?? null;
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
    if (this.officeSaved) this.room.restoreOffice(this.officeSaved);
    this.vocabRead = this.readVocab(game).catch(() => false);
    return this.room;
  }

  /** The game's agents.json from the build (the only words an AI in this room may say), once. */
  async readVocab(game) {
    if (!this.env.ASSETS || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(game ?? ''))) return false;
    const res = await this.env.ASSETS.fetch(new Request(`https://assets.local/games/${game}/agents.json`));
    if (!res.ok) return false;
    const ok = this.room.setVocabulary(await res.json());
    if (ok) this.syncHouse();
    return ok;
  }

  /**
   * The room's house guides (worker/agents.mjs): seated while the server's AI may talk, the game has a vocabulary and a
   * person is playing; stood up otherwise. Called on the 1 s beat and whenever the policy changes. No brain runs here:
   * decisions run on the alarm.
   */
  syncHouse() {
    const room = this.room;
    if (!room) return;
    if (!this.house) {
      if (!talks(room.policy) || !room.vocab || !(room.policy.guides > 0)) return;
      this.house = new HouseAgents({
        room, env: this.env,
        setAlarm: (at) => { this.ctx.storage.setAlarm(at).catch(() => {}); },
        budget: { left: (kind) => this.brainCap[kind] - this.brainUsed[kind], spend: (c) => this.brainSpend(c) },
        log: (line) => { try { console.log(JSON.stringify(line)); } catch { /* no console */ } },
      });
      this.ctx.waitUntil(this.readBrainDay().catch(() => {}));
    }
    this.house.sync();
  }

  /** What the studio allows its AI brains a day (meta `brain_budget`) and has used today (stats_daily), all games. */
  async readBrainDay() {
    const db = this.env.DB;
    if (!db) return;
    const day = today();
    try {
      const b = JSON.parse((await db.prepare("SELECT value FROM meta WHERE key = 'brain_budget'").first())?.value ?? 'null');
      if (b && Number.isFinite(Number(b.neurons))) this.brainCap.neurons = Math.max(0, Number(b.neurons));
      if (b && Number.isFinite(Number(b.usd))) this.brainCap.micros = Math.max(0, Number(b.usd)) * 1e6;
    } catch { /* the defaults */ }
    try {
      const { results } = await db.prepare("SELECT metric, SUM(n) AS n FROM stats_daily WHERE day = ?1 AND metric IN ('brain-neurons', 'brain-microdollars') GROUP BY metric").bind(day).all();
      const used = { neurons: 0, micros: 0 };
      for (const r of results ?? []) used[r.metric === 'brain-neurons' ? 'neurons' : 'micros'] = Number(r.n) || 0;
      // What this room spent and has not written yet is added on top.
      this.brainUsed = { neurons: used.neurons + this.brainPending.neurons, micros: used.micros + this.brainPending.micros };
    } catch { /* before migration 0002: nothing used */ }
    this.brainDay = day;
    this.brainReadAt = Date.now();
  }

  brainSpend(c) {
    if (this.brainDay && this.brainDay !== today()) { this.brainUsed = { neurons: 0, micros: 0 }; this.brainDay = today(); }
    this.brainUsed.neurons += c.neurons ?? 0;
    this.brainUsed.micros += c.micros ?? 0;
    this.brainPending.neurons += c.neurons ?? 0;
    this.brainPending.micros += c.micros ?? 0;
    const k = c.provider ?? 'script';
    this.brainPending.calls[k] = (this.brainPending.calls[k] ?? 0) + 1;
  }

  /**
   * The day's brain counters into D1 (stats_daily: brain-calls by provider, brain-neurons, brain-microdollars), and the
   * day's budget and usage read again (an owner's new budget, other rooms' use): at most once a minute, on the alarm.
   */
  async flushBrain(force = false) {
    const p = this.brainPending;
    if (!this.env.DB || (!force && Date.now() - this.brainReadAt < 60_000)) return;
    if (!Object.keys(p.calls).length && p.neurons < 1 && p.micros < 1) { await this.readBrainDay(); return; }
    const neurons = Math.floor(p.neurons);
    const micros = Math.floor(p.micros);
    const rows = [
      ...Object.entries(p.calls).map(([source, n]) => counter(this.env, { metric: 'brain-calls', subject: this.game ?? '', source, n })),
      neurons ? counter(this.env, { metric: 'brain-neurons', subject: this.game ?? '', n: neurons }) : null,
      micros ? counter(this.env, { metric: 'brain-microdollars', subject: this.game ?? '', n: micros }) : null,
    ].filter(Boolean);
    this.brainPending = { calls: {}, neurons: p.neurons - neurons, micros: p.micros - micros };
    if (rows.length) await this.env.DB.batch(rows).catch(() => {});
    await this.readBrainDay();
  }

  /** The alarm: the house guides' brains decide (worker/agents.mjs), then the day's usage is written. */
  async alarm() {
    // A brain that throws never takes the room with it: the alarm is not retried, the guides answer from the floor.
    try { if (this.house) await this.house.onAlarm(); } catch (error) { try { console.log(JSON.stringify({ ev: 'brain-alarm-failed', room: this.code, error: String(error?.stack ?? error).slice(0, 400) })); } catch { /* no console */ } }
    try { await this.flushBrain(); } catch { /* counted next time */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const game = url.searchParams.get('game');
    const code = url.searchParams.get('room');
    const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
    const room = this.roomFor(game, code, max);
    // The back office (worker/office.mjs), from the studio's Worker only: the room as its owner sees it, and the
    // owner's signed controls, which this room verifies before it applies one (NETPLAY.md section 15).
    if (url.pathname === '/__facts') return json({ ...room.officeFacts(), ...(this.house ? { brains: this.house.facts() } : {}) });
    if (url.pathname === '/__office') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why) return json({ ok: false, error: 'refused', why }, 403);
      const res = room.control(ctl.op, ctl.args && typeof ctl.args === 'object' ? ctl.args : {});
      // AI talk turned off (a policy) or a guide kicked: the house guides follow at once.
      if (this.house) this.house.sync();
      await this.ctx.storage.put('office', room.officeSaved()).catch(() => {});
      if (ctl.op === 'close' && res.ok) this.tellLobby({ closed: ctl.args?.reopen ? 0 : res.until });
      this.report();
      return json(res);
    }
    // The owner's room size: a room already open takes it from the next visitor on.
    if (room.seatCap !== max) room.setSeats(max, perAddress(max));
    // The room's policy (section 17), composed by the Worker for every socket: a newer one than the room's applies.
    const pol = decodeFacts(url.searchParams.get('pol'));
    if (pol) room.setPolicy(pol);
    if (this.house) this.house.sync();
    const agent = decodeFacts(url.searchParams.get('ag'));
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const via = url.searchParams.get('via');
    const conn = {
      ip: request.headers.get('cf-connecting-ip'),
      // The browser's room key (what a kick holds out), and who the play page's ticket named (o, i-<invite>, p-<player>).
      browser: url.searchParams.get('b') || null,
      via: via || null,
      player: holders(via).find((p) => p.startsWith('p-'))?.slice(2) ?? null,
      // A socket opened through the game's watch door, and what the game lets watchers see (section 16).
      watch: url.searchParams.get('w') === '1',
      // An AI with a pass the Worker verified (section 17): its pass, role, hands and name. Only the Worker sets it.
      ...(agent && typeof agent === 'object' && url.pathname === '/__net' ? { agent } : {}),
      watchPolicy: WATCH_POLICIES.includes(url.searchParams.get('wp')) ? url.searchParams.get('wp') : 'follow',
      // House QA and `homie-studio check` mark their browsers; their rooms, rounds and peaks are not the studio's numbers.
      qa: isQa(request),
      send: (text) => { try { server.send(text); } catch { /* closed */ } },
      close: (c, r) => { try { server.close(c, r); } catch { /* closed */ } },
      buffered: () => 0,
    };
    if (url.pathname === '/__watch') {
      const w = room.watch(conn);
      // The play page's vote card speaks on this socket (section 17); nothing else it says is read.
      server.addEventListener('message', (e) => { if (typeof e.data === 'string') w.onMessage(e.data); });
      server.addEventListener('close', () => w.onClose());
      server.addEventListener('error', () => w.onClose());
    } else {
      const h = room.attach(conn);
      // A room is OPENED when the first seat is taken in an empty one (a room restored after a deploy keeps its
      // seats, so it is not counted twice). One counter write per room.
      const fresh = room.seats.size === 0;
      server.addEventListener('message', (e) => {
        h.onMessage(typeof e.data === 'string' ? e.data : '');
        // A newcomer: the Lobby hears of the room at once, so the owner's office (and a launch change) never misses it.
        if (typeof e.data === 'string' && e.data.startsWith('{"t":"hello"')) this.report();
        if (fresh && !this.openCounted && room.seats.size > 0) {
          this.openCounted = true;
          if (conn.qa) return;
          this.ctx.waitUntil(count(this.env, null, { metric: 'room', subject: this.game ?? '', source: /^pub-\d+$/.test(this.code ?? '') ? 'public' : 'named' }));
        }
      });
      // An AI's time in a seat, counted once as it leaves (stats `agent-minutes`; never for house QA).
      const left = () => {
        const c = room.clients.get(h.id);
        if (c?.agent && c.helloed && c.seat !== null && !conn.qa) {
          const minutes = Math.round((Date.now() - c.joinedAt) / 60_000);
          if (minutes > 0) this.ctx.waitUntil(count(this.env, null, { metric: 'agent-minutes', subject: this.game ?? '', source: c.agent.role, n: minutes }).catch(() => {}));
        }
        h.onClose();
        this.report();
      };
      server.addEventListener('close', left);
      server.addEventListener('error', left);
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
      // A room that just opened reads its game's launch state once: a change made in the moment it opened (before the
      // Lobby knew of it) still reaches it, after the current round as always.
      if (room.openedAt && this.launchReadFor !== room.openedAt) { this.launchReadFor = room.openedAt; this.ctx.waitUntil(this.rereadLaunch().catch(() => {})); }
      // A launch change the room applied by itself (after its round): its stored state says so too.
      if (room.officeDirty) { room.officeDirty = false; this.ctx.storage.put('office', room.officeSaved()).catch(() => {}); }
      n += 1;
      if (n % 4 === 0) { room.tellWatchers(); this.report(); this.recordRound(); this.syncHouse(); }
      if (room.seats.size === 0 && room.clients.size === 0) this.openCounted = false;
      if (room.clients.size === 0 && room.watchers.size === 0) { clearInterval(this.timer); this.timer = null; this.report(); if (this.house) { this.ctx.waitUntil(this.flushBrain(true).catch(() => {})); this.house = null; } }
    }, 250);
  }

  /**
   * The game's launch state, read once when the room opens (one D1 read): a private or invite-only game whose room
   * holds anyone the state leaves out re-gates after the current round. Never in a Preview (no launch states there).
   */
  async rereadLaunch() {
    const room = this.room;
    if (!room || !this.game || !this.env.DB || this.env.HOMIE_PREVIEW === '1' || room.regate) return null;
    let launch = null;
    try { launch = (await this.env.DB.prepare('SELECT launch FROM office_games WHERE game = ?1').bind(this.game).first())?.launch ?? null; } catch { return null; }
    const args = regateArgs(launch);
    if (!args.allow) return null;
    const res = room.control('regate', args);
    if (res.ok && res.leaving) await this.ctx.storage.put('office', room.officeSaved()).catch(() => {});
    return res;
  }

  /** Tell the Lobby this room closed (until when; 0 when it opened again), so it sends nobody here meanwhile. */
  tellLobby(extra) {
    if (!this.game || !this.code) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.lastReport = -1;
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players: 0, people: 0, ...extra }) }).catch(() => {}));
  }

  /** Tell the Lobby how many players this room has, when it changes. */
  report() {
    const room = this.room;
    if (!room || !this.game) return;
    const counts = room.facts().counts;
    // Players are people (an agent never counts as one, DESIGN D9); agents and AI bodies are reported apart.
    const players = counts.players;
    // AIs with a pass (a house guide makes way for one, so the Lobby counts only these when it seats an AI).
    let agents = 0;
    for (const c of room.clients.values()) if (c.helloed && c.agent && c.seat !== null && !c.conn?.loopback) agents += 1;
    const ai = counts.ai ?? 0;
    // People for the stats: seated sockets that are not house QA (players is what the Lobby matches strangers by).
    let people = 0;
    for (const c of room.clients.values()) if (c.helloed && c.seat !== null && !c.agent && !c.conn?.qa) people += 1;
    // On a change, and once a minute while anybody is here (so the Lobby's "playing now" forgets a room that died).
    if (players === this.lastReport && people === this.lastPeople && agents === this.lastAgents && ai === this.lastAi && (!players || Date.now() - (this.lastReportAt ?? 0) < 60_000)) return;
    this.lastReport = players;
    this.lastPeople = people;
    this.lastAgents = agents;
    this.lastAi = ai;
    this.lastReportAt = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players, people, agents, ai }) }).catch(() => {}));
  }

  /** A round the host called over becomes one D1 row (once per round number). */
  recordRound() {
    const r = this.room?.lastRound;
    if (!r || r.phase !== 'over' || !Number.isFinite(r.n) || r.n <= this.recorded || !this.env.DB) return;
    this.recorded = r.n;
    this.ctx.storage.put('recorded', r.n).catch(() => {});
    const results = Array.isArray(r.results) ? r.results.slice(0, SEAT_MAX * 2) : [];
    // An AI's row is never a person's (the relay labelled it `agent`): rounds count agents as AI.
    const humans = results.filter((row) => row && !row.bot && !row.agent).length;
    // A round played only by house QA (every seated socket is marked) is kept in `rounds`, not in the stats.
    const qaOnly = [...this.room.clients.values()].filter((c) => c.helloed && c.seat !== null && !c.agent).every((c) => c.conn?.qa);
    const db = this.env.DB;
    const insert = db.prepare('INSERT OR IGNORE INTO rounds (game, room, n, humans, bots, results, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(this.game, this.code, r.n, humans, results.length - humans, JSON.stringify(results), new Date().toISOString());
    // The round and the people in it, on the studio's daily counters (worker/stats.mjs). One batch, per round.
    const counters = qaOnly ? [] : [counter(this.env, { metric: 'round', subject: this.game ?? '', source: humans ? 'people' : 'bots' }), humans ? counter(this.env, { metric: 'humans', subject: this.game ?? '', n: humans }) : null].filter(Boolean);
    this.ctx.waitUntil(db.batch([insert, ...counters]).catch(() => insert.run().catch(() => {})));
  }
}

/**
 * LOBBY — one per game: which room a new visitor joins. Strangers meet: the fullest room that still has a seat
 * wins, counting visitors it just sent there who have not connected yet, so two people pressing Play together land
 * in the same room.
 *
 * SERVERS (section 17): one pool per server (`/join?server=`), never matched across: `public` is the game's pub-N
 * rooms, a server's are s-<id>-<n>. A server whose `rooms_max` rooms are all full sends the visitor to its fullest
 * room, where it waits as a spectator and is seated when a seat frees (`full: true`). An AI (`agent=1`) is only ever
 * sent to a room with people in it; it never opens one. Players are people: agents are reported apart.
 */
export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.rooms = new Map();
    /** Each pool's next room number: { public: n, <server>: n } (a store from before servers is public's). */
    this.next = { public: 1 };
    /** Every room of this game that reported players (public and named), for "playing now" and the day's peak. */
    this.live = new Map();
    this.peak = { day: null, players: 0, room: 0 };
    /** Every room with somebody seated, public or named, for the owner's office; and the rooms the owner closed (until when). */
    this.seen = new Map();
    this.closed = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('lobby');
      if (saved) {
        this.next = typeof saved.next === 'number' ? { public: saved.next } : saved.next && typeof saved.next === 'object' ? { public: 1, ...saved.next } : { public: 1 };
        for (const r of saved.rooms ?? []) this.rooms.set(r.name, { ...r, server: r.server ?? roomServer(r.name), agents: r.agents ?? 0, ai: r.ai ?? 0, pending: [], agentPending: [] });
        for (const [name, until] of saved.closed ?? []) if (until > Date.now()) this.closed.set(name, until);
      }
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

  save() { this.ctx.storage.put('lobby', { next: this.next, rooms: [...this.rooms.values()].map(({ name, players, agents, ai, server, at }) => ({ name, players, agents, ai, server, at })), closed: [...this.closed] }).catch(() => {}); }

  prune(now) {
    for (const [name, r] of this.rooms) {
      r.pending = r.pending.filter((t) => now - t < 20_000);
      r.agentPending = (r.agentPending ?? []).filter((t) => now - t < 20_000);
      if (r.players === 0 && !r.pending.length && now - r.at > 120_000) this.rooms.delete(name);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);
    if (url.pathname === '/join') {
      const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
      const sid = url.searchParams.get('server') ?? 'public';
      const server = sid === 'public' || SERVER_ID.test(sid) ? sid : 'public';
      const roomsMax = Math.max(1, Math.min(16, Math.floor(Number(url.searchParams.get('rooms'))) || 16));
      // A room the owner closed, or one this visitor is held out of (`not`), is never the answer.
      const not = new Set(String(url.searchParams.get('not') ?? '').split(',').filter(Boolean));
      for (const [name, until] of this.closed) if (until <= now) this.closed.delete(name);
      const pool = [...this.rooms.values()].filter((r) => (r.server ?? 'public') === server && !not.has(r.name) && !this.closed.has(r.name));
      if (url.searchParams.get('agent') === '1') {
        // An AI: a room of this pool with people in it and an AI seat free (the most people first). Never a new room.
        const reserve = Math.max(0, Math.floor(Number(url.searchParams.get('ai'))) || 0);
        let best = null;
        for (const r of pool) {
          const agents = (r.agents ?? 0) + (r.agentPending ?? []).length;
          if (!(r.players > 0) || (reserve ? agents >= reserve : r.players + r.pending.length + agents >= max)) continue;
          if (!best || r.players > best.players || (r.players === best.players && r.name < best.name)) best = r;
        }
        if (!best) return json({ room: null, players: 0, max });
        (best.agentPending ??= []).push(now);
        return json({ room: best.name, players: best.players, max });
      }
      let best = null;
      for (const r of pool) {
        const fill = r.players + r.pending.length;
        if (fill >= max) continue;
        if (!best || fill > best.fill || (fill === best.fill && r.name < best.r.name)) best = { r, fill };
      }
      let room = best?.r;
      let full = false;
      if (!room && server !== 'public' && pool.length >= roomsMax) {
        // Every room this server may have is full: the fullest one, where the visitor waits for a seat.
        room = pool.reduce((a, b) => (b.players + b.pending.length > a.players + a.pending.length ? b : a), pool[0]);
        full = true;
      }
      if (!room) {
        let n = this.next[server] ?? 1;
        while (not.has(roomCode(server, n)) || this.closed.has(roomCode(server, n)) || this.rooms.has(roomCode(server, n))) n += 1;
        room = { name: roomCode(server, n), server, players: 0, agents: 0, ai: 0, at: now, pending: [], agentPending: [] };
        this.next[server] = n + 1;
        this.rooms.set(room.name, room);
      }
      room.pending.push(now);
      this.save();
      return json({ room: room.name, players: room.players, max, server, ...(full ? { full: true } : {}) });
    }
    if (url.pathname === '/report' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (typeof body.room !== 'string' || !ROOM_ID.test(body.room)) return json({ ok: false }, 400);
      // The owner closed this room: matched with nobody until then (and forgotten as a public room).
      if (Number.isFinite(body.closed)) {
        if (body.closed > now) { this.closed.set(body.room, body.closed); this.rooms.delete(body.room); } else this.closed.delete(body.room);
        this.seen.delete(body.room);
        this.save();
        return json({ ok: true, closed: body.closed > now });
      }
      const seated = Math.max(0, Math.floor(Number(body.players) || 0));
      const agents = Math.max(0, Math.floor(Number(body.agents) || 0));
      const ai = Math.max(agents, Math.floor(Number(body.ai) || 0));
      if (seated > 0) this.seen.set(body.room, { room: body.room, players: seated, people: Math.max(0, Math.floor(Number(body.people ?? seated) || 0)), agents, ai, at: now });
      else this.seen.delete(body.room);
      if (this.closed.has(body.room)) return json({ ok: true, closed: true });
      this.notePeak(body.room, Math.max(0, Math.floor(Number(body.people ?? body.players) || 0)), url.searchParams.get('game'));
      // Only rooms of a pool are matched with strangers (pub-N, s-<id>-<n>); a named room (?room=) stays private.
      if (!this.rooms.has(body.room) && !pooledRoom(body.room)) return json({ ok: true, private: true });
      const r = this.rooms.get(body.room) ?? { name: body.room, server: roomServer(body.room), players: 0, agents: 0, ai: 0, at: now, pending: [], agentPending: [] };
      const grew = Math.max(0, seated - r.players);
      const changed = !this.rooms.has(r.name) || r.players !== seated || (r.agents ?? 0) !== agents || (r.ai ?? 0) !== ai;
      r.pending.splice(0, grew);
      if ((r.agents ?? 0) < agents) (r.agentPending ?? []).splice(0, agents - (r.agents ?? 0));
      r.players = seated;
      r.agents = agents;
      r.ai = ai;
      r.at = now;
      this.rooms.set(r.name, r);
      if (changed) this.save(); // the minute's "still here" report writes nothing
      return json({ ok: true });
    }
    if (url.pathname === '/rooms') return json({ rooms: [...this.rooms.values()].map(({ name, players, agents, ai, server, at }) => ({ name, players, agents: agents ?? 0, ai: ai ?? 0, server: server ?? roomServer(name), at })) });
    if (url.pathname === '/busiest') {
      // The pooled room with the most players now, for a watcher (section 16): it reserves nothing, as a watcher takes
      // no seat. A closed room, one named in `not`, or one of a pool not in `pools` (a server with a door) is never it.
      const not = new Set(String(url.searchParams.get('not') ?? '').split(',').filter(Boolean));
      const pools = url.searchParams.has('pools') ? new Set(String(url.searchParams.get('pools')).split(',').filter(Boolean)) : null;
      let best = null;
      for (const r of this.rooms.values()) {
        if (r.players <= 0 || not.has(r.name) || (this.closed.get(r.name) ?? 0) > now || (pools && !pools.has(r.server ?? 'public'))) continue;
        if (!best || r.players > best.players || (r.players === best.players && r.name < best.name)) best = r;
      }
      return json({ room: best?.name ?? null, players: best?.players ?? 0 });
    }
    if (url.pathname === '/office') {
      // The owner's office: every room with somebody seated in the last 3 minutes, public or named, and closed ones.
      for (const [name, r] of this.seen) if (now - r.at > 180_000) this.seen.delete(name);
      const rooms = new Map([...this.seen.values()].map((r) => [r.room, r]));
      for (const r of this.rooms.values()) if (r.players > 0 && !rooms.has(r.name)) rooms.set(r.name, { room: r.name, players: r.players, people: r.players, agents: r.agents ?? 0, ai: r.ai ?? 0, at: r.at });
      for (const [name, until] of this.closed) if (until > now && !rooms.has(name)) rooms.set(name, { room: name, players: 0, people: 0, at: now, closedUntil: until });
      return json({ rooms: [...rooms.values()].map((r) => ({ ...r, server: roomServer(r.room) })).sort((a, b) => b.players - a.players).slice(0, 100) });
    }
    if (url.pathname === '/now') {
      let players = 0;
      for (const [name, r] of this.live) { if (Date.now() - r.at > 180_000) this.live.delete(name); else players += r.players; }
      return json({ players, rooms: this.live.size, peak: this.peak.day === today() ? { players: this.peak.players, room: this.peak.room } : { players: 0, room: 0 } });
    }
    return json({ error: 'not found' }, 404);
  }
}
