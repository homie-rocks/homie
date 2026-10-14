#!/usr/bin/env node
// File-level isolation preserves the serial suite's port/global-state assumptions.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// Refreshed first-attempt CI measurements need twenty full-suite and twelve compatibility bins
// to stay below eight minutes without relaxing the eleven-minute watchdog.
export const shardCounts = { full: 20, compat: 12 };
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
// Observed failure locations in the audited Actions logs, including PR #78's
// Node 24/npm 11 MCP resolution failure (run 37992524039). Keep regressions on 24
// even if their names no longer match a broad runtime-integration category.
export const node24Regressions = new Set([
  'event-delivery-workerd', 'event-resources-workerd', 'event-webhooks', 'event-webhooks-workerd',
  'changelog', 'cloud', 'machine-payments', 'paid-parts-review4-mcp',
  'paid-parts-review5-agent', 'paid-parts-workerd', 'player-image', 'port-input',
  'purchase-deploy', 'rooms-pages', 'rules-3d-prediction-chrome',
  'rules-prediction-chrome', 'selling-entry', 'settlement-crash', 'shop', 'upgrade',
].map(name => `packages/studio/test/${name}.test.mjs`));
export function compatible(file) {
  // npm/ESM resolution, native modules, SQLite, subprocess/stdio and packed installs.
  return node24Regressions.has(file) || !file.startsWith('packages/studio/') || /(?:mcp|paid-parts|purchase|wallet|payment|shop|standalone|desktop|first-run|studio\.test|schema\.test|upgrade|identity|authoring|build(?:-[a-z]+)?\.test|dev-deploy|parts\.test|starter-3d|changelog|rooms-pages|apps-browser)/.test(file);
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
  const bins = balance(inventory().filter(f => !subset || compatible(f)), subset ? Object.fromEntries(inventory().map(f => [f, Math.max(data.seconds[f] ?? 15, data.compatSeconds?.[f] ?? 0)])) : data.seconds, subset ? shardCounts.compat : shardCounts.full);
  if (args.includes('--list') || args[0] === '--rebalance') {
    console.log(JSON.stringify(bins, null, 2));
  } else {
    const index = Number(args[0]);
    if (!Number.isInteger(index) || !bins[index]) throw new Error('usage: node scripts/ci-shards.mjs INDEX [--compat | --list]');
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
