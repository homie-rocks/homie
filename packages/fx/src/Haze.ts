import * as THREE from 'three';

/*
 * ============================================================================
 *  Haze — a lying-down sheet of drifting noise, for air that is thicker in
 *  some places than others.
 * ============================================================================
 *
 *  The other half of the absence `Shafts.ts` names. A shaft is what a light
 *  does to dirty air; this is the dirt. Two games had written it twice,
 *  sharing no line, and one of them had already worked out in its own header
 *  why neither could use `@homie-rocks/fx`'s pools:
 *
 *    "@homie-rocks/fx is the particle and impact library: pools, bursts, sparks,
 *     debris, an emitter with a lifetime. All of it is about a thing that
 *     HAPPENS, with a birth and a death and a budget... Mist has no events in
 *     it. It is a field that is thicker in some places, and the cheapest honest
 *     expression of that is one plane and a noise function."
 *
 *  That is exactly right and it is the specification. This is that plane, with
 *  the noise function and the three windows that stop it looking like a plane,
 *  and it lives in the same package because a field with no events is still an
 *  effect — the sentence above is an argument against `ConePools`, not against
 *  `@homie-rocks/fx`.
 *
 *  ## WHY THIS IS NOT `Shafts.ts`, WHICH IS NOT AN OVERSIGHT
 *
 *  Same refusal shape as solveTyre / solveAxle, and it is worth being exact
 *  about because both files are "additive-ish geometry standing in for air":
 *
 *    · A SHAFT'S ALPHA FALLS WITH DISTANCE FROM ITS OWN AXIS, and it is aimed at
 *      a light. A SHEET'S ALPHA RISES WITH DISTANCE FROM THE CAMERA, and it is
 *      aimed at nothing at all — it is horizontal in world space forever.
 *    · A shaft is driven by where the sun is. A sheet is driven by how cold it
 *      is. One game's mist gathers through the night and is gone within a
 *      minute of the sun clearing the ridge; there is no direction anywhere in
 *      that.
 *
 *  A shared body would give a shaft that dissolves at its own source and a sheet
 *  with a bright core, and both games would compile and pass.
 *
 *  ## THE THREE WINDOWS, WHICH ARE WHAT MAKES IT NOT LOOK LIKE A QUAD
 *
 *  1. THE DISTANCE WINDOW, and its direction is a real decision rather than a
 *     sign to get right. Seen from above and near, a mist plane is a grey lid;
 *     seen edge-on across a valley it is what mist looks like. So one game
 *     fades its 760 m plane IN with distance and another fades its 120 m disc
 *     OUT — opposite ramps, same `smoothstep(a, b, d)` with a and b swapped,
 *     because one sheet is scenery a long way off and the other is the air the
 *     camera is standing in. Both are expressible and neither is a default.
 *  2. THE NEAR WINDOW. Optional, and only the sheet the camera can walk into
 *     needs it: without it the eye ends up inside the plane and the frame goes
 *     flat grey in one step.
 *  3. THE EDGE WINDOW. Optional. A sheet whose distance window does not reach
 *     its own rim shows a hard square at the horizon.
 *
 *  ## TWO NOISE STACKINGS, AND THEY ARE NOT THE SAME MATHS
 *
 *  `fbm` is a self-similar cascade: one domain, one lacunarity, halving weights,
 *  written as the loop so the frequency accumulates by repeated multiply exactly
 *  as it always has. `layers` is a handful of INDEPENDENT sheets at unrelated
 *  frequencies drifting in unrelated directions, which is what you write when
 *  you want two weathers crossing rather than one weather with detail — one
 *  layer scrolling is a moving texture, two is weather. Neither is expressible
 *  as the other, so both are here and the game says which.
 *
 *  ## NOTHING HERE HAS A DEFAULT
 *
 *  As in `Shafts.ts`: every constant is baked into the generated GLSL from the
 *  spec, so a tuned number cannot cross into the package and hand the next game
 *  this game's weather while parity stays green.
 *
 *  ## WHAT THIS DOES NOT KNOW
 *
 *  What the weather is, what time it is, whether it is a lake or a forest floor,
 *  and what makes the air thick. It knows an amount, a tint and a time, and the
 *  game writes all three.
 * ============================================================================
 */

/** A self-similar cascade. `p *= lacunarity; a *= gain;` per octave. */
export interface HazeFbm {
  kind: 'fbm';
  octaves: number;
  lacunarity: number;
  gain: number;
  /** starting weight. */
  amp: number;
  /** domain scroll, in domain units per second, applied once before the loop. */
  drift: readonly [number, number];
}

/** Independent sheets at unrelated frequencies and unrelated drifts. */
export interface HazeLayers {
  kind: 'layers';
  entries: readonly {
    freq: number;
    weight: number;
    drift: readonly [number, number];
  }[];
}

export type HazeNoise = HazeFbm | HazeLayers;

/** What the noise value is put through before it becomes an alpha. */
export type HazeShape =
  /** `n * n` — leaves a long thin tail, so most of the sheet is nearly clear. */
  | { kind: 'square' }
  /** `smoothstep(lo, hi, n)` — a band, so the sheet has an edge and a body. */
  | { kind: 'band'; lo: number; hi: number };

/** `smoothstep(from, to, d)`. `from > to` is a fade OUT and is not a mistake. */
export interface HazeWindow { from: number; to: number }

export interface HazeSpec {
  /** side length of the square sheet, world units. */
  size: number;
  /** height above the world origin. */
  height: number;
  /** the noise domain: the sheet's own uv, or world x/z at this scale. World is
   *  what you want when the sheet has to stay still as the camera moves. */
  domain: { kind: 'uv'; scale: number } | { kind: 'world'; scale: number };
  noise: HazeNoise;
  shape: HazeShape;
  /** how the distance from the camera is measured. `depth` is view-space z,
   *  which is what a sheet seen across a valley wants; `ground` is the
   *  horizontal distance, which is what a sheet the camera stands in wants,
   *  because view depth would fade the mist at the eye's own feet. */
  metric: 'depth' | 'ground';
  far: HazeWindow;
  near: HazeWindow | null;
  /** fade the rim, measured on the sheet's own uv. */
  edge: HazeWindow | null;
  /** final alpha multiplier. */
  opacity: number;
  /** blend the tint toward a second colour the game writes — a sun, a horizon.
   *  Null compiles no second colour and no uniform for it. */
  warm: number | null;
  /**
   * Emit `<tonemapping_fragment>` and `<colorspace_fragment>`.
   *
   * NOT A STYLE FLAG AND NOT A DEFAULT. It answers "is this sheet drawn into
   * the buffer a person looks at, or into a linear HDR target a post chain will
   * tone-map afterwards?" — and the two games that arrived here answered it
   * differently, in the same codebase, with the same post chain shape.
   * Including them twice crushes the sheet's own highlights before the chain
   * ever sees it; omitting them when nothing else will convert leaves it sitting
   * in linear space over an sRGB frame. Whoever owns the chain owns this.
   */
  tonemap: boolean;
  side: THREE.Side;
  renderOrder: number;
  name: string;
}

/** Shared with Shafts.ts's formatter's job: GLSL needs `18.0`, not `18`. */
function f(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`haze: ${n} is not a finite number`);
  if (Number.isInteger(n)) return `${n}.0`;
  const s = String(n);
  if (s.includes('e') || s.includes('E')) return n.toFixed(9).replace(/0+$/, '0');
  return s;
}

export function hazeVertex(spec: HazeSpec): string {
  const world = spec.domain.kind === 'world';
  return /* glsl */ `
varying vec2 vUv;
${world ? 'varying vec3 vWorld;' : ''}
${spec.metric === 'depth' ? 'varying float vDepth;' : ''}
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
${world ? '  vWorld = wp.xyz;' : ''}
  vec4 mv = viewMatrix * wp;
${spec.metric === 'depth' ? '  vDepth = -mv.z;' : ''}
  gl_Position = projectionMatrix * mv;
}
`;
}

export function hazeFragment(spec: HazeSpec): string {
  const { domain, noise, shape, metric } = spec;
  const world = domain.kind === 'world';
  const body: string[] = [];

  const base = world
    ? `vWorld.xz * ${f(domain.scale)}`
    : `vUv * ${f(domain.scale)}`;

  if (noise.kind === 'fbm') {
    body.push(`  vec2 p = ${base} + vec2(uTime * ${f(noise.drift[0])}, uTime * ${f(noise.drift[1])});`);
    body.push(`  float n = 0.0, amp = ${f(noise.amp)};`);
    body.push(`  for (int i = 0; i < ${noise.octaves}; i++) {`);
    body.push(`    n += amp * vnoise(p); p *= ${f(noise.lacunarity)}; amp *= ${f(noise.gain)};`);
    body.push('  }');
  } else {
    if (noise.entries.length === 0) throw new Error('haze: a layer stack with no layers');
    body.push('  float n = 0.0;');
    noise.entries.forEach((e, i) => {
      body.push(`  vec2 p${i} = ${base} * ${f(e.freq)}`
        + ` + vec2(uTime * ${f(e.drift[0])}, uTime * ${f(e.drift[1])});`);
      body.push(`  n += vnoise(p${i}) * ${f(e.weight)};`);
    });
  }

  body.push(shape.kind === 'square'
    ? '  n = n * n;'
    : `  n = smoothstep(${f(shape.lo)}, ${f(shape.hi)}, n);`);

  const d = metric === 'depth' ? 'vDepth' : 'length(vWorld.xz - uCam.xz)';
  body.push(`  float d = ${d};`);
  body.push(`  float a = n * uAmount * smoothstep(${f(spec.far.from)}, ${f(spec.far.to)}, d);`);
  if (spec.near !== null) {
    body.push(`  a *= smoothstep(${f(spec.near.from)}, ${f(spec.near.to)}, d);`);
  }
  if (spec.edge !== null) {
    body.push('  vec2 c = abs(vUv - 0.5) * 2.0;');
    body.push(`  a *= 1.0 - smoothstep(${f(spec.edge.from)}, ${f(spec.edge.to)}, max(c.x, c.y));`);
  }
  body.push(spec.warm !== null
    ? `  vec3 tint = mix(uTint, uWarm, ${f(spec.warm)});`
    : '  vec3 tint = uTint;');
  body.push(`  gl_FragColor = vec4(tint, a * ${f(spec.opacity)});`);

  // The world path needs the camera position; the depth path already has it in
  // the varying, and declaring an unused uniform is a uniform somebody will
  // later believe is read.
  const needsCam = metric === 'ground';
  return /* glsl */ `
precision mediump float;
uniform float uTime;
uniform float uAmount;
uniform vec3 uTint;
${spec.warm !== null ? 'uniform vec3 uWarm;' : ''}
${needsCam ? 'uniform vec3 uCam;' : ''}
varying vec2 vUv;
${world ? 'varying vec3 vWorld;' : ''}
${metric === 'depth' ? 'varying float vDepth;' : ''}

// Value noise on a 2-D lattice, with the hash every sheet in this repository
// was already using. Three or four octaves is the ceiling that earns its
// bandwidth: these planes are hundreds of metres across and seen almost
// edge-on, so anything finer is below one pixel.
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), fr = fract(p);
  fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), fr.x),
             mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), fr.x), fr.y);
}

void main() {
  if (uAmount <= 0.002) discard;
${body.join('\n')}
${spec.tonemap ? '  #include <tonemapping_fragment>\n  #include <colorspace_fragment>' : ''}
}
`;
}

/**
 * One horizontal sheet. The game owns where it sits, how much of it there is
 * and what colour it is; this owns the plane, the noise and the three windows.
 */
export class HazeSheet {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly spec: HazeSpec) {
    const geo = new THREE.PlaneGeometry(spec.size, spec.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    };
    if (spec.warm !== null) uniforms.uWarm = { value: new THREE.Color(1, 1, 1) };
    if (spec.metric === 'ground') uniforms.uCam = { value: new THREE.Vector3() };
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      // A sheet of air occludes nothing. Depth TEST stays on so a ridge in front
      // of it still hides it.
      depthWrite: false,
      side: spec.side,
      uniforms,
      vertexShader: hazeVertex(spec),
      fragmentShader: hazeFragment(spec),
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = spec.name;
    mesh.position.y = spec.height;
    // A world this size is a handful of draw calls; culling one of them is a
    // risk rather than a saving, and a sheet the camera is inside is exactly
    // the case a bounding box gets wrong.
    mesh.frustumCulled = false;
    mesh.renderOrder = spec.renderOrder;
    this.mesh = mesh;
  }

  set time(v: number) { this.material.uniforms.uTime!.value = v; }
  /** 0..1: how much sheet there is at all. Below 0.002 nothing is drawn. */
  set amount(v: number) { this.material.uniforms.uAmount!.value = v; }
  get tint(): THREE.Color { return this.material.uniforms.uTint!.value as THREE.Color; }
  /** The second colour, when the spec asked for one. */
  get warm(): THREE.Color { return this.material.uniforms.uWarm!.value as THREE.Color; }
  /** Only read when the spec measures distance along the ground. */
  get camera(): THREE.Vector3 { return this.material.uniforms.uCam!.value as THREE.Vector3; }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
