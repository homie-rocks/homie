/**
 * ============================================================================
 *  tilebake — one pass over a WRAPPING height field, three tiling maps out.
 * ============================================================================
 *
 *  THIS IS THE THIRD SURFACE GENERATOR IN THIS PACKAGE AND THE DIFFERENCE IS
 *  NOT COSMETIC, so it is stated before anything else:
 *
 *   · `Surface.ts` draws on a real `CanvasRenderingContext2D` with `arcTo` and
 *     `putImageData`. It is how a vehicle's livery is painted, and its normals
 *     come out of a Sobel over image data.
 *   · `Textures.ts` owns the PLUMBING — float fields in, budgeted
 *     `THREE.Texture` out, ORM packed into one map, colour space applied once.
 *   · This file bakes a field that TILES. Its central differences read their
 *     neighbours modulo the size, so the normal map wraps as exactly as the
 *     albedo does. That is the property, and it is the one neither of the
 *     other two has: a Sobel that clamps at the border leaves a seam of
 *     wrong-facing normals down the join of every repeat, which under a low
 *     key is a lit hairline running across a road every 3.5 metres.
 *
 *  ── WHY ONE PASS AND NOT THREE ─────────────────────────────────────────────
 *
 *  The three maps must describe the SAME physical surface. Baked in separate
 *  loops they drift the moment somebody edits one height expression and not
 *  the others, and the symptom is specular that does not sit on the relief —
 *  which reads as a wet patch rather than as a mistake. One height array,
 *  computed once, consumed three times, is the structural version of the rule.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *   · MECHANISM — the wrap, the single pass, `convertLinearToSRGB` on the
 *     albedo (palette colours are authored linear and an albedo texture is
 *     sRGB; getting this backwards is a picture that is subtly wrong
 *     everywhere and obviously wrong nowhere), roughness in the GREEN channel
 *     because that is where three samples it, and the filter/wrap/mip setup.
 *   · CONTENT — every callback. `height`, `shade` and `rough` ARE the
 *     material, and `normalScale` is how much relief that material has. None
 *     of them has a default here and none of them ever should.
 *
 *  ── ON THE UNCLAMPED WRITES ────────────────────────────────────────────────
 *
 *  The albedo bytes go through `Math.max(0, Math.min(255, …))` and the
 *  roughness byte through `Math.max(0, Math.min(1, …)) * 255`, in that
 *  spelling, into a plain `Uint8Array`. `Uint8ClampedArray` would clamp for
 *  free and is NOT used: the pre-move source shipped `Uint8Array` and the two
 *  disagree on how a NaN lands — clamped stores 0, plain stores 0 as well, but
 *  they differ on values above 255 only if the explicit clamp is also removed,
 *  and removing it is precisely the tidy-up this note exists to refuse.
 * ============================================================================
 */
import * as THREE from 'three';

/** Albedo + normal + roughness, three tiling textures. */
export interface TileMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

function upload(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Bake `size` x `size` albedo, normal and roughness maps from one height field.
 *
 * @param height      the field, in whatever units `normalScale` is calibrated
 *                    against. Called once per texel with (u, v) in [0, 1).
 * @param shade       albedo at (u, v), given that texel's height. Writes into
 *                    the scratch colour it is handed — it must not allocate.
 * @param rough       roughness in [0, 1] at (u, v), given the height.
 * @param normalScale how steep the relief is made to look. Multiplies the
 *                    central difference before normalisation, so it absorbs
 *                    both the field's amplitude and the texel pitch.
 */
export function bakeTileMaps(
  size: number,
  height: (u: number, v: number) => number,
  shade: (u: number, v: number, h: number, out: THREE.Color) => void,
  rough: (u: number, v: number, h: number) => number,
  normalScale: number,
): TileMaps {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) H[y * size + x] = height(x / size, y / size);
  }
  const albedo = new Uint8Array(size * size * 4);
  const nrm = new Uint8Array(size * size * 4);
  const rgh = new Uint8Array(size * size * 4);
  const col = new THREE.Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const h = H[k]!;
      const u = x / size, v = y / size;
      shade(u, v, h, col);
      // palette colours live in linear space; the albedo texture is sRGB
      col.convertLinearToSRGB();
      const o = k * 4;
      albedo[o] = Math.max(0, Math.min(255, col.r * 255));
      albedo[o + 1] = Math.max(0, Math.min(255, col.g * 255));
      albedo[o + 2] = Math.max(0, Math.min(255, col.b * 255));
      albedo[o + 3] = 255;
      // THE MODULO IS THE POINT OF THIS FILE. Neighbours wrap, so the normal
      // map tiles as exactly as the albedo does.
      const hl = H[y * size + ((x - 1 + size) % size)]!;
      const hr = H[y * size + ((x + 1) % size)]!;
      const hd = H[((y - 1 + size) % size) * size + x]!;
      const hu = H[((y + 1) % size) * size + x]!;
      const nx = (hl - hr) * normalScale, ny = (hd - hu) * normalScale;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nrm[o] = (nx * inv * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm[o + 2] = (inv * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
      // three samples roughness from the green channel
      rgh[o + 1] = Math.max(0, Math.min(1, rough(u, v, h))) * 255;
      rgh[o + 3] = 255;
    }
  }
  return { map: upload(albedo, size, true), normalMap: upload(nrm, size, false), roughnessMap: upload(rgh, size, false) };
}

/**
 * Set the world-space tiling and the anisotropy on all three maps at once.
 *
 * Separate from the bake because the bake does not know how big a metre is and
 * must not: the same 512² cobble is a 1.4 m tile on a village street and a 4 m
 * one on a quay, and that is a decision about the place, not about the texture.
 */
export function tuneTileMaps(s: TileMaps, repeat: number, anisotropy: number): TileMaps {
  for (const t of [s.map, s.normalMap, s.roughnessMap]) {
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy;
  }
  return s;
}
