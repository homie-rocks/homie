
ALTER TABLE shop_bookings ADD COLUMN paid_at INTEGER;
ALTER TABLE shop_bookings ADD COLUMN actor TEXT;
ALTER TABLE shop_bookings ADD COLUMN token_hash TEXT;
ALTER TABLE shop_bookings ADD COLUMN hold_until INTEGER;
DROP TRIGGER booking_capacity_move;
CREATE TRIGGER booking_capacity_move BEFORE UPDATE OF slot,quantity,state ON shop_bookings
WHEN NEW.state IN ('held','confirmed') BEGIN
 SELECT RAISE(ABORT,'booking capacity unavailable') WHERE NOT EXISTS (
 SELECT 1 FROM app_records s WHERE s.app=NEW.app AND s.collection=NEW.slots AND s.id=NEW.slot
 AND json_type(s.value,'$.capacity')='integer' AND json_extract(s.value,'$.capacity') >= NEW.quantity +
 (SELECT COALESCE(SUM(quantity),0) FROM shop_bookings WHERE app=NEW.app AND slots=NEW.slots AND slot=NEW.slot AND id!=NEW.id AND state IN ('held','confirmed')));
END;
CREATE TRIGGER booking_hold_claim BEFORE UPDATE OF order_id ON shop_bookings BEGIN
 SELECT RAISE(ABORT,'booking hold changed or expired') WHERE NEW.order_id IS NULL OR OLD.order_id!='hold:'||OLD.id OR OLD.state NOT IN ('held','confirmed') OR (OLD.state='held' AND OLD.hold_until<=NEW.updated_at);
END;
DROP TRIGGER booking_order_state;
CREATE TRIGGER booking_order_state AFTER UPDATE OF status,paid_at ON shop_orders
WHEN NEW.status!=OLD.status OR (OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) BEGIN
 UPDATE shop_bookings SET state=CASE WHEN NEW.status='paid' THEN 'confirmed' ELSE 'released' END,
 paid_at=COALESCE(NEW.paid_at,paid_at),version=version+1,updated_at=NEW.updated_at
 WHERE order_id=NEW.id AND ((state IN ('pending','held','confirmed') AND NEW.status='paid')
 OR (state IN ('pending','held') AND NEW.status IN ('expired','failed'))
 OR (state IN ('pending','held','confirmed') AND NEW.status IN ('refunded','lost')));
END;
DROP TRIGGER booking_record_insert;
CREATE TRIGGER booking_record_insert AFTER INSERT ON shop_bookings BEGIN
 INSERT INTO app_records(app,collection,id,value,version,updated_at)
 VALUES(NEW.app,NEW.collection,NEW.id,json_object('slot',NEW.slot,'quantity',NEW.quantity,'state',NEW.state,'paid',json(CASE WHEN NEW.paid_at IS NULL THEN 'false' ELSE 'true' END)),NEW.version,NEW.updated_at)
 ON CONFLICT(app,collection,id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at;
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'booking:' || NEW.id || ':' || NEW.version,'booking.' || NEW.state,
 json_object('booking',NEW.id,'app',NEW.app,'collection',NEW.collection,'slot',NEW.slot,'state',NEW.state,'quantity',NEW.quantity,'order',NEW.order_id,'version',NEW.version),NEW.updated_at
 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE type='booking.' || NEW.state);
END;
DROP TRIGGER booking_record_update;
CREATE TRIGGER booking_record_update AFTER UPDATE ON shop_bookings BEGIN
 INSERT INTO app_records(app,collection,id,value,version,updated_at)
 VALUES(NEW.app,NEW.collection,NEW.id,json_object('slot',NEW.slot,'quantity',NEW.quantity,'state',NEW.state,'paid',json(CASE WHEN NEW.paid_at IS NULL THEN 'false' ELSE 'true' END)),NEW.version,NEW.updated_at)
 ON CONFLICT(app,collection,id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at;
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'booking:' || NEW.id || ':' || NEW.version,'booking.' || CASE WHEN OLD.slot!=NEW.slot THEN 'moved' ELSE NEW.state END,
 json_object('booking',NEW.id,'app',NEW.app,'collection',NEW.collection,'slot',NEW.slot,'state',NEW.state,'quantity',NEW.quantity,'order',NEW.order_id,'version',NEW.version),NEW.updated_at
 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE type='booking.' || CASE WHEN OLD.slot!=NEW.slot THEN 'moved' ELSE NEW.state END);
END;
UPDATE shop_bookings SET paid_at=(SELECT paid_at FROM shop_orders WHERE id=order_id),version=version+1 WHERE EXISTS(SELECT 1 FROM shop_orders WHERE id=order_id AND paid_at IS NOT NULL);
