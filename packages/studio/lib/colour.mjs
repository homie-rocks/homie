/**
 * COLOUR ARITHMETIC for art direction: hex and RGB, HSL nudges (a palette steered "warmer" or "less saturated"),
 * CIE Lab and the CIEDE2000 difference (is an asset's albedo still in the locked palette?), and a small k-means for
 * the dominant colours of a picture. No dependencies; numbers, never a file.
 */

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const HEX = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#ffcf5a" (or "#fc5") as [r, g, b] in 0..255; null when it is not a hex colour. */
export function hexToRgb(hex) {
  const m = HEX.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl([r, g, b]) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  const H = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; if (x < 1 / 6) return p + (q - p) * 6 * x; if (x < 1 / 2) return q; if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6; return p; };
  return [f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255];
}

/** The shortest signed angle from hue a to hue b, in degrees. */
const hueStep = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * One colour nudged: { hue: degrees toward `toward` (or a plain rotation), sat: multiply, light: add (-1..1),
 * warm: 0..1 (toward orange) or cool (toward blue) }. Greys stay grey.
 */
export function nudge(hex, { warm = 0, cool = 0, sat = 1, light = 0, hue = 0 } = {}) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  let [h, s, l] = rgbToHsl(rgb);
  if (s > 0.06) {
    if (warm) h += hueStep(h, 32) * clamp(warm);
    if (cool) h += hueStep(h, 215) * clamp(cool);
    h += hue;
  }
  s = clamp(s * sat);
  l = clamp(l + light, 0.02, 0.98);
  return rgbToHex(hslToRgb([h, s, l]));
}

/* ------------------------------------------------------------------ Lab and CIEDE2000 */

function srgbToLinear(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }

/** sRGB [0..255] to CIE L*a*b* (D65). */
export function rgbToLab([r, g, b]) {
  const R = srgbToLinear(r); const G = srgbToLinear(g); const B = srgbToLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X); const fy = f(Y); const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 between two Lab colours (Sharma, Wu and Dalal 2005). About 2.3 is "just noticeable". */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1; const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1); const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => { if (b === 0 && ap === 0) return 0; const h = Math.atan2(b, ap) / rad; return h >= 0 ? h : h + 360; };
  const hp1 = hp(b1, ap1); const hp2 = hp(b2, ap2);
  const dL = L2 - L1; const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2; const Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { hb = Math.abs(hp1 - hp2) <= 180 ? (hp1 + hp2) / 2 : hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb; const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** ΔE2000 between two hex colours. */
export const deltaHex = (a, b) => { const x = hexToRgb(a); const y = hexToRgb(b); return x && y ? deltaE2000(rgbToLab(x), rgbToLab(y)) : Infinity; };

/** The nearest palette colour to `hex`: { hex, delta }. */
export function nearest(hex, palette) {
  let best = { hex: null, delta: Infinity };
  for (const p of palette) { const d = deltaHex(hex, p); if (d < best.delta) best = { hex: p, delta: d }; }
  return best;
}

/**
 * Dominant colours of RGB samples ([[r,g,b], ...], or a flat Uint8Array of RGB with `weights`), by k-means in Lab:
 * [{ hex, share }] biggest share first. Deterministic: the first centres are the most distant samples.
 */
export function dominant(samples, k = 5, { iterations = 12 } = {}) {
  const pts = samples.map((s) => ({ rgb: s.rgb ?? s, w: s.w ?? 1, lab: rgbToLab(s.rgb ?? s) }));
  if (!pts.length) return [];
  const K = Math.min(k, pts.length);
  // Farthest-point seeding from the heaviest sample.
  const centres = [pts.slice().sort((a, b) => b.w - a.w)[0].lab];
  while (centres.length < K) {
    let far = null; let fd = -1;
    for (const p of pts) { const d = Math.min(...centres.map((c) => (c[0] - p.lab[0]) ** 2 + (c[1] - p.lab[1]) ** 2 + (c[2] - p.lab[2]) ** 2)); if (d > fd) { fd = d; far = p; } }
    centres.push(far.lab);
  }
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    assign = pts.map((p) => { let bi = 0; let bd = Infinity; centres.forEach((c, i) => { const d = (c[0] - p.lab[0]) ** 2 + (c[1] - p.lab[1]) ** 2 + (c[2] - p.lab[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; });
    for (let i = 0; i < K; i++) {
      let w = 0; const s = [0, 0, 0];
      pts.forEach((p, j) => { if (assign[j] === i) { w += p.w; s[0] += p.lab[0] * p.w; s[1] += p.lab[1] * p.w; s[2] += p.lab[2] * p.w; } });
      if (w) centres[i] = [s[0] / w, s[1] / w, s[2] / w];
    }
  }
  const total = pts.reduce((n, p) => n + p.w, 0);
  return centres.map((c, i) => {
    let w = 0; const rgb = [0, 0, 0];
    pts.forEach((p, j) => { if (assign[j] === i) { w += p.w; rgb[0] += p.rgb[0] * p.w; rgb[1] += p.rgb[1] * p.w; rgb[2] += p.rgb[2] * p.w; } });
    return w ? { hex: rgbToHex(rgb.map((x) => x / w)), share: +(w / total).toFixed(3) } : null;
  }).filter(Boolean).sort((a, b) => b.share - a.share);
}

/** Relative luminance (0..1) of a hex colour, for "is this a light palette". */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Interpolate two hex colours (t 0..1). */
export function mix(a, b, t) {
  const x = hexToRgb(a); const y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}
