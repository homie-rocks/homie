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
const HOST = /^(?=.{3,80}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
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
  return `${VIA_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${shop.referrals.windowDays * 86400}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

/** The arrival this request's browser carries ({ via, at }), checked, or null. */
export async function arrivalOf(request, env) {
  const raw = /(?:^|;\s*)studio_via=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const m = /^([a-z0-9.-]{3,80})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(raw ?? '');
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
  if (touchAt !== null && now - touchAt > terms.windowDays * DAY) return [];
  let so = 0;
  try { so = Number((await env.DB.prepare("SELECT COALESCE(SUM(l.share), 0) AS n FROM referral_lines l JOIN shop_orders o ON o.id = l.order_id WHERE o.player = ?1 AND l.via = ?2 AND l.state != 'void'").bind(order.player, order.via).first())?.n) || 0; } catch { so = 0; }
  const share = Math.max(0, Math.min(Math.round(Number(order.amount) * terms.rate), terms.capPerPlayer - so));
  if (share <= 0) return [];
  const period = new Date(now).toISOString().slice(0, 7);
  return [env.DB.prepare("INSERT INTO referral_lines (order_id, via, net, rate, share, currency, state, period, hold_until, settled_ref, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, NULL, ?9) ON CONFLICT(order_id) DO NOTHING")
    .bind(order.id, order.via, Number(order.amount), terms.rate, share, order.currency, period, now + terms.holdDays * DAY, now)];
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
 * The seller's books per referrer: { via, currency, pending, owed, clawback, lines } (lines not yet settled, and
 * clawbacks), newest first. `period` (YYYY-MM) limits lines to sales up to the end of that month.
 */
export async function booksOf(env, { period = null, now = Date.now() } = {}) {
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT l.*, o.item, o.paid_at FROM referral_lines l JOIN shop_orders o ON o.id = l.order_id WHERE l.state IN ('pending', 'owed', 'clawback', 'void') ORDER BY l.created_at DESC LIMIT 2000").all()).results ?? [];
  } catch { return []; }
  const by = new Map();
  for (const r of rows) {
    if (period && r.period > period) continue;
    const b = by.get(r.via) ?? { via: r.via, currency: r.currency, pending: 0, owed: 0, clawback: 0, lines: [] };
    const state = lineState(r, now);
    if (state === 'pending') b.pending += Number(r.share);
    if (state === 'owed') b.owed += Number(r.share);
    if (state === 'clawback') b.clawback += Number(r.share);
    b.lines.push({ order: r.order_id, item: r.item, net: Number(r.net), rate: Number(r.rate), share: Number(r.share), state, period: r.period, date: new Date(Number(r.paid_at ?? r.created_at)).toISOString().slice(0, 10), holdUntil: Number(r.hold_until) });
    by.set(r.via, b);
  }
  return [...by.values()].map((b) => ({ ...b, due: b.owed - b.clawback }));
}

/** One referrer's signed statement for a period (no player, name or email in it: order hashes only). */
export async function statementFor(env, origin, book, period, terms) {
  const seller = origin;
  const lines = [];
  for (const l of book.lines) lines.push({ order: await orderHash(seller, l.order), item: l.item, net: l.net, share: l.share, date: l.date, state: l.state });
  const statement = {
    seller, referrer: book.via, period, currency: book.currency, issued: new Date().toISOString(),
    terms: terms ? { rate: terms.rate, holdDays: terms.holdDays, minimumInvoice: terms.minimumInvoice, basis: 'pre-tax' } : null,
    totals: { pending: book.pending, owed: book.owed, clawback: book.clawback, due: book.due },
    lines,
    note: 'Invoice the seller for "due" from your own Stripe (or the way its terms accept). Nothing moves through Homie.',
  };
  return signStatement(env, statement);
}

/** The owner marks what was paid (an invoice paid by card, a PayPal transfer): those owed lines are settled. */
export async function settle(env, via, ref, { now = Date.now() } = {}) {
  const h = hostOf(via);
  if (!h) return { ok: false, error: 'bad-request', message: 'via is the referrer\'s host' };
  const note = String(ref ?? '').replace(/[^\w .:#/-]/g, '').slice(0, 80) || 'paid';
  await env.DB.batch([
    env.DB.prepare("UPDATE referral_lines SET state = 'settled', settled_ref = ?2 WHERE via = ?1 AND state = 'pending' AND hold_until <= ?3").bind(h, note, now),
    env.DB.prepare("UPDATE referral_lines SET state = 'settled-clawback', settled_ref = ?2 WHERE via = ?1 AND state = 'clawback'").bind(h, note),
  ]);
  return { ok: true, via: h, ref: note };
}

/* ------------------------------------------------------------------ as a referrer */

const received = [];
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
  while (received.length && received[0] < now - 60_000) received.shift();
  if (received.length >= 30) return json({ ok: false, error: 'rate', message: 'too many statements; try again in a minute' }, 429);
  received.push(now);
  if (Number(request.headers.get('content-length') ?? 0) > 65_536) return json({ ok: false, error: 'too-large' }, 413);
  const text = await request.text();
  if (text.length > 65_536) return json({ ok: false, error: 'too-large' }, 413);
  let env0 = null;
  try { env0 = JSON.parse(text); } catch { return json({ ok: false, error: 'json' }, 400); }
  const s = env0?.statement;
  if (env0?.kind !== STATEMENT_KIND || !s || typeof s !== 'object') return json({ ok: false, error: 'not-a-statement' }, 400);
  if (hostOf(s.referrer) !== hostOf(url.hostname)) return json({ ok: false, error: 'not-ours', message: 'this statement names another referrer' }, 400);
  let seller = null;
  try { const u = new URL(String(s.seller)); seller = u.protocol === 'https:' && hostOf(u.hostname) ? u.origin : null; } catch { seller = null; }
  if (!seller || !/^\d{4}-\d{2}$/.test(String(s.period ?? ''))) return json({ ok: false, error: 'bad-statement' }, 400);
  let x = null;
  try {
    const res = await fetcher(`${seller}/.well-known/homie-studio.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    x = res.ok ? (await res.json())?.referrals?.key?.x ?? null : null;
  } catch { x = null; }
  if (!x || x !== env0.key || !(await verifyStatement(env0, x))) return json({ ok: false, error: 'signature', message: 'the signature does not match the key in the seller\'s own manifest' }, 401);
  const t = s.totals ?? {};
  try {
    await env.DB.prepare('INSERT INTO referral_statements (seller, period, owed, pending, currency, body, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(seller, period) DO UPDATE SET owed = excluded.owed, pending = excluded.pending, currency = excluded.currency, body = excluded.body, received_at = excluded.received_at')
      .bind(seller, s.period, Math.max(0, Math.floor(Number(t.due ?? t.owed) || 0)), Math.max(0, Math.floor(Number(t.pending) || 0)), String(s.currency ?? 'usd').slice(0, 3), text.slice(0, 65_536), Date.now()).run();
  } catch { return json({ ok: false, error: 'not-migrated', message: 'this studio has no referral tables yet (migration 0008)' }, 503); }
  return json({ ok: true, seller, period: s.period });
}

/** The statements other studios sent this one: what each says it owes. */
export async function statementsIn(env) {
  try {
    return ((await env.DB.prepare('SELECT seller, period, owed, pending, currency, received_at FROM referral_statements ORDER BY received_at DESC LIMIT 200').all()).results ?? [])
      .map((r) => ({ seller: r.seller, period: r.period, due: Number(r.owed), pending: Number(r.pending), currency: r.currency, receivedAt: Number(r.received_at) }));
  } catch { return []; }
}

/** Send each referrer its statement for `period` (to the address in its own manifest). */
export async function sendStatements(env, origin, shop, period, { fetcher = fetch } = {}) {
  const books = await booksOf(env, { period });
  const sent = [];
  for (const book of books) {
    const env0 = await statementFor(env, origin, book, period, shop?.referrals);
    let to = null;
    try {
      const m = await (await fetcher(`https://${book.via}/.well-known/homie-studio.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })).json();
      const st = String(m?.referrals?.statements ?? '');
      to = st.startsWith(`https://${book.via}/`) ? st : null;
    } catch { to = null; }
    if (!to) { sent.push({ via: book.via, ok: false, why: 'no statement address in its manifest' }); continue; }
    try {
      const res = await fetcher(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(env0), signal: AbortSignal.timeout(8000) });
      sent.push({ via: book.via, ok: res.ok, status: res.status, due: book.due });
    } catch (error) { sent.push({ via: book.via, ok: false, why: String(error?.message ?? error).slice(0, 80) }); }
  }
  return sent;
}
