-- Released shop schema before removal; used only to exercise the destructive upgrade.
-- The shop (@homie-rocks/studio 0.24.0): what players bought here with the studio's own Stripe (shop/SHOP.md).
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
-- Checkout expiry in milliseconds; only sessionless rows age out after a one-minute margin.
ALTER TABLE shop_orders ADD COLUMN expires_at INTEGER;
-- Previously opened sessions used the same explicit 31-minute lifetime.
UPDATE shop_orders SET expires_at = (CAST(created_at / 1000 AS INTEGER) + 31 * 60) * 1000 WHERE status IN ('started', 'processing');
CREATE INDEX IF NOT EXISTS referral_lines_book ON referral_lines (via, currency, order_id);
-- Statements retain independent currencies and an immutable edition while sending.
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
-- Each checkout retains its item snapshots and independently refundable lines.
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
CREATE INDEX shop_orders_attention_player ON shop_orders (mode, player, status, updated_at, id) WHERE attention = 1;
CREATE INDEX shop_orders_attention ON shop_orders (mode, status, updated_at, id) WHERE attention = 1;
