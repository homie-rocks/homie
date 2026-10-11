/**
 * CLOUD SAVES, LIFETIME STATS AND MEMORIALS — per player, per game, in the studio's own D1 (saves/SAVES.md).
 *
 *   saves         key → JSON value, versioned (every write adds one), per player and game. A write may name the
 *                 version it was based on (`base`): if another device wrote in between, it is refused with the
 *                 current value (a conflict), so a stale offline copy never overwrites newer progress silently.
 *   player_stats  numbers that only add up (or keep the highest or lowest) and survive a wipe: time played, gold
 *                 earned, kills, best level. A hardcore death wipes the saves and keeps these.
 *   memorials     the hall of the fallen: a character's name, the player's display name and a small summary,
 *                 written when a hardcore character dies (optionally wiping that game's saves in the same step).
 *
 * LIMITS (SAVE_LIMITS): 64 KiB a value, 64 keys and 256 KiB a game per player in D1. With the studio's storage (R2,
 * `homie-studio storage add`) a value up to 1 MiB goes to R2 instead (4 MiB a game per player), under a random
 * object key that the public /media/ route refuses. Keys are 1 to 64 of A-Z a-z 0-9 _ . : -.
 * A write is atomic per key, not across keys: keep a character in ONE key.
 *
 * A GUEST WHO SIGNS IN to an account that already has saves loses nothing: adoptGuest combines a key both have by
 * the game's declared rules (mergeSaves), in the sign-in's one transaction, and a room's record that lands late for
 * the guest's id follows them (appendServerRecord). Two rows under game '' are that bookkeeping, nobody's save.
 */
import { randomToken } from './webauthn.mjs';

export const SAVE_LIMITS = Object.freeze({
  valueBytes: 64 * 1024, gameBytes: 256 * 1024, keys: 64, batch: 32,
  blobBytes: 1024 * 1024, gameBlobBytes: 4 * 1024 * 1024,
  stats: 64, memorialBytes: 2048, memorialsPerDay: 20, fallenList: 50,
});
export const SAVE_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
export const STAT_NAME = /^[A-Za-z0-9_.:-]{1,32}$/;
const BLOB = /^r2:(players\/[A-Za-z0-9_-]{16,64})$/;
const ENC = new TextEncoder();
const bytesOf = (text) => ENC.encode(text).length;

/** The R2 object a blob row points at, or null for a value kept in D1. */
const blobKey = (row) => (row && Number(row.blob) === 1 ? BLOB.exec(String(row.value))?.[1] ?? null : null);

async function valueOf(env, row) {
  const key = blobKey(row);
  if (!key) { try { return JSON.parse(row.value); } catch { return null; } }
  if (!env.MEDIA) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch { return null; }
}

async function dropBlobs(env, keys) {
  const list = keys.filter(Boolean);
  if (!list.length || !env.MEDIA) return;
  try { await env.MEDIA.delete(list); } catch { /* a missing object is already gone */ }
}

/** Every key of one player's game, with its version and size; `values` adds each value. */
export async function listSaves(env, player, game, { values = false } = {}) {
  const rows = (await env.DB.prepare('SELECT key, value, bytes, version, updated_at, blob FROM saves WHERE player = ?1 AND game = ?2 ORDER BY key LIMIT 200').bind(player, game).all()).results ?? [];
  const keys = [];
  for (const r of rows) {
    const k = { key: r.key, version: Number(r.version), bytes: Number(r.bytes), updatedAt: Number(r.updated_at) };
    if (values) k.value = await valueOf(env, r);
    keys.push(k);
  }
  return { keys, used: usage(rows) };
}

function usage(rows) {
  let bytes = 0; let blobBytes = 0;
  for (const r of rows) { if (Number(r.blob) === 1) blobBytes += Number(r.bytes); else bytes += Number(r.bytes); }
  return { keys: rows.length, bytes, blobBytes };
}

export async function getSave(env, player, game, key) {
  if (!SAVE_KEY.test(String(key))) return { ok: false, error: 'key', message: 'a save key is 1 to 64 letters, digits, _ . : or -' };
  const row = await env.DB.prepare('SELECT value, bytes, version, updated_at, blob FROM saves WHERE player = ?1 AND game = ?2 AND key = ?3').bind(player, game, key).first();
  if (!row) return { ok: true, key, value: null, version: 0, updatedAt: null };
  return { ok: true, key, value: await valueOf(env, row), version: Number(row.version), updatedAt: Number(row.updated_at) };
}

/**
 * Write and delete keys of one player's game. Each item: { key, value, base? } to set, { key, base? } to delete.
 * `base` is the version the change was made from (0: the key did not exist); without it the write is
 * unconditional. Returns one result per item: { key, ok: true, version } or { key, ok: false, error, current? }.
 */
export async function writeSaves(env, player, game, { set = [], del = [] } = {}) {
  const items = [...(Array.isArray(set) ? set : []).map((s) => ({ ...s, op: 'set' })), ...(Array.isArray(del) ? del : []).map((s) => ({ ...s, op: 'del' }))];
  if (!items.length) return { ok: true, results: [] };
  if (items.length > SAVE_LIMITS.batch) return { ok: false, error: 'batch', message: `at most ${SAVE_LIMITS.batch} keys in one write` };
  const rows = (await env.DB.prepare('SELECT key, value, bytes, version, blob FROM saves WHERE player = ?1 AND game = ?2').bind(player, game).all()).results ?? [];
  const now = new Map(rows.map((r) => [r.key, r]));
  const results = [];
  const at = Date.now();
  for (const item of items) {
    const key = String(item?.key ?? '');
    if(key.startsWith('server:')){results.push({key,ok:false,error:'authority',message:'This record is written by the game server'});continue;}
    if (!SAVE_KEY.test(key)) { results.push({ key, ok: false, error: 'key', message: 'a save key is 1 to 64 letters, digits, _ . : or -' }); continue; }
    const base = item.base === undefined || item.base === null ? null : Math.floor(Number(item.base));
    if (base !== null && !(base >= 0)) { results.push({ key, ok: false, error: 'base', message: 'base is the version the change was made from (0 when the key is new)' }); continue; }
    const prev = now.get(key) ?? null;
    if (base !== null && (prev ? Number(prev.version) : 0) !== base) {
      results.push({ key, ok: false, error: 'conflict', message: 'another device saved this key since', current: prev ? { value: await valueOf(env, prev), version: Number(prev.version) } : { value: null, version: 0 } });
      continue;
    }
    if (item.op === 'del') {
      if (!prev) { results.push({ key, ok: true, version: 0 }); continue; }
      const gone = await env.DB.prepare('DELETE FROM saves WHERE player = ?1 AND game = ?2 AND key = ?3 AND version = ?4 RETURNING version').bind(player, game, key, Number(prev.version)).first();
      if (!gone) { results.push({ key, ok: false, error: 'conflict', message: 'another device saved this key since' }); continue; }
      await dropBlobs(env, [blobKey(prev)]);
      now.delete(key);
      results.push({ key, ok: true, version: 0 });
      continue;
    }
    if (item.value === undefined) { results.push({ key, ok: false, error: 'value', message: 'a save needs a value (null is a value; use del to remove a key)' }); continue; }
    let text;
    try { text = JSON.stringify(item.value); } catch { results.push({ key, ok: false, error: 'value', message: 'a save is JSON' }); continue; }
    const size = bytesOf(text);
    const others = [...now.values()].filter((r) => r.key !== key);
    const used = usage(others);
    if (!prev && others.length >= SAVE_LIMITS.keys) { results.push({ key, ok: false, error: 'too-many-keys', message: `a game keeps at most ${SAVE_LIMITS.keys} keys per player` }); continue; }
    let stored = text; let blob = 0; let newObject = null;
    if (size > SAVE_LIMITS.valueBytes) {
      if (!env.MEDIA) { results.push({ key, ok: false, error: 'too-large', message: `a save is at most ${SAVE_LIMITS.valueBytes / 1024} KiB (this studio has no storage for larger ones)` }); continue; }
      if (size > SAVE_LIMITS.blobBytes) { results.push({ key, ok: false, error: 'too-large', message: `a save is at most ${SAVE_LIMITS.blobBytes / 1024} KiB` }); continue; }
      if (used.blobBytes + size > SAVE_LIMITS.gameBlobBytes) { results.push({ key, ok: false, error: 'full', message: `a game keeps at most ${SAVE_LIMITS.gameBlobBytes / 1048576} MiB of large saves per player` }); continue; }
      newObject = `players/${randomToken(24)}`;
      await env.MEDIA.put(newObject, text, { httpMetadata: { contentType: 'application/json' } });
      stored = `r2:${newObject}`; blob = 1;
    } else if (used.bytes + size > SAVE_LIMITS.gameBytes) {
      results.push({ key, ok: false, error: 'full', message: `a game keeps at most ${SAVE_LIMITS.gameBytes / 1024} KiB of saves per player` });
      continue;
    }
    let row;
    if (base === null) {
      row = await env.DB.prepare('INSERT INTO saves (player, game, key, value, bytes, version, updated_at, blob) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7) ON CONFLICT(player, game, key) DO UPDATE SET value = excluded.value, bytes = excluded.bytes, version = saves.version + 1, updated_at = excluded.updated_at, blob = excluded.blob RETURNING version')
        .bind(player, game, key, stored, size, at, blob).first();
    } else if (base === 0) {
      row = await env.DB.prepare('INSERT INTO saves (player, game, key, value, bytes, version, updated_at, blob) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7) ON CONFLICT(player, game, key) DO NOTHING RETURNING version')
        .bind(player, game, key, stored, size, at, blob).first();
    } else {
      row = await env.DB.prepare('UPDATE saves SET value = ?4, bytes = ?5, version = version + 1, updated_at = ?6, blob = ?7 WHERE player = ?1 AND game = ?2 AND key = ?3 AND version = ?8 RETURNING version')
        .bind(player, game, key, stored, size, at, blob, base).first();
    }
    if (!row) {
      await dropBlobs(env, [newObject]);
      results.push({ key, ok: false, error: 'conflict', message: 'another device saved this key since' });
      continue;
    }
    if (prev) await dropBlobs(env, [blobKey(prev)]);
    now.set(key, { key, value: stored, bytes: size, version: Number(row.version), blob });
    results.push({ key, ok: true, version: Number(row.version) });
  }
  return { ok: true, results, used: usage([...now.values()]) };
}

/** Every save of one player's game, except the `keep` keys: a hardcore death, or "new game". */
export function wipeStatements(env, player, game, keep = []) {
  const kept = (Array.isArray(keep) ? keep : []).filter((k) => SAVE_KEY.test(String(k))).slice(0, SAVE_LIMITS.keys);
  const marks = kept.map((_, i) => `?${i + 3}`).join(', ');
  return env.DB.prepare(`DELETE FROM saves WHERE player = ?1 AND game = ?2 AND key NOT LIKE 'server:%'${kept.length ? ` AND key NOT IN (${marks})` : ''} RETURNING key, value, blob`).bind(player, game, ...kept);
}

export async function wipeSaves(env, player, game, { keep = [] } = {}) {
  const gone = (await wipeStatements(env, player, game, keep).all()).results ?? [];
  await dropBlobs(env, gone.map(blobKey));
  return { ok: true, wiped: gone.map((r) => r.key) };
}

/* ------------------------------------------------------------------ lifetime stats */

export async function readPlayerStats(env, player, game) {
  const rows = (await env.DB.prepare('SELECT name, n FROM player_stats WHERE player = ?1 AND game = ?2 ORDER BY name LIMIT 100').bind(player, game).all()).results ?? [];
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.n)]));
}

/**
 * Add to counters (`add`), keep the highest (`max`) or the lowest (`min`): { add: { kills: 1 }, max: { level: 7 } }.
 * Numbers only, finite, |n| < 1e15. They never go back on their own: a wipe keeps them.
 */
export async function bumpPlayerStats(env, player, game, { add = {}, max = {}, min = {} } = {}) {
  const ops = [];
  for (const [kind, obj] of [['add', add], ['max', max], ['min', min]]) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    for (const [name, raw] of Object.entries(obj)) {
      const n = Number(raw);
      if (!STAT_NAME.test(name)) return { ok: false, error: 'stat', message: `a stat name is 1 to 32 letters, digits, _ . : or - (got ${JSON.stringify(String(name).slice(0, 40))})` };
      if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return { ok: false, error: 'stat', message: `${name} is not a number a stat can hold` };
      if (kind === 'add' && n === 0) continue;
      ops.push({ kind, name, n });
    }
  }
  if (ops.length > SAVE_LIMITS.stats) return { ok: false, error: 'stat', message: `at most ${SAVE_LIMITS.stats} stats at once` };
  if (!ops.length) return { ok: true, stats: await readPlayerStats(env, player, game) };
  const have = await readPlayerStats(env, player, game);
  const fresh = new Set(ops.map((o) => o.name).filter((name) => !(name in have)));
  if (Object.keys(have).length + fresh.size > SAVE_LIMITS.stats) return { ok: false, error: 'stat', message: `a game keeps at most ${SAVE_LIMITS.stats} stats per player` };
  const at = Date.now();
  const sql = {
    add: 'INSERT INTO player_stats (player, game, name, n, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(player, game, name) DO UPDATE SET n = player_stats.n + excluded.n, updated_at = excluded.updated_at',
    max: 'INSERT INTO player_stats (player, game, name, n, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(player, game, name) DO UPDATE SET n = max(player_stats.n, excluded.n), updated_at = excluded.updated_at',
    min: 'INSERT INTO player_stats (player, game, name, n, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(player, game, name) DO UPDATE SET n = min(player_stats.n, excluded.n), updated_at = excluded.updated_at',
  };
  await env.DB.batch(ops.map((o) => env.DB.prepare(sql[o.kind]).bind(player, game, o.name, o.n, at)));
  return { ok: true, stats: await readPlayerStats(env, player, game) };
}

/* ------------------------------------------------------------------ the hall of the fallen */

/**
 * A memorial: { character, summary, wipe, keep }. `character` follows the display-name rules (the caller cleans
 * it); `summary` is a small JSON object (level, cause, gold, days survived…), 2 KiB at most. `wipe: true` deletes
 * this game's saves (except `keep`) in the SAME transaction, so a death and its wipe can never half-happen.
 */
export async function fall(env, player, playerName, game, { character, summary = {}, wipe = false, keep = [] }) {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return { ok: false, error: 'summary', message: 'a memorial summary is a JSON object' };
  const text = JSON.stringify(summary);
  if (bytesOf(text) > SAVE_LIMITS.memorialBytes) return { ok: false, error: 'too-large', message: `a memorial summary is at most ${SAVE_LIMITS.memorialBytes} bytes` };
  const at = Date.now();
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM memorials WHERE player = ?1 AND game = ?2 AND at >= ?3').bind(player, game, at - 86400_000).first();
  if (Number(today?.n) >= SAVE_LIMITS.memorialsPerDay) return { ok: false, error: 'rate', message: `at most ${SAVE_LIMITS.memorialsPerDay} memorials a day per player` };
  const insert = env.DB.prepare('INSERT INTO memorials (player, game, character, player_name, summary, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id').bind(player, game, character, playerName, text, at);
  const [made, wiped] = await env.DB.batch(wipe ? [insert, wipeStatements(env, player, game, keep)] : [insert]);
  const gone = wiped?.results ?? [];
  await dropBlobs(env, gone.map(blobKey));
  return { ok: true, memorial: { id: Number(made?.results?.[0]?.id ?? 0), character, player: playerName, summary, at }, wiped: gone.map((r) => r.key) };
}

/** The newest memorials of a game (everyone's), or one player's own: { character, player, summary, at }. */
export async function fallenList(env, game, { limit = 20, player = null } = {}) {
  const n = Math.max(1, Math.min(SAVE_LIMITS.fallenList, Math.floor(Number(limit)) || 20));
  const rows = (await (player
    ? env.DB.prepare('SELECT character, player_name, summary, at FROM memorials WHERE game = ?1 AND player = ?2 ORDER BY at DESC LIMIT ?3').bind(game, player, n)
    : env.DB.prepare('SELECT character, player_name, summary, at FROM memorials WHERE game = ?1 ORDER BY at DESC LIMIT ?2').bind(game, n)).all()).results ?? [];
  return rows.map((r) => {
    let summary = {};
    try { summary = JSON.parse(r.summary); } catch { summary = {}; }
    return { character: r.character, player: r.player_name, summary, at: Number(r.at) };
  });
}

/* ------------------------------------------------------------------ a player's whole data */

/** Everything this player has in every game, for their export (values included, large ones from R2). */
export async function playerData(env, player) {
  const rows = (await env.DB.prepare("SELECT game, key, value, bytes, version, updated_at, blob FROM saves WHERE player = ?1 AND game != '' ORDER BY game, key").bind(player).all()).results ?? [];
  const stats = (await env.DB.prepare('SELECT game, name, n, updated_at FROM player_stats WHERE player = ?1 ORDER BY game, name').bind(player).all()).results ?? [];
  const mem = (await env.DB.prepare('SELECT game, character, player_name, summary, at FROM memorials WHERE player = ?1 ORDER BY at').bind(player).all()).results ?? [];
  const games = {};
  const of = (g) => (games[g] ??= { saves: {}, stats: {}, memorials: [] });
  for (const r of rows) of(r.game).saves[r.key] = { value: await valueOf(env, r), version: Number(r.version), updatedAt: new Date(Number(r.updated_at)).toISOString() };
  for (const s of stats) of(s.game).stats[s.name] = Number(s.n);
  for (const m of mem) {
    let summary = {};
    try { summary = JSON.parse(m.summary); } catch { summary = {}; }
    of(m.game).memorials.push({ character: m.character, as: m.player_name, summary, at: new Date(Number(m.at)).toISOString() });
  }
  // The servers this player belongs to (0.16.0; a studio before migration 0006 has none).
  let servers = [];
  try { servers = (await env.DB.prepare('SELECT game, server, role, home, joined_at, seen_at FROM server_members WHERE player = ?1 ORDER BY game, server').bind(player).all()).results ?? []; } catch { servers = []; }
  for (const m of servers) (of(m.game).servers ??= []).push({ server: m.server, role: m.role, home: Number(m.home) === 1, joinedAt: new Date(Number(m.joined_at)).toISOString(), seenAt: new Date(Number(m.seen_at)).toISOString() });
  return games;
}

/** Per game: keys, bytes and the last write, for the owner's view of a player (never the values). */
export async function savesSummary(env, player) {
  const rows = (await env.DB.prepare("SELECT game, COUNT(*) AS keys, SUM(bytes) AS bytes, MAX(updated_at) AS at FROM saves WHERE player = ?1 AND game != '' GROUP BY game").bind(player).all()).results ?? [];
  return rows.map((r) => ({ game: r.game, keys: Number(r.keys), bytes: Number(r.bytes) || 0, updatedAt: Number(r.at) || null }));
}

/**
 * The statements that delete a player's saves, stats and memorials (and their large saves' objects, after). The
 * forwarding rows of the guests this account once adopted go too, found by the account's own `server:from:` rows,
 * so no row is left pointing at a player who is gone.
 */
export async function dropPlayerData(env, player) {
  const rows = (await env.DB.prepare("SELECT game, key, value, blob FROM saves WHERE player = ?1 AND (blob = 1 OR game = '')").bind(player).all()).results ?? [];
  const guests = rows.filter((r) => r.game === '' && String(r.key).startsWith(FROM_KEY)).map((r) => String(r.key).slice(FROM_KEY.length));
  const moved = [];
  for (let i = 0; i < guests.length; i += 50) {
    const ids = guests.slice(i, i + 50);
    moved.push(env.DB.prepare(`DELETE FROM saves WHERE game = '' AND key = '${MOVED_KEY}' AND player IN (${ids.map((_, n) => `?${n + 1}`).join(', ')})`).bind(...ids));
  }
  return {
    statements: [
      env.DB.prepare('DELETE FROM saves WHERE player = ?1').bind(player),
      env.DB.prepare('DELETE FROM player_stats WHERE player = ?1').bind(player),
      env.DB.prepare('DELETE FROM memorials WHERE player = ?1').bind(player),
      ...moved,
    ],
    after: () => dropBlobs(env, rows.map(blobKey)),
  };
}

/* ------------------------------------------------------------------ a guest signs in to their account */

/** Where an adopted guest went: saves row (guest, '', 'server:moved') = {"to": account, "at": ms}. */
const MOVED_KEY = 'server:moved';
/** The way back, kept with the account so deleting it finds those rows by key: (account, '', 'server:from:<guest>'). */
const FROM_KEY = 'server:from:';
/** What the guard's deliberate SQLite error is recognised by (json_extract of text that is not JSON). */
const CHANGED = /malformed JSON/i;
const ADOPT_TRIES = 4;
const KEPT_BYTES = 256 * 1024;
/** The shape appendServerRecord itself writes: { matches: [{ id, endedAt, … }] }, newest 100. */
const RECORDS = Object.freeze({ rule: 'union', union: 'matches', by: 'id', order: 'endedAt', keep: 100 });
const SAVE_RULES = ['account', 'guest', 'newer', 'larger', 'smaller', 'sum', 'union'];
const STAT_RULES = ['account', 'guest', 'larger', 'smaller', 'sum'];
const STAT_SQL = { sum: 'player_stats.n + excluded.n', larger: 'max(player_stats.n, excluded.n)', smaller: 'min(player_stats.n, excluded.n)', guest: 'excluded.n' };

/** game id → { saves, stats }, each { exact: Map, prefix: [[prefix, rule]] longest first }. */
const merges = new Map();

function ruleOf(raw, where, stat) {
  if (typeof raw === 'function' && !stat) return { rule: 'function', fn: raw };
  if (typeof raw === 'string' && (stat ? STAT_RULES : SAVE_RULES).includes(raw)) return raw === 'union' ? RECORDS : { rule: raw };
  if (!stat && raw && typeof raw === 'object') {
    if (typeof raw.union === 'string' && raw.union) return { rule: 'union', union: raw.union, by: typeof raw.by === 'string' && raw.by ? raw.by : 'id', order: typeof raw.order === 'string' && raw.order ? raw.order : null, keep: Number.isInteger(raw.keep) && raw.keep > 0 ? raw.keep : null };
    if ((raw.rule === 'larger' || raw.rule === 'smaller') && typeof raw.by === 'string' && raw.by) return { rule: raw.rule, by: raw.by };
    if (typeof raw.rule === 'string' && SAVE_RULES.includes(raw.rule)) return ruleOf(raw.rule, where, stat);
  }
  throw new Error(`mergeSaves: ${where} is not a rule (${(stat ? STAT_RULES : [...SAVE_RULES, '{ union, by, order, keep }', '{ rule, by }', 'a function']).join(', ')})`);
}

function patternsOf(obj, where, stat) {
  const exact = new Map(); const prefix = [];
  if (obj && typeof obj === 'object') for (const [name, raw] of Object.entries(obj)) {
    const rule = ruleOf(raw, `${where}['${name}']`, stat);
    if (name.endsWith('*')) prefix.push([name.slice(0, -1), rule]); else exact.set(name, rule);
  }
  prefix.sort((a, b) => b[0].length - a[0].length);
  return { exact, prefix };
}

/** The rule for one key or stat: its exact name first, then the longest `prefix*` that fits. */
const ruleFor = (set, name) => (set ? set.exact.get(name) ?? set.prefix.find(([p]) => name.startsWith(p))?.[1] ?? null : null);

/**
 * How a guest's saves and stats combine with the account's when the guest signs in to an account that already has
 * the same key (saves/SAVES.md, "When a guest signs in to their account"). The studio's Worker calls it once, at
 * load:
 *
 *   import { mergeSaves } from '@homie-rocks/studio/worker';
 *   mergeSaves({ '<game id>': { saves: { '<key or prefix*>': rule }, stats: { '<name or prefix*>': rule } } });
 *
 * A save rule is 'account', 'guest', 'newer', 'larger', 'smaller', 'sum', 'union', { rule: 'larger' | 'smaller', by },
 * { union, by, order, keep } or a function (guest, account, ctx) => value. A stat rule is 'account', 'guest',
 * 'larger', 'smaller' or 'sum'. A rule that is none of these throws here, naming it, so a typing mistake never
 * turns into a lost save later. Returns the number of games.
 */
export function mergeSaves(table) {
  merges.clear();
  if (!table || typeof table !== 'object') return 0;
  for (const [game, entry] of Object.entries(table)) {
    if (!entry || typeof entry !== 'object') continue;
    merges.set(game, { saves: patternsOf(entry.saves, `${game}.saves`, false), stats: patternsOf(entry.stats, `${game}.stats`, true) });
  }
  return merges.size;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
/** Newest first, then by id: the order of a server record's list (appendServerRecord and a union use the same). */
const newestFirst = (order, by) => (a, b) => ((Number(b[order]) || 0) - (Number(a[order]) || 0)) || String(a[by]).localeCompare(String(b[by]));

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

/** The account's object with its list joined to the guest's by id (the account's entry wins), or undefined. */
function unionOf(guest, account, { union, by, order, keep }, ids = (id) => typeof id === 'string' || isNumber(id)) {
  if (!isObject(guest) || !isObject(account) || !Array.isArray(guest[union]) || !Array.isArray(account[union])) return undefined;
  const seen = new Set(); const list = [];
  for (const entry of [...account[union], ...guest[union]]) {
    if (!isObject(entry) || !ids(entry[by])) return undefined;
    const id = String(entry[by]);
    if (seen.has(id)) continue;
    seen.add(id); list.push(entry);
  }
  if (order) list.sort(newestFirst(order, by));
  return { ...account, [union]: keep ? list.slice(0, keep) : list };
}

/** One declared rule on one key: { pick: 'account' | 'guest' }, { value, list? } or { failed: why }. */
async function applyRule(rule, guest, account, ctx) {
  if (rule.rule === 'account' || rule.rule === 'guest') return { pick: rule.rule };
  if (rule.rule === 'newer') return { pick: ctx.guest.updatedAt > ctx.account.updatedAt ? 'guest' : 'account' };
  if (rule.rule === 'larger' || rule.rule === 'smaller') {
    const g = rule.by ? (isObject(guest) ? guest[rule.by] : undefined) : guest;
    const a = rule.by ? (isObject(account) ? account[rule.by] : undefined) : account;
    if (!isNumber(g) || !isNumber(a)) return { failed: 'the two values are not numbers to compare' };
    return { pick: (rule.rule === 'larger' ? g > a : g < a) ? 'guest' : 'account' };
  }
  if (rule.rule === 'sum') {
    if (isNumber(guest) && isNumber(account)) return { value: guest + account };
    if (!isObject(guest) || !isObject(account)) return { failed: 'the two values are not numbers or objects to add' };
    const out = { ...guest, ...account };
    for (const [k, n] of Object.entries(guest)) if (isNumber(n) && isNumber(account[k])) out[k] = n + account[k];
    return { value: out };
  }
  if (rule.rule === 'union') {
    const value = unionOf(guest, account, rule);
    return value === undefined ? { failed: `the two values do not both hold a list of objects under '${rule.union}', each with '${rule.by}'` } : { value, list: rule.union };
  }
  try {
    const value = await rule.fn(structuredClone(guest), structuredClone(account), ctx);
    return value === undefined ? { failed: 'the function returned nothing' } : { value };
  } catch (e) { return { failed: `the function threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
}

/** A merged value as the text to store, a list cut from its end until it fits; null when it cannot be stored. */
function fitted(value, list) {
  let text;
  try { text = JSON.stringify(value); } catch { return null; }
  if (text === undefined) return null;
  if (list && bytesOf(text) > SAVE_LIMITS.valueBytes) {
    const kept = [...value[list]];
    while (bytesOf(text) > SAVE_LIMITS.valueBytes && kept.length > 1) { kept.pop(); text = JSON.stringify({ ...value, [list]: kept }); }
  }
  return bytesOf(text) > SAVE_LIMITS.valueBytes ? null : text;
}

/**
 * What one key both players have becomes: { took: 'same' } (nothing to do), { took: 'account', rule? } (the
 * account's stays, by a declared rule), { took: 'guest', rule } (the guest's row replaces it), { took: 'merged',
 * rule, text } (a new value), or { took: 'kept', rule?, error? } (no rule could combine them: the account's stays
 * and the guest's value goes back to the browser).
 */
async function outcomeOf(rule, guest, account, ctx) {
  const settle = (out, name) => {
    if (out.pick) return sameValue(guest, account) ? { took: 'same' } : { took: out.pick, rule: name };
    const text = fitted(out.value, out.list);
    if (text === null) return { failed: 'the merged value is not JSON that fits a save' };
    const value = JSON.parse(text);
    if (sameValue(value, account)) return sameValue(guest, account) ? { took: 'same' } : { took: 'account', rule: name };
    return sameValue(value, guest) ? { took: 'guest', rule: name } : { took: 'merged', rule: name, text };
  };
  let failed = null;
  if (rule) {
    const out = await applyRule(rule, guest, account, ctx);
    const done = out.failed ? out : settle(out, rule.rule);
    if (!done.failed) return done;
    failed = { rule: rule.rule, error: done.failed };
  }
  if (sameValue(guest, account)) return { took: 'same' };
  // The toolkit's own record shape: nothing but this can ever combine a `server:` record, so it needs no rule.
  const records = unionOf(guest, account, { ...RECORDS, keep: ctx.key.startsWith('server:') ? RECORDS.keep : null }, (id) => typeof id === 'string');
  if (records !== undefined) { const done = settle({ value: records, list: RECORDS.union }, 'union'); if (!done.failed) return done; }
  return { took: 'kept', ...(failed ?? {}) };
}

/**
 * A guest signs in to an account they already have. Whatever only the guest had moves over (saves, stats,
 * memorials). A save both have is combined by the game's declared rule (mergeSaves); with no rule, two server
 * records are joined by id, and for anything else the account's stays and the guest's value is reported (`kept`),
 * so the play page can hand it to the game's onConflict. A stat both have keeps the account's number unless a rule
 * says otherwise.
 *
 * Statements for ONE batch (a transaction), computed from one read. A guard per clashing key, and one inside the
 * move for the set of clashing keys, make the batch fail when a room wrote a record to either player in between
 * (adoptGuest reads again and retries). The move also leaves the guest's forwarding row for a record that lands
 * late (appendServerRecord follows it). `plain: true` is the last resort: no guards and no merging.
 */
export async function adoptStatements(env, from, to, { plain = false } = {}) {
  const now = Date.now();
  const clash = (await env.DB.prepare(`SELECT 0 AS stat, g.game AS game, g.key AS key, g.value AS gv, g.bytes AS gbytes, g.version AS gver, g.updated_at AS gat, g.blob AS gblob, a.value AS av, a.version AS aver, a.updated_at AS aat, a.blob AS ablob FROM saves g JOIN saves a ON a.player = ?2 AND a.game = g.game AND a.key = g.key WHERE g.player = ?1
    UNION ALL SELECT 1, g.game, g.name, g.n, 0, 0, g.updated_at, 0, a.n, 0, a.updated_at, 0 FROM player_stats g JOIN player_stats a ON a.player = ?2 AND a.game = g.game AND a.name = g.name WHERE g.player = ?1`).bind(from, to).all()).results ?? [];
  const pairs = clash.filter((c) => Number(c.stat) === 0);
  const report = { merged: [], moved: 0, kept: [], stats: { merged: [], kept: [] } };
  if (plain) report.fallback = true;
  const guards = []; const writes = []; const drop = [];
  let keptBytes = 0;
  for (const c of pairs) {
    const guestBlob = blobKey({ value: c.gv, blob: c.gblob }); const accountBlob = blobKey({ value: c.av, blob: c.ablob });
    let out = { took: 'same' };
    let guest;
    if (guestBlob || accountBlob || c.gv !== c.av) {
      guest = await valueOf(env, { value: c.gv, blob: c.gblob });
      const account = await valueOf(env, { value: c.av, blob: c.ablob });
      const ctx = { game: c.game, key: c.key, guest: { updatedAt: Number(c.gat), version: Number(c.gver) }, account: { updatedAt: Number(c.aat), version: Number(c.aver) } };
      out = plain ? (sameValue(guest, account) ? { took: 'same' } : { took: 'kept' }) : await outcomeOf(ruleFor(merges.get(c.game)?.saves, c.key), guest, account, ctx);
    }
    if (!plain) guards.push(env.DB.prepare(`SELECT json_extract(CASE WHEN (SELECT COUNT(*) FROM saves WHERE game = ?3 AND key = ?4 AND ((player = ?1 AND version = ?5 AND updated_at = ?6) OR (player = ?2 AND version = ?7 AND updated_at = ?8))) = 2 THEN '0' ELSE 'saves changed during sign-in' END, '$')`).bind(from, to, c.game, c.key, Number(c.gver), Number(c.gat), Number(c.aver), Number(c.aat)));
    if (out.took === 'guest') {
      // The guest's row as it is (a large one keeps its object); the account's own large object goes.
      writes.push(env.DB.prepare('UPDATE saves SET (value, bytes, blob) = (SELECT value, bytes, blob FROM saves WHERE player = ?1 AND game = ?3 AND key = ?4), version = version + 1, updated_at = ?5 WHERE player = ?2 AND game = ?3 AND key = ?4').bind(from, to, c.game, c.key, now));
      drop.push(accountBlob);
    } else if (out.took === 'merged') {
      writes.push(env.DB.prepare('UPDATE saves SET value = ?4, bytes = ?5, version = version + 1, updated_at = ?6, blob = 0 WHERE player = ?1 AND game = ?2 AND key = ?3').bind(to, c.game, c.key, out.text, bytesOf(out.text), now));
      drop.push(guestBlob, accountBlob);
    } else drop.push(guestBlob);
    if (out.took === 'kept') {
      const entry = { game: c.game, key: c.key };
      if (keptBytes + Number(c.gbytes) <= KEPT_BYTES) { keptBytes += Number(c.gbytes); entry.value = guest; } else entry.truncated = true;
      if (out.rule) { entry.rule = out.rule; entry.error = out.error; }
      report.kept.push(entry);
    } else if (out.took !== 'same') report.merged.push({ game: c.game, key: c.key, rule: out.rule, took: out.took });
  }
  for (const c of clash) {
    if (Number(c.stat) !== 1) continue;
    const rule = plain ? null : ruleFor(merges.get(c.game)?.stats, c.key)?.rule ?? null;
    if (rule && STAT_SQL[rule]) {
      writes.push(env.DB.prepare(`INSERT INTO player_stats (player, game, name, n, updated_at) SELECT ?2, game, name, n, ?5 FROM player_stats WHERE player = ?1 AND game = ?3 AND name = ?4 ON CONFLICT(player, game, name) DO UPDATE SET n = ${STAT_SQL[rule]}, updated_at = excluded.updated_at`).bind(from, to, c.game, c.key, now));
    }
    if (rule) report.stats.merged.push({ game: c.game, name: c.key, rule });
    else if (Number(c.gv) !== Number(c.av)) report.stats.kept.push({ game: c.game, name: c.key, value: Number(c.gv) });
  }
  // One statement moves what only the guest had and leaves the forwarding rows; unless `plain`, the forwarding
  // row's value is also the guard: it stops being JSON, and the batch fails, when the clashing keys are no longer
  // the ones read above.
  const moved = JSON.stringify({ to, at: now });
  const guard = plain ? '?3' : `json_extract(CASE WHEN (SELECT COUNT(*) FROM saves g JOIN saves a ON a.player = ?2 AND a.game = g.game AND a.key = g.key WHERE g.player = ?1) = ?6 THEN ?3 ELSE 'saves changed during sign-in' END, '$')`;
  const move = env.DB.prepare(`INSERT OR IGNORE INTO saves (player, game, key, value, bytes, version, updated_at, blob) SELECT ?1, '', '${MOVED_KEY}', ${guard}, ?4, 1, ?5, 0 UNION ALL SELECT ?2, '', '${FROM_KEY}' || ?1, '1', 1, 1, ?5, 0 UNION ALL SELECT ?2, game, key, value, bytes, version, updated_at, blob FROM saves WHERE player = ?1 AND game != '' RETURNING game`)
    .bind(...[from, to, moved, bytesOf(moved), now], ...(plain ? [] : [pairs.length]));
  return {
    statements: [
      ...guards, ...writes, move,
      env.DB.prepare('INSERT OR IGNORE INTO player_stats (player, game, name, n, updated_at) SELECT ?2, game, name, n, updated_at FROM player_stats WHERE player = ?1').bind(from, to),
      env.DB.prepare('UPDATE memorials SET player = ?2 WHERE player = ?1').bind(from, to),
      env.DB.prepare("DELETE FROM saves WHERE player = ?1 AND game != ''").bind(from),
      env.DB.prepare('DELETE FROM player_stats WHERE player = ?1').bind(from),
    ],
    move, report, plain,
    after: () => dropBlobs(env, drop),
  };
}

/**
 * Adopt a guest into an account in ONE batch, exactly once: `around(statements)` returns the whole batch (the
 * sign-in's own writes around the adoption's). When a room wrote to either player between the read and the batch,
 * the guard fails the batch, nothing is written, and it is read and tried again; after a few such tries the plain
 * statements run (the account keeps a key both have, reported with `fallback: true`) rather than refusing the
 * sign-in. Returns what happened: { merged, moved, kept, stats: { merged, kept }, fallback? }.
 */
export async function adoptGuest(env, from, to, around = (statements) => statements) {
  for (let attempt = 0; ; attempt++) {
    const plan = await adoptStatements(env, from, to, { plain: attempt >= ADOPT_TRIES - 1 });
    const batch = around(plan.statements);
    let results;
    try { results = await env.DB.batch(batch); } catch (e) {
      if (plan.plain || !CHANGED.test(String(e?.message ?? e))) throw e;
      continue;
    }
    plan.report.moved = (results?.[batch.indexOf(plan.move)]?.results ?? []).filter((r) => r.game !== '').length;
    await plan.after();
    return plan.report;
  }
}

/** Server-only, idempotent bounded round receipts. Optimistic versions also
 * serialize simultaneous rooms without dropping either room's result. A player who was a guest and has since
 * signed in to their account is followed there (the forwarding row adoptStatements leaves), in the same query
 * that reads the record. */
export async function appendServerRecord(env,player,game,key,record){
 if(!game||!key.startsWith('server:')||!SAVE_KEY.test(key)||typeof record.id!=='string')throw new Error('invalid server record');
 for(let attempt=0,hops=0;attempt<16;attempt++){
  const rows=(await env.DB.prepare(`SELECT game,value,version,blob FROM saves WHERE player=?1 AND ((game=?2 AND key=?3) OR (game='' AND key='${MOVED_KEY}'))`).bind(player,game,key).all()).results??[];
  const moved=rows.find(r=>r.game==='');
  if(moved){
   let to=null;try{to=JSON.parse(moved.value)?.to;}catch{to=null;}
   if(typeof to!=='string'||!to||to===player||++hops>4)throw new Error('server record forwarding');
   player=to;attempt--;continue;
  }
  const row=rows[0]??null,old={value:row?await valueOf(env,row):null,version:row?Number(row.version):0},matches=Array.isArray(old.value?.matches)?old.value.matches:[];
  if(matches.some(r=>r.id===record.id))return;
  const kept=[record,...matches].sort(newestFirst(RECORDS.order,RECORDS.by)).slice(0,RECORDS.keep);
  let value=JSON.stringify({v:1,matches:kept}),bytes=bytesOf(value);
  while(bytes>SAVE_LIMITS.valueBytes&&kept.length>1){kept.pop();value=JSON.stringify({v:1,matches:kept});bytes=bytesOf(value);}
  if(bytes>SAVE_LIMITS.valueBytes)throw new Error('server record size');
  const result=old.version?await env.DB.prepare('UPDATE saves SET value=?4,bytes=?5,version=version+1,updated_at=?6 WHERE player=?1 AND game=?2 AND key=?3 AND version=?7 RETURNING version').bind(player,game,key,value,bytes,Date.now(),old.version).first():await env.DB.prepare(`INSERT INTO saves(player,game,key,value,bytes,version,updated_at,blob) SELECT ?1,?2,?3,?4,?5,1,?6,0 WHERE NOT EXISTS(SELECT 1 FROM saves WHERE player=?1 AND game='' AND key='${MOVED_KEY}') ON CONFLICT(player,game,key) DO NOTHING RETURNING version`).bind(player,game,key,value,bytes,Date.now()).first();
  if(result)return;
 }
 throw new Error('server record conflict; retry the durable outbox');
}
