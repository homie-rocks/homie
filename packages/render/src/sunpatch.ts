/**
 * ============================================================================
 *  sunpatch.ts — sun-aligned multiply ground patches. Contact AO, and the
 *  fake cast shadow a figure too small for the cascades never gets.
 * ============================================================================
 *  IMMEDIATE MODE: `begin()`, `push()` per body per frame, `end()`. The count
 *  is rewritten every frame and the basis is built by hand out of the sun's
 *  ground azimuth, so the hot path allocates nothing and does no trig.
 *
 *  ── WHY THIS IS NOT `groundblob.ts::BlobShadows`, ITS OWN SIBLING ─────────
 *  They look like the same thing and they are not, on three axes at once:
 *
 *    · BlobShadows orients each quad from a SURFACE NORMAL handed in per
 *      instance, and lifts along it or along +Y. This orients every quad from
 *      ONE SUN AZIMUTH shared by the whole frame, and stretches it along that
 *      azimuth so the patch merges into the root of the real cast shadow
 *      instead of sitting beside it as a separate ellipse.
 *    · BlobShadows reads a radial SPRITE TEXTURE with a gamma and an inner
 *      radius baked into it at build time. This computes the falloff in the
 *      fragment shader from a per-instance CORE RADIUS, because the core is
 *      what changes between a planted foot and one in mid-flight and baking it
 *      means one texture per strength.
 *    · BlobShadows is albedo-or-additive. This is MULTIPLY, and multiply is
 *      not a mode you can add to it: a multiply layer can only ever DARKEN,
 *      which is why it composites correctly over raw ground, a sintered pad
 *      and tarmac with no per-surface tinting, and why the usual "paint it a
 *      diagnostic colour" ablation LIES about it (see the tint note below).
 *
 *  Folding either into the other means carrying the other's whole basis and
 *  falloff behind a flag, which compiles and quietly gives one game the other's
 *  grounding. They sit side by side, like `cascade.ts` and `cascadederiv.ts`.
 *
 *  ── WHY A GAME NEEDS THIS AT ALL, MEASURED ────────────────────────────────
 *  A directional sun's cascades cannot hold a small figure. Measured on a
 *  base-building game's street pose with 40/140/480/1800 m cascades at 2048
 *  texels — 0.07/0.23/0.88 m per texel — a 1.73 m robot's 0.35 m shadow is a
 *  texel and a half in cascade 2 before the normal-offset bias erodes it, and
 *  does not exist at all in cascade 3. A 50 m rocket survives that and a person
 *  does not, which reads as "hard mast shadows striping the road and seven
 *  figures standing in them casting nothing". Ablating `castShadow` across the
 *  whole population moved that frame 0.84 code values against a 0.37 noise
 *  floor; across all 758 casters, 7.44. It is a RESOLUTION problem, not a flag
 *  bug, and this layer is the third grounding cue that survives it.
 *
 *  ── THE TINT IS THE CALLER'S, AND SO IS EVERY SIZE ────────────────────────
 *  `tint` is required with no default. An AO term tinted neutral black reads as
 *  a hole punched in the frame rather than as occlusion; the right value is in
 *  the game's own fill family, and handing one game another's is invisible
 *  until someone photographs it.
 *
 *  IF YOU NEED TO CHECK THIS LAYER IS ALIVE: set `blending: NoBlending` for one
 *  capture. DO NOT set a brighter tint. A red multiply over a dark road gives a
 *  near-black indistinguishable from the shadow it sits in, and that instrument
 *  has already nearly retired a working layer once.
 *
 *  NO BACKTICKS inside any /* glsl *\/ template literal below.
 * ============================================================================
 */
import * as THREE from 'three';

export const SUNPATCH_VERT = /* glsl */ `
attribute vec2 aCon;      // x strength, y core radius 0..1
varying vec2 vUv;
varying vec2 vCon;
void main() {
  vUv = uv;
  vCon = aCon;
  #ifdef USE_INSTANCING
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SUNPATCH_FRAG = /* glsl */ `
uniform vec3 uTint;
varying vec2 vUv;
varying vec2 vCon;
void main() {
  // Radial falloff with a solid core. A pure gaussian reads as a smudge; the
  // core is what says "this object is touching here".
  //
  // THE PER-INSTANCE STRENGTH (vCon.x) MUST BE FOLDED IN HERE. This line once
  // read "times 1.0", so every patch drew at full occlusion regardless of what
  // the caller asked for and a foot in mid-flight blacked the ground as hard as
  // a planted one. It turned every agent's patch into an opaque disc.
  vec2 d = (vUv - 0.5) * 2.0;
  float r = length(d);
  float a = (1.0 - smoothstep(vCon.y, 1.0, r)) * clamp(vCon.x, 0.0, 1.0);
  if (a < 0.004) discard;
  // 1.0 leaves the surface untouched, uTint darkens it — the same operator a
  // ground-mark layer uses, so a mark inside a patch compounds correctly.
  gl_FragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);
}
`;

const _m = new THREE.Matrix4();

export interface SunPatchSpec {
  /** the MULTIPLY factor. In the fill's colour family, never neutral black. */
  tint: number;
  /** three sorts the transparent list by this. Put it under the mark layer. */
  renderOrder: number;
  /**
   * Full-extent multiplier on `push`'s half-width ALONG the sun azimuth. The
   * cross-azimuth extent is fixed at `2 * w`, so this is `2 * the aspect ratio`
   * and 2.0 is a circle. It is written as one multiplier rather than as an
   * aspect times two so the arithmetic is the single product the callers'
   * baseline computed, bit for bit.
   */
  alongScale: number;
}

export class SunPatches {
  readonly mesh: THREE.InstancedMesh;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly along: number;
  private n = 0;
  private readonly cap: number;
  /** Unit vector along the ground in the sun's azimuth, for the stretch. */
  private sx = 0;
  private sz = 1;

  constructor(cap: number, opts: SunPatchSpec) {
    this.cap = cap;
    this.along = opts.alongScale;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(opts.tint) } },
      vertexShader: SUNPATCH_VERT,
      fragmentShader: SUNPATCH_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // MULTIPLY. NormalBlending with the fragment's hard-coded alpha of 1.0
      // does not darken the ground: it REPLACES it, so the falloff paints a
      // white ring around a tinted core instead of an occlusion gradient.
      // `premultipliedAlpha` is required with MultiplyBlending — three falls
      // back without it and the patch becomes a black rectangle.
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -12,
    });
    this.mesh = new THREE.InstancedMesh(quad, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = opts.renderOrder;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aCon', this.attr);
  }

  /** Sun azimuth as a ground direction. Call once per frame, before begin(). */
  setSun(dirX: number, dirZ: number) {
    const l = Math.hypot(dirX, dirZ);
    if (l > 1e-4) { this.sx = dirX / l; this.sz = dirZ / l; }
  }

  begin() { this.n = 0; }

  /**
   * A CAST-SHADOW STREAK, laid down-sun from a body — as opposed to `push`,
   * which is the contact AO directly under it. Size and aim it from the real
   * sun: length = height * cot(elevation), pointing down the ground azimuth,
   * fading out as the sun sets, because at night there is no key to cast one.
   *
   * @param offset how far down-sun the ELLIPSE CENTRE sits, metres
   * @param halfL  half its length along the sun azimuth, metres
   */
  pushDir(
    x: number, y: number, z: number,
    halfW: number, halfL: number, offset: number, str: number, core: number,
  ) {
    if (this.n >= this.cap || str <= 0.004) return;
    const cx = x + this.sx * offset;
    const cz = z + this.sz * offset;
    // Same hand-built basis as `push` — X across the sun azimuth, Z along it —
    // but with the two half-extents given independently instead of a fixed
    // ratio. No allocation and no trig: the azimuth is already a unit vector.
    _m.set(
      this.sz * halfW * 2, 0, this.sx * halfL * 2, cx,
      0, 1, 0, y,
      -this.sx * halfW * 2, 0, this.sz * halfL * 2, cz,
      0, 0, 0, 1,
    );
    this.mesh.setMatrixAt(this.n, _m);
    const a = this.attr.array as Float32Array;
    a[this.n * 2] = str;
    a[this.n * 2 + 1] = core;
    this.n++;
  }

  /**
   * @param w    contact half-width, metres (the patch is 2w across)
   * @param str  0..1 darkening strength
   * @param core 0..1 fraction of the radius held at full strength
   */
  push(x: number, y: number, z: number, w: number, str: number, core: number) {
    if (this.n >= this.cap || str <= 0.004) return;
    // Basis: X across the sun azimuth, Z along it and `alongScale/2` times
    // longer. Built by hand rather than through a quaternion so there is no
    // allocation and no trig in the hot path — the azimuth is already a unit
    // vector.
    _m.set(
      this.sz * w * 2, 0, this.sx * w * this.along, x,
      0, 1, 0, y,
      -this.sx * w * 2, 0, this.sz * w * this.along, z,
      0, 0, 0, 1,
    );
    this.mesh.setMatrixAt(this.n, _m);
    const a = this.attr.array as Float32Array;
    a[this.n * 2] = str;
    a[this.n * 2 + 1] = core;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
