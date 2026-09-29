/**
 * ============================================================================
 *  A thumb on glass. The measured constants, the curve, and its inverse.
 * ============================================================================
 *  Every line below was lifted VERBATIM out of the touch-controls module of two
 *  racing games — forks of each other — that held it byte-identically:
 *  nineteen constants with the measurements that justify them, the steering
 *  curve, the exact inverse of that curve, and the three rules that decide
 *  where a stick may be started and how far it may travel.
 *
 *  WHY IT IS IN THIS PACKAGE AND NOT A GAME'S. Read what the comments actually
 *  say: 1-2 mm of thumb repeatability, 7.2 mm at the tightest density in the
 *  device table, a contact width above which a touch is a palm, the OS
 *  edge-gesture band, "thumb settle is a physical quantity: it does not scale
 *  with screen size". Not one of them is a fact about a kart or a ship. They
 *  are facts about a hand, a screen and an operating system — which is exactly
 *  what @homie-rocks/device is for. The package knows THAT a thumb has travel and a
 *  dead zone; it does not know what the travel steers.
 *
 *  WHAT DID NOT COME. Every number a GAME chooses stays in the game: which
 *  radius this pad asked for, which dead zone this scheme uses, the release
 *  ramp's per-frame application, the whole action cluster, the tilt scheme, and
 *  the space racer's air-brake and pitch constants, which have no counterpart
 *  in the kart racer and are therefore not shared code. A value a game supplies
 *  is the point of these functions taking arguments.
 *
 *  ONE FORMULA WRITTEN ONCE, AND THAT IS THE DEFECT THIS PREVENTS.
 *  `transplantOrigin()` and `stickOffset()` were the SAME inverse written out
 *  twice, in both games — four copies of one expression that must agree to the
 *  last bit or the knob and the number disagree on screen. The codebase this
 *  came from has the scar already: a colour lookup resolved twice rendered
 *  every arrival in red and looked completely fine. `thumbTravel()` is that
 *  expression, once.
 *
 *  UNVERIFIED, and it belongs at the top of this file rather than only in the
 *  probe: none of this has been felt under a thumb. CDP touch events bypass the
 *  browser's gesture arbitration, so a green harness and a dead control are
 *  indistinguishable from a terminal. The touch-pad probe says these numbers
 *  did not CHANGE — never that they are any good.
 * ============================================================================
 */

/**
 * Which side of the screen the steering thumb is on.
 *
 * Deliberately its own type rather than an import: a game's `Hand` lives in its
 * own preference record, and a package that reached into that record would know
 * what one of a person's preferences MEANS, which is the line @homie-rocks/device
 * exists on the safe side of.
 */
export type ThumbHand = 'left' | 'right';

// ---------------------------------------------------------------------------
//  Geometry constants. Every one carries what it was measured against.
// ---------------------------------------------------------------------------

/**
 * Travel, in CSS px, that reaches full lock.
 *
 * The old 0.16-of-short-edge gave 62 px on a landscape phone, and the number
 * that matters is not how many distinct values the DIGITIZER can report — it is
 * how far the THUMB has to move to separate two decisions. At 62 px the travel
 * between steady-state cornering (steer 0.06) and `DRIFT_ENGAGE_STEER` (0.13)
 * was 5.20 px = 0.86 mm, BELOW a thumb's 1-2 mm repeatability: the drift /
 * no-drift decision, on the mechanic the racer calls its top priority, was a
 * coin flip made by skin. At 0.24 of the short edge that band is 7.86-10.22 px
 * (1.23-1.62 mm) across the device table.
 *
 * The floor of 84 protects the SE; the ceiling of 116 stops a tablet demanding
 * a whole hand's travel. Changing this without re-deriving CURVE breaks the
 * half-travel proof below.
 */
export const STICK_RADIUS_MIN = 84;
export const STICK_RADIUS_FRAC = 0.24;
export const STICK_RADIUS_MAX = 116;
/** No grab may be tighter than this, or full lock stops being reachable. */
export const R_GRAB_MIN = 56;

/**
 * Dead zone in ABSOLUTE PIXELS, not as a fraction of the radius.
 *
 * Thumb settle is a physical quantity: it does not scale with screen size. As a
 * fraction it was 3.3 px on a phone and 4.8 px on an iPad — 45% more "nothing"
 * on the device with the STEADIER grip, which is exactly backwards.
 */
export const DEADZONE_PX = 3.5;
/** A fixed stick has landing error to reject as well as settle, so it gets more. */
export const DEADZONE_PX_FIXED = 6.0;

/**
 * Expo past the dead zone.
 *
 * 1.26 is not a taste. It is the value at which enlarging the radius buys the
 * corner->drift band WITHOUT selling the mid-range: half-travel output moves
 * from 0.3990 (today's 62 px / 0.055 / 1.22) to 0.3972 at the new geometry, a
 * change of 0.0018. CURVE = 1.35 was tried earlier and rightly rejected — it
 * put half a thumb sweep at a third of lock, so an ordinary corner needed
 * nearly all the travel and there was nothing left for a correction. If you
 * change STICK_RADIUS or DEADZONE_PX, re-run the touch-feel measurement and
 * check half-travel is still within 0.005 of 0.3990; those three constants are
 * one measurement, not three.
 */
export const CURVE = 1.26;

/**
 * The DRAWN ring is much smaller than the hit radius.
 *
 * 2 x rGrab would be a 187 px ring on a 390 px-tall frame — a dinner plate over
 * the road. The ring is an indicator, not the hit area: it is drawn at 0.62 of
 * the grab radius and the knob tracks 1:1 until it reaches the rim, after which
 * the remaining travel is encoded as rim alpha. The drawn stick is therefore
 * SMALLER than the 125 px it used to be, which independently helps the
 * occlusion problem the item plate and the charge rails both had.
 */
export const RING_FRAC = 0.62;
export const KNOB_FRAC = 0.42;

/**
 * Thumb-arc alignment. A thumb pivots at the base and sweeps an ARC, so a drag
 * the player experiences as "straight right" arrives with 7-13% of its length
 * in Y. Once cumulative travel passes ARC_LATCH_PX the drag axis is latched for
 * the life of the grab and dx is measured along it. Clamped to +/-32 deg so a
 * genuinely vertical stab cannot rotate the axis into nonsense; cos/sin cached
 * at the latch, so this is two trig calls per GRAB, not per move.
 */
export const ARC_LATCH_PX = 10;
export const ARC_MAX_RAD = (32 * Math.PI) / 180;

/**
 * Release ramp, units/s, linear in dt.
 *
 * Today's 66.7 ms lock-to-centre is an ACCIDENT: `steering` went false, `Input`
 * fell into its digital branch and `STEER_RETURN = 16` decayed the command. The
 * number is good and nothing stated it; it was one "tidy the fallthrough"
 * commit away from being an instant snap. Owning it here at the same 16 units/s
 * is deliberately behaviour-neutral (full lock -> 0 in 62.5 ms) and makes the
 * digital branch stop being load-bearing for touch. Linear in dt, so 30/60/120
 * fps produce the same wall-clock trajectory.
 */
export const RELEASE_RATE = 16;

/**
 * Palm safety on a handover. If the adopted heir never moves, the steering it
 * inherited decays: it holds for SETTLE, then ramps to 0 over DECAY. A resting
 * palm therefore holds a phantom lock for at most 200 ms (~6 m at 30 m/s) and a
 * genuinely rolled thumb — which moves — for 0 ms.
 */
export const HANDOVER_SETTLE = 0.1;
export const HANDOVER_DECAY = 0.1;

/**
 * The OS edge-gesture band. `touch-action: none` suppresses it in a standalone
 * web app and NOT in a browser tab, so a stick spawned here is a stick the
 * system may steal mid-corner. Spawn only; see the header note.
 */
export const EDGE_GUARD = 24;
/**
 * Contact width above which a stick spawn is treated as a palm. Feature
 * detected: Safari reports `width === 1` for every touch, so a browser that has
 * never reported anything else is one whose contact size means nothing and the
 * rejection is skipped entirely. Scoped to the STICK — a large contact landing
 * on DRIFT must still claim DRIFT, because rejection must never make the action
 * cluster harder to hit.
 */
export const PALM_PX = 45;

/** Minimum inset from any screen edge, over and above env(). */
export const SAFE_MIN = 24;

/** Every interactive control is at least this many CSS px on its short side. */
export const TARGET_FLOOR = 46;

/** Degrees of tilt inside which the tilt scheme reports zero. */
export const TILT_DEADZONE_DEG = 1.6;

// ---------------------------------------------------------------------------
//  The curve, and its exact inverse.
// ---------------------------------------------------------------------------

/**
 * Dead-zoned, rescaled, expo'd. The one place the curve is written.
 *
 * `radius` is the travel that reaches full lock for THIS grab and `deadzonePx`
 * is the settle to reject — both supplied by the caller, because a fixed
 * rosette rejects landing error as well as settle and therefore uses a bigger
 * one. The exponent is not a caller's choice: see CURVE above, where it is one
 * measurement with the radius and the dead zone rather than three.
 */
export function thumbCurve(dx: number, radius: number, deadzonePx: number): number {
  const dz = deadzonePx / radius;
  const u = Math.abs(dx) / radius;
  if (u <= dz) return 0;
  const n = Math.min(1, (u - dz) / (1 - dz));
  return Math.sign(dx) * Math.pow(n, CURVE);
}

/**
 * The exact inverse of `thumbCurve`: the travel, in CSS px, that produces this
 * output. The shared primitive behind four different problems — the
 * thumb-roll handover, re-grabbing during the release ramp, a resize mid-drag,
 * and drawing the knob where the number says it is. All four are the same
 * operation, "the output must not jump", so all four call this and the
 * round-trip is tested rather than assumed.
 *
 * The clamp into [-1, 1] is the handover path's; the drawing path never sends
 * anything outside it, so the two are one function rather than two.
 */
export function thumbTravel(steer: number, radius: number, deadzonePx: number): number {
  const dz = deadzonePx / radius;
  const s = Math.max(-1, Math.min(1, steer));
  if (Math.abs(s) < 1e-9) return 0;
  return Math.sign(s) * (Math.pow(Math.abs(s), 1 / CURVE) * (1 - dz) + dz) * radius;
}

// ---------------------------------------------------------------------------
//  Where a stick may be started, and how far it may travel.
// ---------------------------------------------------------------------------

/**
 * The frame these three rules are decided in: the viewport, the two horizontal
 * safe-area insets, and which hand is steering.
 *
 * A STRUCT AND NOT THE PAD. The pad carries a race, a track, an item box and a
 * match; none of that decides where a thumb may land, and a package that took
 * the pad would have taken all of it.
 */
export interface PadFrame {
  vw: number;
  vh: number;
  safeL: number;
  safeR: number;
  hand: ThumbHand;
}

/** The base may trail, but it may not migrate out of its own half over a lap. */
export function clampStickOrigin(originX: number, f: PadFrame): number {
  if (f.hand === 'left') {
    return Math.max(f.vw * 0.5 + 8, Math.min(f.vw - f.safeR - 8, originX));
  }
  return Math.max(f.safeL + 8, Math.min(f.vw * 0.5 - 8, originX));
}

/**
 * Is this point a legal place to START a stick?
 *
 * x from `safeLeft + 60` (NOT from the edge: at x = 24 the trailing base never
 * engages, so full lock LEFT would be unreachable — the room clamp and the
 * spawn rectangle are one decision, not two) out to 0.46 W. The upper 22% is
 * excluded so a thumb reaching for PAUSE and missing cannot spawn a steering
 * stick at head height.
 */
export function inSpawnZone(x: number, y: number, f: PadFrame): boolean {
  if (y < f.vh * 0.22 || y > f.vh - 24) return false;
  if (f.hand === 'left') {
    return x >= f.vw * 0.54 && x <= f.vw - f.safeR - 60;
  }
  return x >= f.safeL + 60 && x <= f.vw * 0.46;
}

/**
 * Room clamp. Full lock must be reachable from every legal spawn, so the grab
 * radius is capped by how much room there is between the origin and the safe
 * edge — never below R_GRAB_MIN, because a 20 px stick is not a stick. At the
 * leftmost legal spawn this gives exactly 56 and full lock lands 4 px inside
 * the safe edge.
 *
 * `ideal` is the radius the layout asked for, which is the game's to choose.
 */
export function grabRadiusAt(x: number, f: PadFrame, ideal: number): number {
  const room = f.hand === 'left'
    ? (f.vw - f.safeR) - x - 4
    : x - f.safeL - 4;
  return Math.max(R_GRAB_MIN, Math.min(ideal, room));
}

// ---------------------------------------------------------------------------
//  What the device itself is doing. Four facts, each of which was learned the
//  hard way and none of which is about a game.
// ---------------------------------------------------------------------------

/** The four safe-area insets, in CSS px, already floored. */
export interface SafeInsets {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Read the safe-area insets off a probe element.
 *
 * `env()` cannot be read from JS, so a hidden probe element carries the four
 * insets as padding and `getComputedStyle` reports them resolved. Chrome
 * reports 0 however the viewport is emulated — which is why a pad's CSS carries
 * `env()` terms of its own and the harness checks for the TERM rather than for
 * a number. The floor is the part that is always real: it is the OS gesture
 * band, and Chrome on Android reports 0 for it with gesture navigation active.
 *
 * A missing probe is not an error and must not throw — it yields the floor,
 * which is the honest answer when nothing could be measured.
 */
export function safeAreaInsets(probe: HTMLElement | null, floor: number): SafeInsets {
  let l = 0, r = 0, t = 0, b = 0;
  if (probe) {
    const cs = getComputedStyle(probe);
    l = parseFloat(cs.paddingLeft) || 0;
    r = parseFloat(cs.paddingRight) || 0;
    t = parseFloat(cs.paddingTop) || 0;
    b = parseFloat(cs.paddingBottom) || 0;
  }
  return {
    l: Math.max(l, floor), r: Math.max(r, floor),
    t: Math.max(t, floor), b: Math.max(b, floor),
  };
}

/**
 * iOS 13+ gates DeviceOrientation behind a permission prompt that may only be
 * requested from a user gesture — so this must be called from a real tap, and
 * every failure path returns false rather than throwing on a boot path.
 */
export async function requestTiltPermission(): Promise<boolean> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof D?.requestPermission === 'function') {
    try {
      const r = await D.requestPermission();
      if (r !== 'granted') return false;
    } catch { return false; }
  }
  return true;
}

/**
 * Project gravity into SCREEN space. Degrees; positive means the screen's RIGHT
 * edge is dipped. Null when the sensor reported nothing.
 *
 * This is the pre-registered trap: the naive implementation reads `gamma` and
 * inverts on a landscape phone, because `screen.orientation.angle` flips
 * between 90 and 270 depending on which way the device was rotated, and a
 * scheme that steers backwards in one of the two landscapes is a scheme that
 * looks fine in every test somebody thought to run.
 *
 * Derivation, so the signs can be checked rather than trusted. With the ZXY
 * intrinsic convention the DOM uses, the world-up vector expressed in device
 * coordinates is `u = (-sinY*cosB, sinB, cosY*cosB)`, so gravity is `-u`. The
 * screen's RIGHT axis in device coordinates is `(cos a, -sin a, 0)` for
 * `a = screen.orientation.angle` — check it at a = 0 (portrait: screen right =
 * device +x) and at a = 90 (device top points to screen left, so screen right =
 * device -y).
 *
 * Therefore `tilt = g . screenRight = sinY*cosB*cos a + sinB*sin a`, which is
 * `sin(roll about the screen's vertical axis)`: dip the screen's RIGHT edge and
 * it goes positive. Positive = the player wants to go right, which is the input
 * contract every caller of this emits. There is no negation here and there must
 * never be one.
 *
 * The ANGLE is returned, in degrees, rather than a unit-free sensitivity, so a
 * range preference can be shown to a person as "26 degrees to full lock".
 */
export function screenRollDegrees(beta: number | null, gamma: number | null): number | null {
  if (beta == null || gamma == null) return null;
  const B = (beta * Math.PI) / 180;
  const Y = (gamma * Math.PI) / 180;
  const a = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
  const g = Math.sin(Y) * Math.cos(B) * Math.cos(a) + Math.sin(B) * Math.sin(a);
  return (Math.asin(Math.max(-1, Math.min(1, g))) * 180) / Math.PI;
}

/**
 * Does this pointer event carry a REAL contact size?
 *
 * Safari reports `width === 1 && height === 1` for every touch, so a 1x1 report
 * is "this browser does not measure contact size", not "this is a stylus" — and
 * a palm rejection that believed it would reject every touch on that browser.
 */
export function contactSizeKnown(e: PointerEvent): boolean {
  return e.pointerType === 'touch' && !(e.width === 1 && e.height === 1) && e.width > 0;
}
