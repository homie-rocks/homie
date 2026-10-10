/** Local convex queries avoid size-dependent GJK tolerances on broad boxes.
 * Meshes and heightfields stay in Rapier, retaining their acceleration trees. */
import type * as R from "@dimforge/rapier3d-deterministic";
import type { Vec3, Quat } from "../Types.ts";
import { add, sub, turn, multiply } from "./Character.ts";
import { queryRadius } from "./PendingIndex.ts";
export const MIN_SWEEP = 0.0001;
export const finiteVector = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
export function validateCharacterQuery(
  shape: R.Shape,
  p: Vec3,
  q: Quat,
  prediction: number,
): void {
  const geometry = shape as R.Ball | R.Capsule;
  if (
    !finiteVector(p) ||
    !finiteVector(q) ||
    !Number.isFinite(q.w) ||
    Math.abs(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w - 1) > 0.001 ||
    !Number.isFinite(prediction) ||
    prediction < 0 ||
    !Number.isFinite(geometry.radius) ||
    geometry.radius <= 0 ||
    ("halfHeight" in geometry &&
      (!Number.isFinite(geometry.halfHeight) || geometry.halfHeight < 0))
  )
    throw new RangeError("physics: invalid character query");
}
const inverse = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function localBox(
  r: typeof R,
  collider: R.Collider,
  shape: R.Shape,
  p: Vec3,
  v: Vec3 = { x: 0, y: 0, z: 0 },
  prediction = 0,
) {
  if (collider.shapeType() !== r.ShapeType.Cuboid) return null;
  const q = collider.rotation(),
    iq = inverse(q),
    origin = collider.translation();
  const a = turn(iq, sub(p, origin)),
    b = add(a, turn(iq, v));
  const dimensions = shape as R.Capsule;
  // Restored collider dimensions are float32. Match them before clipping so
  // freshly created and restored capsules choose identical local geometry.
  const reach =
    typeof dimensions.radius === "number"
      ? Math.fround(dimensions.radius) +
        Math.fround(dimensions.halfHeight ?? 0) +
        0.001
      : queryRadius(shape);
  const half = collider.halfExtents()!,
    radius = Math.ceil(reach * 1024) / 1024 + prediction + 1;
  const centre = { x: 0, y: 0, z: 0 },
    extent = { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"] as const) {
    const lo = Math.max(-half[axis], Math.min(a[axis], b[axis]) - radius);
    const hi = Math.min(half[axis], Math.max(a[axis], b[axis]) + radius);
    if (hi <= lo || (half[axis] >= MIN_SWEEP && hi - lo < MIN_SWEEP))
      return undefined;
    centre[axis] = (lo + hi) / 2;
    extent[axis] = (hi - lo) / 2;
  }
  return {
    shape: new r.Cuboid(extent.x, extent.y, extent.z),
    p: add(origin, turn(q, centre)),
    q,
  };
}
export function characterContact(
  r: typeof R,
  collider: R.Collider,
  shape: R.Shape,
  p: Vec3,
  q: Quat,
  prediction: number,
): R.ShapeContact | null {
  validateCharacterQuery(shape, p, q, prediction);
  const box = localBox(r, collider, shape, p, undefined, prediction);
  if (box === undefined) return null;
  return box
    ? box.shape.contactShape(box.p, box.q, shape, p, q, prediction)
    : collider.contactShape(shape, p, q, prediction);
}
export function posedContact(
  r: typeof R,
  collider: R.Collider,
  pose: Vec3,
  rotation: Quat,
  shape: R.Shape,
  p: Vec3,
  q: Quat,
  prediction: number,
): R.ShapeContact | null {
  const old = collider.rotation(),
    relative = multiply(old, inverse(rotation));
  const mapped = add(collider.translation(), turn(relative, sub(p, pose)));
  const result = characterContact(
    r,
    collider,
    shape,
    mapped,
    multiply(relative, q),
    prediction,
  );
  if (!result) return null;
  const forward = inverse(relative);
  result.normal1 = turn(forward, result.normal1);
  result.normal2 = turn(forward, result.normal2);
  result.point1 = add(
    pose,
    turn(forward, sub(result.point1, collider.translation())),
  );
  result.point2 = add(
    pose,
    turn(forward, sub(result.point2, collider.translation())),
  );
  return result;
}
