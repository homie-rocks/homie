import * as THREE from 'three';
import type { DragParticles } from './DragParticles.ts';
import type { Rings } from './Rings.ts';
import {
  C_CHANNEL, C_DEBRIS, C_FLAME_COOL, C_FLAME_MID, C_HOT, C_SMOKE, C_SMOKE_DARK, C_SPARK_WHITE,
  MODE_BILLBOARD, MODE_STRETCH,
  TILE_CORE, TILE_FLAME, TILE_GLOW, TILE_SMOKE, TILE_STAR, TILE_STREAK,
  type Medium,
} from './racer.ts';
import type { WakeState } from './wake.ts';

/**
 * ============================================================================
 *  BLASTS — the four one-shot showers both racers fire.
 * ============================================================================
 *  A full detonation, a wall impact, a drift-promotion burst and a pickup
 *  sparkle. Lifted out of the effects system of the two racing games, where
 *  all four differed only in the gravity and drag of the solid matter they
 *  throw — and in one CURVE, `burstKeep`, which is a value the game supplies
 *  rather than a branch taken inside a shared function. See the note at the
 *  top of `racer.ts` on why the medium is a value.
 *
 *  WHAT `burstKeep` IS. How much of the emitting machine's velocity a promotion
 *  burst inherits. The kart game answers 0.34 flat; the ship game runs top
 *  speeds of 142 m/s, where a flat 0.34 leaves the burst 94 m/s adrift of the
 *  machine that earned it — fifty metres of beaded curve hanging in the frame —
 *  and answers with a slip bounded in metres per second instead. Two numbers
 *  for the same quantity, at two speeds, which is a curve and not a behaviour.
 * ============================================================================
 */

const _r = new THREE.Vector3();

/** The half of each game's `Decals` a blast writes to. */
export interface BlastDecals {
  blot(p: THREE.Vector3, n: THREE.Vector3, radius: number, tile: number,
       now: number, life: number, strength: number,
       tr?: number, tg?: number, tb?: number): void;
}

/** The machine, when there is one — a burst can also be fired at a bare point. */
export interface BlastMachine {
  readonly velocity: THREE.Vector3;
  readonly forwardSpeed: number;
}

/**
 * What a blast draws with. Built once, in `Effects.init`, and held — every
 * field references something the class already owns.
 */
export interface BlastHost {
  readonly particles: DragParticles;
  readonly decals: BlastDecals;
  readonly rings: Rings;
  readonly medium: Medium;
  /** the game's own scorch tile index, from its `DecalTile` */
  readonly scorchTile: number;
  /**
   * Tell the energy governor a blast just landed, so the additive gain ducks
   * before the frame it has to survive rather than after it. `blastLoad` on the
   * class; see `energy.ts`.
   */
  load(amount: number): void;
  /** Shake the camera. `ctx.shake` in both games. */
  shake(amount: number, seconds: number): void;
  /**
   * Fraction of the machine's velocity a promotion burst inherits, given the
   * machine's speed. A curve, supplied per game — see the note above.
   */
  burstKeep(speed: number): number;
}

/**
 * The drift-promotion burst: a shower of tier-coloured sparks and the coloured
 * shell that makes the promotion read as a colour rather than as grit.
 *
 * `fx` and `k` are both optional because this also fires at bare world points —
 * a pickup, an item box — where there is no machine and no ground plane.
 */
export function burstSparks(h: BlastHost, at: THREE.Vector3, n: number, intensity: number,
                            channel: number, fx?: WakeState, k?: BlastMachine) {
  const m = h.medium;
  const col = C_CHANNEL;
  const p = h.particles.reset();
  p.channel = channel;
  p.tile = TILE_CORE; p.mode = MODE_STRETCH; p.stretch = 4.0;
  p.life = 0.62; p.lifeJitter = 0.45;
  p.size0 = 0.17; p.size1 = 0.018; p.sizeJitter = 0.55;
  p.gravity = m.promoSparks.gravity; p.drag = m.promoSparks.drag;
  p.posJitter = 0.12; p.velJitter = 9.0; p.fadeIn = 0.02; p.count = n;
  // Softness 0 for the same reason as the steady shower: a spark is a point
  // of light with no volume to fade, and the ground plane was eating three
  // quarters of the burst's alpha in the frames right after the promotion.
  if (fx) h.particles.ground(fx.groundY, fx.groundN, 0, 0.16);
  h.particles.at(at.x, at.y, at.z);
  const keep = k ? h.burstKeep(Math.abs(k.forwardSpeed)) : 0;
  h.particles.vel(
    k ? k.velocity.x * keep : 0, (k ? k.velocity.y * keep : 0) + 3.4, k ? k.velocity.z * keep : 0);
  // Same ceiling as the steady shower — see emitSparks for the arithmetic on
  // why the previous 1.45 left the burst below PostFX's bloom gate.
  h.particles.colorA(col, 1.95 * intensity, 1);
  h.particles.colorB(col, 0.70, 0);
  h.particles.emit(true);

  // Coloured shell around the burst. Without it a promotion is a puff of
  // white grit; with it the flash itself is blue / orange / purple, which is
  // the read the art direction asks a tier change to deliver.
  p.tile = TILE_GLOW; p.mode = MODE_BILLBOARD; p.stretch = 0;
  p.life = 0.34; p.lifeJitter = 0.4;
  p.size0 = 0.52; p.size1 = 0.12; p.sizeJitter = 0.5;
  p.gravity = -3 * m.buoyancy; p.drag = 2.6; p.velJitter = 4.6;
  p.count = Math.max(2, n >> 1);
  h.particles.colorA(col, 1.75 * intensity, 0.66);
  h.particles.colorB(col, 0.38, 0);
  h.particles.emit(true);
}

/** A pickup's sparkle: a handful of stars thrown off a point. */
export function sparkleBurst(h: BlastHost, at: THREE.Vector3, col: THREE.Color, n: number) {
  const m = h.medium;
  const p = h.particles.reset();
  p.tile = TILE_STAR; p.mode = MODE_BILLBOARD;
  p.life = 0.7; p.lifeJitter = 0.3;
  p.size0 = 0.34; p.size1 = 0.04; p.sizeJitter = 0.4;
  p.gravity = m.sparkle.gravity; p.drag = m.sparkle.drag; p.spin = 3.5;
  p.posJitter = 0.3; p.velJitter = 3.4; p.fadeIn = 0.04; p.count = n;
  p.camBias = 0.16;
  h.particles.at(at.x, at.y + 0.6, at.z);
  h.particles.vel(0, 2.2, 0);
  h.particles.colorA(col, 2.0, 1);
  h.particles.colorB(C_HOT, 0.8, 0);
  h.particles.emit(true);
}

/** Hitting something solid: sparks off the contact, a puff of smoke, a front. */
export function impactBurst(h: BlastHost, at: THREE.Vector3, n: THREE.Vector3,
                            now: number, scale: number) {
  const m = h.medium;
  const p = h.particles.reset();
  p.tile = TILE_CORE; p.mode = MODE_STRETCH; p.stretch = 3.0;
  p.life = 0.4; p.lifeJitter = 0.4;
  p.size0 = 0.08 * scale; p.size1 = 0.012;
  p.gravity = m.impactSparks.gravity; p.drag = m.impactSparks.drag; p.velJitter = 8 * scale;
  p.posJitter = 0.2; p.fadeIn = 0.02; p.count = Math.round(52 * scale);
  h.particles.ground(at.y - 1.2, n, 0.3, 0.10);
  h.particles.at(at.x, at.y, at.z);
  h.particles.vel(0, 3, 0);
  h.particles.colorA(C_SPARK_WHITE, 2.6, 1);
  h.particles.colorB(C_FLAME_MID, 0.8, 0);
  h.particles.emit(true);

  p.tile = TILE_SMOKE; p.mode = MODE_BILLBOARD; p.stretch = 0;
  p.life = 0.8; p.size0 = 0.4 * scale; p.size1 = 1.8 * scale;
  p.gravity = 1.2 * m.buoyancy; p.drag = 3.2; p.spin = 1.4; p.velJitter = 2.2;
  p.count = Math.round(10 * scale);
  h.particles.ground(at.y - 1.2, n, 0.6, 0.32);
  h.particles.colorA(C_SMOKE, 0.9, 0.5);
  h.particles.colorB(C_SMOKE_DARK, 0.8, 0);
  h.particles.emit(false);

  // Thin and fast. A 30%-thick annulus at 1.8x white is a plate; this is a
  // wave front that has come and gone before the eye can resolve its shape.
  h.rings.spawn(at, n, 0.25, 3.0 * scale, 0.26, 0.07, C_HOT, 1.2 * scale, now);
  h.load(0.7 * scale);
}

/** Full detonation at a world point: fireball, sparks, smoke, debris, scorch, shake. */
export function explode(h: BlastHost, at: THREE.Vector3, n: THREE.Vector3,
                        groundY: number, scale: number, now: number) {
  const m = h.medium;
  // fireball
  let p = h.particles.reset();
  p.tile = TILE_FLAME; p.mode = MODE_BILLBOARD;
  p.life = 0.42; p.lifeJitter = 0.35;
  p.size0 = 1.1 * scale; p.size1 = 3.0 * scale; p.sizeJitter = 0.35;
  p.gravity = 5.5 * m.buoyancy; p.drag = 4.0; p.spin = 1.8;
  p.posJitter = 0.55 * scale; p.velJitter = 6.5 * scale; p.fadeIn = 0.04;
  p.count = Math.round(20 * scale);
  h.particles.at(at.x, at.y, at.z);
  h.particles.vel(0, 3.5, 0);
  h.particles.colorA(C_HOT, 2.6, 1);
  h.particles.colorB(C_FLAME_COOL, 0.7, 0);
  h.particles.emit(true);

  // sparks
  p.tile = TILE_CORE; p.mode = MODE_STRETCH; p.stretch = 3.4;
  p.life = 0.8; p.lifeJitter = 0.5;
  p.size0 = 0.085; p.size1 = 0.012;
  p.gravity = m.blastSparks.gravity; p.drag = m.blastSparks.drag;
  p.velJitter = 14 * scale; p.posJitter = 0.2;
  p.count = Math.round(72 * scale);
  h.particles.vel(0, 5, 0);
  h.particles.colorA(C_SPARK_WHITE, 2.8, 1);
  h.particles.colorB(C_FLAME_MID, 0.9, 0);
  h.particles.emit(true);

  // smoke column
  p = h.particles.reset();
  p.tile = TILE_SMOKE; p.mode = MODE_BILLBOARD;
  p.life = 2.1; p.lifeJitter = 0.35;
  p.size0 = 0.9 * scale; p.size1 = 5.0 * scale; p.sizeJitter = 0.35;
  p.gravity = 1.6 * m.buoyancy; p.drag = 1.5; p.spin = 0.7;
  p.posJitter = 0.7 * scale; p.velJitter = 3.2; p.fadeIn = 0.08;
  h.particles.ground(groundY, n, 0.9, 0.36);
  p.count = Math.round(22 * scale);
  h.particles.at(at.x, at.y + 0.2, at.z);
  h.particles.vel(0, 2.6, 0);
  h.particles.colorA(C_SMOKE_DARK, 0.9, 0.72);
  h.particles.colorB(C_SMOKE, 0.75, 0);
  h.particles.emit(false);

  // debris
  p.tile = TILE_STREAK; p.mode = MODE_STRETCH; p.stretch = 1.1;
  p.life = 1.5; p.lifeJitter = 0.4;
  p.size0 = 0.2 * scale; p.size1 = 0.14 * scale; p.sizeJitter = 0.5;
  p.gravity = m.shrapnel.gravity; p.drag = m.shrapnel.drag; p.spin = 8;
  p.velJitter = 9 * scale; p.posJitter = 0.3; p.softness = 0;
  p.count = Math.round(16 * scale);
  h.particles.vel(0, 7, 0);
  h.particles.colorA(C_DEBRIS, 1.0, 1);
  h.particles.colorB(C_DEBRIS, 0.8, 0.6);
  h.particles.emit(false);

  h.rings.spawn(at, n, 0.4, 8.0 * scale, 0.42, 0.06, C_HOT, 1.5, now);
  h.rings.spawn(at, n, 0.25, 4.4 * scale, 0.28, 0.09, C_FLAME_MID, 1.1, now);

  // `at` is very often the caller's own module scratch, so the decal is landed
  // through a different vector. That was true inside the games — the comment
  // there named `_p` — and it is doubly true now: `_r` is THIS module's, so it
  // cannot be any vector a game passed in.
  _r.set(at.x, groundY, at.z);
  h.decals.blot(_r, n, 2.6 * scale, h.scorchTile, now, 18, 0.85);

  h.shake(0.9 * scale, 0.55);
  h.load(1.6 * scale);
}
