CREATE INDEX IF NOT EXISTS mcp_kv_expires ON mcp_kv(expires) WHERE expires IS NOT NULL;
