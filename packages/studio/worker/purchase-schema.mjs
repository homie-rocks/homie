export const SETTLEMENT_SCHEMA = `CREATE TABLE IF NOT EXISTS purchase_settlements (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchase_orders(id), mode TEXT NOT NULL,
 network TEXT NOT NULL, payload TEXT NOT NULL, reference TEXT, state TEXT NOT NULL,
 error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS purchase_settlements_pending ON purchase_settlements(mode,state,updated_at);`;
export const PURCHASE_MIGRATION_FILE = "0013_purchases.sql";
export const PURCHASE_MIGRATION = `-- One immutable quote and one lifecycle record per purchase, separate from player orders.
CREATE TABLE IF NOT EXISTS purchase_orders (
 id TEXT PRIMARY KEY, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
 item TEXT NOT NULL, game TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL,
 tax INTEGER, total INTEGER, till TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
 session TEXT UNIQUE, payment TEXT, refund TEXT, dispute TEXT, note TEXT,
 created_at INTEGER NOT NULL, paid_at INTEGER, refunded_at INTEGER, updated_at INTEGER NOT NULL,
 claim_hash TEXT NOT NULL UNIQUE, buyer TEXT NOT NULL, buyer_label TEXT NOT NULL,
 quantity INTEGER NOT NULL, manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL,
 customer TEXT, subscription TEXT UNIQUE, paid_until INTEGER, checkout_url TEXT,
 offer_version TEXT NOT NULL, transport TEXT NOT NULL, fulfilled_at INTEGER,
 accepted_at INTEGER NOT NULL, terms_hash TEXT NOT NULL, quote_hash TEXT NOT NULL,
 offer TEXT NOT NULL, checkout_buyer TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_orders_status ON purchase_orders (status,created_at);
CREATE INDEX IF NOT EXISTS purchase_orders_payment ON purchase_orders (payment);
CREATE TABLE IF NOT EXISTS purchase_payments (
 payment TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchase_orders(id), invoice TEXT
);
`;
export const PURCHASE_STATE_FILE = "0014_purchase_facts.sql";
export const PURCHASE_STATE = `-- Fail before making changes if the prerequisite migration is missing.
SELECT 1 FROM purchase_orders LIMIT 0;
${SETTLEMENT_SCHEMA}

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
`;
