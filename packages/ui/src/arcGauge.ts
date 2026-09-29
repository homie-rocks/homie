/**
 * ============================================================================
 *  arcGauge — a round instrument on a 2D canvas, with nothing in it that knows
 *  what it is measuring.
 * ============================================================================
 *
 * A channel with a value fill, a warning band over the top of the sweep, two
 * series of graduations attached to the channel at one inset, an end label at
 * each extreme, a concentric inner ring that carries a second quantity, an
 * additive surge arc outside the channel, and a needle with a counterweight, a
 * cast shadow and a hub cap. That is the whole vocabulary and none of it names
 * a speed, a charge or a boost.
 *
 * WHY THIS IS A PACKAGE AND NOT A GAME'S DRAWING CODE. It lived in the kart
 * racer's HUD as `drawDial`, 277 lines, and the header above it argued it was
 * not generic because "it is a drift-charge tier indicator wearing a
 * speedometer". Both halves of that are true and neither
 * is an argument: the SEMANTICS are the game's and stay there — which colour a
 * tier is, what the inner ring means in each half of the loop, when the surge
 * is on — while the DRAWING is a gauge, and a gauge is a gauge. Every number
 * that decides what it looks like is in the two structs below and every one of
 * them is required, with no default anywhere in this file. A package that
 * shipped a default channel width would be shipping one game's instrument to
 * the next one under a noun.
 *
 * ## The contract
 *
 *  · **Nothing here is optional and nothing here is remembered.** Both structs
 *    are total. The gauge probe proves it by running the same frame twice with
 *    two different specs and requiring the two call streams to differ — an
 *    extracted option that is welded shut passes every other gate, and four of
 *    them once shipped exactly that way.
 *  · **No colour and no proportion is chosen here.** `GaugeInk` is entirely
 *    strings the caller supplies; `GaugeMetrics` is entirely fractions the
 *    caller supplies. The only literals in the body are 0, 1, 2 and Math.PI.
 *  · **It takes a context, a size and two structs.** No DOM, no game state, no
 *    class. It can be driven by a recording stub, which is what the probe does.
 *
 * ## Weights
 *
 * A stroke on this instrument is authored as a pair — a floor in device pixels
 * and a fraction of the canvas width — because a 1440p dial and a 720p dial
 * want the same PROPORTIONS down to the size where a hairline stops being a
 * hairline, and below that they want a hairline. `weight()` is that pair
 * resolved, and it is the one piece of arithmetic this file performs on the
 * caller's behalf.
 */

/** [floor in device px, fraction of the canvas width] */
export type Weight = readonly [number, number];

export function weight(W: number, k: Weight): number {
  return Math.max(k[0], W * k[1]);
}

/**
 * Every proportion of the instrument. Fractions of the canvas unless a comment
 * says otherwise; angles in radians.
 */
export interface GaugeMetrics {
  /** centre, of width and of height */
  cx: number;
  cy: number;
  /** radius of the channel's centre line, of height */
  r: number;
  /** start and end of the sweep */
  a0: number;
  a1: number;
  /** where the warning band starts, as a fraction of the sweep */
  bandAt: number;
  /** how many major graduations span the sweep. One minor sits between each. */
  majorSteps: number;

  /** channel width, of the radius */
  channel: number;
  /** the value fill's width, of the channel */
  fill: number;
  /** the fill is not drawn below this many radians, so a zero reading is empty */
  fillFloor: number;

  /** graduation inset from the channel's outer edge, of the channel */
  tickInset: number;
  /** major and minor graduation lengths, of the radius */
  majorLen: number;
  minorLen: number;
  majorInk: Weight;
  majorLight: Weight;
  minorInk: Weight;
  minorLight: Weight;

  /** end labels: gap beyond the majors (of the radius), size (of the width) */
  labelGap: number;
  labelSize: number;
  labelInk: Weight;
  /** below this canvas width in device px the labels are clutter and are dropped */
  labelMinW: number;

  /** the inner ring: how far inboard of the channel (of the channel), and how wide */
  innerInset: number;
  innerWidth: number;
  /** the lit part of the inner ring, of its own width */
  innerBand: number;
  /** the ring's banked-body opacity */
  innerBodyAlpha: number;
  /** the two leading-edge caps, in radians back from the fill's end */
  capWide: number;
  capNarrow: number;

  /**
   * The surge arc: radius beyond the channel centre, and its width — both of
   * the CHANNEL, not of the canvas width, so the halo keeps its relationship
   * to the groove it sits outside rather than to the panel's aspect.
   */
  surgeOffset: number;
  surgeWidth: number;
  surgeWidthMin: number;
  /** surge opacity is surgeAlpha + surgeAlphaGain * frac */
  surgeAlpha: number;
  surgeAlphaGain: number;
  surgeBlur: number;

  /** how far the needle is allowed past each end of the sweep, of the sweep */
  needleUnder: number;
  needleOver: number;
  /** needle tip, inboard of the channel centre by this much of the channel */
  needleTip: number;
  /** counterweight length, half-width at the pivot, tail half-width, tail bulge — of the radius */
  needleTail: number;
  needleHalf: number;
  needleWaist: number;
  needleBulge: number;
  needleInk: Weight;
  needleShadowBlur: number;
  needleShadowX: number;
  needleShadowY: number;

  /** hub cap radius, of the radius; its core, of itself */
  hubR: number;
  hubCore: number;
  hubInk: Weight;

  /** blur radii, of the canvas width */
  fillBlur: number;
  fillBlurHot: number;
  bandBlurHot: number;
}

/** Every colour on the instrument. All of them the caller's. */
export interface GaugeInk {
  /** the dark groove the value sits in, and the flat unfilled scale over it */
  well: string;
  scale: string;
  /** the value fill's bloom, cold and hot */
  fillGlow: string;
  fillGlowHot: string;
  /** the warning band, its hot state, its bloom, and the fill laid back over it */
  band: string;
  bandHot: string;
  bandGlowHot: string;
  bandOver: string;
  /** graduations: an ink pass under a light pass, both series */
  majorInk: string;
  majorLight: string;
  minorInk: string;
  minorLight: string;
  /** the two end labels */
  labelFill: string;
  labelStroke: string;
  /**
   * The whole CSS font shorthand, given the size this frame resolved to. A
   * function rather than a family string because weight, stretch and the
   * fallback stack are one typographic decision and splitting them across a
   * package boundary is how a dial ends up in a different family from every
   * other numeral in its own frame.
   */
  labelFont: (px: number) => string;
  /** the inner ring's own groove, and the cap struck on its leading edge */
  innerWell: string;
  innerCap: string;
  /** the surge arc and its bloom */
  surge: string;
  surgeGlow: string;
  /** the needle, cold and hot, its outline and its cast shadow */
  needle: string;
  needleHot: string;
  needleInk: string;
  needleShadow: string;
  /** the hub cap: three stops top to bottom, an outline and a core */
  hub: readonly [string, string, string];
  hubInk: string;
  hubCore: string;
}

/**
 * The inner ring for one frame, already resolved by the game.
 *
 * The ring is where a second quantity rides, and what that quantity MEANS
 * changes with the state of whatever loop the game is running — which is
 * exactly why the resolution happens at the call site and only the result
 * arrives here. `body` and `cap` are two colours, `fill` is one number, and
 * this file has no opinion about where any of them came from.
 */
export interface GaugeRing {
  /** angle of the lit end, as a fraction of the sweep, already clamped */
  fill: number;
  /** the ring's body colour, and the colour of its leading edge */
  body: string;
  cap: string;
  /** draw the full-sweep banked band under the fill */
  banded: boolean;
  /** bloom on the leading edge, of the canvas width */
  glow: number;
}

/** Everything that changes frame to frame. */
export interface GaugeFrame {
  /** the reading, 0..1, before the needle's own overtravel is applied */
  value: number;
  /** what the value fill is painted with — a gradient built once, or a colour */
  fillStyle: string | CanvasGradient;
  /** the hot state: warning band blooms, needle and fill change colour */
  hot: boolean;
  /**
   * Whether the surge arc is drawn at all, and how much of it is left.
   *
   * TWO FIELDS AND NOT ONE, deliberately. A surge that is ON with nothing left
   * still paints its base opacity over a zero-length arc, and a caller that
   * collapsed the two would silently stop drawing on the last frame of every
   * surge. Presence is a state; length is a number.
   */
  surgeOn: boolean;
  surge: number;
  /** the two end labels, or null to draw none */
  labels: readonly [string, string] | null;
  /** the inner ring, or null when nothing is riding on it this frame */
  ring: GaugeRing | null;
}

/**
 * Build the value fill's ramp for a given canvas size. Cached by the caller
 * and handed back on `GaugeFrame.fillStyle`; rebuilt when the canvas resizes.
 *
 * The ramp runs across the dial rather than around it, which is why it is a
 * linear gradient and not a conic one: a conic ramp reads as a rendering fault
 * on the unfilled half. The four offsets that place it are the caller's.
 */
export function gaugeRamp(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  m: GaugeMetrics,
  from: readonly [number, number],
  to: readonly [number, number],
  stops: readonly (readonly [number, string])[],
): CanvasGradient {
  const cx = m.cx * W;
  const cy = m.cy * H;
  const r = m.r * H;
  const grd = g.createLinearGradient(
    cx + r * from[0], cy + r * from[1],
    cx + r * to[0], cy + r * to[1],
  );
  for (const s of stops) grd.addColorStop(s[0], s[1]);
  return grd;
}

/**
 * Draw one frame of the instrument.
 *
 * The order is load-bearing and is the order the shipped dial was authored in:
 * groove, flat scale, value fill, warning band, the fill laid BACK over the
 * band (so the reading always wins), graduations, labels, inner ring, surge,
 * needle, hub. Reordering any of it changes the picture even though every
 * individual call is identical, which is why the gauge probe compares an
 * ordered call stream rather than a set.
 */
export function drawArcGauge(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  m: GaugeMetrics,
  ink: GaugeInk,
  f: GaugeFrame,
): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);

  const cx = m.cx * W;
  const cy = m.cy * H;
  const r = m.r * H;
  const sweep = m.a1 - m.a0;
  const chanW = r * m.channel;

  g.lineCap = 'butt';

  // --- channel + unfilled scale: ONE dark groove, ONE flat low value --------
  g.beginPath();
  g.arc(cx, cy, r, m.a0, m.a1);
  g.lineWidth = chanW;
  g.strokeStyle = ink.well;
  g.stroke();

  g.beginPath();
  g.arc(cx, cy, r, m.a0, m.a1);
  g.lineWidth = chanW * m.fill;
  g.strokeStyle = ink.scale;
  g.stroke();

  // --- value fill ----------------------------------------------------------
  const v = f.value < 0 ? 0 : f.value > 1 ? 1 : f.value;
  const va = m.a0 + sweep * v;
  if (va > m.a0 + m.fillFloor) {
    g.save();
    g.shadowColor = f.hot ? ink.fillGlowHot : ink.fillGlow;
    g.shadowBlur = W * (f.hot ? m.fillBlurHot : m.fillBlur);
    g.beginPath();
    g.arc(cx, cy, r, m.a0, va);
    g.lineWidth = chanW * m.fill;
    g.strokeStyle = f.fillStyle;
    g.stroke();
    g.restore();
  }

  // --- the warning band ----------------------------------------------------
  // Over the top of the sweep, sitting IN the channel so it reads as part of
  // the instrument rather than as a second overlay, and blooming in the hot
  // state so the payoff is unmistakable.
  const ra = m.a0 + sweep * m.bandAt;
  g.save();
  if (f.hot) {
    g.shadowColor = ink.bandGlowHot;
    g.shadowBlur = W * m.bandBlurHot;
  }
  g.beginPath();
  g.arc(cx, cy, r, ra, m.a1);
  g.lineWidth = chanW * m.fill;
  g.strokeStyle = f.hot ? ink.bandHot : ink.band;
  g.stroke();
  g.restore();

  // re-lay the value fill over the band so the needle's own arc still wins
  if (va > ra) {
    g.beginPath();
    g.arc(cx, cy, r, ra, va);
    g.lineWidth = chanW * m.fill;
    g.strokeStyle = ink.bandOver;
    g.stroke();
  }

  // --- the scale: majors and minors, ATTACHED to the channel ---------------
  // Graduations that float outside the arc with an inconsistent gap and no
  // relationship to the value read as stock iconography. Both series start at
  // ONE fixed inset from the channel's outer edge, so they read as graduations
  // of this instrument.
  const inset = chanW * m.tickInset;
  const t0 = r + chanW * 0.5 + inset;
  const tMaj = t0 + r * m.majorLen;
  const tMin = t0 + r * m.minorLen;

  g.beginPath();
  for (let i = 0; i < m.majorSteps; i++) {
    const a = m.a0 + sweep * ((i + 0.5) / m.majorSteps);
    const c = Math.cos(a), s = Math.sin(a);
    g.moveTo(cx + c * t0, cy + s * t0);
    g.lineTo(cx + c * tMin, cy + s * tMin);
  }
  g.lineCap = 'round';
  g.lineWidth = weight(W, m.minorInk);
  g.strokeStyle = ink.minorInk;
  g.stroke();
  g.lineWidth = weight(W, m.minorLight);
  g.strokeStyle = ink.minorLight;
  g.stroke();

  g.beginPath();
  for (let i = 0; i <= m.majorSteps; i++) {
    const a = m.a0 + sweep * (i / m.majorSteps);
    const c = Math.cos(a), s = Math.sin(a);
    g.moveTo(cx + c * t0, cy + s * t0);
    g.lineTo(cx + c * tMaj, cy + s * tMaj);
  }
  g.lineWidth = weight(W, m.majorInk);
  g.strokeStyle = ink.majorInk;
  g.stroke();
  g.lineWidth = weight(W, m.majorLight);
  g.strokeStyle = ink.majorLight;
  g.stroke();

  // TWO labels, at the ends of the sweep, and no more: enough to say what the
  // arc measures, not enough to become an infographic. Below `labelMinW` they
  // would be a few pixels tall, which is clutter rather than information, so
  // they are simply not drawn.
  if (f.labels && W >= m.labelMinW) {
    const lr = tMaj + r * m.labelGap;
    g.font = ink.labelFont(Math.round(W * m.labelSize));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = ink.labelFill;
    g.strokeStyle = ink.labelStroke;
    g.lineWidth = weight(W, m.labelInk);
    g.lineJoin = 'round';
    for (let i = 0; i <= 1; i++) {
      const a = m.a0 + sweep * i;
      const x = cx + Math.cos(a) * lr;
      const y = cy + Math.sin(a) * lr;
      const txt = f.labels[i] as string;
      g.strokeText(txt, x, y);
      g.fillText(txt, x, y);
    }
  }

  // --- the inner ring: ONE concentric arc, two states ----------------------
  // Laid a further half-channel inboard so there is dark between it and the
  // value fill — an arc immediately inside a fill of a similar hue is a
  // channel the eye cannot separate, which is how a fully-charged ring once
  // produced a frame with no visible indication in it at all.
  //
  //   BODY  the banked part, a full-sweep band at low opacity
  //   FILL  what is being earned (or spent), over it
  //   CAP   the leading edge, in the colour of what is being earned, capped
  //         with the brightest ink on the instrument — the eye finds a moving
  //         end-stop far faster than it measures the length of a bar.
  const ring = f.ring;
  if (ring) {
    const cr = r - chanW * m.innerInset;
    const lw = chanW * m.innerWidth;
    g.lineCap = 'butt';
    g.beginPath();
    g.arc(cx, cy, cr, m.a0, m.a1);
    g.lineWidth = lw;
    g.strokeStyle = ink.innerWell;
    g.stroke();

    if (ring.banded) {
      g.save();
      g.globalAlpha = m.innerBodyAlpha;
      g.beginPath();
      g.arc(cx, cy, cr, m.a0, m.a1);
      g.lineWidth = lw * m.innerBand;
      g.strokeStyle = ring.body;
      g.stroke();
      g.restore();
    }

    const ca = m.a0 + sweep * ring.fill;
    g.save();
    g.shadowColor = ring.cap;
    g.shadowBlur = W * ring.glow;
    g.beginPath();
    g.arc(cx, cy, cr, m.a0, ca);
    g.lineWidth = lw * m.innerBand;
    g.strokeStyle = ring.body;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, cr, Math.max(m.a0, ca - m.capWide), ca);
    g.lineWidth = lw * m.innerBand;
    g.strokeStyle = ring.cap;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, cr, Math.max(m.a0, ca - m.capNarrow), ca);
    g.lineWidth = lw * m.innerBand;
    g.strokeStyle = ink.innerCap;
    g.stroke();
    g.restore();
  }

  // --- the surge halo ------------------------------------------------------
  // An additive ring outside the channel, pulsing with what is left, so the
  // payoff is visible on the instrument that is showing what it bought.
  if (f.surgeOn) {
    g.save();
    g.globalAlpha = m.surgeAlpha + m.surgeAlphaGain * f.surge;
    g.shadowColor = ink.surgeGlow;
    g.shadowBlur = W * m.surgeBlur;
    g.beginPath();
    g.arc(cx, cy, r + chanW * m.surgeOffset, m.a0, m.a0 + sweep * f.surge);
    g.lineWidth = Math.max(m.surgeWidthMin, chanW * m.surgeWidth);
    g.lineCap = 'round';
    g.strokeStyle = ink.surge;
    g.stroke();
    g.restore();
    g.lineCap = 'butt';
  }

  // --- needle: a pointer with a counterweight, pivoting IN the dial --------
  // A plain sliver with no tail, no hub and no cast shadow reads as something
  // lying on top of the face. A counterweight past the pivot, a cast shadow on
  // the face and a cap over the pivot are the three things that make a pointer
  // look mounted.
  const nv = f.value < -m.needleUnder ? -m.needleUnder
    : f.value > 1 + m.needleOver ? 1 + m.needleOver : f.value;
  const na = m.a0 + sweep * nv;
  const tip = r - chanW * m.needleTip;
  const tail = r * m.needleTail;
  g.save();
  g.translate(cx, cy);
  g.rotate(na);
  g.beginPath();
  g.moveTo(tip, 0);
  g.lineTo(0, -r * m.needleHalf);
  g.lineTo(-tail, -r * m.needleWaist);
  g.quadraticCurveTo(-tail - r * m.needleBulge, 0, -tail, r * m.needleWaist);
  g.lineTo(0, r * m.needleHalf);
  g.closePath();
  g.save();
  g.shadowColor = ink.needleShadow;
  g.shadowBlur = W * m.needleShadowBlur;
  g.shadowOffsetX = W * m.needleShadowX;
  g.shadowOffsetY = W * m.needleShadowY;
  g.fillStyle = f.hot ? ink.needleHot : ink.needle;
  g.fill();
  g.restore();
  g.lineJoin = 'round';
  g.lineWidth = weight(W, m.needleInk);
  g.strokeStyle = ink.needleInk;
  g.stroke();
  g.restore();

  // hub cap — a two-stop vertical ramp, which is what a metal cap reads as
  const hr = r * m.hubR;
  const hub = g.createLinearGradient(cx, cy - hr, cx, cy + hr);
  hub.addColorStop(0, ink.hub[0]);
  hub.addColorStop(0.5, ink.hub[1]);
  hub.addColorStop(1, ink.hub[2]);
  g.beginPath();
  g.arc(cx, cy, hr, 0, Math.PI * 2);
  g.fillStyle = hub;
  g.fill();
  g.lineWidth = weight(W, m.hubInk);
  g.strokeStyle = ink.hubInk;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, hr * m.hubCore, 0, Math.PI * 2);
  g.fillStyle = ink.hubCore;
  g.fill();
}
