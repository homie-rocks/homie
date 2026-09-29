/**
 * ============================================================================
 *  ConePools — additive ground cones. The pool of light a headlight, a torch
 *  or a landing lamp throws in front of itself.
 * ============================================================================
 *  IMMEDIATE MODE: `begin()`, `push()` per lamp per frame, `end()`. On most
 *  frames of a daylit scene the count is zero and the mesh hides itself, so an
 *  unused pool costs one visibility test.
 *
 *  ── WHY IT IS A FAKE AND WHY THAT IS THE RIGHT ANSWER ─────────────────────
 *  Every emissive strip needs a matching light contribution or it is the
 *  clearest amateur tell in a night scene, and a real point light per lamp is
 *  not affordable: a whole game's `PointLight` budget is single digits. This is
 *  the stand-in — one instanced quad per lamp, additive, with the falloff done
 *  in the fragment shader — and it should be faded out entirely in daylight,
 *  because a visible pool under a full sun is wrong in the other direction.
 *  `EffectLights` in this package is the real-light pool for the handful of
 *  lamps that earn one; the two are meant to be used together.
 *
 *  The pivot is at the quad's NEAR EDGE, so `push`'s position is the lamp, not
 *  the centre of the pool, and `len` grows the cone forward.
 *
 *  The cone is deliberately kept well inside the quad: reaching the edge clips
 *  the falloff and the pool acquires a hard straight side, which reads as a
 *  decal rather than as light.
 *
 *  Colour and intensity are per instance — a game with a warm interior lamp and
 *  a cold exterior one pushes both into the same pool and pays one draw call.
 *
 *  NO BACKTICKS inside any /* glsl *\/ template literal below.
 * ============================================================================
 */
import * as THREE from 'three';

export const CONE_VERT = /* glsl */ `
attribute vec4 aGlow;     // rgb colour, a intensity
varying vec2 vUv;
varying vec4 vGlow;
void main() {
  vUv = uv;
  vGlow = aGlow;
  #ifdef USE_INSTANCING
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CONE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vGlow;
#include <common>
void main() {
  vec2 d = vUv - 0.5;
  // An elongated cone, brightest near the lamp and spreading forward. The
  // lateral term is squared and the cone kept well inside the quad: reaching
  // the quad edge clips the falloff and the pool acquires a hard straight
  // side, which reads as a decal rather than as light.
  float along = clamp(vUv.y, 0.0, 1.0);
  float width = 0.10 + along * 0.27;
  float lat = 1.0 - smoothstep(0.0, width, abs(d.x));
  lat *= lat;
  float lon = (1.0 - smoothstep(0.06, 0.95, along)) * smoothstep(0.0, 0.09, along);
  float a = lat * lon * vGlow.a;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vGlow.rgb * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class ConePools {
  readonly mesh: THREE.InstancedMesh;
  private readonly attr: THREE.InstancedBufferAttribute;
  private n = 0;
  private readonly cap: number;

  /** @param renderOrder three sorts the transparent list by this. Over the
   *  ground marks and contact patches, so a lit road still reads. */
  constructor(cap: number, renderOrder: number) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    quad.translate(0, 0, 0.5);          // pivot at the near edge
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(quad, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aGlow', this.attr);
  }

  begin() { this.n = 0; }

  push(x: number, y: number, z: number, yaw: number, len: number, wide: number, col: THREE.Color, a: number) {
    if (this.n >= this.cap || a <= 0.002) return;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _v.set(x, y, z); _v2.set(wide, 1, len);
    _m.compose(_v, _q, _v2);
    this.mesh.setMatrixAt(this.n, _m);
    const arr = this.attr.array as Float32Array;
    arr[this.n * 4] = col.r; arr[this.n * 4 + 1] = col.g;
    arr[this.n * 4 + 2] = col.b; arr[this.n * 4 + 3] = a;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    // A zero-instance draw call still costs a state change. In full daylight
    // this set is empty on every single frame.
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
