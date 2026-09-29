import * as THREE from 'three';

/**
 * ============================================================================
 *  ParticleRing — the instanced ring buffer under every particle system here.
 * ============================================================================
 *  One draw call per layer, an interleaved instance buffer written ONCE at
 *  spawn, and a vertex shader that integrates the motion from there. Which
 *  motion is not this file's business: the two racers this came from solve
 *  linear drag under constant gravity, and a base-building game solves a
 *  ballistic arc that meets a tilted ground plane at a time computed at spawn.
 *  Those are different simulations and they stay in their games.
 *
 *  WHAT IS ONE THING IN THREE PLACES is everything around that: the geometry,
 *  the interleaved attribute layout, the material, the write head, the wrap,
 *  the per-frame spawn ceiling, the upload ranges and the draw skip. That is
 *  what lives here. A game subclasses this and writes exactly one method —
 *  `spawn` — which asks for a slot, fills 32 floats, and says how long the
 *  particle lives.
 *
 *  THE UPLOAD WINDOW IS THE WHOLE POINT OF THE BOOKKEEPING. Marking the span
 *  from the lowest to the highest slot written this frame is exact while the
 *  writes stay in order and catastrophic on the frame the ring wraps: the span
 *  becomes [0, capacity) and three re-uploads the ENTIRE interleaved buffer —
 *  435 KB for a 3,400-slot additive layer. At a busy 250 spawns/frame the ring
 *  turns over every ~14 frames, so one frame in fourteen pushed three quarters
 *  of a megabyte across the bus while the other thirteen pushed twenty
 *  kilobytes. On a phone that is a visible, periodic hitch, and it reads as a
 *  black flash rather than as an upload. Tracking where this frame's writes
 *  STARTED lets a wrap upload as two tight ranges instead.
 * ============================================================================
 */

/** 8 x vec4 — kept at exactly 32 floats so every attribute is vec4-aligned. */
export const PARTICLE_STRIDE = 32;

/** The eight interleaved vec4s, in the order the shaders declare them. */
const ATTR_NAMES = ['aStart', 'aVel', 'aDyn', 'aSize', 'aColA', 'aColB', 'aMisc', 'aGrnd'];

export interface ParticleLayerSpec {
  capacity: number;
  /** additive layer (sparks, flame, flash) rather than alpha-blended-and-lit */
  additive: boolean;
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
  defines: Record<string, string>;
  /**
   * Leave undefined to keep three's default. A caller whose composer buffer is
   * scene-linear HDR, with a post pass owning the grade, passes false.
   */
  toneMapped?: boolean;
}

function baseQuad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  // The vertex shader places everything in world space from its own attributes;
  // a bounding volume would be meaningless and culling on it would be wrong.
  //
  // (This is also why the USE_INSTANCING trap cannot bite here: there is no
  // `instanceMatrix` and no `transformed` in these shaders at all. World
  // position comes from aStart/aVel, which are genuine per-instance attributes.
  // Anything added below that needs a world position must keep it that way, or
  // guard.)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export class ParticleRing {
  readonly capacity: number;
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  readonly data: Float32Array;
  readonly material: THREE.ShaderMaterial;

  private head = 0;
  private wrapped = false;
  /** time at which the newest particle expires; see `keepAlive` */
  private liveUntil = -1;

  /** where this frame's writes started — see the upload-window note above */
  private frameStart = 0;
  private frameWrote = 0;
  /** something wrote outside the sequential window; fall back to a full upload */
  private fullDirty = false;

  /**
   * HARD PER-FRAME SPAWN CEILING.
   *
   * Emission rates are additive across every emitter in a scene, so the worst
   * case an art bible names is not a bounded quantity today; it is however many
   * particles the accumulators happen to ask for. This is the bound. Once it is
   * spent the layer refuses further spawns for the frame, which guarantees the
   * ring cannot turn over more than once per frame however heavy the scene
   * gets, keeps the upload window small, and puts a ceiling on the CPU cost of
   * a frame that does not depend on how the action is going.
   *
   * THE DIRECTION OF THE TRADE IS THE POINT. When emission outruns the ring the
   * choice is between DROPPING spawns and letting the ring turn over inside a
   * particle's lifetime, and they do not degrade alike: dropping thins a shower
   * evenly, while turnover chops its tail off, and a spark that vanishes at a
   * third of its life reads as a RENDERING FAULT rather than as a lower
   * setting. So we drop, and we publish how much we dropped.
   */
  private budget = 1 << 30;
  private perFrame = 1 << 30;

  /** How many particles were written on the frame just flushed. */
  spawned = 0;
  /**
   * Spawns this layer REFUSED on the frame just flushed.
   *
   * A ceiling nobody can see being hit is a ceiling that quietly deletes half a
   * shower and calls it a setting. This is what makes the trade visible: zero
   * means every emitter got what it asked for and the cap is pure insurance, a
   * number climbing toward the ceiling means emission is outrunning the budget
   * and the thinning is real. Published on the mesh beside `spawned` so a soak
   * harness can read both off the scene graph.
   */
  refused = 0;
  private frameRefused = 0;

  constructor(spec: ParticleLayerSpec) {
    this.capacity = spec.capacity;
    this.geo = baseQuad();
    this.data = new Float32Array(spec.capacity * PARTICLE_STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, PARTICLE_STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < ATTR_NAMES.length; i++) {
      this.geo.setAttribute(ATTR_NAMES[i]!,
        new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    }
    this.geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: spec.uniforms,
      vertexShader: spec.vertexShader,
      fragmentShader: spec.fragmentShader,
      defines: spec.defines as Record<string, string>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    if (spec.toneMapped !== undefined) this.material.toneMapped = spec.toneMapped;

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    // Above a scene's own glow and transparent layers, so particles composite
    // over the hero geometry rather than under it.
    this.mesh.renderOrder = spec.additive ? 12 : 10;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Named so a soak harness can read the live instance count straight off the
    // scene graph without this file having to grow a stats API.
    this.mesh.name = spec.additive ? 'fx-particles-additive' : 'fx-particles-alpha';
  }

  /** Number of spawns this layer will still accept this frame. */
  get room() { return this.budget; }

  set spawnsPerFrame(n: number) { this.perFrame = Math.max(1, n | 0); }
  get spawnsPerFrame() { return this.perFrame; }

  /**
   * Claim the next slot in the ring for a subclass's `spawn`.
   *
   * @returns the FLOAT OFFSET of the slot in `data`, or -1 when the frame's
   *          spawn budget is spent — in which case the caller must write
   *          nothing and report the refusal upward by returning false.
   */
  protected reserve(): number {
    if (this.budget <= 0) { this.frameRefused++; return -1; }
    this.budget--;
    const i = this.head;
    this.head = this.head + 1;
    if (this.head >= this.capacity) { this.head = 0; this.wrapped = true; }
    this.frameWrote++;
    return i * PARTICLE_STRIDE;
  }

  /**
   * Tell the ring the newest particle is alive until `until`. This is what lets
   * `flush` skip the draw call entirely once the last one has expired.
   */
  protected keepAlive(until: number) {
    if (until > this.liveUntil) this.liveUntil = until;
  }

  /**
   * Shorten the lifetime of the newest `count` slots so anything still alive
   * expires `fade` seconds from now. Walks backwards from the write head, which
   * is exactly newest-first, and stops at the ring's live extent.
   */
  retireRecent(count: number, now: number, fade: number) {
    const cap = this.capacity;
    const n = Math.min(count, this.wrapped ? cap : this.head);
    const d = this.data;
    let i = this.head;
    for (let j = 0; j < n; j++) {
      i = i === 0 ? cap - 1 : i - 1;
      const o = i * PARTICLE_STRIDE;
      const age = now - d[o + 3]!;
      const life = d[o + 7]!;
      if (age < 0 || age >= life) continue;
      const shortened = age + fade;
      if (shortened >= life) continue;
      d[o + 7] = shortened;
      this.fullDirty = true;
    }
  }

  /** Kill everything immediately. Between capture shots only. */
  clear(now: number) {
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) d[i * PARTICLE_STRIDE + 7] = 0; // life = 0
    this.fullDirty = true;
    this.liveUntil = now - 1;
  }

  /** Re-upload everything — after a WebGL context restore. */
  invalidate() { this.fullDirty = true; }

  flush(now: number) {
    const cap = this.capacity;
    const buf = this.buffer;

    /*
     * A NON-EMPTY updateRanges MEANS THE LAST FLUSH WAS NEVER UPLOADED.
     *
     * three clears the ranges itself, inside WebGLAttributes.updateBuffer,
     * immediately after the bufferSubData calls. So if any survive to here, no
     * render consumed them and calling clearUpdateRanges() would silently throw
     * away writes that are sitting in the CPU array and have never reached the
     * GPU.
     *
     * That is not a theoretical case, it is a capture harness's normal mode:
     * `__step(dt)` settles the world by advancing it a fixed number of times
     * WITHOUT rendering, because a harness that waits in wall-clock
     * milliseconds is measuring the machine. Sixty steps then present exactly
     * one frame — and with an unconditional clear, fifty-nine frames of spawns
     * would exist in the ring, be drawn (instanceCount covers them), and read
     * back whatever bytes the GPU happened to hold. Stale garbage, or nothing,
     * in every settled screenshot, and it would look like a particle bug rather
     * than an upload bug.
     *
     * Measured on the way in: without this guard a test that cleared the pool
     * and respawned between renders kept drawing the PREVIOUS shot's particle,
     * at exactly its previous size — which is how it was found.
     *
     * So: append, never clobber. And if enough have piled up that merging them
     * costs more than the whole buffer, escalate to one full upload.
     */
    const pending = buf.updateRanges.length;
    const escalate = pending > 24;
    const clearFirst = pending === 0;

    if (this.fullDirty || this.frameWrote >= cap || escalate) {
      if (clearFirst || escalate) buf.clearUpdateRanges();
      buf.addUpdateRange(0, cap * PARTICLE_STRIDE);
      buf.needsUpdate = true;
    } else if (this.frameWrote > 0) {
      if (clearFirst) buf.clearUpdateRanges();
      const end = this.frameStart + this.frameWrote;
      if (end <= cap) {
        buf.addUpdateRange(this.frameStart * PARTICLE_STRIDE, this.frameWrote * PARTICLE_STRIDE);
      } else {
        // wrapped: tail of the ring, then the head of it. Two tight ranges
        // instead of the whole buffer.
        buf.addUpdateRange(this.frameStart * PARTICLE_STRIDE, (cap - this.frameStart) * PARTICLE_STRIDE);
        buf.addUpdateRange(0, (end - cap) * PARTICLE_STRIDE);
      }
      buf.needsUpdate = true;
    }
    this.fullDirty = false;
    this.spawned = this.frameWrote;
    this.refused = this.frameRefused;
    // Published on the mesh so a soak harness can read the spawn rate, the
    // ceiling it is being measured against, and how much the ceiling actually
    // cost, straight off the scene graph.
    this.mesh.userData.spawned = this.frameWrote;
    this.mesh.userData.refused = this.frameRefused;
    this.mesh.userData.ceiling = this.perFrame;
    this.frameStart = this.head;
    this.frameWrote = 0;
    this.frameRefused = 0;
    this.budget = this.perFrame;
    // Skip the draw entirely once every particle has expired. This is what
    // keeps two draw calls from being two draw calls when nothing is happening.
    this.geo.instanceCount = now > this.liveUntil ? 0 : (this.wrapped ? cap : this.head);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
