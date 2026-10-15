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
