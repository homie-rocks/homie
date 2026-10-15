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
export const RUNTIME_INDEX_MIGRATION=`CREATE INDEX IF NOT EXISTS mcp_kv_expires ON mcp_kv(expires) WHERE expires IS NOT NULL;
CREATE TABLE IF NOT EXISTS stripe_intake(id TEXT PRIMARY KEY,payload TEXT NOT NULL,origin TEXT NOT NULL,received INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0,done INTEGER);
CREATE INDEX IF NOT EXISTS stripe_intake_done ON stripe_intake(done) WHERE done IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_events_at ON shop_events(at);
CREATE TABLE IF NOT EXISTS lobby_summaries(game TEXT PRIMARY KEY,rooms TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stats_analytics_daily(day TEXT NOT NULL,metric TEXT NOT NULL,subject TEXT NOT NULL,source TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,metric,subject,source)) WITHOUT ROWID;
`;
