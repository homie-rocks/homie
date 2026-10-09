/** A check of a rules game must repair its build before any browser is allowed to claim success. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { toolDefs } from '../lib/mcp-tools.mjs';
import { stopAllJobs } from '../lib/jobs.mjs';
import { PKG, REPO_NM, writeGame } from './rules-kit.mjs';

test('MCP check refuses a planted rules fault before opening either browser, even with a supplied URL', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-mcp-')));
  try {
    writeFileSync(join(root, 'studio.json'), JSON.stringify({ name: 'Check', id: 'check' }));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    mkdirSync(join(root, 'node_modules/@homie-rocks'), { recursive: true });
    symlinkSync(PKG, join(root, 'node_modules/@homie-rocks/studio'));
    symlinkSync(join(REPO_NM, 'esbuild'), join(root, 'node_modules/esbuild'));
    const dir = writeGame(join(root, 'games'), 'fault', { rules: "import { defineRules } from '@homie-rocks/studio/rules';\nexport default defineRules({ contract: 2, space: { dims: 2 }, entities: { dot: { tick() { Date.now(); } } } });" });
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: 'fault', name: 'Fault', entry: 'src/view.ts', room: { host: 'server' } }));
    writeFileSync(join(dir, 'src/view.ts'), 'export {};');
    const ctx = { root: () => root, install: false, runs: new Map(), note: () => ({}) };
    await toolDefs(ctx).find((t) => t.name === 'check').run({ game: 'fault', url: 'http://127.0.0.1:1' });
    const run = [...ctx.runs.values()][0];
    await run.jobs[0].done;
    assert.equal(run.state, 'failed');
    assert.equal(run.jobs.length, 1);
    assert.equal(run.jobs[0].label, 'rules build check');
    assert.match(run.why, /src\/rules.ts:2 Date is not available/);
  } finally { stopAllJobs(); rmSync(root, { recursive: true, force: true }); }
});
