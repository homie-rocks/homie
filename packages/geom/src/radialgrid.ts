/**
 * ============================================================================
 *  radialGrid — a disc of quads, dense at the centre and coarse at the rim.
 * ============================================================================
 *
 *  The mesh anything that follows the camera and reaches the horizon is drawn
 *  on: an ocean, a fog plane, a dust sheet, a ground fade. It is not a
 *  `CircleGeometry` and the difference is the whole point — a regular disc
 *  spends its vertices uniformly by AREA, so almost all of them land far away
 *  where nothing is resolvable, and the fifty metres in front of the camera
 *  get four rings.
 *
 *  ── THE RADIUS RAMP IS THE CALLER'S, AND IT IS A CALLBACK ON PURPOSE ───────
 *
 *  How fast the rings spread is a decision about what is being drawn — a sea
 *  wants a hard cubic so the wave detail is all underfoot, a fog plane wants
 *  something much flatter — and it is also the one place a "tidy" rewrite
 *  changes the geometry. `radius * t * t * t` and `radius * Math.pow(t, 3)`
 *  are not the same double for every `t`, so an `exponent: number` parameter
 *  would move a vertex buffer while looking like a refactor. The caller writes
 *  the expression it already had and hands it over.
 *
 *  ── THE WINDING IS ABOVE-ONLY, AND SAYING SO IS PART OF THE CONTRACT ───────
 *
 *  Counter-clockwise seen from ABOVE, so the surface is single-sided and faces
 *  up. Anything meant to be seen from below wants the other winding and should
 *  not quietly reuse this.
 *
 *  No UVs and no normals. Every consumer of this shape so far computes both in
 *  the vertex shader from world position — which is the reason the grid can
 *  chase the camera without the surface swimming — and an unused attribute is
 *  three floats per vertex uploaded for nothing.
 *
 *  The bounding sphere is set explicitly at 1.2x, because the vertex shader
 *  displaces and three's computed sphere would cull a surface that is on
 *  screen.
 * ============================================================================
 */
import * as THREE from 'three';

/**
 * @param radiusAt maps a ring's normalised index `t` in [0, 1] to its radius
 *                 in metres. Called `rings + 1` times, at build.
 * @param bound    radius of the bounding sphere; default 1.2x `radiusAt(1)`.
 */
export function radialGrid(
  segs: number, rings: number, radiusAt: (t: number) => number, bound?: number,
): THREE.BufferGeometry {
  const pos = new Float32Array((rings + 1) * (segs + 1) * 3);
  const idx: number[] = [];
  let p = 0;
  for (let j = 0; j <= rings; j++) {
    const r = radiusAt(j / rings);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos[p++] = Math.cos(a) * r;
      pos[p++] = 0;
      pos[p++] = Math.sin(a) * r;
    }
  }
  const stride = segs + 1;
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      // Wound counter-clockwise seen from ABOVE — see the header.
      const a = j * stride + i;
      idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), bound ?? radiusAt(1) * 1.2);
  return g;
}
