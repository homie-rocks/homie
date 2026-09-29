/**
 * ============================================================================
 *  Cloth — a rectangular sheet hung from one edge, as STATIC geometry.
 * ============================================================================
 *
 *  A banner, a tarpaulin, an awning skirt, a curtain, a flag on a spreader.
 *
 *  THERE IS NO SIMULATION HERE AND THERE IS NOT GOING TO BE. A hung sheet in a
 *  frame is a mesh with a shape, and the shape it has is the one it took when
 *  whatever was moving it stopped — including the creases from however it was
 *  folded before it was hung. Every consumer so far wants exactly that and a
 *  wind term added "for realism" would be wrong in at least one of them
 *  (vacuum has no wind), so the displacement is two CALLBACKS and the sheet is
 *  built once.
 *
 *  ── THE TWO CALLBACKS ARE NOT THE SAME AXIS AND THAT IS THE POINT ──────────
 *
 *   · `wave` is out of plane, in +Z. It is the crease field: what the cloth
 *     remembers. Growing it toward the free edge is what makes a sheet read as
 *     hung rather than as printed, because the hem is held and the far edge is
 *     not.
 *   · `sag` is extra drop, added to -Y. It is gravity plus a hem that was not
 *     pulled all the way through. A single displacement function cannot do
 *     both: fold the sag into the wave and the sheet ripples DOWNWARD, which
 *     is a curtain in a draught rather than a sheet with a droop.
 *
 *  UVs run u across the fly and v UP from the bottom, so a texture authored
 *  the way a picture is read maps on without a flip.
 *
 *  Normals are computed at the end. A hung sheet is DoubleSide in every
 *  consumer, so the winding below is the front face and the back is the
 *  material's problem.
 * ============================================================================
 */
import * as THREE from 'three';

export interface SheetOpts {
  /** Quads across the fly and down the hoist. */
  cols: number;
  rows: number;
  /** Width along +X, hung from y = 0 and dropping to -hoist. */
  fly: number;
  hoist: number;
  /** Out-of-plane displacement, +Z, at (u, v) in [0,1]². The creases. */
  wave(u: number, v: number): number;
  /** Extra drop below the plane at (u, v), added to -Y. Gravity and a slack hem. */
  sag(u: number, v: number): number;
}

export function hangingSheet(o: SheetOpts): THREE.BufferGeometry {
  const { cols, rows } = o;
  const verts = (cols + 1) * (rows + 1);
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      const k = (j * (cols + 1) + i) * 3;
      pos[k] = u * o.fly;
      pos[k + 1] = -v * o.hoist - o.sag(u, v);
      pos[k + 2] = o.wave(u, v);
      const t = (j * (cols + 1) + i) * 2;
      uv[t] = u;
      uv[t + 1] = 1 - v;
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      idx.push(a, a + 1, a + cols + 1);
      idx.push(a + 1, a + cols + 2, a + cols + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
