/**
 * `homie-studio collision`: a model's height grid beside it, tied to the model by a checksum, with authored proxies
 * and routes a bot walks (lib/collision.mjs, on @homie-rocks/heightfield).
 *
 *   - bake: a model's triangles with every node's transform applied, the grid, the plan at true scale;
 *   - check: the authored routes pass and are walked; a route off the model fails with the place it fell; a re-bake
 *     keeps what a person authored; a model whose surface moved is stale, one whose surface did not is not;
 *   - the CLI.
 * Run after `npm run build`: node --test packages/studio/test/collision.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collisionBake, collisionCheck, collisionSvg, heightfieldModules, modelTriangles } from '../lib/collision.mjs';
import { modelTools } from '../lib/optimise.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-collision-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A landmark as a generator exports one: a deck 6 m by 2 m modelled at the origin on a node lifted 2 m, and a ramp
 * from its +z edge down to the ground. `lift` moves the deck (the model "optimised again"); `tint` changes a
 * material only (the file changes, the surface does not).
 */
async function landmarkGlb({ lift = 2, tint = 0.5 } = {}) {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const mat = doc.createMaterial('hull').setBaseColorFactor([tint, tint, tint, 1]);
  const quad = (a, b, c, d) => doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([...a, ...b, ...c, ...d])).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  const scene = doc.createScene('scene');
  scene.addChild(doc.createNode('deck').setTranslation([0, lift, 0]).setMesh(doc.createMesh('deck').addPrimitive(quad([-3, 0, -1], [3, 0, -1], [3, 0, 1], [-3, 0, 1]))));
  scene.addChild(doc.createNode('ramp').setMesh(doc.createMesh('ramp').addPrimitive(quad([-3, lift, 1], [3, lift, 1], [3, 0, 5], [-3, 0, 5]))));
  return io.writeBinary(doc);
}

/** A folder that is a studio with one game, and the landmark in its assets. */
async function studio(name) {
  const root = join(scratch, name);
  const assets = join(root, 'games', 'yard', 'assets', 'models');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(root, 'studio.json'), JSON.stringify({ name: 'Test Studio' }));
  writeFileSync(join(root, 'games', 'yard', 'game.json'), JSON.stringify({ id: 'yard', name: 'Yard', entry: 'src/main.ts' }));
  writeFileSync(join(assets, 'landmark.glb'), await landmarkGlb());
  return { root, model: join(assets, 'landmark.glb'), side: join(assets, 'landmark.collision.json'), plan: join(assets, 'landmark.collision.svg') };
}

test('bake: the triangles in the scene\'s own space, a grid beside the model, and the plan at true scale', async () => {
  const s = await studio('bake');
  const tris = await modelTriangles(readFileSync(s.model));
  assert.equal(tris.indices.length, 12);
  assert.deepEqual([...tris.positions.slice(0, 3)], [-3, 2, -1], 'the deck\'s node is 2 m up, and so are its vertices');
  const r = await collisionBake(s.root, 'yard', 'landmark.glb', { cell: 0.25 });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual([r.file, r.plan, r.cell, r.triangles], ['games/yard/assets/models/landmark.collision.json', 'games/yard/assets/models/landmark.collision.svg', 0.25, 4]);
  assert.match(r.checksum, /^[0-9a-f]{16}$/);
  assert.ok(r.rows.every((row) => row.ok), JSON.stringify(r.rows));
  const side = JSON.parse(readFileSync(s.side, 'utf8'));
  assert.deepEqual([side.v, side.model, side.proxies, side.routes, side.mover.arrival], [1, 'landmark.glb', [], [], 1]);
  assert.match(side.sha256, /^[0-9a-f]{64}$/);
  // The game's side of it: unpack, and stand on the deck.
  const H = await heightfieldModules(s.root);
  const field = H.bakeField(H.unpackBake(side.bake));
  assert.equal(field.heightAt(0, 0), 2);
  assert.ok(Math.abs(field.heightAt(0, 3) - 1) < 1e-3);
  assert.equal(H.bakeStale(H.unpackBake(side.bake), tris), null);
  // The plan: 40 px to the metre, so the 6 m deck, a 0.25 m post of padding and a metre of margin each side is 340 px.
  const svg = readFileSync(s.plan, 'utf8');
  assert.equal(svg.split('\n')[0].includes('viewBox="0 0 340 370"'), true, svg.split('\n')[0]);
  assert.match(svg, /1 m · landmark\.glb · 0\.25 m cell · heights 0\.00 to 2\.00 m/);
  assert.ok((svg.match(/<rect /g) ?? []).length > 10, 'shaded by height');
  // What cannot be baked says why.
  assert.match((await collisionBake(s.root, 'yard', 'nothing.glb')).why, /nothing\.glb is not in games\/yard$/);
  assert.match((await collisionBake(s.root, 'yard', 'landmark.glb', { cell: 0 })).why, /--cell is metres/);
  assert.match((await collisionBake(s.root, 'nope', 'landmark.glb')).why, /no game nope/);
});

test('check: authored routes are walked, a route off the model fails where it fell, and a re-bake keeps what was authored', async () => {
  const s = await studio('check');
  await collisionBake(s.root, 'yard', 'landmark.glb');
  const side = JSON.parse(readFileSync(s.side, 'utf8'));
  side.mover = { ...side.mover, arrival: 0.4 };
  side.proxies = [{ kind: 'cylinder', id: 'mast', x: -2, y: 2, z: 0, r: 0.3, h: 4, walkTop: false }];
  side.routes = [{ name: 'up the ramp', path: [{ x: 0, y: 0, z: 4.8 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }] }];
  writeFileSync(s.side, JSON.stringify(side));
  const ok = await collisionCheck(s.root, 'yard');
  assert.equal(ok.ok, true, ok.why);
  assert.deepEqual(ok.models[0].rows.map((r) => r.label), ['model', 'proxies', 'route up the ramp']);
  assert.match(ok.models[0].rows[2].note, /walked \d+\.\d m in \d+\.\d s with a 0\.4 m arrival radius/);
  // A second route walks off the end of the deck, and a third into the mast.
  side.routes.push({ name: 'off the end', path: [{ x: 0, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }] }, { name: 'through the mast', path: [{ x: 0, y: 2, z: 0 }, { x: -2.5, y: 2, z: 0 }] });
  writeFileSync(s.side, JSON.stringify(side));
  const bad = await collisionCheck(s.root, 'yard', 'landmark.glb');
  assert.equal(bad.ok, false);
  const rows = Object.fromEntries(bad.models[0].rows.map((r) => [r.label, r]));
  assert.equal(rows['route up the ramp'].ok, true);
  assert.match(rows['route off the end'].note, /the bot fell at 3\.\d+, 0\.00 heading for point 1/);
  assert.match(rows['route through the mast'].note, /mast is in the way.*the bot was blocked at/);
  assert.match(bad.why, /FAIL route off the end[\s\S]*1 of 1 collision file\(s\) need attention/);
  assert.equal((readFileSync(s.plan, 'utf8').match(/stroke="#ff3355"/g) ?? []).length >= 2, true, 'the plan marks where each failed');
  // Baked again (another cell): the mast, the mover and the routes are still there.
  const again = await collisionBake(s.root, 'yard', 'landmark.glb', { cell: 0.5 });
  assert.equal(again.cell, 0.5);
  const kept = JSON.parse(readFileSync(s.side, 'utf8'));
  assert.deepEqual([kept.proxies[0].id, kept.mover.arrival, kept.routes.length, kept.bake.cell], ['mast', 0.4, 3, 0.5]);
  // A malformed proxy is named, and a game with nothing baked says how to start.
  kept.proxies.push({ kind: 'box', id: 'slab', x: 0, y: 0, z: 0, hx: 1, hz: 1, h: 0 });
  writeFileSync(s.side, JSON.stringify(kept));
  assert.match((await collisionCheck(s.root, 'yard')).why, /FAIL proxies: slab: h \(its height in metres\) must be more than 0/);
  const empty = await studio('empty');
  assert.match((await collisionCheck(empty.root, 'yard')).lines[0], /No collision files in games\/yard/);
});

test('stale: a model whose surface moved fails by name; one that changed without moving does not', async () => {
  const s = await studio('stale');
  await collisionBake(s.root, 'yard', 'landmark.glb');
  assert.equal((await collisionCheck(s.root, 'yard')).ok, true);
  // The same triangles, another material: a different file, the same collider.
  writeFileSync(s.model, await landmarkGlb({ tint: 0.9 }));
  const tinted = await collisionCheck(s.root, 'yard');
  assert.equal(tinted.ok, true, tinted.why);
  assert.equal(tinted.models[0].rows[0].note, 'the file changed, its triangles did not');
  // The deck 40 cm higher: every figure on the old grid would be standing inside it.
  writeFileSync(s.model, await landmarkGlb({ lift: 2.4 }));
  const moved = await collisionCheck(s.root, 'yard');
  assert.equal(moved.ok, false);
  assert.match(moved.models[0].rows[0].note, /^stale: the mesh changed since the bake \(checksum [0-9a-f]{16}, the bake read [0-9a-f]{16}\): bake it again$/);
  rmSync(s.model);
  assert.match((await collisionCheck(s.root, 'yard')).models[0].rows[0].note, /landmark\.glb is not beside its collision file/);
});

test('the plan draws proxies, routes and problem marks at 40 px to the metre', async () => {
  const H = await heightfieldModules(null);
  const bake = H.bakeMesh({ positions: [0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 0, 4, 0, 4, 0, 0, 4] }, { cell: 1, pad: 0 });
  const svg = collisionSvg(bake, { title: 'pad', proxies: [{ kind: 'box', id: 'crate <1>', x: 2, y: 0, z: 2, hx: 0.5, hz: 0.5, h: 1 }, { kind: 'cylinder', x: 1, y: 0, z: 1, r: 0.25, h: 2 }], routes: [{ name: 'a', path: [{ x: 0, z: 0 }, { x: 4, z: 4 }] }], problems: [{ x: 3, z: 3, why: 'fell' }] });
  assert.match(svg, /<polygon points="100\.0,100\.0 140\.0,100\.0 140\.0,140\.0 100\.0,140\.0"/, 'a 1 m crate at (2, 2) is 40 px square, a metre of margin in');
  assert.match(svg, /<circle cx="80\.0" cy="80\.0" r="10\.0"/);
  assert.match(svg, /<polyline points="40\.0,40\.0 200\.0,200\.0"/);
  assert.match(svg, /crate &lt;1&gt;: 1 m high/, 'names are escaped');
  assert.match(svg, /<title>fell<\/title>/);
});

test('the CLI: collision bake and collision check, in words and as JSON', async () => {
  const s = await studio('cli');
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: s.root, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0' }, timeout: 120_000 });
  const bake = run(['collision', 'bake', 'yard', 'landmark.glb', '--cell', '0.5']);
  assert.equal(bake.status, 0, bake.stderr + bake.stdout);
  assert.match(bake.stdout, /Baked games\/yard\/assets\/models\/landmark\.glb: \d+ x \d+ posts at 0\.5 m/);
  assert.match(bake.stdout, /ok {3}model: the file that was baked/);
  const check = run(['collision', 'check', 'yard', '--json']);
  assert.equal(check.status, 0, check.stderr + check.stdout);
  assert.equal(JSON.parse(check.stdout).models[0].ok, true);
  writeFileSync(s.model, await landmarkGlb({ lift: 3 }));
  const stale = run(['collision', 'check', 'yard']);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /FAIL model: stale: the mesh changed since the bake/);
  assert.match(run(['collision']).stdout, /collision bake <game> <model\.glb>/);
});

test('in chat: collision_bake and collision_check are tools, and work in a studio that installed nothing but the toolkit', async () => {
  // ACROSS THE SEAM: the chat server's registry and handlers, through the studio's CLI, to lib/collision.mjs and
  // the real @homie-rocks/heightfield. A creator never types `homie-studio collision`.
  // The package is not a dependency of the toolkit (a pin that is not on npm yet would stop a new studio's install):
  // here it is found beside the toolkit, in this repository's workspace.
  assert.equal(JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).dependencies['@homie-rocks/heightfield'], undefined);
  const s = await studio('chat');
  assert.ok(await heightfieldModules(s.root), 'found beside the toolkit: this studio has no node_modules of its own');
  const { mcpServer } = await import('./card-host.mjs');
  const mcp = mcpServer(process.execPath, [CLI, 'mcp', '--studios', scratch, '--no-install'], { cwd: s.root });
  try {
    await mcp.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const tools = Object.fromEntries((await mcp.request('tools/list', {})).result.tools.map((t) => [t.name, t]));
    for (const name of ['collision_bake', 'collision_check']) assert.ok(tools[name], `${name} is listed, named like asset_check and asset_add beside it`);
    assert.deepEqual(tools.collision_bake.inputSchema.required, ['model']);
    assert.match(tools.collision_bake.description, /fall through/);
    const call = async (name, args) => (await mcp.request('tools/call', { name, arguments: args })).result;
    const bake = await call('collision_bake', { game: 'yard', model: 'landmark.glb', cell: 0.5 });
    assert.equal(bake.isError, undefined, bake.content[0].text);
    assert.match(bake.content[0].text, /Baked games\/yard\/assets\/models\/landmark\.glb: \d+ x \d+ posts at 0\.5 m/);
    assert.equal(bake.structuredContent.file, 'games/yard/assets/models/landmark.collision.json');
    const side = JSON.parse(readFileSync(s.side, 'utf8'));
    assert.equal(side.bake.cell ?? side.bake.c ?? 0.5, 0.5);
    const fine = await call('collision_check', { game: 'yard' });
    assert.equal(fine.isError, undefined, fine.content[0].text);
    assert.match(fine.content[0].text, /ok {3}model: the file that was baked/);
    // The model is optimised again and its deck moves: the same gate, in chat, by name.
    writeFileSync(s.model, await landmarkGlb({ lift: 3 }));
    const stale = await call('collision_check', { game: 'yard', model: 'landmark.glb' });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /FAIL model: stale: the mesh changed since the bake/);
    assert.match(stale.content[0].text, /1 of 1 collision file\(s\) need attention/);
    assert.equal((await call('collision_bake', { game: 'yard', model: 'nope.glb' })).isError, true);
  } finally { await mcp.close(); }
});
