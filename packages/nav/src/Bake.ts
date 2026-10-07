/** Recast's voxel pipeline, one independently buildable tile with a geometry halo. */
import * as nav from 'navcat';
import type { HeightField } from '@homie-rocks/heightfield/Field.js';
import { pack, unpack } from './State.ts';
import { point, positive, type Point } from './Query.ts';
export interface Triangles { positions: ArrayLike<number>; indices?: ArrayLike<number> }
export interface BakeConfig {
  origin: Point;
  /** Global vertical bounds, shared by every tile, in world metres. */
  minY: number; maxY: number;
  cellSize: number; cellHeight: number; tileCells: number;
  radius: number; height: number; stepHeight: number; slopeDegrees: number;
}
export interface Obstacle { min: Point; max: Point }
export interface TileData {
  config: BakeConfig; x: number; z: number;
  /** Compact spans retained so obstacles can be carved without original triangles. */
  compact: nav.CompactHeightfield;
  baked: nav.NavMeshTile | null;
}
export function checkConfig(c: BakeConfig): void {
  point(c.origin);
  for (const k of ['cellSize', 'cellHeight', 'height'] as const) positive(c[k], k);
  if (!Number.isInteger(c.tileCells) || c.tileCells < 4 || c.tileCells > 1024) throw new Error('nav: tileCells must be an integer from 4 to 1024');
  if (![c.minY, c.maxY, c.radius, c.stepHeight, c.slopeDegrees].every(Number.isFinite) || c.maxY <= c.minY || c.radius < 0 || c.stepHeight < 0 || c.stepHeight >= c.height || c.slopeDegrees < 0 || c.slopeDegrees >= 90) throw new Error('nav: invalid agent or vertical bounds');
  if ((c.maxY - c.minY) / c.cellHeight > 65535) throw new Error('nav: vertical bounds exceed voxel range');
  if (c.tileCells + 2 * (Math.ceil(c.radius / c.cellSize) + 3) > 2048) throw new Error('nav: tile halo too large');
}
export function checkObstacle(o: Obstacle): void {
  point(o.min); point(o.max);
  if (o.min.some((v, i) => v >= o.max[i]!)) throw new Error('nav: obstacle bounds must have positive volume');
}
/** Bake one tile; triangles must include the radius + three-cell halo on every side. */
export function bakeTile(input: Triangles, config: BakeConfig, x: number, z: number): Uint8Array {
  checkConfig(config);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) throw new Error('nav: tile coordinates must be integers');
  // Copy before suppressing upstream profiling: no caller callback runs in that scope.
  const positions = Float64Array.from(input.positions);
  const indices = input.indices ? Uint32Array.from(input.indices) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  if (positions.length % 3 || indices.length % 3 || !positions.every(Number.isFinite)) throw new Error('nav: malformed triangles');
  if (input.indices && Array.from(input.indices).some(i => !Number.isInteger(i) || i < 0 || i >= positions.length / 3)) throw new Error('nav: invalid triangle index');
  const c = config, border = Math.ceil(c.radius / c.cellSize) + 3, size = c.tileCells * c.cellSize;
  const bounds: [number, number, number, number, number, number] = [c.origin[0] + x * size - border * c.cellSize, c.minY, c.origin[2] + z * size - border * c.cellSize, c.origin[0] + (x + 1) * size + border * c.cellSize, c.maxY, c.origin[2] + (z + 1) * size + border * c.cellSize];
  const hf = nav.createHeightfield(c.tileCells + border * 2, c.tileCells + border * 2, bounds, c.cellSize, c.cellHeight);
  const areas = new Uint8Array(indices.length / 3);
  nav.markWalkableTriangles(positions, indices, areas, c.slopeDegrees);
  const ctx = nav.BuildContext.create(), climb = Math.floor(c.stepHeight / c.cellHeight), height = Math.ceil(c.height / c.cellHeight);
  // navcat 0.4.1's only rasterizer clock reads are these two profiling hooks.
  // The call is synchronous, has no external callbacks, and restores even on error.
  const start = nav.BuildContext.start, end = nav.BuildContext.end;
  try {
    nav.BuildContext.start = () => {}; nav.BuildContext.end = () => {};
    if (!nav.rasterizeTriangles(ctx, hf, positions, indices, areas, climb)) throw new Error('nav: rasterization failed');
  } finally { nav.BuildContext.start = start; nav.BuildContext.end = end; }
  nav.filterLowHangingWalkableObstacles(hf, climb);
  nav.filterLedgeSpans(hf, height, climb);
  nav.filterWalkableLowHeightSpans(hf, height);
  const compact = nav.buildCompactHeightfield(ctx, height, climb, hf);
  const data: TileData = { config: { ...c, origin: [...c.origin] }, x, z, compact, baked: null };
  // Polygon generation edits its compact input. Retain pristine spans for later carving.
  data.baked = finishTile(unpack<TileData>('tile', pack('tile', data)), []);
  return pack('tile', data);
}
/** Build polygons from saved spans. Obstacles are carved BEFORE radius erosion. */
export function tilePolygons(bytes: Uint8Array, obstacles: readonly Obstacle[]): nav.NavMeshTile | null {
  const data = unpack<TileData>('tile', bytes);
  checkConfig(data.config);
  return obstacles.length ? finishTile(data, obstacles) : data.baked;
}
function finishTile(data: TileData, obstacles: readonly Obstacle[]): nav.NavMeshTile | null {
  const c = data.config;
  const compact = data.compact;
  for (const o of obstacles) {
    // Mark spans whose standing body overlaps the box vertically. Erosion handles XZ radius.
    nav.markBoxArea([o.min[0], o.min[1] - c.height, o.min[2], o.max[0], o.max[1], o.max[2]], nav.NULL_AREA, compact);
  }
  nav.erodeWalkableArea(Math.ceil(c.radius / c.cellSize), compact);
  nav.buildDistanceField(compact);
  const ctx = nav.BuildContext.create(), border = Math.ceil(c.radius / c.cellSize) + 3;
  nav.buildRegions(ctx, compact, border, 0, 0);
  const contours = nav.buildContours(ctx, compact, 1.3, 12 / c.cellSize, nav.ContourBuildFlags.CONTOUR_TESS_WALL_EDGES);
  const poly = nav.buildPolyMesh(ctx, contours, 6);
  if (!poly.nPolys) return null;
  for (let i = 0; i < poly.nPolys; i++) { poly.flags[i] = 1; poly.areas[i] = 0; }
  const detail = nav.buildPolyMeshDetail(ctx, poly, compact, c.cellSize * 6, c.cellHeight);
  const p = nav.polyMeshToTilePolys(poly);
  return nav.buildTile({ ...p, ...nav.polyMeshDetailToTileDetailMesh(p.polys, detail), bounds: poly.bounds,
    tileX: data.x, tileY: data.z, tileLayer: 0, cellSize: c.cellSize, cellHeight: c.cellHeight,
    walkableHeight: c.height, walkableRadius: c.radius, walkableClimb: c.stepHeight });
}
/** Sample the heightfield's actual function, with upward triangle winding and no skirts. */
export function heightfieldTriangles(field: HeightField, minX: number, minZ: number, nx: number, nz: number, step: number): Triangles {
  positive(step, 'sample step');
  if (![minX, minZ].every(Number.isFinite) || !Number.isInteger(nx) || !Number.isInteger(nz) || nx < 2 || nz < 2 || nx * nz > 4_000_000) throw new Error('nav: invalid heightfield dimensions');
  const positions = new Float64Array(nx * nz * 3), indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const px = minX + x * step, pz = minZ + z * step;
    positions.set([px, field.heightAt(px, pz), pz], (z * nx + x) * 3);
    if (x < nx - 1 && z < nz - 1) { const a = z * nx + x; indices.set([a, a + nx, a + nx + 1, a, a + nx + 1, a + 1], k); k += 6; }
  }
  return { positions, indices };
}
