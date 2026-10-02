#!/usr/bin/env node
/**
 * The fingerprints `homie-studio upgrade` knows an unchanged older template by
 * (packages/studio/lib/template-history.json): for every version of the studio
 * template, a short hash of each file `homie-studio new` writes and of each
 * AGENTS.md section, made with the stand-in name and slug (upgrade.mjs STAND_IN).
 * A studio's file or section with one of these hashes was never changed by the
 * studio, so upgrade may replace it with the template's newer text; anything else
 * is the studio's own and is kept. `named` keeps the hashes that differ for a studio
 * the template's own words name (upgrade.mjs NAMED_IN_TEMPLATE: the demo's Homie
 * Arcade), made with that studio's name and slug.
 *
 *   node scripts/studio-template-history.mjs            this checkout's template, as its package.json version
 *   node scripts/studio-template-history.mjs --git      also every commit that changed lib/scaffold.mjs, and every release tag
 *
 * Run it whenever the template's text changes (a test fails until it has), and keep
 * every older version's entry: a studio made on it may still be upgraded.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages', 'studio');
const OUT = join(PKG, 'lib', 'template-history.json');
const { STAND_IN, namedPrint, templatePrint } = await import(pathToFileURL(join(PKG, 'lib', 'upgrade.mjs')));

let history = { v: 1, versions: {} };
try { history = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* a first run */ }

async function printOf(dir) {
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  const { studioFiles } = await import(pathToFileURL(join(dir, 'lib', 'scaffold.mjs')));
  // This checkout's names for every version: an older template that names one of them is read as that studio reads it.
  const render = (who) => studioFiles({ ...who, homie: 'https://homie.rocks' });
  const print = templatePrint(render(STAND_IN));
  return { version, print, named: namedPrint(render, print) };
}

/** Two templates published under one version (a fix before its tag) both count: merge their hashes. */
function merge(into, print) {
  into.files ??= {};
  into.sections ??= {};
  into.sections['AGENTS.md'] ??= {};
  const both = (a, b) => [...new Set([a, b].flat().filter(Boolean))].sort();
  for (const [f, h] of Object.entries(print.files ?? {})) into.files[f] = into.files[f] && into.files[f] !== h ? both(into.files[f], h) : h;
  for (const [s, h] of Object.entries(print.sections['AGENTS.md'])) into.sections['AGENTS.md'][s] = into.sections['AGENTS.md'][s] && into.sections['AGENTS.md'][s] !== h ? both(into.sections['AGENTS.md'][s], h) : h;
  return into;
}
function add(version, print, named = {}) {
  const v = merge(history.versions[version] ?? { files: {}, sections: { 'AGENTS.md': {} } }, print);
  for (const [name, p] of Object.entries(named)) {
    v.named ??= {};
    const n = merge(v.named[name] ?? { files: {}, sections: { 'AGENTS.md': {} } }, p);
    if (!Object.keys(n.files).length) delete n.files;
    v.named[name] = n;
  }
  history.versions[version] = v;
}

if (process.argv.includes('--git')) {
  // Every commit that changed the template, and every release (so each published version is named).
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const commits = [...new Set([...git('log', '--format=%H', '--', 'packages/studio/lib/scaffold.mjs').reverse(), ...git('tag', '--list', 'release-*').map((t) => git('rev-list', '-n', '1', t)[0])])];
  for (const c of commits) {
    const tmp = mkdtempSync(join(tmpdir(), 'studio-template-'));
    try {
      execFileSync('sh', ['-c', `git archive ${c} packages/studio | tar -x -C "${tmp}"`], { cwd: ROOT });
      const { version, print, named } = await printOf(join(tmp, 'packages', 'studio'));
      add(version, print, named);
      process.stderr.write(`${c.slice(0, 9)} ${version}\n`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
}
// This checkout's template, merged into its version's entry (never replacing a published one's hashes: a draft
// made before the version is bumped adds its own beside them, which can only ever match that draft's own text).
const { version, print, named } = await printOf(PKG);
add(version, print, named);
const sorted = Object.fromEntries(Object.entries(history.versions).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
writeFileSync(OUT, `${JSON.stringify({ v: 1, about: 'Fingerprints of every studio template version (scripts/studio-template-history.mjs): homie-studio upgrade replaces a file or an AGENTS.md section only when it is exactly one of these. A version\'s named entries are for a studio the template itself names (lib/upgrade.mjs NAMED_IN_TEMPLATE), as that studio reads them.', versions: sorted }, null, 1)}\n`);
process.stderr.write(`wrote ${OUT.slice(ROOT.length + 1)} (${Object.keys(sorted).join(', ')})\n`);
