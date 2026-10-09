-- One immutable quote and one lifecycle record per purchase, separate from player orders.
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
