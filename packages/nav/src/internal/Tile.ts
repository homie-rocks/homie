import { requireState, numbers } from './Validate.ts';
import * as nav from 'navcat';
import type { BakeConfig, Obstacle } from '../Bake.ts';
import { axisBounds } from './Coordinates.ts';
import { pack, unpack } from './Binary.ts';
export interface PackedCompact extends Omit<nav.CompactHeightfield, 'cells' | 'spans' | 'areas'> {
  cells: Uint32Array;
  spans: Uint32Array;
  areas: Uint8Array;
}
export interface TileData {
  config: BakeConfig;
  x: number;
  z: number;
  compact: nav.CompactHeightfield | PackedCompact | null;
  baked: nav.NavMeshTile | null;
}
/** Each retained cell: two uint32s. Each span: four uint32s + uint8 area.
 * Pristine spans have no distance field; derived fields are rebuilt on edit.
 */
export function encodeTile(data: TileData): Uint8Array {
  const c = data.compact;
  if (!c || c.cells instanceof Uint32Array) return pack('tile', data);
  const expanded = c as nav.CompactHeightfield;
  const cells = new Uint32Array(c.cells.length * 2),
    spans = new Uint32Array(c.spanCount * 4);
  expanded.cells.forEach((v, i) => cells.set([v.index, v.count], i * 2));
  expanded.spans.forEach((v, i) => spans.set([v.y, v.region, v.con, v.h], i * 4));
  return pack('tile', {
    ...data,
    compact: {
      ...c,
      cells,
      spans,
      areas: Uint8Array.from(c.areas),
      distances: [],
    },
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
    numbers(c.bounds, 6);
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
    requireState(
      Number.isSafeInteger(c.width) &&
        c.width > 0 &&
        Number.isSafeInteger(c.height) &&
        c.height > 0,
    );
    let consumed = 0;
    for (let i = 0; i < cells.length; i += 2) {
      const start = cells[i]!,
        count = cells[i + 1]!;
      requireState((count === 0 || start === consumed) && start + count <= c.spanCount);
      consumed += count;
      const x = (i / 2) % c.width,
        z = Math.floor(i / 2 / c.width);
      for (let j = start; j < start + count; j++)
        for (let d = 0; d < 4; d++) {
          const con = (spans[j * 4 + 2]! >>> (d * 6)) & 63;
          if (con === nav.NOT_CONNECTED) continue;
          const nx = x + nav.getDirOffsetX(d),
            nz = z + nav.getDirOffsetY(d);
          requireState(nx >= 0 && nz >= 0 && nx < c.width && nz < c.height);
          const neighbour = (nz * c.width + nx) * 2;
          requireState(con < cells[neighbour + 1]!);
        }
    }
    requireState(consumed === c.spanCount);
  }
  if (data.baked && (!Array.isArray(data.baked.polys) || !Array.isArray(data.baked.vertices)))
    throw new Error('nav: invalid tile polygons');
  if (data.baked) {
    const t = data.baked;
    numbers(t.vertices);
    numbers(t.polyNodes);
    requireState(t.polyNodes.every((n) => Number.isSafeInteger(n) && n >= 0));
    numbers(t.bounds, 6);
    numbers(t.detailVertices);
    numbers(t.detailTriangles);
    requireState(
      t.vertices.length % 3 === 0 &&
        t.detailVertices.length % 3 === 0 &&
        t.detailTriangles.length % 4 === 0 &&
        Array.isArray(t.detailMeshes) &&
        t.detailMeshes.length === t.polys.length &&
        Array.isArray(t.polyNodes),
    );
    for (const p of t.polys) {
      requireState(p && typeof p === 'object');
      numbers(p.vertices);
      numbers(p.neis, p.vertices.length);
      requireState(
        p.vertices.length >= 3 &&
          p.vertices.every((i) => Number.isInteger(i) && i >= 0 && i * 3 < t.vertices.length) &&
          Number.isSafeInteger(p.flags) &&
          Number.isSafeInteger(p.area),
      );
    }
    for (const d of t.detailMeshes) {
      requireState(
        d &&
          [d.verticesBase, d.verticesCount, d.trianglesBase, d.trianglesCount].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ),
      );
      requireState(
        (d.verticesBase + d.verticesCount) * 3 <= t.detailVertices.length &&
          (d.trianglesBase + d.trianglesCount) * 4 <= t.detailTriangles.length,
      );
    }
    requireState(
      t.bvTree && Array.isArray(t.bvTree.nodes) && Number.isFinite(t.bvTree.quantFactor),
    );
    for (const node of t.bvTree.nodes) {
      numbers(node.bounds, 6);
      requireState(Number.isSafeInteger(node.i));
    }
  }
  return data;
}
export function cloneCompact(c: nav.CompactHeightfield | PackedCompact): nav.CompactHeightfield {
  return {
    ...c,
    bounds: [...c.bounds],
    cells:
      c.cells instanceof Uint32Array
        ? Array.from({ length: c.cells.length / 2 }, (_, i) => ({
            index: (c.cells as Uint32Array)[i * 2]!,
            count: (c.cells as Uint32Array)[i * 2 + 1]!,
          }))
        : c.cells,
    spans:
      c.spans instanceof Uint32Array
        ? Array.from({ length: c.spanCount }, (_, i) => ({
            y: (c.spans as Uint32Array)[i * 4]!,
            region: (c.spans as Uint32Array)[i * 4 + 1]!,
            con: (c.spans as Uint32Array)[i * 4 + 2]!,
            h: (c.spans as Uint32Array)[i * 4 + 3]!,
          }))
        : c.spans.map((s) => ({ ...s })),
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
