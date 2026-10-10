export { useFunctions } from './functions.mjs';
import { appAccess, appRecordsRoute } from './app-records.mjs';
import { appRole, openPath } from './app-format.mjs';
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
 *   /<game>/api/lobby          which public room to join (Lobby Durable Object); ?server=<id>: a room of that server;
 *                              the one answer a standalone copy's app may read (worker/standalone.mjs)
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
 *   /robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt   for search engines and AI agents, made from the public
 *                              catalogue (worker/discover.mjs); every generated page also carries schema.org JSON-LD
 *                              (worker/schema.mjs)
 *   /games/<id>/source.json    410, for a client that still asks: remix was retired, no game's source is served whole
 *   /media/<key>               a loose file in the studio's R2 (`media put`), with byte ranges
 *   /music/<slug>/<file>, /videos/<slug>/<file>   a song's or video's files: from the site's own files, or, for a
 *                              file `media move` put in the studio's R2 (the catalogue names its key), from R2 at the
 *                              same address, with byte ranges, HEAD, ETag and the site's own cache headers
 *   /api/stats                 the studio's numbers, for its owner only (a read key, or the owner's page session)
 *   /_studio/stats             the owner's private stats page (one-time sign-in link from `homie-studio stats link`)
 *   /_studio/office            the owner's back office: live rooms and who is in them, kick, mute, announce, close,
 *                              each game's launch state (private, invite-only beta, public), room size
 *                              and invites (worker/office.mjs); /_studio/api/* is the same as JSON
 *   /<game>/invite             an invite code spent for this browser's pass to an invite-only game
 *   /_homie/site.js            the pages' one script
 *   /account/                  a player's account: a passkey, a name, their data (worker/players.mjs, saves/SAVES.md)
 *   /api/player/...            sign in and up, saves, lifetime stats and memorials (the game's saves bridge, via the
 *                              play shell), export and delete
 *   /<game>/api/chat/report    a player reports one chat line (POST, this site's pages): the room's own copy of it is kept
 *                              for the owner, 30 days (worker/chat-store.mjs); room chat itself rides the sockets above
 *                              (NETPLAY.md section 19) and is never stored
 *   /shop/, /api/shop/...      the studio's shop (worker/shop.mjs, shop/SHOP.md): its items in real money, the studio's
 *                              OWN Stripe Checkout, the signed webhook, what a player owns (/api/player/owns), refunds;
 *                              closed until the owner's restricted key is in; never on a kids server or a television
 *   /api/referrals/statement   another studio's signed referral statement to this one (worker/referrals.mjs)
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
import { playerEnabled, EMBED_GAME_JS } from './embed.mjs';
import { NetRoom, WATCH_POLICIES, departure, errorLine, versionOf } from './room.mjs';
import { hostedGame, hostedBuild, startHost } from './hosted.mjs';
import { roomStore, restoreDelay } from './room-store.mjs';
import { appCors, isAppOrigin } from './standalone.mjs';
import { ROOM_ID, badRoomPage, embedAncestors, embedPreview, frameAncestors, noWatchPage, playPage, watchPage } from './pages.mjs';
import {
  PUBLIC_SERVER, SERVER_ID, homeOf, memberCounts, memberOf, noteMember, policyOf, pooledRoom, roomCode, roomServer, serverAccess, serverPassOf, serverView, serversOf,
  setMembership,
} from './servers.mjs';
import { BRAIN_BUDGET, HouseAgents, agentFacts, aiName, decodeFacts, encodeFacts, passById, passRefusal, sitRoute } from './agents.mjs';
import { CLEF, DECIDE, clefRun, costOf, localAiOf, picksOf, talks } from './brain.mjs';
import { REACTIONS, reviewChat } from './chat.mjs';
import { REPORT_REASONS, chatDay, chatOf, chatRowsOf, fileReport } from './chat-store.mjs';
import { forgetLines, historyOf, keepLines, keptLine } from './lounge-store.mjs';
import { isLoungePath, loungeRoutes } from './lounge.mjs';
import { doorPage, serverPage, serversPage } from './site.mjs';
import { isLocalOrigin, qrSvg } from './qr.mjs';
import { SEAT_MAX, paramsFrom, perAddress, seatsOf } from './seats.mjs';
import {
  SITE_JS, atomFeed, creditsPage, customPage, gameCover, gameLanding, gamesPage, homeLd, homePage, jsonFeed, landingLd, mediaArt, mediaIndexPage,
  notFoundPage, postPage, postsPage, roomView, roomsPage, sectionsOf, songPage, videoPage, watchOf,
} from './site.mjs';
import { cookieValues, count, countVisit, counter, isQa, onlyOf, ownerAllowed, playedByGame, playedThisWeek, rangeOf, readStats, today } from './stats.mjs';
import { ownerRoutes } from './stats-page.mjs';
import { playerRoutes, players as playerAccounts } from './players.mjs';
import {
  accessOf, accountSub, gatePage, holders, isOwner, joinHolders, launchOf, regateArgs, officeRoutes, publicCatalogue, redeemInvite, sameOrigin, seatsFor, settingsOf, ticketAllows,
  ticketFor, ticketSub, usePlayers, verifyControl,
} from './office.mjs';

// The back office knows the studio's player accounts: a signed-in player is named in the office and held by a kick on
// every device, and the owner's own account (`homie-studio players owner`) counts as the owner.
usePlayers(playerAccounts);
import { STUDIO_VERSION_TAG } from './version.mjs';
import { reconcileOrders, readiness, roomBadge, shellShop, shopOf, shopRoutes } from './shop.mjs';
import { DISCOVERY_FILES, discoveryResponse, llmsTxt, robotsTxt, sitemapXml } from './discover.mjs';
import { ldScript, studioNode } from './schema.mjs';
import { arrivalCookie, manifestReferrals } from './referrals.mjs';
import { licenseOf } from './license.mjs';
// GAME PARTS (parts/PARTS.md section 4): three call-outs below, everything else is worker/parts.mjs.
import { PART_FILES, isPartsPath, partsRoutes, withPartsBand } from './parts.mjs';

export { SEAT_MAX } from './seats.mjs';
// Server-hosted games (NETPLAY.md section 29): the studio's site/src/worker.mjs hands the build's rules over with this.
export { hostRules } from './hosted.mjs';
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
const catalogueCache = new WeakMap();
async function catalogue(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/games.json`));
    if (!res.ok) return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] };
    const tag = res.headers.get('etag');
    const hit = catalogueCache.get(env.ASSETS);
    if (tag && hit?.tag === tag && hit.origin === origin) { await res.body?.cancel(); return hit.value; }
    const value = await res.json();
    if (tag) catalogueCache.set(env.ASSETS, { tag, origin, value });
    return value;
  } catch { return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] }; }
}

/** The posts with their HTML (site/dist/_site/posts.json), for a post's page and the feeds. */
/** The studio's shop when it really sells (shop.json checked, the key, the webhook secret and its tables in): its items
 * are a landing's offers (worker/schema.mjs). Else null: a landing never names a price nobody can pay. */
async function sellingShop(env, cat) {
  const shop = shopOf(cat);
  if (!shop || shop.broken) return null;
  try { return (await readiness(env, shop)).ready ? shop : null; } catch { return null; }
}

async function availableShellShop(env, cat, game, options) {
  return await sellingShop(env, cat) ? shellShop(cat, game, options) : null;
}

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
  // Room chat (section 19): whether each room's chat is on and may show on homie.rocks's page for it.
  const chatRows = await chatRowsOf(env);
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
      const chat = chatOf(g, srv, chatRows);
      rooms.push(roomView(g, r, seatsOf(g), srv, { chat: chat.mode !== 'off' && chat.hub }));
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
  if (key.startsWith('paid-parts/')) return new Response('not found', { status: 404 });
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
      if (typeof f.r2 !== 'string' || !f.r2 || (f.r2.startsWith('players/') || f.r2.startsWith('paid-parts/')) || typeof f.url !== 'string') continue;
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
/**
 * Who a browser is to a room's chat (section 19): signed in with a passkey (an account, not a guest), and a member of the
 * server (on the public server, any signed-in account). One D1 read for a signed-in player, none for a guest.
 */
async function chatWho(env, game, srv, holder) {
  const pid = holders(holder).find((x) => x.startsWith('p-'))?.slice(2) ?? null;
  if (!pid || !env.DB) return { acct: false, member: false };
  let acct = false;
  try { acct = Number((await env.DB.prepare('SELECT guest FROM players WHERE id = ?1').bind(pid).first())?.guest) === 0; } catch { acct = false; }
  const member = acct && (!srv || srv.id === 'public' || Boolean(await memberOf(env, game, srv.id, pid)));
  return { acct, member };
}

/** Reports a browser (and its address) may make: 8 in 10 minutes, counted in this Worker's memory and forgotten. */
const reportsMade = new Map();
function reportAllowed(key, now = Date.now()) {
  const list = (reportsMade.get(key) ?? []).filter((at) => now - at < 10 * 60_000);
  if (list.length >= 8) { reportsMade.set(key, list); return false; }
  list.push(now);
  reportsMade.set(key, list);
  if (reportsMade.size > 5000) for (const [k, v] of reportsMade) if (!v.some((at) => now - at < 10 * 60_000)) reportsMade.delete(k);
  return true;
}

function notAHomie(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...KNOCK_CORS, 'cache-control': 'no-store' } });
  return json({ ok: false, error: 'not-a-homie', message: 'this is a studio site, not a Homie box; a game here plays on its own' }, 200, KNOCK_CORS);
}

/**
 * The game's index.html with HOMIE_NET ahead of its modules, in the site's sandbox (an opaque origin). `agent`: the
 * frame was opened with an agent's ticket (section 17): the game plays as that AI, named "<label> · AI".
 */
async function gameDocument(request, env, url, game, meta, cat, { agent = null } = {}) {
  const embedded = url.searchParams.get('embed') === '1' && playerEnabled(cat, meta);
  const asked = url.searchParams.get('room');
  // A player card's game joins a public room, or `main`: the room Play itself falls back to when the lobby does not answer.
  if (embedded && (!/^(?:pub-[1-9][0-9]*|main)$/.test(asked || '') || url.searchParams.has('t') || url.searchParams.has('watch') || url.searchParams.get('want') === 'screen')) return new Response('Player cards join public rooms through the player address.\n', { status: 400 });
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
  // The game's revision (game.json `netplay.version`, NETPLAY.md section 23) as this page is served: it rides in the
  // socket's address (`gv`), so a build whose helper predates revisions is still known for the build it is.
  const ver = versionOf(meta?.netplay?.version);
  // The play page's switches for the game (section 24): the allowed names only, checked again here.
  const params = paramsFrom(url.searchParams, meta);
  if (meta.kind === 'app' && !params.role) params.role = appRole(meta, url);
  const cfg = {
    v: 1,
    url: `${wsBase}/${game}/__net?room=${encodeURIComponent(room)}${b ? `&b=${b}` : ''}${t ? `&t=${encodeURIComponent(t)}` : ''}${watching ? '&w=1' : ''}${ver ? `&gv=${encodeURIComponent(ver)}` : ''}`,
    room,
    ...(ver ? { ver } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    // The page around this frame keeps net.prefs (the play page says so; a watch page or an older page does not).
    ...(url.searchParams.get('pf') === '1' ? { prefs: true } : {}),
    ...(url.searchParams.get('k') ? { token: url.searchParams.get('k').slice(0, 128) } : {}),
    ...(agent ? { name: agent.name } : url.searchParams.get('name') ? { name: url.searchParams.get('name').slice(0, 24) } : {}),
    // An AI that runs the game itself (hands `self`): its hello says so; the relay knows it from its ticket anyway.
    ...(agent ? { agent: { hands: agent.hands, role: agent.role } } : {}),
    // The play page's "Quiet AI": this browser hides AI speech (the helper's `net.hushed`).
    ...(url.searchParams.get('hush') === '1' ? { hush: true } : {}),
    // Room chat (section 19): this browser hides chat ("Show chat" off), or its player's own lines stay off their character.
    ...(url.searchParams.get('chat') === '0' ? { chatOff: true } : {}),
    ...(url.searchParams.get('bub') === '0' ? { bubbleOff: true } : {}),
    ...(device ? { device } : {}),
    want,
    ...(watching ? { watch: true, follow: /^\d+$/.test(follow) ? Number(follow) : follow, watchPolicy: policy } : {}),
    debug: url.searchParams.get('debug') === '1',
    ...(meta?.movement ? { movement: meta.movement } : {}),
    // game.json "saves": the play shell around this frame answers @homie-rocks/studio/saves (saves/SAVES.md).
    ...(meta?.saves && want === 'play' ? { saves: true } : {}),
    // The studio sells something in this game (shop/SHOP.md): the play shell answers @homie-rocks/studio/shop. A
    // watcher has no shop; the shell follows the studio shop policy for kids servers and television checkout.
    ...(!agent && !watching && await availableShellShop(env, cat, game) ? { shop: true } : {}),
  };
  let html = await res.text();
  const head = `${embedded ? `<script>${EMBED_GAME_JS}</script>` : ''}<script>window.HOMIE_NET=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${head}`) : head + html;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'access-control-allow-origin': '*',
      // The game runs in an opaque origin: it cannot read this site's storage or cookies.
      'content-security-policy': `sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups; frame-ancestors ${embedded ? `'self' ${embedAncestors(cat, url.origin, env.HOMIE_EMBED_PREVIEW === '1').replace("'none'", '')}` : frameAncestors(cat)}`,
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
  // GAME PARTS: a shared part's preview page is framed by the part's page and the hub, sandboxed (worker/parts.mjs).
  const playerFrame = /^\/[a-z0-9][a-z0-9-]{0,39}\/play\/embed$/.test('/' + path.split('/').filter(Boolean).join('/')) && res.status === 200 && /frame-ancestors/.test(res.headers.get('content-security-policy') ?? '');
  const addXfo = !playerFrame && !res.headers.has('x-frame-options') && !GAME_FILES.test(path) && !PART_FILES.test(path);
  if (!addNt && !addXfo) return res;
  const headers = new Headers(res.headers);
  if (addNt) headers.set('cache-control', cache ? `${cache}, no-transform` : 'no-transform');
  if (addXfo) headers.set('x-frame-options', 'DENY');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const cat = await catalogue(env, 'https://studio.invalid');
      await reconcileOrders(env, shopOf(cat));
      await (await import('./functions.mjs')).scheduleFunctions(event,env,cat,cat.studio?.url??'https://studio.invalid');
    })());
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // A standalone copy's Lobby call (worker/standalone.mjs): every answer to it can be read by the app's page, an
    // unknown game's 404 and a failure included, so the app can say why it plays offline. No other address is opened.
    const appRecords = isAppOrigin(request) && /^\/[^/]+\/api\/app\/records\//.test(url.pathname);
    if (appRecords && request.method === 'OPTIONS') return appCors(request, new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' } }));
    const appLobby = isAppOrigin(request) && /^\/[^/]+\/api\/lobby\/?$/.test(url.pathname);
    let res;
    try { res = finish(await route(request, env, ctx), url.pathname); } catch (error) {
      if (!appLobby) throw error;
      try { console.error(JSON.stringify({ at: new Date().toISOString(), ev: 'lobby-route-failed', path: url.pathname, error: errorLine(error) })); } catch { /* no console */ }
      res = json({ ok: false, error: 'failed' }, 500);
    }
    if(ctx?.waitUntil && ['POST','PUT','DELETE'].includes(request.method)) ctx.waitUntil((async()=>{const {runFunctions}=await import('./functions.mjs');await runFunctions(env,()=>catalogue(env,url.origin),url.origin);})());
    if (appLobby || appRecords) return appCors(request, res);
    // A referral's arrival (worker/referrals.mjs): only a person's page load with ?via= of another site, on a studio
    // that pays referrals. The page is answered first; a cookie is added to it only then.
    if (url.searchParams.has('via') && res && res.status === 200 && /text\/html/i.test(res.headers.get('content-type') ?? '')) {
      try {
        const cat = await catalogue(env, url.origin);
        const cookie = await arrivalCookie(request, env, url, shopOf(cat));
        if (cookie) { const out = new Response(res.body, res); out.headers.append('set-cookie', cookie); return out; }
      } catch { /* an arrival is never worth a failed page */ }
    }
    return res;
  },
};

let studioTools = async () => [];
/** Studio-authored Worker code, loaded only on the MCP surface. */
export function useTools(load) { studioTools = load; }
export function getStudioTools() { return studioTools(); }

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

  if (path === '/_studio/office/functions') return (await import('./functions.mjs')).functionsRoute(request,env,await getAll());

  if (path === '/mcp' || path.startsWith('/hooks/tools/') || path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-') || path === '/_studio/office/connections') {
    const { remoteMcp } = await import('./mcp.mjs');
    return remoteMcp(request, env, ctx, { catalogueOf: getAll, definitions: await studioTools() });
  }

  // "Connect this chat" (the template's first-run band): the directory's setup page, for this site's address.
  if (path === '/_studio/connect' && read) {
    const directory = directoryOf(await getCat());
    if (!directory || env.HOMIE_PREVIEW === '1') return json({ ok: false, error: 'no-directory', message: 'This studio is not connected to a directory.' }, 404);
    return Response.redirect(`${directory}/studio/setup/connect?site=${encodeURIComponent(url.origin)}`, 302);
  }
  if (path.startsWith('/_studio/')) return (await officeRoutes(request, env, url, { catalogueOf: getAll })) ?? ownerRoutes(request, env, url, { catalogueOf: getAll });
  if (path === '/__homie' || path.startsWith('/__homie/')) return notAHomie(request);
  // The shop (0.24.0) before player accounts: /api/player/owns is the shop's.
  {
    const shopped = await shopRoutes(request, env, ctx, url, { catalogueOf: getAll });
    if (shopped) return shopped;
  }
  if (path.startsWith('/api/player/') || path === '/account' || path === '/account/' || path === '/_homie/account.js') return playerRoutes(request, env, ctx, url, { catalogueOf: getCat });
  // The Lounge (0.29.0, chat/LOUNGE.md): the studio's own community room, when studio.json turns it on.
  if (isLoungePath(path)) {
    const lounged = await loungeRoutes(request, env, ctx, url, { catalogueOf: getCat, roomsOf });
    if (lounged) return lounged;
  }
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
  // GAME PARTS: /.well-known/homie-parts.json, /parts/<id>/<version>/… and the studio's own parts pages.
  if (isPartsPath(path)) {
    const shared = await partsRoutes(request, env, url, { catalogueOf: getCat });
    if (shared) return shared;
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
      games: await Promise.all((cat.games ?? []).filter((g) => g.kind !== 'app').map(async (g) => {
        // The card picture is the landing's hero still (what the landing leads with), else the game's cover.
        const cover = gameCover(g);
        // The licence the game names for itself (an SPDX id), when it names one (worker/license.mjs). Nothing here
        // offers the game to be taken whole: `remix`, `source` and `remixOf` left this manifest with remix.
        const license = licenseOf(g.license);
        return {
          id: g.id, name: g.name, blurb: g.blurb ?? '', players: g.players ?? null, roundSeconds: g.roundSeconds ?? null,
          page: `${url.origin}/${g.id}/`, play: `${url.origin}/${g.id}/play`, cover: cover ? (cover.startsWith('/') ? `${url.origin}${cover}` : cover) : null,
          ...(license ? { license } : {}),
          // Which build of the game is live: its digest (what `homie-studio build` printed for it, and what
          // site/dist/_site/build.json says) and the bundle its page loads. "Is the live game the one I built?" is
          // this against that, with no file to fetch and no edge cache to wait out.
          ...(g.built?.hash ? { build: { hash: g.built.hash, ...(g.built.bundle ? { bundle: `${url.origin}/games/${g.id}/${g.built.bundle}` } : {}) } } : {}),
          // Shared only with `stats.share`: this game's own Play presses and rounds with people, this week.
          ...(byGame ? { played: byGame[g.id] ?? { days: 7, plays: 0, rounds: 0 } } : {}),
        };
      })),
      ...((cat.games ?? []).some((g) => g.kind === 'app') ? { apps: cat.games.filter((g) => g.kind === 'app').map((g) => ({ id: g.id, kind: 'app', name: g.name, blurb: g.blurb, page: `${url.origin}/${g.id}/`, open: `${url.origin}/${g.id}/open`, wall: `${url.origin}/${g.id}/tv`, surfaces: Object.keys(g.surfaces ?? {}), ...(g.built ? { build: g.built } : {}) })) } : {}),
      songs: (cat.songs ?? []).map((e) => mediaRow(e, url.origin, 'music', cat)),
      videos: (cat.videos ?? []).map((e) => mediaRow(e, url.origin, 'videos', cat)),
      // The studio's posts, for the hub (the full text is in /posts/feed.json).
      posts: (cat.posts ?? []).slice(0, 20).map((p) => ({ slug: p.slug, title: p.title, date: p.date, summary: p.summary, page: `${url.origin}/posts/${p.slug}/`, image: p.image ? (p.image.startsWith('/') ? `${url.origin}${p.image}` : p.image) : null, links: p.links ?? {} })),
      ...(shareRooms ? { rooms: `${url.origin}/api/rooms` } : {}),
      // The studio's Lounge (0.29.0), for a directory that shows lounges: its page and its public facts.
      ...(cat.studio?.lounge ? { lounge: { name: cat.studio.lounge.name, page: `${url.origin}/lounge/`, now: `${url.origin}/lounge/api/now` } } : {}),
      // Shared only when studio.json says `stats.share`: two numbers for the whole studio, for the hub.
      ...(played ? { played } : {}),
      // The shop (0.24.0): whether it sells and its till, never a key or a sale; and referrals: this studio takes
      // signed statements as a referrer, with the public half of its statement key and, if it sells, its terms.
      ...(shopOf(cat)?.open ? { shop: { open: true, till: shopOf(cat).till, currency: shopOf(cat).currency, page: `${url.origin}/shop/` } } : {}),
      ...(await manifestReferrals(env, url.origin, shopOf(cat), cat.studio).then((r) => (r ? { referrals: r } : {})).catch(() => ({}))),
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
    if (!key || key.includes('..') || (key.startsWith('players/') || key.startsWith('paid-parts/'))) return new Response('not found', { status: 404 });
    return mediaObject(request, env, key);
  }
  if (path === '/posts/feed.xml' || path === '/posts/feed.json') {
    const cat = await getCat();
    if (!(cat.posts ?? []).length) return notFoundPage('This studio has no posts yet.', cat);
    const posts = await postsOf(env, url.origin);
    return path.endsWith('.xml') ? atomFeed(cat, posts, url.origin) : jsonFeed(cat, posts, url.origin);
  }

  // REMIX WAS RETIRED: no game's source is served whole. An older toolkit's `game remix`, the directory's copy of a
  // studio, or a link somebody kept may still ask for one, so the address answers 410 (gone, on purpose, for good)
  // with where to go instead: /parts/, the pieces of games this studio chose to share. The same answer for every
  // id, whether or not such a game exists, and before the site's files are looked at: a source.json an older build
  // left in the deployed folder is never reachable.
  if (/^\/games\/[a-z0-9][a-z0-9-]{0,39}\/source\.json$/.test(path)) return json({ retired: 'remix', see: '/parts/' }, 410, { 'access-control-allow-origin': '*' });

  // Search engines and AI agents (0.27.0, worker/discover.mjs): robots.txt, sitemap.xml, llms.txt and llms-full.txt,
  // made from the public catalogue (a private or invite-only game is in none of them); a file of the studio's own in
  // site/public wins.
  if (read && DISCOVERY_FILES.includes(path)) {
    const own = await env.ASSETS.fetch(new Request(`${url.origin}${path}`));
    if (own.ok) return own;
    const cat = await getCat();
    const method = request.method;
    if (path === '/robots.txt') return discoveryResponse(robotsTxt(cat, url.origin, { preview: env.HOMIE_PREVIEW === '1' }), 'text/plain', { method });
    const all = await getAll();
    if (path === '/sitemap.xml') return discoveryResponse(sitemapXml(cat, url.origin, { all }), 'application/xml', { method });
    const full = path === '/llms-full.txt';
    return discoveryResponse(llmsTxt(cat, url.origin, { directory: directoryOf(cat), full, posts: full ? await postsOf(env, url.origin) : null, all }), 'text/plain', { method });
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
        const html = await res.text();
        // <!-- homie:schema -->: the structured data the generated page here would carry (Home's, a landing's), else the
        // studio's own Organization (an About page).
        const schema = !/<!--\s*homie:schema\s*-->/.test(html) ? ''
          : want === '/' ? ldScript(homeLd(cat, url.origin))
            : game && parts.length === 1 ? ldScript(landingLd(cat, game, url.origin, { shop: await sellingShop(env, cat) }))
              : ldScript([studioNode(cat, url.origin, { full: true })]);
        return customPage(cat, html, { active, schema, origin: url.origin, playerGame: game && parts.length === 1 ? game : null });
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
  if (['games', 'apps', 'rooms', 'posts'].includes(parts[0]) && parts.length === 1) {
    const cat = await getCat();
    const has = sectionsOf(cat).some((s) => s.key === parts[0]);
    if (!has) return notFoundPage(parts[0] === 'posts' ? 'This studio has no posts yet.' : 'This studio has no games yet.', cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${parts[0]}/`, 301);
    await countVisit(request, env, ctx, parts[0]);
    if (parts[0] === 'posts') return postsPage(cat, { origin: url.origin });
    const { rooms, live } = await roomsOf(env, cat.games ?? []);
    return ['games', 'apps'].includes(parts[0]) ? gamesPage(cat, { origin: url.origin, live, kind: parts[0] === 'apps' ? 'app' : 'game' }) : roomsPage(cat, { origin: url.origin, rooms });
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
    if (meta.kind === 'app' && /^open(?:\/(embed|preview))?$/.test(sub)) sub = sub.replace(/^open/, 'play');
    if (sub === '__restart') {
      if (env.HOMIE_PREVIEW !== '1' || request.method !== 'POST' || !hostedGame(game)) return new Response('not found', { status: 404 });
      const room = url.searchParams.get('room') ?? '';
      if (!ROOM_ID.test(room)) return new Response('invalid room', { status: 400 });
      return env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`)).fetch(`https://table/__restart?game=${game}&room=${room}`, { method: 'POST' });
    }
    // Read now, not from a Worker instance's 5 s cache: a game the owner just made private shuts at once everywhere.
    const settings = await settingsOf(env, { fresh: true });
    // The owner's launch state and room size (worker/office.mjs): a private or invite-only game lets in only those
    // with access, and the owner may have made its rooms smaller than the game's own seats.
    const launch = launchOf(meta, settings, env);
    const max = seatsFor(meta, settings);
    if (meta.kind === 'app') {
      if (launch !== 'public' && !(await accessOf(request, env, game, launch)).ok) return json({ ok: false, error: 'not-found' }, 404);
      const api = await appRecordsRoute(request, env, meta, url, sub);
      if (api) return api;
      if (['play', 'tv', 'watch'].includes(sub)) {
        let a;
        try { a = await appAccess(request, env, meta, url); } catch { return json({ ok: false, error: 'app roles unavailable; apply studio migrations' }, 503); }
        if (!a.ok) {
          if (a.status === 401) return Response.redirect(`${url.origin}/account/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
          return json({ ok: false, error: a.error }, a.status);
        }
      }
    }
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
      // GAME PARTS: the landing's "Parts from this game" band (shared parts only).
      return withPartsBand(gameLanding(cat, meta, { origin: url.origin, rooms, playing: live[game] ?? 0, week, servers: band, listed: launch === 'public', shop: launch === 'public' ? await sellingShop(env, cat) : null }), env, url, meta);
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
    if (sub === 'play/preview' && env.HOMIE_EMBED_PREVIEW === '1' && isLocalOrigin(url.origin)) return embedPreview(cat, meta, url.origin);
    if (sub === 'tv' || sub === 'play' || sub === 'play/embed') {
      const embed = sub === 'play/embed';
      if (embed && (!playerEnabled(cat, meta) || launch !== 'public')) return notFoundPage(meta.kind === 'app' ? 'This app does not open inside a post. Open its studio page.' : 'This game does not play inside a post. Open its studio page to play.', cat);
      const screen = !embed && (sub === 'tv' || url.searchParams.get('screen') === '1');
      const asked = embed ? null : askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return badRoomPage(cat, meta, asked, { screen });
      if (!door.ok) return shut();
      // Which server: the path's, the room's, else (Play) the player's home server, else public.
      let srv = pathServer ? serverById(pathServer[1]) : asked !== null ? serverById(roomServer(asked)) : null;
      if (asked !== null && !srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const named = asked !== null && !pooledRoom(asked);
      if (!srv) {
        const acct = embed ? null : await accountSub(request, env);
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
          try { room = (await (await lobby().fetch(`https://lobby/join?max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json()).room ?? null; } catch { room = null; }
        }
        const joinUrl = `${url.origin}${openPath(meta)}${room ? `?room=${encodeURIComponent(room)}` : ''}`;
        // Local development: no phone can open this computer's own address, so no code for it; the card says to deploy.
        const local = isLocalOrigin(url.origin);
        let qr = null;
        if (!local) try { qr = qrSvg(joinUrl, { title: `Join ${meta.name ?? game}` }); } catch { /* too long for a QR: the address shows as text */ }
        // Television checkout and kids-server visibility follow the studio shop policy.
        const sh = await availableShellShop(env, cat, game, { kids: pol.kids });
        let shopQr = null;
        if (sh && !local) try { shopQr = qrSvg(`${url.origin}/shop/?game=${encodeURIComponent(game)}`, { title: `Shop: ${meta.name ?? game}` }); } catch { shopQr = null; }
        return playPage(cat, meta, { origin: url.origin, screen: true, joinUrl, qr, local, room, ticket, owner: d.owner, launch, server, shop: sh ? { ...sh, qr: shopQr, url: `${url.origin}/shop/?game=${game}` } : null });
      }
      await countVisit(request, env, ctx, game, 'play');
      shareDaily(cat, url, ctx);
      return playPage(cat, meta, { origin: url.origin, embed, preview: env.HOMIE_EMBED_PREVIEW === '1', ticket: embed ? null : ticket, owner: !embed && d.owner, launch, server, ...(embed ? {} : await chatWho(env, game, srv, d.acct)), shop: await availableShellShop(env, cat, game, { kids: pol.kids }) });
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
      return watchPage(cat, meta, { origin: url.origin, room: asked, ticket, policy, owner: d.owner, ...(await chatWho(env, game, srv, d.acct)) });
    }
    if (sub === 'api/watch') {
      if (!door.ok || watchOf(meta) === 'off') return json({ ok: false, error: 'not-found' }, 404);
      // The busiest room now, to watch, of a server anyone may watch; nothing is reserved (a watcher takes no seat).
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pools = servers.filter((x) => x.state === 'open' && x.door === 'open').map((x) => x.id).join(',');
      let best = null;
      const wver = versionOf(meta?.netplay?.version);
      try { best = await (await lobby().fetch(`https://lobby/busiest?pools=${encodeURIComponent(pools)}${not ? `&not=${encodeURIComponent(not)}` : ''}${wver ? `&ver=${encodeURIComponent(wver)}` : ''}`)).json(); } catch { best = null; }
      return json({ ok: true, game, room: best?.room ?? null, players: best?.players ?? 0, max }, 200, { 'cache-control': 'no-store' });
    }
    if (sub === 'api/lobby') {
      // A standalone copy's page reads this answer from another origin: the Worker's own `fetch` adds its header to
      // every answer of this address (worker/standalone.mjs), whichever line here made it.
      const app = isAppOrigin(request);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      // ?server=<id>: a room of that server's pool (its door first); none: public. Strangers never meet across servers.
      const sid = url.searchParams.get('server') ?? 'public';
      // An app plays on the public server only: it has no account and no invite to show a server's door.
      if (app && sid !== 'public') return json({ ok: false, error: 'app-public', message: 'A standalone copy plays on the public server.' }, 403);
      const srv = SERVER_ID.test(sid) || sid === 'public' ? serverById(sid) : null;
      if (!srv) return json({ ok: false, error: 'no-server', message: `${meta.name} has no server called ${String(sid).slice(0, 24)}.` }, 404);
      if (srv.id === 'public' && publicHidden() && !(await pageDoor(srv)).owner) return json({ ok: false, error: 'closed', message: 'Pick a server to play on.' }, 403);
      const d = await pageDoor(srv);
      if (!d.ok) return json({ ok: false, error: d.why, message: 'This server\'s door does not let you in.' }, 403);
      // A browser held out of a room asks for any other (`not`), so the Lobby never sends it back there.
      const not = String(url.searchParams.get('not') ?? '').split(',').filter((r) => ROOM_ID.test(r)).slice(0, 4).join(',');
      const pol = policyFor(srv);
      // Strangers on different builds of the game never meet (section 23): the Lobby matches within the live build.
      // A standalone copy is the build it was made from, whatever is live now: it says its own (`gv`, or none for a
      // game that named none then) and is matched with copies of that build. What it says is its own word, so the
      // Lobby is told it came from an app (`app=1`) and keeps only a few such builds' rooms (LOBBY_APP_VERSIONS).
      const ver = app ? versionOf(url.searchParams.get('gv')) : versionOf(meta?.netplay?.version);
      if (app && meta?.room?.host === 'server' && ver !== meta.room.build) return json({ ok: false, error: 'stale', message: 'Update the app to play online.' }, 409);
      return lobby().fetch(`https://lobby/join?max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${not ? `&not=${encodeURIComponent(not)}` : ''}${ver ? `&ver=${encodeURIComponent(ver)}` : ''}${app ? '&app=1' : ''}`, { method: 'POST' });
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
            const r = await (await lobby().fetch(`https://lobby/join?max=${max}&server=${srv.id}&agent=1&ai=${reserve}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json();
            return r.room ?? null;
          } catch { return null; }
        },
      });
    }
    if (sub === 'api/chat/report') {
      // A player reports one chat line (section 19): the room's own copy of it is what is kept, never the reporter's words.
      if (request.method !== 'POST' || !sameOrigin(request, url)) return json({ ok: false, error: 'origin', message: 'a report comes from this site\'s own pages' }, 403);
      if (!door.ok) return json({ ok: false, error: 'not-found' }, 404);
      let body = {};
      try { body = JSON.parse((await request.text()).slice(0, 2048) || '{}'); } catch { return json({ ok: false, error: 'json' }, 400); }
      const room = String(body.room ?? '');
      const id = String(body.id ?? '');
      if (!ROOM_ID.test(room) || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) return json({ ok: false, error: 'bad-request', message: 'room and id name the message' }, 400);
      const reason = REPORT_REASONS.includes(body.reason) ? body.reason : 'other';
      const key = `${BROWSER_KEY.test(String(body.b ?? '')) ? body.b : ''}|${request.headers.get('cf-connecting-ip') ?? ''}`;
      if (!reportAllowed(key)) return json({ ok: false, error: 'rate', message: 'That is a lot of reports: the studio has them. Try again in a few minutes.' }, 429);
      let line = null;
      try { line = (await (await env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`)).fetch(`https://table/__chat?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}&op=line&id=${encodeURIComponent(id)}`)).json()).line ?? null; } catch { line = null; }
      if (!line) return json({ ok: false, error: 'gone', message: 'That message is no longer in the room.' }, 404);
      if (line.by === 'studio') return json({ ok: false, error: 'studio', message: 'That is the studio\'s own line.' }, 400);
      try { await fileReport(env, { game, room, line, reason }); } catch (error) {
        return json({ ok: false, error: 'not-migrated', message: `Reports need migration 0007_studio_chat.sql (npm run deploy). (${String(error?.message ?? error).slice(0, 120)})` }, 503);
      }
      return json({ ok: true, message: 'Thanks for telling the studio. They will look at it.' });
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
      // Room chat (section 19): the room's rules, and who this socket is to them: an account with a passkey (not a
      // guest), a member of this server, or another site's page watching from elsewhere (homie.rocks's room page).
      const chat = chatOf(meta, srv, await chatRowsOf(env));
      const { acct, member } = await chatWho(env, game, srv, who);
      const origin = request.headers.get('origin');
      const hub = sub === '__watch' && Boolean(origin) && origin !== 'null' && origin !== url.origin;
      const lean = { ...chat, emoji: chat.emoji.filter((e) => !REACTIONS.some((r) => r.k === e.k)) };
      // A supporter's badge (the shop, 0.24.0): what the player's account owns, looked up here, so a hello can never claim
      // one; none on a kids server, none for an AI or a watcher.
      const pid = !ag && !w && sub === '__net' ? parts.find((x) => x.startsWith('p-'))?.slice(2) : null;
      const badge = pid ? await roomBadge(env, cat, pid, { kids: pol.kids }) : null;
      const stub = env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
      // Revision 9 (NETPLAY.md sections 22 and 23): the build that is live now (`cur`, always said, empty when the game
      // names none), the build this socket's page was served with (`gv`, from the socket's own address), and the game's
      // own stall time.
      const cur = versionOf(meta?.netplay?.version) ?? '';
      const gv = versionOf(url.searchParams.get('gv')) ?? '';
      const stall = Number(meta?.netplay?.stallMs) || 0;
      const target = `https://table/${sub}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}${b ? `&b=${b}` : ''}${who ? `&via=${encodeURIComponent(who)}` : ''}${sub === '__net' ? `&wp=${policy}${w ? '&w=1' : ''}` : ''}&pol=${encodeFacts(pol)}&chat=${encodeFacts(lean)}${acct ? '&acct=1' : ''}${member ? '&mem=1' : ''}${hub ? '&hub=1' : ''}${ag ? `&ag=${encodeFacts(ag)}` : ''}${badge ? `&bd=${encodeURIComponent(badge)}` : ''}&cur=${encodeURIComponent(cur)}${gv ? `&gv=${encodeURIComponent(gv)}` : ''}${stall ? `&stall=${stall}` : ''}${meta?.room?.contract ? `&rules=1&hz=${meta.room.tickHz ?? 20}` : ''}${meta?.room?.host === 'server' ? '&host=server' : ''}`;
      // The room's own failure to answer is told apart from the browser going away while it was connecting (a closed
      // tab, a reload racing its own socket): the second is a departure, said in one line with its room, never an
      // uncaught error with nothing on it.
      try { return await stub.fetch(new Request(target, request)); } catch (error) {
        const gone = departure(error);
        try { console[gone ? 'log' : 'error'](JSON.stringify({ at: new Date().toISOString(), ev: gone ? 'socket-gone' : 'room-unreachable', game, room, sub, error: errorLine(error) })); } catch { /* no console */ }
        return new Response(gone ? 'gone' : 'the room did not answer; try again', { status: gone ? 499 : 503 });
      }
    }
    // The same knock, relative to the game's own page: the same answer (see notAHomie).
    if (sub === '__homie' || sub.startsWith('__homie/')) return notAHomie(request);
    if (sub === '__game' || sub === '__game/' || sub === '__game/index.html') {
      if (url.searchParams.get('embed') === '1' && (!playerEnabled(cat, meta) || launch !== 'public')) return notFoundPage('Embedding is off for this game.', cat);
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


/** A server-hosted room in play keeps the alarm this far ahead; a paused one ends this long after its pause (the relay's `forgetMs`). */
const ROOM_ALARM_MS = 10 * 60_000;
const ROOM_PAUSE_MS = 60_000;

/** Watchers, AI seats and restoration never extend an absence. */
export function roomEndAt({ people, pausedAt, createdAt, restoredAt = null, savedAt = null, alarmAt = null }) {
  // Only people keep play alive. With no durable alarm, the last save bounds an unrecorded departure.
  const absence = pausedAt ?? (restoredAt !== null && alarmAt === null ? savedAt : null) ?? restoredAt ?? createdAt;
  return people > 0 ? Infinity : absence + ROOM_PAUSE_MS;
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
    /** Room chat's review (section 19): the studio's day (budget and use, read at most once a minute) and what is not counted yet. */
    this.chatCap = null;
    this.chatUsed = 0;
    this.chatReadAt = 0;
    this.chatPend = { neurons: 0, ok: 0, held: 0, error: 0 };
    this.chatSent = { chatLines: 0, chatReacts: 0, held: {} };
    /**
     * Revision 10 (NETPLAY.md section 29): the host runtime of a server-hosted room (rules/host.ts), and when this
     * room next needs the object's one alarm (the house guides and the day's counters share it).
     */
    this.hostRt = null;
    this.roomAlarmAt = 0;
    this.durable = null;
    this.roomSave = null;
    this.endedRoom = null;
    this.pausedAt = null;
    ctx.blockConcurrencyWhile(async () => {
      // Only a confirmed missing alarm permits the save-age fallback. A read failure is not evidence of absence.
      this.recoveredAlarmAt = Infinity;
      try { this.recoveredAlarmAt = (await ctx.storage.getAlarm?.()) ?? null; }
      catch (error) { this.storageProblem(error); }
      this.saved = (await ctx.storage.get('net')) ?? null;
      if (this.saved?.retired === true) this.cleanupPending = true;
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
        save: (o) => { if (this.hostRt) this.saveRoom(this.hostRt.save()); else if (!hostedGame(game)) storage.put('net', o).catch(() => {}); },
        clear: () => { this.clearRoom(); },
      },
      // The room's lifecycle, one line each with its time and room (worker/room.mjs `log`): a hello, a leave, an
      // election, a build change, and `failed` (a room operation that threw). A departure and a failure seconds apart
      // are told apart by these. HOMIE_ROOM_LOG=0 keeps only the failures.
      log: (line) => this.say(line),
    });
    if (this.saved && !hostedGame(game)) this.room.restore(this.saved);
    if (this.officeSaved) this.room.restoreOffice(this.officeSaved);
    this.vocabRead = this.readVocab(game).catch(() => false);
    // Room chat (section 19): typed text the floor let through waits for the studio's own Workers AI.
    this.room.review = (text, opts) => this.reviewChat(text, opts);
    // Kept chat (0.29.0): a room whose rules keep `history` writes what was said to D1 and deletes what is taken down,
    // one after another (a line removed the moment it went out is never written after its delete).
    this.room.onPublished = (rec) => this.keptQueue(() => keepLines(this.env, this.game, this.code, [rec]));
    this.room.onUnsaid = (ids) => this.keptQueue(() => forgetLines(this.env, this.game, this.code, ids));
    // A game's own decisions (section 20): the host's typed questions, for a game whose game.json opts in.
    this.room.decider = (state, questions, opts) => this.decide(state, questions, opts);
    // A server-hosted room that forgets everything (nobody came back, or the owner closed it) ends its host runtime.
    this.room.onForget = () => { if (this.hostRt) this.finishRoom('forgotten'); };
    return this.room;
  }

  /* ------------------------------------------------------------ the server as host (NETPLAY.md section 29) */

  /**
   * A room of a server-hosted game gets its host runtime before its first socket is attached, so no browser is ever
   * elected. `hosted`: the Worker's word that this game's settings say `host: server`. Rules that are missing from
   * this build, or do not fit the contract, do not start: the room refuses joins and says why.
   */
  ensureHost(room, hosted) {
    if (this.hostRt || !this.game) return;
    if (!hostedGame(this.game)) {
      if (hosted) room.failServerHost('This game runs its rules on the server, and this build of the site does not hold them. Build and deploy it again.');
      return;
    }
    let restoring = false;
    let pauseWriteFailed = false;
    try {
      const build = hostedBuild(this.game);
      try { this.durable ??= roomStore(this.ctx.storage); } catch (error) { this.storageProblem(error); }
      let saved = this.cleanupPending ? null : this.readRoom();
      restoring = Boolean(saved);
      let boot = { epoch: 0, count: 0 };
      try { boot = this.durable?.boots() ?? boot; } catch (error) { if (saved) throw error; this.storageProblem(error); }
      if (!Number.isSafeInteger(boot.epoch) || boot.epoch < 0 || !Number.isInteger(boot.count) || boot.count < 0) {
        const error = new Error('saved boot counter is invalid');
        if (saved) throw error;
        this.storageProblem(error); this.clearRoom(); boot = { epoch: 0, count: 0 };
      }
      if (saved && saved.buildHash !== build.build) boot.count = 0;
      // A restore's provisional pause is not a recorded departure. A stored alarm,
      // even one now due, has not yet confirmed expiry. The alarm handler owns that decision.
      const restorePause = saved?.pauseFromRestore === true && Date.now() >= saved.pausedAt + ROOM_PAUSE_MS && this.recoveredAlarmAt !== null ? null : saved?.pausedAt;
      const restoredEnd = saved ? roomEndAt({ people: 0, pausedAt: restorePause, restoredAt: Date.now(), savedAt: saved.at, alarmAt: this.recoveredAlarmAt }) : Infinity;
      const expired = Date.now() >= restoredEnd;
      if (saved && (saved.stateHash !== build.stateHash || boot.count >= 2 || expired)) {
        const why = saved.stateHash !== build.stateHash ? 'state-changed' : boot.count >= 2 ? 'restore loop' : 'nobody-returned';
        const tokens = new Set((saved.net.seats ?? []).map((s) => s[1]));
        this.finishRoom(why);
        room.forget(); room.ended = null;
        // Only a holder returning to the old match is rematched. A new visitor uses this name immediately.
        if (!expired) room.endedMatch = { why, ver: build.build, tokens, until: Date.now() + ROOM_PAUSE_MS };
        this.room = room; saved = null; restoring = false; boot = { epoch: 0, count: 0 };
      }
      this.roomSave = saved;
      if (saved) {
        // The seat map and the world came from one transaction. No unrelated net write can take a body from its token.
        room.seats.clear(); room.state.clear(); room.stateBytes = 0;
        room.restore({ ...saved.net, savedAt: Date.now(), durable: true });
        this.pausedAt = restoredEnd - ROOM_PAUSE_MS;
        this.pauseFromRestore = saved.pauseFromRestore = saved.pausedAt === null || saved.pauseFromRestore === true;
        saved.pausedAt = this.pausedAt;
        // A failed pause write must never be mistaken for an invalid host save.
        try { this.durable.write(saved); } catch (error) { pauseWriteFailed = true; this.storageProblem(error); }
      }
      const epoch = saved ? Math.max(saved.host.core.epoch, boot.epoch) + 1 : undefined;
      if (saved) this.durable.boot({ epoch, count: boot.count });
      this.hostCreatedAt = Date.now();
      let ticks = 0;
      this.hostRt = startHost(this.game, {
        ...(saved ? { restore: new TextEncoder().encode((saved.hostText ?? JSON.stringify(saved.host))), restoreEpoch: epoch, startDelayMs: boot.count === 1 ? restoreDelay(`${this.game}/${this.code}`) : 0 } : {}),
        store: { save: (bytes) => this.saveRoom(bytes) },
        onTick: () => {
          if (!saved) return;
          ticks += 1;
          if (ticks === 1) this.pendingBoot = { epoch, count: saved.buildHash !== build.build ? 0 : boot.count + 1 };
          if (ticks === 10 * build.settings.tickHz) this.pendingBoot = { epoch, count: 0 };
          if (this.pendingBoot && Date.now() >= (this.bootRetryAt ?? 0)) { try { this.durable.boot(this.pendingBoot); this.pendingBoot = null; this.bootFailures = 0; } catch (error) { this.bootRetryAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(this.bootFailures ?? 0, 6)); this.bootFailures = (this.bootFailures ?? 0) + 1; this.storageProblem(error); } }
        },
        send: (m, text) => room.hostFrame(m, text),
        log: (line) => { if (line.ev === 'persist-failed') this.storageProblem(new Error(line.error)); else this.say(line); },
        onPause: () => { this.pauseFromRestore = false; this.pausedAt ??= Date.now(); this.armRoom(this.pausedAt + ROOM_PAUSE_MS); },
        onResume: () => { this.pauseFromRestore = false; this.pausedAt = null; if (this.hostRt) { try { this.saveRoom(this.hostRt.save()); } catch { /* retry already scheduled */ } } this.armRoom(Date.now() + ROOM_ALARM_MS); },
        onEnd: (why) => this.endHosted(why),
      });
      room.setServerHost(this.hostRt);
      room.gameVer = build.build;
      room.setCurrent(build.build);
      if (pauseWriteFailed) { try { this.saveRoom(this.hostRt.save()); } catch { /* the save retry retains the original absence */ } }
      if (saved) {
        room.hostFrame({ t: 'state', k: 'shared', d: this.hostRt.core.shared() });
        room.hostFrame({ t: 'snap', from: null, e: epoch, k: this.hostRt.tick, st: Date.now(), d: this.hostRt.core.snapshot(), c: [] });
      }
      this.armRoom(roomEndAt({ people: 0, pausedAt: this.pausedAt, createdAt: this.hostCreatedAt }));
    } catch (error) {
      this.hostRt?.stop(); this.hostRt = null;
      if (restoring) {
        this.storageProblem(error);
        room.forget(); this.clearRoom();
        this.skipSave = true;
        this.ensureHost(room, hosted);
        return;
      }
      room.failServerHost(`This game's rules could not start: ${String(error?.message ?? error).slice(0, 160)}`);
    }
  }

  saveRoom(bytes) {
    const now = Date.now();
    if (now < (this.saveRetryAt ?? 0)) throw this.saveError ?? new Error('room save retry is waiting');
    try {
      this.durable ??= roomStore(this.ctx.storage);
      const build = hostedBuild(this.game);
      const host = new TextDecoder().decode(bytes);
      const saved = { v: 1, game: this.game, room: this.code, at: now, pauseFromRestore: this.hostRt?.paused === true && this.pauseFromRestore === true, pausedAt: this.hostRt?.paused ? this.pausedAt ?? now : null, stateHash: build.stateHash, buildHash: build.build, host, net: this.room.saved() };
      const clearing = this.cleanupPending;
      if (clearing) this.durable.clear();
      this.durable.write(saved);
      if (clearing) { this.cleanupGeneration = (this.cleanupGeneration ?? 0) + 1; this.queueNetCleanup(false); }
      this.roomSave = saved; this.cleanupPending = false; clearTimeout(this.cleanupRetry); this.cleanupRetry = null;
      this.saveFailures = 0; this.saveRetryAt = 0; this.saveError = null;
      clearTimeout(this.saveRetry); this.saveRetry = null;
      this.storageHealth = { ok: !this.pendingBoot };
    } catch (error) {
      this.saveError = error;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.saveFailures ?? 0, 6));
      this.saveFailures = (this.saveFailures ?? 0) + 1; this.saveRetryAt = now + delay;
      this.storageProblem(error);
      if (!this.saveRetry) {
        this.saveRetry = setTimeout(() => {
          this.saveRetry = null;
          if (this.hostRt) { try { this.saveRoom(this.hostRt.save()); } catch { /* saveRoom scheduled the next attempt */ } }
        }, delay);
        this.saveRetry?.unref?.();
      }
      throw error;
    }
  }

  storageProblem(error) {
    this.storageHealth = { ok: false, message: String(error?.message ?? error).slice(0, 160), since: this.storageHealth?.ok === false ? this.storageHealth.since : Date.now() };
    if (Date.now() < (this.storageLogAt ?? 0)) return;
    this.storageLogAt = Date.now() + 1000;
    this.say({ ev: 'persist-failed', build: hostedBuild(this.game)?.build, error: this.storageHealth.message });
  }

  readRoom(validateHost = false) {
    if (this.skipSave) { this.skipSave = false; return null; }
    try {
      if (this.durable?.boots()?.retired === true) { this.clearRoom(); return null; }
      const saved = this.durable?.read();
      if (!saved) return null;
      if (saved.v !== 1 || typeof saved.game !== 'string' || typeof saved.room !== 'string' ||
          this.game && saved.game !== this.game || this.code && saved.room !== this.code ||
          !Number.isFinite(saved.at) || saved.at < 0 || saved.at > Date.now() + 5000 || saved.pausedAt !== null && (!Number.isFinite(saved.pausedAt) || saved.pausedAt < 0 || saved.pausedAt > Date.now() + 5000) ||
          saved.pauseFromRestore !== undefined && typeof saved.pauseFromRestore !== 'boolean' ||
          saved.host?.v !== 1 || !saved.net || typeof saved.stateHash !== 'string' || typeof saved.buildHash !== 'string') throw new Error('save envelope does not fit this room');
      saved.at = Math.min(saved.at, Date.now());
      if (saved.pausedAt !== null) saved.pausedAt = Math.min(saved.pausedAt, Date.now());
      if (hostedGame(saved.game) && saved.stateHash !== hostedBuild(saved.game).stateHash) return saved;
      this.game ??= saved.game; this.code ??= saved.room;
      const seats = saved.net.seats;
      const cap = hostedBuild(saved.game)?.seats ?? 32;
      if (saved.net.v !== 1 || saved.net.room !== saved.room || !Array.isArray(seats) || seats.length > cap ||
          new Set(seats.map((s) => s?.[0])).size !== seats.length || new Set(seats.map((s) => s?.[1])).size !== seats.length ||
          seats.some((s) => !Array.isArray(s) || !Number.isInteger(s[0]) || s[0] < 0 || s[0] >= cap || typeof s[1] !== 'string' || s[1].length > 128 || typeof s[2] !== 'string' || s[2].length > 40 || s[4] !== null && (!Number.isSafeInteger(s[4]) || s[4] < 0) || s[5] !== null && !Number.isFinite(s[5]))) throw new Error('saved seats do not fit this room');
      if (validateHost && hostedGame(saved.game) && saved.stateHash === hostedBuild(saved.game).stateHash) {
        const probe = startHost(saved.game, { restore: new TextEncoder().encode(saved.hostText ?? JSON.stringify(saved.host)), send() {} });
        probe.stop();
      } else if (!hostedGame(saved.game)) throw new Error('saved game is not in this build');
      return saved;
    } catch (error) { this.storageProblem(error); this.clearRoom(); return null; }
  }

  clearRoom() {
    this.cleanupGeneration = (this.cleanupGeneration ?? 0) + 1;
    this.roomSave = null; this.saved = null; this.pendingBoot = null;
    try { this.durable?.retire(); this.durable?.clear(); this.cleanupPending = false; clearTimeout(this.cleanupRetry); this.cleanupRetry = null; }
    catch (error) { this.retryCleanup(error); }
    this.queueNetCleanup(this.cleanupPending);
  }

  queueNetCleanup(retired) {
    // The key-value record can preserve retirement when SQL writes, not just deletes, are unavailable.
    // Serialize it with a later successful save so an older failure cannot retire the new match.
    const generation = this.cleanupGeneration;
    this.netCleanup = (this.netCleanup ?? Promise.resolve()).then(() => {
      if (generation !== this.cleanupGeneration) return;
      return retired ? this.ctx.storage.put('net', { retired: true }) : this.ctx.storage.delete('net');
    }).then(() => {
      if (generation !== this.cleanupGeneration) return;
      this.netCleanupFailed = false;
      clearTimeout(this.netCleanupRetry); this.netCleanupRetry = null;
      if (!this.cleanupPending) this.cleanupFailures = 0;
    }).catch((error) => {
      if (generation !== this.cleanupGeneration) return;
      if (retired) { this.retryCleanup(error); return; }
      // Removing an old key marker is not permission to delete a newer SQL match.
      this.netCleanupFailed = true; this.storageProblem(error);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.cleanupFailures ?? 0, 6));
      this.cleanupFailures = (this.cleanupFailures ?? 0) + 1;
      this.armRoom(Date.now() + delay);
      if (!this.netCleanupRetry) {
        this.netCleanupRetry = setTimeout(() => { this.netCleanupRetry = null; if (generation === this.cleanupGeneration) this.queueNetCleanup(false); }, delay);
        this.netCleanupRetry?.unref?.();
      }
    });
    this.ctx.waitUntil(this.netCleanup);
  }

  retryCleanup(error) {
    this.cleanupPending = true; this.storageProblem(error);
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.cleanupFailures ?? 0, 6));
    this.cleanupFailures = (this.cleanupFailures ?? 0) + 1;
    this.armRoom(Date.now() + delay);
    // An alarm write can fail as well. Keep the end pending for this object's lifetime.
    if (!this.cleanupRetry) {
      this.cleanupRetry = setTimeout(() => { this.cleanupRetry = null; if (this.cleanupPending) this.clearRoom(); }, delay);
      this.cleanupRetry?.unref?.();
    }
  }

  finishRoom(why) {
    this.hostRt?.stop(); this.hostRt = null;
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.saveRetry); this.saveRetry = null; this.saveRetryAt = 0;
    this.clearRoom();
    const room = this.room;
    if (room) {
      this.officeSaved = room.officeSaved();
      room.ended = { why, ver: hostedBuild(this.game)?.build ?? null };
      for (const w of room.watchers) { try { w.close(1000, 'room-over'); } catch { /* gone */ } }
      room.watchers.clear();
    }
    this.tellLobby({ ended: true });
    this.say({ ev: 'host-over', why, build: hostedBuild(this.game)?.build, ...(why === 'restore loop' ? { message: 'This room shares its isolate and may not be the cause.' } : {}) });
    this.room = null; this.endedRoom = null; this.pausedAt = null;
  }

  /** The room wants the alarm at `at` (ms): set it unless an earlier one is already waiting. */
  armRoom(at) {
    this.roomAlarmAt = at;
    this.alarmWrite = (this.alarmWrite ?? Promise.resolve()).then(async () => {
      const cur = await this.ctx.storage.getAlarm();
      if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
      this.alarmFailures = 0;
    }).catch((error) => {
      this.storageProblem(error);
      if (this.alarmRetry) return;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.alarmFailures ?? 0, 6));
      this.alarmFailures = (this.alarmFailures ?? 0) + 1;
      this.alarmRetry = setTimeout(() => { this.alarmRetry = null; this.armRoom(this.roomAlarmAt); }, delay);
      this.alarmRetry?.unref?.();
    });
    this.ctx.waitUntil(this.alarmWrite);
  }

  /**
   * The rules failed again and again (rules/host.ts: the budget on every tick for two seconds, or slow ticks for
   * five): the room ends. Its players are told, their seats are freed, and the next visitor starts a fresh room.
   */
  endHosted(why) {
    const room = this.room;
    if (!room) return;
    this.finishRoom(why);
    this.hostRt = null;
    for (const c of [...room.clients.values()]) {
      if (c.helloed) room.error(c, 'room-over', 'This room ended. Joining a fresh room.', { rematch: true, ver: room.ended.ver });
      room.clients.delete(c.id);
      try { c.conn.close(1011, 'room-over'); } catch { /* gone */ }
    }
    room.emptySince = Date.now();
    room.forget();
    this.report();
  }

  /**
   * The room's part of the alarm (section 4.5 of the design). A room nobody came back to within a minute of its
   * pause ends: the relay forgets it and its stored seats go (`office` and `recorded` stay). A room in play keeps an
   * alarm ahead of it, so one that Cloudflare restarted and nobody returned to is still ended. After a restart there
   * is no room in memory: stored seats of a server-hosted room that nobody reconnected to are deleted.
   */
  async roomAlarm() {
    try { await this.runRoomAlarm(); this.roomAlarmFailures = 0; }
    catch (error) {
      this.storageProblem(error);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.roomAlarmFailures ?? 0, 6));
      this.roomAlarmFailures = (this.roomAlarmFailures ?? 0) + 1;
      this.armRoom(Date.now() + delay);
    }
  }

  async runRoomAlarm() {
    if (this.netCleanupFailed) this.queueNetCleanup(false);
    if (this.cleanupPending) this.clearRoom();
    const now = Date.now();
    const room = this.room;
    if (!room || !this.hostRt) {
      if (this.ctx.storage.sql?.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'save'").toArray().length) {
        this.durable ??= roomStore(this.ctx.storage);
        const saved = this.cleanupPending ? null : this.readRoom(true);
        if (saved) {
          this.game = saved.game; this.code = saved.room;
          if (saved.stateHash !== hostedBuild(saved.game)?.stateHash) { this.finishRoom('state-changed'); return; }
          // No saved pause means people were present. The first cold wake starts the absence period.
          if (saved.pausedAt === null) {
            this.pausedAt ??= now; saved.pausedAt = this.pausedAt; this.durable.write(saved);
          }
          const endAt = roomEndAt({ people: 0, pausedAt: saved.pausedAt, createdAt: now });
          if (now < endAt) { this.armRoom(endAt); return; }
          this.finishRoom('nobody-returned');
        }
      }
      if (this.saved?.hosted === 'server') { const was = this.saved.room ?? null; this.saved = null; await this.ctx.storage.delete('net').catch(() => {}); this.say({ ev: 'host-over', why: 'nobody-returned', room: was }); }
      return;
    }
    if (!this.hostRt) return;
    const endAt = roomEndAt({ people: this.hostRt.people, pausedAt: this.pausedAt, createdAt: this.hostCreatedAt });
    if (endAt === Infinity) { if (now >= this.roomAlarmAt - 1000) this.armRoom(now + ROOM_ALARM_MS); else this.armRoom(this.roomAlarmAt); return; }
    if (now < endAt) { this.armRoom(endAt); return; }
    // Nobody returned: neither watchers nor AI seats keep the paused room.
    this.finishRoom('nobody-returned');
    for (const c of [...room.clients.values()]) { if (c.helloed) room.error(c, 'room-over', 'Everyone left, so this room ended.', { rematch: true }); room.clients.delete(c.id); try { c.conn.close(1000, 'room-over'); } catch { /* gone */ } }
    room.forget();
    this.report();
  }

  /**
   * One log line of this room: `{ at, ev, game, room, … }`. Never a seat token, a ticket, a browser key or an address;
   * a failure goes to the error stream, everything else to the log (and not at all with HOMIE_ROOM_LOG=0).
   */
  say(line) {
    if(line?.ev==='hello'&&!line.resumed&&line.seat!==null) this.queueFunctionEvent('player.joined',{game:this.game,room:line.room,player:this.room?.clients.get(line.id)?.conn?.player??null,seat:line.seat});
    const bad = line?.ev === 'failed' || line?.ev === 'socket-error' || line?.ev === 'tick-failed' || line?.ev === 'persist-failed';
    if (!bad && this.env.HOMIE_ROOM_LOG === '0') return;
    try { console[bad ? 'error' : 'log'](JSON.stringify({ at: new Date().toISOString(), ...line, game: this.game ?? null, room: line?.room ?? this.code ?? null })); } catch { /* no console */ }
  }

  queueFunctionEvent(type,data) {
    if(!this.env.DB || this.env.HOMIE_PREVIEW==='1' || !this.ctx.storage.sql) return;
    const sql=this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS function_outbox(id TEXT PRIMARY KEY,type TEXT,data TEXT,at INTEGER)');
    sql.exec('INSERT INTO function_outbox VALUES(?,?,?,?)',crypto.randomUUID(),type,JSON.stringify(data),Date.now());
    this.armRoom(Date.now()+60000);
    this.ctx.waitUntil(this.flushFunctionEvents());
  }
  async flushFunctionEvents() {
    const sql=this.ctx.storage.sql;
    if(!sql || !this.env.DB)return;
    if(!sql.exec("SELECT name FROM sqlite_master WHERE name='function_outbox'").toArray().length)return;
    const {emitEvent}=await import('./functions.mjs');
    for(const row of sql.exec('SELECT * FROM function_outbox').toArray()) {
      try {await emitEvent(this.env,row.type,JSON.parse(row.data),{id:row.id,at:row.at});sql.exec('DELETE FROM function_outbox WHERE id=?',row.id);}
      catch {this.armRoom(Date.now()+60000);await this.alarmWrite;return;}
    }
  }

  /**
   * A socket's `error` event. The runtime raises one when the other end simply went away ("Network connection lost":
   * a closed tab, a phone that slept, a browser the test harness shut): that is a departure, and the room handles it
   * as one. Anything else is a failed socket, logged as such. Both lines carry the room, the client and its role.
   */
  socketError(kind, event, facts = {}) {
    const error = event?.error ?? event?.message ?? event;
    const gone = departure(error) || !error || typeof error === 'object' && !error.message;
    this.say({ ev: gone ? 'socket-gone' : 'socket-error', kind, ...facts, error: errorLine(error) });
  }

  /** Kept chat's writes, in order, each finished before the next (D1 calls from one room never pass each other). */
  keptQueue(fn) {
    if (!this.env.DB) return;
    this.kept = (this.kept ?? Promise.resolve()).then(fn).catch((error) => { try { console.log(JSON.stringify({ ev: 'chat-history-failed', room: this.code, error: String(error?.message ?? error).slice(0, 200) })); } catch { /* no console */ } });
    this.ctx.waitUntil(this.kept);
  }

  /** A room that keeps history puts what it kept back in its window before its first page opens (once per opening). */
  async hydrateHistory(room) {
    const days = room.chatRules().history;
    if (!(days > 0) || room.hydrated || !this.env.DB) return;
    room.hydrated = true;
    try { await this.kept; room.hydrate(await historyOf(this.env, this.game, this.code, { days })); } catch { /* the window alone (before migration 0009) */ }
  }

  /** Whether this game asked for decisions (game.json "decide": true, in the built catalogue), read once a minute. */
  async decideOn() {
    if (this.decideRead && Date.now() - this.decideRead.at < 60_000) return this.decideRead.on;
    let on = false;
    try {
      const res = this.env.ASSETS ? await this.env.ASSETS.fetch(new Request('https://assets.local/games.json')) : null;
      const cat = res?.ok ? await res.json() : null;
      const g = (cat?.games ?? []).find((x) => x.id === this.game);
      on = Boolean(g && (g.decide === true || (g.decide && typeof g.decide === 'object' && g.decide.on !== false)));
    } catch { on = false; }
    this.decideRead = { at: Date.now(), on };
    return on;
  }

  /**
   * One of a game's own decisions (worker/brain.mjs checkDecide, picksOf): Clef on the studio's Workers AI (model
   * HOMIE_DECIDE_MODEL, else clef-flash), or the person's own Ollama under `homie-studio dev`, within the AI brains' day
   * (the same budget the guides spend: decisions and guides are one day of neurons). Not opted in, no AI, over budget, too
   * slow or failed: `{ ok: false, why }`, and the host's floor answers.
   */
  async decide(state, questions) {
    if (!(await this.decideOn())) return { ok: false, why: 'off' };
    const local = this.env.AI ? null : localAiOf(this.env);
    if (!this.env.AI && !local) return { ok: false, why: 'no-ai' };
    if (this.env.AI) {
      if (!this.brainDay || Date.now() - this.brainReadAt > 60_000) await this.readBrainDay().catch(() => {});
      if (this.brainCap.neurons - this.brainUsed.neurons <= 0) return { ok: false, why: 'budget' };
    }
    const model = CLEF.models[this.env.HOMIE_DECIDE_MODEL] ? this.env.HOMIE_DECIDE_MODEL : '@cf/cloudflare/clef-flash';
    const t0 = Date.now();
    try {
      const r = await clefRun(this.env, { state, questions, model, ms: DECIDE.ms, local });
      const ms = Date.now() - t0;
      const usage = r.usage ?? { input_tokens: Math.ceil(JSON.stringify({ state, questions }).length / 4) + 400, output_tokens: 0 };
      const cost = costOf({ provider: r.engine === 'local' ? 'local' : 'workers-ai', model: r.model, usage });
      this.brainSpend({ neurons: cost.neurons, micros: 0, provider: r.engine === 'local' ? 'decide-local' : 'decide' });
      this.flushSoon();
      const { picks, p } = picksOf(r.answers, questions);
      return { ok: true, by: r.engine === 'local' ? 'local' : 'ai', picks, p, ms, neurons: cost.neurons };
    } catch (error) {
      return { ok: false, why: /took over/.test(String(error?.message ?? error)) ? 'slow' : 'error' };
    }
  }

  /** The day's counters go to D1 on an alarm: set one a minute out when none is set (a house guide's alarm also flushes). */
  flushSoon() {
    this.ctx.waitUntil((async () => { if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 60_000); })().catch(() => {}));
  }

  /**
   * One typed chat message, reviewed by the studio's decision model (worker/chat.mjs reviewChat) within the day's
   * budget for the whole studio. No binding (`homie-studio dev` without --remote-ai), no budget left, or an error: the
   * floor alone has decided (`by` says which), and the message goes out.
   */
  async reviewChat(text, { links = 'block' } = {}) {
    // Under `homie-studio dev` with no binding, the person's own Ollama reviews (free, so no budget).
    if (!this.env.AI) {
      if (!localAiOf(this.env)) return { ok: true, by: 'none' };
      try { const v = await reviewChat(this.env, text, { links }); return { ok: v.ok, by: 'local', why: v.why, ms: v.ms, p: v.p }; } catch { return { ok: true, by: 'error' }; }
    }
    if (this.chatCap === null || Date.now() - this.chatReadAt > 60_000) await this.readChatDay().catch(() => {});
    if (this.chatUsed >= (this.chatCap ?? 0)) return { ok: true, by: 'budget' };
    try {
      const v = await reviewChat(this.env, text, { links });
      this.chatUsed += v.neurons;
      this.chatPend.neurons += v.neurons;
      this.chatPend[v.ok ? 'ok' : 'held'] += 1;
      return { ok: v.ok, by: 'ai', why: v.why, ms: v.ms, p: v.p };
    } catch (error) {
      this.chatPend.error += 1;
      try { console.log(JSON.stringify({ ev: 'chat-review-failed', room: this.code, error: String(error?.message ?? error).slice(0, 200) })); } catch { /* no console */ }
      return { ok: true, by: 'error' };
    }
  }

  async readChatDay() {
    const day = await chatDay(this.env, today());
    this.chatCap = day.budget.neurons;
    this.chatUsed = day.used.neurons + this.chatPend.neurons;
    this.chatReadAt = Date.now();
  }

  /** Chat's counts into D1 (stats_daily): lines, reactions, held by why, reviews and neurons. Never a message or a sender. */
  async flushChat() {
    const s = this.room?.stats;
    if (!s || !this.env.DB) return;
    const game = this.game ?? '';
    const rows = [];
    for (const [k, metric] of [['chatLines', 'chat-lines'], ['chatReacts', 'chat-reacts']]) {
      const d = (s[k] ?? 0) - (this.chatSent[k] ?? 0);
      if (d > 0) { rows.push(counter(this.env, { metric, subject: game, n: d })); this.chatSent[k] = s[k]; }
    }
    for (const [why, n] of Object.entries(s.chatHeld ?? {})) {
      const d = n - (this.chatSent.held[why] ?? 0);
      if (d > 0) { rows.push(counter(this.env, { metric: 'chat-held', subject: game, source: why, n: d })); this.chatSent.held[why] = n; }
    }
    const p = this.chatPend;
    for (const k of ['ok', 'held', 'error']) if (p[k]) rows.push(counter(this.env, { metric: 'chat-reviews', subject: game, source: k, n: p[k] }));
    const neurons = Math.floor(p.neurons);
    if (neurons) rows.push(counter(this.env, { metric: 'chat-neurons', subject: game, n: neurons }));
    this.chatPend = { neurons: p.neurons - neurons, ok: 0, held: 0, error: 0 };
    const list = rows.filter(Boolean);
    if (list.length) await this.env.DB.batch(list).catch(() => {});
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
        // The room's own alarm (a paused server-hosted room ends on it) is never pushed back by a guide's.
        setAlarm: (at) => { this.ctx.storage.setAlarm(this.roomAlarmAt > Date.now() ? Math.min(at, this.roomAlarmAt) : at).catch(() => {}); },
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
    await this.flushFunctionEvents();
    // A brain that throws never takes the room with it: the alarm is not retried, the guides answer from the floor.
    try { if (this.house) await this.house.onAlarm(); } catch (error) { try { console.log(JSON.stringify({ ev: 'brain-alarm-failed', room: this.code, error: String(error?.stack ?? error).slice(0, 400) })); } catch { /* no console */ } }
    try { await this.flushBrain(); } catch { /* counted next time */ }
    try { await this.roomAlarm(); } catch (error) { this.say({ ev: 'failed', op: 'room-alarm', error: errorLine(error) }); }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const game = url.searchParams.get('game');
    const code = url.searchParams.get('room');
    const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
    if (url.pathname === '/__restart') {
      if (this.env.HOMIE_PREVIEW !== '1' || request.method !== 'POST') return new Response('not found', { status: 404 });
      // No last-chance save: this measures exactly what a real abrupt restart can lose.
      setTimeout(() => this.ctx.abort('Preview forced restart'), 25);
      return json({ ok: true });
    }
    const room = this.roomFor(game, code, max);
    // The back office (worker/office.mjs), from the studio's Worker only: the room as its owner sees it, and the
    // owner's signed controls, which this room verifies before it applies one (NETPLAY.md section 15).
    if (url.pathname === '/__facts') return json({ ...room.officeFacts(), durability: this.storageHealth ?? { ok: true }, ...(this.house ? { brains: this.house.facts() } : {}) });
    // A chat line as the room keeps it (section 19), for a report: the Worker files the room's own copy, never a reporter's.
    if (url.pathname === '/__chat') {
      const id = url.searchParams.get('id');
      // A line older than the window is in the room's kept history, when it keeps one (0.29.0).
      const r = room.chatLog.find((x) => x.id === id) ?? (room.chatRules().history > 0 ? await keptLine(this.env, this.game, this.code, id) : null);
      return json({ ok: Boolean(r), line: r ? { id: r.id, kind: r.kind, text: r.text ?? null, glyph: r.glyph ?? null, name: r.name, seat: r.seat, at: r.at, by: r.by, player: r.from?.player ?? null, owner: Boolean(r.owner), mod: Boolean(r.mod) } : null });
    }
    if (url.pathname === '/__mcp-event') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why || ctl.op !== 'mcp-event' || !/^external:[a-z][a-z0-9_-]{0,40}$/.test(ctl.args?.event ?? '')) return json({ ok: false, error: 'refused' }, 403);
      if (!room.live().length) return json({ ok: false, error: 'room empty; use records for lasting changes' }, 409);
      const event = { t: 'ev', from: null, k: ctl.args.event, d: ctl.args.data, external: true };
      if (room.server) room.toServer(event);
      for (const client of room.live()) room.send(client, event);
      return json({ ok: true });
    }
    if (url.pathname === '/__mcp') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why || ctl.op !== 'mcp-seat') return json({ ok: false, error: 'refused' }, 403);
      const result = await (await import('./mcp-room.mjs')).roomSeat(this, room, ctl);
      return json(result, result.ok ? 200 : 403);
    }
    if (url.pathname === '/__office') {
      const ctl = await request.json().catch(() => null);
      const why = await verifyControl(this.env, ctl, { game: this.game, room: this.code }, this.seen);
      if (why) return json({ ok: false, error: 'refused', why }, 403);
      // A Lounge card waits for the studio's review (0.29.0); every other control answers at once.
      const res = await room.control(ctl.op, ctl.args && typeof ctl.args === 'object' ? ctl.args : {});
      // AI talk turned off (a policy) or a guide kicked: the house guides follow at once.
      if (this.house) this.house.sync();
      await this.ctx.storage.put('office', room.officeSaved()).catch(() => {});
      if (ctl.op === 'close' && res.ok) this.tellLobby({ closed: ctl.args?.reopen ? 0 : res.until });
      this.report();
      return json(res);
    }
    room.rules = url.searchParams.get('rules') === '1';
    // Any tick rate a game may declare (1 to 60): the relay's allowances are the page's, from the same table.
    const hz = Number(url.searchParams.get('hz'));
    room.tickHz = Number.isInteger(hz) && hz >= 1 && hz <= 60 ? hz : 20;
    // The owner's room size: a room already open takes it from the next visitor on.
    if (room.seatCap !== max || room.rules && room.maxPlayers !== max) room.setSeats(max, perAddress(max));
    // Revision 9: the game's own stall time and the build that is live now, the Worker's word with every socket.
    const said = url.searchParams.has('cur');
    if (said) { room.setStall(url.searchParams.get('stall')); room.setCurrent(url.searchParams.get('cur') || null); }
    // Restore before applying the Worker's current policy: a save must not replace a newer policy.
    this.ensureHost(room, url.searchParams.get('host') === 'server');
    // The room's policy (section 17), composed by the Worker for every socket: a newer one than the room's applies.
    const pol = decodeFacts(url.searchParams.get('pol'));
    // The room's chat rules ride beside it (they may be longer than a policy): section 19.
    const chatRules = decodeFacts(url.searchParams.get('chat'), 16384);
    if (pol && chatRules && typeof chatRules === 'object') pol.chat = chatRules;
    if (pol) room.setPolicy(pol);
    if (this.house) this.house.sync();
    const agent = decodeFacts(url.searchParams.get('ag'));
    // Kept chat (0.29.0): the room's history is back in its window before this page hears it.
    await this.hydrateHistory(room);
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
      // A badge the player's account owns (the shop): the Worker looked it up; a hello cannot set one.
      ...(url.pathname === '/__net' && /^[\p{L}\p{N} .'&+-]{1,16}$/u.test(url.searchParams.get('bd') ?? '') ? { badge: url.searchParams.get('bd') } : {}),
      watchPolicy: WATCH_POLICIES.includes(url.searchParams.get('wp')) ? url.searchParams.get('wp') : 'follow',
      // House QA and `homie-studio check` mark their browsers; their rooms, rounds and peaks are not the studio's numbers.
      qa: isQa(request),
      // The build this socket's page was served with (section 23), from the socket's own address: only when the
      // Worker speaks of builds at all (`cur`), so a relay behind an older Worker reads the hello's own.
      ...(said && url.pathname === '/__net' ? { ver: url.searchParams.get('gv') || null } : {}),
      // Room chat (section 19), the Worker's word: a signed-in account (a passkey), a member of this server, a page of
      // another site (homie.rocks's room page) watching from elsewhere.
      acct: url.searchParams.get('acct') === '1',
      member: url.searchParams.get('mem') === '1',
      hub: url.pathname === '/__watch' && url.searchParams.get('hub') === '1',
      // The Lounge (0.29.0): the signed-in account's name and a moderator's mark, the Worker's word on a watch socket.
      ...(url.pathname === '/__watch' && url.searchParams.get('nm') ? { name: String(url.searchParams.get('nm')).slice(0, 40) } : {}),
      ...(url.pathname === '/__watch' && url.searchParams.get('mod') === '1' ? { mod: true } : {}),
      send: (text) => { try { server.send(text); } catch { /* closed */ } },
      close: (c, r) => { try { server.close(c, r); } catch { /* closed */ } },
      buffered: () => 0,
    };
    if (url.pathname === '/__watch') {
      // Watching shells are cheap (outgoing is free) but not free: a room holds at most 256, and 24 from one address
      // (room chat, 0.23.0: another site's page can open one too).
      const same = conn.ip ? [...room.watchers].filter((x) => x.ip === conn.ip).length : 0;
      if (room.watchers.size >= 256 || same >= 24) { try { server.close(1013, 'too many watching'); } catch { /* gone */ } return new Response(null, { status: 101, webSocket: client }); }
      const w = room.watch(conn);
      // The play page's vote card speaks on this socket (section 17); nothing else it says is read.
      server.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') return;
        try { w.onMessage(e.data); } catch (error) { this.say({ ev: 'failed', op: 'watch-message', error: errorLine(error) }); }
      });
      server.addEventListener('close', () => w.onClose());
      server.addEventListener('error', (e) => { this.socketError('watch', e); w.onClose(); });
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
      const left = (via) => {
        const c = room.clients.get(h.id);
        if (c?.agent && c.helloed && c.seat !== null && !conn.qa) {
          const minutes = Math.round((Date.now() - c.joinedAt) / 60_000);
          if (minutes > 0) this.ctx.waitUntil(count(this.env, null, { metric: 'agent-minutes', subject: this.game ?? '', source: c.agent.role, n: minutes }).catch(() => {}));
        }
        // The room says the departure itself (its `leave` line: who, which seat, host or not, how many are left).
        h.onClose(via);
        try { this.report(); } catch (error) { this.say({ ev: 'failed', op: 'report', error: errorLine(error) }); }
      };
      server.addEventListener('close', () => left('close'));
      // A lost network arrives here, not as a close: said as what it is, with the client it was, then handled as the
      // departure it is. (An error with a listener is never the runtime's "Uncaught".)
      server.addEventListener('error', (e) => {
        const c = room.clients.get(h.id);
        this.socketError('net', e, { id: h.id, seat: c?.seat ?? null, role: c && c.helloed ? room.roleOf(c) : null });
        left('error');
      });
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
      // A beat that throws is one failed beat, said with its room; the next one still runs.
      try { room.tick(); } catch (error) { this.say({ ev: 'tick-failed', clients: room.clients.size, error: errorLine(error) }); }
      // A room that just opened reads its game's launch state once: a change made in the moment it opened (before the
      // Lobby knew of it) still reaches it, after the current round as always.
      if (room.openedAt && this.launchReadFor !== room.openedAt) { this.launchReadFor = room.openedAt; this.ctx.waitUntil(this.rereadLaunch().catch(() => {})); }
      // A launch change the room applied by itself (after its round): its stored state says so too.
      if (room.officeDirty) { room.officeDirty = false; this.ctx.storage.put('office', room.officeSaved()).catch(() => {}); }
      n += 1;
      if (n % 4 === 0) { room.tellWatchers(); this.report(); this.recordRound(); this.syncHouse(); }
      // Room chat's counts, once a minute (section 19).
      if (n % 240 === 0) this.ctx.waitUntil(this.flushChat().catch(() => {}));
      // A server-hosted room in play keeps its alarm ahead of it (re-armed every five minutes of play).
      if (n % 1200 === 0 && this.hostRt?.running) this.armRoom(Date.now() + ROOM_ALARM_MS);
      if (room.seats.size === 0 && room.clients.size === 0) this.openCounted = false;
      if (room.clients.size === 0 && room.watchers.size === 0) { clearInterval(this.timer); this.timer = null; this.report(); this.ctx.waitUntil(this.flushChat().catch(() => {})); if (this.house) { this.ctx.waitUntil(this.flushBrain(true).catch(() => {})); this.house = null; } }
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
    if(extra.closed || extra.ended) this.queueFunctionEvent('room.closed',{game:this.game,room:this.code,...extra});
    if (!this.game || !this.code) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.lastReport = -1;
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players: 0, people: 0, ...extra }) }).catch(() => {}));
  }

  /** Tell the Lobby how many players this room has, when it changes. */
  report() {
    const room = this.room;
    if (!room || !this.game || this.endedRoom) return;
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
    // The build this room runs (section 23): the Lobby sends a visitor only to a room of the live build.
    const ver = room.gameVer === undefined ? undefined : room.gameVer ?? '';
    this.ctx.waitUntil(lobby.fetch(`https://lobby/report?game=${encodeURIComponent(this.game)}`, { method: 'POST', body: JSON.stringify({ room: this.code, players, people, agents, ai, ...(ver !== undefined ? { ver } : {}) }) }).catch(() => {}));
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
/** How many builds of a game besides the live one may have Lobby rooms on one server at once (standalone copies name their own). */
export const LOBBY_APP_VERSIONS = 8;
/** How many rooms a game's Lobby keeps in all. Its list is one stored value: 512 rooms is about a third of what one may hold. */
export const LOBBY_ROOMS_MAX = 512;

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
        for (const r of saved.rooms ?? []) this.rooms.set(r.name, { ...r, server: r.server ?? roomServer(r.name), agents: r.agents ?? 0, ai: r.ai ?? 0, ver: typeof r.ver === 'string' ? r.ver : '', pending: [], agentPending: [] });
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

  save() { this.ctx.storage.put('lobby', { next: this.next, rooms: [...this.rooms.values()].map(({ name, players, agents, ai, server, at, ver }) => ({ name, players, agents, ai, server, at, ...(ver ? { ver } : {}) })), closed: [...this.closed] }).catch(() => {}); }

  prune(now) {
    for (const [name, r] of this.rooms) {
      r.pending = r.pending.filter((t) => now - t < 20_000);
      r.agentPending = (r.agentPending ?? []).filter((t) => now - t < 20_000);
      if (r.players === 0 && !r.pending.length && now - r.at > 120_000) this.rooms.delete(name);
    }
  }

  /** A request that throws is said with what it was (never its body) and answered as a failure, not left uncaught. */
  async fetch(request) {
    try { return await this.answer(request); } catch (error) {
      let path = '';
      try { path = new URL(request.url).pathname; } catch { /* not an address */ }
      try { console.error(JSON.stringify({ at: new Date().toISOString(), ev: 'lobby-failed', game: this.game ?? null, path, error: errorLine(error) })); } catch { /* no console */ }
      return json({ ok: false, error: 'lobby' }, 500);
    }
  }

  async answer(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);
    // REVISIONS (section 23): rooms are matched within one build of the game. A room that never said its build is
    // the build of a game that names none ('').
    const ver = versionOf(url.searchParams.get('ver')) ?? '';
    if (url.pathname === '/join') {
      const max = Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(url.searchParams.get('max'))) || 8));
      const sid = url.searchParams.get('server') ?? 'public';
      const server = sid === 'public' || SERVER_ID.test(sid) ? sid : 'public';
      const roomsMax = Math.max(1, Math.min(16, Math.floor(Number(url.searchParams.get('rooms'))) || 16));
      // A room the owner closed, or one this visitor is held out of (`not`), is never the answer.
      const not = new Set(String(url.searchParams.get('not') ?? '').split(',').filter(Boolean));
      for (const [name, until] of this.closed) if (until <= now) this.closed.delete(name);
      // Every room of the server counts toward its `rooms_max` and its numbering; only this build's rooms are matched.
      const everyRoom = [...this.rooms.values()].filter((r) => (r.server ?? 'public') === server);
      const ofServer = everyRoom.filter((r) => !not.has(r.name) && !this.closed.has(r.name));
      const pool = ofServer.filter((r) => (r.ver ?? '') === ver);
      // A standalone copy names its own build (the Worker says `app=1`), and anybody can claim to be one: only a few
      // builds besides the live one ever have rooms here, so a caller that invents a build a request makes no pool.
      const app = url.searchParams.get('app') === '1';
      if (app && !everyRoom.some((r) => (r.ver ?? '') === ver) && new Set(everyRoom.map((r) => r.ver ?? '')).size > LOBBY_APP_VERSIONS) {
        return json({ ok: false, room: null, error: 'versions', message: 'Too many versions of this game are being played at once: play offline for now.' }, 503);
      }
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
      const fullest = (list) => list.reduce((a, b) => (b.players + b.pending.length > a.players + a.pending.length ? b : a), list[0]);
      if (!room && server !== 'public' && everyRoom.length >= roomsMax) {
        // Every room this server may have exists, whatever build each runs: the fullest one of this build, where the
        // visitor waits for a seat; with none of this build, the fullest of the server (its players are told a newer
        // build is live, and the visitor is let in when they have it). Never a room past the server's own number.
        const from = pool.length ? pool : ofServer;
        if (!from.length) return json({ ok: false, room: null, error: 'full', message: 'Every room of this server is taken.' }, 503);
        room = fullest(from);
        full = true;
      }
      if (!room && this.rooms.size >= LOBBY_ROOMS_MAX) {
        // The Lobby keeps a bounded list (it is one stored value): rooms nobody is seated in go first, the oldest
        // first. When every room has people in it, nobody gets a new one: this build's fullest, or no room at all.
        const empty = [...this.rooms.values()].filter((r) => r.players === 0).sort((a, b) => a.at - b.at);
        for (const r of empty) { if (this.rooms.size < LOBBY_ROOMS_MAX) break; this.rooms.delete(r.name); }
        if (this.rooms.size >= LOBBY_ROOMS_MAX) {
          if (!pool.length) return json({ ok: false, room: null, error: 'busy', message: 'Every room is taken right now.' }, 503);
          room = fullest(pool);
          full = true;
        }
      }
      if (!room) {
        let n = this.next[server] ?? 1;
        while (not.has(roomCode(server, n)) || this.closed.has(roomCode(server, n)) || this.rooms.has(roomCode(server, n))) n += 1;
        room = { name: roomCode(server, n), server, players: 0, agents: 0, ai: 0, at: now, ver, pending: [], agentPending: [] };
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
      if (body.ended === true) { this.rooms.delete(body.room); this.seen.delete(body.room); this.save(); return json({ ok: true }); }
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
      const r = this.rooms.get(body.room) ?? { name: body.room, server: roomServer(body.room), players: 0, agents: 0, ai: 0, at: now, ver: '', pending: [], agentPending: [] };
      const grew = Math.max(0, seated - r.players);
      // The room says which build it runs (it changes only when nobody on the old one is left).
      const rver = typeof body.ver === 'string' ? versionOf(body.ver) ?? '' : r.ver ?? '';
      const changed = !this.rooms.has(r.name) || r.players !== seated || (r.agents ?? 0) !== agents || (r.ai ?? 0) !== ai || (r.ver ?? '') !== rver;
      r.ver = rver;
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
        // A watcher's page runs the live build: a room still on an older one would turn it away.
        if (url.searchParams.has('ver') && (r.ver ?? '') !== ver) continue;
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
