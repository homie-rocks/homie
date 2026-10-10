import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createWorld, v, box } from "./helpers.mjs";
import { engine } from "../dist/internal/Engine.js";
test("current engine and explicit refusal of real older solver saves", async () => {
  assert.equal(engine().version(), "0.21.0");
  const old = new Uint8Array(
    Buffer.from(
      await readFile(
        new URL("./rapier-0.17.3.save.base64", import.meta.url),
        "utf8",
      ),
      "base64",
    ),
  );
  const w = createWorld({});
  try {
    assert.throws(() => w.restore(old), /engine version/);
  } finally {
    w.dispose();
  }
});
test("pending inserts and teleports merge into all query kinds", () => {
  const w = createWorld({});
  try {
    const back = w.createBody({
      type: "static",
      position: v(0, 0, 4),
      colliders: [{ shape: box() }],
    });
    w.step(1 / 60);
    const front = w.createBody({
      type: "static",
      position: v(0, 0, 2),
      colliders: [{ shape: box() }],
    });
    assert.equal(w.raycast(v(), v(0, 0, 1), 10).body, front);
    assert.deepEqual(
      w.raycastAll(v(), v(0, 0, 1), 10).map((h) => h.body),
      [front, back],
    );
    assert.equal(w.castShape(box(0.1, 0.1, 0.1), v(), v(0, 0, 10)).body, front);
    assert.equal(w.overlaps(box(), v(0, 0, 2))[0], w.colliders(front)[0]);
    w.teleport(front, v(10, 0, 2));
    assert.equal(w.raycast(v(), v(0, 0, 1), 10).body, back);
    assert.equal(w.raycast(v(10, 0, 0), v(0, 0, 1), 10).body, front);
  } finally {
    w.dispose();
  }
});
test("metadata is compact and stores one envelope version", () => {
  const w = createWorld({});
  try {
    for (let i = 0; i < 100; i++)
      w.createBody({
        type: "dynamic",
        position: v(i, 2),
        colliders: [{ shape: box() }],
      });
    const bytes = w.snapshot();
    const metadataBytes = new DataView(bytes.buffer).getUint32(8, true);
    assert.ok(
      metadataBytes < 5000,
      `${metadataBytes} metadata bytes for 100 bodies`,
    );
  } finally {
    w.dispose();
  }
});
