import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * `homie-studio build` for server and browser games using one rules-plus-view contract
 * (rooms-milestone-1-design.md sections 7 and 8).
 *
 *   - coin-dash builds: its view bundle holds the guarded move code and the rules' declarations as data, and none of
 *     the rules' own code; its rules go to site/src/rules/ as one module that imports only Homie's rules module and
 *     the guard, with a table the studio's Worker imports; the catalogue says its rules run on the server;
 *   - browser/offline games use guarded rules too; old netplay-only builds are refused;
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
import { buildGameFiles, build as buildSite } from '../lib/build.mjs';
import { webBundle } from '../lib/standalone.mjs';
import { starters, listGames } from '../lib/studio.mjs';
import { PKG, REPO_NM, esbuildOf } from './rules-kit.mjs';

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
  assert.ok(read(dir, 'site/src/worker.mjs').includes("hostRules(rules);\nuseTools(async () => (await import('./tools/index.mjs')).default);\nexport { default, Table, Lobby, Gate, Concentrator } from '@homie-rocks/studio/worker';"));
  assert.match(read(dir, 'site/src/rules/index.mjs'), /export default \{\};\n$/);
  assert.match(read(dir, 'wrangler.jsonc'), /"compatibility_flags": \[\s*"nodejs_compat",\s*"global_fetch_strictly_public",\s*"disallow_eval_during_startup"\s*\]/);
  // coin-dash is an example, shown as one, and can be copied by its name.
  const list = starters();
  assert.deepEqual(list.find((s) => s.id === 'coin-dash').example, true);
  assert.equal(list.find((s) => s.id === 'gem-rush').example, undefined);
});

test('game hashes are reproducible, isolate unrelated builds, and distinguish code from state shape', () => {
  const dir = studio('hashes');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  browserRulesGame(dir, 'gems');
  const build = () => {
    const r = run(['build'], dir); assert.equal(r.status, 0, r.stdout + r.stderr);
    const trial = out(r).games.find(g => g.id === 'coin-dash').capacityTrial;
    assert.equal(trial.seats, 32); assert.equal(trial.host, 'Node'); assert.equal(trial.cloudflare, false);
    assert.equal(out(r).games.find(g => g.id === 'gems').capacityTrial.cloudflare, false, 'browser rules do not claim Cloudflare capacity');
    return JSON.parse(read(dir, 'site/dist/games.json')).games.find((g) => g.id === 'coin-dash');
  };
  const first = build();
  assert.deepEqual(build().room, first.room);
  assert.equal(first.netplay.version, first.room.build);
  const unrelated = 'games/gems/src/main.ts';
  writeFileSync(join(dir, unrelated), read(dir, unrelated) + '\nconsole.log("other game changed");\n');
  assert.deepEqual(build().room, first.room, 'another game does not reload this one');
  const view = 'games/coin-dash/src/view.ts';
  writeFileSync(join(dir, view), read(dir, view) + '\nconsole.log("view changed");\n');
  const viewed = build();
  assert.notEqual(viewed.room.build, first.room.build); assert.equal(viewed.room.stateHash, first.room.stateHash);
  const tunePath = 'games/coin-dash/tunables.json'; const tune = JSON.parse(read(dir, tunePath));
  tune.public.speed.value = 5;
  writeFileSync(join(dir, tunePath), JSON.stringify(tune));
  const tuned = build();
  assert.notEqual(tuned.room.build, viewed.room.build); assert.equal(tuned.room.stateHash, first.room.stateHash);
  const path = 'games/coin-dash/src/rules.ts'; const src = read(dir, path);
  writeFileSync(join(dir, path), src.replace('self.score += 1;', 'self.score += 2;'));
  const coded = build();
  assert.notEqual(coded.room.build, tuned.room.build); assert.equal(coded.room.stateHash, first.room.stateHash);
  writeFileSync(join(dir, path), src.replace('score: f.u16({ score: true })', 'score: f.u32({ score: true })'));
  const shaped = build(); assert.notEqual(shaped.room.stateHash, first.room.stateHash);
  const mapPath = 'games/coin-dash/map/main.json'; const map = JSON.parse(read(dir, mapPath));
  map.spots.start[0][0] += 1;
  writeFileSync(join(dir, mapPath), JSON.stringify(map));
  const mapped = build(); assert.notEqual(mapped.room.stateHash, shaped.room.stateHash); assert.notEqual(mapped.room.build, shaped.room.build);
});

test('server and browser games build the same rules-plus-view contract, and old netplay-only games are refused', async () => {
  const dir = studio('both');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  browserRulesGame(dir, 'gems');
  const built = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const said = built.stdout + built.stderr;
  assert.doesNotMatch(said, /chunks? loaded later/);
  assert.match(said, /smoke-run largest snapshot \d+ B .*checkpoint \d+ B/);
  assert.match(said, /coin-dash: its rules run on the server \(checked and guarded, \d+ KB, build [0-9a-f]{32}; 18000 ticks played, the room rebuilt from its save \d+ times: the busiest tick used \d+ of 500000 budget units, \d+ of them in one handler; the largest save was \d+ bytes\)/);
  assert.doesNotMatch(said, /no room object; nothing to do/);
  // The rules module: one file, importing only Homie's rules module and the guard.
  const rules = read(dir, 'site/src/rules/coin-dash.mjs');
  assert.deepEqual([...new Set([...rules.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]))].sort(), ['@homie-rocks/studio/rules', '@homie-rocks/studio/rules/guard']);
  assert.match(rules, /"take"/);
  assert.match(rules, /__homie\d*\.t\("[^"\n]+", \d+\);/);
  assert.equal(read(dir, 'site/src/rules/index.mjs'), `// Written by \`homie-studio build\` from this studio's games. Do not edit: the next build writes it again.\n// The rules of this studio's server-hosted games, for the Worker (site/src/worker.mjs hands them to hostRules).\nimport rules0 from './coin-dash.mjs';\nimport data0 from './coin-dash.data.mjs';\nexport default {\n  "coin-dash": { rules: rules0, ...data0 },\n};\n`);
  const data = (await import(pathToFileURL(join(dir, 'site/src/rules/coin-dash.data.mjs')).href)).default;
  assert.deepEqual(Object.keys(data), ['tune', 'map', 'settings', 'seats', 'build', 'stateHash']);
  assert.equal(data.settings.host, 'server');
  assert.equal(data.settings.tickHz, 20);
  assert.equal(data.seats, 8);
  assert.equal(data.map.name, 'main');
  assert.equal(data.tune.public.speed.value, 6);
  assert.deepEqual(readdirSync(join(dir, 'site/src/rules')).sort(), ['coin-dash.data.mjs', 'coin-dash.mjs', 'index.mjs'], 'gems has no rules there');
  // The view's bundle: the game's declarations as data and the guarded move, and none of the rules' own code.
  const cat = JSON.parse(read(dir, 'site/dist/games.json'));
  const row = cat.games.find((g) => g.id === 'coin-dash');
  assert.deepEqual(row.room, { host: 'server', offline: true, tickHz: 20, inputHz: 20, contract: 2, build: data.build, stateHash: data.stateHash, rounds: { seconds: 60, breakSeconds: 8 } });
  assert.equal(row.roundSeconds, 60, 'the round is the rules\' own');
  assert.equal(row.netplayRev, 12);
  const view = read(dir, `site/dist/games/coin-dash/${row.built.bundle}`);
  assert.doesNotMatch(view, /"take"|roundStart\(|world\.spawn|\.despawn\(/, 'no handler of the rules is in the view');
  const manifest = JSON.parse(read(dir, 'site/dist/games/coin-dash/rules.json'));
  assert.equal(manifest.build, data.build, 'the offline manifest uses the complete built game revision');
  const files = manifest.files;
  const allView = files.map((f) => read(dir, `site/dist/games/coin-dash/${f}`)).join('\n');
  assert.ok(files.length > 1, 'offline rules are a separate module');
  assert.match(allView, /world\.spawn|\"take\"/, 'the optional module contains the guarded handlers');
  assert.match(said, /rules and tunables are sent to players/);
  const appDir = join(dir, '.studio', 'app');
  webBundle(dir, listGames(dir).find((g) => g.id === 'coin-dash'), appDir);
  for (const file of files) assert.equal(read(appDir, `web/game/${file}`), read(dir, `site/dist/games/coin-dash/${file}`), 'the app carries each module byte for byte');
  assert.match(read(appDir, 'web/config.js'), /offline[^,]*true/);
  assert.match(allView, /frozenUntil/, 'the move code is');
  assert.match(allView, /this handler ran too long/, 'with the guard that counts it');
  assert.doesNotMatch(view, /agent:offer|carryMs|floorMs/, 'a game without a vocabulary excludes the optional agents helper');
  assert.match(view, /"effectNames":\["ding"\]|effectNames:\["ding"\]/, 'and the declarations, as data');
  // ember-vale: the same catalogue row it always had, its own code the host, nothing about rules.
  const gems = cat.games.find((g) => g.id === 'gems');
  assert.equal(gems.room.host, 'browser');
  assert.equal(gems.room.contract, 2);
  assert.equal(gems.netplayRev, 12);
  assert.ok(existsSync(join(dir, 'site/dist/games/gems', gems.built.bundle)));
  assert.match(read(dir, `site/dist/games/gems/${gems.built.bundle}`), /homie-netplay-rev:12/);

  // A one-game build of the other game keeps coin-dash's rules and its row.
  assert.equal(spawnSync(process.execPath, [CLI, 'build', 'gems'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.ok(existsSync(join(dir, 'site/src/rules/coin-dash.mjs')));
  assert.deepEqual(JSON.parse(read(dir, 'site/dist/games.json')).games.find((g) => g.id === 'coin-dash').room.host, 'server');

  // Removing the rules contract has no browser-hosted fallback.
  const meta = JSON.parse(read(dir, 'games/gems/game.json'));
  const unruled = { ...meta }; delete unruled.room;
  writeFileSync(join(dir, 'games/gems/game.json'), JSON.stringify(unruled));
  const no = run(['build'], dir);
  assert.notEqual(no.status, 0);
  assert.match(no.stdout + no.stderr, /games use rules plus view/);
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
  assert.match(thrown.stdout + thrown.stderr, /games\/coin-dash\/src\/rules.ts:\d+ runner\.tick: world\.near reaches 64 m at most/);
  // And a declaration that does not fit.
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src.replace('score(world, self) { self.score += 1; },', 'score(world, self) { self.score += 1; }, bonus(world, self) { self.score += 5; },'));
  const undeclared = run(['build'], dir);
  assert.match(undeclared.stdout + undeclared.stderr, /games\/coin-dash\/src\/rules\.ts:\d+: entities\.runner\.on\.bonus: no event \\?"bonus\\?" is declared in shapes\.events/);
  // The same rules also build for a browser host; the Worker no longer carries them.
  writeFileSync(join(dir, 'games/coin-dash/src/rules.ts'), src);
  const cd = JSON.parse(read(dir, 'games/coin-dash/game.json'));
  writeFileSync(join(dir, 'games/coin-dash/game.json'), JSON.stringify({ ...cd, room: { host: 'browser' } }));
  assert.equal(run(['build'], dir).status, 0);
  assert.equal(JSON.parse(read(dir, 'site/dist/games.json')).games.find((g) => g.id === 'coin-dash').room.host, 'browser');
  assert.deepEqual(readdirSync(join(dir, 'site/src/rules')), ['index.mjs']);
  // Private server games ship neither handlers nor private values, including in an app.
  const tuning = JSON.parse(read(dir, 'games/coin-dash/tunables.json'));
  tuning.privateMarker = 987654321;
  writeFileSync(join(dir, 'games/coin-dash/tunables.json'), JSON.stringify(tuning));
  writeFileSync(join(dir, 'games/coin-dash/game.json'), JSON.stringify({ ...cd, room: { host: 'server', offline: false } }));
  const privateBuild = run(['build'], dir);
  assert.equal(privateBuild.status, 0, privateBuild.stdout + privateBuild.stderr);
  const privateFiles = JSON.parse(read(dir, 'site/dist/games/coin-dash/rules.json')).files;
  assert.equal(privateFiles.length, 1);
  assert.doesNotMatch(read(dir, `site/dist/games/coin-dash/${privateFiles[0]}`), /987654321|world\.spawn|"take"|__homieLab/);
  webBundle(dir, listGames(dir).find((g) => g.id === 'coin-dash'), appDir);
  assert.match(read(appDir, 'web/config.js'), /offline[^,]*false/);
  const labOut = join(dir, '.studio', 'lab-private');
  await buildGameFiles(await esbuildOf(), dir, listGames(dir).find((g) => g.id === 'coin-dash'), labOut, { lab: true });
  const labFiles = JSON.parse(read(labOut, 'rules.json')).files;
  assert.match(labFiles.map((f) => read(labOut, f)).join('\n'), /987654321/, 'the private game can be tested locally in the Lab');
  rmSync(join(dir, 'site/dist/games/coin-dash', privateFiles[0]));
  assert.throws(() => webBundle(dir, listGames(dir).find((g) => g.id === 'coin-dash'), appDir), /rules build is incomplete/);
  // A game that stops being a rules game loses its files in site/src/rules.
  rmSync(join(dir, 'games/coin-dash'), { recursive: true });
  assert.equal(run(['build'], dir).status, 0);
  assert.deepEqual(readdirSync(join(dir, 'site/src/rules')), ['index.mjs']);
  assert.match(read(dir, 'site/src/rules/index.mjs'), /export default \{\};\n$/);
});

test('a browser rules build refuses measured state above the relay caps', async () => {
  const dir = studio('large-state');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  const file = join(dir, 'games/coin-dash/src/rules.ts');
  const source = readFileSync(file, 'utf8').replace("for (const coin of world.near(self.pos, 1, 'coin')) world.send(coin.id, 'take', { by: self.id });", '// Keep the large fixture state; this test measures frames, not coin collection.');
  writeFileSync(file, source.replace("for (const spot of world.map.spots('coins')) world.spawn('coin', spot, {});", "for (let i = 0; i < 420; i += 1) world.spawn('coin', { x: 8, y: 8, z: 0 }, {});"));
  const config = join(dir, 'games/coin-dash/game.json');
  const g = JSON.parse(readFileSync(config, 'utf8'));
  writeFileSync(config, JSON.stringify({ ...g, room: { host: 'browser' } }));
  const result = run(['build'], dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /snapshot \d+ B \(cap 16384 B\), checkpoint \d+ B \(cap 65536 B\)/);
  writeFileSync(config, JSON.stringify({ ...g, room: { host: 'server' } }));
  assert.equal(run(['build'], dir).status, 0);
  writeFileSync(file, source.replace("for (const spot of world.map.spots('coins')) world.spawn('coin', spot, {});", "for (let i = 0; i < 420; i += 1) world.spawn('coin', { x: 8, y: 8, z: 0 }, {});"));
  writeFileSync(config, JSON.stringify({ ...g, players: { ...g.players, max: 17 }, room: { host: 'browser' } }));
  const largeRoom = run(['build'], dir);
  assert.notEqual(largeRoom.status, 0);
  assert.match(largeRoom.stdout + largeRoom.stderr, /snapshot \d+ B \(cap 16384 B\), checkpoint \d+ B \(cap 131072 B\)/);
  const payload = JSON.stringify('a'.repeat(4096));
  writeFileSync(file, source.replace('events: { take:', 'events: { later: { text: f.text(4096) }, take:').replace('roundStart(world) {', `roundStart(world) { for (let i = 0; i < 20; i += 1) world.after(1000, 'later', { text: ${payload} });`));
  writeFileSync(config, JSON.stringify({ ...g, room: { host: 'browser' } }));
  const checkpoint = run(['build'], dir);
  assert.notEqual(checkpoint.status, 0);
  const sizes = (checkpoint.stdout + checkpoint.stderr).match(/snapshot (\d+) B \(cap 16384 B\), checkpoint (\d+) B \(cap 65536 B\)/);
  assert.ok(sizes, checkpoint.stdout + checkpoint.stderr);
  assert.ok(Number(sizes[1]) < 16384 && Number(sizes[2]) > 65536, 'checkpoint growth is measured independently of snapshots');
});

for (const kind of ['state', 'ev']) test(`browser build reports the measured ${kind} cap and server alternative`, async () => {
  const { prepareRules } = await import('../lib/rules-build.mjs');
  const { writeGame } = await import('./rules-kit.mjs');
  const { source } = await import('./rules-feature-kit.mjs');
  const payload = JSON.stringify(Array(1024).fill(4000000000));
  const rules = `import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 }, move: defineMove({ pawn() {} }),
  shapes: { effects: { huge: { text: f.text(4096) } } },
  shared: { big: f.list(f.u32(), 1024), bigger: f.list(f.u32(), 1024) },
  entities: { pawn: { player: true, body: { shape: 'circle', radius: 0.2, maxSpeed: 1 },
    tick(world, self) { ${kind === 'ev' ? `world.emit('huge', self.pos, { text: ${JSON.stringify('x'.repeat(4096))} });` : ''} } } },
  room: { join() { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; },
    start(world) { ${kind === 'state' ? `world.shared.big = ${payload}; world.shared.bigger = ${payload};` : ''} } }
});`;
  const dir = writeGame(scratch, `cap-${kind}`, { rules });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  const g = { id: `cap-${kind}`, dir, players: { max: 4 }, room: { host: 'browser' } };
  const esbuild = await esbuildOf();
  await assert.rejects(prepareRules(esbuild, scratch, g), new RegExp(`${kind} \\d+ B \\(cap ${kind === 'state' ? 8192 : 4096} B; over by \\d+ B\\).*room.host: server`));
  const warnings = [];
  await prepareRules(esbuild, scratch, { ...g, room: { host: 'server' } }, { log: m => warnings.push(m) });
  assert.ok(warnings.some(m => m.includes(`${kind} `) && m.includes('cap')));
});

test('smoke measurement includes round, roster, shared state and event sizes and rates', async () => {
  const { smokeRun } = await import('../lib/rules-build.mjs');
  const frames = ['round', 'roster', 'state', 'ev'];
  const H = { createHost({ send }) { return { tick: 1, core: { stats: {} }, frame() {}, stop() {}, facts: () => ({}), save: () => new TextEncoder().encode('{}'), tickNow() { for (const t of frames) send({ t, d: 'x'.repeat(9000) }); } }; } };
  const stats = smokeRun(H, { settings: { tickHz: 60 } }, 'measure', { timer: () => 0 });
  for (const t of frames) { assert.ok(stats.frameBytes[t] > 9000); assert.equal(stats.frameRates[t], 60); }
});


test('a rules build publishes code and assets only after the development barrier', async () => {
  const dir = studio('publish-barrier');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  await buildSite(dir);
  const rulesPath = join(dir, 'games/coin-dash/src/rules.ts');
  const oldCode = read(dir, 'site/src/rules/coin-dash.mjs');
  const oldCatalogue = read(dir, 'site/dist/games.json');
  const original = readFileSync(rulesPath, 'utf8');
  writeFileSync(rulesPath, original.replace('self.score += 1;', 'self.score += 2;'));
  let calls = 0;
  await buildSite(dir, { only: 'coin-dash', beforePublish: async () => {
    calls++;
    assert.equal(read(dir, 'site/src/rules/coin-dash.mjs'), oldCode);
    assert.equal(read(dir, 'site/dist/games.json'), oldCatalogue);
  } });
  assert.equal(calls, 1);
  assert.notEqual(read(dir, 'site/src/rules/coin-dash.mjs'), oldCode);
  assert.notEqual(read(dir, 'site/dist/games.json'), oldCatalogue);
  writeFileSync(rulesPath, 'invalid rules');
  await assert.rejects(buildSite(dir, { beforePublish: async () => { calls++; } }));
  assert.equal(calls, 1, 'a rejected build leaves the running Worker alone');
});

test('rules HTML names the built view; a source URL fails before a browser opens', async () => {
  const dir = studio('html-entry');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  const game = listGames(dir).find((g) => g.id === 'coin-dash');
  writeFileSync(join(game.dir, 'index.html'), '<canvas></canvas><script type="module" src="/src/view.ts"></script>');
  await assert.rejects(buildGameFiles(await esbuildOf(), dir, game, join(dir, 'bad-html')), /index\.html: load the built view.*\.\/assets\/main\.js.*not \/src\/view\.ts/);
});

// A successful bundle alone must not be reported as a multiplayer game.
test('build refuses an unconnected game and preserves the prior site', () => {
  const dir = studio('neither');
  browserRulesGame(dir, 'plain');
  assert.equal(run(['build'], dir).status, 0);
  const previous = read(dir, 'site/dist/games.json');
  const manifest = JSON.parse(read(dir, 'games/plain/game.json'));
  delete manifest.netplay; delete manifest.room;
  writeFileSync(join(dir, 'games/plain/game.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'games/plain/src/main.ts'), 'document.body.textContent = "No room";');
  const r = run(['build'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /games use rules plus view/);
  assert.equal(read(dir, 'site/dist/games.json'), previous);
});

test('an injected port toolkit alone does not turn a static page into a netplay game', async () => {
  const dir = studio('static-neither');
  const game = join(dir, 'games', 'plain');
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'index.html'), '<h1>No room</h1><script src="./homie-port.js"></script>');
  const g = { id: 'plain', dir: game, build: { mode: 'static' } };
  const esbuild = await esbuildOf(dir);
  await assert.rejects(buildGameFiles(esbuild, dir, g, join(dir, 'out')), /games use rules plus view/);
  await assert.rejects(buildGameFiles(esbuild, dir, { ...g, netplay: { v: 1 } }, join(dir, 'out')), /games use rules plus view/);
});
