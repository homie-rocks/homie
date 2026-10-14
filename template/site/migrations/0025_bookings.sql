
CREATE TABLE shop_bookings (
 id TEXT PRIMARY KEY, app TEXT NOT NULL, collection TEXT NOT NULL,
 slots TEXT NOT NULL, slot TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
 order_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'held'
 CHECK(state IN ('held','confirmed','released')),
 version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE INDEX shop_bookings_capacity ON shop_bookings(app, slots, slot, state);
CREATE TRIGGER booking_capacity_insert BEFORE INSERT ON shop_bookings BEGIN
 SELECT RAISE(ABORT,'booking capacity unavailable') WHERE NOT EXISTS (
  SELECT 1 FROM app_records s WHERE s.app=NEW.app AND s.collection=NEW.slots AND s.id=NEW.slot
  AND json_type(s.value,'$.capacity')='integer' AND json_extract(s.value,'$.capacity') >= NEW.quantity +
   (SELECT COALESCE(SUM(quantity),0) FROM shop_bookings WHERE app=NEW.app AND slots=NEW.slots AND slot=NEW.slot AND state IN ('held','confirmed'))
 );
END;
CREATE TRIGGER booking_capacity_move BEFORE UPDATE OF slot ON shop_bookings
WHEN NEW.state IN ('held','confirmed') BEGIN
 SELECT RAISE(ABORT,'booking capacity unavailable') WHERE NOT EXISTS (
  SELECT 1 FROM app_records s WHERE s.app=NEW.app AND s.collection=NEW.slots AND s.id=NEW.slot
  AND json_type(s.value,'$.capacity')='integer' AND json_extract(s.value,'$.capacity') >= NEW.quantity +
   (SELECT COALESCE(SUM(quantity),0) FROM shop_bookings WHERE app=NEW.app AND slots=NEW.slots AND slot=NEW.slot AND id!=NEW.id AND state IN ('held','confirmed'))
 );
END;
CREATE TRIGGER booking_slot_update BEFORE UPDATE OF value ON app_records
WHEN EXISTS (SELECT 1 FROM shop_bookings WHERE app=OLD.app AND slots=OLD.collection AND slot=OLD.id AND state IN ('held','confirmed')) BEGIN
 SELECT RAISE(ABORT,'capacity below existing bookings') WHERE json_type(NEW.value,'$.capacity') IS NOT 'integer' OR json_extract(NEW.value,'$.capacity') <
  (SELECT SUM(quantity) FROM shop_bookings WHERE app=OLD.app AND slots=OLD.collection AND slot=OLD.id AND state IN ('held','confirmed'))
;
END;
CREATE TRIGGER booking_slot_delete BEFORE DELETE ON app_records
WHEN EXISTS (SELECT 1 FROM shop_bookings WHERE app=OLD.app AND slots=OLD.collection AND slot=OLD.id AND state IN ('held','confirmed')) BEGIN
 SELECT RAISE(ABORT,'slot has active bookings');
END;
CREATE TRIGGER booking_order_state AFTER UPDATE OF status ON shop_orders BEGIN
 UPDATE shop_bookings SET state=CASE WHEN NEW.status='paid' THEN 'confirmed' ELSE 'released' END,
 version=version+1, updated_at=NEW.updated_at
 WHERE order_id=NEW.id AND ((state='held' AND NEW.status IN ('paid','expired','failed')) OR (state IN ('held','confirmed') AND NEW.status IN ('refunded','lost')));
END;
CREATE TRIGGER booking_record_insert AFTER INSERT ON shop_bookings BEGIN
 INSERT INTO app_records(app,collection,id,value,version,updated_at)
 VALUES(NEW.app,NEW.collection,NEW.id,json_object('slot',NEW.slot,'quantity',NEW.quantity,'state',NEW.state),NEW.version,NEW.updated_at)
 ON CONFLICT(app,collection,id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at;
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'booking:' || NEW.id || ':' || NEW.version,'booking.' || 'held',
 json_object('booking',NEW.id,'app',NEW.app,'collection',NEW.collection,'slot',NEW.slot,'state',NEW.state,'quantity',NEW.quantity,'order',NEW.order_id,'version',NEW.version),NEW.updated_at
 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE type='booking.' || 'held');
END;
CREATE TRIGGER booking_record_update AFTER UPDATE ON shop_bookings BEGIN
 INSERT INTO app_records(app,collection,id,value,version,updated_at)
 VALUES(NEW.app,NEW.collection,NEW.id,json_object('slot',NEW.slot,'quantity',NEW.quantity,'state',NEW.state),NEW.version,NEW.updated_at)
 ON CONFLICT(app,collection,id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at;
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'booking:' || NEW.id || ':' || NEW.version,'booking.' || CASE WHEN OLD.slot!=NEW.slot THEN 'moved' ELSE NEW.state END,
 json_object('booking',NEW.id,'app',NEW.app,'collection',NEW.collection,'slot',NEW.slot,'state',NEW.state,'quantity',NEW.quantity,'order',NEW.order_id,'version',NEW.version),NEW.updated_at
 WHERE EXISTS(SELECT 1 FROM function_subscriptions WHERE type='booking.' || CASE WHEN OLD.slot!=NEW.slot THEN 'moved' ELSE NEW.state END);
END;
