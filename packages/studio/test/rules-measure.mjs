#!/usr/bin/env node
/** Repeatable local measurement. Prepare an isolated Coin Dash studio, install/build/start it, then measure.
 * node packages/studio/test/rules-measure.mjs --prepare /tmp/coin-room --seats 32
 * cd /tmp/coin-room && npm install && npx homie-studio build && npx homie-studio dev --port 8787 --no-local-ai
 * node packages/studio/test/rules-measure.mjs --url http://127.0.0.1:8787 --seats 32 --seconds 120
 * A 32-seat build also gives the relay its 36-connection per-address limit. Never overrides production limits.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botClient, chaseCoins, socketUrl } from './bot-client.mjs';
const args = process.argv.slice(2);
const opt = (key, value) => args.includes(key) ? args[args.indexOf(key) + 1] : value;
const seats = Number(opt('--seats', 32)); const seconds = Number(opt('--seconds', 120));
assert.ok(Number.isInteger(seats) && seats >= 1 && seats <= 32); assert.ok(seconds > 0 && seconds <= 3600);
const prepare = opt('--prepare', null);
if (prepare) {
  const root = resolve(prepare); const studio = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const cli = join(studio, 'bin/homie-studio.mjs');
  const run = (argv, cwd) => { const r = spawnSync(process.execPath, [cli, ...argv], { cwd, stdio: 'inherit' }); assert.equal(r.status, 0); };
  run(['new', root, '--name', 'Room Measurement', '--no-install']);
  run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], root);
  // Measure this source revision, including changes not yet released to the registry.
  const pkgFile = join(root, 'package.json'); const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.devDependencies['@homie-rocks/studio'] = `file:${studio}`; writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  const file = join(root, 'games/coin-dash/game.json'); const meta = JSON.parse(readFileSync(file, 'utf8')); meta.players.max = seats; writeFileSync(file, JSON.stringify(meta, null, 2));
  console.log(`Prepared ${seats} seats. Install dependencies, build, and start this studio locally before measuring.`);
} else {
  const base = opt('--url', 'http://127.0.0.1:8787'); const room = `measure-${Date.now().toString(36)}`;
  const url = await socketUrl(base, 'coin-dash', room); const clients = [];
  try {
    for (let i = 0; i < seats; i++) { const b = botClient({ url, name: `Player ${i + 1}`, steer: chaseCoins() }); clients.push(b); await b.ready; assert.equal(b.seat, i, 'build the game with the requested seat count first'); }
    await new Promise(r => setTimeout(r, seconds * 1000));
    const rows = clients.map(b => b.report());
    const report = { room, seats, seconds, worstShare: Math.min(...rows.map(r => r.share)), worstGapsUnder: Math.min(...rows.map(r => r.gapsUnder)), worstP99: Math.max(...rows.map(r => r.gapMs.p99)), rows };
    console.log(JSON.stringify(report, null, 2));
    if (report.worstShare < .995 || report.worstGapsUnder < .99 || clients.some(b => b.closed)) process.exitCode = 1;
  } finally { for (const b of clients) b.close(); }
}
