import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  A FIELD OF ELLIPSOID SHELLS, ONE DRAW, WITH A GROUND PLANE PER INSTANCE.
 * ----------------------------------------------------------------------------
 *  The pooled instanced half of any "bubble around a body" effect — a shield, a
 *  containment field, a bloom envelope, a spawn cocoon. Lifted out of a space
 *  racer's effects code, where it was the `Shields` class.
 *
 *  It carries two per-instance vec4s and nothing else:
 *
 *    `aShell`  x = intensity 0..1, y = a one-shot 0..1 (a break, a hit, a pop),
 *              z = a stable per-instance seed, w = free.
 *    `aPlane`  xyz = a unit normal, w = the plane constant, i.e. the surface the
 *              shell should dissolve into instead of cutting a hard ellipse
 *              across it.
 *
 *  WHAT THIS FILE MUST NEVER LEARN. Both shaders, the colour, the render order
 *  and the mesh name are the caller's, because the SHAPE is shared and the LOOK
 *  is not: a hex-lattice fresnel rim and a soft refractive bubble are two
 *  effects that happen to be drawn on the same 320 triangles. Nothing here knows
 *  what a ship, a hull, a deck or a hit point is.
 *
 *  Three decisions travelled with the code, because each one is a measurement:
 *
 *  · **Detail 2, not 3.** The shell is a rim under a procedural grid and its
 *    silhouette is an ellipse; 320 triangles resolve that exactly and 1,280
 *    resolve it identically for four times the vertex cost across the field.
 *
 *  · **A plain `BufferGeometry` carrying instanced attributes, NOT an
 *    `InstancedBufferGeometry`.** `InstancedMesh` already supplies `count` and
 *    `instanceMatrix`; wrapping the geometry as well gives two sources of truth
 *    for the instance count, and the per-attribute divisor is carried by the
 *    attribute rather than by the geometry.
 *
 *  · **The plane is seeded far away, not at the origin.** An instance whose
 *    caller never supplied a surface is simply not faded, rather than silently
 *    invisible — the failure that reports nothing is the one to design out.
 * ----------------------------------------------------------------------------
 */

const _m4 = new THREE.Matrix4();

export interface ShellFieldSpec {
  /** Both halves of the look. The caller declares `aShell` and `aPlane`. */
  material: THREE.ShaderMaterial;
  name: string;
  renderOrder: number;
  /** Icosahedron subdivision. 2 unless something is genuinely bigger on screen. */
  detail?: number;
  /** Where an unsupplied plane sits, along +Y. Far enough that nothing fades. */
  planeAway?: number;
}

export class ShellField {
  readonly mesh: THREE.InstancedMesh;
  private readonly shell: THREE.InstancedBufferAttribute;
  private readonly plane: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  /**
   * Resolved ONCE, and it throws here rather than defaulting at write time.
   * A shell whose material declares no `uTime` is a shader that cannot animate
   * and no gain governor can reach; failing on the frame the field is built is
   * how that surfaces as a bug instead of as a still, over-bright bubble.
   */
  private readonly uTime: THREE.IUniform;
  private readonly uGain: THREE.IUniform;
  private readonly away: number;
  private n = 0;

  constructor(readonly capacity: number, spec: ShellFieldSpec) {
    this.away = spec.planeAway ?? 1000;
    const geo = new THREE.IcosahedronGeometry(1, spec.detail ?? 2);
    this.shell = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.shell.setUsage(THREE.DynamicDrawUsage);
    this.plane = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.plane.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) this.plane.setXYZW(i, 0, 1, 0, this.away);
    geo.setAttribute('aShell', this.shell);
    geo.setAttribute('aPlane', this.plane);
    // The shells move every frame and their bounds are the field's, not the
    // mesh's; frustum culling is off, so this only has to be non-null.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = spec.material;
    const uT = this.material.uniforms.uTime, uG = this.material.uniforms.uGain;
    if (!uT || !uG) throw new Error('ShellField: material must declare uTime and uGain');
    this.uTime = uT;
    this.uGain = uG;
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = spec.renderOrder;
    this.mesh.count = 0;
    this.mesh.name = spec.name;
  }

  begin() { this.n = 0; }

  /**
   * `intensity` 0..1 is the shell's presence and `pulse` 0..1 a one-shot. The
   * ellipsoid half-extents are the caller's: they must clear whatever is inside.
   *
   * `planeN`/`planeP` are the surface this shell dissolves into — its normal and
   * any point on it. Passing the live probe's normal rather than world up is
   * what keeps this correct through bank and through an inverted section, where
   * the surface legitimately faces down. A degenerate normal is not an error: it
   * means there is no surface here, and the shell is simply not faded.
   */
  add(pos: THREE.Vector3, quat: THREE.Quaternion, half: THREE.Vector3,
      intensity: number, pulse: number, seed: number,
      planeN: THREE.Vector3, planeP: THREE.Vector3) {
    if (this.n >= this.capacity) return;
    _m4.compose(pos, quat, half);
    this.mesh.setMatrixAt(this.n, _m4);
    this.shell.setXYZW(this.n, intensity, pulse, seed, 0);
    const l = Math.hypot(planeN.x, planeN.y, planeN.z);
    if (l > 1e-4) {
      const nx = planeN.x / l, ny = planeN.y / l, nz = planeN.z / l;
      this.plane.setXYZW(this.n, nx, ny, nz,
        -(nx * planeP.x + ny * planeP.y + nz * planeP.z));
    } else {
      this.plane.setXYZW(this.n, 0, 1, 0, this.away);
    }
    this.n++;
  }

  /** Upload, set the count, and write the two uniforms every shell needs. */
  end(time: number, gain: number) {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shell.needsUpdate = true;
    this.plane.needsUpdate = true;
    this.uTime.value = time;
    this.uGain.value = gain;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
