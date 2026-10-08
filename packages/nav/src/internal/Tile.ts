import * as nav from 'navcat';
import type { BakeConfig, Obstacle } from '../Bake.ts';
import { axisBounds } from '../Query.ts';
import { pack, unpack } from '../State.ts';
export interface TileData {
  config: BakeConfig;
  x: number;
  z: number;
  compact: nav.CompactHeightfield | null;
  baked: nav.NavMeshTile | null;
}
/** Each retained cell: two uint32s. Each span: four uint32s + uint8 area.
 * Pristine spans have no distance field; derived fields are rebuilt on edit.
 */
export function encodeTile(data: TileData): Uint8Array {
  const c = data.compact;
  if (!c) return pack('tile', data);
  const cells = new Uint32Array(c.cells.length * 2),
    spans = new Uint32Array(c.spanCount * 4);
  c.cells.forEach((v, i) => cells.set([v.index, v.count], i * 2));
  c.spans.forEach((v, i) => spans.set([v.y, v.region, v.con, v.h], i * 4));
  return pack('tile', {
    ...data,
    compact: { ...c, cells, spans, areas: Uint8Array.from(c.areas), distances: [] },
  });
}
export function decodeTile(bytes: Uint8Array): TileData {
  const data = unpack<TileData>('tile', bytes);
  if (
    !data ||
    !data.config ||
    !Number.isSafeInteger(data.x) ||
    !Number.isSafeInteger(data.z) ||
    !('compact' in data) ||
    !('baked' in data)
  )
    throw new Error('nav: invalid tile structure');
  const c = data.compact;
  if (c === null && data.config.retainSpans) throw new Error('nav: missing retained spans');
  if (c) {
    if (c.width * c.height > 250_000 || c.spanCount > 200_000)
      throw new Error('nav: retained tile exceeds room memory budget; bake smaller tiles');
    const cells = c.cells as unknown as Uint32Array,
      spans = c.spans as unknown as Uint32Array;
    if (
      !(cells instanceof Uint32Array) ||
      !(spans instanceof Uint32Array) ||
      cells.length !== c.width * c.height * 2 ||
      spans.length !== c.spanCount * 4 ||
      c.areas.length !== c.spanCount
    )
      throw new Error('nav: invalid compact spans');
    c.cells = Array.from({ length: cells.length / 2 }, (_, i) => ({
      index: cells[i * 2]!,
      count: cells[i * 2 + 1]!,
    }));
    c.spans = Array.from({ length: c.spanCount }, (_, i) => ({
      y: spans[i * 4]!,
      region: spans[i * 4 + 1]!,
      con: spans[i * 4 + 2]!,
      h: spans[i * 4 + 3]!,
    }));
    c.areas = Array.from(c.areas);
    if (c.cells.some((v) => v.index + v.count > c.spanCount))
      throw new Error('nav: invalid span range');
  }
  if (data.baked && (!Array.isArray(data.baked.polys) || !Array.isArray(data.baked.vertices)))
    throw new Error('nav: invalid tile polygons');
  return data;
}
export function cloneCompact(c: nav.CompactHeightfield): nav.CompactHeightfield {
  return {
    ...c,
    bounds: [...c.bounds],
    cells: c.cells,
    spans: c.spans.map((s) => ({ ...s })),
    areas: Array.from(c.areas),
    distances: new Array(c.spanCount).fill(0),
  };
}
export function finishTile(data: TileData, obstacles: readonly Obstacle[]): nav.NavMeshTile | null {
  if (!data.compact) throw new Error('nav: tile was baked without carve spans');
  const c = data.config,
    compact = cloneCompact(data.compact);
  for (const region of c.doorRegions ?? []) {
    const { min, max } = axisBounds(region.min, region.max, c.up);
    nav.markBoxArea([...min, ...max], 2, compact);
  }
  for (const o of obstacles) {
    // The raster floor is the TOP of its voxel. Subtract a cell from the standing
    // body to avoid rejecting an overhead box solely due to this quantization.
    const bottom = o.min[1]! - c.height + c.cellHeight;
    if ('radius' in o && o.radius !== undefined) {
      nav.markCylinderArea(
        [(o.min[0]! + o.max[0]!) / 2, bottom, (o.min[2]! + o.max[2]!) / 2],
        o.radius,
        o.max[1]! - bottom,
        nav.NULL_AREA,
        compact,
      );
    } else
      nav.markBoxArea(
        [o.min[0]!, bottom, o.min[2]!, o.max[0]!, o.max[1]!, o.max[2]!],
        nav.NULL_AREA,
        compact,
      );
  }
  nav.erodeWalkableArea(Math.ceil(c.radius / c.cellSize), compact);
  nav.buildDistanceField(compact);
  const ctx = nav.BuildContext.create(),
    border = Math.ceil(c.radius / c.cellSize) + 3;
  nav.buildRegions(ctx, compact, border, c.minRegionCells ?? 8, c.mergeRegionCells ?? 20);
  const contours = nav.buildContours(
    ctx,
    compact,
    1.3,
    12 / c.cellSize,
    nav.ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
  );
  const poly = nav.buildPolyMesh(ctx, contours, 6);
  if (!poly.nPolys) return null;
  for (let i = 0; i < poly.nPolys; i++) {
    poly.flags[i] = 1;
    poly.areas[i] = poly.areas[i] === 2 ? 2 : 0;
  }
  const detail = nav.buildPolyMeshDetail(ctx, poly, compact, c.cellSize * 6, c.cellHeight);
  const p = nav.polyMeshToTilePolys(poly);
  return nav.buildTile({
    ...p,
    ...nav.polyMeshDetailToTileDetailMesh(p.polys, detail),
    bounds: poly.bounds,
    tileX: data.x,
    tileY: data.z,
    tileLayer: 0,
    cellSize: c.cellSize,
    cellHeight: c.cellHeight,
    walkableHeight: c.height,
    walkableRadius: c.radius,
    walkableClimb: c.stepHeight,
  });
}
