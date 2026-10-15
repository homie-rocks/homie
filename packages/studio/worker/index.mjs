import {catalogue,builtPosts} from './catalogue.mjs';
import {trackBackground,requestDatabase,MUTATION_VERSION} from './request-db.mjs';
import {appGraphicsFallback} from './app-graphics.mjs';
import {JOIN_AREA_FRAME_JS} from './join-area.mjs';
import {loadShopLinks} from './shop-links.mjs';
import { directoryUrl } from './directory-choice.mjs';
import {APP_STORAGE_JS} from './app-frame.mjs';

import { RULES_WIRING_MESSAGE } from './rules-wiring.mjs';

export { useFunctions } from './function-registry.mjs';
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
import { departure, errorLine, versionOf } from './room-protocol.mjs';
import { hostedGame } from './hosted-registry.mjs';

import { appCors, isAppOrigin } from './standalone.mjs';
import {ROOM_ID,shellKey,shellStandIn,frameAncestors,embedAncestors} from './page-policy.mjs';
import { PUBLIC_SERVER, SERVER_ID, homeOf, memberCounts, memberOf, noteMember, policyOf, pooledRoom, roomServer, serverAccess, serverPassOf, serverView, serversOf, setMembership } from './servers.mjs';
import { agentFacts, aiName, encodeFacts, passById, passRefusal, sitRoute } from './agents.mjs';

import { REACTIONS } from './chat.mjs';
import { REPORT_REASONS, chatOf, chatRowsOf, fileReport } from './chat-store.mjs';

import { isLoungePath, loungeRoutes } from './lounge.mjs';
import { doorPage, serverPage, serversPage } from './site.mjs';
import { isLocalOrigin, qrSvg } from './qr.mjs';
import { gateFor } from './gate.mjs';

export { Gate, Concentrator } from './gate.mjs';
import { paramsFrom, seatsOf } from './seats.mjs';
import {
  SITE_JS, atomFeed, creditsPage, customPage, gameCover, gameLanding, gamesPage, homeLd, homePage, jsonFeed, landingLd, mediaArt, mediaIndexPage,
  notFoundPage, postPage, postsPage, roomView, roomsPage, sectionsOf, songPage, videoPage, watchOf,
} from './site.mjs';
import { cookieValues, count, countVisit, isQa, onlyOf, ownerAllowed, playedByGame, playedThisWeek, rangeOf, readStats, today } from './stats.mjs';

import { playerRoutes, players as playerAccounts } from './players.mjs';
import { appRoleSession, appAssetTicket, accessOf, accountSub, gatePage, holders, isOwner, joinHolders, launchOf, officeRoutes, publicCatalogue, redeemInvite, sameOrigin, seatsFor, settingsOf, ticketAllows, ticketFor, ticketSub, usePlayers } from './office.mjs';

// The back office knows the studio's player accounts: a signed-in player is named in the office and held by a kick on
// every device, and the owner's own account (`homie-studio players owner`) counts as the owner.

// The back office knows the studio's player accounts: a signed-in player is named in the office and held by a kick on
// every device, and the owner's own account (`homie-studio players owner`) counts as the owner.
usePlayers(playerAccounts);
import { STUDIO_BUILD } from './build-id.mjs';
import { STUDIO_VERSION_TAG } from './version.mjs';
import { reconcileOrders, readiness, roomBadge, shellShop, shopOf, shopRoutes } from './shop.mjs';
import { DISCOVERY_FILES, discoveryResponse, llmsTxt, robotsTxt, sitemapXml } from './discover.mjs';
import { ldScript, studioNode } from './schema.mjs';
import { licenseOf } from './license.mjs';
// GAME PARTS (parts/PARTS.md section 4): three call-outs below, everything else is worker/parts.mjs.
import { PART_FILES, isPartsPath, partsRoutes, withPartsBand } from './parts.mjs';

export { seatCount, SEAT_MAX } from './seats.mjs';
// Server-hosted games (NETPLAY.md section 29): the studio's site/src/worker.mjs hands the build's rules over with this.
export { hostRules } from './hosted-registry.mjs';
/** For a studio whose Worker has player accounts: hand their server API to the back office once (worker/office.mjs). */
export { usePlayers } from './office.mjs';
/** For a studio's own wrapper Worker: count its own pages the way the template counts its pages. */
export { countVisit } from './stats.mjs';
/** Players and cloud saves (saves/SAVES.md): `players.list`, `players.get`, `players.isOwner`… for the back office. */
export { players, cleanName } from './players.mjs';
/** How a guest's saves combine with the account's when they sign in (saves/SAVES.md): the studio's Worker calls it once, at load. */
export { mergeSaves } from './saves.mjs';

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** A game's own files, framed by its play page: never x-frame-options DENY. */
const GAME_FILES = /^\/[a-z0-9][a-z0-9-]{0,39}\/(?:__game|__assets)(?:\/|$)/;
const MEDIA_FILE = /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|opus|wav|flac)$/i;
/** A browser's room key (random, kept in the play page's own storage) and a play ticket, as they may appear in an address. */
const BROWSER_KEY = /^[A-Za-z0-9_-]{16,43}$/;
const TICKET_TEXT = /^[a-z0-9]{6,12}\.[A-Za-z0-9_~-]{1,140}\.[A-Za-z0-9_-]{32}$/;

const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

/** The posts with their HTML (site/dist/_site/posts.json), for a post's page and the feeds. */
/** The studio's shop when it really sells (shop.json checked, the key, the webhook secret and its tables in): its items
 * are a landing's offers (worker/schema.mjs). Else null: a landing never names a price nobody can pay. */
async function sellingShop(env, cat) {
  const shop = shopOf(cat);
  if (!shop || shop.broken) return null;
  try { return (await readiness(env, shop)).ready ? shop : null; } catch { return null; }
}

async function availableShellShop(env, cat, game, options) {
  // The shell can show a disabled catalog before payment setup is complete.
  // Checkout readiness is enforced by the shop API, separately from visibility.
  const preview = (cat.games ?? []).find(g => g.id === game)?.screen?.shopPreview === true;
  const shop = shopOf(cat);
  // Free services must retain their bridge in a mixed free/paid catalogue.
  // Paid readiness, policy and atomic booking capacity remain API decisions.
  const free = shop?.open && !shop.broken && shop.items.some(i => i.price === 0 && !i.interval && (!i.game || i.game === game));
  return (preview && !shop?.broken || free || await sellingShop(env, cat)) ? shellShop(cat, game, options) : null;
}

async function postsOf(env, origin) {
  const baked = await builtPosts();
  if (baked) return baked;
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
  return directoryUrl(cat?.studio?.directory);
}

/** This address's claim: kept, else asked of the directory now (and kept), else an older studio's single claim. */
async function claimOf(env, cat, url) {
  const origin = url.origin;
  const repo = repoOf(env);
  if (claimed.has(origin) && (!repo || repoSaid.get(origin) === repo)) return claimed.get(origin);
  const kept = await storedClaim(env, origin);
  if (kept?.own && (!repo || kept.repo === repo)) { claimed.set(origin, kept.own); if (repo) repoSaid.set(origin, repo); return kept.own; }
  if (kept?.older) return kept.older;
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
  const follow = /^(?:auto|overview|\d+)$/.test(url.searchParams.get('follow') ?? '') ? url.searchParams.get('follow') : 'auto';
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
    ...(meta.kind === 'app' ? {kind: 'app'} : {}),
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
  const fallback = meta?.kind === 'app' ? `<script>addEventListener('DOMContentLoaded',()=>(${appGraphicsFallback.toString()})(${JSON.stringify(meta.words?.fallback ?? 'This device cannot display the 3D scene. Use the text controls to continue.').replace(/</g, '\\u003c')}));</script>` : '';
  let assetBase='';
  const assetLaunch=meta.kind==='app'?launchOf(meta,await settingsOf(env,{fresh:true}),env):'public';
  if(meta.kind==='app'&&!url.pathname.includes('/__assets/')&&assetLaunch!=='public') {
    const ticket=await appAssetTicket(env,game,undefined,{request,meta,launch:assetLaunch});
    if(!ticket)return new Response('Sign in again to load this private app.',{status:403,headers:{'cache-control':'no-store'}});
    assetBase=`<base href="/${game}/__assets/${ticket}/">`;
  }
  const head = assetBase + `<script>${JOIN_AREA_FRAME_JS}</script>` + (meta.kind==='app'?`<script>${APP_STORAGE_JS}</script>`:'') + fallback + `${embedded ? `<script>${EMBED_GAME_JS}</script>` : ''}<script>window.HOMIE_NET=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${head}`) : head + html;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'access-control-allow-origin': '*',
      // The game runs in an opaque origin: it cannot read this site's storage or cookies.
      'content-security-policy': `sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups${meta.kind === 'app' ? ' allow-downloads' : ''}; frame-ancestors ${embedded ? `'self' ${embedAncestors(cat, url.origin, env.HOMIE_EMBED_PREVIEW === '1').replace("'none'", '')}` : frameAncestors(cat)}`,
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
  async queue(batch,env) {return (await import('./background-queue.mjs')).consumeBackground(batch,await loadShopLinks(env));},
  async scheduled(event, env, ctx) {
    env=await loadShopLinks(env);
    const analytics = event.cron === '17 * * * *' ? (await import('./analytics.mjs')).rollupAnalytics(env) : Promise.resolve();
    ctx.waitUntil(analytics);
    const maintenance=(async () => {
      const cat = await catalogue(env, 'https://studio.invalid');
      await notifyTools(env,cat,cat.studio?.url??'https://studio.invalid').catch(error=>console.warn('Tool catalogue refresh:',error.message));
      await reconcileOrders(env, shopOf(cat));
      if(env.DB)await (await import('./stripe-intake.mjs')).pruneStripeEvents(env);

      await (await import('./functions.mjs')).scheduleFunctions(event,env,cat,cat.studio?.url??'https://studio.invalid');
    })();
    ctx.waitUntil(maintenance);
    await Promise.all([maintenance, analytics]);
  },
  async fetch(request, env, ctx) {
    const staticPath=new URL(request.url).pathname;
    if(['GET','HEAD'].includes(request.method)&&staticPath==='/_homie/site.js')return finish(await route(request,env,ctx),staticPath);
    env=await loadShopLinks(env,new URL(request.url).origin);
    env={...env,DB:requestDatabase(env.DB,request)};
    const url = new URL(request.url);
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'content-type':'text/plain','x-robots-tag':'noindex, nofollow'}});
    if(env.HOMIE_CONCEPT==='1' && url.pathname==='/.well-known/homie-studio.json')return json({ok:false,error:'concept-unlisted'},404,{'x-robots-tag':'noindex, nofollow'});
    const dispatch=()=>import('./background-queue.mjs').then(m=>m.enqueueChanges(env,url.origin));
    // Some routes reconcile shop state in waitUntil after returning their page.
    // Keep dispatch behind those writes too, preserving the runtime context's
    // methods and OAuth verification symbols through the proxy.
    let delivered=0;
    let delivery=Promise.resolve();
    const background=trackBackground(ctx,()=>{
      // Serialize late completions and remember the generation acknowledged by
      // Queues. A read-only waitUntil never replays an earlier mutation.
      delivery=delivery.catch(error=>{console.error('Background enqueue retry',error);}).then(async()=>{
        const version=env.DB?.[MUTATION_VERSION]??0;
        if(version===delivered)return;
        await dispatch();delivered=version;
      });
      return delivery;
    });
    const requestCtx=background.context;
    // A standalone copy's Lobby call (worker/standalone.mjs): every answer to it can be read by the app's page, an
    // unknown game's 404 and a failure included, so the app can say why it plays offline. No other address is opened.
    const appRecords = isAppOrigin(request) && /^\/[^/]+\/api\/app\/records\//.test(url.pathname);
    if (appRecords && request.method === 'OPTIONS') return appCors(request, new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' } }));
    const appLobby = isAppOrigin(request) && /^\/[^/]+\/api\/lobby\/?$/.test(url.pathname);
    let res;
    try { res = finish(await route(request, env, requestCtx), url.pathname); } catch (error) {
      if (!appLobby) throw error;
      try { console.error(JSON.stringify({ at: new Date().toISOString(), ev: 'lobby-route-failed', path: url.pathname, error: errorLine(error) })); } catch { /* no console */ }
      res = json({ ok: false, error: 'failed' }, 500);
    } finally {
      // A route can commit a write and then fail. Its outbox still needs delivery.
      if(env.DB) {
        const delivery=background.finish();
        if(ctx?.waitUntil)ctx.waitUntil(delivery);else await delivery;
      }
    }
    if(env.HOMIE_CONCEPT==='1' && res.status!==101) {
      const headers=new Headers(res.headers);headers.set('x-robots-tag','noindex, nofollow');
      let body=res.body;
      if(/text\/html/i.test(headers.get('content-type')??'')) {
        const html=await res.text(),banner='<aside role="status" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;text-align:center;background:#ffda44;color:#171717;padding:6px;font:bold 14px system-ui;pointer-events:none">TEST / CONCEPT</aside>';
        body=/<body[^>]*>/i.test(html)?html.replace(/<body[^>]*>/i,m=>m+banner):banner+html;
        headers.delete('content-length');
      }
      res=new Response(body,{status:res.status,headers});
    }
    const bookmark=env.DB?.getBookmark?.();
    if(bookmark&&res.status!==101){const headers=new Headers(res.headers);headers.set('x-studio-bookmark',bookmark);res=new Response(res.body,{status:res.status,statusText:res.statusText,headers});}
    if (appLobby || appRecords) return appCors(request, res);
    return res;
  },
};

// Refresh once per isolate/binding, and again after studio mutations. No shared pending I/O.
async function notifyTools(env,cat,origin) {
  if(!env.DB||!env.LOBBY)return;
  const [{pushToolList},{builtins}]=await Promise.all([import('./event-resources.mjs'),import('./mcp-tools.mjs')]);
  await pushToolList(env,cat,[...builtins(env,cat,origin),...await studioTools()],origin);
}
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

  // Keep tool transports and discovery on the alias; redirect browser pages only.
  if (read && url.hostname.endsWith('.workers.dev') && env.HOMIE_PREVIEW !== '1'
      && request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
      && !/\/(?:api|__[a-z]+)(?:\/|$)/.test(path)
      && !/^\/(?:\.well-known(?:\/|$)|api(?:\/|$)|mcp(?:\/|$)|oauth(?:\/|$)|hooks(?:\/|$)|_studio(?:\/|$))/.test(path)) {
    const canonical = (await getAll()).studio?.canonical;
    if (canonical && canonical !== url.origin) return Response.redirect(canonical + url.pathname + url.search, 308);
  }

  if (path === '/_studio/office/functions') return (await import('./functions.mjs')).functionsRoute(request,env,await getAll());

  if (path === '/mcp' || path === '/mcp/auth' || path.startsWith('/hooks/tools/') || path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-') || path === '/_studio/office/connections') {
    const { remoteMcp } = await import('./mcp.mjs');
    return remoteMcp(request, env, ctx, { catalogueOf: getAll, definitions: await studioTools() });
  }

  // "Connect this chat" (the template's first-run band): the directory's setup page, for this site's address.
  if (path === '/_studio/connect' && read) {
    const directory = directoryOf(await getCat());
    if (!directory || env.HOMIE_PREVIEW === '1') return json({ ok: false, error: 'no-directory', message: 'This studio is not connected to a directory.' }, 404);
    return Response.redirect(`${directory}/studio/setup/connect?site=${encodeURIComponent(url.origin)}`, 302);
  }
  if (path.startsWith('/_studio/')) return (await officeRoutes(request, env, url, { catalogueOf: getAll })) ?? (await import('./stats-page.mjs')).ownerRoutes(request, env, url, { catalogueOf: getAll });
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
    const canonical = cat.studio?.canonical;
    if (canonical && env.HOMIE_PREVIEW !== '1' && url.protocol === 'https:') {
      const address = new URL(canonical); url.protocol = address.protocol; url.host = address.host;
    }
    const sharing = Boolean(cat.studio?.stats?.share);
    const [played, byGame] = sharing ? await Promise.all([playedThisWeek(env), playedByGame(env)]) : [null, null];
    // studio.json `"rooms": { "share": false }` keeps the rooms off the hub: a manifest that names no `rooms` shares none.
    const shareRooms = cat.studio?.rooms?.share !== false;
    return json({
      v: 1,
      kind: 'homie-studio',
      toolkit: STUDIO_BUILD,
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
      // The shop: whether it sells and its till, never a key or a sale.
      ...(shopOf(cat)?.open ? { shop: { open: true, till: shopOf(cat).till, currency: shopOf(cat).currency, page: `${url.origin}/shop/` } } : {}),
    }, 200, { 'access-control-allow-origin': '*' });
  }
  if (path === '/api/games') {
    const cat = await getCat();
    return json({ studio: cat.studio, games: (cat.games ?? []).map(g => g.room?.host === 'server' && !hostedGame(g.id) ? { ...g, rulesError: RULES_WIRING_MESSAGE } : g), live: await liveCounts(env, cat.games ?? []) });
  }
  if (path === '/api/rooms') {
    if(request.method!=='GET')return json({ok:false,error:'method'},405);
    const cat = await getCat();
    return (await import('./rooms-cache.mjs')).cachedRooms(request,env,ctx,cat,async()=>{
      const {rooms}=await roomsOf(env,cat.games??[]);
      return json({ok:true,playing:rooms.reduce((n,r)=>n+r.players,0),rooms},200,{'access-control-allow-origin':'*','cache-control':'public, max-age=15'});
    });
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
    if (path === '/robots.txt') return discoveryResponse(robotsTxt(cat, url.origin, { preview: env.HOMIE_PREVIEW === '1' || env.HOMIE_CONCEPT === '1' }), 'text/plain', { method });
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

  if(parts[0]==='games' && parts.length>2) {
    const all=await getAll(),app=(all.games??[]).find(g=>g.id===parts[1]&&g.kind==='app');
    if(app && launchOf(app,await settingsOf(env,{fresh:true}),env)!=='public')return json({ok:false,error:'not-found'},404);
  }
  const game = parts[0];
  if (game && GAME_ID.test(game)) {
    const all = await getAll();
    const meta = (all.games ?? []).find((g) => g.id === game);
    if (!meta) return fallback(request, env, url, getCat);
    if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/`, 301);
    let sub = parts.slice(1).join('/');
    // Game bundles were already public assets; only the document carries access context.
    // Apps retain their session/role checks even for individual asset files.
    if(read&&meta.kind!=='app'&&sub.startsWith('__game/')&&!['__game/','__game/index.html'].includes(sub))return gameAsset(request,env,url,game,sub.slice('__game/'.length));
    const cat = await getCat();
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
      const asset=/^__assets\/([^/]+)\/(.+)$/.exec(sub);
      if(asset) {
        if(!(await appAssetTicket(env,game,asset[1],{request,meta,launch})))return json({ok:false,error:'not-found'},404);
        const response=asset[2]==='index.html'?await gameDocument(request,env,url,game,meta,cat):await gameAsset(request,env,url,game,asset[2]);
        response.headers.set('cache-control','private, no-store');
        response.headers.set('referrer-policy','no-referrer');
        return response;
      }
      const frameTicket = ['__game','__game/','__game/index.html','__net','__watch'].includes(sub) && await ticketAllows(env, await ticketSub(env,game,url.searchParams.get('t')), launch);
      if (launch !== 'public' && !frameTicket && !(await accessOf(request, env, game, launch)).ok && (await (await import('./local-test.mjs')).localSession(request,env))?.app!==game) return json({ ok: false, error: 'not-found' }, 404);
      if(launch==='public') {
        const web=await (await import('./app-web.mjs')).appWeb(request,env,meta,url,sub,()=>gameDocument(request,env,url,game,meta,cat));
        if(web)return web;
      }
      const apiSession=async response=>{
        const access=await appAccess(request,env,meta,url);
        return access.ok?appRoleSession(response,request,env,meta,launch):response;
      };
      if(sub==='api/app/live') {
        if(request.method!=='GET')return new Response('GET required',{status:405});
        const {appHub}=await import('./app-streams.mjs');
        return apiSession(await appHub(env,meta.id).fetch('https://app/__app_records',{method:'POST',body:JSON.stringify({op:'open',meta,url:request.url,headers:Object.fromEntries(request.headers),collections:url.searchParams.getAll('collection')})}));
      }
      if(sub==='api/app/tools')return apiSession(await (await import('./app-tools.mjs')).appToolsRoute(request,env,meta,url,cat,await studioTools()));
      const api = await appRecordsRoute(request, env, meta, url, sub);
      if (api) return sub.startsWith('api/app/records/')?apiSession(api):api;
      if (['play', 'tv', 'watch'].includes(sub)) {
        let a;
        try { a = await appAccess(request, env, meta, url); } catch { return json({ ok: false, error: 'app roles unavailable; apply studio migrations' }, 503); }
        if (!a.ok) {
          if (a.status === 401) return Response.redirect(`${url.origin}/account/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
          return json({ ok: false, error: a.error }, a.status);
        }
        if(!meta.room)return appRoleSession((await import('./records-page.mjs')).recordsPage(meta,url,cat,await availableShellShop(env,cat,game),Boolean(await (await import('./local-test.mjs')).localSession(request,env)),launch!=='public'?await appAssetTicket(env,game,undefined,{request,meta,launch}):null),request,env,meta,launch);
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
    if (sub === 'play/preview' && env.HOMIE_EMBED_PREVIEW === '1' && isLocalOrigin(url.origin)) return (await import('./pages.mjs')).embedPreview(cat, meta, url.origin);
    if (sub === 'tv' || sub === 'play' || sub === 'play/embed') {
      const embed = sub === 'play/embed';
      if (embed && (!playerEnabled(cat, meta) || launch !== 'public')) return notFoundPage(meta.kind === 'app' ? 'This app does not open inside a post. Open its studio page.' : 'This game does not play inside a post. Open its studio page to play.', cat);
      const screen = !embed && (sub === 'tv' || url.searchParams.get('screen') === '1');
      const asked = embed ? null : askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return (await import('./pages.mjs')).badRoomPage(cat, meta, asked, { screen });
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
      if (meta.room?.characters && !screen && !embed && (!d.acct || !(await chatWho(env, game, srv, d.acct)).acct)) return Response.redirect(`${url.origin}/account/?next=${encodeURIComponent(url.pathname + url.search)}`, 303);
      // The owner hid the public server: Play shows the servers to pick from, and a named room is off (owner aside).
      if (srv.id === 'public' && publicHidden() && !d.owner) {
        if (named) return doorPage(cat, meta, srv, { why: 'closed' });
        return serversPage(cat, meta, { origin: url.origin, servers: await serverLive(env, meta, servers, url.origin, lobby), hidden: true, pick: true });
      }
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, days: d.days, origin: url.origin, next: `${url.pathname}${url.search}`, code: url.searchParams.get('invite') ?? '' });
      let recordsGuest=null;
      if(meta.room?.records&&!embed&&!screen&&!d.acct&&env.DB){
        const made=await playerAccounts.recordsGuest(request,env,url);if(made.error)return made.error;
        recordsGuest=made.session;d.acct='p-'+recordsGuest.player.id;d.holder=joinHolders(d.holder,d.acct);
      }
      if (d.acct?.startsWith('p-') && srv.id !== 'public') ctx?.waitUntil?.(noteMember(env, game, srv.id, d.acct.slice(2)));
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      const pol = policyFor(srv, named);
      const server = srv.id === 'public' && !pol.server ? null : { ...serverView(srv, { origin: url.origin, game }), mentor: Boolean(d.mentor) };
      if (screen) {
        await countVisit(request, env, ctx, game, 'screen');
        // The big screen picks its room now, so the QR it shows puts every phone in that same room.
        let room = asked;
        if (!room) {
          try { room = (await (await lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json()).room ?? null; } catch { room = null; }
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
        return appRoleSession((await import('./pages.mjs')).playPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, screen: true, joinUrl, qr, local, room, ticket, owner: d.owner, launch, server, shop: sh ? { ...sh, qr: shopQr, url: `${url.origin}/shop/?game=${game}` } : null }),request,env,meta,launch);
      }
      await countVisit(request, env, ctx, game, 'play');
      shareDaily(cat, url, ctx);
      const page=await appRoleSession((await import('./pages.mjs')).playPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, embed, preview: env.HOMIE_EMBED_PREVIEW === '1', ticket: embed ? null : ticket, owner: !embed && d.owner, launch, server, ...(embed ? {} : await chatWho(env, game, srv, d.acct)), shop: await availableShellShop(env, cat, game, { kids: pol.kids }) }),request,env,meta,launch);
      for(const cookie of recordsGuest?.cookies??[])page.headers.append('set-cookie',cookie);return page;
    }
    if (sub === 'watch') {
      // The same door as Play: a game that is private or an invite-only beta is watched only by whoever may play it.
      const asked = askedRoom;
      if (asked !== null && !ROOM_ID.test(asked)) return (await import('./pages.mjs')).badRoomPage(cat, meta, asked, { watch: true });
      if (!door.ok) return shut();
      const policy = watchOf(meta);
      if (policy === 'off') return (await import('./pages.mjs')).noWatchPage(cat, meta);
      // A server's door is its watch door too (an invite or an account); a beginner server is watched by anyone.
      const srv = asked !== null ? serverById(roomServer(asked)) : serverById('public') ?? PUBLIC_SERVER;
      if (!srv) return notFoundPage(`${meta.name} has no server for the room "${asked}".`, cat);
      const d = await pageDoor(srv, { watching: true });
      if (!d.ok) return doorPage(cat, meta, srv, { why: d.why, origin: url.origin, next: `${url.pathname}${url.search}`, watch: true });
      const ticket = d.holder ? await ticketFor(env, game, d.holder) : null;
      await countVisit(request, env, ctx, game, 'watch');
      shareDaily(cat, url, ctx);
      return (await import('./pages.mjs')).watchPage(cat, meta, { test: Boolean(await (await import('./local-test.mjs')).localSession(request,env)), origin: url.origin, room: asked, ticket, policy, owner: d.owner, ...(await chatWho(env, game, srv, d.acct)) });
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
      if (meta.room?.lifetime === 'persistent') {
        const room = srv.id === 'public' ? 'pub-1' : `s-${srv.id}-1`;
        if (not.split(',').includes(room)) return json({ ok: false, error: 'world-unavailable', message: 'This world is unavailable. Choose another named world.' }, 409);
        return json({ room, players: 0, max: humanSeats(pol), server: srv.id });
      }
      return lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${humanSeats(pol)}&server=${srv.id}&rooms=${srv.roomsMax}${not ? `&not=${encodeURIComponent(not)}` : ''}${ver ? `&ver=${encodeURIComponent(ver)}` : ''}${app ? '&app=1' : ''}`, { method: 'POST' });
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
            const r = await (await lobby().fetch(`https://lobby/join?host=${meta?.room?.host === 'server' ? 'server' : 'browser'}&max=${max}&server=${srv.id}&agent=1&ai=${reserve}${versionOf(meta?.netplay?.version) ? `&ver=${encodeURIComponent(versionOf(meta.netplay.version))}` : ''}`, { method: 'POST' })).json();
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
      const stub = sub === '__net' ? gateFor(env, game, room, max, b) : env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
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
      // A play page left open across a deploy (0.46.5). One that names what it was made for (`sh`) and is behind is
      // told so, and reloads itself whole, once, to the same room and seat. One from before that handshake is sent
      // to a fresh page only when this game cannot work inside it: the game keeps verified results for a player, and
      // the old page has no player ticket to give its frame (a result would have nobody to be written for).
      if (url.searchParams.get('pf') === '1' && url.searchParams.get('embed') !== '1' && url.searchParams.get('want') !== 'screen' && !url.searchParams.has('watch')) {
        const said = url.searchParams.get('sh'), now = shellKey(meta);
        const ticketless = Boolean(meta.room?.records && env.DB) && !holders(who).some((x) => x.startsWith('p-'));
        if (said !== null ? said !== now : ticketless) {
          return new Response(shellStandIn(url.searchParams.get('room') ?? '', said !== null ? now : null), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
        }
      }
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


export {Table} from './table.mjs';
export {roomEndAt} from './room-lifecycle.mjs';
export {Lobby} from './lobby.mjs';
export {LOBBY_APP_VERSIONS, LOBBY_ROOMS_MAX} from './lobby-limits.mjs';

export {AppRecordHub, EventHub} from './stream-objects.mjs';
