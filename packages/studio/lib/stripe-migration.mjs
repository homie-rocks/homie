import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
/** One-time cutover. The old deployment fulfils its signed events before replacement. */
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
export function needsStripeMigration(root, receipt = null, selectedMode = null) {
  if (receipt?.keyless === true || existsSync(join(root, '.studio', 'stripe-mcp.json'))) return true;
  const id = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0,24);
  for (const mode of selectedMode ? [selectedMode] : ['test','live']) {
    const file = join(homedir(), '.config', 'homie', 'stripe', id, mode + '.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).keyless === true) return true;
  }
  return false;
}
/** Read only: Stripe completion alone is insufficient; the old signed webhook must have committed. */
export async function stripeSessionsDrained(w, database, sessions) {
  if (!Array.isArray(sessions) || sessions.some(id => !/^cs_[A-Za-z0-9_]+$/.test(id))) throw new Error('Invalid drain evidence');
  if (!sessions.length) return true;
  const query = async sql => {
    const result = await w(['d1', 'execute', database, '--remote', '--json', '--command', sql]);
    if (result.code !== 0) throw new Error('Cannot read studio payment receipts');
    const body = JSON.parse(result.stdout ?? result.out);
    if (!Array.isArray(body) || body.some(r => r.success === false)) throw new Error('Cannot read studio payment receipts');
    return body.flatMap(r => r.results ?? []);
  };
  const tables = (await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('shop_orders','purchase_orders')")).map(r => r.name).filter(name => ['shop_orders','purchase_orders'].includes(name));
  if (!tables.length) throw new Error('Studio payment tables unavailable');
  for (let at = 0; at < sessions.length; at += 50) {
    const batch = [...new Set(sessions.slice(at, at + 50))];
    const list = batch.map(id => `'${id}'`).join(',');
    const found = await query(tables.map(table => `SELECT session FROM ${table} WHERE session IN (${list}) AND paid_at IS NOT NULL`).join(' UNION '));
    if (new Set(found.map(r => r.session)).size !== batch.length) return false;
  }
  return true;
}
export function finishStripeMigration(root) {
  for (const file of ['.studio/stripe-mcp.json', '.studio/booking-slots.json', 'site/dist/_site/stripe-shop-links.json']) rmSync(join(root, file), { force: true });
}

/** Link retirement uses the owner's existing local CLI authorization, never the
 * narrowly scoped Worker key. Refuse if that CLI belongs to a different account.
 * The RAK intentionally has no payment_link_write permission. */
export async function drainStripeLinks({ root, origin, account, mode, w, database, keepHook, process: run, wait, profile }) {
  const call = async (method, path, params = {}) => {
    const args = [...(profile ? ['--project-name', profile] : []), method.toLowerCase(), path];
    if (mode === 'live') args.push('--live');
    for (const [key, value] of Object.entries(params)) args.push('-d', key + '=' + value);
    const result = await run(args);
    let body; try { body = JSON.parse(result.stdout); } catch {}
    if (result.code !== 0 || !body || body.error) throw new Error('Owner CLI authorization required for link retirement');
    return body;
  };
  if ((await call('GET', '/v1/account')).id !== account) throw new Error('Migration account mismatch');
  const list = async (path, params = {}) => {
    let cursor; const all = [];
    do {
      const page = await call('GET', path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(page.data)) throw new Error('Invalid page');
      all.push(...page.data);
      const next = page.has_more ? page.data.at(-1)?.id : null;
      if (page.has_more && (!next || cursor === next)) throw new Error('Invalid cursor');
      cursor = next;
    } while (cursor);
    return all;
  };
  const links = (await list('/v1/payment_links')).filter(link => link.metadata?.origin === origin && ['shop-links-v1','purchase-links-v1'].includes(link.metadata?.homie));
  if (!links.length) throw new Error('No matching legacy links; keep legacy configuration for inspection');
  const hooks = (await list('/v1/webhook_endpoints')).filter(hook => hook.id !== keepHook && hook.url === origin + '/api/shop/hook' && hook.status === 'enabled');
  for (const link of links) if (link.active) await call('POST', '/v1/payment_links/' + link.id, { active: false });
  // Read all pages, including sessions opened before cutover. Re-read after expiry
  // to catch a session that completed in the race with the expire request.
  for (let pass = 0; pass < 2; pass++) {
    for (const link of links) {
      for (const session of await list('/v1/checkout/sessions', { payment_link: link.id, status: 'open' })) {
        try { await call('POST', '/v1/checkout/sessions/' + session.id + '/expire'); }
        catch { if ((await call('GET', '/v1/checkout/sessions/' + session.id)).status === 'open') throw new Error('Session remains open'); }
      }
      const complete = (await list('/v1/checkout/sessions', { payment_link: link.id, status: 'complete' }))
        .filter(s => ['paid','no_payment_required'].includes(s.payment_status)).map(s => s.id);
      if (!await stripeSessionsDrained(w, database, complete)) throw new Error('Signed fulfilment is still draining; retry finish');
    }
    if (pass === 0) await wait(30_000);
  }
  // A pending asynchronous payment can settle later. Retain old signing support
  // until it settles; retries are idempotent and keep the original receipts.
  for (const link of links) {
    const sessions = await list('/v1/checkout/sessions', { payment_link: link.id, status: 'complete' });
    if (sessions.some(s => s.payment_status === 'unpaid')) throw new Error('Asynchronous payment remains pending');
  }
  for (const hook of hooks) await call('POST', '/v1/webhook_endpoints/' + hook.id, { disabled: true });
}
