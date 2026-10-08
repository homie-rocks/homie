/**
 * THE SHOP (@homie-rocks/studio 0.24.0): a studio sells with ITS OWN Stripe account (shop/SHOP.md is the guide).
 * The studio is the seller; homie.rocks never sees, holds or moves its money, and Homie takes no cut.
 *
 *   GET  /api/shop               the items, each with how THIS player may get it (shop-rules.mjs wayFor); on a kids
 *                                server or studio, the studio policy applies; until set up, { open: false, missing: [...] }
 *   POST /api/shop/age           the neutral age question, once per account: a year of birth, kept only as a band
 *   POST /api/shop/buy           a permitted buyer buys one item: an order row, then Stripe's own hosted Checkout page
 *   POST /api/shop/parent        studio parent policy: a one-time link a parent opens on their own device (/shop/parent/<token>)
 *   POST /api/shop/hook          Stripe's webhook, signature checked; verified Stripe events record paid, refunded, disputed
 *   POST /api/shop/used          the game says an item was used (equipped, played): it leaves the self-serve refund
 *   POST /api/shop/refund        the player's own refund of an unused item within the studio's refund days
 *   GET  /api/player/owns        what the signed-in player owns (the keys the game reads; a beginner or kids server
 *                                follows the studio advantage settings)
 *   GET  /api/shop/mine          the player's orders and what they own (the account page)
 *   GET  /shop/  /shop/thanks  /shop/refunds/  /shop/parent/<token>   the pages (worker/shop-page.mjs)
 *   POST /api/referrals/statement   another studio's signed referral statement to this one (worker/referrals.mjs)
 *
 * THE OFFICE (worker/office.mjs routes them): sales, refunds, disputes and payouts as links to the studio's own Stripe
 * Dashboard, a CSV for the accountant, the referral books and signed statements. A refund is the owner's one tap; the
 * owner's AI (an office key) can only ASK for one, which the owner confirms with one tap. A dispute never touches the
 * player's account: it changes nothing until it is decided, and a lost one is a refund of that one item.
 *
 * SECRETS (Worker secrets, put there by `homie-studio shop connect` from a page on the owner's own computer):
 * STRIPE_KEY (a restricted key: Checkout Sessions write, Charges write for refunds, PaymentIntents and Disputes read;
 * from 0.24.3 also Webhook Endpoints write, which only the connect page on the owner's computer uses) and
 * STRIPE_WEBHOOK_SECRET. Never in a file, a chat, a log or a page.
 *
 * THE CATALOG (0.24.3): once `homie-studio shop catalog` has made the items' Products in Stripe (shop.json `catalog`
 * names the modes), a checkout names its item's Product, so the Dashboard, Stripe's reports and Stripe's MCP see sales
 * by product. The price is always shop.json's (the rules checked it), never one read from Stripe. A Product missing
 * in this mode falls back to the item described inline, so a sale never fails over the catalog.
 */
import { players } from './players.mjs';
import { serversOf } from './servers.mjs';
import { ENTITLEMENT_KEY, checkoutMessage, amountError, amountStep, parseAmount, currencyScale, audienceOf, bandOf, checkShop, defaultTaxCode, money, wayFor } from './shop-rules.mjs';
import {
  bandOfPlayer, forgetPlayerShop, grantStatements, migrationNeeded, migrated, newOrderId, orderById, orderByPayment, orderBySession, orderView, playerOrderStatus, ownsOf, restoreStatement, revokeStatement,
  setBand, shopDataOf, spentThisMonth,
} from './shop-store.mjs';
import { KEY_SHAPE, stripeCall, StripeError, WEBHOOK_SECRET_SHAPE, createCheckoutSession, createRefund, expireCheckoutSession, dashboardLink, isApprovalRequired, isMissingProduct, modeOf, productIdOf, verifyWebhook } from './stripe.mjs';
import { pendingStatementPeriod, statementFailures, arrivalOf, booksOf, linesOf, statementPage, lineFor, receiveStatement, receivedPages, referrerOk, sendStatements, settle, statementsIn, voidLineStatements } from './referrals.mjs';
import { SHOP_JS, officeShopPage, parentPage, refundsPage, shopPage, thanksPage } from './shop-page.mjs';
import { notFoundPage } from './site.mjs';

export { linesOf, forgetPlayerShop, officeShopPage, receivedPages, shopDataOf };

const DAY = 86_400_000;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVER_ID = /^(?:public|[a-z0-9][a-z0-9-]{1,19})$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** In-memory, per Worker instance: purchase attempts a minute per account and address. Never stored. */
const addressOf = (request) => request.headers.get('cf-connecting-ip') || 'local';

const json = (body, status = 200, headers = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', ...headers },
});
const fail = (status, error, message, extra = {}) => json({ ok: false, error, message, ...extra }, status);

const buckets = new Map();
const accountBuckets = new Map();
function limited(key, max, windowMs, now = Date.now()) {
  const counts = key.includes(':account:') ? accountBuckets : buckets;
  const list = (counts.get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length >= max) { counts.set(key, list); return true; }
  list.push(now);
  counts.set(key, list);
  if (counts.size > 10_000) counts.delete(counts.keys().next().value);
  return false;
}
/** For tests: forget every count. */
export function resetShopLimits() { buckets.clear(); accountBuckets.clear(); }

const sha256Hex = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
function randomToken() {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
async function bodyOf(request, max = 4096) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return { error: fail(415, 'json', 'send JSON (content-type: application/json)') };
  const text = await request.text();
  if (text.length > max) return { error: fail(413, 'too-large', 'that request is too large') };
  try { const b = text ? JSON.parse(text) : {}; return b && typeof b === 'object' && !Array.isArray(b) ? { body: b } : { error: fail(400, 'json', 'send a JSON object') }; } catch { return { error: fail(400, 'json', 'that is not JSON') }; }
}

/* ------------------------------------------------------------------ the shop and whether it is open */

const sizes = new WeakMap();
function requestSize(shop) {
  if (sizes.has(shop)) return sizes.get(shop);
  const size = (shop?.items ?? []).reduce((size, item) => (item.gives ?? []).reduce((n, key) => Math.max(n, JSON.stringify(key).length), Math.max(size, JSON.stringify(item.id).length)), 0) * 6 + 4096;
  sizes.set(shop, size);
  return size;
}
const shopCache = new WeakMap();
/**
 * The studio's shop, checked against its chosen settings and provider requirements at build and request time. null when the studio has no shop.json.
 */
export function shopOf(cat) {
  if (!cat?.shop) return null;
  if (shopCache.has(cat)) return shopCache.get(cat);
  const games = (cat.games ?? []).map((g) => g.id);
  const r = checkShop(cat.shop, { games: games.length ? games : null, audience: audienceOf(cat.studio), studioName: cat.studio?.name });
  const shop = r.ok ? r.shop : { ...r.shop, open: false, broken: r.errors.slice(0, 5) };
  shopCache.set(cat, shop);
  return shop;
}

/** What is missing before anything is sold, in order, each with what to do. Nothing secret is read out. */
export async function readiness(env, shop) {
  const missing = [];
  if (!shop) missing.push('shop.json');
  else if (shop.audience === 'kids') missing.push('kids-studio');
  else if (shop.broken) missing.push('shop.json-refused');
  else if (shop.till === 'off') missing.push('till-off');
  else if (!shop.items.length) missing.push('items');
  const key = String(env?.STRIPE_KEY ?? '');
  if (/^sk_live_/.test(key)) missing.push('restricted-key');
  else if (!KEY_SHAPE.test(key)) missing.push('stripe-key');
  if (!WEBHOOK_SECRET_SHAPE.test(String(env?.STRIPE_WEBHOOK_SECRET ?? ''))) missing.push('webhook-secret');
  let migration = null;
  if (!env?.DB || env.HOMIE_PREVIEW === '1') missing.push('database');
  else if ((migration = await migrationNeeded(env))) missing.push('migration');
  return { ready: missing.length === 0, missing, migration, mode: KEY_SHAPE.test(key) ? modeOf(key) : null };
}

export const MISSING_WORDS = Object.freeze({
  'shop.json': 'This studio has no shop.json: nothing is for sale (homie-studio shop init writes one).',
  'kids-studio': 'This studio is made for children (studio.json "audience": "kids"): its policy.kidsStudio setting closes the shop.',
  'shop.json-refused': 'shop.json conflicts with the studio settings or payment requirements (homie-studio shop check says which), so nothing is sold.',
  'till-off': 'shop.json says "till": "off".',
  items: 'shop.json has no items.',
  'restricted-key': 'The Worker has a full secret key: the shop takes only a restricted key (homie-studio shop connect).',
  'stripe-key': 'The Worker has no Stripe key yet (homie-studio shop connect: the owner pastes a restricted key into a page on their own computer).',
  'webhook-secret': 'The Worker has no webhook signing secret yet (the same page takes it).',
  database: 'This Worker has no database (a Preview never sells).',
  migration: 'The shop\'s tables are not in the studio\'s D1 yet: npm run deploy applies migrations 0008_studio_shop.sql, 0010_shop_reservations.sql and 0011_shop_statements.sql.',
});

/** The server a request names (the play shell says which), with its kids and beginner flags. */
async function serverFacts(env, cat, game, server) {
  if (!game || !GAME_ID.test(game) || !server || !SERVER_ID.test(server)) return { kids: false, beginner: false };
  const meta = (cat.games ?? []).find((g) => g.id === game);
  if (!meta) return { kids: false, beginner: false };
  try {
    const s = (await serversOf(env, meta)).find((x) => x.id === server);
    return { kids: Boolean(s?.kids), beginner: s?.policy === 'beginner' };
  } catch { return { kids: false, beginner: false }; }
}

/** The items a game's shop shows (its own and the studio's), in shop.json's order. */
const itemsFor = (shop, game) => (shop?.items ?? []).filter((i) => !i.game || !game || i.game === game);

/** The account a request is signed in as, with when it was made (a referral counts only for a new account). */
async function accountOf(request, env) {
  const p = await players.of(request, env);
  if (!p) return null;
  let since = null;
  try { since = (await players.get(env, p.id))?.createdAt ?? null; } catch { since = null; }
  return { ...p, since };
}

/** Each item with how this player may get it, and the words for it. */
async function itemsView(env, shop, { game, kids, beginner, player, open, cursor = 0, item = null, purchasing = false }) {
  const band = player ? await bandOfPlayer(env, player.id) : null;
  const owns = player ? await ownsOf(env, player.id) : [];
  const spent = !purchasing && player && open && shop.capPerPlayerMonth !== null ? await spentThisMonth(env, player.id) : 0;
  const selected = item ? [item] : itemsFor(shop, game);
  const page = item ? selected : selected.slice(cursor, cursor + 100);
  const items = page.map((it) => {
    const owned = it.gives.length > 0 && it.gives.every((k) => owns.some((o) => o.key === k && o.item === it.id));
    const way = wayFor(it, { open, kids, beginner, player, band, owned, spent, cap: purchasing ? null : shop.capPerPlayerMonth, policy: shop.policy });
    return { id: it.id, kind: it.kind, name: it.name, blurb: it.blurb ?? null, price: it.price, ...(it.kind === 'tip' ? { min: it.min, max: it.max } : {}), shown: it.kind === 'tip' ? `${money(it.min, shop.currency)} or more` : money(it.price, shop.currency), gives: it.gives, ...(it.badge ? { badge: it.badge } : {}), ...(it.days ? { days: it.days } : {}), ...(it.ends ? { ends: it.ends } : {}), ...(it.game ? { game: it.game } : {}), way, ...(way === 'cap' ? { retryWay: wayFor(it, { open, kids, beginner, player, band, owned, cap: null, policy: shop.policy }) } : {}) };
  }).filter((i) => i.way !== 'beginner' && i.way !== 'kids');
  return { band, owns, spent, items, nextCursor: !item && cursor + 100 < selected.length ? String(cursor + 100) : null };
}

/* ------------------------------------------------------------------ routes */

/** The shop's paths, or null for any other. */
export async function shopRoutes(request, env, ctx, url, { catalogueOf }) {
  const path = url.pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (path === '/api/referrals/statement') return receiveStatement(request, env, url);
  if (path === '/_homie/shop.js') return new Response(SHOP_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  const shopPath = path === '/shop' || path === '/shop/' || path.startsWith('/shop/') || path === '/api/shop' || path.startsWith('/api/shop/') || path === '/api/player/owns';
  if (!shopPath) return null;
  if (path === '/shop') return Response.redirect(`${url.origin}/shop/${url.search}`, 301);
  const cat = await catalogueOf();
  const shop = shopOf(cat);
  // The studio's protective policy closes kids studios.
  if (!shop || shop.audience === 'kids') {
    if (path === '/api/player/owns') return json({ ok: true, owns: [], open: false });
    if (path.startsWith('/api/')) return json({ ok: true, open: false, items: [], missing: [shop ? 'kids-studio' : 'shop.json'] });
    // No shop.json: /shop/ is the studio's own to use (a page in site/pages, say). The policy can close a kids studio's shop.
    return shop ? notFoundPage('This studio sells nothing.', cat) : null;
  }
  const ready = await readiness(env, shop);
  try {
    if (path === '/api/shop/hook') return await hook(request, env, cat, shop, ready);
    if (!read && !sameOrigin(request, url)) return fail(403, 'origin', 'only this site\'s own pages may do that');
    if (path === '/api/shop' && read) return await listRoute(request, env, url, cat, shop, ready);
    if (path === '/api/player/owns' && read) return await ownsRoute(request, env, url, cat, shop);
    if (path === '/api/shop/mine' && read) return await mineRoute(request, env, shop);
    if (path === '/api/shop/order' && read) return await orderRoute(request, env, url);
    if (path === '/api/shop/age' && request.method === 'POST') return await ageRoute(request, env, shop);
    if (path === '/api/shop/buy' && request.method === 'POST') return await buyRoute(request, env, url, cat, shop, ready, ctx);
    if (path === '/api/shop/parent' && request.method === 'POST') return await parentLinkRoute(request, env, url, cat, shop, ready);
    if (path === '/api/shop/used' && request.method === 'POST') return await usedRoute(request, env, shop);
    if (path === '/api/shop/refund' && request.method === 'POST') return await selfRefundRoute(request, env, shop, ready);
    if (path === '/shop/' && read) return shopPage(cat, shop, { origin: url.origin, game: GAME_ID.test(url.searchParams.get('game') ?? '') ? url.searchParams.get('game') : null, item: url.searchParams.get('item'), open: ready.ready, mode: ready.mode });
    if (path === '/shop/thanks' && read) return thanksPage(cat, shop, { session: /^cs_[A-Za-z0-9_]{1,200}$/.test(url.searchParams.get('session_id') ?? '') ? url.searchParams.get('session_id') : null, game: GAME_ID.test(url.searchParams.get('game') ?? '') ? url.searchParams.get('game') : null });
    if ((path === '/shop/refunds/' || path === '/shop/refunds') && read) return refundsPage(cat, shop);
    const parent = /^\/shop\/parent\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (parent) return await parentRoute(request, env, url, cat, shop, ready, parent[1], ctx);
  } catch (error) {
    if (/no such table|no such column|has no column/i.test(String(error?.message))) return fail(503, 'not-migrated', MISSING_WORDS.migration);
    throw error;
  }
  return path.startsWith('/api/') ? fail(404, 'not-found', 'no such shop route') : notFoundPage('Nothing here.', cat);
}

async function listRoute(request, env, url, cat, shop, ready) {
  const game = GAME_ID.test(url.searchParams.get('game') ?? '') ? url.searchParams.get('game') : null;
  const facts = await serverFacts(env, cat, game, url.searchParams.get('server'));
  if (facts.kids && !shop.policy.kidsServer) return json({ ok: true, open: false, kids: true, items: [] });
  const player = await accountOf(request, env);
  const v = await itemsView(env, shop, { game, ...facts, player, open: ready.ready, item: shop.items.find((i) => i.id === url.searchParams.get('item') && (!game || !i.game || i.game === game)) ?? null, cursor: /^\d+$/.test(url.searchParams.get('cursor') ?? '') ? Number(url.searchParams.get('cursor')) : 0 });
  // The studio decides which known age bands see no shop.
  if ((v.band === 'child' && shop.policy.children === 'deny') || (v.band === 'teen' && shop.policy.teens === 'deny')) return json({ ok: true, open: false, kids: true, items: [] });
  return json({
    ok: true, open: ready.ready, ...(ready.ready ? {} : { missing: ready.missing, migration: ready.migration }), mode: ready.mode,
    currency: shop.currency, currencyScale: currencyScale(shop.currency), amountStep: amountStep(shop.currency), policy: shop.policy, till: shop.till, refundDays: shop.refundDays, cap: shop.capPerPlayerMonth, spent: v.spent,
    player: player ? { signedIn: !player.guest, guest: player.guest, name: player.name, band: v.band } : null,
    owns: v.owns.map((o) => o.key), items: v.items, nextCursor: v.nextCursor,
  });
}

/** What the player owns: the keys a game reads. On a beginner or kids server, nothing with a play advantage counts. */
async function ownsRoute(request, env, url, cat, shop) {
  const p = await players.of(request, env);
  if (!p) return json({ ok: true, owns: [], open: Boolean(shop.open) });
  const game = GAME_ID.test(url.searchParams.get('game') ?? '') ? url.searchParams.get('game') : null;
  const facts = await serverFacts(env, cat, game, url.searchParams.get('server'));
  const advantage = new Set((shop.items ?? []).filter((i) => i.advantage).map((i) => i.id));
  const owns = (await ownsOf(env, p.id)).filter((o) => !(((facts.kids && !shop.policy.kidsAdvantages) || (facts.beginner && !shop.policy.beginnerAdvantages)) && advantage.has(o.item)));
  return json({ ok: true, open: Boolean(shop.open), owns: owns.map((o) => o.key), detail: owns.map((o) => ({ key: o.key, item: o.item, until: o.until })) });
}

async function mineRoute(request, env, shop) {
  const p = await players.of(request, env);
  if (!p) return json({ ok: true, player: null, orders: [], owns: [] });
  const data = await shopDataOf(env, p.id);
  const names = new Map((shop.items ?? []).map((i) => [i.id, i.name]));
  return json({ ok: true, currency: shop.currency, refundDays: shop.refundDays, refundUsedItems: shop.policy.refundUsedItems, ageBand: data?.ageBand ?? null, orders: (data?.orders ?? []).map((o) => ({ ...o, name: names.get(o.item) ?? o.item, shown: money(o.amount, o.currency), refundable: refundableNow(o, data?.owns ?? [], shop) })).reverse(), owns: (data?.owns ?? []).map((o) => ({ key: o.key, item: o.item, until: o.until, used: o.used })), badges: (data?.owns ?? []).filter((o) => o.key.startsWith('badge:')).map((o) => (shop.items ?? []).find((i) => i.id === o.item)?.badge ?? o.key.slice(6)) });
}

/** The thanks page asks: is my order (of this session) paid yet? Only the buyer's own account sees it. */
async function orderRoute(request, env, url) {
  const p = await players.of(request, env);
  const session = url.searchParams.get('session') ?? '';
  if (!p || !/^cs_[A-Za-z0-9_]{1,200}$/.test(session)) return json({ ok: true, status: null });
  const o = await orderBySession(env, session);
  if (!o || o.player !== p.id) return json({ ok: true, status: null });
  return json({ ok: true, status: playerOrderStatus(o), item: o.item, game: o.game ?? null });
}

/** The neutral age question: a year of birth, once. Nothing hints which answer opens anything; no default. */
async function ageRoute(request, env, shop) {
  const b = await bodyOf(request, requestSize(shop));
  if (b.error) return b.error;
  let p = await players.of(request, env);
  let cookies = [];
  const answer = bandOf(b.body.year, new Date(), shop.policy);
  if (!answer) return fail(400, 'year', 'pick the year you were born');
  if (!p && !shop.policy.requireAccount) {
    const guest = await players.shopGuest(request, env, new URL(request.url), shop.guestBuyersPerAddressPerHour);
    if (guest.error) return guest.error;
    p = guest.session.player; cookies = guest.session.cookies;
  }
  if (!p || (p.guest && shop.policy.requireAccount)) return fail(401, 'account', 'The studio requires an account before its age question.');
  const before = await bandOfPlayer(env, p.id);
  if (before) return json({ ok: true, asked: true });
  await setBand(env, p.id, answer);
  // The answer itself is never said back: the shop's list shows what this account may do.
  const response = json({ ok: true, asked: true });
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
}

export function sessionParams(shop, item, order, { origin, amount, player, game, parent = false, studio, product = null }) {
  const managed = shop.till === 'stripe-managed';
  // Managed Payments needs an eligible digital-goods tax code on every product (video games, downloaded).
  const taxCode = item.taxCode ?? (managed ? defaultTaxCode(item) : undefined);
  const back = game ? `&game=${encodeURIComponent(game)}` : '';
  return {
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: shop.currency, unit_amount: amount, tax_behavior: 'exclusive',
        // The catalog's Product (its name and tax code are Stripe's copy of shop.json's), or the item described inline.
        ...(product ? { product } : { product_data: { name: item.name, ...(item.blurb ? { description: item.blurb } : {}), ...(taxCode ? { tax_code: taxCode } : {}), metadata: { item: item.id.length <= 500 ? item.id : undefined } } }),
      },
    }],
    client_reference_id: player,
    // Stripe metadata values allow 500 characters; the order holds the complete item id.
    // https://docs.stripe.com/metadata (fetched 2026-10-08).
    metadata: { homie: 'shop-v1', studio: String(studio ?? '').length <= 500 ? String(studio ?? '') : undefined, order: order.id, item: item.id.length <= 500 ? item.id : undefined, ...(game ? { game } : {}), ...(order.via ? { via: order.via } : {}), ...(parent ? { parent: '1' } : {}) },
    payment_intent_data: { metadata: { order: order.id, item: item.id.length <= 500 ? item.id : undefined } },
    success_url: `${origin}/shop/thanks?session_id={CHECKOUT_SESSION_ID}${back}`,
    cancel_url: `${origin}/shop/?cancelled=1${back}`,
    // Stripe permits 30 minutes to 24 hours: https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-expires_at
    expires_at: order.expiresAt ?? Math.floor((order.createdAt ?? Date.now()) / 1000) + 31 * 60,
    // The EU and UK immediate-delivery acknowledgement (Consumer Rights Directive Art 16(m)), beside the pay button.
    custom_text: { submit: { message: checkoutMessage(shop, String(studio ?? 'this studio'), parent) } },
    // The kit's own tills: Stripe Tax on (the studio is the seller), or Managed Payments (Stripe is the seller of record
    // and computes the tax itself, so automatic_tax and adaptive pricing must not be sent).
    ...(managed ? { managed_payments: { enabled: true } } : { automatic_tax: { enabled: true }, adaptive_pricing: { enabled: false } }),
  };
}

function logOrderError(env, order, error) {
  const reason = String(error?.message ?? error).replaceAll(String(env.STRIPE_KEY || '\0'), '[redacted]');
  console.warn('Shop reconciliation', { order, reason, status: error?.status ?? null, code: error?.code ?? null });
}

/** At most three reads in parallel, claimed before I/O. Old unresolved rows back off up to an hour.
 * Stripe truth: https://docs.stripe.com/api/checkout/sessions/retrieve
 * Missing sessions: https://docs.stripe.com/error-codes#resource-missing
 * Payment time: https://docs.stripe.com/api/charges/object#charge_object-created
 */
export async function reconcileOrders(env, shop, player) {
  const now = Date.now();
  const rows = (await env.DB.prepare("SELECT * FROM shop_orders WHERE player = ?1 AND mode = ?2 AND session IS NOT NULL AND status IN ('started', 'processing') AND (expires_at IS NULL OR expires_at <= ?3 OR status = 'processing') AND updated_at <= ?3 - MIN(3600000, MAX(CASE WHEN status = 'processing' THEN 300000 ELSE 60000 END, CAST((?3 - created_at) / 24 AS INTEGER))) ORDER BY updated_at, id LIMIT 3")
    .bind(player, modeOf(env.STRIPE_KEY), now).all()).results ?? [];
  await Promise.all(rows.map(async (row) => {
    const claim = await env.DB.prepare("UPDATE shop_orders SET updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND status IN ('started', 'processing')").bind(row.id, row.updated_at, now).run();
    if (!claim.meta?.changes) return;
    try {
      const session = await stripeCall(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(row.session)}`, { expand: ['payment_intent.latest_charge'] }, { timeout: 2000 });
      if (!session || session.id !== row.session || (typeof session.livemode === 'boolean' && session.livemode !== (row.mode === 'live'))) throw new Error('Stripe session identity or mode mismatch');
      const payment = session.payment_intent;
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required' || payment?.status === 'succeeded') {
        const time = session.payment_status === 'no_payment_required' ? session.created : payment?.latest_charge?.created;
        // Missing payment time remains unresolved; never charge an old payment to this month's allowance.
        if (Number.isSafeInteger(time) && time > 0 && time * 1000 <= now) await paid(env, shop, session, time * 1000);
      } else if (session.status === 'expired' || payment?.status === 'canceled' || (session.status === 'complete' && payment?.status === 'requires_payment_method' && payment.last_payment_error)) {
        await env.DB.prepare("UPDATE shop_orders SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('started', 'processing')").bind(row.id, session.status === 'expired' ? 'expired' : 'failed', now).run();
      }
    } catch (error) {
      logOrderError(env, row.id, error);
      // This key's account cannot see the session; a later verified payment still grants it.
      if (error instanceof StripeError && error.status === 404 && error.code === 'resource_missing') {
        await env.DB.prepare("UPDATE shop_orders SET status = 'missing', note = 'Stripe account has no such session; previous status: ' || status, updated_at = ?2 WHERE id = ?1 AND status IN ('started', 'processing')").bind(row.id, now).run();
      } else {
        // Keep the atomic claim, but retry failures after roughly a minute, regardless of row age.
        const interval = Math.min(3600000, Math.max(row.status === 'processing' ? 300000 : 60000, Math.trunc((now - row.created_at) / 24)));
        await env.DB.prepare("UPDATE shop_orders SET updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND status IN ('started', 'processing')").bind(row.id, now, now - interval + 60000).run();
      }
    }
  }).map((work, i) => work.catch((error) => logOrderError(env, rows[i].id, error))));
}

/** Make the order row, then Stripe's Checkout Session. Returns { order, url } or a refusal Response. */
async function startCheckout(env, url, cat, shop, item, { player, game, via, amount, parent = false }) {
  if (via && !Number.isSafeInteger(Math.round(amount * shop.referrals.rate))) return { error: fail(400, 'arithmetic', 'The referral share exceeds safe integer arithmetic; change the studio rate or amount.') };
  const order = { id: newOrderId(), player: player.id, via: via ?? null, amount, currency: shop.currency };
  const now = Date.now();
  order.createdAt = now;
  order.expiresAt = Math.floor(now / 1000) + 31 * 60;
  // One SQL statement reserves the amount: concurrent requests cannot both spend the remaining cap.
  const reserve = () => env.DB.prepare("INSERT INTO shop_orders (id, player, item, game, amount, currency, till, mode, status, parent, via, created_at, updated_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'started', ?9, ?10, ?11, ?11, ?14 WHERE ?5 = 0 OR ?12 IS NULL OR ?5 <= ?12 - (SELECT COALESCE(SUM(amount), 0) FROM shop_orders WHERE player = ?2 AND mode = ?8 AND ((status IN ('paid', 'disputed') AND paid_at >= ?13) OR (status IN ('started', 'processing') AND (session IS NOT NULL OR COALESCE(expires_at, created_at + 1860000) + 60000 > ?11))))")
    .bind(order.id, player.id, item.id, game ?? item.game ?? null, amount, shop.currency, shop.till, modeOf(env.STRIPE_KEY), parent ? 1 : 0, order.via, now, shop.capPerPlayerMonth, Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1), order.expiresAt * 1000).run();
  let reserved = await reserve();
  const reconciled = !reserved.meta?.changes;
  if (!reserved.meta?.changes) {
    await reconcileOrders(env, shop, player.id);
    reserved = await reserve();
  }
  if (!reserved.meta?.changes) return { error: fail(403, 'cap', WAY_WORDS.cap, { way: 'cap' }) };
  let session = null;
  const mode = modeOf(env.STRIPE_KEY);
  try {
    const product = Array.isArray(shop.catalog) && shop.catalog.includes(mode) ? await productIdOf(cat.studio?.slug, item.id) : null;
    const params = (p) => sessionParams(shop, item, order, { origin: url.origin, amount, player: player.id, game, parent, studio: cat.studio?.name, product: p });
    try {
      session = await createCheckoutSession(env, params(product), { idempotencyKey: `checkout-${order.id}` });
    } catch (error) {
      // shop.json says the catalog is made in this mode, but Stripe has no such Product (made in the sandbox only, or
      // archived by hand): the item described inline still sells, and `homie-studio shop catalog` says what to make.
      if (!product || !isMissingProduct(error)) throw error;
      session = await createCheckoutSession(env, params(null), { idempotencyKey: `checkout-${order.id}-inline` });
    }
    if (typeof session?.id !== 'string' || typeof session?.url !== 'string' || !/^https:\/\//.test(session.url) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(session.url)) {
      await env.DB.prepare("UPDATE shop_orders SET status = 'failed', updated_at = ?2 WHERE id = ?1").bind(order.id, Date.now()).run();
      return { error: fail(502, 'stripe', 'Stripe answered without a checkout page. Nothing was charged.') };
    }
    await env.DB.prepare('UPDATE shop_orders SET session = ?2, updated_at = ?3 WHERE id = ?1').bind(order.id, session.id, Date.now()).run();
  } catch (error) {
    await env.DB.prepare("UPDATE shop_orders SET status = 'failed', note = ?2, updated_at = ?3 WHERE id = ?1").bind(order.id, String(error?.code ?? 'stripe').slice(0, 60), Date.now()).run();
    const why = error instanceof StripeError ? error.message : 'Stripe did not answer';
    return { error: fail(502, 'stripe', `Stripe could not open the checkout (${why}). Nothing was charged.`) };
  }
  return { order, url: session.url, session: session.id, reconciled };
}

/** The referrer this buyer brought, if it still counts: their arrival, a new account since it, in the window, proven. */
async function viaFor(request, env, url, shop, player) {
  if (!shop.referrals || !(shop.referrals.rate > 0)) return null;
  const a = await arrivalOf(request, env);
  if (!a || a.via === url.hostname.replace(/^www\./, '')) return null;
  if (shop.referrals.windowDays !== null && Date.now() - a.at > Math.round(shop.referrals.windowDays * DAY)) return null;
  // New players only: an account made before the arrival was already this studio's player.
  if (player.since !== null && player.since < a.at - 60_000) return null;
  return (await referrerOk(a.via)) ? a.via : null;
}

const WAY_WORDS = Object.freeze({
  closed: 'The shop is not open yet.', kids: 'The studio policy.kidsServer setting closes this shop on kids servers.', beginner: 'The studio server advantage settings hide this item here.',
  owned: 'You have it already.', 'make-an-account': 'Make an account first (a passkey), so what you buy stays yours on every device.',
  'age-question': 'One question first: the year you were born.', no: 'This shop sells nothing to this account.',
  'ask-a-parent': 'A parent or guardian buys this for you: send them the link.', cap: 'That reaches the studio capPerPlayerMonth setting for this account.',
  'not-yet': 'Not on sale yet.', over: 'No longer on sale.',
});

function purchaseLimited(request, shop, player, kind) {
  const account = player && limited(`${kind}:account:${player}`, shop.purchaseAttemptsPerMinute, 60_000);
  const address = limited(`${kind}:address:${addressOf(request)}`, shop.purchaseAttemptsPerAddressPerMinute, 60_000);
  return account || address;
}

async function buyRoute(request, env, url, cat, shop, ready, ctx) {
  const b = await bodyOf(request, requestSize(shop));
  if (b.error) return b.error;
  if (!ready.ready) return fail(503, 'closed', 'The shop is not open yet.', { missing: ready.missing, migration: ready.migration });
  const item = shop.items.find((i) => i.id === b.body.item);
  if (!item) return fail(404, 'item', 'no such item here');
  const game = GAME_ID.test(String(b.body.game ?? '')) ? String(b.body.game) : null;
  if (item.game && game && item.game !== game) return fail(400, 'item', 'that item belongs to another game');
  const facts = await serverFacts(env, cat, game, b.body.server);
  let player = await accountOf(request, env);
  if (purchaseLimited(request, shop, player?.id, 'buy')) return fail(429, 'rate', 'The studio purchase attempt rate limit was reached; try again in a minute.');
  const v = await itemsView(env, shop, { game, ...facts, player, open: true, item, purchasing: true });
  const row = v.items.find((i) => i.id === item.id);
  const way = facts.kids && !shop.policy.kidsServer ? 'kids' : row?.way ?? (item.advantage && facts.beginner ? 'beginner' : 'closed');
  if (way !== 'checkout') return fail(403, way, WAY_WORDS[way] ?? 'Not now.', { way });
  let amount = item.price;
  if (item.kind === 'tip') {
    amount = typeof b.body.amount === 'number' ? b.body.amount : NaN;
    if (amountError(amount, shop.currency) || !(amount >= item.min && (item.max === null || amount <= item.max))) return fail(400, 'amount', amountError(amount, shop.currency) ?? `The studio tip range starts at ${money(item.min, shop.currency)}${item.max === null ? '' : ` and ends at ${money(item.max, shop.currency)}`}.`);
  }
  let cookies = [];
  if (!player) {
    const guest = await players.shopGuest(request, env, url, shop.guestBuyersPerAddressPerHour);
    if (guest.error) return guest.error;
    player = guest.session.player;
    cookies = guest.session.cookies;
  }
  const via = await viaFor(request, env, url, shop, player);
  const r = await startCheckout(env, url, cat, shop, item, { player, game, via, amount });
  const response = r.error ?? json({ ok: true, order: r.order.id, url: r.url });
  if (!r.error && !r.reconciled && shop.capPerPlayerMonth !== null && ctx?.waitUntil) ctx.waitUntil(reconcileOrders(env, shop, player.id).catch((error) => logOrderError(env, r.order.id, error)));
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
}

/** 13-17: a one-time link for a parent (7 days). The teen passes it on; nothing here pressures anyone. */
async function parentLinkRoute(request, env, url, cat, shop, ready) {
  const b = await bodyOf(request, requestSize(shop));
  if (b.error) return b.error;
  if (!ready.ready) return fail(503, 'closed', 'The shop is not open yet.', { missing: ready.missing, migration: ready.migration });
  const item = shop.items.find((i) => i.id === b.body.item);
  if (!item) return fail(404, 'item', 'no such item here');
  const game = GAME_ID.test(String(b.body.game ?? '')) ? String(b.body.game) : null;
  const facts = await serverFacts(env, cat, game, b.body.server);
  const player = await accountOf(request, env);
  if (purchaseLimited(request, shop, player?.id, 'parent')) return fail(429, 'rate', 'The studio purchase attempt rate limit was reached; try again in a minute.');
  const v = await itemsView(env, shop, { game, ...facts, player, open: true, item, purchasing: true });
  const way = facts.kids && !shop.policy.kidsServer ? 'kids' : v.items.find((i) => i.id === item.id)?.way ?? 'closed';
  if (way !== 'ask-a-parent') return fail(403, way, WAY_WORDS[way] ?? 'Not now.', { way });
  const token = randomToken();
  await env.DB.prepare('INSERT INTO shop_parent_links (hash, player, item, game, order_id, expires_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5)').bind(await sha256Hex(token), player.id, item.id, game, Date.now() + 7 * DAY).run();
  return json({ ok: true, link: `${url.origin}/shop/parent/${token}`, expiresInDays: 7 });
}

/** /shop/parent/<token>: what, for whom, the price; the parent pays in their own name on Stripe's page. */
async function parentRoute(request, env, url, cat, shop, ready, token, ctx) {
  if (!TOKEN.test(token)) return notFoundPage('This link does not work.', cat);
  const row = await env.DB.prepare('SELECT * FROM shop_parent_links WHERE hash = ?1').bind(await sha256Hex(token)).first();
  const item = row ? shop.items.find((i) => i.id === row.item) : null;
  if (!row || !item || Number(row.expires_at) < Date.now()) return parentPage(cat, shop, { gone: true });
  const kid = await players.get(env, row.player);
  if (!kid) return parentPage(cat, shop, { gone: true });
  const done = row.order_id ? await orderById(env, row.order_id) : null;
  if (done?.status === 'paid') return parentPage(cat, shop, { item, name: kid.name, paid: true });
  if (request.method === 'GET' || request.method === 'HEAD') return parentPage(cat, shop, { item, name: kid.name, token, open: ready.ready });
  if (request.method !== 'POST' || !sameOrigin(request, url)) return new Response('Not allowed', { status: 403 });
  let form = null;
  try { form = await request.formData(); } catch { form = null; }
  if (String(form?.get('grownup') ?? '') !== 'yes') return parentPage(cat, shop, { item, name: kid.name, token, open: ready.ready, said: 'Tick the box to say you are their parent or guardian and an adult.' });
  if (!ready.ready) return parentPage(cat, shop, { item, name: kid.name, token, open: false });
  if (purchaseLimited(request, shop, row.player, 'parentpay')) return parentPage(cat, shop, { item, name: kid.name, token, open: true, said: 'One moment: too many tries.' });
  const band = await bandOfPlayer(env, row.player);
  const owns = await ownsOf(env, row.player);
  const owned = item.gives.length > 0 && item.gives.every((key) => owns.some((o) => o.key === key && o.item === item.id));
  if (wayFor(item, { player: kid, band, owned, spent: 0, cap: null, policy: shop.policy }) !== 'ask-a-parent') return parentPage(cat, shop, { gone: true });
  const amount = item.kind === 'tip' ? parseAmount(form?.get('amount'), currencyScale(shop.currency)) : item.price;
  const invalidAmount = amountError(amount, shop.currency);
  if (invalidAmount || (item.kind === 'tip' && (amount < item.min || (item.max !== null && amount > item.max)))) return parentPage(cat, shop, { item, name: kid.name, token, said: invalidAmount ?? 'This amount exceeds the studio tip range or monthly cap.' });
  const r = await startCheckout(env, url, cat, shop, item, { player: { id: row.player }, game: row.game, via: null, amount, parent: true });
  if (r.error) return parentPage(cat, shop, { item, name: kid.name, token, open: true, said: (await r.error.json()).message });
  await env.DB.prepare('UPDATE shop_parent_links SET order_id = ?2 WHERE hash = ?1').bind(await sha256Hex(token), r.order.id).run();
  if (!r.reconciled && shop.capPerPlayerMonth !== null && ctx?.waitUntil) ctx.waitUntil(reconcileOrders(env, shop, row.player).catch((error) => logOrderError(env, r.order.id, error)));
  return Response.redirect(r.url, 303);
}

/** The game says the player used something (equipped a skin, played the pass): it is no longer refundable by the player. */
async function usedRoute(request, env, shop) {
  const b = await bodyOf(request, requestSize(shop));
  if (b.error) return b.error;
  const p = await players.of(request, env);
  if (!p) return json({ ok: true, used: 0 });
  const key = String(b.body.key ?? '');
  if (!ENTITLEMENT_KEY.test(key)) return fail(400, 'key', 'name the key the game read');
  const r = await env.DB.prepare("UPDATE entitlements SET used_at = ?3 WHERE player = ?1 AND key = ?2 AND used_at IS NULL AND state = 'active'").bind(p.id, key, Date.now()).run();
  return json({ ok: true, used: Number(r?.meta?.changes ?? 0) });
}

function refundableNow(order, owns, shop, now = Date.now()) {
  if (shop.refundDays === null || order.status !== 'paid' || order.paidAt === null) return false;
  if (now - order.paidAt > Math.round(shop.refundDays * DAY)) return false;
  return shop.policy.refundUsedItems || !owns.some((o) => o.item === order.item && o.used);
}

/** A player's own refund: an unused item, within the studio's refund days (fewer disputes, and the respected norm). */
async function selfRefundRoute(request, env, shop, ready) {
  const b = await bodyOf(request, requestSize(shop));
  if (b.error) return b.error;
  const p = await players.of(request, env);
  if (!p) return fail(401, 'account', 'sign in first');
  const o = await orderById(env, b.body.order);
  if (!o || o.player !== p.id) return fail(404, 'order', 'no such order on this account');
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE order_id = ?1 AND used_at IS NOT NULL').bind(o.id).first();
  if (!refundableNow(orderView(o), Number(used?.n) ? [{ item: o.item, used: true }] : [], shop)) return fail(403, 'not-refundable', shop.refundDays === null ? 'Ask the studio for a refund; it has not set a self-service refund window.' : `The studio allows self-service refunds for ${shop.policy.refundUsedItems ? 'items' : 'unused items'} within ${shop.refundDays} days. Ask the studio for anything else.`);
  if (Number(o.amount) !== 0 && !KEY_SHAPE.test(String(env.STRIPE_KEY ?? ''))) return fail(503, 'closed', MISSING_WORDS['stripe-key']);
  const r = await refundOrder(env, o, { reason: 'requested_by_customer', by: 'player' });
  if (r.held) return json({ ok: false, held: true, error: 'held', message: 'The studio approves this refund in Stripe first. Your money comes back once they do, and the item leaves your account then.' }, 202);
  return json(r, r.ok ? 200 : 502);
}

/* ------------------------------------------------------------------ Stripe events and reconciliation share idempotent money transitions */

async function hook(request, env, cat, shop, ready) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST only');
  if (Number(request.headers.get('content-length') ?? 0) > 512 * 1024) return fail(413, 'too-large', 'too large');
  const payload = await request.text();
  const v = await verifyWebhook(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!v.ok) return fail(v.why === 'no-secret' ? 503 : 400, v.why, 'not a webhook from this studio\'s Stripe');
  if (!(await migrated(env))) return fail(503, 'not-migrated', MISSING_WORDS.migration);
  const ev = v.event;
  // A test event never touches a live shop's books, nor a live one a test shop's.
  if (typeof ev.livemode === 'boolean' && KEY_SHAPE.test(String(env.STRIPE_KEY ?? '')) && ev.livemode !== (modeOf(env.STRIPE_KEY) === 'live')) return json({ ok: true, ignored: 'mode' });
  if (await env.DB.prepare('SELECT 1 AS x FROM shop_events WHERE id = ?1').bind(ev.id).first()) return json({ ok: true, duplicate: true });
  const obj = ev.data?.object ?? {};
  let did = 'ignored';
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (ev.type === 'checkout.session.async_payment_succeeded' || obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') did = await paid(env, shop, obj);
      else {
        await env.DB.prepare("UPDATE shop_orders SET status = 'processing', updated_at = ?2 WHERE session = ?1 AND status = 'started'").bind(String(obj.id ?? ''), Date.now()).run();
        did = 'waiting';
      }
      break;
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      await env.DB.prepare('UPDATE shop_orders SET status = ?2, updated_at = ?3 WHERE session = ?1 AND status IN (\'started\', \'processing\', \'missing\', \'released\')').bind(String(obj.id ?? ''), ev.type.endsWith('expired') ? 'expired' : 'failed', Date.now()).run();
      did = 'closed';
      break;
    case 'charge.refunded':
      if (obj.refunded === true || Number(obj.amount_refunded) >= Number(obj.amount)) did = await refunded(env, String(obj.payment_intent ?? ''), null);
      break;
    case 'refund.created':
    case 'refund.updated':
      // Individual refunds may be partial. charge.refunded supplies the cumulative full-refund truth.
      if (obj.status === 'succeeded') {
        const order = await orderByPayment(env, String(obj.payment_intent ?? ''));
        if (order && Number(obj.amount) >= Number(order.total ?? order.amount)) did = await refunded(env, String(obj.payment_intent ?? ''), String(obj.id ?? ''));
      }
      break;
    case 'charge.dispute.created':
      did = await disputed(env, String(obj.payment_intent ?? ''), String(obj.id ?? ''));
      break;
    case 'charge.dispute.closed':
      did = await disputeClosed(env, String(obj.payment_intent ?? ''), String(obj.status ?? ''));
      break;
    default:
      break;
  }
  await env.DB.prepare('INSERT INTO shop_events (id, type, at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING').bind(ev.id, ev.type, Date.now()).run();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM shop_events WHERE at < ?1').bind(Date.now() - 60 * DAY).run();
  return json({ ok: true, did });
}

/** A paid checkout: the order is paid, its entitlements granted, a referral line written. Idempotent. */
async function paid(env, shop, session, paidAt = Date.now()) {
  const o = await orderBySession(env, session.id);
  if (!o) return 'unknown-order';
  // The session must be the one this order opened, for this player and this price.
  if (session.metadata?.order !== o.id || (session.client_reference_id && session.client_reference_id !== o.player)) return 'mismatch';
  if (session.currency !== o.currency || !Number.isSafeInteger(session.amount_subtotal) || session.amount_subtotal !== Number(o.amount)) return 'mismatch';
  if (o.paid_at !== null) return 'already';
  const item = shop.items.find((i) => i.id === o.item);
  const now = Date.now();
  const res = await env.DB.prepare("UPDATE shop_orders SET status = 'paid', payment = ?2, tax = ?3, total = ?4, paid_at = ?5, updated_at = ?6 WHERE id = ?1 AND paid_at IS NULL")
    .bind(o.id, typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, Number.isFinite(Number(session.total_details?.amount_tax)) ? Number(session.total_details.amount_tax) : null, Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null, paidAt, now).run();
  if (!Number(res?.meta?.changes ?? 1)) return 'already';
  const writes = [];
  if (o.player && item) writes.push(...grantStatements(env, o, item, now));
  // An item that is no longer in shop.json still reaches its buyer: the keys it gave when it was sold are not known
  // here, so the order is paid and the office shows it for the owner to settle by hand.
  if (o.via) writes.push(...(await lineFor(env, o, shop, { now })));
  if (writes.length) await env.DB.batch(writes);
  return item ? 'paid' : 'paid-unknown-item';
}

async function refunded(env, payment, refundId) {
  const o = payment ? await orderByPayment(env, payment) : null;
  if (!o) return 'unknown-order';
  if (o.status === 'refunded') return 'already';
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE shop_orders SET status = 'refunded', refund = COALESCE(?2, refund), refunded_at = ?3, updated_at = ?3 WHERE id = ?1").bind(o.id, refundId, now),
    revokeStatement(env, o.id),
    ...voidLineStatements(env, o.id),
  ]);
  return 'refunded';
}

/** A dispute changes nothing until it is decided: the player keeps the item and their account. */
async function disputed(env, payment, disputeId) {
  const o = payment ? await orderByPayment(env, payment) : null;
  if (!o) return 'unknown-order';
  await env.DB.prepare("UPDATE shop_orders SET status = 'disputed', dispute = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'paid'").bind(o.id, disputeId, Date.now()).run();
  return 'disputed';
}

/** Lost: that one item goes, as a refund would take it. Won: back to paid. Never a ban, never a locked account. */
async function disputeClosed(env, payment, status) {
  const o = payment ? await orderByPayment(env, payment) : null;
  if (!o) return 'unknown-order';
  const now = Date.now();
  if (status === 'lost') {
    await env.DB.batch([
      env.DB.prepare("UPDATE shop_orders SET status = 'lost', updated_at = ?2 WHERE id = ?1").bind(o.id, now),
      revokeStatement(env, o.id),
      ...voidLineStatements(env, o.id),
    ]);
    return 'lost';
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE shop_orders SET status = 'paid', updated_at = ?2 WHERE id = ?1 AND status = 'disputed'").bind(o.id, now),
    restoreStatement(env, o.id),
  ]);
  return 'kept';
}

/** What the owner reads when Stripe holds a refund for approval (the shop's key is an Agent key). */
export const REFUND_HELD = 'Stripe is holding this refund until a person approves it in Stripe (Settings, Approvals, Requests): the shop\'s Stripe key is marked as an Agent key, and Stripe asks a person before an agent\'s refund. Approve it there; Stripe then refunds, and the item leaves the player\'s account when Stripe says so. To refund with one tap again, connect the shop with a plain restricted key (homie-studio shop connect), not one made for "Authorizing agent access".';

/** Refund one order in full with Stripe, then take back that one item. The webhook confirms the same (idempotent). */
export async function refundOrder(env, o, { reason = 'requested_by_customer', by = 'owner' } = {}) {
  if (o.status !== 'paid') return { ok: false, error: 'state', message: o.status === 'disputed' ? 'This order is disputed: the card network decides it now (answer it in Stripe).' : `This order is ${o.status}, not paid.` };
  if (Number(o.amount) === 0) {
    const now = Date.now();
    await env.DB.batch([env.DB.prepare("UPDATE shop_orders SET status = 'refunded', refunded_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'paid'").bind(o.id, now), revokeStatement(env, o.id), ...voidLineStatements(env, o.id)]);
    return { ok: true, order: o.id, amount: 0, currency: o.currency, status: 'succeeded', refund: null };
  }
  if (!o.payment) return { ok: false, error: 'no-payment', message: 'Stripe has not said which payment this was yet; try again in a minute.' };
  let refund = null;
  try {
    refund = await createRefund(env, { payment_intent: o.payment, reason: ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason) ? reason : 'requested_by_customer', metadata: { order: o.id, by } }, { idempotencyKey: `refund-${o.id}` });
  } catch (error) {
    // An Agent-tagged key: Stripe holds an agent's refund for a person's approval. Nothing happened yet; once someone
    // approves it in Stripe, Stripe refunds and the webhook (refund.created, charge.refunded) takes the item back.
    if (isApprovalRequired(error)) return { ok: false, error: 'approval', held: true, message: REFUND_HELD };
    return { ok: false, error: 'stripe', message: `Stripe did not refund it (${error instanceof StripeError ? error.message : 'no answer'}). Nothing changed.` };
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE shop_orders SET status = 'refunded', refund = ?2, refunded_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'paid'").bind(o.id, String(refund?.id ?? ''), now),
    revokeStatement(env, o.id),
    ...voidLineStatements(env, o.id),
  ]);
  return { ok: true, order: o.id, refund: refund?.id ?? null, status: refund?.status ?? null, amount: Number(o.amount), currency: o.currency };
}

/* ------------------------------------------------------------------ the office (worker/office.mjs calls these) */

/** office checkAction for `refund`: { ok, action } or a refusal. */
export function checkRefund(body) {
  if (!/^ord_[A-Za-z0-9]{20}$/.test(String(body.order ?? ''))) return { ok: false, error: 'bad-request', message: 'order is the order\'s id (ord_…, from the office\'s shop page or `homie-studio shop orders`)' };
  const reason = ['duplicate', 'fraudulent', 'requested_by_customer'].includes(body.reason) ? body.reason : 'requested_by_customer';
  const note = String(body.note ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 140) || null;
  return { ok: true, action: { op: 'refund', order: body.order, reason, note } };
}
/** Explicit owner override of an unresolved reservation; the existing note records its actor and time. */
export function checkRelease(body) {
  const checked = checkRefund(body);
  return checked.ok ? { ok: true, action: { op: 'shop-release', order: body.order } } : checked;
}
export async function performRelease(env, a) {
  const row = await orderById(env, a.order);
  if (!row || !['started', 'processing'].includes(row.status)) return { ok: false, error: 'state', message: 'Only an unresolved order can be released.' };
  // https://docs.stripe.com/api/checkout/sessions/expire — only open sessions can expire.
  if (row.session) {
    try {
      const session = await stripeCall(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(row.session)}`, null, { timeout: 2000 });
      if (session?.id === row.session && session.status === 'open') await expireCheckoutSession(env, row.session, { timeout: 2000 });
    } catch (error) { logOrderError(env, row.id, error); }
  }
  const at = Date.now();
  const note = `Reservation released by ${a.by} at ${new Date(at).toISOString()}`;
  const result = await env.DB.prepare("UPDATE shop_orders SET status = 'released', note = ?2 || '; previous status: ' || status, updated_at = ?3 WHERE id = ?1 AND status IN ('started', 'processing')").bind(a.order, note, at).run();
  return result.meta?.changes ? { ok: true, order: a.order, by: a.by, at } : { ok: false, error: 'state', message: 'Only an unresolved order can be released.' };
}

export function checkSettle(body) {
  if (!/^[a-z0-9.-]{3,253}$/.test(String(body.via ?? ''))) return { ok: false, error: 'bad-request', message: 'via is the referrer\'s host (as the shop page shows it)' };
  if (!/^[a-z]{3}$/.test(body.currency ?? '')) return { ok: false, error: 'currency', message: 'Choose the currency to mark paid.' };
  return { ok: true, action: { op: 'shop-settle', currency: body.currency, via: String(body.via), ref: String(body.ref ?? '').slice(0, 80) } };
}

/** The refund in plain words, for the owner's confirm page and the AI's card. */
export function describeRefund(cat, a, order = null) {
  const shop = shopOf(cat);
  const name = shop?.items.find((i) => i.id === order?.item)?.name ?? order?.item ?? 'an item';
  const what = order ? `${name}, ${money(order.amount, order.currency)}` : a.order;
  return `Refund order ${a.order} (${what}) in full with Stripe: the buyer gets their money back in 5 to 10 days and the item leaves their account. ${a.note ? `Why: "${a.note}".` : ''}`.trim();
}

/** Do the refund (the owner's tap, or the owner's yes to the AI's ask). */
export async function performRefund(env, cat, a) {
  const o = await orderById(env, a.order);
  if (!o) return { ok: false, error: 'order', message: 'No such order.' };
  return refundOrder(env, o, { reason: a.reason, by: 'owner' });
}

/** Everything the office's shop page shows. Money is read from this studio's D1; Stripe's own pages are linked. */
export async function shopOffice(env, cat, origin, cursor = '', itemCursor = 0, orderCursor = 0) {
  const shop = shopOf(cat);
  const ready = await readiness(env, shop);
  const mode = ready.mode ?? 'test';
  const out = {
    ok: true, ready: ready.ready, missing: ready.missing.map((m) => ({ id: m, words: m === 'migration' ? `The shop needs ${ready.migration}; npm run deploy applies it.` : MISSING_WORDS[m] ?? m })), mode: ready.mode,
    shop: shop ? { policy: shop.policy, purchaseAttemptsPerMinute: shop.purchaseAttemptsPerMinute, till: shop.till, currency: shop.currency, refundDays: shop.refundDays, cap: shop.capPerPlayerMonth, nextItemsCursor: itemCursor + 100 < shop.items.length ? String(itemCursor + 100) : null, items: shop.items.slice(itemCursor, itemCursor + 100).map((i) => ({ id: i.id, kind: i.kind, name: i.name, price: i.price, shown: i.kind === 'tip' ? `${money(i.min, shop.currency)}+` : money(i.price, shop.currency), gives: i.gives, game: i.game ?? null })), referrals: shop.referrals, ...(shop.broken ? { broken: shop.broken } : {}) } : null,
    stripe: {
      payments: dashboardLink(mode, 'payments'), refunds: dashboardLink(mode, 'refunds'), disputes: dashboardLink(mode, 'disputes'), payouts: dashboardLink(mode, 'payouts'),
      balance: dashboardLink(mode, 'balance'), tax: dashboardLink(mode, 'tax'), keys: dashboardLink(mode, 'keys'), webhooks: dashboardLink(mode, 'webhooks'),
      ...(shop?.till === 'stripe-managed' ? { managedPayments: dashboardLink(mode, 'managed-payments') } : {}),
    },
    hook: `${origin}/api/shop/hook`,
    totals: null, orders: [], referrals: { owe: [], owedToUs: [] },
  };
  if (!(await migrated(env))) return out;
  const since = Date.now() - 30 * DAY;
  const t = await env.DB.prepare("SELECT SUM(CASE WHEN status IN ('paid', 'disputed') THEN amount ELSE 0 END) AS paid, SUM(CASE WHEN status IN ('paid', 'disputed') THEN 1 ELSE 0 END) AS sales, SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END) AS refunded, SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunds, SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) AS disputes, SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost FROM shop_orders WHERE created_at >= ?1").bind(since).first();
  out.totals = { days: 30, currency: shop?.currency ?? 'usd', paid: Number(t?.paid) || 0, sales: Number(t?.sales) || 0, refunded: Number(t?.refunded) || 0, refunds: Number(t?.refunds) || 0, disputes: Number(t?.disputes) || 0, lost: Number(t?.lost) || 0 };
  const rows = (await env.DB.prepare("SELECT o.*, p.name AS player_name FROM shop_orders o LEFT JOIN players p ON p.id = o.player ORDER BY CASE WHEN o.status IN ('started', 'processing') THEN 0 ELSE 1 END, o.created_at DESC, o.id LIMIT 101 OFFSET ?1").bind(orderCursor).all()).results ?? [];
  out.nextOrdersCursor = rows.length > 100 ? String(orderCursor + 100) : null;
  if (rows.length > 100) rows.pop();
  const names = new Map((shop?.items ?? []).map((i) => [i.id, i.name]));
  out.orders = rows.map((r) => ({
    ...orderView(r), note: r.note ?? null, name: names.get(r.item) ?? r.item, shown: money(r.amount, r.currency), player: r.player ? { id: r.player, name: r.player_name ?? null } : null,
    stripe: r.payment ? dashboardLink(r.mode, 'payment', r.payment) : null, dispute: r.dispute ? dashboardLink(r.mode, 'dispute', r.dispute) : null,
    releasable: ['started', 'processing'].includes(r.status),
    refundable: r.status === 'paid' && (Number(r.amount) === 0 || Boolean(r.payment)),
  }));
  const { books, nextCursor } = await booksOf(env, { cursor });
  out.referrals = { nextCursor, owe: books, failures: await statementFailures(env), owedToUs: await statementsIn(env), invoice: dashboardLink(mode, 'invoices') };
  return out;
}

/** The orders as CSV for the studio's accountant: no names, no emails (Stripe has the buyer's details). */
export async function ordersCsv(env) {
  const rows = (await env.DB.prepare("SELECT * FROM shop_orders WHERE status != 'started' ORDER BY created_at").all()).results ?? [];
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['order', 'created', 'paid', 'refunded', 'status', 'item', 'game', 'amount', 'tax', 'total', 'currency', 'till', 'mode', 'parent', 'via', 'stripe_payment', 'stripe_refund', 'stripe_dispute'];
  const iso = (t) => (t ? new Date(Number(t)).toISOString() : '');
  const lines = rows.map((r) => [r.id, iso(r.created_at), iso(r.paid_at), iso(r.refunded_at), r.status, r.item, r.game, (Number(r.amount) / currencyScale(r.currency)).toFixed(Math.log10(currencyScale(r.currency))), r.tax === null ? '' : (Number(r.tax) / currencyScale(r.currency)).toFixed(Math.log10(currencyScale(r.currency))), r.total === null ? '' : (Number(r.total) / currencyScale(r.currency)).toFixed(Math.log10(currencyScale(r.currency))), r.currency, r.till, r.mode, Number(r.parent) ? 'yes' : '', r.via, r.payment, r.refund, r.dispute].map(cell).join(','));
  return `${head.join(',')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

/** The signed statements for a period (YYYY-MM, default last month): one per referrer this studio owes. */
export async function statementsOut(env, cat, origin, period, cursor = '') {
  const shop = shopOf(cat);
  const p = /^\d{4}-\d{2}$/.test(String(period ?? '')) ? period : lastMonth();
  return { ok: true, period: p, ...(await statementPage(env, origin, shop?.referrals, p, cursor, { snapshot: false })) };
}
export async function statementsSend(env, cat, origin, period, cursor = '') {
  const shop = shopOf(cat);
  const p = /^\d{4}-\d{2}$/.test(String(period ?? '')) ? period : (await pendingStatementPeriod(env, origin)) ?? lastMonth();
  const { sent, nextCursor, retryAfter, failures } = await sendStatements(env, origin, shop, p, { cursor });
  return { ok: true, period: p, nextCursor, sent, retryAfter, failures };
}
export const settleReferrer = (env, a) => settle(env, a.via, a.ref, { currency: a.currency });

function lastMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/* ------------------------------------------------------------------ for the rest of the Worker */

/** The play shell's boot facts: is there a shop to show under this studio's policy. */
export function shellShop(cat, game, { kids = false } = {}) {
  const shop = shopOf(cat);
  if (!shop || shop.audience === 'kids' || (kids && !shop.policy.kidsServer) || shop.till === 'off') return null;
  const items = itemsFor(shop, game);
  return items.length ? { items: items.length, currency: shop.currency, policy: shop.policy } : null;
}

/** The badge (a supporter's) a signed-in player shows in rooms; kids visibility follows studio policy. Verified here, never by a hello. */
export async function roomBadge(env, cat, player, { kids = false } = {}) {
  const shop = shopOf(cat);
  if (!shop || (kids && !shop.policy.kidsServer) || !/^pl_[A-Za-z0-9_-]{22}$/.test(String(player ?? ''))) return null;
  try {
    const owns = await ownsOf(env, player);
    const b = owns.find((o) => o.key.startsWith('badge:'));
    if (!b) return null;
    return shop.items.find((i) => i.id === b.item)?.badge ?? b.key.slice(6);
  } catch { return null; }
}
