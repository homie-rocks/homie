/**
 * ============================================================================
 *  @homie-rocks/ui/legibility.ts — a panel's own contrast audit, so a comment cannot
 *  be the only thing claiming the instrument is readable.
 * ============================================================================
 *
 * From the space racer's HUD, where it was written because that file had
 * carried, for a long time, a comment claiming a legibility fix that the
 * pixels did not contain. A comment cannot fail a build. This can.
 *
 * ── WHAT IS GENERAL, AND IT IS ALL OF IT ───────────────────────────────────
 *
 * Four questions, and none of them names a game:
 *
 *   1. Does a value ramp actually RAMP — monotone in CIE L*, and by enough to
 *      see across the band that matters? Peripheral vision resolves value long
 *      before it resolves hue, so a ramp flat in L* is a ramp that only works
 *      when it is looked at directly, which is the one case it is not for.
 *   2. Does it stay in one hue FAMILY? A thermal ramp that goes cold, a
 *      depth ramp that goes warm, a friend/foe ramp that crosses — each is the
 *      same defect, and each is invisible to a monotonicity test.
 *   3. Does every LIVE MARK clear a contrast ratio against the surface it is
 *      actually segmented from? For an instrument with an opaque well that is
 *      the well, and never the scene, because the well is what the eye sees.
 *   4. Is the HOUSING an object? Two separate failures: its bezel must
 *      separate from its own face (WCAG 1.4.11's 3:1 for the visual boundary
 *      of a UI component — backdrop-independent, so it is the test that cannot
 *      be argued with), and its strongest edge must separate from the worst
 *      backdrop the regime can put behind it, or the fixture has sunk into the
 *      world.
 *
 * ── NO DEFAULT THRESHOLD, ANYWHERE, AND THAT IS NOT PEDANTRY ───────────────
 *
 * Every bound is a required argument. Some of these numbers are WCAG's and
 * some are one game's judgement about its own art direction — 4.5 and 3 are
 * the standard's, an 18-point rise across a named band and a 0.04 chroma floor
 * are not — and a package that shipped a default for either kind would hand
 * the first game's answer to every game after it, silently. A caller that
 * forgets a bound should fail to compile.
 *
 * Same for the four ROLE questions the caller answers by construction: which
 * backdrops a regime can produce, what the well is painted, which end of the
 * ramp is "hot", and how far up the ramp the monotonicity claim runs. All of
 * those are facts about one instrument on one machine.
 *
 * ── EVERY FUNCTION RETURNS SENTENCES, NOT A BOOLEAN ────────────────────────
 *
 * A failing audit has to say WHICH sample failed and BY HOW MUCH, because the
 * fix is a colour and the number is how you choose it. An empty array is a
 * pass. The caller concatenates and decides what to do with the list — throw,
 * log, fail a probe — because a package that chose would be choosing whether a
 * legibility regression stops a bring-up.
 */
import { contrast, contrastRGB, hexToOklab, type RGB } from './colour.ts';
import { housingBezel, housingFace, type HousingSkin } from './housing.ts';

// ---------------------------------------------------------------------------
//  1 + 2 — the ramp
// ---------------------------------------------------------------------------

export interface RampAudit {
  /**
   * What this ramp IS, in the sentence. Required, because a panel with a
   * thermal ramp and a depth ramp gets two lists back and "ramp L* not
   * monotone at t=0.555" tells the reader which half of nothing.
   */
  label: string;
  /** `#rrggbb` at 0..1. Pass the LUT's own reader, not a re-blend of it. */
  at(t: number): string;
  /** CIE L* at 0..1. Same: the drawn value, not a second derivation of it. */
  lstarAt(t: number): number;
  /** How many samples the walk takes. The LUT's own resolution is the honest one. */
  n: number;
  /**
   * The top of the MONOTONE claim, 0..1.
   *
   * Not always 1: a ramp is entitled to turn over at its hot end — a thermal
   * scale whose last band is a saturated red is darker than the amber under
   * it — and asserting monotonicity through that would fail a correct ramp.
   * Where it turns over is a fact about the ramp.
   */
  monotoneTo: number;
  /** The band the rise is measured across, and how much L* it must cover. */
  riseFrom: number;
  riseTo: number;
  minRise: number;
  /**
   * Below this Oklab chroma a sample has no hue worth testing — a near-neutral
   * is allowed to be on either side of the family line, because it is not on
   * either side of anything the eye can see.
   */
  chromaFloor: number;
  /** `'warm'` requires red above blue at every chromatic sample; `'cold'` the reverse. */
  family: 'warm' | 'cold';
}

export function auditRamp(s: RampAudit): string[] {
  const fail: string[] = [];
  let prev = -1;
  for (let k = 0; k <= Math.round(s.monotoneTo * s.n); k++) {
    const L = s.lstarAt(k / s.n);
    // `- 1e-4` and not `<=`: a LUT stores L* in a Float32Array, so two adjacent
    // entries of an honestly flat segment can differ in the last place and a
    // strict test would report the storage rather than the ramp.
    if (L <= prev - 1e-4) fail.push(`${s.label} L* not monotone at t=${(k / s.n).toFixed(3)}`);
    prev = L;
  }
  const rise = s.lstarAt(s.riseTo) - s.lstarAt(s.riseFrom);
  if (rise < s.minRise) {
    fail.push(`${s.label} L* rise ${s.riseFrom}->${s.riseTo} is ${rise.toFixed(1)}, want >= ${s.minRise}`);
  }
  for (let k = 0; k <= s.n; k++) {
    const c = s.at(k / s.n);
    const n = parseInt(c.slice(1), 16);
    const [, A, B] = hexToOklab(c);
    const red = (n >> 16) & 255, blue = n & 255;
    const wrong = s.family === 'warm' ? blue > red : red > blue;
    if (Math.hypot(A, B) > s.chromaFloor && wrong) {
      fail.push(`${s.label} colour ${c} at t=${(k / s.n).toFixed(3)} is not in the ${s.family} family`);
      // ONE REPORT, not one per entry. A ramp that has crossed the family line
      // has usually crossed it for a whole band, and forty identical sentences
      // bury the three other findings this audit is also making.
      break;
    }
  }
  return fail;
}

// ---------------------------------------------------------------------------
//  3 — a live mark against the surface it is segmented from
// ---------------------------------------------------------------------------

/**
 * `inks` is a LIST because a channel is usually a ramp and one endpoint
 * clearing the bar says nothing about the middle of it. `label` names the mark
 * in the sentence, since a caller with four channels gets four lists back.
 */
export interface ChannelAudit {
  label: string;
  inks: readonly string[];
  /** What the eye actually segments the mark from. For a recessed channel that
   *  is the WELL, and never the scene: the well is opaque and the scene is not
   *  behind the mark at all. */
  against: string;
  min: number;
}

export function auditChannel(s: ChannelAudit): string[] {
  const fail: string[] = [];
  for (const ink of s.inks) {
    const c = contrast(ink, s.against);
    if (c < s.min) {
      fail.push(`${s.label} ${ink} vs ${s.against} is ${c.toFixed(2)}:1, want >= ${s.min}`);
    }
  }
  return fail;
}

// ---------------------------------------------------------------------------
//  4 — the fixture has to be an object
// ---------------------------------------------------------------------------

/**
 * One lighting regime the instrument is drawn in.
 *
 * `v` is the BACKLIGHT the housing is actually composited at, and it is the
 * column that gets forgotten: every alpha in `drawHousing` is a function of it,
 * so auditing a lit regime at `v = 0` describes a panel the game never draws.
 */
export interface Regime {
  name: string;
  /** the worst world value the instrument can be seen against here */
  backdrop: RGB;
  /** the coat the fixture is painted with in this regime */
  bright: boolean;
  v: number;
}

export interface HousingAudit {
  skin: HousingSkin;
  regimes: readonly Regime[];
  /**
   * The bezel against its OWN face. WCAG 1.4.11's floor for the visual boundary
   * of a UI component is 3, and it is backdrop-independent by construction,
   * which makes it the half of this test that cannot be argued with.
   */
  boundaryMin: number;
  /**
   * The strongest of the three edges against the backdrop.
   *
   * DELIBERATELY MEASURED ON THE EDGE AND NOT ON THE FACE. An anodised panel is
   * SUPPOSED to be close in value to what is behind it — that is what makes it
   * a finish rather than a card laid over the picture — and a version of this
   * test that asked the face to clear the world failed a correct housing and
   * implied lifting it into a pale slab across the darkest frames in the game.
   * What delimits a fixture is its moulding.
   */
  edgeMin: number;
}

export function auditHousing(s: HousingAudit): string[] {
  const fail: string[] = [];
  for (const r of s.regimes) {
    const face = housingFace(s.skin, r.backdrop, r.v, r.bright);
    const bez = housingBezel(s.skin, face, r.v, r.bright);
    const boundary = contrastRGB(bez.top, face);
    if (boundary < s.boundaryMin) {
      fail.push(`housing bezel vs its own face in ${r.name} is ${boundary.toFixed(2)}:1`);
    }
    const edge = Math.max(
      contrastRGB(bez.top, r.backdrop),
      contrastRGB(bez.rail, r.backdrop),
      contrastRGB(bez.bottom, r.backdrop),
    );
    if (edge < s.edgeMin) {
      fail.push(`housing has sunk into ${r.name}: best edge ${edge.toFixed(2)}:1`);
    }
  }
  return fail;
}
