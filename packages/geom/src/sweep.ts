/**
 * ============================================================================
 *  sweepAlongZ — bend a straight-built geometry onto a curved path.
 * ============================================================================
 *  THIS IS THE 36.8 METRE BUG, AND IT IS THE REASON @homie-rocks/geom EXISTS.
 *
 *  A 240 m shell was once placed from ONE sampled frame at the midpoint of a
 *  272 m run round a 289 m-radius arc. The sagitta of that chord is 36.8 m:
 *  the wall stood on the running surface ten metres past the mouth and swept
 *  diagonally across to the far edge, and the first test drive went straight
 *  into it. The fix was what the track's own bore builder already did
 *  correctly — build ring by ring at the frame rather than placing a rigid
 *  body from one sample.
 *
 *  The same defect was later re-prevented by comment in another game, which
 *  copied the lesson into its own header by hand instead of sharing the code.
 *  That is what a missing shared package costs, and it is why this file is 90
 *  lines of explanation round 60 lines of arithmetic.
 *
 *  The type is named `SweepFrame`, not after anything it bends. A pressure bay
 *  is a building and this package does not know what one is; a game that wants
 *  its own name for this keeps it as a local alias.
 */
import * as THREE from 'three';

/**
 * The world frame of a swept cross-section at axial station `z`.
 *
 * The caller authors its geometry as a straight run along +Z and then, if a
 * sweep is supplied, bends the finished geometry through this function: the
 * station at `z` supplies the origin and the (x, y) basis every vertex at that
 * z is re-planted on. See `sweepAlongZ`.
 *
 * (The space racer this came from aliases it as the axis of a pressure bay.
 * The alias lives in the game; the name here may not.)
 */
export type SweepFrame = (z: number, out: THREE.Matrix4) => void;

const _swM = new THREE.Matrix4();

/**
 * Bend a straight-built geometry onto a swept path, consuming its local +Z.
 *
 * ===========================================================================
 *  THE BAY IS A TUBE ROUND A CURVED DECK, SO IT HAS TO BE SWEPT, NOT PLACED.
 * ===========================================================================
 *  A bay's shell used to be dropped in as one rigid 240 m cylinder off a
 *  single deck frame at the section midpoint, and that section is 272 m of a
 *  289 m-radius arc. A chord across that has a 36.8 m sagitta: the wall stood
 *  ON THE RUNNING SURFACE 10.9 m past the mouth and swept diagonally across to
 *  the port edge, which is the tunnel the first test drive went into. The
 *  track's bore builder had the right answer thirty lines away — build ring by
 *  ring at the deck frame — and this is that, applied to a geometry that is
 *  authored straight because everything on it (strake UVs, the 18 m flange
 *  module, the catwalk) is far easier to author straight.
 *
 *  Every vertex is re-planted: `p' = O(z) + X(z)·x + Y(z)·y`, with its normal
 *  rotated by the same basis. Local z is CONSUMED by the station lookup and is
 *  not re-added, which is what makes the residual zero by construction rather
 *  than small. Doing it as one total pass over the built attributes — rather
 *  than threading a matrix through forty emit sites — is deliberate: a missed
 *  emit site would leave one silent rigid part behind, and this cannot.
 *
 *  THE PRICE, AND THE TWO PIECES THAT HAVE TO PAY IT UP FRONT: a vertex only
 *  lands on the curve if it EXISTS. Anything spanning many metres of z with
 *  vertices only at its ends stays a straight chord between two correct
 *  points, which is the original bug in miniature. Both such pieces on this
 *  object — the longitudinal stringers and the equator handrail — are spliced
 *  below at a pitch whose sagitta is under 4 cm. Everything else is already
 *  dense in z (3 m shell rings, 9 m frame stations, 6 m conduit runs, 4 m
 *  catwalk plates) or lies in one z plane (ring tubes, splice plates, the
 *  ladder). Add nothing long here without splicing it.
 *
 *  Stations are sampled every `PITCH` metres and LERPED between, rather than
 *  resolved per vertex: the deck frame turns ~0.3° per metre here, so the
 *  interpolation error is microns, while a per-vertex `track.sample()` would
 *  be ~60 000 samples and an allocation each. The map stays C0 across the
 *  whole geometry, so nothing cracks at a station boundary.
 */
export function sweepAlongZ(geo: THREE.BufferGeometry, bend: SweepFrame) {
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const N = geo.getAttribute('normal') as THREE.BufferAttribute;
  const pa = P.array as Float32Array, na = N ? N.array as Float32Array : null;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < pa.length; i += 3) {
    if (pa[i] < zMin) zMin = pa[i];
    if (pa[i] > zMax) zMax = pa[i];
  }
  if (!(zMax >= zMin)) return;
  const PITCH = 1.5;
  const z0 = zMin - PITCH;
  const n = Math.ceil((zMax - z0) / PITCH) + 2;
  // 12 floats per station: basis X, basis Y, basis Z, origin
  const st = new Float64Array(n * 12);
  for (let k = 0; k < n; k++) {
    bend(z0 + k * PITCH, _swM);
    const e = _swM.elements, o = k * 12;
    st[o] = e[0]; st[o + 1] = e[1]; st[o + 2] = e[2];
    st[o + 3] = e[4]; st[o + 4] = e[5]; st[o + 5] = e[6];
    st[o + 6] = e[8]; st[o + 7] = e[9]; st[o + 8] = e[10];
    st[o + 9] = e[12]; st[o + 10] = e[13]; st[o + 11] = e[14];
  }
  for (let i = 0; i < pa.length; i += 3) {
    const x = pa[i], y = pa[i + 1], z = pa[i + 2];
    const f = (z - z0) / PITCH;
    let k = Math.floor(f);
    if (k < 0) k = 0; else if (k > n - 2) k = n - 2;
    const u = f - k;
    const a = k * 12, b = a + 12;
    // lerp the two stations' bases. 1.5 m apart on this arc they are 0.5°
    // apart, so the lerp stays orthonormal to ~1e-5 and the normals are
    // re-normalised below anyway.
    const xx = st[a] + (st[b] - st[a]) * u,
      xy = st[a + 1] + (st[b + 1] - st[a + 1]) * u,
      xz = st[a + 2] + (st[b + 2] - st[a + 2]) * u,
      yx = st[a + 3] + (st[b + 3] - st[a + 3]) * u,
      yy = st[a + 4] + (st[b + 4] - st[a + 4]) * u,
      yz = st[a + 5] + (st[b + 5] - st[a + 5]) * u,
      zx = st[a + 6] + (st[b + 6] - st[a + 6]) * u,
      zy = st[a + 7] + (st[b + 7] - st[a + 7]) * u,
      zz = st[a + 8] + (st[b + 8] - st[a + 8]) * u,
      ox = st[a + 9] + (st[b + 9] - st[a + 9]) * u,
      oy = st[a + 10] + (st[b + 10] - st[a + 10]) * u,
      oz = st[a + 11] + (st[b + 11] - st[a + 11]) * u;
    pa[i] = ox + xx * x + yx * y;
    pa[i + 1] = oy + xy * x + yy * y;
    pa[i + 2] = oz + xz * x + yz * y;
    if (na) {
      const nx = na[i], ny = na[i + 1], nz = na[i + 2];
      let wx = xx * nx + yx * ny + zx * nz,
        wy = xy * nx + yy * ny + zy * nz,
        wz = xz * nx + yz * ny + zz * nz;
      const l = Math.hypot(wx, wy, wz) || 1;
      wx /= l; wy /= l; wz /= l;
      na[i] = wx; na[i + 1] = wy; na[i + 2] = wz;
    }
  }
  P.needsUpdate = true;
  if (N) N.needsUpdate = true;
  geo.computeBoundingSphere();
}
