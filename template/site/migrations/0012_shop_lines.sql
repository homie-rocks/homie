-- Each checkout retains its item snapshots and independently refundable lines.
CREATE TABLE shop_order_lines (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL,
  item TEXT NOT NULL, quantity INTEGER NOT NULL, unit_amount INTEGER NOT NULL,
  amount INTEGER NOT NULL, total INTEGER, snapshot TEXT, status TEXT NOT NULL DEFAULT 'started',
  refund TEXT, refunded_at INTEGER, UNIQUE(order_id, position)
);
INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount, total, status, refund, refunded_at)
SELECT id || '_0', id, 0, item, 1, amount, amount, total, status, refund, refunded_at FROM shop_orders;
ALTER TABLE entitlements RENAME TO entitlements_before_lines;
CREATE TABLE entitlements (
  player TEXT NOT NULL, key TEXT NOT NULL, item TEXT NOT NULL, order_id TEXT NOT NULL,
  line_id TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER NOT NULL, ends_at INTEGER, state TEXT NOT NULL, used_at INTEGER,
  PRIMARY KEY (player, key, order_id, line_id)
) WITHOUT ROWID;
INSERT INTO entitlements (player, key, item, order_id, line_id, starts_at, ends_at, state, used_at)
SELECT player, key, item, order_id, order_id || '_0', starts_at, ends_at, state, used_at FROM entitlements_before_lines;
DROP TABLE entitlements_before_lines;
CREATE INDEX entitlements_order ON entitlements (order_id);
ALTER TABLE shop_parent_links ADD COLUMN cart TEXT;
ALTER TABLE shop_orders ADD COLUMN referral_terms TEXT;
ALTER TABLE shop_orders ADD COLUMN checkout_player TEXT;
UPDATE shop_orders SET checkout_player = player;
ALTER TABLE referral_lines ADD COLUMN original_share INTEGER;
UPDATE referral_lines SET original_share = share;
