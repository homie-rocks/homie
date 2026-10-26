/**
 * The gem-rush-3d starter (starters/gem-rush-3d): Gem Rush drawn in three.js with free CC0 models from the Homie starter
 * library, every one loaded through @homie-rocks/studio/assets. The repository holds no model file: the starter's
 * assets/manifest.json names each library item, and `game new` fetches them. Offline, no Chrome:
 *   - the starter is text only; its manifest names a library item, a SHA-256 and a CC0 licence for every model the game
 *     draws; RIGHTS.md and credits.json are there; style.json carries the palette, fonts, light and camera;
 *   - `game new <id> --from gem-rush-3d` adds three.js to a studio's devDependencies (exact version), fetches each model
 *     from a starter library (HOMIE_LIBRARY: here a tiny one this test writes, its models grey boxes), checks each by
 *     SHA-256 and the loader's own file rules, and says which are missing when the library is not there;
 *   - its bundle builds the way `build` builds a game (lib/build.mjs buildGameFiles), with one copy of three.js.
 * Run: node --test packages/studio/test/starter-3d.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { licenceProblems, unrecordedModels } from '../lib/asset-manifest.mjs';
import { buildGameFiles } from '../lib/build.mjs';
import { placeholderGlb } from '../lib/optimise.mjs';
import { PALETTE_KEYS } from '../lib/style-presets.mjs';
import { addNeeds, listGames } from '../lib/studio.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const STARTER = join(PKG, 'starters', 'gem-rush-3d');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-starter-3d-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env }, timeout: 120_000 });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(STARTER, 'assets', 'manifest.json'), 'utf8'));
const files = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));

/** A studio whose node_modules point at this package, the repo's esbuild and three.js (what npm install gives it). */
function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Meadow Test', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  for (const m of ['esbuild', 'three', '@types']) symlinkSync(join(REPO_NM, m), join(dir, 'node_modules', m));
  return dir;
}

/** A starter library of this test's own (the index contract), each item a grey box; `bad` items lie about their SHA-256. */
async function library(name, { bad = [] } = {}) {
  const dir = join(scratch, name);
  const items = [];
  for (const a of manifest.assets) {
    const [pack, item] = a.from.item.split('/');
    const bytes = Buffer.from(await placeholderGlb([0.5, 0.5, 0.5], { name: item }));
    const path = `items/${pack}/${item}.glb`;
    mkdirSync(join(dir, 'items', pack), { recursive: true });
    writeFileSync(join(dir, path), bytes);
    items.push({ id: a.from.item, pack, item, kind: a.kind, family: 'kenney', file: path, files: [{ role: 'model', path, bytes: bytes.byteLength, sha256: bad.includes(a.id) ? '0'.repeat(64) : sha256(bytes) }], license: 'cc0', heightM: 0.5 });
  }
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ v: 1, kind: 'homie-starter-library', version: 'v0', packs: [], items })}\n`);
  return dir;
}

test('the starter is text only: no model file in the repository, a library item for every model it draws', () => {
  const binaries = files(STARTER).filter((f) => !/\.(json|md|ts|html)$/.test(f));
  assert.deepEqual(binaries, [], 'only text: game new fetches the models');
  assert.ok(manifest.assets.length >= 12, `the animals, the gem and the dressing (${manifest.assets.length})`);
  const src = readFileSync(join(STARTER, 'src', 'view.ts'), 'utf8');
  for (const a of manifest.assets) {
    assert.equal(a.route, 'library', a.id);
    assert.equal(a.from?.library, 'homie-starter', a.id);
    assert.match(String(a.from?.pack), /^kenney-[a-z-]+$/, `${a.id} names its pack`);
    assert.match(String(a.from?.item), new RegExp(`^${a.from.pack}/[a-z0-9]+(-[a-z0-9]+)*$`), `${a.id}: a library item id, <pack>/<item>`);
    assert.match(String(a.from?.sha256), /^[0-9a-f]{64}$/, `${a.id} pins the library file's SHA-256`);
    assert.deepEqual(a.files.map((f) => [f.role, f.path]), [['model', `public/models/${a.id}.glb`]], `${a.id}: where game new writes it`);
    assert.equal(a.files[0].sha256, a.from.sha256, a.id);
    assert.equal(a.license.kind, 'cc0', a.id);
    assert.equal(a.license.spdx, 'CC0-1.0', a.id);
    assert.ok(!('remix' in a.license), `${a.id}: no word about remixing in a record`);
    const budget = a.kind === 'character' ? 3000 : a.kind === 'kit' ? 1000 : 1500;
    assert.ok(a.measured.tris <= budget, `${a.id}: ${a.measured.tris} triangles (its budget is ${budget})`);
    const animal = /^animal-(.+)$/.exec(a.id)?.[1];
    assert.ok(animal ? src.includes(`'${animal}'`) && src.includes('./models/animal-${') : src.includes(`./models/${a.id}.glb`), `main.ts draws ${a.id}`);
  }
  for (const a of manifest.assets.filter((x) => x.kind === 'character')) for (const clip of ['idle', 'walk', 'run', 'dance']) assert.ok(a.measured.clipNames.includes(clip), `${a.id} has ${clip}`);
  assert.ok(manifest.assets.reduce((n, a) => n + a.files[0].bytes, 0) < 600 * 1024, 'what game new fetches stays under 600 KB');
});

test('RIGHTS.md and credits.json say where the models come from; style.json has what the game draws with', () => {
  const rights = readFileSync(join(STARTER, 'assets', 'RIGHTS.md'), 'utf8');
  for (const a of manifest.assets) assert.match(rights, new RegExp(`### ${a.id}\\n`), `RIGHTS.md has ${a.id}`);
  assert.match(rights, /CC0 1\.0/);
  assert.match(rights, /Kenney/);
  const credits = JSON.parse(readFileSync(join(STARTER, 'credits.json'), 'utf8'));
  const packs = credits.parts.map((p) => p.what).join(' | ');
  assert.match(packs, /Kenney Cube Pets/);
  assert.match(packs, /Kenney Nature Kit/);
  assert.ok(credits.parts.every((p) => p.licence === 'CC0-1.0'));
  const style = JSON.parse(readFileSync(join(STARTER, 'style.json'), 'utf8'));
  for (const k of PALETTE_KEYS) assert.match(String(style.palette[k]), /^#[0-9a-f]{6}$/i, `palette.${k}`);
  assert.ok(Array.isArray(style.palette.ramp) && style.palette.ramp.length >= 6, 'palette.ramp');
  assert.ok(style.fonts?.display && style.fonts?.body, 'fonts');
  assert.ok(Array.isArray(style.light?.key) && style.light.sky && style.light.ground, 'light');
  assert.ok(style.camera?.pitch > 0 && style.camera?.fov > 0 && style.camera?.distance > 0, 'camera');
  // The game reads them, loads every model through the shared loader (never three's own GLTFLoader), repaints the
  // flat ones into the palette and draws stand-ins for any model that is not there.
  const src = readFileSync(join(STARTER, 'src', 'view.ts'), 'utf8');
  assert.match(src, /from '\.\.\/style\.json'/);
  assert.match(src, /from '@homie-rocks\/studio\/assets'/);
  assert.doesNotMatch(src, /GLTFLoader/);
  assert.match(src, /repaint\(/);
  assert.match(src, /standIn\('critter'/, 'an animal that is not there is a stand-in in its seat colour');
  assert.match(src, /standIn\('gem'\)/);
});

test('game new --from gem-rush-3d: three.js joins devDependencies, the models come from the library, it builds with one three.js', async () => {
  const dir = studio('meadow');
  const lib = await library('lib', { bad: ['flower-red'] });
  const made = run(['game', 'new', 'arena', '--from', 'gem-rush-3d', '--name', 'Arena'], dir, { HOMIE_LIBRARY: lib });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const r = JSON.parse(made.stdout);
  assert.equal(r.installNeeded, true);
  assert.deepEqual(r.needsAdded, [{ name: 'three', version: '0.185.1' }, { name: '@types/three', version: '0.185.1' }]);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies.three, '0.185.1', 'exact version, in devDependencies');
  assert.equal(pkg.dependencies?.three, undefined);
  // The models: every one fetched and checked, but the one whose SHA-256 is not the index's.
  assert.equal(r.models.fetched, manifest.assets.length - 1);
  assert.deepEqual(r.models.missing.map((m) => m.asset), ['flower-red']);
  assert.match(r.models.missing[0].why, /SHA-256/);
  const game = join(dir, 'games', 'arena');
  const got = JSON.parse(readFileSync(join(game, 'assets', 'manifest.json'), 'utf8'));
  for (const a of got.assets.filter((x) => x.id !== 'flower-red')) {
    const bytes = readFileSync(join(game, a.files[0].path));
    assert.equal(checkGlb(bytes, LIMITS.game).ok, true, `${a.id} passes the loader's check`);
    assert.equal(a.files[0].sha256, sha256(bytes), `${a.id}: the manifest keeps the SHA-256 of what was written`);
  }
  assert.ok(!existsSync(join(game, 'public', 'models', 'flower-red.glb')), 'a refused file is never written');
  assert.equal(JSON.parse(readFileSync(join(game, 'game.json'), 'utf8')).needs.three, '0.185.1', 'game.json keeps what it was written against');
  assert.equal(JSON.parse(readFileSync(join(game, 'game.json'), 'utf8')).room.host, 'server');
  assert.match(readFileSync(join(game, 'assets', 'RIGHTS.md'), 'utf8'), /^# Rights: Arena$/m);
  assert.match(readFileSync(join(game, 'assets', 'RIGHTS.md'), 'utf8'), /homie-studio assets rights arena`/);
  assert.deepEqual(unrecordedModels(dir, 'arena'), [], 'every model it holds is recorded');
  assert.deepEqual(licenceProblems(dir, 'arena').filter((p) => p.level === 'refuse'), [], 'nothing a public game refuses');

  // The words: no library at all, and three already in package.json.
  const words = spawnSync(process.execPath, [CLI, 'game', 'new', 'arena-two', '--from', 'gem-rush-3d'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', HOMIE_LIBRARY: join(scratch, 'nowhere') } });
  assert.equal(words.status, 0, words.stderr);
  assert.doesNotMatch(words.stdout, /npm install/, 'three is already in package.json: nothing more to install');
  assert.match(words.stdout, /Models: 0 from the starter library/);
  assert.match(words.stdout, /draws stand-ins/);
  assert.ok(!existsSync(join(dir, 'games', 'arena-two', 'public', 'models')), 'no library, no models: the game is made all the same');

  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const g = listGames(dir).find((x) => x.id === 'arena');
  const out = join(scratch, 'out-arena');
  const { metafile } = await buildGameFiles(esbuild, dir, g, out);
  assert.ok(statSync(join(out, 'assets', 'main.js')).size > 300_000, 'three.js is in the bundle');
  assert.ok(existsSync(join(out, 'index.html')));
  assert.ok(existsSync(join(out, 'models', 'animal-fox.glb')), 'the models are served beside it');
  const threes = new Set(Object.keys(metafile.inputs).filter((p) => /three\/build\/three\.(core|module)/.test(p)).map((p) => realpathSync(join(dir, p)).replace(/build\/.*$/, '')));
  assert.equal(threes.size, 1, `one three.js in the bundle: ${[...threes].join(', ')}`);
  assert.ok(Object.keys(metafile.inputs).some((p) => /assets\/assets\.ts$/.test(p)), 'the shared model loader is in it');
});

test('game new --from gem-rush-3d into a planned game: its decisions, style.json and own models stay; the starter\'s join them', async () => {
  const dir = studio('planned');
  const lib = await library('lib-planned');
  const game = join(dir, 'games', 'grove');
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'CODEX.md'), '# Grove\n\nA cozy low-poly game where foxes gather berries in a forest.\n');
  assert.equal(run(['style', 'init', 'grove', '--prompt', 'cozy low-poly foxes gathering berries in a forest'], dir).status, 0);
  const box = join(scratch, 'lantern.glb');
  writeFileSync(box, Buffer.from(await placeholderGlb([0.3, 0.6, 0.3], { name: 'lantern' })));
  const added = run(['assets', 'add', 'grove', '--file', box, '--license', 'own', '--as', 'lantern', '--height', '0.6'], dir);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const steered = run(['style', 'steer', 'grove', 'style.palette', 'warmer'], dir);
  assert.equal(steered.status, 0, steered.stdout + steered.stderr);
  const before = {
    decisions: readFileSync(join(game, 'codex', 'decisions.json'), 'utf8'),
    style: readFileSync(join(game, 'style.json'), 'utf8'),
    lantern: readFileSync(join(game, 'public', 'models', 'lantern.glb')),
  };
  const made = run(['game', 'new', 'grove', '--from', 'gem-rush-3d', '--name', 'Grove'], dir, { HOMIE_LIBRARY: lib });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.equal(JSON.parse(made.stdout).models.fetched, manifest.assets.length, 'only the starter\'s models are fetched');
  assert.equal(readFileSync(join(game, 'codex', 'decisions.json'), 'utf8'), before.decisions, 'the plan\'s decisions stay');
  assert.equal(readFileSync(join(game, 'style.json'), 'utf8'), before.style, 'the game\'s own style.json stays');
  assert.deepEqual(readFileSync(join(game, 'public', 'models', 'lantern.glb')), before.lantern, 'its own model stays');
  const got = JSON.parse(readFileSync(join(game, 'assets', 'manifest.json'), 'utf8'));
  assert.equal(got.assets.length, manifest.assets.length + 1);
  assert.ok(got.assets.some((a) => a.id === 'lantern' && a.route === 'imported'), JSON.stringify(got.assets.map((a) => [a.id, a.route])));
  const stale = JSON.parse(run(['assets', 'stale', 'grove'], dir).stdout);
  assert.deepEqual((stale.stale ?? stale.assets ?? []).map((a) => a.id), ['lantern'], 'only its own model, made before the palette was steered, is stale: adopted ones are made under the game\'s decisions');
  const rights = readFileSync(join(game, 'assets', 'RIGHTS.md'), 'utf8');
  assert.match(rights, /^# Rights: Grove$/m);
  assert.match(rights, /lantern/);
  assert.match(rights, /Kenney Cube Pets/);
  assert.deepEqual(unrecordedModels(dir, 'grove'), []);
  // A file of its own that the starter would overwrite is still refused.
  mkdirSync(join(dir, 'games', 'other', 'src'), { recursive: true });
  writeFileSync(join(dir, 'games', 'other', 'src', 'main.ts'), 'mine');
  const refused = run(['game', 'new', 'other', '--from', 'gem-rush-3d'], dir, { HOMIE_LIBRARY: lib });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /would overwrite \(src\)/);
});

test('addNeeds: a version the studio already pins stays, and says so; nothing to add, nothing to install', () => {
  const dir = join(scratch, 'pinned');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'x', devDependencies: { three: '0.180.0' } }, null, 2)}\n`);
  const r = addNeeds(dir, { three: '0.185.1', 'not a name!': '1.0.0', other: 'latest' });
  assert.equal(r.installNeeded, false);
  assert.deepEqual(r.needsHeld, [{ name: 'three', want: '0.185.1', have: '0.180.0' }]);
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).devDependencies.three, '0.180.0');
  assert.deepEqual(addNeeds(dir, undefined), {});
});
