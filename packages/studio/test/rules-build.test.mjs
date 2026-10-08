/**
 * `homie-studio build` for a game written as rules plus view, beside one written the old way
 * (rooms-milestone-1-design.md sections 7 and 8).
 *
 *   - coin-dash builds: its view bundle holds the guarded move code and the rules' declarations as data, and none of
 *     the rules' own code; its rules go to site/src/rules/ as one module that imports only Homie's rules module and
 *     the guard, with a table the studio's Worker imports; the catalogue says its rules run on the server;
 *   - a game written before rules (gem-rush) builds exactly as it did, hosted by a player's browser, and the build
 *     says so in one line; it cannot ask for the server;
 *   - rules the wall refuses stop the build with the line named, and leave the site and site/src/rules as they were;
 *   - rules that fail when they run stop the build with the handler named;
 *   - a new studio's Worker imports an empty table, and its config turns off evaluation at startup.
 * Run: node --test packages/studio/test/rules-build.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { starters } from '../lib/studio.mjs';
import { PKG, REPO_NM } from './rules-kit.mjs';

const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-build-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON: ${r.stdout}${r.stderr}`); } };
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Rule Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

test('a new studio\'s Worker imports the table of its server-hosted games, and its config turns off evaluation at startup', () => {
  const dir = studio('fresh');
  assert.match(read(dir, 'site/src/worker.mjs'), /import \{ hostRules \} from '@homie-rocks\/studio\/worker';\n[^\n]*\nimport rules from '\.\/rules\/index\.mjs';\n\nhostRules\(rules\);\nexport \{ default, Table, Lobby \} from '@homie-rocks\/studio\/worker';/);
  assert.match(read(dir, 'site/src/rules/index.mjs'), /export default \{\};\n$/);
  assert.match(read(dir, 'wrangler.jsonc'), /"compatibility_flags": \[\s*"global_fetch_strictly_public",\s*"disallow_eval_during_startup"\s*\]/);
  // coin-dash is an example, shown as one, and can be copied by its name.
  const list = starters();
  assert.deepEqual(list.find((s) => s.id === 'coin-dash').example, true);
  assert.equal(list.find((s) => s.id === 'gem-rush').example, undefined);
});

test('coin-dash builds as a view bundle and a rules module; gem-rush builds as it always did, and says so', async () => {
  const dir = studio('both');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  assert.equal(run(['game', 'new', 'gems', '--from', 'gem-rush'], dir).status, 0);
  const built = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const said = built.stdout + built.stderr;
  assert.match(said, /coin-dash: its rules run on the server \(checked and guarded, \d+ KB, build [0-9a-f]{16}; three seconds with bots: the busiest tick used \d+ of 500000 budget units, \d+ of them in one handler\)/);
  assert.match(said, /hosted by a player's browser, as before \(no src\/rules\.ts; nothing to do\): gems\n/);
  // The rules module: one file, importing only Homie's rules module and the guard.
  const rules = read(dir, 'site/src/rules/coin-dash.mjs');
  assert.deepEqual([...new Set([...rules.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]))].sort(), ['@homie-rocks/studio/rules', '@homie-rocks/studio/rules/guard']);
  assert.match(rules, /"take"/);
  assert.match(rules, /__homie\d*\.t\(\);/);
  assert.equal(read(dir, 'site/src/rules/index.mjs'), `// Written by \`homie-studio build\` from this studio's games. Do not edit: the next build writes it again.\n// The rules of this studio's server-hosted games, for the Worker (site/src/worker.mjs hands them to hostRules).\nimport rules0 from './coin-dash.mjs';\nimport data0 from './coin-dash.data.mjs';\nexport default {\n  "coin-dash": { rules: rules0, ...data0 },\n};\n`);
  const data = (await import(pathToFileURL(join(dir, 'site/src/rules/coin-dash.data.mjs')).href)).default;
  assert.deepEqual(Object.keys(data), ['tune', 'map', 'settings', 'seats', 'build']);
  assert.equal(data.settings.host, 'server');
  assert.equal(data.settings.tickHz, 20);
  assert.equal(data.seats, 8);
  assert.equal(data.map.name, 'main');
  assert.equal(data.tune.public.speed.value, 6);
  assert.deepEqual(readdirSync(join(dir, 'site/src/rules')).sort(), ['coin-dash.data.mjs', 'coin-dash.mjs', 'index.mjs'], 'gems has no rules there');
  // The view's bundle: the game's declarations as data and the guarded move, and none of the rules' own code.
  const cat = JSON.parse(read(dir, 'site/dist/games.json'));
  const row = cat.games.find((g) => g.id === 'coin-dash');
  assert.deepEqual(row.room, { host: 'server', tickHz: 20, inputHz: 20, contract: 2, build: data.build, rounds: { seconds: 60, breakSeconds: 8 } });
  assert.equal(row.roundSeconds, 60, 'the round is the rules\' own');
  assert.equal(row.netplayRev, 10);
  const view = read(dir, `site/dist/games/coin-dash/${row.built.bundle}`);
  assert.doesNotMatch(view, /"take"|roundStart\(|world\.spawn|\.despawn\(/, 'no handler of the rules is in the view');
  assert.doesNotMatch(view, /agent:offer|carryMs|floorMs/, 'a game without a vocabulary excludes the optional agents helper');
  assert.match(view, /frozenUntil/, 'the move code is');
  assert.match(view, /this handler ran too long/, 'with the guard that counts it');
  assert.match(view, /"effectNames":\["ding"\]|effectNames:\["ding"\]/, 'and the declarations, as data');
  // gem-rush: the same catalogue row it always had, its own code the host, nothing about rules.
  const gems = cat.games.find((g) => g.id === 'gems');
  assert.equal(gems.room, undefined);
  assert.equal(gems.movement, 'owner');
  assert.equal(gems.roundSeconds, 60);
  assert.equal(gems.netplayRev, 10);
  assert.ok(existsSync(join(dir, 'site/dist/games/gems', gems.built.bundle)));
  assert.match(read(dir, `site/dist/games/gems/${gems.built.bundle}`), /homie-netplay-rev:10/);

  // A one-game build of the other game keeps coin-dash's rules and its row.
  assert.equal(spawnSync(process.execPath, [CLI, 'build', 'gems'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.ok(existsSync(join(dir, 'site/src/rules/coin-dash.mjs')));
  assert.deepEqual(JSON.parse(read(dir, 'site/dist/games.json')).games.find((g) => g.id === 'coin-dash').room.host, 'server');

  // A game written the old way cannot ask for the server: the build fails with the reason.
  const meta = JSON.parse(read(dir, 'games/gems/game.json'));
  writeFileSync(join(dir, 'games/gems/game.json'), JSON.stringify({ ...meta, room: { host: 'server' } }));
  const no = run(['build'], dir);
  assert.notEqual(no.status, 0);
  assert.match(no.stdout + no.stderr, /games\/gems\/game\.json asks for \\?"room\\?": \{ \\?"host\\?": \\?"server\\?" \}, but this game has no src\/rules\.ts: its rules are inside its own code and run in a player's browser\. Ask for it to be rewritten as rules plus view\./);
  writeFileSync(join(dir, 'games/gems/game.json'), JSON.stringify(meta));

  // Rules the wall refuses stop the build with the line named, and nothing that was built is touched.
  const before = { rules, index: read(dir, 'site/src/rules/index.mjs'), games: read(dir, 'site/dist/games.json') };
  const src = read(dir, 'games/coin-dash/src/rules.ts');
  const line = src.split('\n').findIndex((l) => l.includes('score(world, self) { self.score += 1; }')) + 1;
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src.replace('score(world, self) { self.score += 1; }', 'score(world, self) { self.score += Math.floor(Math.random() * 3); }'));
  const refused = run(['build'], dir);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, new RegExp(`games/coin-dash: its rules were refused\\.\\\\n  games/coin-dash/src/rules\\.ts:${line} Math\\.random is not available in rules \\(Math offers`));
  assert.deepEqual({ rules: read(dir, 'site/src/rules/coin-dash.mjs'), index: read(dir, 'site/src/rules/index.mjs'), games: read(dir, 'site/dist/games.json') }, before);

  // Rules that fail when they run stop the build with the handler named.
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src.replace("for (const coin of world.near(self.pos, 1, 'coin'))", "for (const coin of world.near(self.pos, 100, 'coin'))"));
  const thrown = run(['build'], dir);
  assert.notEqual(thrown.status, 0);
  assert.match(thrown.stdout + thrown.stderr, /games\/coin-dash: its rules ran for three seconds with bots and \d+ handlers failed\. The last: runner\.tick: world\.near reaches 64 m at most/);
  // And a declaration that does not fit.
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src.replace('score(world, self) { self.score += 1; },', 'score(world, self) { self.score += 1; }, bonus(world, self) { self.score += 5; },'));
  const undeclared = run(['build'], dir);
  assert.match(undeclared.stdout + undeclared.stderr, /games\/coin-dash\/src\/rules\.ts: entities\.runner\.on\.bonus: no event \\?"bonus\\?" is declared in shapes\.events/);
  // A rules game cannot be hosted by a browser yet, and says when.
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src);
  const cd = JSON.parse(read(dir, 'games/coin-dash/game.json'));
  writeFileSync(join(dir, 'games/coin-dash/game.json'), JSON.stringify({ ...cd, room: { host: 'browser' } }));
  assert.match(run(['build'], dir).stdout, /Rules hosted by a player's browser arrive in a later release/);
  // A game that stops being a rules game loses its files in site/src/rules.
  rmSync(join(dir, 'games/coin-dash'), { recursive: true });
  assert.equal(run(['build'], dir).status, 0);
  assert.deepEqual(readdirSync(join(dir, 'site/src/rules')), ['index.mjs']);
  assert.match(read(dir, 'site/src/rules/index.mjs'), /export default \{\};\n$/);
});
