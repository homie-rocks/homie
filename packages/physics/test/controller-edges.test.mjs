import test from "node:test";
import assert from "node:assert/strict";
import { ax, cpos, run } from "./scenario-harness.mjs";
import { sampleHeightfield } from "../dist/Heightfield.js";
import { solveCharacter } from "../dist/internal/Character.js";

test("controller drops sub-millimetre residual sweeps", () => {
  let queries = 0;
  solveCharacter(
    {
      cast() {
        queries++;
        return null;
      },
    },
    { x: 0, y: 1, z: 0 },
    { x: 1.2e-10, y: 0, z: -0.0000106 },
    "z",
    0.7,
  );
  assert.equal(queries, 0);
});
for (const up of ["y", "z"]) {
  for (const surface of ["box", "mesh", "heightfield"])
    test(`ground ${surface} contacts include landing and transfer (${up})`, () => {
      const a = ax(up),
        w = a.world();
      const floors = [-2].map((x) =>
        w.createBody({
          type: "static",
          position: a.V(x, -0.5, 0),
          colliders: [{ shape: a.box(2, 0.5, 3) }],
        }),
      );
      const mesh = {
        kind: "mesh",
        vertices: new Float32Array(
          [a.V(0, 0, -3), a.V(4, 0, -3), a.V(0, 0, 3), a.V(4, 0, 3)].flatMap(
            (v) => [v.x, v.y, v.z],
          ),
        ),
        indices: new Uint32Array(
          up === "y" ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2],
        ),
      };
      floors.push(
        w.createBody(
          surface === "box"
            ? {
                type: "static",
                position: a.V(2, -0.5),
                colliders: [{ shape: a.box(2, 0.5, 3) }],
              }
            : surface === "mesh"
              ? { type: "static", colliders: [{ shape: mesh }] }
              : {
                  type: "static",
                  colliders: [
                    sampleHeightfield(
                      { heightAt: () => 0 },
                      { nx: 9, nz: 13, cell: 0.5, x0: 0, z0: -3 },
                      up,
                    ),
                  ],
                },
        ),
      );
      const c = a.chr(w, -1, 2);
      const events = run(w, 60, 1);
      assert.ok(w.characterState(c).hits.length);
      events.push(...run(w, 60, 2, () => w.controlCharacter(c, a.inp(2))));
      const begins = events.filter((e) => e.kind === "contact" && e.started);
      assert.ok(begins.length >= 2, JSON.stringify(events));
      events.push(...run(w, 60, 2, () => w.controlCharacter(c, a.inp(2))));
      for (const floor of floors) {
        const contacts = events.filter(
          (e) =>
            e.kind === "contact" && (e.bodyA === floor || e.bodyB === floor),
        );
        assert.equal(
          contacts.filter((e) => e.started).length,
          1,
          JSON.stringify(contacts),
        );
        assert.equal(
          contacts.filter((e) => !e.started).length,
          1,
          JSON.stringify(contacts),
        );
      }
      w.dispose();
    });
  for (const scale of [0.5, 1])
    for (const size of [100, 300, 800, 2000, 8000, 10000])
      test(`large floor ${size} scale ${scale} and checkpoint spawn (${up})`, () => {
        const a = ax(up),
          w = a.world();
        a.floor(w, size / 2);
        const tuning = {
          height: 1.8 * scale,
          radius: 0.3 * scale,
          offset: 0.01 * scale,
        };
        const c = a.chr(w, 0, scale, 0, tuning);
        run(w, 60, 1);
        run(
          w,
          60,
          2,
          () => w.controlCharacter(c, a.inp(3)),
          () => {
            assert.ok(Math.abs(a.h(cpos(w, c)) - 0.91 * scale) < 0.005);
            assert.ok(w.characterState(c).grounded);
          },
        );
        const p = cpos(w, c);
        w.removeCharacter(c);
        assert.doesNotThrow(() => a.chr(w, p.x, a.h(p), a.s(p), tuning));
        w.dispose();
      });
}

test("invalid movement never reaches a character query", () => {
  for (const value of [NaN, Infinity, -Infinity])
    assert.throws(
      () =>
        solveCharacter(
          {
            cast() {
              assert.fail("invalid engine call");
            },
          },
          { x: 0, y: 0, z: 0 },
          { x: value, y: 0, z: 0 },
          "y",
          0.7,
        ),
      /invalid character movement/,
    );
});

for (const up of ["y", "z"]) {
  test(`a low ceiling blocks at the capsule edge and permits retreat (${up})`, () => {
    const a = ax(up),
      w = a.world();
    a.floor(w);
    w.createBody({
      type: "static",
      position: a.V(8, 2.29),
      colliders: [{ shape: a.box(5, 0.5, 3) }],
    });
    const c = a.chr(w, 0, 1);
    run(w, 60, 0.5);
    run(w, 60, 3, () => w.controlCharacter(c, a.inp(2)));
    assert.ok(cpos(w, c).x <= 2.88, `wedged to ${cpos(w, c).x}`);
    assert.ok(a.h(cpos(w, c)) >= 0.905);
    run(w, 60, 1, () => w.controlCharacter(c, a.inp(-2)));
    assert.ok(cpos(w, c).x < 1);
    w.dispose();
  });
  test(`jumping into a ceiling preserves established horizontal speed (${up})`, () => {
    const a = ax(up),
      w = a.world();
    a.floor(w);
    w.createBody({
      type: "static",
      position: a.V(0, 2.5),
      colliders: [{ shape: a.box(20, 0.5, 3) }],
    });
    const c = a.chr(w, 0, 1);
    run(w, 60, 0.5);
    run(w, 60, 1 / 60, () => w.controlCharacter(c, a.inp(2)));
    const start = cpos(w, c).x;
    run(w, 60, 3, (i) => w.controlCharacter(c, a.inp(2, 0, i === 0)));
    assert.ok(
      Math.abs(cpos(w, c).x - start - 6) < 0.01,
      `travelled ${cpos(w, c).x}`,
    );
    w.dispose();
  });
}

for (const up of ["y", "z"])
  test(`non-binary capsule dimensions restore exactly (${up})`, () => {
    const a = ax(up),
      w = a.world(),
      v = a.world();
    a.floor(w, 1000);
    const c = a.chr(w, 0, 2, 0, { height: 1.998, radius: 0.3 });
    run(w, 60, 0.5);
    v.restore(w.snapshot());
    for (let i = 0; i < 120; i++) {
      for (const world of [w, v]) world.controlCharacter(c, a.inp(0.37, 0.19));
      assert.deepEqual(w.step(0.05), v.step(0.05));
      assert.deepEqual(w.characterState(c), v.characterState(c));
      assert.deepEqual(
        w.bodyState(w.characterState(c).body),
        v.bodyState(v.characterState(c).body),
      );
    }
    w.dispose();
    v.dispose();
  });
