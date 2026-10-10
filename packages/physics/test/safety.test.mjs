import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, v, box, sphere } from "./helpers.mjs";
test("falling debris cannot end a twenty-minute room", () => {
  const w = createWorld({});
  try {
    const body = w.createBody({
      type: "dynamic",
      colliders: [{ shape: sphere() }],
    });
    const limits = [];
    for (let i = 0; i < 20 * 60 * 20; i++)
      limits.push(...w.step(0.05).filter((e) => e.kind === "limit"));
    assert.equal(limits.length, 1);
    assert.equal(limits[0].reason, "outside-bounds");
    assert.equal(limits[0].bodyA, body);
    assert.equal(w.hasBody(body), false);
    assert.ok(w.snapshot().length);
  } finally {
    w.dispose();
  }
});
for (const kind of ["force", "torque", "impulse", "gravity"])
  test(`bounded ${kind} cannot poison the world`, () => {
    const w = createWorld({ gravity: kind === "gravity" ? v(0, -1000) : v() });
    try {
      const b = w.createBody({
        type: "dynamic",
        mass: kind === "impulse" ? 0.001 : 1,
        gravityScale: kind === "gravity" ? 100 : 1,
        colliders: [{ shape: box() }],
      });
      if (kind === "force") w.force(b, v(1e6));
      if (kind === "torque") w.torque(b, v(1e4));
      if (kind === "impulse") w.impulse(b, v(0, 0.5), v(0.5));
      for (let i = 0; i < 200; i++) w.step(0.05);
      assert.ok(w.snapshot().length);
    } finally {
      w.dispose();
    }
  });
test("shapes below position precision are rejected before allocation", () => {
  const w = createWorld({});
  try {
    const save = w.snapshot();
    assert.throws(
      () =>
        w.createBody({
          type: "dynamic",
          position: v(1e5, 1e5, 1e5),
          colliders: [{ shape: sphere(0.001) }],
        }),
      /precision/,
    );
    assert.deepEqual(w.snapshot(), save);
  } finally {
    w.dispose();
  }
});
test("repeated traps release isolated WASM memory and permit restore", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", new URL("./trap-fixture.mjs", import.meta.url).pathname],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("removing an escaped kinematic target does not poison later substeps", () => {
  const w = createWorld({ bounds: { min: v(-2, -2, -2), max: v(2, 2, 2) } });
  try {
    const b = w.createBody({
      type: "kinematic",
      colliders: [{ shape: box() }],
    });
    w.moveKinematic(b, v(10));
    assert.doesNotThrow(() => w.step(0.05));
    assert.equal(w.hasBody(b), false);
    assert.doesNotThrow(() => w.step(0.05));
  } finally {
    w.dispose();
  }
});
test("tiny static surfaces also require adequate coordinate precision", () => {
  const w = createWorld({});
  try {
    for (const shape of [
      {
        kind: "mesh",
        vertices: new Float32Array([0, 0, 0, 0.001, 0, 0, 0, 0, 0.001]),
        indices: new Uint32Array([0, 1, 2]),
      },
      {
        kind: "heightfield",
        rows: 1,
        columns: 1,
        heights: new Float32Array(4),
        scale: v(0.001, 1, 0.001),
      },
    ])
      assert.throws(
        () =>
          w.createBody({
            type: "static",
            position: v(1e5, 1e5, 1e5),
            colliders: [{ shape }],
          }),
        /precision/,
      );
  } finally {
    w.dispose();
  }
});
