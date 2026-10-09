/**
 * Art direction and assets (0.22.0): the GLB safety rules (assets/safety.mjs) and the loader that applies them in a
 * browser (assets/assets.ts); decisions with automatic picks, steer, lock, pin by use and the blast radius
 * (lib/decisions.mjs); the asset manifest, RIGHTS.md, the credits and the licence check (lib/asset-manifest.mjs);
 * the optimiser (lib/optimise.mjs); the CLI's `style` and `assets` commands; the build, which hands no
 * game's files on; and the publish refusal. Offline; only the
 * lineup's own pictures need Chrome (skipped without one).
 * Run: node --test packages/studio/test/art.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { blastRadius, derivedPrompt, directionsFor, initDecisions, lockDecision, readDecisions, setDecision, staleAssets, steerDecision } from '../lib/decisions.mjs';
import { licenceProblems, readManifest, recordAsset, rightsMarkdown } from '../lib/asset-manifest.mjs';
import { inspectModel, modelTools, optimiseModel, placeholderGlb } from '../lib/optimise.mjs';
import { searchLibrary } from '../lib/library.mjs';
import { findChrome } from '../lib/chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-art-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  return { code: r.status, out, err: r.stderr, text: r.stdout };
};
function studio(name, game = 'fox-grove') {
  const dir = join(scratch, name);
  assert.equal(spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Fox Den', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' }).status, 0);
  assert.equal(run(dir, 'codex', 'new', game, '--name', 'Fox Grove').code, 0);
  return dir;
}

/** A GLB from a JSON object and an optional binary chunk (both padded as the format asks). */
function glb(json, bin = null) {
  const pad = (b, fill) => { const n = (4 - (b.length % 4)) % 4; return Buffer.concat([b, Buffer.alloc(n, fill)]); };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = bin ? pad(bin, 0) : null;
  const len = 12 + 8 + j.length + (b ? 8 + b.length : 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(len, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const parts = [head, jh, j];
  if (b) { const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4); parts.push(bh, b); }
  return Buffer.concat(parts);
}
const EXTERNAL = glb({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/huge.bin', byteLength: 1024 }] });
const HUGE = glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 200 * 1024 * 1024 }] }, Buffer.alloc(16));
const PICTURE_URL = glb({ asset: { version: '2.0' }, images: [{ uri: 'http://tracker.example/x.png' }] });

test('safety: an external URI, a 200 MB buffer, an unreadable required extension and a .gltf are refused; a real GLB passes', async () => {
  const ext = checkGlb(EXTERNAL);
  assert.equal(ext.ok, false);
  assert.match(ext.problems.join(' '), /external URI/);
  const huge = checkGlb(HUGE);
  assert.equal(huge.ok, false);
  assert.match(huge.problems.join(' '), /declares 200\.0 MB/);
  assert.equal(checkGlb(HUGE, LIMITS.import).ok, false, 'not even as a raw import');
  assert.match(checkGlb(PICTURE_URL).problems.join(' '), /picture 0 is loaded from an address/);
  assert.match(checkGlb(glb({ asset: { version: '2.0' }, extensionsRequired: ['ACME_secret_sauce'] })).problems.join(' '), /requires the extension ACME_secret_sauce/);
  assert.match(checkGlb(Buffer.from('{"asset":{"version":"2.0"}}')).problems.join(' '), /\.gltf with separate files/);
  const box = Buffer.from(await placeholderGlb([1, 2, 3]));
  const ok = checkGlb(box);
  assert.equal(ok.ok, true, ok.problems.join('; '));
  assert.equal(ok.info.triangles, 12);
});

test('loader: @homie-rocks/studio/assets refuses an unsafe or oversized file before three.js parses a byte', async () => {
  const esbuild = await import('esbuild');
  const out = join(scratch, 'assets-bundle.mjs');
  await esbuild.build({ entryPoints: [join(PKG, 'assets', 'assets.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: out, logLevel: 'silent', absWorkingDir: PKG });
  globalThis.location = new URL('https://studio.test/games/x/');
  const served = { '/games/x/models/ext.glb': EXTERNAL, '/games/x/models/huge.glb': HUGE, '/games/x/models/big.glb': Buffer.alloc(6 * 1024 * 1024) };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const body = served[u.pathname];
    return body ? new Response(body, { headers: { 'content-length': String(body.length) } }) : new Response('no', { status: 404 });
  };
  const { createModels } = await import(pathToFileURL(out));
  const models = createModels({ dev: false });
  await assert.rejects(models.load('./models/ext.glb'), /refused \.\/models\/ext\.glb: buffer 0 is loaded from an address/);
  await assert.rejects(models.load('./models/huge.glb'), /refused .*declares 200\.0 MB/);
  await assert.rejects(models.load('./models/big.glb'), /refused .*over 5120 KB/);
  await assert.rejects(models.load('https://elsewhere.test/fox.glb'), /a model from another site/);
  assert.equal(models.stats().refused.length, 4);
  const box = models.placeholder({ x: 1, y: 2, z: 1 });
  assert.equal(box.name, 'placeholder');
  // stylize: the style's material model on every mesh (colour kept), an ink line on a closed shell, none on a card.
  const { stylize } = await import(pathToFileURL(out));
  const THREE = await import('three');
  const root = new THREE.Group();
  const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ff8800' }));
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#00ff00' }));
  root.add(solid, card);
  assert.equal(stylize(root, { materials: { model: 'toon', outline: true }, palette: { bg: '#102030' } }), 2);
  assert.equal(solid.material.type, 'MeshToonMaterial');
  assert.equal(solid.material.color.getHexString(), new THREE.Color('#ff8800').getHexString());
  assert.equal(solid.children.filter((c) => c.name === 'hull').length, 1, 'a closed shell gets its ink line');
  assert.equal(card.children.length, 0, 'an open card gets none');
  const flat = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  stylize(flat, { render: 'lowpoly-flat' });
  assert.equal(flat.material.type, 'MeshLambertMaterial');
  assert.equal(flat.children.length, 0, 'no outline unless the style asks for one');
});

test('decisions: automatic picks with a why, steer, lock by the person, pin by use, and the blast radius', async () => {
  const dir = studio('decide');
  const init = initDecisions(dir, 'fox-grove', { prompt: 'make a cozy low-poly game where foxes gather berries in a forest' });
  assert.equal(init.genre, 'gather');
  let doc = readDecisions(dir, 'fox-grove');
  assert.equal(doc.decisions['style.render'].value, 'lowpoly-flat');
  assert.equal(doc.decisions['style.palette'].value.name, 'autumn-grove');
  assert.match(doc.decisions['style.palette'].why, /foxes/);
  assert.equal(doc.decisions['rig.skeleton'].value, 'quadruped');
  assert.ok(Object.values(doc.decisions).every((d) => d.state === 'auto' && d.why));
  assert.ok(existsSync(join(dir, 'games', 'fox-grove', 'style.json')), 'the game\'s style tokens');
  assert.match(derivedPrompt(doc).text, /Flat low-poly 3D game asset.*no text/);

  const before = doc.decisions['style.palette'].value.accent;
  const s = steerDecision(dir, 'fox-grove', 'style.palette', 'warmer and less saturated');
  assert.equal(s.applied, true);
  assert.equal(s.record.state, 'steered');
  assert.notEqual(s.record.value.accent, before);
  assert.equal(lockDecision(dir, 'fox-grove', 'style.palette', { by: 'ai' }).ok, false, 'only the person locks');
  assert.deepEqual(lockDecision(dir, 'fox-grove', 'style.palette', { by: 'person', words: 'keep that palette' }).locked, ['style.palette']);
  assert.match(readFileSync(join(dir, 'games', 'fox-grove', 'CODEX.md'), 'utf8'), /Locked the palette.*keep that palette/);

  // An asset made now records the revisions; pinning by use never makes it stale by itself.
  const box = Buffer.from(await placeholderGlb([0.5, 0.4, 0.5]));
  mkdirSync(join(dir, 'games', 'fox-grove', 'public', 'models'), { recursive: true });
  writeFileSync(join(dir, 'games', 'fox-grove', 'public', 'models', 'berry.glb'), box);
  const rec = recordAsset(dir, 'fox-grove', { id: 'berry', kind: 'prop', route: 'generated', files: [{ role: 'model', path: 'public/models/berry.glb', sha256: createHash('sha256').update(box).digest('hex') }], made: { steps: [{ what: 'concept', usd: 0.035 }, { what: 'mesh', usd: 0.5 }] }, license: { kind: 'generated' } });
  assert.ok(rec.pinned.includes('style.render'), 'the first asset pins the auto decisions it was made under');
  doc = readDecisions(dir, 'fox-grove');
  assert.equal(doc.decisions['style.render'].state, 'pinned');
  assert.deepEqual(staleAssets(doc, readManifest(dir, 'fox-grove')), []);

  // A locked change: refused without unlock, a pending blast radius without confirm, then changed and stale.
  const m = readManifest(dir, 'fox-grove');
  assert.equal(setDecision(dir, 'fox-grove', 'style.palette', 'neon-dusk', { by: 'person', manifest: m }).ok, false);
  const pending = setDecision(dir, 'fox-grove', 'style.palette', 'neon-dusk', { by: 'person', unlock: true, reason: 'the person wants neon', manifest: m });
  assert.equal(pending.pending, true);
  assert.equal(pending.blast.assets[0].id, 'berry');
  assert.equal(pending.blast.assets[0].remake.usd, 0.535);
  assert.equal(readDecisions(dir, 'fox-grove').decisions['style.palette'].value.name, 'autumn-grove', 'nothing changed before the yes');
  const done = setDecision(dir, 'fox-grove', 'style.palette', 'neon-dusk', { by: 'person', unlock: true, reason: 'the person wants neon', confirm: true, manifest: m });
  assert.equal(done.changed, true);
  assert.equal(readDecisions(dir, 'fox-grove').decisions['style.palette'].state, 'locked', 'still locked, now on the new value');
  assert.deepEqual(staleAssets(readDecisions(dir, 'fox-grove'), readManifest(dir, 'fox-grove')).map((x) => x.id), ['berry']);
  assert.equal(blastRadius(readDecisions(dir, 'fox-grove'), 'style.render', m).assets.length, 1);
  // The AI may not move a decision a paid asset pinned.
  assert.equal(setDecision(dir, 'fox-grove', 'style.render', 'toon', { by: 'ai', manifest: readManifest(dir, 'fox-grove') }).ok, false);

  const dirs = directionsFor(dir, 'fox-grove').directions;
  assert.equal(dirs.length, 3);
  assert.equal(new Set(dirs.map((d) => d.values['style.render'])).size, 3, 'three different looks');
});

test('manifest: a licence on every asset, RIGHTS.md, credits, and what a public game may not ship', async () => {
  const dir = studio('rights');
  const gdir = join(dir, 'games', 'fox-grove');
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });
  const box = Buffer.from(await placeholderGlb([1, 1, 1]));
  for (const f of ['tree.glb', 'statue.glb', 'mystery.glb']) writeFileSync(join(gdir, 'public', 'models', f), box);
  const sha = createHash('sha256').update(box).digest('hex');
  assert.throws(() => recordAsset(dir, 'fox-grove', { id: 'x', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/tree.glb' }] }), /licence record/);
  assert.throws(() => recordAsset(dir, 'fox-grove', { id: 'x', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/tree.glb' }], license: { kind: 'cc-by-4.0' } }), /attribution/);
  recordAsset(dir, 'fox-grove', { id: 'tree', kind: 'prop', route: 'library', from: { library: 'homie-starter', pack: 'kenney-nature-kit', packLabel: 'Kenney Nature Kit', packUrl: 'https://kenney.nl/assets/nature-kit', item: 'kenney-nature-kit/tree-oak', author: 'Kenney' }, files: [{ role: 'model', path: 'public/models/tree.glb', sha256: sha }], license: { kind: 'cc0' } });
  recordAsset(dir, 'fox-grove', { id: 'statue', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/statue.glb', sha256: sha }], license: { kind: 'cc-by-4.0', attribution: 'A sculptor, example.org' } });
  const rights = rightsMarkdown(dir, 'fox-grove');
  assert.match(rights, /### tree[\s\S]*Kenney Nature Kit[\s\S]*CC0 1\.0/);
  assert.match(rights, /### statue[\s\S]*Credit:\*\* A sculptor/);
  assert.match(rights, /\*\*Kenney\*\* \(https:\/\/kenney\.nl\/support, read 2026-10-02\)/);
  const credits = JSON.parse(readFileSync(join(gdir, 'credits.json'), 'utf8'));
  assert.ok(credits.parts.some((p) => p.what.startsWith('Kenney Nature Kit') && p.licence === 'CC0-1.0'));
  assert.ok(credits.parts.some((p) => p.author === 'A sculptor, example.org' && p.licence === 'CC-BY-4.0'));
  // mystery.glb ships with no record: refused.
  let problems = licenceProblems(dir, 'fox-grove');
  assert.deepEqual(problems.filter((p) => p.level === 'refuse').map((p) => p.asset), ['public/models/mystery.glb']);
  // A store file, as an older toolkit recorded it (`license.remix` said what a remix was to get): the record is
  // taken as it is, the old word is never read, and the game may serve the file. It is a warning, not a refusal:
  // the file itself may not be handed on (the studio's repository, a shared part).
  recordAsset(dir, 'fox-grove', { id: 'mystery', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/mystery.glb', sha256: sha }], license: { kind: 'eula:somestore', remix: 'include' } });
  problems = licenceProblems(dir, 'fox-grove');
  assert.deepEqual(problems.map((p) => [p.asset, p.level]), [['mystery', 'warn']]);
  assert.match(problems[0].problem, /may serve the file to players, but the file itself may not be handed on/);
  assert.match(problems[0].problem, /leave it out of any part the studio shares/);
  // Nothing writes that old word any more, and RIGHTS.md has no line about it.
  assert.equal(readManifest(dir, 'fox-grove').assets.find((a) => a.id === 'tree').license.remix, undefined);
  assert.doesNotMatch(rightsMarkdown(dir, 'fox-grove'), /remix/i);
});

test('optimise: a model scaled to its height, its pivot at the bottom centre, measured, refused when unsafe', async () => {
  const raw = join(scratch, 'raw.glb');
  writeFileSync(raw, Buffer.from(await placeholderGlb([2, 4, 2])));
  const r = await optimiseModel(raw, { out: join(scratch, 'small.glb'), height: 1, triangles: 1500 });
  assert.equal(r.ok, true, r.warnings.join('; '));
  assert.ok(r.ops.includes('center bottom'));
  assert.equal(r.after.heightM, 1);
  assert.deepEqual(r.after.pivot, { bottom: true, centred: true });
  const ins = await inspectModel(join(scratch, 'small.glb'));
  assert.equal(ins.ok, true);
  assert.equal(ins.validator.errors, 0);
  assert.ok(ins.safe.info.extensions.required.includes('EXT_meshopt_compression') || ins.safe.info.extensions.required.includes('KHR_meshopt_compression'));
  const bad = join(scratch, 'external.glb');
  writeFileSync(bad, EXTERNAL);
  await assert.rejects(optimiseModel(bad, { out: join(scratch, 'never.glb') }), /external URI|outside its folder/);
  // Metal draws black with nothing to reflect: non-metal unless the game is pbr (metal: true keeps it).
  const t = await modelTools();
  const doc = await t.io.readBinary(new Uint8Array(await placeholderGlb([1, 1, 1])));
  for (const m of doc.getRoot().listMaterials()) m.setMetallicFactor(1).setRoughnessFactor(0.4);
  const shiny = join(scratch, 'shiny.glb');
  writeFileSync(shiny, Buffer.from(await t.io.writeBinary(doc)));
  const metalOf = async (bytes) => (await t.io.readBinary(new Uint8Array(bytes))).getRoot().listMaterials().map((m) => m.getMetallicFactor());
  const plain = await optimiseModel(shiny, {});
  assert.ok(plain.ops.some((o) => o.startsWith('metal -> 0')), plain.ops.join(', '));
  assert.ok((await metalOf(plain.glb)).every((v) => v === 0));
  const pbr = await optimiseModel(shiny, { metal: true });
  assert.ok((await metalOf(pbr.glb)).some((v) => v === 1), 'a pbr game keeps its metal');
});

test('CLI: style init, lock and blast; assets add refuses unsafe files and records a safe one; check and rights', async () => {
  const dir = studio('cli');
  assert.equal(run(dir, 'style', 'init', 'fox-grove', '--prompt', 'a cozy low-poly forest where foxes gather berries').out.genre, 'gather');
  assert.equal(run(dir, 'style', 'lock', 'fox-grove', 'style.camera', '--words', 'keep the camera').out.locked[0], 'style.camera');
  const ext = join(scratch, 'cli-external.glb'); writeFileSync(ext, EXTERNAL);
  const huge = join(scratch, 'cli-huge.glb'); writeFileSync(huge, HUGE);
  const a = run(dir, 'assets', 'add', 'fox-grove', '--file', ext, '--license', 'own', '--as', 'bad');
  assert.notEqual(a.code, 0);
  assert.match(a.text + a.err, /external URI/);
  const b = run(dir, 'assets', 'add', 'fox-grove', '--file', huge, '--license', 'own', '--as', 'huge');
  assert.notEqual(b.code, 0);
  assert.match(b.text + b.err, /declares 200/);
  assert.equal(readManifest(dir, 'fox-grove').assets.length, 0, 'nothing refused was recorded');
  const okFile = join(scratch, 'crate.glb'); writeFileSync(okFile, Buffer.from(await placeholderGlb([1, 1, 1])));
  const added = run(dir, 'assets', 'add', 'fox-grove', '--file', okFile, '--license', 'own', '--as', 'crate', '--height', '0.8', '--card', 'Places/Crate');
  assert.equal(added.code, 0, added.text + added.err);
  assert.equal(added.out.after.heightM, 0.8);
  assert.ok(existsSync(join(dir, 'art', 'crate', 'raw', 'crate.glb')), 'the raw file kept beside its art job');
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^art\/\*\*\/raw\/$/m, 'and git-ignored');
  const check = run(dir, 'assets', 'check', 'fox-grove');
  assert.equal(check.out.ok, true, JSON.stringify(check.out.rows));
  assert.equal(check.out.rows[0].measured.heightM, 0.8);
  assert.ok(existsSync(join(dir, '.studio', 'art', 'fox-grove', 'latest.json')), 'the summary the mod reads');
  const blast = run(dir, 'style', 'blast', 'fox-grove', 'style.camera').out.blast;
  assert.equal(blast.name, 'camera');
  const rights = run(dir, 'assets', 'rights', 'fox-grove');
  assert.match(rights.out.text, /### crate[\s\S]*The studio's own work/);
  // Made again from its kept raw file, free: same route and licence; refused once the raw file is not the one it was made from.
  const redo = run(dir, 'assets', 'redo', 'fox-grove', 'crate');
  assert.equal(redo.code, 0, redo.text + redo.err);
  assert.equal(redo.out.command, 'assets redo');
  const crate = readManifest(dir, 'fox-grove').assets.find((x) => x.id === 'crate');
  assert.equal(crate.route, 'imported');
  assert.equal(crate.license.kind, 'own');
  assert.equal(crate.made.steps.filter((x) => x.what === 'optimise').length, 1, 'one optimise step, not two');
  writeFileSync(join(dir, 'art', 'crate', 'raw', 'crate.glb'), Buffer.from(await placeholderGlb([2, 2, 2])));
  const changed = run(dir, 'assets', 'redo', 'fox-grove', 'crate');
  assert.notEqual(changed.code, 0);
  assert.match(changed.text + changed.err, /SHA-256 differs/);
  // Removed: the record and the shipped copy go (it is what the record put there); the raw file stays.
  const removed = run(dir, 'assets', 'remove', 'fox-grove', 'crate');
  assert.equal(removed.code, 0, removed.text + removed.err);
  assert.deepEqual(removed.out.deleted, ['public/models/crate.glb']);
  assert.ok(!existsSync(join(dir, 'games', 'fox-grove', 'public', 'models', 'crate.glb')));
  assert.ok(existsSync(join(dir, 'art', 'crate', 'raw', 'crate.glb')));
  assert.equal(readManifest(dir, 'fox-grove').assets.length, 0);
});

test('library: search ranks names and tags, filters by kind and family', () => {
  const index = { items: [
    { id: 'k/animal-fox', item: 'animal-fox', name: 'Fox', pack: 'kenney-cube-pets', family: 'kenney', kind: 'creature', tags: ['animal', 'fox', 'pet'], files: [{ bytes: 40000 }] },
    { id: 'k/tree-pine', item: 'tree-pine', name: 'Pine tree', pack: 'kenney-nature-kit', family: 'kenney', kind: 'prop', tags: ['tree', 'pine', 'forest'], files: [{ bytes: 5000 }] },
    { id: 'p/fox-statue', item: 'fox-statue', name: 'Fox statue', pack: 'polyhaven-models', family: 'polyhaven', kind: 'prop', tags: ['statue'], files: [{ bytes: 900000 }] },
  ] };
  assert.deepEqual(searchLibrary(index, 'fox').map((h) => h.item.id), ['k/animal-fox', 'p/fox-statue']);
  assert.deepEqual(searchLibrary(index, 'trees forest', { family: 'kenney' }).map((h) => h.item.id), ['k/tree-pine']);
  assert.deepEqual(searchLibrary(index, 'fox', { kind: 'prop' }).map((h) => h.item.id), ['p/fox-statue']);
});

test('build: no game is handed over whole (no source.json, no assets.json), and a game that was made from another keeps saying whose files it carries', async () => {
  const dir = studio('original');
  // A real game around the codex, so it builds.
  assert.equal(run(dir, 'game', 'new', 'fox-grove', '--from', 'ember-vale', '--name', 'Fox Grove').code, 0);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  const gdir = join(dir, 'games', 'fox-grove');
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });
  const box = Buffer.from(await placeholderGlb([0.6, 0.6, 0.6]));
  writeFileSync(join(gdir, 'public', 'models', 'berry.glb'), box);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  // An asset as `game remix` (retired) recorded it in the game it made: carried from the original, whose it still is.
  recordAsset(dir, 'fox-grove', { id: 'berry', kind: 'prop', route: 'generated', from: { remixOf: { studio: 'Night Owl Games', game: 'Owl Grove', source: 'https://owls.example/games/owl-grove/source.json' } }, files: [{ role: 'model', path: 'public/models/berry.glb', sha256: sha(box) }], license: { kind: 'generated', remix: 'include' }, measured: { box: { size: [0.6, 0.6, 0.6] } } });
  const rights = readFileSync(join(gdir, 'assets', 'RIGHTS.md'), 'utf8');
  assert.match(rights, /\*\*From:\*\* generated on Night Owl Games's own account; carried from Owl Grove by Night Owl Games/);
  assert.match(rights, /\*\*Licence:\*\* Generated on Night Owl Games's own account/);
  assert.doesNotMatch(rights, /A remix:/);
  const built = run(dir, 'build');
  assert.equal(built.code, 0, built.text + built.err);
  const dist = join(dir, 'site', 'dist', 'games', 'fox-grove');
  assert.ok(existsSync(join(dist, 'models', 'berry.glb')), 'the game still serves its own model to its players');
  for (const f of ['source.json', 'assets.json']) assert.ok(!existsSync(join(dist, f)), `${f} is not built`);

  // A site an older toolkit built still has both files. A one-game build starts from the site as it is: it takes
  // out exactly what that toolkit wrote (told by each file's own "kind"), and never a file of the game's own.
  assert.equal(run(dir, 'game', 'new', 'second', '--from', 'ember-vale', '--name', 'Second').code, 0);
  assert.equal(run(dir, 'build').code, 0);
  writeFileSync(join(dist, 'source.json'), JSON.stringify({ v: 1, kind: 'homie-game-source', id: 'fox-grove', files: { 'game.json': '{}' } }));
  writeFileSync(join(dist, 'assets.json'), JSON.stringify({ v: 1, kind: 'homie-game-assets', game: 'fox-grove', assets: [] }));
  const own = join(dir, 'site', 'dist', 'games', 'second', 'assets.json');
  writeFileSync(own, JSON.stringify({ sprites: ['gem'] }));
  const again = run(dir, 'build', 'second');
  assert.equal(again.code, 0, again.text + again.err);
  for (const f of ['source.json', 'assets.json']) assert.ok(!existsSync(join(dist, f)), `the older build's ${f} is taken out`);
});

test('publish refuses a public game that ships a model with no licence record', async () => {
  const dir = studio('publish');
  assert.equal(run(dir, 'game', 'new', 'fox-grove', '--from', 'ember-vale').code, 0);
  mkdirSync(join(dir, 'games', 'fox-grove', 'public', 'models'), { recursive: true });
  writeFileSync(join(dir, 'games', 'fox-grove', 'public', 'models', 'found-online.glb'), Buffer.from(await placeholderGlb()));
  const r = run(dir, 'publish');
  assert.notEqual(r.code, 0);
  assert.match(r.text, /licence problem[\s\S]*found-online\.glb/);
});

test('the shipped payload counts one file per sound: a browser fetches the .ogg or its .wav fallback, never both', async () => {
  const { firstPlayBytes, shippedPayloadBytes } = await import('../lib/asset-check.mjs');
  assert.equal(firstPlayBytes, shippedPayloadBytes, 'the old name still works for a script that imports it');
  const dir = join(scratch, 'first-play');
  const game = join(dir, 'site', 'dist', 'games', 'tiny', 'sound');
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'theme.ogg'), Buffer.alloc(300_000));
  writeFileSync(join(game, 'theme.wav'), Buffer.alloc(2_000_000));
  writeFileSync(join(game, 'pop.wav'), Buffer.alloc(10_000));
  const r = firstPlayBytes(dir, 'tiny');
  assert.equal(r.raw, 310_000);
  assert.equal(r.files, 2);
});

/** A solid picture of a size, as PNG bytes (a few hundred bytes however large). */
async function png(w, h, colour = '#5a8f4e') {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer();
}
const shaOf = (b) => createHash('sha256').update(b).digest('hex');
/** A model of `triangles` loose triangles, optionally with a base-colour picture and a normal map. */
async function modelGlb({ triangles = 12, base = null, normal = null } = {}) {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const pos = new Float32Array(triangles * 9);
  for (let i = 0; i < triangles; i++) pos.set([0, i * 0.001, 0, 1, i * 0.001, 0, 0, i * 0.001 + 1, 0], i * 9);
  const uv = new Float32Array(triangles * 6);
  const mat = doc.createMaterial('m');
  if (base) mat.setBaseColorTexture(doc.createTexture('base').setImage(base).setMimeType('image/png'));
  if (normal) mat.setNormalTexture(doc.createTexture('normal').setImage(normal).setMimeType('image/png'));
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer)).setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer)).setMaterial(mat);
  doc.createScene('s').addChild(doc.createNode('n').setMesh(doc.createMesh('mesh').addPrimitive(prim)));
  return Buffer.from(await io.writeBinary(doc));
}

/** A bumpy mound as one welded grid of `n` by `n` quads (2 n n triangles), 4 m across: a rock a level scatters. */
async function moundGlb(n = 40) {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = (i / n - 0.5) * 4; const z = (j / n - 0.5) * 4;
    pos.set([x, Math.max(0, 1.6 - 0.4 * (x * x + z * z)) + 0.04 * Math.sin(i * 1.7) * Math.cos(j * 1.3), z], (j * (n + 1) + i) * 3);
  }
  const idx = new Uint32Array(n * n * 6);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.set([a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2], k); k += 6; }
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer)).setMaterial(doc.createMaterial('rock').setBaseColorFactor([0.5, 0.48, 0.45, 1]));
  doc.createScene('s').addChild(doc.createNode('n').setMesh(doc.createMesh('mound').addPrimitive(prim)));
  return Buffer.from(await io.writeBinary(doc));
}

test('a low copy for the far band: <name>_lo.glb through the same steps, recorded in the manifest, and what @homie-rocks/render\'s LodProps draws far away', async () => {
  const { loPathOf } = await import('../lib/optimise.mjs');
  const { importModel, redoModel } = await import('../lib/asset-import.mjs');
  const raw = join(scratch, 'mound-raw.glb');
  writeFileSync(raw, await moundGlb());
  const out = join(scratch, 'lod', 'mound.glb');
  const r = await optimiseModel(raw, { out, height: 2, triangles: 3200, lo: { ratio: 0.2 } });
  assert.equal(r.ok, true, r.warnings.join('; '));
  assert.equal(r.after.triangles, 3200);
  // Reported as the engine asked: where it is, how big, and its hash; written beside the model.
  assert.equal(r.lo.path, join(scratch, 'lod', 'mound_lo.glb'));
  assert.equal(r.lo.path, loPathOf(out));
  const loBytes = readFileSync(r.lo.path);
  assert.deepEqual([r.lo.bytes, r.lo.sha256], [loBytes.length, shaOf(loBytes)]);
  assert.ok(r.lo.triangles <= 3200 * 0.25 && r.lo.triangles >= 100, `about a fifth of the triangles: ${r.lo.triangles}`);
  assert.ok(r.lo.bytes < r.bytes);
  assert.ok(r.ops.some((o) => /^low copy at 0\.2 \(3200 to \d+ triangles\)$/.test(o)));
  // The same steps: it is a shipped model in its own right (safe, valid), the same height on the same pivot.
  const hi = await inspectModel(out); const lo = await inspectModel(r.lo.path);
  assert.equal(lo.ok, true);
  assert.equal(lo.validator.errors, 0);
  assert.equal(lo.measured.triangles, r.lo.triangles);
  assert.deepEqual(lo.measured.pivot, hi.measured.pivot);
  const near = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.06, `${what}: ${a} against ${b}`));
  near(lo.measured.box.min, hi.measured.box.min, 'the low copy\'s box starts where the model\'s does');
  near(lo.measured.box.max, hi.measured.box.max, 'and ends where it does: the two sit on each other');
  // Not asked: nothing written, nothing reported. A bad ratio and a rigged model: no file, and why.
  const plain = await optimiseModel(raw, { out: join(scratch, 'lod', 'plain.glb'), height: 2, triangles: 3200 });
  assert.equal('lo' in plain, false);
  assert.equal(existsSync(join(scratch, 'lod', 'plain_lo.glb')), false);
  const bad = await optimiseModel(raw, { out: join(scratch, 'lod', 'bad.glb'), triangles: 3200, lo: { ratio: 2 } });
  assert.equal(bad.lo, null);
  assert.match(bad.warnings.join('\n'), /no low copy: lo\.ratio is the share of the shipped triangles to keep, between 0 and 1/);
  const { humanoidGlb } = await import('./rig-fixtures.mjs');
  const rig = join(scratch, 'rig-raw.glb');
  writeFileSync(rig, Buffer.from(await humanoidGlb()));
  const rigged = await optimiseModel(rig, { out: join(scratch, 'lod', 'rig.glb'), triangles: 0, lo: { ratio: 0.2 } });
  assert.equal(rigged.lo, null);
  assert.match(rigged.warnings.join('\n'), /no low copy: a rigged model is one skinned mesh/);
  assert.equal(existsSync(join(scratch, 'lod', 'rig_lo.glb')), false);

  // The manifest records it (assets add --file … --lo 0.2), and making the asset again makes it again.
  const dir = studio('lod-studio');
  const gdir = join(dir, 'games', 'fox-grove');
  writeFileSync(join(gdir, 'game.json'), JSON.stringify({ id: 'fox-grove', name: 'Fox Grove', players: { min: 1, max: 4 }, assets: { budgets: { triangles: 4000 } } }));
  const added = await importModel(dir, 'fox-grove', raw, { as: 'mound', kind: 'prop', license: 'own', height: 2, lo: 0.2 });
  assert.equal(added.lo.path, 'public/models/mound_lo.glb');
  const entry = () => readManifest(dir, 'fox-grove').assets.find((a) => a.id === 'mound');
  const rec = entry().files.find((f) => f.role === 'model-lo');
  const onDisk = readFileSync(join(gdir, rec.path));
  assert.deepEqual([rec.path, rec.bytes, rec.sha256, rec.ratio], ['public/models/mound_lo.glb', onDisk.length, shaOf(onDisk), 0.2]);
  assert.equal(rec.tris, added.lo.triangles);
  assert.equal(entry().files.filter((f) => f.role === 'model').length, 1, 'the model is still the model: nothing that reads role "model" sees two');
  rmSync(join(gdir, rec.path));
  await redoModel(dir, 'fox-grove', 'mound');
  assert.ok(existsSync(join(gdir, 'public', 'models', 'mound_lo.glb')), 'redo made the low copy again, at the ratio the record kept');
  assert.equal(entry().files.find((f) => f.role === 'model-lo').ratio, 0.2);
  const cli = run(dir, 'assets', 'optimise', raw, '--out', join(scratch, 'lod', 'cli.glb'), '--triangles', '3200', '--lo', '0.25');
  assert.equal(cli.code, 0, cli.err);
  assert.deepEqual([cli.out.lo.path, 'glb' in cli.out.lo], [join(scratch, 'lod', 'cli_lo.glb'), false]);

  // ACROSS THE SEAM: the two files as the engine draws them. The full model near, the low copy far, two draw calls.
  const THREE = await import('three');
  const { LodProps } = await import('@homie-rocks/render/lodprops.js');
  const { io } = await modelTools();
  const geometryOf = async (file) => {
    const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(prim.getAttribute('POSITION').getArray()), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(prim.getIndices().getArray()), 1));
    return g;
  };
  const [hiGeo, loGeo] = [await geometryOf(out), await geometryOf(r.lo.path)];
  assert.deepEqual([hiGeo.index.count / 3, loGeo.index.count / 3], [r.after.triangles, r.lo.triangles]);
  const rocks = new LodProps(hiGeo, loGeo, new THREE.MeshBasicMaterial(), 8, { spread: 300 });
  for (const x of [5, 20, 80, 120, 500]) rocks.add(new THREE.Matrix4().makeTranslation(x, 0, 0));
  rocks.update(0, 0, 0, { near: 0, lodAt: 45, far: 160, density: 1 });
  assert.deepEqual([rocks.drawn.hi, rocks.drawn.lo], [2, 2], 'two near in full, two far as the low copy, the fifth not drawn');
  assert.equal(rocks.lo.geometry.index.count / 3, r.lo.triangles);
  assert.ok(rocks.drawn.hi * r.after.triangles + rocks.drawn.lo * r.lo.triangles < 4 * r.after.triangles * 0.65, 'which is the point: far fewer triangles than four full models');
});

test('one key, three readers: the build\'s loader budget, assets check and assets add say the same about one game.json', async (t) => {
  // ACROSS THE SEAM: game.json `assets.budgets` as the build reads it for the game's own loader (run here as the
  // build bundles it), as `assets check` judges a recorded model, and as `assets add` sizes one on the way in.
  const { modelBudgetsOf } = await import('../lib/build.mjs');
  const { assetsCheck, budgetsFor, gameBudgets } = await import('../lib/asset-check.mjs');
  const { importModel } = await import('../lib/asset-import.mjs');
  const esbuild = await import('esbuild');
  const dir = studio('budgets');
  const gdir = join(dir, 'games', 'fox-grove');
  const raw = join(scratch, 'budget-mound.glb');
  const bytes = await moundGlb(32);          // 2,048 triangles: over a prop's 1,500, under 4,000
  writeFileSync(raw, bytes);
  const real = { fetch: globalThis.fetch, location: globalThis.location };
  t.after(() => { globalThis.fetch = real.fetch; globalThis.location = real.location; });
  globalThis.location = new URL('https://studio.test/games/fox-grove/');
  globalThis.fetch = async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  /** What the game's own loader says about that model, bundled with the constant the build would write. */
  const loaderSays = async (name, game) => {
    const define = modelBudgetsOf(game);
    const file = join(scratch, `budget-loader-${name}.mjs`);
    await esbuild.build({ entryPoints: [join(PKG, 'assets', 'assets.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: file, logLevel: 'silent', absWorkingDir: PKG, define: { __HOMIE_MODEL_BUDGETS__: JSON.stringify(define ?? {}) } });
    const { createModels } = await import(pathToFileURL(file));
    const said = [];
    const model = await createModels({ dev: true, onWarn: (x) => said.push(x) }).load('./models/mound.glb');
    assert.equal(model.triangles, 2048);
    return said.join('\n');
  };
  const base = { id: 'fox-grove', name: 'Fox Grove', players: { min: 1, max: 4 } };
  const withGame = async (name, game) => {
    writeFileSync(join(gdir, 'game.json'), JSON.stringify(game));
    // The same file on disk for all three: the check and the import read it themselves; the build reads the object.
    const onDisk = JSON.parse(readFileSync(join(gdir, 'game.json'), 'utf8'));
    writeFileSync(join(gdir, 'public', 'models', 'as-made.glb'), bytes);
    recordAsset(dir, 'fox-grove', { id: 'as-made', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/as-made.glb', sha256: shaOf(bytes) }], license: { kind: 'own' } });
    const check = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
    const added = await importModel(dir, 'fox-grove', raw, { as: `added-${name}`, kind: 'prop', license: 'own' });
    return { loader: await loaderSays(name, onDisk), define: modelBudgetsOf(onDisk), check, problems: check.rows.find((x) => x.id === 'as-made').problems.join('\n'), added, tiers: budgetsFor(null, onDisk) };
  };
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });

  // 1. A 3D starter's `"assets": "library"` (a string): no budgets declared, to any of the three. A prop's defaults.
  const starter = JSON.parse(readFileSync(join(PKG, 'starters', 'gem-rush-3d', 'game.json'), 'utf8'));
  assert.equal(starter.assets, 'library');
  const none = await withGame('starter', { ...base, assets: starter.assets });
  assert.equal(none.define, null);
  assert.equal(gameBudgets({ ...base, assets: starter.assets }), null);
  assert.equal(none.check.budgets.game, null);
  assert.match(none.loader, /2,048 triangles \(its budget is 1,500\)/, 'the loader warns at a prop\'s 1,500');
  assert.match(none.problems, /2048 triangles \(a prop's budget is 1500\)/, 'the check fails it at the same 1,500');
  assert.ok(none.added.after.tris <= 1500, `and an import is made to fit the same 1,500 (${none.added.after.tris})`);

  // 2. The game declares its own: the same model is inside it for all three, at the same numbers.
  const flat = await withGame('flat', { ...base, assets: { budgets: { triangles: 4000, bytes: 600_000 } } });
  assert.deepEqual(flat.define, { triangles: 4000, bytes: 600_000 });
  assert.deepEqual(flat.check.budgets.game, { triangles: 4000, bytes: 600_000 });
  assert.deepEqual([flat.tiers.prop.triangles, flat.tiers.prop.kb], [flat.define.triangles, Math.ceil(flat.define.bytes / 1024)], 'a prop\'s budget in the check is the loader\'s');
  assert.doesNotMatch(flat.loader, /triangles/);
  assert.doesNotMatch(flat.problems, /triangles/);
  assert.equal(flat.added.after.tris, 2048, 'and an import leaves it as it is: it is not made smaller than the game asks');

  // 3. A budget for one tier, and a number past the hard cap: the loader knows no tiers, so it gets the loosest
  //    tier's, and the cap holds for all three. The build takes the tier form without calling it a mistake.
  const warned = [];
  const tiered = { ...base, assets: { budgets: { triangles: 2500, hero: { triangles: 99_999 }, kit: { bytes: 400_000 } } } };
  assert.deepEqual(modelBudgetsOf(tiered, (l) => warned.push(l)), { triangles: 15_000, bytes: 400_000 });
  assert.equal(warned.length, 1, warned.join('\n'));
  assert.match(warned[0], /asks 99999 triangles for a model; 15000 is the most any model may have \(assets check holds the same\)/);
  const byTier = budgetsFor(null, tiered);
  assert.deepEqual([byTier.prop.triangles, byTier.hero.triangles, byTier.kit.kb], [2500, 15_000, 391]);
  assert.equal(Math.max(...['hero', 'npc', 'prop', 'signature', 'kit'].map((k) => byTier[k].triangles)), modelBudgetsOf(tiered).triangles, 'the loader never warns below what the check allows some tier');
  const cut = await withGame('tiered', tiered);
  assert.doesNotMatch(cut.loader, /triangles/);
  assert.doesNotMatch(cut.problems, /triangles/, '2,048 is inside a prop\'s 2,500');
  assert.equal(cut.added.after.tris, 2048);
});

test('assets check measures standalone textures and skies: size, hash, decode, a tier limit, and mipmapped memory once a picture', async () => {
  const { assetsCheck, checkLines, measurePicture } = await import('../lib/asset-check.mjs');
  const dir = studio('textures');
  const gdir = join(dir, 'games', 'fox-grove');
  mkdirSync(join(gdir, 'public', 'art'), { recursive: true });
  mkdirSync(join(gdir, 'drafts'), { recursive: true });
  const grass = await png(2048, 2048); const tile = await png(1024, 1024, '#c9d4e0');
  writeFileSync(join(gdir, 'public', 'art', 'grass.png'), grass);
  writeFileSync(join(gdir, 'public', 'art', 'grass-copy.png'), grass);
  writeFileSync(join(gdir, 'public', 'art', 'tile.png'), tile);
  writeFileSync(join(gdir, 'public', 'art', 'loose.png'), await png(512, 512, '#333333'));
  writeFileSync(join(gdir, 'drafts', 'cover-draft.png'), await png(64, 64));
  const texture = (id, file, bytes, extra = {}) => recordAsset(dir, 'fox-grove', { id, kind: 'texture', route: 'generated', files: [{ role: 'texture', path: `public/art/${file}`, sha256: shaOf(bytes) }], license: { kind: 'generated' }, ...extra });
  texture('grass', 'grass.png', grass);
  texture('tile', 'tile.png', tile);
  let r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  // 2048 x 2048 x 4 x 4/3 = 21.3 MB, and 1024 x 1024 the same way = 5.3 MB: 26.7 MB that used to count as nothing.
  const m = r.rows.find((x) => x.id === 'grass');
  assert.deepEqual(m.measured.pictures[0].px, [2048, 2048]);
  assert.equal(m.measured.maxTexturePx, 2048);
  assert.equal(m.ok, true);
  assert.match(m.warnings.join('\n'), /2048 x 2048 px: about 21\.3 MB of picture memory with mipmaps/);
  assert.equal(r.totals.textureMB, 26.7);
  assert.equal(r.totals.standaloneTextureMB, 26.7);
  assert.equal(r.scope, 'inventory-estimate');
  // The same picture under a second record (a copy at another path) is one picture in memory.
  texture('grass-again', 'grass-copy.png', grass);
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.equal(r.totals.textureMB, 26.7, 'counted once per unique picture');
  // Shipped pictures with no record are named apart from pictures the build never ships, and neither is summed.
  assert.deepEqual(r.unrecordedPictures.shipped.map((p) => p.path), ['public/art/loose.png']);
  assert.deepEqual(r.unrecordedPictures.shipped[0].px, [512, 512]);
  assert.deepEqual(r.unrecordedPictures.notShipped, ['drafts/cover-draft.png']);
  // A changed file, a file that does not decode, and one past the hard limit.
  writeFileSync(join(gdir, 'public', 'art', 'tile.png'), await png(1024, 1024, '#000000'));
  writeFileSync(join(gdir, 'public', 'art', 'torn.png'), grass.subarray(0, 60));
  writeFileSync(join(gdir, 'public', 'art', 'wide.png'), await png(4097, 8));
  texture('torn', 'torn.png', grass.subarray(0, 60));
  texture('wide', 'wide.png', readFileSync(join(gdir, 'public', 'art', 'wide.png')));
  recordAsset(dir, 'fox-grove', { id: 'terrain', kind: 'environment', route: 'procedural', license: { kind: 'own' } });
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.match(r.rows.find((x) => x.id === 'tile').warnings.join('\n'), /changed since it was recorded/);
  assert.equal(r.rows.find((x) => x.id === 'torn').ok, false);
  assert.match(r.rows.find((x) => x.id === 'torn').problems.join('\n'), /does not decode/);
  assert.match(r.rows.find((x) => x.id === 'wide').problems.join('\n'), /4097 x 8 px \(at most 2048 px a side for a texture\)/);
  assert.equal((await measurePicture(join(gdir, 'public', 'art', 'torn.png'))).px, null);
  // Nothing measured is never a plain "ok": the procedural terrain says what it is.
  const terrain = r.rows.find((x) => x.id === 'terrain');
  assert.equal(terrain.measured, null);
  assert.match(terrain.unmeasured, /drawn by the game's code/);
  const text = checkLines(r).join('\n');
  assert.match(text, /\?\? {3}terrain .*not measured/);
  assert.doesNotMatch(text, /ok {3}terrain/);
  assert.match(text, /ok {3}grass \(texture[^\n]*2048 x 2048 px, 21\.3 MB of picture memory with mipmaps/);
  assert.match(text, /1 shipped picture with no record[^\n]*NOT in the sums/);
  assert.match(text, /1 picture in the game's folder that the build never ships/);
  // The whole result is called what it is, with what it cannot see.
  assert.match(text, /an inventory estimate from the recorded files; the running game was not measured/);
  assert.match(text, /inventory estimate: about \d+ draw calls/);
  assert.match(text, /not measured here: geometry the game's code builds[^\n]*copies the code draws[^\n]*effects and particles[^\n]*shadow passes/);
  assert.ok(r.estimate.unmeasured.length >= 4 && r.estimate.kind === 'inventory');
  // A Radiance sky: its size from its header, as half floats.
  writeFileSync(join(gdir, 'public', 'art', 'dusk.hdr'), Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 512 +X 1024\n'));
  const sky = await measurePicture(join(gdir, 'public', 'art', 'dusk.hdr'));
  assert.deepEqual(sky.px, [1024, 512]);
  assert.equal(sky.gpuBytes, Math.round(1024 * 512 * 8 * (4 / 3)));
});

test('assets check: unused normal and roughness maps are counted until the manifest declares base colour only; game.json assets.budgets is honoured; an unused asset leaves the scene sums', async () => {
  const { assetsCheck, budgetsFor, checkLines } = await import('../lib/asset-check.mjs');
  const { lineupScopes } = await import('../lib/style-board.mjs');
  const { setUsage, usageOf, writeManifest } = await import('../lib/asset-manifest.mjs');
  const dir = studio('maps');
  const gdir = join(dir, 'games', 'fox-grove');
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });
  const wall = await modelGlb({ triangles: 2000, base: await png(16, 16), normal: await png(1024, 1024, '#8080ff') });
  const box = Buffer.from(await placeholderGlb([1, 1, 1]));
  writeFileSync(join(gdir, 'public', 'models', 'wall.glb'), wall);
  writeFileSync(join(gdir, 'public', 'models', 'old-tree.glb'), box);
  recordAsset(dir, 'fox-grove', { id: 'wall', kind: 'prop', tier: 'signature', route: 'imported', files: [{ role: 'model', path: 'public/models/wall.glb', sha256: shaOf(wall) }], license: { kind: 'own' } });
  recordAsset(dir, 'fox-grove', { id: 'old-tree', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/old-tree.glb', sha256: shaOf(box) }], license: { kind: 'own' } });
  // No game.json at all (a planned game): the budgets are the defaults, and nothing throws.
  let r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.equal(r.budgets.game, null);
  assert.equal(r.totals.textureMB, 5.3, 'the 1024 px normal map is counted: nothing says the game drops it');
  assert.equal(r.totals.unusedMapMB, 0);
  assert.match(r.notes.join('\n'), /5\.3 MB of the picture memory is normal and roughness maps\. They are counted, because nothing says otherwise[\s\S]*"inGame": \{ "maps": "base" \}/);
  assert.equal(r.totals.triangles, 2012);

  // Declared for the whole manifest: the maps leave the sum, and the row says they still ship.
  const m = readManifest(dir, 'fox-grove');
  m.inGame = { maps: 'base' };
  writeManifest(dir, 'fox-grove', m);
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.equal(r.totals.textureMB, 0);
  assert.equal(r.totals.unusedMapMB, 5.3);
  assert.match(r.rows.find((x) => x.id === 'wall').warnings.join('\n'), /left out of picture memory: declared base colour only.*still ships them/);
  assert.doesNotMatch(r.notes.join('\n'), /counted, because nothing says otherwise/);
  // One record can say otherwise (a PBR weapon in a painted game keeps its maps).
  const m2 = readManifest(dir, 'fox-grove');
  m2.assets.find((a) => a.id === 'wall').inGame = { maps: 'all' };
  writeManifest(dir, 'fox-grove', m2);
  assert.equal((await assetsCheck(dir, 'fox-grove', { validate: false, write: false })).totals.textureMB, 5.3);

  // game.json assets.budgets: the same key the loader's warnings read. 2,000 triangles is over a prop's 1,500 until
  // the game declares its own model budget; a hero is never lowered to it; a hard cap is never passed.
  const tree = await modelGlb({ triangles: 2000 });
  writeFileSync(join(gdir, 'public', 'models', 'pine.glb'), tree);
  recordAsset(dir, 'fox-grove', { id: 'pine', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/pine.glb', sha256: shaOf(tree) }], license: { kind: 'own' } });
  writeFileSync(join(gdir, 'game.json'), JSON.stringify({ id: 'fox-grove', name: 'Fox Grove', players: { min: 1, max: 4 } }));
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.match(r.rows.find((x) => x.id === 'pine').problems.join('\n'), /2000 triangles \(a prop's budget is 1500\)/);
  writeFileSync(join(gdir, 'game.json'), JSON.stringify({ id: 'fox-grove', name: 'Fox Grove', players: { min: 1, max: 4 }, assets: { budgets: { triangles: 4000, bytes: 600_000 } } }));
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.deepEqual(r.rows.find((x) => x.id === 'pine').problems, []);
  assert.deepEqual(r.budgets.game, { triangles: 4000, bytes: 600_000 });
  assert.equal(r.budgets.tiers.prop.triangles, 4000);
  assert.equal(r.budgets.tiers.prop.kb, 586);
  assert.match(checkLines(r).join('\n'), /game\.json assets\.budgets raises a model's budget to 4,000 triangles, 586 KB/);
  const b = budgetsFor(null, { assets: { budgets: { triangles: 4000, hero: { triangles: 99_999 } } } });
  assert.equal(b.kit.triangles, 3000, 'never past a tier\'s hard cap');
  assert.equal(b.hero.triangles, 15_000, 'a tier\'s own number, to its hard cap');
  assert.equal(budgetsFor(null, { assets: { budgets: { triangles: 4000 } } }).hero.triangles, 8000, 'a hero is never lowered to the game\'s model budget');
  assert.deepEqual(budgetsFor(null, { assets: 'library' }), budgetsFor(null), 'a 3D starter writes "assets": "library": a string is no budget, and nothing throws');
  assert.deepEqual(budgetsFor(null, {}), budgetsFor(null));

  // Usage: by kind until a record says; an unused asset is in the inventory lineup only, and out of the scene sums.
  let scopes = lineupScopes(readManifest(dir, 'fox-grove'));
  assert.deepEqual(scopes.cast, ['old-tree', 'pine', 'wall']);
  assert.deepEqual(scopes.unused, []);
  assert.equal(scopes.rows.every((x) => !x.explicit), true, 'an older manifest marks nothing by itself');
  const before = (await assetsCheck(dir, 'fox-grove', { validate: false, write: false })).totals.triangles;
  const used = run(dir, 'assets', 'use', 'fox-grove', 'old-tree', 'unused');
  assert.equal(used.code, 0, used.text + used.err);
  assert.equal(used.out.usage, 'unused');
  assert.deepEqual(setUsage(dir, 'fox-grove', 'wall', 'environment'), { asset: 'wall', usage: 'environment', explicit: true });
  assert.throws(() => setUsage(dir, 'fox-grove', 'wall', 'scenery'), /a usage is one of cast, prop, environment, unused/);
  scopes = lineupScopes(readManifest(dir, 'fox-grove'));
  assert.deepEqual(scopes.inventory, ['old-tree', 'pine', 'wall']);
  assert.deepEqual(scopes.cast, ['pine']);
  assert.deepEqual(scopes.environment, ['wall']);
  assert.deepEqual(scopes.unused, ['old-tree']);
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.equal(r.totals.triangles, before - 12);
  assert.equal(r.rows.find((x) => x.id === 'old-tree').counted, false);
  assert.match(r.notes.join('\n'), /old-tree: marked unused, so left out of the scene sums\. Still in the shipped payload/);
  assert.equal(usageOf({ kind: 'character' }), 'cast');
  assert.equal(usageOf({ kind: 'sky' }), 'environment');
  assert.equal(usageOf({ kind: 'clip' }), null);
  assert.equal(setUsage(dir, 'fox-grove', 'old-tree', 'auto').usage, 'prop');

  // The payload gate keeps its number and its budget; only its name and its words change.
  mkdirSync(join(dir, 'site', 'dist', 'games', 'fox-grove'), { recursive: true });
  writeFileSync(join(dir, 'site', 'dist', 'games', 'fox-grove', 'legacy.glb'), Buffer.alloc(6 * 1024 * 1024));
  r = await assetsCheck(dir, 'fox-grove', { validate: false, write: false });
  assert.equal(r.totals.shippedPayloadMB, 6);
  assert.equal(r.totals.firstPlayMB, 6, 'the old key holds the same number for the cards that read it');
  assert.equal(r.budgets.shippedPayloadMB, 5);
  assert.equal(r.budgets.firstPlayMB, 5);
  assert.deepEqual(r.firstPlay, r.shippedPayload);
  const gate = r.problems.find((p) => /shipped payload/.test(p));
  assert.match(gate, /6 MB of shipped payload: every file of the last build, gzipped \(the budget is 5 MB\)\. It is what the game ships, not what a browser fetched before the first round/);
  assert.equal(r.problems.some((p) => /to download before the first round/.test(p)), false);
  assert.match(checkLines(r).join('\n'), /shipped payload: 6 MB, every file of the last build gzipped \(5 MB\); not a measured first-play download/);
});

test('the lineup is three pictures: the inventory, the cast and the environment, with an unused asset in the inventory only', { skip: !findChrome() && 'no Chrome on this machine' }, async () => {
  const dir = studio('lineups');
  const gdir = join(dir, 'games', 'fox-grove');
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  const add = async (id, kind, size, usage) => {
    const b = Buffer.from(await placeholderGlb(size));
    writeFileSync(join(gdir, 'public', 'models', `${id}.glb`), b);
    recordAsset(dir, 'fox-grove', { id, kind, route: 'imported', files: [{ role: 'model', path: `public/models/${id}.glb`, sha256: shaOf(b) }], license: { kind: 'own' }, ...(usage ? { usage } : {}) });
  };
  await add('fox', 'prop', [0.4, 0.6, 0.8]);
  await add('wall', 'kit', [2, 1, 0.3]);
  await add('old-chibi', 'prop', [0.5, 0.9, 0.5], 'unused');
  assert.throws(() => recordAsset(dir, 'fox-grove', { id: 'x', kind: 'prop', route: 'procedural', license: { kind: 'own' }, usage: 'legacy' }), /a usage: cast, prop, environment, unused/);
  const r = run(dir, 'assets', 'lineup', 'fox-grove');
  assert.equal(r.code, 0, r.text + r.err);
  assert.deepEqual(r.out.lineups.inventory.ids.sort(), ['fox', 'old-chibi', 'wall']);
  assert.deepEqual(r.out.lineups.cast.ids, ['fox']);
  assert.deepEqual(r.out.lineups.environment.ids, ['wall']);
  assert.deepEqual(r.out.unused, ['old-chibi']);
  for (const f of [...Object.values(r.out.lineups.inventory.images), ...Object.values(r.out.lineups.cast.images), ...Object.values(r.out.lineups.environment.images)]) assert.ok(existsSync(join(dir, f)), f);
  assert.equal(r.out.images.front, r.out.lineups.inventory.images.front, 'the inventory keeps the address the lineup always had');
  assert.equal(r.out.rows.find((x) => x.id === 'old-chibi').usage, 'unused');
  assert.equal(r.out.rows.find((x) => x.id === 'fox').usageExplicit, false);
  // In words: the three scopes are named, and which one a review of the game reads.
  const words = spawnSync(process.execPath, [CLI, 'assets', 'lineup', 'fox-grove', '--scope', 'cast'], { cwd: dir, encoding: 'utf8' }).stdout;
  assert.match(words, /Inventory lineup of 3 assets \(every recorded model; \d+ flagged; 1 marked unused, which the game does not draw\)/);
  assert.match(words, /Cast lineup of 1 \(what is in play/);
  assert.doesNotMatch(words, /Environment lineup of/, '--scope cast draws the cast beside the inventory, not the scenery');
  assert.match(words, /old-chibi \[unused\]/);
  assert.match(words, /the inventory lineup is the folder, not the game/);
  assert.match(run(dir, 'assets', 'lineup', 'fox-grove', '--scope', 'everything').out.why, /--scope is one of inventory, cast, environment/);
});
