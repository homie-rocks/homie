#!/usr/bin/env node
// After rebasing on the previous release: node scripts/renumber-release.mjs
// Optional explicit studio and plugin versions reserve later slots in a release sequence.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const read = f => readFileSync(f, 'utf8');
const json = f => JSON.parse(read(f));
const main = f => execFileSync('git', ['show', `origin/main:${f}`], { encoding: 'utf8' });
const next = v => { const n = v.split('.').map(Number); n[2]++; return n.join('.'); };
const old = json('packages/studio/package.json').version;
const oldPlugin = json('plugins/homie/plugin.json').version;
const studio = process.argv[2] ?? next(JSON.parse(main('packages/studio/package.json')).version);
const plugin = process.argv[3] ?? next(JSON.parse(main('plugins/homie/plugin.json')).version);
for (const v of [studio, plugin]) if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Versions must be x.y.z');
const files = ['packages/studio/package.json', 'packages/studio/worker/version.mjs', '.claude-plugin/marketplace.json', 'plugins/homie/plugin.json', 'plugins/homie/.claude-plugin/plugin.json', 'plugins/homie/.codex-plugin/plugin.json', 'plugins/homie/.grok-plugin/plugin.json'];
for (const f of files) {
  const isStudio = f.startsWith('packages/studio/');
  writeFileSync(f, read(f).replaceAll(isStudio ? old : oldPlugin, isStudio ? studio : plugin));
}
const log = read('CHANGELOG.md');
const start = log.indexOf('## ['); const end = log.indexOf('\n## [', start + 1);
const section = log.slice(start, end < 0 ? undefined : end).replaceAll(old, studio)
  .replace(/(\*\*Plugin )\d+\.\d+\.\d+(\*\*)/, (_, before, after) => before + plugin + after);
writeFileSync('CHANGELOG.md', log.slice(0, start) + section + (end < 0 ? '' : log.slice(end)));
const history = json('packages/studio/lib/template-history.json');
const released = JSON.parse(main('packages/studio/lib/template-history.json'));
if (old !== studio && !released.versions[old]) delete history.versions[old];
writeFileSync('packages/studio/lib/template-history.json', JSON.stringify(history, null, 1) + '\n');
for (const args of [['scripts/template.mjs'], ['scripts/studio-template-history.mjs'], ['scripts/changelog.mjs', '--sync']]) execFileSync(process.execPath, args, { stdio: 'inherit' });
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { stdio: 'inherit' });
console.log(`Studio ${studio}, plugin ${plugin}. Review git diff, then run the release gates.`);
