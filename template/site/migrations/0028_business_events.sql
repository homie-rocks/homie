
ALTER TABLE studio_events ADD COLUMN scope TEXT;
CREATE TABLE event_publications(id TEXT PRIMARY KEY,digest TEXT NOT NULL);

DROP TRIGGER IF EXISTS app_records_function_insert;
CREATE TRIGGER app_records_function_insert AFTER INSERT ON app_records
WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',
 json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','insert',
 'data',json(NEW.value),'previous',NULL),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS app_records_function_update;
CREATE TRIGGER app_records_function_update AFTER UPDATE ON app_records
WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',
 json_object('app',NEW.app,'collection',NEW.collection,'record',NEW.id,'version',NEW.version,'operation','update',
 'data',json(NEW.value),'previous',json(OLD.value)),NEW.updated_at);
END;

DROP TRIGGER IF EXISTS app_records_function_delete;
CREATE TRIGGER app_records_function_delete AFTER DELETE ON app_records
WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',
 json_object('app',OLD.app,'collection',OLD.collection,'record',OLD.id,'version',OLD.version,'operation','delete',
 'data',json(OLD.value),'previous',json(OLD.value)),OLD.updated_at);
END;
