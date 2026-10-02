/**
 * The starter library's build tool (scripts/library.mjs), offline and without Chrome: a small raw folder made here
 * (grey box models, a CC0 licence, a pack under another licence, a material, a sky) is built with --no-thumbs; the
 * index must hold to the contract, the other licence must be refused with its reason, `check` must pass, and one
 * changed byte must fail it. Zips, .hdr pictures and licence texts are read as the real sources are.
 * Run: node --test scripts/library.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { addFromLibrary, searchLibrary } from '../packages/studio/lib/library.mjs';
import { modelTools, placeholderGlb } from '../packages/studio/lib/optimise.mjs';
import { buildLibrary, checkLibrary, globRe, licenceVerdict, nameOf, readHdr, readSources, toneMap, unzip, wordsOf } from './library.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), 'library.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'homie-library-test-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); return data; };
const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });

const ITEM_FIELDS = ['id', 'pack', 'item', 'name', 'kind', 'family', 'tags', 'tier', 'file', 'files', 'thumb', 'tris', 'materials', 'drawCalls', 'texturePx', 'heightM', 'box', 'suggestM', 'rigged', 'bones', 'clips', 'paletteSwap', 'colours', 'license', 'author', 'origin', 'source'];

/** A Radiance .hdr, w x h, a bright sky over a dark ground: even rows run-length coded, odd rows flat. */
function hdrBytes(w = 32, h = 16) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const rows = [];
  for (let y = 0; y < h; y++) {
    const rgbe = y < h / 2 ? [100, 150, 250, 129] : [120, 90, 60, 126];
    if (y % 2 === 0) rows.push(Buffer.from([2, 2, w >> 8, w & 255, ...rgbe.flatMap((v) => [128 + w, v])]));
    else rows.push(Buffer.from(Array.from({ length: w }, () => rgbe).flat()));
  }
  return Buffer.concat([head, ...rows]);
}

/** A zip of { name: text } (deflated), as a pack's download would be. */
function zipOf(files) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text); const packed = deflateRawSync(data); const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, packed); central.push(ch, n); offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The raw folder and sources of a tiny library: two Kenney-shaped packs (one not CC0), one material, one sky. */
async function rawLibrary(root) {
  const raw = join(root, 'raw');
  const good = join(raw, 'kenney', 'good');
  const lic = write(join(good, 'License.txt'), '\tGood Kit (1.0)\n\n\tLicense: (Creative Commons Zero, CC0)\n\thttp://creativecommons.org/publicdomain/zero/1.0/\n');
  write(join(good, 'Models', 'GLB format', 'tree_oak.glb'), await placeholderGlb([1, 4, 1], { colour: [0.1, 0.6, 0.2, 1] }));
  write(join(good, 'Models', 'GLB format', 'crate-wood.glb'), await placeholderGlb([1, 1, 1]));
  write(join(good, 'Models', 'GLB format', 'rock_largeA.glb'), await placeholderGlb([1.2, 0.7, 1]));
  write(join(good, 'Models', 'GLB format', 'broken.glb'), 'this is not a model');
  write(join(good, 'Models', 'FBX format', 'tree_oak.fbx'), 'not selected');
  const bad = join(raw, 'kenney', 'bad');
  write(join(bad, 'License.txt'), 'Bad Kit\nLicensed under Creative Commons Attribution 4.0 (CC BY 4.0). Credit is required.\n');
  write(join(bad, 'Models', 'GLB format', 'thing.glb'), await placeholderGlb([1, 1, 1]));
  const { sharp } = await modelTools();
  const pic = (r, g, b) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  write(join(raw, 'ambientcg', 'LICENSE.txt'), 'License information\nAll ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License.\n');
  write(join(raw, 'ambientcg', 'Ground001.json'), JSON.stringify({ displayName: 'Ground 001', tags: ['ground', 'dirt', '001'], displayCategory: 'Ground', dimensionX: 200 }));
  write(join(raw, 'ambientcg', 'Ground001', 'Ground001_1K-JPG_Color.jpg'), await pic(120, 90, 60));
  write(join(raw, 'ambientcg', 'Ground001', 'Ground001_1K-JPG_NormalGL.jpg'), await pic(128, 128, 255));
  write(join(raw, 'ambientcg', 'Ground001', 'Ground001_1K-JPG_Roughness.jpg'), await pic(200, 200, 200));
  write(join(raw, 'polyhaven', 'LICENSE.txt'), 'Asset License\nOur assets are all licensed as CC0, which is effectively Public Domain.\n');
  write(join(raw, 'polyhaven', 'hdris', 'test_sky', 'info.json'), JSON.stringify({ name: 'Test Sky', tags: ['clear'], categories: ['outdoor', 'skies'] }));
  write(join(raw, 'polyhaven', 'hdris', 'test_sky', 'test_sky_1k.hdr'), hdrBytes());
  write(join(raw, 'fetched.json'), JSON.stringify({ v: 1, packs: { 'test-good': { url: 'https://example.org/good.zip', sha256: sha(Buffer.from('zip')), bytes: 3, fetched: '2026-10-02' } } }));
  const kenney = (id, slug, theme) => ({ id, label: `Test ${slug}`, family: 'kenney', author: 'Kenney', url: `https://kenney.nl/assets/${slug}`, license: 'cc0', source: { kind: 'kenney', slug }, kind: 'prop', tier: 'prop', theme, select: [{ glob: 'Models/GLB format/crate*.glb', tier: 'kit', kind: 'kit' }, 'Models/GLB format/*.glb'] });
  const sources = write(join(root, 'sources.json'), JSON.stringify({ v: 1, packs: [
    kenney('test-good', 'good', ['nature', 'forest']),
    kenney('test-bad', 'bad', ['things']),
    { id: 'test-materials', label: 'Test materials', family: 'ambientcg', author: 'ambientCG', url: 'https://ambientcg.com/', license: 'cc0', source: { kind: 'ambientcg', ids: ['Ground001'] }, kind: 'texture', theme: ['pbr'] },
    { id: 'test-skies', label: 'Test skies', family: 'polyhaven', author: 'Poly Haven', url: 'https://polyhaven.com/hdris', license: 'cc0', source: { kind: 'polyhaven', type: 'hdris', ids: ['test_sky'] }, kind: 'sky', theme: ['lighting'] },
  ] }));
  return { raw, sourcesFile: join(root, 'sources.json'), licence: lic, sources };
}

test('licence texts: CC0 passes with the line that says so; another licence, or none, is refused with the reason', () => {
  const kenney = licenceVerdict('\tLicense: (Creative Commons Zero, CC0)\n\thttp://creativecommons.org/publicdomain/zero/1.0/\n');
  assert.equal(kenney.ok, true);
  assert.equal(kenney.line, 'License: (Creative Commons Zero, CC0)');
  assert.equal(licenceVerdict('This work is dedicated to the public domain.').ok, true);
  const by = licenceVerdict('Licensed under CC BY 4.0');
  assert.equal(by.ok, false);
  assert.match(by.why, /does not say CC0/);
  const mixed = licenceVerdict('Models: CC0. Textures: Attribution-NonCommercial 4.0.');
  assert.equal(mixed.ok, false);
  assert.match(mixed.why, /another licence/);
  assert.equal(licenceVerdict('Copyright 2026. All rights reserved. Some files CC0.').ok, false);
  assert.equal(licenceVerdict('').ok, false);
});

test('words, names and globs read pack file names the way the packs write them', () => {
  assert.deepEqual(wordsOf('tree_pineTallA_detailed'), ['tree', 'pine', 'tall', 'a', 'detailed']);
  assert.deepEqual(wordsOf('Primitive_Slope_Half_InnerCorner'), ['primitive', 'slope', 'half', 'inner', 'corner']);
  assert.equal(nameOf(['tree', 'oak']), 'Oak tree');
  assert.equal(nameOf(['rock', 'large', 'a']), 'Rock large A');
  assert.equal(nameOf(['animal', 'fox']), 'Fox');
  assert.ok(globRe('Models/GLB format/{block,platform}*.glb').test('Models/GLB format/platform-ramp.glb'));
  assert.ok(!globRe('Models/GLB format/*.glb').test('Models/GLB format/sub/x.glb'));
  assert.ok(globRe('**/Assets/gltf/**/*.gltf').test('addons/x/Assets/gltf/tiles/coast/hex_coast_A.gltf'));
});

test('zips unpack as shipped, and a name that climbs out of its folder is refused', () => {
  const dir = join(scratch, 'unzip');
  const files = unzip(zipOf({ 'repo-main/License.txt': 'CC0', 'repo-main/Models/a.txt': 'aaaa' }), dir, { strip: 1 });
  assert.deepEqual(files, ['License.txt', 'Models/a.txt']);
  assert.equal(readFileSync(join(dir, 'Models', 'a.txt'), 'utf8'), 'aaaa');
  assert.throws(() => unzip(zipOf({ '../evil.txt': 'x' }), join(scratch, 'unzip2')), /outside its own folder/);
  assert.throws(() => unzip(Buffer.from('not a zip at all, just words'), join(scratch, 'unzip3')), /not a zip/);
});

test('an .hdr is read in both scanline codings and tone-mapped for its preview', () => {
  const img = readHdr(hdrBytes(32, 16));
  assert.equal(img.width, 32);
  assert.equal(img.height, 16);
  const px = (x, y) => [...img.data.subarray((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)];
  assert.deepEqual(px(5, 0), px(5, 1));                 // a run-length row and a flat row of the same colour
  assert.ok(px(5, 0)[2] > px(5, 12)[2] * 4);            // the sky is brighter than the ground
  const ldr = toneMap(img);
  assert.equal(ldr.length, 32 * 16 * 3);
  assert.ok(ldr[2] > ldr[(12 * 32) * 3 + 2]);
  assert.throws(() => readHdr(Buffer.from('P6\n1 1\n255\n')), /not a Radiance/);
});

test('build --no-thumbs: the index holds to the contract, a non-CC0 pack is refused, check passes, one changed byte fails it', async () => {
  const root = join(scratch, 'lib');
  const { raw, sourcesFile, licence } = await rawLibrary(root);
  const out = join(root, 'out');
  const built = cli('build', '--raw', raw, '--out', out, '--sources', sourcesFile, '--no-thumbs');
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /refused test-bad: its licence text does not say CC0/);
  const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));

  // The head and the counts.
  assert.deepEqual(Object.keys(index).slice(0, 6), ['v', 'kind', 'version', 'built', 'tool', 'counts']);
  assert.equal(index.kind, 'homie-starter-library');
  assert.equal(index.version, 'v0');
  assert.equal(index.tool, 'scripts/library.mjs');
  assert.deepEqual(index.counts.byKind, { prop: 2, kit: 1, texture: 1, sky: 1 });
  assert.deepEqual(index.counts.byFamily, { kenney: 3, ambientcg: 1, polyhaven: 1 });
  assert.equal(index.counts.items, 5);
  assert.equal(index.counts.packs, 3);

  // The refused pack and the skipped file, each with its reason.
  assert.deepEqual(index.packs.map((p) => p.id), ['test-good', 'test-materials', 'test-skies']);
  assert.equal(index.refused.length, 1);
  assert.equal(index.refused[0].pack, 'test-bad');
  assert.match(index.refused[0].why, /CC0/);
  assert.ok(!existsSync(join(out, 'licenses', 'test-bad.txt')));
  assert.ok(!existsSync(join(out, 'items', 'test-bad')));
  assert.equal(index.skipped.length, 1);
  assert.equal(index.skipped[0].source, 'Models/GLB format/broken.glb');
  assert.match(index.skipped[0].why, /could not be optimised/);

  // Packs: the licence copied as shipped, the source from fetched.json.
  const good = index.packs[0];
  assert.deepEqual(Object.keys(good), ['id', 'label', 'family', 'author', 'url', 'license', 'licenseFile', 'source', 'items']);
  assert.deepEqual(readFileSync(join(out, good.licenseFile)), Buffer.from(licence));
  assert.deepEqual(good.source, { url: 'https://example.org/good.zip', sha256: sha(Buffer.from('zip')), bytes: 3, fetched: '2026-10-02' });
  assert.equal(good.items, 3);

  // Items: every field, in order; every file's size and SHA-256 are the bytes on disk.
  for (const it of index.items) {
    assert.deepEqual(Object.keys(it).slice(0, ITEM_FIELDS.length), ITEM_FIELDS, it.id);
    assert.equal(it.license, 'cc0');
    assert.equal(it.id, `${it.pack}/${it.item}`);
    for (const f of it.files) {
      const bytes = readFileSync(join(out, f.path));
      assert.equal(f.bytes, bytes.length, f.path);
      assert.equal(f.sha256, sha(bytes), f.path);
    }
  }
  const byId = Object.fromEntries(index.items.map((it) => [it.id, it]));
  const tree = byId['test-good/tree-oak'];
  assert.equal(tree.name, 'Oak tree');
  assert.equal(tree.kind, 'prop');
  assert.equal(tree.tier, 'prop');
  assert.equal(tree.file, 'items/test-good/tree-oak.glb');
  assert.equal(tree.thumb, null);                        // --no-thumbs: no model thumbnails, no Chrome
  assert.equal(tree.tris, 12);
  assert.equal(tree.heightM, 4);
  assert.deepEqual(tree.box, [1, 4, 1]);
  assert.equal(tree.suggestM, 4);
  assert.equal(tree.rigged, false);
  assert.equal(tree.paletteSwap, true);
  assert.ok(tree.colours.length >= 1);
  assert.ok(['tree', 'oak', 'plant', 'nature', 'forest'].every((t) => tree.tags.includes(t)), tree.tags.join());
  assert.equal(tree.source, 'Models/GLB format/tree_oak.glb');
  assert.equal(tree.origin, 'https://kenney.nl/assets/good');
  assert.equal(byId['test-good/crate-wood'].kind, 'kit');  // the first select entry that matches decides
  assert.equal(byId['test-good/crate-wood'].tier, 'kit');
  assert.equal(byId['test-good/rock-large-a'].suggestM, 0.8);
  const ground = byId['test-materials/ground-001'];
  assert.equal(ground.name, 'Ground 001');
  assert.deepEqual(ground.files.map((f) => [f.role, f.map, f.path]), [['texture', 'basecolor', 'textures/test-materials/ground-001/basecolor.webp'], ['texture', 'normal', 'textures/test-materials/ground-001/normal.webp'], ['texture', 'arm', 'textures/test-materials/ground-001/arm.webp']]);
  assert.equal(ground.tileM, 2);
  assert.ok(existsSync(join(out, ground.thumb)));        // materials and skies are pictures already: they keep theirs
  const { sharp } = await modelTools();
  const arm = await sharp(join(out, 'textures/test-materials/ground-001/arm.webp')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(arm.info.width, 1024);
  assert.ok(Math.abs(arm.data[0] - 255) < 8 && Math.abs(arm.data[1] - 200) < 8 && arm.data[2] < 8, `arm ${arm.data.subarray(0, 3).join()}`);
  const sky = byId['test-skies/test-sky'];
  assert.deepEqual(sky.files.map((f) => f.role), ['sky', 'preview']);
  assert.deepEqual(readFileSync(join(out, sky.file)), hdrBytes());
  assert.equal(searchLibrary(index, 'tree')[0].item.id, 'test-good/tree-oak');

  // The studio takes a model, a material and a sky from it into a game (copied, checked, recorded).
  const studio = join(root, 'studio');
  mkdirSync(join(studio, 'games', 'demo'), { recursive: true });
  const lib = { kind: 'dir', base: out };
  for (const id of ['test-good/tree-oak', 'test-materials/ground-001', 'test-skies/test-sky']) {
    const added = await addFromLibrary(studio, 'demo', id, { lib, index });
    assert.equal(added.ok, true, id);
  }
  assert.ok(existsSync(join(studio, 'games', 'demo', 'public', 'tex', 'ground-001', 'arm.webp')));
  assert.ok(existsSync(join(studio, 'games', 'demo', 'public', 'sky', 'test-sky', 'sky.hdr')));

  // check passes, then fails on one changed byte, naming the file.
  const ok = cli('check', '--out', out);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /5 items in 3 packs/);
  assert.match(ok.stdout, /check: ok/);
  assert.equal(checkLibrary(out).ok, true);
  const crate = join(out, 'items', 'test-good', 'crate-wood.glb');
  const bytes = readFileSync(crate);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(crate, bytes);
  const bad = cli('check', '--out', out);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /crate-wood\.glb: its SHA-256 does not match/);

  // --only rebuilds one pack and keeps the others.
  const again = await buildLibrary({ raw, out, only: 'test-good', thumbs: false, sources: readSources(sourcesFile), log: () => {} });
  assert.equal(again.index.counts.items, 5);
  assert.equal(checkLibrary(out).ok, true);
  const search = cli('search', 'oak', 'tree', '--out', out);
  assert.match(search.stdout, /test-good\/tree-oak/);
});

test('the real sources list is well formed: CC0 only, known families, a select for every model pack', () => {
  const packs = readSources();
  assert.ok(packs.length >= 30);
  for (const p of packs) {
    assert.equal(p.license, 'cc0', p.id);
    if (p.source.kind === 'kenney' || p.source.kind === 'github') assert.ok(p.select?.length, `${p.id} selects nothing`);
    else assert.ok(p.source.ids?.length, `${p.id} lists no ids`);
  }
  assert.ok(['kenney-cube-pets', 'kenney-food-kit', 'kenney-nature-kit'].every((id) => packs.some((p) => p.id === id)));
});
