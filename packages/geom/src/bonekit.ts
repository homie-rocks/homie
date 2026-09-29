/**
 * ============================================================================
 *  bonekit — a RIGGED greeble kit. Chamfered boxes and bevelled barrels
 *  accumulated into one non-indexed soup with a bone id and a
 *  rough/metal/emissive triple on every vertex.
 * ============================================================================
 *  Extracted from a base-building game's robot figure. It knows a width, a
 *  chamfer, a bone index and a triangle. It does not know what a robot is.
 *
 *  ── WHY IT IS A THIRD BOX IN THIS PACKAGE AND NOT A FOURTH CALLER OF ONE ────
 *  `prim.ts::bevelBox` and `chamfer.ts::chamferBox` both build this topology —
 *  6 face quads, 12 edge quads, 8 corner triangles — and chamfer.ts already
 *  carries the paragraph saying why those two cannot merge. This is the third,
 *  and it differs from BOTH on two axes that are not settings:
 *
 *    · IT EMITS INTO A SINK, NOT A GEOMETRY. A figure is a few hundred parts in
 *      one draw call, so every part appends into one shared soup and the
 *      geometry is built once at the end. `chamferBox` returns a
 *      `BufferGeometry` per call and an accumulator merges them; that is the
 *      right shape for a building and the wrong one for a skeleton.
 *    · IT SHADES THE CHAMFER AS A ROUNDED EDGE. `chamfer.ts`'s corner facets
 *      carry ONE FLAT normal; here every chamfer vertex carries the normal of
 *      the FACE it came from, so the normal sweeps continuously through 90° and
 *      the sun leaves a bright line down the edge instead of a third flat tone
 *      step. That was measured: a review read the figure as having hard 90°
 *      edges while the chamfer strips were six screen pixels wide and
 *      present. Widening them does not fix it; smoothing them does.
 *
 *  And it carries two channels neither of the others has: `aBone`, a float
 *  vertex attribute a vertex shader poses from, and `aMat` = (rough, metal,
 *  emis), which is how one InstancedMesh shows polymer, machined joint, black
 *  tile and an emissive strip in a single draw call.
 *
 *  Collapsing any two of the three COMPILES and MOVES VERTICES in three games
 *  at once, so they stay apart.
 *
 *  ── WHAT IS THE CALLER'S ───────────────────────────────────────────────────
 *  Every colour, every dimension, every chamfer radius, every bone id, the bone
 *  NUMBERING, and `boundsPad`. That last one is a number and therefore a trap:
 *  a rig posed in the vertex shader has authored bounds wrong by up to a limb
 *  length, and how much slack that needs depends on the rig, so it is a
 *  required argument rather than a default somebody inherits.
 * ============================================================================
 */
import * as THREE from 'three';

const _col = new THREE.Color();

// ─────────────────────────────────────────────────────────────────────────────
// Chamfered box. An unchamfered 90 degree edge catches no specular at all, and
// under a light source as small as a distant sun that is fatal, not cosmetic.
// Every panel on the robot is chamfered.
//
// 24 points: for each of the 8 corners, three points with one axis at full
// extent and the other two pulled in by `c`. 6 face quads + 12 edge quads +
// 8 corner triangles = 44 triangles.
// ─────────────────────────────────────────────────────────────────────────────
export interface BoneSink {
  pos: number[]; nrm: number[]; col: number[]; bone: number[]; mat: number[];
}

const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3();
const _n0 = new THREE.Vector3(), _ea = new THREE.Vector3(), _eb = new THREE.Vector3();

function pushTri(
  sink: BoneSink, a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3,
  n: THREE.Vector3, col: THREE.Color, bone: number, rough: number, metal: number, emis: number,
) {
  // Winding is derived, not assumed: compute the geometric normal and flip the
  // triangle if it disagrees with the intended one. Cheaper than getting 44
  // hand-written windings right, and it cannot silently produce a black facet.
  _ea.subVectors(b, a); _eb.subVectors(cc, a); _n0.crossVectors(_ea, _eb);
  const flip = _n0.dot(n) < 0;
  const order = flip ? [a, cc, b] : [a, b, cc];
  for (const p of order) {
    sink.pos.push(p.x, p.y, p.z);
    sink.nrm.push(n.x, n.y, n.z);
    sink.col.push(col.r, col.g, col.b);
    sink.bone.push(bone);
    sink.mat.push(rough, metal, emis);
  }
}

function pushQuad(
  sink: BoneSink, a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3,
  n: THREE.Vector3, col: THREE.Color, bone: number, rough: number, metal: number, emis: number,
) {
  pushTri(sink, a, b, cc, n, col, bone, rough, metal, emis);
  pushTri(sink, a, cc, d, n, col, bone, rough, metal, emis);
}

/**
 * ── THE SMOOTHED CHAMFER, AND WHY A FLAT ONE WAS STILL AN AMATEUR TELL ───────
 *
 * The rule is "every edge chamfered 8-25 mm. A hard 90 degree edge catches no
 * specular and under a small angular light source it is fatal." Every part in
 * this kit was already chamfered, and a review still read the robot as having
 * hard 90 degree edges. A 3x crop of a capture on the chest says why, and it
 * is not the width: the chamfer strip is there, 6 screen pixels of it, and it
 * is FLAT-SHADED. One quad with one normal at 45 degrees between its two faces
 * takes exactly one lighting value, so a chamfer renders as a third tone step
 * beside two others — a bevelled box, not a rounded edge — and its specular
 * lobe is either entirely on or entirely off across the whole strip. That is
 * the read a viewer has, and no extra width fixes it.
 *
 * What a real 22 mm radius does is sweep the normal continuously through 90
 * degrees, so somewhere along it the half-vector lines up and a BRIGHT LINE runs
 * down the edge. That is worth having and it costs nothing: the same 24 points
 * and the same 44 triangles, with the chamfer strips and corner facets carrying
 * the two (or three) FACE normals at their own vertices instead of one averaged
 * normal at all of them. The silhouette is unchanged; only the shading normal
 * moves, which is the standard way a bevel is shaded and is exactly what the
 * curvature edge-wear mask below is already written to detect.
 */
function pushTriN(
  sink: BoneSink, a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3,
  na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3,
  col: THREE.Color, bone: number, rough: number, metal: number, emis: number,
) {
  _ea.subVectors(b, a); _eb.subVectors(cc, a); _n0.crossVectors(_ea, _eb);
  // The intended orientation is the average of the three vertex normals — on a
  // chamfer facet that is the old flat normal, so the winding rule is unchanged.
  _tmpW.copy(na).add(nb).add(nc);
  const flip = _n0.dot(_tmpW) < 0;
  const P = flip ? [a, cc, b] : [a, b, cc];
  const N = flip ? [na, nc, nb] : [na, nb, nc];
  for (let i = 0; i < 3; i++) {
    sink.pos.push(P[i].x, P[i].y, P[i].z);
    sink.nrm.push(N[i].x, N[i].y, N[i].z);
    sink.col.push(col.r, col.g, col.b);
    sink.bone.push(bone);
    sink.mat.push(rough, metal, emis);
  }
}

function pushQuadN(
  sink: BoneSink, a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3,
  na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, nd: THREE.Vector3,
  col: THREE.Color, bone: number, rough: number, metal: number, emis: number,
) {
  pushTriN(sink, a, b, cc, na, nb, nc, col, bone, rough, metal, emis);
  pushTriN(sink, a, cc, d, na, nc, nd, col, bone, rough, metal, emis);
}

/**
 * One authored box. Sizes are full extents, metres.
 *
 * This is a whole greeble kit: a robot, a rover chassis and vehicle detail are
 * all lists of these. `rough`/`metal`/`emis` ride along as a per-vertex
 * attribute so one InstancedMesh can show polymer, dark machined joint, black
 * tile and a cyan emissive strip in a single draw call — which is how five
 * distinct surface responses fit inside a 300-draw-call budget.
 */
export interface BonePart {
  b: number;                       // bone id — 0 for anything not a robot
  x: number; y: number; z: number; // centre, model space
  w: number; h: number; d: number;
  col: number;
  rough?: number; metal?: number; emis?: number;
  ch?: number;                     // chamfer, metres. 0 = plain box (far LODs)
  rx?: number;                     // pitch about the part's own centre
  rz?: number;                     // roll — cyl + rz=π/2 is a Y-up barrel
                                   // (head), because cyl is about local X
  /**
   * Radial segments. When set, this part is a CYLINDER about the local X axis
   * (radius from h/d, length from w) with `ch` bevelling the end caps, rather
   * than a box. A propellant tank cannot be a chamfered box: the chamfer has
   * to reach half the diameter to look round, and a box that chamfered is a
   * diamond — which is exactly how the first capture of the tank rack looked.
   */
  cyl?: number;
}


const _ptA = new THREE.Vector3(), _ptB = new THREE.Vector3(), _ptC = new THREE.Vector3();
const _tmpN = new THREE.Vector3();
// Face normals for the smoothed chamfer, one per dominant axis, plus a scratch
// for the winding test. Module scope: `emitPart` runs a few thousand times.
const _nX = new THREE.Vector3(), _nY = new THREE.Vector3(), _nZ = new THREE.Vector3();
const _tmpW = new THREE.Vector3();

export function emitBonePart(sink: BoneSink, p: BonePart) {
  const hx = p.w * 0.5, hy = p.h * 0.5, hz = p.d * 0.5;
  // Chamfer is clamped PER AXIS, not against the smallest dimension. Clamping
  // against the smallest collapses the chamfer on anything thin — a wheel
  // 0.30 m wide and 0.92 m across came out as a box with a 12 mm bevel
  // instead of a rounded disc, and it read as a box.
  const req = Math.max(0, p.ch ?? 0);
  const cx = Math.min(req, hx * 0.999);
  const cy = Math.min(req, hy * 0.999);
  const cz = Math.min(req, hz * 0.999);
  const c = req;
  const rough = p.rough ?? 0.55, metal = p.metal ?? 0.05, emis = p.emis ?? 0;
  _col.setHex(p.col, THREE.SRGBColorSpace);
  const rx = p.rx ?? 0;
  const rz = p.rz ?? 0;
  const cs = Math.cos(rx), sn = Math.sin(rx);
  const czr = Math.cos(rz), szr = Math.sin(rz);

  // local -> model: rz then rx, so cyl (about local X) + rz=π/2
  // stands a barrel on Y — a round cranium from the 10 m ¾.
  const put = (out: THREE.Vector3, x: number, y: number, z: number) => {
    const x1 = x * czr - y * szr, y1 = x * szr + y * czr;
    const yy = y1 * cs - z * sn, zz = y1 * sn + z * cs;
    return out.set(p.x + x1, p.y + yy, p.z + zz);
  };
  const dir = (out: THREE.Vector3, x: number, y: number, z: number) => {
    const x1 = x * czr - y * szr, y1 = x * szr + y * czr;
    const yy = y1 * cs - z * sn, zz = y1 * sn + z * cs;
    return out.set(x1, yy, zz).normalize();
  };

  // A(i,j,k): X-dominant, B: Y-dominant, C: Z-dominant
  const A = (o: THREE.Vector3, i: number, j: number, k: number) => put(o, i * hx, j * (hy - cy), k * (hz - cz));
  const B = (o: THREE.Vector3, i: number, j: number, k: number) => put(o, i * (hx - cx), j * hy, k * (hz - cz));
  const C = (o: THREE.Vector3, i: number, j: number, k: number) => put(o, i * (hx - cx), j * (hy - cy), k * hz);

  const q = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3) =>
    pushQuad(sink, a, b, cc, d, n, _col, p.b, rough, metal, emis);

  if (p.cyl && p.cyl >= 3) {
    const N = p.cyl | 0;
    const r = Math.min(hy, hz);
    const cc2 = Math.min(req, Math.min(hx * 0.49, r * 0.7));
    const ring = (o: THREE.Vector3, ang: number, xx: number, rr: number) =>
      put(o, xx, Math.sin(ang) * rr, Math.cos(ang) * rr);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      // The barrel takes the TRUE radial normal at each of its two edges rather
      // than one facet normal at the mid-angle. A 10-segment joint barrel is a
      // 36-degree facet, and flat-shaded it reads as a decagonal nut on every
      // hip, knee, elbow and shoulder on the figure — the machined joints are
      // the second most-looked-at surface on the robot after the chest.
      dir(_nY, 0, Math.sin(a0), Math.cos(a0));
      dir(_nZ, 0, Math.sin(a1), Math.cos(a1));
      pushQuadN(sink, ring(_p0, a0, -(hx - cc2), r), ring(_p1, a1, -(hx - cc2), r),
        ring(_p2, a1, hx - cc2, r), ring(_p3, a0, hx - cc2, r),
        _nY, _nZ, _nZ, _nY, _col, p.b, rough, metal, emis);
      if (cc2 > 0) {
        for (const s of [-1, 1]) {
          // Bevelled shoulder, then the flat cap ring. The bevel is smoothed
          // into the barrel on its inboard edge for the same reason.
          dir(_nY, 0, Math.sin(a0), Math.cos(a0));
          dir(_nZ, 0, Math.sin(a1), Math.cos(a1));
          dir(_nX, s * 0.7, Math.sin(am) * 0.7, Math.cos(am) * 0.7);
          pushQuadN(sink, ring(_p0, a0, s * (hx - cc2), r), ring(_p1, a1, s * (hx - cc2), r),
            ring(_p2, a1, s * hx, r - cc2), ring(_p3, a0, s * hx, r - cc2),
            _nY, _nZ, _nX, _nX, _col, p.b, rough, metal, emis);
          dir(_tmpN, s, 0, 0);
          pushTri(sink, ring(_ptA, a0, s * hx, r - cc2), ring(_ptB, a1, s * hx, r - cc2),
            put(_ptC, s * hx, 0, 0), _tmpN, _col, p.b, rough, metal, emis);
        }
      } else {
        for (const s of [-1, 1]) {
          dir(_tmpN, s, 0, 0);
          pushTri(sink, ring(_ptA, a0, s * hx, r), ring(_ptB, a1, s * hx, r),
            put(_ptC, s * hx, 0, 0), _tmpN, _col, p.b, rough, metal, emis);
        }
      }
    }
    return;
  }

  for (const i of [-1, 1]) {   // +-X faces
    q(A(_p0, i, -1, -1), A(_p1, i, 1, -1), A(_p2, i, 1, 1), A(_p3, i, -1, 1), dir(_tmpN, i, 0, 0));
  }
  for (const j of [-1, 1]) {   // +-Y faces
    q(B(_p0, -1, j, -1), B(_p1, 1, j, -1), B(_p2, 1, j, 1), B(_p3, -1, j, 1), dir(_tmpN, 0, j, 0));
  }
  for (const k of [-1, 1]) {   // +-Z faces
    q(C(_p0, -1, -1, k), C(_p1, 1, -1, k), C(_p2, 1, 1, k), C(_p3, -1, 1, k), dir(_tmpN, 0, 0, k));
  }
  if (c <= 0) return;

  // Chamfer strips and corner facets, shaded as a ROUNDED edge: each vertex
  // carries the normal of the face it came from, so the normal sweeps through
  // 90 degrees along the strip and the sun leaves a bright line on it instead of
  // one flat tone step. See the block above `pushTriN`.
  const qn = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3,
    na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, nd: THREE.Vector3) =>
    pushQuadN(sink, a, b, cc, d, na, nb, nc, nd, _col, p.b, rough, metal, emis);

  for (const i of [-1, 1]) for (const j of [-1, 1]) {         // edges along Z
    dir(_nX, i, 0, 0); dir(_nY, 0, j, 0);
    qn(A(_p0, i, j, -1), A(_p1, i, j, 1), B(_p2, i, j, 1), B(_p3, i, j, -1), _nX, _nX, _nY, _nY);
  }
  for (const j of [-1, 1]) for (const k of [-1, 1]) {         // edges along X
    dir(_nY, 0, j, 0); dir(_nZ, 0, 0, k);
    qn(B(_p0, -1, j, k), B(_p1, 1, j, k), C(_p2, 1, j, k), C(_p3, -1, j, k), _nY, _nY, _nZ, _nZ);
  }
  for (const i of [-1, 1]) for (const k of [-1, 1]) {         // edges along Y
    dir(_nZ, 0, 0, k); dir(_nX, i, 0, 0);
    qn(C(_p0, i, -1, k), C(_p1, i, 1, k), A(_p2, i, 1, k), A(_p3, i, -1, k), _nZ, _nZ, _nX, _nX);
  }
  for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) {  // corners
    dir(_nX, i, 0, 0); dir(_nY, 0, j, 0); dir(_nZ, 0, 0, k);
    pushTriN(sink, A(_ptA, i, j, k), B(_ptB, i, j, k), C(_ptC, i, j, k),
      _nX, _nY, _nZ, _col, p.b, rough, metal, emis);
  }
}

/**
 * Build the geometry from a part list.
 *
 * @param boundsPad multiplier on the computed bounding sphere. A pose applied
 *   in the vertex shader moves vertices the CPU never saw, so a sphere fitted
 *   to the authored positions is too tight and pops instances out at the screen
 *   edge. Required — see the header.
 */
export function buildBoneGeometry(parts: BonePart[], boundsPad: number): THREE.BufferGeometry {
  const sink: BoneSink = { pos: [], nrm: [], col: [], bone: [], mat: [] };
  for (const p of parts) emitBonePart(sink, p);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sink.col, 3));
  g.setAttribute('aBone', new THREE.Float32BufferAttribute(sink.bone, 1));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(sink.mat, 3));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius *= boundsPad;
  return g;
}
