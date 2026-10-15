/**
 * @homie-rocks/studio 0.19.2: CHANGELOG.md, read by lib/changelog.mjs.
 *
 *   - the package carries the repository's CHANGELOG.md byte for byte, and lists it in `files` (npm ships it);
 *   - every version from 0.1.0 to this one has a section, newest first, each with a date, the plugin's version, a
 *     one-line summary and entries under Added, Changed, Fixed or Upgrade notes;
 *   - whatsNew is exactly the versions after the pin up to this one, and its terminal lines are short;
 *   - a GitHub release's notes are the section as written (each paragraph and entry on one line, since GitHub
 *     breaks release notes at every line end), with the Desktop extension's line under it;
 *   - the studio card says what's new when a studio pins an older toolkit (behindOf), and nothing otherwise.
 * Run: node --test packages/studio/test/changelog.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHANGELOG_FILE, compareVersions, parseChangelog, plain, readChangelog, releaseNotes, sectionOf, unwrap, whatsNew, whatsNewLines } from '../lib/changelog.mjs';
import { behindOf } from '../lib/mcp-tools.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-changelog-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('the parser: headings, the Plugin line, bullets over several lines, link definitions, and what it refuses', () => {
  const text = [
    '# Changelog', '', 'Intro.', '',
    '## [1.2.0] - 2026-10-03', '', '**Plugin 2.0.0, then 2.0.1** · [#9](https://x/pull/9)', '', 'A **bold** `new` [thing](https://x).', '', 'A note.', '',
    '### Added', '', '- One', '  over two lines.', '- Two', '', '### Upgrade notes', '', '- Run `npm install`.', '',
    '## [Unreleased]', '', 'Ignored.', '',
    '## [1.1.0]', '', '**Plugin 1.9.0**', '', 'Older.', '', '### Wrong', '',
    '[1.2.0]: https://x/releases/tag/v1.2.0',
  ].join('\n');
  const log = parseChangelog(text);
  assert.deepEqual(log.versions.map((s) => s.version), ['1.2.0', '1.1.0']);
  const s = log.versions[0];
  assert.deepEqual(s.plugins, ['2.0.0', '2.0.1']);
  assert.equal(s.plugin, '2.0.1');
  assert.equal(plain(s.summary), 'A bold new thing.');
  assert.deepEqual(s.notes, ['A note.']);
  assert.deepEqual(s.groups.Added, ['One over two lines.', 'Two']);
  assert.deepEqual(s.groups['Upgrade notes'], ['Run `npm install`.']);
  assert.ok(!s.body.includes('Unreleased') && !s.body.includes('[1.2.0]:'), 'a section ends at the next heading or the link definitions');
  assert.equal(log.versions[1].date, null);
  const problems = log.problems.join('\n');
  assert.match(problems, /1\.1\.0.*no date/);
  assert.match(problems, /"### Wrong" is not one of/);
  assert.match(problems, /1\.1\.0.*no "- " entries/);
  assert.match(parseChangelog('## [1.0.0] - 2026-01-01\n\n**Plugin 1.0.0**\n\nX.\n\n### Added\n\n- a\n\n## [1.0.1] - 2026-01-02\n\n**Plugin 1.0.1**\n\nY.\n\n### Fixed\n\n- b\n').problems.join(), /1\.0\.1 comes after 1\.0\.0; newest first/);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.19.2', '0.19.2'), 0);
});

test('what\'s new: the versions after the pin up to this one, and a few short lines of them', () => {
  const log = readChangelog();
  assert.equal(whatsNew(STUDIO_VERSION, STUDIO_VERSION, { changelog: log }), null, 'nothing new on the same version');
  assert.equal(whatsNew('99.0.0', STUDIO_VERSION, { changelog: log }), null, 'nothing new from a newer one');
  assert.equal(whatsNew(null, STUDIO_VERSION, { changelog: log }), null, 'no pin, nothing to say');
  assert.equal(whatsNew('0.18.0', STUDIO_VERSION, { changelog: null }), null, 'no changelog (an older package), nothing to say');
  const news = whatsNew('0.18.0', '0.19.1', { changelog: log });
  assert.deepEqual(news.versions.map((v) => v.version), ['0.19.1', '0.19.0', '0.18.2', '0.18.1']);
  assert.equal(news.versions[0].plugin, '0.20.1');
  const lines = whatsNewLines(whatsNew('0.1.0', STUDIO_VERSION, { changelog: log }), { width: 100, maxVersions: 5, maxNotes: 4, source: 'here' });
  assert.equal(lines[0], 'What\'s new since 0.1.0 (here):');
  assert.ok(lines.every((l) => l.length <= 100), 'every line fits');
  assert.equal(lines.filter((l) => /^ {2}\d/.test(l)).length, 5 + 4, 'five versions and four upgrade notes');
  assert.match(lines.join('\n'), /… and \d+ earlier versions \(CHANGELOG\.md has every one\)/);
  assert.match(lines.join('\n'), /… and \d+ more \(--json has every one\)/);
  assert.deepEqual(whatsNewLines(null), []);
});

test('a GitHub release\'s notes: the section as written, then the Desktop extension\'s line', () => {
  const log = readChangelog();
  const notes = releaseNotes(log, '0.19.1', { tag: 'release-2026-10-02-studio-0.19.1' });
  assert.ok(notes.startsWith('**Plugin 0.20.1**'), 'no heading: the release names the tag');
  // The section's words, each paragraph and entry on one line: GitHub renders every line end in release notes.
  assert.equal(notes.slice(0, notes.indexOf('\n---\n')).trim(), unwrap(sectionOf(log, '0.19.1').body).trim());
  assert.doesNotMatch(notes, /\n {2}\S/, 'no wrapped continuation lines');
  for (const entry of sectionOf(log, '0.19.1').groups.Fixed) assert.ok(notes.includes(`- ${entry}\n`), 'each entry is one line');
  assert.equal(unwrap('Para one\nstill one.\n\n- A\n  b.\n- C\n\n### Fixed\n\n---\n'), 'Para one still one.\n\n- A b.\n- C\n\n### Fixed\n\n---\n');
  assert.match(notes, /Homie for Claude Desktop 0\.19\.1: \[desktop\/README\.md\]\(https:\/\/github\.com\/homie-rocks\/homie\/blob\/release-2026-10-02-studio-0\.19\.1\/desktop\/README\.md\) says how to install it/);
  assert.match(notes, /\[CHANGELOG\.md\]\(https:\/\/github\.com\/homie-rocks\/homie\/blob\/main\/CHANGELOG\.md\)/);
  assert.equal(releaseNotes(log, '9.9.9'), null);
});

test('the studio card\'s "behind": an older pin gets what\'s new; this version, a newer one or a checkout link does not', () => {
  const studio = (name, spec) => {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, devDependencies: { '@homie-rocks/studio': spec } }));
    return dir;
  };
  const b = behindOf(studio('old', '0.16.1'));
  assert.equal(b.pinned, '0.16.1');
  assert.equal(b.here, STUDIO_VERSION);
  assert.equal(b.whatsNew.versions[0].version, STUDIO_VERSION);
  assert.ok(b.whatsNew.versions.every((v) => compareVersions(v.version, '0.16.1') > 0));
  assert.equal(behindOf(studio('old-address', 'https://homie.rocks/npm/homie-studio-0.9.0.tgz')).pinned, '0.9.0', 'a studio from before 0.10.0 is behind too: its upgrade moves it to the registry');
  assert.equal(behindOf(studio('same', STUDIO_VERSION)), null);
  assert.equal(behindOf(studio('newer', '99.0.0')), null);
  assert.equal(behindOf(studio('linked', 'file:../homie/packages/studio')), null);
  assert.equal(behindOf(join(scratch, 'nothing-here')), null);
});
