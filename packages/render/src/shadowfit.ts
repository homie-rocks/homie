/**
 * ============================================================================
 *  shadowfit.ts — the UNIT CONVERSIONS a directional shadow map's spec is made
 *  of, before any shader text exists.
 * ============================================================================
 *
 * ## What this is, and what it deliberately is not
 *
 * `cascade.ts` and `cascadederiv.ts` are the two FILTERS — closed-form and
 * screen-derivative — and their own headers say at length why merging them
 * would be a defect rather than a cleanup. **Nothing here merges them.** This
 * file is one step earlier and below both: four arithmetic facts that turn
 * metres, degrees and texels into the numbers either filter is handed.
 *
 *   `shadowBox`         extent + map size + how far back the light sits
 *                       -> texel size, light distance, near, far
 *   `penumbraTexels`    an occluder's height and the SOURCE'S ANGULAR SIZE
 *                       -> the PCF disc radius, in texels
 *   `cappedNormalBias`  a normal offset quoted in TEXELS, capped in METRES
 *   `slopeGradMax`      a slope tangent -> the receiver-plane clamp, in the
 *                       map's own normalised depth-per-uv units
 *
 * Every one of them was written twice inside one base-building game's
 * `Lighting.ts` alone — once in `cascadeSpecs` for the four sun cascades and
 * once in `earthShadowSpec` for the earthshine map — with the same expressions
 * and different constants. That is the smallest unit of a competing
 * implementation there is: not two files, two functions in one file, which no
 * duplication instrument has ever been able to see.
 *
 * ## Why they are the package's and not the game's
 *
 * Because none of them contains a decision. `penumbraTexels` is the geometry of
 * a shadow — an occluder `h` above its own shadow, lit by a source subtending
 * `D`, casts a penumbra `h·tan(D)` wide, and half of that is the radius a disc
 * filter should span. The Sun at 0.53° and Earth at 1.9° from the lunar surface
 * are two evaluations of one identity. `slopeGradMax` is a change of units:
 * depth runs 0..1 across `far − near` metres and uv runs 0..1 across `2·extent`
 * metres, so a receiver at slope tangent `t` has |d(depth)/d(uv)| =
 * `t · 2·extent / (far − near)`. Getting that conversion wrong does not look
 * like a bug — it looks like acne, or like every shadow detached from its
 * object, and either way it looks like the bias number needs tuning.
 *
 * **The NUMBERS stay with the caller and every argument is required.** How tall
 * the tallest thing in cascade 2 is, how shallow the sun gets, and how many
 * centimetres of peter-panning a game will accept are art direction, and a
 * default here is how one game silently inherits another's. There are none.
 *
 * ## No `THREE` and no `Ctx`
 *
 * The same line `cascade.ts` draws, one notch further: this file imports
 * nothing at all. `THREE.MathUtils.clamp` is three lines of three's that
 * would make a units module depend on a renderer.
 */

/** Clamp to `[lo, hi]`. Written here so this file imports nothing. */
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** The four numbers a shadow map's ortho box is described by. */
export interface ShadowBox {
  /** World metres per shadow-map texel. `2 · extent / mapSize`. */
  texel: number;
  /** Distance from the snapped centre, up the light ray, to the light itself. */
  distance: number;
  /** The ortho camera's near plane. */
  near: number;
  /** Its far plane. */
  far: number;
}

/**
 * Resolve one shadow map's ortho box.
 *
 * `lightNear` is how far back the light is parked BEFORE the box's own reach is
 * added, and it is a per-game number with a real consequence: it has to clear
 * the tallest thing that can stand between the box's centre and the light at
 * the shallowest sun the game permits, or that thing is outside the near plane
 * and stops casting. `slack` is the multiple of the half-extent added on top —
 * 1.2 in the one rig this arrived from.
 *
 * `far = 2 · distance` and not `distance + extent`: the receiver-plane clamp
 * and the contact probe are both quoted against `far − near`, and a depth range
 * that is merely tight enough is a depth range that changes meaning the first
 * time somebody moves the light back.
 */
export function shadowBox(
  extent: number,
  mapSize: number,
  lightNear: number,
  slack: number,
  near: number,
): ShadowBox {
  const distance = lightNear + extent * slack;
  return { texel: (2 * extent) / mapSize, distance, near, far: distance * 2 };
}

/**
 * The PCF disc radius, in shadow-map texels, that a source of angular diameter
 * `sourceAngularDiameter` (RADIANS) produces from an occluder `occluderHeight`
 * metres above its own shadow.
 *
 * `h · tan(D)` is the full penumbra width; half of it is the radius. **The
 * `+ 1.0` is the anti-aliasing floor and it is not a fudge:** below one texel a
 * hardware-PCF tap is a point sample and the edge stair-steps, so a filter
 * narrower than its own grid is strictly worse than one exactly as wide.
 *
 * `maxTexels` is the caller's ceiling and it differs per rig — a source three
 * times wider needs a wider cap, and a cap is what stops a distant cascade
 * spending its whole budget blurring. `1.0` is the floor for the reason above
 * and is therefore not a parameter.
 *
 * WORKED, from the rig this came out of, so the shape is checkable by eye:
 * a 0.53° sun over cascade 0 at 0.9 m of occluder and 1.76 cm/texel gives
 * 8.3 mm of penumbra, 0.21 texels of radius, 1.21 after the floor. Cascade 3 at
 * 120 m of occluder and a much coarser texel gives 1.63. IT RISES WITH CASCADE
 * INDEX because tall things live far away, which is right, and is not the same
 * thing as blurring the distance.
 */
export function penumbraTexels(
  occluderHeight: number,
  sourceAngularDiameter: number,
  texel: number,
  maxTexels: number,
): number {
  const penumbra = occluderHeight * Math.tan(sourceAngularDiameter);
  return clamp(0.5 * penumbra / texel + 1.0, 1.0, maxTexels);
}

/**
 * A normal offset quoted in TEXELS, capped in METRES.
 *
 * three applies `normalBias` in the vertex stage along the surface normal, in
 * world units, so "one texel" is a different distance in every cascade. On the
 * near map that is millimetres and exactly what is wanted. On a 480 m or 1800 m
 * box a literal one-texel offset is METRES of peter-panning — the measured
 * "shadows start well clear of the feet" finding — and on a map whose source
 * sits low it slides the whole shadow sideways rather than merely detaching it.
 *
 * So the offset is derived per map and then CAPPED ABSOLUTELY. The cap is the
 * caller's: it is the largest visible detachment that game will accept.
 */
export function cappedNormalBias(
  texels: number,
  texel: number,
  maxMetres: number,
): number {
  return Math.min(texels * texel, maxMetres);
}

/**
 * The receiver-plane gradient clamp for one map, in the map's own units.
 *
 * A receiver at slope tangent `slopeTanMax` relative to the light has
 * |d(depth)/d(uv)| = `slopeTanMax · 2·extent / depthRange`, because depth runs
 * 0..1 across `depthRange` metres and uv runs 0..1 across `2·extent` metres.
 * Past this the surface is near enough edge-on that the exact bias diverges and
 * the fragment is being killed by N·L anyway; clamping stops a silhouette texel
 * punching a bright hole.
 *
 * `depthRange` is `far − near` and NOT `far`. They differ by the near plane,
 * which is small, which is exactly why writing `far` here would be a mistake
 * that produces a plausible number and a slightly wrong clamp forever.
 */
export function slopeGradMax(
  slopeTanMax: number,
  extent: number,
  depthRange: number,
): number {
  return (slopeTanMax * 2 * extent) / depthRange;
}

/** Every number one directional shadow map's spec is made of. */
export interface ShadowMapSpec extends ShadowBox {
  /** Ortho half-extent, metres — echoed back so a caller can build a table. */
  extent: number;
  mapSize: number;
  normalBias: number;
  pcfTexels: number;
  gradMax: number;
}

/**
 * What a caller has to decide before any of the four conversions can run.
 *
 * **Every field is required and there is no default anywhere in this file.**
 * A default here is how one game silently inherits another's art direction:
 * `maxPcfTexels` alone is the difference between a 0.53-degree sun and a
 * 1.9-degree Earth, and a shared fallback would make the second look like the
 * first while every parity check stayed green.
 */
export interface ShadowMapInput {
  extent: number;
  mapSize: number;
  /** How far back the light sits BEFORE the box's own reach — see `shadowBox`. */
  lightNear: number;
  /** Multiple of the half-extent added to `lightNear`. */
  slack: number;
  near: number;
  /** Representative occluder height for this map, metres. */
  occluderHeight: number;
  /** The source's angular diameter, RADIANS. */
  sourceAngularDiameter: number;
  /** Ceiling on the PCF disc radius, texels. Wider source, wider cap. */
  maxPcfTexels: number;
  /** Normal offset quoted in texels, before the metre cap. */
  normalOffsetTexels: number;
  /** The largest visible detachment this game will accept, metres. */
  maxNormalOffsetM: number;
  /** Slope tangent past which the receiver-plane gradient is clamped. */
  slopeTanMax: number;
}

/**
 * All four conversions, once, in the order they depend on each other.
 *
 * This exists because the ORDER is the part that rots. `gradMax` needs `far −
 * near`, which needs `distance`, which needs `extent`; `normalBias` and
 * `pcfTexels` both need `texel`. Written out by hand at each call site — which
 * is how both of the base-building game's shadow rigs had it — the tempting
 * slip is quoting `gradMax` against `far` instead of `far − near`, which
 * produces a plausible number and a permanently slightly-wrong clamp.
 */
export function shadowMapSpec(input: ShadowMapInput): ShadowMapSpec {
  const box = shadowBox(
    input.extent, input.mapSize, input.lightNear, input.slack, input.near);
  return {
    ...box,
    extent: input.extent,
    mapSize: input.mapSize,
    normalBias: cappedNormalBias(
      input.normalOffsetTexels, box.texel, input.maxNormalOffsetM),
    pcfTexels: penumbraTexels(
      input.occluderHeight, input.sourceAngularDiameter, box.texel, input.maxPcfTexels),
    gradMax: slopeGradMax(input.slopeTanMax, input.extent, box.far - box.near),
  };
}

/**
 * WHERE EACH CASCADE'S BOX GOES ALONG THE VIEW, WHEN THE LADDER IS FITTED IN
 * DEPTH BANDS RATHER THAN ALL ON THE FOCUS POINT.
 *
 * The reflex fit centres every box on what the camera is looking at, biased
 * forward a little. It is one line and it wastes most of the near maps: boxes
 * 0 and 1 sit inside box 2, so the ground between the bottom of the frame and
 * the focus is resolved by whichever coarse box happens to contain it. Banding
 * gives each box its own STRETCH of ground — the near one starts at the bottom
 * edge of the frame and each next one starts a little before the last one ends.
 *
 * ## What the arithmetic is, in one paragraph, because it is the whole file
 *
 * A box of half-extent `e` is square in LIGHT space, so how far along the VIEW
 * it reaches depends on the angle between the view and the light's lateral
 * axes: `reach = e / projection`, where `projection` is the largest of the
 * forward vector's two lateral components. When the camera looks straight down
 * the light that component collapses and the reach goes to infinity, which is
 * why `projection` has a floor and the floor is the caller's — it is a
 * statement about how far a box may be allowed to run before the fit gives up
 * and behaves like the reflex one.
 *
 * A band must also be WIDE enough, not only long enough: at the distance the
 * band ends, the frame is `2 · d · tanHalfHorizontal` across, and the box only
 * covers `2 · e / sideProjection` of it. `dCap` is that constraint solved for
 * `d`, and a band is the smaller of "as long as the reach allows" and "as long
 * as it stays wider than the frame".
 *
 * The last `blanketCount` boxes are NOT banded. They are the ones large enough
 * to hold the whole visible ground, and banding them would push them past the
 * horizon for nothing.
 *
 * ## Every number is the caller's, and there are no defaults
 *
 * `bandOverlap` is how much of the previous band's reach the next one starts
 * inside — under 1 it is a cross-fade region, at 1 the bands abut and a
 * fragment on the seam is resolved by neither. `lateralFit` scales the width
 * constraint. `minProjection` is the floor above. Every one of them is a
 * statement about a particular camera over particular relief.
 *
 * Writes into `out` and returns it: this runs every frame.
 */
export interface CascadeBandWalk {
  /** Half-extent of each box, near to far. */
  extents: readonly number[];
  /** How many of the FAR boxes are blankets rather than bands. */
  blanketCount: number;
  /** Largest |forward · lateral axis|, already floored at `minProjection`. */
  projection: number;
  /** The same for the camera's side vector, already floored. */
  sideProjection: number;
  /** tan(fov/2) · aspect, already floored. */
  tanHalfHorizontal: number;
  /** Ground distance to the bottom edge of the frame. */
  nearDistance: number;
  /** Fraction of a band's own reach the next band starts before its end. */
  bandOverlap: number;
  /** Multiplier on the width constraint. */
  lateralFit: number;
}

/**
 * Ground distance for each banded cascade, ZERO for each blanket.
 *
 * UNROUNDED, and that is deliberate: these are positions a box is placed at,
 * and the game this came from published a rounded copy for readback while
 * snapping to the full-precision value. Rounding here would move every box by
 * up to 5 cm to make a console line tidier. Round at the reader.
 */
export function cascadeBandDistances(w: CascadeBandWalk, out: number[]): number[] {
  out.length = 0;
  const bandCount = Math.max(0, w.extents.length - w.blanketCount);
  let walk = w.nearDistance;
  for (let i = 0; i < w.extents.length; i++) {
    if (i >= bandCount) { out.push(0); continue; }
    const e = w.extents[i] as number;
    const reach = e / w.projection;
    const dCap = Math.max(w.nearDistance + reach * 0.5,
      (e / w.sideProjection) * w.lateralFit / w.tanHalfHorizontal);
    const bandD = Math.min(walk + reach, dCap);
    walk = bandD + reach * w.bandOverlap;
    out.push(bandD);
  }
  return out;
}
