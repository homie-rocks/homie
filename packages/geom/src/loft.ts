/**
 * ============================================================================
 *  Loft a closed cross-section along a path.
 * ============================================================================
 *  The one primitive that is a function of two functions: where the path goes,
 *  and how wide it is when it gets there. A palm trunk, a boat hull, a mooring
 *  rope and a harbour tower are all this, called with different arguments —
 *  and that is the whole reason it is here and they are not.
 *
 *  Byte-identical in the two racing games it was extracted from; the docblock
 *  still names the four objects it was written for, because a comment that
 *  says what a thing was actually used for is worth more than one that has
 *  been generalised until it says nothing.
 */
import * as THREE from 'three';

/**
 * Lofts a closed cross-section along a path. Used for palm trunks, boat hulls,
 * mooring ropes and a harbour tower. `radius(t, i)` lets a cross-section breathe
 * along the run so nothing is a plain cylinder.
 */
export function loft(
  path: (t: number, out: THREE.Vector3) => void,
  rings: number,
  sides: number,
  radius: (t: number, ang: number) => number,
  uvRepeat = 1,
  capStart = false,
  capEnd = false
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3(),
    pPrev = new THREE.Vector3(),
    tan = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const nrmA = new THREE.Vector3(),
    nrmB = new THREE.Vector3();
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    path(t, p);
    path(Math.min(1, t + 1e-3), pPrev);
    tan.subVectors(pPrev, p);
    if (tan.lengthSq() < 1e-9) {
      path(Math.max(0, t - 1e-3), pPrev);
      tan.subVectors(p, pPrev);
    }
    tan.normalize();
    nrmA.copy(Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).cross(tan).normalize();
    nrmB.crossVectors(tan, nrmA).normalize();
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const rr = radius(t, a);
      pos.push(p.x + (nrmA.x * Math.cos(a) + nrmB.x * Math.sin(a)) * rr, p.y + (nrmA.y * Math.cos(a) + nrmB.y * Math.sin(a)) * rr, p.z + (nrmA.z * Math.cos(a) + nrmB.z * Math.sin(a)) * rr);
      uv.push((s / sides) * uvRepeat, t * uvRepeat);
    }
  }
  const stride = sides + 1;
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      // Wound so the surface normal points away from the path — otherwise
      // every trunk, hull and tower in the game renders inside-out.
      const a = r * stride + s,
        b = a + stride;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const capOf = (ring: number, flip: boolean) => {
    const base = pos.length / 3;
    path(ring === 0 ? 0 : 1, p);
    pos.push(p.x, p.y, p.z);
    uv.push(0.5, 0.5);
    const off = ring * stride;
    for (let s = 0; s < sides; s++) {
      const a = off + s,
        b = off + s + 1;
      if (flip) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  };
  if (capStart) capOf(0, true);
  if (capEnd) capOf(rings, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
