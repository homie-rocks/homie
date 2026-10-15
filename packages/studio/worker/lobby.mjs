/** Extracted from the studio runtime; behavior is unchanged. */
import {errorLine,versionOf} from './room.mjs';
import {ROOM_ID} from './pages.mjs';
import {SERVER_ID,pooledRoom,roomCode,roomServer} from './servers.mjs';
import {seatCount} from './seats.mjs';
import {counter,today} from './stats.mjs';
import {json} from './responses.mjs';
import {LOBBY_APP_VERSIONS,LOBBY_ROOMS_MAX} from './lobby-limits.mjs';

class Lobby {
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
        this.current = saved.current ?? null;
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

  save() { this.ctx.storage.put('lobby', { current: this.current ?? null, next: this.next, rooms: [...this.rooms.values()].map(({ name, players, agents, ai, server, at, ver, host }) => ({ name, players, agents, ai, server, at, ...(host ? { host } : {}), ...(ver ? { ver } : {}) })), closed: [...this.closed] }).catch(() => {}); }

  prune(now) {
    for (const [name, r] of this.rooms) {
      r.pending = r.pending.filter((t) => now - t < 20_000);
      r.agentPending = (r.agentPending ?? []).filter((t) => now - t < 20_000);
      if (r.players === 0 && !r.pending.length && now - r.at > 120_000) this.rooms.delete(name);
    }
  }

  /** A request that throws is said with what it was (never its body) and answered as a failure, not left uncaught. */
  async fetch(request) {
    if(new URL(request.url).pathname==='/__app_records') {
      const {AppRecordStreams}=await import('./app-streams.mjs');
      this.appStreams??=new AppRecordStreams(this.env,this.ctx);
      const input=await request.json();
      return input.op==='open'?this.appStreams.open(input):this.appStreams.wake(input.meta);
    }
    if(new URL(request.url).pathname==='/__studio_events') {
      const {EventStreams}=await import('./event-resources.mjs');
      this.eventStreams??=new EventStreams(this.env,this.ctx);
      return this.eventStreams.fetch(request);
    }
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
      // A server build can run only its current rules. Persisted browser rooms
      // (including pre-kind records) and old server revisions must not consume
      // the pool or become the fallback of a server with roomsMax=1.
      const host = url.searchParams.get('host');
      if ((host === 'server' || host === 'browser') && (this.current?.host !== host || this.current?.ver !== ver)) {
        this.current = { host, ver };
        for (const [name, r] of this.rooms) if (
          host === 'server' ? (r.host ?? 'browser') !== host || (r.ver ?? '') !== ver : r.host === 'server'
        ) { this.rooms.delete(name); this.seen.delete(name); this.live.delete(name); }
        this.save();
      }
      const max = seatCount(url.searchParams.get('max'));
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
        room = { name: roomCode(server, n), server, players: 0, agents: 0, ai: 0, at: now, ver, ...(host ? { host } : {}), pending: [], agentPending: [] };
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
      // A retiring isolate may send its last report after the new pool was
      // selected. It cannot resurrect an incompatible public room.
      if (pooledRoom(body.room) && this.current && (this.current.host === 'server'
        ? (body.host ?? 'browser') !== 'server' || (body.ver ?? '') !== this.current.ver
        : body.host === 'server')) return json({ ok: true, retired: true });
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
      if (body.host === 'server' || body.host === 'browser') r.host = body.host;
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

export {Lobby};

