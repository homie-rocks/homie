/**
 * ============================================================================
 *  phosphor — the horizontal structure that turns flat vectors into a thing
 *  behind glass.
 * ============================================================================
 *
 *  A canvas HUD draws numerals at z = 0 on a transparent ground, and the result
 *  reads as a vector overlay pasted onto the frame rather than as a display
 *  surface inside the world. One `destination-out` fill of alternating rows
 *  fixes that for the cost of a handful of `fillRect`s, and it is the cheapest
 *  believable-instrument trick there is.
 *
 *  ── THE TWO NUMBERS, AND WHY THEY ARE NOT HALF ─────────────────────────────
 *
 *  0.09 alpha and a duty cycle of about a third of the pitch. NOT 0.16 at half,
 *  which is the obvious spelling: MEASURED, a 130 px numeral at 0.16/half reads
 *  as a BARCODE rather than as a display surface. The structure has to be
 *  something the eye only notices when it goes looking for it, so both numbers
 *  are deliberately below where they stop being subtle. They are parameters
 *  anyway — a game with a coarser panel wants a coarser grille — but the
 *  defaults are the measured ones.
 *
 *  ── WHERE IT MAY BE PAINTED ────────────────────────────────────────────────
 *
 *  Over a NUMERIC SLOT only. Never over a whole block and never over the scene:
 *  a scanline field across a full-screen canvas is a filter, not an instrument,
 *  and it costs a full-frame composite every frame. The pitch floors at 2 device
 *  pixels for the same reason a checkerboard floors at 2 — below that the rows
 *  alias into a flat grey wash and the effect is only the cost.
 *
 *  ── WHY IT IS HERE ─────────────────────────────────────────────────────────
 *
 *  Five lines, ONE copy, in the space racer's HUD, called from four sites. It
 *  was once deferred as "not worth a module alone", and that was the right call
 *  ONLY while it was alone; it lands here beside `toastStack` and `iconAtlas`,
 *  at which point the module is not alone and the argument evaporates.
 *
 *  A single implementation can be 100% platform. This one draws no gauge, knows
 *  no ship and reads nothing about a race; it takes a rectangle.
 */

/** Painted defaults, exported so a caller can read what it is accepting. */
export const PHOSPHOR = {
  /** Device pixels between the top of one row and the next. Floored at 2. */
  pitchPx: 2,
  /** Alpha of the knock-down. See the header on why not 0.16. */
  alpha: 0.09,
  /** Row height as a fraction of the pitch. See the header on why not 0.5. */
  duty: 0.34,
} as const;

export interface PhosphorOptions {
  pitchPx?: number;
  alpha?: number;
  duty?: number;
}

/**
 * Knock faint horizontal rows out of what is already painted in `x,y,w,h`.
 *
 * `dpr` is the canvas's device-pixel ratio, because the pitch is a PHYSICAL
 * distance: a 2-CSS-pixel grille on a 3× panel is a 0.67-device-pixel grille,
 * which is an invisible smear on the retina display and a hard stripe on the
 * external monitor beside it.
 *
 * `destination-out` means this REMOVES coverage rather than painting dark, so
 * it works over any ground and cannot invert its polarity against a bright
 * background the way a `rgba(0,0,0,a)` fill does. Saves and restores the
 * context, so it composes with whatever the caller had set.
 */
export function phosphor(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, dpr: number,
  opts: PhosphorOptions = {},
): void {
  const pitch = Math.max(2, Math.round((opts.pitchPx ?? PHOSPHOR.pitchPx) * dpr));
  const duty = opts.duty ?? PHOSPHOR.duty;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,' + (opts.alpha ?? PHOSPHOR.alpha) + ')';
  for (let yy = y; yy < y + h; yy += pitch) g.fillRect(x, yy, w, Math.max(1, pitch * duty));
  g.restore();
}
