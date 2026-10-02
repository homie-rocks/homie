/**
 * scripts/changelog.mjs: CI's changelog check, the package's copy, and a release's notes.
 *
 *   - this repository passes the check;
 *   - a pull request that moves the studio's version without a section fails, and the message names both versions
 *     and gives the section to write, the plugin's version in it, and the --sync step;
 *   - a Plugin line that names another plugin version, a copy that differs, and a section ahead of the package's
 *     version each fail with the fix;
 *   - --sync makes the copy; --notes prints the section with the Desktop extension's line, and refuses a version
 *     with no section.
 * Run: node --test scripts/changelog.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'changelog.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-changelog-check-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const IDENT = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: '' };
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, ...IDENT } });
  assert.equal(r.status, 0, r.stderr);
};
const section = (v, plugin, date = '2026-10-02') => `## [${v}] - ${date}\n\n**Plugin ${plugin}** · [#1](https://github.com/homie-rocks/homie/pull/1)\n\nWhat ${v} is.\n\n### Added\n\n- A thing.\n`;

/** A checkout with the four files the check reads, its CHANGELOG.md made of these sections. */
function checkout(name, { studio, plugin, sections, copy = true }) {
  const root = join(scratch, name);
  mkdirSync(join(root, 'packages', 'studio'), { recursive: true });
  mkdirSync(join(root, 'plugins', 'homie', '.claude-plugin'), { recursive: true });
  const text = `# Changelog\n\n${sections.join('\n')}`;
  writeFileSync(join(root, 'CHANGELOG.md'), text);
  if (copy) writeFileSync(join(root, 'packages', 'studio', 'CHANGELOG.md'), text);
  writeFileSync(join(root, 'packages', 'studio', 'package.json'), JSON.stringify({ name: '@homie-rocks/studio', version: studio, files: ['bin/', 'CHANGELOG.md'] }));
  writeFileSync(join(root, 'plugins', 'homie', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'homie', version: plugin }));
  return root;
}

test('this repository passes the check', () => {
  const r = run(['--check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CHANGELOG\.md: \d+ versions, the newest \d+\.\d+\.\d+ \(plugin \d+\.\d+\.\d+\); the package's copy is the same file\./);
});

test('a version bump with no section fails, and says exactly what to write', () => {
  const root = checkout('bump', { studio: '0.19.2', plugin: '0.20.2', sections: [section('0.19.2', '0.20.2')] });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  // The pull request: the studio moves to 0.20.0, the plugin to 0.21.0, and nobody wrote a section.
  writeFileSync(join(root, 'packages', 'studio', 'package.json'), JSON.stringify({ name: '@homie-rocks/studio', version: '0.20.0', files: ['CHANGELOG.md'] }));
  writeFileSync(join(root, 'plugins', 'homie', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'homie', version: '0.21.0' }));
  const r = run(['--check', '--root', root, '--base', 'main']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CHANGELOG\.md has no section for @homie-rocks\/studio 0\.20\.0 \(packages\/studio\/package\.json\)\. This pull request moves @homie-rocks\/studio from 0\.19\.2 to 0\.20\.0\./);
  assert.match(r.stderr, /Add this at the top of CHANGELOG\.md, above "## \[0\.19\.2\]"/);
  assert.match(r.stderr, /## \[0\.20\.0\] - \d{4}-\d\d-\d\d/);
  assert.match(r.stderr, /\*\*Plugin 0\.21\.0\*\* · \[#<this pull request>\]/);
  assert.match(r.stderr, /### Added/);
  assert.match(r.stderr, /"### Upgrade notes"/);
  assert.match(r.stderr, /node scripts\/changelog\.mjs --sync/);
  assert.match(r.stderr, /If another pull request took this version first, rebase/);
  // Written as it says, and synced: it passes, and names the move.
  writeFileSync(join(root, 'CHANGELOG.md'), `# Changelog\n\n${section('0.20.0', '0.21.0')}\n${section('0.19.2', '0.20.2')}`);
  assert.equal(run(['--check', '--root', root]).status, 1, 'the package\'s copy still differs');
  assert.match(run(['--sync', '--root', root]).stdout, /now matches/);
  const ok = run(['--check', '--root', root, '--base', 'main']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /the newest 0\.20\.0 \(plugin 0\.21\.0\), which this pull request moves to from 0\.19\.2/);
});

test('a Plugin line for another plugin version, a different copy, and a section ahead of the package each fail with the fix', () => {
  const plugin = checkout('plugin', { studio: '0.19.2', plugin: '0.20.3', sections: [section('0.19.2', '0.20.2')] });
  const p = run(['--check', '--root', plugin]);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /the plugin is 0\.20\.3 \(plugins\/homie\/\.claude-plugin\/plugin\.json\), but the 0\.19\.2 section's Plugin line says 0\.20\.2/);
  assert.match(p.stderr, /"\*\*Plugin 0\.20\.2, then 0\.20\.3\*\*" when the plugin had a release of its own after 0\.19\.2/);

  const copy = checkout('copy', { studio: '0.19.2', plugin: '0.20.2', sections: [section('0.19.2', '0.20.2')] });
  writeFileSync(join(copy, 'packages', 'studio', 'CHANGELOG.md'), 'old');
  const c = run(['--check', '--root', copy]);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /packages\/studio\/CHANGELOG\.md is not the same as CHANGELOG\.md: run node scripts\/changelog\.mjs --sync and commit both/);

  const ahead = checkout('ahead', { studio: '0.19.2', plugin: '0.20.2', sections: [section('0.20.0', '0.21.0'), section('0.19.2', '0.20.2')] });
  const a = run(['--check', '--root', ahead]);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /the newest section is 0\.20\.0, but packages\/studio\/package\.json says 0\.19\.2/);

  const shape = checkout('shape', { studio: '0.19.2', plugin: '0.20.2', sections: ['## [0.19.2]\n\nNo plugin line.\n'] });
  const sh = run(['--check', '--root', shape]);
  assert.equal(sh.status, 1);
  assert.match(sh.stderr, /the heading has no date/);
  assert.match(sh.stderr, /no "\*\*Plugin x\.y\.z\*\* · …" line under the heading/);
});

test('--notes: a release\'s notes are the section with the Desktop extension\'s line; no section, no notes', () => {
  const root = checkout('notes', { studio: '0.19.2', plugin: '0.20.2', sections: [section('0.19.2', '0.20.2')] });
  const r = run(['--notes', '0.19.2', '--tag', 'release-2026-10-02-studio-0.19.2', '--root', root]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith('**Plugin 0.20.2**'));
  assert.match(r.stdout, /### Added\n\n- A thing\./);
  assert.match(r.stdout, /Homie for Claude Desktop 0\.19\.2: \[desktop\/README\.md\]\(https:\/\/github\.com\/homie-rocks\/homie\/blob\/release-2026-10-02-studio-0\.19\.2\/desktop\/README\.md\) says how to install it/);
  const none = run(['--notes', '0.18.0', '--root', root]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no section for 0\.18\.0/);
  // This repository's own: every studio version on npm has notes.
  const mine = run(['--notes', JSON.parse(readFileSync(join(dirname(SCRIPT), '..', 'packages', 'studio', 'package.json'), 'utf8')).version]);
  assert.equal(mine.status, 0, mine.stderr);
});
