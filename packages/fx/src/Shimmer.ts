import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WHY THE COMMENTS BELOW TALK ABOUT KARTS AND TARMAC.
 * ----------------------------------------------------------------------------
 *  This is the heat-shimmer veil and its two shaders, lifted whole out of the
 *  effects system of the two racing games it came from, where it was
 *  byte-identical in both — 78 lines, `diff` clean, measured 2026-08-20.
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
const _p = new THREE.Vector3();

// ===========================================================================
//  Heat shimmer — a warm haze band that hangs over hot tarmac in the middle
//  distance. Without access to the post chain we cannot refract, so this
//  deliberately stays a low-amplitude scattering veil rather than pretending.
// ===========================================================================

const SHIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHIM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform vec3 uColor;
uniform float uGain;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  if (uAmount <= 0.001) discard;
  // vertical wobble of the sample point is what sells "rising air"
  float wob = vnoise(vec2(vUv.x * 9.0, uTime * 0.9)) - 0.5;
  vec2 q = vec2(vUv.x * 14.0 - uTime * 0.35, vUv.y * 4.0 + wob * 0.7 - uTime * 1.25);
  float n = vnoise(q) * 0.65 + vnoise(q * 2.3 + 5.0) * 0.35;
  float band = smoothstep(0.0, 0.30, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  float a = uAmount * band * edge * smoothstep(0.42, 0.85, n);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * uGain, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Shimmer {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.PlaneGeometry(70, 4.5, 1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmount: { value: 0 },
        uColor: { value: new THREE.Color(0xffd2a0) }, uGain: { value: 1 },
      },
      vertexShader: SHIM_VERT, fragmentShader: SHIM_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx-shimmer';
    this.mesh.renderOrder = 13;
    this.mesh.frustumCulled = false;
  }

  place(pos: THREE.Vector3, faceDir: THREE.Vector3, amount: number, time: number, gain: number) {
    this.mesh.position.copy(pos);
    _p.copy(pos).sub(faceDir);
    this.mesh.lookAt(_p);
    this.material.uniforms.uAmount!.value = amount;
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uGain!.value = gain;
    this.mesh.visible = amount > 0.002;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
