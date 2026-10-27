/**
 * The template history (packages/studio/lib/template-history.json) is how `homie-studio upgrade` knows a studio's
 * untouched text from its own. A template edit committed without regenerating it (c2c0a85 changed five AGENTS.md
 * sections and left 0.58.20's entry behind) means a studio made from that template keeps its old text forever:
 * every later upgrade reads it as the studio's own. `--check` catches that before a pack, and writes nothing.
 * Run: node --test scripts/studio-template-history.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'studio-template-history.mjs');
const HISTORY = join(ROOT, 'packages', 'studio', 'lib', 'template-history.json');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'packages', 'studio', 'package.json'), 'utf8')).version;
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

test('the committed template history is exactly what a run writes for this checkout\'s template', () => {
  const r = run('--check');
  assert.equal(r.status, 0, r.stderr);
});

test('--check names the entries a template edit left behind, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homie-template-history-'));
  try {
    const file = join(dir, 'template-history.json');
    const history = JSON.parse(readFileSync(HISTORY, 'utf8'));
    const secs = history.versions[VERSION].sections['AGENTS.md'];
    const heading = Object.keys(secs).find((s) => s.startsWith('## Apps'));
    // This version's entry as it was before the template's Apps section changed: none of today's text in it.
    secs[heading] = '0000000000000000';
    const stale = `${JSON.stringify(history, null, 1)}\n`;
    writeFileSync(file, stale);
    const r = run('--check', '--history', file);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${VERSION.replaceAll('.', '\\.')}: AGENTS\\.md "## Apps`));
    assert.match(r.stderr, /run node scripts\/studio-template-history\.mjs/);
    assert.equal(readFileSync(file, 'utf8'), stale, '--check writes nothing');
    // A run brings it level, and keeps the stale hash beside today's (a draft's text can only match that draft).
    assert.equal(run('--history', file).status, 0);
    assert.equal(run('--check', '--history', file).status, 0);
    assert.ok([JSON.parse(readFileSync(file, 'utf8')).versions[VERSION].sections['AGENTS.md'][heading]].flat().includes('0000000000000000'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
