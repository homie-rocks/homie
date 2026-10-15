import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsStripeMigration, stripeSessionsDrained, finishStripeMigration } from '../lib/stripe-migration.mjs';
test('existing studio requires one App approval and preserves its orders during cutover', async t => {
  const root = mkdtempSync(join(tmpdir(), 'homie-cutover-'));
  cpSync(new URL('./fixtures/studio-0.51.6-shop/', import.meta.url), root, { recursive: true });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  assert.equal(needsStripeMigration(root), true);
  let paid = false; const statements = [];
  const w = async args => {
    const sql = args.at(-1); statements.push(sql);
    return { code: 0, stdout: JSON.stringify([{ success: true, results: sql.includes('sqlite_master') ? [{ name: 'shop_orders' }] : paid ? [{ session: 'cs_existing' }] : [] }]) };
  };
  assert.equal(await stripeSessionsDrained(w, 'studio', ['cs_existing']), false, 'a provider-paid session is not a committed signed receipt');
  paid = true;
  assert.equal(await stripeSessionsDrained(w, 'studio', ['cs_existing']), true);
  assert.ok(statements.every(s => s.startsWith('SELECT ')), 'draining cannot create a payment or grant');
  await assert.rejects(stripeSessionsDrained(w, 'studio', ["cs_bad'; DROP TABLE shop_orders"]));
  finishStripeMigration(root);
  assert.equal(needsStripeMigration(root), false);
  assert.equal(existsSync(join(root, 'shop.json')), true);
});
