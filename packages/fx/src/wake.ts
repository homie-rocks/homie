import * as THREE from 'three';
import type { DragParticles } from './DragParticles.ts';
import {
  C_CHANNEL, C_DEBRIS, C_SMOKE, C_SMOKE_DARK, C_SMOKE_TARMAC,
  C_SPARK_WHITE,
  MODE_BILLBOARD, MODE_GROUND, MODE_STRETCH,
  TILE_CORE, TILE_GLOW, TILE_SMOKE, TILE_SPLASH, TILE_STREAK,
  trailLife,
  type Medium, type TierFx,
} from './racer.ts';

/**
 * ============================================================================
 *  THE WAKE — what a racing machine leaves on the surface under it.
 * ============================================================================
 *  The contact-patch geometry (where the rear wheels touch, and the marks they
 *  lay), the chassis squash spring, and the six emitters that put dust, smoke,
 *  grit and a pool of light on the ground.
 *
 *  Lifted out of the effects systems of two racing games, where these methods
 *  were BYTE-IDENTICAL in four cases and differed in one to four numbers in the
 *  rest — and every one of those numbers was a gravity or a drag, i.e. the
 *  medium. See `racer.ts`.
 *
 *  WHY THIS CAN BE SHARED WHEN IT READS A GAME'S MACHINE.
 *
 *  Every method here took the game's own machine and effect-state types, and
 *  both games' copies of those types carry race, track, item, combat and
 *  thermal state that has no business in a shared package. But none of this
 *  code reads any of it. The interfaces below are exactly the fields these
 *  functions touch — eight on the machine, thirteen on its effect state — and
 *  each game's own types satisfy them structurally. No game changed a type, no
 *  call site took a cast, and the shims that replaced the bodies still
 *  type-check against the games' own types.
 *
 *  SCRATCH. The module vectors below are THIS module's, not the games'. That
 *  matters and it was checked in code rather than assumed: a function moved
 *  across a package seam stops clobbering the caller's scratch, so a value the
 *  caller was holding now survives where it used to be destroyed. Every one of
 *  these functions writes each scratch it uses before it reads it, and every
 *  live range of `_col`, `_col2`, `_fwd`, `_side` and `_r` in both games'
 *  per-machine update was read to confirm none spans a call to anything moved here.
 * ============================================================================
 */

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _col = new THREE.Color();
const _col2 = new THREE.Color();

// ---------------------------------------------------------------------------
//  The seams. Exactly what is read, and nothing else.
// ---------------------------------------------------------------------------

/** The machine: the part of each game's own machine type this reads, about a fifth of it. */
export interface WakeMachine {
  readonly id: number;
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly velocity: THREE.Vector3;
  /** metres per second along the machine's own forward axis */
  readonly forwardSpeed: number;
  /** unit forward in world space */
  readonly forward: THREE.Vector3;
  /** 0 = not sliding, otherwise -1 (left) or 1 (right) */
  readonly driftDir: number;
  /** the four corner anchors — wheels in one game, mag emitters in the other */
  readonly wheels: readonly THREE.Object3D[];
}

/** Per-machine effect state, as both games already kept it. */
export interface WakeState {
  /** have the rear anchors been resolved off the model yet */
  resolved: boolean;
  /** rear-anchor offsets in the machine's own frame */
  readonly offL: THREE.Vector3;
  readonly offR: THREE.Vector3;
  /** where the last skid segment ended, per side */
  readonly skidL: THREE.Vector3;
  readonly skidR: THREE.Vector3;
  skidding: boolean;
  skidStrength: number;
  /** the surface plane under the machine */
  groundY: number;
  readonly groundN: THREE.Vector3;
  /** the game's own `Surface` numbering — see `WakeHost.onRoad` */
  surface: number;
  squash: number;
  squashV: number;
  squashOwned: boolean;
}

/** The half of each game's `Decals` that the wake writes to. */
export interface WakeDecals {
  skid(a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, width: number,
       sa: number, sb: number, now: number, life: number,
       tr?: number, tg?: number, tb?: number): void;
}

/**
 * What the wake emits into and draws with. Built once, in `Effects.init`, and
 * held — every field is a reference to something the class already owns, so
 * nothing here is a second copy of any state.
 */
export interface WakeHost {
  readonly particles: DragParticles;
  readonly decals: WakeDecals;
  /**
   * The key light's colour this frame. Emitters warm their albedo a little way
   * toward it; the games rewrite it every frame from `ctx.sun`.
   */
  readonly sun: THREE.Color;
  /**
   * World-space rear contact patches, refreshed by `rearPoints` and read by
   * every emitter that puts something under a wheel. Two vectors the host owns
   * and this module writes through — the same arrangement the class had, and
   * the reason a host wired to a COPY of them would put the entire wake at the
   * world origin. A test checks exactly that.
   */
  readonly skidL: THREE.Vector3;
  readonly skidR: THREE.Vector3;
  readonly medium: Medium;
  /**
   * True for the track proper — the road and the boost strip.
   *
   * The predicate rather than the numbers, because `Surface` is each game's own
   * enum and grows on its own schedule: the space racer has nine entries and
   * the kart racer seven. Both games answer this question the same way, which
   * is why it is a lookup and not a difference.
   */
  onRoad(surface: number): boolean;
  /**
   * What a landing on this surface throws up. The track proper gives up smoke;
   * everything else gives up its own `SURFACE_PROPS.dustColor`.
   *
   * Resolved by the game for the same reason as `onRoad`, and for one more: the
   * two games disagree about how many surfaces exist but not about this rule,
   * so the rule lives once and the table stays where the table is.
   */
  puffColour(surface: number): THREE.Color;
  /**
   * Fraction of the machine's velocity the steady spark shower inherits, given
   * the machine's speed. A curve, supplied per game — see `emitSparks`, where
   * the three tuning steps that produced the kart racer's flat 0.68 are
   * written out, along with what that same 0.68 does at 142 m/s.
   */
  showerKeep(speed: number): number;
  /**
   * What is streaking past the lens, and how far the rush line is tinted toward
   * it. See `slipstream`: one game's answer is air and the other's is ionised
   * wash off a mag skirt, and both desaturate hard toward white.
   */
  readonly streak: {
    readonly tint: THREE.Color;
    /** tint fraction under boost — less, because it is hotter there */
    readonly boostMix: number;
    /** tint fraction at cruise */
    readonly cruiseMix: number;
  };
}

// ---------------------------------------------------------------------------
//  Contact-patch geometry
// ---------------------------------------------------------------------------

/** Resolve rear-wheel offsets once, from whatever model the machine shipped. */
export function resolveOffsets(k: WakeMachine, fx: WakeState) {
  if (fx.resolved) return;
  fx.resolved = true;
  const w = k.wheels;
  if (!w || w.length < 4) return;
  let i0 = -1, i1 = -1, z0 = Infinity, z1 = Infinity;
  for (let i = 0; i < w.length; i++) {
    const z = w[i]!.position.z;
    if (z < z0) { z1 = z0; i1 = i0; z0 = z; i0 = i; }
    else if (z < z1) { z1 = z; i1 = i; }
  }
  if (i0 < 0 || i1 < 0) return;
  // Guard the pair actually straddles the centreline. A model that lists its
  // wheels in an unexpected order, or with a rear axle at the same z, can
  // otherwise hand back two wheels on the SAME side — both spark streams then
  // land on top of each other and the drift looks one-sided. Defaults are
  // already a sane rear axle, so falling back to them is safe.
  const xa = w[i0]!.position.x, xb = w[i1]!.position.x;
  if (xa * xb >= 0 || Math.abs(xa - xb) < 0.2) return;
  const l = xa < xb ? i0 : i1;
  const r = xa < xb ? i1 : i0;
  fx.offL.set(w[l]!.position.x, 0, w[l]!.position.z);
  fx.offR.set(w[r]!.position.x, 0, w[r]!.position.z);
}

/** World-space rear contact patches, projected onto the local ground plane. */
export function rearPoints(h: WakeHost, k: WakeMachine, fx: WakeState) {
  resolveOffsets(k, fx);
  for (let s = 0; s < 2; s++) {
    const off = s === 0 ? fx.offL : fx.offR;
    const out = s === 0 ? h.skidL : h.skidR;
    out.copy(off).applyQuaternion(k.quaternion).add(k.position);
    const n = fx.groundN;
    // plane through (machine.xz, groundY) with normal n
    out.y = fx.groundY - (n.x * (out.x - k.position.x) + n.z * (out.z - k.position.z)) / (n.y || 1);
    out.y += 0.04;
  }
}

/** Lay one skid segment per rear wheel, with run-in/run-out fading. */
export function layStrip(h: WakeHost, fx: WakeState, now: number, strength: number, widthMul = 1) {
  if (!fx.skidding) {
    fx.skidding = true;
    fx.skidStrength = 0;
    fx.skidL.copy(h.skidL);
    fx.skidR.copy(h.skidR);
    return;
  }
  const prevS = fx.skidStrength;
  fx.skidStrength = Math.min(1, fx.skidStrength + 0.34);
  // 0.55 m segments. The chord error against a drift radius of 15 m is under
  // 3 mm, and it halves how fast a pack fight can churn through the ring.
  if (fx.skidL.distanceToSquared(h.skidL) < 0.3) return;
  const life = 13;
  // Wider and considerably darker than they were. At 0.30 m and a 0.30 grey
  // multiplier the mark was a faint smudge that vanished into a tarmac
  // already at #4a4a52 — reviewers looking at a mid-drift hero frame read the
  // road as perfectly clean. Hot rubber on tarmac is nearly black.
  const w = 0.36 * widthMul;
  const a0 = prevS * strength, a1 = fx.skidStrength * strength;
  h.decals.skid(fx.skidL, h.skidL, fx.groundN, w, a0, a1, now, life,
    0.17, 0.16, 0.19);
  h.decals.skid(fx.skidR, h.skidR, fx.groundN, w, a0, a1, now, life,
    0.17, 0.16, 0.19);
  fx.skidL.copy(h.skidL);
  fx.skidR.copy(h.skidR);
}

/**
 * Damped spring on a single scalar: negative squashes (flat and wide),
 * positive stretches. We only ever touch `object.scale`, we restore it to
 * exactly identity when the pulse dies, and we never take it over unless we
 * put it there — so a chassis-model animator writing scale wins by default.
 */
export function applySquash(k: WakeMachine, fx: WakeState, dt: number) {
  if (Math.abs(fx.squash) < 1e-4 && Math.abs(fx.squashV) < 1e-3) {
    if (fx.squashOwned) {
      k.object.scale.set(1, 1, 1);
      fx.squashOwned = false;
      fx.squash = 0; fx.squashV = 0;
    }
    return;
  }
  const s = k.object.scale;
  if (!fx.squashOwned) {
    if (Math.abs(s.x - 1) > 0.02 || Math.abs(s.y - 1) > 0.02) { fx.squashV = 0; return; }
    fx.squashOwned = true;
  }
  // stiffness/damping tuned for ~3 visible bounces over ~0.45 s
  fx.squashV += (-fx.squash * 420 - fx.squashV * 17) * dt;
  fx.squash += fx.squashV * dt;
  fx.squash = THREE.MathUtils.clamp(fx.squash, -0.45, 0.45);
  const q = fx.squash;
  s.set(1 - q * 0.55, 1 + q, 1 - q * 0.55);
}

// ---------------------------------------------------------------------------
//  Surface emitters
// ---------------------------------------------------------------------------

/**
 * The veil a rolling wheel tears off the surface, plus the grit that comes with
 * it on a loaded wheel.
 *
 * IT EXISTS FOR THE CLEAN LAP. Every other emitter here needs the machine to be
 * drifting, boosting, stunned or off the racing surface, so a fast, tidy lap
 * emitted nothing at all and the frame had no sense of speed outside the HUD
 * number. This is the one that runs when nothing is going wrong.
 */
export function rollDust(h: WakeHost, k: WakeMachine, fx: WakeState,
                         n: number, dust: THREE.Color, sr: number) {
  const m = h.medium;
  const road = h.onRoad(fx.surface);
  // Cool on tarmac, the surface's own colour off it, and only lightly warmed
  // in albedo — the key light does the warming now (see tyreSmoke).
  _col.copy(road ? C_SMOKE_TARMAC : dust).lerp(h.sun, 0.16);
  _fwd.copy(k.forward);
  const p = h.particles.reset();
  p.tile = TILE_SMOKE; p.mode = MODE_BILLBOARD;
  // 8 m of veil, not 0.55 s of it. This emitter runs on every machine on every
  // clean lap, so it is the single biggest producer of stranded puffs: at
  // 25 m/s a 0.55 s world-frame puff ends eleven metres back, which is the
  // chain of detached blobs strung out behind the pack in the pack frame.
  p.life = trailLife(Math.abs(k.forwardSpeed), 7, 0.22, 0.5); p.lifeJitter = 0.35;
  p.size0 = 0.14; p.size1 = 0.62 + 0.42 * sr; p.sizeJitter = 0.45;
  p.gravity = 0.7 * m.buoyancy; p.drag = 2.6; p.spin = 1.3;
  p.posJitter = 0.16; p.velJitter = 0.9; p.fadeIn = 0.14;
  p.count = n;
  h.particles.ground(fx.groundY, fx.groundN, 0.9, 0.30);
  // Still a veil that says "moving" rather than a smoke screen — but a
  // legible one. The pack shot came back with eight machines running over
  // perfectly clean air; at 0.11 base alpha through the grade this layer was
  // below the dither floor. The art direction asks for dust and grit kicked up
  // by the pack and this emitter is the whole of it on tarmac.
  //
  // 0.17/0.21 overshot the other way: on the hero and pack frames it printed
  // as detached grey smudges lying on the tarmac behind the field rather than
  // as air being disturbed. Split the difference — still comfortably above
  // the 0.11 that was invisible.
  // 0.08 + 0.10, down from 0.13 + 0.17. This runs on every machine on every
  // clean lap; the alpha that makes one puff legible makes twenty of them a wall.
  h.particles.colorA(_col, 1.0, 0.08 + 0.10 * sr);
  h.particles.colorB(_col, 0.8, 0);
  for (let s = 0; s < 2; s++) {
    const at = s === 0 ? h.skidL : h.skidR;
    h.particles.at(at.x, at.y + 0.10, at.z);
    h.particles.vel(
      k.velocity.x * 0.62 - _fwd.x * 1.6, 0.7, k.velocity.z * 0.62 - _fwd.z * 1.6);
    h.particles.emit(false);
  }

  // GRIT. The veil above is low-frequency and reads as air; a road also
  // throws hard little pieces of itself, and they are what give the wake
  // texture at the resolution the camera actually sees. Ballistic, short,
  // opaque, sun-lit, and few — a couple per emission on the loaded wheel
  // only. The art direction names dust *and* grit; only the dust existed.
  if (sr > 0.35) {
    p.tile = TILE_SPLASH; p.mode = MODE_BILLBOARD;
    p.life = 0.34; p.lifeJitter = 0.4;
    p.size0 = 0.05; p.size1 = 0.10; p.sizeJitter = 0.6;
    p.gravity = m.rollGrit.gravity; p.drag = m.rollGrit.drag; p.spin = 4;
    p.posJitter = 0.16; p.velJitter = 2.4; p.fadeIn = 0.02;
    p.count = Math.max(1, n >> 1);
    h.particles.ground(fx.groundY, fx.groundN, 0.18, 0.10);
    _col2.copy(road ? C_DEBRIS : dust).lerp(h.sun, 0.30);
    h.particles.colorA(_col2, 1.0, 0.85 * sr);
    h.particles.colorB(_col2, 0.85, 0);
    const at = Math.random() < 0.5 ? h.skidL : h.skidR;
    h.particles.at(at.x, at.y + 0.06, at.z);
    h.particles.vel(
      k.velocity.x * 0.55 - _fwd.x * 2.2, 2.6, k.velocity.z * 0.55 - _fwd.z * 2.2);
    h.particles.emit(false);
  }
}

/**
 * The ground glow under a slide. One quad per contact patch, on the tier
 * channel.
 *
 * A PARTICLE AND NOT A LIGHT, ON PURPOSE. Ground-aligned additive quads have no
 * silhouette and cannot intersect the machine they sit under, and they work
 * identically whether or not the light budget could have taken a real
 * PointLight. Both art bibles ask for a ground-scorch decal under drift sparks;
 * the decal layer is MULTIPLICATIVE, so it can only darken — which is why the
 * bright half of that note has to be this.
 */
export function groundPool(h: WakeHost, k: WakeMachine, fx: WakeState, prof: TierFx) {
  const col = C_CHANNEL;
  const p = h.particles.reset();
  p.channel = k.id + 1;
  p.tile = TILE_GLOW; p.mode = MODE_GROUND;
  p.life = 0.30; p.lifeJitter = 0.25;
  // 1.0 / 1.45 / 2.0 on the size and 0.88 / 1.34 / 1.92 on the radiance. A
  // tier-3 pool covers four times the tarmac of a tier-1 one at twice the
  // brightness, which is the "ground glow under the sparks at higher tiers"
  // the art direction asks for and what the escalation reads as at thumbnail
  // size — it is the only part of the drift that is a large low-frequency
  // shape, so it is the part that survives minification, bloom and motion
  // blur intact.
  p.size0 = 0.80 * prof.poolS; p.size1 = 1.65 * prof.poolS; p.sizeJitter = 0.25;
  // Gravity 0 in both games, and identically so rather than by coincidence: a
  // quad lying in the ground plane does not fall, in air or out of it.
  p.drag = 1.4; p.gravity = 0; p.spin = 0.9;
  p.posJitter = 0.12; p.count = 1; p.camBias = 0.07; p.fadeIn = 0.12;
  // Inherits the machine's velocity so the pool tracks the car instead of being
  // left behind as a stationary blob of light on empty tarmac.
  h.particles.vel(k.velocity.x * 0.75, 0, k.velocity.z * 0.75);
  // Roughly 1.6x the earlier values. This is the part of the drift that lands
  // ON the road rather than in the air, so it is what puts tier colour into
  // the tarmac's own specular and what survives at thumbnail size, as the art
  // direction asks. It is a ground-aligned quad with no edge, so it cannot
  // intersect anything and cannot acquire a silhouette however bright it gets.
  h.particles.colorA(col, 0.62 * prof.poolI, 0.52);
  h.particles.colorB(col, 0.16, 0);
  for (let s = 0; s < 2; s++) {
    const at = s === 0 ? h.skidL : h.skidR;
    h.particles.at(at.x, fx.groundY + 0.04, at.z);
    h.particles.emitExact(true);
  }
}

/**
 * Hard little pieces of the surface, torn off by a sliding wheel.
 *
 * Alpha-blended and lit — so it takes the key like everything else made of
 * matter — ballistic, short, and thrown forward-of-sideways along the slip
 * vector rather than straight back: a sliding tyre flings the surface out of
 * the corner, not down the road behind it.
 */
export function driftGrit(h: WakeHost, k: WakeMachine, fx: WakeState,
                          n: number, dust: THREE.Color, slip: number) {
  const m = h.medium;
  const road = h.onRoad(fx.surface);
  _fwd.copy(k.forward);
  _side.crossVectors(UP, _fwd).normalize();
  const lat = k.velocity.x * _side.x + k.velocity.z * _side.z;
  _col.copy(road ? C_DEBRIS : dust).lerp(h.sun, 0.28);
  const p = h.particles.reset();
  p.tile = m.slideGritTile; p.mode = m.slideGritMode;
  p.life = 0.40; p.lifeJitter = 0.4;
  p.size0 = 0.055; p.size1 = 0.11; p.sizeJitter = 0.6;
  p.gravity = m.slideGrit.gravity; p.drag = m.slideGrit.drag; p.spin = 5;
  p.posJitter = 0.14; p.velJitter = 2.8; p.fadeIn = 0.02;
  p.count = Math.max(1, n);
  h.particles.ground(fx.groundY, fx.groundN, 0.18, 0.10);
  h.particles.colorA(_col, 1.0, 0.55 + 0.35 * slip);
  h.particles.colorB(_col, 0.85, 0);
  for (let s = 0; s < 2; s++) {
    const at = s === 0 ? h.skidL : h.skidR;
    h.particles.at(at.x, at.y + 0.05, at.z);
    h.particles.vel(
      k.velocity.x * 0.5 - _side.x * lat * 0.8 - _fwd.x * 1.4,
      3.0,
      k.velocity.z * 0.5 - _side.z * lat * 0.8 - _fwd.z * 1.4);
    h.particles.emitExact(false);
  }
}

/** The bloom of smoke a boost ignition puts under the rear axle. */
export function tyreSmokePuff(h: WakeHost, k: WakeMachine, fx: WakeState,
                              n: number, size: number) {
  const m = h.medium;
  rearPoints(h, k, fx);
  h.particles.reset();
  const speed = Math.abs(k.forwardSpeed);
  for (let s = 0; s < 2; s++) {
    const at = s === 0 ? h.skidL : h.skidR;
    const p = h.particles.p;
    // Fired on boost ignition, i.e. at the highest speed the machine ever sees.
    // A 0.95 s world-static puff at 33 m/s is thirty metres of orphan.
    p.tile = TILE_SMOKE; p.life = trailLife(speed, 14, 0.34, 0.95); p.lifeJitter = 0.3;
    // TERMINAL SIZE IS CAPPED BY WHAT THE CHASE CAMERA CAN TAKE, not by how
    // much smoke a boost "should" make.
    //
    // This fires on mini-turbo ignition — corner exit, which is precisely
    // where the chase camera is closest to the rear axle and pointing along
    // it. At 2.2 * 1.4 with a 0.5 jitter a single puff reached 4.6 m across,
    // and sixteen of them arrived at once, two metres from the lens. The
    // tunnel corner came back with the exit arch, both rivals and half the
    // frame behind a wall of cotton wool; it is the same puff that was
    // washing the machine out on boost.
    //
    // 1.5 with a 0.4 jitter tops out at ~2.9 m — still wider than the machine
    // is long, so the ignition still reads as a bloom of smoke — and the alpha
    // comes down to the 0.55 the drift smoke already uses for the reason
    // documented there: the two-lobe lighting in Particles only exists in the
    // overlap of translucent layers, so opaque puffs both hide the frame and
    // defeat their own shading.
    p.size0 = 0.5 * size; p.size1 = 1.5 * size; p.sizeJitter = 0.4;
    p.gravity = 0.8 * m.buoyancy; p.drag = 2.2; p.spin = 1.6;
    p.posJitter = 0.24; p.velJitter = 1.8; p.fadeIn = 0.1;
    p.count = n;
    h.particles.ground(fx.groundY, fx.groundN, 1.1, 0.38);
    _col.copy(C_SMOKE).lerp(h.sun, 0.30);
    h.particles.at(at.x, at.y + 0.28, at.z);
    h.particles.vel(k.velocity.x * 0.55, 1.7, k.velocity.z * 0.55);
    h.particles.colorA(_col, 1.0, 0.55);
    h.particles.colorB(C_SMOKE_DARK, 0.9, 0);
    h.particles.emit(false);
  }
}

/** The dust a landing throws forward, plus the disc it spreads flat. */
export function groundPuff(h: WakeHost, k: WakeMachine, fx: WakeState,
                           n: number, size: number) {
  const m = h.medium;
  _col.copy(h.puffColour(fx.surface));
  const speed = Math.abs(k.forwardSpeed);
  const p = h.particles.reset();
  p.tile = TILE_SMOKE; p.mode = MODE_BILLBOARD;
  p.life = trailLife(speed, 13, 0.34, 0.9); p.lifeJitter = 0.32;
  p.size0 = 0.4 * size; p.size1 = 2.0 * size; p.sizeJitter = 0.35;
  p.gravity = 0.4 * m.buoyancy; p.drag = 2.6; p.spin = 1.1;
  p.posJitter = 0.5; p.velJitter = 2.2; p.velScatter = 0.5; p.fadeIn = 0.08;
  p.count = n;
  h.particles.ground(fx.groundY, fx.groundN, 1.10, 0.30);
  h.particles.at(k.position.x, fx.groundY + 0.12, k.position.z);
  // A landing throws its dust forward with the machine. Emitted world-static, a
  // hop puff is dropped on the road behind and reads as belonging to nothing.
  h.particles.vel(k.velocity.x * 0.5, 1.0, k.velocity.z * 0.5);
  h.particles.colorA(_col, 0.95, 0.45);
  h.particles.colorB(_col, 0.7, 0);
  h.particles.emit(false);

  // A pair of discs pinned flat to the ground: they read as dust spreading
  // out along the tarmac rather than a ball of it hanging in the air.
  p.mode = MODE_GROUND;
  p.life = 0.7; p.size0 = 0.9 * size; p.size1 = 3.4 * size;
  p.gravity = 0; p.drag = 3.4; p.velJitter = 0; p.spin = 0.6;
  p.posJitter = 0.25; p.softness = 0; p.camBias = 0.07;
  p.count = Math.max(1, n >> 2);
  h.particles.at(k.position.x, fx.groundY + 0.05, k.position.z);
  h.particles.vel(0, 0, 0);
  h.particles.colorA(_col, 0.95, 0.32);
  h.particles.colorB(_col, 0.7, 0);
  h.particles.emit(false);
}

/** The cloud, or the grains, that the surface itself gives up under a wheel. */
export function surfaceDust(h: WakeHost, k: WakeMachine, fx: WakeState,
                            n: number, dust: THREE.Color, heavy: boolean) {
  const m = h.medium;
  _fwd.copy(k.forward);
  const speed = Math.abs(k.forwardSpeed);
  const p = h.particles.reset();
  p.tile = heavy ? TILE_SPLASH : TILE_SMOKE;
  // Off-track dust legitimately hangs — but only within sight of whatever
  // kicked it up. 20 m for the light cloud, 11 m for the heavy grains.
  p.life = heavy ? trailLife(speed, 11, 0.30, 0.75) : trailLife(speed, 20, 0.45, 1.3);
  p.lifeJitter = 0.3;
  p.size0 = heavy ? 0.22 : 0.4; p.size1 = heavy ? 0.5 : 2.6; p.sizeJitter = 0.4;
  p.gravity = heavy ? m.heavyDust.gravity : 0.5 * m.buoyancy;
  p.drag = heavy ? m.heavyDust.drag : 1.7; p.spin = 1.0;
  p.posJitter = 0.22; p.velJitter = heavy ? 2.6 : 1.2; p.fadeIn = 0.1;
  p.count = n;
  h.particles.ground(fx.groundY, fx.groundN, heavy ? 0.35 : 1.10, heavy ? 0.14 : 0.34);
  h.particles.colorA(dust, heavy ? 1.0 : 0.95, heavy ? 0.85 : 0.5);
  h.particles.colorB(dust, 0.75, 0);
  for (let s = 0; s < 2; s++) {
    const at = s === 0 ? h.skidL : h.skidR;
    h.particles.at(at.x, at.y + 0.06, at.z);
    // Grains are thrown by the tyre and keep most of its speed; the light
    // cloud is torn off the surface and keeps rather less.
    const keep = heavy ? 0.72 : 0.45;
    h.particles.vel(
      k.velocity.x * keep - _fwd.x * 2.6, heavy ? 3.2 : 1.1, k.velocity.z * keep - _fwd.z * 2.6);
    h.particles.emit(false);
  }
}

/**
 * THE STEADY SHOWER a sliding contact patch throws, in four layers: the streaked
 * cores, the soft halo that carries the silhouette, a steady lamp at the patch
 * itself, and a scatter of longer-lived stragglers.
 *
 * Everything here is on the machine's live tier CHANNEL, so a promotion
 * recolours the shower already in the air rather than only the next one.
 *
 * `side` is -1 for the left contact patch and +1 for the right, and the two
 * streams must NOT be identical: one shared velocity makes both wheels throw
 * the same cone and the pair collapses into a single clump under the middle of
 * the machine, which is exactly what the tier-2 shot showed.
 */
export function emitSparks(h: WakeHost, at: THREE.Vector3, k: WakeMachine, fx: WakeState,
                           n: number, tier: number, prof: TierFx, side: number) {
  const m = h.medium;
  // Colour comes from the kart's live tier channel, not from a value captured
  // at spawn — see EmitParams.channel and the drift-spark event.
  const col = C_CHANNEL;
  const channel = k.id + 1;
  // sparks fly backwards and away from the direction of the turn
  _fwd.copy(k.forward);
  _side.crossVectors(UP, _fwd).multiplyScalar(-k.driftDir);
  const sp = 3.4 + tier * 1.1;
  // The outside wheel is the one loaded up, so it throws harder and wider.
  const outside = side === -k.driftDir ? 1.25 : 0.75;
  const splay = side * 1.6;

  // Sparks are struck off the road by the contact patch, so they belong to
  // the ROAD frame, not the kart's — but only mostly. A spark with zero
  // velocity inheritance is instantly stranded (a kart at 18 m/s outruns its
  // own sparks by five metres inside one 0.28 s life, which is why the tier-2
  // frame showed a lump of purple sitting on empty kerb with nothing near
  // it). A third of the kart's velocity, bled off by drag, puts the shower
  // where the eye expects it: streaming a metre or two off the tyre.
  //
  // 0.48, up from 0.34. At 0.34 a 0.30 s spark ends five and a half metres
  // behind the wheel that struck it, which is why the drift frame shows two
  // detached clusters sitting on bare kerb rather than a shower coming off
  // the car. Half the kart's velocity keeps the whole shower inside two
  // metres of the contact patch without making it look welded on.
  // 0.68, up from 0.48. The review is precise about the failure: "the sparks
  // are not attached to anything — they emit from a diffuse pool spread over
  // ~4 m of tarmac behind the kart". At 0.48 a spark keeps barely half the
  // car's speed, so it falls back 8 m/s relative to the wheel that struck it
  // and, over a 0.62 s tail, ends up four metres adrift. Two thirds keeps the
  // shower inside a metre and a half of the contact patch — close enough that
  // the eye reads a jet coming off a tyre rather than a stain on the road —
  // while still leaving a visible slip between the shower and the car.
  //
  // …AND THAT 0.68 IS A FRACTION FITTED AT 25 m/s, WHICH IS WHY IT IS NOW A
  // CURVE. Every sentence above is about a SLIP — "falls back 8 m/s", "inside a
  // metre and a half" — and a fraction only delivers a slip at the one speed it
  // was fitted at. The space racer tops out at 142 m/s, where 0.68 means a slip
  // of 45 m/s and the "shower" is strung eighteen metres down the deck along
  // the machine's own path: a long beaded curve hanging in the frame. So the
  // game supplies the curve. The kart racer answers with the flat 0.68 it
  // measured; the space racer answers with a slip bounded at 9 m/s, which
  // reproduces 0.68 exactly at the speed it was authored at (1 - 9/28 = 0.68).
  const keep = h.showerKeep(Math.abs(k.forwardSpeed));

  // The tangential component: real sparks leave along the SLIP vector, not
  // along a fixed body axis. `slipx/slipz` is the part of the kart's velocity
  // that is sideways, which is the direction the rubber is actually being
  // dragged, so the cone off each tyre swings with the angle of the drift
  // instead of staying welded to the chassis.
  _r.crossVectors(UP, _fwd).normalize();
  const lat = k.velocity.x * _r.x + k.velocity.z * _r.z;
  const slipx = _r.x * lat * 0.32, slipz = _r.z * lat * 0.32;

  const p = h.particles.reset();
  p.channel = channel;
  p.tile = TILE_CORE;
  p.mode = MODE_STRETCH;
  // Sparks must streak along their own velocity or they read as evenly
  // scattered decorative confetti composited over the scene.
  p.stretch = 5.2;
  // 0.40 s, and WHAT IT BUYS DEPENDS ON THE MEDIUM — both readings are true of
  // this line and both were written down by the game that holds them.
  //
  // In air it buys the ARC: at 0.30 s under -14 m/s² a spark falls 63 cm, which
  // from a chase camera is barely a bend; at 0.40 s it falls 1.1 m and the
  // shower is visibly ballistic — thrown up and out of the contact patch and
  // curving back down into the road, which is the shape the eye recognises as a
  // spark and not as a floating mote.
  //
  // In vacuum there is no arc and there must not be one: gravity is 0.31 m/s²,
  // which over the whole life is two and a half centimetres. What the life buys
  // there is DWELL — long enough that the shower is a continuous jet off the
  // corner rather than a stroboscope, short enough that a grain does not
  // outlive the slide that threw it — and the spark shape comes from the
  // ejection cone and the streak instead of from a fall.
  p.life = 0.40; p.lifeJitter = 0.55;
  // 0.055 m was grit — physically right and completely illegible. At the
  // chase rig's ~7 m a 0.055 m sprite is four pixels, so the review read the
  // whole tier-2 shower as "two dozen dust motes" and could not name the
  // tier. 0.16 + 0.05/tier puts a tier-2 core at ~0.26 m, which is ~35 px
  // wide before the 5.2x velocity stretch — a grain you can see across a
  // room, which is the bar it was set to.
  // TIER_FX.core: 0.20 / 0.28 / 0.36 m, a 1.8x span rather than the 1.5x the
  // old `0.16 + 0.05 * tier` gave. A grain that is nearly twice the area is
  // the cheapest legible difference between two showers that are otherwise
  // the same object, and it costs nothing — the sprite is already drawn.
  p.size0 = prof.core; p.size1 = 0.018;
  // 0.4..1.6x. Uniformly-sized sparks are the other half of the confetti
  // read; real ones come off a tyre in a wide spread of masses.
  p.sizeJitter = 0.6;
  p.gravity = m.driftSparks.gravity; p.drag = m.driftSparks.drag;
  // Tightened from 3.2 / 0.55. A 3.2 m/s isotropic jitter on a 4.5 m/s cone
  // is most of what turned two jets into one diffuse pool: the scatter was
  // comparable to the signal, so the shower had no direction left in it.
  p.posJitter = 0.08; p.velJitter = 1.9; p.velScatter = 0.38;
  p.fadeIn = 0.02;
  // Bias the count to the loaded outside wheel, not just its speed.
  p.count = Math.max(1, Math.round(n * 3 * (outside > 1 ? 1.35 : 0.7)));
  // SOFTNESS ZERO, and this is most of why the tier-2 shower was invisible.
  //
  // Every other emitter here wants the ground-plane fade — a smoke puff that
  // terminates on the intersection line with the tarmac is the loudest
  // amateur tell there is. A spark is not a volume. It is a point of light,
  // it has no silhouette to reveal, and it is BORN 4 cm off the road, which
  // with the old 0.28 m fade depth put it at smoothstep(-0.084, 0.238, 0.04)
  // = 0.28 of its authored alpha at birth. Sparks spent the first third of
  // their life at under a third strength, at exactly the moment they are
  // closest to the wheel and brightest — so the shower faded IN as it left
  // the car instead of being hottest at the contact patch. Zero disables both
  // soft tests; the camera-facing bias is kept, and raised, because that is
  // what stops a core being depth-rejected by the tyre it came off.
  h.particles.ground(fx.groundY, fx.groundN, 0, 0.16);
  h.particles.at(at.x, at.y, at.z);
  // A real 3D cone: backwards, outwards along the wheel's own side, and up.
  _r.crossVectors(UP, _fwd);
  h.particles.vel(
    k.velocity.x * keep - _fwd.x * sp * 0.75 + (_side.x * sp + _r.x * splay) * outside - slipx,
    k.velocity.y * keep + 2.5 + tier * 0.5,
    k.velocity.z * keep - _fwd.z * sp * 0.75 + (_side.z * sp + _r.z * splay) * outside - slipz);
  // 2.35, up from 1.30 — and the reasoning that produced 1.30 was half
  // right, so it is worth writing down which half.
  //
  // It is true that 2.2x a saturated primary tone maps toward white; that is
  // exactly what an incandescent particle should do at its CORE, and the
  // fragment shader already confines the whitening to a cubed sprite mask so
  // only the genuine pinpoint bleaches while the streak body keeps #ff9d2e.
  // What 1.30 actually bought was a spark that never reached the bloom gate.
  // Worked through for #ff9d2e at 1.30, through the additive shoulder in
  // Particles (rgb / (1 + rgb * uClip)) and onto a shadowed tarmac at ~0.3
  // scene-linear, the composited pixel has a luminance of 0.92 — and
  // PostFX's bloom threshold is 1.55. So NOTHING in a drift ever bloomed.
  // A spark that does not bloom is a coloured dot; the glow around it is the
  // entire difference between a spark and a dust mote, and the review used
  // that exact word.
  //
  // At 2.35 the same spark composites to ~1.6 luminance and clears the gate
  // by a nose, so the bloom is a halo on the hot cores only rather than a
  // wash over the whole shower. uClip in Particles came down from 0.19 to
  // 0.13 to give it the headroom (see the note there).
  // TIER_FX.spark: 2.25 / 2.55 / 2.85. A purple spark is a HOTTER spark, not
  // just a differently-coloured one — the ramp is what makes a tier-3 shower
  // bloom harder than a tier-1 one through PostFX's 1.55 gate, and bloom is
  // the difference between a coloured dot and a light.
  h.particles.colorA(col, prof.spark, 1);
  h.particles.colorB(col, 0.70, 0);
  h.particles.emit(true);

  // Soft halo behind the cores — the "soft glow" half of the art direction, and
  // the layer that carries the silhouette. A halo is a low-frequency wash of
  // pure tier colour, so it survives bloom, minification and motion blur
  // intact where a pinpoint core does not, and it is what makes the drift
  // read at a glance from the chase camera rather than only in a still at
  // 200%. Three per emission unit now, half again as large, and it keeps its
  // colour: the halo is deliberately held under the whitening point so the
  // shower is a coloured cloud with white sparks inside it.
  p.tile = TILE_GLOW;
  p.mode = MODE_BILLBOARD;
  p.stretch = 0;
  p.life = 0.30;
  p.size0 = prof.halo; p.size1 = 0.10;
  p.count = n * 3;
  p.velJitter = 1.5; p.drag = 2.4;
  // The halo IS a volume — a metre-wide camera-facing disc born a few
  // centimetres off the tarmac — so unlike the cores it keeps a soft fade and
  // takes a generous camera bias, or the depth test slices its lower half off
  // against the road and leaves a hard horizontal cut. Spawned 12 cm higher
  // than the cores for the same reason.
  //
  // 0.55 m of fade depth, not 0.16. At 0.16 the fade window is 18 cm wide on a
  // disc that is a metre across, which is not a soft particle, it is a hard
  // edge with a bevel: the review reads exactly that as "the blue spark cloud
  // terminates in a hard straight cut line where the billboard quad intersects
  // the road plane". The fade has to be comparable to the sprite, not to the
  // spawn height.
  h.particles.ground(fx.groundY, fx.groundN, 0.55, 0.34);
  h.particles.at(at.x, at.y + 0.12, at.z);
  h.particles.colorA(col, 1.80, 0.62);
  h.particles.colorB(col, 0.38, 0);
  h.particles.emit(true);

  // A steady lamp at the contact patch itself: the tier colour has to be
  // legible even in the frames between spark spawns. This is the one part of
  // the drift that is guaranteed present in EVERY frame of a slide, so it is
  // what a still capture is most likely to catch, and it was the dimmest
  // thing here.
  p.tile = TILE_GLOW;
  p.life = 0.12; p.lifeJitter = 0.1;
  p.size0 = 0.78 + 0.28 * tier; p.size1 = 0.52;
  p.gravity = 0; p.drag = 6; p.velJitter = 0; p.posJitter = 0.04;
  p.count = 1; p.fadeIn = 0.2;
  // Same reasoning as the halo above: a 1.2 m disc needs a fade of the same
  // order as its own size or it terminates on the road in a straight line.
  h.particles.ground(fx.groundY, fx.groundN, 0.70, 0.38);
  h.particles.at(at.x, at.y + 0.14, at.z);
  h.particles.vel(k.velocity.x * 0.9, 0.4, k.velocity.z * 0.9);
  h.particles.colorA(col, 1.45, 0.70);
  h.particles.colorB(col, 0.42, 0);
  // DENSITY, SPENT EXACTLY ONCE — and this lamp was the one emitter in the
  // file spending it zero times.
  //
  // Every other layer here hands `emit` a count above one, so the density
  // multiplier lands on the count. This one is deliberately a single sprite,
  // and `emit` floors a single-particle spawn back up to one so a low setting
  // still gets the readability cue. Correct for a one-shot; wrong for
  // something emitted once per wheel per frame for the whole of every drift.
  // The result was two additive particles per drifting kart per frame at ANY
  // quality — sixteen a frame across the field, a fifth of the Low tier's
  // entire 75-spawn ceiling, held at full rate while the shower they sit
  // inside was thinned to 21%.
  //
  // A stochastic gate spends the density on the RATE instead, which is the
  // rule Particles states. It keeps the cue: at Low the lamp lands on about a
  // fifth of frames and lives 0.12 s, so there is still one on the road
  // essentially all the time — it is simply no longer the most expensive
  // thing in a tier-3 drift.
  if (Math.random() < h.particles.density) h.particles.emitExact(true);

  // Ricochets: a handful of grains per emission that survive longer, drag
  // almost nothing and arc out clear of the kart. Real sparks are not a
  // uniform population — the shower has a bright dense root and a scatter of
  // stragglers arcing away from it.
  //
  // 0.44 s and drag 0.9, down from 0.95 s (up to 1.43 with jitter) and drag
  // 0.45. THIS emitter was the diffuse four-metre pool in the review frame,
  // not the shower: a near-dragless grain living a second and a half at
  // 10 m/s relative to a car that is also moving ends up wherever it likes,
  // and there were enough of them to read as the main event. They still reach
  // furthest from the car; they just no longer outlive the drift itself.
  p.tile = TILE_CORE; p.mode = MODE_STRETCH; p.stretch = 4.0;
  p.life = 0.44; p.lifeJitter = 0.45;
  p.size0 = 0.075 + 0.02 * tier; p.size1 = 0.012; p.sizeJitter = 0.5;
  p.gravity = m.driftStragglers.gravity; p.drag = m.driftStragglers.drag;
  p.velJitter = 3.0; p.velScatter = 0.55; p.posJitter = 0.10;
  p.count = Math.max(1, n >> 1);
  // Pinpoints again: back to no soft fade, small bias.
  h.particles.ground(fx.groundY, fx.groundN, 0, 0.14);
  h.particles.at(at.x, at.y, at.z);
  h.particles.vel(
    k.velocity.x * keep - _fwd.x * sp * 0.6 + (_side.x * sp * 1.5 + _r.x * splay) * outside - slipx,
    k.velocity.y * keep + 4.4 + tier * 0.7,
    k.velocity.z * keep - _fwd.z * sp * 0.6 + (_side.z * sp * 1.5 + _r.z * splay) * outside - slipz);
  h.particles.colorA(col, 2.10, 1);
  h.particles.colorB(col, 0.45, 0);
  h.particles.emit(true);
}

/**
 * WORLD-SPACE RUSH LINES. Thin additive streaks seeded in an annulus around the
 * machine's own axis, well ahead of it, travelling backwards past the lens.
 *
 * This is the half of "speed lines" that has real perspective and real
 * occlusion behind the machine, which is what stops PostFX's screen-space comb
 * reading as a filter laid over the picture.
 *
 * THEY ARE DELIBERATELY NOT GIVEN THE MACHINE'S VELOCITY. The length of a
 * stretched sprite is a function of its own WORLD speed, so a streak that
 * inherited the machine's forward velocity and then subtracted it would be
 * nearly stationary in world terms and would not stretch at all. Travelling
 * backwards under its own steam is what buys both the elongation and the pass.
 *
 * Player only, off entirely below ~70% of top speed, and nothing here
 * allocates.
 */
export function slipstream(h: WakeHost, k: WakeMachine, fx: WakeState,
                           n: number, ramp: number, boosting: boolean) {
  const m = h.medium;
  _fwd.copy(k.forward);
  _side.crossVectors(UP, _fwd).normalize();
  _r.crossVectors(_fwd, _side).normalize();
  // A SPEED STREAK IS A VALUE CUE, NOT AN OBJECT.
  //
  // This used to be C_TIER[1] under boost — #4fc3ff, a fully saturated cyan,
  // and on golden-hour tarmac the single hue in the palette that cannot be
  // mistaken for anything atmospheric. Sitting at road height it read as
  // paint. The *speed* has to come from length and motion, not from colour.
  // The art direction: "they frame, they don't obscure."
  //
  // WHAT IS STREAKING PAST IS THE GAME'S OWN ANSWER, hence `h.streak`. In air
  // it is air: near-white with the faintest warm cast from the key. In vacuum
  // there is no air at all, and what goes past a ship at 165 m/s is ionised
  // wash off its own mag skirt — which puts it in the cyan reservation, where
  // cyan means track, racing line and MAG and never anything else. The half
  // of the reasoning that survives both is the important half, and it is why
  // both games desaturate hard toward white and only TINT: the streak is
  // tinted less under boost, where whatever it is is hotter.
  _col.copy(C_SPARK_WHITE).lerp(h.streak.tint, boosting ? h.streak.boostMix : h.streak.cruiseMix);

  const p = h.particles.reset();
  p.tile = TILE_STREAK; p.mode = MODE_STRETCH;
  // Under boost the streak is both longer per unit of speed and physically
  // bigger. This is the world-space half of "radial speed lines" and it is
  // the half that has real perspective and real occlusion behind the kart,
  // so it is what makes the screen-space comb in PostFX read as air moving
  // rather than as a filter laid over the picture.
  p.stretch = boosting ? 5.6 : 4.2;
  // Shorter, and seeded further out (see `ahead` below), so a streak dies of
  // old age at roughly the distance the chase camera sits rather than sailing
  // through the lens as a frame-wide bar.
  p.life = 0.30; p.lifeJitter = 0.28;
  // SCALES HARD WITH THE RAMP, and almost nothing sits under it. The old
  // 0.062 + 0.024 * ramp was a 40% span: at three-quarter pace a streak was
  // 0.07 m across, which at the 12-27 m it is seeded at is four pixels before
  // the stretch and vanishes into the tarmac's own aliasing. The span is 0.055
  // to 0.130 now, so the difference between "fast" and "flat out" is a factor
  // of two and a bit in every dimension of the cue at once — length, width,
  // count and opacity — which is what makes it read as the world moving
  // rather than as a particle setting.
  p.size0 = (0.055 + 0.075 * ramp) * (boosting ? 1.7 : 1); p.size1 = 0.02; p.sizeJitter = 0.5;
  p.gravity = m.streak.gravity; p.drag = m.streak.drag; p.spin = 0;
  p.fadeIn = 0.16; p.count = 1;
  // Still low in absolute terms and still scaled by the shared additive gain:
  // three of these overlapping must not add up to a wipe across the road. What
  // changed is the SPAN — at ramp 0 they are fainter than before, at ramp 1
  // they are about 1.6x, so the cue has a bottom as well as a top.
  const rushI = (0.75 + 0.85 * ramp) * (boosting ? 1.65 : 1);
  h.particles.colorA(_col, rushI, (0.06 + 0.42 * ramp) * (boosting ? 1.55 : 1));
  h.particles.colorB(_col, 0.20, 0);
  // A generous camera-ward bias and a real soft fade against the road plane.
  // Without them a streak that grazes the tarmac is depth-tested against it
  // and terminates on the intersection line, which is most of why these read
  // as track markings rather than as air.
  h.particles.ground(fx.groundY, fx.groundN, 0.9, 0.30);

  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    // Annulus, not a disc: nothing spawns on the axis, so the middle of the
    // frame — where the kart and the racing line are — stays clear. Boost
    // tightens the annulus toward the axis: converging lines read as speed,
    // a wide ring reads as weather.
    const rad = (boosting ? 1.7 : 2.3) + Math.random() * 3.0;
    const ahead = 12 + Math.random() * 15;
    _p.copy(k.position)
      .addScaledVector(_fwd, ahead)
      .addScaledVector(_side, Math.cos(a) * rad)
      // Vertical component biased ENTIRELY POSITIVE. The annulus used to be
      // centred on the kart's own axis, so half of every ring was spawned
      // below it — which on a kart sitting 40 cm off the deck means half the
      // streaks were born at or under road height. Depth-tested against the
      // tarmac and lying in its plane, those are the two flat cyan stripes
      // painted across the road in the boost frame. Speed lines belong in the
      // air between 0.5 m and 3 m above the surface and nowhere else.
      .addScaledVector(_r, 0.55 + (0.5 + 0.5 * Math.sin(a)) * rad * 0.62);
    // Belt and braces: whatever the track is doing underneath, never below
    // half a metre off it.
    _p.y = Math.max(_p.y, fx.groundY + 0.55);
    h.particles.at(_p.x, _p.y, _p.z);
    const rv = boosting ? 36 : 26;
    h.particles.vel(-_fwd.x * rv, -_fwd.y * rv, -_fwd.z * rv);
    // The rate above already spent the density; `emit` would spend it twice
    // and Medium would get 0.13 of the authored streaks instead of 0.36.
    h.particles.emitExact(true);
  }
}
