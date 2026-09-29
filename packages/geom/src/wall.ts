/**
 * ============================================================================
 *  A facade panel with real cut openings.
 * ============================================================================
 *  One function and the rectangle it takes. A window here is a hole through a
 *  wall with reveals you can see the thickness of, not a rectangle painted on a
 *  flat plane — which is what makes a building read as built at fifteen
 *  metres.
 *
 *  Byte-identical in the two racing games it was extracted from.
 */
import * as THREE from 'three';

// File-local, and deliberately NOT exported and NOT promoted to a shared
// `num.ts`. It is three characters of arithmetic with exactly ONE caller in
// this package; the games keep their own exported `clamp` beside their prop
// builders, which is where it is actually used a hundred times. A shared maths
// module here would be a second taxonomy over the first (every thing should
// have one obvious home) bought with one line of duplication — and a package
// that exports `clamp` is a package the next four games will wire themselves to
// for their maths, which is not what this one is for.
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export interface Opening {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A facade panel in local XY (outward face at z=0, wall thickness toward -z)
 * with real cut openings and real reveals — windows are recessed geometry, not
 * painted rectangles.
 */
export function wallWithOpenings(w: number, h: number, openings: Opening[], depth = 0.20, uvScale = 0.5): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const C: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c = 1) => {
    P.push(x, y, z);
    N.push(nx, ny, nz);
    U.push(u, v);
    C.push(c, c, c);
  };
  const quad = (pts: number[][], n: number[], uvs: number[][], cols?: number[]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) push(pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], cols ? cols[i] : 1);
  };
  // Occlusion baked into the reveal: a 22 cm recess only reads at 40 m if the
  // returns are visibly darker than the face. Head darkest, then the jambs,
  // with the sill catching the low sun.
  const AO_FACE = 1.0;
  const AO_JAMB_LIP = 0.78;
  const AO_JAMB_BACK = 0.34;
  const AO_HEAD_LIP = 0.55;
  const AO_HEAD_BACK = 0.20;
  const AO_SILL_LIP = 0.98;
  const AO_SILL_BACK = 0.62;
  // Grid lines from every opening edge, so the front face tessellates into
  // cells that are either fully solid or fully hole.
  const xs = new Set<number>([0, w]);
  const ys = new Set<number>([0, h]);
  for (const o of openings) {
    xs.add(clamp(o.x, 0, w));
    xs.add(clamp(o.x + o.w, 0, w));
    ys.add(clamp(o.y, 0, h));
    ys.add(clamp(o.y + o.h, 0, h));
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      const x0 = X[i],
        x1 = X[i + 1],
        y0 = Y[j],
        y1 = Y[j + 1];
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      if (openings.some((o) => cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h)) continue;
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) continue;
      quad(
        [
          [x0, y0, 0],
          [x1, y0, 0],
          [x1, y1, 0],
          [x0, y1, 0],
        ],
        [0, 0, 1],
        [
          [x0 * uvScale, y0 * uvScale],
          [x1 * uvScale, y0 * uvScale],
          [x1 * uvScale, y1 * uvScale],
          [x0 * uvScale, y1 * uvScale],
        ]
      );
    }
  }
  // Reveals: four inward-facing strips per opening.
  for (const o of openings) {
    const x0 = o.x,
      x1 = o.x + o.w,
      y0 = o.y,
      y1 = o.y + o.h,
      z = -depth;
    // left (+x normal), right (-x), bottom/sill (+y), head (-y)
    quad(
      [
        [x0, y0, 0],
        [x0, y0, z],
        [x0, y1, z],
        [x0, y1, 0],
      ],
      [1, 0, 0],
      [
        [y0 * uvScale, 0],
        [y0 * uvScale, depth * uvScale],
        [y1 * uvScale, depth * uvScale],
        [y1 * uvScale, 0],
      ],
      [AO_JAMB_LIP, AO_JAMB_BACK, AO_JAMB_BACK * 0.75, AO_JAMB_LIP * 0.8]
    );
    quad(
      [
        [x1, y1, 0],
        [x1, y1, z],
        [x1, y0, z],
        [x1, y0, 0],
      ],
      [-1, 0, 0],
      [
        [y1 * uvScale, 0],
        [y1 * uvScale, depth * uvScale],
        [y0 * uvScale, depth * uvScale],
        [y0 * uvScale, 0],
      ],
      [AO_JAMB_LIP * 0.8, AO_JAMB_BACK * 0.75, AO_JAMB_BACK, AO_JAMB_LIP]
    );
    quad(
      [
        [x1, y0, 0],
        [x1, y0, z],
        [x0, y0, z],
        [x0, y0, 0],
      ],
      [0, 1, 0],
      [
        [x1 * uvScale, 0],
        [x1 * uvScale, depth * uvScale],
        [x0 * uvScale, depth * uvScale],
        [x0 * uvScale, 0],
      ],
      [AO_SILL_LIP, AO_SILL_BACK, AO_SILL_BACK, AO_SILL_LIP]
    );
    quad(
      [
        [x0, y1, 0],
        [x0, y1, z],
        [x1, y1, z],
        [x1, y1, 0],
      ],
      [0, -1, 0],
      [
        [x0 * uvScale, 0],
        [x0 * uvScale, depth * uvScale],
        [x1 * uvScale, depth * uvScale],
        [x1 * uvScale, 0],
      ],
      [AO_HEAD_LIP, AO_HEAD_BACK, AO_HEAD_BACK, AO_HEAD_LIP]
    );
  }
  void AO_FACE;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
