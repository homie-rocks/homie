
CREATE TABLE shop_subscriptions (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, customer TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'active', event_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE shop_subscription_events (
 id TEXT PRIMARY KEY, subscription TEXT NOT NULL, type TEXT NOT NULL,
 invoice TEXT, amount INTEGER, currency TEXT, at INTEGER NOT NULL
);
CREATE TRIGGER shop_subscription_event AFTER INSERT ON shop_subscription_events BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'subscription:' || NEW.id,NEW.type,
 json_object('subscription',NEW.subscription,'order',s.order_id,'app',o.game,
 'reference',(SELECT value FROM meta WHERE key='shop-reference:' || o.id),
 'invoice',NEW.invoice,'amount',NEW.amount,'currency',NEW.currency,'mode',o.mode),NEW.at
 FROM shop_subscriptions s JOIN shop_orders o ON o.id=s.order_id
 WHERE s.id=NEW.subscription AND EXISTS(SELECT 1 FROM function_subscriptions WHERE type=NEW.type);
END;
