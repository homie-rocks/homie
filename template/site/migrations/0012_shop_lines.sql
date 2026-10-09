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
