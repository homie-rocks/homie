-- Remove referral bookkeeping; no studio we run has data in these tables.
DROP TABLE IF EXISTS referral_lines;
DROP TABLE IF EXISTS referral_statements;
DROP TABLE IF EXISTS referral_statements_old;
DROP TABLE IF EXISTS referral_editions;
DROP TABLE IF EXISTS referral_edition_lines;
DELETE FROM meta WHERE key IN ('referral_cookie_key', 'referral_signing_key') OR key GLOB 'referral-*';
UPDATE shop_parent_links SET cart = json_remove(cart, '$[0].via') WHERE json_valid(cart);
-- Rebuild orders to remove sales attribution, on both old and fresh schemas.
CREATE TABLE shop_orders_clean (
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
  note TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  whole_refund TEXT,
  checkout_player TEXT,
  attention INTEGER NOT NULL DEFAULT 1,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  refunded_net INTEGER NOT NULL DEFAULT 0,
  refund_revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shop_orders_clean (id, player, item, game, amount, currency, tax, total, till, mode, status, session, payment, refund, dispute, parent, note, created_at, paid_at, refunded_at, updated_at, expires_at, whole_refund, checkout_player, attention, refunded_amount, refunded_net, refund_revision) SELECT id, player, item, game, amount, currency, tax, total, till, mode, status, session, payment, refund, dispute, parent, note, created_at, paid_at, refunded_at, updated_at, expires_at, whole_refund, checkout_player, attention, refunded_amount, refunded_net, refund_revision FROM shop_orders;
DROP TABLE shop_orders;
ALTER TABLE shop_orders_clean RENAME TO shop_orders;
CREATE INDEX IF NOT EXISTS shop_orders_player ON shop_orders (player, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_status ON shop_orders (status, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_payment ON shop_orders (payment);
CREATE INDEX shop_orders_attention_player ON shop_orders (mode, player, status, updated_at, id) WHERE attention = 1;
CREATE INDEX shop_orders_attention ON shop_orders (mode, status, updated_at, id) WHERE attention = 1;
CREATE TRIGGER shop_checkout_player_insert AFTER INSERT ON shop_orders BEGIN
  UPDATE shop_orders SET checkout_player = NEW.player WHERE id = NEW.id;
END;
CREATE TRIGGER shop_forget_checkout_player AFTER UPDATE OF player ON shop_orders WHEN NEW.player IS NULL BEGIN
  UPDATE shop_orders SET checkout_player = NULL WHERE id = NEW.id;
END;
-- Restore durable paid and refunded events after rebuilding the order table.

DROP TRIGGER IF EXISTS shop_orders_function_paid;
CREATE TRIGGER shop_orders_function_paid AFTER UPDATE ON shop_orders
WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.paid')
 AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 VALUES('shop_orders:' || NEW.id || ':paid','order.paid',
 json_object('order',NEW.id,'source','shop_orders','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode,
 'app',NEW.game,'reference',(SELECT value FROM meta WHERE key='shop-reference:' || NEW.id)),NEW.paid_at);
END;

CREATE TRIGGER shop_orders_function_refund AFTER UPDATE ON shop_orders WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.refunded') AND OLD.status != 'refunded' AND NEW.status = 'refunded' AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES('shop_orders:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','shop_orders','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;
