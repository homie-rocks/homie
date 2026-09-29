/**
 * ============================================================================
 *  finplate — a swept, tapered, closed plate. A wing, a fin, a flap, a rudder,
 *  a spoiler, a keel.
 * ============================================================================
 *
 *  WHY THIS IS NOT AN EXTRUSION, and it is the whole reason the file exists:
 *  `THREE.ExtrudeGeometry` gives one thickness for the whole profile, and a
 *  constant-thickness control surface reads as CARDBOARD in silhouette. The
 *  silhouette is the only thing most frames show of a fin. Here the thickness
 *  is a function of the spanwise fraction, so a plate can be 1.2 m at the root
 *  and 0.46 m at the tip and still be one closed shell.
 *
 *  ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *  Two skins, one at +Z and one at -Z, sampled on the same (span, chord)
 *  lattice, plus four closures: leading edge, trailing edge, tip and root. The
 *  skins are pulled IN toward the mid-plane near the leading and trailing
 *  edges, which is what turns a slab into something with an arris: `edge.floor`
 *  is how much half-thickness survives at the very edge and `edge.over` is how
 *  far in, as a fraction of the chord, full thickness is reached.
 *
 *  ── THE WINDING, AND IT IS THE TRAP ────────────────────────────────────────
 *
 *  Rows advance +Y (span) and columns advance +X (chord), so for the +Z skin
 *  the outward-facing order is (v, v+1, v+stride) and for the -Z skin it is the
 *  reverse. Getting this backwards produces no error, no warning and no
 *  visibly broken mesh: under the default FrontSide culling the plate simply
 *  STOPS EXISTING and you look straight through it, while anything mounted on
 *  its face keeps drawing and reads as a wire screen. Every closure below is
 *  wound to match, checked by cross product rather than by eye, because "it
 *  looks solid from here" is exactly the trap.
 *
 *  ── WHAT IS MECHANISM AND WHAT IS NOT ──────────────────────────────────────
 *
 *  MECHANISM: the two skins, the four closures, the winding, the lattice.
 *  CONTENT: `chord`, `halfThick`, `uv` and `attr`. The planform IS the aircraft
 *  and there is no default for it here.
 *
 *  `computeVertexNormals` runs at the end and the flat per-skin normals pushed
 *  during the build are thrown away by it. They are pushed anyway, because the
 *  attribute has to exist before the closures reference the same buffer and
 *  because a caller that drops the recompute gets a usable plate rather than a
 *  black one.
 * ============================================================================
 */
import * as THREE from 'three';

export interface FinAttr {
  name: string;
  size: number;
  /** Push `size` numbers, for the vertex at spanwise fraction `s`, chord sample `i`, skin `faceSign`. */
  write(out: number[], s: number, i: number, faceSign: number): void;
}

export interface FinOpts {
  /** Spanwise and chordwise quad counts. */
  spans: number;
  chords: number;
  /** Overall span, in the plate's +Y. */
  span: number;
  /** Chord extent at spanwise fraction `s`, in the plate's +X. c0 < c1. */
  chord(s: number): { c0: number; c1: number };
  /** Half-thickness at spanwise fraction `s`. */
  halfThick(s: number): number;
  /**
   * The arris. `floor` is the fraction of half-thickness surviving at the very
   * leading and trailing edges; `over` is the chord fraction across which full
   * thickness is reached.
   */
  edge: { floor: number; over: number };
  /** Push u then v for the vertex at plate-frame (x, y). */
  uv(out: number[], x: number, y: number): void;
  attr?: FinAttr;
}

export function finPlate(o: FinOpts): THREE.BufferGeometry {
  const { spans, chords } = o;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const extra: number[] = [];
  const idx: number[] = [];

  /** One vertex ring across the chord, on one skin. Returns its first index. */
  const ring = (s: number, faceSign: number) => {
    const first = pos.length / 3;
    const { c0, c1 } = o.chord(s);
    const th = o.halfThick(s);
    for (let i = 0; i <= chords; i++) {
      const u = i / chords;
      const x = THREE.MathUtils.lerp(c0, c1, u);
      const edge = Math.min(u, 1 - u);
      const k = Math.min(1, edge / o.edge.over);
      const z = th * faceSign * (o.edge.floor + (1 - o.edge.floor) * k);
      pos.push(x, s * o.span, z);
      nrm.push(0, 0, faceSign);
      o.uv(uv, x, s * o.span);
      if (o.attr) o.attr.write(extra, s, i, faceSign);
    }
    return first;
  };

  const rowsA: number[] = [];
  const rowsB: number[] = [];
  for (let j = 0; j <= spans; j++) {
    const s = j / spans;
    rowsA.push(ring(s, 1));
    rowsB.push(ring(s, -1));
  }

  const stride = chords + 1;
  for (let j = 0; j < spans; j++) {
    for (let i = 0; i < chords; i++) {
      const a = rowsA[j]! + i;
      idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      const b = rowsB[j]! + i;
      idx.push(b, b + stride, b + 1, b + 1, b + stride, b + stride + 1);
    }
    // Leading edge (low X, outward -X) and trailing edge (high X, outward +X).
    idx.push(rowsA[j]!, rowsA[j + 1]!, rowsB[j]!, rowsB[j]!, rowsA[j + 1]!, rowsB[j + 1]!);
    idx.push(rowsA[j]! + chords, rowsB[j]! + chords, rowsA[j + 1]! + chords,
      rowsB[j]! + chords, rowsB[j + 1]! + chords, rowsA[j + 1]! + chords);
  }
  // Tip closure, outward +Y.
  for (let i = 0; i < chords; i++) {
    const a = rowsA[spans]! + i;
    const b = rowsB[spans]! + i;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // Root closure, outward -Y.
  for (let i = 0; i < chords; i++) {
    const a = rowsA[0]! + i;
    const b = rowsB[0]! + i;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.attr) g.setAttribute(o.attr.name, new THREE.Float32BufferAttribute(extra, o.attr.size));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
