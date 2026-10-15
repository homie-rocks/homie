import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balance, compatible, inventory, node24Regressions, shardCounts, checkShardBudget, selected, affectedPackages, nightlyFiles } from './ci-shards.mjs';
import { verified, gates } from './ci-verified.mjs';
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
test('workflow runs every balanced bin with measured headroom below eight minutes', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const timings = JSON.parse(readFileSync('scripts/ci-timings.json', 'utf8'));
  for (const [node, mode] of [[22, 'pr'], [24, 'compat']]) {
    const files = selected(inventory(), { compat: mode === 'compat' });
    const weights = mode === 'pr' ? timings.seconds : Object.fromEntries(files.map(f => [f, Math.max(timings.seconds[f] ?? 15, timings.compatSeconds?.[f] ?? 0)]));
    const bins = balance(files, weights, shardCounts[mode]);
    const scheduled = [...workflow.matchAll(/\{ node: (\d+), shard: (\d+), mode: '([^']*)' \}/g)]
      .filter(m => Number(m[1]) === node);
    assert.deepEqual(scheduled.map(m => Number(m[2])), bins.map((_, i) => i));
    assert.ok(scheduled.every(m => m[3] === (mode === 'compat' ? '--compat' : '')));
    assert.deepEqual(bins.flatMap(b => b.files).sort(), files.sort());
    for (const [i, bin] of bins.entries()) assert.ok(bin.seconds < 480, `${mode} shard ${i}: ${bin.seconds}s; refresh timings and rebalance`);
  }
});
test('release verification rejects missing, skipped, forged, wrong-SHA and mixed-run checks', () => {
  const sha = 'a'.repeat(40);
  const run = { head_sha: sha, path: '.github/workflows/nightly.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', check_suite_id: 1 };
  const checks = gates.map(name => ({ name, head_sha: sha, app: { slug: 'github-actions' }, check_suite: { id: 1 }, status: 'completed', conclusion: 'success' }));
  assert.ok(verified(run, checks, sha));
  assert.equal(verified(run, checks.slice(1), sha), false);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { app: { slug: 'other' } }, { check_suite: { id: 2 } }, { conclusion: 'skipped' }, { conclusion: 'failure' }, { status: 'in_progress' }]) {
    assert.equal(verified(run, [{ ...checks[0], ...patch }, ...checks.slice(1)], sha), false);
  }
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { path: '.github/workflows/other.yml' }, { conclusion: 'failure' }, { event: 'pull_request' }]) assert.equal(verified({ ...run, ...patch }, checks, sha), false);
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
