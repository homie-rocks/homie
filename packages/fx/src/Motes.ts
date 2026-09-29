import * as THREE from 'three';

/*
 * ----------------------------------------------------------------------------
 *  WHERE THIS CAME FROM, AND WHAT DELIBERATELY STAYED BEHIND.
 * ----------------------------------------------------------------------------
 *  The near-field mote swarm: a fixed instance count of camera-facing quads,
 *  hashed from a seed, wrapped into a box that follows the camera, drifted and
 *  lit entirely in the vertex shader. One draw, zero CPU per frame, forever.
 *
 *  Lifted out of the effects systems of two racing games, a kart racer and a
 *  space racer, measured 2026-08-20.
 *
 *  WHAT MOVED is the scaffolding, and only the scaffolding: the unit quad, the
 *  seed attribute, the never-cull bounding sphere, the material wiring, the
 *  mesh flags, the four uniforms both games write every frame, and dispose.
 *
 *  WHAT DID NOT MOVE IS THE VERTEX SHADER, AND THAT IS THE POINT OF THIS FILE.
 *
 *  The two vertex shaders are not two tunings of one effect, they are two
 *  effects. The kart racer drifts each mote on three sines and lights it by
 *  forward-scatter against the sun (`pow(dot(vdir, uSunDir), 3.5)`) to read as
 *  haze in a light shaft. The space racer drifts in straight lines on purpose —
 *  its own comment says a sine is an arc and the look does not care that the
 *  amplitude is 70 cm — lights each fleck by a 12th-power specular glint off a
 *  tumbling facet, and STRETCHES the quad along the relative velocity because a
 *  fleck at 150 m/s is a line and not a point.
 *
 *  Merging those needs a mode flag, and a mode flag that changes behaviour is
 *  the exact smell this codebase avoids: near enough to look mergeable, far
 *  enough that merging retunes whichever game did not win, silently, with
 *  nothing going red. So the shader is a CONSTRUCTOR ARGUMENT. Each game keeps
 *  its own, beside the comments that measured it.
 *
 *  THERE IS A THIRD, AND IT IS A THIRD EFFECT AND NOT A THIRD TUNING.
 *
 *  A forest game writes dust-in-the-beam motes, and its own comment calls them
 *  "same class of drift as the kart racer's, tuned for a wetter world". They
 *  are not. Read side by side against the kart racer's, FIVE things differ in
 *  kind rather than in value, and a spec that covered all three would need a
 *  flag for each:
 *
 *    1. THE BILLBOARD FRAME. The kart racer takes camRight/camUp out of
 *       `viewMatrix`'s columns — a true screen-aligned quad that rolls with the
 *       camera. The forest game builds its frame from `cross(worldUp, look)`,
 *       which is cylindrical and deliberately does NOT roll. That game's camera
 *       cranes and rolls; swapping the two changes its picture.
 *    2. THE SCATTER DIRECTION'S SIGN. The kart racer's `vdir` runs camera ->
 *       mote, the forest game's `v` runs mote -> camera. Opposite dots against
 *       the same uSunDir. One of the two may well be wrong and NOTHING HERE CAN
 *       TELL WHICH — that needs a picture, and it is not a merge decision.
 *    3. The kart racer early-outs a dim mote off-screen; the forest game has no
 *       cull.
 *    4. The kart racer scales the quad with distance (`1.0 + dist * 0.06`); the
 *       forest game does not, so its motes shrink with perspective and the kart
 *       racer's hold.
 *    5. `vQ` is `position.xy * 2.0` in the kart racer and `position.xy` in the
 *       forest game, which halves the radius MOTE_FRAG's falloff is measured
 *       over.
 *
 *  So the refusal above stands and now covers three games rather than two. If a
 *  fourth arrives, the thing to publish is probably the WRAP (identical maths in
 *  all three, written three ways) and not the shader.
 *
 *  The fragment shader DID move: it was byte-identical in both, 14 lines.
 *
 *  Three more differences turned out to be values rather than mechanisms, which
 *  is the usual answer — the initial `uColor`, the mesh `name` (`fx-motes` and
 *  `fx-debris` are two DESCRIPTIONS of one pool), and whatever extra uniforms
 *  a game's own shader declares. All three are spec fields.
 *
 *  WHAT THIS FILE MUST NEVER LEARN. Nothing here knows what a race, a lap, a
 *  track or an item is, and no `Ctx` crosses this seam. It knows a count, a
 *  box, a far distance, a camera position, a sun direction and a gain — and the
 *  game decides every one of them. That is what keeps it engine code.
 * ----------------------------------------------------------------------------
 */

/**
 * The fragment half, byte-identical in both games before the move.
 *
 * A soft round falloff on the quad's own `vQ` and an early `discard` — which is
 * what makes a field of a thousand additive quads affordable, because the
 * cheapest blended fragment is the one that never blends.
 */
export const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
varying float vA;
varying vec2 vQ;
void main() {
  float d = length(vQ);
  float a = vA * pow(max(0.0, 1.0 - d), 2.2);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * uGain, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The seven uniforms this file owns and `update()` maintains.
 *
 * Named rather than an index signature, and that is not decoration: under
 * `noUncheckedIndexedAccess` a `Record<string, IUniform>` makes every one of
 * these possibly-undefined at the call site, so the games would have had to
 * cast or `!` their way through a hot path — which is exactly how a real
 * missing uniform stops being a compile error.
 */
export type MoteUniforms = {
  uTime: THREE.IUniform<number>;
  uCam: THREE.IUniform<THREE.Vector3>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uBox: THREE.IUniform<number>;
  uFar: THREE.IUniform<number>;
  uColor: THREE.IUniform<THREE.Color>;
  uGain: THREE.IUniform<number>;
};

/** A game that adds no uniforms of its own. */
export type NoExtraUniforms = Record<never, never>;

/** Everything a game supplies. There are no defaults: see `vertexShader`. */
export interface MoteSpec<X extends Record<string, THREE.IUniform> = NoExtraUniforms> {
  /** Instances. Both callers scale this off particle density and clamp it. */
  count: number;
  /**
   * Half-extent, in metres, of the cube the motes wrap into. The cube is
   * re-centred on the camera every frame inside the shader, so this is the
   * radius of the swarm and not a place in the world.
   */
  box: number;
  /** Distance at which a mote has faded out entirely, in metres. */
  far: number;
  /**
   * THE GAME'S OWN SHADER, AND THERE IS NO DEFAULT ON PURPOSE.
   *
   * Shipping one here would mean the game that did not write it silently gets
   * the other game's drift, lighting and billboard shape. It must declare
   * `aSeed`, write `vA` and `vQ`, and read `uTime`/`uCam`/`uBox`/`uFar` — the
   * contract `MOTE_FRAG` and `update()` are written against.
   */
  vertexShader: string;
  /** Initial `uColor`. A game that re-tints per frame writes `uniforms.uColor`. */
  color: THREE.Color;
  /** `mesh.name`, for the draw-call inspector. A description, not a mechanism. */
  name: string;
  /**
   * Extra uniforms this game's vertex shader declares, e.g. a camera velocity.
   * The type flows through to `MoteField.uniforms`, so a game reads its own
   * additions by name and with their real types.
   */
  uniforms?: X;
  /** Overrides `MOTE_FRAG`. Nothing needs this yet; it exists so a third
   *  consumer does not have to fork the file to get a different falloff. */
  fragmentShader?: string;
}

export class MoteField<X extends Record<string, THREE.IUniform> = NoExtraUniforms> {
  readonly mesh: THREE.Mesh;
  /**
   * Public, and deliberately so. `update()` writes the four uniforms BOTH games
   * wrote every frame; anything a game's own shader adds, that game writes here
   * itself. The alternative was an update signature that is the union of two
   * games' needs, which is how a shared method starts carrying arguments one
   * caller always passes as undefined.
   */
  readonly uniforms: MoteUniforms & X;
  private readonly material: THREE.ShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(spec: MoteSpec<X>) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(spec.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = spec.count;
    // The swarm is re-centred on the camera in the vertex shader, so its real
    // bounds are wherever the camera is. A huge sphere plus `frustumCulled =
    // false` below is the honest way to say "never cull this"; a tight sphere
    // round the origin would pop the whole field out at the first corner.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    // The cast is the spread: TypeScript cannot see that `MoteUniforms` plus
    // the caller's own `X` is `MoteUniforms & X`. The seven names above are
    // spelled out literally, so a typo in one of them is still a compile error.
    this.uniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uBox: { value: spec.box }, uFar: { value: spec.far },
      uColor: { value: spec.color },
      uGain: { value: 1 },
      ...(spec.uniforms ?? ({} as X)),
    } as MoteUniforms & X;

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: spec.vertexShader,
      fragmentShader: spec.fragmentShader ?? MOTE_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = spec.name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 13;
  }

  /** The four uniforms both games wrote on every frame, and nothing else. */
  update(time: number, cam: THREE.Vector3, sunDir: THREE.Vector3, gain: number) {
    const u: MoteUniforms = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(cam);
    u.uSunDir.value.copy(sunDir);
    u.uGain.value = gain;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
