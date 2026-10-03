/**
 * THE LOUNGE AND KEPT CHAT IN THE STUDIO'S OWN D1 (@homie-rocks/studio 0.29.0, chat/LOUNGE.md).
 *
 *   chat_history   what was said in a room whose owner turned `history` on (a number of days; off for every game by
 *                  default, never on a kids server): typed lines, quick lines, show-what-you-made cards and the
 *                  studio's own lines. Never a reaction, never an address, never a browser key. A signed-in person's
 *                  account id is kept with their line, so they can take it down themselves and deleting their account
 *                  takes every line of theirs with it. Forgotten after the room's `history` days.
 *   lounge_nights  the play nights the owner sets in the office: a title, when (UTC), how long, a note and a game.
 *   lounge_mods    the player accounts the owner trusts to keep the Lounge kind: Remove, Mute, Kick and slow mode.
 *
 * The room keeps the window in memory as always (worker/room.mjs); this is only the longer memory an owner asked for.
 */

export const LOUNGE_MIGRATION_FILE = '0009_studio_lounge.sql';
export const LOUNGE_MIGRATION = `-- The Lounge and kept chat (@homie-rocks/studio 0.29.0): what was said in a room whose owner turned history on (never a
-- reaction, an address or a browser key; a signed-in sender's account id so they can remove it), the play nights the
-- owner sets, and the moderators the owner names. Kept chat is forgotten after the room's history days.
CREATE TABLE IF NOT EXISTS chat_history (
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  src TEXT NOT NULL,
  text TEXT,
  say TEXT,
  card TEXT,
  player TEXT,
  acct INTEGER NOT NULL DEFAULT 0,
  owner INTEGER NOT NULL DEFAULT 0,
  mod INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, room, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_history_at ON chat_history (game, room, at);
CREATE INDEX IF NOT EXISTS chat_history_player ON chat_history (player);
CREATE TABLE IF NOT EXISTS lounge_nights (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  note TEXT,
  game TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lounge_nights_at ON lounge_nights (starts_at);
CREATE TABLE IF NOT EXISTS lounge_mods (
  player TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
) WITHOUT ROWID;
`;

/** The Lounge's room: one Table for the whole studio, under a game id no game can have (game ids start a-z or 0-9). */
export const LOUNGE_GAME = '_lounge';
export const LOUNGE_ROOM = 'lounge';
export const LOUNGE_LIMITS = Object.freeze({ nights: 24, title: 80, note: 200, minMinutes: 15, maxMinutes: 720, mods: 50, page: 50, show: 3 });
const DAY = 86_400_000;
const ID = /^[A-Za-z0-9_-]{1,16}$/;
const PLAYER = /^[A-Za-z0-9_-]{1,64}$/;
const oneLine = (v, max) => [...String(v ?? '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();

function randomHex(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ kept chat */

/** Whether a message is the kind a room keeps: what people said and the studio's own lines, never a reaction. */
export const keptKind = (rec) => rec && ['text', 'line', 'card', 'studio'].includes(rec.kind);

/** One message as chat_history keeps it (a card's JSON is its link, title, studio, pitch and picture, nothing else). */
function rowOf(game, room, rec) {
  const card = rec.card && typeof rec.card === 'object' ? JSON.stringify({ url: rec.card.url, title: rec.card.title, studio: rec.card.studio, pitch: rec.card.pitch ?? '', image: rec.card.image ?? null, game: rec.card.game ?? null }) : null;
  return [game, room, rec.id, Math.floor(Number(rec.at) || Date.now()), rec.kind, oneLine(rec.name, 40) || 'Someone', rec.by ?? 'player',
    rec.text === undefined || rec.text === null ? null : String(rec.text).slice(0, 600), rec.say ?? null, card,
    rec.from?.player ?? rec.player ?? null, rec.acct ? 1 : 0, rec.owner ? 1 : 0, rec.mod ? 1 : 0];
}

/** Keep messages a room published (a batch of up to 20 at once). */
export async function keepLines(env, game, room, recs) {
  const list = (recs ?? []).filter(keptKind).slice(0, 20);
  if (!env?.DB || !list.length) return 0;
  await env.DB.batch(list.map((rec) => env.DB.prepare(`INSERT INTO chat_history (game, room, id, at, kind, name, src, text, say, card, player, acct, owner, mod)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) ON CONFLICT(game, room, id) DO NOTHING`).bind(...rowOf(game, room, rec))));
  return list.length;
}

/** Messages taken down (by the owner, a moderator, a mute or kick that took their lines, or their own sender). */
export async function forgetLines(env, game, room, ids) {
  const list = (ids ?? []).filter((x) => typeof x === 'string' && ID.test(x)).slice(0, 64);
  if (!env?.DB || !list.length) return 0;
  const marks = list.map((_, i) => `?${i + 3}`).join(', ');
  const r = await env.DB.prepare(`DELETE FROM chat_history WHERE game = ?1 AND room = ?2 AND id IN (${marks})`).bind(game, room, ...list).run();
  return Number(r?.meta?.changes ?? 0);
}

/** A kept message as the room holds it again (its sender's account in `from`, so a mute or a kick from it still holds). */
export function recOf(r) {
  let card = null;
  try { card = r.card ? JSON.parse(r.card) : null; } catch { card = null; }
  return {
    id: r.id, at: Number(r.at), kind: r.kind, name: r.name, seat: null, colour: null, by: r.src,
    ...(r.text !== null && r.text !== undefined ? { text: r.text } : {}), ...(r.say ? { say: r.say } : {}), ...(card ? { card } : {}),
    bubble: false, acct: Number(r.acct) === 1, owner: Number(r.owner) === 1, ...(Number(r.mod) === 1 ? { mod: true } : {}),
    from: { client: null, token: null, browser: null, player: r.player ?? null }, kept: true,
  };
}

/**
 * What a room kept: the newest `limit` of the last `days`, oldest first; `before` (a time) pages back. Expired rows are
 * deleted on the way (the room's own days, so a shorter history forgets at once).
 */
export async function historyOf(env, game, room, { days, before = null, limit = LOUNGE_LIMITS.page, now = Date.now() } = {}) {
  if (!env?.DB || !(days > 0)) return [];
  const since = now - days * DAY;
  await env.DB.prepare('DELETE FROM chat_history WHERE game = ?1 AND room = ?2 AND at < ?3').bind(game, room, since).run().catch(() => {});
  const n = Math.max(1, Math.min(LOUNGE_LIMITS.page, Math.floor(Number(limit) || LOUNGE_LIMITS.page)));
  const q = Number.isFinite(Number(before)) && before !== null
    ? env.DB.prepare('SELECT * FROM chat_history WHERE game = ?1 AND room = ?2 AND at >= ?3 AND at < ?4 ORDER BY at DESC LIMIT ?5').bind(game, room, since, Number(before), n)
    : env.DB.prepare('SELECT * FROM chat_history WHERE game = ?1 AND room = ?2 AND at >= ?3 ORDER BY at DESC LIMIT ?4').bind(game, room, since, n);
  const { results } = await q.all();
  return (results ?? []).map(recOf).reverse();
}

/** One kept message (a report about a line older than the room's window). */
export async function keptLine(env, game, room, id) {
  if (!env?.DB || !ID.test(String(id ?? ''))) return null;
  try { const r = await env.DB.prepare('SELECT * FROM chat_history WHERE game = ?1 AND room = ?2 AND id = ?3').bind(game, room, id).first(); return r ? recOf(r) : null; } catch { return null; }
}

/** The owner shortened a game's history (or turned it off: 0): what is older than that goes now, in every room of it. */
export async function trimHistory(env, game, days, now = Date.now()) {
  if (!env?.DB) return 0;
  const r = await env.DB.prepare('DELETE FROM chat_history WHERE game = ?1 AND at < ?2').bind(game, days > 0 ? now - days * DAY : now + 1).run();
  return Number(r?.meta?.changes ?? 0);
}

/** A player deleted their account: every line they said in any room goes with it. */
export async function forgetPlayerHistory(env, player) {
  if (!env?.DB || !PLAYER.test(String(player ?? ''))) return 0;
  try { const r = await env.DB.prepare('DELETE FROM chat_history WHERE player = ?1').bind(player).run(); return Number(r?.meta?.changes ?? 0); } catch { return 0; }
}

/** The lines one player kept here (their account page's export). */
export async function playerHistory(env, player) {
  if (!env?.DB || !PLAYER.test(String(player ?? ''))) return [];
  try {
    const { results } = await env.DB.prepare('SELECT game, room, id, at, kind, text, say, card FROM chat_history WHERE player = ?1 ORDER BY at DESC LIMIT 1000').bind(player).all();
    return (results ?? []).map((r) => ({ game: r.game, room: r.room, id: r.id, at: Number(r.at), kind: r.kind, text: r.text ?? null, say: r.say ?? null, card: r.card ? JSON.parse(r.card) : null }));
  } catch { return []; }
}

/* ------------------------------------------------------------------ play nights */

/** A play night as the owner typed it: `{ ok, night }` or `{ ok: false, message }`. `at` is an ISO time or epoch ms. */
export function checkNight(body, { now = Date.now() } = {}) {
  const bad = (message) => ({ ok: false, error: 'bad-request', message });
  const b = body && typeof body === 'object' ? body : {};
  const title = oneLine(b.title, LOUNGE_LIMITS.title);
  if (!title) return bad('title is what the night is, in a few words ("Night Rush night")');
  const at = typeof b.at === 'number' ? b.at : Date.parse(String(b.at ?? ''));
  if (!Number.isFinite(at)) return bad('at is when it starts: an ISO time with its zone (2026-10-09T19:00:00-07:00) or UTC (…Z)');
  if (at < now - 12 * 3600_000) return bad('that time has passed');
  if (at > now + 366 * DAY) return bad('a play night within the next year');
  const minutes = b.minutes === undefined || b.minutes === null ? 120 : Math.floor(Number(b.minutes));
  if (!(minutes >= LOUNGE_LIMITS.minMinutes && minutes <= LOUNGE_LIMITS.maxMinutes)) return bad(`minutes is how long it lasts, ${LOUNGE_LIMITS.minMinutes} to ${LOUNGE_LIMITS.maxMinutes}`);
  const note = oneLine(b.note, LOUNGE_LIMITS.note) || null;
  const game = b.game === undefined || b.game === null || b.game === '' ? null : String(b.game);
  if (game && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(game) && !/^https:\/\/[^\s]{4,300}$/.test(game)) return bad('game is one of this studio\'s game ids, or the https link to a game of another studio');
  return { ok: true, night: { title, at, minutes, note, game } };
}

export async function addNight(env, night) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM lounge_nights WHERE starts_at + minutes * 60000 >= ?1').bind(Date.now()).all();
  if (Number(results?.[0]?.n ?? 0) >= LOUNGE_LIMITS.nights) return { ok: false, error: 'too-many', message: `At most ${LOUNGE_LIMITS.nights} play nights ahead at once.` };
  const id = `pn_${randomHex(6)}`;
  await env.DB.prepare('INSERT INTO lounge_nights (id, title, starts_at, minutes, note, game, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(id, night.title, night.at, night.minutes, night.note, night.game, Date.now()).run();
  return { ok: true, id };
}

export async function removeNight(env, id) {
  if (!/^pn_[a-f0-9]{12}$/.test(String(id ?? ''))) return { ok: false, error: 'bad-request', message: 'id is the play night\'s id' };
  const r = await env.DB.prepare('DELETE FROM lounge_nights WHERE id = ?1').bind(id).run();
  return { ok: Number(r?.meta?.changes ?? 0) > 0, removed: Number(r?.meta?.changes ?? 0), ...(Number(r?.meta?.changes ?? 0) ? {} : { error: 'no-night', message: 'No such play night.' }) };
}

/** The play nights still to come (or on now), soonest first; past ones are deleted on the way. */
export async function nightsOf(env, { now = Date.now(), limit = 6 } = {}) {
  if (!env?.DB) return [];
  try {
    await env.DB.prepare('DELETE FROM lounge_nights WHERE starts_at + minutes * 60000 < ?1').bind(now - DAY).run().catch(() => {});
    const { results } = await env.DB.prepare('SELECT * FROM lounge_nights WHERE starts_at + minutes * 60000 >= ?1 ORDER BY starts_at ASC LIMIT ?2').bind(now, Math.max(1, Math.min(LOUNGE_LIMITS.nights, limit))).all();
    return (results ?? []).map((r) => ({ id: r.id, title: r.title, at: Number(r.starts_at), minutes: Number(r.minutes), note: r.note ?? null, game: r.game ?? null, on: Number(r.starts_at) <= now }));
  } catch { return []; }
}

/* ------------------------------------------------------------------ moderators */

export async function modsOf(env) {
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare('SELECT m.player, m.added_at, p.name, p.guest FROM lounge_mods m LEFT JOIN players p ON p.id = m.player ORDER BY m.added_at ASC LIMIT ?1').bind(LOUNGE_LIMITS.mods).all();
    return (results ?? []).map((r) => ({ player: r.player, name: r.name ?? null, account: r.name !== null && r.name !== undefined && Number(r.guest) === 0, addedAt: Number(r.added_at) }));
  } catch { return []; }
}

export async function isMod(env, player) {
  if (!env?.DB || !PLAYER.test(String(player ?? ''))) return false;
  try { return Boolean(await env.DB.prepare('SELECT 1 AS y FROM lounge_mods WHERE player = ?1').bind(player).first()); } catch { return false; }
}

/** A moderator must be a player account with a passkey (a guest cannot be trusted with other people's words). */
export async function addMod(env, player) {
  if (!PLAYER.test(String(player ?? ''))) return { ok: false, error: 'bad-request', message: 'player is the player\'s id (the office lists them)' };
  const p = await env.DB.prepare('SELECT id, name, guest FROM players WHERE id = ?1').bind(player).first().catch(() => null);
  if (!p) return { ok: false, error: 'no-player', message: 'No player with that id here.' };
  if (Number(p.guest) !== 0) return { ok: false, error: 'guest', message: `${p.name} is a guest: a moderator needs an account with a passkey.` };
  const n = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM lounge_mods').first())?.n ?? 0);
  if (n >= LOUNGE_LIMITS.mods) return { ok: false, error: 'too-many', message: `At most ${LOUNGE_LIMITS.mods} moderators.` };
  await env.DB.prepare('INSERT OR IGNORE INTO lounge_mods (player, added_at) VALUES (?1, ?2)').bind(player, Date.now()).run();
  return { ok: true, player, name: p.name };
}

export async function removeMod(env, player) {
  if (!PLAYER.test(String(player ?? ''))) return { ok: false, error: 'bad-request', message: 'player is the player\'s id' };
  const r = await env.DB.prepare('DELETE FROM lounge_mods WHERE player = ?1').bind(player).run();
  return { ok: true, removed: Number(r?.meta?.changes ?? 0) };
}

/* ------------------------------------------------------------------ the Lounge's own rules (pure; the build reads them too) */

/** The Lounge's quick lines: short, kind, fine for every age (each passes the chat floor). */
export const LOUNGE_LINES = Object.freeze({ hi: 'Hi all!', welcome: 'Welcome in!', nice: 'Nice one!', making: 'What are you making?', in: 'Count me in!', gg: 'Good game!', soon: 'Back soon!', thanks: 'Thanks!' });

/**
 * The Lounge's chat before its owner changes anything (the office, `homie-studio lounge`): reactions and quick lines for
 * anyone, typing for signed-in players (a passkey), a slower pace than a game's, links held (a card is how to show a
 * game), every typed line reviewed, nothing kept past the room's few minutes until the owner turns history on, and
 * homie.rocks may show it live (its visitors react; typing stays here).
 */
export const LOUNGE_CHAT = Object.freeze({ mode: 'text', who: 'signed-in', react: 'anyone', slow: 3, max: 280, links: 'block', swears: 'block', ai: true, bubbles: false, watchers: true, hub: true, history: 0, lines: LOUNGE_LINES });
export const LOUNGE_FEATURED = Object.freeze(['directory', 'studio', 'none']);
export const LOUNGE_DEFAULT_BLURB = 'Play nights, demos and what everybody is making. Come and say hi.';

/**
 * studio.json "lounge" as the build keeps it: `true`, or `{ name, tab, blurb, kids, featured, chat }`; null when it is
 * off or a game already has /lounge/. `kids` follows a studio made for children ("audience": "kids") unless it says.
 */
export function loungeConfig(studio, games = [], { audience = 'general' } = {}) {
  const raw = studio?.lounge;
  if (!raw) return null;
  if ((games ?? []).some((g) => g.id === 'lounge')) return null;
  const o = raw === true ? {} : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o || o.on === false) return null;
  const name = oneLine(o.name, 40) || 'The Lounge';
  const tab = oneLine(o.tab, 16) || 'Lounge';
  const blurb = oneLine(o.blurb, 200) || LOUNGE_DEFAULT_BLURB;
  const kids = o.kids === undefined ? audience === 'kids' : o.kids === true;
  const featured = LOUNGE_FEATURED.includes(o.featured) ? o.featured : 'directory';
  const chat = o.chat && typeof o.chat === 'object' && !Array.isArray(o.chat) ? o.chat : null;
  return { name, tab, blurb, kids, featured, ...(chat ? { chat } : {}) };
}

/** studio.json "lounge" as the build checks it: the problems in words. */
export function loungeProblems(studio, games = [], chatProblems = () => []) {
  const raw = studio?.lounge;
  if (raw === undefined || raw === false || raw === null) return [];
  const out = [];
  if ((games ?? []).some((g) => g.id === 'lounge')) out.push('a game is called "lounge" and has the page /lounge/, so the Lounge is off: rename the game, or leave "lounge" out');
  if (raw !== true && (typeof raw !== 'object' || Array.isArray(raw))) return [...out, '"lounge" is true, or { "name", "blurb", "kids", "featured", "chat" }'];
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) if (!['on', 'name', 'tab', 'blurb', 'kids', 'featured', 'chat'].includes(k)) out.push(`lounge.${k} is not a field (name, tab, blurb, kids, featured, chat)`);
    if (raw.featured !== undefined && !LOUNGE_FEATURED.includes(raw.featured)) out.push(`lounge.featured is ${LOUNGE_FEATURED.join(', ')}`);
    if (raw.chat !== undefined) for (const p of chatProblems(raw.chat)) out.push(p.replace(/^chat\./, 'lounge.chat.'));
  }
  return out.slice(0, 8);
}
