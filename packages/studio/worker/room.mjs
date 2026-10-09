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
 *
 * SERVERS AND AGENT SEATS (revision 6, NETPLAY.md section 17): the Worker hands
 * every socket the room's policy (`setPolicy`) and, for an AI with a verified
 * pass, its facts (`conn.agent`). The relay keeps the seats a hybrid server
 * reserves for AI, names every agent "<label> · AI", rewrites the host's roster
 * and results so they cannot hide an AI, filters speech, runs the party's vote on
 * the skill dial, and closes agents that are left alone with no person seated.
 *
 * AGENT HANDS AND BRAINS (revision 7, NETPLAY.md section 18): an AI with no game client of its own (hands `host`)
 * sees the game through `agent:view` (the host's, to its seat, at most one every 2 s, under 2 KB) and moves through
 * `agent:do` (a goal of the game's agents.json, at most one every 3 s). It says only `say:<lineId>` lines of that
 * vocabulary, with arguments that fit, and only on a server whose AI may talk: the relay drops everything else an AI
 * says (`stats.agentDrops`). The Table's own house agents (worker/agents.mjs) are peers like any other, on a loopback.
 *
 * ROOM CHAT (revision 8, NETPLAY.md section 19): anyone in the room (a player, a watcher, the big screen's page, a
 * homie.rocks room page) says a line (`say`) or a reaction (`react`) on the game's socket or the shell's watch socket.
 * The relay checks the room's chat rules (`policy.chat`: what may be sent, who may send it, slow mode), runs the floor
 * on typed text (worker/chat.mjs), waits for the studio's review when there is one (the Table's Workers AI), and fans
 * the line out to every socket and every watching shell. It keeps the last few minutes in memory for a page that just
 * opened, and nothing anywhere else.
 *
 * THE SERVER AS HOST (revision 10, NETPLAY.md section 29): a game whose rules run on the server has no browser host.
 * The Table hands the room a host runtime (`setServerHost`, rules/host.ts). It is not a client: it is not in
 * `clients`, it has no socket, it is never elected away, and stall detection, yield and the caps written for a host
 * that is somebody's phone (`LIMITS`, `RATES`) do not apply to it. The relay calls it with parsed frames (`in`, `ev`,
 * who came and went) and fans out each frame it hands back (`hostFrame`). Everything else here is as it was.
 * =============================================================================
 */
import { LIMITS, capOf, RATES, EV_RATES, STATE_CAPS, rulesRates, RULES_FRAMES, takeRulesToken } from './limits.mjs';
export { LIMITS, GROWS, capOf } from './limits.mjs';
import { aiName, skillPreset, stripAi } from './agents.mjs';
import { DECIDE, checkArgs, checkDecide, talks, vocabularyOf } from './brain.mjs';
import { CHAT_LIMITS, CHAT_RATES, HELD_WORDS, allows, cleanText, floor, normalizeChat, publicChat, windowMsOf } from './chat.mjs';

export const NET_VERSION = 1;
/** The contract revision this relay speaks (NETPLAY.md): optional fields, frames and refusals; the wire stays `v: 1`. */
export const NET_REVISION = 11;
/**
 * Revision 9 (NETPLAY.md sections 22 and 23). STALL: how long a host may send no snapshot, while others are present,
 * before the room is handed on: 1.5 s unless the game names its own (game.json `netplay.stallMs`), never under
 * 1.5 s (a shorter one swaps hosts on a single slow frame) and never over 10 s (a frozen host must still be replaced
 * while its players are watching a still picture).
 */
export const STALL = Object.freeze({ ms: 1500, min: 1500, max: 10_000 });
/** A game's own stall time, held to STALL's bounds; null when it names none (or not a number). */
export function stallOf(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(STALL.min, Math.min(STALL.max, n)) : null;
}
const VERSION_TEXT = /^[A-Za-z0-9._-]{1,32}$/;
/** A game revision (game.json `netplay.version`): 1 to 32 of A-Z a-z 0-9 . _ -, a number as its digits; else null. */
export function versionOf(v) {
  const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return VERSION_TEXT.test(t) ? t : null;
}
const FEATURE_TEXT = /^[a-z0-9][a-z0-9-]{0,23}$/;
/** What a build says it can do (`hello.feat`): up to 8 short lowercase words. */
export function featuresOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) { const k = String(x ?? '').toLowerCase(); if (FEATURE_TEXT.test(k) && !out.includes(k)) out.push(k); if (out.length >= 8) break; }
  return out;
}
/**
 * A SOCKET THAT WENT AWAY IS NOT A FAILED ROOM. A browser that closes its tab, loses its network or is replaced by a
 * new host ends its socket without a goodbye, and the runtime reports that as an error ("Network connection lost",
 * "WebSocket peer disconnected"…). Those are departures: the room has already handled them (the seat is held, the
 * host is replaced). Anything else thrown while the room was doing something IS a failure, and is logged with the
 * room and what it was doing. `departure(error)` says which; the transport (the Table) asks it at its boundary.
 */
const DEPARTURE = /network connection lost|connection (?:was )?(?:closed|reset|aborted|lost)|peer disconnected|websocket (?:is )?(?:closed|closing|not open|already closed)|socket (?:is )?closed|client disconnected|disconnected|broken pipe|econnreset|epipe|aborted|cancell?ed|the script will never generate a response|durable object reset/i;
export function departure(error) {
  const text = typeof error === 'string' ? error : `${error?.name ?? ''} ${error?.message ?? ''} ${error?.code ?? ''}`;
  return DEPARTURE.test(text);
}
/** An error as a log line carries it: its name and message, cut short. Never the frame it was thrown for. */
export function errorLine(error) {
  return String(error?.stack && typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 4).join(' | ') : error?.message ?? error).slice(0, 400);
}
const POLICY_KINDS = ['open', 'humans-only', 'hybrid', 'beginner'];
/**
 * A room's policy before the Worker says anything (and the public server's with nothing set): today's behaviour.
 * NETPLAY.md section 17: `server` null is a named room; `aiSeats + guides` seats are kept for AI (the top seats).
 */
export const DEFAULT_POLICY = Object.freeze({ v: 1, at: 0, server: null, kind: 'open', aiSeats: 0, guides: 0, bots: 'fill', level: 3, levelMax: 5, speech: 'game', kids: false, brain: 'script' });
/** An agent's speech: at most one line every 4 s and 8 a minute (the relay drops the rest and counts them). */
export const AGENT_SPEECH = Object.freeze({ gapMs: 4000, perMinute: 8 });
/** The party's vote on the dial: open 15 s (or until every seated person voted); one opened by a player per 2 min. */
export const VOTE = Object.freeze({ ms: 15_000, cooldownMs: 120_000, autoMs: 30 * 60_000 });
/** Agents left with no person seated for this long are closed (`agents-alone`): an AI never keeps a room alive. */
export const AGENTS_ALONE_MS = 60_000;
const CAPS = ['skill', 'agents'];
/** Revision 7: what a game's host shows an AI (`agent:view`) and how often an AI may act (`agent:do`). */
export const AGENT_FRAMES = Object.freeze({ viewMs: 2000, viewBytes: 2048, doMs: 3000 });
const SAY = /^say:([a-z][a-z0-9_]{0,31})$/;
const d0 = (m) => (m.d && typeof m.d === 'object' && !Array.isArray(m.d) ? m.d : {});
const ASK = /^ask:([a-z][a-z0-9_]{0,31})$/;

/** A policy as the relay keeps it: every field checked (the Worker composed it, but a bad one must not break a room). */
export function normalizePolicy(p) {
  if (!p || typeof p !== 'object') return null;
  const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const kind = POLICY_KINDS.includes(p.kind) ? p.kind : 'open';
  const kids = p.kids === true;
  const levelMax = int(p.levelMax, 1, kids ? 3 : 5, kids ? 3 : 5);
  const server = p.server && typeof p.server === 'object' && /^[a-z0-9][a-z0-9-]{0,19}$/.test(String(p.server.id ?? ''))
    ? { id: String(p.server.id), name: String(p.server.name ?? p.server.id).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40) } : null;
  const reserveOk = kind === 'hybrid' || kind === 'beginner';
  return {
    v: 1, at: Math.max(0, Number(p.at) || 0), server, kind,
    aiSeats: reserveOk ? int(p.aiSeats, 0, 31, 0) : 0, guides: kind === 'beginner' ? int(p.guides, 0, 31, 0) : 0,
    bots: p.bots === 'off' ? 'off' : 'fill', level: Math.min(levelMax, int(p.level, 1, 5, 3)), levelMax,
    speech: ['game', 'lines', 'off'].includes(p.speech) ? p.speech : 'game', kids,
    brain: kind === 'humans-only' ? 'off' : ['off', 'script', 'workers-ai', 'owner-key'].includes(p.brain) ? p.brain : 'script',
    // Revision 8: the room's chat rules (section 19), capped by the server's speech and kids.
    ...(p.chat !== undefined ? { chat: normalizeChat(p.chat === false ? { mode: 'off' } : p.chat, { kids, speech: ['game', 'lines', 'off'].includes(p.speech) ? p.speech : 'game' }) } : {}),
  };
}
const policySig = (p) => JSON.stringify({ ...p, at: 0 });
/** The lower middle of the votes (DESIGN D8: a tie is settled kindly), or null with none. */
export function medianVote(list) {
  const v = [...list].filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
}
const utf8 = new TextEncoder();
const byteLength = text => utf8.encode(text).length;
const PALETTE_SIZE = 12;
const DEVICE_RANK = { desk: 0, tv: 1, phone: 2 };

/** Rate caps (messages per rolling second, per client). Over the cap a message is dropped, counted and reported. */
export { RATES, EV_RATES, STATE_CAPS } from './limits.mjs';

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

/** A kept line the Worker read from the room's history (its id, name and sender's account), for a mute or a kick. */
function keptRef(a) {
  const k = a.kept && typeof a.kept === 'object' ? a.kept : null;
  if (!k || k.id !== a.line || !k.from || typeof k.from.player !== 'string') return null;
  return { id: k.id, name: oneLine(k.name, CHAT_LIMITS.name) || 'Someone', seat: null, from: { client: null, token: null, browser: null, player: k.from.player } };
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
   * @param {(line: object) => void} [o.log]  one line per lifecycle event (hello, leave, elect, a failed operation),
   *   each stamped `at` (ISO time) with its room; never a token, a ticket, a browser key or a frame's contents
   */
  constructor({
    code, rules = false, tickHz = 20, maxPlayers = 8, maxScreens = 16, perIp = 12, stallMs = 1500, silentMs = 2500, idleMs = 10_000,
    holdMs = 60_000, forgetMs = 60_000, persistMs = 30_000, store = null, now = Date.now, log = () => {},
    agentsAloneMs = AGENTS_ALONE_MS, voteMs = VOTE.ms, voteCooldownMs = VOTE.cooldownMs, autoVoteMs = VOTE.autoMs,
  }) {
    this.agentsAloneMs = agentsAloneMs;
    this.voteMs = voteMs;
    this.voteCooldownMs = voteCooldownMs;
    this.autoVoteMs = autoVoteMs;
    /** Servers and agent seats (section 17): the Worker's policy, the party's dial, what the host's game reads. */
    this.policy = { ...DEFAULT_POLICY };
    this.level = null;
    this.levelBy = null;
    this.caps = new Set();
    this.vote = null;
    this.lastVoteOpen = -Infinity;
    this.lastAutoVote = -Infinity;
    this.lastHumanAt = 0;
    /** A policy that no longer lets AI in, waiting for the round to finish: when the agents leave. */
    this.agentsOut = null;
    /** Revision 7: the game's agents.json (the Table reads it once), the only words an AI here may say. */
    this.vocab = null;
    this.code = code;
    this.rules = rules === true;
    this.tickHz = tickHz;
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
    // Every line says when: a departure and a failure seconds apart are told apart by their times.
    const stamp = () => { try { return new Date(now()).toISOString(); } catch { return new Date().toISOString(); } };
    this.log = (line) => { try { log({ at: stamp(), ...line }); } catch { /* a log that throws never takes the room with it */ } };
    /**
     * Revision 9, section 23: the build this room runs (undefined: nobody has come yet), the build that is live now
     * (the Worker's word with every socket; undefined: nobody says), and the count of stays in a seat (`peer.occ`).
     */
    this.gameVer = undefined;
    this.currentVer = undefined;
    this.occSeq = 0;
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
      speechDrops: 0, agentDrops: 0, labelled: 0, votes: 0, decides: 0, decided: {}, decideMs: [],
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
    /**
     * Room chat (revision 8, section 19): the last few minutes of lines and reactions (memory only, never stored), each
     * sender's buckets, the studio's review of typed text (the Table sets `review`; null: the floor alone decides), and
     * the messages waiting for it.
     */
    this.chatLog = [];
    this.chatBuckets = new Map();
    this.chatAddress = new Map();
    this.chatReacts = [];
    this.chatPending = 0;
    this.review = null;
    /**
     * Kept chat (0.29.0): when the room's rules keep `history` days, the Table writes what is published (`onPublished`)
     * and forgets what is taken down (`onUnsaid`), and puts the kept lines back in the window (`hydrate`) when it opens.
     */
    this.onPublished = null;
    this.onUnsaid = null;
    this.hydrated = false;
    /**
     * A game's own decisions (section 20): the host's typed questions, answered by the studio's decision model (the Table
     * sets `decider`; null: the host's floor answers), at most one every 3 s and 20 a minute a room, two at a time.
     */
    this.decider = null;
    this.decideTimes = [];
    this.decidePending = 0;
    this.watchIds = new WeakMap();
    this.defaultChat = null;
    /**
     * Revision 10: the server as host (`setServerHost`), the seats it has been told of (seat → the stay's number), why
     * it could not start (`hostFailed`: the room then refuses joins and says why), and what the Table does when the
     * room forgets everything (`onForget`: it ends the host runtime).
     */
    this.server = null;
    this.hosted = new Map();
    this.hostFailed = null;
    this.onForget = null;
  }

  /* ------------------------------------------------------------ the server as host (revision 10, section 29) */

  /** The host runtime of a server-hosted room (`{ frame(m), facts() }`), or null. Seats already here are said as joins. */
  setServerHost(h) {
    this.server = h;
    this.hostFailed = null;
    this.hostId = null;
    this.preferHost = null;
    this.hosted.clear();
    if (!h) return;
    this.askedMax = null; this.maxPlayers = this.seatCap;
    // Restored holders also need a later free frame, even if their socket never returns.
    for (const [seat, s] of this.seats) this.hosted.set(seat, s.occ ?? null);
    this.toServer({ t: 'policy', policy: this.policyOut() });
    if (this.rawVocab) this.toServer({ t: 'vocabulary', vocab: this.rawVocab });
    for (const c of this.live()) if (c.seat !== null && !c.watch) this.joinServer(c);
  }

  /** The rules could not start: the room refuses joins and says why. It never falls back to a browser by itself. */
  failServerHost(message) {
    this.server = null;
    this.hostFailed = String(message ?? 'this game\'s rules could not start').slice(0, 200);
    this.log({ ev: 'host-failed', room: this.code, error: this.hostFailed });
  }

  /** One parsed frame for the host runtime. Rules that throw are caught there; anything thrown here is the runtime's own failure, logged with the room. */
  toServer(m) {
    if (!this.server) return;
    try { this.server.frame(m); } catch (error) { this.stats.failed = (this.stats.failed ?? 0) + 1; this.log({ ev: 'failed', room: this.code, op: 'host-frame', frame: m.t, error: errorLine(error) }); }
  }

  joinServer(c) {
    this.hosted.set(c.seat, this.seats.get(c.seat)?.occ ?? null);
    this.toServer({ t: 'join', peer: this.peer(c) });
  }

  /** A seat the host runtime knows that is no longer held (its hold ran out, the owner removed its player): its body's seat is given up. */
  syncServerSeats() {
    for (const [seat, occ] of [...this.hosted]) {
      const s = this.seats.get(seat);
      if (s && (s.occ ?? null) === occ) continue;
      this.hosted.delete(seat);
      if (this.server) this.toServer({ t: 'free', seat }); else if (this.rules && this.host()?.rules) this.send(this.host(), { t: 'free', seat });
    }
  }

  /**
   * One frame from the host runtime, fanned out as a browser host's would be: `snap`, `state`, `round`, `roster`,
   * `caps` and `ev`. `text` is the frame already encoded, when the runtime encoded it, so nothing is encoded twice.
   */
  hostFrame(m, text = null) {
    if (!this.server || !m || typeof m.t !== 'string') return;
    const now = this.now();
    switch (m.t) {
      case 'snap': return this.hostSnap(null, m, now, text);
      case 'state': return this.hostState(null, m, 0);
      case 'round': return this.hostRound(null, m);
      case 'roster': return this.hostRoster(null, m);
      case 'caps': return this.hostCaps(null, m);
      case 'decide': return this.onDecide(null, m, true);
      case 'ev': {
        const kind = String(m.k ?? '').slice(0, 64);
        if (SPEECH.test(kind) && (this.policy.speech === 'off' || (this.policy.speech === 'lines' && /^chat/i.test(kind)))) { this.stats.speechDrops += 1; return; }
        if (d0(m).ai === true && !this.aiLineOk(kind, d0(m))) { this.stats.agentDrops += 1; return; }
        if (kind === 'agent:view' && !this.agentViewOk(m, byteLength(JSON.stringify(m)), now, true)) return;
        this.stats.evs += 1;
        const out = { t: 'ev', from: Number.isInteger(m.from) ? m.from : null, k: kind, d: m.d ?? null };
        const line = JSON.stringify(out);
        if (Number.isInteger(m.to)) { for (const o of this.live()) if (o.seat === m.to) this.sendText(o.conn, line); return; }
        for (const o of this.live()) if (!this.lite(o) || this.liteHears(kind)) this.sendText(o.conn, line);
        return;
      }
      default: return;
    }
  }

  /** A snapshot from the host (a browser's socket `c`, or the server: `c` null), kept for joiners and fanned out. */
  hostSnap(c, m, now, text = null) {
    // The server's stamp is this relay's own clock; a browser's is its estimate of it, and is checked.
    const snap = { k: Number(m.k) || 0, st: c ? this.stamp(m.st) : Number(m.st) || now, d: m.d ?? null };
    if (Array.isArray(m.c)) snap.c = m.c.slice(0, 64);
    // Revision 10: a rules game's snapshot names the room's epoch.
    if ((!c || this.rules && c.rules) && Number.isFinite(m.e)) snap.e = m.e;
    this.lastSnap = snap;
    if (c) c.lastSnapAt = now;
    this.stats.snaps += 1;
    this.snapTimes.push(now);
    while (this.snapTimes.length && this.snapTimes[0] < now - 1000) this.snapTimes.shift();
    // A heartbeat (revision 9): the host's last state again while its frames hitch. It counts as a snapshot here
    // (the host is alive), and replicas are told which it is.
    const out = text ?? JSON.stringify({ t: 'snap', from: c ? c.seat : null, ...snap, ...(m.hb === 1 ? { hb: 1 } : {}) });
    if (m.hb === 1) this.stats.heartbeats = (this.stats.heartbeats ?? 0) + 1;
    this.lastSnapText = out;
    for (const o of this.others(c)) {
      if (this.lite(o)) continue; // an agent with no game client draws nothing
      // A congested socket skips a snapshot rather than queueing a stale one.
      if (o.conn.buffered && o.conn.buffered() > 256 * 1024) { this.stats.drops += 1; continue; }
      this.sendText(o.conn, out);
    }
  }

  /** One key of the slow state channel from the host. `bytes`: the frame's size, counted against the room's cap for a browser host. */
  hostState(c, m, bytes) {
    const key = typeof m.k === 'string' ? m.k.slice(0, 64) : '';
    if (!key) return;
    const prev = this.state.get(key);
    if (m.d === null || m.d === undefined) {
      if (!prev) return;
      this.state.delete(key);
      this.stateBytes -= prev.bytes;
    } else {
      if (c && ((!prev && this.state.size >= STATE_CAPS.keys) || this.stateBytes - (prev?.bytes ?? 0) + bytes > STATE_CAPS.bytes)) {
        this.error(c, 'state-full', `state is capped at ${STATE_CAPS.keys} keys and ${STATE_CAPS.bytes} B`);
        this.stopBrowserRules(c, 'size', `This game's rules exceeded the browser room state cap: ${STATE_CAPS.keys} keys and ${STATE_CAPS.bytes} B. Join again for a fresh room.`);
        return;
      }
      this.state.set(key, { d: m.d, bytes });
      this.stateBytes += bytes - (prev?.bytes ?? 0);
    }
    this.stats.states += 1;
    this.persistDirty = true;
    const out = JSON.stringify({ t: 'state', k: key, d: m.d ?? null });
    for (const o of (c && this.rules && c.rules ? this.live() : this.others(c))) if (!this.lite(o)) this.sendText(o.conn, out);
  }

  hostRound(c, m) {
    if (!m.round || typeof m.round !== 'object') return;
    const retime = Boolean(m.retime && (this.server || this.rules && c?.rules));
    // The results name every AI as AI, whatever the host's game says (section 17).
    const round = retime && this.lastRound?.n === m.round.n && this.lastRound?.phase === m.round.phase ? { ...m.round, ...(this.lastRound.results ? { results: this.lastRound.results } : {}) } : Array.isArray(m.round.results) ? { ...m.round, results: this.labelResults(m.round.results) } : m.round;
    const wasLive = this.lastRound && this.lastRound.phase === 'live' ? Number(this.lastRound.n) : null;
    this.lastRound = round;
    // The round a launch change waits for is over: everyone sees its results for a moment, then the room re-gates.
    if (this.regate && round.phase === 'over' && (this.regate.roundN === null || Number(round.n) >= this.regate.roundN)) this.regate.until = Math.min(this.regate.until, this.now() + 5000);
    if (this.agentsOut && round.phase === 'over' && (this.agentsOut.roundN === null || Number(round.n) >= this.agentsOut.roundN)) this.agentsOut.until = Math.min(this.agentsOut.until, this.now() + 5000);
    this.stats.rounds += 1;
    this.persistDirty = true;
    for (const o of (c && this.rules && c.rules ? this.live() : this.others(c))) this.send(o, { t: 'round', round: retime ? m.round : round, ...(retime ? { retime: true } : {}) });
    // A party's first live round with AI seats: the vote on how strong the AI should be (once per 30 minutes).
    if (round.phase === 'live' && wasLive !== Number(round.n)) this.autoVote();
    this.tellWatchers();
  }

  heldPeers() {
    return [...this.seats].filter(([, s]) => !s.present).map(([seat, s]) => ({ id: `held-${s.occ}`, seat, occ: s.occ, name: s.name, ...(s.agent ? { agent: s.agent } : {}) }));
  }

  hostRoster(c, m) {
    if (!Array.isArray(m.slots)) return;
    // A host cannot hide an AI: a seat an agent holds is named and marked so, a slot with no seat is a bot.
    this.lastRoster = this.labelRoster(m.slots.slice(0, 64));
    this.persistDirty = true;
    for (const o of (c && this.rules && c.rules ? this.live() : this.others(c))) this.send(o, { t: 'roster', slots: this.lastRoster });
    this.tellWatchers();
  }

  hostCaps(c, m) {
    // The host's game reads the dial and/or moves agents' bodies (section 17): the office and the shell say so.
    if (!Array.isArray(m.caps)) return;
    if (c) { for (const k of m.caps) if (CAPS.includes(k)) c.caps.add(k); this.caps = new Set(c.caps); } else this.caps = new Set(m.caps.filter((k) => CAPS.includes(k)));
    this.persistDirty = true;
    this.tellWatchers();
  }

  /** The room's policy, to everyone in it and to the server host. */
  tellPolicy() {
    this.broadcast({ t: 'policy', policy: this.policyOut() });
    this.toServer({ t: 'policy', policy: this.policyOut() });
  }

  /* ------------------------------------------------------------ sockets */

  /** A new relay socket. Returns the two callbacks the transport must call. */
  attach(conn) {
    const now = this.now();
    const c = {
      id: randomId(6), conn, ip: conn.ip ?? null, browser: conn.browser ?? null, player: conn.player ?? null, via: conn.via ?? null, helloed: false, seat: null, token: null, name: '', typed: '', colour: 0,
      // Room chat (section 19): the Worker's word that this socket's account is a signed-in one (a passkey, not a guest),
      // and that it belongs to this room's server.
      acct: conn.acct === true, member: conn.member === true,
      device: 'desk', want: 'play', canHost: true, hidden: false, waiting: false, joinedAt: now, lastSeen: now, lastSnapAt: 0,
      rates: new Map(), drops: [], errAt: 0,
      // A watcher (section 16): the Worker's word for a socket opened through a watch door, else the hello's own.
      watch: conn.watch === true, policy: WATCH_POLICIES.includes(conn.watchPolicy) ? conn.watchPolicy : 'follow', follow: null, followWhy: null,
      // An agent (section 17): only the Worker's word, from a verified pass, makes one; its hello cannot.
      agentWord: conn.agent && typeof conn.agent === 'object' ? conn.agent : null, agent: null, caps: new Set(), speechAt: [],
      // A badge the studio's Worker verified (the shop: a supporter's); a hello cannot set one.
      badge: typeof conn.badge === 'string' ? conn.badge : null,
      // Revision 7: the latest view the host showed this AI (what its arguments are checked against), and its pace.
      lastView: null, viewAt: 0, doAt: 0,
      // Revision 9: the game revision this socket's page was served with. The Worker's word (it is in the socket's
      // address, so a helper from before revisions carries it too) when the transport gives one, else the hello's.
      verWord: 'ver' in conn ? versionOf(conn.ver) : undefined, ver: null, feat: [], staleTold: false,
    };
    this.clients.set(c.id, c);
    return {
      id: c.id,
      onMessage: (text) => this.guard(c, 'message', () => this.onMessage(c, text), text),
      /** `via`: how the transport learned it (`close`, or `error`: the socket failed, which is how a lost network arrives). */
      onClose: (via = 'close') => this.guard(c, 'close', () => this.onClose(c, 'closed', via)),
    };
  }

  /**
   * The boundary every socket callback crosses. A room operation that throws is logged with what the room was doing
   * (the frame's type, never its contents: a hello carries a seat token) and never reaches the transport, where the
   * runtime would print it as an uncaught error with no room and no time on it. The socket's client stays as it is:
   * one bad frame does not end a seat.
   */
  guard(c, op, fn, text = null) {
    try { return fn(); } catch (error) {
      let frame = null;
      if (typeof text === 'string') { const m = /^\s*\{\s*"t"\s*:\s*"([a-z-]{1,16})"/.exec(text.slice(0, 64)); frame = m ? m[1] : null; }
      this.stats.failed = (this.stats.failed ?? 0) + 1;
      this.log({ ev: 'failed', room: this.code, op, ...(frame ? { frame } : {}), id: c?.id ?? null, seat: c?.seat ?? null, role: c && c.helloed ? this.roleOf(c) : null, clients: this.clients.size, error: errorLine(error) });
      return undefined;
    }
  }

  /**
   * The shell's watch socket: the room's facts, and (revision 6) the party's vote from the play page's card. A vote
   * from it counts as the seat of the client in this room with the same browser key (`conn.browser`).
   */
  watch(conn) {
    this.watchers.add(conn);
    this.sendText(conn, JSON.stringify(this.facts()));
    // A shell that comes back to a room it was kicked from (or that is closed) hears so at once.
    const held = this.heldNotice(conn);
    if (held) this.sendText(conn, JSON.stringify(held));
    // Room chat (section 19): the last few minutes, so a page that just opened has the conversation (never to a page the
    // studio holds out of the room, or a room it closed).
    // A line of this browser's or this account's own says so (`mine`), on this page's copy only: it may take it down.
    if ((!held || held.t === 'muted') && (!conn.hub || this.chatRules().hub)) this.sendText(conn, JSON.stringify({ t: 'lines', lines: this.recentChat().map((r) => (this.ownLine(r, conn) ? { ...this.wireLine(r), mine: true } : this.wireLine(r))) }));
    const rate = [];
    return {
      onClose: () => this.watchers.delete(conn),
      onMessage: (text) => {
        const now = this.now();
        while (rate.length && rate[0] <= now - 1000) rate.shift();
        if (rate.length >= 10 || String(text).length > LIMITS.say) return;
        rate.push(now);
        let m = null;
        try { m = JSON.parse(String(text)); } catch { return; }
        // Room chat from the shell (the play page, the big screen's page, the watch page, a homie.rocks room page).
        if (m && (m.t === 'say' || m.t === 'react')) { this.onChat({ conn }, m); return; }
        // Their own message, taken down by its sender (0.29.0).
        if (m && m.t === 'unsay') { const r = this.unsayOwn(conn, m.id); if (!r.ok) this.sendText(conn, JSON.stringify({ t: 'held', why: 'unknown', message: r.error === 'not-yours' ? 'Only its sender (or the studio) can take a message down.' : 'That message is gone already.' })); return; }
        if (!m || m.t !== 'vote' || !conn.browser) return;
        const c = this.live().find((o) => o.browser === conn.browser && o.seat !== null && !o.agent && !o.watch);
        if (c) this.onVote(c, m, conn);
        else this.sendText(conn, JSON.stringify({ t: 'error', code: 'vote', message: 'only a seated player votes' }));
      },
    };
  }

  /* ------------------------------------------------------------ wire */

  sendText(conn, text) {
    try { conn.send(text); this.stats.bytesOut += this.rules ? byteLength(text) : text.length; } catch { /* closing */ }
  }
  send(c, msg) { this.sendText(c.conn, JSON.stringify(msg)); }
  error(c, code, message, extra = {}) { this.send(c, { t: 'error', code, message, ...extra }); }
  live() { return [...this.clients.values()].filter((c) => c.helloed); }
  others(c) { return this.live().filter((o) => o !== c); }
  host() { return this.hostId ? this.clients.get(this.hostId) ?? null : null; }
  hostRef() { if (this.server) return { id: 'server', seat: null }; const h = this.host(); return h ? { id: h.id, seat: h.seat } : null; }
  roleOf(c) { return c.id === this.hostId ? 'host' : c.seat === null ? 'screen' : 'replica'; }
  peer(c) {
    // Revision 9: which stay in the seat this is (`occ`), the peer's game revision and what its build can do.
    const occ = c.seat !== null ? this.seats.get(c.seat)?.occ : undefined;
    return { id: c.id, seat: c.seat, name: c.name, colour: c.colour, device: c.device, want: c.want, role: this.roleOf(c), ...(c.watch ? { watch: true } : {}), ...(c.agent ? { agent: { ...c.agent } } : {}), ...(this.muteOf(c) ? { muted: true } : {}), ...(c.badge && !c.agent ? { badge: c.badge } : {}), ...(Number.isInteger(occ) ? { occ } : {}), ...(c.ver ? { ver: c.ver } : {}), ...(c.feat.length ? { feat: [...c.feat] } : {}) };
  }
  /** A hands-`host` agent (section 17): no game client of its own, so no snapshots, checkpoints or state. */
  lite(c) { return Boolean(c.agent && c.agent.hands === 'host'); }
  seatedHumans() { return this.live().filter((c) => c.seat !== null && !c.agent); }
  /** Seats kept for AI: the top `aiSeats + guides` (DESIGN D6), never every seat (one is always a person's). */
  reserve() {
    const p = this.policy;
    const n = p.kind === 'hybrid' || p.kind === 'beginner' ? p.aiSeats + p.guides : 0;
    return Math.max(0, Math.min(n, this.maxPlayers - 1));
  }
  humanCap() { return Math.max(1, this.maxPlayers - this.reserve()); }
  agentsAllowed() { return this.policy.kind !== 'humans-only'; }
  /** The room's dial now: the party's vote (or the owner's), else the server's level; a kids room caps it. */
  levelNow() { return Math.max(1, Math.min(this.policy.levelMax, this.level ?? this.policy.level)); }
  policyOut() {
    const level = this.levelNow();
    return { ...this.policy, chat: publicChat(this.chatRules()), skill: skillPreset(level, { kids: this.policy.kids }), ...(this.levelBy ? { by: this.levelBy } : {}) };
  }
  /** Send to every client in the room (a lite agent too: it hears join/leave, roster, round, policy and votes). */
  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const o of this.live()) this.sendText(o.conn, text);
  }
  peers() { return this.live().map((c) => this.peer(c)); }
  stateObject() { const o = {}; for (const [k, v] of this.state) o[k] = v.d; return o; }

  /**
   * A game's own decision (section 20): the host's typed questions about its state, answered by the studio's decision
   * model through the Table (`decider`). Only the host asks; the answer (`decided`, option ids and numbers only) goes
   * back to that socket alone. Off, paced, over budget, too slow or wrong: `ok: false` with why, and the host's own floor
   * answers. `n` is the host's own id for the request.
   */
  onDecide(c, m, isHost) {
    const n = typeof m.n === 'string' || Number.isInteger(m.n) ? String(m.n).slice(0, 16) : '';
    const server = this.server;
    const reply = (o) => { const frame = { t: 'decided', n, ...o }; if (c) { const recipient = this.rules && isHost ? this.host() : c; if (recipient) this.send(recipient, frame); } else if (server && this.server === server) this.toServer(frame); };
    if (!isHost || (c && this.lite(c))) return reply({ ok: false, why: 'not-host' });
    if (typeof this.decider !== 'function') return reply({ ok: false, why: 'off' });
    const now = this.now();
    while (this.decideTimes.length && this.decideTimes[0] <= now - 60_000) this.decideTimes.shift();
    const last = this.decideTimes.at(-1) ?? -Infinity;
    if (now - last < DECIDE.gapMs - 100 || this.decideTimes.length >= DECIDE.perMinute) return reply({ ok: false, why: 'pace', retryMs: Math.max(DECIDE.gapMs - (now - last), this.decideTimes.length >= DECIDE.perMinute ? this.decideTimes[0] + 60_000 - now : 0) });
    if (this.decidePending >= DECIDE.inFlight) return reply({ ok: false, why: 'busy' });
    const q = checkDecide(m.state, m.questions);
    if (!q.ok) return reply({ ok: false, why: 'bad', message: q.why });
    this.decideTimes.push(now);
    this.decidePending += 1;
    this.stats.decides += 1;
    Promise.resolve()
      .then(() => this.decider(q.state, q.questions, { room: this.code, kids: this.policy.kids }))
      .then((r) => {
        const by = r?.ok ? r.by ?? 'ai' : r?.why ?? 'error';
        this.stats.decided[by] = (this.stats.decided[by] ?? 0) + 1;
        if (r?.ok) { this.stats.decideMs.push(r.ms ?? 0); if (this.stats.decideMs.length > 40) this.stats.decideMs.shift(); this.stats.decideNeurons = (this.stats.decideNeurons ?? 0) + (Number(r.neurons) || 0); }
        reply(r?.ok ? { ok: true, by: r.by ?? 'ai', picks: r.picks ?? {}, p: r.p ?? {}, ms: r.ms ?? null } : { ok: false, why: r?.why ?? 'error' });
      })
      .catch(() => { this.stats.decided.error = (this.stats.decided.error ?? 0) + 1; reply({ ok: false, why: 'error' }); })
      .finally(() => { this.decidePending -= 1; });
  }

  /** Drop the socket from the room and close it. */
  kick(c, why, code = 1008) {
    this.stats.kicked += 1;
    this.onClose(c, why);
    try { c.conn.close(code, why); } catch { /* gone */ }
  }

  stopBrowserRules(c, why, message) {
    if (!this.rules || !c.rules || c.id !== this.hostId) return false;
    this.log({ ev: 'host-ended', room: this.code, why });
    for (const peer of this.live()) {
      this.error(peer, 'room-over', message);
      this.clients.delete(peer.id);
      try { peer.conn.close(1011, 'room-over'); } catch { /* gone */ }
    }
    this.forget();
    return true;
  }

  allow(c, t, bytes, view = false) {
    // A spectator screen has little to say: its events are capped at 512 B (16 screens x 2/s x 512 B at most reach the host).
    const cap = t === 'ev' && c.seat === null && (view || c.id !== this.hostId) ? 512 : capOf(t, this.seatCap);
    const rulesOutput = !view && this.rules && c.rules && c.id === this.hostId;
    if (bytes > cap) {
      this.stats.oversize += 1;
      const detail = `${t} is ${bytes} B; the cap is ${cap} B`;
      this.error(c, 'too-large', detail, view ? { view: true } : {});
      if (rulesOutput) this.stopBrowserRules(c, 'size', `This game's rules exceeded the browser room size cap: ${detail}. Join again for a fresh room.`);
      return false;
    }
    const now = this.now();
    if (rulesOutput) {
      c.rulesBuckets ??= new Map();
      const rate = rulesRates(this.tickHz, this.seatCap)[t];
      if (!takeRulesToken(c.rulesBuckets, t, rate, now)) return true;
      this.stats.drops += 1;
      if (t === 'snap') return false;
      const message = `The hosting page exceeded its ${t} allowance. Moving the rules to another player.`;
      for (const peer of this.live()) this.send(peer, { t: 'error', code: 'host-fault', message });
      c.canHost = false;
      if (this.elect(c.id, 'host-fault')) this.send(c, { t: 'role', role: c.seat === null ? 'screen' : 'replica', why: 'host-fault', host: this.hostRef(), peers: this.peers() });
      else { this.hostId = c.id; this.stopBrowserRules(c, 'rate', 'No player can host this room after its host failed. Join again for a fresh room.'); }
      return false;
    }
    const limit = t === 'ev' ? EV_RATES[view ? (c.seat === null ? 'screen' : 'replica') : this.roleOf(c)] : (RATES[t] ?? RATES.other);
    const rateKey = view ? `${t}:view` : t;
    const list = c.rates.get(rateKey) ?? [];
    while (list.length && list[0] <= now - 1000) list.shift();
    c.rates.set(rateKey, list);
    if (list.length >= limit) {
      this.stats.drops += 1;
      c.drops.push(now);
      while (c.drops.length && c.drops[0] <= now - 5000) c.drops.shift();
      // Sustained abuse (20/s over a cap for 5 s) ends the socket; anything less is reported once a second.
      if (c.drops.length > 100) { this.error(c, 'flood', 'too many messages over the rate caps'); this.kick(c, 'flood'); return false; }
      if (now - c.errAt >= 1000) { c.errAt = now; this.send(c, { t: 'error', code: 'rate', of: t, message: `${t} over ${limit}/s was dropped`, ...(view ? { view: true } : {}) }); }
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
    const bytes = this.rules ? byteLength(text) : text.length;
    this.stats.bytesIn += bytes;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!c.helloed) { if (m.t === 'hello' && bytes <= LIMITS.hello) this.hello(c, m); return; }
    const view = this.rules && !(c.rules && c.id === this.hostId && m.rules === true && RULES_FRAMES.includes(m.t));
    if (!this.allow(c, m.t, bytes, view)) return;
    const isHost = c.id === this.hostId && !view;
    switch (m.t) {
      case 'rules-end': {
        if (!isHost || !c.rules || !this.rules) return;
        const why = ['budget', 'overrun', 'fault', 'clock', 'load', 'size', 'rate'].includes(m.why) ? m.why : 'fault';
        for (const peer of this.live()) {
          this.error(peer, 'room-over', `This game's rules stopped: ${why}. Join again for a fresh room.`);
          this.clients.delete(peer.id);
          try { peer.conn.close(1011, 'room-over'); } catch { /* gone */ }
        }
        this.forget();
        return;
      }
      case 'snap': {
        if (!isHost) return;
        return this.hostSnap(c, m, now);
      }
      case 'in': {
        if (isHost || c.seat === null || this.lite(c)) return;
        // Revision 10: a rules game's input goes to the server host as it came (`e`, `k`, `s`, `r`); the runtime holds
        // every value to its declared type, so nothing here needs to know the game's fields.
        if (this.server) {
          if (!Array.isArray(m.s)) return;
          this.stats.ins += 1;
          this.toServer({ t: 'in', from: c.seat, e: Number(m.e) || 0, k: Number(m.k) || 0, s: m.s.slice(0, 64), r: Number(m.r) || 0 });
          return;
        }
        const h = this.host();
        if (!h) return;
        this.stats.ins += 1;
        if (h.rules && Array.isArray(m.s)) { this.send(h, { t: 'in', from: c.seat, e: Number(m.e) || 0, k: Number(m.k) || 0, s: m.s.slice(0, 64), r: Number(m.r) || 0 }); return; }
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
        // The server's speech (section 17): `lines` drops every free-text chat (quick lines and emotes pass), `off`
        // drops all speech, whoever sends it (a host relaying a player's chat too).
        if (SPEECH.test(kind) && (this.policy.speech === 'off' || (this.policy.speech === 'lines' && /^chat/i.test(kind)))) { this.stats.speechDrops += 1; return; }
        // What an AI may send (section 18): its own goals and its game's lines, checked here whatever its host says.
        if (c.agent && !this.agentEvOk(c, kind, m, bytes, now)) { this.stats.agentDrops += 1; return; }
        // An agent says at most one line every 4 s and 8 a minute.
        if (c.agent && SPEECH.test(kind)) {
          while (c.speechAt.length && c.speechAt[0] <= now - 60_000) c.speechAt.shift();
          if (c.speechAt.length >= AGENT_SPEECH.perMinute || (c.speechAt.length && now - c.speechAt[c.speechAt.length - 1] < AGENT_SPEECH.gapMs)) { this.stats.agentDrops += 1; return; }
          c.speechAt.push(now);
        }
        // A line the host relays for an AI (`d.ai`): still only a line of the vocabulary, with fitting arguments.
        if (isHost && d0(m).ai === true && !this.aiLineOk(kind, d0(m))) { this.stats.agentDrops += 1; return; }
        // The host shows one AI the game (`agent:view`): to that AI's seat only, small, at most one every 2 s.
        if (kind === 'agent:view' && !this.agentViewOk(m, bytes, now, isHost)) return;
        this.stats.evs += 1;
        const speaker = isHost && this.rules && c.rules ? (Number.isInteger(m.from) && this.live().some(p => p.seat === m.from && !p.agent) ? m.from : null) : c.seat;
        const out = { t: 'ev', from: speaker, k: kind, d: m.d ?? null, ...(isHost && this.rules && c.rules ? { hosted: true } : {}) };
        const recipients = isHost && this.rules && c.rules ? this.live() : this.others(c);
        if (isHost) {
          if (typeof m.to === 'string') { const o = this.clients.get(m.to); if (o && o.helloed && (o !== c || (this.rules && c.rules))) this.send(o, out); }
          else if (Number.isInteger(m.to)) { for (const o of recipients) if (o.seat === m.to) this.send(o, out); }
          // An agent with no game client hears only what is addressed to its seat (the lite feed), and the party's lines.
          else for (const o of recipients) { if (!this.lite(o) || this.liteHears(kind)) this.send(o, out); }
        } else {
          const h = this.host();
          if (this.server) this.toServer({ ...out, id: c.id });
          else if (h) this.send(h, { ...out, id: c.id });
          // The lite feed (section 18): an AI with no game client hears the party's lines, and an ask made of it.
          if (!c.agent) this.copyToLite(c, kind, out);
        }
        return;
      }
      case 'decide': return this.onDecide(c, m, isHost);
      case 'ckpt': {
        if (!isHost) return;
        this.lastCkpt = { k: Number(m.k) || 0, st: this.stamp(m.st), d: m.d ?? null, ...(Array.isArray(m.c) ? { c: m.c.slice(0, 64) } : {}) };
        this.stats.ckpts += 1;
        this.persistDirty = true;
        return;
      }
      case 'state': {
        if (!isHost) return;
        return this.hostState(c, m, bytes);
      }
      case 'round': {
        if (!isHost) return;
        return this.hostRound(c, m);
      }
      case 'roster': {
        if (!isHost) return;
        return this.hostRoster(c, m);
      }
      case 'caps': {
        if (!isHost) return;
        return this.hostCaps(c, m);
      }
      case 'vote': {
        this.onVote(c, m);
        return;
      }
      case 'say':
      case 'react': {
        // Room chat (section 19): the game's own chat UI (`net.say`, `net.react`), checked like the shell's.
        this.onChat({ client: c }, m);
        return;
      }
      case 'ping': {
        if (this.rules && c.rules && Number.isFinite(m.readySpeed)) { c.readySpeed = Math.max(0, Math.min(1, m.readySpeed)); c.readyAt = now; }
        const wasHidden = c.hidden;
        c.hidden = m.hid === true;
        this.send(c, { t: 'pong', c: m.c, st: now });
        // A host whose tab went to the background will stop ticking: hand the round on now.
        if (c.id === this.hostId && c.hidden && !wasHidden) this.yieldHost(c, 'host-hidden');
        return;
      }
      case 'yield': {
        if (c.id === this.hostId && this.rules && c.rules && m.slow === true) {
          c.rulesSpeed = Math.max(0, Math.min(1, Number(m.speed) || 0));
          // Both a recent event-loop measurement and any observed hosting speed must be substantially faster.
          if (this.live().some(p => p !== c && p.canHost && this.fasterRulesHost(p, c))) this.yieldHost(c, 'host-slow');
        } else if (c.id === this.hostId) this.yieldHost(c, 'host-yielded');
        // A rules host holds its output from its yield on: it is told when the role stays with it (and the others,
        // who were just told nobody hosts, are told who does).
        if (this.rules && c.rules && c.id === this.hostId) for (const o of this.live()) this.send(o, { t: 'host', host: this.hostRef(), why: 'host-kept' });
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
    // Revision 10: this game's rules run on the server and could not start. Nobody is let in, and the reason is said.
    if (this.endedMatch?.until <= this.now()) this.endedMatch = null;
    if (this.endedMatch?.tokens.has(m.token)) return refuse('room-over', 'This match ended. Joining a fresh room.', { rematch: true, ver: this.endedMatch.ver });
    if (this.ended) return refuse('room-over', 'This room ended. Joining a fresh room.', { rematch: true, ver: this.ended.ver });
    if (this.hostFailed) return refuse('host-failed', this.hostFailed);
    // The owner closed this room, or held this player out of it (section 15): refused, with when it ends.
    if (this.closedUntil > this.now()) return refuse('room-closed', this.closedWhy || 'The studio closed this room.', { until: this.closedUntil });
    const ban = this.banOf(c, typeof m.token === 'string' ? m.token : '');
    if (ban) return refuse('kicked', ban.message, { until: ban.until });
    // A watcher of a game that cannot be watched (game.json "watch": false) is refused for good (section 16).
    const watching = !c.agentWord && (c.watch || m.watch === true);
    if (watching && c.policy === 'off') return refuse('watch-off', 'this game cannot be watched; play it instead');
    // An AI sits only with a pass the Worker verified (section 17): a hello that says it is one, with none, is refused.
    if (m.agent && typeof m.agent === 'object' && !c.agentWord) return refuse('agent-pass', 'an AI plays here with an agent pass from the studio');
    const now = this.now();
    if (c.agentWord) {
      const a = c.agentWord;
      if (!this.agentsAllowed()) return refuse('agents-off', 'This server is for humans only');
      // A lite agent (hands `host`) needs a host whose game moves AI bodies (it declared `caps: ['agents']`).
      const hostCaps = this.host() ? this.host().caps : this.caps;
      if (a.hands === 'host' && !hostCaps.has('agents')) return refuse('agents-unsupported', 'this room\'s game cannot move an AI\'s body (its build predates agent seats); an AI that runs the game itself can still sit');
      // An AI never keeps a room alive (DESIGN D9): with no person seated for a while, it may not come in.
      if (!this.seatedHumans().length && now - this.lastHumanAt >= this.agentsAloneMs) return refuse('agents-alone', 'nobody is playing in this room; an AI comes back when a person is seated', { final: false });
      c.agent = { pass: String(a.pass ?? '').slice(0, 16), role: ['party', 'guide', 'player'].includes(a.role) ? a.role : 'party', hands: a.hands === 'host' ? 'host' : 'self', by: ['studio', 'guest', 'service'].includes(a.by) ? a.by : 'studio' };
      c.agentName = aiName(a.name ?? a.label ?? 'Agent');
    }
    // REVISIONS (section 23): a room runs one build of its game at a time. A client with no game code of its own (an
    // AI the host moves) has no build.
    c.ver = c.verWord !== undefined ? c.verWord : versionOf(m.ver);
    c.feat = featuresOf(m.feat);
    const lite = Boolean(c.agentWord && c.agentWord.hands === 'host');
    if (!lite && this.server && this.currentVer !== undefined && c.ver !== this.currentVer) return refuse('stale', 'This game was updated. Loading it again.', { ver: this.currentVer, immediate: true });
    if (!lite && !this.server) {
      const here = live.filter((o) => !this.lite(o));
      const cur = this.currentVer;
      if (here.length && (this.gameVer ?? null) !== c.ver) {
        if (cur !== undefined && c.ver !== cur) {
          // The newcomer is the old one (a tab open since before a deploy): it is told to reload, for good.
          this.log({ ev: 'stale', room: this.code, id: c.id, ver: c.ver, room_ver: this.gameVer ?? null, current: cur });
          return refuse('stale', 'This game was updated. Reload to play the new version.', { ver: cur });
        }
        // The room is the old one: its players are told a new build is live (once each), and the newcomer waits for
        // it (not final: its helper knocks again, and is let in once nobody on the old build is left).
        for (const o of here) if (cur !== undefined && o.ver !== cur && !o.staleTold) { o.staleTold = true; this.send(o, { t: 'stale', ver: cur }); }
        this.log({ ev: 'room-stale', room: this.code, id: c.id, ver: c.ver, room_ver: this.gameVer ?? null, current: cur ?? null });
        return refuse('room-stale', 'This room is still running another version of the game. It opens to this one when its players reload.', { ver: this.gameVer ?? null });
      }
      if (!here.length) {
        // Nobody on the other build is left: the room is this build's now, and starts fresh. A checkpoint, a snapshot
        // and keyed state written by other code are exactly what a new build must not read.
        if (this.gameVer !== undefined && this.gameVer !== c.ver) this.forgetWorld(c.ver);
        this.gameVer = c.ver;
      }
    }
    if (this.perIp && c.ip && live.filter((o) => o.ip === c.ip).length >= this.perIp) return refuse('too-many', `at most ${this.perIp} sockets per address in one room`);
    if (live.length >= this.maxPlayers + this.maxScreens) return refuse('room-full', 'this room is full; try another');
    c.rules = m.rules === true;
    c.device = m.device === 'phone' || m.device === 'tv' ? m.device : 'desk';
    // A watcher is a screen that never takes a seat, whatever else its hello says. An agent always plays.
    c.watch = watching;
    c.want = c.agent ? 'play' : watching || m.want === 'screen' ? 'screen' : 'play';
    // An agent with no game client never hosts; one that runs the game hosts only a room no person can (DESIGN D10).
    c.canHost = c.agent ? c.agent.hands === 'self' && m.canHost !== false : m.canHost !== false;
    // Rules output is marked since revision 11: an older page's would be taken for a player's, so it never hosts.
    if (this.rules && c.rules && !(Number(m.rev) >= 11)) c.canHost = false;
    c.game = typeof m.game === 'string' ? m.game.slice(0, 64) : '';
    // A person's typed name never ends in an AI or bot mark; on a kids server nobody's typed name is used (handles).
    c.typed = c.agent || this.policy.kids ? '' : typeof m.name === 'string' ? stripAi(m.name.replace(/\s+/g, ' ').trim()).slice(0, 24) : '';
    if (Array.isArray(m.caps)) for (const k of m.caps) if (CAPS.includes(k)) c.caps.add(k);
    // The manifest's player count, from the first visitor of an empty room (the site's Table reads the manifest).
    if (!this.server && !this.rules && Number.isInteger(m.max) && !this.seats.size && !live.length) { this.askedMax = m.max; this.maxPlayers = Math.max(1, Math.min(this.seatCap, m.max)); }
    this.reapSeats(now);
    // The verified pass names one AI. Reopening its socket resumes that seat and replaces the old socket.
    const agentStay = c.agent?.pass ? [...this.seats.values()].find(s => s.agent?.pass === c.agent.pass) : null;
    const resumeToken = agentStay?.token ?? (typeof m.token === 'string' ? m.token : '');
    const resumeBan = agentStay && this.banOf(c, resumeToken);
    if (resumeBan) return refuse('kicked', resumeBan.message, { until: resumeBan.until });
    // Pace the verified pass's stay, not its replaceable socket. Refusal cannot evict its current holder.
    if (agentStay) {
      const times = (agentStay.reopenTimes ?? []).filter(at => at > now - 60_000);
      const retryMs = Math.max((times.at(-1) ?? -Infinity) + 4000 - now, times.length >= 8 ? times[0] + 60_000 - now : 0);
      if (retryMs > 0) return refuse('agent-pace', 'this AI seat reopened too recently', { retryMs, final: false });
      agentStay.reopenTimes = [...times, now];
    }
    let full = false;
    if (c.want === 'play' && !this.seatClient(c, resumeToken)) {
      // The studio's own house guide (a loopback) makes way for an AI with a pass (the owner's Claude, say).
      const house = c.agent && !c.conn.loopback ? this.live().find((o) => o.agent && o.conn.loopback && o.seat !== null) : null;
      if (house) {
        const seat = house.seat;
        this.error(house, 'agent-yield', 'an AI with a pass took this seat');
        this.kick(house, 'agent-yield', 4002);
        if (this.seats.get(seat)?.token === house.token) { this.seats.delete(seat); this.seatsDirty = true; }
      }
      if (!house || !this.seatClient(c, '')) {
        if (c.agent) return refuse('agents-off', 'no AI seat is free in this room');
        full = true; c.waiting = true;
      }
    }
    if (c.seat === null) c.name = c.typed || (c.want === 'screen' && !c.watch ? 'Screen' : 'Watcher');
    if (c.seat !== null && !c.agent) this.lastHumanAt = now;
    c.helloed = true;
    c.joinedAt = now;
    if (!this.openedAt) this.openedAt = now;
    if (!c.agent) this.emptySince = 0;
    this.lastJoinAt = now;

    let role = c.seat === null ? 'screen' : 'replica';
    let why = 'joined';
    let deposed = null;
    const h = this.host();
    const preferred = this.preferHost && now < this.preferHost.until ? this.preferHost.seat : undefined;
    // A watcher hosts only a room nobody else can host (a player who can is elected first), and never deposes one;
    // an agent hosts only a room no person can host.
    const lastResort = (c.watch && live.some((o) => o.canHost && !o.watch && !o.agent && !o.hidden)) || (c.agent && live.some((o) => o.canHost && !o.agent && !o.hidden));
    // A browser never becomes host of a server-hosted room.
    if (!this.server && c.canHost && !lastResort && (preferred === undefined || preferred === c.seat)) {
      if (!h) {
        role = 'host';
        why = this.lastSnap || this.lastCkpt ? 'resumed' : 'first';
        if (preferred !== undefined) this.preferHost = null;
      } else if (!c.watch && !c.agent && (h.hidden || now - h.lastSeen > this.silentMs)) {
        // The host is a frozen phone (socket open, nothing sent): the newcomer runs the round now, not after a stall.
        deposed = h;
        role = 'host';
        why = h.hidden ? 'host-hidden' : 'host-stalled';
      } else if (!c.watch && !c.agent && h.agent) {
        // A person arrives in a room an AI was hosting: the rules go back to a person's browser (DESIGN D10).
        deposed = h;
        role = 'host';
        why = 'host-person';
      }
    }
    if (role === 'host') {
      // Welcome contains the current holders; old occupancy notices must precede it.
      this.hosted = new Map([...this.seats].map(([seat, s]) => [seat, s.occ ?? null]));
      this.hostId = c.id;
      this.hostSince = now;
      c.lastSnapAt = 0;
      this.seatsDirty = true;
      this.caps = new Set(c.caps);
      this.stats.elections.push({ at: now, id: c.id, seat: c.seat, why });
      if (this.stats.elections.length > 32) this.stats.elections.shift();
    }
    // An older build let in to its own room (it was here first, or the room was empty): it plays, and is told.
    const behind = !lite && this.currentVer !== undefined && c.ver !== this.currentVer;
    if (behind) c.staleTold = true;
    this.send(c, {
      t: 'welcome', v: NET_VERSION, rev: NET_REVISION, id: c.id, room: this.code, seat: c.seat, token: c.token, name: c.name, colour: c.colour,
      ...(this.gameVer ? { ver: this.gameVer } : {}), ...(behind ? { stale: { ver: this.currentVer } } : {}), stall: this.stallMs,
      role, why, host: this.hostRef(), peers: this.peers(), ...(this.rules ? { held: this.heldPeers() } : {}), st: now, max: this.maxPlayers,
      round: this.lastRound, roster: this.lastRoster, snap: lite ? null : this.lastSnap, state: lite ? {} : this.stateObject(),
      ...(role === 'host' ? { ckpt: this.lastCkpt } : {}),
      ...(full ? { full: true } : {}),
      ...(this.liveAnnouncement() ? { announce: this.liveAnnouncement() } : {}),
      ...(c.watch ? { watch: this.followFacts(c) } : {}),
      policy: this.policyOut(),
      ...(this.vote ? { vote: this.voteView() } : {}),
      ...(c.agent ? { agent: { ...c.agent, name: c.name } } : {}),
    });
    for (const o of this.others(c)) this.send(o, { t: 'join', peer: this.peer(c) });
    // The server host hears of every seat taken (a reconnect is the same stay: its body is back, not new).
    if (c.seat !== null) { this.syncServerSeats(); this.joinServer(c); }
    // A seat taken by a browser that also watches this room: its watching tab sees the overview from now on.
    this.refreshWatchers(c);
    if (deposed) {
      this.send(deposed, { t: 'role', role: deposed.seat === null ? 'screen' : 'replica', why, host: this.hostRef(), peers: this.peers() });
      for (const o of this.others(c)) if (o !== deposed) this.send(o, { t: 'host', host: this.hostRef(), why });
    }
    // A roster from before an agent sat is labelled again now (its seat is an AI's).
    if (c.agent && Array.isArray(this.lastRoster)) this.lastRoster = this.labelRoster(this.lastRoster);
    this.log({ ev: 'hello', room: this.code, id: c.id, seat: c.seat, device: c.device, want: c.want, role, why, full, resumed: typeof m.token === 'string' && m.token === c.token, clients: this.live().length, ...(c.watch ? { watch: true } : {}), ...(c.agent ? { agent: c.agent.hands } : {}), ...(c.ver ? { ver: c.ver } : {}) });
    this.persist(now); // a new seat (or a new host) is written now, not on the next tick: a deploy can come any moment
    this.tellWatchers();
  }

  /** Give `c` a seat: its token's seat, a free one, or the seat absent longest. False when every seat is present. */
  seatClient(c, token) {
    const seat = this.seatFor(token, c.agent ? 'agent' : 'human');
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
    s.agent = c.agent ? { ...c.agent } : null;
    // An agent is always "<label> · AI" (DESIGN D7); a person keeps their seat's name, else gets a handle.
    const name = c.agent ? c.agentName : c.typed || (s.name && !s.wasAgent ? s.name : '') || handleFor(s.token, new Set([...this.seats.values()].map((x) => x.name).filter(Boolean)));
    s.wasAgent = Boolean(c.agent);
    if (name !== s.name) { s.name = name; this.seatsDirty = true; }
    c.name = name;
    c.colour = seat % PALETTE_SIZE;
    return true;
  }

  /**
   * A seat for a token (its own seat, whatever the range: a person seated above a new cap keeps it), else a free
   * seat of the right kind: a person's in [0, max - reserve), an agent's in [max - reserve, max) (DESIGN D6; with no
   * reserve, any seat, from the top). Every seat taken: the one absent longest of the same kind.
   */
  seatFor(token, kind = 'human') {
    if (token) for (const [seat, s] of this.seats) if (s.token === token && Boolean(s.agent) === (kind === 'agent')) return seat;
    // Every new holder of a seat is a new stay in it (`peer.occ`): a host tells "they came back" from "somebody new".
    const fresh = () => ({ token: randomId(18), name: '', since: this.now(), present: true, agent: null, occ: (this.occSeq += 1) });
    const reserve = this.reserve();
    const order = [];
    if (kind === 'agent') {
      const lo = reserve ? this.maxPlayers - reserve : 0;
      for (let seat = this.maxPlayers - 1; seat >= lo; seat -= 1) order.push(seat);
    } else for (let seat = 0; seat < this.humanCap(); seat += 1) order.push(seat);
    for (const seat of order) {
      if (this.seats.has(seat)) continue;
      this.seats.set(seat, fresh());
      this.seatsDirty = true;
      return seat;
    }
    // Every seat is present or held. A visitor who is here beats one who left: reclaim the seat absent longest.
    let oldest = null;
    for (const seat of order) {
      const s = this.seats.get(seat);
      if (s && !s.present && Boolean(s.agent) === (kind === 'agent') && (!oldest || s.since < oldest[1].since)) oldest = [seat, s];
    }
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
      this.syncServerSeats(); this.joinServer(c);
      this.log({ ev: 'seated', room: this.code, id: c.id, seat: c.seat });
      this.persist();
      this.refreshWatchers();
      this.tellWatchers();
    }
  }

  /* ------------------------------------------------------------ agent hands and brains (section 18) */

  /** The game's agents.json (the Table reads it once from the build): the only goals and lines an AI here has. */
  setVocabulary(raw) {
    this.vocab = raw ? vocabularyOf(raw).vocab : null;
    this.rawVocab = this.vocab ? raw : null;
    if (this.server) this.toServer({ t: 'vocabulary', vocab: this.rawVocab });
    return Boolean(this.vocab);
  }

  /** Browser and server hosts share the same view validation and pacing. */
  agentViewOk(m, bytes, now, isHost) {
    const o = isHost && Number.isInteger(m.to) ? this.live().find((x) => x.seat === m.to && x.agent) : null;
    if (!o || bytes > AGENT_FRAMES.viewBytes || now - o.viewAt < AGENT_FRAMES.viewMs - 250) { this.stats.agentDrops += 1; return false; }
    o.viewAt = now;
    o.lastView = m.d && typeof m.d === 'object' && !Array.isArray(m.d) ? m.d : null;
    return true;
  }

  /** The seats people hold now (a "player" argument names one of them). */
  peopleSeats() { return this.seatedHumans().map((c) => c.seat); }

  /**
   * Whether this AI may send this event: `agent:do` (a goal of the vocabulary, arguments that fit the view the host
   * last showed it, at most one every 3 s), `say:<lineId>` (a line of the vocabulary, on a server whose AI may talk),
   * never `agent:view`, `chat:` or `emote:` (an AI never types), and nothing else from an AI with no game client.
   */
  agentEvOk(c, kind, m, bytes, now) {
    if (kind === 'agent:view') return false;
    const ctx = { view: c.lastView, players: this.peopleSeats() };
    const d = m.d && typeof m.d === 'object' && !Array.isArray(m.d) ? m.d : {};
    if (kind === 'agent:do') {
      if (c.id === this.hostId || !this.vocab || bytes > 1024 || now - c.doAt < AGENT_FRAMES.doMs) return false;
      const goal = (typeof d.goal === 'string' && Object.hasOwn(this.vocab.goals, d.goal) ? this.vocab.goals[d.goal] : null);
      if (typeof d.goal !== 'string' || !goal || checkArgs(goal.args, d.args, ctx)) return false;
      c.doAt = now;
      return true;
    }
    if (SPEECH.test(kind)) {
      const id = SAY.exec(kind)?.[1];
      const line = id && this.vocab ? (Object.hasOwn(this.vocab.lines, id) ? this.vocab.lines[id] : null) : null;
      return Boolean(line && talks(this.policy) && bytes <= 1024 && !checkArgs(line.args, d.args, ctx));
    }
    return !this.lite(c);
  }

  /**
   * A line a host relays for an AI (`say:<lineId>`, `d.ai`): a line of the vocabulary on a server whose AI may talk,
   * arguments that fit (a view argument: the speaking AI's latest view, or for a guide no AI holds, an id at most).
   * A host cannot put words of its own in an AI's mouth on other screens.
   */
  aiLineOk(kind, d) {
    const id = SAY.exec(kind)?.[1];
    const line = id && this.vocab ? (Object.hasOwn(this.vocab.lines, id) ? this.vocab.lines[id] : null) : null;
    if (!line || !talks(this.policy)) return false;
    const speaker = Number.isInteger(d.seat) ? this.live().find((o) => o.seat === d.seat && o.agent) : null;
    if (Number.isInteger(d.seat) && !speaker) return false;
    const args = d.args && typeof d.args === 'object' ? d.args : {};
    const view = speaker ? speaker.lastView : Object.fromEntries(Object.entries(line.args).filter(([, sp]) => sp.kind === 'view').map(([k, sp]) => [sp.key, /^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(args[k] ?? '')) ? [args[k]] : []]));
    return !checkArgs(line.args, args, { view, players: this.peopleSeats() });
  }

  /** What an AI with no game client hears of a host's broadcast: the party's lines (free chat only on a "game" server). */
  liteHears(kind) { return /^(?:say|emote):/i.test(kind) || (/^chat/i.test(kind) && this.policy.speech === 'game'); }

  /** A person's line, copied to every AI with no game client; a person's ask (`ask:<id>`, d.seat), to that AI alone. */
  copyToLite(c, kind, out) {
    const ask = ASK.exec(kind)?.[1];
    if (ask) {
      const seat = out.d && Number.isInteger(out.d.seat) ? out.d.seat : null;
      if (seat === null || (this.vocab && !Object.hasOwn(this.vocab.asks, ask))) return;
      for (const o of this.live()) if (o !== c && this.lite(o) && o.seat === seat) this.send(o, out);
      return;
    }
    if (!SPEECH.test(kind) || !this.liteHears(kind)) return;
    for (const o of this.live()) if (o !== c && this.lite(o) && o.id !== this.hostId) this.send(o, out);
  }

  /* ------------------------------------------------------------ room chat (revision 8, section 19) */

  /** The room's chat rules: the Worker's (in the policy), else the defaults for this server's speech and kids. */
  chatRules() {
    if (this.policy.chat) return this.policy.chat;
    const sig = `${this.policy.kids}|${this.policy.speech}`;
    if (!this.defaultChat || this.defaultChat.sig !== sig) this.defaultChat = { sig, rules: normalizeChat(null, { kids: this.policy.kids, speech: this.policy.speech }) };
    return this.defaultChat.rules;
  }

  /** The window a page that just opened gets: the last `keep` messages of the last `keepMs`. */
  recentChat(now = this.now()) {
    const keep = windowMsOf(this.chatRules());
    return this.chatLog.filter((r) => now - r.at <= keep).slice(-CHAT_LIMITS.keep);
  }

  /**
   * The lines a room kept (its `history`, read back by the Table): into the window under what was said since, oldest
   * first, never twice. A line taken down meanwhile is not in what the Table read.
   */
  hydrate(recs) {
    const have = new Set(this.chatLog.map((r) => r.id));
    const old = (Array.isArray(recs) ? recs : []).filter((r) => r && typeof r.id === 'string' && !have.has(r.id));
    this.chatLog = [...old, ...this.chatLog].sort((a, b) => a.at - b.at).slice(-CHAT_LIMITS.keep);
    this.hydrated = true;
    return old.length;
  }

  /** A line or a reaction as every screen gets it (homie.rocks's room chat shapes: `line` and `react`). */
  wireLine(r) {
    const base = { id: r.id, at: r.at, name: r.name, seat: r.seat, colour: r.colour, by: r.by, ...(r.bubble ? { bubble: true } : {}), ...(r.acct ? { acct: true } : {}), ...(r.owner ? { owner: true } : {}), ...(r.mod ? { mod: true } : {}), ...(r.kept ? { kept: true } : {}) };
    if (r.kind === 'react') return { t: 'react', ...base, react: r.react, glyph: r.glyph };
    // A show-what-you-made card (0.29.0): a page that knows cards draws one; any other shows its words.
    return { t: 'line', ...base, text: r.text, ...(r.say ? { say: r.say } : {}), ...(r.kind === 'card' && r.card ? { card: r.card } : {}) };
  }

  watchIdOf(conn) {
    let id = this.watchIds.get(conn);
    if (!id) { id = randomId(6); this.watchIds.set(conn, id); }
    return id;
  }

  /**
   * Who is speaking: a game socket's own client, or for a shell's watch socket the client of the same browser (or
   * account) in this room: its seat, name and colour. A page with no client here (a homie.rocks room page, a watch
   * page before its game connects) is a watcher with a handle. Signed in, a member, the owner: the Worker's word.
   */
  chatter(client, conn) {
    let g = client;
    if (!g && conn) {
      const mine = this.live().filter((o) => !o.agent && ((conn.browser && o.browser === conn.browser) || (conn.player && o.player === conn.player)));
      g = mine.find((o) => o.seat !== null) ?? mine.find((o) => o.watch) ?? mine[0] ?? null;
    }
    const via = String(g?.via ?? conn?.via ?? '');
    const owner = via.split('~').includes('o');
    const seat = g ? g.seat : null;
    const handle = handleFor(g?.token || g?.browser || conn?.browser || `w-${this.watchIdOf(conn ?? g?.conn ?? {})}`);
    // A watcher's name: its game's, else the account name the Worker vouched for (the Lounge), else a handle.
    const name = seat !== null ? g.name : oneLine(g?.typed, CHAT_LIMITS.name) || oneLine(conn?.name, CHAT_LIMITS.name) || handle;
    return {
      key: g ? `c:${g.id}` : `w:${this.watchIdOf(conn)}`, client: g, seat, name, colour: seat !== null ? g.colour : null,
      player: g?.player ?? conn?.player ?? null, acct: Boolean(g?.acct || conn?.acct), member: Boolean(g?.member || conn?.member) || owner,
      // A moderator the owner named (the Lounge): only the Worker's word, shown on their lines.
      mod: Boolean(conn?.mod) && !owner,
      owner, browser: g?.browser ?? conn?.browser ?? null, token: g?.token ?? null, ip: g?.ip ?? conn?.ip ?? null,
      watch: seat === null, hub: Boolean(conn?.hub) && !g, agent: Boolean(g?.agent), conn: conn ?? g?.conn ?? null,
    };
  }

  /** A token bucket: true (and one token spent) when there is one. */
  takeToken(map, key, rate, now) {
    let b = map.get(key);
    if (!b) { b = { tokens: rate.burst, at: now }; map.set(key, b); }
    b.tokens = Math.min(rate.burst, b.tokens + (now - b.at) / rate.refillMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /**
   * One message from anyone in the room: `{ t: 'say', text }` (typed), `{ t: 'say', say: '<line id>' }` (a quick line)
   * or `{ t: 'react', kind }` (an emoji), with an optional `n` (the sender's own id for it) and `bubble: false` (not
   * over my character). Refused with `held` (or homie.rocks's `slow`) to the sender only; else published to everyone,
   * after the studio's review for typed text when there is one.
   */
  onChat({ client = null, conn = null }, m) {
    const now = this.now();
    const rules = this.chatRules();
    const who = this.chatter(client, conn);
    const n = typeof m.n === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(m.n) ? m.n : null;
    const kind = m.t === 'react' ? 'react' : typeof m.say === 'string' || typeof m.line === 'string' ? 'line' : 'text';
    const stats = this.stats;
    const reply = (why, extra = {}) => {
      stats.chatHeld = stats.chatHeld ?? {};
      stats.chatHeld[why] = (stats.chatHeld[why] ?? 0) + 1;
      const out = JSON.stringify({ t: why === 'slow' ? 'slow' : 'held', why, message: HELD_WORDS[why] ?? HELD_WORDS.unknown, ...(n ? { n } : {}), ...extra });
      if (who.conn) this.sendText(who.conn, out);
      return { ok: false, why };
    };
    if (who.agent) return reply('ai_seat');
    if (!allows(rules, kind)) return reply(rules.mode === 'off' ? 'off' : rules.mode === 'emoji' ? 'emoji' : 'lines');
    if (who.hub && !rules.hub) return reply('hub');
    if (who.watch && !rules.watchers && !who.owner) return reply('watchers');
    const need = kind === 'text' ? rules.who : rules.react;
    if (!who.owner && need === 'signed-in' && !who.acct) return reply(kind === 'text' ? 'sign-in' : 'sign-in-react');
    if (!who.owner && need === 'members' && !who.member) return reply(kind === 'text' ? 'members' : 'members-react');
    const mute = this.muteOf({ token: who.token, browser: who.browser, player: who.player });
    if (mute) return reply('muted', { until: mute.until });
    const b = this.chatBuckets.get(who.key) ?? { lastSayAt: -Infinity, lastText: '', lastTextAt: -Infinity };
    this.chatBuckets.set(who.key, b);
    if (!this.takeToken(this.chatBuckets, `${who.key}|${kind === 'react' ? 'react' : 'say'}`, kind === 'react' ? CHAT_RATES.react : CHAT_RATES.say, now)) return reply('slow');
    if (who.ip && !this.takeToken(this.chatAddress, who.ip, CHAT_RATES.address, now)) return reply('slow');
    if (kind !== 'react' && rules.slow && !who.owner && now - b.lastSayAt < rules.slow * 1000) return reply('slow', { until: b.lastSayAt + rules.slow * 1000, slow: rules.slow });
    let rec;
    if (kind === 'react') {
      const k = String(m.kind ?? m.react ?? '');
      const r = rules.emoji.find((x) => x.k === k);
      if (!r) return reply('unknown');
      // A storm of reactions: the room fans out at most so many a second (the sender's own still floats for them).
      while (this.chatReacts.length && this.chatReacts[0] <= now - 1000) this.chatReacts.shift();
      if (this.chatReacts.length >= CHAT_RATES.roomReactsPerSecond) { stats.chatDrops = (stats.chatDrops ?? 0) + 1; return { ok: true, dropped: true }; }
      this.chatReacts.push(now);
      rec = { kind: 'react', react: r.k, glyph: r.e };
    } else if (kind === 'line') {
      const id = String(m.say ?? m.line ?? '');
      const l = rules.lines.find((x) => x.id === id);
      if (!l) return reply('unknown');
      rec = { kind: 'line', say: l.id, text: l.text };
    } else {
      const text = cleanText(m.text, rules.max);
      if (!text) return reply('empty');
      const f = floor(text, rules);
      if (!f.ok) return reply(f.why);
      if (b.lastText === text.toLowerCase() && now - b.lastTextAt < CHAT_LIMITS.repeatMs) return reply('repeat');
      b.lastText = text.toLowerCase();
      b.lastTextAt = now;
      rec = { kind: 'text', text };
    }
    if (kind !== 'react') b.lastSayAt = now;
    Object.assign(rec, {
      name: who.name, seat: who.seat, colour: who.colour, by: who.hub ? 'hub' : who.watch ? 'watcher' : 'player',
      bubble: m.bubble !== false && rules.bubbles && who.seat !== null, acct: who.acct, owner: who.owner, ...(who.mod ? { mod: true } : {}),
      // Only the office sees these: who sent it, so a mute or a kick from the line reaches them (never an address).
      from: { client: who.client?.id ?? null, token: who.token, browser: who.browser, player: who.player },
    });
    if (kind === 'text' && rules.ai && typeof this.review === 'function' && !who.owner) {
      if (this.chatPending >= CHAT_LIMITS.pending) return reply('busy');
      this.chatPending += 1;
      const t0 = now;
      Promise.resolve()
        .then(() => this.review(rec.text, { room: this.code, links: rules.links }))
        .then((v) => v, (error) => ({ ok: true, by: 'error', error: String(error?.message ?? error).slice(0, 120) }))
        .then((v) => {
          this.chatPending = Math.max(0, this.chatPending - 1);
          if (v && v.ok === false) {
            stats.chatAiHeld = (stats.chatAiHeld ?? 0) + 1;
            // What the review thought it was (insult, hate, sexual, grooming, harm, spam): counts for the office only.
            stats.chatAiWhy = stats.chatAiWhy ?? {};
            const why = String(v.why ?? 'held').slice(0, 24);
            stats.chatAiWhy[why] = (stats.chatAiWhy[why] ?? 0) + 1;
            reply('ai');
            return;
          }
          if (v?.by === 'error') stats.chatAiErrors = (stats.chatAiErrors ?? 0) + 1;
          rec.review = { by: v?.by ?? 'ai', ms: this.now() - t0, ...(Number.isFinite(v?.p) ? { p: v.p } : {}) };
          // A mute that came while it was being reviewed still holds it.
          if (this.muteOf({ token: who.token, browser: who.browser, player: who.player })) { reply('muted'); return; }
          this.publishChat(rec, who.conn, n);
        });
      return { ok: true, pending: true };
    }
    return this.publishChat(rec, who.conn, n);
  }

  /** A message every socket and every watching shell gets now (the sender's own copy carries its `n`). */
  publishChat(rec, senderConn = null, n = null) {
    const now = this.now();
    rec.id = randomId(6);
    rec.at = now;
    this.chatLog.push(rec);
    const keep = windowMsOf(this.chatRules());
    while (this.chatLog.length > CHAT_LIMITS.keep || (this.chatLog.length && now - this.chatLog[0].at > keep)) this.chatLog.shift();
    const msg = this.wireLine(rec);
    const text = JSON.stringify(msg);
    const mine = n ? JSON.stringify({ ...msg, n }) : text;
    const hub = this.chatRules().hub;
    for (const o of this.live()) if (!this.lite(o)) this.sendText(o.conn, o.conn === senderConn ? mine : text);
    for (const w of this.watchers) if (!w.hub || hub) this.sendText(w, w === senderConn ? mine : text);
    if (rec.kind === 'react') this.stats.chatReacts = (this.stats.chatReacts ?? 0) + 1;
    else this.stats.chatLines = (this.stats.chatLines ?? 0) + 1;
    // Kept chat (0.29.0): a room whose rules keep history hands what was said to the Table (never a reaction).
    if (rec.kind !== 'react' && this.chatRules().history > 0 && typeof this.onPublished === 'function') { try { this.onPublished(rec); } catch { /* kept next time */ } }
    return { ok: true, id: rec.id };
  }

  /** Take messages down (the owner's `unsay`): from the window, and from every screen that shows them. */
  unsay(ids) {
    const gone = new Set(ids);
    const before = this.chatLog.length;
    this.chatLog = this.chatLog.filter((r) => !gone.has(r.id));
    const text = JSON.stringify({ t: 'unline', ids: [...gone] });
    for (const o of this.live()) if (!this.lite(o)) this.sendText(o.conn, text);
    for (const w of this.watchers) this.sendText(w, text);
    // Kept chat: what is taken down here is deleted where it was kept, older lines than the window too.
    if (typeof this.onUnsaid === 'function' && gone.size) { try { this.onUnsaid([...gone]); } catch { /* best effort */ } }
    return before - this.chatLog.length;
  }

  /**
   * A person takes their own message down (0.29.0): a watching shell of the browser or the signed-in account that sent
   * it. Kept lines carry only the account, so a guest's own line comes down only while it is in this window.
   */
  /** Whether a line is this socket's own: its account's, or (a guest's) its browser's. */
  ownLine(r, conn) {
    const f = r?.from ?? {};
    if (!conn || r?.kind === 'studio') return false;
    return Boolean((conn.player && f.player && f.player === conn.player) || (conn.browser && f.browser && f.browser === conn.browser && !f.player));
  }

  unsayOwn(conn, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) return { ok: false, error: 'no-line' };
    const r = this.chatLog.find((x) => x.id === id);
    if (!r || r.kind === 'studio') return { ok: false, error: 'no-line' };
    if (!this.ownLine(r, conn)) return { ok: false, error: 'not-yours' };
    this.unsay([id]);
    this.stats.chatOwnRemoved = (this.stats.chatOwnRemoved ?? 0) + 1;
    return { ok: true, removed: 1 };
  }

  /**
   * A mute or a kick for a chat line whose sender holds no socket in this room now (a watcher, a homie.rocks page): held
   * by that browser and account, as a kick holds a player's other tabs.
   */
  holdSender(line, minutes, now, { kick = false, message = '', purge = false } = {}) {
    const f = line.from ?? {};
    if (!f.token && !f.browser && !f.player) return { ok: false, error: 'no-player', message: 'that line has nobody to hold' };
    const until = now + minutes * 60_000;
    const hold = { token: f.token ?? null, browser: f.browser ?? null, player: f.player ?? null, name: line.name, seat: line.seat, until, at: now };
    if (kick) this.bans = [...this.bans, { ...hold, ip: null, pass: null, message }].slice(-CONTROL_LIMITS.bans);
    else this.mutes = [...this.mutes, hold].slice(-CONTROL_LIMITS.mutes);
    this.tellBrowser(hold, kick ? { t: 'kicked', room: this.code, until, message } : { t: 'muted', room: this.code, until });
    const removed = purge ? this.unsay(this.linesOf(f)) : 0;
    this.tellWatchers();
    return { ok: true, op: kick ? 'kick' : 'mute', name: line.name, seat: line.seat, until, sockets: 0, ...(removed ? { removed } : {}) };
  }

  /** The lines of one sender (a line's `from`), for a mute or a kick that also takes their messages down. */
  linesOf(from) {
    if (!from) return [];
    return this.chatLog.filter((r) => (from.client && r.from?.client === from.client) || (from.token && r.from?.token === from.token) || (from.browser && r.from?.browser === from.browser) || (from.player && r.from?.player === from.player)).map((r) => r.id);
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

  onClose(c, why, via = null) {
    if (this.clients.get(c.id) !== c) return;
    this.clients.delete(c.id);
    if (!c.helloed) return;
    const wasHost = c.id === this.hostId;
    const now = this.now();
    if (c.seat !== null) {
      const s = this.seats.get(c.seat);
      if (s && s.token === c.token) { s.present = false; s.since = now; }
    }
    for (const o of this.others(c)) this.send(o, { t: 'leave', id: c.id, seat: c.seat, why });
    // One line per departure, with what the room looked like. A `leave` is a departure (a closed tab, a lost network
    // arriving as the socket's error, a host that was replaced); a `failed` line (guard) is a room operation that threw.
    this.log({ ev: 'leave', room: this.code, id: c.id, seat: c.seat, why, ...(via ? { via } : {}), role: wasHost ? 'host' : c.seat === null ? 'screen' : 'replica', left: this.live().length });
    if (c.id === this.hostId) {
      this.hostId = null;
      this.elect(null, why === 'replaced' ? 'host-replaced' : why === 'silent' ? 'host-stalled' : 'host-left');
    }
    // The server host: the socket closed and the seat is held, so the body is away.
    if (this.server && c.seat !== null) this.toServer({ t: 'leave', id: c.id, seat: c.seat, why });
    if (c.seat !== null && !c.agent) this.lastHumanAt = now;
    // An agent never keeps a room from forgetting (DESIGN D9): the room is empty when no person is left.
    if (!this.live().some((o) => !o.agent) && !this.emptySince) this.emptySince = now;
    this.seatWaiting();
    if (c.seat !== null) this.refreshWatchers();
    this.tellWatchers();
  }

  fasterRulesHost(candidate, current) {
    return !candidate.hidden && this.now() - (candidate.readyAt ?? -Infinity) <= 5000 &&
      Math.min(candidate.rulesSpeed ?? 1, candidate.readySpeed ?? 0) > (current?.rulesSpeed ?? 0) * 1.5 + 0.1;
  }

  /**
   * Choose a host. Visible and responsive first; then tenure in 30 s steps (a newcomer cannot jump the queue by
   * calling itself a desktop); then desk > tv > phone as a tie-break; then whoever came first. The chosen browser
   * is handed the last checkpoint, the last snapshot (newer), the round, the roster and the keyed state.
   */
  elect(excludeId, why) {
    // The server is never elected away.
    if (this.server || this.hostFailed) return null;
    const now = this.now();
    const silent = (c) => Number(now - c.lastSeen > this.silentMs);
    const tenure = (c) => Math.floor((now - c.joinedAt) / 30_000);
    const cands = this.live()
      .filter((c) => c.canHost && c.id !== excludeId && (why !== 'host-slow' || this.fasterRulesHost(c, this.clients.get(excludeId))))
      .sort((a, b) => Number(a.hidden) - Number(b.hidden)
        || silent(a) - silent(b)
        // An agent hosts only when no person can (DESIGN D10); a watcher is next to last: any player comes first.
        || Number(Boolean(a.agent)) - Number(Boolean(b.agent))
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
    this.hosted = new Map([...this.seats].map(([seat, s]) => [seat, s.occ ?? null]));
    this.hostId = next.id;
    this.hostSince = now;
    this.preferHost = null;
    this.seatsDirty = true;
    // What the room's game reads (the dial, agent bodies) is what its new host's build says.
    this.caps = new Set(next.caps);
    next.lastSnapAt = 0;
    this.stats.promotions += 1;
    this.stats.elections.push({ at: now, id: next.id, seat: next.seat, why });
    if (this.stats.elections.length > 32) this.stats.elections.shift();
    this.send(next, {
      t: 'role', role: 'host', why, host: this.hostRef(), peers: this.peers(), ...(this.rules ? { held: this.heldPeers() } : {}),
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
      // A loopback (the Table's own house agent) cannot be half-open: it is never closed for silence.
      if (now - c.lastSeen > this.idleMs && !c.conn.loopback) this.kick(c, 'silent', 4000);
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
    if (!this.server && !this.host() && (!this.preferHost || now >= this.preferHost.until)) {
      this.preferHost = null;
      if (this.live().some((c) => c.canHost)) this.elect(null, 'host-left');
    }
    if (this.regate && now >= this.regate.until) this.applyRegate(now);
    if (this.agentsOut && now >= this.agentsOut.until) this.applyAgentsOut(now);
    if (this.vote && this.vote.open && now >= this.vote.until) this.closeVote('time');
    // An AI never keeps a room alive (DESIGN D9): with no person seated for agentsAloneMs, every agent is closed.
    if (this.seatedHumans().length) this.lastHumanAt = now;
    else if (now - this.lastHumanAt >= this.agentsAloneMs) {
      for (const c of this.live().filter((o) => o.agent)) {
        this.error(c, 'agents-alone', 'nobody is playing in this room; an AI comes back when a person is seated');
        this.kick(c, 'agents-alone', 4001);
      }
    }
    this.reapSeats(now);
    this.syncServerSeats();
    this.seatWaiting();
    // The chat window is minutes long; buckets of senders who went quiet are dropped.
    const keepMs = windowMsOf(this.chatRules());
    while (this.chatLog.length && now - this.chatLog[0].at > keepMs) this.chatLog.shift();
    if (this.chatBuckets.size > 512) this.chatBuckets.clear();
    if (this.chatAddress.size > 512) this.chatAddress.clear();
    if (!this.live().some((c) => !c.agent) && this.emptySince && now - this.emptySince > this.forgetMs) this.forget();
    this.persist(now);
  }

  /** An EMPTY room forgets everything (after `forgetMs`, or when the Table's alarm ends a server-hosted room nobody came back to). */
  forget() {
    this.hostId = null;
    for (const c of this.live()) this.kick(c, 'agents-alone', 4001);
    this.lastSnap = null; this.lastSnapText = null; this.lastCkpt = null; this.lastRound = null; this.lastRoster = null;
    this.state.clear(); this.stateBytes = 0; this.seats.clear(); this.preferHost = null;
    this.emptySince = 0; this.openedAt = 0; this.askedMax = null;
    // The room is nobody's build again (section 23): the next visitor's is its build.
    this.gameVer = undefined;
    // The party's dial and vote are the room's: a new party starts from the server's level.
    this.level = null; this.levelBy = null; this.vote = null; this.agentsOut = null;
    // Room chat (section 19): an empty room forgets what was said, as it forgets everything else.
    this.chatLog = []; this.chatBuckets.clear(); this.chatAddress.clear(); this.chatReacts = [];
    // A room that keeps history reads it back when somebody comes again (it is in D1, not here).
    this.hydrated = false;
    this.seatsDirty = false; this.persistDirty = false;
    try { this.store?.clear?.(); } catch { /* best effort */ }
    this.hosted.clear();
    try { this.onForget?.(); } catch { /* the room is forgotten either way */ }
  }

  /* ------------------------------------------------------------ servers, agents and the dial (section 17) */

  /**
   * The Worker's policy for this room (the server's, composed with the game and the office). A newer stamp replaces
   * an older one; `force` is the owner's `policy` control. A policy that no longer lets AI in sends the agents out
   * after the round, as a launch change does ("This server is humans-only now.").
   */
  setPolicy(pol, { force = false } = {}) {
    const p = normalizePolicy(pol);
    if (!p) return { ok: false, error: 'policy', message: 'not a policy' };
    const before = this.policy;
    const newer = p.at > before.at || (p.at === before.at && policySig(p) !== policySig(before));
    if (!force && !newer) return { ok: true, same: true };
    if (policySig(p) === policySig(before)) { this.policy = p; return { ok: true, same: true }; }
    this.policy = p;
    if (this.level !== null) this.level = Math.min(this.level, p.levelMax);
    const now = this.now();
    const agents = this.live().filter((c) => c.agent).length;
    if (!this.agentsAllowed() && agents) {
      const r = this.lastRound;
      const playing = Boolean(r && r.phase === 'live' && Number(r.endsAt) > now);
      const until = Math.min(now + 15 * 60_000, playing ? Number(r.endsAt) + 20_000 : now + 30_000);
      this.agentsOut = { roundN: playing ? Number(r.n) : null, until, at: now, message: 'This server is humans-only now.' };
    } else if (this.agentsAllowed()) this.agentsOut = null;
    if (Array.isArray(this.lastRoster)) this.lastRoster = this.labelRoster(this.lastRoster);
    this.seatsDirty = true;
    this.officeDirty = true;
    this.tellPolicy();
    this.tellWatchers();
    return { ok: true, policy: this.policyOut(), leaving: this.agentsOut ? agents : 0, ...(this.agentsOut ? { until: this.agentsOut.until } : {}) };
  }

  /** The agents leave (a policy that no longer lets AI in, after the round): each told why, its seat freed. */
  applyAgentsOut(now = this.now()) {
    const g = this.agentsOut;
    if (!g) return 0;
    this.agentsOut = null;
    this.officeDirty = true;
    const out = this.agentsAllowed() ? [] : this.live().filter((c) => c.agent);
    for (const c of out) {
      const seat = c.seat;
      const token = c.token;
      this.error(c, 'agents-off', g.message);
      this.onClose(c, 'agents-off');
      const s = seat === null ? null : this.seats.get(seat);
      if (s && s.token === token) { this.seats.delete(seat); this.seatsDirty = true; }
      try { c.conn.close(1008, 'agents-off'); } catch { /* gone */ }
    }
    this.persist(now);
    this.tellWatchers();
    return out.length;
  }

  /** The seat a slot names (its own, or the one its agent sits in), and what holds it. */
  holderOf(seat) {
    if (!Number.isInteger(seat)) return { kind: 'none' };
    const c = this.live().find((o) => o.seat === seat);
    const s = this.seats.get(seat);
    if (c && c.agent) return { kind: 'agent', agent: c.agent, name: c.name };
    if (c) return { kind: 'human', name: c.name };
    if (s && s.agent) return { kind: 'agent', agent: s.agent, name: s.name };
    if (s) return { kind: 'human', name: s.name };
    return { kind: 'none' };
  }

  /**
   * The host's roster as everyone sees it (section 17): a slot whose seat an agent holds is named and marked AI; a
   * slot with no seat is a bot; a slot naming a seat nobody holds is a bot; a person is never marked AI and never
   * named with an AI mark. A host's game cannot present an AI as a person.
   */
  labelRoster(slots) {
    return slots.map((raw) => this.labelOne(raw, false)).filter(Boolean);
  }

  /** A round's results, labelled the same way (`agent: true` on every AI's row). */
  labelResults(rows) {
    return rows.slice(0, 64).map((raw) => this.labelOne(raw, true)).filter(Boolean);
  }

  labelOne(raw, result) {
    if (!raw || typeof raw !== 'object') return null;
    if (this.rules) {
      if (!Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot >= this.seatCap) return null;
      raw = { ...raw, seat: raw.slot };
      const holder = this.holderOf(raw.slot);
      if (holder.kind !== 'human' && holder.kind !== 'agent') {
        if (raw.slot >= this.maxPlayers - this.reserve())
          raw.agent = { seat: null, role: raw.slot >= this.maxPlayers - this.policy.guides ? 'guide' : 'party', hands: 'host' };
        else delete raw.agent;
      }
    }
    const out = { ...raw };
    const seat = Number.isInteger(raw.seat) ? raw.seat : null;
    const agentSeat = !result && raw.agent && Number.isInteger(raw.agent.seat) ? raw.agent.seat : null;
    const who = this.holderOf(seat ?? agentSeat);
    const role = (a) => (['party', 'guide', 'player'].includes(a?.role) ? a.role : 'party');
    if (who.kind === 'agent') {
      out.name = who.name || aiName(raw.name);
      if (result) out.agent = true;
      else out.agent = { seat: seat ?? agentSeat, role: role(who.agent), hands: who.agent.hands === 'host' ? 'host' : 'self' };
      if (who.agent.hands === 'host') out.bot = true;
      this.stats.labelled += 1;
    } else if (seat !== null && who.kind === 'human') {
      delete out.agent;
      out.bot = false;
      out.name = this.rules ? who.name : stripAi(raw.name) || who.name;
    } else {
      // No seat, or a seat nobody holds: a body the host's own bot code moves.
      if (seat !== null) this.stats.labelled += 1;
      out.bot = true;
      if (raw.agent) {
        // A seat kept for AI with nobody in it yet (a brainless AI seat), marked so.
        out.agent = result ? true : { seat: null, role: role(raw.agent), hands: 'host' };
        out.name = aiName(raw.name);
      } else delete out.agent;
    }
    if (out.bot && out.seat !== null && who.kind !== 'agent') out.seat = null;
    out.name = String(out.name ?? '').slice(0, 40);
    return out;
  }

  /** The vote as everyone sees it: the options, how many chose each, who voted (a count), the result once closed. */
  voteView() {
    const v = this.vote;
    if (!v) return null;
    const counts = {};
    for (const n of v.options) counts[n] = 0;
    for (const n of v.votes.values()) counts[n] = (counts[n] ?? 0) + 1;
    return {
      of: 'skill', id: v.id, open: v.open, until: v.until, options: v.options, counts, voters: v.votes.size,
      of_total: this.seatedHumans().length, ...(v.result ? { result: v.result } : {}), ...(v.reason ? { reason: v.reason } : {}),
    };
  }

  tellVote() {
    this.broadcast({ t: 'vote', ...this.voteView() });
    const text = JSON.stringify({ t: 'vote', ...this.voteView() });
    for (const w of this.watchers) this.sendText(w, text);
    this.tellWatchers();
  }

  /** Open a vote on the dial: the options are 1 to the server's ceiling. A player opens one at most every 2 minutes. */
  openVote({ reason = null, auto = false, by = 'player' } = {}) {
    const now = this.now();
    if (this.vote && this.vote.open) return this.vote;
    if (!auto && by !== 'owner' && now - this.lastVoteOpen < this.voteCooldownMs) return null;
    const options = [];
    for (let n = 1; n <= this.policy.levelMax; n += 1) options.push(n);
    this.vote = { id: randomId(6), open: true, at: now, until: now + this.voteMs, options, votes: new Map(), reason: reason ? oneLine(reason, 40) : null, result: null };
    this.lastVoteOpen = now;
    if (auto) this.lastAutoVote = now;
    this.stats.votes += 1;
    this.tellVote();
    return this.vote;
  }

  /** A party's first live round with AI seats (and a game that reads the dial): the vote opens by itself. */
  autoVote() {
    const now = this.now();
    if (!this.caps.has('skill') || (this.vote && this.vote.open) || now - this.lastAutoVote < this.autoVoteMs) return;
    const aiSeats = this.reserve() > 0 || this.live().some((c) => c.agent);
    if (!aiSeats || !this.seatedHumans().length) return;
    this.openVote({ auto: true, reason: 'start' });
  }

  /**
   * A `vote` from a seated person (their game, or their play page's card through the watch socket) or the host:
   * `open` starts one, `n` casts (or changes) this seat's vote. Agents and watchers never vote.
   */
  onVote(c, m, reply = null) {
    const no = (message) => { const e = { t: 'error', code: 'vote', message }; if (reply) this.sendText(reply, JSON.stringify(e)); else this.send(c, e); };
    if (m.of !== undefined && m.of !== 'skill') return no('only the skill dial is voted on');
    const seated = c.seat !== null && !c.agent && !c.watch;
    if (!seated && c.id !== this.hostId) return no('only a seated player votes');
    const n = Math.floor(Number(m.n));
    const casting = Number.isFinite(n) && seated;
    if (!(this.vote && this.vote.open)) {
      if (!m.open && !casting) return no('no vote is open');
      if (!this.openVote({ reason: typeof m.reason === 'string' ? m.reason : null })) return no('a vote was held a moment ago; try again in a minute or two');
    }
    if (!casting) return;
    const v = this.vote;
    if (!v.options.includes(n)) return no(`vote 1 to ${this.policy.levelMax}`);
    v.votes.set(c.seat, n);
    // Everyone seated has voted (a lone player's tap decides at once).
    const voters = this.seatedHumans().map((o) => o.seat);
    if (voters.every((s) => v.votes.has(s))) this.closeVote('all');
    else this.tellVote();
  }

  /** The middle vote wins, rounded down (DESIGN D8), capped by the server's ceiling, and applies at once. */
  closeVote(why = 'time') {
    const v = this.vote;
    if (!v || !v.open) return null;
    v.open = false;
    const here = new Set(this.seatedHumans().map((o) => o.seat));
    const counted = [...v.votes].filter(([seat]) => here.has(seat)).map(([, n]) => n);
    const m = medianVote(counted);
    if (m !== null) {
      this.level = Math.max(1, Math.min(this.policy.levelMax, m));
      this.levelBy = 'vote';
      const s = skillPreset(this.level, { kids: this.policy.kids });
      v.result = { level: this.level, name: s.name, votes: counted.length, why };
      // Saved on the next tick, not within 30 s: a deploy right after the vote keeps the party's choice.
      this.seatsDirty = true;
      this.tellPolicy();
    } else v.result = { level: this.levelNow(), name: skillPreset(this.levelNow()).name, votes: 0, why };
    this.tellVote();
    return v.result;
  }

  /* ------------------------------------------------------------ storage (optional) */

  /** Seats, the policy and the party's dial on change; checkpoint/round/roster/state at most every persistMs. Never per frame. */
  persist(now = this.now(), force = false) {
    if (!this.store) return;
    const due = this.seatsDirty || (!this.server && this.persistDirty && now - this.lastPersistAt >= this.persistMs);
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
      seats: [...this.seats].map(([seat, s]) => [seat, s.token, s.name, s.agent ?? null, s.occ ?? null, ...(this.server ? [s.present ? null : s.since] : [])]),
      occSeq: this.occSeq, ...(this.gameVer !== undefined ? { gameVer: this.gameVer } : {}),
      ckpt: this.lastCkpt, round: this.lastRound, roster: this.lastRoster, state: this.stateObject(),
      // Section 17: a deploy keeps the room's policy, the party's dial and what its game reads.
      policy: this.policy, level: this.level, levelBy: this.levelBy, caps: [...this.caps],
      // The Table saves this seat map and the server's whole world in one transaction.
      ...(this.server ? { hosted: 'server' } : {}),
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
    if (!this.server && !this.rules && saved.hosted !== 'server' && Number.isInteger(saved.maxPlayers)) this.maxPlayers = Math.max(1, Math.min(this.seatCap, saved.maxPlayers));
    if (Number.isFinite(saved.openedAt) && saved.openedAt > 0) this.openedAt = saved.openedAt;
    for (const [seat, token, name, agent, occ, since] of saved.seats ?? []) this.seats.set(seat, { token, name, since: saved.durable && Number.isFinite(since) ? since : now, present: false, agent: agent && typeof agent === 'object' ? agent : null, ...(Number.isInteger(occ) ? { occ } : {}) });
    // A stay's number is never given twice while a checkpoint may still name it.
    this.occSeq = Math.max(this.occSeq, Number.isInteger(saved.occSeq) ? saved.occSeq : 0, ...[...this.seats.values()].map((x) => x.occ ?? 0));
    if ('gameVer' in saved) this.gameVer = versionOf(saved.gameVer);
    const pol = normalizePolicy(saved.policy);
    if (pol) this.policy = pol;
    if (Number.isInteger(saved.level)) { this.level = Math.max(1, Math.min(this.policy.levelMax, saved.level)); this.levelBy = saved.levelBy === 'owner' ? 'owner' : 'vote'; }
    if (Array.isArray(saved.caps)) this.caps = new Set(saved.caps.filter((k) => CAPS.includes(k)));
    // The people coming back get the agents' grace too (an AI is not "alone" in a room a deploy just emptied).
    if ((saved.seats ?? []).some((s) => !s[3])) this.lastHumanAt = now;
    // A server-hosted room has no browser host to hand a checkpoint to, and what its last match showed is not this one's.
    const fresh = saved.hosted === 'server' && !saved.durable;
    if (!fresh) for (const [seat, s] of this.seats) this.hosted.set(seat, s.occ ?? null);
    this.lastCkpt = fresh ? null : saved.ckpt ?? null;
    this.lastRound = fresh ? null : saved.round ?? null;
    this.lastRoster = fresh ? null : saved.roster ?? null;
    for (const [k, d] of Object.entries(fresh ? {} : saved.state ?? {})) {
      const text = JSON.stringify({ t: 'state', k, d });
      const bytes = this.rules ? byteLength(text) : text.length;
      this.state.set(k, { d, bytes });
      this.stateBytes += bytes;
    }
    if (Number.isInteger(saved.hostSeat) && saved.hosted !== 'server') this.preferHost = { seat: saved.hostSeat, until: now + graceMs };
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
    const pass = c.agent?.pass ?? c.agentWord?.pass ?? null;
    return this.bans.find((b) => b.until > now && ((b.token && b.token === token) || (b.browser && b.browser === c.browser) || (b.player && b.player === c.player) || (b.ip && b.ip === c.ip) || (b.pass && b.pass === pass))) ?? null;
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
        // From a chat line (section 19): its sender, in this room now or not (a watcher with no seat is held too). A line
        // older than the window comes from the room's kept history (the Worker read it: its sender's account only).
        const line = typeof a.line === 'string' ? this.chatLog.find((r) => r.id === a.line) ?? keptRef(a) : null;
        const target = this.findClient(a) ?? (line?.from?.client ? this.clients.get(line.from.client) ?? null : null);
        if (!target && line) return this.holdSender(line, minutes, now, { kick: true, message: oneLine(a.message, CONTROL_LIMITS.message) || 'The studio removed you from this room.', purge: a.purge === true });
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const purged = a.purge === true ? this.unsay(this.linesOf({ client: target.id, token: target.token, browser: target.browser, player: target.player })) : 0;
        const until = now + minutes * 60_000;
        // The message is the studio's words; `until` says when (the shell says it in the player's own time).
        const message = oneLine(a.message, CONTROL_LIMITS.message) || 'The studio removed you from this room.';
        // An AI is held out by its pass (its seat becomes a brainless AI seat again); a person by token, browser, account.
        const ban = { token: target.token, browser: target.browser, player: target.player, ip: a.address ? target.ip : null, pass: target.agent?.pass ?? null, name: line?.name ?? target.name, seat: target.seat, until, at: now, message };
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
        return { ok: true, op, name: ban.name, seat: ban.seat, sockets: out.length, until, ...(purged ? { removed: purged } : {}) };
      }
      case 'mute': {
        const line = typeof a.line === 'string' ? this.chatLog.find((r) => r.id === a.line) ?? keptRef(a) : null;
        const target = this.findClient(a) ?? (line?.from?.client ? this.clients.get(line.from.client) ?? null : null);
        if (!target && line && a.off !== true) return this.holdSender(line, minutes, now, { kick: false, purge: a.purge === true });
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const off = a.off === true;
        const purged = !off && a.purge === true ? this.unsay(this.linesOf({ client: target.id, token: target.token, browser: target.browser, player: target.player })) : 0;
        const same = (m) => (m.token && m.token === target.token) || (m.browser && m.browser === target.browser) || (m.player && m.player === target.player);
        this.mutes = this.mutes.filter((m) => !same(m));
        const until = off ? 0 : now + minutes * 60_000;
        if (!off) this.mutes = [...this.mutes, { token: target.token, browser: target.browser, player: target.player, name: line?.name ?? target.name, seat: target.seat, until, at: now }].slice(-CONTROL_LIMITS.mutes);
        const note = { t: 'mute', id: target.id, seat: target.seat, until };
        for (const o of this.live()) this.send(o, note);
        this.tellBrowser(target, { t: 'muted', room: this.code, until });
        this.tellWatchers();
        return { ok: true, op, name: line?.name ?? target.name, seat: target.seat, until, ...(purged ? { removed: purged } : {}) };
      }
      case 'card': {
        // Show what you made (0.29.0): a link card to a studio's game, which the Worker read from that studio's own
        // manifest and checked (its words passed the floor and the review there). Its sender's name and account are the
        // Worker's word; a mute holds a card as it holds a line.
        const c = a.card && typeof a.card === 'object' ? a.card : null;
        if (!c || typeof c.url !== 'string' || !/^https?:\/\//.test(c.url)) return { ok: false, error: 'card', message: 'no card' };
        const who = { token: null, browser: typeof a.browser === 'string' ? a.browser : null, player: typeof a.player === 'string' ? a.player : null, ip: null };
        if (a.owner !== true && this.banOf(who, null)) return { ok: false, error: 'kicked', message: 'The studio has held you out of this room for now.' };
        if (a.owner !== true && this.muteOf(who)) return { ok: false, error: 'muted', message: HELD_WORDS.muted };
        const card = { url: c.url.slice(0, 300), title: oneLine(c.title, 80), studio: oneLine(c.studio, 60), pitch: oneLine(c.pitch, 160), image: typeof c.image === 'string' && /^https:\/\//.test(c.image) ? c.image.slice(0, 400) : null, ...(typeof c.game === 'string' ? { game: c.game.slice(0, 40) } : {}) };
        const note = oneLine(a.note, CHAT_LIMITS.text);
        const rules = this.chatRules();
        if (rules.mode !== 'text' && a.owner !== true) return { ok: false, error: 'held', why: rules.mode === 'off' ? 'off' : 'lines', message: 'The Lounge isn\'t taking cards right now.' };
        // The card's words (the person's note, the game's own title and pitch) pass the floor like any typed line.
        const words = [note, card.title, card.pitch].filter(Boolean).join(' · ');
        const f = floor(words, { ...rules, links: 'block' });
        if (!f.ok && a.owner !== true) return { ok: false, error: 'held', why: f.why, message: HELD_WORDS[f.why] ?? HELD_WORDS.unknown };
        const rec = {
          kind: 'card', card, text: note || `Made: ${card.title}${card.studio ? ` by ${card.studio}` : ''}`,
          name: oneLine(a.name, CHAT_LIMITS.name) || 'Someone', seat: null, colour: null, by: 'watcher', bubble: false,
          acct: a.acct === true, owner: a.owner === true, ...(a.mod === true ? { mod: true } : {}),
          from: { client: null, token: null, browser: who.browser, player: who.player },
        };
        // And the studio's review, as a typed line gets it (the owner's own card is never reviewed).
        if (rules.ai && typeof this.review === 'function' && a.owner !== true) {
          return Promise.resolve()
            .then(() => this.review(words, { room: this.code, links: 'block' }))
            .then((v) => v, () => ({ ok: true, by: 'error' }))
            .then((v) => {
              if (v && v.ok === false) { this.stats.chatAiHeld = (this.stats.chatAiHeld ?? 0) + 1; return { ok: false, error: 'held', why: 'ai', message: HELD_WORDS.ai }; }
              rec.review = { by: v?.by ?? 'ai' };
              if (this.muteOf(who)) return { ok: false, error: 'muted', message: HELD_WORDS.muted };
              return { ...this.publishChat(rec), op };
            });
        }
        return { ...this.publishChat(rec), op };
      }
      case 'unsay': {
        // Room chat (section 19): the owner takes a message down (or every message: `all`), on every screen at once.
        const ids = a.all === true ? this.chatLog.map((r) => r.id) : (Array.isArray(a.ids) ? a.ids : [a.id]).filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(x)).slice(0, 64);
        if (!ids.length) return { ok: false, error: 'no-line', message: 'which message?' };
        const removed = this.unsay(ids);
        this.stats.chatRemoved = (this.stats.chatRemoved ?? 0) + removed;
        return { ok: true, op, removed };
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
        // The room's chat shows it too, as the studio's own line (section 19).
        this.publishChat({ kind: 'studio', text, name: 'Studio', seat: null, colour: null, by: 'studio', bubble: false, acct: false, owner: true, from: null });
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
        this.hosted.clear();
        try { this.onForget?.(); } catch { /* the room is closed either way */ }
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
      case 'policy': {
        // The owner changed the server (section 17): its new policy now, and AI out after the round if it is humans-only.
        const r = this.setPolicy(a.pol, { force: true });
        return r.ok ? { ...r, op } : { ...r, op };
      }
      case 'level': {
        // The owner sets this room's dial (room_level): it applies at once, as a vote's result does.
        const n = Math.floor(Number(a.level));
        if (!(n >= 1 && n <= 5)) return { ok: false, error: 'level', message: 'level is 1 to 5' };
        this.level = Math.min(this.policy.levelMax, n);
        this.levelBy = 'owner';
        this.seatsDirty = true;
        this.tellPolicy();
        this.tellWatchers();
        return { ok: true, op, level: this.level, name: skillPreset(this.level, { kids: this.policy.kids }).name };
      }
      default:
        return { ok: false, error: 'op', message: `no control called ${String(op).slice(0, 24)}` };
    }
  }

  /** Whether a client may stay once the room re-gates: one of its ticket's holders (o, i-…, p-…) is of an allowed kind. */
  allowedAfter(c, allow) {
    // The owner's own agent passes count as the owner's (only the owner can mint one).
    return String(c.via ?? '').split('~').some((part) => (part === 'o' && allow.includes('o')) || (part.startsWith('i-') && allow.includes('i')) || (part.startsWith('p-') && allow.includes('p'))
      || (part.startsWith('a-') && allow.includes('o') && c.agent?.by === 'studio'));
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
  /** The game's own stall time (game.json `netplay.stallMs`), held to STALL's bounds; anything else: the default. */
  setStall(ms) {
    this.stallMs = stallOf(ms) ?? STALL.ms;
    return this.stallMs;
  }

  /** The build that is live now (the Worker's word, from the catalogue): a string, or null when the game names none. */
  setCurrent(ver) {
    this.currentVer = ver === undefined ? undefined : versionOf(ver);
  }

  /**
   * The room changes build (section 23): everything the old build's rules wrote is dropped, so the new build's first
   * host starts a fresh round. Seats keep their tokens and names (a player who reloads comes back to their seat).
   */
  forgetWorld(next) {
    this.log({ ev: 'build-changed', room: this.code, from: this.gameVer ?? null, to: next ?? null });
    this.lastSnap = null; this.lastSnapText = null; this.lastCkpt = null; this.lastRound = null; this.lastRoster = null;
    this.state.clear(); this.stateBytes = 0; this.preferHost = null;
    this.persistDirty = true;
  }

  setSeats(n, perIp = null) {
    this.seatCap = Math.max(1, Math.floor(n));
    this.maxPlayers = Math.max(1, Math.min(this.seatCap, (this.server || this.rules) ? this.seatCap : this.askedMax ?? this.seatCap));
    if (Number.isFinite(perIp) && perIp > 0) this.perIp = perIp;
  }

  /** The owner's holds, the banner and a closed door: kept apart from the room's play (they outlive an empty room). */
  officeSaved() {
    const now = this.now();
    return {
      bans: this.bans.filter((b) => b.until > now), mutes: this.mutes.filter((m) => m.until > now),
      announcement: this.liveAnnouncement(), closedUntil: this.closedUntil > now ? this.closedUntil : 0, closedWhy: this.closedWhy,
      regate: this.regate, agentsOut: this.agentsOut,
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
    this.agentsOut = o.agentsOut && Number(o.agentsOut.until) > now - 120_000 ? o.agentsOut : null;
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
        agentsOut: this.agentsOut ? { until: this.agentsOut.until, afterRound: this.agentsOut.roundN } : null,
        clients: f.clients.map((p) => {
          const c = byId.get(p.id);
          const mute = c ? this.muteOf(c) : null;
          return { ...p, joinedAt: c?.joinedAt ?? null, lastSeen: c?.lastSeen ?? null, browser: browserTag(c?.browser), player: c?.player ?? null, via: c?.via ?? null, mutedUntil: mute ? mute.until : null };
        }),
        bans: this.bans.filter((b) => b.until > now).map((b) => ({ name: b.name, seat: b.seat, until: b.until, at: b.at, address: Boolean(b.ip), browser: browserTag(b.browser) })),
        mutes: this.mutes.filter((m) => m.until > now).map((m) => ({ name: m.name, seat: m.seat, until: m.until })),
        // Room chat (section 19): the window as the owner sees it, with who sent each line (never an address).
        chat: {
          rules: this.chatRules(),
          pending: this.chatPending,
          lines: this.recentChat(now).map((r) => ({ ...this.wireLine(r), kind: r.kind, client: r.from?.client ?? null, player: r.from?.player ?? null, browser: browserTag(r.from?.browser), ...(r.review ? { review: r.review } : {}) })),
          history: this.chatRules().history ?? 0,
        },
        // A game's own decisions (section 20): how many, who answered, the model's time and neurons (never a state).
        ...(this.stats.decides ? { decides: { n: this.stats.decides, by: { ...this.stats.decided }, msP50: [...this.stats.decideMs].sort((x, y) => x - y)[Math.floor(this.stats.decideMs.length / 2)] ?? null, neurons: Math.round((this.stats.decideNeurons ?? 0) * 100) / 100 } } : {}),
      },
    };
  }

  /* ------------------------------------------------------------ the shell's view */

  facts() {
    const now = this.now();
    while (this.snapTimes.length && this.snapTimes[0] < now - 1000) this.snapTimes.shift();
    const slots = Array.isArray(this.lastRoster) ? this.lastRoster : [];
    const live = this.live();
    const agents = live.filter((c) => c.agent && c.seat !== null).length;
    return {
      t: 'net', v: NET_VERSION, rev: NET_REVISION, room: this.code, st: now,
      host: this.hostRef(),
      openedAt: this.openedAt || null,
      announce: this.liveAnnouncement(),
      ...(this.closedUntil > now ? { closedUntil: this.closedUntil } : {}),
      clients: live.map((c) => ({ ...this.peer(c), hidden: c.hidden, waiting: c.waiting })),
      round: this.lastRound,
      roster: this.lastRoster,
      snapHz: this.snapTimes.length,
      counts: {
        // Players are people (section 17): an agent is never counted as one, by the Lobby or anybody else.
        players: live.filter((c) => c.seat !== null && !c.agent).length,
        agents,
        screens: live.filter((c) => c.seat === null).length,
        waiting: live.filter((c) => c.waiting).length,
        watchers: live.filter((c) => c.watch).length,
        // Watching shells (pages with no game socket: the watch page, homie.rocks, the Lounge), 0.29.0.
        shells: this.watchers.size,
        humans: slots.filter((s) => s && !s.bot && !s.agent).length,
        bots: slots.filter((s) => s && s.bot && !s.agent).length,
        // Every AI body: a slot marked AI (an agent, or a seat kept for one), else the agents seated.
        ai: Math.max(agents, slots.filter((s) => s && s.agent).length),
        maxPlayers: this.maxPlayers,
        humanSeats: this.humanCap(),
      },
      policy: this.policyOut(),
      ...(this.vote ? { vote: this.voteView() } : {}),
      caps: [...this.caps],
      // Revision 9: the build this room runs (null: the game names none, or nobody is here) and its stall time.
      ver: this.gameVer ?? null, stallMs: this.stallMs,
      // Revision 10: the rules run on the server, and how its clock is keeping (ticks run, late ticks, the budget).
      ...(this.server ? { hosted: 'server', ticks: this.server.facts?.() ?? null } : this.hostFailed ? { hosted: 'server', hostFailed: this.hostFailed } : {}),
      // Revision 7: whether this room's game has a vocabulary its AI may speak (agents.json).
      vocab: Boolean(this.vocab),
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
