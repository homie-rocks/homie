/** Validation before a malformed shape reaches WASM. */
import { keys } from "./internal/Validate.ts";
import { engine } from "./internal/Engine.ts";
import type { ColliderDesc } from "@dimforge/rapier3d-deterministic";
import type { Layers, Quat, Shape, Vec3 } from "./Types.ts";
export const ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const IDENTITY: Readonly<Quat> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});
export function finite(n: number, name: string): number {
  if (!Number.isFinite(n) || Math.abs(n) > 1e6)
    throw new RangeError(
      `physics: ${name} must be finite and within +/-1000000`,
    );
  return n === 0 ? 0 : n;
}
export function positive(n: number, name: string, zero = false): number {
  finite(n, name);
  if (zero ? n < 0 || (n > 0 && n < 1e-6) : n < 1e-6)
    throw new RangeError(
      `physics: ${name} must be ${zero ? "nonnegative" : "positive"}`,
    );
  return n;
}
export function vector(v: Vec3, quaternion = false): Vec3 {
  if (!v || typeof v !== "object")
    throw new TypeError("physics: expected an xyz vector");
  keys(v, quaternion ? "x y z w" : "x y z", "vector");
  return { x: finite(v.x, "x"), y: finite(v.y, "y"), z: finite(v.z, "z") };
}
export function rotation(q: Quat): Quat {
  const v = vector(q, true);
  const w = finite(q.w, "w");
  const n = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + w * w);
  if (Math.abs(n - 1) > 1e-5)
    throw new RangeError("physics: rotation must be a unit quaternion");
  return { ...v, w };
}
export function groups(l?: Layers): number {
  if (!l) return 0xffffffff;
  keys(l, "membership filter", "layers");
  for (const n of [l.membership, l.filter])
    if (!Number.isInteger(n) || n < 0 || n > 65535)
      throw new RangeError("physics: layers are 16-bit masks");
  return ((l.membership << 16) | l.filter) >>> 0;
}
export function descriptor(s: Shape, r = engine()): ColliderDesc {
  const fields: Record<string, string> = {
    box: "halfExtents",
    sphere: "radius",
    capsule: "radius halfHeight",
    convex: "vertices",
    mesh: "vertices indices",
    heightfield: "rows columns heights scale",
  };
  if (!s || !Object.hasOwn(fields, s.kind))
    throw new TypeError("physics: unknown shape kind");
  keys(s, "kind " + fields[s.kind], "shape");
  switch (s.kind) {
    case "box": {
      const h = vector(s.halfExtents);
      return r.ColliderDesc.cuboid(
        positive(h.x, "halfExtents.x"),
        positive(h.y, "halfExtents.y"),
        positive(h.z, "halfExtents.z"),
      );
    }
    case "sphere":
      return r.ColliderDesc.ball(positive(s.radius, "radius"));
    case "capsule":
      return r.ColliderDesc.capsule(
        positive(s.halfHeight, "halfHeight", true),
        positive(s.radius, "radius"),
      );
    case "convex":
    case "mesh": {
      if (
        !(s.vertices instanceof Float32Array) ||
        s.vertices.length % 3 ||
        s.vertices.length < (s.kind === "convex" ? 12 : 9)
      )
        throw new RangeError(
          "physics: vertices must contain complete xyz triples",
        );
      for (const n of s.vertices) finite(n, "vertex");
      if (s.kind === "convex") {
        const a = s.vertices,
          n = a.length;
        let b = -1,
          c = -1,
          nx = 0,
          ny = 0,
          nz = 0;
        for (let i = 3; i < n; i += 3) {
          if (a[i] !== a[0] || a[i + 1] !== a[1] || a[i + 2] !== a[2]) {
            b = i;
            break;
          }
        }
        if (b >= 0)
          for (let i = b + 3; i < n; i += 3) {
            const ux = a[b]! - a[0]!,
              uy = a[b + 1]! - a[1]!,
              uz = a[b + 2]! - a[2]!;
            const vx = a[i]! - a[0]!,
              vy = a[i + 1]! - a[1]!,
              vz = a[i + 2]! - a[2]!;
            nx = uy * vz - uz * vy;
            ny = uz * vx - ux * vz;
            nz = ux * vy - uy * vx;
            if (nx * nx + ny * ny + nz * nz > 1e-16) {
              c = i;
              break;
            }
          }
        let volume = false;
        if (c >= 0)
          for (let i = 3; i < n; i += 3) {
            if (
              Math.abs(
                nx * (a[i]! - a[0]!) +
                  ny * (a[i + 1]! - a[1]!) +
                  nz * (a[i + 2]! - a[2]!),
              ) > 1e-12
            ) {
              volume = true;
              break;
            }
          }
        if (!volume)
          throw new RangeError("physics: convex hull needs noncoplanar points");
        const d = r.ColliderDesc.convexHull(s.vertices);
        if (!d || !d.shape)
          throw new RangeError("physics: convex hull needs noncoplanar points");
        return d;
      }
      if (
        !(s.indices instanceof Uint32Array) ||
        !s.indices.length ||
        s.indices.length % 3
      )
        throw new RangeError("physics: indices must contain triangles");
      for (const n of s.indices)
        if (n >= s.vertices.length / 3)
          throw new RangeError("physics: triangle index out of range");
      return r.ColliderDesc.trimesh(s.vertices, s.indices);
    }
    case "heightfield": {
      for (const n of [s.rows, s.columns])
        if (!Number.isInteger(n) || n < 1)
          throw new RangeError("physics: heightfield dimensions count cells");
      if (
        !(s.heights instanceof Float32Array) ||
        s.heights.length !== (s.rows + 1) * (s.columns + 1)
      )
        throw new RangeError(
          "physics: heightfield sample count does not match",
        );
      for (const h of s.heights) finite(h, "height");
      const v = vector(s.scale);
      positive(v.x, "scale.x");
      positive(v.y, "scale.y");
      positive(v.z, "scale.z");
      return r.ColliderDesc.heightfield(s.rows, s.columns, s.heights, v);
    }
    default:
      throw new TypeError("physics: unknown shape kind");
  }
}
