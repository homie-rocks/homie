/*
 * room.mjs — the netplay v1 relay semantics, with no transport in it.
 * =============================================================================
 *
 * This is the reference implementation of what NETPLAY.md asks of the shell's
 * relay. `worker/index.mjs` runs it unchanged inside the site's Table Durable
 * Object, under `wrangler dev` locally and on Cloudflare once deployed. Every socket is a
 * `conn` with `send(text)`, `close(code, reason)`, an optional `buffered()` and
 * an optional `ip`; time comes from `now()`. No Node built-ins: it runs in
 * workerd as it is.
 *
 * WHAT IT HOLDS, AND WHERE:
 *   memory   the latest snapshot, checkpoint, round, roster and keyed state.
 *            Nothing is written per frame (NETPLAY.md, cost note).
 *   storage  (optional `store`) the seat map, written only when a seat is
 *            allocated or the host changes, plus the latest checkpoint/round/
 *            roster/state at most every 30 s. That is what lets a Worker deploy
 *            (which evicts every Durable Object) keep seats, bodies and round.
 *
 * WATCHERS (revision 5, NETPLAY.md section 16): a screen that came to watch
 * (`hello.watch`, or a socket the Worker opened through a game's watch door,
 * `conn.watch`) never takes a seat, hosts only when no player can, and is told
 * whether it may follow one player's view (`welcome.watch`, then `watch` frames).
 * =============================================================================
 */

export const NET_VERSION = 1;
const PALETTE_SIZE = 12;
const DEVICE_RANK = { desk: 0, tv: 1, phone: 2 };

/** Size caps (bytes of the JSON text as received), for a room of up to 16 seats. */
export const LIMITS = Object.freeze({
  hello: 2048, snap: 16384, in: 2048, ev: 4096, ckpt: 65536, state: 8192, round: 8192, roster: 4096, ping: 256, other: 512,
});
/**
 * What grows with the seats (every body, every result, every slot): the checkpoint, round and roster caps double
 * for a room of 17 to 32 (revision 3). Measured: a 32-seat courier game's checkpoint reached 56 KB of the 64 KB
 * a 16-seat room allows. The snapshot cap does not grow: 32 bodies are about 1.5 KB.
 */
export const GROWS = Object.freeze(['ckpt', 'round', 'roster']);
export const capOf = (t, seats) => (LIMITS[t] ?? LIMITS.other) * (GROWS.includes(t) && seats > 16 ? 2 : 1);
/** Rate caps (messages per rolling second, per client). Over the cap a message is dropped, counted and reported. */
export const RATES = Object.freeze({ snap: 30, in: 60, ev: 30, ckpt: 4, state: 64, round: 4, roster: 8, ping: 8, other: 8 });
/** `ev` per second by the sender's role: a screen is a spectator, and the host is somebody's phone. */
export const EV_RATES = Object.freeze({ host: 30, replica: 10, screen: 2 });
/** The keyed state channel: at most this many keys and bytes per room. */
export const STATE_CAPS = Object.freeze({ keys: 64, bytes: 65536 });

/**
 * THE OWNER'S CONTROLS (revision 4, NETPLAY.md section 15). The studio's Worker, acting for the signed-in owner,
 * hands the room a control: kick a player out (and hold the door for some minutes), mute one, announce a line to
 * everyone, close the room, or change its seats. The Table verifies the owner's signature before it calls
 * `control()`; this file only applies one. What a player sees of them is new optional frames and two new refusals,
 * so a v1 game that knows none of it keeps playing (its shell shows the notice and the banner).
 */
export const CONTROL_LIMITS = Object.freeze({ minutes: 24 * 60, announce: 280, announceSeconds: 3600, bans: 200, mutes: 200, message: 200 });
/** What a muted player cannot say: an `ev` whose kind starts with one of these (a game's chat, quick lines, emotes). */
export const SPEECH = /^(?:say|chat|emote)/i;
/**
 * The contract's 12 player colours: a peer's `colour` (its seat % 12) is an index into this list. The watch page's
 * player strip draws them; a game that colours its players the same way matches it (Gem Rush does).
 */
export const NET_PALETTE = Object.freeze(['#8fe36a', '#ffd166', '#ef6f6c', '#6cb4ee', '#c792ea', '#f4a261', '#2ec4b6', '#ff8fab', '#a7c957', '#e9c46a', '#90e0ef', '#f28482']);
/**
 * What a game lets its watchers see (game.json "watch", passed by the Worker as `conn.watchPolicy`): `follow` (any
 * player's view, the default), `overview` (the whole room only: a game with hidden hands or hidden roles), `off`.
 */
export const WATCH_POLICIES = Object.freeze(['follow', 'overview', 'off']);
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** A short tag for a browser's room key: enough for the owner to see "the same browser", never the key itself. */
export function browserTag(key) {
  if (!key) return null;
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36).padStart(6, '0').slice(-6);
}

/**
 * A seat's handle when its player typed no name: two words, varied per seat and per room ("Velvet Comet"), never
 * "Player 1" (a game that falls back to a list by seat number made every room's first player the same name).
 * At most 16 characters, so a game that trims names at 18 keeps all of it.
 */
export const HANDLE_WORDS = Object.freeze({
  first: ['Neon', 'Velvet', 'Static', 'Amber', 'Cobalt', 'Lucky', 'Rapid', 'Silent', 'Solar', 'Lunar', 'Crimson', 'Golden',
    'Frosty', 'Wild', 'Quiet', 'Swift', 'Brave', 'Clever', 'Cosmic', 'Mellow', 'Rusty', 'Shiny', 'Sunny', 'Stormy', 'Turbo',
    'Pixel', 'Retro', 'Jolly', 'Nimble', 'Bold', 'Misty', 'Copper'],
  second: ['Comet', 'Otter', 'Falcon', 'Fox', 'Panda', 'Rocket', 'Tiger', 'Raven', 'Pilot', 'Ranger', 'Rider', 'Moth', 'Koi',
    'Lynx', 'Heron', 'Badger', 'Yeti', 'Wolf', 'Bison', 'Gecko', 'Orca', 'Puma', 'Sparrow', 'Beacon', 'Meteor', 'Nova',
    'Ember', 'Drift', 'Spark', 'Echo', 'Kite', 'Mantis'],
});
/** The handle for a seat token (random per seat), skipping any handle another seat in the room already has. */
export function handleFor(token, taken = new Set()) {
  let h = 2166136261;
  for (const ch of String(token ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const { first, second } = HANDLE_WORDS;
  const all = first.length * second.length;
  for (let i = 0; i < all; i += 1) {
    const n = (h + i * 7919) % all;
    const name = `${first[n % first.length]} ${second[Math.floor(n / first.length) % second.length]}`;
    if (!taken.has(name)) return name;
  }
  return `${first[h % first.length]} ${second[h % second.length]}`;
}

/** Random bytes as base64url, with no Node Buffer (runs in workerd too). */
function randomId(n) {
  const raw = new Uint8Array(n);
  crypto.getRandomValues(raw);
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Press counts are summed by the host: clamp them so `{fire: 1e9}` is 8, not a billion loop turns. */
function clampPresses(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(p)) {
    if (n >= 16) break;
    const c = Math.max(0, Math.min(8, Math.floor(Number(v) || 0)));
    if (c) { out[String(k).slice(0, 32)] = c; n += 1; }
  }
  return n ? out : null;
}

export class NetRoom {
  /**
   * @param {object} o
   * @param {string} o.code  room name
   * @param {number} [o.maxPlayers]  seats; the first hello of an empty room may lower it (`hello.max`)
   * @param {number} [o.maxScreens]  spectator sockets on top of the seats
   * @param {number} [o.perIp]  sockets per client address per room (0 = off); the Worker passes CF-Connecting-IP
   * @param {number} [o.stallMs]  a host with no snapshot this long while others are present is replaced
   * @param {number} [o.silentMs]  a host silent this long (or hidden) is replaced at once by a newcomer
   * @param {number} [o.idleMs]  any socket silent this long is closed (the helper pings every 2 s)
   * @param {number} [o.holdMs]  a dropped seat is held this long for its token, unless a present visitor needs it
   * @param {number} [o.forgetMs]  an EMPTY room forgets everything after this long
   * @param {number} [o.persistMs]  the checkpoint/round/state are saved at most this often
   * @param {{save: (o: object) => void, clear?: () => void} | null} [o.store]
   * @param {() => number} [o.now]
   * @param {(line: object) => void} [o.log]
   */
  constructor({
    code, maxPlayers = 8, maxScreens = 16, perIp = 12, stallMs = 1500, silentMs = 2500, idleMs = 10_000,
    holdMs = 60_000, forgetMs = 60_000, persistMs = 30_000, store = null, now = Date.now, log = () => {},
  }) {
    this.code = code;
    this.seatCap = maxPlayers;
    this.maxPlayers = maxPlayers;
    this.maxScreens = maxScreens;
    this.perIp = perIp;
    this.stallMs = stallMs;
    this.silentMs = silentMs;
    this.idleMs = idleMs;
    this.holdMs = holdMs;
    this.forgetMs = forgetMs;
    this.persistMs = persistMs;
    this.store = store;
    this.now = now;
    this.log = log;
    /** id → client (including sockets that have not said hello yet) */
    this.clients = new Map();
    /** seat → { token, name, since, present } */
    this.seats = new Map();
    this.watchers = new Set();
    this.hostId = null;
    this.hostSince = 0;
    this.lastJoinAt = 0;
    this.lastSnap = null;
    this.lastSnapText = null;
    this.lastCkpt = null;
    this.lastRound = null;
    this.lastRoster = null;
    /** key → { d, bytes } — slow world state, handed to every joiner and to a promoted host */
    this.state = new Map();
    this.stateBytes = 0;
    this.emptySince = now();
    /** After a restore: the seat that was host keeps first claim on the role for a moment. */
    this.preferHost = null;
    this.seatsDirty = false;
    this.persistDirty = false;
    this.lastPersistAt = 0;
    this.stats = {
      snaps: 0, ins: 0, evs: 0, ckpts: 0, states: 0, rounds: 0, drops: 0, oversize: 0, stFixed: 0, reclaimed: 0, seated: 0,
      kicked: 0, refused: 0, persists: 0, restoredFrom: null, bytesIn: 0, bytesOut: 0, elections: [], promotions: 0,
    };
    this.snapTimes = [];
    /** The owner's controls (section 15): who is held out of this room until when, who is muted, the banner, a closed door. */
    this.bans = [];
    this.mutes = [];
    this.announcement = null;
    this.closedUntil = 0;
    this.closedWhy = '';
    /** When the room's first seat was taken (its uptime), and what the first hello asked for (`hello.max`). */
    this.openedAt = 0;
    this.askedMax = null;
    /** A launch change waiting for the round to finish: who may stay (ticket kinds), and when it applies at the latest. */
    this.regate = null;
  }

  /* ------------------------------------------------------------ sockets */

  /** A new relay socket. Returns the two callbacks the transport must call. */
  attach(conn) {
    const now = this.now();
    const c = {
      id: randomId(6), conn, ip: conn.ip ?? null, browser: conn.browser ?? null, player: conn.player ?? null, via: conn.via ?? null, helloed: false, seat: null, token: null, name: '', typed: '', colour: 0,
      device: 'desk', want: 'play', canHost: true, hidden: false, waiting: false, joinedAt: now, lastSeen: now, lastSnapAt: 0,
      rates: new Map(), drops: [], errAt: 0,
      // A watcher (section 16): the Worker's word for a socket opened through a watch door, else the hello's own.
      watch: conn.watch === true, policy: WATCH_POLICIES.includes(conn.watchPolicy) ? conn.watchPolicy : 'follow', follow: null, followWhy: null,
    };
    this.clients.set(c.id, c);
    return {
      id: c.id,
      onMessage: (text) => this.onMessage(c, text),
      onClose: () => this.onClose(c, 'closed'),
    };
  }

  watch(conn) {
    this.watchers.add(conn);
    this.sendText(conn, JSON.stringify(this.facts()));
    // A shell that comes back to a room it was kicked from (or that is closed) hears so at once.
    const held = this.heldNotice(conn);
    if (held) this.sendText(conn, JSON.stringify(held));
    return { onClose: () => this.watchers.delete(conn) };
  }

  /* ------------------------------------------------------------ wire */

  sendText(conn, text) {
    try { conn.send(text); this.stats.bytesOut += text.length; } catch { /* closing */ }
  }
  send(c, msg) { this.sendText(c.conn, JSON.stringify(msg)); }
  error(c, code, message, extra = {}) { this.send(c, { t: 'error', code, message, ...extra }); }
  live() { return [...this.clients.values()].filter((c) => c.helloed); }
  others(c) { return this.live().filter((o) => o !== c); }
  host() { return this.hostId ? this.clients.get(this.hostId) ?? null : null; }
  hostRef() { const h = this.host(); return h ? { id: h.id, seat: h.seat } : null; }
  roleOf(c) { return c.id === this.hostId ? 'host' : c.seat === null ? 'screen' : 'replica'; }
  peer(c) { return { id: c.id, seat: c.seat, name: c.name, colour: c.colour, device: c.device, want: c.want, role: this.roleOf(c), ...(c.watch ? { watch: true } : {}), ...(this.muteOf(c) ? { muted: true } : {}) }; }
  peers() { return this.live().map((c) => this.peer(c)); }
  stateObject() { const o = {}; for (const [k, v] of this.state) o[k] = v.d; return o; }

  /** Drop the socket from the room and close it. */
  kick(c, why, code = 1008) {
    this.stats.kicked += 1;
    this.onClose(c, why);
    try { c.conn.close(code, why); } catch { /* gone */ }
  }

  allow(c, t, bytes) {
    // A spectator screen has little to say: its events are capped at 512 B (16 screens x 2/s x 512 B at most reach the host).
    const cap = t === 'ev' && c.seat === null && c.id !== this.hostId ? 512 : capOf(t, this.seatCap);
    if (bytes > cap) { this.stats.oversize += 1; this.error(c, 'too-large', `${t} is ${bytes} B; the cap is ${cap} B`); return false; }
    const now = this.now();
    const limit = t === 'ev' ? EV_RATES[this.roleOf(c)] : (RATES[t] ?? RATES.other);
    const list = c.rates.get(t) ?? [];
    while (list.length && list[0] <= now - 1000) list.shift();
    c.rates.set(t, list);
    if (list.length >= limit) {
      this.stats.drops += 1;
      c.drops.push(now);
      while (c.drops.length && c.drops[0] <= now - 5000) c.drops.shift();
      // Sustained abuse (20/s over a cap for 5 s) ends the socket; anything less is reported once a second.
      if (c.drops.length > 100) { this.error(c, 'flood', 'too many messages over the rate caps'); this.kick(c, 'flood'); return false; }
      if (now - c.errAt >= 1000) { c.errAt = now; this.send(c, { t: 'error', code: 'rate', of: t, message: `${t} over ${limit}/s was dropped` }); }
      return false;
    }
    list.push(now);
    return true;
  }

  onMessage(c, text) {
    if (this.clients.get(c.id) !== c) return;
    text = String(text);
    const now = this.now();
    c.lastSeen = now;
    this.stats.bytesIn += text.length;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!c.helloed) { if (m.t === 'hello' && text.length <= LIMITS.hello) this.hello(c, m); return; }
    if (!this.allow(c, m.t, text.length)) return;
    const isHost = c.id === this.hostId;
    switch (m.t) {
      case 'snap': {
        if (!isHost) return;
        const snap = { k: Number(m.k) || 0, st: this.stamp(m.st), d: m.d ?? null };
        if (Array.isArray(m.c)) snap.c = m.c.slice(0, 64);
        this.lastSnap = snap;
        c.lastSnapAt = now;
        this.stats.snaps += 1;
        this.snapTimes.push(now);
        while (this.snapTimes.length && this.snapTimes[0] < now - 1000) this.snapTimes.shift();
        const out = JSON.stringify({ t: 'snap', from: c.seat, ...snap });
        this.lastSnapText = out;
        for (const o of this.others(c)) {
          // A congested socket skips a snapshot rather than queueing a stale one.
          if (o.conn.buffered && o.conn.buffered() > 256 * 1024) { this.stats.drops += 1; continue; }
          this.sendText(o.conn, out);
        }
        return;
      }
      case 'in': {
        if (isHost || c.seat === null) return;
        const h = this.host();
        if (!h) return;
        this.stats.ins += 1;
        const out = { t: 'in', from: c.seat, q: Number(m.q) || 0, a: m.a ?? null, h: Array.isArray(m.h) ? m.h.slice(0, 16).map((x) => String(x).slice(0, 32)) : [] };
        if (Number.isFinite(m.r)) out.r = m.r;
        const p = clampPresses(m.p);
        if (p) out.p = p;
        this.send(h, out);
        return;
      }
      case 'ev': {
        const kind = String(m.k ?? '').slice(0, 64);
        // A muted player's speech goes nowhere (a host relays everyone's, so only a non-host's own is dropped).
        if (!isHost && SPEECH.test(kind) && this.muteOf(c)) { this.stats.mutedDrops = (this.stats.mutedDrops ?? 0) + 1; return; }
        this.stats.evs += 1;
        const out = { t: 'ev', from: c.seat, k: kind, d: m.d ?? null };
        if (isHost) {
          if (typeof m.to === 'string') { const o = this.clients.get(m.to); if (o && o.helloed && o !== c) this.send(o, out); }
          else if (Number.isInteger(m.to)) { for (const o of this.others(c)) if (o.seat === m.to) this.send(o, out); }
          else for (const o of this.others(c)) this.send(o, out);
        } else {
          const h = this.host();
          if (h) this.send(h, { ...out, id: c.id });
        }
        return;
      }
      case 'ckpt': {
        if (!isHost) return;
        this.lastCkpt = { k: Number(m.k) || 0, st: this.stamp(m.st), d: m.d ?? null, ...(Array.isArray(m.c) ? { c: m.c.slice(0, 64) } : {}) };
        this.stats.ckpts += 1;
        this.persistDirty = true;
        return;
      }
      case 'state': {
        if (!isHost) return;
        const key = typeof m.k === 'string' ? m.k.slice(0, 64) : '';
        if (!key) return;
        const prev = this.state.get(key);
        if (m.d === null || m.d === undefined) {
          if (!prev) return;
          this.state.delete(key);
          this.stateBytes -= prev.bytes;
        } else {
          const bytes = text.length;
          if ((!prev && this.state.size >= STATE_CAPS.keys) || this.stateBytes - (prev?.bytes ?? 0) + bytes > STATE_CAPS.bytes) {
            this.error(c, 'state-full', `state is capped at ${STATE_CAPS.keys} keys and ${STATE_CAPS.bytes} B`);
            return;
          }
          this.state.set(key, { d: m.d, bytes });
          this.stateBytes += bytes - (prev?.bytes ?? 0);
        }
        this.stats.states += 1;
        this.persistDirty = true;
        const out = JSON.stringify({ t: 'state', k: key, d: m.d ?? null });
        for (const o of this.others(c)) this.sendText(o.conn, out);
        return;
      }
      case 'round': {
        if (!isHost || !m.round || typeof m.round !== 'object') return;
        this.lastRound = m.round;
        // The round a launch change waits for is over: everyone sees its results for a moment, then the room re-gates.
        if (this.regate && m.round.phase === 'over' && (this.regate.roundN === null || Number(m.round.n) >= this.regate.roundN)) this.regate.until = Math.min(this.regate.until, this.now() + 5000);
        this.stats.rounds += 1;
        this.persistDirty = true;
        for (const o of this.others(c)) this.send(o, { t: 'round', round: m.round });
        this.tellWatchers();
        return;
      }
      case 'roster': {
        if (!isHost || !Array.isArray(m.slots)) return;
        this.lastRoster = m.slots.slice(0, 64);
        this.persistDirty = true;
        for (const o of this.others(c)) this.send(o, { t: 'roster', slots: this.lastRoster });
        this.tellWatchers();
        return;
      }
      case 'ping': {
        const wasHidden = c.hidden;
        c.hidden = m.hid === true;
        this.send(c, { t: 'pong', c: m.c, st: now });
        // A host whose tab went to the background will stop ticking: hand the round on now.
        if (isHost && c.hidden && !wasHidden) this.yieldHost(c, 'host-hidden');
        return;
      }
      case 'yield': {
        if (isHost) this.yieldHost(c, 'host-yielded');
        return;
      }
      case 'bye': {
        this.onClose(c, 'bye');
        try { c.conn.close(1000, 'bye'); } catch { /* gone */ }
        return;
      }
      default:
        return;
    }
  }

  /**
   * The host's `st` is its estimate of relay time. Keep it (its spacing is clean, which interpolation needs) unless
   * it is implausible: a snapshot stamped in the future would freeze every replica's buffer for good.
   */
  stamp(st) {
    const now = this.now();
    const n = Number(st);
    if (Number.isFinite(n) && n <= now + 250 && n >= now - 2000) return n;
    this.stats.stFixed += 1;
    return now;
  }

  hello(c, m) {
    if (Number(m.v) !== NET_VERSION) {
      this.error(c, 'version', `this relay speaks netplay v${NET_VERSION}`);
      this.clients.delete(c.id);
      try { c.conn.close(1000, 'version'); } catch { /* gone */ }
      return;
    }
    const live = this.live();
    const refuse = (code, message, extra = {}) => {
      this.stats.refused += 1;
      this.error(c, code, message, extra);
      this.clients.delete(c.id);
      try { c.conn.close(1008, code); } catch { /* gone */ }
    };
    // The owner closed this room, or held this player out of it (section 15): refused, with when it ends.
    if (this.closedUntil > this.now()) return refuse('room-closed', this.closedWhy || 'The studio closed this room.', { until: this.closedUntil });
    const ban = this.banOf(c, typeof m.token === 'string' ? m.token : '');
    if (ban) return refuse('kicked', ban.message, { until: ban.until });
    // A watcher of a game that cannot be watched (game.json "watch": false) is refused for good (section 16).
    const watching = c.watch || m.watch === true;
    if (watching && c.policy === 'off') return refuse('watch-off', 'this game cannot be watched; play it instead');
    if (this.perIp && c.ip && live.filter((o) => o.ip === c.ip).length >= this.perIp) return refuse('too-many', `at most ${this.perIp} sockets per address in one room`);
    if (live.length >= this.maxPlayers + this.maxScreens) return refuse('room-full', 'this room is full; try another');
    const now = this.now();
    c.device = m.device === 'phone' || m.device === 'tv' ? m.device : 'desk';
    // A watcher is a screen that never takes a seat, whatever else its hello says.
    c.watch = watching;
    c.want = watching || m.want === 'screen' ? 'screen' : 'play';
    c.canHost = m.canHost !== false;
    c.game = typeof m.game === 'string' ? m.game.slice(0, 64) : '';
    c.typed = typeof m.name === 'string' ? m.name.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    // The manifest's player count, from the first visitor of an empty room (the site's Table reads the manifest).
    if (Number.isInteger(m.max) && !this.seats.size && !live.length) { this.askedMax = m.max; this.maxPlayers = Math.max(1, Math.min(this.seatCap, m.max)); }
    this.reapSeats(now);
    let full = false;
    if (c.want === 'play' && !this.seatClient(c, typeof m.token === 'string' ? m.token : '')) { full = true; c.waiting = true; }
    if (c.seat === null) c.name = c.typed || (c.want === 'screen' && !c.watch ? 'Screen' : 'Watcher');
    c.helloed = true;
    c.joinedAt = now;
    if (!this.openedAt) this.openedAt = now;
    this.emptySince = 0;
    this.lastJoinAt = now;

    let role = c.seat === null ? 'screen' : 'replica';
    let why = 'joined';
    let deposed = null;
    const h = this.host();
    const preferred = this.preferHost && now < this.preferHost.until ? this.preferHost.seat : undefined;
    // A watcher hosts only a room nobody else can host (a player who can is elected first), and never deposes one.
    const lastResort = c.watch && live.some((o) => o.canHost && !o.watch && !o.hidden);
    if (c.canHost && !lastResort && (preferred === undefined || preferred === c.seat)) {
      if (!h) {
        role = 'host';
        why = this.lastSnap || this.lastCkpt ? 'resumed' : 'first';
        if (preferred !== undefined) this.preferHost = null;
      } else if (!c.watch && (h.hidden || now - h.lastSeen > this.silentMs)) {
        // The host is a frozen phone (socket open, nothing sent): the newcomer runs the round now, not after a stall.
        deposed = h;
        role = 'host';
        why = h.hidden ? 'host-hidden' : 'host-stalled';
      }
    }
    if (role === 'host') {
      this.hostId = c.id;
      this.hostSince = now;
      c.lastSnapAt = 0;
      this.seatsDirty = true;
      this.stats.elections.push({ at: now, id: c.id, seat: c.seat, why });
      if (this.stats.elections.length > 32) this.stats.elections.shift();
    }
    this.send(c, {
      t: 'welcome', v: NET_VERSION, id: c.id, room: this.code, seat: c.seat, token: c.token, name: c.name, colour: c.colour,
      role, why, host: this.hostRef(), peers: this.peers(), st: now, max: this.maxPlayers,
      round: this.lastRound, roster: this.lastRoster, snap: this.lastSnap, state: this.stateObject(),
      ...(role === 'host' ? { ckpt: this.lastCkpt } : {}),
      ...(full ? { full: true } : {}),
      ...(this.liveAnnouncement() ? { announce: this.liveAnnouncement() } : {}),
      ...(c.watch ? { watch: this.followFacts(c) } : {}),
    });
    for (const o of this.others(c)) this.send(o, { t: 'join', peer: this.peer(c) });
    // A seat taken by a browser that also watches this room: its watching tab sees the overview from now on.
    this.refreshWatchers(c);
    if (deposed) {
      this.send(deposed, { t: 'role', role: deposed.seat === null ? 'screen' : 'replica', why, host: this.hostRef(), peers: this.peers() });
      for (const o of this.others(c)) if (o !== deposed) this.send(o, { t: 'host', host: this.hostRef(), why });
    }
    this.log({ ev: 'hello', room: this.code, id: c.id, seat: c.seat, device: c.device, want: c.want, role, why, full, resumed: typeof m.token === 'string' && m.token === c.token, ...(c.watch ? { watch: true } : {}) });
    this.persist(now); // a new seat (or a new host) is written now, not on the next tick: a deploy can come any moment
    this.tellWatchers();
  }

  /** Give `c` a seat: its token's seat, a free one, or the seat absent longest. False when every seat is present. */
  seatClient(c, token) {
    const seat = this.seatFor(token);
    if (seat === null) return false;
    const s = this.seats.get(seat);
    // Same seat open twice (two tabs, or a reload racing its own close): the newer socket wins.
    for (const o of [...this.clients.values()]) {
      if (o !== c && o.helloed && o.seat === seat) {
        this.error(o, 'replaced', 'this seat opened elsewhere');
        this.onClose(o, 'replaced');
        try { o.conn.close(1000, 'replaced'); } catch { /* gone */ }
      }
    }
    c.seat = seat;
    c.token = s.token;
    c.waiting = false;
    s.present = true;
    const name = c.typed || s.name || handleFor(s.token, new Set([...this.seats.values()].map((x) => x.name).filter(Boolean)));
    if (name !== s.name) { s.name = name; this.seatsDirty = true; }
    c.name = name;
    c.colour = seat % PALETTE_SIZE;
    return true;
  }

  seatFor(token) {
    if (token) for (const [seat, s] of this.seats) if (s.token === token) return seat;
    const fresh = () => ({ token: randomId(18), name: '', since: this.now(), present: true });
    for (let seat = 0; seat < this.maxPlayers; seat += 1) {
      if (this.seats.has(seat)) continue;
      this.seats.set(seat, fresh());
      this.seatsDirty = true;
      return seat;
    }
    // Every seat is present or held. A visitor who is here beats one who left: reclaim the seat absent longest.
    let oldest = null;
    for (const [seat, s] of this.seats) if (!s.present && seat < this.maxPlayers && (!oldest || s.since < oldest[1].since)) oldest = [seat, s];
    if (!oldest) return null;
    this.seats.set(oldest[0], fresh());
    this.seatsDirty = true;
    this.stats.reclaimed += 1;
    return oldest[0];
  }

  reapSeats(now) {
    for (const [seat, s] of this.seats) {
      if (!s.present && now - s.since > this.holdMs) { this.seats.delete(seat); this.seatsDirty = true; }
    }
  }

  /** Spectators who wanted to play take any seat that is free or reclaimable, oldest first. */
  seatWaiting() {
    for (const c of this.live()) {
      if (!c.waiting || c.seat !== null) continue;
      if (!this.seatClient(c, '')) return;
      this.stats.seated += 1;
      this.send(c, { t: 'seat', seat: c.seat, token: c.token, name: c.name, colour: c.colour, role: this.roleOf(c) });
      for (const o of this.others(c)) this.send(o, { t: 'join', peer: this.peer(c) });
      this.log({ ev: 'seated', room: this.code, id: c.id, seat: c.seat });
      this.persist();
      this.refreshWatchers();
      this.tellWatchers();
    }
  }

  /* ------------------------------------------------------------ watchers (section 16) */

  /**
   * Whether this watcher may follow one player's view, and if not, why: `overview` (the game shows watchers the
   * whole room only) or `seated-here` (the same browser holds a seat in this room: a second tab is not a way to
   * look over an opponent's shoulder). The stream is the same either way; this decides what the watcher's page
   * offers and its helper renders.
   */
  followFacts(c) {
    if (c.policy === 'overview') return { follow: false, why: 'overview' };
    if (c.browser && this.live().some((o) => o !== c && o.seat !== null && o.browser === c.browser)) return { follow: false, why: 'seated-here' };
    return { follow: true };
  }

  /** Tell every watcher whose right to follow changed (a seat taken or left by its own browser). */
  refreshWatchers(except = null) {
    for (const c of this.live()) {
      if (!c.watch) continue;
      const f = this.followFacts(c);
      const why = f.why ?? null;
      if (c === except || (c.follow === f.follow && c.followWhy === why)) { c.follow = f.follow; c.followWhy = why; continue; }
      c.follow = f.follow;
      c.followWhy = why;
      this.send(c, { t: 'watch', ...f });
    }
  }

  onClose(c, why) {
    if (this.clients.get(c.id) !== c) return;
    this.clients.delete(c.id);
    if (!c.helloed) return;
    const now = this.now();
    if (c.seat !== null) {
      const s = this.seats.get(c.seat);
      if (s && s.token === c.token) { s.present = false; s.since = now; }
    }
    for (const o of this.others(c)) this.send(o, { t: 'leave', id: c.id, seat: c.seat, why });
    this.log({ ev: 'leave', room: this.code, id: c.id, seat: c.seat, why });
    if (c.id === this.hostId) {
      this.hostId = null;
      this.elect(null, why === 'replaced' ? 'host-replaced' : why === 'silent' ? 'host-stalled' : 'host-left');
    }
    if (!this.live().length) this.emptySince = now;
    this.seatWaiting();
    if (c.seat !== null) this.refreshWatchers();
    this.tellWatchers();
  }

  /**
   * Choose a host. Visible and responsive first; then tenure in 30 s steps (a newcomer cannot jump the queue by
   * calling itself a desktop); then desk > tv > phone as a tie-break; then whoever came first. The chosen browser
   * is handed the last checkpoint, the last snapshot (newer), the round, the roster and the keyed state.
   */
  elect(excludeId, why) {
    const now = this.now();
    const silent = (c) => Number(now - c.lastSeen > this.silentMs);
    const tenure = (c) => Math.floor((now - c.joinedAt) / 30_000);
    const cands = this.live()
      .filter((c) => c.canHost && c.id !== excludeId)
      .sort((a, b) => Number(a.hidden) - Number(b.hidden)
        || silent(a) - silent(b)
        // A watcher is the host of last resort: any player who can host comes first (section 16).
        || Number(a.watch) - Number(b.watch)
        || tenure(b) - tenure(a)
        || (DEVICE_RANK[a.device] ?? 3) - (DEVICE_RANK[b.device] ?? 3)
        || a.joinedAt - b.joinedAt);
    const next = cands[0] ?? null;
    if (!next) {
      this.hostId = null;
      for (const o of this.live()) this.send(o, { t: 'host', host: null, why });
      return null;
    }
    this.hostId = next.id;
    this.hostSince = now;
    this.preferHost = null;
    this.seatsDirty = true;
    next.lastSnapAt = 0;
    this.stats.promotions += 1;
    this.stats.elections.push({ at: now, id: next.id, seat: next.seat, why });
    if (this.stats.elections.length > 32) this.stats.elections.shift();
    this.send(next, {
      t: 'role', role: 'host', why, host: this.hostRef(), peers: this.peers(),
      ckpt: this.lastCkpt, snap: this.lastSnap, round: this.lastRound, roster: this.lastRoster, state: this.stateObject(),
    });
    for (const o of this.others(next)) this.send(o, { t: 'host', host: this.hostRef(), why });
    this.log({ ev: 'elect', room: this.code, id: next.id, seat: next.seat, why, ckptAge: this.lastCkpt ? now - this.lastCkpt.st : null });
    this.persist(now);
    this.tellWatchers();
    return next;
  }

  /** Move the host role off `c` if anybody else can take it. */
  yieldHost(c, why) {
    if (c.id !== this.hostId) return;
    const next = this.elect(c.id, why);
    if (!next) { this.hostId = c.id; return; } // nobody else: keep it
    this.send(c, { t: 'role', role: c.seat === null ? 'screen' : 'replica', why, host: this.hostRef(), peers: this.peers() });
  }

  /** Call every ~250 ms (setInterval locally, an alarm or the socket traffic on a Durable Object). */
  tick() {
    const now = this.now();
    // Sockets that never said hello, or went silent (a slept phone, a half-open link): close them, and a seat
    // becomes a bot instead of a frozen body.
    for (const c of [...this.clients.values()]) {
      if (!c.helloed) { if (now - c.joinedAt > 5000) { this.clients.delete(c.id); try { c.conn.close(4000, 'no-hello'); } catch { /* gone */ } } continue; }
      if (now - c.lastSeen > this.idleMs) this.kick(c, 'silent', 4000);
    }
    // A host that stopped sending snapshots while others are present.
    const h = this.host();
    if (h && this.live().length > 1) {
      const since = Math.max(h.lastSnapAt, this.hostSince, this.lastJoinAt);
      if (now - since > this.stallMs) {
        const next = this.elect(h.id, 'host-stalled');
        if (next) this.send(h, { t: 'role', role: h.seat === null ? 'screen' : 'replica', why: 'host-stalled', host: this.hostRef(), peers: this.peers() });
        else { this.hostId = h.id; this.hostSince = now; }
      }
    }
    // Nobody hosting (a restored room whose old host did not come back in time): elect.
    if (!this.host() && (!this.preferHost || now >= this.preferHost.until)) {
      this.preferHost = null;
      if (this.live().some((c) => c.canHost)) this.elect(null, 'host-left');
    }
    if (this.regate && now >= this.regate.until) this.applyRegate(now);
    this.reapSeats(now);
    this.seatWaiting();
    if (!this.live().length && this.emptySince && now - this.emptySince > this.forgetMs) {
      this.lastSnap = null; this.lastSnapText = null; this.lastCkpt = null; this.lastRound = null; this.lastRoster = null;
      this.state.clear(); this.stateBytes = 0; this.seats.clear(); this.preferHost = null;
      this.emptySince = 0; this.openedAt = 0; this.askedMax = null;
      this.seatsDirty = false; this.persistDirty = false;
      try { this.store?.clear?.(); } catch { /* best effort */ }
    }
    this.persist(now);
  }

  /* ------------------------------------------------------------ storage (optional) */

  /** Seats on change; checkpoint/round/roster/state at most every persistMs. Never per frame. */
  persist(now = this.now(), force = false) {
    if (!this.store) return;
    const due = this.seatsDirty || (this.persistDirty && now - this.lastPersistAt >= this.persistMs);
    if (!force && !due) return;
    this.seatsDirty = false;
    this.persistDirty = false;
    this.lastPersistAt = now;
    this.stats.persists += 1;
    try { this.store.save(this.saved(now)); } catch (err) { this.log({ ev: 'persist-failed', room: this.code, error: String(err) }); }
  }

  saved(now = this.now()) {
    return {
      v: NET_VERSION, room: this.code, savedAt: now, maxPlayers: this.maxPlayers, hostSeat: this.host()?.seat ?? null, openedAt: this.openedAt || null,
      seats: [...this.seats].map(([seat, s]) => [seat, s.token, s.name]),
      ckpt: this.lastCkpt, round: this.lastRound, roster: this.lastRoster, state: this.stateObject(),
    };
  }

  /**
   * After an eviction (a deploy): seats keep their tokens (so every reconnecting browser gets its own seat back),
   * the round, roster, state and last checkpoint come back, and the seat that was host gets 3 s to reclaim the role
   * before anyone else is elected. Saves older than 2 minutes are ignored: that room is over.
   */
  restore(saved, graceMs = 3000) {
    const now = this.now();
    if (!saved || saved.v !== NET_VERSION || !(now - Number(saved.savedAt) < 120_000)) return false;
    if (Number.isInteger(saved.maxPlayers)) this.maxPlayers = Math.max(1, Math.min(this.seatCap, saved.maxPlayers));
    if (Number.isFinite(saved.openedAt) && saved.openedAt > 0) this.openedAt = saved.openedAt;
    for (const [seat, token, name] of saved.seats ?? []) this.seats.set(seat, { token, name, since: now, present: false });
    this.lastCkpt = saved.ckpt ?? null;
    this.lastRound = saved.round ?? null;
    this.lastRoster = saved.roster ?? null;
    for (const [k, d] of Object.entries(saved.state ?? {})) {
      const bytes = JSON.stringify({ t: 'state', k, d }).length;
      this.state.set(k, { d, bytes });
      this.stateBytes += bytes;
    }
    if (Number.isInteger(saved.hostSeat)) this.preferHost = { seat: saved.hostSeat, until: now + graceMs };
    this.emptySince = now;
    this.stats.restoredFrom = now - saved.savedAt;
    this.log({ ev: 'restored', room: this.code, seats: this.seats.size, ageMs: now - saved.savedAt, hostSeat: saved.hostSeat });
    return true;
  }

  /* ------------------------------------------------------------ the owner's controls (section 15) */

  /** A live client by socket id, else the present client in a seat. */
  findClient({ id = null, seat = null } = {}) {
    if (typeof id === 'string' && id) { const c = this.clients.get(id); if (c && c.helloed) return c; }
    if (Number.isInteger(seat)) return this.live().find((c) => c.seat === seat) ?? null;
    return null;
  }

  /** The hold that keeps this client out, if any: by its seat token, its browser's room key, its account, or (only when the owner asked) its address. */
  banOf(c, token = c.token) {
    const now = this.now();
    return this.bans.find((b) => b.until > now && ((b.token && b.token === token) || (b.browser && b.browser === c.browser) || (b.player && b.player === c.player) || (b.ip && b.ip === c.ip))) ?? null;
  }

  muteOf(c) {
    const now = this.now();
    return this.mutes.find((m) => m.until > now && ((m.token && m.token === c.token) || (m.browser && m.browser === c.browser) || (m.player && m.player === c.player))) ?? null;
  }

  liveAnnouncement() {
    const a = this.announcement;
    return a && a.until > this.now() ? a : null;
  }

  /** What a watching shell is told on arrival: the room is closed, or its browser is held out or muted. */
  heldNotice(conn) {
    const now = this.now();
    if (this.closedUntil > now) return { t: 'closed', room: this.code, until: this.closedUntil, message: this.closedWhy || 'The studio closed this room.' };
    const probe = { token: null, browser: conn.browser ?? null, player: conn.player ?? null, ip: null };
    if (!probe.browser && !probe.player) return null;
    const ban = this.banOf(probe, null);
    if (ban) return { t: 'kicked', room: this.code, until: ban.until, message: ban.message };
    const mute = this.muteOf(probe);
    return mute ? { t: 'muted', room: this.code, until: mute.until } : null;
  }

  /** Tell the watching shells of one browser (or account) something meant for that player alone. */
  tellBrowser(who, msg) {
    const text = JSON.stringify(msg);
    for (const w of this.watchers) if ((who.browser && w.browser === who.browser) || (who.player && w.player === who.player)) this.sendText(w, text);
  }

  /**
   * One control, already verified by the caller (the Table checks the owner's signature). Returns what happened:
   * `{ ok: true, ... }`, or `{ ok: false, error }` when there is nobody to act on.
   */
  control(op, a = {}) {
    const now = this.now();
    const minutes = Math.max(1, Math.min(CONTROL_LIMITS.minutes, Math.floor(Number(a.minutes) || 10)));
    this.bans = this.bans.filter((b) => b.until > now);
    this.mutes = this.mutes.filter((m) => m.until > now);
    switch (op) {
      case 'kick': {
        const target = this.findClient(a);
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const until = now + minutes * 60_000;
        // The message is the studio's words; `until` says when (the shell says it in the player's own time).
        const message = oneLine(a.message, CONTROL_LIMITS.message) || 'The studio removed you from this room.';
        const ban = { token: target.token, browser: target.browser, player: target.player, ip: a.address ? target.ip : null, name: target.name, seat: target.seat, until, at: now, message };
        this.bans = [...this.bans, ban].slice(-CONTROL_LIMITS.bans);
        // Every socket of that player in this room: the seat itself, and its browser's or account's other tabs.
        const out = this.live().filter((o) => o === target || (ban.browser && o.browser === ban.browser) || (ban.player && o.player === ban.player));
        for (const o of out) {
          const seat = o.seat;
          const token = o.token;
          this.error(o, 'kicked', message, { until });
          this.onClose(o, 'kicked');
          // The seat is free for somebody else at once, and its token resumes nothing.
          const s = seat === null ? null : this.seats.get(seat);
          if (s && s.token === token) { this.seats.delete(seat); this.seatsDirty = true; }
          try { o.conn.close(1008, 'kicked'); } catch { /* gone */ }
        }
        this.stats.ownerKicks = (this.stats.ownerKicks ?? 0) + 1;
        this.tellBrowser(ban, { t: 'kicked', room: this.code, until, message });
        this.persist(now);
        this.tellWatchers();
        return { ok: true, op, name: ban.name, seat: ban.seat, sockets: out.length, until };
      }
      case 'mute': {
        const target = this.findClient(a);
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const off = a.off === true;
        const same = (m) => (m.token && m.token === target.token) || (m.browser && m.browser === target.browser) || (m.player && m.player === target.player);
        this.mutes = this.mutes.filter((m) => !same(m));
        const until = off ? 0 : now + minutes * 60_000;
        if (!off) this.mutes = [...this.mutes, { token: target.token, browser: target.browser, player: target.player, name: target.name, seat: target.seat, until, at: now }].slice(-CONTROL_LIMITS.mutes);
        const note = { t: 'mute', id: target.id, seat: target.seat, until };
        for (const o of this.live()) this.send(o, note);
        this.tellBrowser(target, { t: 'muted', room: this.code, until });
        this.tellWatchers();
        return { ok: true, op, name: target.name, seat: target.seat, until };
      }
      case 'announce': {
        const text = oneLine(a.text, CONTROL_LIMITS.announce);
        const prev = this.announcement;
        if (!text) {
          this.announcement = null;
          if (prev) { const clear = JSON.stringify({ t: 'announce', id: prev.id, text: null }); for (const o of this.live()) this.sendText(o.conn, clear); for (const w of this.watchers) this.sendText(w, clear); }
          this.tellWatchers();
          return { ok: true, op, cleared: Boolean(prev) };
        }
        const seconds = Math.max(5, Math.min(CONTROL_LIMITS.announceSeconds, Math.floor(Number(a.seconds) || 30)));
        this.announcement = { id: typeof a.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(a.id) ? a.id : randomId(6), text, at: now, until: now + seconds * 1000, from: 'studio' };
        const msg = JSON.stringify({ t: 'announce', ...this.announcement });
        for (const o of this.live()) this.sendText(o.conn, msg);
        for (const w of this.watchers) this.sendText(w, msg);
        this.tellWatchers();
        return { ok: true, op, id: this.announcement.id, people: this.live().length, until: this.announcement.until };
      }
      case 'close': {
        if (a.reopen === true) { this.closedUntil = 0; this.closedWhy = ''; this.tellWatchers(); return { ok: true, op, reopened: true }; }
        // `seconds` (10 s to a day) is a short close: everyone comes back through the game's door (a launch state change).
        const seconds = Math.floor(Number(a.seconds));
        const until = now + (seconds >= 10 ? Math.min(seconds, CONTROL_LIMITS.minutes * 60) * 1000 : minutes * 60_000);
        const message = oneLine(a.message, CONTROL_LIMITS.message) || 'The studio closed this room. Thanks for playing!';
        this.closedUntil = until;
        this.closedWhy = message;
        const people = this.live().length;
        for (const c of [...this.clients.values()]) {
          if (c.helloed) this.error(c, 'room-closed', message, { until });
          this.clients.delete(c.id);
          try { c.conn.close(1000, 'room-closed'); } catch { /* gone */ }
        }
        // Everything the room held goes, as when an empty room forgets (section 4).
        this.hostId = null;
        this.lastSnap = null; this.lastSnapText = null; this.lastCkpt = null; this.lastRound = null; this.lastRoster = null;
        this.state.clear(); this.stateBytes = 0; this.seats.clear(); this.preferHost = null; this.openedAt = 0; this.askedMax = null;
        this.emptySince = now; this.seatsDirty = false; this.persistDirty = false;
        try { this.store?.clear?.(); } catch { /* best effort */ }
        const msg = JSON.stringify({ t: 'closed', room: this.code, until, message });
        for (const w of this.watchers) this.sendText(w, msg);
        this.tellWatchers();
        return { ok: true, op, people, until };
      }
      case 'regate': {
        // A game's launch state changed (NETPLAY.md section 15): who may play is now narrower (`allow`: ticket kinds o,
        // i, p), or anyone again (`allow` absent: a pending change is cancelled). The current round finishes first.
        if (!Array.isArray(a.allow)) { const had = Boolean(this.regate); this.regate = null; this.tellWatchers(); return { ok: true, op, cancelled: had }; }
        const allow = a.allow.filter((k) => ['o', 'i', 'p'].includes(k));
        const leaving = this.live().filter((c) => !this.allowedAfter(c, allow)).length;
        if (!leaving) { this.regate = null; this.tellWatchers(); return { ok: true, op, leaving: 0 }; }
        const r = this.lastRound;
        const playing = Boolean(r && r.phase === 'live' && Number(r.endsAt) > now);
        const until = Math.min(now + 15 * 60_000, playing ? Number(r.endsAt) + 20_000 : now + 30_000);
        this.regate = { allow, roundN: playing ? Number(r.n) : null, until, at: now, message: oneLine(a.message, CONTROL_LIMITS.message) || 'Thanks for playing!' };
        const notice = oneLine(a.notice, CONTROL_LIMITS.announce);
        if (notice) this.control('announce', { text: notice, seconds: Math.ceil((until - now) / 1000) + 5 });
        this.tellWatchers();
        return { ok: true, op, leaving, until, afterRound: playing ? Number(r.n) : null };
      }
      case 'seats': {
        const n = Math.floor(Number(a.max));
        if (!(n >= 1)) return { ok: false, error: 'max', message: 'seats is a number of at least 1' };
        this.setSeats(n);
        this.tellWatchers();
        return { ok: true, op, max: this.maxPlayers };
      }
      default:
        return { ok: false, error: 'op', message: `no control called ${String(op).slice(0, 24)}` };
    }
  }

  /** Whether a client may stay once the room re-gates: one of its ticket's holders (o, i-…, p-…) is of an allowed kind. */
  allowedAfter(c, allow) {
    return String(c.via ?? '').split('~').some((part) => (part === 'o' && allow.includes('o')) || (part.startsWith('i-') && allow.includes('i')) || (part.startsWith('p-') && allow.includes('p')));
  }

  /** The launch change, now: everyone it leaves out is sent out of the room with the studio's words; the rest play on. */
  applyRegate(now = this.now()) {
    const g = this.regate;
    if (!g) return 0;
    this.regate = null;
    // The holder of the room's storage keeps the owner's state (the Table writes it on its next tick).
    this.officeDirty = true;
    const out = this.live().filter((c) => !this.allowedAfter(c, g.allow));
    for (const c of out) {
      const seat = c.seat;
      const token = c.token;
      this.error(c, 'room-closed', g.message);
      this.onClose(c, 'regated');
      const s = seat === null ? null : this.seats.get(seat);
      if (s && s.token === token) { this.seats.delete(seat); this.seatsDirty = true; }
      try { c.conn.close(1000, 'room-closed'); } catch { /* gone */ }
      this.tellBrowser(c, { t: 'closed', room: this.code, message: g.message });
    }
    this.persist(now);
    this.tellWatchers();
    return out.length;
  }

  /**
   * The room's seats, changed while it runs (the owner's "max players per room"). Players already seated above the
   * new number keep their seat until they leave; nobody new is seated there. Never above the room's own cap.
   */
  setSeats(n, perIp = null) {
    this.seatCap = Math.max(1, Math.floor(n));
    this.maxPlayers = Math.max(1, Math.min(this.seatCap, this.askedMax ?? this.seatCap));
    if (Number.isFinite(perIp) && perIp > 0) this.perIp = perIp;
  }

  /** The owner's holds, the banner and a closed door: kept apart from the room's play (they outlive an empty room). */
  officeSaved() {
    const now = this.now();
    return {
      bans: this.bans.filter((b) => b.until > now), mutes: this.mutes.filter((m) => m.until > now),
      announcement: this.liveAnnouncement(), closedUntil: this.closedUntil > now ? this.closedUntil : 0, closedWhy: this.closedWhy,
      regate: this.regate,
    };
  }

  restoreOffice(o) {
    if (!o || typeof o !== 'object') return;
    const now = this.now();
    this.bans = (Array.isArray(o.bans) ? o.bans : []).filter((b) => b && b.until > now).slice(-CONTROL_LIMITS.bans);
    this.mutes = (Array.isArray(o.mutes) ? o.mutes : []).filter((m) => m && m.until > now).slice(-CONTROL_LIMITS.mutes);
    this.announcement = o.announcement && o.announcement.until > now ? o.announcement : null;
    this.closedUntil = Number(o.closedUntil) > now ? Number(o.closedUntil) : 0;
    this.closedWhy = this.closedUntil ? String(o.closedWhy ?? '') : '';
    // A launch change still waiting comes back; one long past is over (whoever it was for has gone).
    this.regate = o.regate && Array.isArray(o.regate.allow) && Number(o.regate.until) > now - 120_000 ? o.regate : null;
  }

  /** The room as its owner sees it: the facts, plus who each player is to the studio (never an address). */
  officeFacts() {
    const f = this.facts();
    const now = this.now();
    const byId = new Map(this.live().map((c) => [c.id, c]));
    return {
      ...f,
      office: {
        openedAt: this.openedAt || null,
        closedUntil: this.closedUntil > now ? this.closedUntil : null,
        regate: this.regate ? { allow: this.regate.allow, until: this.regate.until, afterRound: this.regate.roundN } : null,
        clients: f.clients.map((p) => {
          const c = byId.get(p.id);
          const mute = c ? this.muteOf(c) : null;
          return { ...p, joinedAt: c?.joinedAt ?? null, lastSeen: c?.lastSeen ?? null, browser: browserTag(c?.browser), player: c?.player ?? null, via: c?.via ?? null, mutedUntil: mute ? mute.until : null };
        }),
        bans: this.bans.filter((b) => b.until > now).map((b) => ({ name: b.name, seat: b.seat, until: b.until, at: b.at, address: Boolean(b.ip), browser: browserTag(b.browser) })),
        mutes: this.mutes.filter((m) => m.until > now).map((m) => ({ name: m.name, seat: m.seat, until: m.until })),
      },
    };
  }

  /* ------------------------------------------------------------ the shell's view */

  facts() {
    const now = this.now();
    while (this.snapTimes.length && this.snapTimes[0] < now - 1000) this.snapTimes.shift();
    const slots = Array.isArray(this.lastRoster) ? this.lastRoster : [];
    const live = this.live();
    return {
      t: 'net', v: NET_VERSION, room: this.code, st: now,
      host: this.hostRef(),
      openedAt: this.openedAt || null,
      announce: this.liveAnnouncement(),
      ...(this.closedUntil > now ? { closedUntil: this.closedUntil } : {}),
      clients: live.map((c) => ({ ...this.peer(c), hidden: c.hidden, waiting: c.waiting })),
      round: this.lastRound,
      roster: this.lastRoster,
      snapHz: this.snapTimes.length,
      counts: {
        players: live.filter((c) => c.seat !== null).length,
        screens: live.filter((c) => c.seat === null).length,
        waiting: live.filter((c) => c.waiting).length,
        watchers: live.filter((c) => c.watch).length,
        humans: slots.filter((s) => s && !s.bot).length,
        bots: slots.filter((s) => s && s.bot).length,
        maxPlayers: this.maxPlayers,
      },
      memory: {
        snapBytes: this.lastSnapText ? this.lastSnapText.length : 0,
        ckptBytes: this.lastCkpt ? JSON.stringify(this.lastCkpt).length : 0,
        ckptAgeMs: this.lastCkpt ? now - this.lastCkpt.st : null,
        stateKeys: this.state.size,
        stateBytes: this.stateBytes,
      },
      stats: { ...this.stats, elections: this.stats.elections.slice(-8) },
    };
  }

  tellWatchers() {
    if (!this.watchers.size) return;
    const text = JSON.stringify(this.facts());
    for (const w of this.watchers) this.sendText(w, text);
  }
}
