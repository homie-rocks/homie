#!/usr/bin/env node
// File-level isolation preserves the serial suite's port/global-state assumptions.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function inventory() {
  return [...readdirSync('packages').flatMap(p => {
    try { return readdirSync(`packages/${p}/test`).filter(f => f.endsWith('.test.mjs')).map(f => `packages/${p}/test/${f}`); } catch { return []; }
  }), ...readdirSync('scripts').filter(f => f.endsWith('.test.mjs')).map(f => `scripts/${f}`)].sort();
}
// Observed failure locations in the audited Actions logs, including PR #78's
// Node 24/npm 11 MCP resolution failure (run 37992524039). Keep regressions on 24
// even if their names no longer match a broad runtime-integration category.
export const node24Regressions = new Set([
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
  const bins = balance(inventory().filter(f => !subset || compatible(f)), subset ? { ...data.seconds, ...data.compatSeconds } : data.seconds, subset ? 6 : 12);
  if (args.includes('--list') || args[0] === '--rebalance') {
    console.log(JSON.stringify(bins, null, 2));
  } else {
    const index = Number(args[0]);
    if (!Number.isInteger(index) || !bins[index]) throw new Error('usage: node scripts/ci-shards.mjs INDEX [--compat | --list]');
    const seconds = {}; let failed = false;
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
      writeFileSync(`ci-results/${subset ? 'compat' : 'full'}-${index}.json`, JSON.stringify({ seconds }, null, 2));
    }
    process.exitCode = failed ? 1 : 0;
  }
}
