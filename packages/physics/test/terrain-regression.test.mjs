import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, v, box } from "./helpers.mjs";
for (const up of ["y", "z"]) {
  const axes = (x, y, z) => (up === "y" ? v(x, y, z) : v(x, z, y));
  test(`${up}: every terrain vertex and cell edge answers rays and shape casts`, () => {
    const w = createWorld({ up });
    try {
      const heights = Float32Array.from(
        { length: 9 * 13 },
        (_, i) => (i % 13) * 0.03 + Math.floor(i / 13) * 0.02,
      );
      w.createBody({
        type: "static",
        colliders: [
          {
            shape: {
              kind: "heightfield",
              rows: 12,
              columns: 8,
              heights,
              scale: v(4, 1, 6),
            },
          },
        ],
      });
      w.step(1 / 60);
      for (let x = 0; x <= 16; x++)
        for (let z = 0; z <= 24; z++) {
          const p = axes(-2 + x * 0.25, 10, -3 + z * 0.25),
            down = axes(0, -1, 0);
          assert.ok(w.raycast(p, down, 20), `ray at ${x},${z}`);
          assert.equal(w.raycastAll(p, down, 20).length, 1, `all at ${x},${z}`);
          assert.ok(
            w.castShape({ kind: "sphere", radius: 0.01 }, p, axes(0, -20, 0)),
            `shape at ${x},${z}`,
          );
        }
    } finally {
      w.dispose();
    }
  });
}
test("a Z-up heightfield local position uses world axes", () => {
  const w = createWorld({ up: "z" });
  try {
    w.createBody({
      type: "static",
      colliders: [
        {
          shape: {
            kind: "heightfield",
            rows: 2,
            columns: 2,
            heights: new Float32Array(9),
            scale: v(2, 1, 2),
          },
          position: v(10, 20, 0),
        },
      ],
    });
    const h = w.raycast(v(10.2, 20.2, 5), v(0, 0, -1), 10);
    assert.ok(h);
    assert.ok(Math.abs(h.point.z) < 0.001);
  } finally {
    w.dispose();
  }
});
