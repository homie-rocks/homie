import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, compatible, inventory } from './ci-shards.mjs';
import { verified, gates } from './ci-verified.mjs';
test('shards include every discovered file exactly once, including new unmeasured files', () => {
  const files = [...inventory(), 'packages/new/test/new.test.mjs'];
  const bins = balance(files, {}, 12);
  assert.deepEqual(bins.flatMap(b => b.files).sort(), files.sort());
  assert.equal(new Set(bins.flatMap(b => b.files)).size, files.length);
  for (const f of ['scripts/mcp-stdio.test.mjs', 'packages/studio/test/studio-mcp-workerd.test.mjs', 'packages/studio/test/shop.test.mjs', 'packages/studio/test/paid-parts-review4-mcp.test.mjs']) assert.ok(compatible(f));
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
