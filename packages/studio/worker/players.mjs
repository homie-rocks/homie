import { toolIdentity } from './tool-identity.mjs';
/**
 * PLAYERS — accounts on ONE studio, passkey first, and the cloud saves a persistent game keeps (saves/SAVES.md).
 *
 * A player is a row in the studio's own D1 and nothing else: a random id (`pl_…`, names nobody), a display name
 * (a two-word handle until they choose one), and the passkeys they made here. No password, no email address
 * required, no cookie from anyone else, nothing sent anywhere. Another studio cannot see this one's players: the
 * identity is this site's alone (a passkey is bound to this site's host name, and the rows are in this D1).
 *
 *   guest     Pressing Play needs nothing. The first time a game SAVES something, this site makes a guest player
 *             and keeps it in a cookie (HttpOnly, this site only). A guest keeps their progress on that browser.
 *   account   The guest (or anyone) makes a passkey: Face ID, a fingerprint, a PIN or a security key. The guest
 *             becomes an account and keeps every save. On another device, "Sign in" with the same passkey (the
 *             device's own sync carries it: iCloud Keychain, Google Password Manager, a password manager, or a
 *             phone's QR code) and the same saves are there. A second passkey (another device, a security key) can
 *             be added any time; a recovery email only when the studio has a mail sender (PLAYER_MAIL).
 *   owner     The studio's owner marks their own account once (`homie-studio players owner`): the back office and
 *             the game can then recognise them (`players.isOwner(request, env)`).
 *
 * WHAT IS STORED (migration 0004_players.sql): players (id, display name, guest/owner flags, created and last-seen
 * times), each passkey's public key and counter (never a private key: it cannot leave the device), sessions and
 * one-time challenges as SHA-256 hashes only, saves, lifetime stats and memorials, and, only if the player adds
 * one, a recovery email. No IP address is stored: rate limits count in memory and forget.
 *
 * THE OWNER sees counts and names (`players.count`, `players.list`), never a passkey, a session or an email.
 * A player sees, downloads (/api/player/export) and deletes (/api/player/delete) everything of theirs.
 */
import { handleFor } from './room.mjs';
import { isAiName } from './agents.mjs';
import { cookieValue } from './stats.mjs';
import { adoptStatements, bumpPlayerStats, dropPlayerData, fall, fallenList, getSave, listSaves, playerData, readPlayerStats, SAVE_LIMITS, savesSummary, wipeSaves, writeSaves } from './saves.mjs';
import { bytesToB64url, randomToken, sha256Hex, verifyAssertion, verifyRegistration } from './webauthn.mjs';
import { ACCOUNT_JS, accountPage } from './account-page.mjs';
import { adoptShopStatements, migrated as shopMigrated, forgetPlayerShop, livePurchases, shopDataOf } from './shop-store.mjs';
import { forgetPlayerHistory, playerHistory } from './lounge-store.mjs';

export const PLAYERS_MIGRATION_FILE = '0004_players.sql';
export const PLAYERS_MIGRATION = `-- Players and cloud saves (@homie-rocks/studio 0.12.0): accounts on this studio only (saves/SAVES.md).
-- A player is a random id and a display name. Passkeys keep only their PUBLIC key; sessions and one-time
-- challenges keep only a SHA-256 hash. No IP address, no password, no email unless a player adds one.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  named INTEGER NOT NULL DEFAULT 0,
  guest INTEGER NOT NULL DEFAULT 1,
  owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_created ON players (created_at);
CREATE INDEX IF NOT EXISTS players_seen ON players (guest, seen_at);
CREATE TABLE IF NOT EXISTS player_passkeys (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  synced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_passkeys_player ON player_passkeys (player);
CREATE TABLE IF NOT EXISTS player_sessions (
  hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'session',
  game TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS player_sessions_player ON player_sessions (player);
CREATE TABLE IF NOT EXISTS player_challenges (
  hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  player TEXT,
  data TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_emails (
  player TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified_at INTEGER,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_emails_email ON player_emails (email);
CREATE TABLE IF NOT EXISTS saves (
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  blob INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player, game, key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_stats (
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  n REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player, game, name)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS memorials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  character TEXT NOT NULL,
  player_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memorials_game_at ON memorials (game, at);
CREATE INDEX IF NOT EXISTS memorials_player ON memorials (player);
`;

export const PLAYER_COOKIE = 'studio_player';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long things live, and the rate and size caps (per Worker instance for rates; in D1 for storage). */
export const PLAYER_LIMITS = Object.freeze({
  sessionDays: 120, guestSessionDays: 365, guestIdleDays: 180, challengeMinutes: 5, passMinutes: 10, linkMinutes: 30,
  passkeys: 10, playersPerDay: 5000, bodyBytes: 1_200_000,
  // Per address (in memory, never stored): ceremonies and new players. A party on one Wi-Fi shares an address.
  ceremoniesPerTenMinutes: 60, newPlayersPerHour: 60, mailsPerHour: 6,
  // Per player (in memory): writes and reads a minute.
  writesPerMinute: 120, readsPerMinute: 240,
});

const PLAYER_ID = /^pl_[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PASS = /^pp_[A-Za-z0-9_-]{32}$/;
const LINK = /^[A-Za-z0-9_-]{43}$/;
const CRED_ID = /^[A-Za-z0-9_-]{16,1400}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const OWNER_KEY = /^hsk_[a-f0-9]{48}$/;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

const json = (body, status = 200, headers = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', ...headers },
});
const fail = (status, error, message, extra = {}) => json({ ok: false, error, message, ...extra }, status);

/* ------------------------------------------------------------------ names */

/** Words a name may not open with unless the player is the studio's owner: a name never claims a role. */
const ROLE_WORDS = /^(?:the\s+)?(?:admin|administrator|mod|moderator|owner|staff|system|official|support|dev|developer|gm|game\s*master|homie)(?:\b|$)/i;

/**
 * A display name, by the same rules as a room's typed names and handles: one line of at most 24 characters,
 * whitespace collapsed, no control, format or invisible characters (no zero-width or bidi tricks), at least one
 * letter or digit; never a role (admin, moderator, owner…) or the studio's own name, except for the owner; and never
 * ending in an AI or bot mark ("· AI", "(bot)"…), for anyone: only an agent's name says AI (0.16.0). It is always
 * shown as text (escaped), never as markup. `max` lets a character's name run to 32.
 */
export function cleanName(raw, { studio = '', owner = false, max = 24 } = {}) {
  const text = String(raw ?? '').normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029\u115F\u1160\u3164\uFFA0]/gu, '')
    .replace(/\s+/gu, ' ').trim();
  const chars = [...text];
  const name = chars.slice(0, max).join('').trim();
  if (!name) return { ok: false, error: 'name', message: 'a name needs at least one letter or digit' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: 'name', message: 'a name needs at least one letter or digit' };
  if (!owner && (ROLE_WORDS.test(name) || (studio && name.toLowerCase() === String(studio).trim().toLowerCase()))) {
    return { ok: false, error: 'name-taken', message: 'that name belongs to the studio; pick another' };
  }
  if (isAiName(name)) return { ok: false, error: 'name-ai', message: 'a person\'s name cannot end in "AI" or "bot": only an AI player is marked AI' };
  return { ok: true, name, cut: chars.length > max };
}

/* ------------------------------------------------------------------ rate limits (memory only) */

const buckets = new Map();
/** True when `key` has had `max` hits in the last `windowMs` (and this one is refused); otherwise counts it. */
export function limited(key, max, windowMs, now = Date.now()) {
  let list = buckets.get(key);
  if (!list) { list = []; buckets.set(key, list); }
  while (list.length && list[0] <= now - windowMs) list.shift();
  if (list.length >= max) return true;
  list.push(now);
  if (buckets.size > 20_000) {
    for (const [k, l] of buckets) if (!l.length || l[l.length - 1] < now - HOUR) buckets.delete(k);
    if (buckets.size > 20_000) buckets.clear();
  }
  return false;
}
/** For tests: forget every count. */
export function resetLimits() { buckets.clear(); }
const addressOf = (request) => request.headers.get('cf-connecting-ip') || 'local';

/* ------------------------------------------------------------------ cookies, sessions */

function sessionCookie(url, token, days) {
  return `${PLAYER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(days * 86400)}${url.protocol === 'https:' ? '; Secure' : ''}`;
}
const clearCookie = (url) => `${PLAYER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`;

const newPlayerId = () => `pl_${randomToken(16).slice(0, 22)}`;

/** A new session for `player`: its D1 statement and its cookie. */
async function mintSession(env, url, player, guest) {
  const token = randomToken(32);
  const days = guest ? PLAYER_LIMITS.guestSessionDays : PLAYER_LIMITS.sessionDays;
  return {
    statement: env.DB.prepare("INSERT INTO player_sessions (hash, player, kind, expires_at) VALUES (?1, ?2, 'session', ?3)").bind(await sha256Hex(token), player, Date.now() + days * DAY),
    cookie: sessionCookie(url, token, days),
  };
}

/** The signed-in player of this request (its session cookie), or null. `touch` keeps last-seen and the session fresh. */
async function sessionOf(request, env, url = new URL(request.url)) {
  const token = cookieValue(request, PLAYER_COOKIE);
  if (!token || !TOKEN.test(token) || !env?.DB) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT s.player, s.expires_at, p.name, p.named, p.guest, p.owner, p.created_at, p.seen_at FROM player_sessions s JOIN players p ON p.id = s.player WHERE s.hash = ?1 AND s.kind = 'session'").bind(hash).first();
  const now = Date.now();
  if (!row || Number(row.expires_at) <= now) return null;
  const guest = Number(row.guest) === 1;
  const session = {
    hash, token,
    player: { id: row.player, name: row.name, named: Number(row.named) === 1, guest, owner: Number(row.owner) === 1, since: Number(row.created_at) },
    cookies: [],
  };
  const writes = [];
  if (now - Number(row.seen_at) > 6 * HOUR) writes.push(env.DB.prepare('UPDATE players SET seen_at = ?2 WHERE id = ?1').bind(row.player, now));
  const days = guest ? PLAYER_LIMITS.guestSessionDays : PLAYER_LIMITS.sessionDays;
  if (Number(row.expires_at) - now < (days / 2) * DAY) {
    writes.push(env.DB.prepare('UPDATE player_sessions SET expires_at = ?2 WHERE hash = ?1').bind(hash, now + days * DAY));
    session.cookies.push(sessionCookie(url, token, days));
  }
  if (writes.length) await env.DB.batch(writes).catch(() => {});
  return session;
}

/** A guest for a request with no player yet (the first save). Refused past the address's or the day's limit. */
async function newGuest(request, env, url, addressLimit = PLAYER_LIMITS.newPlayersPerHour, counter = 'new') {
  const ip = addressOf(request);
  if (addressLimit !== null && limited(`${counter}:${ip}`, addressLimit, HOUR)) return { error: fail(429, 'rate', 'too many new players from this address; try again later') };
  const capped = (counter !== 'shop-new' || env.PLAYER_LIMIT_DAILY !== undefined) && await dailyCapReached(env);
  if (capped) return { error: fail(503, 'busy', 'this studio has taken all the new players it takes in one day; try again tomorrow') };
  const id = newPlayerId();
  const now = Date.now();
  const name = handleFor(id);
  const s = await mintSession(env, url, id, true);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?1, ?2, 0, 1, 0, ?3, ?3)').bind(id, name, now),
    s.statement,
  ]);
  if (Math.random() < 0.02) pruneGuests(env).catch(() => {});
  return { session: { player: { id, name, named: false, guest: true, owner: false, since: now }, cookies: [s.cookie], fresh: true } };
}

async function dailyCapReached(env) {
  const cap = Math.max(1, Math.floor(Number(env.PLAYER_LIMIT_DAILY)) || PLAYER_LIMITS.playersPerDay);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE created_at >= ?1').bind(Date.now() - DAY).first();
  return Number(row?.n) >= cap;
}

/** Guests nobody has used for guestIdleDays are forgotten (a few at a time), with everything they kept. */
export async function pruneGuests(env) {
  const now = Date.now();
  const ownership = await shopMigrated(env, { complete: false }) ? "AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.player = players.id AND e.state = 'active' AND (e.ends_at IS NULL OR e.ends_at > ?2)) AND NOT EXISTS (SELECT 1 FROM shop_orders o WHERE o.player = players.id AND (o.paid_at IS NOT NULL OR o.session IS NOT NULL))" : 'AND ?2 > 0';
  const old = (await env.DB.prepare(`SELECT id FROM players WHERE guest = 1 AND seen_at < ?1 ${ownership} LIMIT 25`).bind(now - PLAYER_LIMITS.guestIdleDays * DAY, now).all()).results ?? [];
  for (const { id } of old) await removePlayer(env, id);
  await env.DB.prepare('DELETE FROM player_challenges WHERE expires_at < ?1').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM player_sessions WHERE expires_at < ?1').bind(Date.now()).run();
}

/* ------------------------------------------------------------------ challenges */

async function issueChallenge(env, purpose, player = null, data = null, minutes = PLAYER_LIMITS.challengeMinutes) {
  const challenge = randomToken(32);
  const writes = [env.DB.prepare('INSERT INTO player_challenges (hash, purpose, player, data, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await sha256Hex(challenge), purpose, player, data === null ? null : JSON.stringify(data), Date.now() + minutes * MINUTE)];
  if (Math.random() < 0.05) writes.push(env.DB.prepare('DELETE FROM player_challenges WHERE expires_at < ?1').bind(Date.now()));
  await env.DB.batch(writes);
  return challenge;
}

/** Spend a challenge (once): its purpose, player and data, or null when unknown, spent or expired. */
async function spendChallenge(env, challenge, purposes) {
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(challenge)) return null;
  const row = await env.DB.prepare('DELETE FROM player_challenges WHERE hash = ?1 RETURNING purpose, player, data, expires_at').bind(await sha256Hex(challenge)).first();
  if (!row || Number(row.expires_at) <= Date.now() || !purposes.includes(row.purpose)) return null;
  let data = null;
  try { data = row.data ? JSON.parse(row.data) : null; } catch { data = null; }
  return { purpose: row.purpose, player: row.player, data };
}

/** The challenge a browser's clientDataJSON carries (what it signed), to find the row it belongs to. */
function challengeIn(credential) {
  try {
    const b64 = String(credential?.response?.clientDataJSON ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const client = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof client?.challenge === 'string' ? client.challenge : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ the player, as they and others see it */

async function meOf(env, player) {
  const keys = await env.DB.prepare('SELECT COUNT(*) AS n FROM player_passkeys WHERE player = ?1').bind(player.id).first();
  let email = null;
  if (env.PLAYER_MAIL) {
    const e = await env.DB.prepare('SELECT email, verified_at FROM player_emails WHERE player = ?1').bind(player.id).first();
    if (e) email = { address: e.email, verified: Boolean(e.verified_at) };
  }
  // The servers this player belongs to (0.16.0; none before migration 0006).
  let servers = [];
  try { servers = ((await env.DB.prepare('SELECT game, server, role, home FROM server_members WHERE player = ?1 ORDER BY home DESC, seen_at DESC LIMIT 50').bind(player.id).all()).results ?? []).map((r) => ({ game: r.game, server: r.server, role: r.role, home: Number(r.home) === 1 })); } catch { servers = []; }
  return { id: player.id, name: player.name, named: Boolean(player.named), guest: Boolean(player.guest), owner: Boolean(player.owner), since: new Date(player.since).toISOString(), passkeys: Number(keys?.n) || 0, email, servers };
}

const features = (env) => ({ accounts: Boolean(env.DB) && env.HOMIE_PREVIEW !== '1', email: Boolean(env.PLAYER_MAIL && env.PLAYER_MAIL_FROM) });

/** Remove a player and everything of theirs (their saves' large objects too). */
async function removePlayer(env, id) {
  const data = await dropPlayerData(env, id);
  await env.DB.batch([
    ...data.statements,
    env.DB.prepare('DELETE FROM player_passkeys WHERE player = ?1').bind(id),
    env.DB.prepare('DELETE FROM player_sessions WHERE player = ?1').bind(id),
    env.DB.prepare('DELETE FROM player_challenges WHERE player = ?1').bind(id),
    env.DB.prepare('DELETE FROM player_emails WHERE player = ?1').bind(id),
    env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(id),
  ]);
  // Their servers' memberships too (0.16.0); a studio before migration 0006 has none to delete.
  try { await env.DB.prepare('DELETE FROM server_members WHERE player = ?1').bind(id).run(); } catch { /* not migrated */ }
  // What they bought goes with them; the orders stay, without the player (0.24.0; none before migration 0008).
  try { await env.DB.batch(forgetPlayerShop(env, id)); } catch { /* not migrated */ }
  // Every line they said in a room that keeps its chat, the Lounge too (0.29.0; none before migration 0009).
  await forgetPlayerHistory(env, id);
  await data.after();
}

/* ------------------------------------------------------------------ the back office's API */

const row = (r) => ({ id: r.id, name: r.name, guest: Number(r.guest) === 1, owner: Number(r.owner) === 1, createdAt: Number(r.created_at), seenAt: Number(r.seen_at), passkeys: Number(r.passkeys) || 0 });

/**
 * What the studio's back office (admin pages, owner MCP tools, room control) may use. Every function takes the
 * Worker's `env`; none returns a passkey (credential id or key), a session or an email address.
 */
export const players = Object.freeze({
  /** { accounts, guests, owners, new7d, active1d, active7d } */
  async count(env) {
    const now = Date.now();
    const r = await env.DB.prepare('SELECT SUM(guest = 0) AS accounts, SUM(guest = 1) AS guests, SUM(owner = 1) AS owners, SUM(guest = 0 AND created_at >= ?1) AS new7d, SUM(seen_at >= ?2) AS active1d, SUM(seen_at >= ?1) AS active7d FROM players')
      .bind(now - 7 * DAY, now - DAY).first();
    return { accounts: Number(r?.accounts) || 0, guests: Number(r?.guests) || 0, owners: Number(r?.owners) || 0, new7d: Number(r?.new7d) || 0, active1d: Number(r?.active1d) || 0, active7d: Number(r?.active7d) || 0 };
  },
  /** Newest first: { players: [{ id, name, guest, owner, createdAt, seenAt, passkeys }], next } (pass `next` as `cursor`). */
  async list(env, { limit = 50, cursor = null, q = '', guests = false } = {}) {
    const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50));
    const where = [];
    const args = [];
    if (!guests) where.push('p.guest = 0');
    const like = String(q ?? '').slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`);
    if (like) { args.push(`%${like}%`); where.push(`p.name LIKE ?${args.length} ESCAPE '\\'`); }
    const m = /^(\d{1,16}):(pl_[A-Za-z0-9_-]{22})$/.exec(String(cursor ?? ''));
    if (m) { args.push(Number(m[1]), m[2]); where.push(`(p.created_at < ?${args.length - 1} OR (p.created_at = ?${args.length - 1} AND p.id < ?${args.length}))`); }
    args.push(n + 1);
    const rows = (await env.DB.prepare(`SELECT p.id, p.name, p.guest, p.owner, p.created_at, p.seen_at, (SELECT COUNT(*) FROM player_passkeys k WHERE k.player = p.id) AS passkeys FROM players p${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC, p.id DESC LIMIT ?${args.length}`).bind(...args).all()).results ?? [];
    const page = rows.slice(0, n).map(row);
    const last = rows.length > n ? page[page.length - 1] : null;
    return { players: page, next: last ? `${last.createdAt}:${last.id}` : null };
  },
  /**
   * One player: the list's fields plus saves per game (keys, bytes, last write), lifetime stats and memorial count.
   * `get(env, id)`; `get(id, env)` works too (the back office's usePlayers seam passes the id first).
   */
  async get(env, id) {
    if (typeof env === 'string' && id && typeof id === 'object') [env, id] = [id, env];
    if (!PLAYER_ID.test(String(id))) return null;
    const r = await env.DB.prepare('SELECT p.id, p.name, p.guest, p.owner, p.created_at, p.seen_at, (SELECT COUNT(*) FROM player_passkeys k WHERE k.player = p.id) AS passkeys FROM players p WHERE p.id = ?1').bind(id).first();
    if (!r) return null;
    const stats = (await env.DB.prepare('SELECT game, name, n FROM player_stats WHERE player = ?1').bind(id).all()).results ?? [];
    const mem = await env.DB.prepare('SELECT COUNT(*) AS n FROM memorials WHERE player = ?1').bind(id).first();
    const byGame = {};
    for (const s of stats) (byGame[s.game] ??= {})[s.name] = Number(s.n);
    return { ...row(r), games: await savesSummary(env, id), stats: byGame, memorials: Number(mem?.n) || 0 };
  },
  /** The request's signed-in player ({ id, name, guest, owner }), or null. */
  async of(request, env) {
    const identity=toolIdentity(request);
    if(identity?.id && !identity.id.startsWith('office-')) { const p=await env.DB.prepare('SELECT id,name,guest,owner FROM players WHERE id=?1').bind(identity.id).first();return p?{...p,guest:Boolean(p.guest),owner:Boolean(p.owner)}:null; }
    try { const s = await sessionOf(request, env); return s ? { id: s.player.id, name: s.player.name, guest: s.player.guest, owner: s.player.owner } : null; } catch { return null; }
  },
  async recordsGuest(request,env,url){return newGuest(request,env,url);},
  /** Shop guest creation uses the studio's new-guest address rate and the daily player limit. */
  async shopGuest(request, env, url, addressLimit) { return newGuest(request, env, url, addressLimit, 'shop-new'); },
  /** True when the request carries the session of an account its owner marked (`homie-studio players owner`). */
  async isOwner(request, env) { return Boolean((await players.of(request, env))?.owner); },
  /** A short-lived pass naming a player (for a room to recognise them): 'pp_…'. */
  async passFor(env, id, { game = null, minutes = PLAYER_LIMITS.passMinutes } = {}) {
    const pass = `pp_${randomToken(24)}`;
    await env.DB.prepare("INSERT INTO player_sessions (hash, player, kind, game, expires_at) VALUES (?1, ?2, 'pass', ?3, ?4)")
      .bind(await sha256Hex(pass), id, game && GAME_ID.test(game) ? game : null, Date.now() + Math.max(1, Math.min(60, Number(minutes) || 10)) * MINUTE).run();
    return pass;
  },
  /** { id, name, guest, owner, game } for a live pass, or null. */
  async readPass(env, pass) {
    if (!PASS.test(String(pass ?? '')) || !env?.DB) return null;
    const r = await env.DB.prepare("SELECT s.player, s.game, s.expires_at, p.name, p.guest, p.owner FROM player_sessions s JOIN players p ON p.id = s.player WHERE s.hash = ?1 AND s.kind = 'pass'").bind(await sha256Hex(pass)).first();
    if (!r || Number(r.expires_at) <= Date.now()) return null;
    return { id: r.player, name: r.name, guest: Number(r.guest) === 1, owner: Number(r.owner) === 1, game: r.game ?? null };
  },
  /** The owner renames a player (moderation): the same rules as a player's own name, except roles. */
  async rename(env, id, name) {
    const c = cleanName(name, { owner: true });
    if (!c.ok) return c;
    const r = await env.DB.prepare('UPDATE players SET name = ?2, named = 1 WHERE id = ?1 RETURNING id').bind(id, c.name).first();
    return r ? { ok: true, name: c.name } : { ok: false, error: 'unknown', message: 'no such player' };
  },
  /** Delete a player and everything of theirs (as their own Delete does). */
  async remove(env, id) {
    if (!PLAYER_ID.test(String(id))) return { ok: false, error: 'unknown' };
    await removePlayer(env, id);
    return { ok: true };
  },
});

/* ------------------------------------------------------------------ requests */

/** A POST from this site's own pages: its Origin (or, when a browser sends none, Sec-Fetch-Site), and JSON. */
function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

async function bodyOf(request) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return { error: fail(415, 'json', 'send JSON (content-type: application/json)') };
  if (Number(request.headers.get('content-length') ?? 0) > PLAYER_LIMITS.bodyBytes) return { error: fail(413, 'too-large', 'that request is too large') };
  const text = await request.text();
  if (text.length > PLAYER_LIMITS.bodyBytes) return { error: fail(413, 'too-large', 'that request is too large') };
  try { return { body: text ? JSON.parse(text) : {} }; } catch { return { error: fail(400, 'json', 'that is not JSON') }; }
}

const withCookies = (res, cookies) => {
  for (const c of cookies ?? []) res.headers.append('set-cookie', c);
  return res;
};

/** A site path to come back to after signing in (this site only). */
export function nextOf(raw) {
  const s = String(raw ?? '');
  return /^\/[A-Za-z0-9/_.\-~%]*(\?[A-Za-z0-9=&_.\-%]*)?$/.test(s) && !s.startsWith('//') ? s.slice(0, 200) : '/account/';
}

function labelOf(raw, request) {
  const given = cleanName(raw, { owner: true, max: 32 });
  if (given.ok) return given.name;
  const ua = request.headers.get('user-agent') ?? '';
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Passkey';
}

/** The games of this studio (the catalogue), for which saves may be kept. */
async function gameOf(catalogueOf, id) {
  if (!GAME_ID.test(String(id ?? ''))) return null;
  const cat = await catalogueOf();
  return (cat.games ?? []).find((g) => g.id === id) ?? null;
}

/* ------------------------------------------------------------------ routes */

/**
 * /account/... and /api/player/... (or null when the path is neither). `catalogueOf()` reads games.json.
 */
export async function playerRoutes(request, env, ctx, url, { catalogueOf }) {
  const path = url.pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (path === '/_homie/account.js') return new Response(ACCOUNT_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  if (path === '/account') return Response.redirect(`${url.origin}/account/${url.search}`, 301);
  if (path === '/account/') {
    if (!read) return fail(405, 'method', 'GET only');
    const cat = await catalogueOf();
    return accountPage(cat, { origin: url.origin, next: nextOf(url.searchParams.get('next')), owner: OWNER_KEY.test(url.searchParams.get('owner') ?? '') ? url.searchParams.get('owner') : null, link: LINK.test(url.searchParams.get('k') ?? '') ? url.searchParams.get('k') : null, mode: ['verify', 'recover'].includes(url.searchParams.get('do')) ? url.searchParams.get('do') : null, features: features(env) });
  }
  if (!path.startsWith('/api/player/')) return null;
  const f = features(env);
  if (!f.accounts) return fail(503, 'no-accounts', env.HOMIE_PREVIEW === '1' ? 'Player accounts work on the studio\'s live site; a Preview has no database.' : 'This studio has no database bound (DB).');
  if (!read && !sameOrigin(request, url)) return fail(403, 'origin', 'only this site\'s own pages may do that');
  try {
    return await apiRoute(request, env, ctx, url, path.slice('/api/player/'.length).split('/').filter(Boolean), { catalogueOf, read, f });
  } catch (error) {
    if (/no such table/i.test(String(error?.message))) return fail(503, 'not-migrated', 'This studio\'s database has no player tables yet: `npm run deploy` applies migration 0004_players.sql.');
    throw error;
  }
}

async function apiRoute(request, env, ctx, url, parts, { catalogueOf, read, f }) {
  const [head, second, third] = parts;
  const ip = addressOf(request);
  const ceremony = () => limited(`cer:${ip}`, PLAYER_LIMITS.ceremoniesPerTenMinutes, 10 * MINUTE);
  const studioName = async () => (await catalogueOf()).studio?.name ?? 'Studio';

  if (head === 'me' && parts.length === 1) {
    if (!read) return fail(405, 'method', 'GET only');
    const s = await sessionOf(request, env, url);
    return withCookies(json({ ok: true, player: s ? await meOf(env, s.player) : null, features: f, limits: { saves: SAVE_LIMITS } }), s?.cookies);
  }

  if (read && head === 'fallen' && second && parts.length === 2) {
    if (!(await gameOf(catalogueOf, second))) return fail(404, 'game', 'no such game here');
    if (limited(`rd:${ip}`, PLAYER_LIMITS.readsPerMinute, MINUTE)) return fail(429, 'rate', 'too many requests; slow down');
    const mine = url.searchParams.get('mine') === '1';
    const s = mine ? await sessionOf(request, env, url) : null;
    if (mine && !s) return json({ ok: true, game: second, fallen: [] });
    return json({ ok: true, game: second, fallen: await fallenList(env, second, { limit: url.searchParams.get('limit'), player: s?.player.id ?? null }) });
  }

  if (read && head === 'export' && parts.length === 1) {
    const s = await sessionOf(request, env, url);
    if (!s) return fail(401, 'signed-out', 'nothing to export: this browser has no player here');
    const me = await meOf(env, s.player);
    const keys = (await env.DB.prepare('SELECT label, synced, created_at, used_at FROM player_passkeys WHERE player = ?1 ORDER BY created_at').bind(s.player.id).all()).results ?? [];
    const body = {
      v: 1, kind: 'homie-studio-player', studio: await studioName(), site: url.origin, exportedAt: new Date().toISOString(),
      player: me,
      passkeys: keys.map((k) => ({ label: k.label, synced: Number(k.synced) === 1, createdAt: new Date(Number(k.created_at)).toISOString(), lastUsedAt: new Date(Number(k.used_at)).toISOString() })),
      games: await playerData(env, s.player.id),
      // The shop (0.24.0): their orders, what they own and the age band they gave; never a card or an email.
      ...(await shopDataOf(env, s.player.id).then((x) => (x ? { shop: x } : {}))),
      // What they said in a room that keeps its chat, the Lounge too (0.29.0): each line, where and when.
      ...(await playerHistory(env, s.player.id).then((x) => (x.length ? { chat: x } : {}))),
      note: 'Everything this studio keeps about this player. A passkey\'s private key never left your device; this site keeps only its public key.',
    };
    return json(body, 200, { 'content-disposition': `attachment; filename="${s.player.id}.json"` });
  }

  if (read && head === 'passkeys' && parts.length === 1) {
    const s = await sessionOf(request, env, url);
    if (!s) return json({ ok: true, passkeys: [] });
    const keys = (await env.DB.prepare('SELECT id, label, synced, created_at, used_at FROM player_passkeys WHERE player = ?1 ORDER BY created_at').bind(s.player.id).all()).results ?? [];
    return json({ ok: true, passkeys: keys.map((k) => ({ id: k.id.slice(0, 12), label: k.label, synced: Number(k.synced) === 1, createdAt: Number(k.created_at), usedAt: Number(k.used_at) })) });
  }

  // Saves, stats and memorials of one game: GET reads, POST writes (a guest is made on the first write).
  if (head === 'saves' || head === 'stats' || (head === 'fallen' && !read)) {
    const game = await gameOf(catalogueOf, second);
    if (!game) return fail(404, 'game', 'no such game here');
    let s = await sessionOf(request, env, url);
    if (read) {
      if (head !== 'saves' && head !== 'stats') return fail(404, 'path', 'not found');
      if (s && limited(`rd:${s.player.id}`, PLAYER_LIMITS.readsPerMinute, MINUTE)) return fail(429, 'rate', 'too many reads; slow down');
      if (head === 'stats') return withCookies(json({ ok: true, game: game.id, stats: s ? await readPlayerStats(env, s.player.id, game.id) : {} }), s?.cookies);
      if (third && parts.length === 3) {
        if (!s) return json({ ok: true, key: third, value: null, version: 0, updatedAt: null });
        let key;try{key=decodeURIComponent(third);}catch{return fail(400,'key','invalid save key');}
        const r = await getSave(env, s.player.id, game.id, key);
        return withCookies(json(r, r.ok ? 200 : 400), s.cookies);
      }
      if (!s) return json({ ok: true, game: game.id, player: null, keys: [], used: { keys: 0, bytes: 0, blobBytes: 0 }, limits: SAVE_LIMITS });
      const list = await listSaves(env, s.player.id, game.id, { values: url.searchParams.get('values') === '1' });
      return withCookies(json({ ok: true, game: game.id, player: await meOf(env, s.player), ...list, limits: SAVE_LIMITS }), s.cookies);
    }
    const b = await bodyOf(request);
    if (b.error) return b.error;
    if (!s) {
      const made = await newGuest(request, env, url);
      if (made.error) return made.error;
      s = made.session;
    }
    if (limited(`wr:${s.player.id}`, PLAYER_LIMITS.writesPerMinute, MINUTE)) return withCookies(fail(429, 'rate', 'too many saves; the game should save less often'), s.cookies);
    const me = { id: s.player.id, name: s.player.name, guest: s.player.guest, owner: s.player.owner, fresh: Boolean(s.fresh) };
    if (head === 'saves' && third === 'wipe' && parts.length === 3) {
      return withCookies(json({ ...(await wipeSaves(env, s.player.id, game.id, { keep: b.body.keep })), player: me }), s.cookies);
    }
    if (head === 'saves' && parts.length === 2) {
      const r = await writeSaves(env, s.player.id, game.id, { set: b.body.set, del: b.body.del });
      return withCookies(json({ ...r, player: me }, r.ok ? 200 : 400), s.cookies);
    }
    if (head === 'stats' && parts.length === 2) {
      const r = await bumpPlayerStats(env, s.player.id, game.id, b.body);
      return withCookies(json({ ...r, player: me }, r.ok ? 200 : 400), s.cookies);
    }
    if (head === 'fallen' && parts.length === 2) {
      const c = cleanName(b.body.character, { owner: true, max: 32 });
      if (!c.ok) return withCookies(fail(400, 'character', `the fallen character needs a name (${c.message})`), s.cookies);
      const r = await fall(env, s.player.id, s.player.name, game.id, { character: c.name, summary: b.body.summary ?? {}, wipe: b.body.wipe === true, keep: b.body.keep });
      return withCookies(json({ ...r, player: me }, r.ok ? 200 : r.error === 'rate' ? 429 : 400), s.cookies);
    }
    return withCookies(fail(404, 'path', 'not found'), s.cookies);
  }

  if (read) return fail(404, 'path', 'not found');
  const b = await bodyOf(request);
  if (b.error) return b.error;
  const body = b.body ?? {};

  /* ---------------- passkey ceremonies */

  if (head === 'signup' && second === 'options' && parts.length === 2) {
    if (ceremony()) return fail(429, 'rate', 'too many tries from this address; wait a few minutes');
    const s = await sessionOf(request, env, url);
    const rp = { name: (await studioName()).slice(0, 60), id: url.hostname };
    if (s) {
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM player_passkeys WHERE player = ?1').bind(s.player.id).first();
      if (Number(count?.n) >= PLAYER_LIMITS.passkeys) return fail(409, 'passkeys', `an account keeps at most ${PLAYER_LIMITS.passkeys} passkeys; remove one first`);
      const wanted = body.name === undefined || body.name === '' ? null : cleanName(body.name, { studio: rp.name, owner: s.player.owner });
      if (wanted && !wanted.ok) return fail(400, wanted.error, wanted.message);
      const existing = (await env.DB.prepare('SELECT id FROM player_passkeys WHERE player = ?1').bind(s.player.id).all()).results ?? [];
      const challenge = await issueChallenge(env, 'add', s.player.id, { name: wanted?.name ?? null });
      const name = wanted?.name ?? s.player.name;
      return json({ ok: true, upgrade: s.player.guest, options: creationOptions(challenge, rp, s.player.id, name, existing.map((k) => k.id)) });
    }
    const wanted = body.name === undefined || body.name === '' ? null : cleanName(body.name, { studio: rp.name });
    if (wanted && !wanted.ok) return fail(400, wanted.error, wanted.message);
    const id = newPlayerId();
    const name = wanted?.name ?? handleFor(id);
    const challenge = await issueChallenge(env, 'signup', id, { name, named: Boolean(wanted) });
    return json({ ok: true, upgrade: false, options: creationOptions(challenge, rp, id, name, []) });
  }

  if (head === 'signup' && parts.length === 1) {
    const credential = body.credential;
    const s = await sessionOf(request, env, url);
    // A name typed after the options were fetched (the page fetches them ahead, so a tap reaches the prompt at once).
    const typed = body.name === undefined || body.name === '' || body.name === null ? null : cleanName(body.name, { studio: await studioName(), owner: Boolean(s?.player.owner) });
    if (typed && !typed.ok) return fail(400, typed.error, typed.message);
    const spent = await spendChallenge(env, challengeIn(credential), ['signup', 'add', 'recover']);
    if (!spent) return fail(400, 'challenge', 'that try has expired; start again');
    if (typed && spent.purpose !== 'recover') spent.data = { ...(spent.data ?? {}), name: typed.name, named: true };
    if (spent.purpose === 'add' && s?.player.id !== spent.player) return fail(403, 'session', 'sign in again, then add the passkey');
    // Options fetched before this browser's first save made it a guest: the passkey upgrades that guest.
    if (spent.purpose === 'signup' && s?.player.guest) { spent.purpose = 'add'; spent.player = s.player.id; }
    else if (spent.purpose === 'signup' && s) return fail(409, 'session', 'this browser is signed in already: reload the page');
    const v = await verifyRegistration(credential?.response ? { ...credential.response, id: credential.id } : null, { challenge: challengeIn(credential), site: url.origin, rpId: url.hostname });
    if (!v.ok) return fail(400, 'passkey', `the passkey could not be checked (${v.error})`);
    if (await env.DB.prepare('SELECT 1 AS x FROM player_passkeys WHERE id = ?1').bind(v.id).first()) return fail(409, 'known', 'that passkey already has an account here: sign in with it');
    const now = Date.now();
    const label = labelOf(body.label, request);
    const key = env.DB.prepare('INSERT INTO player_passkeys (id, player, public_key, alg, sign_count, label, synced, created_at, used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)')
      .bind(v.id, spent.player, JSON.stringify(v.jwk), v.alg, v.signCount, label, v.backedUp ? 1 : 0, now);
    if (spent.purpose === 'signup') {
      if (limited(`new:${ip}`, PLAYER_LIMITS.newPlayersPerHour, HOUR)) return fail(429, 'rate', 'too many new players from this address; try again later');
      if (await dailyCapReached(env)) return fail(503, 'busy', 'this studio has taken all the new players it takes in one day; try again tomorrow');
      const session = await mintSession(env, url, spent.player, false);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO players (id, name, named, guest, owner, created_at, seen_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?4)').bind(spent.player, spent.data?.name ?? handleFor(spent.player), spent.data?.named ? 1 : 0, now),
        key, session.statement,
      ]);
      const player = { id: spent.player, name: spent.data?.name ?? handleFor(spent.player), named: Boolean(spent.data?.named), guest: false, owner: false, since: now };
      return withCookies(json({ ok: true, made: 'account', player: await meOf(env, player) }), [session.cookie]);
    }
    const writes = [key, env.DB.prepare('UPDATE players SET guest = 0, seen_at = ?2 WHERE id = ?1').bind(spent.player, now)];
    if (spent.data?.name) writes.push(env.DB.prepare('UPDATE players SET name = ?2, named = 1 WHERE id = ?1').bind(spent.player, spent.data.name));
    const cookies = [];
    if (spent.purpose === 'recover') {
      // A recovery link proved the email; the old sessions end, and this browser signs in.
      writes.push(env.DB.prepare("DELETE FROM player_sessions WHERE player = ?1 AND kind = 'session'").bind(spent.player));
      const session = await mintSession(env, url, spent.player, false);
      writes.push(session.statement);
      cookies.push(session.cookie);
    } else if (s?.player.guest) {
      // The guest's session becomes an account's: same token, an account's lifetime.
      writes.push(env.DB.prepare('UPDATE player_sessions SET expires_at = ?2 WHERE hash = ?1').bind(s.hash, now + PLAYER_LIMITS.sessionDays * DAY));
      cookies.push(sessionCookie(url, s.token, PLAYER_LIMITS.sessionDays));
    }
    await env.DB.batch(writes);
    const p = await env.DB.prepare('SELECT id, name, named, guest, owner, created_at FROM players WHERE id = ?1').bind(spent.player).first();
    if (!p) return fail(404, 'unknown', 'that account is gone');
    return withCookies(json({ ok: true, made: spent.purpose === 'recover' ? 'recovered' : s?.player.guest ? 'upgraded' : 'passkey', player: await meOf(env, { id: p.id, name: p.name, named: Number(p.named) === 1, guest: false, owner: Number(p.owner) === 1, since: Number(p.created_at) }) }), cookies);
  }

  if (head === 'signin' && second === 'options' && parts.length === 2) {
    if (ceremony()) return fail(429, 'rate', 'too many tries from this address; wait a few minutes');
    const challenge = await issueChallenge(env, 'signin');
    // No allowCredentials: the device offers whichever passkey it holds for this site (a discoverable credential).
    return json({ ok: true, options: { challenge, rpId: url.hostname, userVerification: 'preferred', timeout: PLAYER_LIMITS.challengeMinutes * MINUTE } });
  }

  if (head === 'signin' && parts.length === 1) {
    const credential = body.credential;
    const spent = await spendChallenge(env, challengeIn(credential), ['signin']);
    if (!spent) return fail(400, 'challenge', 'that try has expired; start again');
    if (!CRED_ID.test(String(credential?.id ?? ''))) return fail(400, 'passkey', 'that is not a passkey');
    const key = await env.DB.prepare('SELECT k.id, k.player, k.public_key, k.alg, k.sign_count, p.name, p.named, p.owner, p.created_at FROM player_passkeys k JOIN players p ON p.id = k.player WHERE k.id = ?1').bind(credential.id).first();
    // The same answer for "no such passkey" and "a bad signature": neither tells a stranger which passkeys exist.
    const refused = fail(401, 'unknown', 'this passkey is not an account here (it may have been deleted); make an account instead');
    if (!key) return refused;
    const v = await verifyAssertion(credential.response, { alg: key.alg, jwk: key.public_key, signCount: key.sign_count }, { challenge: challengeIn(credential), site: url.origin, rpId: url.hostname });
    if (!v.ok) return v.error === 'counter' ? fail(401, 'counter', 'this passkey looks copied; sign in with another one') : refused;
    const now = Date.now();
    const current = await sessionOf(request, env, url);
    const session = await mintSession(env, url, key.player, false);
    const writes = [
      env.DB.prepare('UPDATE player_passkeys SET sign_count = ?2, used_at = ?3 WHERE id = ?1').bind(key.id, v.signCount, now),
      env.DB.prepare('UPDATE players SET seen_at = ?2 WHERE id = ?1').bind(key.player, now),
      session.statement,
    ];
    let adopted = null;
    if (current && current.player.id !== key.player) {
      writes.push(env.DB.prepare('DELETE FROM player_sessions WHERE hash = ?1').bind(current.hash));
      // A guest signing in to their account: what only the guest had moves over, then the guest is gone.
      if (current.player.guest) {
        adopted = await adoptStatements(env, current.player.id, key.player);
        writes.push(...adopted.statements, ...(await adoptShopStatements(env, current.player.id, key.player)),
          env.DB.prepare('DELETE FROM player_sessions WHERE player = ?1').bind(current.player.id),
          env.DB.prepare('DELETE FROM player_challenges WHERE player = ?1').bind(current.player.id),
          env.DB.prepare('DELETE FROM players WHERE id = ?1 AND guest = 1').bind(current.player.id));
      }
    }
    await env.DB.batch(writes);
    if (adopted) await adopted.after();
    const player = { id: key.player, name: key.name, named: Number(key.named) === 1, guest: false, owner: Number(key.owner) === 1, since: Number(key.created_at) };
    return withCookies(json({ ok: true, player: await meOf(env, player), adoptedGuest: Boolean(adopted) }), [session.cookie]);
  }

  /* ---------------- a recovery email, signed out: the link in the mail is the proof */

  if (head === 'recover' || (head === 'email' && second === 'verify')) {
    if (!f.email) return fail(404, 'no-email', 'this studio has no mail sender, so no recovery email: sign in with a passkey your device synced, or another passkey you added');
    if (head === 'email') {
      const spent = await spendChallenge(env, String(body.k ?? ''), ['email-verify']);
      if (!spent) return fail(400, 'link', 'that link has been used or has expired');
      await env.DB.prepare('UPDATE player_emails SET verified_at = ?3 WHERE player = ?1 AND email = ?2').bind(spent.player, spent.data?.email ?? '', Date.now()).run();
      return json({ ok: true, verified: true });
    }
    if (second === 'options' && parts.length === 2) {
      if (ceremony()) return fail(429, 'rate', 'too many tries from this address; wait a few minutes');
      const spent = await spendChallenge(env, String(body.k ?? ''), ['recover-link']);
      if (!spent) return fail(400, 'link', 'that link has been used or has expired; ask for a new one');
      const p = await env.DB.prepare('SELECT id, name FROM players WHERE id = ?1').bind(spent.player).first();
      if (!p) return fail(404, 'unknown', 'that account is gone');
      const existing = (await env.DB.prepare('SELECT id FROM player_passkeys WHERE player = ?1').bind(p.id).all()).results ?? [];
      const challenge = await issueChallenge(env, 'recover', p.id, null);
      return json({ ok: true, options: creationOptions(challenge, { name: (await studioName()).slice(0, 60), id: url.hostname }, p.id, p.name, existing.map((k) => k.id)) });
    }
    if (parts.length !== 1) return fail(404, 'path', 'not found');
    const email = emailOf(body.email);
    if (!email) return fail(400, 'email', 'that is not an email address');
    if (limited(`mail:${ip}`, PLAYER_LIMITS.mailsPerHour, HOUR) || limited(`mailto:${email}`, 3, HOUR)) return fail(429, 'rate', 'too many emails asked for; try again in an hour');
    const owner = await env.DB.prepare('SELECT player FROM player_emails WHERE email = ?1 AND verified_at IS NOT NULL').bind(email).first();
    // The same answer either way: whether an address has an account here is nobody else's business.
    const answer = json({ ok: true, message: 'If that address belongs to an account here, a link is on its way. It works once, for 30 minutes.' });
    if (!owner) return answer;
    const k = await issueChallenge(env, 'recover-link', owner.player, null, PLAYER_LIMITS.linkMinutes);
    await sendMail(env, email, `Sign in to ${await studioName()}`, `Someone (hopefully you) asked to get back into your player account on ${await studioName()}.\n\nOpen this link on the device you want to use, and make a new passkey there:\n${url.origin}/account/?do=recover&k=${k}\n\nIt works once, for 30 minutes. If you did not ask, ignore this email: nothing changes.\n`).catch(() => {});
    return answer;
  }

  /* ---------------- signed-in only */

  const s = await sessionOf(request, env, url);

  if (head === 'signout' && parts.length === 1) {
    if (s) await env.DB.prepare('DELETE FROM player_sessions WHERE hash = ?1').bind(s.hash).run();
    return withCookies(json({ ok: true, player: null }), [clearCookie(url)]);
  }
  if (!s) return fail(401, 'signed-out', 'this browser has no player here: sign in first');

  if (head === 'name' && parts.length === 1) {
    const c = cleanName(body.name, { studio: await studioName(), owner: s.player.owner });
    if (!c.ok) return withCookies(fail(400, c.error, c.message), s.cookies);
    await env.DB.prepare('UPDATE players SET name = ?2, named = 1 WHERE id = ?1').bind(s.player.id, c.name).run();
    return withCookies(json({ ok: true, player: await meOf(env, { ...s.player, name: c.name, named: true }), cut: c.cut }), s.cookies);
  }

  if (head === 'passkeys' && second === 'remove' && parts.length === 2) {
    const prefix = String(body.id ?? '');
    if (!/^[A-Za-z0-9_-]{8,1400}$/.test(prefix)) return fail(400, 'passkey', 'which passkey?');
    const keys = (await env.DB.prepare('SELECT id FROM player_passkeys WHERE player = ?1').bind(s.player.id).all()).results ?? [];
    const match = keys.filter((k) => k.id.startsWith(prefix));
    if (match.length !== 1) return fail(404, 'passkey', 'no such passkey on this account');
    if (keys.length === 1) return fail(409, 'last-passkey', 'this is the account\'s only passkey: add another first, or delete the account');
    await env.DB.prepare('DELETE FROM player_passkeys WHERE id = ?1 AND player = ?2').bind(match[0].id, s.player.id).run();
    return withCookies(json({ ok: true, removed: match[0].id }), s.cookies);
  }

  if (head === 'pass' && parts.length === 1) {
    if (limited(`pass:${s.player.id}`, 30, HOUR)) return fail(429, 'rate', 'too many passes; one lasts ten minutes');
    if (body.game !== undefined && !(await gameOf(catalogueOf, body.game))) return fail(404, 'game', 'no such game here');
    return withCookies(json({ ok: true, pass: await players.passFor(env, s.player.id, { game: body.game ?? null }), minutes: PLAYER_LIMITS.passMinutes }), s.cookies);
  }

  if (head === 'owner' && parts.length === 1) {
    if (s.player.guest) return fail(403, 'guest', 'make an account (a passkey) first: the owner\'s account must be one they can sign in to');
    const k = String(body.k ?? '');
    if (!OWNER_KEY.test(k)) return fail(400, 'link', 'that owner link is not one');
    const row = await env.DB.prepare("DELETE FROM stats_keys WHERE hash = ?1 AND kind = 'player-owner' RETURNING expires_at").bind(await sha256Hex(k)).first();
    if (!row || Number(row.expires_at) <= Date.now()) return fail(403, 'link', 'that owner link has been used or has expired; ask your AI for a new one: npx --no-install homie-studio players owner');
    await env.DB.prepare('UPDATE players SET owner = 1 WHERE id = ?1').bind(s.player.id).run();
    return withCookies(json({ ok: true, player: await meOf(env, { ...s.player, owner: true }) }), s.cookies);
  }

  if (head === 'delete' && parts.length === 1) {
    if (body.confirm !== 'delete') return fail(400, 'confirm', 'send { "confirm": "delete" } to delete this player and everything they kept');
    // Things they bought go with the account: say so first (the shop, 0.24.0).
    const owned = await livePurchases(env, s.player.id).catch(() => 0);
    if (owned && body.purchases !== 'forfeit') return fail(409, 'purchases', `This account owns ${owned} thing${owned === 1 ? '' : 's'} bought here; deleting it gives ${owned === 1 ? 'it' : 'them'} up for good (an unused item can be refunded first, from this page). Send { "confirm": "delete", "purchases": "forfeit" } to delete anyway.`, { owned });
    await removePlayer(env, s.player.id);
    return withCookies(json({ ok: true, deleted: s.player.id }), [clearCookie(url)]);
  }

  /* ---------------- a recovery email (only with a mail sender: PLAYER_MAIL + PLAYER_MAIL_FROM) */

  if (head === 'email') {
    if (!f.email) return fail(404, 'no-email', 'this studio has no mail sender, so no recovery email');
    if (second === 'remove' && parts.length === 2) {
      await env.DB.prepare('DELETE FROM player_emails WHERE player = ?1').bind(s.player.id).run();
      return withCookies(json({ ok: true, player: await meOf(env, s.player) }), s.cookies);
    }
    if (parts.length !== 1) return fail(404, 'path', 'not found');
    if (s.player.guest) return fail(403, 'guest', 'make an account (a passkey) first; the email is how that account comes back');
    const email = emailOf(body.email);
    if (!email) return fail(400, 'email', 'that is not an email address');
    if (limited(`mail:${ip}`, PLAYER_LIMITS.mailsPerHour, HOUR) || limited(`mailp:${s.player.id}`, 3, HOUR)) return fail(429, 'rate', 'too many emails asked for; try again in an hour');
    await env.DB.prepare('INSERT INTO player_emails (player, email, verified_at, added_at) VALUES (?1, ?2, NULL, ?3) ON CONFLICT(player) DO UPDATE SET email = excluded.email, verified_at = NULL, added_at = excluded.added_at').bind(s.player.id, email, Date.now()).run();
    const k = await issueChallenge(env, 'email-verify', s.player.id, { email }, PLAYER_LIMITS.linkMinutes);
    try {
      await sendMail(env, email, `Confirm your recovery email for ${await studioName()}`, `Confirm this address for your player account on ${await studioName()}, so you can get back in if you lose your passkeys:\n${url.origin}/account/?do=verify&k=${k}\n\nIt works once, for 30 minutes. If this was not you, ignore it.\n`);
    } catch (error) {
      return fail(502, 'mail', `the email could not be sent (${String(error?.message ?? error).slice(0, 80)})`);
    }
    return withCookies(json({ ok: true, sent: true, player: await meOf(env, s.player) }), s.cookies);
  }

  return fail(404, 'path', 'not found');
}

/** An email address to keep or look up: trimmed, lowercased, or null. */
function emailOf(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** Cloudflare Email Service (a `send_email` binding named PLAYER_MAIL, and PLAYER_MAIL_FROM on a domain it sends for). */
async function sendMail(env, to, subject, text) {
  await env.PLAYER_MAIL.send({ from: env.PLAYER_MAIL_FROM, to, subject, text });
}

/** navigator.credentials.create options (JSON-safe: the browser script turns the base64url fields into bytes). */
function creationOptions(challenge, rp, playerId, name, exclude) {
  return {
    challenge, rp,
    user: { id: bytesToB64url(new TextEncoder().encode(playerId)), name, displayName: name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    attestation: 'none',
    timeout: PLAYER_LIMITS.challengeMinutes * MINUTE,
    excludeCredentials: exclude.map((id) => ({ type: 'public-key', id })),
  };
}
