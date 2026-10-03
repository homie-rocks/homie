/*
 * @homie-rocks/studio/animate — CHARACTERS THAT MOVE WELL, FOR EVERY three.js GAME A STUDIO MAKES.
 *
 *   import { createModels } from '@homie-rocks/studio/assets';
 *   import { loadCharacter } from '@homie-rocks/studio/animate';
 *   import { lab } from '@homie-rocks/studio/lab';
 *   import tuning from '../tunables.json';
 *
 *   const T = lab.tunables(tuning);                       // the Motion group's numbers; sliders in the Game Lab
 *   const knight = await loadCharacter(models, './models/knight.glb', { tune: T });
 *   scene.add(knight.root);
 *   // every frame, after the game moved the body:
 *   knight.root.position.set(x, y, z); knight.face(yaw, dt);
 *   knight.move(groundSpeed);               // idle, walk, run: blended by speed, feet at the speed the body moves
 *   knight.air(onGround, verticalSpeed);    // jump, fall, land (call jump() on take-off)
 *   knight.update(dt);
 *   // events: knight.jump(), knight.act('attack', { at: 0.4, hit: () => ... }), knight.hit(dx, dz), knight.die(), knight.revive()
 *
 * A character's clips come from its skeleton's clip library (public/anims/<skeleton>.glb, made by `homie-studio assets
 * add` and `anim add`): the model names it, so loadCharacter finds it. Every character with that skeleton shares it.
 *
 * What it does on top of three.js's AnimationMixer, each number a Game Lab tunable (ANIM_TUNING, the "Motion" group):
 *   locomotion   idle, walk and run weighted by ground speed, each played at the rate the feet need (no skating)
 *   one-shots    an action while running plays on the upper body only (the legs keep running); standing, on all of it
 *   hits         an additive flinch over whatever is playing, a hit-stop that freezes the pose for a few frames
 *   air          jump, fall, land, with stretch on the way up and squash on the way down (springs, frame-rate free)
 *   lean         banks into turns and tips forward when speeding up
 *   look-at      the head (and neck) turn toward a point within limits
 *   springs      tails, ears, capes and hair lag and swing (bones whose names say so, or the ones you name)
 *   feet         two-bone IK plants humanoid feet on uneven ground (give it the ground's height)
 *   crowds       `lod` 0-3: far and off-screen characters update their pose less often and skip the layers
 *
 * Bodies are moved by the game (netplay: the host moves them); clips never move a body: they are baked in place.
 */
import {
  AdditiveAnimationBlendMode, AnimationClip, AnimationMixer, AnimationUtils, Group, LoopOnce, LoopRepeat, Quaternion, Vector3,
  type AnimationAction, type Bone, type Camera, type Object3D,
} from 'three';

/** What loadCharacter needs from @homie-rocks/studio/assets's createModels(). */
export interface ModelSource {
  load(url: string, opts?: { budget?: { triangles?: number; texturePx?: number; materials?: number; bytes?: number } }): Promise<{ scene: Object3D; animations: AnimationClip[] }>;
  instance(url: string, opts?: { budget?: { triangles?: number; texturePx?: number; materials?: number; bytes?: number } }): Promise<Object3D>;
}
/** A hero's phone budget (a prop's is the loader's default): what development warnings hold a character to. */
const HERO_BUDGET = { triangles: 8000, texturePx: 1024, materials: 2, bytes: 1536 * 1024 };

/** The Motion tunables (tunables.json shape): copy them into a game's tunables.json, then tune them in the Game Lab. */
export const ANIM_TUNING = Object.freeze({
  fade: { value: 0.14, min: 0, max: 0.6, step: 0.01, unit: 's', group: 'Motion', note: 'How long one clip takes to blend into the next' },
  walkSpeed: { value: 1.5, min: 0.3, max: 6, step: 0.05, unit: 'm/s', group: 'Motion', note: 'The ground speed the walk clip\'s feet move at (feet slide when this is wrong)' },
  runSpeed: { value: 4.2, min: 1, max: 12, step: 0.05, unit: 'm/s', group: 'Motion', note: 'The ground speed the run clip\'s feet move at' },
  runFrom: { value: 2.4, min: 0.5, max: 8, step: 0.05, unit: 'm/s', group: 'Motion', note: 'From this speed up, the walk becomes a run' },
  actSpeed: { value: 1.25, min: 0.5, max: 3, step: 0.05, group: 'Motion', note: 'How fast actions (attacks, casts) play: higher is snappier' },
  jumpStretch: { value: 0.16, min: 0, max: 0.5, step: 0.01, group: 'Motion', note: 'How tall and thin the body goes as it leaves the ground' },
  landSquash: { value: 0.22, min: 0, max: 0.6, step: 0.01, group: 'Motion', note: 'How flat it goes when it lands' },
  squashHz: { value: 5.5, min: 1, max: 14, step: 0.1, unit: 'Hz', group: 'Motion', note: 'How fast the squash springs back (lower wobbles longer)' },
  lean: { value: 0.22, min: 0, max: 0.8, step: 0.01, group: 'Motion', note: 'How far it banks into a turn and tips into a sprint' },
  hitStopMs: { value: 70, min: 0, max: 200, step: 5, unit: 'ms', group: 'Motion', note: 'How long a hit freezes the pose before it plays on' },
  flinch: { value: 0.6, min: 0, max: 1.5, step: 0.05, group: 'Motion', note: 'How strongly a hit jolts the upper body' },
  lookAt: { value: 0.7, min: 0, max: 1, step: 0.05, group: 'Motion', note: 'How much the head turns toward what it looks at' },
  spring: { value: 0.5, min: 0, max: 1, step: 0.05, group: 'Motion', note: 'How loose tails, ears and capes are (0 stiff, 1 floppy)' },
});
export type AnimTuning = { -readonly [K in keyof typeof ANIM_TUNING]?: number };

export interface CharacterOptions {
  /** The clip library's address (default: the one the model names, beside it in ./anims/). */
  anims?: string | null;
  /** Live numbers (lab.tunables(tuning)): any ANIM_TUNING key, read every frame. */
  tune?: AnimTuning;
  /** Bones that swing on springs (default: names with tail, ear, cape, hair, antenna). */
  springs?: string[];
  /** The ground's height at (x, z) in world metres, for foot planting on slopes and steps (humanoids). */
  ground?: ((x: number, z: number) => number) | null;
}

export interface ActOptions {
  /** A fraction of the clip (0-1) at which `hit` is called: the moment a swing lands. */
  at?: number;
  hit?: () => void;
  /** Called when the action has played (or was cut short by another). */
  then?: () => void;
  /** Whole body (default when standing) or upper body only (default when moving). */
  body?: 'whole' | 'upper';
  speed?: number;
  /** Start this far into the clip (0-1): skip a slow wind-up the game does not wait for. */
  from?: number;
}

export interface Character {
  /** Place this in the scene; the game sets its position (and face() its turn). */
  root: Group;
  /** The model inside (its bones are named by the skeleton standard: hips, spine, head, leftHand, ...). */
  model: Object3D;
  mixer: AnimationMixer;
  clips: AnimationClip[];
  /** The verbs this character can play. */
  verbs: string[];
  /** The skeleton family: humanoid, mini, quadruped or parts. */
  family: string;
  /** 0 every layer every frame; 1 no springs, feet or look-at; 2 pose every 2nd frame; 3 every 4th (far, off screen). */
  lod: number;
  has(verb: string): boolean;
  /** Ground speed in m/s (the body's own, after the game moved it). */
  move(speed: number): void;
  /** Turn to face a heading (radians about +Y, 0 facing +Z), smoothly; the turn rate feeds the lean. */
  face(yaw: number, dt?: number): void;
  air(onGround: boolean, verticalSpeed?: number): void;
  jump(): void;
  /** One action (attack, cast, emote, pickup, interact, ...). Returns its length in seconds, or 0 if it has none. */
  act(verb: string, opts?: ActOptions): number;
  /** Hit from a direction (world x, z): an additive flinch, a hit-stop, the hit clip on the upper body. */
  hit(dx?: number, dz?: number, strength?: number): void;
  die(): void;
  revive(): void;
  /** A loop until the next move (win, sit, block): the round's end, a pose. */
  hold(verb: string): void;
  lookAt(point: Vector3 | null): void;
  /** An attachment point: rightHand, leftHand, head, back (a bone to add things to), or null. */
  socket(name: string): Object3D | null;
  bone(name: string): Object3D | null;
  update(dt: number): void;
  /** What is playing (for the Game Lab's phase line): IDLE, WALK, RUN, JUMP, FALL, LAND, the action's verb, HIT, DOWN. */
  readonly state: string;
  dispose(): void;
}

const SPRING_NAMES = /tail|ear|cape|cloak|hair|antenna|ponytail|scarf|skirt/i;
const clampN = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const damp = (from: number, to: number, rate: number, dt: number): number => to + (from - to) * Math.exp(-rate * dt);
const sanitize = (s: string): string => s.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

/** The upper and lower body of a rig by bone name: the spine's subtree is the upper body. */
function bodyHalves(model: Object3D): { upper: Set<string>; lower: Set<string> } {
  const upper = new Set<string>(); const lower = new Set<string>();
  const spine = model.getObjectByName('spine') ?? model.getObjectByName('chest') ?? null;
  if (spine) spine.traverse((o) => upper.add(o.name));
  model.traverse((o) => { if (!upper.has(o.name)) lower.add(o.name); });
  return { upper, lower };
}

/** A clip with only the tracks of `keep` bones (track names are "<bone>.<property>"). */
function subclip(clip: AnimationClip, keep: Set<string>, suffix: string): AnimationClip {
  const tracks = clip.tracks.filter((t) => keep.has(t.name.slice(0, t.name.lastIndexOf('.'))));
  return new AnimationClip(`${clip.name}${suffix}`, clip.duration, tracks.map((t) => t.clone()));
}

// Clip variants are made once per clip library (keyed by its first clip: loadCharacter shares the loaded clips).
const variants = new WeakMap<AnimationClip, Map<string, AnimationClip>>();

/**
 * Load a character: the model (a copy, skeleton cloned properly) and its skeleton's clip library, through the game's
 * safe loader. A model with no clip library and no clips of its own still loads: it stands still (and says so in
 * development).
 */
export async function loadCharacter(models: ModelSource, url: string, opts: CharacterOptions = {}): Promise<Character> {
  const loaded = await models.load(url, { budget: HERO_BUDGET });
  const info = (loaded.scene.userData?.homie ?? {}) as { anims?: string; family?: string; sockets?: Record<string, string> };
  let clips = loaded.animations ?? [];
  const animsUrl = opts.anims === null ? null : (opts.anims ?? (info.anims ? new URL(info.anims, new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost/')).href : null));
  if (animsUrl) {
    try { clips = [...(await models.load(animsUrl, { budget: { triangles: 0, bytes: 3 * 1024 * 1024 } })).animations, ...clips]; } catch (error) { if (!clips.length) console.warn(`[animate] ${url}: its clips did not load (${(error as Error).message})`); }
  }
  const model = await models.instance(url, { budget: HERO_BUDGET });
  return createCharacter(model, clips, { ...opts, family: info.family ?? null, sockets: info.sockets ?? {} });
}

/** A character from a model already in hand and its clips (loadCharacter does this for you). */
export function createCharacter(model: Object3D, clips: AnimationClip[], opts: CharacterOptions & { family?: string | null; sockets?: Record<string, string> } = {}): Character {
  const tune = (k: keyof typeof ANIM_TUNING): number => { const v = opts.tune?.[k]; return Number.isFinite(v) ? (v as number) : ANIM_TUNING[k].value; };
  const root = new Group(); root.name = 'character';
  const pose = new Group(); pose.name = 'pose';
  root.add(pose); pose.add(model);
  const mixer = new AnimationMixer(model);
  const byName = new Map(clips.map((c) => [c.name, c]));
  const has = (v: string): boolean => byName.has(v);
  const family = opts.family ?? (model.getObjectByName('leftLowerLeg') ? 'humanoid' : model.getObjectByName('leftUpperLeg') ? 'mini' : model.getObjectByName('frontLeftLeg') ? 'quadruped' : 'parts');
  // Upper-body and lower-body versions of each clip, made once per clip set.
  const vkey = clips[0];
  let vmap = vkey ? variants.get(vkey) : undefined;
  if (!vmap) { vmap = new Map(); if (vkey) variants.set(vkey, vmap); }
  const halves = bodyHalves(model);
  const layered = halves.upper.size > 0 && halves.lower.size > 0;
  const variant = (verb: string, part: 'upper' | 'lower' | 'add'): AnimationClip | null => {
    const base = byName.get(verb); if (!base) return null;
    const key = `${verb}:${part}`;
    let c = vmap!.get(key);
    if (!c) {
      if (part === 'add') { c = AnimationUtils.makeClipAdditive(subclip(base, halves.upper, '.add'), 0); }
      else c = subclip(base, part === 'upper' ? halves.upper : halves.lower, `.${part}`);
      vmap!.set(key, c);
    }
    return c;
  };

  // Locomotion: idle, walk, run, each a whole-body and a lower-body action, weights set every frame.
  const LOCO = ['idle', 'walk', 'run'].filter(has);
  const loco = new Map<string, { whole: AnimationAction; lower: AnimationAction | null; w: number }>();
  for (const v of LOCO) {
    const whole = mixer.clipAction(byName.get(v) as AnimationClip); whole.setLoop(LoopRepeat, Infinity); whole.play(); whole.setEffectiveWeight(v === 'idle' ? 1 : 0);
    const low = layered ? variant(v, 'lower') : null;
    const lower = low ? mixer.clipAction(low) : null;
    if (lower) { lower.setLoop(LoopRepeat, Infinity); lower.play(); lower.setEffectiveWeight(0); }
    loco.set(v, { whole, lower, w: v === 'idle' ? 1 : 0 });
  }
  let speed = 0; let shownSpeed = 0;
  let upperMix = 0; // 0: loco on the whole body; 1: loco on the legs only (an upper-body action plays)
  let busy: { verb: string; action: AnimationAction; body: 'whole' | 'upper'; opts: ActOptions; fired: boolean; ends: number } | null = null;
  let locoWeight = 1; // how much locomotion shows at all (0 during a whole-body action, a jump, a death)
  let airState: 'ground' | 'jump' | 'fall' | 'land' = 'ground';
  let airAction: AnimationAction | null = null;
  let landUntil = 0;
  let dead = false; let held: AnimationAction | null = null;
  let squashV = 0; let squash = 0; // squash spring: + stretch, - squash
  let yaw = 0; let yawRate = 0; let bank = 0; let tip = 0; let lastSpeed = 0;
  let stopUntil = 0; let clock = 0;
  let flinch: AnimationAction | null = null;
  let look: Vector3 | null = null; let lookYaw = 0; let lookPitch = 0;
  let frame = 0; let pendingDt = 0;
  let stateName = 'IDLE';

  const fadeOut = (a: AnimationAction | null, t: number): void => { if (a) a.fadeOut(Math.max(0.001, t)); };
  const playOnce = (clip: AnimationClip, { fade, speed: sp = 1, clamp = false }: { fade: number; speed?: number; clamp?: boolean }): AnimationAction => {
    const a = mixer.clipAction(clip);
    a.reset(); a.setLoop(LoopOnce, 1); a.clampWhenFinished = clamp; a.timeScale = sp; a.setEffectiveWeight(1); a.fadeIn(Math.max(0.001, fade)); a.play();
    return a;
  };
  const endBusy = (): void => {
    if (!busy) return;
    const b = busy; busy = null;
    fadeOut(b.action, tune('fade'));
    if (!b.fired) { b.fired = true; b.opts.hit?.(); }
    b.opts.then?.();
  };
  mixer.addEventListener('finished', (e: { action: AnimationAction }) => {
    if (busy && e.action === busy.action) endBusy();
    if (airAction && e.action === airAction && airState === 'jump') { airState = 'fall'; startFall(); }
    if (flinch && e.action === flinch) { flinch.stop(); flinch = null; }
  });
  const startFall = (): void => {
    const f = byName.get('fall');
    fadeOut(airAction, tune('fade'));
    airAction = null;
    if (f) { airAction = mixer.clipAction(f); airAction.reset(); airAction.setLoop(LoopRepeat, Infinity); airAction.setEffectiveWeight(1); airAction.fadeIn(tune('fade')); airAction.play(); }
  };

  // Springs: bones that swing (each keeps a simulated tip).
  const springBones: { bone: Object3D; len: number; tip: Vector3; vel: Vector3; ready: boolean }[] = [];
  model.traverse((o) => {
    const named = opts.springs ? opts.springs.includes(o.name) : SPRING_NAMES.test(o.name);
    if (!named || !(o as Bone).isBone && !o.children.length && !(o as unknown as { isMesh?: boolean }).isMesh) return;
    springBones.push({ bone: o, len: 0, tip: new Vector3(), vel: new Vector3(), ready: false });
  });
  const sockets = new Map<string, Object3D>();
  for (const [s, b] of Object.entries(opts.sockets ?? {})) { const o = model.getObjectByName(sanitize(b)) ?? model.getObjectByName(b); if (o) sockets.set(s, o); }
  const SOCKET_FALLBACK: Record<string, string[]> = { rightHand: ['rightHandSlot', 'rightHand', 'rightUpperArm'], leftHand: ['leftHandSlot', 'leftHand', 'leftUpperArm'], head: ['head'], back: ['upperChest', 'chest', 'spine', 'body'] };

  const v1 = new Vector3(); const v2 = new Vector3(); const v3 = new Vector3(); const q1 = new Quaternion(); const q2 = new Quaternion(); const q3 = new Quaternion();
  const UP = new Vector3(0, 1, 0);
  // The bones the layers turn: their animated pose is kept after every mixer update and put back before the layers
  // run, so a bone no clip moves (a tail, a neck) never accumulates a turn, and a frame the mixer skips (crowds,
  // hit-stop) still starts from the clip's pose.
  const touched = new Set<Object3D>();
  for (const n of ['head', 'neck', 'hips', 'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg']) { const o = model.getObjectByName(n); if (o) touched.add(o); }
  for (const s of springBones) touched.add(s.bone);
  const animated = new Map<Object3D, { q: Quaternion; p: Vector3 }>();
  const keepPose = (): void => { for (const b of touched) { const a = animated.get(b); if (a) { a.q.copy(b.quaternion); a.p.copy(b.position); } else animated.set(b, { q: b.quaternion.clone(), p: b.position.clone() }); } };
  const putPose = (): void => { for (const [b, a] of animated) { b.quaternion.copy(a.q); b.position.copy(a.p); } };
  keepPose();

  /** Turn a bone so that its world direction `from` becomes `to` (both from its joint), keeping its twist. */
  function swing(bone: Object3D, from: Vector3, to: Vector3, weight = 1): void {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
    q1.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    if (weight < 1) q1.slerp(new Quaternion(), 1 - weight);
    bone.getWorldQuaternion(q2);
    const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
    bone.quaternion.copy(parentQ.invert().multiply(q1.multiply(q2)));
    bone.updateMatrixWorld(true);
  }

  function layers(dt: number): void {
    model.updateMatrixWorld(true);
    // Look-at: head (and neck) turn within limits, smoothed.
    const head = model.getObjectByName('head');
    if (head && tune('lookAt') > 0) {
      let wantYaw = 0; let wantPitch = 0;
      if (look && !dead) {
        head.getWorldPosition(v1);
        root.updateMatrixWorld();
        v2.copy(look).sub(v1).applyQuaternion(root.getWorldQuaternion(q2).invert());
        wantYaw = clampN(Math.atan2(v2.x, v2.z), -1.1, 1.1);
        wantPitch = clampN(-Math.atan2(v2.y, Math.hypot(v2.x, v2.z)), -0.5, 0.45);
      }
      lookYaw = damp(lookYaw, wantYaw, 8, dt); lookPitch = damp(lookPitch, wantPitch, 8, dt);
      const w = tune('lookAt');
      if (Math.abs(lookYaw) + Math.abs(lookPitch) > 1e-3 && w > 0) {
        const neck = model.getObjectByName('neck');
        const parts: [Object3D, number][] = neck ? [[neck, 0.4], [head, 0.6]] : [[head, 1]];
        root.getWorldQuaternion(q3);
        for (const [b, share] of parts) {
          const local = new Quaternion().setFromAxisAngle(UP, lookYaw * share * w).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), lookPitch * share * w));
          const worldTurn = q3.clone().multiply(local).multiply(q3.clone().invert());
          b.getWorldQuaternion(q2);
          const parentQ = b.parent ? b.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
          b.quaternion.copy(parentQ.invert().multiply(worldTurn.multiply(q2)));
          b.updateMatrixWorld(true);
        }
      }
    }
    // Springs: each tip trails its animated place.
    const loose = tune('spring');
    for (const s of springBones) {
      const child = s.bone.children.find((c) => (c as Bone).isBone) ?? null;
      s.bone.getWorldPosition(v1);
      if (child) child.getWorldPosition(v2); else v2.set(0, 0, -0.3).applyQuaternion(s.bone.getWorldQuaternion(q2)).add(v1);
      const len = v2.distanceTo(v1) || 0.2;
      if (!s.ready) { s.tip.copy(v2); s.vel.set(0, 0, 0); s.len = len; s.ready = true; }
      const k = 260 * (1 - loose * 0.92); const c = 2 * Math.sqrt(k) * (0.55 + 0.4 * (1 - loose));
      v3.copy(v2).sub(s.tip).multiplyScalar(k).addScaledVector(s.vel, -c);
      v3.y -= 2.5 * loose;
      s.vel.addScaledVector(v3, dt);
      s.tip.addScaledVector(s.vel, dt);
      // Keep the tip at the bone's length from its joint.
      v3.copy(s.tip).sub(v1).setLength(s.len); s.tip.copy(v1).add(v3);
      swing(s.bone, v2.clone().sub(v1), s.tip.clone().sub(v1));
    }
    // Feet: humanoid legs reach the ground's height (slopes, steps).
    if (opts.ground && family === 'humanoid' && !dead) plantFeet();
  }

  function plantFeet(): void {
    const ground = opts.ground as (x: number, z: number) => number;
    const legs = (['left', 'right'] as const).map((side) => ({ up: model.getObjectByName(`${side}UpperLeg`), low: model.getObjectByName(`${side}LowerLeg`), foot: model.getObjectByName(`${side}Foot`) })).filter((l) => l.up && l.low && l.foot) as { up: Object3D; low: Object3D; foot: Object3D }[];
    if (legs.length !== 2) return;
    root.getWorldPosition(v1);
    const base = v1.y;
    // How far each foot must move (only feet near the ground: a foot in the air keeps its swing).
    const reach = legs.map((l) => { const f = l.foot.getWorldPosition(new Vector3()); const above = f.y - base; const g = ground(f.x, f.z) - base; return { l, f, need: above < 0.25 ? g : 0 }; });
    const drop = Math.min(0, ...reach.map((r) => r.need));
    const hips = model.getObjectByName('hips');
    if (hips && drop < 0) { hips.getWorldPosition(v2); v2.y += drop; hips.parent?.worldToLocal(v2); hips.position.copy(v2); model.updateMatrixWorld(true); }
    for (const r of reach) {
      const hip = r.l.up.getWorldPosition(new Vector3()); const knee = r.l.low.getWorldPosition(new Vector3()); const foot = r.l.foot.getWorldPosition(new Vector3());
      const target = foot.clone(); target.y += r.need - drop;
      const a = hip.distanceTo(knee); const b = knee.distanceTo(foot);
      const want = clampN(hip.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4);
      // The knee bends in its own plane to make the leg `want` long, then the hip swings the foot onto the target.
      const now = hip.distanceTo(foot);
      if (Math.abs(now - want) > 1e-4) {
        const cosNow = clampN((a * a + b * b - now * now) / (2 * a * b), -1, 1);
        const cosWant = clampN((a * a + b * b - want * want) / (2 * a * b), -1, 1);
        const axis = v3.copy(knee).sub(hip).cross(foot.clone().sub(knee)).normalize();
        if (axis.lengthSq() > 0.5) {
          const turn = new Quaternion().setFromAxisAngle(axis, Math.acos(cosWant) - Math.acos(cosNow));
          r.l.low.getWorldQuaternion(q2);
          const parentQ = r.l.low.parent ? r.l.low.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
          r.l.low.quaternion.copy(parentQ.invert().multiply(turn.multiply(q2)));
          r.l.low.updateMatrixWorld(true);
        }
      }
      swing(r.l.up, r.l.foot.getWorldPosition(new Vector3()).sub(hip), target.clone().sub(hip));
    }
  }

  const ch: Character = {
    root, model, mixer, clips, family, lod: 0,
    verbs: [...byName.keys()],
    has,
    get state() { return stateName; },
    move(s: number): void { speed = Math.max(0, s || 0); },
    face(y: number, dt = 1 / 60): void {
      let d = y - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = d * (1 - Math.exp(-14 * Math.max(0, dt)));
      yawRate = dt > 0 ? step / dt : 0;
      yaw += step;
      root.rotation.y = yaw;
    },
    air(onGround: boolean, vy = 0): void {
      if (dead) return;
      if (!onGround && airState === 'ground') { airState = 'fall'; startFall(); }
      else if (!onGround && airState === 'jump' && vy < -0.5 && !has('jump')) { airState = 'fall'; startFall(); }
      else if (onGround && (airState === 'fall' || airState === 'jump')) {
        airState = 'land';
        fadeOut(airAction, 0.06); airAction = null;
        const l = byName.get('land');
        if (l) { airAction = playOnce(l, { fade: 0.05, speed: 1.4 }); landUntil = clock + l.duration / 1.4 * 0.7; } else landUntil = clock + 0.12;
        squash = -tune('landSquash'); squashV = 0;
      }
    },
    jump(): void {
      if (dead) return;
      airState = 'jump';
      squash = tune('jumpStretch'); squashV = 0;
      fadeOut(airAction, 0.05); airAction = null;
      const j = byName.get('jump');
      if (j) airAction = playOnce(j, { fade: 0.05, speed: 1.6, clamp: true }); else startFall();
    },
    act(verb: string, o: ActOptions = {}): number {
      if (dead) return 0;
      const base = byName.get(verb);
      if (!base) { o.hit?.(); o.then?.(); return 0; }
      endBusy();
      const moving = speed > 0.4 || airState !== 'ground';
      const body = o.body ?? (moving && layered ? 'upper' : 'whole');
      const clip = body === 'upper' ? (variant(verb, 'upper') as AnimationClip) : base;
      const sp = (o.speed ?? 1) * tune('actSpeed');
      const action = playOnce(clip, { fade: Math.min(0.08, tune('fade')), speed: sp });
      const skip = clampN(o.from ?? 0, 0, 0.9) * base.duration;
      if (skip > 0) action.time = skip;
      busy = { verb, action, body, opts: o, fired: false, ends: clock + (base.duration - skip) / sp };
      return (base.duration - skip) / sp;
    },
    hit(dx = 0, dz = 0, strength = 1): void {
      if (dead) return;
      stopUntil = clock + tune('hitStopMs') / 1000;
      // An additive jolt over whatever plays (the legs keep running), from the hit clip's upper body.
      const add = variant('hit', 'add');
      if (add) { if (flinch) flinch.stop(); flinch = mixer.clipAction(add); flinch.blendMode = AdditiveAnimationBlendMode; flinch.reset(); flinch.setLoop(LoopOnce, 1); flinch.setEffectiveWeight(clampN(tune('flinch') * strength, 0, 1.5)); flinch.timeScale = 1.3; flinch.play(); }
      // Tip away from the hit.
      if (dx || dz) { const local = new Vector3(dx, 0, dz).applyAxisAngle(UP, -yaw); bank += clampN(-local.x, -1, 1) * 0.25 * strength; tip += clampN(-local.z, -1, 1) * 0.25 * strength; }
      squash = -tune('landSquash') * 0.6 * strength; squashV = 0;
    },
    die(): void {
      if (dead) return;
      dead = true; endBusy();
      fadeOut(airAction, 0.05); airAction = null; airState = 'ground';
      const d = byName.get('die');
      if (d) { held = playOnce(d, { fade: 0.08, speed: 1, clamp: true }); }
    },
    revive(): void {
      dead = false;
      fadeOut(held, tune('fade')); held = null;
    },
    hold(verb: string): void {
      const c = byName.get(verb);
      fadeOut(held, tune('fade')); held = null;
      if (!c) return;
      endBusy();
      held = mixer.clipAction(c); held.reset(); held.setLoop(LoopRepeat, Infinity); held.setEffectiveWeight(1); held.fadeIn(tune('fade')); held.play();
    },
    lookAt(p: Vector3 | null): void { look = p ? (look ?? new Vector3()).copy(p) : null; },
    socket(name: string): Object3D | null {
      if (sockets.has(name)) return sockets.get(name) as Object3D;
      for (const b of SOCKET_FALLBACK[name] ?? [name]) { const o = model.getObjectByName(b); if (o) return o; }
      return null;
    },
    bone(name: string): Object3D | null { return model.getObjectByName(name) ?? model.getObjectByName(sanitize(name)) ?? null; },
    update(dt: number): void {
      clock += dt;
      const fade = Math.max(0.02, tune('fade'));
      const rate = 1 / fade;
      // A hold that is not a death ends when the character moves.
      if (held && !dead && speed > 0.3) { fadeOut(held, fade); held = null; }
      if (airState === 'land' && clock >= landUntil) { airState = 'ground'; fadeOut(airAction, fade); airAction = null; }
      // Locomotion weights from the shown speed.
      shownSpeed = damp(shownSpeed, speed, 10, dt);
      const s = shownSpeed;
      const walkS = tune('walkSpeed'); const runS = tune('runSpeed'); const runFrom = tune('runFrom');
      const target = { idle: 0, walk: 0, run: 0 } as Record<string, number>;
      const mover = has('walk') ? 'walk' : has('run') ? 'run' : null;
      if (!mover || s < 0.15) target.idle = 1;
      else if (mover === 'walk' && (!has('run') || s < runFrom)) { const u = clampN((s - 0.15) / 0.5, 0, 1); target.idle = 1 - u; target.walk = u; }
      else if (mover === 'run' && !has('walk')) { const u = clampN((s - 0.15) / 0.5, 0, 1); target.idle = 1 - u; target.run = u; }
      else { const u = clampN((s - runFrom) / Math.max(0.1, runFrom * 0.25), 0, 1); target.walk = 1 - u; target.run = u; }
      const wholeBusy = Boolean(busy && busy.body === 'whole') || airState === 'jump' || airState === 'fall' || dead || Boolean(held);
      locoWeight = damp(locoWeight, wholeBusy ? 0 : 1, rate * 2.2, dt);
      upperMix = damp(upperMix, busy && busy.body === 'upper' ? 1 : 0, rate * 2.2, dt);
      for (const [v, l] of loco) {
        l.w = damp(l.w, target[v] ?? 0, rate * 2.2, dt);
        const w = l.w * locoWeight;
        l.whole.setEffectiveWeight(w * (l.lower ? 1 - upperMix : 1));
        l.lower?.setEffectiveWeight(w * upperMix);
        const ts = v === 'walk' ? clampN(s / walkS, 0.55, 1.7) : v === 'run' ? clampN(s / runS, 0.6, 1.6) : 1;
        l.whole.timeScale = ts; if (l.lower) l.lower.timeScale = ts;
      }
      // An action's hit moment.
      if (busy && !busy.fired && busy.opts.at !== undefined) {
        const clip = busy.action.getClip();
        if (busy.action.time >= clampN(busy.opts.at, 0, 1) * clip.duration) { busy.fired = true; busy.opts.hit?.(); }
      }
      // Hit-stop: the pose holds; everything else (springs, squash) keeps living.
      const stopped = clock < stopUntil;
      // Crowds: far characters update their pose less often.
      frame += 1; pendingDt += dt;
      const every = ch.lod >= 3 ? 4 : ch.lod >= 2 ? 2 : 1;
      putPose();
      if (!stopped && frame % every === 0) { mixer.update(pendingDt); pendingDt = 0; keepPose(); } else if (stopped) pendingDt = 0;
      // Lean: bank into the turn, tip into a speed-up (springy).
      const accel = dt > 0 ? (s - lastSpeed) / dt : 0; lastSpeed = s;
      const L = tune('lean');
      bank = damp(bank, clampN(-yawRate * s * 0.05 * L * 4, -0.45, 0.45), 9, dt);
      tip = damp(tip, clampN(accel * 0.02 * L * 4, -0.2, 0.35), 7, dt);
      // Squash and stretch: a spring back to 1.
      const hz = tune('squashHz'); const k = (2 * Math.PI * hz) ** 2; const c = 2 * 0.45 * Math.sqrt(k);
      squashV += (-k * squash - c * squashV) * dt; squash += squashV * dt;
      const sy = 1 + squash; const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
      pose.scale.set(sxz, sy, sxz);
      pose.rotation.set(tip, 0, bank);
      if (ch.lod <= 0) layers(dt);
      stateName = dead ? 'DOWN' : flinch && stopped ? 'HIT' : busy ? busy.verb.toUpperCase() : airState === 'jump' ? 'JUMP' : airState === 'fall' ? 'FALL' : airState === 'land' ? 'LAND' : held ? 'HOLD' : s > runFrom ? 'RUN' : s > 0.15 ? 'WALK' : 'IDLE';
    },
    dispose(): void { mixer.stopAllAction(); mixer.uncacheRoot(model); root.removeFromParent(); },
  };
  return ch;
}

/**
 * Crowd mode for a room of many: each character's `lod` from its distance to the camera and whether it is on screen
 * (0 near, 1 middle, 2 far, 3 off screen). Call once a frame before update(). `near` and `far` in metres.
 */
export function crowd(characters: Character[], camera: Camera, { near = 14, far = 30 }: { near?: number; far?: number } = {}): void {
  const p = new Vector3(); const c = new Vector3(); camera.getWorldPosition(c);
  const view = new Vector3(); camera.getWorldDirection(view);
  for (const ch of characters) {
    ch.root.getWorldPosition(p);
    const d = p.distanceTo(c);
    const ahead = p.clone().sub(c).normalize().dot(view) > 0.2;
    ch.lod = !ahead ? 3 : d > far ? 2 : d > near ? 1 : 0;
  }
}
