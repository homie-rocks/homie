/**
 * ============================================================================
 *  Solid primitives — the three shapes the built world is actually made of.
 * ============================================================================
 *  A chamfered box, an unchamfered one, and a quad. Nothing here knows what it
 *  is going to become: `bevelBox` builds a harbour wall in one racing game and
 *  a service cabinet in another off the same 52 triangles, and neither of
 *  those words appears in this file.
 *
 *  All three came out of the prop libraries of those two racing games, where
 *  they were BYTE-IDENTICAL across a fork that had otherwise diverged by
 *  thousands of lines (39 symbols, 726 lines, identical). The two docblocks
 *  below are the kart racer's; the space racer's copy had dropped them. The
 *  comments are the asset, so the extraction takes the UNION of the comments —
 *  eleven lines of explanation regained, and no behaviour changed at all.
 */
import * as THREE from 'three';

/**
 * Box with flat chamfers on every edge and corner. Hard 90° edges catch no
 * specular and are the second-biggest amateur tell — this is what the
 * entire built world is made from.
 * UVs are planar per dominant axis so a single tiling texture never stretches.
 */
export function bevelBox(w: number, h: number, d: number, c = 0.035, uvScale = 1): THREE.BufferGeometry {
  const hx = w / 2,
    hy = h / 2,
    hz = d / 2;
  c = Math.min(c, hx * 0.45, hy * 0.45, hz * 0.45);
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const corner = (sx: number, sy: number, sz: number, axis: number) => {
    const x = sx * (axis === 0 ? hx : hx - c);
    const y = sy * (axis === 1 ? hy : hy - c);
    const z = sz * (axis === 2 ? hz : hz - c);
    return [x, y, z] as [number, number, number];
  };
  const tri = (a: number[], b: number[], cc: number[]) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = cc[0] - a[0],
      vy = cc[1] - a[1],
      vz = cc[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    // The box is convex and centred on the origin, so "outward" is simply the
    // face centroid direction. Self-orienting here beats hand-deriving the
    // winding for twelve edge quads and eight corner triangles.
    if (nx * (a[0] + b[0] + cc[0]) + ny * (a[1] + b[1] + cc[1]) + nz * (a[2] + b[2] + cc[2]) < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      const t = b;
      b = cc;
      cc = t;
    }
    const ax = Math.abs(nx),
      ay = Math.abs(ny),
      az = Math.abs(nz);
    for (const p of [a, b, cc]) {
      P.push(p[0], p[1], p[2]);
      N.push(nx, ny, nz);
      if (ax >= ay && ax >= az) U.push(p[2] * uvScale, p[1] * uvScale);
      else if (ay >= az) U.push(p[0] * uvScale, p[2] * uvScale);
      else U.push(p[0] * uvScale, p[1] * uvScale);
    }
  };
  const quad = (a: number[], b: number[], cc: number[], dd: number[]) => {
    tri(a, b, cc);
    tri(a, cc, dd);
  };
  // 6 faces
  for (let axis = 0; axis < 3; axis++) {
    for (let s = -1; s <= 1; s += 2) {
      const pts: number[][] = [];
      for (let i = 0; i < 4; i++) {
        const a = i === 0 || i === 3 ? -1 : 1;
        const b = i < 2 ? -1 : 1;
        pts.push(axis === 0 ? corner(s, a * s, b, 0) : axis === 1 ? corner(a, s, b * s, 1) : corner(a * s, b, s, 2));
      }
      quad(pts[0], pts[1], pts[2], pts[3]);
    }
  }
  // 12 edge quads + 8 corner triangles
  for (const [a1, a2] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as [number, number][]) {
    const a3 = 3 - a1 - a2;
    for (let s1 = -1; s1 <= 1; s1 += 2)
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        const mk = (s3: number, axis: number) => {
          const s = [0, 0, 0];
          s[a1] = s1;
          s[a2] = s2;
          s[a3] = s3;
          return corner(s[0], s[1], s[2], axis);
        };
        const p0 = mk(-1, a1),
          p1 = mk(-1, a2),
          p2 = mk(1, a2),
          p3 = mk(1, a1);
        // winding depends on the sign product so normals always face out
        if (s1 * s2 * (a1 === 0 && a2 === 1 ? 1 : a1 === 1 && a2 === 2 ? 1 : -1) > 0) quad(p0, p1, p2, p3);
        else quad(p3, p2, p1, p0);
      }
  }
  for (let sx = -1; sx <= 1; sx += 2)
    for (let sy = -1; sy <= 1; sy += 2)
      for (let sz = -1; sz <= 1; sz += 2) {
        const px = corner(sx, sy, sz, 0),
          py = corner(sx, sy, sz, 1),
          pz = corner(sx, sy, sz, 2);
        if (sx * sy * sz > 0) tri(px, py, pz);
        else tri(px, pz, py);
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}

/**
 * Unchamfered 12-triangle box with the same planar UV convention as
 * `bevelBox`. Reserved for parts small enough that a chamfer cannot be
 * resolved on screen — shutter louvres, balusters, tyre tread — where paying
 * 52 triangles times a thousand instances buys nothing.
 */
export function plainBox(w: number, h: number, d: number, uvScale = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)),
      ny = Math.abs(nor.getY(i));
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    if (nx > 0.5) uv.setXY(i, pz * uvScale, py * uvScale);
    else if (ny > 0.5) uv.setXY(i, px * uvScale, pz * uvScale);
    else uv.setXY(i, px * uvScale, py * uvScale);
  }
  uv.needsUpdate = true;
  return g;
}

/** A single quad in XY, pivot at the bottom centre, for alpha cards. */
export function card(w: number, h: number, uOff = 0, uScale = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 3);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uOff + uv.getX(i) * uScale);
  uv.needsUpdate = true;
  return g;
}

/**
 * A UNIT quad lying in the XZ plane, facing +Y: the thing you scale into place
 * for a contact shadow, a decal, a verge band, a tyre mark, a puddle edge.
 *
 * `spans` is how many quads across local X. One is right for a stamp, which is
 * flat by definition; more than one is what lets a strip FOLLOW a cambered or
 * crowned surface instead of cutting a chord through it, and getting this
 * wrong is invisible on a flat test scene and obvious on a real one.
 *
 * `anchorEdge` moves the origin from the centre to the low-X edge, which is
 * what a caller wants when the strip is quoted as "from the kerb outward"
 * rather than as "centred on the verge".
 */
export function groundStrip(spans = 1, anchorEdge = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, spans, 1);
  g.rotateX(-Math.PI / 2);
  if (anchorEdge) g.translate(0.5, 0, 0);
  return g;
}

/**
 * A flat disc facing +Y whose radius WOBBLES per vertex — a stain, a scorch, a
 * puddle, a patch of wear.
 *
 * A PERFECT CIRCLE IS THE GIVEAWAY that a mark was placed rather than earned.
 * Nothing in the physical world leaves one: a blast mark, a spill and a worn
 * patch all have an irregular boundary set by whatever they ran into, and the
 * eye reads the regularity long before it reads the shape.
 *
 * Built as a fan of independent triangles rather than as an indexed disc, so
 * every wedge carries its own two boundary radii and the outline is genuinely
 * jagged rather than a smooth radial function. UVs are the world XZ of each
 * vertex, so a texture on this is in metres and two marks of different sizes do
 * not show the same texel density.
 *
 * `wobble` is the FULL width of the radius variation as a fraction: 0 is a
 * clean circle, 0.22 is a fifth of the radius either way. The RNG is the
 * caller's, so a captured frame bakes the identical mark twice.
 */
export function wobbleDisc(rBase: number, seg: number, rng: () => number, wobble = 0.22): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < seg; i++) r.push(rBase * (1 - wobble * 0.5 + rng() * wobble));
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const r0 = r[i]!, r1 = r[(i + 1) % seg]!;
    const p = [
      [0, 0, 0],
      [Math.cos(a0) * r0, 0, Math.sin(a0) * r0],
      [Math.cos(a1) * r1, 0, Math.sin(a1) * r1],
    ];
    for (const q of p) { pos.push(q[0]!, q[1]!, q[2]!); nor.push(0, 1, 0); uv.push(q[0]!, q[2]!); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * A CHAMFERED CAP: a regular n-gon plate with a dressed edge and a vertical
 * skirt down to its seating plane. A tile, a paver, a shingle, a button, a
 * bolted-on panel — anything that is a flat face with a real edge.
 *
 * Built in a LOCAL FRAME with +Z as the outward face normal and XY as the
 * plane, because that is how a cap gets instanced onto a surface: the caller
 * has a normal and wants to point +Z along it.
 *
 * ── THE CHAMFER IS THE WHOLE REASON THIS EXISTS, AND IT IS EASY TO OVERDO ───
 * An unchamfered arris catches no specular, and ten thousand of them catch no
 * specular very loudly. But a WIDE bevel around a small flat top is
 * indistinguishable from a hemisphere at any distance where the cap is a few
 * pixels across — the word a review reaches for is "bubble wrap", and it is
 * reading the geometry correctly. So `rIn` and `drop` are both arguments, and
 * both want to be small: a dressed break is millimetres of world, not a third
 * of the face.
 *
 * The chamfer's NORMAL is authored separately from its geometry — see `tilt`.
 * Barely above geometric is a thread of specular; well above it is a row of
 * pearls.
 *
 * `uvInset` is where the top ring lands in the 0..1 UV disc — below 0.5 it
 * keeps the chamfer's own texels distinct from the face's.
 *
 * Vertex colour is written WHITE. A cap is almost always instanced, and three
 * multiplies `instanceColor` into the same varying, so white here means the
 * per-instance tone carries alone while a merged field can still overwrite the
 * attribute with real values.
 */
export function chamferCap(o: {
  /** 6 for a hex, 4 for a square paver, 32 for a disc */
  sides: number;
  /** circumradius at the outer edge */
  rOut: number;
  /** circumradius of the flat top, i.e. where the chamfer starts */
  rIn: number;
  /** height of the flat top above the seating plane */
  hTop: number;
  /** how far the outer edge drops below the flat top */
  drop: number;
  /**
   * The chamfer normal, as [RADIAL, AXIAL], and it is a PAIR rather than one
   * angle on purpose.
   *
   * The geometric value of the radial part is `drop / (rOut - rIn)`.
   * Exaggerating it is a legitimate move on a wide bevel and is exactly what
   * turns a narrow one into a lit dome, so it is authored rather than derived —
   * and the axial part is authored WITH it rather than computed as
   * `sqrt(1 - r²)`, because a hand-authored pair is not exactly unit and
   * normalising it here would silently move every one of ten thousand normals
   * by a few thousandths. That is invisible, unattributable, and enough to make
   * a later before-and-after unreadable.
   */
  tilt: number;
  axial: number;
  /** radius of the top ring in the UV disc. Defaults to 0.46. */
  uvInset?: number;
}): THREE.BufferGeometry {
  const n = o.sides;
  const uvIn = o.uvInset ?? 0.46;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  const push = (x: number, y: number, z: number, nx: number, ny: number, nzz: number, u: number, v: number) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nzz);
    uv.push(u, v);
    col.push(1, 1, 1);
    return pos.length / 3 - 1;
  };

  const centre = push(0, 0, o.hTop, 0, 0, 1, 0.5, 0.5);
  const top: number[] = [];
  const cham: number[] = [];
  const skirt: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    top.push(push(cx * o.rIn, cy * o.rIn, o.hTop, 0, 0, 1, 0.5 + cx * uvIn, 0.5 + cy * uvIn));
    cham.push(push(cx * o.rOut, cy * o.rOut, o.hTop - o.drop, cx * o.tilt, cy * o.tilt, o.axial, 0.5 + cx * 0.5, 0.5 + cy * 0.5));
    skirt.push(push(cx * o.rOut, cy * o.rOut, 0, cx, cy, 0, 0.5 + cx * 0.5, 0.5 + cy * 0.5));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(centre, top[i]!, top[j]!);
    idx.push(top[i]!, cham[i]!, cham[j]!, top[i]!, cham[j]!, top[j]!);
    idx.push(cham[i]!, skirt[i]!, skirt[j]!, cham[i]!, skirt[j]!, cham[j]!);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Turn a shell inside out: reverse the winding and recompute the normals.
 *
 * A cylinder, a sphere or a lathe is built to be seen from OUTSIDE, and a bay,
 * a cabin, a tunnel or a dome interior is the same shell seen from within. The
 * lazy fix is `side: THREE.DoubleSide`, which is wrong twice: it doubles the
 * fragment cost of the surface and, because the normal still points away from
 * the viewer, it lights the interior with the exterior's shading — a bay whose
 * back wall is lit by a sun that is behind the camera.
 *
 * BOTH HALVES ARE REQUIRED AND THE SECOND IS THE ONE THAT GETS FORGOTTEN.
 * Reversing the index alone flips which faces survive culling and leaves every
 * normal pointing the wrong way, so the interior renders — and renders black.
 *
 * Indexed only. A non-indexed geometry has no winding to reverse without
 * rewriting every attribute, and a caller holding one wants `toNonIndexed`'s
 * inverse first; this throws rather than silently doing nothing to it.
 */
export function flipFaces(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const i = g.getIndex();
  if (!i) throw new Error('flipFaces: geometry has no index; there is no winding to reverse');
  for (let k = 0; k < i.count; k += 3) {
    const a = i.getX(k);
    i.setX(k, i.getX(k + 2));
    i.setX(k + 2, a);
  }
  i.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
