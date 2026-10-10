import { makeScene } from './scale-scene.mjs';
export function editWorkload(count, edits) {
  const scene = makeScene(80, count, true, true);
  let tick = 0,
    obstacle;
  return () => {
    tick++;
    if (edits) {
      if (obstacle) scene.mesh.removeObstacle(obstacle);
      const x = 72 + (tick % 2) * 0.05;
      obstacle = scene.mesh.addObstacle({
        min: [x, -1, 72],
        max: [x + 0.6, 2, 72.6],
      });
    }
    for (const { id, to } of scene.goals)
      scene.crowd.target(id, [to[0] + 0.2 * Math.sin(tick * 0.01), to[1], to[2]]);
    scene.crowd.step();
  };
}
