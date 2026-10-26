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

test('a game that does not build fails the command and leaves site/dist exactly as it was', () => {
  const dir = studio('fails');
  const first = run(['build'], dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const dist = join(dir, 'site', 'dist');
  const before = snapshot(dist);
  assert.deepEqual(json(join(dist, 'games.json')).games.map((g) => g.id), ['alpha', 'beta']);

  edit(join(dir, 'games/beta/src/main.ts'), (t) => `${t}\nimport './not-there';\n`);
  const broken = run(['build'], dir);
  assert.equal(broken.status, 1, 'a failed game build is a failed command');
  assert.equal(out(broken).ok, false);
  assert.match(out(broken).why, /games\/beta did not build: Could not resolve "\.\/not-there"/);
  assert.deepEqual(snapshot(dist), before, 'site/dist is what it was: both games, the catalogue, every byte');
  // What it was before this change: the site emptied first, alpha rebuilt, no beta and no games.json left behind.
  assert.ok(existsSync(join(dist, 'games.json')) && existsSync(join(dist, 'games', 'beta', 'index.html')));
  assert.deepEqual(readdirSync(join(dir, '.studio', 'build')), [], 'the folder it was building in is gone');

  // A one-game build that fails leaves the site alone too.
  const one = run(['build', 'beta'], dir);
  assert.equal(one.status, 1);
  assert.deepEqual(snapshot(dist), before);

  // A first build that fails makes no half site at all.
  const fresh = studio('fails-first', ['alpha']);
  edit(join(fresh, 'games/alpha/src/main.ts'), (t) => `${t}\nimport './not-there';\n`);
  assert.equal(run(['build'], fresh).status, 1);
  assert.ok(!existsSync(join(fresh, 'site', 'dist', 'games.json')), 'no catalogue for a site that was never built');
});

test('a build is put in place without removing site/dist or its folders; an unchanged file is not touched', () => {
  const dir = studio('swap');
  assert.equal(run(['build'], dir).status, 0);
  const dist = join(dir, 'site', 'dist');
  const alpha = join(dist, 'games', 'alpha');
  const bundle = join(alpha, bundleOf(alpha));
  const was = { dist: statSync(dist).ino, alpha: statSync(alpha).ino, bundle: statSync(bundle).ino, mtime: statSync(bundle).mtimeMs };
  writeFileSync(join(dist, 'left-over.txt'), 'from an older build');
  edit(join(dir, 'games/beta/src/main.ts'), (t) => `${t}\nconsole.log('beta changed');\n`);
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  // A server started in site/dist/games/alpha is still standing in the folder the build filled.
  assert.equal(statSync(dist).ino, was.dist, 'site/dist is the same folder');
  assert.equal(statSync(alpha).ino, was.alpha, 'so is a game\'s folder');
  assert.deepEqual([statSync(bundle).ino, statSync(bundle).mtimeMs], [was.bundle, was.mtime], 'alpha did not change: its bundle was not touched');
  assert.ok(!existsSync(join(dist, 'left-over.txt')), 'what the new build does not have is taken away');
  assert.ok(b.swapped.same > 0 && b.swapped.written > 0 && b.swapped.removed >= 1, JSON.stringify(b.swapped));
  // A game that is gone leaves the site, folder and all.
  rmSync(join(dir, 'games', 'beta'), { recursive: true });
  assert.equal(run(['build'], dir).status, 0);
  assert.ok(!existsSync(join(dist, 'games', 'beta')));
  assert.deepEqual(json(join(dist, 'games.json')).games.map((g) => g.id), ['alpha']);

  // The swap itself: a folder where the new build has a file, and a file where it has a folder.
  const root = join(scratch, 'swap-unit');
  const live = join(root, 'site', 'dist');
  write(live, 'a/old.txt', 'old');
  write(live, 'b', 'a file');
  write(live, 'same.txt', 'same');
  const stage = openStage(root);
  write(stage, 'a', 'now a file');
  write(stage, 'b/new.txt', 'now a folder');
  write(stage, 'same.txt', 'same');
  write(stage, 'games.json', '{}');
  assert.deepEqual(swapIn(stage, live), { written: 3, same: 1, removed: 0 });
  const text = Object.fromEntries(Object.entries(snapshot(live)).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]));
  assert.deepEqual(text, { a: 'now a file', 'b/new.txt': 'now a folder', 'games.json': '{}', 'same.txt': 'same' });
});

test('a bundle named by its content, a page that names it, chunks for import(), and the old address still loads the game', async () => {
  const dir = studio('chunks', ['alpha']);
  write(dir, 'games/alpha/src/later.ts', 'export const later = (n: number): string => `level-${n}-loaded-later-mark`;\n');
  edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nsetTimeout(() => { void import('./later').then((m) => console.log(m.later(2))); }, 600_000);\n`);
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  const built = join(dir, 'site', 'dist', 'games', 'alpha');
  const named = json(join(built, 'bundle.json'));
  assert.match(named.bundle, /^assets\/main-[A-Z0-9]{8}\.js$/);
  assert.equal(named.chunks.length, 1);
  assert.match(named.chunks[0], /^assets\/chunk-[A-Z0-9]{8}\.js$/);
  assert.equal(bundleOf(built), named.bundle);
  assert.deepEqual([b.games[0].bundle, b.games[0].chunks], [named.bundle, 1]);
  // The game's own index.html says ./assets/main.js; the built one names the hashed file.
  assert.match(readFileSync(join(dir, 'games/alpha/index.html'), 'utf8'), /src="\.\/assets\/main\.js"/);
  const page = readFileSync(join(built, 'index.html'), 'utf8');
  assert.ok(page.includes(`src="./${named.bundle}"`), page);
  assert.doesNotMatch(page, /assets\/main\.js/);
  // The code that loads later is in the chunk, not in the bundle, and the bundle asks for it beside itself.
  const main = readFileSync(join(built, named.bundle), 'utf8');
  assert.match(readFileSync(join(built, named.chunks[0]), 'utf8'), /loaded-later-mark/);
  assert.doesNotMatch(main, /loaded-later-mark/);
  assert.ok(main.includes(`import("./${named.chunks[0].slice('assets/'.length)}")`), 'a relative import: it resolves wherever the game is served');
  assert.match(main, /homie-net/, 'the netplay helper is still in the bundle');
  // The address every tool knew: one line that imports the real bundle.
  assert.equal(readFileSync(join(built, 'assets', 'main.js'), 'utf8'), `import"./${named.bundle.slice('assets/'.length)}";\n`);

  // The Worker serves the page, the bundle and the chunk from the game's frame, to its opaque origin.
  const site = await siteOf(dir);
  const frame = await (await site('/alpha/__game/')).text();
  assert.ok(frame.includes(`src="./${named.bundle}"`), 'the frame loads the hashed bundle');
  assert.match(frame, /HOMIE_NET/);
  for (const f of [named.bundle, named.chunks[0], 'assets/main.js']) {
    const res = await site(`/alpha/__game/${f}`);
    assert.equal(res.status, 200, f);
    assert.equal(res.headers.get('access-control-allow-origin'), '*', `${f}: a module script from the frame is a CORS request`);
  }

  // Another build of the same source is the same name, with or without its source map kept (build --maps): the map
  // goes to .studio/maps/, and the bundle and its chunk are the very files a plain build ships.
  assert.equal(json(join(built, 'bundle.json')).bundle, out(run(['build'], dir)).games[0].bundle);
  const mapped = out(run(['build', '--maps'], dir));
  assert.deepEqual(json(join(built, 'bundle.json')), named);
  assert.equal(mapped.games[0].changed, 'unchanged');
  assert.equal(readFileSync(join(built, named.bundle), 'utf8'), main);
  assert.deepEqual(readdirSync(join(built, 'assets')).filter((f) => f.endsWith('.map')), []);
  assert.ok(existsSync(join(dir, '.studio', 'maps', 'alpha', 'main.js.map')));
  edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nconsole.log('a change');\n`);
  const next = out(run(['build'], dir)).games[0].bundle;
  assert.notEqual(next, named.bundle);
  assert.ok(existsSync(join(built, next)) && !existsSync(join(built, named.bundle)));
  assert.ok(readFileSync(join(built, 'index.html'), 'utf8').includes(`src="./${next}"`));
});

test('each game is changed or unchanged with a build hash; build.json keeps it and the live site\'s manifest says it', async () => {
  const dir = studio('hashes');
  const a = out(run(['build'], dir));
  assert.deepEqual(a.games.map((g) => g.changed), ['new', 'new']);
  for (const g of a.games) assert.match(g.hash, /^[0-9a-f]{16}$/);
  const b = out(run(['build'], dir));
  assert.deepEqual(b.games.map((g) => [g.changed, g.hash]), a.games.map((g) => ['unchanged', g.hash]), 'the same source is the same build');
  edit(join(dir, 'games/beta/src/main.ts'), (t) => `${t}\nconsole.log('beta moved on');\n`);
  const said = plain(['build'], dir);
  assert.equal(said.status, 0, said.stdout + said.stderr);
  assert.match(said.stdout, /^ {2}alpha: unchanged, build [0-9a-f]{16} \(assets\/main-[A-Z0-9]{8}\.js\)$/m);
  assert.match(said.stdout, /^ {2}beta: changed, build [0-9a-f]{16} \(assets\/main-[A-Z0-9]{8}\.js\)$/m);
  const dist = join(dir, 'site', 'dist');
  const kept = json(join(dist, '_site', 'build.json'));
  assert.equal(kept.v, 1);
  assert.deepEqual(Object.keys(kept.games), ['alpha', 'beta']);
  assert.equal(kept.games.alpha.hash, a.games[0].hash);
  assert.notEqual(kept.games.beta.hash, a.games[1].hash);
  assert.deepEqual([kept.games.alpha.changed, kept.games.beta.changed], ['unchanged', 'changed']);
  assert.equal(kept.games.beta.hash, gameDigest(join(dist, 'games', 'beta')), 'the digest of the game\'s built files');
  assert.equal(kept.games.beta.bundle, bundleOf(join(dist, 'games', 'beta')));
  // A one-game build says the other game is as it was.
  edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nconsole.log('alpha too');\n`);
  const one = out(run(['build', 'alpha'], dir));
  assert.deepEqual(one.games.map((g) => [g.id, g.changed]), [['alpha', 'changed']]);
  assert.equal(one.builds.beta.changed, 'unchanged');
  assert.equal(one.builds.beta.hash, kept.games.beta.hash);
  // The live site: each game's build in the manifest the directory (and a script) reads.
  const site = await siteOf(dir);
  const manifest = await (await site('/.well-known/homie-studio.json')).json();
  const now = json(join(dist, '_site', 'build.json'));
  for (const g of manifest.games) {
    assert.equal(g.build.hash, now.games[g.id].hash, `${g.id}: the live hash is the built one`);
    assert.equal(g.build.bundle, `https://owls.example/games/${g.id}/${now.games[g.id].bundle}`);
  }
});

test('rules builds always type-check the view and preserve the last good build on a type error', () => {
  const dir = studio('types', ['alpha'], { typescript: true });
  const first = run(['build', '--types'], dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const dist = join(dir, 'site', 'dist'), before = snapshot(dist);
  edit(join(dir, 'games/alpha/src/main.ts'), t => `${t}\nexport const hitPoints: number = 'full';\n`);
  for (const args of [['build'], ['build', '--types']]) {
    const bad = run(args, dir);
    assert.equal(bad.status, 1);
    assert.match(out(bad).why, /Type 'string' is not assignable to type 'number'/);
    assert.deepEqual(snapshot(dist), before, 'failed checks never replace the built site');
  }
  edit(join(dir, 'games/alpha/src/main.ts'), t => t.replace("hitPoints: number = 'full'", 'hitPoints: number = 3'));
  const good = run(['build', '--types'], dir);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(json(join(PKG, 'package.json')).dependencies.typescript, '5.9.3');
});

test('license metadata retains SPDX ids and rejects executable credit URLs', () => {
  assert.equal(licenseOf(undefined), null);
  assert.deepEqual(licenseOf('MIT'), { spdx: 'MIT' });
  assert.equal(licenseLabel('MIT'), 'MIT');
  assert.deepEqual(basedOnRow({ name: 'Owl Run', page: 'javascript:alert(1)' }), { name: 'Owl Run', studio: null, page: null });
  assert.equal(basedOnRow({ studio: 'Nobody' }), null);
});

