export const OPERATIONAL_MIGRATION_FILE='0031_request_and_tool_notifications.sql';
export const OPERATIONAL_MIGRATION=`
-- Removed features are cleaned once, never on the request path.
DELETE FROM meta WHERE key GLOB 'referral_*' OR key GLOB 'referral-*';
INSERT OR IGNORE INTO meta(key,value) VALUES('tool-data-revision','0');
${['INSERT','UPDATE','DELETE'].map(op=>`CREATE TRIGGER tool_data_live_${op.toLowerCase()} AFTER ${op} ON tool_data BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='tool-data-revision';
END;`).join('\n')}
`;

export const CACHE_MIGRATION_FILE='0032_metadata_revisions.sql';
export const CACHE_MIGRATION=`
INSERT OR IGNORE INTO meta(key,value) VALUES('metadata-revision','0');
${['office_games','servers','chat_rules'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(op=>`CREATE TRIGGER ${table}_revision_${op.toLowerCase()} AFTER ${op} ON ${table} BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='metadata-revision';
END;`)).join('\n')}
`;
export const TOOL_NAMESPACE_MIGRATION_FILE='0033_tool_namespace_revisions.sql';
export const TOOL_NAMESPACE_MIGRATION=`
DROP TRIGGER tool_data_live_insert;
DROP TRIGGER tool_data_live_update;
DROP TRIGGER tool_data_live_delete;
DELETE FROM meta WHERE key='tool-data-revision';
CREATE TABLE tool_data_revisions(namespace TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TABLE app_tool_namespaces(app TEXT NOT NULL,namespace TEXT NOT NULL,PRIMARY KEY(app,namespace));
${['INSERT','UPDATE','DELETE'].map(op=>{const row=op==='DELETE'?'OLD':'NEW';return `CREATE TRIGGER tool_data_namespace_${op.toLowerCase()} AFTER ${op} ON tool_data BEGIN
 INSERT INTO tool_data_revisions VALUES(${row}.namespace,1) ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;
 ${op==='UPDATE'?`INSERT INTO tool_data_revisions SELECT OLD.namespace,1 WHERE OLD.namespace!=NEW.namespace ON CONFLICT(namespace) DO UPDATE SET revision=revision+1;`:''}
END;`;}).join('\n')}
`;

export const RUNTIME_INDEX_MIGRATION_FILE='0034_runtime_indexes.sql';
export const RUNTIME_INDEX_MIGRATION=`-- Older stream registrations used milliseconds; OAuth and dedupe already use seconds.
UPDATE mcp_kv SET expires=CAST(expires / 1000 AS INTEGER) WHERE expires>100000000000 AND (key GLOB 'tools-stream:*' OR key GLOB 'mcp-event-stream:*');
CREATE INDEX IF NOT EXISTS mcp_kv_expires ON mcp_kv(expires) WHERE expires IS NOT NULL;
`;
