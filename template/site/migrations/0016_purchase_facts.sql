-- Fail before making changes if the prerequisite migration is missing.
SELECT 1 FROM purchase_orders LIMIT 0;
CREATE TABLE IF NOT EXISTS purchase_settlements (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchase_orders(id), mode TEXT NOT NULL,
 network TEXT NOT NULL, payload TEXT NOT NULL, reference TEXT, state TEXT NOT NULL,
 error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS purchase_settlements_pending ON purchase_settlements(mode,state,updated_at);

CREATE TABLE IF NOT EXISTS purchase_manual_refunds (transaction_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES purchase_orders(id));
CREATE TABLE IF NOT EXISTS purchase_offers (version TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_receipts (order_id TEXT PRIMARY KEY REFERENCES purchase_orders(id) ON DELETE CASCADE, value TEXT, headers TEXT);
CREATE TABLE IF NOT EXISTS purchase_test_approvals (order_id TEXT PRIMARY KEY REFERENCES purchase_orders(id) ON DELETE CASCADE, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_grants (order_id TEXT NOT NULL, version TEXT NOT NULL, manifest_hash TEXT NOT NULL, PRIMARY KEY(order_id,version));
CREATE TABLE IF NOT EXISTS resource_retirements (resource TEXT PRIMARY KEY, retired_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resource_snapshots (hash TEXT PRIMARY KEY, manifest TEXT NOT NULL);
INSERT OR IGNORE INTO resource_snapshots (hash,manifest) SELECT manifest_hash,manifest FROM purchase_orders;
CREATE TABLE IF NOT EXISTS purchase_payment_facts (
 payment TEXT NOT NULL, invoice TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'paid', period_end INTEGER, dispute TEXT,
 PRIMARY KEY(payment, invoice)
);
CREATE TABLE IF NOT EXISTS purchase_jobs (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchase_orders(id), mode TEXT NOT NULL,
 state TEXT NOT NULL, payload TEXT NOT NULL, payment TEXT, error TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS purchase_jobs_pending ON purchase_jobs(mode,state,updated_at);
