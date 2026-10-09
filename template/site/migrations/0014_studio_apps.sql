CREATE TABLE IF NOT EXISTS app_records (
  app TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
  PRIMARY KEY (app, collection, id)
);
CREATE TABLE IF NOT EXISTS app_roles (
  app TEXT NOT NULL, role TEXT NOT NULL, player TEXT NOT NULL,
  PRIMARY KEY (app, role, player)
);
CREATE TABLE IF NOT EXISTS app_role_links (
  app TEXT NOT NULL, role TEXT NOT NULL, token TEXT NOT NULL,
  PRIMARY KEY (app, role)
);
