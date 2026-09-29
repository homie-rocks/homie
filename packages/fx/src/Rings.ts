import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WHY THE COMMENTS BELOW TALK ABOUT KARTS AND TARMAC.
 * ----------------------------------------------------------------------------
 *  This is the shockwave-ring pool and its two shaders, lifted whole out of the
 *  effects system of the two racing games it came from, where it was
 *  byte-identical in both — 205 lines, `diff` clean, measured 2026-08-20.
 *
 *  Every comment travelled with the constant it justifies, unedited, including
 *  the ones that cite a kart, a road or a chase camera. Those are not
 *  vocabulary, they are the MEASUREMENT that sized the number beside them, and
 *  `Trails.ts` in this package records what happens when a worked example is
 *  "tidied up" out of a shared file: the next person re-derives the constant
 *  from nothing and the effect quietly changes in two games at once.
 *
 *  WHAT DID NOT COME WITH IT. The emitters did not. Nothing in this file knows
 *  what a race, a track, an item or a match is, and it must not learn — a game
 *  context object crossing this seam is the failure mode to avoid. It knows a
 *  position, a normal, a colour and a time, and the game decides all four.
 * ----------------------------------------------------------------------------
 */

// --- module-scope scratch: the hot path allocates nothing --------------------
const _n = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// ===========================================================================
//  Shockwave rings — instanced, simulated entirely in the vertex shader.
// ===========================================================================

const RING_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aCen;   // xyz centre, w birth
attribute vec4 aRad;   // x r0, y r1, z life, w thickness (0..1 of radius)
attribute vec4 aQuat;  // orientation, maps +Y to the surface normal
attribute vec4 aCol;   // rgb, a peak intensity
attribute vec4 aDrift; // xyz centre velocity, w drag (1/s)
varying vec3 vCol;
varying float vA;
varying float vR;
varying float vViewZ;

vec3 rotq(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  float age = uTime - aCen.w;
  float u = age / max(aRad.z, 1e-4);
  if (age < 0.0 || u >= 1.0) {
    vCol = vec3(0.0); vA = 0.0; vR = 0.0; vViewZ = 1.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Ease-out expansion: a shockwave is fastest the instant it is born.
  float e = 1.0 - pow(1.0 - u, 2.8);
  float R = mix(aRad.x, aRad.y, e);
  float rr = mix(R * (1.0 - aRad.w), R, uv.x);
  // The centre may travel. A ring fired off a kart at 25 m/s that stays pinned
  // to the world is 7 m adrift by the time it fades, which is exactly why the
  // drift ring reads as a hoop lying on empty tarmac instead of as feedback
  // attached to the car.
  float k = max(aDrift.w, 1e-3);
  vec3 centre = aCen.xyz + aDrift.xyz * (1.0 - exp(-k * age)) / k;
  vec3 wp = centre + rotq(aQuat, vec3(position.x * rr, 0.0, position.z * rr));
  vCol = aCol.rgb;
  vA = aCol.a * (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.10, u);
  vR = uv.x;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const RING_FRAG = /* glsl */ `
uniform float uGain;
#ifdef SOFT_DEPTH
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uCamPlanes;
uniform float uSoft;
#endif
varying vec3 vCol;
varying float vA;
varying float vR;
varying float vViewZ;
void main() {
  // Two-lobe radial profile across the annulus: a narrow bright band riding a
  // wide soft body, reaching exactly zero at BOTH rims. The old sin^2 was
  // effectively a fat plateau — with an additive colour authored above 1.0 it
  // saturated across most of its width, and a saturated band with a fast
  // shoulder is indistinguishable from an opaque matte torus. This keeps a
  // legible core while spending most of the annulus in visible falloff.
  float e = sin(vR * 3.14159265);
  float a = vA * (0.34 * pow(e, 1.7) + 0.66 * pow(e, 5.5));
#ifdef SOFT_DEPTH
  // Depth fade. A shockwave punched out of a kart necessarily intersects the
  // kart; without this it terminates on a hard curve exactly where it enters
  // the bodywork, which is the "welded plastic prop" read.
  float d = texture2D(uDepth, gl_FragCoord.xy * uInvRes).x;
  float nz = uCamPlanes.x, fz = uCamPlanes.y;
  float sceneZ = (2.0 * nz * fz) / (fz + nz - (d * 2.0 - 1.0) * (fz - nz));
  a *= clamp((sceneZ - vViewZ) / uSoft, 0.0, 1.0);
#endif
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * uGain, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Rings {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly buf: THREE.InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private head = 0;
  private used = 0;
  private liveUntil = -1;

  static readonly STRIDE = 20;

  constructor(readonly capacity: number, segments = 64) {
    const pos = new Float32Array((segments + 1) * 2 * 3);
    const uv = new Float32Array((segments + 1) * 2 * 2);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        pos[o] = cx; pos[o + 1] = 0; pos[o + 2] = cz;
        uv[(i * 2 + k) * 2] = k;          // 0 = inner rim, 1 = outer rim
        uv[(i * 2 + k) * 2 + 1] = i / segments;
      }
    }
    const idx = new Uint16Array(segments * 6);
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      idx[i * 6] = a; idx[i * 6 + 1] = a + 1; idx[i * 6 + 2] = a + 2;
      idx[i * 6 + 3] = a + 1; idx[i * 6 + 4] = a + 3; idx[i * 6 + 5] = a + 2;
    }

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.data = new Float32Array(capacity * Rings.STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, Rings.STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const names = ['aCen', 'aRad', 'aQuat', 'aCol', 'aDrift'];
    for (let i = 0; i < names.length; i++) {
      this.geo.setAttribute(names[i]!, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4));
    }
    this.geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uGain: { value: 1 },
        uDepth: { value: null },
        uInvRes: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
        uCamPlanes: { value: new THREE.Vector2(0.2, 3000) },
        // ~0.7 m of intersection distance: long enough to swallow a wheel or a
        // roll bar, short enough that a ring against the road still reads.
        uSoft: { value: 0.7 },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'fx-rings';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 12;
  }

  set gain(v: number) { this.material.uniforms.uGain!.value = v; }

  resize(w: number, h: number) { this.material.uniforms.uInvRes!.value.set(1 / w, 1 / h); }

  setDepthTexture(tex: THREE.Texture | null, near: number, far: number) {
    const m = this.material;
    const had = m.defines.SOFT_DEPTH !== undefined;
    const want = !!tex;
    m.uniforms.uDepth!.value = tex;
    m.uniforms.uCamPlanes!.value.set(near, far);
    if (want !== had) {
      if (want) m.defines.SOFT_DEPTH = ''; else delete m.defines.SOFT_DEPTH;
      m.needsUpdate = true;
    }
  }

  /**
   * `drift` (optional) is the velocity the ring's centre inherits, decayed by
   * `driftDrag`. Pass the emitting vehicle's velocity and the ring stays with the
   * car instead of being left behind on the road.
   */
  spawn(p: THREE.Vector3, normal: THREE.Vector3, r0: number, r1: number, life: number,
        thickness: number, color: THREE.Color, intensity: number, now: number,
        drift: THREE.Vector3 | null = null, driftDrag = 0.9) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.used < this.capacity) this.used++;
    const o = i * Rings.STRIDE;
    const d = this.data;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = now;
    d[o + 4] = r0; d[o + 5] = r1; d[o + 6] = life; d[o + 7] = thickness;
    _quat.setFromUnitVectors(UP, _n.copy(normal).normalize());
    d[o + 8] = _quat.x; d[o + 9] = _quat.y; d[o + 10] = _quat.z; d[o + 11] = _quat.w;
    d[o + 12] = color.r * intensity; d[o + 13] = color.g * intensity; d[o + 14] = color.b * intensity;
    d[o + 15] = 1;
    d[o + 16] = drift ? drift.x : 0;
    d[o + 17] = drift ? drift.y : 0;
    d[o + 18] = drift ? drift.z : 0;
    d[o + 19] = driftDrag;
    this.buf.needsUpdate = true;
    if (now + life > this.liveUntil) this.liveUntil = now + life;
  }

  update(now: number) {
    this.material.uniforms.uTime!.value = now;
    this.geo.instanceCount = now > this.liveUntil ? 0 : this.used;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
