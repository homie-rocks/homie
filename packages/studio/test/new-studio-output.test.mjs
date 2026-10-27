import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { studioFiles, newStudio } from '../lib/scaffold.mjs';

const pkgName = (name, slug) => JSON.parse(studioFiles({ name, slug, homie: null })['package.json']).name;

test('the package name does not repeat "studio"', () => {
  assert.equal(pkgName('Night Owls', 'night-owls'), 'night-owls-studio');
  assert.equal(pkgName('Playtest Studio', 'playtest-studio'), 'playtest-studio');
  assert.equal(pkgName('Studio', 'studio'), 'studio');
  assert.equal(pkgName('Studious', 'studious'), 'studious-studio');
});

test('new lists what it wrote in name order, so migrations read 0001, 0002, ...', () => {
  const dir = mkdtempSync(join(tmpdir(), 'new-studio-'));
  try {
    const r = newStudio(join(dir, 's'), { name: 'Order Check', install: false });
    const files = r.wrote.filter((f) => f !== '.git/');
    assert.deepEqual(files, [...files].sort());
    const migrations = files.filter((f) => f.startsWith('site/migrations/'));
    assert.ok(migrations.length > 1);
    assert.deepEqual(migrations, [...migrations].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--help starts with the description, not the comment opener', () => {
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/homie-studio.mjs', import.meta.url)), '--help'], { encoding: 'utf8' }).stdout;
  const lines = out.split('\n');
  assert.match(lines[0], /^homie-studio \d/);
  assert.match(lines[1], /^homie-studio — /);
  assert.ok(!lines.some((l) => l.trim() === '/**'));
});
