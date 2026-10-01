/**
 * ============================================================================
 *  LineLight.ts — analytic LINE lights: two closed-form segments, no loop over
 *  a light list, no shadow map, and no recompile when they move.
 * ============================================================================
 *
 * three.js has point lights, spot lights and directional lights. It has no
 * light shaped like a STRIP, and a strip is what a lit edge in a scene actually
 * is — a mag-strip down a deck, a cove light along a ceiling, the underside of a
 * handrail, a runway edge. Faking one with a row of point lights costs a light
 * per metre and still reads as beads; faking it with an emissive material draws
 * a bright line that lights nothing at all beside it.
 *
 * This is the closed form instead: the nearest point on a segment for the
 * diffuse term, and a reflection-ray-against-segment solve for a specular
 * highlight that STRETCHES along the strip the way a real one does. Two
 * segments, fixed at two, because two is the number a shader can carry without a
 * variable-length loop — and a variable-length loop is a recompile every time
 * the count changes.
 *
 * ## The caller drives it, and that hand-off is the part that goes wrong
 *
 * `setLineLights(a0, b0, a1, b1)` publishes the two segments' endpoints, in
 * world space, to every material this file has ever touched. It is ONE write per
 * frame rather than N because the uniform objects are module-level and shared.
 *
 * **Whoever owns the geometry has to call it, and the failure when nobody does
 * is silent and total.** The game this came from shipped with `injectLineLight`
 * correct, compiled onto every deck and structural material, and NOTHING EVER
 * CALLING `setLineLights` — so both segments sat at their default of
 * (0, −1e4, 0), ten kilometres below the floor, for every frame ever rendered.
 * The term ran, cost its ALU, and evaluated to zero. Four separate review
 * findings came out of that one unmade call. The defaults are deliberately far
 * away rather than at the origin so that this failure is dark rather than a
 * mysterious glow at the world centre — but dark is still what it looks like,
 * so a caller that installs this and never publishes has bought nothing.
 *
 * ## Provenance, and why the prose still argues from one game
 *
 * This arrived from a space racer's material code and its comments still argue
 * from that game's art direction — the eclipse, the planet, the deck. **That
 * reasoning is kept on purpose:** it is the WHY behind every constant here, and
 * this codebase has already paid once for deleting a guard whose comment merely
 * looked wrong. Read "the art direction" as "the requirement that bought this
 * term".
 *
 * What is general is all of the mechanism. The colour and the falloff radius
 * are module constants today because the game that commissioned it has one
 * strip colour; a second caller that needs another should widen them to
 * parameters in its own commit, not smuggle it in beside a move.
 *
 * Depends on `WORLD_PARS` / `WORLD_VERTEX` from `MaterialChunks.js` — it needs
 * the world position varying — and on nothing else in this package. The `clamp`
 * inside the shader text is GLSL's own builtin, not a JS helper, which is what
 * keeps this file off the @homie-rocks/noise edge that `canvastex.ts` and
 * `matpatch.ts` also decline to take.
 */
import * as THREE from 'three';
import { WORLD_PARS, WORLD_VERTEX } from './MaterialChunks.js';

/*
 * ===========================================================================
 *  THE ECLIPSE STRIP, and it is load-bearing for 27.2 % of every lap.
 * ===========================================================================
 *  For 8.3 seconds a lap the star is behind the planet, the void fill is 0.06
 *  and there is no key light at all. The only things in the frame are the
 *  deck's own mag-strip and seven engine plumes. The art direction makes "raise
 *  the ambient to see the dark bits" an automatic fail, so the eclipse arc has
 *  to be made drivable by the strip ACTUALLY LIGHTING THE PLATE BESIDE IT,
 *  which is what this does.
 *
 *  Two segments, closed form, no loop, no shadow. They are the centre mag-strip
 *  and the nearer of the two edge lines, fed per frame by whoever owns the track
 *  (see `setLineLights`) — never more than two, because two is what the geometry
 *  guarantees is nearby and a variable-length loop is a shader recompile
 *  waiting to happen.
 *
 *  THE SPECULAR TERM IS THE REASON THIS IS NOT JUST A POINT LIGHT. The art
 *  direction is explicit that the contribution must perturb the SPECULAR, not
 *  only the diffuse, and the distinction is the whole effect: a polished
 *  ferrous plate beside a 0.42 m emissive line shows a *stretched* highlight of
 *  that line, and the stretch is what says "this metal is being lit" rather
 *  than "this metal is glowing". A point light at the segment's midpoint gives
 *  a round highlight and reads as a lamp; the representative-point solve below
 *  gives the elongated one and reads as a strip.
 *
 *  Representative point (Karis' formulation, MRP against the reflection ray):
 *  find the point on the segment closest to the mirror direction, and shade a
 *  point light there with the roughness widened to account for the source's
 *  angular size. That is exact for a mirror, wrong by a few percent for a rough
 *  surface, and about 20 instructions cheaper than any integral that is right.
 *
 *  Falloff `1 / (1 + (d/2.4)²)` and the 1.2 clamp are both from the art
 *  direction. The clamp matters more than it looks: without it a ship crossing
 *  directly over the strip drives the deck under it past the bloom threshold,
 *  and that threshold was chosen precisely so THE DECK NEVER BLOOMS.
 * ===========================================================================
 */

/** Cyan `#37d6ff` at the strip's own tier-2 radiance, in linear space. */
const LINE_LIGHT_COLOR = new THREE.Color(0x37d6ff).convertSRGBToLinear();

/** Materials already carrying this term — see the guard in `injectLineLight`. */
const _lineLit = new WeakSet<THREE.Material>();

/**
 * The two segments, shared by every material that asks for the term.
 *
 * Deliberately ONE uniform object rather than one per material: the two nearest
 * mag-strip segments are a property of the camera's position on the track, not
 * of the surface being shaded, so every deck material, every truss and every
 * prop in a given frame wants the same pair. Sharing them also means the track
 * system writes four vectors per frame instead of four per material — and, more
 * importantly, that two materials standing next to each other can never disagree
 * about where the strip is, which would read as a lighting seam down the deck.
 */
/*
 * THE TUPLE ANNOTATION IS THE ONLY THING ON THESE TWO LINES THAT IS NOT WHAT
 * THE GAME SHIPPED, AND IT IS TYPE-ONLY.
 *
 * The games compile at `strict: false`; this package compiles at `strict: true,
 * noUncheckedIndexedAccess: true`, under which `value[0]` is
 * `Vector3 | undefined` and `setLineLights` does not typecheck. The array is a
 * two-element literal that nothing ever pushes to or shortens — `uLineA[ 2 ]`
 * in the GLSL is why it is fixed at two — so declaring it as the tuple it
 * already is removes the error without a `!`, without a guard, and without one
 * byte of emitted difference.
 *
 * A parity probe is the evidence rather than this comment: it drives the
 * PRE-MOVE source, which carries no annotation, against this one and compares
 * the published uniforms with `Object.is`.
 */
const _lineA: { value: [THREE.Vector3, THREE.Vector3] } = { value: [new THREE.Vector3(0, -1e4, 0), new THREE.Vector3(0, -1e4, 0)] };
const _lineB: { value: [THREE.Vector3, THREE.Vector3] } = { value: [new THREE.Vector3(0, -1e4, 0), new THREE.Vector3(0, -1e4, 0)] };
const _lineCol = { value: new THREE.Vector3(LINE_LIGHT_COLOR.r, LINE_LIGHT_COLOR.g, LINE_LIGHT_COLOR.b) };
/** x = global gain, y = radius in metres for the falloff, z = hard clamp. */
const _lineTune = { value: new THREE.Vector3(1, 2.4, 1.2) };

/**
 * Publish the two nearest mag-strip segments, in world space.
 *
 * Called once per frame by whoever owns the deck geometry. The defaults park
 * both segments 10 km below the ring, so a system that never calls this gets
 * exactly zero contribution rather than a light at the origin — which is the
 * failure mode that would otherwise show up as a mysterious bright patch at
 * world zero and take days to trace.
 */
export function setLineLights(
  a0: THREE.Vector3, b0: THREE.Vector3,
  a1: THREE.Vector3, b1: THREE.Vector3,
): void {
  _lineA.value[0].copy(a0);
  _lineB.value[0].copy(b0);
  _lineA.value[1].copy(a1);
  _lineB.value[1].copy(b1);
}

/**
 * Global gain on the line-light term, 0..1.
 *
 * The sunlit half does not need it — a 5.6-intensity key at 40:1 buries a 1.2
 * clamp — and paying 14 ALU on every deck pixel for something invisible is the
 * kind of cost that shows up in a fill-rate probe and nowhere else. Drive it
 * from the baked `solar` channel: 1 in the eclipse, ~0.25 in the light (not
 * zero, because a hard cut at the terminator would be visible in the one
 * signature frame the eclipse exists for).
 */
export function setLineLightGain(gain: number): void {
  _lineTune.value.x = gain;
}

/**
 * The closed-form two-segment term, injected into a material's direct lighting.
 *
 * Inserted after `<lights_fragment_end>`, where `reflectedLight`, `material` and
 * the shaded `normal` are all live and nothing downstream has consumed them yet.
 * Adding into `reflectedLight` rather than into `totalEmissiveRadiance` is what
 * makes this a LIGHT: the AO term, the tone map and the grade all treat it as
 * one, and it lands under the bloom threshold instead of over it.
 */
function injectLineLight(mat: THREE.Material): void {
  /*
   * IDEMPOTENT, AND THE GUARD IS NOT DEFENSIVE PROGRAMMING — IT IS LOAD-BEARING.
   *
   * The world varyings are `#ifndef`-guarded, so applying this twice COMPILES
   * CLEANLY and then adds the whole term into `reflectedLight` twice. The
   * 1.2 clamp is applied per injection, so a doubled material delivers 2.4 down
   * the middle of the deck — over the 1.35 bloom threshold, which is the one
   * line "THE DECK NEVER BLOOMS" exists to hold. A doubled light is far harder
   * to spot than a shader that fails to compile.
   *
   * That is a live case and not a hypothetical: in the game this came from,
   * `hull-plate` calls this from its own generator, the material library caches
   * its variants by key so the circuit and the scenery are handed the SAME
   * material object, and a deck sweep then walks the circuit and asks for the
   * term on everything it finds. Without this set, `steel` would get it twice.
   */
  if (_lineLit.has(mat)) return;
  _lineLit.add(mat);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uLineA = _lineA;
    shader.uniforms.uLineB = _lineB;
    shader.uniforms.uLineColor = _lineCol;
    shader.uniforms.uLineTune = _lineTune;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' + WORLD_PARS + /* glsl */ `
        uniform vec3 uLineA[ 2 ];
        uniform vec3 uLineB[ 2 ];
        uniform vec3 uLineColor;
        uniform vec3 uLineTune;
        `,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          // View direction in WORLD space. three's geometryViewDir is
          // view-space and the segments arrive in world space, so the
          // reflection has to be solved in one frame or the other — world is
          // the cheaper one, because vWorldP already exists for the breakup
          // injection and cameraPosition is a stock uniform.
          vec3 kLV = normalize( cameraPosition - vWorldP );
          // The shaded normal is in VIEW space by this point in the chunk order.
          // Rotating it back costs one mat3 multiply and is the only honest way
          // to combine it with a world-space source.
          vec3 kLN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
          float kRough = max( 0.045, roughnessFactor );
          // Blinn-Phong exponent from GGX roughness. The 2/a^2-2 mapping is the
          // standard one; it is used rather than a real GGX lobe because §4.4
          // specifies Blinn-Phong here and because the whole term is capped at
          // 1.2 anyway, so lobe fidelity buys nothing the clamp does not take.
          float kA = kRough * kRough;
          float kShin = 2.0 / max( 1e-4, kA * kA ) - 2.0;
          // THE REFLECTANCE THIS TERM IS ALLOWED TO USE IS F0, NOT THE ALBEDO.
          // This used to read ( 0.04 + 0.96 * metalnessFactor ) * material.diffuseColor,
          // and on the deck that is a category error twice over: diffuseColor is
          // the RAW albedo (three keeps the ( 1 - metalness ) fold in
          // diffuseContribution, not here), and an albedo is only an F0 for a
          // METAL. The deck plate's #3c4148 is 0.052 linear, so the strip's
          // specular spill was being scaled by five per cent of a reflectance
          // that should have been the plate's real Fresnel — which is why the
          // dashes in a reviewed grid frame sit on black with no falloff and no
          // cast on the plate at 0.5 m. specularColorBlended is exactly
          // mix( specularColor, albedo, metalness ), i.e. the true F0, and it is
          // per-texel, so the metalness map's own variation comes with it.
          vec3 kF0 = material.specularColorBlended;
          vec3 kDiff = vec3( 0.0 );
          vec3 kSpecSum = vec3( 0.0 );
          for ( int i = 0; i < 2; i ++ ) {
            vec3 kP0 = uLineA[ i ];
            vec3 kSeg = uLineB[ i ] - kP0;
            float kL2 = max( 1e-6, dot( kSeg, kSeg ) );

            // --- diffuse: closest point on the segment ---------------------
            float kT = clamp( dot( vWorldP - kP0, kSeg ) / kL2, 0.0, 1.0 );
            vec3 kD = kP0 + kSeg * kT - vWorldP;
            float kDist = length( kD );
            vec3 kLdir = kD / max( 1e-4, kDist );
            float kR = kDist / uLineTune.y;
            float kAtten = 1.0 / ( 1.0 + kR * kR );
            float kNdL = max( dot( kLN, kLdir ), 0.0 );

            // --- specular: representative point on the mirror ray ----------
            // Closest approach between the segment and the reflection ray,
            // clamped to the segment. This is what stretches the highlight
            // along the strip instead of pooling it into a dot.
            vec3 kRefl = reflect( - kLV, kLN );
            vec3 kD0 = kP0 - vWorldP;
            float kRS = dot( kRefl, kSeg );
            float kSD = dot( kSeg, kD0 );
            float kRD = dot( kRefl, kD0 );
            float kDen = kL2 - kRS * kRS;
            float kTs = clamp( ( kSD - kRS * kRD ) / ( abs( kDen ) < 1e-5 ? 1e-5 : kDen ), 0.0, 1.0 );
            vec3 kSp = kP0 + kSeg * kTs - vWorldP;
            float kSDist = length( kSp );
            vec3 kSL = kSp / max( 1e-4, kSDist );
            vec3 kH = normalize( kSL + kLV );
            // THE FLOOR IS 1e-4 AND NOT 0.0, AND IT IS LOAD-BEARING.
            // GLSL leaves pow( x, y ) UNDEFINED at x == 0, and Apple's Metal
            // translation resolves it to NaN once y is large — it evaluates as
            // exp2( y * log2( x ) ), and log2( 0 ) is -Inf. kShin here runs to
            // ~487,650 at the 0.045 roughness floor, so every back-facing texel
            // on the deck (dot( kLN, kH ) clamped to exactly 0) produced a NaN
            // specular, which then propagated through the whole shading sum.
            // Measured: 2.18 % of shaded pixels came back non-finite, against
            // 0.00 % at HEAD, and luma-histogram refused to report at all
            // because its float readback was non-finite — so the gate that
            // enforces §4.7's emissive ladder was down.
            // A base of 1e-4 raised to any exponent this term uses is still 0
            // to well beyond half-float precision, so this removes the
            // undefined behaviour and changes no pixel that was already valid.
            // Confirmed by ablation: flooring the base is the whole fix; capping
            // kShin at 2048 and forcing kNorm to 1 both left the NaN in place.
            float kSpec = pow( max( dot( kLN, kH ), 1e-4 ), kShin );
            // Energy normalisation for the Blinn lobe, and the source's own
            // angular width folded in: a 0.42 m strip seen from 1 m is not a
            // point, so the lobe is widened by distance rather than left to
            // produce a mirror-sharp line on a polished plate at touching range.
            float kNorm = ( kShin + 8.0 ) / 25.13;
            float kWide = 1.0 / ( 1.0 + 0.42 / max( 0.25, kSDist ) );
            float kSAtten = 1.0 / ( 1.0 + ( kSDist / uLineTune.y ) * ( kSDist / uLineTune.y ) );

            // SCHLICK, AND IT IS THE HALF OF §4.4 THAT WAS NEVER THERE.
            // A racing camera meets the deck at 60–87° of incidence in every
            // pixel of the frame, and at 87° the plate's reflectance is not its
            // F0 of 0.042, it is 0.042 + 0.958 * ( 1 - cos 87° )^5 ≈ 0.78 —
            // nineteen times higher. Without this the strip's spill was being
            // evaluated at the head-on reflectance at exactly the angles the
            // game is never viewed from, which is a far larger error than the
            // F0 slug above and is the actual reason the stretched highlight
            // §4.4 asks for by name has never appeared.
            //
            // three's own F_Schlick rather than a local pow( 1 - VdH, 5 ): it
            // is Epic's exp2 variant, so it is cheaper than the literal Schlick
            // AND it is the identical function the main GGX lobe in
            // <lights_physical_pars_fragment> uses. Sharing it is not tidiness —
            // a line-light whose Fresnel disagreed with the key's would put a
            // different reflectance on the same texel depending on which light
            // was being summed, and the seam that produces is exactly the kind
            // of thing that reads as a shading bug and gets chased for a round.
            float kVdH = max( dot( kLV, kH ), 0.0 );
            vec3 kF = F_Schlick( kF0, material.specularF90, kVdH );

            // diffuseContribution rather than diffuseColor: the diffuse half of
            // a light must carry the ( 1 - metalness ) fold, or a metal lit by
            // the strip gets a diffuse lobe it is not entitled to.
            kDiff += uLineColor * material.diffuseContribution * kNdL * kAtten;
            kSpecSum += uLineColor * kF * ( kSpec * kNorm * kWide * kSAtten );
          }
          // §4.4's clamp, applied to the SUM rather than per segment: two
          // segments each at the cap would otherwise deliver 2.4 down the middle
          // of the deck and put the strip's own surroundings over §5.3's 1.35
          // bloom threshold, which is exactly the discipline the deck is not
          // allowed to break.
          //
          // Clamping the TOTAL and then scaling both lobes by the same factor,
          // rather than clamping each, is what keeps the ratio between them
          // intact at touching range: a per-lobe clamp would flatten the
          // specular into the diffuse exactly where the streak is strongest and
          // hand back the "emissive painted on the world" read the split exists
          // to remove.
          vec3 kTot = ( kDiff + kSpecSum ) * uLineTune.x;
          float kPeak = max( kTot.r, max( kTot.g, kTot.b ) );
          float kScale = uLineTune.x * ( kPeak > uLineTune.z ? uLineTune.z / kPeak : 1.0 );
          reflectedLight.directDiffuse += kDiff * kScale;
          // The specular goes into the SPECULAR accumulator. Nothing downstream
          // divides them differently today, but §4.4's whole claim is that this
          // term is a light rather than a glow, and a specular contribution
          // booked as diffuse is the one place that claim could quietly stop
          // being true.
          reflectedLight.directSpecular += kSpecSum * kScale;
        }`,
      );
  };
  const key = 'linelight2';
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * The line-light term, for a material this library did not build.
 *
 * Exported because, in the game this came from, the deck actually rendered was
 * NOT built by the material library: the racing surface was the prop module's
 * `plate` / `plateRace` / `grip` / `grating`, assembled into one mesh by the
 * track geometry, and none of those four carried the line-light term. So the
 * one surface the term was written for was the one surface that did not have
 * it. One call per deck material at build time is the whole fix, and it is the
 * right place for it:
 *
 *     import { addLineLight } from '@homie-rocks/render/LineLight.js';
 *     addLineLight(plate); addLineLight(plateRace);
 *     addLineLight(grip);  addLineLight(grating);
 *
 * Idempotent — a WeakSet inside `injectLineLight` refuses a second application,
 * because two copies of the term compile cleanly and then double the light,
 * which puts the deck over the bloom threshold. That game's deck sweep also
 * installs it on the circuit as a shim if nobody else has, so calling this
 * explicitly is a no-op if the sweep got there first and a strict improvement
 * if it did not (an explicit call is made before the first render, so it costs
 * no recompile, and it is visible to `Prewarm`).
 *
 * Nothing else is required: the segments and the gain are published every frame
 * by whoever calls `setLineLights` and `setLineLightGain`, whether or not this
 * file built the material consuming them.
 */
export function addLineLight(mat: THREE.Material): void {
  injectLineLight(mat);
}

/**
 * The internal injector, exported alongside its public alias.
 *
 * `injectLineLight` and `addLineLight` ARE ONE FUNCTION — the second is a
 * one-line call to the first — and they are two names because they address two
 * readers: a material library calling it on something IT built, and a module
 * that owns geometry calling it on a material this library never saw. Kept as
 * two names so both call sites in the game that commissioned this term stayed
 * byte-identical through the extraction.
 */
export { injectLineLight };

/**
 * This term's idempotence register, exported BY IDENTITY.
 *
 * ===========================================================================
 *  A LIBRARY THAT CLONES ITS MATERIALS HAS TO INHERIT THIS, OR THE CLONE GETS
 *  THE WHOLE TERM TWICE AND THE DECK BLOOMS.
 * ===========================================================================
 * The guard inside `injectLineLight` explains why double application is the
 * dangerous case rather than the harmless one: the world varyings are
 * `#ifndef`-guarded, so a doubled injection COMPILES CLEANLY and then adds the
 * term into `reflectedLight` twice — 2.4 down the middle of the deck against a
 * 1.35 bloom threshold. That guard is keyed on the material OBJECT, so a
 * recoloured variant clone is a different object and is not in the set.
 *
 * `MatLibShape.claims` in `MaterialLib.ts` compares by identity, so it needs
 * THIS WeakSet and not an equivalent one. A second copy of the set is the same
 * bug wearing a different name.
 */
export { _lineLit as lineLightClaim };

// ---------------------------------------------------------------------------
// THE N-SEGMENT VARIANT, and why it is in this file rather than merged above
// ---------------------------------------------------------------------------
//
// Everything above is the TWO-segment line light, and two is not a limitation
// that was left in by accident — it is the number a shader can carry without a
// variable-length loop, and it was the right number for the game that
// commissioned it: a racing camera 1.5 m off a track it is always touching.
//
// A camera 190 m back and 100 m up looking across a 600 m world is a different
// problem with the same term in it. Two 9 m chords out of several hundred cover
// roughly a thousandth of what is in frame, and measured on the build that
// shipped them BOTH published segments were interior chords of the same tube.
// So the count became a compile-time constant substituted into the array
// declaration and the loop bound, and everything downstream of that changed
// with it: a per-slot falloff radius rather than one shared one, a night ramp,
// a diffuse wrap and a source standoff that can be swept from a console.
//
// THE TWO ARE NOT MERGED AND THE REASON IS NOT TIDINESS. The two-segment
// version's falloff, colour and clamp are module constants fitted against one
// track; this one's are uniforms fitted against one colony. Collapsing them
// re-lights whichever game loses, silently, with every gate green — the same
// standing refusal `cascade.ts` and `cascadederiv.ts` carry. What IS shared is
// the argument, and it is written once, above.
//
// Arrived from a base-building game's structures module. Nothing here is a
// colour: `lineStripUniforms` hands back objects at their safe defaults and
// every value in them is written by the caller.
//
// ## The count token
//
// GLSL array sizes and loop bounds must be compile-time constants, so the
// segment count is a TOKEN in the text below and the caller substitutes it as a
// literal before handing the source to three. One token, replaced in both the
// declaration and the loop, so the two can never disagree — a uniform loop
// bound larger than the declared array is a link error on some drivers and
// reads garbage on others. `LINE_N_TOKEN` is that token; do not type it out at
// a call site.
//
// ## The `#ifndef` guard names are MB_ and they stay MB_
//
// They are the pre-processor guard on the world varyings and they appear in the
// FINAL shader text, unlike the count token, which is substituted away. Renaming
// them is provably inert and it is still a shader-text change, and the parity
// baseline for this move is byte-for-byte. Renaming them is somebody's own
// commit with its own before-and-after, not a tidy-up smuggled in beside a move.

/** The token every array size and loop bound below is written in terms of. */
export const LINE_N_TOKEN = 'MB_LINE_N';

/**
 * A fresh set of uniform objects for an N-segment line light.
 *
 * ONE SET SHARED BY EVERY MATERIAL, not one per material: which segments are
 * nearest is a property of the CAMERA, not of the surface being shaded, so two
 * materials standing next to each other can never disagree about where a strip
 * is — which would read as a lighting seam down the middle of a road.
 */
export function lineStripUniforms(n: number) {

  const mkLineArr = (y: number, z: number) =>
    Array.from({ length: n }, () => new THREE.Vector3(0, y, z));

  const A = { value: mkLineArr(-1e4, 0) };
  const B = { value: mkLineArr(-1e4, 1) };
  const COL = { value: Array.from({ length: n }, () => new THREE.Vector3(0, 0, 0)) };
  /**
   * x = global gain, y = the LEGACY single falloff radius, z = hard clamp,
   * w = specular gain (the ablation handle for the specular half).
   *
   * In the game this came from, .x and .w are written every tick by the
   * lighting rig (a night gain and specular at night, day values by day),
   * keyed on the solar clock so the 11 deg hero shot cannot see the night end.
   * .z stays 1.2 — the ground never blooms. Default (1, 2.4, 1.2, 1)
   * is the first-frame value before tick; the ramp owns it after that.
   *
   * ── .y IS NO LONGER THE RADIUS THE SHADER USES, AND THAT IS THE FIX ─────────
   *
   * One radius for all ten slots was measurably the reason the term lit almost
   * nothing at the hero framing. `publish` derived it from the distance to the
   * NEAREST strip; at the hero pose that strip is 24 m from the eye (it is under
   * and behind the framing, not in it), so the radius came out at 4.94 m and the
   * windowed falloff ends at four radii — 19.8 m of reach — for every slot,
   * including the ones that would have to cross 250 m to reach the hub dome.
   *
   * Measured, night/reference, `window.__lineGain` at 0, 1 and 12, three captures
   * out of one page load with the converged shutter:
   *
   *     regolith beside the near boulevard   44.63 / 44.63 / 44.64
   *     hub dome shell between the rings     37.22 / 37.22 / 37.22
   *
   * Bit-identical at TWELVE TIMES the shipping gain is not a dim term, it is a
   * term that is not reaching those pixels at all. `uLineRad[i]` below is the
   * per-slot replacement; .y survives only as the value `__lineLight()` reports
   * and as the near-field floor the per-slot number is derived from.
   */
  const TUNE = { value: new THREE.Vector4(1, 2.4, 1.2, 1) };
  /** 1 at night, 0 under a risen sun. The glow shader turns toward icy cyan so
   *  the strips mark the road without beating the steel as first chroma. */
  const NIGHT = { value: 0 };
  /**
   * Per-slot falloff radius, metres. `publish` sizes each one from THAT slot's own
   * distance to the eye, so a pool stays a similar fraction of the SCREEN wherever
   * its strip is, instead of every pool inheriting the near-foreground's radius.
   */
  const RAD = { value: new Float32Array(n).fill(2.4) };
  /**
   * x = diffuse wrap, y = source standoff (m). Uniforms rather than constants so
   * both can be swept from `window.__lineWrap` without a rebuild: a
   * coefficient nobody can ablate is a coefficient nobody can check.
   */
  const SOFT = { value: new THREE.Vector2(0.24, 0.30) };
  return { n, A, B, COL, TUNE, NIGHT, RAD, SOFT };
}

/**
 * The uniform declarations, for injection into a fragment shader's <common>.
 *
 * THE SIX-SPACE INDENT IS DELIBERATE AND IT IS NOT A STYLE. This block was an
 * inline template literal inside the game's injector, indented to the code
 * around it, and the parity baseline for this move compares the composed
 * fragment source character for character. Whitespace inside GLSL is inert to
 * the compiler and stripping it is still a shader-text change; that is
 * somebody's own commit with its own before-and-after, not a tidy-up smuggled
 * in beside a move. The probe caught this at exactly 48 characters.
 */
export const LINE_STRIP_DECL = /* glsl */ `
      uniform vec3 uLineA[ MB_LINE_N ];
      uniform vec3 uLineB[ MB_LINE_N ];
      uniform vec3 uLineColor[ MB_LINE_N ];
      uniform vec4 uLineTune;
      uniform float uLineRad[ MB_LINE_N ];
      uniform vec2 uLineSoft;
      uniform float uNight;
      `;

export const WORLDN_PARS = /* glsl */ `
#ifndef MB_WORLD_PARS
#define MB_WORLD_PARS
varying vec3 vWorldP;
varying vec3 vWorldN;
#endif
`;

/*
 * THE INSTANCING GUARD, AND IT IS THE HIGHEST-RISK TRAP IN THIS PROJECT.
 *
 * three does NOT apply instanceMatrix to `transformed`: <project_vertex>
 * multiplies it into mvPosition only. So modelMatrix * transformed is the
 * INSTANCE-LOCAL position — byte-identical for every instance — and it fails
 * silently and plausibly. Everything repeated in this game is instanced or
 * merged, so a missing guard here would mean every instance of a road segment
 * thinks it is sitting at the same place and the line light lands in one spot.
 */
export const WORLDN_VERTEX = /* glsl */ `
#ifndef MB_WORLD_VERTEX
#define MB_WORLD_VERTEX
  vec4 mbWP = vec4( transformed, 1.0 );
  vec3 mbWN = objectNormal;
  #ifdef USE_INSTANCING
    mbWP = instanceMatrix * mbWP;
    mbWN = mat3( instanceMatrix ) * mbWN;
  #endif
  vWorldP = ( modelMatrix * mbWP ).xyz;
  // WORLD-SPACE GEOMETRIC NORMAL, and it must be the OBJECT normal rather than
  // three's transformedNormal, which is already in VIEW space by this point —
  // dotting a view normal against world up is the silent units mismatch
  // that is easy to make, and here it would make "which way is up" swing with
  // camera yaw, i.e. dust that slides around the dome as the camera orbits.
  // Not normalised here: an interpolated normal has to be renormalised in the
  // fragment shader anyway, so doing it twice is a wasted rsqrt per vertex.
  vWorldN = mat3( modelMatrix ) * mbWN;
#endif
`;

/**
 * The analytic line light — the single highest-value dark-scene term.
 *
 * Two segments, closed form, no loop over a variable count, no shadow, ~14 ALU.
 * Falloff 1/(1+(d/2.4)^2), the sum clamped to 1.2.
 *
 * THE SPECULAR HALF IS THE POINT. A point light at the segment midpoint gives a
 * round highlight and reads as a lamp; the representative-point solve below
 * (closest approach between the segment and the mirror ray, Karis' MRP) gives
 * the STRETCHED highlight beside the strip, and that stretch is what says "this
 * surface is being lit" instead of "this surface is glowing".
 *
 * It contributes into reflectedLight and not into totalEmissiveRadiance,
 * because that is what makes it a light: AO, the tone map and the grade all
 * treat it as one, and it lands under the 1.35 bloom threshold rather than over
 * it — which is how the road stays lit without the ground blooming.
 *
 * IT IS GATED ON NOTHING. No #define, no quality branch, no feature flag.
 * Another project shipped a complete implementation of this term that never
 * executed a line because nothing declared the define it sat behind.
 * `window.__lineLight().compiled` counts the programs that really got it, and
 * it is zero if this is broken.
 */
export const LINE_STRIP_FRAG = /* glsl */ `
{
  // World-space view vector. three's geometryViewDir is VIEW space and the
  // segments arrive in world space; solving in one frame or the other is
  // mandatory, and world is cheaper because vWorldP already exists.
  vec3 mbV = normalize( cameraPosition - vWorldP );
  // The shading normal is VIEW space by this point in the chunk order.
  // Dotting it against a world-space direction is a silent units mismatch that
  // produces a rim term swinging with camera yaw. Rotate first.
  vec3 mbN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  float mbRough = max( 0.045, roughnessFactor );
  float mbA = mbRough * mbRough;
  // Blinn-Phong exponent from GGX roughness, the standard 2/a^2 - 2 mapping.
  float mbShin = 2.0 / max( 1e-4, mbA * mbA ) - 2.0;
  vec3 mbF0 = material.specularColorBlended;
  vec3 mbDiff = vec3( 0.0 );
  vec3 mbSpec = vec3( 0.0 );
  for ( int i = 0; i < MB_LINE_N; i ++ ) {
    // THE SOURCE STANDS OFF THE SURFACE IT IS MOUNTED ON, AND WITHOUT THAT THE
    // DOME SHELL IS EXACTLY ZERO — not dim, zero, and provably so.
    //
    // A registered chord lies ON the surface that carries it: a road strip sits
    // on the slab, a hub-dome ring chord sits on the shell. For a CONVEX
    // receiver that is a hard geometric zero rather than a small number. Take
    // two points P and Q on a sphere of radius R centred at C: the receiver
    // normal at P is (P-C)/R, and dot( P-C, Q-P ) = R^2 cos(theta) - R^2 < 0 for
    // every Q other than P. So a sphere cannot light itself, and a ring flush on
    // a dome contributes nothing to the shell between the rings no matter how
    // bright it is or how many slots it wins. Measured: RGB(24,28,34) on the hub
    // shell at gain 0, gain 1 and gain 12, identical to the code value.
    //
    // The fixture is not flush. buildHubDome's ring is a 0.15 m glow torus in
    // a 0.3 m metal groove standing proud of the lathe profile, and every road
    // strip sits on a kerb above the slab. uLineSoft.y is that standoff, applied
    // along the RECEIVER's normal so it is a standoff from whatever the light is
    // mounted on without the registry having to know which surface that is.
    vec3 mbOff = mbN * uLineSoft.y;
    vec3 mbP0 = uLineA[ i ] + mbOff;
    vec3 mbSeg = uLineB[ i ] - uLineA[ i ];
    float mbL2 = max( 1e-6, dot( mbSeg, mbSeg ) );
    // PER-SLOT RADIUS. See U_LINE_TUNE — one shared radius sized off the nearest
    // strip is what stopped every other slot from reaching anything.
    float mbRad = uLineRad[ i ];

    // Diffuse: closest point on the segment to this fragment.
    float mbT = clamp( dot( vWorldP - mbP0, mbSeg ) / mbL2, 0.0, 1.0 );
    vec3 mbD = mbP0 + mbSeg * mbT - vWorldP;
    float mbDist = length( mbD );
    vec3 mbL = mbD / max( 1e-4, mbDist );
    float mbR = mbDist / mbRad;
    // WINDOWED, AND THE WINDOW IS WHAT MAKES IT A POOL RATHER THAN A WASH.
    //
    // 1/(1+r^2) never reaches zero. That is fine when the radius is the 2.4 m
    // this came from, and it is not fine now the radius scales to 30 m at the
    // hero framing: at 100 m from the strip the raw curve still returns 8% of
    // peak, and ten segments each returning 8% over the whole plain is the art direction's
    // banned "uniform ambient colour wash standing in for the earthshine fill"
    // arriving by the back door. Measured before this window went in: the far
    // bottom-left corner of the night frame, ~200 m from any strip, lifted from
    // luma 19.4 to 23.9 — a 23% lift on ground nothing should be lighting.
    //
    // A squared Hermite-ish window, zero at 4 radii: it costs 3 ALU, leaves the
    // near field within 12% of the raw curve, and makes the tail actually end.
    float mbWin = max( 0.0, 1.0 - mbR * mbR * 0.0625 );
    mbWin *= mbWin;
    float mbAtt = mbWin / ( 1.0 + mbR * mbR );
    // WRAPPED LAMBERT, AND IT IS THE AREA-SOURCE TERM, NOT A FUDGE FACTOR.
    //
    // max( dot( N, L ), 0 ) at the closest point is the irradiance from a POINT.
    // These sources are 9-20 m long and the receiver is often only 2-6 m away,
    // so the source subtends tens of degrees and the correct integral over it is
    // substantially larger than the closest-point cosine — most of all at
    // grazing, where the closest point is below the horizon but half the source
    // is still above it. ( N.L + w ) / ( 1 + w ) is the standard cheap stand-in
    // for that integral and it is what puts light on a dome shell between two
    // rings, on a kerb face, and on the flank of a rib.
    //
    // IT CANNOT BECOME A WASH: it is inside the same 4-radii window as the
    // attenuation, so it changes the SHAPE of a pool and never its extent. The
    // control rect for that claim is the open plain 200 m from any strip, which
    // must read the same count with the term on and off.
    float mbNdL = max( ( dot( mbN, mbL ) + uLineSoft.x ) / ( 1.0 + uLineSoft.x ), 0.0 );

    // Specular: representative point on the mirror ray. This is the term that
    // stretches the highlight along the strip instead of pooling it to a dot.
    vec3 mbRefl = reflect( - mbV, mbN );
    vec3 mbD0 = mbP0 - vWorldP;
    float mbRS = dot( mbRefl, mbSeg );
    float mbSD = dot( mbSeg, mbD0 );
    float mbRD = dot( mbRefl, mbD0 );
    float mbDen = mbL2 - mbRS * mbRS;
    float mbTs = clamp( ( mbSD - mbRS * mbRD ) / ( abs( mbDen ) < 1e-5 ? 1e-5 : mbDen ), 0.0, 1.0 );
    vec3 mbSp = mbP0 + mbSeg * mbTs - vWorldP;
    float mbSDist = length( mbSp );
    vec3 mbSL = mbSp / max( 1e-4, mbSDist );
    vec3 mbH = normalize( mbSL + mbV );
    // THE 1e-4 FLOOR IS LOAD-BEARING, NOT DEFENSIVE.
    // GLSL leaves pow( x, y ) undefined at x == 0 and Apple's Metal translation
    // resolves it to NaN once y is large, because it evaluates as
    // exp2( y * log2( x ) ) and log2( 0 ) is -Inf. mbShin runs to ~487,000 at
    // the roughness floor, so every back-facing texel produced a NaN specular
    // on the neighbouring term, which then propagated through the whole shading sum and
    // took down the luma gate. 1e-4 raised to any exponent used here is still
    // zero well beyond half-float precision, so no valid pixel changes.
    float mbPow = pow( max( dot( mbN, mbH ), 1e-4 ), mbShin );
    float mbNorm = ( mbShin + 8.0 ) / 25.13;
    // The source has real angular width: a 0.26 m strip seen from 1 m is not a
    // point, so widen the lobe by distance rather than let it go mirror-sharp.
    float mbWide = 1.0 / ( 1.0 + 0.26 / max( 0.25, mbSDist ) );
    float mbSR = mbSDist / mbRad;
    float mbSWin = max( 0.0, 1.0 - mbSR * mbSR * 0.0625 );
    mbSWin *= mbSWin;
    float mbSAtt = mbSWin / ( 1.0 + mbSR * mbSR );
    // Schlick at the REAL incidence. A three-quarter camera meets the road at
    // 55-80 degrees in most of the frame, where a dielectric's reflectance is
    // many times its head-on F0. Using three's own F_Schlick rather than a
    // local pow keeps this term's Fresnel identical to the key light's; a
    // disagreement between them puts two reflectances on one texel and reads
    // as a shading seam.
    float mbVdH = max( dot( mbV, mbH ), 0.0 );
    vec3 mbF = F_Schlick( mbF0, material.specularF90, mbVdH );

    // diffuseContribution, not diffuseColor: the diffuse half of a light must
    // carry the ( 1 - metalness ) fold or a metal gets a diffuse lobe it is not
    // entitled to.
    // Night: ice cyan pools the same way the glow cores ice, so the
    // S names the boulevard as white-cyan (the art direction) and cannot beat
    // steel as first chroma. Amber slots are untouched.
    vec3 mbLC = uLineColor[ i ];
    float mbLCcyan = step( mbLC.r + 0.04, mbLC.b );
    float mbLCy = dot( mbLC, vec3( 0.2126, 0.7152, 0.0722 ) );
    mbLC = mix( mbLC, vec3( mbLCy * 1.04, mbLCy * 1.06, mbLCy * 1.10 ), mbLCcyan * uNight * 0.88 );
    mbDiff += mbLC * material.diffuseContribution * mbNdL * mbAtt;
    // uLineTune.w is the SPECULAR ABLATION HANDLE, window.__lineSpec, and it
    // exists because the look asks for this lobe by name ("it must perturb
    // the specular, not just the diffuse") and there was no way to prove it was
    // doing anything. A term whose contribution cannot be forced to zero from a
    // harness is a term nobody can measure — it is 1.0 in every shipped frame.
    mbSpec += mbLC * mbF * ( mbPow * mbNorm * mbWide * mbSAtt * uLineTune.w );
  }
  // Clamp the SUM and scale both lobes by the same factor. A per-lobe clamp
  // would flatten the specular into the diffuse exactly where the streak is
  // strongest, handing back the "emissive painted on the world" read that the
  // split exists to remove. Two segments each at the cap would otherwise
  // deliver 2.4 down the middle of the road and put the slab over the 1.35
  // bloom threshold, and THE GROUND NEVER BLOOMS is the discipline that
  // threshold was chosen for.
  vec3 mbTot = ( mbDiff + mbSpec ) * uLineTune.x;
  float mbPeak = max( mbTot.r, max( mbTot.g, mbTot.b ) );
  float mbScale = uLineTune.x * ( mbPeak > uLineTune.z ? uLineTune.z / mbPeak : 1.0 );

  // ── THE CHROMA BOUND. THE ACCENT IS A LIGHT, NOT A FLOOR COLOUR ───
  //
  // The art direction permits exactly one saturated accent and it is a LIGHT SOURCE. A
  // patch of regolith or sinter rendered as saturated teal is not in the
  // palette at all, and it is what a review measured: a 450x150 rect
  // of ground reading #0e485c at 85.1% HSV chroma — the surface of a swimming
  // pool. Measured here on the night frame before this term went in, the rect
  // this light owns most (1250,925 450x150) came back #1b4169 at 73.8% chroma,
  // and the SAME rect with the line light ablated off reads #1b3459 at 69.9%:
  // the light was adding 14 counts of G and 16 of B onto a neutral slab and
  // taking the surface with it.
  //
  // WHY THE FIX BELONGS HERE AND NOT IN THE GRADE. The post chain's highlight
  // desaturation rolloff (sat 1.06 -> 0.42 across linear
  // 0.62-1.4) is the right idea and it never fires on this term: a pool on a
  // night road sits at linear 0.05-0.3, an order below the knee. So the strips
  // bloom to white-cyan exactly as §3 asks and the FLOOR under them stays neon,
  // which is the wrong way round.
  //
  // AND IT IS NOT A CHEAT — IT IS THE MISSING SPECTRAL TERM. Lunar regolith has
  // a strongly reddened reflectance slope: roughly 0.06 at 400 nm rising to
  // ~0.13 at 700 nm. An RGB renderer multiplies one grey albedo by one light
  // colour and therefore cannot express that a cyan (~490 nm) source comes back
  // off regolith attenuated relative to a red one; a spectral solve would
  // return a markedly greyer, warmer reflection than the source. mbFloor is the
  // RGB stand-in for that, which is why it is applied to the LIGHT's
  // contribution and to nothing else in the frame.
  //
  // Two parts, and they do different jobs:
  //   · mbFloor 0.34 — no pool, however faint, is ever pure source hue.
  //   · the term in mbLum — a pool bright enough to read as a light source goes
  //     pale the way a real one does, up to 0.86 at the clamp. That is the
  //     rolloff §3 mandates, moved to where the values actually are.
  // The mix is toward LUMINANCE, so it costs the pool no brightness at all:
  // every count the ground loses in chroma it keeps in value, and the lit patch
  // beside a strip is exactly as lit as it was.
  vec3 mbLumW = vec3( 0.2126, 0.7152, 0.0722 );
  float mbLum = dot( mbTot, mbLumW );
  float mbW = clamp( 0.34 + 1.05 * mbLum, 0.34, 0.86 );
  mbDiff = mix( mbDiff, vec3( dot( mbDiff, mbLumW ) ), mbW );
  // The specular keeps more of the hue on purpose: the stretched streak IS the
  // reflected image of the strip, so it is allowed to be the strip's colour,
  // and it is the term that says "a cyan light is doing this" once the diffuse
  // pool has stopped shouting it. 0.55 of the diffuse's desaturation.
  mbSpec = mix( mbSpec, vec3( dot( mbSpec, mbLumW ) ), mbW * 0.55 );

  reflectedLight.directDiffuse += mbDiff * mbScale;
  // Into the SPECULAR accumulator. Nothing downstream divides them differently
  // today, but the whole claim of this term is that it is a light rather than a
  // glow, and a specular contribution booked as diffuse is the one place that
  // claim could quietly stop being true.
  reflectedLight.directSpecular += mbSpec * mbScale;
}
`;

/**
 * Kaplanyan-style normal-variance filtering.
 *
 * The art direction names "aliasing crawl on thin geometry (masts and antennae
 * — these are everywhere in this scene and they *will* crawl)". three's own
 * geometryRoughness does this for the GEOMETRIC normal, which is why a bare
 * cylinder does not strobe, and deliberately excludes the mapped normal, which
 * is why a normal-mapped one does. This measures the final shading normal and
 * folds it into alpha the same way so the two compose instead of fighting.
 */
export const SPEC_AA_CHUNK = /* glsl */ `
  vec3 mbDNx = dFdx( normal );
  vec3 mbDNy = dFdy( normal );
  float mbVar = 0.25 * ( dot( mbDNx, mbDNx ) + dot( mbDNy, mbDNy ) );
  float mbKern = min( 2.0 * mbVar, 0.22 );
  roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + mbKern ) );
`;

/**
 * ===========================================================================
 *  THE N-SEGMENT INSTALLER — every anchor, in the one order that works.
 * ===========================================================================
 *  Arrived from a base-building game's `addSurfaceShading`, which was the only
 *  caller of the four chunks above and carried the whole argument for where
 *  each of them lands. Nothing in it named a colony: it installs the world
 *  varyings, an optional per-piece variation attribute, an optional
 *  caller-supplied extra fragment layer, the specular-AA filter and the
 *  N-segment term, at four different anchors chosen for four different reasons.
 *
 *  WHAT THE CALLER STILL OWNS, and this is the whole seam:
 *    · the EXTRA LAYER's GLSL. A world-space surface-history layer that paints
 *      print-layer bands off a 25 mm deposition bead is what a game is made of,
 *      and publishing one would hand the next game this one's materials.
 *    · the two variation coefficients. How much a per-piece roughness delta and
 *      a grime factor move the surface is tuning, not mechanism.
 *    · the segment count, the uniform bundle, the counters and the key prefix.
 *    · the `seen` set. Three injectors sharing one guard set means a material
 *      patched by one cannot be patched by another, which is a real property of
 *      the caller's material library and not this function's business.
 *
 *  IDEMPOTENT, AND THE GUARD IS LOAD-BEARING RATHER THAN DEFENSIVE. The world
 *  varyings are ifndef-guarded, so a double application COMPILES CLEANLY and
 *  then adds the entire term into reflectedLight twice. The hard clamp is
 *  applied per injection, so a doubled material delivers twice it — over the
 *  bloom threshold a road is not allowed to cross. A doubled light is far
 *  harder to spot than a shader that fails to compile.
 */

/** Per-piece variation carried on one attribute instead of one material each. */
export const VAR_PARS_V = 'attribute vec4 aVar;\nvarying vec4 vVar;\nvarying vec2 vPieceUv;\n';
export const VAR_VERT = '  vVar = aVar;\n  vPieceUv = uv;\n';
export const VAR_PARS_F = 'varying vec4 vVar;\nvarying vec2 vPieceUv;\n';

/**
 * Proof-of-execution counters. Every field is incremented AFTER the anchor was
 * found and the replace succeeded, so a non-zero `compiled` means real programs
 * carry the term — which is the failure this whole family exists to prevent:
 * another project held a complete implementation and never ran a line of it,
 * because the thing it was gated on was never declared.
 */
export interface LineStripCounters {
  injected: number;
  compiled: number;
  anchorMisses: number;
  /** Programs that compiled the caller's extra layer. */
  macro: number;
  macroMisses: number;
}

export interface LineStripInstall {
  /** Segment count. Substituted as a literal, never passed as a uniform. */
  n: number;
  /** The bundle from `lineStripUniforms(n)`. */
  uni: ReturnType<typeof lineStripUniforms>;
  counters: LineStripCounters;
  /** Shared idempotence guard, owned by the caller. */
  seen: WeakSet<THREE.Material>;
  /** Bump it whenever the chunks change, or a warm cache reuses the old build. */
  keyPrefix: string;
  /** Kaplanyan normal-variance roughness filter, for anything thin. */
  specAA?: boolean;
  /**
   * Per-piece roughness delta and grime factor off `aVar`, or false for none.
   * This is what buys "two adjacent panels with identical roughness fails the
   * shot" without paying a material per panel.
   */
  variation?: { rough: number; grime: number } | false;
  /** Declarations the extra layer needs, injected into the fragment stage. */
  extraPars?: string;
  /** The extra fragment layer itself, anchored after metalnessmap_fragment. */
  extraFrag?: string;
  /** Appended to the program cache key, so two layers never share a program. */
  extraKey?: string;
  /** Prefix for the two console errors. The caller's module name. */
  label: string;
  /** What the caller loses if the extra layer's anchor is gone. */
  extraMiss?: string;
}

export function installLineStrip(mat: THREE.Material, o: LineStripInstall): void {
  if (o.seen.has(mat)) return;
  o.seen.add(mat);
  o.counters.injected++;
  const variation = o.variation === false || o.variation === undefined ? null : o.variation;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uLineA = o.uni.A;
    shader.uniforms.uLineB = o.uni.B;
    shader.uniforms.uLineColor = o.uni.COL;
    shader.uniforms.uLineTune = o.uni.TUNE;
    shader.uniforms.uLineRad = o.uni.RAD;
    shader.uniforms.uLineSoft = o.uni.SOFT;
    shader.uniforms.uNight = o.uni.NIGHT;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLDN_PARS + (variation ? VAR_PARS_V : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLDN_VERTEX + (variation ? VAR_VERT : ''));

    let f = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + WORLDN_PARS + (variation ? VAR_PARS_F : '')
        + (o.extraFrag ? (o.extraPars ?? '') : '') + LINE_STRIP_DECL,
    );

    // THE EXTRA LAYER, ANCHORED AFTER metalnessmap_fragment.
    //
    // The anchor is chosen, not convenient. It is the last chunk before
    // normal_fragment_begin, so all three of diffuseColor, roughnessFactor and
    // metalnessFactor exist and none of them has been consumed yet: roughness
    // and metalness are folded into `material` inside lights_physical_fragment,
    // and writing them after that point is a no-op that looks exactly like a
    // working shader.
    if (o.extraFrag) {
      const anchorM = '#include <metalnessmap_fragment>';
      if (f.indexOf(anchorM) < 0) {
        o.counters.macroMisses++;
        console.error('[' + o.label + '] ' + (o.extraMiss ?? 'the extra surface layer anchor is missing.'));
      } else {
        f = f.replace(anchorM, anchorM + '\n' + o.extraFrag);
        o.counters.macro++;
      }
    }

    if (variation) {
      // vVar.x is a per-piece roughness delta, vVar.y a grime factor.
      f = f.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n' +
          '  roughnessFactor = clamp( roughnessFactor + vVar.x + vVar.y * ' + glslNum(variation.rough) + ', 0.035, 1.0 );\n' +
          '  diffuseColor.rgb *= ( 1.0 - vVar.y * ' + glslNum(variation.grime) + ' );\n',
      );
    }

    // Anchored ahead of lights_physical_fragment because roughnessFactor is
    // consumed there into material.roughness; after it, the write is a no-op.
    if (o.specAA) {
      f = f.replace('#include <lights_physical_fragment>', SPEC_AA_CHUNK + '\n#include <lights_physical_fragment>');
    }

    // MEASURE, DO NOT ASSUME. If the anchor ever moves in a three upgrade the
    // replace silently does nothing and the whole dark half of the game loses
    // its only local light — which is exactly how another project lost its own.
    const anchor = '#include <lights_fragment_end>';
    if (f.indexOf(anchor) < 0) {
      o.counters.anchorMisses++;
      console.error('[' + o.label + '] line-light anchor missing; the dark scene has no local light.');
    } else {
      f = f.replace(anchor, anchor + '\n' + LINE_STRIP_FRAG);
      o.counters.compiled++;
    }
    // GLSL array sizes and loop bounds must be compile-time constants, so the
    // segment count is substituted as a literal rather than passed as a uniform.
    // One token, replaced in both the declaration and the loop, so the two can
    // never disagree — a uniform loop bound larger than the declared array is a
    // link error on some drivers and reads garbage on others.
    shader.fragmentShader = f.split(LINE_N_TOKEN).join(String(o.n));
  };
  const key = o.keyPrefix + o.n + (o.specAA ? 'a' : '') + (variation ? 'v' : '') + (o.extraKey ?? '');
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}

/**
 * A number as GLSL source. `0.18` stays `0.18`; `2` becomes `2.0`, because a
 * GLSL float expression has no implicit int promotion — `vVar.y * 2` is a
 * compile error on a strict driver and silently accepted on a lenient one, so
 * the failure is per-machine and looks like a driver bug.
 */
function glslNum(v: number): string {
  const s = String(v);
  return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s;
}

/**
 * ===========================================================================
 *  THE ABLATION HANDLES — five of them, and the whole reason they exist.
 * ===========================================================================
 *  A term can be COMPILED, and FED, and still change no pixels. That is not a
 *  hypothetical: the project this family came from held a complete
 *  implementation of the line light without executing a line of it, because
 *  the thing it was gated on was never declared, and five reviews in a row
 *  said "the strips light nothing" without anyone able to say which half was
 *  missing. `counters.compiled` proves a program carries the term and
 *  the registry's readback proves it is being fed; only driving the gain to
 *  zero and diffing two otherwise identical frames proves it does anything.
 *
 *  THE OVERRIDES ARE STICKY ON PURPOSE, AND LEARNING THAT COST TIME.
 *  The first version wrote straight into the tune uniform and assumed freezing
 *  the sim was enough. It is not: a frozen sim still renders, and a caller's
 *  per-frame day/night ramp reassigns that uniform on every rendered frame. So
 *  a poke lasted one frame, the handle read back the ramp's value, and two
 *  captures at gain 0 and gain 1 differed only by animated grain. The one
 *  instrument that exists to prove the term changes pixels was itself gated
 *  off — the same failure, happening to the detector instead of to the feature.
 *
 *  So `gain` and `spec` are an OVERRIDE RECORD the caller's ramp has to honour
 *  (`tune.x = override.gain ?? ramp()`), and passing null returns control. A
 *  debug knob that outlives its frame is the honest version of the trade, and
 *  it says so in the readback: `gainOverride` is non-null exactly when a
 *  capture is not showing shipping behaviour.
 *
 *  These install nothing. They return five functions; where they are hung —
 *  `window`, a devtools panel, a harness's own object — is the caller's.
 */

/** The sticky overrides. The caller's per-frame ramp must read these. */
export interface LineStripOverride {
  gain: number | null;
  spec: number | null;
}

export interface LineStripDebugHost {
  uni: ReturnType<typeof lineStripUniforms>;
  counters: LineStripCounters;
  override: LineStripOverride;
  /** The pick. `debug()` is folded into the readback; `legacy` is toggled. */
  registry: { debug(): Record<string, unknown>; legacy: boolean };
  /** Anything else the caller wants in the readback — its ramp's own state. */
  extra?: () => Record<string, unknown>;
}

export interface LineStripDebug {
  /** Everything known about the term this frame, as one object. */
  lineLight(): Record<string, unknown>;
  /** Sticky gain override. A number sets it, null returns control, undefined reads. */
  lineGain(g?: number | null): number;
  /**
   * The SPECULAR HALF ALONE. The stretched highlight beside a strip is what
   * says "this surface is being lit" rather than "this surface is glowing", and
   * without this there is no way to say which of the two halves is missing.
   */
  lineSpec(g?: number | null): number;
  /**
   * The area-source coefficients, swept rather than rebuilt. wrap 0 is the
   * closest-point cosine, which is a hard zero on any convex receiver; standoff
   * 0 puts the source back flush with the surface it is mounted on. Both exist
   * so the two claims the shader makes can be checked separately instead of
   * believed together.
   */
  lineWrap(wrap?: number, standoff?: number): number[];
  /** Swap the screen-space pick for the world-space one without a reload. */
  linePick(mode?: string): string;
}

export function lineStripDebug(host: LineStripDebugHost): LineStripDebug {
  const { uni, override, registry } = host;
  return {
    lineLight: () => ({
      ...host.counters, ...registry.debug(),
      gain: uni.TUNE.value.x, gainOverride: override.gain,
      spec: uni.TUNE.value.w, specOverride: override.spec,
      ...(host.extra ? host.extra() : {}),
    }),
    lineGain: (g?: number | null) => {
      if (typeof g === 'number') { override.gain = g; uni.TUNE.value.x = g; }
      else if (g === null) override.gain = null;
      return uni.TUNE.value.x;
    },
    lineSpec: (g?: number | null) => {
      if (typeof g === 'number') { override.spec = g; uni.TUNE.value.w = g; }
      else if (g === null) override.spec = null;
      return uni.TUNE.value.w;
    },
    lineWrap: (wrap?: number, standoff?: number) => {
      if (typeof wrap === 'number') uni.SOFT.value.x = wrap;
      if (typeof standoff === 'number') uni.SOFT.value.y = standoff;
      return uni.SOFT.value.toArray();
    },
    linePick: (mode?: string) => {
      if (mode === 'legacy') registry.legacy = true;
      else if (mode === 'frame') registry.legacy = false;
      return registry.legacy ? 'legacy' : 'frame';
    },
  };
}
