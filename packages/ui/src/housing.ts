/*
 * ============================================================================
 *  housing.ts — an instrument drawn as a BOLTED FIXTURE, not a stroked rect.
 * ============================================================================
 *  Published out of the space racer's HUD.
 *
 *  WHAT IT IS. A chamfered plate with a two-fill anodised face, a value break
 *  across its middle, one abraded corner, a serial stencilled up a rail, a
 *  moulded bezel (lit top edge, inboard highlight, dark sill, two side rails),
 *  the chamfer caught by the key, and four drilled fasteners. Say that without
 *  naming a game and nothing drops out of the sentence: it is a rectangle
 *  painted as an object that somebody manufactured and bolted on.
 *
 *  WHY A HUD WANTS ONE. A gauge whose plate is a DARKENING — `rgba(0,0,0,α)`
 *  and nothing else — has no polarity of its own: over a dark frame the plate
 *  is the frame, and over a bright one the fill measures darker than the wall
 *  ten pixels outboard. That shipped, was photographed, and is why the face
 *  here is two fills — a knock-down that removes what was behind it, then an
 *  opaque-enough coat with a VALUE FLOOR — rather than one translucent grey.
 *
 *  ── EVERY COLOUR AND EVERY RATIO IS THE CALLER'S ────────────────────────────
 *  There is not one hex, one alpha and one proportion in this file. A default
 *  here would be the next game inheriting the first game's instrument, which is
 *  the precise failure mode to watch for: parity stays green while the look
 *  crosses the seam. `HousingSkin` has no optional field and no default value,
 *  so a second consumer cannot arrive by accident.
 *
 *  ── THE TWO REGIMES ARE A COAT EACH, NOT A BOOLEAN SPRINKLED THROUGH ────────
 *  A transflective panel in direct light turns its FACE light and lets the
 *  recesses stay dark; it does not brighten its ink. So `bright` selects a
 *  whole `HousingCoat` at the top and the paint order below never asks again.
 *  That is also what makes `housingFace`/`housingBezel` possible: the audit a
 *  caller runs on its own contrast can REPLAY this stack from the same coat
 *  instead of keeping a second table of hexes that only attention keeps true.
 * ============================================================================
 */

import { overRGB, type RGB } from './colour.ts';

export type { RGB };

/** A colour, 0..255 per channel, unpremultiplied. */
export type Ink = readonly [number, number, number];

/**
 * An alpha: either a constant, or `[constant, coefficient]` against a drive.
 *
 * Two drives exist and each is named where it is used — `v`, the backlight,
 * for the face stack, and `lit`, the pulse, for the bezel's top edge. Nothing
 * here decides what either one means.
 */
export type Alpha = number | readonly [number, number];

const a1 = (a: Alpha, drive: number): number =>
  typeof a === 'number' ? a : a[0] + a[1] * drive;

const rgba = (ink: Ink, a: number): string =>
  'rgba(' + ink[0] + ', ' + ink[1] + ', ' + ink[2] + ', ' + a.toFixed(3) + ')';

/** Everything the fixture is painted in, for ONE lighting regime. */
export interface HousingCoat {
  /** The void knock-down: what is behind the plate stops being information. */
  knock: Ink; knockA: Alpha;
  /** The anodised face laid over the knock-down. */
  face: Ink; faceA: Alpha;
  /** A value break across the middle so the face is not one flat tone. */
  band: Ink; bandA: Alpha;
  /** Alpha of a caller-supplied state wash over the whole face. */
  tintA: Alpha;
  /** The corner worn back to primer. */
  abrade: Ink; abradeA: Alpha;
  /** The stencilled serial. */
  serial: Ink; serialA: Alpha;
  /** The bezel's top edge — the one part that reads as a light source. */
  lip: Ink; lipA: Alpha;
  /** The inboard highlight one pixel in, in the same ink as the lip. */
  lipHiA: Alpha;
  /** The bezel's bottom edge, under a key that comes from above. */
  sill: Ink; sillA: Alpha;
  /** The two side rails. */
  rail: Ink; railA: Alpha;
  /** The chamfer itself, caught by the key. */
  arris: Ink; arrisA: Alpha;
  /** A fastener's dark bore and its drilled collar. */
  boltBore: Ink; boltBoreA: Alpha;
  boltRing: Ink; boltRingA: Alpha;
}

/** Every proportion of the fixture. All in `px` (the caller's device unit) or fractions. */
export interface HousingGeom {
  /** The chamfer, in `px`, floored so it survives a tiny panel. */
  chamferPx: number; chamferFloor: number;
  /** The value break's top and height, as fractions of the plate. */
  bandY: number; bandH: number;
  /** The abraded corner's reach along the top edge and down the side, in chamfers. */
  abradeW: number; abradeH: number;
  /** Serial cap height in `px` with a floor, its inset from the rail, and where it sits. */
  serialCapPx: number; serialCapFloor: number; serialInsetPx: number; serialY: number;
  /** Serial tracking and stroke weight, handed to the face renderer. */
  serialTrack: number; serialWeight: number;
  /** How much the lit top edge grows with the pulse, as a multiple of `px`. */
  lipGrow: number;
  /** The inboard highlight's height in `px`, floored. */
  lipHiPx: number; lipHiFloor: number;
  /** The chamfer stroke's width in `px`, floored. */
  arrisPx: number; arrisFloor: number;
  /** Fastener radius in `px` with a floor, inset in chamfers, collar width in `px`. */
  boltRPx: number; boltRFloor: number; boltInsetCh: number;
  boltRingPx: number; boltRingFloor: number;
}

export interface HousingSkin {
  dark: HousingCoat;
  bright: HousingCoat;
  geom: HousingGeom;
}

/** What varies between one draw and the next. */
export interface HousingState {
  /** Backlight, 0..1. Every face alpha is a function of it. */
  v: number;
  /** Above the caller's own threshold the whole fixture swaps coats. */
  bright: boolean;
  /** Pulse on the top edge, 0..1. At 0 this is exactly the resting bezel. */
  lit: number;
  /** A state wash over the face, as a ready CSS colour, or nothing. */
  tint?: string;
  /** Stencilled up the outboard rail. Whatever the face can draw. */
  serial?: string;
  /** Put the abraded corner and the serial on the other side. */
  mirror?: boolean;
}

/** Draws a serial: the caller's own letterforms, at `cap` px, baseline-top at (x, y). */
export type HousingSerialPen = (
  g: CanvasRenderingContext2D, s: string, x: number, y: number,
  cap: number, track: number, weight: number,
) => void;

/**
 * The chamfered outline, as a path on `g`. Exported because a caller that
 * paints INSIDE the fixture has to clip to the same octagon the fixture was
 * cut to, and two hand-written copies of an eight-point path is how a panel
 * ends up assembled from mis-registered rectangles.
 */
export function chamferPath(
  g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ch: number,
): void {
  g.beginPath();
  g.moveTo(x + ch, y);
  g.lineTo(x + w - ch, y);
  g.lineTo(x + w, y + ch);
  g.lineTo(x + w, y + h - ch);
  g.lineTo(x + w - ch, y + h);
  g.lineTo(x + ch, y + h);
  g.lineTo(x, y + h - ch);
  g.lineTo(x, y + ch);
  g.closePath();
}

/** The chamfer this skin cuts at this `px`. */
export const housingChamfer = (skin: HousingSkin, px: number): number =>
  Math.max(skin.geom.chamferFloor, px * skin.geom.chamferPx);

/**
 * Paint the fixture into `x, y, w, h`. `px` is the caller's device unit — one
 * reference pixel — and every dimension in `geom` is a multiple of it.
 *
 * `pen` is only consulted when `state.serial` is set, so a caller with no
 * lettering can hand in a pen that does nothing and lose no correctness.
 */
export function drawHousing(
  g: CanvasRenderingContext2D, skin: HousingSkin,
  x: number, y: number, w: number, h: number, px: number,
  state: HousingState, pen: HousingSerialPen,
): void {
  const G = skin.geom;
  const c = state.bright ? skin.bright : skin.dark;
  const v = state.v;
  const lit = state.lit;
  const ch = Math.max(G.chamferFloor, px * G.chamferPx);
  const path = () => chamferPath(g, x, y, w, h, ch);

  g.save();
  path();
  g.clip();

  // 1. knock the scene down, 2. lay the anodised face on top of it. Two fills
  // and not one, because a single translucent grey over a blown background is
  // still the blown background with a grey cast on it.
  g.fillStyle = rgba(c.knock, a1(c.knockA, v));
  g.fillRect(x, y, w, h);
  g.fillStyle = rgba(c.face, a1(c.faceA, v));
  g.fillRect(x, y, w, h);
  // A per-panel value break, so the face is not one flat tone.
  g.fillStyle = rgba(c.band, a1(c.bandA, v));
  g.fillRect(x, y + h * G.bandY, w, h * G.bandH);
  if (state.tint) {
    g.fillStyle = state.tint;
    g.globalAlpha = a1(c.tintA, v);
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
  }

  // THE ABRADED CORNER. One corner worn back to primer — the mark that says
  // this panel has an age. On the leading edge only: the edge a boot reaches.
  const axx = state.mirror ? x + w - ch * G.abradeW : x;
  g.fillStyle = rgba(c.abrade, a1(c.abradeA, v));
  g.beginPath();
  g.moveTo(axx, y);
  g.lineTo(axx + ch * G.abradeW, y);
  g.lineTo(axx, y + ch * G.abradeH);
  g.closePath();
  g.fill();

  // THE SERIAL, stencilled up the outboard rail.
  if (state.serial) {
    const cap = Math.max(G.serialCapFloor, px * G.serialCapPx);
    g.save();
    g.translate(state.mirror ? x + w - px * G.serialInsetPx : x + px * G.serialInsetPx,
      y + h * G.serialY);
    g.rotate(-Math.PI / 2);
    g.strokeStyle = rgba(c.serial, a1(c.serialA, v));
    pen(g, state.serial, 0, -cap * 0.5, cap, G.serialTrack, G.serialWeight);
    g.restore();
  }
  g.restore();

  // THE BEZEL. A lit top edge and a dark sill under a key that comes from
  // above — plus an inboard highlight one pixel in, which is the mark that
  // makes it read as a MOULDING rather than as a stroked rectangle. `lit`
  // breathes the top edge; at 0 this is exactly the bezel it always was.
  g.save();
  path();
  g.clip();
  g.fillStyle = rgba(c.lip, a1(c.lipA, lit));
  g.fillRect(x, y, w, px * (1 + lit * G.lipGrow));
  g.fillStyle = rgba(c.lip, a1(c.lipHiA, lit));
  g.fillRect(x + px, y + px, w - px * 2, Math.max(G.lipHiFloor, px * G.lipHiPx));
  g.fillStyle = rgba(c.sill, a1(c.sillA, v));
  g.fillRect(x, y + h - px, w, px);
  g.fillStyle = rgba(c.rail, a1(c.railA, v));
  g.fillRect(x, y, px, h);
  g.fillRect(x + w - px, y, px, h);
  g.restore();
  // and the chamfer itself, caught by the key
  g.strokeStyle = rgba(c.arris, a1(c.arrisA, v));
  g.lineWidth = Math.max(G.arrisFloor, px * G.arrisPx);
  path();
  g.stroke();

  // FOUR FASTENERS. Nothing floats, everything is bolted — applied to the
  // instrument. A drilled collar with a dark bore, at the pitch the plate's
  // own fastener spacing would put them, scaled to the panel.
  const fr = Math.max(G.boltRFloor, px * G.boltRPx);
  const fi = ch * G.boltInsetCh;
  for (const fx of [x + fi, x + w - fi]) {
    for (const fy of [y + fi, y + h - fi]) {
      g.fillStyle = rgba(c.boltBore, a1(c.boltBoreA, v));
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(c.boltRing, a1(c.boltRingA, v));
      g.lineWidth = Math.max(G.boltRingFloor, px * G.boltRingPx);
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
//  THE SAME STACK, COMPOSITED RATHER THAN PAINTED.
// ---------------------------------------------------------------------------
//  A caller auditing its own contrast has to know what the face and the bezel
//  actually COME OUT AT over a given backdrop, and the tempting way to answer
//  is a table of hexes beside the audit. That table is a second source of truth
//  that only attention keeps in step with the draw path, and relying on
//  attention is the defect. These two replay the stack above, in the same
//  order, out of the same coat — so re-tuning the face re-tunes the audit.
//
//  `RGB` here is deliberately UNROUNDED between layers: an audit that replays
//  five source-over fills and rounds each one accumulates half a code value of
//  error per layer. Round once, at the end, if at all.

//  `overRGB` is `./colour.ts`'s — straight-alpha source-over is not this
//  file's arithmetic and a private copy here would be the third.

const over = (fg: Ink, a: number, bg: RGB): RGB => overRGB(fg as RGB, a, bg);

/** The fixture's face over `bg`, at backlight `v`. */
export function housingFace(skin: HousingSkin, bg: RGB, v: number, bright: boolean): RGB {
  const c = bright ? skin.bright : skin.dark;
  return over(c.face, a1(c.faceA, v), over(c.knock, a1(c.knockA, v), bg));
}

/** Its three bezel edges over that face, at `lit = 0`. */
export function housingBezel(
  skin: HousingSkin, face: RGB, v: number, bright: boolean,
): { top: RGB; rail: RGB; bottom: RGB } {
  const c = bright ? skin.bright : skin.dark;
  return {
    top: over(c.lip, a1(c.lipA, 0), face),
    rail: over(c.rail, a1(c.railA, v), face),
    bottom: over(c.sill, a1(c.sillA, v), face),
  };
}
