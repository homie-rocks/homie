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

test('remix was retired: old game.json settings build with one note, no source is built or served (410), and a former remix keeps its credit', async () => {
  // A game's licence is the SPDX id it names, and nothing else: the three old words were about remixing.
  assert.equal(licenseOf(undefined), null);
  assert.deepEqual(licenseOf('MIT'), { spdx: 'MIT' });
  assert.deepEqual(licenseOf({ kind: 'remix-freely', spdx: 'CC-BY-4.0' }), { spdx: 'CC-BY-4.0' }, 'the SPDX id beside an old word stays');
  for (const word of ['remix-with-credit', 'remix-freely', 'no-remix', { kind: 'no-remix' }, { kind: 'remix-with-credit', spdx: null }, 42, 'not a licence!']) assert.equal(licenseOf(word), null, JSON.stringify(word));
  assert.equal(licenseLabel('MIT'), 'MIT');
  assert.equal(licenseLabel('no-remix'), null);
  assert.deepEqual(retiredKeys({}), []);
  assert.deepEqual(retiredKeys({ license: 'MIT', remixOf: { name: 'Owl Run' }, landing: { pitch: 'x' } }), [], 'a licence it names and a credit it owes are not retired');
  assert.deepEqual(retiredKeys({ remix: false, share: { source: false }, license: 'no-remix', landing: { make: true } }), ['"remix"', '"share"', '"license": "no-remix"', 'landing.make']);
  assert.deepEqual(retiredKeys({ license: { kind: 'remix-freely', spdx: 'MIT' } }), ['"license": "remix-freely"']);
  // The credit: plain text, an https page (or the page its old source address names), and never a remix affordance.
  assert.deepEqual(basedOnRow({ name: 'Owl Run', studio: 'Night Owl Games', source: 'https://owls.example/games/owl-run/source.json' }), { name: 'Owl Run', studio: 'Night Owl Games', page: 'https://owls.example/owl-run/' });
  assert.deepEqual(basedOnRow({ name: 'Owl Run', page: 'javascript:alert(1)' }), { name: 'Owl Run', studio: null, page: null });
  assert.equal(basedOnRow({ studio: 'Nobody' }), null);
  assert.equal(basedOnCredit({ name: 'Owl Run', studio: 'Night Owl Games' }), 'Based on Owl Run by Night Owl Games');

  // A studio from the field: every setting remix ever had, in four games, one of them a remix of another studio's.
  const dir = studio('retired', ['alpha', 'beta', 'gamma', 'delta']);
  editJson(join(dir, 'games/beta/game.json'), (g) => { g.remix = false; });
  editJson(join(dir, 'games/gamma/game.json'), (g) => { g.share = { source: false }; g.license = 'no-remix'; g.remix = 'no'; });
  editJson(join(dir, 'games/delta/game.json'), (g) => {
    g.remix = true; g.landing.make = true; g.license = { kind: 'remix-with-credit', spdx: 'MIT' };
    g.remixOf = { credit: 'Remix of Owl Run by Night Owl Games', name: 'Owl Run', studio: 'Night Owl Games', page: 'https://owls.example/owl-run/', source: 'https://owls.example/games/owl-run/source.json', id: 'owl-run', license: { kind: 'remix-with-credit', spdx: null } };
  });
  const said = plain(['build'], dir);
  assert.equal(said.status, 0, said.stdout + said.stderr);
  // One plain note for the whole build: not one a game, not one a key.
  const notes = (said.stdout + said.stderr).split('\n').filter((l) => /retired/i.test(l));
  assert.equal(notes.length, 1, notes.join('\n'));
  assert.match(notes[0], /^Note: Remix was retired, and games now build on each other through parts/);
  assert.match(notes[0], /games\/beta\/game\.json "remix"; games\/delta\/game\.json "remix", "license": "remix-with-credit", landing\.make; games\/gamma\/game\.json "remix", "share", "license": "no-remix"\./);
  assert.doesNotMatch(notes[0], /alpha|remixOf/, 'a game with none of them, and the credit key, are not named');
  assert.doesNotMatch(said.stdout, /source: (shared|closed)|Make a game like this/);
  const built = out(run(['build'], dir));
  assert.equal(built.ok, true);
  assert.match(built.retired, /^Remix was retired/);
  assert.equal(out(run(['build'], studio('retired-none', ['alpha']))).retired, undefined, 'a studio with none of the old settings is told nothing');

  const dist = join(dir, 'site', 'dist');
  const rows = Object.fromEntries(json(join(dist, 'games.json')).games.map((g) => [g.id, g]));
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) {
    assert.ok(!existsSync(join(dist, `games/${id}/source.json`)), `${id}: no source in the build`);
    assert.ok(!existsSync(join(dist, `games/${id}/assets.json`)), `${id}: no asset addresses in the build`);
    for (const k of ['remix', 'remixOf']) assert.equal(rows[id][k], undefined, `${id}: no ${k} in the catalogue`);
    for (const k of ['source', 'make']) assert.equal(rows[id].landing[k], undefined, `${id}: no landing.${k} in the catalogue`);
  }
  assert.deepEqual([rows.alpha.license, rows.beta.license, rows.gamma.license, rows.delta.license], [undefined, undefined, undefined, { spdx: 'MIT' }]);
  assert.deepEqual(rows.delta.basedOn, { name: 'Owl Run', studio: 'Night Owl Games', page: 'https://owls.example/owl-run/' });
  assert.deepEqual(Object.keys(json(join(dist, '_site', 'build.json')).games.beta).sort(), ['bundle', 'changed', 'hash']);

  // The old address of a game's source: gone, on purpose, with where to go. The same for any id, GET or HEAD.
  const site = await siteOf(dir);
  for (const id of ['alpha', 'beta', 'delta', 'no-such-game']) {
    const res = await site(`/games/${id}/source.json`);
    assert.equal(res.status, 410, id);
    assert.deepEqual(await res.json(), { retired: 'remix', see: '/parts/' });
  }
  assert.equal((await site('/games/alpha/source.json', { method: 'HEAD' })).status, 410);

  // No landing offers a game to be taken, or asks anyone to make "a game like this".
  const land = async (id) => (await site(`/${id}/`)).text();
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) {
    const html = await land(id);
    assert.match(html, new RegExp(`Who made Game ${id}`), 'the landing is there');
    assert.doesNotMatch(html, /Make a game like this|See the source|source\.json|\?remix=|Open to remix|Remix of|remix-of/, id);
  }
  // The former remix keeps its credit, as a credit: under its name and in its credits, linked to the original.
  const delta = await land('delta');
  assert.match(delta, /<p class="based-on">Based on <a href="https:\/\/owls\.example\/owl-run\/" rel="noopener">Owl Run<\/a> by Night Owl Games<\/p>/);
  assert.match(delta, /<div class="credit"><h3>Based on<\/h3><p><a href="https:\/\/owls\.example\/owl-run\/" rel="noopener">Owl Run<\/a> by Night Owl Games\.<\/p>/);
  assert.match(delta, /<p>Licence: MIT\.<\/p>/);
  assert.doesNotMatch(await land('alpha'), /Based on|Licence: /, 'a game that owes no credit and names no licence says neither');
  const credits = await creditsPage(json(join(dist, 'games.json')), rows.delta, [{ file: 'CREDITS.md', text: 'Thanks.' }], { origin: 'https://retired.example' }).text();
  assert.match(credits, /<p class="sec">Based on<\/p><p><a href="https:\/\/owls\.example\/owl-run\/" rel="noopener">Owl Run<\/a> by Night Owl Games<\/p>/);

  // What the directory reads: no remix, no source address, no lineage; the licence only where the game names one.
  const manifest = await (await site('/.well-known/homie-studio.json')).json();
  const m = Object.fromEntries(manifest.games.map((g) => [g.id, g]));
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) for (const k of ['remix', 'source', 'remixOf']) assert.ok(!(k in m[id]), `${id}: the manifest has no ${k}`);
  assert.deepEqual([m.alpha.license, m.delta.license], [undefined, { spdx: 'MIT' }]);
  // The command is refused in a sentence that points to parts, and makes nothing.
  const refused = run(['game', 'remix', 'https://owls.example/games/owl-run/source.json', '--id', 'mine'], dir);
  assert.equal(refused.status, 1);
  assert.match(out(refused).why, /^remix was retired: a game is no longer handed over whole.*Games build on each other through parts.*homie-studio parts find/);
  assert.ok(!existsSync(join(dir, 'games', 'mine')));
  assert.match(plain(['game', 'remix'], dir).stderr + plain(['game', 'remix'], dir).stdout, /remix was retired/);
  assert.doesNotMatch(plain(['help'], dir).stdout, /remix/i, 'and the help does not offer it');
  // What an AI agent reads: no Remix section and no offer; the credit and the licence as facts.
  const llms = await (await site('/llms.txt')).text();
  assert.doesNotMatch(llms, /remix|source\.json/i);
  assert.match(llms, /\[Game delta\]\(\S+\/delta\/\): .* Based on Owl Run by Night Owl Games\. .* Licence: MIT\.$/m);
});

