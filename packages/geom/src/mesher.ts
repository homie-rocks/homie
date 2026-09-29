/**
 * ============================================================================
 *  MesherBase — the accumulating triangle soup a whole vehicle is one mesh of.
 * ============================================================================
 *
 *  One growing buffer of positions, UVs, a per-vertex ROLE index and an index
 *  list, with the primitives a procedural machine is actually built out of:
 *  a rounded-rectangle ring, a revolve, an arbitrary BufferGeometry welded in,
 *  a parallel-transport tube, a domed decal panel, and a UV remap that squeezes
 *  a metre-space part into one rect of a packed atlas. A complete kart is 12
 *  draw calls instead of 60 because everything goes through one of these.
 *
 *  IT WAS EXTRACTED FROM TWO RACING GAMES, a kart racer and a space racer,
 *  whose copies of this class were byte-identical EXCEPT FOR `addLoft`. That
 *  exception is the whole design of this file, so it is worth stating exactly:
 *
 *    A `diff` of the two games' entire geometry-kit sections is 113 lines,
 *    and every one of them is inside `addLoft` or the `LoftOpts` it reads.
 *    `ring`, `push`, `addRevolve`, `addGeometry`, `addTube`, `addPanel`,
 *    `mark`, `remapUV`, `finish` and `mat` do not differ by a character.
 *
 *  The space racer's `addLoft` is a strictly BETTER one: it carries a per-part
 *  `uvOffset` so four identical external tanks do not wear the same quilt of
 *  panels, and it PLANAR-PROJECTS the end caps instead of fanning them — the
 *  fanned version put a two-texel sliver across a 3.7 m stern face and came
 *  out of review as a flat bone rectangle. **Taking that version for both games
 *  would be an upgrade to the kart racer's picture, and an upgrade is a change
 *  with a before-and-after of its own, never something smuggled into an
 *  extraction.**
 *
 *  The 113 lines of diff are not one disagreement but two, and only one of
 *  them is behaviour. `uvOffset` is a value the kart racer never passes, and
 *  zero metres of shift is the identity — bit-exact, not merely close, because
 *  `arc` and `vAccum` are non-negative finite by construction here. The END
 *  CAP is the real disagreement. So the loft SKELETON is one method, and the
 *  cap is one overridable method (`addLoftCap`) whose default is the kart
 *  racer's fan, kept for that game's picture and not because it is right, with
 *  the space racer's planar projection overriding it in that game. **Neither
 *  game's picture moved**; a parity test checked both lofts bit-exact against
 *  the originals.
 *
 *  `push`, `ring` and `vcount` are `protected` rather than `private` because
 *  `addLoft` and `addLoftCap` touch them and a game's override of the latter
 *  must be able to. If a third method ever needs them, ask first whether it is
 *  the same method in two games wearing two names.
 *
 *  NO NUMBER MOVED. Every literal is the games' own — the 0.98 corner clamp,
 *  the 0.45 panel falloff exponent, the 6.28 tube U scale, the 0.85 end-dome
 *  offset. The only edits in extraction were `private` becoming `protected`,
 *  `Mesher` becoming `MesherBase`, and `Role.Base` becoming the `0` it already
 *  compiled to (both games number `Base = 0`, and both say in their own words
 *  that the ordinals are baked into a Uint8Array and may never be renumbered).
 * ============================================================================
 */

import * as THREE from 'three';

/** One cross-section of a loft, in the local XY plane at `z`. */
export interface Section {
  z: number;
  /** half width / half height of the rounded rectangle */
  hw: number;
  hh: number;
  /** corner radius — this is the chamfer, never leave it at 0 */
  r?: number;
  /** centre offset of the section */
  x?: number;
  y?: number;
  /** >0 widens the top of the section, <0 the classic tub tumblehome */
  taper?: number;
}

export interface LoftOpts {
  /** samples per rounded corner; 2 gives a crisp chamfer, 3 a soft bevel */
  corner?: number;
  /**
   * End chamfer depth in metres; 0 leaves a flat unbevelled cap (avoid).
   * The chamfer is grown *outward*, so the finished part is this much longer
   * than the section list at each end.
   */
  capStart?: number;
  capEnd?: number;
  /** rings in the end chamfer: 1 = a flat 45 deg bevel, 2 = a rounded one */
  capSeg?: number;
  /** false leaves the loft open (used when a part butts into another) */
  closeStart?: boolean;
  closeEnd?: boolean;
  /**
   * Metres to shift this part's UVs by before the atlas remap.
   *
   * WHY A LOFT NEEDS THIS AT ALL. `addLoft` parameterises U by arc length
   * around the ring and V by arc length along the machine, and V restarts at 0
   * for every call — which is correct, and which means two IDENTICAL lofts
   * placed by two different matrices sample exactly the same texels. On one
   * part that is invisible. On one space racer's hull, whose silhouette is four
   * identical external tanks clamped at the corners, it put the same quilt of
   * panels on all four, 8 m from the camera, and a review logged it as "a
   * visible UV tiling repeat on a hull".
   *
   * Shifting in METRES rather than in UV keeps the offset meaningful after
   * `remapUV` normalises the mesher: half a metre of V is a little over one
   * sub-panel at that game's panel scale, so a per-part shift of a few tenths
   * lands each copy on a different set of plates rather than on a different
   * part of the same plate. Keep the shifts small — they widen the mesher's UV
   * bounds and therefore rescale every other part's texel density by the same
   * proportion.
   *
   * **The default fan cap below does not honour this**, and cannot: its UVs are
   * not in the loft's metre space at all. See `addLoftCap`.
   */
  uvOffset?: readonly [number, number];
}

/**
 * Everything the end-cap of a loft needs to know, as one struct.
 *
 * A struct rather than ten positional parameters because this is the ONE
 * variation point between the two racers' lofts, so it is the signature a
 * second implementation has to be written against — and a ten-argument
 * protected method is how the wrong argument ends up in the wrong slot.
 * Allocated once per cap at build time, never per frame.
 */
export interface LoftCap {
  /** `[x, y, arcLen]` triplets of the ring being capped, from `ring()` */
  rg: number[];
  /** z of that ring, in the loft's own space */
  z: number;
  /** V — metres along the machine — of that ring, with `uvOffset[1]` applied */
  v: number;
  /** vertices per ring, INCLUDING the duplicated seam vertex */
  n: number;
  /** true for the far (+z) cap; decides the winding */
  front: boolean;
  role: number;
  /** `uvOffset`, already defaulted to 0 */
  uOff: number;
  vOff: number;
  m?: THREE.Matrix4 | undefined;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export interface Built {
  geo: THREE.BufferGeometry;
  /** per-vertex colour role, resolved to RGB per livery */
  roles: Uint8Array;
  triangles: number;
}

/**
 * Accumulating triangle soup with a chamfered-loft primitive.
 * Every part of the kart is appended into one of a handful of Meshers, so a
 * complete kart is 12 draw calls instead of 60.
 */
/**
 * The base coat, and it is a NUMBER here rather than an enum member.
 *
 * Both games declare `Role.Base = 0` and both say in their own words that the
 * ordinals are baked into a `Uint8Array` by this class and read back by
 * `liveryGeometry`, so renaming is free and renumbering is not. Importing a
 * game's `Role` into a package would be the wrong direction of dependency for
 * a default argument; restating the zero, with the invariant beside it, is the
 * honest version. It compiles to exactly the byte the games compiled to.
 */
const ROLE_BASE = 0;

/**
 * Resample a section list to `n` evenly spaced rings, interpolating every
 * channel.
 *
 * AUTHORED KEYS SAY WHAT A SHAPE IS; THEY ARE NOT A STATEMENT ABOUT HOW FINELY
 * IT SHOULD BE TESSELLATED, and conflating the two is how a hand-authored body
 * comes out at a third of its triangle budget with visibly faceted flanks.
 * Under one hard small-disc key a facet boundary on a metal flank is a hard
 * break in the reflection rather than a soft shading step, which is the thing a
 * reviewer names first.
 *
 * LINEAR RATHER THAN SPLINE, on purpose. A Catmull-Rom through half-widths
 * overshoots at a shoulder, and an overshoot here is a BULGE IN THE SILHOUETTE
 * — the same argument a track layout makes for keeping its half-width monotone.
 * A smoother curve through the keys is not a better body; it is a body the
 * author did not draw.
 *
 * Below `n` the list is returned unchanged rather than decimated: this
 * function raises tessellation and never lowers it, so an author who has
 * already spelled 30 rings keeps all 30.
 *
 * @param defaultR the corner radius a section that omits one inherits. There is
 *                 no default: it is the body's own chamfer and a package that
 *                 guessed it would hand the next body this one's edges.
 */
export function resampleSections(secs: Section[], n: number, defaultR: number): Section[] {
  if (secs.length >= n) return secs;
  const z0 = secs[0]!.z;
  const z1 = secs[secs.length - 1]!.z;
  const out: Section[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / (n - 1);
    while (k < secs.length - 2 && secs[k + 1]!.z < z) k++;
    const a = secs[k]!;
    const b = secs[k + 1]!;
    const t = Math.max(0, Math.min(1, (z - a.z) / Math.max(1e-6, b.z - a.z)));
    const L = (p: number, q: number) => p + (q - p) * t;
    out.push({
      z,
      hw: L(a.hw, b.hw),
      hh: L(a.hh, b.hh),
      x: L(a.x ?? 0, b.x ?? 0),
      y: L(a.y ?? 0, b.y ?? 0),
      r: L(a.r ?? defaultR, b.r ?? defaultR),
      taper: L(a.taper ?? 0, b.taper ?? 0),
    });
  }
  return out;
}

export class MesherBase {
  protected pos: number[] = [];
  protected uv: number[] = [];
  protected role: number[] = [];
  protected idx: number[] = [];

  protected vcount() { return this.pos.length / 3; }

  protected push(x: number, y: number, z: number, u: number, v: number, role: number, m?: THREE.Matrix4) {
    _v.set(x, y, z);
    if (m) _v.applyMatrix4(m);
    this.pos.push(_v.x, _v.y, _v.z);
    this.uv.push(u, v);
    this.role.push(role);
  }

  /**
   * Rounded-rectangle ring; returns [x,y,arcLen] triplets with the first point
   * repeated at the end so the U seam does not mirror a whole column of texels.
   */
  protected ring(s: Section, corner: number): number[] {
    const hw = Math.max(1e-4, s.hw);
    const hh = Math.max(1e-4, s.hh);
    const r = Math.min(s.r ?? 0.05, hw * 0.98, hh * 0.98);
    const taper = s.taper ?? 0;
    const out: number[] = [];
    let arc = 0;
    let px = 0, py = 0;
    const quad = [
      [hw - r, -(hh - r), -Math.PI / 2],
      [hw - r, hh - r, 0],
      [-(hw - r), hh - r, Math.PI / 2],
      [-(hw - r), -(hh - r), Math.PI],
    ];
    for (let q = 0; q < 4; q++) {
      const [cx, cy, a0] = quad[q];
      for (let k = 0; k <= corner; k++) {
        const a = a0 + (k / corner) * (Math.PI / 2);
        let x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        x *= 1 + taper * (y / Math.max(1e-4, hh)); // tumblehome
        if (out.length) arc += Math.hypot(x - px, y - py);
        px = x; py = y;
        out.push(x + (s.x ?? 0), y + (s.y ?? 0), arc);
      }
    }
    arc += Math.hypot(out[0] - (s.x ?? 0) - px, out[1] - (s.y ?? 0) - py);
    out.push(out[0], out[1], arc);
    return out;
  }

  /**
   * Loft a chamfered tube through `sections` (ordered by increasing z) and cap
   * both ends with a rounded chamfer. UVs are in metres so every part of the
   * machine shares one texel density.
   *
   * ==========================================================================
   *  THIS WAS TWO METHODS, AND WHAT SEPARATED THEM WAS ONE CAP.
   * ==========================================================================
   *  The space racer's version is strictly better than the kart racer's, and
   *  taking it for both games would be an UPGRADE smuggled into an extraction —
   *  so no game's picture changes here. The two lofts diverge in exactly two
   *  places, and only one of them is behaviour:
   *
   *    · `uvOffset`, which the kart racer never passes. Zero metres of shift is
   *      the identity — `arc + 0` and `vAccum + 0`, both of which are
   *      non-negative finite by construction here, so it is bit-exact and not
   *      merely close.
   *    · THE END CAP, which is a real disagreement about what a cap's UVs mean,
   *      with a measured before-and-after on each side. That one is `addLoftCap`
   *      below, and the space racer overrides it.
   *
   *  So the skeleton — the chamfer expansion, the ring walk, the quad strip,
   *  every literal in them — is one method, and the disagreement is one
   *  overridable method with the argument for each version beside it.
   *
   *  NO NUMBER MOVED. The 2-sample corner default, the 0.035 m cap depth, the
   *  quarter-circle chamfer profile and the `CAP_SEG` of 2 are the games' own.
   */
  addLoft(sections: Section[], role: number, m?: THREE.Matrix4, o: LoftOpts = {}) {
    const corner = o.corner ?? 2;
    const capS = o.capStart ?? 0.035;
    const capE = o.capEnd ?? 0.035;
    const closeS = o.closeStart !== false;
    const closeE = o.closeEnd !== false;
    const CAP_SEG = o.capSeg ?? 2;
    const uOff = o.uvOffset ? o.uvOffset[0] : 0;
    const vOff = o.uvOffset ? o.uvOffset[1] : 0;

    // Expand into the full ring list: [start chamfer] + body + [end chamfer].
    // The chamfer profile is a quarter circle so the cap reads as a rounded
    // bevel and picks up a highlight from any direction.
    const rings: Section[] = [];
    const first = sections[0]!;
    const last = sections[sections.length - 1]!;
    if (closeS && capS > 0) {
      for (let k = CAP_SEG; k >= 1; k--) {
        const a = (k / CAP_SEG) * (Math.PI / 2);
        const inset = capS * (1 - Math.cos(a));
        rings.push({ ...first, z: first.z - capS * Math.sin(a), hw: first.hw - inset, hh: first.hh - inset });
      }
    }
    for (const s of sections) rings.push(s);
    if (closeE && capE > 0) {
      for (let k = 1; k <= CAP_SEG; k++) {
        const a = (k / CAP_SEG) * (Math.PI / 2);
        const inset = capE * (1 - Math.cos(a));
        rings.push({ ...last, z: last.z + capE * Math.sin(a), hw: last.hw - inset, hh: last.hh - inset });
      }
    }

    const base = this.vcount();
    const ringVerts: number[][] = [];
    /** V (metres along the machine) of each ring, kept for the cap projection. */
    const ringV: number[] = [];
    let vAccum = 0;
    let prevZ = rings[0]!.z;
    for (const s of rings) {
      vAccum += Math.abs(s.z - prevZ);
      prevZ = s.z;
      const rg = this.ring(s, corner);
      ringVerts.push(rg);
      ringV.push(vAccum);
      for (let i = 0; i < rg.length; i += 3) {
        this.push(rg[i]!, rg[i + 1]!, s.z, rg[i + 2]! + uOff, vAccum + vOff, role, m);
      }
    }
    const N = ringVerts[0]!.length / 3; // includes the duplicated seam vertex
    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < N - 1; j++) {
        const j2 = j + 1;
        const a = base + r * N + j;
        const b = base + r * N + j2;
        const c = base + (r + 1) * N + j2;
        const d = base + (r + 1) * N + j;
        this.idx.push(a, b, c, a, c, d);
      }
    }
    const cap = (ri: number, front: boolean) => this.addLoftCap({
      rg: ringVerts[ri]!, z: rings[ri]!.z, v: ringV[ri]! + vOff,
      n: N, front, role, uOff, vOff, m,
    });
    if (closeS) cap(0, false);
    if (closeE) cap(rings.length - 1, true);
  }

  /**
   * Close the hole the chamfer left, as a flat triangle fan.
   *
   * ==========================================================================
   *  THE DEFAULT IS THE KART RACER'S, AND ITS UVs ARE NOT IN METRE SPACE.
   * ==========================================================================
   *  The rim ring gets `(arcLength, 0)` and the centre vertex gets `(0.5, 0.5)`
   *  — one coordinate in metres and one normalised, in the same triangle. On a
   *  kart that is invisible and has been for the life of the game: every capped
   *  part on it is small, or points away, or is a bumper end nobody's camera
   *  gets square onto.
   *
   *  It is NOT invisible on a blunt hull, and the space racer's override
   *  records what it cost there: after `remapUV` normalises the mesher, this fan
   *  spans ~0.06 in V, so a 3.7 x 0.8 m stern face sampled a two-texel-tall
   *  sliver of the panel field and stretched it across 400 px — no panel line,
   *  no rivet, no seam, a flat rectangle.
   *
   *  **This default is therefore kept for the kart racer's picture, not because
   *  it is right.** A new consumer should override it with a planar projection.
   *  `uvOffset` is deliberately ignored here rather than added to `0.5`: a metre
   *  shift applied to a normalised coordinate is a second wrong answer, and the
   *  honest fix is the override, not an offset on top of the defect.
   */
  protected addLoftCap(c: LoftCap) {
    const { rg, z, n: N, front, role, m } = c;
    let cx = 0, cy = 0;
    for (let i = 0; i < rg.length - 3; i += 3) { cx += rg[i]!; cy += rg[i + 1]!; }
    cx /= N - 1; cy /= N - 1;
    const c0 = this.vcount();
    this.push(cx, cy, z, 0.5, 0.5, role, m);
    const start = this.vcount();
    for (let i = 0; i < rg.length; i += 3) this.push(rg[i]!, rg[i + 1]!, z, rg[i + 2]!, 0, role, m);
    for (let j = 0; j < N - 1; j++) {
      const j2 = j + 1;
      if (front) this.idx.push(c0, start + j, start + j2);
      else this.idx.push(c0, start + j2, start + j);
    }
  }

  addRevolve(
    profile: number[], radial: number, role: number, m?: THREE.Matrix4,
    uSpan = 1, uOff = 0, modR?: (i: number, a: number) => number,
  ) {
    const rings = profile.length / 3;
    const base = this.vcount();
    const cols = radial + 1; // duplicate the seam column so U does not mirror
    for (let i = 0; i < rings; i++) {
      const x = profile[i * 3];
      const r0 = profile[i * 3 + 1];
      const v = profile[i * 3 + 2];
      for (let j = 0; j < cols; j++) {
        const a = (j / radial) * Math.PI * 2;
        const r = r0 + (modR ? modR(i, a) : 0);
        this.push(x, Math.cos(a) * r, Math.sin(a) * r, uOff + (j / radial) * uSpan, v, role, m);
      }
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * cols + j;
        const b = a + 1;
        const c = base + (i + 1) * cols + j + 1;
        const d = base + (i + 1) * cols + j;
        this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /**
   * Append any BufferGeometry (three primitives), transformed.
   *
   * The source index is CARRIED OVER rather than expanded away. An early version
   * called `toNonIndexed()` here, which gave every triangle its own three vertices —
   * and `finish()` runs `computeVertexNormals()`, so every sphere and torus on
   * the kart and the driver came out FLAT SHADED. That is most of why the
   * helmet read as a faceted low-poly ball, and it cost 3x the vertices to do
   * it. Welding the index back costs nothing and smooths the lot.
   */
  addGeometry(geo: THREE.BufferGeometry, role: number, m?: THREE.Matrix4, uvScale = 1) {
    const p = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const base = this.vcount();
    for (let i = 0; i < p.count; i++) {
      this.push(
        p.getX(i), p.getY(i), p.getZ(i),
        uv ? uv.getX(i) * uvScale : 0, uv ? uv.getY(i) * uvScale : 0,
        role, m,
      );
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  /**
   * Swept tube through a polyline with parallel-transport frames — roll bar,
   * exhaust pipes, nerf bars. Ends are domed so no pipe shows a raw ring.
   */
  addTube(path: THREE.Vector3[], radius: number | ((t: number) => number), radial: number, role: number, m?: THREE.Matrix4) {
    const R = typeof radius === 'function' ? radius : () => radius as number;
    const n = path.length;
    const base = this.vcount();
    // seed an arbitrary normal perpendicular to the first tangent
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const bin = new THREE.Vector3();
    tan.copy(path[1]).sub(path[0]).normalize();
    nrm.set(0, 1, 0);
    if (Math.abs(nrm.dot(tan)) > 0.9) nrm.set(1, 0, 0);
    nrm.crossVectors(tan, nrm).normalize();
    let len = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const prev = tan.clone();
        if (i < n - 1) tan.copy(path[i + 1]).sub(path[i - 1]).normalize();
        else tan.copy(path[i]).sub(path[i - 1]).normalize();
        // rotate the frame by the same rotation that took prev -> tan
        const q = new THREE.Quaternion().setFromUnitVectors(prev, tan);
        nrm.applyQuaternion(q).normalize();
        len += path[i].distanceTo(path[i - 1]);
      }
      bin.crossVectors(tan, nrm).normalize();
      const r = R(i / (n - 1));
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        _n.copy(nrm).multiplyScalar(c * r).addScaledVector(bin, s * r).add(path[i]);
        this.push(_n.x, _n.y, _n.z, (a / (Math.PI * 2)) * r * 6.28, len, role, m);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const a = base + i * radial + j;
        const b = base + i * radial + j2;
        const c = base + (i + 1) * radial + j2;
        const d = base + (i + 1) * radial + j;
        this.idx.push(a, b, c, a, c, d);
      }
    }
    // dome the two ends
    for (const end of [0, 1]) {
      const ri = end ? n - 1 : 0;
      tan.copy(path[ri]).sub(path[ri + (end ? -1 : 1)]).normalize();
      const c0 = this.vcount();
      _n.copy(path[ri]).addScaledVector(tan, R(end) * 0.85);
      this.push(_n.x, _n.y, _n.z, 0.5, len, role, m);
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const a = base + ri * radial + j;
        const b = base + ri * radial + j2;
        if (end) this.idx.push(c0, a, b);
        else this.idx.push(c0, b, a);
      }
    }
  }

  /**
   * Slightly domed painted panel whose border sinks back to zero — it lies on
   * the bodywork like a decal without a hard lip or any z-fighting, and its
   * UVs address one rect of the livery atlas.
   */
  addPanel(w: number, h: number, bulge: number, uvRect: readonly [number, number, number, number], m: THREE.Matrix4, role = ROLE_BASE, seg = 8) {
    const base = this.vcount();
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const v = j / seg;
        // falloff = 1 in the middle, 0 at the border
        const fx = Math.sin(Math.PI * u);
        const fy = Math.sin(Math.PI * v);
        const z = bulge * Math.pow(fx * fy, 0.45);
        this.push((u - 0.5) * w, (v - 0.5) * h, z, uvRect[0] + u * uvRect[2], uvRect[1] + v * uvRect[3], role, m);
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 2;
        const d = a + seg + 1;
        this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /** Vertex index to hand to `remapUV` after adding a part. */
  mark() { return this.vcount(); }

  /**
   * Squeeze the UVs of everything added since `from` into one rect of the
   * atlas. Parts built from metre-space lofts have no idea which zone of a
   * packed texture they belong in; this puts them there without a second
   * material.
   */
  remapUV(from: number, rect: readonly [number, number, number, number]) {
    const n = this.vcount();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = from; i < n; i++) {
      const u = this.uv[i * 2];
      const v = this.uv[i * 2 + 1];
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const du = u1 - u0 || 1;
    const dv = v1 - v0 || 1;
    for (let i = from; i < n; i++) {
      this.uv[i * 2] = rect[0] + ((this.uv[i * 2] - u0) / du) * rect[2];
      this.uv[i * 2 + 1] = rect[1] + ((this.uv[i * 2 + 1] - v0) / dv) * rect[3];
    }
  }

  get triangles() { return this.idx.length / 3; }

  finish(): Built {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return { geo, roles: Uint8Array.from(this.role), triangles: this.idx.length / 3 };
  }
}

/** Convenience: a matrix from position / euler / uniform-or-vector scale. */
export function mat(
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = sx, sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}
