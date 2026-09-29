import * as THREE from 'three';

/*
 * ============================================================================
 *  Shafts — the volume a light occupies in dirty air, as one instanced draw.
 * ============================================================================
 *
 *  ## The absence this fills
 *
 *  A rainforest short found it and said so plainly: there is no volumetric
 *  light-shaft pass in `@homie-rocks/postfx`. Height fog is analytic aerial
 *  perspective, bloom fakes the sun-glare, but there is no way to render actual
 *  light shafts — and three separate games had each written their own
 *  workaround.
 *
 *  Two of those three are this. The third is not, and the refusal is written
 *  down at the bottom of this comment rather than left to be rediscovered.
 *
 *  ## What a shaft is, with nothing in it that names a jungle or a bay
 *
 *  A real light shaft is out-scattering: photons travelling from a source
 *  through a medium, some fraction of them turned toward the eye by whatever is
 *  suspended in the air. Integrating that needs a volumetric pass, and neither
 *  `@homie-rocks/render` nor `@homie-rocks/postfx` has one. What every game
 *  here does instead is draw the SHAPE the scattered light would occupy — a
 *  body extruded along the light direction, unlit, additively blended, writing
 *  no depth — and let the blend do the integrating. It is a proxy, it is cheap,
 *  and it is what the picture wants.
 *
 *  Five things make a convincing one, and all five are numbers:
 *
 *    1. A BODY along the light. Parallel-sided when the source is far enough
 *       away to be a direction (a sun); flared when it is a lamp in the frame.
 *       `ShaftShape.spread` is that difference and nothing else is.
 *    2. A CROSS-SECTION FALLOFF, so the edge is air rather than a polygon.
 *    3. AN ALONG-LENGTH PROFILE: dim where it leaves the occluder, brightest a
 *       little way down, gone before the far end, because it dissipates.
 *    4. A FLUTTER, per body, so several shafts are several draughts and not one
 *       animation played N times.
 *    5. A GAIN the game writes every frame from whatever it thinks controls how
 *       much there is to scatter off.
 *
 *  Terms 2, 3 and 4 are each NULLABLE, and null means the term is not compiled
 *  at all rather than set to a value that happens to be inert. A shaft with all
 *  three null emits `vec4(uColour, uGain)` after tonemapping and colourspace,
 *  which is exactly what `MeshBasicMaterial({ transparent, opacity })` emits —
 *  that is not a coincidence, it is how one game's lamp beam was written and it
 *  is why one class covers both.
 *
 *  ## THE NUMBERS ARE NOT HERE, AND THAT IS THE POINT
 *
 *  Every constant in a shaft — the falloff hardness, where the profile peaks,
 *  the flutter rate, the discard floor, the glow multiplier, the colour — is
 *  baked into the generated GLSL FROM THE SPEC THE GAME PASSES. This package
 *  ships no default for any of them. A colour or a tuned constant that crossed
 *  into here would silently give the next game this game's look while every
 *  parity check stayed green, so there is nothing to inherit: change a number
 *  in the spec and the shader source is a different string.
 *
 *  ## `premultiply`, which is the one non-obvious flag
 *
 *  An additive blend is `src.rgb * src.a + dst`, so the alpha already scales the
 *  contribution once. Multiplying rgb by alpha as well squares the falloff: the
 *  core of the shaft stays bright and the skirt disappears faster than the
 *  geometry does, which is what a shaft in mist looks like. Leaving it off gives
 *  a flat-topped body of light, which is what a lamp beam in heavy fog looks
 *  like. Both are wanted, neither is right, so the game says which.
 *
 *  ## WHAT IS DELIBERATELY NOT MERGED INTO THIS
 *
 *  Two games' ground mist sheets are the third and fourth sightings of "the air
 *  is not empty", and they are NOT shafts. Same refusal shape as `solveTyre` /
 *  `solveAxle`:
 *
 *    · A SHAFT'S ALPHA FALLS WITH DISTANCE FROM ITS AXIS and the body is aimed
 *      at a light. A SHEET'S ALPHA RISES WITH DISTANCE FROM THE CAMERA and it is
 *      aimed at nothing — it is horizontal, and its whole job is to be invisible
 *      near the eye and solid across the valley.
 *    · A shaft is driven by where the sun is. A sheet is driven by how cold it
 *      is; one game's mist gathers all night and burns off within a minute of
 *      sunrise, with no reference to a direction at all.
 *
 *  A shared body would give you a shaft that dissolves at its own source and a
 *  sheet with a bright core, and both games would still compile. They live in
 *  `Haze.ts` beside this file, which is a different mechanism sharing a package,
 *  not the same one sharing a class.
 *
 *  ## WHAT THIS DOES NOT KNOW
 *
 *  Where the light is, what is casting the shadow, what a sun, a lamp, a keeper
 *  or a treetop is, and what the weather is. It knows an origin, a direction, a
 *  gain, a colour and a time. The game decides all five, every frame.
 * ============================================================================
 */

// --- module-scope scratch: the hot path allocates nothing --------------------
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/**
 * The body. `sides === 0` builds a box — four flat faces, three's own
 * `BoxGeometry`, which is what you want for a slab that is thin in one axis and
 * never seen end-on. `sides >= 3` builds a lathe, which is what you want when
 * the shaft can be looked straight down.
 */
export interface ShaftShape {
  /** how far the body runs along the light. Local +Y, near end at the origin. */
  length: number;
  /** full cross-section at the NEAR end — the end at the light. Zero is a point,
   *  which is a lamp you can see. */
  near: number;
  /** full cross-section at the FAR end. Equal to `near` is parallel-sided, which
   *  is what a source distant enough to be a direction gives you; larger flares.
   *  The two together are the whole difference between a sun and a lamp, and
   *  there is no third case. */
  far: number;
  /** the depth axis as a fraction of the width axis. 1 is round or square; less
   *  is a slab, which is what a shaft between two occluders actually is. */
  flatten: number;
  /** 0 for a box; 3 or more for a lathe of that many sides. A box needs
   *  `near === far`, because a box does not flare. */
  sides: number;
  /** leave the caps off. A capped shaft shows a disc when the far end is inside
   *  the frame, and an additive disc is a headlight. */
  openEnded: boolean;
}

/** Term 2. Null compiles no cross-section falloff at all. */
export interface ShaftCross {
  /** how hard the alpha falls away from the axis: `exp(-r*r*soft)`. */
  soft: number;
  /** anisotropy. The depth axis is measured pre-multiplied by this, so a body
   *  that is physically thin still reads as round from an oblique angle. */
  thin: number;
}

/** Term 3. Null compiles no along-length profile at all. */
export interface ShaftProfile {
  /** fade in over [0, rise] of the length. */
  rise: number;
  /** and out over [fallFrom, fallTo]. */
  fallFrom: number;
  fallTo: number;
}

/** Term 4. Null compiles no flutter, and no per-instance phase attribute. */
export interface ShaftFlutter {
  /**
   * The mean, and it is stated rather than derived from `amp`.
   *
   * `1 - amp` is the obvious way to write "peaks at 1" and it is wrong twice
   * over. It bakes a decision the game may not want — a shaft that never quite
   * reaches full is a real look — and, because these numbers are compiled into
   * the shader as literals, `1 - 0.18` emits `0.8200000000000001` where the
   * hand-written shader had `0.82`. A derived constant in generated source is a
   * constant nobody chose.
   */
  base: number;
  /** the sine's amplitude. */
  amp: number;
  /** radians per second. */
  rate: number;
}

export interface ShaftSpec {
  count: number;
  shape: ShaftShape;
  cross: ShaftCross | null;
  profile: ShaftProfile | null;
  flutter: ShaftFlutter | null;
  /** discard below this alpha. 0 compiles no discard. */
  cut: number;
  /** rgb is multiplied by this after the premultiply decision. */
  glow: number;
  /** multiply rgb by alpha as well as letting the blend do it. See the header. */
  premultiply: boolean;
  renderOrder: number;
  name: string;
}

/**
 * GLSL float literals. `18` has to emit `18.0` or the shader will not compile,
 * and `0.003` has to emit `0.003` and not `3e-3`, which GLSL ES 1.00 rejects.
 */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`shaft: ${n} is not a finite number`);
  if (Number.isInteger(n)) return `${n}.0`;
  const s = String(n);
  if (s.includes('e') || s.includes('E')) return n.toFixed(9).replace(/0+$/, '0');
  return s;
}

/**
 * The body geometry, base at the local origin, running to +Y.
 *
 * `CylinderGeometry` and not `ConeGeometry` even when one end is a point: cone
 * is cylinder with `radiusTop = 0`, and going through cylinder is what lets the
 * near end and the far end be sized independently, which is the whole of
 * `spread`. Its radii are named for ITS axis — top is +Y, which is our far end.
 */
export function shaftGeometry(shape: ShaftShape): THREE.BufferGeometry {
  const { length, near, far, flatten, sides, openEnded } = shape;
  let geo: THREE.BufferGeometry;
  if (sides === 0) {
    if (near !== far) throw new Error('shaft: a box body cannot flare; use sides >= 3');
    geo = new THREE.BoxGeometry(near, length, near * flatten);
    geo.translate(0, length * 0.5, 0);
    return geo;
  }
  if (sides < 3) throw new Error(`shaft: ${sides} sides is not a body`);
  // radiusTop is at +Y, which is our FAR end.
  geo = new THREE.CylinderGeometry(far * 0.5, near * 0.5, length, sides, 1, openEnded);
  geo.translate(0, length * 0.5, 0);
  // Only touch the floats when there is something to do: an unconditional
  // scale(1,1,1) rewrites every vertex through a matrix multiply and turns
  // exact values into almost-exact ones.
  if (flatten !== 1) geo.scale(1, 1, flatten);
  return geo;
}

/** The vertex shader. Short, and one line of it is load-bearing. */
export function shaftVertex(spec: ShaftSpec): string {
  const phase = spec.flutter !== null;
  return /* glsl */ `
${phase ? 'attribute float aPhase;' : ''}
${phase ? 'varying float vPhase;' : ''}
varying vec3 vObj;
void main() {
  // OBJECT space, and it stays object space. Every falloff below is measured in
  // the shaft's own frame; instancing must reach gl_Position and nothing else.
  vObj = position;
${phase ? '  vPhase = aPhase;' : ''}
  // instanceMatrix BY HAND. three only applies it inside its own <project_vertex>
  // chunk, so a written-out vertex shader on an InstancedMesh that goes straight
  // to modelViewMatrix draws every instance under the mesh's own transform —
  // superimposed, at the origin, with the whole instance buffer ignored and no
  // error anywhere. A game shipped exactly that for fourteen shafts.
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
}

/**
 * The fragment shader, generated from the spec with every constant BAKED AS A
 * LITERAL. Nothing here is a uniform that a later game could forget to set, and
 * nothing here has a default: two specs that differ by one number are two
 * different strings, which is what makes a welded-shut option impossible to hide.
 */
export function shaftFragment(spec: ShaftSpec): string {
  const f = glslFloat;
  const { shape, cross, profile, flutter } = spec;
  const lines: string[] = [];
  if (cross !== null) {
    lines.push(`  float r = length(vec2(vObj.x, vObj.z * ${f(cross.thin)}));`);
    lines.push(`  float across = exp(-r * r * ${f(cross.soft)});`);
  } else {
    lines.push('  float across = 1.0;');
  }
  if (profile !== null) {
    lines.push(`  float alongT = clamp(vObj.y / ${f(shape.length)}, 0.0, 1.0);`);
    lines.push(`  float along = smoothstep(0.0, ${f(profile.rise)}, alongT)`
      + ` * (1.0 - smoothstep(${f(profile.fallFrom)}, ${f(profile.fallTo)}, alongT));`);
  } else {
    lines.push('  float along = 1.0;');
  }
  if (flutter !== null) {
    lines.push(`  float flutter = ${f(flutter.base)} + ${f(flutter.amp)}`
      + ` * sin(uTime * ${f(flutter.rate)} + vPhase);`);
  } else {
    lines.push('  float flutter = 1.0;');
  }
  lines.push('  float a = across * along * flutter * uGain;');
  if (spec.cut > 0) lines.push(`  if (a < ${f(spec.cut)}) discard;`);
  lines.push(spec.premultiply
    ? `  gl_FragColor = vec4(uColour * a * ${f(spec.glow)}, a);`
    : `  gl_FragColor = vec4(uColour * ${f(spec.glow)}, a);`);
  return /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uGain;
uniform vec3 uColour;
${flutter !== null ? 'varying float vPhase;' : ''}
varying vec3 vObj;
void main() {
${lines.join('\n')}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
}

/**
 * One instanced draw holding every shaft of one light.
 *
 * The game owns the origins and the direction and writes them; this owns the
 * transform maths, the material recipe and the one draw call.
 */
export class ShaftVolume {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  readonly count: number;
  private readonly origins: THREE.Vector3[] = [];
  private readonly phases: Float32Array;

  constructor(readonly spec: ShaftSpec) {
    this.count = spec.count;
    const geo = shaftGeometry(spec.shape);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      // NO DEPTH WRITE, DEPTH TEST ON. A shaft is not a surface, so it must not
      // occlude anything; but a trunk in front of it must occlude the shaft, or
      // the shaft reads as a decal painted on the lens.
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      // Both faces. The camera goes inside these bodies routinely and a
      // back-face cull makes a shaft vanish the moment you walk into it.
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uGain: { value: 0 },
        uColour: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: shaftVertex(spec),
      fragmentShader: shaftFragment(spec),
    });
    this.phases = new Float32Array(spec.count);
    const mesh = new THREE.InstancedMesh(geo, this.material, spec.count);
    mesh.name = spec.name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // A shaft's bounding sphere is a lie the moment it is aimed, and these are
    // a handful of triangles. Culling them is a risk, not a saving.
    mesh.frustumCulled = false;
    mesh.renderOrder = spec.renderOrder;
    if (spec.flutter !== null) {
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.phases, 1));
    }
    for (let i = 0; i < spec.count; i++) this.origins.push(new THREE.Vector3());
    this.mesh = mesh;
  }

  /** Where shaft `i` leaves the occluder. World space. */
  setOrigin(i: number, x: number, y: number, z: number): void {
    this.origins[i]!.set(x, y, z);
  }

  /** Shaft `i`'s flutter phase, in radians. Ignored when flutter is null. */
  setPhase(i: number, radians: number): void {
    if (this.spec.flutter === null) return;
    this.phases[i] = radians;
    (this.mesh.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute)
      .needsUpdate = true;
  }

  /**
   * Point every shaft along `dir` and rewrite the instance matrices.
   *
   * `girth` and `reach` scale the body across and along; both default to 1, and
   * a lamp whose cone opens and closes writes them every frame.
   *
   * setFromUnitVectors AND NOT lookAt. `Object3D.lookAt` resolves the remaining
   * roll against a world up-vector, which is a singularity exactly where a sun
   * shaft is most interesting — straight overhead — and it silently picks a
   * different roll on either side of it. The minimal rotation carrying +Y onto
   * `dir` has no such seam. A body of revolution does not care which roll it
   * gets; a body that is thin in one axis does, and it wants the one that does
   * not snap.
   */
  aim(dir: THREE.Vector3, girth = 1, reach = 1): void {
    if (dir.lengthSq() < 1e-12) return;
    _q.setFromUnitVectors(_up, dir);
    _s.set(girth, reach, girth);
    for (let i = 0; i < this.count; i++) {
      _m.compose(this.origins[i]!, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** How much there is to scatter off, right now. The game's whole say. */
  set gain(v: number) { this.material.uniforms.uGain!.value = v; }
  set time(v: number) { this.material.uniforms.uTime!.value = v; }
  get colour(): THREE.Color { return this.material.uniforms.uColour!.value as THREE.Color; }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
