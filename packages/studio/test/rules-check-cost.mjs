#!/usr/bin/env node
/**
 * What the build's check of a rules game costs, in processor seconds (not a test: a figure to read).
 *
 *   node test/rules-check-cost.mjs [--long] [<game folder> ...]
 *
 * With no folder: the stock example, and the heavy games among the fixtures. Each line is the game, the seconds of
 * processor time each part of its build took (every thread counted), and what the play covered. The verdict never
 * depends on these seconds (lib/rules-check.mjs); they are how long a person waits. Run it on a quiet computer.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadRules } from '../lib/rules-build.mjs';
import { ALLOWANCE, LONG_ALLOWANCE, runRulesWorker } from '../lib/rules-check.mjs';
import { guardRules } from '../lib/rules-guard.mjs';
import { typecheckRules } from '../lib/typecheck.mjs';
import { COIN_DASH, PKG, esbuildOf, writeGame } from './rules-kit.mjs';

const long = process.argv.includes('--long');
const folders = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const games = folders.length ? folders.map((f) => resolve(f)) : [join(COIN_DASH, 'src'), ...['m1-big-map', 'm5-forty-sentries'].map((id) => join(PKG, 'test/fixtures/rules-boundaries', id))];
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-check-cost-')));
const esbuild = await esbuildOf();
try {
  for (const from of games) {
    const id = basename(from) === 'src' ? basename(join(from, '..')) : basename(from);
    const read = (name, fallback) => (existsSync(join(from, name)) ? readFileSync(join(from, name), 'utf8') : fallback);
    const dir = writeGame(root, id, { rules: read('rules.ts'), move: read('move.ts', null) });
    writeFileSync(join(dir, 'src/view.ts'), 'export {};');
    const tune = JSON.parse(read('tunables.json', read('../tunables.json', '{}')));
    const map = { ...JSON.parse(read('map.json', readFileSync(join(COIN_DASH, 'map/main.json'), 'utf8'))), name: 'main' };
    const vocab = existsSync(join(from, 'agents.json')) ? JSON.parse(read('agents.json')) : null;
    mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), JSON.stringify(map));
    let last = process.cpuUsage(); const seconds = {};
    const lap = (name) => { const c = process.cpuUsage(last); seconds[name] = Number(((c.user + c.system) / 1e6).toFixed(2)); last = process.cpuUsage(); };
    const guarded = await guardRules(esbuild, root, dir); lap('guard');
    const bundle = await loadRules(esbuild, root, id, guarded.code, { bundleOnly: true });
    const data = { id, tune, map, seats: 8, vocab, sites: guarded.sites };
    const declarations = await runRulesWorker(bundle, data, { declarationsOnly: true }); lap('declarations');
    await typecheckRules(root, { id, dir }, declarations, tune); lap('types');
    let played;
    try { const r = await runRulesWorker(bundle, data, { allowance: long ? LONG_ALLOWANCE : ALLOWANCE }); played = r.plays.map((p) => `${p.ticks} ticks, ${p.rounds} rounds, ${p.restores} rebuilds, ${(p.units / 1e6).toFixed(1)}M units (stopped by ${p.stopped})`).join('; '); } catch (e) { played = `refused: ${e.message.split('\n')[0]}`; }
    lap('play');
    console.log(`${id}: ${JSON.stringify(seconds)} ${played}`);
  }
} finally { rmSync(root, { recursive: true, force: true }); await esbuild.stop?.(); }
