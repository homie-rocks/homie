/**
 * ============================================================================
 *  Tiling breakup — the parts a kart racer and a space racer derive
 *  IDENTICALLY.
 * ============================================================================
 *  `injectBreakup` exists in both games and they are forks of each other, so
 *  most of it was the same text twice. This is the half that was literally
 *  identical, byte for byte, on 2026-08-20: the options, the uniform block
 *  every material gets, the flags that decide which blocks compile in, and the
 *  GLSL chunks those flags select.
 *
 *  WHAT IS DELIBERATELY NOT HERE, AND WHY IT IS A SEAM RATHER THAN AN OMISSION.
 *  The two forks diverged in exactly four places, and every one of them is a
 *  place where the space racer changed a FORMULA rather than adding a feature:
 *
 *    · `SPEC_AA_GEO` — the kart racer adds `min( 1.6σ, 0.42 )` to roughness;
 *      the space racer moved to Kaplanyan variance filtering (α'² = α² + 2σ²)
 *      to kill the specular crawl on truss diagonals. Different maths,
 *      different picture, on purpose.
 *    · the settle's albedo mip and its roughness term — the space racer made
 *      both tunable (`settleMip`, `settleVary`) after a review measured a
 *      906 m hull resolving to one flat colour.
 *    · the world-cell and analytic-joint layers, which the space racer added
 *      and the kart racer has never had.
 *
 *  Those stay in the games. A flag in here choosing between two roughness
 *  formulae would mean the two were never one thing; a chunk each game splices
 *  where it wants means they are.
 *
 *  THE ASSEMBLY WAS SAID TO STAY WITH THEM TOO, AND THAT SENTENCE WAS WRONG.
 *  It read: "the `onBeforeCompile` that splices these chunks into three's
 *  physical shader stays with them, because that is the line where the
 *  divergence actually lands." It is not. Measured later the same day with
 *  `diff`: 186 lines against 180, and the entire disagreement sat in eleven
 *  named holes, every one of them a STRING one game has and the other does not
 *  — including the four listed above, which is why they read as a divergence
 *  from inside either file. `applyBreakup` at the bottom of this file is that
 *  assembly, and the four differences are four of its slots. The lesson is a
 *  general one: **two forks look divergent because of the
 *  values they carry, and the way to find out is to diff them, not to read
 *  one.**
 *
 *  THE PROPERTY THAT MAKES THIS SAFE TO HAVE MOVED, and it is checked rather
 *  than asserted: a material-shader probe hashes the exact vertex and fragment
 *  text every material in both games hands the compiler, against a baseline
 *  recorded before this file existed. A reduction that changed one character of
 *  emitted GLSL — a uniform where there was a literal, a chunk in a different
 *  order — reddens it. It was green before this file and green after.
 * ============================================================================
 *  WHAT THE THREE LAYERS ARE FOR. This was the same nineteen lines above
 *  `injectBreakup` in both games; it describes what the chunks below emit, so
 *  it belongs on them rather than in two forks of a call site.
 *
 *  Breakup, per-instance de-duplication and the distance settle ride in ONE
 *  injection because they all need the same world-space varyings.
 *
 *  The variation channel (ORM.a) is sampled in **world space**, not UV space.
 *  Sampling it in UV space welds the modulation to each mesh's own UV layout,
 *  so a hundred instanced houses get the identical blotch in the identical
 *  place — precisely the visible-tiling failure the art direction calls out. In
 *  world space the modulation is continuous across the whole village and cannot
 *  repeat per instance no matter how the UVs were laid out.
 *
 *  `settle` fades the fine octave toward a high mip of the same map with
 *  distance. Without it the aggregate on a road survives to the horizon at
 *  constant on-screen density, which on a moving frame is a shimmering carpet;
 *  anisotropic filtering makes this *worse*, because it holds a low mip at
 *  exactly the grazing angles a racing camera lives at.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  INST_PARS,
  INST_VERTEX,
  WORLD_HASH,
  WORLD_PARS,
  WORLD_VERTEX,
  tintMul,
} from './MaterialChunks.js';

export interface BreakupOpts {
  /** metres of world per cycle of the low-frequency variation */
  period: number;
  /** how hard that variation pushes albedo and roughness */
  strength: number;
  /** second world band, in metres. Defaults to `period * 0.319`. */
  periodB?: number;
  /** ...and its strength. Defaults to `strength * 0.62`. */
  strengthB?: number;

  // --- the macro layer: everything above about a metre -------------------
  /**
   * Albedo multiplier the surface drifts toward on the macro layer's BRIGHT
   * side, and on its dark side. Colour drift across metres, not just value
   * drift: a road that only gets lighter and darker is still one colour of road,
   * and the eye reads one colour of anything as painted.
   */
  macroWarm?: number;
  macroCool?: number;
  /** how far that drift goes, 0..1 */
  macroTint?: number;
  /** roughness swing driven by the same signal as albedo (correlated) */
  macroRough?: number;
  /**
   * The material bakes `Fields.macroB` into its albedo alpha, giving the macro
   * layer a SECOND, independent field. Required by `macroRoughB` and `stain`.
   */
  macroB?: boolean;
  /** metres per cycle of macro B. Defaults to `period * 0.54`. */
  periodMacroB?: number;
  /** roughness swing driven by macro B alone — decorrelated from albedo */
  macroRoughB?: number;
  /**
   * Pooling: oil on tarmac, mud in turf, damp in the shade. Fires on macro B's
   * upper tail only, so it reads as a *thing on* the surface rather than as more
   * variation of it. `[amount, glossGain]` — most stains are glossier than what
   * they sit on, which is what makes them read as wet.
   */
  stain?: [number, number];
  /** albedo multiplier inside the stain */
  stainTint?: number;
  /** the macro-B ramp the stain occupies; tighten it for a harder edge */
  stainRange?: [number, number];
  /**
   * Anisotropic band in the TILE's own UV frame:
   * `[uScale, vScale, albedoAmount, roughAmount]`.
   *
   * The isotropy breaker. World space cannot supply this — the direction a road
   * is worn along is the direction of the road, which is not a world axis and
   * changes every corner. The tile's V axis, however, is laid down the track by
   * `TrackGeometry` (V = distance / worldScale), so a band sampled at a heavily
   * stretched UV scale runs *along the racing line* everywhere on the course,
   * through every corner, for free. On rock, set U and V the other way up and it
   * runs along the bedding instead.
   */
  streak?: [number, number, number, number];

  /**
   * The macro layer's own texture (R = drift, G = pooling, B = anisotropic
   * source). Build it with `this.macroMaps()`.
   */
  macroTex: THREE.Texture;

  /**
   * A vertical gradient measured from the instance's own origin:
   * `[metres, albedoAmount, roughAmount]` plus `heightTintColor`.
   *
   * The splash zone. Every wall in the world is dirtier for the first metre off
   * the ground, every palm trunk is greener and more lichened at its base, and
   * neither fact can live in a tiling texture — the tile does not know which way
   * is up, let alone where the ground is. Nor can it be a world-Y ramp: the
   * village climbs 40 m, so an absolute height would put the splash zone through
   * the middle of the upper terraces. Measured from `vInstOrigin` it is correct
   * on every instance at every elevation, and being baked into albedo it
   * survives every LOD the aerial shot can throw at it.
   *
   * Requires `instUv > 0` (that is what compiles `vInstOrigin` in).
   */
  heightTint?: [number, number, number];
  /** albedo multiplier at the bottom of the `heightTint` ramp */
  heightTintColor?: number;
  /** per-instance UV phase offset, in tiles (0 = off) */
  instUv?: number;
  /** per-instance value/hue jitter, 0..1 (0 = off) */
  instTint?: number;
  /** [near, far] metres over which fine detail settles toward the local mean */
  settle?: [number, number];
  /** roughness the surface converges on past `settle[1]` */
  settleRough?: number;
  /**
   * Mip the settle converges the albedo (and the settled roughness) onto.
   *
   * 5.5 was the kart racer's number and it is a 16×16 read of the tile — i.e.
   * the tile's MEAN. On a 3.6 m hull tile that is a 220 mm read: the 2.4 m
   * plate survives, the 0.6 m sub-panel does not, and the 0.08 m fastener row
   * certainly does not. On a megastructure whose subject sits 150–600 m out,
   * every surface in frame is past the far end of the ramp, so "the far field"
   * is the whole frame and what a review measured as "a flat-coloured slab with
   * a perfectly even highlight from edge to edge" is this constant.
   *
   * 3.0 is a 128×128 read — 28 mm on that same tile — which keeps the
   * sub-panel layer and drops only what the hardware mip chain was going to
   * drop anyway. The settle's job was never to be the mip chain; it is there to
   * stop the FINE octave holding full contrast at constant on-screen density,
   * and three mip levels does that.
   */
  settleMip?: number;
  /**
   * How much of the settled roughness is a low-frequency READ of the roughness
   * map rather than the `settleRough` scalar, 0..1. Default 0.6.
   *
   * The art direction makes a constant roughness on anything over 2 m² an
   * automatic fail, and `mix( roughnessFactor, uSettle.z, gSettle )` is
   * precisely that fail applied to every surface past the ramp — one scalar
   * across a 906 m hull. Reading the same map at `settleMip` instead keeps real
   * spatial variance out to the horizon for no extra fetch on the near field
   * and one on the far.
   */
  settleVary?: number;
  /**
   * A world-space panel-cut layer the TILE CANNOT DEFEAT.
   *
   * The failure it exists to fix: `bspPanelField` produces a genuinely
   * non-uniform panel layout inside one 3.2 m bore-liner tile — and then that
   * tile repeats ~24 times across a 76 m foundry bay wall, and twenty-four
   * copies of one non-uniform layout read as a regular lattice. A review
   * scored that as an automatic fail against the art direction, and it is
   * correct: the variation has to exist at a period the tile has no access
   * to, which means world space, which means here rather than in the generator.
   *
   * A per-tile UV offset is not a substitute and the finding says so — it
   * shifts the same lattice.
   *
   * `period` is the COURSE HEIGHT in metres and roughly the mean cell width;
   * 14–40 m is the useful band. `cut` is the strength of the cut line between
   * two cells, `tint` the per-cell albedo offset and `rough` the per-cell
   * roughness offset — the last two are what stop two adjacent bays being the
   * same age. See the shader block for the running-bond construction and for
   * why this is computed rather than sampled.
   */
  worldCells?: { period: number; cut?: number; tint?: number; rough?: number };
  /**
   * Analytic panelisation in the tile's own frame:
   * `[platesU, coursesV, seamAmount, bayAmount]`.
   *
   * The three panel scales are baked into the tile as RELIEF, and relief is
   * the first thing the mip chain and the settle take away — which is why the
   * deck reads as "an unbroken flat dark plane" at exactly the distance the eye
   * spends its time, 60–200 m. These are the same lines evaluated in closed
   * form with a SCREEN-SPACE width, so they hold a one-pixel line from the near
   * field to the horizon, cost no texture fetch, and cannot crawl — there is no
   * texture to alias. Weighted toward the far field so the baked joint, which
   * has real geometry and a real lip, still owns the near field.
   */
  joints?: [number, number, number, number];
  /**
   * Second surface variant. The world-space variation cross-fades albedo toward
   * this colour, which is the cheap stand-in for the vertex-colour blend
   * between two grass or two sand variants the art direction asks for — and
   * unlike vertex colours it works on geometry somebody else authored.
   */
  variantTint?: number;
  variantAmount?: number;
  /**
   * How hard a *darkening* in the mesh's vertex colours also polishes the
   * surface. The track owns the racing line, the wheel tracks and the shoulder
   * grime as vertex-colour masks, and it can only multiply albedo with them — so
   * a racing line laid down that way is a tint and nothing else. At exposure
   * 1.05 an 8% tint through a corner apex is invisible; the same mask taken to
   * roughness under a 14° key is a sheen you cannot miss. 0 leaves it off, which
   * is right for grass and sand, where a dark vertex colour means wet or shaded,
   * not polished.
   */
  wearGloss?: number;

  /**
   * Hard lower bound on the final roughness, after every multiplier above has
   * had its say.
   *
   * Defaults to 0.025, which is a mirror, and that default is only safe because
   * most materials never stack enough gloss terms to reach it. A road does: the
   * map floor, the two world bands, macro B, the streak, the stain and
   * `wearGloss` are six independent multipliers and they are all capable of
   * pulling the same way at once. Worst case on tarmac was
   * `0.24 · 0.65 · 0.74 · 0.83 · 0.83 · 0.45 ≈ 0.036` — a polished mirror
   * wearing an asphalt albedo, which under a 14° key and a warm-sun /
   * blue-zenith environment is a field of coloured pinpoints. Give every
   * surface a floor that matches what it is made of.
   */
  roughFloor?: number;

  /**
   * Specular antialiasing strength, 0..1 (0 = off, compiled out).
   *
   * Couples the normal map's own slope into roughness (Toksvig-style), eases the
   * relief off toward grazing, and adds a screen-space normal-variance term so a
   * surface the pixel cannot resolve goes rough instead of going to a pinpoint
   * mirror. See the shader block for why a surface with chip-scale relief needs
   * all three.
   */
  specAA?: number;

  /**
   * How hard the macro band also drives the normal map's amplitude.
   *
   * The art direction asks for spatially varying roughness; the other half of
   * that ask, and the one nothing in this library was doing, is spatially
   * varying *relief*. A road whose aggregate stands exactly as proud on the
   * polished racing line as it does on the untouched shoulder is one surface
   * with a tint on it, and the eye reads constant relief the same way it reads
   * constant roughness. Positive values make the macro layer's bright side (the
   * unworn, coarse-graded side) the one with deeper relief.
   */
  macroNormal?: number;
}

/**
 * Everything `injectBreakup` derives from `BreakupOpts` the same way in both
 * games: the shared uniform objects, the compile-in flags, and the GLSL chunks
 * those flags select.
 *
 * The uniform objects are returned rather than installed, because the two games
 * write `shader.uniforms` in a different ORDER and interleave uniforms of their
 * own. Order is not free: the probe above hashes uniform names, and more to the
 * point a caller that cannot control the order cannot keep its emitted text
 * identical. So this hands back the objects and the caller does the installing.
 *
 * THE FLAGS ARE RETURNED TOO, and that is not redundancy. Each game re-uses
 * them for its own extra chunks (`celled`, `jointed`, the settle blocks) and,
 * more importantly, for its `customProgramCacheKey` — two materials whose
 * chunks differ must not share a compiled program, and the key is built from
 * these booleans.
 */
export interface BreakupParts {
  /** the uniform objects, to be installed in whatever order the caller wants */
  uBreak: { value: THREE.Vector4 };
  uMacroA: { value: THREE.Vector4 };
  uMacroC: { value: THREE.Vector4 };
  uMacroB: { value: THREE.Vector4 };
  uStain: { value: THREE.Vector4 };
  uStainRough: { value: number };
  uStreak: { value: THREE.Vector4 };
  uInst: { value: THREE.Vector2 };
  uSettle: { value: THREE.Vector3 };
  uVariant: { value: THREE.Vector4 };
  uWear: { value: number };
  uRoughFloor: { value: number };
  uSpecAA: { value: number };
  uMacroNorm: { value: number };
  uHeight: { value: THREE.Vector4 };
  uHeightC: { value: THREE.Vector3 };
  uMacroTex: { value: THREE.Texture };

  /**
   * The two option arrays AFTER their defaults are resolved.
   *
   * These are returned for the program cache key rather than for the shader:
   * both games spell the key `..._${settles ? settle.join(',') : 'x'}_...`, and
   * a key built from `o.settle` instead would collide an explicit `[1e6, 1e6+1]`
   * with an absent one. They are derived identically in both games, which is why
   * they are here and not recomputed twice.
   */
  settle: [number, number];
  ht: [number, number, number];

  /** which blocks compile in — also what the program cache key is built from */
  jitters: boolean;
  heights: boolean;
  settles: boolean;
  specAA: boolean;
  wears: boolean;
  hasMacroB: boolean;
  stains: boolean;
  streaks: boolean;
  tints: boolean;

  /** the GLSL chunks, empty string where the material did not ask for one */
  MACRO_B_FETCH: string;
  MACRO_TINT: string;
  STAIN_ALBEDO: string;
  STAIN_ROUGH: string;
  STREAK_FETCH: string;
  STREAK_ALBEDO: string;
  STREAK_ROUGH: string;
  MACRO_B_ROUGH: string;
  HEIGHT_SETUP: string;
  HEIGHT_ALBEDO: string;
  HEIGHT_ROUGH: string;
  SPEC_AA: string;
  WEAR_GLOSS: string;
  VARIANT_BLEND: string;
}

export function breakupParts(o: BreakupOpts): BreakupParts {
  const uBreak = {
    value: new THREE.Vector4(
      o.period,
      o.strength,
      o.periodB ?? o.period * 0.319,
      o.strengthB ?? o.strength * 0.62,
    ),
  };
  const warm = tintMul(o.macroWarm ?? 0xffffff, true);
  const cool = tintMul(o.macroCool ?? 0xffffff, true);
  const uMacroA = { value: new THREE.Vector4(warm.x, warm.y, warm.z, o.macroTint ?? 0) };
  const uMacroC = { value: new THREE.Vector4(cool.x, cool.y, cool.z, o.macroRough ?? 0.3) };
  const stainRange = o.stainRange ?? [0.58, 0.94];
  const uMacroB = {
    value: new THREE.Vector4(
      o.periodMacroB ?? o.period * 0.54,
      o.macroRoughB ?? 0,
      stainRange[0],
      stainRange[1],
    ),
  };
  // Not hue-only: a stain carries its own darkening, because that is most of
  // what makes an oil slick or a damp patch read as something *on* the surface.
  const stainT = tintMul(o.stainTint ?? 0x8a8a8a);
  const uStain = { value: new THREE.Vector4(stainT.x, stainT.y, stainT.z, o.stain ? o.stain[0] : 0) };
  const uStainRough = { value: o.stain ? o.stain[1] : 0 };
  const streak = o.streak ?? [0, 0, 0, 0];
  const uStreak = { value: new THREE.Vector4(streak[0], streak[1], streak[2], streak[3]) };
  const uInst = { value: new THREE.Vector2(o.instUv ?? 0, o.instTint ?? 0) };
  const settle = o.settle ?? [1e6, 1e6 + 1];
  const uSettle = { value: new THREE.Vector3(settle[0], settle[1], o.settleRough ?? 0.8) };
  const uVariant = {
    value: new THREE.Vector4(0, 0, 0, 0),
  };
  if (o.variantTint !== undefined) {
    const c = new THREE.Color(o.variantTint).convertSRGBToLinear();
    uVariant.value.set(c.r, c.g, c.b, o.variantAmount ?? 0.5);
  }
  const uWear = { value: o.wearGloss ?? 0 };
  const uRoughFloor = { value: o.roughFloor ?? 0.025 };
  const uSpecAA = { value: o.specAA ?? 0 };
  const uMacroNorm = { value: o.macroNormal ?? 0 };
  const ht = o.heightTint ?? [0, 0, 0];
  const htc = tintMul(o.heightTintColor ?? 0x808080);
  const uHeight = { value: new THREE.Vector4(Math.max(1e-3, ht[0]), ht[1], ht[2], 0) };
  const uHeightC = { value: new THREE.Vector3(htc.x, htc.y, htc.z) };
  const jitters = (o.instUv ?? 0) > 0;
  const heights = (ht[1] !== 0 || ht[2] !== 0) && jitters;
  const settles = !!o.settle;
  const specAA = (o.specAA ?? 0) > 0;
  const wears = (o.wearGloss ?? 0) > 0;
  const uMacroTex = { value: o.macroTex };
  const hasMacroB = !!o.macroB;
  const stains = hasMacroB && !!o.stain && o.stain[0] > 0;
  const streaks = streak[2] !== 0 || streak[3] !== 0;
  const tints = (o.macroTint ?? 0) > 0;

  // Every one of these blocks is a texture fetch or a handful of ALU on the
  // largest surfaces in the frame, so each is compiled in only where its
  // material asked for it. The flags also go in the program cache key.
  const MACRO_B_FETCH = hasMacroB
    ? /* glsl */ `
          // Macro B is its own field on its own world period, so gloss and
          // colour stop being two views of one blob.
          gMacroB = texture2D( uMacroTex, kWorldPlane( vWorldP, uMacroB.x ) + 0.21 ).g;`
    : '';
  const MACRO_TINT = tints
    ? /* glsl */ `
            // Colour drift across metres. Multiplicative and normalised, so it
            // shifts the surface warm or cool without ever adding energy.
            sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uMacroA.rgb, clamp(  kMacro, 0.0, 1.0 ) * uMacroA.a );
            sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uMacroC.rgb, clamp( -kMacro, 0.0, 1.0 ) * uMacroA.a );`
    : '';
  const STAIN_ALBEDO = stains
    ? /* glsl */ `
            gStain = smoothstep( uMacroB.z, uMacroB.w, gMacroB ) * uStain.a;
            sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uStain.rgb, gStain );`
    : '';
  const STAIN_ROUGH = stains
    ? /* glsl */ `
          roughnessFactor *= 1.0 - gStain * uStainRough;`
    : '';
  const STREAK_FETCH = streaks
    ? /* glsl */ `
          // Anisotropic band in the tile's own frame — V runs down the track,
          // so this is the smear of the racing line and it follows every corner.
          gStreak = ( texture2D( uMacroTex, vMapUv * uStreak.xy + vec2( 0.19, 0.57 ) ).b - 0.5 ) * 2.0;`
    : '';
  const STREAK_ALBEDO = streaks
    ? '\n            sampledDiffuseColor.rgb *= 1.0 + gStreak * uStreak.z;'
    : '';
  const STREAK_ROUGH = streaks ? '\n          roughnessFactor *= 1.0 + gStreak * uStreak.w;' : '';
  const MACRO_B_ROUGH = hasMacroB
    ? '\n          roughnessFactor *= 1.0 + ( gMacroB - 0.5 ) * 2.0 * uMacroB.y;'
    : '';
  // Squared, so the last few centimetres against the ground take the brunt of it
  // and the ramp does not read as a painted dado rail a metre up the wall.
  const HEIGHT_SETUP = heights
    ? /* glsl */ `
          gSplash = 1.0 - smoothstep( 0.0, uHeightTint.x, vWorldP.y - vInstOrigin.y );
          gSplash *= gSplash;`
    : '';
  const HEIGHT_ALBEDO = heights
    ? /* glsl */ `
            sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), uHeightTintC, gSplash * uHeightTint.y );`
    : '';
  const HEIGHT_ROUGH = heights
    ? '\n          roughnessFactor *= 1.0 + gSplash * uHeightTint.z;'
    : '';

  /**
   * Specular antialiasing, applied where the mapped normal and `roughnessFactor`
   * are both in scope — `<roughnessmap_fragment>` runs at line 15 of the
   * physical main() and `<normal_fragment_maps>` at line 18, with
   * `<lights_physical_fragment>` not consuming either until line 24, so this
   * costs no extra texture fetch.
   *
   * The failure it exists to stop: a 1024² normal map carrying 36 mm chippings
   * puts a near-vertical facet every few texels. Under a 14° key and a *bipolar*
   * golden-hour environment — warm sun and horizon on one side, blue zenith on
   * the other — each of those facets is a pinpoint mirror pointed somewhere
   * random. One catches the sun and lands orange, the one beside it catches the
   * zenith and lands cyan, and the pair average to magenta. That reads as
   * rainbow glitter scattered over the tarmac, and its hue histogram is the
   * giveaway: two clumps, one at 0–30° and one at 210–360°, with the greens and
   * yellows in between completely empty. Independent per-channel albedo noise
   * would have filled every hue evenly. It is aliased specular, not colour.
   *
   * Two terms:
   *
   *  1. Toksvig-ish variance→roughness. The tangent-space normal's own slope is
   *     a direct measure of the sub-texel normal variance the specular lobe is
   *     standing on, so steep texels get their lobe widened instead of being
   *     left as mirrors the sampler has no hope of resolving. Flat texels
   *     measure zero slope and keep exactly the roughness they were authored
   *     with, which is why the polish ribbons and the racing line survive this
   *     untouched.
   *  2. Relief eased off toward grazing. Near head-on, a facet has to tip a long
   *     way to swing the reflection vector off the road; at 15° it has to tip
   *     barely at all, so the same map that reads as aggregate on the bonnet-
   *     level midground reads as sparkle in the near field. Facing geometry
   *     keeps its full chip relief; only the grazing end is calmed.
   *  3. Screen-space normal variance (`SPEC_AA_GEO`, below). 1 and 2 both work
   *     off the normal the sampler *handed back*, so neither of them can see how
   *     much surface a pixel actually covers. That is the term that was missing,
   *     and it is the one the guardrail needed: an Armco rail at 60 m packs
   *     several centimetres of rolled profile and three mip levels of scratch
   *     normal into one pixel, and a 0.3-roughness lobe standing on that is a
   *     sub-pixel mirror. Three already does this for the *geometric* normal
   *     (`geometryRoughness` in `lights_physical_fragment`), which is why a bare
   *     cylinder does not strobe and a normal-mapped one does — the perturbed
   *     normal is excluded from that measurement. This applies the same
   *     Kaplanyan filtering to the perturbed normal, so it composes with three's
   *     own term rather than fighting it.
   */
  const SPEC_AA = specAA
    ? /* glsl */ `
            float kSlope = clamp( 1.0 - mapN.z * inversesqrt( max( dot( mapN, mapN ), 1e-6 ) ), 0.0, 1.0 );
            float kGraze = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
            mapN.xy *= mix( 1.0 - uSpecAA * 0.55, 1.0, sqrt( kGraze ) );
            roughnessFactor = clamp(
              roughnessFactor + kSlope * uSpecAA * ( 0.55 - 0.30 * kGraze ), 0.0, 1.0 );`
    : '';


  const WEAR_GLOSS = wears
    ? /* glsl */ `
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            // luminance the mesh has taken *out* of the surface = how polished it
            // is. Racing line and wheel tracks come down the same channel.
            float kPolish = clamp( 1.0 - dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );
            // ...breathed along its own length by the two world bands, because a
            // wear mask laid down at a constant lateral coordinate is a straight
            // line, and a straight line of constant gloss is a UV seam, not wear.
            float kPolishAmt = uWearGloss * ( 0.72 + ( gBreak + gBreak2 ) * 0.34 );
            roughnessFactor *= 1.0 - clamp( kPolish * kPolishAmt, 0.0, 0.55 );
          #endif`
    : '';
  // Compiled in only where it is asked for: a second variant costs a texture
  // fetch and most surfaces do not need one.
  const VARIANT_BLEND =
    o.variantTint === undefined
      ? ''
      : /* glsl */ `
            {
              // second variant, keyed off a world signal on a different period
              // from the tile — the repeat can still be measured but never seen
              float kV = texture2D( uMacroTex, kWorldPlane( vWorldP, uBreak.x * 1.63 ) + 0.37 ).r;
              float kL = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
              sampledDiffuseColor.rgb = mix(
                sampledDiffuseColor.rgb,
                uVariant.xyz * ( 0.55 + kL * 1.1 ),
                smoothstep( 0.42, 0.80, kV ) * uVariant.w );
            }`;
  return {
    uBreak, uMacroA, uMacroC, uMacroB, uStain, uStainRough, uStreak, uInst,
    uSettle, uVariant, uWear, uRoughFloor, uSpecAA, uMacroNorm, uHeight,
    uHeightC, uMacroTex,
    settle, ht,
    jitters, heights, settles, specAA, wears, hasMacroB, stains, streaks, tints,
    MACRO_B_FETCH, MACRO_TINT, STAIN_ALBEDO, STAIN_ROUGH, STREAK_FETCH,
    STREAK_ALBEDO, STREAK_ROUGH, MACRO_B_ROUGH, HEIGHT_SETUP, HEIGHT_ALBEDO,
    HEIGHT_ROUGH, SPEC_AA, WEAR_GLOSS, VARIANT_BLEND,
  };
}

/**
 * ============================================================================
 *  The assembly. Where each game splices its own chunks into three's shader.
 * ============================================================================
 *  THE HEADER OF THIS FILE USED TO SAY THIS PART COULD NOT MOVE, and that was a
 *  judgement rather than a measurement. Measured on 2026-08-20: the two
 *  `onBeforeCompile` bodies were 186 lines in the space racer and 180 in the
 *  kart racer, and `diff` put the whole of their disagreement in ELEVEN named
 *  places — seven pure insertions, three substituted lines and one cache-key
 *  suffix. Not one of them changes what the surrounding code DOES; every one is
 *  a string one game has and the other does not. That is the same finding as
 *  `breakupParts`' own, one level up: the divergence is a value, not a
 *  behaviour, so it is a slot and not a flag.
 *
 *  WHAT IS STILL A SEAM, AND STAYS ONE. Nothing here chooses between two
 *  formulae. `SPEC_AA_GEO` arrives already built, so the kart racer keeps its
 *  capped linear term and the space racer keeps Kaplanyan variance filtering;
 *  `SETTLE_LOD` is the literal `5.5` in one game and `uSettleB.x` in the other
 *  because one of them made it tunable; the world-cell and analytic-joint
 *  layers arrive as chunks from the only game that has them. A `boolean` in
 *  this signature deciding which roughness formula to compile would mean the
 *  two were never one thing. A `string` each game splices where it wants means
 *  they are.
 *
 *  BYTE IDENTITY IS THE CONTRACT AND IT IS CHECKED, NOT ASSERTED. Every slot
 *  below — including `SETTLE_NOTE`, which carries nothing but a GLSL comment —
 *  exists so the text this function emits is the SAME BYTES each game emitted
 *  before it existed. A GLSL `//` comment cannot reach the compiled program, so
 *  unifying that one would have been safe; it is a slot anyway, because that is
 *  what lets the material-shader probe demand exact equality across all 55
 *  materials rather than equality-after-normalising, and a check that has to
 *  normalise before it compares has a hole the exact size of what it normalised
 *  away.
 * ============================================================================
 */
export interface BreakupSplice {
  /**
   * Extra uniform objects this game's own layers need. Installed alongside the
   * shared block; `shader.uniforms` is a name-keyed map that three resolves
   * against the compiled program's active uniform list, so insertion order is
   * not observable and does not have to be preserved.
   */
  uniforms?: Record<string, { value: unknown }>;
  /** extra declarations, spliced into `<common>` after the shared uniform block */
  COMMON?: string;
  /** extra world-space setup, between `MACRO_B_FETCH` and `HEIGHT_SETUP` */
  SETUP?: string;
  /** extra setup inside `#ifdef USE_MAP`, after `STREAK_FETCH` */
  MAP_PRE?: string;
  /** the comment above the settle mix — see the byte-identity note above */
  SETTLE_NOTE?: string;
  /** the mip the settle reads: a literal in one game, a uniform in the other */
  SETTLE_LOD?: string;
  /** extra albedo term, after `MACRO_TINT` */
  ALBEDO_A?: string;
  /** extra albedo term, after `STREAK_ALBEDO` */
  ALBEDO_B?: string;
  /** the whole settle-roughness statement, on its own line */
  SETTLE_ROUGH?: string;
  /** extra roughness term, after `MACRO_B_ROUGH` */
  ROUGH_A?: string;
  /** extra roughness term, after `STAIN_ROUGH` */
  ROUGH_B?: string;
  /** the geometric spec-AA block, built by the game because the maths differs */
  SPEC_AA_GEO?: string;
  /** appended to the shared program cache key */
  key?: string;
}

export function applyBreakup(
  mat: THREE.Material,
  o: BreakupOpts,
  p: BreakupParts,
  s: BreakupSplice = {},
): void {
  const {
    uBreak, uMacroA, uMacroC, uMacroB, uStain, uStainRough, uStreak, uInst,
    uSettle, uVariant, uWear, uRoughFloor, uSpecAA, uMacroNorm, uHeight,
    uHeightC, uMacroTex,
    settle, ht,
    jitters, heights, settles, specAA, hasMacroB, stains, streaks, tints,
    MACRO_B_FETCH, MACRO_TINT, STAIN_ALBEDO, STAIN_ROUGH, STREAK_FETCH,
    STREAK_ALBEDO, STREAK_ROUGH, MACRO_B_ROUGH, HEIGHT_SETUP, HEIGHT_ALBEDO,
    HEIGHT_ROUGH, SPEC_AA, WEAR_GLOSS, VARIANT_BLEND,
  } = p;
  const COMMON = s.COMMON ?? '';
  const SETUP = s.SETUP ?? '';
  const MAP_PRE = s.MAP_PRE ?? '';
  const SETTLE_NOTE = s.SETTLE_NOTE ?? '';
  const SETTLE_LOD = s.SETTLE_LOD ?? '5.5';
  const ALBEDO_A = s.ALBEDO_A ?? '';
  const ALBEDO_B = s.ALBEDO_B ?? '';
  const SETTLE_ROUGH = s.SETTLE_ROUGH ?? '';
  const ROUGH_A = s.ROUGH_A ?? '';
  const ROUGH_B = s.ROUGH_B ?? '';
  const SPEC_AA_GEO = s.SPEC_AA_GEO ?? '';

  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;

  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uBreak = uBreak;
    shader.uniforms.uInstJit = uInst;
    shader.uniforms.uSettle = uSettle;
    shader.uniforms.uVariant = uVariant;
    shader.uniforms.uWearGloss = uWear;
    shader.uniforms.uRoughFloor = uRoughFloor;
    shader.uniforms.uSpecAA = uSpecAA;
    shader.uniforms.uMacroNorm = uMacroNorm;
    shader.uniforms.uMacroA = uMacroA;
    shader.uniforms.uMacroC = uMacroC;
    shader.uniforms.uMacroB = uMacroB;
    shader.uniforms.uStain = uStain;
    shader.uniforms.uStainRough = uStainRough;
    shader.uniforms.uStreak = uStreak;
    shader.uniforms.uMacroTex = uMacroTex;
    shader.uniforms.uHeightTint = uHeight;
    shader.uniforms.uHeightTintC = uHeightC;
    // `Object.entries`, not a key loop with an index back into the record:
    // `noUncheckedIndexedAccess` types that lookup as possibly-undefined and a
    // `!` there would be the same shape as every other assertion in this
    // codebase that was wrong. The entries carry the value with the key.
    if (s.uniforms) for (const [k, u] of Object.entries(s.uniforms)) shader.uniforms[k] = u;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_PARS + (jitters ? INST_PARS : ''))
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + WORLD_VERTEX + (jitters ? INST_VERTEX : ''),
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          WORLD_PARS +
          (jitters ? INST_PARS : '') +
          WORLD_HASH +
          'uniform vec4 uBreak;\nuniform vec2 uInstJit;\nuniform vec3 uSettle;\nuniform vec4 uVariant;\n' +
          COMMON +
          'uniform float uWearGloss;\nuniform float uRoughFloor;\nuniform float uSpecAA;\n' +
          'uniform float uMacroNorm;\nfloat gSpecVar = 0.0;\n' +
          'uniform vec4 uMacroA;\nuniform vec4 uMacroC;\nuniform vec4 uMacroB;\n' +
          'uniform vec4 uStain;\nuniform float uStainRough;\nuniform vec4 uStreak;\n' +
          'uniform sampler2D uMacroTex;\nuniform vec4 uHeightTint;\nuniform vec3 uHeightTintC;\n' +
          'float gBreak = 0.0;\nfloat gBreak2 = 0.0;\nfloat gSettle = 0.0;\nvec2 gUvJit = vec2( 0.0 );\n' +
          'float gMacroB = 0.5;\nfloat gStain = 0.0;\nfloat gStreak = 0.0;\nfloat gSplash = 0.0;\n',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        {
          ${jitters ? 'vec3 kIH = kHash3( floor( vInstOrigin * 3.7 ) + 0.5 );' : 'vec3 kIH = vec3( 0.5 );'}
          gUvJit = ( kIH.xy - 0.5 ) * uInstJit.x;
          gSettle = smoothstep( uSettle.x, uSettle.y, vViewDist );
          // The macro layer, read in WORLD space off its own small map. World
          // space and not UV space because a variation welded to each mesh's UV
          // layout repeats once per instance and once per tile, which is the
          // visible-tiling fail the bible calls out; in world space it is
          // continuous across the whole course and cannot repeat at all.
          gBreak = ( texture2D( uMacroTex, kWorldPlane( vWorldP, uBreak.x ) ).r - 0.5 ) * 2.0 * uBreak.y;
          // Second band at a deliberately non-integer fraction of the first, so
          // the two never come back into phase. One band at ~30 m leaves
          // consecutive 3.5 m tiles in the near field identical to each other;
          // this is the ~9 m decade that stops that, and it is the one the
          // camera is actually close enough to read.
          gBreak2 = ( texture2D( uMacroTex, kWorldPlane( vWorldP, uBreak.z ) + 0.63 ).r - 0.5 )
                    * 2.0 * uBreak.w;${MACRO_B_FETCH}${SETUP}${HEIGHT_SETUP}
          #ifdef USE_MAP
            ${STREAK_FETCH}${MAP_PRE}
            vec4 sampledDiffuseColor = texture2D( map, vMapUv + gUvJit );${SETTLE_NOTE}
            sampledDiffuseColor = mix( sampledDiffuseColor, textureLod( map, vMapUv + gUvJit, ${SETTLE_LOD} ), gSettle );
            sampledDiffuseColor.a = 1.0;
            float kMacro = gBreak + gBreak2;
            sampledDiffuseColor.rgb *= 1.0 + kMacro * 0.30;${MACRO_TINT}${ALBEDO_A}${STAIN_ALBEDO}${STREAK_ALBEDO}${ALBEDO_B}${HEIGHT_ALBEDO}
            sampledDiffuseColor.rgb *= vec3( 1.0 ) + ( kIH.zxy - 0.5 ) * vec3( 1.0, 0.55, 0.8 ) * uInstJit.y;
${VARIANT_BLEND}
            diffuseColor *= sampledDiffuseColor;
          #endif
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv + gUvJit ).g;
${SETTLE_ROUGH}
          // The world bands are applied AFTER the settle, not before it. Before
          // it, the far field converged on one constant roughness — which on the
          // largest surface in frame, lit by a 14° key, is exactly the uniform
          // plastic sheet the bible names as the #1 amateur tell, and it killed
          // the long grazing sun sheen down the road in every frame.
          //
          // Roughness has to carry the macro layer as hard as albedo does, and
          // partly from a DIFFERENT field. A metre-scale blotch that modulates
          // colour alone still lights like a flat sheet, because the specular
          // response — the only thing a 14° key can rake across — never changed.
          roughnessFactor *= 1.0 + ( gBreak + gBreak2 ) * uMacroC.w;${MACRO_B_ROUGH}${ROUGH_A}${STREAK_ROUGH}${STAIN_ROUGH}${ROUGH_B}${HEIGHT_ROUGH}
          // The floor is per material now. 0.025 is a mirror, and six
          // independent gloss multipliers stacked above can and do reach it.
          roughnessFactor = clamp( roughnessFactor, uRoughFloor, 1.0 );
        #endif${WEAR_GLOSS}
        // ...and again after the wear gloss, which is applied outside the
        // roughness-map block and is itself worth a 0.45x multiplier. Flooring
        // only inside the block left the polished racing line — the one place
        // every gloss term pulls the same way — as the single glossiest thing
        // in the frame, which is exactly backwards.
        roughnessFactor = clamp( roughnessFactor, uRoughFloor, 1.0 );`,
      );

    if (jitters || settles || specAA || (o.macroNormal ?? 0) > 0) {
      shader.fragmentShader = shader.fragmentShader
        // `onBeforeCompile` runs BEFORE three resolves `#include`, so a replace
        // aimed at text that lives inside a chunk never matches and fails
        // silently. This one was aimed at `texture2D( aoMap, vAoMapUv )`, which
        // is inside `<aomap_fragment>` — so the per-instance UV jitter has never
        // reached the AO channel on any instanced surface in the game, and the
        // AO has been sampling an un-jittered phase while albedo, roughness and
        // normal sampled a jittered one. Splice the library's own chunk text in
        // instead: version-proof, and it cannot go quiet again.
        .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replace('vAoMapUv', 'vAoMapUv + gUvJit'))
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #ifdef USE_NORMALMAP_TANGENTSPACE
            vec3 mapN = texture2D( normalMap, vNormalMapUv + gUvJit ).xyz * 2.0 - 1.0;
            // relief has to go with the detail it belongs to, or the far road
            // keeps a normal map it has no albedo left to justify
            // ...and it also has to go with the macro layer. Constant relief
            // across a surface is the same tell as constant roughness: the
            // aggregate stands equally proud on the polished line and on the
            // untouched shoulder, which is the one thing worn asphalt never does.
            mapN.xy *= normalScale * ( 1.0 - gSettle * 0.85 )
                     * clamp( 1.0 + ( gBreak + gBreak2 ) * uMacroNorm, 0.25, 1.9 );${SPEC_AA}
            normal = normalize( tbn * mapN );
          #endif${SPEC_AA_GEO}`,
        );
    }
    if (specAA) {
      // Clearcoat carries its own, much tighter lobe, and a tight lobe is
      // exactly the one that aliases first. Three floors it at 0.0525 and adds
      // `geometryRoughness` — but that is measured on the *unperturbed* normal,
      // so a coat riding a normal map is invisible to it. Add the perturbed
      // variance to the same sum.
      //
      // Appended AFTER the include rather than edited inside it, for the same
      // reason as the aoMap patch above: this hook sees `#include` directives,
      // not chunk bodies, so anything aimed at the chunk's text silently does
      // nothing. `lights_physical_fragment` runs after `normal_fragment_maps`,
      // so `gSpecVar` is already set by the time this reads it.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoatRoughness = min( material.clearcoatRoughness + gSpecVar, 1.0 );
        #endif`,
      );
    }
  };

  const key =
    `brk3${o.period}_${o.strength}_${o.instUv ?? 0}_${o.instTint ?? 0}` +
    `_${settles ? settle.join(',') : 'x'}_${o.variantTint ?? 'x'}_${o.wearGloss ?? 0}` +
    `_${heights ? ht.join(',') : 'x'}` +
    `_${hasMacroB ? 1 : 0}${stains ? 1 : 0}${streaks ? 1 : 0}${tints ? 1 : 0}${specAA ? 1 : 0}` +
    `_${o.macroNormal ?? 0}` + (s.key ?? '');
  // Chained, not assigned. Three keys its program cache on the material's
  // parameters plus this string, and it has no way to see an `onBeforeCompile`;
  // so two materials that differ ONLY in which injections they carry — dry
  // tarmac and the tunnel's wet tarmac are exactly that pair, identical
  // breakup options and different env handling — would hash to one key and the
  // second would be handed the first one's compiled program.
  mat.customProgramCacheKey =
    prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey
      ? () => prevKey.call(mat) + key
      : () => key;
}
