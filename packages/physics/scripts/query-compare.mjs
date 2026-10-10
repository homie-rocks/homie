/** Measure indexed queries and single edits without rebuilding the scene. */
import { performance } from "node:perf_hooks";
import { createWorld, v, box, floor } from "../test/helpers.mjs";
for (const count of [100, 500, 2000]) {
  const w = createWorld({});
  floor(w);
  for (let i = 0; i < count; i++)
    w.createBody({
      type: "dynamic",
      position: v(
        (i % 20) - 10,
        0.5 + Math.floor(i / 400),
        (Math.floor(i / 20) % 20) - 10,
      ),
      colliders: [{ shape: box(0.45, 0.45, 0.45) }],
    });
  for (let i = 0; i < 150; i++) w.step(0.05);
  const edited = w.createBody({
    type: "static",
    position: v(25, 2),
    colliders: [{ shape: box() }],
  });
  w.step(0.05);
  const ray = () => w.raycast(v(0.3, 60, 0.2), v(0, -1), 100);
  const measure = (fn, iterations = 10000) => {
    for (let i = 0; i < 100; i++) fn(i);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn(i);
    return ((performance.now() - start) * 1000) / iterations;
  };
  console.log(
    JSON.stringify({
      count,
      rayUs: measure(ray),
      sphereUs: measure(() =>
        w.castShape(
          { kind: "sphere", radius: 0.2 },
          v(0.3, 60, 0.2),
          v(0, -100),
        ),
      ),
      overlapUs: measure(() => w.overlaps(box(), v(0.3, 0.2, 0.2))),
      materialRayUs: measure((i) => {
        w.updateCollider(w.colliders(edited)[0], { friction: i % 2 });
        ray();
      }),
      teleportRayUs: measure((i) => {
        w.teleport(edited, v(25 + (i % 2), 2));
        ray();
      }),
      insertRayUs: measure(() => {
        const b = w.createBody({
          type: "static",
          position: v(25, 2),
          colliders: [{ shape: box() }],
        });
        ray();
        w.removeBody(b);
      }, 1000),
    }),
  );
  w.dispose();
}
// Level-building workload: all colliders are still pending. Query the previous
// placement before inserting the next, so the index is exercised incrementally.
for (const count of [200, 500, 2000, 4000]) {
  const w = createWorld({});
  floor(w);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const p = v((i % 100) * 3, 0.5, Math.floor(i / 100) * 3);
    w.raycast(v(p.x, 10, p.z), v(0, -1), 20);
    w.createBody({
      type: "static",
      position: p,
      colliders: [{ shape: box() }],
    });
  }
  console.log(
    JSON.stringify({ pending: count, buildMs: performance.now() - start }),
  );
  w.dispose();
}
