/**
 * CLIPS: a game's animation verbs, where each comes from, retargeting onto a skeleton, and the clip library a skeleton
 * ships (public/anims/<skeleton>.glb), baked here at build time, free, on this computer.
 *
 *   VERBS                     the verbs a game's clips are named by (idle, walk, run, jump, fall, land, attack, hit, die,
 *                             emote, win, interact, pickup, cast, block, dodge, crouch, sit), each with its loop rule
 *   findClip(names, verb)     a source's own clip for a verb (KayKit "Running_A", Kenney "sprint", Mixamo "Running")
 *   retargetClip(from, clip, to, opts)   one clip onto another skeleton: every mapped bone turns in the WORLD the way
 *                             the source's turned from its rest pose, after the two rest poses are lined up bone by bone
 *                             (a T-pose clip on an A-pose rig keeps its arms down); the hips move by the clip's motion
 *                             scaled to the target's hip height; loops are kept in place (the game moves bodies)
 *   bakeLibrary(to, sources, verbs)      a skeleton's clip library: the target's joints (no mesh) and one clip per verb,
 *                             sampled at 30 fps, constant tracks dropped, quaternions kept continuous
 *   writeLibrary(doc)         resampled and meshopt-compressed bytes, with its measurements
 *
 * Retargeting is plain matrix and quaternion math (three.js's math classes, no renderer), so it runs in Node, in a
 * cloud session and in CI. A clip baked onto a skeleton plays on every character with that skeleton's fingerprint
 * (lib/rig.mjs skeletonOf): shared clips are the biggest byte and memory saving for a room of 32.
 */
// three's maths, loaded if it is there: a studio has it (its games draw with it); Homie for Claude Desktop's packed
// server does not, and only reads verbs and plans there (retargeting runs in the studio's own homie-studio).
let Matrix4; let Quaternion; let Vector3;
try { ({ Matrix4, Quaternion, Vector3 } = await import('three')); } catch { Matrix4 = null; }
const needThree = () => { if (!Matrix4) throw new Error('retargeting needs three (npm install in the studio)'); };
import { jointsOf, skeletonOf } from './rig.mjs';

/** The verbs, in the order a card shows them. `loop`: plays forever; `hold`: stays on its last frame (a fall, a death). */
export const VERBS = Object.freeze({
  idle: { loop: true, note: 'standing, breathing' },
  walk: { loop: true, note: 'moving slowly' },
  run: { loop: true, note: 'moving fast' },
  jump: { loop: false, note: 'leaving the ground' },
  fall: { loop: true, note: 'in the air' },
  land: { loop: false, note: 'touching down' },
  attack: { loop: false, note: 'the main action: a swing, a punch, a bump' },
  attack2: { loop: false, note: 'a second action' },
  hit: { loop: false, note: 'being hit' },
  die: { loop: false, hold: true, note: 'out of the round' },
  emote: { loop: false, note: 'a cheer, a wave' },
  win: { loop: true, note: 'the winner\'s pose' },
  interact: { loop: false, note: 'using something' },
  pickup: { loop: false, note: 'picking something up' },
  cast: { loop: false, note: 'a spell' },
  shoot: { loop: false, note: 'firing' },
  block: { loop: true, note: 'guarding' },
  dodge: { loop: false, note: 'a roll or a sidestep' },
  crouch: { loop: true, note: 'low' },
  sit: { loop: true, note: 'sitting' },
  drive: { loop: true, note: 'at the wheel' },
  spawn: { loop: false, note: 'arriving' },
});
export const VERB_IDS = Object.keys(VERBS);

/**
 * Each verb's clip in the packs and rigs the pipeline knows, best first. Matched without case or separators, so
 * "1H_Melee_Attack_Chop" and "1h-melee-attack-chop" are one name. A verb with no match anywhere falls to the words
 * in the clip names (a Mixamo "Standing Idle" is an idle) and is left out when nothing fits.
 */
export const CLIP_NAMES = Object.freeze({
  idle: ['Idle', 'Unarmed_Idle', 'idle', 'Idle_A', 'Standing Idle', 'Breathing Idle', 'static'],
  walk: ['Walking_A', 'walk', 'Walking', 'Walk'],
  run: ['Running_A', 'sprint', 'run', 'Running', 'Run', 'Running_B'],
  jump: ['Jump_Start', 'jump', 'Jump', 'Jumping', 'Jump_Full_Short'],
  fall: ['Jump_Idle', 'fall', 'Falling', 'Falling Idle', 'Fall'],
  land: ['Jump_Land', 'land', 'Landing', 'Land'],
  attack: ['1H_Melee_Attack_Chop', 'attack-melee-right', 'Unarmed_Melee_Attack_Punch_A', 'attack', 'Punching', 'Attack', 'Sword And Shield Slash', 'Slash'],
  attack2: ['1H_Melee_Attack_Slice_Horizontal', 'attack-kick-right', 'Unarmed_Melee_Attack_Kick', 'Kick', 'Kicking'],
  hit: ['Hit_A', 'hit', 'Hit', 'Hit Reaction', 'Reaction', 'gesture-negative'],
  die: ['Death_A', 'die', 'Death', 'Dying', 'Die'],
  emote: ['Cheer', 'emote-yes', 'gesture-positive', 'Waving', 'Wave', 'Cheering', 'dance'],
  win: ['Cheer', 'emote-yes', 'dance', 'Victory', 'Cheering', 'Dancing'],
  interact: ['Interact', 'interact-right', 'eat', 'Use_Item', 'Interact'],
  pickup: ['PickUp', 'pick-up', 'Picking Up', 'Pick Up'],
  cast: ['Spellcast_Shoot', 'Spellcast_Long', 'Spellcasting', 'Casting', 'Spell'],
  shoot: ['1H_Ranged_Shoot', 'holding-right-shoot', '2H_Ranged_Shoot', 'Shooting', 'Shoot'],
  block: ['Blocking', 'Block', 'block'],
  dodge: ['Dodge_Forward', 'Dodge_Backward', 'roll', 'Dodge', 'Roll'],
  crouch: ['crouch', 'Crouching', 'Crouch'],
  sit: ['Sit_Floor_Idle', 'sit', 'Sit_Chair_Idle', 'Sitting', 'Sit'],
  drive: ['drive', 'Driving', 'Drive'],
  spawn: ['Spawn_Ground', 'Skeletons_Awaken_Standing', 'spawn', 'Spawn'],
});
const WORDS = { idle: /idle|breath/, walk: /walk/, run: /run|sprint/, jump: /jump/, fall: /fall/, land: /land/, attack: /attack|slash|punch|swing|chop|stab/, hit: /hit|react|flinch|damage/, die: /death|die|dying/, emote: /cheer|wave|emote|dance/, win: /victor|cheer|win|dance/, interact: /interact|use/, pickup: /pick/, cast: /spell|cast/, shoot: /shoot/, block: /block/, dodge: /dodge|roll/, crouch: /crouch/, sit: /sit/, drive: /drive/, spawn: /spawn|awaken/ };
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** A source's clip for a verb: its name, or null. `names`: the clip names a file has. */
export function findClip(names, verb) {
  const byKey = new Map(names.map((n) => [norm(n), n]));
  for (const want of CLIP_NAMES[verb] ?? []) { const hit = byKey.get(norm(want)); if (hit) return hit; }
  const re = WORDS[verb];
  if (!re) return null;
  // By words, preferring the shortest name (the plain one, not "Running_Strafe_Left").
  return names.filter((n) => re.test(n.toLowerCase())).sort((a, b) => a.length - b.length)[0] ?? null;
}

/* ------------------------------------------------------------------ a rig as plain math */

/**
 * A rig read from a Document: every node from the scene down, with its rest TRS, its parent and its rest world matrix.
 * Joints are found by name (after a rig was normalised, the standard names).
 */
export function rigOf(doc) {
  needThree();
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const nodes = [];
  const byName = new Map();
  const walk = (node, parent) => {
    const t = node.getTranslation(); const r = node.getRotation(); const s = node.getScale();
    const rec = { node, name: node.getName(), parent, t: new Vector3(...t), r: new Quaternion(...r), s: new Vector3(...s), children: [] };
    rec.local = new Matrix4().compose(rec.t, rec.r, rec.s);
    rec.world = parent ? parent.world.clone().multiply(rec.local) : rec.local.clone();
    rec.worldQ = new Quaternion(); rec.worldP = new Vector3(); rec.world.decompose(rec.worldP, rec.worldQ, new Vector3());
    nodes.push(rec);
    if (!byName.has(rec.name)) byName.set(rec.name, rec);
    if (parent) parent.children.push(rec);
    for (const c of node.listChildren()) walk(c, rec);
  };
  for (const c of scene?.listChildren() ?? []) walk(c, null);
  const { joints, skinned, skin } = jointsOf(doc);
  return { nodes, byName, joints: new Set(joints.map((j) => j.getName())), skinned, skin, doc, skeleton: skeletonOf(doc) };
}

/** Sample one animation channel's sampler at time t (linear, step, or the value part of a cubic spline). */
function sample(sampler, t, out) {
  const input = sampler.getInput(); const output = sampler.getOutput();
  const n = input.getCount();
  const interp = sampler.getInterpolation();
  const width = output.getElementSize();
  const cubic = interp === 'CUBICSPLINE';
  const at = (i, o) => { output.getElement(cubic ? i * 3 + 1 : i, o); return o; };
  const times = input.getArray();
  if (n === 1 || t <= times[0]) return at(0, out);
  if (t >= times[n - 1]) return at(n - 1, out);
  let lo = 0; let hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  if (interp === 'STEP') return at(lo, out);
  const u = (t - times[lo]) / Math.max(1e-9, times[hi] - times[lo]);
  const a = at(lo, new Array(width)); const b = at(hi, new Array(width));
  if (width === 4) { const qa = new Quaternion(...a); const qb = new Quaternion(...b); qa.slerp(qb, u); out[0] = qa.x; out[1] = qa.y; out[2] = qa.z; out[3] = qa.w; return out; }
  for (let k = 0; k < width; k++) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

const durationOf = (anim) => anim.listSamplers().reduce((m, s) => Math.max(m, s.getInput().getMax([])[0] ?? 0), 0);

/** The world rotation and position of every node of a rig at time t of a clip (forward kinematics). */
function poseAt(rig, channels, t) {
  const world = new Map();
  const tmpT = new Vector3(); const tmpR = new Quaternion(); const tmpS = new Vector3();
  const v = [0, 0, 0, 0];
  for (const rec of rig.nodes) {
    const ch = channels.get(rec.node);
    tmpT.copy(rec.t); tmpR.copy(rec.r); tmpS.copy(rec.s);
    if (ch?.translation) { sample(ch.translation, t, v); tmpT.set(v[0], v[1], v[2]); }
    if (ch?.rotation) { sample(ch.rotation, t, v); tmpR.set(v[0], v[1], v[2], v[3]).normalize(); }
    if (ch?.scale) { sample(ch.scale, t, v); tmpS.set(v[0], v[1], v[2]); }
    const local = new Matrix4().compose(tmpT, tmpR, tmpS);
    const w = rec.parent ? world.get(rec.parent).m.clone().multiply(local) : local;
    const q = new Quaternion(); const p = new Vector3(); w.decompose(p, q, new Vector3());
    world.set(rec, { m: w, q, p });
  }
  return world;
}

/** A clip's channels by node: Map(node -> { rotation, translation, scale } samplers). */
function channelsOf(anim) {
  const out = new Map();
  for (const c of anim.listChannels()) {
    const n = c.getTargetNode(); if (!n) continue;
    if (!out.has(n)) out.set(n, {});
    out.get(n)[c.getTargetPath()] = c.getSampler();
  }
  return out;
}

/** The bone after this one along its limb, to read which way it points (the first that the rig has). */
const NEXT = {
  hips: ['spine'], spine: ['chest', 'upperChest', 'neck', 'head'], chest: ['upperChest', 'neck', 'head'], upperChest: ['neck', 'head'], neck: ['head'],
  leftShoulder: ['leftUpperArm'], leftUpperArm: ['leftLowerArm', 'leftHand'], leftLowerArm: ['leftHand'], leftUpperLeg: ['leftLowerLeg', 'leftFoot'], leftLowerLeg: ['leftFoot'], leftFoot: ['leftToes'],
  rightShoulder: ['rightUpperArm'], rightUpperArm: ['rightLowerArm', 'rightHand'], rightLowerArm: ['rightHand'], rightUpperLeg: ['rightLowerLeg', 'rightFoot'], rightLowerLeg: ['rightFoot'], rightFoot: ['rightToes'],
  frontLeftLeg: [], frontRightLeg: [], backLeftLeg: [], backRightLeg: [], body: ['head', 'neck'], tail: [],
};
/** For a whole limb in one piece (the mini family), where the limb ends on a full humanoid. */
const LIMB_END = { leftUpperArm: 'leftHand', rightUpperArm: 'rightHand', leftUpperLeg: 'leftFoot', rightUpperLeg: 'rightFoot', spine: 'head' };

/** Where a bone's own vertices sit, in its rig's rest world (skinned: vertices it mostly carries; rigid: its mesh). */
function meshCentroid(rig, rec) {
  const doc = rig.doc;
  const acc = new Vector3(); let n = 0;
  const v = [0, 0, 0]; const j = [0, 0, 0, 0]; const w = [0, 0, 0, 0];
  if (rig.skinned && rig.skin) {
    const idx = rig.skin.listJoints().indexOf(rec.node);
    for (const node of doc.getRoot().listNodes()) {
      if (node.getSkin() !== rig.skin || !node.getMesh()) continue;
      for (const p of node.getMesh().listPrimitives()) {
        const P = p.getAttribute('POSITION'); const J = p.getAttribute('JOINTS_0'); const W = p.getAttribute('WEIGHTS_0');
        if (!P || !J || !W) continue;
        for (let i = 0; i < P.getCount(); i++) {
          J.getElement(i, j); W.getElement(i, w);
          let mine = 0; for (let k = 0; k < 4; k++) if (j[k] === idx) mine += w[k];
          if (mine < 0.5) continue;
          P.getElement(i, v); acc.add(new Vector3(...v)); n += 1;
        }
      }
    }
  } else if (rec.node.getMesh()) {
    for (const p of rec.node.getMesh().listPrimitives()) {
      const P = p.getAttribute('POSITION'); if (!P) continue;
      for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); acc.add(new Vector3(...v).applyMatrix4(rec.world)); n += 1; }
    }
  }
  return n ? acc.divideScalar(n) : null;
}

/**
 * Which way a standard bone points at rest in its rig's world (a unit vector), or null: towards the next bone along its
 * limb; for a limb in one piece (`mesh`), towards the middle of its own vertices. A bone with nothing after it (a head,
 * a hand) has no direction here: lining those up by their vertices would tip a big chibi head over.
 */
function restDirection(rig, std, rec, { wholeLimb = false, mesh = false } = {}) {
  const ends = wholeLimb && LIMB_END[std] ? [LIMB_END[std]] : NEXT[std] ?? [];
  for (const e of ends) {
    const c = rig.byName.get(e);
    if (c && (rig.joints.has(e) || !rig.skinned)) { const d = c.worldP.clone().sub(rec.worldP); if (d.lengthSq() > 1e-10) return d.normalize(); }
  }
  if (!mesh) return null;
  const centre = meshCentroid(rig, rec);
  if (centre) { const d = centre.sub(rec.worldP); if (d.lengthSq() > 1e-10) return d.normalize(); }
  return null;
}

/**
 * How high a rig's legs reach at rest (world units): the hip joints (the tops of the upper legs) above the ground (its
 * feet, else 0). The scale a clip's hip motion takes from one rig to another: a chibi's bob is a chibi's size. A mini
 * rig's hips bone sits on the ground; its legs still say how tall it stands.
 */
function hipsHeight(rig) {
  const legs = ['leftUpperLeg', 'rightUpperLeg', 'frontLeftLeg', 'backLeftLeg'].map((n) => rig.byName.get(n)).filter(Boolean);
  const hips = rig.byName.get('hips') ?? rig.byName.get('body');
  const top = legs.length ? legs.reduce((s, r) => s + r.worldP.y, 0) / legs.length : hips?.worldP.y;
  if (!Number.isFinite(top)) return 1;
  let low = Infinity;
  for (const n of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']) { const r = rig.byName.get(n); if (r) low = Math.min(low, r.worldP.y); }
  if (!Number.isFinite(low)) low = 0;
  return Math.max(1e-6, top - Math.min(low, top * 0.1));
}

/**
 * One clip of `from` (a rig, normalised to standard names) onto `to` (another rig). Options:
 *   fps        samples a second (30)
 *   inPlace    'loops' (default): a looping clip's drift across the ground is removed; true: every clip's; false: none
 *   loop       whether this clip loops (from VERBS)
 *   same       the two rigs share a fingerprint: copy local rotations bone for bone (exact)
 * Returns { name, duration, tracks: [{ node, path, times: Float32Array, values: Float32Array }] }.
 */
export function retargetClip(from, anim, to, { name = anim.getName(), fps = 30, inPlace = 'loops', loop = false, same = false } = {}) {
  needThree();
  const duration = durationOf(anim);
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(frames);
  for (let i = 0; i < frames; i++) times[i] = Math.min(duration, i / fps);
  const ch = channelsOf(anim);
  // Pairs: every target joint with a source node of the same (standard) name.
  const pairs = [];
  const wholeLimb = to.skeleton.family === 'mini' && from.skeleton.family === 'humanoid';
  for (const rec of to.nodes) {
    if (!to.joints.has(rec.name) && to.skinned) continue;
    const src = from.byName.get(rec.name);
    if (!src) continue;
    // A limb in one piece (a chibi's arm) AIMS where the source's whole limb points (shoulder to hand), so a bent
    // elbow does not swing a stiff arm out sideways. Everything else turns by its own bone's world turn.
    const aim = wholeLimb && Boolean(LIMB_END[rec.name]) && Boolean(from.byName.get(LIMB_END[rec.name]));
    // Alignment of the two rest poses (world), bone by bone: the target's rest direction turned onto the source's.
    let align = new Quaternion();
    let rest = null;
    if (!same) {
      const ds = restDirection(from, rec.name, src, { wholeLimb: aim });
      const dt = restDirection(to, rec.name, rec, { mesh: aim });
      if (ds && dt && ds.dot(dt) < 0.9995) align = new Quaternion().setFromUnitVectors(dt, ds);
      if (aim) rest = ds;
    }
    pairs.push({ rec, src, align, aim: aim && rest ? { end: from.byName.get(LIMB_END[rec.name]), rest } : null });
  }
  const paired = new Map(pairs.map((p) => [p.rec, p]));
  const hipsName = to.byName.get('hips') ? 'hips' : to.byName.get('body') ? 'body' : null;
  const hs = hipsName && from.byName.get(hipsName) ? hipsHeight(to) / hipsHeight(from) : 1;
  const out = new Map(pairs.map((p) => [p.rec, { q: new Float32Array(frames * 4), t: p.rec.name === hipsName ? new Float32Array(frames * 3) : null }]));
  const srcHips = hipsName ? from.byName.get(hipsName) : null;
  const first = srcHips ? poseAt(from, ch, 0).get(srcHips).p.clone() : null;
  const last = srcHips ? poseAt(from, ch, duration).get(srcHips).p.clone() : null;
  for (let f = 0; f < frames; f++) {
    const t = times[f];
    const pose = poseAt(from, ch, t);
    const world = new Map(); // target rec -> world matrix this frame
    for (const rec of to.nodes) {
      const parentW = rec.parent ? world.get(rec.parent) : new Matrix4();
      const p = paired.get(rec);
      let local;
      if (!p) local = rec.local.clone();
      else if (same) {
        // Same skeleton: the source's own local rotation, exactly.
        const sp = pose.get(p.src);
        const sParent = p.src.parent ? pose.get(p.src.parent).m : new Matrix4();
        const l = sParent.clone().invert().multiply(sp.m);
        const lp = new Vector3(); const lq = new Quaternion(); l.decompose(lp, lq, new Vector3());
        local = new Matrix4().compose(rec.t, lq, rec.s);
      } else {
        // World delta from the source's rest, applied to the target's (aligned) rest. A whole limb: the turn that takes
        // the source limb's rest direction to where it points now.
        let delta;
        if (p.aim) {
          const now = pose.get(p.aim.end).p.clone().sub(pose.get(p.src).p);
          delta = now.lengthSq() > 1e-12 ? new Quaternion().setFromUnitVectors(p.aim.rest, now.normalize()) : new Quaternion();
        } else delta = pose.get(p.src).q.clone().multiply(p.src.worldQ.clone().invert());
        const wq = delta.multiply(p.align.clone()).multiply(rec.worldQ.clone());
        const pq = new Quaternion(); parentW.decompose(new Vector3(), pq, new Vector3());
        const lq = pq.invert().multiply(wq).normalize();
        local = new Matrix4().compose(rec.t, lq, rec.s);
      }
      if (p && rec.name === hipsName && srcHips) {
        // The hips: the source's motion from its rest, scaled to this rig, in place for a loop.
        const sp = pose.get(srcHips).p.clone().sub(srcHips.worldP);
        if (inPlace === true || (inPlace === 'loops' && loop)) {
          const u = duration > 0 ? t / duration : 0;
          const drift = last.clone().sub(first).multiplyScalar(u).add(first).sub(srcHips.worldP);
          sp.x -= drift.x; sp.z -= drift.z;
        }
        const want = rec.worldP.clone().add(sp.multiplyScalar(hs));
        const lp = want.applyMatrix4(parentW.clone().invert());
        const lq = new Quaternion(); const ls = new Vector3(); local.decompose(new Vector3(), lq, ls);
        local = new Matrix4().compose(lp, lq, ls);
      }
      world.set(rec, parentW.clone().multiply(local));
      if (p) {
        const lp = new Vector3(); const lq = new Quaternion(); local.decompose(lp, lq, new Vector3());
        const o = out.get(rec);
        // Keep quaternions on one side, so a blend between frames never turns the long way round.
        if (f > 0) { const pq = o.q.subarray((f - 1) * 4, f * 4); if (pq[0] * lq.x + pq[1] * lq.y + pq[2] * lq.z + pq[3] * lq.w < 0) { lq.x = -lq.x; lq.y = -lq.y; lq.z = -lq.z; lq.w = -lq.w; } }
        o.q.set([lq.x, lq.y, lq.z, lq.w], f * 4);
        if (o.t) o.t.set([lp.x, lp.y, lp.z], f * 3);
      }
    }
  }
  const tracks = [];
  for (const [rec, o] of out) {
    if (!constantAt(o.q, 4, [rec.r.x, rec.r.y, rec.r.z, rec.r.w], 1e-4, true)) tracks.push({ node: rec.name, path: 'rotation', times, values: o.q });
    if (o.t && !constantAt(o.t, 3, [rec.t.x, rec.t.y, rec.t.z], 1e-4 * Math.max(1, rec.t.length()))) tracks.push({ node: rec.name, path: 'translation', times, values: o.t });
  }
  return { name, duration, tracks, frames, scale: hs };
}

/** True when every sample equals `rest` (a quaternion: either sign). */
function constantAt(values, width, rest, tol, quat = false) {
  for (let i = 0; i < values.length; i += width) {
    let d = 0; let dn = 0;
    for (let k = 0; k < width; k++) { d = Math.max(d, Math.abs(values[i + k] - rest[k])); dn = Math.max(dn, Math.abs(values[i + k] + rest[k])); }
    if (Math.min(d, quat ? dn : d) > tol) return false;
  }
  return true;
}

/**
 * A skeleton's clip library: a Document with the target's node tree (names and rest pose, no mesh) and one clip per
 * verb. `sources`: [{ rig, anim, verb, from }] (from: a label of where the clip came from). Returns { doc, clips }.
 */
export async function bakeLibrary(target, sources, { fps = 30, inPlace = 'loops', core, logger = null }) {
  needThree();
  const doc = new core.Document();
  if (logger) doc.setLogger(logger);
  const buffer = doc.createBuffer();
  const made = new Map();
  const scene = doc.createScene('anims');
  const copy = (rec, parent) => {
    // Only the joints (and the nodes above them): what a clip can move.
    const n = doc.createNode(rec.name).setTranslation(rec.t.toArray()).setRotation(rec.r.toArray()).setScale(rec.s.toArray());
    made.set(rec.name, n);
    if (parent) parent.addChild(n); else scene.addChild(n);
    for (const c of rec.children) if (hasJoint(target, c)) copy(c, n);
  };
  for (const rec of target.nodes.filter((r) => !r.parent)) if (hasJoint(target, rec)) copy(rec, null);
  const clips = [];
  for (const s of sources) {
    const same = s.rig.skeleton.fingerprint && s.rig.skeleton.fingerprint === target.skeleton.fingerprint;
    const baked = retargetClip(s.rig, s.anim, target, { name: s.verb, fps, inPlace, loop: Boolean(VERBS[s.verb]?.loop), same });
    const a = doc.createAnimation(s.verb);
    for (const tr of baked.tracks) {
      const node = made.get(tr.node);
      if (!node) continue;
      const sampler = doc.createAnimationSampler()
        .setInput(doc.createAccessor().setType('SCALAR').setArray(tr.times).setBuffer(buffer))
        .setOutput(doc.createAccessor().setType(tr.path === 'rotation' ? 'VEC4' : 'VEC3').setArray(tr.values).setBuffer(buffer))
        .setInterpolation('LINEAR');
      a.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(tr.path).setSampler(sampler));
    }
    a.setExtras({ homie: { verb: s.verb, source: s.anim.getName(), from: s.from ?? null, retargeted: !same, loop: Boolean(VERBS[s.verb]?.loop), hold: Boolean(VERBS[s.verb]?.hold) } });
    clips.push({ verb: s.verb, source: s.anim.getName(), from: s.from ?? null, retargeted: !same, duration: +baked.duration.toFixed(3), tracks: baked.tracks.length });
  }
  doc.getRoot().setExtras({ homie: { kind: 'anims', skeleton: target.skeleton.id, family: target.skeleton.family, fingerprint: target.skeleton.fingerprint, fps, verbs: clips.map((c) => c.verb) } });
  return { doc, clips };
}

function hasJoint(rig, rec) {
  if (rig.joints.has(rec.name)) return true;
  return rec.children.some((c) => hasJoint(rig, c));
}

/** A clip library's bytes: resampled (keys that a straight line already gives are dropped), meshopt filters, measured. */
export async function writeLibrary(doc, { tools }) {
  const { fn, ext, io } = tools;
  await doc.transform(fn.resample({ tolerance: 1e-4 }), fn.prune(), fn.dedup());
  doc.createExtension(ext.EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: ext.EXTMeshoptCompression.EncoderMethod.FILTER });
  doc.createExtension(ext.KHRMeshQuantization).setRequired(true);
  const bytes = await io.writeBinary(doc);
  const anims = doc.getRoot().listAnimations();
  return { bytes, clips: anims.length, keys: anims.reduce((n, a) => n + a.listSamplers().reduce((m, s) => m + s.getInput().getCount(), 0), 0) };
}
