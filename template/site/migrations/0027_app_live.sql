
CREATE TABLE app_record_revisions(app TEXT NOT NULL,collection TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(app,collection));
CREATE TRIGGER app_records_live_insert AFTER INSERT ON app_records BEGIN
 INSERT INTO app_record_revisions VALUES(NEW.app,NEW.collection,1) ON CONFLICT(app,collection) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER app_records_live_update AFTER UPDATE ON app_records BEGIN
 INSERT INTO app_record_revisions VALUES(NEW.app,NEW.collection,1) ON CONFLICT(app,collection) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER app_records_live_delete AFTER DELETE ON app_records BEGIN
 INSERT INTO app_record_revisions VALUES(OLD.app,OLD.collection,1) ON CONFLICT(app,collection) DO UPDATE SET revision=revision+1;
END;
