/**
 * THE SKELETON STANDARD: one bone vocabulary for every character a studio makes, so clips, sockets, look-at and foot
 * planting work on any of them (free, on this computer).
 *
 *   Families
 *     humanoid    people: the VRM 1.0 humanoid bone names (hips, spine, chest, neck, head, leftUpperArm, leftLowerArm,
 *                 leftHand, leftUpperLeg, leftLowerLeg, leftFoot, leftToes, and the right side), 4 influences a vertex.
 *                 In: Mixamo names (mixamorig:LeftArm, the de facto standard: Tripo's mixamo spec, Meshy, Rokoko),
 *                 KayKit (upperarm.l), Blender (upper_arm.L, thigh.L), Unreal (upperarm_l, thigh_l, calf_l).
 *     mini        chibi people of one piece per limb (Kenney's mini and blocky characters): hips, spine, head, and an
 *                 upper arm and upper leg a side. Humanoid clips retarget onto it (a whole leg follows the thigh).
 *     quadruped   four legs (Kenney's cube pets): body, head, neck, tail, frontLeftLeg, frontRightLeg, backLeftLeg,
 *                 backRightLeg. Clips come from its own species; humanoid clips never fit it.
 *     parts       anything else that moves by its nodes: its own clips only.
 *   A rig is skinned (bones bend a mesh) or rigid (each part a node that moves: Kenney's blocky characters and pets);
 *   both play clips through three.js's AnimationMixer the same way.
 *
 *   skeletonOf(doc)            the family, the map from the file's names to the standard, what is missing, the helper
 *                              bones that move nothing, and a fingerprint: characters with one fingerprint share one
 *                              clip library (public/anims/<skeleton>.glb)
 *   normaliseRig(doc, opts)    the shipped character: joints renamed to the standard, helper bones that move nothing
 *                              removed, every skinned part and every held thing (a sword under the hand) merged into ONE
 *                              skinned mesh (one draw call; `keep` picks which held things stay: part swaps), clips taken out
 *
 * Bone names are matched after lower-casing and dropping separators, so "mixamorig:LeftUpLeg", "LeftUpLeg" and
 * "left_up_leg" are one name. Fingers and anything unmatched keep their own names.
 */
import { createHash } from 'node:crypto';

/** The VRM 1.0 humanoid bones Homie uses (fingers keep their own names; three.js reads 4 influences, so do we). */
export const HUMANOID = Object.freeze([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]);
/** VRM's required fifteen: a rig missing one of these is not a humanoid. */
export const HUMANOID_REQUIRED = Object.freeze(['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']);
export const MINI = Object.freeze(['hips', 'spine', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg']);
export const QUADRUPED = Object.freeze(['body', 'neck', 'head', 'tail', 'frontLeftLeg', 'frontRightLeg', 'backLeftLeg', 'backRightLeg']);
/** Where held things go: the standard socket names and the bones that carry them when a rig has no slot bone. */
export const SOCKETS = Object.freeze({ rightHand: ['rightHandSlot', 'rightHand'], leftHand: ['leftHandSlot', 'leftHand'], head: ['headSlot', 'head'], back: ['upperChest', 'chest', 'spine'] });

export const FAMILIES = Object.freeze({
  humanoid: { label: 'Homie humanoid (VRM names)', bones: HUMANOID, required: HUMANOID_REQUIRED, note: 'people: one vocabulary, so one clip set retargets onto any of them' },
  mini: { label: 'Mini humanoid (one piece per limb)', bones: MINI, required: ['hips', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'], note: 'chibi people: humanoid clips retarget onto them, a whole limb following its upper bone' },
  quadruped: { label: 'Quadruped (four legs)', bones: QUADRUPED, required: ['body', 'frontLeftLeg', 'frontRightLeg', 'backLeftLeg', 'backRightLeg'], note: 'animals: their own species\' clips' },
  parts: { label: 'Moving parts', bones: [], required: [], note: 'its own clips only' },
});

// Prefixes rigs put on every bone ("mixamorig:", "Armature|", "DEF-"); "rig" only with a separator, or "rightHand" loses it.
const key = (s) => String(s ?? '').toLowerCase().replace(/^(mixamorig\d*[:_]?|(armature|rig|bip0?1|def|org|mch)[:_. |-]+)/, '').replace(/[^a-z0-9]/g, '');

/*
 * Name tables, by the key above. Order matters only inside a table: a rig names each bone once.
 * Sources: Mixamo's mixamorig set (three-vrm's mixamoVRMRigMap, MIT), KayKit's rig (its CC0 packs), Blender's
 * metarig and Rigify DEF bones, Unreal's mannequin, Kenney's mini and blocky characters and cube pets.
 */
const HUMANOID_NAMES = {
  hips: ['hips', 'hip', 'pelvis', 'root_pelvis'],
  spine: ['spine', 'spine01', 'spine1', 'spine001', 'torso', 'abdomen'],
  chest: ['spine1', 'spine02', 'spine2', 'chest', 'spine002', 'spine003'],
  upperChest: ['spine2', 'spine03', 'upperchest', 'spine004'],
  neck: ['neck', 'neck01', 'neck1'],
  head: ['head'],
  jaw: ['jaw'],
  leftEye: ['lefteye', 'eyel', 'eyeleft'],
  rightEye: ['righteye', 'eyer', 'eyeright'],
  leftShoulder: ['leftshoulder', 'shoulderl', 'claviclel', 'leftclavicle', 'lshoulder'],
  leftUpperArm: ['leftarm', 'upperarml', 'leftupperarm', 'lupperarm', 'larm', 'armleft'],
  leftLowerArm: ['leftforearm', 'lowerarml', 'forearml', 'leftlowerarm', 'lforearm'],
  leftHand: ['lefthand', 'wristl', 'handl', 'lhand'],
  rightShoulder: ['rightshoulder', 'shoulderr', 'clavicler', 'rightclavicle', 'rshoulder'],
  rightUpperArm: ['rightarm', 'upperarmr', 'rightupperarm', 'rupperarm', 'rarm', 'armright'],
  rightLowerArm: ['rightforearm', 'lowerarmr', 'forearmr', 'rightlowerarm', 'rforearm'],
  rightHand: ['righthand', 'wristr', 'handr', 'rhand'],
  leftUpperLeg: ['leftupleg', 'upperlegl', 'thighl', 'leftthigh', 'leftupperleg', 'lthigh', 'legleft'],
  leftLowerLeg: ['leftleg', 'lowerlegl', 'shinl', 'calfl', 'leftshin', 'leftlowerleg', 'lcalf', 'leftcalf'],
  leftFoot: ['leftfoot', 'footl', 'lfoot'],
  leftToes: ['lefttoebase', 'toesl', 'toel', 'balll', 'lefttoe', 'ltoe'],
  rightUpperLeg: ['rightupleg', 'upperlegr', 'thighr', 'rightthigh', 'rightupperleg', 'rthigh', 'legright'],
  rightLowerLeg: ['rightleg', 'lowerlegr', 'shinr', 'calfr', 'rightshin', 'rightlowerleg', 'rcalf', 'rightcalf'],
  rightFoot: ['rightfoot', 'footr', 'rfoot'],
  rightToes: ['righttoebase', 'toesr', 'toer', 'ballr', 'righttoe', 'rtoe'],
  leftHandSlot: ['handslotl', 'lefthandslot', 'weaponl', 'propl'],
  rightHandSlot: ['handslotr', 'righthandslot', 'weaponr', 'propr'],
};
/** KayKit and Unreal suffixes (".l", "_l") collide with Mixamo's prefixes after keying; these settle it. */
const SUFFIXED = { upperarm: 'UpperArm', lowerarm: 'LowerArm', forearm: 'LowerArm', upperleg: 'UpperLeg', lowerleg: 'LowerLeg', thigh: 'UpperLeg', calf: 'LowerLeg', shin: 'LowerLeg', foot: 'Foot', toes: 'Toes', toe: 'Toes', ball: 'Toes', wrist: 'Hand', hand: 'Hand', clavicle: 'Shoulder', shoulder: 'Shoulder', upperarmtwist: null };

const MINI_NAMES = { hips: ['root', 'hips', 'body'], spine: ['torso', 'spine', 'chest'], head: ['head'], leftUpperArm: ['armleft', 'leftarm'], rightUpperArm: ['armright', 'rightarm'], leftUpperLeg: ['legleft', 'leftleg'], rightUpperLeg: ['legright', 'rightleg'] };
const QUAD_NAMES = { body: ['body', 'spine', 'torso'], neck: ['neck'], head: ['head'], tail: ['tail', 'tail01', 'tail1'], frontLeftLeg: ['legfrontleft', 'frontleftleg', 'legfl', 'frontlegl', 'leftfrontleg'], frontRightLeg: ['legfrontright', 'frontrightleg', 'legfr', 'frontlegr', 'rightfrontleg'], backLeftLeg: ['legbackleft', 'backleftleg', 'legbl', 'backlegl', 'hindlegl', 'leftbackleg', 'leftbackleg'], backRightLeg: ['legbackright', 'backrightleg', 'legbr', 'backlegr', 'hindlegr', 'rightbackleg'] };

/** A name read with a side suffix (KayKit "upperarm.l", Unreal "thigh_l", Blender "thigh.L"): its standard name. */
function suffixed(raw) {
  const m = /^(?:.*?[:_. -])?([a-z]+?)(?:[_. -]?0*\d*)?[_. -](l|r|left|right)$/i.exec(String(raw).toLowerCase().replace(/^(mixamorig\d*|def|org|mch)[:_. -]*/, ''));
  if (!m) return null;
  const base = m[1].replace(/[^a-z]/g, '');
  const side = m[2].startsWith('l') ? 'left' : 'right';
  if (base === 'handslot' || base === 'weapon' || base === 'prop') return `${side}HandSlot`;
  const part = SUFFIXED[base];
  return part ? `${side}${part}` : null;
}

/** Map a list of joint names to one family's standard names: { map: { std: name }, score }. */
function mapNames(names, table, { useSuffix = false } = {}) {
  const map = {};
  const taken = new Set();
  // Exact keys first, in the table's order (so Mixamo's Spine/Spine1/Spine2 land on spine/chest/upperChest).
  const keyed = names.map((n) => ({ n, k: key(n) }));
  for (const [std, alts] of Object.entries(table)) {
    // A rig already normalised names its bones by the standard itself.
    for (const alt of [std.toLowerCase(), ...alts]) {
      const hit = keyed.find((x) => x.k === alt && !taken.has(x.n));
      if (hit) { map[std] = hit.n; taken.add(hit.n); break; }
    }
  }
  if (useSuffix) {
    for (const n of names) {
      if (taken.has(n)) continue;
      const std = suffixed(n);
      if (std && !map[std] && (table[std] || /HandSlot$/.test(std))) { map[std] = n; taken.add(n); }
    }
  }
  return map;
}

/**
 * The family and the standard-name map of a list of joint names (or node names of a rigid rig).
 * Returns { family, map: { std: original }, missing: [std], extra: [original] }.
 */
export function mapSkeleton(names, parentOf = null) {
  const hum = mapNames(names, HUMANOID_NAMES, { useSuffix: true });
  // The spine chain by the tree, not by its numbers: Mixamo counts Spine, Spine1, Spine2 upward, Meshy counts Spine02,
  // Spine01, Spine upward. Whatever they are called, the joints between the hips and the neck (or head) are spine,
  // chest and upper chest, in that order from the hips.
  if (parentOf && hum.hips && (hum.neck || hum.head)) {
    const chain = [];
    let at = parentOf[hum.neck ?? hum.head];
    while (at && at !== hum.hips && chain.length < 8) { chain.unshift(at); at = parentOf[at]; }
    if (at === hum.hips && chain.length) {
      for (const k of ['spine', 'chest', 'upperChest']) delete hum[k];
      ['spine', 'chest', 'upperChest'].forEach((k, i) => { if (chain[i]) hum[k] = chain[i]; });
    }
  }
  // Mixamo's chain is Spine, Spine1, Spine2: spine, chest, upperChest. KayKit's is spine, chest.
  const humMissing = HUMANOID_REQUIRED.filter((b) => !hum[b]);
  if (humMissing.length <= 1 && hum.hips && hum.leftUpperLeg && hum.leftLowerLeg) {
    return { family: 'humanoid', map: hum, missing: humMissing, extra: names.filter((n) => !Object.values(hum).includes(n)) };
  }
  const quad = mapNames(names, QUAD_NAMES);
  if (FAMILIES.quadruped.required.every((b) => quad[b])) return { family: 'quadruped', map: quad, missing: QUADRUPED.filter((b) => !quad[b]), extra: names.filter((n) => !Object.values(quad).includes(n)) };
  const mini = mapNames(names, MINI_NAMES);
  if (FAMILIES.mini.required.every((b) => mini[b])) return { family: 'mini', map: mini, missing: MINI.filter((b) => !mini[b]), extra: names.filter((n) => !Object.values(mini).includes(n)) };
  return { family: names.length ? 'parts' : 'none', map: {}, missing: [], extra: names };
}

/* ------------------------------------------------------------------ reading a rig from a glTF Document */

const parentsOf = (root) => { const p = new Map(); for (const n of root.listNodes()) for (const c of n.listChildren()) p.set(c, n); return p; };

/**
 * The joints of a Document's character: a skin's joints (skinned), else the nodes its clips move (rigid parts).
 * Returns { skinned, joints: Node[], skin } (joints in hierarchy order, parents first).
 */
export function jointsOf(doc) {
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (skins.length) {
    // Characters with several skins (rare) share one skeleton in practice: take the biggest.
    const skin = skins.reduce((a, b) => (b.listJoints().length > a.listJoints().length ? b : a));
    return { skinned: true, skin, joints: depthOrder(root, skin.listJoints()) };
  }
  const moved = new Set();
  for (const a of root.listAnimations()) for (const c of a.listChannels()) { const n = c.getTargetNode(); if (n) moved.add(n); }
  // Every part under a moving part is a part too (a head no clip happens to turn is still the head).
  for (const n of [...moved]) { const walk = (x) => { for (const c of x.listChildren()) { if (!moved.has(c) && (c.getMesh() || c.listChildren().length)) moved.add(c); walk(c); } }; walk(n); }
  // A rigid rig whose clips went to its clip library: normaliseRig marked its moving parts.
  if (!moved.size) for (const n of root.listNodes()) if (n.getExtras()?.homie?.joint) moved.add(n);
  return { skinned: false, skin: null, joints: depthOrder(root, [...moved]) };
}

function depthOrder(root, nodes) {
  const parents = parentsOf(root);
  const depth = (n) => { let d = 0; let p = parents.get(n); while (p) { d += 1; p = parents.get(p); } return d; };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

/** Total vertex weight per joint index of a skin (a joint that moves nothing has 0). */
export function jointWeights(doc, skin) {
  const joints = skin.listJoints();
  const used = new Float64Array(joints.length);
  const j = [0, 0, 0, 0]; const w = [0, 0, 0, 0];
  let influences = 4;
  for (const node of doc.getRoot().listNodes()) {
    if (node.getSkin() !== skin || !node.getMesh()) continue;
    for (const p of node.getMesh().listPrimitives()) {
      if (p.getAttribute('JOINTS_1')) influences = 8;
      const J = p.getAttribute('JOINTS_0'); const W = p.getAttribute('WEIGHTS_0');
      if (!J || !W) continue;
      for (let i = 0; i < J.getCount(); i++) { J.getElement(i, j); W.getElement(i, w); for (let k = 0; k < 4; k++) if (j[k] < used.length) used[j[k]] += w[k]; }
    }
  }
  return { used, influences };
}

/**
 * skeletonOf(doc): what kind of rig a character has. { family, skinned, bones (joints), deform (joints that move a
 * vertex, or every joint of a rigid rig), map: { std: original }, missing, helpers (joints that move nothing and lead
 * to nothing that does), influences, fingerprint, id }.
 */
export function skeletonOf(doc) {
  const { skinned, skin, joints } = jointsOf(doc);
  if (!joints.length) return { family: 'none', skinned: false, bones: 0, deform: 0, map: {}, missing: [], helpers: [], influences: 0, fingerprint: null, id: null, joints: [] };
  const names = joints.map((n) => n.getName());
  const tree = parentsOf(doc.getRoot());
  const parentOf = Object.fromEntries(joints.map((n) => [n.getName(), tree.get(n)?.getName() ?? null]));
  const { family, map, missing } = mapSkeleton(names, parentOf);
  let helpers = [];
  let deform = joints.length;
  let influences = 4;
  if (skinned) {
    const w = jointWeights(doc, skin);
    influences = w.influences;
    const all = skin.listJoints();
    const weighted = new Set(all.filter((_, i) => w.used[i] > 1e-6));
    deform = weighted.size;
    // A helper moves no vertex, has no weighted joint under it, is not a mapped bone or a socket: IK targets, poles.
    const parents = parentsOf(doc.getRoot());
    const keepers = new Set([...weighted, ...Object.values(map).map((n) => all.find((x) => x.getName() === n)).filter(Boolean)]);
    for (const n of [...keepers]) { let p = parents.get(n); while (p && all.includes(p)) { keepers.add(p); p = parents.get(p); } }
    helpers = all.filter((n) => !keepers.has(n)).map((n) => n.getName());
  }
  const std = Object.fromEntries(Object.entries(map).map(([s, o]) => [o, s]));
  const parents = parentsOf(doc.getRoot());
  const rows = joints.filter((n) => !helpers.includes(n.getName())).map((n) => {
    const r = n.getRotation();
    return `${std[n.getName()] ?? n.getName()}<${std[parents.get(n)?.getName()] ?? parents.get(n)?.getName() ?? ''}:${r.map((v) => (Math.round(v * 50) / 50).toFixed(2)).join(',')}`;
  });
  const fingerprint = createHash('sha256').update(`${family}|${skinned ? 's' : 'r'}|${rows.join(';')}`).digest('hex').slice(0, 10);
  return { family, skinned, bones: joints.length, deform, map, missing, helpers, influences, fingerprint, id: `${family}-${fingerprint.slice(0, 6)}`, joints: names };
}

/* ------------------------------------------------------------------ the shipped character */

const mat4 = () => new Float64Array(16);
function mul(a, b) {
  const o = mat4();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10; const b01 = a00 * a12 - a02 * a10; const b02 = a00 * a13 - a03 * a10; const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11; const b05 = a02 * a13 - a03 * a12; const b06 = a20 * a31 - a21 * a30; const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30; const b09 = a21 * a32 - a22 * a31; const b10 = a21 * a33 - a23 * a31; const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return Float64Array.from([
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}
const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const applyDir = (m, v) => { const o = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; const l = Math.hypot(...o) || 1; return o.map((x) => x / l); };

/** A node's world matrix from its own and its parents' rest transforms. */
const worldOf = (node) => Float64Array.from(node.getWorldMatrix());

/**
 * The character a game ships, from a raw rigged model (a Document, changed in place):
 *   rename   joints to the standard names (the map from skeletonOf), so clips, sockets and look-at find them
 *   helpers  joints that move nothing (IK targets, poles) removed from the skin and the tree
 *   merge    every skinned part and every held thing under a joint (a sword in the hand, a hat on the head) into ONE
 *            skinned primitive per material: one draw call. `keep`: the held things to keep (names, or a test); the
 *            rest are dropped (part swaps); null keeps them all
 *   clips    every clip taken out and returned (they go to the skeleton's clip library)
 * Returns { skeleton (after), renamed, removedHelpers, merged, dropped, kept, clips: Animation[] (detached copies are
 * not made: the caller reads them before disposing) }.
 */
export function normaliseRig(doc, { keep = null, merge = true, rename = true, helpers = true, takeClips = true } = {}) {
  const root = doc.getRoot();
  const before = skeletonOf(doc);
  const { skinned, skin } = jointsOf(doc);
  const out = { renamed: 0, removedHelpers: [], merged: 0, dropped: [], kept: [] };
  if (rename) {
    for (const [std, orig] of Object.entries(before.map)) {
      const n = root.listNodes().find((x) => x.getName() === orig);
      if (n && n.getName() !== std) { n.setName(std); out.renamed += 1; }
    }
  }
  if (skinned && helpers && before.helpers.length) {
    out.removedHelpers = removeJoints(doc, skin, before.helpers);
  }
  if (skinned && merge) Object.assign(out, mergeCharacter(doc, skin, keep));
  // A rigid rig (parts that move by their nodes) keeps knowing its joints once its clips are gone.
  if (!skinned) for (const n of jointsOf(doc).joints) n.setExtras({ ...(n.getExtras() ?? {}), homie: { ...(n.getExtras()?.homie ?? {}), joint: true } });
  // The clips go to the skeleton's clip library (lib/clips.mjs bakes them before this runs); the model ships without.
  if (takeClips) for (const a of root.listAnimations()) a.dispose();
  return { ...out, before, after: skeletonOf(doc) };
}

/** Remove joints from a skin (and the tree) and re-index every vertex's JOINTS_0. Returns the removed names. */
function removeJoints(doc, skin, names) {
  const all = skin.listJoints();
  const gone = all.filter((n) => names.includes(n.getName()));
  if (!gone.length) return [];
  const keepIdx = all.map((n, i) => (gone.includes(n) ? -1 : i)).filter((i) => i >= 0);
  const remap = new Int32Array(all.length).fill(0);
  keepIdx.forEach((old, neu) => { remap[old] = neu; });
  const ibm = skin.getInverseBindMatrices();
  for (const node of doc.getRoot().listNodes()) {
    if (node.getSkin() !== skin || !node.getMesh()) continue;
    for (const p of node.getMesh().listPrimitives()) {
      const J = p.getAttribute('JOINTS_0'); const W = p.getAttribute('WEIGHTS_0');
      if (!J) continue;
      const j = [0, 0, 0, 0]; const w = [0, 0, 0, 0];
      for (let i = 0; i < J.getCount(); i++) {
        J.getElement(i, j); W.getElement(i, w);
        // A removed joint carried no weight: its slot is zeroed and points at joint 0.
        for (let k = 0; k < 4; k++) { if (remap[j[k]] === undefined || gone.includes(all[j[k]])) { j[k] = 0; w[k] = 0; } else j[k] = remap[j[k]]; }
        J.setElement(i, j); W.setElement(i, w);
      }
    }
  }
  if (ibm) {
    const arr = ibm.getArray();
    const next = new Float32Array(keepIdx.length * 16);
    keepIdx.forEach((old, neu) => next.set(arr.subarray(old * 16, old * 16 + 16), neu * 16));
    ibm.setArray(next);
  }
  const removed = gone.map((n) => n.getName());
  for (const n of gone) skin.removeJoint(n);
  // Out of the tree too (a helper's children are helpers as well).
  for (const n of gone) n.dispose();
  return removed;
}

/**
 * Merge a character into one skinned primitive per material. Skinned parts are already in bind space; a held thing
 * (a rigid mesh under a joint) becomes skinned to that joint with full weight: its vertices are carried into bind
 * space through the joint's bind matrix. Returns { merged, dropped, kept }.
 */
function mergeCharacter(doc, skin, keep) {
  const root = doc.getRoot();
  const joints = skin.listJoints();
  const parents = parentsOf(root);
  const ibmArr = skin.getInverseBindMatrices()?.getArray() ?? null;
  const bindOf = (ji) => (ibmArr ? invert(Float64Array.from(ibmArr.subarray(ji * 16, ji * 16 + 16))) : worldOf(joints[ji]));
  const wants = (name) => (keep === null || keep === undefined ? true : typeof keep === 'function' ? keep(name) : keep.some((k) => k.toLowerCase() === String(name).toLowerCase()));
  const parts = []; // { node, prims, rigid: jointIndex | null }
  const dropped = []; const kept = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (node.getSkin() === skin) { parts.push({ node, rigid: null }); continue; }
    if (node.getSkin()) continue;
    // A rigid mesh: under which joint?
    let p = parents.get(node); let chain = [node];
    while (p && !joints.includes(p)) { chain.unshift(p); p = parents.get(p); }
    if (!p) continue;
    if (!wants(node.getName())) { dropped.push(node.getName()); node.setMesh(null); continue; }
    kept.push(node.getName());
    parts.push({ node, rigid: joints.indexOf(p), chain });
  }
  if (parts.length < 2) return { merged: 0, dropped, kept };
  // Group primitives by material and by the attributes they can share.
  const groups = new Map();
  for (const part of parts) {
    for (const prim of part.node.getMesh().listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getIndices()) return { merged: 0, dropped, kept };
      const k = `${prim.getMaterial()?.getName() ?? ''}#${root.listMaterials().indexOf(prim.getMaterial())}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ part, prim });
    }
  }
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const target = parts.find((p) => p.rigid === null)?.node;
  if (!target) return { merged: 0, dropped, kept };
  const mesh = doc.createMesh(`${target.getName() || 'character'}`);
  let merged = 0;
  for (const items of groups.values()) {
    const semantics = ['POSITION', 'NORMAL', 'TEXCOORD_0'].filter((s) => items.every(({ prim }) => prim.getAttribute(s)));
    const pos = []; const nor = []; const uv = []; const jo = []; const we = []; const idx = [];
    let base = 0;
    for (const { part, prim } of items) {
      const P = prim.getAttribute('POSITION'); const N = prim.getAttribute('NORMAL'); const T = prim.getAttribute('TEXCOORD_0');
      const J = prim.getAttribute('JOINTS_0'); const W = prim.getAttribute('WEIGHTS_0');
      let m = null;
      if (part.rigid !== null) {
        // Rigid: its world rest transform, carried into the bind space of the joint it hangs from.
        const world = worldOf(part.node);
        const jointWorld = worldOf(joints[part.rigid]);
        m = mul(bindOf(part.rigid), mul(invert(jointWorld), world));
      }
      const v = [0, 0, 0]; const n = [0, 0, 0]; const t = [0, 0]; const j = [0, 0, 0, 0]; const w = [0, 0, 0, 0];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        pos.push(...(m ? apply(m, v) : v));
        if (semantics.includes('NORMAL')) { N.getElement(i, n); nor.push(...(m ? applyDir(m, n) : n)); }
        if (semantics.includes('TEXCOORD_0')) { T.getElement(i, t); uv.push(t[0], t[1]); }
        if (part.rigid !== null) { jo.push(part.rigid, 0, 0, 0); we.push(1, 0, 0, 0); }
        else { J.getElement(i, j); W.getElement(i, w); jo.push(...j); we.push(...w); }
      }
      const I = prim.getIndices();
      for (let i = 0; i < I.getCount(); i++) idx.push(I.getScalar(i) + base);
      base += P.getCount();
    }
    const prim = doc.createPrimitive().setMaterial(items[0].prim.getMaterial());
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer));
    if (nor.length) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
    if (uv.length) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints.length > 255 ? new Uint16Array(jo) : new Uint8Array(jo)).setBuffer(buffer));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(we)).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(base > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)).setBuffer(buffer));
    mesh.addPrimitive(prim);
    merged += items.length;
  }
  // The merged mesh hangs where the first skinned part did; every part's own node loses its mesh.
  for (const part of parts) { const old = part.node.getMesh(); part.node.setMesh(null); if (part.node !== target) part.node.setSkin(null); if (old && !old.listParents().some((x) => x.propertyType === 'Node')) old.dispose(); }
  target.setMesh(mesh).setSkin(skin).setName(target.getName());
  return { merged, dropped, kept };
}

/** The standard name of a socket on a rig (`rightHand` -> its slot bone, else the hand), from a list of joint names. */
export function socketBone(names, socket) {
  for (const n of SOCKETS[socket] ?? [socket]) if (names.includes(n)) return n;
  return null;
}
