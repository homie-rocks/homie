import * as THREE from 'three';
import type { ParticleRing } from './ParticleRing.ts';

/**
 * ============================================================================
 *  ParticlePool — two rings, a shared spawn description, and the twenty-odd
 *  members that are the SAME in every particle system these packages serve.
 * ============================================================================
 *  `DragParticles` (the two racers) and a base-building game's particle pool
 *  were two implementations of one class. Measured before this file existed,
 *  comparing the two bodies method for method:
 *
 *    BYTE-IDENTICAL, modulo the `!` that this package's stricter tsconfig
 *    requires and the game's does not — `invalidateGL`, `setLighting`,
 *    `setDepthTexture`, `resize`, `retireRecent`, `update`, `at`, `vel`,
 *    `colorA`, `colorB`, `setTime`, the `additiveGain` setter, and seven
 *    census getters. The two constructors agreed on `group.matrixAutoUpdate =
 *    false`, on both `group.add` calls, and on the two spawn ceilings —
 *    `Math.max(24, additiveCapacity >> 4)` and `Math.max(16, alphaCapacity >>
 *    4)` — down to the shift.
 *
 *    DIFFERENT IN ONE PLACE EACH: `emit` and `emitExact` draw from
 *    `Math.random()` in the racers and from a seeded `mulberry32` in the
 *    base-building game, which is that game's determinism discipline and not a
 *    preference; and `dispose` detaches the group in that game and does not in
 *    the racers.
 *
 *  ── WHY THIS DOES NOT OVERTURN THE `DragParticles` HEADER'S REFUSAL ────────
 *  That header says, correctly, that a ballistic game is NOT a consumer and
 *  cannot be: its particles are ballistic arcs that meet a tilted plane, not
 *  linear drag under gravity. Every word of that is about the SPAWN and the
 *  SHADER, and both stay exactly where they were: `DragParticleRing.spawn`
 *  writes `gravity` and `drag` into slots 8 and 9, the ballistic game's spawn
 *  writes a restitution and a closed-form landing time into the same two
 *  floats, and merging those two would be merging two simulations that merely
 *  share a shape. What was never about a moon or a kart is `setDepthTexture`,
 *  and it was written twice anyway.
 *
 *  ── THE TWO HOOKS, AND WHY THEY ARE ABSTRACT RATHER THAN OPTIONS ───────────
 *  `nextRandom` and `spawnOne` are the whole of the divergence in `emit`. They
 *  are abstract because a DEFAULT of `Math.random` here is precisely the trap
 *  a seeded game exists to avoid: a game that forgets to override it gets a
 *  particle field that is different on every boot, every capture is a
 *  photograph of a different world, and nothing anywhere says so. A subclass
 *  that must state where its randomness comes from cannot forget.
 *
 *  ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *  `reset()`, the `p` object itself and `ground()`. Each names its family's own
 *  `EmitParams` fields — `gravity`/`drag`/`channel` against `bounce`/`spin` —
 *  and the LITERAL DEFAULTS in `reset` are art direction with a `=` in front of
 *  them. `ground()` disagrees even in its signature (four scalars against a
 *  vector), which is a call-site convention rather than a mechanism.
 * ============================================================================
 */

/**
 * The fields of a spawn description that every family shares.
 *
 * A STRUCTURAL interface, never a nominal one to inherit from: each game's own
 * `EmitParams` satisfies this by having these fields, without being changed and
 * without importing anything. That is the technique that keeps unblocking this
 * corpus — the narrowest type the shared code actually touches, declared where
 * it is used.
 */
export interface PoolParams {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r0: number; g0: number; b0: number; a0: number;
  r1: number; g1: number; b1: number; a1: number;
  count: number;
}

export abstract class ParticlePool<P extends PoolParams, L extends ParticleRing> {
  readonly group = new THREE.Group();
  readonly atlas: THREE.DataTexture;
  protected readonly additiveLayer: L;
  protected readonly alphaLayer: L;
  protected readonly layers: L[];

  /** density multiplier from the quality settings, applied to every emit count */
  density = 1;

  protected time = 0;

  /** The shared spawn description. Fill it, then call `emit`. Never copied. */
  abstract readonly p: P;

  /**
   * @param atlas the sprite sheet both layers sample; disposed with the pool.
   * @param additiveLayer the ring drawn with additive blending — hot things.
   * @param alphaLayer the ring drawn with alpha blending — lit things.
   *
   * THE ALPHA LAYER IS ADDED FIRST and `layers` lists it first, in both
   * original implementations, and that order is load-bearing twice over: it is
   * the draw order of two transparent meshes with no depth write between them,
   * and it is the iteration order of every `for (const l of this.layers)` below.
   */
  protected constructor(atlas: THREE.DataTexture, additiveLayer: L, alphaLayer: L) {
    this.atlas = atlas;
    this.additiveLayer = additiveLayer;
    this.alphaLayer = alphaLayer;
    this.layers = [alphaLayer, additiveLayer];
    this.group.add(alphaLayer.mesh, additiveLayer.mesh);
    this.group.matrixAutoUpdate = false;
    // A frame may never spend more than a sixteenth of a ring, so at least
    // ~0.27 s of history survives at 60 Hz whatever is happening.
    //
    // The DIRECTION of that trade is the point. When emission outruns the ring
    // the choice is between DROPPING spawns and letting the ring turn over
    // inside a particle's lifetime, and they do not degrade alike: dropping
    // thins a shower evenly, while turnover chops its tail off and a spark that
    // vanishes at a third of its life reads as a rendering fault rather than as
    // a lower setting.
    //
    // Measured on an emulated iPhone at medium quality with a racer's whole
    // field forced into a tier-3 drift and items firing continuously, the
    // additive layer peaks at 79 spawns in a frame and averages 31, against a
    // ceiling of 98. So this does not trim the shipped effect at all; it is the
    // bound that stops a case nobody has thought of from becoming an unbounded
    // frame.
    this.additiveLayer.spawnsPerFrame = Math.max(24, additiveLayer.capacity >> 4);
    this.alphaLayer.spawnsPerFrame = Math.max(16, alphaLayer.capacity >> 4);
  }

  // ── the two hooks ─────────────────────────────────────────────────────────

  /** The random stream `emit`'s fractional rounding draws from. See the header. */
  protected abstract nextRandom(): number;

  /** Write one particle of `this.p` into `layer` at `now`. False = ring full. */
  protected abstract spawnOne(layer: L, now: number): boolean;

  // ── the shared spawn description, the fields both families have ───────────

  at(x: number, y: number, z: number): P { const p = this.p; p.x = x; p.y = y; p.z = z; return p; }
  vel(x: number, y: number, z: number): P { const p = this.p; p.vx = x; p.vy = y; p.vz = z; return p; }

  /** Birth colour = `c * intensity` (HDR allowed), alpha `a`. */
  colorA(c: THREE.Color, intensity: number, a: number): P {
    const p = this.p;
    p.r0 = c.r * intensity; p.g0 = c.g * intensity; p.b0 = c.b * intensity; p.a0 = a;
    return p;
  }
  colorB(c: THREE.Color, intensity: number, a: number): P {
    const p = this.p;
    p.r1 = c.r * intensity; p.g1 = c.g * intensity; p.b1 = c.b * intensity; p.a1 = a;
    return p;
  }

  /**
   * Spawn `p.count * density` particles. Counts round to at least one when the
   * caller asked for any at all, so a low-density machine still gets the
   * readability cue, just thinner. The fractional remainder is resolved
   * stochastically, which avoids density banding across a sweep of emitters.
   *
   * For a CONTINUOUS emitter whose rate already spends the density, use
   * `emitExact`. Paying the multiplier twice was a measured bug: one racer's
   * slipstream drew 0.36 of its authored streaks at medium quality, while every
   * emitter looping `count = 1` paid it not at all, because one times any
   * density still floors back to one. Apply density to the RATE and use
   * `emitExact`, or leave the rate alone and use `emit`. Never both.
   */
  emit(additive: boolean): void {
    const p = this.p;
    const n = p.count * this.density;
    let count = Math.floor(n);
    if (this.nextRandom() < n - count) count++;
    if (count <= 0) count = p.count > 0 ? 1 : 0;
    const layer = additive ? this.additiveLayer : this.alphaLayer;
    for (let i = 0; i < count; i++) if (!this.spawnOne(layer, this.time)) break;
  }

  /** Emit `p.count` particles with NO density multiply. See `emit`. */
  emitExact(additive: boolean): void {
    const count = this.p.count | 0;
    if (count <= 0) return;
    const layer = additive ? this.additiveLayer : this.alphaLayer;
    for (let i = 0; i < count; i++) if (!this.spawnOne(layer, this.time)) break;
  }

  // ── the clock ─────────────────────────────────────────────────────────────

  /**
   * Stamp the clock used as the birth time of everything emitted this frame.
   * Call before the first emit; `update()` re-stamps and then flushes.
   */
  setTime(t: number): void { this.time = t; }
  get now(): number { return this.time; }

  // ── the census, which exists so a soak harness can prove a plateau ────────

  /** Global additive attenuation — the game measures the screen load. */
  set additiveGain(v: number) { this.additiveLayer.material.uniforms.uGain!.value = v; }
  get additiveGain(): number { return this.additiveLayer.material.uniforms.uGain!.value; }

  get spawnedLastFrame(): number { return this.additiveLayer.spawned + this.alphaLayer.spawned; }
  get additiveSpawnedLastFrame(): number { return this.additiveLayer.spawned; }
  get alphaSpawnedLastFrame(): number { return this.alphaLayer.spawned; }
  get spawnCeiling(): number { return this.additiveLayer.room + this.additiveLayer.spawned; }
  /** Live instances actually drawn last frame, per layer. Draw-budget reporting. */
  get liveAdditive(): number { return this.additiveLayer.geo.instanceCount; }
  get liveAlpha(): number { return this.alphaLayer.geo.instanceCount; }
  get refusedLastFrame(): number { return this.additiveLayer.refused + this.alphaLayer.refused; }

  /**
   * THE SAME NUMBER, SPLIT BY RING, and the split is the point.
   *
   * The two rings are sized independently — two plain numbers handed
   * positionally to one constructor — so a summed refusal cannot tell you WHICH
   * ring is short, and the failure that pair invites is having them the wrong
   * way round. Reported separately, an additive ring refusing hard against a
   * capacity that is obviously the alpha ring's number says so out loud.
   */
  get refusedAdditiveLastFrame(): number { return this.additiveLayer.refused; }
  get refusedAlphaLastFrame(): number { return this.alphaLayer.refused; }
  get additiveCapacity(): number { return this.additiveLayer.capacity; }
  get alphaCapacity(): number { return this.alphaLayer.capacity; }
  get additiveCeiling(): number { return this.additiveLayer.spawnsPerFrame; }
  get alphaCeiling(): number { return this.alphaLayer.spawnsPerFrame; }

  // ── uniforms both families' shaders declare ───────────────────────────────

  /**
   * Publish the lighting the LIT layer shades its particles with. Only the
   * alpha layer has it: an additive sprite is its own light.
   */
  setLighting(sunDir: THREE.Vector3, sun: THREE.Color, sky: THREE.Color, bounce: THREE.Color): void {
    const u = this.alphaLayer.material.uniforms;
    u.uSunDir!.value.copy(sunDir);
    u.uSunColor!.value.copy(sun);
    u.uSkyColor!.value.copy(sky);
    u.uBounceColor!.value.copy(bounce);
  }

  /**
   * Opt-in true soft particles. The render pipeline owns the depth buffer; if
   * it publishes one we use it, otherwise the ground-plane fade carries us.
   *
   * Both layers get it, and the ADDITIVE one needs it more: a plume that cuts a
   * hard intersection line through the ground is the loudest amateur tell
   * available in either genre.
   */
  setDepthTexture(tex: THREE.Texture | null, near: number, far: number): void {
    for (const l of this.layers) {
      const m = l.material;
      const had = m.defines.SOFT_DEPTH !== undefined;
      const want = !!tex;
      m.uniforms.uDepth!.value = tex;
      m.uniforms.uCamPlanes!.value.set(near, far);
      if (want !== had) {
        if (want) m.defines.SOFT_DEPTH = ''; else delete m.defines.SOFT_DEPTH;
        m.needsUpdate = true; // recompile: the depth branch is a static define
      }
    }
  }

  resize(w: number, h: number): void {
    for (const l of this.layers) l.material.uniforms.uInvRes!.value.set(1 / w, 1 / h);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Re-mark every GPU-resident buffer dirty. The interleaved rings and the
   * atlas both keep their CPU copy, so a restored context only needs to be told
   * to re-upload them.
   */
  invalidateGL(): void {
    for (const l of this.layers) l.invalidate();
    this.atlas.needsUpdate = true;
  }

  /**
   * Cut short the newest `count` particles on a layer so they dissolve within
   * `fade` seconds. Bounded work, no allocation, harmless on dead slots.
   *
   * Keep this for cases where the particles genuinely should stop existing — a
   * reset, an effect being cancelled — not for cases where they should CHANGE.
   * Retiring particles to fix a colour can only ever choose between showing the
   * wrong hue and showing a hole, because a ring buffer has no way to know
   * which of its newest N slots belonged to the thing that changed.
   */
  retireRecent(additive: boolean, count: number, fade = 0.07): void {
    (additive ? this.additiveLayer : this.alphaLayer).retireRecent(count, this.time, fade);
  }

  /** Drop every live particle. A capture harness resets between shots. */
  clear(): void {
    for (const l of this.layers) l.clear(this.time);
  }

  /**
   * PREWARM SUPPORT. `renderer.compile()` gathers lights with `traverseVisible`
   * and light counts are part of the program cache key, so a hidden pooled
   * object compiles the wrong program or none at all. Both meshes are always
   * visible; what makes them free is `instanceCount = 0`. This forces one
   * instance alive so a prewarm pass has something to compile.
   */
  prewarmPoke(): void {
    for (const l of this.layers) l.geo.instanceCount = Math.max(l.geo.instanceCount, 1);
  }

  update(time: number): void {
    this.time = time;
    for (const l of this.layers) {
      l.material.uniforms.uTime!.value = time;
      l.flush(time);
    }
  }

  dispose(): void {
    for (const l of this.layers) l.dispose();
    this.atlas.dispose();
  }
}
