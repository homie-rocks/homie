/**
 * ============================================================================
 *  instpool — a REFILLED instanced set: begin, push N, end, once per frame.
 * ============================================================================
 *  `@homie-rocks/geom/inst.ts`'s `InstSet` accumulates transforms and emits an
 *  InstancedMesh ONCE, at build time, for scenery that never moves. This is the
 *  other lifecycle: a fixed-capacity mesh that is emptied and refilled every
 *  frame from whatever is currently alive and in front of the camera.
 *
 *  It is one draw call for the whole set, which is the point. Draw calls are
 *  the constraint on this hardware, not triangles — eight machines with eight
 *  wheels each is ONE call for sixty-four wheels, not sixty-four calls.
 *
 * ----------------------------------------------------------------------------
 *  `spread` IS REQUIRED, AND THE REASON IS A SHIPPED BLOCKER
 * ----------------------------------------------------------------------------
 *  This is a WORLD-SCATTERED set: the mesh itself never leaves the origin and
 *  every instance carries its own world matrix. three leaves
 *  `InstancedMesh.boundingSphere` null until somebody asks, and the first thing
 *  that asks is `drawbudget.ts`'s shadow-relevance pass, which calls
 *  `computeBoundingSphere()` and then caches the answer FOREVER in its caster
 *  index. It asks during boot, while `count` is still 0 — and three's
 *  `InstancedMesh.computeBoundingSphere()` on a zero-count mesh runs no loop at
 *  all and leaves the sphere EMPTY, i.e. `radius = -1`.
 *
 *  What that looks like from the outside is a whole population that casts no
 *  shadow. DrawBudget tests a degenerate ball at the world origin, concludes the
 *  set's shadow cannot be in frame, and writes `castShadow = false` over the
 *  owner's own correct flag, every frame. It reads as a missing `castShadow` or
 *  an unpatched custom depth material, and it is neither: both are already right
 *  and are being overwritten from outside.
 *
 *  So the sphere is PUBLISHED rather than left to be computed at the worst
 *  possible moment, and it is published in the constructor, before anything
 *  downstream can ask. Its centre is the mesh origin because that is the point
 *  DrawBudget tests from (`setFromMatrixPosition` of the mesh's world matrix,
 *  not the sphere's own centre) and its radius is `spread` — which is the
 *  caller's playfield half-diagonal, because an instance genuinely can be
 *  anywhere on the map, and is therefore a number no package can know.
 *
 *  DrawBudget's documented behaviour for an instanced set wider than its cull
 *  threshold is to decline to reason about it and leave the owner's flag alone,
 *  which is exactly the right answer for a set whose world position is
 *  meaningless. The cost is that these sets go to every shadow cascade rather
 *  than to the ones their unknowable shadow lands in. That is worth it; the
 *  alternative is a crowd of pasted-on stickers.
 *
 * ----------------------------------------------------------------------------
 *  PER-INSTANCE CHANNELS — THE THIRD ONE APPEARED, SO THEY ARE HERE NOW
 * ----------------------------------------------------------------------------
 *  This block used to read "WHAT IS NOT HERE: per-instance attribute channels…
 *  `@homie-rocks/fx/ConePools` and `@homie-rocks/render/sunpatch` carry the same
 *  begin/push/end shape with one extra float4 stream each… **if a third of them
 *  appears, that is when to reconcile all three.**"
 *
 *  A space racer's ordnance bank was the third, and it was carrying TWO streams
 *  rather than one — `aData` (age, seed, fade) on the cryo volume and the
 *  sunder curtain, and `aPlane` (the deck plane, as Ax+By+Cz+D) on the cryo
 *  volume alone. So `channels` is a LIST of names rather than a boolean, which
 *  is what the two-class worry was really about: an optional buffer is two
 *  classes wearing one name, but a named set of buffers is one class with a
 *  layout, and a set of size zero is exactly the scenery case above.
 *
 *  Each channel is one `vec4` per instance, `DynamicDrawUsage`, flushed in
 *  `end()` beside the matrix. Nothing is uploaded for a set that declares none,
 *  so a crowd's LOD buckets pay nothing for this.
 *
 *  ConePools and sunpatch are still their own classes. They were left where
 *  they are on purpose: both do more than hold a stream (ConePools owns a cone
 *  ladder, sunpatch owns a patch atlas), and folding them in would be moving a
 *  capability that has a caller, not sharing one. What the reconciliation
 *  actually owed was this class being ABLE to be the thing they specialise,
 *  which it now is.
 * ============================================================================
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export interface InstPoolOpts {
  /**
   * How far from the mesh origin an instance may be, in world units. Required:
   * see the header. There is no sane default — a package guessing here is
   * exactly the shadow blocker it exists to prevent.
   */
  spread: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
  /**
   * Per-instance `vec4` attribute names, in the shader's own spelling — e.g.
   * `['aData', 'aPlane']`. One buffer each, `DynamicDrawUsage`, written through
   * `setChannel` and flushed by `end()`. Omit for a set whose only per-instance
   * data is its matrix; nothing is allocated or uploaded in that case.
   *
   * The names are the seam between this class and a material's GLSL, and a
   * misspelling here is silent — three attaches the attribute, the program
   * never reads it, and the set renders with whatever the shader's default was.
   * `channel()` throws on an undeclared name for that reason; there is no
   * tolerant lookup, because a tolerant lookup would render perfectly.
   */
  channels?: readonly string[];
}

export class InstPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly cap: number;
  private readonly chan = new Map<string, THREE.InstancedBufferAttribute>();

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    capacity: number,
    opts: InstPoolOpts,
  ) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // We do our own distance and behind-camera culling; three's test would use
    // the base geometry's bounds, which sit at the origin and would cull the
    // whole set the moment the camera looks away from world zero.
    this.mesh.frustumCulled = false;
    // See the header. Assigned rather than computed, and assigned HERE — before
    // anything downstream can call computeBoundingSphere() on an empty set and
    // cache the answer for the lifetime of the process.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), opts.spread);
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = opts.receiveShadow ?? true;
    if (opts.renderOrder !== undefined) this.mesh.renderOrder = opts.renderOrder;
    for (const name of opts.channels ?? []) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      // On `this.mesh.geometry`, not on the caller's `geo` handle: they are the
      // same object today, and writing it through the mesh is what keeps that
      // true if a caller ever hands the same geometry to two pools.
      this.mesh.geometry.setAttribute(name, a);
      this.chan.set(name, a);
    }
  }

  /**
   * The raw attribute for a declared channel, for a caller that wants
   * `setXYZW` / `array` directly. Throws on a name that was not declared — see
   * `InstPoolOpts.channels` for why this is not a tolerant lookup.
   */
  channel(name: string): THREE.InstancedBufferAttribute {
    const a = this.chan.get(name);
    if (!a) throw new Error(`InstPool: no such channel '${name}'`);
    return a;
  }

  /** Write one instance's `vec4` on a declared channel. */
  setChannel(name: string, i: number, x: number, y: number, z: number, w: number) {
    this.channel(name).setXYZW(i, x, y, z, w);
  }

  begin() { this.n = 0; }

  /** Returns the slot index, or -1 when the set is full. */
  push(m: THREE.Matrix4): number {
    if (this.n >= this.cap) return -1;
    this.mesh.setMatrixAt(this.n, m);
    return this.n++;
  }

  /** Compose-and-push, allocation free. */
  pushTRS(
    x: number, y: number, z: number, qt: THREE.Quaternion,
    sx: number, sy: number, sz: number,
  ): number {
    _s.set(sx, sy, sz);
    _v.set(x, y, z);
    _m.compose(_v, qt, _s);
    return this.push(_m);
  }

  end() {
    this.mesh.count = this.n;
    // An InstancedMesh with count 0 still costs a draw call in the colour pass
    // AND one in every shadow cascade — three submits it and the driver draws
    // nothing. A crowd, its vehicles and its props are dozens of these sets and
    // in a typical frame most LOD buckets are empty, so hiding them is worth
    // tens of draws for one boolean. Safe with a frozen-camera hook: the count
    // is recomputed and the flag reset every time the set is refilled.
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Beside the matrix, unconditionally. A channel flushed on a different
    // clock from the transform it belongs to is one frame of every instance
    // wearing its neighbour's age, which reads as a flicker nobody can place.
    for (const a of this.chan.values()) a.needsUpdate = true;
  }

  get count() { return this.n; }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// StaticShadedPool — the third of the three the header said to wait for
// ---------------------------------------------------------------------------
//
// THE HEADER ABOVE SAYS: "a pool with an optional attribute buffer is two
// classes wearing one name. If a third of them appears, that is when to
// reconcile all three." A third appeared — a base-building game's scatter
// module carried a `RockSet` with a byte4 `aShade` stream, an instance colour,
// and its own placement transform — so this is that reconciliation, and this is
// the honest half of it: the third one is published, the other two are NOT
// folded in, and the reason is scope rather than principle.
//
// `@homie-rocks/fx/ConePools` and `@homie-rocks/render/sunpatch` carry a FLOAT4 stream each
// and both are driven per frame; this one is a byte4, written once at world
// build and never touched again. Folding all three needs the two racers'
// frames in front of a person, which is a project and not a paragraph. What is
// written down here so the next attempt does not re-derive it: the shape is the
// same, the buffer type and the update cadence are not, and the divergence to
// look at first is `DynamicDrawUsage` against `StaticDrawUsage`.
//
// WHY IT IS A SEPARATE CLASS AND NOT `InstPool` WITH A FLAG. `InstPool` culls
// itself, sizes its own bounding sphere off a required `spread`, and refills
// every frame from `begin()`. This one is filled ONCE, computes its bounds from
// what actually landed, and is added to the scene only if anything did. Two
// lifecycles, and a boolean choosing between them would be the tell that they
// were never one thing.

const _sp = new THREE.Vector3();
const _ss = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const _sq2 = new THREE.Quaternion();
const _sn = new THREE.Vector3();
const _saxis = new THREE.Vector3();
const _sm = new THREE.Matrix4();
const _sup = new THREE.Vector3(0, 1, 0);

/**
 * A write-once instanced set with ONE per-instance byte4 attribute.
 *
 * The attribute NAME is required and there is no default: what those four
 * bytes mean is entirely the caller's shader's business, and a package that
 * named the stream would be naming a channel layout it cannot see.
 *
 * `capacity` is a hard cap and `place` returns -1 rather than growing. A pool
 * that reallocated mid-scatter would invalidate the `Uint8Array` the caller is
 * holding, which is the shape of bug that writes shade bytes into a buffer
 * nothing is reading any more.
 */
export class StaticShadedPool {
  readonly mesh: THREE.InstancedMesh;
  /** The per-instance byte4 payload, `capacity * 4` long. The caller writes it. */
  readonly shade: Uint8Array;
  private n = 0;

  constructor(
    geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number,
    name: string, attribute: string,
  ) {
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // An INSTANCED attribute on a plain BufferGeometry, which three handles by
    // setting the divisor. The alternative — a per-vertex attribute — gives
    // every instance of a shape the SAME payload, which for a lighting term
    // means a lit prop standing in a shadowed hollow.
    this.shade = new Uint8Array(capacity * 4);
    geo.setAttribute(attribute, new THREE.InstancedBufferAttribute(this.shade, 4, true));
    this.mesh = mesh;
  }

  get count() { return this.n; }

  /**
   * Compose one instance from a surface normal, a lean and a yaw. Returns the
   * slot index, or -1 when the set is full.
   *
   * THE ORDER IS THE ANSWER AND IT IS NOT INTERCHANGEABLE: align +Y to the
   * surface normal FIRST, then lean about a random horizontal axis, then yaw
   * about world up. Aligning to world up and leaning afterwards puts a prop on
   * a 20-degree slope standing bolt upright, which reads as dropped in by a
   * level editor; yawing before the align spins the lean with it.
   *
   * `rng` is drawn exactly twice, for the lean axis, and ONLY on success. The
   * full-set return happens before the first draw on purpose: a caller sharing
   * one stream across a dozen buckets would have every placement after the
   * first full bucket land somewhere else if this drew and then bailed.
   *
   * The normal is taken as three numbers rather than a Vector3 because every
   * caller here holds it in a module scratch that this function also needs.
   */
  place(
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    yaw: number, nx: number, ny: number, nz: number,
    tilt: number, rng: () => number,
  ): number {
    if (this.n >= this.mesh.count) return -1;
    const i = this.n++;
    _sn.set(nx, ny, nz);
    _sq.setFromUnitVectors(_sup, _sn);
    _saxis.set(rng() * 2 - 1, 0, rng() * 2 - 1).normalize();
    _sq2.setFromAxisAngle(_saxis, tilt);
    _sq.multiply(_sq2);
    _sq2.setFromAxisAngle(_sup, yaw);
    _sq.multiply(_sq2);
    _sp.set(x, y, z);
    _ss.set(sx, sy, sz);
    _sm.compose(_sp, _sq, _ss);
    this.mesh.setMatrixAt(i, _sm);
    return i;
  }

  /**
   * Close the set and parent it — ONLY if anything landed in it.
   *
   * An InstancedMesh with count 0 still costs a draw call in the colour pass
   * and one in every shadow cascade, and a scatter run that filtered everything
   * out of a bucket is common rather than exceptional.
   *
   * `computeBoundingSphere` and not an assumed radius, because this pool is
   * write-once: what landed IS the extent, and three's own instanced bounds are
   * correct for a set that will never move.
   */
  finish(parent: THREE.Object3D): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    if (this.n > 0) parent.add(this.mesh);
  }
}
