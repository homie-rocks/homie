/** Optional three.js bridge. The simulation modules never import a renderer. */
import {
  BufferGeometry,
  BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from "three";
import type { Shape } from "./Types.ts";
import type { PhysicsWorld } from "./World.ts";

/** Copy local-space geometry into a collider shape. Apply object transforms to
 * the body separately. Meshes are static-only; convex hulls can move. Throws for
 * missing xyz positions. Caller keeps ownership of the source geometry.
 */
export function geometryShape(
  geometry: BufferGeometry,
  kind: "mesh" | "convex" = "mesh",
): Shape {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3)
    throw new TypeError("physics: geometry needs xyz positions");
  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    vertices[i * 3] = position.getX(i);
    vertices[i * 3 + 1] = position.getY(i);
    vertices[i * 3 + 2] = position.getZ(i);
  }
  if (kind === "convex") return { kind, vertices };
  if (kind !== "mesh")
    throw new TypeError("physics: geometry kind must be mesh or convex");
  const index = geometry.getIndex();
  const indices = index
    ? Uint32Array.from(index.array)
    : Uint32Array.from({ length: position.count }, (_, i) => i);
  return { kind, vertices, indices };
}

/** Owned debug lines. Call update after stepping, and dispose when removed.
 * Positions use the world's axes; for Z-up set the rendering camera's up to Z.
 */
export class PhysicsDebug extends LineSegments<
  BufferGeometry,
  LineBasicMaterial
> {
  /** Allocate empty lines with per-vertex colours and no frustum culling. */
  constructor() {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, transparent: true }),
    );
    this.frustumCulled = false;
  }
  /** Replace line buffers from this world's current collision geometry. */
  update(world: PhysicsWorld): void {
    const { vertices, colors } = world.debugLines();
    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(vertices, 3));
    this.geometry.setAttribute("color", new BufferAttribute(colors, 4));
  }
  /** Release GPU buffers and material. Does not dispose the physics world. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
