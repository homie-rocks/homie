/**
 * ============================================================================
 *  Cascaded shadow maps, THE DERIVATIVE VARIANT — for a light that moves.
 * ============================================================================
 *
 * ## Why there are two of these and merging them would be a defect
 *
 * `cascade.ts` next door generates the same family of shaders and it is not
 * this. It BAKES THE LIGHT'S ORTHONORMAL BASIS INTO THE GLSL AS LITERALS and
 * solves the receiver-plane gradient in closed form — two dot products and a
 * divide, exact at every slope, and cheaper than anything here. Every game with
 * a fixed key should use that one.
 *
 * It is unavailable to a game whose light MOVES. A base-building game set at
 * 89.9° south has a sun that sweeps a full 360° of azimuth per day; a basis
 * baked at compile time is wrong within seconds, and there is no uniform
 * channel into a shared `THREE.ShaderChunk` to carry a live one. So this
 * variant measures the gradient from SCREEN-SPACE DERIVATIVES of the shadow
 * coordinate instead, which needs no knowledge of where the light is at all.
 *
 * **They are two techniques, not one implementation in two places.** A single
 * `pcfGlsl()` covering both would compile, would pass every check, and would
 * quietly give one game the other's shadows — two things that genuinely differ
 * merged into one, in GLSL, where it is even harder to see because nothing in
 * Node runs a shader. They live side by side on purpose, and a game picks the
 * one that matches its light.
 *
 *   fixed key, cheapest, exact          -> `cascade.ts`      `pcfGlsl`
 *   key that moves at runtime           -> here              `pcfDerivGlsl`
 *
 * ## The one rule the derivatives impose, and it is a correctness rule
 *
 * `dFdx`/`dFdy` are only defined in UNIFORM CONTROL FLOW. Every gradient must
 * therefore be computed at the TOP of the resolver, unconditionally, for every
 * cascade, before the selection chain takes its first early return. That is what
 * `cascadeGradientsGlsl` is for and why it is a separate emitter from
 * `cascadeHandoverDerivGlsl` rather than one function that emits both: the two
 * blocks have to end up in that order with nothing conditional between them, and
 * splitting them makes the ordering visible at the call site instead of being a
 * comment somebody can move code past.
 *
 * Moving a gradient call inside the chain is a bug that looks like random
 * speckle along cascade borders. It is guarded by nothing but this paragraph and
 * the shape of these two functions.
 *
 * ## What is a parameter and what is not
 *
 * `ns` is a GLSL IDENTIFIER PREFIX and nothing else — every symbol these
 * emitters declare or reference is `${ns}`-prefixed, so a page that installs two
 * different rigs into the same `ShaderChunk` table does not collide. It is not a
 * mode: no branch in this file reads it.
 *
 * Every number is the CALLER'S and every field is REQUIRED. There are no
 * optionals and no defaults here, because a default is how a game silently
 * inherits another game's art direction and it looks completely fine.
 * `SHADOW_BORDER_FADE` is the exception and it is `cascade.ts`'s, for the reason
 * stated there: it is a property of a shadow map's own border, not a look.
 *
 * ## NO BACKTICKS BELOW THE FIRST TEMPLATE LITERAL
 *
 * Every emitter below builds GLSL inside a template literal. A backtick used to
 * quote an identifier in a GLSL comment — this repository's house style
 * everywhere else — TERMINATES THE STRING, and the remainder parses as
 * TypeScript and fails a hundred lines later naming the wrong construct. It has
 * cost four files so far.
 */
import { SHADOW_BORDER_FADE, glslFloat } from './cascade.ts';

/**
 * What one derivative-variant PCF filter needs, resolved on the CPU before any
 * shader text exists.
 *
 * `index`, `extent` and `mapSize` are only read to write the human-readable
 * header comment on the emitted function — which is worth its two lines, because
 * a shader dumped out of a driver log is otherwise a wall of unattributed
 * floats. `pcfTexels` and `taps` are the filter.
 */
export interface DerivFilterSpec {
  /** Index in `directionalShadowMap[]`, for the emitted comment. */
  index: number;
  /** Ortho half-extent, metres, for the emitted comment. */
  extent: number;
  mapSize: number;
  /** PCF disc radius in shadow-map texels. Derive it; do not dial it. */
  pcfTexels: number;
  taps: number;
}

/**
 * The receiver-plane solve itself: `vec2 ${ns}ReceiverPlane( vec3 c, float gmax )`.
 *
 * ── WHY A RECEIVER-PLANE BIAS AT ALL ─────────────────────────────────────────
 * A PCF tap does not sample the depth the fragment would have; it samples the
 * depth of a point some texels away in shadow-map UV, and on a sloped receiver
 * that point is a different distance from the light. At an 11° sun the angle
 * between flat ground's normal and the light is 79°, whose tangent is 5.1 — the
 * depth error of a tap 1.2 texels away is FIVE TIMES its lateral reach. There is
 * no constant bias that is both large enough to stop the acne and small enough
 * not to detach every shadow from its object. The gradient has to be measured,
 * and once it is, a constant bias of exactly zero becomes affordable, which is
 * what welds a chamfer's shadow to the chamfer.
 *
 * ── WHY FROM DERIVATIVES ─────────────────────────────────────────────────────
 * Because the light moves. See the file header.
 *
 * `gmax` IS A PARAMETER OF THE GLSL FUNCTION AND NOT A LITERAL, which is the one
 * place this variant is looser than the closed-form one, and deliberately: the
 * clamp is per-cascade (it converts a slope tangent into normalised depth-per-uv
 * using that cascade's own extent and depth range) while the function is shared
 * by all of them. Every caller passes a compile-time constant, so the compiler
 * folds it back.
 *
 * NOTE ON INSTANCING: nothing here reconstructs a world position, so three not
 * applying `instanceMatrix` to `transformed` — which makes a modelMatrix-derived
 * world position instance-local and identical for every instance — does not
 * apply. If a world position is ever added to this chunk it WILL apply, and it
 * must be guarded with `#ifdef USE_INSTANCING`.
 */
export function receiverPlaneGlsl(ns: string): string {
  return /* glsl */`
		// Fit the plane of the receiver in shadow-map space and return
		// d(depth)/d(uv). Solves the 2x2 system
		//     [ du/dx  dv/dx ] [ dz/du ]   [ dz/dx ]
		//     [ du/dy  dv/dy ] [ dz/dv ] = [ dz/dy ]
		// where x,y are screen pixels and u,v,z are the shadow coordinate. Exact
		// at every slope, and it never needs to know where the light is.
		vec2 ${ns}ReceiverPlane( vec3 c, float gmax ) {

			vec3 ddx = dFdx( c );
			vec3 ddy = dFdy( c );
			float det = ddx.x * ddy.y - ddx.y * ddy.x;
			vec2 g = vec2( 0.0 );
			// A degenerate determinant means the quad has no area in shadow UV,
			// which happens edge-on. Zero gradient there is right: a surface seen
			// edge-on contributes no visible shadow interior to bias.
			if ( abs( det ) > 1e-12 ) {
				g = vec2(
					ddy.y * ddx.z - ddx.y * ddy.z,
					ddx.x * ddy.z - ddy.x * ddx.z ) / det;
			}
			return clamp( g, -gmax, gmax );

		}
`;
}

/**
 * One shadow map's PCF filter, with every constant resolved on the CPU.
 *
 * Signature of the emitted function:
 *
 *     float ${name}( sampler2DShadow map, vec3 c, vec2 g, float phi )
 *
 * and THAT SIGNATURE IS THE WHOLE DIFFERENCE from `cascade.ts`'s `pcfGlsl`,
 * which takes `( sampler2DShadow map, vec4 coord )` and derives `c` and `g`
 * itself from a baked basis. Here the divided coordinate and the gradient are
 * both handed in, because they were computed up front in uniform control flow
 * (see the file header) and because one fragment's chain may need two maps'
 * worth of them.
 *
 * There is no constant-depth bias term. It is not omitted, it is ZERO: the
 * measured gradient removes the slope error exactly, and what is left over is
 * depth quantisation, which is centimetres.
 *
 * One filter serves every map a rig has — the cascades and any separate fill
 * map — because the derivation is the same in all of them: half the source's
 * penumbra at this map's texel size, plus one texel of anti-aliasing floor. Only
 * the source's angular diameter differs, and the caller has already folded that
 * into `pcfTexels`.
 *
 * `vogelDiskSample`, `interleavedGradientNoise` and the fragment's `phi` are the
 * CALLER'S, declared in the chunk this text is spliced into. That is why this
 * returns TEXT rather than a chunk: it is a fragment of somebody else's.
 */
export function pcfDerivGlsl(name: string, s: DerivFilterSpec): string {
  const F = glslFloat;
  const radiusUv = s.pcfTexels / s.mapSize;
  const taps: string[] = [];
  for (let i = 0; i < s.taps; i++) {
    taps.push(
      `\t\t\to = vogelDiskSample( ${i}, ${s.taps}, phi ) * ${F(radiusUv)};`,
      // The tap is compared at the depth the RECEIVER PLANE would have there,
      // not at the fragment's own depth. That is the whole trick.
      '\t\t\ts += texture( map, vec3( c.xy + o, c.z + dot( o, g ) ) );',
    );
  }
  return /* glsl */`
		// map ${s.index}: ${s.extent * 2} m box at ${s.mapSize} squared = ${(200 * s.extent / s.mapSize).toFixed(2)} cm per texel,
		// filter radius ${s.pcfTexels.toFixed(2)} texels, derived from the source angular size.
		float ${name}( sampler2DShadow map, vec3 c, vec2 g, float phi ) {

			if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;

			float s = 0.0;
			vec2 o;
${taps.join('\n')}
			s *= ${F(1 / s.taps)};

			// Soft frustum border, see SHADOW_BORDER_FADE.
			vec2 e = abs( c.xy - 0.5 ) * 2.0;
			return mix( 1.0, s, 1.0 - smoothstep( ${F(SHADOW_BORDER_FADE)}, 1.0, max( e.x, e.y ) ) );

		}
`;
}

/**
 * Every cascade's divided shadow coordinate and receiver-plane gradient,
 * declared and filled UP FRONT AND UNCONDITIONALLY.
 *
 * Emit this immediately inside the resolver, before `cascadeHandoverDerivGlsl`
 * blocks and before anything that can return. It declares, for each cascade `i`:
 *
 *     vec3 ${ns}C<i>   the divided shadow coordinate, or vec3( 2.0 ) when that
 *                      cascade does not exist at runtime (out of every box, so
 *                      every filter's own bounds test rejects it)
 *     vec2 ${ns}G<i>   d(depth)/d(uv) on the receiver plane, clamped
 *
 * THIS PLACEMENT IS THE CORRECTNESS REQUIREMENT, NOT A STYLE. See the file
 * header on uniform control flow. The `#if NUM_DIR_LIGHT_SHADOWS > i` around
 * each one is a PREPROCESSOR condition, not a branch — it is resolved before the
 * shader has any control flow at all, so it does not break the rule, and it is
 * required because three sizes `vDirectionalShadowCoord` from the number of
 * shadow-casting directional lights it actually finds in the scene, which is a
 * runtime fact and not the length of the specs table.
 *
 * `gradMax` is one entry per cascade, in cascade order: the maximum
 * |d(depth)/d(uv)| that cascade will accept, which is a slope tangent converted
 * through that cascade's own extent and depth range. A quad straddling a
 * silhouette takes its derivative across two surfaces and the fitted gradient
 * goes to infinity; unclamped that is a bright dot that survives every denoiser.
 */
export function cascadeGradientsGlsl(ns: string, gradMax: readonly number[]): string {
  const F = glslFloat;
  const out: string[] = [];
  for (let i = 0; i < gradMax.length; i++) {
    out.push(`
			vec3 ${ns}C${i} = vec3( 2.0 );
			vec2 ${ns}G${i} = vec2( 0.0 );
			#if NUM_DIR_LIGHT_SHADOWS > ${i}
			{
				vec4 raw = vDirectionalShadowCoord[ ${i} ];
				${ns}C${i} = raw.xyz / max( raw.w, 1e-6 );
			}
			${ns}G${i} = ${ns}ReceiverPlane( ${ns}C${i}, ${F(gradMax[i] as number)} );
			#endif`);
  }
  return out.join('\n');
}

/**
 * One cascade's hand-over block: "am I inside box `i`, and if I am leaving it,
 * cross-fade to box `i + 1`".
 *
 * Emit these for i = 0 upward, AFTER `cascadeGradientsGlsl`, so the chain
 * resolves innermost-out. Each block returns immediately when the fragment is
 * comfortably inside its own box — which in a typical frame is most of the
 * visible ground for cascade 0 — so a fragment costs exactly one filter and
 * never touches the other maps. Only the cross-fade bands pay for two.
 *
 * `last` says this is the outermost cascade and there is nothing to hand over
 * to, so the band blends against fully lit. The caller emits its own tail after
 * the chain (`return 1.0;` for a rig whose world ends at the outermost box).
 *
 * THE HAND-OVER TARGET IS GUARDED SEPARATELY FROM THE BLOCK, and that asymmetry
 * is load-bearing. The block only needs cascade `i` to exist; the cross-fade
 * also indexes cascade `i + 1`, and three sizes `directionalShadowMap` from the
 * number of shadow-casting directional lights it actually finds in the scene — a
 * runtime fact, not the length of the specs table. Indexing past the end is a
 * link failure on some drivers and silent garbage on others.
 *
 * The filters this calls are `${ns}Pcf<i>`, which is what the caller must have
 * named its `pcfDerivGlsl` emissions. `blend` is where the cross-fade begins as
 * a fraction of the box half-extent; it is the caller's number because cascade
 * spacing is the caller's.
 */
export function cascadeHandoverDerivGlsl(ns: string, i: number, blend: number, last: boolean): string {
  const F = glslFloat;
  return /* glsl */`
			#if NUM_DIR_LIGHT_SHADOWS > ${i}
			{
				// Distance to this box's border, 0 at the centre and 1 at the face,
				// taken over depth as well as the two lateral axes so a fragment
				// leaving through the back hands over just as smoothly as one
				// leaving through the side.
				vec3 ${ns}E = abs( ${ns}C${i} - 0.5 ) * 2.0;
				float ${ns}W = 1.0 - smoothstep( ${F(blend)}, 1.0,
					max( max( ${ns}E.x, ${ns}E.y ), ${ns}E.z ) );
				if ( ${ns}W >= 1.0 ) return ${ns}Pcf${i}( directionalShadowMap[ ${i} ], ${ns}C${i}, ${ns}G${i}, ${ns}Phi );
				if ( ${ns}W > 0.0 ) {
					// The hand-over target is guarded SEPARATELY from the block. The
					// block only needs cascade ${i} to exist; the cross-fade also
					// indexes cascade ${i + 1}, and three sizes those arrays from the
					// number of shadow-casting directional lights it actually finds in
					// the scene, which is a runtime fact and not the length of the
					// specs table. Indexing past the end is a link failure on some
					// drivers and silent garbage on others.
					float ${ns}Next = 1.0;
					${last ? '' : `#if NUM_DIR_LIGHT_SHADOWS > ${i + 1}
					${ns}Next = ${ns}Pcf${i + 1}( directionalShadowMap[ ${i + 1} ], ${ns}C${i + 1}, ${ns}G${i + 1}, ${ns}Phi );
					#endif`}
					return mix( ${ns}Next, ${ns}Pcf${i}( directionalShadowMap[ ${i} ], ${ns}C${i}, ${ns}G${i}, ${ns}Phi ), ${ns}W );
				}
			}
			#endif`;
}

// ---------------------------------------------------------------------------
// indirectOcclusionChunk - an occlusion scalar into three's INDIRECT terms
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 *  MULTIPLY A PER-FRAGMENT OCCLUSION TERM INTO three's INDIRECT DIFFUSE AND
 *  SPECULAR, appended to `aomap_fragment`.
 * ===========================================================================
 *  `aomap_fragment` runs AFTER `lights_fragment_end`, so both indirect
 *  accumulators are already summed and this is a single multiply on the total
 *  - the hemisphere fill, the bounce and the env-map irradiance in one.
 *
 *  THE GUARD IS `RE_IndirectDiffuse` AND NOT `USE_SHADOWMAP`, AND THAT IS THE
 *  WHOLE REASON THIS IS WORTH ONE COPY. `aomap_fragment` is included by
 *  MESHBASIC as well as by the four lit shaders, and meshbasic does NOT include
 *  `shadowmap_pars_fragment` - so a varying declared over there does not exist
 *  here, and a `USE_SHADOWMAP` guard alone is a compile error on every unlit
 *  material in the game. `RE_IndirectDiffuse` is defined by exactly the four
 *  lit chunks, all of which do include the shadow pars. That is a fact about
 *  three, it is not obvious, and finding it costs a black scene.
 *
 *  THE BODY MIRRORS three's OWN aoMap BODY LINE FOR LINE, including
 *  `computeSpecularOcclusion` and the `USE_ENVMAP && STANDARD` guard on it,
 *  because that is the code path known to compile everywhere a standard
 *  material set runs. Do not "simplify" the specular half to a plain multiply:
 *  `computeSpecularOcclusion` is roughness-aware, and a mirror-smooth flank
 *  reflects the sky it can still see and must not be dimmed by a floor.
 *
 *  EVERY FIELD IS THE CALLER'S. `term` is a GLSL expression naming a value the
 *  caller's own patched light loop wrote, `strength` is the GLSL expression for
 *  how much of it to take, and `specRatio` is how much of THAT the specular
 *  gets. A package choosing any of the three would be choosing how grounded
 *  somebody else's world looks.
 * ===========================================================================
 */
export interface IndirectOcclusionSpec {
  /** GLSL prefix for the locals this emits, so two injections cannot collide. */
  ns: string;
  /**
   * GLSL expression for the occlusion, 0 = unoccluded. It must evaluate to 0 on
   * a material whose light loop did not run, so this is a no-op there rather
   * than a wrong answer.
   */
  term: string;
  /** GLSL expression for the scale on `term`. A uniform makes it an ablation. */
  strength: string;
  /** Fraction of the diffuse occlusion the SPECULAR takes, 0..1. */
  specRatio: number;
  /**
   * Extra `#if` clauses ANDed onto the guard - e.g. that the shadow index the
   * term reads is within `NUM_DIR_LIGHT_SHADOWS`. Empty string for none.
   */
  extraGuard: string;
  /**
   * GLSL comment lines emitted verbatim above the locals, tab-indented and
   * newline-terminated by the caller. Empty string for none.
   *
   * IT IS A PARAMETER SO THE MEASUREMENT CAN TRAVEL WITH THE CHUNK IT
   * JUSTIFIES. What `term` MEANS in a given world - which of two visibilities
   * it is, and why the other one was wrong - is a paragraph that belongs where
   * somebody reading the generated shader will find it, and it is not the same
   * paragraph twice. A package cannot write it and a game cannot attach it
   * afterwards, so it comes in.
   */
  note: string;
}

export function indirectOcclusionChunk(original: string, s: IndirectOcclusionSpec): string {
  const g = s.extraGuard === '' ? '' : ` && ${s.extraGuard}`;
  return original + /* glsl */`
#if defined( RE_IndirectDiffuse ) && defined( USE_SHADOWMAP )${g}

${s.note}	float ${s.ns}AoK = ${s.strength};
	float ${s.ns}ContactAo = 1.0 - ${s.ns}AoK * ${s.term};

	reflectedLight.indirectDiffuse *= ${s.ns}ContactAo;

	#if defined( USE_CLEARCOAT )
		clearcoatSpecularIndirect *= ${s.ns}ContactAo;
	#endif

	#if defined( USE_ENVMAP ) && defined( STANDARD )

		float ${s.ns}AoDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion(
			${s.ns}AoDotNV, mix( 1.0, ${s.ns}ContactAo, ${glslFloat(s.specRatio)} ), material.roughness );

	#endif

#endif
`;
}
