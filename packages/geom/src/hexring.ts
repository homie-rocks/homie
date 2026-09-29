/**
 * ============================================================================
 *  hexring — a chamfered hexagonal frame, and the merge that assembles it
 * ============================================================================
 *  A hexagon of square-ish section lying in XY and extruded along Z, with every
 *  corner of the section chamfered, an optional recessed light channel cut into
 *  the back face, arc-length UVs, and an `aBand` attribute carrying the
 *  channel's emissive weight. Plus `mergeParts` — concatenate transformed
 *  geometries into one indexed position/normal/uv buffer.
 *
 *  Not `mergeGeos` (route.ts): that one takes bare geometries and this one
 *  takes geometry-plus-matrix pairs, so the transform and its normal matrix are
 *  applied per part. Two different jobs, kept apart on purpose.
 *
 *  NOTHING HERE CARRIES A LOOK. The chamfer, the channel depths, the band
 *  weights and the stretch are all arguments. A game that wants a frame binds
 *  its own numbers at the call site; the package owns the profile walk, the
 *  normals, the seam and the degenerate-quad skip, and nothing else.
 */
import * as THREE from 'three';

/**
 * A recessed light channel cut into the ring's BACK face (-z) — the face a
 * body approaching the ring head-on actually sees.
 *
 * `depth` is how far the groove is cut into the face along Z, `lip` the flat
 * bezel left either side of it, and `wall` the RADIAL length of the slanted
 * step from the lip down to the channel floor.
 *
 * `edge` and `mid` are the floor's BAND profile as a fraction of whatever
 * emissive tier the instance carries — a tent rather than a plateau, and the
 * caller's numbers rather than ours. The reason a tent is wanted at all is
 * grading, not geometry: a strip held at one flat high value is a strip that
 * cannot be its own hue anywhere, because the highlight rolloff takes it to
 * white. A hot filament down the centre with a cooler wash either side is both
 * what a recessed luminaire looks like and what keeps the colour. Those are the
 * two numbers that decide where the wash lands, so they are the caller's.
 */
export interface HexChannel {
  depth: number;
  lip: number;
  wall: number;
  /** band weight at the two floor stations either side of the filament */
  edge: number;
  /** band weight at the two stations between those and the filament */
  mid: number;
}

/**
 * Where each facet of the section lands in u, so a caller painting a texture
 * for it can put its detail on the face it belongs to instead of guessing.
 * Every span is [start, end] in texture u. `floor` is degenerate when the
 * section has no channel.
 */
export interface HexFaces {
  outer: [number, number];
  front: [number, number];
  inner: [number, number];
  back: [number, number];
  floor: [number, number];
}

interface HexStation {
  dr: number; dz: number;
  /** authored section normal in the same (radial, z) plane */
  nr: number; nz: number;
  /** emissive band weight, 0 everywhere that is not the channel floor */
  band: number;
  /** normalised arc length around the section — the texture's u */
  u: number;
}

/**
 * The section profile, walked once as a loop and shared by `hexRing` and
 * `hexRingU` so the geometry and the texture painted onto it cannot disagree.
 *
 * TWO THINGS HERE ARE FIXES FOR REAL FINDINGS AND BOTH LOOK LIKE PEDANTRY
 * UNTIL YOU SEE WHAT THEY COST.
 *
 * **Every facet gets its own pair of stations.** The old profile had one
 * station per corner, shared between the face and the chamfer either side of
 * it, so no face in the section carried its own true normal: the front face —
 * the widest one, the one seen head-on — was shaded with normals leaning 29 deg
 * off its actual facing, blended smoothly into both chamfers. A face that never
 * faces the key cannot catch the key, and the frame rendered as a flat pale
 * outline with no lit side, no dark side and no specular line anywhere.
 *
 * The corners are now four stations each: the face ends on its own flat normal,
 * the chamfer sweeps 22.5 deg -> 67.5 deg across itself, and the next face
 * starts on ITS own flat normal. The faces shade flat and correct; the chamfer
 * sweeps through the mirror angle, so under a grazing key there is always a
 * sliver of it lit — a continuous specular line along the silhouette.
 *
 * **u is arc length, and the loop is not closed by a modulo.** The old profile
 * indexed `(i + 1) % ns` for the last quad, so that quad's u ran 0.875 -> 0.0
 * BACKWARDS and, under `RepeatWrapping`, replayed the entire texture — the
 * emissive band included — across the back-outer chamfer of every instance. The
 * section now ends on a duplicate of station 0 at u = 1. Arc-length u on top of
 * that gives every facet texture space in proportion to its real width.
 */
function hexSection(
  bar: number, depth: number, cham: number, channel?: HexChannel,
): { st: HexStation[]; faces: HexFaces } {
  const half = bar * 0.5;
  const hz = depth * 0.5;
  const c = Math.min(cham, half * 0.45, hz * 0.45);
  const st: HexStation[] = [];
  const put = (dr: number, dz: number, deg: number, band = 0) => {
    const a = deg * Math.PI / 180;
    st.push({ dr, dz, nr: Math.cos(a), nz: Math.sin(a), band, u: 0 });
  };
  // Station indices are collected first and turned into u spans once the arc
  // length is known. 0 deg is radially outward, 90 deg is +z.
  const idxOuter = st.length;
  put(half, -hz + c, 0); put(half, hz - c, 0);
  const idxOuterEnd = st.length - 1;
  put(half, hz - c, 22.5); put(half - c, hz, 67.5);
  const idxFront = st.length;
  put(half - c, hz, 90); put(-half + c, hz, 90);
  const idxFrontEnd = st.length - 1;
  put(-half + c, hz, 112.5); put(-half, hz - c, 157.5);

  // The bore. Plain machined face — see the note below for why the light is
  // NOT in here.
  const idxInner = st.length;
  put(-half, hz - c, 180); put(-half, -hz + c, 180);
  const idxInnerEnd = st.length - 1;

  put(-half, -hz + c, 202.5); put(-half + c, -hz, 247.5);

  // -------------------------------------------------------------------------
  //  THE HOUSING IS ON THE BACK FACE, AND THAT WAS A FINDING
  // -------------------------------------------------------------------------
  //  It was on the INNER face — radially inward, into the bore — and the whole
  //  argument written for it (the occlusion angle, the window in which a racer
  //  is choosing an aperture) describes a strip that faces the approach. A
  //  bore-facing strip does the exact opposite, and the arithmetic is not
  //  close. Emissive is view-independent in three, so what is lost is not
  //  shading, it is PROJECTED AREA: a frame 38 m ahead and 7 m off the
  //  centreline is seen 10 deg off axis, which leaves sin(10 deg) = 0.18 of the
  //  strip's width, and one dead ahead leaves about 0.03 of it. The captures
  //  showed one lit upright per frame and no hexagon at all.
  //
  //  Turned to face the approach, the same strip presents its full width from
  //  everywhere in the cone. BACK rather than front because the extrusion runs
  //  downstream: -z is the face something coming up on the row sees.
  //
  //  The housing keeps its shape, its lip-over-depth occlusion angle and its
  //  tent; only its width is re-cut, because the back face's flat is the bar
  //  rather than the depth.
  const idxBack = st.length;
  let idxFloor = st.length, idxFloorEnd = st.length - 1;
  if (!channel) {
    put(-half + c, -hz, 270); put(half - c, -hz, 270);
  } else {
    // The groove is only cut if there is room for a floor between the two lips;
    // a caller that asks for more housing than the section has just gets the
    // plain back face back rather than an inside-out one.
    const lip = Math.max(0, channel.lip);
    const wall = Math.max(0, channel.wall);
    const f = half - c - lip - wall;
    const d = Math.max(0, Math.min(channel.depth, depth * 0.4));
    if (f <= 1e-4 || d <= 1e-4) {
      put(-half + c, -hz, 270); put(half - c, -hz, 270);
    } else {
      // The step's tilt off the back face. A groove with vertical walls is a
      // groove with two hard 90 deg edges in it and no way for the key to find
      // the housing at all.
      const tilt = Math.atan2(d, wall) * 180 / Math.PI;
      put(-half + c, -hz, 270); put(-f - wall, -hz, 270);              // outer lip
      put(-f - wall, -hz, 270 + tilt); put(-f, -hz + d, 270 + tilt);
      idxFloor = st.length;
      put(-f, -hz + d, 270, channel.edge);
      put(-f * 0.4, -hz + d, 270, channel.mid);
      put(0, -hz + d, 270, 1);
      put(f * 0.4, -hz + d, 270, channel.mid);
      put(f, -hz + d, 270, channel.edge);
      idxFloorEnd = st.length - 1;
      put(f, -hz + d, 270 - tilt); put(f + wall, -hz, 270 - tilt);
      put(f + wall, -hz, 270); put(half - c, -hz, 270);                // inner lip
    }
  }
  const idxBackEnd = st.length - 1;
  put(half - c, -hz, 292.5); put(half, -hz + c, 337.5);
  // The seam. A duplicate of station 0 at u = 1 rather than a wrap; see above.
  put(half, -hz + c, 0);

  let run = 0;
  for (let i = 1; i < st.length; i++) {
    run += Math.hypot(st[i].dr - st[i - 1].dr, st[i].dz - st[i - 1].dz);
    st[i].u = run;
  }
  const total = run || 1;
  for (const s of st) s.u /= total;
  const at = (a: number, b: number): [number, number] => [st[a].u, st[b].u];
  const faces: HexFaces = {
    outer: at(idxOuter, idxOuterEnd),
    front: at(idxFront, idxFrontEnd),
    inner: at(idxInner, idxInnerEnd),
    back: at(idxBack, idxBackEnd),
    floor: idxFloorEnd >= idxFloor ? at(idxFloor, idxFloorEnd) : [0, 0],
  };
  return { st, faces };
}

/**
 * Where the section's facets land in u, for a caller painting its textures.
 * Same arguments as `hexRing` minus the ones that only move geometry.
 */
export function hexRingU(
  bar: number, depth: number, cham: number, channel?: HexChannel,
): HexFaces {
  return hexSection(bar, depth, cham, channel).faces;
}

/**
 * A hexagonal ring of square-ish section, lying in XY and extruded along Z.
 *
 * Every corner of the section is chamfered by `cham`: a large frame seen
 * against a dark sky is nothing but its own silhouette and its own specular
 * line, and an unchamfered extrusion has no specular line at all.
 *
 * `outer` is the circumradius of the hexagon, `bar` the section width, `depth`
 * the extrusion along Z, `sy` a vertical stretch applied to the RING STATIONS
 * with the normals corrected for it, and `channel` an optional recessed light
 * housing cut into the BACK face (-z).
 *
 * The stretch is a parameter rather than a non-uniform instance scale because
 * three's instancing chunk transforms normals by `mat3(instanceMatrix)`, which
 * is only correct under a uniform scale. On a chamfered frame the error is not
 * subtle: it is the difference between a specular line on every edge under a
 * grazing key and no specular line anywhere.
 *
 * The geometry carries an `aBand` attribute: the emissive weight of the channel
 * floor, 0 everywhere else. A VERTEX attribute rather than a stripe in the
 * emissive map, so one map serves every size of frame.
 */
export function hexRing(
  outer: number, bar: number, depth: number, cham: number, sy = 1,
  channel?: HexChannel,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const bnd: number[] = [];
  const idx: number[] = [];
  const inner = outer - bar;
  const { st } = hexSection(bar, depth, cham, channel);
  const ns = st.length;
  const rings = 6;
  const mid = (outer + inner) * 0.5;
  for (let j = 0; j <= rings; j++) {
    // The hexagon's vertices are the ring stations. The +0.5 turn puts a vertex
    // at top and bottom and a FLAT VERTICAL SIDE either hand, which is what an
    // aperture wants: the flats sit alongside the next frame in a row, so a row
    // reads as a bank of apertures rather than a fence of separate objects, and
    // the vertical extent is unbroken by a bar across the middle of the
    // sightline. It also means `outer` relates to the width by 2*cos(30 deg)
    // rather than 2 — which the caller has to know.
    const a = ((j % rings) + 0.5) / rings * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    for (let i = 0; i < ns; i++) {
      const s = st[i];
      pos.push(cx * (mid + s.dr), cy * (mid + s.dr) * sy, s.dz);
      // Inverse-transpose of the stretch: a y-scale of `sy` on positions is a
      // y-scale of 1/sy on normals, renormalised.
      const nx = cx * s.nr, ny = (cy * s.nr) / sy, nzz = s.nz;
      const l = Math.hypot(nx, ny, nzz) || 1;
      nrm.push(nx / l, ny / l, nzz / l);
      uv.push(s.u, j / rings);
      bnd.push(s.band);
    }
  }
  // Every hard normal break in the section is two stations at ONE position, so
  // the quad between them has no area. Skipping those is 12 quads of 27 on a
  // channelled profile — the vertices still have to exist (that is what makes
  // the break hard) but the triangles do not, and a degenerate triangle still
  // costs setup on every instance.
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < ns - 1; i++) {
      if (st[i].dr === st[i + 1].dr && st[i].dz === st[i + 1].dz) continue;
      const a0 = j * ns + i;
      const a1 = a0 + 1;
      const b0 = a0 + ns;
      const b1 = a1 + ns;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aBand', new THREE.Float32BufferAttribute(bnd, 1));
  g.setIndex(idx);
  return g;
}

/**
 * Concatenate transformed geometries into one buffer.
 *
 * `three/examples/jsm/utils/BufferGeometryUtils` would do this, but every
 * source that reaches here is indexed with position/normal/uv and nothing else,
 * so the general version's attribute reconciliation is dead weight — and this
 * keeps a game's item art free of an examples-directory import.
 */
export function mergeParts(
  parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const part of parts) {
    const g = part.geo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const t = g.attributes.uv as THREE.BufferAttribute | undefined;
    const base = pos.length / 3;
    nm.getNormalMatrix(part.m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      nrm.push(v.x, v.y, v.z);
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
