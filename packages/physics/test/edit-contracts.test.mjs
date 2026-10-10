import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, box, v, character } from "./helpers.mjs";
import { heightfieldGrid } from "../dist/Heightfield.js";
test("a material edit cannot turn the only dynamic solid into a sensor", () => {
  const w = createWorld({});
  try {
    const b = w.createBody({ type: "dynamic", colliders: [{ shape: box() }] });
    assert.throws(
      () => w.updateCollider(w.colliders(b)[0], { sensor: true }),
      /solid collider/,
    );
    assert.ok(w.raycast(v(0, 2), v(0, -1), 5));
  } finally {
    w.dispose();
  }
});
for (const up of ["y", "z"])
  test(`terrain helpers infer the insertion axis (${up})`, () => {
    const w = createWorld({ up });
    try {
      w.createBody({
        type: "static",
        colliders: [
          heightfieldGrid({
            nx: 3,
            nz: 3,
            cell: 1,
            x0: 10,
            z0: 20,
            heights: new Float32Array(9),
          }),
        ],
      });
      const p = up === "y" ? v(11, 4, 21) : v(11, 21, 4),
        d = up === "y" ? v(0, -1) : v(0, 0, -1);
      assert.ok(w.raycast(p, d, 10));
    } finally {
      w.dispose();
    }
  });
test("limit events identify the removed character", () => {
  const w = createWorld({ killPlane: 0 });
  try {
    const c = w.createCharacter({ ...character, position: v(0, 1) });
    let events = [];
    for (let i = 0; i < 90 && w.hasCharacter(c); i++) {
      w.controlCharacter(c, { x: 1, z: 0 });
      events = w.step(1 / 60);
    }
    assert.equal(w.hasCharacter(c), false);
    assert.equal(events.find((e) => e.kind === "limit").character, c);
    assert.throws(() => w.controlCharacter(c, { x: 0 }), /unknown character/);
  } finally {
    w.dispose();
  }
});
