/**
 * ============================================================================
 *  InstSet — many transforms in, one InstancedMesh out.
 * ============================================================================
 *  The other half of the draw-call budget. Where `GeoAccum` bakes geometry
 *  flat, this keeps one geometry and N transforms, plus the five optional
 *  per-instance channels the shader patches read: `aTint`, `aUv`, `aWind`,
 *  `aLod`, `aBob`.
 *
 *  TWO IMPLEMENTATIONS EXISTED AND THIS IS THE SPACE RACER'S, DELIBERATELY.
 *  It differs from the kart racer's in exactly two lines — `useCol` and `useUv`
 *  default to true rather than false — and the block comment on them is the
 *  argument, written by whoever hit the bug. It is not a matter of taste:
 *  *"an invariant that survives right up until somebody adds a call site"* is
 *  the shape of the trap.
 *
 *  THE REVERSE TRAP IS GUARDED TOO. Emitting a non-white `aTint` while the
 *  material has no shader reader makes every carefully authored instance
 *  render at the material's flat colour. `build()` and `snapshot()` now refuse
 *  that state. @homie-rocks/render's readers mark the material through the shared
 *  `Symbol.for` capability below, so correct callers write no extra ceremony
 *  and a missed `patchTint` becomes a named boot error rather than plausible
 *  white foliage.
 */
import * as THREE from 'three';

/**
 * Cross-package capability mark installed by an `aTint` shader reader.
 *
 * `Symbol.for` is deliberate: @homie-rocks/geom must not depend upward on
 * @homie-rocks/render, while the material patch and this accumulator still need one
 * runtime fact they cannot disagree about. The global registry makes that fact
 * survive separate ESM modules and bundle chunks without a package edge.
 */
const INST_TINT_READER = Symbol.for('@homie-rocks/instance/aTint-reader');
type TintReadableMaterial = THREE.Material & { [INST_TINT_READER]?: true };

export interface InstOpts {
  color?: THREE.Color;
  /** uv scale.xy / offset.xy for atlases and per-instance tiling */
  uv?: THREE.Vector4;
  /** wind: phase, stiffness exponent, reference height, flutter amplitude */
  wind?: THREE.Vector4;
  /** distance in metres past which this instance collapses; 0 = never */
  lod?: number;
  /** bob: amplitude, phase, roll amplitude, unused */
  bob?: THREE.Vector4;
}

/** Accumulates instance transforms; emits one InstancedMesh. */
export class InstSet {
  private mats: THREE.Matrix4[] = [];
  private cols: number[] = [];
  private uvs: number[] = [];
  private winds: number[] = [];
  private lods: number[] = [];
  private bobs: number[] = [];
  /**
   * ==========================================================================
   *  `aTint` AND `aUv` ARE ALWAYS EMITTED, AND THAT IS A BUG FIX, NOT WASTE.
   * ==========================================================================
   *  These two were opt-in: a set that never passed `color` got no `aTint`
   *  attribute at all. But `patchTint`, `patchInstAlpha` and `patchInstUv` are
   *  applied to the MATERIAL, not to the set, and every instanced material in
   *  the library carries at least one of them. When the attribute is missing
   *  WebGL supplies the generic default `(0, 0, 0, 1)`, so:
   *
   *    · `patchTint`      multiplies albedo by (0,0,0) — the mesh renders BLACK
   *    · `patchInstAlpha` multiplies alpha by 0        — the mesh renders NOTHING
   *    · `patchInstUv`    maps every texel to (0,1)    — one flat colour
   *
   *  None of those throws, none of them warns, and all three look like a
   *  content mistake rather than a plumbing one. The kart game avoided it by
   *  convention — every call site passed both — which is exactly the kind of
   *  invariant that survives right up until somebody adds a call site.
   *
   *  `add()` already pushes the identity values (1,1,1) and (1,1,0,0) in the
   *  default case, so defaulting these to true costs 7 floats per instance and
   *  makes the default case CORRECT. `useWind` and `useBob` stay opt-in
   *  because they also decide `isStatic`, which decides batching.
   */
  private useCol = true;
  private useUv = true;
  private useWind = false;
  private useLod = false;
  private useBob = false;
  /** At least one instance asks the material to read a non-identity `aTint`. */
  private tintVaries = false;

  constructor(readonly geo: THREE.BufferGeometry, readonly mat: THREE.Material, readonly name: string) {}

  get count() {
    return this.mats.length;
  }

  /**
   * True when nothing about this set moves after build: no wind sway, no bob.
   * Those two are the only patches that read the instance transform at runtime
   * (`patchWind` needs the instance scale, `patchBob` rotates about the
   * instance origin), so they are the only two that stop a set from being
   * baked flat by `mergeStaticSets`.
   */
  get isStatic(): boolean {
    return !this.useWind && !this.useBob;
  }

  /** Raw per-instance data, for `mergeStaticSets`. */
  snapshot() {
    this.assertTintReader();
    return {
      geo: this.geo, mat: this.mat, name: this.name,
      mats: this.mats, cols: this.cols, uvs: this.uvs, lods: this.lods,
      useCol: this.useCol, useUv: this.useUv, useLod: this.useLod,
    };
  }

  add(m: THREE.Matrix4, o?: InstOpts) {
    this.mats.push(m.clone());
    if (o?.color) {
      this.useCol = true;
      this.cols.push(o.color.r, o.color.g, o.color.b);
      if (o.color.r !== 1 || o.color.g !== 1 || o.color.b !== 1) this.tintVaries = true;
    } else this.cols.push(1, 1, 1);
    if (o?.uv) {
      this.useUv = true;
      this.uvs.push(o.uv.x, o.uv.y, o.uv.z, o.uv.w);
    } else this.uvs.push(1, 1, 0, 0);
    if (o?.wind) {
      this.useWind = true;
      this.winds.push(o.wind.x, o.wind.y, o.wind.z, o.wind.w);
    } else this.winds.push(0, 0, 0, 0);
    if (o?.lod) {
      this.useLod = true;
      this.lods.push(o.lod);
    } else this.lods.push(0);
    if (o?.bob) {
      this.useBob = true;
      this.bobs.push(o.bob.x, o.bob.y, o.bob.z, o.bob.w);
    } else this.bobs.push(0, 0, 0, 0);
  }

  build(castShadow = true, receiveShadow = true): THREE.InstancedMesh | null {
    const n = this.mats.length;
    if (!n) return null;
    this.assertTintReader();
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    mesh.name = this.name;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.mats[i]);
    mesh.instanceMatrix.needsUpdate = true;
    const attr = (arr: number[], size: number, name: string) => mesh.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(arr), size));
    if (this.useCol) attr(this.cols, 3, 'aTint');
    if (this.useUv) attr(this.uvs, 4, 'aUv');
    if (this.useWind) attr(this.winds, 4, 'aWind');
    if (this.useLod) attr(this.lods, 1, 'aLod');
    if (this.useBob) attr(this.bobs, 4, 'aBob');
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    // NOTE: do NOT hang a `depthMaterialFor(this.mat)` here. It looks obviously
    // right — a caster whose vertices are displaced in the colour material
    // wants a depth material that displaces them identically — and it DELETES
    // EVERY SCENERY SHADOW IN THE GAME. `patchLod` collapses an instance to a
    // point beyond its LOD distance, and it measures that distance from the
    // camera being rendered from. In the shadow pass that camera is the light's
    // orthographic shadow camera, which sits far outside the circuit, so every
    // instance reads as maximally distant, every one collapses, and the depth
    // buffer comes back empty. Measured: mean luma of the start-line foreground
    // went 43.3 -> 80.5 as the grandstand shadow over the bottom-left ~55% of
    // the frame simply disappeared. If this is ever attempted again, the LOD
    // uniform has to be fed the MAIN camera position explicitly rather than
    // inheriting the shadow camera's.
    mesh.computeBoundingSphere();
    this.mats = [];
    this.cols = this.uvs = this.winds = this.lods = this.bobs = [];
    this.tintVaries = false;
    return mesh;
  }

  /** Turn the missing shader half into a named boot failure, not flat colour. */
  private assertTintReader(): void {
    if (!this.tintVaries || (this.mat as TintReadableMaterial)[INST_TINT_READER] === true) return;
    const material = this.mat.name ? ` material "${this.mat.name}"` : ' its material';
    throw new Error(
      `@homie-rocks/geom InstSet "${this.name}" supplies non-identity InstOpts.color, but${material} does not read aTint. ` +
      'Apply @homie-rocks/render patchTint (or another registered aTint reader) before build or merge.',
    );
  }
}
