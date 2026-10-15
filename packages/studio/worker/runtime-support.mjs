import {studioTools,directoryOf} from './tool-registry.mjs';
export {useTools,getStudioTools} from './tool-registry.mjs';
import {json,finish} from './responses.mjs';
import {liveRoomSummaries} from './lobby-summary.mjs';
/** Shared catalogue, assets, and room presentation helpers. */
import {catalogue,builtPosts} from './catalogue.mjs';

import {appGraphicsFallback} from './app-graphics.mjs';
import {JOIN_AREA_FRAME_JS} from './join-area.mjs';

import { directoryUrl } from './directory-choice.mjs';
import {APP_STORAGE_JS} from './app-frame.mjs';

import { appRole } from './app-format.mjs';
import { playerEnabled, EMBED_GAME_JS } from './embed.mjs';
import { versionOf } from './room-protocol.mjs';

import { ROOM_ID, frameAncestors, embedAncestors } from './page-policy.mjs';
import { PUBLIC_SERVER, memberCounts, memberOf, roomServer, serverView, serversOf } from './servers.mjs';

import { chatOf, chatRowsOf } from './chat-store.mjs';

import { paramsFrom, seatsOf } from './seats.mjs';
import { mediaArt, notFoundPage, roomView, watchOf } from './site.mjs';
import { count, isQa, playedThisWeek, today } from './stats.mjs';
import { players as playerAccounts } from './players.mjs';
import { appAssetTicket, holders, launchOf, settingsOf } from './office.mjs';

import { STUDIO_VERSION_TAG } from './version.mjs';
import { readiness, shellShop, shopOf } from './shop.mjs';

import {PART_FILES} from './asset-paths.mjs';
import {defaultPlayers} from './player-registry.mjs';
defaultPlayers(playerAccounts);

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

import {GAME_FILES} from './asset-paths.mjs';

const MEDIA_FILE = /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|opus|wav|flac)$/i;

const BROWSER_KEY = /^[A-Za-z0-9_-]{16,43}$/;

const TICKET_TEXT = /^[a-z0-9]{6,12}\.[A-Za-z0-9_~-]{1,140}\.[A-Za-z0-9_-]{32}$/;



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

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

const repoOf = (env) => { const r = String(env.HOMIE_REPO ?? '').trim(); return REPO.test(r) && r.toLowerCase() !== 'homie-rocks/homie' ? r : null; };

const repoSaid = new Map();

export {directoryOf} from './tool-registry.mjs';

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

function named(cat, env) {
  if (!cat?.studio?.template || !env.STUDIO_NAME) return cat;
  return { ...cat, studio: { ...cat.studio, name: String(env.STUDIO_NAME).slice(0, 60) } };
}

async function roomsOf(env, games, { servers = null } = {}) {
  const rooms = [];
  const live = {};
  // Room chat (section 19): whether each room's chat is on and may show on homie.rocks's page for it.
  const chatRows = await chatRowsOf(env);
  const summaries=await liveRoomSummaries(env);
  await Promise.all(games.map(async (g) => {
    let list = [];
    if(summaries)list=summaries.get(g.id)??[];
    else try { list = (await (await env.LOBBY.get(env.LOBBY.idFromName(g.id)).fetch('https://lobby/rooms')).json()).rooms ?? []; } catch { list = []; }
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

const MEDIA_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { unsatisfiable: true };
  return { start, end };
}

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

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const bare = (t) => String(t).trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

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

const ASSET_CACHE = 'public, max-age=0, must-revalidate';

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

function mediaRow(e, origin, kind, cat) {
  const abs = (u) => (u && u.startsWith('/') ? `${origin}${u}` : u ?? null);
  const main = (e.files ?? []).find((f) => f.role === (kind === 'music' ? 'audio' : 'video'));
  return {
    slug: e.slug, kind: e.kind, title: e.title, blurb: e.blurb ?? '', duration: e.duration ?? null,
    page: `${origin}/${kind}/${e.slug}/`, [kind === 'music' ? 'audio' : 'video']: abs(main?.url), [kind === 'music' ? 'cover' : 'poster']: abs(mediaArt(e, kind, cat)),
    credits: e.credits ?? null, rights: e.rights ?? null, for: e.for ?? null,
  };
}

const KNOCK_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

async function chatWho(env, game, srv, holder) {
  const pid = holders(holder).find((x) => x.startsWith('p-'))?.slice(2) ?? null;
  if (!pid || !env.DB) return { acct: false, member: false };
  let acct = false;
  try { acct = Number((await env.DB.prepare('SELECT guest FROM players WHERE id = ?1').bind(pid).first())?.guest) === 0; } catch { acct = false; }
  const member = acct && (!srv || srv.id === 'public' || Boolean(await memberOf(env, game, srv.id, pid)));
  return { acct, member };
}

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

let sharedDay = null;

function shareDaily(cat, url, ctx) {
  if (!cat.studio?.stats?.share || url.protocol !== 'https:' || sharedDay === today()) return;
  sharedDay = today();
  const directory = String(cat.studio.directory ?? 'https://homie.rocks').replace(/\/+$/, '');
  const ping = fetch(`${directory}/api/studio/played`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: url.origin }) }).catch(error => console.warn("Directory play notification failed:",error.message));
  if (ctx?.waitUntil) ctx.waitUntil(ping);
}

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


async function notifyTools(env,cat,origin) {
  if(!env.DB||!env.LOBBY)return;
  const [{pushToolList},{builtins}]=await Promise.all([import('./event-resources.mjs'),import('./mcp-tools.mjs')]);
  await pushToolList(env,cat,[...builtins(env,cat,origin),...await studioTools()],origin);
}


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

async function weekOf(env, game) {
  const w = await playedThisWeek(env, game);
  if (!w) return null;
  let peak = 0;
  try { peak = (await (await env.LOBBY.get(env.LOBBY.idFromName(game)).fetch('https://lobby/now')).json()).peak?.players ?? 0; } catch { peak = 0; }
  return { plays: w.plays, rounds: w.rounds, ...(peak ? { peak } : {}) };
}

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
export {GAME_ID,POST_SLUG,GAME_FILES,MEDIA_FILE,BROWSER_KEY,TICKET_TEXT,json,sellingShop,availableShellShop,postsOf,CLAIM,claimed,claimMissed,storedClaim,REPO,repoOf,repoSaid,claimOf,named,roomsOf,MEDIA_SLUG,parseRange,assetWithRange,etagMatches,mediaObject,ASSET_CACHE,heldInR2,mediaRow,KNOCK_CORS,chatWho,reportsMade,reportAllowed,notAHomie,gameDocument,gameAsset,sharedDay,shareDaily,mediaBeat,finish,notifyTools,studioTools,serverLive,weekOf,fallback};
