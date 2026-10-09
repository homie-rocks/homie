/**
 * @homie-rocks/studio: what `homie-studio build` promises a studio.
 *
 *   - a game that does not build fails the command (a non-zero exit) and leaves site/dist exactly as it was, never a
 *     site without that game for the next deploy to ship;
 *   - a finished build is put in place without removing site/dist or its folders: a file that did not change is not
 *     touched, and what the new build no longer has goes;
 *   - a game's bundle is named by its content, its built page names it, `await import()` becomes a chunk that the
 *     game's frame is served, and the address tools knew (assets/main.js) still loads the game;
 *   - every game's line says changed or unchanged and a build hash; site/dist/_site/build.json keeps it and the live
 *     site's manifest says the same hash;
 *   - `build --types` fails on a type error in a game's own files, with the studio's own TypeScript, and says how to
 *     get one when the studio has none (the toolkit does not depend on it);
 *   - remix was retired: a game.json that still carries its settings builds, with one note for the whole build; no
 *     game's source is built or served (410 at its old address); a game that was a remix keeps its credit;
 *   - studio.json `site.order` is the order of every list; a Home of the studio's own takes the generated hero;
 *   - the build says which hero files a landing wants, and what shape;
 *   - a game sets its own model budgets in game.json;
 *   - `preview <id>` serves one built game's files, across a rebuild.
 * Run: node --test packages/studio/test/build.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-build-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const plain = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')));
const editJson = (file, fn) => { const v = json(file); fn(v); writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`); };

/** A studio whose node_modules point at this package and the repo's esbuild, with the games named (Gem Rush each). */
function studio(name, games = ['alpha', 'beta'], { typescript = false } = {}) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  if (typescript) symlinkSync(join(REPO_NM, 'typescript'), join(dir, 'node_modules', 'typescript'));
  for (const id of games) assert.equal(run(['game', 'new', id, '--name', `Game ${id}`], dir).status, 0);
  return dir;
}

/** The studio Worker over a built site folder (no rooms playing). */
async function siteOf(dir) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      const type = p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      return new Response(readFileSync(f), { headers: { 'content-type': type } });
    },
  };
  const LOBBY = {
    idFromName: (n) => n,
    get: () => ({ fetch: async (u) => {
      const path = new URL(u).pathname;
      if (path === '/rooms') return new Response(JSON.stringify({ rooms: [] }));
      if (path === '/now') return new Response(JSON.stringify({ players: 0, rooms: 0, peak: { players: 0, room: 0 } }));
      return new Response(JSON.stringify({ room: 'pub-9', players: 0, max: 8 }));
    } }),
  };
  return (path, init = {}) => worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), { ASSETS, LOBBY, STUDIO_NAME: 'Night Owls' }, { waitUntil() {} });
}

/** Every file under a folder with its bytes, so "exactly as it was" is a comparison. */
function snapshot(dir, rel = '', acc = {}) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) snapshot(dir, r, acc); else acc[r] = readFileSync(join(dir, r)).toString('base64');
  }
  return acc;
}

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

test('build --types: a type error in a game stops the build; the studio\'s own TypeScript does the check', () => {
  const dir = studio('types', ['alpha'], { typescript: true });
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
  const none = studio('types-none', ['alpha']);
  const r = run(['build', '--types'], none);
  assert.equal(r.status, 1);
  assert.match(out(r).why, /this studio has none: run `npm install --save-dev typescript`/);
  assert.equal(run(['build'], none).status, 0);
  // The toolkit does not depend on it; a new studio asks for it itself.
  const pkg = json(join(PKG, 'package.json'));
  assert.equal(pkg.dependencies?.typescript, undefined);
  assert.equal(pkg.peerDependencies?.typescript, undefined);
  assert.match(json(join(none, 'package.json')).devDependencies.typescript, /^\d+\.\d+\.\d+$/, 'pinned exactly, in the studio\'s own devDependencies');
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

test('studio.json site.order is the order of every list; a Home of the studio\'s own takes the generated hero', async () => {
  const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const warned = [];
  assert.deepEqual(orderGames(games, ['c', 'nope', 'a', 'c'], (l) => warned.push(l)).map((g) => g.id), ['c', 'a', 'b', 'd'], 'named first, the rest by id');
  assert.match(warned.join('\n'), /site\.order names "nope", which is not one of this studio's games/);
  assert.deepEqual(orderGames(games, undefined).map((g) => g.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderGames(games, 'c').map((g) => g.id), ['a', 'b', 'c', 'd'], 'not a list: the order it always had');

  const dir = studio('order', ['glow', 'glow-two', 'zed']);
  // By id, the older game always came before the newer one.
  assert.deepEqual(out(run(['build'], dir)).catalogue, ['glow', 'glow-two', 'zed']);
  editJson(join(dir, 'studio.json'), (s) => { s.site = { ...(s.site ?? {}), order: ['glow-two', 'zed'] }; });
  assert.deepEqual(out(run(['build'], dir)).catalogue, ['glow-two', 'zed', 'glow']);
  const site = await siteOf(dir);
  const at = (html, id) => html.indexOf(`href="/${id}/"`);
  for (const path of ['/games/', '/']) {
    const html = await (await site(path)).text();
    assert.ok(at(html, 'glow-two') > 0 && at(html, 'glow-two') < at(html, 'zed') && at(html, 'zed') < at(html, 'glow'), `${path} lists the games in the studio's order`);
  }
  assert.deepEqual((await (await site('/.well-known/homie-studio.json')).json()).games.map((g) => g.id), ['glow-two', 'zed', 'glow']);
  assert.deepEqual((await (await site('/api/games')).json()).games.map((g) => g.id), ['glow-two', 'zed', 'glow']);
  const home = await (await site('/')).text();
  assert.match(home, /<h1 class="title[^"]*" id="hero-title">Game glow-two<\/h1>/, 'with no featured game, Home\'s hero follows the order');

  // A Home of the studio's own: the generated hero by a marker, for the featured game or the one it names.
  write(dir, 'site/pages/index.html', '<!doctype html><html><head><!-- homie:style --></head><body><!-- homie:header --><main><!-- homie:home-hero --><p id="mine">ours</p><!-- homie:home-hero zed --><!-- homie:home-hero nope --></main><!-- homie:footer --><!-- homie:script --></body></html>');
  assert.equal(run(['build'], dir).status, 0);
  const own = await (await (await siteOf(dir))('/')).text();
  const heroes = [...own.matchAll(/<section class="hero home" aria-labelledby="hero-title">[\s\S]*?<h1 class="title[^"]*" id="hero-title">([^<]+)<\/h1>[\s\S]*?href="\/([a-z-]+)\/play" data-play/g)].map((x) => [x[1], x[2]]);
  assert.deepEqual(heroes, [['Game glow-two', 'glow-two'], ['Game zed', 'zed']], 'the featured game\'s hero, then the named one; an unknown game leaves nothing');
  assert.match(own, /<p id="mine">ours<\/p>/);
  assert.doesNotMatch(own, /homie:home-hero/);
});

test('the build says which hero files a landing wants, and what shape', () => {
  const dir = studio('hero', ['alpha']);
  const said = plain(['build'], dir).stdout;
  assert.match(said, /^Landing \/alpha\/: hero from the studio's colours \(it has no picture or footage yet\)/m);
  assert.match(said, /give it one: games\/alpha\/hero\/wide\.jpg \(16:9, 1280×720 or larger\) and games\/alpha\/hero\/tall\.jpg \(9:16, 720×1280, for an upright phone\); footage beside them as hero\/wide\.mp4 and hero\/tall\.mp4/);
  // Those names are the ones the landing reads, and where the site serves them.
  write(dir, 'games/alpha/hero/wide.jpg', 'wide');
  write(dir, 'games/alpha/hero/tall.jpg', 'tall');
  write(dir, 'games/alpha/hero/wide.mp4', 'film');
  const again = plain(['build'], dir).stdout;
  assert.match(again, /^Landing \/alpha\/: hero from its footage/m);
  assert.doesNotMatch(again, /give it one/);
  assert.deepEqual(json(join(dir, 'site/dist/games.json')).games[0].landing.hero, { wide: '/games/alpha/_landing/wide.mp4', wideImage: '/games/alpha/_landing/wide.jpg', tallImage: '/games/alpha/_landing/tall.jpg' });
});

test('a game sets its own model budgets in game.json (assets.budgets), and createModels() reads them', async () => {
  const warned = [];
  const log = (l) => warned.push(l);
  assert.equal(modelBudgetsOf({ id: 'x' }, log), null);
  assert.equal(modelBudgetsOf({ id: 'x', assets: 'library' }, log), null, 'a starter\'s note is not a budget');
  assert.deepEqual(modelBudgetsOf({ id: 'x', assets: { budgets: { triangles: 8000, bytes: 1500000 } } }, log), { triangles: 8000, bytes: 1500000 });
  assert.deepEqual(warned, []);
  assert.deepEqual(modelBudgetsOf({ id: 'x', assets: { budgets: { triangles: 'many', bytes: 2048, kb: 5 } } }, log), { bytes: 2048 });
  assert.match(warned.join('\n'), /assets\.budgets\.triangles is a whole number above zero/);
  assert.match(warned.join('\n'), /assets\.budgets\.kb is not one of triangles, bytes, texturePx, materials/);

  // The runtime half: the same loader, bundled the way `build` bundles a game, with and without a game's budgets.
  const esbuild = await import('esbuild');
  const box = Buffer.from(await placeholderGlb([1, 2, 3]));   // twelve triangles
  const real = { fetch: globalThis.fetch, location: globalThis.location };
  test.after(() => { globalThis.fetch = real.fetch; globalThis.location = real.location; });
  globalThis.location = new URL('https://studio.test/games/x/');
  globalThis.fetch = async () => new Response(box, { headers: { 'content-length': String(box.length) } });
  const warningsWith = async (name, define) => {
    const file = join(scratch, `models-${name}.mjs`);
    await esbuild.build({ entryPoints: [join(PKG, 'assets', 'assets.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: file, logLevel: 'silent', absWorkingDir: PKG, ...(define ? { define: { __HOMIE_MODEL_BUDGETS__: JSON.stringify(define) } } : {}) });
    const { createModels } = await import(pathToFileURL(file));
    const said = [];
    const model = await createModels({ dev: true, onWarn: (t) => said.push(t) }).load('./models/box.glb');
    assert.equal(model.triangles, 12);
    return said.join('\n');
  };
  assert.doesNotMatch(await warningsWith('default', null), /triangles|KB/, 'a box is inside the prop budget; no constant in the bundle is fine');
  const tight = await warningsWith('tight', { triangles: 5, bytes: 100 });
  assert.match(tight, /12 triangles \(its budget is 5\)/);
  assert.match(tight, /KB \(its budget is 1 KB\)/);
  assert.doesNotMatch(await warningsWith('roomy', { triangles: 8000, bytes: 1500000 }), /triangles|KB/);
  globalThis.fetch = real.fetch;
  globalThis.location = real.location;
});

test('shoot --preview: frames of the built game from the light preview server, no site running, named by the build\'s own hash and bundle', { skip: findChrome() ? false : 'no Chrome on this machine', timeout: 240_000 }, async () => {
  // ACROSS THE SEAM: the real build (its report and its hashed bundle), the real preview server, and shoot.
  const dir = studio('shoot-preview', ['alpha']);
  const { shoot } = await import('../lib/shoot.mjs');
  const frames = join(dir, '.studio', 'shoot', 'alpha');
  const none = await shoot({ preview: true, root: dir, game: 'alpha', frames: 3, out: frames });
  assert.equal(none.ok, false);
  assert.match(none.why, /no build of alpha in site\/dist/, 'nothing built: said as the preview says it');
  assert.equal(none.command, 'shoot');
  assert.equal(run(['build'], dir).status, 0);
  const built = join(dir, 'site', 'dist', 'games', 'alpha');
  const r = await shoot({ preview: true, root: dir, game: 'alpha', frames: 3, fps: 30, out: frames, timeoutMs: 200_000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.frames, 3);
  assert.match(r.play, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the game\'s own page on this computer: no Wrangler, no play page');
  assert.deepEqual([r.smoke.verdict, r.smoke.ok], ['NOT RUN', null]);
  assert.match(r.smoke.why, /no rooms .*needs the whole site \(homie-studio dev, then --url\)/);
  assert.equal(r.ready.ready, null, 'no loading cover on this page: not claimed either way');
  // The frames are of THIS build: the hash the build reported, and the hashed bundle the page really loaded.
  assert.deepEqual(r.build, { hash: json(join(dir, 'site', 'dist', '_site', 'build.json')).games.alpha.hash, bundle: bundleOf(built), loaded: true });
  assert.equal(r.build.hash, gameDigest(built));
  assert.match(r.build.bundle, /^assets\/main-[A-Z0-9]+\.js$/);
  const rec = json(join(frames, 'shoot.json'));
  assert.equal(rec.rows.length, 3);
  for (const row of rec.rows) assert.ok(existsSync(join(frames, row.file)), row.file);
  for (let i = 1; i < rec.rows.length; i++) assert.ok(Math.abs((rec.rows[i].clockMs - rec.rows[i - 1].clockMs) - 1000 / 30) < 0.01, 'one step of the game\'s clock a frame');
  assert.equal(rec.rows[0].phase, 'live', 'the starter\'s port probe is read in the page itself (it is the game\'s frame here): alone, its round runs');
  // And the server it started is gone with it.
  await assert.rejects(fetch(r.play, { signal: AbortSignal.timeout(3000) }));
});

test('preview <id>: one built game\'s files and nothing else, across a rebuild', async () => {
  const dir = studio('preview', ['alpha']);
  const none = await previewServer(dir, 'alpha', { port: 0 });
  assert.equal(none.ok, false);
  assert.match(none.why, /no build of alpha in site\/dist: run .*homie-studio build alpha/);
  assert.equal((await previewServer(dir, '../x', { port: 0 })).ok, false);
  assert.equal(run(['build'], dir).status, 0);
  const p = await previewServer(dir, 'alpha', { port: 0 });
  assert.equal(p.ok, true, JSON.stringify(p.why));
  try {
    assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const built = join(dir, 'site', 'dist', 'games', 'alpha');
    const first = bundleOf(built);
    const page = await fetch(p.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const html = await page.text();
    assert.ok(html.includes(`src="./${first}"`));
    assert.doesNotMatch(html, /HOMIE_NET/, 'the page as built: no room to join');
    const js = await fetch(new URL(first, p.url));
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await js.text(), readFileSync(join(built, first), 'utf8'));
    // Only that game's files: nothing above its folder, by any spelling.
    for (const path of ['/../../games.json', '/%2e%2e/%2e%2e/games.json', '/..%2f..%2fgames.json', '/nope.js']) {
      const res = await fetch(`${p.url.slice(0, -1)}${path}`);
      assert.equal(res.status, 404, path);
      await res.arrayBuffer();
    }
    assert.equal((await fetch(p.url, { method: 'POST' })).status, 405);
    // A build while it runs: the same server, the new game, no restart.
    edit(join(dir, 'games/alpha/src/main.ts'), (t) => `${t}\nconsole.log('rebuilt under a running preview');\n`);
    assert.equal(run(['build'], dir).status, 0);
    const next = bundleOf(built);
    assert.notEqual(next, first);
    assert.ok((await (await fetch(p.url)).text()).includes(`src="./${next}"`));
    assert.match(await (await fetch(new URL(next, p.url))).text(), /rebuilt under a running preview/);
  } finally { p.server.closeAllConnections?.(); p.server.close(); }
});

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
