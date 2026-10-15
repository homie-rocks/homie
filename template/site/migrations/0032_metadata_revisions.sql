
INSERT OR IGNORE INTO meta(key,value) VALUES('metadata-revision','0');
CREATE TRIGGER office_games_revision_insert AFTER INSERT ON office_games BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER office_games_revision_update AFTER UPDATE ON office_games BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER office_games_revision_delete AFTER DELETE ON office_games BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER servers_revision_insert AFTER INSERT ON servers BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER servers_revision_update AFTER UPDATE ON servers BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER servers_revision_delete AFTER DELETE ON servers BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER chat_rules_revision_insert AFTER INSERT ON chat_rules BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER chat_rules_revision_update AFTER UPDATE ON chat_rules BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
CREATE TRIGGER chat_rules_revision_delete AFTER DELETE ON chat_rules BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;
