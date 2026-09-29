/**
 * ============================================================================
 *  Patching what a material sees in its environment probe.
 * ============================================================================
 *  Three exports and the plumbing under them, lifted byte-for-byte out of the
 *  two racing games that had identical copies of all of it.
 *
 *   · `patchEnvRadiance` — the shared machinery for anything that wants to sit
 *     inside `getIBLRadiance`. Read its own comment before writing another
 *     patch; both of the things it exists to get right are silent when wrong.
 *   · `injectEnvGround` — give the probe's lower hemisphere a ground and a
 *     horizon, so a mirror has something to be a mirror OF.
 *   · `injectEnvResponse` — scale and desaturate reflected radiance by
 *     grazing angle.
 *
 *  EVERY NUMBER STAYS WITH THE GAME. What lives here is the mechanism; the
 *  ground colour, the horizon colour, how completely one replaces the other,
 *  the face and graze scales and their chroma are all arguments, and they are
 *  the whole point — the kart racer's lower hemisphere is warm stone bouncing
 *  a golden-hour sun and is the BRIGHTER half, the space racer's is very
 *  nearly black with a cold crescent at the horizon, and that inversion is a
 *  deliberate statement about being over an abyss. Each game's `ENV_GROUND`
 *  therefore stays in that game's own `Materials.ts`, beside the paragraph
 *  explaining it.
 *
 *  `EnvSpecClampOpts` / `injectEnvSpecClamp` are NOT in this file. Only the
 *  space racer had them, and they live in ./EnvSpecClamp.ts, which imports
 *  `patchEnvRadiance` from here — which is why that is exported rather than
 *  private.
 *
 *  `three` is a peerDependency here, as everywhere in this package. Two copies
 *  of three.js is two `instanceof` universes.
 * ============================================================================
 */
import * as THREE from 'three';

export interface EnvGroundOpts {
  /** reflected colour straight down */
  ground: number;
  /** reflected colour just below the horizon line */
  horizon: number;
  /** how completely the ground replaces the probe's lower hemisphere, 0..1 */
  amount: number;
  /** terminator half-width in reflection-vector Y, before the roughness widening */
  soft?: number;
}

/**
 * A ground half and a horizon terminator for the environment probe.
 *
 * The probe is baked from the sky dome alone, so its lower hemisphere is more
 * sky. A mirror with nothing but a smooth gradient to reflect looks matte no
 * matter what its roughness says — that is why a `metalness 1.0, roughness 0.15`
 * roll bar comes out of the frame as a flat pink tube and a `clearcoat 1`
 * bonnet shows one broad diffuse falloff and no horizon line. The material is
 * not the problem; there is nothing in the world for it to reflect.
 *
 * The honest fix is to bake the cube from the real scene, which belongs to the
 * sky system. This is the part that can be done from here: intercept the IBL
 * radiance fetch and mix the lower hemisphere toward a ground value with a
 * *sharp* edge at y = 0. A sharp edge is the whole point — the terminator is
 * the feature. It widens with roughness, so a polished bonnet gets a hard
 * horizon and a satin panel gets a soft one, which is what separates the two
 * materials from each other.
 */
export function injectEnvGround(mat: THREE.Material, o: EnvGroundOpts): void {
  const g = new THREE.Color(o.ground).convertSRGBToLinear();
  const h = new THREE.Color(o.horizon).convertSRGBToLinear();
  patchEnvRadiance(mat, {
    key: `envg${o.ground}_${o.horizon}_${o.amount}_${o.soft ?? 0.035}`,
    decl: 'uniform vec4 uEnvGround;\nuniform vec4 uEnvHorizon;',
    uniforms: {
      uEnvGround: { value: new THREE.Vector4(g.r, g.g, g.b, o.amount) },
      uEnvHorizon: { value: new THREE.Vector4(h.r, h.g, h.b, o.soft ?? 0.035) },
    },
    glsl: /* glsl */ `
			float kBelow = -reflectVec.y;
			float kSoft = uEnvHorizon.w + roughness * 0.65;
			vec3 kGround = mix( uEnvHorizon.rgb, uEnvGround.rgb, smoothstep( 0.0, 0.5, kBelow ) );
			envMapColor.rgb = mix( envMapColor.rgb, kGround,
				smoothstep( -kSoft, kSoft, kBelow ) * uEnvGround.w );`,
  });
}

/**
 * How a specific surface answers the environment probe, as a function of
 * incidence — magnitude AND chroma.
 *
 * Two failures this exists to fix, and they are the same failure seen from
 * opposite ends:
 *
 *  • DRY ASPHALT THAT READS WET. three's split-sum IBL hands a rough dielectric
 *    the whole upper hemisphere, Fresnel-boosted at grazing, with no microfacet
 *    shadowing and no multiple-scattering loss. A racing camera sees the road
 *    at 60–87° of incidence in every pixel of the frame, so that boosted term
 *    is not an edge case, it is the entire road — and because the fetch at high
 *    roughness lands near the top of the mip chain it is not even an image of
 *    the sky, it is the sky's *average*, which is blue. A dark surface with
 *    weak diffuse (a 14° key on a horizontal plane gives N·L ≈ 0.24) plus a
 *    blue hemispherical mirror is exactly the look of a road after rain.
 *    Measured on a hero capture the tarmac ran 55–76% saturation at hue 217–229
 *    — the art direction's `#4a4a52` is 10% saturation. Dry asphalt does keep a
 *    sheen at genuinely shallow incidence and the lighting note asks for it, so
 *    the term is *shaped*, not deleted: near-neutral and heavily damped where
 *    the surface faces the camera, released back to a real reflection in the
 *    last few degrees before grazing.
 *
 *  • LACQUER THAT REPAINTS THE CAR. The same fetch on a `clearcoat 1` panel is
 *    correct in shape and wrong in chroma: reflecting a procedurally saturated
 *    sunset at full chroma over a saturated pigment gives a panel whose hue is
 *    a running average of "roster colour" and "sky", and one that swings with
 *    view angle. That is what reads as iridescence. Keeping the reflection's
 *    LUMINANCE and taking most of its chroma out leaves the lacquer highlight
 *    exactly where it was, the same brightness and the same shape, and lets the
 *    pigment win the hue — which is what a shiny red toy car looks like.
 *
 * Cost: one dot, one pow and two mixes inside `getIBLRadiance`, on the
 * materials that ask for it. No extra texture fetch, no extra pass.
 */
export interface EnvResponseOpts {
  /** radiance multiplier at normal incidence */
  faceScale: number;
  /** radiance multiplier at full grazing */
  grazeScale: number;
  /** chroma kept at normal incidence — 0 = a neutral sheen, 1 = the sky verbatim */
  faceChroma: number;
  /** chroma kept at full grazing */
  grazeChroma: number;
  /** shaping exponent on (1 - N·V); higher = the release happens later */
  power?: number;
}

export function injectEnvResponse(mat: THREE.Material, o: EnvResponseOpts): void {
  const p = o.power ?? 3;
  patchEnvRadiance(mat, {
    key: `envr${o.faceScale}_${o.grazeScale}_${o.faceChroma}_${o.grazeChroma}_${p}`,
    decl: 'uniform vec4 uEnvResp;\nuniform vec2 uEnvRespC;',
    uniforms: {
      uEnvResp: { value: new THREE.Vector4(o.faceScale, o.grazeScale, p, 0) },
      uEnvRespC: { value: new THREE.Vector2(o.faceChroma, o.grazeChroma) },
    },
    glsl: /* glsl */ `
			float kNdV = clamp( dot( normal, viewDir ), 0.0, 1.0 );
			float kGraze = pow( 1.0 - kNdV, uEnvResp.z );
			envMapColor.rgb *= mix( uEnvResp.x, uEnvResp.y, kGraze );
			envMapColor.rgb = mix(
				vec3( dot( envMapColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ),
				envMapColor.rgb,
				mix( uEnvRespC.x, uEnvRespC.y, kGraze ) );`,
  });
}

export interface EnvPatch {
  key: string;
  decl: string;
  glsl: string;
  uniforms: Record<string, THREE.IUniform>;
}

/**
 * Shared plumbing for every patch that wants to sit inside `getIBLRadiance`.
 *
 * Two things it exists to get right, both of which the first version of
 * `injectEnvGround` got wrong and neither of which announces itself:
 *
 * 1. THE RETURN STATEMENT IS NOT STABLE TEXT. The sky system rewrites this same
 *    chunk during its own init to hang a roughness rolloff off the specular
 *    half, so by the time anything here compiles the line reads
 *    `return envMapColor.rgb * envMapIntensity * mix( 1.0, 0.42, ... );`. An
 *    exact-string match against the stock `... * envMapIntensity;` therefore
 *    never fires, the guard takes the early return, and the injection is a
 *    no-op that logs one warning and is never thought about again — the same
 *    class of silent disable that once left the whole post chain off through
 *    four reviews. Match the head of the statement and INSERT ahead of it
 *    instead, so whatever multipliers anyone else has hung off the tail
 *    survive untouched.
 * 2. TWO PATCHES ON ONE MATERIAL MUST NOT FIGHT. Each patch inlines the chunk
 *    in place of `#include <envmap_physical_pars_fragment>`; the second one to
 *    run would find the include already gone and silently do nothing. So the
 *    snippets are accumulated per material and inlined exactly once, in call
 *    order. (The list is captured by closure, not looked up inside the hook, so
 *    a `variant()` clone that inherits the bound hook shares it correctly.)
 */
const _envPatches = new WeakMap<THREE.Material, EnvPatch[]>();
const ENV_INCLUDE = '#include <envmap_physical_pars_fragment>';
/** Head of getIBLRadiance's return, without the tail anyone may have added. */
const ENV_RADIANCE_RETURN = /([ \t]*)return envMapColor\.rgb \* envMapIntensity/;

export function patchEnvRadiance(mat: THREE.Material, patch: EnvPatch): void {
  const existing = _envPatches.get(mat);
  if (existing) { existing.push(patch); return; }
  const list: EnvPatch[] = [patch];
  _envPatches.set(mat, list);

  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;

  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    for (const p of list) {
      // `entries`, not `keys` + index. THE ONLY LINE IN THIS FILE THAT IS NOT
      // BYTE-FOR-BYTE WHAT THE TWO GAMES HAD, and it is a type-level change
      // with no runtime difference at all: `Object.keys` then
      // `p.uniforms[name]` is `IUniform | undefined` under this package's
      // `noUncheckedIndexedAccess`, which the games do not set. Same order,
      // same values, same object identities — the strict base tsconfig is
      // deliberate: harvested code is not expected to compile here first try,
      // and that is the point.
      for (const [name, u] of Object.entries(p.uniforms)) shader.uniforms[name] = u;
    }
    // `#include` directives are still unresolved at this point, so the chunk has
    // to be pulled in and inlined by hand. Read it *now*, not at module load:
    // the sky system installs its own override of this same chunk during init,
    // and inlining a stale snapshot would quietly undo their diffuse-IBL scale.
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)
      .envmap_physical_pars_fragment;
    // Both guards LOUD. A shader injection that quietly does nothing is the
    // most expensive kind of bug there is: it costs a review to
    // notice and another to diagnose, and by then the numbers around it have
    // been retuned to compensate for an effect that was never running.
    if (!chunk || !ENV_RADIANCE_RETURN.test(chunk)) {
      console.warn('[materials] getIBLRadiance signature moved; env response skipped');
      return;
    }
    if (!shader.fragmentShader.includes(ENV_INCLUDE)) {
      console.warn('[materials] envmap chunk already inlined; env response skipped');
      return;
    }
    const body = list.map((p) => p.glsl).join('\n');
    const inlined = chunk.replace(
      ENV_RADIANCE_RETURN,
      (_m, indent: string) => `${indent}{${body}\n${indent}}\n${indent}return envMapColor.rgb * envMapIntensity`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + list.map((p) => p.decl).join('\n'))
      .replace(ENV_INCLUDE, inlined);
  };

  const key = () => list.map((p) => p.key).join('|');
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key()
      : key;
}

// ---------------------------------------------------------------------------
// bindSceneEnv — the opt-out from three's own global envMapIntensity assignment
// ---------------------------------------------------------------------------
//
// THIS IS NOT A CONVENIENCE. `three`'s WebGLRenderer, in `setProgram`, runs
// this every frame for every object it draws:
//
//   if ( ( material.isMeshStandardMaterial || ... ) &&
//        material.envMap === null && scene.environment !== null ) {
//     m_uniforms.envMapIntensity.value = scene.environmentIntensity;
//   }
//
// An ASSIGNMENT, not a multiply. So any MeshStandardMaterial that leaves
// `envMap` null and leans on `scene.environment` — which is the documented way
// to use a scene probe — has its AUTHORED `envMapIntensity` overwritten with
// the scene-wide value on every single frame. Assigning `envMap` explicitly is
// the opt-out: `material.envMap !== null` fails the guard above and the
// authored value survives.
//
// It is the rule "never set envMapIntensity globally" arriving from
// INSIDE three, where no amount of per-material discipline on our side can see
// it, and the two measurements that found it are worth carrying:
//
//   · A hull asked for 1.7 and was silently given 1.0; the heat tiles asked for
//     0.30 — deliberately, so they do not mirror the ground — and were given
//     1.0, i.e. 3.3x too much. Driving `material.envMapIntensity` from 1.7 to
//     12.0 at runtime moved the rendered hull by 0.03 of a code value out of
//     255. The knob was connected to nothing.
//   · Ten authored intensities in one material library, every one with a
//     paragraph of reasoning attached, all dead. Measured as an ablation inside
//     one page load: `shell.envMapIntensity` 0.0 -> 8.0 moved a lit barrel
//     146.9 -> 146.8, while `scene.environmentIntensity` 0 -> 8 on the same
//     rect moved it 14.7 -> 75.5. An eighteen-fold swing on the per-material
//     knob moved nothing and the global one moved everything.
//
// AND THE SECOND ONE HAPPENED BECAUSE THE FIRST ONE'S FIX DID NOT TRAVEL. Both
// were in the same game, in two files, written at different times, as two
// functions with different names doing the same thing. That is the whole reason
// this is in a package: the finding is expensive, it is invisible, and it will
// be rediscovered by whoever writes the next material library unless there is
// one function to call.
//
// A NUMBER THAT WAS NEVER IN EFFECT WAS NEVER REALLY TUNED. Every authored
// intensity in a library that has been running with this bug was judged by eye
// against a frame in which the value was 1.0, so turning the knob on is a
// VISUAL CHANGE even where the authored number is "right". Re-state each one
// against a measurement when you adopt this.

/**
 * ===========================================================================
 *  BIND THE SCENE PROBE TO THE MATERIAL EXPLICITLY. DO NOT DELETE THIS, AND DO
 *  NOT "TIDY" IT INTO A LOOP THAT SETS `envMapIntensity` — THAT IS THE BUG.
 * ===========================================================================
 *  three r185, WebGLRenderer.js, in setProgram, runs this every frame for every
 *  object it draws:
 *
 *    if ( ( material.isMeshStandardMaterial || ... ) &&
 *         material.envMap === null && scene.environment !== null ) {
 *      m_uniforms.envMapIntensity.value = scene.environmentIntensity;
 *    }
 *
 *  So ANY MeshStandardMaterial that leaves `envMap` null and leans on
 *  `scene.environment` has its authored `envMapIntensity` OVERWRITTEN with the
 *  scene-wide value on every single frame. A hull asking for 1.7 is silently
 *  given 1.0; a deliberately dulled surface asking for 0.30 — so that it does
 *  NOT mirror the ground — is silently given 1.0, i.e. 3.3x too much.
 *
 *  MEASURED before the fix, in the game this came from: driving
 *  `material.envMapIntensity` from 1.7 to 12.0 at runtime changed the rendered
 *  surface by 0.03 of a code value out of 255. The knob was connected to
 *  nothing, and nothing in the frame looked broken.
 *
 *  Assigning `envMap` explicitly is the opt-out: `material.envMap !== null`
 *  fails the guard above and the authored value survives. It is a fact about
 *  three's renderer, not about any game, which is why it lives here.
 *
 *  Returns whether the material is now bound, so a caller can keep the subset
 *  it bound and re-run this after a context restore rebuilds the probe.
 * ===========================================================================
 */
export function bindSceneEnv(mat: THREE.Material, env: THREE.Texture | null, keepForeign = false): boolean {
  if (env === null) return false;
  const m = mat as THREE.MeshStandardMaterial;
  // Only for the standard-material family; MeshBasicMaterial has no IBL term
  // and assigning envMap to it would add a reflection nobody asked for.
  if (!(m as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return false;
  // `keepForeign` says: never clobber a probe somebody else chose. A caller
  // whose material set may include one INJECTED from another system — already
  // carrying its own envMap, i.e. having opted out of `scene.environment`
  // deliberately — passes true, and overwriting that would be the same class of
  // unasked-for global assignment this function exists to undo.
  //
  // IT DEFAULTS OFF, AND THAT IS THE CONSERVATIVE DIRECTION, not the lax one.
  // A caller that OWNS every material it passes wants an unconditional rebind:
  // a WebGL context restore builds a NEW probe texture, and with the guard on,
  // a material bound to the dead one would refuse the new one and render black
  // with no error anywhere. Only a caller that genuinely mixes owned and
  // foreign materials has a reason to accept that trade.
  if (keepForeign && m.envMap !== null && m.envMap !== env) return false;
  if (m.envMap === env) return true;
  m.envMap = env;
  m.needsUpdate = true;
  return true;
}

/**
 * The same, over a collection. Returns whether ANY of them ended up bound —
 * which is the question a caller that wants to retry next frame is asking.
 *
 * `keepForeign` is the single-material argument, passed straight through, and
 * it defaults OFF for the reason given there: a caller handing this a material
 * library it BUILT wants the unconditional rebind, because a context restore
 * makes a new probe and a material still holding the dead one renders black.
 */
export function bindSceneEnvAll(
  mats: Iterable<THREE.Material>,
  env: THREE.Texture | null,
  keepForeign = false,
): boolean {
  if (env === null) return false;
  let bound = false;
  for (const m of mats) if (bindSceneEnv(m, env, keepForeign)) bound = true;
  return bound;
}

/**
 * ---------------------------------------------------------------------------
 * REBIND A FIXED MATERIAL SET WHEN THE PROBE'S IDENTITY CHANGES.
 * ---------------------------------------------------------------------------
 * `bindSceneEnv` is a fact about three's renderer and it is cheap, but WHEN to
 * call it is a fact about a session: `scene.environment` normally never moves
 * — a sky system hands back one live target for the whole run — and then a
 * WebGL context restore quietly builds a new one and every material still
 * pointing at the dead texture renders BLACK with no error anywhere.
 *
 * So the call belongs on the frame path, and on the frame path it has to cost
 * nothing. This is the shape that gives both: one reference compare per frame,
 * and the rebind only on the frame the identity actually moved. It was written
 * twice in one directory, once with the clear and once without, and the two
 * copies are the point — the difference between them is not a preference.
 *
 * `clearFirst` exists BECAUSE of `keepForeign`. A caller that mixes owned and
 * injected materials passes `keepForeign` so it never clobbers a probe
 * somebody else chose — and on a restore that same guard refuses the NEW probe
 * too, because the material is still holding the old one and the old one is
 * "foreign" to the comparison. Nulling the set first is what lets a restore
 * through a guard that is otherwise exactly right. A caller that owns every
 * material in its list needs neither.
 *
 * Returns true only on the frame it rebound, so a caller with more to do on
 * that frame — re-pointing a glare meridian, re-keying an intensity table —
 * can hang it off the same compare.
 */
export function envProbeRebind(
  mats: readonly THREE.Material[],
  o: {
    keepForeign?: boolean;
    clearFirst?: boolean;
    /**
     * The probe the caller has ALREADY bound these materials to, if it did.
     * Omitted, the first call rebinds unconditionally — which is right for a
     * list that has never been bound, and one wasted `needsUpdate` (i.e. one
     * shader recompile at the worst possible moment, the first frame) for a
     * list that has. `undefined` and not `null` is the unseeded value on
     * purpose: `null` is a legitimate probe identity, meaning "the scene has
     * not built one yet", and a caller in that state must still bind when it
     * arrives.
     */
    seed?: THREE.Texture | null;
  } = {},
): (env: THREE.Texture | null) => boolean {
  let last: THREE.Texture | null | undefined = o.seed;
  return (env) => {
    if (env === last) return false;
    if (o.clearFirst) {
      for (const m of mats) (m as THREE.MeshStandardMaterial).envMap = null;
    }
    last = env;
    for (const m of mats) bindSceneEnv(m, env, o.keepForeign ?? false);
    return true;
  };
}

/**
 * ---------------------------------------------------------------------------
 * A TABLE OF ABSOLUTE ENVIRONMENT TARGETS, RE-KEYED WHEN THE SCENE'S MOVES.
 * ---------------------------------------------------------------------------
 * `envMapIntensity` is MULTIPLIED by `scene.environmentIntensity`, so a value
 * authored against a lit probe is wrong the moment a sky system swings that
 * global. The fix that everybody reaches for first — one flat number across
 * every material — is the trap: it silently deleted every metal reflection and
 * clearcoat highlight in one game built on this engine, and where a world has a
 * genuinely dark half it does not dim the objects, it DELETES them.
 *
 * So a material's number is stated ABSOLUTELY — what it would want at a global
 * of 1 — and divided by the live global on the way to the material. The whole
 * of the shared part is the division, the floor and the guard; WHICH materials
 * exist and what each of them is worth is the game's, and it stays there.
 *
 * `moved` returning false is the common path — every frame, on every render
 * hook, for the whole of a lap that does not cross a terminator — and it costs
 * one float compare. The epsilon is the caller's because it is a statement
 * about how finely that game's sky moves the global.
 */
export interface EnvRekey<K extends string> {
  /** what a material whose absolute target is `k` should be keyed to now */
  at(k: K): number;
  /** true only when the global actually moved and materials need re-keying */
  moved(sceneEnvIntensity: number): boolean;
}

/**
 * @param initial the global to assume until the sky first reports in. NOT 1:
 *                a table divided by 1 before the first frame flashes every
 *                material at its authored value for the frames in between.
 * @param floor   the smallest global to divide by, so a scene that reports 0
 *                does not hand every material an Infinity.
 */
export function envRekey<K extends string>(
  targets: Readonly<Record<K, number>>, initial: number, floor: number, epsilon: number,
): EnvRekey<K> {
  let global = Math.max(floor, initial);
  return {
    at: (k) => targets[k] / global,
    moved(sceneEnvIntensity) {
      const g = Math.max(floor, sceneEnvIntensity);
      if (Math.abs(g - global) < epsilon) return false;
      global = g;
      return true;
    },
  };
}
