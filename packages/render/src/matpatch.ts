/**
 * ============================================================================
 *  matpatch — the shader-patch REGISTRY, and the patchers both racers wrote
 *  identically.
 * ============================================================================
 *  A kart racer and a space racer each carried a shader-patch system in their
 *  `Props.ts`. Much of it HAS genuinely diverged and stays in the games:
 *  `Shared` and `makeShared` differ (one game has wind and a sea level, the
 *  other has a solar term and a pixel height), and so do fourteen patchers that
 *  exist in only one of the two. NONE OF THAT IS HERE.
 *
 *  THE FIRST EXTRACTION ALSO LEFT `patchInstUv`, `patchInstAlpha`, `patchLod`
 *  AND `patchMacroBreak` in the games, because the space racer had a `decl()`
 *  helper where the kart racer still concatenated, and said adopting it there
 *  would be "an upgrade with a before-and-after of its own". THAT UPGRADE HAS
 *  SINCE LANDED and the four are now at the bottom of this file, with `decl`.
 *  The second block comment down there is the before-and-after; read it before
 *  assuming this paragraph is still describing the whole file.
 *
 *  WHAT CHANGED SINCE THE FIRST EXTRACTION. It recorded `patch` as diverged
 *  because the space racer hands the material to each patcher as a third
 *  argument and the kart racer does not. Re-read in code: ALL TWELVE of the
 *  kart racer's patch callbacks are written `(sh) => …` and read no second or
 *  third parameter, so handing them one more argument is inert. The two `patch`
 *  bodies were the same function with one argument's difference, not two
 *  functions — so the registry lives here now, three-argument, and both games
 *  call it unchanged.
 *
 *  The registry is one unit and moves as one, because three of its members
 *  close over the SAME WeakMap and cannot be split from it:
 *
 *      patch  clonePatched  depthMaterialFor  DEPTH_PATCH_KEY
 *
 *  `depthMaterialFor` and `DEPTH_PATCH_KEY` were byte-identical in both games,
 *  doc comment and all. `clonePatched` exists only in the space racer and is
 *  here because it reads `PATCHES` — the seam decided its home, not a line
 *  count.
 *
 *  Also here, byte-identical in both games from the first extraction:
 *
 *      patchTint  patchRoughFromTint  patchRoughVary  patchDesatMap
 *
 *  These four used to be a factory the game closed over its own `patch`. There
 *  is one `patch` now, so they are bound once, here, and exported directly. The
 *  factory survives as a private function only to avoid re-indenting 130 lines
 *  of shader source for no behavioural gain.
 *
 *  NOTHING HERE BRANCHES ON WHICH GAME CALLED IT. Every parameter is a number
 *  or a boolean the caller supplies — an exposure, a range, a scale. The moment
 *  one of these needs to know whose world it is drawing, it was never one
 *  function and belongs back in a game.
 *
 *  ONE WeakMap PER BUNDLE, NOT ONE PER MACHINE. Each game builds its own
 *  bundle, so each gets its own module instance and its own `PATCHES`. Two
 *  games never share a registry; a game can never have two.
 *
 *  The doc comments came from the kart racer, which is the only copy that had
 *  them, and they illustrate with that game's own scenery — a spectator's
 *  shirt, a verge, a headland. The REASONING is what they are for and it holds
 *  in both; the examples are one game's and are labelled as such rather than
 *  sanded into something true of neither.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * The matching half lives in @homie-rocks/geom/inst.ts without an import edge.
 * `Symbol.for` is the small runtime protocol between the emitter and reader:
 * InstSet can now refuse a non-identity tint that no shader will consume.
 */
const INST_TINT_READER = Symbol.for('@homie-rocks/instance/aTint-reader');
type TintReadableMaterial = THREE.Material & { [INST_TINT_READER]?: true };

/**
 * What a patcher is handed. `renderer` and `mat` are optional because most
 * patchers read neither; the ones that survive `clonePatched` need `mat`.
 */
export type ShaderPatchFn = (sh: any, renderer?: any, mat?: THREE.Material) => void;

/**
 * The installer's shape. Kept as a named type because the four tint patchers
 * below are still written against it rather than against the concrete `patch`.
 */
export type PatchInstaller = (mat: THREE.Material, key: string, fn: ShaderPatchFn) => void;

interface PatchEntry {
  keys: string[];
  fns: ShaderPatchFn[];
}
const PATCHES = new WeakMap<THREE.Material, PatchEntry>();

/**
 * Composable onBeforeCompile. Keys feed customProgramCacheKey.
 *
 * Materials handed to us by the shared library already carry their own
 * onBeforeCompile — that is where its tiling-breakup injection lives. Simply
 * assigning ours would silently drop it and reintroduce a visible one-tile
 * repeat, so the incumbent handler is captured and run first.
 */
export function patch(mat: THREE.Material, key: string, fn: ShaderPatchFn) {
  // `patchTint` keys are tint/tintM; `patchInstAlpha` uses the same aTint
  // channel as a scalar. Mark before the duplicate-key return so a material
  // restored from a patch registry cannot lose the capability bit.
  if (key === 'tint' || key === 'tintM' || key === 'ialpha') {
    (mat as TintReadableMaterial)[INST_TINT_READER] = true;
  }
  let e = PATCHES.get(mat);
  if (!e) {
    const prior = mat.onBeforeCompile;
    const priorCacheKey = mat.customProgramCacheKey;
    const hasPrior = typeof prior === 'function' && prior !== THREE.Material.prototype.onBeforeCompile;
    let baseKey = '';
    if (hasPrior && typeof priorCacheKey === 'function') {
      try {
        baseKey = 'base:' + priorCacheKey.call(mat);
      } catch {
        baseKey = 'base';
      }
    }
    e = { keys: hasPrior ? [baseKey || 'base'] : [], fns: hasPrior ? [(sh: any, r: any) => (prior as any).call(mat, sh, r)] : [] };
    PATCHES.set(mat, e);
    const entry = e;
    // The material is handed to each fn as a third argument. A patcher whose
    // parameters have to survive `clonePatched` (which re-registers the SAME
    // closures against a new material) cannot capture them — it has to look
    // them up per material at compile time. The space racer's `patchThinFade`
    // is the one that does; see the WeakMap beside it. Every other patcher in
    // both games is written `(sh) => …` and never observes this argument.
    mat.onBeforeCompile = (sh, renderer) => {
      for (const f of entry.fns) f(sh, renderer, mat);
    };
    mat.customProgramCacheKey = () => entry.keys.join('|');
  }
  if (e.keys.indexOf(key) >= 0) return;
  e.keys.push(key);
  e.fns.push(fn);
  mat.needsUpdate = true;
}

/**
 * ===========================================================================
 *  CLONE A MATERIAL AND KEEP ITS PATCHES. `Material.clone()` DOES NOT, AND
 *  THAT IS A SILENT, INVISIBLE, COMPLETELY PLAUSIBLE-LOOKING FAILURE.
 * ===========================================================================
 *  `THREE.Material.copy()` copies a fixed list of properties and
 *  `onBeforeCompile` / `customProgramCacheKey` are not on it — they are own
 *  properties assigned onto the instance by `patch()`, so a `clone()` comes
 *  back with the base shader and NONE of the injections. Verified against
 *  three 0.185: `clone().onBeforeCompile === original.onBeforeCompile` is
 *  false.
 *
 *  This is a familiar shape of trap: it produces no error, no warning and a
 *  frame that renders. What it produces instead is a material that quietly lost
 *  its instanced tint, its LOD collapse, its roughness variation and its value
 *  work — so, for example, a work drone cloned off `steelInst` renders at full
 *  untinted albedo with envMapIntensity 1.35 and no distance falloff, which is
 *  a small pure-white rectangle floating in a black sky. That is exactly the
 *  review finding "small white rectangular props ... at thumbnail they read as
 *  dead pixels".
 *
 *  Every clone of a patched material needs the patch list carried over. Use
 *  this rather than `.clone()` on anything that came out of `MatLib`.
 * ===========================================================================
 */
export function clonePatched<T extends THREE.Material>(mat: T): T {
  const c = mat.clone() as T;
  const e = PATCHES.get(mat);
  if (!e) return c;
  // Re-register the SAME closures against the clone. They capture uniforms by
  // reference (uCam, uTime, uSolar), which is what we want: one uniform object
  // shared by every material that reads it, updated once per frame.
  // `keys` and `fns` are only ever pushed together, by `patch` above and by
  // nothing else, so index i is in range in both. The `!` is this package's
  // `noUncheckedIndexedAccess` — the games' tsconfigs do not set it, which is
  // why the same three lines needed no assertion while they lived in a game.
  for (let i = 0; i < e.keys.length; i++) patch(c, e.keys[i]!, e.fns[i]!);
  return c;
}

/**
 * A clone of `mat` rendered from a different side, carrying the incumbent's
 * shader hook ACROSS BY HAND.
 *
 * ===========================================================================
 *  THIS IS NOT `clonePatched`, AND THE DIFFERENCE IS WHICH HOOK IS BEING
 *  CARRIED. BOTH FUNCTIONS EXIST FOR THE SAME BUG SEEN FROM OPPOSITE SIDES.
 * ===========================================================================
 *  `clonePatched` re-registers what THIS PACKAGE'S `patch()` put in its
 *  WeakMap. That is the right thing for anything this package patched, and it
 *  is exactly the wrong thing for a material handed over by a game's own
 *  shared-material library: such a material has an `onBeforeCompile` ASSIGNED
 *  directly — triplanar projection, tile breakup — which `patch()` never saw,
 *  so its registry entry is EMPTY and `clonePatched` returns a bare clone that
 *  has silently lost it. No error, no warning, and a frame that renders with a
 *  visible one-tile repeat on the surface it was called for.
 *
 *  So this copies the two own-properties `THREE.Material.copy()` does not
 *  walk, verbatim and UNBOUND. Unbound is deliberate and it is the one subtle
 *  line: assigning `m.onBeforeCompile` to the clone leaves `this` resolving to
 *  the CLONE at compile time, which is what a hook reading `this.map` or
 *  `this.userData` needs. `clonePatched` binds instead, because the closures
 *  it re-registers already captured their material. Two carries, two
 *  conventions, and neither one covers the other's case.
 *
 *  A material that is BOTH library-patched and `patch()`-patched wants both,
 *  in that order — clone here first, then re-register. Nothing in the games
 *  is, today, and this comment is where that will be noticed.
 */
export function sideVariant<T extends THREE.Material>(mat: T, side: THREE.Side): T {
  const c = mat.clone() as T;
  c.side = side;
  type Hooked = { onBeforeCompile?: THREE.Material['onBeforeCompile']; customProgramCacheKey?: () => string };
  (c as unknown as Hooked).onBeforeCompile = (mat as unknown as Hooked).onBeforeCompile;
  (c as unknown as Hooked).customProgramCacheKey = (mat as unknown as Hooked).customProgramCacheKey;
  return c;
}

/**
 * The patches that MOVE VERTICES, as opposed to colouring them.
 *
 * Everything in this list changes where the geometry physically is — the LOD
 * collapse, the wind sway, the boat bob, the crowd's cheer, cloth flap, a
 * gull's circling. Everything NOT in it (tint, instanced UV, translucency, aerial
 * haze, roughness variation) only changes what the surface looks like, which a
 * depth pass does not care about.
 *
 * Keys are matched by prefix because three of them are parameterised:
 * `patchWind` keys as `wind0`/`wind1`, `patchCloth` as `cloth0.30`.
 */
const DEPTH_PATCH_KEY = /^(lod|wind\d|bob|crowd|cloth|bird)/;

/**
 * A depth material that agrees with `mat` about where its vertices are.
 *
 * THE BUG THIS FIXES. Every vertex displacement in a racer's Props lives in the
 * colour material's `onBeforeCompile`. The shadow pass does not use the colour
 * material: `WebGLShadowMap.getDepthMaterial` reaches for `customDepthMaterial`
 * and falls back to one shared `MeshDepthMaterial` that knows nothing about any
 * of it. So an object could be collapsed to a point by `patchLod` — invisible,
 * deliberately, because it is 300 m away — and still lay a full-size shadow on
 * the ground with nothing above it to cast it. Under the kart racer's 14-degree
 * key light that shadow is four times the prop's own height, so it is not a
 * subtle artefact; it is a long dark streak attached to nothing.
 *
 * Measured with a per-instance distance probe over the four capture vantage
 * points, 58-93% of all LOD-carrying world geometry is collapsed in the colour
 * pass, and 493k-884k triangles of it were still being rasterised into the
 * shadow map every frame — every spectator, every crate, every cypress on the
 * far side of the circuit, at full detail, drawing shadows nobody can see.
 *
 * Foliage already solved this for its three cut-out sheets by hand (the
 * game's foliage builder makes a matching `MeshDepthMaterial` and runs
 * `patchWind` + `patchLod` over it). This generalises that to every set: the
 * SAME patch closures are re-run against the depth material, so the two shaders
 * cannot drift apart the way a hand-copied pair can.
 *
 * Returns null when `mat` moves no vertices — then three's shared depth
 * material is already correct and a per-material clone would only cost a
 * program.
 *
 * `map` / `alphaTest` / `side` are copied so the FIRST compile has the right
 * defines. Three overwrites all three on every shadow draw regardless (it does
 * this to custom depth materials too), so this changes no behaviour — it only
 * stops the first shadow frame compiling a variant it immediately discards.
 */
export function depthMaterialFor(mat: THREE.Material): THREE.Material | null {
  const e = PATCHES.get(mat);
  if (!e) return null;
  const wanted: number[] = [];
  for (let i = 0; i < e.keys.length; i++) if (DEPTH_PATCH_KEY.test(e.keys[i]!)) wanted.push(i);
  if (!wanted.length) return null;

  const src = mat as THREE.MeshStandardMaterial;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  if (src.map && src.alphaTest > 0) {
    d.map = src.map;
    d.alphaTest = src.alphaTest;
  }
  if (src.alphaToCoverage) d.alphaToCoverage = true;
  d.side = src.side;
  for (const i of wanted) patch(d, e.keys[i]!, e.fns[i]!);
  return d;
}

/**
 * The racers' own clamp, verbatim — NOT `@homie-rocks/noise`'s. It is the same
 * body here, but `canvastex.ts` in this package explains at length why reaching
 * for a same-named helper in another package is how every texel in two games
 * gets recomputed by a change that claims to move nothing.
 */
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Private. Only ever called once, immediately below, with the one `patch` this
// module owns. It stays a factory purely so the 130 lines of shader source in
// it did not have to be re-indented by a change that moves no pixel.
function tintPatchers(patch: PatchInstaller) {
  /**
   * Per-instance tint, multiplied over albedo (independent of three's
   * instanceColor so it can be masked). With `maskFromUvX`, only vertices whose
   * uv.x is 1 take the tint — that is how one spectator mesh gets a coloured
   * shirt without repainting the skin.
   */
  function patchTint(mat: THREE.Material, maskFromUvX = false) {
    patch(mat, 'tint' + (maskFromUvX ? 'M' : ''), (sh) => {
      sh.vertexShader =
        'attribute vec3 aTint;\nvarying vec3 vTintI;\n' +
        (maskFromUvX ? 'varying float vTintMask;\n' : '') +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTintI = aTint;' + (maskFromUvX ? '\n  vTintMask = clamp(uv.x, 0.0, 1.0);' : ''));
      sh.fragmentShader =
        'varying vec3 vTintI;\n' +
        (maskFromUvX ? 'varying float vTintMask;\n' : '') +
        sh.fragmentShader.replace(
          '#include <color_fragment>',
          maskFromUvX
            ? `#include <color_fragment>
             diffuseColor.rgb *= mix(vec3(1.0), vTintI, vTintMask);`
            : `#include <color_fragment>
             diffuseColor.rgb *= vTintI;`
        );
    });
  }

  /**
   * Roughness driven off the per-instance tint's value.
   *
   * The clump mask that decides whether a patch of verge is fresh growth or
   * sun-bleached already rides in on `aTint`; this reads it back out so the dry
   * patches are also the matte ones (0.88) and the fresh growth keeps a waxy
   * sheen (0.55). The art direction wants roughness to vary spatially and this
   * gets it for the cost of one dot product, with the variation locked to the
   * albedo variation rather than floating free of it.
   *
   * Requires `patchTint` on the same material — it reads that patch's `vTintI`
   * varying rather than redeclaring the attribute, which would be a duplicate
   * declaration and fail to compile.
   */
  function patchRoughFromTint(mat: THREE.Material, lo = 0.55, hi = 0.88) {
    patch(mat, 'roughtint', (sh) => {
      sh.uniforms.uRtRange = { value: new THREE.Vector2(lo, hi) };
      sh.fragmentShader =
        'uniform vec2 uRtRange;\n' +
        sh.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           {
             float v = dot(vTintI, vec3(0.2126, 0.7152, 0.0722));
             roughnessFactor = mix(uRtRange.x, uRtRange.y, clamp((v - 0.28) / 0.55, 0.0, 1.0));
           }`
        );
    });
  }

  /**
   * Spatially varying roughness (the art direction: "a constant roughness value
   * reads as plastic and is the #1 tell of an amateur real-time scene"). A
   * texture's roughness map repeats with its own tile; this modulates it with a
   * low-frequency world-space field so one wall is sun-baked and polished and
   * the next is chalky, and the patches do not line up with the texture repeat.
   */
  function patchRoughVary(mat: THREE.Material, lo = 0.72, hi = 1.22, scale = 7.0) {
    patch(mat, 'roughvary' + lo.toFixed(2) + hi.toFixed(2), (sh) => {
      sh.uniforms.uRvScale = { value: 1 / scale };
      sh.uniforms.uRvRange = { value: new THREE.Vector2(lo, hi) };
      sh.vertexShader =
        'varying vec3 vRvPos;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             vec4 rvW = vec4(transformed, 1.0);
             #ifdef USE_INSTANCING
               rvW = instanceMatrix * rvW;
             #endif
             vRvPos = (modelMatrix * rvW).xyz;
           }`
        );
      sh.fragmentShader =
        `varying vec3 vRvPos; uniform float uRvScale; uniform vec2 uRvRange;
         float rvHash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.7); return fract(p.x * p.y); }
         float rvNoise(vec2 p){
           vec2 i = floor(p), f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(mix(rvHash(i), rvHash(i + vec2(1.0, 0.0)), f.x),
                      mix(rvHash(i + vec2(0.0, 1.0)), rvHash(i + vec2(1.0, 1.0)), f.x), f.y);
         }\n` +
        // Anchored on metalnessmap_fragment, not roughnessmap_fragment: the
        // shared library REPLACES the latter outright for its tiling breakup, so
        // that token no longer exists by the time we run. roughnessFactor is in
        // scope either way, and metalness is the next include along.
        sh.fragmentShader.replace(
          '#include <metalnessmap_fragment>',
          `{
             vec2 rp = vRvPos.xz * uRvScale + vRvPos.y * uRvScale * 0.31;
             float rn = rvNoise(rp) * 0.62 + rvNoise(rp * 2.37 + 11.3) * 0.38;
             roughnessFactor = clamp(roughnessFactor * mix(uRvRange.x, uRvRange.y, rn), 0.05, 1.0);
           }
           #include <metalnessmap_fragment>`
        );
    });
  }

  /**
   * Strip the hue out of a material's albedo map, keeping its luminance detail.
   *
   * The backdrop is one merged mesh sharing one rock texture, and every layer of
   * the horizon has to be a different colour — the near headlands olive and warm,
   * the far range cool and pale. Multiplying a tan rock albedo by a vertex tint
   * cannot get there: it drags everything back toward the tan, which is how
   * sixteen background masses at four distances all ended up the same colour.
   *
   * Desaturating the map to its own luminance (brightness-preserving, so nothing
   * darkens) hands hue authority entirely to the vertex colour, while the map
   * keeps doing the job it is actually good for at this distance: strata, grain
   * and the break-up that stops a kilometre of hillside being one flat value.
   */
  function patchDesatMap(mat: THREE.Material, amount = 0.86) {
    const a = clamp(amount, 0, 1).toFixed(3);
    patch(mat, 'desatmap' + a, (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         #ifdef USE_MAP
           { float kL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(kL), ${a}); }
         #endif`
      );
    });
  }

  return { patchTint, patchRoughFromTint, patchRoughVary, patchDesatMap };
}

export const { patchTint, patchRoughFromTint, patchRoughVary, patchDesatMap } = tintPatchers(patch);

/**
 * ============================================================================
 *  THE INSTANCING PATCHERS, AND `decl` — ADDED IN A SECOND EXTRACTION.
 * ============================================================================
 *  The header above records why `patchInstUv`, `patchInstAlpha`, `patchLod` and
 *  `patchMacroBreak` were LEFT in the two games on the first extraction, and it
 *  named the condition for moving them: the space racer had a `decl()` helper
 *  where the kart racer still concatenated, and "adopting it there is an
 *  upgrade with a before-and-after of its own". This is that before-and-after.
 *  The four were otherwise line-for-line identical in the two games — a diff of
 *  the four bodies is 2, 4, 2 and 27 changed lines out of 85, and every one of
 *  those changed lines is one of the two mechanical differences below.
 *
 *  WHY ADOPTING `decl` CANNOT CHANGE A PICTURE. `decl(src, lines)` emits each
 *  declaration line that `src` does not already contain verbatim, then the
 *  source. When nothing is already declared — which is every case the kart
 *  racer has today — the output is byte-for-byte the concatenation it replaces,
 *  in the same order. When something IS already declared, the concatenation it
 *  replaces emitted a GLSL redeclaration and the program did not link. So the
 *  two spellings agree everywhere a frame exists, and differ only where the old
 *  one produced no frame at all.
 *
 *  WHY THE `patchMacroBreak` SUFFIX CANNOT CHANGE A PICTURE EITHER. The suffix
 *  is derived from the same string the patch key is, so a material carrying one
 *  octave gets one set of uniforms under a longer name and identical values,
 *  and the include guards are no-ops on a first inclusion. It matters only for
 *  a material patched TWICE at different scales — which the space racer does
 *  to `cladShell` and the kart racer does nowhere — and there the un-suffixed
 *  version did not link. Same shape as `decl`: strictly wider, never different.
 *
 *  `patchLod` took `u: Shared` in both games and reads exactly ONE field of it.
 *  `Shared` is a game's uniform block — the kart racer's carries wind and a sea
 *  level, the space racer's a solar term and a pixel height — and it must not
 *  cross this seam. `CamHost` below is the one field the code actually reads;
 *  both games' `Shared` satisfies it structurally and not one call site
 *  changed.
 * ============================================================================
 */

/**
 * Prepend GLSL declarations, skipping any this stage already has verbatim.
 *
 * Blind concatenation is fine for a patch nothing else has touched and is a
 * redeclaration error the moment two patchers want the same varying. Splitting
 * per line keeps that from being a silent hole: two DIFFERENT declarations
 * under one name still collide, because the strings differ and both get
 * emitted, so this cannot mask a real conflict.
 */
export function decl(src: string, lines: string): string {
  let out = '';
  for (const line of lines.split('\n')) {
    if (!line) continue;
    if (src.indexOf(line) >= 0) continue;
    out += line + '\n';
  }
  return out + src;
}

/** Per-instance UV transform (atlas cells + per-instance tiling density). */
export function patchInstUv(mat: THREE.Material) {
  patch(mat, 'iuv', (sh) => {
    sh.vertexShader = decl(sh.vertexShader, 'attribute vec4 aUv;\n').replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vMapUv * aUv.xy + aUv.zw;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = vNormalMapUv * aUv.xy + aUv.zw;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = vRoughnessMapUv * aUv.xy + aUv.zw;
      #endif
      #ifdef USE_ALPHAMAP
        vAlphaMapUv = vAlphaMapUv * aUv.xy + aUv.zw;
      #endif`
    );
  });
}

/** Per-instance opacity, for the contact-shadow decals. */
export function patchInstAlpha(mat: THREE.Material) {
  patch(mat, 'ialpha', (sh) => {
    sh.vertexShader = decl(sh.vertexShader, 'attribute vec3 aTint;\nvarying float vIAlpha;\n').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIAlpha = aTint.r;');
    sh.fragmentShader = decl(sh.fragmentShader, 'varying float vIAlpha;\n').replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vIAlpha;');
  });
}

/**
 * The ONE field of a game's `Shared` uniform block that `patchLod` reads.
 *
 * Declared here rather than importing a `Shared` so that neither game's uniform
 * block crosses the seam. Both satisfy this structurally.
 */
export interface CamHost {
  uCam: { value: THREE.Vector3 };
}

/** LOD collapse: instances past `aLod` metres from the camera become degenerate. */
export function patchLod(mat: THREE.Material, u: CamHost) {
  patch(mat, 'lod', (sh) => {
    sh.uniforms.uCam = u.uCam;
    sh.vertexShader = decl(sh.vertexShader, 'attribute float aLod;\nattribute vec3 aOrigin;\nuniform vec3 uCam;\n').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         if (aLod > 0.0) {
           vec3 iOrigin = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
           float dCam = distance(iOrigin, uCam);
           // fade the last 15% of the range by shrinking, then collapse
           transformed *= 1.0 - smoothstep(aLod * 0.86, aLod, dCam);
         }
       #else
         // Same collapse for a set that mergeStaticSets has baked flat. There
         // is no instanceMatrix to read the origin out of any more, so the
         // merger writes each baked instance's own origin into aOrigin and the
         // scale happens about that instead of about the merged geometry's
         // origin -- which is somewhere out in the middle of a 400 m cell, and
         // would send every prop in the batch sliding towards it.
         if (aLod > 0.0) {
           float dCam = distance((modelMatrix * vec4(aOrigin, 1.0)).xyz, uCam);
           transformed = aOrigin +
             (transformed - aOrigin) * (1.0 - smoothstep(aLod * 0.86, aLod, dCam));
         }
       #endif`
    );
  });
}

/**
 * Low-frequency albedo break-up in world space.
 *
 * The art direction forbids a visible tiling repeat inside one camera frame.
 * `patchRoughVary` already breaks the ROUGHNESS with a world-space field and it
 * is what stops a wall reading as one plastic sheet — but roughness cannot hide
 * a repeat that is visible in albedo, and a tiled clay roof (the kart racer's
 * example, which is where this doc comment was written) is mostly an albedo
 * pattern.
 *
 * Two octaves at a non-integer ratio, sampled in world space so they cannot
 * line up with the texture repeat by construction, and applied as a multiply so
 * nothing shifts hue. Costs two hashes per fragment.
 */
export function patchMacroBreak(mat: THREE.Material, scale = 9.0, amount = 0.16) {
  /*
   * THIS PATCH STACKS, AND MAKING IT STACK IS THE WHOLE JOB OF THE SUFFIX.
   *
   * `patch()` dedupes by key and the key carries the parameters, so two calls
   * at DIFFERENT scales are two different keys and both closures run against
   * one shader. The space racer did exactly that — a 7.5 m strake octave
   * plus a 34 m architectural octave on `cladShell`, which is the right fix for
   * the "single blown-out near-white wall ... visible single-frequency tile
   * repeat" finding on a foundry capture — and the second copy of the shared
   * declarations then redefined `vMbPos`, `uMbScale`, `uMbAmt`, `mbH` and
   * `mbN`. The foundry hull stopped linking altogether.
   *
   * So: the parts that are the SAME for every octave (the world position and
   * the noise itself) are declared once behind an include guard, and the parts
   * that differ per octave (the two uniforms and the modulation) carry a
   * suffix derived from the same string the key is. Key uniqueness and symbol
   * uniqueness are therefore the same property by construction — two calls
   * that would collide in GLSL are two calls `patch()` has already deduped.
   */
  const tag = scale.toFixed(1) + amount.toFixed(2);
  const sfx = tag.replace(/[^0-9]/g, '');
  patch(mat, 'macrobrk' + tag, (sh) => {
    sh.uniforms['uMbScale' + sfx] = { value: 1 / scale };
    sh.uniforms['uMbAmt' + sfx] = { value: amount };
    sh.vertexShader =
      // Guarded: every octave wants the same world position, and the second
      // one declaring it again is the redefinition described above.
      '#ifndef K_MB_PARS\n#define K_MB_PARS\nvarying vec3 vMbPos;\n#endif\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifndef K_MB_VERTEX
         #define K_MB_VERTEX
         {
           vec4 mbW = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             mbW = instanceMatrix * mbW;
           #endif
           vMbPos = (modelMatrix * mbW).xyz;
         }
         #endif`
      );
    sh.fragmentShader =
      `#ifndef K_MB_PARS
       #define K_MB_PARS
       varying vec3 vMbPos;
       float mbH(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 29.1); return fract(p.x * p.y); }
       float mbN(vec2 p){
         vec2 i = floor(p), f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         return mix(mix(mbH(i), mbH(i + vec2(1.0, 0.0)), f.x),
                    mix(mbH(i + vec2(0.0, 1.0)), mbH(i + vec2(1.0, 1.0)), f.x), f.y);
       }
       #endif
       uniform float uMbScale${sfx}; uniform float uMbAmt${sfx};\n` +
      sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec2 mp = vMbPos.xz * uMbScale${sfx} + vMbPos.y * uMbScale${sfx} * 0.53;
           // 1 : 2.71 — deliberately irrational-ish, so the two octaves never
           // beat against each other or against the map's own tile
           float mn = mbN(mp) * 0.63 + mbN(mp * 2.71 + 7.9) * 0.37;
           diffuseColor.rgb *= 1.0 + (mn - 0.5) * 2.0 * uMbAmt${sfx};
         }`
      );
  });
}

/* ===========================================================================
 *  THE DISTANCE FAMILY — five injections that answer one question: what should
 *  a member DO once the rasteriser can no longer resolve it?
 * ===========================================================================
 *  Lifted out of the space racer's `Props.ts`, where all five had exactly ONE
 *  copy — which is why repeated duplication counting never saw them. A single
 *  implementation can be 100% platform, and these are: every literal in them is
 *  a DISTANCE, a PIXEL COUNT or a FLOOR handed in by the caller. Not one of
 *  them names a deck, a truss, a colony or a circuit. `patchLod` above was
 *  already here; these are the cases it does not cover, plus the vertex-colour
 *  sibling of `patchRoughFromTint`.
 *
 *  They arrive UNCHANGED — same GLSL, same uniform packing, same `patch()`
 *  keys — so a material's `customProgramCacheKey` is the string it was before
 *  the move. A fade-injector probe drives the pre-move source against these
 *  and compares the emitted shader text and every uniform
 *  value with `Object.is`.
 *
 *  ALL OF THEM INSTALL THROUGH `patch()`, WHICH IS NOT A DETAIL. `clonePatched`
 *  re-registers the registry's closures onto a clone; an injection that assigns
 *  `onBeforeCompile` directly is silently LOST the moment anything clones the
 *  material it was applied to. `patchThinFade` below records what the
 *  neighbouring mistake cost — a 600 m shell at a fifth of its intended value,
 *  which never rendered at all.
 *
 *  WHAT DID NOT COME WITH THEM, and it is the one seam that move refused:
 *  `patchSpecCeiling`, still in that game. It is the SAME max-channel
 *  exponential shoulder as `./ValueCeiling.ts`'s `addValueCeiling` — identical
 *  arithmetic, identical `vec2(knee, ceil - knee)` packing, identical
 *  `<opaque_fragment>` anchor — and both are live in the space racer today at
 *  the same knees, kept in agreement by attention. They cannot be merged from
 *  inside one game: `addValueCeiling` assigns the hook DIRECTLY, which is
 *  exactly what puts it in a chain-compile guard's DERIVED roster, and that
 *  guard's own-key mutation fault is anchored on that term by name. Route it
 *  through `patch()` and the roster drops it and the fault stops firing
 *  without saying so. Unifying the two shoulders is a package change that
 *  moves the guard and its fault with them.
 * ======================================================================== */

/**
 * ===========================================================================
 *  THE OTHER HALF OF AN LOD LADDER: COLLAPSE AN INSTANCE WHEN IT IS *NEAR*.
 * ===========================================================================
 *  `patchLod` removes an instance PAST a distance. A real ladder needs the
 *  complement — a low-poly stand-in that exists ONLY past that distance — or
 *  the two tiers are drawn on top of each other everywhere.
 *
 *  Why it is worth a shader term rather than a visibility flag: at 200-900 m an
 *  open lattice bay is forty-odd members each at or below the rasteriser's
 *  Nyquist limit, so what reaches the frame is not a lattice — it is a moiré of
 *  whichever facets landed on a sample centre, all at the same radiance, with
 *  no mass and no silhouette. Converging their value (`patchThinFade`) makes it
 *  a dimmer scribble; it is still a scribble. The only fix is to stop drawing
 *  the lattice out there and draw the SOLID it encloses instead, and that needs
 *  both halves of the swap.
 *
 *  The two tiers cross-fade over `d0..d1` by scaling toward the instance
 *  origin — the same mechanism and the same shape as `patchLod` — so a shell
 *  paired with an open bay at `lod = d1` swaps over inside one band with
 *  nothing popping and nothing double-drawn.
 *
 *  `aOrigin` is honoured for the same reason `patchLod` honours it: once a
 *  static merge has baked a set flat there is no `instanceMatrix` left to read
 *  the origin out of.
 */
export function patchNearFade(mat: THREE.Material, u: CamHost, d0: number, d1: number) {
  patch(mat, 'nearfade' + d0.toFixed(0) + d1.toFixed(0), (sh) => {
    sh.uniforms.uCam = u.uCam;
    sh.uniforms.uNear2 = { value: new THREE.Vector2(d0, d1) };
    sh.vertexShader = decl(sh.vertexShader, 'attribute vec3 aOrigin;\nuniform vec3 uCam;\nuniform vec2 uNear2;\n').replace('#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           {
             vec3 iOrigin = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
             transformed *= smoothstep(uNear2.x, uNear2.y, distance(iOrigin, uCam));
           }
         #else
           {
             vec3 oW = (modelMatrix * vec4(aOrigin, 1.0)).xyz;
             transformed = aOrigin + (transformed - aOrigin)
               * smoothstep(uNear2.x, uNear2.y, distance(oW, uCam));
           }
         #endif`);
  });
}

/**
 * Distance collapse for MERGED geometry, about a per-vertex anchor.
 *
 * ===========================================================================
 *  WHY A SWEPT RUN NEEDS THIS AND `patchLod` CANNOT PROVIDE IT.
 * ===========================================================================
 *  `patchLod` collapses whole INSTANCES about `instanceMatrix` or `aOrigin`. A
 *  swept run — a handrail that has to follow a deck's width and roll
 *  continuously — is deliberately not instanced, because one merged mesh is one
 *  draw call where a swept rail plus thousands of instanced posts would be
 *  three. But a merged mesh has no per-instance origin, so this takes the
 *  anchor from a per-vertex attribute instead: every vertex of one stanchion
 *  carries that stanchion's own base point, and past `fade0` the post shrinks
 *  into it.
 *
 *  The reason it exists at all is legibility at both ends at once. A 42 mm post
 *  every 1.80 m is a scale ruler in the near field and pure noise in the far
 *  field: at 200 m the pitch is under two pixels, so thousands of them stop
 *  being a handrail and become a field of similar-sized bright chips that
 *  crawls as the camera moves. Fade the posts and the run reverts to the
 *  continuous rail line it should be. The TOP RAIL is never faded — the edge of
 *  the deck must stay drawn — which is why this is per-material and the caller
 *  splits the buffer.
 */
export function patchAnchorFade(mat: THREE.Material, u: CamHost, fade0 = 45, fade1 = 110) {
  patch(mat, 'ancfade' + fade0.toFixed(0) + fade1.toFixed(0), (sh) => {
    sh.uniforms.uCam = u.uCam;
    sh.uniforms.uAncFade = { value: new THREE.Vector2(fade0, fade1) };
    sh.vertexShader = decl(sh.vertexShader, 'attribute vec3 aAnchor;\nuniform vec3 uCam;\nuniform vec2 uAncFade;\n').replace('#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec3 ancW = (modelMatrix * vec4(aAnchor, 1.0)).xyz;
           float f = smoothstep(uAncFade.x, uAncFade.y, distance(ancW, uCam));
           transformed = mix(transformed, aAnchor, f);
         }`);
  });
}

/**
 * The camera, plus HALF THE DRAWING BUFFER HEIGHT in pixels — the two halves of
 * a screen-space width test.
 *
 * With `projectionMatrix[1][1] == 1/tan(fovY/2)`, a world length `s` at view
 * depth `z` covers `s * P11 * uPxH / z` pixels. Both terms have to come from
 * somewhere: P11 the shader already has, the pixel height it does not, and a
 * resolution scaler moves it every time its ladder steps. Seed it at 540
 * (1080p) so a material that compiles before anything has ticked it produces a
 * sane width rather than an infinite one.
 *
 * Declared structurally, like `CamHost` above, so that no game's uniform block
 * has to cross the seam.
 */
export interface PixelHost extends CamHost {
  uPxH: { value: number };
}

/**
 * ===========================================================================
 *  SCREEN-SPACE MINIMUM WIDTH FOR A SWEPT THIN MEMBER, WITH THE RADIANCE
 *  SCALED DOWN BY THE SAME RATIO. THE STANDARD THIN-WIRE TRICK.
 * ===========================================================================
 *  `patchThinFade` converges a sub-pixel member to its correct MEAN, which is
 *  the right answer for a lattice of them where the mean is all the eye can
 *  use. It is the WRONG answer for a member whose job is to be a continuous
 *  LINE — a 42 mm rail tube — because the rasteriser has already thrown the
 *  line away by then: a 42 mm tube is one pixel at ~40 m and the fragment that
 *  survives is whichever facet happened to cover a sample centre, so the run
 *  breaks into dashes and then into nothing while the 1.10 m posts beside it,
 *  being 26x taller, keep hitting samples every time. No amount of dimming
 *  fixes it, because the problem is COVERAGE, not radiance.
 *
 *  The fix is the one every hair and wire renderer uses. Widen the geometry
 *  until it is at least `minPx` wide on screen, then divide its outgoing
 *  radiance by the same widening ratio. Total energy per unit length of the
 *  member is preserved exactly, so a rail at 200 m contributes the same light
 *  to the frame as it would if the rasteriser could resolve it — but it
 *  contributes it as a continuous 1.4 px line at a quarter of the radiance
 *  instead of as a broken 0.35 px line at full radiance.
 *
 *  IT EXPANDS ABOUT `aAnchor`, WHICH IS THE POINT ON THE MEMBER'S OWN AXIS AT
 *  THAT VERTEX. The same channel `patchAnchorFade` reads, and for the same
 *  reason: expanding about the mesh origin would inflate a 3 km run into a
 *  balloon. Anchor at the axis and the section grows while the centreline stays
 *  exactly where it was.
 *
 *  `w0` is the member's true diameter in metres. It is passed rather than
 *  measured because a merged run carries several sections (top rail, mid rail,
 *  post) and the widening has to be fitted to the THINNEST, or the thin one is
 *  still dashed while the thick one is over-dimmed.
 */
export function patchMinWidth(mat: THREE.Material, u: PixelHost, w0: number, minPx = 1.5) {
  patch(mat, 'minwid' + w0.toFixed(3) + minPx.toFixed(2), (sh) => {
    sh.uniforms.uCam = u.uCam;
    sh.uniforms.uPxH = u.uPxH;
    sh.uniforms.uMinW = { value: new THREE.Vector2(w0, minPx) };
    sh.vertexShader = decl(sh.vertexShader,
      'attribute vec3 aAnchor;\nuniform vec3 uCam;\nuniform float uPxH;\n'
      + 'uniform vec2 uMinW;\nvarying float vWiden;\n')
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec3 ancW = (modelMatrix * vec4(aAnchor, 1.0)).xyz;
           // View depth, not radial distance: the pixel footprint of a length
           // is set by z in the projection, and using the radial distance
           // under-widens by 1/cos(angle) at the frame edges — which is where
           // a deck edge sweeping past the camera actually lives.
           float vz = max(1.0, -(viewMatrix * vec4(ancW, 1.0)).z);
           float px = uMinW.x * projectionMatrix[1][1] * uPxH / vz;
           vWiden = max(1.0, uMinW.y / max(px, 1e-4));
           transformed = aAnchor + (transformed - aAnchor) * vWiden;
         }`);
    sh.fragmentShader = decl(sh.fragmentShader, 'varying float vWiden;\n').replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       // ENERGY, NOT TASTE. The member now covers vWiden times as many pixels
       // as it should, so it emits 1/vWiden of the radiance per pixel. Drop
       // this line and the widening is just a fatter, brighter rail — which is
       // the white wire along every deck edge the trick exists to remove.
       gl_FragColor.rgb /= vWiden;`
    );
  });
}

/**
 * Per-vertex-colour roughness, for MERGED geometry that carries a baked tint.
 *
 * `patchRoughFromTint` above reads `vTintI`, which only `patchTint` declares
 * and only an INSTANCED material has. A far tier is one merged mesh with a
 * per-block albedo baked into the vertex colour, so this reads that instead —
 * which is what makes "two adjacent panels never share a roughness" true at the
 * scale a far field is actually built at.
 */
export function patchRoughFromVColor(mat: THREE.Material, lo = 0.55, hi = 0.95) {
  patch(mat, 'roughvcol' + lo.toFixed(2) + hi.toFixed(2), (sh) => {
    sh.uniforms.uRvcRange = { value: new THREE.Vector2(lo, hi) };
    sh.fragmentShader = decl(sh.fragmentShader, 'uniform vec2 uRvcRange;\n').replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       #ifdef USE_COLOR
         {
           // the tint's own luminance, remapped across the ±7 % block jitter
           float bv = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
           float f = clamp((fract(bv * 14.0)), 0.0, 1.0);
           roughnessFactor = clamp(roughnessFactor * mix(uRvcRange.x, uRvcRange.y, f), 0.05, 1.0);
         }
       #endif`);
  });
}

/**
 * ===========================================================================
 *  A MEASURED VALUE CEILING ON THE PRESENTED RADIANCE. THE ONLY HONEST WAY TO
 *  KEEP A FAR FIELD DARKER THAN THE FOREGROUND UNDER A PARALLEL KEY.
 * ===========================================================================
 *  NOT THE SAME CURVE AS `./ValueCeiling.ts`'s `addValueCeiling`, and the two
 *  must not be conflated. That one is a KNEE'd exponential shoulder on the max
 *  channel and it leaves everything under the knee bit-identical; this one is a
 *  plain per-channel Reinhard, `x / (1 + x / C)`, which touches every value and
 *  asymptotes to `C`. The knee'd form is for *this surface must not cross the
 *  bloom threshold*; this form is for *this whole tier lives under a hard
 *  ceiling and keeps its internal shading below it*.
 *
 *  THE PROBLEM IT ANSWERS IS GEOMETRIC AND IT IS NOT A CONTENT MISTAKE. Under a
 *  low, PARALLEL key — a grazing sun or star, which does not fall off with
 *  distance at all — a horizontal foreground plane receives the key at
 *  sin(elevation) and a vertical far-tier face receives it at cos(elevation).
 *  At 6.5 degrees that is a factor of NINE in favour of the thing two
 *  kilometres away, before any env map is added, and no amount of vertex tint
 *  survives it: 0.62 x 9 is still brighter than the foreground. Tinting the
 *  ALBEDO cannot fix a ratio that lives in the geometry term. The measured
 *  symptom is a receding row of near-white slabs at display luma 0.85-1.0
 *  against a lit foreground at 0.15-0.30 — the value ladder inverted, and the
 *  compositional anchor handed to the least important object in the shot.
 *
 *  So the ladder is applied where it is measurable: on the outgoing
 *  scene-linear radiance, immediately after `opaque_fragment` and before the
 *  tonemap. Values well under the ceiling pass through nearly unchanged, so a
 *  shell keeps ALL of its internal form and shading; values above it asymptote
 *  instead of clipping flat. The result is a hard guarantee — this material can
 *  never present brighter than `ceil`, whatever the key, the probe or a
 *  terminator blowout do.
 *
 *  IT IS NOT FOG AND IT MUST NEVER BECOME FOG. Nothing is mixed toward grey and
 *  nothing is added; this is a multiply toward DARKER, which is the honest
 *  depth cue — *things far away are genuinely unlit* — expressed as the one
 *  term that can express it under a parallel source. A vacuum frame carrying
 *  distance haze is an automatic fail in these games' art directions, and this
 *  leaves the frame with none.
 *
 *  Returns the uniform so a caller can retune the ceiling without recompiling.
 */
export function patchReinhardCeiling(mat: THREE.Material, ceil: number) {
  const u = { value: Math.max(1e-5, ceil) };
  patch(mat, 'valceil' + ceil.toFixed(5), (sh) => {
    sh.uniforms.uValCeil = u;
    sh.fragmentShader = decl(sh.fragmentShader, 'uniform float uValCeil;\n').replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       // Reinhard with the tier's own white point. x/(1 + x/C) → C as x → ∞,
       // and → x as x → 0, so the shell's own shading survives underneath a
       // ceiling it can never cross.
       gl_FragColor.rgb = gl_FragColor.rgb / (1.0 + gl_FragColor.rgb / uValCeil);`
    );
  });
  return u;
}

/**
 * The fade's own `(d0, floorV)`, PER MATERIAL rather than captured in the
 * closure — because `clonePatched` re-registers the parent's closures against
 * the clone, so a captured pair would follow a shell material home from its
 * parent and could not be overridden.
 *
 * See `patchThinFade` for why a second application has to RETUNE rather than
 * stack.
 */
const THIN_FADE = new WeakMap<THREE.Material, { value: THREE.Vector2 }>();

/**
 * ===========================================================================
 *  COVERAGE-WEIGHTED FADE FOR SUB-PIXEL STRUCTURE. THE FIX FOR LATTICE
 *  ALIASING THAT IS NOT "MORE SAMPLES".
 * ===========================================================================
 *  A 0.34 m diagonal subtends one pixel at 1080p/60° at about 320 m and a
 *  0.90 m chord at about 840 m. Past that the member is genuinely narrower than
 *  the sample it is being resolved into, so the CORRECT presented value is its
 *  own radiance times its coverage fraction — exactly what a mip chain does for
 *  a texture, and exactly what the rasteriser refuses to do for geometry.
 *  Drawing it at full radiance instead is a 10-20x over-estimate per covered
 *  pixel, and that over-estimate is three separate findings at once:
 *
 *   · an overhead lattice renders as 1-pixel PURE WHITE lines,
 *   · those lines sit above the HDR bloom threshold, so an anamorphic pass
 *     smears every one of them into a streak,
 *   · and in motion the comb crawls and strobes.
 *
 *  No anti-aliasing setting fixes it, because SMAA resolves an EDGE and this is
 *  a sub-sample-frequency signal: there is no edge left to find. Converging the
 *  member to its correct mean is the only answer.
 *
 *  `d0` is the distance at which the material's THINNEST member reaches one
 *  pixel. `floorV` is the residual and it is NOT zero: a member that fades to
 *  nothing leaves a hole in the silhouette, which costs more than the aliasing.
 */
export function patchThinFade(mat: THREE.Material, u: CamHost, d0 = 320, floorV = 0.16) {
  // ======================================================================
  //  A SECOND CALL RETUNES THIS MATERIAL'S FADE. IT DOES NOT ADD ANOTHER.
  // ======================================================================
  //  The key used to carry `d0`/`floorV`, so two calls with different numbers
  //  read as two different patches and both were injected. What stacking two
  //  1/d corrections costs is measured: a shell material made by
  //  `clonePatched` of a parent carrying the 320 m fade, then asking for its
  //  own 640 m one, gets the product `cov²` — which walked a 600 m shell to a
  //  fifth of its intended value. It never rendered at all, because the
  //  duplicate declarations also failed the link, which is how it stayed
  //  invisible.
  //
  //  Retuning is what every call site actually wants: a clone inherits the
  //  parent's ramp and then states its own, which is one ramp with the last
  //  number stated. The uniform object is per material and looked up at
  //  compile time, so the parent keeps 320 m while its clone gets 640 m.
  const prior = THIN_FADE.get(mat);
  if (prior) {
    prior.value.set(d0, floorV);
    mat.needsUpdate = true;
    return;
  }
  const uThin = { value: new THREE.Vector2(d0, floorV) };
  THIN_FADE.set(mat, uThin);
  patch(mat, 'thinfade', (sh, _renderer, m) => {
    sh.uniforms.uCam = u.uCam;
    // `m` is the material being compiled, which is NOT `mat` when this closure
    // was re-registered onto a clone. Fall back to the material this call was
    // made for when a clone has never stated a fade of its own.
    sh.uniforms.uThin = (m && THIN_FADE.get(m)) || uThin;
    sh.vertexShader = decl(sh.vertexShader, 'varying vec3 vThinPos;\n').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         vec4 tW = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           tW = instanceMatrix * tW;
         #endif
         vThinPos = (modelMatrix * tW).xyz;
       }`
    );
    sh.fragmentShader = decl(sh.fragmentShader, 'varying vec3 vThinPos;\nuniform vec3 uCam;\nuniform vec2 uThin;\n').replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
         {
           // Coverage falls as 1/d for a member of fixed section, so the ramp
           // is RECIPROCAL in distance and not a linear lerp between two
           // numbers. A linear ramp converges far too slowly and leaves the
           // comb fully bright across the band where it is worst.
           float dC = distance(vThinPos, uCam);
           float cov = clamp(uThin.x / max(dC, 1.0), 0.0, 1.0);
           gl_FragColor.rgb *= max(uThin.y, cov);
         }`
      );
  });
  // `patch` skips the registration when a clone already carries the key, and
  // skips `needsUpdate` with it. The uniform above is new either way, so the
  // material has to recompile either way.
  mat.needsUpdate = true;
}

/**
 * The thin-fade register, exported by identity so the retune rule can be
 * asserted from outside — the same contract as `valueCeilingClaim` in
 * `./ValueCeiling.ts`.
 */
export { THIN_FADE as thinFadeRegister };

/**
 * ===========================================================================
 *  THE EIGHT ANIMATION-AND-DEPTH PATCHERS FROM THE KART RACER'S `Props.ts`
 * ===========================================================================
 *  Every one of these had exactly ONE copy, in a directory (every game's own
 *  `src/world` directory) that earlier duplication scans did not read at all,
 *  on the theory that a world is content. Read: it is not. Each of the eight is
 *  describable without naming one single thing in that game's fiction —
 *
 *    patchWind          per-vertex sway from a (phase, stiffness, refHeight,
 *                       flutter) attribute, in world metres, divided back out
 *                       through the instance scale
 *    patchTranslucency  wrap diffuse + a back-scatter lobe + a UV-derived
 *                       thickness term, i.e. subsurface for a one-sided card
 *    patchBob           per-instance heave/roll/pitch about the instance origin
 *    patchCrowd         per-instance idle + a staggered hop keyed to a 0..1
 *                       excitement uniform
 *    patchCloth         a two-harmonic travelling wave rooted at uv.x = 0
 *    patchBird          per-instance circular flight with a span-weighted flap
 *    patchAerial        distance haze: chroma before value, thinned with
 *                       altitude, warm into the sun and cool away from it
 *    patchBackdropForm  a per-pixel VALUE ladder in camera distance, plus
 *                       three macro octaves and an albedo-space terminator
 *
 *  — and the doc comments below argue in wrap fractions, Beer rates, Nyquist
 *  limits and the ACES shoulder. The illustrations are the kart racer's,
 *  because that is the only copy that had any and re-writing them into
 *  something true of no world would throw away the reasoning; they are labelled
 *  as one game's.
 *
 *  WHAT DID NOT CROSS, AND WHY. Three colours. `patchTranslucency` transmits a
 *  chlorophyll green, `patchAerial` mixes between a golden-hour warm and a
 *  violet-grey cool, and those are art-direction palette entries — the game
 *  binds them at its own seam and hands them in. Nothing here reads a palette.
 *
 *  NOTHING HERE BRANCHES ON WHICH GAME CALLED IT, which is the same rule the
 *  head of this file states, and every uniform block arrives through a
 *  structural interface so no game's `Shared` crosses the seam.
 * ===========================================================================
 */

/** The three fields of a game's uniform block that `patchWind` reads. */
export interface WindHost {
  uTime: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uWindAmp: { value: number };
}
/** `patchBob` and `patchBird` read the clock and nothing else. */
export interface TimeHost {
  uTime: { value: number };
}
/** `patchCloth` scales its wave by the same wind amplitude the foliage uses. */
export interface ClothHost extends TimeHost {
  uWindAmp: { value: number };
}
/** `patchCrowd`'s excitement term: 0 is an idle stand, 1 is a full cheer. */
export interface CheerHost extends TimeHost {
  uCheer: { value: number };
}
/** The key direction and colour in VIEW space, which is where lighting is. */
export interface SunViewHost {
  uSunView: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
}
/** The same key in WORLD space, plus the camera — what a haze term needs. */
export interface SunWorldHost extends CamHost {
  uSunWorld: { value: THREE.Vector3 };
}

/**
 * Wind sway. aWind = (phase, stiffness exponent, reference height, flutter).
 * Trunks and their fronds evaluate the identical curve so a palm crown and the
 * fronds attached to it never separate.
 */
export function patchWind(mat: THREE.Material, u: WindHost, flutterAxis = 0) {
  patch(mat, 'wind' + flutterAxis, (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uWindDir = u.uWindDir;
    sh.uniforms.uWindAmp = u.uWindAmp;
    sh.vertexShader =
      `attribute vec4 aWind;
       uniform float uTime; uniform vec2 uWindDir; uniform float uWindAmp;
       float kartSway(float phase, float h, float stiff){
         float t = uTime * 1.15 + phase;
         float a = sin(t) * 0.62 + sin(t * 1.73 + 1.3) * 0.27 + sin(t * 3.31 + 2.1) * 0.11;
         return a * pow(max(h, 0.0), stiff) * uWindAmp;
       }\n` +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           float instS = 1.0;
           #ifdef USE_INSTANCING
             instS = length(instanceMatrix[1].xyz);
           #endif
           // A positive reference height lets a detached part (a frond) inherit
           // the sway its parent (the trunk) has at the attachment point. Both
           // work in WORLD metres, and the offset is divided back out through
           // the instance scale, so a crown and its fronds never separate.
           float hRef = aWind.z > 0.0 ? aWind.z : transformed.y * instS;
           float s = kartSway(aWind.x, hRef, max(aWind.y, 0.001)) * 0.09;
           transformed.xz += uWindDir * s / max(instS, 0.001);
           // flutter: high-frequency ripple along the leaf's own length
           float fl = aWind.w * 0.055 * sin(uTime * 5.4 + aWind.x * 3.0 + transformed.${flutterAxis === 0 ? 'x' : 'z'} * 2.6);
           transformed.y += fl;
           transformed.${flutterAxis === 0 ? 'z' : 'x'} += fl * 0.6;
         }`
      );
  });
}

/**
 * Backlit leaf translucency — the low sun through palm fronds (the kart
 * racer's art direction: "palms backlit at golden hour is a hero moment, do
 * not waste it").
 *
 * Three terms, and all three matter:
 *   • wrap diffuse `(NdotL + w)/(1 + w)` with w = 0.5, so the terminator wraps
 *     around a one-sided blade instead of clipping at NdotL = 0. This is what
 *     stops a tree crown reading as one flat value.
 *   • a back-scatter lobe on `dot(-viewDir, lightDir)^4` — light that has
 *     travelled THROUGH the blade toward the eye.
 *   • a thickness term from the card's own UV: the rachis is opaque, the tips
 *     and the leaflet edges are one cell thick and light up first.
 *
 * `sap` IS THE CALLER'S, AND IT IS THE REASON THIS TAKES A COLOUR AT ALL.
 * Transmitted light has to be tinted hard toward the material's own
 * transmission colour — chlorophyll absorbs far less in the yellow-green, so a
 * backlit leaf is never just a brighter version of its own albedo — and which
 * green that is, is a palette entry and not a property of the model. Hand in a
 * LINEAR colour: the kart racer's first version hard-coded an sRGB triple
 * straight into the shader, where everything is linear, and the sap read a full
 * stop too bright and washed toward white instead of glowing green.
 */
export function patchTranslucency(mat: THREE.Material, u: SunViewHost, sap: THREE.Color, strength = 1.0) {
  patch(mat, 'trans', (sh) => {
    sh.uniforms.uSunView = u.uSunView;
    sh.uniforms.uSunCol = u.uSunCol;
    sh.uniforms.uTransStrength = { value: strength };
    sh.uniforms.uSap = { value: sap };
    sh.vertexShader = 'varying vec2 vLeafUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vLeafUv = uv;');
    sh.fragmentShader =
      'uniform vec3 uSunView; uniform vec3 uSunCol; uniform float uTransStrength; uniform vec3 uSap;\nvarying vec2 vLeafUv;\n' +
      sh.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           // vViewPosition points from the fragment TOWARD the eye, so -V is the
           // view direction and dot(-V, L) fires only when the leaf sits between
           // the camera and the sun — which is exactly the backlit-palm case.
           vec3 V = normalize(vViewPosition);
           // Wrap widened 0.55 -> 0.60 of a hemisphere. This is the term that
           // decides whether a canopy has any light in it at all when the sun is
           // not directly behind it, and the umbrella pine in a reviewed scenery frame — lit
           // from three-quarter rear, silhouetted against a pale sky — came back
           // as a flat dark cut-out. Wrap lighting is what a leaf actually does:
           // light entering the far side scatters through and leaves the near
           // side, so the terminator on a leaf sits well past 90°.
           float wrap = clamp((dot(normal, uSunView) + 0.60) / 1.60, 0.0, 1.0);
           float back = pow(clamp(dot(-V, uSunView), 0.0, 1.0), 3.0);
           // clamped so solid-geometry foliage (uv tiles past 1) stays neutral
           float lu = clamp(vLeafUv.x, 0.0, 1.0);
           float lv = clamp(vLeafUv.y, 0.0, 1.0);
           // thin toward the frond tip and toward the leaflet edges: that is the
           // part of a palm that actually goes translucent
           float thin = mix(0.42, 1.0, lu) * mix(0.5, 1.0, abs(lv - 0.5) * 2.0);
           vec3 sap = mix(diffuseColor.rgb, uSap, 0.62);
           reflectedLight.directDiffuse += uSunCol * sap * back * 3.8 * thin * uTransStrength;
           // 0.42 -> 0.80. The art bible calls a backlit palm at golden hour "a hero
           // moment — do not waste it", and at 0.42 the wrap was contributing
           // roughly a tenth of a stop against a 4.2-intensity key: arithmetically
           // present, visually absent. This is the whole difference between a
           // canopy that glows and a green sticker.
           reflectedLight.directDiffuse += uSunCol * mix(diffuseColor.rgb, uSap, 0.34) * wrap * 0.80 * uTransStrength;
         }`
      );
  });
}

/** Boats: vertical bob + roll about the instance origin, on the GPU. */
export function patchBob(mat: THREE.Material, u: TimeHost) {
  patch(mat, 'bob', (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = 'attribute vec4 aBob;\nuniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float t = uTime * 0.9 + aBob.y;
         float heave = (sin(t) * 0.7 + sin(t * 1.62 + 1.1) * 0.3) * aBob.x;
         float roll  = sin(t * 0.83 + 0.6) * aBob.z;
         float pitch = sin(t * 1.21 + 2.4) * aBob.z * 0.55;
         float cr = cos(roll), sr = sin(roll);
         float cp = cos(pitch), sp = sin(pitch);
         vec3 q = transformed;
         q = vec3(q.x * cr - q.y * sr, q.x * sr + q.y * cr, q.z);
         q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
         transformed = q + vec3(0.0, heave, 0.0);
       }`
    );
  });
}

/** Crowd idle + cheer. aWind.x is the per-spectator phase. */
export function patchCrowd(mat: THREE.Material, u: CheerHost) {
  patch(mat, 'crowd', (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uCheer = u.uCheer;
    sh.vertexShader = 'attribute vec4 aWind;\nuniform float uTime; uniform float uCheer;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float ph = aWind.x;
         float idle = sin(uTime * 1.7 + ph) * 0.018 + sin(uTime * 2.9 + ph * 1.7) * 0.008;
         // cheer: a sharp hop, staggered so the stand ripples instead of pulsing
         float ct = fract(uTime * 0.7 + ph * 0.11);
         float hop = max(0.0, sin(ct * 3.14159)) * uCheer * (0.25 + aWind.w * 0.35);
         float sway = sin(uTime * 1.1 + ph * 0.7) * 0.035 * (0.4 + uCheer);
         transformed.y += idle + hop;
         transformed.x += sway * smoothstep(0.4, 1.6, transformed.y);
         // arms up when cheering: the arm verts are flagged via uv.y > 0.92
         transformed.y += step(0.92, uv.y) * uCheer * 0.34;
       }`
    );
  });
}

/** Cloth wave for flags, banners and laundry. */
export function patchCloth(mat: THREE.Material, u: ClothHost, amp = 1) {
  patch(mat, 'cloth' + amp.toFixed(2), (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uWindAmp = u.uWindAmp;
    sh.uniforms.uClothAmp = { value: amp };
    sh.vertexShader = 'attribute vec4 aWind;\nuniform float uTime; uniform float uWindAmp; uniform float uClothAmp;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float u0 = uv.x;                     // 0 at the mast / line, 1 at the free edge
         float ph = aWind.x;
         float w = sin(u0 * 7.0 - uTime * 4.2 + ph) * 0.5 + sin(u0 * 12.0 - uTime * 6.7 + ph * 1.7) * 0.22;
         float g = u0 * u0;                   // rooted edge stays put
         transformed.z += w * g * 0.30 * uClothAmp * uWindAmp;
         transformed.y += sin(u0 * 5.0 - uTime * 3.1 + ph) * g * 0.07 * uClothAmp * uWindAmp;
         transformed.x -= g * 0.035 * uClothAmp * abs(w);
       }`
    );
  });
}

/** Gulls: each instance flies its own circle, wings flap. Zero CPU. */
export function patchBird(mat: THREE.Material, u: TimeHost) {
  patch(mat, 'bird', (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = 'attribute vec4 aBob;\nuniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         // aBob = (orbit radius, angular speed, phase, flap rate)
         float a = uTime * aBob.y + aBob.z;
         float flap = sin(uTime * aBob.w + aBob.z * 3.0);
         // wing dihedral from |uv.x - 0.5|, the span coordinate
         float span = abs(uv.x - 0.5) * 2.0;
         transformed.y += flap * span * span * 0.42;
         transformed.z -= flap * span * 0.06;
         float ca = cos(a), sa = sin(a);
         vec3 q = vec3(transformed.x * ca - transformed.z * sa, transformed.y, transformed.x * sa + transformed.z * ca);
         transformed = q + vec3(sa * aBob.x, sin(a * 2.0 + aBob.z) * 1.6, -ca * aBob.x);
       }`
    );
  });
}

/**
 * Aerial perspective for a distant backdrop.
 *
 * A ROOT FIX FROM THE KART RACER. The previous version injected at
 * `<dithering_fragment>`, which is AFTER `<fog_fragment>` — so it ran last and
 * overwrote the scene fog with a single constant warm cream at up to 78%
 * strength. That game's sky fog is a height-attenuated Beer integral whose
 * colour is sampled per view azimuth out of the actual atmosphere model; it
 * already lands the backdrop layers at roughly 21% / 45% / 78% / 92% haze at
 * 250 m / 600 m / 1.5 km / 4 km. That ladder IS the depth cue, and stamping one
 * cream value on top of it is exactly why every distant hill came out the same
 * tan and read as cardboard.
 *
 * So this injects BEFORE `<fog_fragment>` and does only the half of aerial
 * perspective a fog lerp cannot do on its own:
 *   · saturation collapses faster than value — the first thing distance takes
 *     off a landform is its colour, not its brightness;
 *   · the residual tint is warm looking into the sun and cool looking away from
 *     it, matching what a sky's own haze does at a low key elevation, so the two
 *     agree at the horizon instead of meeting at a seam;
 *   · the haze layer thins with altitude, so a summit stays crisper than the
 *     valley under it and one landform separates from itself.
 * The scene fog then runs on top and carries the convergence.
 *
 * `warm` and `cool` ARE THE CALLER'S. They are the two ends of that game's own
 * horizon — a palette decision, and the one part of this that is not physics.
 */
export function patchAerial(
  mat: THREE.Material, u: SunWorldHost,
  near = 220, far = 4400,
  warm: THREE.ColorRepresentation = 0xffffff, cool: THREE.ColorRepresentation = 0xffffff,
) {
  patch(mat, 'aerial', (sh) => {
    sh.uniforms.uCam = u.uCam;
    sh.uniforms.uSunW = u.uSunWorld;
    sh.uniforms.uAerial = { value: new THREE.Vector2(near, far) };
    sh.uniforms.uHazeWarm = { value: new THREE.Color(warm) };
    sh.uniforms.uHazeCool = { value: new THREE.Color(cool) };
    sh.vertexShader = 'varying vec3 vWorldA;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWorldA = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader =
      'varying vec3 vWorldA; uniform vec3 uCam; uniform vec2 uAerial; uniform vec3 uSunW; uniform vec3 uHazeWarm; uniform vec3 uHazeCool;\n' +
      sh.fragmentShader.replace(
        '#include <fog_fragment>',
        `{
           float d = distance(vWorldA, uCam);
           float h = smoothstep(uAerial.x, uAerial.y, d);
           // the haze is a LAYER: thin it with altitude so summits stay crisper
           h *= mix(1.0, 0.40, clamp((vWorldA.y - uCam.y) / 400.0, 0.0, 1.0));
           vec3 fwd = vWorldA - uCam; fwd.y = 0.0;
           vec3 sunXZ = vec3(uSunW.x, 0.0, uSunW.z);
           float az = dot(normalize(fwd + vec3(1e-4, 0.0, 1e-4)), normalize(sunXZ + vec3(1e-4, 0.0, 1e-4)));
           // The azimuth ramp used to open at az = -0.45, i.e. 117
           // degrees off the sun, so five sixths of the horizon was being
           // painted with the WARM haze key. Combined with the desaturation
           // below that is a machine for turning any authored colour into the
           // same orange, and it is the direct cause of "four separate ranges
           // at four different distances all render as the same solid orange".
           // Golden hour genuinely is warm looking INTO the sun and violet-blue
           // looking away from it, and that contrast across the sky is most of
           // what makes the hour look like the hour. Narrowed to the near-sun
           // sector so the ladder gets both ends of it.
           vec3 haze = mix(uHazeCool, uHazeWarm, smoothstep(0.15, 0.92, az));
           float l = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
           // 0.82 -> 0.42. Aerial perspective does desaturate, but 82% at the
           // far band destroyed the band keys BEFORE the haze tint ran, so the
           // ladder's hue separation never survived to be seen — every layer
           // arrived as neutral grey and left painted with the same haze. The
           // band table's own pre-fade (see BACKDROP_BANDS) now carries the
           // convergence, and it can do it per band, which this cannot.
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l), h * 0.42);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, h * 0.34);
         }
         #include <fog_fragment>`
      );
  });
}

/**
 * ============================================================================
 *  patchBackdropForm — THE KART RACER'S ROOT FIX FOR "EVERY LANDFORM IS A
 *  FLAT ORANGE FILL AND ALL FOUR BANDS COLLAPSE INTO ONE PLANE".
 * ============================================================================
 *  The band table was authored as a HUE ladder — warm stone, neutral,
 *  blue-grey, violet-blue — on the assumption that hue is the one thing
 *  distance cannot take away. That assumption is false in this renderer, and
 *  measurably so. That game's sky fog rotates every fragment onto the haze's
 *  own chromaticity at 1.85x the Beer rate, capped at 0.96:
 *
 *      krDrained = krHazeCol * ( krOwnL / krHazeL )
 *
 *  i.e. it KEEPS THE FRAGMENT'S LUMINANCE AND THROWS ITS HUE AWAY. At the near
 *  band (~580 m) that is already 79% of the way there; from the range band out
 *  it is saturated. So by the time a ridge reaches the frame, the only channel
 *  that has survived is VALUE — and the four bands were authored at luminances
 *  of 0.66 / 0.61 / 0.62 / 0.68. Four ranges at four distances, all the same
 *  brightness, all painted the same orange by the haze. Cut paper, exactly as
 *  reported, and no amount of hue authoring could ever have fixed it.
 *
 *  Two things follow, and both live here:
 *
 *  (1) THE LADDER HAS TO BE A VALUE LADDER. Aerial perspective in paint is a
 *      value ramp: the nearest headland is the darkest thing on the horizon and
 *      each successive ridge steps up toward the sky. This applies that ramp to
 *      the SHADED result, per pixel, keyed off camera distance — so it is one
 *      continuous ramp rather than four steps, and two ridges of the same band
 *      at different depths still separate from each other.
 *
 *  (2) THE BACKDROP WAS ALSO SIMPLY TOO BRIGHT. Lit by a 4.2-intensity key on a
 *      pale albedo, every ridge was landing in the top of the ACES shoulder,
 *      where the grade's own highlight-desaturation rolloff crushes both
 *      contrast AND chroma. All of the landform's strata, scrub patches, spur
 *      ribs, toe AO and sun-catch rim were being computed and then flattened by
 *      the tone curve. Pulling the near end of the ladder down to ~0.42 moves
 *      the whole horizon back onto the straight part of the curve, and every one
 *      of those terms becomes visible again for free.
 *
 *  On top of that it adds what a single 12–160 m-per-tile rock map cannot: three
 *  macro octaves at 70 / 22 / 6 m, a vertical strata gradient, and an explicit
 *  sunlit-face vs shaded-face albedo split. The split is deliberately an ALBEDO
 *  term, not a light term: at this triangle density the real key has almost no
 *  normal variation to model with, which is the literal reason the faces read as
 *  one value. Per-pixel form colour is what fills that in.
 *
 *  `shade` and `sun` are RATIOS, not colours, which is why they have defaults
 *  here where the two hazes in `patchAerial` do not: they multiply whatever
 *  albedo the band already has and are balanced about 1.0, so they add a
 *  terminator without moving the band's hue or its overall exposure. A game
 *  whose shadows are not this cool passes its own.
 */
export function patchBackdropForm(
  mat: THREE.Material, u: SunWorldHost,
  nearD = 260, farD = 2400, nearV = 0.42, farV = 0.78,
  shade = new THREE.Vector3(0.70, 0.76, 0.90), sun = new THREE.Vector3(1.18, 1.12, 0.99),
) {
  patch(mat, 'bdform', (sh) => {
    sh.uniforms.uCamF = u.uCam;
    sh.uniforms.uSunF = u.uSunWorld;
    sh.uniforms.uBdVal = { value: new THREE.Vector4(nearD, farD, nearV, farV) };
    // Deliberately plain multipliers rather than THREE.Colors: these are a
    // RATIO applied to whatever albedo the band already has, and a hex colour
    // would drag every band toward one hue and undo the ladder. -25% toward the
    // shadow teal on the away-flanks, +16% warm on the sun-facing ones, which
    // is the terminator contrast the kart racer's note asks for and is balanced
    // about 1.0 so it does not change the band's overall exposure.
    sh.uniforms.uBdShade = { value: shade };
    sh.uniforms.uBdSun = { value: sun };
    sh.vertexShader =
      'varying vec3 vBdW; varying vec3 vBdN;\n' +
      sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vBdN = normalize(mat3(modelMatrix) * objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader =
      `varying vec3 vBdW; varying vec3 vBdN;
       uniform vec3 uCamF; uniform vec3 uSunF; uniform vec4 uBdVal;
       uniform vec3 uBdShade; uniform vec3 uBdSun;
       float bdH(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 41.3); return fract(p.x * p.y); }
       float bdN2(vec2 p){
         vec2 i = floor(p), f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         return mix(mix(bdH(i), bdH(i + vec2(1.0, 0.0)), f.x),
                    mix(bdH(i + vec2(0.0, 1.0)), bdH(i + vec2(1.0, 1.0)), f.x), f.y);
       }\n` +
      sh.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           {
             // Three macro octaves. Sampled on the world XZ plane plus altitude,
             // so a flank reads as bedded rock rather than as a projected
             // wallpaper, and none of them is finer than 6 m — anything smaller
             // than that is below a pixel at 600 m and can only alias.
             vec2 q = vBdW.xz + vBdW.y * 0.42;
             float o1 = bdN2(q / 70.0);
             float o2 = bdN2(q / 22.0 + 13.7);
             float o3 = bdN2(q / 6.0 - 41.1);
             float macro = o1 * 0.54 + o2 * 0.31 + o3 * 0.15;
             // Strata: horizontal bedding, warped by the coarse octave so the
             // bands wander with the rock instead of ruling round the landform.
             float bed = sin((vBdW.y + o1 * 26.0) * 0.19) * 0.5 + 0.5;
             diffuseColor.rgb *= 0.78 + macro * 0.44 + bed * 0.10;
             // SUNLIT FACE vs SHADED FACE. An albedo-space terminator, because
             // the real key has almost no normal variation to work with out here.
             float sf = dot(normalize(vBdN), uSunF);
             float lit = smoothstep(-0.30, 0.55, sf);
             diffuseColor.rgb *= mix(uBdShade, uBdSun, lit);
             // and a warm rim on the faces that actually turn into the sun
             diffuseColor.rgb *= 1.0 + vec3(0.16, 0.11, 0.03) * smoothstep(0.58, 0.95, sf);
           }`
        )
        .replace(
          '#include <fog_fragment>',
          `{
             // THE VALUE LADDER. Applied to the shaded result and before any fog,
             // so the haze's luminance-preserving chroma drain carries it intact.
             float bdD = distance(vBdW, uCamF);
             float bdT = smoothstep(uBdVal.x, uBdVal.y, bdD);
             gl_FragColor.rgb *= mix(uBdVal.z, uBdVal.w, bdT);
           }
           #include <fog_fragment>`
        );
  });
}


/* ===========================================================================
 *  THE ROAD-SURFACE FAMILY — four injections out of the kart racer's
 *  `TrackGeometry.ts`.
 * ===========================================================================
 *  An earlier scan read that game's world directory for the first time and
 *  flagged these without moving them, because moving them is a BEHAVIOUR CHANGE
 *  and had to be one. All four ASSIGNED `onBeforeCompile` themselves and
 *  hand-composed a cache-key SUFFIX — `'|flat34_125'`, `'|vrough'`, `'|matte'`,
 *  `'|cobdtl'` — onto whatever the incumbent returned, which is the shape
 *  `patchSpecCeiling` is still stuck in two hundred lines up and the shape
 *  `patchThinFade` records the cost of.
 *
 *  WHAT MOVED AND WHAT DID NOT. The GLSL is byte-identical, every uniform is
 *  packed in the same order with the same values, and every chunk anchor is the
 *  one the game chose. A track-patch probe drives the pinned pre-move source
 *  against these four at the game's OWN call-site arguments and compares
 *  emitted vertex text, fragment text and every uniform leaf with `Object.is`,
 *  -0 distinct from 0, no epsilon.
 *
 *  THE CACHE KEY IS THE ONE THING THAT MOVED, DELIBERATELY, AND IT IS MEASURED
 *  RATHER THAN WAVED AT. `patch()` joins its keys with `|` from a list and puts
 *  a captured incumbent in front as `base:<its key>`; the game concatenated a
 *  suffix. So `'|flat34_125'` becomes `'flat34_125'`, and on a material that
 *  already had a hook it becomes `'base:<incumbent>|flat34_125'`. THE STRING IS
 *  NOT THE PROPERTY THAT MATTERS — what three.js does with
 *  `customProgramCacheKey` is PARTITION materials into programs, so the thing
 *  that must not move is which pairs of materials share a key and which do not.
 *  Section 4 of that probe asserts exactly that: over the game's full live call
 *  set plus the stacking and same-key cases, every pair that agreed before
 *  agrees now and every pair that differed before differs now. A key string
 *  that changed while the partition held costs nothing; a partition that
 *  collapsed would put two different programs on one compile, and the
 *  probe's key-collision fault is what watching that go red looks like.
 *
 *  WHY `patch()` AND NOT THE HAND-ROLLED CHAIN. `THREE.Material.clone()` drops
 *  an assigned `onBeforeCompile` — see `clonePatched` above, which is the
 *  white-rectangle bug — so every one of these was one `.clone()` away
 *  from vanishing with no error and a frame that renders. Section 6 of the
 *  probe clones a material carrying all four and asserts the clone emits the
 *  identical shader, and asserts the PINNED versions lose theirs, which is the
 *  defect being closed rather than a property being restated.
 *
 *  WHAT DID NOT COME, and it is sized rather than skipped: that game's
 *  `injectTerrainMacro`. It is the only one of the five that assigns without
 *  chaining AND bakes its `amount` into the GLSL as a literal instead of a
 *  uniform, so `patch()`'s dedupe-by-key would make two amounts on one material
 *  two closures that both declare `vMacroWP`, `mcHash`, `mcNoise` and `mcFbm` —
 *  a GLSL redefinition, which is the exact failure `patchMacroBreak` above
 *  documents and guards. Fixing it means include guards, which is a change to
 *  the emitted text, which is a before-and-after of its own. It is also a
 *  near-twin of `patchMacroBreak` — world-space low-frequency albedo breakup —
 *  with a different hash, a different octave ratio, a roughness octave
 *  `patchMacroBreak` has not got and a warm/cool split it has not got either.
 *  Publishing it beside `patchMacroBreak` unexamined would put two world-space
 *  breakup patchers on one shelf, and reconciling them moves pixels in two
 *  games. That is its own change.
 *
 *  NOTHING HERE BRANCHES ON WHICH GAME CALLED IT — every literal is a DISTANCE,
 *  a ROUGHNESS, a UV RATE or a WEIGHT the caller supplies or the technique
 *  fixes. The doc comments illustrate with a kerb, a cold joint and a sett,
 *  because that is the surface they were written against and sanding the
 *  examples off would make them true of nothing.
 * ======================================================================== */

/**
 * Fade a high-contrast repeating pattern toward its own tile average with view
 * distance.
 *
 * The kerb was the noisiest thing in every frame of the kart racer's first
 * version, and the cause is not anisotropy — that game's material library sets
 * `anisotropy = min(8, maxAnisotropy)` on every map it bakes, and it mips them
 * all. The cause is that 500 mm red/white bands are a *full-contrast* signal
 * that stays full-contrast forever: the tarmac had a `settle` ramp (34-95 m,
 * fading the fine octave into a high mip) and the kerb had none, so past ~40 m
 * the stripe is being sampled well under Nyquist with nothing damping it.
 * Anisotropic filtering actively makes that worse, because it holds a *low* mip
 * at exactly the grazing angles a chase camera lives at.
 *
 * So: lerp albedo toward the tile mean — a flat pink-grey — over the same
 * distance band. Near kerbs keep every stripe; far kerbs go smooth instead of
 * fizzing. Costs one varying and one mix.
 *
 * `near`/`far` are in the key, so two bands on one material are two keys and
 * both closures run — see the note above, and Section 5 of the probe, which
 * measures that rather than assuming it.
 */
export function patchDistanceFlatten(mat: THREE.Material, near: number, far: number, mean: THREE.Color) {
  const uFade = { value: new THREE.Vector2(near, far) };
  const uMean = { value: mean.clone() };
  patch(mat, `flat${near}_${far}`, (sh) => {
    sh.uniforms.uFlatFade = uFade;
    sh.uniforms.uFlatMean = uMean;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFlatD;')
      // mvPosition is in scope straight after project_vertex, instancing included
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFlatD = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vFlatD;\nuniform vec2 uFlatFade;\nuniform vec3 uFlatMean;',
      )
      // after color_fragment diffuseColor is albedo x vertex colour and nothing
      // else has happened to it yet, which is exactly where a mip-style fade goes
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
          'diffuseColor.rgb = mix( diffuseColor.rgb, uFlatMean,\n' +
          '  smoothstep( uFlatFade.x, uFlatFade.y, vFlatD ) );',
      );
  });
}

/**
 * Per-vertex roughness offset, from an `aRough` float attribute.
 *
 * A vertex colour reaches albedo and nothing else, so a long ribbon of one
 * material has no gloss break in it anywhere except at a material seam. One
 * attribute, one varying, one add — no texture, no draw call, no extra state.
 *
 * THE INSERTION POINT IS THE WHOLE DECISION AND IT IS NOT THE OBVIOUS ONE. It
 * is `lights_physical_fragment`, not `roughnessmap_fragment`, because a
 * material library's own surface injection may already have rewritten that
 * chunk (the kart racer's clamps a roughness floor and settles roughness with
 * distance) — AND A `replace` AGAINST A CHUNK SOMEBODY ELSE HAS ALREADY
 * CONSUMED IS A SILENT NO-OP. `lights_physical_fragment` is the chunk that
 * actually *reads* `roughnessFactor`, so landing immediately before it composes
 * correctly with whatever ran upstream, and is the last point at which it can.
 */
export function patchVertexRoughness(mat: THREE.Material): void {
  patch(mat, 'vrough', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aRough;\nvarying float vRoughAdj;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvRoughAdj = aRough;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRoughAdj;')
      .replace('#include <lights_physical_fragment>',
        'roughnessFactor = clamp( roughnessFactor + vRoughAdj, 0.06, 1.0 );\n'
        + '#include <lights_physical_fragment>');
  });
}

/**
 * THE SAME TERM AT THE OTHER ANCHOR, AND THEY ARE NOT INTERCHANGEABLE.
 *
 * `patchVertexRoughness` above splices before `<lights_physical_fragment>`,
 * which is the LAST point at which `roughnessFactor` can be touched and is the
 * right answer when a material library has already rewritten
 * `<roughnessmap_fragment>` out from under you. This one splices right AFTER
 * `<roughnessmap_fragment>`, which is the right answer when something else on
 * the material is going to touch roughness BETWEEN the two chunks and is
 * supposed to see the per-vertex offset already applied — `patchRoughVary` is
 * exactly that, and it is on three of the five surfaces the space racer calls
 * this on. Choosing the other anchor there does not move the offset; it moves
 * what the offset composes with, which is a different picture and not a tidier
 * one.
 *
 * The floors also differ (0.06 there, this one's is the caller's) and that is
 * downstream of the same choice: a floor applied before a variation term and a
 * floor applied after it bound different things.
 *
 * Two anchors, two functions, one sentence each saying which. Lifted verbatim
 * out of the space racer's `TrackGeometry.ts`, where it was a
 * hand-rolled second copy of `patch()` — it captured the incumbent hook by
 * hand and hand-appended `'|vrough'` to the cache key, beside a `patch()` its
 * own neighbours in that file already imported.
 */
export function patchVertexRoughnessAtMap(mat: THREE.Material, floorV: number): void {
  patch(mat, 'vroughmap' + floorV.toFixed(3), (sh) => {
    sh.vertexShader = 'attribute float aRough;\nvarying float vRough;\n'
      + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vRough = aRough;');
    sh.fragmentShader = 'varying float vRough;\n'
      + sh.fragmentShader.replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + vRough, ${floorV}, 1.0);`);
  });
}

/**
 * Matte-out mask from an `aMatte` float attribute: where it is 1, drop the
 * normal-map perturbation back to the interpolated surface normal and push
 * roughness to 0.94.
 *
 * WHY THIS IS A CORRECTNESS TERM AND NOT A LOOK. The kart racer's first version
 * shipped "two crisp reddish-brown lines crossing the banked corner in a long
 * X" that a review read as a mesh seam. They are not a seam: they are two
 * longitudinal paving cold joints drawn at +-half the road width, authored
 * *dark* — 0.033 linear — and coming out bright.
 *
 * They come out bright because a thin decal ribbon shares a material carrying
 * an aggregate normal map. On a 110 mm wide strip the UV derivative ACROSS the
 * ribbon is two orders of magnitude smaller than it is ALONG it, so the sampler
 * holds the sharpest mip of a full-amplitude normal map on a two-pixel-wide
 * line — and a 14-degree key raking across that is a string of specular glints,
 * at full brightness, on top of whatever the alpha blend left. The tint is
 * dark; the *highlight* is not, and on a surface pointed near the sun the
 * highlight is all you see. Any thin decal on a mapped material has this; the
 * fix is to say "this strip has no relief the camera can resolve" and mean it.
 *
 * Costs one attribute and two mixes and keeps the layer at one draw call.
 */
export function patchDecalMatte(mat: THREE.Material): void {
  patch(mat, 'matte', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aMatte;\nvarying float vMatte;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatte = aMatte;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMatte;')
      // `normal` at this point is the interpolated (and side-corrected) surface
      // normal; normal_fragment_maps is what perturbs it by the map
      .replace('#include <normal_fragment_maps>',
        'vec3 mtN = normal;\n#include <normal_fragment_maps>\n'
        + 'normal = normalize( mix( normal, mtN, vMatte ) );')
      .replace('#include <lights_physical_fragment>',
        'roughnessFactor = mix( roughnessFactor, 0.94, vMatte );\n'
        + '#include <lights_physical_fragment>');
  });
}

/**
 * Two terms a densely-domed tiling map needs and a generic `std()` does not
 * give it: geometric specular anti-aliasing, and a second detail octave.
 *
 * **1. Geometric specular AA.** A sett map is ~180 dome edges per tile at full
 * normal strength — a far harsher normal-curvature signal than 36 mm chippings
 * — so the surface that most needs the term is usually the one shipping without
 * it, because the flag was set on the tarmac and not on the cobble. This is a
 * Toksvig-style widening: measure how fast the shaded normal is changing across
 * the pixel footprint and fold that variance into roughness, so a normal that
 * swings a long way inside one pixel is shaded as a rougher surface rather than
 * as a mirror pointed in an arbitrary direction. IT IS THE ONLY THING THAT
 * KILLS EDGE CRAWL — mip filtering cannot, because the aliasing is in the
 * *lighting response*, not in the texture fetch.
 *
 * **2. A second detail octave at 1/2.37.** A macro breakup layer works at tens
 * of metres, which is tone; what is missing is a decade between that and the
 * 238 mm sett, and without it every sett in a 2.85 m tile has an identical twin
 * 2.85 m away in both axes. Re-reading the albedo and roughness maps at 1/2.37
 * of the rate — irrational against the tile, so it never comes back into phase,
 * and ROTATED as well as rescaled, because an axis-aligned second octave still
 * shares the first one's row and column directions and reads as one moire —
 * lands a *different* sett's tone and gloss on top of each one.
 *
 * The octave is referenced against the map's OWN mean, a high mip of the same
 * fetch, rather than a hand-typed constant: that makes it a true modulation
 * about zero whatever albedo arrives, and stops it quietly becoming a global
 * tint when the map changes. And it fades out past the distance where the
 * second octave is itself sub-pixel, because out there it is not breaking up a
 * pattern any more, it is adding noise to a mip that had settled.
 *
 * Two extra fetches. Worth it on the one material group that needs them.
 */
export function patchCobbleDetail(mat: THREE.Material) {
  // x: second-octave UV rate, y: its albedo weight, z: its roughness weight
  const uD = { value: new THREE.Vector3(1 / 2.37, 0.34, 0.30) };
  // x: variance gain, y: the most roughness squared the AA term may add
  const uAA = { value: new THREE.Vector2(0.62, 0.16) };
  patch(mat, 'cobdtl', (sh) => {
    sh.uniforms.uCobDetail = uD;
    sh.uniforms.uCobAA = uAA;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCobDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCobDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uCobDetail;\nuniform vec2 uCobAA;\n' +
          'varying float vCobDist;\nfloat gCobD = 0.0;\n',
      )
      // `color_fragment` survives a library injection that consumed
      // map_fragment, roughnessmap_fragment and normal_fragment_maps, and at
      // this point diffuseColor is albedo x vertex colour with nothing else
      // applied — the right place for a detail octave.
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        #ifdef USE_MAP
        {
          // rotated as well as rescaled: an axis-aligned second octave still
          // shares the first one's row and column directions, and two lattices
          // in the same orientation read as one moiré rather than as breakup
          vec2 ruv = mat2( 0.857, -0.515, 0.515, 0.857 ) * vMapUv * uCobDetail.x + 0.317;
          const vec3 kLum = vec3( 0.299, 0.587, 0.114 );
          float dtl = dot( texture2D( map, ruv ).rgb, kLum );
          // Referenced against the map's *own* mean — a high mip of the same
          // fetch — rather than against a hand-typed constant, so the octave is
          // a true ±0 modulation whatever albedo the shared library hands over
          // and cannot quietly turn into a global tint when that map changes.
          float ref = dot( textureLod( map, ruv, 7.0 ).rgb, kLum ) + 1e-4;
          gCobD = clamp( dtl / ref - 1.0, -0.85, 0.85 );
          // ...and faded out with distance, because past the point where the
          // second octave is itself sub-pixel it is no longer breaking up a
          // pattern, it is just adding noise to a mip that had settled
          gCobD *= 1.0 - smoothstep( 45.0, 120.0, vCobDist );
          diffuseColor.rgb *= 1.0 + gCobD * uCobDetail.y;
        }
        #endif`,
      )
      // roughnessFactor is declared by the roughness block and is still live
      // here; metalnessmap_fragment is untouched by every injection upstream
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n' +
          'roughnessFactor = clamp( roughnessFactor * ( 1.0 + gCobD * uCobDetail.z ), 0.06, 1.0 );',
      )
      // last stop before the BRDF, where `normal` is final and roughnessFactor
      // has not yet been copied into `material`
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `{
          vec3 dnx = dFdx( normal );
          vec3 dny = dFdy( normal );
          float variance = uCobAA.x * ( dot( dnx, dnx ) + dot( dny, dny ) );
          float kernel = min( variance, uCobAA.y );
          roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + kernel ) );
        }
        #include <lights_physical_fragment>`,
      );
  });
}

/**
 * ===========================================================================
 *  patchTerrainMacro — world-space macro breakup for GROUND, and why it is a
 *  second patcher beside `patchMacroBreak` rather than a call into it.
 * ===========================================================================
 *  The fifth of the kart racer's five road-surface injections, and the one the
 *  first move sized and refused. Its blocker was real and is closed here.
 *
 *  ── WHAT IT IS ────────────────────────────────────────────────────────────
 *
 *  Terrain reading as one exposure. A slope face and a terrace on it are ~95 m
 *  and ~34 m of ground, and at those scales a tiling detail map has nothing
 *  left to say — every square of a hillside comes back the same value, which
 *  is the "flat sheet with a texture on it" note. Two world-space octaves of
 *  value noise multiply the albedo, a THIRD decorrelated octave modulates
 *  roughness, and the albedo drift is split warm/cool so it reads as a change
 *  of LIGHT on the land rather than as a change of exposure.
 *
 *  ── WHY NOT `patchMacroBreak`, WHICH IS A NEAR TWIN ───────────────────────
 *
 *  Three differences, and the third decides it:
 *
 *   1. Two octaves at 1 : 2.17 here against 1 : 2.71 there, and 0.62/0.38
 *      against 0.63/0.37. Different fields, not a retuning of one.
 *   2. This also touches ROUGHNESS, at a fourth scale and a phase offset,
 *      deliberately decorrelated from the albedo field so the sheen does not
 *      simply trace the colour. `patchMacroBreak` has no roughness term.
 *   3. THE WARM/COOL SPLIT. `diffuseColor.r` and `.b` are pushed in OPPOSITE
 *      directions by the same field. That is not a stronger multiply, it is a
 *      hue rotation — and folding it into the other patcher as an option gives
 *      every caller of that one a hue knob it never asked for, defaulted to
 *      zero, which is the shape of an extracted option welded shut.
 *
 *  Two breakup patchers on one shelf, each named for the surface it is for.
 *  `cascade.ts` beside `cascadederiv.ts` is the standing precedent.
 *
 *  ── THE BLOCKER THE FIRST MOVE WROTE DOWN, AND HOW IT IS CLOSED ──────────
 *
 *  The game ASSIGNED `onBeforeCompile` outright, so a second call at a
 *  different `amount` simply replaced the first. Through `patch()` two amounts
 *  are two keys and BOTH closures run — and both used to declare `vMacroWP`,
 *  `mcHash`, `mcNoise` and `mcFbm`. That is a GLSL redefinition and the mesh
 *  stops linking, which is exactly what `patchMacroBreak`'s note above records
 *  happening to the space racer's foundry hull.
 *
 *  Same fix, same shape: the declarations every parameterisation shares sit
 *  behind `#ifndef` guards. The guards are NO-OPS on a first inclusion, so a
 *  singly-patched material compiles the pre-move program with six preprocessor
 *  lines added — the track-patch probe strips exactly those lines and
 *  asserts character equality against the pinned source.
 *
 *  What is NOT preserved, and is a bug closing rather than a regression: two
 *  calls on ONE material used to leave only the second's effect and now leave
 *  both. Both of the kart racer's call sites hand in a freshly-constructed
 *  material and call once; the probe asserts that call count out of the game's
 *  own source, so nothing on screen moves today.
 *
 *  ── EVERY NUMBER IS THE CALLER'S ──────────────────────────────────────────
 *
 *  The two albedo scales, the roughness scale, both phase offsets and all five
 *  strengths are required parameters. A tuned constant left in here is how the
 *  next world inherits this circuit's hillside. The fixed-decimal formatting
 *  is deliberate and is not cosmetic: `String(0.20)` is `"0.2"` and
 *  `String(1.0)` is `"1"`, either of which changes the emitted text without
 *  changing the program — a diff a text-parity probe cannot forgive and a
 *  reader cannot explain.
 */
export interface TerrainMacroOpts {
  /** metres^-1; the slope-face octave. 0.0105 is a ~95 m feature. */
  slopeScale: number;
  /** metres^-1; the terrace octave, and its phase offset. */
  benchScale: number;
  benchPhase: number;
  /** metres^-1; the roughness octave, and ITS phase — decorrelated on purpose. */
  roughScale: number;
  roughPhase: number;
  /** albedo drift from each octave, and the warm (+r) / cool (-b) split. */
  tintA: number;
  tintB: number;
  warm: number;
  cool: number;
  /** roughness drift. */
  roughAmt: number;
  /** overall strength; the one knob a caller is expected to vary per surface. */
  amount?: number;
}

export function patchTerrainMacro(mat: THREE.Material, o: TerrainMacroOpts): void {
  const amount = o.amount ?? 1;
  const A = amount.toFixed(3);
  const key =
    `tmacro-${amount}-${o.slopeScale}-${o.benchScale}-${o.benchPhase}` +
    `-${o.roughScale}-${o.roughPhase}-${o.tintA}-${o.tintB}-${o.warm}-${o.cool}-${o.roughAmt}`;
  patch(mat, key, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n#ifndef K_MC_PARS\n#define K_MC_PARS\nvarying vec3 vMacroWP;\n#endif',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifndef K_MC_VERTEX\n#define K_MC_VERTEX\nvMacroWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
#ifndef K_MC_PARS
#define K_MC_PARS
varying vec3 vMacroWP;
float mcHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float mcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mcHash(i), mcHash(i + vec2(1.0, 0.0)), u.x),
             mix(mcHash(i + vec2(0.0, 1.0)), mcHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float mcFbm(vec2 p) {
  return mcNoise(p) * 0.62 + mcNoise(p * 2.17 + 19.3) * 0.38;
}
#endif`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  // ~95 m and ~34 m: the scale of a whole slope face and of a terrace on it.
  float mA = mcFbm(vMacroWP.xz * ${o.slopeScale.toFixed(4)});
  float mB = mcNoise(vMacroWP.xz * ${o.benchScale.toFixed(4)} + ${o.benchPhase.toFixed(1)});
  float tint = (mA - 0.5) * ${o.tintA.toFixed(2)} + (mB - 0.5) * ${o.tintB.toFixed(2)};
  diffuseColor.rgb *= 1.0 + tint * ${A};
  // Warm the risen ground and cool the hollows a touch, so the drift is a
  // change of light on the land rather than a change of exposure.
  diffuseColor.r *= 1.0 + tint * ${o.warm.toFixed(2)} * ${A};
  diffuseColor.b *= 1.0 - tint * ${o.cool.toFixed(2)} * ${A};
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  // Decorrelated from the albedo field on purpose — same period, different
  // phase, so the sheen does not simply trace the colour.
  float mR = mcFbm(vMacroWP.xz * ${o.roughScale.toFixed(4)} + ${o.roughPhase.toFixed(1)});
  roughnessFactor = clamp(roughnessFactor * (1.0 + (mR - 0.5) * ${o.roughAmt.toFixed(2)} * ${A}), 0.05, 1.0);
}`,
      );
  });
}

/**
 * ===========================================================================
 *  ONE-TAP REFRACTED ENVIRONMENT PLUS A FRESNEL RIM, on a dielectric.
 * ===========================================================================
 *  Two terms that always travel together, because they are two halves of one
 *  physical hand-off: a dielectric transmits face-on and reflects at grazing
 *  angles, so the refracted tap is weighted by `1 - fresnel` and the rim takes
 *  over exactly where it fades out. Split them and a caller can weight both at
 *  once, which is how a transparent object becomes an emitter.
 *
 *  UNLIKE REAL TRANSMISSION THIS IS ONE PMREM TAP, not a second scene pass.
 *  It buys the "the sky horizon shows in the facets" read for the cost of a
 *  texture fetch, on a material that is already sampling the same cube for its
 *  reflection. `transformDirectionByInverseViewMatrix` + `envMapRotation` is
 *  exactly what `getIBLRadiance` does, and matching it is what makes the
 *  refracted sky and the reflected sky agree about which way the world is
 *  facing — the sky system is free to rotate its PMREM under both.
 *
 *  IT SPLICES AT `emissivemap_fragment`, deliberately, where `normal` is the
 *  SHADING normal after `<normal_fragment_begin>` rather than the raw varying,
 *  so both terms follow interpolated curvature. A chamfer or a fillet is the
 *  whole reason a caller wants this, and against `vNormal` neither term would
 *  see one.
 *
 *  EVERY VALUE IS AN ARGUMENT AND THERE IS NO DEFAULT, and that is not
 *  ceremony. Both terms feed `totalEmissiveRadiance`, which is UNLIT: the gain
 *  is multiplied by the scene's env intensity and by sky radiance in linear
 *  units, so a coefficient safe under an assumed sky of ~1 is an emitter under
 *  a golden-hour one. The kart racer's item box shipped as a white blob with an
 *  invisible glyph in it for exactly that reason — the coefficient was read on
 *  its own rather than against the sum — and a default here would hand the next
 *  caller the same frame.
 *
 *  @param eta   ratio of IORs going IN, i.e. 1 / ior for air -> dielectric
 *  @param gain  weight on the refracted tap. Face-on it is
 *               `gain * envMapIntensity * 0.5` of sky radiance; size it against
 *               that product and the reflection stacked on top of it, never
 *               against the coefficient alone.
 *  @param rim   the rim's colour, exponent and strength. A LOW exponent is a
 *               broad term, and a broad unlit term is a free trip past the
 *               bloom threshold across a third of a convex shape.
 * ===========================================================================
 */
export function patchRefractRim(
  mat: THREE.Material,
  eta: number,
  gain: number,
  rim: { colour: THREE.Color; power: number; strength: number },
) {
  const uRim = { value: rim.colour };
  const uRimPower = { value: rim.power };
  const uRimStrength = { value: rim.strength };
  const uEta = { value: eta };
  const uRefract = { value: gain };
  patch(mat, 'refrrim', (sh) => {
    sh.uniforms.uRimColor = uRim;
    sh.uniforms.uRimPower = uRimPower;
    sh.uniforms.uRimStrength = uRimStrength;
    sh.uniforms.uEta = uEta;
    sh.uniforms.uRefract = uRefract;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
uniform float uEta;
uniform float uRefract;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 vDir = normalize( vViewPosition );
  float ndv = saturate( abs( dot( normal, vDir ) ) );
  float fres = pow( 1.0 - ndv, 5.0 );

  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  vec3 refr = refract( -vDir, normal, uEta );
  if ( dot( refr, refr ) > 0.0 ) {
    vec3 worldRefr = transformDirectionByInverseViewMatrix( refr, viewMatrix );
    vec3 sky = textureCubeUV( envMap, envMapRotation * worldRefr, roughnessFactor ).rgb;
    totalEmissiveRadiance += sky * envMapIntensity * uRefract * ( 1.0 - fres ) * 0.5;
  }
  #endif

  totalEmissiveRadiance += uRimColor * pow( 1.0 - ndv, uRimPower ) * uRimStrength;
}`,
      );
  });
}

/**
 * ===========================================================================
 *  A SOFT HIGHLIGHT KNEE, SO NON-EMISSIVE STRUCTURE CANNOT CROSS A BLOOM
 *  THRESHOLD. THIS IS WHAT GIVES A TRUSS MEMBER A SHADED SIDE.
 * ===========================================================================
 *  Lifted out of the space racer's `Props.ts`, where it was written and where
 *  an earlier move recorded it stuck. Nothing in it names a deck, a truss or
 *  a circuit: both arguments are scene-linear radiances the caller supplies,
 *  and the geometry argument below is a fact about a PARALLEL key, not about
 *  any one game's star.
 *
 *  THE CAUSE IS THE SAME GEOMETRY TERM `patchReinhardCeiling` WAS WRITTEN FOR,
 *  ONE ORDER OF MAGNITUDE NEARER. Take a key parallel at elevation e. A floor
 *  receives it at sin(e); a chord, a barrier panel, a handrail post or a kerb
 *  lip standing normal to it receives it at cos(e). At e = 6.5 degrees that is
 *  a factor of NINE, so with a lit deck correctly at 0.18-0.30 the vertical
 *  face beside it lands at 1.6-2.7 — over a 1.35 bloom threshold, into the
 *  anamorphic pass, and clipped white by the grade before the eye ever gets a
 *  chance to see which side of the member is facing the star. Every one of
 *  those surfaces is *correctly lit*; what is wrong is that the presented value
 *  has nowhere left to go, so a lit face and a lit-and-a-half face render as
 *  the same white.
 *
 *  A soft knee fixes exactly that and nothing else:
 *
 *    x <= k               unchanged
 *    x >  k               k + (C-k)*(1 - e^-(x-k)/(C-k)),  -> C as x -> inf
 *
 *  Below the knee this is the identity to the bit, so a measured key-to-fill
 *  ratio is untouched. Above it the response compresses instead of clipping, so
 *  a chord's sunward face and its raking face separate again by a value the eye
 *  can read. The CONTRAST GOES UP, not down: the shadow side is unmoved and the
 *  lit side stops being pinned at white.
 *
 *  APPLIED ON THE MAX CHANNEL, NOT PER CHANNEL. A per-channel compressor pulls
 *  the brightest channel down hardest and walks the hue toward the ceiling's
 *  neutral, which is a desaturation the reviewer will see. Scaling all three by
 *  the ratio the max channel needs preserves the chromaticity exactly.
 *
 *  IT IS NOT A TONE MAP AND IT IS NOT EXPOSURE. It runs per material, before
 *  the composer, on things that are not lights — a star disc, an emissive tier
 *  and a crucible are untouched, which is the whole point: after this the only
 *  things in the frame that can bloom are the ones allowed to.
 *
 *  THE SAME SHOULDER AS `./ValueCeiling.ts`'s `addValueCeiling`, AND STILL NOT
 *  THE SAME FUNCTION. Identical arithmetic, identical `vec2(knee, ceil-knee)`
 *  packing, identical clamps, identical `<opaque_fragment>` anchor — and one
 *  observable difference that is the reason both live: this one installs
 *  through `patch()`, so `clonePatched` re-registers it onto a clone, while
 *  `addValueCeiling` assigns `onBeforeCompile` itself and a clone silently
 *  loses it. One game's scenery clones a material carrying this one. Reach for
 *  this when the material may be cloned, and for `addValueCeiling` when the
 *  material is generated, handed over once and never cloned. The two are
 *  side by side here so the next reader compares them in one screen instead of
 *  across a package boundary, which is how they drifted into agreement-by-
 *  attention in the first place.
 */
export function patchSpecCeiling(mat: THREE.Material, knee: number, ceil: number) {
  const k = Math.max(0.01, knee);
  const c = Math.max(k + 0.02, ceil);
  patch(mat, 'specceil' + k.toFixed(3) + c.toFixed(3), (sh) => {
    sh.uniforms.uSpecCeil = { value: new THREE.Vector2(k, c - k) };
    sh.fragmentShader = decl(sh.fragmentShader, 'uniform vec2 uSpecCeil;\n').replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       {
         float scMx = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
         if (scMx > uSpecCeil.x) {
           float scOut = uSpecCeil.x + uSpecCeil.y * (1.0 - exp(-(scMx - uSpecCeil.x) / uSpecCeil.y));
           gl_FragColor.rgb *= scOut / scMx;
         }
       }`
    );
  });
}

/**
 * ===========================================================================
 *  TWO ANIMATIONS DRIVEN OFF A PER-INSTANCE CHANNEL, SO A SET OF THEM IS ONE
 *  DRAW CALL. An earlier move named both, sized them at 72 raw lines and left
 *  them.
 * ===========================================================================
 *  `aWind` IS THE CHANNEL, AND THAT IS NOT AN AESTHETIC CHOICE. `patchTint`
 *  already declares `aTint` on every instanced material in these games, and a
 *  second `attribute vec3 aTint;` in a second injection is a duplicate
 *  declaration: the shader fails to LINK, silently, into a material that
 *  renders nothing at all. `aWind` is a vec4, it was the foliage sway channel,
 *  `InstSet` still carries it, and nothing declares it any more — so it is the
 *  free one. Both functions below read `.x` (and `patchInstShuttle` also `.y`)
 *  and neither touches the other components.
 *
 *  WHY ON THE GPU. A CPU loop writing N emissive intensities per frame is one
 *  frame behind and costs N draw calls; at any real closing speed one frame
 *  behind reads as a stutter in whatever cue the player is steering by.
 *
 *  EVERY NUMBER IS THE CALLER'S. Nothing here is defaulted, because a default
 *  is how the second game to call this inherits the first game's timing without
 *  anybody deciding it should. Two literals stay in the GLSL and both are
 *  structural rather than tuned: `0.0` as the strobe ramp's foot, and `0.5` as
 *  the shuttle's midpoint, which is what makes the travel symmetric about the
 *  instance origin instead of running one way from it.
 * ===========================================================================
 */
export interface InstStrobe {
  /** Seconds for the pulse to travel the whole set. */
  period: number;
  /** Per-index phase offset, in turns. Sign chooses which way it travels. */
  stride: number;
  /** Phase at which the pulse is fully up, and the phase it is back down by. */
  rise: number;
  hold: number;
  /** Emissive multiplier between pulses, and how much the pulse adds on top. */
  floor: number;
  gain: number;
}

/**
 * A pulse travelling along an instanced set, indexed by `aWind.x`.
 *
 * `clock` is the caller's own uniform object, pushed per frame and wrapped by
 * the caller — this does not own a clock, because a patcher that advances time
 * is a patcher that runs at a different rate in a paused frame.
 */
export function patchInstStrobe(mat: THREE.Material, clock: { value: number }, o: InstStrobe) {
  const n = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  patch(mat, `strobe${n(o.period)}_${n(o.stride)}_${n(o.rise)}_${n(o.hold)}_${n(o.floor)}_${n(o.gain)}`, (sh) => {
    sh.uniforms.uStrobe = clock;
    sh.vertexShader = 'attribute vec4 aWind;\nuniform float uStrobe;\nvarying float vStrobe;\n'
      + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
           float ph = fract(uStrobe / ${n(o.period)} - aWind.x * ${n(o.stride)});
           vStrobe = smoothstep(0.0, ${n(o.rise)}, ph) * (1.0 - smoothstep(${n(o.rise)}, ${n(o.hold)}, ph));`);
    sh.fragmentShader = 'varying float vStrobe;\n'
      + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
           totalEmissiveRadiance *= ${n(o.floor)} + vStrobe * ${n(o.gain)};`);
  });
}

/**
 * An eased shuttle along each instance's own +Z, phase and rate per instance in
 * `aWind.xy`.
 *
 * Smoothstepped at both ends of a triangle wave, so the thing decelerates,
 * stops and reverses rather than snapping — which is what a body under
 * station-keeping thrust does, and is also the only version of this that does
 * not read as a bob. `reach` is the full travel in metres, centred on the
 * instance origin.
 */
export function patchInstShuttle(mat: THREE.Material, time: { value: number }, reach: number) {
  const n = Number.isInteger(reach) ? reach.toFixed(1) : String(reach);
  patch(mat, `shuttle${n}`, (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'attribute vec4 aWind;\nuniform float uTime;\n'
      + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
           float ph = fract(uTime * aWind.y + aWind.x);
           float tri = abs(ph * 2.0 - 1.0);
           transformed.z += (tri * tri * (3.0 - 2.0 * tri) - 0.5) * ${n};`);
  });
}
