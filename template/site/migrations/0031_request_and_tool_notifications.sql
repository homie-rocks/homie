
-- Removed features are cleaned once, never on the request path.
DELETE FROM meta WHERE key GLOB 'referral_*' OR key GLOB 'referral-*';
INSERT OR IGNORE INTO meta(key,value) VALUES('tool-data-revision','0');
CREATE TRIGGER tool_data_live_insert AFTER INSERT ON tool_data BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='tool-data-revision';
END;
CREATE TRIGGER tool_data_live_update AFTER UPDATE ON tool_data BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='tool-data-revision';
END;
CREATE TRIGGER tool_data_live_delete AFTER DELETE ON tool_data BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='tool-data-revision';
END;
