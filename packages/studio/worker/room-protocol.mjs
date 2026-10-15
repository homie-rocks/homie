

/** Shared wire constants and validation; importing these never loads the relay engine. */

export { LIMITS, GROWS, capOf } from './limits.mjs';


import { CHAT_LIMITS, normalizeChat } from './chat.mjs';

export const NET_VERSION = 1;
/** The contract revision this relay speaks (NETPLAY.md): optional fields, frames and refusals; the wire stays `v: 1`. */
export const NET_REVISION = 12;
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
// A message's size in bytes. Text that is all ASCII (nearly every frame a game sends) is as long as it is wide: it is
// not encoded to be measured, which at ten inputs a second from a thousand players was a twentieth of a room's second.
const ASCII = /^[\x00-\x7f]*$/;
const byteLength = text => ASCII.test(text) ? text.length : utf8.encode(text).length;
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


export {VERSION_TEXT,FEATURE_TEXT,DEPARTURE,POLICY_KINDS,CAPS,SAY,d0,ASK,policySig,utf8,ASCII,byteLength,PALETTE_SIZE,DEVICE_RANK,oneLine,randomId,clampPresses,keptRef};
