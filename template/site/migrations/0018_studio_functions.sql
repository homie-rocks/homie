
CREATE TABLE customer_offers(id TEXT PRIMARY KEY,kind TEXT NOT NULL,manifest TEXT NOT NULL);
CREATE TABLE service_results(order_id TEXT PRIMARY KEY,state TEXT NOT NULL,lease TEXT,due INTEGER NOT NULL,result TEXT);
CREATE TABLE studio_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE function_deliveries (
 event TEXT NOT NULL, function TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
 lease TEXT, error TEXT, completed INTEGER, PRIMARY KEY(event,function)
);
CREATE INDEX function_deliveries_due ON function_deliveries(state,due);

CREATE TRIGGER shop_orders_function_paid AFTER UPDATE ON shop_orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('shop_orders:' || NEW.id || ':paid','order.paid',json_object('order',NEW.id,'source','shop_orders','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode),NEW.paid_at);
END;
CREATE TRIGGER shop_orders_function_refund AFTER UPDATE ON shop_orders
WHEN OLD.status != 'refunded' AND NEW.status = 'refunded' AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id) BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('shop_orders:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','shop_orders','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;

CREATE TRIGGER purchase_orders_function_paid AFTER UPDATE ON purchase_orders
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL  BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('purchase_orders:' || NEW.id || ':paid','order.paid',json_object('order',NEW.id,'source','purchase_orders','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode),NEW.paid_at);
END;
CREATE TRIGGER purchase_orders_function_refund AFTER UPDATE ON purchase_orders
WHEN OLD.status != 'refunded' AND NEW.status = 'refunded'  BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('purchase_orders:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','purchase_orders','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;

CREATE TRIGGER app_records_function_insert AFTER INSERT ON app_records BEGIN
 INSERT INTO studio_events VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','insert','data',json(NEW.value)),NEW.updated_at);
END;

CREATE TRIGGER app_records_function_update AFTER UPDATE ON app_records BEGIN
 INSERT INTO studio_events VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','update','data',json(NEW.value)),NEW.updated_at);
END;

CREATE TRIGGER app_records_function_delete AFTER DELETE ON app_records BEGIN
 INSERT INTO studio_events VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',OLD.app,'collection',OLD.collection,'record',OLD.id,'version',OLD.version,'operation','delete','data',json(OLD.value)),OLD.updated_at);
END;

CREATE TRIGGER money_function_refund_insert AFTER INSERT ON meta
WHEN NEW.key LIKE 'shop-money:%:refund:%' AND json_extract(NEW.value,'$.status')='succeeded'
AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id')) BEGIN
 INSERT OR IGNORE INTO studio_events
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;

CREATE TRIGGER money_function_refund_update AFTER UPDATE ON meta
WHEN NEW.key LIKE 'shop-money:%:refund:%' AND json_extract(NEW.value,'$.status')='succeeded'
AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id')) BEGIN
 INSERT OR IGNORE INTO studio_events
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;
CREATE TRIGGER mcp_function_call AFTER INSERT ON mcp_audit WHEN NEW.outcome = 'ok' BEGIN
 INSERT INTO studio_events VALUES('tool:' || NEW.id,'tool.called',json_object('tool',NEW.tool,'person',NEW.person,'client',NEW.client),NEW.at);
END;
