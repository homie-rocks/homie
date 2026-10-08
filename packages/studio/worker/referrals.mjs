/**
 * REFERRALS (@homie-rocks/studio 0.24.0): one set of rules for every referrer, homie.rocks included.
 *
 *   arrival     A person's browser opens one of this studio's pages with ?via=<host> (a link from another studio,
 *               from homie.rocks, from anywhere). If this browser has never been here (no player of this site), the
 *               Worker keeps the host and the time in a signed cookie (HttpOnly, this site only, for the window).
 *               Prefetches, crawlers, this site itself and server rooms are never recorded.
 *   a sale      A paid order within the window, by an account made after that first visit, writes a referral line in
 *               THIS studio's D1 (the seller's books): the pre-tax price, the published rate, the share, held for
 *               `holdDays` (a refund or a lost dispute inside the hold voids it; after it, it nets off the next
 *               statement). The referrer must prove itself: its own /.well-known/homie-studio.json says it takes
 *               referral statements. No list anywhere says who is real; homie.rocks is not a registry.
 *   statements  Monthly, signed with this studio's own Ed25519 key (its public half is in the manifest): the order
 *               hashes, items, pre-tax amounts, dates and states, and what is owed. No player, name or email. POSTed
 *               to the referrer's /api/referrals/statement, which checks the signature against the seller's manifest.
 *   paying      Never through Homie. The referrer invoices the seller from its own Stripe (or PayPal, Wise, or the
 *               seller's gift codes); the seller pays the invoice. The office shows both sides and links to Stripe.
 */
import { isVisit } from './stats.mjs';

const DAY = 86_400_000;
export const VIA_COOKIE = 'studio_via';
const HOST = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const STATEMENT_KIND = 'homie-referral-statement';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));
const enc = new TextEncoder();

/** A host as a referrer names itself: lower-case, no port, no path, never an address. */
export function hostOf(raw) {
  const h = String(raw ?? '').trim().toLowerCase().replace(/^www\./, '');
  return HOST.test(h) && !/^\d+\.\d+\.\d+\.\d+$/.test(h) ? h : null;
}

/** JSON with sorted keys: what a signature covers, byte for byte, on both sides. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/* ------------------------------------------------------------------ this studio's secrets in D1 meta */

async function metaGet(env, key) {
  try { return (await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(key).first())?.value ?? null; } catch { return null; }
}
async function metaPutOnce(env, key, value) {
  await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING').bind(key, value).run();
  return metaGet(env, key);
}

let hmacCache = null;
/** The key that signs the arrival cookie (random, in D1 meta, made on first use). */
async function cookieKey(env) {
  if (hmacCache?.env === env) return hmacCache.key;
  let hex = await metaGet(env, 'referral_cookie_key');
  if (!hex) {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    hex = await metaPutOnce(env, 'referral_cookie_key', [...raw].map((b) => b.toString(16).padStart(2, '0')).join(''));
  }
  const bytes = Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  hmacCache = { env, key };
  return key;
}
const macOf = async (env, text) => b64url(await crypto.subtle.sign('HMAC', await cookieKey(env), enc.encode(text))).slice(0, 22);

let signingCache = null;
/** This studio's Ed25519 statement key (private half in D1 meta, made on first use; public half in the manifest). */
export async function signingKey(env) {
  if (signingCache?.env === env) return signingCache.pair;
  let stored = await metaGet(env, 'referral_signing_key');
  if (!stored) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    stored = await metaPutOnce(env, 'referral_signing_key', JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x }));
  }
  const jwk = JSON.parse(stored);
  const privateKey = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'], ext: true }, { name: 'Ed25519' }, false, ['sign']);
  const pair = { privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } };
  signingCache = { env, pair };
  return pair;
}

export async function signStatement(env, statement) {
  const { privateKey, publicJwk } = await signingKey(env);
  const sig = b64url(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(canonicalJson(statement))));
  return { v: 1, kind: STATEMENT_KIND, statement, sig, key: publicJwk.x };
}

/** Check a statement's signature against a public key (the `x` of the seller's manifest key). */
export async function verifyStatement(envelope, x) {
  try {
    if (envelope?.kind !== STATEMENT_KIND || typeof envelope.sig !== 'string' || typeof x !== 'string') return false;
    const pub = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x, ext: true }, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, pub, fromB64url(envelope.sig), enc.encode(canonicalJson(envelope.statement)));
  } catch { return false; }
}

/* ------------------------------------------------------------------ arrival */

/** Pages where an arrival may be recorded: the studio's own pages and Play; never a server's page or room. */
const ARRIVAL_PAGE = /^\/(?:|games\/|shop\/|[a-z0-9][a-z0-9-]{0,39}\/(?:play)?)$/;

/**
 * A Set-Cookie for this arrival, or null. Only a person's real page load (not a prefetch, a crawler or this site's
 * own link), with ?via=<host> of another site, from a browser with no player and no earlier arrival here, on a studio
 * that sells and pays referrals, never on a server's page or room.
 */
export async function arrivalCookie(request, env, url, shop) {
  if (!shop?.open || !shop.referrals || !env?.DB) return null;
  const via = hostOf(url.searchParams.get('via'));
  if (!via || via === hostOf(url.hostname)) return null;
  if (!ARRIVAL_PAGE.test(url.pathname) || url.searchParams.has('room') || url.searchParams.has('server')) return null;
  if (!isVisit(request)) return null;
  const cookies = request.headers.get('cookie') ?? '';
  // Been here before: a player of this site (a guest who saved, or an account), or an earlier arrival.
  if (/(?:^|;\s*)(?:studio_player|studio_via)=/.test(cookies)) return null;
  const at = Math.floor(Date.now() / 1000);
  const value = `${via}.${at}.${await macOf(env, `${via}.${at}`)}`;
  // Persistent integer lifetime; browsers may apply their own cookie retention policy.
  return `${VIA_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.min(2147483647, Math.max(1, Math.round((shop.referrals.windowDays ?? 24855) * 86400)))}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

/** The arrival this request's browser carries ({ via, at }), checked, or null. */
export async function arrivalOf(request, env) {
  const raw = /(?:^|;\s*)studio_via=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const m = /^([a-z0-9.-]{3,253})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(raw ?? '');
  if (!m || !hostOf(m[1])) return null;
  try { if (m[3] !== await macOf(env, `${m[1]}.${m[2]}`)) return null; } catch { return null; }
  return { via: m[1], at: Number(m[2]) * 1000 };
}

/* ------------------------------------------------------------------ is a referrer real? */

const proven = new Map();
/**
 * Whether `host` takes referral statements: its own manifest says so (fetched over https, cached a day; a failure is
 * cached an hour). `fetcher` is for tests.
 */
export async function referrerOk(host, { fetcher = fetch, now = Date.now() } = {}) {
  const h = hostOf(host);
  if (!h) return false;
  const hit = proven.get(h);
  if (hit && now - hit.at < (hit.ok ? DAY : 3_600_000)) return hit.ok;
  let ok = false;
  try {
    const res = await fetcher(`https://${h}/.well-known/homie-studio.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const m = await res.json();
      const st = String(m?.referrals?.statements ?? '');
      ok = m?.referrals?.accepts === true && st.startsWith(`https://${h}/`);
    }
  } catch { ok = false; }
  proven.set(h, { ok, at: now });
  if (proven.size > 2000) proven.clear();
  return ok;
}
/** For tests: forget what was proven. */
export function resetReferrers() { proven.clear(); }

/** What the manifest says about referrals: this studio takes statements (as a referrer) and, if it sells, its terms. */
export async function manifestReferrals(env, origin, shop, studio) {
  if (studio?.referrals === false || !env?.DB) return null;
  let key = null;
  try { key = (await signingKey(env)).publicJwk; } catch { key = null; }
  return {
    accepts: true,
    statements: `${origin}/api/referrals/statement`,
    ...(key ? { key } : {}),
    // The seller's terms, the same for every referrer (homie.rocks included); absent: this studio pays no referrals.
    ...(shop?.open && shop.referrals ? { terms: shop.referrals } : {}),
  };
}

/* ------------------------------------------------------------------ the seller's books */

/**
 * A paid order with an arrival on it: its referral line (pending, held), or nothing when the terms say no (rate 0, out
 * of the window, the per-player cap reached). Statements for D1's batch.
 */
export async function lineFor(env, order, shop, { touchAt = null, now = Date.now() } = {}) {
  const terms = shop?.referrals;
  if (!terms || !order.via || !(terms.rate > 0)) return [];
  if (touchAt !== null && terms.windowDays !== null && now - touchAt > Math.round(terms.windowDays * DAY)) return [];
  const share = Math.round(Number(order.amount) * terms.rate);
  if (!Number.isSafeInteger(share)) throw new RangeError('Referral share exceeds safe integer arithmetic; lower the studio rate or amount.');
  if (share <= 0) return [];
  const period = new Date(now).toISOString().slice(0, 7);
  // Compute remaining room in the INSERT itself: simultaneous paid orders share one exact cap.
  return [env.DB.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, settled_ref, created_at) SELECT ?1, ?2, ?3, ?4, CASE WHEN ?10 IS NULL THEN ?5 ELSE MAX(0, MIN(?5, ?10 - used)) END, ?6, 'pending', ?7, ?8, NULL, ?9 FROM (SELECT COALESCE(SUM(l.share), 0) AS used FROM referral_lines l JOIN shop_orders o ON o.id = l.order_id WHERE ?10 IS NOT NULL AND o.player = ?11 AND l.via = ?2 AND l.state != 'void') WHERE ?10 IS NULL OR used < ?10 ON CONFLICT(order_id) DO NOTHING")
    .bind(order.id, order.via, Number(order.amount), terms.rate, share, order.currency, period, now + Math.round((terms.holdDays ?? 0) * DAY), now, terms.capPerPlayer, order.player)];
}

/** A refund or a lost dispute: a held line is void; a settled one becomes a clawback that nets off the next statement. */
export function voidLineStatements(env, orderId) {
  return [
    env.DB.prepare("UPDATE referral_lines SET state = 'void' WHERE order_id = ?1 AND state IN ('pending', 'owed')").bind(orderId),
    env.DB.prepare("UPDATE referral_lines SET state = 'clawback' WHERE order_id = ?1 AND state = 'settled'").bind(orderId),
  ];
}

const lineState = (r, now) => (r.state === 'pending' && Number(r.hold_until) <= now ? 'owed' : r.state);

async function orderHash(seller, orderId) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${seller}|${orderId}`)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The seller's books page by referrer and currency; totals and counts include every open line.
 * `period` (YYYY-MM) limits lines to sales up to the end of that month. Lines have their own cursor.
 */
const readCursor = (cursor) => { try { const value = JSON.parse(cursor); return Array.isArray(value) && value.every((part) => typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part))) ? value : []; } catch { return []; } };
const openLines = "state IN ('pending', 'owed', 'clawback', 'void')";

export async function booksOf(env, { period = null, now = Date.now(), cursor = '', pageSize = 100, edition = null } = {}) {
  const parts = readCursor(cursor);
  const [via = '', currency = ''] = parts.length === 2 && parts.every((x) => typeof x === 'string') ? parts : [];
  // The index starts at the next referrer; each referrer's rows are aggregated once in a full traversal.
  const rows = (await env.DB.prepare(`SELECT via, currency, COUNT(*) AS lineCount,
    SUM(CASE WHEN state = 'pending' AND hold_until > ?2 THEN share ELSE 0 END) AS pending,
    SUM(CASE WHEN state = 'owed' OR (state = 'pending' AND hold_until <= ?2) THEN share ELSE 0 END) AS owed,
    SUM(CASE WHEN state = 'clawback' THEN share ELSE 0 END) AS clawback
    FROM ${edition ? 'referral_edition_lines' : 'referral_lines'} WHERE ${edition ? 'edition = ?6 AND' : ''} (via, currency) > (?3, ?4) AND ${openLines} AND (?1 IS NULL OR period <= ?1)
    GROUP BY via, currency ORDER BY via, currency LIMIT ?5`).bind(...[period, now, via, currency, pageSize + 1, ...(edition ? [edition] : [])]).all()).results ?? [];
  const more = rows.length > pageSize;
  if (more) rows.pop();
  const books = rows.map((r) => ({ ...r, due: r.owed - r.clawback }));
  return { books, nextCursor: more ? JSON.stringify([rows.at(-1).via, rows.at(-1).currency]) : null };
}

/** Lines inside one book, without repeating its totals. The covering prefix makes a full read linear. */
export async function linesOf(env, { via, currency, period = null, now = Date.now(), cursor = '', pageSize = 100, edition = null }) {
  const rows = (await env.DB.prepare(`SELECT l.*${edition ? '' : ', o.item, o.paid_at'} FROM ${edition ? 'referral_edition_lines l' : 'referral_lines l LEFT JOIN shop_orders o ON o.id = l.order_id'}
    WHERE ${edition ? 'l.edition = ?6 AND' : ''} l.via = ?1 AND l.currency = ?2 AND l.order_id > ?3 AND l.${openLines} AND (?4 IS NULL OR l.period <= ?4)
    ORDER BY l.order_id LIMIT ?5`).bind(...[via, currency, cursor, period, pageSize + 1, ...(edition ? [edition] : [])]).all()).results ?? [];
  const more = rows.length > pageSize;
  if (more) rows.pop();
  return { lines: rows.map((r) => ({ order: r.order_id, item: r.item ?? '', net: Number(r.net), rate: Number(r.rate), share: Number(r.share), state: lineState(r, now), period: r.period, date: new Date(Number(r.paid_at ?? r.created_at)).toISOString().slice(0, 10), holdUntil: Number(r.hold_until) })), nextCursor: more ? rows.at(-1).order_id : null };
}

/** One statement per referrer, continued by line pages; totals occur only on its first page. */
export async function statementPage(env, origin, terms, period, cursor = '', { snapshot = true } = {}) {
  let edition, after = '', via, currency, lineCursor = '';
  if (cursor) {
    const parts = readCursor(cursor);
    if (parts.length !== 5 || !parts.every((x) => typeof x === 'string')) return { statements: [], nextCursor: null, error: 'cursor' };
    [edition, after, via, currency, lineCursor] = parts;
    if ((snapshot ? !/^[a-f0-9-]{36}$/.test(edition) : !/^\d{13}$/.test(edition)) || (via && hostOf(via) !== via) || (currency && !/^[a-z]{3}$/.test(currency)) || lineCursor.length > 256) return { statements: [], nextCursor: null, error: 'cursor' };
  } else if (snapshot) {
    edition = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO referral_editions (id, period, issued) VALUES (?1, ?2, ?3)').bind(edition, period, Date.now()),
      env.DB.prepare(`INSERT INTO referral_edition_lines SELECT ?1, l.order_id, l.via, l.currency, l.net, l.rate, l.share, l.state, l.period, l.hold_until, l.created_at, o.item, o.paid_at FROM referral_lines l LEFT JOIN shop_orders o ON o.id = l.order_id WHERE l.${openLines} AND l.period <= ?2`).bind(edition, period),
    ]);
  }
  if (!snapshot && !edition) edition = String(Date.now());
  const sourceEdition = snapshot ? edition : null;
  const saved = snapshot ? await env.DB.prepare('SELECT issued FROM referral_editions WHERE id = ?1 AND period = ?2').bind(edition, period).first() : { issued: Number(edition) };
  if (!saved || !Number.isSafeInteger(saved.issued)) return { statements: [], nextCursor: null, error: 'cursor' };
  const issued = saved.issued;
  let book;
  if (!via) {
    const page = await booksOf(env, { period, cursor: after, pageSize: 1, now: issued, edition: sourceEdition });
    book = page.books[0];
    if (!book) {
      if (snapshot) await env.DB.batch([
        env.DB.prepare('DELETE FROM referral_edition_lines WHERE edition = ?1').bind(edition),
        env.DB.prepare('DELETE FROM referral_editions WHERE id = ?1').bind(edition),
      ]);
      return { statements: [], nextCursor: null };
    }
    via = book.via; currency = book.currency;
  } else {
    // A continuation must name a real line in this immutable edition, never a caller-selected host.
    if (!lineCursor || !(snapshot ? await env.DB.prepare('SELECT 1 FROM referral_edition_lines WHERE edition = ?1 AND via = ?2 AND currency = ?3 AND order_id = ?4').bind(edition, via, currency, lineCursor).first() : await env.DB.prepare('SELECT 1 FROM referral_lines WHERE via = ?1 AND currency = ?2 AND order_id = ?3').bind(via, currency, lineCursor).first())) return { statements: [], nextCursor: null, error: 'cursor' };
    book = { via, currency };
  }
  const page = await linesOf(env, { via, currency, period, cursor: lineCursor, now: issued, edition: sourceEdition });
  book.lines = page.lines;
  book.page = { cursor: lineCursor, nextCursor: page.nextCursor, issued };
  const envelope = await statementFor(env, origin, book, period, terms);
  // A following empty summary page terminates the walk, avoiding a second aggregate of this book.
  const nextCursor = page.nextCursor ? JSON.stringify([edition, after, via, currency, page.nextCursor]) : JSON.stringify([edition, JSON.stringify([via, currency]), '', '', '']);
  return { statements: [envelope], nextCursor };
}

/** One referrer's signed statement for a period (no player, name or email in it: order hashes only). */
export async function statementFor(env, origin, book, period, terms) {
  const seller = origin;
  const lines = [];
  for (const l of book.lines) lines.push({ order: await orderHash(seller, l.order), item: l.item, net: l.net, share: l.share, date: l.date, state: l.state });
  const statement = {
    seller, referrer: book.via, period, currency: book.currency, issued: new Date().toISOString(),
    terms: terms ? { rate: terms.rate, holdDays: terms.holdDays, minimumInvoice: terms.minimumInvoice, basis: 'pre-tax' } : null,
    ...(book.due !== undefined ? { totals: { pending: book.pending, owed: book.owed, clawback: book.clawback, due: book.due }, lineCount: book.lineCount } : {}),
    lines,
    page: book.page ?? { cursor: '', nextCursor: null },
    note: 'Invoice the seller for "due" from your own Stripe (or the way its terms accept). Nothing moves through Homie.',
  };
  return signStatement(env, statement);
}

/** The owner marks what was paid (an invoice paid by card, a PayPal transfer): those owed lines are settled. */
export async function settle(env, via, ref, { now = Date.now(), currency } = {}) {
  const h = hostOf(via);
  if (!/^[a-z]{3}$/.test(currency ?? '')) return { ok: false, error: 'currency', message: 'Name the currency to mark paid.' };
  if (!h) return { ok: false, error: 'bad-request', message: 'via is the referrer\'s host' };
  const note = String(ref ?? '').replace(/[^\w .:#/-]/g, '').slice(0, 80) || 'paid';
  await env.DB.batch([
    env.DB.prepare("UPDATE referral_lines SET state = 'settled', settled_ref = ?2 WHERE via = ?1 AND currency = ?4 AND (state = 'owed' OR (state = 'pending' AND hold_until <= ?3))").bind(h, note, now, currency),
    env.DB.prepare("UPDATE referral_lines SET state = 'settled-clawback', settled_ref = ?2 WHERE via = ?1 AND currency = ?3 AND state = 'clawback'").bind(h, note, currency),
  ]);
  return { ok: true, via: h, ref: note };
}

/* ------------------------------------------------------------------ as a referrer */

const received = new Map();
const positiveSetting = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('use a positive whole decimal number');
  return Number(value);
};
export function resetReferralLimits() { received.clear(); }
/**
 * POST /api/referrals/statement: a seller's signed statement to this studio. It must name this site as the referrer,
 * and its signature must check against the key in the SELLER's own manifest (fetched now, over https). Kept per
 * seller and period; a newer one replaces the older.
 */
export async function receiveStatement(request, env, url, { fetcher = fetch } = {}) {
  const json = (b, s = 200) => new Response(`${JSON.stringify(b)}\n`, { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  // A statement makes this Worker read the seller's manifest: a few a minute is all a real seller sends.
  const now = Date.now();
  const address = request.headers.get('cf-connecting-ip') || 'local';
  const attempts = (received.get(address) ?? []).filter((at) => at > now - 60000);
  let rate, globalRate, maxBytes;
  try {
    rate = positiveSetting(env.REFERRAL_STATEMENTS_PER_MINUTE, 30);
    globalRate = positiveSetting(env.REFERRAL_STATEMENTS_GLOBAL_PER_MINUTE, 30);
    maxBytes = positiveSetting(env.REFERRAL_STATEMENT_BYTES, 65536);
  } catch { return json({ ok: false, error: 'settings', message: 'REFERRAL_STATEMENTS_PER_MINUTE, REFERRAL_STATEMENTS_GLOBAL_PER_MINUTE and REFERRAL_STATEMENT_BYTES must be positive whole decimal numbers.' }, 503); }
  const global = (received.get('*') ?? []).filter((at) => at > now - 60000);
  if (global.length >= globalRate) return json({ ok: false, error: 'rate', message: 'The studio referral rate limit was reached; try again in a minute.' }, 429);
  global.push(now); received.set('*', global);
  if (attempts.length >= rate) return json({ ok: false, error: 'rate', message: 'The studio referral address rate limit was reached; try again in a minute.' }, 429);
  attempts.push(now); received.set(address, attempts);
  if (received.size > 10000) received.delete([...received.keys()].find((key) => key !== '*'));
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return json({ ok: false, error: 'too-large', message: 'The studio can raise REFERRAL_STATEMENT_BYTES for larger signed statements.' }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return json({ ok: false, error: 'too-large', message: 'The studio can raise REFERRAL_STATEMENT_BYTES for larger signed statements.' }, 413);
  let env0 = null;
  try { env0 = JSON.parse(text); } catch { return json({ ok: false, error: 'json' }, 400); }
  const s = env0?.statement;
  if (env0?.kind !== STATEMENT_KIND || !s || typeof s !== 'object') return json({ ok: false, error: 'not-a-statement' }, 400);
  if (hostOf(s.referrer) !== hostOf(url.hostname)) return json({ ok: false, error: 'not-ours', message: 'this statement names another referrer' }, 400);
  let seller = null;
  try { const u = new URL(String(s.seller)); seller = u.protocol === 'https:' && hostOf(u.hostname) ? u.origin : null; } catch { seller = null; }
  if (!/^[a-z]{3}$/.test(s.currency ?? '')) return json({ ok: false, error: 'currency' }, 400);
  if (!seller || !/^\d{4}-\d{2}$/.test(String(s.period ?? ''))) return json({ ok: false, error: 'bad-statement' }, 400);
  if (typeof (s.page?.cursor ?? '') !== 'string' || String(s.page?.cursor ?? '').length > 256 || (s.page?.nextCursor != null && (typeof s.page.nextCursor !== 'string' || s.page.nextCursor.length > 256))) return json({ ok: false, error: 'cursor' }, 400);
  let x = null;
  try {
    const res = await fetcher(`${seller}/.well-known/homie-studio.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    x = res.ok ? (await res.json())?.referrals?.key?.x ?? null : null;
  } catch { x = null; }
  if (!x || x !== env0.key || !(await verifyStatement(env0, x))) return json({ ok: false, error: 'signature', message: 'the signature does not match the key in the seller\'s own manifest' }, 401);
  const t = s.totals ?? {};
  try {
    const prefix = `referral-page:${seller}|${s.period}|${s.currency}|`;
    const cursor = s.page?.cursor ?? '';
    const prior = await env.DB.prepare('SELECT body FROM referral_statements WHERE seller = ?1 AND period = ?2 AND currency = ?3').bind(seller, s.period, s.currency).first();
    const previous = prior ? JSON.parse(prior.body).statement : null;
    const storedPage = await metaGet(env, prefix + cursor);
    if (storedPage && JSON.parse(storedPage).sig === env0.sig) return json({ ok: true, duplicate: true });
    if (cursor && (!previous || previous.page?.nextCursor !== cursor || previous.page?.issued !== s.page?.issued)) return json({ ok: false, error: 'page-order' }, 409);
    const writes = [];
    // A fresh first page replaces the previous edition, including all its old continuations.
    if (!cursor) writes.push(env.DB.prepare('DELETE FROM meta WHERE key >= ?1 AND key < ?2').bind(prefix, prefix + '\uffff'));
    writes.push(env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(prefix + cursor, text));
    if (!cursor) writes.push(env.DB.prepare('INSERT INTO referral_statements (seller, period, owed, pending, currency, body, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(seller, period, currency) DO UPDATE SET owed = excluded.owed, pending = excluded.pending, currency = excluded.currency, body = excluded.body, received_at = excluded.received_at')
      .bind(seller, s.period, Number(t.due ?? t.owed) || 0, Number(t.pending) || 0, String(s.currency ?? 'usd'), text, Date.now()));
    else writes.push(env.DB.prepare('UPDATE referral_statements SET body = ?3, received_at = ?4 WHERE seller = ?1 AND period = ?2 AND currency = ?5').bind(seller, s.period, text, Date.now(), s.currency));
    await env.DB.batch(writes);
  } catch { return json({ ok: false, error: 'not-migrated', message: 'this studio needs referral migrations 0008_studio_shop.sql and 0011_shop_statements.sql' }, 503); }
  return json({ ok: true, seller, period: s.period });
}

/** Stored signed pages, one bounded document at a time, with a continuation cursor. */
export async function receivedPages(env, seller, period, cursor = '') {
  const prefix = `referral-page:${seller}|${period}|`;
  const rows = (await env.DB.prepare('SELECT key, value FROM meta WHERE key >= ?1 AND key < ?2 AND key > ?3 ORDER BY key LIMIT 2').bind(prefix, prefix + '\uffff', cursor).all()).results ?? [];
  return { ok: true, statements: rows.length ? [JSON.parse(rows[0].value)] : [], nextCursor: rows.length > 1 ? rows[0].key : null };
}

/** The statements other studios sent this one: what each says it owes. */
export async function statementsIn(env) {
  try {
    return ((await env.DB.prepare('SELECT seller, period, owed, pending, currency, received_at FROM referral_statements ORDER BY received_at DESC LIMIT 200').all()).results ?? [])
      .map((r) => ({ seller: r.seller, period: r.period, due: Number(r.owed), pending: Number(r.pending), currency: r.currency, receivedAt: Number(r.received_at) }));
  } catch { return []; }
}

/** Send each referrer its statement for `period` (to the address in its own manifest). */
export async function sendStatements(env, origin, shop, period, { fetcher = fetch, cursor = '' } = {}) {
  // The server owns progress. A caller cursor can neither skip a page nor select a destination.
  const key = `referral-send:${origin}|${period}`;
  await metaPutOnce(env, key, JSON.stringify({ cursor: '', attempts: 0 }));
  const raw = await metaGet(env, key);
  let state = JSON.parse(raw);
  if (state.done) state = { cursor: '', attempts: 0 };
  if (state.nextAt > Date.now()) return { sent: [], nextCursor: 'resume', retryAfter: (state.nextAt - Date.now()) / 1000 };
  const locked = JSON.stringify({ ...state, nextAt: Date.now() + 30000 });
  const claim = await env.DB.prepare('UPDATE meta SET value = ?3 WHERE key = ?1 AND value = ?2').bind(key, raw, locked).run();
  if (!claim.meta?.changes) return { sent: [], nextCursor: 'resume', retryAfter: 2.1 };
  const save = async (value) => env.DB.prepare('UPDATE meta SET value = ?2 WHERE key = ?1').bind(key, JSON.stringify(value)).run();
  const page = state.page ?? await statementPage(env, origin, shop?.referrals, period, state.cursor);
  const envelope = page.statements[0];
  if (!envelope) { await save({ done: true, failures: state.failures ?? [] }); return { sent: [], nextCursor: null, failures: state.failures ?? [] }; }
  // Save the exact signed page BEFORE delivery: timeouts and process termination replay identical bytes.
  state.page = page;
  await save({ ...state, nextAt: Date.now() + 30000 });
  const via = envelope.statement.referrer;
  let result;
  try {
    const manifestResponse = await fetcher(`https://${via}/.well-known/homie-studio.json`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!manifestResponse.ok) throw new Error(`Manifest answered ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const to = new URL(String(manifest?.referrals?.statements ?? ''));
    if (to.protocol !== 'https:' || to.host !== via || to.username || to.password) throw new Error('no statement address in its manifest');
    const res = await fetcher(to.href, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope), signal: AbortSignal.timeout(8000) });
    result = { via, ok: res.ok, status: res.status };
  } catch (error) { result = { via, ok: false, why: String(error?.message ?? error).slice(0, 80) }; }
  if (!result.ok && state.attempts < 3) {
    const retryAfter = result.status === 429 ? 60 : 2 ** (state.attempts + 1);
    await save({ ...state, attempts: state.attempts + 1, nextAt: Date.now() + retryAfter * 1000 });
    return { sent: [], nextCursor: 'resume', retryAfter };
  }
  let next = page.nextCursor;
  if (!result.ok) {
    // Skip this referrer's remaining pages after a persistent failure; the next referrer still runs.
    const [edition] = readCursor(next);
    next = JSON.stringify([edition, JSON.stringify([via, envelope.statement.currency]), '', '', '']);
  }
  const retryAfter = 2.1;
  await save({ cursor: next, attempts: 0, failures: [...(state.failures ?? []), ...(!result.ok ? [result] : [])], nextAt: Date.now() + retryAfter * 1000, done: next === null });
  return { sent: [result], nextCursor: next === null ? null : 'resume', retryAfter };
}

export async function statementFailures(env) {
  const rows = (await env.DB.prepare("SELECT value FROM meta WHERE key >= 'referral-send:' AND key < 'referral-send;' ORDER BY key LIMIT 100").all()).results ?? [];
  return rows.flatMap((r) => JSON.parse(r.value).failures ?? []);
}

/** A default Send resumes an unfinished period even if the calendar month changed while closed. */
export async function pendingStatementPeriod(env, origin) {
  const prefix = `referral-send:${origin}|`;
  const row = await env.DB.prepare("SELECT key FROM meta WHERE key >= ?1 AND key < ?2 AND COALESCE(json_extract(value, '$.done'), 0) = 0 ORDER BY key LIMIT 1").bind(prefix, prefix + '\uffff').first();
  return row ? row.key.slice(prefix.length) : null;
}
