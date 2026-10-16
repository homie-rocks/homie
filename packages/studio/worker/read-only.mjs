/**
 * READ-ONLY: the owner freezes the studio for a few minutes (a move to another host, maintenance) and nothing is lost.
 * `homie-studio read-only on` sets the Worker secret STUDIO_READ_ONLY=1 (lib/read-only.mjs); `off` deletes it. A
 * secret, not a var in wrangler.jsonc, because Cloudflare applies it to the live Worker at once with no build or
 * deploy, and a deploy made while it is on keeps it on.
 *
 * While it is on:
 * - every request other than GET, HEAD and OPTIONS answers 503 with Retry-After, `x-studio-read-only: 1` and
 *   {ok:false,error:'read-only',message}; nothing it carried was applied, so the caller sends it again later;
 * - reads keep answering, and every answer carries `x-studio-read-only: 1`; an HTML page shows a short notice;
 *   `/api/games` says `readOnly: true`, so a tool checks the switch without sending a write;
 * - D1 refuses writes for every request and every room: a read that would also have written (a visit counted, a
 *   sign-in link redeemed) writes nothing, and a page that needed its write answers the same 503;
 * - Stripe's webhook (POST /api/shop/hook) and the queued reconciliation of its events keep the whole database, so
 *   a payment already made is still recorded and fulfilled;
 * - live rooms keep playing (their sockets and matchmaking are GETs, their state is the room's own storage); what a
 *   room would write to D1 waits: round records and function events stay in the room's outbox and are delivered once
 *   the studio is open again, counters are retried with the next report;
 * - scheduled maintenance is skipped for its tick, except the recovery of Stripe events; queued work other than
 *   Stripe events is retried after the read-only window.
 */
export const READ_ONLY_HEADER = 'x-studio-read-only';
export const READ_ONLY_RETRY_SECONDS = 120;
export const READ_ONLY_MESSAGE = 'This studio is read-only for a few minutes. Nothing was changed: try again shortly.';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Writes that must go on while the studio is read-only: a payment already made is fulfilled. */
const WRITES_KEPT = new Set(['POST /api/shop/hook']);

export const isReadOnly = (env) => /^(1|true|on)$/i.test(String(env?.STUDIO_READ_ONLY ?? '').trim());

export class ReadOnlyError extends Error {
  constructor() { super('read-only: this studio is not writing to its database for a few minutes'); this.name = 'ReadOnlyError'; }
}

export function readOnlyResponse(extra = {}) {
  return new Response(`${JSON.stringify({ ok: false, error: 'read-only', message: READ_ONLY_MESSAGE })}\n`, {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': String(READ_ONLY_RETRY_SECONDS), [READ_ONLY_HEADER]: '1', ...extra },
  });
}

/** What a request may do while the studio is read-only: 'refuse' it, 'read' (D1 refuses writes), or 'write'. */
export function readOnlyAccess(request, path) {
  if (WRITES_KEPT.has(`${request.method} ${path}`)) return 'write';
  return SAFE_METHODS.has(request.method) ? 'read' : 'refuse';
}

const WRITE_WORD = /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
/** A statement that cannot change the database: SELECT, VALUES, a WITH that only selects, EXPLAIN, or a PRAGMA read. */
export function readsOnly(sql) {
  const text = String(sql ?? '');
  if (/^\s*EXPLAIN\b/i.test(text)) return true;
  if (/^\s*PRAGMA\b/i.test(text)) return !text.includes('=');
  if (/^\s*(?:SELECT|VALUES)\b/i.test(text)) return true;
  return /^\s*WITH\b/i.test(text) && !WRITE_WORD.test(text);
}

/**
 * D1 that refuses writes: a write rejects with ReadOnlyError (a promise, as D1's own calls are) and never reaches the
 * database; reads and every other property are D1's own. `refused` is called with each refused statement.
 */
export function readOnlyDatabase(DB, refused = () => {}) {
  if (!DB) return DB;
  const refuse = (sql) => { refused(sql); return Promise.reject(new ReadOnlyError()); };
  const statement = (stmt, sql) => {
    const guarded = (method) => async (...args) => readsOnly(sql) ? stmt[method](...args) : refuse(sql);
    return { bind: (...args) => statement(stmt.bind(...args), sql), first: guarded('first'), all: guarded('all'), run: guarded('run'), raw: guarded('raw'), _sql: sql, _readOnly: stmt };
  };
  const own = {
    prepare: (sql) => statement(DB.prepare(sql), sql),
    batch: async (list) => {
      const bad = list.find((s) => !s?._readOnly || !readsOnly(s._sql));
      if (bad) return refuse(bad?._sql ?? 'UNKNOWN');
      return DB.batch(list.map((s) => s._readOnly));
    },
    exec: async (sql, ...args) => readsOnly(sql) ? DB.exec(sql, ...args) : refuse(sql),
    withSession: (...args) => readOnlyDatabase(DB.withSession(...args), refused),
  };
  return new Proxy(own, { get(target, key) {
    if (key in target) return target[key];
    const value = DB[key];
    return typeof value === 'function' ? value.bind(DB) : value;
  } });
}

/** A Durable Object's env: its D1 refuses writes while the studio is read-only. */
export const readOnlyEnv = (env) => isReadOnly(env) && env.DB ? { ...env, DB: readOnlyDatabase(env.DB) } : env;

/** Queued work while read-only: Stripe events are reconciled now; everything else comes back after the window. */
export function heldBatch(batch) {
  const now = [];
  for (const message of batch.messages) {
    if (message.body?.v === 1 && message.body.type === 'stripe.event') now.push(message);
    else message.retry({ delaySeconds: READ_ONLY_RETRY_SECONDS });
  }
  return { ...batch, messages: now };
}

const NOTICE = '<aside role="status" data-studio-read-only style="position:fixed;z-index:2147483647;bottom:0;left:0;right:0;text-align:center;background:#1f2937;color:#f9fafb;padding:8px 12px;font:600 14px system-ui,sans-serif;pointer-events:none">Read-only for a few minutes: everything can be seen and played, and changes can be made again shortly.</aside>';
/** Every answer says the studio is read-only; a page also shows it. */
export async function markReadOnly(res) {
  if (!res || res.status === 101 || res.webSocket) return res;
  const headers = new Headers(res.headers);
  headers.set(READ_ONLY_HEADER, '1');
  let body = res.body;
  if (/text\/html/i.test(headers.get('content-type') ?? '') && res.status < 300 && body) {
    const html = await res.text();
    body = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${NOTICE}</body>`) : html + NOTICE;
    headers.delete('content-length');
    headers.delete('etag');
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
