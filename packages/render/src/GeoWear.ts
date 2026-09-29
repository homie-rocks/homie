/**
 * ============================================================================
 *  GeoWear.ts — surface history read off the GEOMETRY, for a material this
 *  package did not build.
 * ============================================================================
 *
 * Oxide in the concave junctions, coating gone from the convex breaks, rime on
 * the faces a fixed key never reaches, and a per-cell age so two runs of the
 * same material are not the same age. Every term comes off the geometry: it
 * works on a material with **no map, no normal map and no UVs at all**, which
 * is what makes it the one injection that can give history to surfaces some
 * other module generated.
 *
 * ## Provenance, and why the prose below still argues from one game
 *
 * This arrived from a space racer's material code and its comments still argue
 * from that game's art direction — the fixed +6.5° key, the planet's shadow
 * cone, the deck, the derelict. **That reasoning is kept on purpose.** It is
 * the WHY behind every constant here, this codebase has already paid once for
 * deleting a guard whose comment merely looked wrong, and a worked example
 * beats a generic restatement of it. Read "the art direction" in those
 * paragraphs as "the caller that commissioned this term".
 *
 * What is general is the mechanism, and all of it is: the caller supplies every
 * number through `GeoWearOpts`, and the defaults are defaults rather than a
 * house style. A venue with a moving sun calls `setKeyDirection` every frame; a
 * venue with a fixed one calls it once. Nothing here knows what a lap is.
 *
 * ## Two things that will bite the second caller
 *
 *  · **`setKeyDirection` is MODULE-WIDE.** One `_geoKey` uniform object is
 *    shared by every material this file has ever touched, which is exactly what
 *    makes publishing the key one write per frame instead of N. Two scenes
 *    wanting two different key directions in one process cannot both have one.
 *  · **DO NOT PUT THIS ON A MOVING OBJECT.** Terms 1 and 3 are functions of
 *    world orientation and world position. The note above `GeoWearOpts` says
 *    what that costs and where the alternative lives.
 *
 * Depends on `WORLD_HASH` and `tintMul` from `MaterialChunks.js`, and on
 * nothing else in this package.
 */
import * as THREE from 'three';
import { WORLD_HASH, tintMul } from './MaterialChunks.js';

/* ===========================================================================
 *  SURFACE HISTORY AT THE SCALE OF THE GEOMETRY, NOT OF THE TILE.
 * ===========================================================================
 *  The art direction asks for oxidation, primer and frost "placed by cavity/
 *  curvature/exposure terms, not by noise". Every tile generator already does
 *  that — `placement()` runs `cavityField` / `curvatureField` / `exposureField`
 *  over the tile's own height field and the masks are correct. And it is still
 *  not what a reviewer is looking at, because those three fields describe a
 *  26-texel bump on a 3.6 m tile. They know nothing whatsoever about the
 *  OBJECT:
 *
 *    · that this fragment is on the inside of a welded truss junction, where a
 *      century of the bay's shed material has collected;
 *    · that this one is on the leading break of a barrier that every rig on the
 *      span has scraped past;
 *    · that this one is on the underside of a gantry that the key light has not
 *      touched since the ring was laid.
 *
 *  That is the missing octave, and it is the one the eye reads as *history*
 *  rather than as texture. It cannot be baked, because it is a property of the
 *  mesh and of where the mesh is standing, so it has to be evaluated per
 *  fragment from the geometry the rasteriser is already handing us.
 *
 *  FOUR TERMS, ALL GEOMETRIC, NONE OF THEM NOISE:
 *
 *  1. EXPOSURE — and this is the one nothing else in the medium has. The art
 *     direction fixes the star at +6.5° and it NEVER MOVES; the eclipse comes
 *     from the deck entering the planet's shadow cone, not from the key
 *     travelling. So on any static surface, `dot( N, keyDir ) < 0` is not
 *     "unlit right now", it is **unlit for the life of the structure**. Ammonia
 *     rime condenses there and nowhere else, and that mask is a closed-form
 *     constant of the shape. A venue with a moving sun cannot compute this at
 *     all.
 *
 *     Note what it is NOT: it does not add light and it does not lift a shadow.
 *     It changes the ALBEDO and the ROUGHNESS of faces that are receiving the
 *     planet fill and nothing else, so the shadow side stops being one value of
 *     black and starts being a material — while its absolute luminance stays in
 *     the 0.010–0.024 shadow band. Raising the ambient to get the same read is
 *     an automatic fail; this is the honest half of the same result.
 *
 *  2. CURVATURE, in units of 1/m, measured from the *unperturbed* normal. Sign
 *     separates the two things wear does: coatings abrade off convex breaks
 *     (chamfers, tube crowns, plate edges) and grime/oxide collects in concave
 *     ones (fillets, lap joints, the lee of a stiffener). Taking it from the
 *     geometric normal rather than the shaded one is deliberate — the mapped
 *     normal's own millimetre relief is already handled by `placement()` inside
 *     the tile, and double-counting it here would put wear back on a noise
 *     field, which is the exact failure this block exists to leave behind.
 *
 *  3. AGE, from two decorrelated world-space cell fields in running bond. The
 *     art direction wants "at least one panel visibly a different age than its
 *     neighbours", and without a world signal every truss bay on the ring ages
 *     identically because it has identical shape. The cells modulate how much
 *     oxide and how much primer a given run of plate has taken, so a refitted
 *     bay reads as newer than the two either side of it and a couple of plates
 *     inside it read as newer than the refit.
 *
 *  4. POLISH along the racing line, off the mesh's own vertex-colour darkening —
 *     the same channel `BreakupOpts.wearGloss` reads. Set `polish: 0` on any
 *     material that already carries `wearGloss` or the two stack.
 *
 *  WHY IT TOUCHES ONLY THE FRAGMENT SHADER, AND ONLY ONE ANCHOR. The world
 *  frame is RECONSTRUCTED rather than carried on a varying:
 *
 *      wN  = normalize( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz
 *      wP  = cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz
 *
 *  Both are exact for a rigid view matrix (three's own
 *  `transformNormalByInverseViewMatrix` is the first identity), both use only
 *  built-in uniforms and a varying every physical material already has, and
 *  neither needs `USE_INSTANCING` handling. That matters more than the handful
 *  of ALU it saves: this injection has to land on materials THIS FILE DID NOT
 *  BUILD, whose vertex shaders may already have been rewritten by somebody
 *  else, and the fewer anchors it competes for the fewer ways it has to become
 *  a silent no-op. `<lights_physical_fragment>` is the one point where
 *  `diffuseColor`, `roughnessFactor`, `metalnessFactor` and `nonPerturbedNormal`
 *  are all live and none of them has been consumed — the same anchor
 *  `addSpecularAA` uses, and it is preserved rather than replaced, so any number
 *  of injections can chain on it.
 *
 *  COST: four vec3 derivatives, two hashes and about sixty ALU. NO TEXTURE
 *  FETCH — this lands on the deck and on the structure, which between them are
 *  most of the pixels in most frames, and a fill budget has no spare tap on
 *  that many.
 *
 *  DO NOT PUT THIS ON A MOVING OBJECT. Terms 1 and 3 are functions of world
 *  orientation and world position, which is exactly right for a deck bolted to
 *  a ring and exactly wrong for a hull: frost would swim across a ship as it
 *  yawed. The ships get their history baked into their liveries, where it
 *  belongs.
 * =========================================================================== */

export interface GeoWearOpts {
  /** how much oxide the concave junctions take, 0..1 */
  oxide?: number;
  /** how much of the coating is gone from the convex breaks, 0..1 */
  worn?: number;
  /** how much rime the permanently-unlit faces carry, 0..1 */
  rime?: number;
  /** how hard a vertex-colour darkening also polishes, 0..1 (0 = off) */
  polish?: number;
  /**
   * Curvature knees, in 1/m of MEAN curvature — the average of the two
   * principal curvatures, which is what a screen-space derivative pair
   * measures. Read the convention before touching the numbers, because it is
   * the difference between a knee that means something and a knee that was
   * guessed: a SPHERE of radius R measures 1/R, but a CYLINDER of radius R
   * measures 1/2R, since one of its two principal curvatures is zero.
   *
   * Measured on the shipped shader, against the members the circuit it was
   * built for is actually made of:
   *
   *     deck plate, any hull panel .................  0      — never wears
   *     0.90 m truss chord ......................... 1.1     — under the knee
   *     0.34 m truss diagonal ...................... 2.9
   *     60 mm dressed chamfer ...................... 8.3
   *     42 mm handrail tube ....................... 23.8     — saturates
   *     weld toe / bolt recess, r ~ 5 mm .......... 100+     — saturates
   *
   * The default `[2.2, 16]` therefore means: hard breaks, small sections and
   * fastener-scale relief lose their coating, and large smooth forms do not.
   * That is the physically honest answer and it is deliberately NOT generous —
   * a term that wore the barrel of every chord would be back to sprinkling.
   * Large forms get their history from `rime` and `ageTint`, which do not care
   * about curvature at all.
   */
  curve?: [number, number];
  /**
   * How hard the per-cell age drives albedo and roughness ON ITS OWN, with no
   * curvature gate. Defaults `[0.06, 0.09]`.
   *
   * This is not a nicety, it is the arm that makes the term work on the surface
   * the finding is about. Oxide and primer are both curvature-gated, so on a
   * genuinely flat plate — which is most of the deck and most of a clad bay —
   * every state above evaluates to zero and the age field has nothing to
   * modulate. The art direction asks for "at least one panel visibly a
   * different age than its neighbours", and on flat plate this is the only
   * thing that can deliver it. Value and gloss only, deliberately no cut line:
   * the deck already has three panelisation frequencies and a fourth would be
   * the wallpaper the art direction fails a frame for.
   *
   * Keep it near the default on anything that already carries
   * `BreakupOpts.worldCells` — that is the same idea sampled from a texture,
   * and the two compound.
   */
  ageStep?: [number, number];
  /**
   * `[oxide, rime, primer]` roughness ADDED, then bare metal's proportional
   * reduction. The fourth is a fraction, not an offset — see the note in the
   * shader for why nothing here is allowed to subtract. Negative works and
   * means the exposed substrate is rougher than its coating was, which is what
   * dry carbon tow is.
   */
  rough?: [number, number, number, number];
  /** metalness the exposed bare metal returns to */
  metal?: number;
  /** metres per course of the two age fields. Defaults `[23, 6.4]`. */
  age?: [number, number];
  /**
   * Hue of the three modulating states, and the VALUE each one carries.
   *
   * The tints are read hue-only (`tintMul(hex, true)`), so they shift the
   * surface warm or cool without adding or removing energy, and the gain is
   * what makes primer lighter than the plate under it and oxide slightly
   * darker. Two numbers rather than one because a hex multiplier can only ever
   * darken, and "the coating has come off and there is primer under it" is
   * mostly a VALUE step — the art direction puts the deck skin at `#565c63`
   * (luma 0.36) and the primer at `#8a8f84` (0.55), which no multiplier can
   * reach.
   */
  oxideTint?: number;
  oxideGain?: number;
  primerTint?: number;
  primerGain?: number;
  bareTint?: number;
  bareGain?: number;
  /** rime is a DEPOSIT and replaces rather than multiplies — this is its colour */
  rimeTint?: number;
  /**
   * THE CHAMFER HIGHLIGHT, as `[strength, gloss]`. Both 0 = off.
   *
   * The art direction calls an unbroken 90° arris "the loudest amateur tell
   * available" and checks for a specular line on every chamfer in frame; a
   * review found none anywhere in 44 frames, and a close-up resolved individual
   * gantry members as rectangular prisms with hard arrises. The geometric
   * answer is an 8–25 mm bevel on the profile generators, which belongs to the
   * game's scenery code and is a triangle budget question on a thousand truss
   * instances.
   *
   * This is the shading half, and it is the half that can be world-width-
   * correct for free — which that review explicitly asked for and a uniform
   * bevel texture cannot deliver. `kCvx` is MEAN CURVATURE IN 1/m measured off
   * the pixel footprint, so its top decade is the arris and only the arris,
   * whatever section it is on: the band it fires over is a fixed number of
   * millimetres of world on a 0.34 m diagonal and on a 0.90 m chord alike,
   * because a tighter break simply reads higher. See the table on `curve`.
   *
   * What it does is what a dressed break physically is: a burnished strip.
   * Roughness drops (the pass that cut it also polished it), metalness comes up
   * toward bare, and the albedo lifts slightly. It adds no light — under a key
   * that misses the break entirely it is invisible, which is the difference
   * between this and the unattenuated rim term the art direction fails a frame
   * for.
   *
   * NOT ON THE DECK. A deck plate's arrises are its seams, they are concave,
   * and "the deck never blooms" is a harder constraint than the chamfer clause.
   * The rows that carry it are the ones made of sections.
   */
  chamfer?: [number, number];
}

/** Materials already carrying the geometric wear term — see `injectGeoWear`. */
const _geoWorn = new WeakSet<THREE.Material>();

/**
 * The key direction, in world space, shared by every material that asks for it.
 *
 * One uniform object rather than one per material, for the same reason `_lineA`
 * is: it is a property of the venue, not of the surface. In the game this came
 * from, the default is the star direction as authored and the sky rotates that
 * vector in place when a track is bound, so the material update re-copies the
 * sun direction every frame rather than snapshotting it at build time. Copying
 * it per frame is also what keeps the mask from lagging: a rime mask computed
 * against a stale key would swim by a few degrees whenever the sky was
 * re-aimed, and a wear mask that moves is worse than no wear mask at all.
 */
const _geoKey = { value: new THREE.Vector3(-0.9412, 0.1132, -0.3181).normalize() };

/** Publish the world-space key direction to every geometric-wear material. */
export function setKeyDirection(dir: THREE.Vector3): void {
  _geoKey.value.copy(dir).normalize();
}

function injectGeoWear(mat: THREE.Material, o: GeoWearOpts = {}): void {
  /*
   * IDEMPOTENT, WITH A BELT AND BRACES, AND THE BRACES ARE THE OPPOSITE CHOICE
   * FROM `injectLineLight`'s — on purpose.
   *
   * That one deliberately leaves its uniform block UNguarded so that a double
   * application fails to link rather than silently doubling the light, because
   * a doubled light breaks the bloom threshold in a way review cannot see.
   * The trade here runs the other way: doubled wear is a visible tuning error
   * that any reviewer will name, whereas a failed link on this material set
   * takes the deck and the whole structure to black. So the WeakSet is the real
   * guard (and `variant()` carries membership across a clone, which is the half
   * that was missing once and cost real time), and the `#ifndef` behind it
   * degrades a missed carry to twice the wear instead of no frame.
   */
  if (_geoWorn.has(mat)) return;
  _geoWorn.add(mat);

  const curve = o.curve ?? [2.2, 16];
  const rough = o.rough ?? [0.30, 0.26, 0.16, 0.10];
  const age = o.age ?? [23, 6.4];
  const uGeoWear = {
    value: new THREE.Vector4(o.oxide ?? 0.55, o.worn ?? 0.5, o.rime ?? 0.45, o.polish ?? 0),
  };
  const uGeoWearB = {
    // z/w are the footprint knee: `sqrt(pixel area) / view distance`, i.e. the
    // ANGULAR size of a pixel's slice of the surface. A facing fragment sits
    // near 0.001 at 1080p; a quad straddling a silhouette, or a surface past
    // about 88° of grazing, blows up toward 1 and the curvature it measures is
    // the difference between two unrelated surfaces rather than a curvature at
    // all. Without this the term draws a one-pixel worn rim around every
    // silhouette in the frame, which is an outline, and an outline is the most
    // expensive kind of amateur tell there is.
    value: new THREE.Vector4(curve[0], curve[1], 0.028, 0.085),
  };
  const ageStep = o.ageStep ?? [0.06, 0.09];
  const uGeoWearC = { value: new THREE.Vector4(age[0], age[1], ageStep[0], ageStep[1]) };
  const uGeoRough = { value: new THREE.Vector4(rough[0], rough[1], rough[2], rough[3]) };
  // See `GeoWearOpts.chamfer`. Zero is off and costs the same two multiplies as
  // any other value — the block is deliberately branch-free and uniform-driven
  // so every material carrying it shares one compiled program.
  const cham = o.chamfer ?? [0, 0];
  const uGeoCham = { value: new THREE.Vector2(cham[0], cham[1]) };
  const uGeoMetal = { value: o.metal ?? 0.35 };
  // rgb = hue-only multiplier, a = value gain. See `oxideTint` for why both.
  const wear4 = (hex: number, gain: number) => {
    const t = tintMul(hex, true);
    return { value: new THREE.Vector4(t.x, t.y, t.z, gain) };
  };
  // The art direction makes oxide "the ONLY warm albedo in the environment"
  // and it is not a saturated hue — this is a low-chroma ochre, not the amber
  // reserved for one job. A saturated rust would spend the colour law on scenery.
  const uGeoOxide = wear4(o.oxideTint ?? 0xffc59a, o.oxideGain ?? -0.12);
  const uGeoPrimer = wear4(o.primerTint ?? 0xf2f6e6, o.primerGain ?? 0.42);
  const uGeoBare = wear4(o.bareTint ?? 0xdeeaf7, o.bareGain ?? 0.20);
  // ...and this one IS a colour, because rime covers rather than tints. Linear,
  // and deliberately modest: it lands on faces lit by the planet fill alone.
  const rimeC = new THREE.Color(o.rimeTint ?? 0xb8c6cc).convertSRGBToLinear();
  const uGeoRime = { value: new THREE.Vector3(rimeC.r, rimeC.g, rimeC.b) };

  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uGeoKey = _geoKey;
    shader.uniforms.uGeoWear = uGeoWear;
    shader.uniforms.uGeoWearB = uGeoWearB;
    shader.uniforms.uGeoWearC = uGeoWearC;
    shader.uniforms.uGeoRough = uGeoRough;
    shader.uniforms.uGeoCham = uGeoCham;
    shader.uniforms.uGeoMetal = uGeoMetal;
    shader.uniforms.uGeoOxide = uGeoOxide;
    shader.uniforms.uGeoPrimer = uGeoPrimer;
    shader.uniforms.uGeoBare = uGeoBare;
    shader.uniforms.uGeoRime = uGeoRime;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' + WORLD_HASH + /* glsl */ `
        #ifndef K_GEOWEAR_PARS
        #define K_GEOWEAR_PARS
        uniform vec3 uGeoKey;
        uniform vec4 uGeoWear;
        uniform vec4 uGeoWearB;
        uniform vec4 uGeoWearC;
        uniform vec4 uGeoRough;
        uniform vec2 uGeoCham;
        uniform float uGeoMetal;
        uniform vec4 uGeoOxide;
        uniform vec4 uGeoPrimer;
        uniform vec4 uGeoBare;
        uniform vec3 uGeoRime;
        // One course of a running-bond cell field, hashed to a 0..1 age. Each
        // course gets its own X phase AND its own cell width, because a square
        // lattice is §9.8's automatic fail one scale up and a fabricator does
        // not work to one anyway: standard course height, lengths cut to suit.
        float kAgeCell( vec3 wp, float period, float salt ) {
          vec2 p = ( wp.xz + wp.y * 0.71 ) / period;
          float row = floor( p.y );
          vec3 rh = kHash3( vec3( row, salt, 0.7 ) );
          p.x = ( p.x + rh.x * 3.0 ) * ( 0.7 + rh.y * 0.9 );
          return kHash3( vec3( floor( p.x ), row, salt + 2.3 ) ).z;
        }
        #endif
        `,
      )
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        {
          // ---- the world frame, reconstructed. Exact for a rigid view matrix.
          vec3 kGN = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz );
          vec3 kWP = cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz;

          // ---- 1. EXPOSURE. The star is fixed, so this face is either lit at
          //         some point in the lap or it is never lit at all. The ramp
          //         straddles zero rather than starting at it: a face within a
          //         few degrees of the terminator gets grazing light that
          //         sublimes the deposit off, which is why rime has an edge.
          float kNight = smoothstep( 0.09, -0.24, dot( kGN, uGeoKey ) );

          // ---- 2. CURVATURE, in 1/m, from the UNPERTURBED normal ------------
          float kCvx = 0.0;
          float kCav = 0.0;
          #ifndef FLAT_SHADED
          {
            // vViewPosition is the NEGATED view-space position, so the position
            // derivatives carry a sign the normal derivatives do not.
            vec3 kPx = -dFdx( vViewPosition );
            vec3 kPy = -dFdy( vViewPosition );
            float kFoot = dot( kPx, kPx ) + dot( kPy, kPy );
            // dN.dP / |dP|^2 is the MEAN curvature in world units: a sphere
            // of radius R evaluates to 1/R and a cylinder to 1/2R, because one
            // of a cylinder's two principal curvatures is zero. See the table
            // on GeoWearOpts.curve for what every member on this circuit
            // measures — the knees are only interpretable against it.
            //
            // Both sides scale with the pixel footprint, so the measure is
            // INDEPENDENT of range and of resolution: a 42 mm tube reads 23.8
            // at 4 m and 23.8 at 40 m, and only stops reading it once the pixel
            // genuinely stops resolving the tube. That is exactly where the
            // wear should go, and it is why this needs no LOD ramp of its own.
            // Measured: the tube fires at 3 m and is gone by 60 m.
            float kH = ( dot( dFdx( nonPerturbedNormal ), kPx )
                       + dot( dFdy( nonPerturbedNormal ), kPy ) ) / max( kFoot, 1e-9 );
            float kTrust = 1.0 - smoothstep( uGeoWearB.z, uGeoWearB.w,
              sqrt( kFoot ) / max( length( vViewPosition ), 1.0 ) );
            kCvx = smoothstep( uGeoWearB.x, uGeoWearB.y,  kH ) * kTrust;
            kCav = smoothstep( uGeoWearB.x, uGeoWearB.y, -kH ) * kTrust;
          }
          #endif

          // ---- 3. AGE. Two courses at a deliberately non-integer ratio, so a
          //         refitted bay and the fresher plates inside it are two
          //         separate reads rather than one checkerboard.
          float kAge = clamp( kAgeCell( kWP, uGeoWearC.x, 5.1 ) * 0.62
                            + kAgeCell( kWP, uGeoWearC.y, 1.9 ) * 0.38, 0.0, 1.0 );

          // ---- the four states ---------------------------------------------
          // Oxide needs somewhere for the electrolyte to stand, so it is the
          // concave term, and an old run of plate has had longer to grow it.
          float kOx   = clamp( kCav * ( 0.34 + 0.66 * kAge ) * uGeoWear.x, 0.0, 1.0 );
          // The coating goes off the breaks first. A newer cell is through to
          // primer; an older one is through the primer to metal. One term, two
          // states, and which one you get is the panel's own history.
          float kWorn = kCvx * uGeoWear.y;
          float kPri  = clamp( kWorn * ( 0.35 + 0.65 * ( 1.0 - kAge ) ), 0.0, 1.0 );
          float kBare = clamp( kWorn * smoothstep( 0.45, 0.95, kCvx ) * ( 0.30 + 0.70 * kAge ), 0.0, 1.0 );
          // Rime survives where the star never lands AND the surface is
          // sheltered enough not to be scoured — an exposed permanently-dark
          // face is swept, a permanently-dark recess is not.
          float kRime = clamp( kNight * ( 0.40 + 0.60 * kCav ) * uGeoWear.z, 0.0, 1.0 );

          // Hue from the multiplier, value from the gain. A hex multiplier can
          // only darken, and primer over a dark plate is a step UP in value —
          // that step is most of what makes an abraded edge read as abraded
          // rather than as a dirty edge.
          diffuseColor.rgb *= mix( vec3( 1.0 ), uGeoOxide.rgb, kOx ) * ( 1.0 + uGeoOxide.a * kOx );
          diffuseColor.rgb *= mix( vec3( 1.0 ), uGeoPrimer.rgb, kPri ) * ( 1.0 + uGeoPrimer.a * kPri );
          diffuseColor.rgb *= mix( vec3( 1.0 ), uGeoBare.rgb, kBare ) * ( 1.0 + uGeoBare.a * kBare );
          // Rime REPLACES the substrate — it is a deposit, not a stain — but it
          // carries some of the substrate's own luminance through, so a frosted
          // steel plate stays darker than a frosted ceramic panel beside it.
          // Without that, frost is a decal and every surface it lands on
          // converges to one value, which is the flat-grey read this whole
          // block exists to break.
          float kLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, uGeoRime * ( 0.55 + kLum * 1.6 ), kRime );

          // ...and the age on its own, with NO curvature gate. On a flat plate
          // every state above is identically zero — measured, not assumed — so
          // without this the surface the finding is actually about ("large
          // surfaces are flat value with no history") would come out of this
          // block unchanged. One run of plate is a different age from the run
          // beside it, and on flat stock that is the entire visible difference.
          float kAgeStep = ( kAge - 0.5 ) * 2.0;
          diffuseColor.rgb *= 1.0 + kAgeStep * uGeoWearC.z;

          // Each state carries its own SPECULAR response, which is the half
          // that makes it a material rather than a tint. Oxide is a ceramic and
          // matte, rime is a frozen powder and matte, primer is flat, and bare
          // metal has been burnished by whatever took the coating off it.
          //
          // THE BARE-METAL TERM IS MULTIPLICATIVE AND THE OTHER THREE ARE NOT,
          // and that asymmetry is load-bearing. This block runs at the
          // lights_physical_fragment anchor, which is AFTER injectBreakup has
          // applied uRoughFloor — so anything that SUBTRACTS here escapes the
          // floor the material authored for itself. deck-race-line floors at
          // 0.16 and an absolute -0.18 would take the polished racing line, the
          // one surface in the game where every gloss term already pulls the
          // same way, straight to a mirror. See the long note on
          // BreakupOpts.roughFloor for what that costs under a 6.5 deg key.
          // A proportional term cannot cross zero however many states stack.
          roughnessFactor = clamp(
            ( roughnessFactor + kOx * uGeoRough.x + kRime * uGeoRough.y + kPri * uGeoRough.z )
            * ( 1.0 - kBare * uGeoRough.w )
            * ( 1.0 + kAgeStep * uGeoWearC.w ),
            0.04, 1.0 );
          // ...and its own metalness. A rusted patch that still reflects like
          // polished steel is the single fastest way to make wear read as a
          // decal: iron oxide and ammonia ice are both dielectrics.
          metalnessFactor = clamp(
            metalnessFactor * ( 1.0 - kOx * 0.85 ) * ( 1.0 - kRime * 0.80 ) + kBare * uGeoMetal,
            0.0, 1.0 );

          // ---- 5. THE CHAMFER. §12/C3 and §9.6; see GeoWearOpts.chamfer.
          //
          // The TOP DECADE of kCvx and nothing else. kCvx is already the
          // curvature knees' output, so this is the break itself: on the
          // sections this circuit is made of, everything from the 60 mm dressed
          // chamfer up (8.3 in 1/m) and nothing from the 0.34 m diagonal down
          // (2.9). That is what makes the band world-width-correct per member
          // for free — a tighter break reads higher, so the strip it fires over
          // is the same few millimetres of world on a chord and on a diagonal.
          //
          // A burnished strip, not a rim light: roughness down, metalness up
          // toward bare, albedo up a little. Everything it does is a change to
          // the MATERIAL, so a break the key misses stays dark and a break the
          // key rakes returns a line. An additive term here would be §12/C6's
          // named counter-example — "an emissive strip drawn ON TOP OF the
          // world instead of being a light IN it" — one scale down.
          //
          // Proportional with its own floor, for the same reason the bare-metal
          // term above is: this runs after injectBreakup has applied
          // uRoughFloor, so anything that subtracts escapes the floor the
          // material authored, and a chamfer that reaches 0 roughness under a
          // 0.18° source is a pinpoint over §5.3's threshold.
          float kCham = smoothstep( 0.62, 1.0, kCvx ) * uGeoCham.x;
          roughnessFactor = max( roughnessFactor * ( 1.0 - kCham * uGeoCham.y ), 0.06 );
          metalnessFactor = min( 1.0, metalnessFactor + kCham * 0.20 );
          diffuseColor.rgb *= 1.0 + kCham * 0.22;

          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            // 4. The racing line. The track owns it as a vertex-colour
            //    darkening and can only multiply albedo with it, which at
            //    exposure 1.05 is invisible; the same mask taken to roughness
            //    under a 6.5° key is a sheen you cannot miss. Same channel as
            //    BreakupOpts.wearGloss — set polish to 0 where that is present
            //    or the two stack.
            float kPol = clamp( 1.0 - dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );
            roughnessFactor *= 1.0 - clamp( kPol * uGeoWear.w, 0.0, 0.5 );
          #endif
        }
        #include <lights_physical_fragment>`,
      );
  };

  /*
   * A CONSTANT, AND THAT IS NOT AN OVERSIGHT. Nothing in this block is
   * conditionally compiled — every knob above is a uniform — so two materials
   * carrying it differ only in uniform VALUES and can and should share one
   * compiled program. What the key has to separate is a material that carries
   * the term from one that does not, which one token does. Folding the tuning
   * numbers in as well (which is what `injectBreakup`'s key does, correctly,
   * because its options genuinely change the source) would mint a program per
   * material for no behavioural difference and pay for it in boot-time compiles
   * on the largest material set in the game.
   */
  const key = 'geow1';
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * Geometric surface history, for a material this library did not build.
 *
 * ===========================================================================
 *  THE SAME HAND-OFF `addLineLight` AND `addSpecularAA` ARE ALREADY WAITING ON,
 *  AND FOR THE SAME REASON: ALMOST NOTHING A MATERIAL MODULE BUILDS IS ON SCREEN.
 * ===========================================================================
 *  In the game this came from, the prop module's material library routed
 *  exactly one name through the material module — `hull-plate`, twice, as
 *  `steel` and `steelInst`. Everything else a reviewer was looking at
 *  (`plate`, `plateRace`, `grip`, `grating`, `railSteel`, `clad`, `cladShell`,
 *  `ceramic`, `thermal`, `hazard`, `stencil`, `farShell`) was generated by the
 *  prop module's own texture library, and the finding against it was the art
 *  direction's history clause verbatim: flat value, no history, several props
 *  reading as untextured mid-grey.
 *
 *  This is the one injection that can fix that WITHOUT a texture swap, because
 *  it needs nothing from the texture set. It works on a material with no map,
 *  no normal map and no UVs at all — every term it uses comes off the
 *  geometry. One line per surface:
 *
 *      import { addSurfaceHistory } from '@homie-rocks/render/GeoWear.js';
 *      for (const m of [ clad, cladShell, ceramic ]) addSurfaceHistory(m);
 *
 *  Idempotent, so calling it on something the sweep already reached is a no-op.
 *  Do not call it on anything that MOVES — see the note above `GeoWearOpts`.
 *
 *  In that game a sweep installed it over the track group, which reached the
 *  deck, the barriers, the island, the bores and the handrails but not the
 *  scenery, the cranes, the spine or the derelict's cladding. Those were the
 *  props the finding named, and they were one call away.
 */
export function addSurfaceHistory(mat: THREE.Material, o: GeoWearOpts = {}): void {
  injectGeoWear(mat, o);
}

/**
 * The same function under its other name, exported rather than re-wrapped.
 *
 * `injectGeoWear` and `addSurfaceHistory` ARE ONE FUNCTION and always were —
 * the second is a one-line call to the first. They are two names because they
 * address two different readers, and that distinction is documented above each
 * of them: `injectGeoWear` is what a material library calls on something IT
 * built and has a tuning row for; `addSurfaceHistory` is what a module that
 * owns geometry calls on a material this library never saw.
 *
 * Kept as two names, rather than collapsed on the way past, so that both call
 * sites in the game that commissioned this term stayed byte-identical through
 * the extraction. Collapsing them is a readability change and belongs in a
 * commit that is about readability.
 */
export { injectGeoWear };

/**
 * This term's idempotence register, exported BY IDENTITY.
 *
 * ===========================================================================
 *  A LIBRARY THAT CLONES ITS MATERIALS HAS TO INHERIT THIS, OR THE CLONE
 *  RE-ENTERS AN INJECTION ITS ORIGINAL ALREADY CARRIES.
 * ===========================================================================
 * `injectGeoWear` guards itself with a WeakSet so calling it twice on one
 * material is a no-op. That guard is keyed on the material OBJECT, so a variant
 * clone — a recoloured copy of an already-injected material — is a different
 * object, is not in the set, and takes the whole term a second time: the oxide,
 * the primer, the rime and the chamfer all applied twice, on the one material
 * in the frame that was supposed to look like its neighbour in a different
 * colour.
 *
 * `MatLibShape.claims` in `MaterialLib.ts` is how a library hands its cloner the
 * registers to copy across, and it compares by identity, so it needs THIS
 * WeakSet and not an equivalent one. That is the whole reason this is exported
 * rather than kept private: a second copy of the set is the same bug wearing a
 * different name.
 *
 * Found by the typecheck rather than by the parity probe, and worth saying so —
 * the parity probe drives freshly-constructed materials and would have stayed
 * green through a change that dropped this.
 */
export { _geoWorn as geoWearClaim };
