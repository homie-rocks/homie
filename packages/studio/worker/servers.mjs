/**
 * SERVERS (@homie-rocks/studio 0.16.0; NETPLAY.md section 17): a named, lasting pool of rooms for one game, with its
 * own policy, its own door and its own Lobby pool. Strangers are matched only inside one server, never across.
 *
 *   public        every game's implicit server: its `pub-N` rooms, so every old link and room keeps working. With no
 *                 D1 row it is open, bots fill, Fair, anyone may come in.
 *   s-<id>-<n>    a server's rooms. A server id is 2 to 20 lowercase letters, digits and hyphens, unique in its game.
 *
 * POLICIES: `open` (anyone; an AI with a pass may sit, always marked AI), `humans-only` (no AI of any kind; the game's
 * own bots are off unless the owner turns on practice bots), `hybrid` (N seats in every room are AI companions),
 * `beginner` (new players only, AI guides, quick lines only, optionally `kids`).
 *
 * DOORS: `open`, `accounts` (a passkey account), `invite` (an invite to this server), and the beginner check (an
 * account younger than `beginner_days`, below `beginner_level`; a mentor gets in). The door decides who comes in;
 * membership (server_members) is who belongs: a home server per game, and a member badge. Nobody is a member by
 * being let in: a signed-in player who plays here becomes one (one write per server per 10 minutes).
 *
 * Everything is in the studio's own D1 (migration 0006); homie.rocks stores none of it. A game.json `"servers"` list
 * seeds servers the way `"launch"` seeds a launch state: a D1 row with the same id wins.
 */
import { SKILLS } from './agents.mjs';

export const SERVERS_MIGRATION_FILE = '0006_studio_servers.sql';
export const SERVERS_MIGRATION = `-- Servers and agent seats (@homie-rocks/studio 0.16.0): named, lasting room pools per game, their policies,
-- who belongs to them, and the passes that let an AI sit in a seat. Nothing here is about a person beyond a
-- player id the studio already has; no address, no age.
CREATE TABLE IF NOT EXISTS servers (
  game TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  blurb TEXT,
  policy TEXT NOT NULL,
  ai_seats INTEGER NOT NULL DEFAULT 0,
  guides INTEGER NOT NULL DEFAULT 0,
  bots TEXT NOT NULL DEFAULT 'fill',
  level INTEGER NOT NULL DEFAULT 3,
  level_max INTEGER NOT NULL DEFAULT 5,
  speech TEXT NOT NULL DEFAULT 'game',
  door TEXT NOT NULL DEFAULT 'open',
  kids INTEGER NOT NULL DEFAULT 0,
  beginner_days INTEGER,
  beginner_level INTEGER,
  rooms_max INTEGER NOT NULL DEFAULT 4,
  seats INTEGER,
  brain TEXT NOT NULL DEFAULT 'script',
  listed INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS server_members (
  game TEXT NOT NULL,
  server TEXT NOT NULL,
  player TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  home INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (game, server, player)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS server_members_player ON server_members (player);
-- An agent pass: one AI's way into a seat. Only the SHA-256 of its secret.
CREATE TABLE IF NOT EXISTS agent_passes (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'party',
  hands TEXT NOT NULL DEFAULT 'self',
  game TEXT,
  server TEXT,
  issuer TEXT NOT NULL DEFAULT 'owner',
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
ALTER TABLE office_invites ADD COLUMN server TEXT;
`;

export const POLICIES = Object.freeze(['open', 'humans-only', 'hybrid', 'beginner']);
export const DOORS = Object.freeze(['open', 'accounts', 'invite']);
export const SPEECHES = Object.freeze(['game', 'lines', 'off']);
export const BRAINS = Object.freeze(['off', 'script', 'workers-ai', 'owner-key']);
export const MEMBER_ROLES = Object.freeze(['member', 'mentor', 'mod']);
export const SERVER_ID = /^[a-z0-9][a-z0-9-]{1,19}$/;
/** At most 12 servers a game and 16 rooms a server (the Lobby keeps every pool in memory). */
export const SERVER_LIMITS = Object.freeze({ perGame: 12, roomsMax: 16, name: 40, blurb: 160, beginnerDays: 30 });
const DAY = 86_400_000;

/** The badge and the one line each policy shows on a card, the server page, the play shell and the office. */
export const POLICY_WORDS = Object.freeze({
  open: { badge: 'Open', line: 'Open: anyone can play. AI players are always marked AI.' },
  'humans-only': { badge: 'Humans only', line: 'Humans only: every player here is a person. AI can\'t join.' },
  hybrid: { badge: 'Hybrid', line: 'Hybrid: {n} seats in every room are AI companions, always marked AI. Your party sets their level.' },
  beginner: { badge: 'Beginner', line: 'Beginner: for new players. AI guides help you learn. Chat is quick lines only.' },
});
export const KIDS_LINE = 'Players have handles, not names.';

/** The badge ("Hybrid · 2") and the line for a server, as its card and page say it. */
export function policyWords(s) {
  const w = POLICY_WORDS[s?.policy] ?? POLICY_WORDS.open;
  const n = s?.policy === 'hybrid' ? s.aiSeats : 0;
  return {
    badge: s?.policy === 'hybrid' ? `${w.badge} · ${n}` : w.badge,
    line: `${w.line.replace('{n}', String(n))}${s?.kids ? ` ${KIDS_LINE}` : ''}`,
  };
}

/* ------------------------------------------------------------------ rooms and servers */

/** The server a room belongs to: `pub-N` and any other name are `public`; `s-<id>-<n>` is `<id>`. */
export function roomServer(code) {
  const m = /^s-([a-z0-9][a-z0-9-]{1,19})-(\d{1,9})$/.exec(String(code ?? ''));
  return m ? m[1] : 'public';
}
/** A pool's room: `pub-<n>` for the public server, `s-<id>-<n>` for any other. */
export const roomCode = (server, n) => (!server || server === 'public' ? `pub-${n}` : `s-${server}-${n}`);
/** A room the Lobby makes and matches strangers in (a named `?room=` is never pooled). */
export const pooledRoom = (code) => /^pub-\d{1,9}$/.test(String(code ?? '')) || /^s-[a-z0-9][a-z0-9-]{1,19}-\d{1,9}$/.test(String(code ?? ''));

const int = (v, lo, hi, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const oneLine = (v, max) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A server as everything else reads it, from a D1 row (snake_case) or a game.json seed (camelCase), with each
 * policy's defaults: humans-only has no AI and its bots off; hybrid keeps 2 AI seats; beginner has 2 guides, quick
 * lines only and a gentle dial.
 */
export function serverOf(raw, { from = 'd1' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (snake, camel) => (raw[snake] !== undefined && raw[snake] !== null ? raw[snake] : raw[camel]);
  const id = String(raw.id ?? '');
  if (id !== 'public' && !SERVER_ID.test(id)) return null;
  const policy = POLICIES.includes(raw.policy) ? raw.policy : 'open';
  const human = policy === 'humans-only';
  const kids = policy === 'beginner' && (pick('kids', 'kids') === true || Number(pick('kids', 'kids')) === 1);
  const levelMax = int(pick('level_max', 'levelMax'), 1, kids ? 3 : 5, kids ? 3 : 5);
  return {
    id,
    name: oneLine(raw.name, SERVER_LIMITS.name) || (id === 'public' ? 'Quick play' : id),
    blurb: oneLine(raw.blurb, SERVER_LIMITS.blurb),
    policy,
    aiSeats: human || policy === 'open' ? 0 : int(pick('ai_seats', 'aiSeats'), 0, Number.MAX_SAFE_INTEGER, policy === 'hybrid' ? 2 : 0),
    guides: policy === 'beginner' ? int(pick('guides', 'guides'), 0, Number.MAX_SAFE_INTEGER, 2) : 0,
    bots: (pick('bots', 'bots') ?? (human ? 'off' : 'fill')) === 'off' ? 'off' : 'fill',
    level: Math.min(levelMax, int(pick('level', 'level'), 1, 5, policy === 'beginner' ? 2 : 3)),
    levelMax,
    speech: policy === 'beginner' ? (pick('speech', 'speech') === 'off' ? 'off' : 'lines') : SPEECHES.includes(pick('speech', 'speech')) ? pick('speech', 'speech') : 'game',
    door: DOORS.includes(pick('door', 'door')) ? pick('door', 'door') : 'open',
    kids,
    beginnerDays: policy === 'beginner' ? int(pick('beginner_days', 'beginnerDays'), 1, 3650, SERVER_LIMITS.beginnerDays) : null,
    beginnerLevel: policy === 'beginner' && pick('beginner_level', 'beginnerLevel') !== undefined && pick('beginner_level', 'beginnerLevel') !== null ? int(pick('beginner_level', 'beginnerLevel'), 1, 1_000_000, null) : null,
    roomsMax: int(pick('rooms_max', 'roomsMax'), 1, SERVER_LIMITS.roomsMax, id === 'public' ? SERVER_LIMITS.roomsMax : 4),
    seats: pick('seats', 'seats') === undefined || pick('seats', 'seats') === null ? null : int(pick('seats', 'seats'), 1, Number.MAX_SAFE_INTEGER, null),
    brain: human ? 'off' : BRAINS.includes(pick('brain', 'brain')) ? pick('brain', 'brain') : 'script',
    listed: pick('listed', 'listed') === undefined || pick('listed', 'listed') === null ? true : pick('listed', 'listed') === true || Number(pick('listed', 'listed')) === 1,
    state: ['open', 'closed', 'archived'].includes(raw.state) ? raw.state : 'open',
    createdAt: Number(pick('created_at', 'createdAt')) || 0,
    updatedAt: Number(pick('updated_at', 'updatedAt')) || 0,
    // A game.json seed's own chat rules (0.23.0): under the owner's for this server (worker/chat-store.mjs chatOf).
    ...(from === 'game.json' && raw.chat && typeof raw.chat === 'object' && !Array.isArray(raw.chat) ? { chat: raw.chat } : {}),
    from,
  };
}

/** The public server with nothing set: today's behaviour. */
export const PUBLIC_SERVER = Object.freeze(serverOf({ id: 'public', name: 'Quick play', policy: 'open' }, { from: 'default' }));

const serverCache = new WeakMap();
/** Every server row of every game (D1), read at most every 5 s per Worker instance; an empty map before migration 0006. */
async function rowsOf(env, { fresh = false } = {}) {
  if (!env?.DB || env.HOMIE_PREVIEW === '1') return new Map();
  const hit = serverCache.get(env.DB);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit.map;
  let map = new Map();
  try {
    const { results } = await env.DB.prepare('SELECT * FROM servers LIMIT 2000').all();
    for (const r of results ?? []) {
      const list = map.get(r.game) ?? [];
      list.push(r);
      map.set(r.game, list);
    }
  } catch { map = new Map(); }
  serverCache.set(env.DB, { at: Date.now(), map });
  return map;
}
export const forgetServers = (env) => { if (env?.DB) serverCache.delete(env.DB); };

/**
 * A game's servers: `public` first, then the rest by when they were made. The game.json seeds (the catalogue's
 * `servers`), with a D1 row of the same id winning. Closed and archived servers are in it (their state says so).
 */
export async function serversOf(env, meta, { fresh = false } = {}) {
  const rows = (await rowsOf(env, { fresh })).get(meta?.id) ?? [];
  const byId = new Map();
  byId.set('public', PUBLIC_SERVER);
  for (const seed of Array.isArray(meta?.servers) ? meta.servers.slice(0, SERVER_LIMITS.perGame) : []) {
    const s = serverOf({ ...seed, updatedAt: 1 }, { from: 'game.json' });
    if (s) byId.set(s.id, s);
  }
  for (const r of rows) { const s = serverOf(r, { from: 'd1' }); if (s) byId.set(s.id, s); }
  return [...byId.values()].sort((a, b) => (a.id === 'public' ? -1 : b.id === 'public' ? 1 : a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
}

/**
 * A room's policy (the Worker composes it; the room's Table applies it, NETPLAY.md section 17). AI seats and guides
 * together are at most one fewer than the room's seats (at least one seat is a person's); a kids server caps the
 * dial at 3 and keeps speech to quick lines. `server: null` is a named room (it takes the public server's rules).
 */
export function policyOf(server, { seats = 8, named = false, chat = null } = {}) {
  const s = server ?? PUBLIC_SERVER;
  const room = Math.max(1, Math.min(seats, s.seats ?? seats));
  const guides = s.policy === 'beginner' ? Math.max(0, Math.min(s.guides, room - 1)) : 0;
  const aiSeats = s.policy === 'hybrid' || s.policy === 'beginner' ? Math.max(0, Math.min(s.aiSeats, room - 1 - guides)) : 0;
  const levelMax = s.kids ? Math.min(3, s.levelMax) : s.levelMax;
  return {
    v: 1, at: Math.max(0, Number(s.updatedAt) || 0),
    server: named ? null : { id: s.id, name: s.name },
    kind: s.policy, aiSeats, guides, bots: s.bots,
    level: Math.min(levelMax, s.level), levelMax,
    speech: s.kids && s.speech === 'game' ? 'lines' : s.speech,
    kids: Boolean(s.kids), brain: s.brain,
    // Room chat (0.23.0, worker/chat-store.mjs chatOf): the room's chat rules; an owner's change makes the policy newer.
    ...(chat ? { chat, at: Math.max(Math.max(0, Number(s.updatedAt) || 0), Number(chat.at) || 0) } : {}),
  };
}

export const levelName = (n) => SKILLS[Math.max(1, Math.min(5, Math.round(Number(n)) || 3)) - 1].name;

/* ------------------------------------------------------------------ the door */

/** The cookie a server's invite leaves in a browser (path /<game>/), like a game's invite pass. */
export const serverPassCookie = (game, server) => `studio_pass_${game}.${server}`;

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** This browser's pass to a server's invite door (its invite still open), or null. */
export async function serverPassOf(request, env, game, server, cookieValues) {
  if (!env?.DB) return null;
  for (const value of cookieValues(request, serverPassCookie(game, server)).filter((v) => /^[a-f0-9]{48}$/.test(v)).slice(0, 2)) {
    try {
      const row = await env.DB.prepare('SELECT p.invite, p.expires_at, i.revoked, i.server FROM office_passes p JOIN office_invites i ON i.id = p.invite WHERE p.hash = ?1 AND p.game = ?2')
        .bind(await sha256(value), game).first();
      if (row && !row.revoked && row.server === server && Number(row.expires_at) > Date.now()) return { invite: row.invite };
    } catch { return null; }
  }
  return null;
}

/** A member's row, or null. */
export async function memberOf(env, game, server, player) {
  if (!env?.DB || !player) return null;
  try { return await env.DB.prepare('SELECT role, home, joined_at, seen_at FROM server_members WHERE game = ?1 AND server = ?2 AND player = ?3').bind(game, server, player).first(); } catch { return null; }
}

/**
 * Whether these holders may come in through a server's door: `{ ok, mentor?, owner? }`, or `{ ok: false, why, … }`
 * with `why` one of closed, account, invite, veteran. `holders` are a ticket's (o, i-…, p-…, a-…) or a page's own.
 * The owner always comes in. An agent's own checks are the pass's (worker/agents.mjs passRefusal), not these.
 * `watching`: a watcher is held to an account or invite door, never to the beginner check (it takes no seat).
 */
export async function serverAccess(env, { game, server, holders = [], watching = false }) {
  const parts = holders.filter(Boolean);
  if (parts.includes('o')) return { ok: true, owner: true };
  if (!server || server.state !== 'open') return { ok: false, why: 'closed' };
  const pid = parts.find((p) => p.startsWith('p-'))?.slice(2) ?? null;
  const beginner = server.policy === 'beginner' && !watching;
  if (server.door === 'accounts' || (beginner && pid)) {
    let player = null;
    try { player = pid && env?.DB ? await env.DB.prepare('SELECT id, guest, created_at FROM players WHERE id = ?1').bind(pid).first() : null; } catch { player = null; }
    if (server.door === 'accounts' && (!player || Number(player.guest) === 1)) return { ok: false, why: 'account' };
    if (beginner && player) {
      const member = await memberOf(env, game, server.id, pid);
      const mentor = member && (member.role === 'mentor' || member.role === 'mod');
      const days = Math.floor((Date.now() - Number(player.created_at)) / DAY);
      if (!mentor && days >= (server.beginnerDays ?? SERVER_LIMITS.beginnerDays)) return { ok: false, why: 'veteran', days };
      if (!mentor && server.beginnerLevel) {
        let level = 0;
        try { level = Number((await env.DB.prepare("SELECT n FROM player_stats WHERE player = ?1 AND game = ?2 AND name = 'level'").bind(pid, game).first())?.n) || 0; } catch { level = 0; }
        if (level >= server.beginnerLevel) return { ok: false, why: 'veteran', level };
      }
      if (mentor) return { ok: true, mentor: true };
    }
  }
  if (server.door === 'invite') {
    const invite = parts.find((p) => p.startsWith('i-'))?.slice(2) ?? null;
    let row = null;
    try { row = invite && env?.DB ? await env.DB.prepare('SELECT revoked, server FROM office_invites WHERE id = ?1 AND game = ?2').bind(invite, game).first() : null; } catch { row = null; }
    if (!row || row.revoked || row.server !== server.id) return { ok: false, why: 'invite' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ membership */

const seen = new Map();
/** A signed-in player played here: a member from now (or seen again). One write per (server, player) per 10 minutes. */
export async function noteMember(env, game, server, player) {
  if (!env?.DB || !player || !SERVER_ID.test(String(server)) && server !== 'public') return false;
  const key = `${game}/${server}/${player}`;
  const now = Date.now();
  if (now - (seen.get(key) ?? 0) < 10 * 60_000) return false;
  seen.set(key, now);
  if (seen.size > 5000) for (const [k, at] of seen) if (now - at > 10 * 60_000) seen.delete(k);
  try {
    await env.DB.prepare(`INSERT INTO server_members (game, server, player, role, home, joined_at, seen_at) VALUES (?1, ?2, ?3, 'member', 0, ?4, ?4)
      ON CONFLICT(game, server, player) DO UPDATE SET seen_at = excluded.seen_at`).bind(game, server, player, now).run();
    return true;
  } catch { return false; }
}

/** How many belong to each server of a game: { <server>: n }. */
export async function memberCounts(env, game) {
  try {
    const { results } = await env.DB.prepare('SELECT server, COUNT(*) AS n FROM server_members WHERE game = ?1 GROUP BY server').bind(game).all();
    return Object.fromEntries((results ?? []).map((r) => [r.server, Number(r.n) || 0]));
  } catch { return {}; }
}

/** A player's servers of every game: [{ game, server, role, home, joinedAt, seenAt }]. */
export async function membershipsOf(env, player) {
  try {
    const { results } = await env.DB.prepare('SELECT game, server, role, home, joined_at, seen_at FROM server_members WHERE player = ?1 ORDER BY home DESC, seen_at DESC LIMIT 100').bind(player).all();
    return (results ?? []).map((r) => ({ game: r.game, server: r.server, role: r.role, home: Number(r.home) === 1, joinedAt: Number(r.joined_at), seenAt: Number(r.seen_at) }));
  } catch { return []; }
}

/** A player's home server in a game, or null. */
export async function homeOf(env, game, player) {
  if (!env?.DB || !player) return null;
  try { return (await env.DB.prepare('SELECT server FROM server_members WHERE game = ?1 AND player = ?2 AND home = 1').bind(game, player).first())?.server ?? null; } catch { return null; }
}

/** Join (and optionally make home), or leave: the player's own choice (POST /<game>/s/<id>/home). */
export async function setMembership(env, game, server, player, { join = true, home = false } = {}) {
  const now = Date.now();
  if (!join) {
    await env.DB.prepare("DELETE FROM server_members WHERE game = ?1 AND server = ?2 AND player = ?3 AND role = 'member'").bind(game, server, player).run();
    await env.DB.prepare('UPDATE server_members SET home = 0 WHERE game = ?1 AND server = ?2 AND player = ?3').bind(game, server, player).run();
    return { ok: true, member: false, home: false };
  }
  const writes = [];
  if (home) writes.push(env.DB.prepare('UPDATE server_members SET home = 0 WHERE game = ?1 AND player = ?2').bind(game, player));
  writes.push(env.DB.prepare(`INSERT INTO server_members (game, server, player, role, home, joined_at, seen_at) VALUES (?1, ?2, ?3, 'member', ?4, ?5, ?5)
    ON CONFLICT(game, server, player) DO UPDATE SET home = CASE WHEN ?4 = 1 THEN 1 ELSE home END, seen_at = excluded.seen_at`).bind(game, server, player, home ? 1 : 0, now));
  await env.DB.batch(writes);
  return { ok: true, member: true, home };
}

/* ------------------------------------------------------------------ the owner's changes */

/**
 * A new server or a change, checked: `{ ok, fields }` (camelCase, only what was given), or `{ ok: false, message }`.
 * `create` needs a name and a policy (the id comes from the name unless given).
 */
export function checkServer(body, { create = false } = {}) {
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  const f = {};
  if (create || body.name !== undefined) {
    const name = oneLine(body.name, SERVER_LIMITS.name);
    if (!name || !/[\p{L}\p{N}]/u.test(name)) return bad('name is the server\'s name (1 to 40 characters)');
    f.name = name;
  }
  if (create) {
    const id = body.id !== undefined ? String(body.id) : String(f.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');
    if (!SERVER_ID.test(id) || id === 'public') return bad('id is 2 to 20 lowercase letters, digits and hyphens (and not "public")');
    f.id = id;
  }
  if (create || body.policy !== undefined) {
    if (!POLICIES.includes(body.policy)) return bad('policy is open, humans-only, hybrid or beginner');
    f.policy = body.policy;
  }
  if (body.blurb !== undefined) f.blurb = oneLine(body.blurb, SERVER_LIMITS.blurb);
  const num = (k, lo, hi) => { if (body[k] === undefined) return true; const n = Math.floor(Number(body[k])); if (!Number.isFinite(n) || n < lo || n > hi) return false; f[k] = n; return true; };
  if (!num('aiSeats', 0, Number.MAX_SAFE_INTEGER)) return bad('aiSeats is a non-negative safe integer (and at most the room\'s seats less one)');
  if (!num('guides', 0, Number.MAX_SAFE_INTEGER)) return bad('guides is a non-negative safe integer');
  if (!num('level', 1, 5)) return bad('level is 1 to 5 (Rookie, Steady, Fair, Strong, Maxed)');
  if (!num('levelMax', 1, 5)) return bad('levelMax is 1 to 5');
  if (!num('rooms', 1, SERVER_LIMITS.roomsMax)) return bad(`rooms is 1 to ${SERVER_LIMITS.roomsMax}`);
  if (!num('beginnerDays', 1, 3650)) return bad('beginnerDays is 1 to 3650');
  if (body.beginnerLevel === null) f.beginnerLevel = null; else if (!num('beginnerLevel', 1, 1_000_000)) return bad('beginnerLevel is a number, or null for none');
  if (body.seats === null) f.seats = null; else if (!num('seats', 1, Number.MAX_SAFE_INTEGER)) return bad('seats is a positive safe integer, or null for the game\'s own');
  if (body.kids !== undefined) f.kids = body.kids === true || body.kids === 'on';
  if (body.listed !== undefined) f.listed = !(body.listed === false || body.listed === 'off');
  if (body.bots !== undefined) { if (!['fill', 'off'].includes(body.bots)) return bad('bots is fill or off'); f.bots = body.bots; }
  if (body.speech !== undefined) { if (!SPEECHES.includes(body.speech)) return bad('speech is game, lines or off'); f.speech = body.speech; }
  if (body.door !== undefined) { if (!DOORS.includes(body.door)) return bad('door is open, accounts or invite'); f.door = body.door; }
  if (body.brain !== undefined) { if (!BRAINS.includes(body.brain)) return bad('brain is off, script, workers-ai or owner-key'); f.brain = body.brain; }
  if (f.levelMax !== undefined && f.level !== undefined && f.level > f.levelMax) f.level = f.levelMax;
  return { ok: true, fields: f };
}

const DOOR_RANK = { open: 0, accounts: 1, invite: 2 };
/**
 * Whether a change takes something away from people (DESIGN D13: the AI only ASKS for these): a stricter door, any
 * policy change to humans-only (agents leave after the round), closing it, a beginner check made stricter, or fewer
 * rooms or seats. Everything else (a new name, more AI seats, a wider door) happens at once.
 */
export function narrows(before, f) {
  if (!before) return false;
  if (f.door !== undefined && DOOR_RANK[f.door] > DOOR_RANK[before.door]) return true;
  if (f.policy !== undefined && f.policy !== before.policy && (f.policy === 'humans-only' || f.policy === 'beginner')) return true;
  if (f.beginnerDays !== undefined && before.beginnerDays && f.beginnerDays < before.beginnerDays) return true;
  if (f.beginnerLevel !== undefined && f.beginnerLevel !== null && (!before.beginnerLevel || f.beginnerLevel < before.beginnerLevel)) return true;
  if (f.rooms !== undefined && f.rooms < before.roomsMax) return true;
  if (f.seats !== undefined && f.seats !== null && (before.seats === null || f.seats < before.seats)) return true;
  return false;
}

/** The D1 row for a server (a new one, or the old one with the change), ready for INSERT OR REPLACE. */
export function rowFor(game, before, f, now = Date.now()) {
  const b = before ?? serverOf({ id: f.id, name: f.name, policy: f.policy }, { from: 'd1' });
  const next = serverOf({
    id: b.id, name: f.name ?? b.name, blurb: f.blurb ?? b.blurb, policy: f.policy ?? b.policy,
    aiSeats: f.aiSeats ?? (f.policy && f.policy !== b.policy ? undefined : b.aiSeats),
    guides: f.guides ?? (f.policy && f.policy !== b.policy ? undefined : b.guides),
    bots: f.bots ?? (f.policy && f.policy !== b.policy ? undefined : b.bots),
    level: f.level ?? b.level, levelMax: f.levelMax ?? b.levelMax,
    speech: f.speech ?? (f.policy && f.policy !== b.policy ? undefined : b.speech),
    door: f.door ?? b.door, kids: f.kids ?? b.kids,
    beginnerDays: f.beginnerDays ?? b.beginnerDays, beginnerLevel: f.beginnerLevel !== undefined ? f.beginnerLevel : b.beginnerLevel,
    roomsMax: f.rooms ?? b.roomsMax, seats: f.seats !== undefined ? f.seats : b.seats,
    brain: f.brain ?? (f.policy && f.policy !== b.policy ? undefined : b.brain), listed: f.listed ?? b.listed,
    state: f.state ?? b.state, createdAt: b.createdAt || now, updatedAt: Math.max(now, (b.updatedAt || 0) + 1),
  }, { from: 'd1' });
  return next;
}

export async function writeServer(env, game, s) {
  await env.DB.prepare(`INSERT OR REPLACE INTO servers (game, id, name, blurb, policy, ai_seats, guides, bots, level, level_max, speech, door, kids, beginner_days, beginner_level, rooms_max, seats, brain, listed, state, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`)
    .bind(game, s.id, s.name, s.blurb || null, s.policy, s.aiSeats, s.guides, s.bots, s.level, s.levelMax, s.speech, s.door, s.kids ? 1 : 0, s.beginnerDays, s.beginnerLevel, s.roomsMax, s.seats, s.brain, s.listed ? 1 : 0, s.state, s.createdAt, s.updatedAt).run();
  forgetServers(env);
}

/** A server as the office, the API and the pages show it. */
export function serverView(s, { origin = '', game = '' } = {}) {
  const w = policyWords(s);
  return {
    id: s.id, name: s.name, blurb: s.blurb, policy: s.policy, badge: w.badge, line: w.line, aiSeats: s.aiSeats, guides: s.guides, bots: s.bots,
    level: s.level, levelName: levelName(s.level), levelMax: s.levelMax, speech: s.speech, door: s.door, kids: s.kids,
    beginnerDays: s.beginnerDays, beginnerLevel: s.beginnerLevel, rooms: s.roomsMax, seats: s.seats, brain: s.brain, listed: s.listed, state: s.state, from: s.from,
    page: `${origin}/${game}/${s.id === 'public' ? '' : `s/${s.id}/`}`, play: `${origin}/${game}/${s.id === 'public' ? 'play' : `s/${s.id}/play`}`,
  };
}
