/**
 * ============================================================================
 *  chamfer — the metre-UV primitive set. A chamfered box, a lathe, a chamfered
 *  cylinder, a torus and a ground plate.
 * ============================================================================
 *  Lifted BYTE-FOR-BYTE out of a base-building game's structure builder, where
 *  2,811 substantive lines — the largest file in that game — carried a second
 *  geometry kit that a dependency check could not see until it was widened.
 *
 *  Nothing in this file knows what a moon is. It knows a width, a chamfer and
 *  a triangle, which is the test `@homie-rocks/geom`'s own description states.
 *
 *  ── THERE ARE NOW TWO BEVELLED BOXES IN THIS PACKAGE AND THAT IS DELIBERATE
 *
 *  `prim.ts` publishes `bevelBox(w, h, d, c = 0.035, uvScale = 1)`; this file
 *  publishes `chamferBox(w, h, d, cham = 0.03)`. They build the same topology
 *  — 6 face quads, 12 edge quads, 8 corner triangles — and they are NOT
 *  interchangeable:
 *
 *    · `bevelBox` self-orients every triangle from its centroid and derives
 *      the normal geometrically; `chamferBox` is handed an explicit normal per
 *      facet and flips the winding to match it. The corner facets therefore
 *      carry a FLAT normal here and a per-triangle one there.
 *    · `bevelBox` multiplies its planar UVs by `uvScale`; this file's UVs are
 *      in METRES with no scale at all, because every material in the game this
 *      came from carries `repeat = 1 / worldSize` and two adjacent parts
 *      disagreeing about texel density reads as a material seam.
 *    · the default chamfers differ (0.035 against 0.03).
 *
 *  Collapsing them into one function COMPILES, passes every test, and MOVES
 *  VERTICES in three games at once — the same shape as two tyre solves merged
 *  into one that quietly makes one game drive like the other. So the two stand
 *  side by side, this paragraph is the receipt, and reconciling them is a
 *  PICTURE change that gets its own before-and-after. Fingerprint both and
 *  compare their triangle sets first, so the job starts from a measurement
 *  rather than from a guess.
 *
 *  `three` is a peerDependency here as everywhere in this package: two copies
 *  of three.js is two `instanceof` universes.
 */
import * as THREE from 'three';

const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fc = new THREE.Vector3();
const _fn = new THREE.Vector3();

class TriBuf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  /** Emit one triangle with an explicit normal and planar metre UVs. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3) {
    // Winding: three culls back faces, and a box with two inverted faces reads
    // as a hole in the hull that only appears from one side. Fix it here once
    // rather than reasoning about sign conventions at eighty call sites.
    _fa.subVectors(b, a); _fb.subVectors(c, a); _fn.crossVectors(_fa, _fb);
    const flip = _fn.dot(n) < 0;
    const p = flip ? [a, c, b] : [a, b, c];
    // Planar UV on the two axes least aligned with the normal.
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const uAxis = ax >= ay && ax >= az ? 'z' : 'x';
    const vAxis = ay >= az && ay >= ax ? 'z' : 'y';
    for (const q of p) {
      this.pos.push(q.x, q.y, q.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push((q as any)[uAxis], (q as any)[vAxis]);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3) {
    this.tri(a, b, c, n); this.tri(a, c, d, n);
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const _cA = new THREE.Vector3(), _cB = new THREE.Vector3(), _cC = new THREE.Vector3(), _cD = new THREE.Vector3();
const _cN = new THREE.Vector3();

/**
 * A box with all twelve edges and eight corners cut at 45 degrees.
 *
 * 6 face quads + 12 edge quads + 8 corner triangles = 132 vertices, against
 * ~1300 for the equivalent rounded box built by pushing a subdivided cube. At
 * the chamfer widths the art direction asks for (8-25 mm) a flat cut and a
 * fillet are indistinguishable in frame, and this one is affordable at the
 * counts a colony needs.
 */
export function chamferBox(w: number, h: number, d: number, cham = 0.03): THREE.BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const r = Math.min(cham, hx * 0.45, hy * 0.45, hz * 0.45);
  const half = [hx, hy, hz];
  const t = new TriBuf();
  const set = (v: THREE.Vector3, a: number, b: number, c: number) => v.set(a, b, c);

  // Faces, inset by the chamfer on both tangent axes.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const co = (sb: number, sc: number, out: THREE.Vector3) => {
        const p = [0, 0, 0];
        p[a] = s * half[a]; p[b] = sb * (half[b] - r); p[c] = sc * (half[c] - r);
        set(out, p[0], p[1], p[2]);
      };
      co(-1, -1, _cA); co(1, -1, _cB); co(1, 1, _cC); co(-1, 1, _cD);
      _cN.set(0, 0, 0); (_cN as any)[['x', 'y', 'z'][a]] = s;
      t.quad(_cA, _cB, _cC, _cD, _cN);
    }
  }

  // Edge bevels: the 45 degree cut between two faces, running the length of the
  // third axis.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const pt = (sc: number, onA: boolean, out: THREE.Vector3) => {
        const p = [0, 0, 0];
        p[a] = sa * (onA ? half[a] : half[a] - r);
        p[b] = sb * (onA ? half[b] - r : half[b]);
        p[c] = sc * (half[c] - r);
        set(out, p[0], p[1], p[2]);
      };
      pt(-1, true, _cA); pt(1, true, _cB); pt(1, false, _cC); pt(-1, false, _cD);
      const n = [0, 0, 0]; n[a] = sa; n[b] = sb;
      _cN.set(n[0], n[1], n[2]).normalize();
      t.quad(_cA, _cB, _cC, _cD, _cN);
    }
  }

  // Corner facets.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    _cA.set(sx * hx, sy * (hy - r), sz * (hz - r));
    _cB.set(sx * (hx - r), sy * hy, sz * (hz - r));
    _cC.set(sx * (hx - r), sy * (hy - r), sz * hz);
    _cN.set(sx, sy, sz).normalize();
    t.tri(_cA, _cB, _cC, _cN);
  }
  return t.geo();
}

/**
 * Surface of revolution from a 2-D profile of [radius, y] pairs.
 *
 * three's own LatheGeometry is not used because its UVs are 0..1 across the
 * whole surface, which throws away this file's metre convention and stretches
 * a 4 m print-layer texture over a 26 m dome. This one also splits the normal
 * at a profile corner sharper than `sharpDeg` — without that a chamfer on a
 * lathed rim smooths away and stops catching the specular that justified it.
 */
export function latheGeo(
  profile: number[][], seg = 48, phiStart = 0, phiLen = Math.PI * 2, sharpDeg = 34,
): THREE.BufferGeometry {
  const n = profile.length;
  // Per-profile-point normal in the (r, y) plane, duplicated across a hard
  // corner so the two sides keep their own.
  const segN: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const L = Math.hypot(dr, dy) || 1;
    segN.push([dy / L, -dr / L]);
  }
  const cosSharp = Math.cos((sharpDeg * Math.PI) / 180);
  // rings[i] = [ [r, y, nr, ny] ... ] one or two entries at point i
  const rings: number[][] = [];
  const arc: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    const a = segN[i - 1], b = segN[i];
    if (a && b) {
      const dot = a[0] * b[0] + a[1] * b[1];
      if (dot < cosSharp) {
        rings.push([profile[i][0], profile[i][1], a[0], a[1]]); arc.push(acc);
        rings.push([profile[i][0], profile[i][1], b[0], b[1]]); arc.push(acc);
        continue;
      }
      const nr = a[0] + b[0], ny = a[1] + b[1];
      const L = Math.hypot(nr, ny) || 1;
      rings.push([profile[i][0], profile[i][1], nr / L, ny / L]);
    } else {
      const s = a || b;
      rings.push([profile[i][0], profile[i][1], s[0], s[1]]);
    }
    arc.push(acc);
  }

  const cols = seg + 1;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const push = (ri: number, j: number) => {
    const [r, y, nr, ny] = rings[ri];
    const phi = phiStart + (j / seg) * phiLen;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    pos.push(r * cs, y, r * sn);
    nor.push(nr * cs, ny, nr * sn);
    // u is the real circumferential distance at this ring's radius, v the real
    // distance along the profile. Both in metres.
    uv.push(phi * Math.max(r, 0.02), arc[ri]);
  };
  for (let i = 0; i < rings.length - 1; i++) {
    // Skip the degenerate band a profile makes when two points coincide (the
    // sharp-corner duplicate above), or the lathe emits zero-area triangles
    // whose normals are NaN and whose shading is undefined.
    if (rings[i][0] === rings[i + 1][0] && rings[i][1] === rings[i + 1][1]) continue;
    for (let j = 0; j < seg; j++) {
      push(i, j); push(i + 1, j); push(i + 1, j + 1);
      push(i, j); push(i + 1, j + 1); push(i, j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A vertical chamfered cylinder or truncated cone, standing on y = 0. */
export function chamferCyl(rBot: number, rTop: number, h: number, seg = 24, cham = 0.04, capped = true): THREE.BufferGeometry {
  const c = Math.min(cham, h * 0.4, rBot * 0.4, rTop * 0.4);
  const p: number[][] = [];
  if (capped) p.push([0, 0]);
  p.push([rBot - c, 0], [rBot, c], [rTop, h - c], [rTop - c, h]);
  if (capped) p.push([0, h]);
  return latheGeo(p, seg, 0, Math.PI * 2);
}

/** A torus with metre UVs — the cyan ring strips, pipe elbows, dome rims. */
export function torusGeo(R: number, r: number, radial = 48, tubeSeg = 8, arc = Math.PI * 2, arcStart = 0): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const push = (i: number, j: number) => {
    const a = arcStart + (i / radial) * arc;
    const b = (j / tubeSeg) * Math.PI * 2;
    const cb = Math.cos(b), sb = Math.sin(b);
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = cb * ca, ny = sb, nz = cb * sa;
    pos.push((R + r * cb) * ca, r * sb, (R + r * cb) * sa);
    nor.push(nx, ny, nz);
    uv.push(a * R, b * r);
  };
  for (let i = 0; i < radial; i++) for (let j = 0; j < tubeSeg; j++) {
    push(i, j); push(i + 1, j); push(i + 1, j + 1);
    push(i, j); push(i + 1, j + 1); push(i, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Flat horizontal quad in XZ, centred, facing +Y, metre UVs. */
export function plateGeo(w: number, d: number): THREE.BufferGeometry {
  const t = new TriBuf();
  _cA.set(-w / 2, 0, -d / 2); _cB.set(w / 2, 0, -d / 2);
  _cC.set(w / 2, 0, d / 2); _cD.set(-w / 2, 0, d / 2);
  _cN.set(0, 1, 0);
  t.quad(_cA, _cB, _cC, _cD, _cN);
  return t.geo();
}

/**
 * A DOME MERIDIAN as `[radius, y]` pairs, ready for `latheGeo`.
 *
 * `r = R · cos(t·π/2)^power`, `y = base + H·t`. One exponent covers the whole
 * family a settlement or a skyline is built out of:
 *
 *     power   what it is
 *     2.0     a hemisphere-ish ellipse
 *     1.3     a low broad profile
 *     0.62    a pointed ogive, with a tall H
 *
 * That is the reason for the function rather than three tables: two domes built
 * from one exponent read as the SAME ARCHITECTURE AT TWO SIZES, which is what
 * makes a place look designed instead of assembled from stock parts. Three
 * hand-typed profiles do not, however carefully they are typed.
 *
 * The radius is floored just above zero at the apex: a lathe given an exact 0
 * makes a degenerate ring of coincident vertices whose normals are NaN, and the
 * symptom is a black speck at the top of every dome.
 */
export function domeMeridian(R: number, H: number, power: number, steps = 22, base = 0): number[][] {
  const p: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = base + H * t;
    const r = R * Math.pow(Math.cos(t * Math.PI * 0.5), power);
    p.push([Math.max(0.001, r), y]);
  }
  return p;
}

/**
 * A point on that meridian, for hanging ribs, rings and hatches off it.
 *
 * NOT floored, unlike `domeMeridian`: the floor there is a guard against a
 * degenerate lathe ring, and a caller placing an object at the apex wants the
 * true zero rather than a millimetre of lie.
 */
export function domeMeridianAt(R: number, H: number, power: number, t: number, base = 0): [number, number] {
  return [R * Math.pow(Math.cos(t * Math.PI * 0.5), power), base + H * t];
}
