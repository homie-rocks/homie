
DROP TRIGGER tool_data_live_insert;
DROP TRIGGER tool_data_live_update;
DROP TRIGGER tool_data_live_delete;
DELETE FROM meta WHERE key='tool-data-revision';
CREATE TABLE tool_data_revisions(namespace TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TABLE app_tool_namespaces(app TEXT NOT NULL,namespace TEXT NOT NULL,PRIMARY KEY(app,namespace));
CREATE TRIGGER tool_data_namespace_insert AFTER INSERT ON tool_data BEGIN
 INSERT INTO tool_data_revisions VALUES(NEW.namespace,1) ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;
 
END;
CREATE TRIGGER tool_data_namespace_update AFTER UPDATE ON tool_data BEGIN
 INSERT INTO tool_data_revisions VALUES(NEW.namespace,1) ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;
 INSERT INTO tool_data_revisions SELECT OLD.namespace,1 WHERE OLD.namespace!=NEW.namespace ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER tool_data_namespace_delete AFTER DELETE ON tool_data BEGIN
 INSERT INTO tool_data_revisions VALUES(OLD.namespace,1) ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;
 
END;
