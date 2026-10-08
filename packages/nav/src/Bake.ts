/** Recast's voxel pipeline, one independently buildable tile with a geometry halo. */
import * as nav from 'navcat';
import type { HeightField } from '@homie-rocks/heightfield/Field.js';
import { encodeTile, finishTile, type TileData } from './internal/Tile.ts';
import { deterministicCos, deterministicSin } from './internal/Math.ts';
import { axes, fromAxes, vector, point, positive, type Point, type Up } from './Query.ts';
export interface Triangles {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
}
export interface BakeConfig {
  origin: Point;
  up?: Up;
  /** Keep packed spans only for tiles that will be carved. Default false. */
  retainSpans?: boolean;
  minRegionCells?: number;
  mergeRegionCells?: number;
  /** Split these regions into separate polygons for cheap runtime doors. */
  doorRegions?: readonly Obstacle[];
  /** Global vertical bounds, shared by every tile, in world metres. */
  minY: number;
  maxY: number;
  cellSize: number;
  cellHeight: number;
  tileCells: number;
  radius: number;
  height: number;
  stepHeight: number;
  slopeDegrees: number;
}
export interface Obstacle {
  min: Point;
  max: Point;
  radius?: number;
}
export function checkConfig(c: BakeConfig): void {
  point(c.origin);
  for (const region of c.doorRegions ?? []) checkObstacle(region);
  for (const count of [c.minRegionCells, c.mergeRegionCells])
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new Error('nav: region sizes must be nonnegative integers');
  if (c.retainSpans !== undefined && typeof c.retainSpans !== 'boolean')
    throw new Error('nav: retainSpans must be boolean');
  if (c.up !== undefined && c.up !== 'y' && c.up !== 'z') throw new Error('nav: up must be y or z');
  for (const k of ['cellSize', 'cellHeight', 'height'] as const) positive(c[k], k);
  if (!Number.isInteger(c.tileCells) || c.tileCells < 4 || c.tileCells > 1024)
    throw new Error('nav: tileCells must be an integer from 4 to 1024');
  if (
    ![c.minY, c.maxY, c.radius, c.stepHeight, c.slopeDegrees].every(Number.isFinite) ||
    c.maxY <= c.minY ||
    c.radius < 0 ||
    c.stepHeight < 0 ||
    c.stepHeight >= c.height ||
    c.slopeDegrees < 0 ||
    c.slopeDegrees >= 90
  )
    throw new Error('nav: invalid agent or vertical bounds');
  const angle = c.slopeDegrees * (Math.PI / 180);
  const rise = c.cellSize * deterministicSin(angle) / deterministicCos(angle);
  if (Math.ceil(rise / c.cellHeight - 1e-9) > Math.floor(c.stepHeight / c.cellHeight + 1e-9))
    throw new Error('nav: slope cannot be honoured at this cell size, cell height and step height; reduce cellSize/cellHeight or increase stepHeight');
  if ((c.maxY - c.minY) / c.cellHeight > 65535)
    throw new Error('nav: vertical bounds exceed voxel range');
  if (c.tileCells + 2 * (Math.ceil(c.radius / c.cellSize) + 3) > 2048)
    throw new Error('nav: tile halo too large');
}
export function checkObstacle(o: Obstacle): void {
  if (o.radius !== undefined) positive(o.radius, 'cylinder radius');
  point(o.min);
  point(o.max);
  if (vector(o.min).some((v, i) => v >= o.max[i]!))
    throw new Error('nav: obstacle bounds must have positive volume');
}
/** Bake one tile; triangles must include the radius + three-cell halo on every side. */
export function bakeTile(input: Triangles, config: BakeConfig, x: number, z: number): Uint8Array {
  checkConfig(config);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z))
    throw new Error('nav: tile coordinates must be integers');
  // Copy before suppressing upstream profiling: no caller callback runs in that scope.
  const positions = Float64Array.from(input.positions);
  const indices = input.indices
    ? Uint32Array.from(input.indices)
    : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  if (positions.length % 3 || indices.length % 3 || !positions.every(Number.isFinite))
    throw new Error('nav: malformed triangles');
  if (
    input.indices &&
    Array.from(input.indices).some(
      (i) => !Number.isInteger(i) || i < 0 || i >= positions.length / 3,
    )
  )
    throw new Error('nav: invalid triangle index');
  if (config.up === 'z') {
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1]!;
      positions[i + 1] = positions[i + 2]!;
      positions[i + 2] = -y;
    }

  }
  const c = { ...config, origin: axes(config.origin, config.up) },
    border = Math.ceil(c.radius / c.cellSize) + 3,
    size = c.tileCells * c.cellSize;
  const bounds: [number, number, number, number, number, number] = [
    c.origin[0] + x * size - border * c.cellSize,
    c.minY,
    c.origin[2] + z * size - border * c.cellSize,
    c.origin[0] + (x + 1) * size + border * c.cellSize,
    c.maxY,
    c.origin[2] + (z + 1) * size + border * c.cellSize,
  ];
  const hf = nav.createHeightfield(
    c.tileCells + border * 2,
    c.tileCells + border * 2,
    bounds,
    c.cellSize,
    c.cellHeight,
  );
  const areas = new Uint8Array(indices.length / 3);
  const threshold = deterministicCos(c.slopeDegrees * (Math.PI / 180));
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3,
      b = indices[i + 1]! * 3,
      d = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!,
      uy = positions[b + 1]! - positions[a + 1]!,
      uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[d]! - positions[a]!,
      vy = positions[d + 1]! - positions[a + 1]!,
      vz = positions[d + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    if (ny >= threshold * Math.sqrt(nx * nx + ny * ny + nz * nz)) areas[i / 3] = nav.WALKABLE_AREA;
  }
  const ctx = nav.BuildContext.create(),
    climb = Math.floor(c.stepHeight / c.cellHeight + 1e-9),
    height = Math.ceil(c.height / c.cellHeight);
  // navcat 0.4.1's only rasterizer clock reads are these two profiling hooks.
  // The call is synchronous, has no external callbacks, and restores even on error.
  // The runtime clock-throwing test guards this version-specific workaround.
  const start = nav.BuildContext.start,
    end = nav.BuildContext.end;
  try {
    nav.BuildContext.start = () => {};
    nav.BuildContext.end = () => {};
    if (!nav.rasterizeTriangles(ctx, hf, positions, indices, areas, climb))
      throw new Error('nav: rasterization failed');
  } finally {
    nav.BuildContext.start = start;
    nav.BuildContext.end = end;
  }
  nav.filterLowHangingWalkableObstacles(hf, climb);
  // The ledge filter compares the complete range of neighbouring spans.
  // A slope can cover two cells plus one rounding voxel, independently of
  // the maximum step between adjacent compact spans (still `climb`).
  const angle = c.slopeDegrees * (Math.PI / 180);
  const ledge = Math.max(climb, Math.ceil(2 * c.cellSize *
    deterministicSin(angle) / deterministicCos(angle) / c.cellHeight) + 1);
  nav.filterLedgeSpans(hf, height, ledge);
  nav.filterWalkableLowHeightSpans(hf, height);
  const compact = nav.buildCompactHeightfield(ctx, height, climb, hf);
  const data: TileData = {
    config: { ...config, origin: vector(config.origin) },
    x,
    z,
    compact,
    baked: null,
  };
  // Polygon generation edits its compact input. Retain pristine spans for later carving.
  data.baked = finishTile(data, []);
  if (!config.retainSpans) data.compact = null;
  return encodeTile(data);
}
/** Sample the heightfield's actual function, with upward triangle winding and no skirts. */
export function heightfieldTriangles(
  field: HeightField,
  minX: number,
  minZ: number,
  nx: number,
  nz: number,
  step: number,
  up: Up = 'y',
): Triangles {
  positive(step, 'sample step');
  if (
    ![minX, minZ].every(Number.isFinite) ||
    !Number.isInteger(nx) ||
    !Number.isInteger(nz) ||
    nx < 2 ||
    nz < 2 ||
    nx * nz > 4_000_000
  )
    throw new Error('nav: invalid heightfield dimensions');
  const positions = new Float64Array(nx * nz * 3),
    indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const px = minX + x * step,
        pz = minZ + z * step;
      positions.set(fromAxes([px, field.heightAt(px, pz), pz], up), (z * nx + x) * 3);
      if (x < nx - 1 && z < nz - 1) {
        const a = z * nx + x;
        indices.set([a, a + nx, a + nx + 1, a, a + nx + 1, a + 1], k);
        k += 6;
      }
    }
  return { positions, indices };
}

export interface BakedTile {
  x: number;
  z: number;
  bytes: Uint8Array;
}
/** Bucket triangles once, including every tile's erosion halo. Coordinates x/z
 * here name the two tile-grid dimensions; for Z-up these are world x/y. */
export function bakeLevel(input: Triangles, config: BakeConfig): BakedTile[] {
  checkConfig(config);
  const positions = Float64Array.from(input.positions);
  const indices = input.indices
    ? Array.from(input.indices)
    : Array.from({ length: positions.length / 3 }, (_, i) => i);
  if (
    positions.length % 3 ||
    indices.length % 3 ||
    !positions.every(Number.isFinite) ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i * 3 >= positions.length)
  )
    throw new Error('nav: malformed triangles');
  if (!indices.length) return [];
  const horizontal = config.up === 'z' ? 1 : 2,
    origin = axes(config.origin, config.up);
  const size = config.tileCells * config.cellSize,
    halo = (Math.ceil(config.radius / config.cellSize) + 3) * config.cellSize;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const i of indices) {
    minX = Math.min(minX, positions[i * 3]!);
    maxX = Math.max(maxX, positions[i * 3]!);
    minZ = Math.min(minZ, positions[i * 3 + horizontal]! * (config.up === 'z' ? -1 : 1));
    maxZ = Math.max(maxZ, positions[i * 3 + horizontal]! * (config.up === 'z' ? -1 : 1));
  }
  const firstX = Math.floor((minX - origin[0]) / size),
    lastX = Math.ceil((maxX - origin[0]) / size) - 1;
  const firstZ = Math.floor((minZ - origin[2]) / size),
    lastZ = Math.ceil((maxZ - origin[2]) / size) - 1;
  if ((lastX - firstX + 1) * (lastZ - firstZ + 1) > 1_000_000)
    throw new Error('nav: level covers too many tiles');
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3);
    const xs = triangle.map((v) => positions[v * 3]!),
      zs = triangle.map((v) => positions[v * 3 + horizontal]! * (config.up === 'z' ? -1 : 1));
    const x0 = Math.max(firstX, Math.floor((Math.min(...xs) - halo - origin[0]) / size));
    const x1 = Math.min(lastX, Math.floor((Math.max(...xs) + halo - origin[0]) / size));
    const z0 = Math.max(firstZ, Math.floor((Math.min(...zs) - halo - origin[2]) / size));
    const z1 = Math.min(lastZ, Math.floor((Math.max(...zs) + halo - origin[2]) / size));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const key = `${x},${z}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        for (const v of triangle)
          bucket.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
      }
  }
  return [...buckets]
    .map(([key, values]) => {
      const [x, z] = key.split(',').map(Number) as [number, number];
      return { x, z, bytes: bakeTile({ positions: values }, config, x, z) };
    })
    .sort((a, b) => a.z - b.z || a.x - b.x);
}
/** Rectangle uses horizontal coordinates, independent of the selected up axis. */
export function bakeHeightfield(
  field: HeightField,
  config: BakeConfig,
  rectangle: { min: ArrayLike<number>; max: ArrayLike<number> },
  sampleStep = config.cellSize,
): BakedTile[] {
  positive(sampleStep, 'sample step');
  const [x0, z0] = Array.from(rectangle.min),
    [x1, z1] = Array.from(rectangle.max);
  if (![x0, z0, x1, z1].every(Number.isFinite) || x1! <= x0! || z1! <= z0!)
    throw new Error('nav: invalid world rectangle');
  const triangles = heightfieldTriangles(
    field,
    x0!,
    z0!,
    Math.ceil((x1! - x0!) / sampleStep) + 1,
    Math.ceil((z1! - z0!) / sampleStep) + 1,
    sampleStep,
    config.up,
  );
  return bakeLevel(triangles, config);
}
