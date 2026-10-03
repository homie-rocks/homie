/**
 * ROOM CHAT IN THE STUDIO'S OWN D1 (@homie-rocks/studio 0.23.0, NETPLAY.md section 19): the owner's chat rules per game
 * and per server, and the reports players make. Never the chat itself: what people say lives a few minutes in the
 * room's memory and nowhere else (worker/room.mjs). A report keeps the one message it is about, for 30 days.
 *
 *   chat_rules    (game, server, rules JSON, updated_at): server '' is the whole game; a server's row wins over it
 *   chat_reports  one reported message: its words, its sender's room name and (when signed in) account id, the room,
 *                 the reason a player picked, when; never who reported it, never an address
 */
import { CHAT_BUDGET, composeChat } from './chat.mjs';

export const CHAT_MIGRATION_FILE = '0007_studio_chat.sql';
export const CHAT_MIGRATION = `-- Room chat (@homie-rocks/studio 0.23.0): the owner's chat rules per game and per server, and players' reports.
-- The chat itself is never stored: it lives a few minutes in the room's memory. A report keeps only the message it
-- is about (its words, its sender's room name and account id if they had one, the room), for 30 days; never who
-- reported it, never an address.
CREATE TABLE IF NOT EXISTS chat_rules (
  game TEXT NOT NULL,
  server TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, server)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  line TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sender_name TEXT,
  sender_player TEXT,
  sender_seat INTEGER,
  said_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_reports_game ON chat_reports (game, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_line ON chat_reports (game, room, line);
`;

/** Why a player reports a message: a short list, so a report is never a second message. */
export const REPORT_REASONS = Object.freeze(['mean', 'hate', 'sexual', 'unsafe', 'spam', 'other']);
export const REPORT_WORDS = Object.freeze({ mean: 'Mean or bullying', hate: 'Hate or a slur', sexual: 'Sexual', unsafe: 'Asks for personal details, or unsafe', spam: 'Spam or ads', other: 'Something else' });
export const REPORT_DAYS = 30;

const cache = new WeakMap();
/** Every chat rule row (D1), read at most every 5 s per Worker instance; empty before migration 0007. */
export async function chatRowsOf(env, { fresh = false } = {}) {
  if (!env?.DB || env.HOMIE_PREVIEW === '1') return new Map();
  const hit = cache.get(env.DB);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit.map;
  let map = new Map();
  try {
    const { results } = await env.DB.prepare('SELECT game, server, rules, updated_at FROM chat_rules LIMIT 1000').all();
    for (const r of results ?? []) {
      let rules = null;
      try { rules = JSON.parse(r.rules); } catch { rules = null; }
      if (rules && typeof rules === 'object') map.set(`${r.game}/${r.server ?? ''}`, { ...rules, at: Number(r.updated_at) || 0 });
    }
  } catch { map = new Map(); }
  cache.set(env.DB, { at: Date.now(), map });
  return map;
}
export const forgetChat = (env) => { if (env?.DB) cache.delete(env.DB); };

/**
 * A room's chat rules: the game's game.json "chat", the owner's rules for the game, then for this server (a server's
 * own game.json seed `chat` sits under the owner's), capped by the server's speech and kids.
 */
export function chatOf(meta, server, rows) {
  const game = meta?.chat === false ? { mode: 'off' } : meta?.chat;
  const own = rows?.get(`${meta?.id}/`) ?? null;
  const seed = server?.chat && typeof server.chat === 'object' ? server.chat : null;
  const srv = server && server.id !== 'public' ? rows?.get(`${meta?.id}/${server.id}`) ?? null : rows?.get(`${meta?.id}/public`) ?? null;
  return composeChat({ game, office: own, server: srv ?? seed, kids: Boolean(server?.kids), speech: server?.speech ?? 'game' });
}

/** The owner's change: merged into the game's (server '') or one server's row. Returns the stored rules. */
export async function writeChatRules(env, game, server, fields) {
  const key = String(server ?? '');
  const row = await env.DB.prepare('SELECT rules FROM chat_rules WHERE game = ?1 AND server = ?2').bind(game, key).first();
  let before = {};
  try { before = row ? JSON.parse(row.rules) : {}; } catch { before = {}; }
  const next = { ...before, ...fields };
  for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k];
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO chat_rules (game, server, rules, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(game, server) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at`).bind(game, key, JSON.stringify(next), now).run();
  forgetChat(env);
  return { rules: next, at: now };
}

/** Back to the game's own rules: the owner's row for the game or a server goes. */
export async function clearChatRules(env, game, server) {
  await env.DB.prepare('DELETE FROM chat_rules WHERE game = ?1 AND server = ?2').bind(game, String(server ?? '')).run();
  forgetChat(env);
}

function randomHex(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A player's report of one message (the room's own copy of it, never the reporter's words). Once per message. */
export async function fileReport(env, { game, room, line, reason }) {
  const now = Date.now();
  const id = `cr_${randomHex(8)}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO chat_reports (id, game, room, line, kind, text, sender_name, sender_player, sender_seat, said_at, reason, state, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'open', ?12, ?13) ON CONFLICT(game, room, line) DO NOTHING`)
      .bind(id, game, room, line.id, line.kind, String(line.text ?? line.glyph ?? '').slice(0, 300), String(line.name ?? '').slice(0, 40), line.player ?? null, Number.isInteger(line.seat) ? line.seat : null, Number(line.at) || now, reason, now, now + REPORT_DAYS * 86_400_000),
    // Reports older than 30 days go (a report is about one moment; the owner acts on it or lets it go).
    env.DB.prepare('DELETE FROM chat_reports WHERE expires_at < ?1').bind(now),
  ]);
  return { id };
}

/** The open reports, newest first (the office's list); `game` narrows it. */
export async function reportsOf(env, { game = null, limit = 50 } = {}) {
  try {
    const q = game
      ? env.DB.prepare("SELECT * FROM chat_reports WHERE game = ?1 AND state = 'open' AND expires_at >= ?2 ORDER BY created_at DESC LIMIT ?3").bind(game, Date.now(), limit)
      : env.DB.prepare("SELECT * FROM chat_reports WHERE state = 'open' AND expires_at >= ?1 ORDER BY created_at DESC LIMIT ?2").bind(Date.now(), limit);
    const { results } = await q.all();
    return (results ?? []).map((r) => ({
      id: r.id, game: r.game, room: r.room, line: r.line, kind: r.kind, text: r.text, name: r.sender_name, player: r.sender_player, seat: r.sender_seat,
      saidAt: Number(r.said_at), reason: r.reason, reasonText: REPORT_WORDS[r.reason] ?? r.reason, at: Number(r.created_at), expiresAt: Number(r.expires_at),
    }));
  } catch { return []; }
}

/** The owner is done with a report: it is deleted (nothing of it stays). */
export async function dismissReport(env, id) {
  const r = await env.DB.prepare('DELETE FROM chat_reports WHERE id = ?1').bind(id).run();
  return { ok: true, removed: Number(r?.meta?.changes ?? 0) };
}

/** The chat review's day for the whole studio: the budget (meta `chat_budget`) and what today used (stats_daily). */
export async function chatDay(env, today) {
  const budget = { neurons: CHAT_BUDGET.neurons };
  const used = { neurons: 0, reviews: 0, held: 0, errors: 0 };
  if (!env?.DB) return { budget, used, ai: Boolean(env?.AI) };
  try {
    const b = JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'chat_budget'").first())?.value ?? 'null');
    if (b && Number.isFinite(Number(b.neurons))) budget.neurons = Math.max(0, Number(b.neurons));
  } catch { /* the default */ }
  try {
    const { results } = await env.DB.prepare("SELECT metric, source, SUM(n) AS n FROM stats_daily WHERE day = ?1 AND metric IN ('chat-neurons', 'chat-reviews') GROUP BY metric, source").bind(today).all();
    for (const r of results ?? []) {
      if (r.metric === 'chat-neurons') used.neurons += Number(r.n) || 0;
      else if (r.source === 'held') { used.held += Number(r.n) || 0; used.reviews += Number(r.n) || 0; }
      else if (r.source === 'error') used.errors += Number(r.n) || 0;
      else used.reviews += Number(r.n) || 0;
    }
  } catch { /* before migration 0002: nothing used */ }
  return { budget, used, ai: Boolean(env.AI) };
}
