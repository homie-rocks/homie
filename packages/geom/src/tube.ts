/**
 * ============================================================================
 *  Tubes and bolt rings — structure you can see the edges of.
 * ============================================================================
 *  A chamfered tube between two points, and a ring of proud bolt heads. Both
 *  emit straight into a `GeoAccum` rather than returning geometry, because a
 *  4,800-instance truss cannot afford a BufferGeometry per chord.
 *
 *  FROM ONE GAME ONLY — the space racer; the kart racer has no equivalent, so
 *  this half of the package has one consumer and says so rather than implying
 *  two. The defaults (`sides = 6`, `head = 0.055`, `chamfer = r * 0.28`) are
 *  the ones that game measured against a 0.18° key light at 6.5° of
 *  elevation, and they are carried across verbatim because changing a default
 *  IS a behaviour change. A second consumer with a different key should pass
 *  its own numbers, not inherit these: a measured constant must not quietly
 *  become everybody's default.
 */
import * as THREE from 'three';
import { GeoAccum } from './accum.ts';

const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _tz = new THREE.Vector3();
const _tx = new THREE.Vector3();
const _ty = new THREE.Vector3();
const _tup = new THREE.Vector3(0, 1, 0);
const _talt = new THREE.Vector3(1, 0, 0);

/**
 * A structural tube between two points, with a chamfered end at each.
 *
 * The chamfer is not decoration. The art rules this was built under make a hard
 * 90° unchamfered edge an automatic fail, and it is worse here than in a normal
 * game: the key is a
 * 0.18° source at 6.5° of elevation, so a chamfer is often the ONLY facet on a
 * vertical tube whose normal points anywhere near the star. A 25 mm chamfer on
 * a 0.9 m chord is what puts a specular line down a truss that would otherwise
 * be a silhouette.
 *
 * `sides` is the radial segment count: 8 for a 0.9 m chord seen at 20 m, 5 for
 * a 0.34 m diagonal, 4 for anything past 200 m. Draw calls are the constraint,
 * not triangles, but a 4,800-instance truss still has to be honest about this.
 */
export function tubeInto(
  acc: GeoAccum, m: THREE.Matrix4,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  r: number, sides = 6, tint?: THREE.Color, chamfer = -1,
) {
  _ta.set(ax, ay, az); _tb.set(bx, by, bz);
  const len = _ta.distanceTo(_tb);
  if (len < 1e-4) return;
  const ch = chamfer < 0 ? Math.min(r * 0.28, len * 0.08) : chamfer;
  _tz.subVectors(_tb, _ta).divideScalar(len);
  // A tube pointing straight up has no unique "right"; pick an axis that is
  // not parallel to it rather than letting the cross product collapse.
  const ref = Math.abs(_tz.y) > 0.97 ? _talt : _tup;
  _tx.crossVectors(ref, _tz).normalize();
  _ty.crossVectors(_tz, _tx);

  const g = new THREE.BufferGeometry();
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [];
  // four rings: end chamfer, body, body, end chamfer
  const zs = [0, ch, len - ch, len];
  const rs = [r * 0.72, r, r, r * 0.72];
  for (let k = 0; k < 4; k++) {
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      const nx = _tx.x * cx + _ty.x * cy, ny = _tx.y * cx + _ty.y * cy, nz = _tx.z * cx + _ty.z * cy;
      P.push(
        ax + _tz.x * zs[k] + nx * rs[k],
        ay + _tz.y * zs[k] + ny * rs[k],
        az + _tz.z * zs[k] + nz * rs[k],
      );
      N.push(nx, ny, nz);
      // UV in world metres so a 0.9 m chord and a 0.34 m diagonal show the same
      // grain density and never betray the instancing
      UV.push((s / sides) * Math.PI * 2 * r, zs[k]);
    }
  }
  const w = sides + 1;
  for (let k = 0; k < 3; k++) {
    for (let s = 0; s < sides; s++) {
      const a = k * w + s, b = a + 1, c = a + w, d = c + 1;
      I.push(a, c, b, b, c, d);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  acc.add(g, m, tint);
  g.dispose();
}

/**
 * A ring of proud bolt heads at radius `r` — the universal "this is bolted"
 * mark, and the cheapest one available.
 *
 * `count` heads at 12 mm proud, on a flange. It reads at 25 m under a raking
 * key and it disappears cleanly by LOD1, which is exactly what a fastener
 * should do.
 */
export function boltRingInto(
  acc: GeoAccum, m: THREE.Matrix4,
  cx: number, cy: number, cz: number, nx: number, ny: number, nz: number,
  r: number, count = 8, head = 0.055, tint?: THREE.Color,
) {
  _tz.set(nx, ny, nz).normalize();
  const ref = Math.abs(_tz.y) > 0.97 ? _talt : _tup;
  _tx.crossVectors(ref, _tz).normalize();
  _ty.crossVectors(_tz, _tx);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const px = cx + (_tx.x * Math.cos(a) + _ty.x * Math.sin(a)) * r;
    const py = cy + (_tx.y * Math.cos(a) + _ty.y * Math.sin(a)) * r;
    const pz = cz + (_tx.z * Math.cos(a) + _ty.z * Math.sin(a)) * r;
    tubeInto(acc, m, px, py, pz,
      px + _tz.x * head * 0.6, py + _tz.y * head * 0.6, pz + _tz.z * head * 0.6,
      head, 5, tint, head * 0.35);
  }
}
