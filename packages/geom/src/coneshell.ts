/**
 * ============================================================================
 *  coneShell — an open shell of revolution whose radius follows a FLARE CURVE.
 * ============================================================================
 *  `THREE.ConeGeometry` walks the radius linearly and caps both ends. Nothing
 *  that actually expands into a volume does that: a jet, a spray, a wake, a
 *  searchlight through dust, a shock cone — all of them open hard in the first
 *  diameter and then roughly linearly, and the difference between the two is
 *  the difference between "a plume" and "a traffic cone".
 *
 *  So the radius is
 *
 *      r(t) = tan(halfAngle) · length · ( knee·t^power + (1-knee)·t )
 *
 *  and all three of `knee`, `power` and `halfAngle` are the caller's, because
 *  they are what the medium and the pressure ratio decide. `knee = 0`
 *  reproduces a straight cone exactly, which is the honest ablation arm.
 *
 *  THE NORMAL IS THE MERIDIAN TANGENT'S, taken by a finite difference of that
 *  same curve, and that is the half a hand-rolled cone always gets wrong. A
 *  shell built with the STRAIGHT cone's normal on a flared body is lit as if it
 *  were a different shape — brightest along the wrong ring — and nothing about
 *  the silhouette says so.
 *
 *  OPEN, and no caps. A shell like this is drawn additively or with a
 *  view-dependent falloff, and a cap is a flat disc of the same emission that
 *  reads as a lid the instant the camera gets near the axis.
 *
 *  Apex at the origin, opening down -Y, because everything that uses one is
 *  hung off something above it.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

export interface ConeShellOpts {
  /** half-angle at the apex, radians */
  halfAngle: number;
  /** axial length, metres */
  length: number;
  /** segments around */
  radial: number;
  /** segments along */
  axial: number;
  /** how much of the radius the early flare takes. 0 is a straight cone. */
  knee?: number;
  /** exponent of the early flare. Below 1 it opens hard and then eases. */
  power?: number;
}

export function coneShell(o: ConeShellOpts): THREE.BufferGeometry {
  const knee = o.knee ?? 0.34;
  const power = o.power ?? 0.36;
  const lin = 1 - knee;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const tanH = Math.tan(o.halfAngle);
  const rAt = (t: number) => tanH * o.length * (knee * Math.pow(t, power) + lin * t);
  for (let a = 0; a <= o.axial; a++) {
    const t = a / o.axial;
    const d = t * o.length;
    const r = rAt(t);
    // Surface tangent in the meridian plane, for a correct shell normal.
    const t2 = Math.min(1, t + 1e-3);
    const dr = (rAt(t2) - r) / Math.max(1e-4, (t2 - t) * o.length);
    for (let s = 0; s <= o.radial; s++) {
      const th = (s / o.radial) * Math.PI * 2;
      const c = Math.cos(th);
      const si = Math.sin(th);
      pos.push(r * c, -d, r * si);
      // n = normalise(c, dr, si) for a downward-opening cone.
      const inv = 1 / Math.hypot(1, dr);
      nrm.push(c * inv, dr * inv, si * inv);
      uvs.push(s / o.radial, t);
    }
  }
  const stride = o.radial + 1;
  for (let a = 0; a < o.axial; a++) {
    for (let s = 0; s < o.radial; s++) {
      const i0 = a * stride + s;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
