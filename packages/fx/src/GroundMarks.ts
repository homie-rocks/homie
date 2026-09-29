/**
 * ============================================================================
 *  GroundMarks — an instanced ring of terrain-aligned multiply decals.
 * ============================================================================
 *  Boot prints, tyre tracks, drag smudges: a mark laid flat on a surface,
 *  oriented to that surface's normal, that DARKENS whatever it lands on and
 *  fades on its own clock. One instanced draw whatever the population, and a
 *  laid mark costs the CPU nothing after the frame it was laid — the fragment
 *  shader reads a per-instance birth time and retires the quad itself.
 *
 *  ── WHY MULTIPLY, NOT ALPHA ────────────────────────────────────────────────
 *  A mark darkens the surface it is on, so it reads correctly on raw ground, on
 *  a sintered pad and on tarmac with no per-surface tinting, and it can never
 *  look like black paint floating over a bright surface. Disturbed ground is
 *  genuinely darker than undisturbed, so the multiply is also the physically
 *  honest operator.
 *
 *  A MULTIPLIER IS A RATIO, NOT A COLOUR, and `tint` is the factor the ground is
 *  scaled BY — 1.0 leaves it untouched. `new THREE.Color(hex)` decodes sRGB into
 *  the linear working space, so a hex that looks like "dark dirt" arrives at the
 *  shader as a sixth of its value and the mark becomes an ink blot. A 20%
 *  darkening is a NEAR-WHITE hex. It looks wrong written down and is right.
 *  This is why `tint` is required with no default: the number is a game's
 *  palette quotient and handing one game another's is invisible until someone
 *  photographs it.
 *
 *  ── WHY IT IS NOT `Decals.ts`, THE OTHER DECAL POOL IN THIS PACKAGE ────────
 *  `Decals` is an INTERLEAVED-VERTEX ring: it writes four world-space corners
 *  per mark into one big non-instanced buffer, which is what a SKID needs
 *  because consecutive quads have to be stitched corner-to-corner along a
 *  moving wheel with no seam. Its per-mark channels are tint and strength, and
 *  its atlas is procedural (`coreDecalTiles`).
 *
 *  This one is INSTANCED with a per-instance MATRIX: one quad, one basis built
 *  from a surface normal, one atlas cell. That is what a FOOTFALL needs — a
 *  discrete mark at a place, with a rotation, on a slope. Neither can be built
 *  from the other without writing the other's whole hot path back on top: a
 *  stitched ribbon has no per-mark basis, and a per-mark basis cannot stitch.
 *  They sit side by side for the same reason `@homie-rocks/render`'s
 *  `cascade.ts` and `cascadederiv.ts` do, and this paragraph is here so nobody
 *  re-derives it.
 *
 *  ── THE ATLAS IS THE CALLER'S ─────────────────────────────────────────────
 *  A sole pattern, a tread pitch and a smudge grain are ART. The texture comes
 *  in through the constructor and the tile count with it, so a game paints its
 *  own marks and this file never knows what shape they are.
 *
 *  NO BACKTICKS inside any /* glsl *\/ template literal below.
 * ============================================================================
 */
import * as THREE from 'three';

export const MARK_VERT = /* glsl */ `
attribute vec3 aDec;      // x tile col, y tile row, z birth
uniform vec2 uTiles;      // atlas dimensions, cells
varying vec2 vUv;
varying float vBirth;
void main() {
  // A 2% inset per cell: without it, mip levels bleed one tile into its
  // neighbour and every mark grows a grey halo at distance.
  vUv = (uv * 0.96 + 0.02 + vec2(aDec.x, aDec.y)) / uTiles;
  vBirth = aDec.z;
  #ifdef USE_INSTANCING
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const MARK_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uLife;
uniform vec3 uTint;
varying vec2 vUv;
varying float vBirth;
void main() {
  if (vBirth <= 0.0) discard;
  float age = (uTime - vBirth) / uLife;
  if (age < 0.0 || age >= 1.0) discard;
  float m = texture2D(uAtlas, vUv).a;
  if (m < 0.01) discard;
  // fade in over the first moment so a mark does not pop, then hold, then
  // thin out rather than uniformly ghosting away
  float a = m * smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.72, 1.0, age));
  // 1.0 leaves the surface untouched; uTint darkens it.
  gl_FragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);
}
`;

/** Every field required — see the header on `tint`. */
export interface GroundMarkSpec {
  /** seconds a mark survives before it has fully faded */
  life: number;
  /** the MULTIPLY factor, as a hex three decodes to linear. Near-white is a
   *  gentle darkening; a "dark dirt" hex is an ink blot. */
  tint: number;
  /** atlas grid, cells across and down */
  tilesX: number;
  tilesY: number;
  /** three sorts the transparent list by this. See the note in the constructor. */
  renderOrder: number;
}

/** The surface a mark is laid on: its height and its normal at a point. */
export interface MarkSurface {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: THREE.Vector3): unknown;
}

const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class GroundMarks {
  readonly mesh: THREE.InstancedMesh;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tilesX: number;
  private head = 0;
  private dirty = false;
  private readonly cap: number;

  constructor(cap: number, atlas: THREE.Texture, opts: GroundMarkSpec) {
    this.cap = cap;
    this.tilesX = opts.tilesX;
    // rotateX(+90) lays the plane flat AND maps the texture's +V onto world
    // +Z, so a mark's "forward" is its heading. The face normal ends up
    // pointing down, hence DoubleSide — free on a flat quad, and cheaper than
    // a second rotation.
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uTime: { value: 0 },
        uLife: { value: opts.life },
        uTiles: { value: new THREE.Vector2(opts.tilesX, opts.tilesY) },
        uTint: { value: new THREE.Color(opts.tint) },
      },
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      // See the renderOrder block below — this MUST be true or the mark lands
      // in the opaque list and the terrain paints over it.
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.MultiplyBlending,
      // three refuses MultiplyBlending without this and falls back, which
      // turns every mark into an opaque black rectangle.
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(quad, this.mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // A BUG THAT SHIPPED AND DELETED THIS ENTIRE SUBSYSTEM, kept as a comment
    // because the "fix" is intuitive and wrong.
    //
    // It was `transparent: false` with `renderOrder = -1`, on the reasoning
    // "under everything else that blends". That is exactly backwards. An opaque
    // material goes in three's OPAQUE render list, which is sorted by
    // renderOrder ASCENDING — so -1 drew the marks FIRST, before any terrain.
    // And the material has `depthWrite: false`, so a mark leaves nothing in the
    // depth buffer. Terrain chunks (renderOrder 0, opaque, depthWrite true)
    // then painted straight over every one of them: 1,061 slots holding a live
    // birth timestamp and contributing zero pixels.
    //
    // Transparent list, drawn after the whole opaque pass, still depth-TESTED
    // so a body standing on a mark correctly occludes it. Multiply blending is
    // unaffected by the list it is in. Do not "restore" a negative order.
    this.mesh.renderOrder = opts.renderOrder;
    this.mesh.count = cap;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aDec', this.attr);
    // everything starts with birth 0 -> discarded
    for (let i = 0; i < cap; i++) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
    }
  }

  /**
   * Lay a mark on the surface, aligned to its normal so it does not shear on a
   * slope, and lifted 25 mm along that normal on top of the polygon offset.
   * Belt and braces: a flickering mark in the foreground of a hero frame would
   * be the most visible artefact in a game.
   *
   * @param surfY the height the mark actually sits at, where the caller knows
   *   it better than `surface.heightAt` does — a graded road slab can ride a
   *   metre above the terrain field, and a mark laid at the field's height is
   *   laid UNDER the road and draws nothing.
   */
  lay(
    surface: MarkSurface,
    x: number, z: number, yaw: number,
    w: number, l: number, tile: number, now: number, surfY?: number,
  ) {
    const y = surfY !== undefined && Number.isFinite(surfY) ? surfY : surface.heightAt(x, z);
    surface.normalAt(x, z, _n);
    // basis: up = surface normal, forward = heading projected onto the surface
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    _v.copy(_fwd).addScaledVector(_n, -_n.dot(_fwd));
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1); else _v.normalize();
    _v2.crossVectors(_n, _v).normalize();
    // makeBasis copies out of these vectors, so scaling the scratch in place is
    // safe and there is no allocation anywhere in this path.
    _m.makeBasis(_v2.multiplyScalar(w), _n, _v.multiplyScalar(l));
    _m.setPosition(x + _n.x * 0.025, y + _n.y * 0.025, z + _n.z * 0.025);

    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.mesh.setMatrixAt(i, _m);
    const a = this.attr.array as Float32Array;
    a[i * 3] = tile % this.tilesX;
    a[i * 3 + 1] = Math.floor(tile / this.tilesX);
    a[i * 3 + 2] = now;
    this.dirty = true;
  }

  update(now: number) {
    this.mat.uniforms.uTime!.value = now;
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.attr.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
