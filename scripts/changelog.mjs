#!/usr/bin/env node
/**
 * CHANGELOG.md: one section per @homie-rocks/studio version, newest first, with the plugin's version beside it
 * (packages/studio/lib/changelog.mjs reads it; the top of CHANGELOG.md says the shape).
 *
 *   node scripts/changelog.mjs --check [--base <ref>]    CI: the file's shape; a section for the version in
 *                                                        packages/studio/package.json, naming the plugin's version;
 *                                                        the package's copy is the same file. With --base (a pull
 *                                                        request's base branch), it also says when the change moves
 *                                                        the studio's version.
 *   node scripts/changelog.mjs --sync                    copy CHANGELOG.md to packages/studio/CHANGELOG.md, the copy
 *                                                        npm ships (and `homie-studio upgrade` reads)
 *   node scripts/changelog.mjs --notes <version> [--tag <tag>]
 *                                                        a GitHub release's notes for that version, on stdout (what
 *                                                        .github/workflows/publish.yml puts on the release)
 *   --root <dir>                                         another checkout (the tests use it)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog, releaseNotes, sectionOf } from '../packages/studio/lib/changelog.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'CHANGELOG.md');
const COPY = join(ROOT, 'packages', 'studio', 'CHANGELOG.md');
const STUDIO_PKG = join(ROOT, 'packages', 'studio', 'package.json');
const PLUGIN = join(ROOT, 'plugins', 'homie', '.claude-plugin', 'plugin.json');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const out = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => { process.stderr.write(`${s.replace(/\n*$/, '\n')}`); process.exit(1); };

if (args.includes('--sync')) {
  if (!existsSync(FILE)) fail('changelog: there is no CHANGELOG.md at the repository root');
  const text = readFileSync(FILE, 'utf8');
  const was = existsSync(COPY) ? readFileSync(COPY, 'utf8') : null;
  if (was === text) out('packages/studio/CHANGELOG.md is already CHANGELOG.md');
  else { writeFileSync(COPY, text); out('packages/studio/CHANGELOG.md now matches CHANGELOG.md (commit both)'); }
  process.exit(0);
}

if (args.includes('--notes')) {
  const version = opt('--notes');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('changelog: --notes takes a version, x.y.z');
  const notes = releaseNotes(parseChangelog(readFileSync(FILE, 'utf8')), version, { tag: opt('--tag') ?? null });
  if (!notes) fail(`changelog: CHANGELOG.md has no section for ${version}`);
  process.stdout.write(notes);
  process.exit(0);
}

if (!args.includes('--check')) fail('usage: node scripts/changelog.mjs --check [--base <ref>] | --sync | --notes <version> [--tag <tag>]');

// --check
const version = readJson(STUDIO_PKG).version;
const plugin = readJson(PLUGIN).version;
const base = opt('--base');
let was = null;
if (base) {
  const r = spawnSync('git', ['-C', ROOT, 'show', `${base}:packages/studio/package.json`], { encoding: 'utf8' });
  try { was = r.status === 0 ? JSON.parse(r.stdout).version : null; } catch { was = null; }
  if (r.status !== 0) out(`(could not read packages/studio/package.json at ${base}; checking this version's section only)`);
}
const moved = was && was !== version ? ` This pull request moves @homie-rocks/studio from ${was} to ${version}.` : '';
const today = new Date().toISOString().slice(0, 10);
const template = (newest) => [
  `Add this at the top of CHANGELOG.md${newest ? `, above "## [${newest}]"` : ''}, and say what changed for the people who make studios:`,
  '',
  `  ## [${version}] - ${today}`,
  '',
  `  **Plugin ${plugin}** · [#<this pull request>](https://github.com/homie-rocks/homie/pull/<number>)`,
  '',
  '  One sentence: what this version lets a creator do.',
  '',
  '  ### Added',
  '',
  '  - What they can do now, in plain words.',
  '',
  '  (Use "### Changed", "### Fixed" and "### Upgrade notes" as they apply. Upgrade notes are what a creator has to',
  '  do themselves: a step, a migration, anything that works differently. Leave a group out when it has nothing.)',
  '',
  'Then copy it into the package, which ships it on npm:',
  '',
  '  node scripts/changelog.mjs --sync',
  '',
  'and commit CHANGELOG.md and packages/studio/CHANGELOG.md. If another pull request took this version first, rebase,',
  'give your change the next version (in packages/studio/package.json and its other places), and keep both sections.',
].join('\n');

if (!existsSync(FILE)) fail(`CHANGELOG.md is missing.${moved}\n\n${template(null)}`);
const text = readFileSync(FILE, 'utf8');
const log = parseChangelog(text);
const problems = [...log.problems];
const section = sectionOf(log, version);
const newest = log.versions[0]?.version ?? null;
if (!section) {
  fail(`CHANGELOG.md has no section for @homie-rocks/studio ${version} (packages/studio/package.json).${moved}\n\n${template(newest)}`);
}
if (newest !== version) problems.push(`the newest section is ${newest}, but packages/studio/package.json says ${version}: the newest section is the package's own version (a section is added when the version moves, never ahead of it)`);
if (!section.plugins.includes(plugin)) {
  problems.push(`the plugin is ${plugin} (plugins/homie/.claude-plugin/plugin.json), but the ${version} section's Plugin line says ${section.plugins.join(', then ') || 'nothing'}: write "**Plugin ${plugin}**"${section.plugins.length ? ` (or "**Plugin ${section.plugins.join(', then ')}, then ${plugin}**" when the plugin had a release of its own after ${version}), and say what it changed` : ''}`);
}
const files = readJson(STUDIO_PKG).files ?? [];
if (!files.includes('CHANGELOG.md')) problems.push('packages/studio/package.json `files` must list CHANGELOG.md, so npm ships it');
if (!existsSync(COPY)) problems.push('packages/studio/CHANGELOG.md is missing: run node scripts/changelog.mjs --sync and commit it');
else if (readFileSync(COPY, 'utf8') !== text) problems.push('packages/studio/CHANGELOG.md is not the same as CHANGELOG.md: run node scripts/changelog.mjs --sync and commit both');
if (problems.length) fail(`CHANGELOG.md needs a fix:${moved ? `${moved}` : ''}\n${problems.map((p) => `  - ${p}`).join('\n')}`);
out(`CHANGELOG.md: ${log.versions.length} versions, the newest ${version} (plugin ${section.plugin})${moved ? `, which this pull request moves to from ${was}` : ''}; the package's copy is the same file.`);
