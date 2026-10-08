/**
 * The shop's rows in the studio's own D1 (@homie-rocks/studio 0.24.0, migration 0008_studio_shop.sql). Kept apart
 * from worker/shop.mjs so player accounts (worker/players.mjs) can export and forget a player's purchases without
 * importing the routes.
 *
 * WHAT IS STORED: orders (the item, the price, the state, Stripe's ids, the referrer's host), entitlements (what a
 * player owns, by the keys the game reads), the age question's answer as a BAND only (adult, teen or child; never a
 * date), one-time links a teenager hands a parent, the webhook events already handled (ids only), referral lines
 * (the seller's books) and the statements other studios sent this one. NO card, NO address, NO email, NO name:
 * Stripe keeps the buyer's details and sends the receipt.
 */

export const SHOP_MIGRATION_FILE = '0008_studio_shop.sql';
export const SHOP_MIGRATION = `-- The shop (@homie-rocks/studio 0.24.0): what players bought here with the studio's own Stripe (shop/SHOP.md).
-- No card, no address, no email: Stripe keeps the buyer's details and sends the receipt. An age is kept only as a
-- band (adult, teen, child). An order outlives a deleted account without the player (the law keeps sales records).
CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  player TEXT,
  item TEXT NOT NULL,
  game TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  tax INTEGER,
  total INTEGER,
  till TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  session TEXT UNIQUE,
  payment TEXT,
  refund TEXT,
  dispute TEXT,
  parent INTEGER NOT NULL DEFAULT 0,
  via TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shop_orders_player ON shop_orders (player, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_status ON shop_orders (status, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_payment ON shop_orders (payment);
CREATE TABLE IF NOT EXISTS entitlements (
  player TEXT NOT NULL,
  key TEXT NOT NULL,
  item TEXT NOT NULL,
  order_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  state TEXT NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (player, key, order_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entitlements_order ON entitlements (order_id);
CREATE TABLE IF NOT EXISTS shop_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_age (
  player TEXT PRIMARY KEY,
  band TEXT NOT NULL,
  asked_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS shop_parent_links (
  hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  item TEXT NOT NULL,
  game TEXT,
  order_id TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS referral_lines (
  order_id TEXT PRIMARY KEY,
  via TEXT NOT NULL,
  net INTEGER NOT NULL,
  rate REAL NOT NULL,
  share INTEGER NOT NULL,
  currency TEXT NOT NULL,
  state TEXT NOT NULL,
  period TEXT NOT NULL,
  hold_until INTEGER NOT NULL,
  settled_ref TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS referral_lines_via ON referral_lines (via, period);
CREATE TABLE IF NOT EXISTS referral_statements (
  seller TEXT NOT NULL,
  period TEXT NOT NULL,
  owed INTEGER NOT NULL,
  pending INTEGER NOT NULL,
  currency TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (seller, period)
) WITHOUT ROWID;
`;

export const SHOP_RESERVATIONS_FILE = '0010_shop_reservations.sql';
export const SHOP_RESERVATIONS = `-- Checkout expiry in milliseconds; only sessionless rows age out after a one-minute margin.
ALTER TABLE shop_orders ADD COLUMN expires_at INTEGER;
-- Previously opened sessions used the same explicit 31-minute lifetime.
UPDATE shop_orders SET expires_at = (CAST(created_at / 1000 AS INTEGER) + 31 * 60) * 1000 WHERE status IN ('started', 'processing');
CREATE INDEX IF NOT EXISTS referral_lines_book ON referral_lines (via, currency, order_id);
`;

export const SHOP_STATEMENTS_FILE = '0011_shop_statements.sql';
export const SHOP_STATEMENTS = `-- Statements retain independent currencies and an immutable edition while sending.
ALTER TABLE referral_statements RENAME TO referral_statements_old;
CREATE TABLE referral_statements (
  seller TEXT NOT NULL, period TEXT NOT NULL, owed INTEGER NOT NULL, pending INTEGER NOT NULL,
  currency TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL,
  PRIMARY KEY (seller, period, currency)
) WITHOUT ROWID;
INSERT INTO referral_statements SELECT * FROM referral_statements_old;
DROP TABLE referral_statements_old;
CREATE TABLE referral_editions (id TEXT PRIMARY KEY, period TEXT NOT NULL, issued INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE referral_edition_lines (
  edition TEXT NOT NULL, order_id TEXT NOT NULL, via TEXT NOT NULL, currency TEXT NOT NULL,
  net INTEGER NOT NULL, rate REAL NOT NULL, share INTEGER NOT NULL, state TEXT NOT NULL,
  period TEXT NOT NULL, hold_until INTEGER NOT NULL, created_at INTEGER NOT NULL, item TEXT, paid_at INTEGER,
  PRIMARY KEY (edition, via, currency, order_id)
) WITHOUT ROWID;
`;

const DAY = 86_400_000;
export const ORDER_ID = /^ord_[A-Za-z0-9]{20}$/;
const PLAYER_ID = /^pl_[A-Za-z0-9_-]{22}$/;

export function newOrderId() {
  const raw = new Uint8Array(15);
  crypto.getRandomValues(raw);
  return `ord_${btoa(String.fromCharCode(...raw)).replace(/[^A-Za-z0-9]/g, '').padEnd(20, '0').slice(0, 20)}`;
}

const completeSchemas = new WeakSet();

/** Name the first missing schema migration, including a present table with an older shape. */
export async function migrationNeeded(env) {
  if (!env?.DB) return SHOP_MIGRATION_FILE;
  if (completeSchemas.has(env.DB)) return null;
  for (const [file, query] of [
    [SHOP_MIGRATION_FILE, 'SELECT 1 FROM shop_orders LIMIT 1'],
    [SHOP_RESERVATIONS_FILE, 'SELECT expires_at FROM shop_orders LIMIT 1'],
    [SHOP_STATEMENTS_FILE, 'SELECT issued FROM referral_editions LIMIT 1'],
    [SHOP_STATEMENTS_FILE, 'SELECT edition FROM referral_edition_lines LIMIT 1'],
  ]) {
    try { await env.DB.prepare(query).first(); } catch { return file; }
  }
  completeSchemas.add(env.DB);
  return null;
}

export async function migrated(env, { complete = true } = {}) {
  if (complete) return !(await migrationNeeded(env));
  if (!env?.DB) return false;
  try { await env.DB.prepare('SELECT 1 FROM shop_orders LIMIT 1').first(); return true; } catch { return false; }
}

/** The age band this account gave (adult, teen, child), or null when it has not been asked. */
export async function bandOfPlayer(env, player) {
  if (!PLAYER_ID.test(String(player ?? ''))) return null;
  try { return (await env.DB.prepare('SELECT band FROM player_age WHERE player = ?1').bind(player).first())?.band ?? null; } catch { return null; }
}

/** The answer is kept once: a player cannot answer again to get a different band. */
export async function setBand(env, player, band) {
  await env.DB.prepare('INSERT INTO player_age (player, band, asked_at) VALUES (?1, ?2, ?3) ON CONFLICT(player) DO NOTHING').bind(player, band, Date.now()).run();
  return bandOfPlayer(env, player);
}

/** What a player owns now: [{ key, item, until, used }] (live entitlements only). */
export async function ownsOf(env, player, now = Date.now()) {
  if (!PLAYER_ID.test(String(player ?? ''))) return [];
  try {
    const { results } = await env.DB.prepare("SELECT key, item, ends_at, used_at FROM entitlements WHERE player = ?1 AND state = 'active' AND starts_at <= ?2 AND (ends_at IS NULL OR ends_at > ?2) ORDER BY starts_at").bind(player, now).all();
    const out = new Map();
    for (const r of results ?? []) {
      const until = r.ends_at === null ? null : Number(r.ends_at);
      const prev = out.get(r.key);
      // Two orders of the same key: the one that lasts longest wins.
      if (!prev || (prev.until !== null && (until === null || until > prev.until))) out.set(r.key, { key: r.key, item: r.item, until, used: r.used_at !== null && r.used_at !== undefined });
    }
    return [...out.values()];
  } catch { return []; }
}

/** What a player spent here this calendar month (paid, and checkouts still open), in minor units. */
export async function spentThisMonth(env, player, now = Date.now()) {
  // A Stripe session remains reserved until Stripe confirms its outcome. Test rows never consume a live cap.
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM shop_orders WHERE player = ?1 AND mode = ?4 AND ((status IN ('paid', 'disputed') AND paid_at >= ?2) OR (status IN ('started', 'processing') AND (session IS NOT NULL OR COALESCE(expires_at, created_at + 1860000) + 60000 > ?3)))").bind(player, start, now, String(env.STRIPE_KEY).includes('_live_') ? 'live' : 'test').first();
  return Number(r?.n) || 0;
}

export async function orderById(env, id) {
  if (!ORDER_ID.test(String(id ?? ''))) return null;
  try { return await env.DB.prepare('SELECT * FROM shop_orders WHERE id = ?1').bind(id).first(); } catch { return null; }
}

export const orderBySession = (env, session) => env.DB.prepare('SELECT * FROM shop_orders WHERE session = ?1').bind(String(session ?? '')).first();
export const orderByPayment = (env, payment) => env.DB.prepare('SELECT * FROM shop_orders WHERE payment = ?1').bind(String(payment ?? '')).first();

/** An order as the player, the office and the export see it (never a card, never an email). */
export function orderView(r) {
  return {
    id: r.id, item: r.item, game: r.game ?? null, amount: Number(r.amount), currency: r.currency, tax: r.tax === null ? null : Number(r.tax), total: r.total === null ? null : Number(r.total),
    status: r.status, till: r.till, mode: r.mode, parent: Number(r.parent) === 1, via: r.via ?? null,
    createdAt: Number(r.created_at), paidAt: r.paid_at === null ? null : Number(r.paid_at), refundedAt: r.refunded_at === null ? null : Number(r.refunded_at),
  };
}

/** Internal reservation decisions leave the player's unfinished order as it was. */
export function playerOrderStatus(row) {
  return ['missing', 'released'].includes(row.status) ? (/; previous status: processing$/.test(row.note ?? '') ? 'processing' : 'started') : row.status;
}

/** Everything of a player's in the shop, for their own export (worker/players.mjs). */
export async function shopDataOf(env, player) {
  try {
    const orders = ((await env.DB.prepare("SELECT * FROM shop_orders WHERE player = ?1 AND status != 'started' ORDER BY created_at").bind(player).all()).results ?? []).filter((r) => playerOrderStatus(r) !== 'started').map((r) => orderView({ ...r, status: playerOrderStatus(r) }));
    const owns = await ownsOf(env, player);
    const band = await bandOfPlayer(env, player);
    return { orders, owns, ageBand: band };
  } catch { return null; }
}

/** Whether a player owns something that would be lost with their account (the delete asks first). */
export async function livePurchases(env, player) {
  return (await ownsOf(env, player)).length;
}

/**
 * A deleted account: what it owned goes, its age band goes, and its orders stay WITHOUT the player (a seller keeps
 * sales records for its accountant and the tax office; nothing left in them names anyone). Statements for D1's batch.
 */
export function forgetPlayerShop(env, player) {
  return [
    env.DB.prepare('DELETE FROM entitlements WHERE player = ?1').bind(player),
    env.DB.prepare('DELETE FROM player_age WHERE player = ?1').bind(player),
    env.DB.prepare('DELETE FROM shop_parent_links WHERE player = ?1').bind(player),
    env.DB.prepare('UPDATE shop_orders SET player = NULL WHERE player = ?1').bind(player),
  ];
}

/** Grant an order's entitlements (idempotent on player, key and order). */
export function grantStatements(env, order, item, now = Date.now()) {
  const starts = item.starts ? Math.max(now, Date.parse(item.starts)) : now;
  const ends = item.ends ? Date.parse(item.ends) : item.days ? starts + Math.round(item.days * DAY) : null;
  return (item.gives ?? []).map((key) => env.DB.prepare("INSERT INTO entitlements (player, key, item, order_id, starts_at, ends_at, state, used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', NULL) ON CONFLICT(player, key, order_id) DO UPDATE SET state = 'active'")
    .bind(order.player, key, item.id, order.id, starts, ends));
}

export const revokeStatement = (env, orderId) => env.DB.prepare("UPDATE entitlements SET state = 'revoked' WHERE order_id = ?1").bind(orderId);
export const restoreStatement = (env, orderId) => env.DB.prepare("UPDATE entitlements SET state = 'active' WHERE order_id = ?1").bind(orderId);

/** The badge a player shows in rooms (a supporter's), from what they own: the first live badge key, or null. */
export async function badgeOf(env, player, shop) {
  const owns = await ownsOf(env, player);
  const key = owns.find((o) => o.key.startsWith('badge:'));
  if (!key) return null;
  const item = (shop?.items ?? []).find((i) => i.id === key.item);
  return item?.badge ?? key.key.slice(6);
}

/** Guest purchases move with their player when they sign into an existing account. */
export async function adoptShopStatements(env, guest, player) {
  if (!(await migrated(env, { complete: false }))) return [];
  return [
    env.DB.prepare('UPDATE shop_orders SET player = ?2 WHERE player = ?1').bind(guest, player),
    env.DB.prepare('UPDATE entitlements SET player = ?2 WHERE player = ?1').bind(guest, player),
    env.DB.prepare('UPDATE shop_parent_links SET player = ?2 WHERE player = ?1').bind(guest, player),
    env.DB.prepare('INSERT INTO player_age (player, band, asked_at) SELECT ?2, band, asked_at FROM player_age WHERE player = ?1 ON CONFLICT(player) DO NOTHING').bind(guest, player),
    env.DB.prepare('DELETE FROM player_age WHERE player = ?1').bind(guest),
  ];
}
