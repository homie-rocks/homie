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
  return env.DB.prepare(`DELETE FROM saves WHERE player = ?1 AND game = ?2${kept.length ? ` AND key NOT IN (${marks})` : ''} RETURNING key, value, blob`).bind(player, game, ...kept);
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
  const rows = (await env.DB.prepare('SELECT game, key, value, bytes, version, updated_at, blob FROM saves WHERE player = ?1 ORDER BY game, key').bind(player).all()).results ?? [];
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
  const rows = (await env.DB.prepare('SELECT game, COUNT(*) AS keys, SUM(bytes) AS bytes, MAX(updated_at) AS at FROM saves WHERE player = ?1 GROUP BY game').bind(player).all()).results ?? [];
  return rows.map((r) => ({ game: r.game, keys: Number(r.keys), bytes: Number(r.bytes) || 0, updatedAt: Number(r.at) || null }));
}

/** The statements that delete a player's saves, stats and memorials (and their large saves' objects, after). */
export async function dropPlayerData(env, player) {
  const blobs = (await env.DB.prepare('SELECT value, blob FROM saves WHERE player = ?1 AND blob = 1').bind(player).all()).results ?? [];
  return {
    statements: [
      env.DB.prepare('DELETE FROM saves WHERE player = ?1').bind(player),
      env.DB.prepare('DELETE FROM player_stats WHERE player = ?1').bind(player),
      env.DB.prepare('DELETE FROM memorials WHERE player = ?1').bind(player),
    ],
    after: () => dropBlobs(env, blobs.map(blobKey)),
  };
}

/**
 * A guest signs in to an account they already have: the account keeps what it has, and whatever only the guest
 * had moves over (saves of keys the account lacks, stats it lacks, the guest's memorials). Statements for one
 * batch, and the guest's large saves that the account already had (to drop after).
 */
export async function adoptStatements(env, from, to) {
  const clash = (await env.DB.prepare('SELECT g.value, g.blob FROM saves g JOIN saves a ON a.player = ?2 AND a.game = g.game AND a.key = g.key WHERE g.player = ?1 AND g.blob = 1').bind(from, to).all()).results ?? [];
  return {
    statements: [
      env.DB.prepare('INSERT OR IGNORE INTO saves (player, game, key, value, bytes, version, updated_at, blob) SELECT ?2, game, key, value, bytes, version, updated_at, blob FROM saves WHERE player = ?1').bind(from, to),
      env.DB.prepare('INSERT OR IGNORE INTO player_stats (player, game, name, n, updated_at) SELECT ?2, game, name, n, updated_at FROM player_stats WHERE player = ?1').bind(from, to),
      env.DB.prepare('UPDATE memorials SET player = ?2 WHERE player = ?1').bind(from, to),
      env.DB.prepare('DELETE FROM saves WHERE player = ?1').bind(from),
      env.DB.prepare('DELETE FROM player_stats WHERE player = ?1').bind(from),
    ],
    after: () => dropBlobs(env, clash.map(blobKey)),
  };
}
