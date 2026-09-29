/**
 * ============================================================================
 *  Surface — the canvas-2D authoring kit a procedural vehicle is painted with.
 * ============================================================================
 *
 *  This is NOT a second `Textures.ts`. That file's job is *plumbing*: fields of
 *  floats in, GPU-ready `THREE.Texture` out, with the colour-space and budget
 *  rules applied once. This file's job is the step before it — the eight
 *  primitives a generator draws WITH, on a real `CanvasRenderingContext2D`,
 *  because the vehicles in both games are drawn with `arcTo` and `putImageData`
 *  and not composed out of float fields.
 *
 *  It arrived here **byte-identical** out of two files:
 *    · a kart racer's `Liveries.ts`, lines 60-326
 *    · a space racer's `Liveries.ts`, lines 84-350
 *  266 lines, `diff` clean, on 2026-08-20. The two racers are forks of each
 *  other and this block never diverged, which is the definition
 *  of one thing in two places rather than two things that resemble each other.
 *
 *  THE EMITTED JAVASCRIPT IS CHARACTER-FOR-CHARACTER WHAT THE GAMES SHIPPED.
 *  Every literal below — 1664525, 2.03, the 0.25 box weights, `anisotropy = 8`
 *  — is the games', not a default this package chose. A texture generator is
 *  photographable: a changed constant is a changed picture, and the whole
 *  reason this is a reduction and not a rewrite is that no number moved.
 *
 *  ON THE `!` IN THE TYPED-ARRAY TAPS. See the long note at the top of
 *  `Textures.ts`; the argument is identical and it is not repeated here. Short
 *  version: this package runs `noUncheckedIndexedAccess` and the games do not,
 *  every index in these loops is in range by construction, `!` erases at emit,
 *  and a bounds branch inside a 1024² loop would change what the code does.
 *
 *  `three` and `simplex-noise` are BOTH peer dependencies. Two copies of
 *  three.js is two `instanceof` universes; two copies of `simplex-noise` is
 *  merely wasteful — but a *different version* of it is a different noise
 *  field, which is a different texture, which is a different picture. Pinning
 *  it as a peer is what keeps the games' pixels the games'.
 * ============================================================================
 */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

/** Deterministic PRNG so every boot produces byte-identical textures. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function canvas(size: number, h = size): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

export function tex(
  ctx: CanvasRenderingContext2D,
  srgb: boolean,
  repeat = 1,
  flipY = true,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  t.flipY = flipY;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8; // clamped to the device max by three
  t.needsUpdate = true;
  return t;
}

/**
 * Sobel a greyscale height canvas into raw tangent-space SLOPES (dh/du, dh/dv).
 * Kept separate from the packed normal map because the *same* slope field also
 * drives the Toksvig roughness bake below — the two must agree exactly or the
 * anti-aliasing compensates for a surface that isn't there.
 */
export function heightSlope(src: CanvasRenderingContext2D, strength: number): Float32Array {
  const w = src.canvas.width;
  const h = src.canvas.height;
  const s = src.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h * 2);
  const at = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const i = (y * w + x) * 2;
      out[i] = -dx * strength;
      out[i + 1] = -dy * strength;
    }
  }
  return out;
}

/** Pack a slope field into an RGB tangent-space normal map. */
export function slopeToNormal(slope: Float32Array, w: number, h: number): CanvasRenderingContext2D {
  const dst = canvas(w, h);
  const out = dst.createImageData(w, h);
  const d = out.data;
  for (let i = 0; i < w * h; i++) {
    const nx = slope[i * 2]!;
    const ny = slope[i * 2 + 1]!;
    const inv = 1 / Math.hypot(nx, ny, 1);
    d[i * 4] = (nx * inv * 0.5 + 0.5) * 255;
    d[i * 4 + 1] = (ny * inv * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = inv * 255;
    d[i * 4 + 3] = 255;
  }
  dst.putImageData(out, 0, 0);
  return dst;
}

/** Convenience wrapper for callers that only want the packed normal map. */
export function heightToNormal(
  src: CanvasRenderingContext2D,
  strength: number,
): CanvasRenderingContext2D {
  return slopeToNormal(heightSlope(src, strength), src.canvas.width, src.canvas.height);
}

/**
 * Roughness texture with a HAND-BUILT MIP CHAIN (Toksvig / LEAN).
 *
 * A normal map that is busy relative to its mip chain is a specular aliaser:
 * as the GPU averages the normals away, the highlight they used to break up
 * collapses into per-pixel sparkle. That is exactly what crawls over a dark,
 * low-roughness surface at speed. The fix is not to soften the normal until
 * the sparkle goes — it is to convert the detail the mip chain *loses* into
 * roughness. So at every level we track the mean and mean-square of the slope
 * field, and fold its variance into the roughness stored at that level:
 *
 *     alpha' = sqrt(alpha^2 + 2 * var(slope))        (GGX alpha = roughness^2)
 *
 * Level 0 is untouched apart from the floor, so nothing is over-roughened up
 * close; by the time the normal has flattened out, roughness has taken over.
 * `chan` is the channel the material actually samples (three reads .g for both
 * roughnessMap and metalnessMap-adjacent packing) — every other channel is
 * plain box-filtered so an ORM pack survives the trip intact.
 */
export function toksvigTexture(
  src: CanvasRenderingContext2D,
  slope: Float32Array,
  normalScale: number,
  repeat: number,
  flipY: boolean,
  roughFloor: number,
): THREE.CanvasTexture {
  let w = src.canvas.width;
  let h = src.canvas.height;
  // float copies so ten successive box filters do not quantise into banding
  let rgba = Float32Array.from(src.getImageData(0, 0, w, h).data);
  let m1 = new Float32Array(w * h * 2);
  let m2 = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h * 2; i++) {
    const s = slope[i]! * normalScale;
    m1[i] = s;
    m2[i] = s * s;
  }

  const mips: HTMLCanvasElement[] = [];
  for (;;) {
    const c = canvas(w, h);
    const img = c.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      const mx = m1[i * 2]!;
      const my = m1[i * 2 + 1]!;
      const v = Math.max(0, m2[i * 2]! - mx * mx) + Math.max(0, m2[i * 2 + 1]! - my * my);
      const r = Math.max(roughFloor, rgba[i * 4 + 1]! / 255);
      const a = r * r;
      const lifted = Math.min(1, Math.pow(a * a + 2 * v, 0.25));
      d[i * 4] = Math.round(rgba[i * 4]!);
      d[i * 4 + 1] = Math.round(Math.max(lifted, roughFloor) * 255);
      d[i * 4 + 2] = Math.round(rgba[i * 4 + 2]!);
      d[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    mips.push(c.canvas);
    if (w === 1 && h === 1) break;

    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const nrgba = new Float32Array(nw * nh * 4);
    const nm1 = new Float32Array(nw * nh * 2);
    const nm2 = new Float32Array(nw * nh * 2);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(h - 1, y * 2);
      const y1 = Math.min(h - 1, y * 2 + 1);
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2);
        const x1 = Math.min(w - 1, x * 2 + 1);
        const a = (y0 * w + x0), b = (y0 * w + x1), cc = (y1 * w + x0), dd = (y1 * w + x1);
        const o = y * nw + x;
        for (let k = 0; k < 4; k++) {
          nrgba[o * 4 + k] = (rgba[a * 4 + k]! + rgba[b * 4 + k]! + rgba[cc * 4 + k]! + rgba[dd * 4 + k]!) * 0.25;
        }
        for (let k = 0; k < 2; k++) {
          nm1[o * 2 + k] = (m1[a * 2 + k]! + m1[b * 2 + k]! + m1[cc * 2 + k]! + m1[dd * 2 + k]!) * 0.25;
          nm2[o * 2 + k] = (m2[a * 2 + k]! + m2[b * 2 + k]! + m2[cc * 2 + k]! + m2[dd * 2 + k]!) * 0.25;
        }
      }
    }
    rgba = nrgba; m1 = nm1; m2 = nm2; w = nw; h = nh;
  }

  const t = new THREE.CanvasTexture(mips[0]!);
  t.mipmaps = mips;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = flipY;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Fill a rect with fBm value noise mapped through `map` -> css colour. */
export function fbmFill(
  c: CanvasRenderingContext2D,
  x0: number, y0: number, w: number, h: number,
  scale: number, octaves: number, seed: number,
  map: (n: number) => [number, number, number],
): void {
  const noise = createNoise2D(lcg(seed));
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let amp = 0.5;
      let f = scale;
      for (let o = 0; o < octaves; o++) {
        n += noise(x * f, y * f) * amp;
        f *= 2.03; // non-integer so the octaves never line up into a visible grid
        amp *= 0.5;
      }
      const [r, g, b] = map(n * 0.5 + 0.5);
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  c.putImageData(img, x0, y0);
}

/**
 * fbm into an existing context honouring globalAlpha (compositing overlay).
 * `res` caps the generated resolution — the noise is then upscaled, which is
 * the difference between a 60 ms boot and a 900 ms one.
 *
 * The COMPANION to `fbmFill` above, and the difference between them is the
 * whole point: `fbmFill` writes texels through `putImageData`, which ignores
 * `globalAlpha`, `globalCompositeOperation` and every clip on the context. This
 * one goes through `drawImage`, so it composites. It stood BYTE-IDENTICAL in
 * the two racers' `Liveries.ts`, in both cases as a
 * private function directly above a wall of calls to it, while the thing it
 * wraps was already here.
 */
export function fbmFillInto(
  c: CanvasRenderingContext2D,
  x0: number, y0: number, w: number, h: number,
  scale: number, octaves: number, seed: number,
  map: (n: number) => [number, number, number],
  res = 320,
): void {
  const k = Math.min(1, res / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  const tmp = canvas(tw, th);
  fbmFill(tmp, 0, 0, tw, th, scale / k, octaves, seed, map);
  c.drawImage(tmp.canvas, x0, y0, w, h);
}

/**
 * Add fine grain to a horizontal band of a HEIGHT canvas, seamless in U.
 *
 * The wheel atlas's U axis is the tyre's circumference, so any field generated
 * straight from a noise function carries a discontinuity down the whole height
 * of the tyre at u=0 — one hard vertical crease on the closest object to the
 * camera all race. Crossfading the field with a copy of itself shifted exactly
 * one period in U closes it: at u=1 the shifted copy is sampling what the
 * original samples at u=0, so the two ends meet. The price is a ~30% amplitude
 * dip mid-tile, which on a grain is invisible.
 *
 * Generated at half resolution and box-upscaled by the browser. That is not a
 * compromise: the atlas is 2.3 mm per texel at the tread radius, so a grain
 * authored per-texel is sub-pixel noise that mips straight into aliasing. Two
 * to three texels — 5 to 7 mm — is real moulded-rubber grain.
 */
export function addGrain(
  dst: CanvasRenderingContext2D, y0: number, h: number,
  cell: number, amp: number, seed: number,
): void {
  const w = dst.canvas.width;
  const gw = Math.max(1, w >> 1);
  const gh = Math.max(1, h >> 1);
  const noise = createNoise2D(lcg(seed));
  const tmp = canvas(gw, gh);
  const img = tmp.createImageData(gw, gh);
  const d = img.data;
  const f = 1 / cell;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = x / gw;
      const n = noise(x * f, y * f) * (1 - t) + noise((x - gw) * f, y * f) * t;
      const i = (y * gw + x) * 4;
      const v = 128 + n * 127;
      d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i + 3] = 255;
    }
  }
  tmp.putImageData(img, 0, 0);
  const up = canvas(w, h);
  up.drawImage(tmp.canvas, 0, 0, w, h);
  const g = up.getImageData(0, 0, w, h).data;
  const band = dst.getImageData(0, y0, w, h);
  const b = band.data;
  for (let i = 0; i < w * h; i++) {
    const v = b[i * 4]! + ((g[i * 4]! - 128) / 127) * amp;
    b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  dst.putImageData(band, 0, y0);
}

/**
 * An n-pointed star as a path, ready for `fill()` or `stroke()`.
 *
 * The first point is at TWELVE O'CLOCK, which is the only orientation anybody
 * ever means by "a star" and the one a caller would otherwise re-derive with a
 * `-Math.PI / 2` every time. `inner` is the valley radius as a fraction of the
 * point radius: 0.38 is the classical five-pointed star, and above about 0.6 a
 * star stops reading as one and becomes a cog.
 */
export function starPath(
  c: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, points = 5, inner = 0.38,
): void {
  c.beginPath();
  for (let i = 0; i < points; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / points;
    const b = a + Math.PI / points;
    const ox = i === 0 ? c.moveTo.bind(c) : c.lineTo.bind(c);
    ox(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    c.lineTo(cx + Math.cos(b) * r * inner, cy + Math.sin(b) * r * inner);
  }
  c.closePath();
}

/** Rounded rect as a path, ready for `fill()` or `stroke()`. */
export function rr(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
