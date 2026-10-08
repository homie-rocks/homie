import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { config, field, tune } from '../fixtures.mjs';
for (const [count, width] of [
  [300, 1.5],
  [400, 4],
]) {
  const cfg = { ...config, tileCells: 160 },
    mesh = new Mesh(cfg, [2, 2, 2]);
  mesh.loadTile(
    bakeTile(
      field(() => 0, -2, -2, 177, 177),
      cfg,
      0,
      0,
    ),
  );
  mesh.addObstacle({ min: [19.5, -1, 0], max: [20.5, 3, 20 - width / 2] });
  mesh.addObstacle({ min: [19.5, -1, 20 + width / 2], max: [20.5, 3, 40] });
  const crowd = new Crowd(mesh, 0.05, 0.3),
    ids = [];
  for (let i = 0; i < count; i++) {
    const p = [1 + (i % 16), 0.1, 1 + Math.floor(i / 16) * 1.5],
      id = crowd.add(p, tune);
    ids.push(id);
    crowd.target(id, [40 - p[0], 0.1, p[2]]);
  }
  let minimum = Infinity,
    deepOverlaps = 0;
  const times = [];
  for (let tick = 0; tick < 1000; tick++) {
    const t = performance.now();
    crowd.step();
    times.push(performance.now() - t);
    if (tick % 10) continue;
    const agents = ids.map((id) => crowd.agent(id).position);
    for (let i = 0; i < agents.length; i++)
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i],
          b = agents[j],
          dx = a[0] - b[0],
          dz = a[2] - b[2],
          d = Math.sqrt(dx * dx + dz * dz);
        minimum = Math.min(minimum, d);
        if (d < 0.3) deepOverlaps++;
      }
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      count,
      width,
      minimum,
      deepOverlaps,
      crossed: ids.filter((id) => crowd.agent(id).position[0] > 21).length,
      stepMedianMs: times[500],
      stepP95Ms: times[950],
    }),
  );
}
