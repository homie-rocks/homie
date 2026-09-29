/**
 * ============================================================================
 *  umbra — emissive that is only spent where the key light is not.
 * ============================================================================
 *
 * PUBLISHED FROM A SPACE RACER, NOT DE-DUPLICATED. The kart racer never had
 * this; nothing was removed from a second copy. It is here because it is a good
 * thing and the next machine, creature or sign somebody builds should be able
 * to glow honestly without rediscovering where the signal comes from.
 *
 * ## What it is
 *
 * Two independent injections and the GLSL they share:
 *
 *  · `addThermalGate` — scale a material's emissive by whether the scene's key
 *    light is down. A radiator, a cooling fin, a heat sink, a bioluminescent
 *    anything: things that are only bright when nothing brighter is on them.
 *  · `addThermalForm` — stop a uniform emissive from deleting the form of the
 *    object carrying it. This is the one that is easy to skip and it is the one
 *    that decides whether a glowing part reads as hardware or as a UI icon.
 *
 * ## WHERE THE SIGNAL COMES FROM, and why nothing has to publish it
 *
 * This is the part worth carrying to another game. `WebGLLights` uploads every
 * directional light's `color` PRE-MULTIPLIED BY ITS INTENSITY, so a rig that
 * drives its key's intensity to zero — behind a planet, under a roof, at night
 * — has already put that fact in the fragment shader of every lit material in
 * the scene, for free. No system publishes a uniform, no material subscribes to
 * one, and there is no cache of a fact to go stale: the shader asks the lights
 * it is being shaded by, every fragment, and a cache of a fact is exactly the
 * thing that goes stale.
 *
 * Taking the MAX over the array rather than reading index 0 is deliberate and
 * it is what makes this safe to hand to a rig this package has never seen. A
 * game's light ordering is its own business and is usually documented as an
 * invariant rather than guaranteed by anything; the max cannot be broken by a
 * future light being inserted, and a fill is orders of magnitude under a key in
 * every rig either racer has built.
 *
 * ## Which numbers are here and which are the caller's
 *
 * `floor` is the caller's, because "how much of this survives in daylight" is a
 * property of the fitting: a hot radiator in sunlight is still a hot radiator
 * and keeps a little, a dedicated sink strip whose whole job is to say "we are
 * in the shadow now" keeps none.
 *
 * The 0.25 → 1.40 ramp, the 0.52 face bank and the 1.10 rim gain stay. Each is
 * argued at its own definition below from a measurement rather than chosen by
 * eye, and none of them is a look a second game would want to move without
 * redoing that measurement — at which point it is a different function, not a
 * parameter.
 * ============================================================================
 */
import * as THREE from 'three';
import { chainPatch } from './chainpatch.js';

/**
 * `@homie-rocks/noise`'s `smoothstep`, copied rather than imported.
 *
 * `canvastex.ts` in this package has the long version of why: reaching across
 * to a same-named helper in another package is how a change that claims to move
 * nothing recomputes every texel in two games. The body here is that function's
 * body character for character, and `thermalTier` is the only caller — it
 * passes constant edges, so the `|| 1e-6` divide guard can never fire and the
 * two spellings agree on every input this file can produce.
 */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * The emissive tier ladder, as a function of thermal load.
 *
 * Shared by the radiator fins and the dorsal sink strips so the two can never
 * disagree about what 80 % heat looks like — they are the same cooling system
 * and a rack that lit before its own sink strips would read as two unrelated
 * effects bolted to one hull.
 *
 *   < 0.30        nothing. A cool ship contributes ZERO to the emissive
 *                 budget, which is what keeps the grid frame and the first
 *                 sector inside the 4.5 %-above-luma-1.0 limit.
 *   0.30 – 0.62   tier 0 (0.15–0.55), "informational". Present, never blooms.
 *   0.62 – 0.86   climbing to tier 2's 2.4, "structural".
 *   0.86 – 1.00   to 3.2, the floor of tier 3. Thermal-trip territory.
 */
export function thermalTier(k: number): number {
  return smoothstep(0.30, 0.62, k) * 0.55
    + smoothstep(0.58, 0.86, k) * 1.85
    + smoothstep(0.86, 1.00, k) * 0.80;
}

/*
 * ===========================================================================
 *  THE UMBRA GATE — the design's "single best idea", as fourteen lines of GLSL.
 * ===========================================================================
 *  The space racer's design has HEAT as the combat resource *radiated away
 *  only in shadow*, and calls that its single best idea because it turns the
 *  lighting design into the systems design. It is also one of exactly three
 *  things a frame may point at to prove the game is doing something no
 *  shipped racer does.
 *
 *  An early review's eclipse frames contained no thermal emissive at all — the
 *  idea existed as a HUD bar and as that game's radiator temper, which never
 *  fired. A HUD bar is precisely the "design document promising it" failure.
 *
 *  WHERE THE SIGNAL COMES FROM, without a contract change.
 *
 *  The space racer's `Sky.ts` drives `sun.intensity = STAR_INTENSITY * solar`
 *  and takes the key to zero inside the shadow cone — its own comment calls it
 *  "a hard cut over the 6 m penumbra … one to three frames". `WebGLLights`
 *  uploads every directional light's `color` PRE-MULTIPLIED BY ITS INTENSITY,
 *  so the baked `solar` channel is already sitting in the fragment shader of
 *  every lit material in the scene, for free, and no system has to publish
 *  anything.
 *
 *  Taking the MAX over the array rather than reading index 0 is deliberate:
 *  the rig is a cascade stack plus a planet fill and `Sky.ts` documents the
 *  ordering as an invariant rather than a guarantee. The fill is 0.85 at
 *  `#4a6f96` (luminance ~0.14) against the key's 5.6 at `#e8eeff` (~4.8), so
 *  the max is the key by a factor of thirty-four whatever order they arrive
 *  in, and the gate cannot be broken by a future light being inserted.
 * ===========================================================================
 */
export const UMBRA_GATE_GLSL = [
  'float umbraGate() {',
  '#if NUM_DIR_LIGHTS > 0',
  '  float key = 0.0;',
  '  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {',
  '    key = max( key, dot( directionalLights[ i ].color, vec3( 0.2126, 0.7152, 0.0722 ) ) );',
  '  }',
  // 0.25 → 1.40 rather than a step: the eclipse penumbra is 6 m, which is 0.04
  // s at race pace, so this is already a snap in time. Ramping it in VALUE
  // instead means the terminator break shows the panels dying across the width
  // of one ship rather than switching between two frames.
  '  return 1.0 - smoothstep( 0.25, 1.40, key );',
  '#else',
  '  return 1.0;',
  '#endif',
  '}',
].join('\n');

/**
 * Gate a material's emissive on the key being down.
 *
 * Multiplies `totalEmissiveRadiance` rather than replacing it, so whatever CPU
 * side set the emissive (a temper ramp, a sink strip's own channel) stays in
 * charge of the VALUE and this only ever decides whether it is being spent.
 *
 * `floor` is what survives in daylight. Radiators keep a little (a hot radiator
 * in sunlight is still a hot radiator; it is just out-competed by a
 * 5.6-intensity key) and dedicated sink strips keep none, because those are the
 * ones whose whole job is to say "we are in the shadow now".
 *
 * Cost: N dots and a smoothstep, once per fragment, on the materials it is
 * applied to.
 */
export function addThermalGate(m: THREE.MeshStandardMaterial, floor: number): void {
  const uFloor = { value: floor };
  chainPatch(m, `umbra${floor.toFixed(3)}`, (shader) => {
    shader.uniforms.uUmbraFloor = uFloor;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uUmbraFloor;\n${UMBRA_GATE_GLSL}\nvoid main() {`)
      .replace(
        '#include <lights_fragment_begin>',
        [
          'totalEmissiveRadiance *= mix( uUmbraFloor, 1.0, umbraGate() );',
          '#include <lights_fragment_begin>',
        ].join('\n'),
      );
  });
}

/*
 * ===========================================================================
 *  THERMAL FORM — why a correct emissive still rendered as a UI icon.
 * ===========================================================================
 *  A review's umbra frames reduced every machine to "four flat unshaded
 *  coloured quads … no gradient across their surface, no thickness, no chamfer
 *  specular … they read as UI icons placed in world space", and the temper ramp
 *  is not what is wrong. The parts are real geometry with real chamfers; the
 *  problem is that a UNIFORM emissive is the one shading model that deletes
 *  form. `totalEmissiveRadiance` does not care which way a surface faces, so a
 *  rack of five 14 mm blades at tier 2.4 returns the same value on every
 *  fragment of every blade and rasterises as one filled parallelogram. The
 *  chamfers are there. Nothing distinguishes them.
 *
 *  A hot foil is not a uniform emitter either, and the reason is worth stating
 *  because it is what this term models. A radiator stack is a CAVITY: each
 *  blade's face radiates into the blade beside it and most of that comes
 *  straight back, while the rims see open space and are the only part actually
 *  losing heat to the sky. So the rims are the bright part and the faces are
 *  banked — which is exactly the read that makes a stack of foils legible AS a
 *  stack rather than as a slab, and it is the same term that finds the 0.16 m
 *  fin steps on the dorsal sink strips.
 *
 *  Face-on the emissive is banked to 0.52 and the part keeps a lit face and a
 *  shadowed face (the metal underneath is at metalness 0.92 / roughness 0.26
 *  and was simply being swamped). Grazing it reaches 1.62x, so every chamfer on
 *  every fin carries a line. The mean over a convex part is close to 1, so the
 *  emissive ladder and the histogram check see the same total they did — this
 *  redistributes the budget onto the edges rather than spending more of it.
 *
 *  THE RIM GAIN IS 1.10 AND IT IS BOUNDED BY THE EMISSIVE LADDER, not chosen by
 *  eye. The fins top out at `thermalTier` = 3.2, so a peak of 1.62 puts the
 *  hottest rim in the game at 5.2 — under the engine core's 6.5, which the
 *  space racer's `setRadiatorHeat` is explicit about: "a radiator that
 *  out-glowed the plume lighting it would invert the read of the whole
 *  machine". Anything above ~1.55 here crosses that, and it crosses it on the
 *  fragments most likely to bloom.
 *
 *  Cost: one normalize, one dot, one pow — ~8 ALU on the materials it is on.
 * ===========================================================================
 */
export function addThermalForm(m: THREE.MeshStandardMaterial): void {
  chainPatch(m, 'thermform1', (shader) => {
    // At `<lights_fragment_begin>` both `normal` (mapped) and `vViewPosition`
    // are live and `totalEmissiveRadiance` has been fully resolved by whatever
    // set it — the CPU-side temper on the fins, the in-shader channel ramp on
    // the skin. This scales that, it never replaces it.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      [
        '{',
        '  float tfNdv = clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 );',
        '  float tfRim = pow( 1.0 - tfNdv, 2.6 );',
        '  totalEmissiveRadiance *= mix( 0.52, 1.0, tfNdv ) + tfRim * 1.10;',
        '}',
        '#include <lights_fragment_begin>',
      ].join('\n'),
    );
  });
}
