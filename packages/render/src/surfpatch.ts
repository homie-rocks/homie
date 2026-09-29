/**
 * ============================================================================
 *  surfpatch — four injections that read a channel the GEOMETRY carries, and
 *  two that bound what a surface is allowed to present.
 * ============================================================================
 *  These arrived from a hull built out of a hundred lathes, chamfers and
 *  greeble passes welded into one draw call. That is the shape they are for:
 *  once a model is ONE mesh and ONE material, every per-part difference has to
 *  travel as a vertex channel, and every per-part difference that does not
 *  travel is a second material and a second draw call.
 *
 *  Nothing here names a ship, a moon or a metal. What each one knows is:
 *
 *   · `patchVertexSurface` — a three-channel per-vertex attribute driving
 *     roughness, a tint toward a named colour, and a signed albedo gain.
 *   · `patchVColorRough` — roughness from the red channel of vertex colour.
 *   · `patchChromaLimit` — a ceiling on how saturated the presented radiance
 *     may be, for a surface whose albedo is too low to argue with its fill.
 *   · `patchRadianceFloor` — a floor, not a wash, under the presented
 *     radiance, optionally modulated by vertex colour.
 *
 *  EVERY NUMBER AND EVERY COLOUR IS AN ARGUMENT, and that is not a style point.
 *  A tint constant living in here would mean the next model to ask for a heat
 *  soak inherits the first one's alloy, parity would stay green, and the only
 *  symptom would be that two games' metal goes the same colour when it burns.
 *  The mechanism is shared; the look is not.
 *
 *  ALL FOUR CHAIN `onBeforeCompile` BY HAND rather than routing through
 *  `matpatch.patch()`, for the reason `SpecularAA.ts`'s header states at
 *  length: the composer prefixes an incumbent's key with `base:` and joins with
 *  `|`, so adopting it rewrites the program cache key of every material in
 *  every game that already carries one of these. The chaining is written out so
 *  these can be installed alongside a game's own hand-chained patchers in
 *  either order without either side changing.
 *
 *  ORDER IS LOAD-BEARING BETWEEN THE LAST TWO. Both inject ahead of
 *  `<opaque_fragment>`, so the one installed FIRST ends up executing first: a
 *  floor installed before a chroma limit is itself limited, and the other way
 *  round it is not. Whichever a caller wants, it is the install order that says
 *  so, and it deserves a comment at the call site.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

/** Chain onto whatever the material already had, never replace it. */
function chain(mat: THREE.Material, key: string, fn: (sh: any, renderer?: any) => void): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, renderer);
    fn(shader, renderer);
  };
  // Without this three reuses one compiled program for both the patched and the
  // unpatched variant of the same material class and one of them renders wrong.
  const inner = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => key + (inner ? inner() : '');
  mat.needsUpdate = true;
}

export interface VertexSurfaceOpts {
  /** attribute name carrying the three channels. */
  attr?: string;
  /**
   * How hard channel Y drives ROUGHNESS, and whether it does so linearly.
   *
   * SQUARE IT unless there is a reason not to, and the reason is a guard rather
   * than a curve fit. Roughness sets the width of a reflected horizon, so a
   * linear coupling puts a visible softening at the very bottom of the ramp —
   * on the brightest part of the surface — to buy a stain that belongs at the
   * top. Squaring collapses the low end to nearly nothing and leaves the
   * saturated end untouched.
   */
  heatRough: number;
  heatRoughSquared?: boolean;
  /** roughness clamp after the two additions. */
  roughClamp: [number, number];
  /** clamp on the signed albedo gain in channel Z. */
  gainClamp: [number, number];
  /**
   * The RAW LINEAR MULTIPLIER the surface's own albedo is mixed toward at
   * channel Y = 1. A desaturating darkening, never a hue: a stray hue here is
   * what turns a scorched panel into a rainbow.
   *
   * Three floats and NOT a hex, deliberately. A hex would go through
   * `new THREE.Color()`, which with `ColorManagement` enabled decodes sRGB into
   * the linear working space — and these are not a colour, they are a gain
   * already authored in the space the shader multiplies in. Decoding them once
   * more lands them at about 62% of what was written, which is invisible as a
   * bug because the result is merely "a bit darker" and reads as a tuning
   * choice. That exact mistake has been recorded twice before.
   */
  heatTint: [number, number, number];
}

/**
 * A THREE-CHANNEL PER-VERTEX SURFACE HISTORY.
 *
 * The channels, and why three rather than two:
 *
 *   X  a roughness OFFSET. What a part is made of and how it was finished.
 *   Y  a 0..1 soak, driving roughness AND a tint toward `heatTint`. A tint
 *      alone is invisible on anything that is already in its own shadow, which
 *      is exactly where a soak usually lands; scale is what the eye reads on a
 *      fire-scaled surface — the mirror stops, in patches.
 *   Z  a SIGNED albedo gain, and it is the channel that survives to a distant
 *      framing when nothing else does. Proud geometric relief a few millimetres
 *      across anti-aliases into a dashed grey thread and then into nothing, so
 *      a model built with real weld beads, real recesses and real chamfers
 *      presents NONE of them past a certain range and reads as a smooth
 *      cylinder. What a real seam actually presents at that range is not the
 *      bead — it is the band of duller, slightly darker material either side of
 *      it, which is a tone difference and belongs in albedo.
 *
 * The alternative to all three is a texture, and a texture cannot carry
 * "which part is this" on a mesh assembled from a hundred parts into one UV
 * layout. This costs three floats a vertex and no fetch.
 */
export function patchVertexSurface(mat: THREE.Material, o: VertexSurfaceOpts): void {
  const attr = o.attr ?? 'aSurf';
  const t = o.heatTint;
  const heat = o.heatRoughSquared === false ? 'mbHeat' : 'mbHeat * mbHeat';
  chain(mat, 'vsurf' + attr + o.heatRough + '_' + t.join('_'), (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 ${attr};\nvarying vec3 vSurf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurf = ${attr};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurf;')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nfloat mbHeat = clamp( vSurf.y, 0.0, 1.0 );\n'
        + `roughnessFactor = clamp( roughnessFactor + vSurf.x + ${heat} * ${o.heatRough.toFixed(4)}, ${o.roughClamp[0].toFixed(4)}, ${o.roughClamp[1].toFixed(4)} );`
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n'
        + `diffuseColor.rgb *= 1.0 + clamp( vSurf.z, ${o.gainClamp[0].toFixed(4)}, ${o.gainClamp[1].toFixed(4)} );\n`
        + `diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( ${t[0].toFixed(4)}, ${t[1].toFixed(4)}, ${t[2].toFixed(4)} ), clamp( vSurf.y, 0.0, 1.0 ) );`
      );
  });
}

/**
 * Roughness from the RED channel of vertex colour: darker is rougher.
 *
 * `vColor` arrives from either the vertex `color` attribute or from
 * `instanceColor` — three multiplies both into the same varying, so one patch
 * covers a merged field and an instanced one alike. Where a per-element tone
 * already exists, deriving roughness from it gets "two adjacent elements must
 * not share a roughness" for nothing: no second attribute, no second fetch.
 *
 * NOT `matpatch.patchRoughFromVColor`, which takes the tint's LUMINANCE and
 * remaps it through a `fract(bv * 14.0)` jitter to scatter a merged far tier.
 * This one is a straight monotonic read of one channel, and the difference is
 * the whole point: a scatter is for hiding a repeat, a monotonic read is for
 * making a darker element genuinely read as a rougher one. Sharing them would
 * compile and would quietly hand one surface the other's story.
 *
 * The FLOOR matters as much as the gain. Below it a field starts returning the
 * Fresnel sequins a specular-AA term exists to suppress, so it is an argument
 * and it is not optional.
 */
export function patchVColorRough(mat: THREE.Material, gain: number, lo: number, hi: number): void {
  chain(mat, 'vcrough' + gain + '_' + lo + '_' + hi, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\n#ifdef USE_COLOR\nroughnessFactor = clamp( roughnessFactor + ( 1.0 - vColor.r ) * ${gain.toFixed(4)}, ${lo.toFixed(4)}, ${hi.toFixed(4)} );\n#endif`
    );
  });
}

/**
 * A BOUNDED CHROMA CEILING on the presented radiance.
 *
 * For the surface class where a hue reading is not the surface's fault: a very
 * low-albedo material returns almost nothing of its OWN colour, so whatever
 * chroma it shows belongs entirely to the fill light. Every other material in a
 * frame has enough albedo to argue with the light; that one does not, and it
 * renders as a painted panel in the fill's hue while the art direction wants it
 * to read as the darkest thing present.
 *
 * The honest fixes both fail. Desaturating the FILL is somebody else's system
 * and usually required to be that colour; raising the ALBEDO is measurably not
 * the lever on a surface receiving nearly no light. So this is a deliberate,
 * bounded departure applied to the one surface that needs it, and BOUNDED is
 * the operative word — full desaturation produces a neutral grey object under a
 * coloured scene, which is a different and more obvious lie.
 *
 * Returns the uniform so a caller can retune the amount with no recompile,
 * which is what makes an in-page A/B of it possible.
 */
export function patchChromaLimit(mat: THREE.Material, amount: number): { value: number } {
  const u = { value: amount };
  chain(mat, 'chromalim', (shader) => {
    shader.uniforms.uChromaLim = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uChromaLim;')
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight = mix( outgoingLight, vec3( dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uChromaLim );\n#include <opaque_fragment>'
      );
  });
  return u;
}

/**
 * A FLOOR under the presented radiance — never let a shadow reach pure black.
 *
 * Physically it nearly does, and a frame with crushed blacks reads as a bug
 * rather than as vacuum: an unlit low-albedo silhouette against a dim
 * background disappears, and the hero asset loses its outline.
 *
 * A `max()`, not an add, so it is a FLOOR and not a wash. Anywhere the surface
 * is genuinely lit this term is below the shading and does exactly nothing; it
 * can only ever act in the shadow it exists for.
 *
 * MODULATED BY VERTEX COLOUR where the geometry carries one, because a flat
 * floor trades a vanished silhouette for a flat black card, which fails the
 * same review from the other side. The `#ifdef` means the same call is correct
 * on geometry with and without the attribute.
 *
 * `outgoingLight` is scene-linear and the tone map runs after it, so the value
 * is authored against a palette's shadow floor and not against a display code.
 */
export function patchRadianceFloor(mat: THREE.Material, hex: number): void {
  const c = new THREE.Color(hex);
  chain(mat, 'radfloor' + hex, (shader) => {
    shader.uniforms.uRadFloor = { value: new THREE.Vector3(c.r, c.g, c.b) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRadFloor;')
      // `outgoingLight` is declared immediately above this include in
      // meshphysical, which is the only place in the chunk list where the fully
      // shaded radiance exists and nothing has consumed it yet.
      .replace(
        '#include <opaque_fragment>',
        '#ifdef USE_COLOR\noutgoingLight = max( outgoingLight, uRadFloor * vColor.r );\n#else\noutgoingLight = max( outgoingLight, uRadFloor );\n#endif\n#include <opaque_fragment>'
      );
  });
}
