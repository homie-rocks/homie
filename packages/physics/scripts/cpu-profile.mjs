// Run alone. CPU time excludes time spent waiting for the OS scheduler.
import { loadavg, cpus } from "node:os";
import { ax } from "../test/scenario-harness.mjs";
import { sampleHeightfield } from "../dist/Heightfield.js";
const a = ax("y");
function terrain(w, cells, mesh = false) {
  if (!mesh)
    return w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x, z) => 0.15 * Math.sin(x * 0.3) * Math.cos(z * 0.3) },
          {
            nx: cells + 1,
            nz: cells + 1,
            cell: 1,
            x0: -cells / 2,
            z0: -cells / 2,
          },
        ),
      ],
    });
  const vertices = [],
    indices = [];
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++)
      vertices.push(x - cells / 2, 0, z - cells / 2);
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      const i = z * (cells + 1) + x;
      indices.push(
        i,
        i + cells + 1,
        i + 1,
        i + 1,
        i + cells + 1,
        i + cells + 2,
      );
    }
  return w.createBody({
    type: "static",
    colliders: [
      {
        shape: {
          kind: "mesh",
          vertices: new Float32Array(vertices),
          indices: new Uint32Array(indices),
        },
      },
    ],
  });
}
const cases = [
  ...["flat", "heightfield", "pile", "sleeping"].flatMap((scene) =>
    [100, 500, 2000].map((bodies) => ({ scene, bodies })),
  ),
  ...[100, 224].flatMap((cells) =>
    [1, 4].map((chars) => ({ scene: "mesh", cells, chars })),
  ),
  ...[64, 224, 1000].map((cells) => ({ scene: "terrain", cells, chars: 1 })),
  { scene: "terrain", cells: 64, chars: 100, bodies: 500 },
  { scene: "flat", chars: 100 },
  { scene: "crowd", chars: 50 },
  { scene: "flat", bodies: 500, remove: true },
];
console.log(
  JSON.stringify({
    machine: cpus()[0].model,
    node: process.version,
    load: loadavg(),
  }),
);
for (const c of cases) {
  if (
    process.env.PHYSICS_SCENES &&
    !process.env.PHYSICS_SCENES.split(",").includes(c.scene)
  )
    continue;
  const w = a.world();
  if (["heightfield", "terrain", "mesh"].includes(c.scene))
    terrain(w, c.cells ?? 64, c.scene === "mesh");
  else a.floor(w, 40);
  if (c.scene === "pile")
    for (const sign of [-1, 1]) {
      w.createBody({
        type: "static",
        position: a.V(sign * 3, 8),
        colliders: [{ shape: a.box(0.3, 8, 3.3) }],
      });
      w.createBody({
        type: "static",
        position: a.V(0, 8, sign * 3),
        colliders: [{ shape: a.box(3.3, 8, 0.3) }],
      });
    }
  for (let i = 0; i < (c.bodies ?? 0); i++)
    w.createBody({
      type: "dynamic",
      canSleep: c.scene === "sleeping",
      position:
        c.scene === "pile"
          ? a.V(
              (i % 5) - 2,
              0.5 + Math.floor(i / 25) * 1.02,
              (Math.floor(i / 5) % 5) - 2,
            )
          : a.V(
              (i % 20) * 1.1 - 10,
              0.5 + Math.floor(i / 400) * 1.1,
              (Math.floor(i / 20) % 20) * 1.1 - 10,
            ),
      colliders: [{ shape: a.box(0.45, 0.45, 0.45) }],
    });
  if (c.scene === "crowd")
    w.createBody({
      type: "static",
      position: a.V(3, 2),
      colliders: [{ shape: a.box(0.2, 2, 10) }],
    });
  if (c.scene === "crowd")
    for (const sign of [-1, 1])
      w.createBody({
        type: "static",
        position: a.V(-5, 2, sign * 1.8),
        colliders: [{ shape: a.box(10, 2, 0.2) }],
      });
  const chars = Array.from({ length: c.chars ?? 0 }, (_, i) =>
    a.chr(
      w,
      c.scene === "crowd" ? 2 - Math.floor(i / 5) * 0.65 : -15 + (i % 10) * 1.2,
      2,
      c.scene === "crowd"
        ? ((i % 5) - 2) * 0.65
        : 12 + Math.floor(i / 10) * 1.2,
    ),
  );
  const tick = () => {
    chars.forEach((id) => w.controlCharacter(id, a.inp(2)));
    if (c.remove) {
      const id = w.createBody({
        type: "dynamic",
        position: a.V(30, 3),
        colliders: [{ shape: a.box(0.1, 0.1, 0.1) }],
      });
      w.removeBody(id);
    }
    w.step(0.05);
  };
  for (let i = 0; i < (c.scene === "sleeping" ? 500 : 150); i++) tick();
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = process.cpuUsage();
    tick();
    const t = process.cpuUsage(start);
    samples.push((t.user + t.system) / 1000);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      ...c,
      p50: samples[50],
      p95: samples[95],
      ...(chars.length
        ? {
            grounded: chars.filter((id) => w.characterState(id).grounded)
              .length,
          }
        : {}),
      load: loadavg(),
    }),
  );
  if (c.bodies === 2000) {
    let start = process.cpuUsage();
    const bytes = w.snapshot();
    let used = process.cpuUsage(start);
    const saveMs = (used.user + used.system) / 1000;
    start = process.cpuUsage();
    w.restore(bytes);
    used = process.cpuUsage(start);
    console.log(
      JSON.stringify({
        scene: c.scene,
        snapshotBytes: bytes.length,
        saveMs,
        restoreMs: (used.user + used.system) / 1000,
      }),
    );
  }
  w.dispose();
}

if (
  !process.env.PHYSICS_SCENES ||
  process.env.PHYSICS_SCENES.includes("edits")
) {
  const worlds = [a.world(), a.world()];
  for (const w of worlds) {
    a.floor(w, 40);
    for (let i = 0; i < 500; i++)
      w.createBody({
        type: "dynamic",
        canSleep: false,
        position: a.V(
          (i % 20) * 1.1 - 10,
          0.5 + Math.floor(i / 400) * 1.1,
          (Math.floor(i / 20) % 20) * 1.1 - 10,
        ),
        colliders: [{ shape: a.box(0.45, 0.45, 0.45) }],
      });
  }
  const tick = (index, remove) => {
    const w = worlds[index];
    if (remove) {
      const id = w.createBody({
        type: "dynamic",
        position: a.V(30, 3),
        colliders: [{ shape: a.box(0.1, 0.1, 0.1) }],
      });
      w.removeBody(id);
    }
    w.step(0.05);
  };
  for (let i = 0; i < 200; i++) {
    tick(0, i % 2 === 0);
    tick(1, i % 2 === 1);
  }
  const samples = [[], []];
  for (let i = 0; i < 200; i++)
    for (const index of i % 4 < 2 ? [1, 0] : [0, 1]) {
      const remove = index === i % 2;
      const start = process.cpuUsage();
      tick(index, remove);
      const t = process.cpuUsage(start);
      samples[Number(remove)].push((t.user + t.system) / 1000);
    }
  for (const values of samples) values.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scene: "paired-removals",
      bodies: 500,
      baselineP50: samples[0][100],
      removalP50: samples[1][100],
      baselineP95: samples[0][190],
      removalP95: samples[1][190],
      ratio: samples[1][100] / samples[0][100],
      load: loadavg(),
    }),
  );
  for (const w of worlds) w.dispose();
}
