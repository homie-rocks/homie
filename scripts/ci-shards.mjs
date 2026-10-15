#!/usr/bin/env node
// File-level isolation preserves the serial suite's port/global-state assumptions.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const shardCounts = { pr: 16, full: 20, compat: 1 };
export const shardBudgetSeconds = 480;
export function checkShardBudget(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid measured shard duration');
  if (seconds > shardBudgetSeconds) throw new Error(`Measured shard took ${seconds.toFixed(1)}s, exceeding the eight-minute budget. Download this run's timings-node* artifacts, refresh scripts/ci-timings.json with --rebalance (Node 24: --compat), and split/rebalance before merging.`);
}
export function inventory() {
  return [...readdirSync('packages').flatMap(p => {
    try { return readdirSync(`packages/${p}/test`).filter(f => f.endsWith('.test.mjs')).map(f => `packages/${p}/test/${f}`); } catch { return []; }
  }), ...readdirSync('scripts').filter(f => f.endsWith('.test.mjs')).map(f => `scripts/${f}`)].sort();
}
// Runtime boundary smoke on Node 24; packaging separately checks every workspace.
export const node24Regressions = new Set([
  'packages/studio/test/app-role-session.test.mjs',
  'scripts/mcp-stdio.test.mjs',
  'packages/studio/test/studio-mcp-workerd.test.mjs',
  'packages/studio/test/event-delivery-workerd.test.mjs',
]);
export const nightlyFiles = new Set([
  'apps-interactions', 'apps-browser', 'shell-update-chrome', 'rules-traffic-chrome', 'rules-terrain-chrome', 'embed-browser', 'signin-browser',
  'rooms-pages', 'rules-prediction-chrome', 'rules-3d-prediction-chrome',
  'rules-browser-exit', 'lab', 'settlement-crash', 'paid-parts-review5-faults', 'watch',
].map(name => `packages/studio/test/${name}.test.mjs`));
export function compatible(file) { return node24Regressions.has(file); }
export function affectedPackages(paths, manifests) {
  if (!paths || paths.some(p => !p.startsWith('packages/'))) return null;
  const affected = new Set(paths.map(p => p.split('/')[1]));
  // Include consumers transitively: a dependency change can break its dependents.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [dir, manifest] of Object.entries(manifests)) {
      const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
      if (!affected.has(dir) && Object.entries(manifests).some(([d, m]) => affected.has(d) && m.name in deps)) {
        affected.add(dir); changed = true;
      }
    }
  }
  return affected;
}
export function selected(files, { full = false, compat = false, paths = null } = {}) {
  if (full) return files;
  const manifests = Object.fromEntries(readdirSync('packages').flatMap(p => {
    try { return [[p, JSON.parse(readFileSync(`packages/${p}/package.json`))]]; } catch { return []; }
  }));
  const affected = affectedPackages(paths, manifests);
  return files.filter(file => compat ? compatible(file) : !nightlyFiles.has(file) &&
    (!affected || !file.startsWith('packages/') || file.startsWith('packages/studio/') || affected.has(file.split('/')[1])));
}
export function balance(files, timings, count) {
  const bins = Array.from({ length: count }, () => ({ seconds: 0, files: [] }));
  for (const file of [...files].sort((a,b) => (timings[b] ?? 15) - (timings[a] ?? 15) || a.localeCompare(b))) {
    const bin = bins.reduce((a,b) => a.seconds <= b.seconds ? a : b);
    bin.files.push(file); bin.seconds += timings[file] ?? 15;
  }
  return bins;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const timingFile = 'scripts/ci-timings.json';
  const data = JSON.parse(readFileSync(timingFile));
  const subset = args.includes('--compat');
  if (args[0] === '--rebalance') {
    for (const input of args.slice(1).filter(a => a !== '--compat')) Object.assign(subset ? (data.compatSeconds ??= {}) : data.seconds, JSON.parse(readFileSync(input)).seconds);
    data.source = 'Measured per-file wall time from CI shard artifacts; unmeasured files retain their baseline estimate.';
    writeFileSync(timingFile, JSON.stringify(data, null, 2) + '\n');
  }
  const full = args.includes('--full');
  const files = selected(inventory(), { full, compat: subset, paths: process.env.CI_CHANGED_PATHS ? JSON.parse(process.env.CI_CHANGED_PATHS) : null });
  const mode = full ? 'full' : subset ? 'compat' : 'pr';
  const bins = balance(files, subset ? Object.fromEntries(files.map(f => [f, Math.max(data.seconds[f] ?? 15, data.compatSeconds?.[f] ?? 0)])) : data.seconds, shardCounts[mode]);
  if (args.includes('--files')) {
    console.log(bins[Number(args[0])].files.join('\n'));
    process.exit(0);
  }
  if (args.includes('--list') || args[0] === '--rebalance') {
    console.log(JSON.stringify(bins, null, 2));
  } else {
    const index = Number(args[0]);
    if (!Number.isInteger(index) || !bins[index]) throw new Error('usage: node scripts/ci-shards.mjs INDEX [--compat | --list]');
    process.env.HOMIE_TEST_FIXTURES ??= `${process.env.RUNNER_TEMP || '/tmp'}/homie-fixtures-${process.pid}`;
    const seconds = {}; let failed = false;
    const shardStart = performance.now();
    mkdirSync('ci-results', { recursive: true });
    for (const file of bins[index].files) {
      console.log(`\n::group::${file}`);
      const start = performance.now();
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', file], { stdio: 'inherit', timeout: 600_000, killSignal: 'SIGKILL' });
      seconds[file] = Math.round((performance.now() - start) / 100) / 10;
      console.log(`::endgroup::\nFILE_DURATION ${file} ${seconds[file]}s`);
      if (result.status !== 0) {
        failed = true;
        console.error(`::error file=${file}::${result.error?.code === 'ETIMEDOUT' ? 'File exceeded 10 minutes; investigate a stuck child or unbounded wait.' : 'Test file failed.'}`);
      }
      const wallSeconds = (performance.now() - shardStart) / 1000;
      writeFileSync(`ci-results/${subset ? 'compat' : 'full'}-${index}.json`, JSON.stringify({ seconds, wallSeconds }, null, 2));
    }
    // Check real elapsed time, including new files and process startup, rather
    // than trusting the committed estimates. Finish every test before failing.
    const wallSeconds = (performance.now() - shardStart) / 1000;
    console.log(`SHARD_DURATION ${subset ? 'compat' : 'full'}-${index} ${wallSeconds.toFixed(1)}s (budget ${shardBudgetSeconds}s)`);
    try { checkShardBudget(wallSeconds); } catch (error) {
      failed = true;
      console.error(`::error::${error.message}`);
    }
    process.exitCode = failed ? 1 : 0;
  }
}
