/**
 * ============================================================================
 *  colour — sRGB, Oklab, WCAG contrast, and the ramp built out of them.
 * ============================================================================
 *
 *  Extracted from the space racer's HUD, which was the only TYPESCRIPT copy —
 *  but not the only copy: the host runtime carried `srgbToLinear` /
 *  `linearToSrgb` / `contrast` as plain JS, unreachable from a game's Vite
 *  build, and a type-scale probe carried its own `contrast(a, b)`.
 *
 *  Three implementations of the same 1996 arithmetic in three dialects of the
 *  same language. This is the one a game imports; the host's copy is a served
 *  asset on the other side of a bundler boundary and stays where it is.
 *
 *  ── WHAT IS HERE AND WHAT IS DELIBERATELY NOT ───────────────────────────────
 *
 *  Here: the transfer function, the Oklab round trip, relative luminance, the
 *  contrast ratio, straight-alpha compositing, and `oklabRamp`.
 *
 *  Not here, and it is the same line every time: WHICH COLOURS. A stop list is
 *  a palette and a palette is art direction. `oklabRamp` takes the stops and
 *  gives back a lookup; it will never carry a default set, because a default
 *  set is one game's instrument handed to the next one under a generic name.
 *
 *  ── THE ONE THING TO READ BEFORE TOUCHING `oklabRamp` ───────────────────────
 *
 *  IT INTERPOLATES IN OKLAB (L, a, b), NOT IN OKLCH. A polar blend takes the
 *  shortest HUE path, so a near-neutral blue-grey at hue 256 blended to a
 *  near-neutral ochre at hue 82 runs through 169 — which is GREEN, a hue
 *  neither endpoint contains and which a viewer reads instantly as a fifth
 *  colour in a four-colour interface. In Oklab the same leg passes through the
 *  neutral axis: it desaturates to grey and re-saturates warm, which is what a
 *  cooling piece of steel actually does. Lightness is the same channel in both
 *  forms, so monotonicity is unaffected by the choice and the caller keeps it.
 *
 *  THIS FILE IMPORTS NOTHING. `@homie-rocks/ui` is DOM-only by charter and this
 *  half of it is not even that — a Node script can audit a palette with no
 *  browser anywhere, which is what makes the audit runnable in a plain check.
 * ============================================================================
 */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
//  The transfer function
// ---------------------------------------------------------------------------
/** One sRGB code value, 0..255, to scene-linear 0..1. */
export function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Scene-linear 0..1 back to one sRGB code value, 0..255, rounded and clamped. */
export function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return clamp(Math.round(v * 255), 0, 255);
}

// ---------------------------------------------------------------------------
//  Oklab
// ---------------------------------------------------------------------------
/** `#rrggbb` -> Oklab [L, a, b]. */
export function hexToOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 255);
  const g = srgbToLinear((n >> 8) & 255);
  const b = srgbToLinear(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/**
 * Oklab -> `#rrggbb`. Out-of-gamut components clamp, which is correct for a
 * ramp: every STOP is an authored in-gamut hex and only the interpolated points
 * between them are computed.
 */
export function oklabToHex(L: number, A: number, B: number): string {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** CIE L* of an Oklab lightness, for a contrast invariant or a ramp audit. */
export function oklabLStar(L: number): number {
  // Oklab's L is very nearly Y^(1/3) for a neutral, and a ramp is judged on
  // relative luminance rather than on chroma, so the round trip is one cube.
  const Y = clamp01(L * L * L);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

// ---------------------------------------------------------------------------
//  WCAG
// ---------------------------------------------------------------------------
/** WCAG relative luminance of `#rrggbb`. */
export function relLuma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgbToLinear((n >> 16) & 255)
    + 0.7152 * srgbToLinear((n >> 8) & 255)
    + 0.0722 * srgbToLinear(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb`, always >= 1, order-free. */
export function contrast(a: string, b: string): number {
  const x = relLuma(a) + 0.05, y = relLuma(b) + 0.05;
  return x > y ? x / y : y / x;
}

// ---------------------------------------------------------------------------
//  Straight-alpha compositing, in code values
// ---------------------------------------------------------------------------
/**
 * A colour as three 0..255 code values, NOT rounded.
 *
 * Unrounded on purpose: an audit that replays a stack of five source-over fills
 * has to keep the intermediates, or it accumulates half a code value of error
 * per layer and reports a contrast ratio the pixels do not have.
 */
export type RGB = [number, number, number];

/** `fg` at alpha `a` over `bg`, source-over, in code values. */
export function overRGB(fg: RGB, a: number, bg: RGB): RGB {
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ];
}

export function hexToRGB(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbLuma(c: RGB): number {
  return 0.2126 * srgbToLinear(Math.round(c[0]))
    + 0.7152 * srgbToLinear(Math.round(c[1]))
    + 0.0722 * srgbToLinear(Math.round(c[2]));
}

export function contrastRGB(a: RGB, b: RGB): number {
  const x = rgbLuma(a) + 0.05, y = rgbLuma(b) + 0.05;
  return x > y ? x / y : y / x;
}

// ---------------------------------------------------------------------------
//  The ramp
// ---------------------------------------------------------------------------
/** `[position 0..1, '#rrggbb']`, ascending in position. */
export type RampStop = readonly [number, string];

export interface OklabRamp {
  /** `#rrggbb` at `t`, 0..1. One multiply and one array read. */
  at(t: number): string;
  /** CIE L* at `t`, 0..1, for a monotonicity or rise assertion. */
  lstarAt(t: number): number;
  /** The lookup itself, `n + 1` entries. An audit walks THIS, not a re-blend. */
  readonly hex: readonly string[];
  readonly lstar: Float32Array;
}

/**
 * Build a lookup from a stop list, interpolating in Oklab.
 *
 * A LUT rather than a live blend for two reasons, and the second is the one
 * that matters. Cost: the six cube roots per entry are paid `n + 1` times in a
 * session instead of once a frame. AND VERIFIABILITY: an audit walks `hex` and
 * `lstar` directly, so what is asserted is what is DRAWN rather than a
 * reimplementation of it that can drift — which is the failure that once left
 * a comment claiming a legibility fix beside pixels that did not contain one.
 *
 * BUILT EAGERLY, not on first use. A lazily built ramp is a first-frame stall
 * on the frame a capture harness is most likely to photograph, and it makes
 * `at()` a function that sometimes allocates.
 *
 * `at()` returns `#rrggbb` and NEVER `rgb(...)`, and that is load-bearing:
 * `uiUtil.mixHex` parses with `parseInt(h.slice(1), 16)`, so an `rgb(...)`
 * string becomes `NaN`, every downstream bit operation collapses to zero, and
 * the result is a black fill with no error reported anywhere.
 */
export function oklabRamp(stops: readonly RampStop[], n = 128): OklabRamp {
  if (stops.length < 2) {
    throw new RangeError(`oklabRamp: need at least two stops, got ${stops.length}`);
  }
  if (!(n >= 1)) throw new RangeError(`oklabRamp: n must be >= 1, got ${n}`);
  // Flattened into typed arrays before the loop, and not only for speed: the
  // loop below indexes four positions per entry, and a tuple-of-tuples under
  // `noUncheckedIndexedAccess` makes every one of those a `| undefined` that
  // has to be asserted away. An assertion is a claim a reader has to re-derive;
  // a flat Float64Array whose length was computed from the same `stops.length`
  // is one the compiler can see.
  const m = stops.length;
  const pos = new Float64Array(m);
  const lab = new Float64Array(m * 3);
  for (let i = 0; i < m; i++) {
    const s = stops[i] as RampStop;
    if (i > 0 && s[0] < (pos[i - 1] as number)) {
      throw new RangeError(
        `oklabRamp: stops must ascend; stop ${i} is at ${s[0]} after ${pos[i - 1]}`,
      );
    }
    pos[i] = s[0];
    const [L, A, B] = hexToOklab(s[1]);
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
  }
  const hex: string[] = new Array(n + 1);
  const lstar = new Float32Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    let i = 0;
    while (i < m - 2 && t > (pos[i + 1] as number)) i++;
    const t0 = pos[i] as number, t1 = pos[i + 1] as number;
    const f = clamp01((t - t0) / Math.max(1e-6, t1 - t0));
    const a = i * 3, b = a + 3;
    const L = (lab[a] as number) + ((lab[b] as number) - (lab[a] as number)) * f;
    hex[k] = oklabToHex(
      L,
      (lab[a + 1] as number) + ((lab[b + 1] as number) - (lab[a + 1] as number)) * f,
      (lab[a + 2] as number) + ((lab[b + 2] as number) - (lab[a + 2] as number)) * f,
    );
    lstar[k] = oklabLStar(L);
  }
  return {
    hex,
    lstar,
    at: (t: number) => hex[Math.round(clamp01(t) * n)] as string,
    lstarAt: (t: number) => lstar[Math.round(clamp01(t) * n)] as number,
  };
}

// ---------------------------------------------------------------------------
//  Identity without a hue
// ---------------------------------------------------------------------------
/**
 * Pull a colour toward its own Rec.709 luma, keeping the VALUE and spending the
 * chroma.
 *
 * THE PROBLEM IT SOLVES IS A COLOUR LAW, not a look. A HUD that reserves four
 * saturated hues for four meanings cannot also spend one of them on identity —
 * eight team liveries drawn raw put at least one saturated hazard amber beside
 * a rival's name, and the eye then reads a warning where there is none. What
 * actually separates eight swatches at 8–10 px is VALUE anyway, because chroma
 * is the first thing to go at that size. So the mark keeps the value it had and
 * loses as much of the hue as the caller asks for.
 *
 * `keep` IS THE WHOLE ARGUMENT AND THERE IS NO DEFAULT. At 0 every livery is
 * one grey — measured on an eight-team roster, 0.22 produced
 * `#434542`, *"a square that carries no information"* — and at 1 nothing has
 * been spent. It is a judgement about how many marks have to stay apart and how
 * small they are drawn, and it is a different number for a name chip and for a
 * dot on a circuit diagram.
 *
 * Takes and returns what a canvas and a stylesheet both want: components in
 * 0..1 in, an `rgb(...)` string out, rounded and clamped to bytes.
 */
export function desaturate(c: { r: number; g: number; b: number }, keep: number): string {
  const y = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const to8 = (v: number) => {
    const n = Math.round((y + (v - y) * keep) * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };
  return `rgb(${to8(c.r)}, ${to8(c.g)}, ${to8(c.b)})`;
}
