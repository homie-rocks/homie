/**
 * STUDIO METRICS: count, don't track (@homie-rocks/studio 0.6.0).
 *
 * Every studio counts, in its own Worker and its own D1, on Cloudflare's free plan. Nothing goes to a third
 * party, no cookie is set on a visitor, and no visitor is identified: a count is a number on a day, never a row
 * about a person. Referrers are kept as a host name only (never a path, a query or an address).
 *
 * WHAT IS COUNTED, one D1 row write each (an UPSERT on a daily counter; never per frame):
 *   visit   a page opened (home, a game's page, /music/, a song's page, /videos/, a video's page)
 *   play    a game's play page opened: somebody pressed Play (or followed a Play link or QR code)
 *   screen  a big screen opened (/<game>/tv)
 *   watch   a watch page opened (/<game>/watch: a live room from any player's view; 0.15.0)
 *   room    a room opened: the first seat taken in an empty room (public, or a named one)
 *   round   a round finished (source: `people` when a person was in it, `bots` when only bots were)
 *   humans  the people in finished rounds, summed
 *   peak    the most people playing one game at once that day (all its rooms), and peak-room in one room
 *   song    a song's player started; video: a video's player started
 *   agent-minutes   minutes an AI sat in a seat (an agent pass, NETPLAY.md section 17; 0.16.0), counted as it leaves
 *   brain-calls     AI guides' brain calls (0.17.0), by provider (workers-ai, owner-key): the house guides' alarms
 *   brain-neurons, brain-microdollars   what those calls used: Workers AI neurons, and the owner's own key in
 *                   millionths of a dollar. The day's budget (meta `brain_budget`) is read against these, every game.
 * A round's rows count agents as AI, never as people: `humans` is people only.
 * Each visit, play and screen row carries WHERE FROM: '' (typed, bookmarked, or this site's own link), the
 * referring site's host (homie.rocks, another studio, anywhere on the web), or `via:<tag>` from a ?via= link.
 * Concurrent players now come from the Lobby at read time; nothing stores them.
 *
 * WHAT IS NOT COUNTED: prefetches and prerenders, crawlers and link previews, anything that is not a browser
 * opening a page, and the house's own QA (a user agent tagged homie-house-qa or homie-studio-check).
 *
 * WHO READS THEM: only the studio's owner, whose proof is the studio's own Cloudflare login (Wrangler).
 *   `homie-studio stats`        prints them (a ten-minute read key, minted and dropped by the CLI)
 *   `homie-studio stats key`    a read key for the Homie MCP tool `studio_stats` (1 hour by default)
 *   `homie-studio stats link`   a one-time sign-in link: /_studio/stats in the owner's own browser
 *   `homie-studio office key`   a back-office key (it reads these too): worker/office.mjs
 * A key is 24 random bytes; D1 keeps only its SHA-256. The page's session cookie is the owner's alone
 * (HttpOnly, SameSite=Lax; from 0.13.0 at / so the owner is recognised in their own games, never readable by a
 * page or a game). There is no other way in.
 *
 * FREE PLAN: D1 allows 100,000 row writes and 5 million row reads a day. A visit, a play, a room and a
 * song or video start are one write each; a finished round is three (its row in `rounds`, the round and the
 * humans counters). Past the day's writes, counting stops until 00:00 UTC and the site keeps working.
 */

export const STATS_MIGRATION_FILE = '0002_studio_stats.sql';
export const STATS_MIGRATION = `-- Studio metrics (@homie-rocks/studio 0.6.0): daily counters. Count, don't track: no row is about a person.
CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  subject TEXT NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric, subject, source)
) WITHOUT ROWID;
-- The owner's read keys and page sessions: only a SHA-256 of each, never the key.
CREATE TABLE IF NOT EXISTS stats_keys (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
`;

export const METRICS = Object.freeze(['visit', 'play', 'screen', 'watch', 'room', 'round', 'humans', 'peak', 'peak-room', 'song', 'video', 'agent-minutes', 'brain-calls', 'brain-neurons', 'brain-microdollars',
  // Room chat (0.23.0): lines and reactions sent, messages held (by why: words, link, ai…), the review's calls and neurons.
  // Counts only: never a message, never who.
  'chat-lines', 'chat-reacts', 'chat-held', 'chat-reviews', 'chat-neurons']);
const MAX_METRICS = new Set(['peak', 'peak-room']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^hsk_[a-f0-9]{48}$/;
const SESSION = /^[a-f0-9]{64}$/;
export const OWNER_COOKIE = 'studio_owner';
const HOUR = 3600_000;

export const today = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
const dayOffset = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ counting */

/** A statement that adds `n` to one counter (or keeps the larger, for peaks), for a D1 batch. */
export function counter(env, { metric, subject = '', source = '', n = 1, day = today() }) {
  if (!env?.DB || !METRICS.includes(metric)) return null;
  const sql = MAX_METRICS.has(metric)
    ? 'INSERT INTO stats_daily (day, metric, subject, source, n) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(day, metric, subject, source) DO UPDATE SET n = max(n, excluded.n)'
    : 'INSERT INTO stats_daily (day, metric, subject, source, n) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(day, metric, subject, source) DO UPDATE SET n = n + excluded.n';
  return env.DB.prepare(sql).bind(day, metric, String(subject).slice(0, 80), String(source).slice(0, 80), Math.max(0, Math.floor(Number(n) || 0)));
}

/** Run a counter write after the response (ctx.waitUntil), or before it when the caller gave no ctx. Never throws. */
export async function count(env, ctx, row) {
  const stmt = counter(env, row);
  if (!stmt) return;
  const p = stmt.run().catch(() => {}); // before migration 0002, or past the free plan's daily writes: not counted
  if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
}

// Crawlers, link previews, fetch libraries and headless browsers: not a person opening a page.
const NOT_A_PERSON = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|skype|curl|wget|python|go-http|java\/|okhttp|node-fetch|undici|axios|headless|lighthouse|pagespeed|homie-house-qa|homie-studio-check|homie-directory/i;

const QA = /homie-house-qa|homie-studio-check/i;
/** House QA and `homie-studio check` tag their user agents: their visits, rooms, rounds and peaks are not counted. */
export const isQa = (request) => QA.test(request.headers.get('user-agent') ?? '');

/**
 * Whether this request is a person's browser opening a page: a GET navigation (Sec-Fetch-Dest: document, or an
 * HTML Accept from a browser too old to say), not a prefetch or prerender, not a crawler, not house QA.
 */
export function isVisit(request) {
  if (request.method !== 'GET') return false;
  const h = request.headers;
  const dest = h.get('sec-fetch-dest');
  if (dest ? dest !== 'document' : !/text\/html/.test(h.get('accept') ?? '')) return false;
  if (/prefetch|prerender/i.test(`${h.get('sec-purpose') ?? ''} ${h.get('purpose') ?? ''} ${h.get('x-purpose') ?? ''} ${h.get('x-moz') ?? ''}`)) return false;
  const ua = h.get('user-agent') ?? '';
  if (!ua || NOT_A_PERSON.test(ua)) return false;
  return true;
}

/** Where a visit came from: '' for this site or no referrer, the referring host, or `via:<tag>`. A host, never a path. */
export function sourceOf(request, url) {
  let host = '';
  try { host = new URL(request.headers.get('referer') ?? '').host.toLowerCase(); } catch { host = ''; }
  if (host.startsWith('www.')) host = host.slice(4);
  const self = url.host.toLowerCase().replace(/^www\./, '');
  if (host && host !== self && /^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) return host.slice(0, 80);
  const via = url.searchParams.get('via') ?? '';
  return /^[a-z0-9][a-z0-9.-]{0,39}$/i.test(via) ? `via:${via.toLowerCase()}` : '';
}

/** Count one page view: `metric` visit, play or screen, of `subject`. For a studio's own wrapper pages too. */
export async function countVisit(request, env, ctx, subject, metric = 'visit') {
  if (!isVisit(request)) return;
  const url = new URL(request.url);
  await count(env, ctx, { metric, subject, source: sourceOf(request, url) });
}

/* ------------------------------------------------------------------ the owner's keys */

/**
 * Whether a presented key (Bearer header) or the owner's page session is valid, and which: `read` (a stats read
 * key), `office` (a back-office key: the stats, the live rooms, and asking for the owner's controls; worker/office.mjs)
 * or `session` (the owner's signed-in browser). A key's kind is fixed when it is minted; an office key also reads
 * the stats.
 */
export async function ownerAllowed(request, env, { kinds = ['read', 'session'] } = {}) {
  if (!env?.DB) return false;
  const auth = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? null;
  const tries = [];
  if (bearer && KEY.test(bearer) && (kinds.includes('read') || kinds.includes('office'))) tries.push([['read', 'office'].filter((k) => kinds.includes(k)), bearer]);
  // The session cookie lives at / from 0.13.0 (the owner is recognised in their own game) and at /_studio/ before
  // it: a browser may send both, so each is tried.
  if (kinds.includes('session')) for (const cookie of cookieValues(request, OWNER_COOKIE).filter((v) => SESSION.test(v)).slice(0, 3)) tries.push([['session'], cookie]);
  for (const [allowed, value] of tries) {
    try {
      const row = await env.DB.prepare('SELECT kind, expires_at FROM stats_keys WHERE hash = ?1').bind(await sha256(value)).first();
      if (row && allowed.includes(row.kind) && Number(row.expires_at) > Date.now()) return row.kind;
    } catch { return false; }
  }
  return false;
}

/** The owner's valid page session value this request carries, or null (to carry an older /_studio/ cookie to /). */
export async function ownerSession(request, env) {
  if (!env?.DB) return null;
  for (const cookie of cookieValues(request, OWNER_COOKIE).filter((v) => SESSION.test(v)).slice(0, 3)) {
    try {
      const row = await env.DB.prepare('SELECT kind, expires_at FROM stats_keys WHERE hash = ?1').bind(await sha256(cookie)).first();
      if (row && row.kind === 'session' && Number(row.expires_at) > Date.now()) return cookie;
    } catch { return null; }
  }
  return null;
}

export function cookieValue(request, name) {
  return cookieValues(request, name)[0] ?? null;
}

/** Every value a request carries for one cookie name (the same name can arrive from two paths). */
export function cookieValues(request, name) {
  const out = [];
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) out.push(v.join('='));
  }
  return out;
}

/** A one-time sign-in key turns into a 30-day page session (the key is spent). Returns the session value or null. */
export async function spendSignin(env, key) {
  if (!env?.DB || !KEY.test(String(key ?? ''))) return null;
  const hash = await sha256(key);
  try {
    const row = await env.DB.prepare('SELECT kind, expires_at FROM stats_keys WHERE hash = ?1').bind(hash).first();
    if (!row || row.kind !== 'signin' || Number(row.expires_at) <= Date.now()) return null;
    const session = randomHex(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats_keys WHERE hash = ?1').bind(hash),
      env.DB.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?1, 'session', ?2)").bind(await sha256(session), Date.now() + 30 * 24 * HOUR),
      env.DB.prepare('DELETE FROM stats_keys WHERE expires_at < ?1').bind(Date.now()),
    ]);
    return session;
  } catch { return null; }
}

export async function endSession(env, request) {
  if (!env?.DB) return;
  for (const cookie of cookieValues(request, OWNER_COOKIE).filter((v) => SESSION.test(v)).slice(0, 3)) {
    try { await env.DB.prepare("DELETE FROM stats_keys WHERE hash = ?1 AND kind = 'session'").bind(await sha256(cookie)).run(); } catch { /* gone */ }
  }
}

/* ------------------------------------------------------------------ reading */

/** The day range a request asks for: ?range=1d|7d|30d|90d (default 7d), or ?from=&to= (UTC days, up to 366). */
export function rangeOf(params, now = Date.now()) {
  const end = today(now);
  const from = params.get('from');
  const to = params.get('to');
  if (from && DAY.test(from)) {
    const last = to && DAY.test(to) && to <= end ? to : end;
    const first = from <= last ? from : last;
    const span = Math.round((Date.parse(last) - Date.parse(first)) / 86400_000) + 1;
    return span > 366 ? { from: dayOffset(last, -365), to: last, days: 366 } : { from: first, to: last, days: span };
  }
  const days = { '1d': 1, today: 1, '7d': 7, week: 7, '30d': 30, month: 30, '90d': 90 }[params.get('range') ?? '7d'] ?? 7;
  return { from: dayOffset(end, -(days - 1)), to: end, days };
}

/**
 * Player accounts (0.12.0, worker/players.mjs): how many, never who. Null before migration 0004 or with no D1.
 * `accounts` have a passkey; `guests` saved something without one; `active7d` played in the last 7 days.
 */
export async function playersNow(env) {
  if (!env?.DB) return null;
  const now = Date.now();
  try {
    const r = await env.DB.prepare('SELECT SUM(guest = 0) AS accounts, SUM(guest = 1) AS guests, SUM(guest = 0 AND created_at >= ?1) AS new7d, SUM(seen_at >= ?1) AS active7d FROM players').bind(now - 7 * 86400_000).first();
    return { accounts: Number(r?.accounts) || 0, guests: Number(r?.guests) || 0, newAccounts7d: Number(r?.new7d) || 0, active7d: Number(r?.active7d) || 0 };
  } catch { return null; }
}

/** The Lobby's count of people in every room of each game, right now. */
async function playingNow(env, games) {
  const out = {};
  await Promise.all(games.map(async (g) => {
    try {
      const res = await env.LOBBY.get(env.LOBBY.idFromName(g.id)).fetch('https://lobby/now');
      const body = await res.json();
      out[g.id] = { players: Number(body.players) || 0, rooms: Number(body.rooms) || 0 };
    } catch { out[g.id] = { players: 0, rooms: 0 }; }
  }));
  return out;
}

const HUB = /^(?:www\.)?homie\.rocks$/;
/**
 * What a referring host is: `hub` (homie.rocks, the directory), `studio` (a Homie studio: any *.homie.rocks studio
 * address, or a site the caller knows is one), `search`, or `web`. homie.rocks's `studio_stats` passes the
 * directory's sites; the studio's own page passes none.
 */
export function kindOf(host, studios = new Set()) {
  if (host.startsWith('via:')) return 'link';
  if (HUB.test(host)) return 'hub';
  if (studios.has(host) || /\.homie\.rocks$/.test(host)) return 'studio';
  if (/(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|kagi)\.[a-z.]+$/.test(host) || /^search\./.test(host)) return 'search';
  return 'web';
}

/**
 * The numbers for a day range: totals, per game, per song and video, referrers (each with its kind), and one
 * row per day. `only` narrows to one game, song or video. Reads one D1 query (rows in range) and each Lobby.
 */
export async function readStats(env, cat, { range, only = null, studios = new Set() } = {}) {
  const rows = (await env.DB.prepare('SELECT day, metric, subject, source, n FROM stats_daily WHERE day >= ?1 AND day <= ?2 LIMIT 50000')
    .bind(range.from, range.to).all()).results ?? [];
  const games = (cat.games ?? []).filter((g) => !only || (only.kind === 'game' && only.id === g.id));
  const songs = (cat.songs ?? []).filter((e) => !only || (only.kind === 'song' && only.id === e.slug));
  const videos = (cat.videos ?? []).filter((e) => !only || (only.kind === 'video' && only.id === e.slug));
  const page = only && only.kind !== 'game' ? `${only.kind === 'song' ? 'music' : 'videos'}/${only.id}` : null;
  const inScope = (r) => !only
    || (only.kind === 'game' ? r.subject === only.id && r.metric !== 'song' && r.metric !== 'video' : r.subject === page || (r.metric === only.kind && r.subject === only.id));
  const scoped = rows.filter(inScope);
  const sum = (pred) => scoped.reduce((n, r) => n + (pred(r) ? Number(r.n) : 0), 0);
  const maxOf = (pred) => scoped.reduce((n, r) => Math.max(n, pred(r) ? Number(r.n) : 0), 0);
  const [now, people] = await Promise.all([playingNow(env, games), only ? null : playersNow(env)]);
  const perGame = games.map((g) => {
    const of = (m, extra = () => true) => sum((r) => r.metric === m && r.subject === g.id && extra(r));
    return {
      id: g.id, name: g.name, seats: g.players?.max ?? null,
      visits: of('visit'), plays: of('play'), screens: of('screen'), watches: of('watch'), rooms: of('room'),
      rounds: of('round'), roundsWithPeople: of('round', (r) => r.source === 'people'), peopleInRounds: of('humans'),
      peakPlayers: maxOf((r) => r.metric === 'peak' && r.subject === g.id), peakInOneRoom: maxOf((r) => r.metric === 'peak-room' && r.subject === g.id),
      agentMinutes: of('agent-minutes'),
      playingNow: now[g.id]?.players ?? 0, roomsNow: now[g.id]?.rooms ?? 0,
    };
  });
  const media = (list, kind, dir) => list.map((e) => ({
    slug: e.slug, title: e.title,
    visits: sum((r) => r.metric === 'visit' && r.subject === `${dir}/${e.slug}`),
    [kind === 'song' ? 'plays' : 'views']: sum((r) => r.metric === kind && r.subject === e.slug),
  }));
  const refs = new Map();
  for (const r of scoped) {
    if (!r.source || !['visit', 'play', 'screen'].includes(r.metric)) continue;
    const x = refs.get(r.source) ?? { from: r.source, kind: kindOf(r.source, studios), visits: 0, plays: 0 };
    if (r.metric === 'play') x.plays += Number(r.n); else x.visits += Number(r.n);
    refs.set(r.source, x);
  }
  const referrers = [...refs.values()].sort((a, b) => (b.visits + b.plays) - (a.visits + a.plays)).slice(0, 100);
  const byKind = (k) => referrers.filter((x) => x.kind === k).reduce((n, x) => n + x.visits + x.plays, 0);
  const days = [];
  for (let d = range.from; d <= range.to; d = dayOffset(d, 1)) {
    const of = (m) => scoped.reduce((n, r) => n + (r.day === d && r.metric === m ? Number(r.n) : 0), 0);
    days.push({ day: d, visits: of('visit'), plays: of('play'), rounds: of('round'), people: of('humans'), songs: of('song'), videos: of('video') });
  }
  return {
    v: 1, kind: 'homie-studio-stats', studio: cat.studio?.name ?? null, range, ...(only ? { only } : {}),
    totals: {
      visits: sum((r) => r.metric === 'visit'), plays: sum((r) => r.metric === 'play'), screens: sum((r) => r.metric === 'screen'), watches: sum((r) => r.metric === 'watch'),
      rooms: sum((r) => r.metric === 'room'), rounds: sum((r) => r.metric === 'round'), roundsWithPeople: sum((r) => r.metric === 'round' && r.source === 'people'),
      peopleInRounds: sum((r) => r.metric === 'humans'), songPlays: sum((r) => r.metric === 'song'), videoViews: sum((r) => r.metric === 'video'),
      agentMinutes: sum((r) => r.metric === 'agent-minutes'),
      peakPlayers: Math.max(0, ...perGame.map((g) => g.peakPlayers)), peakInOneRoom: Math.max(0, ...perGame.map((g) => g.peakInOneRoom)),
      playingNow: perGame.reduce((n, g) => n + g.playingNow, 0),
    },
    // Player accounts (saves/SAVES.md): counts only, never a name, a passkey or an email.
    ...(people ? { players: people } : {}),
    crossings: { fromHub: byKind('hub'), fromStudios: byKind('studio'), fromSearch: byKind('search'), fromWeb: byKind('web'), fromLinks: byKind('link') },
    // The studio's own pages: its home, and the /music/ and /videos/ lists (a catalogue's road).
    pages: Object.fromEntries(['home', 'games', 'rooms', 'posts', 'music', 'videos'].map((p) => [p, sum((r) => r.metric === 'visit' && r.subject === p)])),
    games: perGame, songs: media(songs, 'song', 'music'), videos: media(videos, 'video', 'videos'), referrers, days,
    note: 'Counts, never people: a visit is a page a browser opened, a play is a Play press, a round is a finished round. Prefetches, crawlers and house QA are not counted. Times are UTC days.',
  };
}

/**
 * What a studio that shares may tell the directory: Play presses and rounds with people in the last 7 days. With
 * `game`, one game's (a landing shows them).
 */
export async function playedThisWeek(env, game = null) {
  if (!env?.DB) return null;
  const to = today();
  try {
    const row = await env.DB.prepare(`SELECT SUM(CASE WHEN metric = 'play' THEN n ELSE 0 END) AS plays, SUM(CASE WHEN metric = 'round' AND source = 'people' THEN n ELSE 0 END) AS rounds FROM stats_daily WHERE day >= ?1 AND day <= ?2 AND metric IN ('play', 'round')${game ? ' AND subject = ?3' : ''}`)
      .bind(dayOffset(to, -6), to, ...(game ? [String(game)] : [])).first();
    return { days: 7, plays: Number(row?.plays) || 0, rounds: Number(row?.rounds) || 0, to };
  } catch { return null; }
}

/**
 * "Played this week" for every game at once (one query, grouped by game), for the manifest's `games[].played`
 * when the studio shares its numbers: `{ [game]: { days: 7, plays, rounds } }`, or null when the counters cannot be
 * read (before migration 0002, or no D1). A game nobody played this week is absent: its numbers are 0.
 */
export async function playedByGame(env) {
  if (!env?.DB) return null;
  const to = today();
  try {
    const { results } = await env.DB.prepare(`SELECT subject, SUM(CASE WHEN metric = 'play' THEN n ELSE 0 END) AS plays, SUM(CASE WHEN metric = 'round' AND source = 'people' THEN n ELSE 0 END) AS rounds FROM stats_daily WHERE day >= ?1 AND day <= ?2 AND metric IN ('play', 'round') GROUP BY subject`)
      .bind(dayOffset(to, -6), to).all();
    const out = {};
    for (const row of results ?? []) if (SLUG.test(String(row.subject ?? ''))) out[row.subject] = { days: 7, plays: Number(row.plays) || 0, rounds: Number(row.rounds) || 0 };
    return out;
  } catch { return null; }
}

/** Parse ?game= / ?song= / ?video= into one narrowing, or null. */
export function onlyOf(params) {
  for (const kind of ['game', 'song', 'video']) {
    const id = params.get(kind);
    if (id && SLUG.test(id)) return { kind, id };
  }
  return null;
}
