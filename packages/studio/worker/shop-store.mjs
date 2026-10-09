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

export const SHOP_LINES_FILE = '0012_shop_lines.sql';
export const SHOP_LINES = `-- Each checkout retains its item snapshots and independently refundable lines.
CREATE TABLE shop_order_lines (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL,
  item TEXT NOT NULL, quantity INTEGER NOT NULL, unit_amount INTEGER NOT NULL,
  amount INTEGER NOT NULL, total INTEGER, snapshot TEXT, status TEXT NOT NULL DEFAULT 'started',
  refund TEXT, refunded_at INTEGER, refunded_amount INTEGER NOT NULL DEFAULT 0, refunded_net INTEGER NOT NULL DEFAULT 0, UNIQUE(order_id, position)
);
INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount, total, status, refund, refunded_at)
SELECT id || '_0', id, 0, item, 1, amount, amount, total, status, refund, refunded_at FROM shop_orders;
-- Keep the released entitlement key and columns intact for rolling deploys and rollback.
CREATE TABLE shop_entitlement_lines (
  player TEXT NOT NULL, key TEXT NOT NULL, item TEXT NOT NULL, order_id TEXT NOT NULL,
  line_id TEXT NOT NULL, quantity INTEGER NOT NULL,
  starts_at INTEGER NOT NULL, ends_at INTEGER, state TEXT NOT NULL,
  PRIMARY KEY (player, key, order_id, line_id)
) WITHOUT ROWID;
CREATE TRIGGER shop_entitlements_delete AFTER DELETE ON entitlements BEGIN
  DELETE FROM shop_entitlement_lines WHERE player = OLD.player AND key = OLD.key AND order_id = OLD.order_id;
END;
CREATE TRIGGER shop_entitlements_adopt AFTER UPDATE OF player ON entitlements BEGIN
  UPDATE shop_entitlement_lines SET player = NEW.player WHERE player = OLD.player AND key = OLD.key AND order_id = OLD.order_id;
END;
UPDATE shop_order_lines SET refunded_amount = COALESCE(total, amount), refunded_net = amount WHERE status = 'refunded';
ALTER TABLE shop_parent_links ADD COLUMN cart TEXT;
ALTER TABLE shop_orders ADD COLUMN whole_refund TEXT;
ALTER TABLE shop_orders ADD COLUMN referral_terms TEXT;
ALTER TABLE shop_orders ADD COLUMN checkout_player TEXT;
UPDATE shop_orders SET checkout_player = player;
CREATE TRIGGER shop_checkout_player_insert AFTER INSERT ON shop_orders BEGIN
  UPDATE shop_orders SET checkout_player = NEW.player WHERE id = NEW.id;
END;
CREATE TRIGGER shop_forget_checkout_player AFTER UPDATE OF player ON shop_orders WHEN NEW.player IS NULL BEGIN
  UPDATE shop_orders SET checkout_player = NULL WHERE id = NEW.id;
END;
ALTER TABLE referral_lines ADD COLUMN original_share INTEGER;
UPDATE referral_lines SET original_share = share;
ALTER TABLE shop_orders ADD COLUMN attention INTEGER NOT NULL DEFAULT 1;
UPDATE shop_orders SET attention = 0 WHERE status = 'paid' AND EXISTS (SELECT 1 FROM entitlements WHERE order_id = shop_orders.id);
ALTER TABLE shop_orders ADD COLUMN refunded_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_orders ADD COLUMN refunded_net INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_orders ADD COLUMN refund_revision INTEGER NOT NULL DEFAULT 0;
UPDATE shop_orders SET refunded_amount = COALESCE(total, amount), refunded_net = amount WHERE status = 'refunded';
CREATE INDEX shop_orders_attention_player ON shop_orders (mode, player, updated_at, id) WHERE attention = 1 AND status IN ('started', 'processing', 'paid');
CREATE INDEX shop_orders_attention ON shop_orders (mode, updated_at, id) WHERE attention = 1 AND status IN ('started', 'processing', 'paid');
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
    [SHOP_LINES_FILE, 'SELECT snapshot, total, refunded_amount FROM shop_order_lines LIMIT 1'],
    [SHOP_LINES_FILE, 'SELECT line_id, quantity FROM shop_entitlement_lines LIMIT 1'],
    [SHOP_LINES_FILE, 'SELECT referral_terms, checkout_player, attention, refunded_amount, refund_revision FROM shop_orders LIMIT 1'],
    [SHOP_LINES_FILE, 'SELECT cart FROM shop_parent_links LIMIT 1'],
    [SHOP_LINES_FILE, 'SELECT original_share FROM referral_lines LIMIT 1'],
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
    let results;
    try {
      ({ results } = await env.DB.prepare("SELECT l.key, l.item, l.ends_at, e.used_at, l.quantity FROM shop_entitlement_lines l JOIN entitlements e ON e.player = l.player AND e.key = l.key AND e.order_id = l.order_id WHERE l.player = ?1 AND l.state = 'active' AND e.state = 'active' AND l.starts_at <= ?2 AND (l.ends_at IS NULL OR l.ends_at > ?2) UNION ALL SELECT e.key, e.item, e.ends_at, e.used_at, 1 AS quantity FROM entitlements e WHERE e.player = ?1 AND e.state = 'active' AND e.starts_at <= ?2 AND (e.ends_at IS NULL OR e.ends_at > ?2) AND NOT EXISTS (SELECT 1 FROM shop_entitlement_lines l WHERE l.player = e.player AND l.key = e.key AND l.order_id = e.order_id)").bind(player, now).all());
    } catch {
      ({ results } = await env.DB.prepare("SELECT key, item, ends_at, used_at, 1 AS quantity FROM entitlements WHERE player = ?1 AND state = 'active' AND starts_at <= ?2 AND (ends_at IS NULL OR ends_at > ?2) ORDER BY starts_at").bind(player, now).all());
    }
    const out = new Map(), quantities = new Map();
    for (const r of results ?? []) {
      quantities.set(r.key, (quantities.get(r.key) ?? 0n) + BigInt(r.quantity));
      const until = r.ends_at === null ? null : Number(r.ends_at);
      const prev = out.get(r.key);
      // Two orders of the same key: the one that lasts longest wins.
      if (!prev || (prev.until !== null && (until === null || until > prev.until))) out.set(r.key, { key: r.key, item: r.item, until, used: r.used_at !== null && r.used_at !== undefined });
    }
    for (const value of out.values()) {
      const quantity = quantities.get(value.key);
      value.quantity = quantity <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(quantity) : String(quantity);
    }
    return [...out.values()];
  } catch { return []; }
}

/** What a player spent here this calendar month (paid, and checkouts still open), in minor units. */
export async function spentThisMonth(env, player, now = Date.now()) {
  // A Stripe session remains reserved until Stripe confirms its outcome. Test rows never consume a live cap.
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(amount - refunded_net), 0) AS n FROM shop_orders WHERE player = ?1 AND mode = ?4 AND ((status IN ('paid', 'disputed') AND paid_at >= ?2) OR (status IN ('started', 'processing') AND (session IS NOT NULL OR COALESCE(expires_at, created_at + 1860000) + 60000 > ?3)))").bind(player, start, now, String(env.STRIPE_KEY).includes('_live_') ? 'live' : 'test').first();
  return Number(r?.n) || 0;
}

export async function orderById(env, id) {
  if (!ORDER_ID.test(String(id ?? ''))) return null;
  try { return await env.DB.prepare('SELECT * FROM shop_orders WHERE id = ?1').bind(id).first(); } catch { return null; }
}

export async function orderLines(env, id) {
  const o = await orderById(env, id);
  if (!o) return [];
  const fallback = { id: id + '_0', order_id: id, position: 0, item: o.item, quantity: 1, unit_amount: o.amount, amount: o.amount, total: o.total, snapshot: null, status: o.status, refund: o.refund, refunded_at: o.refunded_at };
  try {
    let rows = (await env.DB.prepare('SELECT * FROM shop_order_lines WHERE order_id = ?1 ORDER BY position').bind(id).all()).results ?? [];
    if (!rows.length) {
      await env.DB.prepare('INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount, total, status, refund, refunded_at) VALUES (?1, ?2, 0, ?3, 1, ?4, ?4, ?5, ?6, ?7, ?8) ON CONFLICT DO NOTHING').bind(fallback.id, id, o.item, o.amount, o.total, o.status, o.refund, o.refunded_at).run();
      rows = (await env.DB.prepare('SELECT * FROM shop_order_lines WHERE order_id = ?1 ORDER BY position').bind(id).all()).results ?? [];
    }
    // A released Worker may have paid or refunded after the step without touching its single line.
    if (rows.length === 1 && !rows[0].snapshot && o.paid_at !== null) {
      await env.DB.prepare("UPDATE shop_order_lines SET status = ?2, total = ?3, refund = ?4, refunded_at = ?5, refunded_amount = CASE WHEN ?2 = 'refunded' THEN COALESCE(?3, amount) ELSE refunded_amount END, refunded_net = CASE WHEN ?2 = 'refunded' THEN amount ELSE refunded_net END WHERE id = ?1 AND snapshot IS NULL").bind(rows[0].id, o.status, o.total, o.refund, o.refunded_at).run();
      rows[0] = { ...rows[0], status: o.status, total: o.total, refund: o.refund, refunded_at: o.refunded_at };
    }
    return rows.map((line) => ['refunded', 'lost', 'disputed'].includes(o.status) && (line.status !== 'refunded' || o.status === 'refunded') ? { ...line, status: o.status } : line);
  } catch (error) {
    if (!/no such table/i.test(String(error.message))) throw error;
    return [fallback];
  }
}

export function lineView(r) {
  const item = r.snapshot ? JSON.parse(r.snapshot) : null;
  return { id: r.id, refundedAmount: Number(r.refunded_amount ?? 0), item: r.item, name: item?.name ?? r.item, kind: item?.kind ?? null, quantity: Number(r.quantity), unitAmount: Number(r.unit_amount), amount: Number(r.amount), total: r.total === null ? null : Number(r.total), status: r.status, refundedAt: r.refunded_at };
}

export const orderBySession = (env, session) => env.DB.prepare('SELECT * FROM shop_orders WHERE session = ?1').bind(String(session ?? '')).first();
export const orderByPayment = (env, payment) => env.DB.prepare('SELECT * FROM shop_orders WHERE payment = ?1').bind(String(payment ?? '')).first();

/** An order as the player, the office and the export see it (never a card, never an email). */
export function orderView(r) {
  return {
    id: r.id, refundedAmount: Number(r.refunded_amount ?? 0), item: r.item, game: r.game ?? null, amount: Number(r.amount), currency: r.currency, tax: r.tax === null ? null : Number(r.tax), total: r.total === null ? null : Number(r.total),
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
    for (const order of orders) order.lines = (await orderLines(env, order.id)).map(lineView);
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
export function grantStatements(env, order, item, now = Date.now(), line = { id: order.id + '_0', quantity: 1 }) {
  const starts = item.starts ? Math.max(now, Date.parse(item.starts)) : now;
  const ends = item.ends ? Date.parse(item.ends) : item.days !== undefined && item.days !== null ? starts + Math.round(item.days * DAY) : null;
  return (item.gives ?? []).flatMap((key) => [
    env.DB.prepare("INSERT INTO entitlements (player, key, item, order_id, starts_at, ends_at, state, used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', NULL) ON CONFLICT(player, key, order_id) DO UPDATE SET starts_at = MIN(starts_at, excluded.starts_at), ends_at = CASE WHEN ends_at IS NULL OR excluded.ends_at IS NULL THEN NULL ELSE MAX(ends_at, excluded.ends_at) END").bind(order.player, key, item.id, order.id, starts, ends),
    env.DB.prepare("INSERT INTO shop_entitlement_lines (player, key, item, order_id, line_id, quantity, starts_at, ends_at, state) SELECT ?1, ?2, ?3, ?4, ?7, ?8, ?5, ?6, 'active' WHERE NOT EXISTS (SELECT 1 FROM entitlements WHERE player = ?1 AND key = ?2 AND order_id = ?4 AND state != 'active') ON CONFLICT DO NOTHING").bind(order.player, key, item.id, order.id, starts, ends, line.id, line.quantity),
  ]);
}

export const revokeStatement = (env, orderId) => env.DB.prepare("UPDATE entitlements SET state = 'revoked' WHERE order_id = ?1").bind(orderId);
export const restoreStatement = (env, orderId) => env.DB.prepare("UPDATE entitlements SET state = 'active' WHERE order_id = ?1 AND EXISTS (SELECT 1 FROM shop_orders WHERE id = ?1 AND status = 'paid') AND EXISTS (SELECT 1 FROM shop_order_lines WHERE order_id = ?1 AND status != 'refunded') AND (NOT EXISTS (SELECT 1 FROM shop_entitlement_lines l WHERE l.order_id = ?1 AND l.key = entitlements.key) OR EXISTS (SELECT 1 FROM shop_entitlement_lines l WHERE l.order_id = ?1 AND l.key = entitlements.key AND l.state = 'active'))").bind(orderId);

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
