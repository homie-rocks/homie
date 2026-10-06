/**
 * ============================================================================
 *  Three quality tiers as data: what High, Medium and Low each spend.
 * ============================================================================
 *
 *  `caps.ts` holds `PRESETS`, which answers "which effects are ON at this
 *  tier" for the games it came out of. A new 3D game needs a different table
 *  first: the handful of NUMBERS that decide what a frame costs, in one place,
 *  so that "make Low cheaper" is an edit to a row and not a hunt through the
 *  renderer, the post chain, the light rig and the prop scatter.
 *
 *  This is that table and nothing else. It is data: no detection (that is
 *  `detectQuality` in `caps.ts`), no renderer, no three. A game reads the row
 *  for its tier and hands each number to the thing that spends it, and it adds
 *  its own columns with {@link extendTiers}, which will not compile if one of
 *  the three tiers was forgotten.
 *
 *  THE SIX COLUMNS ARE THE SIX THINGS THAT SCALE A FRAME:
 *
 *    pixelRatioCap   pixels drawn, with the window size        (fill)
 *    msaa            samples per pixel on the scene target     (fill, memory)
 *    bloomHeight     rows in the largest bloom buffer          (fill)
 *    lights          dynamic lights lit at once                (per-pixel work)
 *    propDensity     fraction of scattered props kept          (vertices, draws)
 *    drawDistance    metres before a prop is not drawn at all  (vertices, draws)
 *
 *  The numbers shipped here are a starting point measured on nothing of
 *  yours: copy the table, change it, and keep the change in your game.
 * ============================================================================
 */
import { Quality } from './quality.ts';

export type TierName = 'high' | 'medium' | 'low';
export const TIER_NAMES: readonly TierName[] = ['high', 'medium', 'low'];

/** What one tier spends. Every field is a number a game hands to something. */
export interface GameTier {
  /** Ceiling on drawing-buffer pixels per CSS pixel, per axis. */
  readonly pixelRatioCap: number;
  /** MSAA samples on the scene target. 0 is off. */
  readonly msaa: number;
  /** Height in pixels of the largest bloom buffer. 0 is no bloom. */
  readonly bloomHeight: number;
  /** Dynamic lights lit at once. */
  readonly lights: number;
  /** Fraction of scattered props kept, 0..1. */
  readonly propDensity: number;
  /** Metres past which a prop is not drawn. */
  readonly drawDistance: number;
}

export const GAME_TIERS: Readonly<Record<TierName, GameTier>> = {
  high: { pixelRatioCap: 2, msaa: 4, bloomHeight: 480, lights: 12, propDensity: 1, drawDistance: 160 },
  medium: { pixelRatioCap: 1.5, msaa: 2, bloomHeight: 360, lights: 6, propDensity: 0.65, drawDistance: 110 },
  low: { pixelRatioCap: 1, msaa: 0, bloomHeight: 240, lights: 3, propDensity: 0.35, drawDistance: 70 },
};

/**
 * Add a game's own columns to the table, or override shipped ones.
 *
 * `extra` must name all three tiers, and every tier must carry the same
 * fields, so a column added for High and forgotten for Low is a compile error
 * rather than an `undefined` on the one device nobody tested.
 */
export function extendTiers<X extends object>(
  extra: Readonly<Record<TierName, X>>,
  base: Readonly<Record<TierName, GameTier>> = GAME_TIERS,
): Record<TierName, GameTier & X> {
  return {
    high: { ...base.high, ...extra.high },
    medium: { ...base.medium, ...extra.medium },
    low: { ...base.low, ...extra.low },
  };
}

/** The tier name for a `Quality` from `caps.ts`. Ultra reads the High row. */
export function tierName(quality: Quality): TierName {
  return quality >= Quality.High ? 'high' : quality === Quality.Medium ? 'medium' : 'low';
}

/** One step cheaper, or the same tier at the bottom. For a "lower quality" button. */
export function tierBelow(name: TierName): TierName {
  return name === 'high' ? 'medium' : 'low';
}

/**
 * The pixel ratio to hand the renderer: the device's, under the tier's cap,
 * times a dynamic-resolution scale.
 *
 * The scale multiplies AFTER the cap. Capping after would let a scale of 0.7
 * on a 3x phone still land on the cap, which is a controller that reports a
 * drop and draws the same pixels.
 */
export function tierPixelRatio(tier: GameTier, devicePixelRatio: number, scale: number): number {
  return Math.min(devicePixelRatio, tier.pixelRatioCap) * scale;
}

/** How many of `total` scattered props a tier keeps: at least one of any that exist. */
export function tierPropCount(tier: GameTier, total: number): number {
  return total <= 0 ? 0 : Math.max(1, Math.round(total * tier.propDensity));
}
