/**
 * ============================================================================
 *  bell — a flared shell of revolution with real CORRUGATION in the profile.
 * ============================================================================
 *  A nozzle, a horn, a trumpet, a cooling stack, a ventilator cowl. All of them
 *  are the same solid of revolution and all of them are ribbed, fluted or
 *  channelled, and the ribbing is not decoration: it is what makes the form
 *  read as a manufactured assembly instead of as a cone.
 *
 *  IT IS IN THE GEOMETRY AND NOT IN A NORMAL MAP, and that is the whole
 *  argument for the function existing. The corrugation has to BREAK THE
 *  SILHOUETTE — the outline is where the eye reads a rib count — and a normal
 *  map cannot touch a silhouette at any resolution. The cost is `radial`
 *  segments instead of eight, on one object.
 *
 *  THE CONTOUR IS `r = throat + (exit - throat) · t^power`. A `power` below 1
 *  expands fast out of the throat and then approaches the exit plane along a
 *  long, nearly-parallel tail, which is what a real expansion contour does;
 *  `power = 1` is a plain truncated cone and is the honest ablation arm.
 *
 *  THE CORRUGATION FADES OUT toward the exit, because the last part of a
 *  channelled bell is a plain hoop over the channel ends — and the amplitude
 *  never reaches zero, because a rib that vanishes exactly at the lip leaves a
 *  visible pinch. Both the fade exponent and the residual are arguments.
 *
 *  THE EXIT HOOP is the stiffening band every one of these carries and it is
 *  the last feature anybody sees on one, so it is here rather than left to a
 *  caller to remember.
 *
 *  `computeVertexNormals()` at the end, deliberately: the per-vertex normals
 *  written in the loop are the CYLINDRICAL ones, which are wrong for both the
 *  flare and the corrugation, and recomputing from the triangles is what makes
 *  the ribs catch light. They are written anyway so the attribute exists at the
 *  right size before the recompute allocates.
 *
 *  Throat at the origin, opening down -Y.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

export interface BellOpts {
  /** radius at the exit plane */
  exitR: number;
  /** throat radius as a FRACTION of the exit radius */
  throat: number;
  /** axial length, throat to exit */
  length: number;
  /** number of ribs around */
  channels: number;
  /** segments around. Must resolve `channels`; below 4x them the ribs alias. */
  radial: number;
  /** segments along */
  axial?: number;
  /** contour exponent. Below 1 expands fast then flattens; 1 is a cone. */
  power?: number;
  /** rib amplitude at the throat, as a fraction of the exit radius */
  ribAmp?: number;
  /** rib amplitude that survives at the exit, same units. Never 0. */
  ribFloor?: number;
  /** how fast the ribs fade toward the exit */
  ribFade?: number;
  /** exit hoop radius, as a multiple of the exit radius. 1 disables it. */
  hoop?: number;
}

export function bellGeo(o: BellOpts): THREE.BufferGeometry {
  const AX = o.axial ?? 22;
  const power = o.power ?? 0.56;
  const ribAmp = o.ribAmp ?? 0.014;
  const ribFloor = o.ribFloor ?? 0.004;
  const ribFade = o.ribFade ?? 2.4;
  const hoop = o.hoop ?? 1.035;
  const throatR = o.exitR * o.throat;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (let a = 0; a <= AX; a++) {
    const t = a / AX;
    const base = throatR + (o.exitR - throatR) * Math.pow(t, power);
    const y = -t * o.length;
    const chanAmp = o.exitR * ribAmp * (1 - Math.pow(t, ribFade)) + o.exitR * ribFloor;
    for (let s = 0; s <= o.radial; s++) {
      const th = (s / o.radial) * Math.PI * 2;
      const r = base + Math.cos(th * o.channels) * chanAmp;
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
      nrm.push(Math.cos(th), 0, Math.sin(th));
      uv.push(s / o.radial, t);
    }
  }
  const stride = o.radial + 1;
  for (let a = 0; a < AX; a++) {
    for (let s = 0; s < o.radial; s++) {
      const i0 = a * stride + s;
      idx.push(i0, i0 + 1, i0 + stride, i0 + 1, i0 + stride + 1, i0 + stride);
    }
  }
  const hoopStart = pos.length / 3;
  for (let s = 0; s <= o.radial; s++) {
    const th = (s / o.radial) * Math.PI * 2;
    pos.push(Math.cos(th) * o.exitR * hoop, -o.length, Math.sin(th) * o.exitR * hoop);
    nrm.push(Math.cos(th), 0, Math.sin(th));
    uv.push(s / o.radial, 1);
  }
  for (let s = 0; s < o.radial; s++) {
    const a = AX * stride + s;
    const b = hoopStart + s;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
