// One renderer-free workload, bundled unchanged for Node, Chrome and workerd.
import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { Grid } from '@homie-rocks/nav/Grid.js';

export function scenario() {
  const c = { origin: [0, 0, 0], minY: -2, maxY: 10, cellSize: .5, cellHeight: .1, tileCells: 20, radius: .3, height: 1.8, stepHeight: .3, slopeDegrees: 45 };
  const input = heightfieldTriangles({ heightAt: x => x * .1 }, -2, -2, 29, 29, .5);
  const tile = bakeTile(input, c, 0, 0), m = new Mesh(c, [2, 2, 2]);m.loadTile(tile);
  m.addObstacle({ min: [4, -1, 4], max: [6, 3, 6] });
  const rng = new Random(29), random = Array.from({ length: 8 }, () => m.random([1, .2, 1], rng.next));
  const crowd = new Crowd(m, 1/30, .3);
  for (let i = 0; i < 8; i++) { const id = crowd.add([1 + i % 2, .1, 1 + Math.floor(i / 2)], { radius: .3, height: 1.8, speed: 3, acceleration: 8, neighbours: 2, separation: 2 });crowd.target(id, [8, .8, 8 - i * .6]); }
  for (let i = 0; i < 25; i++) crowd.step();
  const restored = Crowd.restore(crowd.save());
  for (let i = 0; i < 35; i++) { crowd.step();restored.step(); }
  const text = new TextDecoder().decode(crowd.save());
  if (text !== new TextDecoder().decode(restored.save())) throw new Error('restore diverged');
  const grid = new Grid(8, 8, 1, [0, 0, 0]);grid.setBlocked(3, 3, true);
  return JSON.stringify({ tile: new TextDecoder().decode(tile), random, rng: [...rng.state], path: m.path([1, .1, 1], [9, .9, 9]), ray: m.raycast([1, .1, 1], [9, .9, 9]), grid: grid.path([.5, 0, .5], [7.5, 0, 7.5]), crowd: text });
}
export function withoutClock() {
  const random = Math.random, now = Date.now, perf = performance.now;
  const forbidden = () => { throw new Error('navigation read a clock or unseeded random'); };
  try { Math.random = forbidden; Date.now = forbidden; performance.now = forbidden; return scenario(); }
  finally { Math.random = random; Date.now = now; performance.now = perf; }
}
