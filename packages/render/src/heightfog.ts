/**
 * ============================================================================
 *  heightfog — aerial perspective, as an analytic Beer integral through an
 *  exponential atmosphere, with chroma converging faster than value.
 * ============================================================================
 *
 *  three exposes no hook for any of this: `fog` is hard-wired to one exp or
 *  exp2 term against a single flat colour. Both chunks below therefore replace
 *  `<fog_pars_fragment>` and `<fog_fragment>` outright, and both are scene-wide
 *  decisions that whoever owns the sky owns.
 *
 *  ## The two things this does that a stock fog does not
 *
 *  1. THE DENSITY FOLLOWS ALTITUDE, AND IT IS INTEGRATED RATHER THAN SAMPLED.
 *     `exp( -y / H )` is averaged EXACTLY between the ray's clamped start and
 *     end altitudes — the analytic Beer integral of the height profile along
 *     the ray — so a camera on a cliff looking down into a bay gets the density
 *     of the air it is actually looking through, not the density at its own
 *     eye. Both ends are clamped before the exponential, so looking a long way
 *     down cannot drive the density to infinity the way integrating the raw
 *     profile below sea level would.
 *
 *  2. CHROMA CONVERGES FASTER THAN VALUE, and this is the difference between
 *     "fog" and aerial perspective. Mixing straight toward the haze colour by
 *     the Beer factor leaves a distant ridge at, say, 42% haze — the right
 *     VALUE and 58% of its own hot rock hue still showing, which reads as a
 *     cardboard cut-out pasted onto the sky. Real distance does not work that
 *     way: scattered light fills the shadows and washes the hue out long before
 *     it equalises the brightness, which is exactly what lets a painter stack
 *     four ridges at four values and have all four read as "far".
 *
 *     So the fragment is first rotated onto the haze's own chromaticity at a
 *     FASTER rate while KEEPING ITS OWN LUMINANCE — the layer ladder survives
 *     intact and only the colour drains — and only then mixed toward the haze
 *     by the honest Beer factor.
 *
 *  ## What is here and what is not
 *
 *  HERE: the integral, the exp2 fold-in, the interior cut, the luminance-
 *  preserving chroma rotation and where each goes in three's chunk graph.
 *
 *  NOT HERE, and there is no default for any of it: the sea-level density, the
 *  scale height, the sea level itself, the near clip, the cap, and the two
 *  chroma numbers. Those are the air over one particular place. The HAZE
 *  COLOUR is not here either — it arrives as the NAME of a GLSL function the
 *  caller has already emitted, taking the camera's forward azimuth and
 *  returning a colour, so this file never learns what colour the sky is.
 *
 *  ## Per-vertex azimuth, said out loud
 *
 *  The haze is sampled in the camera's forward azimuth, so the horizon
 *  converges dead-on at frame centre and drifts by at most half the horizontal
 *  FOV at the edges — where the sky itself has drifted with it. Per-fragment
 *  would be strictly better and costs one `varying vec3`; it needs every
 *  material that hand-rolls `vFogDepth` to stop doing so. Flagged, not
 *  smuggled.
 */
import { glslFloat } from './cascade.ts';

/** The air over one place. Every field required; none of them is a default. */
export interface HeightFogFit {
  /** density at sea level, per world unit */
  seaDensity: number;
  /** the e-folding height of the profile, in world units */
  heightScale: number;
  /** where y = 0 of the profile is, in world units */
  seaLevel: number;
  /** nothing nearer than this is hazed at all */
  start: number;
  /** the cap. 1.0 would let the far plane become a flat wall of sky. */
  max: number;
  /** how much faster chroma converges than value, and where that stops */
  chromaRate: number;
  chromaMax: number;
  /**
   * How much of the haze is removed at the centre of an interior volume.
   * Aerial perspective is skylight scattered in the air between here and the
   * eye; inside a bore there is no sky above that air.
   */
  interiorCut: number;
}

/**
 * The two chunk replacements, keyed by chunk name so the caller can hand the
 * whole object to whatever installs its shader patches.
 *
 * `stockPars` is three's own `<fog_pars_fragment>`, kept and prepended — the
 * uniforms it declares are still the ones the exp2 branch reads.
 * `hazeFn` is the name of a `vec3 fn( vec2 azimuth )` the caller has already
 * emitted into the same chunk via `hazeGlsl`.
 */
export function heightFogChunks(
  stockPars: string,
  hazeGlslText: string,
  hazeFn: string,
  fit: HeightFogFit,
): Record<string, string> {
  const F = glslFloat;
  const K = {
    SEA: F(fit.seaDensity),
    H: F(fit.heightScale),
    HINV: F(1 / fit.heightScale),
    Y0: F(fit.seaLevel),
    MAX: F(fit.max),
    START: F(fit.start),
  };

  return {
    // The haze fit is a FUNCTION, so it cannot live in `fog_fragment` — that
    // chunk is included inside main(). It goes here, at file scope, in the one
    // fog chunk every material with fog pulls in (including any that rolls its
    // own vFogDepth in the vertex stage and takes this chunk verbatim).
    fog_pars_fragment: `${stockPars}
#ifdef USE_FOG
${hazeGlslText}
#endif
`,

    fog_fragment: /* glsl */`
#ifdef USE_FOG

	// world-space camera forward: minus the third ROW of the view rotation
	vec3 krFwd = -vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );

	float krD = max( vFogDepth - ${K.START}, 0.0 );

	// Exact mean of exp( -y / H ) between the ray's clamped start and end
	// altitudes, which is the analytic Beer integral of the height profile along
	// the ray. Both ends are clamped before the exponential, so a camera looking
	// down a long way cannot drive the density to infinity the way integrating
	// the raw profile below sea level would.
	float krSlope = clamp( krFwd.y, -0.7, 0.7 );
	float krY0 = clamp( cameraPosition.y - ${K.Y0}, -20.0, 600.0 );
	float krY1 = clamp( cameraPosition.y + krSlope * krD - ${K.Y0}, -20.0, 600.0 );
	float krE0 = exp( -krY0 * ${K.HINV} );
	float krE1 = exp( -krY1 * ${K.HINV} );
	float krDy = krY1 - krY0;
	float krAvg = abs( krDy ) < 0.5 ? 0.5 * ( krE0 + krE1 ) : ( krE0 - krE1 ) * ${K.H} / krDy;

	#ifdef FOG_EXP2
		float krGlobal = fogDensity;
	#else
		float krGlobal = 0.0;
	#endif

	float fogFactor = min( 1.0 - exp( -( ${K.SEA} * krAvg + krGlobal ) * krD ), ${K.MAX} );

	// Aerial perspective is skylight scattered in the air between here and the
	// eye. Inside a sealed volume there is no sky above that air, and a third of
	// a stop of haze laid over an interior is a good part of why a tunnel can
	// out-shine its own exit.
	fogFactor *= 1.0 - krInterior * ${F(fit.interiorCut)};

	// CHROMA CONVERGES FASTER THAN VALUE. This is the difference between "fog"
	// and aerial perspective, and its absence is why the backdrop read as a
	// cardboard cut-out: a ridge at 600 m was landing at 42% haze, which is the
	// right VALUE mix and leaves 58% of a hot #dc6428 rock behind — measured on
	// the first reviewed frames, a chroma spread of 116 against a sky of 27, i.e. the
	// most distant thing in shot was four times more saturated than the air in
	// front of it. Real distance does not work that way: scattered light fills
	// in the shadows and washes the hue out long before it equalises the
	// brightness, which is exactly what lets a painter stack four ridges at four
	// different values and still have all four read as "far".
	//
	// So the fragment is first rotated onto the haze's own chromaticity at a
	// faster rate, KEEPING ITS OWN LUMINANCE — the layer ladder survives intact,
	// only the colour drains — and only then mixed toward the haze by the honest
	// Beer factor. At 600 m that is 78% desaturated but only 42% lightened; at
	// 3 km both are at the cap and the headland sits a couple of percent off the
	// sky it stands in front of, which is what §9.5 is asking for.
	vec3 krHazeCol = ${hazeFn}( krFwd.xz );
	float krHazeL = max( dot( krHazeCol, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
	float krOwnL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	vec3 krDrained = krHazeCol * ( krOwnL / krHazeL );
	float krChroma = min( fogFactor * ${F(fit.chromaRate)}, ${F(fit.chromaMax)} );

	gl_FragColor.rgb = mix( mix( gl_FragColor.rgb, krDrained, krChroma ), krHazeCol, fogFactor );

#endif
`,
  };
}
