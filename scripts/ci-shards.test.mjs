import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balance, compatible, inventory, node24Regressions, shardCounts } from './ci-shards.mjs';
import { verified, gates } from './ci-verified.mjs';
test('shards include every discovered file exactly once, including new unmeasured files', () => {
  const files = [...inventory(), 'packages/new/test/new.test.mjs'];
  const bins = balance(files, {}, 12);
  assert.deepEqual(bins.flatMap(b => b.files).sort(), files.sort());
  assert.equal(new Set(bins.flatMap(b => b.files)).size, files.length);
  for (const f of [...node24Regressions, 'scripts/mcp-stdio.test.mjs', 'packages/studio/test/studio-mcp-workerd.test.mjs', 'packages/studio/test/shop.test.mjs', 'packages/studio/test/paid-parts-review4-mcp.test.mjs']) assert.ok(compatible(f));
});
test('workflow runs every balanced bin with measured headroom below eight minutes', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const timings = JSON.parse(readFileSync('scripts/ci-timings.json', 'utf8'));
  for (const [node, mode] of [[22, 'full'], [24, 'compat']]) {
    const files = inventory().filter(f => mode === 'full' || compatible(f));
    const weights = mode === 'full' ? timings.seconds : Object.fromEntries(files.map(f => [f, Math.max(timings.seconds[f] ?? 15, timings.compatSeconds?.[f] ?? 0)]));
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
  const run = { head_sha: sha, path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success', check_suite_id: 1 };
  const checks = gates.map(name => ({ name, head_sha: sha, app: { slug: 'github-actions' }, check_suite: { id: 1 }, status: 'completed', conclusion: 'success' }));
  assert.ok(verified(run, checks, sha));
  assert.equal(verified(run, checks.slice(1), sha), false);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { app: { slug: 'other' } }, { check_suite: { id: 2 } }, { conclusion: 'skipped' }, { conclusion: 'failure' }, { status: 'in_progress' }]) {
    assert.equal(verified(run, [{ ...checks[0], ...patch }, ...checks.slice(1)], sha), false);
  }
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { path: '.github/workflows/other.yml' }, { conclusion: 'failure' }, { event: 'workflow_dispatch' }]) assert.equal(verified({ ...run, ...patch }, checks, sha), false);
});
