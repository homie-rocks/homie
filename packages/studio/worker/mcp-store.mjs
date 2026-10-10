/** OAuth's KV contract on the studio's existing D1. No new Cloudflare resource. */
export const MCP_MIGRATION_FILE = '0017_studio_mcp.sql';
export const MCP_MIGRATION = `CREATE TABLE IF NOT EXISTS mcp_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER);
CREATE TABLE IF NOT EXISTS mcp_connections (id TEXT PRIMARY KEY, person TEXT NOT NULL, client TEXT NOT NULL, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mcp_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT, client TEXT, tool TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_limits (caller TEXT NOT NULL, minute INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(caller, minute));
CREATE TABLE IF NOT EXISTS tool_data (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
`;
export function oauthStorage(DB) {
  return {
    async get(key, options) {
      const row = await DB.prepare('SELECT value FROM mcp_kv WHERE key = ?1 AND (expires IS NULL OR expires > ?2)').bind(key, Math.floor(Date.now()/1000)).first();
      return row ? (options === 'json' || options?.type === 'json' ? JSON.parse(row.value) : row.value) : null;
    },
    async put(key, value, options = {}) {
      const expires = options.expiration ?? (options.expirationTtl ? Math.floor(Date.now()/1000) + options.expirationTtl : null);
      await DB.prepare('INSERT INTO mcp_kv (key,value,expires) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires').bind(key, value, expires).run();
    },
    async delete(key) { await DB.prepare('DELETE FROM mcp_kv WHERE key=?1').bind(key).run(); },
    async list({prefix = '', cursor = '', limit = 1000} = {}) {
      const n = Math.max(1,Math.min(1000,limit));
      const rows = (await DB.prepare('SELECT key,expires FROM mcp_kv WHERE substr(key,1,?1)=?2 AND key>?3 AND (expires IS NULL OR expires>?4) ORDER BY key LIMIT ?5').bind(prefix.length,prefix,cursor,Math.floor(Date.now()/1000),n+1).all()).results;
      return { keys: rows.slice(0,n).map(r=>({name:r.key,...(r.expires ? {expiration:r.expires}: {})})), list_complete: rows.length<=n, cursor: rows.length>n ? rows[n-1].key : '' };
    },
  };
}
export async function rateLimit(env, caller, limit = 60) {
  const minute = Math.floor(Date.now()/60000);
  const row = await env.DB.prepare('INSERT INTO mcp_limits(caller,minute,n) VALUES(?1,?2,1) ON CONFLICT(caller,minute) DO UPDATE SET n=n+1 RETURNING n').bind(caller,minute).first();
  return row.n <= limit;
}
export async function audit(env, caller, tool, outcome) {
  await env.DB.prepare('INSERT INTO mcp_audit(person,client,tool,at,outcome) VALUES(?1,?2,?3,?4,?5)').bind(caller.id ?? null,caller.client ?? null,tool,Date.now(),outcome).run();
  // Bounded storage, and no cleanup timer or writes on ordinary page traffic.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mcp_audit WHERE id <= (SELECT MAX(id)-10000 FROM mcp_audit)'),
    env.DB.prepare('DELETE FROM mcp_limits WHERE minute < ?1').bind(Math.floor(Date.now()/60000)-2),
    env.DB.prepare('DELETE FROM mcp_kv WHERE expires IS NOT NULL AND expires < ?1').bind(Math.floor(Date.now()/1000)),
  ]);
}

export function callsPerMinute(cat) {
  const value=cat.studio?.mcp?.callsPerMinute;
  return Number.isSafeInteger(value)&&value>0?value:60;
}
