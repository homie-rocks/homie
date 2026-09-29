/**
 * ============================================================================
 *  Triplanar.ts — world-space triplanar projection at three scales.
 * ============================================================================
 *
 *  Lifted out of a kart racer's `Materials.ts`, where it was the whole reason
 *  that file's shader-injection layer was 1,780 lines. It was byte-identical
 *  in a space racer at the time of a survey of the games' materials
 *  (`TriplanarOpts` + `injectTriplanar`, "identical, 455 lines"); the space
 *  racer has since deleted its copy, having no cliff and no rock cut to
 *  point it at. That deletion is exactly why this belongs here rather than in
 *  one game: the next outdoor game will have a rock face, and four hundred
 *  lines of correctly-tuned three-band world projection with sedimentary
 *  bedding in it is not something a generated game rediscovers.
 *
 *  IT KNOWS NOTHING ABOUT A RACE. Every argument is a length in metres, an
 *  amplitude, a colour or a texture. There is no lap, no track and no vehicle
 *  in it — the two consumers today happen to be a sea cliff and a tunnel bore,
 *  and both would mean the same thing in a walking simulator.
 *
 *  It consumes `WORLD_PARS` / `WORLD_VERTEX` / `WORLD_HASH` / `tintMul` from
 *  ./MaterialChunks.ts. Those chunks are preprocessor-guarded — read the note
 *  on them before adding a second injection to a triplanar material.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';
import {
  WORLD_HASH,
  WORLD_PARS,
  WORLD_VERTEX,
  tintMul,
} from './MaterialChunks.ts';

const TRI_COMMON = /* glsl */ `
uniform float uTriScale;
uniform float uTriSharp;
varying vec3 vTriN;
vec3 triWeights() {
  vec3 w = pow( abs( normalize( vTriN ) ), vec3( uTriSharp ) );
  return w / max( 1e-4, w.x + w.y + w.z );
}
`;

export interface TriplanarOpts {
  /** metres of world covered by one tile of the detail octave */
  worldScale: number;
  /**
   * Projection blend exponent. Too low and the X and Z projections cross-fade
   * over most of a curved surface, which is not a blend — it is two copies of a
   * directional noise sliding past each other, and it reads as fur. A tunnel
   * bore or a boulder needs one dominant projection almost everywhere.
   */
  sharpness: number;
  /** metres per cycle of the low-frequency variation */
  period: number;
  /**
   * How many times larger the macro form octave is than the detail octave.
   * Deliberately non-integer so the two never come back into phase.
   */
  macro: number;
  /** how hard the macro octave tips the surface normal */
  macroRelief: number;
  /**
   * Middle band multiple. A 40 m cliff built from a 4 m tile and a 34 m macro
   * has a hole in its frequency ladder exactly where a boulder, a bedding step
   * or a shadowed recess would live — and a surface with nothing between 60 cm
   * and 30 m reads as sandpaper on a ramp no matter how good either end is.
   * Omit to skip the band entirely (three taps).
   */
  mid?: number;
  midRelief?: number;
  /**
   * Amplitude of the detail octave relative to the form bands, 0..1.
   *
   * This is the ratio that decides whether a rock face reads as rock or as
   * sandpaper, and it is not "how much detail" — it is "how much detail
   * *against* the form". A 4 mm octave at full strength on a 40 m face wins the
   * eye outright no matter how much metre-scale relief sits under it, because
   * its per-pixel contrast is an order higher. Under 1 the form bands lead and
   * the detail becomes what it should be: the last decade of scale.
   */
  detailRelief?: number;
  /**
   * Crown/haunch/springline separation for a bore, driven by the *geometric*
   * normal's world Y — a tunnel ceiling faces down, its floor faces up, and no
   * noise field knows that. x = albedo swing, y = roughness swing.
   */
  boreGradient?: [number, number];
  /** [near, far] metres over which the ALBEDO tile settles toward its local mean */
  settle?: [number, number];
  /**
   * [near, far] for the DETAIL NORMAL octave alone. Defaults to `settle`.
   *
   * These two ramps want to be an octave apart and used not to be, which is why
   * the cliff failed in both directions at once. The 4 mm chip relief is the only
   * band small enough to alias, and on a 40 m face viewed from a chase camera it
   * is sub-texel by about 25 m — held at full amplitude to 70 m it is the crawl
   * the review called dither. The *albedo* is the opposite case: fading it early
   * is what turns a headland into a flat orange silhouette at 150 m, because the
   * macro colour bands are the only thing left saying "rock" out there. So the
   * detail normal now dies by ~45 m and the albedo tile holds to ~250 m.
   */
  settleDetail?: [number, number];
  /**
   * Macro ALBEDO bands: `[macroAmount, breakAmount]`.
   *
   * The single thing that separates a rock face from a bump map on a ramp. The
   * form bands have always been pushed into the NORMAL only, so the whole 40 m
   * face came out as one bleached tone with all of its structure in relief —
   * which means the moment a bed turns away from a 14° key it stops existing.
   * Rock reads as rock because different beds are *different colours*.
   *
   * `macroAmount` re-reads the albedo map at the macro band's own scale (34 m on
   * the cliff) and applies it as a colour ratio, so a 34 m zone of the tile's own
   * palette lands on the face at 34 m. It is a ratio and not a sample, so it
   * cannot double the saturation or drift off-palette.
   *
   * `breakAmount` cross-fades toward a *second* read of the same map at a
   * non-integer tile multiple (`albedoBreakScale`, default 1.37×), masked by
   * the low-frequency world band. Two incommensurate tilings blended by a third
   * frequency have no common period, which is what kills the near-field repeat
   * the art direction calls an automatic fail.
   */
  albedoBands?: [number, number];
  /** non-integer tile multiple for the albedo phase break. Default 1.37. */
  albedoBreakScale?: number;
  /**
   * Warm bounce fill, `[hex, intensity]`.
   *
   * The art direction forbids pure-black shadows and specifies the bounce that
   * stops them: warm sand/stone from below at `#c98f5a`. Inside a tunnel bore
   * there is no sky to fill with, so the unlit half of the bore was measuring a
   * 5th percentile of 5/255 — genuine black with the albedo entirely gone. This
   * is a flat, albedo-multiplied lift, so it returns the rock's own colour to
   * the shade rather than washing grey over it.
   */
  bounce?: [number, number];
  /**
   * World-space sedimentary bedding.
   *
   * This is the piece that no amount of resampling a tile at bigger scales can
   * ever supply, and its absence is why a 40 m sea cliff built out of three
   * bands of the same isotropic noise still reads as a lumpy ramp rather than as
   * rock. Strata are *world horizontal*: they run level across the whole face
   * regardless of how it folds, they are the same height above sea level on the
   * headland as they are in the tunnel cut, and every one of them is a different
   * hardness, so each weathers back a different distance and takes the light
   * differently. A noise field cannot know any of that. Two dozen ALU can.
   *
   * `thickness` is the bed height in metres; `tone` and `rough` are the
   * per-bed swings; `relief` tips the surface normal into a ledge at each
   * bedding plane; `dip` tilts the beds so they are not a spirit level; `warp`
   * lets them wander by that many metres so they are not a ruler either.
   */
  strata?: {
    thickness: number;
    tone: number;
    rough: number;
    relief: number;
    warp?: number;
    dip?: [number, number];
    /** albedo multiplier of the pale/ochre beds */
    tint?: number;
    tintAmount?: number;
  };
  /** macro-scale colour drift: albedo multipliers on the bright and dark side */
  macroWarm?: number;
  macroCool?: number;
  macroTint?: number;
  /** the macro layer's own map (R = drift). Build it with `this.macroMaps()`. */
  macroTex: THREE.Texture;
}

/**
 * World-space triplanar projection with whiteout normal blending, at two
 * scales. Used on cliff rock and the tunnel bore, where the geometry has no
 * sane UV layout and any planar mapping smears down a 40 m rock face.
 *
 * Three bands, not one. A 1024² tile at 4 m carries 4 mm to ~60 cm and nothing
 * else; a 40 m sea cliff wearing only that is sandpaper on a low-poly ramp, and
 * because the only spatial frequency present sits above the mip cutoff it also
 * dissolves into flat tinted mush by 25 m. Resampling the *same* normal map at
 * `mid`× (~10 m) and `macro`× (~34 m) the scale costs six taps and supplies the
 * two missing decades — the boulder and the bedding step — so the same material
 * has structure at 4 mm, 30 cm, 10 m and 34 m and the 14° key has something to
 * rake across at every one of them.
 */
export function injectTriplanar(mat: THREE.Material, o: TriplanarOpts): void {
  const uScale = { value: 1 / o.worldScale };
  const uSharp = { value: o.sharpness };
  const uMacro = { value: new THREE.Vector3(1 / (o.worldScale * o.macro), o.macroRelief, o.period) };
  const uMid = {
    value: new THREE.Vector3(1 / (o.worldScale * (o.mid ?? 1)), o.midRelief ?? 0, o.detailRelief ?? 1),
  };
  const bore = o.boreGradient ?? [0, 0];
  const uBore = { value: new THREE.Vector2(bore[0], bore[1]) };
  const settle = o.settle ?? [1e6, 1e6 + 1];
  const uSettle = { value: new THREE.Vector2(settle[0], settle[1]) };
  const settleD = o.settleDetail ?? settle;
  const bands = o.albedoBands ?? [0, 0];
  const uAlbBands = {
    value: new THREE.Vector4(bands[0], bands[1], 1 / (o.albedoBreakScale ?? 1.37), settleD[0]),
  };
  const uSettleD = { value: new THREE.Vector2(settleD[0], settleD[1]) };
  const bounceC = new THREE.Color(o.bounce ? o.bounce[0] : 0xffffff).convertSRGBToLinear();
  const uBounce = {
    value: new THREE.Vector4(bounceC.r, bounceC.g, bounceC.b, o.bounce ? o.bounce[1] : 0),
  };
  const hasMid = o.mid !== undefined && (o.midRelief ?? 0) > 0;
  const hasBore = bore[0] !== 0 || bore[1] !== 0;
  const hasBands = bands[0] > 0 || bands[1] > 0;
  const hasBounce = !!o.bounce && o.bounce[1] > 0;

  const st = o.strata;
  const uStrata = { value: new THREE.Vector4(st?.thickness ?? 1, st?.tone ?? 0, st?.rough ?? 0, st?.relief ?? 0) };
  const dip = st?.dip ?? [0.06, -0.041];
  const uStrataDip = { value: new THREE.Vector3(dip[0], dip[1], st?.warp ?? 0) };
  const bedTint = tintMul(st?.tint ?? 0xffffff, true);
  const uStrataTint = { value: new THREE.Vector4(bedTint.x, bedTint.y, bedTint.z, st?.tintAmount ?? 0) };
  const triWarm = tintMul(o.macroWarm ?? 0xffffff, true);
  const triCool = tintMul(o.macroCool ?? 0xffffff, true);
  const uTriWarm = { value: new THREE.Vector4(triWarm.x, triWarm.y, triWarm.z, o.macroTint ?? 0) };
  const uTriCool = { value: new THREE.Vector3(triCool.x, triCool.y, triCool.z) };
  const hasStrata = !!st && (st.tone > 0 || st.rough > 0 || st.relief > 0);
  const hasTriTint = (o.macroTint ?? 0) > 0;
  const uMacroTex = { value: o.macroTex };

  // Beds are found from the world Y of the fragment, tilted by `dip` and pushed
  // around by the macro band so a bedding plane is a wandering line and not a
  // contour. `floor` gives a stable per-bed id to hash, which is what lets one
  // bed be a hard pale limestone and the next a soft dark marl.
  const STRATA_SETUP = hasStrata
    ? /* glsl */ `
        {
          float kSY = vWorldP.y + vWorldP.x * uStrataDip.x + vWorldP.z * uStrataDip.y
                    + gBreak * uStrataDip.z;
          float kS = kSY / uStrata.x;
          gBedF = fract( kS );
          vec3 kBH = kHash3( vec3( floor( kS ) * 1.37 + 4.2, 5.1, 2.3 ) );
          gBedTone = ( kBH.x - 0.5 ) * 2.0;
          gBedRough = ( kBH.y - 0.5 ) * 2.0;
          gBedHard = kBH.z;
          // thin recessive bedding planes: the shadow line between two beds is
          // most of what reads as layering from 40 m away
          gBedPlane = max( smoothstep( 0.12, 0.0, gBedF ), smoothstep( 0.88, 1.0, gBedF ) );
        }`
    : '';
  const STRATA_ALBEDO = hasStrata
    ? /* glsl */ `
          sampledDiffuseColor.rgb *= 1.0 + gBedTone * uStrata.y - gBedPlane * uStrata.y * 1.15;
          sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uStrataTint.rgb,
                                          clamp( gBedTone, 0.0, 1.0 ) * uStrataTint.a );`
    : '';
  const STRATA_ROUGH = hasStrata
    ? /* glsl */ `
          roughnessFactor *= 1.0 + gBedRough * uStrata.z + gBedPlane * uStrata.z * 0.8;`
    : '';
  // The ledge itself. A bed weathers back to a shallow overhang, so the normal
  // has to lean over the top of each bed and tuck under its base — a value break
  // alone paints a stripe on a smooth ramp and the eye is not fooled for a frame.
  const STRATA_NORMAL = hasStrata
    ? /* glsl */ `
          {
            vec3 kUpT = vec3( 0.0, 1.0, 0.0 ) - triWorldN * triWorldN.y;
            float kUL = length( kUpT );
            if ( kUL > 1e-3 ) {
              float kLedge = cos( gBedF * 6.2831853 ) * ( 0.45 + gBedHard * 1.05 );
              triWorldN = normalize( triWorldN - ( kUpT / kUL ) * kLedge * uStrata.w );
            }
          }`
    : '';
  const TRI_TINT = hasTriTint
    ? /* glsl */ `
          sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uTriWarm.rgb, clamp(  gBreak, 0.0, 1.0 ) * uTriWarm.a );
          sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uTriCool.rgb, clamp( -gBreak, 0.0, 1.0 ) * uTriWarm.a );`
    : '';

  // The middle band is three taps, so it is compiled in only where it is asked
  // for. Both extra bands deliberately skip the distance settle: settling the
  // form octave is what left the far cliff as flat tinted mush, because the only
  // thing surviving to 60 m was the band that carries no shape.
  const MID_BAND = hasMid
    ? /* glsl */ `
          tnX.xy += ( texture2D( normalMap, gTriX * dScale ).xy * 2.0 - 1.0 ) * uTriMid.y;
          tnY.xy += ( texture2D( normalMap, gTriY * dScale ).xy * 2.0 - 1.0 ) * uTriMid.y;
          tnZ.xy += ( texture2D( normalMap, gTriZ * dScale ).xy * 2.0 - 1.0 ) * uTriMid.y;`
    : '';

  const BORE_ALBEDO = hasBore
    ? /* glsl */ `
          sampledDiffuseColor.rgb *= 1.0 + ( gCrown * 0.17 - gFloorLine * 0.30 ) * uBore.x;`
    : '';

  /**
   * The macro albedo bands. See `albedoBands` for why the form had to stop being
   * a normal-map-only story.
   *
   * The reference is `textureLod( map, vec2( 0.5 ), 12.0 )` — the 1×1 mip, i.e.
   * the tile's own mean colour. Dividing the macro read by it turns a colour
   * *sample* into a colour *ratio* centred on 1.0, which is what lets the band be
   * applied multiplicatively without ever pushing the surface off its palette or
   * doubling its saturation. A straight `mix` toward the sample would do both.
   */
  const ALBEDO_BANDS = hasBands
    ? /* glsl */ `
          {
            vec3 kTileMean = textureLod( map, vec2( 0.5 ), 12.0 ).rgb + 1e-4;
            if ( uAlbBands.y > 0.0 ) {
              // second tiling at a non-integer multiple, cross-faded by the
              // low-frequency world band: no common period, so no visible repeat
              vec2 kBS = vec2( uAlbBands.z );
              vec3 kAlt = texture2D( map, gTriX * kBS ).rgb * gTriW.x
                        + texture2D( map, gTriY * kBS ).rgb * gTriW.y
                        + texture2D( map, gTriZ * kBS ).rgb * gTriW.z;
              sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, kAlt,
                smoothstep( -0.30, 0.42, gBreak2 ) * uAlbBands.y );
            }
            if ( uAlbBands.x > 0.0 ) {
              vec2 kMS = vec2( uTriMacro.x / uTriScale );
              vec3 kMac = texture2D( map, gTriX * kMS ).rgb * gTriW.x
                        + texture2D( map, gTriY * kMS ).rgb * gTriW.y
                        + texture2D( map, gTriZ * kMS ).rgb * gTriW.z;
              sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), kMac / kTileMean, uAlbBands.x );
            }
          }`
    : '';

  // Shadow floor. Flat and albedo-multiplied on purpose: the rock keeps its own
  // hue in shade instead of being washed toward the fill colour, and nothing in
  // the frame can reach zero.
  const BOUNCE = hasBounce
    ? /* glsl */ `
        #include <lights_fragment_end>
        reflectedLight.indirectDiffuse += uBounce.rgb * uBounce.a * material.diffuseColor;`
    : '';
  const BORE_ROUGH = hasBore
    ? /* glsl */ `
          roughnessFactor *= 1.0 + ( gCrown * 0.13 - gFloorLine * 0.36 ) * uBore.y;`
    : '';

  // CHAINED, NOT ASSIGNED — see the note above the cache key at the foot of
  // this function. This used to overwrite `onBeforeCompile` outright, which
  // silently deleted whatever injection ran before it.
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTriScale = uScale;
    shader.uniforms.uTriSharp = uSharp;
    shader.uniforms.uTriMacro = uMacro;
    shader.uniforms.uTriMid = uMid;
    shader.uniforms.uBore = uBore;
    shader.uniforms.uSettle = uSettle;
    shader.uniforms.uSettleD = uSettleD;
    shader.uniforms.uAlbBands = uAlbBands;
    shader.uniforms.uBounce = uBounce;
    shader.uniforms.uStrata = uStrata;
    shader.uniforms.uStrataDip = uStrataDip;
    shader.uniforms.uStrataTint = uStrataTint;
    shader.uniforms.uTriWarm = uTriWarm;
    shader.uniforms.uTriCool = uTriCool;
    shader.uniforms.uMacroTex = uMacroTex;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_PARS + '\nvarying vec3 vTriN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
          WORLD_VERTEX +
          /* glsl */ `
        vec3 kON = objectNormal;
        #ifdef USE_INSTANCING
          kON = mat3( instanceMatrix ) * kON;
        #endif
        vTriN = normalize( mat3( modelMatrix ) * kON );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          WORLD_PARS +
          WORLD_HASH +
          TRI_COMMON +
          '\nuniform vec3 uTriMacro;\nuniform vec3 uTriMid;\nuniform vec2 uBore;\nuniform vec2 uSettle;\n' +
          'uniform vec2 uSettleD;\nuniform vec4 uAlbBands;\nuniform vec4 uBounce;\n' +
          'uniform vec4 uStrata;\nuniform vec3 uStrataDip;\nuniform vec4 uStrataTint;\n' +
          'uniform vec4 uTriWarm;\nuniform vec3 uTriCool;\nuniform sampler2D uMacroTex;\n' +
          'float gBreak = 0.0;\nfloat gBreak2 = 0.0;\nfloat gSettle = 0.0;\nfloat gSettleD = 0.0;\nfloat gCavity = 1.0;\n' +
          'float gFace = 1.0;\nfloat gCrown = 0.0;\nfloat gFloorLine = 0.0;\n' +
          'float gBedF = 0.0;\nfloat gBedTone = 0.0;\nfloat gBedRough = 0.0;\n' +
          'float gBedPlane = 0.0;\nfloat gBedHard = 0.5;\n' +
          'vec3 gTriW = vec3( 0.0, 1.0, 0.0 );\n' +
          'vec2 gTriX = vec2( 0.0 );\nvec2 gTriY = vec2( 0.0 );\nvec2 gTriZ = vec2( 0.0 );\n',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        gTriW = triWeights();
        gTriX = vWorldP.zy * uTriScale;
        gTriY = vWorldP.xz * uTriScale;
        gTriZ = vWorldP.xy * uTriScale;
        gSettle = smoothstep( uSettle.x, uSettle.y, vViewDist );
        // The detail octave gets its own, much earlier ramp — see settleDetail.
        gSettleD = smoothstep( uSettleD.x, uSettleD.y, vViewDist );
        // 1 head-on, 0 edge-on. A detail octave held at full amplitude where the
        // surface runs away from the camera is the crawl on the tunnel wall: the
        // texel footprint is a long thin sliver the mip chain cannot represent.
        vec3 kTriN = normalize( vTriN );
        gFace = abs( dot( kTriN, normalize( cameraPosition - vWorldP ) ) );
        // Crown faces down, floor faces up. This is geometry, not noise, and it
        // is the only thing that can tell a bore's ceiling from its floor line.
        gCrown = smoothstep( 0.0, 0.7, -kTriN.y );
        gFloorLine = smoothstep( 0.0, 0.7, kTriN.y );
        gBreak = ( texture2D( uMacroTex, kWorldPlane( vWorldP, uTriMacro.z ) ).r - 0.5 ) * 2.0;
        // second world band at a deliberately non-integer fraction of the
        // first: this is the ~7-9 m decade, the one that makes a rock cut read
        // as having zones rather than as one tone with texture on it
        gBreak2 = ( texture2D( uMacroTex, kWorldPlane( vWorldP, uTriMacro.z * 0.29 ) + 0.41 ).r - 0.5 ) * 2.0;${STRATA_SETUP}
        #ifdef USE_MAP
          vec4 sampledDiffuseColor =
            texture2D( map, gTriX ) * gTriW.x + texture2D( map, gTriY ) * gTriW.y + texture2D( map, gTriZ ) * gTriW.z;
          sampledDiffuseColor = mix( sampledDiffuseColor, textureLod( map, gTriY, 5.5 ), gSettle * 0.65 );
          sampledDiffuseColor.a = 1.0;${ALBEDO_BANDS}
          sampledDiffuseColor.rgb *= 1.0 + gBreak * 0.34 + gBreak2 * 0.22;${TRI_TINT}${STRATA_ALBEDO}${BORE_ALBEDO}
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 triR = texture2D( roughnessMap, gTriX ) * gTriW.x + texture2D( roughnessMap, gTriY ) * gTriW.y +
                      texture2D( roughnessMap, gTriZ ) * gTriW.z;
          gCavity = triR.r;
          roughnessFactor *= triR.g * ( 1.0 + gBreak * 0.24 + gBreak2 * 0.16 );
          // damp collects low and in the shade: the floor line of a rock cut is
          // always darker and glossier than its crown, and that split is most of
          // what tells you the surface is stone and not carpet
          roughnessFactor *= 1.0 - ( 1.0 - gCavity ) * 0.30;${STRATA_ROUGH}${BORE_ROUGH}
          roughnessFactor = clamp( roughnessFactor, 0.04, 1.0 );
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec2 mScale = vec2( uTriMacro.x / uTriScale );
          vec2 dScale = vec2( uTriMid.x / uTriScale );
          // Detail octave. This is the ONLY band allowed to fade — with distance
          // and with grazing angle — because it is the only one small enough to
          // alias. Fading the form bands with it is what collapsed everything
          // past 25 m into flat tinted mush.
          // 0.72 left a quarter of the chip relief alive at any distance, which on
          // a face that runs to 200 m is a permanent carpet of sub-texel facets.
          // It goes to 0.92 on its own early ramp; the mid and macro bands below
          // are untouched and are what carries the face past the fade.
          float kDet = uTriMid.z * ( 1.0 - gSettleD * 0.92 ) * mix( 0.40, 1.0, smoothstep( 0.10, 0.46, gFace ) );
          vec3 tnX = texture2D( normalMap, gTriX ).xyz * 2.0 - 1.0;
          vec3 tnY = texture2D( normalMap, gTriY ).xyz * 2.0 - 1.0;
          vec3 tnZ = texture2D( normalMap, gTriZ ).xyz * 2.0 - 1.0;
          tnX.xy *= kDet; tnY.xy *= kDet; tnZ.xy *= kDet;${MID_BAND}
          // macro octave: the same map at a non-integer multiple of the scale,
          // supplying the metre-scale form the detail tile is too small to hold
          tnX.xy += ( texture2D( normalMap, gTriX * mScale ).xy * 2.0 - 1.0 ) * uTriMacro.y;
          tnY.xy += ( texture2D( normalMap, gTriY * mScale ).xy * 2.0 - 1.0 ) * uTriMacro.y;
          tnZ.xy += ( texture2D( normalMap, gTriZ * mScale ).xy * 2.0 - 1.0 ) * uTriMacro.y;
          vec2 nsc = normalScale;
          tnX.xy *= nsc; tnY.xy *= nsc; tnZ.xy *= nsc;
          vec3 gN = normalize( vTriN );
          // whiteout blend: add the geometric normal in, keep z positive, reswizzle per axis
          tnX = vec3( tnX.xy + gN.zy, abs( tnX.z ) * gN.x );
          tnY = vec3( tnY.xy + gN.xz, abs( tnY.z ) * gN.y );
          tnZ = vec3( tnZ.xy + gN.xy, abs( tnZ.z ) * gN.z );
          vec3 triWorldN = normalize( tnX.zyx * gTriW.x + tnY.xzy * gTriW.y + tnZ.xyz * gTriW.z );${STRATA_NORMAL}
          normal = normalize( ( viewMatrix * vec4( triWorldN, 0.0 ) ).xyz );
        #endif
        {
          // Specular antialiasing on the assembled normal. Three's own
          // geometryRoughness only measures the *unperturbed* normal, so a
          // triplanar surface — where four normal-map bands and a strata term
          // are summed per pixel — is invisible to it. Nine taps of relief on a
          // rock face 200 m away is nine taps of sub-pixel facet; measuring the
          // per-pixel spread of the result and widening the lobe by it is the
          // difference between a distant headland and a crawling dither.
          vec3 kTriDxy = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
          roughnessFactor = min(
            roughnessFactor + min( max( max( kTriDxy.x, kTriDxy.y ), kTriDxy.z ) * 1.6, 0.40 ), 1.0 );
        }`,
      );

    if (hasBounce) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', BOUNCE);
    }
  };
  // CHAINED, NOT ASSIGNED.
  //
  // A survey of the games' materials named this function among four places
  // where `customProgramCacheKey` was overwritten instead of chained, and spelt
  // out the consequence: **two materially different programs sharing one
  // compiled shader** — one team's surface rendering with another team's
  // shader, which no test would catch, because both
  // materials render and neither logs anything.
  //
  // It was worse here than at the other three, because the hook was assigned
  // too: an injection installed before this one had its GLSL deleted outright
  // and its key overwritten, so the material lost a term AND lost the only
  // record that it ever had one.
  //
  // The `!== THREE.Material.prototype.customProgramCacheKey` test is what makes
  // the chained form produce the IDENTICAL string on a material that carries
  // nothing else — which is both of today's callers, so this fix changes no
  // emitted byte and no key in either game. It is the NEXT caller it is for.
  const key =
    `tri3${o.worldScale}_${o.sharpness}_${o.macro}_${o.macroRelief}_${o.period}` +
    `_${o.mid ?? 'x'}_${o.midRelief ?? 0}_${o.detailRelief ?? 1}_${bore.join(',')}` +
    `_${o.settle ? o.settle.join(',') : 'x'}_${settleD.join(',')}_${bands.join(',')}` +
    `_${hasBounce ? o.bounce!.join(',') : 'x'}` +
    `_${hasStrata ? st!.thickness : 'x'}_${hasTriTint ? 1 : 0}_saa1`;
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
