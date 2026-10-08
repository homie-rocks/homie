-- Checkout expiry in milliseconds; only sessionless rows age out after a one-minute margin.
ALTER TABLE shop_orders ADD COLUMN expires_at INTEGER;
-- Previously opened sessions used the same explicit 31-minute lifetime.
UPDATE shop_orders SET expires_at = (CAST(created_at / 1000 AS INTEGER) + 31 * 60) * 1000 WHERE status IN ('started', 'processing');
CREATE INDEX IF NOT EXISTS referral_lines_book ON referral_lines (via, currency, order_id);
