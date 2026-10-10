import { registerQueryFilter } from './FilterValue.ts';
import * as nav from 'navcat';
import type { BakeConfig, Obstacle } from '../Bake.ts';
import type { TileData } from './Tile.ts';
import type { Vector } from '../Query.ts';
export interface MeshState {
  config: BakeConfig;
  extent: Vector;
  nav: nav.NavMesh;
  tiles: Record<string, TileData>;
  hashes: Record<string, number>;
  obstacles: Record<string, Obstacle>;
  nextId: number;
  revision: number;
  links: Record<string, number>;
  doors: Record<string, { box: Obstacle; enabled: boolean }>;
}
export const meshStates = new WeakMap<object, MeshState>();
export function meshData(mesh: object): MeshState {
  const state = meshStates.get(mesh);
  if (!state) throw new Error('nav: invalid mesh');
  return state;
}
export function locate(mesh: object, point: Vector): nav.FindNearestPolyResult {
  const s = meshData(mesh);
  return nav.findNearestPoly(
    nav.createFindNearestPolyResult(),
    s.nav,
    point,
    s.extent,
    nav.DEFAULT_QUERY_FILTER,
  );
}

registerQueryFilter(nav.DEFAULT_QUERY_FILTER);

