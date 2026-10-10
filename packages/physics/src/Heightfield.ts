/** Adapt Homie's X-fast rows to Rapier's Z-fast columns, once at creation. */
import type {
  HeightField,
  CentredGrid,
} from "@homie-rocks/heightfield/Field.js";
import type { MeshBake } from "@homie-rocks/heightfield/MeshBake.js";
import type { ColliderOptions } from "./Types.ts";
import { finite, positive } from "./Shapes.ts";
/** Canonical terrain grid. The world's up option maps the second ground axis. */
export interface GridData {
  /** Number of X samples, at least two. */
  nx: number;
  /** Number of samples on the second ground axis, at least two. */
  nz: number;
  /** Distance between adjacent samples, in metres. */
  cell: number;
  /** X coordinate of the first sample. */
  x0: number;
  /** Second horizontal coordinate of the first sample (Z for Y-up, Y for Z-up). */
  z0: number;
  /** nx*nz heights in metres, ordered by the supplied layout. */
  heights: Float32Array;
}
/** Accepts MeshBake directly. Native Z-fast data avoids the JS transpose copy. */
export function heightfieldGrid(
  g: GridData | MeshBake,
  layout: "x-fast" | "z-fast" = "x-fast",
  up?: "y" | "z",
): ColliderOptions {
  if (
    ![g.nx, g.nz].every((n) => Number.isInteger(n) && n >= 2) ||
    g.heights.length !== g.nx * g.nz
  )
    throw new RangeError("physics: grid dimensions do not match heights");
  positive(g.cell, "cell");
  finite(g.x0, "x0");
  finite(g.z0, "z0");
  const heights =
    layout === "z-fast" ? g.heights : new Float32Array(g.heights.length);
  if (layout === "x-fast")
    for (let z = 0; z < g.nz; z++)
      for (let x = 0; x < g.nx; x++)
        heights[x * g.nz + z] = g.heights[z * g.nx + x]!;
  const width = (g.nx - 1) * g.cell,
    depth = (g.nz - 1) * g.cell;
  return {
    shape: {
      kind: "heightfield",
      rows: g.nz - 1,
      columns: g.nx - 1,
      heights,
      scale: { x: width, y: 1, z: depth },
    },
    gridPosition:
      up === undefined
        ? { x: g.x0 + width / 2, z: g.z0 + depth / 2 }
        : undefined,
    position:
      up === undefined
        ? undefined
        : up === "y"
          ? { x: g.x0 + width / 2, y: 0, z: g.z0 + depth / 2 }
          : { x: g.x0 + width / 2, y: g.z0 + depth / 2, z: 0 },
  };
}
/** Adapt a centred square grid, with X-fast input samples. World up is applied at insertion. */
export function centredHeightfield(
  grid: CentredGrid,
  heights: Float32Array,
  up?: "y" | "z",
): ColliderOptions {
  return heightfieldGrid(
    {
      nx: grid.n,
      nz: grid.n,
      cell: grid.step,
      x0: -grid.half,
      z0: -grid.half,
      heights,
    },
    "x-fast",
    up,
  );
}
/** A HeightField has only a sampler, so sampling a bounded grid is unavoidable. */
export function sampleHeightfield(
  field: HeightField,
  grid: Omit<GridData, "heights">,
  up?: "y" | "z",
): ColliderOptions {
  if (![grid.nx, grid.nz].every((n) => Number.isInteger(n) && n >= 2))
    throw new RangeError("physics: grid dimensions must be at least two");
  positive(grid.cell, "cell");
  const heights = new Float32Array(grid.nx * grid.nz);
  for (let x = 0; x < grid.nx; x++)
    for (let z = 0; z < grid.nz; z++)
      heights[x * grid.nz + z] = finite(
        field.heightAt(grid.x0 + x * grid.cell, grid.z0 + z * grid.cell),
        "height",
      );
  return heightfieldGrid({ ...grid, heights }, "z-fast", up);
}
