/**
 * ============================================================================
 *  probeblend — cross-fade pre-baked PMREM environment probes without ever
 *  re-baking one.
 * ============================================================================
 *
 * PUBLISHED FROM A SPACE RACER, NOT DE-DUPLICATED. The kart racer bakes ONE
 * probe and has nothing to cross-fade; nothing was removed from a second copy.
 * It is here because it is the good half of a genuinely good sky, and the next
 * room that wants a day that turns into a night — or a doorway between an
 * interior and an exterior, which is the same problem — should not have to
 * rediscover why the two obvious implementations are both wrong.
 *
 * ## The idea, which is the whole reason this is worth publishing
 *
 * You have N environment probes baked at N moments (lit, eclipse, terminator,
 * indoors) and you want the one the scene is lit by to move continuously
 * between them. The two things everybody tries first:
 *
 *  · **Switch probes.** It pops, and it pops on the one frame that must not —
 *    the moment the light is changing, which is the moment anybody is looking.
 *  · **Re-bake per frame.** A cube render plus a PMREM chain, every frame,
 *    costs more than an ambient-occlusion pass. It is not a rounding error.
 *
 * What is cheap AND exact is blending the PMREM OUTPUT. The generator's layout
 * is a 2D atlas of pre-convolved mips, so a per-texel lerp of two atlases is a
 * per-mip lerp of two convolutions — and convolution being linear, that IS the
 * convolution of the blend. It is not an approximation of the right answer, it
 * is the right answer, for one ~256x1000 blit: no chain, no cube, no probe
 * rebuild.
 *
 * ## THE TARGET HAS TO BE BYTE-FOR-BYTE THE SHAPE PMREM PRODUCED
 *
 * This is the trap, and it is the quiet kind. three derives
 * `CUBEUV_TEXEL_WIDTH`, `CUBEUV_TEXEL_HEIGHT` and `CUBEUV_MAX_MIP` from
 * `envMap.image.height`, and takes the CubeUV sampling path purely from
 * `texture.mapping`. Get either wrong and every metal and every clearcoat in
 * the scene samples an atlas with the wrong mip layout — which renders, throws
 * nothing, and looks like a subtle roughness bug that is not one. So `ensure()`
 * takes the SOURCE probe and copies its shape rather than accepting a size, and
 * re-makes the target if the source ever changes shape under it.
 *
 * ## What is here and what is the caller's
 *
 * THE WEIGHTS ARE THE CALLER'S, and that is the seam. Which probe a game wants
 * at a given moment is the whole of its own art direction — the space racer
 * drives
 * ECLIPSE off a baked solar channel so it agrees with the key light to the
 * frame, TERMINATOR off two windows in lap position, and FOUNDRY off an
 * interior volume. None of that could mean anything in another game. This
 * package is handed a weight per probe and never asks where they came from.
 *
 * What IS here is everything that is a property of the MECHANISM: picking the
 * two that matter, the target's shape, the blit, and the cache.
 *
 * `MIX_EPSILON` stays here for the same reason. A quarter of a percent of blend
 * is below the noise floor of a half-float atlas, so re-blitting for it is pure
 * bandwidth — that is a fact about the FORMAT, not a look, and a caller handed a
 * knob there would be tuning the definition of "the same picture".
 * ============================================================================
 */
import * as THREE from 'three';

const BLEND_FRAGMENT = /* glsl */`
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
varying vec2 vUv;

// -- THE NON-FINITE SCRUB. A GUARD, NOT A NICETY. ----------------------------
// PROMOTED FROM A GAME'S OWN COPY, AND IT CLOSES A LIVE LATENT BUG IN
// THE VERSION THAT WAS HERE. This shader used to be a plain mix() of two taps.
//
//   scene.environment is the ONLY lighting term every opaque material shares,
//   so ONE non-finite texel in the atlas propagates through getIBLIrradiance
//   into totalDiffuse and outgoingLight is NaN for the whole surface. The
//   frame issues a full complement of draw calls into a picture that is
//   uniformly black and does not respond to sun intensity, emissive, exposure
//   or tone mapping — every ablation reads identical, which is what makes it
//   so expensive to find. Draw calls are not proof of rendering.
//
// TWO faults are closed here, and the second is the one a plain mix() cannot
// survive:
//
//  1. Non-finite texels. The comparison is written as a RELATIONAL test
//     against a finite bound rather than the idiomatic self-compare
//     (x != x): a self-compare is the one NaN test a compiler is entitled to
//     fold to a constant, and ANGLE/SwiftShader does exactly that — an
//     in-shader (v.x == v.x) probe reported one game's atlas CLEAN while a
//     Float32 read-back found 27,603 non-finite channels in it. Anything
//     measuring this must use a relational test or a CPU-side read-back.
//
//  2. mix() AT WEIGHT ZERO. GLSL mix is a * (1-t) + b * t, and NaN * 0.0 is
//     NaN — so a non-finite texel in the probe carrying ZERO weight still
//     lands in the output. Scrubbing BOTH taps BEFORE the lerp is what makes
//     the unused probe genuinely unused. Any rig that cross-fades four probes
//     has three unused ones on almost every frame.
//
// A game whose probes are provably clean pays two lessThan() and a max() for
// this, per texel of one ~256x1000 blit that mostly does not run. A game whose
// probes are not gets a picture instead of a black screen it cannot explain.
// The producer-side scrub is still the one that matters and it belongs to the
// game that renders the faces; this is the second of two.
vec3 pbFinite( vec3 v ) {
	bvec3 ok = lessThan( abs( v ), vec3( 60000.0 ) );
	return vec3( ok.x ? v.x : 0.0, ok.y ? v.y : 0.0, ok.z ? v.z : 0.0 );
}

void main() {
	vec3 a = pbFinite( texture2D( uA, vUv ).rgb );
	vec3 b = pbFinite( texture2D( uB, vUv ).rgb );
	// max() against zero as well: a negative radiance in a probe SUBTRACTS light
	// from every surface that samples it, which is the same class of silent
	// failure one shade less severe.
	gl_FragColor = vec4( max( mix( a, b, uMix ), vec3( 0.0 ) ), 1.0 );
}
`;

const BLEND_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/**
 * Below this much change in the mix, the blit is skipped.
 *
 * A property of a half-float atlas, not a look. See the header.
 */
const MIX_EPSILON = 0.0025;

/** Which two probes carry the frame, and how far between them it sits. */
export interface ProbePair {
  /** index of the strongest probe */
  a: number;
  /** index of the second strongest */
  b: number;
  /** 0 = entirely `a`, 1 = entirely `b` */
  mix: number;
}

/**
 * The two strongest weights, in order, and the mix between them.
 *
 * TWO, NOT N, AND THAT IS A DESIGN DECISION RATHER THAN A SHORTCUT. A blend of
 * three probes needs two blits or a three-tap shader, and the situation never
 * arises in a rig whose probes are moments in TIME: they are mutually exclusive
 * by construction, and the overlaps are pairwise. The space racer's four have
 * at most two carrying meaningful weight at any point on the lap — the
 * terminator is inside the first four seconds of the eclipse and nowhere else.
 *
 * If a rig ever genuinely needs three, this returning the two strongest is
 * WRONG for it rather than merely approximate, and it should say so loudly
 * instead of quietly dropping the third. That is why this is a named function
 * with this comment on it and not four lines inlined in a blit.
 *
 * `mix` is 0 when both weights are ~0, which is the only degenerate case: with
 * nothing lit, `a` is whatever index came first and the frame gets it whole,
 * which is the same picture either way.
 */
export function pickTwo(w: readonly number[]): ProbePair {
  let a = 0, b = 0;
  for (let i = 1; i < w.length; i++) if (w[i]! > w[a]!) a = i;
  b = a === 0 ? 1 : 0;
  for (let i = 0; i < w.length; i++) if (i !== a && w[i]! > w[b]!) b = i;
  const mix = w[a]! + w[b]! > 1e-5 ? w[b]! / (w[a]! + w[b]!) : 0;
  return { a, b, mix };
}

/**
 * One scene's blended environment probe: a render target, the quad that writes
 * it, and the cache that keeps a lap spent in daylight down to one blit.
 *
 * ONE PER SCENE. It owns GPU resources and `dispose()` is not optional.
 */
export class ProbeBlend {
  private rt: THREE.WebGLRenderTarget | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private lastA = -1;
  private lastB = -1;
  private lastMix = -1;

  /**
   * @param name stamped on the target's texture and the material, so a
   *   frame-debugger's capture names the thing a person is looking for rather
   *   than "RenderTarget 14".
   */
  constructor(private readonly name = 'ProbeBlend') {}

  /** The blended texture, or null before `ensure()`. Hand this to `scene.environment`. */
  get texture(): THREE.Texture | null {
    return this.rt ? this.rt.texture : null;
  }

  /**
   * The target itself, or null before `ensure()`.
   *
   * Exposed for ONE reason: a forensic read-back. A non-finite texel in this
   * atlas blacks a whole frame while every draw call still issues, and the only
   * honest way to answer "is there one" is to read the bits back on the CPU —
   * see `@homie-rocks/diagnostics/HalfFloat.js`, and the note on the blend shader
   * above for why the in-shader test is not an answer. Nothing should render
   * INTO this; the blit is `write()`'s.
   */
  get target(): THREE.WebGLRenderTarget | null {
    return this.rt;
  }

  /**
   * Build (or rebuild) the target to match `src`'s shape, and return its texture.
   *
   * Idempotent while the source keeps its shape, so it is safe to call from a
   * probe rebake. It also RESETS the cache, because the probes it is about to
   * blend are new objects whose content has nothing to do with the pair the
   * cache remembers — a cache of a fact that has been replaced is the classic
   * stale-cache failure.
   *
   * @param src any one of the probes this will blend. Only its SHAPE is read.
   */
  ensure(src: THREE.WebGLRenderTarget): THREE.Texture {
    if (this.rt && (this.rt.width !== src.width || this.rt.height !== src.height)) {
      this.rt.dispose();
      this.rt = null;
    }
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(src.width, src.height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.rt.texture.name = this.name;
      this.rt.texture.mapping = THREE.CubeUVReflectionMapping;
      this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    if (!this.material) {
      this.material = new THREE.ShaderMaterial({
        name: this.name,
        uniforms: {
          uA: { value: null },
          uB: { value: null },
          uMix: { value: 0 },
        },
        vertexShader: BLEND_VERTEX,
        fragmentShader: BLEND_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    this.lastA = -1;
    this.lastB = -1;
    this.lastMix = -1;
    return this.rt.texture;
  }

  /**
   * Blit `ta`/`tb` into the target at `pair.mix`, unless nothing moved.
   *
   * @param force write even if the pair and the mix are unchanged. The caller
   *   wants this on the first frame after `ensure()`, which renders before any
   *   blend has run and would otherwise sample a target that is still black.
   * @returns whether it actually wrote. Reported rather than swallowed so a
   *   caller can count blits; a silent skip and a silent failure must not read
   *   the same.
   */
  write(
    renderer: THREE.WebGLRenderer,
    ta: THREE.Texture,
    tb: THREE.Texture,
    pair: ProbePair,
    force: boolean,
  ): boolean {
    if (!this.rt || !this.material || !this.scene || !this.camera) return false;
    if (!force && pair.a === this.lastA && pair.b === this.lastB
      && Math.abs(pair.mix - this.lastMix) < MIX_EPSILON) return false;
    this.lastA = pair.a;
    this.lastB = pair.b;
    this.lastMix = pair.mix;

    this.material.uniforms.uA!.value = ta;
    this.material.uniforms.uB!.value = tb;
    this.material.uniforms.uMix!.value = pair.mix;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    return true;
  }

  dispose(): void {
    this.rt?.dispose();
    this.material?.dispose();
    this.rt = null;
    this.material = null;
    this.scene = null;
    this.camera = null;
    this.lastA = -1;
    this.lastB = -1;
    this.lastMix = -1;
  }
}
