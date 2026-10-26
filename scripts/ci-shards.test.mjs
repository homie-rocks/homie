import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, compatible, inventory, node24Regressions, shardCounts, checkShardBudget, selected, affectedPackages, nightlyFiles } from './ci-shards.mjs';
test('actual shard time catches drift even when committed estimates fit', () => {
  const files = ['old.test.mjs', 'new.test.mjs'];
  assert.equal(balance(files, { 'old.test.mjs': 100 }, 1)[0].seconds, 115);
  assert.doesNotThrow(() => checkShardBudget(480));
  assert.throws(() => checkShardBudget(480.1), /eight-minute budget.*--rebalance/);
  for (const invalid of [NaN, Infinity, -1]) assert.throws(() => checkShardBudget(invalid), /Invalid/);
});
test('shards include every discovered file exactly once, including new unmeasured files', () => {
  const files = [...inventory(), 'packages/new/test/new.test.mjs'];
  const bins = balance(files, {}, 12);
  assert.deepEqual(bins.flatMap(b => b.files).sort(), files.sort());
  assert.equal(new Set(bins.flatMap(b => b.files)).size, files.length);
  for (const f of [...node24Regressions]) assert.ok(compatible(f));
});
test('package selection follows transitive consumers and fails open for shared changes', () => {
  const manifests = { a: { name: 'a' }, b: { name: 'b', dependencies: { a: '1' } }, c: { name: 'c', devDependencies: { b: '1' } }, d: { name: 'd' } };
  assert.deepEqual([...affectedPackages(['packages/a/src/a.ts'], manifests)].sort(), ['a', 'b', 'c']);
  assert.equal(affectedPackages(['package-lock.json'], manifests), null);
  const files = inventory();
  assert.deepEqual(selected(files, { full: true }), files);
  assert.ok([...nightlyFiles].every(f => !selected(files).includes(f)));
  assert.ok(selected(files).includes('packages/studio/test/shop.test.mjs'));
  assert.ok(selected(files, { compat: true }).length <= 5);
});
