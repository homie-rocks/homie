/*
 * ============================================================================
 *  THE HOUSE FACE — a technical grotesque, drawn here, in code.
 * ============================================================================
 *  Published out of the base-building game's typeface module, which was the
 *  only place it lived and was once filed as "art direction".
 *
 *  THAT FILING DOES NOT SURVIVE THE QUESTION THAT MATTERS.
 *  "Is there a twin" said no — there was exactly one face in the codebase.
 *  "Does this belong in a game" says no just as loudly, and for a reason the
 *  file states about ITSELF: the engine does not ship somebody else's
 *  outlines, so a game that wants an identity has to WRITE a font binary at
 *  boot. That rule is inherited by every experience built on it. The
 *  base-building game was the only one that had paid it. The other seven were
 *  set in `"SF Pro Display", "Inter", "Helvetica Neue", system-ui` — a system
 *  stack at its default weight, identifiable in the pixels, and metrically
 *  different on every operating system a player might be looking at.
 *
 *  Nothing below knows what a colony is. The letter A is not lunar. What DID
 *  stay in the game is the part that is genuinely its own: the two family
 *  names, the four-character vendor tag and the unique-id namespace — the
 *  identity — plus the CSS fallback stack it wants behind them.
 *
 *  WHAT MOVED IS INK, AND INK IS CHECKED IN BYTES.
 *  A byte-parity probe builds all four font binaries from the PINNED pre-move
 *  source and from the live tree, and compares them byte for byte with no
 *  epsilon: if a single glyph moved a unit, `typeface-bytes` goes red. A
 *  second probe adds the properties that are about the FACE rather than about
 *  one game — the tabular-figure invariant, the drawn slash in the zero, and
 *  the set cover.
 *
 *  ── THE CONSTRUCTION ────────────────────────────────────────────────────────
 *  Every glyph is a SKELETON — centre lines, not outlines — stroked to a width
 *  that comes from the weight. Strokes are emitted as independent closed
 *  contours all wound the same way and left overlapping at the joins; TrueType
 *  fills with the NON-ZERO winding rule, so overlapping same-direction contours
 *  union for free and no join geometry is needed. Counters are the space the
 *  strokes do not cover, so no glyph needs a hole except the true rings (O, o,
 *  0, D…), which emit an outer contour plus a reversed inner one.
 *
 *  The writer, the pen and the ten tables are `./truetype.ts`. This file is
 *  only the drawing.
 *
 *  NO TEMPLATE LITERALS IN THIS FILE — the glyph table quotes `min-height` and
 *  friends in prose, and a backtick in a comment inside a template literal ends
 *  the document and deletes the module.
 * ============================================================================
 */
import {
  buildFont, installFaces,
  type FaceMetrics, type FaceSpec, type GlyphSet, type Pen,
} from './truetype.ts';

// ═════════════════════════════════════════════════════════════════════════════
// Geometry
// ═════════════════════════════════════════════════════════════════════════════

const UPM = 1000;
const CAP = 700;          // cap height
/**
 * x-height. 532, not 500, and the 32 units are the difference between a
 * GEOMETRIC sans and a TECHNICAL GROTESQUE.
 *
 * At 500 against a 700 cap the lowercase measured 0.71 of cap — squarely
 * geometric-humanist, and read as retail rather than as downlinked telemetry,
 * which is a problem because this face carries a game's narrative voices and
 * they are the most personality-carrying text in the interface. 532 puts it at
 * 0.76, which is the band Univers, Neue Haas Grotesk and every instrument face
 * sits in, and it also buys real legibility at the 12px that game's message
 * cards are set at.
 *
 * Every lowercase glyph below derives its bowls, shoulders and crossbars from
 * this constant, so raising it moves the whole lowercase together rather than
 * breaking the fit of any one letter — and BOTH generated families share this
 * table (see FACES), so the sans and the mono move as one design.
 */
const XH = 532;           // x-height
const ASC = 760;          // ascender (b d f h k l)
const DESC = -200;        // descender (g j p q y)
const OVER = 10;          // round-letter overshoot, top and bottom

// ═════════════════════════════════════════════════════════════════════════════
// The glyph set
//
// ~90 glyphs: the caps, digits and symbols an instrument layer prints, plus the
// lowercase a body of text needs. Anything outside this set falls through to
// the platform stack PER CHARACTER, which is the correct failure mode for a
// face this narrow — it is a UI font, not a text font.
// ═════════════════════════════════════════════════════════════════════════════

const L = 75, R = 545;
const MIDX = (L + R) / 2;
const ADV_CAP = 620;
/** Digits are all one width. Tabular by construction, not by an OpenType flag. */
const ADV_NUM = 560;
const NL = 90, NR = 470;         // digit ink box
const NMID = (NL + NR) / 2;
/** Lowercase. */
const LL = 75, LR = 465;
const LMID = (LL + LR) / 2;
const ADV_LC = 540;

type Draw = (p: Pen) => void;

/** Skeleton x for a stem whose LEFT ink edge is at `x`. */
function sl(p: Pen, x: number): number { return x + p.w / 2; }
/** Skeleton x for a stem whose RIGHT ink edge is at `x`. */
function sr(p: Pen, x: number): number { return x - p.w / 2; }
/** Skeleton y for a bar whose TOP ink edge is at `y`. */
function st(p: Pen, y: number): number { return y - p.w / 2; }
/** Skeleton y for a bar whose BOTTOM ink edge is at `y`. */
function sb(p: Pen, y: number): number { return y + p.w / 2; }

const GLYPHS: Record<string, [number, Draw]> = {
  // ── caps ───────────────────────────────────────────────────────────────────
  A: [ADV_CAP, (p) => {
    p.d(L + 10, 0, MIDX, CAP); p.d(R - 10, 0, MIDX, CAP);
    p.h(210, L + 72, R - 72);
  }],
  B: [ADV_CAP, (p) => {
    const x = sl(p, L);
    p.v(x, 0, CAP);
    const rx1 = (R - x) / 2, ry1 = (CAP - st(p, CAP + 0) - 0) / 2;
    p.h(st(p, CAP), x, R - rx1); p.h(CAP / 2, x, R - rx1 - 10); p.h(sb(p, 0), x, R - rx1);
    p.arc(R - rx1, (st(p, CAP) + CAP / 2) / 2, rx1, (st(p, CAP) - CAP / 2) / 2, -90, 90);
    p.arc(R - rx1, (sb(p, 0) + CAP / 2) / 2, rx1, (CAP / 2 - sb(p, 0)) / 2, -90, 90);
  }],
  C: [ADV_CAP, (p) => {
    p.arc(MIDX, CAP / 2, (R - L) / 2 - p.w / 2, CAP / 2 - p.w / 2 + OVER, 35, 325);
  }],
  D: [ADV_CAP, (p) => {
    const x = sl(p, L);
    p.v(x, 0, CAP);
    p.h(st(p, CAP), x, MIDX); p.h(sb(p, 0), x, MIDX);
    p.arc(MIDX, CAP / 2, R - p.w / 2 - MIDX, CAP / 2 - p.w / 2, -90, 90);
  }],
  E: [ADV_CAP, (p) => {
    p.v(sl(p, L), 0, CAP);
    p.h(st(p, CAP), L, R); p.h(CAP / 2, L, R - 40); p.h(sb(p, 0), L, R);
  }],
  F: [ADV_CAP, (p) => {
    p.v(sl(p, L), 0, CAP);
    p.h(st(p, CAP), L, R); p.h(CAP / 2, L, R - 40);
  }],
  G: [ADV_CAP, (p) => {
    p.arc(MIDX, CAP / 2, (R - L) / 2 - p.w / 2, CAP / 2 - p.w / 2 + OVER, 35, 325);
    p.v(sr(p, R), 60, 300); p.h(300, MIDX + 20, R);
  }],
  H: [ADV_CAP, (p) => {
    p.v(sl(p, L), 0, CAP); p.v(sr(p, R), 0, CAP); p.h(CAP / 2, L, R);
  }],
  I: [300, (p) => { p.v(150, 0, CAP); }],
  J: [ADV_CAP - 60, (p) => {
    const x = sr(p, R - 60);
    p.v(x, 150, CAP);
    p.arc(x - 130, 150, 130, 130, 180, 360);
    p.v(sl(p, L + 10), 150, 160);
  }],
  K: [ADV_CAP, (p) => {
    p.v(sl(p, L), 0, CAP);
    p.d(sl(p, L) + 20, 310, R, CAP); p.d(sl(p, L) + 20, 300, R, 0);
  }],
  L: [ADV_CAP - 40, (p) => { p.v(sl(p, L), 0, CAP); p.h(sb(p, 0), L, R - 40); }],
  M: [ADV_CAP + 80, (p) => {
    const r2 = R + 80;
    p.v(sl(p, L), 0, CAP); p.v(sr(p, r2), 0, CAP);
    p.d(sl(p, L), CAP, (L + r2) / 2, 190); p.d(sr(p, r2), CAP, (L + r2) / 2, 190);
  }],
  N: [ADV_CAP + 20, (p) => {
    const r2 = R + 20;
    p.v(sl(p, L), 0, CAP); p.v(sr(p, r2), 0, CAP);
    p.d(sl(p, L), CAP, sr(p, r2), 90);
  }],
  O: [ADV_CAP + 20, (p) => {
    p.ring(MIDX + 10, CAP / 2, (R + 20 - L) / 2 - p.w / 2, CAP / 2 - p.w / 2 + OVER);
  }],
  P: [ADV_CAP, (p) => {
    const x = sl(p, L);
    p.v(x, 0, CAP);
    const ry = (CAP - 320) / 2;
    p.h(st(p, CAP), x, R - ry); p.h(320, x, R - ry);
    p.arc(R - ry, CAP - ry - p.w / 2, ry, ry, -90, 90);
  }],
  Q: [ADV_CAP + 20, (p) => {
    p.ring(MIDX + 10, CAP / 2, (R + 20 - L) / 2 - p.w / 2, CAP / 2 - p.w / 2 + OVER);
    p.d(MIDX + 40, 150, R - 10, -40);
  }],
  R: [ADV_CAP, (p) => {
    const x = sl(p, L);
    p.v(x, 0, CAP);
    const ry = (CAP - 320) / 2;
    p.h(st(p, CAP), x, R - ry); p.h(320, x, R - ry);
    p.arc(R - ry, CAP - ry - p.w / 2, ry, ry, -90, 90);
    p.d(MIDX - 30, 320, sr(p, R), 0);
  }],
  S: [ADV_CAP, (p) => {
    const rx = (R - L) / 2 - p.w / 2, ry = (CAP / 2 - p.w / 2 + OVER) / 2 + 30;
    p.arc(MIDX, CAP - ry - p.w / 2 + OVER, rx, ry, 10, 300);
    p.arc(MIDX, ry + p.w / 2 - OVER, rx, ry, 190, 480);
  }],
  T: [ADV_CAP, (p) => { p.h(st(p, CAP), L - 10, R + 10); p.v(MIDX, 0, CAP); }],
  U: [ADV_CAP + 10, (p) => {
    const r2 = R + 10, rx = (r2 - L) / 2 - p.w / 2, cx = (L + r2) / 2;
    p.v(sl(p, L), 220, CAP); p.v(sr(p, r2), 220, CAP);
    p.arc(cx, 220, rx, 220 - p.w / 2 + OVER, 180, 360);
  }],
  V: [ADV_CAP, (p) => { p.d(L + 5, CAP, MIDX, 0); p.d(R - 5, CAP, MIDX, 0); }],
  W: [ADV_CAP + 140, (p) => {
    const r2 = R + 140, q = (r2 - L) / 4;
    p.d(L + 5, CAP, L + q, 0); p.d(L + q, 0, L + 2 * q, CAP - 180);
    p.d(r2 - 5, CAP, r2 - q, 0); p.d(r2 - q, 0, L + 2 * q, CAP - 180);
  }],
  X: [ADV_CAP, (p) => { p.d(L, 0, R, CAP); p.d(R, 0, L, CAP); }],
  Y: [ADV_CAP, (p) => {
    p.d(L, CAP, MIDX, 330); p.d(R, CAP, MIDX, 330); p.v(MIDX, 0, 340);
  }],
  Z: [ADV_CAP, (p) => {
    p.h(st(p, CAP), L, R); p.h(sb(p, 0), L, R); p.d(R - 10, CAP - p.w, L + 10, p.w);
  }],

  // ── lowercase ──────────────────────────────────────────────────────────────
  a: [ADV_LC, (p) => {
    const rx = (LR - LL) / 2 - p.w / 2, ry = XH / 2 - p.w / 2 + OVER;
    p.ring(LMID, XH / 2, rx, ry);
    p.v(sr(p, LR), 0, XH / 2);
    p.h(sb(p, 0), LMID - 40, LR);
  }],
  b: [ADV_LC, (p) => {
    p.v(sl(p, LL), 0, ASC);
    p.ring(LMID + 8, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
  }],
  c: [ADV_LC, (p) => {
    p.arc(LMID, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER, 40, 320);
  }],
  d: [ADV_LC, (p) => {
    p.v(sr(p, LR), 0, ASC);
    p.ring(LMID - 8, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
  }],
  e: [ADV_LC, (p) => {
    const rx = (LR - LL) / 2 - p.w / 2, ry = XH / 2 - p.w / 2 + OVER;
    p.arc(LMID, XH / 2, rx, ry, 0, 320);
    p.h(XH / 2, LMID - rx, LMID + rx);
  }],
  f: [350, (p) => {
    // Stem up, then a quarter turn to the RIGHT at the top. Drawn from the
    // wrong quadrant this reads as a 't' — which is how "of four" came out of
    // the first specimen as "ot tour".
    const x = sl(p, 90) + 60;
    p.v(x, 0, ASC - 90);
    p.arc(x + 90, ASC - 90, 90, 90, 90, 180);
    p.h(st(p, XH), 30, 310);
  }],
  g: [ADV_LC, (p) => {
    p.ring(LMID - 8, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
    p.v(sr(p, LR), DESC + 110, XH);
    p.arc(sr(p, LR) - 110, DESC + 110, 110, 110, 180, 350);
  }],
  h: [ADV_LC, (p) => {
    p.v(sl(p, LL), 0, ASC);
    p.arc(LMID, XH - 130, (LR - LL) / 2 - p.w / 2, 130, 0, 180);
    p.v(sr(p, LR), 0, XH - 130);
  }],
  i: [260, (p) => { p.v(130, 0, XH); p.dot(130, XH + 130); }],
  j: [260, (p) => {
    p.v(170, DESC + 110, XH); p.dot(170, XH + 130);
    p.arc(170 - 110, DESC + 110, 110, 110, 180, 300);
  }],
  k: [ADV_LC, (p) => {
    p.v(sl(p, LL), 0, ASC);
    p.d(sl(p, LL) + 20, 200, LR, XH); p.d(sl(p, LL) + 30, 195, LR, 0);
  }],
  l: [260, (p) => { p.v(130, 0, ASC); }],
  m: [ADV_LC + 150, (p) => {
    const r2 = LR + 150, q = (r2 - LL) / 2;
    p.v(sl(p, LL), 0, XH);
    p.arc(LL + q / 2 + 10, XH - 110, q / 2 - p.w / 2 + 10, 110, 0, 180);
    p.v(LL + q, 0, XH - 110);
    p.arc(LL + q + q / 2 - 10, XH - 110, q / 2 - p.w / 2 + 10, 110, 0, 180);
    p.v(sr(p, r2), 0, XH - 110);
  }],
  n: [ADV_LC, (p) => {
    p.v(sl(p, LL), 0, XH);
    p.arc(LMID, XH - 130, (LR - LL) / 2 - p.w / 2, 130, 0, 180);
    p.v(sr(p, LR), 0, XH - 130);
  }],
  o: [ADV_LC, (p) => {
    p.ring(LMID, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
  }],
  p: [ADV_LC, (p) => {
    p.v(sl(p, LL), DESC, XH);
    p.ring(LMID + 8, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
  }],
  q: [ADV_LC, (p) => {
    p.v(sr(p, LR), DESC, XH);
    p.ring(LMID - 8, XH / 2, (LR - LL) / 2 - p.w / 2, XH / 2 - p.w / 2 + OVER);
  }],
  r: [370, (p) => {
    p.v(sl(p, LL), 0, XH);
    p.arc(sl(p, LL) + 130, XH - 130, 130, 130, 30, 180);
  }],
  s: [ADV_LC, (p) => {
    const rx = (LR - LL) / 2 - p.w / 2, ry = (XH / 2 - p.w / 2 + OVER) / 2 + 22;
    p.arc(LMID, XH - ry - p.w / 2 + OVER, rx, ry, 10, 300);
    p.arc(LMID, ry + p.w / 2 - OVER, rx, ry, 190, 480);
  }],
  t: [340, (p) => {
    p.v(160, 120, ASC - 120);
    p.h(st(p, XH), 30, 300);
    p.arc(160 + 90, 120, 90, 90, 180, 270);
  }],
  u: [ADV_LC, (p) => {
    p.v(sl(p, LL), 130, XH);
    p.arc(LMID, 130, (LR - LL) / 2 - p.w / 2, 130, 180, 360);
    p.v(sr(p, LR), 0, XH);
  }],
  v: [ADV_LC - 20, (p) => { p.d(LL, XH, (LL + LR - 20) / 2, 0); p.d(LR - 20, XH, (LL + LR - 20) / 2, 0); }],
  w: [ADV_LC + 130, (p) => {
    const r2 = LR + 130, q = (r2 - LL) / 4;
    p.d(LL, XH, LL + q, 0); p.d(LL + q, 0, LL + 2 * q, XH - 140);
    p.d(r2, XH, r2 - q, 0); p.d(r2 - q, 0, LL + 2 * q, XH - 140);
  }],
  x: [ADV_LC - 20, (p) => { p.d(LL, 0, LR - 20, XH); p.d(LR - 20, 0, LL, XH); }],
  y: [ADV_LC - 20, (p) => {
    const m = (LL + LR - 20) / 2;
    p.d(LL, XH, m + 40, 0); p.d(LR - 20, XH, LL + 30, DESC);
  }],
  z: [ADV_LC - 20, (p) => {
    p.h(st(p, XH), LL, LR - 20); p.h(sb(p, 0), LL, LR - 20);
    p.d(LR - 30, XH - p.w, LL + 10, p.w);
  }],

  // ── digits — one advance, always ───────────────────────────────────────────
  '0': [ADV_NUM, (p) => {
    p.ring(NMID, CAP / 2, (NR - NL) / 2 - p.w / 2, CAP / 2 - p.w / 2 + OVER);
    // The slash, drawn. Not a feature we hope the fallback ships: a HUD that
    // prints grid IDs and tank percentages cannot afford 0 reading as O.
    p.d(NL + 40, 130, NR - 40, CAP - 130);
  }],
  '1': [ADV_NUM, (p) => { p.v(NMID + 20, 0, CAP); p.d(NL + 20, CAP - 130, NMID + 20, CAP); }],
  '2': [ADV_NUM, (p) => {
    p.arc(NMID, CAP - 175, (NR - NL) / 2 - p.w / 2, 175 - p.w / 2 + OVER, -20, 200);
    p.d(NR - 30, CAP - 250, NL, sb(p, 0)); p.h(sb(p, 0), NL, NR);
  }],
  '3': [ADV_NUM, (p) => {
    p.arc(NMID, CAP - 175, (NR - NL) / 2 - p.w / 2, 175 - p.w / 2 + OVER, -80, 200);
    p.arc(NMID, 175, (NR - NL) / 2 - p.w / 2, 175 - p.w / 2 + OVER, 160, 440);
  }],
  '4': [ADV_NUM, (p) => {
    p.v(NR - 90, 0, CAP); p.d(NR - 90, CAP, NL, 190); p.h(190, NL, NR);
  }],
  // MEASURED BROKEN in the first specimen, and all three defects printed in a
  // HUD capture made almost entirely of digits, where three of ten misread.
  // Fixed here rather than worked around in the CSS:
  //   5  the bowl's upper terminal stopped 77 units clear of the waist bar, so
  //      the glyph printed as a flag, a stem and a DETACHED hook.
  //   6  the ascender terminated at twelve o'clock over a bowl of that size,
  //      which is a lowercase b — "SUPPLY 669 kW" read "bb9" — and its arc
  //      also overshot the cap by 27 units, so the 6 stood taller than every
  //      digit beside it.
  //   9  the tail curled under the centre and hung 37 units BELOW the
  //      baseline, so it read as a g and sat lower than the 0 next to it.
  // The rule that fixes all three: a terminal must land where the eye expects
  // the stroke to leave the glyph (upper right on a 6, lower left on a 9), and
  // every join must OVERLAP by a stem width, which is the only connection this
  // pen can guarantee without real curve joinery.
  '5': [ADV_NUM, (p) => {
    const rx = (NR - NL) / 2 - p.w / 2, ry = 175 - p.w / 2 + OVER;
    p.h(st(p, CAP), NL, NR);          // the flag
    p.v(sl(p, NL), 330, CAP);         // the stem — upper half only
    p.h(330, NL, 260);                // the waist, out far enough to meet the bowl
    p.arc(NMID, 175, rx, ry, 200, 460);
  }],
  '6': [ADV_NUM, (p) => {
    const rx = (NR - NL) / 2 - p.w / 2, ry = 175 - p.w / 2 + OVER;
    p.ring(NMID, 175, rx, ry);
    // Centre pulled down half a stem so the ink stops at CAP + OVER like every
    // other round digit; terminal at 45 deg so the top flag reaches the right.
    p.arc(NMID, CAP - 175 - (p.w / 2 - OVER), rx, 175, 45, 250);
  }],
  '7': [ADV_NUM, (p) => { p.h(st(p, CAP), NL, NR); p.d(NR - 20, CAP - p.w, NL + 110, 0); }],
  '8': [ADV_NUM, (p) => {
    p.ring(NMID, CAP - 180, (NR - NL) / 2 - p.w / 2 - 18, 180 - p.w / 2 + OVER);
    p.ring(NMID, 180, (NR - NL) / 2 - p.w / 2, 180 - p.w / 2 + OVER);
  }],
  '9': [ADV_NUM, (p) => {
    const rx = (NR - NL) / 2 - p.w / 2, ry = 175 - p.w / 2 + OVER;
    p.ring(NMID, CAP - 175, rx, ry);
    // The mirror of the 6, and it takes the mirror of both corrections: centre
    // lifted half a stem so the tail sits ON the baseline, terminal at 225 deg
    // so it leaves at the lower left instead of curling under the centre.
    p.arc(NMID, 175 + (p.w / 2 - OVER), rx, 175, 225, 430);
  }],

  // ── symbols the instrument layer actually prints ───────────────────────────
  ' ': [300, () => { /* space */ }],
  '.': [260, (p) => { p.dot(130, sb(p, 0)); }],
  ',': [260, (p) => { p.dot(130, sb(p, 0)); p.d(130, 0, 90, -140); }],
  ':': [260, (p) => { p.dot(130, sb(p, 0)); p.dot(130, XH - p.w / 2); }],
  ';': [260, (p) => { p.dot(130, sb(p, 0)); p.dot(130, XH - p.w / 2); }],
  '·': [300, (p) => { p.dot(150, 330); }],
  '!': [260, (p) => { p.v(130, 200, CAP); p.dot(130, sb(p, 0)); }],
  '?': [500, (p) => {
    p.arc(250, CAP - 160, 160, 160 - p.w / 2, -30, 200);
    p.v(250, 250, CAP - 160); p.dot(250, sb(p, 0));
  }],
  "'": [220, (p) => { p.v(110, CAP - 200, CAP); }],
  '"': [360, (p) => { p.v(110, CAP - 200, CAP); p.v(250, CAP - 200, CAP); }],
  '(': [320, (p) => { p.arc(280, 350, 210, 400, 120, 240); }],
  ')': [320, (p) => { p.arc(40, 350, 210, 400, -60, 60); }],
  '[': [320, (p) => { p.v(sl(p, 90), -80, CAP); p.h(st(p, CAP), 90, 260); p.h(sb(p, -80), 90, 260); }],
  ']': [320, (p) => { p.v(sr(p, 230), -80, CAP); p.h(st(p, CAP), 60, 230); p.h(sb(p, -80), 60, 230); }],
  '/': [420, (p) => { p.d(40, -60, 380, CAP + 60); }],
  '-': [400, (p) => { p.h(330, 70, 330); }],
  '–': [500, (p) => { p.h(330, 50, 450); }],
  '—': [700, (p) => { p.h(330, 30, 670); }],
  '−': [ADV_NUM, (p) => { p.h(330, 90, 470); }],
  '+': [ADV_NUM, (p) => { p.h(330, 90, 470); p.v(280, 140, 520); }],
  '=': [ADV_NUM, (p) => { p.h(430, 90, 470); p.h(230, 90, 470); }],
  '×': [ADV_NUM, (p) => { p.d(160, 200, 400, 460); p.d(400, 200, 160, 460); }],
  '°': [360, (p) => { p.ring(180, CAP - 120, 105 - p.sw / 2, 105 - p.sw / 2, p.sw); }],
  '%': [680, (p) => {
    p.ring(150, CAP - 130, 105 - p.sw / 2, 105 - p.sw / 2, p.sw);
    p.ring(530, 130, 105 - p.sw / 2, 105 - p.sw / 2, p.sw);
    p.d(570, CAP, 110, 0);
  }],
  '#': [620, (p) => {
    p.h(230, 60, 560); p.h(450, 60, 560);
    p.d(250, 0, 310, CAP); p.d(400, 0, 460, CAP);
  }],
  '∞': [640, (p) => {
    // The lobes must OVERLAP or the glyph reads as two dots, which is exactly
    // what ENDURANCE printed in the first specimen.
    p.ring(215, 330, 165 - p.sw / 2, 175 - p.sw / 2, p.sw);
    p.ring(425, 330, 165 - p.sw / 2, 175 - p.sw / 2, p.sw);
  }],
  'Δ': [ADV_CAP, (p) => {
    p.d(L, sb(p, 0), MIDX, CAP); p.d(R, sb(p, 0), MIDX, CAP); p.h(sb(p, 0), L, R);
  }],
  // Subscripts: the chemistry in H₂O, LH₂, CH₄ is not decoration, and a
  // fallback subscript is a different face at a different weight in the middle
  // of a resource code.
  '₂': [360, (p) => {
    const w = p.sw;
    p.arc(180, 200, 105 - w / 2, 110 - w / 2, -15, 195, w);
    p.d(275, 130, 90, -60 + w / 2);
    p.rect(75, -60, 290, -60 + w);
  }],
  '₃': [360, (p) => {
    const w = p.sw;
    p.arc(180, 205, 105 - w / 2, 105 - w / 2, -80, 195, w);
    p.arc(180, 0, 105 - w / 2, 105 - w / 2, 165, 440, w);
  }],
  '₄': [360, (p) => {
    const w = p.sw;
    p.rect(230 - w / 2, -110, 230 + w / 2, 310);
    p.d(230, 310, 70, 40);
    p.rect(70, 40 - w / 2, 300, 40 + w / 2);
  }],
};

// `CHARS` — the code-point sort this table needed — lives in the writer.
// `buildFont` derives it, because cmap's format-4 segments are the only thing
// that ever cared about the order.

// ═════════════════════════════════════════════════════════════════════════════
// The face
// ═════════════════════════════════════════════════════════════════════════════

/** The drawing, for a caller that wants to build the binaries itself. */
export const HOUSE_GLYPHS: GlyphSet = GLYPHS as GlyphSet;

/**
 * THE FACE'S TWELVE NUMBERS, less the two that are an IDENTITY rather than a
 * drawing. `./truetype.ts` supplies no default for any of them, deliberately: a
 * default `capHeight` would be a default TYPEFACE, which is the loudest thing
 * an interface can inherit by accident. These are not a default either — they
 * are THIS face's, and they are inseparable from the skeletons above, which
 * derive every bowl, shoulder and crossbar from `XH` and `CAP`.
 *
 * `winAscent` is `ASC + 40`, and the 40 is leading rather than ink: it is the
 * number a browser lays a line box out with, so it is what decides whether two
 * stacked readouts touch. `avgCharWidth` is 0.9 of the cap advance, measured
 * against this glyph set rather than assumed.
 */
const DRAWN: Omit<FaceMetrics, 'vendor' | 'uniqueIdPrefix'> = {
  unitsPerEm: UPM,
  capHeight: CAP,
  xHeight: XH,
  ascender: ASC,
  descender: DESC,
  lineGap: 80,
  winAscent: ASC + 40,
  avgCharWidth: Math.round(ADV_CAP * 0.9),
  underlinePosition: -90,
  underlineThickness: 60,
};

/** Who is shipping this face. `vendor` is EXACTLY four ASCII characters. */
export interface FaceIdentity {
  vendor: string;
  uniqueIdPrefix: string;
}

/** The house metrics, stamped with one experience's identity. */
export function houseMetrics(id: FaceIdentity): FaceMetrics {
  return { ...DRAWN, vendor: id.vendor, uniqueIdPrefix: id.uniqueIdPrefix };
}

/**
 * The small-feature stroke. A type designer's judgement about THESE skeletons,
 * which is why it travels with them and not with the writer.
 *
 * What it prevents: a 112-unit bold stem inside a 100-unit ring leaves a
 * counter of negative width, which does not render as a bold small glyph but as
 * a blob — and in H₂O it renders as a blob in the middle of a resource code.
 *
 * THE EXPRESSION IS WRITTEN OUT RATHER THAN EVALUATED TO 68.28 / 76.64, and
 * that is not fussiness. The font binaries are compared byte-for-byte against a
 * pinned pre-move build; a rounded literal would move ink on every small
 * feature in both weights and that comparison is the only thing that would
 * ever have said so.
 */
export const houseSmallStem = (w: number): number => Math.min(w, 52 + w * 0.22);

/** Stroke widths. The ONLY parameter separating the two weights. */
const STEM_MEDIUM = 74;
const STEM_BOLD = 112;
/** The mono family's fixed advance. Glyphs are centred inside it. */
const MONO_ADV = 600;

/**
 * The four faces: a proportional family and a monospaced one, each at Medium
 * 500 and Bold 700. REAL WEIGHTS, drawn — so `font-weight` never lands on a
 * weight the face does not ship and snap back to 400, which is exactly what
 * happened to one readout's "27" at weight 200.
 *
 * THE ORDER IS PART OF THE CONTRACT: sans-medium, sans-bold, mono-medium,
 * mono-bold. `__buildFontBinary(index)` in a game and the byte-parity probe
 * both index this array.
 */
export function houseFaces(sans: string, mono: string): FaceSpec[] {
  return [
    { family: sans, sub: 'Medium', weight: 500, stem: STEM_MEDIUM, smallStem: houseSmallStem(STEM_MEDIUM), fixedAdv: null },
    { family: sans, sub: 'Bold', weight: 700, stem: STEM_BOLD, smallStem: houseSmallStem(STEM_BOLD), fixedAdv: null },
    { family: mono, sub: 'Medium', weight: 500, stem: STEM_MEDIUM, smallStem: houseSmallStem(STEM_MEDIUM), fixedAdv: MONO_ADV },
    { family: mono, sub: 'Bold', weight: 700, stem: STEM_BOLD, smallStem: houseSmallStem(STEM_BOLD), fixedAdv: MONO_ADV },
  ];
}

/**
 * Build the four faces and hand them to the document.
 *
 * Resolves FALSE, never throws, and applies NOTHING on failure: if the platform
 * refuses a face the caller's CSS variables must be left exactly as authored,
 * so the interface keeps the system stack — degraded, but never broken, and
 * never half-applied with one family swapped and the other not.
 */
export function installHouseFaces(sans: string, mono: string, id: FaceIdentity): Promise<boolean> {
  return installFaces(houseFaces(sans, mono), HOUSE_GLYPHS, houseMetrics(id));
}

/**
 * One face's binary, by its index in `houseFaces`. For harnesses.
 *
 * An index outside the four THROWS. It does not return face 0, and it does not
 * return an empty buffer: a byte-parity probe handed a plausible default would
 * compare face 0 against face 0 and report that all four faces are identical.
 * A crash gets fixed; a plausible default gets quoted.
 */
export function houseFontBinary(index: number, sans: string, mono: string, id: FaceIdentity): Uint8Array {
  const spec = houseFaces(sans, mono)[index];
  if (!spec) throw new RangeError('houseFontBinary: no face at index ' + index + ' — there are four');
  return buildFont(spec, HOUSE_GLYPHS, houseMetrics(id));
}
