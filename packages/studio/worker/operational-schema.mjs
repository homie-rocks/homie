export const OPERATIONAL_MIGRATION_FILE='0031_request_and_tool_notifications.sql';
export const OPERATIONAL_MIGRATION=`
-- Removed features are cleaned once, never on the request path.
DELETE FROM meta WHERE key GLOB 'referral_*' OR key GLOB 'referral-*';
INSERT OR IGNORE INTO meta(key,value) VALUES('tool-data-revision','0');
${['INSERT','UPDATE','DELETE'].map(op=>`CREATE TRIGGER tool_data_live_${op.toLowerCase()} AFTER ${op} ON tool_data BEGIN
 UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='tool-data-revision';
END;`).join('\n')}
`;
