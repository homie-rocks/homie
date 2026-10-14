-- The shop (@homie-rocks/studio 0.24.0): what players bought here with the studio's own Stripe (shop/SHOP.md).
-- No card, no address, no email: Stripe keeps the buyer's details and sends the receipt. An age is kept only as a
-- band (adult, teen, child). An order outlives a deleted account without the player (the law keeps sales records).
CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  player TEXT,
  item TEXT NOT NULL,
  game TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  tax INTEGER,
  total INTEGER,
  till TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  session TEXT UNIQUE,
  payment TEXT,
  refund TEXT,
  dispute TEXT,
  parent INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shop_orders_player ON shop_orders (player, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_status ON shop_orders (status, created_at);
CREATE INDEX IF NOT EXISTS shop_orders_payment ON shop_orders (payment);
CREATE TABLE IF NOT EXISTS entitlements (
  player TEXT NOT NULL,
  key TEXT NOT NULL,
  item TEXT NOT NULL,
  order_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  state TEXT NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (player, key, order_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entitlements_order ON entitlements (order_id);
CREATE TABLE IF NOT EXISTS shop_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_age (
  player TEXT PRIMARY KEY,
  band TEXT NOT NULL,
  asked_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS shop_parent_links (
  hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  item TEXT NOT NULL,
  game TEXT,
  order_id TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
