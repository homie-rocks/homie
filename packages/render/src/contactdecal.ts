/**
 * ============================================================================
 *  contactdecal — the MULTIPLY-blended mark that puts an object on the ground.
 * ============================================================================
 *
 *  Multiply is the right blend for a mark on a surface and it is the one three
 *  makes hardest to get right, so both halves live here once.
 *
 *  WHY MULTIPLY. `dst = src * dst`. A WHITE texel leaves the ground exactly as
 *  it was and a dark texel darkens whatever is underneath — sintered concrete,
 *  raw dirt, a road slab, a metal deck — with no per-surface tinting and no
 *  material to keep in step. That is the whole reason a scorch on a pad and a
 *  scorch on regolith both look right without either of them being authored.
 *
 *  THE TRAP, AND IT HAS SHIPPED IN THIS REPOSITORY MORE THAN ONCE. three only
 *  wires up MultiplyBlending's blend func on the PREMULTIPLIED path. Without
 *  `premultipliedAlpha: true` it silently falls back to normal blending and the
 *  decal draws as an OPAQUE WHITE SQUARE under the object. It warns once to the
 *  console, which nobody reads, and it is invisible in code review — the
 *  material still says `MultiplyBlending` at the top. Any texture whose alpha
 *  is a hard 255 is identical under premultiplied and straight alpha, so
 *  setting it costs nothing and not setting it is a picture bug.
 *
 *  THE SECOND TRAP. A decal coplanar with the ground z-fights, and a lift alone
 *  does not survive a long camera. Depth offset AND a lift, both.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * A soft radial shade, drawn on WHITE so its rim is a no-op under multiply.
 *
 * `stops` are `[offset, 'rgba(...)']` pairs handed straight to the gradient —
 * they ARE the mark and they have no default. A contact patch under a landing
 * gear, a pool of grime under a parked truck and the AO under a building are
 * different curves, and the difference is the only thing this function does not
 * know.
 */
export function radialShadeTexture(size: number, stops: Array<[number, string]>): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface MultiplyDecalOpts {
  /** Depth offset, in three's polygonOffset units. Negative pulls toward the eye. */
  offset: number;
  /** Whether the mark is graded with the rest of the frame. */
  toneMapped?: boolean;
  /** Anisotropy on the map, for a mark seen at a grazing angle. */
  anisotropy?: number;
}

/** The material, with both halves of the trap above nailed down. */
export function multiplyDecalMaterial(map: THREE.Texture, o: MultiplyDecalOpts): THREE.MeshBasicMaterial {
  if (o.anisotropy !== undefined) map.anisotropy = o.anisotropy;
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: o.offset,
    polygonOffsetUnits: o.offset,
    toneMapped: o.toneMapped ?? true,
  });
}

/**
 * A unit ground plane facing +Y, ready to be scaled to the mark's radius.
 *
 * `segments` 0 gives a quad; anything else gives a disc, which is what a round
 * mark on a plane wants — a quad's corners are three quarters of its fill rate
 * spent on texels that are white.
 */
export function groundDecalGeometry(segments: number): THREE.BufferGeometry {
  const g = segments > 0
    ? new THREE.CircleGeometry(1, segments)
    : new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
