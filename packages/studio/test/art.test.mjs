/**
 * Art direction and assets (0.22.0): the GLB safety rules (assets/safety.mjs) and the loader that applies them in a
 * browser (assets/assets.ts); decisions with automatic picks, steer, lock, pin by use and the blast radius
 * (lib/decisions.mjs); the asset manifest, RIGHTS.md, the credits and the licence check (lib/asset-manifest.mjs);
 * the optimiser (lib/optimise.mjs); the CLI's `style` and `assets` commands; the build's assets.json and a remix that
 * carries the models it may and leaves grey placeholders for the rest; and the publish refusal. Offline; no Chrome.
 * Run: node --test packages/studio/test/art.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { blastRadius, derivedPrompt, directionsFor, initDecisions, lockDecision, readDecisions, setDecision, staleAssets, steerDecision } from '../lib/decisions.mjs';
import { licenceProblems, readManifest, recordAsset, rightsMarkdown, servedAssets } from '../lib/asset-manifest.mjs';
import { inspectModel, modelTools, optimiseModel, placeholderGlb } from '../lib/optimise.mjs';
import { searchLibrary } from '../lib/library.mjs';

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
  // mystery.glb ships with no record: refused, as is a store file a remix would be handed.
  let problems = licenceProblems(dir, 'fox-grove');
  assert.deepEqual(problems.filter((p) => p.level === 'refuse').map((p) => p.asset), ['public/models/mystery.glb']);
  recordAsset(dir, 'fox-grove', { id: 'mystery', kind: 'prop', route: 'imported', files: [{ role: 'model', path: 'public/models/mystery.glb', sha256: sha }], license: { kind: 'eula:somestore', remix: 'include' } });
  problems = licenceProblems(dir, 'fox-grove');
  assert.match(problems.find((p) => p.asset === 'mystery').problem, /forbids handing the file to remixers/);
  const served = servedAssets(dir, 'fox-grove', join(gdir, 'public'));
  assert.equal(served.assets.find((a) => a.id === 'mystery').license.remix, 'none', 'never served to a remix');
  assert.equal(served.assets.find((a) => a.id === 'mystery').files[0].url, null);
  assert.equal(served.assets.find((a) => a.id === 'tree').files[0].url, 'models/tree.glb');
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

test('build and remix: assets.json names what a remix may carry; the remix gets those by SHA-256 and placeholders for the rest', async () => {
  const dir = studio('original');
  // A real game around the codex, so it builds.
  assert.equal(run(dir, 'game', 'new', 'fox-grove', '--from', 'gem-rush', '--name', 'Fox Grove').code, 0);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  const gdir = join(dir, 'games', 'fox-grove');
  // What its code imports beyond the toolkit: a remix adds three (the starters' own) and only names anything else.
  const gj = JSON.parse(readFileSync(join(gdir, 'game.json'), 'utf8'));
  writeFileSync(join(gdir, 'game.json'), `${JSON.stringify({ ...gj, needs: { three: '0.185.1', 'left-pad': '1.3.0' } }, null, 2)}\n`);
  mkdirSync(join(gdir, 'public', 'models'), { recursive: true });
  const box = Buffer.from(await placeholderGlb([0.6, 0.6, 0.6]));
  const store = Buffer.from(await placeholderGlb([1, 2, 1]));
  writeFileSync(join(gdir, 'public', 'models', 'berry.glb'), box);
  writeFileSync(join(gdir, 'public', 'models', 'statue.glb'), store);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  recordAsset(dir, 'fox-grove', { id: 'berry', kind: 'prop', route: 'library', files: [{ role: 'model', path: 'public/models/berry.glb', sha256: sha(box) }], license: { kind: 'cc0' }, measured: { box: { size: [0.6, 0.6, 0.6] } } });
  recordAsset(dir, 'fox-grove', { id: 'statue', kind: 'prop', route: 'premium', files: [{ role: 'model', path: 'public/models/statue.glb', sha256: sha(store) }], license: { kind: 'market:somestore-123', remix: 'none' }, measured: { box: { size: [1, 2, 1] } } });
  mkdirSync(join(gdir, 'codex'), { recursive: true });
  writeFileSync(join(gdir, 'codex', 'secret.json'), '{"private":true}');
  const built = run(dir, 'build');
  assert.equal(built.code, 0, built.text + built.err);
  const dist = join(dir, 'site', 'dist', 'games', 'fox-grove');
  const source = JSON.parse(readFileSync(join(dist, 'source.json'), 'utf8'));
  assert.ok(source.files['assets/manifest.json'] && source.files['assets/RIGHTS.md'], 'the manifest and RIGHTS.md travel as text');
  assert.ok(!Object.keys(source.files).some((f) => f.startsWith('codex/') || f === 'CODEX.md'), 'the codex never does');
  const served = JSON.parse(readFileSync(join(dist, 'assets.json'), 'utf8'));
  assert.equal(served.assets.find((a) => a.id === 'berry').files[0].url, 'models/berry.glb');

  const http = createServer((req, res) => {
    const file = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/games\/fox-grove\//, '')));
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(readFileSync(file));
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  try {
    const remix = studio('remixer', 'other');
    // Not spawnSync: this process serves the original site meanwhile.
    const r = await new Promise((done) => {
      const p = spawn(process.execPath, [CLI, 'game', 'remix', `http://127.0.0.1:${http.address().port}/games/fox-grove/source.json`, '--id', 'my-grove', '--json'], { cwd: remix });
      let stdout = ''; let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (status) => done({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.assets.fetched.map((x) => x.asset), ['berry']);
    assert.deepEqual(out.assets.placeholders.map((x) => x.asset), ['statue']);
    const rg = join(remix, 'games', 'my-grove');
    assert.equal(sha(readFileSync(join(rg, 'public', 'models', 'berry.glb'))), sha(box), 'carried, byte for byte');
    const ph = readFileSync(join(rg, 'public', 'models', 'statue.glb'));
    assert.notEqual(sha(ph), sha(store), 'the store model never left its studio');
    assert.equal(checkGlb(ph).ok, true);
    const m = readManifest(remix, 'my-grove');
    assert.equal(m.assets.find((a) => a.id === 'statue').placeholder, true);
    assert.match(readFileSync(join(rg, 'assets', 'RIGHTS.md'), 'utf8'), /grey placeholder/);
    assert.ok(m.assets.find((a) => a.id === 'berry').from.remixOf.source.endsWith('/source.json'));
    const pkg = JSON.parse(readFileSync(join(remix, 'package.json'), 'utf8'));
    assert.equal(pkg.devDependencies.three, '0.185.1');
    assert.equal(pkg.devDependencies['left-pad'], undefined, 'a remix source never adds a package of its own choosing');
    assert.deepEqual(out.needsNotAdded, ['left-pad']);
  } finally { await new Promise((r) => http.close(r)); }
});

test('publish refuses a public game that ships a model with no licence record', async () => {
  const dir = studio('publish');
  assert.equal(run(dir, 'game', 'new', 'fox-grove', '--from', 'gem-rush').code, 0);
  mkdirSync(join(dir, 'games', 'fox-grove', 'public', 'models'), { recursive: true });
  writeFileSync(join(dir, 'games', 'fox-grove', 'public', 'models', 'found-online.glb'), Buffer.from(await placeholderGlb()));
  const r = run(dir, 'publish');
  assert.notEqual(r.code, 0);
  assert.match(r.text, /licence problem[\s\S]*found-online\.glb/);
});

test('first play counts one file per sound: a browser fetches the .ogg or its .wav fallback, never both', async () => {
  const { firstPlayBytes } = await import('../lib/asset-check.mjs');
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
