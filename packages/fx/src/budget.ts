/*
 * ----------------------------------------------------------------------------
 *  WHAT A QUALITY TIER BUYS, AT BOOT — the pool capacities, once.
 * ----------------------------------------------------------------------------
 *  Lifted out of both racers' `Effects.init`, where it was the same arithmetic
 *  on the same eleven numbers in both, measured 2026-08-20.
 *
 *  This is capacity, not gain. `energy.ts` owns the PER-FRAME governor that
 *  decides how much of that capacity a crowded frame is allowed to spend; this
 *  runs once, at init, and decides how big the rings are in the first place.
 *  They are two different questions and a fix to one is not a fix to the other.
 *
 *  WHY IT IS WORTH ONE FILE. Every number here is a mobile fill-rate decision
 *  that somebody measured, and there were two copies of all of them — so a
 *  capacity fix had two chances to land in one game and be missed in the other,
 *  and the miss looks exactly like a fix that worked.
 *
 *  Nothing here knows what a race, a lap, a track or an item is. It knows a
 *  quality tier and a density, and it answers with sizes.
 * ----------------------------------------------------------------------------
 */

/**
 * The quality ordinals this file compares against.
 *
 * THE AUTHORITY IS `@homie-rocks/render/caps.js`'s `Quality`, and this is a MIRROR of
 * it rather than a second opinion. It is written out here because `@homie-rocks/fx`
 * does not depend on `@homie-rocks/render` and adding that edge to reach four small
 * integers would be the more expensive of the two mistakes.
 *
 * A MIRROR THAT IS NOT CHECKED IS JUST A SECOND PLACE TO BE WRONG, so it is
 * checked: a test imports the real `Quality` and requires every name and every
 * ordinal to match this object exactly, and goes red if either side gains,
 * loses or renumbers a tier. A second check asserts the same four numbers at
 * RUNTIME in every game that uses them. A silent renumber would re-tier every
 * capacity below; it cannot happen quietly with both of those in the way.
 */
export const Tier = { Low: 0, Medium: 1, High: 2, Ultra: 3 } as const;

/** Everything `Effects.init` needs to size its pools. */
export interface PoolBudget {
  /** The density multiplier the emitters and the governor's `base` both take. */
  dens: number;
  /** Medium and below. Drives the LOD curve as well as the sizes here. */
  mobile: boolean;
  /** Additive particle ring capacity. */
  addCap: number;
  /** Alpha-blended particle ring capacity. */
  alphaCap: number;
  /** Atlas tile edge, in pixels — the same figure for particles and decals. */
  tile: number;
  /** Decal ring capacity. */
  decalCap: number;
}

export function poolBudget(quality: number, particleDensity: number): PoolBudget {
  const mobile = quality <= Tier.Medium;
  // DENSITY IS A TIER, NOT A TRIM — but the tier is not bought here alone.
  //
  // The presets ask for 0.35 / 0.6 / 1.0 / 1.4. Raising the sub-1 end to the
  // power 1.5 takes Medium to 0.46 and Low to 0.21 while leaving High and
  // Ultra exactly where the art direction put them. That is deliberately not
  // the whole of "far fewer on a phone": the rest — and most of it — comes
  // from the distance curve in `lodOf`, which thins the SEVEN RIVALS hard and
  // leaves the player's own kart at full rate. Cutting the field is nearly
  // free because a rival at 40 m on a 390-pixel-tall screen is two dozen
  // pixels; cutting the player's own drift shower by the same factor would be
  // fixing mobile by making the game worse, which is the one thing the
  // readability layer must not do.
  const p = particleDensity;
  const dens = quality >= Tier.High ? p : p * Math.sqrt(p);

  return {
    dens,
    mobile,
    addCap: Math.round(clamp(3400 * dens, 1200, 4200)),
    alphaCap: Math.round(clamp(2400 * dens, 850, 3000)),
    // 128-pixel tiles on mobile: a quarter of the atlas memory, a quarter of the
    // boot cost to synthesise it, and no visible difference on sprites that are
    // soft by construction and never drawn much above 100 px.
    tile: mobile ? 128 : 256,
    // Quality-scaled, and it matters more than it looks: every quad in this ring
    // is a blended, texture-fetching fragment lying flat on the road, so the
    // capacity is a direct multiplier on mobile fill rate in the worst case
    // (the frame on which the live window straddles the ring's wrap).
    decalCap: quality <= Tier.Low ? 600
      : quality <= Tier.Medium ? 1200
        : quality <= Tier.High ? 2400 : 3200,
  };
}

/**
 * THE OTHER ENTRY POINT: a tier ladder, read at the tier the machine is running at.
 *
 * `poolBudget` above answers the tier question for the ELEVEN NUMBERS every
 * particle system in this repository shares. This answers it for a caller whose
 * ladder is its own — a crowd size, a fleet size, an adoption headroom, a decal
 * ring for a population nothing else has. Those numbers are content and they
 * stay with the content; what does not have to be re-typed is the INDEXING.
 *
 * IT IS THREE LINES AND IT IS STILL WORTH ONE FUNCTION. Not because the
 * arithmetic is hard, but because the failure it prevents is silent: a caller
 * that indexes with a raw quality value reads `undefined` the day a fifth tier
 * is added or a value arrives fractional, and `undefined` propagates into a
 * pool capacity as NaN, which sizes a ring at zero and simply renders nothing.
 * Clamping and flooring in one place is the difference between a new tier being
 * a one-line change and being a hunt.
 *
 * `Tier` above is the authority on how many rungs there are, and this asserts
 * the ladder it is handed has exactly that many — a four-entry table read at a
 * five-tier ordinal is the same silent `undefined` wearing a different hat.
 */
export function tierPick<T>(quality: number, ladder: readonly T[]): T {
  if (ladder.length !== 4) {
    throw new Error(`tierPick: ladder has ${ladder.length} rungs, Tier has 4`);
  }
  const q = quality <= Tier.Low ? Tier.Low
    : quality >= Tier.Ultra ? Tier.Ultra : Math.floor(quality);
  return ladder[q]!;
}

/**
 * `THREE.MathUtils.clamp`, written out so this module does not import three.
 *
 * It is four lines of arithmetic and no geometry, and keeping it three-free
 * means a harness can read a capacity without standing up a renderer.
 */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
