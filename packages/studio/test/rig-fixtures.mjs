/**
 * Small rigged characters made in code for the tests (no binary is committed): a humanoid skeleton named the way
 * Mixamo, KayKit or Meshy name theirs, in a T-pose or an A-pose, optionally under a centimetre armature (scale 0.01,
 * as Meshy exports), with a skinned mesh (a small triangle at every joint, all its weight on that joint), held things
 * under a hand (rigid meshes: a sword, a shield), a helper bone that moves nothing, and clips:
 *   Idle      the spine sways a little
 *   Running   the legs swing, the hips bob
 *   Jump      the hips rise
 *   Attack    the left upper arm turns from out to the side to straight UP (the test of retargeting)
 * Also a rigid-parts chibi (Kenney's blocky characters: root, torso, head, arms, legs as moving meshes) and a fake
 * starter library (index.json and its files) holding them.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { modelTools } from '../lib/optimise.mjs';

const NAMES = {
  mixamo: { hips: 'mixamorig:Hips', spine: 'mixamorig:Spine', chest: 'mixamorig:Spine1', neck: 'mixamorig:Neck', head: 'mixamorig:Head', lua: 'mixamorig:LeftArm', lla: 'mixamorig:LeftForeArm', lh: 'mixamorig:LeftHand', rua: 'mixamorig:RightArm', rla: 'mixamorig:RightForeArm', rh: 'mixamorig:RightHand', lul: 'mixamorig:LeftUpLeg', lll: 'mixamorig:LeftLeg', lf: 'mixamorig:LeftFoot', lt: 'mixamorig:LeftToeBase', rul: 'mixamorig:RightUpLeg', rll: 'mixamorig:RightLeg', rf: 'mixamorig:RightFoot', rt: 'mixamorig:RightToeBase' },
  kaykit: { hips: 'hips', spine: 'spine', chest: 'chest', neck: null, head: 'head', lua: 'upperarm.l', lla: 'lowerarm.l', lh: 'wrist.l', rua: 'upperarm.r', rla: 'lowerarm.r', rh: 'wrist.r', lul: 'upperleg.l', lll: 'lowerleg.l', lf: 'foot.l', lt: 'toes.l', rul: 'upperleg.r', rll: 'lowerleg.r', rf: 'foot.r', rt: 'toes.r', slot: 'handslot.l', helper: 'kneeIK.l' },
  // Meshy counts its spine down from the neck: Spine02 is the one on the hips.
  meshy: { hips: 'Hips', spine: 'Spine02', chest: 'Spine01', upper: 'Spine', neck: 'neck', head: 'Head', lua: 'LeftArm', lla: 'LeftForeArm', lh: 'LeftHand', rua: 'RightArm', rla: 'RightForeArm', rh: 'RightHand', lul: 'LeftUpLeg', lll: 'LeftLeg', lf: 'LeftFoot', lt: 'LeftToeBase', rul: 'RightUpLeg', rll: 'RightLeg', rf: 'RightFoot', rt: 'RightToeBase' },
};
const CLIP_NAMES = { mixamo: { idle: 'Idle', run: 'Running', jump: 'Jump', attack: 'Punching' }, kaykit: { idle: 'Idle', run: 'Running_A', jump: 'Jump_Start', attack: '1H_Melee_Attack_Chop', hit: 'Hit_A', die: 'Death_A' }, meshy: { idle: 'Armature|clip0|baselayer' } };

const qz = (deg) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (deg * Math.PI) / 180).toArray();
const qx = (deg) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (deg * Math.PI) / 180).toArray();

/**
 * A humanoid GLB: { scheme: 'mixamo'|'kaykit'|'meshy', apose, cm (a 0.01 armature, joints in centimetres),
 * clips (true: the scheme's), held: ['Sword', 'Shield'] under the left hand slot }. Returns bytes.
 */
export async function humanoidGlb({ scheme = 'mixamo', apose = false, cm = false, clips = true, held = [] } = {}) {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const N = NAMES[scheme];
  const u = cm ? 100 : 1; // joint units in metres or centimetres
  const scene = doc.createScene('scene');
  const armature = doc.createNode('Armature').setScale(cm ? [0.01, 0.01, 0.01] : [1, 1, 1]);
  scene.addChild(armature);
  const joints = [];
  const node = (key, t, parent, r = [0, 0, 0, 1]) => {
    const n = doc.createNode(N[key]).setTranslation(t.map((v) => v * u)).setRotation(r);
    parent.addChild(n); joints.push(n); return n;
  };
  const hips = node('hips', [0, 1.0, 0], armature);
  const spine = node('spine', [0, 0.15, 0], hips);
  const chest = node('chest', [0, 0.15, 0], spine);
  const top = N.upper ? node('upper', [0, 0.1, 0], chest) : chest;
  const neck = N.neck ? node('neck', [0, 0.15, 0], top) : top;
  node('head', [0, 0.1, 0], neck);
  // Arms: out along +x (left) and -x (right) in a T-pose; an A-pose turns the upper arms 45 degrees down.
  const lua = node('lua', [0.2, 0.15, 0], top, apose ? qz(-45) : [0, 0, 0, 1]);
  const lla = node('lla', [0.3, 0, 0], lua);
  const lh = node('lh', [0.25, 0, 0], lla);
  const rua = node('rua', [-0.2, 0.15, 0], top, apose ? qz(45) : [0, 0, 0, 1]);
  const rla = node('rla', [-0.3, 0, 0], rua);
  node('rh', [-0.25, 0, 0], rla);
  const lul = node('lul', [0.1, -0.05, 0], hips); const lll = node('lll', [0, -0.45, 0], lul); const lf = node('lf', [0, -0.45, 0], lll); node('lt', [0, -0.05, 0.12], lf);
  const rul = node('rul', [-0.1, -0.05, 0], hips); const rll = node('rll', [0, -0.45, 0], rul); const rf = node('rf', [0, -0.45, 0], rll); node('rt', [0, -0.05, 0.12], rf);
  let slot = null;
  if (N.slot) slot = node('slot', [0.08, 0, 0], lh);
  if (N.helper) { const h = doc.createNode(N.helper).setTranslation([0.1 * u, 0.5 * u, 0.5 * u]); armature.addChild(h); joints.push(h); }
  // The skin: a triangle at each weighted joint (not the helper), weighted fully to it, in bind space (world, metres).
  const skin = doc.createSkin('skin').setSkeleton(hips);
  for (const j of joints) skin.addJoint(j);
  const ibm = new Float32Array(joints.length * 16);
  const pos = []; const jw = []; const ww = []; const idx = [];
  joints.forEach((j, k) => {
    const m = j.getWorldMatrix();
    ibm.set(invert(m), k * 16);
    if (j.getName() === N.helper) return;
    const p = [m[12], m[13], m[14]];
    const b = pos.length / 3;
    pos.push(p[0] - 0.02, p[1], p[2], p[0] + 0.02, p[1], p[2], p[0], p[1] + 0.03, p[2] + 0.01);
    for (let i = 0; i < 3; i++) { jw.push(k, 0, 0, 0); ww.push(1, 0, 0, 0); }
    idx.push(b, b + 1, b + 2);
  });
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  const mat = doc.createMaterial('body').setBaseColorFactor([0.8, 0.5, 0.3, 1]);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(jw)).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(ww)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
  const body = doc.createNode('Body').setMesh(doc.createMesh('Body').addPrimitive(prim)).setSkin(skin);
  scene.addChild(body);
  // Held things: rigid meshes under the hand slot (or the hand), in the joint's own units.
  for (const [i, name] of held.entries()) {
    const box = await boxMesh(doc, buffer, mat, 0.04 * u, 0.3 * u, 0.04 * u);
    const n = doc.createNode(name).setMesh(box).setTranslation([0, (0.1 + i * 0.05) * u, 0]);
    (slot ?? lh).addChild(n);
  }
  if (clips) {
    const C = CLIP_NAMES[scheme];
    const clip = (name, tracks) => {
      if (!name) return;
      const a = doc.createAnimation(name);
      for (const [n, path, times, values] of tracks) {
        const s = doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer)).setOutput(doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(values)).setBuffer(buffer)).setInterpolation('LINEAR');
        a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath(path).setSampler(s));
      }
    };
    const restQ = (n) => n.getRotation();
    const mulQ = (a, b) => new Quaternion(...a).multiply(new Quaternion(...b)).toArray();
    clip(C.idle, [[spine, 'rotation', [0, 0.5, 1], [...qz(0), ...qz(4), ...qz(0)]]]);
    clip(C.run, [[lul, 'rotation', [0, 0.25, 0.5], [...qx(-30), ...qx(30), ...qx(-30)]], [rul, 'rotation', [0, 0.25, 0.5], [...qx(30), ...qx(-30), ...qx(30)]], [hips, 'translation', [0, 0.125, 0.25, 0.375, 0.5], [0, 1.0 * u, 0, 0, 1.05 * u, 0.1 * u, 0, 1.0 * u, 0.2 * u, 0, 1.05 * u, 0.3 * u, 0, 1.0 * u, 0.4 * u]]]);
    clip(C.jump, [[hips, 'translation', [0, 0.3, 0.6], [0, 1.0 * u, 0, 0, 1.3 * u, 0, 0, 1.0 * u, 0]]]);
    // The arm from wherever its rest has it, to straight up (a T-pose arm turns 90 degrees; an A-pose arm 135).
    clip(C.attack, [[lua, 'rotation', [0, 1], [...restQ(lua), ...mulQ(qz(apose ? 135 : 90), restQ(lua))]]]);
    clip(C.hit, [[chest, 'rotation', [0, 0.3], [...qx(0), ...qx(-20)]]]);
    clip(C.die, [[hips, 'rotation', [0, 0.8], [...qx(0), ...qx(-80)]]]);
  }
  return io.writeBinary(doc);
}

async function boxMesh(doc, buffer, mat, x, y, z, down = false) {
  const p = []; const idx = [];
  const lo = down ? -y : 0; const hi = down ? 0 : y;
  const c = [[-x, lo, -z], [x, lo, -z], [x, hi, -z], [-x, hi, -z], [-x, lo, z], [x, lo, z], [x, hi, z], [-x, hi, z]];
  for (const v of c) p.push(...v);
  idx.push(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5);
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
  return doc.createMesh('box').addPrimitive(prim);
}

/** A chibi of rigid parts (Kenney's blocky characters): root, torso, head, arms, legs, each a moving mesh, its own idle. */
export async function blockyGlb() {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const mat = doc.createMaterial('skin').setBaseColorFactor([0.9, 0.7, 0.5, 1]);
  const scene = doc.createScene('scene');
  const top = doc.createNode('character-a'); scene.addChild(top);
  const root = doc.createNode('root'); top.addChild(root);
  const part = async (name, t, parent, size) => { const n = doc.createNode(name).setTranslation(t).setMesh(await boxMesh(doc, buffer, mat, ...size)); parent.addChild(n); return n; };
  const torso = await part('torso', [0, 0.5, 0], root, [0.15, 0.4, 0.1]);
  await part('head', [0, 0.4, 0], torso, [0.15, 0.3, 0.15]);
  // An arm hangs down from its shoulder: its box runs below the joint.
  const armL = doc.createNode('arm-left').setTranslation([0.2, 0.35, 0]).setMesh(await boxMesh(doc, buffer, mat, 0.05, 0.35, 0.05, true)); torso.addChild(armL);
  const armR = doc.createNode('arm-right').setTranslation([-0.2, 0.35, 0]).setMesh(await boxMesh(doc, buffer, mat, 0.05, 0.35, 0.05, true)); torso.addChild(armR);
  const legL = doc.createNode('leg-left').setTranslation([0.08, 0.5, 0]).setMesh(await boxMesh(doc, buffer, mat, 0.06, 0.5, 0.06, true)); root.addChild(legL);
  const legR = doc.createNode('leg-right').setTranslation([-0.08, 0.5, 0]).setMesh(await boxMesh(doc, buffer, mat, 0.06, 0.5, 0.06, true)); root.addChild(legR);
  const a = doc.createAnimation('idle');
  for (const n of [root, torso, armL, armR, legL, legR]) {
    const s = doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])).setBuffer(buffer)).setInterpolation('LINEAR');
    a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath('rotation').setSampler(s));
  }
  return io.writeBinary(doc);
}

function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10; const b01 = a00 * a12 - a02 * a10; const b02 = a00 * a13 - a03 * a10; const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11; const b05 = a02 * a13 - a03 * a12; const b06 = a20 * a31 - a21 * a30; const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30; const b09 = a21 * a32 - a22 * a31; const b10 = a21 * a33 - a23 * a31; const b11 = a22 * a33 - a23 * a32;
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * A starter library folder of this test's own (the index contract) holding `items`: [{ id: 'pack/item', kind,
 * bytes, rigged, clips }]. Returns its folder.
 */
export function writeLibrary(dir, items) {
  const out = [];
  for (const it of items) {
    const [pack, item] = it.id.split('/');
    const path = `items/${pack}/${item}.glb`;
    mkdirSync(join(dir, 'items', pack), { recursive: true });
    writeFileSync(join(dir, path), it.bytes);
    out.push({ id: it.id, pack, item, name: item, kind: it.kind ?? 'prop', family: pack.split('-')[0], tags: [item], file: path, files: [{ role: 'model', path, bytes: it.bytes.byteLength, sha256: sha256(it.bytes) }], license: 'cc0', author: 'Test', heightM: 1, suggestM: it.suggestM ?? null, rigged: Boolean(it.rigged), bones: it.bones ?? 0, clips: it.clips ?? [] });
  }
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ v: 1, kind: 'homie-starter-library', version: 'v0', packs: [...new Set(out.map((x) => x.pack))].map((id) => ({ id, label: id, family: id.split('-')[0], url: `https://example.test/${id}`, license: 'cc0', licenseFile: `licenses/${id}.txt` })), items: out })}\n`);
  return dir;
}
