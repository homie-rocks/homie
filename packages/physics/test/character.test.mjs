import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  v,
  box,
  sphere,
  options,
  floor,
  ticks,
  character,
} from "./helpers.mjs";
import {
  centredHeightfield,
  heightfieldGrid,
  sampleHeightfield,
} from "@homie-rocks/physics/Heightfield.js";
import { CentredGrid } from "@homie-rocks/heightfield/Field.js";
const pos = (w, c) => w.bodyState(w.characterState(c).body).position;

test("a character walks a heightfield, jumps, lands and replays pending input", () => {
  const w = createWorld(options),
    b = createWorld(options);
  w.createBody({
    type: "static",
    colliders: [
      centredHeightfield(new CentredGrid(21, 1, 10), new Float32Array(441)),
    ],
  });
  const c = w.createCharacter(character);
  ticks(w, 30);
  assert.equal(w.characterState(c).grounded, true);
  w.controlCharacter(c, { x: 2, z: 0, jump: true });
  w.step(w.fixedDt / 2);
  b.restore(w.snapshot());
  let high = 0;
  for (let i = 0; i < 90; i++) {
    assert.deepEqual(w.step(w.fixedDt), b.step(b.fixedDt));
    assert.deepEqual(w.snapshot(), b.snapshot(), `character replay ${i}`);
    high = Math.max(high, pos(w, c).y);
  }
  assert.ok(high > 1.35);
  assert.ok(pos(w, c).x > 2.8);
  assert.equal(w.characterState(c).grounded, true);
  w.dispose();
  b.dispose();
});

test("rectangular asymmetric terrain keeps axes, origin and native-array identity", () => {
  const heights = new Float32Array([0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 6, 7]);
  const g = { nx: 4, nz: 3, cell: 2, x0: 10, z0: 20, heights };
  const d = heightfieldGrid(g);
  assert.deepEqual([...d.shape.heights], [0, 2, 4, 1, 3, 5, 2, 4, 6, 3, 5, 7]);
  assert.equal(
    heightfieldGrid({ ...g, heights: d.shape.heights }, "z-fast").shape.heights,
    d.shape.heights,
  );
  const w = createWorld(options);
  w.createBody({ type: "static", colliders: [d] });
  for (const [x, z, y] of [
    [10, 20, 0],
    [12, 22, 3],
    [14.1, 22.1, 4.15],
    [16, 24, 7],
  ]) {
    const h = w.raycast(v(x, 20, z), v(0, -1), 30);
    assert.ok(h);
    assert.ok(Math.abs(h.point.y - y) < 0.001);
  }
  assert.equal(w.raycast(v(9, 20, 20), v(0, -1), 30), null);
  const sampled = sampleHeightfield(
    { heightAt: (x, z) => (x - 10) / 2 + z - 20 },
    { nx: 4, nz: 3, cell: 2, x0: 10, z0: 20 },
  );
  assert.deepEqual(sampled, d);
  w.dispose();
});

test("step height climbs a low ledge but a high ledge blocks", () => {
  function run(height) {
    const w = createWorld(options);
    floor(w);
    w.createBody({
      type: "static",
      position: v(2, height / 2),
      colliders: [{ shape: box(1, height / 2, 2) }],
    });
    const c = w.createCharacter(character);
    ticks(w, 30);
    w.controlCharacter(c, { x: 2, z: 0 });
    ticks(w, 90);
    const p = pos(w, c);
    w.dispose();
    return p;
  }
  assert.ok(run(0.2).x > 2.5);
  assert.ok(run(0.7).x < 0.8);
});

test("slope limit permits a gentle ramp and rejects a steep ramp", () => {
  function run(slope) {
    const w = createWorld(options);
    floor(w);
    w.createBody({
      type: "static",
      colliders: [
        sampleHeightfield(
          { heightAt: (x) => Math.max(0, x) * slope },
          { nx: 31, nz: 5, cell: 0.25, x0: -2, z0: -0.5 },
        ),
      ],
    });
    const c = w.createCharacter({ ...character, position: v(-1, 1, 0) });
    ticks(w, 30);
    w.controlCharacter(c, { x: 2, z: 0 });
    ticks(w, 100);
    const p = pos(w, c);
    w.dispose();
    return p;
  }
  const gentle = run(0.3),
    steep = run(2);
  assert.ok(gentle.x > 1.5 && gentle.y > 1.3, JSON.stringify(gentle));
  assert.ok(steep.x < 0.5, JSON.stringify(steep));
});

test("a character rides a translating platform and snapshot preserves its target", () => {
  const w = createWorld(options),
    restored = createWorld(options);
  const p = w.createBody({
    type: "kinematic",
    colliders: [{ shape: box(3, 0.25, 3) }],
  });
  const c = w.createCharacter({ ...character, position: v(0, 1.2, 0) });
  ticks(w, 30);
  assert.equal(w.characterState(c).grounded, true);
  assert.equal(w.characterState(c).platform, p);
  for (let i = 1; i <= 60; i++) {
    w.moveKinematic(p, v(i * 0.02));
    restored.restore(w.snapshot());
    w.step(w.fixedDt);
    restored.step(w.fixedDt);
    assert.deepEqual(w.snapshot(), restored.snapshot(), `platform replay ${i}`);
  }
  assert.ok(Math.abs(pos(w, c).x - 1.2) < 0.03, JSON.stringify(pos(w, c)));
  w.removeBody(p);
  ticks(w, 30);
  assert.equal(w.characterState(c).grounded, false);
  w.dispose();
  restored.dispose();
});

test("ceiling stops a jump and sensors do not support a character", () => {
  const w = createWorld(options);
  floor(w);
  w.createBody({
    type: "static",
    position: v(0, 2.3),
    colliders: [{ shape: box(2, 0.1, 2) }],
  });
  w.createBody({
    type: "static",
    position: v(0, 1.5),
    colliders: [{ shape: box(2, 0.1, 2), sensor: true }],
  });
  const c = w.createCharacter(character);
  ticks(w, 30);
  w.controlCharacter(c, { x: 0, z: 0, jump: true });
  let high = 0;
  for (let i = 0; i < 60; i++) {
    w.step(w.fixedDt);
    high = Math.max(high, pos(w, c).y);
  }
  assert.ok(high < 1.32);
  assert.equal(w.characterState(c).grounded, true);
  w.removeCharacter(c);
  assert.throws(() => w.characterState(c), /unknown character/);
  w.dispose();
});

test("characters follow rising and rotating kinematic supports", () => {
  for (const mode of ["rise", "rotate"]) {
    const w = createWorld(options);
    const p = w.createBody({
      type: "kinematic",
      colliders: [{ shape: box(3, 0.25, 3) }],
    });
    const c = w.createCharacter({ ...character, position: v(1, 1.2, 0) });
    ticks(w, 30);
    const initial = pos(w, c);
    for (let i = 1; i <= 60; i++) {
      const angle = (i / 60) * 0.8;
      w.moveKinematic(
        p,
        mode === "rise" ? v(0, i * 0.01) : v(),
        mode === "rotate"
          ? { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }
          : undefined,
      );
      w.step(w.fixedDt);
    }
    const result = pos(w, c);
    if (mode === "rise")
      assert.ok(
        Math.abs(result.y - initial.y - 0.6) < 0.04,
        JSON.stringify(result),
      );
    else {
      assert.ok(
        Math.abs(result.x - Math.cos(0.8)) < 0.04,
        JSON.stringify(result),
      );
      assert.ok(
        Math.abs(result.z + Math.sin(0.8)) < 0.04,
        JSON.stringify(result),
      );
    }
    assert.equal(w.characterState(c).grounded, true);
    w.dispose();
  }
});
