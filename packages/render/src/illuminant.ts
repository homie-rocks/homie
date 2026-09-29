/**
 * ============================================================================
 *  illuminant — MOVE A LIGHT'S HUE WITHOUT MOVING THE EXPOSURE.
 * ============================================================================
 *
 *  Von-Kries-shaped PARTIAL chromatic adaptation, at constant luminance.
 *
 *  ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 *  A key light is authored as a display colour — #fff4e8, a warm sun — and then
 *  every albedo in the scene is multiplied by it, so an authored warmth
 *  compounds with every surface it touches and the whole frame ends up further
 *  from neutral than anybody chose. A viewer standing under one dominant
 *  illuminant does not see it that way: their vision partially discounts the
 *  illuminant. CIECAM's degree-of-adaptation D for that case sits between 0.7
 *  and 0.9, and this is that discount applied to the light instead of to two
 *  hundred materials.
 *
 *  ── THE RENORMALISATION IS THE WHOLE FUNCTION ──────────────────────────────
 *
 *  The last two lines are not tidiness. Without them, pulling #fff4e8 toward
 *  neutral RAISES the green and blue channels and hands the scene about 4% more
 *  irradiance than the light's stated intensity — which is then measured later
 *  as an exposure regression and fixed somewhere else, at which point the
 *  hue change and the exposure fix are in two different files and neither one
 *  can be backed out. Luminance in, same luminance out: this is a hue change
 *  and only a hue change.
 *
 *  ── COLOUR SPACE, SAID ONCE ────────────────────────────────────────────────
 *
 *  `into` is written in the renderer's WORKING space, which is where a
 *  `THREE.Color` on a light lives, and `setHex` decodes the authored sRGB on
 *  the way in. There is no encode/decode anywhere else in here, deliberately:
 *  converting again would grade a gamma-encoded ratio into a linear multiply,
 *  which is the double-transfer bug the whole technique exists to undo.
 *
 *  ── WHY HERE, AND WHY NOT A NEW PACKAGE ────────────────────────────────────
 *
 *  An early plan filed this under a separate celestial package that was never
 *  built, and the implementation is TWELVE substantive lines that lived in a
 *  base-building game's lighting module. A whole package for twelve lines is
 *  silly, so it goes where the rest of the celestial code went.
 *  `@homie-rocks/render` already holds `starfield.ts` (blackbody, B−V to
 *  Kelvin), `nishita.ts`, `skyrig.ts` and `keyrim.ts` — every celestial thing
 *  written so far is in this package, and this is one more piece of
 *  light-colour arithmetic beside them.
 *
 *  It is NOT in `colour.ts`, one directory over, and that is on purpose:
 *  `colour.ts` states in its own header that it has no dependencies, takes
 *  `Float64Array`s and never mentions `THREE.Color`. What a caller wants here
 *  is the colour ON A LIGHT, so the type is `THREE.Color`, and putting a
 *  three-importing function into the file whose whole claim is that it imports
 *  nothing would break the more useful property.
 */
import * as THREE from 'three';

/** Rec.709 relative luminance, floored so a black illuminant cannot divide. */
const luma = (c: THREE.Color): number =>
  Math.max(1e-5, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);

const _src = new THREE.Color();

/**
 * Adapt an authored illuminant `hex` toward neutral by degree `d`, writing the
 * result into `into` and returning it.
 *
 * `d = 0` is the authored colour delivered raw. `d = 1` is a literally neutral
 * illuminant — available for measurement, and an ablation rather than a look.
 * Anything between is the useful range; 0.75 is the textbook figure.
 *
 * Allocation-free apart from `into`, because this is called from an ablation
 * handle a harness may drive in a loop.
 */
export function adaptIlluminant(hex: number, d: number, into: THREE.Color): THREE.Color {
  const src = _src.setHex(hex);
  const y = luma(src);
  if (d <= 0) return into.copy(src);
  // Chromaticity normalised to luminance 1, pulled toward (1,1,1) by d.
  const e = 1 - d;
  into.setRGB(
    Math.pow(Math.max(1e-5, src.r / y), e),
    Math.pow(Math.max(1e-5, src.g / y), e),
    Math.pow(Math.max(1e-5, src.b / y), e),
  );
  // Back to the ORIGINAL luminance. Hue moved; exposure did not.
  const k = y / luma(into);
  return into.setRGB(into.r * k, into.g * k, into.b * k);
}
