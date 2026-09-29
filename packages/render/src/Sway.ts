import * as THREE from 'three';

/*
 * ============================================================================
 *  Sway — wind, as an injection into somebody else's vertex shader.
 * ============================================================================
 *
 *  ## The absence this fills, in the words of the game that found it
 *
 *  A rainforest game's report named four things the engine packages did not
 *  have. Two of them are `@homie-rocks/fx/Shafts.js` and
 *  `@homie-rocks/fx/Haze.js`. This is the third: "NO
 *  WIND SYSTEM — sway is author-injected as a shader hack per material, in
 *  every game that has foliage."
 *
 *  It was written TWICE INSIDE ONE GAME before it was written here. That game's
 *  crown module sways the crown and its forest-floor module sways the floor,
 *  and the two are the same forty lines with eleven different numbers — same
 *  chained `onBeforeCompile`, same three uniforms, same instance-origin hash,
 *  same vertical falloff, same two sines on world x and z, same wet-leaf term
 *  in the fragment. Neither imported the other.
 *
 *  ## WHY IT IS AN INJECTION AND NOT A MATERIAL
 *
 *  Foliage wants everything `MeshStandardMaterial` already does — shadows, IBL,
 *  the whole lighting path — plus one term. Writing a ShaderMaterial to get that
 *  term means reimplementing the lighting, so instead this splices into three's
 *  own chunks: `<begin_vertex>` for the bend and `<color_fragment>` for the wet.
 *  That is the same seam `FoliageSSS.ts` and `umbra.ts` use and the same rules
 *  apply — CHAIN, never overwrite, because a material can carry three of these
 *  and the last one to assign `onBeforeCompile` would otherwise silently delete
 *  the other two. The previous hook is called first, and the cache key is
 *  APPENDED to whatever was already there rather than replacing it: two
 *  materials that differ only by an injection must not share a compiled program.
 *
 *  ## WHY THE BEND IS A HASH OF THE INSTANCE ORIGIN
 *
 *  `instanceMatrix[3].xyz` is where this instance stands, and dotting it with an
 *  arbitrary vector turns a position into a phase. That gets three things at
 *  once and no CPU cost: every plant moves differently, a plant moves the SAME
 *  way every frame (so a held frame is the same bytes twice), and neighbours get
 *  NEARBY phases — which is what makes a crown read as one gust crossing it
 *  rather than as a hundred unrelated flickers. A random per-instance attribute
 *  gets the first two and loses the third, and the third is the whole effect.
 *
 *  ## WHAT IS MECHANISM AND WHAT IS A FOREST
 *
 *   · MECHANISM, and it is all that is here: the chain, the uniforms, the hash,
 *     the falloff shape, the two-harmonic bend, and the wet term's shape.
 *   · CONTENT, and none of it has a default: which axis the plant grows along,
 *     how fast the wind is, how much the tip moves relative to the base, how
 *     much a soaked leaf darkens and which green it goes. `uSway` itself is a
 *     uniform the game writes every frame from its own weather.
 *
 *  A tree crown and a floor fern are the same mechanism at 0.08 and 0.04 — the
 *  forest-floor module's own comment says why: the wind reaches the forest
 *  floor attenuated by the layers above it — and that sentence is a fact about
 *  a rainforest, so it stays in the rainforest.
 *
 *  ## NOTHING HERE HAS A DEFAULT, FOR THE REASON Shafts.ts GIVES
 *
 *  Every constant is written into the generated GLSL from the spec. A tuned
 *  number living here would hand the next game this forest's wind while every
 *  parity check stayed green.
 * ============================================================================
 */

/** GLSL needs `1.0`, not `1`. */
function f(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`sway: ${n} is not a finite number`);
  if (Number.isInteger(n)) return `${n}.0`;
  const s = String(n);
  if (s.includes('e') || s.includes('E')) return n.toFixed(9).replace(/0+$/, '0');
  return s;
}

/**
 * How much of the bend a vertex gets, from `clamp((position.<axis> + add) *
 * scale, 0, 1)`.
 *
 * THE AXIS IS NOT A CONSTANT AND THIS IS THE FIELD THAT PROVES IT. A leaf card
 * built lying along its own +X and a fern frond built standing up its own +Y
 * need the same falloff measured on different axes, and the rainforest game
 * needs both in one game. A package that picked one would silently shear
 * whichever plant was built the other way — the base would move as much as the
 * tip, which reads as the whole plant sliding off its own stem.
 */
export interface SwayFalloff {
  axis: 'x' | 'y' | 'z';
  add: number;
  scale: number;
}

/** One harmonic: `fn(uTime * rate + phase * phaseScale) * amp * gain`. */
export interface SwayHarmonic {
  rate: number;
  phaseScale: number;
  gain: number;
}

/** The fragment half: what water does to a leaf. Null compiles none of it. */
export interface WetLeaf {
  /** diffuse is multiplied by `1 - uWet * darken`. */
  darken: number;
  /** and then mixed that far toward `diffuse * tint`. */
  tint: readonly [number, number, number];
  amount: number;
}

export interface SwaySpec {
  /** dotted with the instance origin to turn a place into a phase. */
  phase: readonly [number, number, number];
  falloff: SwayFalloff;
  /** `uSway * (base + t * tip)`, where t is the falloff. */
  base: number;
  tip: number;
  /** the slow one, on world x. */
  x: SwayHarmonic;
  /** the faster gust harmonic, on world z. */
  z: SwayHarmonic;
  wet: WetLeaf | null;
  /**
   * Appended to the material's program cache key. Two materials differing only
   * by this injection must not share a compiled program, and three has no way
   * to know they differ — the spec is not visible to it.
   */
  key: string;
}

export interface SwayHandles {
  uTime: THREE.IUniform<number>;
  /** how hard the wind is blowing, right now. The game's whole say. */
  uSway: THREE.IUniform<number>;
  uWet: THREE.IUniform<number>;
}

/**
 * `* 1.0` IS NOT EMITTED, and that is not cosmetics.
 *
 * A generator that writes every factor unconditionally produces `phase * 1.0`
 * and `* swayAmp * 1.0` for the common case, which a compiler folds away and a
 * READER does not: the next person to open the composed source sees arithmetic
 * that looks deliberate and goes looking for the scale it is compensating for.
 * Generated code is still code somebody reads.
 */
const unit = (n: number): string => (n === 1 ? '' : ` * ${f(n)}`);

/** The `<begin_vertex>` insert, generated. Exported so a probe can read it. */
export function swayVertexChunk(spec: SwaySpec): string {
  const { falloff: fo, x, z } = spec;
  return /* glsl */ `
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float phase = dot(instancePos, vec3(${f(spec.phase[0])}, ${f(spec.phase[1])}, ${f(spec.phase[2])}));
        float swayT = clamp((position.${fo.axis} + ${f(fo.add)}) * ${f(fo.scale)}, 0.0, 1.0);
        float swayAmp = uSway * (${f(spec.base)} + swayT * ${f(spec.tip)});
        transformed.x += sin(uTime * ${f(x.rate)} + phase${unit(x.phaseScale)}) * swayAmp${unit(x.gain)};
        transformed.z += cos(uTime * ${f(z.rate)} + phase${unit(z.phaseScale)}) * swayAmp${unit(z.gain)};
`;
}

/** The `<color_fragment>` insert, generated. Empty when `wet` is null. */
export function wetFragmentChunk(spec: SwaySpec): string {
  const w = spec.wet;
  if (w === null) return '';
  return /* glsl */ `
        diffuseColor.rgb *= (1.0 - uWet * ${f(w.darken)});
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(${f(w.tint[0])}, ${f(w.tint[1])}, ${f(w.tint[2])}), uWet * ${f(w.amount)});
`;
}

/**
 * Splice wind into a material, chaining whatever was already there.
 *
 * Returns the three uniforms so the game can drive them. They are plain objects
 * shared BY REFERENCE into `shader.uniforms` — writing `.value` after the
 * program has compiled is what makes this cost nothing per frame.
 */
export function addFoliageSway(material: THREE.Material, spec: SwaySpec): SwayHandles {
  const uTime: THREE.IUniform<number> = { value: 0 };
  const uSway: THREE.IUniform<number> = { value: 0 };
  const uWet: THREE.IUniform<number> = { value: 0 };

  const prevOBC = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prevOBC?.call(material, shader, renderer);
    shader.uniforms.uTime = uTime;
    shader.uniforms.uSway = uSway;
    shader.uniforms.uWet = uWet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uSway;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>${swayVertexChunk(spec)}`,
      );
    if (spec.wet !== null) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>${wetFragmentChunk(spec)}`,
        );
    }
  };
  material.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(material) + spec.key
      : () => spec.key;

  return { uTime, uSway, uWet };
}
