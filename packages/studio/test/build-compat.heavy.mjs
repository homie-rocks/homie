// Build contract cases, split into independent files for CI; shared fixtures in build-kit.mjs.
import { legacyGame } from './legacy-game.mjs';
import { browserRulesGame } from './browser-rules-game.mjs';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleOf, gameDigest, modelBudgetsOf, orderGames } from '../lib/build.mjs';
import { placeholderGlb } from '../lib/optimise.mjs';
import { previewServer } from '../lib/preview.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { openStage, swapIn } from '../lib/stage.mjs';
import { basedOnCredit, basedOnRow, licenseLabel, licenseOf, retiredKeys } from '../worker/license.mjs';
import { creditsPage } from '../worker/site.mjs';
import { PKG, CLI, REPO_NM, scratch, run, plain, out, json, write, edit, editJson, studio, siteOf, snapshot } from './build-kit.mjs';

test('player card choices survive the studio and game build', () => {
  const dir = studio('player-cards', ['alpha']);
  editJson(join(dir, 'studio.json'), s => { s.site = { ...s.site, playerCard: false, playerCardOrigins: ['https://posts.example', 'https://*.x.com', '*', 'http://no.example'] }; });
  editJson(join(dir, 'games/alpha/game.json'), g => { g.playerCard = false; g.screen = { singleScreen: false }; });
  const built = run(['build'], dir); assert.equal(built.status, 0, built.stdout + built.stderr);
  const cat = json(join(dir, 'site/dist/games.json'));
  assert.equal(cat.studio.site.playerCard, false);
  assert.deepEqual(cat.studio.site.playerCardOrigins, ['https://posts.example', 'https://*.x.com']);
  assert.equal(cat.games[0].playerCard, false); assert.equal(cat.games[0].screen.singleScreen, false);
});

test('build --types: a type error in a game stops the build; the studio\'s own TypeScript does the check', () => {
  const dir = studio('legacy-types', [], { typescript: true });
  legacyGame(dir, 'alpha');
  assert.equal(run(['build', '--types'], dir).status, 0, 'the starter has no type errors');
  const dist = join(dir, 'site', 'dist');
  const before = snapshot(dist);
  edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nexport const hitPoints: number = 'full';\n`);
  // The build itself only strips types: this ships, which is the gap.
  assert.equal(run(['build'], dir).status, 0);
  const shipped = snapshot(dist);
  assert.notDeepEqual(shipped, before);
  const bad = run(['build', '--types'], dir);
  assert.equal(bad.status, 1);
  assert.match(out(bad).why, /^1 type error \(build --types\); nothing was built:\n {2}games\/alpha\/src\/main\.ts:\d+:\d+ TS2322 Type 'string' is not assignable to type 'number'\.$/);
  assert.deepEqual(snapshot(dist), shipped, 'nothing was built');
  // A game's own tsconfig.json is the one it is checked with.
  write(dir, 'games/alpha/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: [] }, files: ['src/main.ts'] }));
  assert.match(out(run(['build', '--types'], dir)).why, /games\/alpha\/src\/main\.ts:\d+:\d+ TS2322/);
  edit(join(dir, 'games/alpha/src/main.ts'), (t) => t.replace("hitPoints: number = 'full'", 'hitPoints: number = 3'));
  const good = out(run(['build', '--types'], dir));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.deepEqual(good.types.games, [{ id: 'alpha', checked: true, with: 'its tsconfig.json', errors: 0, elsewhere: 0 }]);
  assert.match(good.types.typescript, /^\d+\.\d+\.\d+/);

  // A studio with no TypeScript: the command fails and says the one line that gets it. A plain build never asks.
  const none = studio('legacy-types-none', []);
  legacyGame(none, 'alpha');
  const r = run(['build', '--types'], none);
  assert.equal(r.status, 1);
  assert.match(out(r).why, /this studio has none: run `npm install --save-dev typescript`/);
  assert.equal(run(['build'], none).status, 0);
  // Rules always use the toolkit's pinned compiler; legacy --types still uses the studio's own.
  const pkg = json(join(PKG, 'package.json'));
  assert.equal(pkg.dependencies?.typescript, '5.9.3');
  assert.equal(pkg.peerDependencies?.typescript, undefined);
  assert.match(json(join(none, 'package.json')).devDependencies.typescript, /^\d+\.\d+\.\d+$/, 'pinned exactly, in the studio\'s own devDependencies');
});


test('released netplay games keep manifest precedence, need no rewrite, and retain the 32-seat limit', () => {
  const dir = studio('legacy-seats', []);
  legacyGame(dir, 'legacy');
  const first = plain(['build'], dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /warning:.*(?:netplay|browser-hosted)|netplay.*(?:retired|must.*rewrite)/i);
  editJson(join(dir, 'games/legacy/game.json'), g => { g.players.max = 99; g.netplay.maxPlayers = 40; });
  const capped = plain(['build'], dir);
  assert.equal(capped.status, 0, capped.stdout + capped.stderr);
  assert.match(capped.stdout + capped.stderr, /asks for 40 players.*32-player limit.*REWRITE\.md/);
  assert.equal(json(join(dir, 'site/dist/games.json')).games[0].players.max, 32);
  editJson(join(dir, 'games/legacy/game.json'), g => { delete g.netplay.maxPlayers; });
  write(dir, 'games/legacy/netplay.json', JSON.stringify({ v: 1, players: { min: 2, max: 12 } }));
  const manifest = plain(['build'], dir);
  assert.equal(manifest.status, 0, manifest.stdout + manifest.stderr);
  assert.deepEqual(json(join(dir, 'site/dist/games.json')).games[0].players, { min: 2, max: 12 });
});

test('legacy games cannot request server hosting, and a pre-existing rules.ts is their own code', () => {
  const dir = studio('legacy-own-rules', []);
  legacyGame(dir, 'legacy');
  write(dir, 'games/legacy/src/rules.ts', 'export const roll = () => Math.random();');
  const first = run(['build'], dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(json(join(dir, 'site/dist/games.json')).games[0].room, undefined);
  assert.equal(existsSync(join(dir, 'site/src/rules/legacy.mjs')), false);
  rmSync(join(dir, 'games/legacy/src/rules.ts'));
  editJson(join(dir, 'games/legacy/game.json'), g => { g.room = { host: 'server' }; });
  const refused = run(['build'], dir);
  assert.equal(refused.status, 1);
  assert.match(out(refused).why, /has no src\/rules\.ts/);
});
