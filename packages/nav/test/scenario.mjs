// One renderer-free workload, bundled unchanged for Node, Chrome and workerd.
import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { fromAxes as axes, axisBounds } from '@homie-rocks/nav/Query.js';

export function scenario(up = 'y') {
  const p = (v) => axes(v, up);
  const c = {
    origin: [0, 0, 0],
    up,
    retainSpans: true,
    minY: -2,
    maxY: 10,
    cellSize: 0.5,
    cellHeight: 0.1,
    tileCells: 20,
    radius: 0.3,
    height: 1.8,
    stepHeight: 0.6,
    slopeDegrees: 45,
  };
  const input = heightfieldTriangles({ heightAt: (x) => x * 0.1 }, -2, -2, 29, 29, 0.5, up);
  const tile = bakeTile(input, c, 0, 0),
    m = new Mesh(c, [2, 2, 2]);
  m.loadTile(tile);
  m.addObstacle(axisBounds([4, -1, 4], [6, 3, 6], up, true));
  const rng = new Random(29),
    random = Array.from({ length: 8 }, () => m.random(p([1, 0.2, 1]), rng.next));
  const crowd = new Crowd(m, 1 / 30, 0.3);
  for (let i = 0; i < 8; i++) {
    const id = crowd.add(p([1 + (i % 2), 0.1, 1 + Math.floor(i / 2)]), {
      radius: 0.3,
      height: 1.8,
      speed: 3,
      acceleration: 8,
      neighbours: 2,
      separation: 2,
    });
    crowd.target(id, p([8, 0.8, 8 - i * 0.6]));
  }
  for (let i = 0; i < 25; i++) crowd.step();
  const restored = Crowd.restore(crowd.save(), m);
  for (let i = 0; i < 35; i++) {
    crowd.step();
    restored.step();
  }
  const text = Array.from(crowd.save()).join(',');
  if (text !== Array.from(restored.save()).join(',')) throw new Error('restore diverged');
  const grid = new Grid(8, 8, 1, [0, 0, 0], undefined, { up });
  grid.setBlocked(3, 3, true);
  return JSON.stringify({
    tile: Array.from(tile).join(','),
    random,
    rng: [...rng.state],
    path: m.path(p([1, 0.1, 1]), p([9, 0.9, 9])),
    ray: m.raycast(p([1, 0.1, 1]), p([9, 0.9, 9])),
    grid: grid.path(p([0.5, 0, 0.5]), p([7.5, 0, 7.5])),
    crowd: text,
  });
}
export function withoutClock() {
  const random = Math.random,
    now = Date.now,
    perf = performance.now;
  const names = ['sin', 'cos', 'tan', 'atan2', 'pow', 'exp', 'log', 'hypot'];
  const saved = Object.fromEntries(names.map((name) => [name, Math[name]]));
  const forbidden = () => {
    throw new Error('navigation read a clock or unseeded random');
  };
  try {
    for (const name of names) Math[name] = forbidden;
    Math.random = forbidden;
    Date.now = forbidden;
    performance.now = forbidden;
    return JSON.stringify([scenario('y'), scenario('z')]);
  } finally {
    Object.assign(Math, saved);
    Math.random = random;
    Date.now = now;
    performance.now = perf;
  }
}
