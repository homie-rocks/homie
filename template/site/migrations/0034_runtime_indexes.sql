-- Older stream registrations used milliseconds; OAuth and dedupe already use seconds.
UPDATE mcp_kv SET expires=CAST(expires / 1000 AS INTEGER) WHERE expires>100000000000 AND ((key >= 'tools-stream:' AND key < 'tools-stream;') OR (key >= 'mcp-event-stream:' AND key < 'mcp-event-stream;'));
CREATE INDEX IF NOT EXISTS mcp_kv_expires ON mcp_kv(expires) WHERE expires IS NOT NULL;
