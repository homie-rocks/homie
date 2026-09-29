/**
 * ============================================================================
 *  Ring — a square annulus with log-spaced radial rings, for the far field.
 * ============================================================================
 *
 *  What sits outside the chunked near mesh in every outdoor game: a skirt that
 *  runs from wherever the detailed grid stops out to the horizon, carrying the
 *  relief that makes a skyline instead of a flat cut-off. It is a square rather
 *  than a disc so its inner edge can meet a square grid, and log-spaced rather
 *  than uniform because THE VERTICES BELONG WHERE THE PIXELS ARE: from a 250 m
 *  eye the horizon is 29 km out and everything past 8 km projects into the top
 *  few scanlines, so uniform spacing spends most of its budget on the first
 *  kilometre where the near mesh already is.
 *
 *  ── TWO THINGS HERE WERE PAID FOR ONCE AND MUST NOT BE PAID FOR AGAIN ──────
 *
 *  WINDING IS ONE HANDEDNESS ALL THE WAY ROUND, AND THAT IS NOT A DETAIL. The
 *  perimeter parameter runs +X along the south edge, +Z along the east, -X
 *  along the north and -Z along the west, which is consistent, so ONE winding
 *  is correct everywhere. The obvious `(a,d,c)/(a,b,c)` puts every face normal
 *  DOWN: the entire far field is backface-culled and the horizon shows the near
 *  mesh's outer skirts standing against black like a picket fence. Verified by
 *  dotting each face normal against its own vertex normal — 30,000 of 30,000
 *  opposed.
 *
 *  THE DIAGONAL ALTERNATES, AND THAT IS THE VERTICAL-CURTAIN FIX. Splitting
 *  every quad the same way makes a vertex's neighbourhood LOPSIDED: it gets
 *  three faces from each side of the diagonal, the two sets are not mirror
 *  images, and on a slope the bias flips sign with vertex parity. On a square
 *  grid that error is a fraction of a degree and invisible. On these quads it
 *  is not — they are 2.3:1 — and on a 31 degree wall it rendered as a curtain
 *  of vertical light-and-dark bands at TWICE the perimeter spacing: measured at
 *  46 px where the spacing projects to 23 px, which is the parity signature and
 *  not a coincidence. Worse, it reads as gully streaking, i.e. as fluvial
 *  erosion, which is exactly wrong on any airless world. Checkerboarding makes
 *  the two parities mirror images so the bias cancels between neighbours. It
 *  costs nothing: same vertices, same triangle count, same draw call, and it
 *  cannot change the surface — only which way each quad creases.
 *
 *  ── WHY THIS RETURNS TYPED ARRAYS AND NOT A GEOMETRY ───────────────────────
 *
 *  The same line that keeps `skirtedGridIndex` here: no `three`, so a Node
 *  probe can build a far field and check its winding with no renderer. It also
 *  keeps the ATTRIBUTES the caller's. Heights, uvs and whatever a game packs
 *  into a vertex colour — permanent shadow, sky view, ray albedo — are all
 *  properties of one world, and a shared builder that invented them would be
 *  handing the next game this one's channels. The caller walks `xz` in the same
 *  order and fills its own.
 * ============================================================================
 */

/** Positions on the ground plane, and the index that stitches them. */
export interface RingFrame {
  /** Vertices, `(rings + 1) * perRing`. */
  count: number;
  /** Vertices per ring, `perSide * 4`. */
  perRing: number;
  /**
   * x, z pairs, ring by ring, innermost first. Length `count * 2`.
   *
   * FLOAT64, AND THAT IS NOT A DEFAULT — IT IS A MEASURED BUG FIXED.
   *
   * The caller's first job with these is to ask a height function what the
   * ground is at (x, z), and only then does the answer go into a Float32
   * position buffer. Handing out Float32 here rounds the coordinate BEFORE the
   * sample, so the far field is founded on a surface evaluated at slightly the
   * wrong place — measured on one game's title frame as 0.008% of channels
   * moving by up to 161, which is a visible edge somewhere in the picture.
   *
   * It was invisible to the first version of the parity check because BOTH
   * sides were compared after the Float32 store. The check now records what the
   * height function was ASKED, not what the buffer kept.
   */
  xz: Float64Array;
  /** Triangles, `rings * perRing * 6`, checkerboarded — see the header. */
  index: Uint32Array;
}

/**
 * @param r0      half-width of the innermost ring, where the near mesh ends.
 * @param r1      half-width of the outermost, i.e. the horizon.
 * @param rings   radial subdivisions. Log-spaced between r0 and r1.
 * @param perSide vertices along one edge of a ring.
 */
export function ringFrame(r0: number, r1: number, rings: number, perSide: number): RingFrame {
  const perRing = perSide * 4;
  const count = (rings + 1) * perRing;
  const xz = new Float64Array(count * 2);

  for (let ri = 0; ri <= rings; ri++) {
    const half = r0 * Math.pow(r1 / r0, ri / rings);
    for (let k = 0; k < perRing; k++) {
      // Parameter s in [0,4) walks the square: 0..1 south, 1..2 east, and so on.
      const s = k / perSide;
      const e = Math.floor(s) % 4, t = s - Math.floor(s);
      const a = -half + t * half * 2;
      const idx = (ri * perRing + k) * 2;
      if (e === 0) { xz[idx] = a; xz[idx + 1] = -half; }
      else if (e === 1) { xz[idx] = half; xz[idx + 1] = a; }
      else if (e === 2) { xz[idx] = -a; xz[idx + 1] = half; }
      else { xz[idx] = -half; xz[idx + 1] = -a; }
    }
  }

  const index = new Uint32Array(rings * perRing * 6);
  let o = 0;
  for (let ri = 0; ri < rings; ri++) {
    for (let k = 0; k < perRing; k++) {
      const k1 = (k + 1) % perRing;
      const a = ri * perRing + k, b = ri * perRing + k1;
      const c = (ri + 1) * perRing + k1, d = (ri + 1) * perRing + k;
      if (((ri + k) & 1) === 0) {
        index[o++] = a; index[o++] = c; index[o++] = d;
        index[o++] = a; index[o++] = b; index[o++] = c;
      } else {
        index[o++] = a; index[o++] = b; index[o++] = d;
        index[o++] = b; index[o++] = c; index[o++] = d;
      }
    }
  }

  return { count, perRing, xz, index };
}
