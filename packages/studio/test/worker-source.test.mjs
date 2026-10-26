import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.mjs') ? [join(dir, entry.name)] : []);
}
test('Paid uploads follow successful deployment and use a private binding', () => {
  const deploy = readFileSync(new URL('../lib/cloudflare.mjs', import.meta.url), 'utf8');
  const call = deploy.indexOf('await uploadPaidParts(');
  assert.ok(call > deploy.indexOf("if (dep.code !== 0) return refuse"));
  assert.ok(call > deploy.indexOf("if (migrate.code !== 0) return refuse"));
  assert.match(deploy.slice(call, call + 100), /bucket: purchaseBucket/);
  const resource = readFileSync(new URL('../worker/parts-resource.mjs', import.meta.url), 'utf8');
  assert.match(resource, /env.PURCHASE_MEDIA/);
  assert.doesNotMatch(resource, /env\.MEDIA\b/);
});
