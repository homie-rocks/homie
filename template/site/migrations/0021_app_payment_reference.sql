
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
