/**
 * ============================================================================
 *  Grating.ts — bar thickness for open grating, without a real POM march.
 * ============================================================================
 *
 *  Lifted out of a space racer's material code, where it was the deck of one
 *  see-through straight. Nothing in it is about a straight: it is an alpha
 *  test at a stated porosity plus a second, view-offset tap of the same alpha
 *  map to give the bar an inside face. A catwalk, a fire escape, a drain cover
 *  and a stage riser are the same two taps, which is the whole argument for it
 *  living here — the next game with a walkway you can see through should not
 *  rediscover the offset.
 *
 *  THE DOCBLOCK BELOW IS THE POINT OF THE FILE. It states, in the game's own
 *  words, exactly which third of a parallax-occlusion ask this does NOT do, so
 *  the simplification is marked rather than quietly inherited by every future
 *  consumer. Do not trim it.
 *
 *  THE NUMBERS ARE NOT PARAMETERS YET, deliberately, and for the reason
 *  `MaterialBoostPad.ts` gives: one game has answered these questions once.
 *  When a second game genuinely needs its own bar pitch, add the argument then
 *  and the diff will say which game and why.
 *
 *  It consumes `WORLD_HASH` from ./MaterialChunks.ts, which is preprocessor-
 *  guarded — read the note on it before adding a second injection to a grating.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';
import { WORLD_HASH } from './MaterialChunks.ts';

/**
 * Bar thickness for open grating, without paying for a real POM march.
 *
 * In the game it came from, this is one of the eight signature moments: the
 * deck of that straight IS 38 mm bar at 62 % porosity, and the planet's cloud
 * bands are visible *through the surface you are driving on*, 340 km down,
 * scrolling past at 165 m/s. The art direction asks for "parallax-occlusion
 * with a real silhouette clip, so the bars have thickness and you can see
 * between them", and this is the honest two-thirds of that:
 *
 *   · THE SILHOUETTE CLIP IS REAL — it is the alpha test, at 62 % coverage, so
 *     you genuinely see through the deck and the thing behind it is genuinely
 *     the planet. That half is not faked at all.
 *   · THE THICKNESS IS A SECOND TAP. The alpha map is sampled again, offset
 *     along the view direction in tangent space by the bar's depth, and where
 *     that second sample is solid the fragment is on the INSIDE face of a bar:
 *     darker, rougher, and out of the key. Where both samples are open, nothing
 *     is drawn. That gives the two things a march would give — a visible inner
 *     wall, and the bar's silhouette narrowing as the view goes grazing — for
 *     one texture fetch instead of sixteen.
 *
 * WHAT IT DOES NOT GIVE is a correct silhouette at the deck's own edge, where a
 * true march would let a bar occlude its neighbour. At 165 m/s over a 12 m
 * corridor that case is a few pixels wide and it is the first thing the mobile
 * quality ladder deletes anyway ("cut POM → normal map"), so this is
 * deliberately the rung the phone and the desktop share.
 *
 * Stated plainly because it is a knowing simplification of an explicit ask,
 * and an unmarked one would be exactly the kind of quiet softening that is
 * invisible until a review.
 */
export function injectGrating(mat: THREE.Material): void {
  // x = bar depth in UV units, y = inner-face darkening, z = inner-face roughening
  const uGrate = { value: new THREE.Vector3(0.014, 0.42, 0.22) };
  /*
   * x = bar pitch in UV units — 38 mm bar at 62 % open over a 2.4 m tile is a
   *     100 mm pitch, i.e. 0.0417 of the tile.
   * y = the aggregate value the porosity converges to. 62 % of the fragment is
   *     void `#04060a` and 38 % is bar, so the far-field albedo is 0.38 of the
   *     near-field bar albedo.
   */
  const uGrateMin = { value: new THREE.Vector2(0.0417, 0.38) };
  /*
   * THE PANEL LAYER. "Wallpaper", which is what a review called this
   * surface: "identical black rectangular slots at exactly one cell size across
   * the entire deck, from the camera to the vanishing point ... no variation
   * between bays. Add a per-bay hash to the cell phase and width so consecutive
   * 18 m bays are not the same grid — the eye catches a single-frequency
   * panel-line map instantly and this is the frame where it is largest."
   *
   * x = bay length in BAR PITCHES. The truss bay module is 18.0 m and the
   *     pitch is 100 mm, so 180. Expressed in pitches rather than in UV units
   *     on purpose: `adoptDeck` sets this texture's `repeat` from
   *     `worldScale`, so a constant in UV would mean a different length of
   *     world depending on whether the adoption ran. A multiple of the pitch
   *     uniform is the same 18 m either way.
   * y = bar-phase jitter per panel, as a fraction of one bay, applied ACROSS
   *     the bearing bars. A grating panel is dropped in by a crew and bolted
   *     down; the bars of two adjacent panels do not line up, and that
   *     discontinuity at the joint is the single most recognisable thing about
   *     a real grated deck — and the thing whose total absence made the review
   *     call this surface wallpaper.
   * z = width jitter. Bar stock comes off different mills at ±8 % and the
   *     spacing follows the bar it is welded to.
   * w = per-panel value jitter. Panels are laid at different times and weather
   *     at different rates; this is the same ±7 % `buildDeck` gives its plates.
   */
  const uGrateBay = { value: new THREE.Vector4(180.0, 0.34, 0.09, 0.07) };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uGrate = uGrate;
    shader.uniforms.uGrateMin = uGrateMin;
    shader.uniforms.uGrateBay = uGrateBay;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' + WORLD_HASH + /* glsl */ `
        uniform vec3 uGrate;
        uniform vec2 uGrateMin;
        uniform vec4 uGrateBay;
        float gGrateConv = 0.0;
        // The panel this fragment stands on, and its three jitters, resolved
        // once and read by both alpha taps.
        //
        // A PANEL IS 2.4 m ACROSS BY ONE 18 m BAY ALONG, and both numbers are
        // §2.3's rather than a taste call: 2.4 m is the deck plate width, so
        // the grated bays and the plated ones share a lateral module and a
        // 24 m deck is ten panels wide either way; 18.0 m is the truss bay, so
        // a panel spans exactly one bay and lands on the transverse frames that
        // are physically there to carry it. Everything is expressed in BAR
        // PITCHES, so the module survives whatever repeat the consumer set.
        vec2 gGrateUv = vec2( 0.0 );
        vec3 gGrateBay = vec3( 0.0 );
        float gGrateJoint = 0.0;
        void kGrateBay( vec2 uv ) {
          float bay = uGrateBay.x * uGrateMin.x;
          vec2 cell = vec2( uv.x / ( uGrateMin.x * 24.0 ), uv.y / bay );
          vec3 h = kHash3( vec3( floor( cell ), 7.3 ) );
          gGrateBay = h;
          // ACROSS the bearing bars, never along them. buildGrating indexes the
          // bearing bars off U and the cross rods off V, so a U offset moves
          // the bar phase — which is what two panels dropped in by a crew
          // actually do — while a V offset would slide the cross rods out of
          // line with the frame under them and read as the texture swimming.
          gGrateUv = uv + vec2( ( h.x - 0.5 ) * uGrateBay.y * bay, 0.0 );
          // The joint itself, one panel edge wide and never wider than a pixel
          // at range — same construction and the same reason as
          // injectBreakup's cell cut: a line that smears to a flat darkening
          // in the distance is indistinguishable from the aerial perspective
          // §5.6 bans. It is what MOTIVATES the phase discontinuity: without a
          // visible edge there, the bars simply appear to jump.
          vec2 fr = min( fract( cell ), 1.0 - fract( cell ) );
          float w = max( fwidth( cell.x ), fwidth( cell.y ) ) * 1.2;
          gGrateJoint = ( 1.0 - smoothstep( 0.0, max( 0.004, w ), min( fr.x, fr.y ) ) )
                      * ( 1.0 - smoothstep( 0.14, 0.34, w ) );
        }
        `,
      )
      /*
       * THE ALPHA TEST HAS TO SURVIVE MINIFICATION OR IT BECOMES A NOISE FIELD.
       *
       * The see-through deck is the signature moment and the clip is the
       * honest half of it — you genuinely see through the deck. But a binary
       * test on a 38 mm bar has exactly one correct answer per pixel and no
       * correct answer once a pixel covers more than one bar. A review measured
       * what that looks like:
       * "an opaque high-frequency stipple that reads as coarse gravel or wet
       * sandpaper", and a fringe band of the same stipple along the deck edge
       * in five other frames where the grating is only a few pixels deep.
       * MSAA cannot rescue it — the AO pass forbids MSAA outright and the
       * renderer returns 0 samples on purpose (that guard is correct and
       * must not be touched), so alpha-to-coverage has nothing to resolve
       * against and is not the answer here either.
       *
       * The answer that needs no MSAA: measure the pixel's UV footprint
       * against the bar pitch, and as it approaches one pitch, stop cutting and
       * start AVERAGING. Alpha is lerped to 1 so nothing is discarded, and the
       * albedo is lerped to the 38 % coverage value so the surface arrives at
       * the correct aggregate brightness rather than at the bar's own. The
       * result converges to a flat, correctly-dark grey exactly where a binary
       * mask would start to boil, and the transition happens over the band
       * where a pixel spans a third of a bar to a whole one — which is far
       * enough out that the near-field read is untouched.
       *
       * This is not a substitute for putting the planet's limb under the deck
       * across t 0.84–0.92, which the art direction requires and which is the
       * sky system's. With void behind the holes the porosity reveals `#04060a`
       * and the section is a dark road with holes in it, correctly filtered or
       * not.
       */
      .replace(
        '#include <alphamap_fragment>',
        /* glsl */ `
        #ifdef USE_ALPHAMAP
        {
          kGrateBay( vAlphaMapUv );
          float kGA = texture2D( alphaMap, gGrateUv ).g;
          /*
           * PER-PANEL BAR WIDTH, DONE ON THE COVERAGE RAMP AND NOT ON THE UV.
           *
           * buildGrating writes an ANTI-ALIASED coverage into the alpha
           * channel ( clamp01( s * 1.6 - 0.12 ) ) rather than a binary mask,
           * precisely so the mip chain has a gradient to average. That makes a
           * gain about the 0.42 alpha-test threshold a width control for free:
           * steepening the ramp fattens the bar by a few per cent of pitch and
           * flattening it thins it, and it costs two ALU rather than a second
           * fetch at a scaled UV — which would also have re-tiled the cross
           * rods and put the load path at a different pitch from the bearing
           * bars on the panel next door.
           */
          kGA = clamp( ( kGA - 0.42 ) * ( 1.0 + ( gGrateBay.y - 0.5 ) * 2.0 * uGrateBay.z ) + 0.42, 0.0, 1.0 );
          // The footprint is measured on the UNJITTERED varying on purpose: the
          // phase offset is a step function, so fwidth across the panel joint
          // would read the whole jump as one pixel of motion and converge that
          // one column of pixels to the far-field value — a bright seam along
          // every panel edge, which is the artefact this layer exists to avoid.
          vec2 kGFw = fwidth( vAlphaMapUv );
          float kGFoot = max( kGFw.x, kGFw.y ) / max( 1e-5, uGrateMin.x );
          gGrateConv = smoothstep( 0.30, 0.95, kGFoot );
          diffuseColor.a *= mix( kGA, 1.0, gGrateConv );
          diffuseColor.rgb *= mix( 1.0, uGrateMin.y, gGrateConv );
          // Per-panel value, and the bolted joint between two panels. Both
          // survive the convergence — they are the layer that gives the far end
          // of a long straight something other than one grey, which is
          // §12/C8's value structure doing the job §5.6 forbids fog from doing.
          diffuseColor.rgb *= 1.0 + ( gGrateBay.z - 0.5 ) * 2.0 * uGrateBay.w;
          diffuseColor.rgb *= 1.0 - gGrateJoint * 0.30;
        }
        #endif`,
      )
      // After the alpha test, so a fragment that failed it has already been
      // discarded and this never runs on a hole. Before the roughness map is
      // consumed, so the inner face can genuinely be rougher rather than just
      // darker — an inner face that is only darker reads as a painted shadow.
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        #ifdef USE_ALPHAMAP
        {
          // vViewPosition points fragment -> eye. Its tangent-space XY is the
          // direction the parallax has to walk, and using the interpolated
          // vertex normal rather than the mapped one keeps the offset stable
          // across a bar's own normal-mapped shoulder.
          vec3 kGV = normalize( vViewPosition );
          vec2 kOff = kGV.xy * ( uGrate.x / max( 0.25, abs( kGV.z ) ) );
          // The SAME jittered UV the silhouette tap used. Reading the inner
          // face off the unjittered field would put a bar's inside wall half a
          // pitch away from the bar itself on every panel with a phase offset,
          // which is a shadow that does not belong to anything.
          float kUnder = texture2D( alphaMap, gGrateUv + kOff ).g;
          // Solid here, open one bar-depth behind: this fragment is looking at
          // the inside wall of the bar it is standing on.
          //
          // Faded out by the same convergence the mask above uses: the inner
          // face is a SECOND binary read of the same sub-texel field, so past
          // the point where the bar pitch stops being resolvable it is a second
          // stipple laid over the first, in the roughness channel this time.
          // Below one pitch per pixel the inner face is real and stays; above
          // it, the bar's inside and outside average into one value, which is
          // physically what the eye is being handed anyway.
          float kInner = ( 1.0 - kUnder ) * ( 1.0 - gGrateConv );
          diffuseColor.rgb *= 1.0 - kInner * uGrate.y;
          roughnessFactor = min( 1.0, roughnessFactor + kInner * uGrate.z );
        }
        #endif`,
      );
  };
  // Bumped with the panel layer: the source changed, so a program compiled
  // under the old key would be reused verbatim and the whole layer would be a
  // silent no-op on a warm cache.
  const key = 'grating3';
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
