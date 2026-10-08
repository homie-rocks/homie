-- Statements retain independent currencies and an immutable edition while sending.
ALTER TABLE referral_statements RENAME TO referral_statements_old;
CREATE TABLE referral_statements (
  seller TEXT NOT NULL, period TEXT NOT NULL, owed INTEGER NOT NULL, pending INTEGER NOT NULL,
  currency TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL,
  PRIMARY KEY (seller, period, currency)
) WITHOUT ROWID;
INSERT INTO referral_statements SELECT * FROM referral_statements_old;
DROP TABLE referral_statements_old;
CREATE TABLE referral_editions (id TEXT PRIMARY KEY, period TEXT NOT NULL, issued INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE referral_edition_lines (
  edition TEXT NOT NULL, order_id TEXT NOT NULL, via TEXT NOT NULL, currency TEXT NOT NULL,
  net INTEGER NOT NULL, rate REAL NOT NULL, share INTEGER NOT NULL, state TEXT NOT NULL,
  period TEXT NOT NULL, hold_until INTEGER NOT NULL, created_at INTEGER NOT NULL, item TEXT, paid_at INTEGER,
  PRIMARY KEY (edition, via, currency, order_id)
) WITHOUT ROWID;
