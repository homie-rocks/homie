import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
export const config = {
  origin: [0, 0, 0],
  retainSpans: true,
  minY: -2,
  maxY: 12,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 40,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
export const tune = {
  radius: 0.3,
  height: 1.8,
  speed: 3,
  acceleration: 8,
  neighbours: 2,
  separation: 2,
};
export const field = (f = () => 0, minX = -2, minZ = -2, nx = 57, nz = 57) =>
  heightfieldTriangles({ heightAt: f }, minX, minZ, nx, nz, 0.25);
export function flat(c = config) {
  const m = new Mesh(c, [2, 2, 2]);
  m.loadTile(bakeTile(field(), c, 0, 0));
  return m;
}
export function doorway() {
  const c = { ...config, tileCells: 80 },
    m = new Mesh(c, [2, 2, 2]);
  m.loadTile(
    bakeTile(
      field(() => 0, -2, -2, 97, 97),
      c,
      0,
      0,
    ),
  );
  m.addObstacle({ min: [9.5, -1, 0], max: [10.5, 4, 8] });
  m.addObstacle({ min: [9.5, -1, 12], max: [10.5, 4, 20] });
  return m;
}
