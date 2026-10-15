CREATE INDEX IF NOT EXISTS mcp_kv_expires ON mcp_kv(expires) WHERE expires IS NOT NULL;
CREATE TABLE IF NOT EXISTS stripe_intake(id TEXT PRIMARY KEY,payload TEXT NOT NULL,origin TEXT NOT NULL,received INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0,done INTEGER);
CREATE INDEX IF NOT EXISTS stripe_intake_done ON stripe_intake(done) WHERE done IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_events_at ON shop_events(at);
