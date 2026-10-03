/**
 * Characters, rigs and clips (0.25.0): the skeleton standard (lib/rig.mjs: Mixamo, KayKit, Meshy, Kenney's mini and
 * pets, the spine chain by the tree), the shipped character (renamed, helper bones gone, held things merged into one
 * skinned mesh, measured through its bones), retargeting (lib/clips.mjs: a T-pose clip onto an A-pose rig under a
 * centimetre armature, a whole limb onto a one-piece arm), the clip library and its sharing, the game-level pipeline
 * (lib/characters.mjs: assets add, anim plan, anim add), assets check for skinned meshes, the cast and anim CLI, the
 * MCP tools and the animation card's data, style init keeping a starter's look, and the hero-rush-3d starter (text
 * only; game new bakes its characters; it builds with one three.js). Offline; no Chrome; synthetic rigs only.
 * Run: node --test packages/studio/test/characters.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { modelTools, placeholderGlb, skinnedBounds } from '../lib/optimise.mjs';
import { mapSkeleton, normaliseRig, skeletonOf } from '../lib/rig.mjs';
import { VERB_IDS, bakeLibrary, findClip, rigOf, writeLibrary as writeClips } from '../lib/clips.mjs';
import { addCharacter, animPlan, bakeClips, verbsFor } from '../lib/characters.mjs';
import { readManifest } from '../lib/asset-manifest.mjs';
import { blockyGlb, humanoidGlb, writeLibrary } from './rig-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-characters-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (cwd, args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env }, timeout: 180_000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  return { code: r.status, out, err: r.stderr, text: r.stdout };
};
const docOf = async (bytes) => { const { io, logger } = await modelTools(); const d = await io.readBinary(bytes); d.setLogger(logger); return d; };

/** A studio with one game (no install: node_modules links to this package and the repo's esbuild and three.js). */
function studio(name, game = 'heroes') {
  const dir = join(scratch, name);
  assert.equal(spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Hero Den', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' }).status, 0);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  for (const m of ['esbuild', 'three']) symlinkSync(join(REPO_NM, m), join(dir, 'node_modules', m));
  if (game) { mkdirSync(join(dir, 'games', game), { recursive: true }); writeFileSync(join(dir, 'games', game, 'game.json'), JSON.stringify({ id: game, name: 'Heroes', players: { min: 1, max: 8 }, entry: 'src/main.ts' })); }
  return dir;
}

/** The library this file's tests use: a Mixamo hero, a KayKit-named clip source (as the real one is), a chibi. */
let LIB = null;
async function library() {
  if (LIB) return LIB;
  LIB = writeLibrary(join(scratch, 'library'), [
    { id: 'test-heroes/hero', kind: 'character', bytes: Buffer.from(await humanoidGlb({ scheme: 'mixamo' })), rigged: true, bones: 19, clips: ['Idle', 'Running', 'Jump', 'Punching'], suggestM: 1.7 },
    { id: 'kaykit-adventurers/knight', kind: 'character', bytes: Buffer.from(await humanoidGlb({ scheme: 'kaykit', held: ['1H_Sword', 'Round_Shield'] })), rigged: true, bones: 21, clips: ['Idle', 'Running_A', 'Jump_Start', '1H_Melee_Attack_Chop', 'Hit_A', 'Death_A'], suggestM: 1.7 },
    { id: 'test-chibi/blocky', kind: 'character', bytes: Buffer.from(await blockyGlb()), rigged: false, clips: ['static', 'idle'], suggestM: 1 },
    { id: 'test-props/crate', kind: 'prop', bytes: Buffer.from(await placeholderGlb([1, 1, 1])) },
  ]);
  return LIB;
}

/** A node's world matrix in a Document after a clip library's last keyframes are put on it (by node name). */
async function posedWorld(charBytes, animsBytes, verb, names) {
  const ch = await docOf(charBytes);
  const an = await docOf(animsBytes);
  const anim = an.getRoot().listAnimations().find((a) => a.getName() === verb);
  assert.ok(anim, `the clip library has ${verb}`);
  const byName = new Map(ch.getRoot().listNodes().map((n) => [n.getName(), n]));
  for (const c of anim.listChannels()) {
    const n = byName.get(c.getTargetNode().getName());
    if (!n) continue;
    const out = c.getSampler().getOutput();
    const last = out.getElement(out.getCount() - 1, []);
    if (c.getTargetPath() === 'rotation') n.setRotation(last); else if (c.getTargetPath() === 'translation') n.setTranslation(last);
  }
  return Object.fromEntries(names.map((nm) => { const m = byName.get(nm).getWorldMatrix(); return [nm, new Vector3(m[12], m[13], m[14])]; }));
}

test('skeleton standard: Mixamo, KayKit and Meshy map to one vocabulary; the spine chain by the tree; mini and quadruped', async () => {
  const mix = skeletonOf(await docOf(await humanoidGlb({ scheme: 'mixamo' })));
  assert.equal(mix.family, 'humanoid');
  assert.equal(mix.map.leftUpperArm, 'mixamorig:LeftArm');
  assert.equal(mix.map.leftLowerLeg, 'mixamorig:LeftLeg');
  assert.equal(mix.map.spine, 'mixamorig:Spine');
  assert.equal(mix.map.chest, 'mixamorig:Spine1');
  const kay = skeletonOf(await docOf(await humanoidGlb({ scheme: 'kaykit' })));
  assert.equal(kay.family, 'humanoid');
  assert.equal(kay.map.leftHand, 'wrist.l');
  assert.equal(kay.map.leftHandSlot, 'handslot.l');
  assert.deepEqual(kay.helpers, ['kneeIK.l'], 'the IK target moves no vertex and leads to nothing that does');
  // Meshy counts its spine down from the neck: the tree, not the numbers, says which is which.
  const meshy = skeletonOf(await docOf(await humanoidGlb({ scheme: 'meshy', cm: true, apose: true })));
  assert.equal(meshy.family, 'humanoid');
  assert.deepEqual([meshy.map.spine, meshy.map.chest, meshy.map.upperChest], ['Spine02', 'Spine01', 'Spine']);
  assert.equal(meshy.map.leftUpperLeg, 'LeftUpLeg');
  // "rightHand" must never lose its "rig" to the prefix rule.
  assert.equal(mapSkeleton(['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']).family, 'humanoid', 'an already normalised rig');
  assert.equal(mapSkeleton(['root', 'torso', 'head', 'arm-left', 'arm-right', 'leg-left', 'leg-right']).family, 'mini');
  assert.equal(mapSkeleton(['root', 'body', 'tail', 'leg-front-left', 'leg-front-right', 'leg-back-left', 'leg-back-right']).family, 'quadruped');
  const blocky = skeletonOf(await docOf(await blockyGlb()));
  assert.equal(blocky.family, 'mini');
  assert.equal(blocky.skinned, false, 'parts that move by their nodes');
  // One rig, one fingerprint, whatever its scale: characters that share it share a clip library.
  assert.equal(skeletonOf(await docOf(await humanoidGlb({ scheme: 'kaykit', held: ['A'] }))).fingerprint, kay.fingerprint);
});

test('the shipped character: joints renamed, helpers removed, held things merged into one skinned mesh (keep picks them), clips out', async () => {
  const doc = await docOf(await humanoidGlb({ scheme: 'kaykit', held: ['1H_Sword', 'Round_Shield'] }));
  const r = normaliseRig(doc, { keep: ['1H_Sword'] });
  assert.deepEqual(r.removedHelpers, ['kneeIK.l']);
  assert.deepEqual(r.dropped, ['Round_Shield']);
  assert.deepEqual(r.kept, ['1H_Sword']);
  const meshes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  assert.equal(meshes.length, 1, 'one mesh node: one draw call');
  assert.equal(meshes[0].getMesh().listPrimitives().length, 1);
  assert.ok(meshes[0].getSkin(), 'skinned');
  assert.equal(doc.getRoot().listAnimations().length, 0, 'clips go to the clip library');
  const names = doc.getRoot().listNodes().map((n) => n.getName());
  for (const n of ['hips', 'leftUpperArm', 'leftHand', 'leftHandSlot', 'leftUpperLeg']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('kneeIK.l'));
  // The sword now rides the hand slot's joint with full weight, where it hung before.
  const prim = meshes[0].getMesh().listPrimitives()[0];
  const J = prim.getAttribute('JOINTS_0'); const W = prim.getAttribute('WEIGHTS_0');
  const slot = doc.getRoot().listSkins()[0].listJoints().findIndex((j) => j.getName() === 'leftHandSlot');
  let onSlot = 0;
  for (let i = 0; i < J.getCount(); i++) { const j = J.getElement(i, []); const w = W.getElement(i, []); if (j[0] === slot && w[0] === 1) onSlot += 1; }
  assert.equal(onSlot, 3 + 8, 'the slot\'s own triangle and the sword\'s eight corners');
  const b = skinnedBounds(doc);
  assert.ok(b.max[1] > 1.5 && b.max[1] < 2, `measured through its bones: ${b.max[1]}`);
});

test('a centimetre armature measures true: the optimiser scales and centres a rig through its bones', async () => {
  const { optimiseModel } = await import('../lib/optimise.mjs');
  const raw = await humanoidGlb({ scheme: 'meshy', cm: true, apose: true });
  const before = skinnedBounds(await docOf(raw));
  assert.ok(before.max[1] > 1.5 && before.max[1] < 1.8, `metres in a centimetre rig: ${before.max[1]}`);
  const r = await optimiseModel(raw, { height: 1.45, triangles: 0, rigged: true });
  assert.ok(Math.abs(r.after.heightM - 1.45) < 0.02, `scaled to 1.45 m: ${r.after.heightM}`);
  const after = skinnedBounds(await docOf(r.glb));
  assert.ok(Math.abs(after.min[1]) < 0.01, `its feet on the ground: ${after.min[1]}`);
  assert.ok(Math.abs((after.min[0] + after.max[0]) / 2) < 0.02, 'centred');
});

test('retargeting: a T-pose arm raise onto an A-pose centimetre rig ends with the arm UP; a whole limb aims on a chibi', async () => {
  const srcDoc = await docOf(await humanoidGlb({ scheme: 'mixamo' }));
  normaliseRig(srcDoc, { merge: false, helpers: false, takeClips: false });
  const src = rigOf(srcDoc);
  const anim = srcDoc.getRoot().listAnimations().find((a) => a.getName() === findClip(srcDoc.getRoot().listAnimations().map((a) => a.getName()), 'attack'));
  assert.equal(anim.getName(), 'Punching');
  const tools = await modelTools();
  // An A-pose Meshy-named rig in centimetres.
  const tdoc = await docOf(await humanoidGlb({ scheme: 'meshy', cm: true, apose: true, clips: false }));
  normaliseRig(tdoc, { takeClips: true });
  const tgt = rigOf(tdoc);
  const { doc } = await bakeLibrary(tgt, [{ rig: src, anim, verb: 'attack', from: 'test' }, { rig: src, anim: srcDoc.getRoot().listAnimations().find((a) => a.getName() === 'Running'), verb: 'run', from: 'test' }], { core: tools.core, logger: tools.logger });
  const lib = await writeClips(doc, { tools });
  const charBytes = await tools.io.writeBinary(tdoc);
  const at = await posedWorld(charBytes, lib.bytes, 'attack', ['leftUpperArm', 'leftHand']);
  const dir = at.leftHand.clone().sub(at.leftUpperArm).normalize();
  assert.ok(dir.y > 0.95, `the arm points up after the raise: ${dir.toArray().map((v) => v.toFixed(2))}`);
  // A loop's drift across the ground is removed (the source run moves forward 0.4 m); its bob stays.
  const run = (await docOf(lib.bytes)).getRoot().listAnimations().find((a) => a.getName() === 'run');
  const hipsT = run.listChannels().find((c) => c.getTargetNode().getName() === 'hips' && c.getTargetPath() === 'translation');
  assert.ok(hipsT, 'the hips bob');
  const out = hipsT.getSampler().getOutput(); const first = out.getElement(0, []); const last = out.getElement(out.getCount() - 1, []);
  assert.ok(Math.abs(last[2] - first[2]) < 1e-3 * 100, `in place: ${first[2]} -> ${last[2]} (centimetres)`);
  // A chibi of rigid parts: its one-piece arm aims where the source's whole arm points.
  const bdoc = await docOf(await blockyGlb());
  normaliseRig(bdoc, { takeClips: true });
  const brig = rigOf(bdoc);
  assert.equal(brig.skeleton.family, 'mini');
  const b = await bakeLibrary(brig, [{ rig: src, anim, verb: 'attack', from: 'test' }], { core: tools.core, logger: tools.logger });
  const blib = await writeClips(b.doc, { tools });
  const bat = await posedWorld(await tools.io.writeBinary(bdoc), blib.bytes, 'attack', ['leftUpperArm', 'spine']);
  const node = (await docOf(await tools.io.writeBinary(bdoc))).getRoot().listNodes().find((n) => n.getName() === 'leftUpperArm');
  assert.ok(node, 'renamed to the standard');
  // Its mesh hangs down from the joint at rest: after the raise its rotation has turned it upward.
  const an = (await docOf(blib.bytes)).getRoot().listAnimations()[0];
  const ch = an.listChannels().find((c) => c.getTargetNode().getName() === 'leftUpperArm');
  const o = ch.getSampler().getOutput(); const q = new Quaternion(...o.getElement(o.getCount() - 1, []));
  const down = new Vector3(0, -1, 0).applyQuaternion(q);
  assert.ok(down.y > 0.9, `the one-piece arm points up (its hanging axis turned over): ${down.y.toFixed(2)}`);
  assert.ok(bat.leftUpperArm && bat.spine);
});

test('characters in a game: assets add bakes a shared clip library, retargets what a rig lacks, records both; anim plan and anim add', async () => {
  const lib = await library();
  const root = studio('pipeline');
  const L = { kind: 'dir', base: lib };
  const knight = await addCharacter(root, 'heroes', { item: 'kaykit-adventurers/knight', as: 'knight', height: 1.45, keep: ['1H_Sword'], verbs: ['idle', 'run', 'jump', 'attack', 'hit', 'die'], lib: L });
  assert.equal(knight.family, 'humanoid');
  assert.deepEqual(knight.dropped, ['Round_Shield']);
  assert.equal(knight.after.drawCalls, 1);
  assert.deepEqual(knight.clipsFrom, [], 'its own clips: copied, not retargeted');
  for (const v of ['idle', 'run', 'jump', 'attack', 'hit', 'die']) assert.ok(knight.verbs.includes(v), v);
  const g = join(root, 'games', 'heroes');
  const model = readFileSync(join(g, knight.model));
  const mdoc = await docOf(model);
  assert.equal(mdoc.getRoot().listAnimations().length, 0, 'the model ships no clips');
  assert.match(String(mdoc.getRoot().getDefaultScene()?.getExtras()?.homie?.anims ?? mdoc.getRoot().listScenes()[0].getExtras().homie.anims), /^\.\.\/anims\/humanoid-[0-9a-f]{6}\.glb$/, 'the model names its clip library, relative to itself');
  // A Mixamo hero lacks hit and die: they come from the knight's clips, retargeted.
  const hero = await addCharacter(root, 'heroes', { item: 'test-heroes/hero', as: 'hero', height: 1.45, verbs: ['idle', 'run', 'jump', 'attack', 'hit', 'die'], lib: L });
  assert.notEqual(hero.skeleton, knight.skeleton, 'two rigs, two clip libraries');
  assert.ok(hero.verbs.includes('hit') && hero.verbs.includes('die'));
  assert.deepEqual(hero.clipsFrom, ['kaykit-adventurers/knight']);
  const m = readManifest(root, 'heroes');
  const clipEntry = m.assets.find((a) => a.id === `anims-${hero.skeleton}`);
  assert.equal(clipEntry.kind, 'clip');
  assert.equal(clipEntry.license.kind, 'cc0');
  assert.ok(clipEntry.clips.find((c) => c.verb === 'hit').retargeted);
  assert.equal(clipEntry.clips.find((c) => c.verb === 'idle').retargeted, false, 'its own idle');
  assert.match(readFileSync(join(g, 'assets', 'RIGHTS.md'), 'utf8'), /### anims-humanoid-/);
  // A second knight shares the first's clip library.
  const k2 = await addCharacter(root, 'heroes', { item: 'kaykit-adventurers/knight', as: 'knight-two', height: 1.45, keep: [], verbs: ['idle'], lib: L });
  assert.equal(k2.skeleton, knight.skeleton);
  assert.equal(readdirSync(join(g, 'public', 'anims')).length, 2);
  // The plan, then more verbs (from the knight, retargeted).
  const plan = animPlan(root, 'heroes');
  assert.ok(plan.rows.find((r) => r.id === 'hero').clips.every((c) => verbsFor(null).includes(c.verb)));
  const added = await bakeClips(root, 'heroes', 'hero', { verbs: ['emote'], lib: L });
  assert.deepEqual(added.missing, ['emote'], 'no source has a cheer here: said, not faked');
  // The CLI: anim plan and cast.
  const p = run(root, ['anim', 'plan', 'heroes'], { HOMIE_LIBRARY: lib });
  assert.equal(p.code, 0, p.err);
  assert.equal(p.out.rows.length, 3);
  const c = run(root, ['cast', 'heroes']);
  assert.equal(c.code, 0, c.err);
  assert.equal(c.out.rows.filter((r) => r.state === 'made').length, 3);
  // assets check: the clip libraries and the characters' skins, and skinning a room.
  const chk = run(root, ['assets', 'check', 'heroes']);
  const rows = chk.out.rows;
  assert.ok(rows.find((r) => r.kind === 'clip' && r.ok), 'a clip library row');
  assert.ok(rows.find((r) => r.id === 'knight').measured.bones <= 21);
  assert.ok(chk.out.skinning.vertices > 0 && chk.out.skinning.players === 8);
});

test('assets add routes an animated library character, or a rigged file, through the character pipeline (CLI)', async () => {
  const lib = await library();
  const root = studio('cli');
  const a = run(root, ['assets', 'add', 'heroes', 'test-chibi/blocky', '--as', 'chibi', '--height', '1'], { HOMIE_LIBRARY: lib });
  assert.equal(a.code, 0, a.err + a.text);
  assert.equal(a.out.family, 'mini');
  assert.ok(a.out.verbs.includes('idle'));
  assert.ok(a.out.verbs.includes('attack'), 'retargeted from the humanoid clip source onto a mini rig');
  writeFileSync(join(scratch, 'own-hero.glb'), Buffer.from(await humanoidGlb({ scheme: 'meshy', cm: true, apose: true, clips: false })));
  const f = run(root, ['assets', 'add', 'heroes', '--file', join(scratch, 'own-hero.glb'), '--kind', 'character', '--rigged', '--license', 'own', '--as', 'own-hero', '--height', '1.5', '--verbs', 'idle,attack'], { HOMIE_LIBRARY: lib });
  assert.equal(f.code, 0, f.err + f.text);
  assert.equal(f.out.route, 'imported');
  assert.deepEqual(f.out.clipsFrom, ['kaykit-adventurers/knight']);
  assert.ok(existsSync(join(root, 'art', 'own-hero', 'raw', 'own-hero.glb')), 'the raw file kept, git-ignored');
  assert.ok(Math.abs(f.out.after.heightM - 1.5) < 0.03, `${f.out.after.heightM} m`);
  const lines = spawnSync(process.execPath, [CLI, 'anim', 'plan', 'heroes'], { cwd: root, encoding: 'utf8', env: { ...process.env, HOMIE_LIBRARY: lib } });
  assert.match(lines.stdout, /own-hero \(Homie humanoid/);
  assert.match(lines.stdout, /attack <- 1H_Melee_Attack_Chop \(retargeted from kaykit-adventurers\/knight\)/);
});

test('style init on a starter game keeps the look it draws (style.json) and starts its clip set from its characters', async () => {
  const lib = await library();
  const root = studio('starter-look', null);
  const made = run(root, ['game', 'new', 'arena', '--from', 'hero-rush-3d', '--name', 'Arena'], { HOMIE_LIBRARY: await heroLibrary(lib) });
  assert.equal(made.code, 0, made.err + made.text);
  const before = JSON.parse(readFileSync(join(root, 'games', 'arena', 'style.json'), 'utf8'));
  const init = run(root, ['style', 'init', 'arena', '--prompt', 'a neon cyber racing game at night']);
  assert.equal(init.code, 0, init.err);
  const after = JSON.parse(readFileSync(join(root, 'games', 'arena', 'style.json'), 'utf8'));
  assert.deepEqual(after.palette, before.palette, 'the starter\'s palette stays');
  assert.equal(after.render, before.render);
  const doc = JSON.parse(readFileSync(join(root, 'games', 'arena', 'codex', 'decisions.json'), 'utf8'));
  assert.match(doc.decisions['style.palette'].why, /what the game draws now/);
  assert.ok(doc.decisions['anim.clips'].value.includes('jump'), 'its characters\' clips');
  assert.equal(doc.decisions['style.proportions'].value.heightM, 1.45, 'the proportions start from how tall its characters stand');
  // Run again (the decisions file exists now): the fonts it draws stay too, and its style.json keeps them.
  const again = run(root, ['style', 'init', 'arena']);
  assert.equal(again.code, 0, again.err);
  const kept = JSON.parse(readFileSync(join(root, 'games', 'arena', 'style.json'), 'utf8'));
  assert.deepEqual(kept.fonts, before.fonts, 'the starter\'s fonts stay on a second init');
  assert.deepEqual(kept.palette, before.palette);
  // One character with a verb of its own (a generated hero's pickup) is not a verb the whole cast lacks.
  const m = JSON.parse(readFileSync(join(root, 'games', 'arena', 'assets', 'manifest.json'), 'utf8'));
  const lib1 = m.assets.find((a) => a.kind === 'clip');
  m.assets.push({ ...lib1, id: 'anims-extra', rig: { ...lib1.rig, skeleton: 'humanoid-extra' }, clips: [...lib1.clips, { verb: 'pickup', source: 'PickUp' }] });
  const hero = m.assets.find((a) => a.kind === 'character');
  m.assets.push({ ...hero, id: 'odd-one', rig: { ...hero.rig, skeleton: 'humanoid-extra' } });
  writeFileSync(join(root, 'games', 'arena', 'assets', 'manifest.json'), JSON.stringify(m, null, 2));
  assert.equal(run(root, ['style', 'init', 'arena']).code, 0);
  const plan = animPlan(root, 'arena');
  assert.ok(!plan.verbs.includes('pickup'), 'one character\'s extra verb stays its own');
  assert.ok(plan.rows.every((r) => !r.missing.includes('pickup')));
  assert.deepEqual(plan.rows.find((r) => r.id === 'odd-one').extra, ['pickup']);
});

/** A library holding every item the hero-rush-3d starter names: synthetic KayKit rigs and grey boxes. */
let HERO_LIB = null;
async function heroLibrary() {
  if (HERO_LIB) return HERO_LIB;
  const manifest = JSON.parse(readFileSync(join(PKG, 'starters', 'hero-rush-3d', 'assets', 'manifest.json'), 'utf8'));
  const rig = Buffer.from(await humanoidGlb({ scheme: 'kaykit', held: ['1H_Sword', 'Round_Shield', 'Knight_Helmet'] }));
  const box = Buffer.from(await placeholderGlb([0.5, 0.5, 0.5]));
  HERO_LIB = writeLibrary(join(scratch, 'hero-library'), manifest.assets.map((a) => (a.rig ? { id: a.from.item, kind: a.kind, bytes: rig, rigged: true, clips: ['Idle'] } : { id: a.from.item, kind: a.kind, bytes: box })));
  return HERO_LIB;
}

test('the hero-rush-3d starter: text only, characters with a rig recipe, every model through the shared loader and animate', () => {
  const S = join(PKG, 'starters', 'hero-rush-3d');
  const files = readdirSync(S, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  assert.deepEqual(files.filter((f) => !/\.(json|md|ts|html)$/.test(f)), [], 'no binaries: game new fetches and bakes');
  const manifest = JSON.parse(readFileSync(join(S, 'assets', 'manifest.json'), 'utf8'));
  const chars = manifest.assets.filter((a) => a.rig);
  assert.equal(chars.length, 9, 'five heroes and four skeletons');
  for (const a of chars) {
    assert.equal(a.license.kind, 'cc0');
    assert.match(a.from.item, /^kaykit-(adventurers|skeletons)\//, 'one family: KayKit');
    for (const v of ['idle', 'run', 'jump', 'attack', 'hit']) assert.ok(a.rig.verbs.includes(v), `${a.id} bakes ${v}`);
  }
  assert.ok(manifest.assets.every((a) => /^kaykit-/.test(a.from.pack)), 'the props are KayKit too: one look');
  const src = readFileSync(join(S, 'src', 'main.ts'), 'utf8');
  assert.match(src, /from '@homie-rocks\/studio\/animate'/);
  assert.match(src, /loadCharacter\(models, heroUrl\(want\), \{ tune: T \}\)/);
  assert.match(src, /crowd\(/);
  assert.doesNotMatch(src, /GLTFLoader|AnimationMixer/, 'no loader or mixer of its own');
  for (const a of manifest.assets) assert.ok(src.includes(`./models/${a.id}.glb`) || (a.rig && src.includes(`'${a.id}'`)), `main.ts draws ${a.id}`);
  const tun = JSON.parse(readFileSync(join(S, 'tunables.json'), 'utf8'));
  for (const k of ['jumpHeight', 'jumpRise', 'fallFaster', 'windupMs', 'fade', 'walkSpeed', 'runSpeed', 'jumpStretch', 'landSquash', 'lean']) assert.ok(tun[k]?.group, k);
  const lab = JSON.parse(readFileSync(join(S, 'lab.json'), 'utf8'));
  assert.deepEqual(Object.keys(lab.takes).sort(), ['jump', 'swing']);
});

test('game new --from hero-rush-3d bakes every character and its clips, and the game builds with one three.js', async () => {
  const lib = await heroLibrary();
  const root = studio('starter-new', null);
  const made = run(root, ['game', 'new', 'arena', '--from', 'hero-rush-3d', '--name', 'Arena'], { HOMIE_LIBRARY: lib });
  assert.equal(made.code, 0, made.err + made.text);
  assert.equal(made.out.models.missing.length, 0, JSON.stringify(made.out.models.missing));
  assert.equal(made.out.models.characters, 9);
  const g = join(root, 'games', 'arena');
  assert.equal(readdirSync(join(g, 'public', 'anims')).length, 1, 'one rig: one shared clip library');
  const m = readManifest(root, 'arena');
  const knight = m.assets.find((a) => a.id === 'knight');
  assert.equal(knight.rig.family, 'humanoid');
  assert.ok(knight.rig.verbs.includes('jump'));
  assert.equal(knight.card, 'Players/Knight');
  const { buildGameFiles } = await import('../lib/build.mjs');
  const { listGames } = await import('../lib/studio.mjs');
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const out = join(scratch, 'starter-dist');
  const { metafile } = await buildGameFiles(esbuild, root, listGames(root).find((x) => x.id === 'arena'), out);
  assert.ok(existsSync(join(out, 'anims')) || existsSync(join(out, 'models')), 'the models and clips are served beside it');
  const threes = new Set(Object.keys(metafile.inputs).filter((p) => /three\/build\/three\.(core|module)/.test(p)).map((p) => realpathSync(join(root, p)).replace(/build\/.*$/, '')));
  assert.equal(threes.size, 1, `one three.js in the bundle: ${[...threes].join(', ')}`);
  assert.ok(Object.keys(metafile.inputs).some((p) => /assets\/animate\.ts$/.test(p)), 'the shared animate module is in it');
});

test('verbs: the game\'s anim.clips words map onto the verb list; findClip knows KayKit, Kenney and Mixamo names', () => {
  assert.deepEqual(verbsFor({ decisions: { 'anim.clips': { value: ['idle', 'run', 'pick-up', 'kick', 'cheer', 'bogus'] } } }), ['idle', 'run', 'pickup', 'attack2', 'emote']);
  assert.ok(VERB_IDS.includes('cast'));
  assert.equal(findClip(['Idle', 'Running_A', 'Running_B', 'Jump_Start', 'Jump_Full_Short'], 'jump'), 'Jump_Start');
  assert.equal(findClip(['static', 'idle', 'walk', 'sprint'], 'run'), 'sprint');
  assert.equal(findClip(['Standing Idle', 'Fast Run'], 'run'), 'Fast Run', 'by words when no table name fits');
  assert.equal(findClip(['Idle'], 'die'), null);
});

test('MCP: cast_plan, anim_plan, anim_add, anim_preview and character_make are listed with their cards; the animation card\'s data', async () => {
  const lib = await library();
  const root = studio('mcp');
  await addCharacter(root, 'heroes', { item: 'kaykit-adventurers/knight', as: 'knight', height: 1.45, verbs: ['idle', 'run', 'jump', 'attack'], lib: { kind: 'dir', base: lib } });
  writeFileSync(join(root, 'games', 'heroes', 'lab.json'), JSON.stringify({ v: 1, default: 'jump', takes: { jump: { note: 'Jump in an open spot', seconds: 1.8, inputs: [] }, swing: { note: 'Swing at the dummy', seconds: 2, inputs: [] } } }));
  const { mcpServer } = await import('./card-host.mjs');
  const SKILLS = join(PKG, '..', '..', 'plugins', 'homie', 'skills');
  const s = mcpServer(process.execPath, [CLI, 'mcp', '--studios', scratch, '--skills', SKILLS], { cwd: root, env: { ...process.env, HOMIE_LIBRARY: lib } });
  await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const call = async (name, args) => (await s.request('tools/call', { name, arguments: { studio: 'mcp', ...args } })).result;
  try {
    const tools = Object.fromEntries((await s.request('tools/list', {})).result.tools.map((t) => [t.name, t]));
    for (const [name, card] of [['cast_plan', 'cast'], ['anim_plan', 'animation'], ['anim_add', 'animation'], ['anim_preview', 'animation'], ['character_make', 'lineup']]) assert.equal(tools[name]?._meta?.ui?.resourceUri, `ui://homie-studio/${card}`, name);
    assert.match(tools.character_make.description, /OWN fal account/);
    const cast = await call('cast_plan', { game: 'heroes' });
    assert.equal(cast.structuredContent.mode, 'characters');
    assert.equal(cast.structuredContent.rows[0].id, 'knight');
    assert.equal(cast.structuredContent.rows[0].family, 'humanoid');
    const plan = await call('anim_plan', { game: 'heroes' });
    const d = plan.structuredContent;
    assert.equal(d.kind, 'animation');
    assert.equal(d.rows[0].id, 'knight');
    assert.equal(d.feel.jump, 'jump', 'Feel on the jump opens the jump take');
    assert.equal(d.feel.attack, 'swing', 'Feel on the attack opens the swing take (its note says swing)');
    assert.match(plan.content[0].text, /Feel: the Game Lab tunes/);
    const card = await s.request('resources/read', { uri: 'ui://homie-studio/animation' });
    assert.match(card.result.contents[0].text, /anim_add/);
  } finally { await s.close(); }
});
