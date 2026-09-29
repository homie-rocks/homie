/**
 * ============================================================================
 *  Cascaded shadow maps — the machinery, not the sky.
 * ============================================================================
 *
 * The sky modules of a kart racer and of a space racer are forks of each
 * other. The SKY is not shared and must not be: the colours, the cloud layers,
 * the sun disc, the eclipse, the interior volumes and every exposure in them
 * are the art direction of two different games, and a change that merged
 * those would be merging two people's taste.
 *
 * What IS one thing is underneath: three.js has no notion of a cascade, so both
 * files build one the same way — resolve a table of cascade specs on the CPU,
 * generate a receiver-plane-biased PCF filter per cascade as GLSL text, splice
 * it into `shadowmap_pars_fragment`, and quantise each cascade's centre to
 * whole shadow texels every frame so the edges do not boil. That machinery was
 * BYTE-IDENTICAL in the two files, comments and all, apart from three GLSL
 * macro names and two words of prose. This is where it lives now.
 *
 * ## The line this package draws
 *
 * Everything here takes a struct or a vector. **Nothing here takes a `Ctx`**,
 * not even as a type: a `Ctx` carries race / track / items / match, and a
 * package that can see one is a package that knows what a lap is. `snapCascade`
 * is handed the light basis and the key direction; it never asks who is racing.
 *
 * It also chooses no number that is a matter of taste. The cascade extents, the
 * map sizes, the tap counts, the blend width and the intensity are all in the
 * `CascadeSpec` the GAME builds. The two constants that are here —
 * `SLOPE_BIAS_TAN_MAX` and `SHADOW_BORDER_FADE` — are here because they were
 * the same value in both games AND because they are properties of the filter
 * rather than of the world: one is where the receiver-plane gradient stops
 * being numerically meaningful, the other is the safety strip at a shadow map's
 * own border. Neither is a look.
 *
 * ## `three` is a peerDependency and that is load-bearing
 *
 * Two copies of three.js is two `ShaderChunk` tables. The game would patch one
 * and render with the other, in silence, and the symptom is a game whose
 * shadows simply never gained a cascade.
 */
import * as THREE from 'three';
import { ChunkVault } from './chunkvault.ts';
import { findDirLightLoop } from './lightsloop.ts';

// ---------------------------------------------------------------------------
// Numbers that belong to the filter rather than to the world
// ---------------------------------------------------------------------------

/**
 * Ceiling on the receiver-plane gradient, as a tangent. Past this the surface is
 * within ~7° of edge-on to the light, where the exact bias diverges and the
 * fragment is being killed by N·L anyway. Clamping keeps a silhouette texel from
 * punching a bright hole.
 *
 * (The space racer's copy adds that at a 6.5° key there are a great many
 * surfaces within 7° of edge-on, so the clamp does more work in that game than
 * in the other. Same number, same reason, one more sentence of evidence for
 * it.)
 */
export const SLOPE_BIAS_TAN_MAX = 9.0;

/**
 * How far into a shadow map its own contribution fades out. With a cascade
 * cross-fade doing the real hand-over this is a thin safety strip, but it still
 * earns its place in two places: the OUTERMOST cascade's border, which nothing
 * catches, and the single-map path used below Quality.High.
 */
export const SHADOW_BORDER_FADE = 0.96;

/**
 * The `THREE.ShaderChunk` entries a Sky is allowed to overwrite, and therefore
 * the exact set it has to put back in `dispose()`. Both games patch the same
 * eight. It is a list rather than a comment because a chunk that is patched and
 * not restored survives into the next scene as a corrupted global.
 */
export const PATCHED_CHUNKS = [
  'common', 'fog_pars_fragment', 'fog_fragment', 'envmap_physical_pars_fragment',
  'shadowmap_pars_fragment', 'lights_pars_begin', 'lights_fragment_begin',
  'lights_fragment_maps',
] as const;

// ---------------------------------------------------------------------------
// Small pure helpers. These were three-line duplicates in both files.
// ---------------------------------------------------------------------------

/**
 * A number as a GLSL float literal.
 *
 * The `Number.isFinite` arm is not defensive decoration: every one of these is
 * baked into shader SOURCE, and a `NaN` or an `Infinity` here does not throw —
 * it produces a program that fails to compile, at which point three swallows
 * the log and the object renders as nothing.
 */
export function glslFloat(x: number): string {
  return Number.isFinite(x) ? x.toFixed(7) : '0.0';
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// The cascade table
// ---------------------------------------------------------------------------

/** Everything one cascade needs, resolved before any shader is generated. */
export interface CascadeSpec {
  intensity: number;
  extent: number;
  distance: number;
  mapSize: number;
  bias: number;
  normalBias: number;
  interval: number;
  /** three's own `shadow.radius`; only the non-PCF fallback path reads it. */
  radius: number;
  taps: number;
  pcfRadius: number;
  constBias: number;
}

/** One live cascade: the light that carries it and the numbers the snap needs. */
export interface Cascade {
  light: THREE.DirectionalLight;
  extent: number;
  distance: number;
  mapSize: number;
  /** update every N frames; 1 = every frame */
  interval: number;
}

/**
 * The light's own orthographic basis in world space — `x`/`y` are the shadow
 * map's u/v axes and `z` points at the light.
 *
 * WHY THIS IS A PARAMETER AND NOT A CONSTANT HERE. It is derived exactly the
 * way `Matrix4.lookAt` does it with up = +Y, which is what
 * `DirectionalLightShadow` uses — but one game bakes it once at module load and
 * the other RECOMPUTES it, because its star direction is rotated in place when
 * the circuit is bound. Both are right about their own game. What matters is
 * that the CPU texel snap and the GLSL receiver-plane bias read the SAME basis:
 * if those two disagree the bias points the wrong way and the ground
 * self-shadows. So the game owns the one basis and hands it to both.
 */
export interface LightBasis {
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
}

/** Ortho depth range of a cascade, metres. Must match the game's `makeCascade`. */
export function shadowDepthRange(s: CascadeSpec): number {
  return s.distance + s.extent * 2 + 400 - 5;
}

/**
 * Configure a directional light's shadow camera for one cascade.
 *
 * THE REASON THIS IS HERE RATHER THAN IN THE GAME IS THE `far` PLANE. It has to
 * stay in lockstep with `shadowDepthRange` above — the receiver-plane bias in
 * `pcfGlsl` bakes the depth range in as a LITERAL, so a `far` that drifts from
 * it does not produce a warning or a wrong-looking number, it produces a bias
 * quoted against a range the map no longer has. Both games carried a comment
 * saying "change one and change the other", in two files, about two constants
 * that could not see each other. Now they are four lines apart.
 *
 * Everything else about the light — its colour, whether it casts at all, where
 * it sits in the scene graph, and whether the map is driven by hand — stays
 * with the game, because those are decisions about the game's own key.
 */
export function fitCascadeCamera(light: THREE.DirectionalLight, spec: CascadeSpec): void {
  const s = light.shadow;
  s.mapSize.set(spec.mapSize, spec.mapSize);
  s.bias = spec.bias;
  s.normalBias = spec.normalBias;
  s.radius = spec.radius;
  const cam = s.camera;
  cam.left = -spec.extent; cam.right = spec.extent;
  cam.top = spec.extent; cam.bottom = -spec.extent;
  cam.near = 5;
  // `shadowDepthRange` is `far - near`, and near is 5. One of these two lines
  // is the definition and the other is derived from it; they are adjacent so
  // that stays true.
  cam.far = shadowDepthRange(spec) + cam.near;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// three's ShaderChunk table, saved and put back
// ---------------------------------------------------------------------------
//
// `THREE.ShaderChunk` is a PROCESS-WIDE MUTABLE OBJECT. A sky that patches it
// and does not put it back leaves every later scene in the page — a second
// game, a menu, a replay — compiling against another game's fog and another
// game's cascade resolver, with no error anywhere. The save and the restore are
// therefore one pair rather than two halves in two.
//
// THE PAIR ITSELF IS `chunkvault.ts`'s, because every rig that patches three's
// chunks needs exactly it and a base-building game had written a second copy
// over its own three names. What is a fact about a SKY and stays here is
// only WHICH eight chunks — see `PATCHED_CHUNKS`. The memo discipline, which is
// the part that is easy to get wrong, is one implementation now.

const _vault = new ChunkVault(PATCHED_CHUNKS);

/**
 * The unpatched text of every chunk in `PATCHED_CHUNKS`, captured the FIRST
 * time this is called and memoised after that.
 *
 * The memo is what makes a second install safe: both games install their
 * patches twice — once at boot against an empty interior, once on the first
 * frame against the real one — and capturing "the original" the second time
 * would capture the first install's OUTPUT as the original, so `restoreChunks`
 * would put the patch back instead of removing it. See `ChunkVault.stock`.
 */
export function stockChunks(): Record<string, string> {
  return _vault.stock();
}

/**
 * Put every patched chunk back and forget the originals. Idempotent, and a
 * no-op when nothing was ever patched — a dispose that runs twice, or on a Sky
 * that failed during init, must not write `undefined` over three's own source.
 */
export function restoreChunks(): void {
  _vault.restore();
}

// ---------------------------------------------------------------------------
// GLSL generation
// ---------------------------------------------------------------------------

/**
 * One cascade's shadow filter, with every constant it needs resolved on the CPU.
 *
 * THE RECEIVER-PLANE BIAS. A PCF tap does not sample the depth the fragment
 * would have; it samples the depth of a point `o` away in shadow-map UV, and on
 * a sloped receiver that point is at a different distance from the light. Bias
 * it by a constant and you are choosing between acne (too small) and detached
 * shadows (too big); at a 14° sun on flat ground the required constant is four
 * times the tap's lateral reach, so there is no value that is both.
 *
 * TWO GAMES MEASURED THAT INDEPENDENTLY AND BOTH NUMBERS ARE KEPT, because they
 * are the same finding at two key angles and the second is the more brutal one:
 * at a 6.5° star on a flat deck the angle between the surface normal and the
 * light is 83.5°, and the required constant is EIGHT AND A HALF TIMES the tap's
 * lateral reach. It is also what lets that game's "constant-depth bias 0" be
 * literally true, which is what keeps a chamfer's shadow welded to the chamfer.
 *
 * The gradient is closed-form here, because the light is orthographic and its
 * basis is a compile-time constant. Stay on the receiver plane while moving δx
 * along the light's u axis and δy along its v axis, and the required travel
 * along the light direction follows from `dp · n = 0`:
 *
 *     δz = -( δx (X·n) + δy (Y·n) ) / (Z·n)
 *
 * Stored depth is linear in -δz over the ortho range, and one unit of UV is
 * `2 * extent` metres, so
 *
 *     d(depth) / d(uv) = ( X·n, Y·n ) * 2 * extent / ( (Z·n) * (far - near) )
 *
 * — two dot products and a divide, exact at every slope, and it makes the tap
 * offsets self-biasing. What is left over as a constant is then only depth
 * quantisation, which is centimetres.
 *
 * `basis` NAMES THE THREE GLSL CONSTANTS THE CALLER HAS ALREADY DECLARED —
 * `${basis}X`, `${basis}Y`, `${basis}Z`. It is a prefix and nothing else. The
 * declaration lives in the caller's own chunk because that chunk is where the
 * two games genuinely differ (one resolves two cascades, the other N of them),
 * and the two forks had picked different prefixes for the same three vectors.
 *
 * `krWorldNormal`, `vogelDiskSample`, `interleavedGradientNoise` and `PI2` are
 * the caller's too, declared in the same chunk above this function. That is why
 * this returns TEXT rather than a chunk: it is a fragment of somebody else's.
 */
export function pcfGlsl(name: string, s: CascadeSpec, basis: string): string {
  const F = glslFloat;
  const depthRange = shadowDepthRange(s);
  const span = 2 * s.extent;
  const radiusUv = s.pcfRadius / s.mapSize;
  const taps: string[] = [];
  for (let i = 0; i < s.taps; i++) {
    taps.push(
      `\t\t\to = vogelDiskSample( ${i}, ${s.taps}, phi ) * ${F(radiusUv)};`,
      '\t\t\ts += texture( map, vec3( c.xy + o, z + dot( o, g ) ) );',
    );
  }
  return /* glsl */`
		float ${name}( sampler2DShadow map, vec4 coord ) {

			vec3 c = coord.xyz / max( coord.w, 1e-6 );
			if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;

			// N·L against the light's own axis. Floored rather than branched: below
			// ~6° of grazing the exact gradient diverges and the fragment is being
			// killed by its own N·L anyway.
			float nz = max( dot( krWorldNormal, ${basis}Z ), 0.11 );
			vec2 g = clamp(
				vec2( dot( krWorldNormal, ${basis}X ), dot( krWorldNormal, ${basis}Y ) )
					* ( ${F(span / depthRange)} / nz ),
				-${F((SLOPE_BIAS_TAN_MAX * span) / depthRange)},
				${F((SLOPE_BIAS_TAN_MAX * span) / depthRange)} );

			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			float z = c.z - ${F(s.constBias / depthRange)};
			float s = 0.0;
			vec2 o;
${taps.join('\n')}
			s *= ${F(1 / s.taps)};

			// Soft frustum border: three hands back "fully lit" the instant a
			// fragment leaves a map, which on a flat surface is a straight line of
			// constant value across the whole of it.
			vec2 e = abs( c.xy - 0.5 ) * 2.0;
			return mix( 1.0, s, 1.0 - smoothstep( ${F(SHADOW_BORDER_FADE)}, 1.0, max( e.x, e.y ) ) );

		}
`;
}

/**
 * Soften the border of three's OWN `getShadow`, the fallback path.
 *
 * With a cascade cross-fade doing the real work this is a 4% safety strip, but
 * it still matters in two places: the outermost cascade's border, which nothing
 * catches, and the single-map path used below Quality.High. It also applies to
 * spot shadows, where a soft frustum edge is what you want anyway.
 *
 * Applied to all three getShadow variants — the three-tab return is unique to
 * them, getPointShadow is indented one level shallower and is left alone.
 * shadowCoord has already been divided by w by the time this runs.
 *
 * IT REFUSES RATHER THAN GUESSES. If three's layout changes and the anchor is
 * not found exactly three times, the original chunk comes back untouched and it
 * says so. A patch that half-applies to a shader is a picture nobody can
 * explain; a border that is not softened is a border that is not softened.
 */
export function shadowBorderChunk(original: string): string {
  const from = '\t\t\treturn mix( 1.0, shadow, shadowIntensity );';
  const to = [
    '\t\t\tvec2 krEdge = abs( shadowCoord.xy - 0.5 ) * 2.0;',
    `\t\t\tfloat krFade = 1.0 - smoothstep( ${glslFloat(SHADOW_BORDER_FADE)}, 1.0, max( krEdge.x, krEdge.y ) );`,
    '\t\t\tshadow = mix( 1.0, shadow, krFade );',
    from,
  ].join('\n');
  const count = original.split(from).length - 1;
  if (count !== 3) {
    console.warn(`[sky] getShadow layout changed (${count} sites); border fade skipped`);
    return original;
  }
  return original.split(from).join(to);
}

/**
 * Split three's image-based lighting into its two halves and scale each.
 *
 * `getIBLIrradiance` is the Lambertian term and takes `diffuse` flat.
 * `getIBLRadiance` is the actual reflection and keeps the material's authored
 * intensity up to `rough.start`, then rolls off to `rough.scale` by
 * `rough.end`. Every number is the CALLER'S — the two games measured completely
 * different ones — and the reason there is a rolloff at all is this, measured
 * on the kart racer and true of any rough dielectric:
 *
 *   Decomposed on a 0.72-roughness tarmac, the environment was contributing
 *   sRGB (22,20,34) of the road's (89,74,81) — the largest single COOL term in
 *   the frame and, unlike a fill, one that lands on lit and shaded road alike.
 *   It is not a fill at all; it is a mirror image of the blue upper sky in a
 *   surface that is nearly matte, arriving at full strength because three's
 *   split-sum IBL gathers the whole hemisphere with no occlusion by the
 *   microfacets the surface is made of and no multiple-scattering loss. On a
 *   mirror that error is nil; on rough dielectric it is most of the term.
 *
 *   Full strength up to 0.35 and rolled off beyond it put every material that
 *   is SUPPOSED to reflect the sky under the line — chrome trim at 0.15,
 *   clearcoat at 0.06, painted bodywork at 0.28 — while the tarmac, the rock
 *   and the stucco stopped mirroring a sky they should only be scattering. A
 *   later change took the far end from 0.42 to 0.14 and pulled the end in from
 *   0.85 to 0.70, because at 0.85 tarmac's own 0.72 never reached the floor and
 *   the term was still ~60% of every road pixel. It is the single biggest
 *   reason cast shadows were illegible on the carriageway.
 *
 * IT REFUSES RATHER THAN GUESSES, twice, and independently: if three's
 * `getIBLIrradiance` signature has moved the diffuse half is left unscaled and
 * says so, and the specular half still runs. A silent half-patch here is a
 * frame nobody can account for.
 */
export function envDiffuseChunk(
  original: string, diffuse: number,
  rough: { scale: number; start: number; end: number },
): string {
  const F = glslFloat;
  let out = original;

  const from = 'return PI * envMapColor.rgb * envMapIntensity;';
  const to = `return PI * envMapColor.rgb * envMapIntensity * ${F(diffuse)};`;
  if (!out.includes(from)) {
    console.warn('[sky] getIBLIrradiance signature moved; diffuse IBL left unscaled');
  } else {
    out = out.replace(from, to);
  }

  const specFrom = 'return envMapColor.rgb * envMapIntensity;';
  const specTo = 'return envMapColor.rgb * envMapIntensity * mix( 1.0, '
    + `${F(rough.scale)}, smoothstep( ${F(rough.start)}, ${F(rough.end)}, roughness ) );`;
  const n = out.split(specFrom).length - 1;
  if (n < 1) {
    console.warn('[sky] getIBLRadiance signature moved; specular IBL left unscaled');
    return out;
  }
  return out.split(specFrom).join(specTo);
}

// ---------------------------------------------------------------------------
// Per-frame work
// ---------------------------------------------------------------------------

const _snapped = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Quantise the cascade centre to whole shadow texels in light space. Without
 * this the shadow map resamples the world at a slightly different offset each
 * frame and every shadow edge boils. Mandatory, not an optimisation — and under
 * a small source the boiling is the whole silhouette rather than a fringe.
 *
 * `keyDir` points FROM the scene TOWARDS the light, which is how both games
 * hold it; the light is placed `c.distance` along it from the snapped centre.
 */
export function snapCascade(
  c: Cascade, center: THREE.Vector3, basis: LightBasis, keyDir: THREE.Vector3,
): void {
  const texel = (2 * c.extent) / c.mapSize;
  const px = Math.round(center.dot(basis.x) / texel) * texel;
  const py = Math.round(center.dot(basis.y) / texel) * texel;
  const pz = center.dot(basis.z);
  _snapped.set(0, 0, 0)
    .addScaledVector(basis.x, px)
    .addScaledVector(basis.y, py)
    .addScaledVector(basis.z, pz);
  c.light.target.position.copy(_snapped);
  c.light.position.copy(_snapped).addScaledVector(keyDir, c.distance);
  c.light.target.updateMatrixWorld();
  c.light.updateMatrixWorld();
}

/**
 * Where the key light lands on screen, for light shafts, lens effects and
 * anamorphic streaks. Cheap enough that a post stack can call it again with a
 * fresher camera. Returns false — and centres `out` — when the light is behind
 * the eye, which is the only case a caller has to branch on.
 */
export function projectKeyToScreen(
  camera: THREE.PerspectiveCamera, keyDir: THREE.Vector3, out: THREE.Vector2,
): boolean {
  _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = _dir.dot(keyDir);
  if (facing <= 0) {
    out.set(0.5, 0.5);
    return false;
  }
  // A point well inside the far plane along the key ray projects to the same
  // screen position as the disc itself, without the w-flip of a point at
  // infinity behind the eye.
  _proj.copy(camera.position).addScaledVector(keyDir, 1500).project(camera);
  out.set(_proj.x * 0.5 + 0.5, _proj.y * 0.5 + 0.5);
  return true;
}

/**
 * How strongly an on-screen key should read, 0..1, from how square-on the camera
 * is to it and how close to the frame edge it has drifted. Fades rather than
 * cuts, so nothing can pop on and off at the edge of frame.
 *
 * The caller multiplies in whatever else its own sky knows — an eclipse term, a
 * cloud occlusion, a tunnel — which is why that is NOT a parameter here.
 */
export function keyScreenFalloff(
  camera: THREE.PerspectiveCamera, keyDir: THREE.Vector3, screenPos: THREE.Vector2,
): number {
  _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = _dir.dot(keyDir);
  const edge = Math.max(
    Math.abs(screenPos.x - 0.5),
    Math.abs(screenPos.y - 0.5),
  );
  return smoothstep(0.0, 0.25, facing) * (1 - smoothstep(0.45, 1.1, edge));
}


// ---------------------------------------------------------------------------
// three's own unrolled directional-light loop, and the one edit both skies make
// ---------------------------------------------------------------------------

/**
 * What `cascadeZeroLoop` hands back when it finds the loop.
 */
export interface DirLightLoop {
  /**
   * three's loop body with cascade 0's shadow selection already spliced in:
   * iteration 0 calls `krCascadeShadow()` and publishes `krKeyShadow`, every
   * other iteration keeps three's own `getShadow` line untouched.
   *
   * The game rewrites this further — that is where the two skies diverge, and
   * they diverge a lot: the kart racer adds a rim, a warm/cool key coupling and
   * three fill lights; the space racer cuts a shadowless planet fill out of a
   * pressure hull. Neither of those is here.
   */
  body: string;
  /**
   * three's `RE_Direct` call, exactly as it emits it. Both skies anchor their
   * own injections on it and both check `body.includes(reLine)` first, because
   * a miss has to warn rather than silently drop the injection.
   */
  reLine: string;
  /** Put a rewritten body back where three's was. */
  splice(rewritten: string): string;
}

/**
 * ===========================================================================
 *  FIND three's UNROLLED DIRECTIONAL LOOP AND LET CASCADE 0 RESOLVE ITS OWN
 *  SHADOW. THE ONE PART OF TWO VERY DIFFERENT SKIES THAT IS NOT ART.
 * ===========================================================================
 *  This is a hard-coded copy of four exact strings out of three's
 *  `lights_fragment_begin` — the loop header, its `#pragma unroll_loop_end`
 *  tail, the `getShadow` line and the `RE_Direct` call. It stood in both
 *  racers' sky modules BYTE-IDENTICALLY, tabs and all, and the strings were
 *  transcribed here from the game's own source rather than retyped.
 *
 *  WHY IT IS WORTH ONE COPY EVEN THOUGH IT IS SMALL. It is a VERSION SEAM. The
 *  day three reformats that chunk, both games lose their cascade — and they
 *  lose it the quiet way: the guard warns to a console nobody is reading and
 *  returns the chunk unmodified, so the frame renders, the shadow maps are all
 *  allocated and paid for, and cascade 0 is simply never selected. Two copies of
 *  a version seam is two places to check against every three upgrade and one
 *  place somebody will forget. This package's test harness runs this against
 *  the three that is actually installed, so a version that moved the loop is a
 *  RED CHECK rather than a warning in a log.
 *
 *  WHAT IS NOT HERE. Everything the two skies do after this point, which is
 *  most of both functions: the kart racer's is 89 lines, the space racer's is
 *  58, and past the 23 below they share nothing. The GLSL identifiers
 *  `krKeyShadow` and `krCascadeShadow()` ARE shared — both files name them
 *  that, which is why they are not a parameter. If a third sky ever wants
 *  different names they become one, and not before: a parameter with one
 *  possible value is a parameter that documents nothing.
 *
 *  Returns null when the loop is not where it should be. The caller returns the
 *  original chunk, exactly as both games already did.
 * ===========================================================================
 */
export function cascadeZeroLoop(original: string): DirLightLoop | null {
  // THE FOUR EXACT STRINGS OUT OF THREE'S SOURCE ARE `lightsloop.ts`'s. They
  // were the same four in three files — here, and in a base-building game's
  // own `cascadeLightsChunk` — and a version seam wants one place to re-check
  // against a three upgrade, not three. What stays here is the REWRITE, which
  // is the part every rig does differently.
  const site = findDirLightLoop(original);
  if (site === null) {
    console.warn('[cascade] directional light loop moved; cascade selection skipped');
    return null;
  }
  const { shadowLine, reLine } = site;

  // Cascade 0 resolves every map itself and publishes the raw shadow term.
  const body = site.body.replace(shadowLine, `		directionalLightShadow = directionalLightShadows[ i ];
		#if ( UNROLLED_LOOP_INDEX == 0 )
		krKeyShadow = ( directLight.visible && receiveShadow ) ? krCascadeShadow() : 1.0;
		directLight.color *= krKeyShadow;
		#else
${shadowLine.split('\n')[1]}
		#endif`);

  return { body, reLine, splice: site.splice };
}

// ---------------------------------------------------------------------------
// The resolver chunk
// ---------------------------------------------------------------------------
//
// `krCascadeShadow()` is the one function every lit material in both racers
// calls to find out how much key it is receiving. Both games generated it, both
// spliced it into the same chunk at the same anchor, and everything around the
// decision itself — the light-basis constants the filters read, the fallback for
// a driver that is not on the PCF path, the wrapper, and the splice — was the
// same text twice. That is what lives here.
//
// WHAT DOES *NOT* LIVE HERE IS THE DECISION. One game bounds its outermost
// cascade and fades to unshadowed past it, because past that box its world has
// ended; the other treats its outermost as the fallback for everything not in a
// nearer box, because its world has not. That is not a knob and there is no flag
// for it: the caller assembles `body` out of `cascadeHandoverGlsl` blocks and
// whatever tail its own world needs, and hands it in as text.

/**
 * One cascade's hand-over block: "am I inside box `i`, and if I am leaving it,
 * cross-fade to box `next`".
 *
 * Resolve inward-out by calling this for i = 0 upward. Each block returns early
 * when the fragment is comfortably inside its own box — which in a chase frame
 * is most of the screen for cascade 0 — so a fragment costs exactly one filter
 * and never touches the other maps. Only the cross-fade bands pay for two.
 *
 * `next === null` means there is nothing to hand over to and the blend runs
 * against fully lit. A caller whose outermost cascade is the FALLBACK rather
 * than a bounded box should not emit a block for it at all; it should return
 * that cascade's filter unconditionally in its own tail, because a box test on a
 * map that is standing in for the whole world would fade shadows out at the box
 * border for no reason. `pcfGlsl` already carries a border fade for leaving the
 * map itself, which is the case that does need one.
 *
 * THE HAND-OVER TARGET IS GUARDED SEPARATELY FROM THE BLOCK, and that asymmetry
 * is load-bearing. The block only needs cascade `i` to exist; the cross-fade
 * also indexes cascade `next`, and three sizes `directionalShadowMap` from the
 * number of shadow-casting directional lights it actually finds in the scene —
 * a runtime fact, not the length of the specs table. Indexing past the end is a
 * link failure on some drivers and silent garbage on others.
 *
 * `absent(i)` IS WHAT THE BAND RETURNS WHEN THAT GUARD FAILS, and it is the same
 * fact the caller's tail states, restated for the branch where three found fewer
 * shadow casters than the table has cascades. A game whose outermost cascade is
 * a BOUNDED box hands `mix( 1.0, krPcf<i>( ... ), krW )` — outside the chain its
 * world has ended, so the band fades to lit. A game whose outermost is the
 * FALLBACK hands `krPcf<i>( ... )` — it keeps answering, because its world has
 * not. It is a slot rather than a flag on purpose: a boolean in here choosing
 * between two behaviours would be the tell that the two were never one thing,
 * and this is one behaviour with a value the world supplies.
 *
 * The branch does not arise in either game today — both build one light per spec
 * and both cast or neither does — which is exactly why it is written down and
 * swept rather than reasoned about. A guard nothing exercises is a guard nobody
 * knows is wrong.
 */
export function cascadeHandoverGlsl(
  i: number, next: number | null, blend: number, absent: (i: number) => string,
): string {
  const F = glslFloat;
  return /* glsl */`
				#if NUM_DIR_LIGHT_SHADOWS > ${i}
				{
					vec4 nc = vDirectionalShadowCoord[ ${i} ];
					vec3 ndc = nc.xyz / max( nc.w, 1e-6 );
					// Distance to this box's border, 0 at the centre and 1 at the
					// face, taken over depth as well as the two lateral axes so a
					// fragment leaving through the back hands over just as smoothly.
					vec3 krE = abs( ndc - 0.5 ) * 2.0;
					float krW = 1.0 - smoothstep( ${F(blend)}, 1.0,
						max( max( krE.x, krE.y ), krE.z ) );
					if ( krW >= 1.0 ) return krPcf${i}( directionalShadowMap[ ${i} ], nc );
					if ( krW > 0.0 ) {
						${next === null ? `return ${absent(i)};` : `#if NUM_DIR_LIGHT_SHADOWS > ${next}
						return mix( krPcf${next}( directionalShadowMap[ ${next} ], vDirectionalShadowCoord[ ${next} ] ),
							krPcf${i}( directionalShadowMap[ ${i} ], nc ), krW );
						#else
						return ${absent(i)};
						#endif`}
					}
				}
				#endif`;
}

/**
 * Splice `krCascadeShadow()` into `shadowmap_pars_fragment`.
 *
 * THIS IS THE FIX FOR THE HARD-EDGED KEY-LIGHT STEP, and it generalises to N
 * cascades unchanged. The rig it replaced stacked DirectionalLights sharing the
 * key's direction and SPLIT THE KEY'S ENERGY between them, because three has no
 * notion of a cascade: both lights light every fragment and only the shadow test
 * is per-map, so outside the near frustum three returns "lit" from the near map
 * and that light's whole share of the key leaks through anything the far map
 * alone is shadowing. Every version of that is a brightness discontinuity along
 * a dead-straight geometric line, and shrinking the leak only makes the step
 * smaller; it never makes it stop being a step.
 *
 * So: light 0 carries 100% of the key. Lights 1..N-1 are shadow-only slaves —
 * same direction, intensity 0, skipped entirely in `lights_fragment_begin` — and
 * their maps are read from here. What changes at a seam is penumbra width, which
 * the eye reads as distance. What does not change is how much key a surface gets.
 *
 * Indexing the arrays directly is safe because they are declared at the top of
 * this same chunk, and because the game's Sky is the only thing creating
 * DirectionalLights and adds them in cascade order.
 *
 * `basis` is the GLSL prefix for the three light-axis constants declared here
 * and read by every filter — see `pcfGlsl`, which is handed the same string.
 * `axes` is the basis itself; see `LightBasis` for why the game owns it.
 *
 * IT REFUSES RATHER THAN GUESSES. If three's chunk no longer ends in a
 * column-zero `#endif` the resolver is not spliced and it says so, because a
 * resolver spliced at the wrong scope is a shader that does not compile and a
 * game that renders nothing.
 */
export function cascadeResolverChunk(
  original: string,
  specs: CascadeSpec[],
  o: { basis: string; axes: LightBasis; body: string },
): string {
  const F = glslFloat;
  const b = o.basis;
  const ax = o.axes;
  const filters = specs.map((s, i) => pcfGlsl(`krPcf${i}`, s, b)).join('\n');

  const helper = /* glsl */`
	#if NUM_DIR_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )

		// World-space basis of the light's own orthographic camera, identical to
		// the one DirectionalLightShadow derives via lookAt with up = +Y. u runs
		// along ${b}X, v along ${b}Y, and stored depth increases along -${b}Z.
		// ${b} is the prefix this function hands to pcfGlsl for the filters below;
		// these three declarations and that argument are one fact written twice, so
		// change them together. (No backticks in this note: it is INSIDE a template
		// literal, and one would end the document here, a trap met before.)
		const vec3 ${b}X = vec3( ${F(ax.x.x)}, ${F(ax.x.y)}, ${F(ax.x.z)} );
		const vec3 ${b}Y = vec3( ${F(ax.y.x)}, ${F(ax.y.y)}, ${F(ax.y.z)} );
		const vec3 ${b}Z = vec3( ${F(ax.z.x)}, ${F(ax.z.y)}, ${F(ax.z.z)} );

${filters}

	#endif

		float krCascadeShadow() {

			#if !defined( SHADOWMAP_TYPE_PCF )

				// Defensive: the receiver-plane filter above is written against the
				// sampler2DShadow the PCF path declares. Anything else falls back to
				// three's own, which is at least correct if not soft.
				return getShadow(
					directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize,
					directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias,
					directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );

			#else
${o.body}

			#endif

		}

	#endif
`;
  // Insert at file scope after every getShadow variant has been declared: the
  // last column-0 `#endif` closes `#ifdef USE_SHADOWMAP`.
  const at = original.lastIndexOf('\n#endif');
  if (at < 0) {
    console.warn('[sky] shadowmap_pars_fragment layout changed; cascade resolver skipped');
    return original;
  }
  return original.slice(0, at) + '\n' + helper + original.slice(at);
}

/**
 * Snap a cascade's ortho camera to its own texel grid, in the light's basis.
 *
 * WITHOUT THIS, EVERY SHADOW EDGE IN THE FRAME CRAWLS. The map is a discrete
 * grid; if its origin moves by a fraction of a texel as the camera walks, every
 * occluder's silhouette re-rasterises onto different texels each frame and the
 * whole scene's shadow edges shimmer. Quantising the centre to a whole number
 * of texels along the light's u and v axes makes the grid stationary in world
 * space, so an edge only moves when the geometry does.
 *
 * DEPTH IS DELIBERATELY NOT SNAPPED. Quantising along the light axis steps the
 * whole frustum toward and away from the light and buys nothing, because depth
 * is not what the map is discretised in.
 *
 * `basis` must be THE SAME basis the receiver-plane bias in the GLSL reads —
 * see `LightBasis`. If the two disagree the bias points the wrong way and the
 * ground self-shadows, which looks like an acne bug and is not one.
 *
 * Arrived from a base-building game's `Lighting.snapCascade`, which was its
 * only implementation. Nothing in it is lunar; it is arithmetic about a texel.
 */
export function snapCascadeCamera(
  light: THREE.DirectionalLight,
  extent: number,
  mapSize: number,
  distance: number,
  center: THREE.Vector3,
  lightDir: THREE.Vector3,
  basis: LightBasis,
  scratch: THREE.Vector3,
): void {
  const texel = (2 * extent) / mapSize;
  const px = Math.round(center.dot(basis.x) / texel) * texel;
  const py = Math.round(center.dot(basis.y) / texel) * texel;
  const pz = center.dot(basis.z);
  scratch.set(0, 0, 0)
    .addScaledVector(basis.x, px)
    .addScaledVector(basis.y, py)
    .addScaledVector(basis.z, pz);

  light.target.position.copy(scratch);
  light.position.copy(scratch).addScaledVector(lightDir, distance);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}
