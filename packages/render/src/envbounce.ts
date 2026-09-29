/**
 * ============================================================================
 *  envbounce — a MIRROR STANDING ON LIT GROUND UNDER A DARK SKY.
 * ============================================================================
 *  A `metalness = 1.0` surface has NO diffuse term, so every photon it shows
 *  the camera came out of the environment probe. Put one outdoors under a sky
 *  that is genuinely black — an airless world, a night, a hangar, a cave — and
 *  the probe's upper hemisphere really is black, so the surface renders BLACK,
 *  correctly, and looks broken. Nothing about the material is wrong; there is
 *  nothing in the world for it to reflect.
 *
 *  This shapes what the probe gives back, in the one place it can be shaped:
 *  inside `getIBLRadiance`. Six terms, and each is here because the one before
 *  it was measured and found insufficient.
 *
 *  1. A KNIFE-EDGE TERMINATOR that WIDENS WITH ROUGHNESS. The step between a
 *     black sky and lit ground is the single most distinctive thing a
 *     mirror-finish body does outdoors, and it is what separates a polished
 *     panel from a satin one on the same object. A terminator wider than the
 *     range of `reflectVec.y` the object spans turns the whole thing into one
 *     linear ramp with no discontinuity anywhere, which reads as painted
 *     masonry rather than as metal.
 *  2. A FLOOR, AND IT IS A FLOOR AND NOT AN OVERRIDE. `max(env, col)` with
 *     `col` authored above the probe's real ground radiance is not a floor, it
 *     is a repaint: it wins on every fragment below the horizon and replaces
 *     the photograph with a smooth analytic function of azimuth — a cosine,
 *     i.e. a Lambertian cylinder. That shipped, four consecutive reviews
 *     described the symptom correctly, and four fixes in a row went to
 *     adjacent terms because a comment here said this one was harmless. AN
 *     ASSERTION THAT A max() IS HARMLESS IS A CLAIM ABOUT THE RELATIVE
 *     MAGNITUDE OF TWO QUANTITIES, and it has to be measured, not reasoned.
 *  3. THE FLOOR IS SCALED BY THE PROBE, not constant. A fixed daytime colour is
 *     a cheat that does not know what time it is: it keeps the object glowing
 *     at full daylight value all night while the rest of the frame goes black,
 *     which is worse than the bug it fixes. So it samples the probe's own lower
 *     hemisphere (`textureCubeUV` at roughness 1.0 straight down is the top
 *     mip, i.e. the average of everything below) and normalises against
 *     `refLum` — a FITTED denominator, the caller's, measured under that
 *     world's own key rig. The authored colours are therefore GAINS ON THE REAL
 *     SCENE rather than typed radiances: at full key the ratio is ~1 and the
 *     look is the one tuned by eye, at night it collapses on its own, and if
 *     somebody re-grades the ground the surface follows it for free.
 *  4. TWO AZIMUTHAL TERMS, BROAD AND NARROW, AND BOTH ARE NEEDED. The first
 *     attempt supplied only the narrow lobe and MEASURED beautifully — a
 *     contrast range six times wider — while looking worse, because a peak is
 *     not a shape: at any distance a two-pixel highlight on a darker object
 *     just reads as a darker object. The broad term is a plain cosine wrap from
 *     the key's bearing and it is the honest one — the ground really is
 *     brighter on the lit side — and it is what makes the body read as round.
 *  5. WHERE THE NARROW MERIDIAN LANDS IS NOT TUNABLE AND MUST NOT BE "FIXED".
 *     On a cylinder, reflection azimuth runs at TWICE surface azimuth, so the
 *     meridian sits at half the angle between the camera's bearing and the
 *     key's: key behind the camera puts it dead centre, key opposite pushes it
 *     to the limb. That is correct behaviour, which is why term 4 carries the
 *     frame. It is evaluated on the AZIMUTH of the reflection vector alone, so
 *     it is a true vertical meridian that does not slide or vanish as the
 *     camera rises and is identical at 40 m and at 400 m — one fix for a
 *     close-up and a wide shot both.
 *  6. A HEIGHT-ABOVE-BASE GATE, IN METRES, ON THE BAND GAIN. See `band0`.
 *
 *  ── WHY THIS DOES NOT ROUTE THROUGH `MaterialEnv.patchEnvRadiance` ──────────
 *  That composer INSERTS ahead of the radiance return and accumulates snippets
 *  so two patches on one material cannot fight. This one substitutes a modified
 *  copy of the WHOLE chunk and RETURNS FROM INSIDE IT, because term 6's night
 *  cap has to act on `envMapColor * envMapIntensity` — the value after the
 *  return's own multiply — which an insert-only composer cannot express.
 *  THEREFORE: a material may carry `injectGroundBounce` OR the `MaterialEnv`
 *  injections, never both. The second one to run finds the include already
 *  gone and silently does nothing, which is a no-op with no error anywhere.
 *
 *  `onBeforeCompile` runs BEFORE three resolves `#include`, so substituting the
 *  chunk is the only way to reach inside `getIBLRadiance` at all. If a future
 *  three renames the return statement the patch is skipped LOUDLY and the
 *  material still compiles and renders — dimmer, but never broken.
 *
 *  ── THE `mb` PREFIX ON EVERY IDENTIFIER IN THE SHADER ───────────────────────
 *  It is a leftover from the game this arrived from and it is kept ON PURPOSE.
 *  Unlike a JavaScript name, these survive into the final shader text, so
 *  renaming them is a shader-text change — which is somebody's own commit with
 *  its own before-and-after, not a tidy-up smuggled in beside a move. The same
 *  call was made about `MB_` guard tokens in `LineLight.ts`.
 *
 *  EVERY COLOUR AND EVERY NUMBER IS THE CALLER'S, including `refLum`, which is
 *  fitted against one world's key rig and means nothing in another.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

const _sunV = new THREE.Vector3();

export interface GroundBounceOpts {
  /** Near, brightly lit ground directly under the object. */
  ground: number;
  /** Distant ground at grazing incidence, just below the reflected horizon. */
  horizon: number;
  /** Cold floor for the SKY half, so the upper body never crushes to black. */
  sky: number;
  /** Blend weight of the whole ground floor, 0..1. */
  amount: number;
  /** Terminator half-width in reflectVec.y for a MIRROR band. Small = knife edge. */
  soft: number;
  /** Extra terminator half-width per unit roughness². The anisotropy knob. */
  aniso: number;
  /** reflectVec.y depth at which the band reaches full ground value. */
  depth: number;
  /** Colour of the narrow meridian lobe. */
  glare: number;
  glareAmount: number;
  glareTight: number;
  /** Floor of the keyward/leeward wrap, 0..1. */
  wrapMin: number;
  /**
   * Luminance of the probe's lower hemisphere under this world's KEY rig — the
   * denominator that turns the colours above into gains on the real scene
   * rather than typed radiances. See term 3.
   *
   * IT IS FITTED AND IT IS NOT PORTABLE. Fit it by tuning the colours by eye
   * with no normalisation at all, then choosing the denominator that leaves
   * that frame unchanged; re-FIT it rather than re-scaling it if the key
   * intensity or the ground albedo move, because it is a number fitted at one
   * scale and a number fitted at one scale is not a number at another.
   */
  refLum: number;
  /**
   * MULTIPLICATIVE gain on the reflected ground, at full band depth.
   *
   * 0 means "show the probe exactly as photographed". Above 0 it buys a
   * readable ground-bounce band without flattening it: a gain keeps every edge,
   * every reflected object and the whole reflected terminator that the probe
   * put inside the band, where an additive floor deletes them all and replaces
   * them with a constant. That is the difference between "the bottom of the
   * body is bright" and "the bottom of the body is a bright smooth card".
   */
  gain: number;
  /**
   * THE BAND, IN METRES UP THE OBJECT. Full strength at or below `band0`, gone
   * by `band1`. Together with `bandGain`, and `bandGain = 0` disables it.
   *
   * ── WHY THE BAND NEEDS A SECOND GATE, AND IT IS A MEASURED REGRESSION ──────
   * Every other band term here — `soft`, `depth`, and the ramps they drive — is
   * authored in units of `reflectVec.y`, and ON A VERTICAL CYLINDER THAT IS NOT
   * A PROPERTY OF THE OBJECT AT ALL:
   *
   *     N is horizontal, so reflect(I,N) leaves I.y untouched, so
   *     reflectVec.y == sin(elevation of the eye->fragment ray).
   *
   * Two consequences. The reflected horizon sits at THE CAMERA'S OWN EYE
   * HEIGHT — not at a fixed place on the object, wherever the camera happens to
   * be. And the RANGE of reflectVec.y the object spans is its angular size,
   * which collapses with distance. A set of numbers fitted at one framing and
   * shipped to framings that differ several-fold in that one quantity holds at
   * the pose it was fitted on and inverts at the others; that shipped, and it
   * was diagnosed as a lighting bug for a while.
   *
   * `band0`/`band1` are the same gate written in the one unit that does not
   * move: height above the object's own origin. The two claims are SUMMED and
   * not `max`ed, because they are different claims — one about the reflection,
   * one about the object — and a framing that has both should show both.
   *
   * (The physically-motivated repair, proxy-geometry parallax aiming the fetch
   * by PROBE_HEIGHT / height, was implemented, shipped behind an ablatable
   * uniform, and MEASURED: it COST 20 display counts at the close pose and did
   * nothing at the far one, because it aims the band at a probe band that is
   * brighter in the mean but not at the azimuths the surface actually looks
   * along. Correct physics, no picture. Removed rather than kept as a
   * decoration, because a term nothing can see is one the next person has to
   * disprove again.)
   */
  band0?: number;
  band1?: number;
  /** Multiplicative gain at full band, ADDED to `gain`'s camera-driven part. */
  bandGain?: number;
}

/**
 * Every material `injectGroundBounce` has patched, so `syncGroundBounceSun` has
 * one list to point at the key instead of a hard-coded set of names.
 *
 * ── WHY A REGISTRY AND NOT A NAMED SET, AND IT IS A MEASURED BUG ─────────────
 * The first version iterated one object's four materials by name. That is fine
 * while one file is the only caller, and it silently leaves any OTHER patched
 * material holding its first-frame default bearing — the one bearing guaranteed
 * wrong. The moment a second object got the same response, the list had to be
 * the set of things that were actually patched.
 *
 * It also holds DUPLICATES BY CONSTRUCTION and that is correct: a scene with
 * two of the same vehicle has two of every one of its materials, because the
 * material builder runs per vehicle. Anything that reaches for "the steel
 * material" by name gets one of them and reports its result as the fleet's.
 */
const _bounced: THREE.Material[] = [];
/** The scene's key light, cached across frames. See syncGroundBounceSun. */
let _sunLight: THREE.DirectionalLight | null = null;


export function injectGroundBounce(mat: THREE.Material, o: GroundBounceOpts): void {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)['envmap_physical_pars_fragment'];
  const TARGET = 'return envMapColor.rgb * envMapIntensity;';
  if (!chunk || chunk.indexOf(TARGET) < 0) {
    // Loud, because the silent version of this is a hull with no ground bounce
    // at all and no error anywhere — three renames a chunk and the hero asset
    // quietly reverts all of this work with no error in the console.
    console.warn('[envbounce] envmap_physical_pars_fragment does not match the text this module '
      + 'patches (three upgrade?). The ground-bounce response is NOT installed.');
    return;
  }
  const patched = chunk.replace(
    TARGET,
    /* glsl */ `
			vec3 mbDown = textureCubeUV( envMap, envMapRotation * vec3( 0.0, -1.0, 0.0 ), 1.0 ).rgb;
			float mbLit = clamp( dot( mbDown, vec3( 0.2126, 0.7152, 0.0722 ) ) / uMbRef, 0.0, 1.35 );
			float mbHoriz = length( reflectVec.xz );
			vec2 mbAz = reflectVec.xz / max( mbHoriz, 1e-4 );
			float mbFacing = dot( mbAz, uMbSun.xy );
			float mbSide = mix( uMbHorizon.w, 1.0, mbFacing * 0.5 + 0.5 );
			// ── HEIGHT ABOVE THE VEHICLE'S BASE. ───────────────────────
			// The one quantity in this whole function that belongs to the SHIP and
			// not to the camera. reflectVec.y does not: on a vertical cylinder the
			// normal is horizontal, so reflect() leaves the incident ray's y alone
			// and reflectVec.y is exactly sin(elevation of the eye->fragment ray).
			// Every band term below used to be gated on it alone, which is why
			// the earlier tuning held at padClose and inverted at the other four
			// poses. See GroundBounceOpts.band0 for the measured table.
			float mbUp = max( vMbUp, 0.0 );
			float mbBelow = -reflectVec.y;
			// ROLLING ANISOTROPY. The grain of rolled plate runs circumferentially,
			// so its microfacets scatter in ELEVATION and hardly at all in azimuth:
			// the reflected horizon smears VERTICALLY, by an amount set by the local
			// roughness band. Squared because the smear goes with the lobe's
			// variance, not its width, which is what keeps the mirror bands mirrors.
			float mbAniso = roughness * roughness * uMbAniso;
			float mbSoft = uMbSoft + mbAniso;
			// THE KNIFE EDGE. Black sky above, lit regolith below, and the step
			// between them is the single most distinctive thing a mirror-finish
			// cylinder does on an airless world. It was a 0.43-wide smoothstep in
			// an early version, i.e. wider than the entire range reflectVec.y covers on a
			// 50 m barrel, which turned the whole hull into one linear ramp with no
			// discontinuity anywhere — measured 64..93 luma, top to bottom, and it
			// is why the hull read as painted masonry instead of steel.
			float mbGnd = smoothstep( -mbSoft, mbSoft, mbBelow );
			// Below the horizon the reflection sweeps from far regolith at grazing
			// (dim) to the brilliantly lit pad directly underfoot, over a SHORT
			// depth, which is what puts the bright band in the bottom third rather
			// than spreading it over the whole ship. Widened by the same anisotropy
			// term so the band itself is striped, not smooth.
			float mbDeep = smoothstep( 0.0, uMbDepth + mbAniso * 2.2, mbBelow );
			// And the band's OWN brightness stripes with the same roughness, which
			// is not a cheat but the sign the physics gives: a wider lobe on an
			// environment that is half black sky integrates more black, so the
			// satin stripes of the coil come back darker than the mirror stripes
			// beside them. Terminator width alone did not read — measured on the
			// padClose barrel, where reflectVec.y is far enough below the horizon
			// that every band saturates the ramp and the streaks vanished. The
			// amplitude is authored; the direction is not.
			float mbBand = mix( 1.10, 0.84, smoothstep( 0.16, 0.34, roughness ) );
			// ── EVERYTHING BELOW IS AUTHORED IN *FINAL* RADIANCE ────────────────
			// The chunk's last line multiplies by envMapIntensity, so every term
			// written here used to be scaled by it too — which meant the hull's
			// brightness knob and the size of its cheat were the same knob, and
			// turning the probe up turned the cheat up with it by exactly as
			// much. Dividing by envMapIntensity here makes the floor and the
			// glare mean what they say: a floor of 0.11 is 0.11 of scene-linear
			// radiance whatever the probe is being read at. The rule this follows:
			// — a number fitted at one scale is not a number at another; this is
			// the fix that stops the scale moving underneath them.
			float mbInv = 1.0 / max( envMapIntensity, 1e-4 );
			// ── (1) A FLOOR, NOT AN OVERRIDE. THE ROUND-8 FIX. ──────────────────
			// MEASURED on the frozen padClose barrel (row y=650, x 910..1010, the
			// bare hull between the door and the raceway), by poking the compiled
			// uniform through renderer.properties so nothing recompiles:
			//
			//   base                                   luma mean 115.0
			//   uMbGround.w -> 0 (this floor removed)   luma mean  38.4
			//   envMapIntensity -> 0                    luma mean  15.7
			//
			// So the ANALYTIC FLOOR WAS 67% OF THE HULL and the actual photograph
			// of the actual world was 33% of it. 'mix(env, max(env, mbCol), 1.0)'
			// is 'max(env, mbCol)', and with mbCol two to three times the probe's
			// real ground radiance it won on every fragment below the horizon —
			// so the hull showed a smooth analytic function of azimuth and NOTHING
			// the probe held. That function is a cosine in 'mbSide', which is
			// precisely what a materials review measured across the hull
			// and correctly called "a Lambertian cylinder": 140 px of monotone
			// ramp, 236 at the left limb to 96 at centre, no high-frequency
			// feature in it. It was not a lighting bug. It was this max().
			//
			// It is now a genuine floor: authored two to three stops UNDER the
			// probe's lit-daylight ground, so it can only act where the probe is
			// genuinely dark, and the picture on the hull is the probe's.
			vec3 mbCol = mix( uMbHorizon.rgb, uMbGround.rgb, mbDeep ) * ( mbLit * mbSide * mbBand * mbInv );
			envMapColor.rgb = max( envMapColor.rgb, mbCol * ( mbGnd * uMbGround.w ) );
			// The sky half keeps whatever the probe holds — black, stars, and the
			// Earth disc, which is the reflection worth having — with only a cold
			// earthshine floor under it. The art direction: never pure #000, and
			// the darkest value permitted in frame is the shadow floor.
			envMapColor.rgb = max( envMapColor.rgb, uMbSkyCol.rgb * ( mbLit * mbInv * ( 1.0 - mbGnd ) ) );
			// Night hull. Mid-barrel at the hero camera reflects GROUND
			// (elevated eye, horizontal N), so a sky-half-only mix left
			// r23ck identical to r23cj (B/R 2.65). Desaturate the whole
			// fetch toward steel and lift a stop. Hull only. uMbBand.w = night.
			{
				float mbN = clamp( uMbBand.w, 0.0, 1.0 );
				float mbY = dot( envMapColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
				vec3 mbSteel = vec3( mbY ) * vec3( 1.06, 1.05, 1.00 );
				envMapColor.rgb = mix( envMapColor.rgb, mbSteel, mbN * 0.82 );
				// Lift the DARK face more than the already-hot limb
				// (r23cw / r23da right ship was a lamp). mbNeed is 0
				// on bright steel and ~0.16 on a navy hole. Do not
				// raise uMbBand.z — that is the lamp.
				float mbNeed = clamp( 0.22 - mbY, 0.0, 0.22 );
				envMapColor.rgb += vec3( 0.78, 0.80, 0.74 ) * ( mbN * mbNeed );
			}
			// ── (2) THE GROUND-BOUNCE BAND, AS A GAIN AND NOT AS A REPLACEMENT ──
			// The art direction asks for "a brilliant ground-bounce band along
			// the bottom". The honest radiance of 0.11-albedo regolith under an
			// 11 degree sun does not deliver one, and §0 authorises departing from
			// the physics to match the reference's READABILITY. So it is bought
			// here — but MULTIPLICATIVELY. A gain brightens the band while keeping
			// every edge, every reflected dome and the whole reflected terminator
			// that the probe put inside it; the old additive floor deleted them
			// all and replaced them with a constant. This is the difference
			// between "the bottom of the hull is bright" and "the bottom of the
			// hull is a bright smooth card".
			//
			// ── THE GATE IS ALSO WRITTEN IN METRES UP THE HULL ──
			// mbDeep is the camera's answer to "how far into the ground half is
			// this fragment", and on the shot set it ranges from 1.0 at padClose
			// to 0.1 at street for the SAME 8 m of hull. mbLow is the same
			// question asked of the ship instead of the lens. Summed, not
			// max()ed: the two are different claims (one about the reflection,
			// one about the vehicle) and a framing that has both should show
			// both. uMbBand.z = 0 is the earlier behaviour, exactly.
			float mbLow = 1.0 - smoothstep( uMbBand.x, uMbBand.y, mbUp );
			envMapColor.rgb *= 1.0
				+ ( uMbGain * mbDeep + uMbBand.z * mbLow ) * ( mbGnd * mbLit * mbBand );
			float mbTight = uMbSun.z / ( 1.0 + roughness * 9.0 );
			float mbGlare = pow( max( mbFacing, 0.0 ), mbTight ) * mbHoriz;
			envMapColor.rgb += uMbGlareCol.rgb * ( mbGlare * mbLit * mbInv * uMbSun.w / ( 1.0 + roughness * 3.0 ) );
			// Night: pad-flood IBL * env 10.4 was crossing the 1.35 bloom
			// gate and the right ship became a tube (r23dc). Cap the
			// hull under that gate. Face-first lift already ran, so
			// the dark flank stays steel. Not bandGain.
			{
				vec3 mbOut = envMapColor.rgb * envMapIntensity;
				float mbN = clamp( uMbBand.w, 0.0, 1.0 );
				float mbY2 = dot( mbOut, vec3( 0.2126, 0.7152, 0.0722 ) );
				// 0.98 still left three hulls sitting in the
				// apron pool (r23il). 0.86 stays steel, under
				// bloom, and stops the cylinders lighting the
				// slab they stand on.
				float mbCap = mix( 100.0, 0.42, mbN );
				mbOut *= mbY2 > 1e-4 ? min( 1.0, mbCap / mbY2 ) : 1.0;
				return mbOut;
			}`
  );
  // NO convertSRGBToLinear here. three's ColorManagement is enabled, so
  // `new THREE.Color(hex)` has ALREADY decoded the sRGB literal into the
  // linear-sRGB working space. Calling convertSRGBToLinear on top of that
  // applies the transfer function a second time and lands the value at 62% of
  // what was authored — MEASURED: 0xd8cfc0 arrived at the GPU as linear 0.429
  // instead of 0.687. It is invisible as a bug because the result is merely
  // "a bit dark", which is indistinguishable from a tuning choice.
  const g = new THREE.Color(o.ground);
  const h = new THREE.Color(o.horizon);
  const sk = new THREE.Color(o.sky);
  const gl = new THREE.Color(o.glare);
  // ONE Vector4 instance, created here and shared by every program three
  // compiles from this material, so `syncSunBearing` has a single object to
  // write and no way to update a stale copy. Seeded with a real bearing rather
  // than (0,0): the shader normalises against it on the very first frame, and
  // normalising a zero vector is a NaN that would paint the hull black.
  const sun = new THREE.Vector4(1, 0, o.glareTight, o.glareAmount);
  mat.userData.mbSun = sun;
  // ── EVERY UNIFORM, MADE ONCE AND PUBLISHED. ─────────────────────────────────
  // These used to be allocated fresh inside `onBeforeCompile`, which meant two
  // things, both bad. A material three compiles more than once (a shadow
  // variant, a context restore, a depth pre-pass) ended up holding SEVERAL
  // copies of each value with no way to write them all; and nothing outside the
  // shader could read or move any of them, which is why an earlier ablation had
  // to go through `renderer.properties` to poke a compiled program by hand and
  // could only reach one at a time.
  //
  // One object per uniform, created here, referenced by every program: a lab
  // poke to `mat.userData.mb.<name>.value` reaches all of them, at once, with no
  // recompile. That is what makes an A/B of this material possible inside a
  // single page load — which was REQUIRED at the time, because the lighting
  // and the grade were being edited in parallel while it was being measured.
  const mb = {
    uMbGround: { value: new THREE.Vector4(g.r, g.g, g.b, o.amount) },
    uMbHorizon: { value: new THREE.Vector4(h.r, h.g, h.b, o.wrapMin) },
    uMbSkyCol: { value: new THREE.Vector3(sk.r, sk.g, sk.b) },
    uMbGlareCol: { value: new THREE.Vector3(gl.r, gl.g, gl.b) },
    uMbSun: { value: sun },
    uMbSoft: { value: o.soft },
    uMbAniso: { value: o.aniso },
    uMbDepth: { value: o.depth },
    uMbRef: { value: o.refLum },
    uMbGain: { value: o.gain },
    uMbBand: { value: new THREE.Vector4(
      o.band0 ?? 0, o.band1 ?? 1, o.bandGain ?? 0, 0) },
  };
  mat.userData.mb = mb;
  if (_bounced.indexOf(mat) < 0) _bounced.push(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, renderer);
    for (const k of Object.keys(mb)) shader.uniforms[k] = (mb as Record<string, { value: unknown }>)[k]!;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform vec4 uMbGround;\nuniform vec4 uMbHorizon;\nuniform vec3 uMbSkyCol;\nuniform float uMbSoft;\nuniform float uMbAniso;\nuniform float uMbDepth;\nuniform float uMbRef;\nuniform float uMbGain;\nuniform vec3 uMbGlareCol;\nuniform vec4 uMbSun;\nuniform vec4 uMbBand;\nvarying float vMbUp;')
      .replace('#include <envmap_physical_pars_fragment>', patched);
    // ── THE VARYING, AND WHY IT IS OBJECT SPACE AND NOT WORLD SPACE ──────────
    // `vMbUp` is the fragment's height above the VEHICLE'S OWN ORIGIN, which for
    // both callers is the base of the vehicle (the ship's hull mesh is added
    // to the ship group with no offset; the truck's body is extruded from its
    // floor). Object space is not a shortcut here, it is the
    // whole point: a world-space height would need the ship's pad height synced
    // in per frame, would be wrong for the two ships that share a scene, and
    // would put a ground-bounce band on a ship that is 90 m up on final
    // approach — which is precisely the shot where the band has to be at its
    // most brilliant, because the plume is lighting the ground under it.
    //
    // ── AND THE INSTANCING TRAP ──────────────────────────────────────────────
    // three does NOT fold instanceMatrix into `transformed`; <project_vertex>
    // multiplies it into mvPosition only. The ship's flaps, legs, footpads
    // and braces are all InstancedMesh sharing this steel material, and their
    // geometry is authored around their own hinge — so `transformed.y` alone
    // reads ~0 for a flap 30 m up the ship and would hand the flaps the skirt's
    // ground-bounce band. instanceMatrix is what carries them up the hull, so
    // it has to be applied here, and only here: the instance transform of a
    // ship part is IN THE SHIP'S FRAME, which is exactly the frame this
    // varying wants. (For a per-vehicle instanced caller it would not be, which
    // is why `proxy` is opt-in per material rather than on by default.)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMbUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n'
        + '#ifdef USE_INSTANCING\n\tvMbUp = ( instanceMatrix * vec4( transformed, 1.0 ) ).y;\n'
        + '#else\n\tvMbUp = transformed.y;\n#endif');
  };
  const inner = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => 'mbGBd' + o.ground + '_' + o.amount + (inner ? inner() : '');
  mat.needsUpdate = true;
}

/**
 * Point every patched material's glare lobe at the key light's current BEARING.
 *
 * The light is found BY NAME off the scene rather than passed in, because the
 * lighting rig and the surfaces are routinely authored in parallel by different
 * people and a compile-time edge between them is a seam neither side owns. The
 * direction is taken as `position - target.position` and NOT as `position`
 * alone: a rig that snaps its target to the camera — which every large outdoor
 * rig eventually does — makes the position alone meaningless.
 *
 * Silently does nothing if the light is absent. During a night the key is
 * usually still in the scene at intensity 0, and the glare term is gated on the
 * probe's own luminance anyway, so a stale bearing is invisible rather than
 * wrong.
 */
export function syncGroundBounceSun(scene: THREE.Object3D, lightName = 'Sun'): void {
  // CACHED, and this became a real cost rather than a tidiness point the moment
  // there were three callers: `getObjectByName` walks the ENTIRE scene graph,
  // which in a mature colony is thousands of nodes, and it was already running
  // once per ship per frame. Re-looked-up only when the cached light has
  // left the graph (a context restore rebuilds the rig), which is a single
  // parent-chain walk of a few links, not a traverse.
  if (_sunLight !== null) {
    let live = false;
    for (let n: THREE.Object3D | null = _sunLight; n !== null; n = n.parent) if (n === scene) { live = true; break; }
    if (!live) _sunLight = null;
  }
  if (_sunLight === null) {
    const found = scene.getObjectByName(lightName) as THREE.DirectionalLight | undefined;
    if (!found || !(found as unknown as { isDirectionalLight?: boolean }).isDirectionalLight) return;
    _sunLight = found;
  }
  const sun = _sunLight;
  _sunV.copy(sun.position);
  if (sun.target) _sunV.sub(sun.target.position);
  const len = Math.hypot(_sunV.x, _sunV.z);
  // Sun within a few degrees of straight overhead has no bearing worth having.
  // Leave the last good one rather than divide by ~0.
  if (len < 1e-3) return;
  const bx = _sunV.x / len;
  const bz = _sunV.z / len;
  // The registry, not a named set and not `owned`: a material may have been
  // INJECTED by a game's own material code (patched, not owned), there are two
  // of every ship material in a two-ship scene, and a truck's stainless body is
  // in here too.
  for (const m of _bounced) {
    const s = m.userData.mbSun as THREE.Vector4 | undefined;
    if (s) s.set(bx, bz, s.z, s.w);
  }
}