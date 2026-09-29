/**
 * ============================================================================
 *  grate.ts — bar grating as a CONSTRUCTION SPEC, and the aperture that
 *  follows from it. The CPU twin of `Grating.ts`'s silhouette clip.
 * ============================================================================
 *  `Grating.ts` draws open bar grating. This file answers the question that
 *  has to be settled BEFORE anything draws it: given a panel of `w`-wide bar
 *  on pitch `p`, tied at `tiePitch` and banded at the panel edge, how much sky
 *  reaches a ray arriving at azimuth `psi` and depression `phi`? Every
 *  consumer of an open deck needs that number — the material's silhouette
 *  clip, the placement logic deciding whether anything may be parked on it,
 *  and the texture builder deciding how many periods to bake — and when they
 *  each deduce it separately they disagree, silently, and the deck is shut.
 *
 *  IT SHIPS NO DIMENSIONS. Every function takes a `GrateSpec`; there is no
 *  default spec and there deliberately never will be, because a bar width and
 *  an open fraction are a game's art direction and a shared default is how the
 *  next game inherits this one's deck. What is shared is the ARITHMETIC.
 *
 *  Nothing here imports anything. It is pure maths over eleven numbers, which
 *  is what lets a Node harness, a shader author and a mesh builder all call
 *  the same body and be unable to drift apart.
 *
 * ---------------------------------------------------------------------------
 *  THE PHYSICS, ONCE, SO NO CONSUMER RE-DERIVES IT
 * ---------------------------------------------------------------------------
 *  1. THE PITCH IS DERIVED, NOT CHOSEN. A run of `w`-wide bar on pitch `p` is
 *     `(p − w)/p` open, so a bar width and an open fraction fix the pitch:
 *     `p = w / (1 − open)`. They are not two independent taste values, and
 *     writing either as a literal somewhere else is how they come apart.
 *
 *  2. BAR GRATING IS AN ANISOTROPIC APERTURE AND IT IS OPAQUE LONG BEFORE IT
 *     IS EDGE-ON. A sightline crossing the bars at `θ` above the plane travels
 *     `d/tan θ` sideways while it falls the bar depth `d`, so it clears the
 *     slot only while `θ > atan(barD / (pitch − barW))`. Below that angle an
 *     across-the-bars deck is 100 % CLOSED — not dim, closed — and no work in
 *     a fragment shader can put sky behind a fragment whose own geometry
 *     occludes it. Which way the bearing bars RUN is therefore a physical
 *     bound on what can be seen through the deck, not a preference: turn them
 *     along the line of sight and the slot is a continuous open channel that a
 *     forward ray never crosses a bar in at all.
 *
 *  3. THE TIES ARE THE SECOND FREQUENCY. Transverse tie rods are shallow and
 *     coarsely pitched, so their own critical angle
 *     `atan(tieD / (tiePitch − tieW))` is small — a couple of degrees — and
 *     they are usually what actually limits the reach ALONG the slots. One
 *     fine pitch across and one coarse pitch along, with different critical
 *     angles, is a surface; a single frequency in one direction is a
 *     checkerboard.
 *
 *  4. THE PANEL BANDING IS THE THIRD, AND IT IS THE FAR-FIELD ONE. Real
 *     grating arrives as PANELS with a banding bar closing the slot ends, in
 *     the same stock as the bearing bar. It is sparse rather than periodic at
 *     the slot scale, so it THINS the aperture rather than closing it — a hit
 *     probability over the panel run — and it buys back a legible rhythm at
 *     distances where the bar and tie pitches have long since gone under two
 *     pixels and mipped to one flat value.
 *
 *  5. THE OPEN FRACTION EVERYONE QUOTES IS THE BAR'S, NOT THE PANEL'S. Bars ×
 *     ties × banding is several points lower than the bar figure alone, which
 *     is why `netOpen` is published separately rather than the two being
 *     conflated. Anything photometric wants `netOpen`; anything asking "is
 *     this deck open at all" wants the authored figure.
 * ============================================================================
 */

/**
 * Eleven numbers that describe one grating panel. All lengths in metres.
 *
 * `barsAlong` says whether the BEARING BARS run along the primary direction of
 * travel/sight (true) or across it. Per note 2 it is the single number that
 * decides whether anything can be seen through this deck at a shallow angle,
 * so it is part of the spec rather than something a caller remembers.
 */
export interface GrateSpec {
  /** bearing-bar width in plan */
  barW: number;
  /** bearing-bar depth on edge */
  barD: number;
  /** authored open fraction OF THE BEARING BARS ALONE */
  barOpen: number;
  /** transverse tie-rod pitch */
  tiePitch: number;
  tieW: number;
  tieD: number;
  /** panel width ACROSS the bar run */
  panelW: number;
  /** panel length ALONG the bar run */
  panelL: number;
  /** banding bar closing the panel edge — normally the same stock as the bar */
  bandW: number;
  bandD: number;
  /** true when the bearing bars run along the line of sight (note 2) */
  barsAlong: boolean;
}

/** Everything that follows from a `GrateSpec` by arithmetic alone. */
export interface GrateDerived {
  /** `barW / (1 − barOpen)`, note 1 */
  barPitch: number;
  /** honest plan-open fraction of the finished panel: bars × ties × banding */
  netOpen: number;
  /**
   * Radians above the plane at which the deck stops being transparent, ACROSS
   * the bars, ALONG the slots past the ties, and along the slots past the
   * panel banding.
   *
   * Published as ANGLES rather than as ratios because every consumer of them
   * is a sightline: a material's parallax march wants the across figure as the
   * angle at which its silhouette clip must go fully opaque, and anything
   * asking "can the sky be seen from here" wants the along figure. The banding
   * angle is published only so the ordering `openBand < openAlong` can be
   * asserted — the ties must bind first and the banding must never overtake
   * them (note 4).
   */
  openAcross: number;
  openAlong: number;
  openBand: number;
}

export function grateDerived(s: GrateSpec): GrateDerived {
  const barPitch = s.barW / (1 - s.barOpen);
  return {
    barPitch,
    netOpen: s.barOpen
      * (1 - s.tieW / s.tiePitch)
      * (1 - s.bandW / s.panelL)
      * (1 - s.bandW / s.panelW),
    openAcross: Math.atan2(s.barD, barPitch - s.barW),
    openAlong: Math.atan2(s.tieD, s.tiePitch - s.tieW),
    openBand: Math.atan2(s.bandD, s.panelL - s.bandW),
  };
}

/**
 * ===========================================================================
 *  THE APERTURE, AS A FUNCTION OF THE SIGHTLINE. THIS IS WHAT "62 % OPEN"
 *  ACTUALLY MEANS, AND IT IS THE NUMBER EVERY CONSUMER DEDUCES WRONG.
 * ===========================================================================
 * `psi` is the sightline's azimuth off the BAR RUN (0 = straight down a slot,
 * ±90° = square across the bars); `phi` is its depression below the plane.
 * Returns the fraction of such rays that reach the sky, 0..1 — which is the
 * silhouette clip a POM march needs, the weight a sky pass needs to know
 * whether anything is resolvable through the deck, and the term that decides
 * whether a see-through floor happens at all.
 *
 * Each of the three obstructions is a channel of some depth that the ray has
 * to fall through before it drifts into the far wall, so each contributes an
 * independent survival fraction and they MULTIPLY:
 *
 *   • the BARS: falling `barD` takes `barD / tan φ` of horizontal run, over
 *     which the ray drifts `barD · |sin ψ| / tan φ` sideways. It survives if
 *     that is under the slot. This is the `openAcross` bound.
 *   • the TIES: the same argument in the other axis, shallower on a much
 *     coarser clear pitch, which is what usually limits the reach.
 *   • the BANDING: full bar depth, but only one per panel length, so it thins
 *     rather than closes (note 4).
 *
 * IT IS A FRACTION, NOT A BOOLEAN, and that is the whole point — a material
 * that treats the deck as open or shut produces a two-value checkerboard. A
 * ray a few degrees down a slot gets most of the sky, not all of it and not
 * none, and the gradient between them along a receding deck IS the surface.
 *
 * Cheap enough to call per-fragment (three divides, two sin/cos, no loop) and
 * cheap enough to call per-station on the CPU, which is deliberate: the shader
 * and the placement logic have to agree or the aperture moves between them.
 */
export function grateAperture(s: GrateSpec, psi: number, phi: number): number {
  if (!(phi > 0)) return 0;
  const pitch = s.barW / (1 - s.barOpen);
  const t = Math.tan(phi);
  const across = 1 - (s.barD * Math.abs(Math.sin(psi)) / t) / (pitch - s.barW);
  if (across <= 0) return 0;
  const along = 1 - (s.tieD * Math.abs(Math.cos(psi)) / t) / (s.tiePitch - s.tieW);
  if (along <= 0) return 0;
  // the banding is sparse rather than periodic-at-the-slot-scale, so it is a
  // hit probability over the panel run, not a channel-clearance fraction
  const band = 1 - Math.min(1, s.bandD / (t * s.panelL));
  return across * along * Math.max(0, band);
}

/**
 * How far along the deck an eye at height `eye` can still see through it.
 *
 * Walks outward from the eye until `grateAperture` shuts, and returns the last
 * distance that was still open. This is the one number that flipping
 * `barsAlong`, deepening the ties or thinning the slot silently destroys, and
 * it is a pure function of the spec — no sky, no material, no mesh — so it can
 * be asserted at bake time by anybody who has the eleven numbers.
 *
 * `psi` defaults to 0: straight down the bar run, which is the sightline a
 * chase camera owns and the best case the spec admits.
 */
export function grateSightReach(
  s: GrateSpec, eye: number,
  { psi = 0, maxD = 200, step = 0.5, shut = 0.05 } = {},
): number {
  let reach = 0;
  for (let d = step * 2; d <= maxD; d += step) {
    if (grateAperture(s, psi, Math.atan2(eye, d)) < shut) break;
    reach = d;
  }
  return reach;
}

/** What `grateRepeats` returns. */
export interface GrateRepeats {
  /** bar periods across the U axis of one tile */ bars: number;
  /** tie periods along the V axis of one tile */ ties: number;
  /** panel-banding periods, U and V */ bandsU: number; bandsV: number;
  /** what the integer rounding actually delivers, metres */
  barPitch: number; tiePitch: number;
  /**
   * Human-readable complaints, empty when the tile is sound. Returned rather
   * than logged so the CALLER decides whether a bake-time warning belongs on
   * the console — a package that writes to a game's console has picked the
   * game's log format for it.
   */
  warnings: string[];
}

/**
 * How the grating's three frequencies land in a UV tile of stated world size.
 * **Call this instead of writing a repeat count.**
 *
 * A mesh that gives its deck `u = lateral / tile`, `v = distance / tile` needs
 * metres-per-tile → periods, and doing that conversion by eye is how a 38 mm
 * bar becomes a 1.6 m one: sixteen times the contract, and a flat opaque
 * checkerboard at a single frequency. There is now one function, it lives with
 * the arithmetic, and it reports.
 *
 * Bars vary in U because they RUN along V when `barsAlong`; ties vary in V.
 * Getting that backwards is silent and it closes the aperture completely.
 *
 * Every count is rounded to an integer or the pattern does not tile, and the
 * REALISED pitch is returned alongside so a caller can see what the rounding
 * cost. Pass `texSize` and it also checks the one thing rounding cannot fix:
 * the BAR, not the period, is what has to survive, and a bar is a minority of
 * its period. Under three texels it has no two edges and a midline, so it
 * aliases into exactly the moiré this spec exists to avoid — and coverage mips
 * then faithfully preserve a silhouette that was already wrong.
 */
export function grateRepeats(
  s: GrateSpec, tileU: number, tileV: number, texSize = 0,
): GrateRepeats {
  const specPitch = s.barW / (1 - s.barOpen);
  const bars = Math.max(1, Math.round(tileU / specPitch));
  const ties = Math.max(1, Math.round(tileV / s.tiePitch));
  const bandsU = Math.max(1, Math.round(tileU / s.panelW));
  const bandsV = Math.max(1, Math.round(tileV / s.panelL));
  const barPitch = tileU / bars, tiePitch = tileV / ties;
  const warnings: string[] = [];
  if (Math.abs(barPitch / specPitch - 1) > 0.06) {
    warnings.push(
      `UV tile ${tileU.toFixed(2)} m gives a realised bar pitch of ${(barPitch * 1000).toFixed(0)} mm ` +
      `against the ${(specPitch * 1000).toFixed(0)} mm the spec derives from ` +
      `"${(s.barW * 1000).toFixed(0)} mm bar, ${(s.barOpen * 100).toFixed(0)} % open" — the deck will ` +
      'read at the wrong scale. Give the grating its own map.repeat rather than inheriting the tile.',
    );
  }
  const barTexels = texSize * (s.barW / tileU);
  if (texSize > 0 && barTexels < 3) {
    warnings.push(
      `a ${(s.barW * 1000).toFixed(0)} mm bar over a ${tileU.toFixed(2)} m tile at ${texSize}px is ` +
      `${barTexels.toFixed(1)} texels wide — no two edges and a midline, so the map will moiré rather ` +
      'than resolve, and coverage mips will preserve a silhouette that was already wrong. Give the ' +
      `grating its own map.repeat (a ${s.panelW.toFixed(2)} m panel-width tile puts ` +
      `${(texSize * (s.barW / s.panelW)).toFixed(0)} texels on the bar).`,
    );
  }
  return { bars, ties, bandsU, bandsV, barPitch, tiePitch, warnings };
}
