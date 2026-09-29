/**
 * @homie-rocks/studio/worker — a studio's own site, on the studio's own Cloudflare.
 *
 * One Worker serves the studio's pages and its public rooms:
 *
 *   /                          the studio's home: every game, with a Play button
 *   /<game>/                   the game's page
 *   /<game>/play               the play shell: asks the Lobby for a public room and
 *                              boots the game in a sandboxed frame, seated at once
 *   /<game>/__game/...         the game's own files (index.html gets HOMIE_NET)
 *   /<game>/__net?room=        the room's netplay socket (Table Durable Object)
 *   /<game>/__watch?room=      the room's facts, for the shell
 *   /<game>/api/lobby          which public room to join (Lobby Durable Object)
 *   /api/games                 the catalogue plus live counts (D1 + Lobby)
 *   /.well-known/homie-studio.json   what the homie.rocks directory reads
 *   /media/<key>               the studio's large media, from R2 (when bound)
 *
 * Bindings (site/wrangler.jsonc, written by `homie-studio new`): ASSETS (the
 * built site), TABLE and LOBBY (SQLite-backed Durable Objects, free plan
 * friendly), DB (D1: plays, finished rounds, the directory claim) and, when
 * the account has R2, MEDIA.
 *
 * The relay is the netplay contract's own room.mjs (NETPLAY.md v1 rev 2), run
 * unchanged inside the Table, so a game that plays in `homie-studio dev`
 * plays the same way here.
 */
import { NetRoom } from './room.mjs';
import { gamePage, homePage, notFoundPage, playPage } from './pages.mjs';

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;
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

async function claimOf(env) {
  if (!env.DB) return null;
  try { return (await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('homie_claim').first())?.value ?? null; } catch { return null; }
}

async function liveCounts(env, games) {
  const out = {};
  await Promise.all(games.map(async (g) => {
    try {
      const res = await env.LOBBY.get(env.LOBBY.idFromName(g.id)).fetch('https://lobby/rooms');
      const rooms = (await res.json()).rooms ?? [];
      out[g.id] = rooms.reduce((n, r) => n + (r.players || 0), 0);
    } catch { out[g.id] = 0; }
  }));
  return out;
}

/** The game's index.html with HOMIE_NET ahead of its modules, in the site's sandbox (an opaque origin). */
async function gameDocument(request, env, url, game, meta) {
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/index.html`));
  if (!res.ok) return notFoundPage(`No build of "${game}" on this site yet.`);
  const room = ROOM_ID.test(url.searchParams.get('room') || '') ? url.searchParams.get('room') : 'main';
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
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      // The game runs in an opaque origin: it cannot read this site's storage or cookies.
      'content-security-policy': "sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups; frame-ancestors 'self'",
    },
  });
}

async function gameAsset(env, url, game, rest) {
  if (rest.includes('..')) return new Response('not found', { status: 404 });
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/games/${game}/${rest}`));
  const out = new Response(res.body, res);
  // Module scripts from the opaque-origin frame are CORS requests.
  out.headers.set('access-control-allow-origin', '*');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const parts = path.split('/').filter(Boolean);

    if (path === '/.well-known/homie-studio.json') {
      const cat = await catalogue(env, url.origin);
      return json({
        v: 1,
        kind: 'homie-studio',
        name: cat.studio?.name ?? env.STUDIO_NAME ?? 'Studio',
        slug: cat.studio?.slug ?? null,
        site: url.origin,
        studio: cat.studio?.version ?? null,
        claim: await claimOf(env),
        games: (cat.games ?? []).map((g) => ({
          id: g.id, name: g.name, blurb: g.blurb ?? '', players: g.players ?? null, roundSeconds: g.roundSeconds ?? null,
          page: `${url.origin}/${g.id}/`, play: `${url.origin}/${g.id}/play`, cover: g.cover ? `${url.origin}/games/${g.id}/${g.cover}` : null,
        })),
      }, 200, { 'access-control-allow-origin': '*' });
    }
    if (path === '/api/games') {
      const cat = await catalogue(env, url.origin);
      return json({ studio: cat.studio, games: cat.games, live: await liveCounts(env, cat.games ?? []) });
    }
    if (path.startsWith('/media/')) {
      if (!env.MEDIA) return new Response('this studio keeps no media in R2 yet', { status: 404 });
      const key = decodeURIComponent(path.slice('/media/'.length));
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response('not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('cache-control', 'public, max-age=3600');
      return new Response(obj.body, { headers });
    }
    if (path === '/' || path === '/index.html') {
      const cat = await catalogue(env, url.origin);
      return homePage(cat, await liveCounts(env, cat.games ?? []));
    }

    const game = parts[0];
    if (game && GAME_ID.test(game)) {
      const cat = await catalogue(env, url.origin);
      const meta = (cat.games ?? []).find((g) => g.id === game);
      if (!meta) return env.ASSETS.fetch(request);
      if (parts.length === 1 && !path.endsWith('/')) return Response.redirect(`${url.origin}/${game}/`, 301);
      const sub = parts.slice(1).join('/');
      if (sub === '') return gamePage(cat, meta, (await liveCounts(env, [meta]))[game] ?? 0);
      if (sub === 'play') return playPage(cat, meta);
      if (sub === 'api/lobby') {
        const max = Math.max(1, Math.min(16, Number(meta.players?.max) || 8));
        return env.LOBBY.get(env.LOBBY.idFromName(game)).fetch(`https://lobby/join?max=${max}`, { method: 'POST' });
      }
      if (sub === '__net' || sub === '__watch') {
        if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
        const room = url.searchParams.get('room') || 'main';
        if (!ROOM_ID.test(room)) return new Response('bad room', { status: 400 });
        const stub = env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
        const max = Math.max(1, Math.min(16, Number(meta.players?.max) || 8));
        const target = `https://table/${sub}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${max}`;
        return stub.fetch(new Request(target, request));
      }
      if (sub.startsWith('__homie/')) {
        // A game made with Homie's arcade controls asks here for a Homie host; "not-a-homie" makes it stop asking (the same answer homie.rocks gives).
        return json({ ok: false, error: 'not-a-homie' }, 200, { 'access-control-allow-origin': '*' });
      }
      if (sub === '__game' || sub === '__game/' || sub === '__game/index.html') return gameDocument(request, env, url, game, meta);
      if (sub.startsWith('__game/')) return gameAsset(env, url, game, sub.slice('__game/'.length));
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404) return notFoundPage('Nothing here.');
    return asset;
  },
};

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
    const max = Math.max(1, Math.min(16, Number(url.searchParams.get('max')) || 8));
    const room = this.roomFor(game, code, max);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = {
      ip: request.headers.get('cf-connecting-ip'),
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
      server.addEventListener('message', (e) => { h.onMessage(typeof e.data === 'string' ? e.data : ''); });
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
      if (room.clients.size === 0 && room.watchers.size === 0) { clearInterval(this.timer); this.timer = null; this.report(); }
    }, 250);
  }

  /** Tell the Lobby how many players this room has, when it changes. */
  report() {
    const room = this.room;
    if (!room || !this.game) return;
    const players = room.facts().counts.players;
    if (players === this.lastReport) return;
    this.lastReport = players;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(this.game));
    this.ctx.waitUntil(lobby.fetch('https://lobby/report', { method: 'POST', body: JSON.stringify({ room: this.code, players }) }).catch(() => {}));
  }

  /** A round the host called over becomes one D1 row (once per round number). */
  recordRound() {
    const r = this.room?.lastRound;
    if (!r || r.phase !== 'over' || !Number.isFinite(r.n) || r.n <= this.recorded || !this.env.DB) return;
    this.recorded = r.n;
    this.ctx.storage.put('recorded', r.n).catch(() => {});
    const results = Array.isArray(r.results) ? r.results.slice(0, 16) : [];
    const humans = results.filter((row) => row && !row.bot).length;
    this.ctx.waitUntil(this.env.DB.prepare(
      'INSERT OR IGNORE INTO rounds (game, room, n, humans, bots, results, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(this.game, this.code, r.n, humans, results.length - humans, JSON.stringify(results), new Date().toISOString()).run().catch(() => {}));
  }
}

/**
 * LOBBY — one per game: which public room a new visitor joins. Strangers meet:
 * the fullest room that still has a seat wins, counting visitors it just sent
 * there who have not connected yet, so two people pressing Play together land
 * in the same room.
 */
export class Lobby {
  constructor(ctx) {
    this.ctx = ctx;
    this.rooms = new Map();
    this.next = 1;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('lobby');
      if (saved) { this.next = saved.next ?? 1; for (const r of saved.rooms ?? []) this.rooms.set(r.name, { ...r, pending: [] }); }
    });
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
      const max = Math.max(1, Math.min(16, Number(url.searchParams.get('max')) || 8));
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
      const r = this.rooms.get(body.room) ?? { name: body.room, players: 0, at: now, pending: [] };
      const grew = Math.max(0, (Number(body.players) || 0) - r.players);
      r.pending.splice(0, grew);
      r.players = Math.max(0, Number(body.players) || 0);
      r.at = now;
      this.rooms.set(r.name, r);
      this.save();
      return json({ ok: true });
    }
    if (url.pathname === '/rooms') return json({ rooms: [...this.rooms.values()].map(({ name, players, at }) => ({ name, players, at })) });
    return json({ error: 'not found' }, 404);
  }
}
