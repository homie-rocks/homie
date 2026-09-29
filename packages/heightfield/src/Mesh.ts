/**
 * ============================================================================
 *  Mesh.ts — the topology of a chunk of heightfield, with skirts.
 * ============================================================================
 *
 *  A chunked-LOD terrain draws the same square of ground at four vertex
 *  spacings and swaps between them with distance. Two things about that square
 *  are pure topology — they depend on nothing but `q`, the number of quads per
 *  side — and both of them are load-bearing enough that a game getting them
 *  wrong is visible at a glance. They are here so that the next terrain gets
 *  them right without knowing why.
 *
 *  VERTEX LAYOUT, and every consumer must agree with it:
 *
 *    posts        (q+1) * (q+1), row-major, index j*(q+1) + i
 *    skirt ring   4 * (q+1) after that, edge-major:
 *                   edge 0 south (j = 0)   edge 1 north (j = q)
 *                   edge 2 west  (i = 0)   edge 3 east  (i = q)
 *                 `skirtVertex(q, edge, k)` is the index; the caller copies
 *                 the matching post's XZ, drops Y, and inherits its normal and
 *                 UV so the sliver that shows through a crack shades like its
 *                 neighbour.
 *
 *  This module owns the INDEX. It deliberately does not own the vertex fill:
 *  what a terrain vertex carries beyond position — a sky-view byte, a wetness,
 *  a biome id — is the world's, and a package that decided it would have
 *  picked one game's material.
 * ============================================================================
 */

/** First index of the skirt ring, i.e. the number of surface posts. */
export const skirtBase = (q: number): number => (q + 1) * (q + 1);

/** Index of skirt vertex `k` on `edge`, 0..3 south/north/west/east. */
export const skirtVertex = (q: number, edge: number, k: number): number =>
  skirtBase(q) + edge * (q + 1) + k;

/** Total vertices in a skirted chunk: the posts plus the four edge rings. */
export const skirtedVertexCount = (q: number): number => skirtBase(q) + (q + 1) * 4;

/**
 * Triangle indices for one `q x q` chunk of heightfield plus its four skirts.
 *
 * ── THE DIAGONAL ALTERNATES, AND IT IS NOT A STYLE CHOICE ──────────────────
 *
 * CCW seen from above with +X right and +Z toward the viewer, both parities.
 *
 * Splitting every quad the same way makes the piecewise-linear surface fold the
 * SAME WAY in every cell, so the mesh carries a systematic corrugation at
 * exactly the vertex spacing running at exactly 45 degrees in XZ. Unlike a
 * texture artefact it cannot be filtered, mipped or LOD-biased away, because it
 * IS the geometry. Per-vertex normals hide it from the direct shading, which is
 * why it survived three iterations of one game; the SHADOW MAP does not, and
 * under an 11 degree key a fold that self-shadows every four metres is a comb
 * across the whole plain.
 *
 * Checkerboarding makes the two parities mirror images, so the fold cancels
 * between neighbours instead of accumulating a direction. Same vertices, same
 * triangle count, same draw call, same buffer size — it is free.
 *
 * One game then measured what the mesh alone is worth, on a grazing pose with
 * both detail maps forced flat so the only thing in frame is this
 * triangulation: second-difference RMS of luma along 0/45/90/135 read
 * 4.26 / 4.41 / 4.30 / 4.47, i.e. isotropic to five percent.
 *
 * ── THE SKIRTS ARE WOUND OUTWARD ───────────────────────────────────────────
 *
 * A skirt exists to fill the crack where a chunk at one LOD meets a chunk at
 * another. Wound the wrong way it is backface-culled, and a skirt you can see
 * through is not a crack fix, it is a hole with extra triangles.
 */
export function skirtedGridIndex(q: number): Uint32Array {
  const row = q + 1;
  const base = row * row;
  const tris = q * q * 2 + q * 8;           // surface + four skirt strips
  const idx = new Uint32Array(tris * 3);
  let o = 0;
  const push = (a: number, b: number, c: number) => { idx[o++] = a; idx[o++] = b; idx[o++] = c; };

  for (let j = 0; j < q; j++) {
    for (let i = 0; i < q; i++) {
      const v00 = j * row + i, v01 = (j + 1) * row + i;
      const v11 = (j + 1) * row + i + 1, v10 = j * row + i + 1;
      if (((i + j) & 1) === 0) {
        push(v00, v01, v11);
        push(v00, v11, v10);
      } else {
        push(v00, v01, v10);
        push(v01, v11, v10);
      }
    }
  }

  const sk = (edge: number, k: number) => base + edge * row + k;
  for (let i = 0; i < q; i++) {
    const a = i, b = a + 1;
    // south, j = 0, outward -Z
    push(a, b, sk(0, b)); push(a, sk(0, b), sk(0, a));
    // north, j = q, outward +Z
    const nb = q * row;
    push(nb + b, nb + a, sk(1, a)); push(nb + b, sk(1, a), sk(1, b));
    // west, i = 0, outward -X
    push(b * row, a * row, sk(2, a)); push(b * row, sk(2, a), sk(2, b));
    // east, i = q, outward +X
    push(a * row + q, b * row + q, sk(3, b)); push(a * row + q, sk(3, b), sk(3, a));
  }
  return idx;
}
