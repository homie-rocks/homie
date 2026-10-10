
CREATE TABLE function_subscriptions(name TEXT PRIMARY KEY,type TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,started INTEGER NOT NULL,last_tick INTEGER NOT NULL DEFAULT 0);
CREATE INDEX function_subscriptions_type ON function_subscriptions(type,cursor);
DROP TRIGGER IF EXISTS shop_orders_function_paid;
DROP TRIGGER IF EXISTS shop_orders_function_refund;
DROP TRIGGER IF EXISTS purchase_orders_function_paid;
DROP TRIGGER IF EXISTS purchase_orders_function_refund;
DROP TRIGGER IF EXISTS app_records_function_insert;
DROP TRIGGER IF EXISTS app_records_function_update;
DROP TRIGGER IF EXISTS app_records_function_delete;
DROP TRIGGER IF EXISTS money_function_refund_insert;
DROP TRIGGER IF EXISTS money_function_refund_update;
DROP TRIGGER IF EXISTS mcp_function_call;
CREATE TABLE studio_events_next(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,type TEXT NOT NULL,data TEXT NOT NULL,at INTEGER NOT NULL);
INSERT INTO studio_events_next(id,type,data,at) SELECT id,type,data,at FROM studio_events ORDER BY at,id;
DROP TABLE studio_events;
ALTER TABLE studio_events_next RENAME TO studio_events;
CREATE INDEX studio_events_type_seq ON studio_events(type,seq);
CREATE INDEX function_deliveries_function_due ON function_deliveries(function,due) WHERE state IN ('pending','failed','running');
ALTER TABLE customer_offers ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX customer_offers_expiry ON customer_offers(expires_at);
DROP TRIGGER IF EXISTS shop_orders_function_paid; CREATE TRIGGER shop_orders_function_paid AFTER UPDATE ON shop_orders WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.paid') AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES('shop_orders:' || NEW.id || ':paid','order.paid',json_object('order',NEW.id,'source','shop_orders','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode),NEW.paid_at);
END;
DROP TRIGGER IF EXISTS shop_orders_function_refund; CREATE TRIGGER shop_orders_function_refund AFTER UPDATE ON shop_orders WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.refunded') AND OLD.status != 'refunded' AND NEW.status = 'refunded' AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES('shop_orders:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','shop_orders','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS purchase_orders_function_paid; CREATE TRIGGER purchase_orders_function_paid AFTER UPDATE ON purchase_orders WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.paid') AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL  BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES('purchase_orders:' || NEW.id || ':paid','order.paid',json_object('order',NEW.id,'source','purchase_orders','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode),NEW.paid_at);
END;
DROP TRIGGER IF EXISTS purchase_orders_function_refund; CREATE TRIGGER purchase_orders_function_refund AFTER UPDATE ON purchase_orders WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='order.refunded') AND OLD.status != 'refunded' AND NEW.status = 'refunded'  BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at) VALUES('purchase_orders:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','purchase_orders','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS app_records_function_insert; CREATE TRIGGER app_records_function_insert AFTER INSERT ON app_records WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','insert','data',json(NEW.value)),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS app_records_function_update; CREATE TRIGGER app_records_function_update AFTER UPDATE ON app_records WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','update','data',json(NEW.value)),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS app_records_function_delete; CREATE TRIGGER app_records_function_delete AFTER DELETE ON app_records WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',OLD.app,'collection',OLD.collection,'record',OLD.id,'version',OLD.version,'operation','delete','data',json(OLD.value)),OLD.updated_at);
END;

DROP TRIGGER IF EXISTS money_function_refund_insert; CREATE TRIGGER money_function_refund_insert AFTER INSERT ON meta WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='payment.refunded') AND NEW.key LIKE 'shop-money:%:refund:%' AND json_extract(NEW.value,'$.status')='succeeded'
AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id')) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;

DROP TRIGGER IF EXISTS money_function_refund_update; CREATE TRIGGER money_function_refund_update AFTER UPDATE ON meta WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='payment.refunded') AND NEW.key LIKE 'shop-money:%:refund:%' AND json_extract(NEW.value,'$.status')='succeeded'
AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id')) BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;
DROP TRIGGER IF EXISTS mcp_function_call; CREATE TRIGGER mcp_function_call AFTER INSERT ON mcp_audit WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='tool.called') AND NEW.outcome = 'ok' BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES('tool:' || NEW.id,'tool.called',json_object('tool',NEW.tool,'person',NEW.person,'client',NEW.client),NEW.at);
END;

