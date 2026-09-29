/**
 * ============================================================================
 *  Ballistic — a GPU-integrated particle ring for worlds with no air.
 * ============================================================================
 *  A slot holds a launch point, a launch velocity and four config floats, and
 *  the VERTEX SHADER integrates `p0 + v·t + ½g·t²` every frame. Nothing is ever
 *  written back per instance: `instanceMatrix` stays identity and is uploaded
 *  once, so a live particle costs the CPU exactly nothing after the frame it
 *  was emitted, and a thousand of them cost one draw call and three buffer
 *  uploads on the frames something was actually thrown.
 *
 *  ── WHY THIS IS NOT `@homie-rocks/geom/inst.ts::InstSet`, WHICH IS THE OBVIOUS HOME
 *  `InstSet` is a BUILD-TIME accumulator: hand it a list of matrices and some
 *  channels and it emits one static `InstancedMesh`, once, and is finished. It
 *  has no birth clock and no ring. This is a ring buffer with a per-slot birth
 *  time whose whole point is that the CPU never revisits a slot. Building this
 *  on that means writing the ring, the clock and the upload policy back on top
 *  of it — a shared thing that compiles and quietly makes one caller behave
 *  like another. They live side by side.
 *
 *  ── WHAT THE CALLER OWNS, AND IT IS ALL OF THE LOOK ────────────────────────
 *  Gravity, the two colours, additive or not, base opacity, the fade-in
 *  fraction, the render order, the sprite and the capacity are ALL required
 *  constructor arguments with no defaults. `gravity` especially: it is the one
 *  number that decides whether the arc reads as a moon, a planet or a comet,
 *  and a default here would hand the next game the last game's gravity while
 *  looking completely fine. A test proves a different gravity produces a
 *  different arc.
 *
 *  ── THE ONE RULE THE SHADER ENFORCES ───────────────────────────────────────
 *  THERE IS NO DRAG TERM AND THERE NEVER WILL BE ONE. In vacuum the trajectory
 *  is exactly a parabola and the grain then LANDS on the ground plane it was
 *  thrown from. Any curl, swirl or hang belongs in a different pool — a game
 *  that wants billowing smoke wants `Plumes`, not this. A caller in an
 *  atmosphere is not served by this file and should say so out loud rather than
 *  adding a term here.
 *
 *  NO BACKTICKS BELOW THIS LINE inside any /* glsl *\/ template literal: one
 *  closes the literal mid-document and the module simply stops existing.
 * ============================================================================
 */
import * as THREE from 'three';

export const BALLISTIC_VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aV;
attribute vec4 aCfg;      // x birth, y life, z size, w ground Y

uniform float uTime;
uniform float uG;
varying float vAge;
varying vec2 vUv;
varying float vSeed;

void main() {
  float t = uTime - aCfg.x;
  float life = max(aCfg.y, 0.0001);
  vAge = t / life;
  vUv = uv;
  // hash off the spawn point — cheaper than another attribute and every
  // particle has a unique one by construction
  vSeed = fract(sin(dot(aP0, vec3(12.9898, 78.233, 37.719))) * 43758.5453);

  if (t < 0.0 || vAge >= 1.0) {
    // collapse to a degenerate point OUTSIDE the clip volume. Setting the
    // size to zero still rasterises a sliver on some drivers.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // No drag term, and there never will be one. See the header.
  vec3 p = aP0 + aV * t + vec3(0.0, 0.5 * uG * t * t, 0.0);
  p.y = max(p.y, aCfg.w);

  float size = aCfg.z * (0.75 + 0.55 * vSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = (vSeed - 0.5) * 6.0 + t * (vSeed - 0.5) * 1.4;
  float cr = cos(rot), sr = sin(rot);
  vec2 off = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr);
  mv.xy += off * size;
  gl_Position = projectionMatrix * mv;
}
`;

export const BALLISTIC_FRAG = /* glsl */ `
uniform sampler2D uSprite;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uOpacity;
uniform float uFadeIn;
varying float vAge;
varying vec2 vUv;
varying float vSeed;
#include <common>

void main() {
  float m = texture2D(uSprite, vUv).a;
  if (m < 0.004) discard;
  float fin = smoothstep(0.0, uFadeIn, vAge);
  float fout = 1.0 - smoothstep(0.55, 1.0, vAge);
  float a = m * fin * fout * uOpacity * (0.7 + 0.6 * vSeed);
  if (a < 0.004) discard;
  vec3 col = mix(uColA, uColB, clamp(vAge * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Paint a square alpha mask on a canvas and hand back a texture.
 *
 * MECHANISM ONLY — the painter is the caller's, because a sprite is art. What
 * is here is the canvas, the clear, the `NoColorSpace` (it is a mask, not a
 * colour, and letting three decode it as sRGB lightens every grain) and the
 * upload flag.
 */
export function softSprite(
  size: number,
  draw: (g: CanvasRenderingContext2D, n: number) => void,
): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  draw(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;   // it is a mask, not a colour
  t.needsUpdate = true;
  return t;
}

/** Every field required. See the header on why `gravity` has no default. */
export interface BallisticSpec {
  /** signed world-Y acceleration, m/s². Negative pulls the arc down. */
  gravity: number;
  colA: number;
  colB: number;
  additive: boolean;
  opacity: number;
  /** fraction of a particle's life spent fading in */
  fadeIn: number;
  order: number;
}

export class BallisticSet {
  readonly mesh: THREE.InstancedMesh;
  private readonly p0: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly cfg: THREE.InstancedBufferAttribute;
  private readonly mat: THREE.ShaderMaterial;
  private head = 0;
  private dirty = false;
  private readonly cap: number;

  constructor(cap: number, sprite: THREE.Texture, opts: BallisticSpec) {
    this.cap = cap;
    // A plain PlaneGeometry owned outright. Sharing attribute objects with a
    // second geometry and disposing that one deletes the GPU buffers out from
    // under this mesh — a failure that only shows up after the first upload.
    const geo = new THREE.PlaneGeometry(1, 1);

    this.p0 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.cfg = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    // Everything starts dead: birth 0, life 0 -> vAge is +inf -> discarded.
    this.p0.setUsage(THREE.DynamicDrawUsage);
    this.vel.setUsage(THREE.DynamicDrawUsage);
    this.cfg.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP0', this.p0);
    geo.setAttribute('aV', this.vel);
    geo.setAttribute('aCfg', this.cfg);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uG: { value: opts.gravity },
        uSprite: { value: sprite },
        uColA: { value: new THREE.Color(opts.colA) },
        uColB: { value: new THREE.Color(opts.colB) },
        uOpacity: { value: opts.opacity },
        uFadeIn: { value: opts.fadeIn },
      },
      vertexShader: BALLISTIC_VERT,
      fragmentShader: BALLISTIC_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = opts.order;
    this.mesh.count = cap;
    // The vertex shader integrates world positions directly, so instanceMatrix
    // is left identity and uploaded once. The mesh itself must therefore stay
    // at the origin with an identity transform — add it to a root that never
    // moves.
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  }

  /** Ring-buffer spawn. Zero allocation; a live particle costs the CPU nothing. */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    size: number, life: number, groundY: number, now: number,
  ) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const a3 = i * 3, a4 = i * 4;
    const p = this.p0.array as Float32Array;
    const v = this.vel.array as Float32Array;
    const c = this.cfg.array as Float32Array;
    p[a3] = x; p[a3 + 1] = y; p[a3 + 2] = z;
    v[a3] = vx; v[a3 + 1] = vy; v[a3 + 2] = vz;
    c[a4] = now; c[a4 + 1] = life; c[a4 + 2] = size; c[a4 + 3] = groundY;
    this.dirty = true;
  }

  update(now: number, tint: number) {
    this.mat.uniforms.uTime!.value = now;
    this.mat.uniforms.uOpacity!.value = tint;
    if (this.dirty) {
      this.p0.needsUpdate = true;
      this.vel.needsUpdate = true;
      this.cfg.needsUpdate = true;
      this.dirty = false;
    }
  }

  setBaseOpacity(o: number) { this.mat.uniforms.uOpacity!.value = o; }

  /** Zero every slot. A re-seed must call this, or the last scene's grit rides
   *  into the next one still (measured in one game: combined luma 71 -> 135). */
  clear() {
    (this.cfg.array as Float32Array).fill(0);
    this.head = 0;
    this.dirty = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
